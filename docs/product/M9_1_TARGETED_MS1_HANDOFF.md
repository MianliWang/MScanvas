# M9.0 route decision, M9.1 handoff and M9.1 record

Status: **M9.1 LOCAL VERTICAL IMPLEMENTATION COMPLETE — BOUNDED EXPERIMENTAL
TARGETED MS1 RECIPE.** Date: 2026-09-23. M9.1 evidence:
[M9.1 vertical evidence](../spikes/M9_1_TARGETED_MS1_VERTICAL_EVIDENCE.md). M9.0
evidence: [M9.0 route evidence](../spikes/M9_0_TARGETED_MS1_ROUTE_EVIDENCE.md).
Draft shapes: [draft contract](../../experiments/m9_0/draft_contract.json).
Builds on the [M8 handoff](M8_1_FIRST_CLOSED_LOOP.md#m9-handoff).

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.2
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT
RELEASED; M10 NOT STARTED

Update: M9.2 has since made a stored result durable and exportable; the
status line above is M9.1's own. See the
[M9.2 record](M9_2_TARGETED_MS1_RESULT_REUSE.md).

Update: M9.3 has since replaced the same-volume restriction below. A source on
another volume is no longer refused (`sourceOnAnotherVolume` is gone): it is
read through a copy made in the attempt directory in one read through the held
handle and verified against the plan's bytes, and attempt directories are now
marked and swept when their owner is gone. Two changes reach the link path: a
link that cannot be made, or a held source with no file identity, now falls
back to that copy instead of failing `executionViewUnavailable`; and the
link's name is removed before the source is released. See the
[M9.3 record](M9_3_TARGETED_MS1_EXECUTION_SNAPSHOT.md).

Update: M9.4 has since added a batch: one request over 2–16 chosen layers,
resolved once into one plan per layer, run one after another as one exclusive
job with one Stop. Each member is a run exactly as described below, over its
own layer and its own plan; the exclusive-run rules hold from the first member
to the last. See the [M9.4 record](M9_4_TARGETED_MS1_BATCH.md).

The first section records what M9.1 built. Everything after it is the M9.0
decision and the handoff M9.1 was built against, kept as written; where the
build differs from the handoff, the first section says so.

## M9.1 record

### Decisions this slice was built under

Approved by the owner for M9.1: targeted MS1 as the first recipe (M8 handoff
decision 1); route A — CPython 3.13.15 with `pyopenms==3.5.0` as a fixed private
runtime, with no user-managed Python — for development use (decision 2, for
this slice only and not its packaging); the project-adjacent result store
(decision 3); and project schema 3 → 4. Not authorized and not done: route B
(TOPP) or the held OpenMS installer, any ProteoWizard change, runtime bundling
or installer qualification, a new runtime download, and M9.2.

### What a user can do

In a **saved** project, on a layer whose source is one mzML file:

1. **Targeted MS1…** on the layer row opens a setup above the lists. Nothing is
   sent until the user asks for a review.
2. The user types targets, one per line — label, formula, retention time (s),
   RT half-width (s), optionally a neutral mass — and two parameters: the m/z
   half-width in ppm (default `5`) and the expected peak width in seconds
   (default `6`).
3. **Review plan** sends the typed text. Rust parses every value, mints the
   target identifiers, and answers either the plan with its digest, the engine
   identity with its experimental label and the whole fixed engine profile, or
   every problem by the line it was typed on. A plan that cannot run here says
   why (for example `notYetPublished`).
4. **Run** executes that plan as an accepted operation. The phase Rust reports
   is shown while it runs; **Cancel** names that operation.
5. A completed run opens its result: outcome counts, a bounded row table, and
   for the chosen target the engine's extracted M and M+1 points with the
   retention-time window, the feature's bounds and apex, and other candidates.
   Details shows the plan, the source as read and the attempt facts; a failed
   or cancelled run shows its code, stage and stop facts.
6. Save, reopen and Save As keep the plan, the run and the result; the result's
   rows and evidence live beside the document and are reported available,
   missing or corrupt on every open.

This is an **experimental, bounded targeted lookup**. It is not identification,
not a validated quantitative method, not untargeted feature detection, and not
an admitted XIC. The interface says so on the setup and on every report.

### Identities

| Binding | Value |
| --- | --- |
| Recipe | `targetedMs1`, version 1 |
| Adapter | `apps/desktop/src-tauri/src/targeted_ms1/adapter_v1.py`, embedded in the build; SHA-256 `ED3F7FBD772DE9489A4AFFF86CF3AC0A0D598690C16BB2C6CB87716021AFB0AC` |
| Fixed engine profile | `FIXED_ENGINE_PROFILE` in `project/recipe.rs` (18 keys, defaults included); SHA-256 `ACA2C008B7FA312C42B59DE88F872EFC45BBB65545281B57163C0B181A958AF4` |
| Runtime | CPython 3.13.15 embeddable (amd64) + `pyopenms==3.5.0`, as provisioned into `.tmp/m91-runtime/`; manifest SHA-256 `6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295` (4,628 files, 348,698,831 bytes) |
| Engine | `FeatureFinderAlgorithmMetaboIdent`; OpenMS reports revision `c1370fb` |

A plan binds all four digests. A plan saved against another binding stays in
history and is never executed by this build.

### Runtime custody

- **Development-only.** The runtime is not bundled, not installed and not
  claimed redistributable. `scripts/provision_targeted_ms1_runtime.py` copies
  the M9.0 evidence runtime into `.tmp/m91-runtime/`, verifies every file
  against the embeddable zip, the locked wheels or pip's `RECORD`, and writes
  the manifest. Only a debug build locates it (through the repository path); a
  release build has no runtime and every review answers `recipeUnavailable`.
- **Verified before every launch.** Every manifest entry's length and SHA-256,
  and nothing extra, missing or linked; otherwise the run fails
  `runtimeUnverified` before a process exists. The files are verified, not
  locked: a change between verification and load is not excluded.
- **Checked after load, at the worker's report.** The worker hashes the key
  modules it loaded (the interpreter DLL and the engine's DLLs) from their files
  and reports any module loaded from outside the runtime and the Windows
  directory. The supervisor requires each reported module to be a manifest entry
  with that digest, and none from elsewhere (`runtimeModuleMismatch`
  otherwise). This is the worker's own report, checked against the verified
  manifest, not a measurement by the supervisor.

### Worker

| Limit | M9.1 status |
| --- | --- |
| Fixed interpreter and embedded adapter; argv `python.exe -I -B -X utf8 adapter_v1.py request.json out` with no user text; minimal environment plus a per-attempt `TEMP`, `TMP`, `OPENMS_HOME_PATH` and `OMP_NUM_THREADS=1` | Enforced by the supervisor |
| Suspended spawn into a Job Object: kill-on-close, one active process, 4 GiB job memory, below-normal priority | Enforced by Windows; a second process is refused (measured) |
| 600 s wall-clock budget; termination of the owned tree and an observed exit before the run ends | Enforced. The supervised process has its own stop: a user's cancel is forwarded into it, and the budget stops it without touching the user's flag, so a timeout is a failure (`workerTimeout`), never a cancel, and a cancel already pending when the budget runs out stays a cancel |
| A worker whose end was **not** observed | The run fails `workerNotAccountedFor`. The source stays held and its link and work area stay in place until MSCanvas exits, and every later run in the session is refused (`analysisQuarantined`), as the ProteoWizard lanes quarantine the same fact. Other project operations continue |
| Result published only after exit 0, a completed outcome, a validated result and a validated payload | Enforced |
| A persisted failure carries a closed code and a stage, never a message, path or log | Enforced |
| Filesystem read confinement, network confinement | **Not enforced.** The adapter makes no network call; nothing prevents one |
| Arbitrary Python, shell, plugins, pickle, package installation, user-selected interpreters | Not admitted |

### Execution view

- The supervisor opens the source with read sharing only (write and delete
  sharing withheld) and holds that handle for the whole attempt, hashes the
  content through it and compares it with the plan (`sourceChanged` fails the
  run; nothing is read).
- It creates a **same-volume hard link** at
  `.tmp/m91-jobs/attempts/<uuid>/source.mzML` and requires the link's volume
  serial and 128-bit file identity to equal the held handle's. The worker is
  given only that ASCII path; the source is never copied, rewritten, renamed or
  re-permissioned, and its namespace prefixes are never stripped.
- A source on another volume than the work root is refused **before a run
  exists** (`sourceOnAnotherVolume`), only where both volumes are known and
  differ. No silent copy.
- The adapter re-hashes what it read (`sourceChangedDuringRead`).
- The link is removed and the handle released when the attempt ends. Measured
  limit: while the handle is held, the *link's* own name can still be deleted,
  so another local program could replace the link before the worker opens it.
  The adapter's re-hash of what it read against the plan's digest is what
  catches a substitute. This is a guard against accidents and concurrent
  edits, not a boundary against a hostile local user.
- Paths, process identifiers and the file identity are session-only; the
  document persists the content version only.

### Outcomes and fail-closed rules

Rows use the M9.0 vocabulary: `DETECTED`, `DETECTED_AMBIGUOUS`, `SHARED`,
`SUPPRESSED_BY_OVERLAP`, `NOT_DETECTED`, `FAILED`. `NOT_DETECTED` requires the
engine's positive report: the target reached the library, its windows were
extracted **from at least one MS1 spectrum with peaks**, and it has no candidate
and no feature. Every outcome other than `FAILED` needs that extraction; the
supervisor re-checks it on every row before anything is stored. Every other
unexplained state is `FAILED` with a reason, and a failed run has no rows at
all:

| Case | Handling |
| --- | --- |
| Every target without a candidate | The engine raises. The adapter accepts only the exact measured `RuntimeError` text, a candidate file with zero features, a library whose names are the target identifiers, two transitions per target and one chromatogram per transition; it then records `NOT_DETECTED` rows with `recoveredFromEmptySelection`. Anything else is `engineNoCandidates` or `engineError`. No blanket catch |
| Namespace-prefixed mzML | Counted independently of the reader; a short read fails `sourceReadIncomplete`. Never rewritten |
| Equal MS1 retention times | Refused (`sourceRtNotStrictlyIncreasing`) |
| Extraction at a spectrum edge | `FAILED` `EXTRACTION_AT_SPECTRUM_EDGE` |
| A shared or suppressing partner that is edge-flagged | `FAILED` `RELATED_TARGET_AT_SPECTRUM_EDGE` (exercised by a fixture) |
| A candidate the engine discards with no valid fit | `FAILED` `ENGINE_DISCARDED_NO_VALID_FIT` (exercised by a fixture); with a valid partner in the same batch the engine instead imputes, which the row says (`imputedFromRunRegression`) |
| Candidates removed without a feature | `FAILED` `CANDIDATES_WITHOUT_FEATURE` |
| A window no MS1 spectrum with peaks falls into — beyond the run, in a gap, or an RT typed in the wrong unit | `FAILED` `WINDOW_WITHOUT_MS1_PEAKS`; the other rows of the batch stand. A batch whose every window is beyond the run completes with every row failed and none absent (measured) |
| Profile, mixed or negative polarity, no MS1, ion mobility or FAIMS, unsorted or non-finite values | A failed run with its code and the `source` stage |

`masserror_ppm` is not in the payload, not a gate and not a confidence.

### Numeric contract

Categorical fields — outcomes, reasons, relations, candidate counts, point
counts, spectrum indices — must be identical between runs of one plan.
Numbers are compared with declared tolerances: raw area relative 1e-6, evidence
intensities relative 1e-9, theoretical m/z relative 1e-12. Engine intensity
carries its source and **no reproducibility claim**. The repeat test measured
raw area and evidence identical and theoretical m/z within 2.9e-16.

### Storage and transactions

`<name>.mscanvas.payloads/` beside the document holds `.owner.json`,
`.staging/<ArtifactId>/` and one immutable `<ArtifactId>/` per result with
`rows.jsonl`, `evidence.jsonl`, `evidence.index.json` (per-line offset, length
and SHA-256) and `manifest.json`. Order: the worker writes only into its ASCII
attempt directory → the supervisor validates the result, stages the payload in
the store, validates it again and publishes it by a no-replace rename → the
in-memory project references it → **Save** publishes the document. A crash or a
discard between publication and Save leaves an unreferenced result that open
counts and never deletes. Availability (`available`, `payloadMissing`,
`payloadCorrupt`) is observed on open and after Save As, never stored. Row and
evidence reads are bounded (at most 500 rows a page; one target's lines, each
verified against the index).

**Save As** checks the document it would publish — rebased references, validity
and size — before any result is copied, and again at publication. It assembles
a pending store beside the destination with every available result copied and
re-verified, renames it into place without replacing, and only then publishes
the document: replacing the destination only when it already holds this project
at the bound revision, and otherwise without replacing. An existing destination
store is refused and kept. A result that does not copy whole publishes nothing;
a result already missing or corrupt is carried forward as missing and is not
copied. Save As onto the bound document itself copies nothing; a hard link to it
under another name or in another directory is not the same document, because
its store is found by its own name, and gets a copied store.

A new store is assembled under a fresh pending name beside the document and
renamed into place, so a failed owner write leaves nothing at the store's name.
A process that dies before the rename can leave that pending directory behind.

### Schema 4 disposition

Schema 4 adds top-level `plans` (each executed plan, named by its digest), a
`targetedMs1` block on every run (explicit `null` for other operations), the
operation `targetedMs1V1` and the record kind `targetedMs1ResultV1` with its
outcome summary, the recovery flag and the payload reference. Schemas 1, 2 and
3 are refused as unsupported, as every earlier bump was; nothing migrates.
Schema 3 was never published. No `DatasetId`, `FileIdentity`, path or process
identity is persisted.

### Exclusive run

While a targeted run is in progress, New, Open, Close, Save As, reference and
layer removal and relink are refused (`analysisRunning`); Save is not. The
interface holds every control while it waits, except Cancel — including the
answers to an unsaved-changes question asked before the run, and the setup's
own inputs while a review is out.

### Where M9.1 differs from the handoff below

- **The evidence plot is a screen-only SVG** drawn from the stored evidence. It
  does not go through `mscanvas-plot-spec`, because nothing exports it; an
  export would need that specification first.
- **The row table is compact**: target, outcome with reason, apex RT and raw
  area. Bounds, model status, candidates and relations are in the chosen row's
  facts.
- **No Save As summary** names the results carried forward as missing; each one
  says so where it is shown.
- **Staging left by a crash is not retried on open.** An attempt's staging and
  work directory are removed when the attempt ends; a process that dies first
  leaves them, and nothing collects them.
- **Relinking a detached store** is not implemented (it was an option).
- **The unreferenced-result count** is sent to the interface and not shown.
- **All-absent runs are rows**, through the measured recovery (the handoff's
  option), and the no-valid-fit and related-edge paths are exercised.

### Known limits

- One mzML file per layer; positive-mode, centroided MS1; `[M+H]+` with M and
  M+1 traces; at most 200 targets.
- The source must be on the work root's volume; a CJK source path is read
  through the link, and a CJK project path stores, reopens and copies its
  results (both measured).
- A peak whose apex sits near a window edge can be `NOT_DETECTED`; the report
  says what `NOT_DETECTED` means and does not claim absence.
- Filesystem and network confinement are not enforced.
- A run whose result would make the document larger than a save can publish is
  refused `oversized` after the worker ran, and nothing is recorded.
- The time budget and a cancel can still race by one monitor tick in either
  direction; the recorded reason follows whichever the supervisor saw first.
- The runtime exists only in a development checkout; there is no installer
  path, no update path and no licence review of the wheel's bundled libraries.

## M9.0 decision and M9.1 handoff, as written before M9.1

The sections below are the M9.0 record as it stood when M9.1 began. Its
status then was M9.0 LOCAL ROUTE VALIDATION COMPLETE — CONDITIONAL
RECOMMENDATION / NO ROUTE ADMITTED, with M9.1 not started.

## Decision record

### Fixed by this task

- **The user job measured.** Targeted MS1 signal and candidate detection for an
  explicitly selected mzML reference and a typed target list, as the owner's M9.0
  instruction assigned it. It is not identification, a validated assay,
  untargeted feature detection or general XIC admission. Adopting it as M9's
  first recipe remains the owner's decision 1 of the M8 handoff. There is no
  second recipe.
- **The engine to recommend.** `FeatureFinderAlgorithmMetaboIdent` from
  `pyopenms==3.5.0`, labelled experimental upstream and in the product. Route B
  shares the engine, so its absence is a deployment gap, not a missing
  independent answer.
- **The semantics.** `[M+H]+` only; a half-width in ppm for an **open** m/z
  interval; a half-width in seconds for a **closed** RT interval; `raw_area` as the
  primary quantity; the engine's `intensity` only with its source and marked
  run-dependent; feature m/z presented as the theoretical ion.
- **What the adapter refuses rather than converts.** Profile, mixed or negative
  polarity, no MS1, undeclared or non-monotonic RT, equal MS1 times anywhere in
  the file (the tested guard), ion mobility and FAIMS, charge other than one. A
  short or namespace-prefixed read and an all-absent run fail with their own
  codes.

### Measured recommendation

Adopt route A for M9.1, as a supervised worker running the fixed adapter in a
bundled CPython 3.13 embeddable runtime, **conditional on**:

1. **The adapter's guards stay mandatory and are re-verified through the Rust
   supervisor.** Three close three measured failure classes: equal MS1 times
   refused (the engine otherwise reports a clean peak as absent); an independent
   namespace-aware spectrum count checked against the reader (it otherwise reads
   a legal prefixed file as empty); `ENGINE_NO_CANDIDATES` as a typed failure
   (the engine raises when no target has a candidate). The count is a second full
   parse of the source on every run: on the 156 MB fixture the run no longer reached
   the engine within 3 s. Two more came from the
   review: a target whose window meets the extractor's measured first- or
   last-peak defect is typed `FAILED`, and FAIMS or ion mobility is refused.
   **Not closed:** a peak whose apex sits near the window's edge can be reported
   `NOT_DETECTED`; that is a domain limit with a recovery hint (widen or centre
   the window), and every `NOT_DETECTED` row states whether its window held any
   non-zero point, which on real data is almost always true and is not a claim of
   signal.
2. **ASCII-only paths for everything OpenMS touches** — runtime, work root and
   the path handed to the reader — on every host. Measured on code page 936,
   which can encode the names used: a CJK source path fails the reader and a CJK
   runtime path is fatal; a UTF-8 code page was not measured. With the source
   held with M8's share mode (read sharing only, as `open_for_stable_read` in
   `project/observe.rs` opens for one measurement) for the whole attempt — the
   whole-attempt hold is new in M9.1 — a same-volume hard link from an ASCII work
   directory was read to completion. That route writes a directory entry on the
   user's data volume, outside the project, and needs NTFS, the source's own
   volume and a writable ASCII directory there; where that directory may live is
   a new write authority for M9.1 to decide with the owner. Anything else is
   refused with a recovery message, never silently copied.
3. **Precision and reproducibility stated, not hidden.** Spectrum intensities are
   rounded to binary32 on load, chromatogram points are binary64 sums of them, and
   raw areas are binary32; formula-derived m/z and isotope probabilities are not
   bit-reproducible across runs; engine intensity depends on the other targets
   and is not reproducible run to run even for the same targets (3.7e-6 relative
   measured on a valid fit), and if no fit in a run is valid, so does whether a
   feature survives. Result equality is therefore never byte equality.
4. **Owner approval of the runtime and its packaging** — decision 2 of the M8
   handoff — including the unresolved redistribution terms of the wheel's bundled
   Qt, MSVC runtime and contrib libraries.
5. **Owner approval of the external payload store** — decision 3 of the M8
   handoff — as specified below.

No route is admitted by this record.

### Deliberately deferred

| Item | Prerequisite | Owner |
| --- | --- | --- |
| Route B (TOPP) | A Windows OpenMS asset without the ProteoWizard section, or an explicit change to the HOLD for a download with selective extraction | Owner |
| Runtime bundling, install location, updates, size (352 MB, 117 MB of which is `.cpp` source; matplotlib and Pillow are declared but not imported) | Packaging gate in `ANALYSIS_WORKERS.md`; licence review | Owner |
| Profile input, negative mode, other adducts and charges, ion mobility and FAIMS | Their own measured domains | M9 follow-up |
| Sources with equal MS1 times inside a window (legal mzML; M5.4 built a fixture for them) | An engine fix or a measured workaround | M9 follow-up |
| Near-edge peaks reported as candidates; the extractor's first/last-peak defects fixed | An engine change | M9 follow-up |
| The no-valid-fit discard path exercised by a fixture | A reproducible fit failure | M9.1 acceptance |
| A UTF-8 ANSI code page, and non-ASCII paths beyond the hard-link route | Measurement | M9 follow-up |
| All-absent runs reported as rows instead of a failure | Recovery from the engine's own empty candidate file, validated against message and state stability | M9.1 option, not required |
| Surfacing engine scores (`sn_ratio`, library correlation); `masserror_ppm` is contaminated by out-of-window peaks | Per-score validation | M9 follow-up |
| Reporting the engine defects upstream | Correspondence is not authorized here | Owner |
| Multi-layer comparison, normalization, XIC export, a second recipe, node canvas, CLI/MCP | Their own decisions; raw side-by-side inspection and quantitative comparability remain different questions | M9/M10 |
| Integrating the unpublished stack (M7.6 → M8 → M9.0) into `main` | An independent source-integration decision | Owner |

## M9.1: one vertical result

**User goal.** Choose a reference already in the project, give a short target
list and two parameters, review what will run, run it, and inspect per-target
outcomes with their evidence and provenance.

**Task path.** Recipe entry from the selected layer → target entry (typed rows or
pasted TSV with the fixed columns) and parameters → review summary (source
content version, targets, parameters, engine and its experimental label, domain
limits) → Run → progress by phase, cancellable → result table in the evidence
region with the selected target's chromatogram → Details inspector with
provenance. Error recovery: every refusal names what to change (move a file to an
ASCII path, remove duplicate spectra, choose a centroid positive-mode source);
every failure keeps the run in history and publishes nothing.

### Data and execution

- **Recipe definition** (`targetedMs1`, version 1): code-owned and immutable —
  domain, parameter and target schema, outcome vocabulary, the fixed engine
  profile and its digest, the adapter digest.
- **Approved plan**: what the user reviewed — recipe identity and digests, the
  consumed layer and input **with the content version the plan expects** (per
  member role, byte length and SHA-256 from the M8 baseline), parameters and
  targets. Its canonical digest names it.
- **Run**: one execution of one plan, terminal as in M8 (`completed`, `failed`,
  `cancelled`), naming what it consumed — including the content version measured
  during the attempt — and what it produced. A retry is a new run. Request and
  parameter checks run in Rust before any run exists and create none. A refusal
  the worker makes after launch (profile, polarity, equal times, FAIMS, no MS1) is
  a `failed` run carrying a refusal code and its stage; M8's run states are not
  extended.
- **Where a run may start.** Only in a saved project: its payload store needs the
  document's location. Save As, Open, Close and New are unavailable while a run
  is active.
- **Execution attempt**: at most one per run in M9.1. Its facts carry their
  strength: adapter digest and runtime bundle manifest measured by the supervisor
  before launch; engine versions and revision self-reported by the binary; loaded
  module digests hashed from their files after load, not from memory. Paths,
  process ids and operation identifiers are session-only, as in M8.
- **Stable input.** The supervisor obtains the source through the M8.3 runtime
  admission, holds it with M8's stable-read share mode (write and delete sharing
  withheld, as `open_for_stable_read` does for one measurement) for the whole
  attempt, which is new in M9.1, hashes it through that handle and refuses a
  mismatch with the plan (`SOURCE_CHANGED`). The worker reads by path while the
  pin holds; the adapter re-hashes after the read. This protects the attempt; it
  does not promise that M8's earlier observation stays current.
- **Cancellation** names the accepted operation (M8.1's rule); with no current
  operation it is refused, never kept for later. Termination is recorded
  separately from the request, and only an observed exit ends the run.
- **M8 records are not reclassified.** FileFacts and QC snapshots stay what they
  are and are not inputs of this recipe.

### Worker and trust boundary

A supervised, application-controlled process for one fixed reviewed adapter. It
is not an untrusted-code sandbox.

| Limit | M9.1 status |
| --- | --- |
| Fixed interpreter and adapter, digests verified before launch; typed request; argv fixed; environment allow-listed | Enforced by the supervisor |
| Wall-clock budget; termination of the owned child and observed exit | Enforced; measured in M9.0 |
| Job object with kill-on-close, one active process, a memory cap, below-normal priority | Enforced by Windows once M9.1 adds it; not measured in M9.0 |
| Messages and logs | May name paths; they are session-only. A persisted failure carries a code and a stage, never a message, path or log |
| Publication only after exit 0, a completed outcome and a validated result | Enforced; measured in M9.0 |
| Filesystem read confinement, network confinement | **Not enforced.** The adapter makes no network call and the algorithm class never reaches TOPP's update check; nothing prevents one |
| Arbitrary scripts, runtime package installation, plugin discovery, dynamic commands | Not admitted |

### Result model

One row per target; the outcome vocabulary and meanings are those of the
[round-one protocol](../../experiments/m9_0/protocol.py). Each row carries the
theoretical ion m/z per trace, the open m/z and closed RT windows, the signal
summary (point count, per-trace sum and maximum in binary64, `anyNonzeroPoint`),
and, when a feature exists: apex RT, bounds, `rawArea` (binary32, the sum of raw
points in bounds over both traces), the model fit (status, area in intensity x s,
FWHM), the engine intensity with its source (`model_area` or
`imputed_from_run_regression`) and a run-dependence flag, the candidates, and
relations (`sharedWith`, `suppressedBy`, `overlapRemoved`) expressed as target
identifiers. The outcome does not hide the rest: a row also carries its candidate
count and, for the feature that won an overlap, an `overlapWinner` flag, so
`SHARED` never hides a two-candidate selection. `NOT_DETECTED` requires zero
candidates; otherwise the row is `FAILED` (`CANDIDATES_WITHOUT_FEATURE`). Other
typed `FAILED` reasons: `EXTRACTION_AT_SPECTRUM_EDGE`,
`RELATED_TARGET_AT_SPECTRUM_EDGE` (a partner of such a target; not exercised),
`ENGINE_DISCARDED_NO_VALID_FIT` (from source, not yet exercised) and a target
missing from the engine library. The engine receives the application's target
UUID as its compound name, so its assay references contain no user text and are
not persisted. Scores are not surfaced. Zero, absent and unprocessed stay
distinct: every detected feature measured in M9.0 had a positive raw area; a
run refused before it starts, or a failed run, has no rows.

### Storage

- **Where.** A project-managed store beside the document,
  `<name>.mscanvas.payloads/`, with one immutable directory per result artifact
  (named by its `ArtifactId`) holding `rows.jsonl`, `evidence.jsonl`,
  `evidence.index.json` and a digest `manifest.json`, plus `.staging/` and an
  `.owner.json` naming the project. The 4 MiB document limit does not change; the
  document holds a small record with the manifest digest and file digests.
- **Order.** The engine writes only into an ASCII work root outside the project →
  the supervisor validates the attempt and copies its payload files into the
  store's `.staging/`, on the store's own volume → publish the payload directory
  by one rename →
  reference it from the in-memory project → Save publishes the document through
  M8's temporary-and-rename. A crash or discard between the rename and Save leaves
  an unreferenced payload that open reports and never deletes. A document never
  references a payload that was not already whole.
- **Integrity on open.** Each referenced payload is `available`, `payload_missing`
  or `payload_corrupt` by manifest and file digests. The record stays in history
  either way and is never recomputed silently. Availability is observed, never
  stored. The store is found by the document's name, so renaming or moving the
  document outside the application detaches it; open then reports every payload
  missing, and M9.1 must say so plainly. Relinking a detached store is an M9.1
  option, not a requirement.
- **Retention.** Runs and records are retained as M8's append-only history. The
  supervisor deletes a failed or cancelled attempt's staging bytes when the
  attempt ends and retries only its own `.staging/` on the next open. No general
  garbage collection, crash resume or history deletion is promised.
- **Bounded retrieval.** Two typed commands: a page of rows (offset, at most 500)
  and one target's evidence lines found through the index, each line capped. The
  renderer never holds a whole result.
- **Encoding.** JSON Lines, measured at about 0.8 KB per row and 2.5 KB per trace
  for 60–100-point windows, plus an offset index that is proposed and not
  prototyped. The logical model is independent of the encoding; a columnar format
  needs a measured reason.
- **Save As.** Keeps every identifier, rebases source locators by M8's rule, and
  leaves user sources as references. The document-size check runs before any
  payload is copied. It copies each available payload into a pending store beside
  the destination, verifies every digest, renames the store into place and only
  then publishes the document. An available payload that does not copy whole
  publishes nothing and leaves nothing. A payload already missing or corrupt in
  the source is carried forward as unavailable and named in the Save As summary;
  copying cannot make it whole and history keeps its record. **An existing
  destination store is refused and never deleted**, even when its owner file names
  the same project: every Save As copy shares that identifier, so it cannot tell
  an interrupted Save As from another copy's store. The document is published
  through M8's refuse-existing publish, never over a file that appeared meanwhile.
  Payloads are copied, not hard-linked; the new project never points into the old
  store.

### Schema disposition

M9.1 introduces **schema 4**: operation `targetedMs1V1` with its typed parameters
and targets (inline, at most 200 per run — the experiment adapter admitted up
to 1000 — with the capture-size measurement M8 requires; at about 160–200 bytes per target, runs accumulate in append-only
history), a
consumed content version on the layer input, the record kind
`targetedMs1ResultV1` with its payload reference, and the attempt facts above.
The record does not store the run that produced it: as in M8, that edge is
stated by the run and derived for the record.
Schema 3 was never published; whether schema 4 must also read schema 3 depends
on whether M8 is published first, which the source-integration decision settles.
Nothing here edits schema 3.

### UI consumers

The centre evidence region gets a row table (outcome text and symbol, target,
apex RT, bounds, raw area, model status, candidate count, relation) and, for the
selected row, the engine's extracted M and M+1 points with picked and candidate
bounds, through the shared plot specification; no chart library is added. The
Details inspector shows the plan (source content version, parameters, targets),
the engine identity with its experimental label and the full profile, the attempt
facts with their strengths, and the row's semantic notes (binary32, run-dependent
intensity, theoretical m/z). Loading, empty, refused, failed, cancelled and
unavailable-payload states are required.

### M9.1 acceptance

The M9.0 matrices' decisive cases — positive and absent controls, open-interval
probes, ambiguity, isomers, prefixed, equal times, all-absent, truncated and
non-mzML input, FAIMS, spectrum-edge extraction, cancellation and timeout — rerun
through the Rust supervisor and the stored payload, not the Python controller; an
edge-of-window peak and a no-valid-fit run as new fixtures; storage cases S1–S8
as Rust tests; a CJK-path source through the pin and hard link, and a CJK-path
project; and rendered QA of the table, evidence plot and inspector with every
state.

## Differences from the M5/PX XIC contract

The PX refusal stands. This recipe extracts through an open m/z interval (PX:
closed), sums binary32-rounded intensities (PX: exact binary64 agreement over the
stored values), gives an empty spectrum no point rather than a state, carries the
engine's measured spectrum-edge defects as typed failures, refuses equal MS1
times (PX kept them as distinct points), and has no per-scan state vocabulary. Its chromatograms
are evidence for a target's outcome, not an admitted XIC or an export.

## Roadmap after M9.1

M9.1 as above; then result reuse (payload retention tools, export of rows, a
second measured domain) as separate decisions; then the concentrated UI and
release campaign, which the unpublished stack's integration must precede.
