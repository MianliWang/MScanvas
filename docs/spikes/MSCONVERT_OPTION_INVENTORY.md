# msconvert option inventory and option-C tiers

Status: **proposal input for
[ADR 0055](../architecture/adr/0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
2026-10-28.** Nothing here is admitted until that ADR is accepted, and no option
was run to write it.

Every output format, encoding, precision and compression option, `--filter`
and `--chromatogramFilter` entry, and other switch in the
[msconvert 3.0.26013 help capture](MSCONVERT_HELP_CAPTURE.md). There are 59
switches, the positional `filemasks`, 39 spectrum filters and 2 chromatogram
filters. "Help" gives the line numbers in
[`evidence/msconvert-3.0.26013-help.txt`](evidence/msconvert-3.0.26013-help.txt).
The syntax is the help's own, abbreviated with `…` where the help runs to
several lines.

## Legend

**MSCanvas today** (at `main` `cd27279`):

- **Verified row:** emitted by one of the nine admitted rows of
  `ConversionIntent::ADMITTED` (`crates/proteowizard/src/intent.rs`). The case
  codes (`D1`, `P4`, `L1`, …) are
  [M6.2's](M6_MSCONVERT_CAPABILITY_EVIDENCE.md).
- **Gated:** measured or implemented, but not reachable for any source a user
  can convert today.
- **Internal:** MSCanvas emits it itself; it is never a user's choice.
- **Absent:** never emitted. Nothing in the repository records it, unless the
  row says otherwise.

**Option-C tier** (decided in ADR 0055):

- **Verified default:** offered without a label, on the verified build, in the
  measured combinations only.
- **Advanced:** offered in the advanced set, labelled "not verified by
  MSCanvas", with private staging, no overwrite and the output checks kept.
  Every non-mzML format is written from a private mzML intermediate, which gets
  the mzML checks (ADR 0055 decision 6).
  - **Lossy by request** is defined by effect: the option, as the help
    describes it, removes, merges or alters spectra, peaks, chromatograms,
    array values or metadata the source holds. The user asks for that effect,
    and the step and the plan summary name it. The parenthesis says which
    effect. Numeric precision is the one exception where a check reads it
    (mzML arrays not encoded with numpress, mzXML `<peaks>`): every row states
    it and the check verifies it. On mz5 and mzMLb, precision below 64 bits is
    lossy by request.
- **Blocked:** not offered, for the reason given.
  - **Envelope** means MSCanvas sets the option itself, to keep typed argv,
    private staging, no overwrite or one queue item per acquisition.
  - Otherwise the reason is a recorded silent loss or a fail-closed rule.

Every advanced control is a typed field: a number, a choice, an integer set, a
list of such values, or a file chosen in a Rust-owned picker and copied into
private staging. None is a free-text argument box.

## 1. Output formats

| Option | Help | MSCanvas today | Option-C tier | UI control |
| --- | --- | --- | --- | --- |
| `--mzML` | 14 | Verified row (all nine) | Verified default | "Output format" select; mzML first and selected |
| `--mzXML` | 15 | Absent: `MZXML_REFUSED` (ADR 0043 CNV-D1; M6.10 case X2) | Advanced, written from the private mzML intermediate and compared with it (ADR 0055 decision 6). Lossy by request (the format keeps no chromatograms). One global precision only. **Blocked** when any spectrum of the intermediate names a source file other than the run's default, or names one where the run declares no default, and with `--merge`: X2 dropped those spectra silently at exit 0 | "mzXML (legacy, no chromatograms)" in the same select |
| `--mz5` | 16 | Absent (M6.2: not a candidate) | Advanced, written from the intermediate, offered only when the build's own help lists it (format availability is a build property, CNV-D1) | same select |
| `--mzMLb` | 17 | Absent | Advanced, written from the intermediate, same build condition | same select |
| `--mzMLbChunkSize arg (=1048576)` | 18 | Absent | Advanced, with mzMLb only | integer field, bytes, above 0 |
| `--mzMLbCompressionLevel arg (=4)` | 19 | Absent | Advanced, with mzMLb only; 0 only with zlib off, since with zlib on the build raises 0 to 4 | 0–9 stepper |
| `--mgf` | 20 | Absent | Advanced, written from the intermediate. Lossy by request (the format keeps no chromatograms, and only spectra above MS1 that name a selected precursor ion; m/z as text at 10 significant digits) | same select, labelled "MS/MS spectra only" |
| `--text` | 21 | Absent | Advanced, written from the intermediate. Lossy by request (values as text at 12 significant digits) | same select |
| `--ms1` | 22 | Absent | Advanced, written from the intermediate. Lossy by request (the format keeps MS1 spectra only; values as text at 7 significant digits) | same select |
| `--cms1` | 23 | Absent | Advanced, written from the intermediate. Lossy by request (the format keeps MS1 spectra only; intensity at 32 bits) | same select |
| `--ms2` | 24 | Absent | Advanced, written from the intermediate. Lossy by request (the format keeps only MS2 spectra that name a selected precursor ion; values as text at 7 significant digits) | same select |
| `--cms2` | 25 | Absent | Advanced, written from the intermediate. Lossy by request (the format keeps only MS2 spectra that name a selected precursor ion; intensity at 32 bits) | same select |
| `-e [ --ext ] arg` | 12–13 | Absent; the extension is derived from the format | Blocked (envelope): an extension chosen apart from the format lets a file's name disagree with its contents | none |

## 2. Precision, encoding and compression

The encoding rules, which format takes which option, and the terms each option
must leave on mzML arrays are ADR 0055 decisions 4 and 5, read from the
evidenced build's source at revision `47b13cf` and not measured. In short: mzML
takes precision, zlib, numpress and `--noindex`; mzXML one global precision,
zlib and `--noindex`; mzMLb precision, zlib, numpress, truncation, prediction
and its own two options; mz5 precision and zlib; mgf, text, ms1, cms1, ms2 and
cms2 none. An option is not offered with a format whose writer does not read
it.

| Option | Help | MSCanvas today | Option-C tier | UI control |
| --- | --- | --- | --- | --- |
| `--64` | 27–28 | Verified row: 64/64 (P4, P1, L3, C1; with `--zlib=off`, C2; with `msLevel` L1, L2; with the default picker K1, K8, gated) | Verified default in those combinations; advanced with any other filter or format | "Numeric precision": m/z 64 or 32, intensity 64 or 32 |
| `--32` | 29–30 | Verified row: 32/32 (P3, P2; with the default picker K12, gated) | As `--64` | same |
| `--mz64` | 31–32 | Not emitted. The no-flag row D1 was measured with m/z at 64 bits | Verified default as the m/z half of D1; MSCanvas chooses the spelling. Not with mzXML | same |
| `--mz32` | 33 | Verified row with `--inten64` (P5), no filter | Verified default there; advanced otherwise. Not with mzXML | same |
| `--inten64` | 34–35 | Verified row with `--mz32` (P5), no filter | As `--mz32` | same |
| `--inten32` | 36–37 | Not emitted. D1 (no flag) was measured with intensity at 32 bits | Verified default as the intensity half of D1. Not with mzXML | same |
| `--mzTruncation arg (=0)` | 38–40 | Absent (M6.2: not a candidate) | Advanced, with mzMLb only: the build's writer applies truncation nowhere else, and msconvert accepts it with any format to no effect. Lossy by request (alters m/z values; `-1` stores integers only. The help says m/z and RT, but the source at `47b13cf` sets it for m/z arrays only, `msconvert.cpp:726-727`) | integer field "m/z mantissa bits to drop" (0 off, −1 integers only) |
| `--intenTruncation arg (=0)` | 41–43 | Absent | Advanced, with mzMLb only, as `--mzTruncation`. Lossy by request (alters intensity values) | the same field for intensity |
| `--mzDelta` | 44–45 | Absent | Advanced, with mzMLb only: the build's writer reads prediction nowhere else | checkbox "Delta prediction, m/z and RT" |
| `--intenDelta` | 46–47 | Absent | Advanced, with mzMLb only, as `--mzDelta` | checkbox "Delta prediction, intensity" |
| `--mzLinear` | 48–49 | Absent | Advanced, with mzMLb only, as `--mzDelta` | checkbox "Linear prediction, m/z and RT" |
| `--intenLinear` | 50–51 | Absent | Advanced, with mzMLb only, as `--mzDelta` | checkbox "Linear prediction, intensity" |
| `--noindex` | 52 | Absent | Advanced, with mzML and mzXML; the index check is reported as not applicable, never as passed. Not with mzMLb, whose writer writes its index whatever the switch says | checkbox "Write no index" |
| `-z [ --zlib ] [=arg(=1)]` | 54–55 | Verified row: on in eight rows; `=off` at 64/64 with no filter (C2) | Verified default (on). Off: verified default in C2's combination, advanced otherwise | checkbox "zlib compression" |
| `--numpressLinear [=arg(=2.0e-09)]` | 56–59 | Absent | Advanced, with mzML and mzMLb; fixes m/z and RT at 64 bits, so an array the writer stores without numpress keeps every bit. On mzML each array carries the nominal 32-bit term and the numpress term, or falls back to the plain terms (ADR 0055 decision 5). Lossy by request (alters m/z and RT values within the relative tolerance) | checkbox and tolerance field |
| `--numpressLinearAbsTol [=arg(=-1)]` | 60–66 | Absent | Advanced, with numpress linear only. Lossy by request (alters m/z and RT values within the absolute tolerance) | absolute tolerance field (m/z) |
| `--numpressPic` | 67–70 | Absent | Advanced, with mzML and mzMLb, not with `--numpressSlof`; fixes intensity at 64 bits, as `--numpressLinear`. Lossy by request (alters intensities, absolute loss up to 0.5) | checkbox |
| `--numpressSlof [=arg(=2.0e-04)]` | 71–74 | Absent | Advanced, with mzML and mzMLb, not with `--numpressPic`; fixes intensity at 64 bits, as `--numpressLinear`. Lossy by request (alters intensities within the relative tolerance) | checkbox and tolerance field |
| `-n [ --numpressAll ]` | 75–77 | Absent | Covered by the two options it abbreviates; not offered separately | none |
| `-g [ --gzip ]` | 78–79 | Absent | Advanced after a dependency decision. The mzML checks must read through gzip, and the conversion crate has no gzip reader (`flate2` is in the lockfile only transitively) | checkbox "gzip the whole file (.gz)" |

## 3. Run, input and writer switches

| Option | Help | MSCanvas today | Option-C tier | UI control |
| --- | --- | --- | --- | --- |
| `[filemasks]` | 1 | Internal: one exact source path per queue item | Blocked (envelope): MSCanvas passes the acquisition the user chose, never a wildcard | the queue |
| `-f [ --filelist ] arg` | 7 | Absent | Blocked (envelope): a list file is an untyped second channel for sources | Add files, Add folder |
| `-o [ --outdir ] arg (=.)` | 8–9 | Internal: always the private staging directory | Blocked (envelope): output is staged privately and finalized without overwrite; `-` (stdout) would bypass both | the existing "Destination" control |
| `-c [ --config ] arg` | 10 | Absent | Blocked: a configuration file is an untyped argument channel; every option it could set is offered as its own typed control | none |
| `--outfile arg` | 11 | Internal for single-output families; omitted for SCIEX output sets | Blocked (envelope): MSCanvas derives the name it finalizes | none; the summary shows the name |
| `-v [ --verbose ]` | 26 | Absent | Blocked (envelope): changes no output; the provider's stderr is already kept for diagnostics, and ADR 0024 found it adds nothing to SCIEX completeness | none |
| `-i [ --contactInfo ] arg` | 53 | Absent | Advanced, the file chosen in a Rust-owned picker and copied into private staging | "Contact information file…" |
| `--filter arg` | 80 | Internal: `peakPicking`, `msLevel 1` and `msLevel 2` only | Advanced: the ordered spectrum filter chain (section 4) | "Processing steps" list |
| `--chromatogramFilter arg` | 81 | Absent | Advanced: an ordered chromatogram filter chain (section 5) | "Chromatogram steps" list |
| `--merge` | 82–84 | Absent | Advanced, in its own slice: a queue item with several sources and one output. Never with mzXML: a merged document is multi-source by construction (X2) | "Merge into one file" on a multi-selection |
| `--runIndexSet arg` | 85–86 | Absent; if present, SCIEX completeness refuses the output set (`OutputFilteringRequested`) | Advanced, in its own slice: completeness then checks the produced set against the requested runs. Lossy by request (removes runs) | run picker for multi-run sources |
| `--simAsSpectra` | 87–88 | Absent | Advanced. Lossy by request (alters chromatograms: SIM is written as spectra) | checkbox "SIM as spectra" |
| `--srmAsSpectra` | 89–90 | Absent | Advanced. Lossy by request (alters chromatograms: SRM is written as spectra) | checkbox "SRM as spectra" |
| `--combineIonMobilitySpectra` | 91–93 | Absent; no ion-mobility family is admitted | Advanced; acts on no admitted family. Lossy by request (merges spectra) | checkbox |
| `--ddaProcessing` | 94–97 | Absent | Advanced ("if supported by vendor", help). Lossy by request (merges MS2 spectra, alters precursor m/z) | checkbox |
| `--ignoreCalibrationScans` | 98–100 | Absent; the help limits it to the Waters lockmass function, and no Waters family is admitted | Advanced; acts on no admitted family. Lossy by request (removes calibration scans) | checkbox |
| `--acceptZeroLengthSpectra` | 101–103 | Absent | Advanced | checkbox |
| `--ignoreMissingZeroSamples` | 104–107 | Absent | Advanced | checkbox |
| `--ignoreUnknownInstrumentError` | 108–110 | Absent | Advanced | checkbox |
| `--stripLocationFromSourceFiles` | 111–114 | Absent. The output records the source's directory ([M3 next-vendor evidence](M3_NEXT_VENDOR_EVIDENCE.md)) | Advanced. Lossy by request (removes source-file locations) | checkbox "Leave the source folder out of the file" |
| `--stripVersionFromSoftware` | 115–118 | Absent | Advanced. Lossy by request (removes software versions) | checkbox |
| `--singleThreaded [=arg(=1)] (=2)` | 119–120 | Absent | Advanced | checkbox |
| `--continueOnError` | 121–126 | Absent | **Blocked:** it skips a spectrum or chromatogram that fails to enumerate and carries on, and the help warns the rest "might be obviously or subtly incorrect". That is silent loss at exit 0, which fail-closed (ADR 0043) exists to refuse | none |
| `--help` | 127–128 | Internal: the capability probe reads it | Blocked (envelope): not a conversion | none |
| `--help-filter arg` | 129–130 | Absent | Blocked (envelope): not a conversion | none |
| `--show-examples` | 131–132 | Absent | Blocked (envelope): not a conversion | none |
| `--doc` | 133–134 | Absent | Blocked (envelope): not a conversion | none |

## 4. Spectrum filters (`--filter`)

The help says filters apply in the order given, and order "can make a large
difference" (lines 139–143). So the chain is an ordered list the user arranges,
not a set of switches. Integer-set fields take the help's `int_set` grammar
(lines 145–151), entered as ranges rather than typed as text.

| Filter and syntax | Help | MSCanvas today | Option-C tier | UI control |
| --- | --- | --- | --- | --- |
| `index <index_value_set>` | 153–156 | Absent | Advanced. Lossy by request (removes spectra) | integer set "spectrum index (0-based)" |
| `id <id_set>` | 158–160 | Absent | Advanced. Lossy by request (removes spectra) | list of native IDs, one per row; `;` refused inside an ID |
| `msLevel <mslevels>` | 162–164 | Verified row: `1` (L1) and `2` (L2), at 64/64 with zlib and no picker | Verified default in those rows; advanced for any other set (`2-`, `3`, …) or chain. Lossy by request (removes spectra) | "MS levels" checkboxes, or an integer set |
| `chargeState <charge_states>` | 166–169 | Absent | Advanced. Lossy by request (removes spectra) | integer set; 0 means "no charge state" |
| `precursorRecalculation` | 171–177 | Absent | Advanced. Lossy by request (alters precursor m/z and charge) | step without parameters |
| `mzRefiner input1.pepXML input2.mzid [msLevels=<1->] [thresholdScore=…] [thresholdValue=…] [thresholdStep=…] [maxSteps=…]` | 179–190 | Absent | Advanced, the identification files chosen in a Rust-owned picker and copied into private staging. Lossy by request (alters m/z values) | file picker and five fields |
| `lockmassRefiner mz=<real> mzNegIons=<real (mz)> tol=<real (1.0 Daltons)>` | 192–195 | Absent; the help says it acts on Waters data only | Advanced; acts on no admitted family. Lossy by request (alters m/z values) | three number fields |
| `precursorRefine` | 197–200 | Absent | Advanced. Lossy by request (alters precursor m/z and charge) | step without parameters |
| `peakPicking`, bare (the default local-maximum picker) | 202–216 | Gated: verified rows K1, K8 and K12 cover mzML sources, which the visible workflow does not convert | Verified default on mzML sources. Advanced on Shimadzu LCD and SCIEX WIFF, where the check on the mzML output, or on the private mzML intermediate of any other format, refuses any other recorded algorithm. **Blocked** on Thermo RAW: there the same argv runs the vendor picker and the check refuses the result ([M6.10 S1](M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#s1--the-vendor-picker-reached-at-last-and-what-it-changed)). `snr`, `peakSpace` and `msLevel=` cannot be expressed: without a picker token the scope was measured to be ignored (M6.2). Lossy by request (replaces profile peaks with centroids) | "Centroid: local maxima (low quality)" |
| `peakPicking vendor [msLevel=<ms_levels>]` | 202–216 | Absent; `EVIDENCE_BLOCKED` (never run on a profile vendor acquisition) | Advanced on vendor sources, as the first step only, with the same algorithm check on the mzML output or intermediate. **Blocked** on mzML sources, where the request was measured to run the local-maximum picker instead (M6.2), and anywhere but first (help lines 207–208). Lossy by request (replaces profile peaks with centroids) | "Centroid: vendor algorithm", MS levels |
| `peakPicking cwt [snr=…] [peakSpace=…] [msLevel=…]` | 202–216 | Absent; `MEASURED_REJECTED` | **Blocked:** on a spectrum it accepted it silently returned one of three peaks, and on unflanked input it aborted leaving an unterminated document (M6.2) | none |
| `scanNumber <scan_numbers>` | 219–223 | Absent | Advanced. Lossy by request (removes spectra) | integer set "scan numbers" |
| `scanEvent <scan_event_set>` | 225–234 | Absent | Advanced. Lossy by request (removes spectra) | integer set "scan events" |
| `scanTime <scan_time_range>` | 236–240 | Absent | Advanced. Lossy by request (removes spectra) | start and end time, seconds or minutes (emitted in seconds) |
| `sortByScanTime` | 242–243 | Absent | Advanced; it reorders spectra and removes nothing | step without parameters |
| `stripIT` | 245–246 | Absent | Advanced. Lossy by request (removes ion-trap MS1 spectra) | step without parameters |
| `metadataFixer` | 248–256 | Absent | Advanced. Lossy by request (replaces TIC and base-peak metadata) | step without parameters, suggested after a centroiding step |
| `titleMaker <format_string>` | 258–292 | Absent | Advanced; the template is built from the keywords the help lists and literal text, and checked before it is emitted. Lossy by request (replaces spectrum titles) | template builder: keyword chips and text |
| `threshold <type> <threshold> <orientation> [<mslevels>]` | 294–317 | Absent | Advanced. Lossy by request (removes peaks) | type (count, count-after-ties, absolute, bpi-relative, tic-relative, tic-cutoff), value, most or least intense, MS levels |
| `mzWindow <mzrange>` | 319–322 | Absent | Advanced. Lossy by request (removes peaks) | low and high m/z |
| `mzPrecursors <precursor_mz_list> [mzTol=…] [target=…] [mode=…]` | 324–337 | Absent | Advanced; the help says it drops MS1 unless 0.0 is listed, and the step says so. Lossy by request (removes spectra) | m/z list, tolerance (number and PPM or MZ), selected or isolated, include or exclude |
| `isolationWindows <isolation_window_list> [mzTol=…] [mode=…]` | 339–350 | Absent | Advanced; drops MS1 unless `[0,0]` is listed (help). Lossy by request (removes spectra) | list of windows, tolerance, include or exclude |
| `isolationWidth <isolation_width_list> [mzTol=…] [mode=…]` | 352–362 | Absent | Advanced; drops MS1 unless 0.0 is listed (help). Lossy by request (removes spectra) | list of widths, tolerance, include or exclude |
| `defaultArrayLength <peak_count_range>` | 364–368 | Absent | Advanced. Lossy by request (removes spectra) | integer set "peak count" |
| `zeroSamples <mode> [<MS_levels>]` | 370–392 | Absent | Advanced. Lossy by request (removes or adds zero samples) | remove extra or add missing (with optional flank count), MS levels |
| `mzPresent <mz_list> [mzTol=…] [type=…] [threshold=…] [orientation=…] [mode=…]` | 394–408 | Absent | Advanced. Lossy by request (removes spectra) | m/z list, tolerance, the threshold fields, include or exclude |
| `scanSumming [precursorTol=…] [scanTimeTol=…] [ionMobilityTol=…]` | 410–416 | Absent; the help aims it at Waters DDA and Bruker PASEF, and neither family is admitted | Advanced. Lossy by request (merges MS2 sub-scans) | three tolerance fields |
| `thermoScanFilter <exact\|contains> <include\|exclude> <match string>` | 418–432 | Absent; Thermo only (help) | Advanced. Lossy by request (removes spectra) | exact or contains, include or exclude, a one-line scan-filter field (control characters refused) |
| `mzShift <m/z shift as number and units> [msLevels=int_set (1-)]` | 435–443 | Absent | Advanced. Lossy by request (alters m/z values) | shift and unit (ppm or Da), MS levels |
| `MS2Denoise [<peaks_in_window> [<window_width_Da> [multicharge_fragment_relaxation]]]` | 445–466 | Absent | Advanced. Lossy by request (removes peaks) | peaks in window, width in Da, relaxation checkbox |
| `MS2Deisotope [hi_res [mzTol=<mzTol>]] [Poisson [minCharge=…] [maxCharge=…]]` | 469–479 | Absent | Advanced. Lossy by request (removes peaks) | method (Markey or Poisson), each with only its own fields |
| `ETDFilter [<removePrecursor> [<removeChargeReduced> [<removeNeutralLoss> [<blanketRemoval> [<matchingTolerance>]]]]]` | 481–493 | Absent | Advanced. Lossy by request (removes peaks) | four checkboxes and a tolerance (number and mz or ppm) |
| `demultiplex massError=… nnlsMaxIter=… nnlsEps=… noWeighting=… demuxBlockExtra=… variableFill=… noSumNormalize=… optimization=… interpolateRT=… minWindowSize=… removeNonOverlappingEdges=…` | 495–502 | Absent | Advanced. Lossy by request (replaces multiplexed spectra with inferred ones) | the eleven named parameters, at the help's defaults |
| `chargeStatePredictor [overrideExistingCharge=…] [maxMultipleCharge=…] [minMultipleCharge=…] [singleChargeFractionTIC=…] [maxKnownCharge=…] [makeMS2=…]` | 504–524 | Absent | Advanced. Lossy by request (alters precursor charge) | the six named parameters |
| `turbocharger [minCharge=…] [maxCharge=…] [precursorsBefore=…] [precursorsAfter=…] [halfIsoWidth=…] [defaultMinCharge=…] [defaultMaxCharge=…] [useVendorPeaks=…]` | 526–542 | Absent | Advanced. Lossy by request (alters precursor charge) | the eight named parameters |
| `activation <precursor_activation_type> [mode=…]` | 544–554 | Absent | Advanced. Lossy by request (removes spectra) | type (ETD, CID, SA, HCD, HECID, BIRD, ECD, IRMPD, PD, PSD, PQD, SID, SORI), include or exclude |
| `collisionEnergy low=<real> high=<real> [mode=…] [acceptNonCID=…] [acceptMissingCE=…]` | 556–561 | Absent | Advanced. Lossy by request (removes spectra) | low and high, include or exclude, two checkboxes |
| `analyzer <analyzer>` | 563–567 | Absent | Advanced. Lossy by request (removes spectra) | quad, orbi, FT, IT or TOF |
| `analyzerType <analyzer>` | 570–572 | Absent | Covered by `analyzer`; the help calls this spelling deprecated, so it is not offered separately | none |
| `polarity <polarity>` | 574–576 | Absent | Advanced. Lossy by request (removes spectra) | positive or negative |
| `diaUmpire params=<filepath to DiaUmpire .params file>` | 578–579 | Absent | Advanced, the parameter file chosen in a Rust-owned picker and copied into private staging. Lossy by request (replaces DIA spectra with pseudo-DDA spectra) | file picker |

## 5. Chromatogram filters (`--chromatogramFilter`)

| Filter and syntax | Help | MSCanvas today | Option-C tier | UI control |
| --- | --- | --- | --- | --- |
| `index <index_value_set>` | 597–600 | Absent | Advanced. Lossy by request (removes chromatograms) | integer set "chromatogram index (0-based)" |
| `lockmassRefiner mz=<real> mzNegIons=<real (mz)> tol=<real (1.0 Daltons)>` | 602–605 | Absent; Waters only (help) | Advanced; acts on no admitted family. Lossy by request (alters m/z values) | three number fields |

## 6. Blocked, in one place

| What | Why | Record |
| --- | --- | --- |
| mzXML when any spectrum of the private mzML intermediate names a source file other than the run's default, or names one where the run declares no default, and mzXML with `--merge` | The writer dropped every spectrum of the non-default source at exit 0 with empty stderr, under a header declaring them all | M6.10 case X2 |
| `peakPicking cwt` | Silently returned one of three peaks; aborted with an unterminated document on unflanked input | M6.2 |
| `peakPicking vendor` on an mzML source | Silently ran the local-maximum picker instead | M6.2 |
| `peakPicking vendor` anywhere but first | The help requires it first; a preceding filter defeats the vendor path and the provider falls back silently | help lines 207–208; ADR 0043 CNV-D2 |
| Bare `peakPicking` on Thermo RAW | The same argv runs the vendor picker there; the output check refuses it | M6.10 S1 |
| `snr`, `peakSpace` or `msLevel=` on a picker that ignores them | Discarded silently, so the control could not affect the result | M6.2; ADR 0043 CNV-D2 |
| An encoding option with a format whose writer does not read it, truncation and prediction outside mzMLb among them | msconvert accepts it and the writer ignores it, so the control could not affect the result | ADR 0055 decision 4, from the source at `47b13cf`; ADR 0043 CNV-D2 |
| `--continueOnError` | Skips data that fails to enumerate and continues at exit 0 | help lines 121–126; ADR 0043 fail-closed |
| `-c/--config` | An untyped argument channel | ADR 0055 |
| Envelope: filemasks, `-f`, `-o` (and `-` for stdout), `--outfile`, `-e`, `-v`, `--help`, `--help-filter`, `--show-examples`, `--doc` | MSCanvas sets these itself for typed argv, private staging, no overwrite and one item per acquisition; the help switches run no conversion | ADR 0055 |
