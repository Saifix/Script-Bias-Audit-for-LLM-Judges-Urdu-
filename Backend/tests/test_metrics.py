"""Metric functions against hand-computed values (worked example from the project brief)."""
import pytest

from app.metrics import (accuracy, acceptance_rate, auc, bootstrap_ci, item_variances, paired_gap, panel_rows,
                         separation, summarize, win_rate)

URDU_C, ROMAN_C = [9, 9, 8], [7, 8, 7]
URDU_W, ROMAN_W = [2, 3, 2], [4, 4, 5]


def as_items(xs):
    return {f"i{k}": v for k, v in enumerate(xs)}


def test_worked_example_means_and_gap():
    g = paired_gap(as_items(URDU_C), as_items(ROMAN_C), n_resamples=1000, seed=1)
    assert sum(URDU_C) / 3 == pytest.approx(8.67, abs=0.005)
    assert sum(ROMAN_C) / 3 == pytest.approx(7.33, abs=0.005)
    assert g["gap"] == pytest.approx(-1.33, abs=0.005)
    assert g["n"] == 3
    assert g["lo"] <= g["gap"] <= g["hi"]
    # paired diffs are [-2, -1, -1]: every resample mean lies in [-2, -1]
    assert -2 <= g["lo"] and g["hi"] <= -1


def test_worked_example_separation():
    assert separation(URDU_C, URDU_W) == pytest.approx(6.33, abs=0.005)
    assert separation(ROMAN_C, ROMAN_W) == pytest.approx(3.00, abs=1e-9)


def test_worked_example_win_rate():
    outcomes = [1.0] * 9 + [0.0] * 2 + [0.5]
    assert len(outcomes) == 12
    assert win_rate(outcomes) == pytest.approx(0.792, abs=0.0005)


def test_auc():
    assert auc(URDU_C, URDU_W) == 1.0
    assert auc([3, 5], [5, 1]) == pytest.approx(2.5 / 4)  # pairs: 0, 1, 0.5, 1
    assert auc([5, 5], [5, 5]) == 0.5
    assert auc([], [1]) is None


def test_acceptance_rate():
    assert acceptance_rate(URDU_C, 7) == 1.0
    assert acceptance_rate(ROMAN_C, 8) == pytest.approx(1 / 3)
    assert acceptance_rate([6, 7, 8, 2], 7) == 0.5
    assert acceptance_rate([], 7) is None


def test_consistency_and_accuracy():
    v = item_variances({"a": [8, 8, 8], "b": [6, 8], "c": [5]})
    assert v == {"a": 0.0, "b": 1.0}  # single-score items are skipped
    assert accuracy([True, True, False, True]) == 0.75


def test_bootstrap_is_seeded():
    xs = [1, 4, 2, 8, 5, 7]
    assert bootstrap_ci(xs, 500, seed=3) == bootstrap_ci(xs, 500, seed=3)
    lo, hi = bootstrap_ci(xs, 500, seed=3)
    assert lo < sum(xs) / len(xs) < hi
    assert bootstrap_ci([], 500) == (None, None)


def _rows():
    rows = []
    for cond, cs, ws in (("urdu_script", URDU_C, URDU_W), ("roman_belebele", ROMAN_C, ROMAN_W)):
        for k in range(3):
            rows.append({"kind": "pointwise", "judge": "j", "item_id": f"i{k}", "condition": cond, "answer": "correct",
                         "repeat": 0, "value": cs[k], "status": "ok", "label": None})
            rows.append({"kind": "pointwise", "judge": "j", "item_id": f"i{k}", "condition": cond, "answer": "wrong",
                         "repeat": 0, "value": ws[k], "status": "ok", "label": None})
    rows.append({"kind": "pointwise", "judge": "j", "item_id": "i9", "condition": "roman_belebele", "answer": "correct",
                 "repeat": 0, "value": None, "status": "unparseable", "label": None})
    for v in [1.0] * 9 + [0.0] * 2 + [0.5]:
        rows.append({"kind": "pairwise", "judge": "j", "item_id": "x", "condition": "roman_belebele", "answer": "correct",
                     "repeat": 0, "value": v, "status": "tie" if v == 0.5 else "ok", "label": None})
    rows.append({"kind": "pairwise", "judge": "j", "item_id": "x", "condition": "roman_belebele", "answer": "correct",
                 "repeat": 0, "value": None, "status": "unparseable", "label": None})
    return rows


def test_summarize_worked_example():
    s = summarize(_rows(), threshold=7, n_resamples=200, seed=0)["judges"]["j"]
    ref, rom = s["pointwise"]
    assert ref["condition"] == "urdu_script" and ref["gap_correct"] is None
    assert rom["mean_correct"] == pytest.approx(7.333, abs=1e-3)
    assert rom["gap_correct"]["gap"] == pytest.approx(-1.333, abs=1e-3)
    assert rom["gap_wrong"]["gap"] == pytest.approx(2.0)
    assert ref["separation"] == pytest.approx(6.333, abs=1e-3) and rom["separation"] == pytest.approx(3.0)
    assert rom["unparseable"] == 1 and rom["n_correct"] == 3  # unparseable reported, not counted as a score
    pw = s["pairwise"][0]
    assert (pw["wins"], pw["losses"], pw["ties"], pw["unparseable"], pw["n"]) == (9, 2, 1, 1, 12)
    assert pw["win_rate"] == pytest.approx(0.7917, abs=1e-4)


def test_panel_averages_judges():
    rows = [
        {"judge": "a", "item_id": "i", "condition": "urdu_script", "answer": "correct", "repeat": 0, "value": 8},
        {"judge": "b", "item_id": "i", "condition": "urdu_script", "answer": "correct", "repeat": 0, "value": 6},
        {"judge": "a", "item_id": "k", "condition": "urdu_script", "answer": "correct", "repeat": 0, "value": 9},
        {"judge": "b", "item_id": "k", "condition": "urdu_script", "answer": "correct", "repeat": 0, "value": None},
    ]
    p = panel_rows(rows)
    assert len(p) == 1 and p[0]["value"] == 7.0 and p[0]["judge"] == "panel"
