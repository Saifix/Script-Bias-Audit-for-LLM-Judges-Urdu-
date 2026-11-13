"""Shared fixtures: isolated DATA_DIR, mock-only config, synthetic parallel Belebele rows."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.data import build_items, save_items
from app.db import db, init_db

TOKEN = "t" * 40  # BACKEND_TOKEN used by the tests
RUN_PW = "saif-test"  # RUN_PASSWORD used by the tests
HEADERS = {"X-Backend-Token": TOKEN, "X-Run-Password": RUN_PW}

URDU_WORDS = ["کتاب", "پانی", "شہر", "سیب", "گاڑی", "دریا", "بازار", "اسکول", "کھانا", "موسم"]
ROMAN_WORDS = ["kitab", "pani", "shehar", "seb", "gari", "darya", "bazar", "school", "khana", "mausam"]
ENGLISH_WORDS = ["book", "water", "city", "apple", "car", "river", "market", "school", "food", "weather"]


def fake_rows(n: int = 12) -> dict[str, list[dict]]:
    """Parallel rows for the three configs; correct option words appear in the passage."""
    out: dict[str, list[dict]] = {"urd_Arab": [], "urd_Latn": [], "eng_Latn": []}
    for cfg, words in (("urd_Arab", URDU_WORDS), ("urd_Latn", ROMAN_WORDS), ("eng_Latn", ENGLISH_WORDS)):
        for i in range(n):
            correct = i % 4
            opts = [f"{words[(i + k) % 10]} {words[(i + k + 3) % 10]}" for k in range(4)]
            out[cfg].append({
                "link": f"https://example.org/{i // 2}", "question_number": i % 2 + 1,
                "flores_passage": f"{opts[correct]} {words[(i + 5) % 10]} {words[(i + 6) % 10]}",
                "question": f"{words[i % 10]}?",
                **{f"mc_answer{k + 1}": o for k, o in enumerate(opts)},
                "correct_answer_num": str(correct + 1),
            })
    return out


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Fresh database with 10 synthetic items and the mock-only test config."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CONFIG_PATH", str(Path(__file__).parent / "config.test.toml"))
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("BACKEND_TOKEN", TOKEN)
    monkeypatch.setenv("RUN_PASSWORD", RUN_PW)
    import app.judges
    app.judges._SPENT.update(value=0.0, at=0.0)  # spend counter is per process; start each test clean
    init_db()
    with db() as c:
        save_items(c, build_items(fake_rows(12), n=10, seed=7, code_mixed_n=4))
    return tmp_path
