"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, ErrorNote } from "./ui";
import { api, fmt, label, RTL, useApi, type AppConfig } from "../lib/api";

type Texts = Record<string, { passage: string; question: string; options?: string[]; answers: Record<string, string>; status: string }>;
type Result = {
  kind: "pointwise" | "pairwise" | "comprehension"; judge: string; condition: string; answer?: string; order?: string;
  raw?: string; error?: string; score?: number | null; label?: string | null; winner?: string | null;
  choice?: number | null; correct?: boolean | null; cached?: boolean;
};
type Fact = {
  name: string; scores: Record<string, Record<string, number>>; picked_right_option: Record<string, boolean>;
  pairwise: Record<string, string[]>; score_changes: { answer: string; version: string; change: number }[];
  option_pick_changes: boolean; prefers: string[]; verdict: string;
};
type Demo = {
  facts: Record<string, Fact>; summary: { text: string; name: string } | null;
  item: { id: string; pos: number; correct_idx: number; wrong_idx: number } | null;
  conditions: string[]; texts: Texts; judges: string[]; results: Result[]; cost_usd: number; calls: number; cached: number;
};
type Sample = { id: string; pos: number; total: number; question: string };
type Mode = "type" | "voice" | "dataset";

const CONDS = ["urdu_script", "roman_translit", "english", "code_mixed"] as const;
const NAME: Record<string, string> = { urdu_script: "Urdu script", roman_translit: "Roman Urdu", english: "English", code_mixed: "Code-mixed" };
type Fields = Record<string, { passage: string; question: string; answer: string }>;
const EMPTY: Fields = Object.fromEntries(CONDS.map((c) => [c, { passage: "", question: "", answer: "" }]));
const EXAMPLE: Fields = {
  urdu_script: { passage: "علی نے بازار سے دو کلو سیب خریدے کیونکہ اس کی امی نے کیک بنانا تھا۔", question: "علی نے بازار سے کیا خریدا؟", answer: "دو کلو سیب" },
  roman_translit: { passage: "Ali ne bazaar se do kilo seb khareede kyunke us ki ammi ne cake banana tha.", question: "Ali ne bazaar se kya khareeda?", answer: "do kilo seb" },
  english: { passage: "Ali bought two kilos of apples from the market because his mother was going to bake a cake.", question: "What did Ali buy from the market?", answer: "two kilos of apples" },
  code_mixed: { passage: "Ali ne market se do kilo apples khareede kyunke us ki mother ne cake banana tha.", question: "Ali ne market se kya khareeda?", answer: "do kilo apples" },
};
const nameOf = (c: string, custom: boolean) => (custom ? NAME[c] ?? label(c) : label(c));

const Icon = {
  type: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>,
  voice: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></svg>,
  dataset: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>,
};

export function TestYourself() {
  const cfg = useApi<AppConfig>("/config");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("type");
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [sample, setSample] = useState<Sample | null>(null);
  const [pos, setPos] = useState(1);
  const [judges, setJudges] = useState<string[]>([]);
  const [opts, setOpts] = useState({ scores: true, pairwise: true, mcq: true, rubric: false });
  const [demo, setDemo] = useState<Demo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const linkedQ = useRef(0);

  useEffect(() => { if (cfg.data && judges.length === 0) setJudges(cfg.data.judges); }, [cfg.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(p?: number) {
    try {
      const s = await api<Sample>(`/items/sample${p ? `?pos=${p}` : ""}`);
      setSample(s); setPos(s.pos + 1); setDemo(null); setErr(null);
    } catch (e) { setErr((e as Error).message === "no items loaded" ? "No questions loaded yet — load the dataset on the Data page." : (e as Error).message); }
  }
  useEffect(() => { if (mode === "dataset" && !sample && !linkedQ.current) pick(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // deep link: /?test=1&q=12 opens "From the dataset" with question 12 loaded
    const p = new URLSearchParams(window.location.search);
    if (!p.get("test")) return;
    setOpen(true);
    const q = Number(p.get("q"));
    if (q > 0) { linkedQ.current = q; setMode("dataset"); pick(q); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true); setErr(null);
    try {
      const body = { judges, ...opts, ...(mode === "dataset" ? { item_id: sample?.id } : { custom: fields }) };
      setDemo(await api<Demo>("/playground", body));
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const filled = CONDS.some((c) => fields[c].passage && fields[c].question && fields[c].answer);
  const canRun = judges.length > 0 && !busy && (mode === "dataset" ? !!sample : filled);

  if (!open) {
    return (
      <div className="tile cta">
        <div>
          <h2 className="section" style={{ margin: "0 0 6px" }}>Test it yourself</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>Type a question, say it out loud, or pull one from the dataset — then see how each judge scores the same answer in Urdu script, Roman Urdu, English and code-mixed text.</p>
        </div>
        <button className="btn large" onClick={() => setOpen(true)}>Test yourself</button>
      </div>
    );
  }

  return (
    <div className="stack expand" style={{ gap: 20 }}>
      <div className="tile">
        <div className="stack">
          <div className="row between">
            <h2 className="section" style={{ margin: 0 }}>Test it yourself</h2>
            <button className="btn secondary small" onClick={() => setOpen(false)}>Close</button>
          </div>
          <div className="mode-cards" role="tablist">
            {([["type", "Type it", "Fill in the fields yourself"], ["voice", "Say it", "Record a voice note"], ["dataset", "From the dataset", "Use a Belebele question"]] as const).map(([m, t, d]) => (
              <button key={m} role="tab" aria-selected={mode === m} className={`mode-card ${mode === m ? "on" : ""}`} onClick={() => { setMode(m); setDemo(null); }}>
                <span className="ic">{Icon[m]}</span><span><b>{t}</b><span>{d}</span></span>
              </button>
            ))}
          </div>

          {mode === "voice" && <VoiceNote onFields={(f, transcript) => { setFields(f); setNote(transcript); setMode("type"); }} />}

          {mode === "type" && (
            <>
              {note && <p className="notice">Filled from your voice note: “{note}”. Check the fields, then run.</p>}
              <div className="row between">
                <span className="faint">Fill any scripts you want to compare. Urdu script is the reference for pairwise picks.</span>
                <div className="row">
                  <button className="btn secondary small" onClick={() => { setFields(EXAMPLE); setNote(null); }}>Load example</button>
                  <button className="btn secondary small" onClick={() => { setFields(EMPTY); setNote(null); }}>Clear</button>
                </div>
              </div>
              <div className="cond-grid">
                {CONDS.map((c) => {
                  const rtl = RTL.has(c);
                  const set = (k: "passage" | "question" | "answer", v: string) => setFields({ ...fields, [c]: { ...fields[c], [k]: v } });
                  return (
                    <div key={c} className="cond-cell stack" style={{ gap: 8 }}>
                      <span className="eyebrow" style={{ margin: 0 }}>{NAME[c]}</span>
                      <textarea className={`input ${rtl ? "urdu" : ""}`} dir={rtl ? "rtl" : "ltr"} rows={4} placeholder="Passage" value={fields[c].passage} onChange={(e) => set("passage", e.target.value)} />
                      <input className={`input ${rtl ? "urdu" : ""}`} dir={rtl ? "rtl" : "ltr"} placeholder="Question" value={fields[c].question} onChange={(e) => set("question", e.target.value)} />
                      <input className={`input ${rtl ? "urdu" : ""}`} dir={rtl ? "rtl" : "ltr"} placeholder="Answer" value={fields[c].answer} onChange={(e) => set("answer", e.target.value)} />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {mode === "dataset" && (
            <div className="row">
              <label className="field">Question #
                <input className="input" type="number" min={1} max={sample?.total} style={{ width: 110 }} value={pos}
                  onChange={(e) => setPos(Number(e.target.value))} onKeyDown={(e) => e.key === "Enter" && pick(pos)} />
              </label>
              <button className="btn secondary small" style={{ alignSelf: "flex-end" }} onClick={() => pick(pos)}>Load</button>
              <button className="btn secondary small" style={{ alignSelf: "flex-end" }} onClick={() => pick()}>Random</button>
              {sample && <span className="muted" style={{ alignSelf: "flex-end", flex: 1, minWidth: 220 }}>“{sample.question}”</span>}
            </div>
          )}

          {mode !== "voice" && (
            <>
              <div>
                <p className="eyebrow">Judges</p>
                <div className="row">
                  {cfg.data?.judges.map((j) => (
                    <button key={j} className={`chip ${judges.includes(j) ? "on" : ""}`} onClick={() => setJudges(judges.includes(j) ? judges.filter((x) => x !== j) : [...judges, j])}>
                      <span className="mono">{j}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="row">
                {([["scores", "Scores 1–10"], ["pairwise", "Pairwise picks"], ["mcq", "Multiple-choice picks"], ["rubric", "Rubric: ignore script"]] as const).map(([k, l]) => (
                  <button key={k} className={`chip ${opts[k] ? "on" : ""}`} disabled={k === "mcq" && mode !== "dataset"} onClick={() => setOpts({ ...opts, [k]: !opts[k] })}>{l}</button>
                ))}
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={run} disabled={!canRun}>{busy ? "Asking the judges…" : "Run test"}</button>
              </div>
            </>
          )}
          <ErrorNote error={err} />
        </div>
      </div>

      {demo && (
        <div className="stack" ref={resultsRef} style={{ gap: 20, scrollMarginTop: 90 }}>
          <Errors demo={demo} />
          <PlainWords summary={demo.summary} />
          <JudgeCards demo={demo} />
          <details className="more">
            <summary>Show full details — what the judges saw, every table and every raw reply</summary>
            <div className="stack" style={{ gap: 20, marginTop: 16 }}>
              <HowToRead />
              <TextsPanel demo={demo} />
              {demo.results.some((r) => r.kind === "pointwise") && <ScoresPanel demo={demo} />}
              {demo.results.some((r) => r.kind === "pairwise") && <PairwisePanel demo={demo} />}
              {demo.results.some((r) => r.kind === "comprehension") && <McqPanel demo={demo} />}
              <RawPanel demo={demo} />
            </div>
          </details>
          <p className="faint" style={{ margin: 0 }}>{demo.calls} replies · {demo.cached} reused from earlier runs</p>
        </div>
      )}
    </div>
  );
}

/** Record a voice note in the browser, send it to the backend (Whisper via OpenRouter), get filled fields back. */
function VoiceNote({ onFields }: { onFields: (f: Fields, transcript: string) => void }) {
  const [state, setState] = useState<"idle" | "rec" | "sending">("idle");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const LIMIT = 90;

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (state === "rec" && secs >= LIMIT) stop(); }, [secs, state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr("This browser cannot record audio."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); send(new Blob(chunks, { type: r.mimeType }), r.mimeType); };
      r.start();
      rec.current = r;
      setSecs(0); setState("rec");
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch { setErr("Microphone permission was denied."); }
  }
  function stop() {
    if (timer.current) clearInterval(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
  }
  async function send(blob: Blob, mime: string) {
    setState("sending");
    const format = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
    try {
      const audio = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      const out = await api<{ transcript: string; fields: Fields }>("/voice", { audio, format });
      onFields(out.fields, out.transcript);
    } catch (e) { setErr((e as Error).message); setState("idle"); }
  }

  return (
    <div className="voice-wrap">
      <button className={`mic ${state === "rec" ? "rec" : ""}`} onClick={state === "rec" ? stop : start} disabled={state === "sending"} aria-label={state === "rec" ? "Stop recording" : "Start recording"}>
        {state === "rec"
          ? <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          : <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></svg>}
      </button>
      {state === "idle" && <p className="muted" style={{ margin: 0, maxWidth: 520 }}>Tap and say a short passage, a question about it, and the answer — in Urdu, Roman Urdu or English. We transcribe it with Whisper and fill the fields in all four scripts for you to check.</p>}
      {state === "rec" && <><span className="timer">0:{String(secs).padStart(2, "0")}</span><span className="faint">Recording — tap to stop (max {LIMIT}s)</span></>}
      {state === "sending" && <span className="muted">Listening and filling the fields…</span>}
      <ErrorNote error={err} />
    </div>
  );
}

const SHORT: Record<string, string> = { urdu_script: "Urdu", roman_translit: "Roman", english: "English", code_mixed: "Mixed", roman_belebele: "Roman (B)" };

export function PlainWords({ summary }: { summary: { text: string; name: string } | null }) {
  if (!summary) return null;
  return (
    <div className="tile plain">
      <p className="eyebrow">In plain words</p>
      <p className="plain-text">{summary.text}</p>
      <p className="faint" style={{ margin: 0 }}>Written by {summary.name} from the numbers below. It only reads the numbers — the judges&apos; replies are scored by plain code.</p>
    </div>
  );
}

/** One simple card per judge: a verdict, its scores per version, its option picks and its pairwise behaviour. */
function JudgeCards({ demo }: { demo: Demo }) {
  const custom = demo.item === null;
  const versions = demo.conditions;
  return (
    <div className="grid cols-3">
      {demo.judges.map((j) => {
        const f = demo.facts?.[j];
        if (!f) return null;
        const same = f.verdict === "same across scripts";
        const answers = Object.keys(f.scores).sort((a, b) => (a === "correct" ? -1 : b === "correct" ? 1 : 0));
        const pair = Object.entries(f.pairwise).map(([c, vs]) => {
          const p = vs.every((v) => v === "tie") ? "fair" : vs.some((v) => v.startsWith("prefers")) ? vs.find((v) => v.startsWith("prefers"))! : "depends on order";
          const pretty = p.startsWith("prefers ") ? `prefers ${nameOf(p.slice(8), custom)}` : p;
          return `${nameOf(c, custom)}: ${pretty}`;
        });
        return (
          <div key={j} className="tile judge-card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{f.name}</h3>
              <Badge kind={same ? "pass" : "warn"}>{same ? "Same across scripts" : "Changes with script"}</Badge>
            </div>
            <table className="mini">
              <thead><tr><th></th>{versions.map((c) => <th key={c} className="num">{custom ? NAME[c] ?? SHORT[c] : SHORT[c]}</th>)}</tr></thead>
              <tbody>
                {answers.map((a) => {
                  const ref = f.scores[a]?.urdu_script;
                  return (
                    <tr key={a}>
                      <td>{a === "answer" ? "Score" : a === "correct" ? "Right answer" : "Wrong answer"}</td>
                      {versions.map((c) => {
                        const v = f.scores[a]?.[c];
                        const d = v != null && ref != null && c !== "urdu_script" ? v - ref : 0;
                        return <td key={c} className={`num ${Math.abs(d) >= 2 ? "changed" : ""}`}>{v ?? "–"}{Math.abs(d) >= 2 && <small> {d > 0 ? "↑" : "↓"}{Math.abs(d)}</small>}</td>;
                      })}
                    </tr>
                  );
                })}
                {Object.keys(f.picked_right_option).length > 0 && (
                  <tr>
                    <td>Picked right option</td>
                    {versions.map((c) => <td key={c} className="num">{f.picked_right_option[c] == null ? "–" : f.picked_right_option[c] ? "✓" : <span className="changed">✕</span>}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
            {pair.length > 0 && <p className="faint" style={{ margin: "12px 0 0" }}><b>Same answer in two scripts</b> — {pair.join(" · ")}</p>}
          </div>
        );
      })}
    </div>
  );
}

function HowToRead() {
  const steps: [string, string, string][] = [
    ["1", "The judge (an LLM)", "Reads the passage, question and answer in one version and replies with plain text: a score like “8”, a pick like “A”, “B” or “TIE”, or an option number."],
    ["2", "The platform — plain code, no AI", "Reads each reply with fixed rules (“Score: 8/10” → 8, “I would reply A” → A). No second LLM interprets anything, so no extra bias is added. Replies it cannot read are marked unparseable, never guessed."],
    ["3", "The comparison", "Holds the content fixed and compares versions: a fair judge gives the same score, says TIE in pairwise, and picks the same option in every script."],
    ["4", "Statistics, then the researchers", "Across all 300 questions the platform's statistics code averages the differences with 95% confidence intervals; the researchers interpret those numbers. One question is an illustration, not evidence."],
  ];
  return (
    <div className="tile flat">
      <p className="chart-title">How to read these results</p>
      <div className="grid cols-4" style={{ marginTop: 12 }}>
        {steps.map(([n, who, what]) => (
          <div key={n} className="stack" style={{ gap: 4 }}>
            <span className="eyebrow" style={{ margin: 0 }}>Step {n}</span>
            <b>{who}</b>
            <span className="muted" style={{ fontSize: 14 }}>{what}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const KIND_NAME: Record<string, string> = { pointwise: "Score", pairwise: "Pairwise pick", comprehension: "Multiple choice" };

/** Every judge reply exactly as received, next to what the platform read from it. */
function RawPanel({ demo }: { demo: Demo }) {
  const custom = demo.item === null;
  const read = (r: Result) => r.error ? "error" : r.kind === "pointwise" ? (r.score ?? "unparseable")
    : r.kind === "pairwise" ? (r.winner == null ? "unparseable" : r.winner === "tie" ? "Tie" : `picked ${nameOf(r.winner, custom)}`)
    : r.choice == null ? "unparseable" : `option ${r.choice} (${r.correct ? "right" : "wrong"})`;
  const shown = (r: Result) => r.kind !== "pairwise" ? "" : r.order === "AB" ? `${nameOf(r.condition, custom)} shown as A` : `${nameOf(r.condition, custom)} shown as B`;
  return (
    <details className="tile">
      <summary className="chart-title" style={{ color: "var(--ink)", marginTop: 0 }}>Raw replies from the judges ({demo.results.length})</summary>
      <p className="chart-sub" style={{ marginTop: 8 }}>Exactly what each model replied, and what the platform read from it. Judges are asked to reply very briefly, so long replies are cut off.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Judge</th><th>Test</th><th>Version</th><th>Answer</th><th>Order</th><th>Reply (raw)</th><th>Read as</th></tr></thead>
          <tbody>
            {demo.results.map((r, i) => (
              <tr key={i}>
                <td className="mono">{r.judge}</td>
                <td>{KIND_NAME[r.kind]}</td>
                <td>{nameOf(r.condition, custom)}</td>
                <td>{r.answer && r.answer !== "answer" ? r.answer : ""}</td>
                <td className="faint">{shown(r)}</td>
                <td className="mono" style={{ whiteSpace: "pre-wrap", maxWidth: 280 }}>{r.error ? r.error.slice(0, 80) : JSON.stringify(r.raw ?? "")}</td>
                <td><b>{String(read(r))}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Errors({ demo }: { demo: Demo }) {
  const errors = demo.results.filter((r) => r.error);
  if (!errors.length) return null;
  return (
    <p className="notice error">
      {errors.length} of {demo.calls} calls failed ({[...new Set(errors.map((e) => e.judge))].join(", ")}):{" "}
      {errors.some((e) => e.error?.includes("402")) ? "OpenRouter has run out of credits." : errors[0].error?.slice(0, 180)}
    </p>
  );
}

function TextsPanel({ demo }: { demo: Demo }) {
  const custom = demo.item === null;
  return (
    <div className="tile">
      <p className="chart-title">What the judges saw</p>
      <div className="cond-grid" style={{ marginTop: 12 }}>
        {demo.conditions.map((c) => {
          const t = demo.texts[c]; const rtl = RTL.has(c);
          return (
            <div key={c} className="cond-cell">
              <div className="row between"><span className="eyebrow" style={{ margin: 0 }}>{nameOf(c, custom)}</span>{t.status === "pending" && <Badge kind="warn">unreviewed</Badge>}</div>
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

function ScoresPanel({ demo }: { demo: Demo }) {
  const custom = demo.item === null;
  const answers = custom ? ["answer"] : ["correct", "wrong"];
  const get = (j: string, c: string, a: string) => demo.results.find((r) => r.kind === "pointwise" && r.judge === j && r.condition === c && r.answer === a);
  return (
    <div className="tile">
      <p className="chart-title">Scores (1–10)</p>
      <p className="chart-sub">Same answer in each script. The change vs. Urdu script is in brackets — a fair judge shows no change.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Judge</th>{!custom && <th>Answer</th>}{demo.conditions.map((c) => <th key={c} className="num">{nameOf(c, custom)}</th>)}</tr></thead>
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

function PairwisePanel({ demo }: { demo: Demo }) {
  const custom = demo.item === null;
  const answers = custom ? ["answer"] : ["correct", "wrong"];
  const others = demo.conditions.filter((c) => c !== "urdu_script");
  const pickText = (r: Result | undefined) => !r ? "–" : r.error ? "error" : r.winner == null ? "unparseable" : r.winner === "tie" ? "Tie" : nameOf(r.winner, custom);
  return (
    <div className="tile">
      <p className="chart-title">Pairwise picks vs. Urdu script</p>
      <p className="chart-sub">The same answer shown in two scripts, in both orders. A fair judge says TIE; always picking one script is bias.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Judge</th>{!custom && <th>Answer</th>}<th>Comparison</th><th>Shown first</th><th>Shown second</th><th>Verdict</th></tr></thead>
          <tbody>
            {demo.judges.flatMap((j) => answers.flatMap((a) => others.map((c) => {
              const ab = demo.results.find((r) => r.kind === "pairwise" && r.judge === j && r.condition === c && r.answer === a && r.order === "AB");
              const ba = demo.results.find((r) => r.kind === "pairwise" && r.judge === j && r.condition === c && r.answer === a && r.order === "BA");
              const wins = [ab, ba].map((r) => r?.winner);
              const verdict = wins.every((w) => w === c) ? <Badge kind="warn">prefers {nameOf(c, custom)}</Badge>
                : wins.every((w) => w === "urdu_script") ? <Badge kind="warn">prefers Urdu script</Badge>
                : wins.every((w) => w === "tie") ? <Badge kind="pass">fair (tie)</Badge>
                : <Badge kind="untested">follows position</Badge>;
              return (
                <tr key={j + a + c}>
                  <td className="mono">{j}</td>
                  {!custom && <td><Badge kind={a}>{a}</Badge></td>}
                  <td>{nameOf(c, custom)} vs. Urdu script</td>
                  <td title={ab?.raw}>{pickText(ab)}</td>
                  <td title={ba?.raw}>{pickText(ba)}</td>
                  <td>{verdict}</td>
                </tr>
              );
            })))}
          </tbody>
        </table>
      </div>
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
