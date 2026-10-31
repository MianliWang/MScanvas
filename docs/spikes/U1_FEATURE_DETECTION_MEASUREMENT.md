# U1 — single-file feature detection: time and memory

**Outcome: MEASURED.** On two public centroided LC-MS runs, pyOpenMS 3.5.0's
`MassTraceDetection` → `ElutionPeakDetection` → `FeatureFindingMetabo` stayed
far inside today's analysis worker limits of 600 s and a 4 GiB Job commit cap.
At noise thresholds 1e4 and 1e5, the slowest single run took 94.8 s. On the
engine's own path the highest peak commit was 0.95 GiB and the highest peak
working set 0.88 GiB. The M9 adapter's source check keeps a copy of every MS1
spectrum; that alone took A's commit to 1.55 GiB before any feature stage
(section 5.4). Three findings set the budgets:

- **Memory is modelled per MS1 peak.** Loading cost 17–18 bytes of commit per
  MS1 centroid peak on both files, consistent with a 16-byte in-memory peak. The
  two files store a similar number of bytes per peak on disk, so they do not
  contrast a per-peak model with a per-byte one: the per-peak model is inferred
  from the in-memory layout. The feature stages add roughly 70–200 bytes per
  peak at or above the noise threshold, which is a small term at 1e4 and 1e5.
- **Time is mostly the engine import and the mzML load.** The three feature
  stages took 5.4 s or less at 1e4 and 1e5. At 1e3 on the Orbitrap file they
  took 6.8–11.9 s on one thread and 6.3–8.3 s on four, in three interleaved
  runs each. One earlier run on a busy host took 69 s (section 5.3).
- **The import is the outlier.** It usually takes 1.4–8.7 s. Once, in the first
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
| `<runs_overhead>`, `<runs_check>` | the same, for the adapter source-pass runs of section 5.4 |
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
| Runtime check | A read-only check after the runs found all 4,628 manifest files present and equal, and no extra file: `RESULT MATCH`. It was repeated after the review-round runs with the same result. The runs wrote nothing into the runtime |
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
between samples is never missed. The review-round child `ff_stage_cpu.py` is
`ff_stage.py` with one added field on every boundary line, the process's CPU
time so far (`time.process_time()`, all threads); a file comparison shows no
other change.

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
- **Identity.** The runner samples through the process handle it got from
  `CreateProcess`, so a reused PID is never sampled. As a cross-check it
  requires the handle's creation time to lie no more than 1 s before the
  launch reading (`run_u1.py` compares against the launch minus 1 s). Every
  run passed, with the creation time 0.8–3.3 ms after the launch.
- **Sampling.** Every 100 ms it reads the child's working set and commit through
  that handle, and the system's free memory.
- **Gate.** Before each launch it admits at 8 GiB or more free and 80 % or less
  used. It kills the child at once under 4 GiB free or over 90 % used.
- **Totals.** Wall time runs from launch to exit. CPU time comes from
  `GetProcessTimes`. The process peaks come from the OS counters after exit.

Commands, run from `<tools>`. Every runner call has the second form below. A
setting is written `<OMP>:<noise>`, one call may list several, and each run
writes `<out>\<label>_omp<OMP>_noise<noise>\`. The runner interpreter for
repetitions 3–8 and the adapter runs was MSYS2 MinGW CPython 3.14.3. It was not
recorded for the first batches; the runner uses only the standard library and
does not touch the child's measurements.

```text
<runtime>\cpython-3.13.15-embed\python.exe -I -B -X utf8 census.py <data>\<file>.mzML <out>.json
<runner-python> -I -B run_u1.py <runtime>\cpython-3.13.15-embed\python.exe <tools>\<child> <data>\<file>.mzML <out> <label> <setting>...
```

The calls, batch by batch:

| Batch | Time | Child | Calls |
| --- | --- | --- | --- |
| First | 12:03–12:20 | `ff_stage.py` | One call per file with all six settings in the order `1:100000 4:100000 1:10000 4:10000 1:1000 4:1000`: `<out>` `<runs>\mtbls1785` with label `A`, then `<runs>\mtbls1861` with label `B`. A second call for A (`<runs>\mtbls1785_rep2`, label `A2`) finished `1:100000` and `4:100000` and was interrupted in `1:10000` (section 5.5). These are the only 1e3 runs without stage CPU |
| Repetitions 3–5 | 19:06–19:15 | `ff_stage.py`, then `adapter_overhead.py` | `batch_reps.sh`, one call per setting, `<out>` `<runs>\rep<k>`, labels `A<k>` and `B<k>`. Setting order: rep 3 `1:100000 4:100000 1:10000 4:10000`; rep 4 `4:10000 1:10000 4:100000 1:100000`; rep 5 `1:10000 4:100000 4:10000 1:100000`. Within a setting A ran first, except in rep 4. Then `adapter_overhead.py` at `1:100000`, `<out>` `<runs_overhead>\rep<k>`, labels `OA<k>` and `OB<k>`, for k 1 and 2, A first |
| Review round | 19:48–19:53 | `ff_stage_cpu.py`, `adapter_check.py` | `batch_r2.sh`, noise 1e3 only, one call per setting, `<out>` `<runs>\rep<k>` for k 6–8, labels `A<k>` and `B<k>`. Order, as file and OMP: rep 6 A1 B1 A4 B4; rep 7 B4 A4 B1 A1; rep 8 A4 B1 A1 B4. `adapter_check.py` at `1:100000` ran twice per file between them: `<runs_check>\rep1` (labels `CA1`, `CB1`) after rep 6, `<runs_check>\rep2` (`CB2`, `CA2`) after rep 7 |

Interleaving the files and rotating the order spread slow periods on the host
across settings.

Script SHA-256 (the scripts stay outside the repository):

| Script | SHA-256 |
| --- | --- |
| `ff_stage.py` | `57d22e00f70842a3ad05dcf89da994556acb6c065939a31a8c1af4ec0a886069` |
| `ff_stage_cpu.py` | `43bb480c282225ccc3e0c4be102b689bd3d9d72530d733153eda355d1685a312` |
| `run_u1.py` | `660b238d228ff73a30d4060ff2b30144c3557962ace5e57980789c17f48f2059` |
| `adapter_overhead.py` | `f70d3a7ed8751e0250e2eab1cfe9fb27b6d84f7714719846333be955609237a9` |
| `adapter_check.py` | `ce847c6743dee9e12bb03f0e2b6981dd0b96d3ff733603f87c1588de0145750a` |
| `census.py` | `4fe52a94fa3cb34fdac028073ec382f5334a2009aa1c9ec191908fda73444109` |
| `batch_reps.sh` | `1e974b3abe709aa397c455e8dcf7efdb174696fc78be13d0b50856bea3c14d22` |
| `batch_r2.sh` | `af2ce5adba37f91dee52b35cf545d19d287d26c04ba0653788be4c6717166838` |
| `u1_tables.py`, tables of 5.1–5.3 | `6d39b096b4ecb267cfdc9d8a99aab6fc1c2e620ff4f001b1e51333508c65f3f1` |
| `u1_extra.py`, 5.4 and 5.5 | `bfd40254defaf0fc0a056cf2ad48da0994ccec347b9546a486991460f6373215` |
| `u1_r2.py`, review-round tables and the time estimates of 6.2 | `28a6591ffa711d437074c5bdfe405e047f1c42cb69a53d429d6c217f034e1159` |
| `calc_r2.py`, the commit estimates of 6.1 and 7 | `8874cd86726969a90183cdf6bd3a9bce6e72107fb63cd8901b555cc1aa6650f6` |

`ff_stage.py` and `run_u1.py` were last modified before the first timed run and
were not changed afterwards. Each other measurement script was written before
the first run that used it.

## 5. Results

Runs took place on 2026-10-30 (UTC-4): two smoke runs at 11:37 and 11:57, the
first batches from 12:03 to 12:20, the interleaved repetitions and adapter
runs from 19:06 to 19:15, and the review round's 1e3 repetitions and adapter
check runs from 19:48 to 19:53. Every one of the 60 timed runs exited 0 and was
neither stopped nor capped. Feature and trace counts were identical across
repetitions of a setting, and no feature had zero intensity.

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
- **Highest peaks:** 0.88 GiB working set and 0.95 GiB commit, both on A, on
  the engine's path. The M9 adapter's MS1 copy would add to them (section 5.4).

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
| A | 1e3 | 1 | 0.09 / 0.06 | 0.86 / 0.84 | 0.86 / 0.84 | 0.90 / 0.88 | 0.91 / 0.88 | 0.93 / 0.91 | 0.93 / 0.90 |
| A | 1e3 | 4 | 0.09 / 0.16 | 0.87 / 0.94 | 0.87 / 0.93 | 0.91 / 0.98 | 0.91 / 0.98 | 0.94 / 1.00 | 0.94 / 1.00 |
| B | 1e5 | 1 | 0.09 / 0.06 | 0.50 / 0.48 | 0.50 / 0.48 | 0.51 / 0.49 | 0.51 / 0.48 | 0.51 / 0.48 | 0.51 / 0.48 |
| B | 1e5 | 4 | 0.09 / 0.16 | 0.50 / 0.57 | 0.50 / 0.57 | 0.51 / 0.58 | 0.51 / 0.57 | 0.51 / 0.57 | 0.51 / 0.57 |
| B | 1e4 | 1 | 0.09 / 0.06 | 0.50 / 0.48 | 0.50 / 0.48 | 0.54 / 0.51 | 0.55 / 0.53 | 0.60 / 0.58 | 0.53 / 0.50 |
| B | 1e4 | 4 | 0.09 / 0.16 | 0.50 / 0.57 | 0.50 / 0.57 | 0.54 / 0.61 | 0.56 / 0.62 | 0.59 / 0.66 | 0.53 / 0.60 |
| B | 1e3 | 1 | 0.09 / 0.06 | 0.50 / 0.48 | 0.50 / 0.48 | 0.70 / 0.68 | 0.79 / 0.77 | 1.06 / 1.05 | 0.70 / 0.68 |
| B | 1e3 | 4 | 0.09 / 0.16 | 0.50 / 0.57 | 0.50 / 0.57 | 0.70 / 0.78 | 0.80 / 0.87 | 1.04 / 1.11 | 0.70 / 0.79 |

- **The load sets the floor.** After it, the feature stages add 1–2 % of commit
  at 1e5 and 2–21 % at 1e4. At 1e3 they add 8 % on A and 118 % on B.
- **Four threads cost about 0.1 GiB of commit,** from the import on. The working
  set is unchanged. The cap counts commit, so the 0.1 GiB counts against it.

### 5.3 A lower threshold: noise 1e3 (four runs per setting)

Each setting ran once in the first batch and three times, interleaved, in the
review round with `ff_stage_cpu.py`. Review-round cells are medians with the
range over the three runs. Stage CPU is the process's CPU time between the
stage's boundaries; the first batch did not record it.

| File | OMP | Runs | Wall s | CPU s | Import s | Load s | MTD+EPD+FFM s | Their CPU s | FFM s | FFM CPU s | Peak WS GiB | Peak commit GiB | Traces → after EPD | Features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1 | review, 3 | 12.2 (9.7–13.1) | 11.6 (9.5–12.5) | 1.6 (1.6–2.3) | 7.9 (6.2–8.8) | 1.4 (1.4–1.9) | 1.4 (1.4–1.8) | 0.6 (0.5–0.7) | 0.5 (0.5–0.7) | 0.93 | 0.91 | 5,733 → 6,295 | 4,840 |
| A | 4 | review, 3 | 8.2 (7.3–10.0) | 21.8 (19.9–26.2) | 1.7 (1.4–2.2) | 4.4 (4.0–5.9) | 1.2 (1.0–1.6) | 2.7 (2.6–3.5) | 0.4 (0.4–0.7) | 1.4 (1.3–1.9) | 0.94 | 1.00 (1.00–1.01) | 5,733 → 6,295 | 4,840 |
| B | 1 | review, 3 | 16.3 (11.2–17.3) | 15.5 (10.8–16.5) | 1.9 (1.7–2.4) | 2.4 (1.9–2.6) | 10.3 (6.8–11.9) | 9.8 (6.5–11.2) | 5.4 (3.8–7.1) | 5.2 (3.7–6.6) | 1.06 | 1.05 | 7,665 → 21,251 | 20,617 |
| B | 4 | review, 3 | 11.6 (11.5–16.3) | 22.9 (21.1–28.6) | 2.1 (1.6–2.6) | 2.3 (1.5–4.0) | 7.3 (6.3–8.3) | 12.8 (11.3–14.6) | 3.4 (2.7–3.6) | 8.3 (6.9–8.9) | 1.03 (1.03–1.04) | 1.11 | 7,665 → 21,251 | 20,617 |
| A | 1 | first, 1 | 38.4 | 19.0 | 6.5 | 24.5 | 4.4 | not recorded | 1.8 | not recorded | 0.93 | 0.91 | 5,733 → 6,295 | 4,840 |
| A | 4 | first, 1 | 26.2 | 27.4 | 5.1 | 15.7 | 3.7 | not recorded | 1.2 | not recorded | 0.94 | 1.00 | 5,733 → 6,295 | 4,840 |
| B | 1 | first, 1 | 101.5 | 24.6 | 18.3 | 9.9 | 69.0 | not recorded | 54.0 | not recorded | 1.06 | 1.04 | 7,665 → 21,251 | 20,617 |
| B | 4 | first, 1 | 46.1 | 32.1 | 6.5 | 7.9 | 29.0 | not recorded | 13.8 | not recorded | 1.05 | 1.13 | 7,665 → 21,251 | 20,617 |

- **The first-batch 1e3 runs were slowed by the host, not by the work.** B at
  OMP 1 took 101.5 s, 54.0 s of it in FFM, while the whole process used 24.6 s
  of CPU, so FFM spent at least 29 s waiting for a processor. The review-round
  runs, on a quieter host, took 11.2–17.3 s.
- **On B, 1e3 is where the feature stages start to cost.** EPD split 7,665
  traces into 21,251. The three stages took 10.3 s on one thread and 7.3 s on
  four, for 9.8 and 12.8 s of CPU.
- **Four threads at 1e3** made whole runs about 1.5 times faster on A (12.2
  against 8.2 s) and 1.4 times on B (16.3 against 11.6 s), for 88 % and 47 %
  more CPU time. On A most of the gain is the load, 7.9 against 4.4 s. On B the
  ranges of the whole runs overlap: 11.2–17.3 against 11.5–16.3 s.
- **On A's QTOF scale, 1e3 is the realistic setting.** It gives 4,840 features.
  At 1e4 and 1e5, A keeps only 475 and 55.

### 5.4 The source passes the M9 adapter adds

`run()` in `adapter_v1.py` does five things to the source before any analysis:

1. SHA-256 over the whole source;
2. a load of **all** MS levels;
3. SHA-256 again;
4. an expat count of the spectra;
5. a list of every MS1 spectrum with its position,
   `ms1 = [(i, s) for i, s in enumerate(exp) if s.getMSLevel() == 1]` (line
   412), then `check_source` over it (line 413). `check_source` reads every MS1
   spectrum's arrays and tests each value with `math.isfinite` in Python. `run()`
   keeps the list to the end; lines 510 and 591 use it.

`adapter_overhead.py` repeats steps 1–4, two runs per file, at OMP 1.
`adapter_check.py` repeats steps 1–5, two runs per file in the review round. Its
`check_source` is a copy of `adapter_v1.py` lines 292–322, compared equal. Before
step 5 it also runs a lean check that the adapter does not have: one spectrum at
a time by index (`exp.getSpectrum(i)`), finite tests with numpy, nothing kept.

Steps 1–4:

| Run | Wall s | CPU s | SHA-256 before s | Import s | Load, all levels s | SHA-256 after s | Spectrum count s | Spectra (count agrees, digest unchanged) | `getSize()` | Peak WS GiB | Peak commit GiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A, 1 | 23.2 | 21.7 | 1.0 | 3.0 | 11.5 | 1.2 | 6.1 | 10,960 (yes, yes) | 48,431,879 | 0.87 | 0.84 |
| A, 2 | 21.8 | 20.7 | 1.0 | 2.0 | 11.1 | 1.1 | 6.0 | 10,960 (yes, yes) | 48,431,879 | 0.87 | 0.84 |
| B, 1 | 13.0 | 11.6 | 1.2 | 2.7 | 4.1 | 0.7 | 3.9 | 6,862 (yes, yes) | 24,984,611 | 0.50 | 0.48 |
| B, 2 | 12.0 | 11.5 | 0.6 | 2.5 | 3.7 | 0.7 | 4.1 | 6,862 (yes, yes) | 24,984,611 | 0.51 | 0.48 |

Step 5, with the lean check before it (`adapter_check.py`):

| Run | Wall s | CPU s | Import s | Load, all levels s | Steps 1, 3, 4 s | Lean check s | MS1 list s | MS1 list commit GiB | `check_source` s (CPU s) | Commit before → after step 5 GiB | Peak WS GiB | Peak commit GiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A, 1 | 27.9 | 26.4 | 2.1 | 9.2 | 4.7 | 0.7 | 0.5 | +0.72 | 10.2 (9.9) | 0.84 → 1.55 | 1.58 | 1.55 |
| A, 2 | 27.2 | 26.3 | 1.5 | 8.1 | 6.2 | 0.9 | 0.4 | +0.72 | 9.6 (9.2) | 0.84 → 1.55 | 1.58 | 1.55 |
| B, 1 | 20.8 | 18.2 | 2.5 | 3.2 | 5.2 | 0.4 | 0.3 | +0.36 | 8.8 (7.6) | 0.47 → 0.84 | 0.87 | 0.84 |
| B, 2 | 16.7 | 16.1 | 2.1 | 3.6 | 3.8 | 0.5 | 0.3 | +0.36 | 6.1 (6.0) | 0.47 → 0.84 | 0.87 | 0.84 |

- **The two hashes and the count took 3.8–8.2 s per file** over the eight runs.
  The hashes ran on a file already in the OS cache.
- **Step 5 holds a second copy of every MS1 spectrum.** The list added 15.8–15.9
  bytes of commit per MS1 peak, 0.72 GiB on A and 0.36 GiB on B, and it stays
  for the rest of the run, so the engine would start from that higher floor.
  `check_source` itself added about 1 MiB. Neither file was refused.
- **`check_source` took 6.1–10.2 s,** 190–310 ns of CPU per MS1 peak, most of it
  the per-value Python loop. With the list, step 5 took 6.4–10.7 s.
- **The lean check took 0.4–0.9 s and added no commit.** It covers only the
  finite test. The other tests of `check_source` (retention-time order, drift
  time and extra arrays, sorted m/z) need no Python loop over the peaks; they
  were not timed on their own.
- **Loading every MS level costs about as much as loading MS1 alone, on these
  two files only.** A has no MS2. B's 3,079 MS2 spectra hold 224,943 peaks,
  0.9 % of its total. A data-dependent run with dense MS2 would not behave like
  this.

### 5.5 The import, and the host

- **The import is usually short.** Over the 52 child runs, including the two
  smoke runs below, `import pyopenms` took 1.4–8.7 s in 46 of them. It took
  10.7, 16.7, 18.3, 28.2, 71.9 and 167.1 s in the other six. The eight adapter
  runs of section 5.4 imported in 1.5–3.0 s.
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
- **The load varies with the host, too.** It took 4.0–30.1 s on A and
  1.5–42.0 s on B. The review-round loads, on a quieter host, took 4.0–8.8 s on
  A and 1.5–4.0 s on B.
- **The memory gate never came close.** Over all 60 timed runs, free memory at
  launch was at least 17.1 GiB, with at most 73.1 % used. During runs the
  lowest free reading was 15.49 GiB and the highest use 75.7 %. Every child's
  handle creation time came 0.8–3.3 ms after its launch.
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
- **The M9 adapter's MS1 list:** 15.8–15.9 bytes per MS1 peak more, held to the
  end of the run (section 5.4). The figures below leave it out. They describe a
  U1 that keeps no such copy, which section 7 makes a precondition.

As a single figure per MS1 peak, from the import to the end of FFM:

| Case | Commit bytes per MS1 peak | MS1 peaks that would fill 4 GiB with OMP 4 [estimate] |
| --- | --- | --- |
| A, 1e3 to 1e5 | 17.7–18.8 | about 219 M |
| B, 1e5 | 18.7 | about 220 M |
| B, 1e4 | 22.6 | about 183 M |
| B, 1e3 | 42.9 | about 96 M |

Bytes on disk should be a poor proxy, because encoding sets the ratio. These two
files cannot show it, since they hold a similar number of bytes per peak:

- **These two files:** 19.7 bytes per peak on disk for A (zlib, 64-bit) and
  22.6 for B (uncompressed, 64-bit). At load, commit came to about 0.9 × the
  file size, so here bytes and peaks predict the load equally well.
- **Denser encodings:** zlib with 32-bit intensities, or MS-Numpress, can store a
  peak in under 10 bytes. A 1 GiB file of that kind could hold over 100 M MS1
  peaks [estimate]. A file with heavy MS2 holds fewer MS1 peaks than its size
  suggests.

So, on the engine's path, the 4 GiB commit cap holds with a wide margin for
files like A and B up to about 1 GiB, at every measured threshold. At 1e4 and
above, it holds for files like these up to about 2 GiB [estimate]. A 2 GiB file
as dense as B, run at 1e3 with four threads, would reach about 3.9 GiB, within
3 % of the cap [estimate]. With the M9 copy kept, the same file would reach
about 5.3 GiB [estimate].

The research estimated 1.5–9 GiB for one 1–2 GiB file. The measured files
support only the lower part of that range:

- the highest commit measured on the engine's path was 1.13 GiB, on the
  0.53 GiB file; with the M9 copy, A reached 1.55 GiB before any feature stage;
- extrapolated to 2 GiB files encoded like these, the commit comes to about
  1.9–3.9 GiB on the engine's path, and 1.4–1.6 GiB more with the M9 copy
  [estimate];
- reaching the upper part would take a denser encoding, a lower threshold, or
  both.

### 6.2 Time: the import and the load, not the algorithm

- **At 1e4 and 1e5,** MTD + EPD + FFM took 5.4 s or less. The wall time is the
  import plus the load, plus the source passes: 3.8–8.2 s for the hashes and the
  count, and 6.4–10.7 s more for the M9 adapter's MS1 list and `check_source`.
- **At 1e3 on B,** the feature stages took 6.8–11.9 s on one thread and
  6.3–8.3 s on four, on a quieter host. The traces EPD keeps grow faster than
  the peaks above the threshold. One first-batch run on a busy host took 69 s
  (section 5.3).
- **Four threads shortened the load on A** (median 10.3 against 14.9 s at 1e5,
  4.4 against 7.9 s at 1e3), at 60–90 % more CPU time. They did not shorten it
  on B, whose arrays are uncompressed. What makes A's load parallel was not
  checked.

The 600 s budget runs from launch. A sum of each stage's worst observation is a
pessimistic bound:

- 167 s import;
- 42 s load;
- 69 s for the feature stages (B, 1e3, OMP 1, on a busy host);
- 19 s of M9 source passes: 8 s for the hashes and the count, 11 s for the MS1
  list and `check_source`;
- about 1 s to store.

That comes to about 300 s. Doubling every data-dependent term, for a file with
about twice A's MS1 peaks, gives about 430 s [estimate]. Both are under 600 s.
FFM's scaling above B's 1e3 trace count was not measured.

That sum covers the measured files and twice A. It does not cover the admission
limits of section 7: the 1e4 tier admits about three times A's MS1 peaks.
Scaling to 80 M peaks at 1e3 and 150 M at 1e4, with the lean source check of
section 5.4 [estimates]:

- the review-round timings, which ran on a quieter host, give about 80–90 s;
- every worst observation scaled the same way, including the busy-host 69 s
  and 42 s, with the feature stages growing as on B from 1e4 to 1e3 (exponent
  1.3 in the peaks above the threshold), gives about 530–650 s.

So on a busy host a file near either limit could run out of the 600 s budget.
The worker then stops it with a typed timeout, and the run fails closed.

## 7. Recommended per-recipe budgets

Recommendations for the owner and the U1 recipe record. Nothing here changes
`targeted_ms1.rs`.

| Recipe | Wall budget | Job commit cap | Threads | Admission before the load |
| --- | --- | --- | --- | --- |
| Targeted MS1 (M9, today) | 600 s, unchanged | 4 GiB, unchanged | `OMP_NUM_THREADS=1`, unchanged | as today |
| U1 single-file feature detection | **600 s.** It covers the 300 s pessimistic sum for the measured files twice. Near the admission limits it covers the quieter-host estimate several times, but not every busy-host worst case (section 6.2) | **4 GiB**, with the admission rule | **`OMP_NUM_THREADS=1`, as in M9.** Four threads made the measured 1e3 runs 1.4–1.5 times faster for 47–88 % more CPU time and 0.1 GiB more commit; the measured files do not need the gain | **Refuse, typed, above 150 M MS1 centroid peaks at a `noise_threshold_int` of 1e4 or more, and above 80 M below 1e4.** Refuse a threshold below 1e3 until a lower value is measured. **Precondition:** U1's source check keeps no copy of the MS1 spectra |

How the U1 limits follow from the data:

- **Two tiers, from the worst density measured at each threshold.** Each
  includes the 58 MiB of commit after a one-thread import:
  - at 1e3, B used 42.9 bytes per MS1 peak, so 80 M peaks predict about
    3.25 GiB;
  - at 1e4, B used 22.6 bytes per MS1 peak, so 150 M peaks predict about
    3.22 GiB.

  Either tier leaves 19–20 % headroom under the cap. With four threads, 0.1 GiB
  more leaves 16–17 %.
- **The tiers hold only without the M9 copy.** The M9 adapter's step 5 adds
  15.9 bytes per MS1 peak for the whole run (section 5.4). With it, 80 M peaks
  at 1e3 predict about 4.4 GiB and 150 M at 1e4 about 5.4 GiB, both over the
  cap. So U1's source check reads one spectrum at a time by index and keeps
  nothing, as the lean check did in 0.4–0.9 s with no added commit. If U1 keeps
  the copy instead, the tiers must drop to about 55 M at 1e3 and 85 M at 1e4 to
  keep at least that headroom [estimate].
- **Why one thread.** Four threads shortened the measured runs by seconds,
  mostly in A's zlib load, against a budget of minutes. They cost CPU time on a
  machine the worker shares with the user, and commit the cap counts. Four
  threads are the alternative if a measured file needs the time.
- **What passes.** A (48 M) and B (25 M) pass both tiers. At 1e4 and above, so
  does a 2 GiB file at A's density, about 109 M peaks. At 1e3, a file of about
  1.6 × A still passes. A 2 GiB file is refused there.
- **What the count cannot see.** The pre-load count sees the MS1 peaks but not
  how many lie above the threshold. That fraction set B's density: about 14 %
  of its peaks at 1e3, 4 % at 1e4. A denser biological Orbitrap run could exceed
  the headroom, and the Job cap is the backstop for that case.
- **Counting before the load.** The adapter already parses the whole file with
  expat to count spectra, in 2.6–6.1 s here. The same pass can sum the MS1
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

None of it is committed. The scripts sit in a scratch directory that is not
kept. Section 4 records each script's SHA-256 and how it was called, so a kept
copy can be checked against this record. Once the scratch directory is cleared,
repeating the runs means writing the scripts again from sections 4.2 and 4.3.
