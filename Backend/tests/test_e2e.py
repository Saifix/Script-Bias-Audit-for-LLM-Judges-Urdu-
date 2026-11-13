"""End-to-end with the mock judge on 10 items, through the HTTP API."""
import time

from fastapi.testclient import TestClient

from app.api import app
from tests.conftest import HEADERS, TOKEN


def wait(client: TestClient, run_id: int, timeout: float = 30) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        run = next(r for r in client.get("/api/runs").json()["runs"] if r["id"] == run_id)
        if run["status"] not in ("created", "running"):
            return run
        time.sleep(0.05)
    raise TimeoutError(run_id)


def start(client: TestClient, **body) -> dict:
    r = client.post("/api/runs", json=body)
    assert r.status_code == 200, r.text
    run = wait(client, r.json()["id"])
    assert run["status"] == "done", run
    return run


def test_full_pipeline(env):
    with TestClient(app, headers=HEADERS) as client:
        ov = client.get("/api/overview").json()
        assert ov["dataset"]["items"] == 10 and ov["dataset"]["code_mixed_items"] == 4
        assert {j["id"] for j in ov["judges"]} == {"mock/judge-a", "mock/judge-b"}
        assert all(j["status"] == "untested" for j in ov["judges"])

        # generate + review
        start(client, type="generate", conditions=["roman_translit"])
        start(client, type="generate", conditions=["code_mixed"])
        q = client.get("/api/review", params={"condition": "roman_translit"}).json()["items"]
        assert len(q) == 10 and all(len(i["generated"]) == 4 for i in q)
        for i in q[:-1]:
            assert client.post(f"/api/review/{i['item_id']}/roman_translit",
                               json={"action": "approve", "reviewer": "tester"}).status_code == 200
        last = q[-1]
        assert client.post(f"/api/review/{last['item_id']}/roman_translit",
                           json={"action": "reject", "reviewer": "tester"}).status_code == 200
        cm = client.get("/api/review", params={"condition": "code_mixed"}).json()["items"]
        assert len(cm) == 4
        for i in cm:
            client.post(f"/api/review/{i['item_id']}/code_mixed",
                        json={"action": "edit", "reviewer": "tester", "options": ["a", "b", "c", "d"]})
        assert client.post(f"/api/review/{cm[0]['item_id']}/code_mixed", json={"action": "approve", "reviewer": " "}).status_code == 400

        # estimate before a run
        est = client.post("/api/runs/estimate", json={"type": "pointwise", "n_items": 10}).json()
        # 2 judges x (10+10+9+10+4 items with a view) x 2 answers
        assert est["calls"] == 2 * (10 + 10 + 9 + 10 + 4) * 2 and est["est_cost_usd"] == 0

        # experiments
        start(client, type="screening")
        ov = client.get("/api/overview").json()
        assert all(j["status"] in ("pass", "fail") and set(j["auc"]) == {"urdu_script", "english"} for j in ov["judges"])

        comp = start(client, type="comprehension", n_items=10)
        point = start(client, type="pointwise", n_items=10, flags={"rubric": True, "transliterate": True, "panel": True})
        pair = start(client, type="pairwise", n_items=10)
        rep = start(client, type="repeats", n_items=4, repeats=2)
        assert rep["done"] == 2 * 4 * 5 * 2 * 3  # judges x items x conditions x answers x (1 + 2 repeats)

        s = client.get(f"/api/runs/{point['id']}/summary").json()
        assert set(s["judges"]) == {"mock/judge-a", "mock/judge-b", "panel"}
        conds = [p["condition"] for p in s["judges"]["mock/judge-a"]["pointwise"]]
        assert conds == ["urdu_script", "roman_belebele", "roman_translit", "english", "code_mixed"]
        assert s["judges"]["panel"]["pointwise"][1]["gap_correct"]["n"] == 10

        s = client.get(f"/api/runs/{pair['id']}/summary").json()
        pw = s["judges"]["mock/judge-a"]["pairwise"]
        assert [p["condition"] for p in pw] == ["roman_belebele", "roman_translit", "english", "code_mixed"]
        assert pw[0]["n"] + pw[0]["unparseable"] == 10 * 2 * 2  # items x answers x both orders

        s = client.get(f"/api/runs/{comp['id']}/summary").json()
        assert all(0 <= c["accuracy"] <= 1 for c in s["judges"]["mock/judge-b"]["comprehension"])

        s = client.get(f"/api/runs/{rep['id']}/summary").json()
        assert s["judges"]["mock/judge-a"]["consistency"][0]["n_items"] == 4 * 2

        # exports
        csv = client.get(f"/api/runs/{point['id']}/export.csv")
        assert csv.status_code == 200 and csv.text.startswith("run_id,task_id,kind,judge")
        js = client.get(f"/api/runs/{point['id']}/export.json").json()
        assert len(js["results"]) == point["done"] and js["run"]["config"]["flags"]["panel"]
        assert (env / "exports" / f"run_{point['id']}.csv").exists()

        # re-running a finished run costs nothing: all served from cache
        again = start(client, type="pointwise", n_items=10, flags={"rubric": True, "transliterate": True, "panel": True})
        assert again["cache_hits"] == again["done"]
