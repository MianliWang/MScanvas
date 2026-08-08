# M3.3 ProteoWizard cancellation and partial-output evidence

- **Status:** Real-backend cancellation measured and a private cancellation
  primitive landed beneath the queue. No user-visible cancellation exists.
- **Date:** 2026-08-08
- **Exact code head:** `b56fd2b00c96a9b231e6ccf6bc000d01719d0258`
  (measured on eight heads over seven review rounds: `99d4be7`, `cf309dd`,
  `0f46a6c`, `abdb1ed`, `3d1452b`, `0538e50`, `a8daded` and this one. Review changed what an
  unconfirmed cancellation carries, what counts as a staged partial document,
  what a run that never launched reports at all, how the harness waits, what
  the natural-exit race times against, when the executor last asks before
  spawning, which milestone the vendor route uses, what the record counts, and
  how the harness waits for a launch that never comes. Every figure below is
  from one complete run of all six scenarios on this head rather than carried
  forward, every conclusion was the same on all eight, and the documentation
  commits after this head change no code.)
- **Decision recorded in:** [ADR 0014](../architecture/adr/0014-proteowizard-cancellation-evidence.md)

This closes ADR 0009's second open evidence gate — *"Real cancellation and
partial-output behavior. Rated **D**. Required before a queue can offer
cancellation."* — and the M0 spike's `D` rating for cancellation, which was `D`
because the only measured conversion completed in 136 ms.

It is evidence about one build, two workloads and one machine. It is not a
claim that MSCanvas can cancel a conversion, because nothing a user can reach
starts a cancellable one.

## Provider build

| Item | Verified value |
| --- | --- |
| Release | `3.0.26013` |
| Source revision | `47b13cf` |
| `msconvert.exe` SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` |
| Discovery | `Available` |
| Gate | The harness calls the library's own `provider_build_is_evidenced` predicate and refuses to run against anything else. It does not carry a second copy of the release, revision and digest strings, because a second copy of a rule is a second rule the moment either changes |
| Installation | User-supplied and user-installed. Nothing is bundled, downloaded or redistributed |

## Workloads

Two, for two different reasons.

### Generated mzML — for process and partial-output evidence

The one lawful vendor fixture converts in about half a second, which is below
any milestone a mid-write cancellation can be requested at. So the harness
generates a bounded mzML document outside the repository.

| Item | Value |
| --- | --- |
| Provenance | Written by the harness itself. No acquisition, no download, no vendor data |
| Bound | `--spectra` × `--peaks`, both required to be at least one |
| Recorded run | `3,000` spectra × `500` peaks |
| Byte length | `36,014,923` |
| SHA-256 | `1A10CD76681CCA59E74E61E9A21CA1158165F9B52A069C8839A7C181E6B40B9F` |
| Content | mzML 1.1.0, MS1 profile spectra, two 64-bit uncompressed float arrays per spectrum. Peak positions are an arithmetic ramp and intensities a modular ramp; every identifier in the document is one the generator wrote |
| Personal or proprietary content | None. It describes no instrument, sample, compound or person |
| Retention | Written inside the harness workspace and removed with it. Not committed, and it must not be |

It is a real workload rather than a filler file: the same document converts to a
finalized `12,283,969`-byte output through the unchanged boundary, with no
residue, in `1,116 ms` of backend time.

**The recipe, not the artifact, is the reproducible thing.** The generator is
deterministic for a given `--spectra`/`--peaks`, but the digest above pins what
was measured rather than something a later slice should compare against.

### Thermo RAW — for vendor-route evidence

The fixture [ADR 0010](../architecture/adr/0010-first-vendor-raw-source-admission.md)
and the [M3.0.3 record](M3_VENDOR_RAW_EVIDENCE.md) already establish, re-fetched
from the same pinned Apache-2.0 URL and re-verified before use: `78,309` bytes,
SHA-256 `B3D97B3856DD1E8DD6846D21C58B1B1824C309480908FE4C2DFABE152BD6DD7B`. Not
tracked, and deleted after this evidence was collected.

## Cancellation mechanism

A request carried to the owned Windows Job Object the process boundary already
establishes. No new dependency, no new Windows API, no second subprocess
implementation.

1. `ConversionCancellation` — created per attempt, taken by value, not `Clone`.
2. `CancellationRequest` — the clonable handle a caller keeps; can request and
   nothing else.
3. `ProcessRunner::run_cancellable` — one defaulted method.
   `SystemProcessRunner` overrides it with `execute_cancellable`; the default
   refuses to launch after a request and then delegates, so a substituted runner
   can never report a mid-run cancellation it did not perform.
4. `TerminateJobObject` with `STATUS_CANCELLED`, then a bounded wait for the
   Job's active-process count to reach zero, then the capture threads are
   joined.

A confirmed cancellation requires the owned job to report `Some(0)`. `None` —
no bounded accounting available — is not a confirmation and produces the
failure instead. `Termination` distinguishes a terminated tree (`Cancelled`)
from a run that never created one (`NotStarted`), so a refusal cannot be
reported with process facts for a process that never existed.

## Measured scenarios

All on the code head above, on the build above, into a private local
destination, with no user input.

| Scenario | Milestone | Milestone at | Request to return | Attempt | Backend exit | Surviving owned processes |
| --- | --- | ---: | ---: | --- | --- | ---: |
| Before run | request precedes the attempt | `0 ms` | `0 ms` | `cancelled_before_run` | no process | not applicable |
| Early | the staged output file first appeared | `352 ms` | `69 ms` | `cancelled_during_run` | `0xC000013A` | `0` |
| Mid-write | the staged file was observed growing | `372 ms` | `73 ms` | `cancelled_during_run` | `0xC000013A` | `0` |
| Natural-exit race | the measured natural backend duration, from the launch | `1,117 ms` | `37 ms` | `cancelled_during_run` | `0` | `0` |
| Request after exit | issued once the process was observed to exit | not applicable | not applicable | `finalized` | `0` | not applicable |
| Thermo, early | the staged output file first appeared | `378 ms` | `75 ms` | `cancelled_during_run` | `0xC000013A` | `0` |

`0xC000013A` is `STATUS_CONTROL_C_EXIT`, the code `TerminateJobObject` is called
with. Rust reports it as `-1073741510`.

The executor asks for the request twice: once when it is called, and again
immediately before it spawns. The three checks between them include a hash of
the whole backend executable, so a request arriving inside that window is one
that unambiguously preceded process creation, and it launches nothing. What
remains is the interval stable `std::process` leaves between deciding to spawn
and spawning — the same one the documented spawn-to-assignment race lives in.

## Partial output

| Scenario | Staged bytes, first observed | Staged bytes, last observed | Growth seen | Staged entries at settle | Non-empty file at settle | Partial-name suffix |
| --- | ---: | ---: | --- | ---: | --- | --- |
| Early | `47,363` | `47,363` | no | `1` | **`true`** | `false` |
| Mid-write | `0` | `95,363` | **yes** | `1` | **`true`** | `false` |
| Natural-exit race | `0` | `12,283,960` | **yes** | `1` | **`true`** | `false` |
| Thermo, early | `0` | `0` | no | `1` | `false` | `false` |

Four facts come out of this and all four are load-bearing.

**A partial output exists and it is observable.** The mid-write run was
terminated with `95,363` bytes on disk of what would have been `12,283,969`.
The race run was terminated `9` bytes short of the finished size. There is
nothing hypothetical about the state a cancellation has to clean up.

**This build writes directly under the planned name and grows the file in
place.** No `.part`, `.partial` or `.tmp` suffix appeared in any observation, at
any milestone, on either workload, across every run taken. A partial output is
therefore *indistinguishable from a finished one by name*. That is the
measurement that makes private staging a requirement rather than a preference:
pointed at the destination root, this backend would leave a truncated `.mzML` in
the user's folder under exactly the name a good conversion takes.

**The staged file appears before it is complete but not reliably before it has
content.** Its first observation was `0` bytes in some runs and already tens of
kilobytes in others, at a `10 ms` poll interval. "The staged output exists" is
therefore a milestone that fires early, and it is not evidence that the file was
empty when it did.

**Nothing else is written, even mid-write.** Every observation held exactly one
staging entry and zero directories, on both source families. No sidecar, index,
log or scratch entry appeared, including in runs terminated while the backend
was writing.

## Destination and cleanup

| Scenario | Destination entries afterwards | Staging removed | Cleanup residue | Finalized output |
| --- | ---: | --- | --- | --- |
| Before run | `0` | yes | none | no |
| Early | `0` | yes | none | no |
| Mid-write | `0` | yes | none | no |
| Natural-exit race | `0` | yes | none | no |
| Request after exit | `1` regular file, `.mzML`, `12,283,969` bytes | yes | none | **yes** |
| Thermo, early | `0` | yes | none | no |

Every cancelled run left the destination root exactly as it found it. The
staging area — including the partial document inside it — was removed by
identity-bound teardown in every case, with no residue. Handle-bound
finalization never ran on a cancelled attempt, and `finalized()` is `None` on
every cancellation result by construction rather than by convention.

The absence of residue is also independent evidence about the process tree. Had
any descendant survived holding the staged file open, Windows would have refused
its removal and the run would have reported a residue. It reported none, and the
Job's own active-process count reported `0`, twice over.

## Ordering rule

One rule: **observation order inside the supervision loop decides.**

Each poll consults `try_wait` before the cancellation flag. A completion already
observed makes the run an ordinary exit; a request observed while the process is
still running makes successful Job termination decisive.

Both halves are measured.

- **Cancellation wins when termination is accepted first.** The race run
  requested `1,117 ms` after the launch, against a `1,116 ms` measured backend,
  and reported `cancelled_during_run` with an exit code of **`0`** — the process
  finished its work inside the window between `try_wait` reporting "still
  running" and `TerminateJobObject` landing, `9` bytes short of the finished
  size. Nothing was finalized and the destination root stayed empty.

  That exit code is the shape of this rule that is easiest to get wrong, and it
  is why the rule is stated in terms of observation order rather than exit
  status. Other runs of the same scenario caught a process still well short of
  the end and terminated it with `STATUS_CANCELLED`; at least one resolved the
  other way and finalized. All three are the same rule, and the outcome is
  never ambiguous: a request the boundary acted on yields no output, whatever
  the racing process then reports, and a completion observed first yields the
  document it produced. Which one a given run gets is a race and is not
  reproducible on demand.
- **Natural completion wins when it is observed first.** Proved
  deterministically rather than by luck: a runner issues the request only after
  the real process has returned an ordinary exit. Result: `finalized`, one
  `12,283,969`-byte output in the destination root, no residue. A request that
  arrives after completion was observed does not relabel the run and does not
  discard the document it produced.

Only one is ever reported. There is no state that is both.

## Thermo-route evidence

Recorded separately from the process and partial-output evidence, because it
supports less.

The evidenced vendor reader was terminated while it was running: the request was
made once the reader had created its staged output, the process ran `468 ms`,
exited `STATUS_CANCELLED`, left zero surviving owned processes, and its staged
entry was removed with no residue. The destination root stayed empty.

The milestone matters and is recorded because the first attempt at it was wrong.
Asking as soon as the *staging area* existed produced a correct but useless
result: the executor hashes the backend executable before it spawns, so the
request was refused before any process was created, and a refusal says nothing
about a vendor reader. The milestone is now a staged entry, which only the
reader itself can write.

**Not established for the vendor route:** any mid-write observation. The staged
entry was still `0` bytes when the reader was terminated, so no partial vendor
document was seen. The one lawful fixture is `78,309` bytes; whether a large
Thermo acquisition exposes a growing partial output is unmeasured, and nothing
here may be read as saying it does.

Nothing about vendor support is widened by this. One family, one build, one
fixture, exactly as ADR 0010 admitted it.

## Streams

No capture was truncated on any run, cancelled or completed, and no capture
deadlocked. A separate deterministic test pushes `512 KiB` through each pipe —
comfortably past a Windows pipe buffer, and the same volume through both, so a
capture thread that abandoned one of them would block the child rather than pass
unnoticed — and cancels while the child is still attached. The supervisor
completes, the Job empties, and each total is recovered and asserted
separately. The capture threads start before the wait rather than
after it, which is why a backend that has outrun a pipe cannot wedge the
supervisor.

## Supported claims

- On build `3.0.26013 (47b13cf)`, a real `msconvert` process launched through
  the reviewed boundary and assigned to an owned Job Object is terminated on
  request, and the Job reports no surviving process afterwards.
- Termination was confirmed in `37`–`75 ms` from request to result, in the
  four measured runs that terminated a running process, across two source
  families.
- A request made before an attempt begins launches no process, creates no
  staging area and leaves the destination root untouched.
- A partial document exists during a real conversion, is removed by
  identity-bound cleanup after a cancellation, and never receives the final
  name.
- No cancelled run produced an output in the destination root, and no cancelled
  run reported a finalized conversion.
- A request the boundary could not confirm is a distinct typed failure, not a
  cancellation.
- The evidenced Thermo vendor reader can be terminated through the same path.
- `run_conversion` is unchanged for every caller that supplies no cancellation
  object.

## Unsupported claims

- **No product claim.** Nothing a user can reach starts a cancellable
  conversion. There is no `Cancel` button, no Tauri command, no transfer object
  and no queue semantics. The visible queue is still uncancellable and still
  says so.
- **No claim about a mid-write vendor cancellation.** The Thermo run wrote
  nothing before it was terminated.
- **No claim about other builds.** The gate refuses anything but the digest
  above, and this evidence says nothing about a different release, revision or
  executable.
- **No claim about other vendors or formats.** Bruker and Waters remain
  unrecognised; mzXML remains unplannable.
- **No latency budget.** Every timing here is a single observation on one
  machine. No threshold derives from any of them.
- **No claim about a partial output's contents.** The harness records byte
  counts and shapes. It never opens a partial document, and a truncated mzML is
  not judged against anything.
- **No claim about cancellation under a full or failing disk, a locked staging
  area, or a backend that ignores termination.** The unconfirmed-termination
  path is typed and tested against a substituted runner; it has not been
  provoked from a real one.
- **No retryability claim.** A cancelled attempt is not classified as retryable
  or not retryable anywhere, because nothing reaches a classifier.
- **Overwrite semantics, progress and locale** remain exactly as unmeasured as
  ADR 0009 records.

## Reproduction

The Thermo fixture is not tracked. Acquire it from the pinned URL in the
[M3.0.3 record](M3_VENDOR_RAW_EVIDENCE.md), verify the byte length and SHA-256,
then:

```text
cargo run --locked -p mscanvas-proteowizard --example conversion_cancellation_evidence -- \
    --workspace <empty-scratch-directory> \
    [--spectra <count>] [--peaks <count>] \
    [--thermo-input <external-fixture-path>] \
    [--proteowizard-home <dir>]
```

The workspace must be empty, is held open for the harness's lifetime so its name
cannot be repointed under the cleanup, and everything created inside it —
including the generated workload and every converted output — is removed before
the harness returns. The harness prints only shapes: no path, no acquisition
name, no raw backend stream. Without `--thermo-input` the vendor scenario is
skipped and says so rather than being quietly absent.

Ordinary CI runs none of this, downloads nothing and reaches no backend. The
deterministic coverage of the same behaviour is 319 tests in
`mscanvas-proteowizard`, plus two beside the harness itself, none of which needs
an installation.

## Mutation evidence

Fifteen mutations were applied one at a time against the code head above, and
each was caught by the test written for it.

| Mutation | Caught by |
| --- | --- |
| The system runner ignores its cancellation token | `the_system_runner_cancels_the_owned_tree_through_its_cancellable_entry_point` |
| The default runner ignores a request already made | `the_default_runner_refuses_to_launch_after_a_request_and_delegates_otherwise` |
| The parent is killed while the owned job is left alone | `cancellation_terminates_an_owned_mock_process_tree` |
| A cancellation is reported before the owned tree is confirmed empty | `a_cancellation_claimed_before_the_owned_tree_is_empty_is_a_failure` |
| A natural exit is relabelled cancelled because a request was pending | `a_request_that_arrives_after_a_natural_exit_still_finalizes_the_conversion`, `a_natural_backend_failure_is_never_relabelled_as_a_cancellation` |
| A partial staged document reaches finalization | `a_cancelled_run_removes_its_partial_output_and_finalizes_nothing`, `a_cancelled_run_removes_a_nested_tree_the_backend_left_behind` |
| Identity-bound cleanup is skipped after a cancellation | the two above, plus `a_termination_that_could_not_be_confirmed_is_a_distinct_failure` |
| A termination failure is reported as a cancellation | `a_termination_that_could_not_be_confirmed_is_a_distinct_failure`, `every_attempt_renders_a_distinct_identifier_and_no_path` |
| Both pre-launch refusals are dropped | `a_request_made_before_the_run_reaches_no_backend_and_creates_no_staging_area`, `a_request_made_before_the_launch_decision_creates_no_staging_area` |
| Absent owned-job accounting accepted as a confirmed cancellation | `a_cancellation_with_no_owned_job_accounting_is_a_failure` |
| A refusal inside the runner claims a backend ran | `a_refusal_inside_the_runner_reports_no_backend_and_an_empty_staging_area` |
| A refusal reports an empty owned job instead of no job | `a_request_made_before_the_run_launches_no_process_at_all`, and the two runner-entry-point tests |
| A refusal is described as a terminated process | `cancellation_is_not_classified_as_failure` |
| The executor stops asking before it spawns | `a_request_that_lands_during_the_pre_spawn_checks_launches_nothing` |
| One capture thread stops draining | `cancellation_completes_while_a_child_is_filling_its_output_pipes` |

One of the first nine survived on first application and is recorded here because
the repair is the interesting part. Dropping the refusal that sits between the
source rehash and the staging creation changed no destination and left no
residue, so nothing failed — but it made the run report that a backend had run
when none had, and create and remove a directory for nothing. The test that
names that property was written and the mutation now dies.

The last six of the fifteen exist because review found the holes they close,
not because a mutation found them. They are recorded in the same table because a
hole a reviewer names and a hole a mutation names both need a test that dies
without the fix, and these now have one each.

Two mutations from the intended set are **structurally unreachable** and are
recorded as such rather than claimed as kills:

- **A cancellation object controls a second run.** It does not compile.
  `ConversionCancellation` is not `Clone` and is taken by value, so a second use
  is a use-after-move.
- **A raw process identifier is exposed.** There is nothing to expose.
  `ProcessOutput` has never carried a process identifier, so a cancellation
  report could only acquire one by the process boundary first growing a field it
  does not have.

No broad mutation campaign was run over the queue or workspace code.

## Cleanup

The downloaded Thermo fixture, the generated mzML workload, every converted
output, every staging root and every scratch directory this evidence created
were removed. No child process survived any scenario, confirmed by the owned
Job's own accounting and by the absence of any sharing violation during
teardown. Nothing vendor-derived is tracked, and no ProteoWizard binary, DLL or
licence payload was copied into the repository.
