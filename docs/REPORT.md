# Script-Bias Audit for LLM Judges (Urdu) — Full Report

*Is the AI judge fair to Roman Urdu? Measuring script bias in LLM judges.*  
2601 SSE Responsible AI Engineering, LUMS — Syed Sheraz Anjum (25240017), Saif ur Rehman (24280071), Hussnain Ali Murtaza (25280069), Junaid Tariq (25280044), Mukhammad Khasnen (25280090).

> This report is generated from `paper/analysis/results.json` by `paper/analysis/make_report.py`; every number matches the paper, the README and the live dashboard. Rebuild with `python paper/analysis/make_report.py`.

## Contents
1. Summary
2. Research question
3. Process and method
4. Metrics (what each number means)
5. Results
6. Observations
7. Why does this happen?
8. Impact
9. Guidelines for others
10. Limitations
11. Process notes (issues met and how they were handled)
12. Reproducibility
13. References

## 1. Summary

We showed LLM judges the **same answer** written four ways — Urdu script, Roman Urdu, English and Urdu–English code-mixed — and measured whether their verdict changed. Across 300 Belebele reading-comprehension questions, 9 judges from 3 companies at 3 model sizes (plus a replication round), about 132,671 model calls and **$9.49** of API spend:

- **Every capable judge scores the same correct answer lower in Roman Urdu and code-mixed text** (−0.55 to −1.30 points out of 10), and higher in English.
- **The penalty is not only misunderstanding:** it remains on questions the judge understood in both scripts.
- **Bigger models are better judges but not fairer scorers:** the large-model panel penalty (-0.92) is the largest of all rounds.
- **Judges understand Roman Urdu less well** (about 15 points lower accuracy for most) and **let more wrong Roman Urdu answers through**.
- **Converting Roman Urdu to Urdu script before judging is the most effective fix**; an "ignore spelling" rubric mostly makes judges more lenient, and a judge panel does not cancel the bias.

## 2. Research question

Holding content fixed, does the **script** an answer is written in change how an LLM judge **scores**, **compares** and **understands** it? LLM judges grade answers, rank chatbot replies and train reward models. Urdu is very often typed online in Roman script and mixed with English; if judges penalise that, evaluations and the systems tuned with them quietly disadvantage how Urdu speakers actually write.

**Hypothesis.** Judges favour the scripts most common in their training data (English, standard Urdu script) and penalise Roman Urdu and code-mixed text, even when the content is identical.

## 3. Process and method

### 3.1 Data

- **Source:** the Belebele benchmark (Bandarkar et al., ACL 2024), parallel reading-comprehension items. 300 items were sampled with a fixed seed; each has a passage, a question and 4 options (1,200 options in total). For every item we use the correct option and one wrong option chosen deterministically from the seed.
- **Four versions of every question** (a judge always sees passage, question and answer in the same version):

| Version | Example (same answer) | Source |
|---|---|---|
| Urdu script (reference) | دو کلو سیب | Belebele `urd_Arab` |
| Roman Urdu | do kilo seb | Answers: word-by-word transliteration by Claude Opus 5.5 (high effort); passage and question: Belebele `urd_Latn` |
| English | two kilos of apples | Belebele `eng_Latn` |
| Code-mixed | do kilo apples | Answers: Roman Urdu with selected nouns switched to English (*Lost in the Mix*, ACL 2026), by Claude Opus 5.5; passage and question: Belebele `urd_Latn` |

- **Why our own Roman Urdu answers:** Belebele's Roman Urdu options are often reworded rather than transliterated — **590 of 1,200** of its options have a different word count from the Urdu-script option, against **117** for our transliteration (mostly compound words and izafat). Rewording would mix up *script* effects with *wording* effects.
- **Length:** passages average 100 words in Urdu script and 79 in English; answers average 5.3 (Urdu script), 5.2 (Roman), 5.1 (code-mixed) and 4.2 (English) words.
- **Quality checks** on the generated text: four non-empty options per item, no Urdu script left, no word-count drift; accepted without human review (see Limitations).

### 3.2 Judges

| Size | Judge | Company | OpenRouter ID | Screening AUC Urdu | Screening AUC English | Screening |
|---|---|---|---|---|---|---|
| Small | Qwen 3.5 9B | Qwen | `qwen/qwen3.5-9b` | 0.76 | 0.91 | pass |
| Small | Llama 3.1 8B | Llama | `meta-llama/llama-3.1-8b-instruct` | 0.65 | 0.75 | **fail** ⚑ |
| Small | Gemma 3 12B | Google | `google/gemma-3-12b-it` | 0.77 | 0.93 | pass |
| Medium | Qwen3 32B | Qwen | `qwen/qwen3-32b` | 0.83 | 0.90 | pass |
| Medium | Llama 3.3 70B | Llama | `meta-llama/llama-3.3-70b-instruct` | 0.85 | 0.94 | pass |
| Medium | Gemma 3 27B | Google | `google/gemma-3-27b-it` | 0.88 | 0.93 | pass |
| Large | Qwen3 235B | Qwen | `qwen/qwen3-235b-a22b-2507` | 0.81 | 0.99 | pass |
| Large | Llama 4 Maverick | Llama | `meta-llama/llama-4-maverick` | 0.88 | 0.95 | pass |
| Large | Gemini 2.5 Flash | Google | `google/gemini-2.5-flash` | 0.95 | 0.99 | pass |

All judges run through one OpenRouter client at **temperature 0**, reasoning switched off where the API allows it, with a small reply limit (8 tokens; Llama 4 Maverick gets 1,024 tokens for pairwise only, see §11). Model ID, provider and timestamp of every call are recorded.

### 3.3 Experiments

| Experiment | What the judge does | Size per judge |
|---|---|---|
| Screening gate | Scores correct vs. wrong answers in Urdu script and English; must reach AUC > 0.70 in both | 20 questions |
| Comprehension | Answers the 4-option question itself, in each version | 300 × 4 |
| Pointwise scoring | "Rate how correct and helpful this answer is from 1 to 10. Reply with only the number." | 300 × 4 × (correct, wrong) |
| Pairwise | Same answer in a version and in Urdu script: "Which answer is better, A or B? Reply A, B or TIE." Both orders | 300 × 3 × 2 answers × 2 orders |
| Repeats | Pointwise again, two extra times | 50 questions × 3 |
| Fix 1: rubric | Pointwise with "Ignore script, spelling and formality; judge only correctness." | as pointwise |
| Fix 2: transliterate first | Roman Urdu and code-mixed text converted to Urdu script (by `gpt-4o-mini`, 1,584 conversions) before judging | as pointwise |
| Fix 3: panel | Average score of all judges in the round, treated as one judge | reuses pointwise |

### 3.4 Rounds

| Round | Judges | Purpose |
|---|---|---|
| 1 · Small | Qwen 3.5 9B, Gemma 3 12B, Llama 3.1 8B | Main experiment |
| 2 · Replication | Same three | Fresh calls (no cache reuse) to check the results replicate |
| 3 · Medium | Qwen3 32B, Gemma 3 27B, Llama 3.3 70B | Does a bigger model help? |
| 4 · Large | Qwen3 235B, Gemini 2.5 Flash, Llama 4 Maverick | Most capable affordable models |

### 3.5 Statistics

- Urdu script is the **reference**; every other version is compared with it **on the same items** (paired).
- **95% confidence intervals** by bootstrap (1,000 resamples, fixed seed). A difference is called **real** when its interval excludes "no difference" (0 for gaps, 50% for pairwise). Real differences are **bold**.
- **Ties and unreadable replies are counted separately**, never as failures; replies are parsed by plain code ("Score: 8/10" → 8, "I would reply A" → A), never by another model.

### 3.6 Infrastructure and cost control

- **Scale:** 191,760 result rows (130,560 pointwise, 46,800 pairwise, 14,400 comprehension), 132,671 cached model calls, **$9.49** total spend.
- **Unreadable replies:** 126 pointwise, 9 comprehension, 3,755 pairwise (almost all from Llama models' long replies); pairwise ties: 19,142.
- Every call is **cached** (re-running costs nothing), runs **resume** after interruptions, retries back off on rate limits, a **hard budget cap** ($30) refuses paid calls beyond it, and starting experiments needs an extra password. The platform (FastAPI + Next.js, Docker) is deployed with login and HTTPS.

## 4. Metrics (what each number means)

| Metric | Meaning | Fair / ideal value |
|---|---|---|
| Score gap | Points (out of 10) the same correct answer gains or loses in a version vs. Urdu script | 0 |
| Wrong-answer gap | Same, for the wrong answer (positive = wrong answers scored *higher*) | 0 |
| Error detection (AUC) | How well scores separate right from wrong answers | 1.0 (0.5 = guessing) |
| Acceptance rate | Share of answers scored ≥ 7, for correct and for wrong answers | high for correct, low for wrong |
| Head-to-head win rate | Same answer in a version vs. Urdu script, both orders: share the version wins (tie = ½) | 50% |
| First-pick rate | Share of decided pairwise replies that picked whichever answer was shown first | 50% (else position bias) |
| Comprehension accuracy | Judge answers the question itself correctly | equal across versions |
| Consistency | Share of answers given exactly the same score when asked again | 100% |
| Understood-both gap | Score gap only on questions the judge answered correctly in both scripts | 0 |
| Panel gap | Score gap of the round's average judge | 0 |

## 5. Results

⚑ = failed the screening gate in that round (Llama 3.1 8B in both small rounds; Qwen 3.5 9B narrowly, AUC 0.69, in the replication round). Their numbers are reported; Llama 3.1 8B's should not carry conclusions.

### 5.1 Score gap on correct answers (vs. Urdu script, points out of 10, 95% CI)

| Round | Judge | Roman Urdu | Code-mixed | English |
|---|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | **−0.81 [−1.16, −0.47]** | **−0.91 [−1.27, −0.56]** | +0.34 [−0.06, +0.72] |
| 1 · Small | Llama 3.1 8B ⚑ | −0.12 [−0.39, +0.15] | **−0.31 [−0.57, −0.01]** | +0.21 [−0.12, +0.53] |
| 1 · Small | Gemma 3 12B | **−0.59 [−0.95, −0.24]** | **−0.86 [−1.22, −0.50]** | **+0.57 [+0.19, +0.91]** |
| 2 · Replication | Qwen 3.5 9B ⚑ | **−1.13 [−1.54, −0.68]** | **−1.19 [−1.62, −0.81]** | **+0.41 [+0.02, +0.79]** |
| 2 · Replication | Llama 3.1 8B ⚑ | −0.29 [−0.58, +0.00] | **−0.46 [−0.76, −0.17]** | +0.13 [−0.20, +0.43] |
| 2 · Replication | Gemma 3 12B | **−0.82 [−1.21, −0.41]** | **−0.91 [−1.28, −0.51]** | **+0.48 [+0.12, +0.83]** |
| 3 · Medium | Qwen3 32B | **−0.82 [−1.07, −0.57]** | **−0.97 [−1.26, −0.70]** | **+1.38 [+1.11, +1.64]** |
| 3 · Medium | Llama 3.3 70B | **−0.55 [−0.89, −0.21]** | **−0.59 [−0.94, −0.27]** | **+0.43 [+0.12, +0.77]** |
| 3 · Medium | Gemma 3 27B | **−0.92 [−1.32, −0.53]** | **−0.99 [−1.40, −0.61]** | +0.08 [−0.29, +0.45] |
| 4 · Large | Qwen3 235B | **−1.26 [−1.59, −0.93]** | **−1.30 [−1.60, −0.98]** | **+1.29 [+0.96, +1.57]** |
| 4 · Large | Llama 4 Maverick | **−0.71 [−1.03, −0.42]** | **−0.85 [−1.17, −0.54]** | **+0.87 [+0.60, +1.14]** |
| 4 · Large | Gemini 2.5 Flash | **−0.78 [−1.15, −0.42]** | **−0.96 [−1.34, −0.57]** | **+0.48 [+0.15, +0.76]** |

### 5.2 Panel (average of the round's judges)

| Round | Roman Urdu | Code-mixed | English | AUC Urdu / Roman |
|---|---|---|---|---|
| 1 · Small | **−0.51 [−0.71, −0.32]** | **−0.69 [−0.89, −0.50]** | **+0.38 [+0.11, +0.63]** | 0.75 / 0.64 |
| 2 · Replication | **−0.75 [−0.98, −0.51]** | **−0.86 [−1.09, −0.60]** | **+0.35 [+0.08, +0.60]** | 0.73 / 0.64 |
| 3 · Medium | **−0.76 [−1.01, −0.54]** | **−0.85 [−1.09, −0.64]** | **+0.63 [+0.38, +0.88]** | 0.82 / 0.70 |
| 4 · Large | **−0.92 [−1.11, −0.71]** | **−1.04 [−1.25, −0.80]** | **+0.88 [+0.66, +1.08]** | 0.89 / 0.80 |

### 5.3 Wrong answers: score gap and how often they get a good score (≥ 7)

| Round | Judge | Wrong-answer gap: Roman / code-mixed / English | Wrong accepted: Urdu / Roman / Mixed / English | Correct accepted: Urdu / Roman / Mixed / English |
|---|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | +0.27 [−0.14, +0.73] / +0.32 [−0.10, +0.74] / **−1.28 [−1.68, −0.88]** | 38% / 41% / 43% / 26% | 70% / 59% / 58% / 78% |
| 1 · Small | Llama 3.1 8B ⚑ | +0.13 [−0.18, +0.45] / +0.02 [−0.30, +0.32] / **−1.17 [−1.58, −0.78]** | 78% / 71% / 71% / 49% | 87% / 79% / 75% / 81% |
| 1 · Small | Gemma 3 12B | **+0.77 [+0.38, +1.18]** / **+0.68 [+0.30, +1.11]** / **−0.71 [−1.07, −0.35]** | 39% / 51% / 50% / 28% | 81% / 74% / 72% / 88% |
| 2 · Replication | Qwen 3.5 9B ⚑ | +0.06 [−0.45, +0.55] / +0.12 [−0.35, +0.57] / **−1.07 [−1.53, −0.62]** | 42% / 44% / 45% / 28% | 76% / 64% / 61% / 81% |
| 2 · Replication | Llama 3.1 8B ⚑ | +0.09 [−0.21, +0.41] / −0.09 [−0.40, +0.20] / **−1.48 [−1.86, −1.07]** | 78% / 74% / 72% / 47% | 86% / 79% / 74% / 80% |
| 2 · Replication | Gemma 3 12B | **+0.46 [+0.09, +0.83]** / **+0.42 [+0.06, +0.79]** / **−0.95 [−1.32, −0.58]** | 41% / 49% / 49% / 27% | 82% / 72% / 72% / 88% |
| 3 · Medium | Qwen3 32B | +0.22 [−0.11, +0.52] / +0.16 [−0.15, +0.46] / **−0.86 [−1.20, −0.53]** | 31% / 38% / 38% / 20% | 75% / 65% / 62% / 92% |
| 3 · Medium | Llama 3.3 70B | **+1.77 [+1.38, +2.16]** / **+1.62 [+1.23, +2.01]** / **−1.39 [−1.73, −1.05]** | 34% / 57% / 55% / 12% | 85% / 80% / 80% / 91% |
| 3 · Medium | Gemma 3 27B | +0.34 [−0.06, +0.75] / +0.15 [−0.25, +0.55] / **−0.89 [−1.27, −0.54]** | 43% / 54% / 50% / 29% | 82% / 74% / 73% / 83% |
| 4 · Large | Qwen3 235B | **+0.83 [+0.57, +1.12]** / **+0.88 [+0.61, +1.17]** / **−0.75 [−0.94, −0.56]** | 14% / 20% / 22% / 7% | 68% / 48% / 46% / 85% |
| 4 · Large | Llama 4 Maverick | **+1.35 [+1.00, +1.69]** / **+1.17 [+0.83, +1.51]** / **−0.43 [−0.69, −0.18]** | 25% / 40% / 36% / 21% | 82% / 71% / 67% / 90% |
| 4 · Large | Gemini 2.5 Flash | +0.13 [−0.16, +0.43] / +0.24 [−0.05, +0.55] / **−0.45 [−0.70, −0.18]** | 14% / 16% / 18% / 8% | 84% / 76% / 73% / 91% |

### 5.4 Error detection (AUC: telling right from wrong answers)

| Round | Judge | Urdu script | Roman Urdu | Code-mixed | English |
|---|---|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | 0.68 | 0.60 | 0.59 | 0.76 |
| 1 · Small | Llama 3.1 8B ⚑ | 0.57 | 0.54 | 0.53 | 0.67 |
| 1 · Small | Gemma 3 12B | 0.74 | 0.64 | 0.63 | 0.83 |
| 2 · Replication | Qwen 3.5 9B ⚑ | 0.67 | 0.60 | 0.59 | 0.78 |
| 2 · Replication | Llama 3.1 8B ⚑ | 0.56 | 0.51 | 0.52 | 0.68 |
| 2 · Replication | Gemma 3 12B | 0.73 | 0.64 | 0.63 | 0.83 |
| 3 · Medium | Qwen3 32B | 0.76 | 0.67 | 0.66 | 0.88 |
| 3 · Medium | Llama 3.3 70B | 0.81 | 0.66 | 0.66 | 0.91 |
| 3 · Medium | Gemma 3 27B | 0.74 | 0.67 | 0.67 | 0.79 |
| 4 · Large | Qwen3 235B | 0.81 | 0.68 | 0.67 | 0.93 |
| 4 · Large | Llama 4 Maverick | 0.81 | 0.66 | 0.67 | 0.89 |
| 4 · Large | Gemini 2.5 Flash | 0.87 | 0.81 | 0.79 | 0.92 |

### 5.5 Head-to-head (pairwise) vs. Urdu script

Win rate of the version against the identical Urdu-script answer, both orders (fair = 50%); W/L/T = wins, losses, ties; first pick = share of decided replies that chose the answer shown first.

| Round | Judge | Roman Urdu | Code-mixed | English | First pick | Unreadable |
|---|---|---|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | **14% [12%–15%] (82/954/164)** | **12% [11%–14%] (66/971/163)** | **62% [60%–64%] (569/278/353)** | 59% | 0.0% |
| 1 · Small | Llama 3.1 8B ⚑ | **40% [37%–42%] (338/563/217)** | **40% [38%–43%] (345/561/208)** | 51% [48%–53%] (559/542/74) | 75% | 5.4% |
| 1 · Small | Gemma 3 12B | **40% [38%–41%] (10/261/928)** | **37% [36%–38%] (14/325/860)** | **61% [59%–62%] (332/80/787)** | 48% | 0.1% |
| 2 · Replication | Qwen 3.5 9B ⚑ | **8% [7%–9%] (28/1040/132)** | **8% [7%–9%] (33/1040/127)** | **63% [61%–65%] (554/242/404)** | 47% | 0.0% |
| 2 · Replication | Llama 3.1 8B ⚑ | **34% [31%–37%] (303/657/139)** | **35% [32%–37%] (307/647/144)** | **60% [57%–63%] (694/450/42)** | 63% | 6.0% |
| 2 · Replication | Gemma 3 12B | **39% [38%–41%] (12/266/922)** | **37% [35%–38%] (20/342/838)** | **61% [60%–63%] (351/76/773)** | 48% | 0.0% |
| 3 · Medium | Qwen3 32B | **25% [23%–26%] (72/679/449)** | **23% [21%–25%] (89/740/371)** | **62% [60%–65%] (568/270/362)** | 74% | 0.0% |
| 3 · Medium | Llama 3.3 70B | **17% [15%–19%] (119/890/145)** | **15% [13%–17%] (118/930/115)** | 51% [48%–53%] (524/511/64) | 64% | 5.1% |
| 3 · Medium | Gemma 3 27B | **37% [35%–40%] (227/527/435)** | **37% [34%–39%] (250/568/364)** | **63% [61%–64%] (332/29/831)** | 19% | 1.0% |
| 4 · Large | Qwen3 235B | **24% [22%–25%] (56/686/458)** | **22% [21%–24%] (62/722/416)** | **61% [59%–62%] (306/47/847)** | 22% | 0.0% |
| 4 · Large | Llama 4 Maverick ‡ | **49% [48%–50%] (18/43/1137)** | **48% [47%–49%] (22/71/1106)** | **51% [50%–51%] (40/21/1129)** | 48% | 0.4% |
| 4 · Large | Gemini 2.5 Flash | **48% [47%–48%] (1/54/1143)** | **47% [46%–48%] (0/71/1127)** | **55% [54%–56%] (160/34/1006)** | 54% | 0.1% |

‡ Llama 4 Maverick: re-run (run #42) with a longer pairwise reply limit; see §11.

### 5.6 Comprehension (the judge answers the question itself)

| Round | Judge | Urdu script | Roman Urdu | Code-mixed | English | Roman − Urdu |
|---|---|---|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | 76% | 57% | 58% | 92% | −19 pts |
| 1 · Small | Llama 3.1 8B ⚑ | 48% | 33% | 36% | 69% | −15 pts |
| 1 · Small | Gemma 3 12B | 82% | 67% | 69% | 91% | −15 pts |
| 2 · Replication | Qwen 3.5 9B ⚑ | 79% | 59% | 58% | 93% | −21 pts |
| 2 · Replication | Llama 3.1 8B ⚑ | 49% | 36% | 36% | 73% | −13 pts |
| 2 · Replication | Gemma 3 12B | 83% | 69% | 67% | 91% | −14 pts |
| 3 · Medium | Qwen3 32B | 83% | 66% | 67% | 94% | −18 pts |
| 3 · Medium | Llama 3.3 70B | 88% | 73% | 73% | 94% | −15 pts |
| 3 · Medium | Gemma 3 27B | 86% | 71% | 69% | 93% | −15 pts |
| 4 · Large | Qwen3 235B | 90% | 76% | 78% | 95% | −14 pts |
| 4 · Large | Llama 4 Maverick | 85% | 66% | 67% | 93% | −19 pts |
| 4 · Large | Gemini 2.5 Flash | 91% | 86% | 87% | 96% | −5 pts |

### 5.7 Does the penalty remain when the judge understood the question?

Score gap on correct answers, restricted to questions the judge answered correctly in **both** Urdu script and the other version (n = number of such questions).

| Round | Judge | Roman Urdu | Code-mixed |
|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | **−0.84 [−1.23, −0.43]** (n=159) | **−0.86 [−1.29, −0.46]** (n=162) |
| 1 · Small | Llama 3.1 8B ⚑ | −0.42 [−0.93, +0.14] (n=71) | **−0.55 [−1.05, −0.09]** (n=74) |
| 1 · Small | Gemma 3 12B | **−0.60 [−1.01, −0.20]** (n=184) | **−0.87 [−1.33, −0.45]** (n=188) |
| 2 · Replication | Qwen 3.5 9B ⚑ | **−0.91 [−1.37, −0.44]** (n=164) | **−1.15 [−1.65, −0.64]** (n=168) |
| 2 · Replication | Llama 3.1 8B ⚑ | **−0.83 [−1.31, −0.31]** (n=75) | **−0.63 [−1.08, −0.15]** (n=78) |
| 2 · Replication | Gemma 3 12B | **−0.83 [−1.24, −0.39]** (n=191) | **−0.95 [−1.37, −0.49]** (n=186) |
| 3 · Medium | Qwen3 32B | **−0.78 [−1.08, −0.48]** (n=184) | **−0.88 [−1.18, −0.58]** (n=188) |
| 3 · Medium | Llama 3.3 70B | **−0.68 [−1.02, −0.37]** (n=209) | **−0.71 [−1.03, −0.36]** (n=205) |
| 3 · Medium | Gemma 3 27B | **−0.70 [−1.07, −0.27]** (n=208) | **−0.77 [−1.17, −0.34]** (n=201) |
| 4 · Large | Qwen3 235B | **−1.35 [−1.72, −1.04]** (n=220) | **−1.49 [−1.85, −1.19]** (n=227) |
| 4 · Large | Llama 4 Maverick | **−0.66 [−0.97, −0.34]** (n=185) | **−0.90 [−1.24, −0.55]** (n=188) |
| 4 · Large | Gemini 2.5 Flash | **−0.57 [−0.92, −0.27]** (n=252) | **−0.74 [−1.10, −0.39]** (n=253) |

### 5.8 Consistency (identical score when asked again; 50 questions × 3)

| Round | Judge | Urdu script | Roman Urdu | Code-mixed | English |
|---|---|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | 46% | 50% | 45% | 69% |
| 1 · Small | Llama 3.1 8B ⚑ | 45% | 36% | 32% | 56% |
| 1 · Small | Gemma 3 12B | 77% | 76% | 67% | 79% |
| 2 · Replication | Qwen 3.5 9B ⚑ | 49% | 47% | 52% | 69% |
| 2 · Replication | Llama 3.1 8B ⚑ | 47% | 39% | 40% | 32% |
| 2 · Replication | Gemma 3 12B | 77% | 80% | 72% | 78% |
| 3 · Medium | Qwen3 32B | 61% | 63% | 61% | 75% |
| 3 · Medium | Llama 3.3 70B | 85% | 90% | 87% | 84% |
| 3 · Medium | Gemma 3 27B | 66% | 57% | 58% | 69% |
| 4 · Large | Qwen3 235B | 75% | 71% | 74% | 79% |
| 4 · Large | Llama 4 Maverick | 93% | 90% | 93% | 95% |
| 4 · Large | Gemini 2.5 Flash | 96% | 98% | 97% | 98% |

### 5.9 Mitigations

Roman Urdu score gap on correct answers, error detection in Roman Urdu, and wrong answers accepted in Roman Urdu, without and with each fix.

| Round | Judge | Gap: no fix | Gap: rubric | Gap: transliterate | AUC Roman: none / rubric / translit | Wrong accepted, Roman: none / rubric / translit |
|---|---|---|---|---|---|---|
| 1 · Small | Qwen 3.5 9B | **−0.81 [−1.16, −0.47]** | −0.39 [−0.80, +0.02] | +0.07 [−0.22, +0.39] | 0.60 / 0.58 / 0.68 | 41% / 59% / 41% |
| 1 · Small | Llama 3.1 8B ⚑ | −0.12 [−0.39, +0.15] | **+0.42 [+0.18, +0.68]** | **−0.31 [−0.57, −0.06]** | 0.54 / 0.53 / 0.52 | 71% / 92% / 75% |
| 1 · Small | Gemma 3 12B | **−0.59 [−0.95, −0.24]** | −0.32 [−0.74, +0.11] | −0.27 [−0.62, +0.05] | 0.64 / 0.62 / 0.72 | 51% / 61% / 39% |
| 2 · Replication | Qwen 3.5 9B ⚑ | **−1.13 [−1.54, −0.68]** | −0.29 [−0.75, +0.16] | −0.20 [−0.55, +0.13] | 0.60 / 0.58 / 0.67 | 44% / 59% / 42% |
| 2 · Replication | Llama 3.1 8B ⚑ | −0.29 [−0.58, +0.00] | **+0.38 [+0.13, +0.62]** | −0.08 [−0.34, +0.18] | 0.51 / 0.51 / 0.52 | 74% / 94% / 79% |
| 2 · Replication | Gemma 3 12B | **−0.82 [−1.21, −0.41]** | −0.24 [−0.63, +0.14] | **−0.47 [−0.80, −0.13]** | 0.64 / 0.63 / 0.71 | 49% / 60% / 38% |
| 3 · Medium | Qwen3 32B | **−0.82 [−1.07, −0.57]** | **−0.52 [−0.78, −0.29]** | −0.02 [−0.22, +0.21] | 0.67 / 0.68 / 0.74 | 38% / 50% / 31% |
| 3 · Medium | Llama 3.3 70B | **−0.55 [−0.89, −0.21]** | **−0.53 [−0.86, −0.21]** | **−0.32 [−0.66, −0.05]** | 0.66 / 0.65 / 0.76 | 57% / 67% / 37% |
| 3 · Medium | Gemma 3 27B | **−0.92 [−1.32, −0.53]** | **−0.62 [−1.01, −0.27]** | −0.33 [−0.68, +0.02] | 0.67 / 0.67 / 0.70 | 54% / 61% / 48% |
| 4 · Large | Qwen3 235B | **−1.26 [−1.59, −0.93]** | **−1.03 [−1.34, −0.72]** | **−0.45 [−0.75, −0.18]** | 0.68 / 0.68 / 0.77 | 20% / 24% / 15% |
| 4 · Large | Llama 4 Maverick | **−0.71 [−1.03, −0.42]** | **−0.57 [−0.83, −0.30]** | **−0.43 [−0.71, −0.17]** | 0.66 / 0.65 / 0.75 | 40% / 48% / 31% |
| 4 · Large | Gemini 2.5 Flash | **−0.78 [−1.15, −0.42]** | **−0.74 [−1.08, −0.37]** | **−0.58 [−0.96, −0.19]** | 0.81 / 0.79 / 0.83 | 16% / 23% / 16% |

### 5.10 Prompt length by version (tokens per pointwise prompt)

How many tokens each model's tokenizer needed for the same pointwise prompt in each version (provider-reported).

| Model | Urdu script | Roman Urdu | Code-mixed | English |
|---|---|---|---|---|
| Gemma 3 12B | 271 | 312 | 311 | 199 |
| Gemma 3 27B | 271 | 312 | 311 | 199 |
| Llama 3.1 8B | 472 | 344 | 344 | 196 |
| Llama 3.3 70B | 481 | 351 | 352 | 203 |
| Qwen3 235B | 493 | 350 | 349 | 196 |
| Qwen3 32B | 497 | 354 | 353 | 200 |
| Qwen 3.5 9B | 335 | 338 | 338 | 203 |

Token counts do not line up with the penalty. For the Llama and Qwen3 models, Urdu script needs about 35–40% **more** tokens than Roman Urdu; for Gemma, Roman Urdu needs about 15% more; for Qwen 3.5 9B they are equal. Yet every one of these judges penalises Roman Urdu, so the penalty is not explained by how many pieces the text is split into. (Token counts are not available for Gemini 2.5 Flash and Llama 4 Maverick.)

## 6. Observations

- **Consistent penalty.** Every capable judge, in every round and at every size, scores the same correct answer lower in Roman Urdu (−0.55 to −1.26) and code-mixed text (−0.59 to −1.30) than in Urdu script. English is usually scored *higher* than Urdu script (up to +1.38). The order is English > Urdu script > Roman Urdu ≈ code-mixed.
- **Not just misunderstanding.** On questions the judge answered correctly in both scripts the penalty remains (−0.57 to −1.35 for Roman Urdu among capable judges, all real differences, §5.7). Judges react to how the text looks, not only to what they understood.
- **Bigger is better, but not fairer.** From small to large models, error detection in Urdu script rises (AUC 0.57–0.74 → 0.81–0.87), comprehension improves and consistency climbs (Gemini 2.5 Flash gives the same score on repeat 96–98% of the time) — yet the Roman Urdu score penalty does not shrink, and the large-round panel penalty is the largest.
- **Head-to-head: close to fair for two large judges, biased for Qwen.** Gemini 2.5 Flash (48%) and Llama 4 Maverick (49%) answer TIE in about 95% of comparisons; when they do pick a side they still pick the Urdu-script version. The Qwen family prefers Urdu script strongly at every size (8–25%).
- **Understanding gap.** Most judges answer about 15 points less accurately in Roman Urdu than in Urdu script; Gemini 2.5 Flash closes most of the gap (86% vs 91%), Llama 4 Maverick does not (66% vs 85%).
- **Mistakes slip through.** Wrong answers in Roman Urdu are more often scored ≥ 7 (e.g. Llama 3.3 70B 57% vs 34%, Llama 4 Maverick 40% vs 25%), and error detection (AUC) is lower in Roman Urdu for every judge.
- **Roman Urdu scores are squeezed toward the middle.** Correct Roman Urdu answers are scored lower *and* wrong ones higher than in Urdu script (wrong-answer gap up to +1.77 for Llama 3.3 70B and +1.35 for Llama 4 Maverick, §5.3). The judge separates right from wrong less sharply — which is exactly the lower AUC in Roman Urdu. In English the opposite happens: wrong answers are scored lower.
- **Code-mixing does not help.** Adding English nouns does not rescue Roman Urdu: code-mixed text is penalised as much or slightly more.
- **Position bias exists and both orders matter.** Some judges mostly pick whichever answer is shown first (Llama 3.1 8B 75%, Qwen3 32B 74%), others the second (Gemma 3 27B 19%, Qwen3 235B 22% first). Running every pair in both orders cancels this, so the script preferences in §5.5 are not a position effect.
- **Replicates.** Round 2 (fresh calls) points the same way as round 1, with somewhat larger gaps (Qwen −0.81 → −1.13; Gemma −0.59 → −0.82).
- **Fixes.** Transliterating to Urdu script first is the most effective fix (it removes most of the gap for small/medium models and restores error detection) but leaves a real gap for the large models. The "ignore script" rubric mostly raises leniency (more wrong answers accepted). A panel inherits the shared bias.
- **Screening is noisy near the cut-off.** On only 20 questions, Qwen 3.5 9B passed in round 1 (AUC 0.76) and narrowly failed in round 2 (0.69). Llama 3.1 8B failed both times and is unreliable as a judge.

## 7. Why does this happen?

Most likely explanations, combining published research with our own evidence (well supported, not proven cause-and-effect):

1. **Familiarity bias.** LLM judges give higher scores to text that is more familiar to them (lower perplexity), regardless of content [1]. Clean English and standard Urdu script are common in training data; informal Roman Urdu is not. *Ours:* the order English > Urdu script > Roman Urdu, and the penalty persists when the question was understood (§5.7).
2. **No standard spelling.** One Urdu word can be written many ways in Latin letters (up to 20 variants in one study [2]), so each spelling is rare in training data. *Ours:* converting to Urdu script — one standard spelling, same meaning — removes most of the penalty (§5.9).
3. **Low-resource judging is less reliable, and scale does not fix it.** Multilingual LLM judges are inconsistent across languages and worst for low-resource ones; bigger models and multilingual training do not fix this [3]. *Ours:* ~15-point comprehension drop; the penalty does not shrink with size.
4. **It is the script, not the language mix or the token count.** Code-mixed text (Roman Urdu with English nouns) is penalised as much as plain Roman Urdu, and token counts do not line up with the penalty (§5.10), pointing at the informal Latin-script form itself.

## 8. Impact

- **People:** Urdu speakers who type in Roman script get lower automated grades and less reliable feedback when AI grades answers, ranks replies or moderates content.
- **AI systems:** chatbots tuned with AI judges or reward models learn to avoid the way many Urdu speakers write.
- **Research and leaderboards:** LLM-as-a-judge evaluations for South Asian languages may measure script, not quality. The same controlled test applies to Hindi/Hinglish, Arabic/Arabizi, Bengali and other two-script languages.

## 9. Guidelines for others

1. **Test your judge before trusting it**: same content in Urdu script, Roman Urdu and English; if scores differ, it grades the script.
1. **Convert Roman Urdu to Urdu script before judging** — the most effective fix found, and it restores error detection.
1. **Do not rely on "ignore spelling" instructions** — they make judges more lenient, not fairer.
1. **Do not assume a bigger model or a panel fixes it.**
1. **Report results per script**, including Roman Urdu and code-mixed text.
1. **Keep a human in the loop for Roman Urdu**, especially when decisions affect people.
1. **Choose judges by measured fairness, not size** — and check position bias by running both orders.

## 10. Limitations

- One dataset (Belebele) and one task type (reading comprehension); results may differ for open-ended answers.
- Roman Urdu and code-mixed answer options were written by Claude Opus 5.5 and checked automatically, not by humans; passages and questions for those versions are Belebele's Roman Urdu.
- Judges are not fully deterministic at temperature 0, so single questions are noisy; only the 300-question averages should be quoted.
- The 20-question screening gate is noisy near its cut-off.
- Model substitutions for the large tier: Gemini 3.x forced "thinking" (not switchable off on OpenRouter) and Qwen 3.7 Max was rate-limited to a crawl, so Gemini 2.5 Flash and Qwen3 235B were used.
- The explanations in §7 are supported by our data and prior work but are not causal proof.

## 11. Process notes (issues met and how they were handled)

- **Two Roman Urdu versions → one.** Belebele's own Roman Urdu was dropped as an experiment version because it is often reworded; our faithful transliteration is the Roman Urdu condition.
- **Code-mixed coverage** was extended from a 100-item subset to all 300 questions so every question has four versions.
- **Mock judge removed** from the live configuration; it is used only in automated tests.
- **Replication bug caught:** the first replication attempt silently reused cached answers (the API dropped the round label and replicate number). It was stopped at zero cost, the duplicate runs removed, the API fixed and an API-level regression test added.
- **Large-tier model problems:** Gemini 3.8 Flash requires reasoning (refused with reasoning off) → replaced by Gemini 2.5 Flash; Qwen 3.7 Max was rate-limited (HTTP 429) by its only provider → replaced by Qwen3 235B; one Qwen3 235B provider (DeepInfra) returned broken replies → skipped by provider routing; intermittent "user location not supported" refusals from Google AI Studio → retried automatically.
- **Llama 4 Maverick pairwise re-run (run #42):** Maverick reasons step by step before a pairwise verdict; the 8-token limit cut off 86% of its replies, so its first result was unusable. It was re-run with a 1,024-token pairwise limit and a parser that reads the final verdict; 0.4% of replies stayed unreadable. Re-reading all earlier pairwise runs with this parser changed none of their results.
- **Dashboard summaries** are written by a separate model (Claude Sonnet 5.5) from numbers already judged by code; an earlier summary model misstated a result, which led to this design.
- **Cost control:** hard $30 budget cap in the backend, experiment password, per-model request limits, screening and health checks before every large run.

## 12. Reproducibility

- **Code:** `Backend/` (FastAPI, metrics in `app/metrics.py`), `Frontend/` (Next.js dashboard), `experiments/` (drivers for the rounds), `paper/analysis/` (figures, tables and this report).
- **Generated data:** `Backend/generated/opus-5.5-high.json` (Roman Urdu and code-mixed options, CC BY-SA 4.0 like Belebele).
- **Configuration:** `Backend/config.toml` (judges, tiers, budget), prompts in `Backend/prompts/`.
- **Rebuild numbers and this report** from the experiment database:

```sh
python paper/analysis/make_figures.py --paper short_paper --db Backend/data/audit.db   # writes results.json, figures, tables
python paper/analysis/make_report.py                                                  # writes docs/REPORT.md
```

## 13. References

1. Wataoka, Takahashi, Ri. *Self-Preference Bias in LLM-as-a-Judge.* arXiv:2410.21819 (2024). https://arxiv.org/abs/2410.21819
2. *A Clustering Framework for Lexical Normalization of Roman Urdu.* arXiv:2004.00088. https://arxiv.org/abs/2004.00088
3. Fu, Liu. *How Reliable is Multilingual LLM-as-a-Judge?* Findings of EMNLP 2025. https://arxiv.org/abs/2505.12201
4. Bandarkar et al. *The Belebele Benchmark: a Parallel Reading Comprehension Dataset in 122 Language Variants.* ACL 2024.
5. Mohamed et al. *Lost in the Mix* (Urdu–English code-mixing). ACL 2026.
6. Zheng et al. *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* NeurIPS 2023.
