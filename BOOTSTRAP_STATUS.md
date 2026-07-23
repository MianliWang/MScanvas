# Bootstrap status

**Updated:** 2026-07-23

**Canonical repository:** [`MianliWang/MScanvas`](https://github.com/MianliWang/MScanvas)

**Visibility:** Private

**Default branch:** `main`

## Completed

- Repository structure created.
- Product proposal installed as the root product and engineering source of truth.
- React/Vite/Tauri source skeleton created with an explicitly mocked M0 UI state.
- Rust workspace and three initial library crates created.
- Product, UX, architecture and ADR documents created.
- Root and nested `AGENTS.md` files created.
- Five repo-local Codex skills created.
- GitHub issue templates, Dependabot configuration and CI workflows created.
- Dependency-free repository validation completed.
- GitHub repository created at `MianliWang/MScanvas`.
- Initial source tree synchronized to the `main` branch.

The original local bootstrap commit is documented in
[`docs/development/INITIALIZATION_REPORT.md`](docs/development/INITIALIZATION_REPORT.md).
The GitHub commit SHA may differ because the source tree was transferred through the
GitHub API after the remote repository was created.

## Validation completed during repository initialization

- Required-file and source-of-truth contract checks.
- JSON and TOML parsing.
- GitHub workflow and issue-template YAML parsing.
- Repo-local skill frontmatter checks.
- Relative Markdown-link checks.
- Git whitespace and object-integrity checks.
- ZIP extraction and Git bundle clone verification.

## Intentionally pending

The bootstrap execution environment did not have the pinned Rust toolchain and could
not reach the configured npm registry. Consequently:

- `pnpm-lock.yaml` has not been generated;
- `Cargo.lock` has not been generated;
- frontend lint, typecheck, tests and production build have not been executed;
- Rust format, Clippy and tests have not been executed;
- Tauri desktop launch has not been verified on Windows;
- real ProteoWizard discovery, RAW preview and conversion spikes have not run.

The first toolchain-enabled Windows setup should install dependencies, run all checks,
commit both lockfiles and update this file with the verified results.

## First verified-bootstrap checklist

- [x] Create `MianliWang/MScanvas` on GitHub.
- [x] Synchronize the initialized source tree to `main`.
- [ ] Install pnpm and the Rust toolchain declared by this repository.
- [ ] Run `pnpm install` and commit `pnpm-lock.yaml`.
- [ ] Run `cargo generate-lockfile` and commit `Cargo.lock`.
- [ ] Run all frontend and Rust checks.
- [ ] Run `pnpm tauri dev` on Windows.
- [ ] Confirm Tauri capability configuration remains minimal.
- [ ] Complete the M0 ProteoWizard preview/conversion technical spike.
- [ ] Enable branch protection after the first green CI run.
