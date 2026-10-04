# PM9.3 — evidence-first viewer: chromatogram, scans, spectrum, inspection and export

PM9 | Acceptance: U3, U8 (viewer), U9, U10 | Depends on: PM9.2 | Serial, one writer
Status: **PM9.3 VIEWER PRODUCT CONVERGENCE COMPLETE — FOCUSED RENDERED
ACCEPTANCE PASS** (2026-09-28, §0.5). The final candidate is `d98432b`, whose
production code is `55c30f3`'s. It was implemented on 2026-09-26 with its
rendered acceptance deferred for memory (§0.4). It was re-expanded on
2026-09-26 against the current tree (§0). §1–§5 are the static preparation,
kept as evidence; §0 replaces §6 as the plan.

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

### 0.4 Implementation state

- `e31aba3` (test-only). One shared `revealRosterRow` in
  `e2e/support/viewer.ts` replaces the reveal in `openTheViewer`, in m7.3's
  `open` and in m7.4's `viewer`, and PM9.3-G is extended as §0.2 describes.
  - **Static diagnosis:** the shared answer table replies to every
    `save_ui_preferences` with one fixed record whose layout is `automatic`.
    `SessionPreferencesProvider.commitLayout` adopts the layout a save
    confirms. So a roster toggled open below 1050 px is folded again when its
    save is answered. That fits both recorded failures: m5.7's "still not
    displayed after 15000ms" at `viewer.ts:138`, and m7.3's "did not become
    interactable" on the row it clicks next.
  - It is not a product defect: Rust merges the request onto the stored
    record and reads it back.
  - The helper now installs a store that reads back what it was asked to save,
    presses the toggle once it is operable (it refuses a press while
    preferences load), and waits for the row.
  - The discriminating run is still owed: one 960×640 reveal with the shared
    table and one with the read-back store, recording the toggle's
    `aria-disabled` and `aria-expanded` and the roster's `hidden` around the
    press.
- `47c981b` (production, L13). The chromatogram header now carries the title
  and the figure and export actions, as the selected spectrum's does. TIC/BPC
  and Zoom in, Zoom out and Reset range sit on a line above the plot, where the
  spectrum keeps its m/z controls. Header content is about 610 px in English
  instead of about 900, against an evidence column of about 800 px at 1152×720
  with the roster open, the narrowest default arrangement. The expected cost is
  that line, about 44 px of chromatogram height, except in English at 960×640,
  where it replaces the second header row. It is weighed in the render.
- A static review of both commits (one read-only reviewer) confirmed the
  diagnosis and found five things. Each is corrected test-only in `eeeb7c6`,
  except the last, which is a product item:
  - the row count read a label over its input, beside a 32 px summary, as two
    rows;
  - it ignored the heading, so actions dropping below the title as a whole
    would pass;
  - `setPanel` relied on an earlier reveal to have installed the read-back
    store;
  - the reveal would close a roster already open;
  - the selected spectrum's header stacks its Export spectrum disclosure on a
    line of its own under the figure actions at every width. Its wrapper had
    no rule, so it was a plain block.
- `696602c` (production, category A). The spectrum header's figure actions
  and its Export spectrum disclosure now share one wrapping line, as the
  chromatogram's figure actions and Export toggle do. Opened, the disclosure
  still takes the whole width below them.
- Static checks on `d51ee21` (tree `f06aa6b`), whose `apps/`, `e2e/` and
  `scripts/` equal `696602c`'s, all exit 0, run once:
  - `pnpm typecheck`;
  - `pnpm e2e:typecheck`;
  - one Vitest invocation, 18 files and 376 tests: `Chromatogram`,
    `ChromatogramExport`, `LinkedViewer`, `LinkedFigureExport`,
    `SelectionAvailability`, `viewerSelectionAuthority`, `narrowLayout`,
    `QuickFigureActions`, `LinkedFigureBinding`, `SelectedSpectrumExport`,
    `cssom` and the seven files under `src/features/workbench`;
  - `python -B scripts/check_repo.py`;
  - `git diff --check`.

  Earlier partial runs during implementation are superseded by this one.
- **RESOURCE_DEFERRED (2026-09-26).** Every browser group was refused at
  admission. Every reading from the session's first check to 15:45 fell
  between 2.60 and 7.53 GiB available and 76.2–91.8 % used, against ≥ 8 GiB and ≤ 80 %. Nothing
  was waited for and no workload was touched. Deferred:
  - the helper's discriminating run;
  - the before-capture;
  - the PM9.3 spec (V1–V9 and both G cases);
  - the legacy reruns;
  - the rendered acceptance.

  The full Vitest suite and `pnpm build` are deferred with them.
- **Next window, in order:**
  1. The discriminating run. Its temporary spec is not in the tree; it
     reproduces the reveal twice at 960×640, with the shared table and with
     `readBackSavedLayout`, recording the toggle's `aria-disabled` and
     `aria-expanded` and the roster's `hidden`.
  2. The before-capture: PM9.3-G with `Chromatogram.tsx`, `app/app.css` and
     `workbench.css` restored from `eae0fc3`, then the tree verified against
     `HEAD`. It is expected to fail its L13 assertion.
  3. The PM9.3 spec on the candidate.
  4. m5.7, m7.3, m7.4-conversion-figures, m4.3, m4.4, m5.2, m5.3,
     viewer-r1-linked-viewer and viewer-r1-scale, one at a time. Each is
     compared by stable identity with the 2026-09-25 campaign; a newly reached
     assertion is classified, not patched.
  5. The full Vitest suite and `pnpm build`.
  6. The rendered judgement at the anchors and in the sweep.
- **Outside the helper repair, recorded:**
  - m4.1 and m4.2 fail at their own stale setup (family b, `li.dataset-row`
    and a closed disclosure), not at the helper, and this dispatch does not
    rerun them. They go to PM9.7's regression gate with the other stale-setup
    specs.
  - m7.4's two active-Clear cases and m7.2's copies toggle a panel the same
    way and stay PM9.7's (baseline §10). Calling `readBackSavedLayout()`
    before each toggle is the expected repair.
  - The shared table's fixed save record also reads `locale: "en"` back after
    Settings applies zh-CN, and the shell adopts what a save confirms. m7.3
    and m7.4's zh-CN cases, which apply the language through Settings, may
    therefore render in English. This is unconfirmed until those specs run.

### 0.5 Validation, repair and closure (2026-09-28)

**Window.** The owner reopened it.

- Admission: 12.27 GiB available, 61.3 % used.
- Every heavy command read 11.73–13.74 GiB available and 56.8–63.0 % used,
  so no emergency stop.
- Every browser result below is controlled-IPC Chrome at DPR 1 over
  synthetic answers. None of it is native evidence at 150 %.
- Frames are under `test-results/pm9.3/{before,after,cycle1*,final}/`
  (git-ignored). Logs stayed in the session scratchpad.

**Helper diagnosis: a test helper bug, confirmed.** One discriminating run
with the temporary spec of §0.4, two reveals at a 960×640 window:

- **Shared table.** The toggle was operable at the press (no
  `aria-disabled`). The save asked for `roster: "shown"` and was answered
  `automatic`. By the next driver command the roster was `hidden` again, and
  it stayed hidden.
- **Read-back store.** The roster opened and stayed open.

The refusal while preferences load played no part. `openTheViewer`'s
`setWindowSize(960, 640)` gives a 938×486 viewport; the failures do not
depend on that, and it is recorded, not changed.

The same fixed record also reads back `locale: "en"`:

- m7.4's zh-CN failure shot shows English after Settings applied zh-CN;
- m7.3's 100000-row case lost the Details it had toggled.

`readBackSavedLayout` became `readBackSavedPreferences` (`17c29a9`) and
echoes both groups. `revealRosterRow` installs it, and so do PM9.3's
`setPanel` and m7.3's and m7.4's `preferences()`, before they save.

**Before-capture.** Production of `eae0fc3` with the tests of `1012f4e`
(`test-results/pm9.3/before/browser-B9rgaP`). The L13 assertion failed, as
expected:

- in en, the chromatogram header took two rows at 960×640 (entry and
  selected) and at 1152×720 (roster open, 828 px column);
- the spectrum header took two rows at every size in both languages, with
  Export spectrum on a line of its own.

One reading was unsettled: zh-CN 1920×1080 still carried the 2560×1440
frame's height, 360 px over. `2ab6f5f` now observes a frame only once the
shell fills the viewport, as PM9.1 does.

**Repair cycle 1 (`55c30f3`), the only one used.**

- *Failed condition.* The helper repair let m7.3's 960×640 case reach its
  assertion: the selected spectrum's plot must begin inside the window (M7.3
  recorded 592.8). It began at 663.6 on `696602c`. In the recorded runs,
  such as `a0783bb` and the M9 closure, that case failed at setup, so when it
  last passed is not known.
- *Before PM9.3.* It was below the window too, at about 644 in zh-CN and 695
  in en, estimated from the before-capture's geometry.
- *Diagnosis.* Three things pushed it down:
  - the quick-action caption line under the buttons in both plot headers.
    The caption came with M7.4 (`e495464`), after M7.3's measurement; that
    it is what moved the plot since then is an inference;
  - the spectrum header's Export spectrum line (already fixed in `696602c`);
  - L13's controls line, 44 px.
- *Fix.*
  - The caption moves before the buttons, on their line, capped at 14em and
    wrapping inside itself.
  - The spectrum summary loses its 6 px margin.
  - The pills' padding becomes 1 px, the plot bodies' top padding 4 px, and
    the gap between panels 8 px.
- *Rejected.*
  - Hiding the caption: it is the only on-screen statement of Quick PNG's
    range and size before the press.
  - Controls below the plots: M5.2 records that a reader meets the controls
    before the plot they act on.
- *Measured along the way.* A rule putting the spectrum's title and summary
  on one line wrapped Export spectrum under the buttons at ≤ 1440 px. It was
  reverted inside the same cycle.

**Final candidate.** `d98432bd82e6ba25531cef0b06f453dff6a55351` (tree
`54bdfc7044f5df7740e78a0bc78974ad1ad2eeb6`). Its `apps/` equals
`55c30f3533c9a90f8dd67b2aa6f28d5004db01e5`'s (tree
`d3110817766fe91cd4f107bd2f32992a432327be`), the last production change.

Static checks on `d98432b`, all exit 0:

- `pnpm lint`, `pnpm typecheck` and `pnpm e2e:typecheck`;
- `pnpm test`: 110 files, 2212 tests;
- `pnpm build`;
- `python -B scripts/check_repo.py` and `git diff --check`.

**Browser, all on production `55c30f3`.** Outcomes are compared by stable
identity with the 2026-09-25 campaign on `a0783bb`:

| Spec | Tests of | Result | Against `a0783bb` |
| --- | --- | --- | --- |
| PM9.3 | `d98432b` | 11 of 11 (V1–V9, G en, G zh-CN) | G is extended, so it is not comparable with the earlier 11 of 11 |
| PM9.1 | `d98432b` | 22 of 22 | as before |
| m5.7 | `d98432b` | 8 of 8 | 1 now passing |
| m7.3 | `17c29a9` | 16 of 16 | 3 now passing |
| m7.4-conversion-figures | `17c29a9` | 14 of 16 | 4 now passing, among them PM9.4's two conversion-intent cases (same fixture cause); 2 known: active Clear, PM9.7 |
| m4.3 | `266088d` | 21 of 23 | 8 now passing; 2 known, family (b) |
| m4.4 | `d98432b` | 16 of 18 | 8 now passing; 2 known: 259/260 (b) and outside the range (d) |
| m5.2 | `d98432b` | 43 of 48 | 7 now passing; 5 known, all SUPERSEDED |
| m5.3 | `17c29a9` | 0 of 13 | 13 known, family (b) |
| viewer-r1-linked-viewer | `d98432b` | 46 of 54 | 6 now passing; 8 known: 5 SUPERSEDED, 1 (d), 2 (b) |
| viewer-r1-scale | `17c29a9` | 2 of 3 | 1 known, SUPERSEDED |

No spec gained a failure, and 37 tests now pass that failed before.

Newly reached assertions were classified before anything was changed. Four
sets carried the pre-M7.3 geometry of §5: a panel's own scroll extent,
`div.viewer-stack` as the scroll column, and the order chromatogram, scans,
spectrum. They were re-derived test-only:

- m4.3's reach, panels-apart and range-note cases (`266088d`);
- m4.4's reach and views-apart cases (`d98432b`);
- the scroll column in m5.2 and viewer-r1 (`d98432b`);
- viewer-r1's scan-steps order (`d98432b`).

Each now reads the evidence column and M7.3's order. The reach, clipping,
hit-test, intrusion, reachable-row and wheel assertions after them are
unchanged, and they now run and pass.

What is left belongs elsewhere:

- **Family (b) stale setup** (`label*=`, `li.dataset-row`, a closed
  disclosure): 18 of the cases above (m4.3 2, m4.4 1, m5.3 13, viewer-r1
  2), plus m4.1/m4.2, which were not rerun. They
  go to PM9.7's regression gate.
- **(d) driver geometry:** m4.4's outside-range case and viewer-r1's
  row-below-the-header case, recorded UNKNOWN for PM9.7.
- **SUPERSEDED:** each keeps the replacement §5 names, and is retired at PM9.7
  against it. No test is deleted.

**Rendered acceptance.** Frames at the three anchors and the eight sweep
sizes, in en and zh-CN; zh-CN with reduced motion. Before → final
(`final/browser-6XglM1`), with a selected scan, a committed RT range and a
pending m/z band. The spectrum header was 102 px in every frame before and
is 56 px in every frame now:

| Frame | Chromatogram | Spectrum plot on screen | Toolbars over one row |
| --- | ---: | ---: | --- |
| 960×640 en | 398 → 368 | 0 → 13 | chromatogram, spectrum → none |
| 960×640 zh-CN | 347 → 368 | 0 → 13 | spectrum → none |
| 1024×768 | 347 → 368 | 103 → 141 | spectrum → none |
| 1152×720 en (828 px column) | 430 → 400 | 0 → 61 | chromatogram, spectrum → none |
| 1152×720 zh-CN | 347 → 368 | 55 → 93 | spectrum → none |
| 1280×720 | 347 → 368 | 55 → 93 | spectrum → none |
| 1366×768 | 347 → 368 | 103 → 141 | spectrum → none |
| 1536×864 | 347 → 368 | 199 → 220 | spectrum → none |
| 1680, 1920, 2560 | 347 → 368 | 220 → 220 | spectrum → none |

- **L13.** Every viewer toolbar is one row in every default arrangement of the
  sweep, in both languages, and the G case asserts it. Every action, group
  and name is kept.
- **Viewer height at 960×640**, in the task terms of §0.1, both languages:
  - the chromatogram plot is on screen, 150 of 150 px;
  - the spectrum plot begins inside the evidence column (13 px on screen, top
    at about 611 in a 640 px window);
  - the evidence column's own scroll reaches, whole: the spectrum header
    (56/56 px), its m/z controls (39/39), the scan steps (39/39), the sticky
    table header (36/36) and the first row (30/30);
  - document overflow is 0 horizontally and vertically in every frame, and
    nothing is shrunk or hidden;
  - m7.3's 960×640 case and viewer-r1's reachable-row cases pass.

  ADR 0006's 544 px is unchanged. That its breakdown names a sidebar the M7.2
  fold removed is an owner question for PM9.7.
- **Keyboard at 960×640.** The walk makes 13 stops in both languages, all
  with the visible focus treatment and on screen: the figure actions, Export,
  TIC, BPC, Zoom in/out, Reset range, the plot, Edit range, Plot gestures
  and Source details.
- **Entry state (L3).** At entry the chromatogram's readout invites a
  selection. The spectrum panel's "No spectrum selected" begins inside the
  viewport, so it reads as an invitation, not a gap. No scan is pre-selected.
  The viewed file is named, untruncated, in the context line in every frame,
  and in Details. No evidence-column heading is added: it would cost the
  height 960×640 lacks.
- **L5 and L21.** The scans stay below the spectrum, the M7.3 composition,
  and are verified reachable. At 960×640 the roster or Details swaps with the
  evidence (the design system's fold). The header and the context line
  ("Viewing: … · spectrum 2") stay.
- **1366×768**, default and with Details opened (a 785 px column), keeps the
  evidence ahead. Both plots and all their controls are on the first screen,
  every header is one row, and neither side panel crowds the evidence. With
  Details opened, the chromatogram's range line wraps "Plot gestures" to a
  second line (B below).
- **1536×864** (zh-CN): both plots are whole on the first screen, and each
  header is one row.
- **1920×1080** is neither sparse nor fragmented, and the scan table's header
  enters the first screen.
- **2560×1440** (en) shows the whole viewer at once: both plots, the pending
  band with its actions, all eight scan rows and Details. Every frame named
  here was looked at, not only measured.
- **Automated and manual differ in one place.** The screenshots show what the
  geometry does not: at 14em the caption can break inside the size ("1200 /
  × 640 px", or "px" alone in zh-CN). That is B below. The manual headed
  harness was not opened: its scenarios start without a preview, and G's
  sweep covered its viewport list with the viewer loaded.
- **History.** PM9.3's G frames of 2026-09-25 (`a0783bb`, `browser-l7oU7m`)
  include the 89 px notice band PM9.2 removed, so they are not compared
  number for number.

**Findings.**

- **A, implemented:**
  - L13 (`47c981b`);
  - the spectrum header's stacked Export spectrum line (`696602c`);
  - the spectrum plot below the 960×640 window (`55c30f3`).
- **B, retained:**
  - the caption breaking inside the size, where the size should stay whole;
  - the full-width m/z pill beside the chromatogram's content-width pills;
  - two range lines under each plot. The raw committed digits ("1.4003361815380306")
    stand beside "Showing 1.4003", and in en the chromatogram's range row
    wraps at 828 px;
  - "(unit not reported)" four times in the chromatogram's lines;
  - the inert `.viewer-stack` grid rules and their comment in `app.css`;
  - Details opened by the reader at 1152–1280 px: the spectrum header takes
    two or three rows. At 571 px the chromatogram header takes two, and that
    is a regression of this slice: the inline caption causes it, and after
    L13 alone it took one. It is a reader-opened arrangement, so it is
    recorded under §0.1 rather than failed.
- **Remaining known failures, 33:** 18 are family (b), 2 are (d), 11 are
  SUPERSEDED (m5.2 5, viewer-r1 5, viewer-r1-scale 1), and 2 are m7.4's
  active-Clear pair.
- **C:** none new. The RT×m/z map, view history and auto peak height stay out
  of scope.

**Unchanged.** No Rust, IPC, schema, request, state, owner, cache or poll
change. V1–V9 hold. PM9.3's before-and-after of the viewer paths is the
capture above plus V1–V9's request ledgers: the controls moved, none was
added or removed, and each action is still one press. PM9.1's J1–J6 stays
PM9.1's, on `d56b17b`.

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

Superseded as the plan by §0, and closed by §0.5 on 2026-09-28. Items 1, 2, 4
and 5 were done there. Item 3 is PM9.3's own before-and-after: §0.5's
capture plus V1–V9's request ledgers. PM9.1's J1–J6 are measured on
`d56b17b`.

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

**Met on 2026-09-28** (§0.5), in the browser, on `d98432b` (production
`55c30f3`):
- The §4 spec passes 11 of 11 with PM9.3's changes, its G case extended to
  the sweep with the L13 assertion.
- The §5 legacy specs are either repaired, re-derived for M7.3, or recorded
  with a diagnosis and an owner. Nothing was deleted, and nothing gained a
  failure.
- The NEEDS RENDER rows are settled:
  - the evidence leads at 1366×768 and 960×640;
  - the empty entry reads as an invitation;
  - the pending band is a shaded band with boundaries, a "Pending" line and
    its two actions;
  - the export entries sit on each plot header's one line, after a caption
    naming their range and size;
  - the fold swaps and keeps the header and the context line;
  - `app.css`'s `.viewer-stack` floors are confirmed inert.
- The presentation changes are rendered at the three anchors and the sweep,
  in both languages, with a keyboard walk, and with reduced motion in zh-CN.

For the viewer, U3, U8, U9 and U10 pass PM9.3's slice acceptance in the
controlled-IPC browser. Integrated acceptance is PM9.7's. Native rendering at
150 % belongs to the qualification after it.

## Known UI/UX rework (2026-09-28)

Appended; the closure above is unchanged and stays PM9.3's historical record.
The viewer defects it left, and those found in its acceptance, were reworked in
[baseline §12](baseline.md#12-known-uiux-rework-2026-09-28), on code candidate
`ea85a88`:

- Figure captions reflow only at their separators (UI-26). Plot header actions
  keep the heading's row wherever they fit, the caption going under the
  buttons, down to the 571 px column; where the selected spectrum's controls
  do not fit beside its heading they take one row of their own, never cutting
  its sentence (UI-27, UI-28; UI-29 recorded).
- The m/z pill is as wide as its controls (UI-30).
- Range lines print at the plot's precision, say "full range" before a commit
  and "the range shown" once one settles, and stay one line from 690 px; the
  missing unit is said once per axis and kept in the plot's description
  (UI-31–UI-34).
- A failed spectrum load is asserted (UI-36); `.viewer-stack`'s inert grid
  rules are removed (UI-47); the viewer task at 960×640 and 1366×768 is
  measured, unchanged, with no plot shrunk (UI-49); m7.4's active-Clear pair
  passes through `revealRosterRow` (UI-23).

The Full/Current scope's persistence stays the owner's (UI-35).

Batch 2 (2026-10-03, `5e4c6ac`): the committed range line follows the pending
band and the committed range, never a gesture, and is announced once, whole,
when a commit settles (UI-34); a range line gives way inside its own box so a
pending band's actions stay on one row with a real run's values and at a
699 px column (UI-32, PM9.3-L).

Wording continuation (2026-10-03, `b7b8eeb`): the committed range line says
"part of the full range" rather than "the range shown", so it stays true while a
wheel or pan is in flight; its announcement timing is batch 2's (UI-34).
