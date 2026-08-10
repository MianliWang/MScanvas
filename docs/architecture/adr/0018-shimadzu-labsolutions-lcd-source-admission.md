# ADR 0018 — Shimadzu LabSolutions LCD source admission, recognised inside the container

- Status: Accepted for one named vendor family on one tested provider build,
  privately. No user-visible surface, no other family, and every queue concern
  separately gated
- Date: 2026-08-09

## Context

[ADR 0010](0010-first-vendor-raw-source-admission.md) admitted the first vendor
family and set the rule the second one had to be measured against: a family is
recognised by an extension filter plus a fixed-offset file signature read
through the pinned handle, and a refusal that can be stated before launching a
process must never be deferred to one.

[ADR 0007](0007-logical-acquisition-discovery-and-folder-traversal.md) refuses
suffix-only recognition outright, because a false positive and a false negative
are both silent and both scientific errors.

The question this slice asked was whether ADR 0010's posture generalises or was
shaped by Thermo. The measurements are in
[the M3.7 next vendor evidence document](../../spikes/M3_NEXT_VENDOR_EVIDENCE.md);
this ADR records what they let the code claim, and it includes one correction to
the rule above.

Four facts decided the shape below.

**A `.lcd` and a `.wiff` begin with the same eight bytes.** Both are Microsoft
compound files, and `D0 CF 11 E0 A1 B1 1A E1` names the container, not the
vendor — measured on real fixtures of both. ADR 0010's rule, applied unchanged,
would admit a `.wiff` renamed `.lcd`; the backend then launches, produces
nothing, and exits `1` with `[ShimadzuReader::ctor] LoadData error:
E_UNSUPPORTEDFILE`. That is precisely the deferral ADR 0010 forbids, reached by
following ADR 0010.

**ProteoWizard supplies no recognition authority here.**
`Reader_Shimadzu::identify` tests the filename and ignores the `head` argument
it is given; `Reader_ABI::identify` does the same and still carries `// TODO:
check header signature?`. Unlike Thermo, there was no reader behaviour to
borrow. The recognition had to come from the format.

**SCIEX WIFF, the better-known candidate, does not fit the conversion plan.**
`Reader_ABI::read` pushes one `MSDataPtr` per sample, and the project's own
committed reference outputs show ten `.mzML` files for one input. A
one-source/one-output plan cannot represent that.

**Shimadzu LCD does fit.** One regular file, no companion, no directory; and on
the evidenced build, both fixtures convert to exactly one `mzML` with no
sidecars, repeatably and byte-identically.

## Decision

One family, named exactly, recognised one level inside its container, admitted
privately, validated on its output alone, and bound to the build it was measured
on.

### The family is named, never generalised

`ConversionSourceKind::ShimadzuLcdFile`. Not `VendorRaw`, not `CompoundFileRaw`,
not `DirectoryVendor`. The enum stays closed and every variant stays a family
this repository has converted on a build it has hashed. A variant is not added
to prepare for future work.

### Recognition reads the container's directory, not only its head

The shared admission body is unchanged in order and in posture: extension
filter, no-follow pinned open, regular-file check, identity capture, signature
read through that handle, rewind, digest through that same handle. One step is
inserted after the signature comparison and before the rewind — a family whose
leading bytes name a container is asked one further question through the same
handle.

For this family the question is the set of entry names in the compound file's
first directory sector, and all three of these must be present, exactly and
case-sensitively:

```text
Method File Property
GUMM_Information
LSS Raw Data
```

Measured in both LabSolutions fixtures and absent from the WIFF fixture. The
step is skipped for every family whose leading bytes are the recognition on
their own, so Thermo RAW and mzML are unaffected — the function that dispatches
it is total over the enum, so a family added later has to answer it rather than
inherit an answer.

**The extension remains a filter and never the authority.** It is kept because
the installed reader consults the name and answers `don't know how to read` to
any other spelling, so admitting an LCD under another extension would hand the
backend a file it cannot open. It establishes nothing on its own: LCD bytes
named `.dat` are refused, and WIFF bytes named `.lcd` are refused, with distinct
identifiers.

### The container reader is deliberately small, and fails closed

It reads the 512-byte header and one directory sector. It does not walk the FAT,
does not traverse the red-black tree the directory is ordered as, opens no
stream, and decodes no content. A parser used to decide what an acquisition *is*
should be as small as the question.

Every ambiguity refuses: a (major version, sector shift) pair outside the two
the format defines, a directory sector that does not fit in the file, an entry
with an impossible name length, an undefined object type, a declared name that
does not end in its terminator, a name that is not valid UTF-16. The directory
offset is bounded so a crafted header cannot direct a seek. Nothing is answered
from the part of a file that could be read.

Four of those were added after review found them missing, and the shape of the
mistake was the same every time: a field taken from the file being judged and
then trusted.

- A shift checked as a *range* admits the undefined 10 and 11 and sends the
  directory read to an invented geometry.
- A shift checked without its major version accepts a header that contradicts
  itself. The tell was that the synthetic fixtures never wrote a version at all
  and were admitted anyway — a builder producing files no writer produces will
  hide exactly this.
- A declared name length whose final code unit is discarded unlooked-at lets
  `LSS Raw DataX` read back as exactly `LSS Raw Data`.
- A directory read without checking that it *is* one: recognition asks which
  names are present, so a block of bytes carrying three convincing names passes
  unless the root storage is required to be there, first, and alone.

Any one of them turns this reader from a recognition into something a crafted
container can talk past. Each new rule was measured against the real fixtures
before it was added — both declare major version 4 with sector shift 12, and
both carry exactly one root entry first — because a rule that refused a real
acquisition would be worse than the gap it closed.

The pattern is worth keeping for whoever reads this next: the bugs were not in
the recognition, which was measured. They were in the parsing underneath it,
where every field is attacker-chosen and the temptation is to read on.

Requiring all three markers is a conservative choice made on two fixtures. It
was chosen for its failure direction: refusing an acquisition MSCanvas could
have converted is visible and recoverable, and admitting a document that is not
an acquisition is neither.

**No dependency was added.** The locked stack parses this. A compound-file crate
would have brought a general-purpose parser, and a larger attack surface, to
answer a question this small.

### What the container reader deliberately does not establish

The names it matches are the used entries of the first directory sector, not
the members of the root's red-black tree. Review asked for a reachability walk;
it is declined, and recorded here so the decision is visible rather than
repeated.

Child and sibling identifiers index the directory *stream*, which is a FAT
chain, so a correct traversal needs the FAT walk this module refuses. A walk
that stopped at the sector boundary would refuse real acquisitions whose trees
route through later sectors — a regression traded for the appearance of rigour.
And it is not the thing keeping a crafted file out: whoever can write three
marker names into unreachable slots can write them into reachable ones, so tree
membership rejects a narrower class of malformed containers rather than a
forgery.

The recognition therefore claims what it can prove — a well-formed compound file
whose first directory sector carries the family's markers — and the stronger
claim is listed as an open gate below rather than implied here.

### The refusal vocabulary gains one term

`ConversionSourceRejection::FamilyStructureMismatch`, stable id
`source_family_structure_mismatch`. It is distinct from `SignatureMismatch`
because the two say different things: one means *this is not the container it
claims to be*, the other means *this is that container, holding another
vendor's acquisition*. Both are path-free, as the whole vocabulary is.

### The build gate gains a row, not a wider first row

`EVIDENCED_PROVIDER_BUILDS` now has two entries. Both name release `3.0.26013`,
revision `47b13cf` and the same `msconvert.exe` digest, because both families
were measured on the same installation — but they are two rows, because a row is
*a family converted on a build*. A build that reads one vendor's files is not
evidence about another vendor's library sitting beside it in the same binary,
and one row covering both would assert exactly that.

The gate is checked before a staging area exists. On any other release,
revision, or executable digest, the family is refused and no process is
launched.

**Vendor-library identity is not claimed.** This repository does not open or
hash the vendor DLLs, so it does not name them.

### The argv spelling stays a per-family measured fact

Both vendor families use `InputSpelling::PlainVerified`, and they agree for
different reasons. `msconvert` expands its input as a file mask before any
reader is selected, so an extended-length path matches nothing at all and the
Shimadzu route is refused one step earlier than the Thermo route, which reaches
the vendor library and is told the file is corrupt. Two messages, one fact, and
two separate measurements — the spelling did not become a "vendor" rule on the
strength of one of them. The measurement was taken with an argv list; no shell
command string is built anywhere in this repository.

### Validation is output-only, and is not called fidelity verification

MSCanvas cannot read an LCD, so it cannot compare the output against the
acquisition. `ValidationMode::OutputOnly` applies, `is_fully_verified` is false
by construction, and the source-side properties are reported as *inapplicable*
rather than as passed.

No existing rule was weakened to admit this family, and no malformed output was
special-cased. One fixture produced zero spectra and 144 chromatograms and was
finalized — correctly, because a chromatogram-only acquisition is a real
acquisition and the contract already treated a zero count as legitimate rather
than as a defect.

### Nothing user-visible changed

No picker entry, no workspace row, no conversion action, no queue support, no
Tauri command, no DTO, no capability, no frontend code. One arm was added to the
desktop crate's rejection mapping because that match is exhaustive and the new
variant must be answered; it reports what the neighbouring signature refusal
reports, and no workspace path can reach it.

## Consequences

- A second family is convertible through the same boundary, which is the
  evidence that ADR 0010's posture was a posture and not a Thermo accident.
- Recognition is now two-layered for families that need it, and unchanged for
  families that do not. The cost is a small parser this repository owns and
  must keep small.
- The claim is narrow in three directions at once: this family, this build, and
  containers laid out like the two that were measured.
- A LabSolutions writer that emits a container without one of the three markers
  would be refused. That is the chosen failure direction, and it is the first
  thing to re-measure if a real acquisition is ever refused unexpectedly.

## Evidence gates still open

- **SCIEX WIFF, and multi-output acquisitions generally.** A single-source /
  single-output conversion plan cannot represent an acquisition that
  legitimately yields several documents. Admitting WIFF requires a source model
  in which one source has an enumerated set of outputs, each named by the
  acquisition rather than by the plan, and a finalization atomic across the set.
  None of that exists. No WIFF posture may be added before it does.
- **Companion-file acquisitions.** `.wiff.scan` sits beside its `.wiff`, and the
  source object model has one identity, one length and one digest. A companion
  has none of them, and no posture may treat one as part of a source until the
  model does.
- **Directory acquisitions.** Agilent, Bruker and Waters are unchanged. ADR
  0007's evidence list is what governs them and none of it was gathered here.
- **Directory-tree membership.** The container reader matches names among the
  used entries of the first directory sector, not the members of the root's
  tree. Proving membership needs a directory-stream reader that follows the
  FAT — a larger thing than this module, and a separate piece of work with its
  own evidence. Recorded above with the reasoning.
- **Other Shimadzu formats.** Only `.lcd` was measured. Nothing else is claimed.
- **Other provider builds.** The claim binds to one executable digest. A
  different build is unevidenced until it is measured.
- **User-visible support.** Deliberately not in this slice. Making this family
  selectable, queueable or adoptable is separate work with its own evidence.
