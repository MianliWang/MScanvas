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
| chromatogram-100k | 100,000 | 19,757 | 10 | **1** | 900 | 4.02 ms | 4.70 ms |
| profile-dense-60k | 60,000 | 20,794 | 11 | **1** | 941 | 2.65 ms | 3.85 ms |
| centroid-dense-20k | 20,000 | 19,489 | 10 | **1** | 900 | 1.75 ms | 2.44 ms |
| transfer-bound-500k | 500,000 | 20,802 | 11 | **1** | 942 | 13.39 ms | 16.20 ms |

The load-bearing column is not the time. **Node count is constant at 10–11
elements and exactly one `<path>` regardless of source size**, because the
component reduces to at most 900 columns and emits every stick into a single
path. A 500,000-point spectrum and a 20,000-point one cost the DOM the same.

Pointer lookup against the **source** domain — a binary search, not a scan of
the drawn sample — over a 200-probe sweep:

| scene | mean per sweep | per probe |
| --- | ---: | ---: |
| chromatogram-100k | 0.0165 ms | ~83 ns |
| transfer-bound-500k | 0.0158 ms | ~79 ns |

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
| chromatogram-100k | 100,000 | 1,613,790 | 12 | 5 |
| profile-dense-60k | 60,000 | 969,066 | 13 | 6 |
| centroid-dense-20k | 20,000 | 483,698 | 12 | 5 |
| transfer-bound-500k | 500,000 | 8,065,802 | 13 | 6 |

The same scenes reduced to 900 columns and exported *as a reduction* — here
under `MinMaxPerColumn`, the greatest and the least value of each column
whatever their signs, which is **not** the rule the screen table above used:

| scene | source | drawn | SVG bytes |
| --- | ---: | ---: | ---: |
| chromatogram-100k | 100,000 | 1,800 | 30,300 |
| profile-dense-60k | 60,000 | 1,800 | 30,462 |
| centroid-dense-20k | 20,000 | 1,800 | 44,641 |
| transfer-bound-500k | 500,000 | 1,800 | 30,440 |

Two per column in every row, because these scenes have no column so flat that
its greatest and its least value are the same point. The screen's rows drew
900–942 from the same sources under `ExtremePerSignPerColumn`, which keeps the
tallest positive and the deepest negative and therefore keeps **one** value for
an all-positive column. Both reductions are defensible; they are not the same
reduction, and the contract names which one a figure used — see *Two reduction
rules, named apart*.

A full-range export of the 500k scene is **265× larger** than the reduction of
it (8,065,802 vs 30,440 bytes). That ratio is the difference candidate A silently
elided.

Reduction cost alone, without rendering: 211 µs (20k) to 2.18 ms (500k).

### Two reduction rules, named apart

The screen table and the export table above reduce the *same* sources to
different counts, and that is the finding, not a discrepancy:

| rule | what it keeps | all-positive column | these four scenes |
| --- | --- | --- | ---: |
| `MinMaxPerColumn` | greatest and least value, whatever the sign | 2 points | 1,800 drawn |
| `ExtremePerSignPerColumn` | tallest positive, deepest negative | **1** point | 900–942 drawn |

`StickSpectrum` performs the second. Raw intensity is nonnegative almost
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

The byte counts were byte-identical in all four runs (`1,613,790` and
`8,065,802` every time) while the timings moved by up to 4.6×. These are
order-of-magnitude facts about one loaded laptop, not a product guarantee, and
they are the reason timing alone did not choose the renderer.

Peak working set of the whole harness process — four scenes resident, including
the 500k one, plus an 8 MB output string: **46 MB**.

Edge scenes, all five:

```text
empty          svg_bytes=  1189  elements=11  finite_only=true chrome_free=true external_free=true
single-point   svg_bytes=  1277  elements=12  finite_only=true chrome_free=true external_free=true
flat           svg_bytes= 24379  elements=12  finite_only=true chrome_free=true external_free=true
all-negative   svg_bytes= 24444  elements=13  finite_only=true chrome_free=true external_free=true
all-zero       svg_bytes= 25379  elements=12  finite_only=true chrome_free=true external_free=true
```

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
