"""LLM access: prompts, output parsing, one OpenAI-compatible client (OpenRouter) with
caching, retries, concurrency limit and cost tracking, plus a deterministic offline mock."""
from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import json
import random
import re
import time
from dataclasses import dataclass

import httpx

from .config import PROMPTS_DIR, api_key
from .data import now
from .db import db

OPENROUTER_URL = "https://openrouter.ai/api/v1"

# ---------------------------------------------------------------- prompts


def render(name: str, **fields: str) -> str:
    """Fill `prompts/<name>.txt`. Single-pass substitution, so braces inside texts are safe."""
    template = (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
    return re.sub(r"\{(\w+)\}", lambda m: fields.get(m.group(1), m.group(0)), template).strip()


def rubric_text() -> str:
    return (PROMPTS_DIR / "rubric.txt").read_text(encoding="utf-8").strip() + " "


def numbered(texts: list[str]) -> str:
    return "\n".join(f"{i}. {t}" for i, t in enumerate(texts, 1))


# ---------------------------------------------------------------- parsing

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def parse_score(text: str | None) -> float | None:
    """Parse a 1-10 score from replies like "8", "Score: 8/10", "8." or "۸". None if unparseable."""
    t = (text or "").translate(_DIGITS)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:/|out of)\s*10(?!\d)", t, re.I) or re.search(r"(?<![\d.])(\d+(?:\.\d+)?)", t)
    if not m:
        return None
    v = float(m.group(1))
    return v if 1 <= v <= 10 else None


def parse_pairwise(text: str | None) -> str | None:
    """Parse "A", "B" or "TIE" from replies like "A", "**B**", "Answer A", "Tie." None if unparseable."""
    t = re.sub(r"[^A-Z ]", " ", (text or "").upper()).split()
    if not t:
        return None
    if t[0] in ("A", "B", "TIE"):
        return t[0]
    if "TIE" in t or "EQUAL" in t:
        return "TIE"
    letters = [w for w in t if w in ("A", "B")]
    return letters[0] if letters else None


def parse_choice(text: str | None) -> int | None:
    """Parse a multiple-choice option number 1-4 (also accepts a lone letter A-D)."""
    t = (text or "").translate(_DIGITS).strip()
    m = re.search(r"(?<!\d)([1-4])(?!\d)", t)
    if m:
        return int(m.group(1))
    m = re.fullmatch(r"\W*([A-Da-d])\W*", t)
    return "abcd".index(m.group(1).lower()) + 1 if m else None


def parse_numbered(text: str | None, n: int = 4) -> list[str] | None:
    """Parse exactly `n` numbered lines ("1. foo") in order. None if the reply does not match."""
    found: dict[int, str] = {}
    for line in (text or "").splitlines():
        m = re.match(r"\s*\**(\d+)\s*[.):\-]\s*(.+?)\s*$", line)
        if m and 1 <= int(m.group(1)) <= n and int(m.group(1)) not in found:
            found[int(m.group(1))] = m.group(2).strip("* ")
    return [found[i] for i in range(1, n + 1)] if len(found) == n else None


# ---------------------------------------------------------------- mock judge


def _tokens(s: str) -> set[str]:
    return set(re.findall(r"\w+", s.lower()))


def _overlap(answer: str, passage: str) -> float:
    a = _tokens(answer)
    return len(a & _tokens(passage)) / len(a) if a else 0.0


def _section(prompt: str, name: str) -> str:
    m = re.search(rf"^### {re.escape(name)}\n(.*?)(?=\n### |\Z)", prompt, re.S | re.M)
    return m.group(1).strip() if m else ""


def _field(block: str, name: str) -> str:
    m = re.search(rf"^{name}: (.*)$", block, re.M)
    return m.group(1) if m else ""


def mock_reply(model: str, prompt: str, task: str, repeat: int = 0) -> str:
    """Deterministic offline judge. Scores by word overlap between answer and passage plus a
    small hash-based jitter (varies with model and repeat). No network, no randomness."""
    h = int(hashlib.sha256(f"{model}|{repeat}|{prompt}".encode()).hexdigest(), 16)
    if task == "pointwise":
        ov = _overlap(_section(prompt, "Answer"), _section(prompt, "Passage"))
        return str(max(1, min(10, round(2 + 7 * ov) + h % 3 - 1)))
    if task == "pairwise":
        a, b = _section(prompt, "Answer A"), _section(prompt, "Answer B")
        sa = _overlap(_field(a, "Answer"), _field(a, "Passage"))
        sb = _overlap(_field(b, "Answer"), _field(b, "Passage"))
        if abs(sa - sb) < 0.05:
            return ("TIE", "A", "B")[h % 3]
        return "A" if sa > sb else "B"
    if task == "comprehension":
        passage, opts = _section(prompt, "Passage"), parse_numbered(_section(prompt, "Options")) or ["?"]
        return str(max(range(len(opts)), key=lambda i: (_overlap(opts[i], passage), -i)) + 1)
    if task in ("transliterate", "code_mix"):
        return _section(prompt, "Texts")  # echoes the source lines
    if task == "to_urdu":
        return _section(prompt, "Text")
    if task == "explain":
        return "Mock summary: the numbers above were computed by code."
    if task == "voice_format":  # echo the transcript into every field
        t = _section(prompt, "Transcript")
        f = {"passage": t, "question": "What is this about?", "answer": t[:40]}
        return json.dumps({k: f for k in ("urdu_script", "roman_translit", "english", "code_mixed")}, ensure_ascii=False)
    return "?"


MOCK_TRANSCRIPT = "Ali ne bazaar se do kilo seb khareede. Sawal: Ali ne kya khareeda? Jawab: do kilo seb."


# ---------------------------------------------------------------- client


@dataclass
class Call:
    """One model call (or cache hit) with everything needed for provenance and cost."""
    text: str
    model: str            # requested model ID
    served_model: str     # model ID reported by the provider
    provider: str
    prompt_tokens: int
    completion_tokens: int
    cost: float           # USD for the original call
    cached: bool
    key: str
    ts: str


class LLMError(RuntimeError):
    pass


class BudgetExceeded(LLMError):
    pass


_SPENT = {"value": 0.0, "at": 0.0}


def spent_usd(refresh_every: float = 20.0) -> float:
    """Total spend so far (sum of every recorded call), refreshed from the DB at most every few seconds."""
    if time.time() - _SPENT["at"] > refresh_every:
        with db() as c:
            _SPENT["value"] = float(c.execute("SELECT COALESCE(SUM(cost), 0) FROM cache").fetchone()[0])
        _SPENT["at"] = time.time()
    return _SPENT["value"]


def budget_guard() -> None:
    """Refuse any paid call once total spend reaches settings.budget_usd (hard cap, default $30)."""
    from .config import load_config
    budget = float(load_config()["settings"].get("budget_usd", 30))
    if spent_usd() >= budget:
        raise BudgetExceeded(f"budget reached: ${spent_usd():.2f} of ${budget:.2f} spent; paid calls are disabled")


def cache_key(model: str, prompt: str, max_tokens: int, repeat: int = 0, extra: dict | None = None) -> str:
    """Hash of (model, prompt incl. input, params). `repeat` > 0 forces a fresh call for repeat runs."""
    payload = json.dumps(
        {"model": model, "prompt": prompt, "max_tokens": max_tokens, "temperature": 0,
         "repeat": repeat, "extra": extra or {}},
        sort_keys=True, ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def cached_keys(keys: list[str]) -> set[str]:
    """Which of `keys` are already in the cache."""
    found: set[str] = set()
    with db() as c:
        for i in range(0, len(keys), 500):
            chunk = keys[i:i + 500]
            q = f"SELECT key FROM cache WHERE key IN ({','.join('?' * len(chunk))})"
            found.update(r[0] for r in c.execute(q, chunk))
    return found


def _transient_400(r: httpx.Response) -> bool:
    """Some providers intermittently refuse a request routed through an unsupported region
    ("User location is not supported"); a retry usually goes through, so treat it like a 5xx."""
    return r.status_code == 400 and "location is not supported" in r.text


class LLMClient:
    """OpenAI-compatible chat client pointed at OpenRouter. Every call goes through the cache."""

    def __init__(self, concurrency: int = 8, max_retries: int = 6, backoff: float = 1.0,
                 transport: httpx.AsyncBaseTransport | None = None, key: str | None = None,
                 model_limits: dict[str, int] | None = None):
        self.sem = asyncio.Semaphore(concurrency)
        # per-model caps for providers that rate-limit hard (config: judges[].max_concurrency)
        self.model_sems = {m: asyncio.Semaphore(n) for m, n in (model_limits or {}).items() if n and n > 0}
        self.max_retries = max_retries
        self.backoff = backoff
        self.key = api_key() if key is None else key
        self.http = httpx.AsyncClient(base_url=OPENROUTER_URL, timeout=120, transport=transport)
        self.network_calls = 0
        self._inflight: dict[str, asyncio.Future] = {}

    async def aclose(self) -> None:
        await self.http.aclose()

    async def complete(self, model: str, prompt: str, *, max_tokens: int = 8, repeat: int = 0,
                       task: str = "", extra: dict | None = None) -> Call:
        """Return the model's reply to `prompt` (temperature 0), from cache when possible."""
        key = cache_key(model, prompt, max_tokens, repeat, extra)
        hit = self._cache_get(key)
        if hit:
            return hit
        if key in self._inflight:  # identical call already running: share it, count it as cached
            return dataclasses.replace(await asyncio.shield(self._inflight[key]), cached=True)
        fut = asyncio.ensure_future(self._call(key, model, prompt, max_tokens, repeat, task, extra))
        self._inflight[key] = fut
        try:
            return await fut
        finally:
            self._inflight.pop(key, None)

    async def _call(self, key, model, prompt, max_tokens, repeat, task, extra) -> Call:
        limit = self.model_sems.get(model)
        if limit is not None:
            async with limit:
                return await self._call_inner(key, model, prompt, max_tokens, repeat, task, extra)
        return await self._call_inner(key, model, prompt, max_tokens, repeat, task, extra)

    async def _call_inner(self, key, model, prompt, max_tokens, repeat, task, extra) -> Call:
        async with self.sem:
            if model.startswith("mock/"):
                text, served, provider = mock_reply(model, prompt, task, repeat), model, "mock"
                pt, ct, cost = len(prompt) // 4, 1, 0.0
            else:
                body = {"model": model, "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0, "max_tokens": max_tokens, "usage": {"include": True}, **(extra or {})}
                budget_guard()
                data = await self._post(body)
                self.network_calls += 1
                choice = (data.get("choices") or [{}])[0]
                text = (choice.get("message") or {}).get("content") or ""
                usage = data.get("usage") or {}
                served, provider = data.get("model", model), data.get("provider", "")
                pt, ct = int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
                cost = float(usage.get("cost") or 0.0)
                _SPENT["value"] += cost
        call = Call(text, model, served, provider, pt, ct, cost, False, key, now())
        with db() as c:
            c.execute(
                "INSERT OR REPLACE INTO cache VALUES (?,?,?,?,?,?,?,?,?,?)",
                (key, model, served, provider, prompt, text, pt, ct, cost, call.ts),
            )
        return call

    async def transcribe(self, model: str, audio_b64: str, fmt: str) -> Call:
        """Speech-to-text via OpenRouter /audio/transcriptions (e.g. Whisper). Cached by audio hash."""
        digest = hashlib.sha256(audio_b64.encode()).hexdigest()
        key = cache_key(model, f"[audio:{fmt}:{digest}]", 0)
        hit = self._cache_get(key)
        if hit:
            return hit
        async with self.sem:
            if model.startswith("mock/"):
                text, cost, secs = MOCK_TRANSCRIPT, 0.0, 0
            else:
                budget_guard()
                data = await self._post({"model": model, "input_audio": {"data": audio_b64, "format": fmt}},
                                        path="/audio/transcriptions")
                self.network_calls += 1
                text = data.get("text") or ""
                usage = data.get("usage") or {}
                cost, secs = float(usage.get("cost") or 0.0), int(usage.get("seconds") or 0)
        call = Call(text, model, model, "openrouter" if not model.startswith("mock/") else "mock", secs, 0, cost, False, key, now())
        with db() as c:
            c.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?,?,?,?,?,?,?,?)",
                      (key, model, model, call.provider, f"[audio:{fmt}:{digest}]", text, secs, 0, cost, call.ts))
        return call

    async def _post(self, body: dict, path: str = "/chat/completions") -> dict:
        """POST with exponential backoff on 429 / 5xx / network errors."""
        if not self.key:
            raise LLMError("OPENROUTER_API_KEY is not set; only mock/ models can run.")
        headers = {"Authorization": f"Bearer {self.key}", "X-Title": "Script-Bias Audit"}
        err = ""
        for attempt in range(self.max_retries + 1):
            retry_after = None
            try:
                r = await self.http.post(path, json=body, headers=headers)
            except httpx.TransportError as e:
                err = f"network error ({type(e).__name__})"
            else:
                if r.status_code == 200:
                    data = r.json()
                    if not data.get("error"):
                        return data
                    err = f"provider error: {str(data['error'])[:200]}"
                elif r.status_code == 429 or r.status_code >= 500 or _transient_400(r):
                    err = f"HTTP {r.status_code}" + (" (provider region refused; retrying)" if r.status_code == 400 else "")
                    retry_after = r.headers.get("retry-after")
                else:
                    raise LLMError(f"HTTP {r.status_code} for {body['model']}: {r.text[:300]}")
            if attempt == self.max_retries:
                break
            delay = float(retry_after) if retry_after and retry_after.isdigit() else min(60.0, self.backoff * 2 ** attempt)
            await asyncio.sleep(delay + random.random() * self.backoff * 0.25)
        raise LLMError(f"{body['model']}: gave up after {self.max_retries} retries ({err})")

    @staticmethod
    def _cache_get(key: str) -> Call | None:
        with db() as c:
            r = c.execute("SELECT * FROM cache WHERE key=?", (key,)).fetchone()
        if not r:
            return None
        return Call(r["response"], r["model"], r["served_model"], r["provider"], r["prompt_tokens"],
                    r["completion_tokens"], r["cost"], True, key, r["created_at"])


# ---------------------------------------------------------------- prices (for estimates)

_PRICES: dict[str, tuple[float, float]] = {}
_PRICES_AT = 0.0


def model_prices() -> dict[str, tuple[float, float]]:
    """USD per token (prompt, completion) from OpenRouter's public model list; cached 1 h. {} if offline."""
    global _PRICES_AT
    if time.time() - _PRICES_AT > 3600:
        try:
            r = httpx.get(f"{OPENROUTER_URL}/models", timeout=15)
            r.raise_for_status()
            _PRICES.clear()
            for m in r.json().get("data", []):
                p = m.get("pricing") or {}
                _PRICES[m["id"]] = (float(p.get("prompt") or 0), float(p.get("completion") or 0))
            _PRICES_AT = time.time()
        except Exception:
            _PRICES_AT = time.time() - 3300  # retry in ~5 min
    return _PRICES
