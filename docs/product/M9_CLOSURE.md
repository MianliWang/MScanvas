# M9 closure — the targeted MS1 analysis phase as it stands

Status: **M9 LOCAL IMPLEMENTATION COMPLETE — TARGETED-MS1 ANALYSIS PHASE
CLOSED LOCALLY.** Date: 2026-09-24. Branch `feat/m9-closure`, from the M9.4
endpoint `13a3560c1ad6f14878dfb659a7f014b79c422488`. Evidence:
[M9 closure evidence](../spikes/M9_CLOSURE_EVIDENCE.md).

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 LOCAL IMPLEMENTATION
COMPLETE · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD HOLD
UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT RELEASED;
M10 NOT STARTED

**Read this first.** This is the one place that states what M9 is now. The
slice records below are history: each says what that slice built and decided
when it was built, and later slices changed some of it. Where they differ, this
document and the code it names win.

| Slice | Record | Evidence | Decision |
| --- | --- | --- | --- |
| M9.0 route study | [M9.0 decision and M9.1 handoff](M9_1_TARGETED_MS1_HANDOFF.md#m90-decision-and-m91-handoff-as-written-before-m91) | [M9.0](../spikes/M9_0_TARGETED_MS1_ROUTE_EVIDENCE.md) | conditional recommendation |
| M9.1 first recipe | [M9.1 record](M9_1_TARGETED_MS1_HANDOFF.md#m91-record) | [M9.1](../spikes/M9_1_TARGETED_MS1_VERTICAL_EVIDENCE.md) | owner decisions 1–3 of the [M8 handoff](M8_1_FIRST_CLOSED_LOOP.md#m9-handoff) |
| M9.2 result reuse and export | [M9.2 record](M9_2_TARGETED_MS1_RESULT_REUSE.md) | [M9.2](../spikes/M9_2_TARGETED_MS1_RESULT_REUSE_EVIDENCE.md) | [ADR 0048](../architecture/adr/0048-stored-targeted-result-reuse-and-export.md) |
| M9.3 execution snapshot and recovery | [M9.3 record](M9_3_TARGETED_MS1_EXECUTION_SNAPSHOT.md) | [M9.3](../spikes/M9_3_TARGETED_MS1_EXECUTION_SNAPSHOT_EVIDENCE.md) | [ADR 0049](../architecture/adr/0049-content-bound-execution-snapshot.md) |
| M9.4 controlled batch | [M9.4 record](M9_4_TARGETED_MS1_BATCH.md) | [M9.4](../spikes/M9_4_TARGETED_MS1_BATCH_EVIDENCE.md) | [ADR 0050](../architecture/adr/0050-sequential-batch-of-independent-targeted-plans.md) |

## 1. What M9 is

**A bounded, experimental targeted-MS1 recipe, implemented locally.** In a
saved project, a user types a list of small-molecule targets and two
parameters, reviews a digest-named plan over one mzML acquisition (or one plan
each over 2–16 of them), runs it in a supervised pyOpenMS worker, and reads,
draws and exports each acquisition's stored result later without the runtime
or the source.

It is not chemical identification, not a validated quantitative assay, not
untargeted feature detection, not a general or exportable XIC, not a
multi-sample comparison, and not a distributable feature: the runtime exists
only in a development checkout. At this closure nothing here was
source-integrated, installed, qualified or released (§11); source integration
is recorded in the
[M8/M9 source-integration record](../development/M8_M9_SOURCE_INTEGRATION.md).

## 2. Identities

| Milestone | Final documentation head | Code the milestone's gates ran on |
| --- | --- | --- |
| M9.0 | `1652affdb3547011dddcd67a06b8b18458597faf`, tree `35f84c40f5ab62f8f5be6526fb247a7605b5c79d` | last executed: `17d6c9495da8dcfa72d3eb6e479b35a9dc5bb350`, tree `3440df9686276be396f3290d47d37a28dff2b682`. Its successors change documentation and the two experiment records `experiments/m9_0/draft_contract.json` and `manifest.json`, no code |
| M9.1 | `96f2d8caa66e8228aa7a899de5634b8f9a4ec7d5`, tree `cd2a745e088a501cb82ebc88866eed74aef26f07` | `7fcc46582646f06c8d6f65aa27df63323d725811`, tree `5a3f5b6a33ef9ac44b5415a728005192f2b4697c`; its whole-browser-suite run was on the parent `4764c749e57bfed3dc078da263eb98f3b4a5ed17`, tree `d362ac20cdbc2cfbfba8a63e6bb1c84138b7eaf8` |
| M9.2 | `d1d9f586bef73715fc4bddf39795498059c0fada`, tree `c437b3bc05d01cfa612b4bb0c9f3d6df06c6e95f` | `4e4e00ca22526a42a9b070226b126f990aae404b`, tree `a9cceec7537a42df2d611abbfccbbf62c1ce1e93` |
| M9.3 with M9.3.C1 | `3d6300f1bae8766c6708c0fabf3bd1cdb7a23fa3`, tree `e4a94c868a31a9a5ce415b179bd4e5e4afe8dfdc` | `c69889ba840a67072ebbaed5a32e1d2ede20a1b3`, tree `15070fb747e964a067ade58c6111a5d79e721b01` (M9.3 before C1: `23ba012d7024611891080537db35bd73a4b86e32`, tree `03a082a6e6dcbcb1e09a60b0da1562b83c7d627c`) |
| M9.4 | `13a3560c1ad6f14878dfb659a7f014b79c422488`, tree `574630fe3c668471c386ed48c8c9658e981988c5` | Rust gates `5e3f127fb92181a329ead1037b6f5919f1ecc21e`, tree `6f3a867e9e9a374b951b6644c9b0dc89e60f27f6`; frontend and browser gates `35def0d319092308cb22cdf4fba2d012b679d8e1`, tree `cf77c5f472791de5ef8d69e6a0bd067f6949b221`, which differs only in `preview/tests.rs` |
| **M9 closure** | this document's commit; see the evidence | `fa7f213b181e9e5ecb7e164f3b128b2da631c7a9`, tree `56e85d1bcfe4999eeda53290e81f292e1196eb05`: every gate but the repository-wide browser suite ran on it. That suite ran on `59cbf1c62ac27614308840cc0902e5068c03e61c` (tree `6998915642af06ab502d194a756271d6cff21012`), from which the final code differs in Rust files and a Rust test fixture, which the browser suite does not build or load, and in four e2e files: a helper appended to the harness and the three M8.5/M9 specs that use it, each run again on the final code |

Every head above was verified as an ancestor of the closure; every
"documentation" successor was checked with `git diff --name-only`.
`main` and `origin/main` are `1daf802f06d0149b5de3dbd12e8b01e7e86862ec` and
were not moved; no branch head was moved.

## 3. The current contract

### 3.1 Scientific domain

| Item | Current value | Enforced by |
| --- | --- | --- |
| User job | Targeted small-molecule MS1 signal and candidate lookup for a typed target list | recipe `targetedMs1`, version 1 |
| Source | One layer whose reference is one file named `.mzML` (one primary member, nothing else) | `recipe::source_is_supported`; otherwise `recipeSourceUnsupported`, no plan |
| Spectra | MS1, declared centroided, positive polarity only, one polarity, strictly increasing MS1 retention times, sorted finite m/z, no ion mobility or FAIMS | the adapter; a failed run at the `source` stage (`sourceNotCentroid`, `sourcePolarityUnsupported`, `sourceMixedPolarity`, `sourceRtNotStrictlyIncreasing`, `sourceRtUndeclaredOrNonmonotonic`, `sourceUnsortedMz`, `sourceNonfinite`, `sourceIonMobilityUnsupported`, `sourceNoMs1`). Nothing is converted to fit |
| Ion | `[M+H]+`, charge 1, M and M+1 traces | no field exists for anything else |
| Targets per plan | 1–200 (`MAX_TARGETS`), in the order the engine receives them | `recipe::resolve`, `record::validate_plan` |
| One target | a label (≤ 200 characters, no control characters), unique within the request; plain neutral sum formula (element symbols, counts of at most four digits, ≤ 100 characters); optional neutral monoisotopic mass (0, 5000] Da; RT [0, 86400] s; RT half-width (0, 3600] s | label uniqueness: `recipe::resolve` at review; every other value: `record::target_is_valid`, at review and on every open. The document itself requires unique target identifiers, not unique labels (§5) |
| Parameters | m/z half-width [0.5, 50] ppm for an **open** m/z interval; expected peak width (0, 600] s; the RT window is **closed** | `record::parameters_are_valid` |
| Engine | `FeatureFinderAlgorithmMetaboIdent`, pyOpenMS 3.5.0, OpenMS revision `c1370fb`, labelled experimental; the fixed 18-key engine profile, SHA-256 `ACA2C008B7FA312C42B59DE88F872EFC45BBB65545281B57163C0B181A958AF4` | `recipe::FIXED_ENGINE_PROFILE`; the supervisor refuses a result whose reported profile differs |
| Acquisitions per plan | exactly one | a plan has one `layerId` and one `inputId` |
| Batch | 2–16 distinct acquisitions, one request, one plan each, run one after another | §3.6 |
| Quantities | `rawArea` (binary32, the sum of raw points in bounds over both traces) is the primary quantity; engine intensity is recorded with its source and is run-dependent; feature m/z is the theoretical ion. Categorical fields are identical between runs of one plan; numbers compare within declared tolerances (raw area 1e-6, evidence 1e-9, theoretical m/z 1e-12, relative). Nothing is calibrated | M9.1 numeric contract |

### 3.2 Outcomes

A **run** ends `completed`, `failed` or `cancelled`. A **target row** exists
only in a completed run's result. The two are never mixed: a run failure has
no rows and is never a finding about a target, and no row outcome is a run
failure.

| Row outcome | Meaning | Required of the row (`PayloadRow::is_consistent`) |
| --- | --- | --- |
| `DETECTED` | one candidate, and it became this target's feature | extracted from at least one spectrum; a feature; exactly one candidate; no relation |
| `DETECTED_AMBIGUOUS` | a feature chosen among two or more candidates | as above, with two or more candidates |
| `SHARED` | this target's feature is also another target's | extracted from at least one spectrum; a feature; at least one partner named in `sharedWith`; not suppressed |
| `SUPPRESSED_BY_OVERLAP` | another target's feature won the overlap; this target has none | extracted from at least one spectrum; no feature; the suppressing target named; no `sharedWith` partner |
| `NOT_DETECTED` | the engine extracted this target's windows from at least one MS1 spectrum with peaks and reported no candidate and no feature. Not proof of absence | a real extraction; no feature, no candidate, no relation, no overlap removal |
| `FAILED` + reason | the recipe could not decide; never an absence | no feature; exactly one reason |

`FAILED` reasons: `EXTRACTION_AT_SPECTRUM_EDGE`,
`RELATED_TARGET_AT_SPECTRUM_EDGE`, `CANDIDATES_WITHOUT_FEATURE`,
`ENGINE_DISCARDED_NO_VALID_FIT`, `TARGET_ABSENT_FROM_ENGINE_LIBRARY`,
`TARGET_UNACCOUNTED`, `WINDOW_WITHOUT_MS1_PEAKS`.

| Case | Current handling |
| --- | --- |
| Every target without a candidate (the engine raises) | Accepted only through the measured recovery, and then the result's `noCandidateRecovery` is true: a row whose window was extracted is `NOT_DETECTED` with `recoveredFromEmptySelection`; one at a spectrum edge or over a window without MS1 peaks is `FAILED` with that reason. Anything the recovery cannot establish is a failed run (`engineNoCandidates`, `engineError`) |
| A window no MS1 spectrum with peaks falls into | That row `FAILED` `WINDOW_WITHOUT_MS1_PEAKS`; the others stand. A plan whose every window is outside the run completes with every row failed and none absent |
| No MS1 spectrum in the file | failed run, `sourceNoMs1` |
| A file the engine cannot read, reads short, or holds equal MS1 times | failed run: `sourceUnreadable`, `sourceReadIncomplete`, `sourceRtNotStrictlyIncreasing` |
| An engine intensity imputed from the other targets | the row keeps its outcome; `engineIntensitySource` is `imputedFromRunRegression`, never `modelArea` |
| The same meaning everywhere | stored payload word → Rust `RowOutcome`/`RowFailure` → interface word, symbol and reason sentence (exhaustive maps checked by the type checker) → CSV/TSV `outcome` and `failure_reason` columns in the payload's own words → figure title in words. The batch panel shows execution states only, never a target outcome |

### 3.3 Execution

| Guarantee | Current implementation |
| --- | --- |
| Runtime | CPython 3.13.15 embeddable (amd64) + `pyopenms==3.5.0` under `.tmp/m91-runtime/`, manifest SHA-256 `6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295` (4,628 files, 348,698,831 bytes). Located only by a debug build through the repository path; a release build has none and every review answers `recipeUnavailable` |
| Runtime identity | every manifest entry's length and SHA-256, and nothing extra, missing or linked, before every launch (`runtimeUnverified`); after load, the worker's report of the modules it loaded is checked against the manifest (`runtimeModuleMismatch`) — the worker's report, not a supervisor measurement |
| Adapter | `adapter_v1.py`, embedded in the build, SHA-256 `ED3F7FBD772DE9489A4AFFF86CF3AC0A0D598690C16BB2C6CB87716021AFB0AC`, written into the attempt directory and hashed again there |
| Supervision | fixed argv `python.exe -I -B -X utf8 adapter_v1.py request.json out`, an allow-listed environment, a Job object (kill-on-close, one process, 4 GiB, below-normal priority), a 600 s budget, and an observed exit before a run ends |
| Stop and time | a user's cancel is a `cancelled` run with its stop facts; the budget is a `failed` run `workerTimeout` with a `timeBudgetExceeded` stop; a cancel reaching the commit before it stops publication; a worker whose end was not observed is `workerNotAccountedFor` and quarantines the session (`analysisQuarantined`) until MSCanvas exits — also after a cancel, which is then a failed run with no stop facts, because the worker's end is what was not established |
| Input-content binding | the source is opened once, read-only with write and delete sharing withheld, before any byte is read; its bytes must be the plan's expected length and SHA-256 (`sourceChanged`); the adapter hashes what it read again (`sourceChangedDuringRead`) |
| Same-volume view | a hard link in the attempt directory, shown to be the held object; a link that is not is refused (`executionViewUnavailable`) and never replaced by a copy |
| Cross-volume view | a copy made in one read through the held handle, each chunk hashed as written, compared with the plan, then held read-only and hashed again before the worker is given it; also used where no link can be made |
| Room for a copy | asked before a run exists where the source is proven to be on another volume, after sweeping provably abandoned scratch (`insufficientWorkAreaSpace`, nothing recorded); running out during the attempt is a failed run at the `source` stage |
| Not enforced | filesystem read confinement and network confinement: the adapter makes no network call, and nothing prevents one |

### 3.4 Persistence

- **Schema 4**, one bounded JSON document of at most 4 MiB, parsed and
  validated whole (§4).
- **Plan** (`plans[]`): what was reviewed, named by the SHA-256 of its canonical
  form: the recipe binding (recipe, version, adapter, engine profile and
  runtime manifest digests), one layer, its reference, the bytes that reference
  recorded, the parameters and the target-list digest. The complete ordered
  target list is part of the identity. A plan is recorded only once a run
  executes it; one no run names is refused.
- **Run** (`runs[]`, operation `targetedMs1V1`): one execution of one plan,
  consuming exactly that plan's layer, with a `targetedMs1` block — the plan
  digest, the consumed content, the attempt facts (adapter, manifest and
  interpreter digests, `sourceView`, the engine's self-report, loaded module
  digests), and a failure or stop where it has one. A retry is a new run.
- **Artifact** (`targetedMs1ResultV1`): an outcome summary, the
  `noCandidateRecovery` flag and the payload reference — the manifest digest
  and each file's length and digest. It names no run; its producing run is
  derived from the one run that lists it.
- **Managed payload store**: `<name>.mscanvas.payloads/` beside the document:
  `.owner.json` (the project), `.staging/`, and one immutable `<ArtifactId>/`
  per result (`rows.jsonl`, `evidence.jsonl`, `evidence.index.json`,
  `manifest.json`). Published by a no-replace rename before the document
  references it; a crash between the two leaves an unreferenced result that is
  counted and never deleted.
- **Availability** — `available`, `payloadMissing`, `payloadCorrupt` — is
  observed on open, after Save As and on every read, and never stored.
- **Save** writes the document only. **Save As** checks the document it would
  publish, assembles a pending store with every available result copied and
  verified, renames it into place without replacing, then publishes the
  document; every identifier is kept and source locators are rebased.
- **History** is append-only (M8's rule): a run pins its layer and reference.
  A stored result is read, drawn and exported from the payload alone: the
  runtime, the executor and the source are not consulted, and nothing about
  the current source or runtime rewrites a recorded plan, run or attempt.

### 3.5 Result consumption

| Surface | Current |
| --- | --- |
| Rows | `read_targeted_ms1_rows`: at most 500 a page, the rows file checked whole against its recorded digest |
| Evidence | `read_targeted_ms1_evidence`: one target's lines, each checked against the index |
| Figure | `preview_targeted_ms1_figure` → the shared `FigureSpec` (plot-spec schema 3) → deterministic SVG, shown on screen as that SVG; only stored points, marked and joined to neighbours, the RT window, the feature band and apex, other candidates. No smoothing, no fitted curve, no mass error |
| SVG / PNG | `export_targeted_ms1_figure`, the same drawing at the chosen size, DPI and theme, through the native save dialog, never over an existing file |
| CSV / TSV | `export_targeted_ms1_table`: `mscanvas_targeted_ms1_results` v1, a `#` provenance preamble and 40 columns, one row per plan target in plan order; an absent value is an empty cell, never zero; outcome and reason words are the payload's; TSV refuses a field it cannot carry |
| Clipboard | **none** for a stored result |
| Runtime question | `get_targeted_ms1_runtime`: informational only; no stored-result operation consults it |

### 3.6 Controlled batch

- 2–16 layers; fewer or more is `batchSizeOutOfRange`; a repeated reference is
  `batchDuplicateInput`, never deduplicated; a layer not in the project is
  `unknownRecord`.
- One request resolved once; every member's plan is that plan bound to its own
  layer, reference and recorded bytes (`recipe::bind`): same ordered targets
  under the same target identifiers, same parameters and target-list digest,
  its own plan digest. Two acquisitions holding identical bytes are still two
  plans.
- A batch is held for a run only when every member has a plan, and a batch run
  must name exactly the batch reviewed, in order. Each member runs the plan
  frozen when the batch was accepted, re-checked against the project at its
  turn.
- One exclusive job; one loop; one member's attempt ends before the next is
  looked at. Each member that reaches its attempt is an ordinary run with its
  own result and payload transaction. A failure or a timeout stays that
  member's.
- **Stop batch** cancels the member running and starts no later one; members
  never started get no run. A quarantine, a moved project or a full history
  keeps every later member out.
- No batch entity, identifier or state is persisted; reopening resumes
  nothing; there is no combined export, merged table or comparison.

## 4. Schema 4 — the canonical disposition

**Schema 4 is the current unpublished development schema, and its
compatibility promise begins only if and when this source line is published.**

- The one current meaning is the canonical document
  [`schema_4_canonical.json`](../../apps/desktop/src-tauri/src/project/schema_4_canonical.json),
  read and written back to the same JSON value by
  `project::tests::the_canonical_schema_four_document_reads_and_writes_back_unchanged`.
  It holds every word listed below. Reading it recomputes both plan digests
  and the target-list digest, so a change to a plan's canonical form fails
  there, as does renaming or removing any stored word. A word *added* to a
  vocabulary cannot fail there; adding one is a schema decision (as M9.3's
  two were).
- Top level: `schemaVersion` (4), `projectId`, `revision`, `name`, `inputs`,
  `artifacts`, `runs`, `layers`, `plans`, each required. Record kinds
  `fileFactsV1`, `acquisitionQcSnapshotV1`, `targetedMs1ResultV1`;
  operations `captureFileFactsV1`, `captureAcquisitionQcSnapshotV1`,
  `targetedMs1V1`; `sourceView` `hardLinkInWorkArea` and
  `verifiedSnapshotInWorkArea`; stop reasons `cancelRequested` and
  `timeBudgetExceeded`; stages `source`, `runtime`, `request`, `engine`,
  `result`, `publish`; the 30 failure codes of `record::FailureCode`; member roles `primary` and
  `requiredCompanion`; QC counts and retention times `reported` and
  `notReported`.
- Validation is owned by `record::parse` and `record::validate` alone, applied
  on open and before every write. Every object refuses unknown fields; every
  closed vocabulary refuses an unknown word (`malformed`); every optional
  value is an explicit `null`; a version other than 4 is `unsupportedVersion`
  and nothing migrates.
- **Earlier M9 development builds are not compatible with each other.** M9.3
  added `verifiedSnapshotInWorkArea` and `insufficientWorkAreaSpace` to schema
  4 without advancing it, so an M9.1 or M9.2 build refuses a document that
  carries either. M9.4 and this closure add no word, and the schema's shape
  did not change at closure.
- **One validation defect was repaired at closure** (`d8310ce`): a `locator`
  was the one object that accepted a field beside its `path` and dropped it on
  the next save. It now refuses one (`malformed`) like every other object. No
  build ever wrote such a field, so no document any M8 or M9 build saved is
  affected.

## 5. Identity and lineage

`Project input` → `Layer` → the input's recorded content → `Plan` →
execution attempt → `Run` → `Artifact` → managed payload → row and evidence.

- Durable identities are UUIDs (`ProjectId`, `InputId`, `LayerId`, `RunId`,
  `ArtifactId`, `TargetId`) or digests (`planSha256`, `targetListSha256`,
  content, payload). `DatasetId`, `FileIdentity`, process identifiers,
  operation identifiers, scratch names and every path other than an input's
  own locator are session-only and not representable in the document.
- The plan binds the layer, its reference and the bytes that reference
  recorded; `validate_plan` refuses a plan whose expected content is not its
  reference's baseline, and a completed run whose consumed content is not its
  plan's.
- One run, one plan, one layer, at most one artifact; an artifact claimed by
  two runs is `ambiguousProducer`. A batch merges no identity: each member is
  its own plan, run, artifact and payload.
- Historical inspection opens no source and starts nothing; Save As keeps
  every identifier and rebases only locators.
- Accepted asymmetries, recorded rather than changed: target identifiers are
  shared by every member plan of one batch (unique within a plan, never across
  plans); label uniqueness is a review rule, so a hand-edited plan with two
  equal labels (and recomputed digests) opens, its targets still told apart by
  identifier; a run's attempt facts are what the supervisor measured and the
  worker reported at the time, and a later runtime or source state does not
  touch them; the payload's `manifest.json` names its artifact and plan, and
  the document names the payload only by digest.

## 6. Snapshots and recovery

Unchanged from M9.3.C1 and confirmed in the assembled code:

- **Same session.** A hard link is unlinked only by the attempt that made it,
  in `ExecutionView`'s drop, while the source is still held and after the link
  was shown to be the held object.
- **Across sessions.** A sweep removes only marked attempt directories whose
  owner process is provably gone and that have no entry at the link name; it
  never unlinks a retained `source.mzML`. Unmarked, unreadable, live, unknown
  and uncertain scratch is left as found. No sweep clears
  `analysisQuarantined`.
- **Published results.** Attempt scratch lives only under the work area's
  `attempts` root; the payload store is beside the document; no cleanup path
  reaches it. A historical result reads with its attempt directory gone.
- **Accepted consequence.** Crash-abandoned hard-link scratch may remain
  indefinitely in unpublished development until a future explicit recovery
  UX or policy exists. This is accepted resource leakage, not a correctness
  failure.

## 7. Plots and exports

- The M9.1 page plot is gone; the only drawing is the canonical renderer's.
- The stored payload is the only authority: opening, drawing or exporting a
  stored result never rereads mzML.
- Points and boundaries are the persisted evidence only; nothing is smoothed,
  fitted or interpolated; an absent value is empty, not zero; a window that
  held no spectrum writes `extracted_points` 0 and empty sums and maxima.
- Where each output carries provenance: the drawn figure shows its title — the
  target's label and its outcome in words — and its axes; the SVG's `<desc>`
  also carries the caption (the formula, the recipe named as experimental,
  what the outcome means, and the result and plan identifiers), which is not
  drawn; CSV/TSV carry the `#` preamble; **PNG carries pixels and its DPI
  only** and is not self-describing. No drawn text says *experimental* or *not
  proof of absence* (§13).
- **Spreadsheet formula interpretation is a pre-release decision, not a closure
  repair.** The repository has no policy for spreadsheet-safe text export;
  values are written as stored (ADR 0048 §5), and a label beginning with `=`,
  `+`, `-` or `@` may be interpreted by a spreadsheet as a formula. Neutralizing it would alter
  scientific data, so it was not done silently; the decision belongs to the
  release security review (§13).

## 8. Document growth

Measured with this build's own serializer (evidence §4), with short ASCII
text — 12-character labels, a 9-character formula, no neutral mass: one member
of a 16-acquisition batch over 200 targets adds **about 54.8 kB** to the
document — 48.9 kB of plan (the whole target list, pretty-printed, about 245
bytes a target), 4.7 kB of run (with a real run's engine report and module
digests) and 1.2 kB of result record. A whole 16 × 200 batch then adds **about
0.84 MiB**, not the 0.5–0.65 MB M9.4 estimated, and **four such batches fit**
in the 4 MiB document; in the fifth, the thirteenth member meets the bound.

The plan's share grows with the text the user types. A target costs about
225 bytes plus its label's and formula's UTF-8 bytes (and a neutral mass's
digits), so, by that arithmetic and not measured: 200-character ASCII labels
with 100-character formulas make a 16 × 200 batch about 1.8 MB, two of which
fit; 200-character labels in CJK script (three bytes a character) make one
about 3.1 MB, and one fits.

At the bound: that member's worker has already run; the run is refused
`oversized` after it, its staged result is discarded and nothing is recorded;
no later member starts (`notStarted`, same reason); the history already
recorded stays whole and saves. The interface says *This project is larger than
MSCanvas saves.* The only remedy today is a new project: history is
append-only. Sharing one target list between plans (deduplication or reference
normalization) is a future storage-model optimization (§13); closure did not
add a shared target-list entity.

## 9. What is persisted, and what is not

Checked in code and by a scan of a real run's saved documents and stores
(evidence §5):

- **Never persisted:** attempt and scratch paths, Python temporary paths,
  process identifiers, operation identifiers, stdout or stderr, environment
  values, `FileIdentity` or volume identity, `DatasetId` or remembered
  Workbench rows.
- **Persisted by design:** input labels and locators — a locator outside the
  project's directory is an absolute local path, as M8 established, so a
  project is **not** anonymous; target labels and formulas (user text); digests;
  the engine's self-report; module names relative to the runtime directory;
  timestamps and the application version.
- **In exports:** SVG — the target label, formula, outcome and the result and
  plan identifiers; CSV/TSV — the preamble's identifiers, digests, engine
  versions and parameters and every target's label and formula. No path, file
  name, log, process or scratch detail. Suggested file names carry a short
  result identifier and a target position, never a label.

## 10. Dependencies and licences

- **No production dependency was added, removed or updated during M9**: the
  manifests and lock files are identical to the M9 start `97392e9`. Over
  published `main`, the only manifest change is M8.1's direct `uuid` edge on
  the desktop crate, already in the locked graph through `mscanvas-core`.
- The Python, pyOpenMS and OpenMS runtime is **development-only**: not
  bundled, not installed, not part of any release build, and not claimed
  redistributable. M9's local completion establishes no redistribution
  qualification; the bundled third-party licences M9.0 found in the wheel (Qt,
  the MSVC runtime, contrib libraries) remain release work.
- No licence material was downloaded and no upstream was contacted.
  ProteoWizard's HOLD is unrelated and unchanged; Route B (TOPP) was not
  authorized or executed.

## 11. What "complete" means here

| Layer | M9 state |
| --- | --- |
| 1. Implemented locally | **Yes** — this closure |
| 2. Source-integrated / published | No, at this closure: the whole stack is local and unpublished (§14). Its later preparation as one source-integration candidate is recorded in the [M8/M9 source-integration record](../development/M8_M9_SOURCE_INTEGRATION.md) |
| 3. Installed-product qualified | No: the runtime is not packaged; M7.6-style qualification has not run on any M8/M9 build |
| 4. Public-beta released | No |

## 12. What M9 did not deliver, and where it now belongs

The M9 milestone text named more than one recipe. Closure moves each
undelivered item out of M9 rather than leaving it implied:

| Item | Where it belongs now |
| --- | --- |
| A second recipe (for example the ANA-002 QC recipe) | a separate owner decision after the UI and release work; not an M9 obligation |
| VIEW-008 multi-layer comparison, overlay and figure identity | a future comparison milestone, gated on an admitted normalization; M9's batch deliberately compares nothing |
| Normalization, alignment, cross-acquisition quantitative comparison, merged tables, heatmaps, PCA, batch correction | the same future decision; none is designed or validated |
| A reusable XIC export | still behind the M5/PX refusal and ADR 0046's routes; a targeted-MS1 evidence trace is not an admitted XIC |
| Other adducts, charges, negative mode, profile input | their own measured domains |
| Runtime packaging | M7.6-style release work on the new product (§15) |
| CLI, skills, MCP | M10, not started |

## 13. Remaining limits

| Limit | Consequence now | Correctness or safety affected? | Prerequisite / owner | Earliest stage |
| --- | --- | --- | --- | --- |
| Runtime exists only in a development checkout | a release build cannot run the recipe (`recipeUnavailable`); stored results still read | no | owner packaging decision; packaging gate in `ANALYSIS_WORKERS.md` | release qualification on the new candidate |
| Redistribution and licence qualification of the runtime incomplete | the runtime cannot ship | no (legal) | licence review of the wheel's bundled components | same |
| No installer or update path for the runtime | — | no | packaging decision | same |
| The runtime and the work area must be on an ASCII path (the engine fails on a non-ASCII runtime path; the worker is only given ASCII names) | a checkout under a non-ASCII path has no runtime; a user's non-ASCII source path is fine | no | the install location chosen by the packaging decision | same |
| FAT/exFAT work areas, network shares, removable media, volumes without file identity unqualified | behaviour there is unmeasured | unknown there; refused or detected where measured | measurement | installed qualification |
| Changes that bypass share modes (mapped writers, raw volume access, kernel components), and a change made and reverted while the worker reads | detected by digest where the digest differs; a change-and-revert during the read is not detected | outside the threat model (not a boundary against a hostile local administrator) | — | accepted |
| Filesystem and network confinement of the worker not enforced | the fixed adapter makes no network call; nothing prevents one | no by code review; not enforced | an enforced sandbox, if required | release security review |
| Retained hard-link scratch has no user cleanup | a retained link keeps a file's clusters allocated if the user deletes their own name | no (resource leakage) | an explicit recovery UX or tool | UI/UX cleanup or later |
| M9.1-era unmarked attempt directories are never swept | they stay | no | a person, or a future tool | same |
| Payload `.staging/` and Save As pending stores left by a crash are not collected; a Save As whose document publish fails leaves its whole store published beside a destination with no document, and a retry to that name is refused `destinationStoreExists` | disk space beside the document; the user chooses another name or removes the folder | no (reported, never undone silently) | payload GC and store-recovery design | later |
| Unreferenced results (published, never saved) are counted and not shown | invisible disk use | no | UI decision | UI/UX cleanup |
| No clipboard copy of a stored result | use SVG/PNG export | no | a native harness with a stored-result project | UI/UX cleanup or release |
| Native save dialogs for stored-result exports not natively qualified | write path tested in Rust; dialog mocked in the browser | no known defect | native harness run | installed qualification |
| PNG is not self-describing | provenance travels with SVG/CSV only | no | a decision on PNG metadata | release |
| No drawn figure text says *experimental* or *not proof of absence*; the title is the label and the outcome word | an exported figure shown alone can read more certain than the result is | no (the qualifiers are in the SVG `<desc>`, the report and the table's help) | a figure-caption design decision | UI/UX cleanup or release |
| Spreadsheet formula interpretation of exported text | a spreadsheet may evaluate a label such as `=…` | **security/interoperability decision open** | release security review: keep raw, add a separate spreadsheet-safe export, or document | before public release |
| History is append-only | nothing can be pruned; a full project stays full | no | history pruning design | later |
| Every plan stores its whole target list | ≈ 0.84 MiB per 16 × 200 batch with short labels (four fit), up to ≈ 3.1 MB with 200-character CJK labels (one fits) | no | shared target-list storage | future storage-model revision |
| The 4 MiB bound is met after the member's worker ran | up to 10 minutes of work discarded; the sentence says the project is too large, not what to do | no (nothing corrupted) | a size check before the attempt; clearer wording | UI/UX cleanup |
| Batch state is session-only | after restart, which members a batch never started is unknown; the history shows only runs | no | only if users need batch history | later |
| A failed member's reason appears only once the batch ends | mid-batch it reads *Failed* | no | UI | UI/UX cleanup |
| Source availability is known only after **Check links** | a reopened result reads *Not checked* | no | UI | UI/UX cleanup |
| Near-edge apex can be `NOT_DETECTED`; engine scores not surfaced | the report says `NOT_DETECTED` is not absence | scientific limit, stated | engine change or measured workaround | a later recipe version |
| The repository-wide browser suite is red | 20 spec files (174 tests) fail — M4–M7 and viewer-r1 specs; every one fails identically, test for test, on published `main` (evidence §8); the 7 M8/M9 specs pass | no M8/M9 regression; the suite cannot gate UI work until repaired | repair or retire the legacy specs against the M7.2+ shell and roster | decide before source integration (publish as named debt?) and repair before release |
| One App-level Vitest case (`M73Viewer.test.tsx`, the committed-range export) can exceed its 5 s limit under load | `pnpm test` can fail on it while the file passes alone; seen in M8.4 and M8.5, and in two of this closure's four whole-suite runs, including the final one | no | a test-infrastructure repair (a longer limit or a lighter case) | with the legacy browser work |
| The browser harness can fail to open a WebDriver session for a spec (`Failed to fetch [POST] …/session`; 3 of 28 spec files in one run) | those specs report no test result in that run | no | test-infrastructure repair | same |

## 14. Source-integration handoff

**Not performed.** Nothing was pushed, merged, rebased, squashed or
cherry-picked. The integration candidate prepared after this closure, its
answers to the questions below and the proposed publication procedure are in
the [M8/M9 source-integration record](../development/M8_M9_SOURCE_INTEGRATION.md).

### Commit graph

`main` = `origin/main` = `1daf802f06d0149b5de3dbd12e8b01e7e86862ec`. The
closure head is a strictly linear descendant: no merge commit, 0 commits
behind `main`, and every commit below is ahead of it.

| Range (oldest first) | Commits | Content |
| --- | ---: | --- |
| `8b9f3b4` … `fe3d202` | 13 | **Partial M7.6**: an NSIS per-user candidate build (`apps/desktop/src-tauri/tauri.conf.json` bundle settings), shipped-notice generation (`THIRD_PARTY_NOTICES.md`, `scripts/generate_notices.py`), candidate build/inspection scripts (`scripts/build_candidate.ps1`, `scripts/inspect_candidate.ps1`, `scripts/verify_installed_payload.py`), `CHANGELOG.md`, and its record `docs/ux/M7_6_INSTALLER_RELEASE_INTEGRATION.md`. No application source. Installed qualification not started |
| `aa3fc83` | 1 | M8.0 planning (`docs/ux/M8_0_V511_GAP_ASSESSMENT.md`, the M8.1 record's start). The local `feat/m7.6-installer-release-integration` branch points **here**, not at M7.6's last commit `fe3d202` |
| `153339f` … `97392e9` | 34 | **M8** foundation: M8.1–M8.5 (project document, lineage, reattachment, layers, QC snapshot) and the M8 closure |
| `d4165b9` … `1652aff` | 15 | M9.0 route study: experiment code and records under `experiments/m9_0/`, its records and `ROADMAP.md`; no product code |
| `a34e2b1` … `96f2d8c` | 8 | M9.1 |
| `a1c56f5` … `d1d9f58` | 7 | M9.2 (with plot-spec schema 3 in `crates/plot-spec`) |
| `9c09395` … `3d6300f` | 12 | M9.3 and M9.3.C1 |
| `6983840` … `13a3560` | 11 | M9.4 |
| `59cbf1c` … closure head | this closure | tests, the locator repair (`d8310ce`), the full canonical fixture (`68f8c4d`), a browser-test timing repair (`fa7f213`) and documentation |

Local branch heads, all ancestors of the closure and unmoved:
`feat/m7.6-installer-release-integration` `aa3fc83`,
`feat/m8.1…` `f751b9e`, `feat/m8.2…` `399a3ef`, `feat/m8.3…` `47e20b7`,
`feat/m8.4…` `d60d301`, `feat/m8.5…` `3e6b656`, `feat/m8-closure` `97392e9`,
`feat/m9.0…` `1652aff`, `feat/m9.1…` `96f2d8c`, `feat/m9.2…` `d1d9f58`,
`feat/m9.3…` `3d6300f`, `feat/m9.4…` `13a3560`.

### Constraints

The project's history rules stand: no rebase, no squash, no cherry-pick, no
force push, no direct commit to `main`, and publication through a reviewed pull
request. Integrating any M8 or M9 commit therefore publishes the partial M7.6
commits beneath it too. What that publishes is build configuration, scripts,
notices and a record that says installed qualification has not started — no
release and no binary — but the decision to publish them is the owner's, and
their record must then say plainly that it describes an unqualified candidate.

### Facts for the next decision

- **Integrate the current local stack** (M7.6 partial → M8 → M9 → closure)
  before the concentrated UI work: one reviewed publication of 101 + closure
  commits; the UI and release work then starts from published source. Needs
  README's current-state sections refreshed (they still describe the published
  M7.5 product) and the legacy browser debt acknowledged as named, not hidden.
- **Or another explicitly justified boundary**, chosen by the owner. Any
  boundary that includes an M8 or M9 commit publishes every commit beneath it,
  including the 13 partial-M7.6 commits and `aa3fc83`; no boundary may be made
  by rewriting history.
- Either way the partial M7.6 state is published as partial, and M7.6-style
  qualification later runs against the new product, not the M7.6 candidate.

## 15. After M9

No later milestone is started or promised here. The sequence the repository's
plans are consistent with:

M9 closure → an explicit source-integration decision → concentrated
real-workflow UI/UX cleanup → freeze a new product candidate → resume
M7.6-style installed, native, provider and release qualification against that
candidate (the M8/M9 product, not the M7.6 candidate) → decide between a
public beta and M10 → M10: a stable headless CLI, then skills, then a narrow
local MCP when appropriate.

M10 is not blocked by this closure alone: the integration decision, the
runtime packaging decision and the UI and release work are separate owner
decisions.

## 16. Status

- `M9 LOCAL IMPLEMENTATION COMPLETE — TARGETED-MS1 ANALYSIS PHASE CLOSED LOCALLY`
- `SOURCE UNPUBLISHED`
- `M8 LOCAL IMPLEMENTATION COMPLETE`
- `M9 LOCAL IMPLEMENTATION COMPLETE`
- `M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE`
- `PROTEOWIZARD HOLD UNCHANGED`
- `ROUTE B NOT AUTHORIZED / NOT EXECUTED`
- `PUBLIC BETA NOT RELEASED; M10 NOT STARTED`
