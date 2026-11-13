"""Importing externally written generated text (with provenance)."""
from app.data import condition_view, import_generated, load_items
from app.db import db


def test_import_generated(env):
    with db() as c:
        items = load_items(c)
        cm = [i for i in items if i["code_mixed"]]
        plain = [i for i in items if not i["code_mixed"]]
        data = {
            "roman_translit": [{"id": i["id"], "options": ["a", "b", "c", "d"]} for i in items]
                              + [{"id": "missing", "options": ["a", "b", "c", "d"]}, {"id": items[0]["id"], "options": ["a", ""]}],
            "code_mixed": [{"id": i["id"], "options": ["w", "x", "y", "z"]} for i in cm]
                          + [{"id": plain[0]["id"], "options": ["w", "x", "y", "z"]}],  # not in code-mixed subset
        }
        counts = import_generated(c, data, "anthropic/claude-opus-5.5 (high effort)", approve_as="auto-approved: Opus 5.5")
    assert counts == {"imported": len(items) + len(cm), "skipped_existing": 0, "rejected": 3}
    with db() as c:
        items = load_items(c)
        row = c.execute("SELECT * FROM generated WHERE condition='roman_translit' LIMIT 1").fetchone()
        again = import_generated(c, {"roman_translit": [{"id": items[0]["id"], "options": ["p", "q", "r", "s"]}]}, "m")
    assert row["status"] == "approved" and row["model"].startswith("anthropic/claude-opus-5.5") and row["reviewer"] == "auto-approved: Opus 5.5"
    assert again == {"imported": 0, "skipped_existing": 1, "rejected": 0}
    assert condition_view(items[0], "roman_translit")["options"] == ["a", "b", "c", "d"]  # usable in runs (approved)
