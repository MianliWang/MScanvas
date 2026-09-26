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

One status per slice; the reasons, the residual classification and the
decisions are in [baseline §10](baseline.md#10-mid-phase-normalization-2026-09-26).

| # | Status | Goal / depends on / acceptance owner |
| --- | --- | --- |
| PM9.1 | **PARTIAL — J1–J6 baseline measurement outstanding** | Measure J1–J6 on the pre-PM9 candidate `d56b17b` / an owner-opened window / PM9.1; required before PM9.7, blocks nothing earlier |
| PM9.2 | **COMPLETE** | — |
| PM9.3 | **IN PROGRESS — IMPLEMENTED; RENDERED ACCEPTANCE RESOURCE_DEFERRED** | Evidence-first viewer: L13 and the spectrum header's second row fixed (`47c981b`, `696602c`), the narrow-window roster reveal consolidated (`e31aba3`, `eeeb7c6`); every browser group refused at the memory gate on 2026-09-26, so the helper's discriminating run, the PM9.3 spec, the legacy reruns and the rendered acceptance are owed ([slice-03 §0.4](slice-03.md#04-implementation-state)) / PM9.2 (complete) / PM9.3: U3, U8 (viewer), U9, U10 |
| PM9.4 | NOT STARTED | Conversion configuration → review → queue → recovery → outputs / after PM9.3 / PM9.4: U4 (its live-provider check with the external qualification), U8 (conversion), U9, U10 |
| PM9.5 | NOT STARTED | Targeted-MS1 setup → plan review → progress → result entry / after PM9.4 / PM9.5: U5, U7 (drafts), U9, U10 |
| PM9.6 | NOT STARTED | Reports, evidence, history, exports and explicit continuation, with L12 / PM9.2, PM9.3, PM9.5 / PM9.6: U6, U7, U8 (stored), U9, U10 |
| PM9.7 | NOT STARTED | Integrated journeys against PM9.1's J1–J6, regression including PM9.2's surface specs (m7.1, m7.2, m7.4's active-Clear cases, m7.5), final reference-deviation disposition, candidate freeze / PM9.1's remainder and PM9.2–PM9.6 / PM9.7: U1–U10 integrated |

Outside the slices: M7.6-style installed, native, provider and release
qualification of PM9.7's frozen candidate owns native rendering at OS scaling
and every provider-positive check ([ROADMAP](../../../ROADMAP.md), after M9).

**Scope ledger.**

- Must do in the remaining PM9: PM9.3–PM9.6 as routed; PM9.1's J1–J6.
- Phase closure (PM9.7): integrated journey acceptance against the J1–J6
  baseline; regression, with the remaining failures of m7.1, m7.2, m7.4's
  active-Clear cases and m7.5;
  the final reference-deviation disposition and the states §3.1 did not
  capture; the candidate freeze.
- External or blocked: native acceptance at OS scaling; provider-positive
  checks under the ProteoWizard HOLD.
- If time allows: L7 at 1920×1080 and L11; drag and motion details; touch;
  other non-critical layout adjustments.
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
| PM9.3 | **IMPLEMENTED — RENDERED ACCEPTANCE RESOURCE_DEFERRED** (2026-09-26) | — | Re-expanded on `7175744` (`eae0fc3`). Code: `47c981b` (L13: the chromatogram's traces and range controls move to a line above the plot; the header keeps the title and the figure and export actions) and `696602c` (the spectrum header's Export spectrum disclosure joins its figure actions' line). Tests: `e31aba3` and `eeeb7c6` (one `revealRosterRow`; the shared table's fixed save record re-folded a roster opened below 1050 px, statically diagnosed; PM9.3-G walks the eleven-size sweep and asserts one row per viewer toolbar). Typecheck, e2e typecheck, 12 affected Vitest files (404 tests), `check_repo` and `git diff --check` pass. No browser, full-suite or build run: every browser group was refused at admission (≤ 7.53 GiB available). Not complete; the owed runs are listed in slice-03 §0.4. |
| Window | **Validation window 2026-09-25** | — | One owner-opened window over PR #127's local candidate (`d56b17b`) and the PM9 cumulative candidate (`a0783bb`); record in [baseline §7](baseline.md#7-validation-window-2026-09-25). Full browser campaign: 378 outcomes — 179 same pass, 174 same known failure, 25 new PM9 tests all passing, 0 new failure / now passing / no result; five parallel shards, not the serial topology first requested. No new browser outcome regression observed. |
| Reconciliation | **PM9 BASE RECONCILED LOCALLY — SOURCE COMPOSITION CHECKED** | — | PR #127 merged into `main` as `57915dea6e5227fd9fe6de6532ca3201c9819c85`, natural-main CI successful. The provisional base is resolved: merge `052db1fdb765ebb09da0bcbb94b0969e70898900` (tree `a43a5130cb7e4fa8171441b3ab4bbc640ee20a8f`), first parent `505f778` (PM9), second parent `57915de` (main), common ancestor `d56b17b`; no path changed on both sides and no conflict. Rust and runtime inputs equal main's, frontend and browser-test inputs equal `a0783bb`'s; the combined tree has had no new runtime, component or browser run (**SOURCE COMPOSITION CHECKED — NO NEW RUNTIME VALIDATION**). `a0783bb` stays the last tested PM9 production code. See [baseline §8](baseline.md#8-reconciliation-with-the-accepted-main-2026-09-26). Not pushed. |
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
native remainder goes with item 1; item 5 is PM9.3's.

## Closing record

- Planned / actual slices:
- Rework:
- Acceptance / regression:
- Planning questions that changed a decision:
