# ADR 0023 — Private workspace SCIEX WIFF bundle conversion

- Status: Accepted. **The workspace path is no longer private**: ADR 0027 gives
  the family a picker route, a queue row and an adoption. The boundary this
  record describes is unchanged; what changed is that a user can reach it.
  Folder and Explorer-Drop ingestion remain separately gated and mzML-only
- Date: 2026-08-11
- **Extended by [ADR 0025](0025-private-sciex-output-set-adoption.md),
  2026-08-11.** The consequence recorded below -- that output-set adoption does
  not exist, so a converted SCIEX acquisition cannot enter a workspace as its
  outputs -- no longer holds. It can, privately, when the run was fully finalized
  and sample-complete.
- **The completeness gate recorded at the end of this document is closed by
  [ADR 0024](0024-sciex-sample-completeness.md), 2026-08-11.** The workspace
  report now carries an evidence-bearing completeness judgement, and an
  acquisition that cannot be shown complete publishes nothing. The reasoning
  below for why this report carries no *bare* completeness field is unchanged:
  what it carries is a value only the audit can mint, not a boolean.

## Context

[ADR 0022](0022-sciex-wiff-source-admission.md) admitted SCIEX WIFF as a source
family: recognised, bound as a bundle, provider-evidenced, converting through
the [ADR 0021](0021-private-multi-output-conversion-lifecycle.md) output-set
lifecycle. It stopped at the crate boundary. Nothing connected an admitted
bundle to a *workspace dataset*, and the workspace could not have held one:

> every dataset this session holds is exactly one filesystem object.

That assumption is not incidental. It is the aggregate
([`AcceptedFile`](../../../apps/desktop/src-tauri/src/preview/selection.rs):
one path, one identity, one lease), the duplicate rule (`HashMap<FileIdentity,
DatasetId>`), the revalidation contract and the roster's idea of how big a
dataset is. A SCIEX acquisition is a `.wiff` **and** the `.wiff.scan` beside
it, and ADR 0022 measured why both are load-bearing: remove the companion and
the backend exits non-zero *and* writes one truncated document per sample.

## Decision

One `DatasetId` represents one whole acquisition.

### The aggregate grows; the model does not fork

`AcceptedFile` gains the other objects the acquisition is made of, each held
with the authority the primary is held with — its own canonical path, its own
filesystem identity, its own lease and, for a bundle, its own digest. Empty for
every single-object family, which is the truth about them rather than a
placeholder.

The alternatives were worse in the same way as each other. A second registry
row for the companion, a side map keyed by `DatasetId`, or a SCIEX-only
workspace would each put one acquisition in two places and leave every later
question — is this a duplicate, is it still there, what does the roster show —
with two answers to keep in step.

### Duplicate identity is the whole acquisition

The registry keys on a `DatasetIdentity`: the primary's filesystem identity and
its companions', in bind order. For every single-object family that is the one
identity it always was.

- the same bundle → duplicate, one row;
- the same primary with a **different object** under the companion's name → not
  a duplicate, because handing back the first row would give the user a dataset
  bound to a companion that is no longer there;
- a different primary with the same companion → not a duplicate;
- duplicate is still decided before capacity, and neither a duplicate nor a
  rejection consumes a `DatasetId`.

Built from filesystem identities rather than from names or a hash of them. The
identities are already known — every member is inspected and leased at
admission — and manufacturing a key out of strings would be a weaker answer to
a question the platform has already answered exactly.

**A companion *rewritten in place* keeps its file id and is therefore not a
different acquisition by this rule.** That is correct for a duplicate question
and insufficient for a staleness question, which is what the digests below are
for.

It has one consequence worth stating, because getting it wrong makes the
staleness refusal a trap. Revalidation refuses a row whose members were
rewritten and tells the user to open the acquisition again — and opening it
again arrives at this same duplicate lookup, where the identities are unchanged.
So when the identities match and the remembered digests do not, the existing row
is **rebound** to the freshly admitted acquisition and returned under the same
`DatasetId`. It is the same acquisition, the interface keeps the handle it
already holds, the stale holds go with the value they were attached to, and the
instruction the refusal gives is one the user can actually follow. Without that,
the row would stay unusable however many times they obeyed it.

### The workspace remembers what each member held

A bundle records the SHA-256 of every member, from the digests the crate
computed at admission. Single-object families record none, and that is not an
omission: their content is rechecked where it matters, when the conversion
boundary rehashes the object it pins against the source it admitted moments
earlier.

A bundle needs more because a lease keeps an object from being *replaced* while
deliberately permitting a writer. The bytes under a leased name can change while
the name, the object and the identity all stay exactly what they were. For a
primary something notices later. For a companion nothing does — nothing else in
this boundary ever looks at a companion at all.

### Revalidation re-admits the whole bundle

Under the family the dataset was accepted as, and then comparing, member for
member: **identity**, **name**, and **content**. Missing, replaced, rewritten,
renamed, wrong-signature, wrong-family and unreadable members are each refused,
and the family's own admission in `mscanvas-proteowizard` supplies the reason
rather than this crate re-deciding it.

### The internal family is exact; the wire member is inert

`DatasetSourceKind::SciexWiff`, decided at admission and stored on the
aggregate. Not a general `VendorBundle` or `MultiOutputVendor`: this repository
supports measured families, and a general one would be a claim about acquisitions
nobody has converted.

Every mapping over the family stays compile-time total — previewability,
convertibility, conversion-source, revalidation dispatch, diagnostics identifier
and the wire projection — with no fallback to another family anywhere.

An inert `sciex_wiff` wire member follows, for exactly the reason ADR 0019 gave
`shimadzu_lcd` one: every roster row carries a family and the projection is
total over what Rust can admit. Reporting such a row as another family would
make the roster lie about what it holds; an `unknown` member would make every
row's family a guess. It was not a support claim when this was written, and
nothing a user could do created a row of this family.
[ADR 0027](0027-first-visible-sciex-wiff-workflow.md) made it one: `Add files…`
routes a `.wiff` to the admission described here, and the member is now a
support claim like the other three.

**The roster reports the acquisition's size, not the primary's.** Identical for
every single-object family, and deliberately not identical here — a SCIEX row
that showed only its `.wiff` would understate the acquisition by a large
fraction of it.

### Admission is private, and the handoff proves every member

`add_sciex_wiff_dataset` takes a Rust-owned path, is compiled out of the shipped
binary, and delegates all recognition — extension filter, container markers,
companion naming, companion signature — to the crate. What the desktop layer
adds is what the crate cannot: the session's inspection of each member, a lease
on each, the `DatasetId`, and duplicate and capacity semantics.

Both members are leased **before** the crate's admission runs. A hold taken
afterwards leaves exactly the interval the hold exists to close, and for the
companion that interval is invisible. The companion's *name* comes from the
crate (`sciex_wiff_companion_path`) rather than from a `".scan"` spelled here:
the rule has one home, and `Reader_ABI` builds it as the whole file name plus a
suffix rather than the stem plus one.

Afterwards the identities are compared — primary and every companion, by order
and by count — so the objects this session holds are proved to be the objects
the crate admitted rather than assumed to be.

### The coordinator keeps the order the single-output one keeps

Claim before the wait; the backend gate with no workspace lock held; epoch
recheck after the wait; revalidate under the accepted family; bind the
installation and check its build against the recorded SCIEX evidence before
anything is pinned or created; pin **every** member; re-admit as a conversion
source; run; stamp with the generation the gate guard carried.

Every reason for that order is a property of this service rather than of the
output cardinality, so none of it changes. What changes is the pinning, which is
now per member.

### The result is a new report, not a widened one

`WorkspaceConversionReport` names one output: `output_file_name`, `output` and
`validation` are singular and the name is knowable before the run. None of the
three survives a topology where the backend names its own outputs and there may
be ten of them. Stretching the singular type until its fields no longer mean
what they say is how a report starts lying about the run it describes.

`WorkspaceMultiOutputConversionReport` is path-free by construction and carries
the dataset handle, the exact family, how many objects the acquisition was bound
to, the group outcome, the ordered member reports with their measurements and
validation, the backend facts, the residue and the installation generation. It
preserves all four ADR 0021 group outcomes, **including partial finalization**,
which is kept whole rather than collapsed into an ordinary failure: a set of ten
that stopped at member six left five files that are the user's, and reporting
that as "nothing happened" would be false.

### Retained finalized objects survive the handoff

A successful run hands back the existing `FinalizedOutputSet` beside the report,
one `FinalizedOutput` per member that really received its final name. Dropping
it closes handles and deletes nothing. No workspace adoption is built for these
outputs here; the point is that the exact objects can cross the workspace
boundary, so a later adoption decision has a sound foundation rather than a
path.

## The completeness gate, stated where it cannot be missed

```
Reader_ABI may fail one sample, log the failure, continue converting the other
samples, declare only the outputs it actually wrote, and exit 0.
```

Therefore `declared output set == discovered output set` does **not** prove that
every sample in the source acquisition converted.

`fully_finalized` means exactly:

> every member that entered the admitted output set was validated and
> successfully published.

It does not mean every source sample produced an output.

This slice does not close that by assertion. The report carries **no**
completeness field — no `all_samples_converted`, no `source_complete`, no
`fully_converted` — and deliberately no positive variant that no evidence could
produce. A field whose only honest value is "not established" is a field that
invites somebody to make it say something else. A test asserts the absence by
searching the report's own rendering, so a field added later that claims one
fails there rather than in review.

Nothing in this slice claims source completeness, sample completeness, source
fidelity, complete acquisition conversion, or that user-visible WIFF support is
safe.

**Gate:** the next product-visible SCIEX slice is blocked until this is closed
with evidence. A user told their acquisition converted is entitled to know that
means all of it.

## Product reachability

The shipped product still cannot admit a SCIEX acquisition, and four independent
barriers say so rather than one:

- the picker routes `.raw` and `.lcd` to their families and everything else to
  mzML admission, which refuses a `.wiff` by name;
- folder discovery only ever proposes `.mzML` candidates, and admits them
  through mzML admission regardless;
- the Explorer drop admits through mzML admission too, so a dropped `.wiff` is
  a per-item rejection;
- the visible queue refuses the family outright, as a whole-request refusal
  rather than a silent drop.

The family is also not previewable, no Tauri command names it, and the command
registration list is asserted unchanged. Add files…, folder ingestion, Explorer
Drop, queue semantics, diagnostics export, adoption, README and CHANGELOG are
untouched.

## Evidence

Recorded in [the M3.12 evidence document](../../spikes/M3_WORKSPACE_SCIEX_WIFF_EVIDENCE.md).
All three acquisitions ADR 0022 pins, admitted through the private workspace
service and converted from a `DatasetId` on release `3.0.26013` / `47b13cf`:
ten members from Enolase and one each from the other two, every run
`fully_finalized`, two bound source objects each, output-only validation,
`is_fully_verified` false throughout, retained finalized objects equal to the
published count, and no residue.

Thirteen focused mutations; twelve red. The survivor is recorded there rather
than hidden: removing the coordinator's own companion locks leaves the suite
green, because the interval those locks protect — between revalidation and the
crate's admission — has no seam a deterministic test can reach, while the run
interval they overlap is already held by the crate's `pin_source_bundle`.

## Consequences

- The workspace has a vocabulary for acquisitions that are more than one file.
  A second bundle family means measuring its topology, not redesigning identity,
  duplication or revalidation — and `DatasetSourceKind::is_bundle` is asked
  rather than compared against one variant, so a family added later takes the
  bundle handoff by saying so instead of silently taking the single-object one.
- The private multi-output result exists before any user can reach it, so a
  later surface inherits an honest model — including partial finalization and
  the absence of a completeness claim — rather than retrofitting one.
- Output-set adoption remains unbuilt and is now the only structural piece
  missing between this path and a visible one. It is not the *first* thing
  missing: the completeness gate is.


## Amendment, 2026-08-12 — the same conversion, now reachable from the queue

[ADR 0026](0026-private-sciex-serial-queue-integration.md) gave this conversion
a second caller: one item of the existing serial queue. Everything this ADR
establishes is what that caller does — the bundle is one logical source, one
`DatasetId` and now one queue item; every member is revalidated and pinned for
the whole run; the companion never appears in any argv and is bound to the
command anyway.

`SciexConversion` now has exactly one constructor, so the direct path and the
queue assemble the same value the same way and the run identity is allocated in
one place. It also carries the run's redacted backend text, taken out of the
crate's report at construction for the reason the single-output path takes its
own.
