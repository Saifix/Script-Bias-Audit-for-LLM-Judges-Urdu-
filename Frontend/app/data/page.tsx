"use client";
import { useState } from "react";
import { ErrorNote, Header } from "../../components/ui";
import { label, RTL, useApi } from "../../lib/api";

type View = { passage: string; question: string; options: string[]; status: string } | null;
type Item = { id: string; pos: number; correct_idx: number; wrong_idx: number; link: string; views: Record<string, View> };

const VERSIONS = ["urdu_script", "roman_translit", "english", "code_mixed"] as const;
const SOURCE: Record<string, string> = {
  urdu_script: "Belebele",
  roman_translit: "Question: Belebele · answers: Claude Opus 5.5",
  english: "Belebele",
  code_mixed: "Question: Belebele · answers: Claude Opus 5.5",
};
const PAGE = 10;

function Question({ it }: { it: Item }) {
  return (
    <div className="tile">
      <div className="row between" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>Question {it.pos + 1}</h3>
        <a className="faint" href={it.link} target="_blank" rel="noreferrer">Original article</a>
      </div>
      <div className="table-wrap">
        <table className="qtable">
          <thead>
            <tr><th>Version</th><th>Question</th>{[1, 2, 3, 4].map((n) => <th key={n}>Answer {n}</th>)}</tr>
          </thead>
          <tbody>
            {VERSIONS.map((c) => {
              const v = it.views[c];
              const rtl = RTL.has(c);
              const cls = rtl ? "urdu" : "";
              return (
                <tr key={c}>
                  <td><b>{label(c)}</b><div className="faint">{SOURCE[c]}</div></td>
                  {v ? (
                    <>
                      <td className={cls} dir={rtl ? "rtl" : "ltr"}>{v.question}</td>
                      {v.options.map((o, i) => (
                        <td key={i} className={`${cls} ${i === it.correct_idx ? "is-answer" : ""}`} dir={rtl ? "rtl" : "ltr"}>
                          {o}{i === it.correct_idx && <span className="tick" title="Correct answer"> ✓</span>}
                        </td>
                      ))}
                    </>
                  ) : <td colSpan={5} className="faint">Not available</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Show the passage in all four versions</summary>
        <div className="cond-grid" style={{ marginTop: 12 }}>
          {VERSIONS.map((c) => {
            const v = it.views[c];
            const rtl = RTL.has(c);
            return (
              <div key={c} className="cond-cell">
                <span className="eyebrow" style={{ margin: 0 }}>{label(c)}</span>
                <p className={rtl ? "urdu" : ""} dir={rtl ? "rtl" : "ltr"} style={{ margin: "6px 0 0" }}>{v?.passage ?? "–"}</p>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

export default function DataPage() {
  const [offset, setOffset] = useState(0);
  const [jump, setJump] = useState("");
  const items = useApi<{ total: number; items: Item[] }>(`/items?offset=${offset}&limit=${PAGE}`);
  const total = items.data?.total ?? 0;

  return (
    <>
      <Header eyebrow="Data" title="The questions"
        lede="300 reading-comprehension questions. Each one exists in four versions — Urdu script, Roman Urdu, English and code-mixed — with the same four answer options. The correct answer is marked ✓." />

      <div className="tile flat" style={{ marginBottom: 20 }}>
        <div className="row" style={{ gap: 28, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 300px" }}>
            <b>Where each version comes from</b>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Urdu script and English: the Belebele benchmark. Roman Urdu and code-mixed: the passage and question are
              Belebele&apos;s Roman Urdu text; the four answers were written by Claude Opus 5.5 (high effort) — a faithful
              word-by-word transliteration, and a version with some nouns switched to English.
            </p>
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <b>How the experiment uses it</b>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              A judge sees the passage, the question and one answer — all in the same version — and scores it.
              Comparing the scores across versions shows whether the script changes the judge&apos;s verdict.
            </p>
          </div>
        </div>
      </div>

      <ErrorNote error={items.error} />
      {items.data && total === 0 && <div className="tile"><p className="muted" style={{ margin: 0 }}>No questions loaded yet.</p></div>}

      {total > 0 && (
        <div className="row between" style={{ marginBottom: 16 }}>
          <span className="faint">Questions {offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <div className="row">
            <input className="input" style={{ width: 120 }} placeholder="Go to #" value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && jump) setOffset(Math.min(Math.max(0, Number(jump) - 1), total - 1)); }} />
            <button className="btn secondary small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <button className="btn secondary small" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 20 }}>
        {items.data?.items.map((it) => <Question key={it.id} it={it} />)}
      </div>
    </>
  );
}
