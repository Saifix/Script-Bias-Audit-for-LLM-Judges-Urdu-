# Papers

Each paper has its own folder with everything needed to build it. The scripts and the numbers are shared.

```
paper/
├── analysis/                    shared
│   ├── make_figures.py          recomputes every number, table and figure from the experiment database
│   ├── make_docx.js             builds the Word version of a paper from its .tex file
│   └── results.json             all numbers used in the papers
└── short_paper/                 short paper (progress report)
    ├── short_paper.tex          LaTeX source (IEEE two-column)
    ├── short_paper.pdf          compiled paper, 4 pages
    ├── short_paper.docx         Word version, built from short_paper.tex
    ├── references.bib
    ├── figures/
    │   ├── study_design.tex     Fig. 1 (TikZ); study_design.png is the same figure for Word
    │   ├── results_overview.*   Fig. 2
    │   ├── mitigations.*        Fig. 3
    │   └── urdu_example.pdf     the Urdu-script example in the introduction
    └── tables/
        └── main_results.tex     Table I
```

The full paper will get its own folder (`full_paper/`) in the same way: add an entry for it to `PAPERS` in
`analysis/make_figures.py` and run the steps below with `--paper full_paper`.

## Rebuild the short paper

```sh
# 1. numbers, tables and figures (uses the backend's own metric code, so they match the website)
pip install numpy matplotlib scipy arabic-reshaper python-bidi
python paper/analysis/make_figures.py --paper short_paper --db Backend/data/audit.db

# 2. PDF (or upload paper/short_paper/ to Overleaf and compile short_paper.tex with pdfLaTeX)
cd paper/short_paper && pdflatex short_paper && bibtex short_paper && pdflatex short_paper && pdflatex short_paper

# 3. Word version (needs Node.js and the docx package)
npm install docx@9
node paper/analysis/make_docx.js paper/short_paper/short_paper.tex paper/short_paper/short_paper.docx
```

`figures/study_design.png` is cut from the compiled PDF, so rebuild the PDF first when Fig. 1 changes.
