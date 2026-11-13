"""Live demo endpoint with the mock judges."""
from fastapi.testclient import TestClient

from app.api import app
from tests.conftest import HEADERS, TOKEN


def test_playground_sample_item(env):
    with TestClient(app, headers=HEADERS) as c:
        item = c.get("/api/items/sample", params={"pos": 1}).json()
        r = c.post("/api/playground", json={"judges": ["mock/judge-a", "mock/judge-b"], "item_id": item["id"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["conditions"] == ["urdu_script", "english"]  # Roman / code-mixed not generated yet
        kinds = [x["kind"] for x in d["results"]]
        # per judge: 2 conditions x 2 answers scores + 2 MCQ picks + 1 non-reference x 2 answers x 2 orders pairwise
        assert kinds.count("pointwise") == 2 * 4 and kinds.count("comprehension") == 2 * 2 and kinds.count("pairwise") == 2 * 4
        assert all(1 <= x["score"] <= 10 for x in d["results"] if x["kind"] == "pointwise")
        assert all(x["winner"] in ("english", "urdu_script", "tie") for x in d["results"] if x["kind"] == "pairwise")
        assert all(isinstance(x["correct"], bool) for x in d["results"] if x["kind"] == "comprehension")
        f = d["facts"]["mock/judge-a"]
        assert f["verdict"] in ("same across scripts", "changes with script")
        assert set(f["scores"]) == {"correct", "wrong"} and set(f["picked_right_option"]) == {"urdu_script", "english"}
        assert d["summary"]["text"].startswith("Mock summary") and d["summary"]["name"] == "Mock summary"
        again = c.post("/api/playground", json={"judges": ["mock/judge-a", "mock/judge-b"], "item_id": item["id"]}).json()
        assert again["cached"] == again["calls"]  # repeat demos are free


def test_playground_custom_text(env):
    custom = {
        "urdu_script": {"passage": "علی نے بازار سے سیب خریدے۔", "question": "علی نے کیا خریدا؟", "answer": "سیب"},
        "roman_translit": {"passage": "Ali ne bazaar se seb kharide.", "question": "Ali ne kya khareeda?", "answer": "seb"},
        "english": {"passage": "Ali bought apples from the market.", "question": "What did Ali buy?", "answer": "apples"},
        "code_mixed": {"passage": "", "question": "", "answer": ""},  # empty -> ignored
    }
    with TestClient(app, headers=HEADERS) as c:
        d = c.post("/api/playground", json={"judges": ["mock/judge-a"], "custom": custom, "rubric": True}).json()
        assert d["conditions"] == ["urdu_script", "roman_translit", "english"]
        kinds = [x["kind"] for x in d["results"]]
        assert kinds.count("pointwise") == 3 and kinds.count("pairwise") == 4 and "comprehension" not in kinds
        assert c.post("/api/playground", json={"judges": [], "custom": custom}).status_code == 400
        assert c.post("/api/playground", json={"judges": ["mock/judge-a"], "custom": {}}).status_code == 400
