"use client";
import { useEffect, useState } from "react";
import { Badge, ErrorNote, Header, Segmented } from "../../components/ui";
import { api, fmt, label, RTL, useApi, type AppConfig, type Overview } from "../../lib/api";

type Texts = Record<string, { passage: string; question: string; options?: string[]; answers: Record<string, string>; status: string }>;
type Result = {
  kind: "pointwise" | "pairwise" | "comprehension"; judge: string; condition: string; answer?: string; order?: string;
  raw?: string; error?: string; score?: number | null; label?: string | null; winner?: string | null;
  choice?: number | null; correct?: boolean | null; cached?: boolean;
};
type Demo = {
  item: { id: string; pos: number; correct_idx: number; wrong_idx: number } | null;
  conditions: string[]; texts: Texts; judges: string[]; results: Result[]; cost_usd: number; calls: number; cached: number;
};

const CUSTOM_CONDS = ["urdu_script", "roman_translit", "english", "code_mixed"] as const;
const CUSTOM_LABEL: Record<string, string> = { urdu_script: "Urdu script", roman_translit: "Roman Urdu", english: "English", code_mixed: "Code-mixed" };
type Custom = Record<string, { passage: string; question: string; answer: string }>;
const EMPTY: Custom = Object.fromEntries(CUSTOM_CONDS.map((c) => [c, { passage: "", question: "", answer: "" }]));
const EXAMPLE: Custom = {
  urdu_script: { passage: "علی نے بازار سے دو کلو سیب خریدے کیونکہ اس کی امی نے کیک بنانا تھا۔", question: "علی نے بازار سے کیا خریدا؟", answer: "دو کلو سیب" },
  roman_translit: { passage: "Ali ne bazaar se do kilo seb khareede kyunke us ki ammi ne cake banana tha.", question: "Ali ne bazaar se kya khareeda?", answer: "do kilo seb" },
  english: { passage: "Ali bought two kilos of apples from the market because his mother was going to bake a cake.", question: "What did Ali buy from the market?", answer: "two kilos of apples" },
  code_mixed: { passage: "Ali ne market se do kilo apples khareede kyunke us ki mother ne cake banana tha.", question: "Ali ne market se kya khareeda?", answer: "do kilo apples" },
};
const condLabel = (c: string, custom: boolean) => (custom ? CUSTOM_LABEL[c] ?? label(c) : label(c));

export default function DemoPage() {
  const cfg = useApi<AppConfig>("/config");
  const ov = useApi<Overview>("/overview");
  const [source, setSource] = useState<"sample" | "custom">("sample");
  const [pos, setPos] = useState<number>(1);
  const [sample, setSample] = useState<{ id: string; pos: number; total: number; question: string } | null>(null);
  const [custom, setCustom] = useState<Custom>(EMPTY);
  const [judges, setJudges] = useState<string[]>([]);
  const [opts, setOpts] = useState({ scores: true, pairwise: true, mcq: true, rubric: false });
  const [demo, setDemo] = useState<Demo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (cfg.data && judges.length === 0) setJudges(cfg.data.judges.slice(0, 2)); }, [cfg.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasItems = (ov.data?.dataset.items ?? 0) > 0;

  async function pick(p?: number) {
    try {
      const s = await api<{ id: string; pos: number; total: number; question: string }>(`/items/sample${p ? `?pos=${p}` : ""}`);
      setSample(s); setPos(s.pos + 1); setDemo(null);
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { if (hasItems && !sample) pick(1); }, [hasItems]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true); setErr(null);
    try {
      const body = { judges, ...opts, ...(source === "sample" ? { item_id: sample?.id } : { custom }) };
      setDemo(await api<Demo>("/playground", body));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const isCustom = demo ? demo.item === null : source === "custom";
  const errors = demo?.results.filter((r) => r.error) ?? [];
  const toggle = (j: string) => setJudges(judges.includes(j) ? judges.filter((x) => x !== j) : [...judges, j]);

  return (
    <>
      <Header eyebrow="Live demo" title={<>Same answer, <span className="gradient-text">different script</span></>}
        lede="Pick a Belebele question or write your own, then watch each judge score, compare and answer it in Urdu script, Roman Urdu, English and code-mixed text." />

      <div className="tile">
        <div className="stack">
          <Segmented value={source} onChange={(v) => { setSource(v); setDemo(null); }}
            options={[{ value: "sample", label: "Sample question" }, { value: "custom", label: "Write your own" }]} />

          {source === "sample" ? (
            hasItems ? (
              <div className="row">
                <label className="field">Item #
                  <input className="input" type="number" min={1} max={sample?.total} style={{ width: 100 }} value={pos}
                    onChange={(e) => setPos(Number(e.target.value))} onKeyDown={(e) => e.key === "Enter" && pick(pos)} />
                </label>
                <button className="btn secondary small" style={{ alignSelf: "flex-end" }} onClick={() => pick(pos)}>Load</button>
                <button className="btn secondary small" style={{ alignSelf: "flex-end" }} onClick={() => pick()}>Random</button>
                {sample && <span className="muted" style={{ alignSelf: "flex-end", flex: 1, minWidth: 200 }}>“{sample.question}”</span>}
              </div>
            ) : <p className="muted" style={{ margin: 0 }}>No items loaded yet — load Belebele on the Data page, or write your own question.</p>
          ) : (
            <>
              <div className="row between">
                <span className="faint">Fill any scripts you want to compare (Urdu script is the reference for pairwise picks).</span>
                <div className="row">
                  <button className="btn secondary small" onClick={() => setCustom(EXAMPLE)}>Load example</button>
                  <button className="btn secondary small" onClick={() => setCustom(EMPTY)}>Clear</button>
                </div>
              </div>
              <div className="cond-grid">
                {CUSTOM_CONDS.map((c) => {
                  const rtl = RTL.has(c);
                  const set = (k: "passage" | "question" | "answer", v: string) => setCustom({ ...custom, [c]: { ...custom[c], [k]: v } });
                  return (
                    <div key={c} className="cond-cell stack" style={{ gap: 8 }}>
                      <span className="eyebrow" style={{ margin: 0 }}>{CUSTOM_LABEL[c]}</span>
                      <textarea className={`input ${rtl ? "urdu" : ""}`} dir={rtl ? "rtl" : "ltr"} rows={4} placeholder="Passage" value={custom[c].passage} onChange={(e) => set("passage", e.target.value)} />
                      <input className={`input ${rtl ? "urdu" : ""}`} dir={rtl ? "rtl" : "ltr"} placeholder="Question" value={custom[c].question} onChange={(e) => set("question", e.target.value)} />
                      <input className={`input ${rtl ? "urdu" : ""}`} dir={rtl ? "rtl" : "ltr"} placeholder="Answer" value={custom[c].answer} onChange={(e) => set("answer", e.target.value)} />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div>
            <p className="eyebrow">Judges</p>
            <div className="row">
              {cfg.data?.judges.map((j) => (
                <button key={j} className={`chip ${judges.includes(j) ? "on" : ""}`} onClick={() => toggle(j)}><span className="mono">{j}</span></button>
              ))}
            </div>
          </div>
          <div className="row">
            {([["scores", "Scores 1–10"], ["pairwise", "Pairwise picks"], ["mcq", "Multiple-choice picks"], ["rubric", "Rubric: ignore script"]] as const).map(([k, l]) => (
              <button key={k} className={`chip ${opts[k] ? "on" : ""}`} disabled={k === "mcq" && source === "custom"} onClick={() => setOpts({ ...opts, [k]: !opts[k] })}>{l}</button>
            ))}
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={run} disabled={busy || judges.length === 0 || (source === "sample" && !sample)}>{busy ? "Asking the judges…" : "Run demo"}</button>
          </div>
          <ErrorNote error={err} />
        </div>
      </div>

      {demo && (
        <div className="stack" style={{ gap: 24, marginTop: 24 }}>
          <p className="faint" style={{ margin: 0 }}>{demo.calls} calls · {demo.cached} from cache · {fmt.usd(demo.cost_usd)}</p>
          {errors.length > 0 && (
            <p className="notice error">
              {errors.length} of {demo.calls} calls failed ({[...new Set(errors.map((e) => e.judge))].join(", ")}):{" "}
              {errors.some((e) => e.error?.includes("402"))
                ? <>OpenRouter has no credits left. Add credits at <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">openrouter.ai/settings/credits</a>, or use <span className="mono">mock/judge</span>.</>
                : errors[0].error?.slice(0, 180)}
            </p>
          )}

          <TextsPanel demo={demo} custom={isCustom} />
          {demo.results.some((r) => r.kind === "pointwise") && <ScoresPanel demo={demo} custom={isCustom} />}
          {demo.results.some((r) => r.kind === "pairwise") && <PairwisePanel demo={demo} custom={isCustom} />}
          {demo.results.some((r) => r.kind === "comprehension") && <McqPanel demo={demo} />}
        </div>
      )}
    </>
  );
}

function TextsPanel({ demo, custom }: { demo: Demo; custom: boolean }) {
  return (
    <div className="tile tight">
      <p className="chart-title">What the judges saw</p>
      <div className="cond-grid" style={{ marginTop: 12 }}>
        {demo.conditions.map((c) => {
          const t = demo.texts[c]; const rtl = RTL.has(c);
          return (
            <div key={c} className="cond-cell">
              <div className="row between"><span className="eyebrow" style={{ margin: 0 }}>{condLabel(c, custom)}</span>{t.status === "pending" && <Badge kind="warn">unreviewed</Badge>}</div>
              <p className={rtl ? "urdu" : ""} dir={rtl ? "rtl" : "ltr"} style={{ margin: "8px 0" }}>{t.question}</p>
              {Object.entries(t.answers).map(([k, a]) => (
                <div key={k} className="row" style={{ gap: 8, alignItems: "flex-start", marginBottom: 4 }}>
                  {k !== "answer" && <Badge kind={k}>{k}</Badge>}<span className={rtl ? "urdu" : ""} dir={rtl ? "rtl" : "ltr"}>{a}</span>
                </div>
              ))}
              <details><summary>Passage</summary><p className={rtl ? "urdu" : ""} dir={rtl ? "rtl" : "ltr"}>{t.passage}</p></details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoresPanel({ demo, custom }: { demo: Demo; custom: boolean }) {
  const answers = custom ? ["answer"] : ["correct", "wrong"];
  const get = (j: string, c: string, a: string) => demo.results.find((r) => r.kind === "pointwise" && r.judge === j && r.condition === c && r.answer === a);
  return (
    <div className="tile">
      <p className="chart-title">Scores (1–10)</p>
      <p className="chart-sub">Same answer in each script. The change vs. Urdu script is in brackets — a fair judge shows no change.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Judge</th>{!custom && <th>Answer</th>}{demo.conditions.map((c) => <th key={c} className="num">{condLabel(c, custom)}</th>)}</tr></thead>
          <tbody>
            {demo.judges.flatMap((j) => answers.map((a, i) => {
              const ref = get(j, "urdu_script", a)?.score;
              return (
                <tr key={j + a}>
                  <td className="mono">{i === 0 ? j : ""}</td>
                  {!custom && <td><Badge kind={a}>{a}</Badge></td>}
                  {demo.conditions.map((c) => {
                    const r = get(j, c, a);
                    const d = r?.score != null && ref != null && c !== "urdu_script" ? r.score - ref : null;
                    return (
                      <td key={c} className="num" title={r?.raw ?? r?.error ?? ""}>
                        {r?.error ? <span className="faint">error</span> : r?.score == null ? <span className="faint">unparseable</span> : <strong>{r.score}</strong>}
                        {d !== null && d !== 0 && <span className="faint"> ({d > 0 ? "+" : "−"}{Math.abs(d)})</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PairwisePanel({ demo, custom }: { demo: Demo; custom: boolean }) {
  const answers = custom ? ["answer"] : ["correct", "wrong"];
  const others = demo.conditions.filter((c) => c !== "urdu_script");
  const pickText = (r: Result | undefined) => !r ? "–" : r.error ? "error" : r.winner == null ? "unparseable" : r.winner === "tie" ? "Tie" : condLabel(r.winner, custom);
  return (
    <div className="tile">
      <p className="chart-title">Pairwise picks vs. Urdu script</p>
      <p className="chart-sub">The same answer shown twice, in two scripts and in both orders. A fair judge says TIE; a consistent preference for one script is bias.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Judge</th>{!custom && <th>Answer</th>}<th>Comparison</th><th>Shown first</th><th>Shown second</th><th>Verdict</th></tr></thead>
          <tbody>
            {demo.judges.flatMap((j) => answers.flatMap((a) => others.map((c) => {
              const ab = demo.results.find((r) => r.kind === "pairwise" && r.judge === j && r.condition === c && r.answer === a && r.order === "AB");
              const ba = demo.results.find((r) => r.kind === "pairwise" && r.judge === j && r.condition === c && r.answer === a && r.order === "BA");
              const wins = [ab, ba].map((r) => r?.winner);
              const verdict = wins.every((w) => w === c) ? <Badge kind="warn">prefers {condLabel(c, custom)}</Badge>
                : wins.every((w) => w === "urdu_script") ? <Badge kind="warn">prefers Urdu script</Badge>
                : wins.every((w) => w === "tie") ? <Badge kind="pass">fair (tie)</Badge>
                : <Badge kind="untested">follows position</Badge>;
              return (
                <tr key={j + a + c}>
                  <td className="mono">{j}</td>
                  {!custom && <td><Badge kind={a}>{a}</Badge></td>}
                  <td>{condLabel(c, custom)} vs. Urdu script</td>
                  <td title={ab?.raw}>{pickText(ab)}</td>
                  <td title={ba?.raw}>{pickText(ba)}</td>
                  <td>{verdict}</td>
                </tr>
              );
            })))}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ marginBottom: 0 }}>“Shown first” = the condition was answer A; “Shown second” = it was answer B. Each cell is the script the judge picked.</p>
    </div>
  );
}

function McqPanel({ demo }: { demo: Demo }) {
  return (
    <div className="tile">
      <p className="chart-title">Multiple-choice picks</p>
      <p className="chart-sub">The judge answers the question itself. Different picks across scripts mean the script changed its understanding.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Judge</th>{demo.conditions.map((c) => <th key={c}>{label(c)}</th>)}</tr></thead>
          <tbody>
            {demo.judges.map((j) => (
              <tr key={j}>
                <td className="mono">{j}</td>
                {demo.conditions.map((c) => {
                  const r = demo.results.find((x) => x.kind === "comprehension" && x.judge === j && x.condition === c);
                  const opt = r?.choice ? demo.texts[c].options?.[r.choice - 1] : null;
                  return (
                    <td key={c} title={r?.raw ?? r?.error ?? ""}>
                      {!r ? "–" : r.error ? <span className="faint">error</span> : r.choice == null ? <span className="faint">unparseable</span> : (
                        <div className="stack" style={{ gap: 4 }}>
                          <span><strong>Option {r.choice}</strong> <Badge kind={r.correct ? "correct" : "wrong"}>{r.correct ? "right" : "wrong"}</Badge></span>
                          {opt && <span className={`faint ${RTL.has(c) ? "urdu" : ""}`} dir={RTL.has(c) ? "rtl" : "ltr"}>{opt}</span>}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {demo.item && <p className="faint" style={{ marginBottom: 0 }}>Correct answer: option {demo.item.correct_idx + 1}.</p>}
    </div>
  );
}
