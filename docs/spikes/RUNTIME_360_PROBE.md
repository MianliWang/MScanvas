# Runtime 3.6.0 — the probe in the shape that would ship

**Outcome: the first half of the pass condition holds, and the second half is
NOT SHOWN.** The pass condition is the roadmap's section 7: "Every planned class
runs without the Thermo folder, and libiconv is shown not to be linked or its
terms are accepted. The result decides B-2".

| Part of the pass condition | Verdict | Evidence |
| --- | --- | --- |
| "Every planned class runs" | **PASS** | 26 of 26 ran: a real call on synthetic data, on the positive and on the relabelled negative files, each with a non-empty observable (82 calls, section 5). None was only imported, and none failed in the final run. |
| "without the Thermo folder" | **PASS** | The copy holds 0 Thermo-named files, 0 of its 76 native files has a CLR header, and no group loaded a Thermo module, `hostfxr` or `coreclr`. `OPENMS_THERMO_MANAGED_DIR` stayed unset. No RAW file was read (section 7). |
| "libiconv is shown not to be linked" | **NOT SHOWN** | 0 of 76 native files imports it, and `iconv`, `libiconv`, `libcharset`, `locale_charset` and 10 libiconv alias names each count 0, where a control libiconv DLL holds all 10 alias names. No SBOM or link map was found, and upstream's Windows build installed `libiconv` 1.18 for `libxml2[core,iconv,zlib]` and logged `Arrow is linked statically: added LibXml2 to its link interface` (section 8). |
| "or its terms are accepted" | **NOT SHOWN** | The owner's to answer, and not asked here. This record does not answer it. |

**What the rule gives on this evidence.** The first half holds. The second half
has neither of its two ways shown, so the rule gives no pass. No line is FAIL, so
it gives no failure either: B-2.1's pass branch and CK-2's fail branch both wait
for the owner's reading of the libiconv lines. Whether libiconv's terms are
accepted, and whether NOT SHOWN counts as a pass, are the owner's. B-2 is not
decided here.

Four other results size later work:

- **ANA-004 completes on 3.6.0 with no edit, and its numbers change.** The
  reviewed adapter runs unedited, and both outcomes match the pinned runtime's. The
  supervisor would still refuse the result until two adapter edits and its own pins
  change. Nine numbers of the `DETECTED` row differ by more than 1e-6 relative: the
  feature's bounds move in by 0.5 s on each side, and `rawArea` falls by 0.18 %
  (section 6). This is A-07's to qualify; it is not part of the pass condition.
- **U1's chain gives the same features.** On three synthetic files, 3.6.0 and the
  pinned 3.5.0 give the same 51 features, with no difference in RT, m/z or intensity
  (section 5.3). The call forms differ.
- **The copy is smaller and loads less.** 621 files, 130,632,028 B, about 33.3 MB
  compressed. It loads no Qt, no pandas and no matplotlib stack (sections 7 and 9).
- **The AWS SDK leaves no marker in `OpenMS.dll`,** although the notices list it and
  the decision page called it linked (section 9.2). curl and OpenSSL do leave
  markers. This does not show that the SDK is absent.

This record measures and reports. It answers no open decision, and it changes no
code, lock or pin.

## 1. What was asked

The owner chose a first runtime without Qt, on pyOpenMS 3.6.0, if a probe passes
(B-2.1, B-2.2), on the newest CPython 3.14 embeddable (B-2.3), tier 3 (B-3.1),
without the HMDB and Modomics files (B-3.2), without matplotlib and Pillow (B-3.3)
and without matchms (CK-1). B-6.4 adds a LOWESS second stage, so
`TransformationModelLowess` joins the 25 classes of the research lane's binding
probe. If the probe fails, CK-2 ships 3.5.0 first and obtains a legal opinion on Qt
first, with no release without it.

## 2. Scope and authorization

- **Approved on 2026-11-04.** The owner wrote "批准 A-03" in answer to the
  dependency ask. It covers four artefacts (section 3), in a temporary directory,
  for this probe and the AppContainer measurement, with no lock committed and nothing
  shipped. Asks 2 (development runtime and U1) and 3 (shipping) are not answered.
- **No fifth package and no pip.** pandas, matplotlib and Pillow were not downloaded.
  Nothing needed them.
- **No ProteoWizard program, no native or tauri spec, no EMBL-EBI file.** Synthetic
  data and the repository's fixture only.
- **Untrusted files stayed data.** Each download has its own new directory. Scripts
  sit elsewhere and take paths as arguments, the system Python read downloads with
  `-I`, and no interpreter ran with its working directory inside a download or the
  copy.
- **Memory gate.** Before each group: admission at 8 GiB free and at most 80 % used.
  The launcher stops a child under 4 GiB free or over 90 % used. No run came near
  either limit, and none was refused.
- **No outbound contact.** Upstream files and logs were read through public GET
  requests. Nothing was posted or sent.

This record names no absolute path of this host:

| Placeholder | Meaning |
| --- | --- |
| `<downloads>` | the directory holding one new directory per download |
| `<shape>` | the copy that would ship; left in place for lane runtime-confinement and for review |
| `<pinned>` | a verified scratch copy of `.tmp/m91-runtime/cpython-3.13.15-embed` |
| `<fixtures>` | the synthetic files |
| `<runs>` | one new directory per launch |
| `<tools>` | the scratch directory holding the scripts |

## 3. The four artefacts

All four matched before anything was unpacked.

| Artefact | File | Bytes | SHA-256 | Source of the digest |
| --- | --- | ---: | --- | --- |
| pyOpenMS 3.6.0 | `pyopenms-3.6.0-cp311-abi3-win_amd64.whl` | 30,604,790 | `d89532af91deb616664c673876db4eeb4d0bc5ecc9fa97dc55d47e477596f359` | the ask, equal to PyPI's JSON |
| nanobind-backend 1.0.0 | `nanobind_backend-1.0.0-cp314-cp314-win_amd64.whl` | 273,371 | `b0eabf671c91fdcd6a61d2177aa434731680442aa2317de54acfabeac4a4cc06` | PyPI's JSON |
| numpy 2.5.3 | `numpy-2.5.3-cp314-cp314-win_amd64.whl` | 12,698,179 | `2c25dfa72943e4336ddb6b0ee4277b47a0c85bede0807530ec68103bf58e2c10` | PyPI's JSON; the version equals the experiment lock's `numpy==2.5.3` |
| CPython 3.14.10 | `python-3.14.10-embed-amd64.zip` | 12,619,664 | `90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159` | python.org's release page, newest 3.14 on 2026-11-04 |

## 4. The shape

`build_shape.py` checks the four digests, then unpacks with `zipfile` only: no pip,
no launchers, nothing pip writes. It refuses a member with an unsafe name and never
overwrites. `site-packages` is added to `python314._pth` as
`scripts/provision_targeted_ms1_runtime.py` does for `python313._pth`.

**Manifest SHA-256:
`50e723ad41aa3857ae812670eea529356d6ade1cb9e24a3f1447b187f5856b83`** (621 entries,
each with path, bytes, SHA-256 and provenance; kept beside the copy, not in it).

Left out of the wheels:

| What | Files | Bytes | Why |
| --- | ---: | ---: | --- |
| `share/OpenMS/openms_thermo_bridge/` | 12 | 1,769,201 | AGENTS.md forbids vendoring it; never added back, whatever the result |
| `share/OpenMS/LICENSES/ThermoRawFileReader-License.doc` | 1 | 52,736 | outside the folder, ADR 0066's 2026-11-03 list |
| `share/OpenMS/LICENSES/vcpkg/openms-thermo-bridge.txt` | 1 | 1,583 | outside the folder, ADR 0066's 2026-11-03 list |
| `CHEMISTRY/HMDB2StructMapping.tsv`, `CHEMISTRY/HMDBMappingFile.tsv` | 2 | 51,303,517 | B-3.2 |
| `CHEMISTRY/Modomics.json`, `CHEMISTRY/Modomics.tsv` | 2 | 231,013 | B-3.2 |
| `*.pyi` | 320 | 3,386,731 | tier 2 |
| `*.cpp` (one file, in a numpy `tests/` folder) | 1 | 6,012 | tier 2 |
| every `tests/` folder | 383 | 6,456,159 | tier 3 |
| `pyopenms/plotting.py` | 1 | 21,046 | **a reading:** ADR 0066's tier 1 removes it, and `pyopenms/__init__.py` does not import it |
| the three wheels' `.dist-info/RECORD` | 3 | 125,373 | **a reading:** a RECORD names the removed files, and the provisioning script takes no wheel RECORD |

Kept: `CV/brenda.obo` (932,031 B, the mzML reader needs it on 3.5.0) and the rest of
`share/OpenMS`, including `THIRD-PARTY-NOTICES.txt`, unedited (section 9.4).

**Launch.** `launch.py` starts every run as the supervisor does: argv `python.exe -I
-B -X utf8 <script> [args]`, an emptied environment with `PATH` (the runtime,
`System32`, Windows), `SystemRoot`, `WINDIR`, `TEMP` and `TMP` in the run's `tmp`,
`OPENMS_HOME_PATH` in its `home`, and `OMP_NUM_THREADS=1`, at below-normal priority.
The working directory is the run's own new directory. There is no Job object.

**Import.** `python 3.14.10`, `pyopenms 3.6.0`, `OpenMS 3.6.0`, revision `5d5cbff`,
built `Sep 30 2026, 10:40:48`. `sys.path` holds only `python314.zip`, the runtime and
`site-packages`. `pyopenms/__init__.py` turns a failed submodule import into a warning
(`Failed to import {name}`), so warnings were captured: none was raised, and all 13
`_pyopenms_*` modules loaded.

## 5. The classes

### 5.1 Data

`make_synth.py` writes the data with the repository's own writer
(`write_mzml` in `experiments/m9_0/protocol.py`), and nothing there reads OpenMS.

- **Three samples, indexed.** 421 MS1 scans at 1 s over 420 s, one MS2 beside each
  apex. 15 compounds with `[M+H]+` and two isotopes, six of them also with `[M+Na]+`.
  20 noise peaks per scan, below every threshold the probes set. Samples 2 and 3 have
  non-linear RT drift and intensity factors 0.7 and 1.3. One compound is absent from
  sample 2.
- **The relabelled negative files.** The same arrays with the polarity word changed.
  They show that the classes run on a file that declares negative mode. They are not
  negative chemistry.
- **A profile file** of Gaussian peaks for `PeakPickerHiRes`, a 15-entry `library.msp`,
  and a 15-entry scratch accurate-mass database of these compounds. No HMDB row was
  copied; the wheel's copy was read for the column format only.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `synth_pos_s1.mzML` | 855,905 | `0e209bd55d2a2d8b6df870b59e4ff6f4585d3f16a860b195beaf39424bdaf1be` |
| `synth_pos_s2.mzML` | 852,381 | `ec19b1a155077b8bfe52b6366847ce4ed947287c6e848b5a47ad28d41cb1d0a5` |
| `synth_pos_s3.mzML` | 855,785 | `9180683008c9c82816ca1976c86393d39106e1760b5cc6c6a2f56e1f2feb493c` |
| `synth_neg_s1.mzML` | 855,905 | `17e0f35064619e7820936155d1b1f1809d09782c800b1552917e61332b9a0155` |
| `synth_neg_s2.mzML` | 852,381 | `aed479694067a2c58916bada3210cea76b6af2542ae5f67e31972c3baf3437a1` |
| `synth_neg_s3.mzML` | 855,785 | `0bb4a8a8fbc2cd4c269544be7cc90a4cbb379cc37a3fbb47a3b8ebd33cefc926` |
| `synth_profile.mzML` | 51,915 | `98b23c778e2e0f0399416bc02e9b8da710594fde307193d7fab9c402414bf79b` |
| `library.msp` | 3,162 | `a10a8ffdcacccc12205e400ed700cd931d821580bb290c2e1311f6d6e1bde533` |
| `ams_mapping.tsv` | 512 | `c4ca0d701ce14a4fbe7d54e8545b97b620bc608fd7fb04e2998684588d7bbca8` |
| `ams_mapping_neg.tsv` | 512 | `35a12b9ffae5922fcc104875172d800dd423a9b9d277e9db3c3b24b47c09dcbe` |
| `ams_struct.tsv` | 688 | `a26b8655fdbf2a42efde72cc3f29a4c8458c338d8d3773d7fbce21b87ac4ee90` |

### 5.2 The 26 classes

Each group of classes had one launch per polarity, so a native crash would be
attributable; none occurred. The U1 chain and alignment and linking ran end to end on
both polarities. A call whose observable was empty was recorded as failed. The figures
are the positive run's and are the same on the relabelled negative files unless noted.

| Class | Result | Call | What it produced |
| --- | --- | --- | --- |
| `MassTraceDetection` | ran | `run(exp, 0)` | 44, 33, 45 traces on the three samples |
| `ElutionPeakDetection` | ran | `detectPeaks(traces)` | 44, 33, 45 traces |
| `FeatureFindingMetabo` | ran | `run(traces, fmap)` | 18, 15, 18 features, all with isotope traces; 13 of 15, 10 of 14, 13 of 15 expected `[M+H]+` ions (section 5.3) |
| `MapAlignmentAlgorithmPoseClustering` | ran | `setReference(fmap)`, `align(fmap)` | `linear` models on 15 and 18 points |
| `MapAlignmentTransformer` | ran | `transformRetentionTimes(fmap, trafo, True)`, with the linear and then the LOWESS model | median distance to the reference, samples 2 and 3: 9.0 and 1.0 s, then 0.919 and 0.519 s, then 0.151 and 0.187 s |
| `FeatureGroupingAlgorithmKD` | ran | `group(maps, consensus)` | 18 consensus features, 15 in all three maps, 3 in two |
| `FeatureGroupingAlgorithmQT` | ran | `group(maps, consensus)` | 18 consensus features, 15 in all three maps, 3 in two |
| `MetaboliteFeatureDeconvolution` | ran | `compute(fmap, out, groups, pairs)` | 5 pairs of the 6 expected (the sixth compound left no trace); labels `H1`, `Na1`. With `negative_mode` true: 5 pairs, labels `H-1`, `H-2Na1` |
| `AccurateMassSearchEngine` | ran | `init()`, `run(fmap, MzTab)` on the scratch database | 21 `SML` rows hitting it; 19 on the negative files. Its defaults raise, as quoted below |
| `MetaboliteSpectralMatching` | ran | `run(ms2, library, mzTab)` | 15 MS2 spectra, 15 rows, 15 of 15 formulas |
| `IDMapper` | ran | `annotate(fmap, [], [], True, True, exp)` with `ignore_charge` true | 13, 10, 13 features with an MS2 mapped |
| `GNPSMGFFile` | ran | `store(consensusXML, mzMLs, out)` | 13 `BEGIN IONS` blocks |
| `GNPSQuantificationFile` | ran | `store(consensus, out)` | 18 lines |
| `GNPSMetaValueFile` | ran | `store(consensus, out)` | 4 lines |
| `SavitzkyGolayFilter` | ran | `filter(chromatogram)`, `filterExperiment(exp)` | chromatogram roughness 498,183 to 251,048; the profile spectrum changed |
| `GaussFilter` | ran | `filter(chromatogram)`, `filterExperiment(exp)` | roughness 498,183 to 277,173 with `gaussian_width` 5 s; the profile spectrum changed |
| `PeakPickerHiRes` | ran | `pickExperiment(exp)`, `pick(spectrum, out)` | 4 of 4 centroids, worst 0.002 ppm from the truth; `PROFILE` became `CENTROID` |
| `FeatureFinderAlgorithmMetaboIdent` | ran | ANA-004's adapter (section 6); `setMSData`, `run(compounds, fmap, path)` on an RT-transformed experiment | ANA-004's two outcomes; requantification: 2 features for 3 targets, the third absent from that sample |
| `SiriusExportAlgorithm` | ran | `run([mzML], [featureXML], out.ms, out.compoundinfo)` | 15 compounds, 24,188 B `.ms` |
| `ConsensusMapNormalizerAlgorithmMedian` | ran | `normalizeMaps(consensus, NM_SCALE, "", "")` | median ratio to map 0: 0.6587 and 1.2155, then 1.0628 and 0.9685 |
| `MzTabFile` | ran | `store(path, mzTab)`, `load(path)`, `store` again | 21 `SML` rows before and after (19 negative) |
| `MzTabMFile` | ran | AMS `run(fmap, MzTabM)`, `store(path, mzTabM)` | 21 `SML` and 21 `SMF` rows (19 and 19 negative) |
| `MSPGenericFile` | ran | `load(path, exp)`, `store(path, exp)` | 15 spectra, 3,941 B written |
| `OnDiscMSExperiment` | ran | `openFile(path)`, `getSpectrum(i)` | 436 spectra; three compared equal to the in-memory load |
| `PeakFileOptions` | ran | `setMSLevels([1])`, `MzMLFile.setOptions`, `load` | 421 of 436, 421 of 435, 421 of 436 spectra, levels `[1]` |
| `TransformationModelLowess` | ran | `TransformationModelLowess(data, params)`, `evaluate(x)` | 155.4319 and 179.8905, equal to `fitModel`'s `apply` at the same points |

- **`TransformationDescription.fitModel` accepts `"lowess"`.** `getModelType()` then
  returns `lowess`, and `getModelTypes` lists `linear`, `b_spline`, `interpolated`,
  `lowess`.
- **`MapAlignmentAlgorithmKD` has no 3.6.0 binding** (`hasattr` is `False`; it is
  `True` on the pinned 3.5.0). It is not on the planned list, so this is a fact and not
  a failure.
- **`AccurateMassSearchEngine`'s defaults raise,** as they did on 3.5.0, here because
  the HMDB files are out (`<shape>` stands for the path):

  ```text
  RuntimeError: the file 'CHEMISTRY/HMDBMappingFile.tsv' could not be found. OpenMS searched its shared-data directory '<shape>/site-packages/pyopenms/share/OpenMS' (via OPENMS_DATA_PATH env). If this is a wrong or outdated OpenMS installation, reinstall OpenMS (or ensure the executable sits next to its '.../share/OpenMS' directory); OPENMS_DATA_PATH is only used as a last-resort fallback, so unset it if it points to a stale location
  ```

- **B-9.1 chose a project-owned GNPS writer,** so the three `GNPS*` classes ran because
  the list names them, not because a recipe now takes them.

**Earlier attempts.** Every failure before the final run came from the probe's own
call or data. Each is listed with its text; the final run has none (`<work>` stands for
the attempt's directory).

| Class | What failed, verbatim | What changed |
| --- | --- | --- |
| `MzTabFile` | `AttributeError: 'pyopenms._pyopenms_format.MzTab' object has no attribute 'getSmallMoleculeSectionRows'` | `MzTab` has no public names on 3.6.0 or on 3.5.0, so rows are read from the written file |
| `MetaboliteSpectralMatching` | `RuntimeError: Could not convert non-string DataValue of type 'Empty' and value '' to string` | the MSP reader does not supply what the matcher reads: the probe sets `Metabolite_Name`, `Sum_Formula`, `Inchi_String`, `SMILES_String`, `Precursor_Ion`, `Massbank_Accession_ID` and `HMDB_ID` |
| `IDMapper` | no exception: `Unassigned and unidentified precursors: 15`, and 0 features with an MS2 | `ignore_charge` true (the fixture's precursors declare no charge), with 10 ppm and 5 s |
| `FeatureGroupingAlgorithmKD`, at the store | `RuntimeError: While storing '<work>/consensus_ids_pos.consensusXML': ProteinIdentification run identifiers are not unique. This can lead to loss of unique PeptideIdentification assignment. Duplicated Protein-ID is:UNKNOWN_SEARCH_RUN_IDENTIFIER in: <work>/consensus_ids_pos.consensusXML` | one identification run stands for the three |
| `GNPSMGFFile` | `RuntimeError:  in: Parsing was unsuccessful, cannot read file`, after `IndexedMzMLDecoder::findIndexListOffset Error: Could not find element indexListOffset in the last 1023 bytes. Maybe this is not a indexedMzML.` | every synthetic mzML written indexed |
| `SiriusExportAlgorithm` | `RuntimeError: Error: The SourceFile was annotated correctly in the provided mzML. Please run the OpenMS::FileConverter convert the files again from mzML to mzML.` | the fixture writer writes no `sourceFile`; the probe adds one and stores through `MzMLFile` |
| `FeatureFindingMetabo`, `ConsensusMapNormalizerAlgorithmMedian` | no exception: the probe's own first thresholds (every expected ion; within 2 % of 1) were not met | the observable became what section 5.2 shows |
| `GaussFilter` | no exception: at the default `gaussian_width` 0.2 the chromatogram was unchanged at 1 s spacing | a width in the data's own unit |

The engine also printed `Warning: SpectraDistance received the unknown parameter
'mass_tolerance'!` from `MetaboliteSpectralMatching`, and `The tool: TOPP
AccurateMassSearch is currently not registered in the PSI-OBO.` when writing mzTab-M.
Neither stopped a run.

### 5.3 U1 on both engines

`u1_both.py` ran the chain on the three positive files, on the shape and on `<pinned>`,
with each engine's call forms. Both give 44, 33, 45 traces and 18, 15, 18 features. All
51 features agree, with no difference in RT, m/z or intensity at full precision.

The expected ions the chain misses are therefore not new in 3.6.0: `adenine` and
`uridine` on all three samples, and `cytidine` and `thymidine` on sample 2. They leave
no trace at the default `min_sample_rate` 0.5. On sample 1 they appear at 0.1, or with
`trace_termination_criterion` `sample_rate`. Why these compounds and not the others was
not investigated. It is a fact for A-20 and A-13, on synthetic data.

The call forms that changed, for A-07 and A-20:

| 3.5.0 | 3.6.0 |
| --- | --- |
| `mtd.run(exp, traces, 0)` | `traces = mtd.run(exp, 0)` |
| `epd.detectPeaks(traces, out)` | `out = epd.detectPeaks(traces)` |
| `ffm.run(traces, fmap, chromatograms)` | `extra = ffm.run(traces, fmap)`, returning a tuple |
| `pickExperiment(exp, out, True)` | `out = pickExperiment(exp)` |
| `aligner.align(fmap, trafo)` | `trafo = aligner.align(fmap)` |

The first three rows ran on both engines. The last two ran on 3.6.0, and their 3.5.0
forms are from that binding's docstrings.

## 6. ANA-004

**Method.** The fixture `fmt_plain.mzML` (387,661 B, SHA-256
`2f4489d143f04e639534c25caf403fd30d09e7926989dfb263f45e84d12004bc`, equal to the pin,
generated by `fixture_set()["fmt_plain"]`) and ADR 0066's request: two targets,
`C8H10N4O2` and `C8H9NO2`, with `mzHalfWidthPpm` 5.0, `expectedPeakWidthS` 6.0, `rtS`
60.0 and `rtHalfWidthS` 20.0 (`request.json` SHA-256
`14953f71c641a89000bc1dd853a90b3f640307f91a994eac81567999def94c20`).

The adapter is `adapter_v1.py` from `main` at `1235be09`, SHA-256
`ed3f7fbd772de9489a4afff86cf3ac0a0d598690c16bb2c6cb87716021afb0ac`, the digest ADR 0066
measured. The baseline is `<pinned>`: `.tmp/m91-runtime/` was only read, its manifest's
SHA-256 equals `RUNTIME_MANIFEST_SHA256`, and all 4,628 files of the copy match their
entries, with nothing extra or missing.

ADR 0066's rule: a match when every key, word and status matches and every number is
within 1e-6 relative. Compared: `rows.jsonl`, `evidence.jsonl`, `outcome.json` without
`elapsedS`, and `result.json` without its `runtime` block, which is read apart.

### 6.1 The edits

**Edits it needs to complete: none.** The unedited adapter gives this on the shape:
`{"status":"completed","code":"OK","message":"","elapsedS":2.1224}`.

**Edits the supervisor needs, read from `targeted_ms1.rs` and not run through it:**

| Edit in the scratch copy | Why | Without it |
| --- | --- | --- |
| `resolved_profile`: a boolean value is written as `"true"` or `"false"` | five values come back as JSON booleans on 3.6.0 (`EMGScoring:init_mom`, `faims:merge_features`, `model:each_trace`, `model:no_imputation`, `model:unweighted_fit`), where `FIXED_ENGINE_PROFILE` holds strings | `ResultInvalid` |
| `KEY_MODULES`: `python314.dll`, the hashed `msvcp140-7c26….dll`, `OpenMS-747c….dll` and `OpenSwathAlgo-cd64….dll`, and no `qt6core.dll` | the DLLs moved to `pyopenms.libs/` under hashed names, so the old names match nothing and `loadedModules` is silently short | `RuntimeModuleMismatch` |

The scratch copy with these two has SHA-256
`a142411a86b3150be9723d868980b3fad54c620da02116c8e9ca0f18793b7a56`.

**Outside the adapter, listed and not touched:** `REQUIRED_MODULES`, `ENGINE_VERSION`,
`ENGINE_REVISION` (`5d5cbff`, where the pin is `c1370fb`) and `RUNTIME_MANIFEST_SHA256`;
then what follows from them (`schema_4_canonical.json`, the tests that name `c1370fb`
and `python313.dll`, and the provisioning script's `python313._pth`). That list and the
two edits are what this record offers for sizing A-07.

### 6.2 The comparison

Both runs give `DETECTED` and `NOT_DETECTED`, as on the pinned runtime.
**The rows do not match by the rule.** Of 1,043 numbers, nine break it, all in the
`DETECTED` row. With the two edits, nothing else breaks it.

| Number | Pinned 3.5.0 | Shape 3.6.0 | Relative |
| --- | ---: | ---: | ---: |
| `feature.leftS`, `candidates[0].leftS` | 52.5 | 53.0 | 9.43e-3 |
| `feature.rightS`, `candidates[0].rightS` | 67.5 | 67.0 | 7.41e-3 |
| `feature.rawArea` | 13765864.0 | 13740743.0 | 1.82e-3 |
| `candidates[0].rawArea` | 13765860.0 | 13740743.0 | 1.82e-3 |
| `feature.modelFwhmS` | 5.887426697291661 | 5.887170397167997 | 4.35e-5 |
| `feature.modelArea` | 6914079.118758143 | 6913842.397263862 | 3.42e-5 |
| `feature.engineIntensity` | 6914079.0 | 6913842.5 | 3.42e-5 |

- **`rawArea` stays what the protocol says it is.** It is the sum of the evidence points
  in the closed interval `[leftS, rightS]` on both engines: 62 points on 3.5.0 (relative
  5.6e-9) and 58 points on 3.6.0 (1.7e-8). The difference is the moved bounds.
- **The cause is not separated.** This lane has neither 3.5.0 on CPython 3.14 nor 3.6.0
  on 3.13. The feature's bounds come from the engine, and upstream's 3.6.0 notes carry
  chromatogram picking and fitting changes, but no one change was tied to this.
- **A new message on stderr,** twice per run, on 3.6.0 only: `Resampling spacing (0.05)
  is smaller than the smallest distance between data points (0.5). This approximates the
  detector dead time and may produce spurious peaks.`
- **The parameters.** The same 22 keys on both. The default of `EMGScoring:init_mom`
  changed from `false` to true; the adapter sets it explicitly, so that is not the cause.
- **Drift.** Two runs on the pinned runtime differ by at most 8.84e-8 relative. Two runs
  on the shape differ by at most 1.46e-16.

**Beyond the ADR's request: the no-candidate route.** With only the absent target
(`request_absent.json`, SHA-256
`e224681b27a6c836e1686a5593becee03eac3e172c2ae713988a9f95a3436c40`), the adapter's
measured exception still has its measured type and text on 3.6.0. The run completes with
`noCandidateRecovery` true, and it matches the pinned runtime by the rule (largest
8.84e-8).

## 7. What loads

ADR 0066's probe, repeated: import `pyopenms`, read the fixture with `MzMLFile`, build
`FeatureFinderAlgorithmMetaboIdent`, list what is loaded. The same list was taken at the
end of each of the other 16 launches. The union of all 17 is the same set of native
modules.

- **Python packages:** `pyopenms`, `numpy`, `nanobind_backend`, plus the standard
  library.
- **Never loaded, in any group:** `matplotlib`, `PIL`, `pandas`, `pyarrow`, `fontTools`,
  `contourpy`, `kiwisolver`, `dateutil`, `six`, `pyopenms.plotting`,
  `pyopenms._arrow_zerocopy`.
- **Also not loaded here:** `socket`, `_socket`, `select` and `subprocess`, which 3.5.0's
  import chain loaded (ADR 0066), and `ssl`, `_ssl`. `urllib` is loaded, as on 3.5.0.
  Nothing here shows that the engine's own network code is unreachable: `OpenMS.dll`
  imports `WS2_32.dll`, `IPHLPAPI.DLL`, `Secur32.dll`, `CRYPT32.dll` and `ncrypt.dll`, and
  they load with it.
- **Native modules:** 35 from the runtime and 32 from `System32`, none from elsewhere.
- **Named explicitly, and not loaded:** any `Qt6*` module, any Thermo module, `nethost`,
  `hostfxr`, `coreclr`, anything named `iconv` or `libxml`, `libssl-3.dll`,
  `libcrypto-3.dll` and `_arrow_zerocopy`.
- **`OPENMS_THERMO_MANAGED_DIR` is unset in the process,** and `pyopenms/__init__.py`
  sets it only when the bridge's files exist.
- **The MSVC runtime comes from the copy.** No `msvcp140`, `vcruntime140` or `vcomp140`
  loaded from `System32`. The Universal CRT does (`ucrtbase.dll`).

`OpenMS.dll` keeps its code for the bridge: 102 `Thermo` strings, 13 `hostfxr` strings,
the `openms_thermo_bridge` path. No file of the bridge is present, and none of that code
was exercised.

**The Thermo check at the end,** after the last run: no path in the copy contains
`thermo`, in any case; no native file has a CLR header; 0 `.cpp`, 0 `.pyi`, nothing under
a `tests/` folder, no pandas and no matplotlib file; `CV/brenda.obo` is there.

## 8. libiconv

**Report: not shown.** Every check that could have found a link found nothing, and none
of them is an SBOM or a link map.

| Check | Result |
| --- | --- |
| PE import and delay-import tables of the 76 native files (`pe_scan.py`, stdlib only) | no entry naming `iconv` or `charset`; `OpenMS.dll` has no delay imports at all |
| `iconv`, `libiconv`, `libcharset`, `locale_charset`, ASCII and UTF-16, any case, in all 76 | 0 each |
| 10 names of libiconv's alias table (`ARMSCII-8`, `MULELAO-1`, `GEORGIAN-PS`, `KOI8-T`, `TCVN-5712`, `BIG5-HKSCS`, `NEXTSTEP`, `MACTHAI`, `CSISO2022KR`, `UCS-2-INTERNAL`) in all 76 | 0 each |
| The same names in a control, MSYS2's `libiconv-2.dll` | 10 of 10, and `iconv` 14, `libiconv` 11 (control only; it is a dynamic build) |
| `libxml2`, `xmlParse`, `xmlCharEnc`, `xmlFindCharEncodingHandler`, `xmlIconv`, `xmlSAX`, `xmlBuffer`, `xmlReader`, `Azure` in `OpenMS.dll` | 0 each |
| Source paths the static libraries left in `OpenMS.dll`, by vcpkg port (`buildtrees\<port>\`) | `arrow` 49, `openssl` 9, `xerces-c` 111; no `libiconv`, no `libxml2` |
| The wheel's own notices | lists `libiconv [16]`; text `[16]` is `LICENSES/vcpkg/libiconv.txt`: "The libiconv and libcharset libraries and their header files are under LGPL", with LGPL-2.1 below it |
| An SBOM or link map from upstream | none found: release `v3.6.0` has five assets (two `.deb`, `.pkg`, `.exe`, `.tar.gz`); the wheel has no `sboms` folder; the tree at `5d5cbff` holds no SBOM (`tools/SPDX.txt` is not one) |

**What upstream's own files say, read at `5d5cbff`.**

- `cmake/third_party_licenses.cmake`, on the notices: "the license text of every vcpkg
  port of the target triplet". So a listing is no evidence for this port. The same comment
  goes on: "An installation carries the code of each port: as a library next to libOpenMS
  (install(RUNTIME_DEPENDENCY_SET) in package_general.cmake), linked into it (the Windows
  triplets and those of the Linux wheels are static), or compiled in (header-only ports)."
  That is a statement about ports in general and not a record of this one, and the checks
  above do not find this port's code.
- The route. The root `vcpkg.json` lists `libxml2`, and at the vcpkg baseline `libxml2` has
  `iconv` as a default feature that depends on `libiconv`. A code search of vcpkg's current
  tree names 41 ports for `libiconv`. Besides `libiconv` itself, three of them are in this
  build's plan: `libxml2`, and two that exclude Windows at the baseline, `boost-locale`
  (`!uwp & !windows & !mingw`) and `xerces-c` (`!windows & !osx`). So `libxml2` is the one
  route found. A search is not a dependency graph.
- `cmake/cmake_findExternalLibs.cmake`: "A statically linked Arrow needs libxml2:
  arrow_bundled_dependencies vendors azure-storage-common, whose xml_wrapper.cpp ...
  references xmlBufferCreate/xmlBufferFree and friends." This build's Arrow features have
  no Azure: `acero, compute, core, dataset, filesystem, json, parquet, s3`.
- `pyopenms-wheels-cibuildwheel`, run `36703348530`, job `109847769486`
  (`build-wheels-windows`), triplet `x64-windows-static-md-release`:

  ```text
  * libiconv:x64-windows-static-md-release@1.18#4 -- git+https://github.com/microsoft/vcpkg@dca28e93ad5a661156d8ea85aa4d26328dc309ed
    libxml2[core,iconv,zlib]:x64-windows-static-md-release@2.15.3 -- git+https://github.com/microsoft/vcpkg@0cca8e1dccfcd04a2d0d34f6fcf10a33190d558f
  -- Arrow is linked statically: added LibXml2 to its link interface
  ```

  So `libxml2` was named to the linker, and with it probably `libiconv`. A static library
  on a link line contributes only the objects something references. The log's 10 lines
  naming `iconv` are the plan, the install and the licence copies; none is a link command.

**What would settle it:** a link map or SBOM of `OpenMS.dll`'s link inputs. Only upstream
can publish one. Asking is outbound contact and needs the owner's go-ahead for that
message; nothing was sent or drafted.

## 9. Inventory for the records

### 9.1 Size and verification

| Measure | Value | 3.5.0 tier 3 without HMDB and Modomics (ADR 0066) |
| --- | ---: | ---: |
| Files | 621 | 1,790 |
| Bytes | 130,632,028 | 149,664,787 |
| Compressed (estimate) | 33,255,864 | 35,547,248 |

"Compressed" is ADR 0066's method: a pax tar of the files, no directory entries, sorted
by relative path, mtimes and modes as copied, then LZMA2 (xz, preset 6, 8 MiB dictionary).
It approximates an installer increment and is not a built installer.

| Package | Files | Bytes |
| --- | ---: | ---: |
| `pyopenms.libs` | 5 | 44,430,192 |
| `pyopenms` | 283 | 27,617,549 |
| CPython embeddable | 37 | 24,450,620 |
| `numpy.libs` | 2 | 21,164,112 |
| `numpy` | 262 | 12,124,955 |
| `nanobind_backend.libs` | 1 | 575,056 |
| `nanobind_backend` | 2 | 162,174 |
| `numpy` `.dist-info` | 21 | 99,822 |
| `pyopenms` `.dist-info` | 5 | 5,646 |
| `nanobind_backend` `.dist-info` | 3 | 1,902 |

Three SHA-256 passes over every file, after all runs: 0.70, 0.70 and 0.78 s, each against
the manifest, with 0 changed, 0 missing and 0 extra (1.21 to 1.57 s on an earlier set of
three). The LZMA2 estimate gave the same count on both of its runs. The cost at the
installed location is unmeasured.

### 9.2 The bundled native libraries

Where a file states a version, that is the version given. The log is the build log of
section 8.

| Library | Where | What the file states | Upstream's build log |
| --- | --- | --- | --- |
| CPython | `python314.dll` | 3.14.10 | — |
| OpenSSL | `libcrypto-3.dll`, `libssl-3.dll` (the embeddable's; neither is loaded) | `OpenSSL 3.5.9 29 Sep 2026`; file version 3.5.9.0; the SPDX file on python.org says 3.5.9 | — |
| curl | in `OpenMS.dll` | `libcurl 8.20.0` | `curl[core,non-http,ssl,sspi]` 8.20.0#1 |
| OpenSSL | in `OpenMS.dll` | no version string; 9 source paths under `buildtrees\openssl\` | 3.6.4#1; `Found OpenSSL ... (found version "3.6.4")` |
| AWS SDK | not found in `OpenMS.dll` | **no marker:** 0 for `amazonaws`, `X-Amz`, `S3FileSystem`, `InitializeS3`, `Aws`, `aws-sdk`, `aws-crt`, `aws-c-`. `AWS_SIGV4` and `aws_sigv4` are curl's own | `aws-sdk-cpp[cognito-identity,config,core,dynamodb,identity-management,kinesis,s3,sts,transfer]` 1.11.800, `aws-crt-cpp` 0.39.1 |
| Arrow, Parquet | in `OpenMS.dll` | `parquet-cpp-arrow version 24.0.0` | 24.0.0#1 |
| Xerces-C | in `OpenMS.dll` | `xercesc_3_3` | 3.3.0#1 |
| SQLite | in `OpenMS.dll` | source id `2026-05-05 10:34:17 c88b2201…` | 3.53.1#2 |
| SQLite | `sqlite3.dll` (the embeddable's) | file version 3.50.4.0 | — |
| .NET host (`nethost`) | in `OpenMS.dll` | `get_hostfxr_path`, no version | 8.0.3 |
| Thermo bridge | left out | code stays in `OpenMS.dll` (section 7) | `openms-thermo-bridge` 0.3.1 |
| OpenBLAS | `numpy.libs/libscipy_openblas64_-ed4f….dll` | no version resource | — |
| libsvm | in `OpenMS.dll` | `nr_class`, `total_sv`; no version | 3.35 |
| COIN-OR | in `OpenMS.dll` | `Cbc`; no version | `coin-or-cbc` 2024-06-04#1, `coin-or-clp` 2023-02-01#1 |
| Qt | none | 0 `Qt6`, 0 `QString` in `OpenMS.dll`; no Qt import in any of the 76 files; no Qt DLL | — |

No version here is a licence conclusion. Whether the AWS SDK or any other listed port is
linked is the same question as section 8; only `libiconv` is part of the pass condition.

`pyopenms/_arrow_zerocopy.pyd` (7,720,448 B) carries Arrow's C data interface and was
never loaded. Its status belongs to the licence slice.

### 9.3 Every MSVC runtime copy

For the RT-3 reading. "Loaded" is ADR 0066's probe.

| Name | File version | Carrying package | Bytes | SHA-256 (first 16) | Loaded |
| --- | --- | --- | ---: | --- | --- |
| `vcruntime140.dll` | 14.51.36247.0 | CPython embeddable | 178,616 | `d1f4225df2cd877d` | yes |
| `vcruntime140_1.dll` | 14.51.36247.0 | CPython embeddable | 50,112 | `a7146c08f89fe5b0` | yes |
| `msvcp140-7c26614e1d733892c2deac7e245ce115.dll` | 14.51.36247.0 | `pyopenms.libs` | 643,512 | `7c26614e1d733892` | yes |
| `msvcp140_atomic_wait-78fdb07d9fe55b8436cce6b09498237e.dll` | 14.51.36247.0 | `pyopenms.libs` | 37,376 | `da88331c40d3aaa0` | yes |
| `vcomp140-95d4ce4a6802d1e18b5e0e1722cc30ea.dll` | 14.51.36247.0 | `pyopenms.libs` | 212,920 | `95d4ce4a6802d1e1` | yes |
| `msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll` | 14.40.33810.0 | `nanobind_backend.libs` | 575,056 | `a4c2229bdc2a2a63` | yes |
| `msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll` | 14.40.33810.0 | `numpy.libs` | 575,056 | `a4c2229bdc2a2a63` | no: the module list shows this file name from `nanobind_backend.libs` only |

Two `msvcp140` versions are loaded in one process, under different hashed names. Whether
MSCanvas may redistribute these copies is the MSVC reading: RT-3, not answered here.

### 9.4 Notices

`share/OpenMS/THIRD-PARTY-NOTICES.txt` (522,059 B) stays in this copy unedited. It says
"This installation of OpenMS contains the third-party software listed below". It lists
`openms-thermo-bridge [25]` among the vcpkg libraries, and under `Thermo RawFileReader`:
`Thermo RawFileReader  LICENSES/ThermoRawFileReader-License.doc (not a text file)` and
`openms-thermo-bridge [47]`. The files behind those entries are left out of this copy, so
the file declares what this copy does not hold. **Whether it is left out, revised or
replaced is open** (ADR 0066's row on it), and this record does not decide it.

`nanobind_backend` carries no licence file: its `.dist-info` holds `DELVEWHEEL`, `METADATA`
and `WHEEL`, and `METADATA` has only the classifier `License :: OSI Approved :: BSD
License`. Which text ships with it stays open. `share/OpenMS/LICENSES/` keeps 157 files.

## 10. What this does not show

- **Real-file time and memory** (A-13's remainder). The files are under 1 MB. No time here
  is a budget.
- **The installed location, confinement, a Job object, the AppContainer measurement.**
  Every run was on an ASCII scratch path with no limit applied.
- **The M9.0 qualification protocol** (A-07). ANA-004 ran on one fixture and two targets,
  plus one no-candidate request, with one or two runs each. A match or a difference here is
  evidence for that fixture only.
- **The supervisor.** Its refusals in section 6.1 were read from the code. It did not run.
- **Other Python lines,** and which of the interpreter or the engine moved ANA-004's bounds.
- **A clean machine.** This host has a Visual C++ redistributable. The list in section 7
  shows the MSVC DLLs loading from the copy, on this host.
- **Negative chemistry.** The negative files are relabelled. They do not measure negative
  mode's time or memory, or B-5's adduct set.
- **Quality.** Features and matches were counted, not judged. The parameters are the
  probe's, not a recipe's, and thread counts above 1 and U1-2.3's ladder did not run. RAW
  input with the bridge missing was not tried.
- **Where the engine looks for its data.** The engine's message above calls
  `OPENMS_DATA_PATH` "a last-resort fallback", `pyopenms/__init__.py` says that libOpenMS
  "resolves its data directory from compiled-in paths before it consults
  OPENMS_DATA_PATH", and `OpenMS.dll` holds `D:/a/OpenMS/OpenMS/share/OpenMS`. Whether a
  folder at such a path would be read in place of the copy's was not tested. That belongs
  with the confinement measurement.
- **Any licence conclusion.** The inventories are facts for the licence slice, RT-3 and the
  owner.

## 11. What did not run

- **The other half of A-03,** the planned classes on a scratch tier-3 copy of the pinned
  3.5.0 runtime. It runs on a failure, and no line here is FAIL. It needs no new dependency,
  and `<pinned>` is its starting point, so it can run if the owner reads NOT SHOWN as a
  failure.
- **Asks 2 and 3,** the legal opinion on Qt and the MSVC reading. No lock, provisioning
  change or edit to `adapter_v1.py`, `recipe.rs` or `RUNTIME_MANIFEST_SHA256` was made. No
  message was sent or drafted.

## 12. The scripts

The scripts stayed in a scratch directory and are not committed. Nothing from this run
enters the repository except this record.

| Script | Run by | Purpose | SHA-256 |
| --- | --- | --- | --- |
| `build_shape.py` | system Python `-I` | checks the digests, unpacks, writes the manifest | `f586bbf537a6ffde9c6efcc5fc9bad5faa477e91f58287a0941407c325f9c292` |
| `launch.py` | system Python `-I` | the supervisor's launch, and the memory stop | `fa25b0390e8693e2ff7ca6a3d32669d6aa652f3f9559847a10a0b90fcb36e55b` |
| `run_group.sh` | shell | one group, one launch, after the memory gate | `ecb332ee6fc93f6f1b5239d5e717351cf1feea82e2a48a2655cc526d5e49a869` |
| `copy_pinned.py` | system Python `-I` | the verified copy of the pinned runtime | `e2fa22a69248dd4361394a58f64c03bbe687d86341b70f7835df71fa32d1f05b` |
| `make_fmt_plain.py` | system Python `-I` | the fixture and the request | `e5b6ad9c2dd168d2446531fcdc3b4101ab21d49c87a64341c447ecf61cd1d376` |
| `make_synth.py` | system Python `-I` | the synthetic files | `62e9e8cab8496d65b9ed34d42ec764e66b112f749b0244fd5bb65880abddf48b` |
| `probe_classes.py` | the shape | the classes, and what is loaded | `7d55d1af16dc42a61053f24e6dbc0a3709e23fb5fc12dda3f36a48a16c96b02e` |
| `adapter_v1_360.py` | the shape | the scratch adapter, two edits | `a142411a86b3150be9723d868980b3fad54c620da02116c8e9ca0f18793b7a56` |
| `compare_ana.py` | system Python `-I` | ADR 0066's rule on two adapter outputs | `8d150ed5921ae1078af38084301de289d59e2865a45310ec00a2b20a834707f8` |
| `check_area.py` | system Python `-I` | `rawArea` against the evidence points | `6f631ffb0a580775ebbb21a8c4077a816a9ca644497cb64462830aed4b1f7cf9` |
| `pe_scan.py` | system Python `-I` | import tables, CLR headers, marker strings | `86a1e65a946352b2f8b48d3d329160e36ed592a4d4e888d8bc10ce57d22682d2` |
| `inventory.py` | system Python `-I` | size, LZMA2, SHA-256 passes, versions, MSVC table, the final Thermo check | `cad55d721f097b0a911acb0028222afd81fd4e0641215e24e69ffdf763551b3d` |
| `u1_both.py` | the shape and `<pinned>` | U1 under each engine's call forms | `7474feb468dd3cc1c4013251b06ad27b59a91b83a567d701aea7a1a5052e5196` |
| `ffmi_params.py` | the shape and `<pinned>` | FFMI's default parameters | `df7821a6a0c4bf5d62230237853ee489b48e493366896e83d589a75f45eaa758` |
| `mztab_names.py` | the shape and `<pinned>` | `MzTab`'s public names, `MapAlignmentAlgorithmKD`, the ions missed | `b2e6bbffcad8d6669d9bb03e3cba086f8ee442147486820fa7fb019d390ba596` |
| `doc_350.py` | `<pinned>` | the 3.5.0 call forms | `3d538c43e5992df76917cc563aa2655739a3805c85810f96606e198e97e80d94` |
| `debug_mtd.py` | the shape | the missed ions against `min_sample_rate` | `9d7c3d10481a31815bd78258ee7b91a5642e621447023d97947ee03bdc160442` |

`request_absent.json` is `request.json` without the target `C8H10N4O2`, written by a
one-off command.

Downloads, runs and outputs are not committed either. Sections 3 to 9 give what a re-run
needs: the artefacts' digests, the exclusion list, the launch and the calls.
