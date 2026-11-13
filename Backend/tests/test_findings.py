"""Code-checked findings behind the plain-language summary, replicate runs, and the trend endpoint."""
import asyncio

from fastapi.testclient import TestClient

from app.api import _run_facts, app, run_findings
from app.config import load_config
from app.db import db
from app.runs import create_run, execute_run, normalize_config
from tests.conftest import HEADERS


def summary(gap, lo, hi, win, wlo, whi):
    return {"judges": {"j": {
        "pointwise": [{"condition": "urdu_script", "gap_correct": None, "accept_wrong": 0.39},
                      {"condition": "roman_translit", "gap_correct": {"gap": gap, "lo": lo, "hi": hi, "n": 300}, "accept_wrong": 0.51}],
        "pairwise": [{"condition": "roman_translit", "win_rate": win, "lo": wlo, "hi": whi}],
        "comprehension": [{"condition": "urdu_script", "accuracy": 0.82}, {"condition": "roman_translit", "accuracy": 0.67}],
        "consistency": []}}}


def test_findings_mark_real_differences(env):
    cfg = load_config()
    f = run_findings(summary(-0.59, -0.95, -0.24, 0.40, 0.37, 0.42), cfg)
    by = {x["kind"]: x for x in f}
    assert by["score_gap"]["real"] and by["preference"]["real"] and by["accept_wrong"]["real"] and by["comprehension"]["real"]
    text = _run_facts(f)
    assert "treats the scripts differently" in text and "prefers Urdu script" in text
    assert "[REAL DIFFERENCE]" in text

    f = run_findings(summary(-0.12, -0.39, 0.15, 0.51, 0.48, 0.53), cfg)
    by = {x["kind"]: x for x in f}
    assert not by["score_gap"]["real"] and not by["preference"]["real"]
    assert "shows no preference" in _run_facts(f)


def test_replicate_makes_fresh_calls_and_trend(env):
    app_cfg = load_config()
    a = create_run(normalize_config({"type": "pointwise", "conditions": ["urdu_script", "english"], "n_items": 3}, app_cfg))
    asyncio.run(execute_run(a))
    with db() as c:
        before = c.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
    b = create_run(normalize_config({"type": "pointwise", "conditions": ["urdu_script", "english"], "n_items": 3,
                                     "label": "Round 2 · replication", "replicate": 1}, app_cfg))
    asyncio.run(execute_run(b))
    with db() as c:
        after = c.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
        cached = c.execute("SELECT SUM(cached) FROM results WHERE run_id=?", (b,)).fetchone()[0]
    assert after - before == 2 * 3 * 2 * 2 and cached == 0  # every replicate call is fresh
    with TestClient(app, headers=HEADERS) as c:
        t = c.get("/api/trend").json()
        assert {"Round 1", "Round 2 · replication"} <= set(t["labels"])
        row = next(r for r in t["judges"] if r["id"] == "mock/judge-a")
        assert row["tier"] == 1 and "english" in row["gap"] and row["runs"]["pointwise"] == b
        t1 = c.get("/api/trend", params={"label": "Round 1"}).json()
        assert next(r for r in t1["judges"] if r["id"] == "mock/judge-a")["runs"]["pointwise"] == a
        # label + replicate must survive the HTTP API (regression: they were silently dropped)
        r = c.post("/api/runs", json={"type": "screening", "judges": ["mock/judge-a"], "label": "Round 9 · api",
                                      "replicate": 3, "start": False})
        assert r.status_code == 200 and r.json()["cached"] == 0
        cfg_api = next(x for x in c.get("/api/runs").json()["runs"] if x["id"] == r.json()["id"])["config"]
        assert cfg_api["label"] == "Round 9 · api" and cfg_api["replicate"] == 3
        cfgj = c.get("/api/config").json()
        assert cfgj["judge_meta"]["mock/judge-a"]["tier"] == 1
