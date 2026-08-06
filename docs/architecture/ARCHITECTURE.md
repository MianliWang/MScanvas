# Architecture

## Context

MSCanvas is a desktop workbench with a React UI, a Tauri/Rust authority boundary, external conversion tools and later isolated scientific workers.

```text
React + TypeScript
  views, interaction, accessible components, plot projection
        │ typed Tauri commands/events
        ▼
Tauri host / Rust application layer
  filesystem authority, discovery, project state, cache, queue, process supervision
        │
        ├── ProteoWizard adapter (msaccess/msconvert)
        ├── plot/figure specification and export services
        └── later analysis-worker adapter
```

## Ownership rules

- React owns presentation and ephemeral view state; it does not spawn processes or receive arbitrary filesystem capability.
- Rust owns canonical paths, logical dataset discovery, backend state, authoritative jobs and output safety.
- Adapters translate typed intent into backend-specific invocation/parsing.
- Core domain types do not depend on Tauri, React, MCP or a specific scientific package.
- Scientific arrays move through bounded/chunked/cache-aware representations; frequent pointer state is not copied through global React state.

## Initial crates

- `mscanvas-core` — domain types and invariants.
- `mscanvas-plot-spec` — renderer-independent plot semantics.
- `mscanvas-proteowizard` — typed command planning and later output parsing.
- `mscanvas-desktop` — Tauri composition root.

Split crates only when ownership/testing boundaries are real. Avoid a crate-per-noun architecture.

## Execution model

A shared executor should eventually own:

- direct process spawn with argv arrays (never shell concatenation);
- stdout/stderr capture and structured events;
- cancellation of the process tree;
- concurrency limits;
- temporary/final output transitions;
- timeout/resource/disk checks;
- normalized result/failure types.

Backend adapters own capability probing, command planning, event parsing and failure classification.

Of that list, direct argv spawn, bounded capture, owned process-tree termination and normalized failures exist in `mscanvas-proteowizard`, and the temporary/final output transition now exists there too, for one conversion at a time. Concurrency limits, timeouts, structured progress events and the queue that would use them do not. See [ADR 0009](adr/0009-mzml-conversion-execution-boundary.md).

## Persistence evolution

M1 can use in-memory state plus small settings storage. Introduce durable project/run storage only with an explicit schema/ADR. Derived large data should be stored in suitable files/caches rather than embedded wholesale in a UI settings database.

## Security posture

- Minimal Tauri capabilities; no general shell plugin exposed to frontend.
- Input/output roots are canonicalized and validated.
- No source-data deletion in normal workspace operations.
- Local-first and no default telemetry/upload.
- Secrets/environment dumps are not written into logs or manifests.

See the focused architecture documents and ADRs in this directory.
