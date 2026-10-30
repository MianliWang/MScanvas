# ADR 0056 R0 — The product mzML reader on real files

Status: **passed** on the rerun. Both files read exactly.
Rerun: 2026-10-30 (UTC). Reader source: `be/reader` at `f327055`, which
reads an unstated version from `xsi:schemaLocation` under the owner's
amendment of decision 1 that day.
First run: 2026-10-29, reader `4d45494`. It was **not passed**: the product
refused the PXD081190 file at the open ([The first run's refusal](#the-first-runs-refusal)).
Owner: [ADR 0056](../architecture/adr/0056-project-owned-mzml-reader-for-viewing.md),
decision 8 ("Before slice 1 merges, the product reader repeats that three-way
comparison on the same files").

## Outcome

- **MS1 profile file: exact.** The product reader, mzdata 0.68.0 and an
  independent Python decode agree on all 87,756 arrays bit for bit (54,689,492
  points) and on every compared field. All 43,878 spectra read, and every selected
  spectrum's row equals its table row. The largest array has 23,308 points.
- **PXD081190 calibrated file: exact.** The original file, unmodified, now
  opens. Its `<mzML>` element has no `version` attribute, and its
  `xsi:schemaLocation` names `mzML1.1.0.xsd`. The product and Python agree on
  all 72,638 arrays bit for bit (3,587,078 points) and on every compared field,
  for all 36,319 spectra. The product and mzdata agree as well. Every selected
  spectrum's row equals its table row.
- **The first run refused this file at the open** with `not_mzml_1_1`, because
  decision 1 then required the `version` attribute. The owner amended decision 1
  on 2026-10-30. When `version` is absent, the reader now reads the version
  from the schema file name, as ProteoWizard does.
- **The product's dump of the original file is byte-identical to the first
  run's dump of the diagnostic copy** that had `version="1.1.0"` added. The
  diagnostic copy was not needed again.
- **`msaccess run_summary` prints seconds.** On both minute-declared files,
  `MinRT` and `MaxRT` are the table's range in seconds, as whole numbers. This
  settles decision 3's "probably". The first run recorded this, and the rerun
  ran no ProteoWizard binary.

## Inputs

Public CC0 data, acquired and verified under the owner's 2026-10-29 bounded
ProteoWizard hold release (public datasets only; `msaccess` and `msconvert` on
copies only; outputs only under `D:\tmp\public-data\`). No data file is
committed.

| | PXD081190 calibrated | MS1 profile |
| --- | --- | --- |
| File | `BBM_506_P110_31_MIA_004_30_calibrated.mzML` | `BBM_506_P110_31_MIA_004_30.mzML` |
| Source | PRIDE `PXD081190`, `https://ftp.pride.ebi.ac.uk/pride/data/archive/2026/07/PXD081190/BBM_506_P110_31_MIA_004_30_calibrated.mzML` | `msconvert` 3.0.26013 output from the same project's `BBM_506_P110_31_MIA_004_30.raw` (275,621,692 bytes, SHA-256 `94f989f64261387ffde97f89248f69a8a78b613f9297b3d594b44b52164392e4`) |
| Licence | CC0 | CC0, inherited |
| Bytes | 208,408,454 | 546,327,287 |
| SHA-256 | `262d1178303cd934223239d5d93a3b842dca69da09cef58e95a39b950d26b7e8`, M0's pinned digest | `823286559d48f48af0ff0a90d602b33e16791b42bdef46f8cdf44f2021de4fc3` |
| Written by | MSFragger 4.1 calibration | ProteoWizard 3.0.26013, argv `["msconvert.exe","BBM_506_P110_31_MIA_004_30.raw","--mzML","--64","--zlib","-o","D:\\tmp\\public-data\\converted"]` |
| Spectra | 36,319: all MS2, all centroid | 43,878: 2,748 MS1 profile and 41,130 MS2 centroid |
| Arrays | m/z and intensity only; 64-bit float; zlib | m/z and intensity only; 64-bit float; zlib |
| Retention time | `UO:0000031` (minute) on every spectrum; 0.9229932427406311–32.99540328979492 | `UO:0000031` on every spectrum; 0.002757293606–33.003497392559 |
| Instrument | not declared in the file (the source RAW is an Orbitrap Exploris 480) | Orbitrap Exploris 480, serial MA10373C |

Both files re-hashed unchanged after every run, the rerun included.

## Method

Three readers ran on each file. They share no code.

- **Product:** `read_spectrum_table` and `read_selected_spectrum` from
  `mscanvas-proteowizard`, with its default features (not `test-support`) and
  `MzmlScanLimits::default()`. It was built as a path dependency in a scratch
  workspace seeded with the repository's `Cargo.lock`. `cargo tree` resolves the
  same `base64 0.22.1`, `flate2 1.1.10` (`rust_backend`, `miniz_oxide 0.9.1`),
  `quick-xml 0.41.0` and `thiserror 2.0.20` as the repository. For the rerun
  it was rebuilt from `f327055` with the same lock; `cargo tree` resolves the
  same versions.
- **mzdata 0.68.0** (default features off; `mzml` and `miniz_oxide`): the
  spike's route-(a) adapter, extended for the fields below, built in its own
  workspace so feature unification cannot touch the product build.
- **Python reference** (`python -I`, standard library only: `xml.etree`
  `iterparse`, `base64`, `zlib`, `struct`, `hashlib`): the spike's reference,
  extended the same way.

The harness and every output stay in scratch (digests under
[Environment](#environment)).

**Arrays.** Each array is compared as the SHA-256 of its decoded little-endian
bytes at the stored width, plus its role, data type, unit and length. The product
returns values widened to `f64`. The harness narrows each value back to the
stored width and checks that the round trip is bit-exact; a value that is not
counts as an error. Arrays are matched by role. Both files carry only
MS:1000514 and MS:1000515 arrays, so none was left out.

**Fields compared, exactly, unless noted:**

| Field | Product vs Python | mzdata vs Python |
| --- | --- | --- |
| Index, native ID, scan number | yes | yes |
| MS level, representation | yes | yes |
| Base peak m/z and intensity, TIC | yes | yes |
| Lowest and highest observed m/z | yes | yes |
| Retention time and its declared unit | yes | as minutes only (mzdata keeps no unit), against the reference's value ÷ 60 for seconds |
| `defaultArrayLength` | yes | not exposed |
| Precursor count; every precursor's selected-ion m/z | yes | yes |
| Every precursor's selected-ion intensity | yes | yes, after narrowing the reference to `f32` (mzdata stores `f32`) |
| Precursor charge, isolation target, activation, energy | not exposed | yes (target and energy as `f32`) |
| Polarity, filter string, analyzers | not exposed | yes |
| Array role, data type, unit, length, SHA-256 | yes | yes, and compression |
| Selected row equals table row | yes, every spectrum | not applicable |

The product was also compared directly with mzdata on the fields both expose.

## Results

The rerun's results. All three readers ran again on both original files.

### Exactness

| File | Leg | Spectra read | Arrays bit-identical | Field mismatches |
| --- | --- | --- | --- | --- |
| MS1 profile | product vs Python | 43,878 of 43,878 | 87,756 of 87,756 | 0 |
| MS1 profile | mzdata vs Python | 43,878 of 43,878 | 87,756 of 87,756 | 0 |
| MS1 profile | product vs mzdata | 43,878 of 43,878 | 87,756 of 87,756 | 0 |
| PXD081190 | product vs Python | 36,319 of 36,319 | 72,638 of 72,638 | 0 |
| PXD081190 | mzdata vs Python | 36,319 of 36,319 | 72,638 of 72,638 | 2 fields on every spectrum, below |
| PXD081190 | product vs mzdata | 36,319 of 36,319 | 72,638 of 72,638 | 0 |

In the first run, the product's PXD081190 row was **0 spectra: open refused,
`not_mzml_1_1`**. The diagnostic copy with `version="1.1.0"` added then read
exactly. Every other row matched the rerun.

The rerun's outputs were also checked byte for byte against the first run's.
The reference, mzdata and product dumps of the MS1 profile file are identical,
and so are the reference and mzdata dumps of PXD081190 and both index lists. The
product's dump of the original PXD081190 file is identical to its first-run dump
of the diagnostic copy. Dumps carry no offsets, so the 16 added bytes do not
show.

mzdata's two mismatches on PXD081190 are in fields the product does not expose,
and both are mzdata reporting something the file does not state:

- `analyzers`: the file's analyzer term has accession `UNKNOWN`. The reference
  keeps it, and mzdata drops it.
- precursor `energy`: the file states no collision energy, and mzdata reports
  `0.0`.

### Spectrum states and required values

- Both files: every spectrum read; no array error; no selected row differed
  from its table row.
- Both files state every value the table requires (decision 5) on every
  spectrum: MS level, scan start time, base peak m/z and intensity, and TIC. The
  reference counted none missing.
- On both files, every array's decoded length equals `defaultArrayLength` and
  `arrayLength` where stated. No spectrum has more than one precursor.

### Largest point count

| File | Largest array | Against the 2^23-point cap |
| --- | --- | --- |
| MS1 profile | 23,308 points (an MS1 profile spectrum) | about 360 times below |
| PXD081190 | 399 points | — |

### Timings and memory

These are the rerun's figures: two bench runs each, release builds, warm file
cache, on the machine under [Environment](#environment). The selected-spectrum
figures are 24 indices (21 evenly spaced, plus the smallest, median and largest
declared length), 3 passes each. They include the harness's copy of the arrays
to bytes. The product opens the file on every read, and mzdata keeps it open.
They are observations, not budgets.

| | Product | mzdata 0.68.0 |
| --- | --- | --- |
| Open: MS1 profile (546 MB) | table pass 1,845 / 2,382 ms (1,792 ms in the dump) | index 31 / 29 ms, then metadata 1,767 / 1,877 ms |
| Open: PXD081190 (208 MB) | table pass 1,731 / 1,186 ms (1,435 ms in the dump) | index 23 / 21 ms, then metadata 1,191 / 1,151 ms |
| Selected spectrum, MS1 profile | p50 0.22–0.54 ms, p95 1.00–2.40 ms, max 2.86 ms | p50 0.05–0.06 ms, p95 0.63–1.54 ms, max 1.56 ms |
| Selected spectrum, PXD081190 | p50 0.17–0.22 ms, p95 0.21–0.34 ms, max 0.53 ms | p50 0.04–0.05 ms, p95 0.05–0.09 ms, max 0.14 ms |
| Peak working set, MS1 profile (largest over all runs) | 42.3 MB (commit 42.5 MB) | 50.2 MB (commit 58.2 MB) |
| Peak working set, PXD081190 (largest over all runs) | 35.1 MB (commit 36.8 MB) | 42.8 MB (commit 48.7 MB) |

The first run's figures were of the same order. Its product table pass took
2,257 / 2,246 ms on the MS1 profile file and 1,550 / 1,456 ms on the diagnostic
copy.

For scale, M0 measured `msaccess`'s spectrum table at 3,921 ms on the 208 MB
file, on a 2-core hosted runner. The Python reference took 19.8 s and 37.8 s on
the rerun, and 13.1 s and 35.3 s on the first run.

### `msaccess run_summary` retention-time scale

Runs on copies in `D:\tmp\public-data\work\r0\`, with that folder as the
working directory. Neither run wrote a file.

| File | Declared unit | Table range | `MinRT` | `MaxRT` | Scale |
| --- | --- | --- | --- | --- | --- |
| PXD081190 calibrated | minute | 0.92299–32.99540 min = 55.38–1,979.72 s | 55 | 1980 | seconds |
| MS1 profile | minute | 0.00276–33.00350 min = 0.17–1,980.21 s | 0 | 1980 | seconds |

The values match the range in seconds, rounded to whole seconds. The source RAW's
`run_summary`, recorded when the data was acquired (`pxd-run_summary`), prints
the same `0` and `1980`.
`msaccess` opened the calibrated file, which has no `version` attribute, with
exit code 0.

| Label | argv | Exit | Elapsed | stdout (bytes, SHA-256) | stderr |
| --- | --- | --- | --- | --- | --- |
| `r0-pxd-mzml-run_summary` | `["msaccess.exe","BBM_506_P110_31_MIA_004_30_calibrated.mzML","-x","run_summary"]` | 0 | 4,113 ms | 712, `97e198b85f5c4fc6166853cc9954299836e52a8f429cc330f3b596c20d6e8310` | empty |
| `r0-ms1p-mzml-run_summary` | `["msaccess.exe","BBM_506_P110_31_MIA_004_30.mzML","-x","run_summary"]` | 0 | 8,576 ms | 887, `3364f009f9cd20cc4e3b62eabea0b6f40bfcc70ea4dfea9e7c8e68bcc047661e` | empty |

## The first run's refusal

The file's root is:

```xml
<indexedmzML xmlns="http://psi.hupo.org/ms/mzml" ... xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.2_idx.xsd">
  <mzML xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="BBM_506_P110_31_MIA_004_30" xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.0.xsd">
```

The `<mzML>` element names the mzML 1.1.0 schema but has no `version` attribute.
At `4d45494`, the product's `check_version` read only `version`, so it
refused, as decision 1 then said it should.

ProteoWizard reads this file as 1.1. At the measured build's source revision
(`pwiz@47b13cf`, `pwiz/data/msdata/IO.cpp`, `HandlerMSData`), it takes the
version from the file name in `xsi:schemaLocation` (`mzML1.1.0.xsd` gives
`1.1.0`). It reads the `version` attribute only when `schemaLocation` is empty,
and it applies its mzML 1.0 handling only to a version starting with `1.0`.

That made it a regression, not a strictness choice made for the user. Under
decision 3's routing by operation, and with no fallback, a file that `msaccess`
views today would have been refused at the open. MSFragger 4.1 wrote this
header. Other MSFragger-calibrated files probably share it, but that was not
checked.

The first run tested the cause with a diagnostic copy, built with
`["python","-I","add_version.py",<original>,<copy>]`. The copy differs from the
original only by ` version="1.1.0"` in the `<mzML>` start tag. It is 208,408,470
bytes, SHA-256
`12cc6b5f4272f0eebd020f9ad74f6f98ff05660aabd0e2d7974b1d6bcf28a9a4`, kept under
`D:\tmp\public-data\r0\` and not committed. It read exactly.

**The owner's decision, 2026-10-30.** The owner amended decision 1 as the first
run recommended. It is implemented at `f327055`:

- A stated `version` decides alone, even if it is empty, and it must be `1.1.x`.
- When `version` is absent, the schema that `xsi:schemaLocation` pairs with the
  mzML namespace decides. Its file name must be exactly `mzML1.1.<n>.xsd`.
- A document with neither is refused.

ProteoWizard's order is the other way round: it reads `xsi:schemaLocation` first
and `version` only when that is empty. The amendment keeps a stated `version`
first, so a stated `1.0.0` beside a 1.1.0 schema is still refused.

The reader parses the schema file name as ProteoWizard does, but more strictly:

- It finds the attribute by its resolved namespace, not by the `xsi` prefix.
- It takes the location paired with the mzML namespace, not whatever follows the
  first space.
- It refuses an odd token count, or two locations paired with the mzML
  namespace.
- It refuses a file name that is not exactly `mzML1.1.<n>.xsd`. That includes
  the index wrapper's `mzML1.1.<n>_idx.xsd`, which ProteoWizard would read as
  1.1 only by accident.

Slice 1's fixtures cover each case, in both the plain and the indexed form.

## Commands

Run from a scratch directory, not committed. `<file>` is one of the inputs
above. The first run's outputs went to `D:\tmp\public-data\r0\` and the
rerun's to `D:\tmp\public-data\r0b\`. The rerun ran these steps from one script,
`run_r0b.sh`, and rebuilt only the product. It reused the first run's mzdata
build and scripts, whose digests were checked unchanged.

| Step | argv |
| --- | --- |
| Build, product | `["cargo","build","--release","--offline"]` in `r0/prod`, `CARGO_TARGET_DIR=D:/tmp/cargo-target-r0` |
| Build, mzdata | `["cargo","build","--release","--offline"]` in `r0/mzd`, `CARGO_TARGET_DIR=D:/tmp/cargo-target-r0-mzd` |
| Reference | `["python","-I","py/ref.py",<file>,<ref.jsonl>]` |
| Dump | `["r0-prod.exe","dump",<file>,<out.jsonl>]`, `["r0-mzd.exe","dump",<file>,<out.jsonl>]` |
| Compare, product | `["python","-I","py/compare.py",<ref.jsonl>,<prod.jsonl>,"--skip=polarity,filter,analyzers,rt_min,precursor.charge,precursor.target,precursor.activation,precursor.energy,array.comp","--roles=MS:1000514,MS:1000515"]` |
| Compare, mzdata | `["python","-I","py/compare.py",<ref.jsonl>,<mzd.jsonl>,"--skip=dal,rt,rt_unit","--f32=precursor.target,precursor.energy,precursor.intensity"]` |
| Compare, product vs mzdata | `["python","-I","py/compare.py",<prod.jsonl>,<mzd.jsonl>,"--skip=dal,rt,rt_unit,rt_min,polarity,filter,analyzers,precursor.charge,precursor.target,precursor.activation,precursor.energy,array.comp","--f32=precursor.intensity"]` |
| Indices | `["python","-I","py/indices.py",<ref.jsonl>,<idx.txt>]` |
| Timing | `["r0-prod.exe","bench",<file>,<idx.txt>,"3"]`, `["r0-mzd.exe","bench",<file>,<idx.txt>,"3"]` |

The memory gate admitted every heavy step. The first run had 27.14–32.58 GiB
free and 49–57% used, and the rerun had 28.29–31.31 GiB free and 51–56% used.

## Environment

| | |
| --- | --- |
| Machine | Intel Core i7-12700H, 14 cores / 20 logical, 63.7 GiB RAM, NVMe SSD; Windows 11 10.0.26300 |
| Rust | 1.97.1 (the repository's `rust-toolchain.toml`) |
| Python | 3.14.3 |
| ProteoWizard | 3.0.26013 (`47b13cf`), installed |

| Scratch file | SHA-256 |
| --- | --- |
| `r0-prod.exe`, rerun (465,920 bytes, reader `f327055`) | `be9e002628f292d3a2418a2bfc8dae537e8821a6f72b37506488a98c8302f180` |
| `r0-prod.exe`, first run (461,312 bytes, reader `4d45494`) | `82376bde00e1114a88009219da297d81ac149222f779eba74ed43b2211e68f2d` |
| `r0-mzd.exe` (2,353,152 bytes) | `a2cdf7fa8fe1bcb28ffbd536dd8e82f21a22a3892d5feb0efdebab11c413a635` |
| `harness.rs` | `7ff7f52f64f149add43e9e35d14574076b40822765fd5b2b8dcd48e1c90cc9b8` |
| `prod/src/main.rs` | `1dab301a5d160811efc6e4bd21a39b2a43492ebb243c8b46268c34e96ed1b9fb` |
| `prod/Cargo.lock` | `786e7514c6c5099ce585796441d57e977e97960c831d3b9c689e620d5f1ff972` |
| `mzd/src/main.rs` | `8cf11a42e23758565cb04cab1a75d569815cf39de86e1919b80af283b74f28b9` |
| `mzd/Cargo.lock` | `76f19d88262925aa7c43079f423b63e189767dcff6a3bab62a3730e8b627aac4` |
| `py/ref.py` | `41d1d3504e8b431173d0eb7eb9528e267df8eb64ec592be9db51c1b5d95c6760` |
| `py/compare.py` | `18152cfcdd8ed6d21d385634960516a5813b617a5f1d16784523ef69a4399384` |
| `py/indices.py` | `e7d4148b7aefaef01119054226b6ad1555bb7abcb499b647d2dc64ea0d9270c3` |
| `py/add_version.py` (first run only) | `23698437c0d29c09a49b1f6e8307f3dc601a5c31c6de57da140571e2a07dbe26` |
| `run_r0b.sh` (rerun) | `4693a77b09e99003b2fa499515a2268a376d15b7e82ca7f814b284ba60375a74` |

## Limits

- Every real array here is 64-bit float with zlib. The 32-bit float, integer and
  uncompressed paths, and numpress, are covered only by slice 1's fixtures.
- 23,308 points is far below the cap. The extreme large-array path is covered
  only by slice 1's probes.
- Both files come from one acquisition, by one instrument. The reference and the
  product share an author, which is why mzdata is in the comparison.
- The timings are single machine, warm cache, two runs.
- The spike's own route (b) was not rerun. The product reader replaces it, and
  decision 8's merge condition names the product reader.

## Next

Decision 8's merge condition is met: the product reader reads both files
exactly. Slice 1 (PR #157) can merge once its checks pass. Slice 2, the wiring,
is next.
