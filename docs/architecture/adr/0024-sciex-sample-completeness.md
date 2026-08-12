# ADR 0024 — SCIEX per-sample completeness

- Status: Accepted. The sample-completeness gate ADR 0022 opened is closed for
  the evidenced build, enforced before publication, and reported separately from
  publication state. SCIEX remains invisible to the product; visible ingestion,
  queue integration and output-set adoption stay separately gated
- Date: 2026-08-11
- **Extended by [ADR 0025](0025-private-sciex-output-set-adoption.md),
  2026-08-11.** The completeness evidence is now also an eligibility condition:
  a conversion whose completeness was not established cannot mint an output-set
  adoption ticket. The evidence stays with the conversion result and is
  deliberately not copied into the adopted rows.

## Context

[ADR 0022](0022-sciex-wiff-source-admission.md) recorded a gap and refused to
close it by assertion:

> `Reader_ABI` may fail one sample, log it, continue, declare only what it wrote
> and exit zero.

So `declared output set == discovered output set` did not prove that every
sample converted, and [ADR 0023](0023-private-workspace-sciex-wiff-conversion.md)
carried the same limitation into the workspace: a run could report
`fully_finalized` for an acquisition it had only partly converted.

That is now **measured** rather than reasoned about. Zeroing one sample's own
streams inside a copy of the real ten-sample acquisition — container, FAT,
directory and the other nine samples byte-identical — makes the backend exit 0,
declare nine, write nine, and lose the tenth in silence. The pre-slice boundary
called it `fully_finalized`.

## Decision

### The claim, exactly

> **Every sample the SCIEX reader identified in the source acquisition
> successfully produced its corresponding admitted mzML output.**

Scoped to what the reader *identified*, deliberately — see the limitation at the
end, which is sharper than it sounds.

Completeness is **not** defined as exit 0, output count > 0, declaration equal to
discovery, every member validating, every member finalizing, or a repeatable
basename set. Each of those is a useful fact and none of them is this claim; the
whole reason this ADR exists is that a run can satisfy all six and still have
lost a sample.

### The proof is a conjunction, and two of its links are new

A source-side manifest would have been stronger and does not exist. Nothing
shipped in this installation enumerates a WIFF's samples without converting it:
`msaccess -x metadata` takes the reader's single-run overload and reports an
empty sample list, `--verbose` adds nothing, `--runIndexSet` filters the vector
the reader already returned — so it counts samples that read *successfully*,
which is the question — and no command-line tool calls `readIds` at all. The one
upstream tool that prints a line per run, `msdir --detailed`, is not in this
installation, and would not have been an independent manifest anyway: it goes
through the same reader, so a sample that fails to open simply gets no line.
Reading the container's own sample table would need a FAT-walking compound-file
parser this boundary does not have and will not grow for this.

So the proof runs the other way: rather than counting what should have happened,
it establishes that nothing was lost. At source revision
`47b13cfec55265af32055720a6c07b9d5bbed721` the reader's loop is
`for i in 1..=getSampleCount()` with a single `catch (exception&)` that emits
`[Reader_ABI::read] Error opening run ` unconditionally before continuing —
no `break`, no conditional skip, and a non-`std::exception` reaches the outer
catch and fails the whole file instead.

Reading the error stream is **necessary and not sufficient**, because tracing
the *driver* turned up two ways a sample can vanish with nothing said:

- a sample whose name is a substring of the file's basename shares an output
  path with its neighbour and is **silently overwritten** — measured with no
  corruption at all, only a file name: ten declarations, nine files, exit 0,
  stderr empty;
- a sample whose index comes out empty writes a **record-free** mzML with no
  warning.

Both were already refused, by guards added for other reasons. Completeness is
therefore established only when all five links hold:

| # | Link | Owner |
| - | ---- | ----- |
| 1 | the backend exited cleanly | the lifecycle |
| 2 | the declared set equals the discovered set | ADR 0022's declaration check |
| 3 | every member validated and the whole set published | the output-set lifecycle |
| 4 | a complete error stream carrying no per-sample marker | `sciex_completeness` |
| 5 | the argv asked for no subset | `sciex_completeness` |

Link 5 exists because `--runIndexSet 0-4` produces five outputs, exit 0 and an
empty stderr. This crate's builder never emits it; the check makes that a fact
about the run rather than about the builder as it is written today.

### The positive state is a typestate, not a boolean

`examine_backend_evidence` is the only source of a `NoSampleLoss`, and a
`NoSampleLoss` is the only thing that can become an
`EstablishedSampleCompleteness`. There is no public constructor and no public
field, so the positive state cannot be assembled by a caller who merely believes
the run went well — which is what a `bool fully_converted` would have permitted.

It carries what it was proved from: the method (`reader_error_audit_v1`,
versioned because the proof is an argument about one reader's control flow and a
changed argument is a different claim), the sample count, and the exact
executable digest.

### Fail-closed in every direction

A cut-off error stream, an unclassifiable reader failure, a filtered argv, an
unclean exit, or no published member: each is a refusal, never a weaker
positive. In particular the truncation check is ordered *after* the marker
search, so a stream that was both cut short and already showed a failure reports
the failure — and an absent marker in a cut-off stream establishes nothing,
because the whole proof is negative and rests on having seen all of the stream
there was.

The marker is matched as **raw bytes**. It is ASCII, the vendor's message that
follows it on the same line is localized — measured, it arrived as UTF-8 Chinese
— and a scan that had to decode the stream first would be answering a question
about encodings when its actual question is whether a fixed sentinel is present.

### Enforced before publication

The judgement is taken after the backend exits and **before discovery,
validation or any destination name is claimed**. It is the earliest point at
which a finished run can be judged, and the only point at which refusing costs
the user nothing: a refusal found after publication would leave a choice between
telling the user their acquisition converted when it did not, and deleting files
they already have. This boundary does neither.

An incomplete run therefore publishes **zero** members, cleans its staging like
any other refusal, and returns
`MultiOutputFailure::SampleCompletenessNotEstablished`.

### The lifecycle is not taught about samples

The generic output-set lifecycle publishes staged files and has no notion of a
source sample. It gained one closed enumeration —
`PrePublicationRequirement::{None, SciexSampleCompleteness}` — named at the call
site, and its only knowledge is that a requirement may refuse. Which family asks
is decided in a function total over the families, so one added later has to say
whether its backend can lose part of an acquisition without saying so. The three
single-output families cannot: one source, one planned output, and anything else
is already refused.

`fully_finalized` keeps the meaning [ADR 0021](0021-private-multi-output-conversion-lifecycle.md)
gave it — *every admitted output member was validated and published* — and the
completeness judgement sits beside it. A run can be fully finalized and carry no
completeness at all; that is what every other family does, and the field is
`None` there rather than a neutral value they have to fabricate. Completeness is
also only *established* for a set that published whole: the audit says the
backend lost nothing, full finalization says every surviving member reached the
user, and the claim is the conjunction.

### Bound to one executable

The marker is a string literal in one binary, not a documented interface. The
proof is a statement about release `3.0.26013`, source revision `47b13cf`, and
the `msconvert.exe` whose SHA-256 the provider-evidence row pins. A build with
different wording has no evidence row and never reaches this code. Nothing here
identifies the vendor DLLs, which remains the open gate ADR 0022 recorded.

## Evidence

[The M3.13 evidence record](../../spikes/M3_SCIEX_COMPLETENESS_EVIDENCE.md). The
decisive measurements:

- the hazard reproduced — one sample's streams zeroed, exit 0, nine of ten, the
  pre-slice boundary reporting `fully_finalized`;
- every zeroable per-sample stream broken in turn: **no silent skip observed**,
  one marker per lost sample and none otherwise;
- the collision reproduced with a file name and no corruption, refused by the
  declaration check;
- all three lawful acquisitions establishing completeness through a workspace
  handle — 10, 1, 1;
- both damaged acquisitions refused before publication with **zero** files
  written;
- eight focused mutations, all red.

## What this does not claim

**Fidelity.** Sample completeness and source fidelity are different claims. Every
output is still judged `output_only` and is still not fully verified.

**Samples the reader never identified.** At this revision `getSampleCount()` *is*
`getSampleNames().size()`, and the one reconciliation that would catch a short
list — against the vendor's own sample count — is commented out upstream,
directly beneath a comment observing that some files have more samples than
sample names. The claim is that the reader lost none of what it identified. It
is not that the reader identified everything, and no evidence available to this
boundary could make it so.

**Gate:** closing that would need either a source-side sample manifest this
installation does not expose, or an upstream fix restoring the reconciliation.
It is an upstream defect, not one this boundary can measure around.

## Consequences

- The blocking reason ADR 0022 and ADR 0023 gave for keeping SCIEX invisible is
  answered. It was not the only one: output-set adoption does not exist, so a
  converted SCIEX acquisition still cannot enter a workspace as its outputs.
- A vendor family whose backend can lose part of an acquisition now has a place
  to say so, and the shape makes the honest answer the easy one — the positive
  state cannot be written down without the evidence that supports it.
- The declared-set comparison ADR 0022 added against injected members turns out
  to be load-bearing for a completely different failure. Removing it would now
  break two claims, and the mutation suite holds both.


## Amendment, 2026-08-12 — the gate is where it was

[ADR 0026](0026-private-sciex-serial-queue-integration.md) changed nothing about
what completeness is, how it is proved or when it is asked. A queued SCIEX item
reaches this gate through the same lifecycle, before any output is published,
and a refusal is still a refusal with zero publication.

What the queue adds is where the answer goes: a finalized item is `Finalized`
only if the outcome is full **and** the authority to adopt it exists, and the
two conditions of that authority are this proof and full publication. A fully
finalized group with no proof is therefore a failed item rather than a success
with nothing to take.
