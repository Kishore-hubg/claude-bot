# Claude Assistant Bot — Full Sprint 2 Design Spec
**Date:** 2026-04-20  
**Author:** Kishore Bodelu (Infovision CoE AI/GenAI)  
**BRD Reference:** Claude AI Access Management & Assistant Bot v1.0  
**Status:** Approved — ready for implementation planning

---

## 1. Scope

This spec covers all missing BRD Phase 2 capabilities added to the existing `claude-bot/` codebase (Node.js + React + MongoDB). The existing approval state machine, RBAC, audit logging, Socket.io notifications, and web UI are preserved unchanged.

**Sub-systems implemented in this sprint:**
1. Data layer extensions (MongoDB model fields + SharePoint sync service)
2. Groq LLM service (replaces claudeService.js)
3. Email service (Nodemailer + O365 SMTP)
4. Teams Bot + Adaptive Cards (Bot Framework SDK v4)
5. Provisioning service (Anthropic org API, stubbed)
6. Workflows WF0–WF6
7. Azure deployment (Static Web Apps + App Service + Functions + Bot Service)

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture pattern | Incremental layer-by-layer (Approach A) | Zero breakage to existing working code |
| LLM inference | Groq (`llama-3.3-70b-versatile`) | Sub-second latency, CLAUDE.md default, free tier sufficient |
| Email transport | Nodemailer + Office 365 SMTP (`smtp.office365.com:587`) | Reuses existing M365 tenant, no new service |
| SharePoint sync | Graph API, feature-flagged (`SHAREPOINT_ENABLED`) | MongoDB primary; SharePoint activated when M365 admin grants |
| Deployment | Azure-native (Static Web Apps + App Service + Functions + Bot Service) | Fits existing Azure subscription, BRD §8.1 architecture |
| Cron scheduler | Azure Functions Timer Trigger | Durable, isolated, survives App Service restarts |
| Provisioning | Anthropic org API behind `provisioningService.js` stub | Real calls activated via `PROVISIONING_STUB=false` env flag |
| Teams channel | Code wired; Teams channel enable = IT admin handoff | No M365 Teams admin access available now |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AZURE INFRASTRUCTURE                        │
│                                                                 │
│  ┌──────────────────┐    ┌────────────────────────────────────┐ │
│  │ Azure Static     │    │ Azure App Service (backend)        │ │
│  │ Web Apps         │◄──►│  Express + Socket.io               │ │
│  │ (React frontend) │    │  /api/auth, /api/requests          │ │
│  └──────────────────┘    │  /api/bot ◄── Azure Bot Service   │ │
│                          │  /api/notifications                 │ │
│                          │  /api/webhooks/offboard             │ │
│                          │  /api/internal/* (cron targets)     │ │
│                          └────────────┬───────────────────────┘ │
│                                       │                         │
│  ┌────────────────────────────────────▼───────────────────────┐ │
│  │ Services Layer                                              │ │
│  │  groqService.js        ← Groq API (Llama-3.3-70b)         │ │
│  │  emailService.js       ← Nodemailer + O365 SMTP            │ │
│  │  sharepointService.js  ← Graph API (feature-flagged)       │ │
│  │  provisioningService.js← Anthropic org API (stubbed)       │ │
│  │  workflowService.js    ← state machine (extended)          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Azure Functions App (Timer Triggers)                        │ │
│  │  wf2-idle/         CRON: 0 30 0 * * *  (06:00 IST)        │ │
│  │  wf4-cost-alert/   CRON: 0 30 1 * * *  (07:00 IST)        │ │
│  │  wf5-compliance/   CRON: 0 30 20 * * 0 (Mon 02:00 IST)    │ │
│  │  wf6-quarterly/    CRON: 0 0 18 1 0,3,6,9 *               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  MongoDB Atlas │ Azure Bot Service │ Azure Key Vault            │
│  SharePoint (Graph API, feature-flagged)                        │
└─────────────────────────────────────────────────────────────────┘

External: Groq API · O365 SMTP · Anthropic Org API (stub)
```

---

## 4. Data Layer

### 4.1 MongoDB — User Model Additions

```js
employeeId:           { type: String, unique: true, sparse: true }
licenseType:          { type: String, enum: ['standard', 'premium'], default: null }
accessTier:           { type: String, enum: ['T1', 'T2', 'T3'], default: null }
costCenter:           String
managerId:            { type: ObjectId, ref: 'User' }
managerEmail:         String
aupAcknowledged:      { type: Boolean, default: false }
aupAcknowledgedAt:    Date
dateProvisioned:      Date
lastActiveDate:       Date    // polled by WF2 from Anthropic API
idleWarningSentAt:    Date    // set when WF2 sends warning; deprovision fires when sentAt + 8 days < now (total: 30-day inactivity detection + 8 calendar days grace = 38 days from last active)
teamsConversationId:  String  // captured on first Teams DM; used for proactive card delivery
```

New role added to enum: `ai_coe_lead` (required for A2 upgrade approval chain).

### 4.2 MongoDB — Request Model Additions

```js
employeeId:          String    // snapshot at submission time
clientProject:       Boolean   // DLP pre-clearance flag
sowNumber:           String
dataSensitivity:     String
aupConfirmed:        { type: Boolean, default: false }  // gate for WF1
licenseType:         String
accessTier:          String
emailActionUsedAt:   Date      // set on first use of email approve/reject link; prevents reuse
```

Request type enum expanded from 6 → 9:
```js
enum: [
  'access',           // A1: new Claude license
  'upgrade',          // A2: tier upgrade Standard→Premium  [NEW]
  'skills',           // A3: certification/skill
  'offboarding',      // A4: access revocation              [NEW]
  'idle_reclamation', // A5: automated idle (system-only)   [NEW]
  'connectors',       // A6: integration setup
  'plugins',          // A7: plugin deployment
  'apis',             // A8: API access/quota
  'support_qa'        // A9: support issue
]
```

### 4.3 Approval Chains (updated)

```js
const APPROVAL_CHAINS = {
  access:           ['manager', 'admin'],                      // A1
  upgrade:          ['manager', 'ai_coe_lead', 'it_governance'], // A2 [NEW]
  skills:           ['manager'],                               // A3
  offboarding:      ['admin'],                                 // A4 (<2hr SLA)
  idle_reclamation: [],                                        // A5 (fully automated)
  connectors:       ['tech_lead', 'admin'],                    // A6
  plugins:          ['cto', 'admin'],                          // A7
  apis:             ['architect', 'admin'],                    // A8
  support_qa:       ['support']                                // A9
};
```

### 4.4 SharePoint Service (`sharepointService.js`)

Feature-flagged via `SHAREPOINT_ENABLED=true/false`.

**Operations:**
- `checkDuplicate(employeeId, licenseType)` — reads Excel row via Graph API; falls back to MongoDB if flag off
- `syncProvisionedUser(userData)` — writes new row to Excel after WF1; no-op if flag off

**Graph API scopes required:** `Sites.ReadWrite.All`, `Files.ReadWrite.All`

MongoDB is always the authoritative source of truth. SharePoint is write-through sync only.

---

## 5. Groq LLM Service (`groqService.js`)

Replaces `claudeService.js`. Identical public method signatures — no route changes needed.

**Model:** `llama-3.3-70b-versatile` (primary), `mixtral-8x7b-32768` (fallback on quota)

**Methods:**
```js
classifyAndExtract(userMessage, conversationHistory)  → JSON classification
generateUserResponse(classification, requestContext)   → string
generateApprovalMessage(request, approverRole)         → string  // called in emailService.approvalRequest() to generate the email body
answerSupportQuestion(question, context)               → string  // called for support_qa type in routes/requests.js chat handler
```

**Classification extended to 9 types (A1–A9).** A1 `access` type extraction must include BRD §4.1 fields: `employeeId`, `businessUnit`, `costCenter`, `licenseType`, `accessTier`, `dateRequiredBy`, `businessJustification`, `clientProject`, `sowNumber`, `dataSensitivity`, `aupConfirmed`.

`aupConfirmed` is extracted as a Boolean from explicit user language. The classification system prompt instructs Groq: set `aupConfirmed: true` only if the user's message contains an explicit acknowledgement of the Acceptable Use Policy (e.g., "I agree to the AUP", "I confirm", "I accept the policy"). If no explicit confirmation is found, set `aupConfirmed: false` and add `"aupConfirmed"` to `missingFields`, triggering a clarification question: "Before I can process your request, please confirm you have read and agree to InfoVision's Claude Acceptable Use Policy (AI-001)."

**Error handling:** Groq API unavailable → circuit breaker → `system_alert` notification to admin → email fallback.

---

## 6. Email Service (`emailService.js`)

**Transport:** Nodemailer, `smtp.office365.com:587`, STARTTLS, O365 app password.

**Templates (8 total):**

| Template | Trigger | Recipient |
|---|---|---|
| `approvalRequest` | WF0 — manager approval needed | manager |
| `aupAcknowledgement` | WF1 — account provisioned | requester |
| `requestApproved` | Final approval | requester |
| `requestRejected` | Any rejection | requester |
| `idleWarning` | WF2 — 30-day inactive | inactive user |
| `offboardingConfirm` | WF3 — revocation complete | HR + requester |
| `costAnomaly` | WF4 — >150% spend spike | claude-admin |
| `complianceReport` | WF5 — weekly scan | ai.coe.lead |
| `quarterlyOptimization` | WF6 — tier recommendations | ai.coe.lead |

**One-click approve/reject links** in `approvalRequest` email:
```
GET /api/requests/:id/email-action?token=<jwt>&decision=approved
```
Token: JWT signed with `EMAIL_ACTION_SECRET`, expires **7 days** (approval decisions are time-sensitive; expired links prompt re-send). Token encodes `{ requestId, approverId, decision, iat }`. The token is the sole authentication mechanism — no session required (standard email-link pattern used by GitHub, Jira, etc.; tokens are single-use and signed).

**Single-use enforcement:** Add `emailActionUsedAt: Date` field to the Request model. Handler checks: if `request.emailActionUsedAt` is set → return 409 "Link already used". On success → set `request.emailActionUsedAt = new Date()` atomically via `findOneAndUpdate` with `emailActionUsedAt: { $exists: false }` filter (prevents race condition).

Server-side handler steps: (1) verify JWT signature, (2) check `emailActionUsedAt` not set (conflict = 409), (3) confirm `approverId` from token matches `approvalSteps[currentApprovalStep].approver` — mismatch = 403, (4) call `workflowService.processApproval()`, (5) redirect to confirmation page.

Token passed as query parameter (`?token=<jwt>`) — standard pattern for email links; POST is not possible since email clients follow GET links. Tokens are single-use and time-bound, mitigating query-parameter exposure risk.

HTML templates use inline styles only (Outlook-compatible).

---

## 7. Teams Bot (`backend/bot/`)

### Files
```
backend/bot/
  botAdapter.js    ← BotFrameworkAdapter, error handler
  teamsBot.js      ← ActivityHandler, routes to groqService
  adaptiveCards.js ← 6 card template factory functions
```

New Express route: `POST /api/bot` (receives all Teams activity events).

### Message Flow
```
Teams DM → Azure Bot Service → POST /api/bot
  → BotFrameworkAdapter.processActivity()
    → TeamsBot.onMessage()
      → groqService.classifyAndExtract()
        → duplicate check
          → Request.create() + workflowService.initiateWorkflow()
            → emailService.approvalRequest()
            → sendAdaptiveCard() to manager
```

### Adaptive Cards (6 types, schema v1.4)

| Card | Actions |
|---|---|
| `approvalCard` | Approve / Reject / Ask Question |
| `confirmationCard` | View Status |
| `statusCard` | — |
| `idleWarningCard` | Keep Access / Acknowledge |
| `costAlertCard` | View Dashboard |
| `rejectionCard` | Resubmit / Close |

### Proactive Messaging

`teamsBot.sendProactiveCard(userId, card)` method contract:
```js
// userId: MongoDB User._id string
// card: Adaptive Card JSON object from adaptiveCards.*()
// Returns: Promise<void>
// Behavior:
//   1. Load User.teamsConversationId from DB
//   2. If null or TEAMS_ENABLED=false → log warning, return (silent fallback; caller handles email)
//   3. If set → adapter.continueConversation(conversationRef, ctx => ctx.sendActivity({ attachments: [card] }))
//   4. On Teams API error → catch, log, return (never throws — caller always sends email as backup)
```
`teamsConversationId` is saved to the User document inside `TeamsBot.onMessage()` on first DM activity via `context.activity.conversation.id`.

### Fallback
`TEAMS_ENABLED=false` → all notifications fall back to email. No lost approvals.

### IT Admin Handoff
Azure Bot Service registration is code-complete. Teams channel activation requires IT admin:
1. Azure Portal → Bot Services → Channels → Microsoft Teams → Enable
2. Upload Teams app manifest to Teams Admin Center

---

## 8. Provisioning Service (`services/provisioningService.js`)

```js
class ProvisioningService {
  createAccount({ employeeId, email, licenseType, accessTier })  → { success, claudeUserId, provisionedAt }
  upgradeAccount({ claudeUserId, newTier })                       → { success }
  revokeAccount({ claudeUserId })                                 → { success }
  getLastActiveDate({ claudeUserId })                             → Date  // stub returns new Date(Date.now() - 35*24*60*60*1000) (35 days ago)
  getUsageCost({ startDate, endDate })
    → { totalUSD: number, byUser: [{ claudeUserId, email, costUSD, tokensUsed }] }
    // WF4 uses totalUSD for spike detection; WF6 iterates byUser[] per-user for tier scoring
    // stub returns mock data with 2 users and randomised costs
}
```

`PROVISIONING_STUB=true` → mock responses. Flip to `false` when Anthropic org token available.

---

## 9. Workflows WF0–WF6

### In-Process (Express backend, `backend/workflows/`)

**WF0 — Account Request** (`wf0-accountRequest.js`)
- Trigger: A1 `access` type classified by Groq; called from `routes/requests.js` POST `/api/requests/chat` after `classifyAndExtract()`, replacing the current inline `Request.create()` block
- AUP gate: check `classification.extractedFields.aupConfirmed !== true` — this comes from Groq's field extraction of the user's conversation BEFORE any DB write. Reject with error response if false.
- Duplicate check: call `sharepointService.checkDuplicate(employeeId, licenseType)`. Inside `checkDuplicate()`: if `SHAREPOINT_ENABLED=true` → query SharePoint Excel row (returns row if employee already provisioned). If `SHAREPOINT_ENABLED=false`, run BOTH MongoDB queries and reject if EITHER returns true: (a) `User.findOne({ employeeId, licenseType: { $ne: null } })` — catches already-provisioned users; (b) `Request.exists({ 'details.employeeId': employeeId, type: 'access', status: { $in: ['pending_approval','approved','deployed'] } })` — catches in-flight requests. Both checked; either positive = duplicate. `checkDuplicate()` returns `{ isDuplicate: boolean, reason: string }`.
- On pass: `Request.create()` → `workflowService.initiateWorkflow()` → `emailService.approvalRequest(manager)` → `teamsBot.sendAdaptiveCard(manager, approvalCard)` (Teams card only if `TEAMS_ENABLED=true`)

**WF1 — Auto-Provisioning** (`wf1-provisioning.js`)
- Trigger: called from `workflowService.processApproval()` at the point where `triggerDeployment(request)` is currently invoked (line ~187 of existing workflowService.js). `triggerDeployment()` is deleted and replaced with `wf1.run(request)`.
- Pre-condition: `wf1.run(request)` receives an already-populated Mongoose doc. The `processApproval()` function in `workflowService.js` already calls `.populate('requester approvalSteps.approver')` before invoking `triggerDeployment()`. `wf1.run()` must NOT re-query — it uses `request.requester._id` (ObjectId) for DB updates and `request.requester.email` (string) for email delivery directly from the populated subdoc.
- Actions (sequential, all awaited): `provisioningService.createAccount({ employeeId: request.details.employeeId, email: request.requester.email, licenseType: request.details.licenseType, accessTier: request.details.accessTier })` → `emailService.aupAcknowledgement(request.requester)` → `User.findByIdAndUpdate(request.requester._id, { dateProvisioned: new Date(), licenseType: request.details.licenseType, accessTier: request.details.accessTier, aupAcknowledged: true, aupAcknowledgedAt: new Date() })` → `sharepointService.syncProvisionedUser(userData)` (no-op if disabled) → notify admin: `adminUser = await User.findOne({ role: 'admin', isActive: true })` → `try { await teamsBot.sendProactiveCard(adminUser._id.toString(), confirmationCard) } catch { await emailService.requestApproved(adminUser) }` (explicit try/catch so any Teams failure — not just null conversationId — falls back to email)
- The `setTimeout(5000)` stub in `triggerDeployment()` is removed entirely

**WF3 — Offboarding Sync** (`wf3-offboarding.js`)
- Trigger: `POST /api/webhooks/offboard` (HR webhook)
- SLA: synchronous, completes < 2 hours
- Actions: find all active licenses → `provisioningService.revokeAccount()` each → archive audit logs → email HR + manager

### Azure Functions Timer Triggers (`azure-functions/`)

All functions call backend `/api/internal/*` with `Authorization: Bearer <INTERNAL_CRON_SECRET>`.

| Function | CRON (UTC) | IST | Backend endpoint |
|---|---|---|---|
| `wf2-idle-reclamation` | `0 30 0 * * *` | 06:00 | `POST /api/internal/wf2` |
| `wf4-cost-anomaly` | `0 30 1 * * *` | 07:00 | `POST /api/internal/wf4` |
| `wf5-compliance-scan` | `0 30 20 * * 0` | Mon 02:00 | `POST /api/internal/wf5` |
| `wf6-quarterly-opt` | `0 0 18 1 0,3,6,9 *` | 1st Jan/Apr/Jul/Oct | `POST /api/internal/wf6` |

**WF2 — Idle Reclamation:** Two-phase logic runs daily:
- Phase 1 (warning): query `User.find({ licenseType: { $ne: null }, idleWarningSentAt: null })` → for each, call `provisioningService.getLastActiveDate({ claudeUserId })` → if inactive 30+ days → send Teams `idleWarningCard` + `emailService.idleWarning()` → set `User.idleWarningSentAt = new Date()`
- Phase 2 (deprovision): query `User.find({ idleWarningSentAt: { $lte: new Date(Date.now() - 8*24*60*60*1000) } })` → for each → `provisioningService.revokeAccount()` → update User: clear `licenseType`, `accessTier`, reset `idleWarningSentAt = null` → `emailService.offboardingConfirm()` to Finance + user

**WF4 — Cost Anomaly:** `getUsageCost()` today vs 30-day average → >150% spike → `costAnomaly` email + Teams card → >200% → auto-pause API key.

**WF5 — Compliance Scan:** Active MongoDB users vs provisioned registry → flag bypassed → `complianceReport` email to AI CoE Lead.

**WF6 — Quarterly Optimization:** 90-day usage per user via `provisioningService.getUsageCost()` → utilization score → tier change recommendations → send `emailService.quarterlyOptimization()` to AI CoE Lead. Approve/reject links in this email use a **public** endpoint (accessed via browser click from email — NOT under `/api/internal/` which uses `cronAuth`):
```
GET /api/wf6/apply-tier-change?token=<jwt>&decision=approve|reject
```
- Registered in a new `routes/wf6.js`, mounted at `/api/wf6` in `server.js` (no cronAuth — JWT is auth)
- Token: JWT signed with `EMAIL_ACTION_SECRET`, encodes `{ userId, recommendedTier, generatedAt }`, expires **30 days** (longer than approval tokens — quarterly reports need full review cycle; tier changes are reversible)
- Handler: verify JWT signature → verify `recommendedTier` is valid enum value → call `provisioningService.upgradeAccount({ claudeUserId, newTier })` → `User.findByIdAndUpdate(userId, { licenseType, accessTier })` → redirect to static confirmation page
- On reject decision: log and redirect to confirmation page with "no action taken" message

**Internal routes auth middleware** (applied to all `/api/internal/*` in `routes/internal.js`):
```js
const cronAuth = (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_CRON_SECRET}`)
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  next();
};
router.use(cronAuth);
```

**Two distinct Azure AD registrations:**
1. **Bot Framework App** (registered in Azure Bot Service): provides `TEAMS_APP_ID` + `TEAMS_APP_PASSWORD`. Used by `botAdapter.js` to authenticate the bot with Azure Bot Service and Teams. No Graph scopes needed.
2. **Graph API App** (separate Azure AD app registration): provides `GRAPH_CLIENT_ID` + `GRAPH_CLIENT_SECRET`. Used by `sharepointService.js` for SharePoint Excel read/write. Scopes: `Sites.ReadWrite.All`, `Files.ReadWrite.All`. This app is NOT used for Teams messaging — all Teams communication goes through the Bot Framework App.

---

## 10. Azure Deployment

### Repository Structure

```
claude-bot/
├── backend/                      ← Azure App Service
│   ├── bot/
│   │   ├── botAdapter.js
│   │   ├── teamsBot.js
│   │   └── adaptiveCards.js
│   ├── services/
│   │   ├── groqService.js        ← replaces claudeService.js
│   │   ├── emailService.js       ← NEW
│   │   ├── sharepointService.js  ← NEW
│   │   └── provisioningService.js← NEW
│   ├── workflows/
│   │   ├── wf0-accountRequest.js
│   │   ├── wf1-provisioning.js
│   │   └── wf3-offboarding.js
│   └── routes/
│       ├── internal.js           ← NEW: /api/internal/* (cronAuth protected)
│       └── wf6.js                ← NEW: /api/wf6/* (JWT protected, public email-link endpoint)
├── azure-functions/              ← Azure Functions App
│   ├── host.json
│   ├── package.json
│   ├── wf2-idle-reclamation/
│   ├── wf4-cost-anomaly/
│   ├── wf5-compliance-scan/
│   └── wf6-quarterly-opt/
├── frontend/                     ← Azure Static Web Apps
│   └── staticwebapp.config.json  ← NEW
├── infra/
│   ├── deploy-backend.sh
│   ├── deploy-functions.sh
│   ├── keyvault-setup.sh
│   └── TEAMS_SETUP.md            ← IT admin handoff guide
└── .github/workflows/
    ├── deploy-backend.yml
    ├── deploy-frontend.yml
    └── deploy-functions.yml
```

### Azure Resources

| Resource | Tier | Purpose |
|---|---|---|
| Azure App Service | B1 | Express backend + Socket.io |
| Azure Static Web Apps | Free | React frontend |
| Azure Bot Service | F0 | Teams bot registration |
| Azure Functions | Consumption | WF2/WF4/WF5/WF6 cron |
| Azure Key Vault | Standard | All secrets |
| MongoDB Atlas | M10 | Primary database |

### Key Environment Variables

```bash
# LLM
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

# Email
EMAIL_USER=claude-admin@infovision.com
EMAIL_PASSWORD=                     # O365 app password
EMAIL_ACTION_SECRET=                # JWT signing for approve/reject links

# Teams Bot
TEAMS_APP_ID=
TEAMS_APP_PASSWORD=
TEAMS_TENANT_ID=
TEAMS_ENABLED=false                 # flip after IT admin enables channel

# SharePoint
SHAREPOINT_ENABLED=false            # flip after M365 admin grants permissions
SHAREPOINT_SITE_ID=
SHAREPOINT_FILE_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_TENANT_ID=

# Provisioning
PROVISIONING_STUB=true              # flip to false when Anthropic org token arrives
ANTHROPIC_ORG_TOKEN=

# Internal cron auth
INTERNAL_CRON_SECRET=

# Azure Functions → backend
BACKEND_URL=https://<app-service>.azurewebsites.net
```

### CI/CD (GitHub Actions)

Three independent pipelines on push to `main`:
- **Backend:** `az webapp deploy` to App Service
- **Frontend:** Azure Static Web Apps GitHub Action
- **Functions:** `az functionapp deployment source config-zip`

---

## 11. Security

- All secrets in Azure Key Vault; App Service pulls via managed identity
- Email action tokens: JWT, 7-day expiry, single-use enforced via `usedAt` field on Request
- Internal cron endpoints: `INTERNAL_CRON_SECRET` bearer token, not exposed in public API
- SharePoint Graph API: least-privilege app registration, scoped to single site
- `PROVISIONING_STUB=true` default prevents accidental real provisioning calls in dev
- AUP gate enforced in WF0 before any approval chain starts

---

## 12. IT Admin Handoff (documented in `infra/TEAMS_SETUP.md`)

```
Step 1: Azure Portal → Bot Services → <bot-name> → Channels → Microsoft Teams → Enable
Step 2: Grant Azure AD App: Sites.ReadWrite.All, Files.ReadWrite.All
Step 3: Set TEAMS_ENABLED=true in App Service environment variables
Step 4: Set SHAREPOINT_ENABLED=true in App Service environment variables
Step 5: Upload Teams app manifest to Teams Admin Center
Step 6: Set PROVISIONING_STUB=false + set ANTHROPIC_ORG_TOKEN when org credentials arrive
```

---

## 13. Out of Scope (This Sprint)

- Azure AD SSO (custom JWT auth remains; SSO = post-v1)
- Power BI dashboard integration (Analytics model stub remains)
- ServiceNow/Jira ticket creation for A9 (internal notification only)
- Microsoft Graph API manager hierarchy lookup (DB role lookup remains)
- WF2 Day 8 auto-deprovision (warning sent; manual deprovision until Anthropic org API live)
