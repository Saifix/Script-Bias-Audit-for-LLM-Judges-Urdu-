# Is the AI Judge Fair to Roman Urdu?
### Measuring script bias in LLM judges

Large language models are increasingly used as **judges**: they grade answers, rank chatbot replies and decide
which model output is "better". Urdu has roughly 230 million speakers, and online many of them write it in **Roman script**
(Latin letters, e.g. *"do kilo seb"*) rather than the standard Perso-Arabic **Urdu script** (*"دو کلو سیب"*),
and they freely mix in English words (*"do kilo apples"*).

If an LLM judge gives a lower score to the *same correct answer* just because it is written in Roman Urdu, every
evaluation, leaderboard and reward model built on that judge quietly penalises how Urdu speakers actually write.
This project measures whether that happens, how large the effect is, and whether simple fixes remove it.

> **Research question.** Holding content fixed, does the script an answer is written in — Urdu script, Roman Urdu,
> English, or Urdu–English code-mixed — change how an LLM judge scores, compares and understands it?

---

## What we test

The same answer is shown to a judge in five script conditions:

| Condition | Example (the same answer) | Source |
|---|---|---|
| **Urdu script** (reference) | دو کلو سیب | Belebele `urd_Arab` |
| **Roman Urdu — Belebele** | do kilo seb | Belebele `urd_Latn` |
| **Roman Urdu — transliterated** | do kilo seb | LLM transliteration of the Urdu script, human-reviewed |
| **English** | two kilos of apples | Belebele `eng_Latn` |
| **Code-mixed** | do kilo apples | LLM noun-switching (Urdu matrix language), human-reviewed |

Why two Roman Urdu conditions: a pilot found that about 9 of 20 of Belebele's Roman Urdu answer options were
**reworded rather than transliterated** (e.g. "Apple" became "Seeb"). A separate, human-checked transliteration
lets us tell *script* effects apart from *wording* effects.

## Method

**Data.** 300 reading-comprehension items sampled (fixed seed) from **Belebele** (Bandarkar et al.), which provides
the same passage, question and four answer options in Urdu script, Roman Urdu and English. For each item we use the
correct option and one wrong option. The passage and question are always shown in the same script as the answer. A
100-item subset gets a code-mixed version following the noun-switching approach of *Lost in the Mix*
(Mohamed et al., ACL 2026). Every generated text is approved, edited or rejected by a human reviewer before use.

**Judges.** Three small open-weights LLMs from three different companies, accessed through OpenRouter:
**Qwen 3.5 9B** (Alibaba), **Llama 3.1 8B Instruct** (Meta) and **Gemma 3 12B** (Google),
at temperature 0 with fixed prompts. The exact model ID, provider and timestamp of every call are recorded.

**Experiments.**

1. **Screening gate** — can the judge tell correct from wrong answers at all (AUC > 0.7 in Urdu script and English)?
   Judges that fail are flagged, because their bias numbers would be noise.
2. **Comprehension** — the judge answers the multiple-choice question itself in each script. Does it *understand*
   Roman Urdu as well as Urdu script?
3. **Pointwise scoring** — "Rate how correct and helpful this answer is from 1 to 10." Same answer, five scripts.
4. **Pairwise comparison** — the same answer in two scripts side by side: "Which is better, A or B, or TIE?" Run in
   both orders to cancel position bias. A fair judge says TIE.
5. **Consistency** — repeated scoring on a 50-item subset to separate bias from randomness.
6. **Mitigations** — (a) a rubric line telling the judge to ignore script and spelling, (b) transliterating Roman and
   code-mixed text into Urdu script before judging, (c) averaging a panel of judges.

**Metrics** (per judge × script, Urdu script as reference, bootstrap 95% confidence intervals with 1,000 resamples):

- **Severity gap** — mean score difference on the *same* items (negative = harsher on that script).
- **Error detection** — AUC and separation between correct and wrong answers (does the judge still catch mistakes?).
- **Acceptance rate** — share of answers scored ≥ 7, split by correct and wrong (are wrong Roman Urdu answers waved through?).
- **Pairwise win rate** — ties count half; 50% means no preference.
- **Comprehension accuracy** and **score variance across repeats**.

Ties and unparseable outputs are reported separately, never silently counted as failures.

## Results

> **Status: pending the first full run.** The platform, data pipeline and judges are ready; the full experiment has
> not been run yet. Results will be added here as tables and charts once it completes.

Planned headline results:

| Finding | Metric | Qwen 3.5 9B | Llama 3.1 8B | Gemma 3 12B |
|---|---|---|---|---|
| Scores Roman Urdu lower than Urdu script? | severity gap (95% CI) | – | – | – |
| Prefers one script in head-to-head? | pairwise win rate vs. Urdu script | – | – | – |
| Understands Roman Urdu as well? | comprehension accuracy | – | – | – |
| Still catches wrong answers in Roman Urdu? | AUC per script | – | – | – |
| Does a rubric or transliteration fix it? | gap with vs. without mitigation | – | – | – |

## Why it matters

- **Fairness for real users.** If judges penalise Roman Urdu, chatbots tuned with those judges learn to avoid the way
  most Urdu speakers write, and evaluations under-rate systems that serve them well.
- **Trustworthy evaluation.** Leaderboards and research that use LLM-as-a-judge for South Asian languages need to
  know whether the judge measures quality or script.
- **Practical fixes.** Testing cheap mitigations (a rubric line, transliteration, judge panels) tells practitioners
  what actually works, not just that a problem exists.
- **Reusable method.** The same controlled design — identical content, only the script changes — applies to Hindi
  (Devanagari vs. Hinglish), Arabic (Arabizi), Bengali and other languages written in more than one script.

## Try it

The project runs as a private web platform. Its home page shows the latest findings and a **Test yourself** tool:
type a question, record a voice note, or pick a dataset question, and see how each judge scores the same answer in
every script.

## Team

See the **Contributors** page in the platform.

## References

- Bandarkar et al. *The Belebele Benchmark: a Parallel Reading Comprehension Dataset in 122 Language Variants.* ACL 2024.
- Mohamed et al. *Lost in the Mix* (Urdu–English code-mixing). ACL 2026.
- Zheng et al. *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* NeurIPS 2023.

---

Technical setup, deployment and development notes: [docs/SETUP.md](docs/SETUP.md).
