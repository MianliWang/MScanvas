# ADR 0004 — Shared semantic PlotSpec and FigureSpec

- Status: Accepted as an architectural direction
- Date: 2026-07-22

## Context

Viewer rendering, image export and later analysis figures must not diverge into unrelated chart implementations or depend solely on screenshots.

## Decision

Define renderer-independent PlotSpec/FigureSpec domain contracts. On-screen views and export services project from these contracts while retaining renderer-specific performance state outside them.

## Consequences

- Export theme/dimensions can differ from app theme/layout.
- Saved figures can be reproducible and provenance-aware.
- Renderer selection remains replaceable during M0 spikes.
- Large numeric arrays should be referenced/chunked rather than serialized into every spec copy.
