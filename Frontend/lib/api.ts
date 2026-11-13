"use client";
// Thin client for the backend API (proxied through /api by app/api/[...path]/route.ts).
import { useCallback, useEffect, useRef, useState } from "react";

export const CONDITION_LABELS: Record<string, string> = {
  urdu_script: "Urdu script",
  roman_belebele: "Roman (Belebele)",
  roman_translit: "Roman (transliterated)",
  english: "English",
  code_mixed: "Code-mixed",
};
export const label = (c: string) => CONDITION_LABELS[c] ?? c;
export const RTL = new Set(["urdu_script"]);

export type Screening = { status: "pass" | "fail" | "untested"; auc: Record<string, number | null>; run_id?: number; threshold?: number };
export type JudgeStatus = { id: string } & Screening;
export type GenCounts = { pending: number; approved: number; rejected: number };
export type Overview = {
  judges: JudgeStatus[];
  dataset: { items: number; code_mixed_items: number; generated: Record<string, GenCounts>; job: { state: string; message: string } };
  total_cost_usd: number;
  total_calls: number;
  runs: number;
  api_key_set: boolean;
  threshold: number;
};
export type AppConfig = {
  conditions: string[]; reference: string; generated: string[]; run_types: string[];
  judges: string[]; generator: string; settings: Record<string, number>; api_key_set: boolean;
};
export type RunConfig = {
  type: string; judges: string[]; conditions: string[]; n_items: number; repeats: number;
  flags: { rubric: boolean; transliterate: boolean; panel: boolean }; flagged_judges?: Record<string, string>;
};
export type Run = {
  id: number; type: string; status: string; total: number; done: number; error: string | null; config: RunConfig;
  cost: number; cache_hits: number; calls: number; prompt_tokens: number; completion_tokens: number; unparseable: number;
  created_at: string;
};
export type Estimate = {
  tasks: number; calls: number; cached: number; new_calls: number; est_cost_usd: number; cost_complete: boolean;
  note: string; flagged_judges: Record<string, string>;
};
export type Gap = { gap: number | null; lo: number | null; hi: number | null; n: number };
export type PointRow = {
  condition: string; n_correct: number; n_wrong: number; unparseable: number;
  mean_correct: number | null; mean_wrong: number | null; gap_correct: Gap | null; gap_wrong: Gap | null;
  auc: number | null; separation: number | null; accept_correct: number | null; accept_wrong: number | null;
};
export type PairRow = { condition: string; versus: string; n: number; wins: number; losses: number; ties: number; unparseable: number; win_rate: number | null; lo: number | null; hi: number | null };
export type CompRow = { condition: string; n: number; accuracy: number | null; unparseable: number };
export type ConsRow = { condition: string; n_items: number; mean_variance: number | null; max_variance: number | null; share_identical: number | null };
export type JudgeSummary = { pointwise: PointRow[]; pairwise: PairRow[]; comprehension: CompRow[]; consistency: ConsRow[] };
export type Summary = { reference: string; threshold: number; judges: Record<string, JudgeSummary> };

export type Insights = {
  screening: { pass: number; screened: number; judges: number };
  dataset: Overview["dataset"];
  pointwise?: { run_id: number; judges: number; by_condition: Record<string, { gap: number | null; auc: number | null; accept_wrong: number | null }> };
  pairwise?: { run_id: number; by_condition: Record<string, number | null> };
  comprehension?: { run_id: number; by_condition: Record<string, number | null> };
};

/** Experiment password (needed to start/resume runs or reload data). Kept only for this browser tab. */
export const runPassword = {
  get: (): string => { try { return sessionStorage.getItem("run-pw") ?? ""; } catch { return ""; } },
  set: (v: string) => { try { sessionStorage.setItem("run-pw", v); } catch { /* storage blocked */ } },
};

export async function api<T>(path: string, body?: unknown, opts: { runPassword?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.runPassword) headers["x-run-password"] = opts.runPassword;
  const r = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* not json */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json();
}

/** GET `path` on mount (and every `pollMs` if given). Returns data, error and a reload function. */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    load();
    const t = pollMs ? setInterval(load, pollMs) : undefined;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, pollMs]);
  return { data, error, reload: load };
}

export const fmt = {
  num: (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : v.toFixed(d)),
  pct: (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(d)}%`),
  usd: (v: number | null | undefined) => (v === null || v === undefined ? "–" : v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`),
  int: (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toLocaleString("en-US")),
};
