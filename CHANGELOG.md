# Changelog

All notable changes will be documented here once versioned releases begin.

## Unreleased

### Added

- Session mzML workspace. One or many local `.mzML` files can be chosen in a
  single native picker operation and appear as an ordered list, each held through
  a Rust-owned opaque handle. Adding the same acquisition again reports the row
  you already have; files that could not be read are named individually and leave
  the rest of the batch added. Rows can be selected with the pointer or the
  keyboard, removed, or cleared — none of which changes anything on disk. The
  session holds up to 1,024 files.
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
