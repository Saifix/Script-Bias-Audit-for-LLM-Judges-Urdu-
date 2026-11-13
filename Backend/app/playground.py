"""Live demo: run one question (a Belebele sample or hand-written text) through the judges in every script
and return scores, pairwise picks and multiple-choice picks side by side. Uses the same prompts, parsers and cache."""
from __future__ import annotations

import asyncio
import json
import re

from .config import CONDITIONS, REFERENCE, judge_options, load_config
from .data import condition_view, load_items
from .db import db
from .judges import LLMClient, numbered, parse_choice, parse_pairwise, parse_score, render, rubric_text

MAX_TEXT = 4000
MAX_JUDGES = 6


def _texts_from_item(item: dict) -> dict:
    out = {}
    for cond in CONDITIONS:
        v = condition_view(item, cond, approved_only=False)
        if v is None:
            continue
        g = item["generated"].get(cond)
        out[cond] = {
            "passage": v["passage"], "question": v["question"], "options": v["options"],
            "answers": {"correct": v["options"][item["correct_idx"]], "wrong": v["options"][item["wrong_idx"]]},
            "status": g["status"] if g else "source",
        }
    return out


def _texts_from_custom(custom: dict) -> dict:
    out = {}
    for cond, t in custom.items():
        if cond not in CONDITIONS or not isinstance(t, dict):
            continue
        passage, question, answer = (str(t.get(k, "")).strip() for k in ("passage", "question", "answer"))
        if not (passage and question and answer):
            continue
        if max(len(passage), len(question), len(answer)) > MAX_TEXT:
            raise ValueError(f"{cond}: texts are limited to {MAX_TEXT} characters")
        out[cond] = {"passage": passage, "question": question, "answers": {"answer": answer}, "status": "custom"}
    return out


async def run_playground(req: dict) -> dict:
    """Run the demo. `req`: judges, item_id | custom, scores, pairwise, mcq, rubric (bools)."""
    app_cfg = load_config()
    known = [j["id"] for j in app_cfg["judges"]]
    judges = [j for j in (req.get("judges") or []) if j in known][:MAX_JUDGES]
    if not judges:
        raise ValueError("pick at least one configured judge")
    item = None
    if req.get("item_id"):
        with db() as c:
            item = next((it for it in load_items(c) if it["id"] == req["item_id"]), None)
        if item is None:
            raise ValueError("item not found")
        texts = _texts_from_item(item)
    else:
        texts = _texts_from_custom(req.get("custom") or {})
    if not texts:
        raise ValueError("fill in passage, question and answer for at least one script")

    rubric = rubric_text() if req.get("rubric") else ""
    jobs: list[tuple[dict, str, str, dict]] = []  # (result stub, judge, prompt, task)
    for j in judges:
        for cond, t in texts.items():
            if req.get("scores", True):
                for key, ans in t["answers"].items():
                    p = render("pointwise", passage=t["passage"], question=t["question"], answer=ans, rubric=rubric)
                    jobs.append(({"kind": "pointwise", "judge": j, "condition": cond, "answer": key}, j, p, "pointwise"))
            if req.get("mcq", True) and "options" in t:
                p = render("comprehension", passage=t["passage"], question=t["question"], options=numbered(t["options"]))
                jobs.append(({"kind": "comprehension", "judge": j, "condition": cond}, j, p, "comprehension"))
            if req.get("pairwise", True) and cond != REFERENCE and REFERENCE in texts:
                ref = texts[REFERENCE]
                for key in t["answers"]:
                    if key not in ref["answers"]:
                        continue
                    x = (t["passage"], t["question"], t["answers"][key])
                    r = (ref["passage"], ref["question"], ref["answers"][key])
                    for order in ("AB", "BA"):
                        a, b = (x, r) if order == "AB" else (r, x)
                        p = render("pairwise", passage_a=a[0], question_a=a[1], answer_a=a[2],
                                   passage_b=b[0], question_b=b[1], answer_b=b[2])
                        jobs.append(({"kind": "pairwise", "judge": j, "condition": cond, "answer": key, "order": order}, j, p, "pairwise"))

    s = app_cfg["settings"]
    client = LLMClient(s["concurrency"], max_retries=2)

    async def one(stub: dict, judge: str, prompt: str, task: str) -> dict:
        opts = judge_options(app_cfg, judge)
        try:
            call = await client.complete(judge, prompt, max_tokens=opts["max_tokens"], task=task, extra=opts["extra"])
        except Exception as e:  # report per call, keep the rest
            return {**stub, "error": str(e)[:300]}
        out = {**stub, "raw": call.text, "model": call.served_model, "provider": call.provider,
               "cost": 0.0 if call.cached else call.cost, "cached": call.cached}
        if task == "pointwise":
            out["score"] = parse_score(call.text)
        elif task == "pairwise":
            label = parse_pairwise(call.text)
            shown_first = stub["condition"] if stub["order"] == "AB" else REFERENCE
            shown_second = REFERENCE if stub["order"] == "AB" else stub["condition"]
            out["label"] = label
            out["winner"] = {"A": shown_first, "B": shown_second, "TIE": "tie"}.get(label or "", None)
        else:
            choice = parse_choice(call.text)
            out["choice"] = choice
            out["correct"] = None if choice is None else (choice - 1 == item["correct_idx"])
        return out

    try:
        results = await asyncio.gather(*(one(*job) for job in jobs))
    finally:
        await client.aclose()
    return {
        "item": None if item is None else {"id": item["id"], "pos": item["pos"], "correct_idx": item["correct_idx"], "wrong_idx": item["wrong_idx"]},
        "conditions": [c for c in CONDITIONS if c in texts],
        "texts": texts,
        "judges": judges,
        "results": results,
        "cost_usd": sum(r.get("cost", 0) for r in results),
        "calls": len(results),
        "cached": sum(bool(r.get("cached")) for r in results),
    }


# ---------------------------------------------------------------- voice note -> form fields

VOICE_FORMATS = {"webm", "ogg", "m4a", "mp3", "wav", "flac", "aac"}
MAX_AUDIO_B64 = 8_000_000  # ~6 MB of audio, a few minutes of opus
FIELD_CONDS = ["urdu_script", "roman_translit", "english", "code_mixed"]


def _parse_fields(text: str) -> dict:
    """Pull the JSON object out of a model reply (tolerates code fences / chatter)."""
    m = re.search(r"\{.*\}", text or "", re.S)
    data = json.loads(m.group(0)) if m else {}
    out = {}
    for cond in FIELD_CONDS:
        v = data.get(cond) if isinstance(data.get(cond), dict) else {}
        out[cond] = {k: str(v.get(k, "")).strip() for k in ("passage", "question", "answer")}
    return out


async def voice_to_fields(audio_b64: str, fmt: str) -> dict:
    """Transcribe a voice note (Whisper via OpenRouter) and let the generator LLM fill the form in all four scripts."""
    fmt = fmt.lower()
    if fmt not in VOICE_FORMATS:
        raise ValueError(f"unsupported audio format {fmt}")
    if not audio_b64 or len(audio_b64) > MAX_AUDIO_B64:
        raise ValueError("voice note is empty or too long")
    app_cfg = load_config()
    gen = app_cfg["generator"]
    client = LLMClient(2, max_retries=2)
    try:
        heard = await client.transcribe(app_cfg["voice"]["model"], audio_b64, fmt)
        if not heard.text.strip():
            raise ValueError("could not hear anything in the voice note")
        reply = await client.complete(gen["model"], render("voice_to_fields", transcript=heard.text.strip()),
                                      max_tokens=int(gen.get("max_tokens", 600)) * 2, task="voice_format")
    finally:
        await client.aclose()
    try:
        fields = _parse_fields(reply.text)
    except json.JSONDecodeError:
        raise ValueError("could not turn the voice note into fields; please type them instead")
    return {
        "transcript": heard.text.strip(),
        "fields": fields,
        "cost_usd": (0 if heard.cached else heard.cost) + (0 if reply.cached else reply.cost),
    }
