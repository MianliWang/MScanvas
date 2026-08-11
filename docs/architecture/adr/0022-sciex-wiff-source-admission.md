# ADR 0022 — Private SCIEX WIFF source admission

- Status: Accepted as a private source family with no product surface.
  Add-files support, folder and Explorer-Drop ingestion, queue integration and
  every UI concern remain separately gated
- Date: 2026-08-11
- **Extended by [ADR 0023](0023-private-workspace-sciex-wiff-conversion.md),
  2026-08-11.** Workspace integration named above as gated is now built,
  privately: one `DatasetId` holds a whole bundle and converts from a workspace
  handle.
- **The per-sample completeness gate this ADR opened is closed by
  [ADR 0024](0024-sciex-sample-completeness.md), 2026-08-11**, for this exact
  build and enforced before publication. The statement below that
  declaration/discovery equality cannot prove sample completeness stands and is
  precisely why: completeness is now a conjunction of five links, and that
  equality is one of them. What remains open is narrower and upstream — the
  reader's own enumeration can be short of the acquisition, which no evidence
  available here can check.

## Context

[ADR 0018](0018-shimadzu-labsolutions-lcd-source-admission.md) recorded that no
WIFF posture could be added until a one-source/many-outputs model existed.
[ADR 0021](0021-private-multi-output-conversion-lifecycle.md) built that model
and narrowed the gate to "the model exists; admission evidence does not",
naming exactly what was owed: a lawful multi-sample acquisition run end to end,
the source-side topology, recognition, a provider-evidence row, and a
deliberate decision on staging membership.

All of it is now measured. Recorded in
[the M3.11 evidence document](../../spikes/M3_SCIEX_WIFF_EVIDENCE.md).

Two of those measurements changed the shape of the answer rather than
confirming it.

**The acquisition is not one file.** A SCIEX source is a `<name>.wiff` and a
`<name>.wiff.scan` beside it. Removing the companion does not produce a clean
refusal: the backend exits 1 *and leaves one truncated document per sample* in
the output directory — ten of them for the ten-sample fixture, each about a
seventh the size of the real output and each well-formed enough to open. Every
family this boundary had admitted was a single object, and the whole
source-side apparatus — identity capture, the pre-spawn recheck, the pinned
handle — was built around exactly one.

**The ten-sample acquisition exists after all.** The M3.10 record said the
Enolase input was not in the pwiz tree. That was true of the commit it pinned
and not true generally: the file had been deleted with a test-data tarball in
2019 and restored upstream in 2022. Pinning the newer revision produces a
lawful, 3.9 MB, ten-sample acquisition with ten committed reference outputs
beside it.

## Decision

Admit exactly one new family, privately:

```rust
ConversionSourceKind::SciexWiffBundle
```

recognised as a bundle, bound as a bundle, and converted through the existing
ADR 0021 output-set lifecycle. No second lifecycle, no second staging model, no
second finalizer.

### There is no product surface, and that is a boundary not an omission

`DatasetSourceKind`, its DTO and the TypeScript union are untouched. Add
files…, folder ingestion and Explorer Drop are untouched. No Tauri command
reaches this family; no workspace row can be of it; the queue cannot hold one.
The two arms this slice added to the desktop crate's exhaustive matches reuse
existing codes and existing message strings, deliberately: inventing copy for a
family a user cannot reach would be inventing the surface.

What exists is a boundary a later surface could be built on without loosening
anything.

### Recognition is the container's contents, and the companion's own bytes

The provider's recognition is the file name — `Reader_ABI::identify` is
`iends_with(".wiff") || iends_with(".wiff2")` with an unanswered
`// TODO: check header signature?` above it. That is weaker than this boundary
admits on.

A `.wiff` is a Microsoft compound file, so its first eight bytes are the eight
a LabSolutions `.lcd` begins with; the magic names a container, not a vendor.
What names the family is the set of entries in the container's first directory
sector, read through [`compound_file`](../../../crates/proteowizard/src/compound_file.rs)
— the same reader, the same bounded reach, a different marker set. Four
entries are required, all measured on all three lawful fixtures and absent from
both LabSolutions ones: `SampleSubtree`, `MethodSubtree`, `SampleTable`,
`MassSpecMethod`. The two families' marker sets are disjoint, so no object can
satisfy both rules.

The companion is recognised separately, by its own first 32 bytes, because it
is not a compound file and the container reader cannot speak for it. Binding
whatever sits at `<name>.wiff.scan` would be binding an object nothing looked
at.

`.wiff2` is refused at the extension filter. It shares a prefix and not a
format: its primary is not a compound file at all, it is read by a different
vendor assembly, and this repository has no `.wiff2` acquisition, no
measurement and therefore no admission.

### The companion is derived, never searched for

`Reader_ABI` builds the name as `wiffpath + ".scan"`, so the companion of
`a.wiff` is `a.wiff.scan` — the whole file name plus a suffix, not the stem plus
one. This boundary derives it the same way, from the *admitted primary's
canonical name*, and looks nowhere else.

A directory scan for "the scan file beside this" would be wrong in a way that
is not hypothetical: upstream's own test data holds a `swath.api.wiff.scan`
whose primary is `swath.api.wiff2`, in a directory that also contains two
unrelated `.wiff` files.

### Every load-bearing member is bound, and the bound set is what gets rechecked

`CommandSpec::source_identity` was one `SourceIdentity`. It is now a
`SourceIdentitySet`: a primary plus up to three companions, bounded at four
members total. Single-object families are a set of one and take the identical
path, so there is one recheck rule rather than one per cardinality.

The pre-spawn check in the process boundary confirms **every** member. This is
the part that matters most and is the easiest to get wrong: a companion never
appears in the argv, so a companion swapped between admission and the spawn
would be read by the vendor library and reported by nothing. The run would
succeed, and the documents it published would be of an acquisition the caller
never chose.

The admitted run also reopens, posture-checks, length-checks and digest-checks
each member before building a command, and holds every handle — writers and
deleters denied — for the whole run. Two guards rather than one, at different
layers: the reopen-and-hash is the run's own, and the pre-spawn identity check
belongs to the boundary that owns the moment before a process starts. A spec
built by any other caller still gets the second one.

### The single-output plan refuses this family at the plan

`ConversionPlan::to_mzml` returns `SourceProducesAnOutputSet` for a family whose
backend names its own outputs. Not a cardinality rule: measured, even the
single-sample fixtures come out as `PressureTrace1-6500SysSuit1269.mzML` and
`201208-378803-ABRR-AUG-1.mzML`, so `<stem>.mzML` is a name no acquisition of
this family ever takes. The refusal is at the plan because the mismatch is
between the family and the plan, and is knowable the moment the source is
handed over.

### Staging membership: decided, and closed

ADR 0021 left this open and required a deliberate decision here. The instruction
was to establish first whether the expected member set could be obtained before
publication, and not to assume an option existed.

**It cannot be obtained.** Measured on the evidenced build: no shipped
executable enumerates samples before conversion. `readIds` exists in the library
and no CLI exposes it. `msconvert --runIndexSet` selects by index and does not
enumerate. `msaccess` requires a full read.

**Something else can.** The backend states each document it writes on its own
stdout, immediately before writing it, and the declared set equalled the
produced set on every measured run. That arrives through an anonymous pipe
created by this process and inherited only by the child it spawned — which,
unlike the staging directory, is not somewhere another local process can put
things.

So: **the discovered member set must equal the declared set, or the whole set is
refused.** That restores exactly the property ADR 0021 recorded as lost — an
injected valid mzML was an admission where a single-output run would have given
a refusal, and it is a refusal again.

Three things about this are worth being explicit about rather than tidy.

It is **bound to a build**. The line is a measured behaviour of the exact
`msconvert.exe` the provider row pins by digest, not a documented interface — in
the same way the input spelling and the companion requirement are measured
behaviours of that build. A build whose wording differs is a build with no
evidence row, and the family is refused before it could get here.

It **fails closed**. A declaration that is absent, truncated, over the
lifecycle's bound or not UTF-8 refuses the set. A partial declaration compared
against a whole directory would refuse honest runs and — worse — could be *made*
to match by an injector who knew the prefix.

It compares **names, not counts**, and the encoding was checked before relying
on that: with a non-ASCII output name the declared bytes are UTF-8, byte-identical
to the on-disk name rather than console-encoded. A count check would miss a swap
that preserved the count.

What it does not do: it is a check against additions, not a completeness proof,
and it does not protect a declared member's *content*. An attacker who can write
into the staging directory can still overwrite a declared member before
validation — the exposure that already existed for a single output, unchanged.

## Evidence

Three lawful acquisitions from ProteoWizard's repository at
`1e4c3abccc05626bc215bcf3fee6ed0e33613360` (Apache-2.0), through the admitted
path on release `3.0.26013` / revision `47b13cf` / `msconvert.exe`
`9BB6F5D5…`:

- **Ten-sample Enolase → ten mzML documents**, `fully_finalized`, one per
  sample under backend-chosen names, the same basename set on a second run, no
  residue. The multi-member gate, closed on a real acquisition.
- Both single-sample fixtures → one document each, `fully_finalized`,
  repeatable, no residue; one of them chromatogram-only.
- Both bundle members bound on every run.
- Negative controls on real objects: a LabSolutions container renamed `.wiff`
  with a genuine companion beside it is refused as a structure mismatch; a
  `.wiff` with no companion is refused before anything launches.
- Twelve focused mutations, each removing one guard, all red.

## The gate this slice opens

`Reader_ABI::read` catches a per-sample failure, logs it to stderr and continues.
An acquisition whose samples partly fail to open produces fewer documents,
declares exactly those fewer documents, and **exits zero** — declaration and
discovery agree, and both are short. Nothing here can distinguish that from a
complete conversion, because nothing here knows how many samples the acquisition
holds, and learning that would mean parsing vendor internals this reader
deliberately refuses to parse.

Read from upstream's source rather than reproduced; a lawful fixture with
partly-unreadable samples is not something to go looking for.

**Gate:** before any user-facing SCIEX surface, decide what "converted" is
allowed to mean for an acquisition whose sample count this boundary cannot
establish. A private evidence path may publish what the backend produced; a user
told their acquisition converted is entitled to know that means all of it.

## Consequences

- The gate ADR 0018 opened and ADR 0021 narrowed is closed for admission, and
  reopened one step further out as a completeness question that belongs to the
  surface, not the boundary.
- The source model now has a vocabulary for acquisitions that are more than one
  file. Adding a second such family means measuring its topology and its
  companions' recognition — not redesigning identity, pinning or rechecking.
- The multi-output lifecycle gained one guard, and it applies to both entry
  points: what the backend said it wrote is part of what the staged directory
  has to be.
- No user can reach any of this, and nothing in the product changed.
