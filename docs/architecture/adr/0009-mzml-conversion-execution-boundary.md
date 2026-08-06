# ADR 0009 — mzML conversion execution and output-safety boundary

- Status: Accepted for the private M3.0 conversion foundation; every user-visible
  conversion surface, every additional source posture and every queue concern
  separately gated
- Date: 2026-08-06

## Context

[ADR 0002](0002-external-proteowizard.md) decided *which* backend converts and
*how* it is invoked — a user-installed ProteoWizard, reached through typed argv
arrays, never bundled and never downloaded. It decided nothing about where the
output lands, what happens when that name is taken, or what has to be true
before a produced file is allowed to be called a result. No other ADR does
either: [0005](0005-mzml-preview-boundary.md), [0007](0007-logical-acquisition-discovery-and-folder-traversal.md)
and [0008](0008-windows-explorer-drag-and-drop.md) each explicitly place the
conversion workflow outside their boundary, and 0007 records that "the
task/cancellation protocol overlaps the future conversion queue and needs its
own decision".

The pieces exist. `mscanvas-proteowizard` already owns capability-gated
`msconvert` planning, 128-bit source identity capture with pre-spawn recapture,
a supervised Windows Job Object executor with an allowlisted child environment,
a fail-closed mzML scanner, and a typed source/output integrity comparison that
separates required invariants from advisory observations and unverifiable ones.

What did not exist is the thing that joins them. The plan → capture source →
execute → validate → deliver sequence lived only in
`examples/m0_proteowizard_spike.rs`, an explicitly unstable developer harness,
which also carried a stricter output-directory precondition than the library and
its own vocabulary for "this source cannot be compared". Nowhere in the
repository was there a temporary-then-final output lifecycle at all: the plan
pointed `msconvert` straight at the final name, and a partial or rejected output
would have been written next to the user's files under exactly the name a
successful one takes.

Two facts constrain what this decision may claim. No lawful vendor RAW fixture
exists or is authorized in this repository, and vendor RAW coverage is rated
**D** in the [M0 spike](../../spikes/M0_PROTEOWIZARD_SPIKE.md). Real backend
cancellation and partial-output behavior are also **D**: the only measured
conversion completed in 136 ms, below the evidence harness's safe-cancellation
threshold, and the controlled Job Object tests are process-contract evidence
rather than a ProteoWizard claim.

## Decision

`mscanvas-proteowizard` owns a private conversion boundary — one immutable plan,
one staged execution, one no-clobber finalization — with no Tauri command, no
transfer object and no user-visible surface built on it in this slice.

### Source authority

A source is a validated object, never a path, a name or an extension. The only
constructor opens the file, refuses anything that is not a regular file,
canonicalizes it, binds it to its filesystem identity, hashes it and reads it as
mzML. A name that merely ends in `.mzML` does not produce one. Nothing outside
Rust supplies a path, because nothing outside Rust can reach this boundary at
all.

### Supported source posture

Exactly one source kind is expressible: a regular file that read as mzML. There
is no vendor variant and no directory variant, not even as an unconstructed enum
variant — the same rule [ADR 0006](0006-multi-dataset-workspace-boundary.md)
applies to the workspace registry, for the same reason. Recognizing a source
family MSCanvas cannot yet convert is the claim the evidence does not support.

This means the boundary is honest but narrow: today it converts mzML to mzML.
That is not the product goal, it is what the evidence permits, and the shape it
establishes — plan, stage, validate, finalize — is the shape a vendor source
will use once a source posture for one exists.

### Typed plan

One immutable `ConversionPlan` states a Rust-owned source, an mzML output, the
destination root, the deterministic name derived from the source stem, the
conflict policy, and the compression the integrity contract is entitled to
assume. Every decision is fixed when the plan is formed; nothing is re-decided
during the run. The scan limits that read the source are the same limits that
judge the output, so the two cannot drift.

mzXML is not expressible. The only constructor produces mzML, and planning
`msconvert` for mzXML already fails closed. No processing setting beyond the
compression the repository already evidences is added: no filter, no
peak-picking, no MS-level selection, no precision selection.

### Provider execution

The existing execution boundary is reused unchanged, through the already-exported
`ProcessRunner` trait, so production goes through the same reviewed `execute`
path with its pre-spawn identity rechecks, owned Job Object, allowlisted child
environment and bounded capture. No second subprocess runner exists, and no
command line is built from shell text. Tests substitute a runner at that seam
rather than reaching a backend.

### Output-root authority and conflict policy

The destination root is a Rust-owned, canonicalized, existing directory. The
output name is derived from the source, never supplied.

The conflict policy is `Fail` or `Skip`. There is no overwrite variant to
select. Replacing a file the user already has is not a policy this boundary can
be asked for, and a later explicit-confirmation flow would be a new decision
rather than a new enum value used quietly.

### Temporary output and finalization

The backend never writes into the destination root. Each run creates a private
staging directory inside that root, named deterministically from the planned
output name, and points `msconvert` at that directory instead. The staging
directory is created with an exclusive create: an existing one is refused
untouched rather than adopted, because it may belong to a run still in flight.

Because the staging directory holds only what this run produced, the existing
integrity contract's requirement of exactly one planned entry becomes meaningful
— an extra file the backend emitted is detected instead of being lost among the
user's own files. That rule cuts both ways, and the other direction is
unmeasured: the staging directory is also the backend's working directory, so a
scratch or sidecar file `msconvert` writes into its own working directory would
turn a faithful conversion into a rejection. No real-backend evidence exists
either way; it is recorded as a gate below rather than assumed benign.

Finalization is a no-clobber move of the validated output onto its final name:
`MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` on Windows, a hard link
followed by cleanup elsewhere. Both fail rather than replace. Staging and
destination share a filesystem by construction, so the move is a rename.

Behavior is defined for every branch:

| Condition | Result |
|---|---|
| Final target already exists | `Fail` reports it; `Skip` reports work that was not needed. The backend never runs. |
| Temporary target already exists | Refused. Nothing in it is written or removed. |
| Process failure | Reported with its exit code. The staging directory and everything in it is discarded. |
| Validation failure | Reported as the integrity outcome. The rejected document is discarded. |
| Final target appears during the run | Refused. What arrived keeps the name and its contents. |
| Finalization fails otherwise | Reported with a bounded error kind. Nothing reaches the destination root. |
| Cleanup fails | Recorded beside the outcome, never instead of it. A finalized conversion stays finalized and a failure keeps its primary cause. |

A partial file is therefore never reported as a successful output, and never
reaches the destination root under any name. The staging directory is owned for
the lifetime of the run rather than discarded by a call, so an unwind through
the caller-supplied runner cannot leave it behind.

Two windows remain open and are stated rather than claimed closed. The
validated bytes are not re-bound to a handle across the move, so what takes the
final name is provably the file that was judged only in the absence of an
outside writer with access to the destination root. And cleanup removes the
staging directory by path rather than by identity, so a directory replaced at
that path between creation and cleanup would be removed instead. Both need an
actor with write access to the destination root while a run is in flight, and
this is the same class of window the process boundary beside it already accepts
and documents rather than a new one. Closing the first properly means
finalizing through a handle the validation itself held, which changes
`verify_mzml_conversion`'s contract; a path recheck before the move would only
narrow it while reading as though it had closed it, so neither is done here and
the handle-bound finalization is recorded as a follow-up.

Refusing an existing staging area is right, and on its own it is also a trap: a
single cleanup failure leaves a deterministically named directory that makes
every later run of that plan refuse, and a path-free failure cannot say which
name to remove. The plan therefore offers an explicit `reclaim_staging_area`,
which the caller invokes when it decides no run of that plan is in flight.
Nothing adopts a staging area silently.

Reclamation is bounded by ownership rather than by name. A staging area carries
a marker file written as it is created, and a directory without that marker is
refused untouched however it is named — the staging name is deterministic, so a
user may hold it too, and deleting a tree on the strength of a name is how
unrelated data gets destroyed. The marker is why the staging area has an inner
directory: the integrity contract requires the output directory to hold exactly
one planned entry, so the marker owns the staging root and the backend writes
one level below it. Teardown removes the backend's output first and the marker
last, so a cleanup that gives up part-way leaves the proof that makes its own
residue reclaimable. An empty directory is reclaimable too — not because
emptiness proves ownership but because it makes ownership irrelevant, and
because removing the marker before removing the root is exactly what leaves one
behind when the last step fails.

The run is bound to the acquisition the plan admitted. The command builder
reads the source's identity from its path again, so before anything is created
or launched the run rechecks the recorded identity, byte length and hash. Without
that, a source replaced or rewritten between planning and running would be
converted and the post-run comparison would only notice by rejecting a
conversion that should never have happened — and not even that if the original
were restored before it looked, because the integrity scanner never decodes an
array payload. It costs a third read of the source, which a conversion that
already reads it twice can afford.

### Validation

The produced document is judged by the existing mzML conversion-integrity
contract before the final name is taken. Exit status is not consulted for that
judgement; a backend that exits zero and produces nothing, an empty file, a
structurally unusable file or a lossy file is rejected.

The comparison is only made where it means something. It requires mzML source
facts, which is exactly why the only expressible source kind is mzML: this
boundary never applies an mzML-source comparison to a source it could not read
that way and calls the result a fidelity check.

### Cancellation

Out of scope, deliberately. Real backend cancellation and partial-output
behavior are unmeasured, so this boundary requests none and claims none. A
substituted runner that reports a non-ordinary termination is a typed failure
rather than a cancellation feature.

### Privacy

Every result and failure type is path-free and carries a stable identifier.
`ProcessError` retains the executable name and raw operating-system detail for
local diagnostics; the boundary projects it onto a path-free failure instead of
passing it through. The projection is closed on both sides: the stream name a
capture failure carries is a free-form string at the process boundary, so it is
mapped onto a fixed set rather than copied, and a substituted runner cannot put
an arbitrary value into a type whose purpose is to be safe to render. Backend facts are exit code, elapsed time, truncation flags
and peak owned-job memory — raw stdout and stderr are absent, because they can
name the acquisition. The plan and the source render themselves without their
paths or their file names.

## Consequences

- The conversion sequence now exists as library code with deterministic tests.
  The M0 spike keeps its own sequence unchanged, including its stricter
  empty-output-directory precondition, which the recorded M0B output-conflict
  evidence depends on — and including pointing `msconvert` straight at the final
  output name. Two sequences with different output-safety postures therefore
  coexist; the harness is explicitly unstable and developer-only, and retiring
  it is a later decision rather than a claim made here.
- `run_conversion` has never been executed against a real `msconvert`.
  `SystemProcessRunner` is the production runner and reaches the reviewed
  `execute` path, but the type system permits any runner and no evidence run has
  exercised this boundary end to end.
- The output-safety guarantee is Windows-specific in its mechanism, as the
  process-tree and file-identity guarantees around it already are. The
  non-Windows path is correct where hard links are supported and fails a valid
  conversion where they are not; it is not the guarantee this repository claims.
- Finalization is atomic with respect to a concurrent observer, not durable
  across power loss. Nothing is flushed before the move; an unmeasured `fsync`
  of a multi-hundred-megabyte output is a cost this slice does not pay silently.
- `run_conversion` is synchronous and converts one plan. There is no queue, no
  concurrency, no progress and no retry.
- Nothing here is reachable from the product. No Tauri command, transfer object,
  capability or frontend file changed.

## Evidence gates still open

- **Vendor RAW.** No lawful fixture exists or is authorized; coverage is rated
  **D**. No vendor source posture may be added before one does.
- **Real cancellation and partial-output behavior.** Rated **D**. Required
  before a queue can offer cancellation.
- **Backend overwrite semantics.** Never measured: the M0 existing-output case
  was refused by MSCanvas before launch, so what `msconvert` itself does to an
  existing file is unknown. This boundary does not depend on it, and must not
  start depending on it.
- **Whether `msconvert` writes anything besides its output.** Unmeasured, and it
  decides whether the exactly-one-entry rule rejects faithful conversions.
  Required before this boundary is reachable from the product.
- **mzXML.** Rated **C** on demonstrated multi-source spectrum loss. Stays
  unplannable.
- **Progress and locale.** Both **D**. No progress claim, and stderr wording is
  not treated as a protocol.

## Alternatives considered

**Point `msconvert` at the final name and check afterwards.** What the
repository did until now. It cannot distinguish a partial write from a finished
one without trusting a suffix convention, and it leaves the failure case
occupying the successful case's name.

**Stage a temporary file beside the destination rather than in a private
directory.** The planned output name must carry the format's extension, so a
staged file would have to be a second `.mzML` in the user's output root. It also
gives up the exactly-one-entry postcondition, which is what makes an unexpected
extra backend output visible.

**A unique staging name per run.** Would allow concurrent runs to the same
destination root. Those runs collide on the final name anyway, and a
deterministic staging name makes "a staging area already exists" a defined,
testable state instead of a name nobody can reason about. Revisit with the
queue.

**Reuse `NormalizedFailure` for the run result.** It carries raw backend text
and is redacted at the call site. A boundary whose results may cross to a
webview later should be path-free by construction, not by remembering to redact.

## Follow-up slices

1. Handle-bound finalization: have the integrity check hand back the handle it
   read, and finalize through that object rather than through its path, so the
   bytes that take the final name are the bytes that were judged.
2. Per-file conversion results and a narrow Tauri surface over accepted
   workspace datasets, reusing the transfer-object privacy rules of ADR 0005.
3. Queue, failure isolation and retry — and the task/cancellation protocol ADR
   0007 defers, once real cancellation evidence exists.
4. A vendor source posture, gated on an authorized fixture and on the
   directory-acquisition evidence list in ADR 0007.
