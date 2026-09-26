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

## Log

| # | Result | Rework? | Notes |
| --- | --- | --- | --- |
| Gate | Development entry gate amended (2026-09-25) | — | The owner allowed provisional local PM9 development from the verified local checkpoint `d56b17b6eab8dfdc5e15a85959c971121ee7685c` on `feat/pm9-product-convergence`, stopping before PM9.3. This is **not** an accepted integration baseline: its ancestry holds the unvalidated `8ad3912` and the unmerged PR #127 stack. Test execution stays paused; budget, v5.11 direction, schema 4, scientific scope, HOLD and publication rules are unchanged. Reconciliation with the eventually accepted `main` is a separate task. |
| PM9.1 | **BROWSER RENDERED BASELINE ESTABLISHED — NATIVE ACCEPTANCE PENDING; NOT COMPLETE** | — | [baseline.md](baseline.md): ownership map, legacy-spec map from recorded evidence, reference identity and known deviations, verification entry points, rendered comparison ([§3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25)) and validation record ([§7](baseline.md#7-validation-window-2026-09-25)). Controlled scenarios in `apps/desktop/src/test/pm9Scenarios.tsx`. Browser baseline spec `e2e/specs/pm9.1-baseline.browser.e2e.ts`: B1–B7 PASS; the final authored set 14/14 PASS on `a0783bb` ([baseline §6](baseline.md#6-browser-baseline-spec)). Not done: native Windows rendered acceptance at the host's 150 % scaling (PENDING); the provider-positive native route (BLOCKED_PROVIDER_HOLD); J1–J6 step, decision and mount measurements; the shared-helper diagnoses. |
| PM9.2 | **BROWSER FUNCTIONAL ACCEPTANCE PASSED — VISUAL AND PRODUCT ACCEPTANCE PENDING** | Yes, one repair | Code commits `317481edf9270fac49af07dcc0d2a63866a0a30a` (the shell context line, the Project work dot, PM9.1 scenarios and tests) and `9786809fcfe3f6933bf7c1ec8d1f011ae5310970` (tree `da9ae8eb3dcc9eb4412153ad7e3671a7b0770f0b`: focus ring drawn inside the clipped line, 32 px compact items), found by a bounded static read before this record, and the window's repair `a0783bb7c64b41cd0c2ab3780573bfb679e3464a` (tree `85b5e15e8537d4f41992bd31022447994489029a`: a 960×640 horizontal overflow). `a0783bb` is the tested production-code candidate. Remaining work: the owner's actions L1, L9, L10, L14–L16 and L22, and confirming L20's conditions (the Details affordance obvious, stable and keyboard reachable) ([baseline §3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25)); see [slice-02.md](slice-02.md). |
| PM9.3 | **STATIC PREPARATION COMPLETE — PRODUCTION IMPLEMENTATION NOT STARTED** | — | [slice-03.md](slice-03.md): viewer ownership map, action classes, static v5.11 mismatch ledger, legacy-spec classification. `e2e/specs/pm9.3-viewer.browser.e2e.ts` ran 11/11 PASS on `a0783bb` against the unchanged viewer, which shows the authored harness executes. Three PM9.1 spec authoring defects were corrected test-only ([baseline §6.5](baseline.md#65-static-review-corrections-pm93-preparation)). First implementation item once PM9.2 closes: the confirmed defect L13. The midpoint check still follows this slice. |
| Window | **Validation window 2026-09-25** | — | One owner-opened window over PR #127's local candidate (`d56b17b`) and the PM9 cumulative candidate (`a0783bb`); record in [baseline §7](baseline.md#7-validation-window-2026-09-25). Full browser campaign: 378 outcomes — 179 same pass, 174 same known failure, 25 new PM9 tests all passing, 0 new failure / now passing / no result; five parallel shards, not the serial topology first requested. No new browser outcome regression observed. |

### Verification backlog

The 2026-09-25 window ran the previous backlog except the panel-floor
confirmation and slice-03 §6's render and legacy-repair order, which carry
over as items 3 and 5 below. It ran PR #127's Rust checklist on `d56b17b`,
which PM9 inherits; the front end; the seven M8/M9 browser specs; PM9.1's and
PM9.3's specs; and the repository checks, all on `a0783bb` except the Rust
group ([baseline §7](baseline.md#7-validation-window-2026-09-25)). For the next
owner-opened window, target the cumulative candidate, not each intermediate
commit:

1. Native Windows rendered acceptance at the host's 150 % scaling, by a route
   the ProteoWizard HOLD allows; a native window probes the installed backend
   on mount ([baseline §7.6](baseline.md#76-scaling-and-native-windows)). The
   provider-positive native route stays BLOCKED_PROVIDER_HOLD.
2. J1–J6 step, decision and mount measurements ([slice-01](slice-01.md)
   pending item 4).
3. The shared `openTheViewer` and m7.2 `metrics()` helper diagnoses (slice-01
   pending item 5), then the measured panel floors at 960×640.
4. PM9.2's remaining actions ([baseline §3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25)),
   each rendered at 1920×1080, 1366×768 and 960×640 in en and zh-CN with
   keyboard and reduced-motion samples, and the affected specs rerun; and L20's
   Details affordance confirmed obvious, stable and keyboard reachable.
5. PM9.3's render and legacy-repair order in
   [slice-03 §6](slice-03.md#6-pending-needs-a-validation-window).

## Closing record

- Planned / actual slices:
- Rework:
- Acceptance / regression:
- Planning questions that changed a decision:
