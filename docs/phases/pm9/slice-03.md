# PM9.3 — evidence-first viewer: chromatogram, scans, spectrum, inspection and export

PM9 | Acceptance: U3, U8 (viewer), U9, U10 | Depends on: PM9.2 | Serial, one writer
Status: **IN PROGRESS — re-expanded on 2026-09-26** against the current tree
(§0 below). §1–§5 are the static preparation, kept as evidence; §0 replaces
§6 as the plan.

The paragraphs below are the history that led here. §1–§3 and §5 were read at
`9786809` (tree `da9ae8e`) from source and recorded evidence. The viewer's
code is unchanged since then; the one later
production change is the shell repair `a0783bb`
([baseline §7](baseline.md#7-validation-window-2026-09-25)). In the 2026-09-25
window the viewer contract spec ran 11 of 11 PASS on `a0783bb` (§4). That
shows the authored harness executes against the unchanged viewer; it is not
PM9.3 work. The midpoint check ([slices.md](slices.md)) follows this slice.

The first expansion was void under the unfreeze rule after the
2026-09-26 mid-phase normalization ([baseline §10](baseline.md#10-mid-phase-normalization-2026-09-26)). PM9.3
re-expands when it starts, from the code of the PM9.2 final candidate
`b81fc78`, reusing §1–§5 as evidence. Settled there: the `openTheViewer`
repair (m4.3, m4.4, m5.2, m5.3, m5.7 and viewer-r1 call it), the same
toggle-then-wait copied into m7.3 and m7.4's viewer cases, and the 960×640
panel floors are PM9.3's. The m7.2 rows in §5, m7.2's own copy of that pattern
included, and m7.4's active-Clear cases are no longer PM9.2's but PM9.7's.
L3, L5 and L21's open parts (what stays visible with the roster or Details
open, swap rather than stack) are PM9.3's gaps, and PM9.3 compares the pending
range band, the empty viewer entry and the roster-open and Details-open states
at 960×640. §6 item 3 is PM9.3's own before-and-after, not PM9.1's J1–J6
baseline, which is measured on `d56b17b`.

## Goal

A reader opening an acquisition sees the evidence first. They can inspect and
export it without losing their place. Every existing contract below stays
true: one source index behind every way of choosing a scan, a pending range
that is never export authority, projection that is not a source read, and
format-specific exports. No XIC, overlay, multi-layer comparison, new unit,
processing, clipboard capability or exporter.

## Read first

- [brief.md](brief.md) (U3, U8, U9, U10), [baseline.md](baseline.md) §2, §3
  and §6.
- The [M7.3 record](../../ux/M7_3_VIEWER_SCANS_COMMITTED_GESTURES.md) and the
  [screen model](../../product/SCREEN_MODEL.md) "M7.3 viewer continuation".
- [WF-003](../../product/PRIMARY_WORKFLOWS.md).
- ADRs:
  - [0032](../../architecture/adr/0032-viewer-interaction-and-viewport-state.md)
    (state layers, precedence, M7.3 amendment);
  - [0034](../../architecture/adr/0034-chromatogram-export-and-range-scope.md)
    (Full run or current range);
  - [0038](../../architecture/adr/0038-spectrum-viewport-authority-and-screen-projection.md)
    (a different spectrum is a different viewport context);
  - [0039](../../architecture/adr/0039-visible-spectrum-viewport-adapter.md);
  - [0040](../../architecture/adr/0040-spectrum-range-export.md) (scope
    belongs to a spectrum's export context);
  - [0041](../../architecture/adr/0041-viewer-selection-availability.md).
- `apps/desktop/AGENTS.md`.

## Entry conditions

- The branch is the PM9 branch, reconciled on 2026-09-26 with the accepted
  main `57915de` through merge `052db1f`, which no runtime validation has yet
  covered ([baseline §8](baseline.md#8-reconciliation-with-the-accepted-main-2026-09-26)).
  After the 2026-09-25 window, the
  PM9.1 browser baseline is established and PM9.2 has passed browser
  functional acceptance; PM9.2's visual and product acceptance is pending
  ([baseline §7.7](baseline.md#77-status-after-the-window)). PM9.3
  implementation starts only once PM9.2 closes.
- Test execution stays paused until the owner opens a window.
- The v5.11 HTML was re-hashed for this preparation: 490,253 bytes, SHA-256
  `d09b60e0…3896337`, the same as §3 of the baseline. It was read, not
  rendered.

## 0. Re-expansion on the current tree (2026-09-26)

**Rebound at** `717574426ec20e12ef674774483472e7062a1505` (tree
`7be7862b60687e7d0019b16ca2a78a2ca9948ff3`), on the PM9 branch, with the
accepted main `57915de` as an ancestor. Its frontend is the PM9.2 final
candidate `b81fc78`'s; `c5a3f7e` after it is test-only (the manual harness).
`git diff 9786809 HEAD` touches no viewer component: `Chromatogram.tsx`,
`SelectedSpectrumPanel.tsx`, `SpectrumViewport.tsx`, `SpectrumTable.tsx`,
`QuickFigureActions.tsx`, `PlotRangeActions.tsx`, `ChromatogramExportPanel.tsx`,
`usePreviewWorkspace.ts` and `viewer/` are unchanged. PM9.2 changed only the
shell around them (`PreviewWorkspace.tsx`'s surface title and placeholder
action, `workbench.css`), so §1's line references stand except those into
`PreviewWorkspace.tsx`. §1–§5 are reused as evidence, not rediscovered.

**What the midpoint gave this slice.** L13; the viewer-height question at
960×640 (the "panel floors"); the shared `openTheViewer` diagnosis and the
same toggle-then-wait copied into m7.3 and m7.4's viewer cases; L3, L5 and
L21's open parts; and a comparison of the pending band, the empty viewer entry
and the roster-open and Details-open states at 960×640.

### 0.1 Acceptance, in task terms

1. **L13.** At 960×640, in en and zh-CN, the chromatogram's header controls use
   one row. Every action it offers today stays offered, in a named group, and
   reachable by keyboard; no overflow menu, no hover-only route. The toolbar
   sees the evidence column's width, not the window's: the roster is open by
   default above 1050 px, so 1152×720 gives a narrower column than 960×640.
   So no viewer toolbar uses more than one row in any default panel
   arrangement of the eleven-size sweep either. Details opened by the reader
   at 1152–1536 px is recorded.
2. **Viewer height at 960×640.** Not a new pixel floor. The historical numbers
   are ADR 0033's panel floors (186 / 122 / 202 px, measured for a three-row
   grid) and ADR 0006's 544 px narrow budget (a 342 px stacked sidebar and a
   178 px viewer row). Both protected the same task:
   - each panel keeps its own controls whole rather than clipped;
   - both viewer headers are reachable;
   - the table keeps its sticky header and one complete row;
   - one internal scroll owner does the recovery, with no document or body
     overflow.

   The M7.2 fold removed that sidebar at this width, and M7.3 replaced the
   grid with a natural-height stack. The `.viewer-stack` grid rows in
   `app.css` are overridden by `workbench.css`'s flex column. So the
   requirement is read in those task terms and verified in the render, with
   a selected scan, in both languages:
   - the chromatogram plot is fully on screen at the evidence column's top;
   - the selected spectrum begins inside the viewport (the M7.3 record);
   - the spectrum's controls and the scan table's sticky header plus one
     complete row are reached by the evidence column's own scroll, with
     nothing clipped;
   - the document has no horizontal or vertical overflow;
   - no control is shrunk or hidden to fit.

   ADR 0006's numbers are unchanged. That they name a layout that no longer
   exists is recorded for the owner.
3. **Authorities unchanged.** §4's V1–V9 pass on the final candidate. No change
   to selection, viewport, range, projection, availability or export owners,
   and no new request, read, state, cache or poll.
4. **Helper.** Each copy of the narrow-window roster reveal is diagnosed by
   what it waits for and why it fails, with discriminating evidence before any
   repair. It is then repaired or consolidated narrowly, or the stale
   assertion is retired against named evidence, or the failure is recorded for
   its owner. The m7.2 copy is PM9.7's.
5. **Rendered.** The anchors 960×640, 1366×768 and 1920×1080 and the sweep,
   in en and zh-CN, with a keyboard sample and reduced motion. Also the entry
   state and the roster-open and Details-open states at 960×640. All
   controlled-IPC browser at DPR 1, never called native 150 % evidence.
6. **Findings.** Each new mismatch is classified A (required), B (optional
   polish) or C (future capability). Only A is implemented.

### 0.2 Approach

- **Before any production edit**, the PM9.3 spec's observation (G) is extended
  test-only to walk the sweep and record each viewer toolbar's row count, the
  entry and swap states, and the table's reachability. Its L13 assertion (one
  header row at every default arrangement) is expected to fail on the
  unchanged viewer. That run is PM9.3's before-capture. It is not PM9.1's J1–J6,
  which stays on `d56b17b`.
- **Helper**: one instrumented run of a failing 960 case first, recording the
  roster toggle's state at the click and after it. Repair follows the finding.
- **L13**: settled by the before-capture. The candidate is the arrangement the
  selected-spectrum panel already has: the header carries the title and the
  figure and export actions, and the plot's own controls sit on a row above the
  plot. For the chromatogram those controls are TIC/BPC, Zoom in, Zoom out and
  Reset range. Its cost is weighed against the height the wrap costs now.
  DOM dependencies to keep:
  - `paintFrame` finds `.chromatogram-range` through the SVG's parent;
  - `PlotRangeActions` finds the SVG through its root's parent.
- No pre-selected scan at entry: that would be a source read the reader did
  not ask for. Any entry change is presentation only.
- Files expected: `Chromatogram.tsx`, `app/app.css` (and `workbench.css` if the
  shell rule is the owner), their Vitest tests where they pin structure,
  `e2e/support/viewer.ts`, the m7.3 and m7.4 specs' reveal, and the PM9.3 spec.

### 0.3 Validation

On the final code candidate:

- `pnpm typecheck`, `pnpm e2e:typecheck`, the affected Vitest files, the full
  Vitest suite if viewer code changed materially, `pnpm build`,
  `python -B scripts/check_repo.py` and `git diff --check`;
- the PM9.3 spec in full;
- the legacy specs the helper diagnosis names (the `openTheViewer` callers and
  m7.3, m7.4-conversion-figures), not the whole legacy corpus.

Every browser group is admitted at ≥ 8 GiB available and ≤ 80 % used, and
stops at < 4 GiB or ≥ 90 %. A group the gate blocks is reported
RESOURCE_DEFERRED; it is not waited for. There are at most two substantive
product repair cycles. The first L13 implementation is not one.

## 1. Viewer ownership map

Read at the production tree of `9786809`. Paths are under
`apps/desktop/src/features/mzml-preview/` unless another path is given. Owners
are named as they are; this slice adds none.

| Concern | Owner (state) | Changed by | Control (test selector) | IPC | Late-answer guard |
| --- | --- | --- | --- | --- | --- |
| Viewed acquisition | roster reducer `active` (`usePreviewWorkspace.ts:995`, field `rosterSelection.ts:138`); `preview` state `:965`; `activeDataset` `:4199` | `activateDataset` `:2039` → `loadPreview` `:1678` | roster row `div[role=row].dataset-row[data-handle]` (`workbench/GroupedRosterList.tsx:253`); Enter; "Preview focused"; "Try reading this file again" | `open_mzml_preview`; `inspect_backend` on some failures | `previewToken`, authority revision, `activeOpen` |
| Selected scan (source index) | `ViewerInteractionState.selection {index, revision, retentionTime}` (`viewer/interactionState.ts:39-58`) in `useViewerInteraction` (`usePreviewWorkspace.ts:978`); the **loaded** spectrum is separate (`spectrum` `:968`) | `selectSpectrum` `:2529` (dispatches `selection-committed`, then loads) | chromatogram click (`Chromatogram.tsx:478`), table row / Enter / Space (`SpectrumTable.tsx:406`, `:276`), Previous/Next (`:302-320`); row `div.spectrum-table-row[data-row-position][data-source-index][aria-selected]` | `load_selected_spectrum` | `spectrumToken`, in-flight token, reducer-allocated revision |
| Chromatogram marker | derived from `selection.index` (`Chromatogram.tsx:252`, `:413`) | as above | `g.chromatogram-selected`; readout `#chromatogram-readout` | none | n/a |
| RT viewport | `fullDomain`, `committedDomain` (`null` = whole run), `gesture` (`interactionState.ts:94-114`); export reads `chromatogramCommittedDomain` (`usePreviewWorkspace.ts:3428`) | reducer cases `interactionState.ts:260-375`; planners `viewer/viewportAction.ts`; input port `viewer/plotInputAdapters.ts:38-76` | "Zoom in", "Zoom out", "Reset range"; wheel, Shift-wheel, middle/Space drag, keys, idle double activation; editor "Edit … range"; caption `.chromatogram-range` (transient during gestures) | none | gesture epoch, range transaction, editor snapshot |
| m/z viewport | `SpectrumViewportState` (`viewer/spectrumViewport.ts:245-262`) in `useSpectrumViewport` (`usePreviewWorkspace.ts:980`); export reads `spectrumCommittedDomain` `:3187` | `viewer/spectrumViewport.ts:328-542`; planners `viewer/spectrumViewportAction.ts` | "Zoom in m/z", "Zoom out m/z", "Reset m/z range"; `svg.spectrum-plot`; editor; caption `#spectrum-viewport-range`, status `#spectrum-viewport-status` | every commit → `project_selected_spectrum` (`usePreviewWorkspace.ts:2941-3000`) | projection generation, epoch, token, selection revision |
| Pending vs committed ranges | RT `rangeSelection {drawing\|pending}` (`interactionState.ts:106`); m/z `rangeSelection` (`spectrumViewport.ts:260`) | confirm: "Zoom to selection", Enter, click in band → `range-confirmed`; cancel: "Cancel range", Escape, click outside (cancel, then inspect) | `.plot-committed-range` ("Committed …" / "Pending …"), `.plot-pending-actions` (`PlotRangeActions.tsx:27-36`) | m/z confirm owes one projection; RT none | transaction identity |
| Scan table search, filter, sort | `useScanTableView` (`usePreviewWorkspace.ts:2752`; `viewer/useScanTableView.ts:18`); options reset when rows change (new preview) | `setQuery`, `setMsLevel`, `sortBy`, `clearFilters` (keeps sort) | search `input[type=search]`, MS level `select`, `.scan-sort-button` with `aria-sort` | none | n/a |
| Hidden selection | `selectedOutside` (`SpectrumTable.tsx:140`); filtering never changes the selection | "Clear filters and reveal" → `clearFilters` | `.scan-hidden-selection` | none | n/a |
| Previous / Next | `scanSteps` over the **displayed** projection (`usePreviewWorkspace.ts:2783-2803`); disabled when the selection is hidden | the same `selectSpectrum(index)` | "Previous scan", "Next scan" in `fieldset.spectrum-scan-steps` | `load_selected_spectrum` | as selected scan |
| Projection vs retained source | drawing = `project_selected_spectrum` answers only (`SpectrumViewport.tsx:345`); a refused viewport draws the transferred prefix; exports send only token + range + settings | — | — | projection only | generation |
| Figure settings | one session-wide string draft `figureSettings` (`usePreviewWorkspace.ts:2808`), validated by `figureSettingsValidation.ts`; render problem blocks SVG/PNG/Copy, DPI problem blocks PNG | `setFigureSetting`, `setFigureTheme` | fields `#<prefix>-widthPx`, `-heightPx`, `-pngDpi`; theme radios | none | n/a |
| Full vs Current | spectrum `spectrumRangeScope` (effective, reset to `full` on a new token or a lost viewport, `:3154-3172`); chromatogram `chromatogramRangeScope` (`:3394`, **never reset**) | radios `spectrum-range-scope`, `chromatogram-range-scope`; figure dialog | `input[name=…][value=full\|current]` | none | derived at invocation from the committed domain (`:3191-3216`, `:3431-3444`) |
| Copy plot | `copySpectrumPlot` `:3325`, `copyChromatogramPlot` `:3539`, `copyLinkedPlot` `:4145` | quick actions, panels, dialog | "Copy plot", "Copy linked plot" | `copy_selected_spectrum_plot`, `copy_chromatogram_plot`, `copy_linked_plot` | bound tokens / pair |
| SVG / PNG | `exportSpectrum` `:3218`, `exportChromatogram` `:3455`, `exportLinkedFigure` `:4081` | panels, Quick PNG, dialog (needs a current preview answer) | "Export SVG…", "Export PNG…", "Export linked SVG…/PNG…" | `begin_*_export` → `save_*_export` | bound tokens |
| CSV / TSV | the same spectrum and chromatogram handlers; not blocked by figure problems; **no linked data export** | `.spectrum-data-actions`; chromatogram panel | "Export CSV…", "Export TSV…"; running initiator stays focusable with `aria-disabled` | `begin_selected_spectrum_export`, `begin_chromatogram_export` | bound tokens |
| Linked figure | `linkedFigureExport` `:2842`, `boundLinkedPair` `:3953`, `linkedFigureUnavailable` `:4010` (no chromatogram, loading, no spectrum, no trace, outside, settings, height < 260) | inside `#chromatogram-export-panel` only (toggle `#chromatogram-export-toggle`) | `#chromatogram-linked-section`, `#chromatogram-linked-unavailable` | `begin_linked_figure_export`, `copy_linked_plot`, `preview_figure` | pair plus answer ownership |
| Selection availability | `spectrumSelectionAvailability` (`viewer/selectionAvailability.ts:109-130`): no run → backend changing → backend unavailable → conversion running; `previewBackendBusy` deliberately excluded | lane facts | notice `p[data-live-region="spectrum-selection-availability"]`; plot, rows and Previous/Next gated; hover, zoom and pan stay live | none (reads lane state) | refs at operation time |

Every export reads one scientific lane, `scientificExportBusy`
(`usePreviewWorkspace.ts:2861`), which includes the figure preview.

Observations for implementation, not defects:

- The chromatogram scope is never reset across previews, while the spectrum
  scope is. `setChromatogramRangeScope` (`usePreviewWorkspace.ts:3394`) is
  called only from the panel and the dialog (`PreviewWorkspace.tsx:751`,
  `:908`). The spectrum scope is reset by the effects at
  `usePreviewWorkspace.ts:3161-3172`. The committed RT domain resets with the
  preview, so a kept `current` then means the whole run. Whether that is
  intended is undocumented. PM9.3-V9 records it and does not assert it.
- A scan selected outside a committed RT range pans the committed domain and
  clears a pending band (`interactionState.ts:399-408`). That moves what a
  Current export covers. This is the reveal rule of ADR 0032, not a new
  behaviour.
- A failed spectrum load leaves the selection on the new index, while exports
  and the linked pair use the loaded spectrum. `selection-committed` is
  dispatched before the read (`usePreviewWorkspace.ts:2587`). The failure
  branch (`:2627-2660`) sets the spectrum to `failed` and reverts nothing,
  unless the backend changed, in which case the derived state is discarded.
- `exportLinkedFigure` substitutes the default DPI for an unusable one inside
  the hook: `figureSettingsFor` (`usePreviewWorkspace.ts:456-461`) is called at
  `:4087-4090`. The panel (`ChromatogramExportPanel.tsx`, `rasterBlocked`) and
  the dialog already refuse PNG in that state.

## 2. User actions by class

- **A**: presentation only.
- **B**: local viewer-state mutation.
- **C**: existing backend/source request.
- **D**: scientific/export authority.

| Action | Class | Request |
| --- | --- | --- |
| Roster row click, Enter, "Preview focused", retry read | C | `open_mzml_preview` |
| Chromatogram click (no band) | B + C | `load_selected_spectrum`, then a projection |
| Click inside a pending band | B | none (confirm) |
| Click outside a pending band | B + C | cancel, then `load_selected_spectrum` |
| Hover, leave | B | none |
| Table row click, Enter, Space; Previous; Next | B + C | `load_selected_spectrum` |
| Table focus keys, table scroll | A | none |
| Search, MS level, sort, "Clear filters and reveal" | B | none; selection unchanged |
| TIC/BPC toggle | B | none |
| RT zoom, pan, wheel, keys, reset, typed Apply, range drag, confirm, cancel | B | none |
| m/z zoom, pan, wheel, keys, reset, typed Apply, confirm | B + C | `project_selected_spectrum` |
| m/z drag to pending, cancel, gesture frames | B | none |
| "Draw this m/z range again" | C | `project_selected_spectrum` |
| "Try loading this spectrum again" | C | `load_selected_spectrum` |
| Open or close the export toggle or disclosure; help and details disclosures | A | none |
| Open the figure dialog; change settings or scope inside it | B + C | `preview_figure` |
| Change figure settings or scope in a panel | B | none |
| Copy plot (spectrum, chromatogram, linked) | D | `copy_*` |
| SVG / PNG / Quick PNG (spectrum, chromatogram, linked) | D | `begin_*_export` → `save_*_export` |
| CSV / TSV (spectrum, chromatogram) | D | `begin_*_export` → `save_*_export` |

Only D writes a file or the clipboard, and only C reads a source or the
retained data.

## 3. Static v5.11 mismatch ledger

The reference was read from its markup, CSS and JS in the owner's unpacked
bundle. That bundle has the same hash, and each cited string was located in
the hashed HTML. Nothing was rendered.

Kinds:

- **VERIFIED STRUCTURAL DIFFERENCE**: established from source on both sides.
- **INTENTIONAL CONTRACT DIFFERENCE**: a repository document records the
  production arrangement.
- **HYPOTHESIS — NEEDS RENDER**: depends on size, density or visual weight.

No row is a verdict of visual quality or parity.

| Area | Reference | Production | Kind |
| --- | --- | --- | --- |
| First-view hierarchy | Sample title, then tabs ("chromatogram and spectrum" default), then trace choice, then chromatogram (declared ≈245 px), then scans with a spectrum **already selected** (scan 1) | Chromatogram panel first; no identity heading or tabs in the evidence column (the file name is in the header context line and Details); the spectrum panel opens **empty** ("select a table row or click the chromatogram"); declared plot heights 150 / 220 px | Order and entry state: VERIFIED STRUCTURAL. Relative dominance: NEEDS RENDER. The M7.3 record says "plots and the selected scan remain prominent at entry", and at entry no scan is selected; PM9.3 decides this with a render, not by assumption |
| Chromatogram / spectrum / scans | Chromatogram full width; below it, the scan list **left** and the spectrum **right** (stacks at ≤1320 px); tabs for scans, RT×m/z map, metadata | Three stacked panels: chromatogram, spectrum, scans; no tabs | INTENTIONAL CONTRACT ([DESIGN_SYSTEM](../../ux/DESIGN_SYSTEM.md#durable-v511-reference-baseline), M7.3 "the composition is chromatogram, selected spectrum, then bounded scans"). Side-by-side vs stacked: VERIFIED STRUCTURAL. The RT×m/z map has no production capability (not applicable). `app/app.css` comments near the `.viewer-stack` rules still describe a chromatogram → scans → spectrum grid with floors; `workbench.css:92` makes the shell's stack a flex column, so those floors are probably inert (static cascade reading; confirm with a render) |
| Plot-adjacent controls | No persistent zoom; a hover or focus-revealed corner (expand, ··· menu); a context menu with view history, bounds, auto peak height, interval selection, SVG | Persistent zoom in/out/reset groups; TIC/BPC checkboxes; quick figure actions in each panel header; range editor and help as `<details>`; no context menu, focus mode or view history | VERIFIED STRUCTURAL. DESIGN_SYSTEM's "no permanent mode strip" and keyboard/non-gesture equivalents cover plain buttons. View history and auto peak height have no production owner, and adding them is new behaviour, not presentation |
| Committed / pending feedback | Drag, then a pending dashed band and a strip ("selected a–b", zoom to selection, cancel, and "use for RT filter" on RT), guidance only while pending; confirming zooms; numeric "select interval" creates a pending band; no chromatogram marker, and a chromatogram click does nothing | The same pending → confirm/cancel grammar (`.plot-range-band`, "Pending …" line, "Zoom to selection" / "Cancel range"); the line is always shown ("Committed …" otherwise); numeric Apply commits directly; chromatogram marker and click-to-select | Pending/confirm grammar: INTENTIONAL CONTRACT (M7.3). Always-visible committed line, direct numeric commit, and chromatogram-to-scan linking: VERIFIED STRUCTURAL. "Use for RT filter" has no production counterpart and is out of scope. Band salience: NEEDS RENDER |
| Inspector / Details | Always a right column (285/1fr/245 at 1920×1080 and 240/1fr/245 at 1366×768, measured in baseline §3.1), stacked below at ≤1320 and ≤960; sample-level facts; scan facts in the main column | A right column of 245 px only when Details is toggled or the window is ≥1700 px wide (`panelPresentation.ts:31`, `:73-75`); run-level summary; scan facts in the spectrum panel's "details and identifiers" disclosure | Column width: INTENTIONAL CONTRACT (DESIGN_SYSTEM). Hidden by default below 1700 px, and its content scope: VERIFIED STRUCTURAL (the default is recorded only in a code comment). Rendered Details state: observed only where it opens by default at 1920×1080 (baseline §3.1, L3 and L12); the toggled-open state below 1700 px was not captured |
| Export discoverability | Viewer: SVG of the current view only, from the hover-revealed menu; a separate export-and-records page | Visible "Export figure", "Quick PNG", "Copy plot" in each plot header; a chromatogram "Export" toggle and an "Export spectrum" disclosure with Full/Current, settings, SVG/PNG/Copy, CSV/TSV and the linked figure | Placement: INTENTIONAL CONTRACT (DESIGN_SYSTEM, M7.3 "reachable disclosures"); formats are production capabilities the reference does not model. Prominence: NEEDS RENDER |
| Responsive folding | ≤1320: two columns, inspector below, scans over spectrum; ≤960: one column, collapsible roster, inspector stacked; ≤620: hints hidden | ≤1050 (JS and CSS): one region at a time, and the evidence is hidden while the roster or Details is open; ≥1700: Details automatic; `app.css` rules at ≤1120 probably inert; the range editor narrows at ≤600 | Fold at 1050 into header actions: INTENTIONAL CONTRACT (DESIGN_SYSTEM). Swap rather than stack, with no middle stage: VERIFIED STRUCTURAL. Heights, scroll and what is visible without scrolling: NEEDS RENDER (PM9.1 G and PM9.3 G record them) |
| Explanatory copy / disclosure | Header gesture strip; plot-foot disclaimers; guidance only while pending; screen-reader-only hint; help modal (`?`, menu); no `<details>` | Unit and range captions, readouts, counts and export notes always visible; per-plot "Plot gestures" help and several other `<details>`; header drop hint (and, in the PM9.2 draft, the context line) | Header hint and context line: a PM9.2 action (baseline §3 and §3.1, L14–L16). Disclosures: INTENTIONAL CONTRACT (DESIGN_SYSTEM, M7.3). Against the modal/menu model: VERIFIED STRUCTURAL. Copy density: NEEDS RENDER |

Before PM9.3 changes presentation, a render must settle:

- whether the first view makes the evidence dominant at 1366×768 and 960×640
  after the PM9.2 header;
- whether the empty spectrum panel at entry reads as a gap or an invitation;
- how salient the band and its actions are;
- how prominent the export entries are next to the plots;
- what the 1050 swap leaves on screen.

The comparison with the reference is Chinese-only, as recorded in baseline §3.

The 2026-09-25 render ([baseline §3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25))
answered part of the first question by position: the chromatogram panel starts
at y 189 and is fully on screen in every idle (Workbench) frame, while at
960×640 the spectrum panel shows only its title and actions (L4). Its
dominance over the panel chrome is still PM9.3's to judge. PM9.3's own G
frames (`test-results/pm9.3/browser-l7oU7m/`) recorded a pending m/z band's
actions and range lines, and the export entries, at all three viewports as DOM
readings. On screen, the band, its actions and the pending line appear only
at 1920×1080: the spectrum plot is 220, 43 and 0 px on screen at 1920×1080,
1366×768 and 960×640. Neither the band's salience nor the export entries'
prominence has been judged or compared with the reference. The empty entry state and the
roster-open and Details-open states of the swap were not captured. The render
also confirmed one PM9.3 defect, **L13**: in
English at 960×640 the chromatogram toolbar wraps to two rows, contrary to the
design-system rule that toolbars must not grow into wrapping ribbons. It
predates PM9.2 and is not fixed yet. It is **the first implementation item of
PM9.3**, after PM9.2 closes.

## 4. PM9.3 browser acceptance spec

`e2e/specs/pm9.3-viewer.browser.e2e.ts`.

- **Harness:** the existing harness (IPC boundary preloaded; the M8.2/M9.1 CDP
  viewport with DPR 1; M8.5's roster reveal; M7.3's gesture shapes).
- **Answers:** `answerBySource()`, a test-only wrapper on the harness `invoke`
  modelled on M7.3's `sourceBoundary`. It answers each preview, spectrum and
  projection for what was asked. Nothing in the application is patched, and
  there is no production mock mode.
- **Not used:** `openTheViewer` and the DPR-waiting `metrics()` helpers.
- **Backing:** every case is mock-backed.
- **Result:** 11 of 11 PASS on `a0783bb`, one invocation inside the 2026-09-25
  campaign ([baseline §7.5](baseline.md#75-full-browser-campaign)), against the
  unchanged viewer (PM9.2 only reads its state for the context line). It shows
  that the harness and the contracts below execute; it is not PM9.3
  implementation.
- **Evidence:** written under `MSCANVAS_PM9_OUTPUT_ROOT`, default
  `test-results/pm9.3/` (git-ignored; the window's run is
  `test-results/pm9.3/browser-l7oU7m/`).
- **Command (in an owner-opened window, after `pnpm e2e:typecheck`):**

```text
pnpm e2e:browser --spec ./e2e/specs/pm9.3-viewer.browser.e2e.ts
```

| Case | Contract (owner) | Expected | Status |
| --- | --- | --- | --- |
| V1 | One source index behind table, Previous/Next and chromatogram (ADR 0032 D; `selectSpectrum`) | Table row 3, Next, Previous, then a chromatogram click at scan 6 send `load_selected_spectrum` indices `[3, 4, 3, 6]`. After each, the selected row, the marker and "Spectrum N," agree. One preview read | PASS |
| V2 | Search, filter and sort never replace a hidden selection (ADR 0032 M7.3 amendment; `SpectrumTable`) | With a descending sort and a search, a hidden scan 3 keeps its spectrum and shows the outside-results sentence. Previous and Next are disabled, and no read happens. "Clear filters and reveal" restores it with the sort kept, and Next then selects 2 | PASS |
| V3 | A pending RT band is not Current authority (ADR 0034; M7.3) | A released band stays "Pending". Exporting CSV over Current sends `{scope: current, low: null, high: null}` | PASS |
| V4 | A committed range is the Current path (ADR 0034) | "Zoom to selection" commits. The panel note is exactly the committed-range sentence, and CSV sends those bounds. With a new band pending over it, CSV still sends the committed bounds. Full then sends `{scope: full, null, null}` | PASS |
| V5 | Viewport moves are not source reads (ADR 0038, `lib.rs` projection doc) | RT zoom, zoom out, reset and wheel, a band and its cancel, and m/z zoom and reset issue no `open_mzml_preview` or `load_selected_spectrum`. The only request is `project_selected_spectrum` | PASS |
| V6 | m/z context follows the spectrum (ADR 0038, 0040) | The zoomed caption and a Current scope survive Conversion → Project → Workbench with no source read. The next scan opens at "(full range)", with the scope back at Full | PASS |
| V7 | A refused viewport is honest and keeps data export (ADR 0040) | The caption says there is no range and the status gives the refusal. The m/z controls are disabled, with no Current radio and the no-viewport note. CSV still sends `{scope: full, null, null}` | PASS |
| V8 | Exports stay format-specific (ADR 0029/0030/0036) | Spectrum figure `[SVG, PNG, Copy]` and data `[CSV, TSV]` are separate groups, and the linked section has no CSV or TSV. Chromatogram TSV, spectrum PNG and linked SVG each send their own command and format | PASS |
| V9 | Shell navigation keeps viewer context; a new preview resets only what the owners reset (ADR 0032 `preview-loaded`) | Selection, committed RT range, m/z caption, search, scope and the figure-width draft survive a shell trip with no source read. Opening the second acquisition clears the selection, the marker and the committed range. The run scope, search and draft after it are recorded, not asserted | PASS |
| G (×2) | Observation (U9) | en and zh-CN (reduced motion in zh-CN): one state (selected scan, committed RT range, pending m/z band) at 1920×1080 → 1366×768 → 960×640. Records panel boxes, on-screen plot heights, the evidence scroll, range lines and export entries. Asserts only the page language, overflow ≤ 1 px, no off-origin request, and no console entry other than motion's reduced-motion notice in zh-CN | PASS (observation) |

Nothing in this spec re-proves what Vitest already covers at component or hook
level (§5). Its value is the rendered layer: real pointer gestures, real
requests, and the owners working together.

## 5. Legacy browser specs relevant to PM9.3

Classified from the recorded evidence only
(`docs/spikes/M9_CLOSURE_EVIDENCE.md` §8, the retained reporter log
`.tmp/m9-closure-evidence/baseline/02-e2e-browser-full.log`, and the
current-code runs it cites). Nothing was run. No test is deleted, and
UNKNOWN is not obsolete.

Failure families:

- (a) the shared `openTheViewer` toggle-then-wait at 960×640
  (`e2e/support/viewer.ts:137-138`);
- (b) stale spec-local setup: the `li.dataset-row` selector, the closed export
  `<details>`, and `label*=` field lookups that `SettingField` no longer
  matches;
- (c) an assertion the product has since replaced;
- (d) driver geometry ("move target out of bounds").

| Spec (total / failing) | Group | Class | Evidence and replacement |
| --- | --- | --- | --- |
| m4.1 (17 / 17) | all groups: panel layout, keyboard, flows, binding, states, console | STILL_VALID_CONTRACT | (b) at setup, so no assertion was ever reached. Flows are covered at component and hook level (`SelectedSpectrumExport.test.tsx`, `SelectedSpectrumExportBinding.test.tsx`). Layout, focus ring and console are rendered-only. The outcome is unknown until a repaired first run (selector, and open the disclosure) |
| m4.2 (15 / 15) | figure settings across the boundary, refusals, viewports, keyboard | STILL_VALID_CONTRACT | (b) at setup (selector, closed disclosure, `label*=` lookup). Hook and component coverage as above; "reopens once valid" has no Vitest test |
| m4.3 (23 / 10) | range scope and export behaviour | STILL_VALID_CONTRACT | Passing except the next row. Also covered by `app/ChromatogramExport.test.tsx` and PM9.3-V3/V4 |
| m4.3 | "says a current range is the whole run until the viewport is committed" | SUPERSEDED (copy only) | Expects the pre-M7.3 sentence. Replacement: `ChromatogramExport.test.tsx` "says a current range is the whole run until the viewport is committed"; request: PM9.3-V3 |
| m4.3 | within reach and linked panels apart at 1366 and 1920 | UNKNOWN_NEEDS_FIRST_RUN | Its fixed numbers predate the M7.3 stack. Whether the geometry is stale or the layout regressed needs a render |
| m4.3 | reach with settings unusable; vendor-row focus; 960 cases | STILL_VALID_CONTRACT | (b) and (a) setup |
| m4.4 (18 / 10) | pair, range, traces, copy, 259/260, outside range | STILL_VALID_CONTRACT | Covered by `LinkedFigureExport.test.tsx` and `LinkedFigureBinding.test.tsx`. 259/260 is (b). "Outside the current range" is (d): UNKNOWN_NEEDS_FIRST_RUN for the rendered half |
| m4.4 | within reach and views apart at 1366 and 1920 | UNKNOWN_NEEDS_FIRST_RUN | Pre-M7.3 geometry; needs a render |
| m4.4 | 960 cases | STILL_VALID_CONTRACT | (a) |
| m5.2 (48 / 12) | controls, keyboard, wheel and host ownership, request frequency, states (36 passing) | STILL_VALID_CONTRACT | Also covered by `SpectrumViewport.test.tsx` and `SpectrumViewportBinding.test.tsx`; requests also by PM9.3-V5 |
| m5.2 | "pans from where the press began" (primary drag) | SUPERSEDED | M7.3: primary drag proposes a band, and middle/Space drag pans. Replacement: `SpectrumViewport.test.tsx` "pans from where the press began rather than from the previous frame" (middle button) and m7.3 "keeps numeric raw text, IME and host keys separate and supports wheel and pan with reduced motion" |
| m5.2 | drag-in-flight caption, empty window, cannot be navigated, retained-source note | SUPERSEDED (copy only) | Replacement: `SpectrumViewport.test.tsx` "tells an empty window, a drawing not yet arrived, a failure and a refusal apart" and the "a spectrum with no m/z range to navigate" group; `App.test.tsx` "describes a truncated spectrum by its whole-spectrum peak, not the prefix"; refusal rendered by PM9.3-V7 |
| m5.2 | "has a column with somewhere to scroll to", and the m/z controls' overflow at 1366 and 1920 | STILL_VALID_CONTRACT (stale target) | The contract still holds: a wheel the plot cannot use falls through to page scrolling. M7.2/M7.3 moved the scroll owner to `#workbench-evidence` (`workbench.css:36`), and the assertion still reads the old column; re-point it there. `SpectrumViewport.test.tsx` "leaves a wheel that cannot widen the whole spectrum to the browser" covers only the plot's half. No test yet asserts the rendered fall-through, and PM9.3 G only records scroll |
| m5.2 | 960 cases | STILL_VALID_CONTRACT | (a) |
| m5.3 (13 / 13) | Full/Current, committed window, no viewport, failed drawing, range fixed at begin, empty range, new spectrum, linked unaffected | STILL_VALID_CONTRACT | 12 × (b) (disclosure never opened), 1 × (a). Covered at hook level by `SelectedSpectrumExportBinding.test.tsx`; new spectrum at Full also by PM9.3-V6, and no viewport by V7. After a repaired first run, one copy expectation is expected to fail (inference) |
| m5.7 (8 / 1) | availability sentence, no reads while blocked, live navigation | STILL_VALID_CONTRACT | Only the 960 case fails, on (a). `SelectionAvailability.test.tsx` covers the rest 1:1 |
| m7.3 (16 / 3) | identity, search and sort, pending band, projection states, raw numbers, data-export focus | STILL_VALID_CONTRACT | 13 pass. The initial-evidence and touch cases at 960 fail on the (a) pattern (`m7.3:97-99`); PM9.3-V1, V2 and V3 cover the same contracts at 1920 |
| m7.3 | 100,000 rows: "horizontally scrolled headers" (`scrollLeft` 0) | UNKNOWN_NEEDS_FIRST_RUN | Rendered assertion, undiagnosed; the windowing and End checks before it passed |
| m7.4-conversion-figures (16 / 6) | linked preview at zh-CN 960; empty figure at 960 | STILL_VALID_CONTRACT | (a) pattern (`m7.4:93-95`); en at 1366 passes. Also covered by `M74FigureComposition.test.tsx` |
| m7.4-conversion-figures | conversion intent ×2; active Clear ×2 | UNRELATED_TO_PM9_3 | PM9.4 (intent) and PM9.2 (Clear, the same roster-toggle family) |
| m7.4-preview-observer (7 / 0) | harness self-test | UNRELATED_TO_PM9_3 | No application; passes |
| m7.2 (11 / 10) | "keeps empty, reading and failed evidence reachable…"; "reveals accepted roster previews…" | UNRELATED_TO_PM9_3 | Shell and roster, owned by PM9.2 (baseline §2); both fail at the 960 toggle before any assertion |
| viewer-r1-linked-viewer (54 / 14) | linked selection, keyboard, wheel, host input, single scan (40 passing) | STILL_VALID_CONTRACT | Also covered by `Chromatogram.test.tsx`, `app/LinkedViewer.test.tsx`, `SpectrumTable.test.tsx` and `viewerSelectionAuthority.test.tsx`; identity also by PM9.3-V1 |
| viewer-r1-linked-viewer | "one path per trace", "back to a line" (circle counts) | SUPERSEDED | The browser counts hidden circles that the product now renders on purpose. Replacement: `Chromatogram.test.tsx` "draws one path per trace rather than one node per scan" (counts visible glyphs) |
| viewer-r1-linked-viewer | "traces and units" caption; single-scan mark caption | SUPERSEDED (copy moved into a disclosure) | Replacement: `Chromatogram.test.tsx` "says the values come from the loaded table and are not a stored record" |
| viewer-r1-linked-viewer | "pans on a real drag" | SUPERSEDED | As m5.2: replacement `Chromatogram.test.tsx` "pans on a drag without changing the span, and does not select" (middle button) and the m7.3 wheel-and-pan case |
| viewer-r1-linked-viewer | column to scroll at 1366 | STILL_VALID_CONTRACT (stale target) | As m5.2. `Chromatogram.test.tsx` "leaves a wheel that cannot widen the run to the browser" covers the plot's half |
| viewer-r1-linked-viewer | scan steps and panels clear at 1366 and 1920; row below the header not moved | UNKNOWN_NEEDS_FIRST_RUN | Pre-M7.3 geometry, and one (d) |
| viewer-r1-linked-viewer | vendor-row focus; no chromatogram; 960 cases | STILL_VALID_CONTRACT | (b) and (a) |
| viewer-r1-scale (3 / 1) | windowing (circle count) | SUPERSEDED | Same hidden-circle drift. Replacement: `app/LinkedViewer.test.tsx` "keeps the table windowed and the trace bounded at acquisition scale" |

When PM9.3 opens its window, first repair the shared helper once (family a;
baseline §2), then the family-(b) setups. After that:

- run SUPERSEDED rows only to confirm the named replacement holds before
  retiring them;
- run UNKNOWN rows after a render re-derives their geometry.

The budget and unfreeze condition in [slices.md](slices.md) still apply.

## 6. Pending (needs a validation window)

1. Run `pm9.3-viewer.browser.e2e.ts` and the corrected PM9.1 spec on the
   cumulative candidate; record exits. **Done** on `a0783bb`: 11 of 11 and 14
   of 14 ([baseline §7](baseline.md#7-validation-window-2026-09-25)).
2. Render the current viewer at 1920×1080, 1366×768 and 960×640 in en and
   zh-CN, then render the reference at the same viewports. Settle the
   NEEDS RENDER rows in §3 and fill baseline §3's production column.
   **Partly done:** the reference and PM9.1's observation states are rendered
   and baseline §3 is filled (§3.1). PM9.3's own G frames were recorded later,
   in the campaign (baseline §7.5; `test-results/pm9.3/browser-l7oU7m/`). The
   §3 questions the render did not answer are listed at the end of §3.
3. Measure J1 (curate and inspect) and J5's viewer exports before any
   presentation change.
4. Repair, then rerun, the legacy specs in §5 in the stated order.
5. Only then decide and implement the presentation changes the evidence
   supports, within the owners in §1, and update the product and design
   records. The first implementation item, once PM9.2 closes, is the confirmed
   defect L13 (§3).

## Not in this slice

- New owners, stores, caches or polling.
- XIC, overlays, multi-layer comparison, the RT×m/z map.
- View history, auto peak height or any other new viewer behaviour.
- New units or processing.
- New clipboard capability or exporters.
- Changing export content or figure text.
- Deleting red tests.
- Rust, IPC or schema changes.
- PM9.4 onward.

## Completion (after a validation window)

- The §4 specs pass on the cumulative candidate.
- The §5 legacy specs are repaired, retired against their named replacements,
  or recorded with a diagnosis.
- The NEEDS RENDER rows are settled.
- Any presentation change is rendered at the three viewports in both
  languages, with keyboard and reduced-motion samples.

Until then U3, U8 and U9 for the viewer are **PLANNED**, with static
preparation only. None is met yet: the §4 spec passes 11 of 11 on `a0783bb`,
which carries no PM9.3 change, so it shows only that the authored harness
executes against the unchanged viewer; the first criterion applies to the
candidate that carries PM9.3's changes.
