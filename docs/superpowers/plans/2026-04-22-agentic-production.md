# Agentic Sidecar Production Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Python FastAPI/LangGraph sidecar with real Groq LLM calls, deploy it to Render as a second service, flip backend `AGENTIC_MODE` from `shadow` → `on`, and validate with a 10-test pytest E2E suite.

**Architecture:** Agentic sidecar (`agentic-sidecar/app.py`) runs as an independent Render web service. Backend `agenticOrchestratorService.js` already handles routing/fallback — only env vars need updating. Sidecar nodes call Groq for intent/extract; policy stays deterministic rules.

**Tech Stack:** Python 3.11, FastAPI 0.115, LangGraph 0.2.28, Groq SDK 0.11, uvicorn, pytest, Node.js/Express (backend — no code changes), Render (deployment).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `agentic-sidecar/app.py` | **Rewrite** | FastAPI app — Groq nodes, structured logging, hardened health |
| `agentic-sidecar/requirements.txt` | **Update** | Pinned production deps incl. `groq`, `python-dotenv` |
| `agentic-sidecar/Dockerfile` | **Update** | Non-root user, HEALTHCHECK directive |
| `agentic-sidecar/.env.example` | **Create** | Document all env vars |
| `agentic-sidecar/tests/__init__.py` | **Create** | Makes tests a package |
| `agentic-sidecar/tests/test_e2e.py` | **Create** | 10-test pytest suite against deployed URLs |
| `render.yaml` | **Update** | Add `claude-bot-agentic` service; backend env vars |

**No backend JS changes required.** The spec described creating `agenticService.js` but the codebase already has the more complete `agenticOrchestratorService.js` (verified by reading `backend/services/agenticOrchestratorService.js`). `routes/requests.js` already calls it. `AGENTIC_MODE` valid values per actual code are `off`/`shadow`/`on` — the spec's `active` value was incorrect. Setting `AGENTIC_MODE=on` is the correct production flip.

---

## Task 1: Update `requirements.txt` with pinned production deps

**Files:**
- Modify: `agentic-sidecar/requirements.txt`

- [ ] **Step 1: Replace requirements.txt contents**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
langgraph==0.2.28
pydantic==2.9.2
groq==0.11.0
httpx==0.27.2
python-dotenv==1.0.1
```

- [ ] **Step 2: Verify install locally**

```bash
cd agentic-sidecar
pip install -r requirements.txt
```
Expected: All packages install with no version conflicts.

- [ ] **Step 3: Commit**

```bash
git add agentic-sidecar/requirements.txt
git commit -m "chore: pin agentic sidecar production dependencies"
```

---

## Task 2: Create `.env.example` for sidecar

**Files:**
- Create: `agentic-sidecar/.env.example`

- [ ] **Step 1: Create the file**

```bash
# agentic-sidecar/.env.example
GROQ_API_KEY=gsk_...              # Groq API key — get from console.groq.com
AGENTIC_API_KEY=                  # Shared secret with backend (leave empty for local dev)
AGENTIC_MULTI_SPECIALISTS=intent,extract,policy
```

- [ ] **Step 2: Commit**

```bash
git add agentic-sidecar/.env.example
git commit -m "chore: add agentic sidecar env example"
```

---

## Task 3: Rewrite `app.py` with Groq LLM nodes

**Files:**
- Modify: `agentic-sidecar/app.py`

This is the core change. Replace keyword-only detection with real Groq calls per node, add structured logging, harden `/health` to check Groq connectivity.

- [ ] **Step 1: Rewrite `app.py` with full content below**

```python
import logging
import os
import re
import time
from typing import Any, Dict, List, Literal, Optional, TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from groq import Groq
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

load_dotenv()

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s node=%(name)s %(message)s",
)
logger = logging.getLogger("agentic-sidecar")

# ── Constants ─────────────────────────────────────────────────────────────────
VALID_TYPES = {
    "access", "upgrade", "skills", "offboarding",
    "idle_reclamation", "connectors", "plugins", "apis", "support_qa",
}

REQUIRED_FIELDS: Dict[str, List[str]] = {
    "access": ["employeeId", "aupConfirmed"],
    "upgrade": ["employeeId"],
    "offboarding": ["employeeId"],
}

APPROVER_CHAIN: Dict[str, List[str]] = {
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

API_KEY = os.getenv("AGENTIC_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
SPECIALISTS = [
    x.strip().lower()
    for x in os.getenv("AGENTIC_MULTI_SPECIALISTS", "intent,extract,policy").split(",")
    if x.strip()
]

# ── Groq client (lazy init) ───────────────────────────────────────────────────
_groq_client: Optional[Groq] = None


def get_groq_client() -> Groq:
    global _groq_client
    if _groq_client is None:
        if not GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set")
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


def groq_json_call(system: str, user: str, node_name: str) -> str:
    """Call Groq and return raw text. Raises on error — caller handles fallback."""
    t0 = time.monotonic()
    client = get_groq_client()
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=512,
        temperature=0.0,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    logger.info(f"node={node_name} latency_ms={latency_ms}")
    return response.choices[0].message.content or ""


# ── Keyword / regex fallbacks (unchanged from original) ───────────────────────
def normalize_text(text: str) -> str:
    return (text or "").strip().lower()


def detect_type(message: str) -> str:
    t = normalize_text(message)
    if any(k in t for k in ["offboard", "off-boarding", "deactivate user", "revoke access", "exit employee"]):
        return "offboarding"
    if any(k in t for k in ["upgrade", "higher tier", "tier change", "premium"]):
        return "upgrade"
    if any(k in t for k in ["connector", "connect to", "integration"]):
        return "connectors"
    if any(k in t for k in ["plugin", "plug-in", "extension deploy"]):
        return "plugins"
    if any(k in t for k in ["api", "token", "quota", "endpoint access"]):
        return "apis"
    if any(k in t for k in ["skill", "prompt library", "knowledge"]):
        return "skills"
    if any(k in t for k in ["idle", "unused", "reclaim license"]):
        return "idle_reclamation"
    if any(k in t for k in ["support", "bug", "issue", "qa", "help"]):
        return "support_qa"
    return "access"


def extract_fields(message: str) -> Dict[str, Any]:
    text = message or ""
    lower = text.lower()
    employee_id = None
    m = re.search(r"\b(emp[-_ ]?\d{2,})\b", lower, re.IGNORECASE)
    if m:
        employee_id = m.group(1).upper().replace(" ", "")
    license_type = "premium" if "premium" in lower else "standard"
    access_tier = "T1" if "t1" in lower else ("T3" if "t3" in lower else "T2")
    aup_confirmed = bool(
        re.search(r"\bi agree to (the )?aup\b", lower)
        or "aup confirmed" in lower
        or "accepted aup" in lower
    )
    priority = "high" if any(k in lower for k in ["urgent", "critical", "asap"]) else "medium"
    return {
        "employeeId": employee_id,
        "licenseType": license_type,
        "accessTier": access_tier,
        "priority": priority,
        "aupConfirmed": aup_confirmed,
        "businessJustification": text[:280] if text else "",
    }


def missing_fields_for_type(req_type: str, fields: Dict[str, Any]) -> List[str]:
    missing: List[str] = []
    required = REQUIRED_FIELDS.get(req_type, [])
    if "employeeId" in required and not fields.get("employeeId"):
        missing.append("employeeId")
    if "aupConfirmed" in required and not fields.get("aupConfirmed"):
        missing.append("aupConfirmed")
    return missing


def clarification_for_missing(missing: List[str], req_type: str) -> Optional[str]:
    if not missing:
        return None
    prompts = []
    if "employeeId" in missing:
        prompts.append("Please provide the employee ID (e.g. EMP12345).")
    if "aupConfirmed" in missing:
        prompts.append('Please confirm AUP acceptance: "I agree to the AUP".')
    return f"I need a bit more information to process this {req_type} request. {' '.join(prompts)}"


# ── Pydantic models ───────────────────────────────────────────────────────────
class UserContext(BaseModel):
    id: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    email: Optional[str] = None


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class RouteRequest(BaseModel):
    message: str
    conversationHistory: List[ConversationMessage] = Field(default_factory=list)
    userContext: Optional[UserContext] = None
    supervisorOutput: Optional[Dict[str, Any]] = None


class Classification(BaseModel):
    type: str
    title: str
    confidence: float
    extractedFields: Dict[str, Any]
    missingFields: List[str] = Field(default_factory=list)
    clarificationQuestion: Optional[str] = None
    suggestedApprovers: List[str] = Field(default_factory=list)


class ClassificationResponse(BaseModel):
    classification: Classification
    trace: Dict[str, Any]


# ── LangGraph state ───────────────────────────────────────────────────────────
class GraphState(TypedDict, total=False):
    message: str
    userContext: Dict[str, Any]
    intent: str
    confidence: float
    extractedFields: Dict[str, Any]
    missingFields: List[str]
    clarificationQuestion: Optional[str]
    suggestedApprovers: List[str]
    route: str


# ── LangGraph nodes ───────────────────────────────────────────────────────────
def node_supervisor(state: GraphState) -> GraphState:
    msg = state.get("message", "")
    system = (
        "You are a request classifier for InfoVision's Claude Assistant Bot. "
        "Classify the user message into EXACTLY ONE of: "
        "access, upgrade, skills, offboarding, idle_reclamation, connectors, plugins, apis, support_qa. "
        'Return ONLY valid JSON with one key: {"intent": "<type>"}'
    )
    try:
        import json
        raw = groq_json_call(system, msg, "supervisor")
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(cleaned)
        intent = data.get("intent", "").lower()
        if intent not in VALID_TYPES:
            intent = detect_type(msg)
    except Exception as e:
        logger.warning(f"node=supervisor groq_error={e} fallback=keyword")
        intent = detect_type(msg)
    return {"intent": intent, "route": "continue"}


def node_intent(state: GraphState) -> GraphState:
    msg = state.get("message", "")
    current_intent = state.get("intent") or detect_type(msg)
    system = (
        "You are a request classifier. Confirm or correct this intent classification and provide a confidence score. "
        f"Current intent: {current_intent}. "
        "Valid types: access, upgrade, skills, offboarding, idle_reclamation, connectors, plugins, apis, support_qa. "
        'Return ONLY valid JSON: {"intent": "<type>", "confidence": <0.0-1.0>}'
    )
    try:
        import json
        raw = groq_json_call(system, msg, "intent")
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(cleaned)
        intent = data.get("intent", current_intent).lower()
        confidence = float(data.get("confidence", 0.8))
        if intent not in VALID_TYPES:
            intent = current_intent
    except Exception as e:
        logger.warning(f"node=intent groq_error={e} fallback=passthrough")
        intent = current_intent
        confidence = 0.75
    return {"intent": intent, "confidence": confidence}


def node_extract(state: GraphState) -> GraphState:
    msg = state.get("message", "")
    system = (
        "You are a field extractor for InfoVision's request system. "
        "Extract structured fields from the user message. "
        "Return ONLY valid JSON with these keys (use null if not found): "
        '{"employeeId": "EMP12345 or null", "licenseType": "standard or premium", '
        '"accessTier": "T1 or T2 or T3", "priority": "low or medium or high or critical", '
        '"aupConfirmed": true or false, "businessJustification": "first 280 chars of context"}'
    )
    try:
        import json
        raw = groq_json_call(system, msg, "extract")
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        fields = json.loads(cleaned)
        # Sanitize types
        fields["aupConfirmed"] = bool(fields.get("aupConfirmed", False))
        fields["employeeId"] = fields.get("employeeId") or None
        fields["licenseType"] = fields.get("licenseType", "standard")
        fields["accessTier"] = fields.get("accessTier", "T2")
        fields["priority"] = fields.get("priority", "medium")
        fields["businessJustification"] = str(fields.get("businessJustification") or "")[:280]
    except Exception as e:
        logger.warning(f"node=extract groq_error={e} fallback=regex")
        fields = extract_fields(msg)
    return {"extractedFields": fields}


def node_policy(state: GraphState) -> GraphState:
    intent = state.get("intent", "support_qa")
    fields = state.get("extractedFields", {})
    missing = missing_fields_for_type(intent, fields)
    clarification = clarification_for_missing(missing, intent)
    approvers = APPROVER_CHAIN.get(intent, ["manager"])
    return {
        "missingFields": missing,
        "clarificationQuestion": clarification,
        "suggestedApprovers": approvers,
    }


# ── LangGraph compiled graph (used by /agent/route) ───────────────────────────
def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("supervisor", node_supervisor)
    graph.add_node("intent", node_intent)
    graph.add_node("extract", node_extract)
    graph.add_node("policy", node_policy)
    graph.set_entry_point("supervisor")
    graph.add_edge("supervisor", "intent")
    graph.add_edge("intent", "extract")
    graph.add_edge("extract", "policy")
    graph.add_edge("policy", END)
    return graph.compile()


GRAPH = build_graph()


# ── FastAPI ───────────────────────────────────────────────────────────────────
app = FastAPI(title="Claude Bot LangGraph Sidecar", version="2.0.0")


def auth_or_raise(authorization: Optional[str]):
    if not API_KEY:
        return  # auth disabled in local dev
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def make_classification(payload: Dict[str, Any]) -> Classification:
    req_type = payload.get("intent", "support_qa")
    if req_type not in VALID_TYPES:
        req_type = "support_qa"
    fields = payload.get("extractedFields", {})
    title = f"{req_type.replace('_', ' ').title()} Request"
    return Classification(
        type=req_type,
        title=title,
        confidence=float(payload.get("confidence", 0.75)),
        extractedFields=fields,
        missingFields=payload.get("missingFields", []) or [],
        clarificationQuestion=payload.get("clarificationQuestion"),
        suggestedApprovers=payload.get("suggestedApprovers", []) or [],
    )


@app.get("/health")
def health():
    groq_ok = False
    groq_latency_ms = None
    if GROQ_API_KEY:
        try:
            t0 = time.monotonic()
            client = get_groq_client()
            client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            groq_latency_ms = int((time.monotonic() - t0) * 1000)
            groq_ok = True
        except Exception as e:
            logger.warning(f"health_check groq_error={e}")
    return {
        "status": "ok",
        "service": "agentic-sidecar",
        "topology": "multi",
        "groq_ok": groq_ok,
        "groq_latency_ms": groq_latency_ms,
        "specialists": SPECIALISTS,
    }


@app.post("/agent/supervisor", response_model=ClassificationResponse)
def supervisor_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    state: GraphState = {
        "message": payload.message,
        "userContext": payload.userContext.model_dump() if payload.userContext else {},
    }
    state.update(node_supervisor(state))
    state.update(node_intent(state))
    state.update(node_extract(state))
    state.update(node_policy(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "supervisor"},
    )


@app.post("/agent/intent", response_model=ClassificationResponse)
def intent_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base_cls = (payload.supervisorOutput or {}).get("classification") or {}
    state: GraphState = {"message": payload.message, "intent": base_cls.get("type")}
    state.update(node_intent(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "intent"},
    )


@app.post("/agent/extract", response_model=ClassificationResponse)
def extract_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base_cls = (payload.supervisorOutput or {}).get("classification") or {}
    state: GraphState = {
        "message": payload.message,
        "intent": base_cls.get("type") or detect_type(payload.message),
        "confidence": float(base_cls.get("confidence", 0.8)),
    }
    state.update(node_extract(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "extract"},
    )


@app.post("/agent/policy", response_model=ClassificationResponse)
def policy_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base_cls = (payload.supervisorOutput or {}).get("classification") or {}
    state: GraphState = {
        "message": payload.message,
        "intent": base_cls.get("type") or detect_type(payload.message),
        "confidence": float(base_cls.get("confidence", 0.8)),
        "extractedFields": base_cls.get("extractedFields") or extract_fields(payload.message),
    }
    state.update(node_policy(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "policy"},
    )


@app.post("/agent/route", response_model=ClassificationResponse)
def route_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    """Single compiled graph execution — used for testing and simple integrations."""
    auth_or_raise(authorization)
    state: GraphState = {
        "message": payload.message,
        "userContext": payload.userContext.model_dump() if payload.userContext else {},
    }
    out = GRAPH.invoke(state)
    return ClassificationResponse(
        classification=make_classification(out),
        trace={"topology": "single", "agent": "route"},
    )
```

- [ ] **Step 2: Run sidecar locally**

```bash
cd agentic-sidecar
cp .env.example .env
# Edit .env — add your GROQ_API_KEY
uvicorn app:app --reload --port 8001
```
Expected: Server starts on port 8001, no import errors.

- [ ] **Step 3: Smoke test health endpoint**

```bash
curl http://localhost:8001/health
```
Expected:
```json
{"status":"ok","service":"agentic-sidecar","topology":"multi","groq_ok":true,"groq_latency_ms":400,"specialists":["intent","extract","policy"]}
```

- [ ] **Step 4: Smoke test supervisor endpoint**

```bash
curl -s -X POST http://localhost:8001/agent/supervisor \
  -H "Content-Type: application/json" \
  -d '{"message":"I need access to the internal portal"}' | python -m json.tool
```
Expected: `classification.type` = `"access"`, `confidence` ≥ 0.7.

- [ ] **Step 5: Commit**

```bash
git add agentic-sidecar/app.py
git commit -m "feat: add Groq LLM nodes to agentic sidecar with structured logging and hardened health"
```

---

## Task 4: Update `Dockerfile` with non-root user and HEALTHCHECK

**Files:**
- Modify: `agentic-sidecar/Dockerfile`

- [ ] **Step 1: Replace Dockerfile contents**

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

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import httpx; httpx.get('http://localhost:8001/health', timeout=8).raise_for_status()"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
```

- [ ] **Step 2: Verify Docker build (optional — skip if Docker not available locally)**

```bash
cd agentic-sidecar
docker build -t claude-bot-agentic:test .
```
Expected: Build completes, no errors.

- [ ] **Step 3: Commit**

```bash
git add agentic-sidecar/Dockerfile
git commit -m "chore: harden agentic sidecar Dockerfile — non-root user and HEALTHCHECK"
```

---

## Task 5: Update `render.yaml` to add agentic service

**Files:**
- Modify: `render.yaml`

- [ ] **Step 1: Read current render.yaml** — verify existing backend service structure before editing.

- [ ] **Step 2: Add `claude-bot-agentic` service and backend env vars**

Append the second service block and add the three new env vars to the existing `claude-bot-backend` service. Final `render.yaml`:

```yaml
services:
  - type: web
    name: claude-bot-backend
    env: node
    rootDir: backend
    buildCommand: npm ci --only=production
    startCommand: node server.js
    plan: free
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: FRONTEND_URL
        sync: false
      - key: MONGODB_URI
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: JWT_EXPIRES_IN
        value: 7d
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: GROQ_API_KEY
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: MICROSOFT_APP_ID
        sync: false
      - key: MICROSOFT_APP_PASSWORD
        sync: false
      - key: AZURE_TENANT_ID
        sync: false
      - key: AZURE_CLIENT_ID
        sync: false
      - key: AZURE_CLIENT_SECRET
        sync: false
      - key: AGENTIC_MODE
        value: on
      - key: AGENTIC_API_URL
        value: https://claude-bot-agentic.onrender.com
      - key: AGENTIC_API_KEY
        sync: false
      - key: AGENTIC_TIMEOUT_MS
        value: "6000"
      - key: AGENTIC_ORCHESTRATION
        value: multi

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

> **Important:** After first deploy, verify the Render-assigned URL in dashboard (Services → claude-bot-agentic → Settings → URL). Update `AGENTIC_API_URL` in the backend service env vars if it differs from `https://claude-bot-agentic.onrender.com`.

- [ ] **Step 3: Commit and push**

```bash
git add render.yaml
git commit -m "feat: add claude-bot-agentic Render service and flip AGENTIC_MODE to on"
git push origin main
```

---

## Task 6: Set env vars in Render dashboard and deploy

This task is manual — no code changes.

- [ ] **Step 1: Log in to Render dashboard → https://dashboard.render.com**

- [ ] **Step 2: Deploy via Blueprint (if not already connected)**
  - New → Blueprint → connect GitHub repo `Kishore-hubg/claude-bot`
  - Render reads `render.yaml` and creates both services automatically

- [ ] **Step 3: Set `sync: false` env vars for `claude-bot-agentic`**

In Render dashboard → claude-bot-agentic → Environment:
| Key | Value |
|-----|-------|
| `GROQ_API_KEY` | your Groq API key from console.groq.com (same key as in `backend/.env`) |
| `AGENTIC_API_KEY` | generate a random string: `openssl rand -hex 32` |

- [ ] **Step 4: Set `sync: false` env vars for `claude-bot-backend`**

In Render dashboard → claude-bot-backend → Environment, add/update:
| Key | Value |
|-----|-------|
| `AGENTIC_API_KEY` | same value as above |

All other `claude-bot-backend` env vars should already be set from previous deployment.

- [ ] **Step 5: Trigger deploy on both services**
  - claude-bot-agentic: Manual Deploy → Deploy latest commit
  - claude-bot-backend: Manual Deploy → Deploy latest commit

- [ ] **Step 6: Verify both services are live**

```bash
# Sidecar health
curl https://claude-bot-agentic.onrender.com/health
# Expected: {"status":"ok","groq_ok":true,...}

# Backend health
curl https://claude-bot-backend.onrender.com/health
# Expected: {"status":"ok",...}
```

> **Note:** Free tier Render services spin down after 15min idle. First curl may take 30s. That is expected.

---

## Task 7: Create pytest E2E test suite

**Files:**
- Create: `agentic-sidecar/tests/__init__.py`
- Create: `agentic-sidecar/tests/test_e2e.py`

- [ ] **Step 1: Create `__init__.py`**

```python
# agentic-sidecar/tests/__init__.py
```
(Empty file.)

- [ ] **Step 2: Create `test_e2e.py`**

```python
"""
E2E tests against deployed Render services.

Required env vars:
  BACKEND_URL          https://claude-bot-backend.onrender.com
  AGENTIC_URL          https://claude-bot-agentic.onrender.com
  AGENTIC_API_KEY      shared secret
  TEST_USER_EMAIL      user@infovision.com
  TEST_USER_PASSWORD   password123
  TEST_MANAGER_EMAIL   manager@infovision.com
  TEST_MANAGER_PASSWORD password123
  TEST_COE_EMAIL       ai.coe@infovision.com
  TEST_COE_PASSWORD    password123
"""

import os
import time
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

BACKEND = os.environ.get("BACKEND_URL", "https://claude-bot-backend.onrender.com")
AGENTIC = os.environ.get("AGENTIC_URL", "https://claude-bot-agentic.onrender.com")
AGENTIC_KEY = os.environ.get("AGENTIC_API_KEY", "")

AGENTIC_HEADERS = {"Authorization": f"Bearer {AGENTIC_KEY}"} if AGENTIC_KEY else {}

# Seeded credentials (from backend/config/seed.js)
USER_EMAIL = os.environ.get("TEST_USER_EMAIL", "user@infovision.com")
USER_PASS = os.environ.get("TEST_USER_PASSWORD", "password123")
MANAGER_EMAIL = os.environ.get("TEST_MANAGER_EMAIL", "manager@infovision.com")
MANAGER_PASS = os.environ.get("TEST_MANAGER_PASSWORD", "password123")
COE_EMAIL = os.environ.get("TEST_COE_EMAIL", "ai.coe@infovision.com")
COE_PASS = os.environ.get("TEST_COE_PASSWORD", "password123")


# ── Helpers ──────────────────────────────────────────────────────────────────
def login(email: str, password: str) -> str:
    """Returns JWT token string."""
    r = httpx.post(f"{BACKEND}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.text}"
    token = r.json().get("token")
    assert token, f"No token in login response for {email}"
    return token


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Tests ─────────────────────────────────────────────────────────────────────
def test_sidecar_health():
    """Sidecar must be live with Groq connectivity confirmed."""
    r = httpx.get(f"{AGENTIC}/health", timeout=60)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["groq_ok"] is True, f"Groq not reachable: {data}"


def test_intent_access():
    """'I need access to Jira' → type=access, confidence ≥ 0.7"""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "I need access to Jira for my project"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200
    cls = r.json()["classification"]
    assert cls["type"] == "access"
    assert cls["confidence"] >= 0.7


def test_intent_offboarding():
    """'Offboard EMP12345' → type=offboarding, employeeId=EMP12345"""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "Please offboard employee EMP12345 who is leaving next week"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200
    cls = r.json()["classification"]
    assert cls["type"] == "offboarding"
    assert cls["extractedFields"].get("employeeId") == "EMP12345"


def test_intent_support():
    """'How do I reset my password?' → type=support_qa"""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "How do I reset my password for the portal?"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200
    cls = r.json()["classification"]
    assert cls["type"] == "support_qa"


def test_missing_fields_aup():
    """Access request without AUP → missingFields includes aupConfirmed"""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "I need access to the internal portal"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200
    cls = r.json()["classification"]
    assert "aupConfirmed" in cls["missingFields"], f"Expected aupConfirmed in missingFields: {cls}"
    assert cls["clarificationQuestion"] is not None


def test_backend_health():
    """Backend must be live."""
    r = httpx.get(f"{BACKEND}/health", timeout=60)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_auth_and_chat():
    """Login → chat → classification returned with valid type."""
    token = login(USER_EMAIL, USER_PASS)
    r = httpx.post(
        f"{BACKEND}/api/requests/chat",
        json={"message": "I need API access to the data pipeline", "conversationHistory": []},
        headers=auth_headers(token),
        timeout=30,
    )
    assert r.status_code in (200, 201), f"Chat failed: {r.text}"
    data = r.json()
    cls = data.get("classification") or {}
    valid_types = {"access", "upgrade", "skills", "offboarding", "idle_reclamation",
                   "connectors", "plugins", "apis", "support_qa"}
    assert cls.get("type") in valid_types, f"Invalid classification type: {cls}"


def test_full_workflow():
    """
    Full E2E: user submits request → manager approves → ai_coe_lead approves → status=deployed
    Uses 'access' type with AUP confirmed so it proceeds without clarification.
    """
    user_token = login(USER_EMAIL, USER_PASS)
    manager_token = login(MANAGER_EMAIL, MANAGER_PASS)
    coe_token = login(COE_EMAIL, COE_PASS)

    # 1) Submit request (explicit AUP confirmation so no clarification loop)
    chat_r = httpx.post(
        f"{BACKEND}/api/requests/chat",
        json={
            "message": "I need access to Claude AI. I agree to the AUP. Employee ID: EMP99001.",
            "conversationHistory": [],
        },
        headers=auth_headers(user_token),
        timeout=30,
    )
    assert chat_r.status_code in (200, 201), f"Chat failed: {chat_r.text}"
    data = chat_r.json()
    assert data.get("success") is True, f"Request not created: {data}"
    request_id = data["request"]["_id"]

    # 2) Manager approves (step 0)
    approve_r = httpx.post(
        f"{BACKEND}/api/requests/{request_id}/approve",
        json={"decision": "approved", "comments": "Approved by manager"},
        headers=auth_headers(manager_token),
        timeout=30,
    )
    assert approve_r.status_code == 200, f"Manager approval failed: {approve_r.text}"

    # 3) AI CoE lead approves (step 1 — triggers deployment)
    approve_r2 = httpx.post(
        f"{BACKEND}/api/requests/{request_id}/approve",
        json={"decision": "approved", "comments": "Approved by CoE"},
        headers=auth_headers(coe_token),
        timeout=30,
    )
    assert approve_r2.status_code == 200, f"CoE approval failed: {approve_r2.text}"

    # 4) Poll for deployed status (deployment is synchronous in current implementation)
    status_r = httpx.get(
        f"{BACKEND}/api/requests/{request_id}",
        headers=auth_headers(user_token),
        timeout=30,
    )
    assert status_r.status_code == 200
    final_status = status_r.json().get("status") or status_r.json().get("request", {}).get("status")
    assert final_status == "deployed", f"Expected deployed, got: {final_status}"


def test_teams_bot_endpoint():
    """Teams bot endpoint must accept a message activity and return 200."""
    r = httpx.post(
        f"{BACKEND}/api/bot",
        json={
            "type": "message",
            "text": "hello",
            "from": {"id": "test-user-id", "name": "Test User"},
            "conversation": {"id": "test-conv-id"},
            "recipient": {"id": "test-bot-id"},
            "channelId": "msteams",
        },
        timeout=30,
    )
    assert r.status_code == 200, f"Teams bot endpoint failed: {r.status_code} {r.text}"


def test_fallback_on_sidecar_down():
    """When Groq raises, /agent/route still returns valid classification via keyword fallback."""
    # Import app inside test to use TestClient (no deployed service needed for this test)
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app import app as sidecar_app

    client = TestClient(sidecar_app)

    with patch("app.groq_json_call", side_effect=Exception("simulated groq timeout")):
        r = client.post(
            "/agent/route",
            json={"message": "I need access to the internal tools"},
        )
    assert r.status_code == 200
    cls = r.json()["classification"]
    valid_types = {"access", "upgrade", "skills", "offboarding", "idle_reclamation",
                   "connectors", "plugins", "apis", "support_qa"}
    assert cls["type"] in valid_types, f"Fallback returned invalid type: {cls}"
```

- [ ] **Step 3: Install test dependencies locally**

```bash
cd agentic-sidecar
pip install pytest httpx
```

- [ ] **Step 4: Run fallback test only (no deployed service needed)**

```bash
cd agentic-sidecar
pytest tests/test_e2e.py::test_fallback_on_sidecar_down -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agentic-sidecar/tests/__init__.py agentic-sidecar/tests/test_e2e.py
git commit -m "test: add E2E pytest suite — sidecar + backend + workflow + fallback"
git push origin main
```

---

## Task 8: Run full E2E suite against deployed services

Run after Task 6 (Render deploy) is complete and both services show green health.

- [ ] **Step 1: Seed the database on the deployed backend**

```bash
# Option A: run seed remotely via Render shell (dashboard → claude-bot-backend → Shell)
node config/seed.js

# Option B: run locally pointing to Atlas
cd backend
MONGODB_URI="mongodb+srv://genaiinfovision_db_user:K8qEzyXD3O9VYeMq@clustermongo.xopxfj4.mongodb.net/claude_assistant_bot_mvp?retryWrites=true&w=majority&appName=ClusterMongo" node config/seed.js
```
Expected: `✅ Created 9 users` and `✅ Created 6 sample requests`

- [ ] **Step 2: Run full E2E suite**

```bash
cd agentic-sidecar
BACKEND_URL=https://claude-bot-backend.onrender.com \
AGENTIC_URL=https://claude-bot-agentic.onrender.com \
AGENTIC_API_KEY=<your-shared-key> \
TEST_USER_EMAIL=user@infovision.com \
TEST_USER_PASSWORD=password123 \
TEST_MANAGER_EMAIL=manager@infovision.com \
TEST_MANAGER_PASSWORD=password123 \
TEST_COE_EMAIL=ai.coe@infovision.com \
TEST_COE_PASSWORD=password123 \
pytest tests/test_e2e.py -v --tb=short
```

Expected output:
```
tests/test_e2e.py::test_sidecar_health          PASSED
tests/test_e2e.py::test_intent_access           PASSED
tests/test_e2e.py::test_intent_offboarding      PASSED
tests/test_e2e.py::test_intent_support          PASSED
tests/test_e2e.py::test_missing_fields_aup      PASSED
tests/test_e2e.py::test_backend_health          PASSED
tests/test_e2e.py::test_auth_and_chat           PASSED
tests/test_e2e.py::test_full_workflow           PASSED
tests/test_e2e.py::test_teams_bot_endpoint      PASSED
tests/test_e2e.py::test_fallback_on_sidecar_down PASSED

10 passed in Xs
```

- [ ] **Step 3: Final status verification**

```bash
# Confirm agentic mode is active (not shadow/off)
curl https://claude-bot-backend.onrender.com/api/requests/chat \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"I need API access"}' | python -m json.tool
```
Check `orchestration.mode` = `"on"` and `orchestration.primarySource` = `"agentic"` in the response.

---

## Summary

| Task | Files Changed | Est. Effort |
|------|--------------|-------------|
| 1 — Pin deps | `requirements.txt` | 2 min |
| 2 — .env.example | `.env.example` | 2 min |
| 3 — Groq nodes | `app.py` | 15 min |
| 4 — Dockerfile | `Dockerfile` | 3 min |
| 5 — Render config | `render.yaml` | 5 min |
| 6 — Render deploy | Dashboard (manual) | 10 min |
| 7 — E2E tests | `tests/test_e2e.py` | 10 min |
| 8 — Run E2E | Deployed services | 5 min |
