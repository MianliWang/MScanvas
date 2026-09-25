# PM9.1 — populated-state baseline, reference deviations, ownership and verification entry points

PM9 | Acceptance: baseline for U1, U9, U10; repeatable scenarios for U2–U8 |
Type: experimental / must | Serial, one writer
Status: **STATIC PREPARATION IMPLEMENTED — RENDERED BASELINE PENDING.** Not
complete.

## Entry conditions

- Tracked work: the provisional base allowed by the gate amendment in
  [slices.md](slices.md) — local `d56b17b`, branch
  `feat/pm9-product-convergence`. Not an accepted integration baseline.
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

## Delivered (static; nothing run)

- [baseline.md](baseline.md): ownership map, legacy browser-spec map from
  recorded evidence, reference identity and known intentional deviations,
  controlled scenario list, verification entry points.
- `apps/desktop/src/test/pm9Scenarios.tsx`: seven controlled, synthetic
  scenarios over the real composition, built from existing fixture builders.
- `apps/desktop/src/app/Pm9Baseline.test.tsx`: scenario tests — first-run
  context, roster preserved across navigation, conversion running and ended,
  stored result whole / missing / corrupt — **written, not run**.

## Pending (needs a validation window)

1. Run the tests above; record exits.
2. Rendered baseline in the browser harness (`e2e/support/harness.ts`: IPC
   boundary preloaded, hold/reject, console ledger) at 1920×1080, 1366×768 and
   960×640 CSS, en and zh-CN, keyboard traversal and reduced motion (CDP
   `Emulation.setEmulatedMedia`, as the M7.2 spec does). DPR is recorded
   separately and never read as native scaling.
3. Render the reference at the same viewports (Chinese only) and fill the
   deviation table's production column; classify each difference as recorded
   intentional / gap for PM9.N / later / not applicable.
4. Measure journeys J1–J6 before later slices change them — curate and inspect;
   convert; reopen and check a project; targeted setup, review and run; read QC
   and targeted results and export; Home / Settings / folding — recording
   steps, decisions, context changes, required confirmations, preserved IDs,
   drafts and viewports, IPC calls and mounts. No click-count targets are set
   beforehand; required confirmations stay.
5. Diagnose the shared `openTheViewer` roster helper and the m7.2 `metrics()`
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
