# ADR 0068 — The RT × m/z map

Status: **Accepted** 2026-11-03, proposed 2026-10-30. The owner answered its
eight questions as MAP-1.2 to MAP-1.9, all as recommended, in decision table
version 2026-11-03.2: see
[Owner decision, 2026-11-03](#owner-decision-2026-11-03). Slice 1, the library,
is implemented in `crates/proteowizard/src/rt_mz_map.rs`, with one map per
polarity and per representation; no command, screen or export uses it. MAP-1.9
is decided and not built yet (decision 1). ADR 0070's table of records still
lists this record as Proposed; that row changes in its own commit, after the
second records PR.
Related: [0005](0005-mzml-preview-boundary.md),
[0028](0028-figure-renderer-and-semantic-specification.md),
[0030](0030-png-copy-plot-and-figure-settings.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md),
[0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md),
[0070](0070-computation-over-decoded-arrays.md).
Evidence: the measurement [below](#evidence), made with
`crates/proteowizard/examples/rt_mz_map_evidence.rs` on public files.

## Context

The owner wants v5.11's two-dimensional feature distribution: one picture of a
run, retention time across and m/z up, coloured by intensity. The analysis
research of 2026-10-30 put it on the track that needs no Python runtime, as
"a Rust-binned raster from a streaming MS1 pass", and asked that it be
measured on real files first.

Five records constrain it:

- **ADR 0056, decision 7.** The project-owned reader decodes; "any computation
  over the decoded arrays is an algorithm, and it needs its own record". This
  ADR is that record for the map, and its scope is its limit.
- **ADR 0070 (U7, 2026-10-30).** The umbrella: computations over the decoded
  arrays are admitted, one record each, and a bounded, cancellable pass may run
  and keep only its result. It admits nothing by itself.
- **ADR 0028.** Screen and export share one semantic specification; a
  reduction says what it dropped; the export is not the screen's reduction.
- **ADR 0030.** It records as a fact, not a rule, that the figure this
  application produces embeds no bitmap, which is why `resvg` is built without
  its `raster-images` feature.
- **AGENTS.md.** Large scientific arrays do not travel through React state. No
  implicit centroiding, no fallback.

The reader reads one selected spectrum per call and refuses typed. Since #182
its table row reports each spectrum's polarity. It states no scan type yet.

## Decisions

### 1. What the map shows

- **MS1 spectra only.** A spectrum is MS1 when the reader's MS level is 1.
  MS2 and higher are never read for the map.
- **Narrow-window scans stay out, and their count is stated (MAP-1.9). Not built
  yet.** The reader will report the scan type, and the map will leave those
  spectra out and count them in the result.
  - Until then the library still maps a zoom or SIM scan with the full scans of
    its representation, because the project-owned reader's table row states no
    scan type or filter. The LTQ Velos file's 29 profile MS1 spectra are 15 full
    scans of m/z 300–2000 and 14 zoom scans (MS:1000497), each of a 10 m/z
    window between 297 and 683; a zoom scan's row holds values only in its
    window.
  - Which spectra are narrow (a reading, not an owner decision, 2026-11-04): a
    spectrum that declares `zoom scan` (MS:1000497) or `SIM spectrum`
    (MS:1000582). No width threshold is set, and a numeric definition of narrow
    is not decided.
- **Each cell holds the greatest stored intensity** (MAP-1.2) of the points that
  fall in it (maximum, not sum). The caption, the legend and the data document say
  "greatest intensity per cell". Why not a sum: see decision 3.
- **An empty cell is not zero.** A cell no point fell in has no value and is
  drawn as the background. A measured zero is a value, and so is a negative
  intensity, which is kept (ADR 0028).
- **Colour scale: log10 only, stated in the legend (MAP-1.3).** Stored values
  stay linear; only the colour mapping is logarithmic, because a run's MS1
  intensities span many decades and a linear scale shows only the base peaks.
  Cells holding zero or a negative value cannot be placed on a log scale; they
  take one stated "≤ 0" colour, distinct from the background.
- **One map per polarity (MAP-1.6).**
  - A map is of one polarity, read from the table row (#182). A file whose MS1
    spectra declare both is mapped once per polarity: `ms1_extent` reports the
    maps a table has, and the request names the one it wants.
  - A file where only some MS1 spectra declare a polarity has no map: it is
    refused (`partly_declared_polarity`), as mixed retention-time units are
    (decision 4). The check covers every MS1 spectrum of the file, not the
    window.
  - A file where no MS1 spectrum declares one does not separate by polarity, even
    if it switches, and each of its maps states "polarity not reported"; it still
    has one map per representation. That is a known risk, stated on the figure (as built
    2026-11-04, not an owner decision: MAP-1.6 does not answer this case).
  - A polarity stated two ways or unreadably is not reported, which is the
    reader's rule (#182), so it counts as not declared here (as built 2026-11-04,
    not an owner decision).
- **Nothing else is drawn.** No smoothing, interpolation, centroiding, noise
  floor or feature detection. Feature markers on the map come later from
  analysis artifacts, never from the binner.

### 2. How it is computed

- **From the open's spectrum table.** The map needs the dataset's retained
  preview state (ADR 0056, decision 4), as a selected spectrum does. The table
  says which spectra are MS1, where they are, their polarity, representation and
  retention times, before any array is read. Every refusal of the open therefore
  stands in front of the map.
- **One forward pass, one handle.** The pass opens the file once, walks the
  map's rows of the table in file order, and reads each one with the reader's
  selected read at its recorded offset. Each spectrum is therefore checked
  against the table (index and native ID) and decoded under ADR 0056's caps and
  refusals, and the binner decodes nothing itself. The handle is closed when the
  pass ends, is cancelled or fails. ADR 0056's "no read holds a file handle" holds
  with the pass counted as one read.
- **Only the map's window is read.** A spectrum of another map, or whose
  retention time is outside the view, is not read. Zooming in on retention time
  costs fewer spectra; zooming in on m/z alone costs the same spectra as the
  window.
- **Binning in Rust, bounded memory.** The pass holds the raster, one decoded
  spectrum at a time (at most ADR 0056's 128 MiB decode cap) and the open's
  table, which already exists. Measured peak working set: 36–37 MB (Evidence).
- **A raster of bounded size per view.**
  - Equal-width bins across each axis. A bin is half-open, `[edge, next edge)`,
    except the last, which also holds the view's upper bound.
  - At most 2^21 cells (`MAX_MAP_CELLS`, 16 MiB of `f64`). The caller picks the
    bin counts from the view's size in device pixels.
  - More retention-time bins than MS1 spectra in the window leave rows empty:
    the measured middle tenth puts 192 spectra in 1,024 bins. Empty rows are
    drawn as the background, never interpolated (decision 1). Whether the
    desktop caps the retention-time bins at the window's MS1 count is left to
    slices 2 and 3 (analysis-ms1-map); it is still open.
  - Bounds must be finite with a finite, positive width, and a bin non-zero and
    at least 4·ε times the larger bound's magnitude wide (`f64::EPSILON`; four
    to eight units in the last place), so every bin has width; anything else is
    refused before any spectrum is read. The map keeps the requested bounds
    exactly (`RtMzMap::request`).
- **Recomputed per view, within bounds.** A zoom or pan is a new pass over the
  source for the new window, never a resampling of the previous raster.
- **Never the arrays.** Only the raster crosses to the webview, as one bounded
  value per cell. Decoded arrays stay in the pass and are dropped spectrum by
  spectrum.
- **Where the raster is kept (2026-11-04, ADR 0070 decision 3's item 7; as built,
  not an owner decision).** The library returns it to the caller and keeps nothing,
  so it ends when the caller drops it. Where the desktop keeps it and when that ends
  is not stated here. Slice 2 owes that sentence to this record.
- **The first view.** Retention time spans the lowest to the highest retention
  time of the map's spectra. m/z spans the lowest and highest observed m/z they
  state (MS:1000528, MS:1000527), when every one of them states both. That is a
  selection from read values (`ms1_extent`). Each map has its own ranges (as
  built 2026-11-04, not an owner decision).
- **A map whose spectra share one retention time,** such as a file's only
  centroid MS1 spectrum, has no first view: its retention-time range is empty, and
  a request over it is refused (`map_bounds_invalid`). What the screen does then
  belongs to analysis-ms1-map (as built 2026-11-04, not an owner decision).
- **When the spectra do not state an m/z range (MAP-1.5),** the map has no first
  m/z range: the user enters one, and the reason is stated. No extra pass finds
  it.
- **Points outside the m/z range are counted and stated.** On all three
  measured files the stated observed range left a few points outside it (1, 1
  and 16 points; the 16 are all in the LTQ Velos file's profile map), so the
  first view says how many points it does not show.

### 3. Profile and centroid

- **Both are binned by one rule, as stored.** A profile sample and a centroid
  peak are each one point with one intensity. Nothing converts one into the
  other, and nothing is centroided. A cell of a profile map holds the tallest
  stored sample, a cell of a centroid map the tallest stored peak, and a cell of
  a map that declares no representation the greatest stored value, whichever it
  is. None of them is an area.
- **Why the greatest value.** A sum adds every stored point in the cell, so it
  measures how the spectra were stored as much as the signal.
  - Over the same 2,748 MS1 scans of one run, the profile file's MS1 spectra
    store 24,766,276 points and its vendor-centroided conversion's 1,724,216:
    about 14 profile samples per centroid. Where the centroided map adds one
    peak, a sum over the profile map would add about 14 samples.
  - Sampling also changes with m/z and with the instrument. In the Orbitrap
    profile file's largest MS1 spectrum (23,308 points) the median spacing of
    adjacent samples is 0.0027 at m/z 400–500 (118 pairs), 0.0073 at 800–900
    and 0.0128 at 1200–1300, so a fixed-width cell holds about 4.7 times as
    many samples at low m/z. In the LTQ Velos ion-trap file's largest MS1
    spectrum (a full scan, 20,399 points) the spacing is 0.0833 in each of the
    same three ranges; each of its 14 zoom-scan MS1 spectra holds 500 points,
    and the one measured (m/z 447–457) is sampled at 0.020.
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
      profile sample over MS1 and MS2 (median 6.8 for MS1, 3.7 for MS2; its 29
      MS1 spectra include the zoom scans) and states that "the ion-trap vendor
      intensity is not an apex height". The LTQ Velos conversion measured
      here also holds 15 MS1 full scans acquired as centroid
      (`ITMS + c`). Each was paired with the profile full scan nearest in
      retention time (in this file always the next one, at most 0.0022 min
      later), and the greatest intensity in m/z 400–1400 taken from each: the
      centroid scan's is 6.39 to 24.03 times the profile scan's, median 11.07,
      over 15 pairs. On a log10 scale that is about one decade. Pairing each
      with the preceding full profile scan instead gives 5.86 to 17.72, median
      13.63, over 14 pairs. This comparison, the zoom-scan counts and windows
      and the zoom spacing were not made with the project's reader, which does
      not report scan type: `ltq_check.py`, a read-only Python standard-library
      decoder, and a `grep` of the filter strings made them (Evidence).
- **One map per representation (MAP-1.8).** A map is of one representation, as
  it is of one polarity (decision 1), and the declared representation is carried,
  not verified.
  - A file whose MS1 spectra hold both is mapped once per representation. The
    LTQ Velos conversion has one map of 29 profile spectra and one of 15 centroid
    spectra. Mapped together, as slice 1 did until 2026-11-04, adjacent profile
    and centroid rows would differ by about a decade, and a cell holding both
    would show the centroid value; either reads as a change in signal.
  - A file where only some MS1 spectra declare one has no map: it is refused
    (`partly_declared_representation`).
  - A file where no MS1 spectrum declares one does not separate by representation,
    and each of its maps states "representation not reported"; it still has one map
    per polarity (as built 2026-11-04, not an owner decision:
    MAP-1.8 does not answer this case).

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
partial raster. Nothing falls back to `msaccess` or another reader.

| Refusal | Stable identifier |
| --- | --- |
| A bound not finite, or a range empty, backwards, not finite or too narrow for its bins | `map_bounds_invalid` |
| An axis with no bins, or more than 2^21 cells | `map_bins_invalid` |
| The allocator refuses the raster | `allocation_refused` |
| The table has no MS1 spectrum | `no_ms1_spectra` |
| MS1 retention-time units differ | `mixed_retention_time_units` |
| Only some MS1 spectra declare a polarity (MAP-1.6) | `partly_declared_polarity` |
| Only some MS1 spectra declare a representation (MAP-1.8) | `partly_declared_representation` |
| The request names a map the table does not have (as built 2026-11-04, not an owner decision: an empty raster would read as "no signal") | `map_not_in_table` |
| Binned m/z or intensity units differ | `mixed_array_units` |
| The file cannot be opened | the reader's identifier |
| An MS1 spectrum in the window is refused by the reader | the reader's identifier, with the spectrum's index |
| Cancelled | `cancelled` |

- **One refused spectrum refuses the map.** A gap would read as "no signal".
  A file whose MS1 arrays are numpress-encoded therefore has no map, under the
  owner's 2026-10-29 decision that the viewer refuses numpress.
- A view whose window holds no spectrum of its map is not refused: it is a map
  with every cell empty and zero spectra, and says so.

### 6. Progress and cancel

- **Progress** is `(done, total)` after each spectrum, where `total` counts the
  map's spectra in the window. It is known before the first read, so the screen
  can show a determinate bar.
- **Cancel** is checked before each spectrum is read and once after the last,
  with the crate's `CancellationToken`, so a cancel heard during the last
  spectrum or before an empty window still counts. A cancelled pass returns
  `cancelled` and no raster.
- **The pass runs on its own worker, one at a time, beside selected-spectrum
  reads (MAP-1.7). Not built yet.** It does not hold ADR 0057's native-read lane,
  because a full pass takes seconds and would hold every selected spectrum behind
  it. Reads share no cursor (ADR 0056, decision 4), so this is safe. Bounding
  concurrent passes at one keeps memory at one raster and one spectrum. This
  amends ADR 0057's "at most one native read runs at a time" for the map pass;
  the amendment itself goes in ADR 0057, not here.
- **For the desktop slice (design of 2026-10-30, not implemented, not an owner
  decision):**
  - one map pass per session at a time; a new view of the same dataset cancels
    the running pass, and the newest view wins;
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
  colour; the representation, or "representation not reported"; polarity, or
  "polarity not reported"; retention-time, m/z and intensity units or "not
  reported"; points outside the m/z range; how many narrow-window scans were left
  out (MAP-1.9).
- **Drawing (MAP-1.4).** A new plot kind in the shared specification, a cell grid
  drawn as vector rectangles, with adjacent cells of one colour merged into one
  rectangle and the export's cell count capped, because many cells can make a
  large file. The figure then still embeds no bitmap, as ADR 0030 records it, and
  needs no dependency change. The cap's value is not decided here; it belongs to
  analysis-ms1-map.
  The plot kind is a plot-spec schema step with golden figures, in slice 3.
- **The data document** is the raster: each cell's two bin edges and its value,
  an empty cell as an empty field, with a preamble stating the rule, the units,
  the polarity, the representation and the window. It is a new format with its
  own version. It never contains the arrays; a spectrum's own export already
  does.
- **Both exports carry the same provenance (2026-11-04, ADR 0070 decision 3's items
  9 and 10, which the owner's answer of that day, A0070-Q1, makes part of each
  record's minimum; how these lines answer them is not an owner decision).** The data
  document's preamble and the figure's description also state the source and its
  generation; this record; the bounds and bin counts, kept exactly (shortest
  round-trip decimals, never rounded, in the caption too); the spectra
  used and those left out (the other maps', those beyond the window, the
  narrow-window scans), by count; and the points outside the m/z range. None is
  counted as refused, because a refused spectrum refuses the map (decision 5). The
  pass resolves no operand, so item 9's "as typed" and "as resolved" are one set of
  values here: the request's.
- **Both are written through the existing no-overwrite export path,** so an export
  never replaces a file.

### 8. What this record allows

This ADR is ADR 0056 decision 7's record, under ADR 0070's decision 1 (U7), for
one computation: the greatest stored intensity per cell of a bounded raster, as
a display projection. It is
not a scientific quantity, and it allows no other computation over the arrays:
no sum, XIC, summed spectrum, peak picking or feature detection.

### 9. Delivery

1. **Library, no command or interface.** Implemented:
   `crates/proteowizard/src/rt_mz_map.rs` (`ms1_extent`, `bin_rt_mz_map`,
   `bin_rt_mz_map_from`) with tests for the cell rule, bin edges, the window,
   maps of each polarity and representation, partly declared and undeclared
   files, empty and refused files, unit agreement, request checks, progress and
   cancellation; and the measurement below.
2. **Desktop command.** A narrow command over the retained preview state,
   with progress events, cancel and supersession (decision 6), returning the
   bounded raster.
3. **Screen and export.** The plot kind, the screen view, the figure and data
   exports (decision 7), and rendered QA.
4. **Polarity and representation** (MAP-1.6, MAP-1.8). In the library since
   2026-11-04; the reader's code did not change (decisions 1 and 3).
5. **Scan type** (MAP-1.9). Its own change, `be/map-scan-type`, after #207, merged
   2026-11-04, because #207 edits the reader: a small field on the table row, no array read
   for it, and no width threshold (decision 1). Not in R-1's scope; its effort
   is not estimated.

## Evidence

The table is the measurement of 2026-10-30, made when slice 1 still mapped profile
and centroid spectra together, so its LTQ Velos column is one raster of both. The
[rerun of 2026-11-04](#rerun-2026-11-04-one-map-per-polarity-and-representation)
gives each map's counts.

Release build of the example at commit `a8eae524`, two runs per file, on a
14-core, 20-thread Windows machine, 2026-10-30, warm cache (each file was
hashed just before its runs). Inputs are
public and not committed. Each column names its source, the ProteoWizard
build and argv that wrote it, and its digest; the local manifest under
`D:\tmp\public-data\` (items 2, 3a and 3b) holds the same. Every run's console
output and peak, the poller and the A/B record are in
`D:\tmp\public-data\map2d\`, listed in its `NOTES.md`, which also records
`ltq_check.py` (digest, command and output) and the zoom-scan `grep`. No
ProteoWizard program ran for this measurement.

| | Orbitrap MS1 profile | Orbitrap MS1 vendor-centroided | LTQ Velos, mixed |
| --- | --- | --- | --- |
| File | PXD081190 RAW → mzML ([source, build and argv](../../spikes/ADR0056_R0_REAL_FILE_COMPARISON.md#inputs)), 546,327,287 bytes, SHA-256 `82328655…de4fc3`, CC0 | [`TE1`](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md), 284,183,742 bytes, SHA-256 `4727d25e…540983`, CC0 | `msconvert` output of ProteoWizard's LTQ Velos test RAW (source, build and argv below), 5,060,221 bytes, SHA-256 `c72e2c8c…b63ec9`, from the Apache-2.0 ProteoWizard repository |
| Spectra, of which MS1 | 43,878; 2,748 profile | 43,878; 2,748 centroid | 85; 44 (29 profile: 15 full, 14 zoom; 15 centroid, acquired as centroid) |
| Table pass (exists after the open) | 3,937–4,180 ms | 3,575–4,422 ms | 9 ms |
| Full extent, 1,024 × 2,048 cells | 3,652–3,768 ms (3,519–4,444 ms over five runs, see below); 24,766,275 points binned; 726,465 cells hold a value | 598–654 ms; 1,724,215 points binned; 670,590 cells | 71–88 ms; 326,354 points binned; 43,894 cells |
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

### Rerun 2026-11-04: one map per polarity and representation

Release build of the example at commit `6ed6ccee`, on the same files by digest.
Other builds were running on the machine (about 49% CPU when sampled), so these
are counts, not timings: the times they print are not a measurement, and those
above stand. No ProteoWizard program ran. The table and map lines of the LTQ Velos
file's console output, verbatim, first run; the example's four lines on the largest
spectrum's m/z spacing, which follow them, are left out:

```text
table: 85 rows, 9 ms
map MapKind { polarity: Some(Positive), representation: Centroid }: 15 MS1 spectra, retention time (0.002538333333, 0.266686666667) Minute, m/z (400.500793457031, 1399.789672851563)
full: 15 spectra; 13385 points binned, 0 outside m/z; 13385 of 2097152 cells hold a value; 10 ms
zoomed: 1 spectra; 100 points binned, 867 outside m/z; 100 of 2097152 cells hold a value; 7 ms
map MapKind { polarity: Some(Positive), representation: Profile }: 29 MS1 spectra, retention time (0.004721666667, 0.268703333333) Minute, m/z (297.019999999553, 1999.94498642534)
full: 29 spectra; 312969 points binned, 16 outside m/z; 30857 of 2097152 cells hold a value; 171 ms
zoomed: 2 spectra; 2044 points binned, 18855 outside m/z; 2044 of 2097152 cells hold a value; 24 ms
```

- The two maps' binned points add up to the 326,354 of the one raster of
  2026-10-30, so nothing was lost by separating them.
- The profile map's 29 spectra still include the 14 zoom scans (decision 1).
- The Orbitrap files have one map each, and their full-extent counts did not
  change: positive profile, 2,748 spectra, 24,766,275 points, 726,465 cells;
  positive centroid (`TE1`), 2,748 spectra, 1,724,215 points, 670,590 cells.

## Alternatives

- **Sum per cell.** It counts how the spectra were stored as much as the
  signal: about 14 profile samples per centroid on the measured run, and more
  samples per cell at low m/z (decision 3). It would mean something for
  centroid data only, and one rule for both is simpler to state. Not chosen
  (MAP-1.2).
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
  doubles the cost of the first view. Not chosen (MAP-1.5).
- **Embedding a PNG in the SVG figure.** Smaller files, but `resvg` is built
  without raster-image support, so it is a dependency feature change needing
  approval, and it ends what ADR 0030 records, that the figure embeds no
  bitmap. Not chosen (MAP-1.4).
- **Mapping profile and centroid spectra together** (what slice 1's library
  did until 2026-11-04). Simple, and the counts are stated, but the values compare
  only where a centroid's intensity is a peak height: on the LTQ Velos conversion
  the two differ by about a decade (decision 3). Not chosen (MAP-1.8).
- **Refusing a mix of profile and centroid spectra.** Safe, but a file such as
  the LTQ Velos conversion would have no map; one map per representation shows
  both. Not chosen (MAP-1.8).

## Consequences

- The map is a Track A view: it needs no backend and no Python runtime.
- A file where only some MS1 spectra declare a polarity or a representation has
  no map.
- A file that declares no polarity does not separate by polarity, even if it
  switches, and each of its maps says "polarity not reported" (decision 1, as built
  2026-11-04, not an owner decision).
- A numpress file has no map.
- Until `be/map-scan-type` lands, the library maps zoom or SIM scans with the
  full scans of their representation and states nothing about them, so MAP-1.9
  is not met yet. analysis-ms1-map waits for it.
- A zoom on m/z alone costs as much as the window's full pass.
- The figure needs a plot-spec schema step (slice 3).

## Owner decision, 2026-11-03

**Decisions MAP-1.1 to MAP-1.9**, decision table version 2026-11-03.2. The owner
pasted the page's selections, ending "其余按推荐。" ("the rest as recommended").
None of these nine rows is among the owner's different picks, so each is its
recommended option. The eight questions below are MAP-1.2 to MAP-1.9, in order;
MAP-1.1 is the form of the map:

| Id | Answer | Cost stated with the option |
| --- | --- | --- |
| MAP-1.1 | Both forms, each as soon as it is ready; neither waits for the XIC or Python. This record is the MS1 map; the MS2 precursor map needs none | The two maps are easily confused and must be labelled clearly |
| MAP-1.2 | The greatest intensity per cell, stated in the caption | Weak signals in the same cell are hidden; on an ion trap, profile and centroid still cannot be compared |
| MAP-1.3 | log10 only, with one colour for values at or below 0 | Differences in strength look compressed; no linear scale for the base peak |
| MAP-1.4 | A vector cell grid with adjacent cells of one colour merged; no dependency change | With many cells the file can be large, so it needs a cap |
| MAP-1.5 | When spectra do not state an m/z range, the user enters one and the reason is stated | One more step on opening; a user who does not know the range may enter too narrow a one |
| MAP-1.6 | One map per polarity; a file where only some MS1 spectra declare one is refused | A partly declared file has no map |
| MAP-1.7 | The pass runs on its own worker, one at a time, beside selected-spectrum reads; this amends ADR 0057 | Two reads at once may slow each other on a slow disk (not measured) |
| MAP-1.8 | One map per representation; a file where only some declare one is refused | A partly declared file has no map |
| MAP-1.9 | The reader reports the scan type; narrow-window scans stay out of the map and their count is stated | Not in R-1's scope, effort not estimated; signals in narrow windows do not show on the map |

**Decision U7 (2026-10-30).** ADR 0070 is the umbrella. This record is ADR 0056
decision 7's record for this one computation, and its scope is its limit.

**What these answers do not decide:**

- ADR 0070's questions 1 and 2. The owner answered those on 2026-11-04, in the note
  below.
- A numeric definition of narrow (decision 1).
- The export's cell cap (MAP-1.4 asks for one and sets no value), the cap on
  retention-time bins (decision 2), the command, the plot kind and the screen:
  those belong to analysis-ms1-map.
- The rest of this record. The raster cap, the bin edges, the narrow-range
  refusal, how a file that declares no polarity or no representation maps (it does
  not separate by what it does not declare) and the desktop design in decision 6 are the design of 2026-10-30 and
  the library as built. The owner was not asked about them: not an owner decision.

*Owner decisions, 2026-11-04, on ADR 0070's two questions; its dated notes hold the
reply and what it leaves open.* A0070-Q1, option `minimum`: decision 3's list there
is the minimum each record states, so this record has to answer all eleven items
([its check](#adr-0070-decision-3s-list), which names the part it does not state
yet). A0070-Q2, option `with-code`: the two reader lines of
`crates/proteowizard/AGENTS.md` change together with a record's code. #207 changed
them for the XIC pass, and this record's slice names the map pass beside it and
keeps the closing rule that anything else stays forbidden.

**Written elsewhere, not here, and not yet on `main` on 2026-11-04:** ADR 0057's
amendment for the map pass (MAP-1.7) and ADR 0056 decision 1's dated widening for the
scan type (MAP-1.9). The answers' rows reached `main` with #212, in section 1d of
[the owner-decisions list](../../development/OWNER_DECISIONS_V511.md).

## ADR 0070 decision 3's list

Checked on 2026-11-04. That list is the minimum each record states: the owner's
answer to ADR 0070's question 1, 2026-11-04, A0070-Q1, option `minimum`. So following
it is no longer a reading. What stays a reading, not an owner decision, is this
table: that each row answers its item. It rests on one comparison of ADR 0070
decision 3's text with this record, made for #183; the decision page did not check
it item by item (ADR 0070, question 1). The owner's answer also leaves open whether
the fixed rules in items 2, 3 and 5 bind every record. This record states them as its
own decisions, so it does not depend on that. "Slice 2" and "slice 3" mark what this
record states and the library does not do yet, except item 7's last part, which this
record does not state yet.

| Item | Where this record answers it | Not built yet |
| --- | --- | --- |
| 1. Input | Decisions 1 and 2: MS1 spectra of one polarity and representation, by the table's offsets through the selected read; the open's refusals stand in front | Leaving narrow scans out (`be/map-scan-type`) |
| 2. Operands and bounds | Decisions 2, 5 and 7: a typed `MapRequest`, checked before any spectrum is read; the result keeps the bounds exactly | Stating them as shortest round-trip decimals in the caption and export, never rounded (slice 3) |
| 3. Units | Decision 4 | |
| 4. Profile and centroid | Decision 3 | |
| 5. No invented values | Decisions 1 and 5: an empty cell has no value, zero and negative values are kept, a spectrum that cannot be used refuses the whole map, and nothing falls back to `msaccess` or another reader | |
| 6. Arithmetic | Decision 1: the maximum of stored values as `f64`. ADR 0056's selected read widens each exactly or refuses it, and refuses a non-finite value, so none reaches a cell | |
| 7. Retention | Decision 2: at most 2^21 `f64` cells, returned to the caller, and the library keeps nothing; nothing is cached and no array outlives its spectrum's step. **Not stated yet:** where the desktop keeps the raster and when that ends, which slice 2 owes this record | The desktop's part, statement included (slice 2) |
| 8. Running | Decision 6: cancellation between spectra, and progress as spectra read out of the table's count, with no estimate of time | Supersession and the generation check (slice 2) |
| 9. Provenance | The result carries the map's polarity and representation, bounds, bins, units and counts of spectra and points. The pass resolves no operand, so the request is both as typed and as resolved. Spectra excluded: the other maps' counts, and the map's own beyond the window, from `ms1_extent`. Refused: none, because a refused spectrum refuses the map. Decision 7: both exports carry the same | The source, its generation and this record's name (slice 2); the count of narrow scans left out (`be/map-scan-type`); the exports (slice 3) |
| 10. Export | Decision 7, through the shared specification and the existing no-overwrite export path, with a data document that carries item 9. Decision 2: only the raster crosses to the webview, never the arrays | All of it (slice 3) |
| 11. Evidence | Evidence: time and memory on real files, release build, judged with no threshold set in advance. The tests' fixtures are hand-computed; `ltq_check.py` is an independent reference for the LTQ Velos counts it made | |

## Open questions for the owner

*Answered by the owner on 2026-11-03, each as recommended; see
[Owner decision, 2026-11-03](#owner-decision-2026-11-03). Their text is as it was
at `f92e71fc`, and each answer is in a dated note.*

1. **Cell rule:** greatest intensity per cell (recommended), or sum.
   *Answered 2026-11-03, MAP-1.2: greatest intensity per cell.*
2. **Colour scale:** log10 only (recommended), or a user-chosen linear scale
   beside it.
   *Answered 2026-11-03, MAP-1.3: log10 only.*
3. **Exported figure:** a vector cell grid with merged runs (recommended), or
   an embedded bitmap with `resvg`'s raster feature (a dependency feature
   change).
   *Answered 2026-11-03, MAP-1.4: a vector cell grid.*
4. **First m/z range when spectra do not state it:** the user enters one, with
   the reason stated (recommended), or an extra pass finds it.
   *Answered 2026-11-03, MAP-1.5: the user enters one.*
5. **Polarity after `be/reader-meta`:** one map per polarity, refusing a file
   where only some MS1 spectra declare one (recommended), or a map that admits
   undeclared spectra beside one declared polarity.
   *Answered 2026-11-03, MAP-1.6: one map per polarity. `be/reader-meta` merged as
   #182.*
6. **The map pass and ADR 0057's native-read lane:** the pass runs on its own
   worker, one at a time, beside selected-spectrum reads (recommended; this
   amends ADR 0057), or it takes the lane and selected spectra wait for it.
   *Answered 2026-11-03, MAP-1.7: its own worker.*
7. **Profile and centroid in one file:** one map per representation, refusing
   a file where only some MS1 spectra declare one, as for polarity
   (recommended); or refuse any mix; or map both together, as slice 1 does, with
   the counts stated. On the LTQ Velos conversion the two differ by about a
   decade (decision 3).
   *Answered 2026-11-03, MAP-1.8: one map per representation.*
8. **Zoom and SIM scans:** the reader learns to report the scan type or scan
   window, and the map leaves narrow-window MS1 scans out and states how many
   (recommended); or they stay mapped with the full scans, as in slice 1, where
   each fills one row only inside its window (decision 1).
   *Answered 2026-11-03, MAP-1.9: the reader reports the type; narrow-window scans
   stay out and are counted. Not built yet.*
