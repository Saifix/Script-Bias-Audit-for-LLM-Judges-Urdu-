import Link from "next/link";
import { fmt, label, type Insights } from "../lib/api";

function Bars({ rows, max, show }: { rows: [string, number | null][]; max: number; show: (v: number) => string }) {
  return (
    <div className="bars">
      {rows.map(([c, v]) => (
        <div key={c} className="bar-row">
          <span>{label(c)}</span>
          <div className="track"><div className="fillbar" style={{ width: v == null || !max ? 0 : `${Math.min(100, (Math.abs(v) / max) * 100)}%` }} /></div>
          <b>{v == null ? "–" : show(v)}</b>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="d">{text} <Link href="/runs">Open experiments →</Link></p>;
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

/** Brief headline cards from the latest finished runs. Presentational, so it renders in the smoke test. */
export function InsightsView({ data }: { data: Insights }) {
  const pw = data.pointwise;
  const gaps = pw ? Object.entries(pw.by_condition).filter(([c]) => c !== "urdu_script").map(([c, v]) => [c, v.gap] as [string, number | null]) : [];
  const worst = gaps.filter(([, v]) => v != null).sort((a, b) => Math.abs(b[1]!) - Math.abs(a[1]!))[0];
  const pair = data.pairwise ? Object.entries(data.pairwise.by_condition) : [];
  const roman = pair.find(([c]) => c.startsWith("roman")) ?? pair[0];
  const comp = data.comprehension ? Object.entries(data.comprehension.by_condition) : [];
  const ds = data.dataset;
  const reviewed = (ds.generated.roman_translit?.approved ?? 0) + (ds.generated.code_mixed?.approved ?? 0);

  return (
    <div className="grid cols-4">
      <div className="tile insight">
        <span className="k">Score gap vs. Urdu script</span>
        {worst ? (
          <>
            <span className="v">{signed(worst[1]!)} <small>pts</small></span>
            <span className="d">Biggest shift: <b>{label(worst[0])}</b>, same answers, mean of {pw!.judges} judge{pw!.judges === 1 ? "" : "s"}.</span>
            <Bars rows={gaps} max={Math.max(...gaps.map(([, v]) => Math.abs(v ?? 0)), 0.5)} show={signed} />
          </>
        ) : <><span className="v">–</span><Empty text="No pointwise results yet." /></>}
      </div>

      <div className="tile insight">
        <span className="k">Pairwise preference</span>
        {roman ? (
          <>
            <span className="v">{fmt.pct(roman[1], 0)} <small>{label(roman[0])}</small></span>
            <span className="d">How often judges pick it over Urdu script. 50% means no preference.</span>
            <Bars rows={pair} max={1} show={(v) => fmt.pct(v, 0)} />
          </>
        ) : <><span className="v">–</span><Empty text="No pairwise results yet." /></>}
      </div>

      <div className="tile insight">
        <span className="k">Comprehension accuracy</span>
        {comp.length ? (
          <>
            <span className="v">{fmt.pct(comp[0][1], 0)} <small>{label(comp[0][0])}</small></span>
            <span className="d">Judges answering the question themselves, by script.</span>
            <Bars rows={comp} max={1} show={(v) => fmt.pct(v, 0)} />
          </>
        ) : <><span className="v">–</span><Empty text="No comprehension results yet." /></>}
      </div>

      <div className="tile insight">
        <span className="k">Readiness</span>
        <span className="v">{data.screening.pass}/{data.screening.judges} <small>judges pass</small></span>
        <span className="d">Screening gate: judges must tell right from wrong answers.</span>
        <span className="d">{fmt.int(ds.items)} questions loaded · {fmt.int(reviewed)} generated versions reviewed.</span>
      </div>
    </div>
  );
}
