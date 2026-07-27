# ADR 0005 — Narrow Tauri boundary for the first mzML preview workspace

- Status: Accepted for the first M1–M2 preview slice; later capabilities separately gated
- Date: 2026-07-27

## Context

The M0C work produced typed ProteoWizard preview contracts and a typed mzML
conversion-integrity contract, and ADR 0003 is now accepted for M1–M2 preview
navigation with named limits. Until this slice the desktop application still
showed invented acquisitions, an invented conversion queue and an invented
total ion chromatogram, and exposed a single mock Tauri command.

Turning that into a real product raises one architectural question with lasting
consequences: how much of the ProteoWizard relationship the webview is allowed
to see. Once the frontend can name a command, an argument or a path, or can
read backend text, the security posture built in M0 stops being enforceable
from Rust.

## Decision

The webview may ask exactly four things: whether a backend is installed, to
choose one file, to open that file's preview, and to load one spectrum by
index. Every one of them is typed on both sides.

- **The frontend never parses ProteoWizard output.** All interpretation happens
  in `mscanvas-proteowizard` and reaches the webview as transfer objects.
- **Rust owns the path.** The native picker is invoked through `comdlg32`
  rather than a Tauri dialog plugin, so the webview keeps an empty capability
  set. The chosen path stays in a process-local registry; the frontend holds an
  opaque session handle and a display name.
- **File acceptance is decided in Rust** — extension, canonical resolution, and
  regular-file posture including symlink and reparse-point rejection — so a
  frontend defect cannot widen what the backend will open. It is decided again
  on every use of the handle, not remembered from the picker, because a path
  can be replaced between choosing a file and reading it.
- **Unknown stays unknown in the transfer objects.** Retention times carry an
  explicit unknown unit, an absent chromatogram count stays absent rather than
  becoming zero, and selected-spectrum representation and array units stay
  unreported. A spectrum with no peaks is a spectrum, not a missing result.
- **Diagnostics are bounded and path-free.** Error detail is a stable
  structural identifier rather than backend prose. Metadata lines are redacted
  twice: for the path the user opened, and for any remaining absolute-path
  shape, because an mzML document commonly records the path it was created
  from.
- **The plot is repository-owned SVG.** A stick spectrum, not a connected line,
  and no charting library. Intensities are drawn against a zero line rather
  than a floor, because baseline subtraction produces legitimately negative
  values and dropping them would erase measured signal.
- **Typed backend failures stay distinguished.** A launch failure, a file that
  changed underneath the read and a backend binary that changed after its probe
  reach the user as different states with different retry offers, because the
  crate already knows which happened.

## Consequences

- The one open action resolves the backend and its capabilities once and reuses
  that evidence for metadata, run summary and the spectrum table. Selected
  spectra stay direct and uncached, so the measured cost is the true cost of
  one click, one process.
- A large run is windowed in the table rather than cached or paged, so the
  bounded-preview-cache decision stays open for M2 and is not pre-empted by an
  implementation chosen for a demo.
- Exactly one file is open at a time and choosing another revokes the previous
  handle, so the webview never accumulates a capability over paths the user has
  moved on from. Because Rust holds the path, the frontend also cannot offer
  "recent files", drag-and-drop from Explorer, or multi-file workspaces without
  extending the boundary deliberately. That is the intended cost.
- The run summary and the spectrum list are separate reads. When their spectrum
  counts disagree, both are shown and neither is chosen: MSCanvas has no
  evidence about which reading is right, and refusing the file outright would
  reject an acquisition that may be perfectly valid.
- The preview parser requires the backend's whole output, and this boundary
  reads at most 8 MiB of it — the same named limit M0C accepted for M1–M2. A
  run above it is refused with a plain statement of why, not shown from a
  prefix, because a spectrum list cut mid-file would read as a shorter
  acquisition. Removing that ceiling means a row-bounded or streaming table
  parser in `mscanvas-proteowizard`, which is a separate change.
- Rapid row selection still launches one process per committed selection.
  Repeats of the row already being read are dropped, and the table commits on
  Enter or Space rather than on focus, but an abandoned read runs to
  completion: cancelling it needs real backend cancellation, which ADR 0003
  still lists as an open gate.
- The three operations of one open action read the file separately, and
  combining results from two generations of it would describe an acquisition
  that never existed. The file's length and modification time are therefore
  compared before and after the batch, and a change discards the whole preview.
  The generation that produced a successful open is retained, so a later
  selected-spectrum load is refused when it no longer matches and a spectrum is
  never shown beside metadata that has stopped describing it. A digest would
  close the window completely, but hashing 208 MB around every preview would
  cost more than the preview.
- Path redaction removes everything from the first path marker to the end of
  the line. Where a path ends cannot be decided once it may contain spaces, so
  losing the tail of a line is accepted in exchange for never leaking a
  filesystem path the user did not choose to reveal.
- Timings recorded in the workspace are descriptive observations on the running
  machine. They are not budgets, and no threshold derives from them; that would
  need repeated measurement on a recorded hardware baseline.
- Total ion chromatogram, base peak chromatogram, chromatogram UI, mzXML,
  vendor acquisitions, the conversion workflow, queueing, retry, progress and
  real cancellation remain outside this boundary and separately gated.
