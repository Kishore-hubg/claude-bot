"""
E2E tests against deployed Render services.

Required env vars:
  BACKEND_URL           https://claude-bot-backend.onrender.com
  AGENTIC_URL           https://claude-bot-agentic.onrender.com
  AGENTIC_API_KEY       shared secret (leave empty if auth disabled)
  TEST_USER_EMAIL       user@infovision.com
  TEST_USER_PASSWORD    password123
  TEST_MANAGER_EMAIL    manager@infovision.com
  TEST_MANAGER_PASSWORD password123
  TEST_COE_EMAIL        ai.coe@infovision.com
  TEST_COE_PASSWORD     password123

Run:
  BACKEND_URL=https://claude-bot-backend.onrender.com \
  AGENTIC_URL=https://claude-bot-agentic.onrender.com \
  AGENTIC_API_KEY=<key> \
  pytest tests/test_e2e.py -v --tb=short
"""

import os
import sys
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

# ── Config ────────────────────────────────────────────────────────────────────
BACKEND = os.environ.get("BACKEND_URL", "https://claude-bot-backend.onrender.com")
AGENTIC = os.environ.get("AGENTIC_URL", "https://claude-bot-agentic.onrender.com")
AGENTIC_KEY = os.environ.get("AGENTIC_API_KEY", "")
AGENTIC_HEADERS = {"Authorization": f"Bearer {AGENTIC_KEY}"} if AGENTIC_KEY else {}

USER_EMAIL = os.environ.get("TEST_USER_EMAIL", "user@infovision.com")
USER_PASS = os.environ.get("TEST_USER_PASSWORD", "password123")
MANAGER_EMAIL = os.environ.get("TEST_MANAGER_EMAIL", "manager@infovision.com")
MANAGER_PASS = os.environ.get("TEST_MANAGER_PASSWORD", "password123")
COE_EMAIL = os.environ.get("TEST_COE_EMAIL", "ai.coe@infovision.com")
COE_PASS = os.environ.get("TEST_COE_PASSWORD", "password123")

VALID_TYPES = {
    "access", "upgrade", "skills", "offboarding",
    "idle_reclamation", "connectors", "plugins", "apis", "support_qa",
}


# ── Helpers ───────────────────────────────────────────────────────────────────
def login(email: str, password: str) -> str:
    """Login and return JWT token."""
    r = httpx.post(
        f"{BACKEND}/api/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
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
    assert data["groq_ok"] is True, f"Groq not reachable from sidecar: {data}"


def test_intent_access():
    """'I need access to Jira' → type=access, confidence ≥ 0.7"""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "I need access to Jira for my project"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    cls = r.json()["classification"]
    assert cls["type"] == "access", f"Expected access, got: {cls['type']}"
    assert cls["confidence"] >= 0.7, f"Low confidence: {cls['confidence']}"


def test_intent_offboarding():
    """'Offboard EMP12345' → type=offboarding, employeeId extracted."""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "Please offboard employee EMP12345 who is leaving next week"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    cls = r.json()["classification"]
    assert cls["type"] == "offboarding", f"Expected offboarding, got: {cls['type']}"
    assert cls["extractedFields"].get("employeeId") == "EMP12345", \
        f"employeeId not extracted: {cls['extractedFields']}"


def test_intent_support():
    """Support question → type=support_qa."""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "How do I reset my password for the portal?"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    cls = r.json()["classification"]
    assert cls["type"] == "support_qa", f"Expected support_qa, got: {cls['type']}"


def test_missing_fields_aup():
    """Access request without AUP → missingFields includes aupConfirmed."""
    r = httpx.post(
        f"{AGENTIC}/agent/supervisor",
        json={"message": "I need access to the internal portal"},
        headers=AGENTIC_HEADERS,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    cls = r.json()["classification"]
    assert "aupConfirmed" in cls["missingFields"], \
        f"Expected aupConfirmed in missingFields: {cls['missingFields']}"
    assert cls["clarificationQuestion"] is not None, "Expected clarification question"


def test_backend_health():
    """Backend must be live."""
    r = httpx.get(f"{BACKEND}/health", timeout=60)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_auth_and_chat():
    """Login → chat → valid classification type returned by backend."""
    token = login(USER_EMAIL, USER_PASS)
    r = httpx.post(
        f"{BACKEND}/api/requests/chat",
        json={"message": "I need API access to the data pipeline", "conversationHistory": []},
        headers=auth_headers(token),
        timeout=30,
    )
    assert r.status_code in (200, 201), f"Chat failed: {r.status_code} {r.text}"
    data = r.json()
    cls = data.get("classification") or {}
    assert cls.get("type") in VALID_TYPES, \
        f"Invalid or missing classification type: {cls}"
    orchestration = data.get("orchestration") or {}
    assert orchestration.get("mode") == "on", \
        f"Expected AGENTIC_MODE=on in response, got: {orchestration.get('mode')}"
    assert orchestration.get("primarySource") == "agentic", \
        f"Expected agentic as primarySource, got: {orchestration.get('primarySource')}"


def test_full_workflow():
    """Full E2E: submit → manager approve → CoE approve → status=deployed."""
    user_token = login(USER_EMAIL, USER_PASS)
    manager_token = login(MANAGER_EMAIL, MANAGER_PASS)
    coe_token = login(COE_EMAIL, COE_PASS)

    # 1) Submit request — explicit AUP so no clarification loop
    chat_r = httpx.post(
        f"{BACKEND}/api/requests/chat",
        json={
            "message": "I need access to Claude AI. I agree to the AUP. Employee ID: EMP99001.",
            "conversationHistory": [],
        },
        headers=auth_headers(user_token),
        timeout=30,
    )
    assert chat_r.status_code in (200, 201), f"Chat failed: {chat_r.status_code} {chat_r.text}"
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
    assert approve_r.status_code == 200, f"Manager approval failed: {approve_r.status_code} {approve_r.text}"

    # 3) AI CoE lead approves (step 1 → triggers deployment)
    approve_r2 = httpx.post(
        f"{BACKEND}/api/requests/{request_id}/approve",
        json={"decision": "approved", "comments": "Approved by CoE lead"},
        headers=auth_headers(coe_token),
        timeout=30,
    )
    assert approve_r2.status_code == 200, f"CoE approval failed: {approve_r2.status_code} {approve_r2.text}"

    # 4) Check final status — deployment is synchronous
    status_r = httpx.get(
        f"{BACKEND}/api/requests/{request_id}",
        headers=auth_headers(user_token),
        timeout=30,
    )
    assert status_r.status_code == 200
    body = status_r.json()
    final_status = body.get("status") or (body.get("request") or {}).get("status")
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
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app import app as sidecar_app  # noqa: PLC0415

    client = TestClient(sidecar_app)

    with patch("app.groq_json_call", side_effect=Exception("simulated groq timeout")):
        r = client.post(
            "/agent/route",
            json={"message": "I need access to the internal tools"},
        )

    assert r.status_code == 200, f"Fallback route failed: {r.status_code} {r.text}"
    cls = r.json()["classification"]
    assert cls["type"] in VALID_TYPES, f"Fallback returned invalid type: {cls['type']}"
