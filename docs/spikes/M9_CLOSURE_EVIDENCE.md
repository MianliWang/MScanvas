# M9 closure — evidence

Status: **M9 LOCAL IMPLEMENTATION COMPLETE — TARGETED-MS1 ANALYSIS PHASE
CLOSED LOCALLY.** Date: 2026-09-24. Record:
[M9 closure](../product/M9_CLOSURE.md). What M9 is, its limits and the
handoff are there; this document holds what was checked, measured and run, and
on which tree.

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 LOCAL IMPLEMENTATION
COMPLETE · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD HOLD
UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT RELEASED;
M10 NOT STARTED

## 1. Identity

| Binding | Value |
| --- | --- |
| Start (exact M9.4 endpoint) | `13a3560c1ad6f14878dfb659a7f014b79c422488`, tree `574630fe3c668471c386ed48c8c9658e981988c5`; its tested code `5e3f127fb92181a329ead1037b6f5919f1ecc21e`, tree `6f3a867e9e9a374b951b6644c9b0dc89e60f27f6` (an ancestor; `5e3f127..13a3560` changes documentation only) |
| Branch | `feat/m9-closure`, local only, created at the start |
| `main` / `origin/main` | `1daf802f06d0149b5de3dbd12e8b01e7e86862ec`, untouched |
| M7.6 … M9.4 branch heads | unmoved; listed in the record §14 |
| First closure code candidate | `59cbf1c62ac27614308840cc0902e5068c03e61c`, tree `6998915642af06ab502d194a756271d6cff21012`: the canonical schema-4 fixture, the ignored growth measurement and the extended real-runtime scenario; tests only. The whole first campaign, including the repository-wide browser suite, ran on it |
| **Closure code — the tested tree** | `d8310cecd021f9f29413776aba0945311ce01c05`, tree `ec7f63e4f5a74ecbf4da95c36c3ab7c88e944924`: the locator repair and its test (`project/record.rs`, `project/tests.rs`, nothing else). Every gate but the repository-wide browser suite ran on it again (§7) |
| Documentation successors | recorded in §11 |

At the start: branch, HEAD and tree as above, index and worktree clean, no
stash, no Git operation in progress, one worktree.

## 2. How the contract was reconstructed

The record's §3–§10 were written from the code, then compared with the slice
records. Read in full or in their M9 parts: `project/record.rs` (every schema
rule), `project/recipe.rs`, `project/mod.rs` (`resolve_targeted_ms1_plan`,
`run_targeted_ms1`, `resolve_targeted_ms1_batch`, `run_targeted_ms1_batch`,
`run_plan`, `prepare_run`, the stored-result reads, `refuse_full_history`,
`fits_every_later_save`), `targeted_ms1.rs` (the supervisor, the execution
views, the snapshot, the stop and timeout mapping), `targeted_ms1/scratch.rs`,
`project/payload.rs` (row rules, store, staging, manifest), and
`project/targeted_output.rs` (figure, table). The interface maps
(`TargetedMs1.tsx` `OUTCOME_KEYS`, `ROW_FAILURE_KEYS`, `FAILURE_KEYS`) and the
English strings were read for meaning.

What the comparison found:

| Finding | Kind | Disposition |
| --- | --- | --- |
| No other code defect in the schema rules, the run commit, the batch loop, the execution views, the sweep, the stop and timeout mapping, the row rules, or the table's empty-cell rules | — | none needed |
| `Locator` was the one object in the document without `deny_unknown_fields`: `{"kind":"projectRelative","path":"…","fileIdentity":"…"}` was accepted and the extra field dropped on the next save — contrary to the document's own rule, which the M8 handoff states ("every object refuses unknown fields") and `LayerSource` argues for. Shown by a new test failing at `expect_err("a refusal")` before the repair | validation defect | **repaired** in `d8310ce` (one attribute); `a_locator_carrying_a_field_it_does_not_hold_is_malformed` covers both locator kinds with a control. No build wrote such a field, so no saved document is affected; the schema's shape is unchanged |
| Schema 4 had no document fixed outside the code: every document test built its document from the current types, so a renamed field or a changed plan canonical form would have passed | test gap | **closed**: the canonical fixture (§3) |
| The document-growth figure in the M9.4 record and ADR 0050 (0.5–0.65 MB per 16 × 200 batch) was an estimate; the measured figure is about 0.84 MiB | stale fact | **corrected** by forward notes in both, with the measurement (§4) |
| `ROADMAP.md`, `PROJECT_PROPOSAL.md` and `BOOTSTRAP_STATUS.md` still said M9.2 was not started, M7.5 or M7.6 was next, and placed VIEW-008 and the XIC export in M9 | stale status | corrected (§9) |
| The oversized refusal says *This project is larger than MSCanvas saves.* when a run would make it so, and gives no remedy | wording | recorded as a limit for the UI/UX cleanup; not changed without rendered QA |

## 3. The canonical schema-4 document

`apps/desktop/src-tauri/src/project/schema_4_canonical.json` (597 lines,
18,890 bytes, LF) was produced once by a throw-away generator test that built
the document as JSON with fixed identifiers, set both plans' digests with this
build's `record::target_list_digest` and `record::plan_digest`, parsed it with
`record::parse` and wrote `record::serialize`'s output. The generator was
removed; the file is the contract.

It holds two inputs (one project-relative, one local-absolute locator), two
layers, a file-facts capture and a QC capture with their records, two plans
over the two layers sharing one target list (as batch members do), a completed
linked run and a completed copied run whose result came through the
no-candidate recovery, and three more targeted runs: failed
`insufficientWorkAreaSpace` with no attempt, failed `sourceChanged` with a
different consumed digest, failed `workerTimeout` with a
`timeBudgetExceeded` stop, and one cancelled with `cancelRequested`.

`project::tests::the_canonical_schema_four_document_reads_and_writes_back_unchanged`
parses it and requires `record::serialize` to give back the same JSON value.
Mutation check: the first target's `rtS` changed from `"60"` to `"61"` in the
file made the test fail with `InconsistentRecord` (the plan's digest no longer
names it); the file was restored byte for byte from the generated copy.

## 4. Document growth

`targeted_ms1::tests::batch::measure_how_many_of_the_largest_batches_one_project_document_holds`,
`#[ignore]`d, fake executor (no runtime), each completed member carrying a real
run's attempt facts: the engine report and 17 module digests — the most the
adapter can hash; the real runs in §5 recorded 15, so the figures below
overstate a run by a few hundred bytes. Targets: 200 per plan, labels
`compound 000`…`compound 199`, formula `C8H10N4O2`, RTs such as `30.0`,
half-width `15`. Batches of 16 over 16 layers, saved after each, until a
member met the bound. Output, as printed on the tested tree:

```text
M9C_EVIDENCE size: empty_bytes=10324 first_batch_bytes=877436 per_member_bytes=54839
whole_batches=4 refused_member_index=12 members_recorded=76 final_bytes=4178120
bound_bytes=4194304 per_member_plan_bytes=48931 per_member_run_bytes=4719
per_member_artifact_bytes=1189 sizes=[10324, 887760, 1765190, 2642620, 3520050, 4178120]
```

Asserted, not only printed: the refused member's attempt ran; its state is
`Refused(Oversized)`; every later member is `NotStarted(Oversized)`; the runs
recorded are exactly the 76 members before it; the saved document is under the
bound and saves.

## 5. The combined M9 scenario

`targeted_ms1::tests::batch::a_batch_of_linked_and_copied_members_runs_one_worker_at_a_time_and_leaves_no_scratch`,
the M9.4 real-runtime test, extended at closure. **Real runtime** (the pinned
CPython 3.13.15 + pyOpenMS 3.5.0 under the real supervisor) over **owned
synthetic mzML fixtures written by the test** — not instrument data.

| Step | Real or controlled | Shown |
| --- | --- | --- |
| A saved project, three layers: `D:` plain (caffeine at 60 s), `C:` two peaks, `D:` matrix only under `数据 目录/样品 无信号.mzML` | real files | a project and its references |
| One batch review, three exact plans | real store | same targets and target-list digest, three plan digests |
| Sequential execution | real runtime | at most one attempt at a time; each began with the attempts root as before the batch |
| Views | real runtime | link, verified copy (451,489 bytes, once), link |
| Findings | real engine | `DETECTED`/`NOT_DETECTED`, `DETECTED`/`DETECTED`, `NOT_DETECTED`/`NOT_DETECTED` — the last a completed run of absences, not a failure |
| Separate records | real store | three runs, three artifacts, three payloads |
| Save, close (drop), reopen with the copied member's source moved away and no executor | real store | every result `available`; the copied member read, tabulated (CSV) and drawn |
| **Added:** the all-negative member as CSV and TSV | real store | `NOT_DETECTED`, no reason, candidate count `0`, and empty — not zero — apex, raw area and engine intensity |
| **Added:** its evidence as SVG | the export renderer (`mscanvas_plot_spec::svg::render`, as `export_targeted_ms1_figure` calls it) | an SVG naming `caffeine` and `Not detected` |
| Save As | real store | all three payloads copied |
| **Added:** the Save As copy reopened | real store | every result read from the copy's own store with its plan; reading left the project clean |
| **Added:** privacy scan | real files | §6 |

Printed on the tested tree:

```text
M94_EVIDENCE mixed: members=3 views=[link, snapshot, link] most_at_once=1
clean_at_start=[true, true, true] copy_bytes_per_member=[0, 451489, 0]
source_bytes=[455961, 451489, 446737] wall_s=10.76
M9C_EVIDENCE combined: document_bytes=23432 loaded_modules_per_run=[15, 15, 15] files_scanned=28
```

What the scenario does not include, and where it is shown instead: PNG bytes
and the native save dialog (PNG is exercised by M9.2's Rust tests; the dialog
is mocked in the browser suite and natively unqualified); a stop, a changed
source and a malformed source in a real batch (the other two M9.4 real-runtime
tests, run in §7); rendered interface states (the M9.1–M9.4 browser specs, §7).

## 6. What a real run persists

The combined scenario reads both saved documents and every file of both result
stores — 28 files — and requires none to contain, case-insensitively:
`attempts`, `owner.json`, `ownerprocess`, `snapshot.mzml`, `source.mzml`,
`request.json`, `adapter_v1.py`, `openms_home`, `stderr`, `stdout`, `"pid"`,
`processid`, `fileid`, `volume`, `dataset`. It passed. (The project's own input
locators may name the test's work area, below the same `.tmp/m91-jobs` as the
attempts root, so the attempts root is what is looked for.) In code: the
document's types cannot represent a path other than an input locator, a process
or operation identifier, a `FileIdentity` or a `DatasetId`; the payload's rows
and evidence name targets by identifier and carry numbers; `manifest.json`
names its artifact, plan and files; `.owner.json` names the project.

## 7. Validation on the tested tree

Two campaigns, each run one command at a time by one script, with nothing else
running but this author writing documentation; logs under
`.tmp/m9-closure-evidence/final/` and `final2/` (git-ignored), browser
evidence routed there too. Every command below is quoted as run; the exit is
the command's own.

**First campaign, on `59cbf1c`** (tree `6998915…`, worktree clean):

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test --workspace` | 0 | desktop 1232 passed, 47 ignored; core 135; proteowizard 513 passed, 9 ignored; the rest passed |
| `cargo test -p mscanvas-desktop --lib targeted_ms1` | 0 | 86 passed, 33 ignored |
| `cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1 --nocapture` | 0 | 33 passed: the 28 earlier real-runtime cases, the three M9.4 batch cases (one of them the extended combined scenario), the M9.3 opt-in measurement (measured nothing without its variable) and the new growth measurement |
| `cargo check --release --workspace` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | **1** | 2167 of 2168 passed. Failed: `M73Viewer.test.tsx > M7.3 through the delivered application > exports only committed axis ranges while drawing or pending, then the newly confirmed range from retained tokens`, `Test timed out in 5000ms`, at 5065 ms. Preserved as it happened; see below |
| `pnpm build` | 0 | |
| `pnpm e2e:typecheck` | 0 | |
| `wdio run ./e2e/wdio.browser.conf.ts --spec` m8.1, m8.2, m8.3, m8.4, m8.5, m9.1, m9.4 (one invocation each) | 0 each | 8, 4, 2, 2, 3, 12 and 5 passing |
| `git diff --exit-code 97392e9 HEAD --` every manifest and lock file | 0 | nothing changed since the M9 start |
| `git diff --stat 1daf802 HEAD --` the same files | 0 | only M8.1's `uuid` edge (`Cargo.lock` +1, desktop `Cargo.toml` +5) |
| `pnpm e2e:browser` (repository-wide) | **1** | 28 spec files: 8 passed, 20 failed; §8 |

**The `pnpm test` timeout.** The frontend source of `59cbf1c` is identical to
M9.4's `35def0d`, whose `pnpm test` passed 2168 of 2168; the closure changed no
frontend file. The failing case is the one the M8.4 and M8.5 records already
carry as a load-dependent App-level timeout in this file. The suite's setup
time was 163.8 s against 134 s in M8.5's slow run. It was not rerun until green:
the second campaign below ran on a new code candidate for its own reason, and
recorded its own exits, which include a run of this file alone.

**The locator repair** (`d8310ce`, §2) changed two Rust files.

**Second campaign, on `d8310ce`** (tree `ec7f63e…`; the worktree held only the
uncommitted documentation of this closure):

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test --workspace` | 0 | desktop 1233 passed, 47 ignored; core 135; proteowizard 513 passed, 9 ignored; the rest passed |
| `cargo test -p mscanvas-desktop --lib targeted_ms1` | 0 | 86 passed, 33 ignored |
| the real-runtime suite, as above | 0 | 33 passed; the printed evidence in §4 and §5 is identical to the first campaign's but for wall time (10.17 s) |
| `cargo check --release --workspace` | 0 | |
| `pnpm lint`, `pnpm typecheck` | 0, 0 | |
| `pnpm --filter @mscanvas/desktop exec vitest run src/app/M73Viewer.test.tsx` | 0 | 4 of 4 — a diagnostic of the file alone |
| `pnpm test` | 0 | 106 files, 2168 of 2168 |
| `pnpm build`, `pnpm e2e:typecheck` | 0, 0 | |
| the seven M8/M9 browser specs, one invocation each | 0 each | 8, 4, 2, 2, 3, 12 and 5 passing |
| `wdio … --spec` m4.1, m4.3, m4.4, one each (diagnostic, §8) | 1, 1, 1 | 0/17, 13/10 and 8/10 passing/failing |
| the two dependency diffs | 0, 0 | as above |

The repository-wide browser suite was not run again on `d8310ce`: its parent
`59cbf1c` differs from it only in `project/record.rs` and `project/tests.rs`,
and the browser suite serves the frontend through Vite with the IPC boundary
replaced, building and loading no Rust. `python scripts/check_repo.py` ran on
the documentation commit (below).

`python scripts/check_repo.py` exited 0 on the documentation before it was committed, and again on each documentation commit (§11).

## 8. The repository-wide browser suite

**Question.** M9.1 recorded `pnpm e2e:browser` at exit 1, 7 spec files passed
and 20 failed, and could say only that the failures were "inherited by that
evidence and by what they touch, not proven inherited spec by spec". Closure
settles that at the level of individual tests.

**Runs**, all headless Chrome 153.0.8010.53 on this machine, one at a time with
nothing compiling:

| Run | Tree | Exit | Spec files |
| --- | --- | ---: | --- |
| Current, whole suite (first campaign) | `59cbf1c` | 1 | 28: 8 passed, 20 failed |
| Current, m4.1, m4.3, m4.4 one each (second campaign) | `d8310ce` | 1, 1, 1 | see below |
| **Published baseline**, whole suite, from `git archive 1daf802` into `.tmp/m9-closure-evidence/baseline-1daf802/` with `pnpm install --frozen-lockfile --offline` (the lock file is identical to the closure's) | `1daf802`, tree `a46acda7…` | 1 | 21: 1 passed, 20 failed |
| For reference: M9.1's whole suite | `4764c74` | 1 | 27: 7 passed, 20 failed |

In the current whole-suite run, m4.1, m4.3 and m4.4 never started: each worker
failed to open its WebDriver session (`WebDriverError: Failed to fetch [POST]
http://localhost:6667/session`), a harness failure with no test result. The
three were therefore run once each on `d8310ce`; no other spec was rerun, and
the whole-suite exit is recorded as it was. The export directory was removed
afterwards; its logs are kept under `.tmp/m9-closure-evidence/baseline/`.

**Comparison, test by test** (spec file, suite path and test title, parsed from
each run's spec reporter; the current side takes m4.1, m4.3 and m4.4 from their
own runs):

| | Published `main` | Current closure code |
| --- | ---: | ---: |
| Spec files present in both | 21 | 21 |
| Tests in those files | 317 | 317 |
| Failing | **174** | **174** |
| Tests whose result differs | — | **0** |
| M8/M9 spec files (only in the current code) | — | 7 files, 36 tests, all passing |

The current results also equal M9.1's run test for test in every spec file both
contain. **Every one of the 20 failing spec files fails identically on
published `main`.** None is an M8 or M9 regression, and none is a Project
surface or targeted-MS1 test.

**Families**, from the current and baseline error lines (the counts are
failing tests):

| Family | Spec files | Classification |
| --- | --- | --- |
| Rows looked up as `li.dataset-row[data-handle=…]`; since M7.2 (`13745b1`, published) the roster renders `div role="row" class="dataset-row"`, and published `main` has no `li` roster row | m4.1 (17), m4.2 (15), m6.1 (9), m6.4 (24), m6.6 (8) | **obsolete test contract**, confirmed statically |
| `.grouped-roster [data-handle=…]` never displayed, then layout and value assertions | m4.3 (10), m4.4 (10), m5.2 (12), m5.3 (13), m5.7 (1), viewer-r1-linked-viewer (14), viewer-r1-scale (1) | **pre-existing on `main`**; the roster set-up in these older specs no longer produces the row they wait for — cause not diagnosed spec by spec |
| Conversion panel states never reached (`.conversion-running`, an enabled `.conversion-plan` button) | m6.7 (7), m6.8 (2), m6.9 (7) | pre-existing on `main`; not diagnosed |
| Rows looked up as `.dataset-roster-list [role="option"]`; since M7.2 that element is the grouped roster's `role="treegrid"`, whose rows are `role="row"`, with no option on current or published code | m7.1 (3) | **obsolete test contract**, confirmed statically |
| `waitUntil` timeouts and a button not found; mixed assertions | m7.2 (10), m7.3 (3), m7.4 (6), m7.5 (2) | pre-existing on `main`; not diagnosed. The Chinese button labels these specs look for (`重试读取列表`, `高级`) exist in the current zh-CN resources; the garbled characters in the logs are the console's code page, not the cause |

The `browser.tauri.execute() is not supported in browser mode` lines M9.1
counted are warnings the service prints in passing specs too; they are not a
failure family.

**Ownership.** Repairing or retiring these specs against the M7.2+ shell and
roster is legacy browser-suite work, not M9's. It is named as a precondition to
decide before source integration (whether to publish a red suite as known debt)
and before release (record §13). No spec was edited, skipped or rerun to green.

## 9. Documentation reconciled

| File | Change |
| --- | --- |
| `docs/product/M9_CLOSURE.md` | new: the canonical current-state record |
| `docs/spikes/M9_CLOSURE_EVIDENCE.md` | new: this document |
| `ROADMAP.md` | M7 paragraph: M7.6 partial, local, deferred; M9 status and summary; the recipe, XIC and VIEW-008 bullets say what M9 delivered and what moved out; an "After M9" note; M10 not started |
| `PROJECT_PROPOSAL.md` | §18: M7.5 published, M7.6 partial and deferred; M9 complete locally with what moved out; updated date |
| `BOOTSTRAP_STATUS.md` | the current-route paragraph and date |
| `docs/product/FEATURE_CATALOG.md` | ANA-004 status layer; VIEW-008, PRJ-005 and the XIC note no longer place comparison or XIC in M9 |
| `docs/product/PRIMARY_WORKFLOWS.md` | WF-007: the one implemented recipe's task and recovery path |
| `docs/product/SCREEN_MODEL.md` | the inspector line for a targeted result, M9.1–M9.4 |
| `docs/product/M9_1_TARGETED_MS1_HANDOFF.md`, `docs/product/M9_4_TARGETED_MS1_BATCH.md`, `docs/architecture/ANALYSIS_WORKERS.md` | a forward pointer to the closure; the M9.4 record's growth figure corrected |
| `docs/architecture/adr/0050-…` | a marked note under Consequences with the measured growth; the decision unchanged |

Not changed: the M9.0–M9.4 evidence documents and ADRs 0048–0049, which stay
history; `README.md`, whose current-state sections describe the published M7.5
product (as at the M8 closure) and are an integration-time refresh (record
§14).

## 10. The closure review

Pending: recorded in the documentation commit that follows the review.

## 11. Custody

Pending: recorded with the review.
