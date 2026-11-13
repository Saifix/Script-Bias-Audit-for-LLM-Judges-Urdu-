"use client";
import { useEffect, useMemo, useState } from "react";
import { AccuracyChart, AcceptanceChart, AucChart, GapChart, WinRateChart } from "../../components/Charts";
import { judgeName } from "../../components/JudgePicker";
import { PlainWords } from "../../components/TestYourself";
import { Scorecard } from "../../components/Scorecard";
import { Badge, ErrorNote, Header, Segmented } from "../../components/ui";
import { fmt, label, useApi, type AppConfig, type Finding, type Gap, type Run, type Summary } from "../../lib/api";

const ci = (g: Gap | null) => (g && g.gap !== null ? `${g.gap.toFixed(2)} [${fmt.num(g.lo)}, ${fmt.num(g.hi)}]` : "–");

// One tab per experiment; a round normally has one run of each.
const TABS: { key: string; label: string; help: string }[] = [
  { key: "pointwise", label: "Scores", help: "Each answer scored 1–10 in every version. Fair = the same score whatever the script." },
  { key: "pairwise", label: "Head-to-head", help: "The same answer shown in two scripts side by side, in both orders. Fair = picks each version 50% of the time." },
  { key: "comprehension", label: "Understanding", help: "The judge answers the multiple-choice question itself. Fair = equally accurate in every version." },
  { key: "repeats", label: "Consistency", help: "The same answers scored again (50 questions). Shows how stable a judge's scores are." },
  { key: "pointwise+rubric", label: "Fix: rubric", help: "Scores again, with the instruction “ignore script, spelling and formality”." },
  { key: "pointwise+transliterate", label: "Fix: transliterate first", help: "Roman Urdu and code-mixed text converted to Urdu script before judging." },
  { key: "pointwise+panel", label: "Fix: judge panel", help: "The average score of all judges in the round, treated as one judge." },
  { key: "screening", label: "Screening", help: "20 questions: can the judge tell right from wrong answers at all?" },
];
const kindOf = (r: Run) => r.type + Object.entries(r.config.flags ?? {}).filter(([, v]) => v).map(([k]) => `+${k}`).join("");
const roundOf = (r: Run) => r.config.label ?? "Round 1";

export default function ResultsPage() {
  const cfg = useApi<AppConfig>("/config");
  const runs = useApi<{ runs: Run[] }>("/runs", 15000);
  const [round, setRound] = useState<string>("");
  const [tab, setTab] = useState<string>("");
  const [judge, setJudge] = useState<string>("");

  const done = useMemo(() => (runs.data?.runs ?? []).filter((r) => r.type !== "generate" && r.done > 0), [runs.data]);
  const rounds = useMemo(() => [...new Set([...done].sort((a, b) => a.id - b.id).map(roundOf))], [done]);
  const inRound = done.filter((r) => roundOf(r) === round);
  const tabs = TABS.filter((t) => inRound.some((r) => kindOf(r) === t.key));
  const run = inRound.filter((r) => kindOf(r) === tab).sort((a, b) => b.id - a.id)[0];
  const runId = run?.id ?? null;

  // initial selection: ?run=N, else the latest round and its Scores tab
  useEffect(() => {
    if (round || !done.length) return;
    const q = Number(new URLSearchParams(window.location.search).get("run"));
    const r = done.find((x) => x.id === q) ?? [...done].sort((a, b) => b.id - a.id)[0];
    setRound(roundOf(r));
    setTab(q && r.id === q ? kindOf(r) : "pointwise");
  }, [done.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (round && tabs.length && !tabs.some((t) => t.key === tab)) setTab(tabs[0].key); }, [round, tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useApi<Summary>(runId ? `/runs/${runId}/summary` : null, run?.status === "running" ? 10000 : undefined);
  const words = useApi<{ summary: { text: string; name: string } | null; findings?: Finding[] }>(runId && run?.status === "done" ? `/runs/${runId}/explain` : null);

  const judges = Object.keys(summary.data?.judges ?? {});
  useEffect(() => { if (judges.length && !judges.includes(judge)) setJudge(judges[0]); }, [judges.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const js = summary.data?.judges[judge];
  const ref = summary.data?.reference ?? "urdu_script";
  const threshold = summary.data?.threshold ?? 7;
  const help = TABS.find((t) => t.key === tab)?.help;
  const wordsLoading = !!runId && run?.status === "done" && !words.data && !words.error;

  return (
    <>
      <Header eyebrow="Results" title="What the judges did"
        lede="Pick a round, then an experiment. Urdu script is the reference: a fair judge treats every version the same." />

      {done.length === 0 && runs.data && <div className="tile"><p className="muted" style={{ margin: 0 }}>No results yet. Start an experiment on the Experiments page.</p></div>}
      {!runs.data && !runs.error && <p className="muted">Loading…</p>}

      {rounds.length > 0 && (
        <div className="tile flat stack" style={{ gap: 12, marginBottom: 20 }}>
          <div className="row"><span className="eyebrow" style={{ margin: 0, minWidth: 90 }}>Round</span>
            <Segmented value={round} onChange={(v) => { setRound(v); setJudge(""); }} options={rounds.map((r) => ({ value: r, label: r }))} /></div>
          <div className="row"><span className="eyebrow" style={{ margin: 0, minWidth: 90 }}>Experiment</span>
            <Segmented value={tab} onChange={(v) => { setTab(v); setJudge(""); }} options={tabs.map((t) => ({ value: t.key, label: t.label }))} /></div>
          {help && <p className="muted" style={{ margin: 0 }}>{help}</p>}
          {run && (
            <div className="row between">
              <div className="row">
                <Badge kind={run.status} />
                <span className="faint">Run #{run.id} · {run.done.toLocaleString("en-US")} of {run.total.toLocaleString("en-US")} answers{run.config.replicate ? ` · replicate ${run.config.replicate}` : ""}</span>
              </div>
              <div className="row">
                <a className="btn secondary small" href={`/api/runs/${run.id}/export.csv`} download>Export CSV</a>
                <a className="btn secondary small" href={`/api/runs/${run.id}/export.json`} download={`run_${run.id}.json`}>Export JSON</a>
              </div>
            </div>
          )}
        </div>
      )}

      <ErrorNote error={runs.error ?? summary.error} />
      {wordsLoading && <div className="tile plain" style={{ marginBottom: 20 }}><p className="eyebrow">In plain words</p><p className="muted" style={{ margin: 0 }}>Writing a short summary of these numbers…</p></div>}
      {words.data?.summary && <div style={{ marginBottom: 20 }}><PlainWords summary={words.data.summary} /></div>}
      {words.data?.findings && words.data.findings.length > 0 && <div style={{ marginBottom: 24 }}><Scorecard findings={words.data.findings} /></div>}
      {runId && !summary.data && !summary.error && <p className="muted">Loading results…</p>}

      {judges.length > 0 && (
        <div className="row" style={{ marginBottom: 20 }}>
          <span className="eyebrow" style={{ margin: 0, minWidth: 90 }}>Details for</span>
          <Segmented value={judge} onChange={setJudge} options={judges.map((j) => ({ value: j, label: j === "panel" ? "Panel (average)" : judgeName(cfg.data, j) }))} />
          {run && Object.keys(run.config.flagged_judges ?? {}).includes(judge) && <Badge kind="warn">did not pass screening</Badge>}
        </div>
      )}

      {js && (
        <div className="stack" style={{ gap: 24 }}>
          {js.pointwise.length > 0 && (
            <>
              <div className="grid cols-2">
                {js.pointwise.some((r) => r.condition !== ref) && <GapChart rows={js.pointwise} reference={ref} />}
                <AucChart rows={js.pointwise} />
                <AcceptanceChart rows={js.pointwise} threshold={threshold} />
              </div>
              <div className="tile">
                <p className="chart-title">Pointwise scores</p>
                <div className="table-wrap">
                  <table>
                    <thead><tr>
                      <th>Condition</th><th className="num">n (c / w)</th><th className="num">Mean correct</th><th className="num">Mean wrong</th>
                      <th className="num">Gap correct [95% CI]</th><th className="num">Gap wrong [95% CI]</th><th className="num">AUC</th>
                      <th className="num">Separation</th><th className="num">Accept c / w</th><th className="num">Unparseable</th>
                    </tr></thead>
                    <tbody>
                      {js.pointwise.map((r) => (
                        <tr key={r.condition}>
                          <td>{label(r.condition)}{r.condition === ref && <span className="faint"> · reference</span>}</td>
                          <td className="num">{r.n_correct} / {r.n_wrong}</td>
                          <td className="num">{fmt.num(r.mean_correct)}</td><td className="num">{fmt.num(r.mean_wrong)}</td>
                          <td className="num">{ci(r.gap_correct)}</td><td className="num">{ci(r.gap_wrong)}</td>
                          <td className="num">{fmt.num(r.auc)}</td><td className="num">{fmt.num(r.separation)}</td>
                          <td className="num">{fmt.pct(r.accept_correct, 0)} / {fmt.pct(r.accept_wrong, 0)}</td>
                          <td className="num">{r.unparseable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {js.pairwise.length > 0 && (
            <div className="grid cols-2">
              <WinRateChart rows={js.pairwise} />
              <div className="tile">
                <p className="chart-title">Pairwise comparisons</p>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Condition vs. {label(ref)}</th><th className="num">Win rate [95% CI]</th><th className="num">W / L / T</th><th className="num">Unparseable</th></tr></thead>
                    <tbody>
                      {js.pairwise.map((r) => (
                        <tr key={r.condition}>
                          <td>{label(r.condition)}</td>
                          <td className="num">{fmt.pct(r.win_rate)} [{fmt.pct(r.lo, 0)}, {fmt.pct(r.hi, 0)}]</td>
                          <td className="num">{r.wins} / {r.losses} / {r.ties}</td>
                          <td className="num">{r.unparseable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {js.comprehension.length > 0 && (
            <div className="grid cols-2">
              <AccuracyChart rows={js.comprehension} />
              <div className="tile">
                <p className="chart-title">Comprehension</p>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Condition</th><th className="num">Accuracy</th><th className="num">n</th><th className="num">Unparseable</th></tr></thead>
                    <tbody>
                      {js.comprehension.map((r) => (
                        <tr key={r.condition}><td>{label(r.condition)}</td><td className="num">{fmt.pct(r.accuracy)}</td><td className="num">{r.n}</td><td className="num">{r.unparseable}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {js.consistency.length > 0 && (
            <div className="tile">
              <p className="chart-title">Consistency across repeats</p>
              <p className="chart-sub">Per-item score variance across repeats. 0 = identical every time.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Condition</th><th className="num">Items</th><th className="num">Mean variance</th><th className="num">Max variance</th><th className="num">Identical</th></tr></thead>
                  <tbody>
                    {js.consistency.map((r) => (
                      <tr key={r.condition}><td>{label(r.condition)}</td><td className="num">{r.n_items}</td><td className="num">{fmt.num(r.mean_variance, 3)}</td><td className="num">{fmt.num(r.max_variance, 2)}</td><td className="num">{fmt.pct(r.share_identical, 0)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
