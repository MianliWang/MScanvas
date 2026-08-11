# M3.12 private workspace SCIEX WIFF conversion evidence

- **Status:** A workspace dataset can be a whole SCIEX acquisition, and one
  converts from a `DatasetId` through the private multi-output lifecycle. No
  product surface. The per-sample completeness gate is **open** and is not
  closed by anything here.
- **Date:** 2026-08-11
- **Decision recorded in:** [ADR 0023](../architecture/adr/0023-private-workspace-sciex-wiff-conversion.md)

## Fixtures

The three acquisitions [ADR 0022](../architecture/adr/0022-sciex-wiff-source-admission.md)
pins, re-acquired outside the repository from ProteoWizard at
`1e4c3abccc05626bc215bcf3fee6ed0e33613360` (Apache-2.0, HTTPS, no credentials)
and deleted after measurement. Every byte length and digest re-verified against
that record before use:

| | Enolase | PressureTrace1 | 201208-378803 |
| --- | --- | --- | --- |
| Primary bytes | `2,801,664` | `344,064` | `1,339,392` |
| Primary SHA-256 | `C8BF5E3C…` | `61C9DDEA…` | `B3F7863E…` |
| Companion bytes | `1,143,140` | `81,436` | `2,106,496` |
| Companion SHA-256 | `CE872851…` | `C386453D…` | `20AAF097…` |

## Real workspace conversions

Admitted through `PreviewService::add_sciex_wiff_dataset`, converted through
`PreviewService::convert_workspace_sciex_bundle` from the resulting handle, on
the production provider — release `3.0.26013`, revision `47b13cf`.

| | Enolase | PressureTrace1 | 201208-378803 |
| --- | --- | --- | --- |
| Rows in the workspace | **1** | 1 | 1 |
| Roster byte length | `3,944,804` | `425,500` | `3,445,888` |
| Bound source objects | **2** | 2 | 2 |
| Group outcome | `fully_finalized` | `fully_finalized` | `fully_finalized` |
| Members published | **10** | 1 | 1 |
| Retained finalized objects | 10 | 1 | 1 |
| Validation, per member | `output_only`, 9 verified / 11 inapplicable | same | same |
| `is_fully_verified` | false | false | false |
| Spectra / chromatograms | 0 / 8 per member | 0 / 41 | 2,235 / 2 |
| Backend exit | 0 | 0 | 0 |
| Residue | none | none | none |

The roster length is the acquisition's, both members summed — for Enolase
3,944,804 rather than the primary's 2,801,664. A row that showed only the
`.wiff` would understate that acquisition by 29%.

Output digests were observed and are deliberately **not** recorded as fixture
facts: `msconvert` writes the source's own directory into the document, so the
same acquisition converted from another folder hashes differently.

The rendered report was inspected for disclosure: it carries the opaque dataset
handle, backend-chosen member basenames, measurements and stable identifiers.
No path, no parent directory, no filesystem identity, no raw backend text.

## What was measured about the source, and what was not

Every run printed, from the test itself:

```
published N members; source sample completeness is NOT established
```

That is the whole of the honest claim. `Reader_ABI` catches a per-sample
failure, writes a line to stderr and continues to the next sample, so an
acquisition whose samples partly fail produces fewer documents, declares exactly
those fewer on the backend's own stdout, and exits zero. Declaration and staged
set agree; both are short. Nothing in this boundary can tell that from a
complete conversion, because nothing here knows how many samples the acquisition
holds.

The Enolase run producing exactly ten members is consistent with its ten
samples and is **not** evidence that a short run would have been noticed.

## Deterministic suite

Vendor-free and backend-free. Synthetic bundles are built the way real ones are
— a version-4 compound file with the four SCIEX markers, and a companion
carrying the measured 32-byte prefix — and a substituted backend writes into the
command's `--outdir` and announces each document on stdout the way the evidenced
build does.

Covered: one bundle becomes one row owning both objects; the companion is not a
second row; the roster reports the acquisition's size; both holds are taken;
exact-bundle duplicate returns the existing row; a companion replaced by a
different object is not a duplicate; refusals consume no `DatasetId` (missing
companion, impostor companion, another vendor's container under a `.wiff` name
with a genuine companion beside it); revalidation refuses a rewritten companion,
a missing companion, a rewritten primary and a companion swapped for a
byte-identical copy; the handoff refuses a companion the session did not lease;
a bundle converts to a published set with the exact finalized objects retained;
an undeclared member refuses the whole set; a failing backend publishes nothing;
the coordinator refuses a wrong family and an unknown handle; an unevidenced
build launches nothing; every member is pinned while the backend reads it; a
full publication makes no claim about the source acquisition; and no product
surface admits the family.

## Mutations

Thirteen, each removing exactly one guard.

| # | Guard removed | Result |
| --- | --- | --- |
| 1 | duplicate identity forgets the companions | red |
| 2 | revalidation stops at the primary's identity | red |
| 3 | revalidation stops comparing what each member held | red |
| 4 | the handoff proves only the primary | red |
| 5 | the bundle takes the single-object handoff | red |
| 6 | the roster reports only the primary's size | red |
| 7 | the set coordinator accepts any family | red |
| 8 | the set coordinator skips the provider-evidence gate | red |
| 9 | **only the primary is pinned for the run** | **survived** |
| 10 | a full publication is reported as source-complete | red |
| 11 | a companion swapped for an identical copy is admitted | red |
| 12 | the visible picker routes a `.wiff` to the bundle admission | red |
| 13 | the visible queue treats the bundle family as convertible | red |

**Mutation 9 survived, and the reason is recorded rather than worked around.**
Two guards cover a companion during a conversion and they cover different
intervals. `pin_source_bundle` inside `mscanvas-proteowizard` holds every member
from admission until the run ends; the coordinator's own
`lock_against_replacement` covers the earlier interval, between revalidation and
that admission. The probe test fires from inside the running backend process,
which is inside the crate's window — so it proves the companion is pinned while
being read, and it cannot distinguish which layer is holding it. Reaching the
earlier interval would need a seam in the middle of the coordinator, and the
deterministic suite does not invent one for a window a real replacement would
have to win a race to use.

Two further mutations were considered and not run, for stated reasons rather
than silently:

- **Partial finalization collapsed into an ordinary failure.** The desktop layer
  cannot produce a `PartiallyFinalized` run deterministically: it requires a
  destination name to become occupied *between* the whole-set preflight and a
  member's publication, and the only deterministic way to arrange that is the
  seam inside `mscanvas-proteowizard`, which the desktop crate does not reach.
  The crate's own suite holds those semantics; this layer's obligation is not to
  lose them, and it carries the shape whole rather than mapping it to a refusal.
- **Only the primary's authority is stored.** Not expressible as a
  one-line removal — the aggregate would not compile without its companion
  field — so it is covered instead by mutations 1, 2, 3, 4 and 6, each of which
  removes one *use* of that stored authority.

## Cleanup

All three acquisitions, their companions, every converted output, every
destination and every scratch directory were deleted after measurement. No
vendor data is tracked and no local path appears in this record.
