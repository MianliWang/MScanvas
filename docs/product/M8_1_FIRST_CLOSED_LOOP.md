# M8.1 — first closed loop: project, input/artifact/run record, save, reopen

Scope: **this loop only.** Not M8 in full, not M9 or M10, and explicitly not a
general framework built ahead of its first consumer. QC summaries, report
surfaces and figure layer identity are later M8 slices and are out of scope here.

## The loop

```
create project -> record input / artifact / run relationships -> save
              -> reopen -> resolve each input (present | missing | changed)
              -> minimal visible consumer -> automated tests
```

## What already exists, and what is missing

Grounded in the current code rather than assumed.

| Need | Today | Gap |
| --- | --- | --- |
| Identify an input file | `FileIdentity { volume_serial: u64, file_id: [u8;16] }` from the filesystem, and `DatasetIdentity { primary, companions }` | Both are in-memory. `FileIdentity` names *a file object on a volume*, which is the right answer for one session and the wrong one across machines |
| Refer to a dataset | `DatasetId(u64)`, a per-session counter, never reused in-process | Explicitly **session-scoped**; cannot survive a restart, so it cannot be what a saved project stores |
| Persist anything | UI preferences persist to the real production config directory | The workspace roster, its datasets and its conversion outputs persist **nothing** |
| Re-admit a file later | Every member is inspected and leased at admission | No path from a saved record back through admission |

`DatasetIdentity`'s `Debug` deliberately prints `<opaque-dataset-identity>`,
because "printing one would put a machine-correlatable fingerprint of the user's
files somewhere nobody meant to publish". A project file that writes
`volume_serial` + `file_id` to disk is exactly that act, so the durable identity
is a product decision and not a serialization detail.

## Genuinely undecided product semantics

Only these. Everything else in the loop follows from existing contracts.

### S1. What durable identity does a recorded input carry?

`FileIdentity` survives a rename and an in-place edit, but not a copy to another
volume or another machine — a correctly relocated project would report every
input missing. A content digest survives relocation but cannot tell two identical
copies apart and costs a full read per input at reopen. A path survives neither
reliably.

Decision needed: which of these a record carries, and in what order they are
consulted. Recommendation to confirm: store **path + size + modified time +
`FileIdentity`**, resolve by `FileIdentity` first and fall back to path, and
treat a path-only match as *relocated*, not as *present*.

### S2. What counts as "changed", and is it distinct from "missing"?

Same file object with different size or modified time is a content change. A
different file object at the same path is a replacement. Both differ from an
absent path. Decision needed: whether the loop reports three states (present /
changed / missing) or folds replacement into changed. Recommendation to confirm:
**four** — present, relocated, changed, missing — because relocated is the case a
user can fix trivially and the others are not.

### S3. Privacy stance on persisting identity

Decision needed: whether `volume_serial` + `file_id` may be written to a project
file in the clear, given the existing refusal to print them. Options: store them
plainly (a local file the user already owns); store a salted hash of them (still
comparable locally, not correlatable if the project file is shared); or store
none and accept path-only resolution. Recommendation to confirm: **salted hash,
salt stored in the project file**, which keeps local comparison exact and makes a
shared project file uncorrelatable.

### S4. Does reopening re-admit, and what if admission now refuses?

Reopening must not hand out a dataset handle that never passed admission.
Decision needed: whether reopen re-admits eagerly for every input, or lazily on
first use, and how an input that resolves but is now refused is presented.
Recommendation to confirm: **resolve eagerly, admit lazily**, and show a refused
input as its own state rather than as missing.

### S5. What is a run, minimally?

For this loop a run needs only: what produced an artifact, from which inputs,
when, and whether it completed. Decision needed: whether a run records its
parameters now or later. Recommendation to confirm: record an opaque parameter
blob now and give it structure when the first real consumer needs it.

## Implementation outline

Smallest thing that closes the loop. No new crate, no plugin surface, no generic
persistence layer.

1. **Record types** in the desktop backend beside the existing selection code:
   `ProjectRecord { schema_version, salt, inputs, artifacts, runs }`,
   `InputRecord` per S1/S3, `ArtifactRecord`, `RunRecord` per S5. Versioned from
   the first write; an unknown `schema_version` refuses to open rather than
   guessing.
2. **Save/open** to a single JSON file under the existing production config root.
   Atomic replace (temp file, then rename), never a partial overwrite.
3. **Resolution** on reopen: per input, produce present / relocated / changed /
   missing / refused per S2 and S4. Pure function over the record plus what the
   filesystem answers, so it is testable without a UI.
4. **Commands**: `create_project`, `save_project`, `open_project`,
   `describe_project_inputs`. Thin wrappers over the service, matching the
   existing command style.
5. **Minimal visible consumer**: a Project area that lists inputs with their
   resolved state, and one action per non-present state (locate, re-accept,
   remove). It must show a changed and a missing input distinguishably — that
   visible distinction is the consumer, and without it the loop is not closed.

## Automated tests

Run with development, not deferred to an acceptance window.

- **Unit**: resolution states — each of present / relocated / changed / missing /
  refused from constructed filesystem conditions; identity round-trip; salted
  hash stability within a project and difference across projects.
- **Contract**: record schema round-trips; an unknown `schema_version` refuses;
  a truncated or corrupt project file refuses without partial state.
- **Integration**: create → record → save → reopen → resolve, over a temp
  directory, including a file moved between directories, a file edited in place,
  and a file deleted.
- **Native mechanism**: `FileIdentity` genuinely distinguishes a replaced file
  from an edited one on Windows — the assumption S1 and S2 rest on.
- **Visible consumer**: the Project area renders changed and missing
  distinguishably, and each offered action reaches the right command.

No scientific-correctness test belongs to this slice; it records relationships
and produces no scientific result.

## Out of scope, explicitly

Provider-dependent conversion, preview, figures, exports and clipboard remain on
HOLD and are untouched. Figure layer identity and provenance, QC summaries and
report surfaces are later M8 slices. M9 analysis capability is not started here.
Release-level GUI and install acceptance stays paused and unwaived.
