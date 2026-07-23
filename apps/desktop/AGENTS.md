# Desktop frontend guidance

Read the root `AGENTS.md`, `PROJECT_PROPOSAL.md`, `docs/ux/UX_PROCESS.md` and this file before non-trivial UI work.

## Ownership

This directory owns interaction, presentation, accessibility and transient UI state. Rust remains authoritative for filesystem, processes, backends and durable run state.

## UX requirements

- Start from a user goal and workflow, not a visual trend or component inventory.
- Major workflow changes need a baseline path, proposed path, interaction budget and recovery path.
- Keep file workspace, linked viewer, inspector and run status understandable at 1366×768.
- High-frequency actions such as add, remove selected, clear list and convert must be discoverable.
- Hover may accelerate inspection but cannot be the only route to essential information or actions.
- Glass, cards, bento layouts, gradients and other patterns are allowed only when they improve hierarchy and preserve contrast, plot readability and task flow.
- Removing an item from the workspace must never imply deleting source data.

## React rules

- Keep `App` composition-focused; place feature behavior in feature modules.
- Do not mirror large Rust objects or scientific arrays into a global store without evidence.
- Avoid storing pointer-move and cursor-frame data in React state.
- Use semantic HTML, visible focus states and keyboard equivalents.
- Every async surface needs loading, empty, success, partial and error states where applicable.
- Do not introduce another state/query/form library without approval.

## Verification

Rendered UI work requires a browser/Playwright pass, console inspection and at least one exercised interaction. Check 1366×768, a large desktop viewport and a narrow-window state when layout is affected.
