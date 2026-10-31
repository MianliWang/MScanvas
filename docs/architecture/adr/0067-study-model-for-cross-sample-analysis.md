# ADR 0067 — Study model for cross-sample analysis

Status: **Proposed** on 2026-10-30. The owner directed that day that analysis is
no longer deferred and is to be planned and built (recorded in
[OWNER_DECISIONS_V511](../../development/OWNER_DECISIONS_V511.md), where this
record's questions are B-6, and question 2 is answered with S-6). This record
states the options and a recommendation for each, for the owner to decide.
Nothing here is implemented, and nothing here reaches the interface. The
owner decided on
2026-10-30 (G1) that the governing records are amended to un-defer analysis
(AGENTS.md, "Analysis is deferred but architecturally allowed"); the amendment
itself is applied in its own PR, and this record takes effect only once it
is. The questions for the owner are listed
[at the end](#open-questions-for-the-owner).
Related: [0006](0006-multi-dataset-workspace-boundary.md) (the session-only
workspace), [0016](0016-explicit-converted-output-adoption.md) (explicit
adoption), [0028](0028-figure-renderer-and-semantic-specification.md)
(screen and export figures),
[0047](0047-first-windows-beta-scope-and-implementation-route.md) (beta scope;
the targeted-MS1 runtime is not shipped),
[0048](0048-stored-targeted-result-reuse-and-export.md) (a stored result is read
without running anything; absent is an empty cell),
[0049](0049-content-bound-execution-snapshot.md) (content binding),
[0050](0050-sequential-batch-of-independent-targeted-plans.md) (the sequential
batch this record supersedes in part),
[0054](0054-spreadsheet-csv-for-the-targeted-results-table.md) (spreadsheet
CSV), [0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)
(the schema-5 bump; its schema-4 read-and-upgrade disposition and known
limitations are in the revision of ADR 0055 on `be/integrate`, draft PR #161,
not yet on `main`),
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
result record per acquisition, plus the plan. In this record a **step** is
one recipe step over every included sample, and a **pass** is the five steps
of decision 4. Recorded the ADR 0050 way, each sample of a step adds a run, a
result record and a plan, which is about 1.0 kB before its targets (1,038
bytes measured in the schema-4 canonical document), and each sample's
reference and layer add about 0.6 kB (455 and 173 bytes) once. Two
300-sample steps would take 2 × 300 × (4,700 + 1,200 + 1,038) + 300 ×
(455 + 173) ≈ 4.35 MB, over the 4 MiB bound (4,194,304 bytes): a document
holds one such step in its whole lifetime, and the second reaches the bound
at about its 277th sample. That is less than one pass, which has two
per-sample steps; 2,048 runs or artifacts would be reached in the seventh
step even if bytes allowed it **[arith]**. The same closure shows the second
trap: every plan stores its whole target list, so a 16 × 200 batch costs about
0.84 MiB. A study plan that
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
  - an **imported column**: a sample column of an imported feature table that
    has no acquisition in the project. Importing such a table is part of
    "Track A", the analysis work that needs no Python runtime (imported
    tables, sample metadata and Rust statistics). Such a sample can enter
    statistics and nothing that reads an acquisition. Its source is named
    before anything is imported: the table's project reference (`InputId`)
    and the column's 1-based ordinal in that file, with the column's header
    text kept for display. The import review (decision 6) adds these samples
    as a study edit before the import step runs.

  A layer, or a table column, backs at most one sample of a study
  (`studyDuplicateSource` otherwise); it may back samples in several studies;
- a **role** for each sample, from a closed vocabulary: `sample`, `qc`
  (pooled quality control), `blank`, `standard`;
- **groups** and **batches**: lists of `{id, label}` (`GroupId`, `BatchId`),
  each sample naming at most one of each. Ids make a rename one edit and keep a
  statistic's group identity stable. Within a study, no two groups share a
  label and no two batches do, compared without regard to ASCII case
  (`studyDuplicateLabel` otherwise), so a label names one group in the
  interface and in the CSV of decision 11;
- an **injection order** for each sample: a positive integer, unique within
  its batch (or within the study, for samples with no batch), or `null` where
  unknown. A computation that needs the order
  refuses a study in which any included sample lacks it; it does not guess.

The study is **current state**, edited in place like layers, not history. What
a run used is pinned by the revision it was given (decision 2), so editing a
study never rewrites a result and does not grow the history.

Bounds, as guards against a malformed document for the first build, not
scientific limits: at most 1,024 samples per study (the Workbench roster's
capacity, `MAX_WORKSPACE_DATASETS` of ADR 0006, reused as a round guard; an
imported column has no roster row) and at most 64 studies per project.
Layer-backed samples are already capped at 512 by the project's input bound,
so 1,024 binds only when imported columns are included. A study record costs
about 250–300 bytes per sample pretty-printed, about 90 kB for 300 samples
**[arith]**. The counts are not a
capacity: 64 studies at their sample bound would be about 8–19 MiB
**[arith]**, so the 4 MiB document bound binds long before them.

**Every study edit is measured before it applies.** Adding samples or a study,
changing metadata and a CSV import (decision 11) each compute the bytes Save
would then write, plus any reservation a running study step holds (decision
4), and are refused `oversized` over 4 MiB, as both captures measure before
they keep. Removing samples or a study shrinks the document and is never
refused for size. Once history has filled the document, a study can still
lose samples but not gain them, and the remedy is a new project, as for any
full document (M9 closure §8).

Removing a sample from a study deletes no input, no source file and no
artifact. A layer that a study names cannot be removed from the project
(`layerInStudy`), nor can its input or the input of a table whose column it
names (`inputInStudy`), until its samples are removed, so no sample dangles.
What a recorded study run consumed is protected by the run itself (decision
4), as today. A study that a recorded plan names cannot be removed
(`studyUsedByRun`), as a layer a run consumed cannot, so no plan's `StudyId`
dangles; its samples can still be removed. Validation refuses a study plan
whose `StudyId` names no study of the document (`danglingReference`), as it
refuses a plan whose layer is gone, and the study slice tests both the
refused removal and the refused document.

**Per study, not per layer.** Role, group, batch and order are kept on the
study's samples, keyed by `LayerId` within the study, not on the layer itself.
The same acquisition can be a sample in one design and left out of another, an
imported column has no layer, and a statistic must name the design it used.
A project whose interface shows one study gives the effect of metadata on
layers.

### 2. A study revision names the sample set once

The canonical form of what a step is given about the study is its **revision**.
It lists every sample of the study at review, in study order, each with its
`SampleId`, its source (the layer, its reference and the length and SHA-256 of
each member that reference recorded; or, for an imported column, the table's
reference, its recorded length and SHA-256, and the column's ordinal and
header), its role, its group and batch (`GroupId`, `BatchId` and label), its
injection order, and whether the step includes it. An excluded sample carries
its reason, from a closed vocabulary: `noUpstreamOutput`, `otherPolarity`,
`notCentroided`, `sourceChanged`, `roleNotUsed` or `excludedAtReview`. The
revision also names its study by `StudyId` and label. It is named by the
SHA-256 of that form (`studyRevisionSha256`), so the digest pins the
exclusions as well as the metadata.

The revision file (`study.json`) is stored in the payload of every artifact a
study step produces (decision 4). Its bytes are exactly the canonical form,
and a reader recomputes their SHA-256 and refuses the artifact as
`payloadCorrupt` unless it equals the plan's `studyRevisionSha256`: the
manifest proves only that the file is unchanged since it was written, not that
it is the revision the plan was reviewed with. The study slice tests both a
re-serialized and an altered `study.json`. Plans name it only by digest and
hold only the counts of included and excluded samples. No plan inlines the
sample list, so a study plan's size does not depend on the number of samples.
The run lists the layers it consumed, for lineage (decision 4), and nothing
else of the revision.

Earlier revisions therefore live in the artifacts that used them, not in the
document. A statistics result names its revision, so the metadata it used can
be read back while its payload is available, and editing the study adds
nothing to the history.

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
  linking run in the worker; assembly (decision 4) and statistics run in Rust
  with no worker.
- **Every payload file a worker is given is bound as an acquisition is** (ADR
  0049), whether a cross-sample step's inputs or the cross-sample result in
  gap filling's request. Rust opens it with a handle that refuses writers and
  deletion, checks its length and SHA-256 through that handle against the
  ledger, manifest or `matrix.json` that names it, and gives the worker a hard
  link proven to be the held object or a verified copy, never the store's
  path. The handle is held until the worker has exited. So the worker reads the
  bytes Rust checked, and cannot write an earlier artifact even though read
  confinement is not enforced (M9 closure §3.3). A Rust step reads payload
  files through held, verified handles in the same way.
- A step that must read several acquisitions in one invocation (the pyOpenMS
  GNPS MGF writer reads every mzML at once) is admitted only by its own recipe
  record, with a capacity check that sums its copies. The recommended GNPS
  route, a project-owned CSV and MGF writer, needs no such step.

**Review.** A step's review lists every sample of the study. A sample the step
cannot take is listed with its reason: no completed upstream output, the other
polarity, profile data, a changed source, a role the step does not use. The
step runs only the samples the user keeps. The revision (decision 2) names
every excluded sample with its reason, including the ones the user left out,
so nothing is dropped unnamed and the plan still holds only counts. A
cross-sample step needs at least two included samples. What statistics need
beyond that is the statistics record's decision.

**Kept from ADR 0050:**

- Rust owns the queue, and the interface never loops over runs;
- one study run is one exclusive project job (ADR 0050, decision 3): New,
  Open, Close, Save As, and removing or re-pointing what the run names are
  refused for its whole length, and Save is not;
- the run is given exactly what was reviewed, and **freezes** it (ADR 0050,
  decision 2). When Rust accepts a study run, it recomputes the revision from
  the study as it is then and resolves the reuse set (decision 5), and refuses
  the run as `planNotCurrent` unless the revision's SHA-256 equals the plan's
  `studyRevisionSha256` and the number of samples that would reuse equals the
  plan's. It then freezes the revision's bytes and the reuse set (which sample
  reuses which output). Every invocation, every Rust computation (statistics
  read roles and groups from it) and the publication read only that frozen
  copy, and the `study.json` the artifact holds is those bytes. A study edit
  made while the run holds the project changes the study, never the run. Each
  sample is still checked at its turn against the project as it is then (its
  layer, its reference, the bytes that reference recorded, the recipe), as a
  frozen batch plan is;
- each sample's failure is its own, as ADR 0050's decision 4 table sets out
  per member, with one difference: a sample refused at its turn, before its
  attempt (its copy no longer fits the work area, its source no longer holds
  the recorded bytes, its reuse source fails), is not left unrecorded as a
  batch member is. Its ledger line is `failed`, with the refusal's code and
  stage, it counts as a failed sample, and the artifact cannot then be
  `complete` (decision 5). `notStarted` is only for a sample that a Stop or a
  quarantine kept from beginning;
- one Stop, with the semantics of ADR 0050, decision 5, for the sample it
  reaches, whether that sample is running an invocation or copying a reused
  output; unlike a batch member's publication, the study run's own
  publication is outside the Stop's reach (decision 5);
- nothing completed is rolled back because a later sample failed.

**Concurrency stays one worker at a time** until a per-recipe measurement of
time and peak memory on a real file sets a safe count. The ledger (decision 4)
is in sample order, not completion order, so a later parallel scheduler changes
no record.

### 4. One study run per step, and what the document holds

The words are generic: one plan kind (`studyStepPlanV1`), one run operation
(`studyStepV1`) and one artifact kind (`studyStepResultV1`) serve every study
recipe step. Which step a plan is, is its recipe binding (decision 12).

- **Plan**: the recipe binding (recipe identifier, version, adapter, engine
  profile and runtime manifest digests, and the `experimental` flag of
  decision 10), the parameters (decision 12 gives their one generic shape), the
  `StudyId`, the `studyRevisionSha256`, the step's polarity (decision 9), the
  upstream artifacts the step consumes (at most eight), the reuse choice of
  decision 5 with the number of samples expected to reuse, and the counts of
  included and excluded samples. It is named by the SHA-256 of its canonical
  form and recorded only once a run executes it, as today.
- **Run**: one per study step. Its `inputs` list what it consumed, as every
  run's do: the layer of each included sample, for a step that reads
  acquisitions; exactly one input, the table's, and no layer, for an import
  (decision 6); and each upstream artifact. It holds the plan digest, the
  attempt facts every invocation must share (the runtime manifest,
  interpreter and adapter digests, and the engine report), counts of sample
  outcomes with the number actually `reused` counted on its own, the run's own
  failure or stop where it has one, and the ledger's digest. The shared facts
  are the first invocation's. A later invocation that reports any other fails
  its sample with `runtimeUnverified`, and its output is not accepted. The
  modules a worker loads can differ between invocations, so each invocation's
  loaded modules (at most 32, each a file the runtime pins,
  `runtimeModuleMismatch` otherwise) are in its ledger line, and the run holds
  none. The attempt facts and the application version describe only what this
  run executed. A reused output's own facts are those of the run that produced
  it, which the ledger names. A run in which no worker ran, because every
  sample reused an output or because the step runs in Rust (assembly,
  statistics, an import), records no attempt (`null`); for a study run that
  is valid with any outcome, and a study run in which a worker was launched
  always records one. Its outcome follows the table in decision 5.
- **Artifact**: one for every study run that started, with the one exception
  of a run whose publication failed (decision 5). Its
  payload always holds `study.json` and the **ledger** (`samples.jsonl`). For
  a cross-sample step, its first line is the step's own invocation or
  computation: its outcome, its failure code and stage where it has one, and
  the loaded modules of its worker invocation, if it had one. Then comes one
  line per included sample, in sample order, with the consumed
  content, the execution view (`hardLinkInWorkArea` or
  `verifiedSnapshotInWorkArea`), the polarity and centroid state the
  invocation found, the invocation's loaded modules (a per-sample step's
  only; a cross-sample step's sample lines carry none), the outcome
  (`completed`, `failed`, `cancelled`, `notStarted`), a failure code
  and stage or stop facts where there is one, the source of a reused output
  (decision 5), and each output file's length and digest. A ledger failure code
  is a document `FailureCode`, a word of the ledger format's own
  (`reuseSourceUnavailable`, decision 5), or a reason of the recipe's own, a
  token (decision 12) that the ledger checks for shape only. The payload also
  holds an output for each sample that completed (per-sample steps), or the step's
  result (cross-sample steps, only when the invocation completed). The
  artifact's record says
  `complete`, `partial` or `noResult`. Unlike M9's result record, which lists
  each payload file's length and digest, a study artifact's record names its
  payload only by the manifest's length and SHA-256. The listing has two
  levels. The manifest lists only the payload's top-level files, a fixed
  handful: `study.json`, the ledger and, for a matrix result, `matrix.json`.
  The ledger lists each per-sample output with its length and digest, and
  `matrix.json` lists every chunk (decision 6). The manifest therefore stays
  within the 64 KiB small-record bound at any sample count, and the record's
  size does not depend on it. The ledger and `matrix.json` are ordinary payload
  files, at most 64 MiB, verified whole against the digest that names them when
  they are read. Save As copies and verifies every file the three name.
- **Availability has two levels.** On open, M9 observes availability (M9
  closure §3.4). For a study artifact, `available` on open means that the
  manifest and the top-level files it lists (`study.json`, the ledger,
  `matrix.json`) match their digests. Only those files are hashed then, and
  `available` says nothing yet of the per-sample outputs and chunks they list,
  which may be gigabytes (decision 8). Those are verified when they are used:
  a view reads one, a reuse copies one, a later step is given one, or Save As
  copies it. A listed file found missing or changed then refuses that use and
  makes the artifact `payloadMissing` or `payloadCorrupt` for the rest of the
  session. Save As verifies every listed file as it copies it, so after Save
  As the observation covers them all. The study slice tests a missing chunk
  that open does not see and a read does.
- **Payload file names are MSCanvas's.** Every name in the manifest, the
  ledger or `matrix.json` is generated from a fixed pattern of its format, with
  only an MSCanvas ordinal or a `SampleId` put in: `study.json`,
  `samples.jsonl`, `matrix.json`, `values-NNNNN.bin`, `cells-NNNNN.bin`,
  `reasons-NNNNN.bin`, `attr-AA-NNNNN.bin` and `<SampleId>.<kind>.bin`, where
  the kind is a recipe token. No name comes from a column header, an attribute
  name or a user's text; those are kept as display text inside `matrix.json` or
  the ledger. A reader checks every listed name against its pattern, and with
  the same checks as today's `bounded_member_name`, before it opens anything,
  and refuses the artifact as `payloadCorrupt` otherwise. So a hand-edited
  ledger cannot make Save As or a view read or write outside the artifact's
  directory.
- **Refused before the run starts**: nothing is recorded, as for a single
  run (decision 5 says when a study run starts).

**Lineage.** Because the run lists its layers, today's rules hold unchanged:
`remove_layer` and `remove_input` refuse what a run consumed
(`layerUsedByRun`, `inputUsedByRun`), so a sample's layer and reference stay
once a study run has consumed them, even after the sample leaves the study. A
study run lists at most `MAX_LAYERS` layers and eight artifacts, or, for an
import, exactly one input and nothing else, so validation's bound on a run's
inputs is 520 for study runs and stays 512 for every other run.

A run that consumes an artifact is a new edge (`RunInput` gains an `artifact`
variant). Validation requires that the artifact exists, that it is a
`studyStepResultV1` whose completeness is not `noResult`, that a run earlier in
the document's list of runs produced it, and that it is not one of the
consuming run's own outputs. A `noResult` artifact holds no output a later
step could read, so the review never offers it as an upstream, and a document
that names one is `inconsistentRecord`. Every such edge points from a run to
an earlier run's output, so the order of the runs is a topological order and
no cycle is representable. The no-cycle argument in `lineage.rs` is rewritten
to say so in the same change. Reused outputs (decision 5) are not
consumption: the ledger names their source artifact, and no artifact can be
removed.

**A pass** is five steps: detection (per sample), alignment and linking
(cross-sample, worker), gap filling (per sample), **assembly** (cross-sample,
Rust) and statistics (cross-sample, Rust). Gap filling writes only each
sample's own output; assembly is the step that writes the gap-filled matrix,
as a new matrix artifact. It consumes the linking matrix and the gap-filling
artifact, keeps every linking cell, and replaces only the cells gap filling
decided for a sample whose gap filling completed. For a sample whose gap
filling failed, was cancelled or did not start, the column stays, with its
linking cells unchanged, and each cell gap filling was to decide is
`undecided` with the reason `gapFillingNotCompleted` (decision 7). Statistics
read the assembled matrix and nothing else of the pass.

**Document cost.** About 8 kB per step (the M9 closure's 4.7 kB run and 1.2 kB
result record, and a plan with no list in it), plus about 108 bytes for each
layer the run lists **[arith]**. At 300 samples, a per-sample step (detection,
gap filling) costs about 40 kB and a cross-sample step (alignment and linking,
assembly, statistics) about 8 kB, so a pass of the five costs about 105 kB
(2 × 40.4 + 3 × 8). Beside a 300-sample study record (about 90 kB) and its
300 references and layers (about 188 kB), about thirty-seven passes fit:
(4,194,304 − 90,000 − 188,400) / 104,800 ≈ 37. Recorded the ADR 0050 way, not
one would (Context) **[arith]**. If alignment and linking were two steps, a
pass would be six steps, about 113 kB, and about thirty-four would fit. The
ledger costs about 1–2 kB per sample per step, plus about 150 bytes for each
module the invocation loaded, and it lives in the payload **[arith]**.

**The worst case is reserved before any worker runs.** A study run's records
are bounded, not fixed. The plan bounds its own lists, and the worker reports
the engine report's five strings (200 characters each); the loaded modules go
to the ledger, not the run. When Rust accepts the run, it computes
the bytes the plan, run and artifact records would take with every list full
and every string at the most bytes its bound allows (up to 4 bytes a
character): about 26 kB, plus about 108 bytes per listed layer **[arith]**,
mostly the 32 parameters (about 15 kB, a `decimal` spelling being at most 327
characters) and the engine report (about 4 kB). The reservation also holds
**slots**: one run, one artifact and, when
the plan is not already recorded, one plan, against `MAX_RUNS`,
`MAX_ARTIFACTS` and `MAX_PLANS`. It refuses `oversized` if the document plus
those bytes exceeds 4 MiB or any count plus its slot exceeds its bound, and
otherwise holds both until the run is recorded. While the reservation is held,
every operation that grows the document (adding a reference or a layer,
either capture, a study edit, a CSV import) is measured with the reserved
bytes and slots added, and is refused `oversized` over either bound: a
capture is refused once the runs or artifacts recorded plus the reserved
slot reach their bound, not only when the recorded ones do, as
`refuse_full_history` checks today. The run's own records therefore always
fit, in bytes and in count, and the study slice tests a capture refused for
a reserved slot. This closes, for study runs, the M9 closure's limit that
"the 4 MiB bound is met after the member's worker ran".

### 5. Stop, failure, restart and reuse

- **When a run starts and ends.** A study run **starts** when its first
  sample's turn begins, with that sample's checks at its turn (decision 3), or,
  for a Rust step (assembly, statistics, an import), when its computation
  begins. A refusal when the run is accepted (`planNotCurrent`, `oversized`
  and the like) is before the start. It **ends** when its last sample has
  ended, before the publication. A Stop or a refusal before the start records
  nothing and releases the reservation.
- **Stop.** A Stop accepted between the start and the end makes the run
  `cancelled`, wherever it lands. The sample in progress meets it as an ADR
  0050 member does (decision 5): an invocation, a reuse copy or a Rust
  computation that has not had its output accepted into the run's staging is
  `cancelled`, and what it wrote is discarded. A Stop that lands between two
  samples cancels none; every sample not yet begun is `notStarted`. The Stop
  never reaches the run's own publication: what completed is published unless
  the publication itself fails (below), and a Stop that arrives after the end
  stops nothing and is not recorded. No completed work is discarded by a Stop
  or by a later sample's failure.
- **Quarantine** (`workerNotAccountedFor`). No later sample starts, as in ADR
  0050. What completed is published the same way.
- **Disk space.** Each sample's validated output is written into the run's
  staging as that sample ends, and the publication is a rename on the same
  volume, which needs no space. A sample whose output cannot be written into
  staging, a full disk included, fails in the ledger with
  `payloadNotPublished` at stage `publish`, and later samples are still tried,
  as after any sample's failure. Before the start, Rust checks that the
  payload store's volume has room for the ledger and the manifest at their
  bounds, and refuses the run otherwise (`insufficientPayloadSpace`, a new
  command refusal that records nothing). It sets no threshold for the outputs,
  whose sizes are not known in advance, so a disk filled by them can still
  make the final ledger or manifest write fail, and that is a failed
  publication.
- **Run-level failure codes are generic.** A study run's own failure uses only
  the document's existing worker, runtime and publication codes
  (`workerLaunchFailed`, `workerTimeout`, `workerExitedAbnormally`,
  `workerInternal`, `workerNotAccountedFor`, `runtimeUnverified`,
  `runtimeModuleMismatch`, `requestRefused`, `engineError`, `resultInvalid`,
  `payloadNotPublished`), the existing `sourceUnavailable` and
  `sourceChanged` at stage `source` for an upstream payload file or an
  import's table found missing or changed when it is bound or read, and two
  new words: `noSampleCompleted`, and `computationFailed` for a Rust step's
  own computation that could not complete (an import that meets undeclared
  text, a statistic that cannot be computed). A reason of a recipe's own,
  which no document word names, is written only in the ledger (decision 4),
  so a new recipe adds no failure code to the document.
- **Outcome.** A study run's outcome and its artifact follow this table:

  | How the run ended | Run outcome | Artifact |
  | --- | --- | --- |
  | the run ended with no Stop accepted and no quarantine, and at least one sample completed (a reused output counts), or the cross-sample computation completed | `completed` | `complete` if every included sample completed, `partial` otherwise |
  | the run ended with no Stop accepted and no quarantine, and none completed | `failed`, with the run-level code `noSampleCompleted` for a per-sample step, or a generic code (above) for a cross-sample step, whose own reason is in the ledger's first line | `noResult` |
  | a Stop was accepted between the start and the end | `cancelled` | `partial`, or `noResult` if none completed |
  | quarantine (`workerNotAccountedFor`) | `failed` | `partial`, or `noResult` if none completed |
  | the publication failed after the end (writing the ledger or the manifest, or the no-replace rename), whatever the outcome would otherwise have been | `failed`, `payloadNotPublished` at stage `publish` | none |

  This changes a validation rule for study runs only: today a `failed` or
  `cancelled` run that names an artifact is refused (`inconsistentRecord`). A
  study run names exactly one artifact whatever its outcome, `complete` only
  with `completed`, with one exception: a run whose publication failed names
  none, and is valid only as `failed` with `payloadNotPublished` at stage
  `publish`. Its ledger digest is `null`, because no ledger was published; it
  keeps its sample counts, and the stop facts of a Stop accepted before the
  end. The ledger and the counts say which samples did what. The
  rule and its test change with the study slice, and every other run keeps
  today's rule. A user-stopped or quarantined run is never recorded as
  `completed`.
- **A failed publication keeps the staging.** Unlike a single run's commit,
  which discards its staging when the rename fails, a study run's failed
  publication leaves its `.staging/` in place, because it may hold hours of
  completed samples. It is then treated as after a crash: it is not
  collected, and nothing is recorded or reused from it. Recovering it is the
  same question as checkpointed publication (open question 7).
- **A crash** before the publication leaves only `.staging/`. That is not
  collected (M9 closure §13), and nothing is recorded or reused from it.
  Checkpointed publication within a run is not decided here (open question 7).
- **Reuse.** A later run of a per-sample step can reuse a completed output whose
  **key** is equal. The key is the SHA-256 of the canonical per-sample request
  (recipe binding, parameters, and every upstream input the invocation is
  given) together with the consumed content's digest. The key holds nothing
  else of the study: not the revision digest, and not the sample's role,
  group, batch or order, so editing the study or adding samples changes no
  detection key. Gap filling's key does change when the cross-sample result it
  is given changes, as it must. An output with an equal key came from an
  equivalent request on the same bytes, not from this run. It is verified
  against its digest and copied into the new artifact, so every artifact's
  directory stays complete on its own for Save As. The ledger names the
  artifact it came from. Reuse is not re-execution and claims nothing about
  what the engine would produce again. The review says how many samples
  reuse an output; reuse is the default, and running every sample afresh is
  one choice at review. The choice (`reuseMatching` or `runEverySample`) and
  the number of samples expected to reuse are in the plan, so they are part
  of its digest. This is how a stopped 300-sample run, or a study that gained
  ten samples, avoids repeating hours of work.
- **A reuse source that fails.** If, when its turn comes, a sample's reuse
  source is `payloadMissing`, `payloadCorrupt` or no longer matches its
  digest, that sample fails with `reuseSourceUnavailable`. It is never run
  instead: that would be a fallback the review did not show. The next review
  offers it as a fresh run.

### 6. Large results: a chunked matrix read in windows

A study matrix (features × samples) is stored in a project-owned format,
`mscanvas.studyMatrix/1`. It adds no dependency: no Arrow and no Parquet.

- `matrix.json`: the format, the polarity (decision 9), the row and column
  counts, the column order as `SampleId`s, the row-block size, the value type
  (`f64le`), the attribute columns (at most 16, each with its display name and
  type), the reason vocabulary of decision 7, and every chunk file with its
  length and SHA-256. It is not a small record: at 1,024 columns, 128 row
  blocks, a reason file in each block and 16 attribute columns, it is about
  450 kB pretty-printed **[arith]**. It is an ordinary payload file that the
  manifest names by digest (decision 4), verified whole when read, with a
  guard of 1 MiB.
- `values-NNNNN.bin`: a row block of R rows × all columns, binary64 little
  endian, row-major. `cells-NNNNN.bin`: one state byte per cell (decision 7),
  in the same layout. `reasons-NNNNN.bin`, only for a block that has an
  `undecided` cell: each such cell's index in the block and its reason code,
  in index order. `attr-AA-NNNNN.bin`: attribute column AA (by ordinal) for the
  block's rows (feature identifier, m/z, retention time and its range, and the
  like), each with its own digest. A text attribute value is at most 256 bytes
  of UTF-8; a longer one refuses the write with a typed reason.
- R is chosen so that no chunk of a row block, values or attribute, exceeds
  8 MiB, so a matrix at the cell bound has at most 128 row blocks.
  **No byte reaches a window unverified.** A view verifies each chunk the
  first time a window touches it, and keeps that
  chunk open under a held handle that refuses writers and deletion, as ADR
  0049 holds a source, until the view closes. Later windows read through the
  held handle and verify nothing again, because nothing can change the file
  under it; a chunk whose handle cannot be held is refused, not read. Whole-file
  verification of 400 MB on every page would not scale. No file exceeds 64
  MiB, and the cap does not change.
- Bounds, as product guards: at most 1,000,000 rows, 1,024 columns and 2^27
  cells (1 GiB of values) per matrix. A 10^5 × 500 matrix is 400 MB of values
  and 50 MB of states, in 48 row blocks of 2,097 rows **[arith]**.

**Rust reads windows.** A window is a range of rows in the current view order
× a set of columns. It is bounded by **cells**, not rows: 500 rows × 300
columns is already 150,000 cells. The starting bound is 50,000 cells, and the
slice sets the final one with a rendered measurement.

**Sort and filter run in Rust.** Sorting on an attribute column reads only that
column's chunks. Sorting on a sample column reads, and so verifies, every
chunk once.
A sorted view scatters its rows over the blocks: 100 consecutive rows of a
10^5 × 500 matrix sorted by a p-value fall in nearly all 48 blocks, so the
first sorted window may verify about 450 MB **[arith]**, and the windows after
it verify nothing. The first matrix slice measures that first sorted window
as well as a window in file order. The result of a sort is a row permutation
that Rust holds for the session (4 bytes a row, 400 kB at 10^5 rows). It is
never persisted and never sent to React whole. React holds only
the visible window and the view's description (sort key and filter). For study
tables, this selects "on-screen result sorting and filtering", which the
after-beta-1 plan (7.6) lists as reversible and not selected.

Figures over a matrix (volcano, loadings, heatmap) follow ADR 0028
unchanged: Rust reads the matrix, decimates it and produces the shared
`FigureSpec`; the screen draws it in the repository's TypeScript SVG and
hit-tests the marks it drew, with no IPC per pointer move, and export renders
it in Rust. A selection that needs more than a drawn mark holds (a feature's
whole row) is one window read from Rust. Each plot kind is its own record,
and the 2D map is ADR 0068's.

**Per-sample outputs** (a sample's feature map) are ordinary payload files of
at most 64 MiB. A feature map of 10^5 features × about ten fields is about 8 MB
in binary **[arith]**. A larger output fails its sample with a typed reason;
it is not split.

**Imported tables** (Track A) are written into the same format when they are
imported. The table file is first a project reference; how it becomes one is
the Track A record's decision. The import review reads its header, and the
user picks the sample columns, their polarity and the declarations of decision
7. Confirming adds one study sample per picked column (decision 1), as a
measured study edit, and only then is the import step reviewed against the
revision that now lists them, as any step is. An import is recorded as a study
step that runs in Rust, like statistics: its plan holds the polarity and the
declarations, its run consumes the table's reference, and its artifact is the
matrix. If the import fails, the samples stay, with no upstream output, and a
later step excludes them as `noUpstreamOutput`. So a statistics run over
imported columns consumes an artifact an earlier run produced, as decision 4
requires.

### 7. Each cell says what it is, and absent is never zero

The cell state is a closed vocabulary, one byte a cell. It belongs to the
`mscanvas.studyMatrix` format version, not to the document schema:

| State | Meaning | Value |
| --- | --- | --- |
| `measured` | detected in that sample by the per-sample step | yes |
| `reintegrated` | found again in that sample's raw data by gap filling; a different quantity from a detection | yes |
| `engineImputed` | returned by the engine without being measured (M9.0: a failed fit imputed by regression) | yes, never used by a test |
| `undecided` | the step could not decide for that sample; never an absence (M9 closure §3.2) | none; a reason code in the block's reason file |
| `missing` | not found in that sample, which is not proof of absence | none |
| `imported` | taken from an imported table whose producer did not say how it was obtained | yes |

- **A failure is not a missing value.** A cell is `undecided` where the step
  could not decide: the M9 `FAILED` reasons `EXTRACTION_AT_SPECTRUM_EDGE`,
  `RELATED_TARGET_AT_SPECTRUM_EDGE`, `CANDIDATES_WITHOUT_FEATURE`,
  `WINDOW_WITHOUT_MS1_PEAKS` and `ENGINE_DISCARDED_NO_VALID_FIT`, a
  gap-filling window that maps outside that sample's acquired retention-time
  range, or `gapFillingNotCompleted` (decision 4). The engine's discard is one
  of these reasons, not a state of its own: M9.0 read in the engine's source
  (not exercised) that it happens when no fit in the whole request is valid,
  so it is a failure of the run's fitting, not a finding about one feature.
  The reason vocabulary is the recipe's, listed in `matrix.json`. No
  statistic counts an `undecided` cell as `missing`, whatever its reason;
  what it does with one is the statistics record's decision, and is recorded
  with each result.
- **Every value is finite.** A cell in a state with a value (`measured`,
  `reintegrated`, `engineImputed`, `imported`) holds a finite binary64; a
  writer refuses a non-finite one, and a reader that finds one refuses the
  artifact as `payloadCorrupt`. A cell with no value holds a NaN in its value
  slot. No reader interprets it: readers decide by the state, never by the
  value. No cell is ever written as 0 to mean absence. Exports write an empty
  cell where there is no value (ADR 0048) and carry the states beside the
  values.
- **An imported zero is declared, never assumed.** MZmine-2-style tables
  commonly write 0 where a feature was not detected. The import review asks
  how the table writes "not detected" (`zeroMeansNotDetected` or
  `zeroIsAValue`) and records the answer in the import's plan. An empty cell is
  always `missing`.
- **Imported text that is not a finite number is declared or refused.** A
  value cell's text must read as a finite decimal. Any other non-empty text
  (`NA`, `NaN`, `inf`, `n.d.` and the like, which a float parser may accept as
  NaN or infinity) refuses the import, naming its line and column, unless the
  import review declared that exact text to mean "not detected". The
  declaration is a `token` parameter in the import's plan, so only text of
  token shape (decision 12) can be declared, and a declared cell is `missing`.
- **A failed sample is not a column of missing cells.** A sample whose
  detection (or import) failed has no column: it is left out of the matrix,
  with its reason in the ledger. A sample whose later per-sample step failed
  keeps its column as decision 4's assembly sets out. A completed sample whose
  every cell is `undecided`, as after an engine discard, keeps its column too;
  it is not a failed sample.
- Which states a statistic uses is the statistics record's decision, recorded
  with each result. `engineImputed` never enters a test.
- A value-changing step (normalization, or any later imputation or correction)
  never overwrites. Its output is a new matrix artifact whose cells keep their
  source state. If imputation is admitted, its state word is added then, as a
  new version of the matrix format; the document schema does not change.

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
- **Gap filling**, if the chosen alignment yields a monotonic, invertible
  transformation, maps each missing feature's retention time into the
  sample's own retention-time space through the inverse of that sample's
  transformation. It then requantifies the original, content-bound file, so no
  aligned mzML is written. This is unmeasured, and no alignment algorithm is
  chosen here. The gap-filling recipe's record must show on a fixture that it
  matches requantification of an aligned file. If the transformation is not
  invertible, or the result does not match, an aligned-file route needs its
  own record, and its file is a new artifact.

If a later record needs such a file, where it lives is not decided here (open
question 8). In the project's payload store, lineage is durable, but Save As
copies gigabytes. In an MSCanvas-owned cache like ADR 0060's, eviction is
possible, so the artifact would record the file's digest and a re-derivation
would be verified against it. The per-sample outputs that decision 6 does put
in the payload store already reach that scale: at about 8 MB a feature map,
a 300-sample detection artifact is about 2.4 GB, and gap filling's about as
much **[arith]**. Reuse copies them again into each new artifact. A hard link
to an immutable published file on the same volume would share the bytes
instead; it is an option for reuse, not decided here (open question 6).

### 9. Polarity and negative mode

- Every feature table and matrix has **one polarity**, and it is recorded: in
  each study plan (so in its digest) and in `matrix.json`. A per-sample
  step's polarity is chosen at its review from those its recipe admits, so
  `positive` alone until a negative-mode slice (below). A cross-sample step's
  polarity must equal its upstream artifacts'. An import's polarity is
  declared by the user at its review, because a table does not say. Nothing is
  split or filtered silently.
- Each sample's polarity is what its source declares. It is checked against
  the plan's at each per-sample invocation, as ANA-004's adapter checks it
  today: a sample of another polarity than the plan's, or of mixed polarity,
  fails there
  (`SOURCE_POLARITY_UNSUPPORTED`, `SOURCE_MIXED_POLARITY`), and what was found
  is recorded in the ledger. Once
  the reader reports polarity (the reader-metadata amendment to ADR 0056,
  decision 1, on `be/reader-meta`), the review also excludes such a sample
  (`otherPolarity`) before anything runs. Until then the review does not
  assume a polarity, and the invocation's check is the only one.
- **Centroid state** is handled the same way. A per-sample step that needs
  centroided MS1 fails a profile sample at its invocation
  (`SOURCE_NOT_CENTROID`, as ANA-004's adapter does), records what it found in
  the ledger, and, once
  the reader reports it, the review excludes such a sample (`notCentroided`).
  Nothing is centroided implicitly; centroided data comes from the conversion
  route (decision 8).
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
  quoting. On export, leading `#` lines carry the provenance preamble of ADR
  0048 (format and version, project and study identifiers; no locator).
- **The preamble is checked on import, not skipped.** A byte-order mark is
  removed first, as ADR 0054 requires of a reader. A file with no leading `#`
  line, such as a sheet a user typed, is read as this format. A file whose
  leading `#` lines hold a `#format` must say `mscanvas_study_samples` with
  `#schema_version` `1`, and is refused otherwise, naming what it says. A
  file with `#` lines and no `#format` is refused too. So the spreadsheet
  variant, whose `#format` is `mscanvas_study_samples_spreadsheet` (ADR
  0054's pattern), is refused on import: its apostrophes would read as part
  of a label. A results table or any other MSCanvas format is refused in the
  same way.
- **Columns**, a closed set of English names: `sample_id` (optional; MSCanvas's
  id), `file` (the primary member's file name), `role` (required; `sample`,
  `qc`, `blank` or `standard`, matched without regard to ASCII case and stored
  in that spelling), `group`, `batch` and `injection_order` (a positive integer
  or empty). There is no free label column: a sample has no name of its own
  beyond its file or its imported column's header. An unknown or repeated
  column refuses the import and is named. Nothing in a file is dropped
  unreported.
- **Matching.** A row matches by `sample_id` when that column has a value,
  which must name a sample of this study. Otherwise its `file` must equal
  exactly one project reference's primary file name. A row that matches none
  is refused with its line, and so is a row that matches more than one: two
  folders can each hold a `QC_01.mzML`, and `sample_id` tells them apart. A
  file not yet in the project matches none, so its row is refused, and the
  refusal says to add it as a reference first: adding a reference hashes the
  file and remains its own explicit action. A row whose reference has no layer
  is refused in the same way, because creating a layer is also the user's own
  action. A row whose reference has a layer that is not yet a sample of the
  study adds that sample, listed at review. A `group` or `batch` value
  names the study's group or batch with that label, compared without regard to
  ASCII case, as labels are unique on that comparison (decision 1). A label the
  study does not have is a new group or batch, listed at review. An import
  whose result would repeat an injection order within a batch (or within the
  study, for samples with no batch) is refused, naming the lines.
- **Review before anything changes.** The import shows every change (new
  samples, changed roles, groups, batches and orders, new group and batch
  labels) and every refusal by line. Nothing applies until the user confirms,
  and nothing applies if any line is refused. Metadata is never overwritten
  silently.
- **Export** writes the same columns for every sample, through the existing
  no-overwrite writer and save dialog. It is plain CSV by default, with ADR
  0054's spreadsheet CSV (`mscanvas_study_samples_spreadsheet`, version 1) as
  the option, for reading in a spreadsheet only. It carries file names, never
  paths. Exporting a study as plain CSV and importing that file with no edits
  leaves the study unchanged; the spreadsheet variant is not read back.

### 12. Schema: one bump for the study model, shared with schema 5

The new document content:

- a top-level `studies` array, required and possibly empty;
- the identifiers `StudyId`, `SampleId`, `GroupId` and `BatchId`;
- one plan kind (`studyStepPlanV1`), one run operation (`studyStepV1`) and one
  artifact kind (`studyStepResultV1`) for every study recipe step, and the
  `artifact` variant of `RunInput` (decision 4). Study plans go in a top-level
  `studyPlans` array, required and possibly empty, so today's `plans` keeps
  its targeted MS1 shape, and both count towards `MAX_PLANS`. A run's
  `studyStep` block is present exactly when its operation is `studyStepV1`, as
  `targetedMs1` is for a targeted run;
- the closed vocabularies: roles, polarity (a study plan's, decision 9), the
  reuse choice, artifact
  completeness (`complete`, `partial`, `noResult`) and the run failure codes
  `noSampleCompleted` and `computationFailed` (decision 5).

**The recipe is named in the plan, not in the vocabulary.** A study plan's
recipe binding names its recipe by a token (defined below) that the document
checks for shape and length but does not enumerate, unlike `RecipeId`, whose
one variant is targeted MS1. A build that meets a study recipe it does not
implement opens the document, shows that run as history under its identifier,
and refuses to run it, to reuse its outputs or to read its per-sample outputs
(`recipeUnavailable`). `study.json`, the ledger and the matrix are generic
formats it reads. This is a deliberate difference from the rule that an
operation this build does not implement is a refusal to open: the operation
is implemented, and only one recipe's execution is not.

**Parameters have one generic shape.** A study plan's parameters are a list of
at most 32 `{name, kind, value}` entries, with no name repeated. A **token** is
1–64 ASCII letters, digits, `.`, `_` or `-`. The name is a token. The `kind` is
`decimal`, `boolean` or `token`, and says how the value is read: a `decimal`
value is a `DecimalValue` in its canonical spelling, so a plan's digest cannot
move with a re-spelled number; a `boolean` is a JSON boolean; a `token` value
is a token. A `decimal` and a `token` are both JSON strings, so the kind is
stored, never inferred from the text. The document checks only that shape, and
only the recipe interprets the entries; there is no free object, which is
where an opaque blob would get in. So a later recipe step whose parameters
fit that shape needs no document schema change. A recipe whose
parameters do not fit it is its own schema decision.

Payload formats carry their own versions and do not bump the document schema:
`mscanvas.studyMatrix/1` owns the cell states and the reason vocabulary,
`study.json` owns the exclusion reasons, and the ledger owns the sample
outcomes.

- **One bump.** These join **schema 5** if they merge before any release writes
  schema 5. Schema 5 is on `be/integrate` (draft PR #161) and adds the "not
  verified by MSCanvas" label to an input. If a release ships schema 5 first,
  they take **schema 6**, under the read-and-upgrade disposition the owner
  accepted for schema 4 on 2026-10-30 (recorded in #161's revision of ADR
  0055): the build reads the earlier schema exactly, holds it in memory as the
  new one, writes nothing on open, and writes the new schema on the first Save
  after a change. Users never meet two one-way upgrades in one release. A word
  outside the generic ones above, such as a new run outcome, a new run
  failure code or a new `RunInput` variant, is its own schema decision; a
  recipe's own failure reasons stay in the ledger (decision 5) for that reason.
- **Schema 4 stays frozen.** On the schema-4 read path, every added word and
  field is `malformed`: the `studies` and `studyPlans` fields, a run's
  `studyStep` field, the operation `studyStepV1`, the artifact kind
  `studyStepResultV1`, the `artifact` variant of `RunInput` and the failure
  codes `noSampleCompleted` and `computationFailed`. #161's
  `schema_four_shares_only_beta_one_words_and_fields` only makes an added word
  or field fail to compile until someone decides it ("The check is the
  compiler's; running it asserts nothing more"); it refuses nothing. The
  refusal is this record's to build. Because a run's `studyStep` is required,
  as an explicit `null` on every other run, the shared `RunRecord` cannot
  read a beta-1 run, which has no such field. So the schema-4 path reads runs,
  run inputs, the run operation, artifact payloads and failure codes through
  schema-4 types of its own, as #161 already does for inputs
  (`SchemaFourInput`), and its `upgraded()` gives every run `studyStep: null`,
  `studies: []` and `studyPlans: []`. The study slice adds a test that refuses
  each added word and field on the schema-4 path, one by one, and a test that
  a beta-1 document with runs still opens.
- **Size.** An upgraded document gains `"studies": []` and `"studyPlans": []`,
  and each existing run gains `"studyStep": null`: about 40 bytes, plus about
  25 bytes a run **[arith]**. The known limitation that #161's revision of ADR
  0055 records for a beta-1 document near the 4 MiB bound grows by those
  bytes.
- **Development files, in both directions.** If the study slice joins schema
  5 after #161 merges, two development shapes of schema 5 exist for a time. A
  schema-5 document written by a build between #161's merge and the study
  slice has no `studies`, `studyPlans` or `studyStep`, and a study build
  refuses it as `malformed`, because an omitted field is malformed. A document
  written by a study build has those fields, and a build between the two
  merges refuses it as `malformed` too, not as `unsupportedVersion`. That is
  the mislabelling `parse` reads the version first to avoid, and it is
  contrary to #161's rule that "a later schema belongs to the build that wrote
  it". The
  condition above means no release writes either shape, so only documents
  written by development builds meet this. If that is not acceptable, the
  study model takes schema 6 whenever #161 merges first.

### 13. What this record does not do

- It does not un-defer analysis. The governance amendment the owner decided
  (G1) is applied in its own PR.
- It adds no interface and no recipe. Every pyOpenMS step (detection,
  alignment, linking, gap filling) also waits for ADR 0066, the runtime
  release: release builds answer `recipeUnavailable` until then. Track A
  (imported tables, sample metadata and Rust statistics) can use this model
  without the runtime.
- It chooses no algorithm, statistic definition, normalization or plot kind;
  each has its own record.
- It adds no history pruning. Study-level runs keep growth to about 8 kB a
  step plus about 108 bytes a listed layer without it (decision 4).

## Alternatives

**How a study's history fits the document.**

| Option | For | Against |
| --- | --- | --- |
| **(a) Study-level runs, a revision named by digest, per-sample facts in the payload (recommended)** | About 8 kB per step plus about 108 bytes per listed layer, so about thirty-seven 300-sample passes per document **[arith]**; lineage stays in the document; the worst case is reserved before any worker runs; ADR 0050's per-member isolation is kept in the ledger | Per-sample facts are readable only while the payload is available; one new run, plan and artifact shape, and a new run-to-artifact edge |
| (b) One ordinary run per sample per step, as ADR 0050, plus history pruning | No new record shape | One 300-sample step whole, less than one pass, per document before pruning **[arith]**; 2,048 runs reached in the seventh step; pruning an append-only history is its own design and loses what users may still read |
| (c) A larger or sharded document | Keeps today's shapes | Parsed and validated whole on every open and write; a shard format is a larger change than (a), and moves the limit rather than removing it |

**Where sample metadata lives.**

| Option | For | Against |
| --- | --- | --- |
| **Per study, keyed by `LayerId` within it (recommended)** | One acquisition in several designs; imported columns without a layer; a statistic names its design | A layer in two studies carries two copies, which may differ |
| Per layer, for the whole project | Simplest record; one design per project | No second design without a second project; imported columns need a second place anyway |
| Per layer as current state, each study revision recording a copy of the values it used (recommended by B-6 of [OWNER_DECISIONS_V511](../../development/OWNER_DECISIONS_V511.md), to match S-6) | The roster classifies a row once, where the rows are; a finished study's results never change when a layer is edited, because the revision holds the copy | One design per project for layer-backed samples until a per-study override is added; imported columns still need a per-study place |

**How a large matrix is stored.**

| Option | For | Against |
| --- | --- | --- |
| **Chunked project-owned binary with per-chunk digests (recommended)** | No dependency; the 64 MiB cap stays and no unverified byte is read; a window in file order touches few chunks | A format to own and test; a sorted view's first window may verify every chunk once (decision 6) |
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

- Alignment, linking, gap filling, assembly and statistics have a place to run
  and record that the document can hold for about thirty-seven 300-sample
  passes, and ADR 0050 keeps targeted MS1 as it is.
- While a study run holds its reservation, an edit or a capture that would
  leave the run's records no room, in bytes or in count, is refused
  `oversized` (decision 4).
- A study run holds the project for its whole length, which may be hours: Save
  works, and New, Open, Close and Save As are refused (`analysisRunning`). A
  Stop keeps every completed sample unless the publication itself fails, and
  reuse makes the rerun cover only the rest.
- A crash during a run, or a failed publication after it, loses that run's
  unpublished work from the record. Its staging is left in place and
  uncollected, as today, and a failed publication is recorded as a `failed`
  run with no artifact (decision 5).
- On open, a study artifact's `available` covers its top-level files only; a
  missing per-sample output or chunk is found when it is used (decision 4).
- Per-sample facts are in the payload. A missing or corrupt payload loses
  them, while the document still has the run, its counts and its digests.
- Disk and Save As are measured in gigabytes. Per-sample outputs are the
  largest share: about 2.4 GB for a 300-sample detection artifact and as much
  for gap filling, at about 8 MB a feature map. Every matrix adds about 450 MB
  at 10^5 × 500 **[arith]**. Save As copies all of it. Reuse copies the reused
  outputs into each new artifact, so a rerun after ten samples were added
  copies about 2.4 GB again **[arith]**, unless hard links are chosen (open
  question 6).
- A view verifies each chunk the first time a window touches it and holds it
  open after that. A sorted view's first window may verify the whole matrix.
  A measurement of window latency, sorted and in file order, belongs to the
  first matrix slice.
- If the study slice joins schema 5 after #161 merges, development schema-5
  projects written on either side of the study slice are refused as
  `malformed` by builds on the other side (decision 12). No release writes
  either shape.

## Open questions for the owner

1. **Document model.** Accept study-level runs with a digest-named revision and
   a payload ledger (option a), rather than per-sample runs with pruning or a
   larger document?
2. **Metadata scope.** Per study (recommended), per layer with one design per
   project, or per layer with each revision recording a copy (B-6's
   recommendation)? Answer it together with S-6 of
   [OWNER_DECISIONS_V511](../../development/OWNER_DECISIONS_V511.md), which
   records this conflict.
3. **Matrix format and bounds.** Accept `mscanvas.studyMatrix/1`: chunks of at
   most 8 MiB, binary64 values, 1,000,000 rows, 1,024 columns, 2^27 cells?
4. **Cell states.** Accept the six states, including `undecided` (which also
   carries the engine's discard as a reason) and `imported`, the declared
   reading of an imported zero, and the refusal of non-numeric imported text
   unless it is declared to mean "not detected"?
5. **CSV.** Refuse unknown columns (recommended), or list them and import the
   rest?
6. **Reuse.** Reuse matching per-sample outputs by default, with "run every
   sample" as the choice at review? And copy a reused output (recommended for
   the first build: each artifact stays whole on its own), or hard-link the
   immutable published file on the same volume to save gigabytes?
7. **Long runs.** Is losing an unpublished run to a crash or a failed
   publication acceptable for the first build, with its staging kept but not
   recovered, or should a run publish checkpoints as it goes?
8. **Acquisition-scale derived files.** If a later record needs one: the
   project's payload store, or an MSCanvas-owned cache with a recorded digest?
9. **Schema window and generic words.** Confirm that study records join
   schema 5 if they merge before a release writes it, and otherwise take
   schema 6. And accept one generic study-step plan kind, operation and
   artifact kind, with the recipe named in the plan and parameters in one
   generic shape, so that a later recipe step whose parameters fit it needs no
   schema change (recommended), rather than new words per step, each its own
   schema bump? This departs on purpose from the rule that an unimplemented
   operation is a refusal to open: an unimplemented study recipe is history
   this build shows and does not run (decision 12).
10. **Concurrency.** Who sets the parallel worker count, once per-recipe
    measurements exist: a recorded constant per recipe, or a measured share of
    free memory at the start of each run?
