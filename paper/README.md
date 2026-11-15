# Papers

| File | What it is |
|---|---|
| `short_paper.tex` | Short paper (progress report), IEEE two-column LaTeX source |
| `short_paper.pdf` | Compiled short paper (4 pages) |
| `short_paper.docx` | Word version of the short paper, built from the same `.tex` |
| `references.bib` | References for all papers |
| `figures/` | Figures (`.pdf` for LaTeX, `.png` for Word); `study_design.tex` is Fig. 1 (TikZ) |
| `tables/` | Result tables generated from the database (`main_results.tex`, `mitigations.tex`) |
| `analysis/make_figures.py` | Recomputes every number, table and figure from the experiment database |
| `analysis/make_docx.js` | Builds the Word version from a `.tex` file |
| `analysis/results.json` | All numbers used in the papers |

The full paper will be added here as `full_paper.tex` and will reuse `references.bib`, `figures/` and `tables/`.

## Rebuild

```sh
# 1. numbers, tables and figures (uses the backend's own metric code, so they match the website)
pip install numpy matplotlib scipy arabic-reshaper python-bidi
python paper/analysis/make_figures.py --db Backend/data/audit.db

# 2. PDF (or upload the paper/ folder to Overleaf and compile short_paper.tex with pdfLaTeX)
cd paper && pdflatex short_paper && bibtex short_paper && pdflatex short_paper && pdflatex short_paper

# 3. Word version (needs Node.js and the docx package)
npm install docx@9
node paper/analysis/make_docx.js paper/short_paper.tex paper/short_paper.docx
```

`figures/study_design.png` (Fig. 1 in the Word version) is cut from the compiled PDF, so rebuild the PDF first when
Fig. 1 changes.
