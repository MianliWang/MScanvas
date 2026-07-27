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
  frontend defect cannot widen what the backend will open. On Windows all of it
  comes from a single handle opened without following links, so posture, length
  and filesystem identity describe the same object rather than three separate
  looks at a name. It is decided again on every use of the handle, not
  remembered from the picker, because a path can be replaced between choosing a
  file and reading it.
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
  values and dropping them would erase measured signal. Column reduction keeps
  the highest and the lowest value in each column, so a signal of either sign
  survives it.

  The file never says whether its points are profile samples or centroided
  peaks, because the measured formatter emits no such marker. Withholding the
  plot until it does would withhold it always, which is not a viewer. Sticks
  are drawn instead because they are the least-committal rendering available:
  every mark is a measured point and nothing is asserted between points, where
  a connected line would assert exactly that. What the drawing cannot say for
  itself is written beside it — that the representation is unreported, and that
  under reduction a peak spread over several points can appear as one stick.
  Obtaining the marker would need a different backend route, which ADR 0003
  still lists as an open gate.
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
- The spectrum list and a selected spectrum are separate reads too, and the
  crate's `SpectrumIdentity::reconcile` decides whether they agree. A selected
  spectrum whose recognized scan number contradicts the row the user clicked is
  refused rather than shown beside it. Unrecognized identifier forms stay
  opaque and do not conflict, so a legitimate file with an unfamiliar native ID
  is not rejected. The measurements the two readings share — MS level,
  retention time, base peak and total ion current — are compared as well. MS
  level exactly, since an integer cannot be a rounding artefact; the rest with
  a deliberately generous tolerance, because the table prints rounded values
  and exact equality would report a conflict on nearly every real file. The
  comparison exists to catch a different spectrum, not to police rounding.
- Every list the boundary transfers is bounded in count as well as in size —
  spectrum rows, metadata lines and precursors — and each reports the total it
  came from. The 8 MiB output ceiling alone permits a very large number of very
  short records, which would stall a render rather than inform anyone.
- The run summary and the spectrum list are separate reads. When their spectrum
  counts disagree, both are shown and neither is chosen: MSCanvas has no
  evidence about which reading is right, and refusing the file outright would
  reject an acquisition that may be perfectly valid.
- The preview parser requires the backend's whole output, and this boundary
  reads at most 8 MiB of it — the same named limit M0C accepted for M1–M2, and
  now literally the same constant: `mscanvas_proteowizard::MAX_PREVIEW_TEXT_BYTES`.
  It had been written out three times, once per caller, with nothing tying them
  together; a caller reading less than the parser accepts refuses runs the
  parser would have interpreted, and one reading more carries bytes only to have
  them rejected. Process capture is a separate concern and keeps its own limit,
  held above this one by a compile-time assertion rather than by coincidence. A
  run above it is refused with a plain statement of why, not shown from a
  prefix, because a spectrum list cut mid-file would read as a shorter
  acquisition. Removing that ceiling means a row-bounded or streaming table
  parser in `mscanvas-proteowizard`, which is a separate change.
- MSCanvas runs at most one backend process at a time — availability discovery
  included, since running the installed tools' help is as much a process as a
  preview is. A selection that is still waiting for its turn when a newer one
  arrives, or when another file is opened, never starts: the user has moved on
  and the answer would not be looked at. Everything a read depends on is
  established after that wait rather than when the request arrived, so it
  describes the moment the read actually begins. Together with
  committing on Enter or Space rather than on focus, and dropping repeats of
  the row already being read, that bounds what fast navigation costs. What
  remains is that a read already under way runs to completion; stopping it
  needs real backend cancellation, which ADR 0003 still lists as an open gate.
- The three operations of one open action read the file separately, and
  combining results from two generations of it would describe an acquisition
  that never existed. The file's length and modification time are therefore
  compared before and after the batch, and a change discards the whole preview.
  The generation includes the filesystem's own identity for the file, so a
  replacement of the same size at the same recorded time is caught too, and
  every read is compared against the identity the handle was accepted with. The
  generation that produced a successful open is retained as well, so a later
  selected-spectrum load is refused when it no longer matches and a spectrum is
  never shown beside metadata that has stopped describing it. The crate's
  planner captures its own identity at spawn, so a file replaced in the moment
  between validation and launch can still be read; what it cannot do is reach
  the user, because the check after the read rejects it. A digest would
  close the window completely, but hashing 208 MB around every preview would
  cost more than the preview.
- Path redaction removes everything from the first path marker to the end of
  the line. Where a path ends cannot be decided once it may contain spaces, so
  losing the tail of a line is accepted in exchange for never leaking a
  filesystem path the user did not choose to reveal.
- Every preview launches a process and waits for it, and that wait happens on a
  blocking thread rather than on the async runtime — including the wait for the
  modal file picker, which lasts as long as the user takes. Moving the wait is
  not the same as bounding the work, which is why the single-process gate above
  exists as well.
- Timings recorded in the workspace are descriptive observations on the running
  machine. They are not budgets, and no threshold derives from them; that would
  need repeated measurement on a recorded hardware baseline.
- Discovery is automatic and MSCanvas cannot yet be pointed at a particular
  installation, so it does not suggest doing so. The corrective action it does
  offer is the one this version can carry out. `mscanvas-proteowizard`'s own
  discovery-failure text still suggests choosing an installation folder, which
  no UI provides; correcting that belongs with whatever adds the setting.
- Total ion chromatogram, base peak chromatogram, chromatogram UI, mzXML,
  vendor acquisitions, the conversion workflow, queueing, retry, progress and
  real cancellation remain outside this boundary and separately gated.
