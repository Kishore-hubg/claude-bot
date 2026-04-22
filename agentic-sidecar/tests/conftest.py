"""
Pytest configuration — session-scoped warm-up fixture.
Pre-warms both Render services before any test runs.
Free tier services cold-start in 30-60s; this prevents timeout failures.
"""

import os
import time

import httpx
import pytest

BACKEND = os.environ.get("BACKEND_URL", "https://claude-bot-backend.onrender.com")
AGENTIC = os.environ.get("AGENTIC_URL", "https://claude-bot-agentic.onrender.com")


def ping_with_retry(url: str, label: str, retries: int = 6, delay: int = 20) -> None:
    """GET url, retrying up to `retries` times with `delay` seconds between attempts."""
    for attempt in range(1, retries + 1):
        try:
            r = httpx.get(url, timeout=30)
            if r.status_code < 500:
                print(f"\n[warm-up] {label} ready (attempt {attempt}, status {r.status_code})")
                return
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            print(f"\n[warm-up] {label} attempt {attempt}/{retries}: {type(e).__name__} — waiting {delay}s...")
        time.sleep(delay)
    print(f"\n[warm-up] WARNING: {label} did not respond after {retries} attempts — tests may timeout")


@pytest.fixture(scope="session", autouse=True)
def warm_up_services():
    """Wake both Render services before the test session starts."""
    print("\n[warm-up] Waking Render free-tier services (may take up to 2 min)...")
    ping_with_retry(f"{AGENTIC}/health", "Agentic sidecar")
    ping_with_retry(f"{BACKEND}/health", "Backend API")
    print("[warm-up] Both services ready. Starting tests.")
