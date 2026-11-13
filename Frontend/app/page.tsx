"use client";
import Link from "next/link";
import { InsightsView } from "../components/Insights";
import { TestYourself } from "../components/TestYourself";
import { ErrorNote, Header } from "../components/ui";
import { useApi, type Insights } from "../lib/api";

export default function HomePage() {
  const { data, error } = useApi<Insights>("/insights", 15000);
  return (
    <>
      <Header eyebrow="Script-bias audit" title="Is the AI judge fair to Roman Urdu?"
        lede="The same answer, shown to LLM judges in Urdu script, Roman Urdu, English and code-mixed Urdu. If the score changes, the judge is grading the script, not the answer." />
      <div className="tile crux" style={{ marginBottom: 24 }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>What we found</p>
        <p className="crux-text">AI judges are <b>not</b> fair to Roman Urdu: the same correct answer gets <b>0.6–1.3 points lower</b> (out of 10) in Roman Urdu or English-mixed text, mistakes slip through more often, and <b>bigger, smarter models do not fix it</b>. Converting the text to Urdu script first is the best fix we found.</p>
        <Link href="/findings" className="btn secondary small">Read the full findings →</Link>
      </div>
      <h2 className="section" style={{ marginTop: 0 }}>Latest numbers</h2>
      {data ? <InsightsView data={data} /> : error ? <ErrorNote error={error} /> : <p className="muted">Loading…</p>}
      <div style={{ marginTop: 24 }}><TestYourself /></div>
    </>
  );
}
