# ADR 0009 — mzML conversion execution and output-safety boundary

- Status: Accepted for the private M3.0 conversion foundation; amended 2026-08-06
  by M3.0.1 for handle-bound finalization and 2026-08-07 by M3.0.2 for
  identity-bound staging cleanup; the vendor-source and output-layout gates
  below are closed by
  [ADR 0010](0010-first-vendor-raw-source-admission.md); every user-visible
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

**Superseded in part by [ADR 0010](0010-first-vendor-raw-source-admission.md),
which admits one named vendor family on one tested provider build.** The rule
below is unchanged and is what that ADR had to satisfy: a family is expressible
only once it has been converted from a lawful fixture on a real backend, and it
is named exactly rather than generically.

Exactly one source kind was expressible when this ADR was written: a regular file
that read as mzML. There
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

The destination root is a Rust-owned, canonicalized, existing directory, and it is admitted as an object rather than as a name: the plan records its
filesystem identity and the run refuses to create or finalize anything under a path that now resolves to a different directory. A plan can outlive the
directory the caller chose — a queue makes that ordinary — and a root replaced by another directory, or by a link to one, is not the root that was
accepted.

The output name is derived from the source, never supplied. A name the naming rule would otherwise accept is still refused when the staging name built
from it would exceed a filesystem name component, so that is a stated plan-time refusal rather than an opaque operating-system failure once a run is
under way.

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

Finalization is a no-clobber move of the validated output onto its final name.
Both fail rather than replace. Staging and destination share a filesystem by
construction, so the move is a rename. The M3.0.1 amendment below replaces the
mechanism this originally used with one bound to the validated object.

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

**Amended 2026-08-06 (M3.0.1): finalization is bound to the validated object.**

Validation no longer describes the file it read and let go. Verifying a
conversion now returns the object itself: one handle, opened once with the
access a rename needs, which the scan and the digest both read through, carried
out of the judgement inside a `ValidatedConversionOutput` that owns it. There is
no constructor that takes a path, no `Clone`, and an opaque `Debug`.

Finalization consumes that value and renames the object the handle names —
`SetFileInformationByHandle` with `FileRenameInfo`, whose source is the open
file object rather than any name. On Windows the staged path is never resolved a
second time and does not need to still mean anything: replacing it after the
judgement cannot put unjudged bytes under the final name, because the kernel is
not asked about that name. Outside Windows the standard library offers no
object-bound rename, so that platform still links from the staged name and the
guarantee there is narrower; it is not claimed. Consuming the value is also what makes an object finalizable
once. The prior window is closed rather than narrowed; a recheck before the move
was considered and rejected, because it would only shorten the interval while
reading as though it had removed it.

Binding the rename to the object settles which object is finalized, not what is
in it, so the retained handle also withholds write sharing: another process
cannot modify the object between the scan and the rename, and an existing writer
makes the open fail rather than the judgement describe bytes that later changed.
Read and delete sharing stay, because a reader cannot invalidate a judgement and
finalization follows the handle rather than the name.

`ReplaceIfExists` stays false, so an occupied final name fails with
`ERROR_ALREADY_EXISTS` whatever kind of entry holds it — file, directory or
link — and nothing is replaced.

The target end is bound differently, because the Win32 entry point does not
support binding it the same way. `FILE_RENAME_INFO` has a `RootDirectory` field
that the NT contract resolves the new name against, which would make the target
object-bound too; measured against this stack, kernel32 refuses every non-null
`RootDirectory` form with `ERROR_INVALID_PARAMETER`, including with the access
mask the driver documentation recommends — which is why the standard library
also always passes null. That measurement is a test, so the day it stops being
true is visible. The target is therefore bound by holding the admitted
destination root open for the run *without delete sharing*, which makes the
directory unrenameable and unremovable while a conversion is in flight, so the
canonical path the final name is formed from cannot be made to denote a
different directory. The root is held before it is judged rather than after, so
the identity check decides about the object the run will actually use.

The cost is wider than the root itself and is stated rather than discovered:
Windows refuses to rename any *ancestor* of a held directory, so for the
duration of a run the user cannot rename or remove the destination root or any
folder above it. The lock lasts exactly as long as the run.

**The cleanup-by-path window was still open after M3.0.1 and is closed by the
M3.0.2 amendment below.**

One ordering became load-bearing and is explicit in the code: the validated
object is released on every path, including a failed rename, before the staging
area is torn down. A retained handle inside a directory being removed would turn
every failure into residue.

Refusing an existing staging area is right, and on its own it is also a trap: a
single cleanup failure leaves a deterministically named directory that makes
every later run of that plan refuse, and a path-free failure cannot say which
name to remove. The plan therefore offers an explicit `reclaim_staging_area`,
which the caller invokes when it decides no run of that plan is in flight.
Nothing adopts a staging area silently.

The marker is created exclusively and follows nothing. The staging directory is
new, but it sits in a root another process may write to, so an entry can appear
at the marker's name between the directory being made and the marker being
written; a plain write would follow a link there and truncate whatever it
pointed at, which nothing in this boundary could put back.

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
facts: this boundary never applies an mzML-source comparison to a source it could
not read that way and calls the result a fidelity check. ADR 0010 keeps that rule
by giving a source with no mzML reading an output-only validation and a result
that says which it got, rather than by widening what the comparison is applied
to.

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

**Amended 2026-08-07 (M3.0.2): cleanup deletes objects, not names.**

Proving that a path named an MSCanvas staging area and then deleting through
that path were two different acts, and `remove_dir_all` widened the gap between
them to every component of every child: each name was resolved again at the
moment it was unlinked, long after anything had been verified. The consequence
of being wrong was a recursive delete of somebody else's tree.

Nothing in staging teardown deletes a name now. A directory is listed through
the handle that already holds it; each child is opened following nothing, proved
to be the object that listing described, and held; and deletion is a disposition
set on that handle. A name is only a way to reach an object that must then prove
itself, and an object that cannot prove itself is left alone. One engine serves
both entry points, which differ only in how the root object is obtained.

*Live-run cleanup* uses the strongest evidence available. `OwnedStagingArea`
opens the staging root, the output directory and the ownership marker as it
creates them and holds all three for the run, each without delete sharing, so
none of them can be renamed or replaced while the run depends on them. Teardown
consumes those handles rather than looking anything up. The type is RAII, has an
opaque `Debug`, is not cloneable, and carries an explicit state — active,
finished, cleaned, or residue. An unwind runs the same object-bound teardown
through `Drop`; it never reverts to the path-recursive form, precisely because
`Drop` cannot report what it finds.

*Explicit reclamation* has none of that evidence, because the run that created
the area is gone. It opens the staging root once, following nothing, and every
judgement afterwards is made about that object: the listing comes from its
handle, and the marker is opened, proved to be the entry that was listed, and
read through that same handle before it is believed. The admitted marker object
is then carried into teardown, so its name is never resolved a second time.

The identity a child must match is the full 128-bit file identity together with
the volume serial — the pairing `FILE_ID_INFO` documents as what uniquely
identifies a file. The listing supplies it directly, because the enumeration
uses the extended directory class; the older class reports 64 bits whose
relationship to the 128-bit form is NTFS product behavior rather than contract,
and a boundary should not rest on a filesystem coincidence. Enumeration records
are walked with checked arithmetic and read unaligned, since drivers have been
observed to violate the documented entry alignment. `.` and `..` are skipped;
descending into `..` would leave the tree altogether.

Reparse entries are refused, never followed and never removed. Deleting the link
alone would in fact be safe, but a junction inside a staging area MSCanvas
created is evidence that something else has been there, and this boundary
refuses what it cannot account for rather than tidying it away. The rule applies
first to the staging name itself: the root is opened without following a link
*and* refused if the object it reaches is one, so a junction planted where a
staging area should be can never become the tree that reclamation recurses into.
A staging root that holds anything besides the marker and the output directory is
refused the same way, untouched — and stays refused, reclaimable only once
whatever else is in there has been dealt with by whoever put it there.

The two entry points differ in one more way than how they obtain the root, and
it is a difference in authority. A live run removes only the objects it created
and has held ever since; an entry under an expected name that the run does not
hold got there some other way, and automatic cleanup refuses it rather than
deleting data on the strength of a name it recognises. Reclamation has no
retained objects to appeal to, so its authority is the admitted marker, which
vouches for the entries the admitted root listed. Retention therefore has to
start at creation rather than at first success: the marker object is held before
anything is written into it, so a write that fails part-way leaves teardown
holding the very file this run created instead of an entry it can only refuse
and reclamation cannot vouch for. The narrow window this closes
is a staging area whose construction failed part-way — the run creates the root
exclusively, but between that and creating the output directory something else
can get there first, and nothing else would have stopped the ensuing teardown
from removing it.

Deletion is post-order and the handle ordering is load-bearing: a child's name
does not leave its parent until the handle marking it closes, and a directory
with any child refuses deletion, so every child is disposed and closed before
its parent is asked to go. The disposition asks for POSIX semantics first,
because that is the only form under which closing *this* handle is enough to
free the name — otherwise a third party's handle keeps the entry alive and the
parent fails through no fault of the ordering — and falls back to the older
class on filesystems that do not implement it. The ownership marker is deleted
after everything else and before the root, so a teardown that gives up part-way
leaves the proof a later attempt needs rather than a nameless obstruction. That
ordering is only worth anything if the marker is never spent on a teardown that
is about to fail, so the root is listed once more after the output tree has gone
and before the marker is touched: anything that arrived in the meantime stops the
teardown with the proof still in place. A far narrower interval remains between
that listing and the two calls that follow it, and it is not claimed to be
closed — what is closed is the one that spanned an entire tree's removal.

Two named limits bound an arbitrary backend tree: depth 64 and 65,536 entries
per directory, both traversed with an explicit stack rather than recursion.
Exceeding either leaves residue and deletes no unverified remainder.

Teardown refuses no volume in advance. The conversion guarantee is local-only,
and a remote volume is where these mechanics stop being dependable — but that is
a reason to decide it when the destination is admitted, before a staging area
exists and before the backend runs. Deciding it in teardown gets the worst of
both: the staging root, the marker and whatever the backend wrote are all already
there, reclamation applies the same test and refuses the same way, and the
deterministic staging name is blocked for good. A volume that cannot support the
calls fails them instead, and a failed call is typed, reclaimable residue.
Refusing remote *destinations* up front is a source- and destination-admission
decision, and it belongs with the ones listed below rather than here.

What is *not* closed, stated precisely: the marker proves that MSCanvas wrote a
file of that name and content, not that this plan wrote it. Anything able to
create a file inside the destination root can forge one. Making the marker
unforgeable is a different decision — an authenticated-ownership model — and
this amendment deliberately does not make it. What changed is that a forged
marker can now only cause the deletion of objects that were individually opened,
identity-checked and found to be exactly the entries the admitted root listed.

Nor is a remote destination root refused anywhere yet. Teardown used to refuse
one, which only meant a run against an SMB or mapped destination did all its work
and then left every piece of it permanently. Removing that check makes the
failure reclaimable rather than terminal; it does not make the destination
appropriate, and refusing one before a staging area exists is listed below as
work still to do.

**Non-Windows keeps the narrower guarantee and does not claim otherwise.** The
standard library offers no object-bound removal, so that platform still tears
down by path, in the same order. It is not described as equivalent, and no
dependency was added to imitate it.

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

- ~~**Vendor RAW.** No lawful fixture exists or is authorized; coverage is rated
  **D**. No vendor source posture may be added before one does.~~ **Closed for
  one family on 2026-08-07** by [ADR 0010](0010-first-vendor-raw-source-admission.md)
  and the [M3.0.3 evidence record](../../spikes/M3_VENDOR_RAW_EVIDENCE.md).
  Every other family, and every other provider build, is still gated.
- **Real cancellation and partial-output behavior.** Rated **D**. Required
  before a queue can offer cancellation.
- **Backend overwrite semantics.** Never measured: the M0 existing-output case
  was refused by MSCanvas before launch, so what `msconvert` itself does to an
  existing file is unknown. This boundary does not depend on it, and must not
  start depending on it.
- ~~**Whether `msconvert` writes anything besides its output.** Unmeasured, and
  it decides whether the exactly-one-entry rule rejects faithful conversions.~~
  **Measured 2026-08-07.** A default mzML conversion of a Thermo RAW acquisition
  and of an mzML acquisition each produced exactly one file, carrying the planned
  name, with no sidecar, index, log or scratch entry. One fixture per family on
  one build: a multi-sample input or a non-mzML output format is still
  unmeasured.
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

1. A local diagnostic sink for the captured backend streams. The run drops
   them, because putting them in the result is exactly what the privacy rule
   forbids, and the crate's `Redactor`, `ReportableProcessOutput` and
   `classify_process_failure` have no consumer in a slice with no surface. The
   `ProcessRunner` seam is where such a sink belongs — a runner already owns the
   `ProcessOutput` it produced — and the slice that adds the product surface is
   when it gets a destination and a retention rule rather than a buffer nobody
   reads.
2. Per-file conversion results and a narrow Tauri surface over accepted
   workspace datasets, reusing the transfer-object privacy rules of ADR 0005.
3. Queue, failure isolation and retry — and the task/cancellation protocol ADR
   0007 defers, once real cancellation evidence exists.
4. A vendor source posture, gated on an authorized fixture and on the
   directory-acquisition evidence list in ADR 0007.
