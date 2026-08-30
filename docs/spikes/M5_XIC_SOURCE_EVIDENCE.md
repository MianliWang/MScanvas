# M5.4 — XIC source and capability evidence

**Route outcome: `XIC_SOURCE_REFUSED`.**

No query the installed ProteoWizard build offers can serve as a general XIC
scientific source. Four of its eight analysis queries cannot express an m/z
window at all. The four that can — `tic`, `sic`, `slice` and `image` — were each
measured and each rejected, on **two** grounds rather than one:

- `tic`, `sic` and `slice` **serialize intensity at four fixed decimal places**,
  which maps a legitimate positive signal onto the same output as a true zero.
- `image` is rejected **independently of that**. It renders a pseudo-2D-gel,
  which carries no per-scan quantity and no result identity even when it
  succeeds, and it produced no usable output on either pinned source. It never
  produced an intensity column to serialize, so the four-decimal finding does not
  reach it — the matrix below records its numeric fidelity as `NOT_APPLICABLE`
  for exactly that reason.

Keeping the two grounds separate is what makes the record useful at re-entry: a
later build could repair the serialization without changing what `image`
produces, or the reverse.

This is an evidence slice. It implements no XIC and changes no production code.
Refusal is a valid outcome; approximation is not, and none was substituted.

**Every conclusion here belongs to one executable**, `msaccess.exe` SHA-256
`85681B205569A9850F47D079749E04BA45F4B0C64E363D4A2C5C67C3C67ED1F4`, from
ProteoWizard `3.0.26013 (47b13cf)`. Nothing in it transfers to another
executable, and the M0 spike's conclusions — taken against `3.0.26204
(a09eea9)` — are deliberately not carried across.

## Repository baseline

| Fact | Value |
| --- | --- |
| Canonical main at start | `eecf54a7168b7f404875ebb70db0f5b2eeb5e393` |
| `main` vs `origin/main` | 0 / 0 |
| Worktree / index / untracked | clean |
| Stash | empty |
| Milestones | M5.0–M5.3 complete; M5.4 unstarted |

## Measured ProteoWizard build

Discovered where this repository's own discovery searches — `%LOCALAPPDATA%\Apps`
— which is the location M0 recorded as its false negative. **No absolute
executable path is recorded here.**

| Fact | Value |
| --- | --- |
| Tool | `msaccess` |
| Release (from `msaccess` itself) | `3.0.26013` |
| Release with revision (from sibling `msconvert`, same distribution) | `3.0.26013 (47b13cf)` |
| Build date (both tools) | `Jan 13 2026 14:42:37` |
| `msaccess.exe` bytes | `12,898,816` |
| **`msaccess.exe` SHA-256** | **`85681B205569A9850F47D079749E04BA45F4B0C64E363D4A2C5C67C3C67ED1F4`** |
| `msconvert.exe` SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` |

`msaccess` in this build emits the release but **not** the source revision. The
revision `47b13cf` comes from `msconvert` in the same distribution — same build
date — and is corroborated by the installation directory name. Every source
citation below is pinned to `47b13cf` on that basis, and the consequence is
recorded in the re-entry gate: a gate that asked `msaccess` for its own revision
would be asking for something it does not emit.

### Complete help capture

Captured to files rather than through a pipe, so neither stream was truncated.
`msaccess` writes help to **stderr** and exits `1`; `stdout` is empty.

| Invocation | Exit | stdout bytes | stderr bytes | stdout SHA-256 | stderr SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `msaccess` (no arguments) | `1` | `0` | `8,027` | `E3B0C442…B855` | `44B9D4634B7F8F234BE8BD8E30F6C20CC317777898A933CF4915EA56F815E073` |
| `msaccess --help` | `1` | `0` | `28,873` | `E3B0C442…B855` | `81C280BDFA15F8130D541CFC079345E31F3D86FDB0C1713CEF19104866743553` |

Both end in the build's own release/build-date footer, and the byte counts are
the complete captures.

## Evidence is bound to an executable, not to a help text

**This rule is the slice's durable governance output, and it holds whatever the
route outcome is.**

> Scientific evidence is transferable only to an executable identity explicitly
> covered by that evidence.

Two `msaccess` builds can print identical help — identical `tic` signature,
identical filter grammar, identical `TicCapability` — while differing in exactly
the things this slice had to measure: the aggregation performed, the numeric
precision serialized, and whether an ordinary window aborts. **Help text is not
implementation evidence.** A gate that admits on grammar alone admits an
implementation nobody measured.

Concretely, none of these is sufficient on its own or in combination:

- the query name `tic`;
- the `tic` signature `[mz=<mzLow>[,<mzHigh>]] [delimiter=…]`;
- the `--filter` grammar;
- `TicCapability::SupportedWithMsLevelFilter`;
- the release string `3.0.26013`.

**Syntax-equivalent future ProteoWizard builds do not inherit this measurement.**

Because the outcome below is refusal, this rule is recorded as the **XIC
re-entry gate** rather than as a production capability requirement, and no unused
gate was invented for it.

## Sources measured

Four, all external to the repository and identified by hash. None is committed.

| | Synthetic fixture | Representative acquisition | Low-intensity fixture | Duplicate-RT fixture |
| --- | --- | --- | --- | --- |
| Identity | ProteoWizard `example_data/tiny.pwiz.1.1.mzML` | PRIDE `PXD081190`, `BBM_506_P110_31_MIA_004_30_calibrated.mzML` | generated for this slice, `lowint.mzML` | generated for this slice, `duprt.mzML` |
| Provenance | pinned upstream example data | public CC0 deposit, reacquired from the official location | written by a deterministic generator; see below | written by a deterministic generator; see below |
| Licence | Apache-2.0 | Creative Commons Public Domain (CC0) | n/a — synthetic, no acquisition | n/a — synthetic, no acquisition |
| Bytes | `25,072` | `208,408,454` | `14,540` | `10,023` |
| SHA-256 | `711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83` | `262D1178303CD934223239D5D93A3B842DCA69DA09CEF58E95A39B950D26B7E8` | `e00e390a33d4028e638897f8abc3f608d2b2e9ff1a579f30b7f07468743680da` | `87731CB1C49A2D4398D282365DC846E21FD095E4E0D49424ECD356B0E4B6C548` |
| Spectra | `4` (MS1 ×3, MS2 ×1) | `36,319` (MS2 only) | `8` (MS1) | `5` (MS1) |

The first two hashes are the ones M0 pinned, re-verified before execution here.
The two generated fixtures exist because a required dimension of the candidate
standard is unreachable on the pinned pair: the pinned sources cannot exhibit a
positive sum below the serialization resolution, and they cannot exhibit two
spectra sharing a retention time.

**The synthetic fixture's arrays are not what its headers say.** Its stored CV
metadata declares `mzLow 400.39 / mzHigh 1795.56`, while its actual binary arrays
are the small integers `0 … 14` (indices 0 and 3) and `0, 2, … 18` (index 1).
That is `examples::initializeTiny` data, and it is what makes exact window
arithmetic checkable by hand.

### The low-intensity fixture

Neither pinned source can answer the precision question: the synthetic fixture
carries small integers and the representative carries instrument-scale counts, so
**neither can exhibit a positive sum below the serialization resolution.** A
third input was therefore generated.

Written by a small deterministic generator: eight MS1 spectra, 64-bit
little-endian doubles, no compression, so the stored bytes *are* the values.
Every spectrum isolates one magnitude at m/z `100.0`, so the expected in-window
sum over `[100, 101]` is exactly the value below and is calculable without
reference to the backend. One spectrum carries five points that are each
individually below the boundary and together cross it.

| index | case | intended in-window sum |
| ---: | --- | --- |
| 0 | true zero | `0.0` |
| 1 | far below the boundary | `1e-6` |
| 2 | just below | `4e-5` |
| 3 | at the rounding boundary | `5e-5` |
| 4 | just above | `6e-5` |
| 5 | clearly above | `1e-3` |
| 6 | non-trivial fractional, well above | `123.456789` |
| 7 | five points of `1e-5` each | `5e-5` |

**The fixture was proved to round-trip through the backend's own reader before
`tic` was measured on it.** `binary index=0,7 precision=12` returns every
intended value exactly — `0.000001000000`, `0.000040000000`, `0.000050000000`,
`0.000060000000`, `0.001000000000`, `123.456789000000`, and the five
`0.000010000000`. So `msaccess` holds the values; anything lost below is lost by
the query's own serialization, not by the fixture or the parser.

### The duplicate-retention-time fixture

The candidate standard requires duplicate-retention-time behaviour where
relevant, and it is relevant to `tic`, `sic` and `slice`: each emits a retention
time beside a scan identity, so what happens when two spectra share one retention
time decides whether a consumer may key on it. **Both pinned sources have
strictly distinct retention times**, so a fourth input was generated.

Five MS1 spectra, 64-bit little-endian doubles, no compression, so the stored
bytes *are* the values. The design makes each possible backend behaviour
separately visible:

| source index | native id | scan start time | in-window sum over `[500, 502]` |
| ---: | --- | ---: | ---: |
| 0 | `scan=1` | `60` s | `1000` |
| 1 | `scan=2` | **`120` s** | `2000` |
| 2 | `scan=3` | `180` s | `4000` |
| 3 | `scan=4` | **`120` s** | `24000` |
| 4 | `scan=5` | `240` s | `16000` |

Indices `1` and `3` share a retention time exactly, and are **not adjacent**, so
a reordering is as visible as a merge. Every sum is distinct, and the merged sum
of the duplicate pair would be `26000`, which is no single spectrum's sum and no
other pair's — a merge cannot be mistaken for anything else. In-window points
come in clusters of three, each with one unambiguous maximum on a unique m/z, so
the singular parabola fit measured on the representative cannot confound this;
index `3` carries two such clusters and the rest carry one, so *several rows from
one scan* stays distinguishable from *two scans at one time*. Every spectrum also carries one
point at m/z `600.0`, outside the window, so windowing itself is observable. All
intensities are integers far above the four-decimal boundary, so the
serialization defect cannot hide a row.

**Verified through the backend's own readers before any candidate ran.**
`spectrum_table` returns all five spectra, ids `1`–`5`, `ms1`, and retention
times `60.00, 120.00, 180.00, 120.00, 240.00` — the duplicate is real and read as
such. `binary index=1 precision=12` and `binary index=3 precision=12` return
`id: scan=2` / `id: scan=4`, `retentionTime: 120` for both, and every intended
m/z and intensity exactly. A malformed fixture cannot become evidence about
duplicate-RT behaviour this way.

## Live candidate inventory

Every analysis command the installed build declares, verbatim from the help
capture.

| # | Candidate | Exact installed signature |
| --- | --- | --- |
| 1 | `metadata` | *(no parameters)* |
| 2 | `run_summary` | `[msLevels=<int_set>] [charges=<int_set>] [delimiter=<fixed\|space\|comma\|tab>]` |
| 3 | `spectrum_table` | `[delimiter=<fixed\|space\|comma\|tab>]` |
| 4 | `binary` | `index=<spectrumIndexLow>[,<spectrumIndexHigh>] \| sn=<scanNumberLow>[,<scanNumberHigh>] [precision=<precision>]` |
| 5 | `slice` | `[mz=<mzLow>[,<mzHigh>]] [rt=<rtLow>[,<rtHigh>]]] [index=<indexLow>[,<indexHigh>] \| sn=<scanLow>[,<scanHigh>]] [delimiter=<fixed\|space\|comma\|tab>]` |
| 6 | `tic` | `[mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed\|space\|comma\|tab>]` |
| 7 | `sic` | `mzCenter=<mz> radius=<radius> radiusUnits=<amu\|ppm> [delimiter=<fixed\|space\|comma\|tab>]` |
| 8 | `image` | `[args - see list]`, whose prose arg list includes `mz=<mzLow>[,<mzHigh>]` |

`sic`'s signature is one this repository had never held. It is recorded exactly
as the build declares it.

## Final classification

| Candidate | State | Basis |
| --- | --- | --- |
| `metadata` | `EXCLUDED_BY_SIGNATURE` | No parameter of any kind; the required m/z window cannot be expressed. |
| `run_summary` | `EXCLUDED_BY_SIGNATURE` | Parameters are `msLevels`, `charges`, `delimiter`; no m/z window. |
| `spectrum_table` | `EXCLUDED_BY_SIGNATURE` | Only `delimiter`; no m/z window. |
| `binary` | `EXCLUDED_BY_SIGNATURE` | Only `index`/`sn`/`precision`; no m/z window. Selecting spectra by index and extracting arrays is the per-scan-process substitute the route refuses. |
| `tic` | `MEASURED_REJECTED` | `LOSSY_INTENSITY_SERIALIZATION_DESTROYS_ZERO_NONZERO_DISTINCTION` |
| `sic` | `MEASURED_REJECTED` | Same serialization loss, plus omitted scans, partial output on failure, and interpolated peak coordinates. |
| `slice` | `MEASURED_REJECTED` | Same serialization loss, plus no aggregation, omitted scans, and unbounded output size. |
| `image` | `MEASURED_REJECTED` | Produces a gel image with no per-scan quantity and no result identity; produced no output on either pinned source. |

**No candidate is left unmeasured.** No applicable candidate is closed by
anything except its own measurement.

### On the four signature-only exclusions

Each is excluded by the one category its signature actually establishes: **the
required m/z window cannot be expressed.** The requirement is that the query
accept an explicit m/z interval; the limitation is that its declared parameter
set contains no m/z term; and execution cannot change that, because a parameter
the grammar does not declare cannot be supplied. Nothing is inferred about what
these queries compute.

### What was not treated as evidence

That MSCanvas has no `sic` parser, holds no `sic` signature constant, exposes no
m/z field on `PreviewOperation::Tic`, and invokes none of these from a production
route are facts about this application. None was used to exclude anything.

## The decisive finding — four fixed decimal places

### What the source does

At revision `47b13cf`,
[`RegionTIC.cpp:156`](https://github.com/ProteoWizard/pwiz/blob/47b13cf/pwiz/analysis/passive/RegionTIC.cpp):

```cpp
DELIMWRITE_EOL(width_sumIntensity, fixed << setprecision(4) << spectrumStats.sumIntensity);
```

`fixed` with `setprecision(4)` writes exactly four digits after the decimal
point. Any sum below `0.00005` rounds to the literal text `0.0000`.

| Source location at `47b13cf` | Column |
| --- | --- |
| `RegionTIC.cpp:156` | `sumIntensity` |
| `RegionSIC.cpp:186–188` | `sumIntensity`, `peakMZ`, `peakIntensity` |
| `RegionAnalyzer.cpp:245–246` | per-peak `m/z`, `intensity` (used by `slice` and `sic`'s data table) |

### There is no precision control

Investigated before rejecting, and the answer is unambiguous.

`RegionTIC::Config` at `47b13cf` parses exactly two things: `delimiter=` via
`checkDelimiter`, and `mz=` via `parseRange`. There is no precision token, and
the `setprecision(4)` at line 156 is a literal.

In the **complete installed help**, the word `precision` appears exactly twice,
both times for `binary`:

```text
binary index=<spectrumIndexLow>[,<spectrumIndexHigh>] | sn=… [precision=<precision>]
      precision: write d decimal places
```

`binary` is a different analyzer, cannot express an m/z window, and is excluded
above. The top-level option set — `--filelist`, `--outdir`, `--config`, `--exec`,
`--filter`, `--verbose`, `--help` — contains no precision control either.

**No supported way to request greater `tic` output precision exists in this
build.** No undocumented flag was invented or attempted.

### What it does to real values

Measured on the low-intensity fixture, `tic mz=100,101 delimiter=tab`:

| index | case | intended sum | serialized | verdict |
| ---: | --- | ---: | ---: | --- |
| 0 | true zero | `0.0` | `0.0000` | true zero |
| 1 | far below | `1e-6` | `0.0000` | **destroyed — identical to true zero** |
| 2 | just below | `4e-5` | `0.0000` | **destroyed — identical to true zero** |
| 3 | at boundary | `5e-5` | `0.0001` | survives |
| 4 | just above | `6e-5` | `0.0001` | survives |
| 5 | clearly above | `1e-3` | `0.0010` | survives |
| 6 | fractional | `123.456789` | `123.4568` | survives, truncated |
| 7 | five sub-threshold points | `5e-5` | `0.0001` | survives |

Rows 1 and 2 carry a mathematically positive in-window sum and are serialized
byte-identically to row 0's true zero. **A consumer of this output cannot
distinguish them.**

Row 7 is worth stating separately: five points each individually below the
boundary sum to a value that *does* survive. The accumulation is correct; the
loss is entirely in the serialization of the result.

Row 6 shows ordinary precision truncation (`123.456789` → `123.4568`). That is a
fidelity concern rather than a zero/non-zero ambiguity, and it is not the reason
for rejection.

`sic` shows the same loss with an additional wrinkle. Its row filter is
`if (spectrumStats.sumIntensity)`, which tests the **double**, not the printed
text — so on the same fixture it emits rows for indices 1 and 2 whose printed
`sumIntensity` is `0.0000`, while omitting index 0 entirely. A row reading
`0.0000` there means *non-zero but below serialization resolution*, recoverable
only by inference from the row's presence, and directly contradicting any reading
of `0.0000` as zero. Its index 7 prints `sumIntensity 0.0001` beside
`peakIntensity 0.0000`, losing the peak while keeping the sum.

### Why this rejects the source

The invariant this slice is held to:

> An admitted XIC source must preserve the distinction between zero signal and
> legitimate non-zero signal over the input domain MSCanvas claims to support.

MSCanvas admits mzML generally. Nothing in its current support establishes a
trustworthy minimum intensity scale that could rule out sub-resolution values
*before* invoking the query — normalized, scaled and otherwise small-magnitude
intensity arrays are legal mzML, and the low-intensity fixture is legal mzML.

So an XIC built on this output would silently render a real low-intensity trace
as a flat zero line, and MSCanvas could not tell the reader which it was looking
at. The following are **not** available as rescues, because each is a product or
scientific assumption this repository has not admitted:

- that real instruments normally produce larger values;
- that normalized mzML is unusual;
- that a user does not care below `1e-4`;
- that displaying four decimals is good enough anyway.

`tic` is therefore `MEASURED_REJECTED` for
`LOSSY_INTENSITY_SERIALIZATION_DESTROYS_ZERO_NONZERO_DISTINCTION`, and the
claim made in an earlier draft of this record — that `0.0000` is explicit
no-signal behaviour — is **withdrawn**. It is not: it is either no signal or
signal below resolution, and the output does not say which.

## What `tic` did get right, recorded so the refusal is specific

A refusal is only credible if it says what the candidate *could* do. All of the
following was measured and holds; none of it rescues the source.

**Parameter forms.** `mz=0,4`, `mz=0-4` and `mz=4` are all accepted; the comma
and dash forms produce byte-identical output; a single value is a zero-width
window. Omitting `mz=` applies a default window of `0.00–10000.00`, which is a
default rather than "no window".

**Window semantics — inclusive at both ends**, checked by hand against the
synthetic fixture's real arrays and confirmed in source
(`lower_bound(mzRange.first)` / `upper_bound(mzRange.second)`):

| Invocation | index 0 (m/z `0…14`, int. `15…1`) | index 1 (m/z `0,2,…18`, int. `20,18,…2`) |
| --- | --- | --- |
| `mz=0,4` | `65` = 15+14+13+12+11 | `54` = 20+18+16 |
| `mz=2,4` | `36` = 13+12+11 | `34` = 18+16 |
| `mz=4` | `11` | `16` |

**Aggregation is a sum**, read from
[`RegionAnalyzer.cpp`](https://github.com/ProteoWizard/pwiz/blob/47b13cf/pwiz/analysis/passive/RegionAnalyzer.cpp)
rather than inferred from the query's name:

```cpp
double sumIntensity = 0;
for (vector<MZIntensityPair>::const_iterator it=begin; it!=end; ++it)
{
    sumIntensity += it->intensity;
    if (max->intensity < it->intensity) max = it;
    ...
}
spectrumStats.sumIntensity = sumIntensity;
```

It is a **recomputed** trace, not the file's stored TIC: the fixture's stored
`totalIonCurrent` is `1.66755e+07` while unwindowed `tic` reports `120`.

**Ordering is source spectrum index**, not retention time — proved by the
fixture emitting `353.43, 359.43, 0.00, 42.05` in that order.
`RegionTIC::close()` iterates its cache in order and prints every entry
unconditionally.

**Row coverage is complete.** Every spectrum in scope gets a row. On the
representative, `tic mz=500,502` returned `36,319` rows in `2,989,606` bytes
(`82.3` bytes/row, about 36 % of `MAX_PREVIEW_TEXT_BYTES = 8,388,608`),
byte-identical across three passes. Row count equals spectrum count, so output
size is predictable before invoking.

**Identity reconciles when unfiltered.** On the representative, `tic`'s `index`
agrees with `spectrum_table`'s across all `36,319` rows; the `id` arrives in the
raw form (`controllerType=0 controllerNumber=1 scan=413`) where `spectrum_table`
gives the abbreviated one (`0.1.413`), so a consumer would have to canonicalize
rather than string-compare.

## MS-level behaviour, measured at representative scale

Recorded in full so the refusal is evidence-complete rather than selectively
incomplete.

**On the synthetic fixture**, `--filter="msLevel N"` composes and returns correct
windowed sums — `msLevel 1` returns the three MS1 spectra, `msLevel 2` the one
MS2 spectrum. It also **renumbers the `index` column** to the position in the
*filtered* list: unfiltered, `scan=21` is index `2` and
`sample=1 period=1 cycle=22 experiment=1` is index `3`; under `msLevel 1` the
same two are reported as index `1` and `2`.

**On the representative acquisition:**

| Invocation | Exit | Rows | Bytes | SHA-256 | stderr |
| --- | --- | ---: | ---: | --- | --- |
| `tic mz=500,502` (unfiltered) | `0` | `36,319` | `2,989,606` | `f326cd1c…b37c2` | empty |
| `tic mz=500,502` `--filter="msLevel 2"` | `0` | `36,319` | `2,989,606` | `f326cd1c…b37c2` | empty |
| `tic mz=500,502` `--filter="msLevel 1"` | `0` | `0` | `63` | `43f058bb…4a5d` | empty |

The filtered MS2 run is **byte-identical** to the unfiltered one, and is
byte-identical across two passes.

**That equality is a fact about this file, not about filtered identity.** The
representative is MS2-only, so the filtered list *is* the source list and the two
index sequences coincide. It is not evidence that filtered `index` is generally
the source index, and the synthetic fixture's renumbering result stands
unqualified. Under any filter the canonicalized spectrum `id` remains the only
stable key.

A filter selecting **no** scans (`msLevel 1` on an MS2-only file) is a clean
success: exit `0`, empty stderr, and a generated file carrying the header and
zero rows. That is distinguishable from the abort below, which produces no file
at all.

## `image`, measured on both pinned sources

Measured rather than excluded by signature, because its prose arg list includes
`mz=` even though its declared signature has no parameters.

| Source | Invocation | Exit | Output | stderr |
| --- | --- | --- | --- | --- |
| Synthetic | `image mz=0,4` | `0` | none | `invalid vector subscript`; `Caught exception` |
| Representative | `image mz=500,502` | `0` | none | `[Pseudo2DGel::Impl::writeImages] nothing to do`; `Caught exception` |
| Representative | `image mz=400,1000` | `0` | none | same |
| Representative | `image` (default window) | `0` | none | same |

Three **different** windows — narrow, wide and default — so the result is not an
artefact of one window. That is cross-window evidence, and it is not
repeatability; repeatability is measured separately below.

`image` produced no output on either pinned source, and its purpose, named by its
own `Pseudo2DGel` class, is a rendered gel image, which carries no per-scan
intensity and no result identity even when it succeeds. `MEASURED_REJECTED`.

### `image` repeatability, same invocation

Repeatability is a claim about **one** input repeated, so it is measured that
way: the ordinary narrow case, `image mz=500,502`, run five consecutive times
with byte-identical argv. One fixed output directory, emptied before each pass,
so the argv does not vary between passes and each pass's artifact state is
observed on its own.

| Fact | Value |
| --- | --- |
| Executable | `msaccess.exe` SHA-256 `85681B205569A9850F47D079749E04BA45F4B0C64E363D4A2C5C67C3C67ED1F4` |
| Source | representative, SHA-256 `262D1178303CD934223239D5D93A3B842DCA69DA09CEF58E95A39B950D26B7E8`, `208,408,454` bytes |
| Analysis argument | `image mz=500,502`, identical on every pass |

| Pass | Exit | stdout bytes | stderr bytes | Generated files | stderr SHA-256 |
| --- | --- | --- | --- | --- | --- |
| 1 | `0` | `0` | `113` | **`0`** | `9440A5E0BF18299362BB2A6530B33022F7A486F74FE78D8F2C58E98DF2D87B56` |
| 2 | `0` | `0` | `113` | **`0`** | same |
| 3 | `0` | `0` | `113` | **`0`** | same |
| 4 | `0` | `0` | `113` | **`0`** | same |
| 5 | `0` | `0` | `113` | **`0`** | same |

Every pass produced **no artifact at all**, so there is no output hash to
record, and none is invented here: the repeated observable is the exit status,
the empty output directory and the byte-identical diagnostic

```text
[Pseudo2DGel::Impl::writeImages] nothing to do
[MSDataAnalyzerApplication] Caught exception for file rep.mzML.
```

The three cross-window runs above carry that same stderr digest, so the
repeated narrow pass is the same observation the window sweep recorded, not a
different one. `image` is repeatable in this build; what it repeats is producing
nothing.

## `sic`, measured to the candidate standard

Every row below is a real invocation against the pinned representative
acquisition unless it says otherwise. `sic`'s rejection does **not** rest on the
shared serialization loss alone, and the candidate-specific findings are recorded
because a future build could fix the numeric format and leave all of them intact.

**Invocation and window.** `sic mzCenter=501 radius=1 radiusUnits=amu
delimiter=tab` resolves to the absolute window `[500, 502]`, inclusive at both
ends. `radiusUnits=ppm` resolves as `mzCenter × radius / 1e6`, measured on the
synthetic fixture. All three parameters are required by the installed signature.

**Artifacts.** Three per invocation, and the set is itself evidence:

| Artifact | Role | Rows | Bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `…sic.501.0000.data.tsv` | one row per matching **peak** | `3,700` | `349,596` | `2d9b0d2e…be69` |
| `…sic.501.0000.peaks.tsv` | one row per **scan that had signal** | `3,268` | `344,547` | `f954e62b…d41e` |
| `…sic.501.0000.summary.txt` | aggregate statistics | `12` | `355` | `079b3d40…a59b` |

**Schema.** `peaks.tsv` is
`# index · id · event · analyzer · msLevel · rt · sumIntensity · peakMZ · peakIntensity`;
`data.tsv` replaces the last three with `m/z · intensity`. Both prefix the column
header with `#`, which `spectrum_table` does not.

**Retention time and ordering.** `rt` is emitted at two decimals and ascends with
the rows (`64.00` … `1956.30`). Rows are in **source spectrum order**, not sorted
by retention time and not re-indexed — established from the emitted `index`
sequence rather than assumed from `tic`'s behaviour, which shares
`RegionAnalyzer` but not `RegionSIC`'s printer.

**Identity, and its gaps.** The emitted `index` is the **source spectrum index**
for an unfiltered query: the sequence runs `18, 36, 69, …, 36113, 36123` — sparse,
because omitted scans leave gaps rather than shifting later rows. The `id` is the
raw form (`controllerType=0 controllerNumber=1 scan=543`) where `spectrum_table`
gives the abbreviated one, so a consumer would canonicalize rather than
string-compare. **The gaps are the problem, not the identity**: from `sic` output
alone a reader cannot tell an omitted scan from a scan the run does not have,
because both are simply absent.

**MS-level.** `--filter="msLevel 2"` produced output byte-identical to unfiltered
across all three artifacts. As with `tic`, that is a fact about an MS2-only file
rather than evidence about filtered indices; the synthetic fixture remains the
only source that discriminates, and there `--filter="msLevel 1"` reduced `sic` to
the two MS1 scans that carried signal.

**No signal.** `sic mzCenter=5000 radius=1 radiusUnits=amu` still writes all
three artifacts: `data.tsv` and `peaks.tsv` carry their headers and **zero** rows,
and `summary.txt` reports `nonzeroCount: 0`. So an empty result is an empty
document rather than a missing one — but every scan is absent from it, which is
the same ambiguity at whole-file scale.

**Malformed and failure.** The singular-parabola abort reaches `sic` too:
`sic mzCenter=405 radius=5 radiusUnits=amu` exits `0` and leaves a **partial**
`data.tsv` of `231` rows with **no** `peaks.tsv` and **no** `summary.txt`. That
file is `21,071` bytes, far below `MAX_PREVIEW_TEXT_BYTES`, so a consumer
checking only exit code and file existence would read a truncated answer as a
complete one.

**Completeness.** `3,268` scan rows against `36,319` source scans — `33,051`
silently absent. Row count is peak- and signal-driven, so output size cannot be
predicted from the scan count before invoking.

**Repeatability.** Two representative runs of the same query produced
byte-identical output across all three artifacts (`2d9b0d2e…`, `f954e62b…`,
`079b3d40…`). Three synthetic runs were likewise byte-identical.

**Rejection, restated with its own reasons.** Beyond the shared four-decimal
loss: it omits every zero-sum scan (`RegionSIC::close()` emits only
`if (spectrumStats.sumIntensity)`); it leaves partial output on abort; its
`peakMZ`/`peakIntensity` are parabola-interpolated coordinates no instrument
recorded; and its filenames encode only `mzCenter`, so two radii at one centre
collide.

## `slice`, measured to the candidate standard

**Invocation and window.** `slice mz=500,502 delimiter=tab`, the same window
`sic` was measured over. `slice` additionally accepts `rt=`, `index=` and `sn=`
restrictions.

### On the synthetic fixture

Recorded here because the matrix's `synthetic 2,4` cell was, for a time, the only
place this run appeared — the section below it held representative rows alone, so
the cell was accurate and unverifiable from the record. M5.8 closed that: both
artifacts were re-hashed, and the query was re-run against a re-hashed executable
and a re-hashed source, reproducing byte-identically.

| Fact | Value |
| --- | --- |
| Executable | `msaccess.exe` SHA-256 `85681B205569A9850F47D079749E04BA45F4B0C64E363D4A2C5C67C3C67ED1F4` |
| Source | `tiny.pwiz.1.1.mzML`, SHA-256 `711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83` |
| Invocation | `slice mz=2,4 delimiter=tab` |
| Exit / stderr | `0` / empty |
| Artifact | `tiny.pwiz.1.1.mzML.slice.mz_2.0000-4.0000.tsv`, `543` bytes, `8` rows |
| SHA-256 | `fd279dbc0e3f1636d2d7f306c5d346aa657d13444cd32532bb067c0054a6ad6f` |

```text
0	scan=19	3	IonTrap	ms1	353.43	2.0000	13.0000
0	scan=19	3	IonTrap	ms1	353.43	3.0000	12.0000
0	scan=19	3	IonTrap	ms1	353.43	4.0000	11.0000
1	scan=20	4	IonTrap	ms2	359.43	2.0000	18.0000
1	scan=20	4	IonTrap	ms2	359.43	4.0000	16.0000
3	sample=1 period=1 cycle=22 experiment=1	0	IonTrap	ms1	42.05	2.0000	13.0000
3	sample=1 period=1 cycle=22 experiment=1	0	IonTrap	ms1	42.05	3.0000	12.0000
3	sample=1 period=1 cycle=22 experiment=1	0	IonTrap	ms1	42.05	4.0000	11.0000
```

Hand-checkable, which is the whole reason a synthetic run is worth having. The
window is inclusive at both ends and the values are `initializeTiny`'s small
integers. **Source index `2` is absent** — its arrays are empty and
`spectrum_table` reports its TIC as `0.00` — which is the omission the
representative measurement also found, here on four spectra a reader can count.
**One scan gives many rows**: indices `0` and `3` give three each, index `1`
gives two, because that spectrum's array holds even values only and carries no
`m/z 3`. Both facts are properties of the output shape rather than of scale.

**No signal, synthetic.** `slice mz=100,200` writes the artifact with its header
and zero rows — `74` bytes, SHA-256
`9dfd5839643946a73e576430006781334742672e787bd1e866e8b5274696ab87`, empty
stderr, exit `0`. The same posture the representative no-signal window showed.

Neither run changes `slice`'s classification. It is recorded because refusal
condition 3 says every applicable candidate was measured on both pinned sources,
and a claim discharged by a matrix cell alone is a claim a reader cannot check.

**Output shape.** One artifact,
`…slice.mz_500.0000-502.0000.tsv`: `3,700` rows, `349,596` bytes, SHA-256
`2d9b0d2e…be69`. Schema is
`# index · id · event · analyzer · msLevel · rt · m/z · intensity`.

That hash is **byte-identical to `sic`'s `data.tsv`** for the equivalent window,
which is direct evidence that both are `RegionAnalyzer`'s per-peak dump and not
two independent readings.

**Rows are per peak, not per scan.** Spectrum `36123` appears twice, once for
`m/z 500.1334` and once for `501.0525`. **That is why a `slice` row cannot be an
XIC point identity**: an XIC point is one value per scan, and `slice` emits one
row per measurement with no aggregate anywhere in its output.

**Retention time and ordering.** `rt` at two decimals, ascending with rows; rows
in source spectrum order, with a scan's own peaks consecutive and in ascending
m/z.

**Identity.** Same as `sic`: source `index` for an unfiltered query, sparse
because scans with no in-window peak are omitted, and the raw `id` form.

**MS-level.** `--filter="msLevel 2"` produced byte-identical output, with the
same MS2-only caveat.

**No signal.** `slice mz=5000,5001` writes the artifact with its header and
**zero** rows — `64` bytes, empty stderr, exit `0`.

**Malformed and failure.** `slice mz=400,403` hits the singular-parabola abort:
exit `0`, stderr `[Parabola.cpp::solve()] Matrix is singular`, and a **partial**
file of `62` rows / `5,720` bytes. Reproduced identically on three runs
(`d5c06b4e…61e7` each time), so the partial output is deterministic rather than a
race — and it too sits far below the byte bound.

**Completeness and scale.** `3,700` rows for `36,319` scans. The count tracks
**peaks in the window**, not scans, so the byte bound cannot be predicted from
the spectrum count the way `tic`'s can — the same window on a peak-dense
acquisition would produce a much larger file, and nothing in the request bounds
it.

**Repeatability.** Two representative runs byte-identical (`2d9b0d2e…be69`), and
the failing window reproduced byte-identically three times.

**Rejection, restated with its own reasons.** Beyond the shared four-decimal
loss: it performs no per-scan aggregation, so it is not a chromatogram and each
scan may contribute many rows; it omits scans with no in-window peak; its output
size is peak-driven and unbounded from the request; and it leaves partial output
on abort.

## Duplicate retention times, measured

One ordinary window, `[500, 502]`, containing signal from both equal-time
spectra, on each candidate that emits a retention time.

**`tic mz=500,502`** — exit `0`, five rows:

```text
      0      scan=1      0  Unknown     ms1       60.00       1000.0000
      1      scan=2      0  Unknown     ms1      120.00       2000.0000
      2      scan=3      0  Unknown     ms1      180.00       4000.0000
      3      scan=4      0  Unknown     ms1      120.00      24000.0000
      4      scan=5      0  Unknown     ms1      240.00      16000.0000
```

Both equal-time spectra are **present**, as **separate rows**, with their
**identities preserved** (`scan=2`, `scan=4`) and their own sums. There is no
`26000.0000` anywhere, so nothing was merged; no row is missing, so nothing was
deduplicated or overwritten. Rows stay in **source-index order** while the
retention-time column reads `60, 120, 180, 120, 240` — non-monotonic, which is
direct evidence that the output is not sorted by time. Each sum excludes the
out-of-window point, so the window still windowed.

**The consequence for a consumer.** Retention time is **not** a key in this
output. Two rows legitimately carry `120.00`, and only `index` and `id`
distinguish them. Anything that built an XIC point keyed on retention time would
silently collapse them into one.

**`sic mzCenter=501 radius=1 radiusUnits=amu delimiter=tab`** — exit `0`, all
three artifacts. `peaks.tsv` holds one row per scan for all five, including both
equal-time scans with their own `2000.0000` and `24000.0000`; `summary.txt`
reports `nonzeroCount: 5` — five rows for five source spectra, not four for four
distinct times. (`sum_sumIntensity: 47000` does not distinguish the two: merging
would move intensity between rows, not create or destroy it. The row count is
what settles it.) `data.tsv` holds all eighteen in-window peaks with their scan
identity on every row. No merge, no deduplication, source order preserved.

**`slice mz=500,502`** — exit `0`, eighteen rows. Each scan's peaks stay
**grouped and consecutive** under its own `index`/`id`. The six rows of `scan=4`
and the three of `scan=2` share `120.00` and are **not brought together**: the
three rows of `scan=3`, at `180.00`, sit between them, exactly where source order
puts them. So `slice` groups by spectrum rather than by time, and *multiple rows
from one scan* remains distinguishable from *two scans at one time*.

**None of this rescues any candidate.** All three handle duplicate retention
times correctly; they are rejected for reasons this dimension does not touch.
That is the point of measuring it rather than assuming it: the refusal now says
what the source does right here too.

## Candidate-standard matrix

The mechanical answer to *were all still-applicable candidates closed to the same
standard?* The dimension vocabulary is not chosen here: it is
[ADR 0037's candidate evidence dimensions](../architecture/adr/0037-viewer-completion-route.md#m54-candidate-evidence-dimensions),
and repository validation requires this table to name exactly those dimensions,
each once. Every cell is a located result or an explicit `NOT_APPLICABLE` with
its reason. No cell is a bare tick.

Source coverage is not a dimension of the standard and is not a row here; each
candidate's own section records which sources it was run against. The outcome is
not a row either — it is the [final classification](#final-classification).

| Dimension | `tic` | `sic` | `slice` | `image` |
| --- | --- | --- | --- | --- |
| Invocation / accepted parameter form | `tic mz=`; comma, dash and single-value forms all accepted; synthetic `0,4` / `2,4` / `4`, representative `500,502` and 40+ windows | `sic mzCenter= radius= radiusUnits=`, all three required; synthetic `mzCenter=4 radius=2` in both `amu` and `ppm`, representative `mzCenter=501 radius=1 amu` | `slice mz=`, and `rt=`/`index=`/`sn=` declared beside it; synthetic `2,4`, representative `500,502` | `image mz=` accepted although the installed signature declares no parameters at all; synthetic `0,4`, representative narrow, wide and default |
| m/z-window semantics | inclusive at both ends; a single value is a zero-width window; an omitted `mz=` is a `0.00–10000.00` default rather than "no window" | centre + radius resolves to the absolute `[500, 502]`; `ppm` resolves as `mzCenter × radius / 1e6` | inclusive at both ends | `NOT_APPLICABLE` — no output produced on either pinned source, so no window semantics are observable |
| Output shape / schema | one row per spectrum: `index·id·event·analyzer·msLevel·rt·sumIntensity` | three artifacts; `peaks.tsv` adds `peakMZ`/`peakIntensity`, `summary.txt` adds run-level statistics | one row per peak: `index·…·rt·m/z·intensity` | `NOT_APPLICABLE` — renders a gel image, not a table |
| Retention-time values / ordering | 2 dp; **source-index order**, proved by fixture RTs `353,359,0,42` | 2 dp; source order, sparse | 2 dp; source order, a scan's peaks consecutive | `NOT_APPLICABLE` — no rows |
| Identity reconciliation | `index` == `spectrum_table` across all `36,319` rows unfiltered; renumbered under any filter | source `index` with gaps; raw `id`; omission indistinguishable from absence | same, and one scan yields many rows, so a row is not a point identity | `NOT_APPLICABLE` — no result identity by construction |
| MS-level behaviour | fixture: correct sums, **renumbers `index`**; representative MS2 filter byte-identical | fixture: reduces to signal-carrying MS1 scans; representative byte-identical | representative byte-identical | `NOT_APPLICABLE` — no output to filter |
| Aggregation / quantity | sum of in-window intensities, pinned to `RegionAnalyzer.cpp` | same sum, plus an **interpolated** peak | **none** — raw per-peak values | `NOT_APPLICABLE` — an image |
| No-signal behaviour | complete table of explicit `0.0000`; **no scan omitted** | all three artifacts present, zero rows, `nonzeroCount: 0` | artifact present, zero rows, `64` bytes | `NOT_APPLICABLE` |
| Duplicate-retention-time behaviour | measured on the duplicate-RT fixture: both equal-time spectra kept as **separate rows** with their own sums (`2000.0000`, `24000.0000`; no merged `26000.0000`), identities preserved, source order kept while `rt` reads non-monotonically — so `rt` is **not** a key | same: `peaks.tsv` one row per scan for both — `nonzeroCount: 5`, five rows for five source spectra rather than four for four distinct times; `data.tsv` carries scan identity on every row | same: each scan's peaks stay grouped and consecutive under its own `index`/`id`, so grouping is by spectrum rather than by time | `NOT_APPLICABLE` — no per-scan tabular quantity or identity for duplicate-RT semantics to apply to |
| Completeness / byte bound | `36,319` rows, `2,989,606` bytes, `82.3`/row, ~36 % of the bound; predictable from scan count | `3,268` of `36,319` scans; peak-driven, not predictable | `3,700` rows; peak-driven, not predictable | `NOT_APPLICABLE` — nothing written |
| Malformed / error behaviour | parse errors exit `1`; inverted exits `0` with no output; non-finite silently unwindowed; abort leaves **no file** | abort leaves a **partial `231`-row file**, no `peaks`/`summary` | abort leaves a **partial `62`-row file**, reproduced 3× | exits `0` with no output and a caught exception on both sources |
| Repeatability | 3× byte-identical on both sources | 2× representative, 3× synthetic, byte-identical | 2× representative byte-identical; failing window 3× identical | **5× the identical `image mz=500,502` invocation** — exit `0`, `0` files, stderr byte-identical (`9440A5E0…7B56`) |
| Numeric fidelity | `setprecision(4)`; `1e-6` and `4e-5` serialize as `0.0000` | same, via `RegionSIC.cpp:186-188` | same, via `RegionAnalyzer.cpp:245-246` | `NOT_APPLICABLE` |

`image`'s `NOT_APPLICABLE` cells are a consequence of its measured artifact
shape: it produced no output on either pinned source, and what it produces when
it succeeds is a rendered gel with no rows and no per-scan quantity. Fabricating
a scan-identity or ordering test for an output that has no rows would be
inventing evidence, not gathering it.

Its numeric-fidelity cell is one of them, and it is load-bearing: **`image` does
not carry the four-decimal defect.** That defect is located in `RegionTIC`,
`RegionSIC` and `RegionAnalyzer`, which is what `tic`, `sic` and `slice` write
through; `image` writes no intensity column on any measured path. Its rejection
stands on its own output contract and would survive a build that fixed the
serialization for the other three.

## A second build-specific failure, recorded

Independently of precision, `tic`, `sic` and `slice` **abort for some windows**
on the representative acquisition:

```text
[Parabola.cpp::solve()] Matrix is singular.
[MSDataAnalyzerApplication] Caught exception for file <input>.
```

exit `0`, and for `tic` no output file at all.

This is the previously unexplained M0C observation — "TIC: exit 0, no generated
output" — now given a cause. `RegionAnalyzer::update` computes
`interpolatedPeak` for *every* spectrum whichever consumer asked, and the
parabola is singular when the window maximum sits on a duplicated m/z. The
trigger is present at representative spectrum index `342`, whose window `400–403`
holds:

```text
m/z 401.2151   intensity  108963.5391
m/z 401.2151   intensity 2278863.0000   <- the window maximum, on a duplicate m/z
m/z 402.5356   intensity  107573.5156
m/z 402.8630   intensity  119413.7969
```

The failing `sic` run stopped writing at exactly index `342`, corroborating the
position. At one centre the threshold is sharp — complete at 1–2 Da, aborted at
≥3 Da — while at realistic extraction tolerances (`0.02` Da and `0.50` Da across
sixteen centres, `2` Da across sixteen more) it did not occur at all.

This failure alone would not have rejected `tic`: it produces no file, which the
existing preview contract already classifies as `MissingRequiredOutput`, so it
is honestly refusable. It is recorded because a refusal must state what was
found, and because it is a second reason a future re-entry must re-measure rather
than re-read.

## Malformed and error behaviour

| Input | Exit | Output | stderr |
| --- | --- | --- | --- |
| `mz=abc,def` | `1` | none | `[RegionTIC::Config] Unable to parse range: mz=abc,def` |
| `mz=` | `1` | none | `[RegionTIC::Config] Unable to parse range: mz=` |
| `mz=4,0` (reversed) | **`0`** | **none** | `Caught unknown exception` |
| `mz=-5,-1` | `0` | complete zero-valued table | none |
| `mz=nan,inf` | **`0`** | **complete table byte-identical to the default window** | none |

Two of these are why exit code is never treated as semantic evidence here. A
non-finite window silently returns the *unwindowed* result: its SHA-256 is
`7bf8e058…f951`, byte-identical to the default window's on this build and to the
hash M0 recorded for this fixture on a different one.

## Refusal conditions

`XIC_SOURCE_REFUSED` requires all six. Each is closed:

1. **`tic mz=` received the complete required investigation.** Parameter forms,
   inclusive window semantics, aggregation from pinned source, ordering, identity
   and its reconciliation with `spectrum_table` at representative scale,
   MS-level behaviour on both fixture and representative including an empty
   filter, no-signal behaviour, completeness against `MAX_PREVIEW_TEXT_BYTES`,
   malformed and error behaviour, repeatability on both sources — **and the
   low-intensity serialization measurement that rejected it**, together with the
   precision-control investigation that found no override.
2. **Every live installed candidate was classified.** All eight the build
   declares, none left in an intermediate state.
3. **Every still-plausible candidate was measured to the same standard.** All
   four that can express an m/z window, on the synthetic fixture and on the
   representative acquisition, plus the two generated fixtures the standard's
   remaining dimensions required. This condition is **not** a narrative
   assertion, and the standard is not this document's to choose: the dimensions
   are ADR 0037's, repository validation requires the [candidate-standard
   matrix](#candidate-standard-matrix) to name exactly those and no others, and
   every cell of it is a located result or an explicit `NOT_APPLICABLE` with its
   reason, for each of `tic`, `sic`, `slice` and `image`.
4. **Every unmeasured candidate is excluded explicitly by signature.** The four
   are `metadata`, `run_summary`, `spectrum_table` and `binary`, each because its
   declared parameter set contains no m/z term.
5. **No pseudo-XIC or approximation was substituted.** No base-peak m/z
   filtering, no base-peak intensity as extracted intensity, no TIC/BPC summary
   column, no per-scan backend process, no whole-run transfer into the webview,
   no frontend extraction, and no fabricated zero-valued scans.
6. **The record says what was measured, what was excluded and why**, which is
   this document.

## The XIC re-entry gate

XIC is refused for this executable, not for all time. A future attempt must
satisfy **all** of the following before any XIC work resumes:

1. **An executable identity covered by fresh evidence.** The gate is the exact
   `msaccess.exe` SHA-256 — for the build this record covers, that is
   `85681B205569A9850F47D079749E04BA45F4B0C64E363D4A2C5C67C3C67ED1F4` — plus the
   required exact help/capability grammar.
   Release and build-date facts may additionally be checked. A different digest
   is **not** admitted because its help looks the same — it requires fresh
   measurement and a newly authorized evidence profile.
2. **A resolved numeric-fidelity answer.** Either the build serializes region
   intensities at a resolution that preserves the zero/non-zero distinction over
   the mzML domain MSCanvas supports, or it exposes a precision control that is
   declared, measured to change `sumIntensity` serialization as required, and
   capability-gateable.
3. **Re-measurement of everything this record establishes**, because the two
   defects found here — the four-decimal serialization and the singular-parabola
   abort — are both implementation properties invisible in help text.

Note for whoever implements it: `ProviderBuild::is("3.0.26013", "47b13cf")` is
**not** a sufficient gate on its own for this tool. This build's `msaccess`
reports its release but not its source revision, so a revision-bearing check
would not match the executable actually being launched. The executable digest is
the identity that is actually available.

## XIC-D1 … D5

Under refusal, M5.5 and M5.6 are `NOT_APPLICABLE`, so none of these is a blocker
for work that is now unreachable. They are recorded as the evidence stands, for
whoever re-enters through the gate above.

| | Status under refusal | Evidence established |
| --- | --- | --- |
| **D1** — window expression and unit posture | Moot; no source | `tic`/`slice` accept absolute m/z bounds only; `sic` accepts a centre with `amu`/`ppm` radius. No query establishes an m/z unit, so `UnitState::Unreported` would apply. |
| **D2** — MS-level scope | Moot; no source | `--filter="msLevel N"` composes with `tic` and `sic`, returns correct sums, and **renumbers the `index` column**. An empty filter is a clean header-only success. |
| **D3** — aggregation | Moot; no source | The only aggregation any candidate offers is a sum. A rejected source does not define a future product's aggregation, and this is **not** a standing recommendation. |
| **D4** — backend source query | **Not applicable under the refusal branch.** Zero admissible sources means there is nothing to choose between. See the amended rule in ADR 0037. | Four candidates measured and rejected; four excluded by signature. |
| **D5** — panel and value-axis presentation | Moot; no source | — |

## What was not done

No XIC was implemented: no operation, no capability gate, no parser, no DTO, no
service command, no frontend, no cache, no export, and no new selection
authority. No `PreviewOperation` was extended. No production code changed at all.

## Limitations

- **Every conclusion belongs to `msaccess.exe` `85681B20…D1F4`** from
  `3.0.26013 (47b13cf)`. Both defects found here are implementation properties
  that help text does not expose.
- One representative acquisition, MS2-only, no chromatogram list. It says nothing
  about MS1 extraction behaviour.
- **Duplicate retention times are measured on a generated fixture, not on an
  acquisition.** Both pinned sources have strictly distinct retention times, so
  the behaviour was measured on `duprt.mzML` instead. It establishes what the
  three tabular candidates do with two spectra at one time; it is not evidence
  about how often real acquisitions contain them.
- The low-intensity fixture is synthetic and establishes serialization behaviour,
  not instrument realism. It is not evidence about what intensity scales real
  acquisitions carry — which is precisely why the refusal does not depend on such
  a claim.
- Timings are single observations on one host and are not thresholds.
