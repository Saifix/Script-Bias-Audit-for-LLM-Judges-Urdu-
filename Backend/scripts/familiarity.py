"""Familiarity (optional): perplexity per character of every answer, under a local Hugging Face model.

APIs rarely return prompt log-probabilities, so this runs a causal LM locally with `transformers`.
Skips gracefully when torch/transformers are missing or no GPU is available (use --cpu to force CPU).

    pip install -r requirements-familiarity.txt
    python -m scripts.familiarity --model Qwen/Qwen2.5-0.5B --items 300

Writes DATA_DIR/exports/familiarity.csv with columns: item_id, condition, answer, chars, ppl_per_char.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys

from app.config import CONDITIONS, data_dir
from app.data import condition_view, load_items
from app.db import db, init_db


def ppl_per_char(model, tokenizer, text: str, device: str) -> float:
    """exp(total negative log-likelihood / number of characters). Comparable across scripts,
    unlike per-token perplexity, because tokenizers split scripts very differently."""
    import torch

    ids = tokenizer(text, return_tensors="pt").input_ids.to(device)
    if tokenizer.bos_token_id is not None and ids[0, 0] != tokenizer.bos_token_id:
        ids = torch.cat([torch.tensor([[tokenizer.bos_token_id]], device=device), ids], dim=1)
    with torch.no_grad():
        loss = model(ids, labels=ids).loss.item()  # mean NLL over predicted tokens
    return math.exp(loss * (ids.shape[1] - 1) / max(len(text), 1))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B")
    ap.add_argument("--items", type=int, default=300)
    ap.add_argument("--cpu", action="store_true", help="run on CPU when no GPU is available (slow)")
    args = ap.parse_args()

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError:
        print("familiarity: torch/transformers not installed - skipping. pip install -r requirements-familiarity.txt")
        return 0
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu" and not args.cpu:
        print("familiarity: no GPU available - skipping (pass --cpu to run anyway).")
        return 0

    init_db()
    with db() as c:
        items = load_items(c, args.items)
    if not items:
        print("familiarity: no items loaded yet - load Belebele first.")
        return 1

    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model).to(device).eval()
    out = data_dir() / "exports" / "familiarity.csv"
    out.parent.mkdir(exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["item_id", "condition", "answer", "chars", "ppl_per_char", "model"])
        for n, it in enumerate(items, 1):
            for cond in CONDITIONS:
                v = condition_view(it, cond)
                if v is None:
                    continue
                for answer, idx in (("correct", it["correct_idx"]), ("wrong", it["wrong_idx"])):
                    text = v["options"][idx]
                    w.writerow([it["id"], cond, answer, len(text), round(ppl_per_char(model, tok, text, device), 4), args.model])
            print(f"\r{n}/{len(items)} items", end="", file=sys.stderr)
    print(f"\nfamiliarity: wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
