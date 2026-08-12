# M3.16 — First visible SCIEX WIFF workflow: evidence

What [ADR 0027](../architecture/adr/0027-first-visible-sciex-wiff-workflow.md)
rests on. The vertical itself was measured across ADRs 0022–0026; what is
measured here is that a user can reach it, that what they are told is true, and
that the three surfaces which deliberately did not change did not change.

## The support claim, exactly

> `Add files…` supports explicitly selected SCIEX WIFF acquisitions consisting of
> a `.wiff` primary and its required matching `.wiff.scan` companion, on the
> evidenced ProteoWizard build, converting through the serial queue to one or
> more backend-named mzML files.

And, stated as prominently as the claim:

| | |
| --- | --- |
| Folder ingestion | **mzML-only** |
| Explorer Drop | **mzML-only** |
| Direct SCIEX preview | **no** |
| Source fidelity | **not established** |
| Reader-identified sample completeness | **narrower than source completeness** |
| Output ordering | deterministic application order, **not** scientific sample order |
| Multi-file publication | sequential and **non-atomic** |
| Partially finalized prefix | the user's files, **not** a complete output set |
| Redacted diagnostics | **not anonymous** |

## Build and fixture provenance

Reverified before use, not inherited from the M3.15 record.

| | value | verified |
| --- | --- | --- |
| ProteoWizard release | `3.0.26013` | ✓ |
| Source revision | `47b13cfec55265af32055720a6c07b9d5bbed721` | ✓ |
| `msconvert.exe` SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` | ✓ recomputed, exact match |

The acquisition came from ProteoWizard's repository at commit
`1e4c3abccc05626bc215bcf3fee6ed0e33613360`, root `LICENSE` Apache-2.0 verbatim
with no additional terms under the vendor test-data subtree. Retrieved over
HTTPS with no credentials, downloaded outside the repository, and deleted after
measurement. Nothing vendor-supplied is tracked.

| | bytes | SHA-256 | verified |
| --- | --- | --- | --- |
| `Enolase_repeats_AQv1.4.2.wiff` | 2,801,664 | `C8BF5E3CE4DC323446AAA862D93AFAE5600DB07A13C8846715FED13A3F390EA3` | ✓ exact match |
| `…AQv1.4.2.wiff.scan` | 1,143,140 | `CE872851AE6949999982E1E7E209446E7202A5B1718CEFCE27B7F65FDDFD7350` | ✓ exact match |

The upstream naming trap is unchanged and worth restating: the repository stores
the companion as `Enolase_repeats_aqv1.4.2.wiff.scan` while the primary is
`AQv`. The boundary derives the companion's name from the primary's, which is
the spelling used here.

## The real run — through the production-visible path

Not the private helper. Every step below is the one a user reaches: the picker's
own routing, the visible planner, the visible queue, the visible adoption.

| | value |
| --- | --- |
| Picker candidate | 1 `.wiff` |
| Workspace source rows | **1** |
| Source row family | `sciex_wiff` |
| Source row byte length | 3,944,804 — primary **plus** companion |
| Bundle member count | 2 |
| Plan topology | `BackendNamedSet { max_members: 24 }` |
| Queue items | **1** |
| Backend attempts | 1 |
| Terminal reason | `completed` |
| Item state / attempts | `finalized` / 1 |
| Item output plan | *(no filename — the wire has no field for one)* |
| Group outcome | `fully_finalized` |
| Published / retained members | 10 / 10 |
| Bound source objects | 2 |
| Completeness | `reader_error_audit_v1`, `sample_count` 10 |
| Complete-set authority | present, 10 members |
| Visible eligible-output count | **10** |
| Adoption outcomes | 10 × `added` |
| Repeat adoption | 10 × `already` |
| Workspace rows after | **11** — 10 `mzml`, 1 `sciex_wiff` |
| Preview state on any row | none |
| Path-free `Debug` | confirmed on the queue read, the group report and the result |
| Path-free serialized wire | confirmed on the queue update and the adoption result |
| Diagnostic items | 0 — a run that finalized everything has nothing to diagnose |

Measured 2026-08-12 on the evidenced build, and reproduced. The ten documents
are the acquisition's ten samples in the staging directory's deterministic
order; that order is not a claim about the order the samples sit in the
acquisition.

Deleted after measurement: both fixture objects, the ten converted outputs, the
destination folder, the scratch directory and the download. No staging
directory survived the run. No `msconvert` process remained.

## Mixed-family behaviour

Deterministic synthetic evidence, as the milestone permits: the lawful Thermo
and Shimadzu acquisitions were not locally available to reverify, and weakening
the real SCIEX requirement to manufacture a real mixed queue would have traded
the measurement that matters for one that does not.

What is held deterministically: a three-family plan carrying `knownSingle`,
`backendNamedSet` and `knownSingle` in the user's own order; a mixed queue whose
item count is the source count; serial execution with a maximum backend
concurrency of one; a stop reaching a running set item and stranding the items
behind it; and a mixed terminal queue offering exactly the outputs its complete
items hold.

## What the interface is held to

Nine rendered checks over the eight required states, plus nine behavioural ones
through the app a user drives.

jsdom lays nothing out, so **nothing here measures a pixel and none of it
replaces a look at the real window** — the narrow-layout suite beside it says
the same thing for the same reason. What it holds is that every state is
reachable and says what it should, and that the stylesheet rules keeping those
states from clipping exist and cover the elements this milestone added.

| state | held |
| --- | --- |
| SCIEX-only plan | range rendered, no blank cell, acquisition stem absent from the output column |
| Mixed-family plan | per-family counts exact, each row's own cardinality, plan order preserved |
| Running SCIEX item | "Converting item 1 of 2" — acquisitions, not members |
| Ten-output success | count, narrow completeness claim, output-only disclosure; "source samples converted" and "fully verified" absent |
| Partial finalization | counts, the policy sentence, `role="note"`, not labelled `Converted`, no Retry, and **not** "Nothing was converted" |
| Stop | `Cancelled` / `Not run` in words, topology still shown, no rollback language |
| stopFailed | "Stop could not be confirmed" in words, residue explained |
| Ten-member adoption | 8 added / 1 already / 1 refused from one item, keyed apart, focus stable |

Layout rules asserted through the CSSOM: the acquisition name still ellipsizes
with `min-width: 0`; the set output deliberately does **not** ellipsize — the
sentence explaining the absent filename is exactly what an ellipsis would eat —
and wraps instead, with its own `min-width: 0`; every new status line takes a
full row and wraps.

Status is carried by words and structure rather than by colour alone: the
one-to-many row is distinguished by a `data-output-topology` attribute and
different text, and the partial-finalization warning by `role="note"` and a
border.

## Mutations

Twelve, each removing one load-bearing guard. A compile failure, a zero-test run
or a timeout was not counted as a kill.

| # | Guard removed | Result |
| - | ------------- | ------ |
| 1 | `.wiff` routes to mzML admission instead of SCIEX admission | red (8) |
| 2 | the primary is admitted without its companion | red (3) |
| 3 | SCIEX is non-convertible in the frontend layer only | red (8) |
| 4 | a backend-named set is given a guessed filename | red (3) |
| 5 | one finalized set item counts as one adoptable output | red (1) |
| 6 | a partially finalized prefix may mint a complete-set ticket | red (4) |
| 7 | established sample completeness is not required | red (1) |
| 8 | a partial finalization renders as "Nothing was converted" | red (4) |
| 9 | the completeness qualification is dropped from the visible copy | red (4) |
| 10 | a walking surface may reach SCIEX admission | red (1) |
| 11 | a set authority is flattened into reconstructed member tickets | red (2) |
| 12 | member basenames are added to the diagnostics export | **survived**, then red |
| 13 | a set result shows a count and never its member names | red (8) |
| 14 | any set report counts as evidence that something was validated | red (2) |
| 15 | a skipped output set reads as a skipped single output | red (2) |
| 16 | every set refusal answers with one generic sentence | red (3) |

**Mutation 12 found a real gap.** The privacy test pinned the `Debug` renderings
and the queue state — which is where member names used to be able to leak from —
and left the *export* asserted only on the fields it happened to know about. The
export is the document that actually gets sent somewhere, so that was the wrong
half to leave open. It is now asserted over the whole serialized document, with
a distinctive sentinel name, so a field added later cannot carry one in
unnoticed. The mutation is red against that test.

No survivors remain. Nothing was classified as equivalent, structurally
unreachable or lacking a deterministic seam.

Mutations 13–16 guard the four defects review found, and are recorded here
because the tests that kill them were written *after* the code was, which is a
weaker position than the rest of this record and worth saying so.

## Review

Four findings on the pull request, all valid, all fixed, each with a
discriminating test:

**The wire carried member basenames that nothing rendered.** ADR 0027's own
justification for carrying them is that the product displays them, and it did
not — which made the partial-finalization copy unusable, since it sends the user
to `Add files…` for a prefix it would not name. The finalized members are now
listed, read from the member *states* so the unpublished ones stay off a list
that is meant to describe what is in the folder.

**The output-only disclosure was claimed for runs that judged nothing.** A set
refused before its outputs were discovered still reports, with no members and
nothing validated, and the predicate treated any set report as a judgement —
contradicting the comment directly above it. The predicate now asks what was
actually finalized or validated, and moved into `contracts.ts`, because two
surfaces make this claim and had been written differently.

**A skipped output set said "a file of that name was already there".** It has no
such name, and the multi-output lifecycle steps aside only when *every*
discovered destination name is occupied. The label branches on cardinality now.

**Every set refusal answered with one sentence.** The single-output path has
explained itself by `detailedOutcome` since ADR 0012, and the set branch
discarded it — so a destination conflict, an unevidenced build and a
reader-reported sample problem were indistinguishable, though each sends the
user somewhere different. Refusals whose *recovery* differs now have their own
sentences; those that differ only in where inside the boundary they arose share
the fallback, which is deliberately unchanged: an identifier this build has no
sentence for is still a failure, and inventing prose for one would be inventing
a diagnosis.

All four were the shared single-output copy reaching a cardinality it was never
written for — which is the failure mode this milestone should have expected
most, and the reason the first fix's own ADR sentence had already described the
behaviour it did not implement.

## Limits of this record

- **One real acquisition, one family.** The mixed-family behaviour is
  deterministic rather than measured on three real vendor acquisitions at once.
- **No pixel measurement.** See above; the rendered checks are structural.
- **`PartiallyFinalized` was driven through a seam**, as it was in M3.15: a name
  taken between the whole-set preflight and one member's rename is the only way
  a real filesystem produces that outcome, and a test must not have to win that
  race.
- **The 24-member bound is stated, not exercised.** The measured acquisition has
  ten samples; the bound is the lifecycle's own and is asserted from the
  constant rather than from a run that produced twenty-four documents.
- **One backend launch is inferred from one attempt**, not from an instrumented
  count: the production provider is not a fake and does not count launches. The
  deterministic suite counts them directly against a substituted runner.
