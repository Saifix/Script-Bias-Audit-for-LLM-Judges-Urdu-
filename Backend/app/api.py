"""HTTP API (FastAPI). All routes live under /api; the Next.js frontend proxies to them."""
from __future__ import annotations

import hmac
import threading
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from . import runs
from .config import CONDITIONS, GENERATED, REFERENCE, RUN_TYPES, api_key, backend_token, load_config, run_password
from .data import build_items, condition_view, fetch_belebele, load_items, review, save_items
from .db import db, init_db
from .playground import run_playground, voice_to_fields


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Script-Bias Audit", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def require_backend_token(request: Request, call_next):
    """Only the frontend proxy (which holds BACKEND_TOKEN and has checked the user's session) may call the API.
    Fails closed: if BACKEND_TOKEN is not configured, every route except /api/health is refused."""
    if request.url.path != "/api/health":
        expected = backend_token()
        given = request.headers.get("x-backend-token", "")
        if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


DATA_JOB = {"state": "idle", "message": ""}

_RUN_FAILS: dict[str, tuple[int, float]] = {}


def require_run_password(x_run_password: str | None = Header(default=None),
                         x_auth_user: str | None = Header(default=None)) -> None:
    """Starting/resuming experiments and reloading data cost money, so they need a second password (RUN_PASSWORD).
    5 wrong tries lock that user out of experiments for 10 minutes."""
    who, now_ = x_auth_user or "anonymous", time.time()
    n, until = _RUN_FAILS.get(who, (0, 0.0))
    if n >= 5 and until > now_:
        raise HTTPException(429, "Too many wrong experiment passwords. Try again in 10 minutes.")
    expected = run_password()
    if not expected:
        raise HTTPException(403, "Experiments are locked: RUN_PASSWORD is not configured on the server.")
    if not x_run_password or not hmac.compare_digest(x_run_password.encode(), expected.encode()):
        _RUN_FAILS[who] = ((n + 1) if until > now_ else 1, now_ + 600)
        raise HTTPException(403, "Wrong experiment password." if x_run_password else "Experiment password required.")
    _RUN_FAILS.pop(who, None)


class LoadRequest(BaseModel):
    n: int | None = None
    seed: int | None = None
    force: bool = False


class ReviewRequest(BaseModel):
    action: Literal["approve", "reject", "edit"]
    reviewer: str = ""  # ignored when the proxy supplies the signed-in user
    options: list[str] | None = None


class RunRequest(BaseModel):
    type: str
    judges: list[str] | None = None
    conditions: list[str] | None = None
    n_items: int | None = None
    repeats: int | None = None
    flags: dict[str, bool] | None = None
    start: bool = True


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/config")
def get_config() -> dict:
    cfg = load_config()
    return {
        "conditions": CONDITIONS, "reference": REFERENCE, "generated": GENERATED, "run_types": RUN_TYPES,
        "judges": [j["id"] for j in cfg["judges"]], "generator": cfg["generator"]["model"],
        "settings": cfg["settings"], "api_key_set": bool(api_key()),
    }


def _dataset_status() -> dict:
    with db() as c:
        n = c.execute("SELECT COUNT(*), COALESCE(SUM(code_mixed),0) FROM items").fetchone()
        gen = {cond: {"pending": 0, "approved": 0, "rejected": 0} for cond in GENERATED}
        for r in c.execute("SELECT condition, status, COUNT(*) AS k FROM generated GROUP BY condition, status"):
            gen[r["condition"]][r["status"]] = r["k"]
    return {"items": n[0], "code_mixed_items": n[1], "generated": gen, "job": DATA_JOB}


@app.get("/api/overview")
def overview() -> dict:
    cfg = load_config()
    status = runs.screening_status(cfg)
    with db() as c:
        total_cost = c.execute("SELECT COALESCE(SUM(cost),0) FROM cache").fetchone()[0]
        n_calls = c.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
    return {
        "judges": [{"id": j["id"], **status.get(j["id"], {"status": "untested", "auc": {}})} for j in cfg["judges"]],
        "dataset": _dataset_status(),
        "total_cost_usd": total_cost,
        "total_calls": n_calls,
        "runs": len(runs.list_runs()),
        "api_key_set": bool(api_key()),
        "threshold": cfg["settings"]["screening_auc_threshold"],
    }


# ---------------------------------------------------------------- data


def _load_job(n: int, seed: int, code_mixed_n: int) -> None:
    try:
        DATA_JOB.update(state="running", message="Downloading Belebele (urd_Arab, urd_Latn, eng_Latn)…")
        rows = fetch_belebele()
        DATA_JOB["message"] = "Joining and sampling…"
        items = build_items(rows, n, seed, code_mixed_n)
        with db() as c:
            save_items(c, items)
        DATA_JOB.update(state="done", message=f"Loaded {len(items)} items (seed {seed}).")
    except Exception as e:  # surfaced in the UI
        DATA_JOB.update(state="failed", message=f"{type(e).__name__}: {e}"[:400])


@app.post("/api/data/load", dependencies=[Depends(require_run_password)])
def load_data(req: LoadRequest) -> dict:
    s = load_config()["settings"]
    if DATA_JOB["state"] == "running":
        raise HTTPException(409, "a load is already running")
    if _dataset_status()["items"] and not req.force:
        raise HTTPException(409, "items already loaded; pass force=true to replace them (clears reviews)")
    threading.Thread(target=_load_job, args=(req.n or s["n_items"], req.seed if req.seed is not None else s["seed"],
                                             s["code_mixed_items"]), daemon=True).start()
    return {"started": True}


@app.get("/api/data/status")
def data_status() -> dict:
    return _dataset_status()


@app.get("/api/items")
def items(condition: str | None = None, status: str | None = None, offset: int = 0, limit: int = 20) -> dict:
    """Items side by side across conditions. `status` filters on review status of `condition`
    (or of any generated condition if none given)."""
    with db() as c:
        all_items = load_items(c)
    conds = [condition] if condition else CONDITIONS
    if status:
        check = [c for c in conds if c in GENERATED] or GENERATED
        all_items = [it for it in all_items
                     if any((it["generated"].get(c) or {}).get("status", "missing") == status for c in check)]
    page = all_items[offset: offset + limit]
    out = []
    for it in page:
        views = {}
        for cond in conds:
            v = condition_view(it, cond, approved_only=False)
            g = it["generated"].get(cond) if cond in GENERATED else None
            views[cond] = None if v is None else {**v, "status": g["status"] if g else "source"}
        out.append({"id": it["id"], "pos": it["pos"], "correct_idx": it["correct_idx"], "wrong_idx": it["wrong_idx"],
                    "code_mixed": it["code_mixed"], "link": it["link"], "views": views})
    return {"total": len(all_items), "items": out}


@app.get("/api/review")
def review_queue(condition: str, status: str = "pending") -> dict:
    if condition not in GENERATED:
        raise HTTPException(400, f"condition must be one of {GENERATED}")
    with db() as c:
        all_items = load_items(c)
    out = []
    for it in all_items:
        g = it["generated"].get(condition)
        if g and (status == "all" or g["status"] == status):
            out.append({"item_id": it["id"], "pos": it["pos"], "condition": condition,
                        "source": it["urd_arab"]["options"], "belebele_roman": it["urd_latn"]["options"],
                        "question": it["urd_arab"]["question"], "generated": g["options"], "raw": g["raw"],
                        "parse_ok": bool(g["parse_ok"]), "status": g["status"], "edited": bool(g["edited"]),
                        "reviewer": g["reviewer"], "correct_idx": it["correct_idx"], "wrong_idx": it["wrong_idx"]})
    return {"items": out}


@app.post("/api/review/{item_id}/{condition}")
def review_item(item_id: str, condition: str, req: ReviewRequest,
                x_auth_user: str | None = Header(default=None)) -> dict:
    reviewer = (x_auth_user or req.reviewer).strip()
    if not reviewer:
        raise HTTPException(400, "reviewer name is required")
    try:
        with db() as c:
            review(c, item_id, condition, req.action, reviewer, req.options)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ---------------------------------------------------------------- live demo


class PlaygroundRequest(BaseModel):
    judges: list[str]
    item_id: str | None = None
    custom: dict[str, dict[str, str]] | None = None
    scores: bool = True
    pairwise: bool = True
    mcq: bool = True
    rubric: bool = False


@app.post("/api/playground")
async def playground(req: PlaygroundRequest) -> dict:
    try:
        return await run_playground(req.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


class VoiceRequest(BaseModel):
    audio: str          # base64, no data: prefix
    format: str = "webm"


@app.post("/api/voice")
async def voice(req: VoiceRequest) -> dict:
    """Voice note -> Whisper transcript -> passage/question/answer in all four scripts."""
    try:
        return await voice_to_fields(req.audio, req.format)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # provider errors (e.g. no credits) shown to the user
        raise HTTPException(502, f"Voice note failed: {str(e)[:200]}")


@app.get("/api/insights")
def insights() -> dict:
    return {**runs.insights(), "dataset": _dataset_status()}


@app.get("/api/items/sample")
def sample_item(pos: int | None = None) -> dict:
    """One item for the demo picker: by position (1-based) or random."""
    import random
    with db() as c:
        all_items = load_items(c)
    if not all_items:
        raise HTTPException(404, "no items loaded")
    it = all_items[(pos - 1) % len(all_items)] if pos else random.choice(all_items)
    return {"id": it["id"], "pos": it["pos"], "total": len(all_items), "question": it["eng_latn"]["question"]}


# ---------------------------------------------------------------- runs


def _cfg(req: RunRequest) -> dict:
    try:
        return runs.normalize_config(req.model_dump(), load_config())
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/runs/estimate")
def estimate(req: RunRequest) -> dict:
    cfg = _cfg(req)
    return {"config": cfg, **runs.estimate(cfg, load_config())}


@app.post("/api/runs", dependencies=[Depends(require_run_password)])
async def create_run(req: RunRequest) -> dict:
    cfg = _cfg(req)
    est = runs.estimate(cfg, load_config())
    cfg["flagged_judges"] = est["flagged_judges"]
    run_id = runs.create_run(cfg)
    if req.start:
        runs.start_run(run_id)
    return {"id": run_id, **est}


@app.get("/api/runs")
def list_runs() -> dict:
    return {"runs": runs.list_runs()}


@app.post("/api/runs/{run_id}/start", dependencies=[Depends(require_run_password)])
async def start(run_id: int) -> dict:
    runs.start_run(run_id)
    return {"ok": True}


@app.post("/api/runs/{run_id}/stop")
async def stop(run_id: int) -> dict:
    return {"stopped": runs.stop_run(run_id)}


@app.get("/api/runs/{run_id}/summary")
def summary(run_id: int) -> dict:
    try:
        return runs.run_summary(run_id)
    except KeyError:
        raise HTTPException(404, "run not found")


@app.get("/api/runs/{run_id}/export.csv")
def export_csv(run_id: int) -> PlainTextResponse:
    return PlainTextResponse(runs.results_csv(run_id), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="run_{run_id}.csv"'})


@app.get("/api/runs/{run_id}/export.json")
def export_json(run_id: int):
    try:
        return runs.results_json(run_id)
    except KeyError:
        raise HTTPException(404, "run not found")
