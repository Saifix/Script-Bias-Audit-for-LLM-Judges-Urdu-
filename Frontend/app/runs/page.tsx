"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { JudgePicker, judgeName, smallJudges } from "../../components/JudgePicker";
import { RunLock } from "../../components/RunLock";
import { Badge, ErrorNote, Header, Progress, Segmented } from "../../components/ui";
import { api, fmt, label, runPassword, useApi, type AppConfig, type Estimate, type Overview, type Run } from "../../lib/api";

const TYPES = [
  { value: "screening", label: "Screening", help: "Correct vs. wrong in Urdu script and English on the pilot subset. Sets pass/fail." },
  { value: "comprehension", label: "Comprehension", help: "The judge answers the multiple-choice question itself in each script." },
  { value: "pointwise", label: "Pointwise", help: "Score each answer 1–10. Optional mitigations below." },
  { value: "pairwise", label: "Pairwise", help: "Same answer in two scripts (each condition vs. Urdu script), both orders." },
  { value: "repeats", label: "Repeats", help: "Re-run pointwise on a subset to measure consistency." },
];

export default function RunsPage() {
  const cfg = useApi<AppConfig>("/config");
  const ov = useApi<Overview>("/overview");
  const runs = useApi<{ runs: Run[] }>("/runs", 5000);
  const [type, setType] = useState("screening");
  const [judges, setJudges] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [flags, setFlags] = useState({ rubric: false, transliterate: false, panel: false });
  const [nItems, setNItems] = useState<number | "">("");
  const [repeats, setRepeats] = useState<number | "">("");
  const [roundLabel, setRoundLabel] = useState("Round 1");
  const [replicate, setReplicate] = useState<number | "">("");
  const [est, setEst] = useState<Estimate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfg.data && judges.length === 0) setJudges(smallJudges(cfg.data));
    if (cfg.data && conditions.length === 0) setConditions(cfg.data.conditions);
  }, [cfg.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = {
    type, judges, flags,
    conditions: type === "generate" ? conditions.filter((c) => c === "roman_translit" || c === "code_mixed").slice(0, 1) : conditions,
    n_items: nItems || undefined,
    repeats: repeats === "" ? undefined : repeats,
    label: roundLabel || undefined,
    replicate: replicate || undefined,
  };
  const bodyKey = JSON.stringify(body);

  useEffect(() => {
    if (!cfg.data) return;
    const t = setTimeout(async () => {
      try { setEst(await api<Estimate>("/runs/estimate", body)); setErr(null); }
      catch (e) { setEst(null); setErr((e as Error).message); }
    }, 300);
    return () => clearTimeout(t);
  }, [bodyKey, cfg.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setBusy(true);
    try { await api("/runs", body, { runPassword: runPassword.get() }); runs.reload(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function control(id: number, action: "start" | "stop") {
    try { await api(`/runs/${id}/${action}`, {}, { runPassword: runPassword.get() }); runs.reload(); } catch (e) { setErr((e as Error).message); }
  }

  const screening = Object.fromEntries((ov.data?.judges ?? []).map((j) => [j.id, j.status]));
  const s = cfg.data?.settings;
  const defaultN = type === "screening" ? s?.pilot_items : type === "repeats" ? s?.repeat_items : s?.n_items;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const condDisabled = (c: string) => type === "screening" ? !["urdu_script", "english"].includes(c)
    : type === "pairwise" ? c === "urdu_script" : type === "generate" ? !["roman_translit", "code_mixed"].includes(c) : false;

  return (
    <>
      <Header eyebrow="Experiments" title="Run an experiment" lede="Full experiments call real models and cost money, so starting or resuming one needs the experiment password. Every call is cached, so nothing is paid for twice." />

      <div className="tile">
        <div className="stack">
          <Segmented value={type} onChange={(v) => { setType(v); if (v === "generate") setConditions(["roman_translit"]); else if (cfg.data) setConditions(cfg.data.conditions); }}
            options={TYPES.map((t) => ({ value: t.value, label: t.label }))} />
          <p className="muted" style={{ margin: 0 }}>{TYPES.find((t) => t.value === type)?.help}</p>

          {type !== "generate" ? (
            <div>
              <p className="eyebrow">Judges</p>
              {cfg.data && <JudgePicker cfg={cfg.data} value={judges} onChange={setJudges}
                badge={(j) => screening[j] === "fail" ? "failed screening" : screening[j] === "pass" ? null : "not screened"} />}
            </div>
          ) : <p className="faint" style={{ margin: 0 }}>Generator model: <span className="mono">{cfg.data?.generator}</span></p>}

          <div>
            <p className="eyebrow">Conditions</p>
            <div className="row">
              {cfg.data?.conditions.map((c) => {
                const on = type === "screening" ? !condDisabled(c) : conditions.includes(c) && !condDisabled(c);
                return (
                  <button key={c} className={`chip ${on ? "on" : ""}`} disabled={condDisabled(c) || type === "screening"}
                    onClick={() => setConditions(type === "generate" ? [c] : toggle(conditions, c))}>
                    {label(c)}
                  </button>
                );
              })}
            </div>
            {type === "pairwise" && <p className="faint">Each condition is compared against Urdu script.</p>}
          </div>

          {type === "pointwise" && (
            <div>
              <p className="eyebrow">Mitigations</p>
              <div className="row">
                {([["rubric", "Rubric: ignore script & spelling"], ["transliterate", "Transliterate to Urdu script first"], ["panel", "Panel: average all judges"]] as const).map(([k, l]) => (
                  <button key={k} className={`chip ${flags[k] ? "on" : ""}`} onClick={() => setFlags({ ...flags, [k]: !flags[k] })}>{l}</button>
                ))}
              </div>
            </div>
          )}

          <div className="row">
            <label className="field">Round<input className="input" style={{ width: 200 }} value={roundLabel} onChange={(e) => setRoundLabel(e.target.value)} placeholder="e.g. Round 3 · medium" /></label>
            <label className="field" title="Above 0, every judge call is made fresh instead of reusing earlier answers">Replicate #<input className="input" type="number" min={0} max={99} style={{ width: 110 }} placeholder="0" value={replicate} onChange={(e) => setReplicate(e.target.value ? Number(e.target.value) : "")} /></label>
            <label className="field">Items (first N)<input className="input" type="number" min={1} style={{ width: 130 }} placeholder={String(defaultN ?? "")} value={nItems} onChange={(e) => setNItems(e.target.value ? Number(e.target.value) : "")} /></label>
            {type === "repeats" && <label className="field">Extra repeats<input className="input" type="number" min={1} style={{ width: 130 }} placeholder={String(s?.repeat_count ?? 2)} value={repeats} onChange={(e) => setRepeats(e.target.value === "" ? "" : Number(e.target.value))} /></label>}
          </div>

          <div className="tile tight" style={{ background: "var(--surface)", boxShadow: "none" }}>
            {est ? (
              <div className="row between">
                <div className="row" style={{ gap: 32 }}>
                  <div><div className="stat-label">Calls</div><strong>{fmt.int(est.calls)}</strong></div>
                  <div><div className="stat-label">Cached</div><strong>{fmt.int(est.cached)}</strong></div>
                  <div><div className="stat-label">New calls</div><strong>{fmt.int(est.new_calls)}</strong></div>
                </div>
                <div className="row"><RunLock /><button className="btn" onClick={create} disabled={busy || est.tasks === 0}>Start run</button></div>
              </div>
            ) : <span className="faint">Estimating…</span>}
            {est && Object.keys(est.flagged_judges).length > 0 && (
              <p className="faint" style={{ marginBottom: 0 }}>Flagged (did not pass screening): {Object.entries(est.flagged_judges).map(([j, st]) => `${j} (${st === "fail" ? "failed" : "not screened"})`).join(", ")}</p>
            )}
            {est?.note && <p className="faint" style={{ marginBottom: 0 }}>{est.note}</p>}
            {est && est.tasks === 0 && <p className="faint" style={{ marginBottom: 0 }}>Nothing to run — load data (and approve generated text for those conditions) first.</p>}
          </div>
          <ErrorNote error={err} />
        </div>
      </div>

      <h2 className="section">Rounds</h2>
      <div className="stack">
        {(() => {
          const all = runs.data?.runs ?? [];
          const groups = new Map<string, Run[]>();
          for (const r of [...all].sort((a, b) => a.id - b.id)) {
            const k = r.config.label ?? "Round 1";
            groups.set(k, [...(groups.get(k) ?? []), r]);
          }
          const ordered = [...groups.entries()].sort((a, b) => Math.max(...b[1].map((r) => r.id)) - Math.max(...a[1].map((r) => r.id)));
          const kindLabel = (r: Run) => {
            const f = Object.entries(r.config.flags ?? {}).filter(([, v]) => v).map(([k]) => k)[0];
            const base = TYPES.find((t) => t.value === r.type)?.label ?? r.type;
            return f ? `Fix: ${f === "transliterate" ? "transliterate first" : f === "panel" ? "judge panel" : f}` : base;
          };
          return ordered.map(([name, rs], gi) => {
            const done = rs.reduce((a, r) => a + r.done, 0), total = rs.reduce((a, r) => a + r.total, 0);
            const state = rs.some((r) => r.status === "running") ? "running" : rs.some((r) => r.status === "failed") ? "failed"
              : rs.every((r) => r.status === "done") ? "done" : "stopped";
            const judges = [...new Set(rs.flatMap((r) => r.config.judges))].map((j) => judgeName(cfg.data, j));
            return (
              <details key={name} className="tile tight round" open={state === "running" || gi === 0}>
                <summary>
                  <div className="row between" style={{ width: "100%" }}>
                    <div className="row">
                      <strong>{name}</strong>
                      <Badge kind={state} />
                      <span className="faint">{rs.length} experiment{rs.length > 1 ? "s" : ""} · {judges.join(", ")}</span>
                    </div>
                    <div className="row" style={{ minWidth: 220 }}>
                      <div style={{ flex: 1, minWidth: 120 }}><Progress value={done} total={total} /></div>
                      <span className="faint">{total ? Math.round((100 * done) / total) : 0}%</span>
                    </div>
                  </div>
                </summary>
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table>
                    <thead><tr><th>Experiment</th><th>Status</th><th style={{ width: "30%" }}>Progress</th><th className="num">Answers</th><th className="num">Unreadable</th><th></th></tr></thead>
                    <tbody>
                      {rs.map((r) => (
                        <tr key={r.id}>
                          <td><b>{kindLabel(r)}</b><div className="faint">#{r.id}{r.config.replicate ? ` · replicate ${r.config.replicate}` : ""}</div></td>
                          <td><Badge kind={r.status} />{r.error && <div className="faint" style={{ maxWidth: 260 }}>{r.error.slice(0, 120)}</div>}</td>
                          <td style={{ verticalAlign: "middle" }}><Progress value={r.done} total={r.total} /></td>
                          <td className="num">{fmt.int(r.done)} / {fmt.int(r.total)}</td>
                          <td className="num">{r.unparseable || "–"}</td>
                          <td>
                            <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                              {r.status === "running" ? <button className="btn secondary small" onClick={() => control(r.id, "stop")}>Stop</button>
                                : r.status !== "done" && <button className="btn small" onClick={() => control(r.id, "start")}>{r.status === "created" ? "Start" : "Resume"}</button>}
                              {r.done > 0 && <Link className="btn secondary small" href={`/results?run=${r.id}`}>Results</Link>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          });
        })()}
        {runs.data?.runs.length === 0 && <p className="muted">No runs yet.</p>}
      </div>
    </>
  );
}
