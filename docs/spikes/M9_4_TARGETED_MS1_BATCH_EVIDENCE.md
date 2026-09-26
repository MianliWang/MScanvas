# M9.4 — controlled batch of independent targeted MS1 analyses: evidence

Status: **M9.4 LOCAL CONTROLLED BATCH COMPLETE — INDEPENDENT MULTI-ACQUISITION
TARGETED-MS1 EXECUTION.** Date: 2026-09-24. Record:
[M9.4 record](../product/M9_4_TARGETED_MS1_BATCH.md). What was built, its
rules and its limits are in the record and in
[ADR 0050](../architecture/adr/0050-sequential-batch-of-independent-targeted-plans.md);
this document holds what was measured and how.

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9
CLOSURE NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE ·
PROTEOWIZARD HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC
BETA NOT RELEASED; M10 NOT STARTED

## Identity

| Binding | Value |
| --- | --- |
| Start (exact M9.3 endpoint) | `3d6300f1bae8766c6708c0fabf3bd1cdb7a23fa3`, tree `e4a94c868a31a9a5ce415b179bd4e5e4afe8dfdc` |
| M9.3 tested code under it | `c69889ba840a67072ebbaed5a32e1d2ede20a1b3`, tree `15070fb747e964a067ade58c6111a5d79e721b01` (an ancestor, verified) |
| Branch | `feat/m9.4-targeted-ms1-batch-execution`, local only |
| `main` / `origin/main` | `1daf802f06d0149b5de3dbd12e8b01e7e86862ec`, untouched |
| M9.0 / M9.1 / M9.2 / M9.3 branch heads | `1652aff…`, `96f2d8c…`, `d1d9f58…`, `3d6300f…`, untouched |
| Batch core and the first proof | `6983840` |
| Store rules and real-runtime tests | `e4631c6`, `a897bcc` (a clippy-only follow-up: the first commit's clippy failed and was not amended) |
| Interface | `4a61d4a` |
| Rendered scenarios and two layout repairs | `f8d91b5` |
| Stop offered only with an operation | `6f069b4` |
| Review repairs (frozen member plans; member actions after the batch; a single run's stale progress) | `373ab11` |
| A rendered assertion for the running batch | `183dfc0` |
| Targeted-review repairs (a mid-batch assertion that could fail; an unused derive) | `35def0d319092308cb22cdf4fba2d012b679d8e1`, tree `cf77c5f472791de5ef8d69e6a0bd067f6949b221` |
| The two batch commands added to the pinned command-surface test — **the tested code** | `5e3f127fb92181a329ead1037b6f5919f1ecc21e`, tree `6f3a867e9e9a374b951b6644c9b0dc89e60f27f6` |
| This record | a documentation-only successor of `5e3f127` |

At the start: branch, HEAD and tree as above, index and worktree clean, no
stash, no operation in progress. `.claude/scheduled_tasks.lock` (git-excluded)
named PID 50140, which was not running, as M9.3 found it; no other writer.

## The first proof: two plans through the unchanged single-run path

Before any interface work, the single run's body was extracted from
`run_targeted_ms1` into `run_plan` + `prepare_run`, the single run became that
body inside its own job, and the existing suites ran **unchanged**:
`cargo test -p mscanvas-desktop --lib -- targeted_ms1 project::` → 201 passed,
29 ignored, as before the change. Then
`two_independently_bound_plans_run_one_after_the_other_through_the_single_run_path`
(fake executor that counts attempts in flight) showed, for two layers over two
files with different bytes:

- one request, two plans: identical ordered targets, target identifiers,
  parameters, recipe binding and target-list digest; different layer, input,
  expected content and plan digest;
- attempts in the reviewed order, never two at once (most at once: 1), each
  given exactly one plan and that plan's one source;
- two ordinary `targetedMs1V1` runs, each naming its own plan digest, its own
  layer and its own consumed content, each producing its own result, each
  result's producing run its own; the job released at the end.

Committed as `6983840` before anything else.

## Store rules, against fake executors

`apps/desktop/src-tauri/src/targeted_ms1/tests/batch.rs`, always run:

| Test | What it shows |
| --- | --- |
| `two_independently_bound_plans_run_one_after_the_other_through_the_single_run_path` | above |
| `a_batch_names_two_to_sixteen_distinct_acquisitions_and_runs_all_sixteen_in_turn` | 1 and 17 layers `batchSizeOutOfRange`; a repeated layer `batchDuplicateInput`; an unknown layer `unknownRecord`, nothing recorded; 16 members run in the reviewed order, most at once 1, 16 runs |
| `acquisitions_holding_the_same_bytes_are_still_two_plans_and_two_runs` | identical expected content, different plan digests, both plans recorded, two runs over two layers |
| `a_member_whose_source_is_not_mzml_is_refused_and_nothing_is_held_for_a_run` | three members listed, the `.txt` one `recipeSourceUnsupported` with no plan; running the other two is `planNotCurrent`; nothing started |
| `a_batch_runs_only_exactly_the_batch_last_reviewed` | reordered, partial and single-member digests refused; a single review since replaces the batch; every refusal released the job |
| `review_says_for_each_member_what_would_stop_it_running_now` | one member blocked `insufficientWorkAreaSpace`, the others not; judged per member, never summed |
| `a_review_made_while_a_batch_runs_changes_nothing_the_batch_runs` | a single and a batch review during the first member's attempt; every member still runs the plan it was accepted with (review repair; shown to fail without it) |
| `a_member_that_fails_or_times_out_leaves_every_other_member_as_it_is` | `sourceChanged` and `workerTimeout` members fail on their own, the first and last complete; two whole payloads, nothing staged |
| `a_member_refused_before_its_attempt_gets_no_run_and_the_next_member_runs` | a member whose copy no longer fits at its turn is `refused`, has no run, and the next member runs |
| `stopping_the_batch_ends_the_member_running_as_a_cancelled_run_and_starts_no_other` | stop during the second member: it is a cancelled run with stop facts, the third never started and has no run, the first result stands |
| `a_batch_stopped_before_its_first_member_starts_records_nothing` | every member `notStarted`, no attempt, no run |
| `a_stale_cancel_reaches_neither_the_batch_running_nor_a_later_one` | the finished batch's identifier answers `noActiveOperation` idle and `stale` during a later batch, which completes whole |
| `a_worker_not_accounted_for_keeps_every_later_member_out` | the quarantining member is a failed run; the next is `notStarted(analysisQuarantined)`; a new review blocks every member |
| `progress_names_every_member_in_order_and_the_phase_of_the_one_running` | `completed`, `running` (phase `runningEngine`), `queued`, by layer, with the finished member's run and result |
| `every_result_of_a_batch_survives_save_reopen_and_save_as_and_reads_without_its_source` | three results saved, reopened whole, each produced by its own run over its own layer with its own plan; Save As copies all three payloads; one member read, tabulated and drawn with its source deleted and no executor |

## With the pinned runtime

`#[ignore]`d, run with
`cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1`.
The executor is the real supervisor wrapped by a watcher that counts attempts
in flight, compares the attempts root with its state before the batch as each
attempt starts, and records the bytes of any verified copy there at each phase
the attempt reports. Fixtures are owned mzML files written by the tests.

| Case | Result |
| --- | --- |
| Three members: `D:` plain (caffeine at 60 s), `C:` two peaks (caffeine and phenylalanine), `D:` matrix only under `数据 目录/样品 无信号.mzML`; targets caffeine and phenylalanine | all completed; views link, verified copy, link; rows `DETECTED`/`NOT_DETECTED`, `DETECTED`/`DETECTED`, `NOT_DETECTED`/`NOT_DETECTED` (the all-absent member a completed run, not a failure); each run's consumed content its own plan's; saved, reopened with the copied member's source moved away and no executor: all three whole, the copied member tabulated and drawn; Save As copied all three payloads |
| Four members on `D:`: plain, two peaks whose bytes change after review, a truncated mzML, two peaks | completed, failed `sourceChanged`, failed `sourceUnreadable`, completed; the changed member keeps its reviewed plan; the members around the failures found what they hold |
| Three members on `D:`, the second the large fixture; Stop when its worker reports loading or checking its source | first completed; second cancelled with `workerTerminated` and `exitObserved`; third never started, no run; one result; the identifier then names nothing and a new operation is accepted |

In all three: at most one attempt in flight, and every attempt began with the
attempts root as it was before the batch.

## Resources

One small scenario, the three-member mixed batch above (not a performance
campaign; no scaling claim):

| Observation | Value |
| --- | --- |
| Members | 3 (link, verified copy, link) |
| Attempts in flight at once, at most | 1 |
| Work area as each attempt started | as before the batch, 3 of 3 |
| Verified-copy bytes present during each attempt | 0, 451,489, 0 — the copied member's own length, once; no copy outlives its attempt |
| Source bytes | 455,961, 451,489, 446,737 |
| Batch wall time | 10.24 s, 9.13 s and 9.01 s in three runs, for three members, each verifying the 4,628-file runtime before launch |
| Peak worker memory | not observed: the worker's memory is accounted inside its Job object, which the supervisor caps (4 GiB) but does not report |

## Rendered interface

`e2e/specs/m9.4-targeted-ms1-batch.browser.e2e.ts`, real Chrome over the real
Vite dev server with only the IPC boundary replaced; every answer is a
controlled table (no worker ran). 5 scenarios, 11 frames:

| Frame | Viewport | Shows |
| --- | --- | --- |
| `m94-01-reviewed-1920` | 1920×1080 | three members sent in the project's order (ticked out of order), the shared targets once, the independence statement, three members Ready, **Run 3 analyses** |
| `m94-02-running-1920` | 1920×1080 | panel brought into view with the keyboard on it; completed / running (*Running the engine…*) / queued; busy line *acquisition 2 of 3*; its cancel named **Stop batch**; no member action offered yet |
| `m94-03-stopping-1920` | 1920×1080 | Stop pressed by keyboard: one `cancel_project_job` naming the operation; *Stopping…* |
| `m94-04-ended-1920` | 1920×1080 | completed / cancelled / not started (*the batch was stopped before it started*); counts; announced; nothing opened |
| `m94-05-member-result-1920` | 1920×1080 | **Open result** opens that member's result in the M9.2 report |
| `m94-06-mixed-1366` | 1366×768 | completed / failed (*source has changed…*) / not run (*less free space…*); no target outcome word on the panel |
| `m94-07-failed-member-details-1366` | 1366×768 | **Show run**: Details explains the failed member's own run |
| `m94-08-not-ready-960` | 960×640 | members blocked and refused, each in the refusal's own words; Run inert; no batch run sent |
| `m94-09-refused-1366` | 1366×768 | a refused request (`batchSizeOutOfRange`) in its own sentence |
| `m94-10-reviewed-zh-CN`, `m94-11-ended-zh-CN` | 1366×768 | the review and a stopped ending in Simplified Chinese |

Every frame: no horizontal overflow of the page, the project surface or any
batch table; no layer, reference or run identifier and no absolute path on
screen; no off-origin request; no unexpected console entry. Rendering led to
two repairs before this record: the panel is brought into view when it
appears, and its table is sized to its content.

The M9.1–M9.3 browser spec, which covers the single-run setup the batch
extends, was re-run: 12 passing.

Unit tests (`TargetedMs1Batch.test.tsx`, 11): the setup offers every layer
with only the opening one chosen; one chosen acquisition is a single review
whichever it is; none chosen asks nothing; the batch request's exact shape;
members not ready hold the batch back, each said in its own words; a changed
choice discards the review; a refused request in its own words; one
operation, one Stop (twice pressed, sent once), member states and phase, the
ending counted and announced, nothing opened on arrival, a member's result
opened on request; a mixed ending in each member's own words with no finding
on the panel; a single run after a batch shows no batch progress (review
repair; shown to fail without it); Simplified Chinese.

## Isolated review

One isolated, read-only substantive review of `3d6300f..f8d91b5` plus
`6f069b4` (no builds or tests run by the reviewer), briefed on: no pooled
science, independent plan binding, the sequential guarantee, failure
isolation, stop semantics, no fake runs, project history, multiple payload
transactions and Save As, M9.3 safety, and wording.

It found no blocker, and reported as sound: one plan and one source per
attempt, nothing normalizing, ranking or comparing across acquisitions, the
wording disclaiming comparability; each plan re-bound and re-digested over
layer, reference and bytes, with target identifiers unique only within a plan
as the document requires; one worker at a time (the job stays exclusive
between members, and an attempt returns only after its worker and monitor
end); the stop checked under the lock that marks a member running, the
cancel-at-commit rule, the last member releasing under its own commit, a
timeout recorded as a failure, stale cancels answering `stale` or
`noActiveOperation`; a member's rollback touching only what it pushed; no run
for a never-started member; `run_plan`/`prepare_run` matching the old body
line for line; `scratch.rs`, `targeted_ms1.rs` and every snapshot and recovery
path untouched; en and zh-CN adding the same 42 keys.

| Finding | Severity | Disposition |
| --- | --- | --- |
| A review made while a batch runs replaced the plans held for review; each later member looked its plan up again by digest and was refused `planNotCurrent`. Unreachable from the interface (review is held while busy), reachable through Rust | should-fix | **Repaired** (`373ab11`): each member runs the plan frozen when the batch was accepted, re-checked against the project at its turn; test `a_review_made_while_a_batch_runs_changes_nothing_the_batch_runs`, shown to fail without the repair |
| **Open result** and **Show run** were offered mid-batch, when the project on screen holds no member's run yet, so Details said the record was gone | should-fix | **Repaired** (`373ab11`, test strengthened in `35def0d`): offered once the batch has ended; unit and browser assertions, shown to fail without the guard |
| The panel's Stop could be pressed before the operation was accepted, sending nothing and reading *Stopping…* | nit | Already repaired in `6f069b4`, found independently before the report |
| A single run after a batch showed that batch's progress until its first progress read | nit | **Repaired** (`373ab11`); test shown to fail without it |
| After a batch review, a single run may name any member's plan | nit | Accepted and recorded: each was reviewed |
| A 16-member batch of 200 targets stores its target list 16 times | observation | Recorded in the record and ADR 0050 |

The frozen-plan repair changed which plan a batch member runs, so it had a
**targeted review** only (commit `373ab11` against `6f069b4`, read-only). It
found no blocker and nothing to fix, and confirmed: the single run's lookup
unchanged (pending first, then recorded, same refusal, same lock); a frozen
plan re-checked against the current document before its attempt and again at
its commit, so it cannot run against a layer, reference or bytes that no
longer match it; no plan recorded twice; the snapshot and the member list
built from one clone under the lock that checked them. Its two nits — a
mid-batch Show-run assertion whose fixture could not fail, and an unused
derive — were repaired in `35def0d`; its note that a failed member's reason
appears only once the batch ends is recorded as a known limit.

## Validation record

Run one at a time, nothing else running, logs retained under
`.tmp/m94-evidence/final/` and `.tmp/m94-evidence/final2/` (git-ignored).

The first full run was on `35def0d` (tree `cf77c5f…`):

| Command | Exit | Result |
| --- | --- | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test -p mscanvas-desktop --lib targeted_ms1::tests::batch` | 0 | 15 passed, 3 ignored (the runtime cases) |
| `cargo test --workspace` | **101** | 1230 passed, **1 failed**, 46 ignored: `preview::tests::the_registered_command_surface_is_the_one_the_frontend_calls`, which pins every registered command and did not list the batch's two. Repaired in `5e3f127` (test only) |
| `cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1` | 0 | 32 passed: the 28 earlier real-runtime cases, the opt-in measurement (measured nothing without its variable) and the 3 batch cases |
| `cargo check --release --workspace` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | 106 files, 2168 tests passed |
| `pnpm build` | 0 | |
| `pnpm e2e:typecheck` | 0 | |
| `wdio … --spec m9.4-targeted-ms1-batch.browser.e2e.ts` | 0 | 5 passing |
| `wdio … --spec m9.1-targeted-ms1.browser.e2e.ts` (M9.1–M9.3 scenarios) | 0 | 12 passing |
| `wdio … --spec m8.1-project-records…` / `m8.2-provenance…` / `m8.3-reattachment…` / `m8.4-layers…` / `m8.5-qc-summary…` | 0 each | 8, 4, 2, 2 and 3 passing |
| `git diff --exit-code 3d6300f HEAD -- Cargo.lock pnpm-lock.yaml package.json apps/desktop/package.json Cargo.toml apps/desktop/src-tauri/Cargo.toml crates` | 0 | no dependency, lock or crate change |

The Rust gates were then run again on `5e3f127` (tree `6f3a867…`), which
differs from `35def0d` only in `preview/tests.rs`:

| Command | Exit | Result |
| --- | --- | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test -p mscanvas-desktop --lib targeted_ms1::tests::batch` | 0 | 15 passed, 3 ignored |
| `cargo test --workspace` | 0 | desktop 1231 passed, 46 ignored; core 135; proteowizard 513 passed, 9 ignored; the rest passed |
| `cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1` | 0 | 32 passed |
| `cargo check --release --workspace` | 0 | |

The frontend, build, e2e-typecheck and browser gates above ran on
`35def0d`; no frontend or e2e file differs between it and `5e3f127`.
`python scripts/check_repo.py` was run on this record's own commit (below).

Not run: the repository-wide `pnpm e2e:browser`. Its historical status is
unchanged and was not re-measured: exit 1, 7 spec files passed and 20 failed
(recorded in M9.1). The spec files this milestone touches or depends on were
run one by one above. No native (Tauri WebDriver) scenario was run: nothing in
M9.4 reaches a native dialog or window.

## Custody

Local ordinary commits on `feat/m9.4-targeted-ms1-batch-execution` only: no
amend, rebase, squash, cherry-pick, push, pull request, merge, tag or release;
`main`, `origin/main` and the M9.0–M9.3 branch heads untouched. One writer.
Two isolated reviewers read only, one at a time, and no suite ran while they
did. Task evidence — logs, screenshots and browser evidence — is under
`.tmp/m94-evidence/` (git-ignored). At the end: index and worktree clean, no
stash, no operation in progress, and no worker, test runner, browser driver or
dev server owned by this task still running (checked after the last gate).
