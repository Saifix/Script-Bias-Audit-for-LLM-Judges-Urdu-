"use client";
import { useState } from "react";
import { Badge, Segmented } from "./ui";
import { label, type Finding } from "../lib/api";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const pts = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

function Cell({ f, version }: { f?: Finding; version: string }) {
  if (!f) return <td className="faint">–</td>;
  const v = label(version);
  let yes = false, text = "";
  if (f.kind === "score_gap") { yes = f.real && f.value < 0; text = f.real ? (f.value < 0 ? `Yes, ${pts(f.value)} points` : `Scored higher, ${pts(f.value)}`) : `No clear difference (${pts(f.value)})`; }
  if (f.kind === "preference") { yes = f.real && f.value < 0.5; text = f.real ? (f.value < 0.5 ? `Yes — picks ${v} only ${pct(f.value)}` : `Prefers ${v} (${pct(f.value)})`) : `No preference (${pct(f.value)})`; }
  if (f.kind === "comprehension") { yes = f.real && f.value < (f.ref ?? 0); text = f.real ? `${yes ? "Yes" : "Understands it better"}, ${pct(f.value)} vs ${pct(f.ref ?? 0)}` : `No clear difference (${pct(f.value)} vs ${pct(f.ref ?? 0)})`; }
  if (f.kind === "accept_wrong") { yes = f.real && f.value > (f.ref ?? 0); text = f.real ? `${yes ? "Yes" : "Fewer"}, ${pct(f.value)} vs ${pct(f.ref ?? 0)}` : `No clear difference (${pct(f.value)} vs ${pct(f.ref ?? 0)})`; }
  return <td><Badge kind={yes ? "warn" : f.real ? "untested" : "pass"}>{yes ? "biased" : f.real ? "differs" : "fair"}</Badge><div style={{ marginTop: 4 }}>{text}</div></td>;
}

/** Plain-language scorecard: four yes/no questions per judge, decided by code from 95% confidence intervals. */
export function Scorecard({ findings }: { findings: Finding[] }) {
  const versions = [...new Set(findings.map((f) => f.version))];
  const [version, setVersion] = useState(versions.includes("roman_translit") ? "roman_translit" : versions[0]);
  const judges = [...new Map(findings.map((f) => [f.judge, f])).values()];
  if (!findings.length) return null;
  const find = (j: string, kind: Finding["kind"]) => findings.find((f) => f.judge === j && f.kind === kind && f.version === version);
  const cols: [Finding["kind"], string][] = [
    ["score_gap", "Scores the right answer lower?"],
    ["preference", "Prefers the Urdu-script version?"],
    ["comprehension", "Understands it less?"],
    ["accept_wrong", "Lets wrong answers through more?"],
  ];
  const present = cols.filter(([k]) => findings.some((f) => f.kind === k));
  return (
    <div className="tile">
      <div className="row between" style={{ marginBottom: 6 }}>
        <p className="chart-title" style={{ margin: 0 }}>Scorecard — is {label(version)} treated like Urdu script?</p>
        <Segmented value={version} onChange={setVersion} options={versions.map((v) => ({ value: v, label: label(v) }))} />
      </div>
      <p className="chart-sub">“Biased” means a real difference against {label(version)} (95% confidence, decided by code). “Fair” means no clear difference.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Judge</th>{present.map(([k, t]) => <th key={k}>{t}</th>)}</tr></thead>
          <tbody>
            {judges.map((j) => (
              <tr key={j.judge}>
                <td><b>{j.name}</b>{j.flagged && <div className="faint">failed screening — unreliable</div>}</td>
                {present.map(([k]) => <Cell key={k} f={find(j.judge, k)} version={version} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
