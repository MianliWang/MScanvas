# ADR 0029 — First visible spectrum figure and data export

- Status: Accepted for M4.1. FIG-003 is implemented for the currently selected
  mzML spectrum at full range; FIG-004 is partially implemented as
  selected-spectrum CSV/TSV only. FIG-001, FIG-002 and FIG-005 through FIG-008
  remain unimplemented
- Date: 2026-08-21

## Context

[ADR 0028](0028-figure-renderer-and-semantic-specification.md) closed the
renderer-selection gate and proved the foundation in private: one semantic
contract, a repository-owned Rust export renderer over it, and no dependency
added. It shipped nothing a user could reach, and said so — *everything visible.
M4.1 is the first slice a user can reach.*

This is that slice. It answers one question: how does the spectrum on screen
become a file, without the file quietly becoming something other than the
measurement?

Two facts about the existing boundary shaped the answer.

`SelectedSpectrumDto` carries at most `MAX_SPECTRUM_POINTS` — 500,000 — of each
array, with a `truncated` flag beside them. That projection exists to get a
*drawing* across an IPC boundary, and the component that receives it says so:
its caption describes what it drew from what it was given. The arrays are a
picture of the measurement, not the measurement.

And the complete `SelectedSpectrumResult` already exists in Rust. The truncation
happens in `selected_spectrum_dto`, on the way out — so at the moment a spectrum
is interpreted, the whole of it is in hand.

## Decision

### Rust retains the full spectrum; the webview receives a name for it

One session slot holds the complete `SelectedSpectrumResult` of the spectrum
whose preview is on screen, behind an `Arc` so the arrays are never copied. The
webview receives an opaque token with that spectrum's panel and nothing else.

**React arrays are not export authority.** An export built from them would write
a file whose length is a property of the transfer bound rather than of the
sample — and it would be wrong *silently*, because the arrays look complete for
every spectrum smaller than the bound. The defect would appear only on the large
spectra a user is most likely to want exported. So the export command names a
spectrum; it never carries one.

The slot holds exactly one snapshot. A newer selection replaces it and the
previous one is dropped. Nothing accumulates, nothing is written to disk, and
nothing survives a restart. This is deliberately not a cache: one current
spectrum is what a visible export of the current spectrum needs.

### The token, and the reservation that consumes it

The token is a session counter rendered as a string. It names nothing outside
the session and is meaningless to anything that did not receive it from the
slot, so a webview holding one has been told which spectrum it may export and
nothing about where that spectrum came from. It crosses as a string rather than
a number because a JSON number is an `f64` on the other side and a token is an
identity rather than a quantity.

An export runs in two phases, the shape the diagnostics export already uses:
`begin_selected_spectrum_export` binds which spectrum and which format and
answers with a reservation; `save_selected_spectrum_export` claims that
reservation, shows the dialog and writes. A document that never receives the
reservation can never open a picker.

**A token is checked, never rebound.** One naming a spectrum this session no
longer holds is refused with `spectrum_export_stale`. Answering it with whatever
is loaded now would write a different measurement than the one the user invoked
the export for, which is the failure this whole design exists to prevent.

**The snapshot is taken at `begin` and carried by the claim.** By the time the
write runs, the user has been standing in a modal dialog and the spectrum on
screen may have been replaced twice over. What is written is the spectrum the
export was invoked for.

**An unclaimed reservation is superseded rather than refused.** Claiming is what
opens a dialog, and a superseded reservation can no longer claim — so two
dialogs remain impossible — while a document that reloaded between the two
commands leaves nothing behind that a later export has to wait for. Refusing on
an unclaimed reservation would let one reload wedge the slot for the rest of the
session. A *claimed* reservation, and a running write, do refuse a second export.

### Selection binding is structural

`PreviewWorkspace` deliberately lets the keyboard move to a vendor row while an
mzML preview stays on screen, so the focused row and the loaded preview are
different things. The export token rides on the loaded spectrum's own panel
data, so focus cannot reach it: there is no code path from the roster's focus to
the export's source. A regression test pins the case — a Shimadzu LCD row
focused while a converted mzML spectrum is exported.

### Full spectrum only

`DataScope::FullSource`, no visible domain, one panel, one measurement series.
M4.1 has no zoom, no pan and no current-range contract, so there is no range to
export other than the whole one. A reduction reaching this figure would mean the
export had stopped being the spectrum the user selected.

### Representation and units stay unreported

`SpectrumRepresentationState` and the preview's `UnitState` each carry exactly
one variant today: `NotEmitted`. The measured selected-spectrum formatter emits
no profile/centroid marker and no array unit, so the figure declares
`SpectrumRepresentation::Unreported` and `UnitState::Unreported` on both axes.

An unreported representation is **not** centroid data and an unreported unit is
**not** a dimensionless one — the third states ADR 0028 kept precisely so this
distinction survives a file boundary. The mapping is written as an exhaustive
`match` with no wildcard arm, so a backend that starts emitting a real
representation or a real unit arrives here as a compile error and is mapped from
that evidence rather than falling into a default that happens to keep building.

### The figure

One `PanelSpec`: kind from the mapping above, axes labelled `m/z` and
`Intensity`, series id `measurement`, title `Spectrum <index>`. The full domain
is derived from the points the figure draws rather than from the backend's
separately reported low and high — those are a second reading of the same
spectrum, and taking them would produce a figure whose axis and whose marks
could describe different things. The value domain always includes zero, because
an unreported representation is drawn as marks measured from the zero line, and
negative intensity is preserved rather than clamped.

An empty spectrum is one `SeriesSpec` carrying zero points, never a panel of no
series — the contract refuses the latter outright, see the blocker closure
below. Nothing in the figure names a path, a workspace handle or a dataset
display name.

The figure size and theme are fixed for M4.1: 1200×640, light. A fixed theme is
**not** FIG-005; that feature is a theme the user chooses, and it arrives with
dimensions and DPI in M4.2.

### Spectrum data schema, version 1

CSV and TSV are the same document with different delimiters: a metadata
preamble, a header row, then exactly one record per source point in source
order.

```text
#format,mscanvas_spectrum_export
#schema_version,1
#spectrum_index,42
#point_count,2
#representation,unreported
#mz_unit,unreported
#intensity_unit,unreported
mz,intensity
100.5,12
100.75,0
```

The preamble uses the same delimiter as the records, so one split rule reads the
whole file, and every preamble line begins with `#` so a reader that wants only
the table can skip them without knowing what they say. The format name and the
version are two fields rather than one compound: a reader that recognises the
format and not the version needs to be able to say so.

An empty spectrum is the same document with `#point_count,0` and no records
after the header. The representation and unit states survive in a file with no
rows — the case a bare two-column table could not describe at all.

**No quoting rule exists, because no field can need one.** Every preamble key is
a fixed ASCII identifier, every preamble value is an integer or a fixed state
word, and every record field is a number. A test asserts over whole documents
that each line carries exactly one delimiter and no quote, rather than trusting
it.

Numbers use Rust's shortest round-tripping form: locale independent, `.` as the
decimal point, no thousands separator, and exactly the `f64` the backend parsed
comes back out of the file — asserted bit-for-bit, including negative zero,
subnormals and `1e300`. Lines end with `\n`, chosen rather than inherited from
the host.

The data document and the figure are **siblings over one source**, not
derivations of each other. The rows are not read out of SVG coordinates and the
figure is not drawn from the rows. A test asserts that both carry the same
points, which is the assertion that would fail if either started reading the
other.

### Saving

Rust owns the path. The webview names no destination and receives none back: a
saved export answers with the format, the file's own name and how many source
points it holds.

Each action writes exactly one file through a native save dialog, parametrised
by title, filter and default extension rather than copied per format — the
`OPENFILENAMEW` flags are the interesting part, and three copies of them would
be three places for the no-overwrite posture to be relaxed in. The dialog
deliberately carries no `OFN_OVERWRITEPROMPT`, because this boundary will not
replace a file and a prompt implying otherwise would weaken the product rule in
the one place a user is looking.

The chosen folder goes through the same admission a conversion destination does,
and the bytes go through `write_new_local_file`: a private sibling created
exclusively, filled, forced to disk, then renamed by handle without replacement.
A name already taken is a refusal, not a loss. A failure anywhere removes the
sibling through the handle that made it, and reports separately when it could
not — "this could not be saved" and "this could not be saved and there is now a
file in your folder MSCanvas cannot remove" are different things to be told.

**Cancellation is an outcome, not an error.** A dismissed dialog resolves to
`cancelled`: nothing was created, nothing was written, and the spectrum on
screen is exactly as it was. Every other refusal is typed and path-free —
`spectrum_export_in_progress`, `spectrum_export_stale`,
`spectrum_export_refused`, `spectrum_picker_unavailable`,
`spectrum_destination_exists`, `spectrum_destination_unusable`,
`spectrum_not_written`, `spectrum_not_finalized`. No raw OS error or backend
stderr reaches the interface.

Exporting a spectrum is not selecting one: no preview is reloaded, adopted or
changed by it, and the source mzML is never touched.

### The complete-source boundary

A visible export claims "full selected spectrum" only where Rust holds a
complete `SelectedSpectrumResult`. That result is produced by the existing
selected-spectrum interpretation, which is already bounded by the backend
capture limits this boundary has always enforced. M4.1 removes no bound and
raises none: where the existing interpretation cannot produce a complete result,
the selection itself fails through its own typed path and no export is offered,
because an export is offered only for a spectrum that loaded. No prefix is ever
written, no partial CSV is produced, and no reduced figure is called full
source.

## M4.1-BLOCKER-A closure — negative disclosure matches the drawing

The negative count read source signs, so a discrete mark whose projection
collapses onto the baseline was reported as "shown below the zero line" while
being drawn *on* it. Against `-1e20 .. 0` a measured `-1` projects to exactly
`zero_y`, and the same `<desc>` then carried both that sentence and the
drawable-resolution sentence saying the mark is on the line without a height.

The count now asks the shared `draws_without_length` predicate the drawing
itself uses, so the two cannot drift apart again, and skips exactly the marks
the drawable-resolution sentence already reports. Nothing is lost: the
measurement stays negative and stays disclosed, by the sentence that can place
it truthfully. A joined series keeps its own semantics and is not asked the
question — its samples are vertices of a line rather than marks measured from
the baseline.

Fixing only the export would have been worse than fixing neither. `StickSpectrum`
draws the same measurement on screen, writes its coordinates to two decimals,
and its caption said the deepest negative in each column is drawn below the zero
line whatever the numbers were. A reader comparing the panel against the file
they had just exported would have been told two different things about one
spectrum. So the screen caption now asks its own drawing the same question, and
through the same rounding the path is written with rather than a second copy of
it. Both surfaces are right on their own terms; neither consumes the other's
type, and that remains deliberate.

## M4.1-BLOCKER-B closure — a panel declares at least one series

`PanelSpec` accepted an empty series vector, and the description then printed
`Series: .` with no sentence explaining the blank plotting area, leaving a
reader unable to tell a deliberately empty figure from a renderer that had
failed. It is refused with a typed `SpecError::PanelHasNoSeries`, which covers
the constructor, `FigureSpec::validate`, standalone `PanelSpec` decoding and
`FigureSpec` JSON decoding at once, because all four route through
`PanelSpec::validate`.

That is deliberately not a rule about empty measurements. A spectrum that
genuinely holds no peaks stays representable as one series carrying zero points,
and a test asserts that beside the refusal so the two can never be collapsed
into one rule. No existing construction or fixture used a zero-series panel.

## Consequences and limitations

- **FIG-003** is implemented for the currently selected mzML spectrum at full
  range, and for nothing else.
- **FIG-004** is partially implemented: selected-spectrum CSV/TSV only.
  Chromatogram data export does not exist.
- **FIG-001** (copy screenshot), **FIG-002** (PNG) and **FIG-006** through
  **FIG-008** remain unimplemented. PNG is M4.2, with `resvg` already surveyed
  in ADR 0028 and still unadded.
- **FIG-005** is not implemented as a user-selectable figure theme. M4.1 writes
  a fixed light figure.
- There is no chromatogram export, no TIC, no BPC, no XIC, no current-range
  export, no zoom or pan, no linked figure, no saved `FigureSpec` and no
  composer.
- The screen renderer still does not consume `FigureSpec`. The screen and the
  export agree by both being right rather than by sharing a type; wiring them
  together is a change to a shipped component's behaviour and is not this
  milestone.
- The native save dialog is Windows-only in this version, as every other picker
  in this boundary is. Elsewhere the export answers `file_picker_unavailable`.
- Real native-dialog paths cannot be driven by the automated suite, and on the
  machine this milestone was built on they were not driven at all. The selector
  question is settled -- `pnpm e2e:native-dialog` finds a save dialog of the same
  family by title and cancels it through the platform's own stable automation id
  -- but the application's own export path never reaches one here: without a
  ProteoWizard installation and an mzML file there is no loaded spectrum, so Rust
  holds no snapshot and refuses the token before a dialog could open. The
  complete path from a loaded spectrum through the export command to a saved
  file is therefore **untested**, and it is recorded as an environmental
  residual in `e2e/native/README.md`, alongside the selector evidence, rather
  than claimed.
