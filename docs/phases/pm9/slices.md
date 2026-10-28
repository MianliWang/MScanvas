# PM9 slice route

Ordering: establish the real populated states and ownership first, then thicken
the product along the user's path. Risk-first alone keeps user-visible
improvement away for too long; page-value-first duplicates state models and is
reworked at integration. One writer, strictly serial; no parallel batches.
Midpoint check: after PM9.3, a scope and existing-evidence check, not an
automatic full test campaign. Each slice is expanded into `slice-NN.md` only
when it starts.

## Unfreeze conditions

- PM9.1 shows the must-do work does not fit seven slices, or the experience
  needs a new persisted model or authority.
- A slice takes more than twice its estimate, or cannot be finished in one
  session and one reviewable change.
- New evidence overturns a correctness or baseline assumption, or the owner
  changes a locked goal.
- The pending-verification backlog blocks reliable expansion of the next slice;
  a short budget is never solved by skipping acceptance.
- The legacy browser-spec repairs that PM9.2–PM9.4 must make for their own
  surfaces do not fit inside those slices ([baseline §2](baseline.md#2-failing-legacy-browser-specs)).

On unfreeze, rerun only the affected scope, decisions, route and roadmap, then
the plan check. Only hard-to-reverse decisions or scope trade-offs go back to
the owner. An expanded but unstarted `slice-NN.md` is void after replanning. No
eighth slice.

## Route

| # | Goal | Acceptance | Depends on | Type |
| --- | --- | --- | --- | --- |
| PM9.1 | Populated production-state fixtures, v5.11 reference deviation baseline, task and ownership map, verification entry points; materialize this plan | Baseline for U1, U9, U10; repeatable scenarios for U2–U8 | Integration baseline (see the gate amendment below); rendering and tests need a validation window | Experimental / must; no production change |
| PM9.2 | Unify shell navigation and Workbench/Project context; improve the existing roster and action hierarchy | U1, U2, U7 (session), U9, U10 | 1 | Must; keep existing owners and selection semantics |
| PM9.3 | Evidence-first presentation of the existing chromatogram, scan and spectrum views and their inspection/export affordances | U3, U8 (viewer), U9, U10 | 2 | Must; no XIC, no new layers; midpoint check after it |
| PM9.4 | Conversion configuration → review → queue → failure recovery → outputs | U4, U8 (conversion), U9, U10 | 2; after 3 | Must; no frontend-generated capability |
| PM9.5 | Targeted-MS1 setup → plan review → single and batch progress to terminal state and result entry | U5, U7 (drafts), U9, U10 | 2; after 4 | Must; no new science or presets |
| PM9.6 | Targeted and descriptive-QC reports, evidence, history, existing exports and explicit continuation after reopen | U6, U7, U8 (stored), U9, U10 | 2, 3, 5 | Must; reuse existing reads, exports and relink |
| PM9.7 | Integrated journey acceptance, regression, reference-deviation disposition and candidate freeze | U1–U10 | 1–6 | Must; not a place for missing core work |

## Current status (2026-09-26, mid-phase normalization)

**PM9.4 CONVERSION JOURNEY COMPLETE — FOCUSED BROWSER/RENDERED ACCEPTANCE PASS** (2026-10-04, production `55d75fb`, tests `7e83ae4`; [slice-04 §10](slice-04.md#10-record)). Real-provider and native release qualification are unchanged. **PM9.5 TARGETED-MS1 JOURNEY COMPLETE — FOCUSED BROWSER/RENDERED ACCEPTANCE PASS** (2026-10-04, production `f877870`, tests `e02bb12`; [slice-05 §12](slice-05.md#12-record)). Real-engine and native release qualification are unchanged. **PM9.6 RESULTS / HISTORY / EXPLICIT CONTINUATION COMPLETE — FOCUSED BROWSER/RENDERED ACCEPTANCE PASS** (2026-10-13, production `6c3508a`, tests `a2a4fea`; [slice-06 §13](slice-06.md#13-record)). Real-engine, filesystem and native release qualification are unchanged. **PM9.1 COMPLETE — BASELINE ESTABLISHED, NOT ACCEPTED** (2026-10-13; J1–J6 measured on `d56b17b` with the draft and viewport legs, [baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4)). **PM9.7 COMPLETE — INTEGRATED BROWSER/RENDERED ACCEPTANCE PASS; CANDIDATE FROZEN** (2026-10-14, production `30b855f`, tests `e94fb16`; [slice-07 §11](slice-07.md#11-record), [baseline §18](baseline.md#18-pm97-the-after-side-the-regression-and-the-frozen-candidate-2026-10-14)). J1–J6 equal the before side on every counted field, and every browser spec in the corpus passes. Native rendering at OS scaling, U4's live-provider check and the real engine stay PENDING or BLOCKED_PROVIDER_HOLD, for the owner's qualification dispatch after PM9. **PM9 IS COMPLETE.**

**PM9 REPORTED UI/UX ISSUES CLEARED — REQUIRED FINAL VALIDATION COMPLETE** (2026-10-04, production candidate `b7b8eeb`, final test content `1a6d887`). The owner accepted UI-34's committed-range wording and the other 41 dispositions. The required runs passed: PM9.1 55/55, m5.7 8/8, the e2e typecheck, and PM9.3-V11/V12 2/2, which sample the pending-band discard and a zh-CN committed m/z line ([baseline §12](baseline.md#12-known-uiux-rework-2026-09-28)). Before that: at the owner's priority, every UI/UX issue recorded and still present on an implemented surface was closed before PM9.4, in a bounded rework under PM9 ([baseline §12](baseline.md#12-known-uiux-rework-2026-09-28)), not an eighth slice. Batch 1 (2026-09-28, `ea85a88`) closed forty of the frozen rows; batch 2 (`5e4c6ac`), on the owner's re-issued dispatch, closed UI-25, UI-34's announcement timing and the long-range coverage gap; a wording continuation (`b7b8eeb`) made UI-34's committed line true while a gesture is in flight; its PM9.1 and m5.7 runs were deferred at the memory gate and passed on 2026-10-04. PM9.2's and PM9.3's closures stay historical. PM9.4 is not started.

One status per slice; the reasons, the residual classification and the
decisions are in [baseline §10](baseline.md#10-mid-phase-normalization-2026-09-26).

| # | Status | Goal / depends on / acceptance owner |
| --- | --- | --- |
| PM9.1 | **COMPLETE — baseline established, not accepted** (2026-10-13; [baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4)) | J1–J6 measured on the pre-PM9 candidate `d56b17b`, with the draft and viewport legs; PM9.7 measures the after side by the same rules |
| PM9.2 | **COMPLETE** | — |
| PM9.3 | **COMPLETE** | — (closed 2026-09-28 on `d98432b`, production `55c30f3`; [slice-03 §0.5](slice-03.md#05-validation-repair-and-closure-2026-09-28)); its legacy residue is PM9.7's (see the log) |
| PM9.4 | **COMPLETE** (2026-10-04; [slice-04](slice-04.md); the midpoint check ran first, [baseline §13](baseline.md#13-midpoint-check-2026-10-04)) | Conversion configuration → review → queue → recovery → outputs / after PM9.3 / PM9.4: U4 (its live-provider check with the external qualification), U8 (conversion), U9, U10 |
| PM9.5 | **COMPLETE** (2026-10-04; [slice-05](slice-05.md)) | Targeted-MS1 setup → plan review → progress → result entry / after PM9.4 / PM9.5: U5, U7 (drafts), U9, U10 |
| PM9.6 | **COMPLETE** (2026-10-13; [slice-06](slice-06.md)) | Reports, evidence, history, exports and explicit continuation (L12 was closed by UI-25) / PM9.2, PM9.3, PM9.5 / PM9.6: U6, U7, U8 (stored), U9, U10 |
| PM9.7 | **COMPLETE** (2026-10-14; [slice-07](slice-07.md#11-record)) | Integrated journeys against PM9.1's J1–J6, regression including PM9.2's surface specs (m7.1, m7.2, m7.4's active-Clear cases, m7.5), final reference-deviation disposition, candidate freeze / PM9.1's remainder and PM9.2–PM9.6 / PM9.7: U1–U10 integrated |

Outside the slices: M7.6-style installed, native, provider and release
qualification of PM9.7's frozen candidate owns native rendering at OS scaling
and every provider-positive check ([ROADMAP](../../../ROADMAP.md), after M9).
The owner placed the real targeted-MS1 engine path there too on 2026-10-13
([slice-07 §9](slice-07.md#9-owner-decisions-at-the-freeze), decision 4).

**Scope ledger.**

- Must do in the remaining PM9: PM9.3–PM9.6 as routed (done); PM9.1's J1–J6 (done 2026-10-13, [baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4)).
- Phase closure (PM9.7, done 2026-10-14, [slice-07](slice-07.md#11-record)): integrated
  journey acceptance against the J1–J6 baseline; regression, with the
  remaining failures of m7.1, m7.2, m7.4's active-Clear cases and m7.5;
  the final reference-deviation disposition and the states §3.1 did not
  capture; the candidate freeze.
- External or blocked: native acceptance at OS scaling; provider-positive
  checks under the ProteoWizard HOLD.
- If time allows: drag and motion details; touch; other non-critical layout
  adjustments. L7 at 1920×1080 and L11 left this list at the freeze: the
  owner kept them as intentional deviations (2026-10-13,
  [slice-07 §9](slice-07.md#9-owner-decisions-at-the-freeze)).
- Out of scope: the brief's list, unchanged (no XIC, multi-layer comparison,
  normalization, new algorithms, schema or persistence change, runtime or
  release packaging, M10).

**Cadence.** One end-to-end prompt per slice: rebind (expand the slice from
the latest facts), implement, review, validate, one bounded repair, docs,
closure. PM9.1's remainder is one measurement prompt of its own.

## Log

| # | Result | Rework? | Notes |
| --- | --- | --- | --- |
| Gate | Development entry gate amended (2026-09-25) | — | The owner allowed provisional local PM9 development from the verified local checkpoint `d56b17b6eab8dfdc5e15a85959c971121ee7685c` on `feat/pm9-product-convergence`, stopping before PM9.3. This is **not** an accepted integration baseline: its ancestry holds the unvalidated `8ad3912` and the unmerged PR #127 stack. Test execution stays paused; budget, v5.11 direction, schema 4, scientific scope, HOLD and publication rules are unchanged. Reconciliation with the eventually accepted `main` is a separate task. |
| PM9.1 | **BROWSER RENDERED BASELINE ESTABLISHED — NATIVE ACCEPTANCE PENDING; NOT COMPLETE** | — | [baseline.md](baseline.md): ownership map, legacy-spec map from recorded evidence, reference identity and known deviations, verification entry points, rendered comparison ([§3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25)) and validation record ([§7](baseline.md#7-validation-window-2026-09-25)). Controlled scenarios in `apps/desktop/src/test/pm9Scenarios.tsx`. Browser baseline spec `e2e/specs/pm9.1-baseline.browser.e2e.ts`: B1–B7 PASS; the final authored set 14/14 PASS on `a0783bb` ([baseline §6](baseline.md#6-browser-baseline-spec)). Not done: native Windows rendered acceptance at the host's 150 % scaling (PENDING); the provider-positive native route (BLOCKED_PROVIDER_HOLD); J1–J6 step, decision and mount measurements; the shared-helper diagnoses. |
| PM9.2 | **PM9.2 PRODUCT CONVERGENCE COMPLETE — FOCUSED RENDERED ACCEPTANCE PASS** | Yes, one repair in the window, one in the acceptance | Closed 2026-09-26 on the final code candidate `b81fc785d2be703e09ac4183dd1c3a17dea58cb7` (tree `45da59b2f569d862e825b4621d222b9d38e38767`): the owner chose the English scope wording "Conversion: {{scope}} · {{eligible}} eligible" for L14–L16 (e); B2's and one unit test's expected copy follow it. Typecheck, e2e typecheck, 5 affected Vitest files (51 tests) and PM9.1's browser spec (22 of 22) pass; L1, L9, L10, L14–L16, L20 and L22 pass; the five deferred records are amended with dated notes ([slice-02](slice-02.md#closure-2026-09-26-the-owners-decision-and-the-final-candidate)). PM9 testing infrastructure, test-only: a headed switch and `pnpm qa:pm9:manual`, a manual review harness for PM9.3–PM9.7 (`c5a3f7e988409b59d427a95ed3382c8ccf858300`). Before it, the focused rendered acceptance (2026-09-26) on `0d22fc7843c0ec9583ca44bc4fa91e0a94803eb0` (tree `9610fe373dd8dae7a59abd1930d4fd95311450f6`): PM9.1's spec 22 of 22 including B1–B7, the affected legacy specs with no new failure, one repair cycle (`56d8262`, one rule withdrawn in `0d22fc7`). Every obligation passes except L14–L16 (e) in en, where the floored scope reads "For co…"; its fix changes wording the frozen B2 pins, so it is the owner's ([slice-02](slice-02.md#focused-rendered-acceptance-2026-09-26), [baseline §9](baseline.md#9-pm92-focused-rendered-acceptance-2026-09-26)). Native at 150 % PENDING. Before it, the convergence (2026-09-26, on the reconciled base `c562327`): production `6b31161be6ff66d31c1a9152b4cf59cefffa1afe` (tree `8783d517bdfcd723bc21811a8315b48e92e56552`) implements L1, L9, L10, L14–L16, L20 and L22 in the frontend only; tests `e533c946c1796e8b47005331b15eef5fae28b852` (tree `d1fad14e8a8bb738b8bf3a3fb08188159dd407c8`). Typecheck, e2e typecheck, the full Vitest suite (110 files, 2212 tests), `pnpm build`, `check_repo` and `git diff --check` pass; no browser or native run (`IMPLEMENTED_UNVALIDATED`). The browser spec's B1 now expects no scope item on the Project surface, pending the owner's confirmation. Dispositions, the focused rendered set and the records to amend after acceptance are in [slice-02.md](slice-02.md#convergence-implemented-2026-09-26-on-c562327). Before it, the draft: code commits `317481edf9270fac49af07dcc0d2a63866a0a30a` (the shell context line, the Project work dot, PM9.1 scenarios and tests) and `9786809fcfe3f6933bf7c1ec8d1f011ae5310970` (tree `da9ae8eb3dcc9eb4412153ad7e3671a7b0770f0b`: focus ring drawn inside the clipped line, 32 px compact items), found by a bounded static read before this record, and the window's repair `a0783bb7c64b41cd0c2ab3780573bfb679e3464a` (tree `85b5e15e8537d4f41992bd31022447994489029a`: a 960×640 horizontal overflow). `a0783bb` is the draft's tested production-code candidate. |
| PM9.3 | **STATIC PREPARATION COMPLETE — PRODUCTION IMPLEMENTATION NOT STARTED** | — | [slice-03.md](slice-03.md): viewer ownership map, action classes, static v5.11 mismatch ledger, legacy-spec classification. `e2e/specs/pm9.3-viewer.browser.e2e.ts` ran 11/11 PASS on `a0783bb` against the unchanged viewer, which shows the authored harness executes. Three PM9.1 spec authoring defects were corrected test-only ([baseline §6.5](baseline.md#65-static-review-corrections-pm93-preparation)). First implementation item once PM9.2 closes: the confirmed defect L13. The midpoint check still follows this slice. |
| PM9.3 | **IMPLEMENTED — RENDERED ACCEPTANCE RESOURCE_DEFERRED** (2026-09-26) | — | Re-expanded on `7175744` (`eae0fc3`). Code: `47c981b` (L13: the chromatogram's traces and range controls move to a line above the plot; the header keeps the title and the figure and export actions) and `696602c` (the spectrum header's Export spectrum disclosure joins its figure actions' line). Tests: `e31aba3` and `eeeb7c6` (one `revealRosterRow`; the shared table's fixed save record re-folded a roster opened below 1050 px, statically diagnosed; PM9.3-G walks the eleven-size sweep and asserts one row per viewer toolbar). On `d51ee21`, code equal to `696602c`: typecheck, e2e typecheck, 18 affected Vitest files (376 tests), `check_repo` and `git diff --check` pass. No browser, full-suite or build run: every browser group was refused at admission (≤ 7.53 GiB available). Not complete; the owed runs are listed in slice-03 §0.4. |
| PM9.3 | **PM9.3 VIEWER PRODUCT CONVERGENCE COMPLETE — FOCUSED RENDERED ACCEPTANCE PASS** (2026-09-28) | Yes, one repair cycle (`55c30f3`) | Final candidate `d98432bd82e6ba25531cef0b06f453dff6a55351` (tree `54bdfc7044f5df7740e78a0bc78974ad1ad2eeb6`); its `apps/` equals `55c30f3533c9a90f8dd67b2aa6f28d5004db01e5`'s (tree `d3110817766fe91cd4f107bd2f32992a432327be`). Helper: TEST HELPER BUG, confirmed by a discriminating run. The shared table's fixed `save_ui_preferences` record read back `automatic` layout and `en`, and the shell adopts what a save confirms. Fixed test-only with `revealRosterRow` and `readBackSavedPreferences`, used by openTheViewer, m7.3, m7.4 and PM9.3. L13 and the spectrum header's stacked export line are fixed (`47c981b`, `696602c`). Repair cycle 1 (`55c30f3`): m7.3's 960×640 case required the selected spectrum's plot to begin inside the window, and it began at 663.6 (below it too before PM9.3; when it last passed is not recorded). Each plot header's quick-action caption now shares its buttons' line, and the viewer's spacing is tightened. The spectrum plot now shows 13 px at 960×640 in both languages (was 0), and 141 against 103 px at 1366×768. Static on `d98432b`: lint, typecheck, e2e typecheck, `pnpm test` (110 files, 2212 tests), build, `check_repo` and `git diff --check`, all exit 0. Browser, controlled IPC at DPR 1: PM9.3 11 of 11 with G extended to the eleven-size sweep and L13 asserted; PM9.1 22 of 22; the helper's legacy specs show no new failure and 37 now passing against `a0783bb` (m5.7 8/8, m7.3 16/16, m7.4 14/16, m4.3 21/23, m4.4 16/18, m5.2 43/48, viewer-r1 46/54). Passed to PM9.7's regression gate: the family-(b) stale setups (m4.1, m4.2, m5.3, and two cases each in m4.3 and viewer-r1 plus one in m4.4), two (d) driver-geometry cases, retiring the SUPERSEDED rows against their named replacements, and m7.4's active-Clear pair. Owner questions: ADR 0006's 544 px breakdown names a sidebar the M7.2 fold removed. Native 150 % stays with the qualification. |
| Rework | **PM9 REPORTED UI/UX ISSUES CLEARED — REQUIRED FINAL VALIDATION COMPLETE** (2026-10-04: UI-34's wording accepted; PM9.1 55/55, m5.7 8/8, e2e typecheck, PM9.3-V11/V12 2/2 on `1a6d887`, production `b7b8eeb`; the six legacy specs HISTORICAL KNOWN FAILURES — NOT RERUN ON THE CURRENT UI-34 CANDIDATE) — before it, as recorded 2026-10-03: PM9 REPORTED UI/UX ISSUES CLEARED — RENDERED ACCEPTANCE PASS (wording continuation, `b7b8eeb`: UI-34's committed line true while a gesture is in flight; tests first, one narrow review; PM9.3 17/17, m7.3 16/16 and the 40 affected Vitest files; PM9.1 and m5.7 deferred at the memory gate) — before it, batch 2 (`5e4c6ac`: UI-25, UI-34's timing and long ranges; one review, one correction cycle; PM9.3 16/16, PM9.1 55/55) and batch 1: **KNOWN UI/UX REWORK OPEN — UI-25 AND UI-34 UNRESOLVED** (2026-09-28) | Yes, two correction cycles (`859eaf0`, `ea85a88`), budget spent | The owner's priority: close every recorded UI/UX issue still present before PM9.4, as bounded rework rather than a slice. A frozen list of 49 items ([baseline §12](baseline.md#12-known-uiux-rework-2026-09-28)), each with its result. Two are UNRESOLVED: Details' long values (UI-25), and cycle 2's live-line regression on gestures (UI-34). Code candidate `ea85a8873e15684ad4bf86ea2c0368941d74bdd4` (tree `72251d3f6078d7bc7f852e4c9b0b7154a1f0cf7b`). One independent review, fifteen confirmed findings applied in cycle 1; cycle 2 from validation. Static set exit 0 (111 files, 2222 tests); PM9.1 55/55, PM9.3 13/13 across the anchors, the sweep and the 571/828 px cases in en and zh-CN; affected legacy specs with no new failure; m6.x not rerun. PM9.1 stays PARTIAL for J1–J6; PM9.4 held. |
| Window | **Validation window 2026-09-25** | — | One owner-opened window over PR #127's local candidate (`d56b17b`) and the PM9 cumulative candidate (`a0783bb`); record in [baseline §7](baseline.md#7-validation-window-2026-09-25). Full browser campaign: 378 outcomes — 179 same pass, 174 same known failure, 25 new PM9 tests all passing, 0 new failure / now passing / no result; five parallel shards, not the serial topology first requested. No new browser outcome regression observed. |
| Reconciliation | **PM9 BASE RECONCILED LOCALLY — SOURCE COMPOSITION CHECKED** | — | PR #127 merged into `main` as `57915dea6e5227fd9fe6de6532ca3201c9819c85`, natural-main CI successful. The provisional base is resolved: merge `052db1fdb765ebb09da0bcbb94b0969e70898900` (tree `a43a5130cb7e4fa8171441b3ab4bbc640ee20a8f`), first parent `505f778` (PM9), second parent `57915de` (main), common ancestor `d56b17b`; no path changed on both sides and no conflict. Rust and runtime inputs equal main's, frontend and browser-test inputs equal `a0783bb`'s; the combined tree has had no new runtime, component or browser run (**SOURCE COMPOSITION CHECKED — NO NEW RUNTIME VALIDATION**). `a0783bb` stays the last tested PM9 production code. See [baseline §8](baseline.md#8-reconciliation-with-the-accepted-main-2026-09-26). Not pushed. |
| PM9.4 | **PM9.4 CONVERSION JOURNEY COMPLETE — FOCUSED BROWSER/RENDERED ACCEPTANCE PASS** (2026-10-04) | Yes: two correction cycles, both within the budget. One came from the review (`5459f98`, `6922a60`); the other is a behaviour-neutral CSS restatement found by D2 (`55d75fb`). The runs also needed test-authoring fixes | Twelve required findings over the conversion journey are fixed, frontend only: scope named by its checkboxes; the review leading to Convert; a refused Convert as a Tab stop; one filled primary per state; retry markers and a visible retry scope; convert-again and rerun sentences; focus continuity through a stable status line; 32 px controls. Production `55d75fb`, tests `7e83ae4`. PM9.4 spec 9/9 (0/9 before); full Vitest 112 files, 2237 tests; build; PM9.1 55/55; m7.4 16/16; the six m6.x specs 65/65 (57/57 failing at setup before). U4's live-provider check stays BLOCKED_PROVIDER_HOLD. Record: [slice-04 §10](slice-04.md#10-record). |
| PM9.5 | **PM9.5 TARGETED-MS1 JOURNEY COMPLETE — FOCUSED BROWSER/RENDERED ACCEPTANCE PASS** (2026-10-04); before it, IMPLEMENTED — QUALIFICATION RESOURCE_DEFERRED (same day) | One review-driven correction cycle (`f877870`, `207b441`); test-authoring fixes logged separately | Twelve required findings over the targeted-MS1 task, frontend only, grounded in an observation of the unchanged production (O0): the review between Review plan and Run, with bounded tables; reasons on refused controls; refusals beside the action; a single run followed and cancelled in its setup; stop requested until answered; endings with Open result or Show run, and "Run again" only as new runs; focus never to the page; a problem's line leads back to it; the draft survives closing and another row, never a replaced project. Production `f877870`, tests `207b441`. G0 0/10 on unchanged production; a development run 10/10 before cycle 1. First, on the final candidate, C1 was refused at the memory gate (4.97 GiB free, 84.3% used). After the owner reported enough memory, every group passed on the final candidate (production `f877870`, tests `e02bb12`): typecheck (also lint), e2e typecheck, the targeted Vitest files (73 tests), full Vitest (112 files, 2251 tests), build, the PM9.5 spec 10/10 (0/10 before; T9 now also reaches the last row inside the bounded tables by wheel and keyboard), m9.1 12/12, m9.4 5/5, PM9.1 55/55, `check_repo` and `git diff --check`. Record: [slice-05 §12](slice-05.md#12-record). |
| PM9.6 | **PM9.6 RESULTS / HISTORY / EXPLICIT CONTINUATION COMPLETE — FOCUSED BROWSER/RENDERED ACCEPTANCE PASS** (2026-10-13); before it, QUALIFICATION RESOURCE_DEFERRED (2026-10-05) | One review-driven correction cycle (`6c3508a`, `a2a4fea`); test-authoring fixes logged separately | Six required findings over stored results and their history, frontend only, grounded in an observation of the unchanged production (O6): a one-line outcome summary; the meaning and the table's export before the rows, and a chosen target's evidence revealed beside its row; a report kept while its own run is inspected; a targeted run's failure and "No result was stored." in history and Details; a missing or damaged payload named in the history; a damaged payload's next step. Production `157ded3`, then `6c3508a`. G0 on unchanged production: every R case RED at its first finding. On 2026-10-05 the first qualification group was refused at the memory gate (3.2 GiB free, 89.9% used). On the owner's one-time waiver of the gate, every group passed on the final candidate `5fd09b8` (code equal to `6c3508a` and `a2a4fea`): typecheck (also lint), e2e typecheck, the affected Vitest files (137 tests), full Vitest (112 files, 2260 tests), build, the PM9.6 spec 32/32, PM9.5 10/10, m9.1 12/12, m9.4 5/5, m8.5 3/3, m8.1 8/8, m8.2 4/4, PM9.1 55/55, `check_repo` and `git diff --check`. The browser runs used the host's cached ChromeDriver 154 because Chrome 155 was staged but not active. Record: [slice-06 §13](slice-06.md#13-record). |
| PM9.7 | **PM9.7 COMPLETE — INTEGRATED BROWSER/RENDERED ACCEPTANCE PASS; CANDIDATE FROZEN** (2026-10-14) | Yes: one owner-ordered candidate 2 (`30b855f`) at the freeze, and a J4 method correction (`0b021af`); test-authoring fixes logged in [slice-07 §11](slice-07.md#11-record) | **Candidate 1 (`6c3508a`, PM9.6's production unchanged).** Legacy residue repaired statically while memory refused every run, then run: m4.1, m4.2, m5.3, m7.1, m7.2 (its `metrics()` timeouts a cascade after a failure) and m7.5, with m4.3, m4.4 and viewer-r1's remaining cases; eleven SUPERSEDED cases retired, each against a replacement shown passing by title; m7.4's active-Clear pair already closed by UI-23. J1–J6's after side equals `d56b17b` on every counted field once J4's no-op Open result was taken off the path (M5, M6). I1 and I1b, reviewed against DESIGN_SYSTEM, found F1 (refused Project actions that looked live) and F15 (20 of 150 focus stops on Chrome's thin ring), both pre-existing. **Candidate 2 (`30b855f`, the owner's order):** one focus ring for every stop, with room to be seen; refused Project actions that read as refused and say why; one zh-CN term each. An adversarial review confirmed two problems, both fixed, and a development run a reduced-motion timing effect in the spec and a clipped plot ring, both fixed. On candidate 2 every browser spec passes (487 cases), M7 repeats J1–J6's equality, full Vitest passes alone after one contention timeout in the parallel run, and typecheck, build and `check_repo` pass. Gate: the owner's stop-line gate in parallel shards. T0, T0b and D2 were refused at admission and G-PM9b-2 on a dirty tree; each check was later run under a new name. Two deviations from slice-07 §8 are recorded there, not amended after the fact: candidate 2's pool was staggered 20 s, not 30 s; and U1-3 and three development runs started below the standing admission line under the stop line alone. Record: [slice-07 §11](slice-07.md#11-record). |
| PM9.1 | **J1–J6 MEASURED ON `d56b17b` — PM9.1 COMPLETE, BASELINE ESTABLISHED, NOT ACCEPTED** (2026-10-13); before it, the same day, DRAFT AND VIEWPORT LEGS PENDING | No product change; two test-authoring fixes to the instrument (`1cb5ea9`) | The method was frozen in baseline §17.1 before any measuring run (`beacc3a`). `d56b17b`'s frontend was served from a `git archive` extraction with the checkout's node_modules joined in and a Vite cache of its own; the checkout was untouched. A calibration reproduced §7.4's before capture: every English frame identical, and zh-CN identical except one frame September had recorded unsettled. M3 measured J1–J6 7/7 with steps, decisions, confirmations, native dialogs, context changes, preserved sets, IPC calls and mounts (baseline §17.2). The owner waived the admission line and kept the 4 GiB / 90% stop line, which refused the first calibration. M3 showed neither a draft carried across navigation nor a committed viewport; the amended method's J1b and J4b (`c668f05`) measure them; refused once at the stop line (2.19 GiB free, 93.1% used), they then ran 2/2 (M4): a committed m/z zoom and a typed targeted draft are each kept across navigation. Record: [baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4). |
| Checkpoint | **Midpoint check (2026-10-04)** | — | Due after PM9.3 and paused by the known UI/UX rework; run at PM9.4's start: scope ledger, decisions, route and roadmap, then the plan check ([baseline §13](baseline.md#13-midpoint-check-2026-10-04)). Nothing changed scope or route. PM9.4 stays frontend-only and repairs its own legacy specs (m6.1, m6.4, m6.6–m6.9) inside the slice, under the existing unfreeze rule. |
| Checkpoint | **Mid-phase normalization (2026-09-26)** | — | Scope, decisions, route and roadmap rerun, then the plan check, on two met unfreeze conditions ([baseline §10](baseline.md#10-mid-phase-normalization-2026-09-26)). PM9.1: **PARTIAL — J1–J6 baseline measurement outstanding**, the only unmet item of its contract; native rendering at OS scaling and the provider route were never in it and now belong to the M7.6-style qualification after PM9.7. PM9.2: **COMPLETE**, confirmed against its own Completion. PM9.3: **READY**; its expansion is void and is redone when it starts. The `openTheViewer` repair and the 960×640 panel floors go to PM9.3, the m7.2 `metrics()` diagnosis and PM9.2's surface specs' remaining failures to PM9.7; the open deviation rows are classified. |

### Verification backlog

The 2026-09-25 window ran the previous backlog except the panel-floor
confirmation and slice-03 §6's render and legacy-repair order, which carry
over as items 3 and 5 below. It ran PR #127's Rust checklist on `d56b17b`,
which PM9 inherits; the front end; the seven M8/M9 browser specs; PM9.1's and
PM9.3's specs; and the repository checks, all on `a0783bb` except the Rust
group ([baseline §7](baseline.md#7-validation-window-2026-09-25)). Since then
the branch has merged the accepted main (baseline §8); that combined tree has
not been validated. For the next owner-opened window, target the cumulative
candidate on the reconciled base, not each intermediate commit:

1. Native Windows rendered acceptance at the host's 150 % scaling, by a route
   the ProteoWizard HOLD allows; a native window probes the installed backend
   on mount ([baseline §7.6](baseline.md#76-scaling-and-native-windows)). The
   provider-positive native route stays BLOCKED_PROVIDER_HOLD.
2. J1–J6 step, decision and mount measurements ([slice-01](slice-01.md)
   pending item 4).
3. The shared `openTheViewer` and m7.2 `metrics()` helper diagnoses (slice-01
   pending item 5), then the measured panel floors at 960×640.
4. Done in the browser on 2026-09-26 ([baseline §9](baseline.md#9-pm92-focused-rendered-acceptance-2026-09-26)):
   PM9.2's focused rendered set at the three viewports in both languages.
   The owner's decision on the English scope wording closed it on `b81fc78`.
   Left: PM9.2 in the native window at 150 %, with item 1.
5. PM9.3's render and legacy-repair order in
   [slice-03 §6](slice-03.md#6-pending-needs-a-validation-window).

Owners since the 2026-09-26 checkpoint ([baseline §10](baseline.md#10-mid-phase-normalization-2026-09-26)):
item 1 belongs to the M7.6-style qualification after PM9.7; item 2 to PM9.1,
on `d56b17b`; item 3's `openTheViewer` diagnosis and panel floors to PM9.3 and
its m7.2 `metrics()` diagnosis to PM9.7; item 4 is done in the browser and its
native remainder goes with item 1; item 5 is PM9.3's. On 2026-09-28 PM9.3 closed its part of item 3 (the `openTheViewer` diagnosis and the 960×640 height, stated in task terms) and item 5 ([slice-03 §0.5](slice-03.md#05-validation-repair-and-closure-2026-09-28)). On 2026-10-13 PM9.1 closed item 2 on `d56b17b` ([baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4)). On 2026-10-14 PM9.7 closed item 3's m7.2 `metrics()` diagnosis: the timeouts are a cascade after a failed test, and all 11 cases pass ([slice-07 §11](slice-07.md#11-record)). Item 1 and item 4's native remainder go to the owner's qualification dispatch after PM9. The rest of the backlog is closed.

## Closing record

- **Planned / actual slices:** seven planned, seven run. The known UI/UX
  rework of 2026-09-28 to 2026-10-04 ran as extra effort at the owner's
  priority and counted as no slice.
- **Rework:**
  - PM9.2: two repairs.
  - PM9.3: one repair cycle.
  - PM9.4: two correction cycles.
  - PM9.5 and PM9.6: one cycle each.
  - PM9.7: one owner-ordered candidate at the freeze.
  - Test-authoring fixes are logged per slice.
- **Acceptance / regression:** U1–U10 are accepted at the browser/rendered
  and component layers on the frozen candidate `30b855f`
  ([baseline §18](baseline.md#18-pm97-the-after-side-the-regression-and-the-frozen-candidate-2026-10-14)).
  - J1–J6 cost what they did before PM9, step for step.
  - Every browser spec and every Vitest test passes. The brief's regression
    list holds in its tested scopes.
  - Outside the slices:
    - native rendering at OS scaling: `PENDING`, as the brief and §10
      decision 1 placed it;
    - U4's live-provider check: `BLOCKED_PROVIDER_HOLD`, placed the same way,
      U4 accepted with it open by the owner;
    - the real targeted-MS1 engine path: `PENDING`, as the owner placed it
      on 2026-10-13 ([slice-07 §9](slice-07.md#9-owner-decisions-at-the-freeze), decision 4).

    All three belong to the owner's qualification dispatch after PM9.
- **Planning questions that changed a decision:**
  - **The validation backlog and budget question.** It moved PM9.1's
    residuals to their real owners (§10), which let PM9.3–PM9.6 start.
  - **Freezing the method before measuring** (§17.1, slice-07 §5). It caught
    J4's wrong after-side premise as a correction, not a quiet change.
  - **The owner's memory gate.** It decided when work could run. Parallel
    shards under the stop line ran each full regression in about a quarter
    of an hour.
