# M8.1 — first closed loop: project, input/artifact/run record, save, reopen

Scope: **this loop only.** Not M8 in full, not M9 or M10, and explicitly not a
general framework built ahead of its first consumer. QC summaries, report
surfaces and figure layer identity are later M8 slices and are out of scope here.

## The loop

```
create project -> register explicit local input references
              -> capture file facts (one real operation)
              -> record the artifact and the run that produced it
              -> save -> close -> open -> check linked files
              -> matching / different / unavailable, shown in the workbench
              -> explicitly relink a moved candidate
```

## What already exists, and what is missing

Grounded in the current code rather than assumed.

| Need | Today | Gap |
| --- | --- | --- |
| Identify an input file | `FileIdentity { volume_serial: u64, file_id: [u8;16] }` from the filesystem, and `DatasetIdentity { primary, companions }` | Both are in-memory, and both are *live* facts. `FileIdentity` names a file object on a volume for as long as that object lives; it is not a durable logical identity |
| Refer to a dataset | `DatasetId(u64)`, a per-session counter, never reused in-process | Explicitly **session-scoped**; cannot survive a restart, so it cannot be what a saved project stores |
| Name a durable record | `ArtifactId(Uuid)` in `mscanvas-core` | Already the right shape. It had no persisted consumer |
| Measure content | `Sha256Digest` over Windows CNG, with `calculate_reader` used by conversion to hash *through the handle that holds the object* | Repository-owned, no third-party hash dependency. It had no project consumer |
| Establish a stable read | `open_pinned_source` withholds write and delete sharing for the duration of a conversion | The same posture is what a content verification needs, and for the same reason |
| Publish a document atomically | The preference store fills a private same-directory sibling and gives it the published name by handle | Bound to one fixed profile path and one record type |
| Persist a project | Nothing | The whole slice |

`DatasetIdentity`'s `Debug` deliberately prints `<opaque-dataset-identity>`,
because "printing one would put a machine-correlatable fingerprint of the user's
files somewhere nobody meant to publish". That judgement is preserved below, and
it is the reason S3 stops where it does.

## Decisions

These replace the five open questions this document previously carried. They are
adopted, not proposed.

### S1. Record identity, location, content and live authority are four things

A record carries a **stable project-domain identifier**: `ProjectId`, `InputId`
and `RunId` are UUIDs beside the existing `ArtifactId`, which is reused
unchanged. A new record gets a new identifier; a loaded record keeps the one it
was saved with. Neither a path, a Windows `FileIdentity`, a content digest nor a
session `DatasetId` is that identifier.

A stored reference carries a **typed locator** and an explicit **recorded
content baseline** — per member, its role, its byte length and its SHA-256. The
baseline is what the record claims about the bytes it was registered from. It is
history, and nothing in this slice rewrites it.

Locators are project-relative where the referenced object lies under the project
document's own directory, and an explicitly selected local absolute reference
otherwise. Save As **rebases deliberately**: every locator is resolved against
the old base to an absolute path first, then re-derived against the new one, so
which external objects are referenced is preserved rather than reinterpreted.

`FileIdentity` and its lease remain live, session-local mechanisms for immediate
validation and race protection. They are not persisted, not searched for across
a volume, and not treated as content identity.

Size and modified time are hints. A verification that claims content equality
compares a newly observed digest of a **stable, complete read** against the
recorded baseline: the object is opened withholding write and delete sharing,
its length is checked, and it is hashed through that same handle. Where a stable
read cannot be established the outcome is explicitly unstable, never "matching".
Reads stream with bounded memory, one input at a time, and cancellation is
observed between members.

A path that now holds another file is not `relocated`; it is a different object
at a checked location, and what that means for the bytes is a separate question.
A same-byte copy is not proof of the same physical object, the same acquisition
event or the same scientific provenance, so distinct logical records are never
merged by digest.

An input with mandatory companions records its required members and their roles.
A SCIEX `.wiff` primary alone is not a verified complete acquisition; the
existing companion rule decides what a bundle's members are. This slice admits
no new source family, traverses no directory and reads through no provider. A
recorded local file is a file reference, and nothing here asserts it is a
scientifically supported dataset.

### S2. Verification and relinking are different concepts

Verification answers one compact typed question per input:

- `NotChecked` — nothing has been established, including after a cancellation;
- `MatchingRecordedContent`;
- `DifferentContent`;
- `Unavailable` with a specific reason: `MissingAtCheckedLocation`,
  `Unreadable`, `UnsafeReference`, `IncompleteRequiredMembers`, `UnstableRead`.

Access denial is `Unreadable`, not missing. Missing means not found at the
checked authorized location, never absent from the machine.

**Relink is a separate, explicitly confirmed mapping operation** and a history
fact, not a state in the list above. A file can be at a new location *and* have
different bytes, and the two are reported independently. Find and relink examine
one user-selected candidate; nothing scans a disk and nothing substitutes
automatically. Matching candidate bytes support a proposal, and only a
confirmation commits the replacement locator. The logical `InputId` is reused
and its recorded baseline is preserved — committing a relink never rewrites the
baseline, even when the candidate differs.

An altered input is therefore inspectable without rewriting old artifact or run
history. Accepting a different content revision, or rerunning work against it,
stays a later explicit operation and is not smuggled in as relinking.

### S3. Minimise what is stored; claim no anonymity

The salted-`FileIdentity` scheme is **rejected**. A salt stored beside the value
it salts is not a secrecy boundary, and a document that already carries
locators, labels and digests is not anonymous whatever is done to one field.

For this slice the OS `FileIdentity` stays session-local and is not written at
all. The document stores the locators and content facts the roundtrip and its
one consumer actually use, and nothing else.

The project document is described to the user as a **private local working
document that can reveal file names, file locations and content correlations**.
Its raw paths, digests and file identities are not written into ordinary errors,
debug output, public CI logs or evidence summaries.

No encryption, key management, anonymised sharing or persistent local identity
cache is built here. No new global user-profile store is added, and UI
preferences stay in their own store, separate from scientific project records.

### S4. Parse eagerly; verify explicit references; admit only for a current action

Opening a project structurally parses and validates the whole bounded document
before any live state is replaced. It launches no backend, reads no embedded
path, restores no scientific token and starts no prior run.

The project appears immediately, with its historical records and every reference
`NotChecked`. One explicit **Check linked files** operation examines the
displayed reference set. The user's action is what authorises that bounded
examination; it is not ambient filesystem access.

The document is untrusted input. Unsupported schema versions, malformed or
duplicate identifiers, dangling relationships, excessive size or count, and
invalid locator forms are refused **whole** — no partial load, and the project
currently open is left exactly as it was. Environment variables are never
expanded, URLs, UNC and device references are never followed, and an authorised
relative root is never escaped. The existing reparse-point and file-kind
safeguards are reused. An unavailable reference is never quietly replaced by an
alternative.

Verification establishes current reference and content facts and nothing more.
Any later viewer, conversion, export, adoption or cleanup request obtains its
own fresh runtime admission. Readable-but-unsupported and unreadable-or-missing
stay distinct. No receipt, `DatasetId` counter, handle lease, process ownership,
staging deletion authority or executable command is reconstructed from JSON.

### S5. One real typed operation

No opaque JSON or BLOB parameter block is stored.

The first real consumer is **`CaptureFileFactsV1`**: over an explicitly selected
reference set, it records each member's actual byte length and SHA-256 through a
stable read. It produces a real **file-facts artifact** — a typed payload inside
the project document — and a typed **terminal run record** linking the inputs it
was asked to observe to the artifact it produced.

A run persists only what this consumer uses: the operation identifier, a stable
`RunId`, the inputs it covered, the output `ArtifactId`s, the application
version that actually ran it, the observed terminal outcome and the timestamps
that bound it. There is **no parameter field**, because this operation consumes
no variable parameters; one is added when an operation has them. No command
string, executable path, plugin dispatch or worker engine is introduced.

A successful capture is successful file-facts capture. It is not
mass-spectrometry analysis, conversion, QC or verified scientific lineage, and
the interface says so. Reopening a recorded `Completed` run displays history and
never schedules it. Recorded provenance in an editable document is not
cryptographically authenticated merely because files carry digests. A failed or
cancelled observation produces no artifact at all.

### S6. Cancellation belongs to one accepted operation

A cancel is a request about one operation. It is not a standing preference and
not a credit against whatever runs next. The first candidate implemented it as
one store-wide flag that a start did not clear, and recorded the consequence --
"a cancel pressed when nothing is running stops the next thing instead" -- as an
acceptable trade. That is rejected.

An operation is **accepted** before any of its work starts. Acceptance mints the
identifier the operation will run and be cancelled under, and a cancellation
state that exists from that moment, so a cancel pressed in the instant after the
button finds that exact operation even if the run request has not reached Rust
yet. Invokes are independent fetches, so that ordering cannot be assumed; it is
established under the session mutex, the same lock that owns the project and its
generation.

- A cancel that names no accepted operation answers `noActiveOperation`; one
  that names an operation other than the accepted one answers `stale`. Neither
  sets a flag, records a run or touches the project.
- An accepted operation that has not started is not idle. Cancelling it lands,
  and its worker finds the flag set before it opens a file.
- Each operation is bound to the project-session generation it was accepted
  against. A ticket for a project that has since been replaced, closed, or had
  a record removed cannot run, and a check or capture whose project moved
  underneath it discards its answer at commit rather than applying it to
  whatever is open. Reopening the same document keeps its identifiers, which is
  exactly why identifiers alone are not the test.
- Whichever of a cancel and a commit takes the session lock first wins. A cancel
  that wins leaves every reference unchecked and publishes no artifact and no
  baseline; a completion that wins keeps its outcome, and a late cancel answers
  `noActiveOperation` and rewrites nothing.
- Cancellation is cooperative through the existing bounded read: the flag is
  checked between members and at each 64 KiB chunk boundary before the read, so
  the chunk in flight completes and the next is not started. The project lock is
  held during none of it.
- Accepting twice at one generation is one operation, so a doubled activation
  starts one; a second operation is refused while one runs.
- An accepted operation that was cancelled before it started is finished. The
  next activation is a new operation with a new identifier, and the cancel
  stays with the one it named. The isolated delta review found the idempotent
  acceptance handing a cancelled ticket, flag and all, to the next activation,
  whose check then did nothing without saying so; that is closed with its own
  regression.
- The interface offers Cancel only for the operation it accepted and is still
  waiting on, and sends nothing otherwise. That is the affordance agreeing with
  Rust, which enforces all of the above whether or not the interface does.

A cancelled operation that was accepted and dispatched is recorded as cancelled
with no artifact. An idle cancel records nothing, because there was nothing.

## Persistence

One explicitly versioned, bounded local JSON document over the existing serde
stack. No database, repository layer, event-sourcing system, or migration for a
schema that has never existed.

New, Open, Save, Save As and Close are real behaviours with real unsaved-change
handling. **Explicit saving is the only new write authority in this slice.**
First publication goes to a user-selected new document; afterwards Save replaces
only that session's bound document, and only after identity and revision checks
pass. A destination that is not this application's own project document is
refused rather than replaced, and a destination that is the same filesystem
object as a referenced member — including through a hard link — is refused by
identity.

Save As, stated once. It may create a new document and rebases every locator
deliberately. It refuses any already-existing target that is not this session's
own bound document -- an unrelated file and a valid project document belonging
to another project alike. Recognising a project is not overwrite authority, and
the save dialog carries no overwrite prompt, so there is no confirmation behind
which replacing somebody else's file could be the right answer. Choosing the
session's own bound document as the target goes through the same identity,
revision and generation checks Save applies; it is not a bypass of them. A new
alternate filename is an ordinary Save As.

Publication reuses the existing mechanism: a private same-directory temporary,
filled and ordered, then given the published name by handle. Nothing is deleted
or truncated first, so an interrupted or failed save leaves the previous
confirmed document exactly where it was. That is not a crash or power-loss
durability claim; it is the claim that the published name means one whole
document or the other. A stale save, a concurrent save and an external
replacement are refused instead of overwriting another writer's state. There is
no autosave daemon and no second profile store.

## The visible loop

```
New project -> choose a local input/member set -> capture file facts
            -> inspect the artifact and the run that links to it
            -> Save -> Close -> Open -> Check linked files
            -> matching / different / missing / unreadable, distinguishably
            -> explicitly relink a matching moved copy
```

It uses the existing shell, the existing localized resources and the existing
contextual Details pattern. Project controls and the compact input/artifact/run
view are usable **without ProteoWizard**. Domain operations go through Rust; the
frontend owns no fixture store. Loaded project references stay distinct from the
live admitted viewer roster until an existing explicit action admits them.

No generic graph canvas, QC dashboard, redesign or recipe runner is built.

## Automated tests

Run with development, not deferred to an acceptance window.

- **Identity**: project, input, artifact and run identifiers survive a
  roundtrip unchanged; session handles after reopening are fresh.
- **Content**: same length and modified time with altered bytes is reported as
  different content; identical content in a different object is not treated as
  proof of historical object identity.
- **Locators**: project and data copied together resolve through relative
  locators; an explicit relink of an external moved candidate commits only the
  locator; a differing candidate does not replace the baseline.
- **Unavailability**: missing, unreadable, unsafe, unstable and incomplete
  required member sets are distinguished from each other.
- **Untrusted document**: duplicate identifiers, dangling references, malformed,
  truncated, oversized and unknown-version documents leave the current project
  intact; traversal, UNC and device references cause no read and no execution.
- **Write authority**: Save and Save As locator semantics, refused destinations,
  stale saves, and the preservation of sources and artifacts.
- **The operation**: `CaptureFileFactsV1` creates the expected typed artifact
  and run record; a failed or cancelled observation cannot fabricate one.
- **Admission**: current verification and admission are never restored from
  historical recorded statuses.
- **Visible consumer**: matching, different and missing outcomes render
  distinguishably, relinking is explicit, and the roundtrip works in both
  locales where affected.

Two further groups came out of the review pass and belong in the list:

- **Concurrency**: a reference registered, a capture committed, a Save As
  published or a relink proposed while the project underneath was replaced,
  closed or had a record removed is discarded rather than applied to whatever is
  open when the work finishes. The failure it avoids is not a wrong pixel: a run
  committed against a removed reference makes the document permanently
  unsaveable, because the dangling reference it creates is one the reader
  refuses on every later Save and nothing can delete.
- **Names that are not what they look like**: on Windows a single path component
  can be an alternate data stream (`sample.txt:payload`), a name that resolves
  to its neighbour (`sample.txt ` and `sample.txt.`) or a device (`NUL`,
  `COM1`). A component check alone admits all of them, so the rule is the
  stricter one and is applied to member names and locator components alike.
- **Cancellation**: an idle cancel followed by a successful operation; a cancel
  after acceptance and before any read, proved by a chunk counter that stays at
  zero; a cancel during a read that wins before commit, held at a chunk
  boundary by a two-party barrier rather than a sleep, with a counting control
  that reads every chunk; a late cancel for a finished operation and a cancel
  for a different operation while one runs; closing and reopening the same
  document under a running check; and the history that results being a valid
  document. The interface side proves Cancel is absent when idle and for a save,
  names the accepted operation, and reports a stale outcome as nothing.

Native Windows file-mechanism tests run on task-owned fixtures only, without the
VM and without the provider. Filesystem-specific observations are described as
such: one editor's replace behaviour is not a universal ability to infer how any
file was edited, and cross-directory testing is not cross-volume testing. Where
another volume is unavailable the physical limit is reported rather than
implied.

No scientific-correctness test belongs to this slice. It records relationships
and produces no scientific result.

## Local validation record

What was run on the corrected candidate, once, with its direct exit status; what
is inherited; and what is retained as contaminated.

**Run on this candidate.** `cargo fmt --all --check`, `cargo clippy --workspace
--all-targets --all-features -- -D warnings`, `cargo test --workspace` (1033
passed; the project store's 63 include the cancellation group above), `pnpm
lint`, `pnpm build`, the full `vitest` run (2017 passed), `pnpm e2e:typecheck`,
`python scripts/check_repo.py`, and two browser specs run one at a time on their
own dev server: `m8.1-project-records` (8 passing, including the accept, run,
cancel sequence with the identifier carried through all three requests) and
`m7.2-workbench`, the one existing spec that exercises the shell this slice
added a navigation target to (below). Logs are retained under
`test-results/m8.1/logs/`.

**Inherited browser debt, not repaired here.** Ten browser specs still select
`li.dataset-row`, a structure M7.2 replaced with `div[role=row]`. The first
assertion each reaches is that selector, so nothing after it has been observed
at all -- which is a different fact from "the behaviour they assert is broken".
`m4.1-spectrum-export` was run alone at the parent commit `aa3fc83` and fails
identically (17 failing), the retained baseline for this class; the other nine
are attributed by the same selector and were not run individually. `m7.2-
workbench` fails 10 of 11 on this candidate, every failing document in English
where Chinese was expected: the spec switches locale through Settings, the
shared IPC table answers the preference save with the `en` snapshot, and since
M7.5 the interface applies the published snapshot rather than the request. The
spec, the shared table, and the shell, roster and preference sources it drives
are byte-identical to the parent. Run alone at the parent commit `aa3fc83` -- a `git archive` export with its own private offline install, on its own port -- the same spec fails the same 10 of 11 with the same English-where-Chinese-was-expected documents, so the ten are inherited and not this slice's. (That private install reported one tarball missing from the package store for `@wdio/cli` and exited non-zero; the linked package was present and the spec ran to its real assertions, and that is stated rather than hidden.) The one test of the eleven
that does not switch locale -- navigation and organization through the real
shell -- passes on this candidate. No obsolete DOM was restored and no assertion
was weakened.

**Delta review.** One isolated read-only review of the cancellation delta,
each finding then handed to a refuter whose brief was to disprove it. Eleven
properties were reported clean -- total cancel-versus-commit ordering under the
one session lock, never-reused identifiers, no store-wide flag, guard release
on every path without a same-thread re-lock, generation binding across
close/reopen, no lock held during reads, the cooperative reader and its chunk
accounting, the barrier tests, the recorded outcomes, the interface binding and
the command surface. One finding survived refutation and was real: the reuse
of a cancelled unstarted ticket described in S6. It is fixed and covered.

**Contaminated runs, retained as such.** Two full-suite browser runs on
2026-09-19 overlapped on one dev-server port; the log is retained as
`2026-09-19-full-suite-CONTAMINATED-concurrent-ports.log`, and its 21-of-22
failures are not evidence about the product and are counted neither way. A
later single-instance run was stopped before completion for diagnosis and is
retained as partial.

**One load-dependent frontend failure, unresolved.** On 2026-09-19 a full
`vitest` run reported `App.test.tsx > the session workspace roster > removes the
selected rows, keeps the preview whose row survived, and says the files are
untouched` as failed. Only the summary line was captured, not the assertion. It
passed alone immediately afterwards and in every full run since, the latest 2017
of 2017. Its overlap with this slice: none of the text or roles it queries is
produced by M8.1 code, and the composition change is one `hidden` section, one
hook that resolves immediately in that test's composition, and one polite live
region the test's own `VISIBLE` filter ignores. That is the basis for treating
it as an inherited timing-dependent case. It is a basis, not a proof: the
assertion that failed is unknown, and a green rerun establishes no cause.

**A tooling incident, preserved.** During the first candidate a disposable
checkout was given a link to this checkout's `node_modules`, and a forced
worktree removal traversed that link and deleted the contents of 37 packages in
the shared store. The frozen reinstall that repaired it left `pnpm-lock.yaml`
byte-identical and every gate green afterwards. That is evidence the recovery
worked; it is not evidence the cleanup was safe or authorised. Practice from
here, applied to the parent-commit observation above: a disposable checkout is
a `git archive` export with its own private install from the package store,
linked to nothing outside itself; cleanup resolves only the link entries it
created, without traversing their targets, and retains the directory rather
than forcing past a refusal it cannot explain; and one browser campaign runs at
a time, on its own port.

## What M8.2 added on top of this

The first visible consumer of these relationships, recorded here because it
depends on the decisions above and changed two of the rules they set.

The reverse edges -- which runs consumed a reference, which run produced a
record -- are derived in `project/lineage.rs` and sent on the projection, so
there is one computation of each and the interface does none. Two integrity
rules were added to `validate` to make those derivations unambiguous: two runs
claiming one artifact is refused as `ambiguousProducer`, because "what produced
this" would otherwise have two answers; and a repeated identifier inside a
run's inputs, a run's outputs or an artifact's observations is refused as a
duplicate. A capture asked for one reference twice is refused at the entry, so
the shape cannot enter a live document that `validate` would then refuse on
every later Save.

An artifact still has no backing file and no field that could hold one, so the
consumer says where a record lives rather than leaving a gap beside references
that do have a file. Current file state and recorded history are separate
sections, and where a current state appears beside a recorded relationship --
which is where a reader needs it -- it carries the word "current" with it for a
reader who has neither the heading nor the tone.

### One disposition worth stating rather than burying

The duplicate rules run on parse as well as on publish, so they can in
principle refuse a document an earlier build wrote. Under M8.1 the capture
command did not de-duplicate its `input_ids`, so a caller that sent one
reference twice would have produced a run naming it twice and an artifact
observing it twice -- a document M8.1 published and M8.2 refuses, with no
migration and no repair operation.

That is the policy and not an oversight: a duplicate lineage relationship fails
closed rather than being quietly repaired, because repairing it would mean
choosing which of two statements the document makes is the real one. Three
things bound it. The shape is unreachable from this application's own
interface, whose selection is a toggled set. It cannot be written any more,
because the duplicate is refused at the capture entry. And a reader who meets
it is told which problem it is -- `duplicateIdentifier` and `ambiguousProducer`
each have their own sentence in both locales, rather than the generic refusal.
A repair path, if one is ever wanted, is a decision of its own and not a thing
to add quietly here.

## Out of scope, explicitly

Provider-dependent conversion, preview, figures, exports and clipboard remain on
HOLD and are untouched. Figure layer identity and provenance, QC summaries and
report surfaces are later M8 slices. M9 analysis capability is not started here.
Release-level GUI and install acceptance stays paused and unwaived: this slice
ends as a locally committed, locally verified child candidate whose publication
still depends on the unqualified M7.6 ancestor beneath it.
