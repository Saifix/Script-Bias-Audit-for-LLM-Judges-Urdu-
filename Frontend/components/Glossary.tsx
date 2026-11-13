/** Plain-language meaning of every number on the dashboard — no maths needed. */
const TERMS: [string, string][] = [
  ["Score gap", "How many points (out of 10) the same correct answer gains or loses just because it is written in another script. 0 means fair; −1 means it loses a full point."],
  ["Head-to-head (win rate)", "The judge sees the same answer twice — once in Urdu script, once in another version — and picks the better one. A fair judge picks each about half the time (50%)."],
  ["Understanding (accuracy)", "The judge answers the question itself. It shows whether the AI actually understands text written in that script."],
  ["Catching wrong answers (AUC)", "How well the scores separate right answers from wrong ones. 0.5 is a coin flip, 1.0 is perfect."],
  ["Wrong answers let through", "The share of wrong answers that still get a good score (7 or more). Lower is better."],
  ["Consistency", "Ask the same question again: how often does the judge give exactly the same score?"],
  ["Real difference / 95% range", "We re-sampled the questions 1,000 times. If the range of results never crosses 0 (or 50%), the difference is not luck — we call it a real difference."],
  ["Panel", "The average score of all judges in a round, treated as one judge."],
];

export function Glossary({ open = false }: { open?: boolean }) {
  return (
    <details className="tile flat glossary" open={open}>
      <summary><b>How to read these numbers</b> <span className="faint">— what each metric means</span></summary>
      <dl>
        {TERMS.map(([t, d]) => (
          <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
        ))}
      </dl>
    </details>
  );
}
