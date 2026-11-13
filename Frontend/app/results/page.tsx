"use client";
import { useEffect, useState } from "react";
import { AccuracyChart, AcceptanceChart, AucChart, GapChart, WinRateChart } from "../../components/Charts";
import { PlainWords } from "../../components/TestYourself";
import { Badge, ErrorNote, Header, Segmented } from "../../components/ui";
import { fmt, label, useApi, type Gap, type Run, type Summary } from "../../lib/api";

const ci = (g: Gap | null) => (g && g.gap !== null ? `${g.gap.toFixed(2)} [${fmt.num(g.lo)}, ${fmt.num(g.hi)}]` : "–");

export default function ResultsPage() {
  const runs = useApi<{ runs: Run[] }>("/runs", 5000);
  const [runId, setRunId] = useState<number | null>(null);
  const [judge, setJudge] = useState<string>("");
  const done = (runs.data?.runs ?? []).filter((r) => r.type !== "generate" && r.done > 0);
  const run = done.find((r) => r.id === runId);
  const summary = useApi<Summary>(runId ? `/runs/${runId}/summary` : null, run?.status === "running" ? 4000 : undefined);
  const words = useApi<{ summary: { text: string; name: string } | null }>(runId && run?.status === "done" ? `/runs/${runId}/explain` : null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("run");
    if (q) setRunId(Number(q));
  }, []);
  useEffect(() => { if (runId === null && done.length) setRunId(done[0].id); }, [done.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const judges = Object.keys(summary.data?.judges ?? {});
  useEffect(() => { if (judges.length && !judges.includes(judge)) setJudge(judges[0]); }, [judges.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const js = summary.data?.judges[judge];
  const ref = summary.data?.reference ?? "urdu_script";
  const threshold = summary.data?.threshold ?? 7;

  return (
    <>
      <Header eyebrow="Results" title="What the judges did" lede="Per judge and script condition, with Urdu script as the reference. Ties and unparseable outputs are reported separately." />

      <div className="row between" style={{ marginBottom: 24 }}>
        <div className="row">
          <select className="input" value={runId ?? ""} onChange={(e) => setRunId(Number(e.target.value))} aria-label="Run">
            {done.map((r) => <option key={r.id} value={r.id}>#{r.id} · {r.type} · {r.status}</option>)}
          </select>
          {run && <Badge kind={run.status} />}
          {run && Object.keys(run.config.flagged_judges ?? {}).includes(judge) && <Badge kind="warn">judge did not pass screening</Badge>}
        </div>
        {runId && (
          <div className="row">
            <a className="btn secondary small" href={`/api/runs/${runId}/export.csv`} download>Export CSV</a>
            <a className="btn secondary small" href={`/api/runs/${runId}/export.json`} download={`run_${runId}.json`}>Export JSON</a>
          </div>
        )}
      </div>

      <ErrorNote error={runs.error ?? summary.error} />
      {words.data?.summary && <div style={{ marginBottom: 24 }}><PlainWords summary={words.data.summary} /></div>}
      {done.length === 0 && runs.data && <div className="tile"><p className="muted" style={{ margin: 0 }}>No results yet. Start a run on the Runs page.</p></div>}

      {judges.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <Segmented value={judge} onChange={setJudge} options={judges.map((j) => ({ value: j, label: j === "panel" ? "Panel (average)" : j }))} />
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
