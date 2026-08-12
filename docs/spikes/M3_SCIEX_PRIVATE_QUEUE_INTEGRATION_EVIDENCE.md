# M3.15 private SCIEX serial-queue integration evidence

- **Status:** One SCIEX acquisition runs as one item of the existing serial
  conversion queue, whatever number of documents its backend writes. Private; no
  product surface.
- **Date:** 2026-08-12
- **Decision recorded in:** [ADR 0026](../architecture/adr/0026-private-sciex-serial-queue-integration.md)

## What the queue could not say

One field:

```rust
output_file_name: String,
```

Every queue item had one output whose name was known before the destination
picker opened, and the queue-internal collision rule is built on that. SCIEX
breaks it in the one way that matters: the backend writes one to twenty-four
documents and names them itself, so there is nothing to compare at planning time
and nothing a placeholder could honestly stand for.

The replacement is a named distinction, `KnownSingle` or `BackendNamedSet`, and
the set variant is compiled out of the shipped binary. That is the privacy claim
rather than a consequence of one: no visible surface admits a SCIEX row, so none
can build such an item, and a build without the variant cannot represent one.

## M3.14 evidence repairs

Two, both because M3.14 is the foundation this slice stands on.

**A real partial finalization.** The test named
`a_partially_finalized_conversion_mints_no_ticket` occupied a destination name
*before* the run. The lifecycle preflights the complete name set before
publishing anything, so under `Fail` that is
`RefusedBeforePublication(DestinationOccupied)` with **zero** members published —
the opposite of a partial result. The test is renamed
`a_whole_set_conflict_refuses_before_publication` and now asserts exactly that
outcome instead of merely asserting it was not full.

A real one needs a name taken *between* the preflight that found it free and
that member's rename, which on a filesystem is a race against another process.
The crate already had a publication seam for this at the lifecycle level; it now
reaches the private conversion and the private queue, and
`a_truly_partially_finalized_conversion_mints_no_ticket` proves the whole
policy:

| | |
| --- | --- |
| Typed outcome | `partially_finalized`, with no refusal id |
| Prefix | `["a-S1.mzML"]` finalized and retained |
| Failed member | `a-S2.mzML`, `AlreadyExists` |
| Not published | `a-S2.mzML`, `a-S3.mzML` — validated, never published |
| Completeness | explicitly withdrawn: `source_sample_set_not_fully_published` |
| Ticket | none: `output_set_not_fully_finalized` |
| The prefix afterwards | on disk, byte-identical, after the session is dropped |
| The prefix later | admitted the ordinary way as an ordinary mzML row |
| The racer's file, the bystander | untouched |

The seam changes nothing about the run. It is handed a position — no object, no
handle, no name — so all it can do is act on the world, exactly as another
process could, and the failure is the real no-clobber rename refusing a real
occupied name.

**Direct output-set capacity.** M3.14 inherited this rule: set adoption calls
the same registry the visible path does, and that registry's own tests prove
duplicates are decided before capacity. Inheritance is a good argument and it is
not a measurement — it does not say what the *set* path does when the workspace
fills partway through one ordered adoption.
`an_output_set_fills_the_last_slot_and_refuses_the_rest` measures it: three
members, member 0 already a row, exactly one slot free.

| | |
| --- | --- |
| Outcomes | `already`, `added`, `refused` — in member order |
| Refusal | `workspace_full` |
| The duplicate | returned its existing row, `mzml` |
| Identifiers spent | exactly one, so neither the duplicate nor the refusal spent any |
| Rows after | `MAX_WORKSPACE_DATASETS`, no rollback |
| The acquisition | still one `sciex_wiff` row |
| Repeated | `already`, `already`, `refused`; nothing changes |

## The queue

| Claim | How it is measured |
| --- | --- |
| a private SCIEX item carries no output filename | the DTO's `output_file_name` is empty and contains no part of the acquisition's stem; the visible planner and the visible queue both refuse the row with `dataset_not_convertible` |
| one acquisition is one item | ten declared documents, `item_count` 1, `finalized_count` 1, `current_index` 1 |
| one item is one process | the stand-in's launch counter reads 1 after the run and 1 after two adoptions |
| counts are source counts | `item_count`, `finalized_count`, `skipped_count` all count items |
| the name authority is bounded | sixteen SCIEX rows in one queue: `max_output_names()` is 384, and a set claims nothing before it publishes |
| a mixed queue keeps its order | Thermo → SCIEX(2) → Shimadzu, three launches, four documents |
| never two backends at once | the stand-in's own concurrency high-water mark is **1** |

## Completeness and publication

| Case | Result |
| --- | --- |
| an undeclared member | `multi_output_set_not_as_declared`, zero published, the next item runs |
| `Reader_ABI` per-sample failure | `source_sample_failure_observed`, zero published, the next item runs |
| a truncated error stream | `source_sample_audit_truncated`, zero published |
| a record-free member | `multi_output_member_rejected`, zero published — all before any |
| every name occupied, `Skip` | item `Skipped`, nothing published, the existing files untouched and not called this run's outputs |
| a strict subset occupied, `Skip` | `multi_output_mixed_destination_conflict`, refused whole, the free name stays free |
| a genuine partial publication | `Failed`, non-retryable, prefix kept, no ticket, the next item runs |

## Runtime names, and the collision that is not a conflict

| Case | Result |
| --- | --- |
| a set discovers a name a Thermo item owns, under **`Skip`** | typed `multi_output_output_name_claimed_elsewhere`, the set publishes **none** of its own, the Thermo item finalizes, and `skipped_count` stays 0 |
| two sets discover one name, under **`Skip`** | the first finalizes and its document stays; the second publishes zero and is a typed collision, not a successful skip |
| a known single output whose name an earlier set published | refused before it runs, `queue_output_name_claimed`, not retryable |
| the gate answers with a position, honest or not | the lifecycle reports the member from **its own** list: index 1 → the second member, index 0 → the first, `usize::MAX` → still a refusal, still a real name, still nothing published |

`Skip` is the policy used deliberately in the first two, because it is the one
that would otherwise answer "already converted" about somebody else's output.

## Stop

| Case | Result |
| --- | --- |
| confirmed, mid-set | current item `Cancelled`, the item behind it `NotRun`, one launch, no ticket, nothing published, backend still trusted, queue not retryable |
| unconfirmed, mid-set | `CancellationFailed`, terminal `stopFailed`, backend quarantined, no later process **and no probe** — a later queue is refused with `backend_quarantined` |
| after an earlier set finalized | the finalized item keeps its authority and adopts two members; the current one is `Cancelled` |

The cancelled item reports `partial_output_observed` from the run's own
observation of its staging area, which is the only partial-output claim a run
makes about itself.

## Retry

| Case | Result |
| --- | --- |
| a retryable pre-run refusal | only that item reruns; attempts 2 and 1; exactly one more process |
| a partial publication | `retryable_failed_count` 0, and the queue refuses a retry |
| a completeness refusal | non-retryable |
| a queue-internal name collision | non-retryable |
| a success or a skip | never rerun |
| a retried attempt | names a different run; a fresh conversion names another; a refusal names none and holds no report |
| adopting a queue-held set | the ticket and its settling are read under the gate that claims the action, and the settling is proved again before the commit; another operation or another item answers with nothing |
| a stop landing mid-retry | the set failure is restored as the failure it was, not stranded as never-run; `not_run_count` 0 |
| a queue-level refusal ending the retry | the same, and the failure keeps its place in the counts and its diagnostic |

## Diagnostics and privacy

Six failure classes exported and compared in one test, because what is being
proved is that they are *distinguishable*:

`multi_output_set_not_as_declared`, `source_sample_failure_observed`,
`source_sample_audit_truncated`, `multi_output_member_rejected`,
`multi_output_destination_occupied`, `multi_output_backend_rejected` — each one
item, `sourceKind: "sciex_wiff"`, `state: "failed"`, `outputFileName: null`, and
an `outputSet` member carrying `maxMembers` 24, `boundSourceObjects` 2 and
counts bounded by the lifecycle's own bound.

A partial publication exports `finalizedCount` 1, `notPublishedCount` 2,
`failureKind: "already_exists"` and
`sampleCompleteness: "source_sample_set_not_fully_published"`.

A set item refused *before* the lifecycle — a row that could not be
revalidated, an object somebody else holds — keeps its shape too: `outputSet`
with `maxMembers` 24, zero counts, and `boundSourceObjects` **null**, because
the acquisition was never bound and zero would say it was bound to nothing.
Without that, the schema a reader gets would depend on which layer said no.

A **stopped** set item keeps its shape: `outputSet` with `maxMembers` 24 and
`boundSourceObjects` 2, and zero counts — which is a fact rather than a gap,
because the two cancellation refusals a stop is translated from publish nothing.
The first version of this slice built that ticket exactly as a single-output
stop's, so the document lost the set marker, the member bound and the object
count, and a reader could not tell which kind of item had been stopped.

An ordinary Thermo export is unchanged: `outputFileName: "one.mzML"`, and **no**
`outputSet` member at all.

**The backend's own account survives.** A settled set attempt hands its redacted,
bounded text to the settlement, and the export carries it — the earliest version
of this slice dropped it on every non-cancellation failure, and the test that
was supposed to cover diagnosability checked the classification facts without
ever checking that anything was retained. Both are fixed. The reader's complaint
about the sample it lost reaches the document verbatim, which is the diagnosis.

**Nothing in any export is a path, a companion name or a member basename.** The
acquisition's own display name is there, as `sourceFileName`, exactly as it has
been for every family since this export existed.

A multi-output run's *stdout* is, by construction, a list of the paths it wrote,
so the fail-closed redactor tends to suppress it whole and say so —
`retained: "withheld"`, `suppressed: "residual_absolute_path"`, with the byte
counts still reported. That is the existing rule doing its job rather than
anything added here, and for this family it has a second effect worth naming: a
suppressed stdout is one more thing keeping member basenames out of the
document. A withheld excerpt costs a diagnosis; a *silent* one would cost the
reader the knowledge that there was something to see, and the tests require the
reason and the size either way.

`Debug` was a real gap and is fixed. `WorkspaceMultiOutputConversionReport`,
`MultiOutputMemberFacts` and `PartialFinalization` derived it, so any log that
rendered a group report printed every member basename. They are opaque now —
shape, states and stable identifiers. The reports still carry the names through
accessors, deliberately, for a caller that has decided to look.

The boundary the privacy test pins is where a member stops being a member:
before adoption a basename is the backend's reading of a sample identifier, and
no queue state, report, ticket or export may render one; after adoption it is
the display name of an ordinary workspace row, which the roster carries for
every row the product holds. Redacting it in one rendering while the roster
beside it spells it out would be theatre.

## Real evidence — the ten-sample Enolase acquisition, through the queue

Run through the private *queue*, not the direct-conversion shortcut ADR 0025
measured. Reverified before use against the recorded build: ProteoWizard release
`3.0.26013`, source revision `47b13cfec55265af32055720a6c07b9d5bbed721`,
`msconvert.exe` SHA-256
`9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`. The
acquisition and its companion were reacquired outside the repository and both
recorded digests verified before use.

| | value |
| --- | --- |
| Source bundle members | 2 |
| Queue items | 1 |
| Backend launches | 1 |
| Terminal reason | `completed` |
| Item state / attempts | `finalized` / 1 |
| Item output filename | *(none — the DTO carries no name for a set)* |
| Group outcome | `fully_finalized` |
| Published / retained members | 10 / 10 |
| Bound source objects | 2 |
| Completeness | `reader_error_audit_v1`, `sample_count` 10 |
| Output-set ticket members | 10 |
| Adoption outcomes | 10 × `added` |
| Repeat adoption | 10 × `already` |
| Workspace rows after | **11** — 10 `mzml`, 1 `sciex_wiff` |
| Preview state on any row | none |
| Path-free `Debug` | confirmed on the queue read, the group report and the result |

Measured 2026-08-12 on the evidenced build. Both fixture digests were recomputed
before use and matched the record exactly — the primary `C8BF5E3C…F390EA3` at
2,801,664 bytes and the companion `CE872851…DDFD7350` at 1,143,140 — as did the
executable's, `9BB6F5D5…D590BD`. The companion is spelled `…aqv1.4.2.wiff.scan`
upstream while the primary is `…AQv1.4.2.wiff`; the boundary derives the
companion's name from the primary's, which is the spelling used here.

The ten documents the queue published are the acquisition's ten samples in the
staging directory's deterministic order. That order is not a claim about the
order the samples sit in the acquisition.

## Mutations

Twelve, each removing one load-bearing guard.

| # | Guard removed | Result |
| - | ------------- | ------ |
| 1 | a backend-named set is given a guessed single output name | red |
| 2 | established sample completeness is not required | red |
| 3 | a partially finalized set mints a complete-set ticket | red |
| 4 | **one attempt may keep the attempt before it** | **survived** |
| 5 | **the queue starts the next item after an accepted stop** | **survived** |
| 6 | an unconfirmed termination does not quarantine the backend | red |
| 7 | a partially finalized set is offered as retryable | red |
| 8 | a runtime queue-name collision is left to the conflict policy | red |
| 9 | a set's diagnostic payload carries its member names | red |
| 10 | **a superseded output-set adoption may commit** | **survived** |
| 11 | an item that ran is stranded as never-run by a stop mid-retry | red |
| 12 | two backend processes may run at once | red |

Mutation 11 was added after a review found the hole it guards, and it survived
the first test written for it: the stop landed while the *set* item was running,
so it settled as cancelled and the restoration path was never asked. The test
now aims the stop at an earlier item, leaving the set item pending with its
result in nothing but its group report — which is the state the guard is for.

### The survivors, classified

**4 — equivalent under the current retry classification.** The mutation makes
the settling transition keep a previous set attempt's run identity and authority
instead of replacing them. No item can reach that state: every set outcome that
produces a report is non-retryable, so an item never settles a set attempt
twice, and the conditional and unconditional forms agree everywhere reachable.
The guard is there so a future retryable set class inherits the right behaviour
rather than the wrong one.

Classifying it found a real defect, which is recorded rather than quietly fixed:
the `Refused` and `Stopped` arms cleared the single-output report but **not** the
group report or the run identity, so a later attempt that never reached a
conversion would still have carried the set attempt before it. Fixed, the rule
is now uniform across all four settling arms, and
`a_retried_set_attempt_reuses_no_identity_or_ticket` covers both directions.

**5 — structurally unreachable in a single-threaded suite.** `start_item`
refuses once a stop has been accepted. The worker asks the same question before
every item, so every instance a single-threaded test can produce is already
refused there; what this guard uniquely covers is a stop landing between the
worker's check and this transition, which requires a second thread to interleave
inside one lock acquisition. Removing it does not make any deterministic test
fail, and adding a test that usually wins that race would be worse than an
honest gap.

**10 — the M3.14 survivor, unchanged and recorded again.** The generation is
checked once per candidate and once more before the commit; the final check
guards a window one file hash wide that a single-threaded suite cannot move the
workspace inside. Same guard, same lifted code, same honest gap.

## Product reachability

Unchanged and none. `BackendNamedSet`, `QueueAdoptionAuthority::Set`,
`ItemOutcome::ReportedSet`, the runtime name authority, the private queue
admission and the private terminal adoption are all compiled out of the shipped
binary. `no_product_surface_reaches_the_private_sciex_queue` reads the command
surface and asserts that none of their names, and no spelling of "sciex",
appears in it. No Tauri command, no DTO change, no frontend change, no visible
queue row, no adoption UI, no direct vendor preview, no automatic adoption, no
automatic preview.

## Cleanup

The acquisition, its companion, every converted output and every scratch
directory were deleted after measurement. No vendor data is tracked and no local
path appears in this record.
