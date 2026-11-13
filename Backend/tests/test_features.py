"""Experiment password gate, voice note -> fields, and home-page insights."""
import base64
import time

from fastapi.testclient import TestClient

from app.api import _RUN_FAILS, app
from tests.conftest import HEADERS, TOKEN


def wait_done(c: TestClient, run_id: int) -> None:
    for _ in range(400):
        run = next(r for r in c.get("/api/runs").json()["runs"] if r["id"] == run_id)
        if run["status"] not in ("created", "running"):
            assert run["status"] == "done", run
            return
        time.sleep(0.05)
    raise TimeoutError


def test_run_password_gate(env):
    _RUN_FAILS.clear()
    base = {"X-Backend-Token": TOKEN, "X-Auth-User": "bob"}
    body = {"type": "screening", "judges": ["mock/judge-a"]}
    with TestClient(app, headers=base) as c:
        assert c.post("/api/runs", json=body).status_code == 403                       # missing
        assert c.post("/api/runs/estimate", json=body).status_code == 200              # estimates are free
        assert c.post("/api/playground", json={"judges": ["mock/judge-a"], "custom": {"english": {"passage": "p", "question": "q", "answer": "a"}}}).status_code == 200
        for _ in range(4):
            assert c.post("/api/runs", json=body, headers={"X-Run-Password": "nope"}).status_code == 403
        assert c.post("/api/data/load", json={"force": True}, headers={"X-Run-Password": "nope"}).status_code == 429  # locked out
        _RUN_FAILS.clear()
        r = c.post("/api/runs", json=body, headers={"X-Run-Password": HEADERS["X-Run-Password"]})
        assert r.status_code == 200
        assert c.post(f"/api/runs/{r.json()['id']}/start").status_code == 403           # resume is gated too


def test_run_password_unset_locks_runs(env, monkeypatch):
    _RUN_FAILS.clear()
    monkeypatch.setenv("RUN_PASSWORD", "")
    with TestClient(app, headers=HEADERS) as c:
        r = c.post("/api/runs", json={"type": "screening"})
        assert r.status_code == 403 and "not configured" in r.json()["detail"]


def test_voice_note_fills_fields(env):
    audio = base64.b64encode(b"fake-opus-bytes" * 100).decode()
    with TestClient(app, headers=HEADERS) as c:
        r = c.post("/api/voice", json={"audio": audio, "format": "webm"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "seb" in d["transcript"]
        assert set(d["fields"]) == {"urdu_script", "roman_translit", "english", "code_mixed"}
        assert all(set(v) == {"passage", "question", "answer"} for v in d["fields"].values())
        assert d["fields"]["english"]["passage"].startswith("Ali ne bazaar")
        assert c.post("/api/voice", json={"audio": audio, "format": "exe"}).status_code == 400
        assert c.post("/api/voice", json={"audio": "", "format": "webm"}).status_code == 400


def test_insights(env):
    _RUN_FAILS.clear()
    with TestClient(app, headers=HEADERS) as c:
        empty = c.get("/api/insights").json()
        assert empty["dataset"]["items"] == 10 and "pointwise" not in empty
        for body in ({"type": "screening"}, {"type": "pointwise", "n_items": 10},
                     {"type": "pairwise", "n_items": 10}, {"type": "comprehension", "n_items": 10}):
            wait_done(c, c.post("/api/runs", json=body).json()["id"])
        d = c.get("/api/insights").json()
        assert d["screening"]["screened"] == 2 and d["screening"]["judges"] == 2
        assert set(d["pointwise"]["by_condition"]) == {"urdu_script", "english"}
        assert d["pointwise"]["by_condition"]["urdu_script"]["gap"] is None
        assert isinstance(d["pointwise"]["by_condition"]["english"]["gap"], float)
        assert 0 <= d["pairwise"]["by_condition"]["english"] <= 1
        assert 0 <= d["comprehension"]["by_condition"]["urdu_script"] <= 1
