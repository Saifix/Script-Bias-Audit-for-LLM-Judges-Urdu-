"use client";
import type { AppConfig } from "../lib/api";

/** Judge chips grouped by model tier (small / medium / large), showing friendly names. */
export function JudgePicker({ cfg, value, onChange, badge }: {
  cfg: AppConfig; value: string[]; onChange: (v: string[]) => void; badge?: (id: string) => string | null;
}) {
  const metas = cfg.judges.map((j) => cfg.judge_meta?.[j] ?? { id: j, name: j, family: "", tier: 1, tier_name: "Judges" });
  const tiers = [...new Set(metas.map((m) => m.tier))].sort();
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {tiers.map((t) => {
        const group = metas.filter((m) => m.tier === t);
        const allOn = group.every((m) => value.includes(m.id));
        return (
          <div key={t} className="row" style={{ alignItems: "center" }}>
            <button className="btn secondary small" style={{ minWidth: 150 }} title="Select or clear this tier"
              onClick={() => onChange(allOn ? value.filter((v) => !group.some((m) => m.id === v)) : [...new Set([...value, ...group.map((m) => m.id)])])}>
              {group[0].tier_name}
            </button>
            {group.map((m) => (
              <button key={m.id} className={`chip ${value.includes(m.id) ? "on" : ""}`} onClick={() => toggle(m.id)} title={`${m.id} · ${m.family}`}>
                {m.name}{badge?.(m.id) ? <span style={{ opacity: 0.75 }}> · {badge(m.id)}</span> : null}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export const smallJudges = (cfg: AppConfig) => cfg.judges.filter((j) => (cfg.judge_meta?.[j]?.tier ?? 1) === 1);
export const judgeName = (cfg: AppConfig | null | undefined, id: string) => cfg?.judge_meta?.[id]?.name ?? cfg?.judge_names?.[id] ?? id;
