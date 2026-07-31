# MSCanvas

**A modern open-source workspace for mass spectrometry data.**

MSCanvas aims to be a Windows-first, local-first desktop application for importing mass-spectrometry acquisitions, exploring linked chromatograms and spectra, converting vendor data to open formats, and exporting clean scientific figures. Later releases may orchestrate established analysis packages through typed modules and isolated workers.

> Status: **pre-alpha**. The application has one real end-to-end path: curate a
> session workspace of local `.mzML` files and inspect one of them against a
> user-installed ProteoWizard. It is not yet the batch workspace described under
> [Product scope](#product-scope).

Canonical repository: [`MianliWang/MScanvas`](https://github.com/MianliWang/MScanvas) (currently private).

## What works today

Build a session workspace of local `.mzML` files and inspect one of them:

- ProteoWizard is discovered automatically on `PATH` and in the locations an
  installer writes. If it is installed somewhere else, you can choose its
  installation folder for the current session; that choice is never written to
  disk, and returning to automatic discovery is offered from every state.
- Choose one or many `.mzML` files in a single native picker operation. They
  appear as an ordered list, and adding the same acquisition again — under a
  second name, or by picking it twice — reports the row you already have instead
  of listing it twice. Files that could not be read are named individually and do
  not affect the ones that arrived.
- Select rows with the pointer or the keyboard the way a file list works: click,
  Ctrl-click, Shift-click, arrows, Space, Home, End and Ctrl+A. Remove the
  selected rows, or clear the list, without restarting. Neither ever deletes,
  moves or writes to a file on disk. The session holds up to 1,024 files.
- Narrow the list by filename, and order it by the order files were added, by
  name in either direction, or by size in either direction. Names with numbers in
  them sort the way they read, so `sample-2` comes before `sample-10`. A search
  never hides work in progress: a row you selected, the row whose preview is on
  screen and a row being read stay visible and say why they are still there, and
  the count tells you how many files matched rather than how many rows you can
  see. Ranges and Ctrl+A follow what is on screen. Neither the search nor the
  sort reaches ProteoWizard, and neither outlives the session.
- Rust owns the file paths and decides what may be opened. The interface holds an
  opaque session handle and a display name, never a path, never parses backend
  output, and nothing is uploaded.
- Reading is explicit and one at a time. Moving around the list costs nothing;
  previewing the focused row reads acquisition metadata, a run summary and a
  spectrum table for that one file, and selecting a table row loads that one
  spectrum. Adding files reads at most the first file of a session that had
  nothing in it, so choosing ten files does not start ten reads.
- The spectrum is drawn as a repository-owned SVG stick plot with no charting
  dependency. The retention-time unit, the profile/centroid representation and
  array units are shown as unreported rather than guessed, because the backend
  output this preview reads does not carry them. That says nothing about whether
  the acquisition itself records them.

Not implemented yet: vendor RAW preview; TIC, BPC and chromatogram views; folder
ingestion and Explorer drag-and-drop; filtering the workspace by anything other
than filename, and grouping it; a workspace that outlives the session, which
includes remembering a search or a sort; the conversion workflow with
its queue, progress and cancellation; and figure export. mzXML output stays
disabled and fail-closed until representative multi-source integrity checks pass.
Typed mzML conversion planning and conversion-integrity verification exist in
Rust and are covered by tests, but no user-facing conversion workflow is built on
them yet.

## Product scope

The first usable product is the target below, not a description of today. A
session file workspace exists, built from the file picker rather than from
drag-and-drop or folders. Of the second item, metadata, spectrum and scan-table
exploration are built and TIC/BPC are not; nothing else in this list is built
yet. See [What works today](#what-works-today).

- drag-and-drop file and folder workspaces;
- metadata, TIC/BPC, spectrum and scan-table exploration;
- linked selection across views;
- conversion to mzML through user-installed ProteoWizard, with mzXML gated behind
  representative multi-source integrity checks;
- queue, cancellation, retry and actionable errors;
- PNG/SVG figure export and underlying-data export.

Analysis is deferred rather than prohibited. MSCanvas should reuse mature algorithms from OpenMS/pyOpenMS, matchms and other reviewed packages instead of reimplementing them.

## Repository status

The repository contains:

- a React + TypeScript + Vite desktop interface built around the mzML preview
  workspace;
- a Tauri 2 native host whose main window is granted no Tauri core API
  permissions, so the interface reaches the backend only through this
  application's own typed commands;
- Rust domain, ProteoWizard-adapter and plot-spec crates, where the adapter owns
  discovery, typed argv planning, process supervision, preview parsing and mzML
  conversion-integrity checking;
- product, UX and architecture source documents;
- repo-local Codex guidance and skills;
- frontend, Rust and repository-quality CI workflows.

Committed pnpm and Cargo lockfiles, frozen/locked CI installs and a deterministic
desktop build prerequisite are in place, and `main` is protected by a repository
ruleset requiring the three CI checks and resolved review threads. See
[`BOOTSTRAP_STATUS.md`](BOOTSTRAP_STATUS.md) for the commands actually verified and
the remaining runtime/backend work.

## Development prerequisites

- Node.js 22.13 or newer within the Node 22 release line (`.node-version` pins the
  exact CI runtime);
- pnpm 11.15.1 installed through npm;
- Rust 1.97.1 through rustup;
- Windows 10/11 for the supported desktop target;
- ProteoWizard installed separately. MSCanvas never bundles, downloads or installs
  it, and the mzML preview path does not work without it.

## Getting started

```powershell
npm install --global --no-audit --no-fund pnpm@11.15.1
rustup toolchain install 1.97.1 --component rustfmt clippy
pnpm install --frozen-lockfile
pnpm dev
```

For a fail-closed installation and complete local check pass, run
`pwsh -File .\scripts\bootstrap.ps1` from the repository root.

To launch the Tauri desktop host:

```powershell
pnpm tauri dev
```

Run repository checks:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets
python -B scripts/check_repo.py
```

## Repository map

- [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md) — product and engineering source of truth.
- [`docs/product/FEATURE_CATALOG.md`](docs/product/FEATURE_CATALOG.md) — stable feature IDs and acceptance summaries.
- [`docs/product/PRIMARY_WORKFLOWS.md`](docs/product/PRIMARY_WORKFLOWS.md) — end-to-end user contracts.
- [`docs/ux/UX_PROCESS.md`](docs/ux/UX_PROCESS.md) — task analysis, concepts and usability validation.
- [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) — boundaries and ownership.
- [`ROADMAP.md`](ROADMAP.md) — milestone sequence.
- [`BOOTSTRAP_STATUS.md`](BOOTSTRAP_STATUS.md) — verified and pending setup work.
- [`docs/development/PUBLISHING.md`](docs/development/PUBLISHING.md) — repository, branch-protection and future release workflow.
- [`docs/development/DEPENDENCY_POLICY.md`](docs/development/DEPENDENCY_POLICY.md) — routine update grouping, deliberate majors and visible security updates.
- [`docs/development/INITIALIZATION_REPORT.md`](docs/development/INITIALIZATION_REPORT.md) — what the bootstrap created, validated and deferred.

## Source of truth

Before non-trivial work, read:

1. [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md)
2. the nearest applicable `AGENTS.md`
3. accepted ADRs and feature specifications for the target area.

## License

MSCanvas is licensed under the [Apache License 2.0](LICENSE). External conversion engines, vendor readers and scientific packages retain their own licenses and are not automatically redistributed by this repository.
