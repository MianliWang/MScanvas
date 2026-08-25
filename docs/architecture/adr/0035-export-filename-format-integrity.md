# ADR 0035 — A saved file is named as what it holds

Status: accepted
Date: 2026-08-25
Related: [0029](0029-first-visible-spectrum-figure-and-data-export.md),
[0030](0030-png-copy-plot-and-figure-settings.md),
[0034](0034-chromatogram-export-and-range-scope.md)

## What this ADR is

Every export that opens a native save dialog now refuses a destination whose
extension does not match the document it was asked to write. One rule, across
the selected-spectrum export, the chromatogram export and the conversion
diagnostics export.

It is not a new capability. It is the boundary agreeing to publish only under a
name that describes what it published.

## The dialog is guidance, not an authority

Each save dialog is built from one `SaveDialogFacts`: a title, a filter row, a
filter pattern, and a default extension. The dialog shows the filter and
appends the default extension **when the typed name carries none**.

That is guidance, and it is worth having. It is not an authority, because the
user may type an extension of their own and the dialog hands that back
unchanged. `Export CSV…` with `trace.svg` typed into the name field returns
`trace.svg`, and the writer used to publish CSV bytes under it. Everything
downstream — file associations, a colleague's importer, a script globbing a
folder — reads the extension and is told the wrong thing.

The reachability is ordinary: no race, no replayed command, no stale webview. A
user types a name.

## The writer validates the path it received

The Rust publication boundary is where the decision belongs, because it is the
last place that knows both the format and the final path, and the only place
that cannot be bypassed by a webview.

`SaveDialogFacts::names_this_document(&Path)` answers it, and the writers call
it before anything is opened or created:

| writer | expected extension from |
| --- | --- |
| selected-spectrum export | `claimed.dialog().default_extension` |
| chromatogram export | `claimed.dialog().default_extension` |
| conversion diagnostics export | `DIAGNOSTICS_SAVE_DIALOG.default_extension` |

**One source of truth, and it is the facts the dialog itself was built from.**
There is no second table of extensions to drift from the first: the filter a
user saw and the name this boundary accepts are read from the same value.

## What is compared

The **final** extension of the destination path, case-insensitively.

Accepted for a CSV: `trace.csv`, `trace.CSV`, `trace.CsV`. Windows file
extensions do not distinguish case and these identifiers are ASCII, so a name
that differs only in case is the same name.

Refused: `trace.svg` for a CSV, `trace.csv.txt` (the final extension is `txt`),
`trace.` (an extension that is empty), a path with no extension at all, and a
path whose extension is not valid Unicode. Everything that is not recognisably
the right extension **fails closed** — a file whose name the boundary cannot
read is not one it can promise anything about.

The basename is not inspected or normalised beyond this. What the user calls
their file is theirs.

## Refuse, never rename

A mismatch is refused. The alternative — rewriting `trace.svg` to `trace.csv` —
was considered and rejected for two reasons, either of which is sufficient:

- it publishes under a filename the user did not choose, which is its own kind
  of dishonesty in a boundary whose whole posture is that the artifact says what
  it is;
- it can collide with an existing `trace.csv` the user never mentioned,
  producing a no-overwrite refusal about a file they did not name and cannot
  see the relevance of.

So the answer is to say what would be right and write nothing.

## The refusal

Typed, actionable and path-free:

> Choose a filename ending in .csv for a CSV export.

It names the extension and the document, and nothing about where the user was
working. A refusal is not a place to disclose a path, a parent directory or a
source location.

It is retryable, and it is: the export lane and the diagnostics slot are
released as the refusal returns, so the next export begins normally. That is
asserted rather than assumed — a refused write is followed by a successful one
in the same test.

## No-overwrite is unchanged

Filename validation is an **additional admission condition in front of** the
publication rule, not a replacement for it.

ADR 0029's transaction stands exactly as it was: no `OFN_OVERWRITEPROMPT`, a
private sibling created exclusively, filled, forced to disk and renamed by
handle without replacement, and a name already taken is a refusal rather than a
loss. A correctly named destination that already exists still fails where it
always did, with the answer it always gave.

The two rules compose in one order: is this name a name for this document, and
then, is this name free.

## What is out of scope

**Conversion-generated output names.** A conversion writes files whose names
come from the source acquisition and the conversion's own publication contract;
the user is not naming a document in a save dialog there. Those names obey
their own rules and are untouched by this.

## Evidence

Selected spectrum: `.csv`, `.CSV`, `.CsV`, `.tsv` and `.png` written; CSV as
`.svg` and SVG as `.csv` refused. Chromatogram: the same matrix. Diagnostics:
`.json` and `.JSON` written, `.txt` refused.

Edges: `run.csv.txt`, `run.` and `run` each refused with the correction and no
path in it. A misnamed destination that already holds someone else's file
leaves that file byte-for-byte untouched, and the next correctly named export
succeeds. A correctly named destination that exists still returns the
no-overwrite refusal rather than this one.

**Six mutations**, applied and restored byte-for-byte: removing the check from
the chromatogram, from the selected spectrum and from diagnostics each fails
that writer's cases and only those; accepting every name instead of refusing
fails four; comparing case-sensitively fails the uppercase cases; and validating
the dialog's own default extension rather than the path that came back fails
five — which is the mutation that matters most, because it is the shape the
defect actually had.
