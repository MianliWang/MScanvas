# ADR 0056 — A project-owned mzML reader for viewing

Status: **Proposed.** Date: 2026-10-28.
Related: [0002](0002-external-proteowizard.md),
[0003](0003-msaccess-preview-spike.md),
[0005](0005-mzml-preview-boundary.md),
[0044](0044-conversion-configuration-authority.md),
[0046](0046-post-m6-xic-provider-runtime-route-lock.md),
[0047](0047-first-windows-beta-scope-and-implementation-route.md);
ADR 0055 (proposed in PR #146).
Evidence: [installed check, item 5](../../release/beta-1/INSTALLED_CHECK.md#5-exported-numerics),
[M0 Slice 2B](../../spikes/M0_PROTEOWIZARD_SPIKE.md),
[M5.4](../../spikes/M5_XIC_SOURCE_EVIDENCE.md),
[PX.4](../../spikes/PX_4_XIC_PROVIDER_RUNTIME_DECISION.md),
and the mzML reader spike of 2026-10-28 (a local scratch reproduction, not
committed; summarized under [Evidence](#evidence)).

## Context

**Every mzML view is an `msaccess` process.** ADR 0003 accepted ProteoWizard's
`msaccess` for preview, and ADR 0005 drew the boundary around it. Beta 1 made
the costs of that route visible:

- **Exported values are 8-decimal text.** A selected spectrum is read with
  `msaccess -x "binary index=<n> precision=8"` (`SELECTED_SPECTRUM_PRECISION`).
  The installed check found 1,499 of 1,504 exported records different from the
  stored binary values, every one of them rounded to 8 decimal places. It was
  the check's one **FAIL**, accepted for beta 1 and stated in the release notes.
- **Whole output or nothing.** The preview parser needs the backend's whole
  output and reads at most 8 MiB of it (`MAX_PREVIEW_TEXT_BYTES`). A spectrum
  or a spectrum table whose text is larger is refused whole:
  - a 500,000-point profile spectrum is about 13.8 MiB of 8-decimal text (an
    estimate; `msaccess` was not run);
  - at M0's row size (4,013,391 bytes for 36,319 rows), a table above roughly
    76,000 spectra is refused (an estimate; row size varies).
- **One process per click.** Every selected spectrum is a process. M0 Slice 2B
  measured a backend p50 of 164 ms (p95 186–194 ms) on a 208 MB file. One
  backend gate serializes every read, so `open_preview` and `load_spectrum`
  refuse with `conversion_busy` while a conversion runs.
- **Representation is unknown.** The formatter emits no profile/centroid
  marker, so every spectrum is drawn as sticks beside a statement that its
  representation is unreported (ADR 0005).
- **XIC is refused.**
  - M5.4 refused every `msaccess` query that can express an m/z window
    (`XIC_SOURCE_REFUSED`). The deciding reason was region intensities written
    at four fixed decimals, so a small positive signal reads as zero.
  - PX.4 refused the one mature reader evaluated (direction B, mzdata 0.66.6)
    on legal namespace-prefixed mzML (`XIC_PROVIDER_REFUSED`).
  - Direction C was "not viable as defined", because full-array access in the
    product was a false premise.
- **Viewing an open format needs ProteoWizard.** A user without ProteoWizard
  cannot look at an mzML file, though nothing proprietary is involved.

The reader spike asked whether MSCanvas should read mzML in-process for viewing.
It compared a project-owned reader (route b) with mzdata 0.68.0 (route a).

## Decisions

### 1. A viewing-only mzML 1.1 reader, owned by the project

MSCanvas reads mzML for viewing in-process, with its own reader built on
`quick-xml` `=0.41.0` (approved in M0C Slice 2A), `base64` and `flate2`. The
scope is closed.

**It reads:**

- mzML 1.1, plain or wrapped in `indexedmzML`;
- the spectrum list and the chromatogram list;
- `referenceableParamGroup` references and instrument configurations;
- 32- and 64-bit float and integer arrays, zlib-compressed or uncompressed;
- per spectrum: MS level, polarity, profile or centroid (MS:1000127 /
  MS:1000128), scan start time with its declared unit, every precursor, the
  filter string, total ion current, base peak and `defaultArrayLength`.

**It refuses with a typed error, never skipping or guessing:**

- numpress (MS:1002312–1002314, MS:1002746–1002748), and any compression other
  than zlib or none;
- a `DOCTYPE` or a custom entity;
- a `referenceableParamGroupRef` to an undefined group;
- a decoded array whose length differs from its declared length, either way;
- a 64-bit integer value that `f64` cannot hold exactly (decision 5);
- a document or a text run beyond the limits of decision 2.

A corrupt array fails that array or spectrum with a typed error. Nothing
panics, and nothing returns a partial array as if it were whole.

**Out of scope**, each needing its own decision: `.mzML.gz`, mzMLb, imzML,
MGF, non-UTF-8 documents, multi-scan combination semantics, and any
computation over the decoded arrays (XIC, summed spectra, peak picking).

The reader is for viewing only. Conversion, the conversion-integrity
inspector and targeted MS1 are unchanged; the targeted-MS1 worker still reads
its own source.

### 2. A sibling of the bounded inspector

The reader is a new module beside `crates/proteowizard/src/mzml.rs`.

- **It reuses that module's guards:** `BoundedReader`, `MzmlScanLimits`
  (4 GiB document, 256 MiB text run, depth, element and attribute bounds,
  1,000,000 spectra) and the `DOCTYPE`/entity refusal. `BoundedReader` becomes
  `pub(crate)`.
- **The inspector stays decode-free.** Conversion integrity keeps its rule of
  never base64-decoding or decompressing an array.
- **Inflate is capped** at the declared length × width + 1 bytes, and both
  overrun and underrun are refused. A base64 text run is bounded from the
  declared length before it is read whole.
- **Names resolve by namespace, not by literal qualified name.** Prefixed mzML
  was PX.3's deciding B failure, and the spike did not probe it. Slice 1 must
  read a namespace-prefixed document built like PX.3's `prefixed` case and its
  unprefixed control identically.
- **Strict after a seek.** Full passes keep quick-xml's end-name checks. A
  random read that starts mid-document checks element names in the reader's own
  stack. The spike relaxed this; production does not.
- **The index is checked before it is trusted.** If a sample of `indexList`
  offsets does not land on the spectra they name, the reader falls back to an
  offsets-only scan. That also covers a file whose line endings were rewritten.

The reader sits in a crate named `mscanvas-proteowizard` although it uses no
ProteoWizard. That naming cost is accepted. Moving the mzML modules to a
neutral crate is a later mechanical change, not part of this decision.

### 3. mzML is read natively, with no fallback

- **Routing is by source kind, in the preview service.** An mzML source is
  read by the native reader. Vendor rows stay `dataset_not_previewable`
  (ADR 0005, M3.1).
- **No silent fallback to `msaccess`.** A file the native reader refuses shows
  that refusal. It is never quietly reread with ProteoWizard ("no backend
  fallback", AGENTS.md).
- **Not a second `PreviewProvider`.** `PreviewProvider::run` answers an
  `OperationAttempt` shaped around a ProteoWizard installation (ADR 0044,
  Decision 1), which a native provider would have to fake. The service calls
  the reader directly.
- **What a native read does not touch:**
  - the backend gate;
  - the `conversion_is_busy()` refusal (`conversion_busy`) in `open_preview`
    and `load_spectrum`, which exists because a read would otherwise wait
    behind a conversion's process;
  - `require_usable_backend` and its quarantine;
  - the installation-identity check on a selected spectrum;
  - `MAX_PREVIEW_TEXT_BYTES`.

  A native read starts no process.

### 4. A per-source session cache

A non-indexed file must be scanned to find its spectra. In the spike that took
5.8 s cold on a 482 MB file, then about 0.04 ms per spectrum. The service keeps,
per dataset, the open handle, the spectrum offsets and the header:

- keyed by the retained source generation ADR 0005 already revalidates
  (filesystem identity, length and modification time), not by path;
- dropped when that generation changes, when the row is removed and when the
  workspace is cleared;
- held for the session only, never persisted, and never holding arrays.

Arrays are still read on demand. This decides ADR 0005's open preview-cache
question for this reader only.

### 5. What changes in the preview seam

All of it is in `apps/desktop/src-tauri/src/preview/` and `crates/proteowizard/`.

- **Shared result types.** `SpectrumTableRow` and `SelectedSpectrumResult`
  (`crates/proteowizard/src/preview.rs`) have private fields and only the
  `msaccess` parser builds them. They gain constructors the native reader uses,
  so the DTO projection in `service.rs` stays one path. Slice 2 may move them
  to `crates/core` instead.
- **Selected spectrum.** `SelectedSpectrumDto` sets `representation_known` and
  its value units from the spectrum's own terms. Array values are the stored
  values, widened to `f64`. That is exact for 32-bit floats and for integers
  up to 2^53; a 64-bit integer array holding a larger value is refused with a
  typed error rather than rounded. The retained
  snapshot behind `export_token` holds them, so CSV and TSV export write the
  stored values.
- **Retention time** carries its declared unit instead of
  `UnitState::NotEmitted`. An undeclared unit stays undeclared.
- **Reconciliation stays.** `SpectrumIdentity::reconcile` still compares the
  list read with the spectrum read. Its tolerance existed for printed values;
  slice 2 decides whether it tightens.
- **Bounds stay.** Lists crossing IPC stay bounded in count, and points cross
  only through the existing screen projection. Sending whole arrays over IPC
  would be its own decision, as binary transfer (AGENTS.md, large arrays).
- **Redaction stays.** Metadata lines are still redacted for the opened path
  and for any absolute-path shape.
- **The project document.** The QC snapshot records its producer as
  `ProducerTool::Msaccess` with the `msaccess` executable digest, and
  `qc_snapshot.rs::recorded()` maps only `UnitState::NotEmitted`. A snapshot
  taken from a native read needs a producer kind with no executable digest and
  recorded retention-time units. That is a schema change from 4, and slice 2
  owns it. Until it lands, QC capture is unavailable for a native preview with
  a stated reason, and a native preview is never recorded as `msaccess` output.
- **First-run setup.** ProteoWizard setup becomes a requirement of conversion
  only. Its copy changes through the localized resources.

### 6. Dependencies, which need the owner's approval

AGENTS.md allows no production dependency change without explicit approval
and a short rationale. This ADR asks for two direct dependencies of
`mscanvas-proteowizard`, as exact-pinned workspace dependencies in the style of
`quick-xml`:

- `base64 = "=0.22.1"`;
- `flate2 = "=1.1.10"`.

**Rationale.**

- Both are already in `Cargo.lock`, and the spike's lock diff added no package.
- `flate2` 1.1.10 already ships, through `png` 0.18 in `mscanvas-desktop`, and
  already has its `THIRD_PARTY_NOTICES` row.
- Base64 could be written in about 30 lines, but a locked, widely used crate is
  the boring choice. Inflate is not something to write.

**One choice for the owner.** `base64` 0.22.1, the version the spike built
with, is locked but reaches no shipped Windows code today: the generated
`THIRD_PARTY_NOTICES.md` lists only `base64` 0.23.1, which the installer
already carries.

- Pinning 0.22.1 adds one crate to the shipped binary and one notices row.
- Pinning 0.23.1 adds neither. If the owner prefers it, slice 1 reruns the
  exactness comparison on it.

**Not settled here.** `flate2`'s backend features unify with `png`'s, and the
lock already carries its `zlib-rs` edge. Slice 1 names the feature set and
checks with `cargo tree` that no package enters the lock and no C toolchain is
needed. Any lock change is a new approval.

### 7. A format decoder, not a reimplemented algorithm

AGENTS.md says not to reimplement proprietary RAW readers or mature algorithms
without a written decision.

- **What it is:** this reader decodes an open, documented format: XML,
  controlled-vocabulary terms, base64, zlib and little-endian numbers.
- **What it is not:** it computes nothing scientific. It reads no vendor
  format and replaces no ProteoWizard vendor reader.

This ADR is the written decision, and decision 1's scope is its limit. Any
computation over the decoded arrays is an algorithm, and it needs its own
record.

### 8. Re-measure before implementing

The spike's scale data is synthetic. Before slice 1 starts, the spike's
route-(b) reader runs on files the owner authorizes, as for PX.3:

- the real PRIDE `PXD081190` file M0 measured (208,408,454 bytes, 36,319 MS2
  spectra);
- one real MS1 profile-mode file.

Each run is compared with the independent reference and recorded with its
exactness, timing and memory. Before slice 1 merges, the product reader
repeats that comparison on the same files. The numbers are observations, not
budgets (ADR 0005).

### 9. Delivery order

1. **Reader library, no UI.**
   - Typed errors; header; index with validation; offsets-only scan; metadata
     pass; random read; capped inflate.
   - The chromatogram list (stored TIC and BPC), which the spike did not test.
   - Small generated fixtures, including namespace prefixes.
   - The product reader's repeat of decision 8's comparison, before it merges.
2. **Native path for mzML sources.**
   - Routing and the shared-type constructors.
   - The session cache.
   - Retention time with its unit.
   - The QC producer and the schema step.
3. **UI states.**
   - Profile spectra drawn as lines and centroid spectra as sticks, through the
     shared plot and figure specification, on screen and in export.
   - Unknown representation stays sticks, with its statement.
   - Setup and refusal copy.
   - Rendered QA.

## Evidence

The spike ran on `main` at `cd27279`, in a local scratch directory that is not
committed. No repository file changed, `msaccess` and `msconvert` were not run,
and no dependency was added to the repository.

**Inputs.**

- Two real one-spectrum Thermo MSX acquisitions: the beta-1 installed-check
  fixture and its beta-1 `msconvert` output.
- A variant whose MS level and representation are reachable only through a
  param group.
- `synth-rep`: 36,319 MS2 spectra in M0's representative shape; 131 MB;
  indexed.
- `synth-profile`: 9 spectra, including four 500,000-point profile spectra;
  retention time in seconds.
- `synthetic-long`: the repository's own M7.4 synthetic input; 482 MB; 250,000
  spectra; not indexed; SHA-256 `ad13cce0…d93e9`.
- Six malformed probes.

**Exactness.**

- Both routes decoded all 572,662 arrays bit-identically to an independent
  Python reference (standard-library XML, `base64`, `zlib`, `struct`). The
  reference was itself checked against the generator's ground truth.
- The own reader had 0 metadata mismatches. The fields compared were index,
  native ID, scan number, MS level, polarity, representation, base peak, TIC,
  retention time and unit, filter string, analyzers, every precursor, and each
  array's role, width, compression and length.
- mzdata agreed on every field compared. It keeps retention time in minutes
  only, does not read `defaultArrayLength`, and narrows the isolation target
  and collision energy to `f32`.
- The own reader and the reference share an author, so they could share a
  misreading. mzdata, an independent implementation, agreeing on every
  compared field is the guard against that.

**Robustness.**

| Probe | Own reader | mzdata 0.68.0 |
| --- | --- | --- |
| Corrupt zlib stream | typed per-array error | panic |
| Payload shorter than declared | typed error | 3 of 1,504 points, silently |
| Numpress label | typed refusal | typed error |
| Undefined param group | typed error | panic |
| `DOCTYPE` with an entity | refused | accepted |
| zlib bomb (512 MiB, declared 1,504 points) | refused in 4.3 ms, 6.7 MB peak | 67,108,864 points, 545 MB peak working set |

**Speed and memory.** These are single runs, with release builds, on a 20-core
machine with a warm cache. M0's `msaccess` figures come from a 2-core hosted
runner on the real file, so the comparison is directional only.

| Operation | `msaccess` (M0, real file) | Own reader (spike) |
| --- | --- | --- |
| Selected spectrum | p50 164 ms per process | warm p50 about 0.07 ms in-process, excluding IPC and projection |
| Selected spectrum, one process per click | — | p50 55 ms, of which 35–45 ms is process creation |
| Open, indexed, 36,319 spectra | — | 13.8 ms (mzdata 61.2 ms) |
| All spectrum metadata | spectrum table 3,921 ms | 1.4 s on 131 MB; about 2.1–2.7 s scaled to 208 MB (estimate) |
| 500,000-point profile spectrum | about 13.8 MiB of text, over the 8 MiB cap (estimate) | 60–80 ms; 12 MB in memory |
| Non-indexed 482 MB, cold | — | 5.8 s full scan (mzdata 2.4 s), then about 0.04 ms per spectrum |
| Peak working set, warm | — | 46 MB (`synth-rep`), 108 MB (`synthetic-long`) |

**Footprint.**

| | Own reader | mzdata 0.68.0 |
| --- | --- | --- |
| New `Cargo.lock` packages | 0 | 25 |
| Spike binary | 434,688 bytes | about 1.9 MB larger |
| Clean release build, `-j 4` | 14.4 s | 83.3 s |
| Default features | — | build C code (`zlib-ng-compat`) |

## Alternatives rejected

- **mzdata 0.68.0 (route a).** It is bit-exact, but:
  - it panics on corrupt zlib and on undefined param groups;
  - it inflates without bound;
  - it returns short arrays silently and accepts a `DOCTYPE`.

  Adopting it would also need `catch_unwind` around every call, a separate
  pre-scan for bombs and short arrays, and 25 lock packages. It is 0.x, with
  minor releases 0.67 and 0.68 six weeks apart, and one maintainer has about
  96% of its commits. Revisit it only if MSCanvas needs mzMLb, imzML, numpress
  or MGF; even then pin it, turn default features off, wrap every call, and
  keep MSCanvas's own size checks.
- **Keep `msaccess` and raise `precision`.** That fixes neither the 8 MiB
  whole-output refusal, the process per click, the unknown representation nor
  the need for ProteoWizard. Measuring it would also need a ProteoWizard hold
  release.
- **Direction A**, a corrected or differently versioned ProteoWizard
  interface. PX.4 left it viable and unprototyped, and this ADR does not
  reject it. It would still be a process per click and would still need
  ProteoWizard to view an open format.
- **Native first, `msaccess` when the native reader refuses.** That is the
  backend fallback AGENTS.md rules out. One view would come from two readers
  with different precision and different representation facts, without the
  user choosing.
- **A second `PreviewProvider`.** It would have to fabricate an installation
  identity for ADR 0044's Decision 1.

## Consequences

**What it unlocks:**

- **Exact exported values.** Exported spectrum values equal the stored values,
  which closes the installed check's FAIL for mzML.
- **Profile lines.** Profile spectra are drawn as lines and centroid spectra as
  sticks, from the file's own terms.
- **MS-level filter on real data.** MS level, polarity and representation come
  from each spectrum, through param groups, on full-size real files. That
  serves the scan table's represented MS-level filter and makes an MS-level
  choice for the chromatogram possible. ADR 0033 left that choice out of R1, so
  it needs its own viewer decision.
- **Large spectra.** Large profile spectra and large spectrum tables open
  where the 8 MiB cap refuses them today.
- **Viewing without ProteoWizard.** mzML can be viewed with no ProteoWizard
  installed.
- **Viewing while converting.** A native read takes no backend gate and is not
  refused with `conversion_busy` (decision 3), so viewing works while a
  conversion runs.
- **A premise for XIC, not XIC itself.** The four-decimal serialization that
  decided M5.4 does not exist in-process. **This ADR admits no XIC.** XIC needs
  the new scope record the
  [after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#75-evidence-gated-items)
  names: a new candidate that reruns all 77 PX.3 rows, with ADR 0046's
  semantics unchanged.

**Risks:**

- **Numpress becomes a regression.**
  - ProteoWizard decodes numpress, so `msaccess` presumably views numpress
    mzML today. This is not measured, because `msaccess` is under the hold.
  - Under decisions 1 and 3, such files are refused.
  - ADR 0055 (PR #146) proposes numpress among the advanced conversion
    outputs. Those outputs would then be adoptable but not viewable.

  See the open question below.
- **Scope creep.** Every refusal in decision 1 will be asked for, and each
  needs its own decision.
- **Interpretation.** Some readings are choices: which cvParam wins, how
  activation terms are classified, which scan gives the retention time.
  mzdata agreed on everything compared, but unusual yet valid vendor-converted
  mzML could still disagree.
- **Representativeness.**
  - Only two real acquisitions were tested, both one-spectrum Thermo MSX files.
  - All scale data is synthetic.
  - Neither the PRIDE file nor a real profile file was measured.

  Decision 8 answers this.
- **Strictness** is established only for the probed cases and the rules of
  decision 2.
- **Ownership.** The project owns about 600–900 production lines plus tests,
  where a dependency would have release notes.

**Open question for the owner: numpress.** Three ways forward:

- keep the typed refusal (recommended for now);
- add native numpress decoding later, in its own decision;
- offer an explicit, labelled "Read with ProteoWizard" action that the user
  chooses. That is not a fallback.

## What this amends, on acceptance

- **[ADR 0002](0002-external-proteowizard.md).** ProteoWizard stays the
  conversion backend. It is no longer how mzML is viewed.
- **[ADR 0003](0003-msaccess-preview-spike.md).** Its acceptance of
  `msaccess` for preview navigation is superseded for mzML viewing. Its
  measurements stay as recorded.
- **[ADR 0005](0005-mzml-preview-boundary.md), for mzML sources.**
  - "Unknown stays unknown" now reports representation and retention-time
    unit where the file declares them, and keeps them unknown where it does
    not.
  - The stick-only rule becomes sticks for centroid and unknown spectra, and a
    line for profile spectra.
  - These no longer apply to viewing mzML:
    - one backend process per read, and the single backend gate;
    - the 8 MiB output ceiling;
    - the installation identity a selected spectrum is checked against.
  - The bounded preview cache it left open is decided for this reader
    (decision 4).
  - Unchanged: the command surface, Rust's ownership of the path, bounded and
    redacted transfer, and generation checks.
- **[ADR 0047](0047-first-windows-beta-scope-and-implementation-route.md).**
  "No … new reader … belongs to this route" bounded M7. This ADR is the
  post-beta decision on a new reader, for viewing. The directions PX.4 handed
  off are unchanged:
  - A stays viable, unprototyped and not rejected.
  - B stays refused.
  - C's premise, "existing full-array access", becomes true once slice 2
    ships. A future XIC scope record may cite that, but it inherits no result
    from this ADR.
- **The XIC route records ([M5.4](../../spikes/M5_XIC_SOURCE_EVIDENCE.md),
  [ADR 0046](0046-post-m6-xic-provider-runtime-route-lock.md),
  [PX.4](../../spikes/PX_4_XIC_PROVIDER_RUNTIME_DECISION.md)).** Their
  decisions are unchanged:
  - `XIC_SOURCE_REFUSED` stands for the `msaccess` build it measured.
  - `XIC_PROVIDER_REFUSED` stands for B.
  - The after-beta-1 plan's XIC row asks for "a written decision on reader work
    and dependency approval". That is this ADR plus decision 6's approval.
- **[The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#9-open-owner-decisions),
  section 9.** On acceptance, the open decision on a project-owned reader is
  answered here.
