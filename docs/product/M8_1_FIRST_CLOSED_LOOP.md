# M8.1 — first closed loop: project, input/artifact/run record, save, reopen

Scope: **this loop only.** Not M8 in full, not M9 or M10, and explicitly not a
general framework built ahead of its first consumer. QC summaries, report
surfaces and figure layer identity were later M8 slices and were out of scope
here; the sections from M8.2 on record what each later slice added.

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

## What M8.3 added on top of this

The first crossing between the persistent project model and the session
workspace, recorded here because it is the place two authorities meet and
because the temptation to make it something bigger is the thing worth writing
down.

### The four identities, and which one is durable

- **`InputId`** -- the project-domain identity of a reference. Durable, written
  to the document, stable across sessions.
- **The locator and the current check** -- where the project believes that
  input can be resolved, and what the last look established about it. The
  locator is durable; the check result is not, and a reopened project starts
  every reference unchecked.
- **The filesystem object** -- re-established at the action boundary, never
  assumed from either of the above.
- **`DatasetId`** -- the workspace row. Session-only, created or returned by
  the existing admission path, and it **never enters the project file.**

The session remembers which row a reference was admitted as, in the open
project and nowhere else. That association is presentation only: it exists so
the surface can offer to show a row rather than to add one that is already
there.

### What the webview may ask for

`add_project_input_to_workspace(operationId, inputId)` and nothing else. No
path in either direction. Rust resolves the reference through the open project,
proves it, and hands the object to the existing admission boundary; what comes
back is the ordinary add result and the project description, in one reply,
because the crossing changes both and applying one without the other would
leave the surface offering to add a row it has just added.

### Eligibility, and why it is not a check

The action is offered only where the ordinary check action has already
established that the referenced bytes are the recorded bytes. Pressing it is
not a request to run a check: an unchecked reference is refused as
`notChecked`, and `changed`, `missing`, `unreadable`, `unstableRead` and
`incompleteRequiredMembers` each keep their own refusal, because what the
reader should do next differs in every one of them. Relinking a reference
remains M8.1's own confirmed operation; this action performs no mutation of the
document at all.

### Revalidation at dispatch, and the bound on it

A prior check is not standing admission authority. Immediately before
admission the content is re-established through the same stable read and the
same SHA-256 the check itself uses -- so an in-place edit at the same path, the
same length, the same modified time and the same file identity is still caught,
and there is a test that performs exactly that rewrite and asserts the refusal.

Two things are worth stating rather than implying. First, the revalidation
releases the session lock for the read and rejoins under the M8.1 generation,
so a project replaced, a reference relinked or a reference removed while the
hash runs refuses rather than committing into something else; the same
accepted-operation record makes the read cancellable, and the cancel is M8.1's,
not a second flag.

Second, the proof binds to an object rather than to a name, and that is what
M8.3.C1 closes. It is set out under its own heading below.

A failed revalidation writes the newer truth into the *session's* check result,
which is the same slot the check action writes, and touches nothing in the
document -- no baseline is rewritten, no locator moves, nothing is marked
unsaved. Leaving the row saying "matches" beside a refusal saying "changed"
would be the interface contradicting itself.

### The same-object proof (M8.3.C1)

A digest says what a *name* contained during one read. That is not the same as
saying what an *object* contained, and the difference is the whole of this
section.

The original M8.3 took the content evidence through one handle, released it,
and established filesystem identity through a separate open afterwards. That
leaves a real path-replacement window: object A is hashed and matches the
record; A's handle closes; the name is made to mean object B; both later
identity observations observe B and therefore agree with each other; and the
workspace may admit B. Two observations agreeing proves only that they were
taken after the same replacement. It is not theoretical, and neither path
equality, byte length nor modified time detects it -- B may be a byte-for-byte
copy.

**What it does now.** One pass over the input answers both halves of one claim.
For each member the record names, the bytes are hashed through a handle opened
with write and delete sharing withheld, and the object's identity is read
**through that same live handle, before it is released**. So the evidence is
`VerifiedProjectObject`: the digest and length compared against the record, and
the identity of the object those bytes actually came out of. The primary and
every required companion are covered; a bundle is not proven from its primary.

**What the identity is bound to afterwards.** The restrictive handle is
released once the content proof is complete -- holding a user's file against
writers and deleters for the length of a workspace admission is not something
this action should do. The existing admission then opens the path normally and
produces a row under its own rules. The binding check is a comparison against
that **row's own leased identities**, asked of the workspace rather than of the
filesystem: the row is bound to the objects admission opened, so comparing
against it compares two observations of objects rather than two observations of
a name. On Windows the lease also holds those objects alive, so the identities
cannot come to mean something else while the row exists; off Windows there is no
handle to hold and the narrowing ADR 0006 already records applies here too. Both sides read `FILE_ID_INFO`, so they are the
same filesystem answer rather than two encodings of it.

Members are compared as sets, because each side orders them by its own rules --
the project by record role, the workspace by its family's membership -- and
"the same acquisition" is a claim about which objects, not about which order.

**A filesystem that cannot identify its objects** gives a measurement nothing to
be about, so the observation reports `unstableRead`: there is no comparison to
be made, which is what that state already means, rather than a content
judgement dressed up as one.

**On a mismatch**, the Project association is refused as `contentChanged` and
the replacement is *not* silently re-hashed and carried on with. The workspace
row stays exactly where it is: it is a workspace-owned result of the workspace's
own admission, and deleting it to manufacture atomicity the workspace contract
does not promise would be a worse answer than declining to name it. The roster
is reconciled exactly as M8.3 already reconciles it after a refused admission.

**None of this is persisted.** The identity is evidence for one operation. No
project document holds one, and registration deliberately discards the identity
it observes while recording the bytes.

**A volume that cannot identify its objects** gives a measurement nothing to be
bound to. That does not take the rest of the project away with it: registering
a reference, checking one and capturing its file facts all still work, exactly
as they did before this evidence existed, because none of them needs to bind
anything. Only this operation refuses, as `objectNotIdentified`, in its own
words -- borrowing "the file has changed" or "another program has it open"
would be untrue, and the second would tell the reader to do something that can
never work. In practice the Workbench's own admission refuses such a volume
first, with `file_identity_unavailable`.

**What this deliberately does not cover**, stated because the previous version
of this section stated its own limits and a silence here would read as
completeness. An equal-length rewrite *of the same object*, landing after the
content proof and before admission, satisfies the binding -- it is the same
object -- and the row is claimed while its bytes are no longer the recorded
bytes. That is not a hole the binding could close: identity proves "same
object", a digest proves "same bytes", and neither substitutes for the other,
which is the same division finalized outputs already work under. Closing it
would mean holding the user's file against every writer for the length of a
workspace admission, which is a worse trade than the window it removes. What
bounds it is downstream and already exists: the workspace rehashes an
acquisition at the moment it reads one and refuses a row whose bytes have moved
on. There is a test pinning this behaviour, so that if it ever changes it
changes because somebody decided it should.

**What the regression proves, precisely.** Two things, and they are different
claims:

* *Structurally*, that a measurement names the object it read: the identity a
  member's observation carries equals one the test reads from its own handle on
  that object, and it goes on naming that object after the name has been made to
  mean a different one. The window the old ordering left is between two adjacent
  statements, and on Windows it cannot be widened from a test, because the
  read's own sharing mode is what stops the object being replaced while the
  handle is held. So the invariant is asserted rather than the timing.
* *Behaviourally*, that the binding is enforced at the admission boundary, with
  a hook that runs after the proof and before the workspace opens anything.
  A replacement there is refused even when its bytes are identical, which is the
  case no digest can ever catch.

Two of those behavioural cases are genuine pre-fix failures, and it is worth
being exact about which, because the between-the-proof-and-admission hook alone
does not distinguish the two orderings: the old path probe ran *before* that
hook could fire, so it caught a replacement there too.

* A **bundle whose companion alone is replaced** was admitted and claimed by the
  previous primary-only comparison.
* A **bundle whose primary is replaced while its companion is being hashed** is
  the same-object window itself, made reachable. Members are measured one at a
  time and each handle is released before the next is opened, so the primary is
  genuinely unheld during the companion's read -- unlike the instruction-width
  gap a single-member input leaves, which no test can act in because the read's
  own sharing mode protects the other side of it. The swap in that test is not
  scheduled by counting chunks; it is attempted on every chunk and succeeds on
  the first one where the platform allows it, which is by construction a moment
  the primary is no longer held. An implementation taking identity from the path
  afterwards observes the replacement on both sides, finds them equal, and
  claims a row for an object it never measured.

Both were confirmed by installing the pre-fix mechanism -- the primary's
identity, taken by path after the reads were done, compared primary-only -- and
watching each test fail.

### The workspace stays authoritative

After the project-side proof, the existing `add_files` path runs unchanged.
Logical acquisition discovery, source family, canonical duplicate prevention,
SCIEX bundle requirements, directory and reparse restrictions, capacity, added
order, session identity, conversion-membership defaults and source-file
read-only behaviour are all still its rules, and none of them is widened. A
checked reference naming an ordinary `.txt` -- exactly the kind of file
`CaptureFileFactsV1` exists for -- receives the refusal it has always received.
A reference whose object is already a row converges on that row through the
workspace's own identity rule, including when an ordinary Add files admitted it
first.

### Lifetimes, in both directions

Removing a workspace row does not touch the project or its history. Closing or
replacing a project does not remove a workspace row. Removing a reference drops
the remembered row and leaves the row. Confirming a relink drops it too,
because the record then names a different object. Nothing watches for a row
*leaving* the workspace, and nothing needs to: the roster is the only authority
on which rows exist, and the interface resolves a remembered handle against the
roster it already holds, so a removed row or a cleared workspace turns "show
it" back into "add it" with no bookkeeping anywhere.

One bound on the label, stated rather than closed: a row admitted by the
ordinary picker carries no association, so its reference is still offered "Add
to Workbench". Pressing it converges on the existing row through the duplicate
rule and creates nothing. Closing that gap would mean scanning filesystem
identities on every description of the project, which is a cost paid on every
render for a label.

A Save As deliberately does **not** drop the association. It resolves every
locator against the old base and re-derives it against the new directory, so
the reference names the same objects afterwards and the remembered row is still
that reference's row.

### Opening a project still admits nothing

No workspace row is repopulated, no preview starts, no ProteoWizard runs, no
conversion membership or queue authority is restored, no `DatasetId` is
recreated and no viewed or focused state comes back. This is an explicit
bridge, pressed once per reference. A "restore the workspace this project was
used with" feature is a separate decision and is not made here.

### One inherited defect this slice had to repair

Project refusals were read off a `code` field on the rejected value. The
boundary has never sent one: every owned error serializes as `kind`, like the
rest of this application's refusals. So each individual sentence M8.1 wrote --
`staleDocument`, `destinationAliasesInput`, every document problem -- was
arriving unnamed and being shown as the catch-all "that action was refused".
The fake in `projectFixtures.ts` rejected in the shape the reader expected
rather than the shape the boundary sends, which is why no test saw it. Both now
use the real shape. It is repaired here rather than deferred because M8.3's
refusals are the point of M8.3's refusals: "check this file first" and "it has
changed" are two different instructions, and neither reaches the reader through
a catch-all.

## What M8.4 added on top of this

The first persistent layer identity, recorded here because it is the first
object M8 adds beside the input, artifact and run records, and because the
temptation to make it carry more than it does is the thing worth writing down.

### What a layer is, and is not

A layer is a project-owned identity that says: *this future visible or
comparable layer is sourced from this project record.* It is not a scientific
comparison, not a figure, not a series and not a row. Its first admitted
production source is the existing project reference (`InputId`), and only where
that reference has been handed to the Workbench through the M8.3 bridge -- so
the first closed layer is an acquisition layer, and a checked `.txt` that
`CaptureFileFactsV1` exists for cannot become one.

The identity is `LayerId`, a UUID beside `InputId`, `RunId` and `ArtifactId`,
with the same posture: persistent, unique inside one project, minted once for a
record that did not exist before, kept exactly as saved on reopen, and never a
path, a `DatasetId`, a `FileIdentity`, a display name, a plot-series ordinal or
a `StyleRole`. The raw identifier reaches the page as the address the page
already uses for every record, and is never ordinary visible text: a layer's
visible name is its source's label.

### The record, exactly

```json
{
  "id": "<uuid>",
  "source": { "kind": "input", "inputId": "<uuid>" }
}
```

That is the whole of `LayerRecord { id: LayerId, source: LayerSource }`, and
`LayerSource` has one variant because one current consumer exists. There is no
label, no metadata bag, no style, visibility, order, normalization or trace
quantity, no `FigureSpec`, no provider or backend authority, and no `DatasetId`,
absolute path, `FileIdentity`, check state or attachment state -- the first
group are comparison semantics this schema does not hold, and the second are
session or filesystem facts a document must not claim. An `Artifact` source
variant is deliberately not added ahead of the M9 consumer that could construct
and validate one; a future typed derived artifact is a different source, and
adding it is a schema decision of its own.

The document schema is **2**. Schema 1 was the shape before layers existed and
was never published outside development, so a document carrying it is refused
as `unsupportedVersion` by the policy that already refuses every other version:
no migration is built for a format no user ever held. The reader's sentence for
it said the project was "written by a newer version", which is untrue of a
schema-1 file, which an older build wrote. M8.4 accepted that sentence; M8.5
replaced it with a neutral one -- the project uses a schema version this build
does not support -- in both locales, which claims neither direction and offers
no migration. The refusal itself -- this build is the wrong reader, and
replacing the file would be the wrong answer -- was and is the right one.
Keeping the version at 1 and defaulting the field would have made
an M8.4 document read as `malformed` by an M8.3 build, which is the untrue
sentence, and would have silently changed what a versioned shape means.

### The creation rule

`Create layer` is offered only for a reference whose remembered Workbench row is
live *right now*. The association M8.3 records is what proves the source is an
acquisition the Workbench admitted under its own rules; the roster is the only
authority on whether that row still exists. Rust asks that question itself when
the command arrives, as an in-memory lookup of the remembered handle against the
registry, with the session lock released and rejoined under the M8.1
generation. A project closed, replaced, saved elsewhere, or with a record
removed or relinked while the roster was being asked refuses `staleDocument`
rather than writing a layer into whatever is open now. A reference with no
remembered row is refused `notInWorkbench` without the roster being asked at
all; a remembered row the roster no longer holds is refused the same way after
one question. Nothing in the sequence opens, reads, hashes or converts a file,
and no provider is probed: creating a layer with the source file already
deleted succeeds and leaves the check state exactly as it was.

**One current default layer per input.** Asking again for a reference that has
a layer answers the existing `LayerId`, before the roster is asked and without
marking the project unsaved. That is a product rule for this surface, not a
claim that the artifact model can never hold two derived layers from one
acquisition: a derived artifact would be a different source. General
duplicate-layer semantics are not built.

### Integrity

`validate` -- and therefore every open, every Save and every Save As -- refuses
a duplicate `LayerId`, a layer sourced from a reference the document does not
contain, and more layers than the layer bound (`MAX_LAYERS`, equal to the input
bound) as `oversized`. Two layers sourced from one reference
are refused as `duplicateIdentifier`, the single documented rule, by the M8.2
precedent: a relationship the document states twice is a duplicate, and
normalising it would mean choosing which layer is *the* layer of that input. A
source of any other kind is `malformed` by construction, because the type has no
variant for it; and a field the record does not hold is refused as `malformed`
at both levels -- on the layer and inside its source, which is exactly where a
handle, a path or a style would be put. The first candidate refused it only on
the layer and silently dropped it inside the source; the review closed that.
M8.1's `Locator` keeps its own convention and is not changed here. Nothing is
inferred from a label, a path, creation order or lineage adjacency, and the
layer adds no cycle to the graph `lineage.rs` reasons about: a layer names one
input, an input names nothing, and nothing names a layer.

Round-trip preserves the identifier exactly -- Save, close and open read back
the same `LayerId` and the same source; Save As to another directory rebases
the reference's locator and carries the layer untouched, because the layer
names the reference by identifier and not by where it is.

### Historical provenance and current availability are two things

A persisted layer says which reference it belongs to, and that does not change
because the reference is not checked, has changed, is missing, is relinked,
has its row removed, or the project is reopened. What changes is the
*projection*. The projection is deliberately computed in the interface from the
truths it already holds -- the source's `verification` and its remembered
handle, resolved against the roster -- through one function that the reference
row, the layer row and the Details region all share, so no two surfaces can
disagree about whether a row is there. Rust sends no availability field: a
second copy of the answer would be one more thing to disagree.

So a layer row and its Details answer two current facts: whether the source is
in the Workbench (attached / detached), stated in the present tense and headed
"Current availability" in Details, and what the last check established about
the source's file, carried with a "Current file" qualifier in the same sentences
the reference row uses. Selecting a layer sends nothing, checks nothing and
reattaches nothing; a detached layer offers no Show in Workbench control and
manufactures no `DatasetId`. The M8.3 association is an association for one
session; it is not turned into a claim that the source's bytes continue to
match.

### Lifetimes, and the removal rule

- Removing a layer removes the `LayerRecord` and nothing else: not the
  reference, not a Workbench row, not a file, and no run or artifact.
- Removing a reference that has a layer is refused as `layerDependsOnInput`,
  before anything is mutated, and the reader is told to remove the layer
  first. It is not cascaded: history is something this application wrote, and
  the removal cascades it because a dangling run is not a record; a layer is
  an identity the user created, and deleting it silently to satisfy a removal
  would remove something they did not ask to remove. There is no dependency
  transaction, and no dangling `LayerId` can be produced.
- Relinking the same reference to a verified new location keeps the same
  `LayerId` and source. The remembered row is dropped, as M8.3 already drops
  it, so the layer projects detached until a new admission -- and that
  admission converges on the same layer.
- Removing a Workbench row or clearing the workspace leaves the layer, its
  source and its history where they are; only the projection turns detached.
  Closing or replacing a project does not remove a row. Reopening a project
  restores no row and attaches no layer: the handle was never in the file, and
  every reference starts unchecked as before.

### What is not persisted, proved rather than promised

A document written with a Workbench row remembered and a layer created is
serialized and searched: no `dataset`, `handle`, `identity`, `volume` or
`fileId` appears in it, the layer entry is structurally exactly the shape above
(compared as a JSON value, so key order and whitespace are not what is pinned),
and
the projection the interface receives carries only `id` and `sourceInputId`.
The structural argument stands beside the test: the session association lives
in `OpenProject.admitted`, which no document type can express, and
`LayerRecord` has no field that could hold a handle, a path or an identity.

### The two commands

`create_project_layer(inputId)` and `remove_project_layer(layerId)`, each
answering the whole project description, and nothing else. Neither takes an
operation ticket, because neither reads a file or can be cancelled; the
command-surface parity test pins that these two names, and no third, were
added. `remove_project_input` gains the `layerDependsOnInput` refusal.

### The surface

Nothing new at the top level. The Project surface gains a compact **Layers**
section between the referenced files and the recorded work, and the M8.2
Details region gains a layer branch. Each reference row carries one
create-or-show control that is the *same element* in both states, so the
keyboard stays on it when the answer to a press turns "Create layer" into
"Show layer"; an ineligible control stays reachable, carries `aria-disabled`
rather than `disabled`, and points at its reason. A layer row is named by its
source, says whether it is in the Workbench and what the source's current state
is, offers Show in Workbench only while the row is live, and has its own Remove.
Removing a layer moves the keyboard to the control the removal changed -- the
source reference's own layer control -- rather than leaving it on the body.
Every per-row accessible name contains the visible label it names, as the M8.3
names do ("Create layer: ...", "Show layer: ...", "Remove layer: ..."). Details
for a layer answers what it is, its source (a control, with the source's
current state beside it), its current availability, and the runs that consumed
the source under a heading that says they are the *source's* -- the layer did
not exist when they ran; Details for a reference now names its layer, or says
none has been made. Navigation between the two is local state over data the
page already holds. Every owned string exists in `en` and `zh-CN`.

Three things are left as they are, stated rather than implied. Creating and
removing a layer announce the surface's existing "Saving..." busy word, which is
its word for any edit to an unsaved document rather than a claim that a file is
written. A layer whose source is gone renders a sentence as its name; no valid
document can produce one, and the branch exists so a bad projection cannot
take the surface down. And two references with the same file name give two
layers with the same visible name, which is M8.1's label rule carried into a
second list; every layer is still addressed by its identifier.

### Kept outside scientific rendering

`mscanvas-plot-spec` is untouched. No `LayerId` or source identifier enters
`FigureSpec`, `PanelSpec`, `SeriesSpec`, `StyleRole`, the SVG, the PNG metadata
or the CSV/TSV schemas, and `StyleRole::Measurement`, `SecondaryMeasurement`
and `Baseline` remain quantities rather than sources. A later comparison
consumer can introduce a typed adapter between a `LayerId` and the series it
resolves, once normalization, multiple live sources and layer selection
actually exist. None of that -- overlay, visibility, ordering as render order,
per-layer style, normalization, relative intensity, cross-run selected scan,
per-layer viewport or trace choice, figure composition, saved comparison
figures, multi-layer export -- is built here.

### Tests added for layers

Rust, in `project/tests.rs` and `reattachment/tests.rs`, each with a positive
and a negative control where the property has one: an attached reference
becomes one layer; a repeated create answers the same layer and dirties
nothing; Save, close and open keep the identifier and restore no row; Save As
to another directory keeps it; the layer remains after its row is removed and
after the workspace is cleared, with the remembered handle left for the roster
to answer about; a reopened layer is there before any row, a reference with no
row is refused, and a fresh admission converges on the same layer; the source's
check state neither gates nor rewrites the layer, including a check that finds
the file missing; a relink keeps the layer and detaches its row; removing a
layer changes nothing but the layer; a reference with a layer is refused
removal and the document is unchanged and still valid once the layer goes; a
duplicate `LayerId`, a dangling source, an unknown source kind, an extra field
on the layer or inside its source, two layers of one reference and more layers
than the bound are each refused with their own problem; a never-admitted
reference is refused without the roster being asked, and a gone row after one
question; a project closed, replaced, saved elsewhere or reopened from the same
file, a relink committed, a different reference removed and the very source
removed while the roster is being asked each get no layer and leave nothing
dangling; a second create landing in that window converges on one layer;
removing a layer from a saved project marks it unsaved; creating and removing a
layer read no file and launch no process; the serialized document carries no
session fact; and schema 1 is refused rather than migrated.

Frontend, in `ProjectLayers.test.tsx` and `lineage.test.ts`: the control is
offered only for a live row and sends nothing when inert; a create keeps the
keyboard on the control and turns it into Show; an existing layer is shown, not
duplicated; the list, its two current facts, selection, Show in Workbench only
while live, detachment when the row leaves, a reopen that forgot the row, a
source whose state changed, removal and the two refusals in their own words, a
source that is gone, keyboard reach of every control and where the keyboard
goes after a removal, per-row names that contain their visible labels, Details
from both ends with no request in either direction and the source's history
named as the source's, the stylesheet rules that wrap a long source name, and
the whole of it in Simplified Chinese. The suite flushes the hook's first-load
effect before pressing (below); that is a test-timing accommodation for an
M8.2 effect, not a repair of it.

One browser scenario, `e2e/specs/m8.4-layers.browser.e2e.ts`, over the
mock-IPC harness: the ineligible control and its reason; Add to Workbench and
back; a keyboard create whose only request names the reference, with the
focus ring read from computed style on the element that has it; the layer
inspected on arrival; layer to source to layer with the call ledger unchanged;
Show in Workbench from Details landing on the selected, focused row; Save,
Close and Open through the real buttons with the layer back under the same
identifier, detached, the reference offering Show rather than a second Create,
the roster still holding the row, and exactly three requests sent; Remove
leaving the reference, run, record and row in place and the keyboard on the
source's layer control; and a second case with a source name as long as an
instrument writes, at 1366x768 and 960x640, measuring that neither the page,
nor the project surface the list scrolls in, nor the Details region scrolls
sideways, that every layer control stays inside the viewport at the compact
minimum, and that the Details region does not widen past it. A row's own box
follows its column whatever it holds, so the row's width is not what is taken
as evidence of wrapping; the surface's scroll width is. It is React/mock-IPC
layout and interaction evidence only -- the project, the add result, the layer
answer and the roster are a controlled answer table -- and it proves nothing
about the filesystem, persistence or a provider; those claims are the Rust
tests' above.

### Local validation record for M8.4

Run with direct exit status on 2026-09-22. No VM, native or provider campaign
was run, and none is claimed.

**On the first candidate** (the implementation commit `70af668` and the
documentation commit `ee8c63a`), before the review:

| Gate | Exit | What it established |
| --- | --- | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test --workspace` | 0 | desktop library 1101 passed, 14 ignored; plot-spec 125; proteowizard 513 plus its integration targets; the project store's 102 include 22 layer cases, and the bridge's 29 include 2 roster-backed ones |
| `pnpm lint` | 0 | |
| `pnpm build` | 0 | |
| `pnpm test`, first run | **1** | 5 failed of 2091, retained below |
| `pnpm test`, second run, alone | 0 | 2091 passed of 2091 |
| `pnpm e2e:typecheck` | 0 | |
| `python -B scripts/check_repo.py` | 0 | |
| `pnpm e2e:browser --spec ./e2e/specs/m8.4-layers.browser.e2e.ts` | 0 | 1 passing, ten captured frames, empty console ledger; evidence under `test-results/m8.4/browser-CYCFqz` (an earlier pass of the same spec on the same tree is at `browser-3rqJQC`) |
| `pnpm e2e:browser --spec ./e2e/specs/m8.3-reattachment.browser.e2e.ts` | 0 | 2 passing with the `layers` seed; evidence under `test-results/m8.3/browser-dKNRqn` |

The implementation commit's message says twenty-three Rust tests; the diff adds
twenty-four -- twenty-two in the project store's suite and two in the bridge's
-- and the count above is the diff's. The message cannot be amended, so the
correction is recorded here.

**The first frontend run, preserved.** It was started while the Rust gates
were compiling and testing on the same machine, which is an orchestration
choice recorded rather than hidden. Five cases failed, in two classes, and
neither is this slice's:

- `M73Viewer.test.tsx` (two cases) and `M74FigureComposition.test.tsx` (one
  case) timed out at 5000 ms. All three are whole-application compositions of
  viewer and figure surfaces this slice does not touch -- its one change to
  the shell is two props on the Details region -- and they are the
  parallel-sensitive App-level class already carried as inherited debt.
- `ProvenanceDetails.test.tsx > shows each current state as its own sentence`
  and `> keeps an unresolvable relationship visible rather than shortening the
  list` failed with Details reading "nothing selected" after the inspect
  press. This slice's handoff carried an isolated M8.2 provenance-test timing
  sensitivity as inherited debt; this is the first record of *these* two cases
  in the repository, and the first diagnosis of its cause. `useProject` clears
  `inspecting` in a passive effect keyed on the open project's identity --
  introduced by M8.2's review closure, `399a3ef`, not by M8.1 -- and that
  effect also fires when the project *first* arrives. A press landing between
  the rows rendering and that effect flushing is applied first and then
  cleared. The two tests press the instant the control exists, which is
  exactly that window; a person cannot reach it. Neither the effect nor the
  M8.2 tests are changed here: repairing the effect is a decision of its own,
  and the minimal repair is one that resets only when a previously open project
  is replaced or closed. The M8.4 suite flushes that effect before pressing,
  which is why it does not sit in the window.

The second run, alone, passed everything. It does not erase the first; both
are the record.

**Inherited debt, carried and not widened.** The historical browser specs the
M8.1 record counts as ten, that still select `li.dataset-row` -- at this head,
nine spec files, seven browser and two Tauri -- and `m7.2-workbench`'s
language snapshot mismatch are as recorded above and were not run. Two
observations were made while reading and are left as they were found:
`m8.1-project-records` rejects a save with a `code` field where the reader has
read `kind` since M8.3, so its two refusal cases may no longer pass -- the spec
was not run and no claim is made either way; and every browser frame carries
the harness's own notice that Explorer drag-and-drop is unavailable, because
the shared table answers the drop subscription with nothing, which produces no
console entry and is not this slice's. Nothing in an older DOM was restored and
no assertion was weakened.

### The review, and what it changed

One isolated read-only review of the whole delta, eleven dimensions --
identity, schema, session facts, lifetimes, availability, generation, I/O, UI,
scope, documentation and evidence strength -- each finding then given to three
independent refuters with different lenses. Thirty-six findings; thirty-one
survived a majority, five did not. Deduplicated, what survived and what was
done:

- **A field inside a layer's source was dropped rather than refused.** Six
  dimensions found it independently. `LayerSource` now denies unknown fields,
  and the refusal test injects a `datasetId` inside the source beside the
  existing unknown-kind and extra-field cases, with the untouched document as
  its control. Removing the attribute makes that test fail, which was checked.
- **Per-row names did not contain their visible labels** -- "Create a layer
  from X" for a control that reads "Create layer", in English for all three
  and in Chinese for two. They now follow the M8.3 pattern, and a test holds
  every Chinese name to containing its visible label.
- **Remove layer dropped the keyboard to the body.** Focus now goes to the
  source reference's layer control, armed only by the press and spent on the
  first settled answer, so an Open, a Close or a refusal cannot move it. The
  jsdom and browser assertions both check it; removing the focus call makes the
  jsdom one fail, which was checked.
- **A layer's Details headed its source's runs "Used by"**, which read as the
  layer's own history. It now has its own heading and empty state naming the
  source.
- **Tests the first pass lacked**: removing a layer from a saved project marks
  it unsaved; a second create landing in the roster window converges on one
  layer, which is the only guard across the released lock because a create
  does not advance the generation; and the stale arms the record named but
  did not exercise -- Save As, a committed relink, reopening the same file and
  replacing the project, each inside the roster window.
- **Evidence the task required and nothing measured**: visible focus, now read
  from computed style after the keyboard create; and constrained layout, now a
  browser case at 1366x768 and 960x640 with a long source name. Writing that
  case found that the scenario's roster-row geometry was asserted on hidden
  rows at one column; it is now asserted only where the roster is on screen,
  as the layer controls already were.
- **Two vacuous lines** -- a jsdom key press on a button, which jsdom does not
  turn into a click -- were replaced with a real press.
- **The record itself**: the first-load effect's origin, the test count, the
  "already recorded" claim, the "byte for byte" claim, the three phrasings of
  one count rule, the schema-1 sentence called true, the "labelled as current"
  claim and the inherited spec count are each corrected above.
- **Kept, with a comment**: `create_layer`'s count check, which the
  one-layer-per-input rule makes unreachable and which is kept so a later
  change to either bound cannot mint a document `validate` refuses.
- **Left, and stated** under the surface section: the "Saving..." busy word
  and the gone-source rendering.

The five that did not survive: two layers of same-named files being
indistinguishable (real, but M8.1's label rule rather than this slice's; it is
stated under the surface section anyway), the session-fact test lacking a
real-format handle, a no-I/O test not exercising the real closure against a
missing file, a double possessive in one Chinese string, and a test comment
said to claim the browser measured the focus ring. The last is moot now that
it does.

### After the review, on the repair commit `7dca5f5`

Every gate, run once and in sequence -- no Rust build overlapping the frontend
suite this time -- with direct exit status:

| Gate | Exit | What it established |
| --- | --- | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test --workspace` | 0 | desktop library 1107 passed, 14 ignored; the project store's 108 include 28 layer cases (22, and 6 from the review), and the bridge's 29 include 2 |
| `pnpm lint` | 0 | |
| `pnpm build` | 0 | |
| `pnpm test` | 0 | 2091 passed of 2091 |
| `pnpm e2e:typecheck` | 0 | |
| `python -B scripts/check_repo.py` | 0 | |
| `pnpm e2e:browser --spec ./e2e/specs/m8.4-layers.browser.e2e.ts` | 0 | 2 passing; evidence under `test-results/m8.4/browser-qJreBj` |
| `pnpm e2e:browser --spec ./e2e/specs/m8.3-reattachment.browser.e2e.ts` | 0 | 2 passing; `test-results/m8.3/browser-1TMDpP` |
| `pnpm e2e:browser --spec ./e2e/specs/m8.2-provenance.browser.e2e.ts` | 0 | 4 passing, run because this commit changed the Details region M8.2 renders; `test-results/m8.2/browser-7IyZ6H` |

Retained from writing the repair: the first run of the new long-name case,
`test-results/m8.4/browser-0Wej2h`, failed on its 960x640 frame with the
roster's rows measured at zero height -- the roster is folded away at one
column, and the scenario was asserting geometry on rows that were not on
screen. That is the finding the review list above describes; the next run,
`browser-GKxN7n`, passed both cases.

Two mutation checks were made during the repair: removing
`deny_unknown_fields` from `LayerSource` failed the source-field refusal test,
and removing the focus call after a layer removal failed the jsdom removal
case. An earlier version of this record said each was made on a file copied
first and put back afterwards. For the first, that is not what happened, and
it is corrected here (in M8.5) rather than left standing: `record.rs` was put
back with `git checkout`, which restored the committed file and so also threw
away the uncommitted `deny_unknown_fields` repair that was itself under test.
The repair was then applied again and the suite re-run on it, which is the
validation the review closure rests on. No claim is made here about how the
focus-call mutation was restored beyond what the suite run after it shows.

### The affected-delta review

One review of the repair commit alone, two reviewers -- one on the code, one on
the evidence and the record -- and one refuter per finding. Eleven findings;
eight survived and three did not. What survived, and what was done:

- **The long-name case did not measure what the record said it measured.** A
  layer row's box follows its column whatever it holds -- the same row was
  993px wide at 1366 on the list and 736px beside Details -- and the project
  surface is its own scroll container, so a name that did not wrap would have
  scrolled inside the surface and reached neither the row's box nor the
  page. The record called that measured; it was not. The case now reads the
  surface's own scroll width in every frame where the surface is shown, the
  width check that could not fail is gone, and the record and the test
  comment say what is measured. Giving the label `white-space: nowrap` now
  fails the case, with the surface scrolling 13px sideways (evidence under
  `test-results/m8.4/browser-9q6jQl`); the stylesheet was restored from a copy
  afterwards.
- **The case read only the last viewport's console.** Each viewport is its own
  document and its ledger went with it at the next navigation; it is now read
  inside each viewport's pass, before navigating.
- **Focus after a removal was taken back from where the reader had moved it.**
  The removal is one request long and its control stays focusable, so a
  reader could move on before the answer. Focus is now recovered only where
  the removal actually dropped it, with a case that moves focus while the
  request is held; removing the guard fails that case.
- **The count check did not cover the roster window.** The kept guard ran
  only before the lock was released, and a create for a different reference
  does not advance the generation. It now runs on both sides of the roster
  question, as `register_input` keeps its own bound. It remains unreachable
  while the two bounds are equal, which is why it has no test of its own.
- **A local name shadowed the session's `pending`** in the new focus effect;
  it is renamed.
- **The record had no gate result for the repaired commit**, the table above.
- **A non-survivor was also listed as a survivor** -- the same-named layers --
  and is now in one list.

The three that did not survive: two phrasings among the Chinese layer names
(each contains its visible label, which is the rule, and the M8.3 Chinese names
do not share one shape either), the survivor accounting as reported (it was
real in a different form, above), and the repair commit's message wording. The
message cannot be amended; where it says the names follow the M8.3 pattern, the
rule it means is that each contains its visible label.

### On the final candidate

The tree of the commit that records this, after the affected-delta repairs,
every gate once and in sequence with direct exit status:

| Gate | Exit | What it established |
| --- | --- | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test --workspace` | 0 | desktop library 1107 passed, 14 ignored; plot-spec 125; proteowizard 513 plus its integration targets; the project store's 108 include 28 layer cases, and the bridge's 29 include 2 |
| `pnpm lint` | 0 | |
| `pnpm build` | 0 | |
| `pnpm test` | 0 | 2092 passed of 2092 |
| `pnpm e2e:typecheck` | 0 | |
| `python -B scripts/check_repo.py` | 0 | run after this record was written |
| `pnpm e2e:browser --spec ./e2e/specs/m8.4-layers.browser.e2e.ts` | 0 | 2 passing, fourteen captured frames; the focus ring read as a 2px solid outline; the project surface and the page scroll sideways by 0 in every frame; each viewport's console ledger empty; evidence under `test-results/m8.4/browser-qOoVdn` |
| `pnpm e2e:browser --spec ./e2e/specs/m8.3-reattachment.browser.e2e.ts` | 0 | 2 passing; `test-results/m8.3/browser-bEXfsg` |
| `pnpm e2e:browser --spec ./e2e/specs/m8.2-provenance.browser.e2e.ts` | 0 | 4 passing; `test-results/m8.2/browser-EqZKA4` |

All browser evidence is React/mock-IPC layout and interaction evidence over a
controlled answer table. None of it is filesystem, persistence or provider
evidence, and none of it is native.

## What M8.5 added on top of this

The first persistent QC summary and the first report surface, recorded here
because it is the first run whose input is a layer rather than a reference,
the first artifact whose facts came from a provider rather than from a
stable read, and because "QC" is a word that invites a grade this slice does
not give.

### What it is, and is not

A **QC summary snapshot** is a typed copy of facts the existing preview
boundary had already established, taken by an explicit press and kept as
history. It is not the M9 QC recipe: no worker, no module, no parameter, no
threshold, no pass or fail, no normalization and no derived quantity. It
describes a run summary; it does not evaluate sample, chromatography,
identification or instrument quality, and the report says so in both locales.

The capture copies. It launches no ProteoWizard, reads, stats or hashes no
source, resolves no installation and recalculates nothing. Where no suitable
retained preview exists it is refused, and it never starts one.

### Where the facts come from

Before this slice the full `RunSummaryResult` was discarded after the preview
reply was built: the page's `RunSummaryDto` keeps the minimum and maximum
retention times only and caps the MS-level buckets. A snapshot built from that
projection would have recorded less than was established, so Rust now
**retains the whole typed result**, beside the chromatogram, in the export
slots -- because that is where "which preview open is the current one" is
already decided. It is retained only inside the same
`ticket == latest_preview_open` critical section the chromatogram uses, and is
dropped the moment `begin_preview_open` starts a newer open of *any* row, so a
preview the reader has navigated away from is not one a capture can reach. It
is named by an opaque session token minted from the slots' own counter; the
`PreviewOpenTicket` itself still never crosses to the webview. `PreviewDto`
carries `qcSnapshotToken` and `qcProducerIdentified`, and nothing else new.

`capture_project_qc_summary(layerId, previewToken)` sends no value. Rust
resolves the layer to its source, the source to the Workbench row this session
remembers for it, and then requires: the token names the summary still
retained; that summary is **of that row** (compared by `DatasetId`, which is
never reused, so a removed and re-added row does not match); the row is still
in the workspace; and the producing build can be identified. A superseded
preview, a preview of another source and a stale token answer
`previewNotCurrent`; a row gone answers `notInWorkbench`; an unidentifiable
build answers `producerUnidentified`. The slot is a leaf lock: the snapshot is
copied out and the lock released before the workspace is asked anything.

### Producer provenance, and why the current backend is not it

The producer is read from the `InstallationIdentity` **the preview's own batch
reported** (`OperationAttempt::installation`, taken from the same attempt as the
facts) and kept with the retained summary. It is never `authority_projection()`
and never a fresh `availability()`: both answer which build is configured
*now*. A preview runs `msaccess` (`bind_capabilities` binds `BoundTool::Msaccess`),
so what is persisted is:

- `tool: "msaccess"`;
- `executableSha256`: the SHA-256 of that `msaccess` executable as discovery
  hashed it around its help probe, in the resolution the preview's batch ran
  under. It is *not* a hash taken at the moment of launch, and nothing here
  claims it is;
- `release`, `buildDate`, `sourceRevision`: the installation's reported build
  identity from that resolution (the release is the one discovery required both
  tools to agree on; the revision is `msconvert`'s probe's), each passed through
  the same path-redacting, bounded label treatment the diagnostics export
  applies, and each explicit `null` where the build did not report it.

No installation path is persisted. A resolution whose `msaccess` help did not
probe carries no digest; its preview reports `qcProducerIdentified: false`, and a
capture of it is refused rather than attributed to a guess. A build label the
document cannot store (empty, too long, a control character) is refused the
same way rather than silently dropped. A session-local binding receipt is not
used as provenance: it names a session binding, not an executable.

### The schema, exactly

The document schema is **3**. Run inputs became a tagged vocabulary and an
artifact holds one tagged payload; every object below refuses unknown fields,
including inside each variant, which is where M8.4's review found the last
silent drop.

```json
{
  "id": "<run uuid>",
  "operation": "captureAcquisitionQcSnapshotV1",
  "inputs": [{ "kind": "layer", "layerId": "<layer uuid>" }],
  "outputArtifactIds": ["<artifact uuid>"],
  "outcome": "completed",
  "applicationVersion": "0.1.0",
  "startedAt": "<rfc3339>",
  "finishedAt": "<rfc3339>"
}
```

```json
{
  "id": "<artifact uuid>",
  "label": "QC summary: <source label>",
  "payload": {
    "kind": "acquisitionQcSnapshotV1",
    "totalSpectrumCount": 12,
    "msLevelCounts": [
      { "kind": "level", "msLevel": 2, "spectrumCount": 4 },
      { "kind": "other", "spectrumCount": 1 },
      { "kind": "level", "msLevel": 1, "spectrumCount": 7 }
    ],
    "chromatogramCount": { "kind": "notReported" },
    "retentionTime": {
      "kind": "reported",
      "minimum": { "value": "0.1", "unit": "notEmitted" },
      "at25PercentBasePeakIntensity": { "value": "12.345678901234567", "unit": "notEmitted" },
      "at50PercentBasePeakIntensity": { "value": "0.30000000000000004", "unit": "notEmitted" },
      "at75PercentBasePeakIntensity": { "value": "7.7", "unit": "notEmitted" },
      "maximum": { "value": "123.456", "unit": "notEmitted" }
    },
    "producer": {
      "tool": "msaccess",
      "executableSha256": "<64 upper-case hex>",
      "release": "3.0.26204",
      "buildDate": null,
      "sourceRevision": "a09eea9"
    }
  }
}
```

The same payload shape can say `{ "kind": "reported", "count": N }` for a
chromatogram count and `{ "kind": "notReported" }` for the retention times; the
current formatter emits neither (the parser always answers no chromatogram
count and always five retention times), so those two branches are exercised at
the record level rather than through the provider. A file-facts artifact is
`{ "kind": "fileFactsV1", "observations": [...] }` under `payload`, and a
file-facts run's `inputs` are `{ "kind": "input", "inputId": ... }` -- it means
exactly what it meant before and round-trips.

Four decisions in that shape, stated rather than implied:

- **Retention times are decimal text, not JSON numbers.** Counts are integers
  and survive a JSON number exactly. A float read back through this build's
  JSON parser, whose exact float mode (`serde_json`'s `float_roundtrip`) is not
  enabled, can land one unit in the last place away from what was written, and
  enabling it would be a dependency change this slice is not authorised to
  make. So each value is stored as the shortest text that reads back to the
  same `f64`, and `validate` refuses any other spelling -- the reader's
  exactness does not depend on the parser. The report displays that text as it
  is; nothing formats it again.
- **Absent is explicit.** An absent chromatogram count and an absent
  retention-time summary are tagged states, and the three optional build labels
  must be present as `null`: a field merely missing from a hand edit is refused
  rather than read as "not reported", and `None` is never zero.
- **The buckets are the formatter's.** Order is preserved, `Other` stays
  `Other`, and nothing is sorted or merged. `validate` holds only the invariants
  the parser itself states: at least one bucket, each numbered level once, at
  most one `Other`, a total equal to the checked sum, and the minimum not above
  the maximum. More than 64 buckets (the bound the preview boundary already
  transfers) is refused at capture rather than truncated.
- **The payload does not store its producing `RunId`.** The task's conceptual
  list included one; its own rule against duplicating lineage a run already owns
  decides the other way, and `lineage.rs` already derives every reverse edge
  rather than storing it. Storing it would also have made an artifact name a
  run -- the edge `lineage.rs` names as the one that would make a cycle
  representable. The producing run is resolved through `outputArtifactIds`, and
  `validate` makes the resolution total instead: a snapshot must be claimed by
  exactly one run, that run must be a `captureAcquisitionQcSnapshotV1` run
  consuming exactly one layer and no reference, and it must be `completed` with
  that one output. A snapshot no run claims is refused as `inconsistentRecord`,
  because its run is its whole lineage. Nor is the `LayerId` stored twice: the
  run names it.

The operation takes no parameter, and is represented as a closed unit variant
of the operation enumeration -- there is no parameter field on a run at all,
not an empty bag. `RecordedOperation::stable_id` now owns the wire spelling
both variants use.

**Schema disposition.** Schemas 1 and 2 were development-only, so a document
carrying either is refused as `unsupportedVersion`, not migrated, by the policy
that already refused schema 1. There is a test that feeds the literal M8.4
shape (a run naming `inputIds`) and gets that refusal. The refusal's sentence is
the neutral one corrected at the start of this slice.

### Atomic commit, and what does not advance the generation

`ProjectStore::capture_qc_snapshot` follows the `create_layer` seam: lock,
resolve the layer, its source and the remembered row, check the history bounds,
release, ask the workspace, validate the snapshot against the document rules,
lock again, and push the run and its artifact **together**. The generation
catches a project replaced, closed, saved elsewhere, or with a record removed or
relinked. Two changes do not advance it -- a layer removed and the source
re-admitted as a different row -- so both are rechecked by value, and each
refuses `staleDocument` with nothing committed. (The interface says a capture's
`staleDocument` and `notInWorkbench` in its own words; their shared sentences are
a save's and a layer's.) Because a capture now adds runs without advancing the
generation, the file-facts commit rechecks its own bounds too, instead of only
checking them before it released the lock.

Each explicit press is its own observation: two captures with identical values
are two runs and two artifacts, and nothing earlier is overwritten.

### Lineage and lifetimes

Report → run → layer → reference is resolved by identifier at every step, in
Rust (`lineage::layer_consuming_runs` is new, and the layer projection now
carries `consumedByRunIds`) and in the page. The layer's own history is shown
apart from its source's. The run names a layer, and nothing names a run, so
`lineage.rs`'s no-cycle argument still holds and says why.

The report is history. Removing the Workbench row, clearing the workspace,
deleting the source, a check that then finds it missing, a relink and a reopen
each leave it exactly as it was, and a later backend change does not rewrite
its producer. A layer a recorded run consumed is refused removal as
`layerUsedByRun`, and since a reference with a layer is already refused
removal, a reference with a QC report cannot be removed either. Nothing is
cascaded: there is no reviewed transaction for removing dependent history, and
this slice does not invent one. That is a stated limitation -- there is no
operation to remove a QC report yet, so its layer and reference stay pinned
until one is designed.

### Privacy

No preview metadata line is copied: those sections are opaque backend text
that can carry local paths and sample names, and recording them is a privacy
decision a later reviewed feature may make. Nor is any run-summary column the
snapshot does not admit (file name, timestamp, vendor, model, serial), any
native spectrum identifier, any path, dataset handle, file identity, backend
output or environment fact. The crossing test writes distinctive values into
the fixture's metadata, run-summary columns and spectrum identifiers and
searches the saved document for them, for the dataset handle, for `dataset`,
`volume`, `fileId`, `identity`, the fake installation folder and the test's own
absolute directory.

### The capture control and the report surface

Nothing new at the top level. Each layer row gains **Capture QC summary**. It is
offered only when the source is in the Workbench, the preview on screen is that
row's, and its build is identified; otherwise it stays reachable with
`aria-disabled` and one reason, in the order a reader must act -- add the source
to the Workbench, view it there, or the build cannot be identified. The first is
read out with the control only, because the row already says "Not in the
Workbench"; the other two are shown under the row. A press sends the layer and
the viewed preview's token; it never starts a preview and never attaches a
source. The keyboard stays on the control, and the new report is inspected on
arrival only if the reader has not chosen something else while the request was
out.

When a QC snapshot is the inspected object, the Project surface's **main region**
shows a compact report above the lists: the source's name and when it was
recorded, one sentence on what it is and is not, and three small tables --
spectra and chromatograms, spectra by MS level in the order reported, and the
five retention times with "Unit not reported" beside each. No grade, no
threshold and no status colour. Counts are digit-grouped, which changes no
digit; retention times are the stored text. A report opened from below brings
its heading into view by scrolling the project surface alone, and only when the
heading is out of view. Details keeps what is not the report's: the record's
kind, where it is stored, the producing run, the source layer, the source
reference with its current state, and the producing build -- tool, release,
build date, revision, digest -- with unreported labels said to be unreported
and a note that a later installation does not change it. Every owned string is
in `en` and `zh-CN`; `MS{{level}}` and the tool's product name are the two values
deliberately identical in both, and are named as such in the coverage test.

### Tests added for the QC snapshot

Rust, through the **real crossing** in `qc_snapshot/tests.rs` -- a real project
store, a real workspace service, a real reattachment of a file the test wrote,
a real layer and a real preview open through a provider that answers the three
open operations with controlled formatter text, run through the production
interpreter, and counts every run and every look at the backend:

- the retained summary becomes one run consuming the layer and one snapshot the
  run produced, with the total, the out-of-order buckets and `Other`, an absent
  chromatogram count, and each retention time bit-for-bit with `notEmitted`;
- Save, Close and Open bring every value back, remember no row, and the saved
  bytes hold none of the planted metadata, run-summary columns, native
  identifiers, the handle, the installation folder or the test's own directory,
  while the payload equals the closed shape above compared as a JSON value;
- a capture with the source already deleted succeeds with the provider's run
  and availability counters unchanged and the reference's state untouched;
- a backend the session has observed and bound after the preview (asserted
  through the authority's own receipt) does not become the producer, with a
  preview the second build produces as the control;
- an unprobed build is reported unidentified before any press and refused, with
  the same row captured once an identified build produced its preview;
- a superseded preview of the same source, a preview left for another source, a
  foreign preview under the wrong layer, a never-issued token and a removed row
  are each refused, with the right layer as the control;
- two presses are two runs and two snapshots; and the report survives the row,
  the workspace and the source going, while its layer and reference refuse
  removal.

Rust, at the store and document level in `project/tests.rs`: the commit and what
it asks; no remembered row refused before the workspace is asked; a workspace
refusal records nothing; a project that moved in five different ways while the
workspace was asked commits nothing and stays valid, with an unmoved control;
the history bound refused before the workspace is asked; the layer-removal
refusal with a layer nothing consumed as its control; the fixture document read
back exactly, including a reported zero count and absent retention times; digest
case normalization; every run that crosses its operation; ten snapshot values
that contradict the contract; eleven fields or omissions refused inside every
nested variant, with the untouched document and an explicit `null` as controls;
and the literal schema-2 document refused as unsupported.

Frontend, in `ProjectQcSummary.test.tsx`: the control offered only for the
viewed source and named by it, with its keyboard reach; each of the three
reasons, visible or read out as described above, sending nothing; a press
sending exactly the layer and the token; the report's values, order, `Other`,
"Not reported" and unreported units; a reported zero and absent retention times;
a late answer not taking the selection (removing the guard fails it, which was
checked on a copy restored byte-identical); report → run → layer → reference in
Details with no request; the report whole after the row leaves and after a
reopen; the stylesheet rules that wrap a long name; each capture refusal and the
layer-removal refusal in its own words; and the whole of it in Simplified
Chinese.

One browser scenario, `e2e/specs/m8.5-qc-summary.browser.e2e.ts`, over the
mock-IPC harness, described with its evidence under the validation record
below.

A mutation check was made on the committed Rust candidate, from a clean tree:
reading the producer from the provider's current `availability()` instead of the
retained snapshot failed both the attribution test and the no-backend test, and
the file was then restored with `git checkout` -- which, the tree having been
clean, discarded nothing else.

## Out of scope, explicitly

Provider-dependent conversion, preview, figures, exports and clipboard remain on
HOLD and are untouched. Layer identity and provenance in the Project model is
M8.4's, and the QC summary snapshot and its report surface are M8.5's, above;
layer identity *inside a figure* is a later M8 slice. The isolated-worker QC
recipe and every other analysis capability are M9's and are not started here.
Release-level GUI and install acceptance stays paused and unwaived: this slice
ends as a locally committed, locally verified child candidate whose publication
still depends on the unqualified M7.6 ancestor beneath it.
