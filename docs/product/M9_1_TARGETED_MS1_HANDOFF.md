# M9.0 route decision and M9.1 targeted MS1 handoff

Status: **M9.0 LOCAL ROUTE VALIDATION COMPLETE — CONDITIONAL RECOMMENDATION / NO
ROUTE ADMITTED.** Date: 2026-09-23. Evidence: [M9.0 route evidence](../spikes/M9_0_TARGETED_MS1_ROUTE_EVIDENCE.md).
Draft shapes: [draft contract](../../experiments/m9_0/draft_contract.json).
Builds on the [M8 handoff](M8_1_FIRST_CLOSED_LOOP.md#m9-handoff).

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.1
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · PUBLIC BETA NOT RELEASED; M10 NOT STARTED

Nothing here is implemented in the product. The recipe below is proposed, not
admitted.

## Decision record

### Fixed by this task

- **The first recipe's user job.** Targeted MS1 signal and candidate detection for
  an explicitly selected mzML reference and a typed target list. It is not
  identification, a validated assay, untargeted feature detection or general XIC
  admission. There is no second recipe.
- **The engine to recommend.** `FeatureFinderAlgorithmMetaboIdent` from
  `pyopenms==3.5.0`, labelled experimental upstream and in the product. Route B
  shares the engine, so its absence is a deployment gap, not a missing
  independent answer.
- **The semantics.** `[M+H]+` only; a half-width in ppm for an **open** m/z
  interval; a half-width in seconds for a **closed** RT interval; `raw_area` as the
  primary quantity; the engine's `intensity` only with its source and marked
  run-dependent; feature m/z presented as the theoretical ion.
- **What the adapter refuses rather than converts.** Profile, mixed or negative
  polarity, no MS1, undeclared or non-monotonic RT, equal MS1 times inside a
  target window, a short or namespace-prefixed read, charge other than one.

### Measured recommendation

Adopt route A for M9.1, as a supervised worker running the fixed adapter in a
bundled CPython 3.13 embeddable runtime, **conditional on**:

1. **The four guards that closed round one's failures stay mandatory and are
   re-verified through the Rust supervisor**: equal MS1 times inside a window
   refused (the engine otherwise reports a clean peak as absent); an independent
   namespace-aware spectrum count checked against the reader (it otherwise reads a
   legal prefixed file as empty); `ENGINE_NO_CANDIDATES` as a typed failure (the
   engine raises when no target has a candidate); in-window signal disclosed on
   every `NOT_DETECTED` row.
2. **ASCII-only paths for everything OpenMS touches** — runtime, work root and
   the path handed to the reader — on hosts whose ANSI code page cannot carry the
   path. Measured on code page 936: a CJK source path fails the reader and a CJK
   runtime path is fatal. A same-volume hard link from an ASCII work directory is
   the measured way to present a CJK-path source; anything else is refused with
   a recovery message, never silently copied.
3. **Precision and reproducibility stated, not hidden.** Chromatogram values and
   raw areas are binary32; formula-derived m/z and isotope probabilities are not
   bit-reproducible across runs; engine intensity depends on the other targets.
   Result equality is therefore never byte equality.
4. **Owner approval of the runtime and its packaging** — an owner decision under
   the M8 handoff — including the unresolved redistribution terms of the wheel's
   bundled Qt, MSVC runtime and contrib libraries.

No route is admitted by this record.

### Deliberately deferred

| Item | Prerequisite | Owner |
| --- | --- | --- |
| Route B (TOPP) | A Windows OpenMS asset without the ProteoWizard section, or an explicit change to the HOLD for a download with selective extraction | Owner |
| Runtime bundling, install location, updates, size (352 MB, 117 MB of which is `.cpp` source; matplotlib and Pillow are declared but not imported) | Packaging gate in `ANALYSIS_WORKERS.md`; licence review | Owner |
| Profile input, negative mode, other adducts and charges, ion mobility and FAIMS | Their own measured domains | M9 follow-up |
| Sources with equal MS1 times inside a window (legal mzML; M5.4 built a fixture for them) | An engine fix or a measured workaround | M9 follow-up |
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
  during the attempt — and what it produced. A retry is a new run.
- **Execution attempt**: at most one per run in M9.1. Its facts carry their
  strength: adapter digest and runtime bundle manifest measured by the supervisor
  before launch; engine versions and revision self-reported by the binary; loaded
  module digests hashed from their files after load, not from memory. Paths,
  process ids and operation identifiers are session-only, as in M8.
- **Stable input.** The supervisor obtains the source through the M8.3 runtime
  admission, holds it with `open_pinned_source` (write and delete sharing
  withheld) for the whole attempt, hashes it through that handle and refuses a
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
| Publication only after exit 0, a completed outcome and a validated result | Enforced; measured in M9.0 |
| Filesystem read confinement, network confinement | **Not enforced.** The adapter makes no network call and the algorithm class never reaches TOPP's update check; nothing prevents one |
| Arbitrary scripts, runtime package installation, plugin discovery, dynamic commands | Not admitted |

### Result model

One row per target; the outcome vocabulary and meanings are those of the
[round-one protocol](../../experiments/m9_0/protocol.py). Each row carries the
theoretical ion m/z per trace, the open m/z and closed RT windows, the signal
summary (point count, per-trace sum and maximum, `inWindow`), and, when a feature
exists: apex RT, bounds, `rawArea` (binary32, the sum of raw points in bounds over
both traces), the model fit (status, area in intensity x s, FWHM), the engine
intensity with its source (`model_area` or `imputed_from_run_regression`) and a
run-dependence flag, the candidates, and relations (`sharedWith`,
`suppressedBy`, `overlapRemoved`) expressed as target identifiers. The engine
receives the application's target UUID as its compound name, so its assay
references contain no user text and are not persisted. Scores are not surfaced.
Zero, absent and unprocessed stay distinct: every detected feature measured in
M9.0 had a positive raw area; `NOT_DETECTED` states whether the window held signal; a
refused or failed run has no rows.

### Storage

- **Where.** A project-managed store beside the document,
  `<name>.mscanvas.payloads/`, with one immutable directory per result artifact
  (named by its `ArtifactId`) holding `rows.jsonl`, `evidence.jsonl`,
  `evidence.index.json` and a digest `manifest.json`, plus `.staging/` and an
  `.owner.json` naming the project. The 4 MiB document limit does not change; the
  document holds a small record with the manifest digest and file digests.
- **Order.** Stage in the store's `.staging/` (under an ASCII work root while
  OpenMS writes) → validate → publish the payload directory by one rename →
  reference it from the in-memory project → Save publishes the document through
  M8's temporary-and-rename. A crash or discard between the rename and Save leaves
  an unreferenced payload that open reports and never deletes. A document never
  references a payload that was not already whole.
- **Integrity on open.** Each referenced payload is `available`, `payload_missing`
  or `payload_corrupt` by manifest and file digests. The record stays in history
  either way and is never recomputed silently.
- **Retention.** Runs and records are retained as M8's append-only history. The
  supervisor deletes a failed or cancelled attempt's staging bytes when the
  attempt ends and retries only its own `.staging/` on the next open. No general
  garbage collection, crash resume or history deletion is promised.
- **Bounded retrieval.** Two typed commands: a page of rows (offset, at most 500)
  and one target's evidence lines found through the index, each line capped. The
  renderer never holds a whole result.
- **Encoding.** JSON Lines plus an offset index, measured at about 0.8 KB per row
  and 2.5 KB per trace for 60–100-point windows. The logical model is independent
  of the encoding; a columnar format needs a measured reason.
- **Save As.** Keeps every identifier, rebases source locators by M8's rule, and
  leaves user sources as references. It copies each referenced payload into a
  pending store beside the destination, verifies every digest, renames the store
  into place and only then publishes the document. An incomplete copy publishes
  nothing and leaves nothing. A destination store is reused only when its owner
  file names the same project and no document exists (an interrupted Save As);
  otherwise it is refused. A project whose referenced payload is missing or
  corrupt cannot be saved as a complete copy, so that Save As is refused naming
  the artifact. Payloads are copied, not hard-linked; the new project never points
  into the old store.

### Schema disposition

M9.1 introduces **schema 4**: operation `targetedMs1V1` with its typed parameters
and targets (inline, capped, with the capture-size measurement M8 requires), a
consumed content version on the layer input, the record kind
`targetedMs1ResultV1` with its payload reference, and the attempt facts above.
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
non-mzML input, cancellation and timeout — rerun through the Rust supervisor and
the stored payload, not the Python controller; storage cases S1–S8 as Rust tests;
a CJK-path source and project; and rendered QA of the table, evidence plot and
inspector with every state.

## Differences from the M5/PX XIC contract

The PX refusal stands. This recipe extracts through an open m/z interval (PX: closed),
stores sums as binary32 (PX: exact binary64 agreement), gives an empty spectrum
no point rather than a state, refuses equal MS1 times inside a window (PX kept
them as distinct points), and has no per-scan state vocabulary. Its chromatograms
are evidence for a target's outcome, not an admitted XIC or an export.

## Roadmap after M9.1

M9.1 as above; then result reuse (payload retention tools, export of rows, a
second measured domain) as separate decisions; then the concentrated UI and
release campaign, which the unpublished stack's integration must precede.
