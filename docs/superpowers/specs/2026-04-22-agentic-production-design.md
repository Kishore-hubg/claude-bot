# Agentic Sidecar Production Deployment — Design Spec

**Date:** 2026-04-22  
**Author:** Kishore (Infovision CoE AI/GenAI)  
**Status:** Approved  
**Approach:** Option B — Incremental Layers

---

## 1. Goal

Make the LangGraph agentic sidecar production-ready and deployed to Render. Switch backend from `AGENTIC_MODE=shadow` to `active`. Validate end-to-end bot performance via automated pytest suite covering Web UI flow and Teams bot endpoint.

---

## 2. Architecture

```
Web UI (Vercel)          Teams Bot (Bot Framework)
      │                         │
      ▼                         ▼
┌─────────────────────────────────────────┐
│   Backend API — Render                  │
│   (Node/Express — claude-bot-backend)   │
│                                         │
│   routes/requests.js                    │
│     → agenticService.js (NEW)           │
│          POST /agent/supervisor         │
│          fallback: claudeService.js     │
│     → workflowService.js               │
│     → emailService / teamsService       │
└─────────────────┬───────────────────────┘
                  │  HTTP Bearer token (AGENTIC_API_KEY)
                  ▼
┌─────────────────────────────────────────┐
│  Agentic Sidecar — Render               │
│  (Python FastAPI — claude-bot-agentic)  │
│                                         │
│  LangGraph pipeline:                    │
│   supervisor → intent → extract         │
│             → policy → END              │
│                                         │
│  supervisor: Groq classify intent       │
│  intent:     Groq confirm + confidence  │
│  extract:    Groq structured fields     │
│  policy:     deterministic rules only   │
│                                         │
│  /health checks Groq reachability       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
           Groq API (llama-3.3-70b-versatile)
```

### Contracts

**Request (backend → sidecar):**
```json
{
  "message": "string",
  "conversationHistory": [{"role": "user|assistant", "content": "string"}],
  "userContext": {"id": "string", "role": "string", "department": "string", "email": "string"}
}
```

**Response (sidecar → backend):**
```json
{
  "classification": {
    "type": "access|upgrade|skills|offboarding|idle_reclamation|connectors|plugins|apis|support_qa",
    "title": "string",
    "confidence": 0.95,
    "extractedFields": {},
    "missingFields": [],
    "clarificationQuestion": "string | null",
    "suggestedApprovers": ["manager", "ai_coe_lead"]
  },
  "trace": {"topology": "multi", "agent": "supervisor"}
}
```

**Auth:** `Authorization: Bearer <AGENTIC_API_KEY>` on every request. If `AGENTIC_API_KEY` env var is empty, auth is skipped (local dev convenience).  
**Timeout:** Backend waits 6s max. Cold-start on free Render tier (~30s) triggers fallback to `claudeService.classifyAndExtract`. This is acceptable — first request after idle uses Claude fallback, subsequent requests use sidecar.

**`/health` response schema:**
```json
{
  "status": "ok",
  "service": "agentic-sidecar",
  "topology": "multi",
  "groq_ok": true,
  "groq_latency_ms": 312,
  "specialists": ["intent", "extract", "policy"]
}
```
`groq_ok` is set by making a minimal Groq completion call (`max_tokens=1`) at health check time. If Groq call fails, `groq_ok=false` and HTTP 200 still returned (sidecar is up, LLM is degraded).

**`AGENTIC_MULTI_SPECIALISTS` env var:** comma-separated list of specialist node names to run in the multi-agent pipeline. Parsed at startup into a Python list. Used by `/agent/supervisor` to decide which specialist nodes to invoke. Default: `intent,extract,policy`. All three are always present in current implementation — this var is reserved for future selective routing (e.g., skip `extract` for `support_qa`).

**Render URL note:** After deploying `claude-bot-agentic` to Render, verify the actual service URL in the Render dashboard (Services → claude-bot-agentic → Settings → URL). Update `AGENTIC_API_URL` in the backend Render service env vars if it differs from `https://claude-bot-agentic.onrender.com`.

---

## 3. Phase Plan (Option B — Incremental)

| Phase | What | Verify |
|-------|------|--------|
| 1 | Harden `agentic-sidecar/` — Groq nodes, logging, pinned deps, Dockerfile | Local `uvicorn` starts, `/health` returns `groq_ok:true` |
| 2 | Add `claude-bot-agentic` service to `render.yaml`, push, deploy | Render service live, `/health` green |
| 3 | Add `agenticService.js` to backend, update `routes/requests.js`, flip env vars on Render | Chat request returns sidecar classification |
| 4 | Write + run pytest E2E suite against deployed URLs | All 10 tests green |

---

## 4. Agentic Sidecar Hardening

### 4.1 LLM Integration (Groq per node)

Each LangGraph node calls Groq with a focused prompt returning structured JSON. Policy node stays deterministic (no LLM).

**supervisor node** — classifies intent:
```
System: You are a request classifier for InfoVision's Claude Assistant Bot.
Classify the user message into one of: access, upgrade, skills, offboarding,
idle_reclamation, connectors, plugins, apis, support_qa.
Return ONLY valid JSON: {"intent": "<type>"}
```

**intent node** — confirms + scores confidence:
```
System: Confirm the intent classification and assign a confidence score 0.0-1.0.
Return ONLY valid JSON: {"intent": "<type>", "confidence": 0.95}
```

**extract node** — pulls structured fields:
```
System: Extract structured fields from the user message.
Return ONLY valid JSON: {
  "employeeId": "EMP12345 or null",
  "licenseType": "standard|premium",
  "accessTier": "T1|T2|T3",
  "priority": "low|medium|high|critical",
  "aupConfirmed": true|false,
  "businessJustification": "first 280 chars"
}
```

**policy node** — deterministic rules, no LLM:

Required fields per type:
```python
REQUIRED_FIELDS = {
    "access":      ["employeeId", "aupConfirmed"],
    "upgrade":     ["employeeId"],
    "offboarding": ["employeeId"],
    # all others: no required fields
}
```

Approver chain (hardcoded map, matches backend `APPROVAL_CHAINS`):
```python
APPROVER_CHAIN = {
    "access": ["manager", "ai_coe_lead"],
    "upgrade": ["manager", "ai_coe_lead"],
    "skills": ["manager", "ai_coe_lead"],
    "offboarding": ["manager", "ai_coe_lead"],
    "idle_reclamation": [],
    "connectors": ["manager", "ai_coe_lead"],
    "plugins": ["manager", "ai_coe_lead"],
    "apis": ["manager", "ai_coe_lead"],
    "support_qa": ["manager", "ai_coe_lead"],
}
```

Clarification question generation:
- If `employeeId` missing → `"Please provide the employee ID (e.g. EMP12345)."`
- If `aupConfirmed` missing → `'Please confirm AUP acceptance: "I agree to the AUP".'`
- Multiple missing → concatenate with space separator

### 4.2 Error Handling

Every Groq call wrapped in try/except. On failure, node falls back to existing keyword matching / regex logic. Graph never raises to FastAPI layer — always returns a classification.

### 4.3 Logging

Python `logging` module, structured key=value format:
```
INFO  node=supervisor intent=access latency_ms=342
WARN  node=intent groq_error="rate_limit" fallback=keyword
```

### 4.4 Dependencies (pinned)

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
langgraph==0.2.28
pydantic==2.9.2
groq==0.11.0
httpx==0.27.2
python-dotenv==1.0.1
```

### 4.4a Supervisor Node Call Sequence (`/agent/supervisor`)

```python
@app.post("/agent/supervisor")
def supervisor_agent(payload: RouteRequest, ...):
    state: GraphState = {"message": payload.message, "userContext": payload.userContext.model_dump() if payload.userContext else {}}
    state.update(node_supervisor(state))   # adds: intent, route
    state.update(node_intent(state))       # adds: intent (refined), confidence
    state.update(node_extract(state))      # adds: extractedFields
    state.update(node_policy(state))       # adds: missingFields, clarificationQuestion, suggestedApprovers
    classification = make_classification(state)
    return ClassificationResponse(classification=classification, trace={"topology": "multi", "agent": "supervisor"})
```

Each `node_*` function returns a partial `GraphState` dict — merged into `state` via `.update()`.

### 4.4a-2 Fallback Function Signatures (retained from current `app.py`)

```python
def detect_type(message: str) -> str:
    # keyword matching, returns one of VALID_TYPES, defaults to "access"

def extract_fields(message: str) -> Dict[str, Any]:
    # regex extraction, returns:
    # { "employeeId": str|None, "licenseType": str, "accessTier": str,
    #   "priority": str, "aupConfirmed": bool, "businessJustification": str }
```

Every Groq-calling node does:
```python
try:
    result = groq_client.chat.completions.create(...)
    # parse JSON from result
except Exception as e:
    logger.warning(f"node={node_name} groq_error={e} fallback=keyword")
    # fall back to detect_type(message) or extract_fields(message)
```

### 4.4a-3 Seed Credentials (from `backend/config/seed.js` — no modification needed)

All accounts already seeded with `password123`:

| Role | Email | Env var |
|------|-------|---------|
| `requester` | `user@infovision.com` | `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` |
| `manager` | `manager@infovision.com` | `TEST_MANAGER_EMAIL` / `TEST_MANAGER_PASSWORD` |
| `ai_coe_lead` | `ai.coe@infovision.com` | `TEST_COE_EMAIL` / `TEST_COE_PASSWORD` |

Jane (user) already has `managerId` → Mark Manager. All three accounts exist in `seed.js` — no changes to seed file needed.

### 4.4a-4 Approval Endpoint and State Machine (test 8 reference)

```
POST /api/requests/:id/approve
Auth: Bearer <jwt>
Body: { "decision": "approved"|"rejected", "comments": "string" }
```

State machine for `access` type (2-step chain):
1. Create request via chat → `status=pending_approval`, `currentApprovalStep=0` (manager)
2. Manager approves → `currentApprovalStep=1` (ai_coe_lead), `status=pending_approval`
3. ai_coe_lead approves → `status=approved` → `triggerDeployment()` → `status=deployed`

Test 8 must wait for status=deployed after step 3. `GET /api/requests/:id` returns current `status`.

### 4.4a LangGraph State Schema

```python
class GraphState(TypedDict, total=False):
    message: str                          # raw user message
    userContext: Dict[str, Any]           # passed through, not used by nodes currently
    intent: str                           # set by supervisor, refined by intent node
    confidence: float                     # set by intent node
    extractedFields: Dict[str, Any]       # set by extract node
    missingFields: List[str]              # set by policy node
    clarificationQuestion: Optional[str] # set by policy node
    suggestedApprovers: List[str]         # set by policy node
    route: str                            # set by supervisor ("continue")
```

`userContext` is stored in state and passed through to the response `trace` for observability, but no node modifies its own output based on it in v1.

### 4.4b FastAPI Route Definitions

All routes in `app.py`:

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/health` | `health()` | Returns health schema from Section 2 |
| POST | `/agent/supervisor` | `supervisor_agent()` | Calls each node function sequentially in Python (supervisor→intent→extract→policy), accumulating state manually. Does NOT use `GRAPH.invoke()`. Primary production endpoint. |
| POST | `/agent/intent` | `intent_agent()` | Specialist: intent only, returns partial classification |
| POST | `/agent/extract` | `extract_agent()` | Specialist: extract only, returns partial classification |
| POST | `/agent/policy` | `policy_agent()` | Specialist: policy only, returns partial classification |
| POST | `/agent/route` | `route_agent()` | Calls `GRAPH.invoke(state)` — single compiled LangGraph execution. Used in test 10 for fallback testing and as a simple single-call alternative. |

All POST routes accept `RouteRequest` body and return `ClassificationResponse`. All routes validate Bearer token via shared `auth_or_raise()` dependency. `/agent/route` runs the compiled LangGraph in one `GRAPH.invoke()` call — used in test 10 for fallback testing.

### 4.4c Fallback Logic Location

Each Groq-calling node (supervisor, intent, extract) wraps the LLM call in try/except. On exception, the node falls back to the pure-Python functions already present in `app.py`:
- `detect_type(message)` — keyword matching
- `extract_fields(message)` — regex extraction

These functions are retained in `app.py` unchanged. They serve as the fallback layer.

### 4.5 Dockerfile Hardening

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN adduser --disabled-password --gecos '' appuser
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN chown -R appuser:appuser /app
USER appuser
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD python -c "import httpx; httpx.get('http://localhost:8001/health').raise_for_status()"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
```

---

## 5. Render Deployment (`render.yaml`)

Add second service alongside existing `claude-bot-backend`:

```yaml
  - type: web
    name: claude-bot-agentic
    env: python
    rootDir: agentic-sidecar
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app:app --host 0.0.0.0 --port $PORT --workers 2
    plan: free
    healthCheckPath: /health
    envVars:
      - key: GROQ_API_KEY
        sync: false
      - key: AGENTIC_API_KEY
        sync: false
      - key: AGENTIC_MULTI_SPECIALISTS
        value: intent,extract,policy
```

Backend service additions:
```yaml
      - key: AGENTIC_MODE
        value: active
      - key: AGENTIC_API_URL
        value: https://claude-bot-agentic.onrender.com
      - key: AGENTIC_API_KEY
        sync: false
```

---

## 6. Backend Integration

### 6.1 New file: `backend/services/agenticService.js`

**Function signature:**
```js
async function classifyAndExtract(message, conversationHistory = [], userContext = {})
```

**HTTP body sent to sidecar:**
```json
{
  "message": "<string>",
  "conversationHistory": [{"role": "user|assistant", "content": "<string>"}],
  "userContext": {"id": "<string>", "role": "<string>", "department": "<string>", "email": "<string>"}
}
```

**Return value** (same shape `claudeService.classifyAndExtract` returns):
```js
{
  type, title, confidence, extractedFields,
  missingFields, clarificationQuestion, suggestedApprovers
}
```
Sidecar response is `{ classification: {...}, trace: {...} }` — service unwraps `classification` before returning to caller.

**`AGENTIC_MODE` gate:** If `process.env.AGENTIC_MODE !== 'active'`, skip sidecar entirely and call `claudeService.classifyAndExtract` directly. This allows shadow/disabled modes without code changes.

**`conversationHistory` handling:** Passed to sidecar in request body for future use. Sidecar accepts and stores in state but no node reads it in v1. Documented as reserved for future multi-turn context injection.

**Error behaviour:**
- axios timeout after `AGENTIC_TIMEOUT_MS` (default 6000ms)
- On HTTP ≥ 500 or timeout or network error: `logger.warn('agentic fallback triggered', { error })`, then call `claudeService.classifyAndExtract(message, conversationHistory)`
- Export: `module.exports = { classifyAndExtract }`

### 6.2 `backend/routes/requests.js` change

Single line change in chat handler:
```js
// Replace:
const classification = await claudeService.classifyAndExtract(message, history);
// With:
const classification = await agenticService.classifyAndExtract(message, history, userContext);
```

### 6.3 `claudeService.js` — no changes

Still used for: `generateUserResponse`, `generateApprovalMessage`, `answerSupportQuestion`, fallback classification.

### 6.3a Auth flow for tests (test 7 + test 8)

Backend uses JWT. Login endpoint:
```
POST /api/auth/login
Body: { "email": "<TEST_USER_EMAIL>", "password": "<TEST_USER_PASSWORD>" }
Response: { "token": "<jwt>", "user": { "role": "...", ... } }
```
Token used as `Authorization: Bearer <jwt>` on all subsequent calls.  
Tests require two seeded users: one `user` role (requester) and one `manager` role (approver). Seed via `backend/config/seed.js` which already exists.

### 6.4 Environment variables

| Var | Local dev | Render prod |
|-----|-----------|-------------|
| `AGENTIC_MODE` | `active` | `active` |
| `AGENTIC_API_URL` | `http://localhost:8001` | `https://claude-bot-agentic.onrender.com` |
| `AGENTIC_API_KEY` | any string | same value as sidecar |
| `AGENTIC_TIMEOUT_MS` | `6000` | `6000` |

---

## 7. E2E pytest Test Suite

**Location:** `agentic-sidecar/tests/test_e2e.py`  
**Runner:** `pytest agentic-sidecar/tests/ -v`  
**Env vars required:**
- `BACKEND_URL` — deployed backend URL
- `AGENTIC_URL` — deployed sidecar URL
- `AGENTIC_API_KEY` — shared secret
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — seeded `user` role account
- `TEST_MANAGER_EMAIL` / `TEST_MANAGER_PASSWORD` — seeded `manager` role account
- `TEST_COE_EMAIL` / `TEST_COE_PASSWORD` — seeded `ai_coe_lead` role account

All six accounts are created by `backend/config/seed.js`. Credentials are hardcoded in `seed.js` and must match these env vars.

### Test Cases

| # | Name | Target | Assertion |
|---|------|--------|-----------|
| 1 | `test_sidecar_health` | `GET /health` (sidecar) | `status=ok`, `groq_ok=true` |
| 2 | `test_intent_access` | `POST /agent/supervisor` | `type=access`, `confidence≥0.7` |
| 3 | `test_intent_offboarding` | `POST /agent/supervisor` | `type=offboarding`, `employeeId=EMP12345` |
| 4 | `test_intent_support` | `POST /agent/supervisor` | `type=support_qa` |
| 5 | `test_missing_fields` | `POST /agent/supervisor` with `{"message": "I need access to the internal portal"}` (no AUP confirmation phrase) | `missingFields` contains `"aupConfirmed"`, `clarificationQuestion` is non-null |
| 6 | `test_backend_health` | `GET /health` (backend) | `status=ok` |
| 7 | `test_auth_and_chat` | `POST /api/auth/login` → `POST /api/requests/chat` | classification returned, `type` valid |
| 8 | `test_full_workflow` | (a) login as `user` role → `POST /api/requests/chat` to create request, record `requestId`, (b) login as `manager` → `POST /api/requests/{id}/approve` `{"decision":"approved","comments":"ok"}`, (c) login as `ai_coe_lead` → `POST /api/requests/{id}/approve` same body, (d) `GET /api/requests/{id}` as user → assert `status=deployed`. Requires 3 seeded accounts: user, manager, ai_coe_lead (all created by `seed.js`) | `status=deployed` |
| 9 | `test_teams_bot_endpoint` | `POST /api/bot` with body `{"type":"message","text":"hello","from":{"id":"test"},"conversation":{"id":"test"},"recipient":{"id":"test"}}` | HTTP 200 |
| 10 | `test_fallback_on_sidecar_down` | Use `unittest.mock.patch` on `httpx.Client.post` to raise `httpx.TimeoutException`. Call `POST /agent/route` on a local test FastAPI `TestClient`. Verify classification still returned via keyword fallback path | `type` is valid, no exception raised |

---

## 8. Files Changed / Created

| File | Action |
|------|--------|
| `agentic-sidecar/app.py` | Rewrite — add Groq nodes, structured logging, hardened health |
| `agentic-sidecar/requirements.txt` | Update — pin versions, add `groq`, `httpx`, `python-dotenv` |
| `agentic-sidecar/Dockerfile` | Update — non-root user, HEALTHCHECK |
| `agentic-sidecar/.env.example` | Create — document `GROQ_API_KEY`, `AGENTIC_API_KEY` |
| `agentic-sidecar/tests/test_e2e.py` | Create — 10-test pytest suite |
| `render.yaml` | Update — add `claude-bot-agentic` service + backend env vars |
| `backend/services/agenticService.js` | Create — sidecar wrapper with fallback |
| `backend/routes/requests.js` | Update — swap `claudeService` → `agenticService` for classification |
| Render dashboard env vars | Set `AGENTIC_MODE=active`, `AGENTIC_API_URL`, `AGENTIC_API_KEY` on `claude-bot-backend` service (already templated in `render.yaml`) |

---

## 9. Out of Scope

- Teams channel webhook URL configuration (manual Render dashboard step)
- Vercel frontend changes (no frontend code changes needed)
- Custom domain setup
- Agentic sidecar scaling beyond Render free tier
