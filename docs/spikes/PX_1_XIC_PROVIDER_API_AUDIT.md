# PX.1 — XIC provider / API audit

Slice: **PX.1** of the Post-M6 XIC Provider / Runtime Interlude.
Route authority: [ADR 0046](../architecture/adr/0046-post-m6-xic-provider-runtime-route-lock.md).
Baseline: `6c324aa94a4c34e626d6bc2a79af1f8b125426d8`, tree
`523573248a762078dd3966192aeaaad9629579a8`.
Audited: 2026-09-11.

**This audit produces viability, never admission.** No provider is chosen, no
prototype was written, nothing was installed, compiled or executed, and no
numeric fidelity was measured. `XIC_PROVIDER_ADMITTED` and the final provider
choice remain PX.4's. **XIC is not implemented.**

**Evidence classes are kept apart**, because ADR 0046 §3 refuses help text and
API surface as implementation evidence:

| Class | What it means here |
| --- | --- |
| **source-inspected** | Read in a pinned upstream revision or in this repository |
| **documented** | Read in official versioned documentation |
| **locally observed** | Read-only inspection of the installed distribution on this host |
| **historically measured** | Cited from M5.4 or M6.10; not re-run |
| **not yet tested** | Stated as open for PX.2 or PX.3 |

## Viability matrix

| | Direction | Verdict | The one fact that decides it |
| --- | --- | --- | --- |
| **A** | ProteoWizard interface that does not serialize through the passive analyzers | **VIABLE for PX.2**, on a stated trust-boundary question | At the same revision `47b13cf` whose `RegionTIC.cpp:156` writes the fixed four decimals, the data layer exposes `double` arrays with their cvParams, and the installed distribution ships that layer as `pwiz_bindings_cli.dll` |
| **B** | Mature reader or API behind a local worker | **VIABLE for PX.2**, with the unit declaration read by this project rather than by the candidate | `mzdata` decodes mzML binary arrays to raw `f64`/`f32` without rounding, is Apache-2.0 and actively maintained. **Neither it nor pwiz preserves a raw unit accession** — both normalize at parse time — but this repository's own scanner already captures one generally, and already implements the exact four-way distinction for retention time |
| **C** | Minimal aggregation over a lawful full-data source the project already reads | **NOT VIABLE for PX.2 as written** | The premise is false: this product does not read mzML arrays. Its scanner never decodes a binary payload, and its only array access is the refused provider's rounded text, one scan per process |

## C — the premise does not hold, and saying so is the finding

ADR 0046 describes C as "a narrow, project-owned per-scan window sum over mzML
arrays **this product already reads**". Source inspection of this repository
refutes that clause.

**The mzML reader is a metadata scanner and decodes nothing.**
`crates/proteowizard/src/mzml.rs` carries a test named
`binary_payload_is_never_decoded_or_decompressed`, whose body feeds a
`binaryDataArray` declaring `zlib compression` with the literal payload
`!!! not base64 !!!` and asserts the document still inspects cleanly — the
comment states this "is only possible because no decode path exists". The single
`.decode()` call in that file is `quick-xml`'s entity-name UTF-8 decode, not a
base64 or zlib path. **source-inspected.**

`MzmlSpectrumRecord` accordingly carries facts *about* arrays and never their
values: `default_array_length`, `binary_array_count`, `mz_precision`,
`intensity_precision`, `compression`, `array_kinds`, `representation`.
**source-inspected.**

**The only array access in the product is the refused provider's text.**
`PreviewOperation::SpectrumByIndex { index, precision }` lowers to
`binary index={index} precision={precision}` with `precision <= 15`, and
`interpret_preview` parses that output into
`SelectedSpectrumResult { mz_values: Vec<f64>, intensity_values: Vec<f64>, … }`
beside `NumericPrecisionEvidence { requested_fraction_digits,
observed_maximum_fraction_digits }`. That is decimal text at a requested
precision, produced by the executable M5.4 refused, **one scan per process
launch**. **source-inspected.**

Two independent rules already close that route. ADR 0046 §3 holds that rounded
provider text is never the scientific source, and M5.4's refusal conditions list
**"no per-scan backend process"** among the pseudo-XIC substitutions it refused
to make. Both are **standing commitments, not measurements**, and are cited as
written rather than re-derived.

**What C would actually require.** A project-owned base64 decoder, a zlib
inflater, little-endian `f32`/`f64` conversion, and full-run traversal to reach
every spectrum rather than one selected index. The crate's manifest declares
`quick-xml` and `thiserror` and nothing else; the workspace declares no base64
and no compression crate. That is **new reader work**, not minimal aggregation
over something already read, and ADR 0046 requires it be said rather than hidden
under that phrase. It would also need at least one new dependency — **a
consequence, not the grounds** — since ADR 0046 makes dependency approval a
per-slice matter for every direction, and B carries a far larger one while
staying viable. **source-inspected.**

C is therefore not viable *as written*. It is not refused as an idea: a later
scope decision could authorize a bounded mzML array decoder, and the existing
scanner already locates and classifies the arrays by accession role
(`ArrayKind::{Mz, Intensity, Time, Unrecognized}`). That is a different slice
with its own dependency approval, and PX.1 has no authority to open it.

## A — the defect is in the text path, not in the data layer

M5.4 refused `msaccess` because `RegionTIC.cpp:156` at revision `47b13cf` writes
`sumIntensity` through `fixed << setprecision(4)` — a pinned line M5.4 quotes
(**source-inspected**, by M5.4) whose consequence it then measured, recording
`1e-6` and `4e-5` both serializing as `0.0000` (**historically measured**, cited
not re-run).
The question ADR 0046 poses is whether ProteoWizard offers a path where the value
does not travel that way. It does, at the same revision:

- `pwiz/data/msdata/MSData.hpp` — `struct BinaryDataArray : ParamContainer` holds
  `pwiz::util::BinaryData<value_type> data` with `value_type = double`, and
  `Spectrum` (inheriting `SpectrumIdentity` and `ParamContainer`) holds
  `size_t index`, `std::string id` and `std::vector<BinaryDataArrayPtr>
  binaryDataArrayPtrs`. **source-inspected**, revision `47b13cf`.
- `pwiz/utility/bindings/CLI/msdata/MSData.hpp` — the managed binding exposes
  `property BinaryDataDouble^ data`, `Spectrum` with `int index` and
  `String^ id`, and `virtual Spectrum^ spectrum(int index, bool getBinaryData)`.
  **source-inspected**, same revision.

**Maintenance**, which ADR 0046 requires per direction: ProteoWizard is a
long-running, actively released project, and the installed build here is dated
`Jan 13 2026` from release `3.0.26013` — **historically measured** by M5.4 and
re-observed unchanged by M6.10. This audit did **not** establish a current
upstream release cadence, and no such claim is made.

So the four-decimal literal is a property of the passive analyzers' **text
serialization**, not of ProteoWizard's data model. cvParams survive on both the
spectrum and each array, which is what ADR 0046 §1's unit and representation
rows need.

**This is an installed interface, not only a source fix.** Read-only inspection
of the distribution this repository already discovers — under `%LOCALAPPDATA%\Apps`,
directory name `ProteoWizard 3.0.26013.47b13cf 64-bit`, corroborating the
revision M5.4 inferred from `msconvert` — finds `pwiz_bindings_cli.dll` at
15,084,032 bytes beside `pwiz.CommonUtil.dll`. **locally observed.** No absolute
path is recorded here, following M5.4's convention.

**Three facts constrain how A could be used, and none of them is a release
number.** Each separates what was **locally observed** from what is inferred from
it, because a directory listing supports fewer conclusions than it appears to:

1. **There is no native library surface.** The distribution ships 18 executables
   and 163 DLLs, and the only files whose names contain `pwiz` are the managed
   binding and `pwiz.CommonUtil.dll`; there is no `pwiz_data_msdata.dll`.
   **locally observed.** That the native C++ library is therefore linked into the
   executables, and that the 15 MB binding is a mixed-mode assembly, are
   **inferences** from those names and sizes — nothing was opened or run. What the
   observation does support on its own is that **no separate native library is
   offered to link against**, so reaching the data layer goes through the managed
   binding, beside which `Microsoft.Extensions.*` assemblies ship. **locally
   observed.**
2. **The distribution bundles proprietary vendor readers.** `Clearcore2.*` and
   `Sciex.*`, `MassLynxRaw.dll`, `Shimadzu.LabSolutions.IO.IoModule.dll`,
   `timsdata.dll`, and boost 1.37 binaries whose filenames carry a `BDAL` build
   tag. It ships `EULA.MHDAC` and `EULA.RawFileReader`, and no file in that
   directory matches a licence, notice or copying name. **locally observed**;
   reading `BDAL` as Bruker Daltonics is an inference from the filename.
   ProteoWizard's own position is that core code is Apache-2.0 while vendor
   libraries carry vendor-specific licences, set out per vendor at
   `proteowizard.sourceforge.io/licenses.html`. **documented.**
3. **That changes the product's relationship to the distribution.** MSCanvas
   today *launches* `msaccess.exe` and `msconvert.exe` as external processes.
   Loading `pwiz_bindings_cli.dll` into a process MSCanvas owns is a different
   relationship to the same user-installed files. It is **not** vendoring, since
   the user installs the distribution and nothing is redistributed — but it is a
   **trust-boundary change, and this audit does not make it**. Recorded with an
   owner rather than left loose: it belongs to **whoever authorizes PX.2**, which
   ADR 0046 already requires for that slice, and direction A cannot be prototyped
   without it.

**A fourth constraint, shared with B.** `CVParam` holds `CVID cvid`,
`std::string value` and `CVID units`, and `UserParam` likewise stores its unit as
a `CVID`; **no raw `unitAccession` or `unitName` string is retained**, and
`CVID_Unknown` is the sentinel for an unrecognized term as well as the default.
So "the cvParams survive" does **not** establish that a declared-but-unrecognized
unit can be told from an absent one, which ADR 0046 §3 subject 7 requires.
**source-inspected**, revision `47b13cf`. The resolution is the same as B's and
is recorded under XIC-S2 below: **this project's scanner reads the declaration**.

A is viable to prototype, with the trust-boundary decision preceding it. What
PX.2 would establish is unknown here and is not claimed — whether the managed
binding can be driven from a project-owned worker under Rust's process ownership,
and what it costs.

**A candidate that is a different `msaccess` executable is a separate matter.**
None is proposed. ADR 0046 keeps the refused digest as a control, and any such
candidate still owes M5.4's three-part re-entry gate in full; this audit narrows
nothing there.

## B — one named reader, with the unit read beside it

The candidate is **`mzdata`**, a Rust library for reading mass-spectrometry data
formats, at `github.com/mobiusklein/mzdata`. One candidate only; no catalogue.

| Fact | Value | Class |
| --- | --- | --- |
| Licence | **Apache-2.0** | documented |
| Version on docs.rs at audit | **0.66.7** | documented |
| Latest tagged release | **v0.66.6**, published 2026-08-30, twelve days before this audit | documented |
| Declared dependencies | At `v0.66.6`: **16 required** and **26 optional** under `[dependencies]`, plus 6 dev-dependencies. **Only the required ones, plus whichever optionals a chosen feature set enables, reach a downstream build** — dev-dependencies never do, and disabled optionals never do. Required ones include `base64-simd`, `flate2`, `bytemuck`, `mzpeaks` and the `mzdata-*` companion crates. **Direct declarations only**; the transitive closure is larger, is feature-dependent, and this audit did not resolve it | documented |
| mzML support | "mzML and indexedmzML" listed among supported formats | documented |

**The numeric contract is the right shape.** `DataArray` holds
`data: Vec<u8>`, `dtype: BinaryDataArrayType`, `compression:
BinaryCompressionType`, `name: ArrayType`, `params: Option<Box<Vec<Param>>>` and
`unit: Unit`, and the module returns decoded values as raw `f64`/`f32` slices
**without rounding conversion**. That is the property M5.4's measured build
lacked. **documented**, not yet tested.

**Two declaration-versus-default losses, and they do not have the same answer.**
This is the part a name in a shortlist cannot tell you:

- `Unit::Unknown` is simultaneously the sentinel for an unrecognized unit and the
  `Default`, so `unit` alone cannot separate *the file declared none* from *the
  library supplied one*. `ArrayType` carries no unit at all, and its
  `as_param()` documents that "if a unit is provided, that unit will be
  specified, otherwise a default unit may be used instead". A reader that
  returns a default unit does not prove the file declared it.
- `SpectrumDescription.ms_level` is `u8`, **not** `Option<u8>`, so the type
  cannot express ADR 0046's `MsLevelUndeclared` state, which this repository's
  own scanner models as `Option<u32>`.

**The two halves do not have the same answer, and the difference is the finding.**

For the **MS level**, reading the spectrum's parameters rather than the
convenience field is a plausible recovery, since an undeclared level is an absent
cvParam rather than a normalized value. **This audit did not establish that the
parser retains that cvParam after populating `ms_level`**, so it is a question,
not a solution.

For the **unit**, recovery through `params` **does not work**, and my first
reading of this was wrong; the resolution is the project-owned one recorded under
XIC-S2 below, not a `mzdata` path. `Param` carries `name`, `value`, `accession:
Option<u32>`, `controlled_vocabulary` and `unit: Unit` — **the unit is already
normalized at the parameter level, and no raw `unitAccession` or `unitName`
string is retained anywhere in the type**. So a declared-but-unrecognized unit
and a wholly absent unit both arrive as `Unit::Unknown`, through `params` exactly
as through `DataArray.unit`. **documented.**

That is not a style question. ADR 0046 §3 subject 7 requires that **no declared
unit may be dropped**, and the run-level refusal in §1 requires telling a declared
unit apart from an undeclared one within a single run. A candidate that cannot
make that distinction cannot satisfy either. `mzdata` offers no such path: its
reader converts the attribute while parsing and
discards the string, with no public hook for raw attributes. **source-inspected**,
`v0.66.6`. **That does not end B**, because the unit declaration does not have to
come from the candidate — this repository's scanner already captures it. The
separation, and its one-snapshot-two-readers consequence, are recorded under
XIC-S2 below.

`SignalContinuity` is `{Unknown, Centroid, Profile}` with `Unknown` as default,
so an undeclared representation is expressible — carrying the same
absent-versus-default caution. **documented.**

**Dependency weight is a real constraint, not an aesthetic one.** This
repository's policy prefers project-owned components and small focused
libraries, and forbids adding a production dependency without explicit approval
and a rationale. **16 required direct dependencies**, before any optional feature
is switched on, is a substantial surface for one window sum and **is the main
argument against B**, separate from its technical fit. That figure is the honest
one to weigh: dev-dependencies and disabled optionals do not enter a downstream
build, so counting them would overstate it. The number that would actually be
vendored is the transitive closure under a chosen feature set, which is larger
still and which **this audit did not resolve** — that resolution, and the
approval, are PX.2's.

## XIC-S2 — decided

**A source whose m/z unit is uniformly undeclared is served, with the unit
preserved as unreported.** It is not refused.

The decision rests on what the existing metadata path can distinguish, as
ADR 0046 requires, not on candidate convenience:

1. **The dimension is established by the array's own accession, not by a unit
   attribute.** This repository's scanner classifies arrays as
   `ArrayKind::{Mz, Intensity, Time, Unrecognized}` by their controlled-vocabulary
   role. An m/z array missing a `unitAccession` is still declared an m/z array;
   the absent attribute is a labelling fact, not an ambiguous quantity.
   **source-inspected.**
2. **The honest state already exists, even though the decision does not.**
   `mscanvas-plot-spec`'s `UnitState` is `{ Known { unit }, Unreported,
   Dimensionless }`, and `Unreported` is documented *"The file reported no unit.
   Nothing may be displayed as one."* So the answer this decision reaches is
   **representable without inventing a state**. **It is not an inherited
   decision**, and saying so matters: the preview crate's own single-variant
   `UnitState::NotEmitted` means the formatter emitted no unit, and the scanner
   retains `unitAccession` only on the retention-time path. **The shipped viewer
   therefore maps a source that declares an m/z unit and one that omits it to the
   same `Unreported`, because it never reads that declaration either way.** The
   existing behaviour supplies a representation, not a precedent. **Two distinct
   types share the name `UnitState`**; this rests on the plot-spec one.
   **source-inspected.**
3. **The existing model already separates absence from a value elsewhere.**
   `RetentionTimeUnitMarker` is `{Second, Minute, Unrecognized, NotEmitted}`, so
   this codebase already treats "no unit emitted" as a first-class recorded fact
   rather than a defect. **source-inspected.**

**What it does not license.** It does not permit inferring, defaulting or
converting a unit. It does not touch the already-decided mixed-unit rule:
differing declared units, or a declared unit beside an undeclared one, on m/z,
retention time or intensity, remain refusals. Uniform absence on the retention
time and intensity axes keeps its separate stated posture.

**Effect on viability and on PX.3.** A candidate must be able to report that the
unit was *not declared* rather than assert one. **Neither candidate can, and the
resolution is not to wait for one.**

The symmetry first. pwiz's `CVParam` holds `CVID cvid`, `std::string value` and
`CVID units`, with no raw `unitAccession` string, so `CVID_Unknown` conflates
unrecognized with absent exactly as `Unit::Unknown` does — **source-inspected**,
revision `47b13cf`. And `mzdata`'s mzML reader converts the attribute to a `Unit`
while parsing and **discards the string**, exposing no public hook for raw
attributes — **source-inspected**, `v0.66.6`. "The cvParams survive" does not
answer this: they survive with the unit already normalized. **Both mature readers
normalize at parse time**, which is a property of this class of library rather
than a defect in either.

**This project already reads what neither of them keeps.** `capture_attributes`
in `crates/proteowizard/src/mzml.rs` captures `unit_accession` as a raw
`Cow<str>` on **every** cvParam it processes, and the scanner already turns that
into the exact four-way distinction ADR 0046 needs — for retention time, as
`RetentionTimeUnitMarker::{Second, Minute, Unrecognized, NotEmitted}`, where
`Unrecognized` is documented *"a unit accession was emitted but is not one this
contract recognizes"* and `NotEmitted` *"no unit accession was emitted"*. **The
capture is general; only the consumption branch for the m/z and intensity arrays
is missing.** **source-inspected.**

So the unit declaration is read by **this project's scanner** while the candidate
supplies decoded arrays. That separation is open to A and B alike, uses machinery
that already ships, and is a **narrow located extension rather than new reader
work**. It does mean one snapshot is read twice, by two readers, which is a real
design consequence and **PX.5's to settle** — not something this audit designs,
and not something it claims already exists.

PX.3 scores subject 7's missing-m/z-unit fixture against
**preserved-as-unreported**, which is now the fixed expected result rather than a
branch.

This is an audit-based semantics decision. **No fidelity was measured.**

## What this audit did not test

Stated so nothing here is read as more than it is. **Not yet tested:** whether
either viable candidate computes a correct window sum; any numeric agreement with
an oracle; any latency or memory figure; whether the managed binding can be
hosted in a project-owned worker at all; whether `mzdata` builds on this
toolchain; cancellation, resource limits and stale-reply behaviour, which remain
PX.5's to establish; and every one of ADR 0046 §3's nine evidence subjects, which
are PX.3's.

## PX.2 handoff

**PX.2 is next, is not started, and is not authorized by this audit.** Both
viable directions reach it only under separate authorization. They are not
*survivors* in ADR 0046's sense — that word is reserved there for the numerically
correct candidates PX.3 leaves, a later and narrower set.

A preferred prototype order of **B then A** is offered on the single ground that
B needs no trust-boundary decision to begin. It is **not part of PX.1's
deliverable and binds nothing**, and it is not a ranking of accuracy or
performance, neither of which was measured.

Neither row carries the unit question: PX.1 answered it, and the answer is that
**this project reads the declaration**. These are **falsification experiments,
not PX.2's acceptance bar**: ADR 0046
makes PX.2 acceptance *“the prototype computes the §1 query on a fixture whose
oracle already exists”*, which is strictly more than any row below.

| Direction | Smallest experiment that could falsify viability | Permission it needs |
| --- | --- | --- |
| **B** | Decode one committed synthetic fixture's arrays through `mzdata` and read back index, id, MS level and retention time, **while the project's own scanner supplies the unit declarations** — confirming the two readers agree on scan identity over one snapshot | Approval to add `mzdata` as a prototype-only dependency, outside the shipped product |
| **A** | Load `pwiz_bindings_cli.dll` from the user's existing installation in a throwaway host and call `spectrum(index, true)`, confirming `double` arrays and scan identity, **with the unit declarations again supplied by the project's scanner** | **A trust-boundary decision** on loading that distribution's assemblies into a process MSCanvas owns, plus whatever .NET runtime the host needs |
| **C** | None. Not carried forward | — |

No new representative acquisition is requested by this slice. The two MS1
acquisitions and any independent reference remain the repository owner's
permission decisions, unchanged, and PX.3 needs them rather than PX.2.

**Unchanged by this audit:** M6's closure, the CNV-D2 source-domain
qualification, M5.4's refusal, M6.10's four dispositions, and the residual
inventory including issue #112 with its existing M7 owner.
