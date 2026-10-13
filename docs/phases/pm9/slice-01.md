# PM9.1 — populated-state baseline, reference deviations, ownership and verification entry points

PM9 | Acceptance: baseline for U1, U9, U10; repeatable scenarios for U2–U8 |
Type: experimental / must | Serial, one writer
Status: **COMPLETE — BASELINE ESTABLISHED, NOT ACCEPTED** (2026-10-13). J1–J6
were measured on `d56b17b` ([baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4)),
the last item of the Completion below. Before that: **PARTIAL — J1–J6
BASELINE MEASUREMENT OUTSTANDING** (2026-09-26 mid-phase normalization,
[baseline §10](baseline.md#10-mid-phase-normalization-2026-09-26)), with every other item of the Completion met. Established in the browser in the 2026-09-25
window on the production-code candidate `a0783bb`
([baseline §7](baseline.md#7-validation-window-2026-09-25)).

## Entry conditions

- Tracked work: the provisional base allowed by the gate amendment in
  [slices.md](slices.md) — local `d56b17b`, branch
  `feat/pm9-product-convergence`. Not an accepted integration baseline.
  Resolved on 2026-09-26: the branch merged the accepted main `57915de`
  ([baseline §8](baseline.md#8-reconciliation-with-the-accepted-main-2026-09-26)).
- Rendering and tests: only in a validation window the owner opens. More free
  memory does not open one.
- Reference: the owner-held v5.11 HTML, re-hashed before use against ADR 0047's
  identity; missing or different means a named gap, never a reconstruction.

## Read first

[brief.md](brief.md) (locked decisions, not-in-scope list), [baseline.md](baseline.md),
the root and `apps/desktop` `AGENTS.md`, [UX process](../../ux/UX_PROCESS.md),
the [durable v5.11 baseline](../../ux/DESIGN_SYSTEM.md#durable-v511-reference-baseline),
the [v5.11 gap assessment](../../ux/M8_0_V511_GAP_ASSESSMENT.md) (its section C
is what this slice continues), [screen model](../../product/SCREEN_MODEL.md) and
[primary workflows](../../product/PRIMARY_WORKFLOWS.md).

## Delivered

- [baseline.md](baseline.md): ownership map, legacy browser-spec map from
  recorded evidence, reference identity and known intentional deviations,
  controlled scenario list, verification entry points, the rendered
  comparison (§3.1) and the validation record (§7).
- `apps/desktop/src/test/pm9Scenarios.tsx`: seven controlled, synthetic
  scenarios over the real composition, built from existing fixture builders.
- `apps/desktop/src/app/Pm9Baseline.test.tsx`: scenario tests — first-run
  context, roster preserved across navigation, conversion running and ended,
  stored result whole / missing / corrupt — pass (baseline §7.2).
- `e2e/specs/pm9.1-baseline.browser.e2e.ts`: the browser baseline spec on the
  existing harness — seven functional cases over the context line and four
  observation runs. B1–B7 pass, and after the window's repair the final
  authored set passes 14 of 14 on `a0783bb` (baseline §7.3); ledger and J1–J6
  map in [baseline §6](baseline.md#6-browser-baseline-spec).

## Pending items and their state after the 2026-09-25 window

1. Run the tests above; record exits. **Done** (baseline §7.2).
2. Run the authored browser baseline spec
   ([baseline §6](baseline.md#6-browser-baseline-spec)), and
   render in the browser harness (`e2e/support/harness.ts`: IPC
   boundary preloaded, hold/reject, console ledger) at 1920×1080, 1366×768 and
   960×640 CSS, en and zh-CN, keyboard traversal and reduced motion (CDP
   `Emulation.setEmulatedMedia`, as the M7.2 spec does). DPR is recorded
   separately and never read as native scaling. **Done in the browser at DPR
   1.** The host runs at 150 % scaling; native Windows rendered acceptance at
   that scaling is **PENDING**, and the provider-positive native route is
   **BLOCKED_PROVIDER_HOLD** (baseline §7.6).
3. Render the reference at the same viewports (Chinese only) and fill the
   deviation table's production column; classify each difference as recorded
   intentional / gap for PM9.N / later / not applicable. **Partly done:** the
   reference is rendered and the production column is filled. The owner
   disposed of L1, L9, L10, L13, L14–L16, L20 and L22; the other rows cite
   existing records or are routed to PM9.3; L11, L12 and parts of L3, L5 and
   L21 are open, and L7 at 1920×1080 has no disposition; and the states in the
   "Not captured" list were not part of the comparison
   ([baseline §3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25)).
4. **Done (2026-10-13)** on `d56b17b`, which later slices cannot change, by
   the rules frozen in [baseline §17.1](baseline.md#171-method-frozen-before-any-measuring-run-2026-10-13)
   and with the results in §17.2. The item as written:
   Measure journeys J1–J6 before later slices change them — curate and inspect;
   convert; reopen and check a project; targeted setup, review and run; read QC
   and targeted results and export; Home / Settings / folding — recording
   steps, decisions, context changes, required confirmations, preserved IDs,
   drafts and viewports, IPC calls and mounts. No click-count targets are set
   beforehand; required confirmations stay.
   The B cases record the requests of their own paths only.
5. **Not done.** Diagnose the shared `openTheViewer` roster helper and the m7.2 `metrics()`
   helper before any per-test legacy repair ([baseline §2](baseline.md#2-failing-legacy-browser-specs)).

## Pitfalls

- Fixture data is synthetic; label it everywhere. It judges composition,
  density and interaction, never provider or engine operation.
- The reference is not copied into the repository; cite path and hash.
- Demo numbers and units are not real; derive none from them.
- The harness installs its answer table before navigation; a late table misses
  mount-time requests.
- `M73Viewer.test.tsx` can exceed 5 s under load, and WDIO sometimes fails to
  open a session; record both as they happen, no retry-until-green, no global
  timeout change.
- Native sessions need unreserved driver ports (4444/4445 are reserved on the
  owner's machine). Stopping a background runner can leave its children running:
  confirm task-owned descendants have exited, and never end an unrelated process.
- Keep the two Project layout-effect focus repairs as they are.

## Not in this slice

Production UI changes; fixes found by the baseline (recorded and assigned
instead); click-count targets; style reselection or pixel comparison; any
provider or runtime; a full legacy-suite repair; slices 2–7.

## Completion

All of: the tests above run and recorded; rendered scenarios at three viewports
and two languages with keyboard and reduced-motion samples; the deviation table
filled; J1–J6 measured; verification entry points confirmed. U1, U9 and U10 are
then **baseline established**, not accepted. A missing reference or entry point
is a named gap and PM9.1 stays incomplete.

After the 2026-09-25 window the tests have run, the rendered scenarios exist in
the browser and the deviation table's production column is filled, with L11,
L12 and parts of L3, L5 and L21 still open and L7 at 1920×1080 undisposed.
J1–J6 are not measured, native rendered acceptance at the host's 150 % scaling
is PENDING and the provider-positive native route is BLOCKED_PROVIDER_HOLD, so
**PM9.1 is NOT COMPLETE**. The helper diagnoses (pending item 5) are also not
done.

*Corrected at the 2026-09-26 mid-phase normalization
([baseline §10](baseline.md#10-mid-phase-normalization-2026-09-26)).* Of those reasons only J1–J6 is in the
Completion above, so it alone keeps PM9.1 open: **PARTIAL**. It is measured on
the pre-PM9 candidate `d56b17b`, which later slices cannot change, and is
required before PM9.7. The open deviation rows are now classified (item 3).
Native rendering at OS scaling and the provider route were never in this
contract; they belong to the M7.6-style qualification after PM9.7's frozen
candidate. The helper diagnoses (item 5) are not in it either: the
`openTheViewer` repair is PM9.3's and m7.2's `metrics()` diagnosis PM9.7's.

*Completed 2026-10-13.* J1–J6 are measured on `d56b17b`
([baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4)).

- **How.** The frontend was served from an extraction that a calibration
  proved renders as §7.4's before capture did. Steps, decisions,
  confirmations, native dialogs, context changes, preserved sets, IPC calls
  and mounts were recorded at 1366×768 in English, and J6 also at 960×640.
- **Status.** Every item of the Completion is met: **COMPLETE — baseline
  established, not accepted**. U1, U9 and U10 have their baseline. PM9.7
  measures the after side by the same rules, with the same recorder.
- **Outside the Completion.** The helper diagnoses (item 5) stay with PM9.3
  and PM9.7, as §10 routed them.
