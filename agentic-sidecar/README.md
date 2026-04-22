# LangGraph Agentic Sidecar

This service provides multi-agent orchestration endpoints consumed by the Node backend:

- `POST /agent/supervisor`
- `POST /agent/intent`
- `POST /agent/extract`
- `POST /agent/policy`
- `POST /agent/route` (single-route compatibility fallback)
- `GET /health`

## Run locally

```bash
cd agentic-sidecar
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

## Environment

- `AGENTIC_API_KEY` (optional bearer auth token)
- `AGENTIC_MULTI_SPECIALISTS` (comma-separated specialist list, default `intent,extract,policy`)

## Node backend integration

Set in `backend/.env`:

- `AGENTIC_MODE=off|shadow|on`
- `AGENTIC_ORCHESTRATION=single|multi`
- `AGENTIC_API_URL=http://localhost:8001`
- `AGENTIC_API_KEY=<same token as sidecar if enabled>`
- `AGENTIC_TIMEOUT_MS=6000`
- `AGENTIC_MULTI_SPECIALISTS=intent,extract,policy`
