"""Belebele data pipeline: download, join parallel configs, seeded sampling, script-condition views."""
from __future__ import annotations

import hashlib
import json
import random
import sqlite3
from datetime import datetime, timezone

from .config import GENERATED

CONFIGS = ["urd_Arab", "urd_Latn", "eng_Latn"]


def fetch_belebele() -> dict[str, list[dict]]:
    """Download the three Belebele configs from Hugging Face (test split)."""
    from datasets import load_dataset  # heavy import, only needed here

    return {cfg: [dict(r) for r in load_dataset("facebook/belebele", cfg, split="test")] for cfg in CONFIGS}


def _view(row: dict) -> dict:
    return {
        "passage": row["flores_passage"],
        "question": row["question"],
        "options": [row[f"mc_answer{i}"] for i in range(1, 5)],
    }


def build_items(rows_by_config: dict[str, list[dict]], n: int, seed: int, code_mixed_n: int) -> list[dict]:
    """Join configs on (link, question_number), sample `n` items with `seed`, pick one wrong option each.

    Items whose correct answer differs between configs are dropped (not parallel).
    The first `code_mixed_n` sampled items form the code-mixed subset.
    """
    keyed = {
        cfg: {(r["link"], int(r["question_number"])): r for r in rows}
        for cfg, rows in rows_by_config.items()
    }
    common = sorted(set.intersection(*(set(k) for k in keyed.values())))
    common = [
        k for k in common
        if len({str(keyed[cfg][k]["correct_answer_num"]) for cfg in CONFIGS}) == 1
    ]
    chosen = random.Random(seed).sample(common, min(n, len(common)))
    items = []
    for pos, (link, qnum) in enumerate(chosen):
        correct = int(keyed["urd_Arab"][(link, qnum)]["correct_answer_num"]) - 1
        wrong = random.Random(f"{seed}:{link}:{qnum}").choice([i for i in range(4) if i != correct])
        items.append({
            "id": hashlib.sha1(f"{link}#{qnum}".encode()).hexdigest()[:10],
            "pos": pos,
            "link": link,
            "question_number": qnum,
            "correct_idx": correct,
            "wrong_idx": wrong,
            "code_mixed": pos < code_mixed_n,
            "urd_arab": _view(keyed["urd_Arab"][(link, qnum)]),
            "urd_latn": _view(keyed["urd_Latn"][(link, qnum)]),
            "eng_latn": _view(keyed["eng_Latn"][(link, qnum)]),
        })
    return items


def save_items(conn: sqlite3.Connection, items: list[dict]) -> None:
    """Replace the item set. Also clears generated text and reviews (they belong to the old sample)."""
    conn.execute("DELETE FROM items")
    conn.execute("DELETE FROM generated")
    conn.executemany(
        "INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?)",
        [(
            it["id"], it["pos"], it["link"], it["question_number"], it["correct_idx"], it["wrong_idx"],
            int(it["code_mixed"]), json.dumps(it["urd_arab"], ensure_ascii=False),
            json.dumps(it["urd_latn"], ensure_ascii=False), json.dumps(it["eng_latn"], ensure_ascii=False),
        ) for it in items],
    )


def load_items(conn: sqlite3.Connection, limit: int | None = None) -> list[dict]:
    """Items in sample order, each with its generated texts ({condition: row}) attached."""
    rows = conn.execute("SELECT * FROM items ORDER BY pos" + (f" LIMIT {int(limit)}" if limit else "")).fetchall()
    gen: dict[str, dict] = {}
    for g in conn.execute("SELECT * FROM generated"):
        gen.setdefault(g["item_id"], {})[g["condition"]] = {**dict(g), "options": json.loads(g["options"])}
    items = []
    for r in rows:
        it = dict(r)
        it["code_mixed"] = bool(it["code_mixed"])
        for k in ("urd_arab", "urd_latn", "eng_latn"):
            it[k] = json.loads(it[k])
        it["generated"] = gen.get(it["id"], {})
        items.append(it)
    return items


def condition_view(item: dict, condition: str, approved_only: bool = True) -> dict | None:
    """Passage, question and 4 options for `item` in `condition`, or None if unavailable.

    roman_translit / code_mixed use Belebele's urd_Latn passage + question with generated options,
    and are only available once a reviewer approved them (unless approved_only=False).
    """
    if condition == "urdu_script":
        return item["urd_arab"]
    if condition == "roman_belebele":
        return item["urd_latn"]
    if condition == "english":
        return item["eng_latn"]
    if condition in GENERATED:
        if condition == "code_mixed" and not item["code_mixed"]:
            return None
        g = item["generated"].get(condition)
        if not g or (approved_only and g["status"] != "approved"):
            return None
        return {"passage": item["urd_latn"]["passage"], "question": item["urd_latn"]["question"], "options": g["options"]}
    raise ValueError(f"unknown condition {condition}")


def save_generated(conn: sqlite3.Connection, item_id: str, condition: str, options: list[str],
                   raw: str, model: str, parse_ok: bool) -> None:
    """Store generated text for review. Never overwrites an existing (possibly reviewed) row."""
    conn.execute(
        "INSERT OR IGNORE INTO generated (item_id, condition, options, raw, model, parse_ok, status, created_at) "
        "VALUES (?,?,?,?,?,?, 'pending', ?)",
        (item_id, condition, json.dumps(options, ensure_ascii=False), raw, model, int(parse_ok), now()),
    )


def review(conn: sqlite3.Connection, item_id: str, condition: str, action: str, reviewer: str,
           options: list[str] | None = None) -> None:
    """Apply a review action: approve, reject, or edit (saves edited options and approves)."""
    status = {"approve": "approved", "reject": "rejected", "edit": "approved"}[action]
    if action == "edit":
        if not options or len(options) != 4:
            raise ValueError("edit needs 4 options")
        conn.execute("UPDATE generated SET options=?, edited=1 WHERE item_id=? AND condition=?",
                     (json.dumps(options, ensure_ascii=False), item_id, condition))
    cur = conn.execute(
        "UPDATE generated SET status=?, reviewer=?, reviewed_at=? WHERE item_id=? AND condition=?",
        (status, reviewer, now(), item_id, condition),
    )
    if cur.rowcount == 0:
        raise KeyError("no generated text for this item/condition")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def import_generated(conn: sqlite3.Connection, data: dict[str, list[dict]], model: str,
                     approve_as: str | None = None, replace: bool = False) -> dict[str, int]:
    """Import externally written roman_translit / code_mixed options: {condition: [{"id", "options": [4]}]}.
    `approve_as` marks rows approved with that reviewer label (recorded for provenance); otherwise they go to the
    review queue as pending. Existing rows are kept unless `replace`. Returns counts per outcome."""
    items = {it["id"]: it for it in load_items(conn)}
    counts = {"imported": 0, "skipped_existing": 0, "rejected": 0}
    for cond, rows in data.items():
        if cond not in GENERATED:
            raise ValueError(f"unknown generated condition {cond}")
        for row in rows:
            it, opts = items.get(row.get("id")), row.get("options")
            ok = (it is not None and isinstance(opts, list) and len(opts) == 4
                  and all(isinstance(o, str) and o.strip() for o in opts))
            if not ok:
                counts["rejected"] += 1
                continue
            if not replace and conn.execute("SELECT 1 FROM generated WHERE item_id=? AND condition=?", (it["id"], cond)).fetchone():
                counts["skipped_existing"] += 1
                continue
            conn.execute(
                "INSERT OR REPLACE INTO generated (item_id, condition, options, raw, model, parse_ok, status, edited, reviewer, reviewed_at, created_at) "
                "VALUES (?,?,?,?,?,1,?,0,?,?,?)",
                (it["id"], cond, json.dumps([o.strip() for o in opts], ensure_ascii=False), "", model,
                 "approved" if approve_as else "pending", approve_as, now() if approve_as else None, now()),
            )
            if cond == "code_mixed":  # importing a code-mixed version puts the item in the code-mixed set
                conn.execute("UPDATE items SET code_mixed=1 WHERE id=?", (it["id"],))
            counts["imported"] += 1
    return counts
