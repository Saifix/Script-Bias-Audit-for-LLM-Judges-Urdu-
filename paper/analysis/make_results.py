"""Recompute every number, table and figure in the short paper from the experiment database.

Uses the backend's own metric code (Backend/app/metrics.py), so numbers match the web platform exactly.

    pip install numpy matplotlib scipy arabic-reshaper python-bidi
    python paper/analysis/make_results.py --db data-backup/audit.db

Writes paper/generated/numbers.json, paper/generated/*.tex (tables) and paper/figures/*.pdf.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Backend"))
from app.metrics import auc, bootstrap_ci, paired_gap, summarize  # noqa: E402

PAPER = ROOT / "paper"
GEN, FIG = PAPER / "generated", PAPER / "figures"
SEED, B, THRESH = 13, 1000, 7

# Runs per round (IDs in audit.db). Keys: screening, comprehension, pointwise, pairwise, repeats, rubric, translit, panel.
# Pairwise runs that replace a judge's original pairwise run: run #37 cut Llama 4 Maverick off at 8 tokens
# (86% unreadable); run #42 re-ran it with pairwise_max_tokens = 1024 and the final-verdict parser.
PAIRWISE_RERUN = {"large": {"meta-llama/llama-4-maverick": 42}}
ROUNDS = {
    "small": dict(name="Small", tier="Small (8--12B)", screening=1, comprehension=2, pointwise=3, pairwise=4, repeats=5, rubric=6, translit=7, panel=8),
    "replication": dict(name="Replication", tier="Small (repeat)", screening=12, comprehension=13, pointwise=14, pairwise=15, repeats=16, rubric=17, translit=18, panel=19),
    "medium": dict(name="Medium", tier="Medium (27--70B)", screening=20, comprehension=21, pointwise=22, pairwise=23, repeats=24, rubric=25, translit=26, panel=27),
    "large": dict(name="Large", tier="Large", screening=34, comprehension=35, pointwise=36, pairwise=37, repeats=38, rubric=39, translit=40, panel=41),
}
NAMES = {
    "qwen/qwen3.5-9b": "Qwen 3.5 9B", "meta-llama/llama-3.1-8b-instruct": "Llama 3.1 8B", "google/gemma-3-12b-it": "Gemma 3 12B",
    "qwen/qwen3-32b": "Qwen3 32B", "meta-llama/llama-3.3-70b-instruct": "Llama 3.3 70B", "google/gemma-3-27b-it": "Gemma 3 27B",
    "qwen/qwen3-235b-a22b-2507": "Qwen3 235B", "meta-llama/llama-4-maverick": "Llama 4 Maverick", "google/gemini-2.5-flash": "Gemini 2.5 Flash",
}
FAMILY = {j: ("Qwen" if j.startswith("qwen") else "Llama" if j.startswith("meta") else "Google") for j in NAMES}
JUDGE_ORDER = list(NAMES)
CONDS = ["urdu_script", "roman_translit", "code_mixed", "english"]


def rows_of(conn, run_id: int) -> list[dict]:
    cur = conn.cursor()
    cur.row_factory = sqlite3.Row
    return [dict(r) for r in cur.execute("SELECT * FROM results WHERE run_id=?", (run_id,))]


def get(lst: list[dict], cond: str) -> dict | None:
    return next((x for x in lst if x["condition"] == cond), None)


def screening(conn, run_id: int) -> dict[str, dict]:
    s = summarize(rows_of(conn, run_id), threshold=THRESH, n_resamples=0, seed=SEED)
    out = {}
    for j, r in s["judges"].items():
        aucs = {p["condition"]: p["auc"] for p in r["pointwise"]}
        out[j] = {"auc": aucs, "pass": all(v is not None and v > 0.7 for v in aucs.values())}
    return out


def understood_gap(point_rows: list[dict], comp_rows: list[dict], judge: str, cond: str) -> dict:
    """Score gap on correct answers, restricted to items the judge answered correctly in BOTH scripts."""
    ok = defaultdict(dict)
    for r in comp_rows:
        if r["judge"] == judge and r["repeat"] == 0 and r["value"] is not None:
            ok[r["item_id"]][r["condition"]] = r["label"] == "correct"
    keep = {i for i, d in ok.items() if d.get("urdu_script") and d.get(cond)}
    sc = lambda c: {r["item_id"]: r["value"] for r in point_rows if r["judge"] == judge and r["repeat"] == 0
                    and r["answer"] == "correct" and r["condition"] == c and r["value"] is not None and r["item_id"] in keep}
    return paired_gap(sc("urdu_script"), sc(cond), B, SEED)


def tokens_per_condition(conn) -> dict:
    """Mean prompt tokens of fresh (uncached) comprehension calls, per judge x condition: tokenizer cost of each script."""
    out = defaultdict(dict)
    q = ("SELECT judge, condition, AVG(prompt_tokens), COUNT(*) FROM results WHERE kind='comprehension' "
         "AND cached=0 AND prompt_tokens>0 GROUP BY judge, condition")
    for j, c, t, n in conn.execute(q):
        out[j][c] = {"tokens": t, "n": n}
    return out


def dataset_stats(conn) -> dict:
    items = conn.execute("SELECT id, correct_idx, urd_arab, urd_latn, eng_latn FROM items").fetchall()
    gen = {(i, c): json.loads(o) for i, c, o in conn.execute("SELECT item_id, condition, options FROM generated")}
    words = defaultdict(list)
    changed_belebele = 0
    for iid, ci, ua, ul, en in items:
        ua, ul, en = json.loads(ua), json.loads(ul), json.loads(en)
        words["passage_urdu_script"].append(len(ua["passage"].split()))
        words["passage_english"].append(len(en["passage"].split()))
        for k, opts in (("urdu_script", ua["options"]), ("english", en["options"]),
                        ("roman_translit", gen[(iid, "roman_translit")]), ("code_mixed", gen[(iid, "code_mixed")])):
            words["answer_" + k] += [len(o.split()) for o in opts]
        # Belebele's own Roman Urdu answer differs in word count from the Urdu-script answer = reworded, not transliterated
        changed_belebele += sum(len(a.split()) != len(b.split()) for a, b in zip(ua["options"], ul["options"]))
    ours_changed = sum(len(a.split()) != len(b.split()) for iid, ci, ua, *_ in items
                       for a, b in zip(json.loads(ua)["options"], gen[(iid, "roman_translit")]))
    return {"n_items": len(items), "n_options": 4 * len(items),
            "mean_words": {k: float(np.mean(v)) for k, v in words.items()},
            "belebele_roman_wordcount_mismatch": changed_belebele, "ours_wordcount_mismatch": ours_changed}


def analyse(conn) -> dict:
    out: dict = {"rounds": {}}
    for key, R in ROUNDS.items():
        rd: dict = {"name": R["name"], "judges": {}}
        scr = screening(conn, R["screening"])
        p_rows, c_rows = rows_of(conn, R["pointwise"]), rows_of(conn, R["comprehension"])
        P = summarize(p_rows, threshold=THRESH, n_resamples=B, seed=SEED)["judges"]
        PW = summarize(rows_of(conn, R["pairwise"]), threshold=THRESH, n_resamples=B, seed=SEED)["judges"]
        rerun = {j: rid for j, rid in PAIRWISE_RERUN.get(key, {}).items()
                 if conn.execute("SELECT status FROM runs WHERE id=?", (rid,)).fetchone() == ("done",)}
        for j, rid in rerun.items():
            PW[j] = summarize(rows_of(conn, rid), threshold=THRESH, n_resamples=B, seed=SEED)["judges"][j]
        C = summarize(c_rows, threshold=THRESH, n_resamples=0, seed=SEED)["judges"]
        REP = summarize(rows_of(conn, R["repeats"]), threshold=THRESH, n_resamples=0, seed=SEED)["judges"]
        RUB = summarize(rows_of(conn, R["rubric"]), threshold=THRESH, n_resamples=B, seed=SEED)["judges"]
        TR = summarize(rows_of(conn, R["translit"]), threshold=THRESH, n_resamples=B, seed=SEED)["judges"]
        PAN = summarize(rows_of(conn, R["panel"]), threshold=THRESH, n_resamples=B, seed=SEED, panel=True)["judges"]
        pw_raw = [r for r in rows_of(conn, R["pairwise"]) if r["judge"] not in rerun]
        for j, rid in rerun.items():
            pw_raw += [r for r in rows_of(conn, rid) if r["judge"] == j]
        for j in [j for j in JUDGE_ORDER if j in P]:
            pt = {x["condition"]: x for x in P[j]["pointwise"]}
            jd = {
                "name": NAMES[j], "family": FAMILY[j], "screening": scr.get(j),
                "gap": {c: pt[c]["gap_correct"] for c in CONDS[1:]},
                "gap_wrong": {c: pt[c]["gap_wrong"] for c in CONDS[1:]},
                "mean_correct": {c: pt[c]["mean_correct"] for c in CONDS},
                "auc": {c: pt[c]["auc"] for c in CONDS},
                "accept_correct": {c: pt[c]["accept_correct"] for c in CONDS},
                "accept_wrong": {c: pt[c]["accept_wrong"] for c in CONDS},
                "unparseable_point": sum(pt[c]["unparseable"] for c in CONDS),
                "pairwise": {x["condition"]: {k: x[k] for k in ("win_rate", "lo", "hi", "n", "wins", "losses", "ties", "unparseable")}
                             for x in PW[j]["pairwise"]},
                "comprehension": {x["condition"]: x["accuracy"] for x in C[j]["comprehension"]},
                "consistency": {x["condition"]: {"share_identical": x["share_identical"], "mean_variance": x["mean_variance"]}
                                for x in REP[j]["consistency"]},
                "understood_gap": {c: understood_gap(p_rows, c_rows, j, c) for c in ("roman_translit", "code_mixed")},
            }
            # Position bias in pairwise: share of decided (non-tie) verdicts that pick the first-shown answer.
            dec = [r for r in pw_raw if r["judge"] == j and r["label"] in ("A", "B")]
            jd["pairwise_first_pick"] = (sum(r["label"] == "A" for r in dec) / len(dec)) if dec else None
            tot = [r for r in pw_raw if r["judge"] == j]
            jd["pairwise_unparseable_share"] = sum(r["status"] == "unparseable" for r in tot) / len(tot)
            jd["pairwise_rerun"] = rerun.get(j)
            if j in rerun:  # keep the original run's numbers for the paper's "before" description
                old = [r for r in rows_of(conn, R["pairwise"]) if r["judge"] == j]
                jd["pairwise_original_unparseable_share"] = sum(r["status"] == "unparseable" for r in old) / len(old)
            for tag, S in (("rubric", RUB), ("translit", TR)):
                m = {x["condition"]: x for x in S[j]["pointwise"]}
                jd[tag] = {"gap": {c: m[c]["gap_correct"] for c in CONDS[1:]},
                           "auc": {c: m[c]["auc"] for c in CONDS},
                           "accept_wrong": {c: m[c]["accept_wrong"] for c in CONDS}}
            rd["judges"][j] = jd
        pm = {x["condition"]: x for x in PAN["panel"]["pointwise"]}
        rd["panel"] = {"gap": {c: pm[c]["gap_correct"] for c in CONDS[1:]}, "auc": {c: pm[c]["auc"] for c in CONDS}}
        out["rounds"][key] = rd
    out["tokens"] = tokens_per_condition(conn)
    out["dataset"] = dataset_stats(conn)
    q = "SELECT COUNT(*), ROUND(SUM(cost), 2) FROM cache WHERE model NOT LIKE 'mock/%'"
    out["calls_cached"], out["spend_usd"] = conn.execute(q).fetchone()
    out["results_rows"] = conn.execute("SELECT COUNT(*) FROM results").fetchone()[0]
    out["status_counts"] = {f"{k}:{s}": n for k, s, n in conn.execute("SELECT kind, status, COUNT(*) FROM results GROUP BY 1, 2")}
    out["to_urdu_model"] = conn.execute("SELECT model, COUNT(*) FROM cache WHERE model LIKE 'openai/%' GROUP BY 1").fetchall()
    return out


# ------------------------------------------------------------------ LaTeX tables

def f2(x, ci=None, signed=True):
    """Format a gap; bold when the 95% CI excludes zero."""
    if x is None:
        return "--"
    s = f"{x:+.2f}" if signed else f"{x:.2f}"
    s = s.replace("-", "$-$")
    if ci and ci.get("lo") is not None and (ci["lo"] > 0 or ci["hi"] < 0):
        s = r"\textbf{" + s + "}"
    return s


def pct(x):
    return "--" if x is None else f"{100 * x:.0f}"


def main_table(res: dict) -> str:
    L = [r"\begin{table*}[t]", r"\centering",
         r"\caption{Main results. Score gap: score of the same correct answer minus its score in Urdu script (1--10 scale). "
         r"Win: how often the Roman Urdu version is preferred over the Urdu-script version (ties count as half, 50\% is fair). "
         r"Acc.: comprehension accuracy. AUC: separation of correct and wrong answers. Acc.\,wrong: wrong answers scored 7 or more. "
         r"Bold: the 95\% confidence interval excludes 0 (or 50\% for Win). "
         r"$^\dagger$Failed screening (AUC $\leq 0.7$). $^\ddagger$Pairwise re-run with a 1{,}024-token reply limit (Sec.~\ref{sec:challenges}).}",
         r"\label{tab:main}", r"\small", r"\setlength{\tabcolsep}{4pt}",
         r"\begin{tabular}{@{}ll rrr r rrr rr rr@{}}", r"\toprule",
         r" & & \multicolumn{3}{c}{Score gap vs.\ Urdu script} & Win & \multicolumn{3}{c}{Acc.\ (\%)} & \multicolumn{2}{c}{AUC} & \multicolumn{2}{c}{Acc.\,wrong (\%)} \\",
         r"\cmidrule(lr){3-5}\cmidrule(lr){6-6}\cmidrule(lr){7-9}\cmidrule(lr){10-11}\cmidrule(lr){12-13}",
         r"Round & Judge & Roman & Mixed & English & Roman & Urdu & Roman & Eng. & Urdu & Roman & Urdu & Roman \\", r"\midrule"]
    for k, rd in res["rounds"].items():
        first = True
        for j, d in rd["judges"].items():
            g, w = d["gap"], d["pairwise"]["roman_translit"]
            wtxt = pct(w["win_rate"])
            if w["lo"] is not None and (w["lo"] > 0.5 or w["hi"] < 0.5):
                wtxt = r"\textbf{" + wtxt + "}"
            if d["pairwise_unparseable_share"] > 0.25:  # most replies unreadable: head-to-head result inconclusive
                wtxt = "(" + wtxt + ")"
            if d.get("pairwise_rerun"):
                wtxt += r"$^\ddagger$"
            flag = "" if d["screening"]["pass"] else r"$^\dagger$"
            L.append(" & ".join([
                rd["name"] if first else "", d["name"] + flag,
                f2(g["roman_translit"]["gap"], g["roman_translit"]), f2(g["code_mixed"]["gap"], g["code_mixed"]),
                f2(g["english"]["gap"], g["english"]), wtxt,
                pct(d["comprehension"]["urdu_script"]), pct(d["comprehension"]["roman_translit"]), pct(d["comprehension"]["english"]),
                f"{d['auc']['urdu_script']:.2f}", f"{d['auc']['roman_translit']:.2f}",
                pct(d["accept_wrong"]["urdu_script"]), pct(d["accept_wrong"]["roman_translit"]),
            ]) + r" \\")
            first = False
        pg = rd["panel"]["gap"]
        L.append(" & ".join(["", r"\emph{Panel (mean)}", f2(pg["roman_translit"]["gap"], pg["roman_translit"]),
                             f2(pg["code_mixed"]["gap"], pg["code_mixed"]), f2(pg["english"]["gap"], pg["english"]),
                             "", "", "", "", f"{rd['panel']['auc']['urdu_script']:.2f}", f"{rd['panel']['auc']['roman_translit']:.2f}", "", ""]) + r" \\")
        if k != "large":
            L.append(r"\midrule")
    L += [r"\bottomrule", r"\end{tabular}", r"\end{table*}"]
    return "\n".join(L)


def mitigation_table(res: dict) -> str:
    L = [r"\begin{table}[t]", r"\centering",
         r"\caption{Mitigations: Roman-Urdu score gap (correct answers) and share of \emph{wrong} Roman-Urdu answers "
         r"accepted (score $\geq 7$). None = no fix; Rubric = ``ignore script, spelling and formality''; Translit.\ = convert to "
         r"Urdu script before judging. \textbf{Bold}: 95\% CI excludes 0. Judges that failed screening omitted.}",
         r"\label{tab:mitig}", r"\small", r"\setlength{\tabcolsep}{3pt}",
         r"\begin{tabular}{@{}l rrr rrr@{}}", r"\toprule",
         r" & \multicolumn{3}{c}{Roman gap} & \multicolumn{3}{c}{Wrong accepted (\%)} \\",
         r"\cmidrule(lr){2-4}\cmidrule(lr){5-7}",
         r"Judge (round) & None & Rubric & Translit. & None & Rubric & Translit. \\", r"\midrule"]
    for k, rd in res["rounds"].items():
        if k == "replication":
            continue
        for j, d in rd["judges"].items():
            if not d["screening"]["pass"]:
                continue
            c = "roman_translit"
            L.append(" & ".join([f"{d['name']} ({rd['name'][0]})",
                                 f2(d["gap"][c]["gap"], d["gap"][c]), f2(d["rubric"]["gap"][c]["gap"], d["rubric"]["gap"][c]),
                                 f2(d["translit"]["gap"][c]["gap"], d["translit"]["gap"][c]),
                                 pct(d["accept_wrong"][c]), pct(d["rubric"]["accept_wrong"][c]), pct(d["translit"]["accept_wrong"][c])]) + r" \\")
    L += [r"\bottomrule", r"\end{tabular}", r"\end{table}"]
    return "\n".join(L)


# ------------------------------------------------------------------ figures

COL = {"roman_translit": "#D55E00", "code_mixed": "#CC79A7", "english": "#0072B2", "urdu_script": "#009E73"}
LAB = {"roman_translit": "Roman Urdu", "code_mixed": "Code-mixed", "english": "English", "urdu_script": "Urdu script"}
FAM_COL = {"Qwen": "#E69F00", "Google": "#0072B2", "Llama": "#7F3C8D"}


def style():
    import matplotlib as mpl
    mpl.rcParams.update({
        "font.family": "serif", "font.serif": ["Times New Roman", "STIXGeneral", "DejaVu Serif"], "mathtext.fontset": "stix",
        "font.size": 8, "axes.titlesize": 8.5, "axes.labelsize": 8, "xtick.labelsize": 7, "ytick.labelsize": 7, "legend.fontsize": 7,
        "axes.spines.top": False, "axes.spines.right": False, "axes.linewidth": 0.6, "xtick.major.width": 0.6, "ytick.major.width": 0.6,
        "axes.grid": True, "grid.color": "#E6E6E6", "grid.linewidth": 0.5, "axes.axisbelow": True,
        "pdf.fonttype": 42, "savefig.bbox": "tight", "savefig.pad_inches": 0.02,
    })


def fig_overview(res: dict):
    """Fig. 2: three views of script bias per judge (score gap, head-to-head, comprehension)."""
    import matplotlib.pyplot as plt
    labels, rows = [], []
    for k, rd in res["rounds"].items():
        for j, d in rd["judges"].items():
            labels.append((rd["name"], d["name"] + ("$^\\dagger$" if not d["screening"]["pass"] else "")
                           + ("$^\\ddagger$" if d.get("pairwise_rerun") else "")))
            rows.append(d)
    n = len(rows)
    y = np.arange(n)[::-1].astype(float)
    # visual gap between rounds
    shift, prev = 0.0, None
    for i, (rname, _) in enumerate(labels):
        if prev is not None and rname != prev:
            shift += 0.8
        y[i] = -(i + shift)
        prev = rname
    fig, axes = plt.subplots(1, 3, figsize=(7.16, 3.35), gridspec_kw={"width_ratios": [1.35, 1, 1]}, sharey=True)
    ax = axes[0]
    for off, c in ((0.22, "english"), (0.0, "roman_translit"), (-0.22, "code_mixed")):
        g = [d["gap"][c] for d in rows]
        x = np.array([v["gap"] for v in g]); lo = np.array([v["lo"] for v in g]); hi = np.array([v["hi"] for v in g])
        ax.errorbar(x, y + off, xerr=[x - lo, hi - x], fmt="o", ms=3.2, color=COL[c], ecolor=COL[c], elinewidth=0.9, capsize=0, label=LAB[c])
    ax.axvline(0, color="#333", lw=0.7)
    ax.set_xlabel("Score gap vs. Urdu script (points, 1–10 scale)")
    ax.set_title("(a) Score of the same correct answer", loc="left")
    ax.set_yticks(y); ax.set_yticklabels([f"{b}" for _, b in labels])
    ax.grid(axis="y", visible=False)
    ax = axes[1]
    for off, c in ((0.22, "english"), (0.0, "roman_translit"), (-0.22, "code_mixed")):
        w = [d["pairwise"][c] for d in rows]
        x = np.array([100 * v["win_rate"] for v in w]); lo = np.array([100 * v["lo"] for v in w]); hi = np.array([100 * v["hi"] for v in w])
        bad = np.array([d["pairwise_unparseable_share"] > 0.25 for d in rows])
        ax.errorbar(x[~bad], (y + off)[~bad], xerr=[(x - lo)[~bad], (hi - x)[~bad]], fmt="s", ms=3, color=COL[c], ecolor=COL[c], elinewidth=0.9, capsize=0)
        ax.plot(x[bad], (y + off)[bad], "s", ms=3, mfc="white", mec="#AAAAAA", mew=0.8)
    for i, d in enumerate(rows):
        if d["pairwise_unparseable_share"] > 0.25:
            ax.text(99, y[i], f"{100 * d['pairwise_unparseable_share']:.0f}% unreadable", fontsize=6, color="#888", ha="right", va="center")
    ax.axvline(50, color="#333", lw=0.7, ls=(0, (3, 2)))
    ax.text(51, y[0] + 0.75, "fair = 50%", fontsize=6.5, color="#333", va="bottom")
    ax.set_xlim(0, 100); ax.set_xlabel("Preferred over Urdu script head-to-head (%)")
    ax.set_title("(b) Pairwise preference", loc="left"); ax.grid(axis="y", visible=False)
    ax = axes[2]
    for i, d in enumerate(rows):
        a = [100 * d["comprehension"][c] for c in ("roman_translit", "urdu_script", "english")]
        ax.plot([min(a), max(a)], [y[i]] * 2, color="#BBBBBB", lw=1.2, zorder=1)
        for c in ("roman_translit", "code_mixed", "urdu_script", "english"):
            ax.plot(100 * d["comprehension"][c], y[i], "o", ms=3.4, color=COL[c], zorder=2,
                    mfc=COL[c] if c != "code_mixed" else "white", mec=COL[c], mew=0.9)
    ax.set_xlim(25, 100); ax.set_xlabel("Comprehension accuracy (%)")
    ax.set_title("(c) Comprehension accuracy", loc="left"); ax.grid(axis="y", visible=False)
    handles = [plt.Line2D([], [], marker="o", ls="", color=COL[c], mfc=COL[c] if c != "code_mixed" else "white", ms=4, label=LAB[c])
               for c in ("urdu_script", "roman_translit", "code_mixed", "english")]
    fig.legend(handles=handles, loc="upper center", ncol=4, frameon=False, bbox_to_anchor=(0.5, 1.045), handletextpad=0.2, columnspacing=1.6)
    # round labels on the far left
    seen = {}
    for i, (rname, _) in enumerate(labels):
        seen.setdefault(rname, []).append(y[i])
    for rname, ys in seen.items():
        axes[0].annotate(rname, xy=(0, np.mean(ys)), xycoords=("axes fraction", "data"), xytext=(-74, 0), textcoords="offset points",
                         rotation=90, va="center", ha="center", fontsize=7.5, fontweight="bold", color="#444")
        for a in axes:
            a.axhspan(min(ys) - 0.45, max(ys) + 0.45, color="#F5F5F5" if list(seen).index(rname) % 2 else "white", zorder=0, lw=0)
    fig.tight_layout(w_pad=0.6)
    fig.savefig(FIG / "overview.pdf"); plt.close(fig)


def fig_scale(res: dict):
    """Fig. 3: bigger judges are better judges but not fairer scorers."""
    import matplotlib.pyplot as plt
    tiers = ["small", "medium", "large"]
    fams = ["Qwen", "Google", "Llama"]
    fig, axes = plt.subplots(1, 3, figsize=(3.5, 1.75), sharex=True)
    metrics = [("AUC (Urdu script)", lambda d: d["auc"]["urdu_script"], (0.5, 0.92)),
               ("Comprehension gap\nRoman $-$ Urdu (pts)", lambda d: 100 * (d["comprehension"]["roman_translit"] - d["comprehension"]["urdu_script"]), (-22, 0)),
               ("Score gap Roman (pts)", lambda d: d["gap"]["roman_translit"]["gap"], (-1.45, 0))]
    for ax, (title, fn, yl) in zip(axes, metrics):
        for fam in fams:
            ys = []
            for t in tiers:
                d = next(d for d in res["rounds"][t]["judges"].values() if d["family"] == fam)
                ys.append(fn(d))
            ax.plot(range(3), ys, "-o", color=FAM_COL[fam], ms=3, lw=1.1, label=fam)
        if "Score" in title:
            pan = [res["rounds"][t]["panel"]["gap"]["roman_translit"]["gap"] for t in tiers]
            ax.plot(range(3), pan, "--", color="#222", lw=1, label="Panel")
            ax.axhline(0, color="#999", lw=0.6)
        ax.set_title(title, fontsize=7)
        ax.set_xticks(range(3)); ax.set_xticklabels(["S", "M", "L"])
        ax.set_ylim(*yl)
    axes[0].set_xlabel(" ")
    axes[1].set_xlabel("Judge size tier")
    fig.legend(*axes[2].get_legend_handles_labels(), loc="lower center", ncol=4, frameon=False, bbox_to_anchor=(0.5, -0.1))
    fig.tight_layout(w_pad=0.4)
    fig.savefig(FIG / "scale.pdf"); plt.close(fig)


def fig_mitigation(res: dict):
    """Fig. 4: Roman gap and wrong-answer acceptance under each mitigation, for judges that passed screening."""
    import matplotlib.pyplot as plt
    js = []
    for k in ("small", "medium", "large"):
        for j, d in res["rounds"][k]["judges"].items():
            if d["screening"]["pass"]:
                js.append((d["name"], d))
    y = np.arange(len(js))[::-1]
    fig, axes = plt.subplots(1, 2, figsize=(3.5, 2.25), sharey=True)
    styles = {"None": ("#D55E00", "o"), "Rubric": ("#999999", "^"), "Transliterate": ("#009E73", "D")}
    c = "roman_translit"
    for ax, getter, xl in (
        (axes[0], lambda d, m: (d if m == "None" else d["rubric" if m == "Rubric" else "translit"])["gap"][c]["gap"], "Roman gap (pts)"),
        (axes[1], lambda d, m: 100 * (d if m == "None" else d["rubric" if m == "Rubric" else "translit"])["accept_wrong"][c], "Wrong Roman accepted (%)"),
    ):
        for i, (n, d) in enumerate(js):
            vals = [getter(d, m) for m in styles]
            ax.plot([min(vals), max(vals)], [y[i]] * 2, color="#DDDDDD", lw=1.4, zorder=1)
            for (m, (col, mk)), v in zip(styles.items(), vals):
                ax.plot(v, y[i], mk, color=col, ms=3.4, zorder=2, label=m if i == 0 else None)
        ax.set_xlabel(xl); ax.grid(axis="y", visible=False)
    axes[0].axvline(0, color="#333", lw=0.7)
    axes[0].set_yticks(y); axes[0].set_yticklabels([n for n, _ in js])
    fig.legend(*axes[0].get_legend_handles_labels(), loc="lower center", ncol=3, frameon=False, bbox_to_anchor=(0.55, -0.06))
    fig.tight_layout(w_pad=0.5)
    fig.savefig(FIG / "mitigation.pdf"); plt.close(fig)


def fig_example(conn):
    """Small image of one answer in four versions (Urdu needs Arabic shaping, which LaTeX/pdflatex cannot do)."""
    import arabic_reshaper
    import matplotlib.pyplot as plt
    from bidi.algorithm import get_display
    iid = "6d56251918"
    ci, ua = conn.execute("SELECT correct_idx, urd_arab FROM items WHERE id=?", (iid,)).fetchone()
    urdu = json.loads(ua)["options"][ci]
    fig = plt.figure(figsize=(1.2, 0.32))
    # Matplotlib >= 3.10 shapes and orders right-to-left text itself (libraqm); older versions need reshaper + bidi.
    import matplotlib
    raqm = tuple(int(x) for x in matplotlib.__version__.split(".")[:2]) >= (3, 10)
    text = urdu if raqm else get_display(arabic_reshaper.reshape(urdu))
    fig.text(0.5, 0.5, text, ha="center", va="center", fontsize=12, family="Tahoma")
    fig.savefig(FIG / "urdu_example.pdf", transparent=True); plt.close(fig)


def main() -> int:
    ap = argparse.ArgumentParser()
    work = ROOT / "Backend" / "data" / "audit.db"  # working copy incl. later runs; falls back to the backup
    ap.add_argument("--db", default=str(work if work.exists() else ROOT / "data-backup" / "audit.db"))
    a = ap.parse_args()
    GEN.mkdir(parents=True, exist_ok=True); FIG.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(a.db)
    res = analyse(conn)
    (GEN / "numbers.json").write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    (GEN / "table_main.tex").write_text(main_table(res), encoding="utf-8")
    (GEN / "table_mitigation.tex").write_text(mitigation_table(res), encoding="utf-8")
    style()
    fig_overview(res); fig_scale(res); fig_mitigation(res); fig_example(conn)
    print("ok:", GEN, FIG)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
