# ADR 0021 — Private one-source / multi-output conversion lifecycle

- Status: Accepted as a private lifecycle with no product surface and no
  admitted source family. Evidence-only entry point; SCIEX WIFF admission,
  workspace integration, queue integration and every UI concern separately
  gated
- Date: 2026-08-10
- **Superseded in part by
  [ADR 0022](0022-sciex-wiff-source-admission.md), 2026-08-11.** Both gates
  this ADR left open are closed there: a lawful ten-sample acquisition ran
  through this lifecycle on the evidenced build, and staging membership is
  decided — the discovered set must equal the set the backend declared on its
  own stdout. `SciexWiffBundle` is now an admitted family, so the statements
  below that no source family is admitted describe this ADR's slice and not
  the current boundary. Everything else here stands.
- **Extended by [ADR 0024](0024-sciex-sample-completeness.md), 2026-08-11.**
  The lifecycle gained one closed `PrePublicationRequirement`, examined after
  the backend exits and before discovery. `fully_finalized` is unchanged and
  still means *every admitted output member was validated and published*; a
  family may now additionally be required to show it lost no source sample, and
  that judgement is reported beside this outcome rather than folded into it.
- **Extended by [ADR 0023](0023-private-workspace-sciex-wiff-conversion.md),
  2026-08-11.** This lifecycle now has a workspace caller: a private
  coordinator carries an admitted bundle from a `DatasetId` into
  `run_admitted_multi_output_conversion` and projects the result into a
  path-free workspace report that preserves all four group outcomes, partial
  finalization included.

## Context

Every source family this repository admits produces exactly one mzML, and the
conversion boundary is built on that: the plan derives one output basename
before execution, staging requires exactly one planned entry, validation
retains that one object, finalization renames it, and Fail/Skip is decided
against one known name before anything runs.

[ADR 0018](0018-shimadzu-labsolutions-lcd-source-admission.md) measured the
topology that does not fit: a SCIEX WIFF acquisition yields one mzML **per
sample**, named by the backend, and ProteoWizard's own repository commits ten
reference outputs for one acquisition. ADR 0018 recorded that as a gate — *no
WIFF posture may be added before a one-source/many-outputs model exists* —
rather than forcing it through a single-output plan.

This ADR is that model. New measurements against the two lawful, re-acquirable
WIFF fixtures sharpened the motivation in a way worth stating first: **even a
single-sample WIFF does not fit the single-output plan**, because `msconvert`
names the output itself — `PressureTrace1.wiff` converts to
`PressureTrace1-6500SysSuit1269.mzML`, the stem plus a sample name the plan
could never have derived. Backend-authoritative naming, not output count, is
the property that makes this lifecycle necessary.

## Decision

One private lifecycle:

```text
one logical source → one backend run → 1..MAX bounded mzML documents
```

implemented in `conversion_run::output_set`, reusing the reviewed process
boundary, the private staging ownership, the fail-closed mzML scanner, the
handle-bound no-clobber finalization and the identity-bound cleanup — and
introducing no second implementation of any of them.

### No source family is admitted

There is no `SciexWiff` in any source-family vocabulary, no recognition, no
provider-evidence row, and no way for a suffix or a fixture to construct a
production `ConversionSource`. The entry point
(`run_multi_output_conversion_evidence`) takes a Rust-owned path, is documented
as evidence-only, and deliberately consults no provider-evidence table — gating
belongs to the source admission that does not exist yet. The ADR 0018 gate on
WIFF *as a source* stands unchanged.

What this ADR claims is exactly one thing: **the output-set lifecycle fits the
measured WIFF output behavior.** It does not claim MSCanvas safely admits
SCIEX WIFF as a source.

### The output-count bound

```rust
MAX_CONVERSION_OUTPUTS_PER_SOURCE = 24
```

The measured multi-output set is ten (the committed Enolase reference outputs);
24 is more than double that, and deliberately not the queue capacity (16) or
any workspace bound — it limits how many objects one run may open, validate and
retain at once, which is a different resource with a different owner. A run
producing more is refused whole rather than truncated: a truncated set would
publish an acquisition minus some of its samples and call that a conversion.

### Output names are discovered, not planned

The private staging output directory is the sole authority for what the backend
produced. Nothing infers membership from stdout, stderr, source sample counts
or name prefixes. After a clean exit, discovery refuses: zero entries; more
than the bound; any non-regular member (directory, link, reparse point); any
partial-output suffix; any name that is not an mzML document under exactly one
safe path component with a non-empty stem; and any two names that collide under
Windows filename folding.

The set command consequently has no `--outfile` — measured directly: the
backend names its outputs and the plan cannot.

### Ordering is application ordering

Members are reported and published in the repository's stable Windows filename
order. That is deterministic application ordering, **not** evidence of SCIEX
sample order; nothing parses sample numbers or vendor naming conventions, and a
later SCIEX-specific admission may establish a stronger mapping only if
evidence supports one.

### All members validate before any is published

Every staged member is opened no-follow with writers denied, scanned through
the existing fail-closed scanner, hashed through the held object, and judged
under the existing output-only contract — including the per-member
source-object recheck — before the first member receives a destination name. A
chromatogram-only member is valid (the real `PressureTrace1` output is 0
spectra, 41 chromatograms); a member with no records at all is not. One bad
member publishes nothing, whatever the others looked like, and the validated
objects themselves are retained: publication renames the judged object, never a
path resolved twice.

### Conflicts are knowable only after the work

The final basenames do not exist until the backend has run, so **destination
conflicts may only become knowable after conversion work has already been
performed**. That is a property of the topology, recorded rather than papered
over: the single-output pre-run conflict check does not apply here. Once every
member is validated, the destination is inspected for the complete name set
before the first member publishes.

Group semantics, with no overwrite anywhere:

- **Fail** — any occupied name refuses the whole set; nothing publishes;
  every existing destination object is untouched.
- **Skip** — every name occupied: the whole set steps aside as skipped, and no
  existing file is inspected or ever called this run's output. A strict subset
  occupied: the set is refused as a mixed conflict and nothing publishes —
  publishing around the conflict would present a partial acquisition as
  converted, and skipping the whole set would present it as already converted
  when part of it is not.

### Multi-file publication is not atomic, and is not described as atomic

Windows provides an object-bound single-file rename, not a transaction that
publishes N files at once. Members publish one at a time in the deterministic
order, each through the existing handle-bound no-clobber rename, each retained
as a `FinalizedOutput` before its rename. When member K fails after members
0..K-1 published:

- the published prefix is **not** rolled back — a published output is the
  user's file, and deleting it would destroy data to fake an atomicity the
  platform never offered;
- publication stops; later members are never published;
- the still-staged members are cleaned by the owning staging teardown;
- the result is the explicit `PartiallyFinalized` outcome, naming the
  finalized prefix, the failed member, the filesystem's reason and the
  unpublished remainder — bounded basenames only.

A failure on the very first member published nothing and is an ordinary
refusal, not a partial state.

### The staging directory is proved fresh, twice

Discovery attributes every member of the staged output directory to the
backend, so a file injected into it before the spawn would be published as a
conversion output and credited to the acquisition. The set command is therefore
built with the same fresh-directory safety the preview commands carry:
emptiness is established when the command is built, and the runner rechecks it
immediately before spawning. Found in review; the gap was real, and the fix is
the existing mechanism rather than a new one.

### What the staging directory's authority does and does not establish

Discovery trusts the staged output directory's contents, and it is worth
stating exactly how far that trust reaches. The directory is created
exclusively inside the destination root the user chose, proved empty when the
command is built, and rechecked empty immediately before the spawn. Between
that recheck and the post-run snapshot, an open directory handle does not stop
another local process with write access to that root from creating a file
inside it — Windows pins the directory against rename and deletion, not
against having entries added.

For a single-output run such an entry is refused: the boundary requires
exactly one planned entry, so an extra file fails the run. For a set, an
injected *valid* mzML is indistinguishable from a backend member and would be
validated, published and attributed to the acquisition. That asymmetry is real
and is introduced by this slice. The related exposure is not new — an attacker
who can write into that directory before validation can already substitute the
content of a single output — but the set case turns a refusal into an
admission, which is worse.

Closing it needs a mechanism this slice does not have: either a restrictive
DACL on the staging directory, which does not exclude the same user's other
processes and adds new unsafe Win32 surface for partial protection, or
per-file provenance the backend does not offer. Neither belongs in a
foundation slice, and neither should be pretended.

**Gate:** before a multi-output family is admitted to any product path, decide
staging exclusivity deliberately — establish member provenance from something
stronger than a shared directory snapshot, or document the trust as part of
the product's threat model. A private evidence lifecycle may rely on a
directory the operator owns; a user-facing conversion should not have to.

### Failures keep what the backend said

A run worth diagnosing retains a bounded, redacted `BackendDiagnosticText` —
the backend rejected the input, did not complete, or exited cleanly and
produced something the lifecycle refused. Without it the companion-missing
failure this slice measured would be unexplainable from the report. A
finalized or skipped run retains none, exactly as the single-output boundary
retains none, and the redaction is the same discipline: acquisition,
destination, staging, executable, installation and temporary folder replaced
before any byte is kept.

### Member names are display facts, not debug facts

A backend-chosen basename embeds the vendor's own sample identifiers —
measured: `PressureTrace1-6500SysSuit1269`, `201208-378803-ABRR-AUG-1`. Reports
carry them deliberately, through accessors; **every** debug projection in this
module redacts them, including the aggregate report and outcome, because a
debug string reaches logs and panic messages nobody meant to publish.

### Retained objects, staging, cancellation

Each published member is retained as the existing `FinalizedOutput` — the same
exact-object invariant ADR 0016's adoption relies on — collected in a
`FinalizedOutputSet` that lives beside the path-free report, renders as a
count, and on drop closes handles and deletes nothing. The staging area is the
existing owned lifecycle unchanged except for the one generalized assumption:
its output directory may hold 1..24 ordinary mzML files. Cleanup handles zero
outputs, several, validation failure, full and partial finalization,
cancellation and process failure; marker deletion remains last.

Cancellation reuses the existing primitive: requested before the run, nothing
is created; confirmed mid-run, nothing publishes, staged partials are cleaned,
and the confirmed-tree-termination rules are the process boundary's own.

### The single-output boundary is untouched

`ConversionPlan::to_mzml`, `run_conversion`, `run_conversion_cancellable` and
`ConversionRunOutcome` keep their public meaning. The set lifecycle is a
separate bounded path sharing the scanner, the validated-object type, the
finalizer and the cleanup primitives — chosen over threading a cardinality
parameter through the existing boundary because it risks nothing already
shipped. Every admitted family still requires exactly one planned output, and
still rejects zero outputs, a second mzML, and a sidecar; the mutation suite
holds both boundaries.

## Evidence

Recorded in [the M3.10 evidence document](../../spikes/M3_MULTI_OUTPUT_EVIDENCE.md);
the decisive measurements:

- Both lawful re-acquirable WIFF fixtures at the pinned commit
  (`PressureTrace1.wiff`, `201208-378803.wiff`) are **single-sample**: one
  mzML each, backend-named, with the same basename set on repeat.
- The `.wiff.scan` **companion is required**: without it the backend exits 1 —
  and still leaves a partial document in the output directory, which the
  lifecycle refuses and cleans rather than publishes.
- Output digests are location-dependent (the document embeds the source
  directory), so no output SHA-256 is recorded as a portable fixture fact.
- The real end-to-end lifecycle over both fixtures: discovery of the
  backend-chosen name, output-only validation (one output is chromatogram-only
  with 0 spectra and 41 chromatograms; the other holds 2,235 spectra at
  29.6 MB), no-clobber publication, retention, no residue.
- The ten-member shape is exercised deterministically, shaped exactly like the
  committed reference set.

## The honest gates that remain

The Enolase acquisition behind the ten committed reference outputs is **not in
the pwiz tree at the pinned commit**, and no lawful multi-sample WIFF was
available to re-acquire. Real-backend evidence therefore covers the lifecycle
end to end at set size one, and the multi-member behavior is proven against
synthetic sets plus the upstream reference outputs' documented shape.

**Gate:** before SCIEX WIFF source admission, obtain one lawful multi-sample
acquisition and run it through this lifecycle on the evidenced build, confirming
set size > 1, per-sample naming, repeatability, and publication. The admission
slice also owes the source-side topology this ADR deliberately did not decide:
companion-file identity and pinning (the `.wiff` alone is not the acquisition),
recognition, and a provider-evidence row — and the staging-exclusivity decision
recorded above.

## Consequences

- The gate ADR 0018 recorded is narrowed from "no output model exists" to "the
  model exists; admission evidence does not".
- A later WIFF admission consumes this lifecycle; it does not redesign
  publication semantics.
- The partial-finalization vocabulary exists now, before any user can reach
  it, so the later product surface inherits an honest result model rather than
  retrofitting one.
