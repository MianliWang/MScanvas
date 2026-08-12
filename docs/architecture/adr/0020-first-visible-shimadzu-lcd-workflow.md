# ADR 0020 — First visible Shimadzu LabSolutions LCD workspace and conversion workflow

- Status: Accepted for one additional visible vendor family through the existing
  picker and the existing serial queue. Folder ingestion, Explorer Drop, direct
  vendor preview, every other family and every queue-semantics concern
  separately gated
- Date: 2026-08-10

## Context

The family arrived in three deliberate steps.
[ADR 0018](0018-shimadzu-labsolutions-lcd-source-admission.md) measured what a
LabSolutions `.lcd` *is* and how it must be recognised.
[ADR 0019](0019-private-shimadzu-workspace-conversion.md) proved a workspace can
hold one and carry it whole through the conversion boundary — privately, with
the product unchanged. What remained was the product claim itself: that a user
can add one and convert it. This ADR makes that claim, and bounds it.

[ADR 0012](0012-first-visible-thermo-conversion.md) shaped the first visible
vendor workflow and [ADR 0013](0013-serial-conversion-queue.md) the queue; both
were written for a product whose every convertible row was Thermo. The question
this slice answers is what changes when that stops being a safe assumption —
and the useful discovery is how little: the queue's membership, order, identity
and safety machinery were already family-agnostic, and what was Thermo-shaped
was the copy, the eligibility predicates, one hard-coded evidence check, and
the plan's silence about which family each row is.

## Decision

### The exact claim

`Add files…` accepts regular mzML files plus two precisely evidenced vendor
regular-file families: **Thermo Scientific RAW** and **Shimadzu LabSolutions
LCD**. Either vendor family converts to mzML through the same bounded serial
queue, on the exact provider build evidenced for that family, and a queue may
contain both families in visible roster order.

Not claimed: all Thermo RAW variants; all LabSolutions variants; generic vendor
RAW support; SCIEX WIFF; compound-file acquisitions in general; directory
acquisitions; vendor-file preview; source-fidelity verification; support on
arbitrary ProteoWizard builds. ADR 0018's measured recognition limitation
remains part of the support boundary: *Shimadzu recognition requires all three
measured LabSolutions markers in the first directory sector*, and a
LabSolutions writer that omits one is refused. That fail-closed direction is
deliberate and unchanged.

### The picker widens; the walking surfaces do not

The native filter covers `*.mzML;*.raw;*.lcd` under one truthful label. The
filter is candidate routing only, and so is the extension dispatch behind it:
`.lcd` chooses *which admission is asked* — `ConversionSource::open_shimadzu_lcd_file`,
through the existing desktop wrapper — and never whether the file belongs to
the family. No compound-file magic, geometry, root-entry rule, marker name or
build string exists in the desktop crate. A renamed WIFF-like container, an
archive named `.lcd` and a malformed container are refused by the container
rule; LCD bytes under an unsupported name are not silently identified.

Folder ingestion and the Explorer drop remain regular-mzML-only, and the
distinction is intentional and now pinned in tests:

> `Add files…` acts on files the user explicitly named. Folder and Drop walk or
> classify a broader filesystem surface.

No vendor-family recognition runs during traversal at all — discovery proposes
mzML candidates and nothing else, so a `.lcd` in a walked tree is not even a
rejection. Widening a walk is a wider claim than widening the picker, and it is
not made here.

### Roster and preview

`shimadzu_lcd` stops being inert. Its exact visible label is **Shimadzu
LabSolutions LCD**, part of the accessible row name, shared with the queue plan
through one record so no surface can call the family two things. The marker
stays required, accessible, not identity, not searched, not a sort key.

Vendor rows remain non-previewable, refused in Rust as before, and the sentence
is the family-neutral one both vendor families already share: *Convert to mzML
before previewing this acquisition.* Focusing a Shimadzu row does not clear an
open mzML preview, and the automatic preview after an Add-files batch into an
empty workspace still reads at most the first newly added **mzML** row — never
a vendor row of either family.

### Eligibility and the plan

Rust's `is_convertible` says mzML no, Thermo yes, Shimadzu yes; the frontend
projects the same answer through one closed helper. Nothing infers
convertibility from an extension, and there is no second selection pipeline.

Each queue-plan item now carries its `sourceKind`, snapshotted when the plan is
made. The queue already recorded the family once started; the plan describes
the same immutable snapshot, so the interface never rediscovers a family from
the live roster, and a queue's membership, order and families are fixed at
creation.

### The mixed-family queue

One queue, one destination, one conflict policy, one serial backend lane, in
the visible order captured at planning. Each item revalidates under its
recorded family immediately before converting and is planned and gated as its
own family.

The provider-evidence gate is asked **per distinct family in the queue** — a
mixed queue is not authorized by its first item, and one family's evidence row
is never widened to cover the other. It is asked at two points:

- **Before the destination picker**, when the backend lane is free at that
  moment. Resolving capabilities runs the installed tools' help, which is a
  process, and a queue has always been admittable while a preview holds the
  lane — with the queue's worker doing the waiting, not the click. So the
  pre-picker check is a courtesy taken opportunistically (`try_enter_backend`),
  and skipped rather than blocked on when the lane is held.
- **At execution, always**, before any item creates a staging directory — the
  authoritative check, now a loop over the queue's distinct families where it
  was a hard-coded Thermo constant.

An honest limitation, carried forward from ADR 0019: on the one evidenced
build, both families share a release, revision and executable digest, so the
per-family loop cannot be distinguished from a first-item check through
evidence *outcomes* today. The distinct-family projection is therefore tested
directly, and a build evidenced for one family only would make the loop
observable with no further change.

### Cross-family output collisions

`sample.raw` and `sample.lcd` both plan `sample.mzML`. The existing
Windows-folded output-name collision rule refuses that queue before the
destination picker opens — neither family, nor queue order, nor Fail/Skip
decides which item would get the name, because the queue itself is invalid.
This fell out of the rule being written over output names rather than families;
what this slice adds is the explicit cross-family test that keeps it that way.

### Results, validation, and the queue's features

Both vendor families use `output_only` validation and the existing disclosure;
nothing claims source fidelity for either. A chromatogram-only result — the
real second fixture's 0 spectra, 144 chromatograms — renders as a successful
conversion with those exact facts, never as "empty" or "failed"; a document
with no records at all remains rejected.

Stop, Retry, diagnostics and adoption gained no family-specific code. Stop
reaches a running Shimadzu process through the existing cancellation mechanism
(measured on the real build: termination requested through the queue command,
owned tree confirmed empty, nothing finalized, no residue, later items
`notRun`). Retry keeps its conservative classification for both families. A
Shimadzu failure exports diagnostics under `shimadzu_lcd` through the existing
bounded redaction. A finalized Shimadzu output is ordinary mzML and adopts
through the existing explicit workflow into an ordinary `Mzml` row whose
converted origin names the Shimadzu source — there is no
`ShimadzuConvertedMzml`, and adoption still auto-previews nothing.

## Real product evidence

On the exact evidenced build, with the lawful fixtures re-verified against ADR
0018's digests: the production Add-files path admitted both LCD fixtures and
the Thermo fixture in picker order and refused a renamed-WIFF control; a
deliberately ordered mixed queue (LCD, LCD, RAW) converted serially to three
mzML files with no sidecars and no residue, output-only and not fully verified
on every item, the chromatogram-only shape intact; adoption added three
ordinary mzML rows; and a product Stop against a running Shimadzu conversion
cancelled it with the process tree confirmed empty and an empty destination.
Output digests are per-run facts, not family facts, for the reason the M3.7
record documents.

## Consequences

- The product claim grew by exactly one named family, and every wall around it
  — folder, Drop, preview, other families, parallelism, multi-output — held.
- The queue is now genuinely family-plural. The next family that fits the
  one-source/one-output model pays copy, eligibility, and evidence rows — not
  queue surgery.
- The pre-picker evidence check is opportunistic by design; the execution gate
  is the guarantee. A user can still reach the picker in the narrow case where
  the lane was busy, and is refused before anything stages.
- SCIEX WIFF remains excluded for the measured reason ADR 0018 records: its
  one-source/many-outputs topology does not fit this queue's model, and
  admitting it requires a multi-output conversion model proven first.

## Amendment, 2026-08-12 — a third family, and a shape this record assumed

The exact claim above names two families.
[ADR 0027](0027-first-visible-sciex-wiff-workflow.md) adds a third, **SCIEX
WIFF**, under the same rules this record established: the extension routes and
never recognises, each family is gated on its own provider evidence, a queue may
mix them in visible roster order, and the walking surfaces stay mzML-only.

One assumption of this record did not survive, and it was never stated because
it had never been false: that a visible queue item produces one output whose
name is known before the picker opens. A SCIEX acquisition produces one to
twenty-four documents the backend names itself, so the plan states a range and
its naming rule rather than a filename, and the count of outputs offered after a
queue finishes is a count of files rather than of items. Both are visible in
this record's own surfaces; neither changes what a Thermo or Shimadzu row does
or says.

The "not claimed" list above loses `SCIEX WIFF` and keeps every other entry —
in particular generic vendor RAW support, compound-file acquisitions in general,
directory acquisitions, vendor-file preview and source-fidelity verification.
