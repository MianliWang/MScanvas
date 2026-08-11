# M3.11 SCIEX WIFF source admission evidence

- **Status:** Admitted privately. `SciexWiffBundle` is a real source family with
  recognition, a bundle-wide identity binding and a provider-evidence row, and
  it converts through the ADR 0021 output-set lifecycle on the evidenced build.
  No product surface exists.
- **Date:** 2026-08-11
- **Decision recorded in:** [ADR 0022](../architecture/adr/0022-sciex-wiff-source-admission.md)

This closes both gates [ADR 0021](../architecture/adr/0021-private-multi-output-conversion-lifecycle.md)
left open, and states exactly what remains open after them.

## Fixture provenance and lawful-use basis

ProteoWizard's repository at commit
`1e4c3abccc05626bc215bcf3fee6ed0e33613360`, root `LICENSE` Apache-2.0 verbatim
with no additional terms under the vendor test-data subtree. Retrieved over
HTTPS with no credentials, downloaded outside the repository, and deleted after
measurement. Nothing vendor-supplied is tracked.

| | Enolase | PressureTrace1 | 201208-378803 |
| --- | --- | --- | --- |
| Primary | `Enolase_repeats_AQv1.4.2.wiff` | `PressureTrace1.wiff` | `201208-378803.wiff` |
| Bytes | `2,801,664` | `344,064` | `1,339,392` |
| SHA-256 | `C8BF5E3C…F390EA3` | `61C9DDEA…006F2374` | `B3F7863E…21FAA892` |
| Companion bytes | `1,143,140` | `81,436` | `2,106,496` |
| Companion SHA-256 | `CE872851…DDFD7350` | `C386453D…77B8EF66` | `20AAF097…FB014C14` |
| Samples | **10** | 1 | 1 |

**A correction to the M3.10 record.** That record states the ten-sample Enolase
acquisition "is not present in the pwiz tree" — true at the commit it pinned
(`8f945db3`, 2019) and not true generally. The file was restored upstream on
2022-09-08 in commit `1e4c3abc`, whose message reads *"restored Enolase WIFF
file (deleted when Reader_ABI_Test tarball was deleted instead of updated)"*.
It is a plain git blob, not LFS. The other two fixtures' blobs are byte-identical
at both commits, so this slice pins one revision for all three.

One naming trap, recorded because it costs an hour: the repository stores the
companion as `Enolase_repeats_aqv1.4.2.wiff.scan` while the primary is `AQv`.
Harmless on Windows; on a case-sensitive filesystem the reader would not find it.

## The bundle: what the logical source is

Measured, not assumed.

| Object | Classification | How it was established |
| --- | --- | --- |
| `<name>.wiff` | **Required.** The object the acquisition is named by and the only one on the command line. | Every run. |
| `<name>.wiff.scan` | **Required, load-bearing.** | Removed it and converted anyway: exit `1`, *"Could not open data stream. Is a required 'scan' file missing?"*, **and ten truncated documents left in the output directory** — ~40 KB each against ~280 KB for the real ones, each well-formed enough to open. |
| anything else | **None exists for this family.** | Every `.wiff` in the pinned tree has exactly one companion and no other neighbour. Converting the Enolase pair alone in an otherwise empty directory produces the same ten documents, so two objects are the whole acquisition. |
| `<stem>.scan` | **Not the companion.** | `Reader_ABI` builds the name as `wiffpath + ".scan"`; the companion of `a.wiff` is `a.wiff.scan`. |
| `.wiff2` | **A different family, not admitted.** | Its primary is not a compound file at all (measured: high-entropy from byte 0). Upstream's `swath.api.wiff2` also shows that a `.wiff.scan` in a directory need not belong to any `.wiff` there — which is why the companion is derived from the primary's name and never searched for. |

## Recognition

The provider's own recognition is weaker than this boundary needs:
`Reader_ABI::identify` is `iends_with(".wiff") || iends_with(".wiff2")` with a
`// TODO: check header signature?` above it. The name is all it consults.

What was measured instead. All three primaries are compound files declaring
version 4 with 4096-byte sectors, and their first directory sectors share
twenty-two entry names. Four are required:
`SampleSubtree`, `MethodSubtree`, `SampleTable`, `MassSpecMethod`. Entries
present in only some of the three — `Period0`, `DataDependant`,
`CTCPALAsMethod`, `MSConfigInfoDMS` — describe how one acquisition was run and
are not required. **No LabSolutions marker appears in any of the three, and no
SCIEX marker appears in either LabSolutions fixture.**

The companion is recognised by its own first 32 bytes, identical across all
three: `0x00000582`, sixteen zero bytes, `0x11111111`, `0x00000582`,
`0x00000001`. The three diverge at offset 44; 32 is the longest prefix that is
both common and structural. It is not a compound file, so the container reader
cannot speak for it.

**Negative controls, on real objects through the real admission path:**

| Case | Result |
| --- | --- |
| A real LabSolutions `.lcd` renamed `.wiff`, with a genuine `.wiff.scan` beside it | `source_family_structure_mismatch` — extension right, magic right, companion genuine, still refused |
| A real `.wiff` renamed `.lcd` | `source_family_structure_mismatch` from the LabSolutions rule |
| A real `.wiff` with no companion | `source_companion_missing`, nothing launched |
| A real `.wiff` under a `.wiff2` name | `source_unsupported_extension` |

## Provider build

Release `3.0.26013`, source revision `47b13cf`, `msconvert.exe` SHA-256
`9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`. A third
row, not a widened one.

Input spelling measured for this family separately and it agrees with the other
two vendor families: the Windows extended-length canonical path is expanded as
a file mask before any reader sees it — `[msconvert] no files found matching
"\?\C:\…"`, exit 1, nothing produced — so this family is `PlainVerified`.

## Real conversions through the admitted path

`run_admitted_multi_output_conversion` on the evidenced build, through the
production `SystemProcessRunner`: family gate, provider-evidence row, both
bundle members reopened, posture-checked, length-checked and digest-checked,
then held for the whole run.

| | Enolase | PressureTrace1 | 201208-378803 |
| --- | --- | --- | --- |
| Bound objects | 2 | 2 | 2 |
| Outcome | `fully_finalized` | `fully_finalized` | `fully_finalized` |
| Members | **10** | 1 | 1 |
| Backend-chosen names | `…-20070918_En_01…10.mzML` | `PressureTrace1-6500SysSuit1269.mzML` | `201208-378803-ABRR-AUG-1.mzML` |
| Validation, each member | `output_only`, 9 verified, 11 inapplicable | same | same |
| Spectra / chromatograms | 0 / 8 per member | 0 / 41 | 2,235 / 2 |
| Second run | same basename set | same | same |
| Residue | none | none | none |

The multi-member gate is closed on a real acquisition: ten documents from one
source, one per sample, named by the backend, published without clobbering,
repeatable.

## The staging-membership gate, and how it was decided

ADR 0021 required this slice to decide it deliberately. The instruction was to
find out first whether the expected member set can be known before publication,
and not to assume an option exists.

**Measured: no shipped executable of this build enumerates samples before
conversion.** `Reader_ABI::readIds` exists in the library and no CLI exposes it;
`msconvert` offers `--runIndexSet`, which selects by index and does not
enumerate; `msaccess` requires a full read. The expected set is genuinely
unknowable before the run.

**Measured: the backend states what it wrote, on its own stdout.** One
`writing output file: <path>` line per document, immediately before writing it,
and the declared set equalled the produced set on every run. That reaches this
process through an anonymous pipe created here and inherited only by the child
— unlike the staging directory, not a place another local process can put
things.

The decision: **the discovered set must equal the declared set, or the whole set
is refused.** This restores the property ADR 0021 recorded as lost. Encoding was
checked before relying on it: with a non-ASCII output name the declared bytes
are UTF-8 and byte-identical to the on-disk name — not console-encoded — so the
comparison is over names, not counts, and a swap that preserves the count is
caught. An unreadable, truncated or absent declaration refuses.

What it does **not** establish is stated in the code and repeated here: it is a
check against additions, not a completeness proof, and it does not protect a
declared member's content.

## The gate this slice opens, and does not close

`Reader_ABI::read` catches a per-sample failure, writes a line to stderr and
continues to the next sample. An acquisition whose samples partly fail to open
therefore produces fewer documents, declares exactly those fewer documents, and
**exits zero**. Declaration and discovery agree and both are short. Nothing in
this boundary can currently distinguish that from a complete conversion, because
nothing here knows how many samples the acquisition holds — and learning that
would mean parsing vendor internals this reader deliberately does not parse.

Read from upstream's source at the pinned commit; not reproduced, because
producing a partly-unreadable acquisition is not something a lawful fixture
offers. Recorded as a gate on any user-facing surface: a user told "converted"
is entitled to know it means "all of it".

## Deterministic suite and mutations

The behaviour real fixtures cannot exercise is proven over synthetic containers
shaped like the real ones: the four-marker rule with each marker withheld in
turn, both families' decoys, the companion missing / misnamed / wrong-signature
/ too-short / a directory, the bundle refused by the single-output plan, the
family and provider gates, the whole command bound to two objects, an injected
undeclared member, and a declaration that is truncated, non-UTF-8, silent, or
name-swapped at equal count.

**Twelve focused mutations, each removing exactly one guard, all red:**

| # | Guard removed | Killed by |
| --- | --- | --- |
| 1 | the container's entries are not consulted | recognition |
| 2 | one required marker dropped | recognition |
| 3 | a missing companion tolerated | companion |
| 4 | the companion's bytes unchecked | companion |
| 5 | companion named from the stem | companion + recognition + plan |
| 6 | the extension filter removed | three family tests |
| 7 | a bundle allowed into the single-output plan | plan |
| 8 | the family needs no provider evidence | admitted-run gates |
| 9 | only the primary rechecked before the spawn | the process boundary's own test |
| 10 | companions not bound to the command | command binding |
| 11 | the declared set not compared | injected member |
| 12 | an unreadable declaration waved through | declaration |

Mutation 9 is worth a note: it survived the first pass. The conversion-level
test caught a replaced companion at *admission*, so the pre-spawn recheck could
be deleted with the suite still green. The test that kills it is aimed at the
process boundary directly, where the guard lives.

## Cleanup

All three acquisitions, their companions, every converted output, every staging
root, every probe directory and every temporary script were deleted after
measurement. No vendor data is tracked and no local path appears in this record.
