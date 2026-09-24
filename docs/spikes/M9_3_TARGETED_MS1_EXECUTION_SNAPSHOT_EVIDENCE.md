# M9.3 — content-bound execution snapshot evidence

Status: **candidate — see the [M9.3 record](../product/M9_3_TARGETED_MS1_EXECUTION_SNAPSHOT.md)
for the milestone line.** Date: 2026-09-23. What was built, its rules and its
limits are in the record and in
[ADR 0049](../architecture/adr/0049-content-bound-execution-snapshot.md); this
document holds what was measured and how.

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.4
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT
RELEASED; M10 NOT STARTED

## Identity

| Binding | Value |
| --- | --- |
| Start (exact M9.2 endpoint) | `d1d9f586bef73715fc4bddf39795498059c0fada`, tree `c437b3bc05d01cfa612b4bb0c9f3d6df06c6e95f` |
| M9.2 tested code under it | `4e4e00ca22526a42a9b070226b126f990aae404b`, tree `a9cceec7537a42df2d611abbfccbbf62c1ce1e93`; `2036baf` and `d1d9f58` are documentation only |
| Branch | `feat/m9.3-content-bound-execution-snapshot`, local only |
| `main` / `origin/main` | `1daf802f06d0149b5de3dbd12e8b01e7e86862ec`, untouched |
| M9.0 / M9.1 / M9.2 branch heads | `1652aff…`, `96f2d8c…`, `d1d9f58…`, untouched |
| Code | `9c09395` (execution views, snapshot, scratch, vocabulary, interface) |
| Browser scenarios | `c823013` |

At the start: branch, HEAD and tree as above, index and worktree clean, no
stash, no operation in progress. `.claude/scheduled_tasks.lock` (git-excluded)
named PID 50140, which was not running; no other writer.

## The primitive, proved before it was wired

`OpenedMember::copy_into` was written and tested in isolation first
(`project/tests.rs`, run before any supervisor change: 8 passed):

| Test | What it shows |
| --- | --- |
| `a_copy_through_the_held_handle_is_the_objects_bytes_and_their_digest` | 307,217 varied bytes: the destination holds exactly the source's bytes, the digest is theirs, the copy was streamed in more than one write with none larger than 64 KiB, and measuring the same handle afterwards gives the same length and digest |
| `a_held_member_cannot_be_changed_deleted_or_renamed_while_it_is_copied` | Held inside the first chunk, the source's name could not be deleted or renamed and the file could not be opened for writing; the copy then finished with the original bytes |
| `a_cancel_during_a_copy_stops_it_between_chunks_with_no_digest` | Cancelled as the third chunk was about to be read: exactly two chunks written, no digest |
| `a_destination_that_refuses_a_chunk_is_named_by_why` | A destination refusing with `StorageFull` after 100 KiB is `DestinationFull` with at most a prefix written; `PermissionDenied` is `DestinationUnwritable`; the same handle then copies whole |
| `an_empty_member_copies_as_empty_with_the_empty_digest` | Zero bytes, the empty SHA-256 |
| `a_volume_says_what_this_process_may_write_and_an_object_how_many_names_it_has` | `available_bytes` answers a positive number for a real directory and nothing for a missing one; `link_count_of` follows a second name being made and removed |

## Real cross-volume execution

The repository (and so the work area) is on `D:`; the system temporary
directory is on `C:`. Both are fixed NTFS volumes of this machine. Each
cross-volume test puts its source in a task-owned directory under the system
temporary directory and **asserts** that the two volume serials differ before
it relies on them. No drive was mounted, no VHD or VM was created and no
partition or host setting was changed.

Real-runtime tests (`#[ignore]`, run with
`cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1`),
all on the pinned runtime and adapter, unchanged:

| Case | Result |
| --- | --- |
| Source on `C:`, two targets, through the store | Review not blocked; completed; caffeine `DETECTED`; consumed content equal to the plan's; `sourceView` `verifiedSnapshotInWorkArea`; source byte-identical; the attempts root afterwards exactly as before; the saved document says `verifiedSnapshotInWorkArea` and none of `m91-jobs`, `attempts`, `snapshot.mzML`, `source.mzML`, `.tmp` |
| … then, with the source moved away | Reopened: `available`; every row and evidence line identical; a figure drawn and a CSV table of both targets built; nothing recorded (M9.2 unchanged) |
| Source on `C:` under `数据 目录/样品 plain.mzML` | Completed through the ASCII copy; `DETECTED`; `verifiedSnapshotInWorkArea` |
| Source on `D:` under a non-ASCII path | Completed through the ASCII link; `DETECTED`; `hardLinkInWorkArea` (the link path unchanged) |
| Crash-left fixtures in the real attempts root, then a real same-volume run | A marked directory naming no live process (id `0xFFFFFFFD`) and one naming this process's id with another creation time were removed; an unmarked UUID directory beside them was left byte-identical; the run completed with `hardLinkInWorkArea` and its result `available` |
| Source on `C:` changed after the plan | Failed `sourceChanged` at `source`; what the copy read recorded and unequal to the plan; no attempt facts; no artifact; no copy left |
| Source on `C:` removed after the plan | Failed `sourceUnavailable` at `source`; nothing consumed; nothing left |
| Cancel as the third copy chunk is read (supervisor) | `Cancelled`, nothing consumed, no attempt facts, `workerTerminated` and `exitObserved` false; `preparingInput` reported and `loadingSource` never; no partial copy or staging left; source intact |
| Worker fails after a verified copy (an adapter that exits 7) | Failed `workerExitedAbnormally`; consumed equal to the plan; `verifiedSnapshotInWorkArea`; no copy left |
| Result cannot be staged after a verified copy and a completed worker (a file where `.staging` goes) | Failed `payloadNotPublished` at `publish`; `verifiedSnapshotInWorkArea`; nothing published; the blocking file untouched; no copy left |
| Preflight with the real volumes | The plan as is passes; the same plan expecting `u64::MAX / 2` bytes from `C:` is refused `insufficientWorkAreaSpace`; from `D:` it passes, because nothing is copied |

Every M9.1 and M9.2 real-runtime case passed unchanged in the same run.

## Simulated, not physical

- **A full destination.** No volume was filled. `StorageFull` from the
  destination is simulated by a writer that refuses after a set number of
  bytes; its classification to `insufficientWorkAreaSpace` is a direct mapping
  in `snapshot`. The preflight refusal is exercised on the real volumes with a
  plan that expects more bytes than either has free.
- **The crash.** No process was killed mid-attempt. A crash-left directory is a
  fixture: marked, its owner an id no process has, or this process's id with
  another creation time, or a real child process that has exited and been
  reaped. A running child keeps its directory.
- **A volume without hard links or file identities**, FAT/exFAT and network
  shares were not available and were not run.

## Scratch ownership and the sweep (`targeted_ms1/scratch.rs`)

| Test | What it shows |
| --- | --- |
| `the_owner_decision_is_the_id_and_the_creation_time_together` | Same creation time: alive; another time or no such process: gone; not askable: unknown |
| `this_process_is_alive_and_an_id_nobody_has_is_gone` | Against the real process table |
| `a_sweep_removes_only_scratch_whose_owner_is_gone` | 2 removed (no such process; reused id), 1 live (this process), 6 unowned left as found: no marker, a marker naming another directory, an unreadable marker, a non-UUID name, a loose file, an upper-case UUID |
| `a_process_that_has_exited_is_gone_and_one_that_runs_is_not` | A real `cmd` child that exited and was reaped: removed; one waiting on its input: kept whole |
| `a_source_link_that_may_be_the_last_name_of_its_bytes_keeps_its_directory` | A link whose original still exists: removed, original intact; a link whose other name was deleted: directory kept, bytes readable, marker kept |
| `a_removal_that_cannot_finish_keeps_its_marker_for_the_next_sweep` | A scratch file held without delete sharing: uncertain, marker and file kept; released: removed next sweep |
| `an_attempt_directory_is_marked_before_use_and_removed_with_everything_in_it` | Marker names the directory and this process; a dropped directory goes whole; a kept one stays, and a sweep in the same session counts it live |

## Resources

`measure_a_verified_copy_between_volumes` (opt-in; `MSCANVAS_M93_MEASURE`
names the fixture, which is only read, to make the test's own copy on `C:`).
It measures the supervisor's `snapshot` itself — copy, compare, release,
re-hold and re-hash — from `C:` into a directory under `.tmp/m91-jobs/tests/`
on `D:`, then a second copy cancelled as its middle chunk is about to be read.
Peak memory is the test process's `K32GetProcessMemoryInfo`. Records under
`test-results/m9.3/measure/`.

| Fixture | Bytes | Copy and verify | Peak working set before → after | Peak private bytes | Cancel → return | Partial copy |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| M9.0 `ctl_large.mzML` | 156,168,011 | 0.28 s | 8,273,920 → 8,613,888 | 1,339,392, unchanged | 0.1 ms (chunk 1,191) | 77,987,840 |
| M7.4 `synthetic-long.mzML` | 482,478,703 | 0.87 s | 8,273,920 → 8,613,888 | 1,335,296, unchanged | 0.14 ms (chunk 3,681) | 241,172,480 |

Peak memory did not grow with the source: a file three times larger left the
same peak working set and the same peak private bytes, which is what a bounded
stream of 64 KiB chunks predicts. The times were taken right after the test
wrote its own source, so both reads were largely served from the file cache;
they are **not** throughput figures for either drive and promise nothing about
a cold or slower volume.

## Rendered interface

Unit (Vitest, jsdom), `apps/desktop/src/features/project/TargetedMs1.test.tsx`:
the `insufficientWorkAreaSpace` refusal before a run; the `preparingInput`
phase text with no work-area name on the page; a failed run with
`insufficientWorkAreaSpace` said as a failure and never as an absence, with no
rows read; Details saying the link for the default fixture and the verified
copy for a copied run, with no work-area name.

Browser (real Chrome, real Vite, mocked IPC), the M9.1 spec alone, with an
M9.3 section: the preparing phase with its Cancel at 1366×768; Details naming
the verified copy at 1366×768 and 960×640; the review blocked for want of
room with Run unavailable and no run command sent; the same phase and Details
in Simplified Chinese. Each frame asserts no horizontal overflow, no absolute
path, no layer identifier, no off-origin request and a clean console, and
scrolls its subject into view. This is layout and interaction evidence over a
controlled answer table; no worker ran.

## Isolated review

Pending.

## Validation record

Pending.
