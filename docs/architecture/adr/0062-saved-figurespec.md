# ADR 0062 — Saved figure specification (FIG-007)

Status: **Accepted (2026-10-30)**, as implemented, with one change to question
5, recorded under [Owner decision](#owner-decision-2026-10-30). Question 8,
added by a later review, is Proposed. Proposed 2026-10-30. The Rust side is
implemented, with no interface. The owner asked on 2026-10-30 for every
backend item that can be done now to start in parallel; where this feature
needed a decision the owner had not made, the recommendation below is what was
implemented, and each one is listed under [Open questions](#open-questions).
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
   regenerated. The reader is handed that held handle, rewound to its first
   byte for each read, and nothing else (decision 7), so the bytes measured
   are the bytes read.
5. Its length and SHA-256 must equal the baseline.
6. The figure is regenerated through the export's own builders and nothing
   else: `export::figure_spec`, `chromatogram::figure_spec` or
   `linked_figure_spec`, then `publication_figure` for the size and the words.
   The m/z window goes through the export's own spectrum resolver
   (`resolve_spectrum_range`, the rule `SpectrumSnapshot::resolve` applies)
   and the chromatogram range through the export's own resolver, so a window
   the source does not hold is refused rather than clamped or drawn as the
   full source. The linked scan is bound by identity (`row_for_spectrum`) and
   refused outside its range by the linked export's own rule
   (`scan_outside_range`, edges inside). A printed size or edited words go
   through `publication_figure` over the figure built at the default size,
   which is how the export's own tests build one. The export's publication
   path is not wired yet; if it builds the shown figure another way, every
   printed or retitled save is refused as `saved_figure_not_the_shown_figure`
   until the two agree.
7. The digest of the regenerated data must equal `dataSha256`.

A changed or missing source is refused with its reason. It is never
re-rendered from whatever is at the location now, never relinked, and never
replaced with a copy.

Reopened settings belong to the reopened figure. They do not become the
session's export settings: ADR 0030 keeps figure settings as session state, and
a saved figure is a file the user chose, not a restored session. When the
interface lands, ADR 0030 gets a dated note saying so.

| Refusal | Stable identifier |
| --- | --- |
| No file at the document's name | `saved_figure_document_missing` |
| The name holds something that is not a readable file | `saved_figure_document_unreadable` |
| Larger than 64 KiB | `saved_figure_document_too_large` |
| Not JSON, a missing field, a wrong type, or an unknown field (JSON with no `format` or no `formatVersion` among them) | `saved_figure_document_malformed` |
| JSON with a `format` and a `formatVersion`, and another format | `saved_figure_not_a_saved_figure` |
| A later `formatVersion` | `saved_figure_newer_version` |
| A version this build never wrote | `saved_figure_unsupported_version` |
| A value outside its bounds | `saved_figure_out_of_bounds` |
| Contents that do not match `documentSha256` | `saved_figure_digest_mismatch` |
| No source at the location | `saved_figure_source_missing` |
| The source is there and no stable read could be made | `saved_figure_source_unavailable` (with the project's reason) |
| The source's bytes are not the recorded ones | `saved_figure_source_changed` |
| The reader or a builder refused | `saved_figure_not_regenerated` (with the reason; a reader's own error is carried unchanged) |
| The same bytes regenerate different data | `saved_figure_figure_changed` |
| SHA-256 itself was unavailable, reading the document or the figure | `saved_figure_digest_unavailable` |

These are typed refusals in Rust, not boundary error codes yet. The interface
slice maps them to `PreviewErrorDto` codes and gives each its localized words.

### 4. The data digest: the same science, or a refusal

`dataSha256` is SHA-256 over, panel by panel: the panel's kind (for a
spectrum, the representation the file stated) and both axes' unit states; each
series' name, role, scope, sample marks and coordinates (the `f64` bit
patterns); each marker's position; and each interval's ends and role. Every
length is written before what it counts. It is what the figure is *of*; the
size, theme, titles, marker and interval labels and caption wording are not in
it, and neither is any field this list does not name.

The kind, unit states, roles and scopes are written as fixed tokens this module
owns (`spectrum/profile`, `unreported`, `measurement`, `full_source`, ...),
not as the plot specification's serialized form. A change to that wire form, a
`FigureSpec` schema bump such as ADR 0048's, therefore refuses no saved figure;
a new variant of one of those types fails to compile until it is given a token
of its own, and an existing token never changes.

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
   because a document naming one could never be reopened. A mapped network
   drive canonicalizes to a network path (`\\?\UNC\server\share\...`), so a
   source there is saved only relative to a document in the same share and is
   refused when the document is saved anywhere else (question 8). A source
   under the view cache's root (ADR 0060), which every caller passes, is refused
   (`saved_figure_source_in_view_cache`): it is a converted copy under this
   machine's application data that the cache may remove, and a document naming
   it would carry a user's local folder and lose the RAW file it came from.
   The root is compared by whole components after both are canonicalized, and
   a root that does not exist holds nothing.
4. The figure is regenerated from it, through the held handle, and must equal
   the figure on screen
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
  serialization with that field empty. Any edit that leaves the document
  well-formed and in bounds is refused as `saved_figure_digest_mismatch`;
  reformatting is not an edit. This
  is integrity against a damaged or hand-edited file, **not authenticity**:
  anyone can recompute it.

Bounds are checked before the digest, so a value outside its bounds is reported
as that even in a document whose digest agrees with it.

### 7. The source is read through an injected reader

`FigureSourceReader` has two methods: the source's complete spectrum table, and
one spectrum by index. Each is handed the held handle (`&std::fs::File`), at
its first byte, and not a path: a reader cannot open another object by the
name, and nothing between the hold and the read can redirect it. An
implementation reads the figure from that handle and from nothing else — never
from data the session retained, a cache, or the file opened again by its name.
The interface slice implements it over the project-owned mzML reader (ADR 0056,
PR #175), whose `read_spectrum_table_from` and `read_selected_spectrum_from`
take a reader and can be given the handle, so a reopened figure is read exactly
as a previewed one. The production implementation waits for that merge rather
than being written twice.

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
  figure. The data digest is what stays fixed while the reader and the
  builders read the same data from the same bytes (decision 4).
- **Anonymity.** Unlike an exported figure, a saved figure names its source: a
  relative path, or the absolute path of a source outside its folder, and that
  file's digest. Sharing the document shares where the data was.
- **Authenticity.** See decision 6.
- **A production reader.** The tests use a fixed reader over a real file whose
  identity is measured for real; the preview's reader is wired with the
  interface.
- **Thermo RAW viewed through the conversion cache (ADR 0060).** The locator
  names an mzML file, and a source in the view cache is refused on saving.
  What a saved figure of a cached RAW view should name is an open question.
- **Cancellation.** `save` and `reopen` hold and hash the whole source with no
  way to stop them. The interface passes its command's `Cancellation` to both
  when it wires them.

## Consequences

- A figure can be saved as a small recipe and reopened as the same figure, or
  refused with a reason a user can act on.
- The figure builders stay the only authors of a figure; the saved figure adds
  no second one.
- `fixtures/saved-figure-golden/linked-full-run.msfigure` pins the wire shape
  and the two digests. Two kinds of change move it, and they are handled
  differently:
  - **A wire-shape change** (a field, a name, a spelling, the digest's own
    token or framing) is a format change: once the interface has shipped, it
    needs a new `formatVersion` unless old documents still read.
  - **A reader or builder change** that reads the same bytes as other data
    changes only `dataSha256` (and with it `documentSha256`). Old documents
    of that data are refused as `saved_figure_figure_changed`, the trade
    decision 4 accepts, and the version is not raised. The fixture is
    regenerated and this ADR gets a dated note naming the change that moved
    it.
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
  linked figure reopen byte-identical; a linked figure over a current
  retention-time range reopens with its scan inside the range and on each
  edge;
- a changed source (same length and longer) and a missing source are refused;
- the same bytes read as other data are refused; a reader's refusal is carried;
  the reader is handed the held handle at its first byte for each of a linked
  figure's two reads, and reads the measured bytes;
- a relative locator survives moving the folder; an outside source is named
  absolutely; a canonical, verbatim source path is recorded in the typed form,
  relative where it can be; a source on a mapped network drive is named
  relative beside its document and refused as an absolute locator (Windows);
  a source in the view cache is not saved, and one in a folder whose name only
  begins like the cache's is;
- edits to the theme, the spectrum index, the traces or the digest are refused;
  a newer, older, foreign or non-JSON document is refused as what it is; an
  unknown field at five depths and a missing field are refused; eighteen
  out-of-bounds values are refused even when resealed; a resealed m/z window
  wider than the spectrum or reaching past either end is refused through the
  export's resolver; a resealed retention-time range reaching past either end
  of the run is refused for a chromatogram and a linked figure; a truncated
  table regenerates no chromatogram; a reader answering another spectrum than
  the one asked for is refused; an oversized document is refused unread;
- a second save to the same name replaces nothing; a misnamed destination is
  refused before the source is read; a figure the source no longer regenerates
  is not saved; the linked export's range and identity rules hold;
- the pinned document is what this build writes, and it reopens.

## Owner decision, 2026-10-30

**Decision A0062** (`docs/development/OWNER_DECISIONS_V511.md`, PR #186). Shown
the decisions that block work now, the owner replied: "全部按推荐，继续" ("all as
recommended, continue"). For this ADR the recommendation was to confirm all
seven questions as implemented, with one change to question 5.

1. **File and extension:** a standalone `.msfigure` JSON document, written once.
2. **A changed source:** refused with its reason; no relink and no redraw.
3. **The data digest:** kept, accepting that a reader change refuses older
   documents of the same file.
4. **The document digest:** kept, so a hand-edited document is refused.
5. **Paths in the document:** relative inside the document's folder and
   absolute outside it. The save dialog carries no help sentence about this:
   the 2026-10-28 rule removes secondary explanations from the interface
   ([AFTER_BETA1_PLAN section 2](../../development/AFTER_BETA1_PLAN.md#2-owner-decisions-2026-10-28)), so the
   interface shows the recorded locator itself, the relative or absolute path,
   and no help text.
6. **Project documents and stored targeted results:** not in this slice.
7. **RAW viewed through the cache:** `save` refuses a source under the view
   cache's root until a locator for a cached RAW view is decided.

Still open: what a saved figure of a cached RAW view should name (question 7's
alternatives). The decision keeps the refusal until that is decided and does
not choose one.

## Note, 2026-10-30: review round 1, after A0062

A review of PR #180 after the owner's decision changed three things and
recorded three more. None changes an answer above; question 8 is new and not
yet answered.

- The data digest also covers each panel's intervals, their ends and role
  (decision 4). Every figure gains an empty interval count, so the pinned
  document's `dataSha256` and `documentSha256` moved and nothing else did. No
  interface has shipped, so the version stays 1.
- `save` takes the view cache's root as a required path rather than an
  optional one, so a caller cannot skip the refusal (decision 5).
- The refusal table now says which documents are malformed rather than not a
  saved figure: one with no `format` or no `formatVersion` is malformed.
- Recorded, not changed: a source on a mapped network drive (question 8),
  printed regeneration's dependence on the unwired publication path
  (decision 3), and the missing cancellation (What this does not claim).

## Open questions

Questions 1 to 7 were implemented as recommended; the owner's answers are
under [Owner decision](#owner-decision-2026-10-30). Question 8 is Proposed.

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
   folder, absolute outside it.
6. **Project documents and stored targeted results.** Recommended: not in this
   slice (decisions 8 and 9).
7. **RAW viewed through the cache.** Recommended, and implemented in Rust:
   `save` refuses a source under the injected view-cache root
   (`saved_figure_source_in_view_cache`) until a locator for a cached RAW view
   is decided; the interface only shows the refusal. Alternatives: name the
   cache entry anyway, or name the original RAW file and regenerate through
   the cache.
8. **A source on a mapped network drive.** Proposed, as implemented: keep the
   project's locator rule, so such a source is saved relative to a document in
   the same share and refused (`saved_figure_source_not_referencable`) when the
   document is saved elsewhere. Alternatives: refuse every network source
   wherever the document is, or accept a network path as an absolute locator,
   which changes the project document's rule too.
