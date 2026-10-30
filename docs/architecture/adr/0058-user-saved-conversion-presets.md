# ADR 0058 — User-saved conversion presets

Status: **Accepted** by the owner on 2026-10-29. The storage contract below is
the one draft PR #151 implements (branch `be/presets`, head `1c215a7`,
`apps/desktop/src-tauri/src/presets.rs`). That PR is not merged, and no
surface lists, saves or applies a preset yet.

*Note, 2026-10-29:* #151 is merged into the integration branch `be/integrate`
(draft PR #161), where `check_intent` is decision 5's structured reader: the
same function a conversion plan reads its `intent` with
(`read_structured_intent`), so its 64 KiB wire bound applies to a preset too.
A value of the wrong shape, a stable id string included, is `notExpressible`;
a refusal of the validating constructor answers with that constructor's
stable id. Still no surface lists, saves or applies a preset.
Related: [0044](0044-conversion-configuration-authority.md),
[0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md);
the M7.5 preference store
([M7.5 record](../../ux/M7_5_PREFERENCES_FIRST_RUN_RECOVERY.md)).

## Context

ADR 0055 offers every msconvert option, verified or labelled "not verified by
MSCanvas", through a typed intent: a format, an encoding, two ordered filter
chains and a set of switches. A user who converts the same way every week would
rebuild that intent by hand each time.

ADR 0055's decision 7 kept a refusal from CNV-D2: "any default or preset that
inserts a picker". It was written when MSCanvas had no presets at all, and it
did not say whose preset it meant. The
[after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#76-refused-or-not-adopted)
listed presets as reversible but not selected, because they overlap M10's saved
typed plans.

## Decisions

### 1. Presets are the user's

- **User-saved only.** A preset is a name and an intent the user saved.
  MSCanvas ships none and writes none on its own.
- **None is selected at startup.** The conversion settings start as they do
  without presets. No preference stores a selected preset, and nothing applies
  one without the user choosing it.
- **Applying fills the intent and runs nothing.** Applying a preset hands its
  intent to the configuration authority (ADR 0044) as if the user had composed
  it. That authority decides at plan time whether the installed build can run
  it, and labels it under ADR 0055. A preset confers no authority, and never
  starts a conversion.
- **A preset may hold a picker step,** because the user wrote it. Applying it
  shows the step's lossy effect in the plan summary, as ADR 0055's decision 1
  requires of any lossy-by-request step.
- **ADR 0055's decision 7 now reads "no default or MSCanvas-authored preset
  inserts a picker".** CNV-D2's "no additional centroiding" lock is unchanged.

The feature catalog's "explicit centroid presets" (CNV-005) and the plan's
"scoped presets" (CNV-005/006) are rows of the verified catalog that a user
selects. They are not presets in this ADR's sense, and this ADR changes nothing
about them.

### 2. Storage: one versioned document beside the preferences

- **One JSON document, `conversion-presets.json`, schema version 1.** It sits
  beside `ui-preferences.json` under the preference store's own binding: the
  same per-user application-local directory, the same task-owned QA root under
  the `e2e` feature, and the same `unavailable` reason when there is none.
  Whatever the uninstaller does with the application data it does with presets
  too; what its "Delete the application data" choice removes is not yet
  observed (after-beta-1 plan, section 7.2).
- **Four commands:** `list_conversion_presets`, `save_conversion_preset`,
  `rename_conversion_preset` and `delete_conversion_preset`. Each is bound to
  the document epoch and runs off the async runtime, like the preference pair.
  A preset is addressed by its name; no command takes a path, a file name or a
  document. Request payloads refuse unknown fields.
- **Bounds:**
  - 512 KiB per document, checked on read and on write;
  - 200 presets;
  - names of at most 80 characters, trimmed, with no control characters, and
    unique ignoring case.
- **Writes reuse the M7.5 mechanism.** Each save, rename or delete is a
  read-modify-write from disk under the store's own lock, which no other lane
  takes:
  1. the store's own reader must accept the new bytes before they are written;
  2. the bytes are published through a private temporary file
     (`publish_through_temporary`, with its own prefix, so a residue names its
     owner);
  3. the stored bytes are read back and compared with the bytes written, and
     only then is the write reported as committed, with the confirmed listing.

  A write that does not complete says so, whether it may be retried, and
  whether a temporary file was left behind. The last confirmed document is
  still what a restart finds.
- **A first run creates nothing.** Listing an absent document lists no presets
  and writes no file.

### 3. Recovery: two levels of unusable, and nothing changed to make it fit

**The document is unusable** when it is malformed, from another schema version,
oversized, unreadable or not an ordinary file (`malformed`,
`unsupportedVersion`, `oversized`, `unreadable`, `unsafeTarget`, the preference
store's vocabulary). A document from a later build reads as
`unsupportedVersion`, not as malformed, and is never migrated. Then:

- it is listed as unusable with its reason, and its bytes are left untouched;
- a save replaces it only with the explicit `replaceUnusable` confirmation,
  with a new document holding only that preset;
- rename and delete refuse with `storedRecordUnusable`, because there is
  nothing in it they could address.

**One preset is unusable** when its intent is not one this build can express
(`notExpressible`). Then:

- it is listed as unusable with its reason and without its intent, so it cannot
  be applied;
- every other write puts it back unchanged;
- it can still be renamed and deleted.

### 4. No overwrite by name

- A save to a name that is taken, ignoring case, is refused with `nameTaken`.
  It replaces that preset only when the request carries `replaceExisting`.
- A rename onto another preset's name is refused with `nameTaken`, always.
  There is no confirmation that lets a rename replace a preset.
- Rename and delete address the exact name as listed, and an unknown name is
  refused with `unknownPreset`. Changing only a name's case is a rename.
- A save past 200 presets is refused with `tooManyPresets`.

Every refusal writes nothing.

### 5. One judge of an intent

`presets::check_intent` is the only judge of a stored intent, on every save and
every listing. The intent is stored as the JSON value the user saved.

- Until ADR 0055's structured intent reaches the wire, it accepts exactly
  today's wire: an admitted row's stable id.
- When it does, `check_intent` becomes "deserialize the structured intent into
  the crate's unvalidated parts and build it with the validating constructor"
  (ADR 0055's dependency note of 2026-10-29), answering the builder's refusal
  code. Nothing else in the store changes.
- A preset saved as a stable id then lists as `notExpressible`, by design, not
  migrated silently. It is kept unchanged, listed as unusable, and can still be
  renamed or deleted; nothing rewrites it to fit.
- The installed build's availability is not checked here. It stays with the
  configuration authority at plan time.

**Floats.** Stored intents are re-serialized from parsed JSON, and serde_json
without its `float_roundtrip` feature may move a float by one ULP on a rewrite.
A write is confirmed by its bytes, so this never fails a write. A tolerance
that must survive rewrites exactly is carried as an integer or a decimal string
in the structured intent; enabling the feature would be a dependency decision.

## Alternatives rejected

- **Shipped presets.** A preset MSCanvas wrote would be an MSCanvas default by
  another name, and one holding a picker is what decision 7 refuses.
- **Restoring the last-used preset at startup.** It would apply settings the
  user did not choose in this session, which a lossy step makes unsafe to do
  silently.
- **Presets inside `ui-preferences.json`.** The preference record holds nothing
  scientific and confers no authority (M7.5). Presets carry intents, so they get
  their own document, version and recovery, under the same binding.
- **Replacing an unusable document or preset to make it fit.** That would
  discard a user's data without asking. It is left as found until the user
  confirms.

## Consequences

- A user can save, rename, delete and apply named intents, across launches.
- MSCanvas still decides nothing on the user's behalf: no preset is shipped,
  selected at startup or applied without a choice.
- The interface, its rendered QA, and the copy for each refusal are still to
  come, in the slice that installs the four commands in a surface.

## What this amends

- [ADR 0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
  decision 7: the preset sentence, by a dated note.
- [The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), sections 2
  and 7.6: presets leave "Reversible, not selected". Target-file import stays
  there.
- In the change that ships the preset interface: the beta's install and support
  page, which lists what the application data folder holds.
