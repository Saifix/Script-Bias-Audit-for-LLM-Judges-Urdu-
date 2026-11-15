"""Re-apply the current reply parsers to the stored raw replies of finished runs (no new model calls).

Use after improving a parser: every judge reply is stored verbatim in `results.raw`, so a run can be re-read
without paying again. Prints how many rows changed status.

    python -m scripts.reparse 42            # dry run
    python -m scripts.reparse 42 --write    # update the results table
"""
from __future__ import annotations

import argparse
from collections import Counter

from app.db import db
from app.judges import parse_choice, parse_pairwise, parse_score


def reparse_row(r) -> tuple:
    """(value, label, status) for one stored result row, exactly as runs.run_task would produce it."""
    value, label = None, None
    if r["kind"] == "pointwise":
        value = parse_score(r["raw"])
    elif r["kind"] == "pairwise":
        label = parse_pairwise(r["raw"])
        if label == "TIE":
            return 0.5, label, "tie"
        if label:
            value = 1.0 if (label == "A") == (r["ord"] == "AB") else 0.0
    elif r["kind"] == "comprehension":
        return (r["value"], r["label"], r["status"])  # needs the item's correct option; unchanged here
    return value, label, "ok" if value is not None else "unparseable"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_ids", type=int, nargs="+")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    with db() as c:
        for rid in a.run_ids:
            rows = c.execute("SELECT * FROM results WHERE run_id=?", (rid,)).fetchall()
            before, after, changed = Counter(), Counter(), 0
            for r in rows:
                v, lab, st = reparse_row(r)
                before[r["status"]] += 1
                after[st] += 1
                if (v, lab, st) != (r["value"], r["label"], r["status"]):
                    changed += 1
                    if a.write:
                        c.execute("UPDATE results SET value=?, label=?, status=? WHERE run_id=? AND task_id=?",
                                  (v, lab, st, rid, r["task_id"]))
            print(f"run {rid}: {len(rows)} rows, {changed} changed; before {dict(before)} -> after {dict(after)}"
                  + ("" if a.write else "  (dry run)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
