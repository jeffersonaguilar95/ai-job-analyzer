---
description: One-time setup — convert your PDF resume into an editable LaTeX CV under resources/cv/
argument-hint: (no arguments — drop your CV PDF into resources/cv/ first)
---

`matching-service` can score against any PDF directly — no LaTeX required.
But `/tailor-cv`, and any hand-editing of the CV's wording, need a `.tex`
source to work with, not a flat PDF. This command is the one-time bridge:
it transcribes whatever PDF resume you dropped into `resources/cv/` into a
clean, single-column, ATS-friendly LaTeX CV — **faithfully, never inventing
or embellishing anything** — then compiles it back to PDF so the folder
ends up in the same steady state `/tailor-cv` expects: exactly one `.tex`
file and its matching compiled PDF, directly under `resources/cv/`.

Follow these steps in order.

## Step 0: Check what's already there

List the files directly under `resources/cv/` (not recursing into
`resources/cv/tailored/` or `resources/cv/original/`).

- **Already exactly one `.tex` file present?** Your CV is already set up
  for editing — tell the user its path and stop here. (If they explicitly
  want to redo the conversion from a different PDF, tell them to move or
  delete the existing `.tex` first, then re-run this command — don't do
  that for them automatically, it would silently discard any hand edits.)
- **No files at all, or no PDF?** Tell the user to drop a single PDF resume
  into `resources/cv/` first (create the folder if needed), then re-run
  this command. Stop here.
- **More than one PDF and no `.tex`?** Ask the user which one is the CV to
  convert (or ask them to remove the extras) before continuing.
- **Exactly one PDF, no `.tex`?** Continue.

## Step 1: Read and understand the source PDF

Read the PDF with the `Read` tool. Identify the sections it actually
contains — every resume is laid out differently, so don't assume a fixed
list. Common ones: header (name, headline/title, location, phone, email,
LinkedIn, GitHub, portfolio), summary, work experience, education, skills,
languages, certifications, projects, publications. Only carry over sections
that genuinely exist in the source — never add a section (e.g. "Languages")
just because it's common if the source PDF doesn't have one.

**If the source uses a complex multi-column or graphics-heavy layout**
(e.g. a two-column template, icons standing in for labels, tables), text
extraction can scramble reading order. Read carefully section by section;
if anything looks garbled, out of order, or ambiguous, ask the user to
clarify rather than guessing at the intended structure.

## Step 2: Draft the LaTeX CV

Start from this preamble — copy it as-is (it's a generic, already-tuned
template: single column, sans-serif, accent-colored section rules, tight
bullet spacing, clickable links, orphan-header protection via `needspace`).
Only change colors/margins/font size if the user explicitly asks for a
different look later.

```latex
\documentclass[10.5pt]{article}

\usepackage[margin=0.75in]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{helvet}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{parskip}
\usepackage{needspace}

\definecolor{accent}{RGB}{31,111,190}
\definecolor{muted}{RGB}{90,90,90}

\hypersetup{colorlinks=true, urlcolor=accent, linkcolor=accent}
\pagestyle{empty}

\titleformat{\section}{\large\bfseries\color{accent}}{}{0em}{}[{\color{accent}\titlerule}]
\titlespacing{\section}{0pt}{12pt}{6pt}

\newcommand{\jobtitle}[2]{\noindent\textbf{#1 -- \textcolor{accent}{#2}}}
\setlist[itemize]{leftmargin=1.2em, itemsep=2pt, topsep=4pt, parsep=0pt}

\begin{document}

% body goes here

\end{document}
```

Build the body using this shape, adapted to whichever sections Step 1
found:

- **Header** (centered): name in large bold, then the headline/title
  directly under it (only if the source PDF has one — don't invent a
  title), then location/phone on one line and email/LinkedIn/GitHub on the
  next, each link wrapped in `\href`.
- **Section headers** via `\section{...}` (auto-styled by the preamble).
- **Work experience entries**: `\jobtitle{Role}{Company}` followed by an
  italicized, muted-color date/location line, then a tight `\begin{itemize}`
  of achievement bullets carried over from the source — reworded only as
  much as LaTeX escaping requires (escape `&`, `%`, `$`, `#`, `_`, `~`,
  `^`), never rewritten for tone or impact. That's `/tailor-cv`'s job
  later, not this command's.
- **Skills/tech**: grouped by category if the source already groups them,
  otherwise one flat list — don't invent categories the source doesn't
  support.
- Any other section the source has (projects, certifications, publications,
  languages, etc.): same visual pattern — `\section{...}` + content,
  reusing `\jobtitle`/itemize where it fits naturally.

**Never invent, infer, or embellish**: no new employers, dates, titles,
metrics, or skills beyond what's literally in the source PDF. If a detail
is illegible or ambiguous, leave it out and mention it in your final report
instead of guessing.

## Step 3: Grounding pass

Before writing anything to disk, re-read your drafted body against the
source PDF section by section, confirming every fact (employer, dates,
title, bullet, skill) traces back to something actually in the PDF. Fix or
flag anything that doesn't.

## Step 4: Write, archive the original, and compile

1. Derive a filename slug from the candidate's name the same way
   `/tailor-cv` derives slugs (lowercase, non-alphanumeric runs collapsed
   to a single `-`, e.g. "Jane P. Doe" → `cv-jane-p-doe.tex`). Write the
   full document (preamble + body) to `resources/cv/<slug>.tex`.
2. **Do not touch or move the original PDF yet.** If compilation fails or
   `pdflatex` isn't available, the original PDF needs to stay exactly where
   it is — it's still the only PDF `matching-service` and
   `scripts/start.sh` will find, and this command must never leave
   `resources/cv/` without any usable PDF in it.
3. If `pdflatex` is on `PATH`, compile from inside `resources/cv/`, twice
   (the first pass resolves hyperref's outline references):
   ```bash
   cd resources/cv && pdflatex -interaction=nonstopmode -halt-on-error <slug>.tex && pdflatex -interaction=nonstopmode -halt-on-error <slug>.tex
   ```
   - **On success**, you now have two PDFs directly under `resources/cv/`
     (the original, and the freshly compiled one) — that breaks the
     "exactly one PDF" assumption both `scripts/start.sh` and
     `/tailor-cv` rely on. Fix it by moving the *original* aside,
     preserving it rather than deleting it:
     ```bash
     mkdir -p resources/cv/original && mv resources/cv/<original-filename>.pdf resources/cv/original/
     ```
   - **On failure**, leave the original PDF exactly where it is. Show the
     user the LaTeX error, and tell them the `.tex` is saved and ready to
     fix/compile manually once the error's addressed — don't block the
     rest of the report on this.
4. If `pdflatex` isn't on `PATH` at all, say so plainly and point to the
   PDF → LaTeX setup instructions in `README.md` for installing it. Leave
   the original PDF untouched (per point 2) so `matching-service` keeps
   working in the meantime.

## Step 5: Report

Summarize: which sections were transcribed, anything you had to skip or
flag as illegible/ambiguous in Step 1-3 (be explicit — this is the user's
only chance to catch a dropped detail before relying on this file), whether
compilation succeeded, and where the original PDF ended up. Tell the user
to open both PDFs side by side once and confirm nothing got mangled or
reordered in the conversion — text extraction from complex layouts isn't
perfect. Mention that `resources/cv/<slug>.tex` is now the base CV
`/tailor-cv` and any manual edits will work from.
