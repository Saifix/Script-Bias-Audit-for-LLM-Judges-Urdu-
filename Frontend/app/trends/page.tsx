"use client";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "../../components/Charts";
import { Glossary } from "../../components/Glossary";
import { ErrorNote, Header } from "../../components/ui";
import { api, fmt, useApi } from "../../lib/api";

type Row = {
  id: string; name: string; family: string; tier: number; tier_name: string; runs: Record<string, number>;
  gap?: Record<string, { gap: number | null; lo: number | null; hi: number | null }>;
  win?: Record<string, { rate: number | null; lo: number | null; hi: number | null }>;
  accuracy?: Record<string, number | null>; auc?: Record<string, number | null>; accept_wrong?: Record<string, number | null>;
};
type Trend = { judges: Row[]; labels: string[] };

const TIERS = [1, 2, 3];
const TIER_LABEL: Record<number, string> = { 1: "Small", 2: "Medium", 3: "Large" };
// Three families, told apart by lightness AND line style AND marker (never by colour alone).
const DASH = ["", "6 4", "2 3"];

type Metric = { key: string; title: string; sub: string; get: (r: Row) => number | null | undefined; ref: number; unit: string; domain?: [number, number]; digits: number };
const METRICS: Metric[] = [
  { key: "gap", title: "Roman Urdu score penalty", sub: "Score change for the same correct answer, Roman Urdu vs Urdu script. 0 = fair; below 0 = penalised.", get: (r) => r.gap?.roman_translit?.gap, ref: 0, unit: " pts", digits: 2 },
  { key: "win", title: "Picks Roman Urdu head-to-head", sub: "Same answer in both scripts: how often the Roman Urdu version wins. 50% = fair.", get: (r) => (r.win?.roman_translit?.rate ?? null) == null ? null : r.win!.roman_translit.rate! * 100, ref: 50, unit: "%", domain: [0, 100], digits: 0 },
  { key: "comp", title: "Understanding gap", sub: "Accuracy answering the question itself: Roman Urdu minus Urdu script (points). 0 = understands both equally.", get: (r) => r.accuracy?.roman_translit != null && r.accuracy?.urdu_script != null ? (r.accuracy.roman_translit - r.accuracy.urdu_script) * 100 : null, ref: 0, unit: " pts", digits: 0 },
  { key: "auc", title: "Catching wrong answers in Roman Urdu", sub: "AUC: how well scores separate right from wrong answers in Roman Urdu. 0.5 = chance, 1 = perfect.", get: (r) => r.auc?.roman_translit, ref: 0.5, unit: "", domain: [0.4, 1], digits: 2 },
];

/** Plain-language takeaway: for each company, does the measure move toward "fair" from its smallest to its largest model? */
function trendTakeaway(m: Metric, rows: Row[], families: string[]): string | null {
  const fmtv = (v: number) => `${v.toFixed(m.digits)}${m.unit.trim() === "%" ? "%" : m.unit}`;
  const better: string[] = [], notBetter: string[] = [], parts: string[] = [];
  for (const f of families) {
    const fr = rows.filter((r) => r.family === f && m.get(r) != null).sort((a, b) => a.tier - b.tier);
    if (fr.length < 2) continue;
    const a = m.get(fr[0])!, b = m.get(fr[fr.length - 1])!;
    parts.push(`${f.split(" ")[0]} ${fmtv(a)} → ${fmtv(b)}`);
    const tol = m.key === "auc" ? 0.02 : m.key === "gap" ? 0.15 : 3;
    // AUC: higher is better; others: closer to the fair line is better
    const improved = m.key === "auc" ? b > a + tol : Math.abs(b - m.ref) < Math.abs(a - m.ref) - tol;
    (improved ? better : notBetter).push(f.split(" ")[0]);
  }
  if (!parts.length) return null;
  const verdict = !better.length ? "No company gets fairer as its models get bigger."
    : !notBetter.length ? "Every company improves as its models get bigger."
    : `Improves with size: ${better.join(", ")}; does not: ${notBetter.join(", ")}.`;
  return `Smallest → largest model: ${parts.join(" · ")}. ${verdict}`;
}

function TrendChart({ m, rows, families }: { m: Metric; rows: Row[]; families: string[] }) {
  const t = useTheme();
  const STYLE = [t.s1, t.ink2, t.s2].map((stroke, i) => ({ stroke, dash: DASH[i] }));
  const data = TIERS.map((t) => {
    const d: Record<string, string | number | null> = { tier: TIER_LABEL[t] };
    families.forEach((f) => {
      const r = rows.find((x) => x.family === f && x.tier === t);
      const v = r ? m.get(r) : null;
      d[f] = v == null ? null : Number(v.toFixed(m.digits + 1));
      d[`${f}__name`] = r?.name ?? "";
    });
    return d;
  });
  return (
    <div className="tile">
      <p className="chart-title">{m.title}</p>
      <p className="chart-sub">{m.sub}</p>
      <div className="legend">
        {families.map((f, i) => <span key={f} style={{ ["--c" as string]: STYLE[i % 3].stroke }}>{f}{STYLE[i % 3].dash ? " (dashed)" : ""}</span>)}
      </div>
      <div style={{ width: "100%", height: 230 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={t.grid} />
            <XAxis dataKey="tier" tick={{ fill: t.ink2, fontSize: 12 }} axisLine={{ stroke: t.grid }} tickLine={false} />
            <YAxis domain={m.domain ?? ["auto", "auto"]} tick={{ fill: t.ink2, fontSize: 12 }} axisLine={false} tickLine={false} unit={m.unit.trim() === "%" ? "%" : ""} />
            <ReferenceLine y={m.ref} stroke={t.ink2} label={{ value: "fair", position: "insideTopRight", fill: t.ink2, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: t.tip, border: "none", borderRadius: 12, fontSize: 13, color: t.ink }}
              formatter={(v, name, item) => [`${typeof v === "number" ? v.toFixed(m.digits) : v}${m.unit} — ${(item?.payload as Record<string, string>)?.[`${name}__name`] ?? ""}`, String(name)]} />
            {families.map((f, i) => (
              <Line key={f} type="monotone" dataKey={f} stroke={STYLE[i % 3].stroke} strokeWidth={2} strokeDasharray={STYLE[i % 3].dash}
                dot={{ r: 5, strokeWidth: 2, fill: t.tip }} activeDot={{ r: 6 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {trendTakeaway(m, rows, families) && <p className="takeaway"><b>What this shows:</b> {trendTakeaway(m, rows, families)}</p>}
    </div>
  );
}

export default function TrendsPage() {
  const latest = useApi<Trend>("/trend");
  const [byLabel, setByLabel] = useState<Record<string, Trend>>({});
  const rows = latest.data?.judges ?? [];
  const families = ["Qwen (Alibaba)", "Google", "Llama (Meta)"].filter((f) => rows.some((r) => r.family === f))
    .concat([...new Set(rows.map((r) => r.family))].filter((f) => !["Qwen (Alibaba)", "Google", "Llama (Meta)"].includes(f)));
  const labels = latest.data?.labels ?? [];

  useEffect(() => {
    if (labels.length < 2) return;
    Promise.all(labels.map((l) => api<Trend>(`/trend?label=${encodeURIComponent(l)}`).then((t) => [l, t] as const)))
      .then((pairs) => setByLabel(Object.fromEntries(pairs))).catch(() => {});
  }, [labels.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiersSeen = [...new Set(rows.map((r) => r.tier))];
  return (
    <>
      <Header eyebrow="Trends" title="Does a smarter judge treat Roman Urdu more fairly?"
        lede="Each line is one company's models, from small to large. A fair judge sits on the “fair” line in every chart. Numbers come from each judge's latest full run." />
      <ErrorNote error={latest.error} />
      {latest.data && rows.length === 0 && <div className="tile"><p className="muted" style={{ margin: 0 }}>No finished experiment runs yet.</p></div>}
      <div style={{ margin: "4px 0 16px" }}><Glossary /></div>
      {rows.length > 0 && tiersSeen.length < 2 && (
        <p className="notice">Only {TIER_LABEL[tiersSeen[0]]?.toLowerCase()} models have been run so far — the lines will appear once medium and large models are tested.</p>
      )}
      {rows.length > 0 && (
        <div className="grid cols-2" style={{ marginTop: 16 }}>
          {METRICS.map((m) => <TrendChart key={m.key} m={m} rows={rows} families={families} />)}
        </div>
      )}

      {rows.length > 0 && (
        <div className="tile" style={{ marginTop: 20 }}>
          <p className="chart-title">All judges</p>
          <p className="chart-sub">Roman Urdu compared with Urdu script. Brackets are 95% confidence intervals.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Judge</th><th>Company</th><th>Size</th><th className="num">Score penalty</th><th className="num">Picks Roman head-to-head</th><th className="num">Understands: Urdu / Roman</th><th className="num">Catches wrong answers: Urdu / Roman</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const g = r.gap?.roman_translit, w = r.win?.roman_translit;
                  return (
                    <tr key={r.id}>
                      <td><b>{r.name}</b></td><td>{r.family}</td><td>{r.tier_name}</td>
                      <td className="num">{g?.gap != null ? `${g.gap.toFixed(2)} [${fmt.num(g.lo)}, ${fmt.num(g.hi)}]` : "–"}</td>
                      <td className="num">{w?.rate != null ? `${fmt.pct(w.rate, 0)} [${fmt.pct(w.lo, 0)}, ${fmt.pct(w.hi, 0)}]` : "–"}</td>
                      <td className="num">{fmt.pct(r.accuracy?.urdu_script, 0)} / {fmt.pct(r.accuracy?.roman_translit, 0)}</td>
                      <td className="num">{fmt.num(r.auc?.urdu_script)} / {fmt.num(r.auc?.roman_translit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {labels.length > 1 && Object.keys(byLabel).length > 1 && (
        <div className="tile" style={{ marginTop: 20 }}>
          <p className="chart-title">Rounds compared — does the result replicate?</p>
          <p className="chart-sub">Roman Urdu score penalty / head-to-head win rate for each judge in each round. Similar numbers across rounds mean the finding is stable.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Judge</th>{labels.map((l) => <th key={l} className="num">{l}</th>)}</tr></thead>
              <tbody>
                {[...new Set(Object.values(byLabel).flatMap((t) => t.judges.map((r) => r.id)))].map((id) => {
                  const name = Object.values(byLabel).flatMap((t) => t.judges).find((r) => r.id === id)?.name ?? id;
                  return (
                    <tr key={id}>
                      <td><b>{name}</b></td>
                      {labels.map((l) => {
                        const r = byLabel[l]?.judges.find((x) => x.id === id);
                        const g = r?.gap?.roman_translit?.gap, w = r?.win?.roman_translit?.rate;
                        return <td key={l} className="num">{r ? `${g != null ? g.toFixed(2) : "–"} / ${w != null ? fmt.pct(w, 0) : "–"}` : "–"}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
