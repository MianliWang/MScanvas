# M3.7 next vendor source family evidence

- **Status:** A second vendor source family evidenced and admitted, privately.
  Nothing user-visible converts it. One further family was investigated to the
  point of a measured refusal and is recorded below as an open gate.
- **Date:** 2026-08-09
- **Exact code head:** `48f0ccdbee590ee5601df75e932580724984c503`. Every figure
  below is from one complete two-stage run of both fixtures on that head.
- **Decision recorded in:** [ADR 0018](../architecture/adr/0018-shimadzu-labsolutions-lcd-source-admission.md)

[The M3.0.3 record](M3_VENDOR_RAW_EVIDENCE.md) admitted the first vendor family
and left the obvious question open: whether that posture was a Thermo-shaped
accident or a shape a second family fits. This answers it, and the answer has a
correction in it — the recognition rule the first family established is not
sufficient on its own, and this record says exactly where it stops.

It supports one further family, on one provider build, with two fixtures. It is
not a claim that MSCanvas converts Shimadzu acquisitions.

## Source families evaluated

Ranked as the task ranks them: a single regular file first, because it reuses
the object model both existing postures already have.

| Family | Acquisition topology | Recognition available in ProteoWizard | Verdict |
| --- | --- | --- | --- |
| **Shimadzu LabSolutions LCD** | one regular file | `Reader_Shimadzu::identify` matches `.lcd` and nothing else | **Selected** |
| SCIEX WIFF | one regular file plus a `.wiff.scan` companion | `Reader_ABI::identify` matches `.wiff` and nothing else | Rejected — multi-output, gate recorded below |
| Agilent `.d` | directory | no signature; the reader probes for named members | Not re-investigated; [ADR 0007](../architecture/adr/0007-logical-acquisition-discovery-and-folder-traversal.md)'s evidence list is unchanged |
| Bruker, Waters | directory | as recorded in M3.0.3 | Unchanged |

Neither compound-file reader consults the bytes it is handed.
`Reader_ABI.cpp` still carries the comment `// TODO: check header signature?`
beside its name test. **ProteoWizard's own readers therefore supply no
recognition authority for either family**, which is the fact that shaped
everything below: the recognition had to be established here, from the format,
rather than borrowed.

### The gate that stays open: SCIEX WIFF

WIFF was the better-known candidate and was investigated first. It is refused on
a measured fact, not a preference.

`Reader_ABI::read` pushes **one `MSDataPtr` per sample** in the file, and the
project's own committed reference outputs show what that means in practice: at
the pinned commit, `Reader_ABI_Test.data/` holds **ten** `.mzML` files —
`Enolase_repeats_AQv1.4.2-20070918_en_01.mzML` through `…_en_10.mzML` — for one
input acquisition, with the numbering taken from inside the file.

That is source-partitioned output. The conversion boundary plans one source to
one named output and requires its private staging output directory to hold
exactly one entry. Forcing WIFF into that plan would mean either discarding
samples or inventing an output-naming rule from nothing.

**The gate, precisely.** *A single-source/single-output conversion plan cannot
represent an acquisition that legitimately yields several documents. Admitting
SCIEX WIFF requires a source model in which one source has an enumerated set of
outputs, each named by the acquisition rather than by the plan, and a
finalization that is atomic across the set. None of that exists. No WIFF posture
may be added before it does.* The `.wiff.scan` companion is a second, smaller
gate behind the first: the source object model has one identity, one length and
one digest, and a companion file has none of them.

## Fixture provenance and lawful-use basis

Two fixtures, retrieved on the same basis M3.0.3 established and re-verified at
the same pinned commit.

| Item | Fixture A | Fixture B |
| --- | --- | --- |
| Publisher | The ProteoWizard project, in its own source repository | as A |
| Pinned commit | `8f945db389acc21faf1d59eb88c3f10f5b1be242` | as A |
| Repository path | `pwiz/data/vendor_readers/Shimadzu/Reader_Shimadzu_Test.data/10nmol_Negative_MS_ID_ON_055.lcd` | `…/Reader_Shimadzu_Test.data/20140312_六mix_column_1 (scheduled) 一个试.lcd` |
| HTTP result | `200`, no redirects, no credentials, no account | as A |
| Downloaded | 2026-08-09, outside the repository | as A |
| Byte length | `2,367,488` | `1,753,088` |
| SHA-256 | `B56D14A031B531DA3166685CDF4EBBC5738B45C2014E9DA87F60C58717097EE2` | `7DD1733DBA96A3517919E873721AAB07E7AF6D6808A500717A1ADA2282E49D40` |
| Published checksum | **None upstream.** Both digests were calculated here and must be re-verified on acquisition | as A |
| Licence basis | The repository root `LICENSE` at that commit is Apache-2.0 (`200`, 11,358 bytes) | as A |
| Source family | Shimadzu LabSolutions LCD, single regular file | as A |
| Posture | Regular file. No companion, no directory | as A |

Both lengths were confirmed against the commit's tree listing before download
and match the admitted source object exactly. The lengths in the table are
reported by the harness *from the admitted object*, so the identity recorded
here is the identity of the thing every measurement below describes.

### Three things the licence basis does not say

1. **The grant is implicit, not per-file.** There is no `LICENSE`, `NOTICE` or
   `README` inside `Reader_Shimadzu_Test.data/`; the only file beside the
   fixtures is a 52-byte `.gitattributes` reading `# Don't change line endings
   on vendor data` / `* binary`. The root Apache-2.0 licence is the sole
   instrument, and it covers the repository as a work rather than dedicating
   this data separately. That is the same basis M3.0.3 accepted, and it is worth
   restating rather than inheriting silently.
2. **Nothing here is a licence to the vendor's own library.** The Apache grant
   is from the ProteoWizard project over its repository. The Shimadzu reader
   inside the installed `msconvert` is the vendor's, under whatever terms the
   distribution carries. The installed build's folder holds `EULA.MHDAC` and
   `EULA.RawFileReader` and **no Shimadzu EULA**; this repository draws no
   conclusion from that absence and claims nothing about the vendor library's
   identity or terms.
3. **These are real instrument acquisitions, not synthesised files.** Fixture A
   is a negative-mode LC/MS run; fixture B is a scheduled multi-analyte run with
   a non-ASCII name. They carry instrument and method metadata. Nothing in this
   repository prints their contents, neither is tracked, and both were deleted
   after this record was written.

## Provider build

One build, and every measurement below is bound to this exact artifact.

| Item | Value |
| --- | --- |
| Discovery availability | `Available`, `same_installation=true` |
| Release | `3.0.26013` |
| Source revision | `47b13cf` |
| Build date | `Jan 13 2026 14:42:37` |
| `msconvert.exe` SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` |

This is byte-identical to the artifact M3.0.3 recorded, so the two families were
measured on the same installation. The evidence table gained a **second row**
rather than a widened first one: a build that reads one vendor's files is not
evidence about another vendor's library sitting beside it in the same binary.

**Not claimed:** the identity of the Shimadzu reader library itself. This
repository does not open or hash the vendor DLLs, so it does not name them.

## Recognition

### Why the first family's rule is not enough

A Shimadzu `.lcd` is a Microsoft compound file (OLE2 structured storage). So is
a SCIEX `.wiff`. Measured on the real fixtures of both:

| Fixture | First 8 bytes |
| --- | --- |
| `10nmol_Negative_MS_ID_ON_055.lcd` | `D0 CF 11 E0 A1 B1 1A E1` |
| `20140312_六mix_column_1 (scheduled) 一个试.lcd` | `D0 CF 11 E0 A1 B1 1A E1` |
| `PressureTrace1.wiff` | `D0 CF 11 E0 A1 B1 1A E1` |

**A fixed-offset signature cannot name this family.** It names a container. The
first family's rule — extension filter plus leading-byte signature — would admit
a `.wiff` renamed `.lcd`, and the measured consequence of doing so is exactly
the deferral [ADR 0010](../architecture/adr/0010-first-vendor-raw-source-admission.md)
rejects: `msconvert` accepts the argument, launches, produces no output and
exits `1` reporting `[ShimadzuReader::ctor] LoadData error: E_UNSUPPORTEDFILE`.
A refusal that is stateable before launching must not be deferred to a launched
process.

### The rule that is used

Extension filter, then compound-file container, then **the entry names in the
container's first directory sector**. All three of these must be present, exact
and case-sensitive:

```text
Method File Property
GUMM_Information
LSS Raw Data
```

Measured in the first directory sector of both LabSolutions fixtures and absent
from the WIFF fixture. The two LCDs are not identical in shape, which is the
point of using two: fixture A's directory begins at sector `0` and fixture B's
at sector `2`, and the WIFF's at sector `78`. A reader that assumed sector zero
would have been wrong on real data.

Full entry lists, for the record:

| Fixture | Sector shift | First directory sector | Used entries | Carries all three markers |
| --- | --- | --- | --- | --- |
| Fixture A `.lcd` | 12 (4096 B) | 0 | 32 | yes |
| Fixture B `.lcd` | 12 (4096 B) | 2 | 32 | yes |
| `PressureTrace1.wiff` | 12 (4096 B) | 78 | 32 | no — none of the three |

The WIFF's entries are a different vocabulary entirely: `SampleSubtree`,
`MethodSubtree`, `AcqMethodConfigStm`, `MassSpecMethod`, `CFRFileHeader`. There
is no near-collision to worry about here; the families are not close.

**All three markers are required, and that is a conservative choice on a small
sample.** Two fixtures is not a survey of LabSolutions' writers. The failure
direction was chosen deliberately: refusing an acquisition MSCanvas could have
converted is recoverable and visible, and admitting a document that is not an
acquisition is neither.

### The extension is still a filter, and still not the authority

| Candidate | Result | Stable id |
| --- | --- | --- |
| Fixture A, named `.lcd` | admitted | `shimadzu_lcd_file` |
| Fixture A, named `.LCD` | admitted | `shimadzu_lcd_file` |
| Fixture A bytes, renamed `.dat` | refused | `source_unsupported_extension` |
| `PressureTrace1.wiff` bytes, renamed `.lcd` | refused | `source_family_structure_mismatch` |
| A zip archive named `.lcd` | refused | `source_signature_mismatch` |
| A compound file missing any one marker | refused | `source_family_structure_mismatch` |
| A directory named `acquisition.lcd` | refused | `source_not_a_regular_file` |
| An mzML document | refused | `source_unsupported_extension` |

The two negative controls at the top of that list were run through the real
harness against the real backend-capable build, not only in unit tests:

```text
error: the acquisition was not admitted by any source posture:
  mzml_file:source_not_readable_as_mzml
  thermo_raw_file:source_unsupported_extension
  shimadzu_lcd_file:source_family_structure_mismatch      (WIFF bytes named .lcd)

error: the acquisition was not admitted by any source posture:
  mzml_file:source_not_readable_as_mzml
  thermo_raw_file:source_unsupported_extension
  shimadzu_lcd_file:source_unsupported_extension          (LCD bytes named .dat)
```

The extension filter is kept for the reason M3.0.3 kept the first one: the
installed reader consults the name and refuses every other spelling, so
admitting an LCD under another extension would hand the backend a file it
answers `don't know how to read` to.

## How far the container is read

The header and one directory sector. Nothing else.

No FAT walk, no red-black tree traversal, no stream is opened, no content is
decoded. Every refusal is a refusal: a sector shift that is not one of the two
the format defines, a directory sector that does not fit, an entry with an
impossible name length, an undefined object type, a declared name that does not
end in its terminator, or a name that is not valid UTF-16 all refuse rather than
answering from the part that could be read. The directory offset is bounded at
4 GiB so a crafted header cannot direct a seek.

Two of those are there because review found them missing, and both were
fail-open in a reader whose whole argument is that it fails closed:

- **The geometry is a set of two (major version, sector shift) pairs, not a
  range and not two independent fields.** A range from 9 to 12 also admits 10
  and 11, which the format does not define; a header declaring one would have
  sent the directory read to an invented 1024- or 2048-byte geometry, where a
  crafted file is free to have placed three convincing marker names. And a
  shift checked without its version accepts a header that contradicts itself.
  Both real fixtures declare version 4 with shift 12 — measured before the rule
  was added, because a rule that refused a real acquisition would be worse than
  the gap it closed.
- **The last declared code unit of a name must be the terminator.** Discarding
  it unlooked-at means a field holding `LSS Raw DataX`, declared as though the
  `X` were the terminator, reads back as exactly `LSS Raw Data`. Three of those
  and a container that holds none of the markers passes recognition.
- **The first directory entry must be the root storage, and the only one.** The
  recognition asks which names are present, so a block of bytes carrying three
  convincing names reads as a directory unless something checks that a
  directory is what it is. Both fixtures have exactly one root entry, first.

The reading happens **through the handle admission already pinned**, before the
rewind and the digest, so what is inspected is the object that was recognised
and not whatever the name means afterwards.

**No dependency was added.** The locked stack parses this; a compound-file crate
would have brought a general-purpose parser to answer a question this small.

## Path spelling

| Family | Spelling | Measured refusal of the other spelling |
| --- | --- | --- |
| mzML | canonical (`\\?\`-extended) | — |
| Thermo RAW | plain verified | vendor library reports a corrupt file |
| **Shimadzu LCD** | **plain verified** | `msconvert` answers `no files found matching` |

The two vendor families agree, and for different reasons — which is why the
spelling stayed a per-family measured fact rather than becoming a "vendor" rule.
`msconvert` expands its input as a file mask before any reader is chosen, so an
extended-length path matches nothing and the Shimadzu route is refused one step
earlier than the Thermo route is. This was measured with an argv list, not a
shell string.

## Output layout

Both fixtures, both stages, on the build above.

| | Fixture A | Fixture B |
| --- | --- | --- |
| Staging entries after the run | 1 | 1 |
| Entry kind | regular file | regular file |
| Named as planned | yes | yes |
| Extension | `mzML` | `mzML` |
| Partial-output suffix present | no | no |
| Sidecars, logs, index files, directories | **none** | **none** |
| Output byte length | ~1.38 MB | ~0.48 MB |
| Output SHA-256 | *not a property of the acquisition — see below* | *as A* |
| Backend exit code | 0 | 0 |
| Backend stderr | 0 bytes | 0 bytes |

Fixture A was converted twice from the same location; the second run produced a
byte-identical output. **One source, one output, no sidecars** — the layout the
conversion boundary's exactly-one-entry rule requires, measured rather than
assumed. This closes, for this family, the same question M3.0.3 closed for the
first: *whether `msconvert` writes anything besides its output.*

### No output digest is recorded, and that is a finding rather than an omission

An earlier draft of this record carried an output SHA-256 for each fixture. They
were wrong to record, and the way they were wrong is worth keeping.

`msconvert` writes the source's **absolute directory** into the document:

```text
<sourceFile id="same.lcd" name="same.lcd" location="file:///C:\...\dirA">
```

So the output's bytes depend on where the input happened to sit. Measured
directly — the same acquisition, same basename, converted from two directories
whose names differ by four characters, produced outputs differing by exactly
four bytes and, of course, two different digests. Renaming the file moves the
length too, by the difference in the basename.

The conversion **is** deterministic: same acquisition, same path, same build →
byte-identical output, confirmed by repeat. But a digest recorded here could
only ever be reproduced by someone who put the fixture at the same absolute
path, which is not a thing an evidence record can ask for. What is stable and
is recorded instead: exactly one output, named as planned, with the `mzML`
extension, no sidecar and no partial-output name, and the spectrum and
chromatogram counts below.

Two consequences worth naming. A converted mzML **contains the absolute
directory its acquisition was read from** — it is the user's own output in the
user's own workspace, so nothing in this slice changes, but it is the kind of
fact this repository would rather have written down than rediscover. And output
digests are still meaningful *within* a run — the boundary hashes the object it
finalizes through the handle it finalizes — they are simply not portable facts
about a family.

The committed reference outputs agree with the measurement: at the pinned
commit, each `.lcd` in the test data has exactly one `.mzML` beside it — unlike
the SCIEX directory, where one input has ten.

## Boundary result

| | Fixture A | Fixture B |
| --- | --- | --- |
| Outcome | `finalized` | `finalized` |
| Validation mode | `output_only` | `output_only` |
| Fully verified | **false** | **false** |
| Residue | none | none |
| Destination entries | 1 | 1 |
| Output root | `indexed_mzml` | `indexed_mzml` |
| Spectra observed | 150 | **0** |
| Chromatograms observed | 1 | 144 |
| Advisory observations | none | none |

Verified for both: `source_unchanged`, `output_declared_counts`,
`output_declared_array_lengths`, `output_array_payload_presence`,
`output_array_roles`, `output_array_encoding`, `output_spectrum_metadata`,
`index_sequences`, `compression_policy`. Unverified: none. Inapplicable, for
both, are the eleven properties that require a source-side reading:
`spectrum_count`, `chromatogram_count`, `ms_level_distribution`,
`binary_array_counts`, `binary_array_kinds`, `binary_array_lengths`,
`binary_array_payload_presence`, `precursor_counts`, `spectrum_native_identity`,
`spectrum_representation`, `retention_time_unit_markers`.

**Fixture B produced zero spectra and 144 chromatograms and was still
finalized.** That is correct and worth recording: a chromatogram-only
acquisition is a real acquisition, and the validation contract was not adjusted
to accommodate it — it already treated a zero spectrum count as legitimate
rather than as a defect. No mzML rule was weakened, and no malformed output was
special-cased, for either fixture.

`is_fully_verified` is false for both, permanently and by construction. **This
is not fidelity verification**, and nothing in the code or this document
describes it as such: MSCanvas cannot read an LCD, so it cannot compare the
output against the acquisition. What it establishes is that the document
`msconvert` produced is internally consistent and came from the object that was
admitted.

## What the repository now claims

**Supported.** A regular file that carries the compound-file header and holds
`Method File Property`, `GUMM_Information` and `LSS Raw Data` in its first
directory sector, under a `.lcd` name, converted by `msconvert` release
`3.0.26013` revision `47b13cf` with the executable digest above, judged on its
output alone.

**Not supported, and not claimed.** Any other Shimadzu format; any LabSolutions
acquisition whose container is laid out differently from these two; SCIEX WIFF;
any directory acquisition; any other provider build; any user-visible surface —
there is no picker entry, no workspace row, no conversion action and no queue
support for this family, and this slice added none.

## Reproduction

The fixtures are not in this repository and must be re-acquired.

```text
# 1. Retrieve a fixture outside the repository and verify its digest against
#    the table above before using it.
curl -L -o <outside-the-repo>/fixture.lcd \
  https://raw.githubusercontent.com/ProteoWizard/pwiz/8f945db389acc21faf1d59eb88c3f10f5b1be242/pwiz/data/vendor_readers/Shimadzu/Reader_Shimadzu_Test.data/10nmol_Negative_MS_ID_ON_055.lcd

# 2. The two-stage evidence harness. --workspace must be an empty scratch
#    directory outside the repository; the harness empties it when it returns.
cargo run --locked -p mscanvas-proteowizard --example conversion_source_evidence -- \
  --input <outside-the-repo>/fixture.lcd --workspace <empty-scratch-dir>

# 3. The same claim as a named test.
set MSCANVAS_SHIMADZU_LCD_FIXTURE=<outside-the-repo>\fixture.lcd
cargo test --locked -p mscanvas-proteowizard -- --ignored the_shimadzu_lcd_evidence_run_is_reproducible
```

The ignored test is ignored rather than silently skipped: a machine with a
lawful acquisition and an installed ProteoWizard can run it by name, and one
without is told the claim went unchecked instead of shown a green run.

## Cleanup

Both fixtures, every converted output, every staging root, every probe
directory and every temporary harness script were deleted after these
measurements were taken. Nothing vendor-derived is tracked, and no local path,
raw backend stream, credential or personal information appears in this document.
