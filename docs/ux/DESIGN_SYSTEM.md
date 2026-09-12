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

## Durable v5.11 reference baseline

This tracked specification preserves the accepted reference's relevant visual
hierarchy for a fresh checkout. It was transcribed on 2026-09-12 from the exact
HTML identified by [ADR 0047's material hashes](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#accepted-reference-continuation):
source lines 206-212, 316-399, 404-407, 549-574 and 1408-1427. These are static
source observations, not screenshots or new rendered-validation results. The
later source overrides matter; the prototype's implementation is not a porting
template. The route owns capability and interaction changes; this section owns
their visual reference. The original HTML/ZIP and historical preflight remain
owner-controlled supporting material, not prerequisites for using this baseline.

| Visual role | Accepted-reference mapping to validate in production |
| --- | --- |
| Surfaces and separators | Background `#f3f5f8`, white surface, subtle `#f7f8fa`; border `#dce3eb`, strong border `#9aa9bc`. White evidence panels sit on a quiet gray background, with thin separators and minimal shadow. |
| Text and emphasis | Ink `#172337`; final muted token `#4b5b70` (line 404 supersedes line 316's `#485b72`); primary/focus `#1769d1`, soft selection `#edf4ff`. Scientific state also requires text/icon cues. |
| Type | Local Segoe UI Variable Text / Segoe UI, CJK system fallbacks and sans-serif. Body 14px, labels 13px, captions 12px; numeric tables use tabular lining figures in the UI face, code uses monospace. The source's larger-text option adds 2px. No font download is implied. |
| Spacing and controls | 4/8/12/16/24px spacing scale; 6px control and 8px panel radii. Ordinary buttons have a 36px minimum, compact controls 32px; visible focus has a 2px outline with offset. These are reference values, not a contrast or physical-hit-target pass. |
| Density | Generic row tokens are 44/54px, but the final acquisition-row rule has its own 61px minimum and wrapped names. M7.1 must demonstrate a real roster-density change; copying an overridden token does not satisfy its consumer. Preserve legibility and accessible hit areas when mapping production values. |

| Region | Retained composition and owning migration |
| --- | --- |
| Shell / M7.2 | A single logo/name Home target, task navigation, then compact global actions including Settings. White header; blue active underline; no reset on Home. Content has generous outer spacing, while actions stay near their task. Only real beta capabilities enter navigation. |
| Workbench / M7.2-M7.3 | Grouped single-column roster on the left, dominant plots/scans in the center, contextual metadata on the right. The wide source layout uses approximately 240px / flexible / 245px regions. Side content folds below or into reachable collapsible panels before squeezing evidence. Group counts and disclosure controls stay compact. Viewed-row inset accent, separate drag-selection fill and membership checkbox communicate three independent states. |
| Settings / M7.1 | The source uses category navigation beside labeled setting rows: label/help on the left, choice on the right; narrow layouts reflow. Continue this hierarchy with actual en/zh-CN language and roster-density consumers plus shared figure fields. Locale switching is proposed M7 behavior, not a claim that the prototype localized its UI. Do not populate unimplemented engine/AI, cache or scientific settings. |
| Conversion and results / M7.4 | Compact configuration with small precision segments; basic/advanced edit one intent. Related parameters occupy the main area, an adjacent or reflowed summary leads to the action. Results have one compact summary and inspectable detail; figure controls accompany preview. Preserve only admitted operations, with truthful errors and recovery; simulated ETA and future step/node execution remain excluded. |

Owning slices compare real rendered fixtures against these tokens, hierarchy and
the [route's interaction contracts](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#accepted-reference-continuation).
For M7.1, capture the reachable Settings dialog and actual roster/figure consumer
in both languages, default/changed/reset values, keyboard focus and constrained
reflow; keep the route's state-preservation and recovery checks. Later consumers
add their affected selection, pending-range, refusal and result-detail states.
Use the viewports below and record intentional accessibility/reflow adaptations.
Those screenshots validate the production implementation against this tracked
contract; they are not pixel-equality proof against unavailable original images.
If an unrecorded detail requires an original comparison, MianliWang retains
custody of the hash-identified material; obtain that exact input for the detail
and preserve other independent work, without substituting an older demo or
reopening the accepted direction.

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
