# Claude Assistant Bot — InfoVision
## Full-Stack Implementation (Node.js + MongoDB + React)

> Teams-integrated workflow automation platform for access, skills, connectors, plugins, APIs, and support requests — powered by Anthropic Claude.

---

## 🏗️ Project Structure

```
claude-bot/
├── backend/                        # Node.js + Express + MongoDB
│   ├── config/
│   │   ├── database.js             # MongoDB connection manager
│   │   └── seed.js                 # Demo data seed script
│   ├── middleware/
│   │   └── auth.js                 # JWT authentication + role authorization
│   ├── models/
│   │   ├── User.js                 # User schema (roles, Teams ID, preferences)
│   │   ├── Request.js              # Core request entity (state machine, audit log)
│   │   ├── Notification.js         # Notification delivery tracking
│   │   └── Analytics.js            # Daily KPI snapshots
│   ├── routes/
│   │   ├── auth.js                 # POST /login, /register, GET /me
│   │   ├── requests.js             # Full CRUD + /chat + /approve + stats
│   │   └── notifications.js        # Notifications + Users routes
│   ├── services/
│   │   ├── claudeService.js        # Anthropic Claude API integration
│   │   └── workflowService.js      # Approval state machine orchestrator
│   ├── server.js                   # Express app + Socket.io + rate limiting
│   ├── package.json
│   └── .env.example                # Environment variable template
│
├── frontend/                       # React 18 SPA
    ├── public/index.html
    └── src/
        ├── context/AuthContext.js  # Global auth state + JWT interceptors
        ├── services/api.js         # Centralized axios API calls
        ├── components/Layout.js    # Sidebar navigation shell
        └── pages/
            ├── Login.js            # Login with demo credentials panel
            ├── Register.js         # User registration
            ├── Dashboard.js        # Overview, stats, KPIs, quick actions
            ├── ChatPage.js         # Bot conversation interface
            ├── RequestsPage.js     # Filterable list + inline approve/reject
            ├── RequestDetail.js    # Full request detail + audit trail
            └── NotificationsPage.js
│
└── agentic-sidecar/                # Python FastAPI + LangGraph sidecar
    ├── app.py                      # Supervisor + specialist agent endpoints
    ├── requirements.txt
    └── Dockerfile
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 6+ (local or MongoDB Atlas)
- Anthropic API key ([get one here](https://console.anthropic.com/))

### 1. Clone and Configure Backend

```bash
cd backend
npm install

# Copy and edit environment variables
cp .env.example .env
# Edit .env: set MONGODB_URI, CLAUDE_API_KEY, JWT_SECRET
```

### 2. Seed the Database

```bash
node config/seed.js
```

This creates 8 demo users and 6 sample requests covering all request types.

### 3. Start the Backend

```bash
npm run dev        # Development (nodemon auto-reload)
# or
npm start          # Production
```

Server starts at **http://localhost:5000**

### 3a. Start Agentic Sidecar (LangGraph)

```bash
cd ../agentic-sidecar
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

Sidecar starts at **http://localhost:8001**

### 4. Start the Frontend

```bash
cd ../frontend
npm install
npm start
```

React app starts at **http://localhost:3000**

### Agentic mode flags (backend)

```env
AGENTIC_MODE=off|shadow|on
AGENTIC_ORCHESTRATION=single|multi
AGENTIC_API_URL=http://localhost:8001
AGENTIC_API_KEY=
AGENTIC_TIMEOUT_MS=6000
AGENTIC_MULTI_SPECIALISTS=intent,extract,policy
```

---

## ▲ Vercel Deployment

### Frontend (recommended on Vercel)

1. Import the repository in Vercel and set **Root Directory** to `frontend`.
2. Add environment variable:
   - `REACT_APP_API_URL=https://<your-backend-domain>/api`
3. Deploy. SPA routing is handled by `frontend/vercel.json`.

### Backend URL updates after deploy

Update backend environment variables so auth/CORS/email links work with Vercel-hosted frontend:

```env
FRONTEND_URL=https://<your-frontend-app>.vercel.app
BACKEND_URL=https://<your-backend-domain>
```

Also update `teams-app/manifest.json`:
- `validDomains` -> your public backend domain (domain only, no protocol/path).

---

## 🔑 Demo Credentials

| Role       | Email                        | Password    |
|------------|------------------------------|-------------|
| Admin      | admin@infovision.com         | password123 |
| Manager    | manager@infovision.com       | password123 |
| Tech Lead  | techlead@infovision.com      | password123 |
| Architect  | architect@infovision.com     | password123 |
| Support    | support@infovision.com       | password123 |
| CTO        | cto@infovision.com           | password123 |
| User       | user@infovision.com          | password123 |

---

## 🌐 API Reference

### Auth
| Method | Endpoint             | Description           |
|--------|----------------------|-----------------------|
| POST   | /api/auth/register   | Create account        |
| POST   | /api/auth/login      | Login → JWT token     |
| GET    | /api/auth/me         | Get current user      |

### Requests
| Method | Endpoint                      | Description                          |
|--------|-------------------------------|--------------------------------------|
| POST   | /api/requests/chat            | Submit natural language to bot       |
| GET    | /api/requests                 | List requests (role-filtered)        |
| GET    | /api/requests/:id             | Get request detail                   |
| POST   | /api/requests/:id/approve     | Approve or reject                    |
| POST   | /api/requests/:id/close       | Close a request                      |
| GET    | /api/requests/stats/overview  | Dashboard KPI summary                |

### Notifications
| Method | Endpoint                           | Description              |
|--------|------------------------------------|--------------------------|
| GET    | /api/notifications                 | List notifications       |
| PATCH  | /api/notifications/:id/read        | Mark one as read         |
| PATCH  | /api/notifications/mark-all-read   | Mark all as read         |

### Users
| Method | Endpoint              | Description                  |
|--------|-----------------------|------------------------------|
| GET    | /api/users            | List all users (admin only)  |
| GET    | /api/users/approvers  | List approver-role users     |
| PATCH  | /api/users/:id        | Update user profile          |

---

## 🔄 Request Lifecycle

```
User submits via Chat
        ↓
Claude classifies + extracts fields
        ↓
Request created in MongoDB
        ↓
Approval chain built (per request type)
        ↓
Approvers notified (in-app + Teams)
        ↓
Approve / Reject at each step
        ↓
All approved → Auto-deployment triggered
        ↓
Deployed → Closed
```

### Approval Chains by Type

| Type       | Chain                        |
|------------|------------------------------|
| access     | Manager → Admin              |
| skills     | Manager                      |
| connectors | Tech Lead → Admin            |
| plugins    | CTO → Admin                  |
| apis       | Architect → Admin            |
| support_qa | Support                      |

---

## 🏛️ Architecture

```
React Frontend (Port 3000)
        ↕  REST + WebSocket
Express Backend (Port 5000)
        ↕
    MongoDB          Anthropic Claude API
 (Mongoose ODM)       (Classification,
                       Extraction,
                       Responses)
```

### MongoDB Collections

| Collection    | Purpose                                    |
|---------------|--------------------------------------------|
| users         | User accounts, roles, Teams IDs            |
| requests      | All requests with full state + audit log   |
| notifications | Per-user notification feed                 |
| analytics     | Daily KPI snapshots for dashboards         |

---

## 🔒 Security Features

- JWT authentication with 7-day expiry
- bcrypt password hashing (12 rounds)
- Role-based access control (7 roles)
- Rate limiting (100 req/15 min per IP)
- Helmet.js HTTP security headers
- Input validation via express-validator
- Passwords never returned in API responses (select: false)

---

## 🛠️ Environment Variables

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/claude_assistant_bot
JWT_SECRET=change_this_in_production
JWT_EXPIRES_IN=7d
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-20250514
TEAMS_APP_ID=your_teams_app_id
TEAMS_APP_PASSWORD=your_teams_app_password
FRONTEND_URL=http://localhost:3000
```

---

## 📊 Success Metrics (from Implementation Plan)

| Metric                  | Target              |
|-------------------------|---------------------|
| Processing Time          | 70% reduction       |
| Automation Rate          | 95% of requests     |
| User Adoption            | 90% within 6 months |
| Error Rate               | 0% manual errors    |
| Satisfaction Score       | 4.5/5               |

---

*Built for InfoVision — Claude Assistant Bot Implementation Plan, April 2026*
