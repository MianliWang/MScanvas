# ADR 0068 — The RT × m/z map

Status: **Proposed** 2026-10-30. The owner has not decided it. Slice 1, the
library, is implemented on branch `be/map2d` (stacked on ADR 0056's slice 2,
PR #175); no command, screen or export uses it. The questions for the owner are
[at the end](#open-questions-for-the-owner).
Related: [0005](0005-mzml-preview-boundary.md),
[0028](0028-figure-renderer-and-semantic-specification.md),
[0030](0030-png-copy-plot-and-figure-settings.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md),
[0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md).
Evidence: the measurement [below](#evidence), made with
`crates/proteowizard/examples/rt_mz_map_evidence.rs` on public files.

## Context

The owner wants v5.11's two-dimensional feature distribution: one picture of a
run, retention time across and m/z up, coloured by intensity. The analysis
research of 2026-10-30 put it on the track that needs no Python runtime, as
"a Rust-binned raster from a streaming MS1 pass", and asked that it be
measured on real files first.

Three records constrain it:

- **ADR 0056, decision 7.** The project-owned reader decodes; "any computation
  over the decoded arrays is an algorithm, and it needs its own record". This
  ADR is that record for the map, and its scope is its limit.
- **ADR 0028.** Screen and export share one semantic specification; a
  reduction says what it dropped; the export is not the screen's reduction.
- **ADR 0030.** It records as a fact, not a rule, that the figure this
  application produces embeds no bitmap, which is why `resvg` is built without
  its `raster-images` feature.
- **AGENTS.md.** Large scientific arrays do not travel through React state. No
  implicit centroiding, no fallback.

The reader reads one selected spectrum per call and refuses typed. It does not
read polarity yet; branch `be/reader-meta` adds it.

## Decisions

### 1. What the map shows

- **MS1 spectra only.** A spectrum is MS1 when the reader's MS level is 1.
  MS2 and higher are never read for the map.
- **Zoom and SIM scans are MS1 too.** The project-owned reader's table row
  states no scan type or filter, so a narrow-window MS1 scan is mapped with the
  full scans. The LTQ Velos file's 29 profile MS1 spectra are 15 full scans of
  m/z 300–2000 and 14 zoom scans (MS:1000497), each of a 10 m/z window between
  297 and 683; a zoom scan's row holds values only in its window. Whether to
  separate them is [open question 8](#open-questions-for-the-owner).
- **Each cell holds the greatest stored intensity** of the points that fall in
  it (maximum, not sum). The caption, the legend and the data document say
  "greatest intensity per cell". Why not a sum: see decision 3.
- **An empty cell is not zero.** A cell no point fell in has no value and is
  drawn as the background. A measured zero is a value, and so is a negative
  intensity, which is kept (ADR 0028).
- **Colour scale: log10, stated in the legend.** Stored values stay linear; only
  the colour mapping is logarithmic, because a run's MS1 intensities span many
  decades and a linear scale shows only the base peaks. Cells holding zero or a
  negative value cannot be placed on a log scale; they take one stated "≤ 0"
  colour, distinct from the background. A linear scale is an
  [open question](#open-questions-for-the-owner).
- **Polarity.**
  - Until the reader reports polarity, a map does not separate polarities. Its
    caption states "polarity not reported", and a polarity-switching file's
    MS1 spectra of both polarities share one map. That is a known risk, stated
    on the figure.
  - Once the reader reports it (`be/reader-meta`), a map is of one polarity. A
    file whose MS1 spectra declare both is mapped once per polarity. A file
    where only some MS1 spectra declare a polarity is refused, as mixed
    retention-time units are (decision 4). That follow-up amends this ADR and
    the library.
- **Nothing else is drawn.** No smoothing, interpolation, centroiding, noise
  floor or feature detection. Feature markers on the map come later from
  analysis artifacts, never from the binner.

### 2. How it is computed

- **From the open's spectrum table.** The map needs the dataset's retained
  preview state (ADR 0056, decision 4), as a selected spectrum does. The table
  says which spectra are MS1, where they are, and their retention times, before
  any array is read.
- **One forward pass, one handle.** The pass opens the file once, walks the
  table's MS1 rows in file order, and reads each one with the reader's selected
  read at its recorded offset. Each spectrum is therefore checked against the
  table (index and native ID) and decoded under ADR 0056's caps and refusals,
  and the binner decodes nothing itself. The handle is closed when the pass
  ends, is cancelled or fails. ADR 0056's "no read holds a file handle" holds
  with the pass counted as one read.
- **Only the window is read.** A spectrum whose retention time is outside the
  view is not read. Zooming in on retention time costs fewer spectra; zooming
  in on m/z alone costs the same spectra as the window.
- **Binning in Rust, bounded memory.** The pass holds the raster, one decoded
  spectrum at a time (at most ADR 0056's 128 MiB decode cap) and the open's
  table, which already exists. Measured peak working set: 36–37 MB (Evidence).
- **A raster of bounded size per view.**
  - Equal-width bins across each axis. A bin is half-open, `[edge, next edge)`,
    except the last, which also holds the view's upper bound.
  - At most 2^21 cells (`MAX_MAP_CELLS`, 16 MiB of `f64`). The caller picks the
    bin counts from the view's size in device pixels.
  - Bounds must be finite with a finite, positive width, and a bin at least
    four `f64` units in the last place of the larger bound wide, so every bin
    has width; anything else is refused before any spectrum is read.
- **Recomputed per view, within bounds.** A zoom or pan is a new pass over the
  source for the new window, never a resampling of the previous raster.
- **Never the arrays.** Only the raster crosses to the webview, as one bounded
  value per cell. Decoded arrays stay in the pass and are dropped spectrum by
  spectrum.
- **The first view.** Retention time spans the lowest to the highest MS1
  retention time in the table. m/z spans the lowest and highest observed m/z the
  MS1 spectra state (MS:1000528, MS:1000527), when every MS1 spectrum states
  both. That is a selection from read values (`ms1_extent`). When one does not,
  the map has no first m/z range; see the open questions.
- **Points outside the m/z range are counted and stated.** On all three
  measured files the stated observed range left a few points outside it (1, 1
  and 16 points), so the first view says how many points it does not show.

### 3. Profile and centroid

- **Both are binned alike, as stored.** A profile sample and a centroid peak
  are each one point with one intensity. Nothing converts one into the other.
- **Why the greatest value.** A sum adds every stored point in the cell, so it
  measures how the spectra were stored as much as the signal.
  - Over the same 2,748 MS1 scans of one run, the profile file stores
    24,766,275 points and its vendor-centroided conversion 1,724,215: about 14
    profile samples per centroid. Where the centroided map adds one peak, a sum
    over the profile map would add about 14 samples.
  - Sampling also changes with m/z and with the instrument. In the Orbitrap
    profile file's largest MS1 spectrum (23,308 points) the median spacing of
    adjacent samples is 0.0027 at m/z 400–500 (118 pairs), 0.0073 at 800–900
    and 0.0128 at 1200–1300, so a fixed-width cell holds about 4.7 times as
    many samples at low m/z. In the LTQ Velos ion-trap file's largest MS1
    spectrum (a full scan, 20,399 points) the spacing is 0.0833 at every m/z;
    its 14 zoom-scan MS1 spectra are sampled at 0.020.
  - The greatest stored value is the height of the tallest sample or peak in
    the cell. Profile and centroid values are comparable only where a centroid's
    intensity is a peak height, and that depends on the instrument:
    - **Orbitrap.** On the measured run the vendor centroid of each MS1
      spectrum's most intense peak is 1.000–1.068 times that spectrum's highest
      profile sample (median 1.014) in all 2,748 MS1 spectra
      ([vendor-centroiding record, 3b](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md#3b-sanity-checks-on-orbitrap-ms1)).
      That compares one peak per spectrum, not every cell.
    - **Ion trap.** On the LTQ Velos run the same record finds the most
      intense of msconvert's vendor centroids 3.1–8.3 times the highest
      profile sample (median 6.8 for MS1) and states that "the ion-trap vendor
      intensity is not an apex height". The LTQ Velos conversion measured
      here also holds 15 MS1 full scans acquired as centroid
      (`ITMS + c`). Each was paired with the profile
      full scan acquired after it (at most 0.0022 min later), and the greatest
      intensity in m/z 400–1400 taken from each: the centroid scan's is 6.39 to
      24.03 times the profile scan's, median 11.07, over 15 pairs. On a log10
      scale that is about one decade.
- **The representation is stated; whether a mix is mapped is open.** The result
  counts binned spectra as profile, centroid and not declared, and the caption
  names the representation or states the counts when they differ. Slice 1's
  library bins a mix together: the LTQ Velos conversion maps 29 profile and 15
  centroid MS1 spectra into one raster. There, adjacent profile and centroid
  rows would differ by about a decade, and a cell holding both shows the
  centroid value; either reads as a change in signal.
  - **Recommended:** a map is of one representation, as it is of one polarity
    (decision 1). A file whose MS1 spectra hold both is mapped once per
    representation, and a file where only some MS1 spectra declare one is
    refused. The library change follows the owner's decision
    ([open question 7](#open-questions-for-the-owner)).

### 4. Units and "not reported"

- **Retention time** is in the unit the MS1 spectra declare, and nothing
  converts between seconds and minutes. MS1 spectra with different units, or
  where only some declare one, refuse the map, as ADR 0056 refuses the
  chromatogram. An undeclared unit is shown as not reported.
- **m/z and intensity** carry the units the binned spectra's arrays declare.
  Spectra with points must agree, or the map is refused; a spectrum with no
  points declares nothing and does not take part. None declared is not
  reported.

### 5. Refusals

Every refusal is typed, carries no path or document text, and leaves no
partial raster.

| Refusal | Stable identifier |
| --- | --- |
| A bound not finite, or a range empty, backwards, not finite or too narrow for its bins | `map_bounds_invalid` |
| An axis with no bins, or more than 2^21 cells | `map_bins_invalid` |
| The allocator refuses the raster | `allocation_refused` |
| The table has no MS1 spectrum | `no_ms1_spectra` |
| MS1 retention-time units differ | `mixed_retention_time_units` |
| Binned m/z or intensity units differ | `mixed_array_units` |
| The file cannot be opened | the reader's identifier |
| An MS1 spectrum in the window is refused by the reader | the reader's identifier, with the spectrum's index |
| Cancelled | `cancelled` |

- **One refused spectrum refuses the map.** A gap would read as "no signal".
  A file whose MS1 arrays are numpress-encoded therefore has no map, under the
  owner's 2026-10-29 decision that the viewer refuses numpress.
- A view whose window holds no MS1 spectrum is not refused: it is a map with
  every cell empty and zero spectra, and says so.

### 6. Progress and cancel

- **Progress** is `(done, total)` after each spectrum, where `total` counts the
  MS1 spectra in the window. It is known before the first read, so the screen
  can show a determinate bar.
- **Cancel** is checked before each spectrum is read and once after the last,
  with the crate's `CancellationToken`, so a cancel heard during the last
  spectrum or before an empty window still counts. A cancelled pass returns
  `cancelled` and no raster.
- **For the desktop slice (recommended, not implemented):**
  - one map pass per session at a time; a new view of the same dataset cancels
    the running pass, and the newest view wins;
  - the pass runs on its own worker and does not hold ADR 0057's native-read
    lane, because a full pass takes seconds and would hold every selected
    spectrum behind it. Reads share no cursor (ADR 0056, decision 4), so this
    is safe. Bounding concurrent passes at one keeps memory at one raster and
    one spectrum. Accepting this amends ADR 0057's "at most one native read
    runs at a time" for the map pass (open question 6);
  - admission is a native read's (ADR 0057): retained preview state and a
    usable backend, as today;
  - the file generation the open recorded is checked before the pass and after
    it, and a raster from a changed file is discarded; the reader's index and ID
    check also refuses a spectrum that moved.

### 7. Export

- **The figure is not the screen's raster.** An exported map is a new pass at
  the export's own cell counts, as ADR 0028 requires of every reduction.
- **The figure states its rule.** Caption and description: MS1 only; greatest
  intensity per cell; the cell size in both units; log10 colour with the "≤ 0"
  colour; the representation or its counts; polarity, or "polarity not
  reported"; retention-time, m/z and intensity units or "not reported"; points
  outside the m/z range.
- **Drawing (recommended).** A new plot kind in the shared specification, a
  cell grid drawn as vector rectangles, with adjacent cells of one colour step
  merged into one rectangle and the export's cell count capped. The figure then
  still embeds no bitmap, as ADR 0030 records it, and needs no dependency
  change.
  The plot kind is a plot-spec schema step with golden figures, in slice 3.
- **The data document** is the raster: each cell's two bin edges and its value,
  an empty cell as an empty field, with a preamble stating the rule, the units,
  the representation counts and the window. It is a new format with its own
  version. It never contains the arrays; a spectrum's own export already does.

### 8. What this record allows

This ADR is ADR 0056 decision 7's record for one computation: the greatest
stored intensity per cell of a bounded raster, as a display projection. It is
not a scientific quantity, and it allows no other computation over the arrays:
no sum, XIC, summed spectrum, peak picking or feature detection.

### 9. Delivery

1. **Library, no command or interface.** Implemented on `be/map2d`:
   `crates/proteowizard/src/rt_mz_map.rs` (`ms1_extent`, `bin_rt_mz_map`,
   `bin_rt_mz_map_from`) with tests for the cell rule, bin edges, the window,
   profile and centroid inputs, empty and refused files, unit agreement,
   request checks, progress and cancellation; and the measurement below.
2. **Desktop command.** A narrow command over the retained preview state,
   with progress events, cancel and supersession (decision 6), returning the
   bounded raster.
3. **Screen and export.** The plot kind, the screen view, the figure and data
   exports (decision 7), and rendered QA.
4. **Polarity**, after `be/reader-meta` merges (decision 1).
5. **Representation and scan type**, after the owner answers open questions 7
   and 8 (decisions 1 and 3).

## Evidence

Release build of the example at commit `a8eae524`, two runs per file, on a
14-core, 20-thread Windows machine, 2026-10-30, warm cache (each file was
hashed just before its runs). Inputs are
public and not committed. Each column names its source, the ProteoWizard
build and argv that wrote it, and its digest; the local manifest under
`D:\tmp\public-data\` (items 2 and 3a) holds the same. No ProteoWizard program
ran for this measurement.

| | Orbitrap MS1 profile | Orbitrap MS1 vendor-centroided | LTQ Velos, mixed |
| --- | --- | --- | --- |
| File | PXD081190 RAW → mzML ([source, build and argv](../../spikes/ADR0056_R0_REAL_FILE_COMPARISON.md#inputs)), 546,327,287 bytes, SHA-256 `82328655…de4fc3`, CC0 | [`TE1`](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md), 284,183,742 bytes, SHA-256 `4727d25e…540983`, CC0 | `msconvert` output of ProteoWizard's LTQ Velos test RAW (source, build and argv below), 5,060,221 bytes, SHA-256 `c72e2c8c…b63ec9`, from the Apache-2.0 ProteoWizard repository |
| Spectra, of which MS1 | 43,878; 2,748 profile | 43,878; 2,748 centroid | 85; 44 (29 profile: 15 full, 14 zoom; 15 centroid, acquired as centroid) |
| Table pass (exists after the open) | 3,937–4,180 ms | 3,575–4,422 ms | 9 ms |
| Full extent, 1,024 × 2,048 cells | 3,652–3,768 ms (3,519–4,444 ms over five runs, see below); 24,766,275 points; 726,465 cells hold a value | 598–654 ms; 1,724,215 points; 670,590 cells | 71–88 ms; 326,354 points; 43,894 cells |
| Middle tenth of each axis | 324–333 ms; 192 spectra | 48–49 ms; 192 spectra | 9–12 ms; 3 spectra |
| Points outside the stated m/z range | 1 | 1 | 16 |
| Peak working set, whole process | 36.3–36.4 MB | 36.0–36.9 MB | not captured: the 0.1 s run ended between polls |

- Full SHA-256: profile
  `823286559d48f48af0ff0a90d602b33e16791b42bdef46f8cdf44f2021de4fc3`, `TE1`
  `4727d25e277d98850afde73847953e6b0dab0390e1414cb2627cd2630e540983`, LTQ Velos
  `c72e2c8c9178005e6842067880810a978976544c6c36be806f88eeaeb1b63ec9`.
- LTQ Velos source: `090701-LTQVelos-unittest-01.raw` (2,086,041 bytes,
  SHA-256 `d457de3466d06bc91d39396afc6589ac87e3be1f909eea2c537b639e8675d2d6`)
  from
  `https://raw.githubusercontent.com/ProteoWizard/pwiz/4f92fe97ba0278a22486729d7ab658bba42a700a/pwiz/data/vendor_readers/Thermo/Reader_Thermo_Test.data.tar.bz2`
  (3,457,627 bytes, SHA-256
  `167e84a90d6e68009b1c35ce23f542678810241a9e76f7240da9b19de0394836`),
  converted on a copy by ProteoWizard 3.0.26013.47b13cf with argv
  `["msconvert.exe","090701-LTQVelos-unittest-01.raw","--mzML","--64","--zlib","-o","<outdir>"]`.
  This is not the vendor-centroiding record's `TV0` (`--mzML --zlib`, without
  `--64`; 4,790,428 bytes), which is a different file.
- Peak working set is the operating system's own peak counter,
  `Process.PeakWorkingSet64`, read from outside the process, in MB of 10^6
  bytes. The poller starts the example, then until it exits refreshes the
  process, keeps the largest value read, runs one `Win32_OperatingSystem` CIM
  query for its free-memory stop, and sleeps 20 ms; one pass therefore takes
  20 ms plus the query. Because the counter is a peak, polling speed only
  decides whether a read lands after the peak and before the exit; the LTQ
  Velos runs (about 0.1 s) ended first, and read 4.6 and 2.3 MB.
- The profile full-extent pass took 3,652 and 3,768 ms in the two recorded
  runs and 3,519, 4,444 and 3,689 ms in three more runs of the same build,
  alternated with another build for an A/B check and copied from the console:
  3,519–4,444 ms over five runs.
- A full profile pass costs about 1.3–1.6 ms per MS1 spectrum of about 9,000
  points (decode and parse); a centroid pass about 0.22–0.24 ms per spectrum
  of about 630 points. Time scales with the MS1 points in the window, not the
  file size.
- Memory is one raster, one spectrum and the table. On the two files with the
  same 43,878 rows, the peak stayed at 36–37 MB though one stores 14 times the
  points of the other; the table grows with the number of spectra.
- Not measured: a multi-GB file, a cold cache, the desktop's IPC and drawing.

## Alternatives

- **Sum per cell.** It counts how the spectra were stored as much as the
  signal: about 14 profile samples per centroid on the measured run, and more
  samples per cell at low m/z (decision 3). It would mean something for
  centroid data only, and one rule for both is simpler to state. Kept as an
  open question.
- **Mean per cell.** It depends on how many zero-intensity samples share the
  cell, which is again sampling.
- **Sending arrays and binning in the webview.** Refused by AGENTS.md: a profile
  run is about 25 million points.
- **A cached full-resolution raster resampled on zoom.** A zoomed view would
  then be a resampling of a reduction, not the source; and a fine enough cache
  costs more memory than the pass. Recompute instead; a cache can be added later
  under ADR 0060's pattern if multi-GB files need it.
- **A second, decoding streaming mode in the reader.** One pass with the
  selected read at each offset was measured fast enough, reuses every check
  unchanged, and leaves the reader untouched while other work changes it.
- **A first pass to find the m/z extent** when spectra do not state it. It
  doubles the cost of the first view. Kept as an open question.
- **Embedding a PNG in the SVG figure.** Smaller files, but `resvg` is built
  without raster-image support, so it is a dependency feature change needing
  approval, and it ends what ADR 0030 records, that the figure embeds no
  bitmap. Kept as an open question.
- **Mapping profile and centroid spectra together** (what slice 1's library
  does now). Simple, and the counts are stated, but the values compare only
  where a centroid's intensity is a peak height: on the LTQ Velos conversion
  the two differ by about a decade (decision 3). Kept as open question 7.
- **Refusing a mix of profile and centroid spectra.** Safe, but a file such as
  the LTQ Velos conversion would have no map; one map per representation shows
  both. Kept as open question 7.

## Consequences

- The map is a Track A view: it needs no backend and no Python runtime.
- A polarity-switching file maps both polarities together until the polarity
  follow-up, and says so.
- A numpress file has no map.
- Until open questions 7 and 8 are answered, slice 1's library maps profile and
  centroid MS1 spectra, and zoom or SIM scans, with the full scans, and states
  only the representation counts.
- A zoom on m/z alone costs as much as the window's full pass.
- The figure needs a plot-spec schema step (slice 3).

## Open questions for the owner

1. **Cell rule:** greatest intensity per cell (recommended), or sum.
2. **Colour scale:** log10 only (recommended), or a user-chosen linear scale
   beside it.
3. **Exported figure:** a vector cell grid with merged runs (recommended), or
   an embedded bitmap with `resvg`'s raster feature (a dependency feature
   change).
4. **First m/z range when spectra do not state it:** the user enters one, with
   the reason stated (recommended), or an extra pass finds it.
5. **Polarity after `be/reader-meta`:** one map per polarity, refusing a file
   where only some MS1 spectra declare one (recommended), or a map that admits
   undeclared spectra beside one declared polarity.
6. **The map pass and ADR 0057's native-read lane:** the pass runs on its own
   worker, one at a time, beside selected-spectrum reads (recommended; this
   amends ADR 0057), or it takes the lane and selected spectra wait for it.
7. **Profile and centroid in one file:** one map per representation, refusing
   a file where only some MS1 spectra declare one, as for polarity
   (recommended); or refuse any mix; or map both together, as slice 1 does, with
   the counts stated. On the LTQ Velos conversion the two differ by about a
   decade (decision 3).
8. **Zoom and SIM scans:** the reader learns to report the scan type or scan
   window, and the map leaves narrow-window MS1 scans out and states how many
   (recommended); or they stay mapped with the full scans, as in slice 1, where
   each fills one row only inside its window (decision 1).
