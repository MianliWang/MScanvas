# ADR 0045 — Conversion Completion closure and handoff

Status: **draft, not accepted. `M6 NOT COMPLETE`.**
Date: 2026-09-10
Related: [0043](0043-conversion-completion-route.md),
[0044](0044-conversion-configuration-authority.md),
[0042](0042-viewer-completion-closure-and-handoff.md),
[0007](0007-logical-acquisition-discovery-and-folder-traversal.md),
[0010](0010-first-vendor-raw-source-admission.md),
[0018](0018-shimadzu-labsolutions-lcd-source-admission.md)

**This record does not close M6.** Eleven of
[ADR 0043's exit criteria](0043-conversion-completion-route.md#m6-exit-criteria)
are proved on published evidence and the three milestone-wide conditions hold.
**Criterion 2 is not proved**, and ADR 0043 is explicit that a core criterion
which cannot be proved means the milestone is not complete.

It is written and kept anyway, because the audit is the useful part: the matrix
below is what the next owner needs, and it does not become less true for being
blocked on one row. It implements nothing. Where a measurement is cited it is
linked, not retold.

**This verdict was reached, reversed, and reached again.** The reversal and what
undid it are recorded [in full below](#the-finding-that-defeats-criterion-2),
because a reader deciding whether to trust this row deserves the argument rather
than the conclusion.

## Baseline this audit was taken on

| Fact | Value |
| --- | --- |
| Frozen closure baseline `P` | `6a04d6bb1ac9169ac15cf9d9815d1aa74bc23555` |
| Tree at `P` | `9e1e2b1ce76f38bac985b9acfd4b79ec2e28cb37` |
| M6.10 published anchor | `24f7ce437cf83a014bfc99f293c765506f51574d` |
| Anchor is an ancestor of `P` | yes |
| Commits between them | five, **all dependency maintenance**, no source change |

**`P` is not the M6.10 anchor, and the difference is accounted for rather than
absorbed.** Between the anchor and `P` the repository published two separately
authorized Dependabot merges. Their combined diff touches `Cargo.lock`,
`pnpm-lock.yaml`, two `package.json` files and one line of
`apps/desktop/src-tauri/Cargo.toml` — an exact pin moving
`tauri-plugin-clipboard-manager` from `=2.3.2` to `=2.3.3`.

**Stated in the semver that actually governs**, because "no major version moved"
would be true only of the leading integer: on the Cargo side three proc-macro
helper crates moved incompatibly — `darling`, `darling_core` and `darling_macro`
from `0.23.0` to `0.24.1`, where for a `0.x` crate the minor is the breaking
component — and `quick-xml` and `miniz_oxide` each gained a second,
incompatible-range entry beside the one already there. The npm side moved no
major and no `0.x` minor. **The mzML scanner every conversion judgement rests on
is not affected**: `crates/proteowizard` pins `quick-xml = "=0.41.0"` exactly, so
the added `0.42.0` entry is another crate's.

**A dependency change is a changed build input even inside one major release**,
so the local gate set was re-run on `P` with the lockfiles unchanged before this
audit began. Every verdict below that rests on a local run rests on **that** run.
Verdicts that reuse older rendered evidence say so in their own row.

No dependency work belongs to this slice and none was done in it.

## The twelve criteria

The criteria are quoted in
[ADR 0043](0043-conversion-completion-route.md#m6-exit-criteria) and are not
restated here.

| # | Criterion, owner | Verdict | Implementation authority | Current consumer | Discriminating evidence | Limits and conflicts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | One availability authority — **M6.1** | **PASS** | `apps/desktop/src/features/mzml-preview/conversionAvailability.ts` — one `ConversionLane` of nine facts and a closed set of seventeen unavailable-reasons | `ConversionAction` is `start` and `retry`; both the controls and `useConversionOperation`'s dispatch resolve them from that one module | `conversionAvailability.test.ts`; the reason registry is exhaustive over the union, so a lane fact added without a sentence fails to compile | Stop is gated by its own `canStop` boolean rather than by `ConversionAction`, which is the shape M6.8 shipped. The settings catalog is a **separate** judgement by design — see [the finding below](#the-finding-that-defeats-criterion-2) |
| 2 | Evidence-backed typed settings — **M6.2**, **M6.3**, **M6.4** | **NOT PROVED** | `crates/proteowizard/src/intent.rs` — `ConversionIntent::ADMITTED`, nine rows, private fields, `admitted(..)` the only constructor | `ConversionCatalog::of` and the bound plan | `scripts/check_repo.py`'s `validate_the_admitted_intent_table_cites_measurements_that_support_it` holds every row against the committed M6.2 ledger: the case must exist, have produced mzML, have exited zero, and have run argv consistent with the row | **Blocking.** Seven rows are proved. The two `UnscopedDefaultCentroiding` rows are not: their evidence covers no source the product can convert, and on the one it can convert that was measured the setting deterministically fails. See below |
| 3 | The visible plan is the bound plan — **M6.3**–**M6.7** | **PASS** | The queue's bound facts, captured under the workspace mutation gate at `BEGIN` | The plan summary and the running queue project the same bound values | Moving any control after `BEGIN` changes nothing about the running queue, pinned per fact in the preview suites | Of the four facts the criterion names, **destructive authorization is vacuously satisfied**: CNV-D4 is `OVERWRITE_REFUSED`, so nothing destructive can be bound. Recorded for the same reason criterion 4's unexercisable halves are |
| 4 | Destination authority — **M6.5** | **PASS**, on its named exception | The destination resolved to an admitted directory object, with the policy that chose it | The queue planner and every per-item claim and revalidation | Aliasing refused on object identity and an ancestry walk compared by identity at each step, never on a path prefix; retry revalidates every identity it will use | The aliasing and vendor-dataset-root halves stay **unexercisable** — no admitted family is directory-shaped. This is CNV-D3's explicitly named exception, carried unchanged, not a gap found here |
| 5 | Selected and all are deterministic and bound — **M6.7** | **PASS** | The scope decision and its membership capture | The scope controls and the queue | [The M6.7 record](../../ux/M6_7_CONVERSION_SCOPE.md): visible order, explicit ineligible-row treatment, capacity refusal before commitment, membership immutable after `BEGIN` | None found |
| 6 | Conflict and destructive behaviour — **M6.6** | **PASS** | The conflict policy resolved on the typed request before launch | Every entry path resolves it identically | Terminal `OVERWRITE_REFUSED` recorded with its reason; `Fail`/`Skip` stand; the provider stays confined to staging under either answer | ADR 0043's M6.6 section still read *publication pending*; [amended](#amendments-this-closure-makes) |
| 7 | Cancellation fails closed — **M6.8** | **PASS** | The ownership disposition and the claim derived from it | Item states, queue counts, their mirrored wire fields, the diagnostics payload key and the session quarantine reason | `scripts/check_repo.py`'s `validate_the_cancellation_claim_has_one_origin`, a guard over the semantic rather than a site list, proved against thirty deliberate bypasses | The bypass suite is a proof about **this repository's** spellings, not a theorem about all Rust programs. Stated in [the M6.8 record](../../ux/M6_8_CANCELLATION_CAPACITY_PROGRESS.md) and unchanged |
| 8 | Progress contains no fabricated precision — **M6.8** | **PASS** | Item counts, per-state counts and the current item's state | The queue surface | No percentage and no ETA is computed anywhere in the product; every occurrence of the words is a comment explaining the absence | None found |
| 9 | Five distinct judgements — **M6.9** | **PASS** | Five separate observations per item, on the wire and on screen | `ConversionItemJudgements` and the item DTOs | [The M6.9 record](../../ux/M6_9_OUTPUT_COMPLETION_ADOPTION.md): staged output answerable independently of publication and on the ordinary-failure paths; a **missing** observation distinct from an empty staging area; clean residue distinct from nothing staged | None found |
| 10 | Multi-output completion is truthful — **M6.6**, **M6.9** | **PASS** | The output manifest, per member | The set and adoption surfaces | A partial set is neither a success nor a failure; collisions and adoption are answered as a set rather than by a one-file rule | None found |
| 11 | Every conditional route has a terminal disposition — **M6.10** | **PASS** | [The M6.10 terminal ledger](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#the-terminal-ledger) | Criterion 11 is answered from that ledger and nowhere else; `scripts/check_repo.py`'s `validate_the_m610_side_routes_are_all_terminal` holds the four routes to the closed disposition vocabulary | Four routes, four terminal dispositions, none admitted and none left open | The inner dispositions are reproduced [below](#criterion-11-by-citation) **by citation**; this record does not re-decide them |
| 12 | M7 and M8 receive stable seams — **M6.3**, **M6.5**, **M6.9**, **M6.11** | **PASS** | The reads ADR 0043 lists | [Each named below](#the-m7-and-m8-seams) with its real consumer | Every read reaches a current consumer, and eight of the nine reach a visible surface | `Run`, `Artifact`, `Lineage` and `Provenance` are deliberately **not built**. `DestinationIdentity`'s resolved object has a Rust consumer only, by design — see that row |

### Milestone-wide A, B and C

| | Condition | Verdict | Basis |
| --- | --- | --- | --- |
| **A** | No unimplemented capability described as implemented, and no delivered one described as missing | **NOT PROVED** | The centroiding setting is offered as a supported choice on families where the evidence does not reach. That is the same finding as criterion 2 rather than a second one. Otherwise audited across `README.md`, `ROADMAP.md`, `BOOTSTRAP_STATUS.md`, `PROJECT_PROPOSAL.md`, `docs/product/FEATURE_CATALOG.md`, `docs/product/PRIMARY_WORKFLOWS.md` and the accepted conversion ADRs. Two passages state the admitted table without qualifying it by source family — `FEATURE_CATALOG.md`'s "nine combinations, each admitted by a named M6.2 measurement" and its CNV-005 sentence. Both are **true as written**: the table is what it says, and the qualification the finding below asks for does not exist yet in the product either, so no document claims one. `docs/architecture/ARTIFACT_MODEL.md` describes Project/Artifact/Run/lineage as a **design model**, not as shipped state, and is read as such |
| **B** | Inherited interaction, accessibility and responsive obligations at all three targets | **PASS on reused evidence** | Carried from the slices that shipped each control, at their own rendered validation. **One control's text changed after that validation**: M6.10 rewrote the centroiding disclosure in `ConversionSettings.tsx`. The change is a string constant with no layout, state or role effect, and it is covered by a rendered assertion added in the same commit. No other M6 control changed |
| **C** | The local gate set passes unchanged | **PASS** | The gate set is the one `AGENTS.md` names under **Required checks** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --all-features -D warnings`, `cargo test --workspace`, `python scripts/check_repo.py`. All pass on `P` with lockfiles unchanged, recorded in `BOOTSTRAP_STATUS.md`'s M6.11 entry. **No gate was redefined and none was dropped**; the browser and native suites are `qa:*` rendered-verification scripts rather than members of that set, and the two that fail are [inventoried below](#environment-and-qa-residuals-inventoried-rather-than-hidden) as failing |

## The finding that defeats criterion 2

M6.10 measured something about the shipped centroiding setting that nobody knew
before, and it deserves the most careful section in this record.

### What was measured

`ConversionIntent::ADMITTED` carries two `UnscopedDefaultCentroiding` rows.
`ConversionCatalog::of` judges every admitted **table row** against one thing
only — whether the bound build's msconvert grammar accepts the argv that row
lowers to. There is no source-family dimension in that judgement, and the
settings panel is one session-wide surface rather than a per-dataset control.

`is_convertible` answers `false` for mzML and `item_output_topology` refuses a
non-convertible family with `dataset_not_convertible` before a dataset can be
queued, so **every conversion the visible product performs is of a vendor
acquisition**. Both centroiding rows cite M6.2 cases — `K1`, `K8` and `K12` —
and all three were measured on generated mzML fixtures.

M6.10 then converted the lawful Thermo acquisition ADR 0010 admitted and found
that the bare `peakPicking` filter these rows lower to selects the **vendor**
picker there, recording `Thermo/Xcalibur peak picking`.

**Which branch that produces was checked, not assumed, because the two branches
are very different.** A vendor source is judged output-only, so its processing
history is whatever the run wrote. Read from the retained output of that
measurement: its `spectrumList` carries
`defaultDataProcessingRef="pwiz_Reader_Thermo_conversion"`, that `dataProcessing`
carries `MS:1000035 peak picking` with the vendor `userParam`, and the spectrum
declares no override — so the reference **resolves**, and
`check_requested_processing` reaches `ProcessingAlgorithmMismatch` rather than
recording the property as merely unverified. **The conversion fails closed with a
truthful reason. It does not finalize an output centroided by an algorithm the
product never admitted.**

So, plainly: **for every source family a user can actually convert, this setting
is either measured to fail or not measured at all.** Thermo is measured to fail.
Shimadzu LCD and SCIEX WIFF are unmeasured — and nothing here says they would
fail, only that no evidence says what they do.

### The argument that nearly saved it, and why it does not

An earlier draft of this record failed criterion 2 on the ground that evidence
taken on mzML is not evidence for a vendor conversion. Review answered that the
ground **proves far too much**: all nine admitted rows rest on the same three
generated mzML fixtures — `D1`, `P1`–`P5`, `C1`, `C2`, `L1`–`L3` as much as `K1`,
`K8` and `K12` — including `SHIPPED`, which is `ADMITTED[0]` and the posture
every vendor conversion this product has ever performed ran under. A principle
that disqualifies mzML evidence wholesale unships the default.

That answer is correct, and this record reversed to a `PASS` on the strength of
it. **The reversal was wrong, and what undoes it is the narrower principle the
same review supplied.**

**Peak picking is the one axis decided by the *reader*.** ADR 0043 records from
the provider's own sources, in CNV-D2, that vendor centroiding is selected by a
`dynamic_cast` on the immediately inner spectrum list. Output format, numeric
precision, compression and MS-level population are **writer-side**: they act on
whatever spectra the reader produced, so a measurement of them on one source
generalizes. A measurement of peak picking does not.

That principle does two things, and the reversal used only the first. It rescues
the other seven rows — their mzML evidence transfers, and the reductio is
answered. And it establishes that **for this one axis the mzML measurement is not
evidence about what the product does**, which is precisely what criterion 2 asks
for.

**The corroboration runs opposite ways, which is the plainest way to see it.**
The seven writer-side rows are backed not only by their mzML cases but by every
vendor conversion this product has performed under them, each passing the
integrity contract. The two centroiding rows have the opposite corroboration: the
one shipped family anyone measured produces a refusal.

### The other defence, and why it is a technicality

Criterion 2's four traces are an exact provider identity, *a live measurement of
that build*, a stated product semantic and a deterministic argv mapping, and the
route defines the axis as *may this setting be admitted on this build*. On a
build-scoped reading all four hold, and M6.2's candidate evidence dimensions are
a closed, repository-validated list of **nine** in which source family does not
appear.

**That list defines how a candidate is measured, not which inputs a setting is
admitted for.** Asking whether the evidence covers the product's real inputs is
not a tenth measurement dimension; it is what *evidence-backed* means. And ADR
0043 is explicit that a criterion which may be adjusted is a preference rather
than an exit criterion — passing this one on the scoping of a word is an
adjustment in substance.

Three further reasons this record will not take the exemption, each of which it
had reached for at some point:

- **Fail-closed is not an exemption.** No unsafe output is published, and that
  establishes nothing about whether the setting is evidence-backed.
- **An assigned owner is not an exemption.** M6.10 recorded this as a
  non-blocking residual and named M6.11 to carry it. A source record's residual
  label does not amend an exit criterion, and this record is M6.11.
- **Pre-existing is not an exemption.** The condition predates M6.10; only the
  knowledge of it is new. A closure audit judges on current evidence.

### The exact owning repair

**Not this slice's, and not a documentation change.** Either would discharge it:

1. **Qualify the admitted centroiding rows by source family**, so the catalog
   does not offer a combination whose evidence does not reach the families the
   product converts; or
2. **Reconcile the intent and the integrity contract on one algorithm semantic
   and measure it on the shipped families** — a Thermo result already exists and
   refuses, so this means family-specific admission for Shimadzu LCD and SCIEX
   WIFF and an honest answer for Thermo.

Both are production changes to admission and availability. They need their own
implementation authorization and their own evidence.

| | |
| --- | --- |
| **Scope** | The two `UnscopedDefaultCentroiding` rows, on this provider build. Measured for Thermo RAW; unmeasured for Shimadzu LCD and SCIEX WIFF |
| **Evidence** | [M6.10's S1 measurement and its shipped-claim repair](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#one-shipped-claim-repaired); `a_vendor_acquisition_records_the_vendor_picker_and_does_not_satisfy_the_request` in `crates/proteowizard/src/conversion.rs`, which pins the classification and the refusal; and the retained output whose resolved processing reference settles which branch is taken |
| **Owner** | A new slice under CNV-D2's authority, which is where processing-intent admission lives. **CNV-D2's status line names M6.2 as its owner and is stale in that respect**: M6.2 is complete, and what remains is a family dimension it never had |
| **What must be true to close criterion 2** | Every admitted setting is backed by evidence covering a source the product can convert |

**ADR 0043 also owes an amendment here**, and this record does not make it: its
M6.2 evidence standard has no source-family dimension, and peak picking is the
one admitted axis where that omission has a consequence. Whether the fix is a
tenth dimension or an explicit statement that settings evidence is build-scoped
while family qualification belongs to admission is a decision that changes what a
future criterion means, so it belongs to whoever authorizes the repair.

### Criterion 1 is not defeated by the same facts

It governs the conversion *action*: controls and dispatch read one lane, the
action is genuinely available for a vendor dataset, and the operation performs
it. What follows is an outcome, not an availability disagreement. That the
settings catalog answers a separate question is not a duplicate authority
discovered here — ADR 0044 separates them deliberately and says in as many words
that the catalog is not `ConversionLane`. What the catalog answers is *this build
accepts this argv*; what a reader hears is *this conversion will work*. Closing
that gap is part of the repair above, not a second finding.

## Criterion 11, by citation

[The M6.10 terminal ledger](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#the-terminal-ledger)
is the authority. Reproduced so a reader of this record need not reconstruct it,
and **not re-decided**: no route was reopened and no new provider search was run.

| Route | Terminal disposition | What it rests on |
| --- | --- | --- |
| CNV-002 mzXML | `REFUSED_WITH_EVIDENCE`, which is CNV-D1's `MZXML_REFUSED` | A source/output comparison on the installed build: two `<scan>` elements written of four, under a header declaring four, at exit `0`, with the mzML control keeping all four |
| Vendor-format direct preview | `EVIDENCE_BLOCKED` | This build **did** serve every preview operation directly from one lawful vendor acquisition. What is missing is representative acquisitions per admitted family, a reference that does not pass through the same vendor reader, and the product decision to open the preview boundary at all |
| Any further vendor family | `REFUSED_WITH_EVIDENCE` | A scope and prerequisite decision — ADR 0007's standing decision and its unmet evidence list, and the lawful-fixture and recognition prerequisites a file-shaped family would need. **No family was tested and failed** |
| VIEW-007 XIC re-entry | `REFUSED_WITH_EVIDENCE`, retaining `XIC_SOURCE_REFUSED` | The `msaccess` identity was re-observed and is byte-identical to the one M5.4 refused, so the stated trigger did not fire |

Two distinctions this record keeps, because both are easy to lose in summary.
Direct preview is blocked on **absent evidence, not on an inability**: the
provider demonstrably read the acquisition. And route 4 rests on a **fresh
executable-identity observation** together with M5.4's **older scientific
measurements**; hashing an executable is not evidence about what it computes, and
no XIC science was re-run.

## The M7 and M8 seams

Criterion 12 requires each read to exist **and** be consumed by a current
surface. A declared type with no consumer is not enough.

| Seam | Producer | Narrow read | A real current consumer |
| --- | --- | --- | --- |
| `SourceIdentity` | Dataset admission | `FileIdentity`, `DatasetId`, member digests | The roster, and every per-item revalidation and companion lock in `preview/service.rs` |
| `ProviderIdentity` | Discovery and the bound installation | Release, build date, source revision, executable SHA-256 | The redacted diagnostics export payload |
| `ConversionIntent` | M6.3's admitted table | The typed intent and the argv it lowers to | The settings catalog and the bound plan summary |
| `OperationRunIdentity` | The conversion runner, **before the process starts** | `runIdentity`, on the wire beside the outcome | `ConversionItemJudgements`, rendered per item |
| `DestinationIdentity` | M6.5's destination authority | **Two reads, and only one is a surface.** `destinationPolicy` and a `"unresolved" \| "bound"` status cross the wire; the resolved directory object deliberately never does | The policy and status reach the plan summary; the **resolved object** is consumed by Rust's per-item claim and revalidation only, which is the privacy rule working rather than a missing consumer |
| `StagedOutputEvidence` | The runner's observation phases | `staged`, answerable independently of publication | `ConversionItemJudgements` |
| `OutputArtifactManifest` | The runner, per output | Name, byte length, SHA-256, observed spectrum and chromatogram counts; per member for a set | The set and adoption surfaces |
| `IntegrityEvidence` | The integrity contract | Validation mode plus the property set, `inapplicable` distinct from `unverified` | `ConversionItemJudgements` |
| `AdoptionRelation` | Adoption | Which output was adopted, and against which identity check | The adoption surface, and the queue the result is recorded on |

**Lifetime, ownership and privacy.** All nine are session-scoped and owned by
Rust. None is persisted, none is resolved across sessions, and no location, path
or raw backend text crosses the boundary — the run identity is opaque and is
derived neither from a filename nor from the queue. `Run`, `Artifact`, `Lineage`
and `Provenance` are **not built**; M6 supplies the facts M8 would assemble them
from, and that is the whole of the promise.

**The one thing ADR 0042 handed M6 open is closed.** That record passed the
`convert` ref/render window over *open, described, and unclosed by design*. M6.1
closed it with a synchronous dispatch claim, so nothing about it carries into M7.

## What this closure does not create

No XIC. No admitted mzXML. No admitted direct vendor preview. No additional
vendor family. No ETA. No claim of full-source vendor fidelity — native output
validation remains output-only. No run history, no persistence, no artifact
store, no lineage. Where a capability is refused or blocked above, that is the
product's published limit and not a prototype awaiting release.

**The Post-M6 XIC Provider / Runtime Interlude remains the recorded preferred
next route before M7.** Its gate is `M6 COMPLETE`, which is **not met**, so it is
not reachable yet. It is not an M6 exit criterion, it has **not started**, and
nothing here schedules it: it needs its own route lock, and this record neither
grants one nor selects a replacement runtime.

## Residuals carried

Each is scoped, owned, and mapped to the criterion it does not defeat.

| Residual | Scope and evidence | Owner | Why it does not defeat a criterion |
| --- | --- | --- | --- |
| Directory-shaped acquisition rules unexercisable | No admitted family is directory-shaped | The first slice that admits one | Criterion 4's **named** exception, carried from CNV-D3 |
| Destructive authorization unexercisable | CNV-D4 is `OVERWRITE_REFUSED`, so nothing destructive can be bound | CNV-D4, unless reopened | Criterion 3's other three facts are exercised |
| No conversion-boundary failure is retryable | A rerun that mints a second identity for a *launched* attempt cannot be produced through the queue; the queue-level proof runs from a retryable refusal | **This closure records it**, per M6.9's assignment. Re-entry: the first measured transient conversion failure | Criterion 9's identity timing is proved at the conversion boundary instead |
| The staged observation now runs on every failure path | A real change in where that work happens, bounded at twice the lifecycle's output bound | **This closure carries it**, per M6.9's assignment. Re-entry: the first slice that measures the cost | Criterion 9 requires the observation; nothing measures a cost worth trading it for |
| Advisory identifiers shown as stable identifiers, not sentences | Nothing this release converts can produce one | M7, or the first slice admitting a family compared against its source | No shipped configuration emits one |
| `peakPicking vendor`'s algorithm behaviour | The one lawful vendor acquisition is already centroided, so no picker had profile data | A fixture-permission decision, then a measuring slice | Subordinate to criterion 11's route 1, which does not depend on it |
| mzXML's second drop condition | That acquisition carries one controller, and it is the one the writer keeps | Same | Route 1 was decided on the source-file condition alone |
| Representative-profile re-entry | Both peak-picking findings are scoped to synthetic seven-point peaks | Same | Scopes M6.2's conclusions; admits nothing |
| A source mzML naming `vendor peak picking` folds to `Unrecognized` | Fail-safe, and unreachable from the visible workflow because mzML is not convertible | M6.10's repair, unchanged | Degrades a property to unverified rather than certifying anything |
| The cancellation guard's finite bypass suite | A proof about this repository's spellings | M6.8, unchanged | Criterion 7 asks for a guard over the semantic, which exists |
| Three call sites covered only by their extracted functions | Driving the sites needs a real process failure | The process boundary, when a fault-injecting `ProcessRunner` exists | The decisions themselves are tested directly |
| The suspended launch has no degradation path | Narrowed: a thread that cannot be opened or resumed, and a root whose threads misreport their suspend count | M6.8, unchanged | Fail-closed; criterion 7 asks for exactly that |
| Whether a **different** `msconvert` build spawns children | Unestablished by M6.8's measurement | The re-observation gate | Criterion 7's measurement is bound to the measured build |

### Environment and QA residuals, inventoried rather than hidden

**Baseline occurrence does not make a failure green**, so these are recorded as
failing, with their owners and their actual status.

- **Two browser cases fail, on this baseline and on the published one alike** —
  `m4.1` *"offers all three formats for a spectrum that loaded with no peaks"*
  and `m5.2` *"still reaches the plot by Tab where the range can move"*. M6.8
  verified both fail identically in a separate worktree at an earlier commit.
  **Neither is a conversion requirement and neither is an M6 control**, so
  neither is a requirement any M6 criterion or condition names. Owners: the
  spectrum-export and viewport owners respectively.
- **An M6.8 e2e harness race**, in a spec that reads the running row and then
  clicks *Stop this file*, so the click can land on a row that started in
  between. Owner: whichever slice next touches that spec.
- **The e2e runner's Tauri browser-mode and forced dev-server shutdown
  warnings**, pre-existing.
- **`msedgedriver` restoration and non-default driver ports** were needed before
  M6.9's native suites could run — lockfile restoration and machine facts rather
  than repository ones. Recorded so the next run does not rediscover them.
- **The native save dialog is not automated** in this WebView2 session, and the
  clipboard and window-focus limitations M5 recorded persist. Inherited, with the
  boundary rules proved in Rust instead.

## Amendments this record makes

**Two statements in ADR 0043 were true when written and are not now.** Both are
corrected in that document, dated, with the superseded wording quoted there
rather than deleted — which is where this repository puts an amendment, so that a
reader of ADR 0043 is not left following a pointer from somewhere else.

1. Its M6.6 section opened *publication pending*. M6.6 was published by PR #99
   and `ROADMAP.md` has recorded it complete since.
2. Its M6.1 section says the lane holds *eight facts* and *eleven stable
   reasons*. ADR 0044's 2026-09-06 amendment already superseded that count in
   substance — Decision 10 added `configurationProbing` — and the live module now
   holds **nine** lane facts and **seventeen** reasons.

No other current-status document reviewed for this closure describes a delivered
conversion capability as missing or an unimplemented one as delivered.
