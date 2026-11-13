"use client";
// Small bar charts (Recharts). Neutral greys: two lightness steps (ΔE ≈ 30, ≥ 3:1 contrast) plus legend + table, never colour alone.
import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { label, type CompRow, type PairRow, type PointRow } from "../lib/api";

const LIGHT = { s1: "#3A3A3C", s2: "#8E8E93", ink: "#1D1D1F", ink2: "#6E6E73", grid: "#E5E5EA", tip: "#FFFFFF" };
const DARK = { s1: "#E5E5EA", s2: "#8E8E93", ink: "#F5F5F7", ink2: "#A1A1A6", grid: "#38383A", tip: "#2C2C2E" };

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.dataset.theme === "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark ? DARK : LIGHT;
}

type Series = { key: string; name: string; err?: string };
type Datum = Record<string, string | number | null | [number, number]>;

function ciErr(v: number | null, lo: number | null, hi: number | null, scale = 1): [number, number] | null {
  return v === null || lo === null || hi === null ? null : [(v - lo) * scale, (hi - v) * scale];
}

function Frame({ title, sub, children, legend, takeaway }: { title: string; sub: string; children: ReactNode; legend?: { name: string; color: string }[]; takeaway?: string | null }) {
  return (
    <div className="tile">
      <p className="chart-title">{title}</p>
      <p className="chart-sub">{sub}</p>
      {legend && legend.length > 1 && (
        <div className="legend">{legend.map((l) => <span key={l.name} style={{ ["--c" as string]: l.color }}>{l.name}</span>)}</div>
      )}
      <div style={{ width: "100%", height: 240 }}>{children}</div>
      {takeaway && <p className="takeaway"><b>What this shows:</b> {takeaway}</p>}
    </div>
  );
}

function Bars({ data, series, domain, refY, refLabel, unit = "", digits = 2 }: {
  data: Datum[]; series: Series[]; domain?: [number | string, number | string]; refY?: number; refLabel?: string; unit?: string; digits?: number;
}) {
  const t = useTheme();
  const colors = [t.s1, t.s2];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
        <XAxis dataKey="name" tick={{ fill: t.ink2, fontSize: 12 }} axisLine={{ stroke: t.grid }} tickLine={false} interval={0} />
        <YAxis domain={domain} tick={{ fill: t.ink2, fontSize: 12 }} axisLine={false} tickLine={false} unit={unit} />
        <Tooltip
          cursor={{ fill: t.grid, opacity: 0.35 }}
          contentStyle={{ background: t.tip, border: "none", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,.12)", color: t.ink, fontSize: 13 }}
          labelStyle={{ color: t.ink, fontWeight: 600 }}
          itemStyle={{ color: t.ink }}
          formatter={(v) => (typeof v === "number" ? `${v.toFixed(digits)}${unit}` : String(v))}
        />
        {refY !== undefined && (
          <ReferenceLine y={refY} stroke={t.ink2} strokeWidth={1}
            label={refLabel ? { value: refLabel, position: "insideTopRight", fill: t.ink2, fontSize: 11 } : undefined} />
        )}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={colors[i]} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {s.err && <ErrorBar dataKey={s.err} width={4} strokeWidth={1.5} stroke={t.ink} direction="y" isAnimationActive={false} />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

const real = (lo: number | null | undefined, hi: number | null | undefined, ref = 0) => lo != null && hi != null && (lo > ref || hi < ref);
const pct0 = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

function gapTakeaway(rows: PointRow[], reference: string): string {
  const rs = rows.filter((r) => r.condition !== reference && r.gap_correct?.gap != null);
  const lower = rs.filter((r) => real(r.gap_correct!.lo, r.gap_correct!.hi) && r.gap_correct!.gap! < 0).sort((a, b) => a.gap_correct!.gap! - b.gap_correct!.gap!);
  const higher = rs.filter((r) => real(r.gap_correct!.lo, r.gap_correct!.hi) && r.gap_correct!.gap! > 0);
  if (!lower.length && !higher.length) return "Correct answers score about the same in every version — no real difference from Urdu script.";
  const parts = lower.map((r) => `${label(r.condition)} loses ${Math.abs(r.gap_correct!.gap!).toFixed(2)} points`);
  const up = higher.map((r) => `${label(r.condition)} gains ${r.gap_correct!.gap!.toFixed(2)}`);
  return `For the same correct answer, ${[...parts, ...up].join(", ")} compared with Urdu script — real differences, not luck.`;
}

export function GapChart({ rows, reference }: { rows: PointRow[]; reference: string }) {
  const t = useTheme();
  const data = rows.filter((r) => r.condition !== reference).map((r) => ({
    name: label(r.condition),
    correct: r.gap_correct?.gap ?? null, correctErr: ciErr(r.gap_correct?.gap ?? null, r.gap_correct?.lo ?? null, r.gap_correct?.hi ?? null),
    wrong: r.gap_wrong?.gap ?? null, wrongErr: ciErr(r.gap_wrong?.gap ?? null, r.gap_wrong?.lo ?? null, r.gap_wrong?.hi ?? null),
  }));
  return (
    <Frame title="Score gap vs. Urdu script" sub="Mean score difference on the same items, 95% bootstrap CI. Below 0 = harsher than on Urdu script." takeaway={gapTakeaway(rows, reference)}
      legend={[{ name: "Correct answers", color: t.s1 }, { name: "Wrong answers", color: t.s2 }]}>
      <Bars data={data} refY={0} series={[{ key: "correct", name: "Correct answers", err: "correctErr" }, { key: "wrong", name: "Wrong answers", err: "wrongErr" }]} />
    </Frame>
  );
}

export function AucChart({ rows, threshold }: { rows: PointRow[]; threshold?: number }) {
  const data = rows.map((r) => ({ name: label(r.condition), auc: r.auc }));
  return (
    <Frame title="Error detection (AUC)" sub={`How well scores separate correct from wrong answers. 0.5 = chance${threshold ? `; screening needs > ${threshold}` : ""}.`}
      takeaway={(() => { const rs = rows.filter((r) => r.auc != null).sort((a, b) => b.auc! - a.auc!); if (rs.length < 2) return null;
        return `Best at telling right from wrong in ${label(rs[0].condition)} (${rs[0].auc!.toFixed(2)}), weakest in ${label(rs[rs.length - 1].condition)} (${rs[rs.length - 1].auc!.toFixed(2)}). 0.5 would be guessing, 1.0 perfect.`; })()}>
      <Bars data={data} domain={[0, 1]} refY={0.5} refLabel="chance" series={[{ key: "auc", name: "AUC" }]} />
    </Frame>
  );
}

export function AcceptanceChart({ rows, threshold }: { rows: PointRow[]; threshold: number }) {
  const t = useTheme();
  const data = rows.map((r) => ({
    name: label(r.condition),
    correct: r.accept_correct === null ? null : r.accept_correct * 100,
    wrong: r.accept_wrong === null ? null : r.accept_wrong * 100,
  }));
  return (
    <Frame title="Acceptance rate" sub={`Share of answers scored ${threshold} or higher. Wrong answers should rarely be accepted.`}
      takeaway={(() => { const ref = rows.find((r) => r.condition === "urdu_script"); const worst = [...rows].filter((r) => r.accept_wrong != null).sort((a, b) => b.accept_wrong! - a.accept_wrong!)[0];
        if (!ref || !worst) return null; return worst.condition === "urdu_script" ? `Wrong answers are let through most in Urdu script (${pct0(ref.accept_wrong)}).`
          : `Wrong answers get a good score ${pct0(worst.accept_wrong)} of the time in ${label(worst.condition)}, vs ${pct0(ref.accept_wrong)} in Urdu script — mistakes slip through more.`; })()}
      legend={[{ name: "Correct answers", color: t.s1 }, { name: "Wrong answers", color: t.s2 }]}>
      <Bars data={data} domain={[0, 100]} unit="%" digits={1} series={[{ key: "correct", name: "Correct answers" }, { key: "wrong", name: "Wrong answers" }]} />
    </Frame>
  );
}

export function WinRateChart({ rows }: { rows: PairRow[] }) {
  const data = rows.map((r) => ({
    name: label(r.condition),
    win: r.win_rate === null ? null : r.win_rate * 100,
    err: ciErr(r.win_rate, r.lo, r.hi, 100),
  }));
  return (
    <Frame title="Pairwise win rate vs. Urdu script" sub="Same answer, both orders; ties count half. 50% = no preference."
      takeaway={(() => { const parts = rows.filter((r) => r.win_rate != null).map((r) => real(r.lo, r.hi, 0.5)
          ? (r.win_rate! < 0.5 ? `prefers Urdu script over ${label(r.condition)} (picks ${label(r.condition)} only ${pct0(r.win_rate)})` : `prefers ${label(r.condition)} (${pct0(r.win_rate)})`)
          : `treats ${label(r.condition)} and Urdu script equally (${pct0(r.win_rate)})`);
        return parts.length ? `Shown the same answer twice, this judge ${parts.join("; ")}.` : null; })()}>
      <Bars data={data} domain={[0, 100]} unit="%" digits={1} refY={50} refLabel="fair" series={[{ key: "win", name: "Win rate", err: "err" }]} />
    </Frame>
  );
}

export function AccuracyChart({ rows }: { rows: CompRow[] }) {
  const data = rows.map((r) => ({ name: label(r.condition), acc: r.accuracy === null ? null : r.accuracy * 100 }));
  return (
    <Frame title="Comprehension accuracy" sub="The judge answers the multiple-choice question itself. 25% = chance."
      takeaway={(() => { const a = Object.fromEntries(rows.map((r) => [r.condition, r.accuracy])); if (a.urdu_script == null) return null;
        const best = [...rows].filter((r) => r.accuracy != null).sort((x, y) => y.accuracy! - x.accuracy!)[0];
        return `It answers ${pct0(a.urdu_script)} correctly in Urdu script${a.roman_translit != null ? ` but ${pct0(a.roman_translit)} in Roman Urdu` : ""}; best in ${label(best.condition)} (${pct0(best.accuracy)}). Lower accuracy means it understands that version less.`; })()}>
      <Bars data={data} domain={[0, 100]} unit="%" digits={1} refY={25} refLabel="chance" series={[{ key: "acc", name: "Accuracy" }]} />
    </Frame>
  );
}
