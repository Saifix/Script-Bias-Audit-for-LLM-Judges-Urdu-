// Build the Word version of a paper from its LaTeX source, so the .tex and .docx never drift apart.
//
//   npm install docx@9                      (once)
//   node paper/analysis/make_docx.js paper/short_paper.tex paper/short_paper.docx
//
// Handles the subset of LaTeX used in our papers: sections, subsections, paragraphs, enumerate/itemize,
// \emph/\textbf/\rom, inline math for numbers, \cite (IEEE numbering in order of first citation), \ref,
// figures (uses the .png next to each .pdf), \input of figures/*.tex and tables/*.tex, and references.bib.
"use strict";
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType, WidthType,
  BorderStyle, ShadingType, LevelFormat, HeadingLevel, Footer, PageNumber,
} = require("docx");

const [texPath, outPath] = process.argv.slice(2);
if (!texPath || !outPath) { console.error("usage: node make_docx.js paper.tex out.docx"); process.exit(1); }
const DIR = path.dirname(path.resolve(texPath));
const read = (p) => fs.readFileSync(path.join(DIR, p), "utf8");
const stripComments = (s) => s.replace(/(^|[^\\])%.*$/gm, "$1");
const URDU = "پانچ دیہات"; // the inline Urdu example (the LaTeX version shows it as an image)

// ------------------------------------------------------------------ small LaTeX helpers
function braced(s, start) { // s[start] === "{" -> [content, indexAfterClosingBrace]
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{" && s[i - 1] !== "\\") depth++;
    else if (s[i] === "}" && s[i - 1] !== "\\") { depth--; if (depth === 0) return [s.slice(start + 1, i), i + 1]; }
  }
  throw new Error("unbalanced braces near: " + s.slice(start, start + 60));
}
function command(s, name) { // content of the first \name{...}
  const i = s.indexOf("\\" + name + "{");
  return i < 0 ? null : braced(s, i + name.length + 1)[0];
}

let src = stripComments(read(path.basename(texPath)));
// inline \input of figures/tables so that numbering follows the document order
src = src.replace(/\\input\{(figures\/[^}]+)\}/g, (_, f) => stripComments(read(f.endsWith(".tex") ? f : f + ".tex")));
// blank lines inside an environment (left by removed comments) must not split it into separate blocks
src = src.replace(/\\begin\{(figure\*?|table\*?|enumerate|itemize)\}[\s\S]*?\\end\{\1\}/g, (m) => m.replace(/\n\s*\n/g, "\n"));

// ------------------------------------------------------------------ numbering: sections, figures, tables, citations
const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const labels = {};
{
  let sec = 0, fig = 0, tab = 0, env = null;
  const re = /\\section\*?\{|\\begin\{(figure\*?|table\*?)\}|\\input\{tables\/[^}]+\}|\\label\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("\\section")) { if (!m[0].includes("*")) sec++; env = "sec"; }
    else if (m[1]) { env = m[1].startsWith("figure") ? "fig" : "tab"; if (env === "fig") fig++; else tab++; }
    else if (m[0].startsWith("\\input{tables")) { tab++; labels[(read(m[0].slice(7, -1)).match(/\\label\{([^}]+)\}/) || [])[1]] = roman[tab]; }
    else if (m[2]) labels[m[2]] = env === "fig" ? String(fig) : env === "tab" ? roman[tab] : roman[sec];
  }
}
const citeOrder = [];
for (const m of src.matchAll(/\\cite\{([^}]+)\}/g)) for (const k of m[1].split(",").map((x) => x.trim())) if (!citeOrder.includes(k)) citeOrder.push(k);
const citeNum = (k) => citeOrder.indexOf(k) + 1;
function citeText(keys) { // IEEE style with ranges: [18]–[20]
  const ns = keys.split(",").map((k) => citeNum(k.trim())).sort((a, b) => a - b);
  const parts = []; let i = 0;
  while (i < ns.length) { let j = i; while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    parts.push(j - i >= 2 ? `[${ns[i]}]–[${ns[j]}]` : ns.slice(i, j + 1).map((n) => `[${n}]`).join(", ")); i = j + 1; }
  return parts.join(", ");
}

// ------------------------------------------------------------------ text -> runs
function mathToText(m) {
  return m.replace(/\\geq/g, "≥").replace(/\\leq/g, "≤").replace(/\^\\dagger/g, "†").replace(/\^\\ddagger/g, "‡")
    .replace(/\\boxed\{([^}]*)\}/g, "$1").replace(/\\mathrm\{([^}]*)\}/g, "$1").replace(/\{,\}/g, ",")
    .replace(/\\to/g, "→").replace(/\\approx/g, "≈").replace(/\\times/g, "×").replace(/\\%/g, "%")
    .replace(/-/g, "−").replace(/\{|\}/g, "").replace(/\s+/g, " ").trim()
    .replace(/^([<>=≥≤])/, " $1").replace(/([<>=≥≤])$/, "$1 ").replace(/ ([<>=]) /g, " $1 ");
}
function plain(s) {
  return s
    .replace(/\\raisebox\{[^}]*\}\{\\includegraphics\[[^\]]*\]\{figures\/urdu_example\.pdf\}\}/g, "\u0001")
    .replace(/\\cite\{([^}]+)\}/g, (_, k) => citeText(k))
    .replace(/\\ref\{([^}]+)\}/g, (_, k) => labels[k] || "?")
    .replace(/\$([^$]*)\$/g, (_, m) => mathToText(m))
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/\\(?:small|centering|footnotesize)\b/g, "")
    .replace(/``/g, "“").replace(/''/g, "”").replace(/---/g, "—").replace(/--/g, "–")
    .replace(/\{,\}/g, ",").replace(/\\%/g, "%").replace(/\\\$/g, "$").replace(/\\&/g, "&").replace(/\\_/g, "_")
    .replace(/\\,/g, " ").replace(/\\ /g, " ").replace(/~/g, " ").replace(/\\\\(\[[^\]]*\])?/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, " ").replace(/ {2,}/g, " ");
}
function runs(tex, base = {}) { // -> [TextRun]
  const out = [];
  const s = plain(tex);
  let i = 0, buf = "";
  const flush = () => { if (buf) { pushText(buf, base); buf = ""; } };
  function pushText(t, fmt) {
    const parts = t.split("\u0001");
    parts.forEach((p, k) => {
      if (p) out.push(new TextRun({ text: p, ...fmt }));
      if (k < parts.length - 1) out.push(new TextRun({ text: URDU, rightToLeft: true, font: { ascii: "Times New Roman", cs: "Arial" }, ...fmt }));
    });
  }
  while (i < s.length) {
    const m = s.slice(i).match(/^\\(emph|textit|rom|textbf|textsc|texttt)\{/);
    if (m) {
      flush();
      const [inner, end] = braced(s, i + m[0].length - 1);
      const fmt = { ...base };
      if (["emph", "textit", "rom"].includes(m[1])) fmt.italics = true;
      if (m[1] === "textbf") fmt.bold = true;
      if (m[1] === "texttt") fmt.font = "Consolas";
      out.push(...runs(inner, fmt));
      i = end; continue;
    }
    if (s[i] === "\\" && /[a-zA-Z]/.test(s[i + 1] || "")) { const c = s.slice(i).match(/^\\[a-zA-Z]+\*?/)[0]; i += c.length; continue; }
    if (s[i] === "{" || s[i] === "}") { i++; continue; }
    buf += s[i++];
  }
  flush();
  // tidy leading/trailing spaces
  return out;
}

// ------------------------------------------------------------------ document pieces
const FONT = "Times New Roman";
const PAGE_W = 11906, MARGIN = 1134, TEXT_W = PAGE_W - 2 * MARGIN; // A4, 2 cm margins
const P = (children, opts = {}) => new Paragraph({ children, spacing: { after: 120, line: 264 }, alignment: AlignmentType.JUSTIFIED, ...opts });

function pngSize(file) { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }
function figure(pdfRel, caption, fullWidth) {
  const png = path.join(DIR, pdfRel.replace(/\.pdf$/, ".png"));
  const [w, h] = pngSize(png);
  const widthPx = fullWidth ? 640 : 430;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: fs.readFileSync(png), transformation: { width: widthPx, height: Math.round(widthPx * h / w) } })] }),
    new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 200 }, children: [new TextRun({ text: `Fig. ${caption.num}. `, size: 18 }), ...runs(caption.text, { size: 18 })] }),
  ];
}

function tableFromTex(tex) {
  const caption = command(tex, "caption");
  const label = (tex.match(/\\label\{([^}]+)\}/) || [])[1];
  const body = tex.slice(tex.indexOf("\\toprule") + 8, tex.indexOf("\\bottomrule"));
  const rows = []; let groupStart = false;
  for (const line of body.split("\n")) {
    if (line.includes("\\midrule")) { groupStart = true; continue; }
    if (!line.includes("&")) continue;
    const cells = line.replace(/\\\\\s*$/, "").split(/(?<!\\)&/).map((c) => c.trim());
    rows.push({ cells, groupStart }); groupStart = false;
  }
  const nCols = 13;
  const widths = [1150, 1560, ...Array(11).fill(Math.floor((TEXT_W - 2710) / 11))];
  widths[1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
  const thin = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const tableRows = rows.map((r, ri) => {
    const header = ri < 2;
    let col = 0;
    const cells = r.cells.map((c) => {
      let span = 1, txt = c;
      const mc = c.match(/^\\multicolumn\{(\d+)\}\{[^}]*\}\{(.*)\}$/);
      if (mc) { span = +mc[1]; txt = mc[2]; }
      const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0); col += span;
      return new TableCell({
        columnSpan: span, width: { size: w, type: WidthType.DXA },
        shading: header ? { type: ShadingType.CLEAR, color: "auto", fill: "EEF1F4" } : undefined,
        borders: { top: r.groupStart || ri === 0 ? thin : none, bottom: ri === 1 ? thin : none, left: none, right: none },
        margins: { top: 30, bottom: 30, left: 50, right: 50 },
        children: [new Paragraph({ alignment: col <= 2 && !mc ? AlignmentType.LEFT : AlignmentType.CENTER,
          spacing: { before: 0, after: 0, line: 240 }, run: { size: 15 },
          children: txt ? runs(txt, { size: 15, bold: header ? true : undefined }) : [new TextRun({ text: "", size: 15 })] })],
      });
    });
    return new TableRow({ children: cells, tableHeader: header });
  });
  return [
    new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 160, after: 80 }, keepNext: true,
      children: [new TextRun({ text: `Table ${labels[label]}. `, size: 18, bold: true }), ...runs(caption, { size: 18 })] }),
    new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, rows: tableRows }),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  ];
}

// ------------------------------------------------------------------ references (IEEE style from references.bib)
function bibEntries(bib) {
  const out = {};
  for (const m of bib.matchAll(/@(\w+)\{([^,]+),([\s\S]*?)\n\}/g)) {
    const f = { type: m[1].toLowerCase() };
    for (const fm of m[3].matchAll(/(\w+)\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) f[fm[1].toLowerCase()] = fm[2].replace(/[{}]/g, "").replace(/\\&/g, "&").replace(/--/g, "–");
    out[m[2].trim()] = f;
  }
  return out;
}
function authors(a) {
  const names = a.split(/\s+and\s+/).map((n) => { const [last, first] = n.split(",").map((x) => x.trim()); return first ? `${first} ${last}` : last; });
  if (names[names.length - 1] === "others") return `${names[0]} et al.`;
  return names.length <= 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
}
function refRuns(e) {
  if (e.type === "book")
    return [new TextRun({ text: `${authors(e.author)}, ` }), new TextRun({ text: e.title, italics: true }),
      new TextRun({ text: `. ${e.address ? e.address + ": " : ""}${e.publisher}, ${e.year}.` })];
  const r = [new TextRun({ text: `${authors(e.author)}, “${e.title},” ` })];
  const where = e.booktitle || e.journal;
  if (where) r.push(new TextRun({ text: (e.booktitle ? "in " : ""), }), new TextRun({ text: where, italics: true }));
  const bits = [];
  if (e.volume) bits.push(`vol. ${e.volume}`); if (e.number) bits.push(`no. ${e.number}`);
  if (e.publisher) bits.push(`${e.address ? e.address + ": " : ""}${e.publisher}`);
  bits.push(e.year); if (e.pages) bits.push(`pp. ${e.pages}`);
  if (e.howpublished) bits.unshift(e.howpublished); if (e.note) bits.push(e.note);
  r.push(new TextRun({ text: (where ? ", " : "") + bits.join(", ") + "." }));
  return r.map((t) => t); // TextRuns
}

// ------------------------------------------------------------------ walk the body
const children = [];
const title = command(src, "title").replace(/\\\\/g, "\n").split("\n").map((t) => t.trim());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: title[0], bold: true, size: 34 })] }));
if (title[1]) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: title[1], size: 26 })] }));
const authorBlock = command(src, "author");
const names = plain(command(authorBlock, "IEEEauthorblockN")).replace(/\\;/g, " ").replace(/\s+,/g, ",");
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: names.trim(), size: 22 })] }));
for (const line of command(authorBlock, "IEEEauthorblockA").split("\\\\"))
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: plain(line).trim(), italics: true, size: 20 })] }));
children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));

const abstract = src.slice(src.indexOf("\\begin{abstract}") + 16, src.indexOf("\\end{abstract}"));
children.push(P([new TextRun({ text: "Abstract—", bold: true, italics: true }), ...runs(abstract, { bold: true })]));
const kw = src.slice(src.indexOf("\\begin{IEEEkeywords}") + 20, src.indexOf("\\end{IEEEkeywords}"));
children.push(P([new TextRun({ text: "Index Terms—", bold: true, italics: true }), ...runs(kw, { italics: true })], { spacing: { after: 240 } }));

let body = src.slice(src.indexOf("\\end{IEEEkeywords}") + 18, src.indexOf("\\bibliographystyle"));
let secN = 0, subN = 0, figN = 0;
const blocks = body.split(/\n\s*\n/);
for (let raw of blocks) {
  let b = raw.trim();
  while (b) {
    let m;
    if ((m = b.match(/^\\section(\*?)\{/))) {
      const [t, end] = braced(b, m[0].length - 1);
      if (!m[1]) { secN++; subN = 0; }
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: (m[1] ? "" : roman[secN] + ". ") + plain(t).toUpperCase() })] }));
      b = b.slice(end).replace(/^\s*(\\label\{[^}]*\}\s*)*/, "").trim(); continue;
    }
    if ((m = b.match(/^\\subsection\{/))) {
      const [t, end] = braced(b, m[0].length - 1); subN++;
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${"ABCDEFGH"[subN - 1]}. ${plain(t)}` })] }));
      b = b.slice(end).trim(); continue;
    }
    if ((m = b.match(/^\\begin\{(figure\*?)\}/))) {
      const endTag = `\\end{${m[1]}}`; const env = b.slice(0, b.indexOf(endTag));
      figN++;
      const img = env.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/);
      const pdf = env.includes("tikzpicture") ? "figures/study_design.pdf" : img[1]; // TikZ: pre-rendered study_design.png
      children.push(...figure(pdf, { num: figN, text: command(env, "caption") }, m[1].endsWith("*")));
      b = b.slice(b.indexOf(endTag) + endTag.length).trim(); continue;
    }
    if ((m = b.match(/^\\input\{(tables\/[^}]+)\}/))) {
      children.push(...tableFromTex(stripComments(read(m[1].endsWith(".tex") ? m[1] : m[1] + ".tex"))));
      b = b.slice(m[0].length).trim(); continue;
    }
    if ((m = b.match(/^\\begin\{(enumerate|itemize)\}/))) {
      const endTag = `\\end{${m[1]}}`; const env = b.slice(m[0].length, b.indexOf(endTag));
      for (const item of env.split("\\item").slice(1))
        children.push(new Paragraph({ numbering: { reference: m[1] === "enumerate" ? "nums" : "bullets", level: 0 }, alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 60, line: 264 }, children: runs(item.trim()) }));
      b = b.slice(b.indexOf(endTag) + endTag.length).trim(); continue;
    }
    // ordinary paragraph (up to the next block-level command)
    const next = b.search(/\\(section|subsection|begin\{(figure|enumerate|itemize))|\\input\{tables/);
    const para = next > 0 ? b.slice(0, next) : b;
    const r = runs(para.trim());
    if (r.length) children.push(P(r));
    b = next > 0 ? b.slice(next).trim() : "";
  }
}

// references
const bib = bibEntries(read("references.bib"));
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "REFERENCES" })] }));
citeOrder.forEach((k, i) => {
  if (!bib[k]) throw new Error("missing bib entry " + k);
  children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 60 }, indent: { left: 480, hanging: 480 },
    children: [new TextRun({ text: `[${i + 1}]\t` }), ...refRuns(bib[k])].map((r) => r),
    tabStops: [{ type: "left", position: 480 }], style: "Ref" }));
});

const doc = new Document({
  creator: "Script-Bias Audit group", title: plain(title.join(" ")),
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 21, smallCaps: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 21, italics: true }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 1 } },
      { id: "Ref", name: "Reference", basedOn: "Normal", run: { font: FONT, size: 17 } },
    ],
  },
  numbering: { config: [
    { reference: "nums", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1)", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 480, hanging: 300 } } } }] },
    { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 480, hanging: 300 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
    children,
  }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(outPath, buf); console.log(`wrote ${outPath}: ${citeOrder.length} references, ${figN} figures`); });
