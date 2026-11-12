"""Live demo endpoint with the mock judges."""
from fastapi.testclient import TestClient

from app.api import app
from tests.conftest import TOKEN


def test_playground_sample_item(env):
    with TestClient(app, headers={"X-Backend-Token": TOKEN}) as c:
        item = c.get("/api/items/sample", params={"pos": 1}).json()
        r = c.post("/api/playground", json={"judges": ["mock/judge-a", "mock/judge-b"], "item_id": item["id"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["conditions"] == ["urdu_script", "roman_belebele", "english"]  # nothing generated yet
        kinds = [x["kind"] for x in d["results"]]
        # per judge: 3 conditions x 2 answers scores + 3 MCQ picks + 2 non-reference x 2 answers x 2 orders pairwise
        assert kinds.count("pointwise") == 2 * 6 and kinds.count("comprehension") == 2 * 3 and kinds.count("pairwise") == 2 * 8
        assert all(1 <= x["score"] <= 10 for x in d["results"] if x["kind"] == "pointwise")
        assert all(x["winner"] in ("roman_belebele", "english", "urdu_script", "tie") for x in d["results"] if x["kind"] == "pairwise")
        assert all(isinstance(x["correct"], bool) for x in d["results"] if x["kind"] == "comprehension")
        again = c.post("/api/playground", json={"judges": ["mock/judge-a", "mock/judge-b"], "item_id": item["id"]}).json()
        assert again["cached"] == again["calls"]  # repeat demos are free


def test_playground_custom_text(env):
    custom = {
        "urdu_script": {"passage": "علی نے بازار سے سیب خریدے۔", "question": "علی نے کیا خریدا؟", "answer": "سیب"},
        "roman_translit": {"passage": "Ali ne bazaar se seb kharide.", "question": "Ali ne kya khareeda?", "answer": "seb"},
        "english": {"passage": "Ali bought apples from the market.", "question": "What did Ali buy?", "answer": "apples"},
        "code_mixed": {"passage": "", "question": "", "answer": ""},  # empty -> ignored
    }
    with TestClient(app, headers={"X-Backend-Token": TOKEN}) as c:
        d = c.post("/api/playground", json={"judges": ["mock/judge-a"], "custom": custom, "rubric": True}).json()
        assert d["conditions"] == ["urdu_script", "roman_translit", "english"]
        kinds = [x["kind"] for x in d["results"]]
        assert kinds.count("pointwise") == 3 and kinds.count("pairwise") == 4 and "comprehension" not in kinds
        assert c.post("/api/playground", json={"judges": [], "custom": custom}).status_code == 400
        assert c.post("/api/playground", json={"judges": ["mock/judge-a"], "custom": {}}).status_code == 400
