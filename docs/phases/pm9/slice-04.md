# PM9.4 — conversion journey: scope, configuration, review, queue, recovery, outputs

PM9 | Acceptance: U4, U8 (conversion), U9, U10 | Depends on: PM9.2; after PM9.3 | Serial, one writer
Status: **IN PROGRESS** (2026-10-04). Expanded from the code of the starting
point below. The midpoint check ran first and changed nothing
([baseline §13](baseline.md#13-midpoint-check-2026-10-04)).

## 0. Starting point

- HEAD `5f3caf5af5f93d9985c4e5c855405a12ef37ec1b` (tree
  `715e8825ab356281be9a14d502e5da5e24140bff`), on `feat/pm9-product-convergence`.
  Clean worktree and index, no stash, one worktree. The accepted upstream
  `57915de` is an ancestor.
- Production is the rework's candidate `b7b8eeb5087b755ea6d8b99e6d8d38b848d5103c`
  (tree `c91bbc64ce15b7c596fa84afa41f7566ab6822e4`). The tests are
  `1a6d887b9e3baba095497abc080bd5b0a8bdbb1e`'s (tree
  `1675b834453c071b8e15593898239f5b3ab32b7f`). Only documentation follows them.
- The known UI/UX rework is closed (baseline §12). Its rows are not reopened
  here.

## 1. Goal

A reader converting vendor acquisitions knows four things before they press
anything:

- what will be converted;
- with which settings;
- where the outputs go;
- what happens if an output name is taken.

While the queue runs, they see what is happening and can stop it. When it
ends, they know what to do with each success, refusal and failure, and how to
reach the outputs through the existing actions. This is frontend product
convergence of supported capabilities, not a new converter.

## 2. Owners and action classes

Read from the code at the starting point. Nothing here is changed by PM9.4.
Paths are under `apps/desktop/src/features/mzml-preview/`.

| Fact | Owner | Class |
| --- | --- | --- |
| Processing membership (the roster checkboxes), distinct from highlight, viewed row and focus | `rosterSelection.ts` `conversionMembership`, written only by `membershipChanged` and the import defaults | Local session state, Rust-pruned |
| Scope (`selected` / `all`) and execution order | `usePreviewWorkspace.ts` `conversionScope`; `conversionScope.ts` `resolveConversionScope` over the whole Rust roster, sorted by the roster's sort, filtered by `isConvertibleSourceKind` | Local draft, derived |
| Settings (one admitted combination) | `useConversionConfiguration.ts`, from `read_conversion_configuration`; `conversionIntentSelection.ts` | Rust snapshot plus a local selection |
| Destination and conflict policy | `useConversionOperation.ts` drafts. Custom folder and Fail are the defaults; there is no overwrite | Local draft |
| Review (plan) | `useConversionPlan.ts` / `conversionPlanAuthority.ts`, answered by `describe_workspace_conversion_queue` (read-only). Withdrawn synchronously when the question changes; a late reply is dropped | Existing domain read |
| Start | `convert` → `begin_workspace_conversion_queue {handles, intentId, conflictPolicy, destinationPolicy, expectedReceipt}` → `choose_workspace_conversion_destination {reservationId}` | Provider-backed operation |
| Queue and item state; no events | `get_workspace_conversion_state`, read on mount and every 2 s while busy, ordered by `sequence` | Existing projection |
| Stop queue / Stop this file / Skip | `stop_workspace_conversion_queue {operationId}`; `cancel_current_workspace_conversion_item {operationId, itemIndex, attempt}`; `skip_pending_workspace_conversion_item {operationId, itemIndex}` | Provider-backed operations |
| Retry | `retry_workspace_conversion_queue` with no arguments: Rust reruns the slot's terminal queue's retryable failures. Offered only for a completed queue with `retryableFailedCount > 0` | Provider-backed operation |
| Open file / Open folder | `open_finalized_output {outputId, action}`, one ticket per finalized output | Existing domain command; not adoption |
| Add converted outputs | `adopt_workspace_conversion_outputs {operationId}`, all finalized outputs of the terminal queue | Existing domain command |
| Diagnostics | `begin_…_diagnostics_export {operationId}` → `save_… {reservationId}` | Existing domain command |
| Project, Plan, Run, Artifact | No conversion owner. Schema 4 records no conversion | Out of PM9.4 |

## 3. Findings and acceptance

A finite list, frozen before implementation. Each row has its user-visible
criterion, owning code and regression evidence. **R** rows are required: each
is forced by one of the dispatch's seven outcomes. **V** rows were checked and
are not defects. **O** rows are optional polish, recorded and not done. **F**
rows are future capability or someone else's decision.

### Required

| ID | Outcome | Criterion | Owning code | Evidence |
| --- | --- | --- | --- | --- |
| R1 | 1 | The scope names its owner. "Selected rows" meant the checked members since M7.2, while the roster says "selected" for highlighted rows. It becomes "Checked rows" / "勾选的行", with help and refusal copy that name the checkboxes. The selected-scope button counts what it converts: "Convert {{count}} eligible…" / "转换 {{count}} 个可转换项…", the number in the scope line above it, so one checked mzML row no longer reads "Convert 0 selected…" beside "1 checked". The shell pill keeps PM9.2's owner-decided format with the new value | `ConversionPanel.tsx` `PlanState`; `en.ts` / `zh-CN.ts` keys `m74CnvSelected`, `m74CnvConvertSelected`, `m74CnvScopeSelectedHelp`, `conversionMembershipHelp`, `m74CnvNoticeNoConvertibleTarget` | Vitest copy; PM9.4-P1 and P3; PM9.1's context-line cases (PM9.2 L14–L16 give-way in zh-CN) |
| R2 | 7 | Bundle-complete copy. The scope line's ASCII "." is hard-coded and the en help depends on leading spaces, so zh renders "…排除 1 项（不可转换）.范围包含…". zh `conversionMembershipHelp` quotes the English label. zh `m74CnvDiagnosticsExplanation` drops "JSON" and "known paths and internal identifiers are removed". Punctuation moves into the bundles, and the zh strings say what the en ones say | `ConversionPanel.tsx`; both bundles | Vitest; PM9.4-P8 zh frames |
| R3 | 3 | With no usable backend, the plan does not say MSCanvas "does not yet know" what the installation can convert: that implies waiting. Where the configuration is `unavailableForBinding` or the start is refused for the backend itself (unavailable or quarantined), the pending plan says there is no conversion to describe without a usable ProteoWizard backend | `ConversionPanel.tsx` `PlanPending`; bundles | Vitest; PM9.4-P2 |
| R4 | 1 | The review shows compression in words ("zlib" → the settings' own label), read from the plan's intent like the other axes, not the raw `summary.compression` string | `ConversionPanel.tsx` review list | Vitest |
| R5 | 1, 2 | The review leads to the action. Order: scope, then settings, then destination and conflict, then the reviewed summary (or the pending sentence), then Convert. Today the destination and conflict fieldsets sit between the summary and Convert, and the settings sit above the scope. While a queue is on screen this block is headed "Next conversion" / "下一次转换", so a draft cannot be read as part of the queue. While a queue runs, the block, settings included, is not rendered; a settings refusal is then withdrawn from the notices with its control | `ConversionPanel.tsx` | Vitest (DOM order, heading, settings withdrawn while running); PM9.4-P3, P4 |
| R6 | 3 | A refused Convert follows UI-24's accepted rule. It uses `aria-disabled`, not native `disabled`; it gives up the accent and stays a Tab stop; its reason is reachable through `aria-describedby`. Pressing it sends nothing. Every "wait until enabled" in tests now waits for the absence of `aria-disabled`, so none passes vacuously. The post-picker focus return stops reading `button.disabled` | `ConversionPanel.tsx`; `test/conversionPanelInteractions.ts` and affected tests | Vitest (refused press sends no `begin`); PM9.4-P1, P2 |
| R7 | 3 | One filled primary per state. A terminal queue that offers its outputs shows Add converted outputs as the primary, and the next conversion's Convert as secondary (`repeating` is passed today and unused) | `ConversionPanel.tsx` `PlanState` | Vitest; PM9.4-P6 |
| R8 | 5 | Retry names its targets. On a completed queue with failures, each failed row says whether the rerun will retry it, from the item's own `retryable`, which Rust sends and nothing renders today. The retry-scope sentence is visible, not visually hidden | `ConversionPanel.tsx` `QueueState`; bundles | Vitest; PM9.4-P6 (one `retry_workspace_conversion_queue {}`) |
| R9 | 5 | A stopped queue, or a completed one holding cancelled, not-run or user-skipped rows, says what to do: those rows are converted again as a new queue from the checked rows below. The `queue-not-retryable` notice that said this is unreachable today. One sentence, not a second one beside it | `ConversionPanel.tsx`; bundles | Vitest; PM9.4-P7 |
| R10 | 4 | A rerun under way is named. While `queue.retryRound > 0` the running sentence says it is a rerun of the earlier failures, not a first run | `ConversionPanel.tsx`; bundles | Vitest; PM9.4-P5 |
| R11 | 7 | Focus continuity. When the control a keyboard user pressed leaves the document, focus goes to the queue's status line, a stable `tabIndex=-1` target, never into the roster or the plan. This covers Convert, Retry, Stop queue and a queue settling. A control left mounted while its own request runs uses `aria-disabled` and its activation guard rather than native `disabled`, which Chromium's focus fix-up drops: Stop this file, Skip, Add converted outputs, Stop queue. `ConversionStop.test.tsx`'s body-focus assertion is replaced by the stronger one, recorded as such | `ConversionPanel.tsx` | Vitest; PM9.4-P3, P4 and P6 with real key presses in Chrome |
| R12 | 7 | Rendered at the anchors, en and zh-CN. At 960×640 the review and Convert are reached by a real wheel inside the surface's scroll owner and by Tab, with Convert on screen when focused. The conversion surface's link buttons and disclosure summaries meet the 32 px compact-control minimum (DESIGN_SYSTEM), or are fixed in CSS | `app.css` (only if a measured target fails) | PM9.4-P8 |

### Verified, not defects

| ID | Checked | Result |
| --- | --- | --- |
| V1 | Can "Nothing was converted" sit beside a finalized row's Open file? | No. Rust finalizes set members only in a partial publication, which sets `partial` (`src-tauri/src/preview/tests/output_opening.rs`, `a_partial_set_member_opens_by_its_own_identity_without_becoming_adoptable`), so the panel says "no complete output set". No change |
| V2 | Progress invented? | No. Item counts only; no percentage, ETA, timer or progress bar (CNV-D8). Asserted again in PM9.4-P4 |
| V3 | Commands bind the right identities? | Yes, per §2. Asserted in the browser for every command-producing action. Limit: the harness ledger records `args` only, so the document-authority header is not asserted there |

### Optional, recorded and not done

- **O1.** A set row repeats each finalized name in its member list and again
  in its open group.
- **O2.** Excluded (mzML) rows are counted but not named.
- **O3.** One fact says two or three sentences: no target (the notice and the
  pending sentence) and capacity (three sentences).
- **O4.** The shared request-error banner sits at the panel's top, names no
  action and is `role=status`.
- **O5.** "…" on Convert for destinations that open no picker.
- **O6.** The review explains Stop and Skip before any exist.
- **O7.** `validationMode` is not rendered; it is always output-only today
  because Rust hardcodes it.
- **O8.** Add, Diagnostics and staging cleanup are refused without a reason
  while another lane action runs.

### Future, or another owner's

- **F1.** Retry binds no `operationId`: a Rust/DTO change.
- **F2.** Opening a converted file in the viewer without adopting it, or
  adopting one output at a time: new capability.
- **F3.** Adopted outputs join conversion membership.
  - This is the roster's import default (M6.9/M7.2).
  - Changing it is the owner's decision.
- **F4.** Two shell items, both closed with PM9.2 and recorded only:
  - the header dot says "Work in progress" during an adoption;
  - the scope pill describes the next conversion while a queue runs.

## 4. File closure

- **Production:**
  - `apps/desktop/src/features/mzml-preview/ConversionPanel.tsx`;
  - `apps/desktop/src/features/preferences/locales/en.ts` and `zh-CN.ts`
    (and `i18n.ts` only if a new key takes parameters);
  - `apps/desktop/src/app/app.css`, only for R12 or for the minimal styles of
    the R5 heading and the R8 markers.
- **Unit and component tests:**
  - `features/mzml-preview/`: `ConversionPanel.test.tsx`,
    `conversionPlanLifecycle.test.tsx`, `conversionScopeInteractions.test.tsx`,
    `ConversionStop.test.tsx`, `ConversionAdoption.test.tsx`,
    `ConversionOutputSet.test.tsx`, `conversionLaneAuthority.test.tsx`;
  - `app/M74ConversionComposition.test.tsx`;
  - `features/workbench/shellContext.test.ts`;
  - `test/conversionPanelInteractions.ts`;
  - others only where a run shows they read changed copy or structure.
- **Browser tests:**
  - new: `e2e/specs/pm9.4-conversion.browser.e2e.ts` and
    `e2e/support/conversion.ts` (the shared Conversion opener);
  - repaired: `e2e/specs/m6.1`, `m6.4`, `m6.6`, `m6.7`, `m6.8` and
    `m6.9-*.browser.e2e.ts`.
- **Documents:**
  - this file, `slices.md` and the baseline;
  - `docs/product/PRIMARY_WORKFLOWS.md`, `FEATURE_CATALOG.md` and
    `docs/ux/M6_7_CONVERSION_SCOPE.md`, for R1's vocabulary, each with a
    dated note;
  - `docs/ux/DESIGN_SYSTEM.md`'s conversion paragraph.

No Rust, DTO, schema, manifest, lock, workflow or runtime path.

## 5. Not in this slice

- No new command, fact or capability. No backend start, provider, native or
  Cargo run.
- Excluded behaviours: overwrite, presets, row removal from a running queue,
  pause or resume, retrying a stopped queue, percentage or ETA, automatic
  adoption or preview, and a separate review page (rejected by M6.7).
- No change to membership, scope or order semantics, to the shipped
  destination default (custom folder), or to the conflict default (Fail).
- Not reopened: the shell and viewer (PM9.2, PM9.3, baseline §12).

## 6. Legacy browser specs (PM9.4's load, baseline §2)

They have never passed setup on the current shell. Static diagnosis, by the
readers:

- the obsolete `li.dataset-row` selector;
- a row click no longer sets membership (M7.2: checkboxes only);
- the Conversion surface is hidden until navigated to.

**Repair order:**

1. **The shared opener** (`e2e/support/conversion.ts`). It checks each member
   through its checkbox, navigates by the Conversion label and waits for
   `#workbench-conversion`. It fails fast rather than spending 60 s per test.
   Validated first by one representative diagnostic, m6.7, before any
   production change.
2. **m6.8:** build its items with `queueItem()`. Its own item builder leaves
   out `stagingRecovery`, `finalizedOutputs` and `stopRequested`, and the
   panel crashes on them. This is not null-guarded.
3. **m6.9:** the opener.
4. **m6.7:** checkbox membership instead of row clicks.
5. **m6.6:** the opener, then open the bound-details disclosure before
   reading it.
6. **m6.1:** the opener. Its sidebar-containment assertion is superseded by
   M7.2's separate surface; it measures inside `#workbench-conversion`
   instead.
7. **m6.4**, the largest: the opener, then Advanced. Point the axis helpers
   at `[data-axis] input[value]`, and replace three `useId`-minted ids with
   class or `aria-describedby` lookups.

**Rules for every spec:**

- Scope `button.primary-button` to `.conversion-plan`, because Add converted
  outputs precedes it.
- Assertions that PM9.4 changes are updated against their named replacement
  (R1's copy, R6's `aria-disabled`).
- No rejection case is put on a held command. Releasing a hold ignores
  `__reject` and resolves an unmocked command as `undefined`. The harness is
  not changed; this is recorded as a limit.

A spec whose repair does not fit is the unfreeze condition (baseline §13). It
is not moved silently.

## 7. Tests

**Vitest.** Existing files are updated where R1–R11 change copy, structure or
focus. New cases:

- a refused Convert, pressed, sends no `begin`;
- the next-conversion heading, and its absence while idle;
- settings withdrawn while running;
- retry markers per failed row, with the visible scope sentence;
- the stopped-queue recovery sentence;
- the rerun sentence;
- focus to the status line after Stop queue, Convert and Retry.

**PM9.4 browser spec** (`pm9.4-conversion.browser.e2e.ts`):

- Real production React over Vite in Chrome, with only the IPC boundary
  replaced.
- `describe_workspace_conversion_queue` is answered by echoing the question.
- Queue transitions are answered with higher `sequence` reads of the existing
  slot shapes.
- Unknown commands reject.

| Case | State | Asserts |
| --- | --- | --- |
| P1 | No eligible input: one checked mzML row | R1 copy; Convert refused (`aria-disabled`, no accent, focusable by Tab, reason reachable); Enter and click send no `begin` |
| P2 | Provider unavailable | R3's sentence; Convert refused; no settings-read loop; no `begin` |
| P3 | Review → start, two vendor rows | R5 order and single primary; R4 label. Enter on Convert sends exactly one `begin` with the reviewed handles in order, the intent, both policies and the receipt, then one `choose {reservationId}`. Focus lands on the queue status. Settings are withdrawn while running |
| P4 | Running, then navigation and Stop queue | The trip Workbench → Project → Conversion issues only read-only projections, never `begin`, `choose`, `stop`, `cancel`, `skip`, `retry`, `adopt`, `open`, `describe` or `read_conversion_configuration`. No percentage or ETA. Stop queue by keyboard sends one `stop {operationId}`; focus goes to the status |
| P5 | Rerun under way (`retryRound` 1) | R10 sentence |
| P6 | Completed with a finalized row, a retryable failure and a non-retryable failure | R7: one filled primary. R8 markers and visible scope. Open file sends `{outputId, action}`; Add sends `{operationId}`; Retry by keyboard sends one `retry {}`, and focus goes to the status |
| P7 | Stopped with cancelled and not-run rows | R9 sentence; no Retry; Add still offered |
| P8 | Review and P6's terminal state at 1920×1080, 1366×768 and 960×640, en and zh-CN; review in en at 1280×720, 1536×864 and 2560×1440 | Each frame records the CSS viewport, inner size, the surface's width, DPR and Chrome; page language; overflow ≤ 1 px; no console entry. At 960×640, a CDP wheel inside `#workbench-conversion` and Tab reach Convert. Control heights on the surface (R12). Screenshots |

## 8. Validation groups (frozen before any run)

**Admission.** Each heavy group is admitted on its own reading:

- 6 GiB free or more, and 85% used or less;
- inside a group, no further heavy command below 4 GiB free or at 90% used or
  more;
- a refused group is not started under another group's name;
- no waiting or polling: on refusal, stop at that group;
- foreground, serial, one browser session at a time.

Vitest runs as `pnpm exec vitest run --maxWorkers=1 --no-file-parallelism
<files>` from `apps/desktop`.

| Group | Content | When |
| --- | --- | --- |
| S0 | `pnpm e2e:typecheck` | After the test-only commit, before G0 |
| G0 | Before-run, on unchanged production: the PM9.4 spec (expected RED on R1, R3 and R5–R11; the frames are the before evidence), then the m6.7 diagnostic | Before production changes |
| D1… | Affected Vitest files during development, named as run | During implementation |
| S1 | `pnpm typecheck` (also `pnpm lint`: both are `tsc -b`), `pnpm e2e:typecheck` | Final candidate |
| U1 | Full Vitest, bounded workers | Final candidate |
| B0 | `pnpm build` | Final candidate |
| G1 | PM9.4 spec | Final candidate |
| G2 | m6.1, m6.4, m6.6, m6.7, m6.8, m6.9, serially | Final candidate |
| G3 | Consumers: PM9.1 whole (it reads the scope wording, UI-42 and B6), then m7.4-conversion-figures | Final candidate |
| — | `python scripts/check_repo.py`, `git diff --check`, manifest and lock comparison | Final candidate, light |

PM9.3 and the viewer specs are not rerun unless a shared input changes. The
native and Tauri specs are not run.

## 9. Evidence boundaries

- Browser evidence is the real frontend over a controlled IPC boundary. It is
  not ProteoWizard, not a file conversion, not output publication, not native
  WebView2 at 150 % and not a screen reader.
- A simulated queue is frontend contract evidence. U4's live-provider check
  stays `BLOCKED_PROVIDER_HOLD` with the qualification after PM9.7.

## 10. Record

Filled at closure. Progress so far, with the evidence it rests on:

**2026-10-04, checkpoint 1 (resource deferral).**

- **Before evidence.** Taken on unchanged production (`b7b8eeb`'s), at test
  commit `4248107` (tree `93d1bdb`). Records are under `test-results/pm9.4/`,
  git-ignored; each group's `*.meta.txt` holds its reading, HEAD, tree and
  process tree.
  - S0: `pnpm e2e:typecheck`, exit 0.
  - G0a: the PM9.4 spec, 0 of 9. Every failure is a finding's RED:
    - P1 at R1 (the scope label said "selected rows");
    - P2 at R3;
    - P3 at R5's order;
    - P4 only at R11 (focus after Stop queue). Its navigation trip issued no
      work command, so V3 already held.
    - P5 and P7 at their missing resources (R10, R9);
    - P6 at R7 (two filled primaries);
    - P8 at R7, and at R12's row Details summaries, measured at 19.4 px.
    - Already true before: 960×640 reach of Convert by wheel and by Tab, no
      overflow, and no estimate.
  - G0b: m6.7, 7 of 7, with the shared opener alone. It confirms the static
    diagnosis: the m6.x failures were setup, not product.
- **Done since, not yet compiled or run.**
  - Production: R1–R12, plus the Basic/Advanced view kept by the panel so
    that it survives the settings leaving while a queue runs.
  - Unit tests:
    - mechanical copy and `aria-disabled` updates;
    - `ConversionStop`'s body-focus assertion replaced by the status-line one
      (R11);
    - the new `ConversionJourney.test.tsx`.
  - Legacy specs: m6.1, m6.4, m6.6, m6.8 and m6.9 repaired statically, per §6.
  - Product notes: PRIMARY_WORKFLOWS, M6.7 and DESIGN_SYSTEM.
- **Deferred.** D1 (`pnpm typecheck`) was refused at admission twice: 1.92 GiB
  free and 93.9% used at 03:07:03, then 3.45 GiB and 89.1% at 03:14:41. No
  later group started.

**2026-10-04, the review and correction cycle 1, both static.**

- **The review.** One independent reviewer, read-only, read the snapshot
  `60ed557`: slice-04 §3 and `git diff 5f3caf5 60ed557 -- apps e2e`. It ran
  nothing. Verdict NO-GO, with six confirmed findings:
  - **F1, high.** The scope line passed an empty `note` parameter whenever
    nothing was excluded. `bindUiMessages` rejects empty parameters
    (`RESOURCE_PARAMETERS`), and with no error boundary the app would blank at
    start.
  - **F2, medium.** R11's guard missed the starting window of a press made
    under a finished queue. Focusing the status line there cancelled the custom
    picker's return to Convert.
  - **F3, medium.** Stale `selected` copy and `toBeDisabled`/`toBeEnabled` on
    Convert. Most were already fixed after the snapshot (`d0bb5ff`); three
    remained.
  - **F4, low/medium.** The surface's link buttons were neither sized nor
    measured (R12).
  - **F5, low.** The refused-press tests had no current plan, so they could not
    reach the new guard.
  - **F6, low.** Copy and markup:
    - (a) the no-target notice under All;
    - (b) "check them" with the converted rows still checked;
    - (c) markers and "below" while an adoption or export holds the panel;
    - (d) a name on a generic `div`;
    - (e) zero filled primaries while Add is refused;
    - (f) plan-side links handing focus to the old queue's status.
- **Refuted by the reviewer**, each from the code:
  - the convert-again sentence on a stop-failed queue (its session is always
    quarantined);
  - markers when quarantined or stopped;
  - notice ownership;
  - the settings refusal while busy;
  - every command identity;
  - described-by targets and duplicate ids;
  - the numeric i18n parameters;
  - the replaced focus assertion as a weakening;
  - a weakened product assertion in any m6.x repair.
- **Correction cycle 1** (the first of two authorized) fixes F1–F6:
  - F1: the excluded note joins the counts, so no parameter is ever empty.
  - F2: the guard also covers `converting`, plus a Vitest case for the
    picker cancelled under a finished queue.
  - F3: the three remaining assertions.
  - F4: `.conversion-panel .link-button` at 32 px, plus P4 asserting the
    running frame's control heights.
  - F5: a Vitest case where a reviewed Convert is refused by a backend check.
  - F6: (a) scope-neutral notice copy; (b) "check only those rows"; (c) gated
    on `!busy`; (d) `role="group"`; (e) keyed on `canAdopt`; (f) only Convert
    and the queue's own controls are recorded.
  - Still not compiled or run.

**Resume, in order, each on its own admission:**

1. D1, `pnpm typecheck`.
2. D2, the affected Vitest files, bounded workers. Fix what they show, test
   side first.
3. The single review.
4. S1, U1, B0, G1, G2 and G3, as in §8.
