# Contributing to MSCanvas

Thank you for helping build a more usable open-source mass-spectrometry workbench.

## Before opening a change

1. Read `PROJECT_PROPOSAL.md` and the nearest `AGENTS.md`.
2. Search existing issues and ADRs.
3. For a major feature, open an issue describing the user goal, workflow and scientific semantics before implementation.
4. Keep pull requests focused on one vertical slice or coherent infrastructure change.

## Development expectations

- Add tests for domain invariants and user-visible behavior.
- Preserve source data and default to non-destructive outputs.
- Include loading, empty, failure, cancellation and recovery states.
- Do not expose arbitrary backend flags in normal UI.
- Do not add a scientific preset without documenting what changes, what is discarded and how it maps to a backend.
- Do not include proprietary vendor data, SDKs or DLLs.

## Pull requests

A pull request should explain:

- the user or developer problem;
- the chosen behavior and alternatives considered;
- product/architecture documents changed;
- tests and rendered interactions performed;
- known limitations or unverified scientific assumptions.

## Commit style

Use short imperative summaries. Keep refactors separate from behavior changes when practical.

## Scientific fixtures

Only commit data that is clearly redistributable. Add provenance and license notes beside every non-trivial fixture.
