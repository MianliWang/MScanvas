# ADR 0027 — First visible SCIEX WIFF workflow, through `Add files…`

- Status: Accepted. `Add files…` admits an explicitly selected SCIEX WIFF
  acquisition; folder ingestion, the Explorer drop and direct vendor preview
  remain separately gated and unchanged
- Date: 2026-08-12

## Context

[ADR 0026](0026-private-sciex-serial-queue-integration.md) finished the private
SCIEX vertical on the real machinery — the one queue, the one lane, the one
Stop, the one export — and ended by saying that what remained was "a product
decision about copy and routing rather than an engineering one about
cardinality, with one question still open, which is what a partially finalized
acquisition should offer the user".

This is that decision. Everything the vertical needed was already measured; what
it did not have was a way in, a way to be described, and an answer for the one
outcome that is neither success nor failure.

## Decision

### The extension routes; it never recognises

`accept_workspace_file` gained one arm. A `.wiff` candidate is put to the
existing evidenced bundle admission and to nothing else — the compound-file
structure, the four required directory entries, the derived companion name, the
companion's own signature, both leases, both digests and the order-and-count
comparison are all exactly where ADR 0022 left them.

**A name that proposed a family and failed it is a refusal, not a second
guess.** A `.wiff` holding a LabSolutions container is refused by the SCIEX rule
and never handed on to the rule its bytes match, and the reverse is true too.
Renaming an acquisition does not change what it is.

The picker offers `*.wiff` and deliberately **not** `*.wiff.scan`. The companion
is not a separately selectable acquisition, and proposing it would invite the
user to select half of one. Selecting it anyway is refused by name, with the
sentence that says what to select instead — because unlike most refusals in this
boundary, that one is something the user can act on.

The three companion refusals stopped sharing a sentence. `CompanionMissing`,
`CompanionNotARegularFile` and `CompanionSignatureMismatch` are genuinely
different situations, the first two are fixable, and collapsing them cost the
only actionable answer this boundary has for a bundle. None of them names a
path: what the user needs is which file is missing *relative to the one they
chose*, and they already know where they chose it from.

### One bundle is one row, and the row is the acquisition

The companion never becomes a second row. Selecting both halves in one batch
yields one acquisition and one refusal that says so. The row's stated size is
the whole acquisition — `acquisition_byte_length`, already there since ADR 0022
— because a row reporting only its `.wiff` would understate it by the part that
carries the spectra.

The rewritten-in-place rebind rule is unchanged and now reachable through the
picker, which is the only place it was ever going to matter: "open it again to
continue" has to actually continue when the user opens it again the only way
they can.

### The wire stops assuming one named output per item

This is the change everything else rests on, and it is a type rather than a
convention.

```rust
pub(super) enum ItemOutputTopology {
    KnownSingle { basename: String },
    BackendNamedSet { max_members: usize },
}
```

`BackendNamedSet` is no longer compiled out. What replaces the privacy claim is
a narrower one: a row reaches that arm only by having been through its own
evidenced family admission *and* by that family declaring, at the conversion
boundary, that its backend names its own outputs. Convertibility is asked first
and for both arms, so productionizing the variant does not make an arbitrary
future multi-output family eligible for anything.

On the wire it is a discriminated union rather than a `String`:

```ts
type ConversionOutputPlan =
  | { kind: "knownSingle"; fileName: string }
  | { kind: "backendNamedSet"; maxMembers: number };
```

The empty string ADR 0026 projected was not a filename. It was unreachable then
and would have been a fabricated value now, and a renderer handed one would have
had to know not to draw it. **A blank output column is unrepresentable rather
than avoided**: a reader must choose an arm to draw anything at all.

The same reasoning gives the latest attempt's result two arms:

```ts
type ConversionAttemptResult =
  | { kind: "single"; report: ConversionReport }
  | { kind: "outputSet"; report: ConversionOutputSetReport };
```

`null` means only "no attempt result exists". An item never carries a single
report and a group report at once, and this makes that unrepresentable rather
than a rule two nullable fields would have had to keep. Thermo and Shimadzu
wire behaviour is semantically unchanged — the single report is byte-identical
under its arm, which the contract pin asserts.

### The group report carries member basenames; the export does not

The visible result carries the names the backend chose, bounded by the
lifecycle's own bound, path-free, directory-free. That is the one judgement call
in this shape and it is deliberate: a user told "ten outputs finalized" who
cannot see which ten has been given a number rather than an answer, and the
roster beside them will spell every one out the moment the set is adopted.
Redacting them in one rendering while doing that would be theatre.

The **export** is a different document with a different reader — it is reviewed
before being sent somewhere — and ADR 0026's answer stands unchanged: no member
basename appears in it. `Debug` for the new transfer object is written out
rather than derived, and that is what keeps both true at once: the value is
reachable from the update a session logs, so a derived `Debug` would have
printed every basename into any log that rendered a conversion.

### One queue, one action, two cardinalities

`is_convertible` says yes to `SciexWiff`. There is no second command, no second
planner, no second worker and no second adoption engine; the visible plan and
begin commands accept every family the predicate admits, and the frontend's one
convertibility helper agrees with it.

Adoption is where the cardinality could most easily have grown a second
implementation, and it does not. `terminal_adoption_tickets` **expands** an
already-authenticated set authority into the member tickets it was minted with —
cloning `Arc`s, so the retained objects stay in the set ticket and a second
attempt asks the same objects the same questions. Nothing is rebuilt from a
filename or a member report. The expansion refuses a ticket of another session,
because a `DatasetId` is allocated per session from zero.

Because one item can now contribute several outcomes, every outcome carries an
`(itemIndex, memberIndex)` identity. For a known single output the member index
is zero — a real position, since such an item has exactly one member and it is
the first.

And the offer became a count of **files**:

| queue | offers |
| --- | --- |
| one finalized Thermo item | 1 |
| one finalized ten-member SCIEX item | 10 |
| both | 11 |

Counted by Rust from the very authorities the adoption expands, so the number
shown and the outcomes returned cannot disagree. An interface counting finalized
items would have offered to add ten files while calling them one.

### Completeness is said in the words the evidence supports

> Every sample identified by the SCIEX reader produced its output.

Every clause is load-bearing. It does not say every sample in the acquisition
was identified, it does not say the conversion is scientifically complete, and
it does not say anything about fidelity. The output-only disclosure sits beside
it, unchanged, saying the third thing separately.

The completeness state is not a boolean on the wire either: `established`
carries the audit's identifier and the count that audit concluded, so a reader
can see what the claim rests on.

### A partially finalized acquisition is explained, not offered

The open question, decided.

A partial publication is **not** eligible for complete output-set adoption. Its
finalized prefix is real, it is the user's files in the folder they chose, and
nothing deletes, hides, rolls back or supersedes it. What MSCanvas will not do
is present a prefix as the acquisition's output set.

So the item says all of it: how many members were finalized, how many were not
published, that the finalized files remain in the destination folder, that
MSCanvas will not present them as a complete set, and that they can be added
individually later through ordinary `Add files…`. It is not labelled `Finalized`
and it is not offered a retry — its prefix is already at its final names, so a
second attempt would refuse on exactly those names.

**And it must never read as "Nothing was converted."** That sentence is the
natural consequence of a zero offer and it is false here. A queue with only a
partial item says instead that no *complete output set* is available; a mixed
queue keeps the ordinary action for its complete items and explains the partial
acquisition beside it. There is deliberately no "adopt the finalized prefix"
action in this slice: that is a distinct product decision about a distinct
thing.

### The walking surfaces did not move

Folder ingestion and the Explorer drop remain regular-mzML-only, and this is
deliberate rather than a temporary omission:

```text
Add files names explicit files.
Folder and Drop classify a broader filesystem surface.
```

For a bundle the gap is wider than for a single object. A traversal that found a
`.wiff` beside a `.wiff.scan` and admitted the two together would be deciding
they are one acquisition **from adjacency alone** — and upstream's own test data
contains a `swath.api.wiff.scan` whose primary is a `.wiff2` sitting in the same
directory as two unrelated `.wiff` files. That is why the companion is derived
from the primary's name and never searched for, and it is why no walk may pair
one.

Held two ways: a folder holding both halves discovers only the mzML and both
halves dropped directly stay unsupported; and neither module names this family
at all, asserted over the module sources, so the behaviour cannot be restored by
a well-meaning edit.

Any future walking-surface support is a separate evidence and product decision.

## Evidence

[The M3.16 evidence record](../../spikes/M3_VISIBLE_SCIEX_WIFF_WORKFLOW_EVIDENCE.md).

The real run: the ten-sample Enolase acquisition through `Add files…`, the
visible planner, the visible queue and the visible adoption — one row, one item,
ten outputs, ten `added`, eleven workspace rows, no preview anywhere, a
path-free wire and a repeat adoption reporting all ten as already present.

Twelve mutations, twelve red. One survived first: adding a member basename to
the diagnostics export. The privacy test beside it pinned the debug renderings
and left the export asserted only on the fields it happened to know about. It is
now asserted over the whole serialized document.

## What this does not claim

**That folder ingestion or the Explorer drop support this family.** They do not,
by decision, and the tests say so.

**That MSCanvas reads a `.wiff`.** It does not. A SCIEX row is not previewable,
and Rust refuses the read whatever asks for it.

**That multi-file publication is atomic.** It is sequential and it is not a
transaction. A failure after a prefix was published is reported as exactly that.

**Source fidelity.** Unchanged and still unmade.

**That reader-identified sample completeness is source completeness.** It says
every sample `Reader_ABI` identified produced its admitted output. It does not
say `Reader_ABI` identified every sample in the acquisition.

**That the publication order is the sample order.** It is the staging
directory's deterministic order. Deterministic is not scientific.

**Generic vendor RAW support.** Three evidenced families, named individually.

**That redacted is anonymous.** The export names the row the user chose and
carries bounded excerpts of what the backend said; it is reviewed before
sharing, and the document says so.

## Consequences

- The SCIEX vertical is reachable. Everything ADRs 0022–0026 measured is now
  measured about something a user can do.
- The queue's transfer object can describe one-to-many conversion, so a later
  multi-output family needs a family admission and an entry in one predicate
  rather than a wire change.
- Adoption's identity is a pair, which is what any future action over parts of a
  result will need.
- The `PartiallyFinalized` question is closed as a *policy* and left open as a
  *feature*: whether to offer the prefix through an action of its own is a
  separate decision, and this slice records why it is not this one.
