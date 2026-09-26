# PM9.1 static baseline

Status: **STATIC PREPARATION IMPLEMENTED — RENDERED BASELINE PENDING.**
Everything here was read from source, recorded evidence and the reference
material; nothing was built, rendered or run. The rendered comparison,
task-sequence measurements and reference captures are pending a validation
window the owner opens. The browser baseline spec is authored and **NOT RUN**
(§6).

## 1. Ownership map

Read at `d56b17b`. "Session" means presentation state held only in this
document's React tree; "Rust" means the value is an answer Rust owns and the
page replaces wholesale.

| Concern | Owner | Authority | Consumers | PM9 slice |
| --- | --- | --- | --- | --- |
| Surface on screen | `PreviewWorkspace` `surface` (`workbench` / `conversion` / `project`) | Session | `WorkbenchHeader` navigation, Home, context line | 2 |
| Surfaces stay mounted | `PreviewWorkspace`: the three sections toggle `hidden`, none unmounts | Session | Every draft held in a surface survives navigation | 2 |
| Panels (roster, Details), fit, fold, reset, layout record | `SessionPreferencesProvider` `panels` | Session, persisted through the preferences API | Header toggles, `data-roster-open` / `data-details-open`, one-column folding | 2 |
| Details availability | `PreviewWorkspace` `detailsAvailable`: Project → `project.inspecting !== null`, else a loaded preview | Session | Details toggle, `#workbench-inspector` | 2 |
| Current project | `useProject` `state`; answers sequenced, older ones dropped | Rust | `ProjectPanel`, context line | 2, 6 |
| Project operation | `useProject` `busy`, `activeOperation`, `analysisPhase`, `analysisBatch`; Rust jobs are generation-checked | Rust (Session for `busy`) | `ProjectPanel` busy line and Cancel, context line, Project dot | 2, 5 |
| Inspected project object | `useProject` `inspecting`; `provenance` from `lineage.provenanceOf` | Session over Rust records | `ProvenanceDetails`, context line | 2, 6 |
| Next capture's references | `useProject` `selected` | Session | QC and file-facts capture | 6 |
| Targeted setup draft | `ProjectPanel` `targeted` bound to `projectId` + `TargetedMs1` local text/parameters | Session; closed when the project is replaced | Plan review | 5 |
| Roster rows | `usePreviewWorkspace` roster (`rosterSelection.ts`) over Rust handles | Rust list, Session arrangement | `DatasetRoster`, `GroupedRosterList` | 2 |
| Groups, order, search, sort | `organization.ts`, `rosterView.ts` | Session (never execution order) | Roster projection | 2 |
| Highlights, focus, viewed row, conversion membership | roster reducer: `selected`, focus, `activeDataset`, `conversionMembership` | Session, four independent states | Roster, context line (viewed), scope | 2 |
| Viewed acquisition and preview | `usePreviewWorkspace` `activeDataset`, `preview` (late reads superseded) | Rust | Evidence, `PreviewSummary`, QC capture, context line | 2, 3 |
| Selected spectrum, committed ranges | `usePreviewWorkspace` `spectrum`, `spectrumCommittedDomain`, `chromatogramCommittedDomain`; `viewer/*` interaction state | Rust reads, Session gestures | Viewer panels, figure dialog, context line | 3 |
| Conversion scope | `workspace.conversionScope` + `resolveConversionScope` | Session over the roster | `ConversionPanel`, context line | 2, 4 |
| Conversion settings draft | `useConversionConfiguration` (Rust-authored configuration kept as it arrived; `selectedIntentId`) and the destination and conflict choices in `useConversionOperation` (`setDestinationPolicy`, `setConflictPolicy`, `readPlanOptions`) | Rust configuration, Session choices | `ConversionPanel`; a change withdraws the review in `useConversionPlan` | 4 |
| Conversion plan and review | `useConversionPlan`, `conversionPlanAuthority` | Rust-bound plan identity | `ConversionPanel` | 4 |
| Conversion lane | `useConversionOperation` `state` (as Rust last reported), `busy`, `stopping`, `adopting` | Rust | `ConversionPanel`, roster pins, conversion dot, context line | 4 |
| Viewer figures and exports | `usePreviewWorkspace` figure settings and export states; `ExportFigureDialog`, `ChromatogramExportPanel` | Rust export authority | Viewer | 3 |
| Stored targeted results and exports | `TargetedMs1` through `projectApi` | Rust | Project surface | 6 |
| Focus restoration | `ProjectPanel` layout effects (layer removal, QC capture); `PreviewWorkspace` reveal and inspector focus; active-Clear focus return | Session | Keyboard continuity | 2, 6 |
| Announcements | Mounted live regions in `PreviewWorkspace` (viewer, search, workspace, folder, drop, conversion), `WorkbenchHeader` (layout), `ProjectPanel` (project) | Session | Screen readers | all |

Risk points for later slices: the same fact read in two places (keep the
context line reading the owners, never a copy); anything that unmounts a
surface would discard its drafts; a second subscription or poll for status the
lane already reports.

## 2. Failing legacy browser specs

Recorded evidence only: `docs/spikes/M9_CLOSURE_EVIDENCE.md` §8 and the
retained closure logs. Nothing was rerun. On published `main` and on the M9
closure code, 20 spec files and 174 of 317 shared tests fail identically.
"Inference" marks what the evidence does not state.

| Spec | Failing | Behaviour covered | IDs | Slice | Recorded family | Handling when that slice changes the surface |
| --- | --- | --- | --- | --- | --- | --- |
| m4.1 spectrum export | 17/17 | Spectrum export controls, reach, keyboard, formats, refusals | U3, U8, U9 | 3 | obsolete `li.dataset-row` selector in `open()` | repair selector, re-derive setup; no assertion ever reached |
| m4.2 figure settings | 15/15 | Figure settings, invalid values, raster/clipboard refusals | U3, U8, U9 | 3 | obsolete selector | same as m4.1 |
| m4.3 chromatogram export | 10/23 | Chromatogram export reach, whole run vs committed range | U3, U8, U9 | 3 | roster row not displayed at 960×640; geometry at 1366/1920; one obsolete selector | fix the shared helper, re-derive geometry |
| m4.4 linked figure | 10/18 | Linked figure actions, pair/range, height threshold | U3, U8, U9 | 3 | roster at 960×640; geometry | helper fix, re-derive geometry |
| m5.2 spectrum viewport | 12/48 | m/z viewport controls, drag, keyboard, wheel, requests | U3, U9, U10 | 3 | roster at 960×640; copy and geometry | helper fix; keep interaction and request semantics |
| m5.3 spectrum range export | 13/13 | Full vs current range export | U3, U8, U9 | 3 | range scope control not interactable | re-derive how the scope is reached |
| m5.7 selection availability | 1/8 | Selection-lane availability | U3, U10 | 3 | roster at 960×640 | helper fix only |
| m6.1 conversion availability | 9/9 | Conversion-lane availability | U4, U10 | 4 | obsolete selector | repair selector; navigate to Conversion (inference) |
| m6.4 conversion settings | 24/24 | Plan bound to configuration, edits, retries | U4, U10 | 4 | obsolete selector | repair and re-derive; largest file, budget inside PM9.4 |
| m6.6 destination conflict | 8/8 | Destination and conflict review | U4, U9 | 4 | obsolete selector | repair and re-derive |
| m6.7 conversion scope | 7/7 | Selected/all scope review | U4, U2 | 4 | conversion panel state never reached | navigate to Conversion first (inference, precedent m7.4) |
| m6.8 cancellation | 1 test + hook | Stop scopes and settlement | U4, U10 | 4 | conversion panel never reached; hook capture threw | navigate first; null-safe capture; six tests never ran |
| m6.9 output completion | 7/7 | Output completion and adoption | U4, U8 | 4 | conversion panel never reached | navigate first, or replace with a populated scenario |
| m7.1 settings | 3/3 | Localized Settings | U1, U9, U10 | 2 (incidental) | obsolete `[role="option"]` selector | repair selector as m7.5 does |
| m7.2 workbench | 10/11 | Shell and grouped roster | U1, U2, U7, U9, U10 | 2 | undiagnosed; 4 time out in the spec's own `metrics()` CDP helper | diagnose `metrics()` first, then re-derive what PM9.2 changes |
| m7.3 viewer | 3/16 | Viewer evidence, scans, bands | U3, U8, U9, U10 | 3 | undiagnosed; row not interactable; one scroll assertion | re-derive setup |
| m7.4 conversion/figures | 6/16 | Linked preview, conversion intent, Clear focus, figures | U2, U3, U4, U8 | 2 (Clear), 3, 4 | undiagnosed | each slice re-derives its own tests |
| m7.5 preferences | 2/8 | Durable preferences, panel arrangement | U1, U9, U10 | 2 | undiagnosed; assertions expect `disabled` where the header uses `aria-disabled` (inference) | decide which is the contract, then repair |
| viewer-r1 linked viewer | 14/54 | Linked viewer layout and interaction | U3, U9, U10 | 3 | roster at narrow widths; geometry; two obsolete selectors | helper fix, repair selectors |
| viewer-r1 scale | 1/3 | 36,319-scan windowing | U3, U10 | 3 | undiagnosed | re-check if windowing changes |

Cross-cutting, recorded: every "roster row never displayed" failure goes through
`e2e/support/viewer.ts` `openTheViewer` (the toggle-then-wait lines) and occurs
only at 960×640 or a narrow window; the same pattern passes at 1366×768 in the
M8.5 spec. Fixing that helper once is PM9.3's first repair. The obsolete-selector
specs never passed setup, so there is no evidence either way about what they
assert. Recorded cost: m6.1, m6.4 and m6.6 took about 41 of the suite's 80
minutes on 60-second row waits.

Tauri and native siblings exist for most of these files and were not part of
this evidence; several still use the obsolete selectors (`e2e/support/tauriPanel.ts`
among them).

## 3. v5.11 reference

Owner-held material, not in the repository. The HTML was located on the owner's
machine and matched [ADR 0047's recorded identity](../../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#accepted-reference-continuation):
`mscanvas_unified_demo_v5_11.html`, 490,253 bytes, SHA-256
`d09b60e0bd3225721ddf87731ec64c0577015952afc05d91290d5461b3896337`. Its own QA
captures are at 1440, 780 and 390 pixels wide, not PM9's viewports; the
reference has a Chinese interface only. The tracked visual contract remains the
[durable v5.11 baseline](../../ux/DESIGN_SYSTEM.md#durable-v511-reference-baseline).

Known intentional deviations, to be confirmed by the rendered comparison:

| Region | Reference | Production | Disposition |
| --- | --- | --- | --- |
| Roster width | ≈240 px | 280 px | recorded M7.2 deviation (wrapped names, separate selection controls) |
| Acquisition row minimum | 61 px | 44/32 px comfortable/compact | recorded M7.1 production density |
| Navigation | Data workbench, processing workflow, features and annotation, statistics and QC, export and records | Workbench, Conversion & results, Project | only real capabilities enter navigation; the other three are not applicable |
| ETA | simulated per step and total | none | excluded; no simulated ETA |
| Demo actions (reset, capability check, sources) | present | absent | not ported |
| Secondary context bar under the header | demo status left, gesture hints right | PM9.2 draft: context line left, drop hint right | draft; rendered comparison pending |

## 4. Controlled scenarios

`apps/desktop/src/test/pm9Scenarios.tsx`, synthetic, built from the existing
fixture builders only. Rendered with the real composition in Vitest; the
browser baseline mirrors five of them by name and adds three variants
([§6.3](#63-parity-with-the-vitest-scenarios)).

| Scenario | What a reader sees |
| --- | --- |
| `empty` | No converter, no acquisitions, no project |
| `populated` | Six acquisitions, two sharing a filename in different folders, one vendor row; a project with file facts |
| `converting` | The same roster with a conversion under way |
| `conversionEnded` | A queue stopped before its one item began; report retained |
| `projectWithResult` | A saved project with a completed targeted run and its stored result, whole |
| `resultPayloadMissing` / `resultPayloadCorrupt` | The same result with its payload missing or no longer matching |

## 5. Verification entry points (to run only in an owner-opened window)

- Component tests, one path at a time:
  `pnpm --filter @mscanvas/desktop exec vitest run src/features/workbench src/app/Pm9Baseline.test.tsx`,
  then the whole `pnpm test`.
- Type and build: `pnpm typecheck`, `pnpm build`; the i18n coverage test is part
  of `pnpm test`.
- Browser: one `wdio --spec` invocation per file at 1920×1080, 1366×768 and
  960×640, en and zh-CN, with reduced motion; evidence under
  `test-results/pm9.N/`. PM9.1's spec and its exact command are in §6.
- Repository: `python scripts/check_repo.py`, `git diff --check`.
- Rust is not affected by PM9.1 or the PM9.2 draft; the deferred PR #127 Rust
  checklist is in the
  [integration record §14](../../development/M8_M9_SOURCE_INTEGRATION.md#14-found-on-the-repaired-head-a-reference-added-during-save-as-and-a-deferred-check-pr-127).
- Resource rules for any window: admission at ≥ 8 GiB available and ≤ 80 % used;
  defer the next heavy command below 4 GiB or at ≥ 90 %; run in the foreground,
  one command at a time; confirm task-owned descendants have exited.

## 6. Browser baseline spec (authored, NOT RUN)

`e2e/specs/pm9.1-baseline.browser.e2e.ts`, written on the provisional PM9
branch. Every path under `apps/` and `crates/` stays identical to
`9786809` (tree `da9ae8e`), so the PM9.2 production draft is unchanged. It uses
the existing browser harness (`e2e/support/harness.ts`, the IPC boundary
preloaded, hold/release, call and console ledgers) and M8.2/M9.1's CDP
viewport helper with DPR 1. The browser config's `specs/**/*.browser.e2e.ts`
glob registers it. It adds no framework, backend, production seam or
production mock switch, and it does not use `openTheViewer` or M7.2's
`metrics()`. It has not been compiled, discovered or run.

### 6.1 Journeys and IDs

J IDs follow the order of [slice-01](slice-01.md) pending item 4, in its words.

| Journey | IDs | Existing coverage (state as recorded) | New cases | Later human or native check |
| --- | --- | --- | --- | --- |
| J1 curate and inspect | U1, U2, U3 | Vitest `Pm9Baseline.test.tsx` (roster across navigation) and `App.test.tsx` removal cases, including "clears the preview when the row it belongs to is removed"; browser m7.2, m7.3, viewer-r1 (red, §2) | B1, B2 | native Explorer drop (m7.2 native); J1 step and decision measurement |
| J2 convert | U4, U10 | Vitest conversion suites, `Pm9Baseline` converting and ended; browser m6.x, m7.4 (red, §2) | B1 (scope route), B6 | live provider stays `PENDING` under the ProteoWizard HOLD |
| J3 reopen and check a project | U7, U10 | browser m8.1 (open, check, cancel), m8.3 (reattachment) | B7 | native open dialog |
| J4 targeted setup, review and run | U5, U7, U10 | browser m9.1 (single run and cancel), m9.4 (batch); Vitest `shellContext.test.ts` (the project's activity sentence) | B3 (draft only) | a real runtime run (Rust suite; native) |
| J5 read QC and targeted results and export | U6, U8 | browser m8.5 (QC capture, report, reopen), m9.1's M9.2 section (stored result with source missing and runtime unavailable, exports) | B4, B5 | — |
| J6 Home / Settings / folding | U1, U9 | browser m7.1, m7.5 (red, §2), m8.2 (Details folding); Vitest `ContextLineShell.test.tsx` | B1 (Home, keyboard), G | OS scaling in a native window |

Not in the new spec and left to the owners above: the Settings round trip
(m7.1, m7.5), the context line during a targeted run or batch (m9.1, m9.4,
`shellContext.test.ts`), exports (m8.5, m9.1), source removal clearing the
viewer (`App.test.tsx`), and the conversion settings draft
(`useConversionConfiguration`; Vitest `ConversionSettings.test.tsx`,
`conversionPlanLifecycle.test.tsx`; its browser spec m6.4 is red and is
PM9.4's). The conversion (B6) and the project check (B7) are not
evidence of targeted execution. The QC capture (B5) is descriptive only; no
score is added or expected.

### 6.2 Case ledger

Every case is mock-backed: real frontend, Vite and Chrome, with only the IPC
boundary replaced. None is real-backend or native evidence. Each is **NOT
RUN**. Command (future entry, in an owner-opened window, after
`pnpm e2e:typecheck`):

```text
pnpm e2e:browser --spec ./e2e/specs/pm9.1-baseline.browser.e2e.ts
```

Set `MSCANVAS_PM9_CANDIDATE` to the commit under test. Evidence is written
under `MSCANVAS_PM9_OUTPUT_ROOT`, default `test-results/pm9.1/browser-*/`
(`evidence.json`, PNGs).

"No request" below means: nothing that starts a task, mutates a record, reads
a source or repeats a stored-result read. The five commands whose `lib.rs`
doc comment says they are read-only are recorded, not failed (§6.5). No
owner promises zero IPC, and the spec does not add that requirement.

| Case | State (§6.3) | Acceptance | Expected | Status |
| --- | --- | --- | --- | --- |
| PM9-B1 | `populated`, row viewed, spectrum selected, reference inspected | U1, U10 | Project, viewed acquisition, scope and inspected reference each read from their owner, with no activity item; each item, by pointer and by Tab plus Enter, changes only the surface and the current destination; the focus ring is visible; no request while every owner is idle | NOT RUN |
| PM9-B2 | `populated` plus one membership toggle, spectrum 0 and one m/z zoom | U1, U2, U3, U7 | Roster order, highlight and membership, the selected scan, the committed m/z caption, and the viewing and scope items are unchanged after Conversion → Project → Workbench; no request | NOT RUN |
| PM9-B3 | `projectWithResult` with typed targets | U5, U7 | The typed text is unchanged after Home → project item; no review or run request | NOT RUN |
| PM9-B4 (×4) | `projectWithResult`, `resultPayloadMissing`, `resultPayloadCorrupt`, `resultSourceAndRuntimeUnavailable` | U6, U7 | The report's availability is as recorded. Its state block keeps the payload (whole, missing or damaged), the source (found, or not found where recorded) and new runs (available, or no runtime) apart, as M9.1 reads them. A missing or damaged payload is never read. The inspecting item names the record identically in every state. Details links the producing run and shows the plan SHA-256. Home → inspecting returns to the same report, with no request and no re-read of rows | NOT RUN |
| PM9-B5 | `qcCapture`, capture held | U6, U10 | A busy item and the Project dot while held, unchanged across navigation, with no request; after release no busy item or dot; the inspected object moves to the new QC record (`useProject` `captureQc`) and routes to its report, which carries no verdict words | NOT RUN |
| PM9-B6 | `converting`, then settled through the lane's next slot read, held and released | U4 (lane only), U10 | The running item and active dot; navigation asks nothing beyond read-only reads; nothing moves while the settling read is held; once it is released, the retained item and dot remain and no activity item does | NOT RUN |
| PM9-B7 | `populated` with a held check, then Close and Open | U7, U10 | The busy item and the accepted operation's identifier survive navigation with no request; after release no busy item, and the inspection a check does not change is kept; Close then Open leaves nothing inspected and the viewed row unchanged; only `close_project` and `open_project` are asked | NOT RUN |
| PM9-G (×4) | `populated` idle and `busyInspected`, en and zh-CN, each at 1920×1080 → 1366×768 → 960×640; reduced motion in zh-CN | U9 (observation) | Geometry recorded (§6.4). Asserted only: no off-origin request, no path on screen, horizontal overflow ≤ 1 px, header controls within the viewport width, context items at the 31.5 px compact minimum, and every context item a Tab stop with a visible focus treatment | NOT RUN (observation) |

Relation to existing tests: B1 and B7 extend `ContextLineShell.test.tsx`, and
B4 extends `Pm9Baseline.test.tsx`, into the rendered layer. Both component
tests remain, and so do the legacy specs in §2. Deep focus-race behaviour stays
with the component tests. No case uses a timed sleep. B6 holds the lane's
slot read and waits for that read to arrive, not for a length of time.

### 6.3 Parity with the Vitest scenarios

The spec restates the builders' identifiers, names and labels. It cannot
import them: `pm9Scenarios.tsx` mounts `App` through Testing Library, and
`projectFixtures.ts` imports Vitest.

- Checked against the code, not only against §4: none of the seven Vitest
  scenarios holds a QC snapshot, a targeted run or batch in progress, or an
  unavailable source or runtime. Their only project states are
  `capturedProject()` (file facts) and `targetedProject()` (one completed
  single run). The variants below add only what the shell cases need.
- Mirrored by name: `populated`, `converting`, `projectWithResult`,
  `resultPayloadMissing`, `resultPayloadCorrupt`.
- Not mirrored: `empty`, whose no-installation binding would have to be
  restamped on every authority the shared table carries, and
  `conversionEnded`. B6 reaches a retained queue by settling `converting`
  instead. The stopped-before-start report stays Vitest-only.
- Browser-only: `resultSourceAndRuntimeUnavailable` (source missing at its
  checked location, runtime unavailable, payload available); `qcCapture`
  (M8.5's layer over the viewed row, identifiers `…-9901-…`, M8.5's controlled
  snapshot); `busyInspected` (a synthetic composite: `converting`'s lane with
  the stored result inspected and long user-written names; used by G only).
- Converter binding: every browser table keeps `ipcTable()`'s one available
  binding. The Vitest stored-result scenarios use `unavailableBackend`, and
  mixing two authorities in one table would model a session the currency
  rules may discard.
- `describe_workspace_conversion_queue` is not answered by the shared table.
  Where the scope holds an eligible row, the Conversion surface shows a failed
  review. The context line reads the resolved scope, not the review.
- The settled queue is `completed`, with its one item finalized and no report.
  `backendReadingRecovery.test.tsx` already drives this running-to-completed
  pair.

### 6.4 Geometry and reference checks to collect later

- Versions. The spec records `candidate` with each frame. The observation block
  does not require the context line, so a later authorized pre-draft capture of
  `d56b17b` can use the same block. The functional cases require the line and
  would fail there. No pre-draft capture exists, and a capture of the new
  header is not a before-change baseline.
- Recorded per frame: header, context bar and each item (text, box, whether
  truncated), the number of rows the items use, the drop hint, the roster,
  main and Details boxes, the main region's visible versus content height,
  outer versus panel scroll, every header control, the reduced-motion flag,
  and each keyboard stop with its focus treatment. Also recorded: the work
  area left below the header, the notices band, how much of the main region
  is on screen, and each evidence panel's on-screen height (chromatogram,
  spectrum, scans, targeted report, QC report, running conversion).
- Judged in the window, not asserted: whether the line costs the evidence area
  too much; wrapping and long-label truncation in both languages; folding at
  960×640; the measured panel floors, which m7.2, m7.3 and viewer-r1 own and
  which are rerun per §2; and the M8/M9 specs' header readings. No pixel
  threshold is added and no existing limit is relaxed.
- Still open. The representative set discharges no U9 obligation. Still
  pending: other scenario, language and viewport combinations; DPR and OS
  scaling (native, recorded separately); the reference rendered at PM9's
  viewports and §3's production column; J1–J6 step, decision, request and
  mount measurements ([slice-01](slice-01.md) pending item 4); and no
  screenshot golden.
- Prerequisites: an owner-opened window; the browser config's ChromeDriver and
  a free dev port (5273, or `MSCANVAS_BROWSER_DEV_PORT`); the reference re-hashed
  against §3 before any comparison. No provider, runtime or native session is
  needed.

### 6.5 Static review corrections (PM9.3 preparation)

A bounded static reading of the spec found three test-authoring defects. Each
was corrected test-only in `e2e/specs/pm9.1-baseline.browser.e2e.ts`, and none
has been run.

1. **Zero-IPC assertions.** B1–B5 and B7 asserted an empty request delta, and
   B6 exempted only the slot poll. No owner guarantees that navigation asks
   nothing, so that was a new requirement written into a test. `askedSince` is
   replaced by `unexpectedSince(label, before)`. It records every command in
   the evidence and fails only on commands outside `READ_ONLY`, the five whose
   `lib.rs` doc says they launch or read nothing:
   - `get_workspace_conversion_state`
   - `get_targeted_ms1_progress`
   - `get_targeted_ms1_runtime`
   - `describe_workspace_conversion_queue`
   - `project_selected_spectrum`

   The following stay excluded:
   - `read_conversion_configuration`, which may run an `msconvert --help`
     probe;
   - `inspect_backend`, which checks an installation;
   - `preview_figure`, which has no read-only statement;
   - `get_project_state`, which replaces the Project surface;
   - source reads, and any repeated stored-result read.

   B7's replacement still expects exactly `close_project` and `open_project`
   beyond those reads.
2. **Clock-driven settling.** B6 changed the slot answer and waited for the
   lane's two-second interval to pick it up. It now holds
   `get_workspace_conversion_state` and changes the answer. It waits on
   `heldCallers` until the next read is parked, asserts that the line has not
   moved, and then releases. The transition is the fixture's, and the only
   wait is for a request to arrive. B5 and B7 already used hold and release.
3. **Work area missing from geometry.** `observe()` recorded the header and
   whole regions, but not what the second header line leaves for the work.
   It now records the work-area band, the notices band, the main region's
   on-screen height and each evidence panel's on-screen height. These are
   observations, with no threshold (§6.4).
