# M9.4 record — a controlled batch of independent targeted MS1 analyses

Status: **M9.4 LOCAL CONTROLLED BATCH COMPLETE — INDEPENDENT MULTI-ACQUISITION
TARGETED-MS1 EXECUTION.** Date: 2026-09-24. Branch
`feat/m9.4-targeted-ms1-batch-execution`, from the M9.3 endpoint
`3d6300f1bae8766c6708c0fabf3bd1cdb7a23fa3` (tested M9.3 code `c69889b`).
Decision: [ADR 0050](../architecture/adr/0050-sequential-batch-of-independent-targeted-plans.md).
Evidence: [M9.4 evidence](../spikes/M9_4_TARGETED_MS1_BATCH_EVIDENCE.md).
Builds on the [M9.1](M9_1_TARGETED_MS1_HANDOFF.md#m91-record),
[M9.2](M9_2_TARGETED_MS1_RESULT_REUSE.md) and
[M9.3](M9_3_TARGETED_MS1_EXECUTION_SNAPSHOT.md) records.

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9
CLOSURE NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE ·
PROTEOWIZARD HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC
BETA NOT RELEASED; M10 NOT STARTED

Update: the [M9 closure](M9_CLOSURE.md) has since closed M9 locally and states
the current contract. With short ASCII labels it measured a 16-member batch
of 200 targets at about 0.84 MiB of document, not the 0.5–0.65 MB estimated
under *Known limits* below: four such batches fit in one project, and fewer
with long or non-ASCII labels (§8 of the closure).

## Scope

M9.4 lets one reviewed action run the same targeted MS1 request over several
explicitly chosen acquisitions, one after another. It is an orchestration
convenience: every acquisition still gets its own plan, run, attempt, result
and stored payload, exactly as a single run over it would. It is not a pooled
or comparative analysis, and nothing in it relates one acquisition's findings
to another's. Not in scope and not done: normalization or any
cross-acquisition comparison, alignment, cross-acquisition missing-value
handling, sample groups or replicates, a merged table or matrix, heatmaps,
PCA, batch-effect correction, a multi-file engine invocation, a second recipe,
concurrency, crash resume, a batch export, scratch-cleanup tools, payload
`.staging` collection, and M9 closure.

## What a user can do

In a saved project, from **Targeted MS1…** on any layer row:

1. **Choose acquisitions.** The setup lists the project's layers, the one that
   opened it already chosen. Choosing one keeps the M9.1 single run; choosing
   2–16 makes the review a batch review. Nothing is chosen for the user beyond
   the layer they started from.
2. **Review the batch.** One request — the targets, one per line, and the two
   parameters — is resolved once. The review shows the targets and parameters
   once, the target list's SHA-256 (the same in every member's plan), and
   *N independent analyses*: each acquisition is its own plan, run and stored
   result; nothing is pooled, normalized, ranked or compared across
   acquisitions; and sharing a target list does not make their values
   comparable. Then every member in the project's order, **Ready** or saying
   in the refusal's own words what stops it — not one mzML file, no room for
   its copy in the work area, a project not saved yet, a quarantined session.
   Each member's plan digest and expected bytes are under **Each
   acquisition's plan**.
3. **Run N analyses** is offered only when every member is ready. Otherwise
   the user unticks a member or resolves what stops it, and reviews again.
4. **Follow the batch.** The batch panel lists every member's execution state
   — queued, running with its phase, completed, failed with its failure's
   sentence, cancelled, not run with its refusal's sentence, not started —
   and counts them (*1 of 3 completed · 1 failed · 1 not run*). The busy line
   says which acquisition is running (*acquisition 2 of 3*).
5. **Stop batch** — in the panel, and as the busy line's cancel — ends the
   acquisition running as an ordinary cancelled run and starts no later one.
   Completed results stay.
6. Once the batch has ended, **Open result** on a completed member opens its
   own result in the M9.2 report, and **Show run** on any other member that
   ran shows its run in Details. Nothing is opened when the batch ends.
7. **Save, reopen, Save As** keep every member's plan, run and result as
   ordinary history. Reopening resumes nothing.

## Rules

| Rule | Where |
| --- | --- |
| One request resolved once; each member's plan re-bound to its own layer, reference and recorded bytes, and named by its own digest | `project/recipe.rs` `bind`; `project/mod.rs` `resolve_targeted_ms1_batch` |
| 2–16 layers; a repeated reference refused, never deduplicated; a layer not in the project refused | `resolve_targeted_ms1_batch` |
| A batch is held for a run only when every member has a plan; a batch run must name exactly the batch reviewed, in order | `pending_plans`; `run_targeted_ms1_batch` |
| Each member runs the plan frozen when its batch was accepted; a review made meanwhile changes nothing the batch runs; a frozen plan is re-checked against the project at its turn | `PlanChoice::Frozen`; `prepare_run` |
| One exclusive job for the whole batch; members run in order in one loop through the single run's own body | `run_targeted_ms1_batch`, `run_plan`, `prepare_run` |
| Each member is preflighted again at its turn, including the room for its copy; room is never summed across members | `prepare_run` → `RecipeExecutor::preflight` |
| A member's content is checked against its plan when its attempt starts; a source changed since review fails `sourceChanged` and is never re-planned | the M9.1–M9.3 attempt, unchanged |
| The stop is looked at under the lock that marks the next member running; never-started members get no run | `run_targeted_ms1_batch` |
| A quarantine, a moved project or a full history keeps every later member out | `run_targeted_ms1_batch` |
| Progress (members and the running member's phase) is session-only | `AcceptedJob::batch`; `get_targeted_ms1_progress` |

## Records

No schema change. A batch persists nothing of its own: each member that ran is
an ordinary `targetedMs1V1` run over its own layer, with its own plan in
`plans`, and a completed one produces its own `targetedMs1ResultV1` artifact
and payload directory. New session-only wire shapes: the batch review
(`resolve_targeted_ms1_batch`), the batch answer (`run_targeted_ms1_batch`),
and the optional `batch` field of the progress answer. Two new refusal
identifiers: `batchSizeOutOfRange`, `batchDuplicateInput`.

Schema 4 remains unpublished development state. As recorded for M9.3, the
latest schema-4 documents may carry words an M9.1 or M9.2 build refuses; M9.4
adds none.

## Known limits

- **Development runtime only**, as in M9.1: a release build has no runtime and
  every review answers `recipeUnavailable`.
- **One control.** Stop ends the running member and every later one. There is
  no "skip this acquisition and continue".
- **Session-only batch state.** Which members a batch had, and which it never
  started, is known only until the session ends; the history shows only the
  members that ran.
- **Refused at their turn, silently for the history.** A member refused
  before its attempt (for example, the work area filled up since review) is
  said on the batch panel and records nothing.
- **Review can be stale.** Readiness is an observation at review, not a
  reservation; every member is checked again when its turn comes.
- **Stored target lists.** Each member's plan stores the target list inline,
  as every plan does: a 16-member batch of 200 targets adds roughly 0.5–0.65
  MB of plans to a document limited to 4 MiB, so a few such batches fill a
  project's history (`oversized`, after which no later member starts).
- **A single run after a batch review** may name any member's plan, each of
  which was reviewed; the interface offers only the batch's own Run.
- **Nothing to open until the batch ends.** While a batch runs, the project on
  screen is the one it started from, so a finished member's result and run are
  offered, and a failed member's reason said, once the batch has ended; until
  then a failed member reads *Failed*.
- **Only the batch in its own setup.** Closing the setup after a batch hides
  its panel; the members' runs remain in the history.
- **Unchanged M9.1–M9.3 limits** apply to each member: positive-mode
  centroided MS1, `[M+H]+`, at most 200 targets, the 10-minute budget per
  member, no filesystem or network confinement, and the M9.3.C1 retained-link
  and scratch rules.
