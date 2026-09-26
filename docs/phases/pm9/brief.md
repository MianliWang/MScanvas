# PM9 — real-workflow product integration

Stage: after M9, the concentrated real-workflow UI/UX cleanup that precedes a
new product candidate ([ROADMAP](../../../ROADMAP.md), [M9 closure §15](../../product/M9_CLOSURE.md#15-after-m9)).
Budget: seven slices, including the opening baseline (PM9.1) and the closing
acceptance (PM9.7). No uncounted planning or cleanup slice.
Status: **PLANNED**. The 2026-09-25 validation window established PM9.1's
browser rendered baseline, which is not complete, and passed PM9.2's browser
functional acceptance on the production-code candidate `a0783bb`; PM9.2's
visual and product acceptance is pending. PM9.3 has static preparation and a
passing contract spec only. All of it sits on a provisional base; see
[slices.md](slices.md). Nothing here is accepted.

## Mission

Make the existing viewer, conversion, Project, descriptive QC and targeted-MS1
capabilities one understandable workflow — from data and evidence, through
configuration, review and execution, to results and output — with persistent
scientific history kept separate from current-session authority.

## End state

1. A reader can tell the viewed object, the interaction selection, the
   processing scope and the historical result apart; moving between surfaces
   starts no work and keeps valid drafts and committed views.
2. Conversion and targeted MS1 share product language, not one scientific state
   machine: each keeps its own scope, parameters, cancel/retry and result
   contract.
3. Current results, descriptive QC summaries, runs and sources locate each
   other, and evidence is not crowded out by technical detail.
4. After a project reopens, history is inspectable, and "source not checked",
   "source unavailable", "not in the Workbench", "payload missing or corrupt" and
   "runtime unavailable" are each stated with a real next action.
5. The implemented surfaces approach the accepted v5.11 direction in hierarchy,
   text, density, action placement, feedback, keyboard and narrow-window
   behaviour, with no fake plot, fake ETA or empty future entry.

## Acceptance (three layers per ID)

Every ID is **PLANNED**. Status words: `PLANNED`, `IMPLEMENTED_UNVALIDATED`,
`ACCEPTED`; an unexecuted check is `PENDING`, and a written test is not a run.
Evidence types are kept apart: static reading, component test (Vitest/jsdom),
controlled-IPC browser rendering (real frontend, real Vite, real Chrome, only the
IPC boundary replaced), real Rust payload/parser/renderer tests, native window,
live provider. Observed evidence from before PM9 is a baseline, not PM9's
acceptance.

| ID | Observable (true) | Necessary (exists) | Connected path and verification (wired) |
| --- | --- | --- | --- |
| U1 Orientation | Current project, viewed acquisition, selected objects, task scope, active task and inspected result are intelligible; Home, Settings and folding keep valid context | Existing shell owners (`PreviewWorkspace` surface, `WorkbenchHeader`, `SessionPreferencesProvider` panels); projections only where needed | Populated-state navigation with IDs, drafts, viewports and IPC/mount counts compared before and after; screenshots and keyboard paths |
| U2 Curation | Admission, search, grouping, drag, removal/Clear and hidden-selection counts still hold; focus, viewed source, highlights and membership stay distinct | Existing roster and organization owners; no second execution set | Scenarios with duplicate names, hidden rows, empty state and active work; processing order unchanged by grouping or search |
| U3 Inspection | Chromatogram, scan table, spectrum, range tools and figure actions stay linked and readable; view changes are not source reads or method changes | Existing selection, viewport and figure owners | Scan selection, filter, hide-and-recover, range confirm/cancel; request counts |
| U4 Conversion | Configuration → review → queue → failure/stop/retry → output uses the typed authority and real admitted combinations | Existing settings, plan, queue and output owners | Controlled scenarios; correct refusal without a provider; a live-provider positive check stays `PENDING` under the ProteoWizard hold |
| U5 Targeted MS1 | Line-level problems, exact plan review, single and 2–16-member batch states are clear; 1–200 targets, order and guards unchanged | Rust plan review and project operation owners; draft-only UI state | Edit after review, batch stop, mixed outcomes, runtime unavailable |
| U6 Results and provenance | QC reports and targeted results read in the main region; every row, evidence and export is bound to its artifact, producing run and plan; no implicit recomputation | Schema-4 records, managed payload reads, canonical renderer | Row/artifact/plan consistency; the PR #127 re-attribution counterexample kept |
| U7 Continuity | Drafts and view state survive navigation; project replacement invalidates stale context; reopen offers only the existing explicit check/relink/admission; valid stored results are readable without source or runtime | Existing reopen, relink and admission commands; session-only UI state | Stored-payload scenarios with no executor and an unavailable source; nothing marked checked that was not |
| U8 Output | Format-specific capabilities and scopes kept; viewer copy/export unchanged; stored targeted results keep SVG/PNG/CSV/TSV only | Existing viewer and targeted export authority | Ownership, scope, coverage and cancel checks |
| U9 Experience | A populated production surface reflects the accepted hierarchy, density, disclosure, bilingual controls, focus and responsive behaviour | Existing tokens, shared controls, preferences | 1920×1080, 1366×768 and 960×640 CSS viewports, en and zh-CN, keyboard, reduced motion; OS scaling recorded separately; no-overflow alone is not acceptance |
| U10 States and resources | Empty, loading, ready, unsupported, failure, stale and missing states have truthful next actions; navigation adds no background work | Minimal projections, existing progress/cancel owners, lifecycle cleanup | Late answers, stop and replacement, unmount/remount; request and mount counts against the baseline |

## Regression (must still hold at the end)

Only within identified tested scopes: read-only sources; explicit scientific
changes; range versus view; independent workspace selection states; stale-view
and late-request protection; conversion order, stop and output ownership;
Project/Plan/Run/Artifact lineage; atomic Save and Save As refusals, destination
store occupancy, payload–plan binding and revision bounds (validated on
`cf4af12`); the two focus-race regressions; snapshot and scratch boundaries;
stored results never re-executed. The stale-reference repair (`8ad3912`) was
run in the 2026-09-25 window on its documentation successor `d56b17b`, every
exit 0; its qualification belongs to the integration record, not to PM9.

## Locked decisions (from the owner)

- Productize existing capabilities only; no new scientific domain.
- Seven slices in total.
- Project schema 4 unchanged; no new persisted workflow, method-library or
  workspace-restoration format, and no sidecar or `localStorage` workaround.
- Continue the accepted v5.11 direction; no new style competition.
- The owner's normal use of the host comes before validation throughput; test
  execution is paused until the owner opens a window.

## Boundaries

- Unify product language, not scientific state machines or execution
  authorities; existing workspace, project, queue, runtime and export owners
  stay.
- The interface may carry typed IDs and render authoritative projections; it
  never guesses availability, plan identity, source eligibility or lineage, and
  never fills a missing fact with an ETA, a success state or a permissive
  fallback.
- A later authorized slice may add a minimal read-only Rust/DTO projection of an
  existing fact, with its affected validation; that authorizes no new write
  capability and no science.
- Presentation state is not scientific history. No automatic restore,
  re-admission, pruning, cached-result resurrection or worker restart.
- ProteoWizard HOLD and the Route B restriction are unchanged. A blocked
  live-provider check stays blocked; testing only a refusal does not pass it.

## Scope

- Must: U1–U10, the seven slices and the regression list.
- If time allows: drag and motion details that change no contract; reversible
  touch improvements needing no new permission or source; non-critical layout
  adjustments.
- Not in PM9: new algorithms, XIC, multi-source comparison, normalization or
  alignment, statistics or library search, new adducts, profile centroiding,
  workflow graphs; persisted workflows or method libraries; schema migration;
  automatic workspace restore; runtime, installer or release; M10; a general GC
  subsystem; unfounded caches; new dependencies; a performance campaign; a new
  test system; stored-result clipboard; self-describing PNG; changes to exported
  figure text or raw table semantics.
