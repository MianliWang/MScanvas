# Runtime 3.6.0 — the probe in the shape that would ship

**Outcome: the first half of the pass condition holds, and the second half is
NOT SHOWN.** The pass condition is the roadmap's section 7: "Every planned class
runs without the Thermo folder, and libiconv is shown not to be linked or its
terms are accepted. A pass takes B-2.1 (3.6.0); a failure takes CK-2 (3.5.0 first,
with no release before a legal opinion on Qt)".

| Part of the pass condition | Verdict | Evidence |
| --- | --- | --- |
| "Every planned class runs" | **PASS** | 26 of 26 ran: a real call on synthetic data, in one launch per polarity, each with a non-empty observable (80 rows for the 26 classes, plus 2 `fitModel` checks; section 5.2 says what those rows are). In the negative launch, 22 classes read the relabelled negative files or features made from them: U1, alignment, linking, adducts, search, export, requested quantification, `ConsensusMapNormalizerAlgorithmMedian` and `OnDiscMSExperiment`. `SavitzkyGolayFilter` and `GaussFilter` read the one positive profile file and a synthetic chromatogram in both launches, `PeakPickerHiRes` reads that profile file in both, and `MSPGenericFile` reads a library with no scan polarity. The brief asks for two polarities only for U1 and for alignment and linking. None was only imported, and none failed in the final run. |
| "without the Thermo folder" | **PASS** | The copy holds 0 Thermo-named files, 0 of its 76 native files has a CLR header, and neither any group nor the adapter's process loaded a Thermo module, `hostfxr` or `coreclr`. `OPENMS_THERMO_MANAGED_DIR` stayed unset. No RAW file was read (section 7). |
| "libiconv is shown not to be linked" | **NOT SHOWN** | 0 of 76 native files imports it, and `iconv`, `libiconv`, `libcharset`, `locale_charset` and, in exact case, 10 libiconv alias names each count 0, where a control libiconv DLL holds all 10 alias names. No SBOM or link map of this build was found. Upstream's Windows build installed `libiconv` 1.18 for `libxml2[core,iconv,zlib]` and logged `Arrow is linked statically: added LibXml2 to its link interface`, and upstream's comment says the one object in that archive needing libxml2 is Azure's, which this build's Arrow leaves out. Those point opposite ways, and none is a record of this DLL's link (section 8). |
| "or its terms are accepted" | **NOT SHOWN** | The owner's to answer, and not asked here. This record does not answer it. |

**What the rule gives on this evidence.** The first half holds. The second half
has neither of its two ways shown, so the rule gives no pass. No line is FAIL, so
it gives no failure either: B-2.1's pass branch and CK-2's fail branch both wait
for the owner's reading of the libiconv lines. Whether libiconv's terms are
accepted, and whether NOT SHOWN counts as a pass, are the owner's. Which branch of
B-2 applies is not decided here.

Five other results size later work:

- **ANA-004 completes on 3.6.0 with no edit, and its numbers change.** The
  reviewed adapter runs unedited. On this one fixture and two targets, both outcomes
  match the pinned runtime's. The supervisor would still refuse the result until two
  adapter edits and its own pins change. Nine numbers of the `DETECTED` row differ by
  more than 1e-6 relative: the feature's bounds move in by 0.5 s on each side, and
  `rawArea` falls by 0.18 % (section 6).
- **An outcome can change too.** On a variant of the protocol's `main` fixture, a target
  with no `neutralMass` goes from `DETECTED_AMBIGUOUS` to `DETECTED`. With its declared
  mass it stays `DETECTED` and its `rawArea` changes; its model status changes too in the
  seven-target batch, and not when it runs alone. On both engines, model status depends
  on which targets share the batch (section 6.3). This and the numbers above are A-07's
  to qualify; neither is part of the pass condition.
- **U1's chain gives the same features.** On three synthetic files, 3.6.0 and the
  pinned 3.5.0 give the same 51 features, with no difference in RT, m/z or intensity
  (section 5.3, which also gives the one difference found, below U1's noise floor). The
  call forms differ, and four classes have new parameters.
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
  The launcher stops a child under 4 GiB free or over 90 % used. No launch was stopped.
  The gate refused some groups while other lanes ran, and they waited.
- **No outbound contact.** Upstream files and logs were read through public GET
  requests. Nothing was posted or sent.

This record names no absolute path of this host, other than paths compiled into the
files it reports:

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

Kept: `CV/brenda.obo` (932,031 B, the mzML reader needs it on 3.5.0 and on 3.6.0: on a scratch
copy without it, `call_forms.py` gets `the file '/CV/brenda.obo' could not be found`) and the rest
of `share/OpenMS`, including `THIRD-PARTY-NOTICES.txt`, unedited (section 9.4).

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
  They show that the classes that read them (section 5.2) run on a file that declares
  negative mode. They are not negative chemistry.
- **A profile file** of Gaussian peaks for `PeakPickerHiRes` and the two filters, which
  declares positive and has no negative twin, a 15-entry `library.msp`, and a 15-entry
  scratch accurate-mass database of these compounds. No HMDB row was copied; the wheel's
  copy was read for the column format only.

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
both polarities. The brief asks for two polarities only for those, so the verdict stands
on what follows. A call whose observable was empty was recorded as failed.

What the negative launch read differs by class (`probe_classes.py`):

- **The relabelled negative files, or features made from them: 22 classes.** U1
  (`PeakFileOptions`, `MassTraceDetection`, `ElutionPeakDetection`, `FeatureFindingMetabo`);
  alignment (`MapAlignmentAlgorithmPoseClustering`, `MapAlignmentTransformer`,
  `TransformationModelLowess`); linking (`FeatureGroupingAlgorithmKD`,
  `FeatureGroupingAlgorithmQT`); adducts (`MetaboliteFeatureDeconvolution`); search
  (`AccurateMassSearchEngine`, `MetaboliteSpectralMatching`, `IDMapper`); export
  (`GNPSMGFFile`, `GNPSQuantificationFile`, `GNPSMetaValueFile`, `SiriusExportAlgorithm`,
  `MzTabFile`, `MzTabMFile`); requested quantification (`FeatureFinderAlgorithmMetaboIdent`'s
  requantification call; ANA-004's fixture is positive only); and
  `ConsensusMapNormalizerAlgorithmMedian` and `OnDiscMSExperiment`.
- **The same input in both launches: 4 classes.** `SavitzkyGolayFilter` and `GaussFilter` read
  `synth_profile.mzML`, whose 20 scans all declare positive, and a chromatogram the script
  builds. `PeakPickerHiRes` reads that file alone. `MSPGenericFile` reads `library.msp`, which declares no scan
  polarity (each entry has `Precursor_type: [M+H]+`). Their negative rows match because the
  input is the same, and they say nothing about a file that declares negative mode. The review
  of this record ran `PeakPickerHiRes` and `SavitzkyGolayFilter` on a profile file of its own
  that declares negative, and reports that they run and depend on their input; that was not
  repeated.

The figures are the positive run's and are the same in the negative launch unless noted.

| Class | Result | Call | What it produced |
| --- | --- | --- | --- |
| `MassTraceDetection` | ran | `run(exp, 0)` | 44, 33, 45 traces on the three samples |
| `ElutionPeakDetection` | ran | `detectPeaks(traces)` | 44, 33, 45 traces, the same counts as its input, so these files cannot show a split. A separate doublet at one m/z does (`epd_doublet.py`): 1 trace in, 2 out, centroid RT 330.0 and 344.0 |
| `FeatureFindingMetabo` | ran | `run(traces, fmap)` | 18, 15, 18 features, all with isotope traces; 13 of 15, 10 of 14, 13 of 15 expected `[M+H]+` ions (section 5.3) |
| `MapAlignmentAlgorithmPoseClustering` | ran | `setReference(fmap)`, `align(fmap)` | `linear` models on 15 and 18 points |
| `MapAlignmentTransformer` | ran | `transformRetentionTimes(fmap, trafo, True)`, with the linear and then the LOWESS model | median distance to the reference, samples 2 and 3: 9.0 and 1.0 s, then 0.919 and 0.519 s, then 0.151 and 0.187 s |
| `FeatureGroupingAlgorithmKD` | ran | `group(maps, consensus)` | 18 consensus features, 15 in all three maps, 3 in two |
| `FeatureGroupingAlgorithmQT` | ran | `group(maps, consensus)` | 18 consensus features, 15 in all three maps, 3 in two |
| `MetaboliteFeatureDeconvolution` | ran | `compute(fmap, out, groups, pairs)` | 5 pairs of the 6 expected (the sixth compound left no trace); labels `H1`, `Na1`, `Agreeing charges: 10/10`. With `negative_mode` true: 5 pairs, labels `H-1`, `H-2Na1`, `Agreeing charges: 0/10` and the warning quoted below |
| `AccurateMassSearchEngine` | ran | `init()`, `run(fmap, MzTab)` on the scratch database | 21 `SML` rows hitting it; 19 on the negative files. Its defaults raise, as quoted below |
| `MetaboliteSpectralMatching` | ran | `run(ms2, library, mzTab)` | 15 MS2 spectra, 15 rows, 15 of 15 formulas |
| `IDMapper` | ran | `annotate(fmap, PeptideIdentificationList(), [], True, True, exp)` with `ignore_charge` true | 13, 10, 13 features with an MS2 mapped |
| `GNPSMGFFile` | ran | `store(consensusXML, mzMLs, out)` | 13 `BEGIN IONS` blocks |
| `GNPSQuantificationFile` | ran | `store(consensus, out)` | 18 lines |
| `GNPSMetaValueFile` | ran | `store(consensus, out)` | 4 lines |
| `SavitzkyGolayFilter` | ran | `filter(chromatogram)`, `filterExperiment(exp)` | chromatogram roughness 498,183 to 251,048; the profile spectrum changed |
| `GaussFilter` | ran | `filter(chromatogram)`, `filterExperiment(exp)` | roughness 498,183 to 277,173 with `gaussian_width` 5 s; the profile spectrum changed |
| `PeakPickerHiRes` | ran | `pickExperiment(exp)`, `pick(spectrum, out)` | 4 of 4 centroids, worst 0.002 ppm from the truth; `PROFILE` became `CENTROID` |
| `FeatureFinderAlgorithmMetaboIdent` | ran | ANA-004's adapter (section 6); `setMSData`, `run(compounds, fmap, path)` on an RT-transformed experiment | ANA-004's two outcomes; requantification: 2 features for 3 targets, the third absent from that sample |
| `SiriusExportAlgorithm` | ran | `run([mzML], [featureXML], out.ms, out.compoundinfo)` | 15 compounds, 24,188 B `.ms` (24,213 B negative) |
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
- **What the rows are.** The final run has 82 rows, all `ran`: 80 for the 26 classes and
  2 for `TransformationDescription`, which is not one of them. Of the 80, 2 are
  `AccurateMassSearchEngine.init()` with its defaults: the call raises as quoted above,
  and the exception's text is the row's observable, while the class's real runs are its
  scratch-database rows. Another 2 are `MzTabFile`'s first `store`: the store happens in
  the scratch-database call, and the row reports the file's size.

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

The engine also printed these, and none stopped a run. Quality is not judged here (section
10):

- From `MetaboliteSpectralMatching`: `Warning: SpectraDistance received the unknown
  parameter 'mass_tolerance'!`
- When writing mzTab-M: `The tool: TOPP AccurateMassSearch is currently not registered in
  the PSI-OBO.`
- In the two groups that run `FeatureGroupingAlgorithmKD` (alignment and GNPS), on both
  polarities: `Warning: Only 15 data points for LOWESS fit of map 1. Consider adjusting RT
  or m/z tolerance or max_pairwise_log_fc, decreasing min_rel_cc_size, or increasing
  max_nr_conflicts.`, and the same with 18 points for maps 0 and 2.
- From `MetaboliteFeatureDeconvolution` on the relabelled negative file only: `Warning: a
  significant portion of your decharged molecules have gapped, even-numbered charge ladders
  (5 of 5)This might indicate a too low charge interval being tested.`, with `Agreeing
  charges: 0/10`. It is the one class whose negative run printed a warning its positive run
  did not, and B-5 would take that chain. These files are not negative chemistry. The review of
  this record reports the same warning on a real `[M-H]-` file (`Agreeing charges: 0/8`,
  `(4 of 4)`); that was not repeated here.

### 5.3 U1 on both engines

`u1_both.py` ran the chain on the three positive files, on the shape and on `<pinned>`,
with each engine's call forms. Both give 44, 33, 45 traces and 18, 15, 18 features. All
51 features agree, with no difference in RT, m/z or intensity at full precision.

The expected ions the chain misses are therefore not new in 3.6.0: `adenine` and
`uridine` on all three samples, and `cytidine` and `thymidine` on sample 2. They leave
no trace at the default `min_sample_rate` 0.5. On sample 1 they appear at 0.1, or with
`trace_termination_criterion` `sample_rate`. Why these compounds and not the others was
not investigated. It is a fact for A-20 and A-13, on synthetic data.

**Other noise floors and width filters** (`u1_floor.py`, second review round). Six files (`main`, this
run's variant of it from section 6.3, `fmt_plain` and the three positive samples), thresholds
100, 300, 1e3, 3e3 and 1e4, and `width_filtering` `fixed`, `auto` and `off`: 88 of the 90 cells
are identical, with 1,818 features in the 3.5.0 runs. The two that differ are `main` and its
variant at 100 with `fixed`, where 3.6.0 adds 2 features and removes none (m/z 132.102 at RT
157.5 s, intensity 150289.906; m/z 269.107 at RT 172.0 s, intensity 645.65). Traces, split traces
and features go from 21, 30, 24 to 21, 32, 26 on `main`, and from 21, 31, 25 to 21, 33, 27 on the
variant. That floor is below U1's 1e3, and nothing in this grid differs at 1e3 or above. The
review of this record reports the same two cells on a wider grid, which was not repeated. A-13
needs this only if it measures below 1e3.

The call forms that changed, for A-07 and A-20. This is a floor and not the full list: the two
bindings were not compared call by call, and these are only forms this run and its review met. Of
the 44 top-level `oms.` names `probe_classes.py` uses, `TransformationModel_DataPoint` alone is
absent on 3.5.0. Nested names such as `ConsensusMapNormalizerAlgorithmMedian.NormalizationMethod`
were not counted, and the count says nothing of how the others are called, because
`probe_classes.py` did not run on 3.5.0.

| 3.5.0 | 3.6.0 |
| --- | --- |
| `mtd.run(exp, traces, 0)` | `traces = mtd.run(exp, 0)` |
| `epd.detectPeaks(traces, out)` | `out = epd.detectPeaks(traces)` |
| `ffm.run(traces, fmap, chromatograms)` | `extra = ffm.run(traces, fmap)`, returning a tuple |
| `pickExperiment(exp, out, True)` | `out = pickExperiment(exp)` |
| `aligner.align(fmap, trafo)` | `trafo = aligner.align(fmap)` |

The first three rows ran on both engines. The last two ran on 3.6.0, and their 3.5.0
forms are from that binding's docstrings.

These also changed, and each was tried on both engines (`call_forms.py`, fourth review round, on
`<pinned>` and on a scratch copy of `<shape>` that matched its manifest in three SHA-256 passes and
was then deleted). "Also" means 3.6.0 still takes the 3.5.0 form. `MzTabFile.load` takes
neither engine's form on the other, and the last two rows are return types.

ANA-004's adapter completes unedited. The `getPolarity()` and `getType()` row is on its path:
`check_source` reads both and compares them with the binding's own `SpectrumType.CENTROID` and
`Polarity.POSITIVE`, so it needs no edit, and section 6.3's `dom_profile` and `dom_mixed_polarity`
refusals fire on both engines. `experiments/m9_0/worker_pyopenms.py` compares the same way; that was
read and not run on 3.6.0. The other rows name calls `adapter_v1.py` does not make, and they bear on
A-20's recipe code.

| 3.5.0 | 3.6.0 |
| --- | --- |
| `MzTabFile().load(path, tab)`; `load(path)` raises `TypeError` | `tab = MzTabFile().load(path)`; `load(path, tab)` raises `TypeError` |
| `GNPSMGFFile().store(path, [bytes], out)`; `[str]` raises `AssertionError` | `[str]`, also `[bytes]` |
| `fmap.setPrimaryMSRunPath([bytes])`; `[str]` raises `Exception` | `[str]`, also `[bytes]` |
| `td.setDataPoints` with a list of lists; a list of tuples raises `Exception` | a list of tuples, also a list of lists |
| `oms.TM_DataPoint`; no `oms.TransformationModel_DataPoint` | `oms.TransformationModel_DataPoint`, also `oms.TM_DataPoint` |
| `oms.NormalizationMethod.NM_SCALE`, the integer 0; `ConsensusMapNormalizerAlgorithmMedian.NormalizationMethod` raises `AttributeError` | `ConsensusMapNormalizerAlgorithmMedian.NormalizationMethod.NM_SCALE`, also `oms.NormalizationMethod.NM_SCALE`, an enum member |
| `ConsensusMapNormalizerAlgorithmMedian().normalizeMaps(map, method, "", "")` on an instance; on the class it raises `TypeError` | on the class, as `probe_classes.py` calls it, also on an instance |
| On a positive centroid scan, `getPolarity()` and `getType()` return the integer 1 | `Polarity.POSITIVE` and `SpectrumType.CENTROID` |
| `Param.keys()` gives `bytes`: `b'mass_error_ppm'` | `str`: `'mass_error_ppm'` |

The parameter sets changed too (`param_keys.py`, second review round). The 17 classes of section 5.2
that expose default parameters hold 201 keys on 3.5.0. None is removed on 3.6.0, and one default
changes, `EMGScoring:init_mom` (section 6.2). Boolean values also read as words on 3.5.0 and as
booleans on 3.6.0, as section 6.1 says for the adapter. Eight keys are new, for the recipe records
of A-20 and A-21 to pin. The 3.6.0 runs of sections 5.2 and 5.3 left them at these defaults:

| Class | New key | Default on 3.6.0 |
| --- | --- | --- |
| `FeatureFindingMetabo` | `isotope_rt_overlap_reference` | `longer` |
| `FeatureFindingMetabo` | `local_im_range` | 0.02 |
| `FeatureFindingMetabo` | `min_isotope_rt_overlap` | 0.7 |
| `MetaboliteFeatureDeconvolution` | `max_multimer` | 1 |
| `MetaboliteFeatureDeconvolution` | `multimer_log_penalty` | -2.0 |
| `MetaboliteFeatureDeconvolution` | `rt_overlap_reference` | `union` |
| `MetaboliteSpectralMatching` | `ccs_error_percent` | 0.0 |
| `PeakPickerHiRes` | `allow_missing_flank` | false |

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
`ENGINE_REVISION` (`5d5cbff`, where the pin is `c1370fb`) and `RUNTIME_MANIFEST_SHA256`,
and then what names the pinned runtime, its version or its files. At `origin/main`
`5f3843f7`, `git grep -c -i -E
'c1370fb|python313|3\.13\.15|3\.5\.0|qt6core|openms\.dll|openswathalgo|cp313|msvcp140\.dll' --
apps scripts e2e` gives:

| File | Lines |
| --- | ---: |
| `apps/desktop/src-tauri/src/project/recipe.rs` | 3 |
| `apps/desktop/src-tauri/src/project/schema_4_canonical.json` | 16 |
| `apps/desktop/src-tauri/src/project/schema_5_canonical.json` | 16 |
| `apps/desktop/src-tauri/src/targeted_ms1.rs`; lines 109 to 112 are `REQUIRED_MODULES`, and line 177 is the development runtime's path | 5 |
| `apps/desktop/src-tauri/src/targeted_ms1/adapter_v1.py`; `KEY_MODULES` | 2 |
| `apps/desktop/src-tauri/src/targeted_ms1/tests.rs`; line 4505 is the same path | 4 |
| `apps/desktop/src-tauri/src/targeted_ms1/tests/batch.rs`; line 1090 names 8 `_pyopenms_*.cp313` modules, and lines 1092 to 1095 name the DLLs | 10 |
| `apps/desktop/src/features/project/TargetedMs1.test.tsx`; line 685 asserts `pyOpenMS 3.5.0` | 1 |
| `apps/desktop/src/test/projectFixtures.ts` | 6 |
| `scripts/provision_targeted_ms1_runtime.py`, with `python313._pth` | 9 |
| `e2e/specs/m9.1-targeted-ms1.browser.e2e.ts`; line 648 asserts `pyOpenMS 3.5.0 · FeatureFinderMetaboIdent · c1370fb` | 7 |
| `e2e/specs/m9.4-targeted-ms1-batch.browser.e2e.ts` | 6 |
| `e2e/support/pm9Scenarios.ts` | 5 |
| `e2e/support/targeted.ts` | 6 |

The same grep over the rest of the tree hits `README.md`, `ROADMAP.md`,
`docs/architecture/ANALYSIS_WORKERS.md` line 44 and other documents, which describe the current
runtime; experiments and evidence records, which stay as what they measured; and `Cargo.lock`,
where `3.5.0` is the unrelated crate `proc-macro-crate`. A grep sees names only, so this list and
the two edits are a floor for sizing A-07 and not its full extent.

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
- **Drift.** Repeated runs differ in both runtimes, always below 1e-6. Over three runs on
  the pinned runtime the largest is 8.84e-8. Over six on the shape it is 8.84e-8 between plain
  runs and 1.59e-7 between the two runs made inside `loads_after.py` and `trace_nt.py`. All of these
  are on `isotopeProbability`, a binary32 value, at one or two units in its last place. Some
  pairs on each side are identical, and another pair on the shape differs by 1.46e-16, so a
  single pair says nothing about the limit. Nothing here shows that 3.6.0 or 3.14 removed this
  drift.

**Beyond the ADR's request: the no-candidate route.** With only the absent target
(`request_absent.json`, SHA-256
`e224681b27a6c836e1686a5593becee03eac3e172c2ae713988a9f95a3436c40`), the adapter's
measured exception still has its measured type and text on 3.6.0. The run completes with
`noCandidateRecovery` true, and it matches the pinned runtime by the rule (largest
8.84e-8).

### 6.3 Beyond the ADR's request: the protocol's other fixtures

Run in the review round, once each, on `<pinned>` and the shape, through the unedited
adapter. Each file is written by `fixture_set()` (`review_fixtures.py`), with the ADR's two
targets. The comparison and its rule are section 6.2's; the unedited adapter also shows
the five `engineProfile` words of section 6.1 as differences, and they are left out below.

| Fixture | Result on both runtimes | Numbers breaking the rule |
| --- | --- | ---: |
| `fmt_plain`, `fmt_32_none`, `fmt_indexed`, `fmt_minutes`, `dom_unsorted` | `DETECTED`, `NOT_DETECTED` | 9 on each, in the fields of section 6.2 |
| `fmt_prefixed` | failed, `SOURCE_READ_INCOMPLETE` | no rows |
| `dom_profile` | refused, `SOURCE_NOT_CENTROID` | no rows |
| `dom_mixed_polarity` | refused, `SOURCE_MIXED_POLARITY` | no rows |
| `dom_missing_rt` | refused, `SOURCE_RT_UNDECLARED_OR_NONMONOTONIC` | no rows |
| `dom_no_ms1` | refused, `SOURCE_NO_MS1` | no rows |
| `main`, the protocol's seven targets | refused, `SOURCE_RT_NOT_STRICTLY_INCREASING`: `MS1 spectra share the retention time 60.0` | no rows |

`main` holds two MS1 spectra at RT 60.0, so it cannot go through the adapter as it is. The
variant here is this run's and not a repository fixture: `main` without the second of them
(index 128, 30 points, the protocol's `factor=0.9` scan), renumbered. It has 437 spectra,
891,078 B, SHA-256 `a3f5875b225775a6253d7204aa9be0b1da7c2c5c7d2a6d0610a03f6aebb8e843`. Two
requests ran on it, each with the protocol's seven targets and with `boundary` alone. In each
cell, the last two entries are the model status and `engineIntensitySource` (`batch_cells.py`).

| Request and batch | `boundary` on 3.5.0 | `boundary` on 3.6.0 |
| --- | --- | --- |
| The protocol's `neutralMass` 242.1154, seven targets | `DETECTED`, 1 candidate; bounds 112.5 to 127.5 s; `rawArea` 2809931.0; `0 (valid)`; `modelArea` | `DETECTED`, 1 candidate; bounds 113.0 to 127.0 s; `rawArea` 3254714.5; `5 (width too large)`; `imputedFromRunRegression` |
| The protocol's `neutralMass` 242.1154, alone | `DETECTED`, 1 candidate; bounds 112.5 to 127.5 s; `rawArea` 2809931.0; `0 (valid)`; `modelArea` | `DETECTED`, 1 candidate; bounds 113.0 to 127.0 s; `rawArea` 3254714.5; `0 (valid)`; `modelArea` |
| `neutralMass` null, so the mass comes from `C12H18O5`, seven targets | **`DETECTED_AMBIGUOUS`**, 4 candidates; bounds 112.0 to 128.0 s; `rawArea` 3325694.5; `5 (width too large)`; `imputedFromRunRegression` | **`DETECTED`**, 1 candidate; bounds 113.0 to 127.0 s; `rawArea` 3254830.5; `5 (width too large)`; `imputedFromRunRegression` |
| `neutralMass` null, alone | **`DETECTED_AMBIGUOUS`**, 4 candidates; bounds 112.0 to 128.0 s; `rawArea` 3325694.5; `0 (valid)`; `modelArea` | **`DETECTED`**, 1 candidate; bounds 113.0 to 127.0 s; `rawArea` 3254830.5; `0 (valid)`; `modelArea` |

The other six targets keep their outcomes in both seven-target requests: `DETECTED`,
`NOT_DETECTED`, `DETECTED_AMBIGUOUS`, `DETECTED`, `SUPPRESSED_BY_OVERLAP`, `NOT_DETECTED`.

- **The engine and the batch are separate factors.** Outcome, candidates, bounds and `rawArea`
  follow the engine and the request, and they are the same alone and among seven. Model status
  and its intensity source also follow the batch, on both engines. Alone, all four cells are `0
  (valid)`, `modelArea`. Among seven, the null-mass request is `5 (width too large)` on both
  engines, and only the declared-mass request differs between them. The width alone does not
  settle it: on 3.6.0 the same `modelFwhmS` 6.202611552828848 reads `5 (width too large)` among
  seven and `0 (valid)` alone. Why was not investigated.
- **The change in the declared-mass `rawArea` has a measured mechanism.** Every ion's
  `mzTheoretical` is lower by 1.4775e-8 Da on 3.6.0, whatever its formula or mass (for example
  `243.122676466771` and `243.12267645199572`). Alone that is within the rule. But the protocol
  places exact boundary probes on 3.5.0's open-window edges, with intensity 7777 on each edge
  and 11 and 13 just inside. On 3.6.0 the window sits that much lower, so the lower edge's 7777
  and its 11 fall inside and the upper edge's 7777 and its 13 fall outside. The extracted baseline
  goes from `24.0` (11 + 13) to `7788.0` (7777 + 11). At all 61 RTs of both traces, in both batch
  sizes, the 3.6.0 point minus the 3.5.0 point is 7,764 within 1e-6 relative, which is that
  difference. Inside 113 to 127 s that adds 225,156 over 29 points on each of two traces, 450,312
  in all. The narrower bounds take 5,528 from the 3.5.0 sum, and together those are the whole
  change in `rawArea`. It does not explain the status, which stays `0 (valid)` alone with the same window
  and the same `rawArea`. The probes no longer sit on the edges. Whether M9.0's exact-boundary
  check still holds is A-07's, and why the value moved was not investigated.
- **The cause of the null-mass outcome is not shown.** The evidence points agree by the rule
  there, and the engine returns fewer candidates: `candidates.featureXML` holds 9 candidates on
  3.5.0 and 6 on 3.6.0 among seven, and 4 and 1 alone. With the declared mass it holds 6 and 6
  among seven, and 1 and 1 alone. Each candidate has two subordinate features. The rule's
  comparison does not read that file. It changes on
  `fmt_plain` too, where the rule sees only section 6.2's nine numbers: `sn_ratio:
  58.140442086098886 -> 39.351242010876334`, `xx_lda_prelim_score: 9.022829233389071 ->
  8.737897162906719`, and an `adduct` value only on 3.6.0. That is a lead and not a shown cause.
- **For A-07:** outcomes and diagnostic fields can move as well as numbers, and a diagnostic field
  can depend on what else is in the batch. Each cell above is one run, on this run's own variant
  of one fixture. How much of it matters is A-07's.

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
- **Named explicitly, and not loaded in these 17 launches:** any `Qt6*` module, any Thermo
  module, `nethost`, `hostfxr`, `coreclr`, anything named `iconv` or `libxml`, `libssl-3.dll`,
  `libcrypto-3.dll` and `_arrow_zerocopy`.
- **The adapter's own process differs, and it is the one that would ship.** None of those 17
  launches ran the adapter, so this was measured after a full `adapter_v1.py` run in a new
  process (`loads_after.py`): 37 from the runtime and 32 from `System32`. It adds
  `_hashlib.pyd`, `libcrypto-3.dll` and `pyexpat.pyd`, because the adapter imports `hashlib`
  and `xml.parsers.expat`, and it lacks `_decimal.pyd`, which this probe's own `statistics`
  brings. `libssl-3.dll`, `ssl` and `socket` stay unloaded, and so does everything else named
  in the line above.
- **Apart from its script, request, fixture and run folder, the adapter's process opens one
  file outside the copy and the Windows folder.** `libcrypto-3.dll` has `OPENSSLDIR: "C:\Program Files\Common Files\SSL"` compiled
  in. A file trace of the run (`trace_nt.py`) shows `CREATE 0x0 \??\C:\Program Files\Common
  Files\SSL\openssl.cnf`, the status meaning success: that file exists on this host (12,328
  B), and nothing here put it there. Whether it can change a result was not measured. It
  belongs with the confinement measurement.
- **`OPENMS_THERMO_MANAGED_DIR` is unset in the process,** and `pyopenms/__init__.py`
  sets it only when the bridge's files exist.
- **The MSVC runtime comes from the copy.** No `msvcp140`, `vcruntime140` or `vcomp140`
  loaded from `System32`. The Universal CRT does (`ucrtbase.dll`).

`OpenMS.dll` keeps its code for the bridge: 102 `Thermo` strings, 13 `hostfxr` strings,
the `openms_thermo_bridge` path. The bindings keep their names too: `_pyopenms_format.pyd`
has `ThermoRawFile`, `ThermoRawFileOptions` and `ThermoRawFileParser`, and
`_pyopenms_metadata.pyd` and `_pyopenms_misc.pyd` have `Thermo`. No file of the bridge is
present, and none of that code was exercised.

**The Thermo check at the end,** after the last run, all review rounds included: no path in the
copy contains `thermo`, in any case; 0 `.cpp`, 0 `.pyi`, nothing under a `tests/` folder, no
pandas and no matplotlib file; `CV/brenda.obo` is there. That no native file has a CLR header is
`pe_scan.py`'s, run earlier and not repeated, on bytes that section 9.1's passes show unchanged.

### 7.1 Where the engine looks for its data

The results in this record came from the copy's `share/OpenMS`, but it is not the first place
the engine looks. A file trace of the adapter's run and of the `AccurateMassSearchEngine`
group (`trace_nt.py`) shows it querying other locations first. Each was missing on this host
(`0xc000003a`) in those runs, and a control run reads the copy's files and gives its usual 21
`SML` rows. `<runtime>` is the folder holding `python.exe`. `<plant>` is a scratch folder holding
a copy of the shape at `<plant>/shape`, deleted afterwards. No `share` folder was ever created
beside `<shape>`.

| Location queried before the copy | What was put there | Result |
| --- | --- | --- |
| `<runtime>/../share/OpenMS` | a full data folder, `PositiveAdducts.tsv` cut to one line | it wins: `Read 1 entries from adduct file '<plant>/share/OpenMS/CHEMISTRY/PositiveAdducts.tsv'.`, and the scratch-database run returns 0 `SML` rows |
| The same | only `CHEMISTRY/unimod.xml` | the whole data root moves, and the adapter fails: `the file '/CV/psi-ms.obo' could not be found. OpenMS searched its shared-data directory '<plant>/shape/../share/OpenMS' (via exe-relative (../share/OpenMS)).` |
| `CHEMISTRY/...`, relative to the working directory | `CHEMISTRY/PositiveAdducts.tsv`, one line, in the run's directory, on the shape itself | it wins: `Read 1 entries from adduct file 'CHEMISTRY/PositiveAdducts.tsv'.`, and 0 `SML` rows |
| `\CV\*.obo` and `\MAPPING\ms-mapping.xml`, at the root of the working directory's drive | nothing: this run writes to no drive root | the query follows the drive (`C:\CV\psi-ms.obo` with the working directory on `C:`, `D:\CV\psi-ms.obo` on `D:`). The review of this record put a file on a temporary drive mapping, and reports that it replaced the copy's; that was not repeated |
| `D:/a/OpenMS/OpenMS/share/OpenMS/CHEMISTRY/unimod.xml`, a path on upstream's build machine, compiled into `OpenMS.dll` | nothing | queried on this host, which has a `D:` drive |

`OPENMS_DATA_PATH` is set to the copy's folder, and this order agrees with what the engine and
the wheel say of it: the engine's message calls it "a last-resort fallback", and
`pyopenms/__init__.py` says that libOpenMS "resolves its data directory from compiled-in paths
before it consults OPENMS_DATA_PATH". The supervisor starts the worker in its attempt's folder
(`targeted_ms1.rs`, read and not run), so the relative row would read that folder and the
drive-root row that folder's drive. This belongs with lane runtime-confinement's measurement.

## 8. libiconv

**Report: not shown.** Every binary check found nothing, and none of them is a link map. The
written statements go both ways, and none of them is a record of this DLL's link. The general
ones say present: the notices say the installation "contains" what they list, `libiconv` among
it, and upstream's `third_party_licenses.cmake` says an installation "carries the code of each
port". Upstream's `cmake_findExternalLibs.cmake` points the other way on the one route found: it
says the only object in the Arrow archive that needs libxml2 is Azure's, and this build's Arrow
has no Azure. Neither is evidence for this port in this DLL, and binary silence is not proof of
absence.

| Check | Result |
| --- | --- |
| PE import and delay-import tables of the 76 native files (`pe_scan.py`, stdlib only) | no entry naming `iconv` or `charset`; `OpenMS.dll` has no delay imports at all |
| `iconv`, `libiconv`, `libcharset`, `locale_charset`, ASCII and UTF-16, any case, in all 76 | 0 each |
| 10 names of libiconv's alias table (`ARMSCII-8`, `MULELAO-1`, `GEORGIAN-PS`, `KOI8-T`, `TCVN-5712`, `BIG5-HKSCS`, `NEXTSTEP`, `MACTHAI`, `CSISO2022KR`, `UCS-2-INTERNAL`) in all 76 | 0 each in exact case. In any case, `OpenMS.dll` has UTF-16 `Big5-HKSCS` and `csISO2022KR`, once each, in a mixed-case list of IANA-style names (`CP01149`, `ebcdic-is-871+euro`, `Big5-HKSCS`, `UNICODE-1-1`), which is not libiconv's upper-case ASCII table |
| The same names in a control, MSYS2's `libiconv-2.dll` | 10 of 10, and `iconv` 14, `libiconv` 11 (control only; it is a dynamic build) |
| `libxml`, `libxml2`, `xmlParse`, `xmlCharEnc`, `xmlFindCharEncodingHandler`, `xmlIconv`, `xmlSAX`, `xmlBuffer`, `xmlReader`, `xmlCreate`, `xmlBufferCreate`, `xmlBufferFree`, `htmlParse`, `xml_wrapper`, `Azure`, ASCII and UTF-16, in all 76 | 0 each in exact case. In any case, `xmlBuffer` 3 and `xmlReader` 4 in `OpenMS.dll`, all Xerces' `XMLBuffer` and `XMLReader` (for example `src\xercesc\framework\XMLBuffer.cpp`), and `xmlParse` 4 in `_elementtree.pyd` and 5 in `pyexpat.pyd`, which are `XMLParser` and expat's `xmlparse.c`. `Azure` is 0 in any case too |
| Source paths the static libraries left, by vcpkg port (`buildtrees\<port>\`), in all 76 | `OpenMS.dll`: `arrow` 49, `openssl` 9, `xerces-c` 111. `_arrow_zerocopy.pyd`, which also carries a static Arrow, so the same route applies to it: `arrow` 36. No other file has any; no `libiconv`, no `libxml2` |
| The wheel's own notices | lists `libiconv [16]`; text `[16]` is `LICENSES/vcpkg/libiconv.txt`: "The libiconv and libcharset libraries and their header files are under LGPL", with LGPL-2.1 below it |
| An SBOM or link map from upstream | none of this build found: release `v3.6.0` has five assets (two `.deb`, `.pkg`, `.exe`, `.tar.gz`); the wheel has no `sboms` folder; the tree at `5d5cbff` holds no SBOM (`tools/SPDX.txt` is not one); run `36703348530` has four artifacts, `wheels-windows-x64`, `wheels-macos-arm64`, `wheels-linux-x64` and `wheels-linux-arm64`, none an SBOM or a map. GitHub's generated export for the repository does exist (`gh api repos/OpenMS/OpenMS/dependency-graph/sbom`, `com.github.OpenMS/OpenMS`): 63 packages from the repository's manifests, none with `iconv`, `libxml` or `charset` in its name. It is not about this DLL and is not a link record |

**What upstream's own files say, read at `5d5cbff`.**

- `cmake/third_party_licenses.cmake`, on the notices: "the license text of every vcpkg
  port of the target triplet". So a listing is not per-port evidence. The same comment
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
- `cmake/cmake_findExternalLibs.cmake`, on that route: "A statically linked Arrow needs libxml2:
  arrow_bundled_dependencies vendors azure-storage-common, whose xml_wrapper.cpp ...
  references xmlBufferCreate/xmlBufferFree and friends. It is the only object in that archive
  that does -- the AWS SDK is bundled too but brings its own parser (aws_xml_node_*) and needs no
  libxml2." This build's Arrow features have no Azure: `acero, compute, core, dataset,
  filesystem, json, parquet, s3`. If the comment holds for this build, nothing in that archive
  takes libxml2's objects. It is a comment about one archive, and not a record of this link.
- The same file, above its lookup: "Deliberately not REQUIRED: only the platforms that actually
  resolve those symbols against a system libxml2 need it. MSVC has no --as-needed and the Windows
  contrib build links a static Arrow with no system libxml2 present at all". That names another
  build. This one is a vcpkg build that installed `libxml2`, and the message its log shows below
  is printed only inside `if(LibXml2_FOUND)`. `src/openms/CMakeLists.txt` line 255 says "libxml2 is
  needed by a statically linked Arrow, but listing it here put it ahead of the archive that
  references it". The review of this record read the 17 files a code search gives for `libxml` and
  reports that line as the only one naming libxml2, with `MzIdentMLDOMHandler.cpp`'s `xmlDoc` a
  Xerces `DOMDocument`; that was not repeated.
- `pyopenms-wheels-cibuildwheel`, run `36703348530`, job `109847769486`
  (`build-wheels-windows`), triplet `x64-windows-static-md-release`. The log as read is
  2,456,346 B, SHA-256 `7f6a687f91e4f8a155141fff889ddb19ed16c02ce8c0d2e279c8281d38432ef5`, and
  its own wheel line ties it to the wheel probed here:

  ```text
  * libiconv:x64-windows-static-md-release@1.18#4 -- git+https://github.com/microsoft/vcpkg@dca28e93ad5a661156d8ea85aa4d26328dc309ed
    libxml2[core,iconv,zlib]:x64-windows-static-md-release@2.15.3 -- git+https://github.com/microsoft/vcpkg@0cca8e1dccfcd04a2d0d34f6fcf10a33190d558f
  -- Arrow is linked statically: added LibXml2 to its link interface
    cp311-win_amd64: pyopenms-3.6.0-cp311-abi3-win_amd64.whl 30.6 MB in 7 minutes, SHA256=d89532af91deb616664c673876db4eeb4d0bc5ecc9fa97dc55d47e477596f359
  ```

  So `libxml2` was named to the linker, and with it probably `libiconv`. A static library
  on a link line contributes only the objects something references. The log's 10 lines
  naming `iconv` are the plan, the install and the licence copies; none is a link command.

**What would settle it:** a link map or verbose linker output naming the objects taken from
the `libiconv` and `libxml2` archives. A port-level SBOM would not settle it, because a static
library named on a link line contributes only the objects something references. A rebuild from
the public tag at the same vcpkg baseline needs no outbound contact, but it would show that
rebuild and not the shipped DLL, unless its bytes match. Only upstream can publish the map of
the shipped DLL. Asking is outbound contact and needs the owner's go-ahead for that message;
nothing was sent or drafted, and no rebuild was tried.

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

Three SHA-256 passes over every file, after all runs, all review rounds included: 0.78, 0.67 and
0.65 s, each against the manifest, with 0 changed, 0 missing and 0 extra. The third and fourth
review rounds ran on scratch copies and did not start this one. Earlier sets took 1.05, 2.28 and
3.81 s on a busier host, 0.70, 0.70 and 0.78 s, 0.70, 0.72 and 0.80 s, 0.58, 0.64 and 0.72 s, and
0.55, 0.54 and 0.55 s. The LZMA2
estimate gave the same count on its three kept runs. The cost at the installed location is
unmeasured.

### 9.2 The bundled native libraries

Where a file states a version, that is the version given. The log is the build log of
section 8. This is not every port: the notices' own lists have 156 entries, and the log installs
155 packages. Only the libraries in this table were looked for, so a port missing here says
nothing about that port.

| Library | Where | What the file states | Upstream's build log |
| --- | --- | --- | --- |
| CPython | `python314.dll` | 3.14.10 | — |
| OpenSSL | `libcrypto-3.dll`, `libssl-3.dll` (the embeddable's). `libcrypto-3.dll` loads on the adapter's path through `hashlib`; `libssl-3.dll` does not (section 7) | `OpenSSL 3.5.9 29 Sep 2026`, in `libcrypto-3.dll` only; file version 3.5.9.0 on both; the SPDX file on python.org says 3.5.9 | — |
| curl | in `OpenMS.dll` | `libcurl 8.20.0` | `curl[core,non-http,ssl,sspi]` 8.20.0#1 |
| OpenSSL | in `OpenMS.dll` | no `OpenSSL 3.x` banner; a bare `3.6.4` after `openssl-version` and `crypto\provider_core.c` and before `crypto\core_algorithm.c`, read as OpenSSL's by those neighbours; 9 source paths under `buildtrees\openssl\` | 3.6.4#1; `Found OpenSSL ... (found version "3.6.4")` |
| AWS SDK | not found in `OpenMS.dll` | **no marker:** 0 for `amazonaws`, `X-Amz`, `S3FileSystem`, `InitializeS3`, `Aws`, `aws-sdk`, `aws-crt`, `aws-c-`. `AWS_SIGV4` and `aws_sigv4` are curl's own | `aws-sdk-cpp[cognito-identity,config,core,dynamodb,identity-management,kinesis,s3,sts,transfer]` 1.11.800, `aws-crt-cpp` 0.39.1 |
| Arrow, Parquet | in `OpenMS.dll` | `parquet-cpp-arrow version 24.0.0` | 24.0.0#1 |
| Xerces-C | in `OpenMS.dll` | `xercesc_3_3` | 3.3.0#1 |
| SQLite | in `OpenMS.dll` | source id `2026-05-05 10:34:17 c88b2201…` | 3.53.1#2 |
| SQLite | `sqlite3.dll` (the embeddable's) | file version 3.50.4.0 | — |
| .NET host (`nethost`) | in `OpenMS.dll` | `get_hostfxr_path`, no version | 8.0.3 |
| Thermo bridge | left out | code stays in `OpenMS.dll` (section 7) | `openms-thermo-bridge` 0.3.1 |
| libffi | `libffi-8.dll` (the embeddable's; `_ctypes.pyd` imports it, and it loads) | no version resource; the SPDX file on python.org says 3.4.4 | — |
| libtommath | `libtommath.dll` (the embeddable's, 95,456 B; no native file in the copy imports it, and it does not load) | no version resource; named in neither the SPDX file on python.org nor `LICENSE.txt` | — |
| OpenBLAS | `numpy.libs/libscipy_openblas64_-ed4f….dll` (it loads) | no version resource; `numpy/__config__.py` says `scipy-openblas` `0.3.34.106.0` | — |
| OpenBLAS | in `OpenMS.dll` | its messages (`OpenBLAS warning: precompiled NUM_THREADS exceeded, adding auxiliary array for thread metadata.`), `OPENBLAS_NUM_THREADS`; no version string | `openblas` 0.3.33; the notices list `openblas [24]` |
| zlib | in `OpenMS.dll` and `_arrow_zerocopy.pyd` | ` deflate 1.3.2 Copyright 1995-2026 Jean-loup Gailly and Mark Adler `, ` inflate 1.3.2 Copyright 1995-2026 Mark Adler ` | 1.3.2 |
| zlib-ng | in `python314.dll` (the embeddable's) | `1.3.1.zlib-ng`; the SPDX file on python.org says `zlib-ng` 2.2.4 | — |
| bzip2 | in `OpenMS.dll` and `_arrow_zerocopy.pyd` | `1.0.8, 13-Jul-2019` | `bzip2[core,tool]` 1.0.8#6 |
| bzip2 | in `_bz2.pyd` (the embeddable's) | `1.0.8, 13-Jul-2019`; the SPDX file on python.org says 1.0.8 | — |
| libsvm | in `OpenMS.dll` | `nr_class`, `total_sv`; no version | 3.35 |
| COIN-OR | in `OpenMS.dll` | `Cbc`; no version | `coin-or-cbc` 2024-06-04#1, `coin-or-clp` 2023-02-01#1 |
| Qt | none | 0 `Qt6`, 0 `QString` in `OpenMS.dll`; no Qt import in any of the 76 files; no Qt DLL | — |

No version here is a licence conclusion. Whether the AWS SDK or any other listed port is
linked is the same question as section 8; only `libiconv` is part of the pass condition.

Two OpenBLAS copies sit in the adapter's process, with different versions stated for them: the
numpy DLL, which loads, and what `OpenMS.dll` holds. Which one a call reaches was not measured.

`pyopenms/_arrow_zerocopy.pyd` (7,720,448 B) carries Arrow's C data interface and a static copy of
Arrow (36 source paths under `buildtrees\arrow\`), with zlib 1.3.2 and bzip2 1.0.8. It was never
loaded. Its status belongs to the licence slice.

### 9.3 Every MSVC runtime copy

For the RT-3 reading. "Loaded" is ADR 0066's probe, and the last two rows depend on import
order, because the two files have one digest and one hashed name: with `pyopenms` imported
first, and on the adapter's path, the `nanobind_backend.libs` copy loads; with `numpy` imported
first, the `numpy.libs` copy does. RT-3 should treat both as possibly loaded.

| Name | File version | Carrying package | Bytes | SHA-256 (first 16) | Loaded |
| --- | --- | --- | ---: | --- | --- |
| `vcruntime140.dll` | 14.51.36247.0 | CPython embeddable | 178,616 | `d1f4225df2cd877d` | yes |
| `vcruntime140_1.dll` | 14.51.36247.0 | CPython embeddable | 50,112 | `a7146c08f89fe5b0` | yes |
| `msvcp140-7c26614e1d733892c2deac7e245ce115.dll` | 14.51.36247.0 | `pyopenms.libs` | 643,512 | `7c26614e1d733892` | yes |
| `msvcp140_atomic_wait-78fdb07d9fe55b8436cce6b09498237e.dll` | 14.51.36247.0 | `pyopenms.libs` | 37,376 | `da88331c40d3aaa0` | yes |
| `vcomp140-95d4ce4a6802d1e18b5e0e1722cc30ea.dll` | 14.51.36247.0 | `pyopenms.libs` | 212,920 | `95d4ce4a6802d1e1` | yes |
| `msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll` | 14.40.33810.0 | `nanobind_backend.libs` | 575,056 | `a4c2229bdc2a2a63` | yes on the probe's and the adapter's order; no with `numpy` imported first |
| `msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll` | 14.40.33810.0 | `numpy.libs` | 575,056 | `a4c2229bdc2a2a63` | no on the probe's and the adapter's order; yes with `numpy` imported first |

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
  plus one no-candidate request, with one or two runs each, and on section 6.3's fixtures
  once each. A match or a difference here is evidence for those runs only.
- **The supervisor.** Its refusals in section 6.1 were read from the code. It did not run.
- **Other Python lines,** and which of the interpreter or the engine moved ANA-004's bounds.
- **A clean machine.** This host has a Visual C++ redistributable. The list in section 7
  shows the MSVC DLLs loading from the copy, on this host.
- **Negative chemistry.** The negative files are relabelled. They do not measure negative
  mode's time or memory, or B-5's adduct set.
- **Quality.** Features and matches were counted, not judged. The parameters are the
  probe's, not a recipe's, and thread counts above 1 and U1-2.3's ladder did not run. RAW
  input with the bridge missing was not tried.
- **Whether anything can reach the locations of section 7.1 on an installed machine.** The
  access rights of a drive root were not tested, a file was never placed at `D:/a`, and this
  record claims no attack. Whether `openssl.cnf` can change a result is for the confinement
  measurement too.
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
| `smoke_import.py` | the shape | the import facts of section 4 | `10cf38d8f53504168dc53e6ef285cf31f07c965f56f0930581aee1fc87a8a610` |
| `dll_paths.py` | system Python `-I` | the compiled-in paths of section 7.1 | `7ff2e26644cae6480d67283e2346a91d0b76693183c56b86ec09fe1dc80fb98d` |
| `review_fixtures.py` | system Python `-I` | review round: section 6.3's fixtures and requests | `20ed349e146164438a6a041c15f46cdf5b4359b7329f22a31724f5a84a177bb2` |
| `candidates_diff.py` | system Python `-I` | review round: two `candidates.featureXML` files | `f049598210afa0e7308ce2474f5c18d250300e3787b5a13cc8fff1f722f3b0fb` |
| `review_static.py` | system Python `-I` | review round: the byte checks added to sections 7, 8 and 9.2 | `8c67f99bf6bd77cafcfad9d4862734eee41c76e5a8a38e8bdb485d0781dd77d8` |
| `loads_after.py` | the shape | review round: what is loaded after a script, or after imports in a given order | `faefb885e6ad03d900a6edad7da014f0f0a94023777285b0fe5bd3b2cb0a808e` |
| `trace_nt.py` | the shape | review round: the file trace of sections 7 and 7.1, through kernelbase's import table, so it does not see the loader's own DLL search | `21ae6b339cdb4450ad72e505887b0ac670408c12862c4cf52a116d9d0dc257f6` |
| `epd_doublet.py` | the shape | review round: `ElutionPeakDetection` on a doublet | `8e729fecbffd4ef38996c25dc8d78d3e5901305307a8158d4eea9ffefc909007` |
| `batch_cells.py` | system Python `-I` | second review round: section 6.3's cells and evidence sums, from runs already made | `3f191031827f52613a7656bfdd7e62be84dbdf31ffcbcc681ee0db1496bec759` |
| `param_keys.py` | the shape and `<pinned>` | second review round: the planned classes' default parameters | `ef3561e35708dac1e2a72d690fb3443529de31589e1e711891c98aa70849118e` |
| `u1_floor.py` | the shape and `<pinned>` | second review round: U1 over noise floors and width filters | `0eaf981ef88ecb77af84efdb724f00ac0ffa1c99bd196312999f509289ef72bc` |
| `u1_floor_cmp.py` | system Python `-I` | second review round: compares two `u1_floor.py` outputs | `c9a26f9928d4749e0edff35f54f45a161101915ae4eb6253737e55c9a95178a9` |
| `review2_static.py` | system Python `-I` | second review round: the libxml2 names, the source paths by port and the self-stated versions | `0353346421897897ea4d4a12c7c534069e55c389a9b646456f9810dfc51db401` |
| `review2_more.py` | system Python `-I` | second review round: the `xmlparse` strings, the embeddable's zlib-ng, the defaults compared | `5e13079f684e24674b0b357d38cd00fcc11c72ba4816dc2a229807518f59234e` |
| `call_forms.py` | a scratch copy of the shape and `<pinned>` | third and fourth review rounds: section 5.3's second table and its count of `oms.` names, and the mzML reader with `brenda.obo` moved out of the copy | `29f9d0fbf59252059f5a9a7c44619997099b519ea842a7ffb2087278d24a3f6f` |
| `list_wheels.py` | system Python `-I` | what the downloads hold, without unpacking, with any name holding `sbom` marked: section 8's `sboms` check | `ba4693ca37a5f76a85dbb25bed2d7a5dbb97a7a9471cbf2a2906afe9d2cba7ce` |

The same directory holds six one-off scripts, and no result here rests on them. Five print what
the downloads or the runs already hold: `debug_features.py`, `peek.py`, `pyi_grep.py`,
`stub_show.py` and `summarize.py`. `debug_traces.py` runs the U1 chain on a file while debugging.
`adapter_v1_main.py` beside them is the adapter of section 6, with the digest given there.

`request_absent.json` is `request.json` without the target `C8H10N4O2`, written by a one-off
command. So are section 6.3's requests. Its null-mass request is the protocol's with every
`neutralMass` null, and each alone request holds only `boundary` (SHA-256: seven targets
`9911b8ced6f6ac6409da4b4f5c2d8c209563baef68e901e6caa30b18e27042a9` and
`60c176489bc0490fb6a1c3cf607139bc6d0f83bf7ed19b6066f9a81876d4886e`; alone
`33e5c4a8a72f6ddbed797befd8b699b6ce951d19d0be3857529c1a6f9e1eaf02` and
`e8932a00d1e6989a21801f14c01793445844b6d88f509cad339d502949f15d40`).

Downloads, runs and outputs are not committed either. Sections 3 to 9 give what a re-run
needs: the artefacts' digests, the exclusion list, the launch and the calls.
