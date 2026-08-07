# M3.0.3 vendor RAW source evidence

- **Status:** One vendor source family evidenced and admitted, privately. Every
  user-visible conversion surface remains separately gated.
- **Date:** 2026-08-07
- **Exact code head:** `529d91f45644a259f7999f56117d3349fc6da728`
  (first measured at `2cb6230`; every structural fact below was re-measured
  unchanged at this head after the review fixes, and the timings are from it)
- **Decision recorded in:** [ADR 0010](../architecture/adr/0010-first-vendor-raw-source-admission.md)

This record closes the first entry in ADR 0009's "evidence gates still open"
list — *"No lawful fixture exists or is authorized; coverage is rated D. No
vendor source posture may be added before one does."* — and the fourth, *"Whether
`msconvert` writes anything besides its output."*

It supports one family, on one provider build, with one fixture. It is not a
claim that MSCanvas converts vendor RAW files.

## Source families evaluated

Three, and only one is a single file.

| Family | Shape | Recognition available | Verdict |
| --- | --- | --- | --- |
| **Thermo Scientific RAW** | one regular file | 18-byte file signature; ProteoWizard's `Reader_Thermo` matches on it and consults no name | **Selected** |
| Bruker | directory | no signature at all; `Reader_Bruker` probes for the existence of named files inside the directory | Rejected |
| Waters | directory | no signature; `Reader_Waters` returns immediately unless the path is a directory, then counts `_FUNC*.DAT` members | Rejected |

Both rejected families are directory acquisitions. Admitting one means a source
model with no single-file identity, no single-file digest and no lease — the
whole evidence list [ADR 0007](../architecture/adr/0007-logical-acquisition-discovery-and-folder-traversal.md)
requires before a directory family may be recognised. Thermo RAW reuses the
object model the mzML posture already established, which is why it is first
rather than merely convenient.

## Fixture provenance and lawful-use basis

| Item | Value |
| --- | --- |
| Publisher | The ProteoWizard project, in its own source repository |
| Pinned commit | `8f945db389acc21faf1d59eb88c3f10f5b1be242` |
| Repository path | `pwiz/data/vendor_readers/Thermo/Reader_Thermo_Test.data/FT-HCD-MSX.raw` |
| Retrieval URL | <https://raw.githubusercontent.com/ProteoWizard/pwiz/8f945db389acc21faf1d59eb88c3f10f5b1be242/pwiz/data/vendor_readers/Thermo/Reader_Thermo_Test.data/FT-HCD-MSX.raw> |
| HTTP result | `200`, zero redirects, no credentials |
| Downloaded | 2026-08-07 |
| Byte length | `78,309` |
| SHA-256 | `b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b` |
| Published checksum | **None upstream.** The digest above was calculated here and must be re-verified on acquisition |
| Licence basis | The repository root `LICENSE` at that commit is Apache-2.0 (`200`, 11,358 bytes), granting the right to "reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work" |
| Per-file licence | None. `NOTICE`, a directory `LICENSE` and a directory `README` all return `404` at that commit, so the root licence is the only instrument |
| Source family | Thermo Scientific RAW, single file, single-scan extraction produced with Xcalibur Qual Browser (multiplexed FT/HCD) |
| Posture | Regular file. Not a directory acquisition |

The fixture is a derived test file the ProteoWizard maintainer authored and
committed to his own Apache-2.0 project for reader coverage, not a biological or
clinical acquisition. Its own bytes nonetheless carry the author's given name, a
machine name and local paths, which is why nothing in this repository prints its
contents and why it is not tracked.

**Not established:** the instrument model. Even with the real vendor reader,
`msconvert` emits `MS:1000492` "Thermo Electron instrument model" with an empty
value, so the family may be named exactly and the instrument may not.

Three licence traps were checked and are recorded so a later slice does not
re-walk them:

- **Downloadable is not licensed.** PRIDE `PXD000001` is the canonical public
  demo dataset and is freely fetchable, but its stated licence is "EBI terms of
  use", which defers to the original data owner's unstated terms. That is a
  pass-through disclaimer, not a grant. It was rejected on that ground as well as
  on size (210 MB).
- **CC0 exists but not at this size.** PRIDE projects with a genuine CC0 licence
  were found; their `.raw` members are routinely 700 MB to 5 GB, so none is a
  usable fixture.
- **The RawFileReader EULA governs the reader, not the data.** The
  `EULA.RawFileReader` shipped inside a ProteoWizard installation constrains the
  Thermo reading libraries. It says nothing about who may use a `.raw` file, and
  it is not cited as fixture permission. MSCanvas redistributes neither.

## Provider build

| Item | Verified value |
| --- | --- |
| Release | `3.0.26013` |
| Source revision | `47b13cf` |
| Build date | `Jan 13 2026 14:42:37` |
| `msconvert.exe` SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` |
| Discovery | `Available`, source `CommonInstallRoot`, `same_installation=true` |
| Installation | User-supplied and user-installed. Nothing is bundled, downloaded or redistributed |

Vendor reader libraries present in that installation include
`ThermoFisher.CommonCore.RawFileReader.dll` and `ThermoFisher.CommonCore.Data.dll`.

## Recognition rule

**18 bytes at offset 0:** `01 A1` followed by `Finnigan` in UTF-16LE.

```text
01 a1 46 00 69 00 6e 00 6e 00 69 00 67 00 61 00 6e 00
```

Read from the evidence fixture and matching byte for byte. It is the same header
ProteoWizard's own `Reader_Thermo::identify` matches on, and that function
inspects only the file header — the name is not consulted, so recognition is
extension-independent by the reader's own construction.

The extension is a separate, separately measured requirement. Both halves were
measured on the installed build with the real fixture:

| Case | Backend exit | Output files |
| --- | ---: | ---: |
| Correct signature, `.raw` | `0` | `1` |
| Correct signature, renamed `.dat` | `1` | `0` |
| 600 bytes of filler, named `.raw` | `1` | `0` |

So a suffix establishes nothing and a signature alone is not sufficient for the
installed reader either. MSCanvas therefore uses the extension as a filter and
the signature as the recognition, and refuses both failures at admission rather
than at a launched process.

## Path spelling: the measured fact that changed the design

`std::fs::canonicalize` returns a Windows extended-length path, and this crate
binds source identity to that form. The Thermo reader cannot open one.

| Input spelling | Output directory spelling | Exit | Output files |
| --- | --- | ---: | ---: |
| plain `C:\…\FT-HCD-MSX.raw` | plain | `0` | `1` |
| extended `\\?\C:\…\FT-HCD-MSX.raw` | plain | `1` | `0` |
| plain | extended `\\?\…` | `0` | `1` |
| extended, but an **mzML** input | plain | `0` | `1` |

The failure is reported as `[RawFileImpl::ctor()] Corrupt RAW file` — the vendor
library's generic open failure, and the same message a wrong extension produces.
Nothing about the file changes between rows one and two; only how it is named.

The open-format reader accepts either spelling, so the spelling is a per-family
decision rather than a platform one, and the mzML posture keeps the spelling
every earlier measurement was recorded with. A plain spelling is derived from the
canonical path, re-resolved, and required to carry the admitted filesystem
identity before it is used; one that cannot be proved is refused.

## Output layout

Measured directly, into a freshly created empty directory, before anything
cleaned it up:

| Fact | Thermo RAW | mzML control |
| --- | --- | --- |
| Backend exit | `0` | `0` |
| Backend elapsed | `684 ms` | `183 ms` |
| Peak owned-job memory | `36,536,320` bytes | `22,007,808` bytes |
| Entries in the output directory | **`1`** | **`1`** |
| Entry kind | regular file | regular file |
| Entry name | exactly the planned name | exactly the planned name |
| Partial-output suffix present | `false` | `false` |
| Byte length | `28,661` | `25,469` |

**No sidecar, index, log or scratch file.** This is what ADR 0009 recorded as
unmeasured and required "before this boundary is reachable from the product",
and it holds for the default Thermo-to-mzML path with `--zlib` on this build. It
is one fixture on one build: a multi-sample input or a non-mzML output format
could differ, and neither was measured.

## Holding the acquisition

A run holds the acquisition open for its whole duration, granting read sharing
and withholding write and delete. Read sharing is what lets the backend open the
same object by name; withholding the other two is what makes "the backend
converted the acquisition that was verified" a property rather than a hope — the
bytes cannot change under it, and the name cannot be made to mean a different
object by a rename.

That it is *compatible* with both readers is a measurement, not an assumption:

| Reader | Conversion with the acquisition held | Result |
| --- | --- | --- |
| Thermo vendor library | `FT-HCD-MSX.raw` | exit `0`, finalized, one output |
| ProteoWizard open format | `tiny.pwiz.1.1.mzML` | exit `0`, finalized, one output |

The cost belongs in the record: for the duration of a conversion the user cannot
modify, rename or delete the acquisition being converted. Windows enforces this;
no platform outside it offers a mandatory share mode through the standard
library, so the guarantee there is narrower and is not described as equivalent.

## Boundary result

The whole sequence, unchanged, through `run_conversion`:

| Fact | Thermo RAW | mzML control |
| --- | --- | --- |
| Source kind | `thermo_raw_file` | `mzml_file` |
| Source bytes / SHA-256 | `78,309` / `b3d97b38…dd7b` | `25,072` / `711ac14b…9c83` |
| Outcome | `finalized` | `finalized` |
| Validation mode | **`output_only`** | `source_comparison` |
| Backend exit / elapsed | `0` / `511 ms` | `0` / `187 ms` |
| Output root | `indexedmzML` | `indexedmzML` |
| Spectra / chromatograms | `1` / `1` | `4` / `2` |
| Output byte length | `28,661` | `25,517` |
| Verified | `source_unchanged`, `output_declared_counts`, `output_declared_array_lengths`, `output_array_payload_presence`, `index_sequences`, `compression_policy` | the ten comparison and structural properties |
| Unverified | none | `ms_level_distribution`, `binary_array_kinds`, `spectrum_native_identity`, `spectrum_representation`, `compression_policy` |
| Inapplicable | the eleven comparison properties | none |
| Advisory | none | `numeric_precision_differs`, `byte_length_differs` |
| `is_fully_verified` | **`false`** | `false` |
| Cleanup residue | none | none |
| Destination root afterwards | exactly one mzML file | exactly one mzML file |

The vendor run's `unverified` set is empty and its result is still not fully
verified, which is the point: an output-only validation is not a weaker
comparison, it is not a comparison, and the mode says so rather than leaving an
empty set to be misread.

The mzML control's unverified set is the already-recorded consequence of that
fixture reaching its controlled-vocabulary facts through a
`referenceableParamGroup`. It is unchanged by this slice.

**Neither the output digest nor its byte length is a reproducible pin.**
`msconvert` records path information inside the document it writes, so the same
acquisition converted into a differently named directory produces different
bytes — observed directly here: the mzML control's output measured `25,518`
bytes in one run and `25,517` in another, from the same source, differing only in
the workspace name. The Thermo output's observed digest for the run recorded
above was
`6F3D900F881F8B8C195FE8A47DDF98FAF179CE83D0BC6B5A22DAFDA843FA59F6`. **The stable
facts are the structure and the counts**, and a later slice must not build a
cache key or an equality check on the size or the digest of a conversion output.

## Supported claims

- One named family — Thermo Scientific RAW, single file — is recognised by its
  documented file signature, read through a no-follow handle on the object.
- On provider build `3.0.26013 (47b13cf)`, that family converts to mzML through
  the existing boundary and produces exactly one output file.
- The produced document passes the fail-closed mzML scanner, is internally
  consistent — declared list counts and array lengths present and agreeing with
  what it holds, and no record declaring points while carrying no data for them,
  whether its arrays are empty or absent — has consecutive index sequences, and
  honours the requested zlib compression.
- The acquisition is identity-bound, digest-bound, rechecked before the backend
  starts and again before the output is judged, and **held against writes,
  renames and deletion for the whole run** — which both readers tolerate.
- Private staging, no-clobber handle-bound finalization and identity-bound
  cleanup apply to this family exactly as to mzML.

## Unsupported claims

- **No fidelity, losslessness or completeness claim.** Nothing here says the
  output contains what the acquisition contained. The source was never read
  under a comparable model and the result type refuses to imply otherwise.
- **No claim about other Thermo files.** One derived single-scan fixture with
  one spectrum and one chromatogram. Nothing about multi-sample acquisitions,
  large files, ion-mobility data, or an instrument model this fixture does not
  report.
- **No claim about other provider builds.** Support is refused on every build
  not listed as evidenced.
- **No claim about other vendors.** Bruker and Waters are directory
  acquisitions and remain unrecognised.
- **No product claim.** Nothing user-visible converts a RAW file after this
  slice. There is no command, transfer object, surface or queue.
- Backend cancellation, partial-output behaviour, overwrite semantics, progress
  and locale remain exactly as unmeasured as ADR 0009 records.

## Reproduction

The fixture is not tracked. Acquire it from the pinned URL above, verify the
byte length and SHA-256, then:

```text
cargo run --locked -p mscanvas-proteowizard --example conversion_source_evidence -- \
    --input <external-fixture-path> \
    --workspace <empty-scratch-directory> \
    [--diagnostics <local-file>]
```

The harness prints only shapes. `--diagnostics` writes the raw backend streams
to a local file because they name the acquisition; it is not printed, not
committed, and the caller deletes it after reading. The harness removes
everything it created inside its workspace before returning.

The same run is also an explicitly ignored test:

```text
MSCANVAS_THERMO_RAW_FIXTURE=<external-fixture-path> \
    cargo test --locked -p mscanvas-proteowizard --lib -- --ignored the_vendor_raw_evidence_run_is_reproducible
```

It is ignored rather than skipped silently, so a machine without the fixture and
the backend is told the claim went unchecked instead of shown a green run.
Ordinary CI runs neither, downloads nothing and reaches no backend.

## Cleanup

The downloaded fixtures, every converted output, the diagnostic file and every
scratch directory this evidence created were removed. No evidence cache is
retained. Nothing vendor-derived is tracked, and no ProteoWizard binary, DLL or
licence payload was copied into the repository.
