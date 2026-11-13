"""Import externally written Roman-Urdu / code-mixed options into the database.

    python -m scripts.import_generated generated.json \
        --model "anthropic/claude-opus-5.5 (high effort)" \
        --approve-as "auto-approved: Claude Opus 5.5 (high effort)"

generated.json: {"roman_translit": [{"id": "...", "options": [4 strings]}, ...], "code_mixed": [...]}
Without --approve-as the rows go to the review queue as pending. Existing rows are kept unless --replace.
"""
from __future__ import annotations

import argparse
import json

from app.data import import_generated
from app.db import db, init_db


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--model", required=True, help="provenance label stored with every row")
    ap.add_argument("--approve-as", default=None, help="mark approved, with this reviewer label")
    ap.add_argument("--replace", action="store_true", help="overwrite existing rows")
    args = ap.parse_args()
    data = {k: v for k, v in json.load(open(args.file, encoding="utf-8")).items() if not k.startswith("_")}
    init_db()
    with db() as c:
        counts = import_generated(c, data, args.model, args.approve_as, args.replace)
    print(json.dumps(counts))
    return 0 if counts["rejected"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
