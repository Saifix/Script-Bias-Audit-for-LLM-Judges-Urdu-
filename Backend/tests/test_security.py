"""The API refuses every call without the shared backend token, and records the proxy-supplied user."""
from fastapi.testclient import TestClient

from app.api import app
from tests.conftest import TOKEN


def test_requires_backend_token(env):
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200  # healthcheck stays open
        assert c.get("/api/overview").status_code == 401
        assert c.get("/api/overview", headers={"X-Backend-Token": "wrong" * 10}).status_code == 401
        assert c.post("/api/runs", json={"type": "screening"}).status_code == 401
        assert c.get("/api/overview", headers={"X-Backend-Token": TOKEN}).status_code == 200
        auth = {"X-Backend-Token": TOKEN}
        assert c.get("/docs", headers=auth).status_code == 404  # API docs disabled
        assert c.get("/openapi.json", headers=auth).status_code == 404


def test_fails_closed_without_configured_token(env, monkeypatch):
    monkeypatch.setenv("BACKEND_TOKEN", "short")  # too short = not configured
    with TestClient(app) as c:
        assert c.get("/api/overview", headers={"X-Backend-Token": "short"}).status_code == 401


def test_reviewer_comes_from_signed_in_user(env):
    with TestClient(app, headers={"X-Backend-Token": TOKEN}) as c:
        r = c.post("/api/runs", json={"type": "generate", "conditions": ["roman_translit"], "n_items": 1})
        assert r.status_code == 200
        import time
        for _ in range(100):
            q = c.get("/api/review", params={"condition": "roman_translit"}).json()["items"]
            if q:
                break
            time.sleep(0.05)
        item = q[0]["item_id"]
        r = c.post(f"/api/review/{item}/roman_translit", json={"action": "approve", "reviewer": "spoofed"},
                   headers={"X-Auth-User": "alice"})
        assert r.status_code == 200
        got = c.get("/api/review", params={"condition": "roman_translit", "status": "approved"}).json()["items"][0]
        assert got["reviewer"] == "alice"
