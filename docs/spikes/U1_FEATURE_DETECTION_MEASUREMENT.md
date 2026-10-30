# U1 — single-file feature detection: time and memory

**Outcome: MEASURED.** On two public centroided LC-MS runs, pyOpenMS 3.5.0's
`MassTraceDetection` → `ElutionPeakDetection` → `FeatureFindingMetabo` stayed
far inside today's analysis worker limits of 600 s and a 4 GiB Job commit cap.
At noise thresholds 1e4 and 1e5, the slowest single run took 94.8 s. The
highest peak commit was 0.95 GiB and the highest peak working set 0.88 GiB.
Three findings set the budgets:

- **Memory follows the MS1 peak count, not the file size.** Loading costs about
  18 bytes per MS1 centroid peak. The feature stages add roughly 70–200 bytes per
  peak at or above the noise threshold, which is a small term at 1e4 and 1e5.
- **Time is mostly the engine import and the mzML load.** The three feature
  stages took 5.4 s or less at 1e4 and 1e5. At 1e3 they took up to 69 s
  single-threaded on the Orbitrap file.
- **The import is the outlier.** It usually takes 2–9 s. Once, in the first
  smoke run, it took 167 s, and the worker's budget runs from launch.

The 1–2 GiB Orbitrap file the research gate asked for was not used. The two runs
are 0.53 and 0.89 GiB, and the extrapolation to larger files goes through the
MS1 peak count (section 6). Thresholds below 1e3 were not measured, and neither
was the engine's default of 10.

This record measures; it admits nothing and changes no code. The budgets in
section 7 are recommendations for the U1 recipe's own record.

## 1. What was asked

The analysis plan's research (OpenMS track, section 5, and its synthesis, item
B1) estimated a 1.5–9 GiB peak working set for one 1–2 GiB file. That estimate
collides with the worker limits in `apps/desktop/src-tauri/src/targeted_ms1.rs`:

- `BUDGET = 600 s`, wall clock from launch;
- `JOB_MEMORY_BYTES = 4 GiB`, set as `JOB_OBJECT_LIMIT_JOB_MEMORY`
  (`crates/proteowizard/src/process.rs`), a cap on the Job's **committed**
  memory, not on its working set;
- `OMP_NUM_THREADS=1`.

The gate: measure MTD → EPD → FFM on realistic public data, MS1-only load,
`noise_threshold_int` 1e4 and 1e5, `OMP_NUM_THREADS` 1 and 4. Record wall time and
peak working set per stage, and trace and feature counts. Run it under the memory
gate, then set the untargeted recipe's limits from the result.

## 2. Scope and authorization

- **No ProteoWizard program ran.** Both files were deposited already centroided.
- Public data only. Downloads, census files, feature maps and logs stay outside
  the repository. Nothing measured here is committed except this record.
- The measurement scripts were written in a scratch directory, separate from
  the data, and run with `python -I`.
- Memory gate: each run was admitted only at 8 GiB or more free and 80 % or less
  used. A sampler would have killed the child at once under 4 GiB free or over
  90 % used. No run came near either limit (section 5.5).

This record names no absolute path:

| Placeholder | Meaning |
| --- | --- |
| `<data>` | the directory holding the two downloaded files, read-only |
| `<runs>` | per-run output directories, each created new and empty |
| `<tools>` | the scratch directory holding the measurement scripts |
| `<runtime>` | the provisioned development runtime, `.tmp/m91-runtime/` in a checkout |

## 3. Data

| | A | B |
| --- | --- | --- |
| Accession | MetaboLights `MTBLS1785`, "Optimizing peak picking and development of a suspect screening tool for rapid annotation of the human chemical exposome from LC- HRMS datasets" | MetaboLights `MTBLS1861`, "Public LC-Orbitrap-MS/MS Spectral Library for Metabolite Identification" (DOI `10.1021/acs.jproteome.0c00930`) |
| File | `20180413_Plasma_POS_PPT1.mzML` | `IROA_retest_pos_Mix23.mzML` |
| URL | `https://ftp.ebi.ac.uk/pub/databases/metabolights/studies/public/MTBLS1785/FILES/20180413_Plasma_POS_PPT1.mzML` | `https://ftp.ebi.ac.uk/pub/databases/metabolights/studies/public/MTBLS1861/FILES/IROA_retest_pos_Mix23.mzML` |
| Licence | "EMBL-EBI Terms of Use", the study's `i_Investigation.txt` `Comment[License]` | the same |
| Bytes | `954,902,334` (0.89 GiB), equal to the server's `Content-Length` | `564,427,222` (0.53 GiB), the same check |
| SHA-256 | `167a500fb000c7e7d0bdd63b8f141ac265c30ce6d4cae5b450cb6ba13a58a1df` | `fffb373e94d3e3cc6ecf772f61771a780caabf9b3393a868bf603274feff84c7` |
| Integrity anchor | the mzML's own `fileChecksum` SHA-1 `52fcfa4baa9844c2d8a25c499796a64129d6fb8a`, recomputed and equal | `3dbe1fb5afe9e848c0224d2dc905f4c8518b411d`, recomputed and equal |
| Sample | human plasma, protein precipitation, ESI positive, 60 min | IROA standards mix 23, ESI positive, 24 min |
| Instrument | SCIEX X500R QTOF; centroided with the vendor's peak picking ("ABI/Analyst peak picking") during conversion by ProteoWizard 3.0.19288 | Thermo Q Exactive; centroided ("peak picking") during conversion by ProteoWizard 3.0.8688, algorithm not named |
| Encoding | m/z and intensity 64-bit, zlib | m/z and intensity 64-bit, uncompressed |
| Spectra | 10,960, all MS1 centroid | 6,862: 3,783 MS1 centroid, 3,079 MS2 |
| MS1 centroid peaks | 48,409,959 (median 4,765 per spectrum) | 24,752,806 (median 6,603 per spectrum) |
| MS1 peaks at or above 1e3 / 1e4 / 1e5 | 926,613 / 74,682 / 6,326 | 3,427,857 / 1,001,872 / 126,499 |
| Highest MS1 intensity | 2.73e6 | 2.42e7 |

The peak counts come from a census that sums the MS1 spectra's arrays after
loading. pyOpenMS's `MSExperiment.getSize()` reports more, 48,431,879 and
24,759,668, because it also counts chromatogram points. The differences equal the
files' chromatograms exactly: A's TIC and BPC of 10,960 points each, and B's TIC
of 6,862 points.

Licence note: "EMBL-EBI Terms of Use" is not an open-data licence such as CC0.
The files are used here only to measure, on a local copy, and are neither
committed nor redistributed.

Why these two:

- **A is a realistic, dense biological run:** 60 minutes of plasma, MS1 only,
  close to 1 GiB.
- **B adds a second vendor and the Orbitrap intensity scale.** On Orbitrap
  data, 1e4 and 1e5 are the usual thresholds. On A's QTOF scale they leave few
  features, so A's 1e3 run (section 5.3) is the more realistic setting for A.

## 4. Environment and method

### 4.1 Host and runtime

| Fact | Value |
| --- | --- |
| CPU | 12th Gen Intel Core i7-12700H, 14 cores, 20 logical processors |
| RAM | 63.7 GiB |
| Disk holding data and outputs | NVMe SSD (WD_BLACK SN7100 2TB) |
| OS | Windows 11, build 26300 |
| Load | Shared developer machine. Other agent lanes were active, so wall times carry their noise and CPU times are the steadier figure |
| Engine runtime | The existing development provision, not provisioned again: `cpython-3.13.15-embed-amd64+pyopenms-3.5.0` |
| Runtime manifest SHA-256 | `6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295`, equal to `RUNTIME_MANIFEST_SHA256` in `apps/desktop/src-tauri/src/project/recipe.rs` |
| Runtime check | A read-only check after the runs found all 4,628 manifest files present and equal, and no extra file: `RESULT MATCH`. The runs wrote nothing into the runtime |
| pyOpenMS | `3.5.0`, as the runtime reports it |

### 4.2 The child: one file, one setting

`ff_stage.py` mirrors TOPP `FeatureFinderMetabo` at 3.5.0, in this order:

1. MS1-only `MzMLFile` load; a profile first spectrum is refused.
2. `sortSpectra(True)`.
3. `MassTraceDetection.run`.
4. `ElutionPeakDetection.detectPeaks`, then `filterByPeakWidth` when
   `width_filtering` is `auto` (it is `fixed` by default, so it was not called).
5. `FeatureFindingMetabo.run`.
6. `ensureUniqueId` and a featureXML store.

At each stage boundary it prints one JSON line with the time and its own
`GetProcessMemoryInfo` counters. The OS keeps the peak counters exactly, so growth
between samples is never missed.

Parameters are the engine defaults except as listed. All of them were read back
from the engine after they were set:

| Algorithm | Set | Defaults kept (read back) |
| --- | --- | --- |
| MTD | `noise_threshold_int` = the setting; `chrom_peak_snr` 3 | `mass_error_ppm` 20, `reestimate_mt_sd` true, `quant_method` area, `trace_termination_criterion` outlier, `trace_termination_outliers` 5, `min_sample_rate` 0.5, `min_trace_length` 5, `max_trace_length` -1 |
| EPD | `chrom_fwhm` 5; `chrom_peak_snr` 3 | `width_filtering` fixed, `min_fwhm` 1, `max_fwhm` 60, `masstrace_snr_filtering` false |
| FFM | `chrom_fwhm` 5; `report_chromatograms` false | `local_rt_range` 10, `local_mz_range` 6.5, `charge_lower_bound` 1, `charge_upper_bound` 3, `enable_RT_filtering` true, `isotope_filtering_model` metabolites (5% RMS), `mz_scoring_13C` false, `use_smoothed_intensities` true, `remove_single_traces` false, `elements` CHNOPS |

### 4.3 The runner: one separate process per setting

`run_u1.py` launches each setting as its own process:

- **Command.** It runs the runtime's interpreter with the argv
  `["<runtime>\cpython-3.13.15-embed\python.exe", "-I", "-B", "-X", "utf8", "<tools>\ff_stage.py", "<data>\<file>.mzML", "<runs>\<name>\<name>.featureXML", "<noise>"]`.
- **Environment.** The child gets the worker's allow-list as
  `targeted_ms1.rs` builds it:
  - `SystemRoot` and `WINDIR`;
  - `TEMP`, `TMP` and `OPENMS_HOME_PATH`, inside the run directory;
  - `PATH` holding only the interpreter's directory, `System32` and the Windows
    directory;
  - `OMP_NUM_THREADS`, set to 1 or 4.
- **Priority and limits.** The child runs at below-normal priority, as the
  worker's Job sets it. There is **no** Job memory cap, so the peak is measured
  rather than cut off.
- **Identity.** The runner holds the process handle it got from `CreateProcess`.
  It checks that the handle's creation time is at or after the launch, so a
  reused PID is never sampled. Every run passed, with the creation time 1.2–3.3
  ms after the launch.
- **Sampling.** Every 100 ms it reads the child's working set and commit through
  that handle, and the system's free memory.
- **Gate.** Before each launch it admits at 8 GiB or more free and 80 % or less
  used. It kills the child at once under 4 GiB free or over 90 % used.
- **Totals.** Wall time runs from launch to exit. CPU time comes from
  `GetProcessTimes`. The process peaks come from the OS counters after exit.

Exact commands, run from `<tools>`. The runner interpreter for the
third-to-fifth repetitions was MSYS2 MinGW CPython 3.14.3. It was not recorded
for the earlier batches; the runner uses only the standard library and does not
touch the child's measurements.

```text
<runtime>\cpython-3.13.15-embed\python.exe -I -B -X utf8 census.py <data>\<file>.mzML <out>.json
python -I -B run_u1.py <runtime>\cpython-3.13.15-embed\python.exe <tools>\ff_stage.py <data>\<file>.mzML <runs>\rep<k> <label><k> 1:100000 4:100000 1:10000 4:10000
python -I -B run_u1.py <runtime>\cpython-3.13.15-embed\python.exe <tools>\adapter_overhead.py <data>\<file>.mzML <runs_overhead>\rep<k> O<label><k> 1:100000
```

A setting is written `<OMP>:<noise>`. Repetitions 3–5 interleaved the two files
and rotated the order of the settings, so slow periods on the host spread across
settings.

Script SHA-256 (the scripts stay outside the repository):

| Script | SHA-256 |
| --- | --- |
| `ff_stage.py` | `57d22e00f70842a3ad05dcf89da994556acb6c065939a31a8c1af4ec0a886069` |
| `run_u1.py` | `660b238d228ff73a30d4060ff2b30144c3557962ace5e57980789c17f48f2059` |
| `adapter_overhead.py` | `f70d3a7ed8751e0250e2eab1cfe9fb27b6d84f7714719846333be955609237a9` |
| `census.py` | `4fe52a94fa3cb34fdac028073ec382f5334a2009aa1c9ec191908fda73444109` |

`ff_stage.py` and `run_u1.py` were last modified before the first timed run and
were not changed afterwards. `adapter_overhead.py` was written before its own
runs.

## 5. Results

Runs took place on 2026-10-30 (UTC-4): two smoke runs at 11:37 and 11:57, the
first batches from 12:03 to 12:20, and the interleaved repetitions and adapter
runs from 19:06 to 19:15. Every timed run exited 0 and was neither stopped nor capped. Feature and
trace counts were identical across repetitions of a setting, and no feature had
zero intensity.

### 5.1 The required settings: noise 1e4 and 1e5, OMP 1 and 4

Medians, with the range over n runs in brackets. n counts 1–2 runs from the
first batches plus three interleaved repetitions. CPU is user plus kernel time
of the child.

| File | Noise | OMP | n | Wall s | CPU s | Import s | Load s | MTD s | EPD s | FFM s | Store s | Peak WS GiB | Peak commit GiB | Traces → after EPD | Features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1e5 | 1 | 5 | 21.0 (16.5–28.0) | 16.9 (14.5–17.4) | 4.1 (2.7–6.3) | 14.9 (12.8–19.2) | 0.4 (0.3–0.9) | 0.0 | 0.0 | 0.0 | 0.88 | 0.85 | 70 → 78 | 55 |
| A | 1e5 | 4 | 5 | 14.9 (12.1–33.2) | 27.8 (24.5–28.8) | 3.2 (2.8–5.0) | 10.3 (7.7–21.1) | 0.4 (0.4–0.6) | 0.0 | 0.0 | 0.0 | 0.88 | 0.95 | 70 → 78 | 55 |
| A | 1e4 | 1 | 4 | 27.7 (16.9–32.5) | 16.9 (15.4–17.7) | 5.3 (3.0–10.7) | 17.8 (12.6–24.7) | 0.6 (0.4–0.6) | 0.1 (0.1–0.3) | 0.1 (0.0–0.1) | 0.0 | 0.88 | 0.86 | 575 → 635 | 475 |
| A | 1e4 | 4 | 4 | 22.6 (19.9–46.2) | 27.2 (25.2–28.0) | 5.2 (3.6–8.7) | 15.6 (14.8–30.1) | 0.5 (0.4–2.0) | 0.1 (0.0–1.6) | 0.1 (0.0–0.8) | 0.0 | 0.88 | 0.95 | 575 → 635 | 475 |
| B | 1e5 | 1 | 4 | 11.7 (6.2–65.9) | 8.3 (5.8–10.1) | 4.2 (2.0–16.7) | 6.8 (3.4–42.0) | 0.3 (0.2–0.4) | 0.1 | 0.0 (0.0–0.1) | 0.0 (0.0–0.3) | 0.51 | 0.49 | 152 → 229 | 219 |
| B | 1e5 | 4 | 4 | 13.2 (10.4–53.0) | 12.8 (11.9–13.6) | 4.4 (3.3–28.2) | 7.7 (6.3–21.4) | 0.3 (0.2–1.6) | 0.1 (0.0–0.2) | 0.0 (0.0–0.3) | 0.0 | 0.51 | 0.58 | 152 → 229 | 219 |
| B | 1e4 | 1 | 4 | 17.9 (9.7–94.8) | 9.9 (8.9–11.6) | 6.2 (3.1–71.9) | 8.6 (4.4–12.5) | 1.0 (0.8–1.6) | 0.6 (0.5–1.1) | 0.5 (0.3–2.7) | 0.1 (0.1–0.7) | 0.60 | 0.58 | 1,074 → 2,207 | 2,063 |
| B | 1e4 | 4 | 4 | 13.7 (9.0–33.9) | 14.6 (13.1–16.9) | 3.9 (3.1–6.2) | 6.2 (4.0–21.2) | 1.8 (0.8–3.3) | 0.5 (0.2–1.3) | 0.3 (0.2–0.8) | 0.1 | 0.59 (0.59–0.60) | 0.66 | 1,074 → 2,207 | 2,063 |

A cell without a range had the same value, at this rounding, in every run.

- **Worst run at the required settings:** 94.8 s wall, B at 1e4 with OMP 1, in
  the first batch. Its CPU time was 11.6 s and its import took 71.9 s. The time
  was spent waiting on a busy host, not computing.
- **The three feature stages together** took at most 5.4 s in any run at 1e4 or
  1e5.
- **Highest peaks:** 0.88 GiB working set and 0.95 GiB commit, both on A.

### 5.2 Peak memory inside each stage

Each cell is working set / commit in GiB, as a median over the runs of section
5.1 and 5.3. Where the OS peak counter rose during a stage, the cell is that
exact peak. Otherwise it is the highest of the 100 ms samples and the two
boundary readings.

| File | Noise | OMP | Import | Load | Sort | MTD | EPD | FFM | Store |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1e5 | 1 | 0.09 / 0.06 | 0.87 / 0.84 | 0.87 / 0.84 | 0.88 / 0.85 | 0.87 / 0.84 | 0.87 / 0.84 | 0.87 / 0.84 |
| A | 1e5 | 4 | 0.09 / 0.16 | 0.87 / 0.94 | 0.87 / 0.93 | 0.88 / 0.95 | 0.87 / 0.94 | 0.87 / 0.94 | 0.87 / 0.94 |
| A | 1e4 | 1 | 0.09 / 0.06 | 0.87 / 0.84 | 0.87 / 0.84 | 0.88 / 0.86 | 0.87 / 0.84 | 0.87 / 0.84 | 0.87 / 0.84 |
| A | 1e4 | 4 | 0.09 / 0.16 | 0.87 / 0.94 | 0.87 / 0.93 | 0.88 / 0.95 | 0.88 / 0.94 | 0.88 / 0.94 | 0.88 / 0.94 |
| A | 1e3 | 1 | 0.09 / 0.06 | 0.87 / 0.84 | 0.87 / 0.84 | 0.91 / 0.88 | 0.91 / 0.88 | 0.93 / 0.91 | 0.93 / 0.91 |
| A | 1e3 | 4 | 0.09 / 0.16 | 0.87 / 0.94 | 0.87 / 0.93 | 0.91 / 0.98 | 0.91 / 0.98 | 0.94 / 1.00 | 0.94 / 1.00 |
| B | 1e5 | 1 | 0.09 / 0.06 | 0.50 / 0.48 | 0.50 / 0.48 | 0.51 / 0.49 | 0.51 / 0.48 | 0.51 / 0.48 | 0.51 / 0.48 |
| B | 1e5 | 4 | 0.09 / 0.16 | 0.50 / 0.57 | 0.50 / 0.57 | 0.51 / 0.58 | 0.51 / 0.57 | 0.51 / 0.57 | 0.51 / 0.57 |
| B | 1e4 | 1 | 0.09 / 0.06 | 0.50 / 0.48 | 0.50 / 0.48 | 0.54 / 0.51 | 0.55 / 0.53 | 0.60 / 0.58 | 0.53 / 0.50 |
| B | 1e4 | 4 | 0.09 / 0.16 | 0.50 / 0.57 | 0.50 / 0.57 | 0.54 / 0.61 | 0.56 / 0.62 | 0.59 / 0.66 | 0.53 / 0.60 |
| B | 1e3 | 1 | 0.09 / 0.06 | 0.50 / 0.48 | 0.50 / 0.48 | 0.70 / 0.68 | 0.79 / 0.77 | 1.06 / 1.04 | 0.70 / 0.69 |
| B | 1e3 | 4 | 0.09 / 0.16 | 0.50 / 0.57 | 0.50 / 0.57 | 0.70 / 0.78 | 0.80 / 0.87 | 1.05 / 1.13 | 0.72 / 0.80 |

- **The load sets the floor.** After it, the feature stages add 1–2 % of commit
  at 1e5 and 2–21 % at 1e4. At 1e3 they add 8 % on A and 117 % on B.
- **Four threads cost about 0.1 GiB of commit,** from the import on. The working
  set is unchanged. The cap counts commit, so the 0.1 GiB counts against it.

### 5.3 A lower threshold: noise 1e3 (one run per setting)

| File | OMP | Wall s | CPU s | Import s | Load s | MTD s | EPD s | FFM s | Store s | Peak WS GiB | Peak commit GiB | Traces → after EPD | Features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1 | 38.4 | 19.0 | 6.5 | 24.5 | 1.2 | 1.4 | 1.8 | 0.2 | 0.93 | 0.91 | 5,733 → 6,295 | 4,840 |
| A | 4 | 26.2 | 27.4 | 5.1 | 15.7 | 1.9 | 0.6 | 1.2 | 0.2 | 0.94 | 1.00 | 5,733 → 6,295 | 4,840 |
| B | 1 | 101.5 | 24.6 | 18.3 | 9.9 | 8.4 | 6.6 | 54.0 | 1.3 | 1.06 | 1.04 | 7,665 → 21,251 | 20,617 |
| B | 4 | 46.1 | 32.1 | 6.5 | 7.9 | 6.1 | 9.1 | 13.8 | 1.3 | 1.05 | 1.13 | 7,665 → 21,251 | 20,617 |

- **On B, 1e3 is where the feature stages start to cost.** EPD split 7,665
  traces into 21,251, and FFM took 54 s on one thread and 13.8 s on four.
- **On A's QTOF scale, 1e3 is the realistic setting.** It gives 4,840 features.
  At 1e4 and 1e5, A keeps only 475 and 55.

### 5.4 The source passes the M9 adapter adds

`adapter_v1.py` does more than the engine before any analysis:

1. SHA-256 over the whole source;
2. a load of **all** MS levels;
3. SHA-256 again;
4. an expat count of the spectra.

`adapter_overhead.py` repeats exactly those steps, two runs per file, at OMP 1.

| Run | Wall s | CPU s | SHA-256 before s | Import s | Load, all levels s | SHA-256 after s | Spectrum count s | Spectra (count agrees, digest unchanged) | `getSize()` | Peak WS GiB | Peak commit GiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A, 1 | 23.2 | 21.7 | 1.0 | 3.0 | 11.5 | 1.2 | 6.1 | 10,960 (yes, yes) | 48,431,879 | 0.87 | 0.84 |
| A, 2 | 21.8 | 20.7 | 1.0 | 2.0 | 11.1 | 1.1 | 6.0 | 10,960 (yes, yes) | 48,431,879 | 0.87 | 0.84 |
| B, 1 | 13.0 | 11.6 | 1.2 | 2.7 | 4.1 | 0.7 | 3.9 | 6,862 (yes, yes) | 24,984,611 | 0.50 | 0.48 |
| B, 2 | 12.0 | 11.5 | 0.6 | 2.5 | 3.7 | 0.7 | 4.1 | 6,862 (yes, yes) | 24,984,611 | 0.51 | 0.48 |

- **The two hashes and the count add 6–8 s per file.** The hashes ran on a file
  already in the OS cache.
- **Loading every MS level costs about as much as loading MS1 alone, on these
  two files only.** A has no MS2. B's 3,079 MS2 spectra hold 224,943 peaks,
  0.9 % of its total. A data-dependent run with dense MS2 would not behave like
  this.

### 5.5 The import, and the host

- **The import is usually short.** Over the 40 child runs, including the two
  smoke runs below, `import pyopenms` took 2.0–8.7 s in 34 of them. It took
  10.7, 16.7, 18.3, 28.2, 71.9 and 167.1 s in the other six.
- **The 167.1 s import happened once.** It was the first smoke run, at 11:37.
  The input was a 44-spectrum mzML derived
  from the public Thermo files of the
  [vendor centroiding record](THERMO_VENDOR_CENTROIDING_EVIDENCE.md), and the
  run used 4.4 s of CPU. Its second smoke run took 7.7 s to import.
- **Where the time went is not known.** Five later timings of the import under
  the worker's environment, four of them with one extra variable added, took
  6.4–7.2 s each.
- **One plausible cause is on-access scanning** of the runtime's 4,628 files
  (349 MB) on their first read after a while. This is not verified.
  [M9.0](M9_0_TARGETED_MS1_ROUTE_EVIDENCE.md) recorded a 2.8 s cold import.
- **The load varies with the host, too.** It took 7.7–30.1 s on A and
  3.4–42.0 s on B.
- **The memory gate never came close.** At launch, free memory was at least
  17.1 GiB, with at most 73.1 % used. During runs the lowest free reading was
  15.49 GiB and the highest use 75.7 %. Every child's handle creation time came
  1.2–3.3 ms after its launch.
- **An interrupted run left one empty directory.** It belongs to an earlier
  attempt's second repetition (A, OMP 1, 1e4) and holds no result, so it is not
  counted.

## 6. What it means for 600 s and 4 GiB

### 6.1 Memory: count MS1 peaks, not bytes

From the OMP 1 medians:

- **Fixed:** about 58 MiB of commit after the import, and 0.1 GiB more with
  four threads.
- **Load:** 17.3 bytes of commit per MS1 centroid peak on A and 18.3 on B.
  That is consistent with a 16-byte peak plus per-spectrum overhead.
- **Feature stages:** 10–20 MiB, plus roughly 70–200 bytes per MS1 peak at or
  above the noise threshold. On B the term grew faster than linearly from 1e4
  to 1e3.

As a single figure per MS1 peak, from the import to the end of FFM:

| Case | Commit bytes per MS1 peak | MS1 peaks that would fill 4 GiB with OMP 4 [estimate] |
| --- | --- | --- |
| A, 1e3 to 1e5 | 17.7–18.9 | about 218 M |
| B, 1e5 | 18.7 | about 220 M |
| B, 1e4 | 22.6 | about 183 M |
| B, 1e3 | 42.8 | about 96 M |

Bytes on disk are a poor proxy, because encoding sets the ratio:

- **These two files:** 19.7 bytes per peak on disk for A (zlib, 64-bit) and
  22.6 for B (uncompressed, 64-bit). At load, commit came to about 0.9 × the
  file size.
- **Denser encodings:** zlib with 32-bit intensities, or MS-Numpress, can store a
  peak in under 10 bytes. A 1 GiB file of that kind could hold over 100 M MS1
  peaks [estimate]. A file with heavy MS2 holds fewer MS1 peaks than its size
  suggests.

So the 4 GiB commit cap holds with a wide margin for files like A and B up to
about 1 GiB, at every measured threshold. At 1e4 and above, it holds for files
like these up to about 2 GiB [estimate]. A 2 GiB file as dense as B, run at 1e3
with four threads, would reach about 3.9 GiB, within 3 % of the cap [estimate].

The research estimated 1.5–9 GiB for one 1–2 GiB file. The measured files
support only the lower part of that range:

- the highest commit measured was 1.13 GiB, on the 0.53 GiB file;
- extrapolated to 2 GiB files encoded like these, the commit comes to about
  1.9–3.9 GiB [estimate];
- reaching the upper part would take a denser encoding, a lower threshold, or
  both.

### 6.2 Time: the import and the load, not the algorithm

- **At 1e4 and 1e5,** MTD + EPD + FFM took 5.4 s or less. The wall time is the
  import plus the load, plus the adapter's own 6–8 s of source passes.
- **At 1e3 on B,** the feature stages took 69 s on one thread and 29 s on four.
  The traces EPD keeps grow faster than the peaks above the threshold.
- **Four threads did shorten the load on A** (median 10.3 against 14.9 s at
  1e5), at about 60 % more CPU time. They did not shorten it on B, whose arrays
  are uncompressed. What makes A's load parallel was not checked.

The 600 s budget runs from launch. A sum of each stage's worst observation is a
pessimistic bound:

- 167 s import;
- 42 s load;
- 69 s for the feature stages (B, 1e3, OMP 1);
- 8 s of adapter source passes;
- about 1 s to store.

That comes to about 290 s. Doubling every data-dependent term, for a file with
about twice A's MS1 peaks, gives about 410 s [estimate]. Both are under 600 s.
FFM's scaling above B's 1e3 trace count was not measured.

## 7. Recommended per-recipe budgets

Recommendations for the owner and the U1 recipe record. Nothing here changes
`targeted_ms1.rs`.

| Recipe | Wall budget | Job commit cap | Threads | Admission before the load |
| --- | --- | --- | --- | --- |
| Targeted MS1 (M9, today) | 600 s, unchanged | 4 GiB, unchanged | `OMP_NUM_THREADS=1`, unchanged | as today |
| U1 single-file feature detection | **600 s.** It covers the 290 s pessimistic sum about twice. | **4 GiB**, with the admission rule | **`OMP_NUM_THREADS=4`.** It halves the wall time where the feature stages cost (1e3), and the extra 0.1 GiB is in the admission figure | **Refuse, typed, above 80 M MS1 centroid peaks.** Refuse a `noise_threshold_int` below 1e3 until a lower value is measured |

How the U1 limits follow from the data:

- **80 M MS1 peaks.** At the worst density measured (B at 1e3: 42.8 bytes per
  peak, plus 0.16 GiB fixed with four threads), 80 M peaks predict about
  3.35 GiB. That leaves about 16 % headroom under the cap. A (48 M) and B (25 M)
  both pass, and so does a file of about 1.6 × A.
- **Counting before the load.** The adapter already parses the whole file with
  expat to count spectra, in 4–6 s here. The same pass can sum the MS1
  spectra's `defaultArrayLength` before the engine loads anything. Today that
  count runs after the load, so the order would change.
- **The 1e3 floor.** It is the lowest threshold measured. The engine's default
  of 10 is the research's case of "hours", and it stays out until measured.
- **Load MS1 only.** U1 needs no MS2 for feature finding. Section 5.4 shows that
  loading every level costs little only when MS2 is sparse.
- **Keep the cap as the backstop.** If the admission figure is wrong, the Job cap
  still stops the worker and the run fails closed.

Alternative: raise U1's cap to 6 GiB and admit up to about 120 M MS1 peaks, so
that dense 2 GiB files pass at 1e3. This needs a stated minimum of installed
memory (16 GiB is a reasonable floor), and it is the owner's call. It is not the
recommendation, because no measured file needs it.

Targeted MS1 shares the import. The single 167 s import used about 28 % of its
600 s budget, so that budget should stay where it is.

## 8. What this does not show

- **No 1–2 GiB Orbitrap run.** The larger file is 0.89 GiB QTOF data. The
  Orbitrap file is 0.53 GiB, and it is a standards mix, not a biological
  matrix. Larger files are an extrapolation through MS1 peak counts.
- **No threshold below 1e3,** and not the engine's default of 10.
- **No profile input.** Profile input is refused, as M9 refuses it.
- **No negative mode, no ion mobility, no MS-Numpress, no 32-bit-intensity
  zlib file.**
- **Probably a warm file cache.** Each file's census read it in full before
  its first timed run, so most or all timed loads probably came from the OS
  cache. This record did not control the cache. A cold read from disk adds the
  read time of 0.5–0.9 GiB.
- **One host, shared with other work.** Wall times carry that noise, and CPU
  times are the steadier figure. The 167 s import was seen once and not
  reproduced.
- **The engine and the adapter's source passes only.** The M9 supervisor, the
  Job object, result validation and record writing were not exercised. The
  runs used no Job, so they measure the peak; they do not show the cap
  stopping a run.
- **Feature quality was not judged.** Counts are reported as the engine gave
  them; no feature was checked against the IROA mix's known compounds.

## 9. Where the outputs are

All per-run outputs are outside the repository:

- per run: `result.json`, with the events, read-back parameters, samples and
  counters;
- per run: `samples.tsv` and the featureXML;
- per batch: the runner's log;
- per file: the census JSON;
- a provenance note beside the data.

None of it is committed. The runs can be repeated from section 4 with the
scripts whose digests are listed there.
