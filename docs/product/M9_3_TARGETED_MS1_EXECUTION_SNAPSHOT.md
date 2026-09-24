# M9.3 record — content-bound execution snapshots and bounded attempt lifecycle

Status: **M9.3 COMPLETE — CROSS-VOLUME EXECUTION SNAPSHOT AND SAFE ATTEMPT
RECOVERY.** Date: 2026-09-24, after the M9.3.C1 closure repair. Tested code
`c69889ba840a67072ebbaed5a32e1d2ede20a1b3` (M9.3 itself was first closed on
`23ba012` on 2026-09-23). Branch
`feat/m9.3-content-bound-execution-snapshot`, from the M9.2 endpoint
`d1d9f586bef73715fc4bddf39795498059c0fada`. Decision:
[ADR 0049](../architecture/adr/0049-content-bound-execution-snapshot.md).
Evidence: [M9.3 evidence](../spikes/M9_3_TARGETED_MS1_EXECUTION_SNAPSHOT_EVIDENCE.md).
Builds on the [M9.1 record](M9_1_TARGETED_MS1_HANDOFF.md#m91-record) and the
[M9.2 record](M9_2_TARGETED_MS1_RESULT_REUSE.md).

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.4
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT
RELEASED; M10 NOT STARTED

## Scope

M9.3 changes how the exact approved bytes of a targeted MS1 source are
presented to the same fixed worker, and cleans up after attempts. It does not
change what the worker computes: the recipe, the adapter, the runtime,
pyOpenMS, the tolerances, the target semantics, the fitting and the outcome
taxonomy are M9.1's, and so are the plan, run, attempt, artifact and schema-4
identities. Not in scope and not done: multi-file analysis, a second recipe,
runtime packaging, network shares, general project or payload garbage
collection, crash resume, and M9.4.

## What a user can do

In a saved project, on a layer whose source is one supported mzML file:

1. **Run a source from any local drive.** A source on the MSCanvas work area's
   drive runs as in M9.1, through a read-only link. A source on another drive —
   including one under a path with non-ASCII characters — now runs too, and so
   does one on the same drive where no link can be made: while MSCanvas makes a
   temporary copy the run shows **Preparing analysis input…**, and the run can
   be cancelled there like anywhere else.
2. **See why a run cannot start or did not finish**, in the recipe's own words:
   - at review, and again when Run is pressed: *the drive holding the MSCanvas
     work area has less free space than this source needs for its temporary
     copy* (`insufficientWorkAreaSpace`), said only after the crash-left
     scratch a sweep can prove abandoned has been removed — nothing is run or
     recorded; free space and try again. This is asked only where the source
     is proven to be on another drive; a same-drive copy after a failed link
     meets its space at run time;
   - as a failed run at the source stage: the source changed since the plan
     (`sourceChanged`), could not be read (`sourceUnavailable`), the work
     area's drive or the user's quota on it ran out of room while the copy or
     the worker's request was written (`insufficientWorkAreaSpace`), or
     MSCanvas could not prepare the source for the engine
     (`executionViewUnavailable`). None of them is a finding about a target.
3. **Read in Details how the engine was given the source**: *in place, through
   a read-only link* or *from a temporary copy in the MSCanvas work area,
   checked to hold exactly the plan's bytes before the engine read it*. Never
   where: no work-area path, drive or scratch name is shown or stored.

Copying is not conversion: the copy's bytes are the source's bytes, and the
plan, the result and the record are the same as for a link.

## Rules

| Rule | Where |
| --- | --- |
| The source is opened once, read-only with write and delete sharing withheld, before any byte is read; the view is chosen from that handle's volume | `targeted_ms1.rs`, `execution_view` |
| A source that can be linked is linked, never copied; a link that cannot be made falls back to a copy read again through the same handle; a link that is not the held object fails the run and is never replaced by a copy | `execution_view` |
| A copy is made in one read through the held handle, each chunk hashed as it is written, and refused unless its length and SHA-256 are the plan's; it is then held read-only and hashed again before the worker is given its name | `observe.rs` `copy_into`; `targeted_ms1.rs` `snapshot` |
| The source is released once the copy is verified; the run is bound to the bytes, which were the plan's | `snapshot` |
| A copy the work area provably cannot hold, even once the crash-left scratch a sweep can prove abandoned is removed, is refused before a run exists; one that runs out of room fails at the source stage | `preflight`, `room_after_reclaiming` |
| A cancel during the copy, or while it is hashed again, stops between 64 KiB chunks and starts no worker; consumed content is recorded only once the source was read whole | `Cooperative` reader, `snapshot` |
| Every attempt directory is marked before use, removed marker last when its attempt ends, and kept while an unaccounted worker may use it | `targeted_ms1/scratch.rs` |
| Each attempt first removes crash-left attempt directories whose owner process is gone, and nothing it cannot prove is one; a preflight does the same before refusing for want of room | `scratch::sweep` |
| A sweep never unlinks a link, however many names its bytes have: a gone owner's directory holding a link is kept whole (`linked`), and no directory removal ever unlinks the link name; only the attempt that made a link unlinks it, while it holds the source (M9.3.C1) | `scratch::classify`, `remove_owned`, `ExecutionView::drop` |
| A link's name is removed while the source is still held | `ExecutionView::drop` |
| Reading, drawing or exporting a stored result never opens, copies or inspects a source | unchanged from M9.2 |

## Records

`attempt.sourceView` is `hardLinkInWorkArea` or, new in M9.3,
`verifiedSnapshotInWorkArea`. `FailureCode` gains `insufficientWorkAreaSpace`.
Both are additions to schema 4, which does not advance: a schema-5 bump would
refuse every M9.1/M9.2 project. An M9.1 or M9.2 build refuses a document that
carries either word. `RunPhase` gains `preparingInput`, which is session-only.
The refusal `sourceOnAnotherVolume` no longer exists; `insufficientWorkAreaSpace`
is its only successor.

## The work area

`.tmp/m91-jobs/attempts/<uuid>/` in a development checkout, as in M9.1. An
attempt directory holds `owner.json` (schema, attempt id, owner process id and
creation time), the view (`source.mzML` for a link, `snapshot.mzML` for a
copy), the request, the adapter and what the worker wrote. No new host storage
is used: not `%TEMP%`, not `%LOCALAPPDATA%`, not a drive root.

## Known limits

- **Development runtime only**, as in M9.1: a release build has no runtime and
  every review answers `recipeUnavailable`.
- **Space.** A copy needs free space for one source-sized file on the work
  area's drive while it runs. The check before a run is an observation, not a
  reservation.
- **Time.** A copy costs a full read of the source and a full read of the
  copy. Measured copy-and-verify times (0.30 s for 156 MB, 0.88 s for 482 MB)
  were taken right after the test wrote its own source and are not throughput
  figures; see the evidence.
- **What a copy can and cannot promise.** It is exactly the plan's bytes when
  the worker is given it, and it is held read-only while the worker reads it.
  It is not a claim that the original stayed unchanged afterwards, nor that
  Windows provides an immutable snapshot; see ADR 0049 for what is protected
  and what is only detected.
- **Crash-left scratch.** Only marked attempt directories whose owner process
  is gone are removed, at the start of a later attempt or before a preflight
  refuses for want of room; nothing is swept on startup, and what a sweep
  leaves is not shown in the interface. A plan review does not wait for a run
  in progress, so two sweeps can overlap in one session. A directory that is
  emptied but cannot itself be removed is left empty and unmarked. Attempt
  directories from before M9.3 carry no marker and are never removed.
- **Retained links (M9.3.C1).** A crash-left link attempt — a crash or a kill
  during a same-drive run, a session quarantined by a worker it could not
  account for, an attempt whose own removal of its link failed (another
  program had it open), or an entry at the link name that was not shown to be
  the held source — is never removed automatically. It costs one directory entry
  while the user's own name for the source exists; if the user later deletes
  that name, the retained link alone keeps the file's space allocated, and
  nothing in MSCanvas reclaims it or tells anyone it is there. Removing one is
  left to a person, or to a future explicit tool; M9.3 has none.
- **What the worker writes.** Running out of room while the worker itself
  writes its output is the worker's own failure, as in M9.1, and is not
  classified as `insufficientWorkAreaSpace`.
- **Not reclaimed:** the payload store's own `.staging/` left by a crash,
  beside the user's document.
- **Not qualified:** network shares, removable media that disappear mid-copy
  beyond the typed `sourceUnavailable`, FAT/exFAT work areas, and a volume
  that reports no file identity. A link that cannot be made is exercised by
  occupying the link's name, not on a volume without links.

## Unchanged M9.2 limitations

Recorded as M9.2 left them and not touched here: no clipboard copy of a stored
result; native save dialogs not truly qualified; a PNG is not self-describing
the way SVG and CSV are; a spreadsheet may interpret a table cell as a
formula; the whole browser suite remains historically red (`pnpm
e2e:browser`: exit 1, 7 spec files passed and 20 failed, in M9.1).
