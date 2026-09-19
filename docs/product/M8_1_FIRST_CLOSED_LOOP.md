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

Native Windows file-mechanism tests run on task-owned fixtures only, without the
VM and without the provider. Filesystem-specific observations are described as
such: one editor's replace behaviour is not a universal ability to infer how any
file was edited, and cross-directory testing is not cross-volume testing. Where
another volume is unavailable the physical limit is reported rather than
implied.

No scientific-correctness test belongs to this slice. It records relationships
and produces no scientific result.

## Out of scope, explicitly

Provider-dependent conversion, preview, figures, exports and clipboard remain on
HOLD and are untouched. Figure layer identity and provenance, QC summaries and
report surfaces are later M8 slices. M9 analysis capability is not started here.
Release-level GUI and install acceptance stays paused and unwaived: this slice
ends as a locally committed, locally verified child candidate whose publication
still depends on the unqualified M7.6 ancestor beneath it.
