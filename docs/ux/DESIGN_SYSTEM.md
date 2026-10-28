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

The M7.1 candidate supplies localized session Settings, actual roster density and
shared controls in both existing figure consumers. The first QA build passed all
four required native pairs. PR #120's label-activation repair has a new QA build
and passing browser checks and focused 150% native revalidation; the
[implementation record](M7_1_LOCALIZED_SETTINGS_SHARED_CONTROLS.md) separates that
repaired-build evidence from retained first-build native proof. M7.2 carries
the single Home action, distinct viewed/drag-selected/conversion-scope states,
session-only virtual organization and one drag transform/hit-test owner. M7.3
owns whole-row scan activation and the pending-range gesture: release does not
zoom; later explicit activation/Enter commits once; Escape cancels, with
discoverable keyboard/non-gesture equivalents and no permanent mode strip.
M7.4 consolidates one typed intent into basic/advanced views,
keeps independent result judgments inspectable, and places quick PNG/Copy plot
beside canonical figure preview. Clear, output opening and owned staging
cleanup expose explicit recovery without changing scientific claims.
[Its implementation record](M7_4_CONVERSION_RESULTS_FIGURES.md) distinguishes
passing controlled/browser checks from seven attributed native scenario passes;
PR #124 tracks protected publication and natural-main CI.

Motion must be interruptible, useful and compatible with reduced motion. Drag
feedback uses group/gap highlighting and compact counts. Preserve legibility,
units and bounded-data scope through reflow/collapse rather than shrinking text.
M7.1 implements the narrow en/zh-CN resource-value policy exception and preserves
the figure fields' existing positive-integer grammar and raw editing strings.
Complete delivered-UI coverage closes in M7.5. M7.1 preferences reset when the
app session restarts; no storage or scientific workspace restoration is added.

The M7.1 roster mapped comfortable/compact to 44/32px minimum rows with
unchanged 13px type and no windowing. M7.2 preserves those minima and typography,
with measured variable-height windowing above 80 presentation items; wrapped
names grow and offscreen payloads remain ID-based. Shared figure inputs and
choices use visible 32px controls; Settings actions use 36px controls. The Settings
surface uses local Segoe UI/CJK fonts, quiet light surfaces and one real Appearance
category. At constrained heights, its own scroll surface keeps the footer reachable.

### M7.3 viewer consumer mapping

The center stack orders chromatogram, selected spectrum and scans. A small scan
table grows with its rows; a large one uses a bounded ten-row scrolling region
with stable headers. Label and SVG sort indicator share one 32px header target,
with `aria-sort` on its column. Roving row focus has one Tab entry and remains
distinct from the source-index selection and loaded-result position.

SVG text is counter-scaled to 12 CSS px, including long/signed scientific
intensity labels positioned inside the plot. This changes text presentation,
not scientific path geometry. Existing exports and source detail stay in compact
disclosures. At short heights the lower spectrum is reachable by the evidence
pane's natural scroll; controls and units are not reduced to fit.

A pending interval is a restrained shaded band and boundaries with one short
confirm/cancel action. It never animates scientific amplitudes or moves an axis
before confirmation. There is no persistent mode strip. Keyboard and raw numeric
paths accompany gestures; reduced motion preserves the same outcomes. Existing
session Settings controls deliver en/zh-CN viewer messages without remounting
workspace state. [The M7.3 record](M7_3_VIEWER_SCANS_COMMITTED_GESTURES.md) owns
rendered/native attribution and publication status.

Amended 2026-09-28 (PM9.3). Each plot header carries its title and its figure
actions on one line: a caption naming what they produce (plot, range, size),
Export figure, Quick PNG, Copy plot and the plot's export entry. The plot's own
controls sit in pill groups on the line directly above the drawing: the
chromatogram's TIC/BPC and RT range, and the spectrum's m/z range. In a default
panel arrangement no viewer toolbar takes a second row, from 960×640 to
2560×1440 in either language, and at 960×640 the selected spectrum's plot
begins inside the window. See
[PM9.3](../phases/pm9/slice-03.md#05-validation-repair-and-closure-2026-09-28).

### M7.2 consumer mapping

The implemented shell uses a white header, quiet gray background, blue active
underline and one logo/name Home target. Workbench and Conversion & results are
real mounted surfaces. Existing export controls stay with their scientific panel;
no future navigation target is exposed. Wide workbench regions are 280px / flex /
245px: the roster is wider than the approximate 240px reference to keep wrapped
names and separate selection controls legible. Below 1050px, auxiliary panels
fold into reachable header actions before displacing evidence. Header actions do
not scroll; the roster owns its scroll, and the evidence region owns the retained
plots/table/export flow. Hidden surfaces expose no tab stops.

Viewed acquisition, highlighted row, focus and checked conversion membership
have separate labels and visual cues. Group names are raw user labels; groups
and browsing arrangement last for the session only. Group checkboxes explicitly
cover the whole group, including filtered children.

dnd-kit 0.5.0 owns sensors, geometry, collision, the overlay and auto-scroll.
The sortable consumer uses `SortableKeyboardPlugin` without the default
`OptimisticSortingPlugin`: that plugin reparents React-owned nodes, which breaks
variable-height window unmounts during auto-scroll. The target highlight and
compact count provide feedback, and React commits the ID transaction on drop.
Motion animates only unrelated navigation/disclosure affordances; it never moves
active drag targets or scientific plots. Keyboard accepts `Enter` and
`NumpadEnter`, as measured under the pinned sensor. Reduced motion preserves
operations. Frame evidence and limitations live in the
[M7.2 record](M7_2_WORKBENCH_SHELL_ROSTER_ORGANIZATION.md).

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

## PM9 known UI/UX rework decisions (2026-09-28)

Decided in the bounded rework of [PM9 baseline §12](../phases/pm9/baseline.md#12-known-uiux-rework-2026-09-28).
Each is held by a PM9.1 or PM9.3 browser case or a unit test named there.

- **Shell insets.** The header, the notices and the content share one left
  edge: 16 px at every width (UI-01). The header no longer uses 20 px, or 12 px
  below 1050 px.
- **The header's second line.** What gives way is computed, not left to
  flex-shrink ratios (UI-48): the drop hint first and whole, its gap with it;
  then each context item by rank, lowest first, down to its floor; an
  operation's status never. The floor is 5.5em, and 7em for a project with
  unsaved changes, which leads with that fact ("Unsaved changes: …", UI-03).
- **Roster width.** 280 px at every width that shows the roster beside the
  evidence, against the v5.11 reference's 285 px at 1920 (UI-14). This is
  intentional: one fixed width across 1051–2560 px keeps the viewer column's
  measured floors, and the 5 px change no task.
- **Refused primaries.** A refused primary action (`aria-disabled`) gives up
  the accent: subtle surface, secondary text, strong border and a not-allowed
  cursor. It does not fade, so its focus ring keeps full contrast, and it stays
  a Tab stop. Its reason is visible text beside it, not only a tooltip
  (UI-24).
- **One primary per state.** While the evidence pane offers the retained
  acquisition again beside the roster, that is the filled action; `Add
  files…` stays offered as a secondary. In the constrained layout, where an
  open roster takes the pane's place, `Add files…` keeps the accent (UI-19).
- **Focus colour.** One colour, the reference's `#1769d1`, for every focus
  ring (UI-46). Settings no longer declares its own, and the lighter `#2a7fff`
  token is gone.
- **Plot headers.** A figure caption names plot, range and size; each part is
  kept whole and the caption reflows only at its separators (UI-26). A plot
  header's actions keep the heading's row wherever their buttons fit beside
  it; where the caption does not also fit, it goes under the buttons rather
  than costing them the row (UI-27, UI-28). The sentence about the selected
  spectrum is never truncated to make room: where heading and controls do not
  fit side by side, the controls take their own row.
- **Viewport pills.** The m/z controls' pill is as wide as its controls, as
  the chromatogram's are (UI-30).
- **Ranges and units.** Range lines print at the plot's own precision; exact
  values are the range editor's and the export notes'. Before a range is
  committed the line says "full range" rather than repeat the caption's
  numbers. A missing unit is said once per axis on the chromatogram panel and
  is part of the plot's accessible description (UI-31, UI-33). Once a range
  is committed the line says "part of the full range" -- the whole run or
  spectrum is stored as no commit, so a committed range is always a proper
  part of it -- and keeps its bounds in its live announcement ("…, namely X
  to Y"), read whole (atomic). Neither committed sentence claims to be the
  range on screen, which the caption prints, a gesture's included, so neither
  is false while a wheel or drag is in flight. The line follows the pending
  band and the committed range, never a gesture's range: a gesture's frames
  and abandonment change nothing, and neither does its start unless the start
  discards a pending band (the owners' rule). That discard is a real change
  of the pending state, so the line changes once, from the band to the
  committed range as it stands -- not a claim that anything was committed --
  and says nothing more for that start. Escape does not bring a discarded
  band back (the owners' rule, kept), and an Escape that changes nothing in
  the owners changes nothing here. A gesture's commit is announced once, when
  it settles (UI-34), and a new source keeps nothing of the old one's values.
  These are DOM contracts, checked with a MutationObserver over the line:
  Chromatogram's unit cases hold the discard and the later commit, and
  PM9.3-V11 holds the discard, Escape after it and a later commit in the
  rendered app. No
  screen reader's speech is claimed. Decision trail: batch 2 (2026-10-03,
  `5e4c6ac`) said "the range shown" and accepted it as untrue while a gesture
  was in flight; the wording continuation (2026-10-03, `b7b8eeb`) superseded
  that, because a sentence claiming to be the range on screen may not stay
  visible while it is false. The owner accepted that wording on 2026-10-04:
  the line is about the committed range its owner holds, which a wheel, pan
  or reveal can set without being a selection, and is not called one. The
  same decision replaced the shorthand "a gesture that commits nothing says
  nothing" with the pending-band rule above. A range line gives way inside
  its own box (a 12em basis) before the pending actions beside it take a
  second row (UI-32).
- **Details facts.** In the 245 px Details column a digest is one line (the
  whole value in its tooltip, still selected and copied in full), a name at
  most three lines, and each fact is its label over its value, so a long value
  has the column's full width (UI-25). At 1050 px and below, where Details
  takes the surface's place, label and value stay side by side.
- **Counts.** A count keeps its word in either language: no-break spaces in
  the resources and `word-break: keep-all` (UI-16). Where the 280 px roster
  cannot hold the organizing buttons and the count on one line, the count
  takes the band's second line, whole (UI-15, UI-17).
- **Measured once (UI-45), at 1366×768 with a spectrum selected.** No
  stylesheet names an undeclared custom property (`--color-text-muted` and
  `--color-text` were; Radix declares its own at run time). Visible text sizes:
  12 px 135 elements, 14 px 34, 11 px 25, 13 px 19, 19 px 6, 16 and 17 px one
  each. Radii are 0, 6 and 8 px; roster rows 44, 59 and 61 px. One control was
  below the 32 px compact minimum, Roster help's summary at 18 px; it is 32 px
  now, and the case holds every visible control to it. Kept deviation: 11 px
  for the viewer's dense secondary text -- the figure caption, "Showing"
  ranges, the scan table's sort headers and result count -- and a roster row's
  folder context. It sits under the reference's 12 px caption; raising it is a
  type-scale decision, not a defect fix, and would reflow the headers PM9.3
  measured.

## PM9.7 freeze decisions (2026-10-14)

Decided by the owner at PM9.7's freeze ([slice-07 §9](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze)) and fixed in candidate 2 (`30b855f`). They are held by `e2e/specs/pm9.7-integrated.browser.e2e.ts` (PM9.7-I1, PM9.7-I3) and `apps/desktop/src/features/project/ProjectPanel.test.tsx`.

- **Refused secondaries on the Project surface** (PM9.7 F1).
  - A refused secondary (`aria-disabled`) fades to 0.48, with a not-allowed
    cursor, except while it holds the focus ring. The ring keeps full
    contrast, as the header's panel toggles' does.
  - Where it names its reason, it does so through `aria-describedby` and its
    tooltip.
  - With no project open, Save, Save As… and Close point to the visible
    no-project sentence.
  - Capture QC summary, Add to Workbench and Create layer point to their own
    reason.
  - While an operation runs, only the busy line says why.
- **One ring for every stop** (PM9.7 F15).
  - The shared rule in `index.css` covers buttons, inputs, selects,
    disclosure summaries and anything with a `tabindex`.
  - It sits at the lowest specificity (`:where()`), so a component's own
    ring wins.
  - A control flush against a clipping edge draws its ring inset
    (`outline-offset: -2px`): the roster's and scan table's rows, the
    context line's items, the roster's help disclosure.
  - Roster menu items keep the ring beside their highlight.
  - Every such control has a 4 px `scroll-margin`, the ring's reach. Focus
    scrolling then brings the ring into view, not only the control: the
    spectrum plot at the foot of the evidence column, for one.

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

PM9.4 conversion journey (2026-10-04, [slice-04](../phases/pm9/slice-04.md)):

- The next conversion reads in the order it is decided: scope (`Checked rows`
  or `All workspace rows`), settings, destination and conflict, then the
  reviewed summary, and directly under it Convert. Under a finished queue that
  block is headed "Next conversion", and while a queue runs it is not on screen.
- One filled primary per state. A refused Convert follows UI-24: it gives up the
  accent through `aria-disabled` and stays a Tab stop whose reason is reachable.
  Under a finished queue whose outputs are offered, adding them is the primary.
- A control pressed while its request is in flight (Stop queue, Stop this file,
  Skip, Add converted outputs) stays focusable through `aria-disabled`. When the
  pressed control leaves -- Convert, Retry, Stop queue, a settling queue --
  focus goes to the queue's status line, never into the roster or the plan.
- Each failure of a completed queue says whether Retry reruns it, and Retry's
  scope is visible text. A stopped or partly skipped queue says how to convert
  what did not finish. A rerun under way says it is one. Progress stays item
  counts with no percentage or estimate.

These are candidate design rules. The rendered and native evidence required to
accept their implementation is recorded separately; this section claims no new
QA result.
