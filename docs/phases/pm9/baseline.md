# PM9.1 static baseline

Status: **BROWSER RENDERED BASELINE ESTABLISHED — NATIVE ACCEPTANCE PENDING;
PM9.1 NOT COMPLETE.** §1–§5 were read from source, recorded evidence and the
reference material. The owner-opened validation window of 2026-09-25 ran the
browser baseline spec (§6), rendered the reference and compared it (§3.1), and
recorded the campaign (§7). The tested production-code candidate is `a0783bb`
(tree `85b5e15`); a later documentation-only commit is not a code candidate.
Native Windows rendered acceptance at the host's 150 % scaling is PENDING, and
the provider-positive native route is BLOCKED_PROVIDER_HOLD (§7.6). On
2026-09-26 the branch was reconciled with the accepted main (§8); the
reconciled tree has had no new runtime, component or browser run. Superseded
in part by the 2026-09-26 mid-phase normalization (§10): PM9.1 is **PARTIAL**
with only J1–J6 left, and native rendering at OS scaling and the provider
route belong to the qualification after PM9.7.

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
retained closure logs; the table was built without a rerun. The 2026-09-25
campaign (§7.5) later ran every file on `a0783bb`, and the same 174 tests fail
by stable test identity (failure text compared only for m7.2 and m7.5). On
published `main` and on the M9
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

PM9.3's preparation classifies the viewer-related rows above test group by
test group, from the retained reporter log, as still valid, superseded (with
the named replacement), unrelated, or unknown until a first run. See
[slice-03 §5](slice-03.md#5-legacy-browser-specs-relevant-to-pm93). The
table above is unchanged; its slice column for m7.1, m7.2, m7.4's active-Clear
cases and m7.5 is superseded by §10.

## 3. v5.11 reference

Owner-held material, not in the repository. The HTML was located on the owner's
machine and matched [ADR 0047's recorded identity](../../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#accepted-reference-continuation):
`mscanvas_unified_demo_v5_11.html`, 490,253 bytes, SHA-256
`d09b60e0bd3225721ddf87731ec64c0577015952afc05d91290d5461b3896337`. Its own QA
captures are at 1440, 780 and 390 pixels wide, not PM9's viewports; the
reference has a Chinese interface only. The tracked visual contract remains the
[durable v5.11 baseline](../../ux/DESIGN_SYSTEM.md#durable-v511-reference-baseline).

Known deviations, checked against the rendered comparison (§3.1), with the
roster width corrected to the measured values. ETA is confirmed absent only on
the captured Workbench and Project surfaces, row density only visually, and
the context bar is now a PM9.2 action rather than an intentional deviation:

| Region | Reference | Production | Disposition |
| --- | --- | --- | --- |
| Roster width | 285 px at 1920×1080 and 240 px at 1366×768, measured; a full-width toggle bar at 960×640 | 280 px at 1920×1080 and 1366×768; folded into a header action at 960×640 | recorded M7.2 deviation at 1366×768 (wrapped names, separate selection controls); at 1920×1080 production is 5 px narrower than the measured reference, a case the M7.2 rationale ("wider than the approximate 240px reference", DESIGN_SYSTEM) does not describe |
| Acquisition row minimum | 61 px | 44/32 px comfortable/compact | recorded M7.1 production density |
| Navigation | Data workbench, processing workflow, features and annotation, statistics and QC, export and records | Workbench, Conversion & results, Project | only real capabilities enter navigation; the other three are not applicable |
| ETA | simulated per step and total | none | excluded; no simulated ETA |
| Demo actions (reset, capability check, sources) | present | absent | not ported |
| Secondary context bar under the header | demo status left, gesture hints right | PM9.2 context line left, drop hint right | concept kept; redesign as a priority-based summary (§3.1, L14–L16) |

### 3.1 Rendered comparison and dispositions (2026-09-25)

The reference was re-hashed (the identity above) and rendered in the browser
harness at 1920×1080, 1366×768 and 960×640, Chinese only. Production is the
PM9.1 observation block (§6.2, PM9-G) at `a0783bb`, with the same block at
`d56b17b` as the before-change capture (§7.4). Every frame is a controlled-IPC
browser render at DPR 1 over synthetic data: an observation, not a golden and
not native evidence. The evidence content itself cannot be compared: the
reference draws a synthetic multi-peak chromatogram, and the fixture has six
spectra. `busyInspected` shows the Project surface, which the reference lacks,
so only its shell is compared. The evidence is git-ignored:
`test-results/pm9.1/reference-v5.11/`, `test-results/pm9.1/browser-aTNSQY/`
(after) and `test-results/pm9.1/compare-d56b17b/browser-53Dmo0/` (before).

**Action** and **defect** rows, and L20's intentional responsive difference,
carry the owner's dispositions. Other **intentional** entries cite the record
that already states the production arrangement. Routings to PM9.3 and L18's
link to L1 are this record's reading, not the owner's. **Open** entries have
no disposition yet.

| Row | Reference | Production (`a0783bb`) | Disposition |
| --- | --- | --- | --- |
| L1 Surface title and primary action | A page title ("数据工作台") with a one-line description, and a filled "process selected" action | No surface heading or surface-level primary action; the navigation underline is the only surface label | **Action (PM9.2).** Add a clear surface or task title. Expose a contextual primary action only where an existing owned action is genuinely the next step |
| L2 Navigation | Five entries | Three | Intentional (table above; [DESIGN_SYSTEM](../../ux/DESIGN_SYSTEM.md#durable-v511-reference-baseline): "Only real beta capabilities enter navigation") |
| L3 Identity in the evidence column | A sample heading and tabs above the plot | No heading or tabs; the viewed file is named in the context line, the roster row and Details, and Details is open by default only at 1920×1080 | Panel order intentional ([slice-03 §3](slice-03.md#3-static-v511-mismatch-ledger), the M7.3 composition). Stacked rather than side by side, and no heading or tabs, are verified structural there, so open. Dominance and identity placement: PM9.3 |
| L4 First evidence position | The plot card at y 361 (1920, 1366) and 488 (960) | The chromatogram panel at y 189 in every idle (Workbench) frame and fully on screen; at 960×640 the spectrum panel shows only its title and actions (25 px on screen in en, 76 px in zh-CN) | Observation. Evidence dominance over panel chrome is PM9.3's |
| L5 Scan table | Beside the spectrum; its first rows visible at 1920 | Below the spectrum; 0 px on screen at every viewport, reached by the evidence column's own scroll | Order intentional (slice-03 §3); below rather than beside is verified structural there, so open; visibility PM9.3 |
| L6 Plot-adjacent controls | A hover-revealed corner and a context menu; two caption lines | Persistent zoom, trace and figure actions, caption lines and disclosures | Figure and export action placement and the disclosures: intentional (slice-03 §3, its export and explanatory-copy rows). The persistent zoom and TIC/BPC controls are verified structural there, not intentional, so their placement and persistence, and prominence and copy density, are PM9.3's |
| L7 Roster width | 285 / 240 px; a toggle bar at 960 | 280 / 280 px; folded at 960 | Intentional at 1366 (table above). At 1920 production is 5 px narrower than the reference, which the M7.2 rationale does not describe |
| L8 Row density | Two-line rows, 61 px minimum | 44 px comfortable rows (row boxes not measured) | Intentional (table above) |
| L9 Roster action block | Search and grouping above the list; batch actions at its foot | Search, order, a help disclosure, five buttons, "New group" and a counts line, all above the first row | **Action (PM9.2).** Reduce simultaneous toolbar competition: keep high-frequency and current actions visible, and move lower-frequency organization controls into the existing secondary or menu hierarchy. No capability is removed and no authority changes |
| L10 Backend notices | One phrase in the strip | The ProteoWizard band is always shown, available or not: 89 px in every frame, leaving 640 − 88 − 89 = 463 px at 960×640 | **Action (PM9.2).** Remove the permanent 89 px footprint when there is no actionable state. Persistent actionable errors and recovery states stay visible |
| L11 Outer spacing | Content inset by 84 / 24 / 16 px | Content inset by 16 px at every viewport; the notices band's box spans the full width, but its padding insets the visible notice by the same 16 px | Open |
| L12 Details with long values | Short facts | SHA-256 values and long names wrap in the 245 px column | Open |
| L13 Plot header controls | No persistent plot toolbar | In en at 960×640 the chromatogram header controls wrap to a second row (panel 398 px against 347 px in zh-CN); the same at `d56b17b` | **Defect (PM9.3), confirmed.** Contrary to [DESIGN_SYSTEM](../../ux/DESIGN_SYSTEM.md): "toolbars must not grow into wrapping ribbons". Not fixed here; PM9.3's first implementation item once PM9.2 closes |
| L14–L16 Context strip | Muted, non-interactive status left and gesture hints right; never truncated | The header's second line: three or four context items (32 px buttons, each a Tab stop) left, the drop hint right; the header is 88 px (75 before). In `busyInspected` every item is truncated at 960×640 in both languages and at 1366×768 in en, and a long project name crowds out the state words | **Action (PM9.2).** Keep the context-line concept, redesigned as a priority-based summary: (1) the active operation or status, whose state word stays readable; (2) the viewed or inspected object; (3) the project's identity; (4) the scope, only when contextually relevant; (5) lower-priority context collapses into Details/context at narrow widths rather than every field becoming an ellipsis. No further wrapped header row merely to fit all context |
| L17 Global header actions | Demo actions | Roster and Details toggles, reset layout, Settings | Intentional (table above) |
| L18 Inspector actions | "Process this" and a features link | None | The features link is not applicable; "process this" follows L1 |
| L19 Disclosure model | Tabs, a segmented trace control, a hover corner and a help modal | `<details>` disclosures | Disclosures intentional (slice-03 §3); XIC excluded ([brief](brief.md#scope)); copy density PM9.3 |
| L20 Details at 1366 | An inspector column | Hidden by default below 1700 px and opened from the header | **Intentional responsive difference.** Details may stay hidden by default at 1366-class widths because evidence stays primary, provided the Details affordance stays obvious, stable and keyboard reachable |
| L21 Folding at 960 | The navigation wraps; a roster toggle bar; the inspector stacked below; the page scrolls | One-row navigation; the roster and Details fold into header actions; main scrolls inside | Folding the roster and Details into header actions below 1050 px: intentional ([DESIGN_SYSTEM](../../ux/DESIGN_SYSTEM.md); slice-03 §3). Swap rather than stack (verified structural) and what stays visible (needs render) in slice-03 §3, and the one-row navigation, which slice-03 §3 does not classify: open (scroll ownership also L22). Only the folded-closed state was captured |
| L22 Document overflow | A scrolling document | `document.scrollHeight − innerHeight` is positive in every frame (idle zh-CN: 64 / 376 / 504 px), while `body` does not scroll (`apps/desktop/src/index.css`); also positive at `d56b17b` | **Action / defect (PM9.2).** Required content must not become unreachable because of outer overflow ownership. Repair while keeping the intentional local roster, table and evidence scroll owners |
| L23 Horizontal fit | No overflow | 0 in every frame at `a0783bb` and at `d56b17b`; the regression that failed the first run at `daa801c`, reproduced at `292c1d9`, is §7.3's | Meets §6's assertion |

PM9.2 implemented the action rows L1, L9, L10, L14–L16 and L22 and L20's
conditions on 2026-09-26 (`6b31161`) and they were rendered and accepted in
the browser on `0d22fc7` (§9); L14–L16's English scope at its floor was
closed on `b81fc78` by the owner's copy decision (§9, Closure). The production column above still describes
`a0783bb`. How each row was disposed of is in
[slice-02](slice-02.md#focused-rendered-acceptance-2026-09-26). L13 stays
PM9.3's. PM9.3 fixed it on 2026-09-28 and settled L3, L5 and L21's open
parts for the viewer (§11).

Not captured in this comparison: empty and entry states, a pending range band
(PM9.3's G frames later hold one, on screen only at 1920×1080; slice-03 §3),
the Conversion surface, the roster-open and Details-open states at 960×640, a scrolled or
focus-driven document position, native windows and OS scaling.

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
- Manual visual review, test-only: `pnpm qa:pm9:manual` opens one controlled
  scenario headed and stays until the reviewer ends it, with an eleven-size
  viewport sweep and both languages; `MSCANVAS_BROWSER_HEADED=true` shows any
  browser spec's window. Production frontend over a controlled IPC fixture
  only; usage, the v5.11 side-by-side and the evidence boundary are in
  `e2e/README.md`.
- Rust is not affected by PM9.1 or PM9.2 (§7.1); PR #127's Rust
  qualification, now merged in main (§8), is in the
  [integration record §14](../../development/M8_M9_SOURCE_INTEGRATION.md#14-found-on-the-repaired-head-a-reference-added-during-save-as-and-signal-summaries-against-their-evidence-pr-127).
- Resource rules for any window: admission at ≥ 8 GiB available and ≤ 80 % used;
  defer the next heavy command below 4 GiB or at ≥ 90 %; run in the foreground,
  one command at a time; confirm task-owned descendants have exited.

## 6. Browser baseline spec

`e2e/specs/pm9.1-baseline.browser.e2e.ts`, written on the provisional PM9
branch while every path under `apps/` and `crates/` was identical to `9786809`
(tree `da9ae8e`). The validation window's one production repair, `a0783bb`,
came after it (§7.3). It uses
the existing browser harness (`e2e/support/harness.ts`, the IPC boundary
preloaded, hold/release, call and console ledgers) and M8.2/M9.1's CDP
viewport helper with DPR 1. The browser config's `specs/**/*.browser.e2e.ts`
glob registers it. It adds no framework, backend, production seam or
production mock switch, and it does not use `openTheViewer` or M7.2's
`metrics()`. It ran in the 2026-09-25 window (§6.2, §7).

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
boundary replaced. None is real-backend or native evidence. The status column
is the result on `a0783bb` (§7.3). Command (in an owner-opened window, after
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
| PM9-B1 | `populated`, row viewed, spectrum selected, reference inspected | U1, U10 | Project, viewed acquisition, scope and inspected reference each read from their owner, with no activity item; each item, by pointer and by Tab plus Enter, changes only the surface and the current destination; the focus ring is visible; no request while every owner is idle | PASS |
| PM9-B2 | `populated` plus one membership toggle, spectrum 0 and one m/z zoom | U1, U2, U3, U7 | Roster order, highlight and membership, the selected scan, the committed m/z caption, and the viewing and scope items are unchanged after Conversion → Project → Workbench; no request | PASS |
| PM9-B3 | `projectWithResult` with typed targets | U5, U7 | The typed text is unchanged after Home → project item; no review or run request | PASS |
| PM9-B4 (×4) | `projectWithResult`, `resultPayloadMissing`, `resultPayloadCorrupt`, `resultSourceAndRuntimeUnavailable` | U6, U7 | The report's availability is as recorded. Its state block keeps the payload (whole, missing or damaged), the source (found, or not found where recorded) and new runs (available, or no runtime) apart, as M9.1 reads them. A missing or damaged payload is never read. The inspecting item names the record identically in every state. Details links the producing run and shows the plan SHA-256. Home → inspecting returns to the same report, with no request and no re-read of rows | PASS |
| PM9-B5 | `qcCapture`, capture held | U6, U10 | A busy item and the Project dot while held, unchanged across navigation, with no request; after release no busy item or dot; the inspected object moves to the new QC record (`useProject` `captureQc`) and routes to its report, which carries no verdict words | PASS |
| PM9-B6 | `converting`, then settled through the lane's next slot read, held and released | U4 (lane only), U10 | The running item and active dot; navigation asks nothing beyond read-only reads; nothing moves while the settling read is held; once it is released, the retained item and dot remain and no activity item does | PASS |
| PM9-B7 | `populated` with a held check, then Close and Open | U7, U10 | The busy item and the accepted operation's identifier survive navigation with no request; after release no busy item, and the inspection a check does not change is kept; Close then Open leaves nothing inspected and the viewed row unchanged; only `close_project` and `open_project` are asked | PASS |
| PM9-G (×4) | `populated` idle and `busyInspected`, en and zh-CN, each at 1920×1080 → 1366×768 → 960×640; reduced motion in zh-CN | U9 (observation) | Geometry recorded (§6.4). Asserted only: the page language, no off-origin request, no path on screen, horizontal overflow ≤ 1 px, header controls within the viewport width, context items at the 31.5 px compact minimum, every context item a Tab stop with a visible focus treatment, and no console entry other than motion's reduced-motion notice in zh-CN (the filter added in `292c1d9`) | PASS (observation), after the §7.3 repair |

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

### 6.4 Geometry and reference checks

- Versions. The spec records `candidate` with each frame. The observation block
  does not require the context line, so a pre-draft capture of `d56b17b` can
  use the same block; the functional cases require the line and would fail
  there. The window captured `d56b17b` with a task-owned, untracked copy of the
  spec that differs only in its import paths (§7.4). A capture of the new
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
  threshold is added and no existing limit is relaxed. The window's readings
  and dispositions are in §3.1 and §7.4; the panel floors stay unconfirmed,
  because their owning specs are red for the recorded reasons of §2.
- Still open. The representative set discharges no U9 obligation. Still
  pending: other scenario, language and viewport combinations; DPR and OS
  scaling (native, recorded separately, §7.6); J1–J6 step, decision, request
  and mount measurements ([slice-01](slice-01.md) pending item 4); and no
  screenshot golden. The reference is rendered and §3's production column is
  filled (§3.1).
- Prerequisites: an owner-opened window; the browser config's ChromeDriver and
  a free dev port (5273, or `MSCANVAS_BROWSER_DEV_PORT`); the reference re-hashed
  against §3 before any comparison. No provider, runtime or native session is
  needed.

### 6.5 Static review corrections (PM9.3 preparation)

A bounded static reading of the spec found three test-authoring defects. Each
was corrected test-only in `e2e/specs/pm9.1-baseline.browser.e2e.ts` before
the spec first ran (§7.3).

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

## 7. Validation window (2026-09-25)

The owner opened one validation window for PR #127's local candidate and the
PM9.1 / PM9.2 cumulative candidate. Logs are under `.tmp/vw-20260925/`, and
browser evidence is under `test-results/pm9.1/` and `test-results/pm9.3/`; both
are git-ignored. Every exit below is the command's own.

### 7.1 Candidate and inherited evidence

- Tested production-code candidate: `a0783bb7c64b41cd0c2ab3780573bfb679e3464a`
  (tree `85b5e15e8537d4f41992bd31022447994489029a`). Against `9786809` it
  changes one production file, `apps/desktop/src/features/workbench/workbench.css`
  (§7.3). A later commit that changes only documentation is not a code
  candidate and is not revalidated.
- Rust. `git diff --name-only d56b17b a0783bb` touches no Rust source,
  manifest, lock, `experiments/` or `scripts/` path, and none of the files the
  desktop tests embed with `include_str!`. PM9 therefore inherits the PR #127
  Rust group, which ran on `d56b17b` in this window. Its qualification belongs
  to the integration record (§5).

### 7.2 Frontend and repository checks

| Command | `daa801c` | `a0783bb` |
| --- | --- | --- |
| `pnpm typecheck`, `pnpm lint`, `pnpm e2e:typecheck` | 0, 0, 0 | 0, 0, 0 |
| Vitest over `shellContext.test.ts`, `ContextLineShell.test.tsx` and `app/Pm9Baseline.test.tsx` | 0 — 27 of 27 | in the full suite |
| `pnpm test` | 0 — 109 files, 2198 tests | 0 — 109 files, 2198 tests |
| `pnpm build` | 0 | 0 |
| `python scripts/check_repo.py` | 0 | 0 |
| `git diff --check` (at `daa801c` also against `d56b17b`; at `a0783bb` against `9786809`) | 0, 0 | 0 |

### 7.3 PM9.1 browser spec and the PM9.2 repair

| Run | Commit | Exit | Result |
| --- | --- | ---: | --- |
| First | `daa801c` | 1 | B1–B7 (10 tests) pass; 3 of the 4 PM9-G runs fail |
| Observation block only, after the test corrections | `292c1d9` | 1 | Both `busyInspected` runs overflow horizontally |
| Observation block only, before the PM9.2 draft | `d56b17b` | 0 | 4 of 4 |
| Rerun | `a0783bb` | 0 | 14 of 14 |
| Again, inside the campaign (§7.5) | `a0783bb` | 0 | 14 of 14 |

The first run's three failures had two causes (1 and 3 below). The run also
exposed a fixture artefact (2) that failed no assertion:

1. **zh-CN idle.** Motion's development build warns that reduced motion is
   on, and the spec's console check counted the warning. Test-only fix in
   `292c1d9`: a filter for that one notice, in zh-CN only, where reduced motion
   is emulated.
2. **A fixture artefact.** The spec's table answered the drop subscription with
   `null`, which put a false "drop unavailable" notice on screen and raised the
   notices band from 89 to 120 px in the first run's frames. Test-only fix in
   `292c1d9`: it answers with a reservation, as the M7.2–M7.4 specs do.
3. **A PM9.2 regression.** In `busyInspected` at 960×640 the document
   overflowed horizontally by 231 px in en and 88 px in zh-CN, a shell 1191
   and 1048 px wide. The same observation block passes at `d56b17b`. The shell
   is one implicit `auto` grid column sized by its items' min-content, and the
   context line's unwrapped items counted at their full text length. Repaired
   in `a0783bb` (repair cycle 1 of the window's budget of two; the second was
   not used) with
   `contain: inline-size` on `.shell-context`: the items now ellipsize inside
   the width the header gives them.

B1–B7 pass, and the final authored set passes 14 of 14.

### 7.4 Before and after the PM9.2 draft

The observation block at `d56b17b` (before) and at `a0783bb` (after), twelve
frames each:

- The header grows from 75 to 88 px in every frame, and the work area loses
  the same 13 px. The main region's on-screen height loses 13 px in eleven of
  the twelve frames; the before capture of idle zh-CN 1366×768 is an unsettled
  reading (its main region recorded 888 px tall at a 768 px viewport), and its
  en pair shows the 13 px. The notices band stays 89 px.
- At 960×640 idle, the spectrum panel's on-screen height falls from 38 to 25 px
  in en and from 89 to 76 px in zh-CN. Panels that were fully visible do not
  change.
- Horizontal overflow is 0 in every frame, before and after.
- The document's vertical overflow is positive in every frame, before and after
  (§3.1, L22).
- Keyboard stops rise from 84 to 126 across the frames. Every stop is in the
  viewport with a visible solid outline.
- The only console entries are motion's reduced-motion warning: 6 before and
  26 after, counted per test (10 and 40 with each evidence file's closing
  reread of the last test's buffer). The counts follow the invocation, not the
  PM9.2 code: the before capture ran only the observation block, and the
  observation-block run at `292c1d9`, which carries the context line, also
  records 6.

### 7.5 Full browser campaign

- **Topology.** All 30 browser spec files, on `a0783bb`, in five parallel
  shards on dev ports 5273–5277, with m6.4 split into two halves by test
  title. The owner asked for the speed-up; this is not the serial topology the
  window first requested.
- **Comparison.** Each test's pass or fail, by stable test identity, across the
  whole corpus, against published `main` `1daf802` (317 tests) and, for the
  M8/M9 specs, the M9 closure run. Failure text was compared, number-normalized,
  only for m7.2 and m7.5.

| Outcome | Tests |
| --- | ---: |
| Same pass | 179 |
| Same known failure | 174 |
| New PM9 specs (PM9.1 14, PM9.3 11), all passing | 25 |
| New failure / now passing / no result | 0 / 0 / 0 |
| Total | 378 |

The supported conclusion is narrow: **no new browser outcome regression
observed.** m7.2 fails 10 of 11 tests on the baseline, so the legacy suite
cannot by itself show that the shell change is free of regressions. §7.3 and
§7.4 add direct before-and-after observations of the shell: they found and
repaired one regression and record the 13 px the header takes. They are
observations, not proof that no regression remains.

### 7.6 Scaling and native Windows

- The host's display scaling was read as 150 % (`AppliedDPI` 144; 3840×2160
  physical, 2560×1440 logical). Every browser frame used DPR 1, so none of
  this is native rendered acceptance at 150 %.
- Native Windows rendered acceptance at 150 %: **PENDING**, not run.
- The provider-positive native route: **BLOCKED_PROVIDER_HOLD**. A native
  window checks the backend on mount (the `checkBackend` effect in
  `usePreviewWorkspace.ts`), and `inspect_backend` probes the installed
  ProteoWizard with `--help` (`probe_tool` in
  `crates/proteowizard/src/discovery.rs`), which the ProteoWizard HOLD does
  not allow in this window.

### 7.7 Status after the window

- **PM9.1: NOT COMPLETE.** B1–B7 pass, the final authored set passes 14 of 14,
  and the browser rendered baseline is established. Native rendered
  acceptance at 150 % is PENDING, the provider-positive native route is
  BLOCKED_PROVIDER_HOLD, and [slice-01](slice-01.md)'s J1–J6 measurements and
  helper diagnoses are not done.
- **PM9.2:** browser functional acceptance passes, with one regression found
  and repaired in `a0783bb`. Visual and product acceptance wait for the §3.1
  actions and L20's conditions ([slice-02](slice-02.md)).
- **PM9.3:** the viewer contract spec passes 11 of 11 against the unchanged
  viewer, which shows that the authored harness executes. Production
  implementation has not started ([slice-03](slice-03.md)).

## 8. Reconciliation with the accepted main (2026-09-26)

PR #127 was merged into `main`, and its natural-main CI succeeded. The PM9
branch, which started from the provisional base `d56b17b`, was then reconciled
with that main by one local true merge. Nothing was pushed. Local records are
under `.tmp/pm9-reconcile/` (git-ignored).

| Role | Commit | Tree |
| --- | --- | --- |
| Accepted main M: the merge of PR #127, parents `1daf802` and `817f692` | `57915dea6e5227fd9fe6de6532ca3201c9819c85` | `a25610b3470fed0168f0d54c1576deb0a7bbdc2a` |
| PR #127's qualified code; M's tree is its documentation successor `817f692`'s | `03effab38e7101b6dec33f6bb0f9fdda18f0f3e1` | `9f0fab3316ca3fa426390d7801dc6e7f41b63982` |
| PM9 before the merge, P: the documentation successor of the tested code | `505f778e7a530798ab780cdd3fa6400e89ea54b3` | `3f2a90fd3e462cac09637af846364403e5f8ea47` |
| PM9's last tested production-code candidate (§7) | `a0783bb7c64b41cd0c2ab3780573bfb679e3464a` | `85b5e15e8537d4f41992bd31022447994489029a` |
| The only common ancestor of P and M (`git merge-base --all`) | `d56b17b6eab8dfdc5e15a85959c971121ee7685c` | `a0b237ce11d2bb4b8851feb6ea39f1f180c66a99` |
| **Reconciliation merge N**: first parent P, second parent M | `052db1fdb765ebb09da0bcbb94b0969e70898900` | `a43a5130cb7e4fa8171441b3ab4bbc640ee20a8f` |

N's tree is a composition of both sides and equals neither.

**The two sides since `d56b17b`.** Main changed three paths:
`apps/desktop/src-tauri/src/targeted_ms1.rs`, its `tests.rs`, and
`docs/development/M8_M9_SOURCE_INTEGRATION.md`. PM9 changed twenty: the
frontend sources and tests of PM9.1 and PM9.2 under `apps/desktop/src/`, the
two specs under `e2e/specs/`, and `docs/phases/pm9/`. No path changed on both
sides, and there were no renames or deletions. `git merge-tree` and the merge
itself reported no conflict.

**Source composition, checked with Git alone.**

- N differs from M on exactly PM9's twenty paths, and from P on exactly main's
  three, so every other path is the same in `d56b17b`, M, P and N.
- Each of main's three paths has M's blob in N, and each of PM9's twenty has
  P's blob.
- `git diff --quiet M N --` `apps/desktop/src-tauri`, `crates`, `experiments`,
  `scripts`, every workspace and JavaScript manifest and lock, and `.github`
  exits 0. The five frontend files the desktop tests embed or read
  (`api.ts`, `contracts.ts` and `dropTransport.ts` under `mzml-preview`,
  `preferencesApi.ts`, `projectApi.ts`) are M's. `apps/desktop/src-tauri` and
  `crates` equal `03effab`'s, so N carries the signal-summary check and every
  earlier project-integrity repair unchanged.
- `git diff --quiet P N --` `apps/desktop` (without `src-tauri`), `e2e` and the
  JavaScript manifests and locks exits 0, and `git diff --name-only a0783bb N`
  lists no path there either: the frontend and browser-test inputs are the
  ones tested in §7, `a0783bb`'s `contain: inline-size` repair included.
- `git diff --check` from P to N and from M to N exits 0.
- The merge introduced no dependency, workflow, runtime, scientific or file
  format change of its own.

**Evidence, attributed.**

- *Main's code.* The real-runtime suite (34 of 34), the workspace tests (1916
  passed), clippy, the release check and the repository checks ran on
  `03effab` (integration record §14). Natural-main CI ran on M, push event,
  first attempt, all successful: Repository quality 36218745778, Frontend
  36218745689, Rust 36218745697.
- *PM9's frontend and browser.* §7's runs on `a0783bb` hold for the same inputs
  in N.
- *The combined tree N.* No runtime, component or browser campaign has run on
  it. Equal inputs and a clean merge do not prove every cross-layer behaviour,
  so N is **SOURCE COMPOSITION CHECKED — NO NEW RUNTIME VALIDATION**, not a
  qualified candidate.

The PM9 acceptance status is unchanged by the merge: PM9.1 is not complete
(§7.7), PM9.2's visual and product acceptance is pending, PM9.3's
implementation and PM9.4–PM9.7 have not started, and the ProteoWizard HOLD
still keeps a native launch, which probes the provider on mount, out of reach
(§7.6).

## 9. PM9.2 focused rendered acceptance (2026-09-26)

On `feat/pm9-product-convergence`, from `28e3f11`, in the owner's dispatch
"PM9.2 — focused rendered acceptance and closure". Browser specs only, one at
a time; Cargo, Rust, OpenMS, provider and native work were out of scope, and
the frontend static, unit and build checks of the implementation were taken as
given except where a repair changed code. Records are git-ignored:
`.tmp/pm92-accept/run1`–`run4` and `test-results/<spec>/browser-*`.

**Memory.** Heavy work waited for admission (≥ 8 GiB available, ≤ 80 % used)
from 03:51, when 5.17 GiB was available, until 04:07 (8.41 GiB, 73.4 %). Every
spec's reading is in its run's `summary.txt`; none approached the emergency
stop.

**Runs.**

| Run | Candidate (tree) | Specs | Outcome by stable identity against `a0783bb` |
| --- | --- | --- | --- |
| 1 | `fc6506c` (`ec4fa27`) | PM9.1; m7.5, m7.2, m5.7, m6.1, m6.4; m8.1–m8.5, m9.1, m9.4; PM9.3 | 71 same pass, 45 same known failure, 1 now passing, 0 new failure; PM9.1 16 of 21, its five failures the new order assertion and a measurement artefact |
| 2 | `a2ccfbf` (`64a19f3`), after the repair | the same without m5.7, m6.1, m6.4 | 64 same pass, 11 same known failure, 1 now passing, 0 new failure; PM9.1 21 of 22, one unsettled read |
| 3 | `8d3c9d8` (`683f616`) | PM9.1 | 22 of 22 |
| 4 | `0d22fc7` (`9610fe3`), final | as run 2, with m5.7 | 71 same pass, 12 same known failure, 1 now passing, 0 new failure; PM9.1 22 of 22 |

Known-failure text was compared number-normalized with the campaign's shard
logs for m7.2, m7.5, m5.7 and m6.1 and is the same for every test; m6.4 ran
in two halves in the campaign and is compared by outcome only. The test that
now passes is M7.5's gated startup, which requires every refused control to be
reachable; Details used to be `disabled`.

**Two measurement corrections, test-only.** The first ellipsis probe took a
14px font in two zh-CN frames and reported ellipses the pixels do not show;
`a2ccfbf` measures an unconstrained copy of the item instead. And a read taken
straight after a viewport change can still see the previous height (run 2's
zh-CN busy frame at 1366×768: main region 964 px, document 312 px over, while
its screenshot shows the settled layout; §7.4 records the same at `a0783bb`);
`8d3c9d8` reads a frame only once the `100vh` shell fills the viewport, at most
65 ms in run 3.

**The one repair cycle.** `56d8262` gave each context rank a shrink factor 1e8
times the one above it, made the drop hint give way before the line, raised
the floor to 5.5em, and quieted Clear list. Its rule putting the en selection
count on New group's row crushed the count to six lines whenever the Undo link
shows (m7.2 frames 05 and 08: band 121 px, against 67 px before the repair and
75 px at `a0783bb`); `0d22fc7` restored that rule to run 1's state.

**Rendered judgement.** Two read-only passes judged each row from the
screenshots and the recorded geometry, every finding checked by an adversarial
second reader; the dispositions and limits are in
[slice-02](slice-02.md#focused-rendered-acceptance-2026-09-26).

**At 960×640, before (`a0783bb`) and after (`0d22fc7`).**

| Frame | Notices | Main on screen | Evidence on screen | Document vertical overflow |
| --- | ---: | ---: | --- | ---: |
| idle en | 89 → 0 | 435 → 524 | spectrum panel 25 → 85 | 555 → 0 |
| idle zh-CN | 89 → 0 | 435 → 524 | spectrum panel 76 → 136 | 504 → 0 |
| busy en (Project) | 89 → 0 | 435 → 524 | targeted report 209 → 269 | 851 → 0 |
| busy zh-CN (Project) | 89 → 0 | 435 → 524 | targeted report 227 → 287 | 815 → 0 |

The header stays 88 px; the L1 title takes 29 px of the 89 px the fold returns.

**Status at `0d22fc7`.** PM9.2: every obligation passes in the browser except
L14–L16 (e) in en, which waited for the owner's decision on the scope wording. PM9.1 is
unchanged by this run: J1–J6 measurements and the helper diagnoses are not
done, native rendering at 150 % is PENDING, and the provider-positive route is
BLOCKED_PROVIDER_HOLD. PM9.3 has not started; L13 is its first item.

**Closure (2026-09-26).** The owner chose the English scope wording
"Conversion: {{scope}} · {{eligible}} eligible" (zh-CN unchanged). The final
code candidate is `b81fc785d2be703e09ac4183dd1c3a17dea58cb7`, tree `45da59b2f569d862e825b4621d222b9d38e38767`; against `0d22fc7`
its only production change is that value. Run 5 (`.tmp/pm92-accept/run5`,
memory 9.63 GiB available, 69.6 % used) ran PM9.1's spec on it: 22 of 22, B1–B7
included. At 960×640 in en with long names the scope keeps "Conver…", and in
zh-CN "待转换…"; the status is whole, the order holds, the line is one row, and
the document has no overflow. Status: **PM9.2 PRODUCT CONVERGENCE COMPLETE —
FOCUSED RENDERED ACCEPTANCE PASS.** PM9.1's residual obligations above are
unchanged; PM9.3 has not started.

## 10. Mid-phase normalization (2026-09-26)

**Why now.** Two unfreeze conditions in [slices.md](slices.md) had been met.
The last one: PM9.2 closed without the legacy browser-spec repairs §2 assigns
to its surfaces. The fourth: the verification backlog had items with no clear
owner, and the records held PM9.1 open for residuals its own contract does not
name, which blocked a reliable start of PM9.3. A later coordination note had also proposed calling PM9.1 complete
and moving its residuals elsewhere without this procedure; that proposal is
not adopted. Only the scope ledger, decisions, route and roadmap were rerun,
then the plan check. This does not replace the midpoint check after PM9.3.
Nothing was run: the evidence is the tracked records, their Git history and
the retained runs they cite.

**PM9.1's contract.** The tracked [slice-01](slice-01.md) Completion, frozen
when the plan was materialized (`12444a5`), requires: the tests run and recorded;
rendered scenarios at three viewports and two languages with keyboard and
reduced-motion samples; the deviation table filled, each difference classified
as recorded intentional, a gap for a named slice, later, or not applicable;
J1–J6 measured before later slices change them; and the verification entry
points confirmed. The planning original it came from also says OS scaling is
recorded and that browser evidence infers no native qualification.

**Residual items, each in one class.** A: required by PM9.1's contract.
B: meaningful only at integrated acceptance. C: native, provider or release
qualification owned outside the PM9 slices. D: not in the contract; kept only
for a named consequence.

| Item | Where it was required | Evidence now | What it supports | Class | Owner | If left where it was |
| --- | --- | --- | --- | --- | --- | --- |
| J1–J6 step, decision, context, confirmation, preserved-ID, IPC and mount measurement | slice-01 pending item 4 and Completion ("J1–J6 measured") | None beyond B1–B7's own request ledgers. PM9.2's "J1 and J6 show no lost context" rests on B1, B2 and m8.2's Details folding, which show preserved context, not these counts | The before side of U1's and U10's before-and-after comparison | **A** | **PM9.1**, measured on the recorded pre-PM9 candidate `d56b17b` (§7.4's before capture), so later slices cannot move it; required before PM9.7 | — (stays) |
| Deviation rows without a classification: parts of L3, L5 and L21; L7 at 1920×1080; L11; L12 | slice-01 pending item 3 → Completion ("deviation table filled") | Production column filled (§3.1) | Each slice's presentation decisions and PM9.7's reference-deviation disposition | **A**, satisfied by the classification below | Classification here; work by the named slice; final disposition PM9.7 | PM9.1 short by a classification its own record can make |
| The shared `openTheViewer` helper diagnosis | slice-01 pending item 5; not in its Completion | Failure family (a) in §2 and slice-03 §5 | Repairs of m4.3, m4.4, m5.2, m5.3, m5.7 and viewer-r1, which call the helper; the same toggle-then-wait is copied into m7.2, m7.3 and m7.4 | **D**, with that consequence | **PM9.3**, as the first repair slice-03 §5 already plans, with the copies in m7.3 and m7.4's viewer cases; m7.2's copy goes with m7.2 to PM9.7 | Two owners for one repair, and PM9.1 held open by work its contract does not name |
| m7.2's own `metrics()` diagnosis, and the remaining failures of PM9.2's surface specs: m7.1 3 of 3 (last run on `a0783bb`, §7.5); m7.2 10 of 11, two of them its own copy of the toggle-then-wait; m7.4's two active-Clear cases; m7.5 1 of 8 | slice-01 pending item 5; §2's slice-2 rows | m7.2 and m7.5 fail with unchanged text on `0d22fc7` (§9, run 4); m7.1 and m7.4 were not rerun after PM9.2, which records that it repairs only what its own changes touch | Rendered regression coverage of roster organization, focus and Settings (U2 and the regression list) | **D**, with that consequence | **PM9.7**, as regression-gate work: repaired, retired against a named replacement, or recorded with a diagnosis | Owned by a closed slice |
| The panel floors at 960×640 | Verification backlog item 3; slice-02 risks | Unconfirmed; the owning specs are red. PM9.2 took the quiet notice band to 0 px (§9) | ADR 0006's narrow-window budget | **D**, with that consequence | **PM9.3**, measuring the floors when it re-derives m7.3's and viewer-r1's geometry; m7.2's own geometry assertions go with m7.2 to PM9.7 | No owner |
| Native Windows rendered acceptance at the host's 150 % scaling | slice-01 pending item 2 as a note; backlog item 1; PM9.2's closure. In no slice's Completion; the brief records OS scaling separately | Scaling recorded (§7.6). A native window probes ProteoWizard on mount, which the HOLD does not allow | Native and installed qualification of the product candidate | **C** | **M7.6-style installed, native, provider and release qualification against PM9.7's frozen candidate** ([ROADMAP](../../../ROADMAP.md), after M9) | PM9.1 could never close while the HOLD stands |
| States §3.1 did not capture: the pending range band, the empty viewer entry, roster-open and Details-open at 960×640, the Conversion surface, the other empty and entry states, scrolled and focus-driven positions | slice-01 pending item 3 lists them as not part of the comparison; no difference was found to classify | None rendered against the reference | The owning slices' presentation decisions | **D**, with that consequence | Compared by the slice that owns each: the first three by PM9.3, the Conversion surface by PM9.4; the application's other empty and entry states (the `empty` scenario) and scrolled and focus-driven positions in PM9.7's integrated pass; final disposition PM9.7 | No owner for a comparison the owning slice needs |
| The provider-positive native route; U4's live-provider check | §7.6; backlog item 1; brief U4 ("stays PENDING under the ProteoWizard hold") | BLOCKED_PROVIDER_HOLD | A live conversion by ProteoWizard | **C** | The same qualification; blocked until the HOLD is lifted | As above |

No item is class B: J1–J6's before side is a baseline and belongs to the
opening slice, while its after side was already PM9.7's (brief U1 and U10).

**Deviation rows classified** (this record's reading, as in §3.1; the owner's
final disposition is PM9.7's):

- L3, stacked rather than side by side and no heading or tabs over the
  evidence: gap for PM9.3, with identity placement and dominance.
- L5, the scan table below rather than beside the spectrum: gap for PM9.3.
- L21, what stays visible at 960×640 with the roster or Details open, and
  swap rather than stack: gap for PM9.3. The one-row navigation: recorded
  intentional, by analogy with the owner's L14–L16 rule against another
  wrapped header row, as PM9.2 rendered it without overflow in either language
  (§9); this is the record's reading, which the owner confirms at PM9.7.
- L12, SHA-256 values and long names wrapping in Details: gap for PM9.6.
- L7 at 1920×1080 (roster 280 px against 285 px) and L11 (outer inset): later,
  as the brief's "non-critical layout adjustments" if time allows.
- The states §3.1 did not capture are compared by their owners, as in the
  table above; native windows and OS scaling by the qualification above.

**PM9.1: PARTIAL.** Every contract item is met except J1–J6. It stays open for
that measurement alone. The earlier statement that native acceptance and the
provider route kept it open is superseded: neither is in its contract.

**PM9.2: COMPLETE, confirmed against its own Completion.** On the final
candidate `b81fc78` the five Vitest files its last change affects (51 tests)
and PM9.1's spec (22 of 22) pass; the full Vitest suite last ran on `e533c94`
(110 files, 2212 tests); and the affected browser suites showed no new
failure on `0d22fc7` (§9, run 4: m7.2 1 of 11 and m7.5 7 of 8 with unchanged
failure text, m5.7 7 of 8, the M8/M9 specs and PM9.3's all passing); m7.1 and
m7.4 were not rerun after PM9.2, and its record limits its legacy repairs to
what its changes touch. The context line, the owner's actions and L20 are
rendered at three viewports in both languages with keyboard and
reduced-motion samples, all twelve PM9-G keyboard walks included; the context
line was compared with the reference's (§3.1, L14–L16). J1 and J6 show no lost
context in B1 (every item only changes the surface; Home and keyboard), B2
(roster, viewed scan and committed m/z view kept across surfaces) and m8.2's
Details folding. m7.5's one remaining failure stops at a wait for the reset
control's `disabled` (m7.5:447), which the header refuses with `aria-disabled`
— the stale assertion §2 recorded — before its keyboard assertion, so it is
no evidence either way; it is PM9.7's. The English
scope decision is recorded. The manual review harness
(`c5a3f7e`) is test infrastructure, not a capability. Its surface specs'
pre-existing failures are PM9.7's, as above.

**Decisions changed here.**

1. Native rendering at OS scaling and every provider-positive check leave the
   PM9 slices for the M7.6-style qualification that follows PM9.7's frozen
   candidate, as the roadmap already orders. PM9.7 records them as PENDING or
   BLOCKED_PROVIDER_HOLD, never as passed. Latest decision point: PM9.7's
   candidate freeze, where the owner decides whether PM9 closes with them
   open, and whether U4 can be accepted with its live-provider check open.
2. J1–J6 stays PM9.1's, pinned to `d56b17b`. Latest point: before PM9.7
   starts. It does not block PM9.3–PM9.6, because nothing they change can move
   that candidate. PM9.3's own before-and-after of its viewer paths, on the
   PM9.2 final candidate, is a different measurement and does not replace it.
3. The `openTheViewer` repair, its copies in m7.3 and m7.4's viewer cases
   and the 960×640 panel floors are PM9.3's. The m7.2 `metrics()` diagnosis
   and the remaining failures of PM9.2's surface specs (m7.1, m7.2 with its
   own copy of the toggle-then-wait, m7.4's two active-Clear cases and m7.5)
   are PM9.7's; m7.4's two conversion-intent cases stay PM9.4's. This
   supersedes §2's slice column for m7.1, m7.2, m7.4's active-Clear cases and
   m7.5.
4. [slice-03](slice-03.md)'s expansion is void under the unfreeze rule.
   PM9.3 re-expands when it starts, reusing its §1–§5 evidence.
5. PM9.3 may start while PM9.1's J1–J6 and the external qualification remain
   open.

**Plan check** (three passes; the second and third by a reader who had not
written the plan, whose findings are corrected above; nothing is left
unresolved):

- Coverage: every open item above has one owner, including the backlog, §2's
  slice column, slice-03 §5 and §6, the open deviation rows and the states
  §3.1 did not capture; every facet of U1–U10 has a slice in the route, with
  PM9.7's integrated acceptance over all ten.
- Conflict: no item is both PM9.1's and another slice's; J1–J6's before and
  after sides are two measurements with two owners; §2's slice-2 rows are
  superseded, not duplicated.
- Size: still seven slices. PM9.7 now carries the PM9.2-surface legacy
  failures besides its route, bounded by "repaired, retired against a named
  replacement, or recorded with a diagnosis". PM9.3's and PM9.4's legacy
  loads are as §2 and slice-03 §5 already recorded, and unchanged here. If a
  slice cannot fit one session, the unfreeze rule applies and "if time allows"
  work goes first. No eighth slice.
- Dependencies: PM9.3 depends on PM9.2, which is complete. PM9.1's remainder
  is a precondition of PM9.7 only.
- Completion: PM9.1's and PM9.2's statuses follow from their own Completion
  text, not from convenience.

## 11. PM9.3 focused rendered acceptance (2026-09-28)

The full record is in
[slice-03 §0.5](slice-03.md#05-validation-repair-and-closure-2026-09-28); this
section keeps what later slices and PM9.7 read from the baseline.

- **Candidate.** `d98432bd82e6ba25531cef0b06f453dff6a55351` (tree
  `54bdfc7044f5df7740e78a0bc78974ad1ad2eeb6`). Its production code is
  `55c30f3`'s. Every browser frame is controlled-IPC Chrome at DPR 1 and is not
  native evidence.
- **Before-and-after.** The before side is the viewer of `eae0fc3` under
  PM9.3's extended G case (`test-results/pm9.3/before/browser-B9rgaP`). It is
  PM9.3's own measurement, not PM9.1's J1–J6. At 960×640:
  - the chromatogram panel is 398 → 368 px in en and 347 → 368 px in zh-CN;
  - the spectrum header is 102 → 56 px;
  - the spectrum plot on screen is 0 → 13 px in both languages;
  - toolbars over one row went from the chromatogram (en) and spectrum
    headers to none.
- **L13.** Fixed, and asserted in every default arrangement of the sweep.
- **L3.** The viewed file is named, untruncated, in the context line at every
  size, and in Details. No heading is added to the evidence column.
- **L5.** The scans stay below the spectrum, and they are verified reachable.
- **L21.** At 960×640 the roster or Details swaps with the evidence, and the
  header and the context line stay.
- **The 960×640 panel floors** are met in task terms (slice-03 §0.1(2)). ADR
  0033's floors and `app.css`'s `.viewer-stack` grid rows are inert under the
  M7.2/M7.3 stack. ADR 0006's 544 px is unchanged; that its breakdown names a
  removed sidebar is an owner question for PM9.7.
- **The fixture store.** The shared answer table's fixed
  `save_ui_preferences` record reads `automatic` layout and `en` back. The
  shell adopts what a save confirms, so every spec that toggles a panel or
  applies a language through Settings must install `readBackSavedPreferences`
  (`e2e/support/viewer.ts`). This also covers m7.2's copies and m7.4's
  active-Clear pair, which are PM9.7's.

## 12. Known UI/UX rework (2026-09-28)

**Why.** The owner changed the priority on 2026-09-28. Every UI/UX issue that
is recorded and still present on an implemented surface is closed before
PM9.4. The earlier plan, the midpoint check and then PM9.4, is paused. This is
bounded rework under PM9, not an eighth slice. PM9.2's and PM9.3's acceptance
records stay as historical facts. The status is **KNOWN UI/UX REWORK ACTIVE —
PM9.4 HELD**. PM9.1 stays PARTIAL for J1–J6.

**Inventory.** One read-only sweep of the ledgers (this baseline, slice-02,
slice-03 and the M7.x/M8.0 UX records) found 91 candidates. Each was checked
against the code at `3588e30` and deduplicated. A completeness critic added the
Blink-rounding item and the Conversion/Project swaps. The advisor added the
960×640 task check. What follows is the frozen, finite list.

Planned action:
- **FIX**: a production change.
- **RENDER**: an untested state, exercised; a defect found is fixed.
- **MEASURE**: a measurement pass; concrete defects are fixed and kept
  deviations recorded.
- **BOUNDARY**: not a UI defect on an implemented surface, with the reason and
  the owner.

The result column is filled at closure.

| ID | Source | Surface, condition | Kind | Expected | Action | Result |
| --- | --- | --- | --- | --- | --- | --- |
| UI-01 | L11 | Shell insets; header 20/12 px against content 16 px | reported | The left edges of the header, notices and content align; the inset rule is recorded | FIX | FIXED AND RENDER-VERIFIED: 16 px header inset; the header's, an open notice's and the content's left edges agree within 1 px at 1920, 1366 and 960, en and zh-CN (before: header 20 px, content 16 px) |
| UI-02 | PM9.2 limits | Drop hint when squeezed: a clipped first glyph and a 16 px gap left behind | reported | The hint is whole or gone, and its gap goes with it; the give-way order is unchanged | FIX | FIXED AND RENDER-VERIFIED: `fitContextLine`; the hint is whole or gone, its gap with it, at seven widths, en and zh-CN |
| UI-03 | PM9.2 limits | Unsaved, very long project name at its floor | untested (fails by construction) | The unsaved marker leads and survives the floor, en and zh-CN | FIX | FIXED AND RENDER-VERIFIED: "Unsaved changes: …" / "未保存的更改：…" with a 7em floor; the marker is visible at every width (before: "Project", "项目（") |
| UI-04 | PM9.2 limits | Two rank-1 statuses (conversion running and a project check; Rust does not refuse project operations during a conversion) | untested | Both statuses whole; lower ranks give way in order; nothing hard-clipped | RENDER | VERIFIED — NO DEFECT FOUND: both statuses whole at 1366, 1152 and 960, each a visible focus stop, en and zh-CN (the zh-CN case first failed on the test's English Home label) |
| UI-05 | PM9.2 limits, L3 residual | The rank-2 object shrinking after ranks 3–5 floor, with long viewed and inspected names | untested | Rank 2 gives way last and keeps an identifying prefix | RENDER | FIXED AND RENDER-VERIFIED (with UI-48): the viewed file keeps "View…" / "正在查…" at every width; rank 2 gives way last by construction |
| UI-48 | PM9.2 limits (critic) | The give-way order rests on 1e8/1e16/1e24 shrink factors and Blink rounding | reported | Explicit, engine-independent allocation (a pure function with a unit test); PM9.1's order checks stay green | FIX | FIXED AND RENDER-VERIFIED: `allocateLine` with six unit cases replaces the 1e8 shrink factors; PM9.1's order cases pass |
| UI-12 | M7.4 | Home off the viewport after a programmatic scroll | suspicion | The root never scrolls; Home stays on screen | RENDER | VERIFIED — NO DEFECT FOUND: the root does not scroll and Home stays on screen at 960×640 |
| UI-06 | PM9.2 L10 | Superseded backend reading after the L10 fold | untested | The band stays unfolded with its actions and help, with no header toggle | RENDER | VERIFIED — NO DEFECT FOUND: the superseded reading stays unfolded with its three actions and no header toggle, 1366 and 960, en and zh-CN |
| UI-07 | PM9.2 L10 | Keyboard focus in the banner help when a quiet verdict arrives | untested (Vitest only) | Not folded under the reader; focus kept | RENDER | VERIFIED — NO DEFECT FOUND: not folded, focus kept (the first run's failure was a headless page without system focus; the case now emulates it) |
| UI-08 | M8.0 A4 | Focus rings on the banner's recovery actions | untested | Visible, unclipped 2 px ring | RENDER | VERIFIED — NO DEFECT FOUND: every recovery action's ring is visible and inside the notices at 1366 and 960 |
| UI-09 | M8.0 A3 | Empty evidence restates the backend sentence ("Install ProteoWizard…; existing acquisitions remain"), which is wrong for unsupported or quarantined readings and for an empty roster | reported | Said once, in the banner; the evidence pane makes no false claim | FIX | FIXED AND RENDER-VERIFIED: the pane says "Plots and scans can be read once the backend above is usable." and repeats no banner sentence, for missing, unsupported and quarantined readings, en and zh-CN (before: the install instruction in all three) |
| UI-10 | M8.0 A2, §3.1 | The `empty` first-run state, never rendered | untested | Reads as purposeful, with truthful next actions and no new primary | RENDER | FIXED AND RENDER-VERIFIED (with UI-09): the empty first run reads as purposeful, with no primary in the evidence pane, at three sizes, en and zh-CN |
| UI-11 | §3.1, §10, critic | Scrolled and focus-driven positions on the roster, Conversion, Project, Settings and Details; the roster/Details swap at 960×640 on Conversion and Project | untested | Focus visible and on screen; nothing sticky covers it; no document overflow | RENDER | VERIFIED — NO DEFECT FOUND: keyboard walks the roster, Conversion, Project and Settings at 1366, Details with links in it, and each panel that swaps in on Conversion and Project at 960×640, with focus visible, on screen and uncovered and no document overflow |
| UI-15 | PM9.2 L9 | The en selection count on its own line in the organizing row | reported | One line where it fits; never crushed; decided together with UI-17 | FIX | VERIFIED — NO DEFECT FOUND: the count stays whole and takes the band's second line where the 280 px roster cannot hold it beside the buttons, decided with UI-17; the component comment that said otherwise is corrected |
| UI-16 | PM9.2 limits | The count breaks between a number and its word | reported | Each number stays with its word | FIX | FIXED AND RENDER-VERIFIED: no-break spaces and `keep-all`; forced narrow, the count breaks only between counts, en and zh-CN |
| UI-17 | PM9.2 limits | zh-CN organizing row with Undo, never rendered | untested | Count whole, one text line; band judged | RENDER | VERIFIED — NO DEFECT FOUND: zh-CN with Undo keeps the count whole on one text line; the band's two lines judged acceptable |
| UI-19 | PM9.2 limits | Two filled accents in the retained state (the reopen and Add files…) | reported | One filled primary while the reopen is offered | FIX | FIXED AND RENDER-VERIFIED: one filled primary (the reopen) beside the roster, `Add files…` secondary and enabled; at 960×640, where the roster takes the pane's place, `Add files…` is the one filled action; en and zh-CN (before: both filled) |
| UI-20 | PM9.2 limits | Clear list focus and hover, code-evidenced only | untested | Visible, unclipped ring; discernible hover | RENDER | VERIFIED — NO DEFECT FOUND: Clear list's ring is visible and unclipped and its hover discernible |
| UI-21 | M7.4 | Pointer click on the membership checkbox of a partly clipped roster row | suspicion | Exactly that row toggles; nothing scrolls between press and click | RENDER | FIXED AND RENDER-VERIFIED: a press no longer focus-scrolls or keyboard-reveals the row; exactly that row toggles and the list does not move (before: the list moved 3 px between press and click; a half-clipped checkbox then exposed the keyboard reveal moving it 40 px, toggling nothing) |
| UI-24 | PM9.2 limits | A refused `Capture file facts` (and other refused primaries) at full accent; its reason only in `title` | reported | Refused primaries look refused and stay focusable; the reason is visible text | FIX | FIXED AND RENDER-VERIFIED: refused primaries give up the accent everywhere and stay Tab stops with a visible ring; Capture file facts and targeted Run say their reason as text, en and zh-CN (before: full accent, reason only in `title`) |
| UI-25 | L12 | Details (245 px): SHA-256 values and long names wrap down the column | reported | Short, scannable facts; the full value reachable | FIX | FIXED AND RENDER-VERIFIED: digests one line (the whole value in the tooltip), names at most three lines, no overflow, en and zh-CN (before: digests up to thirteen lines, names six) |
| UI-26 | PM9.3 B | Quick-action caption breaks inside the size ("1200 / × 640 px") | reported | Size kept whole; the line reflows at the separators | FIX | FIXED AND RENDER-VERIFIED: the size is on one line in every default frame, en and zh-CN |
| UI-27 | PM9.3 B | Chromatogram header takes two rows at a 571 px column (roster and Details open at 1152) | reported (PM9.3 regression) | One row; caption kept | FIX | FIXED AND RENDER-VERIFIED: the chromatogram header is one row at the 571 px column, the caption under the buttons, en and zh-CN (before: two rows) |
| UI-28 | PM9.3 B | Spectrum header takes 2–3 rows with Details opened at 1152–1280 | reported | One row where the controls fit; caption kept | FIX | FIXED AND RENDER-VERIFIED: one row with Details open at 1280–1536, en and zh-CN; at 1152 in English the controls measure too wide to sit beside the heading and take one row of their own, the spectrum's sentence whole and uncovered (before, PM9.3's closure: two rows at 1280, three at 1152 in en) |
| UI-29 | PM9.3 §0.1 | Details opened at 1440 and 1536 not written up | untested | Recorded, with header and range rows | RENDER | VERIFIED — NO DEFECT FOUND: Details opened at 1536 and 1440 recorded; every header and range row is one row |
| UI-30 | PM9.3 B | Full-width m/z pill against the chromatogram's content-width pills | reported | One design language | FIX | FIXED AND RENDER-VERIFIED: the m/z pill is as wide as its controls in every default frame |
| UI-31 | PM9.3 B | Range lines print raw floats beside the four-decimal "Showing" | reported | Formatted with the domain formatters; exact values in the editor and export notes | FIX | FIXED AND RENDER-VERIFIED: four decimals on range lines and "full range" before a commit; the exact values stay in the editor and the export notes |
| UI-32 | PM9.3 B | The en chromatogram range row wraps at 828 and 785 px | reported | One line; its disclosures stay Tab stops | FIX | FIXED AND RENDER-VERIFIED: range rows are one line at 828 and 785 px and in every default frame of 690 px and wider |
| UI-33 | PM9.3 B | "(unit not reported)" four or five times per chromatogram | reported | Stated once per axis; the plot's description still carries it | FIX | FIXED AND RENDER-VERIFIED: the unit caveat twice per chromatogram panel (once per axis) and in the plot's accessible description (before: four or five times) |
| UI-34 | PM9.3 §3 | Viewer copy density judged | untested | Judged after the fixes | RENDER | FIXED AND RENDER-VERIFIED: judged after the fixes, one statement per fact; the last duplicate, a settled commit printing the caption's numbers, now says "the range shown" (correction cycle 2) |
| UI-36 | PM9.3 §1 | Failed spectrum load, never asserted | untested | Selection kept, failure and Retry shown, exports withheld | RENDER (Vitest) | VERIFIED — NO DEFECT FOUND (Vitest): the selection is kept, the failure and Retry are shown, the figure and data exports are withheld, and Retry recovers |
| UI-47 | PM9.3 B | Inert `.viewer-stack` grid CSS in `app.css` | suspicion | Removed where the cascade proves it dead | FIX | FIXED AND RENDER-VERIFIED: the `.viewer-stack` grid, gap, overflow and 1120 px rows are removed; the default frames' geometry is unchanged |
| UI-49 | advisor, dispatch §5 | The whole viewer task at 960×640 and 1366×768: entry → select a scan → read the whole spectrum → reach the row | untested | Scroll to the whole spectrum plot measured before and after, with no plot shrunk | RENDER | VERIFIED — NO DEFECT FOUND: measured before and after, identical: at 960×640 the whole spectrum is 207 px of scroll away and its row 434 px, at 1366×768 79 px; no plot shrunk (220 px) |
| UI-42 | §3.1, §10 | Conversion & results: running, settled, ended and review states | untested | Title, no overflow, visible focus, no ETA or percentage | RENDER | VERIFIED — NO DEFECT FOUND: running, settled, ended and review at three sizes, en and zh-CN: title, no overflow, visible on-screen focus on the surface's controls, no ETA or percentage (the first run matched "remaining items" in the stop control's description) |
| UI-44 | M7.5 | zh-CN shows English for six fixed-sentence boundary codes | reported | Owned en and zh-CN resources, frontend only | FIX | FIXED AND RENDER-VERIFIED: six fixed sentences and the count-free queue bound have owned en and zh-CN resources; a refused file picker shows the owned sentence and, in zh-CN, not the boundary's English; `conversion_not_plannable` and three test seams stay declared; the M7.5 record has an appended correction |
| UI-45 | M8.0 C | Type, spacing, radii and control minimums never measured; L8 row density | untested | Measured once; concrete defects fixed; kept deviations recorded (no app-wide text resize) | MEASURE | FIXED AND RENDER-VERIFIED: no undeclared custom property; Roster help's summary is a 32 px target and every visible control is held to it; the caption's never-applied size is removed; the tallies and the kept 11 px deviation are in DESIGN_SYSTEM |
| UI-46 | M8.0 | State and focus colours never compared; undeclared `var()`s; two focus-ring colours | untested/suspicion | Undeclared vars fixed; focus colour decided; kept deviations recorded | MEASURE | FIXED AND RENDER-VERIFIED: one focus colour, the reference's `#1769d1`, Settings included |
| UI-14 | L7 | Roster 280 px at 1920 against the reference's 285 | deviation | One fixed width; 5 px, no task effect | BOUNDARY: recorded intentional in DESIGN_SYSTEM | NOT APPLICABLE: an intentional deviation, recorded in DESIGN_SYSTEM |
| UI-18 | L9 | Moving organizing controls into a menu | decision | L9 passed at PM9.2's closure; UI-15 carries the evidence against it | BOUNDARY: not reopened | NOT APPLICABLE: decided at PM9.2's closure (L9) and not reopened |
| UI-35 | PM9.3 §1 | Chromatogram Full/Current scope kept across previews | semantics | The labels are truthful; changing persistence changes export semantics, which §5 of the dispatch preserves | BOUNDARY: owner decision | NOT APPLICABLE: export semantics, the owner's; the Full/Current labels stay truthful |
| UI-13, UI-22, UI-37–UI-41, UI-43; m6.x | legacy specs | m7.5, m7.2, m4.1, m4.2, m5.3, the m4.3/m4.4/viewer-r1 setup and (d) cases, m7.1; m6.1–m6.9 | test debt | Stale harness setup, not a UI defect. Owners unchanged: PM9.7; m6.x PM9.4 (held). More than one reviewable repair | BOUNDARY | NOT APPLICABLE: stale harness setups, not UI defects; owners unchanged (PM9.7; m6.x with PM9.4). On `ea85a88`, m4.3, m4.4, m5.2, m5.3, viewer-r1 and viewer-r1-scale fail only as at PM9.3's closure, message for message; m4.1, m4.2, m7.1, m7.2 and m7.5 only as in the PM9.1 campaign's classification (by outcome, m7.2's messages checked), one m7.5 case now passing; m6.x NOT RERUN, every case having failed in that classification (57 of 57) |
| UI-23 | PM9.3 §0.5 | m7.4's active-Clear pair (focus back to Add files at 960) | test debt, one line | Exercised because UI-19 changes Add files: the reveal goes through `revealRosterRow` | RENDER (test-only repair) | FIXED AND RENDER-VERIFIED (test-only): the pair opens the roster through `revealRosterRow`; m7.4 16 of 16 |

**Closure (2026-09-28).** Every row above has its result; none is UNRESOLVED.
Code candidate `ea85a8873e15684ad4bf86ea2c0368941d74bdd4` (tree
`72251d3f6078d7bc7f852e4c9b0b7154a1f0cf7b`), after `ec10c59` (production),
`4078601` (tests), `859eaf0` (correction cycle 1) and `ea85a88` (correction
cycle 2). One independent review, three dimension reviewers with a skeptic per
finding, confirmed fifteen findings, all applied in cycle 1: a UI-19 regression
in the constrained layout, the UI-03 and UI-09 copy, four stale unit tests, m5.7's
description, a docstring, and coverage in UI-01, UI-11, UI-28 and UI-42. Cycle 2
came from validation: a settled commit still printed the caption's numbers
(UI-34), and UI-44 had no rendered case.

Static on the candidate, each exit 0: `pnpm lint`, `pnpm typecheck`,
`pnpm e2e:typecheck`, `pnpm test` (111 files, 2222 tests; the repository has no
low-concurrency mode, `test` is `vitest run`), `pnpm build`,
`python scripts/check_repo.py`, `git diff --check`. No manifest, lock, Rust,
schema or provider path changed since `3588e30`.

Browser, controlled IPC at DPR 1, one spec at a time behind the memory gate:
PM9.1 55 of 55 and PM9.3 13 of 13. Together they cover the three anchors and the
eleven-size sweep in en and zh-CN, reduced motion in zh-CN, Details opened at
1536–1152 including the 571 px column, and the 828 px evidence column. m5.7
8/8, m7.3 16/16, m7.4 16/16, m7.4's preview observer 7/7, m8.1–m8.5, m9.1 and
m9.4 all pass. The rest show only the known failures in the test-debt row.

Not run: m6.x (see that row), and the native specs whose Add files and
description selectors were updated (m7.2 and m7.3 native, m5.7 tauri). No
native, provider, OpenMS or Cargo run. One unit test failed once in four runs
and passed alone and in the full suite: App.test's "closes the reading actions
when the backend state is not positively available".

Observed outside the list, not changed: in Details, a long fact label leaves its
value a narrow column. The targeted MS1 engine string wraps to about eight
lines. This is L12's, with PM9.6.

Status: **KNOWN UI/UX REWORK CLOSED — PM9 REPORTED UI/UX ISSUES CLEARED**.
PM9.4 is not started. PM9.1 stays PARTIAL for J1–J6.
