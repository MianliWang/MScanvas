# ADR 0005 — Narrow Tauri boundary for the first mzML preview workspace

- Status: Accepted for the first M1–M2 preview slice; later capabilities separately gated
- Date: 2026-07-27
- Amended: 2026-07-30 (M1.2) — the command surface. The webview may now ask for a
  native multi-file selection and for path-free changes to the session roster,
  and the single-file picker command is retired rather than kept beside its
  replacement. The paragraph this replaces counted the commands, which is a
  number the boundary was always going to outgrow; what it was protecting — no
  command takes a path, and every one is typed on both sides — is stated
  directly instead. ADR 0006 records the roster itself.
- Amended: 2026-08-07 (M3.1) — the preview boundary now refuses a row whose
  family it cannot read. A dataset admitted as a vendor acquisition answers
  `dataset_not_previewable` rather than reaching a backend that has nothing to
  open. See [ADR 0012](0012-first-visible-thermo-conversion.md); everything
  this ADR says about reading mzML is unchanged.

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

The webview may ask an explicit, enumerated set of application questions: three
about the installed backend — is one there, use the installation in this folder,
go back to finding one automatically — four about the session's workspace — what
does it hold, show a picker and add what is chosen, remove these rows, empty it —
and two about one dataset in it: open its preview, and load one spectrum by
index. Every one of them is typed on both sides, none of them accepts a path,
and none of them accepts a command, an argument list or an executable.

The set is enumerated rather than counted. A number in this document is a fact
about one slice that a later slice quietly falsifies; what has to stay true is
that each command is a named application operation with a typed answer, and that
adding one is a decision recorded here.

`get_bootstrap_status` sits outside that set: it is bootstrap plumbing from
before this boundary existed, has no caller in the product, and is left where it
is rather than removed in a slice that is about something else.

- **The frontend never parses ProteoWizard output.** All interpretation happens
  in `mscanvas-proteowizard` and reaches the webview as transfer objects.
- **Rust owns the path.** The native picker is invoked through `comdlg32`
  rather than a Tauri dialog plugin, so the webview keeps an empty capability
  set. The chosen paths stay in a process-local registry; the frontend holds an
  opaque session handle and a display name. Choosing many files at once is the
  same request as choosing one — `OFN_ALLOWMULTISELECT` beside the flags that
  were already there — and the webview names no path in either direction.
- **Which installation is used can be changed, for the session only.** A user
  whose ProteoWizard sits somewhere no installer would put it had no way to say
  so, and the alternative — widening automatic discovery — would mean executing
  whatever is found in more places. Choosing is narrower: it runs only what the
  user pointed at, and only until the application closes. It is never written
  to disk, because a stored path would go on applying to a folder MSCanvas has
  no way to vouch for, in later sessions, without being asked again.

  The webview names no path in either direction. It asks for a picker, Rust
  shows it, and what comes back is a verdict that states which installation it
  describes. Changing the installation and probing it are a single call, so
  there is no interval in which a verdict about the previous one can be shown
  beside the new one, and every banner state offers the way back — including
  the state where the call itself failed, which is precisely the state that
  cannot say which installation was in use.
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
  the tallest positive and the deepest negative value in each column, so a
  signal of either sign survives it. That is a per-sign rule rather than a
  min/max one -- an all-positive column keeps a single value -- and
  [ADR 0028](0028-figure-renderer-and-semantic-specification.md) names the two
  apart because the difference reaches the reader in words.

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
- A session holds a roster of accepted files and shows one preview at a time.
  Every row is one the user chose, can see and can remove, which is what makes
  holding several of them a capability they granted rather than one that
  accumulated: ADR 0006 records the registry, the duplicate rule and the bound.
  Because Rust holds the paths, the frontend still cannot offer "recent files"
  or drag-and-drop from Explorer without extending the boundary deliberately,
  and folder ingestion is a traversal decision of its own. That is the intended
  cost.
- Reading a dataset is explicit. The roster is navigable for free — focus,
  selection and removal launch nothing — and a preview is started by activating
  one row. Adding files reads at most the first row of a session that had
  nothing in it, so one picker operation is one process rather than one per
  file. That rule lives in the interface; what makes it safe is that Rust
  refuses stale work rather than trusting the interface not to ask.
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
- Discovery is automatic by default and can be pointed at one folder for the
  session. Every corrective action the boundary offers is one this version can
  carry out: `mscanvas-proteowizard`'s own discovery-failure text suggests
  naming an exact `msconvert.exe`/`msaccess.exe` path, which there is still no
  command or picker for, so a chosen folder's failure is reported from a cause
  established here instead — missing, not a directory, unreadable, missing
  either tool or both, a probe failure, or a mismatched pair — and never by
  forwarding the crate's advice.
- Which installation is in use is decided by what actually resolved, not by
  what was requested. The two come apart in both directions: automatic
  discovery falls back to another release when the one in use is removed, and a
  chosen folder's binaries can be upgraded in place. So the identity of the
  resolved `msconvert`/`msaccess` pair is what a preview is stamped with and
  what a later spectrum is checked against.

  That identity is content first. Discovery already hashes each executable
  either side of its help probe, so the digest is free, and it is the only fact
  that cannot survive a replacement: an installer repairing in place can keep
  the path, the filesystem identity, the length, the timestamp and the reported
  version and still write different bytes. Where both sides carry a digest, the
  path and the digest decide alone — a modification time rewritten over
  unchanged bytes, by a backup restore or a timestamp normalisation, is not a
  different backend. The filesystem identity, length and modification time
  decide only where no digest was bound, which is every case where a tool did
  not probe successfully; there nothing better exists, and calling two unprobed
  tools equal on their paths would be the more dangerous mistake.

  It is compared and never displayed: it is not serialisable, its `Debug` is
  opaque, and it is returned beside the transfer objects rather than inside one,
  so no path reaches the webview by being logged or serialised.
- Total ion chromatogram, base peak chromatogram, chromatogram UI, mzXML,
  vendor acquisitions, the conversion workflow, queueing, retry, progress and
  real cancellation remain outside this boundary and separately gated.
