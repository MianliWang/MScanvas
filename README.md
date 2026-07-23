# MSCanvas

**A modern open-source workspace for mass spectrometry data.**

MSCanvas is a Windows-first, local-first desktop application for importing mass-spectrometry acquisitions, exploring linked chromatograms and spectra, converting vendor data to mzML/mzXML, and exporting clean scientific figures. Later releases may orchestrate established analysis packages through typed modules and isolated workers.

> Status: **pre-alpha / repository bootstrap**. The current application is a functional UI shell backed by mock data. ProteoWizard integration and real RAW preview are M0 technical spikes.

Canonical repository: [`MianliWang/MScanvas`](https://github.com/MianliWang/MScanvas) (currently private).

## Product scope

The first usable product focuses on:

- drag-and-drop file and folder workspaces;
- metadata, TIC/BPC, spectrum and scan-table exploration;
- linked selection across views;
- RAW to mzML/mzXML conversion through user-installed ProteoWizard;
- queue, cancellation, retry and actionable errors;
- PNG/SVG figure export and underlying-data export.

Analysis is deferred rather than prohibited. MSCanvas should reuse mature algorithms from OpenMS/pyOpenMS, matchms and other reviewed packages instead of reimplementing them.

## Repository status

This bootstrap includes:

- a React + TypeScript + Vite desktop UI shell;
- a minimal Tauri 2 native host;
- Rust domain, ProteoWizard-command and plot-spec crates;
- product, UX and architecture source documents;
- repo-local Codex guidance and skills;
- frontend, Rust and repository-quality CI workflows.

The first Windows bootstrap now has committed pnpm and Cargo lockfiles, frozen/locked
CI installs and a deterministic desktop build prerequisite. See
[`BOOTSTRAP_STATUS.md`](BOOTSTRAP_STATUS.md) for the commands actually verified and
the remaining runtime/backend work.

## Development prerequisites

- Node.js 22.13 or newer (`.node-version` pins the CI runtime);
- pnpm 11.15.1 installed through npm;
- Rust 1.97.1 through rustup;
- Windows 10/11 for the supported desktop target;
- ProteoWizard installed separately for real vendor-data conversion.

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
- [`docs/development/INITIALIZATION_REPORT.md`](docs/development/INITIALIZATION_REPORT.md) — what the bootstrap created, validated and deferred.

## Source of truth

Before non-trivial work, read:

1. [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md)
2. the nearest applicable `AGENTS.md`
3. accepted ADRs and feature specifications for the target area.

## License

MSCanvas is licensed under the [Apache License 2.0](LICENSE). External conversion engines, vendor readers and scientific packages retain their own licenses and are not automatically redistributed by this repository.
