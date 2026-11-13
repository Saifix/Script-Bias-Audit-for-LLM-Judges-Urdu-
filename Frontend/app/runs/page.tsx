"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  const runs = useApi<{ runs: Run[] }>("/runs", 2000);
  const [type, setType] = useState("screening");
  const [judges, setJudges] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [flags, setFlags] = useState({ rubric: false, transliterate: false, panel: false });
  const [nItems, setNItems] = useState<number | "">("");
  const [repeats, setRepeats] = useState<number | "">("");
  const [est, setEst] = useState<Estimate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfg.data && judges.length === 0) setJudges(cfg.data.judges);
    if (cfg.data && conditions.length === 0) setConditions(cfg.data.conditions);
  }, [cfg.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = {
    type, judges, flags,
    conditions: type === "generate" ? conditions.filter((c) => c === "roman_translit" || c === "code_mixed").slice(0, 1) : conditions,
    n_items: nItems || undefined,
    repeats: repeats === "" ? undefined : repeats,
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
              <div className="row">
                {cfg.data?.judges.map((j) => (
                  <button key={j} className={`chip ${judges.includes(j) ? "on" : ""}`} onClick={() => setJudges(toggle(judges, j))}>
                    <span className="mono">{j}</span>
                    {screening[j] && screening[j] !== "pass" && <span title="screening status">· {screening[j] === "fail" ? "failed screening" : "not screened"}</span>}
                  </button>
                ))}
              </div>
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
                  <div><div className="stat-label">Est. cost</div><strong>{fmt.usd(est.est_cost_usd)}{!est.cost_complete && " +"}</strong></div>
                </div>
                <div className="row"><RunLock /><button className="btn" onClick={create} disabled={busy || est.tasks === 0}>Start run</button></div>
              </div>
            ) : <span className="faint">Estimating…</span>}
            {est && Object.keys(est.flagged_judges).length > 0 && (
              <p className="faint" style={{ marginBottom: 0 }}>Flagged (did not pass screening): {Object.entries(est.flagged_judges).map(([j, st]) => `${j} (${st === "fail" ? "failed" : "not screened"})`).join(", ")}</p>
            )}
            {est?.note && <p className="faint" style={{ marginBottom: 0 }}>{est.note}</p>}
            {est && !est.cost_complete && <p className="faint" style={{ marginBottom: 0 }}>Some model prices are unknown, so the estimate is a lower bound.</p>}
            {est && est.tasks === 0 && <p className="faint" style={{ marginBottom: 0 }}>Nothing to run — load data (and approve generated text for those conditions) first.</p>}
          </div>
          <ErrorNote error={err} />
        </div>
      </div>

      <h2 className="section">All runs</h2>
      <div className="stack">
        {runs.data?.runs.map((r) => {
          const active = r.status === "running";
          const flagged = Object.keys(r.config.flagged_judges ?? {});
          return (
            <div key={r.id} className="tile tight">
              <div className="row between">
                <div className="row">
                  <strong>#{r.id} · {TYPES.find((t) => t.value === r.type)?.label ?? r.type}</strong>
                  <Badge kind={r.status} />
                  {flagged.length > 0 && <Badge kind="warn">{flagged.length} flagged judge{flagged.length > 1 ? "s" : ""}</Badge>}
                  {Object.entries(r.config.flags ?? {}).filter(([, v]) => v).map(([k]) => <Badge key={k} kind="running">{k}</Badge>)}
                </div>
                <div className="row">
                  {active ? <button className="btn secondary small" onClick={() => control(r.id, "stop")}>Stop</button>
                    : r.status !== "done" && <button className="btn small" onClick={() => control(r.id, "start")}>{r.status === "created" ? "Start" : "Resume"}</button>}
                  {r.type !== "generate" && r.done > 0 && <Link className="btn secondary small" href={`/results?run=${r.id}`}>Results</Link>}
                </div>
              </div>
              <div style={{ margin: "12px 0 8px" }}><Progress value={r.done} total={r.total} /></div>
              <div className="row faint" style={{ gap: 20 }}>
                <span>{fmt.int(r.done)} / {fmt.int(r.total)} tasks</span>
                <span>{fmt.int(r.cache_hits)} from cache</span>
                <span>{fmt.int(r.prompt_tokens + r.completion_tokens)} tokens</span>
                <span>{fmt.usd(r.cost)}</span>
                {r.unparseable > 0 && <span>{r.unparseable} unparseable</span>}
                <span className="mono">{r.config.judges.join(", ")}</span>
                <span>{r.config.conditions.map(label).join(", ")}</span>
              </div>
              {r.error && <p className="notice error" style={{ marginBottom: 0 }}>{r.error}</p>}
            </div>
          );
        })}
        {runs.data?.runs.length === 0 && <p className="muted">No runs yet.</p>}
      </div>
    </>
  );
}
