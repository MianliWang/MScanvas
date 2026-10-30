# ADR 0067 — Study model for cross-sample analysis

Status: **Proposed** on 2026-10-30. The owner directed that day that analysis is
no longer deferred and is to be planned and built, and asked that open details
follow the recommendations; this record states them. Nothing here is
implemented, and nothing here reaches the interface. The governance amendment
that un-defers analysis (AGENTS.md, "Analysis is deferred but architecturally
allowed") is a separate owner decision, and this record takes effect only with
it. The questions for the owner are listed
[at the end](#open-questions-for-the-owner).
Related: [0006](0006-multi-dataset-workspace-boundary.md) (the session-only
workspace), [0016](0016-explicit-converted-output-adoption.md) (explicit
adoption), [0047](0047-first-windows-beta-scope-and-implementation-route.md)
(beta scope; the targeted-MS1 runtime is not shipped),
[0048](0048-stored-targeted-result-reuse-and-export.md) (a stored result is read
without running anything; absent is an empty cell),
[0049](0049-content-bound-execution-snapshot.md) (content binding),
[0050](0050-sequential-batch-of-independent-targeted-plans.md) (the sequential
batch this record supersedes in part),
[0054](0054-spreadsheet-csv-for-the-targeted-results-table.md) (spreadsheet
CSV), [0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)
(the schema-5 bump and its schema-4 disposition),
[0056](0056-project-owned-mzml-reader-for-viewing.md) (the reader),
[0059](0059-vendor-format-strategy-official-readers-thermo-first.md) (verified
vendor centroiding), [0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md)
(an MSCanvas-owned cache). Records: the [M9 closure](../../product/M9_CLOSURE.md),
PRJ-001…PRJ-006 in the [feature catalog](../../product/FEATURE_CATALOG.md), the
[artifact model](../ARTIFACT_MODEL.md), the
[analysis capability map](../../product/ANALYSIS_CAPABILITY_MAP.md) and the
[M9.0 evidence](../../spikes/M9_0_TARGETED_MS1_ROUTE_EVIDENCE.md). Schema 5 is
on `be/integrate` ([draft PR #161](https://github.com/MianliWang/MScanvas/pull/161)).
Sibling records with pre-assigned numbers, not yet on `main`: ADR 0065
(persistent conversion history), ADR 0066 (analysis runtime release) and ADR
0068 (the 2D RT × m/z map). Research: the analysis-plan synthesis and its
internal lane of 2026-10-30, which are not committed; figures marked
**[arith]** are arithmetic from recorded measurements, not measurements.

## Context

**One analysis exists, and it compares nothing.** ANA-004 runs a targeted MS1
plan over one acquisition. ADR 0050 lets 2–16 acquisitions run one after
another under one request, and decision 1 says "No algorithm invocation is
given more than one acquisition". Its context gives the reason: the engine's
intensities are not comparable across runs, and pooling, normalization or
comparison was neither designed nor validated. The M9 closure (§12) moved
alignment, merged tables, PCA and normalization to "the same future decision".
The owner's direction of 2026-10-30 is that decision.

**Every cross-sample family breaks that rule.** Alignment, linking
(grouping), gap filling and statistics take many samples by definition. They
also need facts no record holds today: which acquisitions are QCs, blanks or
standards, which group and batch each belongs to, and the order of injection.
The only durable per-acquisition identity is the layer (PRJ-005).

**The document cannot hold one run per acquisition per step.** The project
document is at most 4 MiB, parsed whole, and history is append-only (M9
closure §3.4, §13). The M9 closure (§8) measured 4.7 kB of run and 1.2 kB of
result record per acquisition, plus the plan. A 300-sample step recorded the
ADR 0050 way therefore costs about 2 MB, so a document holds about two such
passes in its whole lifetime, and 2,048 runs or artifacts are about six
**[arith]**. The same closure shows the second trap: every plan stores its
whole target list, so a 16 × 200 batch costs about 0.84 MiB. A study plan that
inlined its sample list would repeat that.

**A study's results do not fit the payload store as it is.** A payload file is
at most 64 MiB and is checked whole against its digest on every read. A matrix
of 10^5 features × 500 samples is 5 × 10^7 cells: 400 MB as binary64 **[arith]**.

**The values are not all of one kind.** M9.0 found that the engine imputes a
failed fit from a regression over the other features, discards every feature
when no fit in the run is valid (`ENGINE_DISCARDED_NO_VALID_FIT`), and gives
the same peak a different intensity in a different request. Gap filling makes
a further kind: a value found again in the raw data where detection found
none. The repository's rule is that absent is empty, never zero (ADR 0048; M9
closure §7), and a failure is never an absence (M9 closure §3.2).

## Decisions

### 1. A study is a project record

A project holds zero or more **studies**. A study has a durable `StudyId`
(UUID), a label, and:

- **samples**, in a stated order. Each sample has a durable `SampleId` and is
  backed by exactly one of:
  - a project **layer** (`LayerId`, PRJ-005), and through it one reference
    and the bytes that reference recorded. A Workbench row joins a study only
    by first becoming a project reference through the existing explicit
    action (PRJ-001, PRJ-002), which hashes it. Workspace rows, paths and
    `DatasetId` are session-only (ADR 0006) and never name a sample;
  - an **imported column**: a sample column of an imported feature table
    (Track A) that has no acquisition in the project. Such a sample can enter
    statistics and nothing that reads an acquisition.

  A layer backs at most one sample of a study (`studyDuplicateSource`
  otherwise); it may back samples in several studies;
- a **role** for each sample, from a closed vocabulary: `sample`, `qc`
  (pooled quality control), `blank`, `standard`;
- **groups** and **batches**: lists of `{id, label}`, each sample naming at most
  one of each. Ids make a rename one edit and keep a statistic's group
  identity stable;
- an **injection order** for each sample: a positive integer, unique within
  its batch, or `null` where unknown. A computation that needs the order
  refuses a study in which any included sample lacks it; it does not guess.

The study is **current state**, edited in place like layers, not history. What
a run used is pinned by the revision it was given (decision 2), so editing a
study never rewrites a result and does not grow the history.

Bounds, as product guards for the first build, not scientific limits: at most
1,024 samples per study (the roster's capacity, ADR 0057) and at most 64
studies per project. A study record costs about 250–300 bytes per sample
pretty-printed, about 90 kB for 300 samples **[arith]**.

Removing a sample from a study deletes no input, no source file and no
artifact. An input that a study names cannot be removed from the project
until its samples are removed (`inputInStudy`), so no sample dangles.

**Per study, not per layer.** Role, group, batch and order are kept on the
study's samples, keyed by `LayerId` within the study, not on the layer itself.
The same acquisition can be a sample in one design and left out of another, an
imported column has no layer, and a statistic must name the design it used.
The after-beta-1 plan's "sample metadata on layers" item is this record: a
project whose interface shows one study holds exactly that.

### 2. A study revision names the sample set once

The canonical form of what a step is given about the study is its **revision**:
for each included sample, its `SampleId`, its source (the layer, its reference
and the length and SHA-256 of each member that reference recorded, or the
imported column), its role, its group and batch labels, and its injection
order. The revision is named by the SHA-256 of that form
(`studyRevisionSha256`).

The revision file (`study.json`) is stored in the payload of every artifact a
study step produces (decision 4). Plans and runs name it only by digest. No
plan inlines the sample list, so a study plan's size does not depend on the
number of samples.

Earlier revisions therefore live in the artifacts that used them, not in the
document. A statistics result names its revision, so the metadata it used can
always be read back, and editing the study adds nothing to the history.

### 3. Per-sample and cross-sample steps

When this record is accepted, it **supersedes ADR 0050 for study recipes
only**: decision 1's single-acquisition rule and the 2–16 bound do not apply to
them. ADR 0050 stays in force, unchanged, for targeted MS1.

A study recipe is a chain of **steps**, each its own reviewed plan and run:

- A **per-sample step** gives one worker invocation exactly one acquisition,
  bound to its content as ADR 0049 binds a targeted run: a held handle, a hard
  link or a verified copy, re-hashed by the adapter. Feature detection and gap
  filling are per-sample steps. Gap filling's request also carries what the
  cross-sample result says about that sample.
- A **cross-sample step** is given the derived outputs of the included samples
  (for example, their feature maps), never the acquisitions. Alignment and
  linking run in the worker; statistics run in Rust with no worker.
- A step that must read several acquisitions in one invocation (the pyOpenMS
  GNPS MGF writer reads every mzML at once) is admitted only by its own recipe
  record, with a capacity check that sums its copies. The recommended GNPS
  route, a project-owned CSV and MGF writer, needs no such step.

**Review.** A step's review lists every sample of the study. A sample the step
cannot take is listed with its reason: no completed upstream output, the other
polarity, a changed source, a role the step does not use. The plan includes
only the samples the user keeps. It records the excluded ones with their
reasons, and nothing is dropped unnamed. A cross-sample step needs at least two
included samples. What statistics need beyond that is the statistics record's
decision.

**Kept from ADR 0050:**

- Rust owns the queue, and the interface never loops over runs;
- one study run is one exclusive project job (ADR 0050, decision 3): New,
  Open, Close, Save As, and removing or re-pointing what the run names are
  refused for its whole length, and Save is not;
- each sample's failure is its own, as ADR 0050's decision 4 table sets out
  per member;
- one Stop, with the semantics of ADR 0050, decision 5;
- nothing completed is rolled back because a later sample failed.

**Concurrency stays one worker at a time** until a per-recipe measurement of
time and peak memory on a real file sets a safe count. The ledger (decision 4)
is in sample order, not completion order, so a later parallel scheduler changes
no record.

### 4. One study run per step, and what the document holds

- **Plan** (a new plan kind): the recipe binding (recipe, version, adapter,
  engine profile and runtime manifest digests, and the `experimental` flag of
  decision 10), the parameters, the `StudyId`, the `studyRevisionSha256`, the
  upstream artifacts the step consumes, and the counts of included and excluded
  samples. It is named by the SHA-256 of its canonical form and recorded only
  once a run executes it, as today.
- **Run**: one per study step. It holds the plan digest, the attempt facts the
  invocations share (runtime manifest, interpreter and adapter digests, loaded
  modules), counts of sample outcomes, the run's own failure or stop where it
  has one, and the ledger's digest.
- **Artifact**: one for every study run that started at least one invocation.
  Its payload always holds `study.json` and the **ledger** (`samples.jsonl`): one
  line per included sample, in sample order, with the consumed content, the
  execution view (`hardLinkInWorkArea` or `verifiedSnapshotInWorkArea`), the
  outcome (`completed`, `failed`, `cancelled`, `notStarted`), a failure code
  and stage or stop facts where there is one, the source of a reused output
  (decision 5), and each output file's length and digest. It holds an output
  for each sample that completed (per-sample steps), or the step's result
  (cross-sample steps, only when the invocation completed). Its record says
  `complete`, `partial` or `noResult`.
- **Refused before the first invocation**: nothing is recorded, as for a
  single run.

**Document cost.** About 8 kB per study step whatever the number of samples
(the M9 closure's 4.7 kB run and 1.2 kB result record, and a plan with no list
in it) **[arith]**. A four-step pass (detection, alignment and linking, gap
filling, statistics) costs about 32 kB. About a hundred passes fit beside a
300-sample study record. The ledger costs about 1–2 kB per sample per step,
and it lives in the payload **[arith]**.

**The bound is checked before any worker runs.** A study run's records have a
size fixed at acceptance: counts are bounded integers, and every list in them
is bounded by the plan. Rust computes that size when it accepts the run and
refuses `oversized` before the first invocation. This closes, for study runs,
the M9 closure's limit that "the 4 MiB bound is met after the member's worker
ran".

### 5. Stop, failure, restart and reuse

- **Stop.** The sample running meets the stop as an ADR 0050 member does
  (decision 5). Later samples are `notStarted`. The completed samples' outputs
  are published in a `partial` artifact. No completed work is discarded.
- **Quarantine** (`workerNotAccountedFor`). No later sample starts, as in ADR
  0050. What completed is published the same way.
- **A crash** before the publication leaves only `.staging/`. That is not
  collected (M9 closure §13), and nothing is recorded or reused from it.
  Checkpointed publication within a run is not decided here (open question 7).
- **Reuse.** A later run of a per-sample step can reuse a completed output whose
  **key** is equal. The key is the SHA-256 of the canonical per-sample request
  (recipe binding, parameters, and every upstream input the invocation is
  given) together with the consumed content's digest. An output with an equal
  key comes from the same invocation on the same bytes. It is verified against
  its digest and copied into the new artifact, so every artifact's directory
  stays complete on its own for Save As. The ledger names the artifact it came
  from. Reuse is not re-execution and claims nothing about what the engine
  would produce again. The review says how many samples reuse an output;
  reuse is the default, and running every sample afresh is one choice at
  review. This is how a stopped 300-sample run, or a study that gained ten
  samples, avoids repeating hours of work.

### 6. Large results: a chunked matrix read in windows

A study matrix (features × samples) is stored in a project-owned format,
`mscanvas.studyMatrix/1`. It adds no dependency: no Arrow and no Parquet.

- `matrix.json`, within the 64 KiB small-record bound: the format, the row and
  column counts, the column order as `SampleId`s, the row-block size, the value
  type (`f64le`), the attribute columns, and every chunk file with its length
  and SHA-256.
- `values-NNNNN.bin`: a row block of R rows × all columns, binary64 little
  endian, row-major. `cells-NNNNN.bin`: one state byte per cell (decision 7),
  in the same layout. `attr-<name>.bin`: one column file per feature attribute
  (feature identifier, m/z, retention time and its range, and the like), each
  with its own digest.
- R is chosen so that a values chunk is at most 8 MiB. Verifying one costs
  little, so **every read verifies every chunk it touches**, as M9 verifies the
  whole rows file. Whole-file verification of 400 MB on every page would not
  scale. No file exceeds 64 MiB, and the cap does not change.
- Bounds, as product guards: at most 1,000,000 rows, 1,024 columns and 2^27
  cells (1 GiB of values) per matrix. A 10^5 × 500 matrix is 400 MB of values
  and 50 MB of states, in 48 row blocks of 2,097 rows **[arith]**.

**Rust reads windows.** A window is a range of rows in the current view order
× a set of columns. It is bounded by **cells**, not rows: 500 rows × 300
columns is already 150,000 cells. The starting bound is 50,000 cells, and the
slice sets the final one with a rendered measurement.

**Sort and filter run in Rust.** Sorting on an attribute column reads only that
column. Sorting on a sample column reads every chunk once. The result is a row
permutation that Rust holds for the session (4 bytes a row, 400 kB at 10^5
rows). It is never persisted and never sent to React whole. React holds only
the visible window and the view's description (sort key and filter). For study
tables, this selects "on-screen result sorting and filtering", which the
after-beta-1 plan (7.6) lists as reversible and not selected.

Figures over a matrix (volcano, loadings, heatmap) are drawn by Rust through
the shared `FigureSpec`, with Rust-side decimation and hit-testing. Each plot
kind is its own record, and the 2D map is ADR 0068's.

**Per-sample outputs** (a sample's feature map) are ordinary payload files of
at most 64 MiB. A feature map of 10^5 features × about ten fields is about 8 MB
in binary **[arith]**. A larger output fails its sample with a typed reason;
it is not split.

**Imported tables** (Track A) are written into the same format when they are
imported, with their own import record and digest.

### 7. Each cell says what it is, and absent is never zero

The cell state is a closed vocabulary, one byte a cell:

| State | Meaning | Value |
| --- | --- | --- |
| `measured` | detected in that sample by the per-sample step | yes |
| `reintegrated` | found again in that sample's raw data by gap filling; a different quantity from a detection | yes |
| `engineImputed` | returned by the engine without being measured (M9.0: a failed fit imputed by regression) | yes, never used by a test |
| `engineDiscarded` | the engine looked and dropped it (`ENGINE_DISCARDED_NO_VALID_FIT`) | none |
| `missing` | not found in that sample, which is not proof of absence | none |
| `imported` | taken from an imported table whose producer did not say how it was obtained | yes |

- A cell with no value holds a NaN in its value slot. No reader interprets it:
  readers decide by the state, never by the value. No cell is ever written as 0
  to mean absence. Exports write an empty cell where there is no value (ADR
  0048) and carry the states beside the values.
- **An imported zero is declared, never assumed.** MZmine-2-style tables
  commonly write 0 where a feature was not detected. The import review asks
  how the table writes "not detected" (`zeroMeansNotDetected` or
  `zeroIsAValue`) and records the answer in the import record. An empty cell is
  always `missing`.
- **A failed sample is not a column of missing cells.** A sample whose
  per-sample step failed is left out of the matrix, with its reason in the
  ledger.
- Which states a statistic uses is the statistics record's decision, recorded
  with each result. `engineImputed` never enters a test.
- A value-changing step (normalization, or any later imputation or correction)
  never overwrites. Its output is a new matrix artifact whose cells keep their
  source state. If imputation is admitted, its state word is added then, as a
  schema decision.

### 8. Derived files are new artifacts, never overwrites

Every intermediate a step makes is a new artifact, or a member of the step's
artifact, published by a no-replace rename. Nothing is written to a source, to
an input's file or to an earlier artifact.

**Acquisition-scale derived files** (a centroided or RT-transformed mzML, 1–2 GiB)
are not produced in the first build:

- **Centroiding** comes from the conversion route. Thermo's verified vendor
  centroiding rows (ADR 0059) write into a destination the user chooses, and
  the output is adopted explicitly (ADR 0016). It becomes a new input and a new
  layer, and the profile source stays untouched. A pyOpenMS peak-picking step
  would be its own later record.
- **Gap filling** maps each missing feature's retention time into the sample's
  own retention-time space through the inverse of that sample's transformation
  (the alignment model is linear, so it is invertible). It then requantifies
  the original, content-bound file, so no aligned mzML is written. This is
  unmeasured. The gap-filling recipe's record must show on a fixture that it
  matches requantification of an aligned file. If it does not, an aligned-file
  route needs its own record, and its file is a new artifact.

If a later record needs such a file, where it lives is not decided here (open
question 8). In the project's payload store, lineage is durable, but Save As
copies gigabytes. In an MSCanvas-owned cache like ADR 0060's, eviction is
possible, so the artifact would record the file's digest and a re-derivation
would be verified against it.

### 9. Polarity and negative mode

- Every feature table and matrix has **one polarity**. A step refuses, at
  review, a sample of the other polarity or of mixed polarity. Nothing is split
  or filtered silently.
- Each sample's polarity is what its source declares. It is checked at each
  per-sample invocation, as ANA-004's adapter checks it today
  (`SOURCE_POLARITY_UNSUPPORTED`), and recorded in the ledger. The review shows
  it once the reader reports polarity (the reader-metadata amendment to ADR
  0056, decision 1, on `be/reader-meta`). Until then the review does not
  assume a polarity.
- The words `positive` and `negative` are both in the schema from the start,
  so a negative-mode recipe needs no schema change. Whether a recipe admits
  negative mode is the recipe's own domain. The recommendation is positive
  first and negative as the next slice, because adduct sets are
  polarity-specific.

### 10. The experimental label

- Every study recipe is **experimental** until it passes the capability map's
  promotion gate. The plan's recipe binding carries `experimental: true`, so
  the label is part of the plan digest and of every result produced. A
  promoted recipe is a new recipe version, and results made before it stay
  experimental.
- Every export preamble, figure description and report names the label
  ("experimental; not a validated quantitative assay"). Gap-filled cells also
  carry their own state. Whether the drawn figure says so is the M9 closure's
  open caption decision (§13), and this record does not settle it.
- A statistics output names its method, its correction, and the cell states
  and revision it used.

### 11. Sample metadata in and out: one CSV with declared columns

Format `mscanvas_study_samples`, version 1:

- UTF-8, with or without a byte-order mark; comma-separated, with RFC 4180
  quoting. Leading lines that start with `#` are skipped on import. On export
  they carry the provenance preamble of ADR 0048 (format and version, project
  and study identifiers; no locator).
- **Columns**, a closed set of English names: `sample_id` (optional; MSCanvas's
  id), `file` (the primary member's file name), `role` (required; `sample`,
  `qc`, `blank` or `standard`, matched without regard to ASCII case and stored
  in that spelling), `group`, `batch`, `injection_order` (a positive integer or
  empty) and `label`. An unknown or repeated column refuses the import and is
  named. Nothing in a file is dropped unreported.
- **Matching.** A row matches by `sample_id` when that column has a value,
  which must name a sample of this study. Otherwise its `file` must equal
  exactly one project reference's primary file name. A row that matches none
  is refused with its line, and so is a row that matches more than one: two
  folders can each hold a `QC_01.mzML`, and `sample_id` tells them apart. A
  file not yet in the project is listed, not added: adding a reference hashes
  the file and remains its own explicit action.
- **Review before anything changes.** The import shows every change (new
  samples, changed roles, groups, batches and orders, new group and batch
  labels) and every refusal by line. Nothing applies until the user confirms,
  and nothing applies if any line is refused. Metadata is never overwritten
  silently.
- **Export** writes the same columns for every sample, through the existing
  no-overwrite writer and save dialog. It is plain CSV by default, with ADR
  0054's spreadsheet CSV as the option. It carries file names, never paths.
  Exporting and importing a study with no edits leaves it unchanged.

### 12. Schema: one bump, shared with schema 5

The new document content:

- a top-level `studies` array, required and possibly empty;
- the identifiers `StudyId`, `SampleId`, `GroupId` and `BatchId`;
- the study plan kind, one run operation and one artifact kind per study
  recipe step;
- the closed vocabularies: roles, polarity, cell states and sample outcomes.

Payload formats (`mscanvas.studyMatrix/1`, the ledger) carry their own versions
and do not bump the document schema.

- **One bump.** These join **schema 5** if they merge before any release writes
  schema 5. Schema 5 is on `be/integrate` (draft PR #161) and adds the "not
  verified by MSCanvas" label to an input. If a release ships schema 5 first,
  they take **schema 6**, under the read-and-upgrade disposition the owner
  accepted for schema 4 on 2026-10-30 (ADR 0055): the build reads the earlier
  schema exactly, holds it in memory as the new one, writes nothing on open,
  and writes the new schema on the first Save after a change. Users never meet
  two one-way upgrades in one release.
- **Schema 4 stays frozen.** On the schema-4 read path, a `studies` field is
  `malformed`, as #161's `schema_four_shares_only_beta_one_words_and_fields`
  requires of every added field. A schema-4 document is held with
  `studies: []`.
- **Size.** An upgraded document gains `"studies": []`, about 20 bytes. ADR
  0055's known limitation for a beta-1 document near the 4 MiB bound grows by
  those bytes.
- **Development files.** A schema-5 document written by a development build
  between #161's merge and the study slice has no `studies`. It is refused as
  `malformed`, because an omitted field is malformed. Only test projects are
  affected.

### 13. What this record does not do

- It does not un-defer analysis. The governance amendment is the owner's.
- It adds no interface and no recipe. Every pyOpenMS step (detection,
  alignment, linking, gap filling) also waits for ADR 0066, the runtime
  release: release builds answer `recipeUnavailable` until then. Track A
  (imported tables, sample metadata and Rust statistics) can use this model
  without the runtime.
- It chooses no algorithm, statistic definition, normalization or plot kind;
  each has its own record.
- It adds no history pruning. Study-level runs keep growth bounded without it
  (decision 4).

## Alternatives

**How a study's history fits the document.**

| Option | For | Against |
| --- | --- | --- |
| **(a) Study-level runs, a revision named by digest, per-sample facts in the payload (recommended)** | Document cost fixed per step (about 8 kB) whatever the sample count; the bound can be checked before any worker runs; ADR 0050's per-member isolation is kept in the ledger | Per-sample facts are readable only while the payload is available; one new run, plan and artifact shape |
| (b) One ordinary run per sample per step, as ADR 0050, plus history pruning | No new record shape | About two 300-sample passes per document before pruning **[arith]**; 2,048 runs reached in about six; pruning an append-only history is its own design and loses what users may still read |
| (c) A larger or sharded document | Keeps today's shapes | Parsed and validated whole on every open and write; a shard format is a larger change than (a), and moves the limit rather than removing it |

**Where sample metadata lives.**

| Option | For | Against |
| --- | --- | --- |
| **Per study, keyed by `LayerId` within it (recommended)** | One acquisition in several designs; imported columns without a layer; a statistic names its design | A layer in two studies carries two copies, which may differ |
| Per layer, for the whole project | Simplest record; one design per project | No second design without a second project; imported columns need a second place anyway |

**How a large matrix is stored.**

| Option | For | Against |
| --- | --- | --- |
| **Chunked project-owned binary with per-chunk digests (recommended)** | No dependency; the 64 MiB cap and per-read verification stay; windows touch few chunks | A format to own and test |
| One file, with the 64 MiB cap raised | Simplest writer | Whole-file verification of 400 MB on every page; a new cap with no measurement behind it |
| Arrow or Parquet crates | Standard columnar formats | Large dependency trees and an owner approval; ANALYSIS_WORKERS allows them only "where justified" |
| JSON Lines, as M9 | Same as today | About 0.6–1 GB at 10^5 × 500 **[arith]**; parsing on every page |

**Rejected outright:**

- **Raising ADR 0050's 16 to study size.** This is option (b) with a larger
  number: per-sample run records in the document, and still nothing
  cross-sample.
- **Several workers at once in the first build.** ADR 0050's reasons stand:
  memory multiplied by the worker count, contention for work-area copies, and
  peak memory per worker is unmeasured for untargeted detection. Decision 3
  keeps the records ready for it.
- **Writing an aligned mzML per sample.** A new multi-GB file per sample, and
  an overwrite risk; decision 8's inverse mapping is tried first.
- **Ignoring unknown CSV columns.** A column the user meant to import would be
  lost without a word; a refusal that names it is one edit to fix.
- **Zero for a missing value**, in any file or table. It is a value, and a
  missing value is not one.

## Consequences

- Alignment, linking, gap filling and statistics have a place to run and
  record that the document can hold for hundreds of passes, and ADR 0050
  keeps targeted MS1 as it is.
- A study run holds the project for its whole length, which may be hours: Save
  works, and Save As and Close wait. A Stop keeps every completed sample, and
  reuse makes the rerun cover only the rest.
- A crash during a run loses that run's unpublished work. Its staging is left
  uncollected, as today.
- Per-sample facts are in the payload. A missing or corrupt payload loses
  them, while the document still has the run, its counts and its digests.
- Save As copies every matrix: about 450 MB for 10^5 × 500 **[arith]**. Reuse
  copies bytes rather than sharing them.
- Every read of a window verifies the chunks it touches. A measurement of
  window latency belongs to the first matrix slice.
- Development schema-5 projects written before the study slice are refused
  (decision 12).

## Open questions for the owner

1. **Document model.** Accept study-level runs with a digest-named revision and
   a payload ledger (option a), rather than per-sample runs with pruning or a
   larger document?
2. **Metadata scope.** Per study (recommended), or per layer with one design
   per project?
3. **Matrix format and bounds.** Accept `mscanvas.studyMatrix/1`: chunks of at
   most 8 MiB, binary64 values, 1,000,000 rows, 1,024 columns, 2^27 cells?
4. **Cell states.** Accept the six states, including `engineDiscarded` and
   `imported`, and the declared reading of an imported zero?
5. **CSV.** Refuse unknown columns (recommended), or list them and import the
   rest?
6. **Reuse.** Reuse matching per-sample outputs by default, with "run every
   sample" as the choice at review?
7. **Long runs.** Is losing an unpublished run to a crash acceptable for the
   first build, or should a run publish checkpoints as it goes?
8. **Acquisition-scale derived files.** If a later record needs one: the
   project's payload store, or an MSCanvas-owned cache with a recorded digest?
9. **Schema window.** Confirm that study records join schema 5 if they merge
   before a release writes it, and otherwise take schema 6.
10. **Concurrency.** Who sets the parallel worker count, once per-recipe
    measurements exist: a recorded constant per recipe, or a measured share of
    free memory at the start of each run?
