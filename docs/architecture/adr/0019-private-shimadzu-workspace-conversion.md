# ADR 0019 — Private Shimadzu LabSolutions workspace conversion

- Status: Accepted as a private path with no product surface. One internal
  workspace family, one inert wire member, no ingestion, no queue eligibility,
  no command
- Date: 2026-08-10

## Context

Two decisions have to be separate, and this repository keeps splitting them for
the same reason.

[ADR 0018](0018-shimadzu-labsolutions-lcd-source-admission.md) established what
a Shimadzu LabSolutions `.lcd` *is*: recognised one level inside its compound-file
container, converted on one hashed provider build, judged on its output alone.
That is a claim about data, backed by measurement.

Whether the **product** holds one is a different claim. [ADR 0006](0006-multi-dataset-workspace-boundary.md)
refused to let an internal source-family type exist at all while the only
evidence was for mzML, on the ground that *a variant which exists is a claim the
data behind it is understood* — and said such a claim needs its own decision.
[ADR 0011](0011-private-workspace-conversion-path.md) then made the same split
for Thermo: a private path first, a surface later and separately.

So the gap this closes is narrow and was left deliberately. The crate could
convert an LCD from a path. Nothing could convert one from a **dataset** — with
a session identity, an identity lease, a recorded family and a place in the
roster — and nothing had shown that the family survives the join.

## Decision

One internal workspace family, admitted privately, carried whole into the
existing conversion coordinator, and reachable from nothing a user can do.

### One exact internal family

`DatasetSourceKind::ShimadzuLcd`. Not `VendorRaw`, not `CompoundFileVendor`, not
`DirectoryVendor`, and not `SCIEX` or `WIFF` — ADR 0018 refused the last two on
measured evidence and nothing here revisits that.

It is decided at admission and stored on the accepted dataset aggregate, beside
the identity and the lease, not in a parallel map. Duplicate admission of one
object keeps the row it already has, and with it the family that row was first
admitted under. Every mapping over the family is total at compile time — preview
eligibility, queue eligibility, wire projection, diagnostics identifier,
conversion-source kind, revalidation dispatch — so a family added later cannot
inherit an answer, and none of them has a fallback that would let this family be
treated as Thermo or as mzML.

### Recognition is not reimplemented, and here that matters more than usual

`accept_shimadzu_lcd_file` delegates to `ConversionSource::open_shimadzu_lcd_file`
and adds only what the crate cannot: the session's own inspection, and the
identity lease that keeps the object the one that was admitted.

The desktop crate contains no compound-file magic, no sector geometry, no root
storage rule, no marker names and no provider-build strings. It could not
sensibly contain them: a LabSolutions `.lcd` and a SCIEX `.wiff` begin with the
same eight bytes, so the rule that separates them is a reading of the container's
first directory sector under half a dozen fail-closed conditions, all measured
against real acquisitions. A second spelling of that in this crate would be a
second rule the moment either changed.

The extension filter *is* checked on this side as well. That is not duplication
of the recognition: it is what makes the refusal of a wrongly-named acquisition
a statement this boundary makes rather than one it forwards.

### Admission is private, and the picker is untouched

`accept_workspace_file` does not consult the LCD extension. A `.lcd` the user
picks still reaches mzML admission and is still refused by name, exactly as
before this family existed. The one operation that admits the family,
`PreviewService::add_shimadzu_dataset`, takes a Rust-owned path and is compiled
out of the shipped binary — it lives in the same test-only impl block the Thermo
private admission has always lived in, which is also what keeps it from being
dead code under `-D warnings`.

Everything after admission is ordinary: a normal `DatasetId`, a normal lease, a
normal registry row, normal duplicate handling. The family is the only new thing
about it.

### Family-specific revalidation

A Shimadzu row is revalidated under the Shimadzu rule, every time, by
re-admission rather than by remembering. A changed identity, a same-name
rewrite, a missing source, an active writer, a reparse substitution, a wrong
extension, a shared-signature container of another vendor and a structural
mismatch are all refused, and the refusal keeps the family's own identifier
rather than collapsing into a generic one.

There is no fallback to mzML or Thermo admission and no second compound-file
parser.

### The handoff is an object, not a path

The coordinator is the existing private one, generalised only where the family
required it. The order is unchanged and is the whole safety argument: resolve
the handle and claim the request epoch, take the one global backend gate with no
workspace lock held, recheck currency after the wait, revalidate under the
recorded family, bind the current session's installation, require the exact
evidenced provider row **before** anything is created, pin the object against
replacement, re-admit it as `ConversionSourceKind::ShimadzuLcdFile`, and compare
the full workspace and conversion-source identities before a plan exists.

A path match is not sufficient and neither is a name. The comparison is of the
volume serial and file id, which is the platform's own notion of the object.

No second backend gate, `ProcessRunner`, staging lifecycle, validation mode,
finalizer or cleanup engine was created. There is one of each and this family
uses them.

### Provider binding and the evidence row

The installation is the one the desktop session has selected, and the gate is
the crate's own `provider_build_is_evidenced` predicate asked with *this
family's* kind. No build string is copied into the desktop crate.

An honest note about how strong that separation currently is: on the one
evidenced build, Thermo RAW and Shimadzu LCD share a release, a revision and an
executable digest, so no capabilities value distinguishes them. What separates
them is structural — the evidence table carries a row per family and the gate is
asked per family — and that is what the tests pin: the family mapping is
asserted directly, and the crate's own suite requires a Shimadzu row to exist.
A build with a different release, revision or executable digest is refused for
this family before a staging directory could exist.

### Output-only, and chromatogram-only

Shimadzu uses the existing `output_only` vendor validation. `is_fully_verified`
is false by construction: MSCanvas cannot read an LCD, so it cannot compare the
output against the acquisition, and the source-side properties are reported as
*inapplicable* rather than as passed.

A converted document with **zero spectra and many chromatograms is finalized**.
That is not a tolerance added for this family — it is what the contract already
said, and the real second fixture produces exactly that shape (0 spectra, 144
chromatograms). What the contract refuses is a document with no records *at
all*. The deterministic suite states both halves, so the distinction cannot be
lost to a later edit that keys on the spectrum count.

### Product reachability, and the one wire member

No Tauri command admits or converts this family; the command registration list
is asserted not to name it. The picker, folder import, Explorer drop and visible
conversion queue each refuse it. Preview refuses it. Diagnostics export, output
adoption, cancellation and queue semantics are unchanged.

`DatasetSourceKindDto` nonetheless gains an inert `shimadzu_lcd` member, and the
TypeScript union and roster label gain one with it. This is structural rather
than product: the roster carries a family on **every** row and the projection is
total over what Rust can admit. The two alternatives were both worse — reporting
such a row as another family would make the roster lie about what it holds, and
an unknown or optional member would make every row's family a thing the
interface has to guess about, which is the one decision ADR 0006 refused to
leave to a guess. The member grants nothing: no ingestion, no queue eligibility,
no action, and a label so that a row of this family would read correctly rather
than blank if one ever appeared.

## Consequences

- The private vertical is real and measured: a workspace `DatasetId` in, a
  judged output-only report out, for both lawful LabSolutions fixtures.
- The product is unchanged. Nothing a user can click behaves differently, which
  is why this slice needs no rendered QA.
- One inert wire member now exists. It is the smallest honest total model, and
  it is the thing to remove first if this family is ever withdrawn.
- The family/provider separation is currently structural rather than
  observable, because one build evidences both families. A future build that
  evidences only one would make it observable, and nothing needs to change for
  that to hold.

## What this does not decide

- **Visible Shimadzu ingestion.** Making `Add files…` admit an LCD is a product
  claim with its own evidence: what the user is told the product supports, what
  the roster then contains, and what the queue will run. It is the next slice
  and it is deliberately not made here.
- **Folder ingestion and Explorer drop.** Both walk a tree the user did not
  enumerate. ADR 0006's reasoning is unchanged and widening them is not implied
  by admitting a family the user names.
- **SCIEX WIFF, multi-output conversion, directory acquisitions.** All refused
  in ADR 0018 on measured evidence, and untouched here.
- **Preview of a vendor row.** Still unavailable, for both vendor families.
