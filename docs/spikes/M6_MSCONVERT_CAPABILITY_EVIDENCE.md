# M6.2 — `msconvert` capability and evidence

**Route outcome: `MSCONVERT_CAPABILITY_MEASURED`.**

Twelve candidates, twelve terminal states, none left pending. **Nine**
`MEASURED_ADMISSIBLE` on a decoded output, **two** `MEASURED_REJECTED` on a
decoded output, **one** `EVIDENCE_BLOCKED` with what is missing and who owns it.
One further item is evidence-blocked *inside* a candidate rather than as one of
its own — a second mzXML drop condition — and is recorded with the blocked list
rather than counted as a thirteenth candidate. **The slice admits nothing into the product.** It
establishes which semantics the installed build was observed performing, so that
[M6.3](../architecture/adr/0043-conversion-completion-route.md#m63--typed-conversionintent)
can type only those and no others.

## Repository baseline

| Fact | Value |
| --- | --- |
| Canonical main at start | `db4c48e5cc72ec6692aeb2fea74d3fe197d25b72` |
| `main` vs `origin/main` | 0 / 0 |
| Worktree / index / untracked | clean |
| Stash | empty |
| Milestones | M6.0 and M6.1 complete; M6.2 unstarted |

## Measured ProteoWizard build

Discovered where this repository's own discovery searches, `%LOCALAPPDATA%\Apps`.
**No absolute executable path is recorded here.**

| Fact | Value |
| --- | --- |
| Tool | `msconvert` |
| Release | `3.0.26013 (47b13cf)` |
| Build date | `Jan 13 2026 14:42:37` |
| `msconvert.exe` bytes | `12,687,872` |
| **`msconvert.exe` SHA-256** | **`9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`** |

**Re-verified after the last measurement**: identical byte length and identical
SHA-256, and the build's own footer still reads `3.0.26013 (47b13cf)` /
`Jan 13 2026 14:42:37`. Nothing measured below could have been produced by a
different binary that replaced this one mid-run.

This is the same digest [ADR 0002](../architecture/adr/0002-external-proteowizard.md)'s
descendant `EVIDENCED_PROVIDER_BUILDS` already carries for three vendor families,
and the same one M5.4 recorded as `msaccess`'s sibling. **That changes nothing
about what transfers.** The vendor-family rows are evidence that this build
converted those acquisitions; they are not evidence about `peakPicking`,
precision or mzXML, and this record does not widen them. No row was added,
removed or relaxed.

### Complete help capture

Captured to files rather than through a pipe, so neither stream was truncated.
`msconvert --help` writes to **stdout** and exits `0`.

| Invocation | Exit | stdout bytes | stderr bytes | stdout SHA-256 |
| --- | --- | --- | --- | --- |
| `msconvert --help` | `0` | `34,486` | `2` | `2597C0A4E81B0E26AA0FA71C943370A29277EA341C7E6BC495BD8B4160465752` |

The capture ends in the build's own release/build-date footer, and the byte count
is the complete capture.

## Evidence is bound to an executable, not to a help text

The rule is [M5.4's](M5_XIC_SOURCE_EVIDENCE.md#evidence-is-bound-to-an-executable-not-to-a-help-text),
inherited unchanged:

> Scientific evidence is transferable only to an executable identity explicitly
> covered by that evidence.

None of the following was treated as evidence that an operation happened:

- the option spellings `--mzXML`, `--32`, `--64`, `--mz32`, `--mz64`,
  `--inten32`, `--inten64`, `--zlib`;
- the filter grammar `peakPicking [<PickerType> …]` or `msLevel <mslevels>`;
- the help text's own statement of which defaults apply;
- the release string `3.0.26013` or the revision `47b13cf`;
- [ADR 0043's provider source reading](../architecture/adr/0043-conversion-completion-route.md#cnv-d2--processing-intent),
  which that ADR itself says "tells M6.2 what to measure and admits nothing";
- the M0 spike's mzXML result, which was measured on a **different executable**
  and is motivation here rather than evidence;
- exit `0`.

Each of those decided *what to run*. Every classification below rests on decoded
bytes of an output file produced by the digest above.

**The decoder refuses rather than rounds.** A binary payload that is not a whole
number of values at its declared width is reported as malformed and decodes to
nothing, and a spectrum whose stored array length disagrees with the length it
declares is reported as such. Truncating to the nearest whole value would let a
torn array come back looking like a shorter healthy one, and every numeric claim
here is a claim about what that decoder returned. No output measured below was
malformed under either rule; the run-level count `X2` misdeclares is a different
thing, and is reported where it is found.

**Two of the help text's own claims turned out to be incomplete**, which is the
concrete reason the rule exists. `--inten32` is marked `[default]` and `--64` is
marked `[default]`, and both are true only under a reading the help does not
give: the effective no-flag posture is **mixed** — m/z at 64 bits, intensity at
32 — and a reader who took either `[default]` marker alone would have the wrong
answer for one array. And `-z [ --zlib ]` reads as an opt-in switch; the
measured no-flag output is **already zlib-compressed**.

## Sources measured

Three, all generated by repository-owned code, none acquired and none
proprietary. They are reproducible from
[`scripts/msconvert_evidence.py`](../../scripts/msconvert_evidence.py):
`python -B scripts/msconvert_evidence.py generate --out <dir>` writes exactly
these bytes.

| | Profile fixture | Multi-source fixture | Unflanked fixture |
| --- | --- | --- | --- |
| File | `m62-profile.mzML` | `m62-multisource.mzML` | `m62-noflank.mzML` |
| Provenance | generated; a pure function of the generator's constants | generated | generated |
| Licence | n/a — synthetic, no acquisition | n/a | n/a |
| Bytes | `10,669` | `11,009` | `10,373` |
| SHA-256 | `3224327B4F6F06C4A6F1A25D1A764F6AE5CBABF9AC3B909EF7F5FA89F9DC9C12` | `8A0A1217B9BF48C7255E2AF822D1A2B1A817E589EAC9E0984AEECB73F400AE90` | `ACBB3345EAFA265A1E57C826469BC6231145726089934B7E40F4D4069F99068D` |
| Spectra | `4` — MS1, MS2, MS1, MS2 | `4`, same, across two source files | `4`, same |
| Points per spectrum | `14, 7, 21, 7` | `14, 7, 21, 7` | `10, 5, 15, 5` |
| Arrays | 64-bit little-endian doubles, uncompressed — the stored bytes *are* the values | same | same |

### Why the values are what they are

**The peak centres and heights are deliberately inexact in binary32.** A
precision measurement taken on `500.0` would pass whatever the encoder did,
because `500.0` is exactly representable at both widths; the whole measurement
would be of the fixture. The centres are `300.12345678901234`,
`500.98765432109876` and `700.55555555555554`, and the heights
`1234.5678901234567`, `20345.678901234567` and `987.65432109876543`. Every
precision claim below compares the decoded output against **two independently
computed references**: the source `float64` value, and that value's exact
`binary32` image computed by `struct.pack('<f', …)`. A result equal to the first
preserved the value; a result equal to the second narrowed it; anything else is
neither, and would be reported as such.

**Each profile peak is seven points with one unambiguous maximum and a zero at
each flank.** The zeros are not decoration. ProteoWizard's wavelet picker refuses
a spectrum whose peak profiles are not separated by zeros, so the first version
of this fixture — which had no flanking zeros — could measure nothing about
`cwt` except that `cwt` rejected it. The unflanked fixture exists to keep that
refusal measurable, deliberately, rather than as an accident of fixture design.

**The second source file is attributed to one MS1 and one MS2 spectrum**, at
indices 1 and 2. This is the fixture's most important design decision. A document
that put the second source file on both MS2 spectra would confound the two
hypotheses the fixture exists to separate: a format that drops by source file and
a format that drops by MS level would delete the same two spectra, and either
result would read as proof of the other.

### The fixtures were proved through the backend's own reader first

Before any transformation was judged, `m62-profile.mzML` was converted with
`--mzML --64 --mz64 --inten64` and the output decoded. **Every value of every
array of every spectrum came back bit-identical to the source**, and the spectrum
count, ids, MS levels and array lengths were unchanged. So the backend holds
these values exactly; anything lost below is lost by the operation under test,
not by the fixture or by a parser.

## Live candidate inventory

Every candidate M6 might admit, with the exact signature the installed build
declares for it, verbatim from the help capture.

| # | Candidate | Exact installed signature |
| --- | --- | --- |
| 1 | `mzXML output` | `--mzXML : write mzXML format` |
| 2 | `peakPicking default picker` | `peakPicking [<PickerType> [snr=<minimum signal-to-noise ratio>] [peakSpace=<minimum peak spacing>] [msLevel=<ms_levels>]]`; `<PickerType>` omitted, which the help documents as "a low-quality (non-vendor) local maxima algorithm" |
| 3 | `peakPicking cwt` | same signature, `<PickerType>` = `cwt` |
| 4 | `peakPicking vendor` | same signature, `<PickerType>` = `vendor` |
| 5 | `peakPicking MS-level scope` | same signature, `msLevel=<ms_levels>`, default `1-` |
| 6 | `msLevel population filter` | `msLevel <mslevels>`, an `int_set` |
| 7 | `precision provider default` | *(no precision flag)* |
| 8 | `precision global` | `--64 … [default]` / `--32` |
| 9 | `precision m/z` | `--mz64` / `--mz32` |
| 10 | `precision intensity` | `--inten64` / `--inten32 … [default]` |
| 11 | `compression zlib on` | `-z [ --zlib ] [=arg(=1)]` |
| 12 | `compression zlib off` | same option, `=off` |

**`no additional centroiding` is deliberately not a candidate.** It is an
MSCanvas invariant, not a provider question, and it needs no provider evidence:
the msconvert argv builder emits no `--filter` at all, and
[`command.rs`](../../crates/proteowizard/src/command.rs)'s
`no_additional_centroiding_never_adds_a_peak_picking_filter` pins that no
argument contains `peakPicking`. Verified from the live tree at this baseline.
Adding it to the inventory would have grown the candidate count without adding a
measurement.

**`mz5`, `mzMLb`, `mgf`, `txt`, numpress, truncation and delta/linear prediction
are not candidates either.** The inventory is finite with respect to *M6 product
semantics* — CNV-001 to CNV-009 — and none of those is a setting M6 proposes to
offer. M6 is not a `msconvert` qualification project.

## Final classification

| Candidate | State | Basis |
| --- | --- | --- |
| `mzXML output` | `MEASURED_REJECTED` | On a two-source document it silently dropped both spectra of the non-default source — exit `0`, empty stderr — and wrote `msRun/@scanCount="4"` over the two `<scan>` elements it actually emitted. CNV-002 is gated on exactly this comparison. |
| `peakPicking default picker` | `MEASURED_ADMISSIBLE` | Profile input became centroid output with **every source peak recovered at exactly its source m/z and exactly its source intensity**, spectrum population preserved, and the output names the algorithm that ran. |
| `peakPicking cwt` | `MEASURED_REJECTED` | On a spectrum it accepted without error it returned **one of the three peaks the source contains**, silently, while the default picker on the same spectrum returned all three with their exact source m/z and intensity. It also aborts outright on input without flanking zeros, leaving an unterminated document that does not parse. |
| `peakPicking vendor` | `EVIDENCE_BLOCKED` | The vendor path was never exercised. On an open source the request silently produced the local-maximum picker instead. Missing: a lawful vendor acquisition. |
| `peakPicking MS-level scope` | `MEASURED_ADMISSIBLE` | `peakPicking <PickerType> msLevel=<set>` centroided exactly the named levels and left the others profile. The *mechanism* is admitted; **it is not composable with anything admitted** — see below, because that consequence decides what M6.3 may build. |
| `msLevel population filter` | `MEASURED_ADMISSIBLE` | All, MS1-only and MS2-only each returned exactly the requested spectra, with every array untouched. |
| `precision provider default` | `MEASURED_ADMISSIBLE` | Measured as **mixed**: m/z preserved at 64 bits, intensity narrowed to its exact binary32 image. |
| `precision global` | `MEASURED_ADMISSIBLE` | `--64` preserved both arrays exactly; `--32` narrowed both to their binary32 images. |
| `precision m/z` | `MEASURED_ADMISSIBLE` | `--mz64` preserved, `--mz32` narrowed, independently of the intensity setting. |
| `precision intensity` | `MEASURED_ADMISSIBLE` | `--inten64` preserved, `--inten32` narrowed, independently of the m/z setting. |
| `compression zlib on` | `MEASURED_ADMISSIBLE` | Declared `zlib compression`; every decoded value identical to the uncompressed run at the same precision. |
| `compression zlib off` | `MEASURED_ADMISSIBLE` | `--zlib=off` declared `no compression`; same decoded values. |

**No candidate is left unmeasured, and none is closed by anything except its own
observation.** The two evidence-blocked entries name what is missing rather than
guessing at it.

## Measurements

Twenty-nine runs, each into a **fresh empty directory** so that anything besides
the requested output is visible rather than assumed absent. Paths are normalized:
`<fixtures>` is the generator's output directory and `<outdir>` a per-case
temporary directory, both removed after the facts below were captured. The
committed record carries no absolute path, and none of the temporary output
directories was a user destination.

### Numeric precision

The decisive candidate, and the one the route's finite inventory had omitted.

Worked example, spectrum 0's peak apex, m/z and intensity:

| Reference | m/z | intensity |
| --- | --- | --- |
| source, `float64` | `300.1234567890123` | `1234.5678901234567` |
| its exact `binary32` image | `300.1234436035156` | `1234.56787109375` |

| Case | argv | m/z result | intensity result |
| --- | --- | --- | --- |
| `D1` | *(no precision flag)* | declared `64-bit float`, **exact `float64`** | declared `32-bit float`, **binary32 image** |
| `P4` | `--64` | declared `64`, exact `float64` | declared `64`, exact `float64` |
| `P3` | `--32` | declared `32`, binary32 image | declared `32`, binary32 image |
| `P1` | `--mz64 --inten64` | declared `64`, exact `float64` | declared `64`, exact `float64` |
| `P2` | `--mz32 --inten32` | declared `32`, binary32 image | declared `32`, binary32 image |
| `P5` | `--mz32 --inten64` | declared `32`, binary32 image | declared `64`, exact `float64` |

Each result is the answer for **every array of every one of the four spectra**,
not a spot check: the classification is `all(output == source)` or
`all(output == binary32(source))` across the whole document, and any mixture
would have been reported as `NEITHER`.

**The provider default is mixed, and stating it as one number would be wrong.**
`--64` is marked `[default]` in the help and `--inten32` is marked `[default]` in
the same list; the measured no-flag behaviour is m/z at 64 and intensity at 32.
MSCanvas issues no precision flag today, so **every conversion this product has
ever performed has narrowed its intensities to binary32**, and nothing in the
repository said so. That is a fact for M6.3 to type and M6.4 to show; M6.2 does
not decide it.

### Compression

| Case | argv | declared | decoded values |
| --- | --- | --- | --- |
| `C1` | `--64 --zlib` | `zlib compression` | identical to `C2` |
| `C2` | `--64 --zlib=off` | `no compression` | identical to `C1` |
| `D1` | *(no compression flag)* | `zlib compression` | — |

Both compression cases are pinned at `--64` so that precision is held constant
and only the encoding varies. **Every array of every spectrum decodes to the same
numbers under both**, which is the claim; the file sizes (`12,651` compressed
against `12,854` uncompressed) are recorded but prove nothing scientific and are
not the basis.

**Compression is on by default.** `D1` passed no compression flag and its arrays
are declared `zlib compression`. MSCanvas's unconditional `--zlib` therefore
selects the behaviour it would have got anyway, and `--zlib=off` is what changes
it. **Compression and precision remain two decisions**: `D1` and `C1` differ in
their intensity values while both are zlib, which is precision; `C1` and `C2`
differ in encoding while their values agree, which is compression.

### MS-level population selection

Source: 4 spectra, ids `scan=1 … scan=4`, levels `1, 2, 1, 2`, array lengths
`14, 7, 21, 7`.

| Case | argv | spectra kept | exactly the requested population | arrays untouched |
| --- | --- | --- | --- | --- |
| `L3` | *(no filter)* | `scan=1, scan=2, scan=3, scan=4` | yes | yes |
| `L4` | `--filter "msLevel 1-"` | same | yes | yes |
| `L1` | `--filter "msLevel 1"` | `scan=1, scan=3` | yes | yes |
| `L2` | `--filter "msLevel 2"` | `scan=2, scan=4` | yes | yes |

"All" is a stated baseline rather than an omission: `L4` expresses it explicitly
and its output is **byte-identical to `L3`** once the recorded command line, the
index and the file checksum are removed. Array lengths are carried through
unchanged in every case, so the filter selects spectra and does nothing else to
them.

### Peak picking

Source profile peaks per spectrum: `2, 1, 3, 1` over `14, 7, 21, 7` points.

| Case | argv filter | exit | points out | centroid flags | picker named in the output |
| --- | --- | --- | --- | --- | --- |
| `K1` | `peakPicking` | `0` | `4, 1, 7, 1` | all centroid | `local maximum peak picker` |
| `K2` | `peakPicking cwt` | `0` | `2, 1, 1, 1` | all centroid | `CantWaiT (continuous wavelet transform) peak picker` |
| `K3` | `peakPicking vendor` | `0` | `4, 1, 7, 1` | all centroid | **`local maximum peak picker`** |
| `K4` | `peakPicking cwt msLevel=2` | `0` | `14, 1, 21, 1` | MS2 only | `CantWaiT …` + `ms levels` |
| `K10` | `peakPicking cwt msLevel=1-2` | `0` | `2, 1, 1, 1` | all centroid | `CantWaiT …` + `ms levels` |
| `K11` | `peakPicking msLevel=2` | `0` | `4, 1, 7, 1` | **all centroid** | `local maximum peak picker`, **no `ms levels`** |
| `K7` | `peakPicking cwt` on the unflanked fixture | **`1`** | — | — | — |
| `K8` | `peakPicking` on the unflanked fixture | `0` | — | all centroid | `local maximum peak picker` |

Four findings, each load-bearing.

**1. The requested algorithm is verifiable, but only through a `userParam`.** The
output's `processingMethod` carries `MS:1000035 peak picking` for all three
selectors — the CV term is identical whichever ran — and then a bare
`<userParam name="…"/>` naming the implementation. So a check that compared CV
accessions could not tell the algorithms apart; the distinguishing token is free
text. That is what M6.3 has to build its integrity comparison on, and it is
weaker than a CV accession.

**2. `vendor` silently substituted.** On an open mzML source there is no vendor
reader, and `peakPicking vendor` exited `0`, emitted no warning, and produced
output **identical to the default picker's in every respect except the recorded
command line, the index and the checksum** — every decoded array equal, byte for
byte after normalization. The substitution is invisible at the process boundary
and visible only in the output's `userParam`. This is the reason candidate 4 is
`EVIDENCE_BLOCKED` rather than admitted: what was measured is the fallback, not
the vendor algorithm.

**3. `peakPicking msLevel=2` does not mean what it looks like.** `msLevel=` is
positional *after* `<PickerType>`. With no picker token, `K11` consumed
`msLevel=2` as the picker name, fell back to the local-maximum algorithm, and
**centroided every MS level** — while exiting `0`. Its output records
`local maximum peak picker` and, unlike `K4` and `K10`, carries no `ms levels`
userParam at all. A product that expressed "centroid MS2 only" this way would
silently centroid MS1 as well. **M6.3's argv mapping must always emit an explicit
`<PickerType>` before `msLevel=`.**

**4. `cwt` has an input precondition and fails hard when it is unmet.** On the
unflanked fixture, `K7` exited `1` with
`[CwtPeakDetector::getScales] m/z profile data seems to lack flanking zeros between peak profiles`
and left a **`3,882`-byte partial document** in the output directory against a
`12,497`-byte baseline. That document is not merely short: it **does not parse**
— `no element found: line 55, column 0` — so what a failed `cwt` run leaves
behind is an unterminated XML file, not a smaller valid one. The default picker (`K8`) converted the same input
without complaint. MSCanvas's own boundary contains this — ADR 0009 stages into a
private directory and the integrity gate refuses a partial output — but the
provider fact is that a user-selected algorithm can abort a conversion on data
another algorithm accepts.

**5. The two pickers differ in what they did to the signal, and the difference
is not a count.** Reading the intensities beside the m/z values separates two
things a point count cannot:

| | spectrum 0 — 2 source peaks | spectrum 2 — 3 source peaks |
| --- | --- | --- |
| default picker, entries out | `4` = **2 non-zero** + 2 zero-intensity | `7` = **3 non-zero** + 4 zero-intensity |
| default picker, non-zero points | exactly the source apexes, m/z **and** intensity bit-identical | exactly the source apexes, m/z **and** intensity bit-identical |
| `cwt`, entries out | `2` = 2 non-zero | `1` = **1 non-zero** |
| `cwt`, non-zero points | exactly the source apexes | **only `500.9876543210988`** — `300.1234…` and `700.5555…` are gone |

The default picker's extra entries carry **zero intensity** and sit at
`apex ± 0.04`; they are padding, not peaks, and every real peak survives with its
exact value. `cwt` emits no padding and, on the three-peak spectrum, **dropped two
real peaks** — exit `0`, empty stderr, no counter. That is the observation
candidate 3 is rejected on: an algorithm that silently discards signal a second
algorithm recovers exactly, on the same input, has not performed the operation
that was requested.

**What that rejection does and does not establish.** It is a measurement of this
build on peaks seven points wide, `0.01 m/z` apart, separated by hundreds of m/z
and flanked by hard zeros. That is not instrument-shaped profile data, and the
wavelet detector's scales may simply not match it. So the rejection is scoped:
**on the evidence available, `cwt` fails**, and re-opening it needs a
representative profile acquisition rather than an argument. What it is not is a
general claim that ProteoWizard's wavelet picker is unfit. The default picker's
own result is scoped the same way — it was exact here, and that is a statement
about here.

**And a point count is not a peak count.** The zero-intensity padding means an
integrity check that compared output array lengths against an expected peak
count would be wrong about a correct conversion. M6.3 and M6.9 need that.

### mzXML

| Case | source | argv | exit | spectra out | `msRun/@scanCount` | actual `<scan>` |
| --- | --- | --- | --- | --- | --- | --- |
| `X1` | profile | `--mzXML --64` | `0` | `4` | `4` | `4` |
| `X2` | multi-source | `--mzXML --64` | `0` | **`2`** | **`4`** | **`2`** |
| `X3` | multi-source | `--mzML --64` | `0` | `4` | — | — |
| `X5` | profile | `--mzXML --64 --filter peakPicking` | `0` | `4` | `4` | `4` |

**Single-source mzXML is faithful.** `X1` kept all four spectra with their MS
levels and point counts, declared `precision="64"`, and its decoded m/z and
intensity arrays are **exactly equal to the source `float64` values**.

**Multi-source mzXML drops spectra silently and then misdeclares the count.**
The fixture's source-file attribution is `SF1, SF2, SF2, SF1` over levels
`1, 2, 1, 2`. `X2` kept scan numbers `1` and `4` — **levels 1 and 2**, which are
exactly the two `SF1` spectra and span both MS levels. The survivors are
therefore selected by source file and not by MS level, which is the confound the
fixture was built to exclude. `X3` is the control: the same document to mzML kept
all four spectra and preserved their `sourceFileRef` attribution, so the drop is
the mzXML writer's and not the reader's.

And the header is worse than the drop. `msRun/@scanCount="4"` stands over two
`<scan>` elements. A consumer that trusted the declared count — as a count-based
integrity check would — **would read a two-spectrum document as a complete
four-spectrum conversion**. Exit was `0` and stderr was empty.

**What is not measured, and is not claimed.** The provider source reading names a
second mzXML drop condition — a Thermo spectrum not from
`controllerType=0 controllerNumber=1`. Exercising it needs a lawful Thermo
acquisition with more than one controller, which this evidence task does not
have. That condition is `EVIDENCE_BLOCKED` and is recorded as such below; the
source-file condition above is measured and is sufficient on its own for the
classification, because CNV-002's gate is a source/output comparison and this
build fails it.

**M6.2 does not make the disposition.** `MZXML_ADMITTED`, `MZXML_REFUSED` and
`EVIDENCE_BLOCKED` are
[M6.10's](../architecture/adr/0043-conversion-completion-route.md#m610--evidence-gated-side-routes)
to declare. What is handed over is a measured refusal on the gate CNV-002 names.

### Interaction and ordering

Composition is not inferred from isolated passes.

| Case | argv filters, in order | spectra out | points out |
| --- | --- | --- | --- |
| `K5` | `peakPicking cwt`, then `msLevel 2` | `scan=2, scan=4` | `1, 1` |
| `K6` | `msLevel 2`, then `peakPicking cwt` | `scan=2, scan=4` | `1, 1` |

For this pair the outputs are **identical once the recorded command line, index
and checksum are removed**. That is one measured pair on one source, and it is
recorded as exactly that: it does not establish that filter order is generally
irrelevant, and the build's own help says the opposite in general.

Three further compositions were measured:

| Case | Composition | Result |
| --- | --- | --- |
| `K12` | `--32` with `peakPicking` | same entry count as `K1` at `--64`, and every value the exact `binary32` image of `K1`'s — a filter that rewrites the arrays does not defeat the precision choice |
| `X5` | `--mzXML` with `peakPicking` | `4` spectra, entries `4,1,7,1`, `centroided="1"`, header count honest |
| `K4`, `K10` | a picker with an MS-level scope | the named levels centroided, the others left bit-identical to the source |

**Every composition M6.3 may represent as evidenced is limited to these four.**
Anything else — a picker with `--mzXML` at `--32`, two filters other than this
pair, an MS-level filter composed with a format change — remains unmeasured, and
M6.3 may not claim it.

### The consequence that decides what M6.3 may build

**No scoped centroiding intent is constructible from admitted parts today**, and
the record entails it rather than merely permitting it:

1. `msLevel=` is positional after `<PickerType>`, and `K11` measured what happens
   without one — the scope is silently discarded and every MS level is
   centroided. So a scoped intent **must** name a picker.
2. The installed grammar says `<PickerType>` "must be `cwt` or `vendor`". **There
   is no token that selects the default picker**; it is what you get by writing
   nothing, which is exactly the form step 1 rules out.
3. `cwt` is `MEASURED_REJECTED` and `vendor` is `EVIDENCE_BLOCKED`. The only
   `MEASURED_ADMISSIBLE` algorithm is the default one, which cannot be named.

So the MS-level scope is admitted as a mechanism and is **unreachable in
combination with any admitted algorithm**. M6.3 may type unscoped centroiding on
the default picker, and may not type "centroid MS2 only" or "centroid MS1+MS2" at
all — not by naming `cwt`, not by naming `vendor`, and not by omitting the picker
and hoping the scope applies. Re-opening those two product presets needs the same
thing `cwt`'s rejection needs: a representative profile acquisition, or a lawful
vendor acquisition for the vendor path.

### Working-directory side output

**Disposition: `TRIGGERED_AND_MEASURED`.** The obligation is conditional on a
non-mzML format still being a viable admission candidate, and mzXML remains one
for single-source inputs, so the condition holds. It was then measured on every
run rather than only the mzXML ones.

**All twenty-nine runs produced exactly one file.** Every case ran into a fresh
empty directory, and each directory afterwards held exactly its one output — no
sidecar, no index file, no log, no scratch entry. This holds for the six mzXML
runs specifically, including `X4`, which supplied no `--outfile` and let the
backend name the output itself (`m62_profile.mzXML`). The `K7` failure case is
the one to read carefully: it produced exactly one file too, and that file was a
**partial** document rather than an extra one.

## Candidate-standard matrix

The mechanical answer to *were all candidates closed to the same standard?* The
dimension vocabulary is not chosen here: it is
[ADR 0043's M6.2 candidate evidence dimensions](../architecture/adr/0043-conversion-completion-route.md#m62-candidate-evidence-dimensions),
and repository validation requires this table to name exactly those dimensions,
each once, with one row per candidate the classification records. Every cell is a
located result or an explicit `NOT_APPLICABLE` with its reason.

| Candidate | Expressibility | Execution | Output existence and readability | Requested semantic occurred | Cardinality / population | Numeric fidelity | Encoding / compression | Interaction / ordering | Working-directory side output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mzXML output` | `--mzXML` accepted | `X1`, `X2`, `X5` exit `0` | mzXML parsed with no malformed array and no per-scan length disagreement; `X2`'s **run-level** header declares `4` over `2` written | single-source faithful; multi-source **drops the non-default source file silently** | `X1` `4`/`4`; `X2` **`2`/`4`** with `scanCount="4"`; `X3` control `4`/`4` to mzML | `X1` arrays decode exactly equal to the source `float64` at `precision="64"` | `X1` declared `zlib`, decoded exactly | `X5` composed with `peakPicking`: `4` spectra, counts `4,1,7,1`, header honest | `X1`, `X2`, `X4`, `X5`: one file each; `X4` named by the backend |
| `peakPicking default picker` | `peakPicking` accepted with no picker token | `K1`, `K8` exit `0` | mzML parsed | profile → centroid on every spectrum; every source peak recovered | `4`/`4` spectra preserved; entries `4,1,7,1` for source peaks `2,1,3,1`, the surplus being **zero-intensity padding** at `apex ± 0.04` | **every non-zero point is bit-identical to its source apex**, m/z and intensity, at `--64` | inherits the run's encoding; `K1` at `--64` declared `zlib` | `K11` shows the bare form silently discards `msLevel=`; `K12` composes with `--32`; `X5` composes with mzXML | `K1`, `K8`, `K12`: one file each |
| `peakPicking cwt` | `peakPicking cwt` accepted | `K2`, `K10` exit `0`; `K7` exit **`1`** on unflanked input | `K2`/`K10` parse clean with no malformed array; `K7`'s `3,882`-byte output **does not parse at all** | profile → centroid, and the output names `CantWaiT …` — but on spectrum 2 **two of three source peaks are absent** | `4`/`4` spectra; entries `2,1,1,1`, all non-zero; the three-peak spectrum returns one | the points it does emit are bit-identical to their source apexes; the two it drops are unrecoverable | inherits the run's encoding | `K5`/`K6` order pair identical; `K10` composes with an MS-level scope | `K2`, `K7`, `K10`: one file each — `K7`'s is partial, not extra |
| `peakPicking vendor` | `peakPicking vendor` accepted | `K3` exit `0` | mzML parsed | **not observed** — the vendor path needs a vendor reader; the run produced the local-maximum picker's output and named it | `4`/`4` spectra, entries identical to `K1` including its zero-intensity padding | identical to `K1`'s, which is the evidence of substitution rather than of the vendor algorithm | inherits the run's encoding | `NOT_APPLICABLE` — nothing admitted here, so there is no composition to evidence | `K3`: one file |
| `peakPicking MS-level scope` | `msLevel=<int_set>` accepted, positional after `<PickerType>` | `K4`, `K10`, `K11` exit `0` | mzML parsed | `K4` centroided MS2 only and left MS1 profile; `K10` centroided `1-2`; **`K11` without a picker token silently ignored the scope** | `K4` `14,1,21,1`; `K10` `2,1,1,1`; `K11` `4,1,7,1` across all levels | the MS1 spectra `K4` left alone are bit-identical to the source, so the scope excludes rather than merely re-picks | inherits the run's encoding | `K5`/`K6` measured in both orders with `msLevel` as a separate filter | `K4`, `K10`, `K11`: one file each |
| `msLevel population filter` | `msLevel <int_set>` accepted; `1`, `2` and `1-` all parsed | `L1`–`L4` exit `0` | mzML parsed | exactly the requested spectra kept, by id | `L1` `scan=1,3`; `L2` `scan=2,4`; `L3`/`L4` all four; array lengths unchanged throughout | arrays carried through untouched at `--64` | inherits the run's encoding | `K5`/`K6` compose it with `peakPicking` in both orders | `L1`–`L4`: one file each |
| `precision provider default` | no flag required | `D1` exit `0` | mzML parsed | **mixed**: m/z 64, intensity 32 | `4`/`4` spectra, arrays unchanged in length | m/z exactly the source `float64`; intensity exactly the source's `binary32` image, every value of every spectrum | declared `zlib` with no flag given | `D1` is the baseline the compression pair is read against | `D1`: one file |
| `precision global` | `--64` / `--32` accepted | `P4`, `P3` exit `0` | mzML parsed | `--64` preserves both arrays; `--32` narrows both | `4`/`4` spectra, arrays unchanged in length | `P4` exact `float64` both arrays; `P3` exact `binary32` image both arrays | both declared `zlib` | `C1`/`C2` hold `--64` fixed while compression varies | `P3`, `P4`: one file each |
| `precision m/z` | `--mz64` / `--mz32` accepted | `P1`, `P2`, `P5` exit `0` | mzML parsed | the m/z array follows the flag independently of intensity | `4`/`4` spectra, arrays unchanged in length | `P5` proves independence: m/z `binary32` image while intensity stays exact `float64` | all declared `zlib` | `K12` composes `--32` with `peakPicking`: same entry count as `K1`, and every value the exact `binary32` image of `K1`'s | `P1`, `P2`, `P5`: one file each |
| `precision intensity` | `--inten64` / `--inten32` accepted | `P1`, `P2`, `P5` exit `0` | mzML parsed | the intensity array follows the flag independently of m/z | `4`/`4` spectra, arrays unchanged in length | `P1` exact `float64`; `P2` `binary32` image; `P5` exact while m/z narrows | all declared `zlib` | `K12` as above — a filter that rewrites the arrays does not defeat the precision choice | `P1`, `P2`, `P5`: one file each |
| `compression zlib on` | `--zlib` accepted | `C1` exit `0` | mzML parsed | arrays declared `zlib compression` | `4`/`4` spectra, arrays unchanged in length | decoded values exactly equal to `C2`'s at the same `--64` | `MS:1000574 zlib compression`; `12,651` bytes | held at `--64` so precision cannot be mistaken for compression | `C1`: one file |
| `compression zlib off` | `--zlib=off` accepted | `C2` exit `0` | mzML parsed | arrays declared `no compression` | `4`/`4` spectra, arrays unchanged in length | decoded values exactly equal to `C1`'s | `MS:1000576 no compression`; `12,854` bytes | same | `C2`: one file |

## Evidence-blocked items, and who owns them

The first is candidate 4's own state. The second is a dimension of candidate 1,
whose classification does not depend on it — recorded here so that a reader
meeting the blocked list does not have to work out which is which.

| Item | What is missing | Owner |
| --- | --- | --- |
| `peakPicking vendor` performing the vendor algorithm | A lawful vendor acquisition of an admitted family, plus authorization to exercise the vendor DLL path. What was measured is the fallback on an open source, which is evidence about the fallback and not about the algorithm. | **M6.10**, which owns the milestone's evidence-gated dispositions. **M6.3 may not type a vendor centroiding intent** while this stands. |
| mzXML's second drop condition — a Thermo spectrum outside `controllerType=0 controllerNumber=1` | A lawful Thermo acquisition with more than one controller. | **M6.10**. The classification of `mzXML output` does not depend on it: the source-file condition alone fails CNV-002's gate. |

## Unverified assumptions

- **The peak-picking algorithms' behaviour on instrument-shaped data.** Both
  results — the default picker recovering every apex bit-exactly, and `cwt`
  dropping two of three peaks — were measured on synthetic seven-point peaks
  `0.01 m/z` apart with hard zero flanks. Neither generalizes. The `cwt`
  rejection is scoped to this evidence and is re-openable by a representative
  profile acquisition; the default picker's exactness is scoped the same way.
- **The zero-intensity padding's origin.** The default picker emits entries at
  `apex ± 0.04` carrying intensity `0.0`. That they are padding rather than
  detections is established by their intensity; *why* the build emits them was
  not investigated, and no claim is made about whether an instrument-shaped
  source would produce them.
- **`userParam` as an integrity witness.** The output names the picker in free
  text rather than by CV accession. It was consistent across every run here and
  correctly reported the `vendor` fallback, but this is one build's convention,
  not a schema guarantee — read as a claim to compare against the request, with
  absence recorded as `unverified` rather than as "nothing happened".
- **Behaviour at scale.** Four spectra of at most twenty-one points. No claim
  about throughput, memory, or large-document behaviour.
- **`msRun/@scanCount` on other paths.** The hollow count was measured on the
  multi-source mzXML case. Whether the same writer misdeclares on other inputs
  was not measured.

## The harness is an inspector, not a validator

Recorded as one item because it is one property, and because review found four
instances of it after this slice's single authorized repair pass had been spent.
`inspect` reports what a document contains; **its silence is not a certificate
of validity**, and no conclusion in this record is drawn from that silence.

| Instance | What it does not catch |
| --- | --- |
| base64 syntax | `b64decode` drops characters outside the alphabet, so a stray `$` in a payload that still decodes to aligned bytes reads as healthy |
| a missing array | a spectrum with no intensity array at all is reported with no malformed flag and no length disagreement |
| mzXML run-level count | `msRun/@scanCount` is not read, so `X2`'s **drop** reproduces through the harness and its **misdeclaration** does not |
| anything else structural | duplicate arrays, absent units, wrong `cvParam`s — none is checked |

**Why none of it is load-bearing here, verified rather than asserted.** Every
numeric conclusion in this record is a *positive equality* against two
independently computed references — the source `float64` value and its exact
`binary32` image — and a document that is missing or wrong fails that comparison
rather than passing it. Run against the fixture:

| Document | malformed flag | length disagreement | the record's own equality check |
| --- | --- | --- | --- |
| healthy | none | none | **passes** |
| intensity array removed | none | none | **fails** |
| stray `$` in a payload | none | none | **passes**, and correctly — dropping the character leaves the decoded bytes, and therefore the values, unchanged |

So the missing-array case would have been caught by the analysis regardless of
the flag, and the stray-character case changes no value the record reports. What
the gaps cost is the ability to *distinguish a corrupt document from a healthy
one*, which this slice never needed and a later one might.

**Owner: M6.10**, the next slice to measure a non-mzML format. The right shape is
strict base64 validation, a required-array check, and the run-level count read
beside the per-spectrum ones — not four separate patches.

## What this record does not do

It admits no setting, exposes no control, changes no argv builder, adds no row to
`EVIDENCED_PROVIDER_BUILDS`, and changes no production conversion behaviour. It
does not decide MSCanvas's precision policy, does not make the mzXML disposition,
and does not start M6.3. Existing-output overwrite behaviour remains an
unobserved provider fact — **not a candidate, not a prerequisite, not a CNV-D4
authority, and not an M6.2 completion condition** — and CNV-D4 is not reopened.
