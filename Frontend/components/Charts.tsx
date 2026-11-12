"use client";
// Small bar charts (Recharts). Colors are validated for CVD separation and contrast on both surfaces.
import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { label, type CompRow, type PairRow, type PointRow } from "../lib/api";

const LIGHT = { s1: "#7B61FF", s2: "#1BA39C", ink: "#1D1D1F", ink2: "#6E6E73", grid: "#D2D2D7", tip: "#FFFFFF" };
const DARK = { s1: "#8A72FF", s2: "#1BA39C", ink: "#F5F5F7", ink2: "#A1A1A6", grid: "#38383A", tip: "#2C2C2E" };

function useTheme() {
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

function Frame({ title, sub, children, legend }: { title: string; sub: string; children: ReactNode; legend?: { name: string; color: string }[] }) {
  return (
    <div className="tile">
      <p className="chart-title">{title}</p>
      <p className="chart-sub">{sub}</p>
      {legend && legend.length > 1 && (
        <div className="legend">{legend.map((l) => <span key={l.name} style={{ ["--c" as string]: l.color }}>{l.name}</span>)}</div>
      )}
      <div style={{ width: "100%", height: 240 }}>{children}</div>
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

export function GapChart({ rows, reference }: { rows: PointRow[]; reference: string }) {
  const t = useTheme();
  const data = rows.filter((r) => r.condition !== reference).map((r) => ({
    name: label(r.condition),
    correct: r.gap_correct?.gap ?? null, correctErr: ciErr(r.gap_correct?.gap ?? null, r.gap_correct?.lo ?? null, r.gap_correct?.hi ?? null),
    wrong: r.gap_wrong?.gap ?? null, wrongErr: ciErr(r.gap_wrong?.gap ?? null, r.gap_wrong?.lo ?? null, r.gap_wrong?.hi ?? null),
  }));
  return (
    <Frame title="Score gap vs. Urdu script" sub="Mean score difference on the same items, 95% bootstrap CI. Below 0 = harsher than on Urdu script."
      legend={[{ name: "Correct answers", color: t.s1 }, { name: "Wrong answers", color: t.s2 }]}>
      <Bars data={data} refY={0} series={[{ key: "correct", name: "Correct answers", err: "correctErr" }, { key: "wrong", name: "Wrong answers", err: "wrongErr" }]} />
    </Frame>
  );
}

export function AucChart({ rows, threshold }: { rows: PointRow[]; threshold?: number }) {
  const data = rows.map((r) => ({ name: label(r.condition), auc: r.auc }));
  return (
    <Frame title="Error detection (AUC)" sub={`How well scores separate correct from wrong answers. 0.5 = chance${threshold ? `; screening needs > ${threshold}` : ""}.`}>
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
    <Frame title="Pairwise win rate vs. Urdu script" sub="Same answer, both orders; ties count half. 50% = no preference.">
      <Bars data={data} domain={[0, 100]} unit="%" digits={1} refY={50} refLabel="fair" series={[{ key: "win", name: "Win rate", err: "err" }]} />
    </Frame>
  );
}

export function AccuracyChart({ rows }: { rows: CompRow[] }) {
  const data = rows.map((r) => ({ name: label(r.condition), acc: r.accuracy === null ? null : r.accuracy * 100 }));
  return (
    <Frame title="Comprehension accuracy" sub="The judge answers the multiple-choice question itself. 25% = chance.">
      <Bars data={data} domain={[0, 100]} unit="%" digits={1} refY={25} refLabel="chance" series={[{ key: "acc", name: "Accuracy" }]} />
    </Frame>
  );
}
