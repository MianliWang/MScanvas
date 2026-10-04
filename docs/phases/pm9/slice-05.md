# PM9.5 — targeted-MS1 journey: request, review, run, stop, result entry

PM9 | Acceptance: U5, U7 (drafts), U9, U10 | Depends on: PM9.2; after PM9.4 | Serial, one writer
Status: **IN PROGRESS** (expanded 2026-10-04 from the code of the starting
point below). The midpoint check is not repeated; nothing here unfreezes the
route.

## 0. Starting point

- HEAD `df14a9b2376aed60c75c2ac35c4e27b2e9ec551b` (tree
  `f0894fd951198684c62e37ef6aac7239dc838475`) on
  `feat/pm9-product-convergence`. Clean worktree and index, no stash, one
  worktree; the accepted upstream `57915de` is an ancestor.
- Production is PM9.4's `55d75fb511cd530b00645374ad5edc493b44db38`; tests are
  `7e83ae4734f500cec96b1adf8dfb17062058c4f4` (tree
  `38002f26c4010309651bb151a494048d99d94d84`). Only documentation follows them.
- **Observation O0** (2026-10-04, not RED evidence): the populated targeted
  states rendered on this unchanged production by a scratch spec over the
  controlled fixture of §7 (`.tmp/pm95-observe/`, git-ignored; inputs and
  hashes in its `run/O0-observe.meta.txt`). Chrome 154.0.8037.93, headless,
  DPR 1. The findings below cite its frames and geometry, or the code where
  no frame shows them.

## 1. Goal

Before pressing Run, a reader knows which acquisitions the request is for,
which ordered targets and parameters will run, what the recipe cannot do, and
why a request cannot proceed. While it runs they can follow and stop it. When
it ends they know how each acquisition ended and reach the existing run or
result. Frontend convergence of the M9.1–M9.4 recipe; no new science.

Contract verified in the code (M9 closure §3): positive-mode, centroided MS1,
`[M+H]+`, 1–200 targets per plan in typed order, 2–16 distinct acquisitions
per batch run one after another, each its own plan, run and result.

## 2. Read first

- `brief.md` (U5, U7, U9, U10; locked decisions; not-in-PM9 list), this file.
- `docs/product/M9_1_TARGETED_MS1_HANDOFF.md` (M9.1 record),
  `M9_4_TARGETED_MS1_BATCH.md`, `M9_CLOSURE.md` §3.
- Code: `apps/desktop/src/features/project/TargetedMs1.tsx`
  (`TargetedMs1Setup`, `PlanReview`, `BatchReview`, `BatchProgress`),
  `useProject.ts`, `ProjectPanel.tsx`, `projectApi.ts`, `project.css`.
- Tests: `TargetedMs1.test.tsx`, `TargetedMs1Batch.test.tsx`,
  `e2e/specs/m9.1-targeted-ms1.browser.e2e.ts`,
  `m9.4-targeted-ms1-batch.browser.e2e.ts`, `e2e/support/pm9Scenarios.ts`.

## 3. Owners and action classes

Read from the starting point. Classes: P presentation, D local draft, R
existing read or review projection, W starts or cancels domain work.

| Fact or action | Owner | Class |
| --- | --- | --- |
| Which layer opened the setup; the setup open in which project | `ProjectPanel` `targeted` (`projectId`, `layerId`) | P |
| Typed targets, m/z half-width, peak width | `TargetedMs1Setup` local state (lost on close and re-target today) | D |
| Chosen acquisitions, in the project's layer order | `TargetedMs1Setup` `chosen`, `members` | D |
| Line numbers of typed targets; an over-full line | `parseTargets` (splits only; judges nothing) | D |
| Review: plan, problems by row, `blocked`; batch members with `refused`/`blocked` | `resolve_targeted_ms1_plan` / `resolve_targeted_ms1_batch` through `useProject.reviewTargetedMs1(Batch)`; Rust holds the reviewed plans as pending | R |
| A review refused as a whole (`recipeSourceUnsupported`, `batchSizeOutOfRange`, `batchDuplicateInput`, `unknownRecord`, `staleDocument`) | `useProject` `problem` | R |
| Start | `begin_project_job` → `run_targeted_ms1 {operationId, planSha256}` or `run_targeted_ms1_batch {operationId, planSha256s}`; a refusal before any run exists comes back as `problem` | W |
| Progress: phase; batch members' states | `get_targeted_ms1_progress`, polled while `busy === "analysing"`; never settles the project | R |
| Stop | `cancel_project_job {operationId}` of the accepted operation; the answer is not read | W |
| How a single run ended | `useProject` `lastTargetedRun` (`runId`, `outcome`, `artifactId`) | R |
| How a batch ended | `useProject` `lastTargetedBatch` (session only; never-started members exist only here) | R |
| Open result / Show run | `session.inspect({kind: "artifact" \| "run"})` → report in the main region, run in Details | P |
| Re-run of a reviewed plan | the same start commands; Rust runs a pending or recorded plan again as a new run | W |

The page creates no plan, no readiness model and no queue.

## 4. Findings and acceptance

A finite list, frozen before implementation. **R** rows are required by the
dispatch's outcomes; **V** were checked and are not defects; **O** are optional
and not done; **F** belong to a future capability or another owner.

### Required

| ID | Outcome | Criterion | Grounding (O0 or code) | Owning code | Evidence |
| --- | --- | --- | --- | --- | --- |
| R1 | Input identity | The setup's choice is named as its own: "Acquisitions to analyse", and its help says the choice is separate from the Workbench's highlighted and checked rows | O0 `en-1366-01`: the roster panel "Acquisitions" with checkboxes beside a fieldset "Acquisitions" with checkboxes | `en.ts`/`zh-CN.ts` | Vitest copy; PM9.5-T1 |
| R2 | Input identity | The targets field states its format and its limit: one target per line, at most 200 | Code: the limit appears only in the `tooMany` problem | bundles | Vitest copy |
| R3 | Review and start | The review leads to Run. Order: request → Review plan → the review (problems first; then the acquisition, the ordered targets with their count and the two parameters; for a batch, the independence statement and every member's readiness; then engine, profile and digests; then a blocked plan's reason) → Run → progress or ending. The review has a heading and is brought into view in the surface's scroll owner when it answers. Its tables scroll inside themselves, so 200 targets or 16 members never push Run out of reach | O0 `*-03-problems`: after Review, problems at y 852 against a viewport bottom of 752 (1366×768), 662/624 (960×640), 1109/1064 (1920×1080); Run above the review in every frame; engine facts before problems (`03b`) | `TargetedMs1.tsx` setup, `PlanReview`, `BatchReview`, `TargetsTable`; `project.css` | Vitest DOM order; PM9.5-T1, T2, T9 (200 targets, 16 members) |
| R4 | Review and start | A refused Review or Run says why, for its actual state. Run counts what it would run ("Run" / "Run N analyses") from the chosen acquisitions. Run's reason: not reviewed; the request changed after its review; problems to fix; a blocked plan's own sentence (its `aria-describedby`); a batch member not ready. Review's reason: no acquisition chosen; no target typed. Both stay Tab stops (`aria-disabled`); click, Enter and Space send nothing | O0 `*-04-blocked`: a plan blocked by `recipeUnavailable` beside "Review a plan without problems first."; `batch-01`: "Run" with three chosen; code: Review is refused with no description | setup | Vitest; PM9.5-T2, T3, T6 |
| R5 | Review and start | A refusal of the setup's own review or run is said in the setup, beside the action refused, in the refusal's words; an edit withdraws it. The surface's problem line stays | Code: only `data-project-problem` at the top of the surface says it, off screen at Run's position (O0 `-06`: the busy line at y −574) | `useProject` (`problemDuring`), setup | Vitest; PM9.5-T6 |
| R6 | Progress | While any project operation is out, the setup says so beside the controls it holds, and that sentence is their reason (Review, Run, Close). A single run is followed in the setup: a "Run in progress" block with the phase and a Cancel run control naming the accepted operation | O0 `-06-running`: busy line and Cancel at y −574/−566 with Run at 220; code: Close refused with no reason | setup, `ProjectPanel` (busy sentence passed down) | Vitest; PM9.5-T1, T5 |
| R7 | Stopping | Stop requested versus ended, from one session fact: after a press, every stop control of that operation (Cancel run, Stop batch, the busy line's control during a targeted run) reads "Stop requested…" and takes no second press; what ended is said only from the answer (cancelled, not started, or completed after all) | Code: `BatchProgress` keeps `stopping` local to its own button; the busy line's control never changes | `useProject` (`stopRequested`), setup, `ProjectPanel` | Vitest; PM9.5-T5 |
| R8 | Terminal entry | When a run or batch ends, the setup says how, without claiming more than it knows, and offers the existing entry. Single: completed → Open result as the one filled primary; failed or cancelled → Show run. Run then reads "Run again" / "Run N analyses again" as a secondary control, with its consequence: the same reviewed plans run again as new runs, completed ones included; to run only some, untick the others and review again. Ended blocks belong to the setup that started them: a draft edit withdraws only the review, never the ending (never-started members exist nowhere else) | O0 `-07-completed`: Run a filled primary again and "Its result is shown below", true only when the result opened on arrival (`inspectingNow === pressedWhile`); `batch-05`: "Run 3 analyses" a filled primary after a stopped batch; code: `forget()` clears `ranBatch`, and the single note is filtered by the chosen acquisitions | setup, `BatchProgress`, `useProject` (`lastTargetedRun` reset at start) | Vitest; PM9.5-T1, T4, T5 |
| R9 | Interaction | Focus continuity. A review's answer takes the keyboard from Review plan to the review's heading; Run takes it to the run or batch block's heading; a stop control that leaves the document hands focus to that block's heading, never to `body`; Open result takes it to the report's heading | O0 `batch-05`: focus on `body` after the batch ended | setup, `BatchProgress` | Vitest; PM9.5-T1, T5, T8 with real keys |
| R10 | Input identity | A problem's line leads back to it: on a target row, "Line N" is a control that moves the keyboard into the targets field with that line selected | Reading: problem rows are text; a 200-line field has no line numbers | `ProblemsTable`, setup | Vitest; PM9.5-T2 |
| R11 | Drafts (U7) | The typed targets and both parameters survive closing and reopening the setup and opening it from another row, in the same project. The chosen acquisitions reset to the opening layer, and no review survives. A project replaced (New, Open, Close) closes the setup and discards the draft, also when the same project is opened again | Reading: `key={targetedLayer.id}` remounts and drops local state; `targeted` survives a close and reopen of the same project | `ProjectPanel`, setup | Vitest; PM9.5-T7 |
| R12 | Presentation | Rendered at 960×640, 1366×768 and 1920×1080 in en and zh-CN with long names, plus 1280×720, 1536×864 and 2560×1440 for the review and the batch ending: no overflow; the setup's link controls and summaries at least 32 px; a batch member's action on one line; at most one filled primary per state; at 960×640 Run reached by a real wheel inside `#workbench-project` and by Tab, on screen when focused | O0 `batch-05`: "Open result" wraps onto two lines at 1366×768; code: `.link-button` has no minimum height in the setup | `project.css` | PM9.5-T9 |

### Verified, not defects

| ID | Checked | Result |
| --- | --- | --- |
| V1 | Plan identity and order | The setup sends the typed cells (trimmed) and the parameters exactly as typed; tables show Rust's plan in Rust's order; nothing is sorted, deduplicated or relabelled. Unchanged |
| V2 | Batch readiness | `batchRunnable`: no problem, at least two members, every member a plan with no refusal and no block. Members in the project's layer order. Unchanged |
| V3 | Invented progress | None: phase words and member counts only; no percentage, ETA or elapsed time. Asserted in PM9.5-T4 and T5 |
| V4 | Member results while a batch runs | Not offered until it ends (M9.4 rule). Kept |
| V5 | Fabricated runs | A never-started or refused member has no run and no Show run. Kept |
| V6 | Late answers | Inputs are held during a review or run; a review answering a closed setup is dropped; a run's result is inspected on arrival only if the reader has not moved |
| V7 | Failure as absence | Run failures are their own sentences; row outcomes exist only in a completed result; the batch panel shows execution states only |

### Optional, recorded and not done

- **O1.** The recipe paragraph runs to about eight lines at 1366×768; a list
  with the read path in a disclosure would shorten the first screen.
- **O2.** Show run below 1700 px puts the run in folded Details; the way back
  is the existing "Show Details" hint at the top of the surface, not a copy
  of it beside the press.
- **O3.** The setup's heading has the weight of every project section heading.
- **O4.** The busy line's Cancel for a links check, a capture or an admission
  keeps no "requested" state (R7 covers the targeted run only).

### Future, or another owner's

- **F1.** "Outside the allowed range" names the field, not the range. The
  ranges are Rust's (M9 closure §3.1) and are not in the review projection;
  stating them needs a read-only projection, which this dispatch does not
  authorize.
- **F2.** The report, its rows, evidence, exports, history and reopen: PM9.6.
- **F3.** Drafts across sessions, file import, presets, continuing a stopped
  batch, automatic retry: excluded.

## 5. Acceptance in three layers

- **True (observable):** R1–R12 in the rendered app, both languages; the
  single and batch paths, refusals, stop, failure and result entry.
- **Exists:** the setup's review heading and status line, the run block,
  `problemDuring` and `stopRequested` on the session, the lifted draft, the
  bounded review tables, the new bundle keys in both languages, the
  `targetedTask` manual scenario.
- **Wired:** request → `resolve_*` once per press with the typed text; Run →
  `begin_project_job` then one `run_*` with the reviewed digests; Cancel run
  and Stop batch → one `cancel_project_job {operationId}`; Open result and
  Show run → `inspect` only; navigation → read-only projections only.

## 6. File closure

- **Production:**
  - `apps/desktop/src/features/project/TargetedMs1.tsx`, `ProjectPanel.tsx`,
    `useProject.ts`, `project.css`;
  - `apps/desktop/src/features/preferences/locales/en.ts`, `zh-CN.ts`, and
    `i18n.ts` for parameterized keys.
- **Tests:**
  - `features/project/TargetedMs1.test.tsx`, `TargetedMs1Batch.test.tsx`; others
    only where a run shows they read changed copy or structure;
  - new `e2e/specs/pm9.5-targeted-ms1.browser.e2e.ts` and
    `e2e/support/targeted.ts`;
  - `e2e/support/pm9Scenarios.ts` gains the browser-only `targetedTask`
    scenario (existing cases unchanged);
  - `m9.1` and `m9.4` browser specs: test-authoring repairs for the new order
    and copy, logged separately from correction cycles.
- **Documents:** this file, `slices.md`, the baseline, `e2e/README.md` (manual
  entry), `docs/product/M9_4_TARGETED_MS1_BATCH.md` and
  `M9_1_TARGETED_MS1_HANDOFF.md` with dated notes where current behaviour
  changes.

No Rust, DTO, schema, persistence, dependency, lock, workflow or runtime path.

## 7. Not in this slice

- No new command, fact, algorithm, adduct, polarity, profile support, XIC,
  comparison, normalization, matching, preset, persistence, import, automatic
  retry, partial batch continue or concurrency.
- No second validator: the page still judges no value.
- No redesign of the report, Details or history (PM9.6); the handoff is kept
  and tested only.
- Not reopened: PM9.4, the 42-row rework, the midpoint.

## 8. Manual entry

`pnpm qa:pm9:manual` with `MSCANVAS_PM9_MANUAL_SCENARIO=targetedTask` (locale
and viewport as usual). Project → **Targeted MS1…** on a layer → type targets
→ Review plan → Run; tick more acquisitions for a batch. The answers are
fixed: a review answers the first acquisition's plan whichever row opened the
setup, a run completes at once, and a batch ends with one acquisition
completed with a target found, one failed and one completed with every target
not detected. Running and stopping states are seen in the automated frames,
not manually.

## 9. Tests

**Vitest.** Existing cases are updated where copy, order or focus changes.
New cases: R3 order; R4 reasons and refused presses; R5 a refused review and
a refused run said in the setup and withdrawn by an edit; R6 status and
Cancel run; R7 stop requested on every control, and a stop that arrives after
completion; R8 Open result / Show run / Run again, and an ending that
survives an edit; R9 focus; R10 line selection; R11 draft survival and
discard.

**PM9.5 browser spec** (`pm9.5-targeted-ms1.browser.e2e.ts`): real React over
Vite in Chrome, only the IPC boundary replaced (unknown commands reject),
answers from `e2e/support/targeted.ts`; at least one case opens through
`scenario("targetedTask")`. Rejections are never put on a held command.

| Case | Path | Asserts |
| --- | --- | --- |
| T1 | 1 single happy path, 1920×1080 en | R1, R3 order and into-view, R6, R8, R9 by keys; exactly one `resolve` with the typed text, `begin` then one `run {operationId, planSha256}`; Open result opens that artifact's report; no new execution |
| T2 | 2 invalid text → line refusal → correction → fresh review | Problems first; Line N selects that line; R4 reasons; corrected text sends a new `resolve` and a ready plan |
| T3 | 3 stale-ready after an edit or a changed choice | Review withdrawn; Run refused with the changed reason; click, Enter and Space send nothing; label counts the chosen |
| T4 | 4 independent batch, mixed ending with an all-negative member | Member states and failure sentence; the all-negative member Completed, its result's rows Not detected; Show run; R8 Run N analyses again |
| T5 | 5 stop: single and batch | R6 Cancel run; R7 requested on both controls; cancelled run with Show run; batch cancelled and not started, no run for the not-started member; focus to the block heading |
| T6 | 6 runtime unavailable and a refused review | Blocked sentence describes Run; nothing runs; `recipeSourceUnsupported` said in the setup; an edit withdraws it |
| T7 | 7 navigation and replacement while pending | A held review answered after Workbench and back lands in the setup; closed while held: nothing populates, the reopened draft is kept; Open of another project closes the setup and discards the draft; navigation sends no `resolve`, `run` or `cancel` |
| T8 | 8 keyboard | Tab path Review plan → review → Run; Space and Enter on refused controls |
| T9 | Rendered anchors, en and zh-CN | Frames of input/error, ready, batch running, batch ended and single ended at the three anchors; review and ended batch at 1280×720, 1536×864, 2560×1440; a 200-target review and a 16-member batch review at 960×640 in both languages with Run reached by wheel and Tab. Each frame records outer and inner viewport, surface and setup widths, DPR, Chrome, page language, panel state, candidate, overflow, controls under 32 px and filled primaries |

## 10. Validation groups (frozen before any run)

Admission per heavy group: 6 GiB free or more and 85% used or less; inside a
group no further heavy command below 4 GiB free or at 90% used or more; a
refused group is not renamed; no waiting; foreground, serial, one browser
session. Vitest runs as `pnpm exec vitest run --maxWorkers=1
--no-file-parallelism <files>` from `apps/desktop`.

| Group | Content | When |
| --- | --- | --- |
| S0 | `pnpm e2e:typecheck` | After the test-only commit |
| G0 | PM9.5 spec on unchanged production (RED at each case's first finding) | Before production changes |
| D… | Affected Vitest files, named as run | During implementation |
| S1 | `pnpm typecheck` (`pnpm lint` is the same `tsc -b`), `pnpm e2e:typecheck` | Final candidate |
| U1 | Full Vitest, bounded workers | Final candidate |
| B0 | `pnpm build` | Final candidate |
| G1 | PM9.5 spec | Final candidate |
| G2 | m9.1, m9.4 | Final candidate |
| G3 | PM9.1 whole (shared `pm9Scenarios.ts` and the Project surface) | Final candidate |
| — | `python scripts/check_repo.py`, `git diff --check`, scoped comparison of Rust, IPC, schema, manifests, lock and workflows | Final candidate, light |

PM9.4's spec is rerun only if a shared conversion input changes; it reads
`scenario("populated")`, which this slice leaves byte-identical.

## 11. Evidence boundaries

Browser evidence is the real frontend over a controlled IPC boundary. It is
not a real engine run, mzML consumption, plan persistence, worker
termination, output publication, native WebView2 at 150 % or a screen reader.

## 12. Record

Filled at closure.
