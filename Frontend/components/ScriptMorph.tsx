"use client";
import { useEffect, useState } from "react";

// One answer, four scripts. The scores are an illustration of what script bias looks like, not results.
const FRAMES = [
  { key: "Urdu script", text: "دو کلو سیب", urdu: true, score: 9 },
  { key: "Roman Urdu", text: "do kilo seb", urdu: false, score: 6 },
  { key: "English", text: "two kilos of apples", urdu: false, score: 9 },
  { key: "Code-mixed", text: "do kilo apples", urdu: false, score: 7 },
];

export function ScriptMorph() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="morph glass" aria-label="The same answer written in four scripts">
      <p className="morph-q">“What did Ali buy from the market?” — the same answer, four ways</p>
      <div className="morph-stage">
        {FRAMES.map((f, k) => (
          <span key={f.key} className={`morph-word ${f.urdu ? "urdu" : ""} ${k === i ? "on" : ""}`} lang={f.urdu ? "ur" : undefined} dir={f.urdu ? "rtl" : "ltr"} aria-hidden={k !== i}>
            {f.text}
          </span>
        ))}
      </div>
      <div className="morph-scripts">
        {FRAMES.map((f, k) => <span key={f.key} className={k === i ? "on" : ""}>{f.key}</span>)}
      </div>
      <div className="morph-scores">
        {FRAMES.map((f, k) => (
          <div key={f.key} className={`morph-score ${k === i ? "on" : ""}`}><b>{f.score}</b><small>{f.key}</small></div>
        ))}
      </div>
      <p className="faint" style={{ margin: "12px 0 0" }}>Illustration: a biased judge scores identical content differently by script.</p>
    </div>
  );
}
