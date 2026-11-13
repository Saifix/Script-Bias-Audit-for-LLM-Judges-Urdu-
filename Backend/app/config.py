"""Configuration: `config.toml` (re-read on every call so edits apply live) plus environment."""
from __future__ import annotations

import os
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS_DIR = ROOT / "prompts"

REFERENCE = "urdu_script"
# Four versions of every question. ("roman_belebele", Belebele's own reworded Roman Urdu, is no longer an experiment
# condition; its passage and question text are still the Roman Urdu passage/question for roman_translit and code_mixed.)
CONDITIONS = ["urdu_script", "roman_translit", "english", "code_mixed"]
GENERATED = ["roman_translit", "code_mixed"]  # LLM-generated, need human review
LATIN_URDU = ["roman_translit", "code_mixed"]  # converted by the transliterate mitigation
RUN_TYPES = ["generate", "screening", "comprehension", "pointwise", "pairwise", "repeats"]

DEFAULTS = {
    "seed": 13,
    "n_items": 300,
    "code_mixed_items": 300,
    "pilot_items": 20,
    "screening_auc_threshold": 0.7,
    "acceptance_threshold": 7,
    "repeat_items": 50,
    "repeat_count": 2,
    "bootstrap_resamples": 1000,
    "concurrency": 8,
    "max_retries": 6,
    "judge_max_tokens": 8,
}


def data_dir() -> Path:
    """Directory for the SQLite DB, HF cache and exports (a Docker volume in production)."""
    d = Path(os.environ.get("DATA_DIR", ROOT / "data"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_config() -> dict:
    """Read config.toml and fill in defaults."""
    path = Path(os.environ.get("CONFIG_PATH", ROOT / "config.toml"))
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    cfg["settings"] = {**DEFAULTS, **cfg.get("settings", {})}
    cfg.setdefault("judges", [])
    cfg.setdefault("generator", {"model": "mock/generator", "max_tokens": 600})
    cfg.setdefault("voice", {"model": "mock/whisper"})
    cfg.setdefault("summary", {"model": "mock/summary", "name": "Mock summary"})
    return cfg


def run_password() -> str:
    """Extra password needed to start/resume experiment runs or reload data (they cost money). Empty = runs locked."""
    return os.environ.get("RUN_PASSWORD", "").strip()


def judge_options(cfg: dict, model: str) -> dict:
    """Request options for a judge model: max_tokens and extra body fields (e.g. reasoning off)."""
    j = next((j for j in cfg["judges"] if j["id"] == model), {})
    extra = {"reasoning": {"enabled": False}} if j.get("reasoning_off") else {}
    return {"max_tokens": int(j.get("max_tokens", cfg["settings"]["judge_max_tokens"])), "extra": extra}


def backend_token() -> str:
    """Shared secret the frontend proxy must send. Under 32 chars counts as unset (all API calls refused)."""
    t = os.environ.get("BACKEND_TOKEN", "").strip()
    return t if len(t) >= 32 else ""


TIER_NAMES = {1: "Small (8–12B)", 2: "Medium (27–70B)", 3: "Large"}


def judge_meta(cfg: dict, model: str) -> dict:
    """Display metadata for a judge: name, family (company), tier (1 small, 2 medium, 3 large)."""
    j = next((j for j in cfg["judges"] if j["id"] == model), {})
    tier = int(j.get("tier", 1))
    return {"id": model, "name": j.get("name") or model.split("/")[-1], "family": j.get("family") or model.split("/")[0],
            "tier": tier, "tier_name": TIER_NAMES.get(tier, f"Tier {tier}")}


def judge_name(cfg: dict, model: str) -> str:
    """Short display name for a judge (config `name`, else the model slug)."""
    j = next((j for j in cfg["judges"] if j["id"] == model), {})
    return j.get("name") or model.split("/")[-1]


def api_key() -> str:
    """OpenRouter key. Only ever used server-side; never returned by the API or logged."""
    return os.environ.get("OPENROUTER_API_KEY", "").strip()
