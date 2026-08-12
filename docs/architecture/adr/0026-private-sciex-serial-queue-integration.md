# ADR 0026 — Private SCIEX serial-queue integration

- Status: Accepted as a private path with no product surface. Visible SCIEX
  ingestion, visible queue rows and any output-set adoption UI remain
  separately gated
- Date: 2026-08-12

## Context

[ADR 0025](0025-private-sciex-output-set-adoption.md) finished the private SCIEX
vertical as a straight line: admit a bundle, convert it directly, prove no
sample was lost, adopt the outputs. What it did not touch is the thing every
visible conversion actually runs through — [the serial
queue](0013-serial-conversion-queue.md), which owns the one backend lane, Stop,
Retry and the diagnostics export.

The queue could not represent a SCIEX acquisition, and the reason was one field:

```rust
/// Derived before the queue existed, so two items that would fight over one
/// name are refused before a picker opens.
output_file_name: String,
```

Every item had exactly one output, and its name was known before the picker
opened. That is true of Thermo and Shimadzu and it is the basis of the
queue-internal collision rule. It is false of SCIEX, whose backend writes one to
twenty-four documents and chooses their names itself — names that do not exist
until the run has finished.

## Decision

### The topology is named, not inferred

```rust
pub(super) enum ItemOutputTopology {
    KnownSingle { basename: String },
    #[cfg(test)]
    BackendNamedSet { max_members: usize },
}
```

Two named cases rather than `Option<String>`, because `None` would have to mean
unknown, absent, failed and multi-output at once and those are four different
facts.

`BackendNamedSet` is **compiled out of the shipped binary**, and that is the
privacy claim rather than a consequence of one. No visible surface admits a
SCIEX row to a workspace — `is_convertible` refuses the family, and the only
admission is `#[cfg(test)]` — so no visible surface can build such an item, and
a build without the variant cannot represent one at all. `QueueAdoptionAuthority::Set`,
`ItemOutcome::ReportedSet` and the runtime name authority are gated the same way
and for the same reason.

The visible transfer object is untouched. `ConversionQueueItemDto.output_file_name`
is still a `String` and still the planned basename for every item a shipped
build can hold; a set projects the empty string, which is not a filename and is
unreachable from the wire. **No name is derived for a set from anything** — not
the acquisition's stem, not the sample count, not the sample names.

### One queue, one slot, one lane, two cardinalities

There is no SCIEX queue, worker, busy flag, retry slot, cancellation registry or
diagnostics subsystem. `convert_queue_item` gained one arm, chosen by the item's
topology and by nothing else — no family name appears in the decision. The arm
calls the existing admitted multi-output lifecycle with the existing
`ConversionCancellation`, under the same backend gate, after the same
revalidation and the same bundle-wide pinning.

**One acquisition is one item and one process.** Ten documents are the item's
*result*; `item_count`, `finalized_count`, `failed_count` and the queue's
position stay counts of sources.

### The settling transition consumes one owned value

The queue is never handed the pieces. A report, a set of retained objects, a
destination, a run identity and a ticket are five values that only mean anything
about the *same* attempt, and a transition that accepted them separately could
be given one attempt's report beside another attempt's objects — same member
count, same states, nothing for a check to notice.

So one owned `SciexConversion` goes in and one `SciexAttemptSettlement` comes
out, with the eligibility judgement made once inside it. The row and the family
are read from the report rather than supplied, closing the last two crossings
M3.14 left as parameters.

### Runtime output names, and the collision that is not a conflict

Planning-time collision detection is unchanged for the items that have names
then. A set has none, so it is not given guesses; its discovered names meet the
queue's claims at a gate the lifecycle asks **outward**:

```rust
pub enum OutputNamesClaimed { None, Already { index: usize } }
```

It answers with a position rather than a name, because every failure in that
vocabulary is path-free *by construction* and a gate accepting arbitrary text
from its caller would make this one path-free only by the caller's good
behaviour. The lifecycle names the member from its own validated list.

Asked once, with the complete discovered set, after every member is validated
and **before the destination is inspected**. That ordering is the decision. A
name an earlier item of the same queue already published is an ordinary file by
the time the preflight looks, so the conflict policy would answer for it: under
`Fail` a refusal blaming something that was already there, and under `Skip` the
far worse answer that this acquisition is *already converted* — when what sits
at that name is somebody else's output.

A queue-internal collision is therefore its own typed, non-retryable outcome,
and the set publishes **none** of its own members. A later known-single item
whose name an earlier set already took is refused before it runs, for the same
reason and with its own identifier. Files an earlier item published are user
files and are never rolled back.

The authority is derived from the items rather than accumulated beside them, so
there is no second list to keep in step, and it is bounded:
`MAX_CONVERSION_QUEUE_ITEMS × MAX_CONVERSION_OUTPUTS_PER_SOURCE` = 16 × 24 =
**384** names, stated from the constants and asserted by a test.

There is now **one** Windows folding helper, `folded_output_name`, with the
argument for upcasing and its honest limit in one place. The crate's staged
member duplicate check is deliberately *not* it: that folds ASCII only, over
names one backend wrote into one private directory, and its narrowness is
argued where it lives.

### Outcome mapping

| Group outcome | Item state | Ticket | Retryable |
| --- | --- | --- | --- |
| `fully_finalized` **and** a ticket exists | `Finalized` | one, over all members | no |
| `fully_finalized` with no ticket | `Failed` | none | no |
| `skipped_existing_destinations` | `Skipped` | none | no |
| `refused_before_publication` | `Failed` | none | only the destination-physical classes |
| `partially_finalized` | `Failed` | none | **never** |
| confirmed cancellation | `Cancelled` | none | no |
| unconfirmed cancellation | `CancellationFailed` | none | no, and the backend is quarantined |

`Finalized` requires the authority as well as the outcome, because a fully
finalized group with no ticket is an item claiming success while offering
nothing to take.

A partially finalized set is **never retryable**. Its prefix is already at its
final names, so a second attempt would refuse on exactly those names; there is
no state in which repeating it helps. A completeness refusal is a measurement of
what the reader did rather than a transient condition, and a declaration
mismatch, a rejected member and a mixed destination conflict are all facts about
what was produced. What survives is the class of physical failure that happened
before the backend was launched and that the single-output classifier already
calls retryable for the same physical reason.

### An item that ran keeps what it earned

The queue already had this rule, and it had one hole this slice opened. A retry
moves a retryable failure back to pending; a stop or a queue-level refusal
landing before that item reruns restores what it earned rather than calling it
never-run, because never-run would delete a failure the user has already seen,
take it out of the failed count, and drop the diagnostic ticket whose state has
to match.

Both restoration paths read `error` then the single-output report. A set
failure lives in neither — its result is its group report — so both now ask the
item what state it earned, and the item answers from whichever of the three it
has. Reaching that interval needs a retryable set failure, which is a physical
destination condition no deterministic test can produce, so the suite forges
the retryability and drives the rest for real.

### Stop

The exact existing attempt-bound registration, unchanged: one
`ConversionCancellation` per attempt, its request handle bound to operation,
item index and attempt number, cleared by that exact attempt. The multi-output
lifecycle reports cancellation in its own vocabulary, so the queue translates
its two refusals into the same two item states rather than growing a second
cancellation system.

A confirmed stop leaves the current item `Cancelled`, every later item `NotRun`,
and launches nothing further. An unconfirmed one leaves it `CancellationFailed`,
quarantines the backend before the queue state moves, and refuses every later
operation including the probes. An earlier item that fully finalized keeps its
authority: a stop is a decision about what happens next, not a withdrawal of
what already happened.

What a stop does **not** claim: it does not say that process cancellation rolled
back filesystem work it did not control. A stopped set reports what it had
staged when it was interrupted, and staged partials are cleaned only under the
existing identity-bound rules. No finalized user file is ever deleted to make a
stop look atomic.

### Diagnostics

The same ticket, the same redactor, the same writer, the same bounds — 32 KiB
per captured stream excerpt, 16 diagnostic items, 2 MiB whole export. **One
source is one diagnostic item**; twenty-four documents do not become
twenty-four items and do not quietly exhaust the item bound.

A set item's `outputFileName` is `null` rather than a fabricated name, and it
gains one additional member, `outputSet`, emitted *only* for a set — so an
ordinary queue's export is byte-identical to the document it was before this
existed. That holds on the stop path too: a stopped set item is still a set
item, and it carries the shape it is known by even though a stop reaches the run
before it settles and there are no member facts to report. That member is counts and stable identifiers: member count, finalized
count, validated-not-published count, not-published count, bound source objects,
the completeness identifier, the partial-finalization counts and the
filesystem's own error kind, and why no authority exists where a reader might
expect one.

**No member basename appears anywhere in the export.** The backend derives those
from sample identifiers inside the acquisition, so they are the user's data
rather than this application's vocabulary, and every failure class this has to
tell apart is distinguishable without them. The acquisition's own display name
is there, as `sourceFileName`, exactly as it has been for every family since the
export existed: it is the row the user is looking at, and a document that would
not say which item it is about is not a diagnosis.

`Debug` for every type that carries a set as a *set* was made opaque — the group
report and its member facts previously derived it, which printed every member
basename into any log that rendered one. The reports still carry those names
through accessors, deliberately, for a caller that has decided to look; a debug
string is not that decision.

### Adoption

Queue-held authority is cardinality-aware:

```rust
pub(super) enum QueueAdoptionAuthority {
    Single(Arc<FinalizedOutputAdoptionTicket>),
    #[cfg(test)]
    Set(Arc<FinalizedOutputSetAdoptionTicket>),
}
```

The visible terminal adoption keeps its exact transfer object and its exact
behaviour, and deliberately does not project a set: it adopts one output per
finalized item, and a set would have to be flattened into members to fit —
which is the reconstruction the output-set boundary exists to refuse.

The set is reached through a separate private entry point that names the exact
operation and the exact item. Where the authority comes from is the only
difference between the two private adoptions, and it is a difference about
*claiming order* rather than about the adoption. A ticket the caller already
holds owns its objects outright, so nothing but the workspace can move
underneath it. One a terminal queue item holds belongs to a settling that a
retry or a replacement can end — so it is read under the same gate that claims
the action, exactly as the visible adoption reads its tickets, and the settling
is proved again before the commit. The operation alone would not do: a retry
settles the same operation again.

From there it runs the M3.14 engine unchanged: the same
per-member exact-object and exact-bytes proof, duplicate before capacity,
per-member partial adoption, repeatable, no process, no preview state, the same
generation protocol. Replacing the queue drops tickets and holds and deletes no
finalized file.

## Evidence

[The M3.15 evidence record](../../spikes/M3_SCIEX_PRIVATE_QUEUE_INTEGRATION_EVIDENCE.md).

Eleven mutations, eight red. Three survivors are classified there rather than
worked around, and one of them turned up a real defect while it was being
classified: `Refused` and `Stopped` cleared the single-output report but not the
group report, so a later attempt could have been described by the set attempt
before it. Fixed, and the "latest attempt" rule is now uniform across all four
settling arms.

## What this does not claim

**That a fully finalized set means the acquisition was complete.** It means
every member of the *admitted output set* was validated and published.

**That reader-identified sample completeness is source fidelity.** It says every
sample `Reader_ABI` identified produced its admitted output. It does not say
`Reader_ABI` identified every sample in the acquisition, and it says nothing
about how faithfully any document represents one.

**That the publication order is the sample order.** It is the staging
directory's deterministic order. Deterministic is not scientific.

**That one queue item with N outputs is N queue items.** It is one item, and
every count the queue reports is a count of sources.

**That sequential publication is a transaction.** It is not, and a failure after
a prefix was published is reported as exactly that.

**That private queue integration is visible SCIEX support.** There is no
command, no route, no control and no copy.

**That redacted is anonymous.** The export names the row the user chose and
carries bounded excerpts of what the backend said; it is reviewed before
sharing, and the document says so.

## Consequences

- The private SCIEX vertical now runs on the real machinery: the same lane, the
  same Stop, the same Retry, the same export. Whatever is measured about it is
  measured about the thing a visible surface would use.
- A later multi-output family inherits all of it by carrying
  `BackendNamedSet`, and the only decision it has to make is whether its backend
  can lose part of an acquisition without saying so.
- Adding a visible SCIEX surface is now a product decision about copy and
  routing rather than an engineering one about cardinality — with one question
  still open, which is what a partially finalized acquisition should offer the
  user.
