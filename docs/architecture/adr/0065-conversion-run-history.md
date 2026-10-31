# ADR 0065 — Persistent conversion run history

Status: **Proposed** on 2026-10-30. The owner asked for every backend function
that can be done now to be built, with open details following the
recommendations; this record states them. The Rust side is implemented on
branch `be/run-history`, stacked on `be/integrate`
(`apps/desktop/src-tauri/src/run_history.rs`, fed from
`preview/service/run_recording.rs`). No interface calls it yet, and the
application does not attach the store to the queue, so nothing is recorded in
the product: recording source paths with no list, Clear or Off the user can
reach would break section 7's promise. The interface slice attaches it. The
questions for the owner are listed [at the end](#open-questions-for-the-owner).
Related: [0013](0013-serial-conversion-queue.md) (the serial queue and its
*No persistence*), [0015](0015-user-visible-queue-stop.md) (stop),
[0016](0016-explicit-converted-output-adoption.md) (adoption's object check),
[0017](0017-redacted-conversion-diagnostics-export.md) (the redacted export),
[0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)
(tiers and the "not verified by MSCanvas" label),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md) (capacity
1,024), [0058](0058-user-saved-conversion-presets.md) (the nearest store),
[0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md)
(the application is not single-instance), and ADR 0061, restore workspace
(proposed in PR #177, not on this branch), whose review found the
multi-instance failure this design avoids. RUN-005, RUN-007 and RUN-009 in the
[feature catalog](../../product/FEATURE_CATALOG.md); project runs in the
[M8.1 record](../../product/M8_1_FIRST_CLOSED_LOOP.md).

## Context

RUN-007 (P2): "Runs and artifacts survive restart with interrupted states
represented honestly." It is implemented for project operations only. Their
runs persist in a saved project, and a capture the application did not live to
commit records nothing. Conversion queue runs are session-only. ADR 0013 says
so in its consequences: a queue "does not survive an app restart, and the
converted files are the durable artefact". The conversion slot holds one
queue, replaced by the next, and is explicitly not a history.

Capacity is now 1,024 items (ADR 0057), roughly 17 to 51 hours of serial
conversion. After a restart, or a crash in the middle of such a queue, the user
cannot tell what ran, which files it wrote, under which settings and build, or
that it was cut short.

Three existing rules bound the answer:

- RUN-005: raw stderr is never shown.
- RUN-009: the diagnostics export is explicit and per terminal queue, with "no
  history". This ADR does not change RUN-009, and history carries no backend
  text.
- Section 7.6 of the [after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#76-refused-or-not-adopted)
  keeps retry of a stopped queue, automatic adoption, preview, retry and
  relink, and rerun to replace a damaged result refused. History must not
  become a way around any of them.

MSCanvas is not single-instance. ADR 0061's review found that one document,
read at start and later replaced whole, lets a later writer drop another
process's rows. History is written all the time, from a worker thread, so it
must be append-safe across processes by construction.

## Decisions

### 1. What a run record holds

One run is one queue: its first pass and every retry of it in place.

- **Times:** start, end, and for an interrupted run the time the
  interruption was detected. All are wall-clock milliseconds.
- **Passes:** the first pass plus each retry.
- **Sources:** for each item, every member, primary first, by locator (the
  path) and by the identity admission recorded: byte length, volume serial and
  the 128-bit file ID. Also the family and the display name. A set is
  recorded whole or not at all: where any member's path is not Unicode, no
  member is recorded, as for a row no longer in the workspace.
- **Destination:** the folder each item's outputs were written into.
- **Settings:** the verified row's stable identifier where the settings were
  one, and the canonical structured intent in every case. Per item, whether
  ADR 0055's verified tier held for that family on that build.
- **Build:** the ProteoWizard release the run was bound to, bounded and
  redacted like every backend label. Per item, whether the build is the
  measured one for that family, so no "unverified build" label applies (a
  build with no evidence for the family never runs, so is never recorded).
  The interface's "not verified by MSCanvas" and "unverified build" labels
  follow from these.
- **Outputs:** each output's file name, byte length, SHA-256, and its check
  dispositions (mode, fully verified, verified, unverified, inapplicable,
  advisory). A SCIEX set also records each member's own state, its
  sample-completeness finding by stable identifier (not posed, not
  established with its reason, or established with its method and sample
  count), and whether it could be adopted whole. A fully finalized set that
  could not is a failed item with no failure code, and these say why.
- **Outcomes:** each item's state and attempts, its outcome identifier, and a
  failure by stable code. A failure that ended the whole queue is also
  recorded by its code.

Never recorded:

- backend text of any kind: stdout, stderr, the export's redacted excerpts;
- an error's sentences: a `PreviewErrorDto` contributes only its `kind`;
- process identifiers, staging paths, receipts and adoption tickets.

*Recommendation:* store the canonical structured intent, so a re-run can
reproduce advanced settings. The record holds it as data. A re-run reads it
back only through `read_structured_intent`, the same judge a request and a
saved preset go through (ADR 0058, decision 5). *Alternative:* store only the
row identifier and a flag for advanced settings. That is smaller, but a re-run
of advanced settings would then mean entering them again.

### 2. What is recorded, and when

**Scope.** A run is recorded once a pass has bound a ProteoWizard build. A
queue refused before that ran nothing and leaves no record. Refusals of that
kind are:

- a cancelled picker;
- a refused destination;
- a quarantined backend;
- a build with no evidence for the family.

Project operations follow the same rule: refused before it started, nothing
recorded.

**When it is written.** The record is written at four points:

1. when the pass binds a build, as `running`;
2. when an item starts, before its process is launched, with that item
   `running`;
3. after each item settles;
4. at the terminal transition: `completed`, `stopped` or `stopFailed`.

A refusal that ends a running queue is terminal too, with its code.

**How it is written.**

- Each write happens after the conversion slot's lock is released. No
  workspace, mutation or slot lock is held across filesystem work.
- A write that fails never changes the conversion. The list says that this
  session could not record (`problem`), and nothing else.
- Windows refuses to replace a name another process holds open, which any
  list, read or start in another instance briefly does. A refused replace is
  tried again a few times over about 200 ms. One still refused is owed, as is
  any write while the off switch cannot be read: this session's own list and
  read show the run as it is in memory, and its next write, list or read
  makes the write, also after a later run has begun. Only a session that ends
  while it still owes one leaves the earlier state on disk, which then reads
  as interrupted (section 5).
- A run whose file is gone once it has been written was forgotten, by a
  Clear, an Off or a prune in any instance. It is never written back: its
  next write stops recording it.
- A retry in place reopens the same record: `passes` increases, and it is
  `running` again until it ends. A retry refused before it binds a build
  leaves the ended record as it was.

### 3. Where and how it is stored

- **Location:** `conversion-history/` in the per-user application-local
  directory, under the same binding as the preferences and the presets. That
  gives one path policy and one QA root.
- **One document per run:** `run-<13-digit start ms>-<32 hex>.json`, schema
  version 1, replaced whole through the reviewed `local_document` sequence: a
  private sibling, flushed, then a handle-bound replace. A reader sees the
  previous document or the next one, never a partial one. Names sort oldest
  first.
- **Append-safe across processes:** a session only ever writes the files of
  runs it started. Nothing is read, merged and written back across processes,
  and a list enumerates the directory afresh each time. Another running
  instance therefore cannot drop this one's runs, and one corrupt file costs
  one run rather than the history.
- **Liveness without process identifiers:**
  - Each session creates `owner-<id>.lock` under a name no scan reads, takes
    an exclusive lock on it, and then gives it its scanned name. It holds the
    lock for its whole life, and the operating system releases the lock when
    the process ends, however it ends.
  - Every record names its owner.
  - An owner whose lock cannot be taken is alive. An owner whose lock can be
    taken, or no longer exists, is gone.
  - A reused process identifier cannot make a dead session look alive.
- **Confinement:**
  - The history directory must be a real directory. A link or junction there
    is refused, and the session records nothing.
  - Only names that match a run, owner, set-aside or off-marker pattern
    exactly are ever read, kept aside or removed.

*Alternatives:*

- **One document under a lock file.** Every writer must read, merge and write
  back. That is ADR 0061's failure mode whenever a writer crashes between
  reading and writing, and one damaged byte loses the whole history.
- **A JSON Lines append log.** Two processes appending to one file need
  locking that Windows does not give `O_APPEND`. A torn last line is a normal
  outcome, and pruning means rewriting the file anyway.
- **SQLite.** A new production dependency, which the dependency policy refuses
  without approval. It is not needed at this size.

### 4. Retention and pruning

*Recommendation:*

- **Bounds:** keep the newest 200 runs and at most 64 MiB, whichever bound is
  reached first. One run's document is bounded at 16 MiB.
- **Order:** the runs that ended longest ago go first, by end time. An
  interrupted run counts from when its interruption was detected, and a run
  with neither from its start. A long run that ends last is therefore not the
  first to go because it started first.
- **Runs in progress:** a run still being written, by this or another
  instance, is never pruned.
- **When:** pruning runs at start and after each run ends, once nothing this
  session owes is still unwritten.
- **Oversized runs:** a run whose document, final newline included, would
  exceed 16 MiB is recorded without its items (`itemsOmitted`). Its run-level
  facts are kept, and so are its items' counts (items, finalized, failed, and
  those a retry pass had moved back to pending) and whether every item was
  verified, taken before they were left out, so the list's summary means the
  same, an interrupted run's included. Nothing is truncated. 1,024 single-output
  items with long paths stay well under the bound; SCIEX items of 24 outputs
  each do not. By estimate (about 0.9 KiB per output with its checks, not
  measured on a real set), such a queue passes the bound at about 740 items.
- **Set-aside files** are not counted, and Clear is what reclaims them.
- **Runs this build cannot judge** (a later schema, or unreadable) are neither
  pruned nor counted. A later build bounds its own runs; counting them here
  would let them alone push out every run this build records, the newest
  included. See section 6.

*Alternatives:*

- **By age (for example 30 days).** A month-old run is still one the user may
  want, and age bounds no bytes.
- **By count alone.** Bytes would be unbounded.
- **No pruning.** Disk use would be unbounded.

### 5. Interrupted runs

`interrupted` means the session that ran it ended, or could not write, before
its end was recorded.

**When it is detected.** At every start, the store checks every record still
`running` whose owner is gone:

- It holds that owner's lock while it re-reads the record and rewrites it, so
  a second instance starting at the same moment cannot interleave.
- An owner that finished in the meantime is seen to have finished.
- A list or read reports a gone owner's run as interrupted, its items
  included, even before a start has written that down. It does the same for a
  run of its own session that is not the run being recorded: one whose end
  could not be written, or whose worker left without a terminal answer.
- While recording is off, a gone owner's run is removed instead, by the next
  start or list (section 7).

**What the record then says:**

- The item that was running becomes `interrupted`. Its outcome is unknown: a
  file may or may not exist at its final name, and the interface claims
  neither. An item is written `running` before its process is launched.
- Items still pending become `notRun`, except an item a retry pass had moved
  back to pending. That one failed in an earlier pass and this pass never
  reached it, so it becomes `failed` again, with that failure's code, which
  the record still holds.
- All of this is as of the last write that was made. Where an item's
  pre-launch write was refused and was still owed when the session ended,
  that item reads `notRun` (or `failed`, in a retry pass) although its
  process may have started, and while writes keep failing so may the items
  after it. *Alternative considered:* reading the first pending item of an
  interrupted run as `interrupted`. It covers one owed write only, and it
  would mark an item that never started as interrupted after every crash
  between binding a build and the first launch.
- There is no end time, because when it actually stopped is not known.
  `interruptedAtMs` is the time of detection.

Nothing is resumed, retried or relinked (plan section 7.6). Staging residue
left by a crashed session stays the business of M7.4's guarded staging
recovery ([ADR 0047](0047-first-windows-beta-scope-and-implementation-route.md))
and of G16, cross-session staging ownership, unchanged.

### 6. A corrupt, newer or unreadable run

- **Malformed:** kept aside through a hard link
  (`set-aside-<ms>-<name>`) and taken off its name. A hard link refuses an
  existing name, so nothing is replaced. Every list counts each run kept
  aside as `unreadable`, whether a start or a list found it, until Clear
  removes it.
- **Newer schema:** left exactly where it is and never rewritten. The list
  counts it as `newer`. Neither pruning nor Clear removes it, and pruning does
  not count it: a later build's run may be one its live instance is still
  writing. Off removes it, since any build that honours the switch forgets
  it anyway.
- **Unreadable** (a sharing or permission refusal): skipped and counted,
  treated as a newer one for the same reason.
- **Schema discipline:** every record type refuses unknown fields, and a
  record of this schema version that does not parse is malformed and kept
  aside. So any change to a record's shape must raise `schemaVersion`: an
  older build would otherwise set aside a newer build's run while that build
  is still writing it. Schema 1 has not been released, so its shape is fixed
  when this record is accepted; until then it changes without a new version.

### 7. Privacy

- **Paths stay on this machine.** Locators and identities live only in the
  files.
- **The boundary:** no command takes a path and none returns one. A list
  carries names, states, counts, times, the settings row, the build release
  and stable codes.
- **Nothing leaves the machine.** History has no upload and no telemetry, and
  is not part of the diagnostics export (RUN-009 is unchanged).
- **The off switch** is a marker file, so every running instance honours it.
  Off removes every stored run at once, every instance's run in progress
  included, and no instance records while it is off. An instance whose run
  was removed stops recording it at its next write, whether or not recording
  is on again by then. A write already under way when Off removes the files
  can land just after; the next start or list while it is off removes it. A
  run whose first write never landed has no file to miss, so an Off and an On
  in another instance before that write lands do not stop it. On records
  from the next run onwards.
- **Clear** forgets every ended run and everything kept aside. It keeps runs
  still in progress, so their end or interruption can still be recorded, and
  says how many it kept. A run this build cannot judge counts as one of them,
  since it may be. A retry of a run Clear forgot starts a new run rather
  than writing the old one back.
- **Source data:** neither Clear nor Off touches a source acquisition or an
  output.
- **What they cannot reach:** a write that crashed between creating its
  private sibling and publishing it can leave that sibling
  (`.mscanvas-run-history-*`), which holds a whole record, paths included.
  Neither Clear nor Off removes it, because a sibling another instance is
  writing looks the same; see the consequences.

*Recommendation:* history is on by default, as workspace restore is in ADR
0061. *Alternative:* off until the user turns it on, with a first-run choice.

### 8. What the interface can do with it

These are later slices. Each one needs its own user goal, task path and
rendered QA.

- **List and detail:** every run newest first, then one run's items with
  their outputs, checks and codes.
- **Open output and Show in folder:**
  - Addressed by run, item and output, never by a path from the webview.
  - Allowed only after Rust re-checks that the object at the recorded folder
    and name still has the recorded byte length and SHA-256. That is the same
    object check adoption makes (ADR 0016).
  - A changed or missing output is reported as such and is not opened. Rust
    never falls back to "whatever has that name now".
- **Re-run with the same settings:**
  - Builds a **new queue**. It is never a silent retry and never automatic,
    and it is not a substitute for a terminal queue's own Retry.
  - Each recorded source is re-admitted through ordinary admission, and its
    identity is compared with the record. A changed or missing source is
    reported and is not queued.
  - The settings are re-read through `read_structured_intent` and re-proved
    on the build bound now. A row that was verified may come back labelled,
    and the plan summary says so before Run.
  - The destination is decided again through the ordinary plan, picker or
    policy.
  - It never replaces a recorded or existing output. The ordinary conflict
    policy decides, and nothing is overwritten. A changed or missing output
    is not a reason to re-run over it (plan section 7.6).
  - It is not a retry of a stopped queue, which stays refused.
- **Not offered:**
  - resuming an interrupted run;
  - adopting outputs automatically;
  - relinking a moved source;
  - showing backend text.
- **Out of scope:** adoption history. Section 7.6 gives "surviving queue and
  adoption history" to RUN-007. This record keeps the queue's half only.
  What was adopted into a workspace is left to a later decision.

### 9. The Tauri boundary

Four document-bound commands, registered ahead of their interface and listed
in `AHEAD_OF_THEIR_INTERFACE` in the command-surface test:

| Command | Arguments |
| --- | --- |
| `list_conversion_runs` | none |
| `read_conversion_run` | `runId`, the opaque identifier a list gave; anything else answers `notFound` |
| `clear_conversion_runs` | none |
| `set_conversion_run_history_enabled` | `enabled` |

- Answers are typed outcome enums with camelCase problem identifiers, not
  boundary error codes, so no localized message is added.
- A session with nowhere to keep runs answers `unavailable`.

## Consequences

- RUN-007's conversion half has a Rust side. The interface is a later slice,
  and it is what attaches the store to the queue.
- ADR 0013's *No persistence* still holds for the queue itself: a restart does
  not restore a queue, and nothing can resume one. Its record survives the
  restart.
- **Write volume:**
  - Each item settle rewrites the run's whole document. A 1,024-item queue
    whose document grows to about 1 MiB writes roughly 0.5 GiB over its many
    hours.
  - It is marked in the code as a known ceiling. An append log is the upgrade
    if the volume is ever measured to matter.
- **Start-up cost:** each start reads every run once, which is bounded by
  64 MiB.
- **Residue:**
  - A crashed session's owner lock is removed by the next start.
  - A private sibling of a write that crashed between creating and publishing
    can remain (`.mscanvas-run-history-*`), as it can for the other stores.
  - An owner lock created by a session that crashed before naming it can also
    remain (`.owner-pending-*`).
  - Neither is read by anything.

## Open questions for the owner

1. Is history on by default (recommended), or off until the user turns it on?
2. Does Off also forget what is stored (recommended, as ADR 0061's Off does),
   or does it only stop recording?
3. Are the bounds 200 runs and 64 MiB (recommended), or other numbers?
4. Is the advanced intent stored, so a re-run can reproduce it (recommended),
   or only the verified row's identifier?
5. Does Clear keep runs in progress (recommended), or forget them too?
6. Is the store attached to the queue in the same slice that gives the user
   the list, Clear and Off (recommended), or earlier, recording before the
   user can see or stop it?
