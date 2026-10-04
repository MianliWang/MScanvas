# PM9.5 — targeted-MS1 journey: request, review, run, stop, result entry

PM9 | Acceptance: U5, U7 (drafts), U9, U10 | Depends on: PM9.2; after PM9.4 | Serial, one writer
Status: **PM9.5 TARGETED-MS1 JOURNEY COMPLETE — FOCUSED BROWSER/RENDERED
ACCEPTANCE PASS** (2026-10-04, §12). Production `f877870`, tests `207b441`,
qualified on the documentation successor `ccb9184`, whose `apps/` and `e2e/`
equal `207b441`'s. Real-engine and native release qualification are
unchanged.
Expanded 2026-10-04 from the code of the starting point below. The midpoint
check is not repeated; nothing here unfreezes the route.

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
- **Documents:** this file, `slices.md`, the baseline, the brief's status,
  `e2e/README.md` (manual entry), and `docs/product/M9_4_TARGETED_MS1_BATCH.md`,
  `M9_1_TARGETED_MS1_HANDOFF.md` and `PRIMARY_WORKFLOWS.md` with dated notes
  where current behaviour changes.

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

**2026-10-04, checkpoint 2 (qualification, after the owner reported enough
memory).** Closed: every group of checkpoint 1's remaining list ran on the
final candidate and passed.

**Candidate.** HEAD `ccb918480bed9c40475c8f55085c6db4b138d884` (tree
`c69205780d31ef8d5886b5337c1bbd1d2037e1be`), clean. `git diff 207b441 ccb9184
-- apps e2e` is empty, so the code under test is production `f877870` and
tests `207b441`.

| Group | Result |
| --- | --- |
| Q1 `pnpm typecheck` (also `pnpm lint`: both `tsc -b`) | exit 0 |
| Q2 `TargetedMs1.test.tsx`, `TargetedMs1Batch.test.tsx` | 2 files, 73 tests |
| Q3 `pnpm e2e:typecheck` | exit 0 |
| U1 full Vitest, `--maxWorkers=1 --no-file-parallelism` | 112 files, 2251 tests (PM9.4: 2237) |
| B0 `pnpm build` | exit 0; its chunk-size warning predates PM9 (M7.2 and M7.3 logs) |
| G1 PM9.5 spec | 10 of 10 (0 of 10 in G0) |
| G2 m9.1 + m9.4 | not started: port 15273 still held a TIME_WAIT connection (owner pid 0) of G1's own closed server. Rerun as G2b on 15274: m9.1 12 of 12, m9.4 5 of 5 |
| G3 PM9.1 whole (port 15275) | 55 of 55 |
| `check_repo`, `git diff --check`, scope | pass, clean, nothing outside the frontend, tests and documents |

Each group was admitted on its own reading, between 9.24 GiB free (70.8%
used) and 7.46 GiB (76.5%), and ran alone in the foreground. Local
high-memory work ended with G3.

**Acceptance.** R1–R12: pass, each GREEN in G1 and held by Vitest.

| Finding | G1 | Vitest |
| --- | --- | --- |
| R1, R2 | T1 | the bundle values in both languages |
| R3 | T1, T2, T4; T9's 200-target and 16-member reach | order, problems first |
| R4 | T2, T3, T6, T8 | each reason; refused presses send nothing |
| R5 | T6 | review and run refusals; another operation's refusal not shown |
| R6 | T1, T5, T8 | status line, Cancel run, Close's reason |
| R7 | T5 | requested on all three controls; a stop that arrives after completion |
| R8 | T1, T4, T5 | Open result and Show run; Run again; the ending survives an edit; one filled primary beside a new request |
| R9 | T1, T5, T8 | review, run and stop hand-offs; a refused run with a held re-read |
| R10 | T2 | line selection |
| R11 | T7 | close and reopen, another row, a different-id and a same-id Open |
| R12 | T9 | — |

V1–V7 hold. O1–O4 and F1–F3 stay as §4 records them, F1 needing a read-only
projection of the bounds that this dispatch did not authorize.

**Rendered evidence** (`.tmp/pm95-runs/G1/browser-3HkrFs/`, git-ignored).

- **Frames.** 53, from Chrome 154.0.8037.93 headless at DPR 1. Each records
  the CSS and outer viewport, the surface's and the setup's widths, the page
  language, the roster and Details state, and the candidate
  (`ccb9184`).
- **Coverage.** Input/error, ready, batch running, batch ended and single
  ended at 1920×1080, 1366×768 and 960×640, in en and zh-CN. The review and
  the ended batch at 1280×720, 1536×864 and 2560×1440. The 200-target and
  16-member reviews at 960×640 in both languages.
- **Judged in every frame:**
  - overflow ≤ 1 px;
  - no estimate;
  - the expected number of filled primaries;
  - no setup control under 32 px;
  - one-line batch actions;
  - no console entry.

  At 960×640, Run is reached by a real wheel over the surface's own margin and
  by Tab, and is on screen when focused.
- **Before evidence.** O0's frames over the same fixture
  (`.tmp/pm95-observe/out/`) and G0's failure frames.
- **The manual entry** is §8's; it was not used for acceptance.

**Process custody, checkpoint 2.**

- Every group recorded each launched process's PID, creation time, command and
  parent, and every launched tree ended.
- G3's runner listed one leftover, AppleMobileDeviceProcess.exe pid 2472. It
  was a false match:
  - it was created at 07:34:42, eleven hours before the group;
  - its parent pid had been reused by a process of the group's tree.

  It was left untouched. The scratch runner now admits only descendants
  created after its launch.
- Chrome again woke Google Updater as its child, and Updater had ended.
- Nothing was killed by name or port.

**Remaining, outside this slice.**

- A real engine run, mzML consumption, plan persistence, worker termination
  and output publication are M9's evidence, unchanged.
- Native WebView2 at the host's 150 % and the provider-positive route belong
  to the qualification after PM9.7.
- Announcements are DOM live-region traces, not screen-reader audio.
- PM9.1's J1–J6 on `d56b17b` is still due before PM9.7.
- PM9.6 owns the report, history, exports and reopen.

**2026-10-04, checkpoint 1 (resource deferral).** Superseded by checkpoint 2;
kept as it was found. Everything below is what existed then and what it rested
on.

**Identities.**

| What | Commit | Tree |
| --- | --- | --- |
| Start | `df14a9b2376aed60c75c2ac35c4e27b2e9ec551b` | `f0894fd951198684c62e37ef6aac7239dc838475` |
| This expansion | `28624d4` | — |
| Spec, fixture and manual scenario (test-only) | `2c4d5365abd5aa77f1920b1864b5c92408e8432a` | `b33a8cad998b6233291f5afc2559f1b4431bbdbd` |
| Production | `bcb7474`, then cycle 1 `f877870` | — |
| Tests | `435e3c9`, then cycle 1 `207b441ac32dcf20f962b30f11c448724b96292d` | `36150ba77ed1ed3b0bd86934707741eac79b7eb4` |

**Changed paths** (`df14a9b..207b441`), frontend, tests and this file only:
`TargetedMs1.tsx`, `ProjectPanel.tsx`, `useProject.ts`, `project.css`,
`en.ts`, `zh-CN.ts`, `i18n.ts`; `TargetedMs1.test.tsx`,
`TargetedMs1Batch.test.tsx`; `e2e/specs/pm9.5-targeted-ms1.browser.e2e.ts`,
`e2e/support/targeted.ts`, `e2e/support/pm9Scenarios.ts` (one new scenario,
existing cases unchanged), `e2e/specs/m9.4-targeted-ms1-batch.browser.e2e.ts`
(one test-authoring line), `e2e/README.md`. No Rust, `projectApi.ts`, schema,
manifest, lock or workflow path (scoped `git diff`, 2026-10-04).

**Findings.** R1–R12 are implemented as §4 states them. One independent
focused review (read-only, after `435e3c9`) found no blocker, three should-fix
items and one minor item, all applied as **correction cycle 1**
(`f877870`, `207b441`):

1. With real timing, a run refused before it existed dropped focus to `body`:
   the refusal commits while the run block is still mounted, and the block
   leaves only after the re-read. Focus is now handed over once the run has
   settled.
2. Opening another copy with the same identifiers kept the setup, its draft,
   a stale review and an ending. The session now counts replacements where it
   clears the inspection, and the surface resets on that count. An ending is
   shown only while its run is in the project.
3. A new ready request beside a completed run's Open result made two filled
   primaries. Open result yields.
4. The caption read "1 targets"; it no longer agrees in number.

The review's notes were also applied, test-only: T1's heading check is
described as what it is, and the wheel helper refuses a point over an inner
scroller. One substantive cycle is used of the two authorized.

**Evidence so far.**

| Group | Identity | Result |
| --- | --- | --- |
| O0 observation | `df14a9b` + untracked fixture (`.tmp/pm95-observe/run/O0-observe.meta.txt`) | Before frames and geometry (§4 grounding). Observation only, not RED |
| S0 e2e typecheck | `2c4d536`, clean | exit 0 |
| G0 PM9.5 spec, unchanged production | `2c4d536`, clean | 0/10, as expected |
| D1 typecheck | uncommitted, before launch | not run (the operator's own output pipe stopped the runner before launch) |
| D1b typecheck | uncommitted diff `aae606c8…` | exit 1, only the expected test reference to the removed key |
| D2 typecheck | diff `2847b414…` | exit 0 |
| D3 targeted Vitest | diff `2847b414…` | 70/71: the setup did not open, because a reset in an effect raced a first click; fixed by resetting during render |
| D4 Vitest, `features/project` + PM9 compositions | diff `7bb4ba6b…` | 11 files, 203 tests, pass |
| D5 e2e typecheck | diff `7bb4ba6b…` | exit 0 |
| D6 PM9.5 spec | diff `7bb4ba6b…` | did not run: Vite could not bind 127.0.0.1:5273 (EACCES). Another application (pid 7444, not task-owned, untouched) held 5273 as an ephemeral port; this host's dynamic range is 1024–15000. Later browser groups use `MSCANVAS_BROWSER_DEV_PORT=15273` |
| D7 PM9.5 spec | diff `7bb4ba6b…`, port 15273 | 10/10 pass, development run |
| D8 typecheck + targeted Vitest | `2c4d536` with the uncommitted tree later committed unchanged as `bcb7474` and `435e3c9` (the refused-run focus effect included) | **REFUSED at admission** (5.9 GiB free, 81.4% used) |
| C1 the same, for cycle 1 | `207b441`, clean | **REFUSED at admission** (4.97 GiB free, 84.3% used) |
| `check_repo`, `git diff --check`, scope | `207b441` | pass, clean, none outside the frontend |

D-group results are development evidence for uncommitted states, identified by
diff digest. **The committed production has no compile or test evidence at
all.** `bcb7474` added the refused-run focus effect after D7, and `f877870`
changed `useProject.ts`, `ProjectPanel.tsx`, `TargetedMs1.tsx` and both
bundles; neither has been typechecked, and no result above is inherited by
either.

**RED limit (G0).** Mocha stops a case at its first failed assertion, so on
the unchanged production G0 observed RED only at:

| Cases | First finding |
| --- | --- |
| T1–T7 and T9 (en, zh-CN) | R3: no review area (T4: the review after Run) |
| T8 | R4: the Review reason's key did not exist |

R1 and R2 are copy, held by Vitest values rather than by RED. The criteria
after each first finding rest on O0's frames and on reading.

**v5.11 comparison.** The reference was re-hashed before use:
`mscanvas_unified_demo_v5_11.html`, 490,253 bytes, SHA-256
`d09b60e0bd3225721ddf87731ec64c0577015952afc05d91290d5461b3896337` (baseline
§3). It has no Project surface; its targeted step is one node of a synthetic
multi-step method, with a configure → review → run page sequence. It was read
for task hierarchy, not rendered, and none of its science was taken.

| Aspect | v5.11 | Before (O0) | After | Disposition |
| --- | --- | --- | --- | --- |
| Path | Three pages with a stepper | One setup, Run above the review | One setup: request, Review plan, review, Run, then the run or batch | Adopted: the review leads to the action. Separate pages and the stepper are not (PM9.4's precedent; the stepper stays with PM9.7) |
| Inputs fixed for the run | Named, with a count, beside Start | Source name at the top only | "Acquisition: …" in the review; batch members in order with readiness, above Run | Adopted |
| Stale plan | "Plan invalidated" tag, Start disabled with an alert | Review removed; Run's reason generic | Review removed; Run says the request changed after its review | Adopted in substance; keeping an invalid review on screen is not |
| Run in progress | State title; Stop in the page head | Busy line and Cancel at the top of the surface | "Run in progress" block with its phase and Cancel run; busy line kept | Adopted. No task id or method version, which the projection does not have |
| Progress | Step states, N/M, a progress track, ETA | Phase sentence; member states and counts | Unchanged, plus "Stop requested…" | States and counts adopted; track and ETA not (no estimates) |
| Stopped | "Stopped" and "earlier results not overwritten" | Panel-local "Stopping…" | Requested until answered; cancelled and not-started members; the next step said | Adopted |
| Done | "View results" as the primary | Run filled again; "shown below" | Open result as the primary; Run again secondary, with its consequence | Adopted; "edit next task" is editing the request in place |
| Log | Task log | — | — (run facts in Details) | Not adopted |

**Remaining under this dispatch** (each its own admission reading; browser
groups with `-Port 15273`; all run in checkpoint 2):

1. S1 on `207b441`: `pnpm typecheck` (= `pnpm lint`, both `tsc -b`) and
   `pnpm e2e:typecheck`.
2. The targeted Vitest files, then U1: `pnpm exec vitest run --maxWorkers=1
   --no-file-parallelism` from `apps/desktop`.
3. B0: `pnpm build`.
4. G1: the PM9.5 spec. G2: m9.1 and m9.4. G3: PM9.1 whole, which reads
   `pm9Scenarios.ts`.
5. Then this record, `slices.md`, the baseline and the product notes
   (`M9_1_TARGETED_MS1_HANDOFF.md`, `M9_4_TARGETED_MS1_BATCH.md`,
   `PRIMARY_WORKFLOWS.md`).

The order matters: cycle 1 has never compiled, so step 1 comes first, and m9.1
has not run against the new order at all. One correction cycle remains; a
failure on resume is classified on its evidence as a test-authoring fix or as
cycle 2.

PM9.4's spec is not owed. It reads `scenario("populated")`, which is
unchanged. Its P4 case navigates through the Project surface, whose
`ProjectPanel.tsx` changed, but nothing in that change can reach P4's
assertions. Those are the IPC ledger during navigation and the conversion
state:

- `ProjectPanel` issues no IPC of its own;
- the project read on mount is unchanged;
- with the project idle and no targeted setup open, the busy-sentence
  refactor, the replacement reset and the analysing-only cancel label render
  nothing different.

**Process custody.**

- Every heavy group was launched by the scratchpad runner. It recorded each
  process's PID, creation time, command and parent, and every launched tree
  had zero leftovers.
- During G0, Chrome woke Google Updater as its child. Updater had ended by the
  leftover check.
- Nothing was killed by name or port.
- `check_repo` ran twice, on `207b441` and before the record commit. It is a
  static Python script that starts no subprocess. The first run went to the
  background automatically after 120 s; the second was started there and
  waited on with a short sleep loop. Each ran alone.
- The reviewer was a read-only subagent and ran no build or test.
