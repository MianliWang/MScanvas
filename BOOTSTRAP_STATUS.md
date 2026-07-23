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
- Deterministic Node, pnpm and Rust versions documented and enforced by repository
  validation.
- `pnpm-lock.yaml` and `Cargo.lock` generated and committed for frozen/locked use.
- Frontend lint, typecheck, tests and production build verified on Windows.
- Rust format, Clippy and workspace tests verified on Windows.
- Tauri's Windows icon prerequisite repaired and a release desktop executable built.
- The mock shell's main-window capability audited and narrowed to no Tauri core API
  permissions.

The original local bootstrap commit is documented in
[`docs/development/INITIALIZATION_REPORT.md`](docs/development/INITIALIZATION_REPORT.md).
The GitHub commit SHA may differ because the source tree was transferred through the
GitHub API after the remote repository was created.

## Verified toolchain

| Component | Repository contract | First verified local runtime |
| --- | --- | --- |
| Node.js | `22.23.1` in `.node-version`; minimum `22.13.0` | `22.15.1` |
| pnpm | `11.15.1` | `11.15.1` |
| Rust | `1.97.1` with rustfmt and Clippy | `1.97.1` |
| Python | dependency-free repository checker | `3.14.3` |

CI reads the exact Node version from `.node-version`. Local bootstrap accepts newer
compatible Node 22 releases while enforcing pnpm and Rust exactly.

## Bootstrap failures repaired

- GitHub Actions could not activate pnpm because the Corepack bundled with the old
  Node pin rejected pnpm's current signing key. CI and bootstrap now install the
  exact pnpm version through npm and verify it before use.
- Rust CI reached Tauri's build script before Clippy and failed because the required
  Windows icon did not exist. A repository-owned neutral source icon plus generated
  PNG/ICO outputs now make the desktop build deterministic. The artwork is a
  bootstrap placeholder, not final product branding.
- Once dependency installation was unblocked, the frontend exposed real bootstrap
  defects in Vitest setup and an obsolete explicit esbuild minifier selection. The
  tests now import their APIs and clean up deterministically, and Vite uses its
  built-in Oxc minifier.

No Rust source lint suppression or Clippy weakening was required.

## Windows validation completed on 2026-07-23

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed (2 frontend tests) |
| `pnpm build` | Passed |
| `cargo fmt --all --check` | Passed |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | Passed |
| `cargo test --locked --workspace --all-targets` | Passed (5 Rust tests) |
| `python -B scripts/check_repo.py` | Passed |
| `pwsh -NoProfile -File .\\scripts\\bootstrap.ps1` | Passed end to end |
| `pnpm tauri build --no-bundle` | Passed; produced a Windows release executable |

The desktop executable was built but not launched. This record therefore does not
claim a rendered Windows runtime smoke test.

## Validation completed during repository initialization

- Required-file and source-of-truth contract checks.
- JSON and TOML parsing.
- GitHub workflow and issue-template YAML parsing.
- Repo-local skill frontmatter checks.
- Relative Markdown-link checks.
- Git whitespace and object-integrity checks.
- ZIP extraction and Git bundle clone verification.

## Intentionally pending

- Launch and interact with `pnpm tauri dev` on Windows; a build alone is not a
  rendered runtime check.
- Run real ProteoWizard discovery, RAW preview and conversion spikes against an
  independently installed, licensed backend and representative acquisition data.
- Enable branch protection after the first green remote CI run.

## First verified-bootstrap checklist

- [x] Create `MianliWang/MScanvas` on GitHub.
- [x] Synchronize the initialized source tree to `main`.
- [x] Install pnpm and the Rust toolchain declared by this repository.
- [x] Run `pnpm install` and commit `pnpm-lock.yaml`.
- [x] Run `cargo generate-lockfile` and commit `Cargo.lock`.
- [x] Run all frontend and Rust checks.
- [ ] Run `pnpm tauri dev` on Windows.
- [x] Confirm Tauri capability configuration remains minimal.
- [ ] Complete the M0 ProteoWizard preview/conversion technical spike.
- [ ] Enable branch protection after the first green CI run.
