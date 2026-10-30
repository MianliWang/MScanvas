# ADR 0057 — Conversion capacity and viewing during conversion

Status: **Accepted** by the owner on 2026-10-29. Nothing here is implemented
yet. Until the slices below land, `MAX_CONVERSION_QUEUE_ITEMS` stays 16,
conversion stays serial, and every preview read stays refused with
`conversion_busy` while a conversion runs.
Related: [0005](0005-mzml-preview-boundary.md),
[0006](0006-multi-dataset-workspace-boundary.md),
[0012](0012-first-visible-thermo-conversion.md),
[0013](0013-serial-conversion-queue.md),
[0014](0014-proteowizard-cancellation-evidence.md),
[0015](0015-user-visible-queue-stop.md),
[0016](0016-explicit-converted-output-adoption.md),
[0017](0017-redacted-conversion-diagnostics-export.md),
[0043](0043-conversion-completion-route.md) (CNV-D6),
[0044](0044-conversion-configuration-authority.md),
[0047](0047-first-windows-beta-scope-and-implementation-route.md),
[0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md).

## Context

Three rules from before beta 1 shape what a user with many acquisitions can
do:

- **Nothing can be viewed during a conversion.** A queue takes the backend gate
  before its first item and holds it until it is terminal (ADR 0013). While it
  runs, opening a preview and loading a spectrum both answer `conversion_busy`
  (ADR 0012).
- **A queue holds at most 16 items** (`MAX_CONVERSION_QUEUE_ITEMS`, ADR 0013).
  M6.8 re-decided that number and kept it (ADR 0043, CNV-D6). A roster holds up
  to 1,024 rows (`MAX_WORKSPACE_DATASETS`, ADR 0006), so a checked roster of 40
  rows needs three queues, each started by hand.
- **One lane.** ADR 0013 refused parallel conversion because "two `msconvert`
  processes on one machine is a measurement nobody here has taken".

The [after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#76-refused-or-not-adopted)
listed a capacity above 16 ("needs a stated basis") and parallel conversion
("need a measured need") as reversible, not selected.

ADR 0056 moves the spectrum table and the selected spectra of mzML into the
process. It kept every read under the backend gate, and left viewing during a
conversion to a follow-up decision (its decision 3). This ADR is that follow-up
for selected spectra, and it records the owner's capacity and parallelism
decisions of 2026-10-29.

## Decisions

### 1. An open preview's spectra may be read during a conversion

Once ADR 0056's slice 2 ships the native path, a selected spectrum of a
preview that is already open is read natively while a conversion runs. Until
then a selected spectrum is an `msaccess` process, and it stays refused with
`conversion_busy`.

**What changes:**

- `load_spectrum` no longer answers `conversion_busy` for a dataset whose
  native preview state is retained (ADR 0056, decision 4). The webview's
  spectrum selection changes in the same change, so the two layers never
  disagree about whether a read is admitted.
- A native selected-spectrum read does not take the backend gate, which the
  queue holds until it is terminal. It is serialized by a native-read lane of
  its own:
  - at most one native read runs at a time, as today;
  - supersession is checked after the wait, as ADR 0006 requires of a backend
    read;
  - an open's native table pass takes that lane after the backend gate, never
    in the other order, so the two cannot deadlock.

**What does not change:**

- **Admission otherwise.** `require_usable_backend` and its quarantine, and
  ADR 0044's `backendUsable`, still gate every read, native or not. Viewing
  without a usable backend is a separate decision (ADR 0056, decision 3).
- **One backend process at a time** (ADR 0005, ADR 0006). A native read is not
  a process.
- **A read needs its open.** Without retained preview state a selected spectrum
  is refused with a request to reopen (ADR 0056, decision 4). Removing the
  previewed row during a conversion, which ADR 0012 allows for every row but
  the converting one, drops that state, and a later read is refused.
- **Generation checks.** A selected spectrum is still checked against the file
  generation its open recorded.

### 2. Opening a new preview during a conversion stays refused

`open_preview` keeps answering `conversion_busy` while a conversion awaits a
destination or runs. An open runs `msaccess` twice, for metadata and the run
summary (ADR 0056, decision 3), and that would be a second backend process
beside `msconvert`.

It waits for one of:

- a decision that moves or drops the open's metadata and run summary, ADR
  0056 decision 3's follow-up, after which an open runs no process;
- a measurement of `msaccess` beside `msconvert` under a bounded release of the
  ProteoWizard hold, and an amendment of ADR 0005's one-process rule.

The roster mutations ADR 0012 refuses during a conversion stay refused.

*2026-10-30 ([ADR 0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md),
slice 2):* a one-click view conversion is a conversion for decisions 1 and 2
and for the safety argument below. It holds the conversion slot, so opens and
spectrum loads are refused while it runs, with `raw_view_busy`. Under
"Staging ownership", "A native read opens only a roster row's own file" gains
one exception: the pinned entry of a ready view operation, which is published
and verified, never a staging directory.

### 3. Queue capacity rises from 16 to 1,024

`MAX_CONVERSION_QUEUE_ITEMS` becomes 1,024, equal to `MAX_WORKSPACE_DATASETS`,
so one checked roster converts as one queue. The bound stays locked (CNV-D6):
Rust enforces it, reports it as the plan's `capacity`, and refuses with
`queue_too_large`, and no frontend constant restates it.

**The stated basis:**

- **The bound is structural.** A queue is built from roster rows, and the
  roster holds at most 1,024. A smaller bound made the user split one batch
  into several queues by hand, each with its own destination prompt and Run,
  and protected nothing the stop controls do not.
- **A wrong size no longer has to be waited out.** A queue can be stopped
  whole, by the item converting, or by a waiting item, at any point (ADR
  0015). M6.8 named this as the change in what a wrong size costs.
- **It is a judgement, not a machine fact,** as 16 was. Items stay serial: at
  ADR 0013's one to three minutes per acquisition, 1,024 items take roughly
  17 to 51 hours. A queue does not survive an application restart (ADR 0013),
  so keeping the application open for that long is the user's choice. ADR
  0013's "select everything and convert is refused by a rule" is reversed
  deliberately.
- Nothing measures memory or throughput against queue length, and this number
  does not claim otherwise.

**What the raise depends on.** The constant changes in the slice that does
these, and not before:

- **Windowed conversion lists.** Every list that shows queue items is windowed:
  the queue panel, the plan summary, results, adoption, and the collision and
  refusal lists. Rendered QA at 960x640 with a 1,024-item fixture.
- **The diagnostics export bound.** ADR 0017 sets `MAX_DIAGNOSTIC_ITEMS` to the
  queue capacity and bounds the whole document at 2 MiB. Each item may retain
  two 32 KiB stream excerpts, so the worst case grows from about 1 MiB of
  excerpts at 16 items to about 64 MiB at 1,024. The slice re-decides the
  export bound with a stated rule. It may not truncate the document: ADR
  0017's refusal of half a document stands.
- **Retained per-item state, stated from the constants:**
  - each item keeps at most one diagnostic, so up to about 64 MiB of excerpts
    across a queue;
  - each finalized item keeps one adoption ticket, holding one handle per
    output (ADR 0016);
  - claimed output names and retained handles reach 1,024 ×
    `MAX_CONVERSION_OUTPUTS_PER_SOURCE` (24) = 24,576, where 16 items gave 384.

  The slice states these in code, as `ConversionQueue::max_output_names`
  already does, and checks with the fake provider that the name-collision check
  stays fast at that size.
- **The slot read.** The conversion state is read whole on every update. The
  slice either keeps one read and records its size at 1,024 items, or windows
  it on the wire. Either way every list stays bounded in count.
- **Adoption.** Adoption still adds rows to a roster bounded at 1,024.
  Adopting the outputs of a full roster's conversion is refused with the
  existing `workspace_full` until rows are removed, and per-output adoption
  (ADR 0052) meets the same bound.

### 4. Parallel conversion waits for a measurement

Conversion stays serial: one `msconvert` at a time, under the backend gate the
queue holds. This ADR does not decide parallel conversion. It waits for a
throughput measurement under a bounded release of the ProteoWizard hold,
planned for week 2 after publication:

- one, two and four concurrent conversions of one set of real acquisitions the
  owner authorizes, on the owner's machine;
- wall time, CPU, peak memory and disk throughput for each;
- whether each output equals its serial counterpart, apart from the fields the
  beta-1 U4 check found to vary (source path, the index offsets it shifts, and
  checksum);
- whether `msconvert` reads a source while another reader holds it (decision
  1's shared source, below).

Parallel conversion is then its own amendment of this ADR and of ADR 0005, and
it must keep everything in "What parallel conversion must keep" below.

## Safety argument

These decisions change what may run beside a conversion and how many items a
queue holds. None of them changes what a conversion owns, how it ends, or what
it writes.

- **Process ownership.** The only processes are the queue's: one `msconvert`
  tree per attempt, in its own Job Object, with one request-only cancellation
  handle bound to its operation, item and attempt (ADR 0014, ADR 0015). A
  native read spawns nothing and holds no process handle. Capacity changes how
  many items wait, not how many trees exist.
- **Cancellation.** Stopping the queue, the converting item or a waiting item
  is unchanged, and never waits on a native read, which takes neither the
  conversion slot nor the backend gate. Stopping a queue of 1,024 marks every
  item it had not reached `notRun`, as it does for 16.
- **Quarantine.** An unconfirmed termination still quarantines the backend for
  the session (ADR 0015). Quarantine still refuses every read, native ones
  included (decision 1). A read already under way when quarantine starts
  completes or is superseded, and does not delay the queue's terminal state.
- **Staging ownership.** Each item writes only into its own private staging
  directory, which identity-bound cleanup removes (ADR 0014). A native read
  opens only a roster row's own file, under the identity it was admitted with,
  and never a staging directory or the destination. An output reaches the
  roster only through explicit adoption of a finalized object (ADR 0016), so no
  preview reads an unfinalized output.
- **No overwrite.** Fail and Skip stay the only conflict policies, and
  `OVERWRITE_REFUSED` stands. Two items that would write one name are refused
  at planning (`queue_output_name_collision`), at any capacity. A conversion
  therefore cannot replace the file an open preview reads, and a replacement by
  anything else fails the generation check.
- **Stale-plan refusal.** Unchanged. A plan is bound to its receipt, and a plan
  that is no longer current is refused (ADR 0044, decisions 9 and 10). A native
  read changes no roster row, configuration or binding, so it cannot make a
  bound plan stale or keep a stale one current. A plan of 1,024 items is
  planned twice and bound on the second plan, as a plan of 16 is.
- **A source read and converted at once.** An mzML row can be a conversion
  source (ADR 0055), so its spectra may be read while it converts. Both reads
  are read-only:
  - the row's identity lease already coexists with the provider's read of the
    same file today;
  - the native read must open with read sharing and hold no handle between
    reads (ADR 0056, decision 4);
  - whether `msconvert` would refuse to open a file another reader holds is not
    measured. If it did, that item would fail with the provider's own error.
    Decision 4's measurement covers it; until then that failure is a stated
    risk.

**What parallel conversion must keep:**

- one Job Object and one cancellation handle per running item;
- a queue stop that ends and confirms every running tree;
- one unconfirmed termination quarantining the backend for every item;
- private staging per item;
- name collisions refused at planning across the whole queue, not only among
  running items;
- Fail and Skip decided at finalization, against a revalidated destination;
- ADR 0005's one-process rule amended by name, with the gate replaced by a
  stated bound on concurrent processes.

## Consequences

- Once ADR 0056's slice 2 ships, a user can look through an open preview's
  spectra while a queue runs.
- A whole checked roster converts as one queue, with one destination and one
  Run.
- Nothing gets faster: a queue of 1,024 is as serial as a queue of 16.

**Risks:**

- **A very long queue is easy to start.** The plan states the count before
  Run, and stopping is available at any point.
- **The open stays refused.** A user who wants to look at another file during a
  conversion must wait or stop the queue (decision 2).
- **A source read during its own conversion** is not measured (safety
  argument, above).

## What this amends

**Now, by dated notes:**

- [ADR 0005](0005-mzml-preview-boundary.md): the one-backend-process rule.
- [ADR 0056](0056-project-owned-mzml-reader-for-viewing.md), decision 3: its
  exclusion of viewing during a conversion, for selected spectra of an open
  preview.
- [The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), sections 2
  and 7.6.

**In the change that implements each decision,** as ADR 0055's build-gate
decision did:

- ADR 0012, "Rust enforces the concurrency rules" and "What the ordering rules
  ended up making unreachable": loading a spectrum of an open preview leaves the
  `conversion_busy` list (decision 1).
- ADR 0013, "The bound is sixteen" and its open gate "No parallelism"; ADR
  0016's "bounded by the queue's existing sixteen items"; ADR 0017's bounds;
  ADR 0043's CNV-D6; ADR 0047's "currently sixteen serial items"; the feature
  catalog's queue rows; the primary workflows' "more than 16 items"; the doc
  comment on `MAX_CONVERSION_QUEUE_ITEMS` and the test that pins 16
  (decision 3).
- ADR 0056, decision 3 and its ADR 0005 entry: the backend gate no longer
  serializes native selected-spectrum reads (decision 1).
