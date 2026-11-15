"""Copy finished runs between databases (e.g. a run made on a laptop -> the live server), with their cached calls.

    python -m scripts.transfer_run export 42 --out run42.json      # on the source machine
    python -m scripts.transfer_run import run42.json               # on the target (inside the backend container)

Export writes the run rows, their results, and the cache entries those results used (matched by judge model and the
run's time window), so the target can show the run and never pays for the calls again. Import refuses to overwrite a
run ID that already exists with different content; everything is inserted in one transaction.
"""
from __future__ import annotations

import argparse
import json
import sys

from app.db import db, init_db


def _rows(c, sql, args=()):
    return [dict(r) for r in c.execute(sql, args)]


def export(run_ids: list[int], out: str) -> None:
    with db() as c:
        runs = _rows(c, f"SELECT * FROM runs WHERE id IN ({','.join('?' * len(run_ids))})", run_ids)
        if len(runs) != len(run_ids) or any(r["status"] != "done" for r in runs):
            sys.exit("every run must exist and be done")
        results, cache = [], []
        for r in runs:
            results += _rows(c, "SELECT * FROM results WHERE run_id=?", (r["id"],))
            judges = json.loads(r["config"])["judges"]
            cache += _rows(c, f"SELECT * FROM cache WHERE model IN ({','.join('?' * len(judges))}) "
                              "AND created_at >= ? AND created_at <= ?", (*judges, r["created_at"], r["updated_at"]))
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"runs": runs, "results": results, "cache": cache}, f, ensure_ascii=False)
    print(f"exported {len(runs)} runs, {len(results)} results, {len(cache)} cache rows, "
          f"cost ${sum(x['cost'] or 0 for x in cache):.4f} -> {out}")


def _insert(c, table: str, row: dict, verb: str = "INSERT") -> None:
    cols = list(row)
    c.execute(f"{verb} INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [row[k] for k in cols])


def import_(path: str) -> None:
    data = json.load(open(path, encoding="utf-8"))
    init_db()
    with db() as c:
        for r in data["runs"]:
            have = c.execute("SELECT config FROM runs WHERE id=?", (r["id"],)).fetchone()
            if have and have[0] != r["config"]:
                sys.exit(f"run {r['id']} already exists here with a different config; not importing")
        for r in data["runs"]:
            _insert(c, "runs", r, "INSERT OR REPLACE")
        for r in data["results"]:
            _insert(c, "results", r, "INSERT OR REPLACE")
        new_cache = 0
        for r in data["cache"]:
            new_cache += c.execute("SELECT 1 FROM cache WHERE key=?", (r["key"],)).fetchone() is None
            _insert(c, "cache", r, "INSERT OR IGNORE")
        c.execute("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name='runs'", (max(r["id"] for r in data["runs"]),))
    from app.runs import write_exports
    for r in data["runs"]:
        write_exports(r["id"])
    print(f"imported {len(data['runs'])} runs, {len(data['results'])} results, {new_cache} new cache rows")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export"); e.add_argument("run_ids", type=int, nargs="+"); e.add_argument("--out", required=True)
    i = sub.add_parser("import"); i.add_argument("path")
    a = ap.parse_args()
    export(a.run_ids, a.out) if a.cmd == "export" else import_(a.path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
