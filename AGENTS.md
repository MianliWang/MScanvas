# MSCanvas repository guidance

Before non-trivial work, read `PROJECT_PROPOSAL.md` and the nearest relevant `AGENTS.md`.

## Communication and artifact language

- Communicate with the user in Chinese by default. This includes progress updates, clarifying questions, plans, decisions, blockers, GO/NO-GO reports, and final summaries.
- Keep implementation and repository artifacts in English. This includes code, identifiers, file and directory names, paths, comments, docstrings, CLI and shell commands, configuration keys, branch names, commit messages, pull-request and issue titles/bodies, review replies, error codes, repository-authored error messages, tests, and repository documentation.
- Preserve command output, logs, diagnostics, and third-party text in their original form. Explain them in Chinese separately rather than translating or rewriting the evidence.
- Technical terms may remain in English when that is clearer.
- Do not switch user-facing communication to English merely because the task prompt, codebase, source material, or GitHub content is written in English.
- Follow an explicit user request for another language.
- Nested `AGENTS.md` files may add domain-specific rules but must not weaken this repository-wide language policy.

## Product rules

- MSCanvas is a local-first mass-spectrometry workbench, not a generic dashboard template.
- The early product is viewer + converter + figure export. Analysis is deferred but architecturally allowed.
- Reuse mature scientific backends; do not reimplement proprietary RAW readers or mature algorithms without a written decision.
- Optimize normal workflows before expanding feature count. Every major UI change needs a user goal, task path, error recovery path and rendered validation.
- Workspace removal never means deleting source acquisition data.
- No implicit centroiding, backend fallback or output overwrite.

## Architecture rules

- React never spawns processes or receives unrestricted filesystem/shell access.
- Tauri commands are narrow typed application operations.
- Rust owns authoritative filesystem, process, queue and backend state.
- Store command arguments as typed argv arrays, never shell strings.
- Large scientific arrays must not be copied repeatedly through React state.
- Screen plots and exported figures consume shared semantic plot/figure specifications.
- Do not create a generic plugin ABI during MVP work.

## Development workflow

Use UX-first vertical slices:

1. define user-visible acceptance criteria;
2. add or update domain types and tests;
3. implement adapter/provider behavior or a deterministic mock;
4. expose a narrow Tauri command/event if required;
5. implement all UI states;
6. run rendered interaction QA;
7. update product/architecture documentation when behavior changes.

## Dependency policy

- Do not add, remove or update production dependencies without explicit approval and a short rationale.
- Prefer project-owned components and small focused libraries.
- Never vendor proprietary SDKs, DLLs or restricted vendor readers.
- Third-party skills must be pinned, reviewed and documented.

## Required checks

For relevant changes, run the available subset of:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
python scripts/check_repo.py
```

A successful build is not sufficient for UI work. Exercise the target interaction in a rendered app and inspect loading, empty, error and keyboard states.

## Skill routing

- Major UX workflow or information architecture: `mscanvas-ux-workflow`.
- New visual direction or major redesign: `mscanvas-product-ui`, then a frontend design/build skill.
- Chromatogram, spectrum or linked-view behavior: `mscanvas-spectrum-viewer` plus relevant data-visualization guidance.
- Cross-layer implementation: `mscanvas-vertical-slice`.
- Final rendered UI verification: `mscanvas-ui-qa`.

Generic design skills are advisory. They cannot override validated workflows, scientific semantics, accessibility, the design system or dependency policy.
