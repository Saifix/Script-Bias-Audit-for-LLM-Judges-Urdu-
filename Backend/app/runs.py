"""Runs: config validation, task planning, call estimates, the in-process worker, screening status, exports."""
from __future__ import annotations

import asyncio
import csv
import io
import json
from dataclasses import dataclass

from .config import CONDITIONS, GENERATED, LATIN_URDU, REFERENCE, RUN_TYPES, data_dir, judge_options, load_config
from .data import condition_view, load_items, now, save_generated
from .db import db
from .judges import (Call, LLMClient, cache_key, cached_keys, model_prices, numbered, parse_choice,
                     parse_numbered, parse_pairwise, parse_score, render, rubric_text)
from .metrics import summarize

RESULT_COLUMNS = ["run_id", "task_id", "kind", "judge", "item_id", "condition", "other", "answer", "ord", "repeat",
                  "raw", "value", "label", "status", "model", "provider", "ts", "prompt_tokens",
                  "completion_tokens", "cost", "calls", "cached"]


@dataclass(frozen=True)
class Task:
    """One unit of work = one judge call (plus conversion calls for the transliterate mitigation)."""
    kind: str          # generate | pointwise | pairwise | comprehension
    judge: str
    item_id: str
    condition: str
    answer: str = ""   # correct | wrong
    other: str = ""    # pairwise reference condition
    order: str = ""    # AB = condition shown as A, BA = condition shown as B
    repeat: int = 0

    @property
    def id(self) -> str:
        return "|".join([self.kind, self.judge, self.item_id, self.condition, self.answer, self.other,
                         self.order, str(self.repeat)])


# ---------------------------------------------------------------- config + planning


def normalize_config(raw: dict, app_cfg: dict) -> dict:
    """Validate a run request and fill defaults. Raises ValueError on bad input."""
    s = app_cfg["settings"]
    t = raw.get("type")
    if t not in RUN_TYPES:
        raise ValueError(f"type must be one of {RUN_TYPES}")
    known = [j["id"] for j in app_cfg["judges"]]
    judges = raw.get("judges") or known
    if bad := [j for j in judges if j not in known]:
        raise ValueError(f"unknown judges {bad}; add them to config.toml")
    conds = raw.get("conditions") or list(CONDITIONS)
    if bad := [c for c in conds if c not in CONDITIONS]:
        raise ValueError(f"unknown conditions {bad}")
    default_n = {"screening": s["pilot_items"], "repeats": s["repeat_items"]}.get(t, s["n_items"])
    flags = raw.get("flags") or {}
    cfg = {
        "type": t,
        "judges": judges,
        "conditions": [c for c in CONDITIONS if c in conds],
        "n_items": int(raw.get("n_items") or default_n),
        "repeats": int(raw.get("repeats") if raw.get("repeats") is not None else s["repeat_count"]),
        "flags": {k: bool(flags.get(k)) for k in ("rubric", "transliterate", "panel")},
    }
    if t == "generate":
        gen = [c for c in cfg["conditions"] if c in GENERATED]
        if len(gen) != 1:
            raise ValueError("generate runs need exactly one of roman_translit / code_mixed")
        cfg.update(conditions=gen, judges=[app_cfg["generator"]["model"]])
    if t == "screening":
        cfg["conditions"] = [REFERENCE, "english"]
    if t == "pairwise":
        cfg["conditions"] = [c for c in cfg["conditions"] if c != REFERENCE]
    if t != "pointwise":
        cfg["flags"] = {"rubric": False, "transliterate": False, "panel": False}
    if not cfg["conditions"]:
        raise ValueError("no conditions selected")
    return cfg


def plan_tasks(cfg: dict, items: list[dict]) -> list[Task]:
    """Deterministic task list for a run. Items lacking a (reviewed) view for a condition are skipped."""
    t, items = cfg["type"], items[: cfg["n_items"]]
    tasks: list[Task] = []
    for judge in cfg["judges"]:
        for it in items:
            for cond in cfg["conditions"]:
                if t == "generate":
                    if cond == "roman_translit" or it["code_mixed"]:
                        tasks.append(Task("generate", judge, it["id"], cond))
                    continue
                if condition_view(it, cond) is None:
                    continue
                if t == "comprehension":
                    tasks.append(Task("comprehension", judge, it["id"], cond))
                elif t in ("pointwise", "screening", "repeats"):
                    reps = range(cfg["repeats"] + 1) if t == "repeats" else [0]
                    tasks += [Task("pointwise", judge, it["id"], cond, ans, repeat=r)
                              for r in reps for ans in ("correct", "wrong")]
                elif t == "pairwise":
                    if condition_view(it, REFERENCE) is None:
                        continue
                    tasks += [Task("pairwise", judge, it["id"], cond, ans, REFERENCE, order)
                              for ans in ("correct", "wrong") for order in ("AB", "BA")]
    return tasks


def _answer_idx(item: dict, answer: str) -> int:
    return item["correct_idx"] if answer == "correct" else item["wrong_idx"]


def _texts(task: Task, item: dict) -> dict:
    v = condition_view(item, task.condition)
    return {"passage": v["passage"], "question": v["question"], "answer": v["options"][_answer_idx(item, task.answer)]}


def _judge_prompt(task: Task, item: dict, cfg: dict, texts: dict | None = None) -> str:
    """Prompt for the judge call of `task`. `texts` overrides passage/question/answer (mitigation)."""
    if task.kind == "pointwise":
        x = texts or _texts(task, item)
        return render("pointwise", **x, rubric=rubric_text() if cfg["flags"]["rubric"] else "")
    if task.kind == "pairwise":
        x, ref = _texts(task, item), _texts(Task(task.kind, task.judge, task.item_id, task.other, task.answer), item)
        a, b = (x, ref) if task.order == "AB" else (ref, x)
        return render("pairwise", passage_a=a["passage"], question_a=a["question"], answer_a=a["answer"],
                      passage_b=b["passage"], question_b=b["question"], answer_b=b["answer"])
    if task.kind == "comprehension":
        v = condition_view(item, task.condition)
        return render("comprehension", passage=v["passage"], question=v["question"], options=numbered(v["options"]))
    if task.kind == "generate":
        return render("transliterate" if task.condition == "roman_translit" else "code_mix",
                      texts=numbered(item["urd_arab"]["options"]))
    raise ValueError(task.kind)


def _needs_conversion(task: Task, cfg: dict) -> bool:
    return task.kind == "pointwise" and cfg["flags"]["transliterate"] and task.condition in LATIN_URDU


def _call_params(task: Task, app_cfg: dict) -> dict:
    if task.kind == "generate":
        return {"max_tokens": int(app_cfg["generator"].get("max_tokens", 600)), "extra": {}}
    return judge_options(app_cfg, task.judge)


# ---------------------------------------------------------------- estimate


def estimate(cfg: dict, app_cfg: dict) -> dict:
    """Calls a run will make, how many are already cached, and an estimated cost in USD."""
    with db() as c:
        items = load_items(c)
    tasks = plan_tasks(cfg, items)
    gen = app_cfg["generator"]["model"]
    planned: list[tuple[str, str, int, int]] = []  # (cache key, model, prompt chars, max output tokens)
    unknown_after_conversion = 0
    conversions: set[str] = set()
    by_id = {i["id"]: i for i in items}
    for t in tasks:
        it, p = by_id[t.item_id], _call_params(t, app_cfg)
        if _needs_conversion(t, cfg):
            conversions.update(_texts(t, it).values())
            unknown_after_conversion += 1
            planned.append(("", t.judge, len(_judge_prompt(t, it, cfg)), p["max_tokens"]))
            continue
        prompt = _judge_prompt(t, it, cfg)
        planned.append((cache_key(t.judge, prompt, p["max_tokens"], t.repeat, p["extra"]), t.judge, len(prompt), p["max_tokens"]))
    for text in conversions:
        prompt = render("to_urdu", text=text)
        mt = int(app_cfg["generator"].get("max_tokens", 600))
        planned.append((cache_key(gen, prompt, mt), gen, len(prompt), min(mt, len(text))))
    hits = cached_keys([k for k, *_ in planned if k])
    billable = [p for p in planned if p[0] not in hits and not p[1].startswith("mock/")]
    prices = model_prices() if billable else {}
    cost, priced = 0.0, True
    for key, model, chars, max_out in billable:
        if model not in prices:
            priced = False
            continue
        pin, pout = prices[model]
        cost += (chars / 3) * pin + max_out * pout  # ~3 chars/token (Urdu tokenizes poorly); max output
    status = screening_status(app_cfg)
    return {
        "tasks": len(tasks),
        "calls": len(planned),
        "cached": len(hits),
        "new_calls": len(planned) - len(hits),
        "est_cost_usd": round(cost, 4),
        "cost_complete": priced,
        "note": f"{unknown_after_conversion} judge calls follow a transliteration step; counted as new." if unknown_after_conversion else "",
        "flagged_judges": {j: status.get(j, {}).get("status", "untested") for j in cfg["judges"]
                           if cfg["type"] not in ("generate", "screening") and status.get(j, {}).get("status") != "pass"},
    }


# ---------------------------------------------------------------- execution


async def run_task(task: Task, item: dict, cfg: dict, client: LLMClient, app_cfg: dict) -> dict:
    """Execute one task and return its result row (without run_id)."""
    p = _call_params(task, app_cfg)
    model = task.judge
    calls: list[Call] = []
    texts = None
    if _needs_conversion(task, cfg):
        gen, mt = app_cfg["generator"]["model"], int(app_cfg["generator"].get("max_tokens", 600))
        src = _texts(task, item)
        conv = await asyncio.gather(*(client.complete(gen, render("to_urdu", text=v), max_tokens=mt, task="to_urdu")
                                      for v in src.values()))
        calls += conv
        texts = {k: (c.text.strip() or v) for (k, v), c in zip(src.items(), conv)}
    prompt = _judge_prompt(task, item, cfg, texts)
    kind = task.kind
    if kind == "generate":
        kind = "transliterate" if task.condition == "roman_translit" else "code_mix"
    call = await client.complete(model, prompt, max_tokens=p["max_tokens"], repeat=task.repeat, task=kind, extra=p["extra"])
    calls.append(call)

    value, label, status = None, None, "ok"
    if task.kind == "generate":
        opts = parse_numbered(call.text)
        status = "ok" if opts else "unparseable"
        if not opts:  # keep whatever came back so the reviewer can fix it
            lines = [ln.strip() for ln in call.text.splitlines() if ln.strip()]
            opts = (lines + [""] * 4)[:4]
        with db() as c:
            save_generated(c, task.item_id, task.condition, opts, call.text, call.served_model, status == "ok")
    elif task.kind == "pointwise":
        value = parse_score(call.text)
    elif task.kind == "pairwise":
        label = parse_pairwise(call.text)
        if label == "TIE":
            value, status = 0.5, "tie"
        elif label:
            value = 1.0 if (label == "A") == (task.order == "AB") else 0.0
    elif task.kind == "comprehension":
        choice = parse_choice(call.text)
        if choice:
            value, label = float(choice), "correct" if choice - 1 == item["correct_idx"] else "incorrect"
    if value is None and task.kind != "generate":
        status = "unparseable"

    return {
        "task_id": task.id, "kind": task.kind, "judge": task.judge, "item_id": task.item_id,
        "condition": task.condition, "other": task.other, "answer": task.answer, "ord": task.order,
        "repeat": task.repeat, "raw": call.text, "value": value, "label": label, "status": status,
        "model": call.served_model, "provider": call.provider, "ts": call.ts,
        "prompt_tokens": sum(c.prompt_tokens for c in calls if not c.cached),
        "completion_tokens": sum(c.completion_tokens for c in calls if not c.cached),
        "cost": sum(c.cost for c in calls if not c.cached),
        "calls": len(calls), "cached": int(all(c.cached for c in calls)),
    }


RUNNING: dict[int, asyncio.Task] = {}


def _set_run(run_id: int, **fields) -> None:
    fields["updated_at"] = now()
    with db() as c:
        c.execute(f"UPDATE runs SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", [*fields.values(), run_id])


def create_run(cfg: dict) -> int:
    with db() as c:
        cur = c.execute("INSERT INTO runs (type, config, status, created_at, updated_at) VALUES (?,?,?,?,?)",
                        (cfg["type"], json.dumps(cfg), "created", now(), now()))
        return int(cur.lastrowid)


async def execute_run(run_id: int, client: LLMClient | None = None) -> None:
    """Run all pending tasks of a run. Finished tasks are skipped, so this also resumes a run."""
    app_cfg = load_config()
    s = app_cfg["settings"]
    with db() as c:
        run = c.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        items = {it["id"]: it for it in load_items(c)}
        done = {r[0] for r in c.execute("SELECT task_id FROM results WHERE run_id=?", (run_id,))}
    cfg = json.loads(run["config"])
    tasks = plan_tasks(cfg, list(items.values()))
    pending = [t for t in tasks if t.id not in done]
    _set_run(run_id, status="running", total=len(tasks), error=None)
    own = client is None
    client = client or LLMClient(s["concurrency"], s["max_retries"])

    async def one(t: Task) -> None:
        row = await run_task(t, items[t.item_id], cfg, client, app_cfg)
        with db() as c:
            c.execute(f"INSERT OR REPLACE INTO results ({','.join(RESULT_COLUMNS)}) VALUES ({','.join('?' * len(RESULT_COLUMNS))})",
                      [run_id if k == "run_id" else row[k] for k in RESULT_COLUMNS])

    try:
        async with asyncio.TaskGroup() as tg:
            for t in pending:
                tg.create_task(one(t))
        _set_run(run_id, status="done")
        write_exports(run_id)
    except asyncio.CancelledError:
        _set_run(run_id, status="stopped")
    except BaseException as e:  # ExceptionGroup from the TaskGroup
        first = e.exceptions[0] if isinstance(e, BaseExceptionGroup) else e
        _set_run(run_id, status="failed", error=str(first)[:500])
    finally:
        if own:
            await client.aclose()


def start_run(run_id: int) -> None:
    """Start (or resume) a run in the background on the current event loop."""
    if run_id in RUNNING and not RUNNING[run_id].done():
        return
    RUNNING[run_id] = asyncio.get_running_loop().create_task(execute_run(run_id))


def stop_run(run_id: int) -> bool:
    t = RUNNING.get(run_id)
    if t and not t.done():
        t.cancel()
        return True
    return False


# ---------------------------------------------------------------- reading results


def list_runs() -> list[dict]:
    with db() as c:
        runs = [dict(r) for r in c.execute("SELECT * FROM runs ORDER BY id DESC")]
        agg = {r["run_id"]: dict(r) for r in c.execute(
            "SELECT run_id, COUNT(*) AS done, SUM(cost) AS cost, SUM(cached) AS cache_hits, "
            "SUM(calls) AS calls, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens, "
            "SUM(status='unparseable') AS unparseable FROM results GROUP BY run_id")}
    for r in runs:
        r["config"] = json.loads(r["config"])
        a = agg.get(r["id"], {})
        for k in ("done", "cost", "cache_hits", "calls", "prompt_tokens", "completion_tokens", "unparseable"):
            r[k] = a.get(k) or 0
    return runs


def run_rows(run_id: int) -> list[dict]:
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM results WHERE run_id=? ORDER BY task_id", (run_id,))]


def run_summary(run_id: int) -> dict:
    s = load_config()["settings"]
    with db() as c:
        run = c.execute("SELECT config FROM runs WHERE id=?", (run_id,)).fetchone()
    if not run:
        raise KeyError(run_id)
    cfg = json.loads(run["config"])
    return summarize(run_rows(run_id), threshold=s["acceptance_threshold"], n_resamples=s["bootstrap_resamples"],
                     seed=s["seed"], panel=cfg["flags"].get("panel", False))


def screening_status(app_cfg: dict | None = None) -> dict[str, dict]:
    """Per judge: pass / fail / untested from its latest finished screening run."""
    app_cfg = app_cfg or load_config()
    thr = app_cfg["settings"]["screening_auc_threshold"]
    with db() as c:
        runs = [dict(r) for r in c.execute("SELECT id, config FROM runs WHERE type='screening' AND status='done' ORDER BY id DESC")]
    out: dict[str, dict] = {}
    for run in runs:
        judges = [j for j in json.loads(run["config"])["judges"] if j not in out]
        if not judges:
            continue
        summary = summarize([r for r in run_rows(run["id"]) if r["judge"] in judges], n_resamples=0)
        for j in judges:
            aucs = {p["condition"]: p["auc"] for p in summary["judges"].get(j, {}).get("pointwise", [])}
            passed = bool(aucs) and all(a is not None and a > thr for a in aucs.values())
            out[j] = {"status": "pass" if passed else "fail", "auc": aucs, "run_id": run["id"], "threshold": thr}
    return out


def results_csv(run_id: int) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=RESULT_COLUMNS)
    w.writeheader()
    w.writerows(run_rows(run_id))
    return buf.getvalue()


def results_json(run_id: int) -> dict:
    run = next((r for r in list_runs() if r["id"] == run_id), None)
    if run is None:
        raise KeyError(run_id)
    return {"run": run, "summary": run_summary(run_id), "results": run_rows(run_id)}


def write_exports(run_id: int) -> None:
    """Write CSV + JSON copies to DATA_DIR/exports when a run finishes."""
    d = data_dir() / "exports"
    d.mkdir(exist_ok=True)
    (d / f"run_{run_id}.csv").write_text(results_csv(run_id), encoding="utf-8")
    (d / f"run_{run_id}.json").write_text(json.dumps(results_json(run_id), ensure_ascii=False, indent=1), encoding="utf-8")
