# Thermo vendor centroiding — evidence

**Outcome: `MEASURED_ADMISSIBLE` for Thermo RAW on the verified build, at two
scopes: `peakPicking vendor msLevel=1-` and `peakPicking vendor msLevel=2-`.**

[M6.2](M6_MSCONVERT_CAPABILITY_EVIDENCE.md) left `peakPicking vendor` as
`EVIDENCE_BLOCKED`, with no lawful vendor acquisition. [M6.10 S1](M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#s1--the-vendor-picker-reached-at-last-and-what-it-changed)
reached the vendor picker on a Thermo file. That file was already centroided, so
what the algorithm computes stayed blocked. This record supplies the missing
input: public Thermo RAW files in profile mode, two at first and a third (3c)
added later the same day. It measures both scopes the product's centroid presets
need (CNV-005).

**MS2+ verdict on 3.0.26013 (added 2026-10-30): measured on Orbitrap profile
MS2.** 3c is a Q Exactive run whose MS2 is Orbitrap profile. Under
`peakPicking vendor msLevel=2-` all 23,676 of its profile MS2 spectra came out
centroid, and its 474 profile MS1 spectra came out bit-identical. Before 3c,
`2-` on profile MS2 rested on 14 ion-trap spectra.

**This record admits nothing and changes no code.** It proposes two verified rows
and the output checks they need. The rows belong to the branch that owns the intent
table, which adds them in its own change.

## Authorization and scope

The owner gave a bounded ProteoWizard hold release on 2026-10-29, for this work only:

- public datasets only;
- `msconvert` and `msaccess` from the installed 3.0.26013 build, run on copies;
- outputs written only under the release's scratch area;
- each run recorded: argv, exit code and output digests.

No owner file, other machine or other build was used. No data file is
committed. This record names no absolute path:

| Placeholder | Meaning |
| --- | --- |
| `<work>` | the directory holding the verified copy of a source |
| `<outdir>` | a per-case output directory, created new and empty |

The 3a and 3b runs took place from 2026-10-30T00:29Z to 00:38Z (UTC). The 3c
runs took place from 05:09Z to 05:13Z the same day.

## Measured ProteoWizard build

| Fact | Value |
| --- | --- |
| Tool | `msconvert` |
| Release | `3.0.26013 (47b13cf)` |
| `msconvert.exe` bytes | `12,687,872` |
| **`msconvert.exe` SHA-256** | **`9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`** |
| Thermo reader | the build's bundled `ThermoFisher.CommonCore.RawFileReader`; no EULA prompt appeared and none was accepted |
| `msaccess.exe` SHA-256 (3c's `run_summary` only) | `85681b205569a9850f47d079749e04ba45f4b0c64e363d4a2c5c67c3c67ed1f4` |

The runner checked this digest before every case. Each case's record also carries
the digest taken after it ran, and every one matches. M6.2, M6.10 and
`EVIDENCED_PROVIDER_BUILDS` bind the same executable.

## Sources

Each file was downloaded and verified before any of its runs, under the same
release. Each case read a byte-identical copy in `<work>`. Afterwards, the copies
and the downloaded originals re-hashed unchanged.

| | 3a: LTQ Velos | 3b: Orbitrap Exploris 480 | 3c: Q Exactive |
| --- | --- | --- | --- |
| File | `090701-LTQVelos-unittest-01.raw` | `BBM_506_P110_31_MIA_004_30.raw` | `QE004766.raw` |
| Origin | ProteoWizard repository, `pwiz/data/vendor_readers/Thermo/Reader_Thermo_Test.data.tar.bz2` at commit `4f92fe97ba0278a22486729d7ab658bba42a700a` | PRIDE `PXD081190`, `https://ftp.pride.ebi.ac.uk/pride/data/archive/2026/07/PXD081190/BBM_506_P110_31_MIA_004_30.raw` | PRIDE `PXD066799`, `https://ftp.pride.ebi.ac.uk/pride/data/archive/2026/06/PXD066799/QE004766.raw` |
| Licence | ships in the Apache-2.0 ProteoWizard repository with no separate data licence | CC0 (PRIDE project record) | CC0 (PRIDE project record) |
| Bytes | `2,086,041` | `275,621,692` | `224,196,132` |
| SHA-256 | `d457de3466d06bc91d39396afc6589ac87e3be1f909eea2c537b639e8675d2d6` | `94f989f64261387ffde97f89248f69a8a78b613f9297b3d594b44b52164392e4`. This is the first observation: PRIDE publishes no checksum | `3acbee9194e382c0841faa19085c6de2bf26009678e3c51ecfed2ef4a1f97698`. First observation, as for 3b |
| Integrity anchor | archive SHA-256 `167e84a90d6e68009b1c35ce23f542678810241a9e76f7240da9b19de0394836`; its git blob SHA-1 `f95653188a722c61c1891a532a8db2f03e384595` equals the one GitHub publishes at the pinned commit | size equals the PRIDE API and HTTP `Content-Length`; `msaccess` counts equal the converted census | the same two checks as 3b |
| Instrument | LTQ Velos, radial ejection linear ion trap, nanoESI, serial `LTQ30123`, Xcalibur 2.6.0, acquired 2009-07-02 | Orbitrap Exploris 480, serial `MA10373C`, acquired 2021-11-03 | Q Exactive (`MS:1001911`), quadrupole + Orbitrap, nanoESI, serial `Exactive Series slot #367`, Xcalibur 2.9, acquired 2025-04-15; data-independent acquisition, 50 isolation windows, HCD |
| Control census | 85 spectra; MS1 29 profile + 15 centroid; MS2 14 profile + 14 centroid; MS3 13 centroid; 4 chromatograms | 43,878 spectra; MS1 2,748 profile; MS2 41,130 centroid; 2 chromatograms | 24,150 spectra; MS1 474 profile; MS2 23,676 profile; 1 chromatogram |
| Profile points per spectrum | MS1 500–20,399 (median 20,399); MS2 8,759–13,739 (median 10,199) | MS1 653–23,308 (median 9,200) | MS1 1,538–47,863 (median 19,557.5); MS2 47–29,366 (median 612) |

**3c passed a gate before its treatments ran.** It was chosen to measure
`msLevel=2-` on Orbitrap profile MS2, so its control `TQ0` had to show two things.
Every MS2 spectrum had to declare `MS:1000128`. The instrument configuration had to
carry `MS:1000484`. Both held:

- the file has one instrument configuration, `IC1`: quadrupole (`MS:1000081`)
  and orbitrap (`MS:1000484`);
- every spectrum resolves to `IC1`;
- all 23,676 MS2 and all 474 MS1 spectra declare profile.

The filter strings (`FTMS + p NSI Full ms2 406.0000@hcd26.00 [200.0000-1280.0000]`
and so on) agree, but they were not the witness (fact 1 below). `msaccess`
`run_summary` on the copy also reports 474 MS1 and 23,676 MS2.

**How 3c was chosen.** Only one RAW file was downloaded for 3c. Other candidates
were screened first from public metadata, without downloading a RAW file:

- **ProteoWizard's Thermo test directory**, at the same pinned commit, holds six
  more RAW files, each with reference mzMLs of one to three spectra:
  - three of them hold one `FTMS + p` MS2 spectrum (`BSA-FT-HCD`, `BSA-FT-ETD`,
    `IsolationMzOffset-ReportedMassOffset`). Their references declare the generic
    "Thermo Electron instrument model" and an FT-ICR analyzer (`MS:1000079`), not
    `MS:1000484`, and they hold no MS1 spectrum;
  - the other three hold only centroid or ion-trap spectra (`FT-HCD-MSX`,
    `IT-HCD-SPS`, `source_cid_test_3scans`).
- **mzdata's `small.RAW`.** Its published conversion `small.mzML` shows ion-trap
  centroid MS2 (`ITMS + c`). ThermoRawFileParser's `small2.RAW` has no published
  conversion and was not screened.
- **PRIDE `PXD000001`** (LTQ Orbitrap Velos). Two byte ranges of its deposited
  mzXML show Orbitrap MS2 with `centroided="1"`.
- **A PRIDE search** for protocols that state profile-mode MS2, keeping each
  project's smallest RAW file. It led to `PXD066799`, whose protocol states
  profile mode for both the overview and the MS2 scans. `PXD082922` (Orbitrap
  Exploris 480, targeted MS2 in profile, 72,943,536 bytes, CC0) was the next
  candidate. It was not downloaded.

**3a also ships ProteoWizard's own expected outputs.** They are used below as an
independent reference, not as a gate:

| Reference | Bytes | SHA-256 | Written by |
| --- | --- | --- | --- |
| `090701-LTQVelos-unittest-01-centroid.mzML` (vendor-centroided expectation) | `775,412` | `561ae24864923e1ed250fe375985d1738d2385c68562874f407fedfef3d946d8` | pwiz `3.0.18248` |
| `090701-LTQVelos-unittest-01.mzML` (profile expectation) | `3,176,845` | `9fba04fd30f031dc21eeda52fe7a3865dd4d3705e419212e42af679dcd950f8e` | pwiz `3.0.10095` |

## Method

**The argv is the product's own shape.** `build_msconvert_command` writes the
source first, then `ConversionIntent::lower()`, then the destination. For the
shipped default that is `--mzML --zlib`, with no precision flag (m/z 64-bit,
intensity 32-bit). The picker step follows the encoding, as one argv element.
The filter value is exactly what the integration branch's
`SpectrumStep::PeakPickingVendor` lowers to. Every case holds precision and compression fixed, so the arrays of
out-of-scope spectra compare bit for bit with the control.

| Case | Source | Filter (one argv element after `--filter`) |
| --- | --- | --- |
| `TV0` | 3a | *(none)*: the verified default, the control |
| `TV1` | 3a | `peakPicking vendor msLevel=1-` |
| `TV2` | 3a | `peakPicking vendor msLevel=2-` |
| `TV3` | 3a | `peakPicking vendor` |
| `TE0` | 3b | *(none)*: the control |
| `TE1` | 3b | `peakPicking vendor msLevel=1-` |
| `TE2` | 3b | `peakPicking vendor msLevel=2-` |
| `TQ0` | 3c | *(none)*: the control, and the gate |
| `TQ1` | 3c | `peakPicking vendor msLevel=1-` |
| `TQ2` | 3c | `peakPicking vendor msLevel=2-` |

Full argv, for example `TV1`:

```text
["msconvert.exe", "<work>/090701-LTQVelos-unittest-01.raw", "--mzML", "--zlib",
 "--filter", "peakPicking vendor msLevel=1-",
 "--outdir", "<outdir>", "--outfile", "out.mzML"]
```

**Run discipline.** The runner was a Python `subprocess` argv list run under
`python -I`, never a shell string:

- each case wrote into a new, empty `<outdir>`;
- the process working directory was a separate empty directory, enumerated after
  every case;
- the memory gate printed `ADMITTED` before each run (30.6 to 32.2 GiB free, 49% to
  52% used) and before the 3b analysis (27.5 GiB free, 57% used);
- the three 3b conversions ran one at a time;
- for 3c, the memory gate printed `ADMITTED` before each run (18.7 to 21.1 GiB
  free, 67% to 71% used) and before the analysis (19.8 GiB free, 69% used). Its
  conversions and its `msaccess` run ran one at a time.

**Inspection.** A streaming reader (`iterparse`, each element cleared after use)
reused the repository's own strict decoder from
[`scripts/msconvert_evidence.py`](../../scripts/msconvert_evidence.py):
`_decode_array`, `role_defects`, `array_defects` and `declared_length`. That is
the decoder M6.10 corrected, which refuses rather than rounds. The full-tree
`inspect` command was not used on 3b, whose control output is about 529 MB, or
on 3c (about 624 MB).

Each treatment was paired with its control **by position**, and the pair had to
agree on native ID and MS level. The comparison was:

- arrays by SHA-256 of their decoded values;
- chromatograms by their decoded bytes and their accession sets;
- `spectrumList/@count` read beside the spectra actually written.

The tools are kept with the outputs, outside the repository:

| Tool | SHA-256 |
| --- | --- |
| `thermo_run.py` | `3DA6B23AEB5E8CA4222FE32B75EF0929ABE1FBC97A0D1477838E83ADED47B743` |
| `thermo_analyze.py` | `72CAECC93D8B3686F5ED807E4266D2BF86350331D9E6EB86DCEB451ADDBEF784` |
| `scripts/msconvert_evidence.py` at this record's base | `EAE13380B11F824C3D90504E9187FE6204BB73B7F213618E0F5FABED9989BCEB`, unchanged at 3c's base `01c23d9` |
| `ms2_run.py` (3c's runner: `thermo_run.py` with 3c's paths and digest, case ids `TQ0`–`TQ2`, and an `msaccess` `run_summary` step; same argv shape) | `07A3C13E653783E0F1773AE6DB954D28C709C9C7ADEE6FEB5DEF890AE665F2EE` |
| `ms2_gate.py` (3c's gate census: representation per MS level and the analyzer of each spectrum's instrument configuration) | `47D9388A6346638E8A20749C85D817B90198BD933E6863B62484B38AC5E7969C` |

3c's analysis ran the same `thermo_analyze.py`, unchanged.

## Run ledger

Every case exited `0` with empty stderr. Each `<outdir>` held exactly one entry,
`out.mzML`, and the working directory stayed empty.

| Case | Started (UTC) | Exit | Elapsed | Output bytes | Output SHA-256 | stdout SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `TV0` | 00:29:31 | 0 | 1,388 ms | 4,790,428 | `b84cb2977c788555670b2805cf7340217f110a20c62307a097a8c0bbf001b8e2` | `c9ce746b8ba72ce21277ad5b0bcf9d2368fd3385e18505f8d900f392bbdfd043` |
| `TV1` | 00:29:32 | 0 | 1,371 ms | 957,491 | `fdcfcd4589015ef72ad5e3b75c36e9d7de21ebfd3fcf5fa0a9f005142734cf76` | `408d86c3012aec35b81fde412f3a1861d3f3e02c66529e2c88c39d9537e1b24d` |
| `TV2` | 00:29:34 | 0 | 1,393 ms | 3,667,939 | `f189db30ac978a5e35013623ea61ec8686116512d1ee74ef15f2cf8bf25bfee4` | `82fbd5bcce2564cf879c5d7ac5dfd0512638da8464997ba49f3b3122fb56730c` |
| `TE0` | 00:29:45 | 0 | 63,632 ms | 528,766,200 | `386f0cc5f05b83966ac0b5a1219dc3063e1714ac6d6b75c4d1beee936d7ca17f` | `e508ed634b3900c1bd6beed24c1706f22eb86bddf8a19c09586ad51b621b1210` |
| `TE1` | 00:30:51 | 0 | 51,816 ms | 284,183,742 | `4727d25e277d98850afde73847953e6b0dab0390e1414cb2627cd2630e540983` | `84329612ada545870f1d166ec00e9442d296115c0bbb4113b4a85796910d9c4d` |
| `TE2` | 00:31:45 | 0 | 55,552 ms | 528,766,478 | `e5332f65aca0678637582aaf4db47c524fca1d3de36816d8382ba8066ec508c8` | `f3a2aedd1c48cf6158af2828a2876c3158134e3ab34f54826c9fb6ee1a05b4b4` |
| `TV3` | 00:37:45 | 0 | 1,178 ms | 957,491 | `fdcfcd4589015ef72ad5e3b75c36e9d7de21ebfd3fcf5fa0a9f005142734cf76` | `088802c3ee96e37f3c5fb6639c01bc95a7732b5054660b92c6f2e46d6dbe4000` |
| `TQ0` | 05:09:17 | 0 | 61,277 ms | 624,390,646 | `2346c0af07e8be7a63fb01c455b390595949bcb383f28edbb0eada43050ede0d` | `3a287713578dd1e0ed209ad48f99c735db550c5125b1acfbc5027dac7db8cddf` |
| `TQ1` | 05:11:45 | 0 | 31,600 ms | 162,117,857 | `23e88051106ddf0bd423f2ff0118c86ed9055188b670f40ec17e0e6aaa1a75ec` | `12b2f856ef0eeab50d1eae1a48240a6a1a03aee27d6b736518b2fb8d16089670` |
| `TQ2` | 05:12:27 | 0 | 45,072 ms | 249,849,541 | `ee2b37d15cbefd16496c4db95da31cc90028cf8b1eba70a522542e8c7b19396c` | `6b55f1a845d5b3aed8b8115a95717bf6a204f1dcde5cd584716a50de38b52f7c` |

3c also ran `["msaccess.exe", "<work>/QE004766.raw", "-x", "run_summary"]` at
05:11:06. It exited `0` after 27,420 ms with empty stderr and wrote no file. Its
stdout was 778 bytes, SHA-256
`95bad4a22f88d5882bf48ce61f4b4d0a9458cd5b14e9b8384b0511a0fc24455e`.

These outputs embed the source path (`sourceFile/@location`), so their digests
identify these runs and are not portable. stdout echoes the argv's paths, so its
digests are not portable either.

## Results

### What the output says was done

All six vendor outputs (`TV1`, `TV2`, `TE1`, `TE2`, `TQ1`, `TQ2`) add the same
`processingMethod` (order 1, software `pwiz`) to the control's
`Conversion to mzML`:

| Case | `cvParam` | `userParam`s |
| --- | --- | --- |
| `TV1`, `TE1`, `TQ1` (`msLevel=1-`) | `MS:1000035` peak picking | `Thermo/Xcalibur peak picking` |
| `TV2`, `TE2`, `TQ2` (`msLevel=2-`) | `MS:1000035` peak picking | `Thermo/Xcalibur peak picking`; `ms levels` = `2-` |

- **The vendor algorithm ran, and nothing was substituted.** The name is the
  string `mzml.rs` already classifies as `ProcessingAlgorithm::VendorPeakPicking`,
  as M6.10 measured. None of these outputs names the local-maximum or `CantWaiT`
  picker.
- **The scope is recorded only when it is not the default.** `msLevel=1-`
  writes no `ms levels` parameter, and `msLevel=2-` writes `2-`.
- **The record does not say which spectra were picked.** It sits in the one
  `dataProcessing`, which reaches every spectrum through
  `spectrumList/@defaultDataProcessingRef`. No spectrum carries its own
  `dataProcessingRef`, so under `msLevel=2-` the unpicked MS1 spectra resolve
  to the same picker record as the picked MS2 spectra.

### Population

In every vendor output these match the control:

- the spectrum count (85 for 3a, 43,878 for 3b, 24,150 for 3c);
- `spectrumList/@count`;
- the native ID and MS level at every position;
- the chromatograms (4 for 3a, 2 for 3b, 1 for 3c), by decoded bytes.

The strict decoder reported no defect in any output: no malformed array, no
length disagreement and no missing role.

### Representation and arrays, per MS level

Each bucket is an MS level and its representation in the control. "Identical"
means the decoded m/z and intensity values are bit-identical to the control's.

| Case | Bucket (count) | Output representation | Arrays | Points per spectrum, control → output (min / median / max) |
| --- | --- | --- | --- | --- |
| `TV1` `1-` | MS1 profile (29) | **centroid 29/29** | changed | 500 / 20,399 / 20,399 → 7 / 1,489 / 1,726 |
| | MS1 centroid (15) | centroid 15/15 | identical 15/15 | unchanged |
| | MS2 profile (14) | **centroid 14/14** | changed | 8,759 / 10,199 / 13,739 → 70 / 128.5 / 294 |
| | MS2 centroid (14) | centroid 14/14 | identical 14/14 | unchanged |
| | MS3 centroid (13) | centroid 13/13 | identical 13/13 | unchanged |
| `TV2` `2-` | MS1 profile (29) | **profile 29/29** | **identical 29/29** | unchanged |
| | MS1 centroid (15) | centroid 15/15 | identical 15/15 | unchanged |
| | MS2 profile (14) | **centroid 14/14** | identical to `TV1`'s MS2, all 28 | 8,759 / 10,199 / 13,739 → 70 / 128.5 / 294 |
| | MS2 centroid (14) | centroid 14/14 | identical 14/14 | unchanged |
| | MS3 centroid (13) | centroid 13/13 | identical 13/13 | unchanged |
| `TE1` `1-` | MS1 profile (2,748) | **centroid 2,748/2,748** | changed | 653 / 9,200 / 23,308 → 52 / 627 / 1,846 |
| | MS2 centroid (41,130) | centroid 41,130/41,130 | identical 41,130/41,130 | unchanged |
| `TE2` `2-` | MS1 profile (2,748) | **profile 2,748/2,748** | **identical 2,748/2,748** | unchanged |
| | MS2 centroid (41,130) | centroid 41,130/41,130 | identical 41,130/41,130 | unchanged |
| `TQ1` `1-` | MS1 profile (474) | **centroid 474/474** | changed | 1,538 / 19,557.5 / 47,863 → 106 / 1,435 / 3,507 |
| | MS2 profile (23,676) | **centroid 23,676/23,676** | changed | 47 / 612 / 29,366 → 3 / 44 / 2,117 |
| `TQ2` `2-` | MS1 profile (474) | **profile 474/474** | **identical 474/474** | unchanged |
| | MS2 profile (23,676) | **centroid 23,676/23,676** | identical to `TQ1`'s MS2, all 23,676 | 47 / 612 / 29,366 → 3 / 44 / 2,117 |

- **No in-scope spectrum is left in profile.** None of the six vendor outputs
  carries a single `MS:1000128` term inside its scope.
- **Out-of-scope spectra are left exactly as the reader gives them.** That
  includes 3a's 15 MS1 spectra the instrument had already centroided.
- **In-scope spectra that were already centroid pass through bit-identical.**
  M6.10 S1 observed the same on its one-spectrum file.
- **Every in-scope profile spectrum yields at least one centroid.** No empty
  spectrum was produced.
- **There is no zero-intensity padding.** No centroided spectrum holds a
  zero-intensity point. That differs from the local-maximum picker, which M6.2
  measured padding each apex with zeros.
- **The centroids stay inside the profile's range.** No centroid lies outside
  its profile spectrum's m/z range.
- **`peakPicking vendor` with no `msLevel=` equals `msLevel=1-`.** `TV3`'s output
  is byte-identical to `TV1`'s.

### What the algorithm computes

#### 3a: agreement with ProteoWizard's own expectation

`TV1` was paired with the shipped `-centroid.mzML` by native ID. All 85 spectra
matched:

- both files hold all 85 spectra as centroid;
- the point counts are equal in 85 of 85;
- every intensity is equal;
- every m/z equals ours, or equals the binary32 rounding of ours (largest
  difference `6.1e-5`).

The same comparison of `TV0` with the shipped profile file gives the same result
on all 85 spectra.

So this build's Thermo vendor centroiding reproduces, peak for peak, the result
ProteoWizard recorded as expected with build 3.0.18248. The only difference is how
precisely that file stores m/z.

#### 3b: sanity checks on Orbitrap MS1

There is no reference file for 3b. Two checks were run instead.

**The most intense centroid sits on the most intense profile sample.** This holds
in 2,692 of 2,748 MS1 spectra: the centroid lies within one profile sampling
interval of that sample.

**Its intensity is close to the profile apex height.** In all 2,748 spectra it is
1.000 to 1.068 times the highest profile sample (median 1.014). That matches an
interpolated apex height.

In the other 56 spectra the most intense centroid lies more than one interval
away, in some cases at a different peak. Its intensity is still within that
range.

**On the ion trap the two checks do not hold.** The same ratio is 3.1 to 8.3
(median 6.8 for MS1, 3.7 for MS2), and the positions match in only 4 of 29 MS1 and
8 of 14 MS2 spectra. The ion-trap vendor intensity is not an apex height, so the
most intense centroid and the most intense profile sample can be different peaks.
For 3a the reference agreement above is the evidence, not these checks.

#### 3c: the same checks on Orbitrap MS1 and MS2

There is no reference file for 3c either. The two 3b checks were run on `TQ1`
against `TQ0`, and they hold for Orbitrap MS2 as they do for MS1:

| Bucket | Most intense centroid within one profile interval of the most intense sample | Its intensity ÷ the highest profile sample (min–max, median) |
| --- | --- | --- |
| MS1 (474) | 463 of 474 | 1.000–1.068, median 1.029 |
| MS2 (23,676) | 22,984 of 23,676 | 1.000–1.112, median 1.018 |

In the remaining spectra (11 MS1, 692 MS2), the most intense centroid lies more
than one interval away, as in 3b. Its intensity is still within the range above.
`TQ2`'s MS2 arrays are bit-identical to `TQ1`'s, so the checks hold for both.

### Facts that shape the output checks

1. **The scan filter string is not a representation witness.** In `TV1` and
   `TE1`, all 43 and 2,748 centroided spectra still carry a Thermo filter string
   with `+ p`, which means profile (for example `FTMS + p ESI Full ms …`). Yet
   their representation term is `MS:1000127`. The same holds for all 24,150
   spectra of `TQ1`, MS2 included (`FTMS + p NSI Full ms2 …`).
2. **The algorithm record is per run, not per spectrum.** See "What the output
   says was done". A check that reads it per spectrum cannot tell a picked
   spectrum from an out-of-scope one.
3. **An out-of-scope spectrum can be profile or centroid.** 3a's MS1 under `2-`
   had both, as the reader delivered them.
4. **Point counts change by design.** The medians fall from 20,399 to 1,489
   (3a MS1), from 10,199 to 128.5 (3a MS2) and from 9,200 to 627 (3b MS1). For
   3c they fall from 19,557.5 to 1,435 (MS1) and from 612 to 44 (MS2).

## What the evidence supports

On the verified build, for Thermo RAW from an LTQ Velos, an Orbitrap Exploris
480 and a Q Exactive, the evidence supports these claims:

- `peakPicking vendor msLevel=1-` and `peakPicking vendor msLevel=2-` run the
  Thermo vendor picker and name it.
- They centroid every in-scope profile spectrum.
- They leave every out-of-scope spectrum and every chromatogram bit-identical.
- They keep the spectrum population exactly.
- On 3a the result equals ProteoWizard's own reference.

**Verdict for MS2+ on 3.0.26013:** `peakPicking vendor msLevel=2-` is measured
on profile MS2 from both analyzers. On the ion trap that is 3a's 14 spectra. On
the Orbitrap it is 3c's 23,676 spectra, from a Q Exactive.

M6.2 found the MS-level scope "unreachable in combination with any admitted
algorithm". It is now reachable **for Thermo RAW**, because the vendor picker can
be named.

This changes the dispositions of earlier records:

| Record | Before | After this record |
| --- | --- | --- |
| M6.2, candidate 4 (`peakPicking vendor`) | `EVIDENCE_BLOCKED` | measured, for Thermo RAW at `1-` and `2-` |
| M6.10 S1 ("what the vendor algorithm *does*") | blocked | answered for Thermo |

S3 (`cwt` and the default picker on representative profile data) is not
addressed. Neither runs on Thermo RAW, and none of these cases ran them.

## What it does not support

- **Other Thermo instruments or analyzers.** Not measured: Q Exactive models
  other than the original Q Exactive (3c), the Orbitrap Tribrid line, Astral,
  TSQ/SRM data, files with more than one controller (UV, PDA), and FAIMS.
- **Orbitrap profile MS2 beyond one Q Exactive data-independent run.** 3b's MS2
  was acquired centroided. Before 3c, `msLevel=2-` acting on profile MS2 was
  evidenced on ion-trap data only (3a, 14 spectra). 3c adds 23,676 Orbitrap
  profile MS2 spectra, but they come from one instrument model and one
  data-independent method. Data-dependent Orbitrap profile MS2 and other Orbitrap
  models were not measured.
- **Other builds or RawFileReader versions.** The 3a reference agreement spans
  builds 3.0.18248 and 3.0.26013, but transfer is still not claimed.
- **Other vendor readers.** Nothing was measured on Shimadzu LCD or SCIEX WIFF.
  Any picker name their readers write classifies as `Unrecognized` in `mzml.rs`
  until it is measured.
- **Other scopes and compositions.** Not covered:
  - `msLevel=1`, `2`, `1-2` or `3-`;
  - a vendor step beside an `msLevel` population filter, or any second step;
  - a precision other than the shipped default, or `--zlib=off`;
  - any non-mzML format, through ADR 0055's intermediate.
- **The quality of Thermo's peak detection.** MSCanvas can verify that the
  algorithm ran and that its output has the shape above. Whether its peaks are
  the right peaks belongs to Thermo's library. The 3a reference shows it is
  stable across ProteoWizard builds, not that it is correct.
- **Bare `peakPicking` on Thermo RAW.** It stays blocked (ADR 0055 decision 7).
  It selects the same vendor picker, but the request names the default picker.
  The CNV-D2 repair stops offering a combination where its evidence does not
  reach, rather than accepting whichever algorithm a reader happens to use.

## Proposed verified rows

These are for the branch that owns the intent table. Both rows require the
executable SHA-256 `9BB6F5D5…90BD`.

| Proposed row | Format | Spectrum chain | Population | Precision | Compression | Source domain | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Thermo RAW: vendor centroiding, MS1+ | mzML | `[PeakPickingVendor { ms_levels: Some(1-) }]` | All (no filter) | m/z 64, intensity 32 (no flag) | zlib | `MeasuredOn(&[ThermoRawFile])` | `TV1`, `TE1`, `TQ1`; reference agreement on 3a |
| Thermo RAW: vendor centroiding, MS2+ | mzML | `[PeakPickingVendor { ms_levels: Some(2-) }]` | All (no filter) | m/z 64, intensity 32 (no flag) | zlib | `MeasuredOn(&[ThermoRawFile])` | `TV2`, `TE2`, `TQ2` |

They lower, after the source, to:

```text
--mzML --zlib --filter "peakPicking vendor msLevel=1-"
--mzML --zlib --filter "peakPicking vendor msLevel=2-"
```

Each `--filter` value is one argv element.

**The source domain is coarser than the evidence, and that is a decision this
record does not settle.** `MeasuredOn(&[ThermoRawFile])` covers every Thermo RAW
file, including every instrument listed under "What it does not support". The
evidence covers three instrument models.

- **The argument for the family domain** is CNV-D2's own reasoning. Peak picking
  is decided by the reader, and the same bundled RawFileReader decides it for
  every Thermo instrument.
- **The argument against it is sharpest for MS2+.** Its only profile-MS2 evidence
  is 14 ion-trap spectra. Orbitrap (FTMS) profile MS2 is common on Q
  Exactive-class methods, and it was not measured. *2026-10-30: 3c measured it,
  on 23,676 spectra from a Q Exactive. MS2+ is now left with the gap MS1+ also
  has: the models listed under "What it does not support".*

The owner or the integration branch chooses one of two options:

- verify both rows now on the family argument;
- verify MS1+ now and keep MS2+ in the advanced tier, labelled, until a public
  FTMS profile-MS2 file is measured.

The owner chose the second option (ADR 0059, decision 2). 3c is the public FTMS
profile-MS2 file that option waited for.

**Citing these cases needs a validator change.**
`validate_the_admitted_intent_table_cites_measurements_that_support_it` resolves
a row's evidence against the M6.2 ledger in `scripts/msconvert_evidence.py`. It
does not know the case ids `TV1`, `TE1`, `TQ1`, `TV2`, `TE2` and `TQ2`, so the
change that adds the rows must extend it.

**The MS1+ row is CNV-005's "MS1+MS2" centroid choice, and the MS2+ row is its
"MS2" choice.** Both are verified-catalog rows, not user-saved presets in
[ADR 0058](../architecture/adr/0058-user-saved-conversion-presets.md)'s sense.
Both also act on MS3 and above, so their labels should say "MS1 and above" and
"MS2 and above".

**`ms_levels: None` stays out of the verified table.** It lowers to bare
`peakPicking vendor`, and `TV3` shows it byte-identical to `1-` on 3a only. If the
integration branch wants the unscoped spelling verified, the cheaper route is to
lower `None` to an explicit `msLevel=1-` and reuse this row.

**Nothing else moves.** These stay as they are:

- bare `peakPicking` on Thermo RAW, blocked;
- the vendor picker on mzML sources, blocked;
- the vendor picker anywhere but first, blocked;
- the "no additional centroiding" default, unchanged.

## Proposed output checks

Today's contract cannot accept these rows. `UnscopedDefaultCentroiding` refuses
`VendorPeakPicking` as unrequested. Its representation rule also requires every
spectrum to be centroid, which would refuse the correct `TV2` and `TE2` outputs.

Each of the following needs its own intent or chain-step handling:

1. **Algorithm.**
   - The output's history must add exactly one `MS:1000035` method naming
     `Thermo/Xcalibur peak picking` (`VendorPeakPicking`).
   - The local-maximum picker, `CantWaiT`, any `Unrecognized` name, or no added
     picker fails as `ProcessingAlgorithmMismatch`, or as unverified where the
     contract already degrades.
2. **Scope record.**
   - MS1+: no `ms levels` `userParam` on that method.
   - MS2+: exactly `ms levels` = `2-`.
   - Anything else fails. Both forms are what this build writes, and the rows are
     bound to this build.
3. **Representation, per spectrum.**
   - In scope (MS level ≥ 1, or ≥ 2): a spectrum with arrays must carry
     `MS:1000127` and not `MS:1000128`; otherwise it fails as
     `CentroidRepresentationMissing`.
   - Out of scope: the representation is not judged. A vendor source has no
     source mzML to compare with, and it may be either.
   - Never read the filter string's `p` / `c` token.
4. **Point counts.** In-scope spectra may change length, so the
   point-count-preserving rule is false for these intents, as it is for
   `UnscopedDefaultCentroiding`. Empty spectra and zero-intensity points were not
   observed. They are recorded as observations, not refusal rules, because
   nothing here shows that they are always wrong.
5. **Unchanged.** These still apply:
   - `OutputContainsNoRecords`;
   - `spectrumList/@count` read beside the spectra written;
   - the precision and compression term checks for the shipped default.
6. **Not checkable per item.** Out-of-scope arrays were bit-identical to a no-picker
   control here. A product run has no control, so the item outcome must not claim
   this, and the row's evidence carries it instead.

## Amended on adoption, not by this record

When the rows land, the change that adds them should also update:

- the [option inventory](MSCONVERT_OPTION_INVENTORY.md)'s `peakPicking vendor`
  row ("Absent; `EVIDENCE_BLOCKED`");
- [ADR 0055](../architecture/adr/0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)'s
  context line "Vendor centroiding stays evidence-blocked";
- M6.2's blocked table and M6.10 S1, each with a forward pointer here;
- the [feature catalog](../product/FEATURE_CATALOG.md)'s CNV-005 ("Scoped MS-level
  presets remain unconstructible"), for Thermo RAW.

## Deviations

- **`TV3` was not in the task's three cases.** It was added within the same
  release, on 3a only, because the integration branch's type admits
  `ms_levels: None`. It was not repeated on 3b.
- **The 3b digest is a first observation.** PRIDE publishes no checksum, so it is
  corroborated, not proven. The same holds for 3c.
- **3c came later, from a separate session under the same release.** Its runner
  is a copy of `thermo_run.py` with new paths and case ids, so the recorded
  `thermo_run.py` digest stays valid. 3c has no `peakPicking vendor` case without
  `msLevel=`, like 3b. It has no reference output either, so the 3b sanity checks
  stand in for one.
- **3c's screening downloaded public text, never a RAW file.** That text was six
  reference mzMLs from ProteoWizard's test directory, mzdata's `small.mzML`, and
  two byte ranges (3 MB and 2 MB) of `PXD000001`'s mzXML. They were read as data,
  are kept outside the repository with the outputs, and no ProteoWizard program
  ran on them.
