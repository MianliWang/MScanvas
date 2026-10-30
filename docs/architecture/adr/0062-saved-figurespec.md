# ADR 0062 — Saved figure specification (FIG-007)

Status: **Proposed**, 2026-10-30. The Rust side is implemented, with no
interface. The owner asked on 2026-10-30 for every backend item that can be
done now to start in parallel; where this feature needed a decision the owner
has not made, the recommendation below is what was implemented, and each one is
listed under [Open questions](#open-questions).
Related: [0028](0028-figure-renderer-and-semantic-specification.md) (the
renderer and the semantic specification),
[0030](0030-png-copy-plot-and-figure-settings.md) (PNG and figure settings),
[0035](0035-export-filename-format-integrity.md) (export names),
[0036](0036-linked-chromatogram-spectrum-figure.md) (the linked figure),
[0048](0048-stored-targeted-result-reuse-and-export.md) (stored targeted
results), [0053](0053-png-text-metadata.md) (PNG text), and the
[M8.1 project record](../../product/M8_1_FIRST_CLOSED_LOOP.md) (typed locators
and content baselines).

## Context

FIG-007 in [the feature catalog](../../product/FEATURE_CATALOG.md) reads:
*reopening a spec regenerates the same semantic figure from referenced
artifacts.* Every figure MSCanvas exports is one `FigureSpec` built in Rust from
data Rust read, drawn by one deterministic SVG renderer (ADR 0028). Until now
nothing persisted a figure: an export was a file of pixels or vectors, and the
settings that produced it lived for one session.

Two facts shape the answer.

- A `FigureSpec` carries its arrays. ADR 0028 put them there on purpose, so
  serializing one would save a copy of the measurement, not a reference to it.
  A saved figure that carries its own data can be reopened after its source is
  edited or gone, and it then shows data nobody can trace back to a file.
- The figure is already a pure function of a few inputs: the source's spectrum
  table or one spectrum, the resolved range, the visible traces, the size, the
  theme and the user's words. The export builders take exactly those.

## Decisions

### 1. A standalone, versioned JSON document with its own extension

A saved figure is one file, `<name>.msfigure`: UTF-8 JSON, pretty-printed with
`\n` line endings, `format` `mscanvas_saved_figure`, `formatVersion` 1. It is
written once, through the export's own no-overwrite writer
(`scientific_output::write_named`): the destination is admitted, the final
extension must be `msfigure`, and an existing file is never replaced. One
token, because the destination check reads the final extension only
(ADR 0035): `figure.msfigure.json` is a JSON file.

It is not part of a project document in this slice (decision 8).

### 2. It holds a recipe and a reference, never data

| Field | Holds |
| --- | --- |
| `figure.kind` | `spectrum`, `chromatogram` or `linked` |
| `figure.spectrumIndex` | the zero-based spectrum index (spectrum, linked) |
| `figure.mzRange` | `{"scope":"full"}` or `{"scope":"current","low","high"}`, the window Rust resolved (spectrum) |
| `figure.retentionTimeRange` | the same, for the chromatogram (chromatogram, linked) |
| `figure.traces` | `tic` and `bpc`, at least one true (chromatogram, linked) |
| `settings.theme` | `light` or `dark` |
| `settings.size` | `{"unit":"pixels","width","height"}`, or `{"unit":"print","widthMm","heightMm","textPt","linePt","preset"}` |
| `settings.title`, `xAxisTitle`, `yAxisTitle` | the user's words, or `null` for the builder's default |
| `settings.rasterDpi` | the resolution a raster export records (72–1200); it changes no figure |
| `source.locator` | the project document's typed locator: `projectRelative` when the source is under the document's folder, `localAbsolute` otherwise |
| `source.baseline` | the source's `byteLength` and `sha256` when the figure was saved |
| `dataSha256` | the digest of the data the saved figure draws (decision 4) |
| `documentSha256` | the digest of the document's own contents (decision 6) |

Never stored: an array, a panel, a caption, a default title, a point count or
anything else a builder derives. Those are regenerated, so a document cannot
disagree with its source about them.

`preset` is `singleColumn` (85 mm), `doubleColumn` (175 mm) or `custom`. It is
informational, so the interface can show which width was chosen; the
millimetres are what the figure is drawn at, and a preset that names another
width is refused.

Every non-integer number is decimal text in Rust's shortest round-trip
spelling, as the project document stores retention times and plan values: this
build's JSON parser does not have its exact float mode enabled, and a window
read back one unit in the last place away would be a different window.
Integers are JSON numbers.

The locator and the baseline are the project document's own types
(`project::record::Locator`, `ContentBaseline`), validated by its own
`validate_locator` and resolved by its own `resolve`. A relative locator
travels with its folder: the document and its source copied together still
reopen.

### 3. Reopening regenerates, and refuses anything else

In order, and nothing is written anywhere:

1. The document is read with the bounded reader the preference and project
   stores use (`local_document::read_bounded`, 64 KiB, no link followed).
2. It is parsed strictly (decision 6).
3. The locator is resolved against the document's folder.
4. The source is opened for a stable read (the project's `hold_member`: write
   and delete sharing withheld), measured, and **held** while the figure is
   regenerated, so the bytes measured are the bytes read.
5. Its length and SHA-256 must equal the baseline.
6. The figure is regenerated through the export's own builders and nothing
   else: `export::figure_spec`, `chromatogram::figure_spec` or
   `linked_figure_spec`, then `publication_figure` for the size and the words.
   The chromatogram range goes through the export's own resolver, and the
   linked scan is bound by identity (`row_for_spectrum`) and refused outside
   its range, as the linked export does.
7. The digest of the regenerated data must equal `dataSha256`.

A changed or missing source is refused with its reason. It is never
re-rendered from whatever is at the location now, never relinked, and never
replaced with a copy.

| Refusal | Stable identifier |
| --- | --- |
| No file at the document's name | `saved_figure_document_missing` |
| The name holds something that is not a readable file | `saved_figure_document_unreadable` |
| Larger than 64 KiB | `saved_figure_document_too_large` |
| Not JSON, a missing field, a wrong type, or an unknown field | `saved_figure_document_malformed` |
| JSON, and not a saved figure | `saved_figure_not_a_saved_figure` |
| A later `formatVersion` | `saved_figure_newer_version` |
| A version this build never wrote | `saved_figure_unsupported_version` |
| A value outside its bounds | `saved_figure_out_of_bounds` |
| Contents that do not match `documentSha256` | `saved_figure_digest_mismatch` |
| No source at the location | `saved_figure_source_missing` |
| The source is there and no stable read could be made | `saved_figure_source_unavailable` (with the project's reason) |
| The source's bytes are not the recorded ones | `saved_figure_source_changed` |
| The reader or a builder refused | `saved_figure_not_regenerated` (with the reason; a reader's own error is carried unchanged) |
| The same bytes regenerate different data | `saved_figure_figure_changed` |

These are typed refusals in Rust, not boundary error codes yet. The interface
slice maps them to `PreviewErrorDto` codes and gives each its localized words.

### 4. The data digest: the same science, or a refusal

`dataSha256` is SHA-256 over, panel by panel: the panel's kind (for a
spectrum, the representation the file stated) and both axes' unit states; each
series' name, role, scope, sample marks and coordinates (the `f64` bit
patterns); and each marker's position. Every length is written before what it
counts. It is what the figure is *of*; the size, theme, titles and caption
wording are not in it.

The source baseline proves the bytes are the same. This proves the reading is.
A reader or builder that came to read the same bytes differently — other
values, another precision, a representation or a unit it now declares — would
otherwise draw a different figure from an unchanged file and present it as the
saved one. The project-owned mzML reader (PR #175) is such a change: it states
declared representations and units the `msaccess` reading did not. The cost is
that such a document is refused by a later build rather than silently redrawn;
that is the intended trade.

### 5. Saving proves the document before writing it

`save` takes the figure the user is looking at. In order:

1. A destination not named `*.msfigure` is refused before anything is read.
2. The source is held and measured as on reopening; a missing or unreadable
   source is refused with its reason.
3. The locator is made from the source and the document's folder, both
   canonicalized and written as a person writes them: the preview keeps its
   datasets' canonical, verbatim paths (`\\?\C:\...`), a save dialog answers in
   the typed form, and the project's locator rule refuses the verbatim one. A
   source under the folder is relative to it; any other is absolute. A locator
   that does not validate — a network path, or a component that is not an
   ordinary name — is refused (`saved_figure_source_not_referencable`),
   because a document naming one could never be reopened.
4. The figure is regenerated from it and must equal the figure on screen
   (`saved_figure_not_the_shown_figure` otherwise). The retained preview was
   read when it was opened; if the file changed since, the document would
   reopen as a different figure, so it is not written.
5. The document is written through the no-overwrite writer. A name that is
   taken keeps its file and the export's own refusal is answered
   (`spectrum_destination_exists`).

### 6. Version, bounds and integrity

- **Version first.** `format` and `formatVersion` are read leniently before
  anything else, so a newer document is refused as newer rather than as an
  unknown field, which is what a strict read of it would say. Only
  `formatVersion` 1 is read; nothing is migrated.
- **Strict shape.** Every object refuses a field it does not declare, at every
  depth, and every field must be present (`null` where it has no value).
  `{"scope":"full"}` is a struct variant with no fields rather than a unit one,
  because `serde` lets an internally tagged unit variant carry other fields and
  drops them.
- **Bounds.** Titles are figure labels (non-blank, at most 120 characters, no
  control or non-XML character). Pixel sizes, printed sizes, text and line
  sizes, the two-panel height floor and the raster resolution are the export's
  own limits, checked by the same constructors. Ranges are finite and ordered.
  Locators are the project document's. Digests are 64 upper-case hexadecimal
  characters, as the project document writes them.
- **Integrity.** `documentSha256` is SHA-256 over the document's compact
  serialization with that field empty. Any edit to what the document says is
  refused as `saved_figure_digest_mismatch`; reformatting is not an edit. This
  is integrity against a damaged or hand-edited file, **not authenticity**:
  anyone can recompute it.

Bounds are checked before the digest, so a value outside its bounds is reported
as that even in a document whose digest agrees with it.

### 7. The source is read through an injected reader

`FigureSourceReader` has two methods: the source's complete spectrum table, and
one spectrum by index. The interface slice implements it over the preview's own
reader, so a reopened figure is read exactly as a previewed one. That reader is
being replaced by the project-owned mzML reader (ADR 0056, PR #175), so the
production implementation waits for that merge rather than being written twice.

This slice adds no Tauri command, no DTO, no boundary error code, no interface
and no dependency. The module is `preview/saved_figure.rs`, beside the builders
it must call.

### 8. Not inside a project document, in this slice

A project document could hold saved figures later, and the locator and baseline
types are already the project's own so that move needs no new identity scheme.
It is not done here: it would change the project document's schema, and the
restore-workspace feature (WSP-010, ADR 0061) is deciding what a project
reopens in parallel. A standalone file is also what a user can attach to a
manuscript folder.

### 9. Scope: the three preview figures

The selected spectrum (full source or a committed m/z window), the chromatogram
(full run or a committed range, any non-empty trace set) and the linked figure
— each at a pixel or printed size, in either theme, with or without edited
titles.

A stored targeted MS1 result's figure (ADR 0048) is not covered. Its source is
a project payload, not an mzML file, so it needs a locator naming a project
artifact and a target; that belongs with decision 8.

## Alternatives rejected

- **Serialize the `FigureSpec`.** It carries the arrays, so the document would
  be a copy of the data that reopens whatever happened to the source.
- **Re-render a changed source with a warning.** A figure of different data
  under the saved figure's name is the failure this feature exists to prevent.
- **Identity by path, size and modification time.** A copy or a rewrite keeps
  all three; only the content digest says the bytes are the same.
- **Only the source baseline, no data digest.** It cannot see a reader or
  builder change that reads the same bytes differently.
- **JSON numbers for floats.** Not exact with this build's parser (decision 2).
- **A `.json` extension or a double extension.** The destination rule reads the
  final extension, so the document would be indistinguishable from any JSON.
- **Storing the caption, the default title or the point counts.** They are
  derived; storing them lets the document disagree with its source.
- **Ignoring unknown fields.** A misspelled field read as absent changes the
  figure silently (ADR 0028).
- **A signature or a keyed digest.** There is no key to keep; it would claim an
  authenticity a local file cannot have.

## What this does not claim

- **Byte identity across builds.** Within one build, save then reopen gives the
  same `FigureSpec` and the same SVG bytes; the goldens prove it for every
  figure kind. A later renderer may draw the same specification differently, as
  the golden documents were deliberately regenerated for the publication
  figure. The data digest is what stays fixed.
- **Anonymity.** Unlike an exported figure, a saved figure names its source: a
  relative path, or the absolute path of a source outside its folder, and that
  file's digest. Sharing the document shares where the data was.
- **Authenticity.** See decision 6.
- **A production reader.** The tests use a fixed reader over a real file whose
  identity is measured for real; the preview's reader is wired with the
  interface.
- **Thermo RAW viewed through the conversion cache (ADR 0060).** The locator
  names an mzML file. What a saved figure of a cached RAW view should name is
  an open question.

## Consequences

- A figure can be saved as a small recipe and reopened as the same figure, or
  refused with a reason a user can act on.
- The figure builders stay the only authors of a figure; the saved figure adds
  no second one.
- `fixtures/saved-figure-golden/linked-full-run.msfigure` pins the wire shape.
  A change to it is a format change and needs a new `formatVersion` unless old
  documents still read.
- A reader change that alters the data read from a file makes earlier saved
  figures of that file refuse to reopen. Nothing can have been saved before the
  interface exists, which lands after PR #175, so no document from the
  `msaccess` reading era will exist.

## Tests

`apps/desktop/src-tauri/src/preview/saved_figure/tests.rs`, each with a real
source file and a real document in its own temporary folder:

- save then reopen returns the export's `FigureSpec` and the pinned SVG of
  every kind (`fixtures/plot-golden`: spectrum, chromatogram full and current,
  linked); a printed, dark, edited spectrum over an m/z window and a printed
  linked figure reopen byte-identical;
- a changed source (same length and longer) and a missing source are refused;
- the same bytes read as other data are refused; a reader's refusal is carried;
- a relative locator survives moving the folder; an outside source is named
  absolutely; a canonical, verbatim source path is recorded in the typed form,
  relative where it can be; a held source can still be opened and read;
- edits to the theme, the spectrum index, the traces or the digest are refused;
  a newer, older, foreign or non-JSON document is refused as what it is; an
  unknown field at five depths and a missing field are refused; eighteen
  out-of-bounds values are refused even when resealed; an oversized document is
  refused unread;
- a second save to the same name replaces nothing; a misnamed destination is
  refused before the source is read; a figure the source no longer regenerates
  is not saved; the linked export's range and identity rules hold;
- the pinned document is what this build writes, and it reopens.

## Open questions

Each was implemented as recommended; the owner decides.

1. **File and extension.** Recommended: standalone `.msfigure` JSON, written
   once. Alternatives: `.json`, or only inside a project document.
2. **What reopening does with a changed source.** Recommended: refuse with the
   reason, no relink and no redraw. A later relink flow, like the project's,
   would be its own decision.
3. **The data digest** (decision 4). Recommended: keep it, accepting that a
   reader change refuses older documents of the same file.
4. **The document digest** (decision 6). Recommended: keep it, so a hand-edited
   document is refused. The alternative is to accept any document whose values
   are in bounds.
5. **Paths in the document.** Recommended: relative inside the document's
   folder, absolute outside it, stated in the save dialog's help.
6. **Project documents and stored targeted results.** Recommended: not in this
   slice (decisions 8 and 9).
7. **RAW viewed through the cache.** Recommended: the interface refuses to save
   a figure whose source is a cache entry until a locator for one is decided.
