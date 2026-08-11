# M3.10 multi-output conversion lifecycle evidence

- **Status:** A private one-source/multi-output lifecycle implemented and
  measured against the real backend. No source family admitted; SCIEX WIFF
  remains gated.
- **Date:** 2026-08-10
- **Decision recorded in:** [ADR 0021](../architecture/adr/0021-private-multi-output-conversion-lifecycle.md)

This record closes part of the gate ADR 0018 left open — *a
one-source/multi-output conversion model does not exist* — and states precisely
which part remains.

## Fixture provenance and lawful-use basis

The pinned commit and licence basis are the ones ADR 0018's record established:
the ProteoWizard repository at `8f945db389acc21faf1d59eb88c3f10f5b1be242`,
root `LICENSE` Apache-2.0, retrieved over HTTPS with no credentials, downloaded
outside the repository and deleted after measurement.

| Item | Fixture A | Fixture B |
| --- | --- | --- |
| Repository path | `pwiz/data/vendor_readers/ABI/Reader_ABI_Test.data/PressureTrace1.wiff` | `pwiz_tools/BiblioSpec/tests/inputs/201208-378803.wiff` |
| Byte length | `344,064` | `1,339,392` |
| SHA-256 | `61C9DDEADC6A6E243A42E071B0B58AD8358A7522B4507643F2AE3722006F2374` | `B3F7863EE472AA82749FC4864CC50EC1374507123CA179ED0290022521FAA892` |
| Companion | `PressureTrace1.wiff.scan`, `81,436` B, `C386453D…` | `201208-378803.wiff.scan`, `2,106,496` B, `20AAF097…` |
| Downloaded | 2026-08-10 | 2026-08-10 |

**A material provenance fact, measured rather than assumed:** the Enolase
acquisition behind the ten committed reference outputs
(`Enolase_repeats_AQv1.4.2-20070918_en_01..10.mzML`) is **not present in the
pwiz tree at the pinned commit** — only its outputs are. The two fixtures above
are the only lawfully re-acquirable WIFF acquisitions there, and both are
single-sample.

## Measured output topology

On the exact evidenced build (release `3.0.26013`, revision `47b13cf`,
`msconvert.exe` `9BB6F5D5…`), via argv lists through the reviewed process
boundary:

| | Fixture A | Fixture B |
| --- | --- | --- |
| Outputs (with companion) | **1** | **1** |
| Backend-chosen basename | `PressureTrace1-6500SysSuit1269.mzML` | `201208-378803-ABRR-AUG-1.mzML` |
| Same basename set on repeat | yes | yes |
| Without `.wiff.scan` companion | exit `1`, "Could not open data stream. Is a required 'scan' file missing?" — **and a partial document left in the output directory** | same |
| Output digest location-dependent | yes — the same acquisition converted from a different directory hashes differently | not separately measured; the format embeds source location as A shows |

Three findings shape the model:

1. **Backend-authoritative naming is the rule even at one sample.** Neither
   output carries the planned `<stem>.mzML` name; the backend appends the
   sample's own name. A single-output plan with a derived name cannot convert
   any WIFF, whatever its sample count.
2. **The `.wiff` file alone is not the acquisition.** The companion is
   required, and a run without it fails *after* writing partial output — a
   source-topology fact the later admission slice owns, and a failure shape
   the lifecycle already cleans up.
3. **The ten-output shape rests on upstream's committed reference outputs.**
   `Reader_ABI::read` pushes one `MSDataPtr` per sample and pwiz commits ten
   reference mzMLs for the one Enolase acquisition; with that input not in the
   tree, no lawful multi-sample real-backend run was possible here.

## Real lifecycle evidence

`run_multi_output_conversion_evidence` on the exact evidenced build, through
the production `SystemProcessRunner`, per fixture:

| | Fixture A | Fixture B |
| --- | --- | --- |
| Outcome | `fully_finalized` | `fully_finalized` |
| Members discovered | 1 (backend-chosen name) | 1 |
| Validation | `output_only`, 9 verified, 11 inapplicable | same |
| Spectra / chromatograms | **0 / 41** | 2,235 / 2 |
| Output byte length | 531,259 | 29,652,763 |
| Retained finalized objects | 1 | 1 |
| Residue | none | none |
| Repeat run | same basename set, `fully_finalized` | — |

The chromatogram-only member (fixture A's real output) validates and finalizes
— the contract accepts 0 spectra with real chromatograms and still refuses a
document with no records at all.

The companion-less copy of fixture A through the same lifecycle:
`refused_before_publication` / `multi_output_backend_rejected`, zero members,
zero destination entries, no residue — the partial document the failing backend
wrote was cleaned with the staging area, never published.

## What the deterministic suite adds

The multi-member behavior the real fixtures cannot exercise is proven over
synthetic sets shaped like the committed reference outputs: ten-member
discovery in stable order; the 24-member bound refused at 25; sidecars,
partial-suffix names, directories, links, stemless names and Windows-folded
duplicates each refusing the whole set; all-before-any validation with one bad
member publishing nothing; group Fail/Skip semantics with no partial skip; the
deterministic mid-set race producing an explicit `PartiallyFinalized` with the
published prefix kept, no rollback, and the remainder cleaned; cancellation
before and during the run publishing nothing; and the single-output boundary
still refusing a second output or a sidecar. Twelve focused mutations, each
removing one of those guards, go red.

**One mutation is structurally unreachable on this machine and is recorded as
such.** The case-only duplicate check exists for a case-sensitive staging
directory beneath a case-insensitive destination — Windows sets that flag per
directory — and this machine's default NTFS is case-insensitive, so two names
differing only by ASCII case cannot both exist in staging to be discovered.
The test is guarded on that condition and skips here; removing the check
therefore fails nothing. It is kept because the configuration it guards is
real, and its failure direction is a refused set rather than a half-published
one.

## What is claimed, and what is not

**Claimed:** the private output-set lifecycle fits the measured WIFF output
behavior — backend-authoritative names, bounded sets, companion-failure
cleanup — end to end on the real build at set size one, and structurally at
the measured ten-member shape.

**Not claimed:** that MSCanvas admits SCIEX WIFF as a source; that any
provider build is evidenced for WIFF; that the two single-sample fixtures
represent SCIEX acquisitions generally; that output digests are portable
facts; or that the lifecycle's member order is sample order.

**The remaining gates, exactly:**

1. Real-backend evidence of a multi-member (>1) set requires one lawful
   multi-sample WIFF acquisition, which the pinned tree does not contain.
2. Staging exclusivity. Discovery trusts the staged directory's contents, and
   an open directory handle does not stop another local process from adding an
   entry mid-run; for a set, an injected valid mzML would be admitted as a
   member where a single-output run would have refused it. Recorded in ADR
   0021 with the two mechanisms that could close it.

Both, plus source-side topology (companion identity and pinning), recognition
and a provider-evidence row, belong to the SCIEX admission slice.

## Cleanup

Both fixtures, their companions, every converted output, every staging root
and every probe directory were deleted after measurement. No vendor data is
tracked and no local path appears in this record.
