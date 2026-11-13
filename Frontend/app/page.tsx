"use client";
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
      {data ? <InsightsView data={data} /> : error ? <ErrorNote error={error} /> : <p className="muted">Loading…</p>}
      <div style={{ marginTop: 24 }}><TestYourself /></div>
    </>
  );
}
