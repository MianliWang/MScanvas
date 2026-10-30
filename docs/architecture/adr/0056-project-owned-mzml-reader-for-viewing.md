# ADR 0056 — A project-owned mzML reader for viewing

Status: **Accepted** by the owner on 2026-10-29, including the dependency
request: `base64 0.22.1` and `flate2 1.1.10` become direct dependencies of the
product crate (both already in `Cargo.lock`, so the lock gains no package).
Proposed 2026-10-28.
Related: [0002](0002-external-proteowizard.md),
[0003](0003-msaccess-preview-spike.md),
[0005](0005-mzml-preview-boundary.md),
[0006](0006-multi-dataset-workspace-boundary.md),
[0028](0028-figure-renderer-and-semantic-specification.md),
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
    (`XIC_SOURCE_REFUSED`), on two independent grounds. `tic`, `sic` and
    `slice` write region intensities at four fixed decimals, so a small
    positive signal reads as zero. `image` renders a pseudo-gel that carries no
    per-scan quantity.
  - PX.4 refused the one mature reader evaluated (direction B, mzdata 0.66.6)
    on legal namespace-prefixed mzML (`XIC_PROVIDER_REFUSED`).
  - Direction C was "not viable as defined", because full-array access in the
    product was a false premise.
- **Viewing an open format needs ProteoWizard.** A user without ProteoWizard
  cannot look at an mzML file, though nothing proprietary is involved.

The reader spike asked whether MSCanvas should read mzML in-process for viewing.
It compared a project-owned reader (route b) with mzdata 0.68.0 (route a).

This ADR moves two reads into the process: the spectrum table and the selected
spectrum. Metadata, the run summary, and the rules that admit a read stay as
they are, except that the preview page takes the run's retention-time range
from the native table (decision 3). It therefore does not make mzML viewable
without ProteoWizard or during a conversion (decision 3).

## Decisions

### 1. A viewing-only mzML 1.1 reader, owned by the project

MSCanvas reads mzML spectra for viewing in-process, with its own reader built
on `quick-xml` `=0.41.0` (approved in M0C Slice 2A), `base64` and `flate2`. The
scope is closed.

**It reads:**

- mzML 1.1, plain or wrapped in `indexedmzML`;
- the spectrum list;
- `referenceableParamGroup` references;
- per spectrum: index, native ID, MS level, centroid or profile
  (MS:1000127 / MS:1000128), scan start time with its declared unit, every
  precursor's selected-ion m/z and intensity, total ion current, base peak, the
  lowest and highest observed m/z, and the declared array length
  (`defaultArrayLength`, or an array's own `arrayLength`);
- the m/z and intensity arrays: 32- and 64-bit float and integer values,
  zlib-compressed or uncompressed, and the unit each array declares.

**Which arrays.** The m/z array is the one array carrying MS:1000514, and the
intensity array is the one carrying MS:1000515. Any other array is not decoded
and not shown.

**It refuses with a typed error, never skipping or guessing.** Each refusal
has a scope.

The open, meaning the whole spectrum table, is refused for:

- a document that is not mzML 1.1 (the `mzML` `version` attribute missing or
  not `1.1.x`), or not UTF-8;
- a `DOCTYPE` or a custom entity;
- a `referenceableParamGroupRef` to an undefined group;
- a spectrum with more than one `scan`;
- a scan start time whose declared unit is not seconds or minutes (UO:0000010,
  UO:0000031, MS:1000038); an undeclared unit stays undeclared;
- one term stated twice with different values, counting a spectrum's own terms
  and its param groups together, or both centroid and profile;
- a spectrum missing a value the table requires (decision 5): MS level, scan
  start time, base peak m/z and intensity, or total ion current;
- a document beyond the limits of decision 2.

A selected spectrum is refused, and the open and every other spectrum stand,
for:

- a missing m/z or intensity array while the declared length is above zero,
  either one present twice, or one array carrying both terms;
- a binary data type that is missing, stated twice, or not one of 32-bit float,
  64-bit float, 32-bit integer and 64-bit integer (MS:1000521, MS:1000523,
  MS:1000519, MS:1000522);
- a compression term that is missing, stated twice, or not zlib (MS:1000574) or
  none (MS:1000576). That refuses numpress (MS:1002312–1002314,
  MS:1002746–1002748), truncation and prediction (MS:1003088–1003090) and
  anything else;
- corrupt base64 or zlib;
- a declared length above decision 2's caps, a decoded length that differs from
  the declared length either way, or m/z and intensity arrays of different
  lengths;
- a non-finite value (NaN or infinity), which today's parser also refuses;
- a 64-bit integer value that `f64` cannot hold exactly (decision 5).

**It must not panic or abort on any input.** That is a requirement slice 1
proves with its probes (decision 9). The spike did not establish it (see
[Evidence](#evidence)).

**Out of scope**, each needing its own decision: `.mzML.gz`, mzMLb, imzML,
MGF, other mzML versions, non-UTF-8 documents, multi-scan combination
semantics, the metadata sections and run summary (decision 3), and any
computation over the decoded arrays (XIC, summed spectra, peak picking).

Stored chromatograms, polarity, the filter string and instrument
configurations are out of scope too, because nothing would read them: no
preview DTO, service path or export uses them. The product's chromatogram is a
projection of the spectrum table (`preview/chromatogram.rs`), and the run
summary's chromatogram count stays unreported, as `msaccess`'s parser leaves it
today.

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
- **Decoded sizes have absolute caps,** whatever the file declares:
  - at most 8,388,608 (2^23) points and 64 MiB of decoded bytes per array;
  - at most 128 MiB of decoded bytes per spectrum, across its two arrays.

  The caps are checked before any buffer is reserved, in this order: the
  declared length against the point cap, the declared length × width against
  the byte cap, then the spectrum's running total. Every size calculation is
  checked (`checked_mul`, `checked_add`), and an overflow is the same typed
  refusal as a length over the cap. Buffers are reserved with
  `try_reserve_exact`, so a reservation the allocator refuses is a typed error,
  not an abort.
- **Inflate stops at the declared byte length + 1,** which the caps have
  already bounded. Both overrun and underrun are refused.
- **A base64 text run is bounded before it is read whole.** The bound comes
  from the smaller of the declared and the capped byte length, with room for
  zlib's stored-block overhead and line breaks. The inspector's 256 MiB
  text-run limit stays the outer bound.
- **Names resolve by namespace, not by literal qualified name.** Prefixed mzML
  was PX.3's deciding B failure, and the spike did not probe it. Slice 1 must
  read a namespace-prefixed document built like PX.3's `prefixed` case and its
  unprefixed control identically.
- **Strict after a seek.** Full passes keep quick-xml's end-name checks. A
  random read that starts mid-document checks element names in the reader's own
  stack. The spike relaxed this; production does not.
- **No index is trusted.** The open's table pass reads every spectrum anyway
  and records each one's byte offset as it goes, so the reader does not read
  `indexList`. A random read checks that the spectrum it lands on has the index
  and native ID the table recorded, and refuses otherwise.

The caps are a resource contract, like ADR 0006's session capacity, not a
performance promise. 2^23 points is 16 times the largest spectrum the spike
read (500,000 points). Decision 8 records the largest real point count, and
raising a cap is a recorded change. Widened to `f64`, one selected spectrum
holds at most 128 MiB of values.

The reader sits in a crate named `mscanvas-proteowizard` although it uses no
ProteoWizard. That naming cost is accepted. Moving the mzML modules to a
neutral crate is a later mechanical change, not part of this decision.

### 3. The table and spectra are read natively; the rest of the open is not

**Routing is by operation, for mzML sources:**

| Operation | Reader |
| --- | --- |
| Spectrum table (part of the open) | native |
| Selected spectrum | native |
| Metadata (part of the open) | `msaccess`, as today |
| Run summary (part of the open) | `msaccess`, as today |
| Retention-time range on the preview page | native: the lowest and highest retention time of the table's rows |

Vendor rows stay `dataset_not_previewable` (ADR 0005, M3.1).

**Why metadata and the run summary stay on `msaccess`:**

- The metadata view is `msaccess`'s text for five sections: file description,
  sample list, instrument configurations, software, and data processing. The
  reader reads none of them, and reproducing them would change what the user
  sees.
- The run summary carries the retention times at 25, 50 and 75% of cumulative
  base-peak intensity. `msaccess` computes them, and the QC snapshot records
  them. Computing them natively is the computation decision 7 excludes.

Moving either needs its own decision.

**One retention-time scale on the preview page.** The table, the chromatogram
and the selected spectrum show retention time as the file declares it, which
for a Thermo file converted by `msconvert` is usually minutes. `msaccess`
prints its own scale: the installed check's scan stored at 26.688152 min was
printed by `spectrum_table` as `rt 1601.29`, seconds
([item 5](../../release/beta-1/INSTALLED_CHECK.md#5-exported-numerics)). The
scale of `run_summary`'s `MinRT` and `MaxRT` is not recorded, and is probably
the same seconds. Shown beside the native table, they could put two scales about
60 times apart on one page, both labelled retention time.

- On a native open, the summary's retention-time range is therefore the lowest
  and highest retention time among the table's retained rows, all of them and
  not the transferred prefix. It carries the rows' unit, and an undeclared unit
  stays undeclared.
- Rows with different units, or where only some rows declare one, have no
  range, with the same stated reason as the chromatogram. Nothing converts
  between seconds and minutes.
- `msaccess`'s `MinRT`, `MaxRT` and its retention times at cumulative base-peak
  intensity are still read. They go only to the QC snapshot, and the QC report
  shows them with their producer and their unit unreported, as today. That
  report can differ in scale from the preview (see Risks).

**One open, two readers, no fallback:**

- The open runs the two `msaccess` operations and the native table pass as one
  batch, under the same backend gate and `lock_against_replacement`, and inside
  the same before-and-after `SourceGeneration` check. Both readers therefore
  describe one generation of the file.
- The run summary's spectrum count and the native table's row count stay two
  readings. When they differ, both are shown and neither is chosen, as ADR 0005
  rules and `PreviewSummary` already does (`summaryCountsDisagree`, against the
  table's total, not its transferred rows). Both readers saw one generation of
  the file, so the difference is between the readers, and MSCanvas has no
  evidence about which is right.
- The operation fixes the reader; an outcome never changes it. A native refusal
  is shown and is never reread with `msaccess`. An `msaccess` failure fails the
  open as it does today, and the native reader never stands in ("no backend
  fallback", AGENTS.md).

**Not a second `PreviewProvider`.** `PreviewProvider::run` answers an
`OperationAttempt` shaped around a ProteoWizard installation (ADR 0044,
Decision 4), which a native provider would have to fake. The service calls the
reader directly.

**What a native read drops:**

- the process;
- `MAX_PREVIEW_TEXT_BYTES`, for the table and the selected spectrum;
- the installation-identity check on a selected spectrum, since no installation
  read it.

**What it keeps: admission and serialization, unchanged.** A native read is
admitted exactly when an `msaccess` read is admitted today, and runs under the
same gate:

- in Rust: `require_usable_backend` and its quarantine; the `conversion_busy`
  refusal in `open_preview` and `load_spectrum`; the backend gate, with
  supersession checked after its wait;
- in the webview: `canPreview` (`PreviewWorkspace.tsx`), which requires ADR
  0044's `backendUsable` and waits while a conversion runs.

The gate is now also what serializes native reads. One read runs at a time,
including an open's full pass. A pass already under way runs to
completion, as ADR 0005 says of a backend read.

**Not in this ADR: viewing without ProteoWizard, or during a conversion.**
Both need a follow-up decision. It must:

- move or drop the open's metadata and run summary, and with the run summary
  the QC snapshot's producer (schema 4 records `msaccess`);
- change Rust's admission, the webview's `canPreview`, and ADR 0044's
  `backendUsable` projection together, so the two layers never disagree about
  whether a read is admitted;
- replace the gate for native reads with per-dataset serialization, check
  supersession before a full pass, and bound how many passes run at once;
- change discovery, which requires `msaccess` beside `msconvert`, and the setup
  copy.

> **2026-10-29: [ADR 0057](0057-conversion-capacity-and-viewing-during-conversion.md)
> is that decision for the selected spectra of an already-open preview.** They
> are read natively during a conversion, serialized by a native-read lane
> instead of the backend gate. Opening a preview during a conversion stays
> refused, and viewing without ProteoWizard stays open.

### 4. Offsets are kept with the open preview

Every open is a full pass, because no index is trusted (decision 2). In the
spike a full pass took 5.8 s cold on a 482 MB file, then about 0.04 ms per
spectrum. The open's table pass is that pass, so the offsets come with the
table:

- **Offsets live beside the table rows** in the dataset's retained preview
  state (`DatasetPreviewState`), with one lifetime. The next open of the
  dataset drops them, and so do removing the row and clearing the workspace. A
  selected spectrum is still checked against the file generation its open
  recorded, as today.
- **No read holds a file handle.** Each read opens the file and closes it, and
  no two reads share a cursor. The only handle the session keeps on the user's
  file is the row's identity lease (ADR 0006), as today, so a row's handle cost
  is unchanged.
- **One dataset at a time.** Starting an open drops every other dataset's
  preview state, as it already drops its own. That alone does not hold the
  bound: the commit checks only its own dataset's request epoch, and the gate
  is released before the commit, so an older open of another dataset could
  still commit after a newer open has started. Slice 2 closes this with the
  cross-dataset `PreviewOpenTicket`:
  - an open retains nothing unless its ticket is still the latest, the test a
    stale open's run summary already meets (`reconcile_preview_run_summary`).
    The ticket is checked while the workspace lock is held, with the export
    slot taken after it as the leaf it is, and a stale ticket answers
    `superseded`, as a stale epoch does;
  - an open's start drops the other datasets' state after taking its ticket,
    under the workspace lock, so it cannot fall between another commit's check
    and its write;
  - `open_preview` is the only production caller that advances the ticket; the
    other is an e2e seed.

  The screen shows one preview at a time, and an open takes the previous one
  off the screen first. Today the 8 MiB text cap is what bounds one dataset's
  retained rows (about 76,000 at M0's row size). Without that cap on the table,
  this rule bounds them across the session instead. The worst case is one file
  at the reader's limit: 1,000,000 rows and offsets, and never arrays.
- **A selected spectrum needs its preview.** For a dataset with no retained
  preview state, a selected spectrum is refused with a typed error that asks
  for a reopen.

This decides ADR 0005's open preview-cache question for this reader.

### 5. What changes in the preview seam

**Where the changes are:**

- the reader and the shared result types, in `crates/proteowizard/`;
- the service, DTOs, chromatogram model and export mappings, in
  `apps/desktop/src-tauri/src/preview/`;
- `apps/desktop/src-tauri/src/qc_snapshot.rs`, for one exhaustive match;
- in the webview, the DTO contracts (`contracts.ts`), the summary's
  retention-time line (`PreviewSummary.tsx`), the selected-spectrum panel and
  the chromatogram's scan model (`viewer/scanModel.ts`);
- in slice 3, the shared figure specification and how the viewer draws.

No admission, gating, discovery or setup code changes.

- **Shared result types.** `SpectrumTableRow` and `SelectedSpectrumResult`
  (`crates/proteowizard/src/preview.rs`) have private fields and only the
  `msaccess` parser builds them. They gain constructors the native reader uses,
  so the DTO projection in `service.rs` stays one path. Slice 2 may move them
  to `crates/core` instead. `MetadataResult` and `RunSummaryResult` keep their
  `msaccess` parsers.
- **Table rows.**
  - A native row fills what the product reads: the identity (index, native ID,
    and a scan number taken only from `scan=N`), MS level, retention time, base
    peak m/z and intensity, total ion current, and the first precursor's
    selected-ion m/z.
  - A spectrum missing one of the required values refuses the open
    (decision 1), as today's parser refuses an empty required field.
  - The row's other fields (event, analyzer, m/z range, charge, Thermo
    monoisotopic m/z, filter-string m/z, injection time) have no product reader
    and reach no screen. A native row leaves them unreported, and slice 2 makes
    them optional.
  - The reader derives no value from the arrays.
  - The webview still receives at most `MAX_SPECTRUM_TABLE_ROWS` (100,000)
    rows with their total, and Rust retains them all. A native table above
    that opens as a row-capped table does today: the scan table says it shows
    a prefix (`scanPrefix`), and there is no chromatogram on screen
    (`viewerTicPrefix`) or in export (`ChromatogramSource::from_rows`). Today
    the 8 MiB cap usually refuses such a table first. `synthetic-long`
    (250,000 spectra) is one. A chromatogram above the bound is an open
    question below.
- **Known facts carry their values.** `representation_known`,
  `value_units_known` and `RetentionTimeDto.unit_known` are booleans today.
  They can say that a fact is known, not what it is. Slice 2 replaces them, on
  the DTOs and in `contracts.ts`, with the values a profile line and a unit
  label need: the representation (centroid, profile or not reported), each
  array's unit, and the retention-time unit (seconds, minutes or not reported).
- **Selected spectrum.**
  - `SelectedSpectrumDto` takes its representation and each array's unit from
    the spectrum's own terms.
  - Array values are the stored values, widened to `f64`. That is exact for
    32-bit floats and for integers up to 2^53. A 64-bit integer array holding a
    larger value is refused with a typed error rather than rounded.
  - The retained snapshot behind `export_token` holds those values, so CSV and
    TSV export write the stored values.
  - Base peak and total ion current come from the same terms as the table row.
    The m/z range comes from the lowest and highest observed m/z terms
    (MS:1000528, MS:1000527). A range the spectrum does not state is not
    reported. Slice 2 makes those fields optional, and the panel shows the
    range as not reported.
  - `SpectrumPrecursor` requires a finite m/z and intensity today. In mzML the
    selected ion, and its intensity (MS:1000042), are optional. Slice 2 makes
    both values optional, and a value the precursor does not state is shown as
    not reported, never as zero. The index stays the precursor's position.
  - Representation and value units meet the exhaustive matches in
    `preview/export.rs` (the figure and the data document), which map them
    from the evidence instead of to "unreported".
  - `NumericPrecisionEvidence` (requested and observed fraction digits)
    describes printed text. No product code reads it, and a native spectrum
    carries the two arrays' stored widths instead.
- **Retention time** carries its declared unit instead of
  `UnitState::NotEmitted`. An undeclared unit stays undeclared.
  - Retention time and the array values share one `UnitState` today
    (`preview.rs`). Slice 2 splits it: retention time gets its own unit state,
    and each array its own value-unit state, so no match handles a unit that
    cannot occur there.
  - The retention-time states meet two exhaustive matches.
    `reported_unit_known` in `service.rs` maps them.
    `qc_snapshot.rs::recorded()` refuses them, because the QC path only ever
    sees the `msaccess` run summary's `NotEmitted`. Schema 4 does not change.
  - The value-unit states meet the two matches in `preview/export.rs` above.
- **The chromatogram learns the unit.** Today a row whose retention-time unit
  is known makes the chromatogram unavailable, on screen
  (`viewer/scanModel.ts`, `unsupported-retention-time-unit`) and in export
  (`chromatogram.rs::from_rows`). Its retention-time axis is `Unreported`.
  - Native rows declare a unit, so without this change every native file would
    lose its chromatogram. Slice 2 therefore changes both models in the same
    change: the axis carries the declared unit, on screen and in export.
  - A run whose rows declare different units, or where only some rows declare
    one, has no chromatogram, with a stated reason. Nothing converts between
    seconds and minutes.
- **Reconciliation.**
  - `SpectrumIdentity::reconcile` compares identities exactly, and stays.
  - The tolerance lives in `TableRowFacts::contradicts()` and `differs()`
    (`service.rs`). It exists for printed values.
  - With both sides read natively from the same terms, a disagreement can only
    mean a read landed on another spectrum, which the per-read index and ID
    check already refuses. Slice 2 makes the comparison exact and records that.
- **Bounds stay.** Lists crossing IPC stay bounded in count.
  - A selected spectrum's DTO carries at most `MAX_SPECTRUM_POINTS` (500,000)
    of its points, with its total, as today.
  - A native spectrum above that, up to decision 2's 2^23, crosses as that
    prefix with today's notices. While the screen projection is not ready,
    drawing is limited to the transferred points (`viewerSpectrumPrefix`).
    Once it is ready, the drawing reads the complete retained spectrum
    (`viewerSpectrumPrefixRetained`). Export always reads the complete
    retained spectrum, through the export snapshot.
  - Sending whole arrays over IPC would be its own decision, as binary transfer
    (AGENTS.md, large arrays).
- **Redaction stays.** Metadata stays `msaccess` output, redacted as today. The
  native table goes through the same `spectrum_table_dto` projection and its
  redactor.
- **The project document does not change.** The QC snapshot copies only the
  run summary, which stays `msaccess` output. `ProducerTool::Msaccess`, its
  executable digest, and schema 4 stay true.
- **The `msaccess` provider keeps `Metadata` and `RunSummary`.** mzML is the
  one previewable kind (`DatasetSourceKindDto`), so its spectrum-table and
  selected-spectrum operations lose their only product caller, and slice 2
  removes them. Discovery still requires `msaccess` beside `msconvert`, and the
  setup copy does not change.

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
record. That is why the run summary's retention times at cumulative base-peak
intensity stay `msaccess`'s (decision 3). Taking the lowest and highest of the
table rows' own retention times, for the preview's range, is a selection from
read values, not a computation.

### 8. Re-measure before implementing

The spike's scale data is synthetic. Before slice 1 starts, the spike's
route-(b) reader and its route-(a) mzdata adapter both run on files the owner
authorizes, as for PX.3:

- the real PRIDE `PXD081190` file M0 measured (208,408,454 bytes, 36,319 MS2
  spectra);
- one real MS1 profile-mode file.

Each run is compared with the Python reference and recorded with its
exactness, timing and memory:

- mzdata is in the comparison because it is the independent implementation.
  The reference and the own reader share an author, and real vendor-converted
  files are where that matters most.
- Each run also records the largest point count, and whether every spectrum
  states the values the table requires (decision 5).
- If the owner releases the ProteoWizard hold for it, `msaccess run_summary`
  runs on the same files, and the run records the scale of `MinRT` and `MaxRT`
  against each file's declared unit. That settles the QC report's scale (see
  Risks), not the preview page's, which no longer shows that range on a native
  open.

Before slice 1 merges, the product reader repeats that three-way comparison on
the same files. The numbers are observations, not budgets (ADR 0005).

**Result, 2026-10-29 (R0): not passed.** The
[R0 record](../../spikes/ADR0056_R0_REAL_FILE_COMPARISON.md) ran the product
reader, mzdata 0.68.0 and the Python reference on public CC0 files, under the
owner's bounded hold release of that day.

- **The MS1 profile file is exact.** It is `msconvert`'s output for
  `PXD081190`'s RAW: 546,327,287 bytes, 2,748 MS1 profile and 41,130 MS2
  centroid spectra. All three readers agree bit for bit on all 87,756 arrays and
  on every compared field. The largest array has 23,308 points, and every
  spectrum states the values the table requires.
- **The product refuses the `PXD081190` file at the open** (`not_mzml_1_1`).
  Its `<mzML>` element has no `version` attribute, and decision 1 refuses that.
  - mzdata and the reference read all 36,319 spectra, and `msaccess` opens the
    file.
  - With `version="1.1.0"` added to a copy, the product reads it exactly.
  - Slice 1 therefore does not merge. Whether to read the version from
    `xsi:schemaLocation`, as ProteoWizard does, is a decision-1 amendment for
    the owner.
- **`msaccess run_summary` prints seconds.** On both minute-declared files,
  `MinRT` and `MaxRT` are the range in whole seconds, which settles decision 3's
  "probably".

### 9. Delivery order

1. **Reader library, no UI.**
   - Typed errors; the header; a metadata pass that records offsets; a random
     read with its index and ID check; decoding under decision 2's caps.
   - Small generated fixtures and probes:
     - namespace prefixes;
     - integer arrays, including a 64-bit value above 2^53;
     - declared array units;
     - more than one scan, and conflicting terms;
     - non-finite values;
     - a declared length of 2^40 points;
     - a declared length at the cap over a zlib stream of zeros;
     - a precursor without a selected-ion intensity;
     - a random read that lands on another spectrum.
   - The product reader's repeat of decision 8's comparison, before it merges.
2. **Native path for mzML sources.**
   - Routing by operation, the shared-type constructors and the optional
     fields.
   - The one batch, with both spectrum counts shown when they differ.
   - Offsets kept with the preview, for one dataset at a time, with the
     commit's ticket check.
   - The split unit state and the value-carrying DTOs.
   - Retention time with its unit, including the chromatogram's axis on
     screen and in export, the summary's range from the native rows, and exact
     reconciliation.
   - Acceptance: a seconds file and a minutes file each keep their
     chromatogram on screen and in export, with the unit on the axis; a run of
     mixed units shows the stated reason instead.
   - Removal of the two `msaccess` operations.
3. **UI states.**
   - Profile spectra drawn as lines and centroid spectra as sticks, through the
     shared plot and figure specification, on screen and in export. ADR 0028's
     rules apply:
     - a profile line is a joined trace and reduces by `MinMaxPerColumn`;
     - sticks keep `ExtremePerSignPerColumn`;
     - only a spectrum the file declares profile is joined.
   - Unknown representation stays sticks, with its statement.
   - Retention time shown with its declared unit; a chromatogram and a range
     refused for mixed units; an m/z range or a precursor value not reported.
   - Copy for the new refusals.
   - Rendered QA.

## Evidence

The spike ran on `main` at `cd27279`, in a local scratch directory that is not
committed. No repository file changed, `msaccess` and `msconvert` were not run,
and no dependency was added to the repository.

**Inputs.**

- One real acquisition, in two files: a one-spectrum Thermo MSX acquisition
  (the beta-1 installed-check fixture) and its beta-1 `msconvert` output.
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
  array's role, width, compression and length. The arrays' declared units were
  not compared.
- Every array in the inputs is a float array. Integer arrays and decision 5's
  2^53 rule are untested.
- mzdata agreed on every field compared but one. On `synth-profile`, one
  `rt_min` differs by 1 ULP (4.008333333333333 against …334), because mzdata
  divides seconds by 60 and the comparison multiplied by 1/60. mzdata also
  keeps retention time in minutes only, does not read `defaultArrayLength`,
  and narrows the isolation target and collision energy to `f32`.
- The own reader and the reference share an author, so they could share a
  misreading. mzdata is an independent implementation, and its agreement guards
  against that. So far that covers synthetic files and one real acquisition;
  decision 8 extends it to real files.

**Robustness.**

| Probe | Own reader | mzdata 0.68.0 |
| --- | --- | --- |
| Corrupt zlib stream | typed per-array error | panic |
| Payload shorter than declared | typed error | 3 of 1,504 points, silently |
| Numpress label | typed refusal | typed error |
| Undefined param group | typed error | panic |
| `DOCTYPE` with an entity | refused | accepted |
| zlib bomb (512 MiB, declared 1,504 points) | refused in 4.3 ms, 6.7 MB peak | 67,108,864 points, 545 MB peak working set |

The bomb probe declared a small length, and that is what bounded the spike: it
reserved its output buffer from the declared length. A file that declares a
huge length was not probed. The spike would have tried to reserve that much,
and could have aborted. Decision 2's absolute caps close that gap, and slice 1
probes it.

**Speed and memory.** These are single runs, with release builds, on a 20-core
machine with a warm cache. M0's `msaccess` figures come from a 2-core hosted
runner on the real file, so the comparison is directional only.

| Operation | `msaccess` (M0, real file) | Own reader (spike) |
| --- | --- | --- |
| Selected spectrum | p50 164 ms per process | warm p50 about 0.07 ms in-process, excluding IPC and projection |
| Selected spectrum, one process per click | — | p50 55 ms, of which 35–45 ms is process creation |
| Header and index only, 36,319 spectra | — | 13.8 ms (mzdata 61.2 ms); not the product's open, which reads every spectrum's metadata (next row) |
| All spectrum metadata | spectrum table 3,921 ms | 1.4 s on 131 MB; about 2.15 s scaled by bytes to 208 MB (estimate; mzdata about 2.75 s) |
| Run summary and metadata | 3,160 ms and 163 ms | not replaced; still `msaccess` (decision 3) |
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
  whole-output refusal, the process per click nor the unknown representation.
  Measuring it would also need a ProteoWizard hold release.
- **Direction A**, a corrected or differently versioned ProteoWizard
  interface. PX.4 left it viable and unprototyped, and this ADR does not
  reject it. It would still be a process per click.
- **Native first, `msaccess` when the native reader refuses.** That is the
  backend fallback AGENTS.md rules out. One view would come from two readers
  with different precision and different representation facts, without the
  user choosing.
- **Native metadata and run summary now.** Native metadata would change what
  the user sees, and the run summary's retention times at cumulative base-peak
  intensity are a computation. Each waits for its own decision (decision 3).
- **A second `PreviewProvider`.** It would have to fabricate an installation
  identity for the `OperationAttempt` of ADR 0044's Decision 4.
- **Refusing the open when the two spectrum counts differ.** ADR 0005 rejected
  that: neither reading is evidence against the other, and a refusal would
  reject an acquisition that may be valid.

## Consequences

**What it unlocks:**

- **Exact exported values.** Exported spectrum values equal the stored values,
  which closes the installed check's FAIL for mzML.
- **Profile lines.** Profile spectra are drawn as lines and centroid spectra as
  sticks, from the file's own terms.
- **MS-level filter on real data.** MS level and representation come from each
  spectrum, through param groups, on full-size real files. That
  serves the scan table's represented MS-level filter and makes an MS-level
  choice for the chromatogram possible. ADR 0033 left that choice out of R1, so
  it needs its own viewer decision.
- **Large spectra and tables.** Large profile spectra open where the 8 MiB cap
  refuses them today. So do spectrum tables above about 76,000 rows: with a
  chromatogram up to 100,000 rows, and above that as a prefix with no
  chromatogram and no chromatogram export (decision 5).
- **No process per spectrum.** A selected spectrum is an in-process read.
- **Retention-time units.** The table, the chromatogram and its export, and the
  summary's range carry the unit the file declares, where today every unit is
  unreported.
- **A premise for XIC, not XIC itself.** The four-decimal serialization that
  decided M5.4 for `tic`, `sic` and `slice` does not exist in-process. **This
  ADR admits no XIC.** XIC needs the new scope record the
  [after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#75-evidence-gated-items)
  names: a new candidate that reruns all 77 PX.3 rows, with ADR 0046's
  semantics unchanged.

**What it does not change:**

- **The open still runs `msaccess` twice.** M0 measured the run summary at
  3,160 ms and metadata at 163 ms on the real file. Only the table's 3,921 ms
  is replaced, by the native pass.
- **Viewing still needs ProteoWizard and still waits for a conversion.** Both
  need the follow-up decision 3 describes.

**Risks:**

- **Numpress, truncation and prediction become regressions.**
  - ProteoWizard decodes them, so `msaccess` presumably shows such spectra
    today. This is not measured, because `msaccess` is under the hold.
  - Under decisions 1 and 3, such a file still opens, because the table pass
    decodes no array. Every selected spectrum in it is refused.
  - ADR 0055 (PR #146) proposes numpress (MS:1002312–1002314,
    MS:1002746–1002748) and truncation and prediction (MS:1003088–1003090)
    among the advanced conversion outputs. Those outputs would be adoptable,
    but their spectra would not be viewable.

  See the open question below.
- **Scope creep.** Every refusal in decision 1 will be asked for, and each
  needs its own decision.
- **Strict reading can refuse what `msaccess` opens.**
  - The reader refuses where it would otherwise have to choose: conflicting
    terms, more than one scan, a missing base peak or TIC.
  - `msaccess` may derive base peak and TIC when a file omits them. That was
    not checked. Decision 8 records whether real files state them.
  - Interpretation remains in a few places: the scan number comes only from
    `scan=N`, the table's one precursor column shows the first precursor, and
    a precursor's m/z and intensity come from its first selected ion.
  - mzdata agreed on everything compared, but unusual yet valid
    vendor-converted mzML could still disagree.
- **Representativeness.**
  - Only one real acquisition was tested, in two one-spectrum files.
  - All scale data is synthetic.
  - Integer arrays and declared array units were not tested.
  - Neither the PRIDE file nor a real profile file was measured.

  Decision 8 answers this, and slice 1's fixtures cover integers and units.
- **Two retention-time scales across surfaces.** The QC report shows
  `msaccess`'s retention times with the unit unreported, as today, while the
  preview shows the declared unit. If `msaccess` prints seconds, a minutes
  file's QC report reads about 60 times larger than its preview. Decision 8
  measures the scale if the hold is released. Labelling the QC report is a
  follow-up, because schema 4 records that unit as unreported.
- **Strictness** is established only for the probed cases and the rules of
  decision 2.
- **Ownership.** The project owns about 600–900 production lines plus tests,
  where a dependency would have release notes.

**Open question for the owner: numpress, truncation and prediction.** Three
ways forward:

- keep the typed refusal (recommended for now);
- add native decoding later, in its own decision;
- offer an explicit, labelled "Read with ProteoWizard" action for a refused
  spectrum, which the user chooses. That is not a fallback.

> **Decided by the owner, 2026-10-29: the viewer keeps the typed refusal.** An
> adopted numpress output (ADR 0055) opens, because the table pass decodes no
> array, and each of its spectra shows that refusal. Native decoding and a
> "Read with ProteoWizard" action each remain possible later, in their own
> decision.

**Open question for the owner: a chromatogram above 100,000 spectra.** This ADR
keeps today's row-capped state (decision 5). Two other ways:

- raise `MAX_SPECTRUM_TABLE_ROWS`, which sends more rows through React;
- send the chromatogram itself from Rust's retained rows, bounded like any
  list, which is a viewer decision amending ADR 0033 and ADR 0034.

## What this amends, on acceptance

- **[ADR 0002](0002-external-proteowizard.md).** ProteoWizard stays the
  conversion backend and still reads the open's metadata and run summary. It no
  longer reads mzML's spectrum table or spectra for viewing.
- **[ADR 0003](0003-msaccess-preview-spike.md).** Its acceptance of
  `msaccess` for preview navigation is superseded for the spectrum table and
  selected spectra of mzML. It stands for metadata and the run summary. Its
  measurements stay as recorded.
- **[ADR 0005](0005-mzml-preview-boundary.md), for mzML sources.**
  - "Unknown stays unknown" now reports representation and retention-time
    unit where the file declares them, and keeps them unknown where it does
    not.
  - The stick-only rule becomes sticks for centroid and unknown spectra, and a
    line for profile spectra.
  - These no longer apply to the spectrum table and selected spectra:
    - one backend process per read;
    - the 8 MiB output ceiling, and with it the refusal of a run cut by it. A
      table above the transfer bound opens as a prefix with its total, under
      the bounded-transfer rule ADR 0005 already states for every list, and
      has no chromatogram;
    - the installation identity a selected spectrum is checked against.
  - The single backend gate still applies, and now also serializes native
    reads. Everything it says of metadata and the run summary still applies.
  - The bounded preview cache it left open is decided for this reader
    (decision 4).
  - Unchanged: the command surface, Rust's ownership of the path, bounded and
    redacted transfer, generation checks, and two disagreeing spectrum counts
    both shown with neither chosen.
- **[ADR 0006](0006-multi-dataset-workspace-boundary.md).** The 1,024-row
  capacity stands. A native read holds no file handle; the row's identity
  lease stays its only handle, so a row's handle cost is unchanged. Native
  preview state is kept for one dataset at a time, so its memory does not grow
  with the roster.
- **[ADR 0028](0028-figure-renderer-and-semantic-specification.md).** A
  profile-spectrum mark joins the shared specification under its existing
  rules (decision 9, slice 3), and no rule changes. If the mark changes the
  saved specification's schema, slice 3 owns that step.
- **[ADR 0044](0044-conversion-configuration-authority.md).** Not amended.
  `backendUsable` still gates every mzML read, native or not. The follow-up
  that admits native reads without a usable backend or during a conversion
  amends this projection, together with Rust's admission (decision 3).
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
