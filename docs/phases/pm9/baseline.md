# PM9.1 static baseline

Status: **STATIC PREPARATION IMPLEMENTED — RENDERED BASELINE PENDING.**
Everything here was read from source, recorded evidence and the reference
material; nothing was built, rendered or run. The rendered comparison,
task-sequence measurements and reference captures are pending a validation
window the owner opens.

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
fixture builders only. Rendered with the real composition in Vitest; the same
states are the starting point for the pending browser baseline.

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
- Browser (after an e2e baseline spec exists): one `wdio --spec` invocation per
  file at 1920×1080, 1366×768 and 960×640, en and zh-CN, with reduced motion;
  evidence under `test-results/pm9.N/`.
- Repository: `python scripts/check_repo.py`, `git diff --check`.
- Rust is not affected by PM9.1 or the PM9.2 draft; the deferred PR #127 Rust
  checklist is in the
  [integration record §14](../../development/M8_M9_SOURCE_INTEGRATION.md#14-found-on-the-repaired-head-a-reference-added-during-save-as-and-a-deferred-check-pr-127).
- Resource rules for any window: admission at ≥ 8 GiB available and ≤ 80 % used;
  defer the next heavy command below 4 GiB or at ≥ 90 %; run in the foreground,
  one command at a time; confirm task-owned descendants have exited.
