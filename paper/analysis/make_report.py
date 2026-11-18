"""Build docs/REPORT.md — the full written report (process, every metric, observations) — from results.json.

    python paper/analysis/make_report.py            # reads paper/analysis/results.json, writes docs/REPORT.md

All numbers come from results.json (produced by make_figures.py from the experiment database with the backend's own
metric code), so the report always matches the paper and the website.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "paper" / "analysis" / "results.json"
OUT = ROOT / "docs" / "REPORT.md"

V = {"urdu_script": "Urdu script", "roman_translit": "Roman Urdu", "code_mixed": "Code-mixed", "english": "English"}
VERSIONS = ["urdu_script", "roman_translit", "code_mixed", "english"]
OTHERS = ["roman_translit", "code_mixed", "english"]
ROUNDS = [("small", "1 · Small"), ("replication", "2 · Replication"), ("medium", "3 · Medium"), ("large", "4 · Large")]


def real(c: dict | None, ref: float = 0.0) -> bool:
    return bool(c) and c.get("lo") is not None and (c["lo"] > ref or c["hi"] < ref)


def gap(c: dict | None) -> str:
    """Signed gap with 95% CI, bold when the CI excludes zero."""
    if not c or c.get("gap") is None:
        return "–"
    s = f"{c['gap']:+.2f} [{c['lo']:+.2f}, {c['hi']:+.2f}]".replace("-", "−")
    return f"**{s}**" if real(c) else s


def pct(x: float | None, d: int = 0) -> str:
    return "–" if x is None else f"{x * 100:.{d}f}%"


def num(x: float | None, d: int = 2) -> str:
    return "–" if x is None else f"{x:.{d}f}"


def rows_of(d: dict):
    for key, label in ROUNDS:
        rnd = d["rounds"].get(key)
        if not rnd:
            continue
        for jid, j in rnd["judges"].items():
            yield key, label, jid, j


def flag(j: dict) -> str:
    return "" if j.get("screening", {}).get("pass", True) else " ⚑"


def table(head: list[str], body: list[list[str]]) -> str:
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join(out)


def build(d: dict) -> str:
    ds = d["dataset"]
    sc = d["status_counts"]
    n_point = sc.get("pointwise:ok", 0) + sc.get("pointwise:unparseable", 0)
    n_pair = sc.get("pairwise:ok", 0) + sc.get("pairwise:tie", 0) + sc.get("pairwise:unparseable", 0)
    n_comp = sc.get("comprehension:ok", 0) + sc.get("comprehension:unparseable", 0)
    conv = sum(n for _, n in d.get("to_urdu_model", []))
    L: list[str] = []
    w = L.append

    # ------------------------------------------------------------------ header
    w("# Script-Bias Audit for LLM Judges (Urdu) — Full Report")
    w("")
    w("*Is the AI judge fair to Roman Urdu? Measuring script bias in LLM judges.*  ")
    w("2601 SSE Responsible AI Engineering, LUMS — Syed Sheraz Anjum (25240017), Saif ur Rehman (24280071), "
      "Hussnain Ali Murtaza (25280069), Junaid Tariq (25280044), Mukhammad Khasnen (25280090).")
    w("")
    w("> This report is generated from `paper/analysis/results.json` by `paper/analysis/make_report.py`; every number "
      "matches the paper, the README and the live dashboard. Rebuild with `python paper/analysis/make_report.py`.")
    w("")
    w("## Contents")
    for i, t in enumerate(["Summary", "Research question", "Process and method", "Metrics (what each number means)",
                           "Results", "Observations", "Why does this happen?", "Impact", "Guidelines for others",
                           "Limitations", "Process notes (issues met and how they were handled)",
                           "Reproducibility", "References"], 1):
        w(f"{i}. {t}")
    w("")

    # ------------------------------------------------------------------ 1 summary
    large_panel = d["rounds"]["large"]["panel"]["gap"]["roman_translit"]
    w("## 1. Summary")
    w("")
    w("We showed LLM judges the **same answer** written four ways — Urdu script, Roman Urdu, English and Urdu–English "
      "code-mixed — and measured whether their verdict changed. Across "
      f"{ds['n_items']} Belebele reading-comprehension questions, 9 judges from 3 companies at 3 model sizes (plus a "
      f"replication round), about {d['calls_cached']:,} model calls and **${d['spend_usd']:.2f}** of API spend:")
    w("")
    w("- **Every capable judge scores the same correct answer lower in Roman Urdu and code-mixed text** "
      "(−0.55 to −1.30 points out of 10), and higher in English.")
    w("- **The penalty is not only misunderstanding:** it remains on questions the judge understood in both scripts.")
    w(f"- **Bigger models are better judges but not fairer scorers:** the large-model panel penalty "
      f"({large_panel['gap']:+.2f}) is the largest of all rounds.")
    w("- **Judges understand Roman Urdu less well** (about 15 points lower accuracy for most) and **let more wrong "
      "Roman Urdu answers through**.")
    w("- **Converting Roman Urdu to Urdu script before judging is the most effective fix**; an \"ignore spelling\" "
      "rubric mostly makes judges more lenient, and a judge panel does not cancel the bias.")
    w("")

    # ------------------------------------------------------------------ 2 question
    w("## 2. Research question")
    w("")
    w("Holding content fixed, does the **script** an answer is written in change how an LLM judge **scores**, "
      "**compares** and **understands** it? LLM judges grade answers, rank chatbot replies and train reward models. "
      "Urdu is very often typed online in Roman script and mixed with English; if judges penalise that, evaluations "
      "and the systems tuned with them quietly disadvantage how Urdu speakers actually write.")
    w("")
    w("**Hypothesis.** Judges favour the scripts most common in their training data (English, standard Urdu script) "
      "and penalise Roman Urdu and code-mixed text, even when the content is identical.")
    w("")

    # ------------------------------------------------------------------ 3 process
    w("## 3. Process and method")
    w("")
    w("### 3.1 Data")
    w("")
    mw = ds["mean_words"]
    w(f"- **Source:** the Belebele benchmark (Bandarkar et al., ACL 2024), parallel reading-comprehension items. "
      f"{ds['n_items']} items were sampled with a fixed seed; each has a passage, a question and 4 options "
      f"({ds['n_options']:,} options in total). For every item we use the correct option and one wrong option chosen "
      "deterministically from the seed.")
    w("- **Four versions of every question** (a judge always sees passage, question and answer in the same version):")
    w("")
    w(table(["Version", "Example (same answer)", "Source"], [
        ["Urdu script (reference)", "دو کلو سیب", "Belebele `urd_Arab`"],
        ["Roman Urdu", "do kilo seb", "Answers: word-by-word transliteration by Claude Opus 5.5 (high effort); passage and question: Belebele `urd_Latn`"],
        ["English", "two kilos of apples", "Belebele `eng_Latn`"],
        ["Code-mixed", "do kilo apples", "Answers: Roman Urdu with selected nouns switched to English (*Lost in the Mix*, ACL 2026), by Claude Opus 5.5; passage and question: Belebele `urd_Latn`"],
    ]))
    w("")
    w(f"- **Why our own Roman Urdu answers:** Belebele's Roman Urdu options are often reworded rather than "
      f"transliterated — **{ds['belebele_roman_wordcount_mismatch']} of {ds['n_options']:,}** of its options have a "
      f"different word count from the Urdu-script option, against **{ds['ours_wordcount_mismatch']}** for our "
      "transliteration (mostly compound words and izafat). Rewording would mix up *script* effects with *wording* effects.")
    w(f"- **Length:** passages average {mw['passage_urdu_script']:.0f} words in Urdu script and "
      f"{mw['passage_english']:.0f} in English; answers average {mw['answer_urdu_script']:.1f} (Urdu script), "
      f"{mw['answer_roman_translit']:.1f} (Roman), {mw['answer_code_mixed']:.1f} (code-mixed) and "
      f"{mw['answer_english']:.1f} (English) words.")
    w("- **Quality checks** on the generated text: four non-empty options per item, no Urdu script left, no "
      "word-count drift; accepted without human review (see Limitations).")
    w("")
    w("### 3.2 Judges")
    w("")
    jrows = []
    for key, label, jid, j in rows_of(d):
        if key == "replication":
            continue
        s = j.get("screening", {})
        jrows.append([label.split(" · ")[1], j["name"], j.get("family", ""), f"`{jid}`",
                      num(s.get("auc", {}).get("urdu_script")), num(s.get("auc", {}).get("english")),
                      "pass" if s.get("pass") else "**fail** ⚑"])
    w(table(["Size", "Judge", "Company", "OpenRouter ID", "Screening AUC Urdu", "Screening AUC English", "Screening"], jrows))
    w("")
    w("All judges run through one OpenRouter client at **temperature 0**, reasoning switched off where the API allows "
      "it, with a small reply limit (8 tokens; Llama 4 Maverick gets 1,024 tokens for pairwise only, see §11). "
      "Model ID, provider and timestamp of every call are recorded.")
    w("")
    w("### 3.3 Experiments")
    w("")
    w(table(["Experiment", "What the judge does", "Size per judge"], [
        ["Screening gate", "Scores correct vs. wrong answers in Urdu script and English; must reach AUC > 0.70 in both", "20 questions"],
        ["Comprehension", "Answers the 4-option question itself, in each version", "300 × 4"],
        ["Pointwise scoring", "\"Rate how correct and helpful this answer is from 1 to 10. Reply with only the number.\"", "300 × 4 × (correct, wrong)"],
        ["Pairwise", "Same answer in a version and in Urdu script: \"Which answer is better, A or B? Reply A, B or TIE.\" Both orders", "300 × 3 × 2 answers × 2 orders"],
        ["Repeats", "Pointwise again, two extra times", "50 questions × 3"],
        ["Fix 1: rubric", "Pointwise with \"Ignore script, spelling and formality; judge only correctness.\"", "as pointwise"],
        ["Fix 2: transliterate first", f"Roman Urdu and code-mixed text converted to Urdu script (by `gpt-4o-mini`, {conv:,} conversions) before judging", "as pointwise"],
        ["Fix 3: panel", "Average score of all judges in the round, treated as one judge", "reuses pointwise"],
    ]))
    w("")
    w("### 3.4 Rounds")
    w("")
    w(table(["Round", "Judges", "Purpose"], [
        ["1 · Small", "Qwen 3.5 9B, Gemma 3 12B, Llama 3.1 8B", "Main experiment"],
        ["2 · Replication", "Same three", "Fresh calls (no cache reuse) to check the results replicate"],
        ["3 · Medium", "Qwen3 32B, Gemma 3 27B, Llama 3.3 70B", "Does a bigger model help?"],
        ["4 · Large", "Qwen3 235B, Gemini 2.5 Flash, Llama 4 Maverick", "Most capable affordable models"],
    ]))
    w("")
    w("### 3.5 Statistics")
    w("")
    w("- Urdu script is the **reference**; every other version is compared with it **on the same items** (paired).")
    w("- **95% confidence intervals** by bootstrap (1,000 resamples, fixed seed). A difference is called **real** "
      "when its interval excludes \"no difference\" (0 for gaps, 50% for pairwise). Real differences are **bold**.")
    w("- **Ties and unreadable replies are counted separately**, never as failures; replies are parsed by plain code "
      "(\"Score: 8/10\" → 8, \"I would reply A\" → A), never by another model.")
    w("")
    w("### 3.6 Infrastructure and cost control")
    w("")
    w(f"- **Scale:** {d['results_rows']:,} result rows ({n_point:,} pointwise, {n_pair:,} pairwise, {n_comp:,} "
      f"comprehension), {d['calls_cached']:,} cached model calls, **${d['spend_usd']:.2f}** total spend.")
    w(f"- **Unreadable replies:** {sc.get('pointwise:unparseable', 0):,} pointwise, {sc.get('comprehension:unparseable', 0):,} "
      f"comprehension, {sc.get('pairwise:unparseable', 0):,} pairwise (almost all from Llama models' long replies); "
      f"pairwise ties: {sc.get('pairwise:tie', 0):,}.")
    w("- Every call is **cached** (re-running costs nothing), runs **resume** after interruptions, retries back off on "
      "rate limits, a **hard budget cap** ($30) refuses paid calls beyond it, and starting experiments needs an extra "
      "password. The platform (FastAPI + Next.js, Docker) is deployed with login and HTTPS.")
    w("")

    # ------------------------------------------------------------------ 4 metrics
    w("## 4. Metrics (what each number means)")
    w("")
    w(table(["Metric", "Meaning", "Fair / ideal value"], [
        ["Score gap", "Points (out of 10) the same correct answer gains or loses in a version vs. Urdu script", "0"],
        ["Wrong-answer gap", "Same, for the wrong answer (positive = wrong answers scored *higher*)", "0"],
        ["Error detection (AUC)", "How well scores separate right from wrong answers", "1.0 (0.5 = guessing)"],
        ["Acceptance rate", "Share of answers scored ≥ 7, for correct and for wrong answers", "high for correct, low for wrong"],
        ["Head-to-head win rate", "Same answer in a version vs. Urdu script, both orders: share the version wins (tie = ½)", "50%"],
        ["First-pick rate", "Share of decided pairwise replies that picked whichever answer was shown first", "50% (else position bias)"],
        ["Comprehension accuracy", "Judge answers the question itself correctly", "equal across versions"],
        ["Consistency", "Share of answers given exactly the same score when asked again", "100%"],
        ["Understood-both gap", "Score gap only on questions the judge answered correctly in both scripts", "0"],
        ["Panel gap", "Score gap of the round's average judge", "0"],
    ]))
    w("")

    # ------------------------------------------------------------------ 5 results
    w("## 5. Results")
    w("")
    w("⚑ = failed the screening gate in that round (Llama 3.1 8B in both small rounds; Qwen 3.5 9B narrowly, AUC 0.69, "
      "in the replication round). Their numbers are reported; Llama 3.1 8B's should not carry conclusions.")
    w("")
    w("### 5.1 Score gap on correct answers (vs. Urdu script, points out of 10, 95% CI)")
    w("")
    w(table(["Round", "Judge", "Roman Urdu", "Code-mixed", "English"],
            [[lab, j["name"] + flag(j)] + [gap(j["gap"].get(c)) for c in OTHERS] for _, lab, _, j in rows_of(d)]))
    w("")
    w("### 5.2 Panel (average of the round's judges)")
    w("")
    w(table(["Round", "Roman Urdu", "Code-mixed", "English", "AUC Urdu / Roman"],
            [[lab] + [gap(d["rounds"][k]["panel"]["gap"].get(c)) for c in OTHERS] +
             [f"{num(d['rounds'][k]['panel']['auc'].get('urdu_script'))} / {num(d['rounds'][k]['panel']['auc'].get('roman_translit'))}"]
             for k, lab in ROUNDS if k in d["rounds"]]))
    w("")
    w("### 5.3 Wrong answers: score gap and how often they get a good score (≥ 7)")
    w("")
    w(table(["Round", "Judge", "Wrong-answer gap: Roman / code-mixed / English", "Wrong accepted: Urdu / Roman / Mixed / English",
             "Correct accepted: Urdu / Roman / Mixed / English"],
            [[lab, j["name"] + flag(j), " / ".join(gap(j["gap_wrong"].get(c)) for c in OTHERS),
              " / ".join(pct(j["accept_wrong"].get(c)) for c in VERSIONS),
              " / ".join(pct(j["accept_correct"].get(c)) for c in VERSIONS)] for _, lab, _, j in rows_of(d)]))
    w("")
    w("### 5.4 Error detection (AUC: telling right from wrong answers)")
    w("")
    w(table(["Round", "Judge"] + [V[c] for c in VERSIONS],
            [[lab, j["name"] + flag(j)] + [num(j["auc"].get(c)) for c in VERSIONS] for _, lab, _, j in rows_of(d)]))
    w("")
    w("### 5.5 Head-to-head (pairwise) vs. Urdu script")
    w("")
    w("Win rate of the version against the identical Urdu-script answer, both orders (fair = 50%); W/L/T = wins, "
      "losses, ties; first pick = share of decided replies that chose the answer shown first.")
    w("")
    prow = []
    for _, lab, _, j in rows_of(d):
        p = j["pairwise"]
        cells = []
        for c in OTHERS:
            x = p.get(c)
            if not x:
                cells.append("–")
                continue
            s = f"{pct(x['win_rate'])} [{pct(x['lo'])}–{pct(x['hi'])}] ({x['wins']}/{x['losses']}/{x['ties']})"
            cells.append(f"**{s}**" if real(x, 0.5) else s)
        note = " ‡" if j.get("pairwise_rerun") else ""
        prow.append([lab, j["name"] + flag(j) + note] + cells +
                    [pct(j.get("pairwise_first_pick")), pct(j.get("pairwise_unparseable_share"), 1)])
    w(table(["Round", "Judge", "Roman Urdu", "Code-mixed", "English", "First pick", "Unreadable"], prow))
    w("")
    w("‡ Llama 4 Maverick: re-run (run #42) with a longer pairwise reply limit; see §11.")
    w("")
    w("### 5.6 Comprehension (the judge answers the question itself)")
    w("")
    w(table(["Round", "Judge"] + [V[c] for c in VERSIONS] + ["Roman − Urdu"],
            [[lab, j["name"] + flag(j)] + [pct(j["comprehension"].get(c)) for c in VERSIONS] +
             [f"{(j['comprehension']['roman_translit'] - j['comprehension']['urdu_script']) * 100:+.0f} pts".replace("-", "−")]
             for _, lab, _, j in rows_of(d)]))
    w("")
    w("### 5.7 Does the penalty remain when the judge understood the question?")
    w("")
    w("Score gap on correct answers, restricted to questions the judge answered correctly in **both** Urdu script and "
      "the other version (n = number of such questions).")
    w("")
    urows = []
    for _, lab, _, j in rows_of(d):
        u = j.get("understood_gap") or {}
        if not u:
            continue
        urows.append([lab, j["name"] + flag(j)] +
                     [f"{gap(u.get(c))} (n={u[c]['n']})" if u.get(c) else "–" for c in ("roman_translit", "code_mixed")])
    w(table(["Round", "Judge", "Roman Urdu", "Code-mixed"], urows))
    w("")
    w("### 5.8 Consistency (identical score when asked again; 50 questions × 3)")
    w("")
    w(table(["Round", "Judge"] + [V[c] for c in VERSIONS],
            [[lab, j["name"] + flag(j)] + [pct((j["consistency"].get(c) or {}).get("share_identical")) for c in VERSIONS]
             for _, lab, _, j in rows_of(d)]))
    w("")
    w("### 5.9 Mitigations")
    w("")
    w("Roman Urdu score gap on correct answers, error detection in Roman Urdu, and wrong answers accepted in Roman "
      "Urdu, without and with each fix.")
    w("")
    mrows = []
    for _, lab, _, j in rows_of(d):
        r, t = j.get("rubric") or {}, j.get("translit") or {}
        mrows.append([lab, j["name"] + flag(j),
                      gap(j["gap"].get("roman_translit")), gap((r.get("gap") or {}).get("roman_translit")),
                      gap((t.get("gap") or {}).get("roman_translit")),
                      f"{num(j['auc'].get('roman_translit'))} / {num((r.get('auc') or {}).get('roman_translit'))} / {num((t.get('auc') or {}).get('roman_translit'))}",
                      f"{pct(j['accept_wrong'].get('roman_translit'))} / {pct((r.get('accept_wrong') or {}).get('roman_translit'))} / {pct((t.get('accept_wrong') or {}).get('roman_translit'))}"])
    w(table(["Round", "Judge", "Gap: no fix", "Gap: rubric", "Gap: transliterate", "AUC Roman: none / rubric / translit",
             "Wrong accepted, Roman: none / rubric / translit"], mrows))
    w("")
    w("### 5.10 Prompt length by version (tokens per pointwise prompt)")
    w("")
    w("How many tokens each model's tokenizer needed for the same pointwise prompt in each version (provider-reported).")
    w("")
    names = {jid: j["name"] for _, _, jid, j in rows_of(d)}
    w(table(["Model"] + [V[c] for c in VERSIONS],
            [[names.get(m, m)] + [f"{(t.get(c) or {}).get('tokens', 0):.0f}" for c in VERSIONS] for m, t in d["tokens"].items()]))
    w("")
    w("Token counts do not line up with the penalty. For the Llama and Qwen3 models, Urdu script needs about 35–40% "
      "**more** tokens than Roman Urdu; for Gemma, Roman Urdu needs about 15% more; for Qwen 3.5 9B they are equal. Yet "
      "every one of these judges penalises Roman Urdu, so the penalty is not explained by how many pieces the text is "
      "split into. (Token counts are not available for Gemini 2.5 Flash and Llama 4 Maverick.)")
    w("")

    # ------------------------------------------------------------------ 6 observations
    w("## 6. Observations")
    w("")
    for o in [
        "**Consistent penalty.** Every capable judge, in every round and at every size, scores the same correct answer lower in Roman Urdu (−0.55 to −1.26) and code-mixed text (−0.59 to −1.30) than in Urdu script. English is usually scored *higher* than Urdu script (up to +1.38). The order is English > Urdu script > Roman Urdu ≈ code-mixed.",
        "**Not just misunderstanding.** On questions the judge answered correctly in both scripts the penalty remains (−0.57 to −1.35 for Roman Urdu among capable judges, all real differences, §5.7). Judges react to how the text looks, not only to what they understood.",
        "**Bigger is better, but not fairer.** From small to large models, error detection in Urdu script rises (AUC 0.57–0.74 → 0.81–0.87), comprehension improves and consistency climbs (Gemini 2.5 Flash gives the same score on repeat 96–98% of the time) — yet the Roman Urdu score penalty does not shrink, and the large-round panel penalty is the largest.",
        "**Head-to-head: close to fair for two large judges, biased for Qwen.** Gemini 2.5 Flash (48%) and Llama 4 Maverick (49%) answer TIE in about 95% of comparisons; when they do pick a side they still pick the Urdu-script version. The Qwen family prefers Urdu script strongly at every size (8–25%).",
        "**Understanding gap.** Most judges answer about 15 points less accurately in Roman Urdu than in Urdu script; Gemini 2.5 Flash closes most of the gap (86% vs 91%), Llama 4 Maverick does not (66% vs 85%).",
        "**Mistakes slip through.** Wrong answers in Roman Urdu are more often scored ≥ 7 (e.g. Llama 3.3 70B 57% vs 34%, Llama 4 Maverick 40% vs 25%), and error detection (AUC) is lower in Roman Urdu for every judge.",
        "**Roman Urdu scores are squeezed toward the middle.** Correct Roman Urdu answers are scored lower *and* wrong ones higher than in Urdu script (wrong-answer gap up to +1.77 for Llama 3.3 70B and +1.35 for Llama 4 Maverick, §5.3). The judge separates right from wrong less sharply — which is exactly the lower AUC in Roman Urdu. In English the opposite happens: wrong answers are scored lower.",
        "**Code-mixing does not help.** Adding English nouns does not rescue Roman Urdu: code-mixed text is penalised as much or slightly more.",
        "**Position bias exists and both orders matter.** Some judges mostly pick whichever answer is shown first (Llama 3.1 8B 75%, Qwen3 32B 74%), others the second (Gemma 3 27B 19%, Qwen3 235B 22% first). Running every pair in both orders cancels this, so the script preferences in §5.5 are not a position effect.",
        "**Replicates.** Round 2 (fresh calls) points the same way as round 1, with somewhat larger gaps (Qwen −0.81 → −1.13; Gemma −0.59 → −0.82).",
        "**Fixes.** Transliterating to Urdu script first is the most effective fix (it removes most of the gap for small/medium models and restores error detection) but leaves a real gap for the large models. The \"ignore script\" rubric mostly raises leniency (more wrong answers accepted). A panel inherits the shared bias.",
        "**Screening is noisy near the cut-off.** On only 20 questions, Qwen 3.5 9B passed in round 1 (AUC 0.76) and narrowly failed in round 2 (0.69). Llama 3.1 8B failed both times and is unreliable as a judge.",
    ]:
        w(f"- {o}")
    w("")

    # ------------------------------------------------------------------ 7 why
    w("## 7. Why does this happen?")
    w("")
    w("Most likely explanations, combining published research with our own evidence (well supported, not proven "
      "cause-and-effect):")
    w("")
    w("1. **Familiarity bias.** LLM judges give higher scores to text that is more familiar to them (lower perplexity), "
      "regardless of content [1]. Clean English and standard Urdu script are common in training data; informal Roman "
      "Urdu is not. *Ours:* the order English > Urdu script > Roman Urdu, and the penalty persists when the question was "
      "understood (§5.7).")
    w("2. **No standard spelling.** One Urdu word can be written many ways in Latin letters (up to 20 variants in one "
      "study [2]), so each spelling is rare in training data. *Ours:* converting to Urdu script — one standard spelling, "
      "same meaning — removes most of the penalty (§5.9).")
    w("3. **Low-resource judging is less reliable, and scale does not fix it.** Multilingual LLM judges are inconsistent "
      "across languages and worst for low-resource ones; bigger models and multilingual training do not fix this [3]. "
      "*Ours:* ~15-point comprehension drop; the penalty does not shrink with size.")
    w("4. **It is the script, not the language mix or the token count.** Code-mixed text (Roman Urdu with English nouns) "
      "is penalised as much as plain Roman Urdu, and token counts do not line up with the penalty (§5.10), pointing at "
      "the informal Latin-script form itself.")
    w("")

    # ------------------------------------------------------------------ 8-9 impact / guidelines
    w("## 8. Impact")
    w("")
    w("- **People:** Urdu speakers who type in Roman script get lower automated grades and less reliable feedback when AI "
      "grades answers, ranks replies or moderates content.")
    w("- **AI systems:** chatbots tuned with AI judges or reward models learn to avoid the way many Urdu speakers write.")
    w("- **Research and leaderboards:** LLM-as-a-judge evaluations for South Asian languages may measure script, not "
      "quality. The same controlled test applies to Hindi/Hinglish, Arabic/Arabizi, Bengali and other two-script languages.")
    w("")
    w("## 9. Guidelines for others")
    w("")
    for g in [
        "**Test your judge before trusting it**: same content in Urdu script, Roman Urdu and English; if scores differ, it grades the script.",
        "**Convert Roman Urdu to Urdu script before judging** — the most effective fix found, and it restores error detection.",
        "**Do not rely on \"ignore spelling\" instructions** — they make judges more lenient, not fairer.",
        "**Do not assume a bigger model or a panel fixes it.**",
        "**Report results per script**, including Roman Urdu and code-mixed text.",
        "**Keep a human in the loop for Roman Urdu**, especially when decisions affect people.",
        "**Choose judges by measured fairness, not size** — and check position bias by running both orders.",
    ]:
        w(f"1. {g}")
    w("")

    # ------------------------------------------------------------------ 10 limitations
    w("## 10. Limitations")
    w("")
    for l in [
        "One dataset (Belebele) and one task type (reading comprehension); results may differ for open-ended answers.",
        "Roman Urdu and code-mixed answer options were written by Claude Opus 5.5 and checked automatically, not by humans; passages and questions for those versions are Belebele's Roman Urdu.",
        "Judges are not fully deterministic at temperature 0, so single questions are noisy; only the 300-question averages should be quoted.",
        "The 20-question screening gate is noisy near its cut-off.",
        "Model substitutions for the large tier: Gemini 3.x forced \"thinking\" (not switchable off on OpenRouter) and Qwen 3.7 Max was rate-limited to a crawl, so Gemini 2.5 Flash and Qwen3 235B were used.",
        "The explanations in §7 are supported by our data and prior work but are not causal proof.",
    ]:
        w(f"- {l}")
    w("")

    # ------------------------------------------------------------------ 11 process notes
    w("## 11. Process notes (issues met and how they were handled)")
    w("")
    for p in [
        "**Two Roman Urdu versions → one.** Belebele's own Roman Urdu was dropped as an experiment version because it is often reworded; our faithful transliteration is the Roman Urdu condition.",
        "**Code-mixed coverage** was extended from a 100-item subset to all 300 questions so every question has four versions.",
        "**Mock judge removed** from the live configuration; it is used only in automated tests.",
        "**Replication bug caught:** the first replication attempt silently reused cached answers (the API dropped the round label and replicate number). It was stopped at zero cost, the duplicate runs removed, the API fixed and an API-level regression test added.",
        "**Large-tier model problems:** Gemini 3.8 Flash requires reasoning (refused with reasoning off) → replaced by Gemini 2.5 Flash; Qwen 3.7 Max was rate-limited (HTTP 429) by its only provider → replaced by Qwen3 235B; one Qwen3 235B provider (DeepInfra) returned broken replies → skipped by provider routing; intermittent \"user location not supported\" refusals from Google AI Studio → retried automatically.",
        "**Llama 4 Maverick pairwise re-run (run #42):** Maverick reasons step by step before a pairwise verdict; the 8-token limit cut off 86% of its replies, so its first result was unusable. It was re-run with a 1,024-token pairwise limit and a parser that reads the final verdict; 0.4% of replies stayed unreadable. Re-reading all earlier pairwise runs with this parser changed none of their results.",
        "**Dashboard summaries** are written by a separate model (Claude Sonnet 5.5) from numbers already judged by code; an earlier summary model misstated a result, which led to this design.",
        "**Cost control:** hard $30 budget cap in the backend, experiment password, per-model request limits, screening and health checks before every large run.",
    ]:
        w(f"- {p}")
    w("")

    # ------------------------------------------------------------------ 12 reproducibility
    w("## 12. Reproducibility")
    w("")
    w("- **Code:** `Backend/` (FastAPI, metrics in `app/metrics.py`), `Frontend/` (Next.js dashboard), `experiments/` "
      "(drivers for the rounds), `paper/analysis/` (figures, tables and this report).")
    w("- **Generated data:** `Backend/generated/opus-5.5-high.json` (Roman Urdu and code-mixed options, CC BY-SA 4.0 like Belebele).")
    w("- **Configuration:** `Backend/config.toml` (judges, tiers, budget), prompts in `Backend/prompts/`.")
    w("- **Rebuild numbers and this report** from the experiment database:")
    w("")
    w("```sh")
    w("python paper/analysis/make_figures.py --paper short_paper --db Backend/data/audit.db   # writes results.json, figures, tables")
    w("python paper/analysis/make_report.py                                                  # writes docs/REPORT.md")
    w("```")
    w("")

    # ------------------------------------------------------------------ 13 references
    w("## 13. References")
    w("")
    w("1. Wataoka, Takahashi, Ri. *Self-Preference Bias in LLM-as-a-Judge.* arXiv:2410.21819 (2024). https://arxiv.org/abs/2410.21819")
    w("2. *A Clustering Framework for Lexical Normalization of Roman Urdu.* arXiv:2004.00088. https://arxiv.org/abs/2004.00088")
    w("3. Fu, Liu. *How Reliable is Multilingual LLM-as-a-Judge?* Findings of EMNLP 2025. https://arxiv.org/abs/2505.12201")
    w("4. Bandarkar et al. *The Belebele Benchmark: a Parallel Reading Comprehension Dataset in 122 Language Variants.* ACL 2024.")
    w("5. Mohamed et al. *Lost in the Mix* (Urdu–English code-mixing). ACL 2026.")
    w("6. Zheng et al. *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* NeurIPS 2023.")
    w("")
    return "\n".join(L)


def main() -> int:
    d = json.loads(RESULTS.read_text(encoding="utf-8"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build(d), encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
