import Link from "next/link";
import { Badge, Header, Stat } from "./ui";
import { fmt, label, type Overview } from "../lib/api";

/** Presentational overview (no fetching), so it can be rendered in the smoke test with mock data. */
export function OverviewView({ data }: { data: Overview }) {
  const ds = data.dataset;
  const tr = ds.generated.roman_translit ?? { pending: 0, approved: 0, rejected: 0 };
  const cm = ds.generated.code_mixed ?? { pending: 0, approved: 0, rejected: 0 };
  return (
    <>
      <Header
        eyebrow="Research platform"
        title={<>Is the AI judge fair to <span className="gradient-text">Roman Urdu</span>?</>}
        lede="Measuring script bias in LLM judges: the same answer, shown in Urdu script, Roman Urdu, English and code-mixed Urdu, scored by the same judge."
      />

      {!data.api_key_set && (
        <p className="notice">OpenRouter key not set — only <span className="mono">mock/</span> judges can run. Add <span className="mono">OPENROUTER_API_KEY</span> to <span className="mono">.env</span>.</p>
      )}

      <div className="grid cols-4" style={{ marginTop: 24 }}>
        <Stat label="Items loaded" value={fmt.int(ds.items)} sub={`${fmt.int(ds.code_mixed_items)} in code-mixed subset`} />
        <Stat label="Roman (transliterated) approved" value={fmt.int(tr.approved)} sub={`${tr.pending} pending · ${tr.rejected} rejected`} />
        <Stat label="Code-mixed approved" value={fmt.int(cm.approved)} sub={`${cm.pending} pending · ${cm.rejected} rejected`} />
        <Stat label="Total spend" value={fmt.usd(data.total_cost_usd)} sub={`${fmt.int(data.total_calls)} cached calls · ${data.runs} runs`} />
      </div>

      <h2 className="section">Judges</h2>
      <div className="tile">
        <p className="muted" style={{ marginTop: 0 }}>
          Screening gate: a judge passes when its correct-vs-wrong AUC is above {data.threshold} in both Urdu script and English.
          Failed judges can still run, but their runs are flagged.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Judge</th><th>Screening</th><th className="num">AUC · {label("urdu_script")}</th><th className="num">AUC · {label("english")}</th></tr>
            </thead>
            <tbody>
              {data.judges.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.id}</td>
                  <td><Badge kind={j.status}>{j.status === "untested" ? "not screened" : j.status}</Badge></td>
                  <td className="num">{fmt.num(j.auc?.urdu_script ?? null)}</td>
                  <td className="num">{fmt.num(j.auc?.english ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.judges.length === 0 && <p className="muted">No judges configured. Add them to <span className="mono">Backend/config.toml</span>.</p>}
      </div>

      <h2 className="section">Next steps</h2>
      <div className="grid cols-3">
        <Link href="/data" className="tile tight"><h3>1 · Load data</h3><p className="muted" style={{ margin: 0 }}>Sample Belebele and generate transliterated + code-mixed text.</p></Link>
        <Link href="/review" className="tile tight"><h3>2 · Review</h3><p className="muted" style={{ margin: 0 }}>Approve, edit or reject generated text. Only approved items are used.</p></Link>
        <Link href="/runs" className="tile tight"><h3>3 · Run experiments</h3><p className="muted" style={{ margin: 0 }}>Screen judges, then run pointwise, pairwise and comprehension.</p></Link>
      </div>
    </>
  );
}
