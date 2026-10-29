# ADR 0051 — Folder and drop propose the admitted single-file vendor families

- Status: Accepted. The owner selected this feature on 2026-10-28
  ([after-beta-1 plan, section 6.1](../../development/AFTER_BETA1_PLAN.md#61-folder-and-drop-propose-admitted-vendor-files-wsp-002003-adr-0051)).
  `Add folder…` and the Explorer drop add Thermo RAW and Shimadzu LCD files
  beside mzML; SCIEX WIFF stays picker-only. The Rust side is in place; the
  commands that expose progress and Stop are wired with their frontend
- Date: 2026-10-29
- Amends: [ADR 0012](0012-first-visible-thermo-conversion.md) and
  [ADR 0020](0020-first-visible-shimadzu-lcd-workflow.md) (their
  "folder ingestion and the Explorer drop stay regular-mzML-only"),
  [ADR 0007](0007-logical-acquisition-discovery-and-folder-traversal.md)
  ("the budgets are what bound the worst case", and "no cancellation, no
  percentage") and [ADR 0008](0008-windows-explorer-drag-and-drop.md) (regular
  mzML only). [ADR 0027](0027-first-visible-sciex-wiff-workflow.md)'s SCIEX
  walking-surface rule is kept.

## Context

ADR 0012 widened `Add files…` to Thermo RAW and kept the walking surfaces
mzML-only: "both walk a tree the user did not enumerate, and admitting a vendor
family from a walk is a wider claim than admitting one the user named". ADR
0020 did the same for Shimadzu LCD and ADR 0027 for SCIEX. A user with a folder
of RAW files had to pick them one dialog at a time, and a dropped RAW file was
refused as "not mzML" while the picker beside it took the same file.

The claim a walk was not allowed to make is recognition from a name. It never
needed to: the picker's own routing already treats the extension as a choice
of *which admission runs*, and the admission decides by the bytes. A walk that
proposes by name and admits by the same family rule makes no wider claim than
the picker. What a walk adds is cost and scale: a vendor admission reads and
hashes the whole file, up to 1,024 of them, through a handle that refuses
writers.

## Decision

### What is proposed

One predicate, `has_proposable_extension`, in `selection.rs`: the union of the
mzML check and the Thermo and Shimadzu routing predicates. Folder discovery
uses it in place of the mzML check. A directly dropped regular file is a
candidate whatever its name, as before.

- **Proposed:** `.mzML`, `.raw` and `.lcd`, in any letter case.
- **Never proposed:** directories (directory acquisitions stay unrecognized,
  ADR 0007), `.wiff`, `.wiff.scan` and `.wiff2`.
- **SCIEX stays picker-only.** A SCIEX acquisition is two objects, and the
  companion's name is derived from the `.wiff`'s. Upstream test data holds a
  `.wiff2` whose companion is named like a `.wiff`'s, so a walk that paired one
  would be pairing from adjacency (ADR 0027). A dropped `.wiff` or `.wiff.scan`
  is refused by name, `sciex_add_files_only`, before anything is opened; its
  companion is never looked at. Revisit only when a measurement shows the
  pairing cannot take a same-stem `.wiff2`'s companion and the owner confirms
  the residual.

### How a proposal is admitted

`accept_proposed_file(path, observed)` is the one admission both walking
surfaces call. It never reaches the picker's router or the bundle admission
(asserted over the source).

1. Refuse a SCIEX name.
2. Inspect and lease the file, and compare its identity with the one the walk's
   enumeration record or the drop's no-follow inspection observed. A mismatch is
   `folder_candidate_changed` or `drop_candidate_changed`, decided **before any
   byte is read**. Previously a walked file was accepted first and compared
   afterwards; for a vendor file that would have hashed whatever the name had
   come to mean.
3. For a vendor file, open it once with read sharing only. If another program
   holds it open for writing, the answer is `source_in_use` before the read,
   rather than `file_unreadable` after it.
4. Admit it under its family's own rule: the same body `Add files…` uses for
   that family. A name that proposes a family and holds other bytes, for
   example a camera `.raw`, is refused on its own as `unrecognized_acquisition`;
   the rest of the batch arrives.

New vendor rows keep the existing conversion-membership default.

### Admission runs after the scan and before the mutation gate

Both surfaces admit their candidates holding no workspace lock, then take the
gate once to register what was admitted, in discovery order, as one contiguous
run.

- Clear and Remove take the gate at once and supersede the add. Between files
  the add checks whether it is still current (the folder's generation, the
  drop's claim) and stops reading if not. Files admitted by a superseded add
  are dropped with their holds.
- The folder commit now refuses when a conversion became busy after its claim,
  as the drop's commit always did.
- During a drop, roster reads still wait on the drop's claim (ADR 0008). Clear
  remains an exit; Stop adding is the second.

### Duplicate and full-roster short-circuit

Before a candidate is read:

- an object that is already a single-object row, or an earlier candidate of
  the same batch, is a duplicate, answered without reading it;
- a candidate the batch can no longer fit (rows held plus new rows admitted in
  this batch reach the workspace capacity) is `workspace_full`, without reading
  it.

The registry still decides at commit; these answers are the ones it would
give.

### Stop adding and progress

- **Progress.** One slot holds the add in flight: an opaque `ingestionId`,
  `total` (absent while the scan or drop is still counting), `completed`
  (candidates decided), `vendorTotal` (how many are RAW or LCD) and
  `stopRequested`. It is a leaf lock, independent of the gate and the drop
  claim, so it answers while a drop makes every other workspace read wait.
  Counts only; no name, path or identity.
- **Stop adding** names the add by its `ingestionId` and takes effect before
  the next candidate. It is non-destructive: what was admitted is still added,
  the rest is counted as `notAttemptedCount` in the folder or drop summary,
  and a non-zero count makes `complete` false. One file's hash cannot be
  interrupted, so a stop waits for the file being read. A stop during the
  scan lets the scan finish (it reads no file content) and admits nothing.
- The service exposes `ingestion_progress()` and `stop_ingestion(id)`. The two
  Tauri commands are registered together with the frontend that calls them,
  because the command-registration test requires every registered command to
  have a caller.

### Folders an instrument is still writing to

Hashing holds a handle that refuses writers. Adding a folder an acquisition is
still being written into can therefore disturb the acquisition software. That
effect is unmeasured. The interface warns against it next to `Add folder…` and
the drop target. The backend facts behind the warning:

- `vendorTotal` in the progress, the number of candidates whose admission
  takes that handle;
- `source_in_use` for a vendor file another program holds open for writing,
  decided before the read.

### Budgets no longer bound the worst case

ADR 0007's "the budgets are what bound the worst case" is withdrawn. The count
budgets still bound the walk, but admitting 1,024 multi-gigabyte acquisitions
is bounded by their size, not by a count. Stop adding and Clear are what a user
has instead. ADR 0007's "no cancellation, no percentage" is replaced by the
progress and Stop above, once the candidates are counted.

## Consequences

- Folder and drop results may hold Thermo RAW and Shimadzu LCD rows. A
  frontend that auto-previews the first added row must pick the first added
  mzML row: vendor rows are not previewable.
- New wire fields: `notAttemptedCount` on the folder discovery summary and the
  drop summary, and `WorkspaceIngestionProgressDto`. New refusal:
  `sciex_add_files_only`. `source_in_use` and `unrecognized_acquisition` can
  now appear in folder and drop outcomes.
- Not done here, for the integrating and UI lanes: the two commands; renaming
  `begin_mzml_folder_import` and `choose_mzml_folder` (a mechanical commit
  across `lib.rs`, the registration test, `api.ts` and the e2e specs); the
  copy, the warning, the Stop control and the k-of-N display; rendered and
  native evidence.

## Evidence

Desktop-crate tests on Windows, real files under the temporary directory, no
backend process (`NoProcess`):

- `folder_and_drop_add_thermo_and_shimadzu_files_and_never_sciex`
- `a_walked_vendor_file_that_is_not_one_or_is_still_being_written_is_refused_alone`
- `a_vendor_candidate_replaced_after_the_walk_is_refused_before_it_is_read`
- `a_duplicate_and_a_full_workspace_are_answered_without_reading_the_file`:
  each file is held open for writing, so an attempted read would have answered
  `source_in_use`
- `stop_adding_leaves_the_rest_unread_and_progress_never_waits_on_a_gate`
- `the_progress_slot_counts_one_add_at_a_time`
- `a_folder_import_refuses_to_commit_beside_a_conversion_that_began_after_its_claim`
- `no_walking_surface_routes_a_candidate_through_sciex_admission`, extended to
  the shared admission
