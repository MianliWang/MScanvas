# Design system foundation

Status: **existing foundation, with accepted M7 reference continuation**.
M7.0 accepts a production migration plan, not an implemented redesign. Tokens
and components evolve through real task validation under this document.

## M7 reference and implementation ownership

[ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md)
owns the v5.11 provenance, current/proposed/later capability mapping, interactions
and release obligations. This foundation and the existing repository UI skills
remain the design owners; no parallel style system or new three-concept contest
is introduced. The prototype's globals, CSS patches, synthetic science and ETA
budgets are not production implementation authority.

M7.1 begins with a real localized settings/shared-control consumer. M7.2 carries
the single Home action, distinct viewed/drag-selected/conversion-scope states,
session-only virtual organization and one drag transform/hit-test owner. M7.3
owns whole-row scan activation and the pending-range gesture: release does not
zoom; later explicit activation/Enter commits once; Escape cancels, with
discoverable keyboard/non-gesture equivalents and no permanent mode strip.
M7.4 consolidates typed configuration, result details and figure settings.

Motion must be interruptible, useful and compatible with reduced motion. Drag
feedback uses group/gap highlighting and compact counts. Preserve legibility,
units and bounded-data scope through reflow/collapse rather than shrinking text.
The en/zh-CN resource-value policy exception, canonical numeric-input rules and
language-preserving state tests are scheduled with M7.1; complete delivered-UI
coverage closes in M7.5. Nothing here declares those controls or tests shipped.

## Experience qualities

- Evidence-first: scientific plots and status should dominate decoration.
- Calm density: enough information for research work without forcing constant navigation.
- Clear causality: selections and operations visibly explain what changed.
- Recoverable: undo/retry and non-destructive defaults are normal paths.
- Desktop-native familiarity: selection, focus, resizing and shortcuts behave predictably.

## Layout tokens

- Primary reference viewport: 1366×768 at 100% scaling.
- Also validate 1920×1080 and a constrained 960×640 window.
- Resizable panels must define usable minimums and collapse behavior.
- Main evidence area receives remaining space; toolbars must not grow into wrapping ribbons.

## Typography

- Use a local/system UI stack initially; no runtime font CDN.
- Define explicit UI, table, plot label and numeric styles.
- Numbers in dense scientific tables may use tabular figures.
- Units belong in axis labels/column headers, not implicit tooltips only.

## Color roles

Use semantic roles rather than hard-coded feature colors:

- background / elevated surface / border;
- primary and muted text;
- selection/focus;
- queued/running/success/warning/error/cancelled;
- plot context, active trace and comparison traces.

Status must not be encoded by color alone. Plot palettes require contrast and color-deficiency checks.

## Component families

Initial owned components:

- app command bar and view switcher;
- acquisition/artifact row and virtualized data table;
- resizable panel shell;
- contextual inspector sections;
- run summary/job row;
- plot toolbar and persistent inspection readout;
- empty/loading/unsupported/error states;
- semantic setting field and warning summary;
- export dialog/preview.

Radix or selected shadcn source components may support accessible primitives, but MSCanvas does not adopt generic dashboard blocks as its product design.

## Interaction states

Every control defines default, hover, active, focus-visible, selected, disabled, loading and error behavior where relevant. Pointer hover cannot be the only path to required information or action.

## Plot rules

- Profile spectra render as lines; centroid spectra as sticks.
- TIC/BPC/XIC labels and intensity semantics remain explicit.
- Selection persists after click/keyboard navigation; hover is transient.
- App theme and export theme are independent.
- On-screen and exported figures share semantic PlotSpec/FigureSpec, not screenshots as the only implementation.

## Motion

Use motion to maintain spatial continuity, signal state or reveal a panel. Avoid decorative motion over scientific evidence. Respect reduced-motion preferences.

## M6.6 destination and conflict surface

This is a focused continuation of the accepted v5.11 organization using the
current owned conversion controls and tokens. It is not a replacement of this
foundation or an approval to install proposed component, motion or localization
packages.

- Keep the destination policy, its relevant name field and Fail/Skip together
  within the existing conversion surface. Custom local folder remains the
  shipped default; source sibling and named subfolder describe their policy
  without pretending a folder has already been admitted.
- Use one compact requested-policy/name/conflict summary. Render a named
  subfolder as user text, distinct from filesystem identity. Do not expose a
  raw absolute path, invented fixed folder, output count/name or all-clear
  conflict result to make the summary look complete.
- Preserve the exact entered name after Rust refuses it. Place one actionable
  validation message by the control, retain focus-visible treatment, and avoid
  repeated explanatory paragraphs. The UI does not sanitize, case-fold or
  resolve the filesystem name.
- Label Fail and Skip according to their existing-target behavior. Explain
  internal batch claim collisions and partially existing backend-named sets as
  separate refusals. `OVERWRITE_REFUSED` admits no actionable overwrite control.
- Disabled, describing, refused, picker-cancelled and retry states must remain
  legible without relying on color. Keyboard users can reach the policy, name,
  conflict and primary action in order and recover focus after the native picker.
- Validate 1366×768, 1920×1080, 960×640 and 1200×800. Long names and narrow
  reflow must preserve the primary action, error text and science area without
  clipping or a new full-width toolbar ribbon.

These are candidate design rules. The rendered and native evidence required to
accept their implementation is recorded separately; this section claims no new
QA result.
