# M3.14 private SCIEX output-set adoption evidence

- **Status:** One fully finalized, sample-complete SCIEX conversion can adopt
  its whole output set into the workspace as ordinary mzML rows. Private; no
  product surface.
- **Date:** 2026-08-11
- **Decision recorded in:** [ADR 0025](../architecture/adr/0025-private-sciex-output-set-adoption.md)

## What was already there

[ADR 0016](../architecture/adr/0016-explicit-converted-output-adoption.md)'s
boundary already did the hard part, and already did it for **several** outputs
at once — a queue finalizes many items and one adoption attempt processes them
all in order. It proves exact object *and* exact validated bytes per output,
refuses one candidate without abandoning the rest, decides duplicates before
capacity, hashes outside the workspace lock, and commits under a reserved
generation.

What it did not have was a ticket whose cardinality was anything but one:
`FinalizedOutputAdoptionTicket` binds one output name and one retained object,
and `QueueItem.adoption` holds at most one of them.

So the ordered multi-candidate engine was **lifted, not rewritten**: the reading
half and the committing half became `inspect_adoption_candidates` and
`commit_adoption_candidates`, and both paths call them. The evidence that the
visible behaviour did not change is that the nine tests pinning it pass
untouched.

## The set ticket

Minted only from a conversion that really happened, taking the retained objects
**by value**. There is no path in it from which an output could be found again
by name — which is the whole point, since a name is what this boundary exists
not to trust.

Eligibility is a conjunction, and the constructor fails closed on each part:

| Refused when | Stable id |
| --- | --- |
| the group outcome is not `fully_finalized` (partial, skipped, refused) | `output_set_not_fully_finalized` |
| sample completeness was never established | `output_set_completeness_not_established` |
| retained objects and reported members do not pair one-to-one, in order, all finalized, within the lifecycle's bound | `output_set_members_do_not_pair` |

Members are the existing single-output tickets, unchanged: nothing about how one
output is proved differs because there are ten of them.

## The two partials, kept apart

They are easy to conflate and mean opposite things.

- **`PartiallyFinalized`** — the conversion never produced the complete set.
  **No ticket.** The members it did publish are real files the user owns;
  nothing deletes, hides or rolls them back, and they open the way any other
  mzML on disk opens. Offering them through an action named for the
  acquisition's output set would present a conversion that stopped halfway as
  one that finished.
- **A partial adoption** — the conversion *did* produce the complete,
  sample-complete set, and the workspace could not take every member: one was
  replaced, one is gone, capacity ran out. Those are per-member outcomes in the
  existing vocabulary, and the valid members are still adopted.

## Real evidence — the ten-sample Enolase acquisition

Re-acquired outside the repository from ProteoWizard at
`1e4c3abccc05626bc215bcf3fee6ed0e33613360`; both recorded digests verified
before use (`C8BF5E3C…` / 2,801,664 and `CE872851…` / 1,143,140). Converted and
adopted through the private Rust boundaries on the evidenced build.

| | value |
| --- | --- |
| Group outcome | `fully_finalized` |
| Published members | 10 |
| Retained finalized objects | 10 |
| Sample completeness | established, `sample_count` 10 |
| Ticket | `FinalizedOutputSetAdoptionTicket { members: 10, sample_count: 10, .. }` |
| Adoption outcomes | 10 × `added`, in publication order |
| Workspace rows after | **11** — the acquisition, still one bundle row, plus ten outputs |
| Adopted row family | `mzml`, every one |
| Preview state after | none, on any row |
| Ticket / result `Debug` | no path |
| Second adoption | 10 × `already`, no row added |

## Deterministic evidence

Vendor-free and backend-free, over synthetic bundles and a substituted backend.

| Case | Result |
| --- | --- |
| ten-member set | ten `added` in publication order, all `mzml`, source row untouched |
| adopt twice | ten `already`, same handles, no new rows |
| byte-identical impostor at one member's name | that member `output_changed`, the others adopted |
| one member rewritten in place | `output_changed` — same object, so only the digest sees it |
| one member's name removed | `output_missing`, the others adopted |
| one member already a workspace row | `already`, no duplicate id |
| partially finalized conversion | **no ticket**; the occupied file untouched; no row added |
| completeness refused (M3.13) | nothing published, nothing retained, `output_set_not_fully_finalized` |
| skipped set | retained nothing of its own; `output_set_not_fully_finalized` |
| fully finalized, completeness stripped | `output_set_completeness_not_established` |
| report and objects that do not pair | `output_set_members_do_not_pair` |
| adoption twice over | the backend ran once; no row holds preview state |

## Mutations

Eight, each removing one guard.

| # | Guard removed | Result |
| - | ------------- | ------ |
| 1 | a ticket is minted for a set that did not publish whole | red |
| 2 | a ticket is minted without established completeness | red |
| 3 | members and retained objects no longer have to pair | red |
| 4 | the exact-object check | red |
| 5 | the exact-bytes check | red |
| 6 | capacity evaluated before duplicates | red |
| 7 | one refused member aborts every other valid member | red |
| 8 | **a superseded output-set adoption may commit** | **survived** |

**Mutation 8 survived, and the reason is recorded rather than worked around.**
The generation is checked once per candidate during the reading half and once
more before the commit. The final check guards only the window between the last
candidate's check and the commit — one file hash wide — and a single-threaded
test cannot move the workspace inside it. It is the same guard, in the same
lifted code, that protects the visible adoption, whose own suite covers document
staleness rather than this window. Closing it would need a concurrency harness
that raced a workspace mutation against a hash, and a racing test that usually
wins is worse than an honest gap.

Two further mutations from the brief were considered and not run:

- **A ticket reconstructed from report names instead of retained objects.** Not
  expressible as a removal: the constructor takes `FinalizedOutputSet` by value
  and there is no path from a name to an object. Making it possible would mean
  writing the reconstruction first, which is the thing the design refuses.
- **Adopted outputs keep the SCIEX family.** Structurally unreachable: adoption
  admits every candidate through `accept_mzml_file`, which can only produce
  `DatasetSourceKind::Mzml`. There is no field to flip.

## Product reachability

Unchanged and none. The whole path — the set ticket, the mint and the adoption
entry point — is compiled out of the shipped binary, like the conversion that
feeds it. No Tauri command, no DTO, no frontend, no queue integration, no
adoption UI. The visible single-output adoption keeps its exact DTO, semantics
and copy.

## Cleanup

The acquisition, its companion, every converted output and every scratch
directory were deleted after measurement. No vendor data is tracked and no local
path appears in this record.
