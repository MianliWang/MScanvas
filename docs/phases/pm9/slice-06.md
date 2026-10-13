# PM9.6 — results, history, provenance and explicit continuation

PM9 | Acceptance: U6, U7, U8 (stored), U9, U10 | Depends on: PM9.2, PM9.3, PM9.5 | Serial, one writer
Status: **PM9.6 RESULTS / HISTORY / EXPLICIT CONTINUATION COMPLETE — FOCUSED
BROWSER/RENDERED ACCEPTANCE PASS** (2026-10-13, §13). Production `6c3508a`,
tests `a2a4fea`. Real-engine, filesystem and native release qualification are
unchanged. Expanded 2026-10-05 from the code of the starting point below; the
midpoint check is not repeated, and nothing here unfroze the route.

## 0. Starting point

- HEAD `9def1bf6d53ffc0e175d9a3ddeecbbf367d27c44` (tree
  `4228710baafd36c0a2bd60295abbead24af5b96a`) on
  `feat/pm9-product-convergence`.
  - Clean worktree and index, no stash, no Git operation in progress, one
    worktree.
  - The accepted upstream `57915de` is an ancestor.
  - So are PM9.5's production `f877870d0a69963c18f29715915d6fddaef1c09a` and
    its tests `e02bb1224ef2bfbb31299fdc6b05df6192094cc6` (tree
    `d2bacabbfb05f0a1b503389ea17a86f164943f61`). Only documentation follows
    them.
- **Observation O6** (2026-10-05). It is before-evidence, not RED.
  - What ran: existing stored-result, QC and history states, rendered on this
    unchanged production by a scratch spec over the existing scenarios
    (`.tmp/pm96-observe/pm96-observe.browser.e2e.ts`, git-ignored).
  - How: Chrome 154.0.8037.93, headless, DPR 1, dev port 15279. Admitted at
    7.91 GiB free and 75% used. 10 of 10 cases ran, with no leftover process.
  - Where: frames and `observe.json` are in `.tmp/pm96-observe/out/`, and the
    run's identity is in `.tmp/pm96-observe/run/O6-observe.meta.txt`.
  - The findings below cite its frames and geometry, or the code where no
    frame shows the fault.
- **v5.11 reference.** Re-hashed before use: 490,253 bytes, SHA-256
  `d09b60e0bd3225721ddf87731ec64c0577015952afc05d91290d5461b3896337`, the
  identity in baseline §3. Its markup and script strings were read, not
  rendered (§12).

## 1. Goal

A reader finds a result from where PM9.5 hands it over, or from the saved
history. They then:

- read the targeted MS1 or descriptive QC report in the main region;
- inspect a target's evidence beside the row it belongs to;
- walk to the run and plan that produced it, and back;
- use the outputs that already exist;
- after a reopen, continue only through explicit checks.

Exact identities and scientific caveats stay inspectable without leading the
first view. This is presentation and wiring of existing capability: no new
science, command, persistence or export format.

## 2. Read first

- `brief.md` (U6–U10; locked decisions; not-in-PM9 list), this file.
- `docs/product/M9_2_TARGETED_MS1_RESULT_REUSE.md`: the five states,
  recovery and contracts.
- `M9_CLOSURE.md` §3, and the M8.5 report surface in `M8_1_FIRST_CLOSED_LOOP.md`
  and `SCREEN_MODEL.md`.
- Code, all in `apps/desktop/src/features/project/`:
  - `TargetedMs1.tsx` (`TargetedMs1Report`, `EvidenceFigure`, `RowFacts`,
    `TargetedFacts`) and `QcReport.tsx`;
  - `ProjectPanel.tsx` (report placement, history);
  - `ProvenanceDetails.tsx`, `lineage.ts`, `useProject.ts`;
  - `projectApi.ts` and `project.css`.
- Rust (read-only semantics):
  - `src-tauri/src/project/dto.rs`: availability is observed when the project
    is opened, saved elsewhere or produced, and is never stored;
  - `project/mod.rs`: only file-facts and targeted runs are recorded without
    an artifact;
  - `lib.rs`: the rows and evidence reads refuse `unknownRecord` for a bad
    target, and `payloadMissing` or `payloadCorrupt`.
- Tests:
  - Vitest: `TargetedMs1.test.tsx`, `ProjectPanel.test.tsx`,
    `ProvenanceDetails.test.tsx`, `ProjectQcSummary.test.tsx`;
  - browser: the m8.1, m8.2, m8.5, m9.1, m9.4, PM9.1 and PM9.5 specs;
  - support: `e2e/support/pm9Scenarios.ts`, `targeted.ts`, `harness.ts`.

## 3. Owners and action classes

Classes: **P** presentation or local state, **R** existing read or projection,
**W** an explicit operation that writes a file or changes session authority.

| Fact or action | Owner | Class |
| --- | --- | --- |
| Open project and its identity | `useProject` `state.projectId`; `replacements` counts New, Open and Close, and clears the inspection | R |
| The inspected object and its lineage | `useProject` `inspecting` → `provenanceOf` (`lineage.ts`): lookups by identifier, no IPC | P |
| The report in the main region | `ProjectPanel`: `TargetedMs1Report` keyed by artifact id; `QcReport` for a snapshot | P |
| Stored rows | `read_targeted_ms1_rows(artifactId, 0)`, once per mounted report; at most 500 rows, plans hold at most 200 targets, in plan order | R |
| One target's evidence | `read_targeted_ms1_evidence(artifactId, targetId)`, kept under `${artifact}/${target}` with a live flag | R |
| Its drawing | `preview_targeted_ms1_figure(artifactId, targetId, settings)`; `EvidenceFigure` keyed by target, size and theme | R |
| Whether new runs could start | `get_targeted_ms1_runtime()` on mount and when the run count changes; said only | R |
| Payload state | the project's `availability`, as observed at open, save-elsewhere or production; a read finding `payloadMissing`/`payloadCorrupt` overrides it for that report (`found`, report-local) | R |
| Source state | `input.verification` from the last check; the consumed content is recorded on the run and never replaced by a later observation | R |
| QC snapshot | `artifact.qcSnapshot`, recorded values only | R |
| Exports | `export_targeted_ms1_table(artifactId, format)`, `export_targeted_ms1_figure(artifactId, targetId, format, settings)`. The native dialog is Rust's; one output at a time per report and in Rust's lane; nothing in the project changes | W |
| Check, Locate, Confirm, Abandon, Add to Workbench | `check_project_links`, `propose/commit/abandon_project_relink`, `add_project_input_to_workspace`, each only on its own press | W |
| Surface navigation | `PreviewWorkspace` keeps the Project surface mounted while hidden (`PreviewWorkspace.tsx:830`) | P |

## 4. Findings and acceptance

A finite list, frozen before implementation, in four classes:

- **REQUIRED** rows are fixed and checked directly before closure;
- **VERIFIED** rows were checked and are not defects;
- **OPTIONAL** rows carry an owner and a decision point;
- **FUTURE/EXTERNAL** rows belong to another capability or owner.

L12 is not revived: UI-25 closed it (baseline §12).

### REQUIRED

| ID | Area | Criterion | Grounding (O6 or code) | Owning code | Evidence |
| --- | --- | --- | --- | --- | --- |
| R1 | A | The outcome summary is one compact line, not a seven-row table. All seven counts stay, zeros included, each word beside its count, in the existing order, with the `data-targeted-count` hooks | O6 `en-1366-01`: the table is 211 px tall and pushes the target rows to y 682 of a 752 px viewport; at 960×640, 553 of 624 | `TargetedMs1Report`, `project.css` | Vitest (counts and order); P11 frames |
| R2 | B | The table and its evidence read as one task. **Order:** the meaning note, then the table's export, then the rows, then the chosen target's panel. **Reveal:** a press on a row arms a reveal. It runs when that panel reaches a terminal state (image inserted, evidence or drawing refused, or a row without points), and only while focus is still on that row's control. It moves only `#workbench-project`. **Frozen geometry:** after the reveal the chosen row lies fully inside the surface's visible box. The plot image lies fully inside it too wherever the row allows. Otherwise the row sits at the top edge, giving the plot all the room the row allows. The rows scroller's own `scrollTop` does not change, and focus stays on the pressed control. **Fit required:** both rows of the two-target result at 960×640, 1366×768 and 1920×1080 in en and zh-CN, and the 200th row of a 200-target result at 960×640 and 1366×768 in both languages. A plot already in full view does not move | O6 `en-1366-02`: after choosing, the panel's top is at 934 against 752; at 960×640, 806 against 624; at 1920×1080 only 68 px of the plot shows (top 996, viewport bottom 1064) | `TargetedMs1Report`, `EvidenceFigure` (settled signal), `project.css` | P1, P6, P11 (geometry from DOM state, not timers); Vitest (focus and order) |
| R3 | C | Walking from a report to its producing run and back keeps the report, the chosen target, the open disclosures and the figure settings, with no second rows read. The report already on screen stays while the inspected run is the one that produced it. Any other selection replaces or removes it, and inspecting a run never opens a report that was not already shown | Code: `ProjectPanel.tsx:505-514` builds the report only while an artifact is inspected, and it is keyed by artifact id (794). So a walk to the run unmounts it. The return remounts it, reads the rows again (`TargetedMs1.tsx:1674-1691`) and starts the chosen target and figure settings over (1615, 1621). QC has the same shape (417-425) | `ProjectPanel` (render-time state, the `replacements` pattern) | Vitest (read count, target kept, unrelated selection removes it); P1, P2 |
| R4 | A, C | History and Details say what each targeted attempt left. A targeted run without a result says "No result was stored." instead of "No file-facts record was produced." A failed one also gives its failure sentence in its history row. The history note covers targeted runs and says opening a record runs nothing. File-facts runs keep their sentence, and both `no-artifact` hooks stay | O6 `batch-00-history`: the failed targeted run reads "No file-facts record was produced." with no reason. `batch-01`: pressing it changes nothing in view at 1366×768 (Details folded, the hint scrolled away). The note says the recorded work neither "converts, analyses or judges quality" beside runs that analyse. Code: `ProvenanceDetails.tsx:325` shows the same sentence | `ProjectPanel` history, `ProvenanceDetails`, bundles | Vitest; P10 |
| R5 | C, D | A history record whose stored payload the project found missing or damaged says so beside it, in the report's state words. The state is the project's last look; a later read's finding stays in its report (§11) | Code: the history row shows only the outcome counts (`ProjectPanel.tsx:1375-1391`). A record that opens to "Missing" or "Damaged" reads like a whole one until it is opened | `ProjectPanel` history | Vitest; P5, P10 |
| R6 | D | A damaged payload's sentence gives its truthful next step, as the missing one does. The record and its digests are kept: put back an intact copy of the results folder, if there is one, then open the project again. Text only; no Repair or Regenerate control | O6 `resultPayloadCorrupt-01`: "…do not match the digests the project records, so they are not shown." and nothing more. Rust observes availability again on open (`dto.rs`) | bundles | Vitest (copy); P5 |

### VERIFIED NO DEFECT

| ID | Checked | Result |
| --- | --- | --- |
| V1 | Report identity and first view | Title, source name, recorded time, the experimental note and the three state facts. No digest, path or identifier in the main region; digests are in Details. O6 `*-01-report`, en and zh-CN, three widths |
| V2 | QC report | Recorded values in three small tables, "Not reported" never zero, no grade, colour or export; `QcReport` reads props only, so opening sends nothing. O6 `qc-01-report`; PM9.1 B5 |
| V3 | Identity separation | Report keyed by artifact; evidence by artifact and target with live flags; drawing by target, size and theme; output status by region and target; every command takes identifiers. Shown by P3 |
| V4 | Granular refusals | An evidence or drawing refusal stays in that target's panel; only `payloadMissing`/`payloadCorrupt` withdraw rows and outputs (the M9.2 contract, `noteRefusal`). Shown by P5 |
| V5 | No source, no runtime | Rows, evidence, drawing and both exports work with the source unavailable and no runtime; nothing reads the source. O6 `resultSourceAndRuntimeUnavailable-01`; shown by P4 |
| V6 | The five states | Whole, missing, damaged, source unavailable and runtime unavailable read differently. O6 frames |
| V7 | Capability map | Targeted: table CSV/TSV and figure SVG/PNG. QC: none. No clipboard (M9.2 known limits). Unchanged; shown by P7 |
| V8 | Order and paging | One page in plan order; no sort, filter or paging exists to preserve; a table export is always the whole table |
| V9 | Opening is not execution | Opening a record sends only reads: no plan clone, run, capture, check or dirty state. Shown by P1, P2, P4 |
| V10 | Reopen and continuation | Reopen shows history; check, Locate, Confirm, Abandon and Add to Workbench happen only on their own press; an abandoned or refused relink leaves the state as it was (m8.1's relink case; code). Shown by P8 |
| V11 | Navigation | The Project surface stays mounted while hidden, so a report and its chosen target survive a surface switch with no new read; a replaced project clears the inspection. Shown by P9 |
| V12 | Repeated runs | Each run and record control is named by its finish time (`inspectRunName`, `inspectRecordName`), so two runs of one plan have distinct names and open their own reports. Shown by P10 |
| V13 | Export controls | During an export the other buttons are held, the pressed one says "Exporting…" and the status line names the format; an invalid setting is said beside its field. Unchanged |
| V14 | Re-attribution | A result whose source was re-attributed is refused `payloadCorrupt` in Rust (the PR #127 counterexample, historical, not rerun); the report's withdrawal on that refusal is V4 |

### OPTIONAL

- **O1.** Opening a record from history brings its report into view while focus
  stays on the history control. This is M8.5's recorded model, pinned by
  `ProjectQcSummary.test.tsx`, which keeps the keyboard where the reader put it.
  PM9.5's **Open result** moves focus to the heading. Whether history should do
  the same is a keyboard-model decision for the owner at PM9.7's integrated
  journey review (J5). The report is reachable by Shift+Tab, and no task is
  blocked.
- **O2.** The selected target's heading names the target and formula. Its
  outcome is in the row beside it and in the figure's text alternative, not in
  the heading.
- **O3.** Added by the focused review. The reveal's guard is the keyboard
  alone. A reader who wheels the surface during the read, with focus still on
  the row, is brought back to the row. The read is local and fast, and R2
  freezes the keyboard guard. Owner: the PM9.7 integrated journey review.
- **O4.** Added by the focused review. An evidence read refused
  `unknownRecord` is said in the project's general sentence, which names a
  reference. Rust answers it only for a target the stored result does not
  have, and the stored rows and the evidence come from one validated payload,
  so no press can reach it. Owner: the M9.2 refusal wording, if a reachable
  path ever appears.

### FUTURE/EXTERNAL

- **F1.** Parameter bounds (PM9.5 F1). Rust owns them, and no review
  projection carries them; not pulled in.
- **F2.** Sorting, filtering or paging the target table, view-scoped export, a
  stored-result clipboard, PNG metadata, spreadsheet-formula neutralization:
  new capability, excluded.
- **F3.** History deletion, notes, automatic relink, reopen restoring the
  Workbench, re-running to replace a damaged result: excluded.
- **F4.** Real file reopening, payload copies, native dialogs, engine runs and
  native DPI: release qualification, not browser evidence.

## 5. Acceptance in three layers

- **True (observable):** R1–R6 in the rendered app at the anchors, in both
  languages; V3–V5, V9–V12 shown by P1–P10.
- **Exists:**
  - the compact summary and the reordered report;
  - the armed reveal and `EvidenceFigure`'s settled signal;
  - the retained report;
  - the history row's failure line, no-result sentence and payload state;
  - `projectRunNoResult` in both bundles, with the two changed values;
  - the PM9.6 browser spec.
- **Wired:**
  - opening a record sends only reads: rows once, the runtime fact, evidence
    and drawing per chosen target;
  - walking to the producing run and back sends nothing;
  - each export sends its own artifact, target, format and settings;
  - reopen sends nothing until check, Locate, Confirm or Abandon is pressed.

## 6. File closure

- **Production:**
  - `apps/desktop/src/features/project/TargetedMs1.tsx`, `ProjectPanel.tsx`,
    `ProvenanceDetails.tsx`, `project.css`;
  - `apps/desktop/src/features/preferences/locales/en.ts`, `zh-CN.ts`
    (`i18n.ts` only if a parameterized key is added).
- **Tests:**
  - Vitest: `TargetedMs1.test.tsx`, `ProjectPanel.test.tsx`,
    `ProvenanceDetails.test.tsx` and `ProjectQcSummary.test.tsx`, where they
    cover changed behaviour;
  - new `e2e/specs/pm9.6-results-history.browser.e2e.ts`;
  - `e2e/support/targeted.ts` gains a stored-rows builder for many targets,
    leaving existing exports unchanged.
- **Documents:**
  - this file, `slices.md`, the baseline (§16) and the brief's status;
  - `e2e/README.md` (the manual review path);
  - dated notes in `docs/product/M9_2_TARGETED_MS1_RESULT_REUSE.md`,
    `SCREEN_MODEL.md` and `PRIMARY_WORKFLOWS.md`.

No Rust, DTO, IPC, schema, persistence, dependency, lock, workflow, runtime or
provider path. No manual scenario is added: the existing ones reach every
report (§8).

## 7. Not in this slice

- No new command, projection, format, score, threshold, comparison, XIC,
  normalization, preset, persistent selection, automatic restore, admission,
  relink or re-execution, history deletion or store compaction.
- No change to the figure renderer, figure settings, export policy, QC
  snapshot or the targeted contract.
- Not reopened: PM9.5, the 42-row rework, the midpoint, PR #127.

## 8. Manual entry

`pnpm qa:pm9:manual` from the repository root, with
`MSCANVAS_PM9_MANUAL_SCENARIO` set as below. Locale and viewport are set as
`e2e/README.md` describes, and `MSCANVAS_BROWSER_DEV_PORT` is needed only if
5273 is taken.

| Scenario | Navigation |
| --- | --- |
| `projectWithResult` | Project → in Recorded work, **Targeted MS1 result** → the report; choose **Caffeine** → its evidence; **Show Details** → the run under "Produced by" → the result under "Produced" (the report stays) |
| `resultPayloadMissing`, `resultPayloadCorrupt` | Project → the history row's state, then the record → the report's state line and sentence |
| `resultSourceAndRuntimeUnavailable` | as `projectWithResult`, then **Export CSV…** / **Export SVG…** (fixed answers) |
| `qcCapture` | Workbench → open **QC_pool_01.mzML**'s preview → Project → **Capture QC summary** on its layer → the report; then in Recorded work, its run, then the snapshot |
| `targetedTask` | Project → **Targeted MS1…** on a layer → tick all three → type targets → **Review plan** → **Run 3 analyses** → history: completed, failed with its reason, all not detected |

The exact PowerShell lines go into `e2e/README.md` with this slice's record.

## 9. Tests

**Vitest.** New or changed cases for:

- R1: counts in order, zeros kept;
- R2: DOM order, and focus staying on a pressed row once its evidence arrives;
- R3: the walk to the run and back with one rows read and the target kept;
  an unrelated selection removing the report; the same for a QC snapshot;
- R4: history and Details wording, the failure line, file-facts unchanged;
- R5: the history state word;
- R6: the damaged sentence.

jsdom has no layout, so the reveal's geometry is browser evidence only.

**PM9.6 browser spec** (`pm9.6-results-history.browser.e2e.ts`).

- Real React over Vite in Chrome, with only the IPC boundary replaced; unknown
  commands reject.
- Answers come from `pm9Scenarios.ts` and `targeted.ts`, plus spec-local
  project variants for P3, P6, P8 and P10.
- No rejection is put on a held command. A release answers every parked
  caller with the table's answer at that time.
- "No work" means no `begin_project_job`, `run_*`, `resolve_*`,
  `cancel_project_job`, `capture_*`, `check_project_links`, `*_relink`,
  `add_project_input_to_workspace`, `save_*`, `create_project`,
  `open_project` or `close_project` that a press did not ask for. Rows,
  evidence, drawing and runtime reads are read-only.

| Case | Path | Asserts |
| --- | --- | --- |
| P1 | 1: handoff → report → run → back, 1366×768 en | Review, Run and **Open result** open that artifact's report, with focus on its heading. Choosing a target reveals its evidence (R2). **Show Details** → "Produced by" → the run, with the report, chosen target and settings kept (R3) → "Produced" → the record. Rows read once; after Open result, no work |
| P2 | 2: QC history → snapshot report → its run, en and zh-CN | Report values as recorded, no grade words, no capture or job command. Its run keeps the report (R3); Details shows the run, layer and source |
| P3 | 3: two results with one label and shared target ids | A drawing held for A's Caffeine is released after B opens: B shows no selection and no figure. B's Caffeine draws with B's outcome in its text. B's exports carry B's artifact. A held table export of B, released after switching to A, leaves no status in A. Details follows the inspected result's run and plan |
| P4 | 4: source and runtime unavailable | State facts said; rows, evidence, drawing, a CSV and an SVG export all answered; no work |
| P5 | 5: missing, damaged, and failed evidence reads | Missing and damaged: no rows read, no outputs, the sentences (R6), the history state (R5). A drawing refused for one target (`targeted_figure_not_drawable`), then an evidence read refused `unknownRecord`: each said in that target's panel, the row and the refusal in view; the rows, the table export and the whole payload state stay; the other target draws. `payloadCorrupt` on an evidence read: rows and outputs withdrawn, the state line says Damaged, focus not dropped to `body` |
| P6 | 6: a 200-target result at 960×640 and 1366×768, en and zh-CN | The 200th row reached by a real wheel over the rows scroller with the surface still, and by Shift+Tab from the control after the report. Pressed: the R2 geometry. Settling is read from DOM state |
| P7 | 7: exports | CSV saved, TSV cancelled and SVG refused, each said in its own region for the requested format and target; exact arguments; PNG saved with its size and DPI |
| P8 | 8: close and reopen | Close, then Open through the header: history and the report readable, the source "Not checked", no check, relink or admission sent. **Check linked files** sends only its job; the report's source line follows it, and the run's recorded content is unchanged. **Locate…** → Abandon: no commit, the state as before. A Locate the user cancelled changes nothing |
| P9 | 9: navigation and replacement | Workbench and back: the report, chosen target and open disclosure kept, no new read. A draft in the targeted setup survives inspecting a result. Opening another project with a held evidence read outstanding: the old report goes, and the released answer shows nowhere |
| P10 | History states and repeated runs, three widths, en and zh-CN | Completed, failed (with its sentence), cancelled and all-negative runs. "No result was stored."; a missing record's state word. Two runs of one plan named apart, each opening its own report |
| P11 | Rendered anchors | 960×640, 1366×768 and 1920×1080 in en and zh-CN: report first view, chosen target after the reveal, history, QC report. Report and evidence also at 1280×720, 1536×864 and 2560×1440 in en. Missing and damaged at 1366×768. Reduced motion emulated once: the reveal is the same instant scroll |
| P12 | R2's guard, added by the focused review, 1366×768 en | Focus moved on before the drawing arrives: the surface does not move. The same row pressed again with its drawing in place: the R2 geometry. Row and drawing both in view, the drawing's end within 8 px of the bottom: a press moves nothing |
| P12b | R2's end state for a row without points, added by the focused review | Its note comes into view beside the row, with no evidence read |

Every frame records the candidate, Chrome, the CSS and outer viewport, DPR,
the page language, the roster and Details state, overflow, the surface's
scroll position and focus. The console ledger must be empty.

## 10. Validation groups (frozen before any run)

**Admission.** Each heavy group needs at least 6 GiB free and at most 85%
used. Inside a group, no further heavy command runs below 4 GiB free or at
90% used or more. A refused group is not renamed and is not waited on.

**How groups run.**

- Each runs serially in the foreground, with one browser session at a time.
- Each browser group gets its own unused dev port, from 15280 up.
- Vitest runs as `pnpm exec vitest run --maxWorkers=1 --no-file-parallelism
  <files>` from `apps/desktop`.

| Group | Content | When |
| --- | --- | --- |
| S0 | `pnpm e2e:typecheck` | After the test-only commit |
| G0 | PM9.6 spec on unchanged production, RED at each case's first finding. Optional: if refused, O6 stands as the before evidence | Before production changes |
| D… | Affected Vitest files and the PM9.6 spec, named as run; not qualification | During implementation |
| S1 | `pnpm typecheck` (`pnpm lint` is the same `tsc -b --pretty false`), `pnpm e2e:typecheck` | Final candidate |
| V1 | `TargetedMs1.test.tsx`, `TargetedMs1Batch.test.tsx`, `ProjectPanel.test.tsx`, `ProvenanceDetails.test.tsx`, `ProjectQcSummary.test.tsx` | Final candidate |
| U1 | Full Vitest, bounded workers | Final candidate |
| B0 | `pnpm build` | Final candidate |
| G1 | PM9.6 spec | Final candidate |
| G2 | PM9.5 spec (the handoff) | Final candidate |
| G3 | m9.1, m9.4 (report, evidence, exports, batch results) | Final candidate |
| G4 | m8.5, m8.1, m8.2 (QC report, history rows, `no-artifact` hooks, Details) | Final candidate |
| G5 | PM9.1 whole (scenarios, reports, history) | Final candidate |
| — | `python scripts/check_repo.py`, `git diff --check`, scoped comparison of Rust, IPC, schema, manifests, lock and workflows | Final candidate, light |

**Not rerun, by dependency:**

- **m8.3 and m8.4.** They read runs only by `data-outcome` and artifact id,
  inspect only references and layers, and measure nothing below the history
  note.
- **pm9.3 and pm9.4.** No viewer or conversion input changes. pm9.4's P4
  passes through the Project surface, but asserts only the IPC ledger and the
  conversion state.
- **Viewer and export consumers.** `FigureSettingsFields`, the figure model
  and `.qc-report-table` are untouched.
- **The legacy M4–M7 corpus.**

## 11. Evidence boundaries

- **What the browser proves.** It is the real frontend over a controlled IPC
  boundary. It proves command and interface wiring.
- **What it does not prove.** Real file reopening, payload copies or
  integrity, a native dialog or its cancellation, engine runs, native
  WebView2 at 150% and screen-reader output.
- **What is not rerun.** Rust's payload, Save As and re-attribution tests are
  historical backend evidence.
- **History's payload state is the project's last look.** It reflects the
  last open, save-elsewhere or production. A read in this session that finds
  a payload missing or damaged changes that report, not the history row,
  until the project is opened again.

## 12. v5.11 comparison (read, not rendered)

The reference has no Project surface. Its results live in a processing
workflow's "results" and "export and records" pages over synthetic data; none
of its science was taken.

| Aspect | v5.11 | Before (O6) | Planned | Disposition |
| --- | --- | --- | --- | --- |
| Result entry | "View results" / "View records" after a run | PM9.5's Open result and Show run; history links | Unchanged | Already adopted (PM9.5) |
| Table and evidence | A feature table whose selected row links its evidence ("one feature, linked chromatogram … and MS/MS evidence; a candidate is not an identification") | Evidence about a screen below its row | Evidence revealed beside its row (R2) | Adopted in substance |
| Sorting and filtering | Column sort and evidence-tag filters, "filtering and sorting change only the display" | Plan order | Unchanged | Not adopted: the targeted contract has none (F2) |
| Export scope | "Export current N rows" | The whole table; one target's figure | Unchanged | View-scoped export not adopted (F2) |
| Records | A record page: method snapshot, notes, export of the snapshot | History plus Details | History says how each attempt ended (R4, R5) | History adopted; notes and snapshot export not (F3) |
| Not found | "Not found means no evidence was established" | `targetedMeaning` says the same, after the table | Before the table (R2) | Kept |
| Reopen and relink | Listed by the demo as missing | Explicit check, Locate, Confirm | Unchanged | No counterpart |

## 13. Record

**2026-10-05, checkpoint 1.** Implemented, reviewed and corrected once. The
frozen qualification groups (§10) have not run: the first was refused at the
memory gate.

**Identities.**

| What | Commit | Tree |
| --- | --- | --- |
| Start | `9def1bf6d53ffc0e175d9a3ddeecbbf367d27c44` | `4228710baafd36c0a2bd60295abbead24af5b96a` |
| Expansion (this file) | `798009d7cbc7b210f68ac08c18012052ff173b98` | `0fe68954f229745b5fc78b419f17c341b9fe2130` |
| PM9.6 spec, test only | `a697cc9a08771b74fa4ed7f0a6c878aee0fa5143` | `343cdac0899ebbb0e06d8569e45d6c02afc5ebb2` |
| Spec, test-authoring fixes after G0 | `5107c8c7e6adb1e7ee333fa89051c121e52098a5` | `cbde43c426f03edbcf348c0931fca999249f7150` |
| Production R1–R6 | `157ded3feecb0bc06580967072f204499f6813a9` | `3c7648052d811db8432658e9ce8e390e03f41197` |
| Tests R1–R6 | `2f1719e67775c2fa8ec0ebad85e950311d55cd23` | `fc2ebeeeb18c965caef0641174a38b61c26d63ef` |
| Correction cycle 1, production | `6c3508a1b984491504dd20013125b5cb67ce8ab2` | `804c594318d6dcf792035059b5659ad2b81104f9` |
| Correction cycle 1, tests | `a2a4feab15ec298ce8974b77caedd5f6a2ada311` | `147de2966256e28e1f3fa2a38ff50f4080a5b8a0` |
| Documentation, the stable candidate | `782bac4254881fc2a99af3190c22869ba7b7b781` | `0f3dbbc643e7ccfba58d77e14f2475378305a0bd` |

Between `a2a4fea` and `782bac4` only documents changed (`e2e/README.md` is one
of them), so the candidate's code is production `6c3508a` and tests `a2a4fea`.

**What ran, and on what.** Chrome 154.0.8037.93 headless at DPR 1 for every
browser run. Each run went through the scratch runner, with its own memory
reading, its own dev port and zero leftover processes.

| Run | On | Admitted at | Result |
| --- | --- | --- | --- |
| O6 observation | `9def1bf` | 7.91 GiB free, 75% used | 10 of 10 frames; the before evidence (§0) |
| S0 `pnpm e2e:typecheck` | `a697cc9` | 7.25 GiB, 77.1% | exit 0 |
| G0 PM9.6 spec, unchanged production | `a697cc9` | 7.39 GiB, 76.7% | 4 of 30 passing (below) |
| D0 probe (scratch, not kept) | `a697cc9` | 6.96 GiB, 78% | the dev server mounts under StrictMode: every mount effect runs twice |
| D1 `pnpm typecheck`; five affected Vitest files | working tree = `157ded3` + `2f1719e`'s tests | 6.37 GiB, 79.9%; 6.39 GiB, 79.8% | exit 0; 138 of 138 |
| D2 PM9.6 spec | the same | 6.67 GiB, 78.9% | 25 of 30; five test-authoring failures (below) |
| D3 PM9.6 spec | working tree equal to `2f1719e`'s content | 7.51 GiB, 76.3% | 30 of 30 |
| D4-red P12 and P12b | `157ded3`'s `TargetedMs1.tsx` with `a2a4fea`'s spec | 6.72 GiB, 78.8% | P12 RED at its last step: a view already whole moved 4 px (504 → 508); P12b passed |
| D5 both typechecks; five affected Vitest files | working tree equal to `a2a4fea`'s content | 7.04 GiB, 77.8%; 7.05 GiB, 77.8% | exit 0; 137 of 137 |

The D runs are development evidence, not qualification.

**G0 on unchanged production.**

- **RED where the R items said.** Each case below failed at its first finding:

  | Cases | First finding |
  | --- | --- |
  | P1, P4, P6 (four), P11 reduced motion | R2: the chosen target's plot not in view |
  | P2 (two), P1b | R3: the report replaced when its run was inspected |
  | P5 | R5: no payload state in the history |
  | P10 (six) | R4: no failure line |
  | P11 anchors (six) | R1 and R2: the summary and the order |
  | P11 at 1536×864 | the row only partly in view after a focus scroll |

- **Passed as their V items predicted:** P8 (reopen) and P9 (navigation and
  replacement). P11 at 1280×720 and 2560×1440 asserted only the row.
- **P3 and P7 failed on test-authoring faults, fixed in `5107c8c`:**
  - StrictMode runs a mount's reads twice, so the walks are now measured by
    what they issue, and a held drawing waits for at least one parked caller;
  - P7's refusal now carries the boundary's `summary`.

**Test-authoring fixes** (outside the correction-cycle count):

- `5107c8c`, the two G0 faults above;
- in `2f1719e`, after D2: Shift+Tab sent as m7.1 sends it, and motion's
  reduced-motion development notice allowed only in the case that asks for
  reduced motion, as PM9.1 does.

**Focused review.** One read-only reviewer. It ran nothing.

- **No BLOCKER.**
- **SHOULD-FIX 1, a product defect, taken as correction cycle 1 (`6c3508a`).**
  The reveal judged visibility against a box shrunk by its 8 px margin, so it
  moved a view that already showed the row and the drawing.
- **SHOULD-FIX 2, coverage, closed in cycle 1's tests (`a2a4fea`).**
  - The reveal's guard, its second-press path and its no-points end state had
    no test; they now have P12 and P12b.
  - P5 now also refuses an evidence read `unknownRecord`, as §9 said.
  - A component case that could not fail is removed.
- **NITs:**
  - a dead CSS selector half, dropped;
  - "Damaged" covers more causes than a digest mismatch, now a known limit in
    the M9.2 record;
  - the reveal's guard is focus-only, recorded as O3.
- **One cycle of the two authorized.**

**Rendered evidence so far** (git-ignored; development, not qualification):

- before: `.tmp/pm96-observe/out/`;
- after: `.tmp/pm96-runs/D3/browser-sC2Nyu/`, 56 frames from the 30-of-30
  run, each with the candidate, viewport, DPR, language, panels, surface
  scroll and focus.

Compared with O6 at 1366×768 (en):

- The summary went from 211 px to one 18 px line.
- The first target row is now on the first screen.
- After a choice, the plot sits within the visible bottom (plot bottom 744
  against 752), with the row in view, where O6 had the panel's top at 934.
- History names the failure and "No result was stored."
- No horizontal overflow at any anchor. The frames of the final candidate are
  G1's, pending.

**Resources.** The S1 group was refused at admission at 01:11:45: 3.2 GiB free
and 89.9% used. A single reading at 01:12:11 for the light checks gave
3.33 GiB and 89.5%. No process of this slice was running: every group had
reported zero leftovers, and the reviewer had finished. Nothing else was
touched. Nothing waits for memory, and nothing is relaunched by itself.

**Done on the candidate, light.**

- `git diff --check 9def1bf 782bac4` is clean.
- **Scope.** The range changes only:
  - `apps/desktop/src/features/project/` (four production files, two test files);
  - the two locale bundles;
  - `e2e/specs/pm9.6-results-history.browser.e2e.ts`, `e2e/support/targeted.ts`
    and `e2e/README.md`;
  - documents.

  No Rust, IPC or DTO (`projectApi.ts` unchanged), schema, manifest, lock or
  workflow file.
- `python scripts/check_repo.py` was deferred with the heavy groups. It is
  light, but the machine was at the 90% line.

**Remaining, in this order.** Each is admitted on its own reading: at least
6 GiB free and at most 85% used. A browser group gets a fresh port.

1. S1, from the repository root: `pnpm typecheck` (`pnpm lint` is the same
   `tsc -b --pretty false`), then `pnpm e2e:typecheck`.
2. V1, from `apps/desktop`: `pnpm exec vitest run --maxWorkers=1
   --no-file-parallelism` with `TargetedMs1.test.tsx`,
   `TargetedMs1Batch.test.tsx`, `ProjectPanel.test.tsx`,
   `ProvenanceDetails.test.tsx` and `ProjectQcSummary.test.tsx` (under
   `src/features/project/`). Then U1, the same command over the whole suite.
3. B0: `pnpm build`.
4. G1, the PM9.6 spec, port 15286. It includes P12, cycle 1's exact failed
   scenario, on the fix.
5. G2, the PM9.5 spec, port 15287.
6. G3, m9.1 and m9.4, port 15288.
7. G4, m8.5, m8.1 and m8.2, port 15289.
8. G5, PM9.1 whole, port 15290.
9. `python scripts/check_repo.py`; then this record's closure, `slices.md`,
   the baseline (§16) and the brief.

**2026-10-13, checkpoint 2 (qualification).** Closed: every frozen group of
checkpoint 1's remaining list ran on the final candidate and passed.

**Candidate.** HEAD `5fd09b8f96da7231644c3268bc2e7f0ed3560266` (tree
`ce66cc5b6b443291a52fd894d457913b741dbe2a`), clean. Between `a2a4fea` and it
only documents changed, so the code under test is production `6c3508a` and
tests `a2a4fea`.

**The memory gate, waived once.** On 2026-10-13 the owner authorized, once,
running the remaining tests regardless of memory. The runner still read
memory before each group and recorded the waiver; it refused nothing. Several
groups started below the admission line (lowest: 4.64 GiB free; highest:
85.4% used). The S1 refused on 2026-10-05 stays refused; the S1 below is a new
run.

**The browser driver.** Chrome 155 was staged on the host but not active, and
the running Chrome was 154.0.8037.98. For G1, WebdriverIO resolved and
downloaded ChromeDriver 155.0.8059.40, and no session was created: G1 ran
nothing and is recorded as not run. From G1b on, `CHROMEDRIVER_PATH` named the
ChromeDriver 154.0.8037.93 already cached on the host. No repository file,
browser or package was changed for this.

| Group | Started at | Result |
| --- | --- | --- |
| S1 `pnpm typecheck` (`pnpm lint` is the same `tsc -b --pretty false`), `pnpm e2e:typecheck` | 5.97 GiB free, 81.2% used | exit 0 |
| V1, the five affected Vitest files | 6.03 GiB, 81% | 137 of 137 |
| U1, full Vitest at bounded workers | 6.06 GiB, 80.9% | 112 files, 2260 tests |
| B0 `pnpm build` | 5.32 GiB, 83.2% | exit 0; the existing chunk-size warning |
| G1, PM9.6 spec, port 15286 | 5.0 GiB, 84.2% | not run: no session (above) |
| G1b, PM9.6 spec, port 15291 | 4.64 GiB, 85.4% | 32 of 32 |
| G2, PM9.5 spec, port 15287 | 5.94 GiB, 81.2% | 10 of 10 |
| G3, m9.1 and m9.4, port 15288 | 5.66 GiB, 82.1% | 12 of 12; 5 of 5 |
| G4, m8.5, m8.1 and m8.2, port 15289 | 4.75 GiB, 85% | 3 of 3; 8 of 8; 4 of 4 |
| G5, PM9.1, port 15290 | 5.56 GiB, 82.4% | 55 of 55 |
| `python scripts/check_repo.py` | 5.2 GiB, 83.6% | passed |

Every browser group ran Chrome 154.0.8037.98, headless, at DPR 1.

**Correction cycle 1, closed.** P12, the review's scenario, was RED on
`157ded3` (D4-red: a view already whole moved 4 px) and passed on the fix in
G1b, with P12b and P5's refused evidence read. One of the two authorized
cycles was used.

**Findings.**

- **R1–R6: FIXED AND RENDER-VERIFIED** on the candidate, by G1b and the
  component cases, in en and zh-CN at the anchors.
- **V1–V14:** no defect. V9–V12 are shown by P1, P2, P4 and P8–P10. V14's
  Rust case is historical and not rerun.
- **O1–O4:** optional, each with its owner (§4).
- **F1–F4:** another capability or owner (§4).
- **L12:** not revived (UI-25).

**Rendered evidence** (`.tmp/pm96-runs/Q2/G1b/browser-uWhslV/`, git-ignored).

- **Frames.** 59, each with the candidate (`5fd09b8`), Chrome, the CSS and
  outer viewport, DPR, the page language, the roster and Details state, the
  surface's scroll position, focus and overflow.
- **Coverage.**
  - At 960×640, 1366×768 and 1920×1080 in en and zh-CN: the report's first
    view, the chosen target after the reveal, the history and the QC report.
  - At 1280×720, 1536×864 and 2560×1440 in en: the report and its evidence.
  - Missing, damaged, refused and reopened states, outputs and replacement
    at 1366×768.
  - The 200th target at 960×640 and 1366×768 in both languages.
  - Reduced motion, once.
- **Observed.**
  - No horizontal overflow in any frame.
  - The console ledger is empty but for motion's reduced-motion development
    notice, in the one case that asks for reduced motion.
  - No framework overlay is in the frames. There is no dedicated overlay
    assertion.

**Before and after.** O6 was rendered on `9def1bf` with Chrome 154.0.8037.93;
G1b on `5fd09b8` with Chrome 154.0.8037.98. Both were headless at DPR 1, with
Details folded at 1366×768.

| State | O6 frame | G1b frame | Change |
| --- | --- | --- | --- |
| Report, first view, 1366×768 en | `en-1366-01-report` | `p11-report-en-1366x768` | the summary from a 211 px table to one 18 px line; the first target row on the first screen |
| A chosen target, 1366×768 en | `en-1366-02-chosen` | `p11-evidence-en-1366x768` | the panel's top at 934 against a 752 bottom; now the row in view and the plot at 359–744 |
| A chosen target, 960×640 en | `en-960-02-chosen` | `p11-evidence-en-960x640` | the panel's top at 806 against 624; now the plot's bottom at 616 |
| History, 1366×768 en | `batch-00-history` | `p10-history-en-1366x768` | "No file-facts record was produced." for a failed targeted run; now its failure sentence and "No result was stored." |
| Damaged payload, 1366×768 en | `resultPayloadCorrupt-01-report` | `p5-payloadCorrupt-en-1366x768` | the sentence now gives the next step, and the history names the state |

**Process custody, checkpoint 2.**

- Every group was launched by the scratchpad runner. It recorded each
  process's PID, creation time, command and parent, and every launched tree
  had zero leftovers.
- Each browser group had its own unused dev port.
- Nothing was killed by name or port. WSL, Examsoft and the user's Chrome
  were not touched.
- Local high-memory work ended with the last group.

**Remaining, outside this slice.**

- PM9.1's historical J1–J6, on `d56b17b`, before PM9.7: the checklist is
  [slice-01](slice-01.md) pending item 4, with baseline §10's row and §7.4's
  before capture.
- PM9.7.
- Native rendering at the host's scaling, and real engine, filesystem and
  dialog qualification.
