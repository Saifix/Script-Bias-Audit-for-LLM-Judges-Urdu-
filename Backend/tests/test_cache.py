"""Cache hits, retries, and resume after a crash."""
import asyncio
import json

import httpx

from app.db import db, init_db
from app.judges import LLMClient, cache_key
from app.runs import create_run, execute_run, normalize_config
from app.config import load_config


def test_mock_call_is_cached(env):
    async def go():
        client = LLMClient()
        a = await client.complete("mock/judge-a", "### Passage\nx\n### Answer\nx", task="pointwise")
        b = await client.complete("mock/judge-a", "### Passage\nx\n### Answer\nx", task="pointwise")
        r1 = await client.complete("mock/judge-a", "### Passage\nx\n### Answer\nx", task="pointwise", repeat=1)
        await client.aclose()
        return a, b, r1
    a, b, r1 = asyncio.run(go())
    assert not a.cached and b.cached and a.text == b.text
    assert not r1.cached and r1.key != a.key  # a repeat is a fresh call
    with db() as c:
        assert c.execute("SELECT COUNT(*) FROM cache").fetchone()[0] == 2


def test_retry_then_cache(env):
    hits = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        if hits["n"] <= 2:
            return httpx.Response(429 if hits["n"] == 1 else 503)
        body = json.loads(request.content)
        assert body["temperature"] == 0 and body["reasoning"] == {"enabled": False}
        return httpx.Response(200, json={
            "model": "qwen/qwen-2.5-7b-instruct", "provider": "Together",
            "choices": [{"message": {"content": "Score: 8/10"}}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 3, "cost": 0.00002},
        })

    async def go():
        client = LLMClient(backoff=0.001, transport=httpx.MockTransport(handler), key="test-key")
        extra = {"reasoning": {"enabled": False}}
        a = await client.complete("qwen/qwen-2.5-7b-instruct", "p", extra=extra)
        b = await client.complete("qwen/qwen-2.5-7b-instruct", "p", extra=extra)
        await client.aclose()
        return a, b, client.network_calls
    a, b, net = asyncio.run(go())
    assert hits["n"] == 3 and net == 1  # 2 retries, then success; second call never hits the network
    assert a.text == "Score: 8/10" and a.provider == "Together" and a.cost == 0.00002 and not a.cached
    assert b.cached and b.text == a.text
    assert a.key == cache_key("qwen/qwen-2.5-7b-instruct", "p", 8, 0, {"reasoning": {"enabled": False}})


def test_missing_key_fails_clearly(env):
    async def go():
        client = LLMClient(key="")
        try:
            await client.complete("qwen/qwen-2.5-7b-instruct", "p")
        finally:
            await client.aclose()
    try:
        asyncio.run(go())
    except RuntimeError as e:
        assert "OPENROUTER_API_KEY" in str(e)
    else:
        raise AssertionError("expected an error")


def test_resume_after_crash(env):
    cfg = normalize_config({"type": "pointwise", "conditions": ["urdu_script", "english"], "n_items": 5}, load_config())
    run_id = create_run(cfg)
    asyncio.run(execute_run(run_id))
    with db() as c:
        total = c.execute("SELECT COUNT(*) FROM results WHERE run_id=?", (run_id,)).fetchone()[0]
        assert total == 2 * 5 * 2 * 2  # judges x items x conditions x answers
        # simulate a crash halfway: lose half the results, run still marked running
        c.execute("DELETE FROM results WHERE run_id=? AND rowid % 2 = 0", (run_id,))
        c.execute("UPDATE runs SET status='running' WHERE id=?", (run_id,))
        cache_before = c.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
    init_db()  # app restart
    with db() as c:
        assert c.execute("SELECT status FROM runs WHERE id=?", (run_id,)).fetchone()[0] == "interrupted"
    asyncio.run(execute_run(run_id))
    with db() as c:
        assert c.execute("SELECT status FROM runs WHERE id=?", (run_id,)).fetchone()[0] == "done"
        assert c.execute("SELECT COUNT(*) FROM results WHERE run_id=?", (run_id,)).fetchone()[0] == total
        # resumed tasks were served from cache: no new calls, zero cost
        assert c.execute("SELECT COUNT(*) FROM cache").fetchone()[0] == cache_before
        assert c.execute("SELECT SUM(cost) FROM results WHERE run_id=?", (run_id,)).fetchone()[0] == 0


def test_budget_cap_blocks_paid_calls(env, monkeypatch):
    import app.judges as J
    from app.db import db as _db
    with _db() as c:  # pretend $30.50 has already been spent
        c.execute("INSERT INTO cache VALUES ('spent','x','x','x','p','r',0,0,30.5,'t')")
    J._SPENT["at"] = 0.0
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json={"choices": [{"message": {"content": "8"}}], "usage": {}})

    async def go():
        client = LLMClient(backoff=0.001, transport=httpx.MockTransport(handler), key="k")
        try:
            await client.complete("qwen/qwen3.5-9b", "p")
        finally:
            await client.aclose()
    try:
        asyncio.run(go())
        raise AssertionError("expected the budget cap to refuse the call")
    except J.BudgetExceeded as e:
        assert "budget reached" in str(e)
    assert calls["n"] == 0  # nothing was sent
    # mock (free) judges keep working past the cap
    async def mock():
        client = LLMClient()
        try:
            return await client.complete("mock/judge-a", "### Passage\nx\n### Answer\nx", task="pointwise")
        finally:
            await client.aclose()
    assert asyncio.run(mock()).text


def test_per_model_concurrency_limit(env):
    import time as _t
    active = {"now": 0, "max": 0}

    async def handler(request):
        active["now"] += 1
        active["max"] = max(active["max"], active["now"])
        await asyncio.sleep(0.02)
        active["now"] -= 1
        return httpx.Response(200, json={"choices": [{"message": {"content": "8"}}], "usage": {}})

    async def go():
        client = LLMClient(concurrency=8, transport=httpx.MockTransport(handler), key="k", model_limits={"slow/model": 2})
        try:
            await asyncio.gather(*(client.complete("slow/model", f"p{i}") for i in range(10)))
        finally:
            await client.aclose()
    asyncio.run(go())
    assert active["max"] == 2  # never more than 2 in flight for this model
