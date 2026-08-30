# M5.4 — XIC source and capability evidence

**Route outcome: `XIC_SOURCE_ADMITTED`.**

The admitted source is **`msaccess -x "tic mz=<mzLow>,<mzHigh>"`**, measured against
a real ProteoWizard installation on the pinned synthetic fixture and on the
pinned public representative acquisition.

This is an evidence slice. It implements no XIC: no operation, no parser, no DTO,
no service path, no frontend. It decides whether a defensible backend source
exists and names the contract M5.5 would implement.

**Every conclusion here belongs to one build**, ProteoWizard `3.0.26013
(47b13cf)`. Nothing in it transfers to another build without re-measurement, and
the M0 spike's conclusions — taken against `3.0.26204 (a09eea9)` — are
deliberately not carried across.

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
| Release (from `msaccess` own output) | `3.0.26013` |
| Release with revision (from sibling `msconvert` in the same distribution) | `3.0.26013 (47b13cf)` |
| Build date (both tools) | `Jan 13 2026 14:42:37` |
| `msaccess.exe` bytes | `12,898,816` |
| `msaccess.exe` SHA-256 | `85681B205569A9850F47D079749E04BA45F4B0C64E363D4A2C5C67C3C67ED1F4` |
| `msconvert.exe` SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` |

`msaccess` in this build emits the release but **not** the source revision, which
is the same limitation M0 recorded for its own build. The revision `47b13cf` is
established from `msconvert` in the same distribution — same build date — and is
independently corroborated by the installation directory name. Every source
citation below is pinned to `47b13cf` on that basis.

### Complete help capture

Both forms were captured to files rather than through a pipe, so neither stream
was truncated. `msaccess` writes help to **stderr** and exits `1`; `stdout` is
empty, which is the empty-stream digest below.

| Invocation | Exit | stdout bytes | stderr bytes | stdout SHA-256 | stderr SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `msaccess` (no arguments) | `1` | `0` | `8,027` | `E3B0C442…B855` | `44B9D4634B7F8F234BE8BD8E30F6C20CC317777898A933CF4915EA56F815E073` |
| `msaccess --help` | `1` | `0` | `28,873` | `E3B0C442…B855` | `81C280BDFA15F8130D541CFC079345E31F3D86FDB0C1713CEF19104866743553` |

Neither stream was truncated: both end in the build's own release/build-date
footer, and the byte counts are the complete captures.

The bare form carries the complete `Analysis commands (used with -x/--exec):`
section, which is the candidate inventory below. `--help` adds spectrum-filter
detail only.

## Sources measured

Both are external to the repository, pinned by hash, and verified **before**
execution. Neither payload is committed.

| | Synthetic fixture | Representative acquisition |
| --- | --- | --- |
| Identity | ProteoWizard `example_data/tiny.pwiz.1.1.mzML` | PRIDE `PXD081190`, `BBM_506_P110_31_MIA_004_30_calibrated.mzML` |
| Licence | Apache-2.0 (ProteoWizard) | Creative Commons Public Domain (CC0) |
| Bytes | `25,072` | `208,408,454` |
| SHA-256 | `711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83` | `262D1178303CD934223239D5D93A3B842DCA69DA09CEF58E95A39B950D26B7E8` |
| Spectra | `4` (MS1 ×3, MS2 ×1) | `36,319` (MS2 only) |
| Retention times | `353.43`, `359.43`, `0.00`, `42.05` | `55` … `1980`, all distinct |

Both hashes are the ones M0 pinned, re-verified here. The representative was
reacquired from the official PRIDE location; its accession, CC0 licence and
advertised size were re-queried live before download.

**The synthetic fixture's arrays are not what its headers say.** Its stored CV
metadata declares `mzLow 400.39 / mzHigh 1795.56`, while its actual binary arrays
are the small integers `0 … 14` (indices 0 and 3) and `0, 2, … 18` (index 1).
That is `examples::initializeTiny` synthetic data, and it is what makes exact
window arithmetic checkable by hand below.

## Live candidate inventory

Every analysis command the installed build declares, with its exact installed
signature, verbatim from the help capture.

| # | Candidate | Exact installed signature |
| --- | --- | --- |
| 1 | `metadata` | *(no parameters)* |
| 2 | `run_summary` | `[msLevels=<int_set>] [charges=<int_set>] [delimiter=<fixed\|space\|comma\|tab>]` |
| 3 | `spectrum_table` | `[delimiter=<fixed\|space\|comma\|tab>]` |
| 4 | `binary` | `index=<spectrumIndexLow>[,<spectrumIndexHigh>] \| sn=<scanNumberLow>[,<scanNumberHigh>] [precision=<precision>]` |
| 5 | `slice` | `[mz=<mzLow>[,<mzHigh>]] [rt=<rtLow>[,<rtHigh>]]] [index=<indexLow>[,<indexHigh>] \| sn=<scanLow>[,<scanHigh>]] [delimiter=<fixed\|space\|comma\|tab>]` |
| 6 | `tic` | `[mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed\|space\|comma\|tab>]` |
| 7 | `sic` | `mzCenter=<mz> radius=<radius> radiusUnits=<amu\|ppm> [delimiter=<fixed\|space\|comma\|tab>]` |
| 8 | `image` | `[args - see list]`, whose args include `mz=<mzLow>[,<mzHigh>]` |

`sic`'s signature is one this repository had never held. It is recorded here
exactly as the build declares it.

## Classification

| Candidate | State | Basis |
| --- | --- | --- |
| `metadata` | `EXCLUDED_BY_SIGNATURE` | No parameter of any kind, so the required m/z window cannot be expressed. |
| `run_summary` | `EXCLUDED_BY_SIGNATURE` | Parameters are `msLevels`, `charges`, `delimiter`. No m/z window can be expressed. |
| `spectrum_table` | `EXCLUDED_BY_SIGNATURE` | Only `delimiter`. No m/z window can be expressed. |
| `binary` | `EXCLUDED_BY_SIGNATURE` | Only `index`/`sn`/`precision`. No m/z window can be expressed; selecting spectra by index and extracting arrays is the per-scan-process substitute the route already refuses. |
| `slice` | `MEASURED_REJECTED` | Measured on both sources. |
| `tic` | **`MEASURED_ADMITTED`** | Measured on both sources. |
| `sic` | `MEASURED_REJECTED` | Measured on both sources. |
| `image` | `MEASURED_REJECTED` | Measured rather than excluded. |

### On the four signature-only exclusions

Each is excluded by the one category the signature actually establishes: **the
required m/z window cannot be expressed**. For each, the requirement is that the
query accept an explicit m/z interval; the limitation is that its declared
parameter set contains no m/z term at all; and execution cannot change that,
because a parameter the grammar does not declare cannot be supplied. Nothing is
inferred about what these queries compute.

`image` was **not** excluded by signature even though its output is a rendered
gel image, because its args do include `mz=` and the route requires an ambiguous
signature to be measured. It was measured, and is rejected on measurement below.

### What was not treated as evidence

That MSCanvas has no `sic` parser, holds no `sic` signature constant, exposes no
m/z field on `PreviewOperation::Tic`, and invokes none of these from a production
route are facts about this application. None of them was used to exclude
anything.

## Measurement standard

Every applicable candidate was measured to one standard on both sources: exact
invocation, accepted parameter syntax, window semantics, stdout/stderr/output-file
behaviour, schema and row shape, retention times, ordering, scan identity and its
reconciliation with `spectrum_table`, MS-level behaviour, aggregation, no-signal
behaviour, completeness against `MAX_PREVIEW_TEXT_BYTES`, malformed and error
behaviour, and repeatability.

**Exit code is never treated as semantic evidence.** This build exits `0` while
producing no output, while producing a *partial* output, and while silently
ignoring a malformed window — all three are recorded below.

## `tic` — the admitted source

### Accepted parameter forms

| Form | Resolved window | Result |
| --- | --- | --- |
| `mz=0,4` | `0.00–4.00` | accepted |
| `mz=0-4` | `0.00–4.00` | accepted; byte-identical to the comma form |
| `mz=4` | `4.00–4.00` | accepted; a single value is a zero-width window |
| *(omitted)* | `0.00–10000.00` | accepted; a default window, **not** "no window" |

Both the comma form the signature declares and the dash form the build's own
examples use are accepted, and produce identical output. The resolved window is
echoed into the generated file name.

### Window semantics — inclusive at both ends

Checked by hand against the synthetic fixture's real arrays.

| Invocation | index 0 (m/z `0…14`, int. `15…1`) | index 1 (m/z `0,2,…18`, int. `20,18,…2`) |
| --- | --- | --- |
| `mz=0,4` | `65` = 15+14+13+12+11 | `54` = 20+18+16 |
| `mz=2,4` | `36` = 13+12+11 | `34` = 18+16 |
| `mz=4` | `11` | `16` |

Both endpoints are included in all three. Source-backed: `RegionAnalyzer.cpp`
selects the run with `lower_bound(mzRange.first)` and `upper_bound(mzRange.second)`,
which includes a point equal to either bound.

### Aggregation — a sum, read from the pinned source

[`pwiz/analysis/passive/RegionAnalyzer.cpp` at `47b13cf`](https://github.com/ProteoWizard/pwiz/blob/47b13cf/pwiz/analysis/passive/RegionAnalyzer.cpp):

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

**A point is the arithmetic sum of the binary intensities whose m/z lies inside
the inclusive window.** Not a maximum, not an average, and not the file's stored
TIC value: the fixture's stored `totalIonCurrent` is `1.66755e+07`, while the
unwindowed `tic` reports `120` — the sum of that spectrum's actual intensity
array. The result is a **recomputed** trace and must be labelled as one.

### Output schema

```text
# <input file name>
# index<TAB>id<TAB>event<TAB>analyzer<TAB>msLevel<TAB>rt<TAB>sumIntensity
0<TAB>scan=19<TAB>3<TAB>IonTrap<TAB>ms1<TAB>353.43<TAB>65.0000
```

One row per spectrum in scope. `rt` is fixed at 2 decimals, `sumIntensity` at 4.
The column header line is prefixed `#`, which `spectrum_table`'s is not — a
parser must not assume one convention across queries.

### Ordering — source index, not retention time

`RegionTIC::close()` iterates its cache in order and prints every entry
unconditionally. On the synthetic fixture the emitted retention times are
`353.43, 359.43, 0.00, 42.05` — **not** ascending — which proves rows are ordered
by source spectrum index rather than sorted by retention time.

### Scan identity, and where it must not be trusted

| | Unfiltered | With `--filter="msLevel N"` |
| --- | --- | --- |
| `index` column | the source spectrum index | **renumbered to the position in the filtered list** |
| `id` column | the raw source id | the raw source id |

Measured on the synthetic fixture. Unfiltered, `scan=21` is index `2` and
`sample=1 period=1 cycle=22 experiment=1` is index `3`. Under `msLevel 1` the same
two spectra are reported as index `1` and `2`.

**So `index` is a usable identity only for an unfiltered query.** Under a filter
the `id` is the only stable key.

Reconciled against `spectrum_table` on the representative acquisition across all
`36,319` rows at both ends:

| Source | index 0 | index 36318 |
| --- | --- | --- |
| `spectrum_table` id | `0.1.413` | `0.1.43873` |
| `tic` id | `controllerType=0 controllerNumber=1 scan=413` | `controllerType=0 controllerNumber=1 scan=43873` |

The indices agree exactly. The ids are the **abbreviated** and **raw** forms of
the same spectrum, which is the dual representation M0 recorded on the tiny
fixture, now confirmed at scale: a consumer must canonicalize rather than
string-compare.

### Empty and no-signal behaviour

- A window containing no signal returns a **complete** table of `0.0000` values —
  measured with `mz=100,200` on the fixture, all four rows present.
- A spectrum with no peaks at all (fixture index 2) is present with `0.0000`.
- **No scan is ever omitted.** An omitted scan and a zero-valued scan cannot be
  confused, because there are no omitted scans.

### MS-level behaviour

`--filter="msLevel N"` composes with `tic` and is applied before the analysis.
On the fixture, `msLevel 1` returns the three MS1 spectra and `msLevel 2` returns
the one MS2 spectrum, with correct windowed sums in both. The representative is
MS2-only and `run_summary` reports `36,319` MS2 spectra.

The capability to gate this already exists and is already computed by the shipped
contract: `TicCapability::SupportedWithMsLevelFilter`.

The renumbering caveat above is the load-bearing MS-level fact, and it is a
consequence of filtering rather than of MS level specifically.

### Completeness and scale

| Fact | Representative |
| --- | --- |
| Spectra in scope | `36,319` |
| Rows returned | `36,319` |
| Output bytes (tab delimiter) | `2,989,606` |
| Bytes per row | `82.3` |
| `MAX_PREVIEW_TEXT_BYTES` | `8,388,608` |
| Headroom | complete, at ~36 % of the bound |

Row count is exactly the spectrum count, so output size is **predictable before
invoking** from a number the product already holds. The existing preview contract
already implements the posture the route requires — a generated file over the
bound is refused whole as `IncompleteParserInput`, and no output at all is
`MissingRequiredOutput` — so "complete below the bound; refuse whole above it" is
the shipped behaviour and needs no new code.

Extrapolating from the measured row width, the bound is reached near **~101,900
scans**. That is arithmetic from one measured acquisition, not a general claim:
row width varies with id length and delimiter.

### Malformed and error behaviour

| Input | Exit | Output | stderr |
| --- | --- | --- | --- |
| `mz=abc,def` | `1` | none | `[RegionTIC::Config] Unable to parse range: mz=abc,def` |
| `mz=` | `1` | none | `[RegionTIC::Config] Unable to parse range: mz=` |
| `mz=4,0` (reversed) | **`0`** | **none** | `Caught unknown exception` |
| `mz=-5,-1` | `0` | complete zero-valued table | none |
| `mz=nan,inf` | **`0`** | **complete table byte-identical to the default window** | none |

Two of these are the reason exit code is not evidence. A **reversed** window
exits `0` and produces nothing. A **non-finite** window exits `0` and silently
returns the *unwindowed* result: its SHA-256 is
`7bf8e058…f951`, byte-identical to the default window's on the same build, and to
the hash M0 recorded for the unfiltered TIC of this fixture on a different one. A caller must therefore reject non-finite and inverted windows itself,
before invoking; it cannot learn about them afterwards.

### The build-specific failure this slice found

On the representative acquisition, `tic` **aborts for some windows**:

```text
[Parabola.cpp::solve()] Matrix is singular.
[MSDataAnalyzerApplication] Caught exception for file <input>.
```

exit `0`, **no output file**.

This is the previously unexplained M0C observation — "TIC: exit 0, no generated
output" — now given a cause. It is not a property of the acquisition being large,
and it is not the query being unsupported.

**Mechanism, established from source and confirmed by measurement.**
`RegionAnalyzer::update` computes `spectrumStats.peak = interpolatedPeak(begin,
end, max)` for *every* spectrum, whichever consumer asked — so `tic` pays for a
peak interpolation it never prints. `interpolatedPeak` fits a parabola to the
three points around the window maximum. If two of those three share an m/z, the
fit is singular and throws, and the exception aborts the whole analysis.

The trigger is present in the representative acquisition. Spectrum index `342`,
window `400–403` (four rows, from a CC0 public dataset):

```text
m/z 401.2151   intensity  108963.5391
m/z 401.2151   intensity 2278863.0000   <- the window maximum, on a duplicate m/z
m/z 402.5356   intensity  107573.5156
m/z 402.8630   intensity  119413.7969
```

The maximum sits on a duplicated m/z, so the parabola receives two identical
x-values. The failing `sic` run over the same window stopped writing at exactly
index `342`, which corroborates the position independently.

**How far it reaches, measured rather than assumed.** At one centre the
behaviour has a sharp width threshold:

| Window | Result |
| --- | --- |
| `mz=400,401` (1 Da) | complete, `36,319` rows |
| `mz=400,402` (2 Da) | complete, `36,319` rows |
| `mz=400,403` (3 Da) | aborted |
| `mz=400,405`, `400,410`, `400,420` | aborted |

And at widths an extraction actually uses:

| Width | Centres measured | Complete | Aborted |
| --- | --- | --- | --- |
| `0.02` Da | 16, from m/z 350 to 1200 | **16** | 0 |
| `0.50` Da | 16, from m/z 350 to 1200 | **16** | 0 |
| `2` Da | 16, from m/z 300 to 1800 | **16** | 0 |

So the defect bites **wide** windows, and every window at a realistic extraction
tolerance returned a complete `36,319`-row result. It is nonetheless
data-dependent and cannot be predicted from the request alone.

**Why this does not block admission.** `RegionTIC` writes its output only in
`close()`, so an aborted `tic` produces **no file at all** — never a partial one.
The existing preview contract already classifies that as
`MissingRequiredOutput`. The failure is therefore detectable with the code that
already ships, and the honest product behaviour — refuse this window, say the
backend could not compute it — is available without approximating anything.

### Repeatability

| Source | Query | Passes | Result |
| --- | --- | --- | --- |
| Synthetic | `tic mz=2,4` | 3 | byte-identical, SHA-256 `2e9ae851…22e7`, 4 rows each |
| Representative | `tic mz=500,502` | 3 | byte-identical, SHA-256 `f326cd1c…b37c2`, `36,319` rows each |

Elapsed times are recorded as observations only and are not a threshold:
representative `tic` runs took `3,313` / `3,681` / `3,758` ms on this host.

## `sic` — measured, rejected

The query whose name means *selected ion chromatogram*, measured to the same
standard.

**It works.** `sic mzCenter=4 radius=2 radiusUnits=amu` on the fixture selects
the inclusive window `[2,6]` and reports `sumIntensity` `55` for index 0
(= 13+12+11+10+9) — the same sum `tic` computes over the same window, through the
same `RegionAnalyzer`. `radiusUnits=ppm` works and resolves as
`mzCenter × radius / 1e6`. It is deterministic across three passes.

It produces **three** files per invocation: `.data.tsv` (one row per matching
peak), `.peaks.tsv` (one row per scan, with `sumIntensity`, `peakMZ`,
`peakIntensity`) and `.summary.txt`.

**Rejected for four measured reasons, any one of which is disqualifying.**

1. **It omits scans.** `RegionSIC::close()` emits a row only
   `if (spectrumStats.sumIntensity)`. The fixture's empty spectrum is absent from
   both tables. On the representative, `peaks.tsv` returned **`3,268` rows for
   `36,319` scans** — `33,051` scans silently missing. Within `sic`'s own output a
   scan with no signal is indistinguishable from a scan that does not exist, which
   is precisely the distinction the route requires a source to be able to make.
2. **It leaves partial output on failure.** `.data.tsv` is written incrementally
   during the scan, so the parabola abort leaves a truncated file — measured at
   **`231` rows** of `36,319`, with exit `0` and no `peaks.tsv` or `summary.txt`.
   A file that size is under `MAX_PREVIEW_TEXT_BYTES` and would be accepted as a
   complete document by the existing contract. `tic` has no such failure mode.
3. **Its peak columns are interpolated, not measured.** `interpolatedPeak`
   returns the vertex of a parabola fitted to three points, returning a real
   measured point only when the maximum is at the window edge. `peakMZ` and
   `peakIntensity` are therefore in general coordinates no instrument recorded.
   `sumIntensity` is honest; the peak columns are not, and a source whose
   headline columns are synthetic is the wrong thing to build a scientific view on.
4. **Its output file names collide.** The generated names encode only
   `mzCenter` — `…sic.4.0000.data.tsv` — and not the radius, so two different
   radii at one centre overwrite each other in a shared output directory.

`sic` is capable of answering the question. It is rejected because `tic` answers
the same question with complete scan coverage, no partial artifacts and no
synthetic coordinates.

## `slice` — measured, rejected

`slice mz=2,4` returns one row per matching **peak** — `index, id, event,
analyzer, msLevel, rt, m/z, intensity` — with the same inclusive window.

Rejected because:

- **It is not a chromatogram.** It performs no per-scan aggregation, so it
  answers "which peaks are in this region", not "what is the intensity in this
  window as a function of scan".
- **It omits scans**, exactly as `sic` does: the fixture's empty spectrum is
  absent.
- **Its size scales with peak count rather than scan count**, so the completeness
  bound cannot be predicted from the spectrum count before invoking.
- **It leaves partial output on failure**, sharing the parabola abort
  (`slice mz=400,403` on the representative aborted on both of two passes).

## `image` — measured, rejected

Measured rather than excluded by signature, because its args do include `mz=`.
`image mz=0,4` on the synthetic fixture returned exit `0` with **no output** and
`invalid vector subscript` / `Caught exception`. It produces a rendered
pseudo-2D-gel image rather than a table, so it carries no per-scan intensity and
no result identity. Rejected.

## Why the admitted candidate is sufficient

`tic mz=<mzLow>,<mzHigh>` can truthfully name every element §18 requires:

| Required | Named as |
| --- | --- |
| Requested m/z window | absolute `mzLow,mzHigh`, inclusive both ends; single value = zero width |
| Produced quantity | arithmetic sum of in-window binary intensities, pinned to `RegionAnalyzer.cpp` at `47b13cf`; a recomputed trace, not the stored TIC |
| Result ordering | source spectrum index order |
| Result identity | `index` for an unfiltered query, reconciled across `36,319` rows; `id` otherwise, requiring canonicalization between abbreviated and raw forms |
| MS-level applicability | `--filter="msLevel N"` composes; **`index` is renumbered under any filter** |
| Empty behaviour | complete table of explicit `0.0000`; no scan omitted |
| Completeness / refusal bound | one row per spectrum, `82.3` bytes/row measured; complete below `MAX_PREVIEW_TEXT_BYTES`, refused whole above it, already implemented |
| Capability signature to gate it | `analysis_query("tic")` with an `mz` parameter, plus `--filter`; already computed as `TicCapability::SupportedWithMsLevelFilter` |

with two named limitations M5.5 must carry rather than approximate away:

- a **non-finite or inverted window must be rejected before invoking**, because
  the backend answers the first silently with the unwindowed result and the
  second with exit `0` and no output;
- a **wide window may abort** on this build with no output, detectable as
  `MissingRequiredOutput` and honestly reportable as a refusal.

## Capability contract

**No production code was changed.** The existing generic model already holds
every live signature: `InstalledHelpCapabilities::analysis_query` returns a
`NamedGrammarDeclaration` for `sic` and `slice` with no new parsing, exact
signature text, required/optional parameter facts, and closed value sets — so
`radiusUnits` admits exactly `amu` and `ppm`. One test was added to pin that,
because "the contract can already express the candidate inventory" is a claim
worth checking rather than asserting.

## Decision inputs for XIC-D1 … D5

M5.4 supplies evidence. It does not answer these.

| | Evidence established | Still a product decision |
| --- | --- | --- |
| **D1** — window expression and unit posture | `tic` accepts **absolute m/z bounds only**; it has no ppm form. `sic` has `radiusUnits=amu\|ppm` but is rejected, so a ppm tolerance would have to be converted to absolute bounds by MSCanvas. The backend establishes no m/z unit, so the existing `UnitState::Unreported` posture applies. | Whether the interface offers ppm, Da, or both; and the default tolerance. |
| **D2** — MS-level scope | `--filter="msLevel N"` composes and returns correct windowed sums. **It renumbers `index`**, so a filtered query must key on `id`. The representative is MS2-only. | The default MS level, and whether filtering is offered at all. |
| **D3** — aggregation | Constrained by D4: the admitted source computes a **sum**. A maximum-intensity trace is not available from `tic`; only `sic`'s interpolated peak offers one, and `sic` is rejected. | Whether "sum" is the quantity the product wants to present, given it is the only one on offer. |
| **D4** — backend source query | **Evidence-determined.** Exactly one candidate was admitted: `tic mz=`. The other three applicable candidates were measured and rejected on their own merits, so no choice between viable sources remains. | — |
| **D5** — panel and value-axis presentation | The value is a summed, unitless intensity; one point per scan; complete coverage including explicit zeros; rows in source-index order with `rt` available per row. | Whether the axis is retention time or index, how a refused window is shown, and how a recomputed trace is labelled. |

Because D4 is evidence-determined and no second viable source remains, this slice
does not reach `USER_DECISION_REQUIRED`.

**D1, D2, D3 and D5 all remain open.** D3 is *constrained* — a sum is the only
aggregation any admitted query offers — but constrained is not decided, and the
product has not accepted a sum as the quantity to present. M5.5 may not begin
until all four are settled.

## What was not done

No XIC was implemented: no operation, no capability gate, no parser, no DTO, no
service command, no frontend, no cache, no export, and no new selection
authority. No `PreviewOperation` was extended. No product decision was made
because a backend happens to support something.

No pseudo-XIC was substituted at any point: no base-peak m/z filtering, no
base-peak intensity as extracted intensity, no TIC/BPC summary column, no
per-scan backend process, no whole-run transfer into the webview, no frontend
extraction, and no fabricated zero-valued scans.

## Limitations

- **Every conclusion belongs to `3.0.26013 (47b13cf)`.** The parabola abort in
  particular is a property of this build's `interpolatedPeak`, and another build
  may or may not carry it. `msaccess` does not emit its own revision, so a
  consumer of this record must re-establish the build identity the way this slice
  did.
- One representative acquisition, MS2-only, no chromatogram list. It says nothing
  about MS1 extraction behaviour or about acquisitions with duplicate retention
  times.
- **Duplicate retention times were not reachable.** Both measured sources have
  strictly distinct retention times, so the ordering of equal-`rt` rows was not
  observed. It follows from `RegionTIC::close()` iterating its cache in source
  order that duplicates would appear in index order, but that is read from source
  rather than measured.
- Timings are single observations on one host and are not thresholds.
