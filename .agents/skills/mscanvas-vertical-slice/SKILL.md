---
name: mscanvas-vertical-slice
description: Implement or review one MSCanvas feature as a UX-first vertical slice across domain types, providers, Tauri IPC, React UI, tests and product documentation. Use for workspace, viewer, conversion, runs, export, settings or related bug fixes.
---

# MSCanvas vertical slice

1. Read root and nearest `AGENTS.md`, relevant proposal sections, feature catalog entry and workflow.
2. State the user-visible outcome, interaction/error path and acceptance tests. Do not expand the milestone.
3. Inspect existing domain/provider/IPC/component patterns before adding abstractions.
4. Implement in ownership order where applicable:
   - domain model and unit tests;
   - deterministic provider/mock or backend adapter;
   - narrow Tauri command/event;
   - React projection and interaction;
   - empty/loading/partial/error/cancel/keyboard/accessibility states.
5. Keep filesystem/process authority in Rust and backend syntax in its adapter. Never concatenate shell commands.
6. Ask before adding a production dependency.
7. Run targeted checks, then relevant repository gates.
8. Update the feature/workflow/design/ADR documents when behavior or durable architecture changes.
9. Handoff with behavior delivered, files changed, checks actually run, screenshots/interaction evidence and unverified real-backend assumptions.
