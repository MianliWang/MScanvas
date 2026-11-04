# ADR 0052 — Per-output adoption

Status: **Accepted**, by the owner's answer of 2026-10-28
([after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), section 2 and
section 6.2, PM9.4 F2). The answer is "one Add per output, as recommended; a
large SCIEX set is checked in rendered QA at 960x640 before that is final", so
the interface half stays open until that check is made.
Related: [0016](0016-explicit-converted-output-adoption.md) (explicit
adoption), [0027](0027-first-visible-sciex-wiff-workflow.md) (the visible
SCIEX workflow and partial sets),
[0043](0043-conversion-completion-route.md) and
[0045](0045-conversion-completion-closure-and-handoff.md) (the adoption
relation), [0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)
(the "not verified by MSCanvas" label on an adopted output).

## Context

[ADR 0016](0016-explicit-converted-output-adoption.md) made adoption explicit
and took a whole terminal queue: **Add converted outputs to workspace** adopts
every finalized output, in queue order. It rejected "adopting a subset the user
ticks" as a second selection model beside the roster's.

PM9.4 finding F2 asked for two things the queue-wide action cannot give: to
take one converted output into the workspace without the rest, and to preview
an output without adding it. A queue of many outputs, and a SCIEX acquisition
of up to twenty-four, makes the first a real need: a user who wants one sample
now has to add all of them and remove the others.

Since then each terminal queue item has carried its finalized outputs on the
wire, each with an opaque session-only output id, for opening the file or its
folder. Those ids are not adoption authority. The list includes outputs that
must never be adopted one by one: the finalized prefix of a partially
finalized set (ADR 0027), and the members of a fully finalized set whose sample
completeness was not established.

## Decision

### 1. One narrow command, a sibling of the queue-wide one

`adopt_workspace_conversion_output(operationId, outputId)` (service method
`adopt_conversion_output(operation, output_id, document)`), beside
`adopt_workspace_conversion_outputs(operationId)`. The calling document is
proved exactly as for the queue-wide command. The reply is the same
`WorkspaceOutputAdoptionResultDto`, with one outcome.

### 2. The same adoption, filtered before anything is claimed

Both commands run one adoption body. The queue-wide candidates are read from
the terminal queue, and the per-output command keeps only the candidate whose
ticket carries `outputId`. The filter runs before the retry round is read,
before the adoption flag is claimed and before a workspace generation is
reserved. A candidate keeps its `(itemIndex, memberIndex)` identity.

Everything after the filter is the queue-wide adoption unchanged: the exact
object and the exact bytes, the writer-excluding holds, duplicate before
capacity, the generation protocol and `adoption_superseded`, the record on the
queue, no process and no persistence.

### 3. Authority only from the expanded adoption authority

The candidates are the ones the queue-wide action would offer: finalized items
only, a single output's ticket or the member tickets of a set authority. An
output id is matched against those tickets and never looked up among the
outputs an item carries for opening. So the command refuses, with the existing
`outputs_not_adoptable` and with nothing claimed:

- an unknown id, an id of another queue and an id under the wrong operation;
- an output of an item that did not finalize, and any output while the queue
  is not terminal;
- a member of a partially finalized set (ADR 0027 is unchanged: its prefix is
  never presented as the set, and stays reachable through `Add files…`);
- a member of a set whose sample completeness is not established, refused like
  a partial one.

No new error code is added. The refusal says what the queue-wide one says for
a stale document or an unknown queue, for the same reason: telling the cases
apart would describe session state to a caller that is not holding it. The
code's existing copy speaks of the whole queue, which is wrong for one output
of a queue that still offers others, so the interface shows this refusal from
the per-output command with the per-output "not added" sentence instead.

The interface offers a per-output Add only where Rust says the item's outputs
are adoptable: the queue is terminal (its `adoptableOutputCount` is above
zero), the item is `finalized` and its `adoption.kind` is not
`nothingToAdopt` (for a set, `completeSetAdoptable` says the same). Every
output of such an item is offered. The item-level signals do not look at the
queue: while it is running or stopping, a finalized item already reads
`notRequested`, and a complete set already carries `completeSetAdoptable`, so
only the queue count tells a settled queue from one still under way.
`finalizedOutputs` alone never decides it, because it also lists the outputs
refused above.

### 4. A complete SCIEX set is adopted member by member

Each member of a complete, sample-complete set is adopted by its own output id,
which is the id its item already carries: the set authority's member tickets
are the same objects. Adopting some members does not adopt the acquisition and
does not say it does; each added row is an ordinary mzML row, as in ADR 0016.

### 5. The answer is recorded on the output's item

The per-output answer is written onto the item that holds the output, through
the queue-wide record, under the same queue and settling check. It replaces
what that item held, because the record says what the latest adoption did with
the item's outputs. Other items keep their answers. For a set member, the
item's record then counts that one output, so its counts can sum to less than
the item's adoptable outputs, and an earlier answer about the other members,
a refusal included, is dropped without their being checked again. Nothing
unsafe follows, since every adoption checks its outputs again, but after a
re-read Rust carries no per-member "added" fact: which members are in the
workspace is the roster's answer. Whether to keep the last answer per member
instead is decided by the rendered QA of a large SCIEX set at 960x640.

The interface's queue-level summary (the counts of the last queue-wide reply)
is cleared by a per-output answer, so the summary and the per-output answer
never disagree. That summary lives in the webview and is changed in the
contract-and-hook slice; Rust holds no queue-level summary.

### 6. Membership and the label are the queue-wide ones

A per-output adoption joins conversion membership exactly as a queue-wide one
does (PM9.4 F3) once the contract-and-hook slice applies its reply through the
existing `outputsAdopted` roster action, which that slice must do. The "not verified by MSCanvas" label, for advanced settings
or an unverified build, travels with the adopted output exactly as with
queue-wide adoption (ADR 0055), because the label is on the ticket and the
commit is shared.

### 7. Preview without adopting is declined

Every in-app preview needs a roster row: the spectrum slot is installed per
dataset. So F2 closes with its adopt-one-output half. A look without adding
stays the existing **Open file**, which runs the same object and byte check;
"preview" is Add, then the existing **Show in Workbench**, then the row.
Removing an added row later deletes nothing.

## Alternatives considered

**Look the output up by id among the item's openable outputs.** Rejected. That
list includes a partial set's prefix and the members of an incomplete set, so
it would adopt exactly what ADR 0027 refuses.

**A second adoption engine for one output.** Rejected. It would be a second
answer to "is that still this?", which ADR 0016 and ADR 0025 lifted into one
shared body to avoid.

**A subset selection (ADR 0016's ticked subset).** Still rejected: a second
selection model beside the roster's. One action per output is not a selection.

**A new refusal code for each refused case.** Rejected; see decision 3.

**Accumulating per-output answers into the item's record.** Not taken. Counts
added together would report one output adopted twice as one added and one
already present, and a queue-wide adoption after per-output ones would count
more outputs than the item has. Keeping the last answer per member would need
new per-member state; the replaced record needs none. The rendered QA of a
large SCIEX set judges whether the item's record reads well enough.

**Preview without adopting.** Declined; see decision 7.

## Consequences

- One more registered command. Until the contract-and-hook slice wires it, the
  command-surface test declares it as awaiting a caller, and that declaration
  fails once the frontend calls it.
- The queue-wide command, its reply and its behaviour are unchanged.
- The interface work is three slices: contract and hook (the call, clearing
  the queue-level summary, applying the reply through `outputsAdopted`, and
  the record's "latest answer" meaning in the `ConversionItemAdoption`
  comment), UI and copy (one Add per output inside the existing
  "Locate {{name}}" group label and its one status line, no second live region
  per group, the existing "not added" sentence and the named Show in Workbench
  label), and rendered QA of a large SCIEX set at 960x640.

## What this supersedes and amends

- **ADR 0016**, "Adoption is explicit, and takes a whole queue": superseded in
  the "takes a whole queue" part. Adoption is still explicit and still per
  terminal queue; it may now take one offered output of it.
- **ADR 0043** and **ADR 0045**, the adoption-relation rows: amended by dated
  notes. The relation is written by a queue-wide or a per-output adoption.
