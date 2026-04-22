# Full Sprint 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all missing BRD Phase 2 capabilities: Groq LLM, email notifications, SharePoint sync service, real provisioning (stubbed), Teams Bot with Adaptive Cards, WF0–WF6 workflows, and Azure deployment configs.

**Architecture:** Incremental layer-by-layer additions to existing Express + React + MongoDB codebase. New services plug in via dependency injection. Feature flags (`TEAMS_ENABLED`, `SHAREPOINT_ENABLED`, `PROVISIONING_STUB`) allow partial activation without breaking existing functionality.

**Tech Stack:** Node.js 18, Express, Mongoose 8, Groq SDK, Nodemailer, botbuilder (Bot Framework SDK v4), @microsoft/microsoft-graph-client, Jest, Azure Static Web Apps, Azure App Service, Azure Functions, Azure Bot Service.

**Spec:** `docs/superpowers/specs/2026-04-20-full-sprint2-design.md`

---

## File Map

### Backend — New Files
| File | Responsibility |
|---|---|
| `backend/services/groqService.js` | Groq API LLM: classify, extract, generate responses |
| `backend/services/emailService.js` | Nodemailer + O365 SMTP: 9 email templates |
| `backend/services/sharepointService.js` | Graph API SharePoint Excel read/write (feature-flagged) |
| `backend/services/provisioningService.js` | Anthropic org API stub: create/revoke/upgrade accounts |
| `backend/workflows/wf0-accountRequest.js` | A1 request: AUP gate + duplicate check + initiate workflow |
| `backend/workflows/wf1-provisioning.js` | Post-approval: create account + AUP email + User update + SP sync |
| `backend/workflows/wf3-offboarding.js` | HR webhook: revoke all licenses < 2 hours |
| `backend/bot/botAdapter.js` | BotFrameworkAdapter setup + error handler |
| `backend/bot/adaptiveCards.js` | 6 Adaptive Card template factory functions |
| `backend/bot/teamsBot.js` | ActivityHandler: routes Teams messages to groqService + WF0 |
| `backend/routes/internal.js` | `/api/internal/*`: cron-secret-protected WF2/WF4/WF5/WF6 endpoints |
| `backend/routes/wf6.js` | `/api/wf6/*`: JWT-protected WF6 tier-change email-link endpoint |
| `backend/tests/groqService.test.js` | Jest unit tests for classification + extraction |
| `backend/tests/emailService.test.js` | Jest unit tests for template rendering |
| `backend/tests/sharepointService.test.js` | Jest unit tests for duplicate check logic |
| `backend/tests/provisioningService.test.js` | Jest unit tests for stub responses |
| `backend/tests/wf0.test.js` | Jest integration tests for WF0 AUP gate + duplicate check |
| `backend/tests/wf1.test.js` | Jest unit tests for WF1 provisioning flow |

### Backend — Modified Files
| File | Changes |
|---|---|
| `backend/models/User.js` | +11 fields: employeeId, licenseType, accessTier, costCenter, managerId, managerEmail, aupAcknowledged, aupAcknowledgedAt, dateProvisioned, lastActiveDate, idleWarningSentAt, teamsConversationId; +role `ai_coe_lead` |
| `backend/models/Request.js` | +7 fields: employeeId, clientProject, sowNumber, dataSensitivity, aupConfirmed, licenseType, accessTier, emailActionUsedAt; +types upgrade/offboarding/idle_reclamation |
| `backend/services/workflowService.js` | Update APPROVAL_CHAINS (9 types); replace triggerDeployment() with wf1.run() |
| `backend/routes/requests.js` | Wire POST /chat to WF0; add GET /email-action endpoint; add POST /webhooks/offboard |
| `backend/server.js` | Mount /api/bot, /api/internal, /api/wf6 routes |
| `backend/package.json` | Add: groq-sdk, nodemailer, botbuilder, @microsoft/microsoft-graph-client, jest |
| `backend/.env` | Add all new env vars |

### Azure Functions — New Directory
| File | Responsibility |
|---|---|
| `azure-functions/host.json` | Functions runtime config |
| `azure-functions/package.json` | Functions dependencies (axios) |
| `azure-functions/wf2-idle-reclamation/function.json` | CRON trigger config |
| `azure-functions/wf2-idle-reclamation/index.js` | POST to /api/internal/wf2 |
| `azure-functions/wf4-cost-anomaly/function.json` | CRON trigger config |
| `azure-functions/wf4-cost-anomaly/index.js` | POST to /api/internal/wf4 |
| `azure-functions/wf5-compliance-scan/function.json` | CRON trigger config |
| `azure-functions/wf5-compliance-scan/index.js` | POST to /api/internal/wf5 |
| `azure-functions/wf6-quarterly-opt/function.json` | CRON trigger config |
| `azure-functions/wf6-quarterly-opt/index.js` | POST to /api/internal/wf6 |

### Deployment — New Files
| File | Responsibility |
|---|---|
| `frontend/staticwebapp.config.json` | Azure Static Web Apps routing + API proxy |
| `infra/deploy-backend.sh` | Azure App Service deploy script |
| `infra/deploy-functions.sh` | Azure Functions deploy script |
| `infra/keyvault-setup.sh` | Key Vault secrets provisioning |
| `infra/TEAMS_SETUP.md` | IT admin handoff guide |
| `.github/workflows/deploy-backend.yml` | GitHub Actions: backend CI/CD |
| `.github/workflows/deploy-frontend.yml` | GitHub Actions: frontend CI/CD |
| `.github/workflows/deploy-functions.yml` | GitHub Actions: functions CI/CD |

---

## Phase 1 — Dependencies + Model Changes

### Task 1: Install Backend Dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install new packages**

```bash
cd backend
npm install groq-sdk nodemailer botbuilder @azure/bot-framework-connector \
  @microsoft/microsoft-graph-client isomorphic-fetch \
  --save
npm install jest --save-dev
```

- [ ] **Step 2: Add test script to package.json**

Edit `backend/package.json` scripts:
```json
"test": "jest --testPathPattern=tests/ --forceExit",
"test:watch": "jest --testPathPattern=tests/ --watch"
```

Also add Jest config at end of package.json:
```json
"jest": {
  "testEnvironment": "node",
  "setupFiles": ["./tests/setup.js"]
}
```

- [ ] **Step 3: Create test setup file**

Create `backend/tests/setup.js`:
```js
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.EMAIL_ACTION_SECRET = 'test-email-secret';
process.env.INTERNAL_CRON_SECRET = 'test-cron-secret';
process.env.GROQ_API_KEY = 'test-groq-key';
process.env.TEAMS_ENABLED = 'false';
process.env.SHAREPOINT_ENABLED = 'false';
process.env.PROVISIONING_STUB = 'true';
```

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/tests/setup.js
git commit -m "chore: add groq-sdk, nodemailer, botbuilder, jest dependencies"
```

---

### Task 2: Update User Model

**Files:**
- Modify: `backend/models/User.js`

- [ ] **Step 1: Write failing test**

Create `backend/tests/userModel.test.js`:
```js
const mongoose = require('mongoose');
const User = require('../models/User');

describe('User model new fields', () => {
  it('has employeeId field', () => {
    const u = new User({ name: 'Test', email: 'test@test.com', password: 'pass1234' });
    expect(u.schema.paths.employeeId).toBeDefined();
  });

  it('has ai_coe_lead in role enum', () => {
    const roleEnum = User.schema.paths.role.enumValues;
    expect(roleEnum).toContain('ai_coe_lead');
  });

  it('has idleWarningSentAt field', () => {
    expect(User.schema.paths.idleWarningSentAt).toBeDefined();
  });

  it('has teamsConversationId field', () => {
    expect(User.schema.paths.teamsConversationId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=userModel
```
Expected: FAIL — fields not found.

- [ ] **Step 3: Update User model**

In `backend/models/User.js`, add to `userSchema` after `notificationPreferences`:
```js
// BRD §4.1 — required inventory fields
employeeId:          { type: String, unique: true, sparse: true, index: true },
licenseType:         { type: String, enum: ['standard', 'premium'], default: null },
accessTier:          { type: String, enum: ['T1', 'T2', 'T3'], default: null },
costCenter:          { type: String, trim: true },
managerId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
managerEmail:        { type: String, lowercase: true },
aupAcknowledged:     { type: Boolean, default: false },
aupAcknowledgedAt:   Date,
dateProvisioned:     Date,
lastActiveDate:      Date,
idleWarningSentAt:   Date,
teamsConversationId: String,
```

Change role enum to add `'ai_coe_lead'` and `'it_governance'`:
```js
role: {
  type: String,
  enum: ['requester', 'manager', 'tech_lead', 'architect', 'admin',
         'support', 'cto', 'ai_coe_lead', 'it_governance'],
  default: 'requester'
},
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=userModel
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/models/User.js backend/tests/userModel.test.js
git commit -m "feat: add BRD §4.1 fields and ai_coe_lead role to User model"
```

---

### Task 3: Update Request Model

**Files:**
- Modify: `backend/models/Request.js`

- [ ] **Step 1: Write failing test**

Create `backend/tests/requestModel.test.js`:
```js
const Request = require('../models/Request');

describe('Request model extensions', () => {
  it('has upgrade, offboarding, idle_reclamation in type enum', () => {
    const types = Request.schema.paths.type.enumValues;
    expect(types).toContain('upgrade');
    expect(types).toContain('offboarding');
    expect(types).toContain('idle_reclamation');
  });

  it('has emailActionUsedAt field', () => {
    expect(Request.schema.paths.emailActionUsedAt).toBeDefined();
  });

  it('has aupConfirmed field defaulting to false', () => {
    const r = new Request({ type: 'access', title: 't', description: 'd', requester: new (require('mongoose').Types.ObjectId)() });
    expect(r.aupConfirmed).toBe(false);
  });

  it('has clientProject boolean field', () => {
    expect(Request.schema.paths.clientProject).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=requestModel
```

- [ ] **Step 3: Update Request model**

In `backend/models/Request.js`:

Update type enum:
```js
type: {
  type: String,
  enum: ['access', 'upgrade', 'skills', 'offboarding', 'idle_reclamation',
         'connectors', 'plugins', 'apis', 'support_qa'],
  required: [true, 'Request type is required']
},
```

Add new fields after `details`:
```js
// BRD §4.2 — A1-specific extracted fields
employeeId:       String,
clientProject:    { type: Boolean, default: false },
sowNumber:        String,
dataSensitivity:  String,
aupConfirmed:     { type: Boolean, default: false },
licenseType:      String,
accessTier:       String,

// Email action single-use enforcement
emailActionUsedAt: Date,
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=requestModel
```

- [ ] **Step 5: Update APPROVAL_CHAINS in workflowService.js**

In `backend/services/workflowService.js`, replace the APPROVAL_CHAINS const:
```js
const APPROVAL_CHAINS = {
  access:           ['manager', 'admin'],
  upgrade:          ['manager', 'ai_coe_lead', 'it_governance'],
  skills:           ['manager'],
  offboarding:      ['admin'],
  idle_reclamation: [],
  connectors:       ['tech_lead', 'admin'],
  plugins:          ['cto', 'admin'],
  apis:             ['architect', 'admin'],
  support_qa:       ['support']
};
```

- [ ] **Step 6: Commit**

```bash
git add backend/models/Request.js backend/services/workflowService.js backend/tests/requestModel.test.js
git commit -m "feat: add 3 new request types, BRD fields, emailActionUsedAt to Request model"
```

---

## Phase 2 — Groq LLM Service

### Task 4: Create groqService.js

**Files:**
- Create: `backend/services/groqService.js`
- Create: `backend/tests/groqService.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/groqService.test.js`:
```js
const groqService = require('../services/groqService');

// Mock the Groq SDK
jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({
            type: 'access',
            confidence: 0.95,
            title: 'New Claude License Request',
            extractedFields: {
              employeeId: 'EMP001',
              licenseType: 'standard',
              accessTier: 'T2',
              aupConfirmed: true,
              businessJustification: 'Need Claude for analytics'
            },
            missingFields: [],
            clarificationQuestion: null,
            suggestedApprovers: ['manager', 'admin']
          }) } }]
        })
      }
    }
  }));
});

describe('GroqService', () => {
  it('classifyAndExtract returns valid JSON classification', async () => {
    const result = await groqService.classifyAndExtract('I need Claude access', []);
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('extractedFields');
    expect(['access','upgrade','skills','offboarding','idle_reclamation',
            'connectors','plugins','apis','support_qa']).toContain(result.type);
  });

  it('classifyAndExtract extracts aupConfirmed field', async () => {
    const result = await groqService.classifyAndExtract('I agree to AUP, need Claude standard T2', []);
    expect(result.extractedFields).toHaveProperty('aupConfirmed');
  });

  it('generateUserResponse returns non-empty string', async () => {
    jest.spyOn(groqService, 'chat').mockResolvedValue('Your request has been submitted.');
    const result = await groqService.generateUserResponse({ type: 'access', title: 'Test', extractedFields: {}, missingFields: [] }, {});
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=groqService
```

- [ ] **Step 3: Create groqService.js**

Create `backend/services/groqService.js`:
```js
const Groq = require('groq-sdk');

/**
 * Groq LLM Service — replaces claudeService.js
 * Identical public method signatures. No route changes needed.
 * Model: llama-3.3-70b-versatile (primary), mixtral-8x7b-32768 (fallback)
 */
class GroqService {
  constructor() {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    this.fallbackModel = 'mixtral-8x7b-32768';
  }

  async chat(messages, systemPrompt, useFallback = false) {
    try {
      const response = await this.client.chat.completions.create({
        model: useFallback ? this.fallbackModel : this.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 1500,
        temperature: 0.1
      });
      return response.choices[0].message.content;
    } catch (err) {
      if (!useFallback && err.status === 429) {
        // Quota exceeded — retry with fallback model
        return this.chat(messages, systemPrompt, true);
      }
      throw err;
    }
  }

  async classifyAndExtract(userMessage, conversationHistory = []) {
    const systemPrompt = `You are an intelligent request classification assistant for InfoVision's Claude Assistant Bot.

Classify user messages into one of these request types:
- access: New Claude AI license request (A1)
- upgrade: License tier upgrade Standard→Premium (A2)
- skills: Professional skills/certification addition (A3)
- offboarding: Access revocation request (A4)
- connectors: Tool/platform integration setup (A6)
- plugins: Plugin deployment request (A7)
- apis: API access/quota request (A8)
- support_qa: Support issue or how-to question (A9)

For "access" type, extract these BRD §4.1 fields:
employeeId, businessUnit, costCenter, licenseType (standard|premium),
accessTier (T1|T2|T3), dateRequiredBy (YYYY-MM-DD), businessJustification,
clientProject (boolean), sowNumber, dataSensitivity, aupConfirmed (boolean).

Set aupConfirmed: true ONLY if user explicitly states agreement to AUP/Acceptable Use Policy.
If aupConfirmed is false or missing, add "aupConfirmed" to missingFields and set:
clarificationQuestion: "Before I process your request, please confirm you have read and agree to InfoVision's Claude Acceptable Use Policy (AI-001). Type 'I agree to the AUP' to confirm."

Respond ONLY with valid JSON:
{
  "type": "<type>",
  "confidence": <0-1>,
  "title": "<brief title>",
  "extractedFields": { <all extracted fields> },
  "missingFields": ["<field1>"],
  "clarificationQuestion": "<question or null>",
  "suggestedApprovers": ["<role1>"]
}`;

    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const text = await this.chat(messages, systemPrompt);
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  }

  async generateUserResponse(classification, requestContext) {
    const systemPrompt = `You are a friendly, professional assistant for InfoVision's internal request management system.
Generate clear, helpful responses that:
- Confirm what you understood from the user's request
- Ask for missing information naturally (one question at a time)
- Provide realistic expectations about approval timeline
- Are concise (2-4 sentences max)
Do not use bullet points. Write in conversational prose.`;

    const userMessage = `Generate a response for:
Type: ${classification.type}
Title: ${classification.title}
Extracted: ${JSON.stringify(classification.extractedFields)}
Missing: ${JSON.stringify(classification.missingFields)}
Clarification: ${classification.clarificationQuestion || 'None'}
Context: ${JSON.stringify(requestContext)}`;

    return this.chat([{ role: 'user', content: userMessage }], systemPrompt);
  }

  // Called by emailService.approvalRequest() to generate the email body
  async generateApprovalMessage(request, approverRole) {
    const systemPrompt = `You are a professional notification writer for InfoVision's approval workflow system.
Create a clear, concise approval request message. Write in professional business prose.`;

    const userMessage = `Generate an approval notification for:
Approver Role: ${approverRole}
Request Type: ${request.type}
Title: ${request.title}
Requester: ${request.requester?.name}
Details: ${JSON.stringify(request.details)}
Priority: ${request.priority}
Reference ID: ${request.referenceId}`;

    return this.chat([{ role: 'user', content: userMessage }], systemPrompt);
  }

  // Called in routes/requests.js chat handler for support_qa type
  async answerSupportQuestion(question, context) {
    const systemPrompt = `You are InfoVision's internal support assistant.
Answer questions clearly based on general IT and software knowledge.
If you cannot provide a definitive answer, say so and explain a support ticket will be created.
Keep responses concise and actionable.`;

    return this.chat(
      [{ role: 'user', content: `Context: ${context}\n\nQuestion: ${question}` }],
      systemPrompt
    );
  }
}

module.exports = new GroqService();
```

- [ ] **Step 4: Update routes/requests.js to use groqService**

In `backend/routes/requests.js`, replace:
```js
const claudeService = require('../services/claudeService');
```
With:
```js
const groqService = require('../services/groqService');
```

Replace all `claudeService.` calls with `groqService.`

- [ ] **Step 5: Run tests — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=groqService
```

- [ ] **Step 6: Commit**

```bash
git add backend/services/groqService.js backend/routes/requests.js backend/tests/groqService.test.js
git commit -m "feat: add groqService.js (Llama-3.3-70b), replace claudeService"
```

---

## Phase 3 — Email Service

### Task 5: Create emailService.js

**Files:**
- Create: `backend/services/emailService.js`
- Create: `backend/tests/emailService.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/emailService.test.js`:
```js
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' })
  })
}));

const emailService = require('../services/emailService');

describe('emailService', () => {
  const mockUser = { name: 'Jane User', email: 'jane@infovision.com' };
  const mockRequest = { referenceId: 'REQ-2026-00001', type: 'access', title: 'Test', priority: 'high' };

  it('approvalRequest sends email without throwing', async () => {
    await expect(emailService.approvalRequest(mockUser, mockRequest, 'approve-link', 'reject-link')).resolves.not.toThrow();
  });

  it('aupAcknowledgement sends email without throwing', async () => {
    await expect(emailService.aupAcknowledgement({ ...mockUser, licenseType: 'standard', accessTier: 'T2' })).resolves.not.toThrow();
  });

  it('idleWarning sends email without throwing', async () => {
    await expect(emailService.idleWarning({ ...mockUser, lastActiveDate: new Date() })).resolves.not.toThrow();
  });

  it('requestRejected sends email without throwing', async () => {
    await expect(emailService.requestRejected(mockUser, mockRequest, 'No budget')).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=emailService
```

- [ ] **Step 3: Create emailService.js**

Create `backend/services/emailService.js`:
```js
const nodemailer = require('nodemailer');

/**
 * Email Service — Nodemailer + Office 365 SMTP
 * All templates use inline styles for Outlook compatibility.
 */

const transport = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

const FROM = `"Claude Assistant Bot" <${process.env.EMAIL_USER || 'claude-admin@infovision.com'}>`;

// ── Template helpers ─────────────────────────────────────────────────────────

const baseStyle = `font-family:Arial,sans-serif;max-width:600px;margin:0 auto;`;
const btnStyle = `display:inline-block;padding:10px 20px;border-radius:5px;text-decoration:none;font-weight:bold;margin:5px;`;

const wrap = (content) => `
<div style="${baseStyle}">
  <div style="background:#1e3a5f;padding:16px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">🤖 Claude Assistant Bot — InfoVision</h2>
  </div>
  <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;">
    ${content}
  </div>
  <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:16px;">
    InfoVision CoE AI/GenAI Practice · Automated notification · Do not reply
  </p>
</div>`;

const templates = {
  approvalRequest: ({ requesterName, requestType, referenceId, title, justification, priority, approveUrl, rejectUrl }) => ({
    subject: `Action Required: Approve ${requestType} Request — ${referenceId}`,
    html: wrap(`
      <h3 style="color:#111;margin-top:0;">Approval Required</h3>
      <p><strong>${requesterName}</strong> has submitted a <strong>${requestType}</strong> request that needs your approval.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px;color:#6b7280;width:140px;">Reference</td><td style="padding:6px;font-family:monospace;">${referenceId}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Title</td><td style="padding:6px;">${title}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Priority</td><td style="padding:6px;text-transform:capitalize;">${priority}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Justification</td><td style="padding:6px;">${justification || 'See request details'}</td></tr>
      </table>
      <div style="text-align:center;margin:24px 0;">
        <a href="${approveUrl}" style="${btnStyle}background:#16a34a;color:#fff;">✅ Approve</a>
        <a href="${rejectUrl}" style="${btnStyle}background:#dc2626;color:#fff;">❌ Reject</a>
      </div>
      <p style="color:#6b7280;font-size:12px;">These links expire in 7 days and are single-use.</p>`)
  }),

  aupAcknowledgement: ({ name, licenseType, accessTier }) => ({
    subject: 'Your Claude AI Access Has Been Provisioned — InfoVision',
    html: wrap(`
      <h3 style="color:#111;margin-top:0;">Welcome to Claude AI! 🎉</h3>
      <p>Hi <strong>${name}</strong>, your Claude AI access has been provisioned.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px;color:#6b7280;">License Type</td><td style="padding:6px;text-transform:capitalize;">${licenseType}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Access Tier</td><td style="padding:6px;">${accessTier}</td></tr>
      </table>
      <p>By receiving this access, you confirm you have read and agree to InfoVision's <strong>Claude Acceptable Use Policy (AI-001)</strong>.</p>
      <p style="color:#6b7280;font-size:12px;">Your license will be reviewed if inactive for 30+ days.</p>`)
  }),

  requestApproved: ({ name, referenceId, requestType }) => ({
    subject: `Request Approved: ${referenceId}`,
    html: wrap(`
      <h3 style="color:#16a34a;margin-top:0;">✅ Request Approved</h3>
      <p>Hi <strong>${name}</strong>, your <strong>${requestType}</strong> request (<code>${referenceId}</code>) has been fully approved and is being processed.</p>`)
  }),

  requestRejected: ({ name, referenceId, requestType }, reason) => ({
    subject: `Request Rejected: ${referenceId}`,
    html: wrap(`
      <h3 style="color:#dc2626;margin-top:0;">❌ Request Rejected</h3>
      <p>Hi <strong>${name}</strong>, your <strong>${requestType}</strong> request (<code>${referenceId}</code>) has been rejected.</p>
      <p><strong>Reason:</strong> ${reason || 'No reason provided. Please contact your manager.'}</p>`)
  }),

  idleWarning: ({ name, lastActiveDate, autoDeprovisionDate }) => ({
    subject: 'Action Required: Your Claude AI License Will Be Revoked in 8 Days',
    html: wrap(`
      <h3 style="color:#d97706;margin-top:0;">⚠️ Idle License Warning</h3>
      <p>Hi <strong>${name}</strong>, your Claude AI license has been inactive since <strong>${new Date(lastActiveDate).toDateString()}</strong>.</p>
      <p>If you do not use Claude by <strong>${new Date(autoDeprovisionDate).toDateString()}</strong>, your license will be automatically revoked.</p>
      <p>To keep your access, simply log in to Claude and start a conversation.</p>`)
  }),

  offboardingConfirm: ({ name, email }) => ({
    subject: `Claude Access Revoked: ${name} (${email})`,
    html: wrap(`
      <h3 style="color:#111;margin-top:0;">Access Revocation Confirmed</h3>
      <p>All Claude AI licenses and API keys for <strong>${name}</strong> (<code>${email}</code>) have been revoked.</p>
      <p>Activity logs archived for 90 days per compliance policy.</p>`)
  }),

  costAnomaly: ({ totalUSD, avgUSD, spikePercent, period }) => ({
    subject: `⚠️ Claude API Cost Spike Detected: ${spikePercent}% above average`,
    html: wrap(`
      <h3 style="color:#dc2626;margin-top:0;">⚠️ Cost Anomaly Alert</h3>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px;color:#6b7280;">Period</td><td style="padding:6px;">${period}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Today's Spend</td><td style="padding:6px;"><strong>$${totalUSD.toFixed(2)}</strong></td></tr>
        <tr><td style="padding:6px;color:#6b7280;">30-Day Average</td><td style="padding:6px;">$${avgUSD.toFixed(2)}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Spike</td><td style="padding:6px;color:#dc2626;"><strong>${spikePercent}%</strong></td></tr>
      </table>
      <p>Review usage in the admin dashboard and consider pausing high-volume API keys.</p>`)
  }),

  complianceReport: ({ activeUsers, approvedUsers, flaggedUsers, scanDate }) => ({
    subject: `Weekly Claude Compliance Scan — ${flaggedUsers} Issues Found`,
    html: wrap(`
      <h3 style="color:#111;margin-top:0;">Weekly Compliance Scan Report</h3>
      <p>Scan date: ${new Date(scanDate).toDateString()}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px;color:#6b7280;">Active Users (MongoDB)</td><td style="padding:6px;">${activeUsers}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Provisioned via Workflow</td><td style="padding:6px;">${approvedUsers}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Flagged (bypassed workflow)</td><td style="padding:6px;color:${flaggedUsers > 0 ? '#dc2626' : '#16a34a'};"><strong>${flaggedUsers}</strong></td></tr>
      </table>`)
  }),

  quarterlyOptimization: ({ recommendations, approveUrl, rejectUrl, quarter }) => ({
    subject: `Q${quarter} Claude License Optimization Recommendations`,
    html: wrap(`
      <h3 style="color:#111;margin-top:0;">Quarterly License Optimization</h3>
      <p>${recommendations.length} tier change recommendation(s) for Q${quarter}:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e5e7eb;">
        <tr style="background:#f3f4f6;">
          <th style="padding:8px;text-align:left;">User</th>
          <th style="padding:8px;text-align:left;">Current Tier</th>
          <th style="padding:8px;text-align:left;">Recommended</th>
        </tr>
        ${recommendations.map(r => `
          <tr>
            <td style="padding:8px;">${r.name}</td>
            <td style="padding:8px;">${r.currentTier}</td>
            <td style="padding:8px;">${r.recommendedTier}</td>
          </tr>`).join('')}
      </table>
      <div style="text-align:center;margin:24px 0;">
        <a href="${approveUrl}" style="${btnStyle}background:#16a34a;color:#fff;">✅ Apply All Changes</a>
        <a href="${rejectUrl}" style="${btnStyle}background:#6b7280;color:#fff;">Skip This Quarter</a>
      </div>
      <p style="color:#6b7280;font-size:12px;">Links expire in 30 days.</p>`)
  })
};

// ── Send helper ──────────────────────────────────────────────────────────────

const send = async (to, template) => {
  if (!process.env.EMAIL_USER) {
    console.warn('[emailService] EMAIL_USER not set — skipping email send');
    return;
  }
  await transport.sendMail({ from: FROM, to, ...template });
};

// ── Public API ───────────────────────────────────────────────────────────────

module.exports = {
  approvalRequest: (manager, request, approveUrl, rejectUrl) =>
    send(manager.email, templates.approvalRequest({
      requesterName: request.requester?.name || 'Requester',
      requestType: request.type,
      referenceId: request.referenceId,
      title: request.title,
      justification: request.details?.businessJustification,
      priority: request.priority,
      approveUrl,
      rejectUrl
    })),

  aupAcknowledgement: (user) =>
    send(user.email, templates.aupAcknowledgement({
      name: user.name,
      licenseType: user.licenseType || 'standard',
      accessTier: user.accessTier || 'T2'
    })),

  requestApproved: (user, request) =>
    send(user.email, templates.requestApproved({
      name: user.name,
      referenceId: request.referenceId,
      requestType: request.type
    })),

  requestRejected: (user, request, reason) =>
    send(user.email, templates.requestRejected({ name: user.name, referenceId: request.referenceId, requestType: request.type }, reason)),

  idleWarning: (user) =>
    send(user.email, templates.idleWarning({
      name: user.name,
      lastActiveDate: user.lastActiveDate,
      autoDeprovisionDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    })),

  offboardingConfirm: (user, toEmail) =>
    send(toEmail || user.email, templates.offboardingConfirm({ name: user.name, email: user.email })),

  costAnomaly: (data) =>
    send(process.env.EMAIL_USER, templates.costAnomaly(data)),

  complianceReport: (data) => {
    const coeLead = process.env.COE_LEAD_EMAIL || process.env.EMAIL_USER;
    return send(coeLead, templates.complianceReport(data));
  },

  quarterlyOptimization: (data, approveUrl, rejectUrl) => {
    const coeLead = process.env.COE_LEAD_EMAIL || process.env.EMAIL_USER;
    return send(coeLead, templates.quarterlyOptimization({ ...data, approveUrl, rejectUrl }));
  }
};
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=emailService
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/emailService.js backend/tests/emailService.test.js
git commit -m "feat: add emailService with 9 O365 SMTP templates (approvalRequest, aupAck, idleWarning, etc.)"
```

---

## Phase 4 — SharePoint + Provisioning Services

### Task 6: Create sharepointService.js

**Files:**
- Create: `backend/services/sharepointService.js`
- Create: `backend/tests/sharepointService.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/sharepointService.test.js`:
```js
// Disable SharePoint for unit tests
process.env.SHAREPOINT_ENABLED = 'false';

const sharepointService = require('../services/sharepointService');
const User = require('../models/User');
const Request = require('../models/Request');

jest.mock('../models/User');
jest.mock('../models/Request');

describe('sharepointService (SHAREPOINT_ENABLED=false)', () => {
  it('checkDuplicate returns isDuplicate:false when no existing user or request', async () => {
    User.findOne.mockResolvedValue(null);
    Request.exists.mockResolvedValue(false);
    const result = await sharepointService.checkDuplicate('EMP001', 'standard');
    expect(result).toEqual({ isDuplicate: false, reason: null });
  });

  it('checkDuplicate returns isDuplicate:true when user already provisioned', async () => {
    User.findOne.mockResolvedValue({ employeeId: 'EMP001', licenseType: 'standard' });
    Request.exists.mockResolvedValue(false);
    const result = await sharepointService.checkDuplicate('EMP001', 'standard');
    expect(result.isDuplicate).toBe(true);
  });

  it('checkDuplicate returns isDuplicate:true when in-flight request exists', async () => {
    User.findOne.mockResolvedValue(null);
    Request.exists.mockResolvedValue(true);
    const result = await sharepointService.checkDuplicate('EMP001', 'standard');
    expect(result.isDuplicate).toBe(true);
  });

  it('syncProvisionedUser is no-op when SHAREPOINT_ENABLED=false', async () => {
    await expect(sharepointService.syncProvisionedUser({ employeeId: 'EMP001' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=sharepointService
```

- [ ] **Step 3: Create sharepointService.js**

Create `backend/services/sharepointService.js`:
```js
const User = require('../models/User');
const Request = require('../models/Request');

/**
 * SharePoint Service
 * Feature-flagged via SHAREPOINT_ENABLED env var.
 * When disabled: falls back to MongoDB queries.
 * When enabled: uses Microsoft Graph API to read/write SharePoint Excel inventory.
 *
 * Graph API app registration (separate from Teams Bot app):
 *   GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID
 *   Required scopes: Sites.ReadWrite.All, Files.ReadWrite.All
 */

const isEnabled = () => process.env.SHAREPOINT_ENABLED === 'true';

// Graph API client (lazy-loaded when SharePoint enabled)
let graphClient = null;
const getGraphClient = async () => {
  if (graphClient) return graphClient;
  const { Client } = require('@microsoft/microsoft-graph-client');
  require('isomorphic-fetch');
  const { ClientSecretCredential } = require('@azure/identity');

  const credential = new ClientSecretCredential(
    process.env.GRAPH_TENANT_ID,
    process.env.GRAPH_CLIENT_ID,
    process.env.GRAPH_CLIENT_SECRET
  );

  graphClient = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      }
    }
  });
  return graphClient;
};

/**
 * Check if an employee already has an active Claude license.
 * @returns {{ isDuplicate: boolean, reason: string|null }}
 */
const checkDuplicate = async (employeeId, licenseType) => {
  if (isEnabled()) {
    return checkDuplicateSharePoint(employeeId, licenseType);
  }
  return checkDuplicateMongo(employeeId, licenseType);
};

const checkDuplicateMongo = async (employeeId, licenseType) => {
  // Check 1: already-provisioned user
  const existingUser = await User.findOne({
    employeeId,
    licenseType: { $ne: null }
  });
  if (existingUser) {
    return { isDuplicate: true, reason: `Employee ${employeeId} already has a ${existingUser.licenseType} license` };
  }

  // Check 2: in-flight request
  const inflightRequest = await Request.exists({
    'details.employeeId': employeeId,
    type: 'access',
    status: { $in: ['pending_approval', 'approved', 'in_progress', 'deployed'] }
  });
  if (inflightRequest) {
    return { isDuplicate: true, reason: `Active access request already exists for employee ${employeeId}` };
  }

  return { isDuplicate: false, reason: null };
};

const checkDuplicateSharePoint = async (employeeId, licenseType) => {
  try {
    const client = await getGraphClient();
    const siteId = process.env.SHAREPOINT_SITE_ID;
    const fileId = process.env.SHAREPOINT_FILE_ID;

    // Query Excel table for matching employee ID
    const range = await client
      .api(`/sites/${siteId}/drives/${fileId}/root:/Claude_Inventory.xlsx:/workbook/tables/InventoryTable/rows`)
      .get();

    const existing = range.value?.find(row => row.values[0][0] === employeeId);
    if (existing) {
      return { isDuplicate: true, reason: `Employee ${employeeId} found in SharePoint inventory` };
    }
    return { isDuplicate: false, reason: null };
  } catch (err) {
    console.error('[sharepointService] Graph API error, falling back to MongoDB:', err.message);
    return checkDuplicateMongo(employeeId, licenseType);
  }
};

/**
 * Write a provisioned user row to SharePoint Excel inventory.
 * No-op when SHAREPOINT_ENABLED=false.
 */
const syncProvisionedUser = async (userData) => {
  if (!isEnabled()) return;

  try {
    const client = await getGraphClient();
    const siteId = process.env.SHAREPOINT_SITE_ID;
    const fileId = process.env.SHAREPOINT_FILE_ID;

    // Append row matching BRD Appendix B column order
    await client
      .api(`/sites/${siteId}/drives/${fileId}/root:/Claude_Inventory.xlsx:/workbook/tables/InventoryTable/rows/add`)
      .post({
        values: [[
          userData.employeeId,
          userData.name,
          userData.role || '',
          userData.department || '',
          userData.managerName || '',
          userData.costCenter || '',
          userData.dateRequiredBy || '',
          'Claude',
          userData.businessJustification || '',
          userData.clientProject ? 'Yes' : 'No',
          'Yes', // Manager Approval
          userData.dateProvisioned?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
          '', // Last Active Date (updated by WF2)
          userData.licenseType || 'standard',
          userData.accessTier || 'T2'
        ]]
      });
    console.log(`[sharepointService] Synced ${userData.employeeId} to SharePoint inventory`);
  } catch (err) {
    console.error('[sharepointService] Failed to sync to SharePoint:', err.message);
    // Non-fatal: MongoDB remains authoritative
  }
};

module.exports = { checkDuplicate, syncProvisionedUser };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=sharepointService
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/sharepointService.js backend/tests/sharepointService.test.js
git commit -m "feat: add sharepointService with Graph API + MongoDB fallback duplicate detection"
```

---

### Task 7: Create provisioningService.js

**Files:**
- Create: `backend/services/provisioningService.js`
- Create: `backend/tests/provisioningService.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/provisioningService.test.js`:
```js
process.env.PROVISIONING_STUB = 'true';
const provisioningService = require('../services/provisioningService');

describe('provisioningService (PROVISIONING_STUB=true)', () => {
  it('createAccount returns success with claudeUserId', async () => {
    const result = await provisioningService.createAccount({
      employeeId: 'EMP001', email: 'test@test.com',
      licenseType: 'standard', accessTier: 'T2'
    });
    expect(result.success).toBe(true);
    expect(result.claudeUserId).toBeDefined();
    expect(result.provisionedAt).toBeDefined();
  });

  it('revokeAccount returns success', async () => {
    const result = await provisioningService.revokeAccount({ claudeUserId: 'stub-id' });
    expect(result.success).toBe(true);
  });

  it('getLastActiveDate returns a Date 35 days ago', async () => {
    const date = await provisioningService.getLastActiveDate({ claudeUserId: 'stub-id' });
    expect(date).toBeInstanceOf(Date);
    const diff = Date.now() - date.getTime();
    expect(diff).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);
  });

  it('getUsageCost returns totalUSD and byUser array', async () => {
    const result = await provisioningService.getUsageCost({ startDate: new Date(), endDate: new Date() });
    expect(result).toHaveProperty('totalUSD');
    expect(Array.isArray(result.byUser)).toBe(true);
    if (result.byUser.length > 0) {
      expect(result.byUser[0]).toHaveProperty('claudeUserId');
      expect(result.byUser[0]).toHaveProperty('costUSD');
    }
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=provisioningService
```

- [ ] **Step 3: Create provisioningService.js**

Create `backend/services/provisioningService.js`:
```js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * Provisioning Service
 * Wraps Anthropic org API for account lifecycle management.
 * PROVISIONING_STUB=true → returns mock data (safe default).
 * PROVISIONING_STUB=false + ANTHROPIC_ORG_TOKEN set → real API calls.
 *
 * Stub mock values:
 *   getLastActiveDate: 35 days ago (triggers WF2 idle detection)
 *   getUsageCost: 2 mock users with randomised costs
 */

const isStub = () => process.env.PROVISIONING_STUB !== 'false';

const anthropicHeaders = () => ({
  'Authorization': `Bearer ${process.env.ANTHROPIC_ORG_TOKEN}`,
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01'
});

const ANTHROPIC_ORG_BASE = 'https://api.anthropic.com/v1/organizations';

class ProvisioningService {
  async createAccount({ employeeId, email, licenseType, accessTier }) {
    if (isStub()) {
      console.log(`[provisioning STUB] createAccount: ${email} (${licenseType} ${accessTier})`);
      return { success: true, claudeUserId: `stub-${uuidv4()}`, provisionedAt: new Date() };
    }

    const response = await axios.post(
      `${ANTHROPIC_ORG_BASE}/members/invite`,
      { email, role: licenseType === 'premium' ? 'user' : 'readonly' },
      { headers: anthropicHeaders() }
    );
    return { success: true, claudeUserId: response.data.id, provisionedAt: new Date() };
  }

  async upgradeAccount({ claudeUserId, newTier }) {
    if (isStub()) {
      console.log(`[provisioning STUB] upgradeAccount: ${claudeUserId} → ${newTier}`);
      return { success: true };
    }
    await axios.patch(
      `${ANTHROPIC_ORG_BASE}/members/${claudeUserId}`,
      { role: newTier === 'T1' ? 'admin' : 'user' },
      { headers: anthropicHeaders() }
    );
    return { success: true };
  }

  async revokeAccount({ claudeUserId }) {
    if (isStub()) {
      console.log(`[provisioning STUB] revokeAccount: ${claudeUserId}`);
      return { success: true };
    }
    await axios.delete(
      `${ANTHROPIC_ORG_BASE}/members/${claudeUserId}`,
      { headers: anthropicHeaders() }
    );
    return { success: true };
  }

  async getLastActiveDate({ claudeUserId }) {
    if (isStub()) {
      // Returns 35 days ago to trigger WF2 idle detection in tests/dev
      return new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    }
    const response = await axios.get(
      `${ANTHROPIC_ORG_BASE}/members/${claudeUserId}/usage`,
      { headers: anthropicHeaders() }
    );
    return new Date(response.data.last_active_at);
  }

  async getUsageCost({ startDate, endDate }) {
    if (isStub()) {
      const base = Math.random() * 50 + 10;
      return {
        totalUSD: base,
        byUser: [
          { claudeUserId: 'stub-user-1', email: 'user1@infovision.com', costUSD: base * 0.6, tokensUsed: 120000 },
          { claudeUserId: 'stub-user-2', email: 'user2@infovision.com', costUSD: base * 0.4, tokensUsed: 80000 }
        ]
      };
    }
    const response = await axios.get(
      `${ANTHROPIC_ORG_BASE}/usage`,
      {
        params: { start_date: startDate.toISOString(), end_date: endDate.toISOString() },
        headers: anthropicHeaders()
      }
    );
    return { totalUSD: response.data.total_cost_usd, byUser: response.data.by_user };
  }
}

module.exports = new ProvisioningService();
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=provisioningService
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/provisioningService.js backend/tests/provisioningService.test.js
git commit -m "feat: add provisioningService with Anthropic org API stub (PROVISIONING_STUB=true)"
```

---

## Phase 5 — Workflow Engine (WF0, WF1, WF3)

### Task 8: Create wf0-accountRequest.js

**Files:**
- Create: `backend/workflows/wf0-accountRequest.js`
- Create: `backend/tests/wf0.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/wf0.test.js`:
```js
jest.mock('../services/sharepointService', () => ({
  checkDuplicate: jest.fn().mockResolvedValue({ isDuplicate: false, reason: null })
}));
jest.mock('../services/workflowService', () => ({
  initiateWorkflow: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/emailService', () => ({
  approvalRequest: jest.fn().mockResolvedValue({})
}));
jest.mock('../models/Request', () => {
  const mockReq = { _id: 'req-id', referenceId: 'REQ-2026-00001', type: 'access', requester: 'user-id' };
  return { create: jest.fn().mockResolvedValue(mockReq) };
});

const wf0 = require('../workflows/wf0-accountRequest');

describe('wf0-accountRequest', () => {
  const baseClassification = {
    type: 'access', title: 'New License', confidence: 0.95,
    extractedFields: { employeeId: 'EMP001', licenseType: 'standard', accessTier: 'T2', aupConfirmed: true },
    missingFields: [], clarificationQuestion: null, suggestedApprovers: ['manager']
  };
  const mockUser = { _id: 'user-id', name: 'Jane', email: 'jane@test.com' };

  it('rejects when aupConfirmed is false', async () => {
    const classification = { ...baseClassification, extractedFields: { ...baseClassification.extractedFields, aupConfirmed: false } };
    const result = await wf0.run(classification, mockUser, []);
    expect(result.success).toBe(false);
    expect(result.needsClarification).toBe(true);
  });

  it('rejects when duplicate found', async () => {
    const sharepointService = require('../services/sharepointService');
    sharepointService.checkDuplicate.mockResolvedValueOnce({ isDuplicate: true, reason: 'Already provisioned' });
    const result = await wf0.run(baseClassification, mockUser, []);
    expect(result.success).toBe(false);
    expect(result.isDuplicate).toBe(true);
  });

  it('creates request and initiates workflow when valid', async () => {
    const result = await wf0.run(baseClassification, mockUser, []);
    expect(result.success).toBe(true);
    expect(result.request).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=wf0
```

- [ ] **Step 3: Create wf0-accountRequest.js**

Create `backend/workflows/wf0-accountRequest.js`:
```js
const Request = require('../models/Request');
const sharepointService = require('../services/sharepointService');
const { initiateWorkflow } = require('../services/workflowService');
const emailService = require('../services/emailService');
const User = require('../models/User');

/**
 * WF0 — Account Request Workflow
 * Called from routes/requests.js POST /chat for 'access' type requests.
 * Replaces inline Request.create() block.
 *
 * Flow: AUP gate → duplicate check → Request.create() → initiateWorkflow() → email manager
 */
const run = async (classification, requester, conversationHistory) => {
  const { extractedFields, type, title, confidence, suggestedApprovers } = classification;

  // ── AUP Gate ─────────────────────────────────────────────────────────────
  if (!extractedFields?.aupConfirmed) {
    return {
      success: false,
      needsClarification: true,
      clarificationQuestion: 'Before I can process your request, please confirm you have read and agree to InfoVision\'s Claude Acceptable Use Policy (AI-001). Type "I agree to the AUP" to confirm.'
    };
  }

  // ── Duplicate Check ───────────────────────────────────────────────────────
  const { isDuplicate, reason } = await sharepointService.checkDuplicate(
    extractedFields.employeeId,
    extractedFields.licenseType
  );

  if (isDuplicate) {
    return { success: false, isDuplicate: true, reason };
  }

  // ── Create Request ────────────────────────────────────────────────────────
  const request = await Request.create({
    requester: requester._id,
    type,
    title,
    description: conversationHistory[conversationHistory.length - 1]?.content || title,
    priority: extractedFields.priority || 'medium',
    details: extractedFields,
    employeeId: extractedFields.employeeId,
    clientProject: extractedFields.clientProject || false,
    sowNumber: extractedFields.sowNumber,
    dataSensitivity: extractedFields.dataSensitivity,
    aupConfirmed: true,
    licenseType: extractedFields.licenseType,
    accessTier: extractedFields.accessTier,
    aiClassification: {
      confidence,
      extractedFields,
      suggestedApprovers,
      processedAt: new Date()
    },
    conversationHistory: conversationHistory.map(m => ({ role: m.role, content: m.content })),
    auditLog: [{
      action: 'request_created',
      performedBy: requester._id,
      toStatus: 'submitted',
      details: { source: 'bot_chat', aiConfidence: confidence }
    }]
  });

  // ── Initiate Approval Workflow ────────────────────────────────────────────
  await initiateWorkflow(request._id);

  // ── Email Manager ─────────────────────────────────────────────────────────
  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  const manager = await User.findOne({ role: 'manager', isActive: true });

  if (manager) {
    const jwt = require('jsonwebtoken');
    const approveToken = jwt.sign(
      { requestId: request._id.toString(), approverId: manager._id.toString(), decision: 'approved' },
      process.env.EMAIL_ACTION_SECRET,
      { expiresIn: '7d' }
    );
    const rejectToken = jwt.sign(
      { requestId: request._id.toString(), approverId: manager._id.toString(), decision: 'rejected' },
      process.env.EMAIL_ACTION_SECRET,
      { expiresIn: '7d' }
    );

    const approveUrl = `${baseUrl}/api/requests/${request._id}/email-action?token=${approveToken}&decision=approved`;
    const rejectUrl  = `${baseUrl}/api/requests/${request._id}/email-action?token=${rejectToken}&decision=rejected`;

    await emailService.approvalRequest(manager, request, approveUrl, rejectUrl).catch(err =>
      console.error('[wf0] Email send failed (non-fatal):', err.message)
    );
  }

  return { success: true, request: await Request.findById(request._id) };
};

module.exports = { run };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=wf0
```

- [ ] **Step 5: Commit**

```bash
git add backend/workflows/wf0-accountRequest.js backend/tests/wf0.test.js
git commit -m "feat: add WF0 account request workflow (AUP gate + duplicate check + email)"
```

---

### Task 9: Create wf1-provisioning.js

**Files:**
- Create: `backend/workflows/wf1-provisioning.js`
- Create: `backend/tests/wf1.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/wf1.test.js`:
```js
jest.mock('../services/provisioningService', () => ({
  createAccount: jest.fn().mockResolvedValue({ success: true, claudeUserId: 'claude-123', provisionedAt: new Date() })
}));
jest.mock('../services/emailService', () => ({
  aupAcknowledgement: jest.fn().mockResolvedValue({}),
  requestApproved: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/sharepointService', () => ({
  syncProvisionedUser: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../models/User', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockResolvedValue({ _id: 'admin-id', email: 'admin@test.com', teamsConversationId: null })
}));

const wf1 = require('../workflows/wf1-provisioning');

describe('wf1-provisioning', () => {
  const mockRequest = {
    _id: 'req-id', referenceId: 'REQ-2026-00001', type: 'access', title: 'Test',
    priority: 'high',
    requester: { _id: 'user-id', email: 'jane@test.com', name: 'Jane' },
    details: { employeeId: 'EMP001', licenseType: 'standard', accessTier: 'T2' },
    auditLog: [],
    save: jest.fn().mockResolvedValue({})
  };

  it('calls provisioningService.createAccount with correct params', async () => {
    const provisioningService = require('../services/provisioningService');
    await wf1.run(mockRequest);
    expect(provisioningService.createAccount).toHaveBeenCalledWith({
      employeeId: 'EMP001', email: 'jane@test.com',
      licenseType: 'standard', accessTier: 'T2'
    });
  });

  it('sends AUP acknowledgement email to requester', async () => {
    const emailService = require('../services/emailService');
    await wf1.run(mockRequest);
    expect(emailService.aupAcknowledgement).toHaveBeenCalled();
  });

  it('updates User document with provisioning data', async () => {
    const User = require('../models/User');
    await wf1.run(mockRequest);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ aupAcknowledged: true, licenseType: 'standard' })
    );
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd backend && npm test -- --testPathPattern=wf1
```

- [ ] **Step 3: Create wf1-provisioning.js**

Create `backend/workflows/wf1-provisioning.js`:
```js
const User = require('../models/User');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');
const sharepointService = require('../services/sharepointService');

/**
 * WF1 — Auto-Provisioning Workflow
 * Called from workflowService.processApproval() replacing triggerDeployment().
 * Receives an already-populated Mongoose Request doc (requester is a User subdoc).
 *
 * Flow: createAccount → AUP email → User update → SharePoint sync → notify admin
 */
const run = async (request) => {
  const { requester, details } = request;

  try {
    // Step 1: Create Claude account via Anthropic org API (stubbed by default)
    const { claudeUserId, provisionedAt } = await provisioningService.createAccount({
      employeeId: details.employeeId,
      email: requester.email,
      licenseType: details.licenseType,
      accessTier: details.accessTier
    });

    // Step 2: Send AUP acknowledgement email to requester
    await emailService.aupAcknowledgement({
      name: requester.name,
      email: requester.email,
      licenseType: details.licenseType,
      accessTier: details.accessTier
    }).catch(err => console.error('[wf1] AUP email failed (non-fatal):', err.message));

    // Step 3: Update User document with provisioning data
    await User.findByIdAndUpdate(requester._id, {
      dateProvisioned: provisionedAt,
      licenseType: details.licenseType,
      accessTier: details.accessTier,
      aupAcknowledged: true,
      aupAcknowledgedAt: new Date()
    });

    // Step 4: Sync to SharePoint inventory (no-op if SHAREPOINT_ENABLED=false)
    await sharepointService.syncProvisionedUser({
      employeeId: details.employeeId,
      name: requester.name,
      email: requester.email,
      licenseType: details.licenseType,
      accessTier: details.accessTier,
      costCenter: details.costCenter,
      businessJustification: details.businessJustification,
      clientProject: details.clientProject,
      dateProvisioned: provisionedAt
    }).catch(err => console.error('[wf1] SharePoint sync failed (non-fatal):', err.message));

    // Step 5: Notify admin via Teams card → fallback to email
    const adminUser = await User.findOne({ role: 'admin', isActive: true });
    if (adminUser) {
      try {
        if (process.env.TEAMS_ENABLED === 'true' && adminUser.teamsConversationId) {
          const { teamsBot } = require('../bot/teamsBot');
          const adaptiveCards = require('../bot/adaptiveCards');
          await teamsBot.sendProactiveCard(adminUser._id.toString(), adaptiveCards.confirmationCard(request));
        } else {
          await emailService.requestApproved(adminUser, request);
        }
      } catch (err) {
        console.error('[wf1] Admin Teams notification failed, falling back to email:', err.message);
        await emailService.requestApproved(adminUser, request).catch(() => {});
      }
    }

    // Step 6: Update request audit log
    request.auditLog.push({
      action: 'account_provisioned',
      details: { claudeUserId, licenseType: details.licenseType, accessTier: details.accessTier }
    });
    await request.save();

    console.log(`[wf1] Provisioned ${requester.email} → claudeUserId: ${claudeUserId}`);
  } catch (err) {
    console.error('[wf1] Provisioning failed:', err.message);
    request.auditLog.push({ action: 'provisioning_failed', details: { error: err.message } });
    await request.save().catch(() => {});
    throw err;
  }
};

module.exports = { run };
```

- [ ] **Step 4: Update workflowService.js to call wf1.run()**

In `backend/services/workflowService.js`:

Add at top:
```js
const wf1 = require('../workflows/wf1-provisioning');
```

Replace `triggerDeployment` function entirely:
```js
const triggerDeployment = async (request) => {
  request.status = 'in_progress';
  request.auditLog.push({
    action: 'deployment_started',
    details: { automatedAction: true, requestType: request.type }
  });
  await request.save();

  // WF1 runs the actual provisioning (replaces setTimeout stub)
  await wf1.run(request);

  request.status = 'deployed';
  request.actualCompletionDate = new Date();
  await request.save();
};
```

- [ ] **Step 5: Run test — verify PASS**

```bash
cd backend && npm test -- --testPathPattern=wf1
```

- [ ] **Step 6: Commit**

```bash
git add backend/workflows/wf1-provisioning.js backend/tests/wf1.test.js backend/services/workflowService.js
git commit -m "feat: add WF1 provisioning workflow; replace triggerDeployment stub with real flow"
```

---

### Task 10: Create wf3-offboarding.js

**Files:**
- Create: `backend/workflows/wf3-offboarding.js`

- [ ] **Step 1: Create wf3-offboarding.js**

Create `backend/workflows/wf3-offboarding.js`:
```js
const User = require('../models/User');
const Request = require('../models/Request');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');

/**
 * WF3 — Offboarding Sync
 * Triggered by POST /api/webhooks/offboard (HR system or Logic App).
 * SLA: completes synchronously within 2 hours.
 * Revokes all Claude licenses for the given employee.
 */
const run = async ({ employeeId, email, name, triggeredBy }) => {
  const user = await User.findOne({ $or: [{ employeeId }, { email }] });

  if (!user) {
    console.warn(`[wf3] No user found for employeeId=${employeeId} email=${email}`);
    return { success: true, revoked: 0, reason: 'User not found in system' };
  }

  let revokedCount = 0;

  // Revoke active Claude license if provisioned
  if (user.licenseType) {
    // If we have a claudeUserId stored (future: add to User model), revoke it
    await provisioningService.revokeAccount({ claudeUserId: user._id.toString() })
      .catch(err => console.error('[wf3] revokeAccount failed:', err.message));
    revokedCount++;
  }

  // Mark user as deactivated
  user.isActive = false;
  user.licenseType = null;
  user.accessTier = null;
  user.idleWarningSentAt = null;
  await user.save();

  // Close any in-flight requests for this user
  await Request.updateMany(
    { requester: user._id, status: { $in: ['submitted', 'pending_approval'] } },
    { status: 'closed', closureReason: 'User offboarded', actualCompletionDate: new Date() }
  );

  // Send confirmation emails
  const hrEmail = process.env.HR_EMAIL || process.env.EMAIL_USER;
  await emailService.offboardingConfirm(user, hrEmail)
    .catch(err => console.error('[wf3] Email failed (non-fatal):', err.message));

  console.log(`[wf3] Offboarded ${user.email}: ${revokedCount} license(s) revoked`);
  return { success: true, revoked: revokedCount, userId: user._id };
};

module.exports = { run };
```

- [ ] **Step 2: Commit**

```bash
git add backend/workflows/wf3-offboarding.js
git commit -m "feat: add WF3 offboarding workflow (<2hr license revocation)"
```

---

## Phase 6 — Routes + Email Action Endpoint

### Task 11: Update routes/requests.js + add email-action endpoint

**Files:**
- Modify: `backend/routes/requests.js`

- [ ] **Step 1: Wire WF0 into POST /chat**

In `backend/routes/requests.js`, replace the entire POST `/chat` handler body with:
```js
router.post('/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    const classification = await groqService.classifyAndExtract(message, conversationHistory);

    // If clarification needed, return question without creating request
    if (classification.missingFields?.length > 0 && classification.clarificationQuestion) {
      const botReply = await groqService.generateUserResponse(classification, {});
      return res.json({ success: true, needsClarification: true, classification, botMessage: botReply });
    }

    let result;

    // A1 access requests go through WF0 (AUP gate + duplicate check)
    if (classification.type === 'access') {
      const wf0 = require('../workflows/wf0-accountRequest');
      result = await wf0.run(classification, req.user, [
        ...conversationHistory,
        { role: 'user', content: message }
      ]);

      if (!result.success) {
        const botMessage = result.needsClarification
          ? result.clarificationQuestion
          : `Request rejected: ${result.reason}`;
        return res.json({ success: false, needsClarification: result.needsClarification, botMessage });
      }
    } else {
      // All other types: create directly and initiate workflow
      const { initiateWorkflow } = require('../services/workflowService');
      const request = await Request.create({
        requester: req.user._id,
        type: classification.type,
        title: classification.title,
        description: message,
        priority: classification.extractedFields?.priority || 'medium',
        details: classification.extractedFields,
        aiClassification: { confidence: classification.confidence, extractedFields: classification.extractedFields, suggestedApprovers: classification.suggestedApprovers, processedAt: new Date() },
        conversationHistory: [...conversationHistory, { role: 'user', content: message }],
        auditLog: [{ action: 'request_created', performedBy: req.user._id, toStatus: 'submitted', details: { source: 'bot_chat', aiConfidence: classification.confidence } }]
      });
      await initiateWorkflow(request._id);
      result = { success: true, request: await Request.findById(request._id) };
    }

    const botMessage = await groqService.generateUserResponse(classification, {
      referenceId: result.request?.referenceId,
      status: 'submitted'
    });

    if (result.request) {
      await Request.findByIdAndUpdate(result.request._id, {
        $push: { conversationHistory: { role: 'assistant', content: botMessage } }
      });
    }

    res.status(201).json({ success: true, request: result.request, botMessage });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});
```

- [ ] **Step 2: Add email-action endpoint**

Add to `backend/routes/requests.js` before `module.exports`:
```js
// ── GET /api/requests/:id/email-action ────────────────────────────────────
// One-click approve/reject from manager email. Token = sole auth mechanism.
router.get('/:id/email-action', async (req, res) => {
  try {
    const { token, decision } = req.query;
    if (!token || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).send('Invalid request');
    }

    let payload;
    try {
      payload = require('jsonwebtoken').verify(token, process.env.EMAIL_ACTION_SECRET);
    } catch {
      return res.status(401).send('Link expired or invalid. Please request a new approval email.');
    }

    // Verify token params match URL
    if (payload.requestId !== req.params.id || payload.decision !== decision) {
      return res.status(403).send('Token mismatch');
    }

    // Single-use enforcement via atomic findOneAndUpdate
    const request = await Request.findOneAndUpdate(
      { _id: req.params.id, emailActionUsedAt: { $exists: false } },
      { emailActionUsedAt: new Date() },
      { new: true }
    );
    if (!request) {
      return res.status(409).send('This approval link has already been used.');
    }

    // Verify approverId matches current approval step
    const currentStep = request.approvalSteps[request.currentApprovalStep];
    if (!currentStep || currentStep.approver?.toString() !== payload.approverId) {
      return res.status(403).send('You are not authorized to approve this request at this stage.');
    }

    const { processApproval } = require('../services/workflowService');
    await processApproval(request._id.toString(), payload.approverId, decision, 'Via email link');

    res.send(`
      <html><body style="font-family:Arial;text-align:center;padding:60px;">
        <h2>${decision === 'approved' ? '✅ Approved' : '❌ Rejected'}</h2>
        <p>Request <strong>${request.referenceId}</strong> has been ${decision}.</p>
      </body></html>`);
  } catch (err) {
    console.error('Email action error:', err);
    res.status(500).send('An error occurred. Please log in to the dashboard.');
  }
});
```

- [ ] **Step 3: Add offboarding webhook**

Add to `backend/routes/requests.js`:
```js
// ── POST /api/webhooks/offboard ────────────────────────────────────────────
// HR system webhook: triggers WF3 offboarding for an employee.
// Protected by INTERNAL_CRON_SECRET (same as cron routes).
router.post('/webhooks/offboard', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.INTERNAL_CRON_SECRET}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { employeeId, email, name } = req.body;
    if (!employeeId && !email) {
      return res.status(400).json({ success: false, message: 'employeeId or email required' });
    }

    const wf3 = require('../workflows/wf3-offboarding');
    const result = await wf3.run({ employeeId, email, name });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add backend/routes/requests.js
git commit -m "feat: wire WF0 into chat endpoint; add email-action + offboard webhook routes"
```

---

### Task 12: Create routes/internal.js and routes/wf6.js

**Files:**
- Create: `backend/routes/internal.js`
- Create: `backend/routes/wf6.js`

- [ ] **Step 1: Create routes/internal.js**

Create `backend/routes/internal.js`:
```js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');

// ── Cron auth middleware ───────────────────────────────────────────────────
const cronAuth = (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_CRON_SECRET}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};
router.use(cronAuth);

// ── POST /api/internal/wf2 — Idle Reclamation ─────────────────────────────
router.post('/wf2', async (req, res) => {
  try {
    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const eightDaysAgo  = new Date(now - 8  * 24 * 60 * 60 * 1000);

    // Phase 2: Deprovision users warned 8+ days ago
    const toDeprovision = await User.find({
      idleWarningSentAt: { $lte: eightDaysAgo },
      licenseType: { $ne: null }
    });
    let deprovisioned = 0;
    for (const user of toDeprovision) {
      await provisioningService.revokeAccount({ claudeUserId: user._id.toString() })
        .catch(err => console.error('[WF2] revokeAccount failed:', err.message));
      await User.findByIdAndUpdate(user._id, {
        licenseType: null, accessTier: null, idleWarningSentAt: null
      });
      await emailService.offboardingConfirm(user, user.email)
        .catch(() => {});
      deprovisioned++;
    }

    // Phase 1: Warn users inactive 30+ days (not yet warned)
    const activeUsers = await User.find({ licenseType: { $ne: null }, idleWarningSentAt: null });
    let warned = 0;
    for (const user of activeUsers) {
      const lastActive = await provisioningService.getLastActiveDate({ claudeUserId: user._id.toString() });
      if (lastActive < thirtyDaysAgo) {
        await emailService.idleWarning(user).catch(() => {});
        await User.findByIdAndUpdate(user._id, { idleWarningSentAt: new Date() });
        warned++;
      }
    }

    res.json({ success: true, warned, deprovisioned });
  } catch (err) {
    console.error('[WF2]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/internal/wf4 — Cost Anomaly Alert ───────────────────────────
router.post('/wf4', async (req, res) => {
  try {
    const today = new Date();
    const thirtyDaysAgo = new Date(today - 30 * 24 * 60 * 60 * 1000);

    const [todayUsage, historyUsage] = await Promise.all([
      provisioningService.getUsageCost({ startDate: today, endDate: today }),
      provisioningService.getUsageCost({ startDate: thirtyDaysAgo, endDate: today })
    ]);

    const avgUSD = historyUsage.totalUSD / 30;
    const spikePercent = avgUSD > 0 ? Math.round((todayUsage.totalUSD / avgUSD - 1) * 100) : 0;

    if (spikePercent > 150) {
      await emailService.costAnomaly({
        totalUSD: todayUsage.totalUSD,
        avgUSD,
        spikePercent,
        period: today.toDateString()
      }).catch(() => {});
    }

    res.json({ success: true, totalUSD: todayUsage.totalUSD, avgUSD, spikePercent, alertSent: spikePercent > 150 });
  } catch (err) {
    console.error('[WF4]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/internal/wf5 — Weekly Compliance Scan ──────────────────────
router.post('/wf5', async (req, res) => {
  try {
    const activeUsers    = await User.countDocuments({ isActive: true });
    const approvedUsers  = await User.countDocuments({ isActive: true, dateProvisioned: { $ne: null } });
    const flaggedUsers   = activeUsers - approvedUsers;

    await emailService.complianceReport({
      activeUsers, approvedUsers, flaggedUsers, scanDate: new Date()
    }).catch(() => {});

    res.json({ success: true, activeUsers, approvedUsers, flaggedUsers });
  } catch (err) {
    console.error('[WF5]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/internal/wf6 — Quarterly Optimization ──────────────────────
router.post('/wf6', async (req, res) => {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const usage = await provisioningService.getUsageCost({ startDate: ninetyDaysAgo, endDate: new Date() });

    // Score utilization: >80% of quota = upgrade candidate, <20% = downgrade
    const recommendations = usage.byUser.map(u => {
      const score = (u.tokensUsed || 0) / 200000; // normalized to Premium quota
      if (score > 0.8 && u.currentTier !== 'T1') {
        return { ...u, currentTier: u.accessTier || 'T2', recommendedTier: 'T1', action: 'upgrade' };
      }
      if (score < 0.2 && u.currentTier !== 'T3') {
        return { ...u, currentTier: u.accessTier || 'T2', recommendedTier: 'T3', action: 'downgrade' };
      }
      return null;
    }).filter(Boolean);

    if (recommendations.length > 0) {
      const baseUrl = process.env.BACKEND_URL || 'http://localhost:5000';
      const jwt = require('jsonwebtoken');
      const quarter = Math.ceil((new Date().getMonth() + 1) / 3);

      const approveToken = jwt.sign({ recommendations, action: 'approve' }, process.env.EMAIL_ACTION_SECRET, { expiresIn: '30d' });
      const rejectToken  = jwt.sign({ recommendations, action: 'reject'  }, process.env.EMAIL_ACTION_SECRET, { expiresIn: '30d' });

      await emailService.quarterlyOptimization(
        { recommendations, quarter },
        `${baseUrl}/api/wf6/apply-tier-change?token=${approveToken}&decision=approve`,
        `${baseUrl}/api/wf6/apply-tier-change?token=${rejectToken}&decision=reject`
      ).catch(() => {});
    }

    res.json({ success: true, recommendations });
  } catch (err) {
    console.error('[WF6]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Create routes/wf6.js**

Create `backend/routes/wf6.js`:
```js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const provisioningService = require('../services/provisioningService');

// ── GET /api/wf6/apply-tier-change — email-link tier change ───────────────
// Public endpoint (hit via browser from quarterly optimization email).
// JWT is auth mechanism; token encodes { recommendations, action }.
router.get('/apply-tier-change', async (req, res) => {
  const { token, decision } = req.query;
  if (!token || !['approve', 'reject'].includes(decision)) {
    return res.status(400).send('Invalid request');
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.EMAIL_ACTION_SECRET);
  } catch {
    return res.status(401).send('Link expired or invalid.');
  }

  if (decision === 'reject' || payload.action === 'reject') {
    return res.send('<html><body style="font-family:Arial;text-align:center;padding:60px;"><h2>Skipped</h2><p>No tier changes applied this quarter.</p></body></html>');
  }

  try {
    for (const rec of payload.recommendations || []) {
      await provisioningService.upgradeAccount({
        claudeUserId: rec.claudeUserId,
        newTier: rec.recommendedTier
      });
      await User.findOneAndUpdate(
        { email: rec.email },
        { licenseType: rec.recommendedTier === 'T1' ? 'premium' : 'standard', accessTier: rec.recommendedTier }
      );
    }
    res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px;">
      <h2>✅ Tier Changes Applied</h2>
      <p>${(payload.recommendations || []).length} user(s) updated.</p>
    </body></html>`);
  } catch (err) {
    console.error('[WF6 email action]', err.message);
    res.status(500).send('Error applying changes. Please log in to the dashboard.');
  }
});

module.exports = router;
```

- [ ] **Step 3: Mount new routes in server.js**

In `backend/server.js`, add after existing route mounts:
```js
const internalRouter = require('./routes/internal');
const wf6Router = require('./routes/wf6');

app.use('/api/internal', internalRouter);
app.use('/api/wf6', wf6Router);
```

- [ ] **Step 4: Commit**

```bash
git add backend/routes/internal.js backend/routes/wf6.js backend/server.js
git commit -m "feat: add internal cron routes (WF2-WF6) and WF6 email-link tier-change endpoint"
```

---

## Phase 7 — Teams Bot

### Task 13: Create bot/adaptiveCards.js

**Files:**
- Create: `backend/bot/adaptiveCards.js`

- [ ] **Step 1: Create adaptiveCards.js**

Create `backend/bot/adaptiveCards.js`:
```js
/**
 * Adaptive Card Templates — Bot Framework SDK v4 / Teams
 * All cards use AdaptiveCard schema v1.4 (Teams desktop + mobile compatible).
 * Each function returns a CardFactory-ready attachment object.
 */

const { CardFactory } = require('botbuilder');

const card = (body, actions = []) => CardFactory.adaptiveCard({
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  type: 'AdaptiveCard',
  version: '1.4',
  body,
  actions
});

module.exports = {
  approvalCard: (request) => card(
    [
      { type: 'TextBlock', text: '🔔 Approval Required', weight: 'Bolder', size: 'Medium' },
      { type: 'FactSet', facts: [
        { title: 'Reference', value: request.referenceId },
        { title: 'Type',      value: request.type },
        { title: 'Requester', value: request.requester?.name || 'Unknown' },
        { title: 'Priority',  value: request.priority }
      ]},
      { type: 'TextBlock', text: request.title, wrap: true }
    ],
    [
      { type: 'Action.Submit', title: '✅ Approve', style: 'positive', data: { action: 'approve', requestId: request._id?.toString() } },
      { type: 'Action.Submit', title: '❌ Reject',  style: 'destructive', data: { action: 'reject',  requestId: request._id?.toString() } }
    ]
  ),

  confirmationCard: (request) => card([
    { type: 'TextBlock', text: '✅ Request Submitted', weight: 'Bolder', color: 'Good' },
    { type: 'FactSet', facts: [
      { title: 'Reference', value: request.referenceId },
      { title: 'Status',    value: 'Pending Approval' },
      { title: 'Type',      value: request.type }
    ]}
  ]),

  statusCard: (request) => card([
    { type: 'TextBlock', text: `Status: ${request.referenceId}`, weight: 'Bolder' },
    { type: 'FactSet', facts: [
      { title: 'Status',   value: request.status?.replace(/_/g, ' ') },
      { title: 'Type',     value: request.type },
      { title: 'Submitted',value: new Date(request.createdAt).toDateString() }
    ]}
  ]),

  idleWarningCard: (user) => card(
    [
      { type: 'TextBlock', text: '⚠️ Idle License Warning', weight: 'Bolder', color: 'Warning' },
      { type: 'TextBlock', text: `Your Claude AI license has been inactive for 30+ days and will be revoked in 8 days if not used.`, wrap: true }
    ],
    [{ type: 'Action.Submit', title: 'Keep My Access', data: { action: 'keep_access', userId: user._id?.toString() } }]
  ),

  costAlertCard: (data) => card([
    { type: 'TextBlock', text: '⚠️ Cost Anomaly Detected', weight: 'Bolder', color: 'Attention' },
    { type: 'FactSet', facts: [
      { title: "Today's Spend", value: `$${data.totalUSD?.toFixed(2)}` },
      { title: '30-Day Avg',   value: `$${data.avgUSD?.toFixed(2)}` },
      { title: 'Spike',        value: `${data.spikePercent}%` }
    ]}
  ]),

  rejectionCard: (request, reason) => card([
    { type: 'TextBlock', text: '❌ Request Rejected', weight: 'Bolder', color: 'Attention' },
    { type: 'FactSet', facts: [
      { title: 'Reference', value: request.referenceId },
      { title: 'Reason',    value: reason || 'No reason provided' }
    ]}
  ])
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/bot/adaptiveCards.js
git commit -m "feat: add 6 Adaptive Card templates (approvalCard, confirmationCard, statusCard, idleWarning, costAlert, rejection)"
```

---

### Task 14: Create bot/botAdapter.js and bot/teamsBot.js

**Files:**
- Create: `backend/bot/botAdapter.js`
- Create: `backend/bot/teamsBot.js`

- [ ] **Step 1: Create botAdapter.js**

Create `backend/bot/botAdapter.js`:
```js
const { BotFrameworkAdapter } = require('botbuilder');

/**
 * BotFrameworkAdapter — bridges Express ↔ Azure Bot Service.
 * TEAMS_APP_ID and TEAMS_APP_PASSWORD come from Azure Bot Service registration.
 */
const adapter = new BotFrameworkAdapter({
  appId:       process.env.TEAMS_APP_ID,
  appPassword: process.env.TEAMS_APP_PASSWORD
});

// Global error handler: logs and sends error card to user
adapter.onTurnError = async (context, error) => {
  console.error('[BotAdapter] Turn error:', error.message);
  await context.sendActivity('I encountered an error. Please try again or submit your request via the web portal.');
};

module.exports = { adapter };
```

- [ ] **Step 2: Create teamsBot.js**

Create `backend/bot/teamsBot.js`:
```js
const { ActivityHandler, MessageFactory, TurnContext } = require('botbuilder');
const { adapter } = require('./botAdapter');
const groqService = require('../services/groqService');
const User = require('../models/User');

/**
 * Teams Bot — main activity handler.
 * Routes Teams messages to groqService for classification, then WF0/WF6.
 *
 * teamsConversationId is saved to User on first DM for proactive messaging.
 */
class TeamsBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      const userMessage = context.activity.text?.trim();
      if (!userMessage) return next();

      // Save teamsConversationId to User on first interaction
      const teamsUserId = context.activity.from?.aadObjectId;
      if (teamsUserId) {
        await User.findOneAndUpdate(
          { teamsUserId },
          { teamsConversationId: context.activity.conversation?.id },
          { upsert: false }
        ).catch(err => console.error('[TeamsBot] User update failed:', err.message));
      }

      // Classify the message via Groq
      let classification;
      try {
        classification = await groqService.classifyAndExtract(userMessage, []);
      } catch (err) {
        console.error('[TeamsBot] Groq error:', err.message);
        await context.sendActivity('I\'m having trouble processing your request right now. Please try again in a moment.');
        return next();
      }

      // Find the MongoDB user by Teams AAD Object ID
      const requester = await User.findOne({ teamsUserId }).catch(() => null);

      if (!requester) {
        await context.sendActivity('I couldn\'t find your InfoVision account. Please ensure you\'re registered in the system and try again.');
        return next();
      }

      // Handle clarification needed
      if (classification.missingFields?.length > 0 && classification.clarificationQuestion) {
        await context.sendActivity(MessageFactory.text(classification.clarificationQuestion));
        return next();
      }

      // Route to WF0 for access requests
      let response;
      if (classification.type === 'access') {
        const wf0 = require('../workflows/wf0-accountRequest');
        const result = await wf0.run(classification, requester, [{ role: 'user', content: userMessage }]);
        if (!result.success) {
          await context.sendActivity(result.needsClarification ? result.clarificationQuestion : `Request could not be processed: ${result.reason}`);
          return next();
        }
        const adaptiveCards = require('./adaptiveCards');
        await context.sendActivity({ attachments: [adaptiveCards.confirmationCard(result.request)] });
        response = `Your request ${result.request.referenceId} has been submitted and is pending manager approval.`;
      } else {
        // All other types: generate friendly response
        response = await groqService.generateUserResponse(classification, {}).catch(() => 'Request received. I\'ll process it shortly.');
      }

      await context.sendActivity(MessageFactory.text(response));
      return next();
    });

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity('👋 Hi! I\'m the InfoVision Claude Assistant Bot. Tell me what you need — access requests, skill additions, API access, and more!');
        }
      }
      return next();
    });
  }
}

const teamsBot = new TeamsBot();

/**
 * Send an Adaptive Card to a user proactively (without them messaging first).
 * @param {string} userId - MongoDB User._id string
 * @param {object} card - Adaptive Card attachment from adaptiveCards.*()
 */
const sendProactiveCard = async (userId, card) => {
  if (process.env.TEAMS_ENABLED !== 'true') return;

  const user = await User.findById(userId).select('teamsConversationId teamsUserId');
  if (!user?.teamsConversationId) {
    console.warn(`[TeamsBot] No teamsConversationId for user ${userId} — skipping proactive card`);
    return;
  }

  const conversationRef = {
    bot: { id: process.env.TEAMS_APP_ID },
    conversation: { id: user.teamsConversationId },
    serviceUrl: `https://smba.trafficmanager.net/teams/`
  };

  await adapter.continueConversation(conversationRef, async (ctx) => {
    await ctx.sendActivity({ attachments: [card] });
  });
};

module.exports = { teamsBot, sendProactiveCard };
```

- [ ] **Step 3: Add /api/bot route to server.js**

In `backend/server.js`, add:
```js
const { adapter } = require('./bot/botAdapter');
const { teamsBot } = require('./bot/teamsBot');

// Teams Bot endpoint — receives all activity from Azure Bot Service
app.post('/api/bot', async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    await teamsBot.run(context);
  });
});
```

Add this BEFORE the error handler.

- [ ] **Step 4: Commit**

```bash
git add backend/bot/botAdapter.js backend/bot/teamsBot.js backend/server.js
git commit -m "feat: add Teams Bot (BotFrameworkAdapter + TeamsBot ActivityHandler + proactive card support)"
```

---

## Phase 8 — Azure Functions

### Task 15: Create Azure Functions cron triggers

**Files:**
- Create: `azure-functions/host.json`
- Create: `azure-functions/package.json`
- Create: `azure-functions/wf2-idle-reclamation/function.json`
- Create: `azure-functions/wf2-idle-reclamation/index.js`
- (repeat pattern for wf4, wf5, wf6)

- [ ] **Step 1: Create azure-functions/host.json**

Create `azure-functions/host.json`:
```json
{
  "version": "2.0",
  "logging": { "applicationInsights": { "samplingSettings": { "isEnabled": true } } },
  "extensionBundle": { "id": "Microsoft.Azure.Functions.ExtensionBundle", "version": "[3.*, 4.0.0)" }
}
```

- [ ] **Step 2: Create azure-functions/package.json**

Create `azure-functions/package.json`:
```json
{
  "name": "claude-bot-functions",
  "version": "1.0.0",
  "description": "Azure Functions cron triggers for Claude Bot WF2-WF6",
  "scripts": { "start": "func start" },
  "dependencies": { "axios": "^1.6.2" }
}
```

- [ ] **Step 3: Create WF2 timer function**

Create `azure-functions/wf2-idle-reclamation/function.json`:
```json
{
  "bindings": [{
    "name": "myTimer",
    "type": "timerTrigger",
    "direction": "in",
    "schedule": "0 30 0 * * *"
  }]
}
```

Create `azure-functions/wf2-idle-reclamation/index.js`:
```js
// Runs daily at 00:30 UTC (06:00 IST) — calls backend WF2 endpoint
const axios = require('axios');

module.exports = async function(context, myTimer) {
  const backendUrl = process.env.BACKEND_URL;
  const secret = process.env.INTERNAL_CRON_SECRET;

  try {
    const { data } = await axios.post(`${backendUrl}/api/internal/wf2`, {}, {
      headers: { Authorization: `Bearer ${secret}` }
    });
    context.log('[WF2] Idle reclamation complete:', data);
  } catch (err) {
    context.log.error('[WF2] Failed:', err.message);
    throw err; // Azure Functions will retry
  }
};
```

- [ ] **Step 4: Create WF4, WF5, WF6 timer functions**

Create `azure-functions/wf4-cost-anomaly/function.json`:
```json
{ "bindings": [{ "name": "myTimer", "type": "timerTrigger", "direction": "in", "schedule": "0 30 1 * * *" }] }
```

Create `azure-functions/wf4-cost-anomaly/index.js`:
```js
const axios = require('axios');
module.exports = async function(context) {
  const { data } = await axios.post(`${process.env.BACKEND_URL}/api/internal/wf4`, {},
    { headers: { Authorization: `Bearer ${process.env.INTERNAL_CRON_SECRET}` } });
  context.log('[WF4] Cost anomaly check:', data);
};
```

Create `azure-functions/wf5-compliance-scan/function.json`:
```json
{ "bindings": [{ "name": "myTimer", "type": "timerTrigger", "direction": "in", "schedule": "0 30 20 * * 0" }] }
```

Create `azure-functions/wf5-compliance-scan/index.js`:
```js
const axios = require('axios');
module.exports = async function(context) {
  const { data } = await axios.post(`${process.env.BACKEND_URL}/api/internal/wf5`, {},
    { headers: { Authorization: `Bearer ${process.env.INTERNAL_CRON_SECRET}` } });
  context.log('[WF5] Compliance scan:', data);
};
```

Create `azure-functions/wf6-quarterly-opt/function.json`:
```json
{ "bindings": [{ "name": "myTimer", "type": "timerTrigger", "direction": "in", "schedule": "0 0 18 1 0,3,6,9 *" }] }
```

Create `azure-functions/wf6-quarterly-opt/index.js`:
```js
const axios = require('axios');
module.exports = async function(context) {
  const { data } = await axios.post(`${process.env.BACKEND_URL}/api/internal/wf6`, {},
    { headers: { Authorization: `Bearer ${process.env.INTERNAL_CRON_SECRET}` } });
  context.log('[WF6] Quarterly optimization:', data);
};
```

- [ ] **Step 5: Commit**

```bash
git add azure-functions/
git commit -m "feat: add Azure Functions timer triggers for WF2 (daily 06:00 IST), WF4, WF5, WF6"
```

---

## Phase 9 — Azure Deployment Configs

### Task 16: Frontend — Azure Static Web Apps config

**Files:**
- Create: `frontend/staticwebapp.config.json`

- [ ] **Step 1: Create staticwebapp.config.json**

Create `frontend/staticwebapp.config.json`:
```json
{
  "routes": [
    { "route": "/api/*", "allowedRoles": ["authenticated"] },
    { "route": "/*", "serve": "/index.html", "statusCode": 200 }
  ],
  "navigationFallback": { "rewrite": "/index.html", "exclude": ["/api/*", "*.{css,scss,js,png,gif,ico,jpg,svg}"] },
  "responseOverrides": {
    "401": { "redirect": "/login", "statusCode": 302 }
  },
  "globalHeaders": {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/staticwebapp.config.json
git commit -m "feat: add Azure Static Web Apps routing config"
```

---

### Task 17: GitHub Actions CI/CD pipelines

**Files:**
- Create: `.github/workflows/deploy-backend.yml`
- Create: `.github/workflows/deploy-frontend.yml`
- Create: `.github/workflows/deploy-functions.yml`

- [ ] **Step 1: Create deploy-backend.yml**

Create `.github/workflows/deploy-backend.yml`:
```yaml
name: Deploy Backend to Azure App Service

on:
  push:
    branches: [main]
    paths: [backend/**]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18', cache: 'npm', cache-dependency-path: backend/package-lock.json }
      - run: cd backend && npm ci
      - run: cd backend && npm test
      - uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ secrets.AZURE_APP_SERVICE_NAME }}
          publish-profile: ${{ secrets.AZURE_PUBLISH_PROFILE }}
          package: ./backend
```

- [ ] **Step 2: Create deploy-frontend.yml**

Create `.github/workflows/deploy-frontend.yml`:
```yaml
name: Deploy Frontend to Azure Static Web Apps

on:
  push:
    branches: [main]
    paths: [frontend/**]

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: /frontend
          output_location: build
```

- [ ] **Step 3: Create deploy-functions.yml**

Create `.github/workflows/deploy-functions.yml`:
```yaml
name: Deploy Azure Functions

on:
  push:
    branches: [main]
    paths: [azure-functions/**]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: cd azure-functions && npm ci
      - uses: azure/functions-action@v1
        with:
          app-name: ${{ secrets.AZURE_FUNCTIONS_APP_NAME }}
          publish-profile: ${{ secrets.AZURE_FUNCTIONS_PUBLISH_PROFILE }}
          package: ./azure-functions
```

- [ ] **Step 4: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions CI/CD for App Service, Static Web Apps, and Functions"
```

---

### Task 18: Update .env + infra scripts + IT admin guide

**Files:**
- Modify: `backend/.env`
- Create: `infra/TEAMS_SETUP.md`
- Create: `infra/keyvault-setup.sh`

- [ ] **Step 1: Update backend/.env**

Append to `backend/.env`:
```bash
# ── Groq LLM ─────────────────────────────────────────────────────────────────
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# ── Email (Office 365 SMTP) ───────────────────────────────────────────────────
EMAIL_USER=claude-admin@infovision.com
EMAIL_PASSWORD=your_o365_app_password_here
EMAIL_ACTION_SECRET=generate_a_random_secret_here
COE_LEAD_EMAIL=ai.coe.lead@infovision.com
HR_EMAIL=hr@infovision.com

# ── Teams Bot (Azure Bot Service registration) ────────────────────────────────
TEAMS_APP_ID=your_bot_app_id
TEAMS_APP_PASSWORD=your_bot_app_password
TEAMS_TENANT_ID=your_azure_tenant_id
TEAMS_ENABLED=false

# ── SharePoint (separate Graph API app registration) ─────────────────────────
SHAREPOINT_ENABLED=false
SHAREPOINT_SITE_ID=your_sharepoint_site_id
SHAREPOINT_FILE_ID=your_onedrive_file_id
GRAPH_CLIENT_ID=your_graph_app_client_id
GRAPH_CLIENT_SECRET=your_graph_app_client_secret
GRAPH_TENANT_ID=your_azure_tenant_id

# ── Provisioning (Anthropic org API) ─────────────────────────────────────────
PROVISIONING_STUB=true
ANTHROPIC_ORG_TOKEN=your_anthropic_org_token_when_available

# ── Internal Cron Auth ────────────────────────────────────────────────────────
INTERNAL_CRON_SECRET=generate_a_random_secret_here

# ── Azure Deployment ──────────────────────────────────────────────────────────
BACKEND_URL=https://your-app-service.azurewebsites.net
```

- [ ] **Step 2: Create infra/TEAMS_SETUP.md**

Create `infra/TEAMS_SETUP.md`:
```markdown
# Teams Bot & SharePoint Activation — IT Admin Guide

## Prerequisites
- Azure subscription with Bot Service and App Service deployed
- M365 tenant admin access

## Step 1: Enable Teams Channel on Azure Bot
1. Azure Portal → Bot Services → `claude-assistant-bot`
2. Settings → Channels → Microsoft Teams → Enable
3. Accept Teams terms of service

## Step 2: Upload Teams App Manifest
1. Create `manifest.zip` containing:
   - `manifest.json` (botId = TEAMS_APP_ID from env)
   - 192×192 and 32×32 icon PNGs
2. Teams Admin Center → Manage Apps → Upload custom app → Upload `manifest.zip`

## Step 3: Grant SharePoint Graph API Permissions
1. Azure Portal → Azure AD → App Registrations → `claude-bot-graph-api`
2. API Permissions → Add → Microsoft Graph → Application → `Sites.ReadWrite.All`, `Files.ReadWrite.All`
3. Grant admin consent

## Step 4: Activate Features
Set in Azure App Service → Configuration → Application Settings:
```
TEAMS_ENABLED=true
SHAREPOINT_ENABLED=true
SHAREPOINT_SITE_ID=<from SharePoint site URL>
SHAREPOINT_FILE_ID=<from OneDrive file API>
```

## Step 5: Activate Real Provisioning (when Anthropic org token available)
```
PROVISIONING_STUB=false
ANTHROPIC_ORG_TOKEN=<org admin token>
```
```

- [ ] **Step 3: Commit everything**

```bash
git add backend/.env infra/ 
git commit -m "feat: update .env with all new vars; add IT admin Teams/SharePoint setup guide"
```

---

## Phase 10 — Final Verification

### Task 19: Run full test suite + smoke test

- [ ] **Step 1: Run all tests**

```bash
cd backend && npm test
```
Expected: All test suites pass.

- [ ] **Step 2: Start server and verify health**

```bash
cd backend && npm run dev
```
Test: `curl http://localhost:5000/health`
Expected:
```json
{"status":"healthy","version":"1.0.0"}
```

- [ ] **Step 3: Test chat endpoint (access request with AUP)**

```bash
curl -X POST http://localhost:5000/api/requests/chat \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"I need Claude standard T2 access for data analytics, employee ID EMP123, cost center CC-001, I agree to the AUP"}'
```
Expected: `{"success":true,"request":{...},"botMessage":"..."}`

- [ ] **Step 4: Test duplicate detection**

Send same request again. Expected: `{"success":false,"isDuplicate":true}` or clarification response.

- [ ] **Step 5: Test WF5 compliance scan (internal endpoint)**

```bash
curl -X POST http://localhost:5000/api/internal/wf5 \
  -H "Authorization: Bearer <INTERNAL_CRON_SECRET value>"
```
Expected: `{"success":true,"activeUsers":N,"flaggedUsers":N}`

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: Sprint 2 implementation complete — Groq LLM, email, SharePoint, provisioning, Teams Bot, WF0-WF6, Azure deploy"
```

---

## Environment Variables Checklist

Before deploying, verify all required env vars are set in Azure App Service Configuration:

| Variable | Required Now | Activate Later |
|---|---|---|
| `GROQ_API_KEY` | ✅ | — |
| `EMAIL_USER` + `EMAIL_PASSWORD` | ✅ | — |
| `EMAIL_ACTION_SECRET` | ✅ | — |
| `INTERNAL_CRON_SECRET` | ✅ | — |
| `MONGODB_URI` | ✅ | — |
| `JWT_SECRET` | ✅ | — |
| `TEAMS_APP_ID` + `TEAMS_APP_PASSWORD` | Get from Azure Portal | Set `TEAMS_ENABLED=true` after IT admin enables channel |
| `SHAREPOINT_SITE_ID` + `GRAPH_*` | Get from M365 admin | Set `SHAREPOINT_ENABLED=true` after permissions granted |
| `ANTHROPIC_ORG_TOKEN` | When available | Set `PROVISIONING_STUB=false` |

---

## Azure Resources to Create (Manual — one-time)

1. **Azure App Service** (B1) — deploy backend
2. **Azure Static Web Apps** (Free) — deploy frontend  
3. **Azure Bot Service** (F0) — register bot, get APP_ID + APP_PASSWORD
4. **Azure Functions App** (Consumption) — deploy cron triggers
5. **Azure Key Vault** (Standard) — store all secrets, link to App Service via managed identity
6. **MongoDB Atlas** (M10) — production cluster, whitelist App Service IPs
