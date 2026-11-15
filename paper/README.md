# Short paper (IEEEtran, two-column)

- `main.tex`, `refs.bib`: the paper. References 1–20 come from the group's literature review.
- `generated/`: tables (`table_main.tex`, `table_mitigation.tex`) and every number used (`numbers.json`).
- `figures/`: vector plots and the Urdu-script example (Urdu is rendered by matplotlib because pdfLaTeX cannot shape Arabic script).
- `analysis/make_results.py`: rebuilds `generated/` and `figures/` from the experiment database, using the backend's own
  metric code, so the numbers match the web platform.

Rebuild the numbers and figures:

    pip install numpy matplotlib scipy arabic-reshaper python-bidi
    python paper/analysis/make_results.py --db data-backup/audit.db

Build the PDF: upload this folder to Overleaf (pdfLaTeX), or locally run
`pdflatex main && bibtex main && pdflatex main && pdflatex main` (or `tectonic main.tex`).
