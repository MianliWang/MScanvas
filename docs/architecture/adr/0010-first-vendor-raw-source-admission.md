# ADR 0010 — First evidenced vendor RAW source admission

- Status: Accepted for one named vendor family on one tested provider build,
  privately; every user-visible conversion surface, every other family and every
  queue concern separately gated
- Date: 2026-08-07

## Context

[ADR 0009](0009-mzml-conversion-execution-boundary.md) built a conversion
boundary with exactly one source posture — a regular file MSCanvas could read as
mzML — and said why: *"Recognizing a source family MSCanvas cannot yet convert is
the claim the evidence does not support."* It listed the way out as an evidence
gate rather than a design gap: *"No lawful fixture exists or is authorized;
coverage is rated D. No vendor source posture may be added before one does."*

[ADR 0007](0007-logical-acquisition-discovery-and-folder-traversal.md) refuses
suffix-only recognition outright, and for a reason that applies here unchanged:
a false positive and a false negative are both silent, and both are scientific
errors rather than interface ones.

A lawful fixture now exists, and a real conversion has been run on a real
installed backend. The measurements are recorded in
[the M3.0.3 vendor RAW evidence document](../../spikes/M3_VENDOR_RAW_EVIDENCE.md);
this ADR records what they let the code claim.

Three of them decided the shape below. A Thermo RAW file is identified by an
18-byte header and by nothing else, in ProteoWizard's own reader. The installed
vendor library refuses the very same object under another extension. And it
refuses it again under the Windows extended-length path this crate binds
identity to, which the open-format reader accepts without complaint.

## Decision

One family, named exactly, admitted privately, validated on its output alone,
and bound to the build it was measured on.

### The family is named, not generalised

`ConversionSourceKind` gains `ThermoRawFile` and nothing broader. There is no
`VendorRaw`, no `RawFile` and no directory variant, not even as an unconstructed
variant — the same rule ADR 0009 applied to itself and ADR 0006 applies to the
workspace registry. Bruker and Waters were evaluated and rejected in this slice:
both are directory acquisitions, neither has a file signature to recognise, and
admitting one means the whole evidence list ADR 0007 requires before a directory
family may exist.

Thermo RAW is first because it is a single regular file. It reuses the object
model the mzML posture already established — canonicalised, identity-bound,
digest-bound, rechecked — rather than needing a new one.

### Recognition is the file signature; the extension is a filter

Admission is three steps in a fixed order:

1. the posture check refuses anything that is not a plain regular file;
2. the extension must be the one the installed vendor reader requires;
3. the object is opened under the no-follow guard and its first eighteen bytes
   are read **through that handle** and required to be the exact Thermo
   signature.

Step three is the recognition. Step two is a filter in front of it, and it is
there because of a measurement rather than a convention: a correctly signed file
under another extension is refused by the vendor library itself, producing
nothing and exiting non-zero. Admitting it would defer a refusal to a launched
process instead of stating it.

Neither step may stand in for the other, and the tests assert both directions: a
file ending in `.raw` holding something else is refused, and a signed file named
otherwise is refused. A suffix never creates a source.

The signature is not re-read before the run. The pre-run recheck already
compares the source's digest, and the signature is a prefix of the bytes that
digest covers, so re-deriving it would restate a fact the hash has settled.

### Validation is output-only, and the result says so

A vendor acquisition has no mzML facts to compare an output against. The source
facts therefore split: `SourceObjectFacts` holds what is true of every source
object — identity, byte length, digest — and `ConversionSourceFacts` is that plus
a reading of the source as mzML. A vendor source carries the first alone, so
there is nothing available to pretend a comparison with.

`ValidConversion` carries a `ValidationMode` and three property sets rather than
two:

- **verified** — established. For a vendor run: the source object unchanged, the
  output's declared list counts present and consistent with its contents, its
  declared binary-array lengths present, consecutive index sequences, and the
  requested compression policy. A list holding records while declaring no count
  has omitted an attribute its schema requires; under a comparison that is
  survivable because the observed counts on both sides still answer the
  question, and here it is a rejection, because recording the property as
  verified would assert something the document declined to state. The same
  reasoning refuses a record that declares points and carries no data for them —
  either an array present with an empty payload, or no array at all, the second
  being the quieter case because nothing else here would notice it: the comparison path finds that by looking for the source's
  payloads, and with no source the contradiction between a declared length and
  an absent payload is what remains — and it is enough. A declared length of
  zero with an empty payload stays legitimate, because a peakless record is a
  real one and the M0 evidence corrected an earlier contract for refusing it.
  And before any of those: an output holding no spectra and no chromatograms is
  refused outright, because every structural check is a statement about records
  and passes vacuously over a document that has none. A comparison never reaches
  that case — the source's counts would already disagree — so refusing an output
  that converted nothing is what takes its place. It does not distinguish an
  absent list from one declaring `count="0"`; telling those apart needs a fact
  the scanner does not record, and both are refused here regardless.
- **unverified** — could have been asked and could not be established, such as a
  vocabulary fact reached through a `referenceableParamGroup`.
- **inapplicable** — never a question this pair could be asked. Every
  source-versus-output comparison, for an output-only run.

The distinction is the point. Recording a comparison as *unverified* would say
this run failed to establish something; recording it as *inapplicable* says it
was outside what an output-only validation is. `is_fully_verified` is false for
every output-only result whatever its sets contain, so an empty `unverified` set
can never be read as a fidelity claim.

The comparison set is written out explicitly rather than derived by subtraction,
so adding a property is a compile-time decision about which bucket it belongs
in.

**The mzML posture is unchanged.** Same comparison, same required, advisory and
unverifiable classifications, same stable identifiers, same tests. What it gains
is a mode field that says a comparison happened.

### Support is bound to the provider build

Installed help now yields a `ProviderBuild` — release and source revision —
parsed from the same complete, non-truncated capture every other capability fact
comes from, using discovery's own parsing so a capability decision and a
discovery report cannot disagree about which build answered.

A source family that requires build evidence runs only on a build listed as
evidenced, and the refusal happens before a staging area exists: an ungated
build creates nothing, launches nothing and removes nothing. A build that will
not say which it is never matches evidence recorded for a specific one.

One successful conversion is evidence about the build it ran on. Treating it as
evidence about every installation is the claim ADR 0002 and the M0 spike both
decline to make, because a vendor family is read by a vendor library whose
behaviour and availability differ between releases. **Widening support is adding
a measured row, not relaxing a check.**

The mzML posture requires no build evidence. Its reader is ProteoWizard's own
open-format code and this crate's scanner, and the repository has open-format
evidence across builds.

### The argv source spelling is a per-family fact

The Thermo reader cannot open the Windows extended-length path this crate binds
identity to. It answers `Corrupt RAW file` and exits non-zero for the exact
object it converts successfully under a plain spelling. The open-format reader
accepts either.

So the spelling is decided per family. mzML keeps the canonical spelling every
earlier measurement was recorded with. A family that needs a plain spelling gets
one that is *derived, re-resolved and required to carry the admitted filesystem
identity* — the same comparison this crate uses everywhere a name has to be
trusted. A spelling that cannot be proved equivalent is refused rather than
tried, because the consequence of being wrong is a backend reading an object
nobody verified.

The output directory spelling was measured and needs no such treatment.

### The acquisition is held, not merely checked

A run opens the acquisition before it rechecks it, holds that handle until the
output has been judged, and hashes through it. Read sharing is granted so the
backend can open the same object by name; write and delete sharing are withheld.

Checking and then not holding leaves the interval a check exists to close. For a
source posture with an output-side comparison, a source rewritten under the run
and restored before the recheck would usually be caught by the comparison
disagreeing. For an output-only posture nothing would catch it: identity, length
and digest would all match, and the document would have come from bytes nothing
ever admitted. Withholding delete matters for the same reason in the other
direction — the backend resolves a *name*, so an acquisition renamed away and
replaced would hand it an object this run never saw.

Both readers tolerate the hold, which was measured rather than assumed. The cost
is stated rather than hidden: for the duration of a conversion the user cannot
modify, rename or delete the acquisition being converted. Outside Windows the
standard library offers no mandatory share mode, so the object is held without
that guarantee and the difference is recorded rather than papered over.

### Everything else is reused

Private staging, the reviewed process boundary with its owned Job Object and
allowlisted child environment, no-clobber handle-bound finalization,
identity-bound cleanup, and the pre-run identity, length and digest recheck all
apply to the new family unchanged. This slice adds a source posture; it does not
add a pipeline.

### Evidence expiry and revalidation

The recorded evidence is about a build, a family and a fixture. It expires in
exactly one way: it does not cover a build that is not listed. It is never a
substitute for runtime revalidation — every run still rechecks the acquisition's
identity, length and digest before the backend starts, and the validation
rechecks them again before the output is judged.

### Capability evidence is not product support

Nothing user-visible converts a RAW file after this slice. There is no Tauri
command, transfer object, frontend control, queue, progress, cancellation, retry
or persistence, and the capability set stays empty. The posture is private Rust,
reachable only from inside the crate.

## Consequences

The conversion boundary now has two source postures and one shape. That is the
point of the shape ADR 0009 established: a vendor family became a constructor, a
recognition rule and a validation mode rather than a second engine.

The honest cost is how narrow it is. One family. One build. One fixture with one
spectrum. A user with a different ProteoWizard build gets a typed refusal rather
than a conversion, and that is the intended behaviour rather than a limitation to
be worked around later by loosening the check.

An output-only result is a weaker statement than the mzML comparison, and the
type system now makes that difference visible instead of leaving it to a reader
of a property set. Any later surface that reports conversion results has to
decide how to present it, which is a decision this slice deliberately leaves
open.

## Evidence gates still open

- **Other Thermo acquisitions.** One derived single-scan fixture. Multi-sample
  inputs, large acquisitions and ion-mobility data are unmeasured, and the
  exactly-one-output rule was measured only for the default mzML path.
- **Other provider builds.** Every build but one is refused. Adding one is a
  measurement.
- **Directory acquisition families.** Bruker, Waters and Agilent remain behind
  ADR 0007's evidence list.
- **Instrument model.** Not recoverable from this fixture even with the vendor
  reader, so the family can be named exactly and the instrument cannot.
- **Telling an absent element from an empty one.** The scanner records observed
  counts, not whether a list element or its `count` attribute appeared. An
  output-only judgement therefore refuses every empty document rather than
  distinguishing a missing `spectrumList` from a legitimate `count="0"`. Making
  that distinction is a scanner change with its own evidence obligations.
- Real cancellation, partial-output behaviour, backend overwrite semantics,
  mzXML, progress and locale are all exactly as ADR 0009 left them.

## Alternatives considered

**Recognise the family by its extension.** Rejected on the same grounds ADR 0007
rejects suffix-only directory recognition, and the measurement makes it concrete:
a `.raw` file holding 600 bytes of filler is refused by the backend, so an
extension-only posture would admit sources that cannot convert and would call a
launched-and-failed process the recognition step.

**Recognise by signature alone and let the extension sort itself out.** It would
have admitted a signed file the installed reader refuses, turning a stateable
admission failure into an opaque backend failure after a process had run.

**Reuse the mzML comparison and report every property as unverified.** It reads
as "this run could not establish these", which is false — they were never
questions. It also leaves `is_fully_verified` answering a question about a
comparison that did not happen.

**Strip the extended-length prefix for every source.** Simpler, and it changes
the argv of the one path this repository has years of measurements for. The
spelling is a per-family fact because the evidence is a per-family fact.

**Accept any build that has the required options in its help.** Help declares
the option grammar. It does not declare whether a vendor library is present,
licensed or behaving as it did when the evidence was taken.

## Follow-up slices

1. The first private end-to-end conversion of an accepted workspace dataset
   through this posture.
2. Per-file conversion results and a narrow Tauri surface, which must decide how
   an output-only validation is presented without implying fidelity.
3. Additional evidenced provider builds, each a measurement rather than a
   relaxation.
4. Directory-acquisition families, still gated on ADR 0007's evidence list.
