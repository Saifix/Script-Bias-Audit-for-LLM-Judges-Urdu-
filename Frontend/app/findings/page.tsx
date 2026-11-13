import Link from "next/link";
import { Glossary } from "../../components/Glossary";
import { Header } from "../../components/ui";

// Final results of the four rounds (13 Nov 2026). Numbers are taken from the experiment runs shown on the Results page.
const FINDINGS = [
  { big: "−0.6 to −1.3", unit: "points out of 10", title: "Roman Urdu answers get lower marks",
    text: "Every reliable AI judge gave the same correct answer a lower score when it was written in Roman Urdu or mixed with English — at every model size, from all three companies. English got the highest marks." },
  { big: "Still lower", unit: "even when understood", title: "It is not only a reading problem",
    text: "Even on questions the AI answered correctly in both scripts — so it clearly understood them — it still marked the Roman Urdu answer 0.6 to 1.4 points lower. The judge is reacting to how the text looks, not just to what it means." },
  { big: "No", unit: "bigger is not fairer", title: "Smarter AI does not fix it",
    text: "Larger models are much better judges overall — they catch more mistakes and are more consistent — but the Roman Urdu penalty did not shrink. The panel of the largest models had the biggest penalty of all (−0.92)." },
  { big: "~15", unit: "points less understanding", title: "AI understands Roman Urdu less well",
    text: "When the judges answered the questions themselves, most were about 15 percentage points less accurate in Roman Urdu than in Urdu script. Gemini 2.5 Flash came closest to closing this gap." },
  { big: "Up to 57%", unit: "wrong answers passed", title: "Mistakes slip through more",
    text: "Wrong answers written in Roman Urdu were more often given a good score — for example 57% vs 34% for Llama 3.3 70B. People writing Roman Urdu get less reliable feedback." },
  { big: "Best fix", unit: "convert to Urdu script first", title: "Converting the script helps most",
    text: "Turning Roman Urdu into Urdu script before the AI judges it removed most of the gap for small and medium models (but only part of it for the largest). Telling the AI to “ignore spelling” did not work — it just made it more lenient." },
];

const TREND = [
  { family: "Qwen (Alibaba)", small: -0.81, medium: -0.82, large: -1.26 },
  { family: "Google", small: -0.59, medium: -0.92, large: -0.78 },
  { family: "Llama (Meta)", small: -0.12, medium: -0.55, large: -0.71, note: "small model failed screening" },
];

const REASONS = [
  { title: "1 · Judges prefer what looks familiar",
    text: "AI judges tend to reward text that looks like what they were trained on most — clean English and standard Urdu script. Roman Urdu is informal, rarely found in carefully edited text, and so looks “less proper” to the model.",
    ours: "Our evidence: the order is always English > Urdu script > Roman Urdu, and the penalty stays even when the judge clearly understood the question.",
    source: { label: "Wataoka et al., “Self-Preference Bias in LLM-as-a-Judge” (2024): LLM judges give higher scores to text that is more familiar to them (lower perplexity).", url: "https://arxiv.org/abs/2410.21819" } },
  { title: "2 · Roman Urdu has no standard spelling",
    text: "The same Urdu word can be written many ways in Latin letters (one study found up to 20 spellings for a single word). The model sees each spelling rarely, so it learns Roman Urdu poorly.",
    ours: "Our evidence: converting Roman Urdu to Urdu script — one standard spelling — removed most of the penalty, even though the meaning did not change.",
    source: { label: "“A Clustering Framework for Lexical Normalization of Roman Urdu” (arXiv 2004.00088): Roman Urdu words with as many as 20 spelling variants.", url: "https://arxiv.org/abs/2004.00088" } },
  { title: "3 · Low-resource languages are judged less reliably",
    text: "Multilingual AI judges are known to be less consistent and less accurate in languages with little training data, and making the model bigger does not automatically fix this.",
    ours: "Our evidence: judges understood Roman Urdu about 15 points worse, and the penalty did not shrink from small to large models.",
    source: { label: "Fu & Liu, “How Reliable is Multilingual LLM-as-a-Judge?” (Findings of EMNLP 2025): weak cross-language consistency; scale and multilingual training do not fix it.", url: "https://arxiv.org/abs/2505.12201" } },
  { title: "4 · It is the script, not the language mix",
    text: "Adding English words did not help: the code-mixed version (Roman Urdu with English nouns) was penalised as much as plain Roman Urdu, sometimes more.",
    ours: "Our evidence: code-mixed penalty −0.59 to −1.30, similar to Roman Urdu; head-to-head picks were just as low.",
    source: null },
];

const GUIDELINES = [
  ["Test your AI judge before you trust it", "Show it the same answer in Urdu script, Roman Urdu and English. If the scores differ, the judge is grading the script, not the answer. This platform does exactly that."],
  ["Convert Roman Urdu to Urdu script before judging", "It was the most effective fix we found and also restored the judge’s ability to catch wrong answers."],
  ["Do not rely on “ignore spelling” instructions", "They made judges more lenient — more wrong answers got good scores — instead of fairer."],
  ["Do not assume a bigger model or a panel fixes it", "Bigger models were better judges overall but just as biased in scoring; a panel averages the same bias."],
  ["Report results per script", "Always show how a system does on Roman Urdu and code-mixed text separately, not only on Urdu script or English."],
  ["Keep a human in the loop for Roman Urdu", "Spot-check automated scores for Roman Urdu content, especially when decisions affect people (grading, moderation, hiring)."],
  ["Choose judges by measured fairness", "Fairness differed by model family: Gemini 2.5 Flash and Llama 4 Maverick were fair in head-to-head comparisons; the Qwen models were not."],
];

export default function FindingsPage() {
  return (
    <>
      <Header eyebrow="Findings" title="What we found, in plain words"
        lede="We gave AI judges the exact same answers written four ways — Urdu script, Roman Urdu, English and Urdu–English mixed — and checked whether their verdict changed. It did." />

      <div className="tile crux">
        <p className="eyebrow" style={{ marginBottom: 6 }}>The short answer</p>
        <p className="crux-text">AI judges are <b>not</b> fair to Roman Urdu. They give the same correct answer lower marks when it is written in Latin letters, they let more mistakes through, and bigger, smarter models do not fix this. Converting the text to Urdu script first is the best fix we found.</p>
        <p className="faint" style={{ margin: 0 }}>Based on 300 reading-comprehension questions, 9 AI judges from 3 companies at 3 sizes, about 120,000 judgements, repeated twice for the small models.</p>
      </div>

      <h2 className="section">Key findings</h2>
      <div className="grid cols-3">
        {FINDINGS.map((f) => (
          <div key={f.title} className="tile insight">
            <span className="k">{f.title}</span>
            <span className="v">{f.big} <small>{f.unit}</small></span>
            <span className="d">{f.text}</span>
          </div>
        ))}
      </div>

      <h2 className="section">Does a smarter AI treat Roman Urdu more fairly?</h2>
      <div className="tile">
        <p className="muted" style={{ marginTop: 0 }}>Points lost by the same correct answer when written in Roman Urdu instead of Urdu script. Longer bar = bigger penalty. A fair judge would have no bar.</p>
        <div className="stack" style={{ gap: 18 }}>
          {TREND.map((t) => (
            <div key={t.family}>
              <b>{t.family}</b>{t.note && <span className="faint"> · {t.note}</span>}
              <div className="bars" style={{ marginTop: 8 }}>
                {(["small", "medium", "large"] as const).map((s) => (
                  <div key={s} className="bar-row">
                    <span>{s === "small" ? "Small (8–12B)" : s === "medium" ? "Medium (27–70B)" : "Large"}</span>
                    <div className="track"><div className="fillbar" style={{ width: `${Math.min(100, (Math.abs(t[s]) / 1.4) * 100)}%` }} /></div>
                    <b>{t[s].toFixed(2)}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>None of the three companies’ penalties shrink as models get bigger. See <Link href="/trends">Trends</Link> for all measures.</p>
      </div>

      <h2 className="section">Why does this happen?</h2>
      <p className="muted" style={{ marginTop: -6, maxWidth: 820 }}>These are the most likely explanations, combining published research with what our own data shows. They are well supported, but not proven cause-and-effect.</p>
      <div className="grid cols-2">
        {REASONS.map((r) => (
          <div key={r.title} className="tile">
            <h3>{r.title}</h3>
            <p className="muted" style={{ margin: "6px 0 10px" }}>{r.text}</p>
            <p style={{ margin: "0 0 10px", fontSize: 14 }}>{r.ours}</p>
            {r.source && <p className="faint" style={{ margin: 0 }}>Research: <a href={r.source.url} target="_blank" rel="noreferrer">{r.source.label}</a></p>}
          </div>
        ))}
      </div>

      <h2 className="section">Why it matters</h2>
      <div className="grid cols-3">
        <div className="tile"><h3>For people</h3><p className="muted" style={{ margin: 0 }}>Many Urdu speakers type Roman Urdu online. When AI grades answers, ranks replies or moderates content, their writing is quietly marked down — and their mistakes are caught less often.</p></div>
        <div className="tile"><h3>For AI systems</h3><p className="muted" style={{ margin: 0 }}>Chatbots are often trained using AI judges. A judge that prefers English and Urdu script teaches chatbots to avoid the way most Urdu speakers actually write.</p></div>
        <div className="tile"><h3>For research</h3><p className="muted" style={{ margin: 0 }}>Leaderboards and studies that use AI judges for South Asian languages may be measuring script, not quality. The same test applies to Hindi/Hinglish, Arabic/Arabizi and other two-script languages.</p></div>
      </div>

      <h2 className="section">Guidelines for others</h2>
      <div className="tile">
        <ol className="guides">
          {GUIDELINES.map(([t, d]) => <li key={t}><b>{t}.</b> <span className="muted">{d}</span></li>)}
        </ol>
      </div>

      <h2 className="section">How we tested it</h2>
      <div className="grid cols-4">
        <div className="tile"><p className="eyebrow">Step 1</p><h3>Same content</h3><p className="muted" style={{ margin: 0 }}>300 questions from the Belebele benchmark, each in four versions with identical meaning.</p></div>
        <div className="tile"><p className="eyebrow">Step 2</p><h3>Ask the judges</h3><p className="muted" style={{ margin: 0 }}>Score answers 1–10, compare two versions side by side, and answer the question themselves.</p></div>
        <div className="tile"><p className="eyebrow">Step 3</p><h3>Compare versions</h3><p className="muted" style={{ margin: 0 }}>Any difference between versions is bias, because only the script changed. Statistics separate real differences from luck.</p></div>
        <div className="tile"><p className="eyebrow">Step 4</p><h3>Try fixes</h3><p className="muted" style={{ margin: 0 }}>A “ignore spelling” instruction, converting to Urdu script first, and averaging several judges.</p></div>
      </div>

      <div style={{ marginTop: 24 }}><Glossary /></div>
      <p className="faint" style={{ marginTop: 16 }}>Limits: one dataset; Roman Urdu and code-mixed answers were written by Claude Opus 5.5 without human review; single questions are noisy, so only the 300-question averages should be quoted.</p>
    </>
  );
}
