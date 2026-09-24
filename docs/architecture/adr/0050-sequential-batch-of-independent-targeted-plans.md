# ADR 0050 — A sequential batch of independent targeted MS1 plans

Status: **accepted locally for M9.4; unpublished.** Date: 2026-09-24.
Builds on the [M9.1 record](../../product/M9_1_TARGETED_MS1_HANDOFF.md#m91-record)
(plan, run, attempt, result and the exclusive run),
[ADR 0048](0048-stored-targeted-result-reuse-and-export.md) (a stored result is
read without running anything) and
[ADR 0049](0049-content-bound-execution-snapshot.md) (the execution view and
attempt scratch). Record:
[M9.4 batch](../../product/M9_4_TARGETED_MS1_BATCH.md).

## Context

Until M9.4 a targeted MS1 lookup ran over one explicitly chosen layer at a
time. A user with several acquisitions and one target list had to open the
setup, retype or paste the same text, review and run once per acquisition.

What a batch must not become is a new scientific operation. The same target
list over several acquisitions invites pooling, normalization, ranking and
comparison; none of them is designed or validated here, and the engine's
intensities are not comparable across runs even of one acquisition (M9.0).
The batch is an orchestration convenience over the analysis M9.1–M9.3 already
built, and every acquisition must end with exactly the plan, run, attempt,
result and payload a single run over it would have produced.

## Decisions

### 1. One request, one plan per acquisition

A batch review names 2–16 layers and one request (the typed targets and two
parameters). The request is resolved **once**, by the M9.1 resolver, against
the first layer; every member's plan is then that plan re-bound
(`recipe::bind`) to the member's own layer, its own reference and the bytes
that reference recorded, and named by its own digest.

So every member's plan carries the same ordered targets under the same target
identifiers, the same parameters and recipe binding, and the same target-list
digest — which is what "one target list" means and what the review shows
once. And every member's plan digest differs, because it covers the layer,
the reference and the expected content: two acquisitions holding identical
bytes are still two plans, two runs and two results. Target identifiers are
unique within a plan (the document's rule) and were never unique across plans.

No member's plan says anything about another member's source. No algorithm
invocation is given more than one acquisition: each attempt is given one plan
and that plan's one source, exactly as a single run is.

### 2. A review holds a batch only when every member has a plan

A member whose source is not one mzML file is refused at review
(`recipeSourceUnsupported`) and listed, never dropped. Where any member is
refused, nothing of that review is held for a run: the batch cannot start with
a member scientifically unspecified. A member whose plan exists but could not
run now says why (`blocked`, from the same preflight a single review asks);
the interface offers no run until every member is ready. Rust does not refuse
a batch run for a member blocked at review — each member's preflight is asked
again at its turn, as a single run's is.

A repeated reference in one request is refused (`batchDuplicateInput`), never
deduplicated; fewer than 2 or more than 16 layers is `batchSizeOutOfRange`. 16
is a product guard for this first build, not a scientific limit.

The plans last resolved for review are session state (`pending_plans`): one
for a single review, every member's in order for a batch. A single review
replaces a batch and the reverse. A batch run must name exactly the batch
reviewed, in its order (`planNotCurrent` otherwise), and it **freezes** those
plans as it is accepted: each member runs the plan it was accepted with,
whatever is reviewed while the batch runs (a review is not held off by a run
in progress). A frozen plan is checked at its member's turn against the
project as it is then — its layer, its reference, the bytes that reference
recorded, the recipe — exactly as a plan named by digest is. A single run
still names its plan by digest; after a batch review, that may be any
member's plan, each of which was reviewed.

### 3. One exclusive job, one loop, one member at a time

A batch runs as **one** accepted project job, exclusive for the whole batch as
one run's job is for one run: New, Open, Close, Save As, and removing or
re-pointing what a run names are refused (`analysisRunning`) from the first
member to the last; Save is not. The job's identifier is the batch's only
orchestration identity — for progress and for the Stop. There is no batch
identifier, and no batch entity in the document.

The members run in order in one loop on one thread, each through `run_plan`,
the body of the single run extracted unchanged: preflight, attempt, commit,
publication. The single run is now that same function inside its own job, and
still releases its job under the lock its run was recorded under. A member's
attempt has ended — its worker observed gone, or the session quarantined —
before the loop looks at the next member, so no two workers of a batch can
overlap. Concurrency is not configurable.

### 4. What stops later members, and what does not

Each member's end is its own:

| A member … | Its record | Later members |
| --- | --- | --- |
| completes | an ordinary completed run and its own result, published through its own payload transaction | run |
| fails (`sourceChanged`, a malformed source, a timeout, …) | an ordinary failed run, its code and stage | run |
| is refused before its attempt (for example, its copy no longer fits the work area, or its plan is no longer current) | none: a refusal before an attempt records nothing, as for a single run | run |
| is running when the batch is stopped | an ordinary cancelled run with its stop facts (or cancelled before launch, where the stop reached it before its worker) | none starts |
| leaves the session quarantined (`workerNotAccountedFor`) | an ordinary failed run | none starts (`analysisQuarantined`) |
| cannot be recorded because the project moved or its history is full (`staleDocument`, `noOpenProject`, `oversized`) | none | none starts |

A timeout is its member's failure, never a stop of the batch. Nothing rolls
back a completed member because a later one failed.

### 5. One Stop

The batch offers one control: **Stop batch**, which cancels the batch's one
operation. The stop is looked at under the same lock that marks the next
member running, so a member never marked is never started and gets no run,
and a member already marked meets the stop exactly as a single run meets a
cancel — including M9.1's rule that a cancel reaching the commit before it
stops the publication. A cancel naming an earlier batch's operation is
`stale` or `noActiveOperation` and changes nothing; every batch has its own
cancellation state.

A separate "cancel current, continue with the next" is not offered: two
controls over one operation would each have to say what the other does, and
the first build needs neither.

### 6. Nothing about a batch persists

Batch membership and member states live in the accepted job and in the answer
the batch command returns. What a batch leaves in the project is its members'
ordinary plans, runs and results, each with its own lineage: the run consumed
its own layer and produced its own result. Saving persists them as any run is
persisted; reopening shows them as history and resumes nothing; Save As copies
each available payload as before. Schema 4 does not change.

### 7. The interface shows execution, not findings

The setup lists the project's layers with the one that opened it chosen;
choosing two or more makes the review a batch review: the shared request once,
a statement of what the batch is and is not, and every member in the
project's order with its readiness. While it runs, and after, the batch panel
shows each member's execution state — queued, running with its phase,
completed, failed with its code's sentence, cancelled, not run with the
refusal's sentence, or not started — and counts them. A completed member opens
its own result in the M9.2 report; nothing is opened on arrival, and no view
shows two members' results together.

## Alternatives rejected

- **A durable batch entity or a batch identifier in the document.** Nothing a
  user reopens needs one: every member's history is already complete on its
  own, and a batch record would be a second account of the same runs, and a
  schema change for transient progress.
- **The interface loops over single runs.** Queue state would live in the
  webview, the project would be free to move between members, and a reload
  would silently abandon the queue. Rust owns queue state.
- **Several workers at once.** Multiplied runtime memory, contention for the
  work area's copies, and a cancel whose meaning depends on timing.
- **Summing every member's size for the capacity check at review.** Members
  run one at a time, and each copy is removed with its attempt: the space one
  member needs is checked for that member, at review and again at its turn.
- **Minting target identifiers per member.** Each plan would still be
  independent, but "the same target list" would stop being one identity a
  reader can check across the members' plans.

## Consequences

- Several independent results can be produced by one reviewed action; each is
  exported through M9.2 on its own. There is no merged table, matrix or
  cross-acquisition export.
- A batch stopped or halted leaves the members it never started without runs,
  and says so in the session only; a restart forgets which members a batch
  had.
- Every member's plan stores its target list inline, as every plan does, so a
  batch of N members stores the list N times: at about 160–200 bytes per
  target, a 16-member batch of 200 targets adds roughly 0.5–0.65 MB of plans to
  a document limited to 4 MiB. When history is full, the member that meets it
  is refused `oversized` and no later member starts.
