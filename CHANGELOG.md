# Changelog

All notable changes will be documented here once versioned releases begin.

## Unreleased

### Added

- The first visible conversion: one focused Thermo Scientific RAW workspace row
  to mzML. `Add files…` now admits that one evidenced vendor family alongside
  `.mzML`, recognizing it by its file signature rather than its name; folder
  ingestion and Explorer drop remain mzML-only. Every roster row says which
  family it is, and a Thermo row cannot be previewed until it is converted.
  Focusing one shows a fixed plan — mzML output, zlib compression, and an
  explicit statement that validation is output-only — with a Fail-or-Skip choice
  and no overwrite. `Convert focused…` opens a Rust-owned picker for a folder on
  this computer; network and mapped locations are refused before anything is
  created. One conversion runs at a time, it cannot be cancelled and says so,
  and it survives a window reload. The result reports the output's name, size
  and record counts without ever naming a location, and the converted file is
  not added to the workspace for you.

- Windows Explorer drag-and-drop for one or many regular `.mzML` files, ordinary
  local folders, or a mixture of both. Direct files use the same acceptance
  boundary as `Add files…`; folders use the same recursive, deterministic and
  link-refusing discovery boundary as `Add mzML folder…`. One ordered drop obeys
  one root limit and shares entry, directory and candidate budgets; traversal
  depth restarts at zero for each folder. It reports incomplete input without
  discarding valid files already found and never starts one backend read per row.
  Native paths remain in Rust, a second active drop is rejected as busy, and
  directory-formatted or vendor acquisitions remain unsupported.
- Session mzML workspace. One or many local `.mzML` files can be chosen in a
  single native picker operation and appear as an ordered list, each held through
  a Rust-owned opaque handle. Adding the same acquisition again reports the row
  you already have; files that could not be read are named individually and leave
  the rest of the batch added. Rows can be selected with the pointer or the
  keyboard, removed, or cleared — none of which changes anything on disk. The
  session holds up to 1,024 files.
- Adding a folder of mzML files. `Add mzML folder…` scans one folder you choose
  and adds every regular `.mzML` file beneath it in a single operation, in a
  deterministic order, without launching any ProteoWizard process. On Windows,
  the Explorer-style folder picker accepts an absolute path pasted into its
  address bar. The scan stays inside the folder you chose: junctions, symbolic
  links, mount points and cloud
  placeholders are never followed, and are counted and reported instead of being
  silently skipped. Four named limits bound how deep, how wide and how far it
  goes, and a scan that reached one of them, refused a linked entry or could not
  read a subtree says so — "no mzML files were found in that folder" is said only
  by a scan that described the whole folder. The list stays usable while it runs;
  a selection you build meanwhile survives the scan and the new rows join it. If
  you picked the wrong folder, `Clear list` stays available even when the list is
  empty; when its command succeeds, the final workspace is empty.
  `Remove selected` also stays available to manage existing rows, but it is not
  cancellation: if the import commits first, its newly discovered rows can
  remain. In either order, a late folder reply cannot overwrite the later
  mutation's authoritative roster; if
  that mutation fails, a fresh roster read reconciles the workspace after both
  operations settle.
- Where a row was found, shown only when two rows in the session share a
  filename, and only for as long as they do. It is a fragment of where the file
  sat under the folder you chose, never an absolute path, never a drive and never
  the folder's own name; it is display only, so it changes neither what a search
  finds nor how the list is sorted, and it does not outlive the session.
- Workspace search and sort. The list can be narrowed by filename and ordered by
  the order files were added, by name in either direction, or by size in either
  direction; names with numbers in them sort the way they read, so `sample-2`
  comes before `sample-10`. A search never hides work in progress: a row you
  selected, the row whose preview is on screen and a row being read stay visible
  and say why. The count says how many files matched rather than how many rows
  are on screen, and a search that finds nothing says so rather than claiming the
  session is empty. Ranges, `Ctrl+A` and the keyboard follow what is on screen.
  None of it reaches the backend, and neither the search nor the sort outlives
  the session.
- Explicit, one-at-a-time reading. Moving around the workspace starts no backend
  work; previewing the focused file reads its acquisition metadata, run summary,
  virtualized spectrum table and, on selecting a row, one spectrum. Choosing ten
  files starts one read, not ten. The spectrum is drawn as a repository-owned SVG
  stick plot with no charting dependency.
- Session-only ProteoWizard installation-folder selection, alongside automatic
  discovery on `PATH` and in the locations an installer writes. The chosen
  folder applies to the current session only, is never written to disk, and
  returning to automatic discovery is offered from every state.
- A private mzML conversion boundary in the ProteoWizard adapter: one immutable
  plan, one staged execution, one no-clobber finalization. A source is opened and
  read as mzML before it becomes one, so a name or an extension is never taken
  for an acquisition. The backend writes into a private staging directory
  MSCanvas creates inside the destination root, and the final name is taken only
  after the produced document passes the integrity contract, by a move that fails
  rather than replaces. A failed, rejected or partial output is discarded, and
  the only way one is left beside the user's files is a cleanup failure, which is
  reported. The conflict policy is fail or skip;
  there is no overwrite to select. Cancellation is deliberately absent while real
  backend cancellation remains unmeasured. Nothing in the application reaches
  this: no command, transfer object, capability or frontend file changed. See
  [ADR 0009](docs/architecture/adr/0009-mzml-conversion-execution-boundary.md).
- Typed mzML conversion-integrity contracts in the ProteoWizard adapter. When the
  source is itself mzML, they compare acquisition facts captured before and after
  a conversion; a source in any other format cannot be captured that way, so no
  source-to-output fidelity claim is made for it. These are library contracts; no
  user-facing conversion workflow is built on them yet.
- Recorded navigation and scale evidence from a representative public
  open-format acquisition, used to accept the preview boundary with named
  limits.
- Initial repository bootstrap.
- Product and engineering source-of-truth proposal.
- React/Tauri application shell and Rust workspace skeleton.
- Product, UX, architecture, Codex and CI scaffolding.
- Canonical private GitHub repository metadata and initialization report.

### Changed

- The single-file picker was replaced by the workspace list. Choosing a file no
  longer discards the one before it; the list is what holds them and removing a
  row is what removes one.
- The mock acquisition list, mock conversion inspector, mock run queue and mock
  total ion chromatogram were removed rather than migrated. Everything the
  application displays now comes from the opened file.
- A preview is attributed to the ProteoWizard installation that actually
  resolved rather than the one that was requested, and a spectrum reconciled
  across an installation change is refused instead of shown beside a table the
  replaced installation produced.
- The 8 MiB preview-text ceiling now has a single authority shared by every
  caller instead of being restated per call site.

### Fixed

- Reading one file twice in quick succession no longer lets the older read
  decide what is on screen. A newer request for a file makes an older one stale,
  and a read the user has moved past says so instead of answering as though it
  were current.
- Automatic discovery now finds a ProteoWizard written by the per-user
  installer, and searches a newer release before an older one.
