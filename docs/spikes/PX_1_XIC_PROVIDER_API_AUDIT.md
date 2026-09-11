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
| **A** | ProteoWizard interface that does not serialize through the passive analyzers | **VIABLE for PX.2**, on a stated trust-boundary question | At the same revision `47b13cf` whose `RegionTIC.cpp:156` writes the fixed four decimals, the data layer exposes `double` arrays with their cvParams — and the installed distribution ships that layer as `pwiz_bindings_cli.dll` |
| **B** | Mature reader or API behind a local worker | **VIABLE for PX.2**, with a named adapter obligation | `mzdata` decodes mzML binary arrays to raw `f64`/`f32` without rounding, is Apache-2.0 and actively maintained — but its `Unit` and `ms_level` types lose declaration-versus-default distinctions that ADR 0046 §1 requires, recoverably |
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
to make. **historically measured**, cited not re-run.

**What C would actually require.** A project-owned base64 decoder, a zlib
inflater, little-endian `f32`/`f64` conversion, and full-run traversal to reach
every spectrum rather than one selected index. The crate's manifest declares
`quick-xml` and `thiserror` and nothing else; the workspace declares no base64
and no compression crate. That is **new reader work plus at least one new
dependency**, not minimal aggregation over something already read, and ADR 0046
requires it be said rather than hidden under that phrase. **source-inspected.**

C is therefore not viable *as written*. It is not refused as an idea: a later
scope decision could authorize a bounded mzML array decoder, and the existing
scanner already locates and classifies the arrays by accession role
(`ArrayKind::{Mz, Intensity, Time, Unrecognized}`). That is a different slice
with its own dependency approval, and PX.1 has no authority to open it.

## A — the defect is in the text path, not in the data layer

M5.4 refused `msaccess` because `RegionTIC.cpp:156` at revision `47b13cf` writes
`sumIntensity` through `fixed << setprecision(4)`. **historically measured.**
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
number.** **locally observed:**

1. **There is no native library surface.** The distribution ships 18 executables
   and 163 DLLs, and the only pwiz libraries among them are the managed binding
   and `pwiz.CommonUtil.dll`. There is no `pwiz_data_msdata.dll`; the native C++
   library is linked into the executables. Reaching the data layer therefore
   means loading a **mixed-mode C++/CLI assembly**, which implies a .NET runtime —
   `Microsoft.Extensions.*` assemblies ship alongside it.
2. **The distribution bundles proprietary vendor readers.** `Clearcore2.*` and
   `Sciex.*`, `MassLynxRaw.dll`, `Shimadzu.LabSolutions.IO.IoModule.dll`,
   `timsdata.dll`, and Bruker-built boost 1.37 binaries. It ships `EULA.MHDAC`
   and `EULA.RawFileReader`; no Apache licence file is present in that directory.
   ProteoWizard's own position is that core code is Apache-2.0 while vendor
   libraries carry vendor-specific licences. **documented.**
3. **That changes the product's relationship to the distribution.** MSCanvas
   today *launches* `msaccess.exe` and `msconvert.exe` as external processes.
   Loading `pwiz_bindings_cli.dll` into a process MSCanvas owns is a different
   relationship to the same user-installed files. It is **not** vendoring, since
   the user installs the distribution and nothing is redistributed — but it is a
   **trust-boundary change, and this audit does not make it**. It needs its own
   authorization before PX.2 exercises it.

A is viable to prototype. What PX.2 would establish is unknown here and is not
claimed: whether the managed binding can be driven from a project-owned worker
under Rust's process ownership, and what it costs.

**A candidate that is a different `msaccess` executable is a separate matter.**
None is proposed. ADR 0046 keeps the refused digest as a control, and any such
candidate still owes M5.4's three-part re-entry gate in full; this audit narrows
nothing there.

## B — one named reader, with a named adapter obligation

The candidate is **`mzdata`**, a Rust library for reading mass-spectrometry data
formats, at `github.com/mobiusklein/mzdata`. One candidate only; no catalogue.

| Fact | Value | Class |
| --- | --- | --- |
| Licence | **Apache-2.0** | documented |
| Version on docs.rs at audit | **0.66.7** | documented |
| Latest tagged release | **v0.66.6**, published 2026-08-30, twelve days before this audit | documented |
| Declared dependencies | **41** across normal, optional and dev, including `base64-simd`, `flate2`, `chrono`, `regex`, `bytemuck`, `mzpeaks` and the `mzdata-*` companion crates | documented |
| mzML support | "mzML and indexedmzML" listed among supported formats | documented |

**The numeric contract is the right shape.** `DataArray` holds
`data: Vec<u8>`, `dtype: BinaryDataArrayType`, `compression:
BinaryCompressionType`, `name: ArrayType`, `params: Option<Box<Vec<Param>>>` and
`unit: Unit`, and the module returns decoded values as raw `f64`/`f32` slices
**without rounding conversion**. That is the property M5.4's measured build
lacked. **documented**, not yet tested.

**Two declaration-versus-default losses, and both are recoverable.** This is the
part a name in a shortlist cannot tell you:

- `Unit::Unknown` is simultaneously the sentinel for an unrecognized unit and the
  `Default`, so `unit` alone cannot separate *the file declared none* from *the
  library supplied one*. `ArrayType` carries no unit at all, and its
  `as_param()` documents that "if a unit is provided, that unit will be
  specified, otherwise a default unit may be used instead". A reader that
  returns a default unit does not prove the file declared it.
- `SpectrumDescription.ms_level` is `u8`, **not** `Option<u8>`, so the type
  cannot express ADR 0046's `MsLevelUndeclared` state, which this repository's
  own scanner models as `Option<u32>`.

Neither is irrecoverable, and that distinction is the finding: `DataArray.params`
retains the original cvParams, and `SpectrumDescription` is `ParamDescribed`, so
a **narrow adapter reading the raw parameter lists rather than the convenience
types** can restore both distinctions. PX.2 owes that adapter; a prototype that
trusts `unit` and `ms_level` would silently fabricate declarations.

`SignalContinuity` is `{Unknown, Centroid, Profile}` with `Unknown` as default,
so an undeclared representation is expressible — carrying the same
absent-versus-default caution. **documented.**

**Dependency weight is a real constraint, not an aesthetic one.** This
repository's policy prefers project-owned components and small focused
libraries, and forbids adding a production dependency without explicit approval
and a rationale. A 41-dependency subtree is a substantial surface for one window
sum and **is the main argument against B**, separate from its technical fit. That
approval belongs to PX.2, not here.

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
2. **Refusal would be stricter than the shipped viewer.** `UnitState` in
   `crates/proteowizard/src/preview.rs` has exactly one variant, `NotEmitted`,
   documented as "the formatter emitted a numeric value without a unit". The
   product has **no unit-bearing state at all** today, because the text it reads
   carries none. Refusing unit-undeclared m/z sources for this query would refuse
   sources the viewer already displays, while the viewer itself reports every
   value unit-unreported. **source-inspected.**
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
unit was *not declared* rather than assert one. That is satisfiable in all three
directions only through the raw parameter lists — for B this is the adapter named
above; for A the cvParams survive on the array. PX.3 scores subject 7's
missing-m/z-unit fixture against **preserved-as-unreported**, which is now the
fixed expected result rather than a branch.

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
survivors reach it only under separate authorization. Preferred prototype order
is **B then A**, on the single ground that B needs no trust-boundary decision to
begin; this is an ordering, not a ranking of accuracy or performance, neither of
which was measured.

| Direction | Smallest experiment that could falsify viability | Permission it needs |
| --- | --- | --- |
| **B** | Decode one committed synthetic fixture's arrays through `mzdata` and read back index, id, MS level, retention time and all three unit declarations **from the raw parameter lists**, confirming an undeclared unit is reported as undeclared | Approval to add `mzdata` and its subtree as a prototype-only dependency, outside the shipped product |
| **A** | Load `pwiz_bindings_cli.dll` from the user's existing installation in a throwaway host and call `spectrum(index, true)`, confirming `double` arrays and surviving cvParams | **A trust-boundary decision** on loading that distribution's assemblies into a process MSCanvas owns, plus whatever .NET runtime the host needs |
| **C** | None. Not carried forward | — |

No new representative acquisition is requested by this slice. The two MS1
acquisitions and any independent reference remain the repository owner's
permission decisions, unchanged, and PX.3 needs them rather than PX.2.

**Unchanged by this audit:** M6's closure, the CNV-D2 source-domain
qualification, M5.4's refusal, M6.10's four dispositions, and the residual
inventory including issue #112 with its existing M7 owner.
