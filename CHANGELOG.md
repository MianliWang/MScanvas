# Changelog

All notable changes will be documented here once versioned releases begin.

## Unreleased

### Added

- Single-file mzML preview workspace. One local `.mzML` file can be opened
  through a Rust-owned opaque handle, and its acquisition metadata, run summary,
  virtualized spectrum table and one selected spectrum read from it. The
  spectrum is drawn as a repository-owned SVG stick plot with no charting
  dependency.
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

- Automatic discovery now finds a ProteoWizard written by the per-user
  installer, and searches a newer release before an older one.
