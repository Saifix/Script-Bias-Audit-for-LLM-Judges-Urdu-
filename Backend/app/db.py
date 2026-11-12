"""SQLite storage (plain sqlite3). One file: DATA_DIR/audit.db."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .config import data_dir

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    pos INTEGER NOT NULL,             -- order in the seeded sample; subsets = first N
    link TEXT, question_number INTEGER,
    correct_idx INTEGER NOT NULL,     -- 0-based
    wrong_idx INTEGER NOT NULL,       -- 0-based, chosen deterministically from the seed
    code_mixed INTEGER NOT NULL,      -- 1 if in the code-mixed subset
    urd_arab TEXT NOT NULL,           -- JSON {passage, question, options[4]}
    urd_latn TEXT NOT NULL,
    eng_latn TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generated (
    item_id TEXT NOT NULL,
    condition TEXT NOT NULL,          -- roman_translit | code_mixed
    options TEXT NOT NULL,            -- JSON list of 4 generated options
    raw TEXT,                         -- raw LLM output
    model TEXT,
    parse_ok INTEGER NOT NULL,
    status TEXT NOT NULL,             -- pending | approved | rejected
    edited INTEGER NOT NULL DEFAULT 0,
    reviewer TEXT, reviewed_at TEXT, created_at TEXT,
    PRIMARY KEY (item_id, condition)
);
CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,             -- sha256 of (model, prompt, params, repeat)
    model TEXT, served_model TEXT, provider TEXT,
    prompt TEXT, response TEXT,
    prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    config TEXT NOT NULL,             -- JSON
    status TEXT NOT NULL,             -- created | running | done | stopped | failed | interrupted
    total INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS results (
    run_id INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL,               -- generate | pointwise | pairwise | comprehension
    judge TEXT NOT NULL,              -- requested model ID
    item_id TEXT NOT NULL,
    condition TEXT NOT NULL,
    other TEXT,                       -- pairwise: reference condition
    answer TEXT,                      -- correct | wrong
    ord TEXT,                         -- pairwise: AB (condition shown first) | BA
    repeat INTEGER NOT NULL DEFAULT 0,
    raw TEXT,                         -- raw model output
    value REAL,                       -- score / outcome (1 win, 0.5 tie, 0 loss) / chosen option
    label TEXT,
    status TEXT NOT NULL,             -- ok | tie | unparseable
    model TEXT, provider TEXT, ts TEXT,
    prompt_tokens INTEGER, completion_tokens INTEGER,
    cost REAL NOT NULL DEFAULT 0,     -- USD actually spent (0 when served from cache)
    calls INTEGER NOT NULL DEFAULT 1,
    cached INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, task_id)
);
"""


def connect() -> sqlite3.Connection:
    """Open a connection with dict-like rows and WAL mode (safe for the API + worker)."""
    conn = sqlite3.connect(data_dir() / "audit.db", timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")  # safe with WAL; avoids an fsync per result row
    return conn


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    """Connection context: commits on success, always closes."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create tables and mark runs left 'running' by a crash as 'interrupted' (resumable)."""
    with db() as c:
        c.executescript(SCHEMA)
        c.execute("UPDATE runs SET status='interrupted' WHERE status='running'")
