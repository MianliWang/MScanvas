# M4.0 — Figure renderer selection: evidence

What [ADR 0028](../architecture/adr/0028-figure-renderer-and-semantic-specification.md)
rests on. Observations first; the conclusions are in the ADR.

## Machine and runtime

Every number below was produced on one machine, and several of them say more
about that machine than about any renderer.

| | |
| --- | --- |
| CPU | 12th Gen Intel Core i7-12700H, 14 cores / 20 threads |
| RAM | 31.7 GB |
| OS | Windows 11 (10.0.26200) |
| rustc / cargo | 1.97.1 / 1.97.1, `--release` |
| Node / pnpm | v22.15.1 / 11.15.1 |
| Frontend harness | vitest 4.1.10, jsdom 29 |

## Harnesses

Two, because the decision has two halves and neither harness can see the other's.

- `crates/plot-spec/examples/figure_renderer_evidence.rs` — the export half.
  `cargo run --release -p mscanvas-plot-spec --example figure_renderer_evidence`
- `apps/desktop/src/test/figureRenderer.bench.ts` — the screen half.
  `pnpm --filter @mscanvas/desktop exec vitest bench --run`

Both generate their scenes from the same linear congruential sequence
(`state = state * 1664525 + 1013904223`, seeded per scene), so the two measure
the same points rather than two similar-looking clouds. No scene is read from
disk; nothing here is anybody's data.

The screen harness is collected by `vitest bench`, not by `pnpm test`, so it
does not run in CI.

**Two limits of the frontend harness, stated because they bound what it proves.**
jsdom lays nothing out and rasterizes nothing, so every screen duration below is
the cost of *producing* a scene rather than of painting one. And jsdom has no
Canvas2D implementation, so a canvas candidate could not be timed here at all —
which is why the canvas question is answered architecturally rather than by
measurement.

## Scenes

| scene | points | shape |
| --- | ---: | --- |
| `chromatogram-100k` | 100,000 | baseline drift plus three eluting peaks, per-point noise |
| `profile-dense-60k` | 60,000 | 14 isotope clusters, baseline dipping below zero |
| `centroid-dense-20k` | 20,000 | sparse discrete peaks on an irregular axis |
| `transfer-bound-500k` | 500,000 | the current `MAX_SPECTRUM_POINTS` selection bound |

Edge scenes: empty, single-point, flat, all-negative, all-zero. Long-but-bounded
labels are covered by the contract's own bound (120 characters) and its tests.

## Screen half — the stick renderer over each point shape

The real `StickSpectrum` rendered to markup, not a re-implementation of it.

**What this table is and is not.** `StickSpectrum` is the only screen renderer
this product has, and it draws sticks for every input: it takes no plot kind and
no representation, only a boolean that selects a caption sentence. So these rows
are one renderer measured against four point shapes, **not four screen rendering
modes**. The `chromatogram-100k` row says what 100,000 ordered points cost that
renderer; it does **not** say what a chromatogram screen path costs, because no
continuous-trace screen renderer exists. Nor does the screen consume the new
semantic contract — see *What this milestone did not measure*.

| scene | source | markup bytes | DOM elements | `<path>` nodes | drawn sticks | render mean | render p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| chromatogram-100k | 100,000 | 19,757 | 10 | **1** | 900 | 3.75 ms | 4.96 ms |
| profile-dense-60k | 60,000 | 20,794 | 11 | **1** | 941 | 2.64 ms | 3.68 ms |
| centroid-dense-20k | 20,000 | 19,489 | 10 | **1** | 900 | 1.74 ms | 2.93 ms |
| transfer-bound-500k | 500,000 | 20,802 | 11 | **1** | 942 | 14.50 ms | 29.60 ms |

The load-bearing column is not the time. **Node count is constant at 10–11
elements and exactly one `<path>` regardless of source size**, because the
component reduces to at most 900 columns and emits every stick into a single
path. A 500,000-point spectrum and a 20,000-point one cost the DOM the same.

Pointer lookup against the **source** domain — a binary search, not a scan of
the drawn sample — over a 200-probe sweep:

| scene | mean per sweep | per probe |
| --- | ---: | ---: |
| chromatogram-100k | 0.0190 ms | ~95 ns |
| transfer-bound-500k | 0.0227 ms | ~114 ns |

Both tables come from the same benchmark run. The lookup is a lower-bound
binary search **plus a comparison against the preceding sample**: the bound
alone is not the nearest point on an irregular m/z axis — for samples at 0 and
10 with the cursor at 1, the bound is 10 — and timing the bound while
documenting the nearest would have measured a different lookup from the one
described.

Lookup cost is flat across a 5× difference in source size, which is what a
binary search should give and what a lookup against the drawn sample would not
have needed — but a lookup against the drawn sample would answer with a point
the reduction happened to keep rather than the measured point nearest the
cursor.

## Export half — candidate A, serialize the mounted DOM

The option a reader would reasonably expect to win: the drawing already exists,
so why render it twice? Measured on `transfer-bound-500k`:

```text
serialized_bytes      = 20234
source_points         = 500000
exported_points       = 942
exports_full_source   = false
carries_app_classes   = true
carries_own_colour    = false
has_explicit_size     = false
has_title_or_desc     = false
needs_mounted_tree    = true
```

**It exports 942 of 500,000 points — 0.19% — and says nothing about having done
so.** It carries the application's class names and no colour of its own, so the
file renders with default strokes anywhere but inside this application. It
declares no width or height, carries no accessible title or description, and
cannot be produced at all without a mounted React tree.

## Export half — candidate B, Rust renderer over the semantic contract

`FigureSpec` → SVG, in `cargo test`, with no DOM and no window.

Full source, exported whole:

| scene | source | SVG bytes | SVG elements | `<text>` nodes |
| --- | ---: | ---: | ---: | ---: |
| chromatogram-100k | 100,000 | 1,614,222 | 12 | 5 |
| profile-dense-60k | 60,000 | 969,545 | 13 | 6 |
| centroid-dense-20k | 20,000 | 484,129 | 12 | 5 |
| transfer-bound-500k | 500,000 | 8,066,281 | 13 | 6 |

The same scenes reduced to 900 columns and exported *as a reduction* — here
under `MinMaxPerColumn`, the greatest and the least value of each column
whatever their signs, which is **not** the rule the screen table above used:

| scene | source | drawn | SVG bytes |
| --- | ---: | ---: | ---: |
| chromatogram-100k | 100,000 | 1,800 | 30,758 |
| profile-dense-60k | 60,000 | 1,800 | 30,967 |
| centroid-dense-20k | 20,000 | 1,800 | 45,100 |
| transfer-bound-500k | 500,000 | 1,800 | 30,945 |

Two per column in every row, because these scenes have no column so flat that
its greatest and its least value are the same point. The screen's rows drew
900–942 from the same sources under `ExtremePerSignPerColumn`, which keeps the
greatest non-negative and the deepest negative and therefore keeps **one** value for
an all-positive column. Both reductions are defensible; they are not the same
reduction, and the contract names which one a figure used — see *Two reduction
rules, named apart*.

A full-range export of the 500k scene is **261× larger** than the reduction of
it (8,066,281 vs 30,945 bytes). That ratio is the difference candidate A silently
elided.

Reduction cost alone, without rendering: 217 µs (20k) to 2.30 ms (500k).

### Two reduction rules, named apart

The screen table and the export table above reduce the *same* sources to
different counts, and that is the finding, not a discrepancy:

| rule | what it keeps | all-non-negative column | these four scenes |
| --- | --- | --- | ---: |
| `MinMaxPerColumn` | greatest and least value, whatever the sign | 2 points | 1,800 drawn |
| `ExtremePerSignPerColumn` | greatest non-negative, deepest negative | **1** point | 900–942 drawn |

`StickSpectrum` performs the second — and said the first in its `<figcaption>`
until this milestone corrected it. That sentence is the screen's own disclosure
to a user, so leaving it claiming both extrema of every column survived would
have been the same defect this section exists to describe, in the one place a
user actually reads. The reduction itself is unchanged; only the description of
it was wrong. [ADR 0005](../architecture/adr/0005-mzml-preview-boundary.md) is
corrected to match.

Raw intensity is nonnegative almost
everywhere, so under that rule most columns contribute a single stick — which is
why the screen's counts sit just above 900 rather than at 1,800, and why the two
scenes carrying negative baseline (`profile-dense-60k`, `transfer-bound-500k`)
reach 941 and 942 while the two that do not stay at exactly 900.

The contract therefore names both rather than folding them into one label. The
renderer writes the rule into the exported `<desc>` in words, so a figure reduced
per-sign but tagged min/max would state, in the file a reader receives, that both
extremes of every column survived when for most columns only one did. A test
requires the two descriptions to differ and requires the per-sign one never to
claim "greatest and the least value".

Both rules keep signal of both signs wherever both are present. Neither is
"safer"; they answer different questions, and the figure says which was asked.

Every count above is exact and reproduced identically on every run. **The
timings are not.** Across four runs under varying machine load:

| scene | render median, observed range |
| --- | --- |
| chromatogram-100k | 32.0 ms – 113.3 ms |
| transfer-bound-500k | 166.3 ms – 771.1 ms |

The byte counts were byte-identical in all four runs (`1,614,222` and
`8,066,281` every time) while the timings moved by up to 4.6×. These are
order-of-magnitude facts about one loaded laptop, not a product guarantee, and
they are the reason timing alone did not choose the renderer.

Peak working set of the whole harness process — four scenes resident, including
the 500k one, plus an 8 MB output string: **46 MB**.

Edge scenes, all five:

```text
empty          svg_bytes=  1692  elements=11  finite_only=true chrome_free=true external_free=true
single-point   svg_bytes=  1716  elements=12  finite_only=true chrome_free=true external_free=true
flat           svg_bytes= 24805  elements=12  finite_only=true chrome_free=true external_free=true
all-negative   svg_bytes= 24919  elements=13  finite_only=true chrome_free=true external_free=true
all-zero       svg_bytes= 33964  elements=12  finite_only=true chrome_free=true external_free=true
```

`all-zero` is the largest of the five and that is the point: a measured zero
draws a short mark on the zero line rather than a stick of no length, so a
peakless spectrum is visibly different from a spectrum with no points. The
marks have no height, so they claim no intensity; the description says
`Every drawn value is zero.` as well.

The `empty` scene is the smallest and now says why it is: its one series
discloses, by name, that it carries no points and that nothing is drawn for it,
rather than producing a figure whose blank plotting area could equally mean an
empty source, a window between two peaks, or a renderer that failed. It is two
bytes shorter than it was when that disclosure was written for the panel rather
than for the series — the only measured number in this document the per-series
disclosure moved.

`external_free` deliberately does not look for `http://`. The SVG namespace
declaration is required by the format and fetches nothing; what would make a
figure depend on the outside world is a `href`, a `url(...)` or an `<image>`,
and those are what is checked.

Determinism:

```text
byte-identical across two renders:                    true
round-trips through JSON and renders identically:     true
figure json bytes (500k scene):                       3,244,904
```

### What the semantic gate refuses, measured

The contract refuses a stick panel whose value range does not contain zero. That
rule is worth a measurement rather than an assertion, because the figure it
prevents renders without complaint. With the check removed, a centroid panel
declared over `500 .. 9000` and rendered:

```text
PROBE accepted = true
PROBE path = M227.200 410.000V410.000  M553.600 410.000V229.000  M716.800 410.000V48.000
PROBE stick length = 0.000
PROBE stick length = 181.000
PROBE stick length = 362.000
```

The peak at 500 — 5.6% of the range top — drew a stick **0.000 units long**, so
it was not in the figure at all. The peak at 4,750, 52.8% of the top, drew 181 of
the 362 available units: exactly half, which is its distance from 500 rather than
its magnitude. Every length in that figure meant something other than what a
reader would take it to mean, and nothing in the output said so.

Widening the range inside the renderer was the alternative and was rejected: the
axis text would then have disagreed with the drawing. A trace is exempt — it is
a shape over the axis, and a range excluding zero merely zooms it. The exemption
has its own cost, paid separately: a zoomed trace must print its non-zero lower
end, or the horizontal line at the bottom edge reads as a zero line and every
height on the figure reads as larger than it is.

### What the harness itself got wrong, and what it cost

The reduction harness derived each figure's `full_domain` from the points the
reduction retained. A reduction keeps each column's extremes, and the first
sample of a scene is not usually one of them, so the axis was quietly narrower
than the source the same series claimed — through `DataScope::Reduced` — to
stand for. Measured across the four scenes:

| scene | source domain | retained | cropped |
| --- | --- | --- | ---: |
| chromatogram-100k | 0.0000 – 29.9997 | 0.0102 – 29.9856 | 0.0102 + 0.0141 |
| profile-dense-60k | 200.000 – 1999.970 | 200.510 – 1999.310 | 0.510 + 0.660 |
| centroid-dense-20k | 150.165 – 2154.731 | 151.716 – 2153.201 | 1.551 + 1.530 |
| transfer-bound-500k | 200.000 – 1999.996 | 200.979 – 1999.356 | 0.979 + 0.641 |

At most 0.15% of an axis, and entirely beside the point: the harness was
producing the exact figure this contract exists to make impossible, and
measuring it. It passes the source domain explicitly now.

### Two ways `NaN` reached a document that promises it cannot

The renderer's `coordinate` helper documents that the specification has already
refused non-finite values. Both of these produced `NaN` in the output anyway,
and both were measured before being closed:

```text
PROBE domain span = inf
PROBE trace path = M64.000 373.800LNaN 84.200
PROBE document holds NaN = true
PROBE marker line = <line x1="NaN" y1="48.000" x2="NaN" y2="410.000" ... />
PROBE marker document holds NaN = true
```

The first is `Domain::new(-f64::MAX, f64::MAX)`: two finite ends whose
difference is infinity, so `project` computes `inf / inf`. Two finite checks are
not one finite domain, and the span is checked now.

The second is a marker position written through a public field after the figure
was validated. `render` does not revalidate, and both of its domain comparisons
are false for `NaN`, so the marker was neither skipped nor drawable. Every field
that carries a validated invariant is `pub(crate)` now, with public read
accessors — so a downstream reader loses nothing and a downstream writer cannot
exist. `PanelSpec::with_markers` validates as well; a second constructor that
skipped the check is how a rule gets added in one place and bypassed in another.

## Export half — candidate C, Observable Plot 0.6.17

Installed as a development dependency, measured, and removed. The published
research on this library's determinism was checked rather than accepted, and the
measurement is more precise than the claim.

```text
render 1 === render 2 : true          # unclipped output IS byte-deterministic
render 1 === render 3 : true
clipped render A === B : false        # clipped output is NOT
clip ids A: ["plot-clip-1"]
clip ids B: ["plot-clip-2"]
devicePixelRatio: 1
first translate() seen: translate(0,0.5)
has viewBox        : true
has explicit width : true
has <title>/<desc> : false
carries <style>    : true
carries class=     : true
real <text> nodes  : 21
```

Three findings, in order of weight:

1. **Clipped plots are not reproducible.** Clip-path identifiers come from a
   module-level counter, so the same figure rendered twice in one process
   differs. A visible-domain figure is exactly a clipped plot, so this is not a
   corner of the library this product would avoid.
2. **Coordinates depend on the host.** The half-pixel offset resolved to
   `translate(0,0.5)` here at `devicePixelRatio = 1`; it resolves to `0` on a
   HiDPI display. On-screen and headless output can therefore disagree.
3. **No accessible metadata by default** — neither `<title>` nor `<desc>`.

The blanket claim "Observable Plot is non-deterministic" would have been wrong:
its simple output is byte-stable. The precise claim is that it stops being so at
exactly the feature this product needs.

Bundle cost, measured in this application with real tree-shaking — a temporary
module importing `Plot.plot` and `Plot.line` was referenced from the real entry
point, built, and reverted:

| | raw | gzip |
| --- | ---: | ---: |
| baseline | 294.45 kB | 87.59 kB |
| with Observable Plot | 553.63 kB | 174.46 kB |
| **delta** | **+259.18 kB** | **+86.87 kB (+99.2%)** |

Adding it would have almost exactly doubled the shipped JavaScript.

After removal, the build reproduced the baseline byte-for-byte, down to the
content hash (`index-CaZgkuxK.js`, 294.45 kB / 87.59 kB gzip). `package.json`
and `pnpm-lock.yaml` returned to their committed state.

## Candidates excluded before measurement

Each was excluded on a fact that no timing could have changed.

| candidate | fact | source |
| --- | --- | --- |
| **uPlot** 1.6.32, MIT | Canvas-only. Zero SVG code path — no `createElementNS` anywhere in `dist/uPlot.esm.js`; export is `canvas.toDataURL()`, a bitmap. Cannot produce vector output at all. | package source |
| **Chart.js** 4.5.1, MIT | Canvas-only; SVG output declined by maintainers across three issues. | project issues |
| **Plotly.js** 3.7.0, MIT | 373 kB gzip for the *basic* build; any WebGL trace — which is what 100k points would use — exports as embedded raster rather than vectors. | project docs |
| **ECharts** 6.1.0, Apache-2.0 | The only surveyed library with a genuine DOM-free SVG SSR path, but ids come from module-level counters and animation is on by default; `echarts.simple` is 169 kB gzip, ~1.9× the entire current bundle. | package types and source |
| **Recharts** 3.10.1, MIT / **Victory** 37.3.6, MIT / **visx** 4.0.0, MIT | All React-DOM-coupled: the chart's identity is React state, so export means rendering the component tree. That is candidate A with a dependency attached. | package manifests |
| **d3-scale / d3-shape / d3-array** (ISC) | Not a renderer — DOM-free scale and path-string helpers, ~10 kB gzip tree-shaken. Not excluded on merit; simply not needed, since the accepted architecture's export renderer is in Rust and its screen renderer already computes its own scales. Worth reconsidering if the screen ever needs log/time scales. | package source |

## PNG path for M4.1

Verified against crates.io rather than quoted:

```text
resvg: version=0.48.1  license=Apache-2.0 OR MIT  published=2026-08-02
usvg:  version=0.48.1  license=Apache-2.0 OR MIT  published=2026-08-02
```

`resvg` relicensed from MPL-2.0 to Apache-2.0/MIT at 0.45.0 when Linebender took
stewardship, so the Rust path is permissively licensed. It uses no system
libraries for text — shaping is `rustybuzz`, parsing is `ttf-parser`, lookup is
`fontdb` — and its README claims pixel-identical output across platforms.
Determinism requires supplying font bytes via `load_font_data()` rather than
`load_system_fonts()`.

The alternatives are worse on licence or determinism, and both are avoidable by
calling the Rust crate rather than a Node binding:

- `@resvg/resvg-js` — **MPL-2.0**; the binding did not follow the crate's
  relicense.
- `sharp` — prebuilt binaries are **LGPL-3.0-or-later**; SVG text is resolved by
  fontconfig against host fonts, so output varies by machine.
- Browser `canvas.drawImage` — non-deterministic by construction: Tauri v2 uses
  WebView2 on Windows, WKWebView on macOS and WebKitGTK on Linux, each with its
  own rasterizer and hinting. Cannot run in headless tests.

No dependency was added for this. It is a documented plan, not an implementation.

## What this milestone did not measure

- **Painted frame cost.** jsdom rasterizes nothing. Whether a 900-stick path
  paints acceptably in WebView2 is unmeasured here; the current screen already
  ships that path, so it is an existing property rather than a new risk.
- **Canvas2D.** Not measurable in this harness. Excluded architecturally, not
  empirically.
- **Interaction under sustained pointer movement.** Lookup cost was measured;
  React re-render cost under a moving pointer was not, because no linked
  selection exists yet to drive.
- **A real mzML spectrum.** The scenes are synthetic. The existing preview path
  already reads real files, but no lawful fixture was needed to decide a question
  about renderers, and none was tracked.
- **A 24-panel figure.** `MAX_PANELS` is 8 and one panel is what the contract is
  exercised with; the panel-stacking arithmetic is general but only proved at
  one.
- **A continuous-trace screen renderer.** None exists. `StickSpectrum` draws
  sticks for every input, so the screen half of the selected architecture is
  proved only for discrete marks. The Rust export renderer draws and tests both
  modes, which is where the joined-trace rule is currently held.
- **The screen consuming `FigureSpec`.** It does not, by decision. Wiring it is
  a visible-behaviour change to a shipped component, and this milestone's remit
  was to select and prove a foundation without risking that. The screen and the
  contract already agree on the facts that matter — reduction keeps both extrema
  per column, an unreported representation is stated as unreported, negative
  intensity is preserved — but they agree by both being right, not yet by
  sharing a type. Closing that gap is the first thing M4.1 does.
