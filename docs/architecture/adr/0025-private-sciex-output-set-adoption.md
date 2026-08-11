# ADR 0025 — Private SCIEX output-set adoption

- Status: Accepted as a private path with no product surface. Visible SCIEX
  ingestion, queue integration and any output-set adoption UI remain separately
  gated
- Date: 2026-08-11

## Context

[ADR 0024](0024-sciex-sample-completeness.md) closed the last gate that stood in
front of *converting* a SCIEX acquisition honestly. What a conversion produces
is 1..24 mzML files, and the workspace had no way to take them: adoption
existed, and its ticket could hold exactly one output.

[ADR 0016](0016-explicit-converted-output-adoption.md) had already solved
everything else. Its boundary proves exact object **and** exact validated bytes
per output, refuses one candidate without abandoning the others, decides
duplicates before capacity, hashes outside the workspace lock, and commits under
a reserved generation so a workspace that moved on receives nothing. It already
processes *several* outputs in one attempt, because a queue finalizes several
items.

The mismatch was cardinality, and only cardinality:
`FinalizedOutputAdoptionTicket` binds one name and one retained object, and
`QueueItem.adoption` holds at most one.

## Decision

### Generalize the engine; do not build a second one

The ordered multi-candidate machinery was inline in `adopt_conversion_outputs`.
It is now `inspect_adoption_candidates` (the reading half — open, recognise,
accept, commit nothing, no lock held across hashing) and
`commit_adoption_candidates` (the committing half — register in order under the
caller's gate). Both paths call both.

This is the same code moved, not a re-implementation, and the evidence for that
is that the tests pinning the visible single-output adoption pass **unchanged**.
There is no second file verifier, no second hashing implementation, no second
duplicate engine, no second commit protocol and no second supersession model.

### The set ticket wraps member tickets rather than replacing them

`FinalizedOutputSetAdoptionTicket` holds an ordered, bounded vector of the
existing single-output tickets and adds only what is about the *set*: which
source row, which family, which run, and how many samples the reader identified.

Nothing about how one output is proved differs because there are ten of them, so
nothing about `accept()` changed.

It is minted from the retained objects at the moment the conversion ends, taking
`FinalizedOutputSet` **by value** — `FinalizedOutput` holds the handle that keeps
its object from being reissued, so there is nothing to copy and nothing to find
again later. A ticket assembled from a report and a filename would be trusting
precisely what this boundary exists not to trust.

The run identity is the workspace mutation generation at mint time: monotonic
for the session, advanced by every workspace decision, so two conversions of one
dataset cannot mint tickets claiming to be the same run. It names an event and
never reaches disk. The ticket is session-scoped, not serializable, has an
opaque `Debug`, exposes no handle and no path, and dropping it closes handles
and deletes nothing.

### Eligibility is `FullyFinalized` **and** established completeness

Both, and the constructor fails closed on each — plus on a report and a set of
objects that cannot be paired one-to-one, in order, every member finalized,
within the lifecycle's own bound. Eligibility is never inferred from
`published_count > 0` or from a non-empty retained set.

The completeness half is unreachable through today's SCIEX path, which refuses
before publication. It is there for the runs that would not be: another
multi-output family, or the evidence entry point that is never asked.

### A partially finalized conversion is not an adoptable set

Deliberately, and this is the decision most likely to be argued with later.

Its published members are real. They are the user's files in the folder they
chose. Nothing here rolls them back, deletes them, hides them, or mints a ticket
for the finalized prefix and calls it the output set — because it is not one.
Presenting a conversion that stopped halfway through an action named for the
acquisition's outputs would make a partial result read as a complete workflow.
Those files can be opened the way any other mzML on disk is opened, and a future
product decision may offer a distinct action for them. This slice does not make
that decision.

**A partial *adoption* is a different thing and is allowed.** There the
conversion did produce the complete, sample-complete set and the workspace could
not take every member — one was replaced, one is gone, capacity ran out. The
valid members are still adopted, and the rest report why. Keeping these two
apart is the point of naming them differently in the code and here.

### Per member: exact object and exact bytes, unchanged

Both, for every member, through the existing check. Neither implies the other:
identity alone admits an object rewritten in place, a digest alone admits a
byte-identical impostor that now occupies the name, and a name alone admits
anything. The comparison is made against the object the registry is about to
hold, not a second opening of the name, and the writer-excluding hold survives
until the row exists.

Nothing was weakened because a set has many members.

### Duplicate before capacity, per member

The registry's existing rule, unchanged. A duplicate returns the existing row,
spends no `DatasetId`, consumes no capacity and keeps its original origin. A
refusal spends nothing. When capacity runs out, earlier members are added and
later ones report `workspace_full` in the deterministic member order. There is
no set-level rollback: this foundation reports what happened per member and
leaves how to present that to whatever surface eventually exists.

### The workspace protocol is the existing one

Reserve a generation under the mutation gate, claim the adoption flag, inspect
every candidate with no lock held across hashing, reacquire the gate, require
the reservation to still be current, and only then commit. Superseded means
nothing is added and the existing retryable refusal is returned.

The private path takes no document epoch — a conversion result is not a document
that can be reloaded out from under it — and takes no backend gate, because
adoption launches no process. Backend quarantine does not block it and it does
not clear quarantine. It shares the session's one adoption flag, so it cannot
run concurrently with the visible one, which is the intended answer.

### Repeatable, because nothing is consumed

The ticket survives an attempt: it clones `Arc`s of its members, so a second run
asks the same objects the same questions. Free capacity, adopt again, and the
members already present report as such rather than duplicating.

### Every adopted member is an ordinary mzML row

There is no `SciexConvertedMzml` family and no converted-output family at all.
Adoption admits each candidate through the workspace's own mzML admission, which
is the only thing that can produce the lease the registry holds — so the family
is `Mzml` by construction rather than by assignment.

The existing session-only converted origin records where a row came from. It is
not identity, not searched, not sorted by and not persisted. The
sample-completeness evidence is **not** copied into each row: the conversion
result owns that claim, and these are ordinary mzML files now.

### No automatic preview

Adoption previews nothing — not the first output, not the focused one, not any.
Structural rather than checked: there is no provider call in the path, no
backend gate is taken, and no runtime preview state is created for an adopted
row. Reading a file stays a separate action.

## Evidence

[The M3.14 evidence record](../../spikes/M3_SCIEX_OUTPUT_SET_ADOPTION_EVIDENCE.md).
The real run: the ten-sample Enolase acquisition, digests verified, converted on
the evidenced build to ten published members with completeness established, then
adopted — ten `added` in publication order, eleven workspace rows, every adopted
row `mzml`, the acquisition still one bundle row, no preview anywhere, no path
in the ticket's or the result's `Debug`, and a second adoption reporting all ten
as already present.

Eight mutations, seven red. The survivor — a superseded adoption allowed to
commit — guards a window one file hash wide that a single-threaded suite cannot
move the workspace inside; it is recorded rather than papered over.

## What this does not claim

**Source fidelity.** Unchanged and still unmade. An adopted output is an mzML
file that was proved to be the exact object a conversion finalized, holding the
exact bytes that were validated. That is a claim about the file, not about how
faithfully it represents the acquisition.

**That completeness travels with the rows.** It does not, and should not: the
evidence belongs to the conversion result. A row adopted from a complete set is
an ordinary mzML dataset from the moment it exists.

## Consequences

- The private SCIEX vertical is now end to end: admit a bundle, convert it,
  prove no sample was lost, and take the outputs into the workspace — with no
  user-reachable surface at any step.
- Adoption's engine is shared, so a later multi-output family inherits it, and a
  change to how one output is proved changes it for both paths at once.
- The `PartiallyFinalized` question is now recorded as a *product* decision
  rather than an implementation gap: the files exist, the boundary refuses to
  package them as something they are not, and whoever adds a surface must decide
  what to offer for them.
