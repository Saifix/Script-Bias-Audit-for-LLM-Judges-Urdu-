"""Metrics: pure functions over scores/outcomes, plus `summarize` over result rows. No I/O."""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

import numpy as np

from .config import CONDITIONS, REFERENCE


def mean(xs: Iterable[float]) -> float | None:
    xs = list(xs)
    return float(np.mean(xs)) if xs else None


def bootstrap_ci(values: Iterable[float], n_resamples: int = 1000, seed: int = 0,
                 alpha: float = 0.05) -> tuple[float | None, float | None]:
    """Percentile bootstrap CI of the mean (seeded, reproducible)."""
    v = np.asarray(list(values), dtype=float)
    if v.size == 0 or n_resamples <= 0:
        return None, None
    rng = np.random.default_rng(seed)
    stats = v[rng.integers(0, v.size, size=(n_resamples, v.size))].mean(axis=1)
    return float(np.percentile(stats, 100 * alpha / 2)), float(np.percentile(stats, 100 * (1 - alpha / 2)))


def paired_gap(ref: dict[str, float], cond: dict[str, float], n_resamples: int = 1000, seed: int = 0) -> dict:
    """Mean(cond) - mean(ref) over items scored in both, with a paired bootstrap 95% CI.
    Negative gap = the judge is more severe on `cond` than on the reference."""
    ids = sorted(set(ref) & set(cond))
    diffs = [cond[i] - ref[i] for i in ids]
    lo, hi = bootstrap_ci(diffs, n_resamples, seed)
    return {"gap": mean(diffs), "lo": lo, "hi": hi, "n": len(ids)}


def auc(pos: Iterable[float], neg: Iterable[float]) -> float | None:
    """P(score of a correct answer > score of a wrong answer), ties count 0.5 (Mann-Whitney AUC)."""
    p, n = np.asarray(list(pos), dtype=float), np.asarray(list(neg), dtype=float)
    if p.size == 0 or n.size == 0:
        return None
    diff = p[:, None] - n[None, :]
    return float(((diff > 0).sum() + 0.5 * (diff == 0).sum()) / diff.size)


def separation(pos: Iterable[float], neg: Iterable[float]) -> float | None:
    """Mean score on correct answers minus mean score on wrong answers."""
    a, b = mean(pos), mean(neg)
    return None if a is None or b is None else a - b


def win_rate(outcomes: Iterable[float]) -> float | None:
    """Share of comparisons won; outcomes are 1 (win), 0.5 (tie), 0 (loss). Fair value = 0.5."""
    return mean(outcomes)


def acceptance_rate(scores: Iterable[float], threshold: float = 7) -> float | None:
    """Share of scores at or above `threshold`."""
    s = list(scores)
    return sum(x >= threshold for x in s) / len(s) if s else None


def item_variances(scores_by_item: dict[str, list[float]]) -> dict[str, float]:
    """Per-item population variance across repeats (items with >= 2 scores only)."""
    return {k: float(np.var(v)) for k, v in scores_by_item.items() if len(v) >= 2}


def accuracy(correct_flags: Iterable[bool]) -> float | None:
    f = list(correct_flags)
    return sum(f) / len(f) if f else None


def panel_rows(rows: list[dict]) -> list[dict]:
    """Virtual 'panel' judge: mean score of all judges, for answers every judge scored."""
    judges = {r["judge"] for r in rows}
    groups: dict[tuple, dict[str, float]] = defaultdict(dict)
    for r in rows:
        if r["value"] is not None:
            groups[(r["item_id"], r["condition"], r["answer"], r["repeat"])][r["judge"]] = r["value"]
    return [
        {"kind": "pointwise", "judge": "panel", "item_id": i, "condition": c, "answer": a, "repeat": rep,
         "value": float(np.mean(list(v.values()))), "status": "ok"}
        for (i, c, a, rep), v in groups.items() if set(v) == judges
    ]


def _order(conds: Iterable[str]) -> list[str]:
    return sorted(set(conds), key=lambda c: CONDITIONS.index(c) if c in CONDITIONS else 99)


def summarize(rows: list[dict], *, reference: str = REFERENCE, threshold: float = 7, n_resamples: int = 1000,
              seed: int = 0, panel: bool = False) -> dict:
    """All metrics per judge x condition from result rows (dicts with the `results` table columns).
    Unparseable outputs and ties are counted separately and never treated as failures."""
    point = [r for r in rows if r["kind"] == "pointwise"]
    if panel and len({r["judge"] for r in point}) > 1:
        point = point + panel_rows(point)
    pair = [r for r in rows if r["kind"] == "pairwise"]
    comp = [r for r in rows if r["kind"] == "comprehension"]
    judges = sorted({r["judge"] for r in point + pair + comp}, key=lambda j: (j == "panel", j))

    out: dict[str, dict] = {}
    for j in judges:
        res: dict[str, list] = {"pointwise": [], "pairwise": [], "comprehension": [], "consistency": []}
        pj = [r for r in point if r["judge"] == j]
        base = [r for r in pj if r["repeat"] == 0]

        def scores(cond: str, answer: str) -> dict[str, float]:
            return {r["item_id"]: r["value"] for r in base
                    if r["condition"] == cond and r["answer"] == answer and r["value"] is not None}

        for cond in _order(r["condition"] for r in base):
            c, w = scores(cond, "correct"), scores(cond, "wrong")
            is_ref = cond == reference
            res["pointwise"].append({
                "condition": cond,
                "n_correct": len(c), "n_wrong": len(w),
                "unparseable": sum(r["status"] == "unparseable" for r in base if r["condition"] == cond),
                "mean_correct": mean(c.values()), "mean_wrong": mean(w.values()),
                "gap_correct": None if is_ref else paired_gap(scores(reference, "correct"), c, n_resamples, seed),
                "gap_wrong": None if is_ref else paired_gap(scores(reference, "wrong"), w, n_resamples, seed),
                "auc": auc(c.values(), w.values()),
                "separation": separation(c.values(), w.values()),
                "accept_correct": acceptance_rate(c.values(), threshold),
                "accept_wrong": acceptance_rate(w.values(), threshold),
            })

        for cond in _order(r["condition"] for r in pj if r["repeat"] > 0):
            by_item: dict[str, list[float]] = defaultdict(list)
            for r in pj:
                if r["condition"] == cond and r["value"] is not None:
                    by_item[f'{r["item_id"]}:{r["answer"]}'].append(r["value"])
            var = item_variances(by_item)
            res["consistency"].append({
                "condition": cond, "n_items": len(var), "mean_variance": mean(var.values()),
                "max_variance": max(var.values()) if var else None,
                "share_identical": (sum(v == 0 for v in var.values()) / len(var)) if var else None,
            })

        pw = [r for r in pair if r["judge"] == j]
        for cond in _order(r["condition"] for r in pw):
            rs = [r for r in pw if r["condition"] == cond]
            outs = [r["value"] for r in rs if r["value"] is not None]
            lo, hi = bootstrap_ci(outs, n_resamples, seed)
            res["pairwise"].append({
                "condition": cond, "versus": reference, "n": len(outs),
                "wins": sum(v == 1 for v in outs), "losses": sum(v == 0 for v in outs),
                "ties": sum(v == 0.5 for v in outs),
                "unparseable": sum(r["status"] == "unparseable" for r in rs),
                "win_rate": win_rate(outs), "lo": lo, "hi": hi,
            })

        cj = [r for r in comp if r["judge"] == j]
        for cond in _order(r["condition"] for r in cj):
            rs = [r for r in cj if r["condition"] == cond]
            ok = [r["label"] == "correct" for r in rs if r["value"] is not None]
            res["comprehension"].append({
                "condition": cond, "n": len(ok), "accuracy": accuracy(ok),
                "unparseable": sum(r["status"] == "unparseable" for r in rs),
            })
        out[j] = res
    return {"reference": reference, "threshold": threshold, "judges": out}
