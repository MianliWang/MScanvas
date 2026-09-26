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
| PM9.1 | **STATIC PREPARATION IMPLEMENTED — RENDERED BASELINE PENDING** | — | [baseline.md](baseline.md): ownership map, legacy-spec map from recorded evidence, reference identity and known deviations, verification entry points. Controlled scenarios in `apps/desktop/src/test/pm9Scenarios.tsx`. Browser baseline spec `e2e/specs/pm9.1-baseline.browser.e2e.ts` authored, **NOT RUN** ([baseline §6](baseline.md#6-browser-baseline-spec-authored-not-run)). Not done: rendered captures at the three viewports and two languages, reference rendering, task-sequence and request/mount measurements. |
| PM9.2 | **LOCAL IMPLEMENTATION DRAFT — NOT BUILT / NOT RENDERED / NOT TESTED** | — | Code commits `317481edf9270fac49af07dcc0d2a63866a0a30a` (the shell context line, the Project work dot, PM9.1 scenarios and tests) and `9786809fcfe3f6933bf7c1ec8d1f011ae5310970` (tree `da9ae8eb3dcc9eb4412153ad7e3671a7b0770f0b`: focus ring drawn inside the clipped line, 32 px compact items), found by a bounded static read before this record; see [slice-02.md](slice-02.md). Depends provisionally on PM9.1's static facts only. |

### Verification backlog (for the next owner-opened window)

Target the reconciled cumulative candidate, not each intermediate commit.

1. The deferred PR #127 checklist on that candidate (Rust group, real-runtime
   suite alone, release check).
2. Front end: `pnpm lint`, `pnpm typecheck`, `pnpm test` — including the new
   `shellContext.test.ts`, `ContextLineShell.test.tsx` and
   `app/Pm9Baseline.test.tsx`, none of which has run — and `pnpm build`.
3. The seven M8/M9 browser specs, which wait on `.workbench-header` and whose
   layout readings move with the header's second line.
4. PM9.1's rendered baseline and the PM9.2 context line at 1920×1080,
   1366×768 and 960×640, en and zh-CN, keyboard and reduced motion — starting
   with `pnpm e2e:browser --spec ./e2e/specs/pm9.1-baseline.browser.e2e.ts`
   ([baseline §6](baseline.md#6-browser-baseline-spec-authored-not-run)); confirm
   the header's height change leaves the measured panel floors intact.
5. `python scripts/check_repo.py` and `git diff --check`.

## Closing record

- Planned / actual slices:
- Rework:
- Acceptance / regression:
- Planning questions that changed a decision:
