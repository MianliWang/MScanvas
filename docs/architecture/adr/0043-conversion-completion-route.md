# ADR 0043 — Conversion Completion is the next milestone, and this is its route

Status: accepted
Date: 2026-09-01
Related: [0002](0002-external-proteowizard.md),
[0009](0009-mzml-conversion-execution-boundary.md),
[0010](0010-first-vendor-raw-source-admission.md),
[0011](0011-private-workspace-conversion-path.md),
[0012](0012-first-visible-thermo-conversion.md),
[0013](0013-serial-conversion-queue.md),
[0014](0014-proteowizard-cancellation-evidence.md),
[0015](0015-user-visible-queue-stop.md),
[0016](0016-explicit-converted-output-adoption.md),
[0017](0017-redacted-conversion-diagnostics-export.md),
[0021](0021-private-multi-output-conversion-lifecycle.md),
[0024](0024-sciex-sample-completeness.md),
[0025](0025-private-sciex-output-set-adoption.md),
[0026](0026-private-sciex-serial-queue-integration.md),
[0027](0027-first-visible-sciex-wiff-workflow.md),
[0037](0037-viewer-completion-route.md),
[0041](0041-viewer-selection-availability.md),
[0042](0042-viewer-completion-closure-and-handoff.md)

## What this ADR is, and what it is not

It is a route lock. [ADR 0042](0042-viewer-completion-closure-and-handoff.md)
closed M5 on the `XIC_SOURCE_REFUSED` branch and handed M6 five things by name:
the capability-evidence discipline M5.4 established, the viewer/conversion lane
boundary M5.7 froze, the `convert` ref/render window handed over open,
VIEW-007's conditional re-entry, and vendor-format direct preview behind its own
evidence slice. `ROADMAP.md` describes M6 as four backlog
bullets. **Nothing in this repository says what M6 is, what order its work
happens in, or when it is finished** — the M5 equivalents lived in
[ADR 0037](0037-viewer-completion-route.md), and there was no M6 counterpart.

This ADR supplies them: the live conversion gap audit it was decided from, the
twelve-slice route, the nine product decisions the route surfaces, the
milestone's exit criteria, and the seams M7 and M8 may build on.

**It implements nothing.** No Rust behaviour, no React behaviour, no Tauri
command, no test behaviour, no dependency and no lockfile change with it. Every
classification below is taken from the code and the measured evidence in this
repository rather than from what the roadmap said, and where the code and the
roadmap disagree the code is what is recorded.

**It does not re-decide the accepted conversion ADRs.** 0009 through 0027 froze
a boundary this route inherits rather than reopens. Where a decision below looks
new, it is either a *product surface* over an existing boundary or an explicit
extension of it, and it says which.

## The baseline this route was decided from

`main` at `0c23c59a9ba7ecba39ad6030fdd8c604c23a602b`, clean, level with
`origin/main`, no stash and no active operation. `python -B scripts/check_repo.py`
and `git diff --check` both exit zero on it. The two open pull requests are
Dependabot dependency bumps, unmerged and outside this route.

The installed ProteoWizard on the machine this audit ran on is release
`3.0.26013`, revision `47b13cf`, build date `Jan 13 2026 14:42:37` —
`msconvert.exe` SHA-256 `9BB6F5D5…D590BD` and `msaccess.exe` SHA-256
`85681B20…D1F4`. Both digests are **byte-identical to what
[the M5.4 spike](../../spikes/M5_XIC_SOURCE_EVIDENCE.md) recorded**, and the
`msconvert` digest is the one `EVIDENCED_PROVIDER_BUILDS` already pins. What
follows from that for XIC is [below](#the-xic-boundary-and-the-post-m6-interlude);
it is a fact about this baseline and not a promise about the whole milestone.

## The live conversion gap audit

The route below was decided from this. It is the audit `ROADMAP.md`'s four
bullets were written without, and it changes the answer in several places: much
of what an M6 plan would naively schedule **already exists and is stronger than
the roadmap implies**, and the work that is genuinely missing is mostly *product
surface over an existing boundary* rather than new boundary.

### What is already true, and must not be rebuilt

| Concern | What the live code does | Where |
| --- | --- | --- |
| Provider identity | Capabilities are parsed from a real help probe and **bound to the executable's SHA-256**; the executable is re-verified before launch and `ExecutableChanged` fails the run | `capability.rs` `InstalledHelpCapabilities::executable_sha256`; `conversion_run.rs` `BackendExecutionFailure::ExecutableChanged` |
| Capability-evidence binding | `EVIDENCED_PROVIDER_BUILDS` pins **(family, release, revision, `msconvert.exe` digest)** and `provider_build_is_evidenced` refuses an unevidenced family *before* a staging directory exists | `conversion_run.rs:305-391`, `:2528-2533` |
| Bound plan | `ConversionQueue` fixes membership, order, conflict policy and document epoch at construction; no code path appends, removes or reorders afterwards, and a duplicate `DatasetId` is refused at creation | `operation.rs` `ConversionQueue::new` |
| Destination authority | The chosen folder is admitted by **Windows object identity** — volume serial plus 128-bit file ID, read from a held handle — with reparse points, non-directories and remote volumes refused before any plan exists | `preview/destination.rs` `admit_destination_root`, `DestinationIdentity` |
| Retry-time destination authority | A retry re-admits the folder and refuses with `queue_destination_changed` unless it resolves to **the same object**; it does not re-ask the user. Scoped to the one destination the queue holds today — M6.5 generalises the *rule* to every identity a retry will use, and does not weaken it | `service.rs::retry_conversion_queue` |
| Serial execution | One `Mutex<()>` backend gate, claimed once per queue and held to terminal; ordering is the caller's list order and execution is index order | `service.rs::drain_queue`, `enter_backend` |
| Process-tree termination **mechanism** | Windows **Job Objects** — `CreateJobObjectW`, `AssignProcessToJobObject`, `TerminateJobObject`, then `QueryInformationJobObject` to observe the job empty. **Mechanism only**: that a real `msconvert` run *is* a tree has never been observed, and the observation is scoped to the owned Job — see CNV-D7 | `process.rs:1000-1115` |
| Cancellation states, distinguished | `Cancelled` (the owned Job was terminated and observed empty), `CancellationFailed` (termination unconfirmed, and it quarantines the session) and `NotRun` (never began) are three different item states; `Stopped` and `StopFailed` are two different terminal reasons | `dto.rs` `ConversionQueueItemStateDto`, `ConversionQueueTerminalReasonDto` |
| Outcome separation | `OutcomeClass`, `ItemOutcome`, `ValidationMode`, `IntegrityProperty` and adoption are separate judgements, and `OutcomeClass::Skipped` is explicitly "not a failure, and deliberately not a success" | `preview/conversion.rs`, `preview/operation.rs`, `proteowizard/conversion.rs`, `preview/adoption.rs` |
| Staging and finalization | The backend writes only into a staging directory MSCanvas owns; the final name is taken atomically, handle-bound, after the integrity contract passes | ADR 0009 and its M3.0.1 / M3.0.2 amendments |
| Multi-output | A SCIEX acquisition is **one item, one process, one row** producing a backend-named set, with per-member validation and a partial-finalization report | ADR 0021, ADR 0025; `conversion_run/output_set.rs` |
| Truthful progress | `current_index` and `item_count`, plus separate finalized / skipped / failed / retryable-failed / non-retryable-failed / cancelled / not-run / cancellation-failed counts. The DTO says it: `ConversionQueueDto.current_index` is "Always a count of items, never a fraction of one", and `WorkspaceConversionStateDto::Running` adds "There is deliberately no completed fraction: what is measured is how many items are done, and nothing measures a fraction of one" | `dto.rs` `ConversionQueueDto`, `WorkspaceConversionStateDto::Running` |
| Adoption | Explicit, per terminal queue, and admitted only where the final name still resolves to the exact finalized object holding the validated byte length and digest | ADR 0016, ADR 0025; `preview/adoption.rs` |

**Six of the nine decisions this route has to record therefore start from an
implementation rather than from a blank page**, and the route is shaped
accordingly: M6 is mostly about giving a strong boundary an honest product
surface, not about building the boundary.

### What is missing, each classified

| # | Gap | Class | Owner slice |
| --- | --- | --- | --- |
| G1 | Conversion has **no shared availability authority**. `canConvert` is an ad-hoc boolean in `PreviewWorkspace.tsx`, the handler guard in `useConversionOperation.ts` is a strictly narrower expression, and there is no reason, no message and no explanation for a disabled `Convert` | authority defect | **M6.1** |
| G2 | The `convert` **ref/render window**: `busyRef` is raised synchronously at dispatch while every rendered value derives only from an arriving slot read, so the operation refuses while the surface still says available | authority defect | **M6.1** |
| G3 | `applyUpdate` assigns `busyRef` unconditionally from the arriving status, so a read installing a non-owning status can **lower a claim a handler just raised** | authority defect | **M6.1** |
| G4 | `ConversionOperation.canRetry` is computed and **has no consumer**; the `Retry` button answers to `canConvert` instead — two rules that can drift | authority defect | **M6.1** |
| G5 | No `msconvert` **capability measurement** exists beyond single- and multi-output mzML with `--zlib`. No `--filter`, no filter ordering, no `peakPicking`, no MS-level selection and no compression choice has ever been executed through this boundary | evidence gap | **M6.2** |
| G6 | There is **no typed conversion intent**. `OpenFormat::MzMl` is hard-coded in the planner and `ConversionPolicy::default()` fixes zlib, so `ConversionQueue` binds no intent because there is none to bind | model gap | **M6.3** |
| G7 | CNV-002 mzXML is unplannable at the product boundary. `OpenFormat::MzXml` and `require_conversion(OpenFormat::MzXml)` exist in the crate, and a test pins that the mzXML grammar **does not** enable public conversion planning | gated by evidence | **M6.2**, then **M6.10** |
| G8 | CNV-003 exposes no location *choice*. There is one Rust-owned folder picker and no sibling / named-subfolder / custom vocabulary | product surface | **M6.5**, **M6.6** |
| G9 | No admitted acquisition family is **directory-shaped**, so the vendor-dataset-root rule CNV-003 states has never been exercisable. `ProcessError::OutputDirectoryInsideDirectoryInput` and `BackendExecutionFailure::OutputInsideSource` exist and are unreachable for conversion today | latent safety rule | **M6.5** |
| G10 | CNV-008's overwrite half is unimplemented, and what is missing is a **destructive-finalization contract on the Rust side** — how an already-validated new object replaces an existing destination object without a failure losing the old one. The backend's own overwrite behaviour is *not* the gap: ADR 0009 sends the provider only into private staging and refuses before launch where the final target exists | product and architecture gap | **M6.6** |
| G11 | No `Convert all`. `scope` is derived — `selection` where any convertible row is selected, else `focused` — and there is no scope control; WSP-008 is recorded as partially implemented for exactly this reason | product surface | **M6.7** |
| G12 | Queue capacity is `16` with a **wait-time** rationale whose stated premise is stale: the doc comment justifies it on the queue having "no cancellation", and a queue-level stop has existed since ADR 0015 | stale rationale | **M6.7** surfaces it, **M6.8** re-decides it |
| G13 | No per-item cancel and no queued-item **skip**. `request_stop` takes an operation id and no index, and the module records the omission as deliberate. Queued-item *removal* is a different request and is refused — see CNV-D7 | product surface | **M6.8** |
| G14 | Capacity is never surfaced proactively — a seventeen-row selection learns the limit from a failed plan read | product surface | **M6.7** |
| G15 | No conversion result carries an identity that outlives its queue. `SlotState::Terminal` holds exactly one queue and is "not a history" | M8 readiness seam | **M6.9** |
| G16 | The staging-ownership marker is **forgeable** by anything that can write into the destination root | `DEFERRED_WITH_OWNER` | **M6.5** records it where the destination contract lives; closing it is **M8's**, with the artifact-identity work — it is an authenticated-ownership question, not a conversion-surface one |
| G18 | `reclaim_staging_area` is reachable only from tests, so a staging name wedged by a failed cleanup has no application-reachable remedy | `DEFERRED_WITH_OWNER` | **M6.5** records it; a recovery path is **M7's**, with the diagnostics and error-recovery surfaces |
| G17 | The same defect is named two ways across five documents — the `convert` ref/render window in `BOOTSTRAP_STATUS.md` and [ADR 0041](0041-viewer-selection-availability.md), the conversion lane's dispatch race in `ROADMAP.md`, [ADR 0037](0037-viewer-completion-route.md) and [ADR 0042](0042-viewer-completion-closure-and-handoff.md) — and carries no tracking identity under either | record defect | **M6.0**, here |

### The M5 handoff, characterised exactly

**The window still exists.** In `useConversionOperation.ts`, `convert` reads
`busyRef.current` and raises it synchronously in the click handler, and sets no
React state any surface reads — `setError(null)` is a no-op where the error is
already null. Every rendered answer, `backendLaneBusy` and the wider `busy`, is
computed from `state.status` and `retrying` alone, and `state` is installed only
by `applyUpdate`. The window opens at the click and closes when the first slot
read carrying an owning status commits.

Three things the M5 record did not say, and this audit found:

1. **The divergence runs in both directions.** M5.8 described the surface saying
   available while the operation refuses. The reverse is also live: the handler
   guard is *strictly narrower* than the rendered `disabled` expression, so a
   quarantined backend, an installation check in flight and an unsettled
   workspace mutation each disable the button while the handler itself would
   accept a dispatch that reached it another way.
2. **A read can lower a claim.** `applyUpdate` assigns `busyRef` from the
   arriving status unconditionally, so a reply describing a slot that has not yet
   seen the dispatch clears a claim the handler raised a moment earlier.
3. **The viewer already holds the answer pattern.**
   `viewer/selectionAvailability.ts` is one input struct, one discriminated result
   carrying a reason and a message, and a `canStartSpectrumSelection` defined as a
   *projection* of it, so the handler and the surface evaluate the same code.
   Conversion has no equivalent. [ADR 0041](0041-viewer-selection-availability.md)
   proved the shape; M6.1 applies it to the lane that needed it first.

**This is why M6.1 is first.** Settings, scope, cancellation, destination and
completion each add a control that must say truthfully whether pressing it will
do something. Building any of them on two disagreeing rules multiplies the defect
rather than containing it.

**And it is given one name.** From here the defect is **the conversion-lane
availability divergence**, covering G1 to G4 together, so a reader meeting either
of the two older phrasings meets one item rather than two.

### Residual items re-checked, and not absorbed

Three historical items were re-checked against the live repository rather than
assumed. **None is M6-owned by any current authoritative document** — not
ADR 0042's deferred-owners table, not its residuals inventory, and not
`ROADMAP.md`'s M6 section. They are recorded here so a later reader does not
rediscover them as M6 debt.

| Item | Live disposition |
| --- | --- |
| `projection.rs` rustdoc P3 | **UNDEFINED.** It exists as two back-references only, neither of which states what the debt is; M5.1's own section records no P3 table and ADR 0038 contains no `P3`. It cannot be closed because it was never stated. The `projection.rs` guard that *does* exist — `validate_drawability_is_settled_in_one_place` — is a passing validator, not this item |
| Retention-time viewport rounding | **OPEN**, owner recorded as the placeholder "whichever slice next owns that planner" ([ADR 0039](0039-visible-spectrum-viewport-adapter.md)). Still live: `viewportAction.ts` has no `zoomedTo`/`pannedTo` equivalent of the spectrum planner's exact-limit repair, and the shipping comment in `spectrumViewportAction.ts` says so. It is a **chromatogram viewport** question; M6 changes no viewer planner and does not adopt it |
| Spectrum `clipPath` and transient transform | **NOT A RESIDUAL.** The `clipPath` is implemented deliberately in `StickSpectrum.tsx`, and "a transient transform surviving a render" is recorded as a *killed mutation* against a repaired defect ([ADR 0039](0039-visible-spectrum-viewport-adapter.md); `SpectrumViewport.tsx`'s post-render reset) |

M4.4's four P3s are closed and were re-verified at M5 closure
([ADR 0037](0037-viewer-completion-route.md#m44-confirmation-findings-inherited-as-technical-debt)).
M6 inherits none of them.

## What M6 is, stated as a boundary

M6 completes the **conversion workflow a working scientist meets**, on top of the
private boundary ADRs 0009 to 0027 already froze. It is finished when a user can
say what they want converted, where it goes, what happens to it on the way, and
what happened to it — and when every one of those answers is either backed by a
live measurement of the exact installed build or explicitly refused.

**M6 is not:** a second conversion engine, a parallel executor, a persistent run
history, an artifact model, a redesign of the workspace, a plugin surface, or a
viewer change. It is not a milestone that admits a capability because the CLI has
a flag for it.

Four boundaries hold for the whole milestone.

**Scientific authority stays where it is.** Source, typed operation, scientific
result, bounded screen representation, view. No conversion decision is taken from
what a panel is displaying.

**Every admitted setting is evidence-bound.** A control exists because the exact
installed executable was measured doing the thing the control claims, not because
`msconvert --help` lists an option. This is [ADR 0037](0037-viewer-completion-route.md)'s
rule and M5.4's durable output, and it applies to `msconvert` exactly as it
applied to `msaccess`.

**Fail closed.** Where authority cannot be established M6 refuses or defers,
preserves the capability that is still true, and does not infer, clamp,
synthesize or approximate. A refusal is a product state with a reason, not an
absence.

**The lifecycle stays five judgements.** Process exit, staged output, finalized
output, verified integrity and workspace adoption are separate, and no M6 surface
may collapse them into one word.

## Three cross-cutting contracts M6 freezes

Each already has a partial implementation and repository-native name. M6 does not
invent a vocabulary beside them; it names what exists, states the property that
makes it worth having, and says what M6 must add to keep it true as the surface
widens.

### 1. The bound plan — `ConversionQueue`

**`ConversionQueue` is the bound plan, and it already is one.** Membership,
order, conflict policy and the calling document's epoch are fixed by
`ConversionQueue::new`; the admitted destination is fixed by the first
`start_running` and retained for the queue's life including across retries; the
installation identity is bound on the first pass and required to match on every
later one. Nothing appends, removes, reorders or de-duplicates afterwards. A
retry is *the same queue again* — same operation id, same order, same
destination object — not a new queue made of what is left.

**The property.** Once conversion begins, what runs is decided. Re-sorting or
re-searching the roster changes what the user is looking at, not what the queue
does; removing a row a live queue holds is refused with `conversion_busy()`.

**What M6 must add.** The queue binds no *conversion intent*, because there is
none to bind: the format is hard-coded and the compression is a fixed policy
inside the plan. The moment M6.3 makes an intent expressible and M6.4 makes it
visible, **the intent joins the bound facts** — captured at `ConversionQueue::new`
alongside the conflict policy, never re-read per item, and never re-read from a
control the user may since have moved. Two further facts M6 adds have the same
obligation: the **destination policy** M6.5 introduces is a bound plan fact, and
so is every identity it resolves to — but those are not the same cardinality. The
policy is one decision bound to the plan; a source-relative policy resolves to
**one identity per item**, and a custom-folder policy may resolve every item to
the same one. What is bound is *policy plus the resolved identity for each item
it applies to*, and neither is re-derived afterwards. And any **destructive
authorization** M6.6 admits is bound to the plan that carried it rather than to
the session.

**Per-queue facts and per-pass facts are different, and only the first are
written once for the queue's life.** Membership, order, conflict policy, intent,
destination **policy** and installation identity are per-queue: a retry is the
same queue again, so it reuses them. The **resolved destination identities** are
bound per applicable item under that policy, and a retry **revalidates every
identity it will use** — it never re-resolves the policy into a different
destination. A **destructive authorization is per-pass** — it
authorizes one attempt at destroying named outputs, and a retry that would
destroy again must be authorized again. That is not a plan mutation: the earlier
pass's authorization is not edited, and a pass without a fresh one refuses rather
than inheriting.

**The rule, stated so it can be broken visibly.** A queue's per-queue plan facts
are written once, at creation or at first destination admission, and read
thereafter; a per-pass fact is written once per pass and never carried into the
next. A control the user can still move is not a plan fact. A plan fact that can
change after `BEGIN` is a defect, not a feature.

### 2. The item outcome — five judgements, not one boolean

The crate already refuses a success boolean. `ProcessOutput::success()` is
`Exited && exit_code == Some(0)` and is deliberately not the answer;
`BackendRunFacts` carries `termination` beside `exit_code` precisely because the
two can disagree; `SkippedExistingDestination` is neither. What M6 freezes is the
*shape*, so a widening surface cannot quietly re-collapse it.

```text
1 process outcome      Termination { Exited, Cancelled, NotStarted } + exit code
                       -- and Exited(0) is not a result
2 staged output        StagedContentObservation, and StagingResidue where teardown
                       could not reclaim -- observed, never inferred from whether
                       a final output appeared
3 finalized output     the handle-bound rename, taken only after validation, and
                       for a set which members took their names
4 integrity            ValidationMode { SourceComparison, OutputOnly }, the three
                       IntegrityProperty sets -- verified, unverified,
                       inapplicable -- and the separately typed
                       AdvisoryObservation set beside them
5 adoption             the final name still resolving to the exact finalized
                       object holding the validated length and digest
```

**Staged output is its own judgement, and these two must stay distinguishable:**

```text
process ended badly / something was staged / nothing published
process ended badly / nothing was staged   / nothing published
```

**The boundary makes this judgement on some paths and not others, and M6.9 owes
the difference.** `observe_staged_content` is called on the stop paths — an
unconfirmed cancellation, and a non-ordinary termination that was actually
requested — and on the multi-output set-stop. It is **not** called on an ordinary
failure: a run that exits non-zero, or reports `BackendDidNotComplete`, settles
without any staged-content observation being taken. `staging.discard()` runs on
every path, but `StagingResidue` answers a different question — what teardown
could not reclaim — and a clean teardown of a directory that held a half-written
output returns the same `None` as one that held nothing.

So judgement 2 is **partly modelled and partly absent**: the type
(`StagedContentObservation`), the wire field (`partial_output_observed`) and the
residue channel exist and are correct, and the observation is simply not taken
where a conversion fails without being stopped. **M6.9 extends it to those
paths** — which is a model addition, not a projection of something already
answered, and this route says so rather than implying the work is already done.

**Artifact facts are not one of the five.** Names, byte lengths, digests,
observed spectrum and chromatogram counts and output-set membership are valuable
evidence and they are M8-readiness material; they describe *what was produced*
rather than *how far the lifecycle got*. Substituting them for the staged-output
judgement is the same collapse in a different direction.

**Multi-output and partial sets are first class.** A SCIEX acquisition is one
item, one process and one row producing a backend-named set; three of five
members landing is a *partial finalization report*, not a failure and not a
success. `ItemState` has eight members for this reason — `Pending`, `Running`,
`Finalized`, `Skipped`, `Failed`, `Cancelled`, `NotRun`, `CancellationFailed` —
and the interface renders eight distinct labels.

**Two things this audit found and M6.9 owns.** The judgements are separated in
the crate's vocabulary but the item's own visible state does not carry them; and
judgement 2 is not separated everywhere in the vocabulary either, because the
staged-content observation is skipped on ordinary failures. Concretely:
`finalized` renders as the bare word "Converted", and whether anything was
compared is a queue-level disclosure rather than a per-item fact. Separation that
a reader cannot see is separation the next surface will collapse.

**The rule.** No M6 surface, wire type or summary may reduce an item to
succeeded/failed. Where a caller needs one word, it names the *class* it is
projecting from and the projection stays lossy on purpose.

### 3. The capability-evidence binding — `EVIDENCED_PROVIDER_BUILDS`

**The shape already exists and is exactly right.** A row is
`(source family, release, source revision, msconvert.exe SHA-256)`, it exists
because a real acquisition of that family was converted on that exact build
through this boundary, and `provider_build_is_evidenced` refuses an unevidenced
family before a staging directory exists. Widening support is *adding a measured
row*, not relaxing a check. The executable is re-verified before launch and
`ExecutableChanged` fails a run whose binary moved under it.

**What M6 extends it to.** Today the binding answers one question — may this
*family* be converted on this build. M6 makes settings expressible, so it must
answer a second: may this *setting* be admitted on this build. The binding
therefore grows a second axis, and every admitted setting traces to:

```text
exact provider identity     release + revision + executable digest, as today
measured capability         a live run of the exact build, on a pinned fixture,
                            with the observed output examined -- not help text
product semantics           what MSCanvas says the setting means to a scientist
command mapping             the argv this intent produces, in a deterministic order
```

**A visible setting must not exist merely because a CLI flag exists.** The
repository has already paid for this rule twice: `msaccess` printed a `tic`
signature that could not serve the science ([the M5.4 spike](../../spikes/M5_XIC_SOURCE_EVIDENCE.md)),
and `msconvert --mzXML` returned exit `0` while dropping one of four spectra
([the M0 spike](../../spikes/M0_PROTEOWIZARD_SPIKE.md)). Both were help-text-clean
and behaviourally wrong.

**And evidence does not transfer between executables.** Two builds can print
identical help while differing in what they compute, what they serialize and
whether an ordinary input aborts. This is [ADR 0037](0037-viewer-completion-route.md)'s
rule and M5.4's durable governance output, and it binds `msconvert` in M6 exactly
as it bound `msaccess` in M5.

## The M6 route

Twelve slices. The order is not a preference: the dependency graph below has no
cycle, and every edge is a real one — a slice consumes an authority an earlier
slice established, or measures something a later slice may not assume.

```text
                              M6.0  route lock
                                     |
                    +----------------+----------------+
                    |                                 |
            M6.1 lane authority              M6.2 msconvert evidence
                    |                                 |
                    |                 +---------------+---------+
                    |                 |                         |
                    |        M6.3 ConversionIntent              |
                    |                 |                         |
                    +--------+--------+                         |
                             |                                  |
                     M6.4 visible settings                      |
                             |                                  |
                     M6.5 destination authority                 |
                             |                                  |
                     M6.6 destination / conflict UX             |
                             |                                  |
                     M6.7 convert selected / all      M6.10 evidence-gated
                             |                            side routes
                     M6.8 cancellation and progress             |
                             |                                  |
                     M6.9 output completion / adoption          |
                             |                                  |
                             +------------------+---------------+
                                                |
                                         M6.11 closure
```

Every edge in the diagram appears in the table below, and every edge in the table
appears in the diagram. **M6.2 has two children** — M6.3 and M6.10. It no longer
feeds M6.6: the destructive question is answered by MSCanvas's own finalization
boundary, so the edge that existed only to wait on a provider measurement is
gone. M6.10 descends from M6.2 alone — a measurement branch, not a stage of the
M6.4-to-M6.9 chain — and converges only at closure.

**M6.11 is downstream of every slice that owns a core criterion**, transitively:
M6.1 through M6.9 along the spine, and M6.10 along the branch. There is no core
criterion whose owner closure does not depend on.

Read as edges, with the reason each exists:

| Edge | Why it is real |
| --- | --- |
| M6.0 -> M6.1 | M6.1 needs the audit that says which rules disagree and where |
| M6.0 -> M6.2 | M6.2 needs the frozen evidence contract and the fixture/identity baseline |
| M6.1 -> M6.4 | A visible setting is a control; a control needs one availability rule |
| M6.2 -> M6.3 | An intent may only name semantics the build was measured performing |
| M6.3 -> M6.4 | A visible setting projects a typed intent; it does not create one |
| M6.4 -> M6.5 | The plan the destination is admitted for must already be truthful |
| M6.5 -> M6.6 | Conflict and destructive UX act on a resolved destination |
| M6.6 -> M6.7 | A scope control must display, per row, the destination policy and conflict vocabulary M6.6 establishes — a plan of many rows cannot show what each will do before that exists |
| M6.7 -> M6.8 | Per-item cancel and queued-item skip are operations *on a plan's membership*, so what membership means has to be settled before what may be done to it is |
| M6.8 -> M6.9 | A completion summary must be able to say what a cancelled item is |
| M6.2 -> M6.10 | Every side route is opened or closed by a measurement |
| M6.9, M6.10 -> M6.11 | Closure answers criteria the two of them settle |

M6.1 and M6.2 are independent of each other and may run in either order or
together. **M6.4 through M6.9 are a chain**; M6.10 needs only M6.2 and may run
any time after it.

### M6.0 — Conversion Completion orientation and route lock

**This slice.** Documentation only.

*Establishes:* the live gap audit, the twelve-slice route, the three
cross-cutting contracts, the nine product decisions with their evidence status,
the finite exit criteria, the XIC disposition and the M7/M8 seams.

*Consumes:* [ADR 0042](0042-viewer-completion-closure-and-handoff.md)'s handoff,
the accepted conversion ADRs, and the live tree at the baseline above.

*Acceptance:* a reader can start M6.1 without reopening the product model; every
decision below carries a status a later slice can act on; no decision is asserted
where the evidence is absent.

*Non-goals:* no production code, no test behaviour, no measurement of the
backend beyond reading the installed executables' identity, no XIC work.

### M6.1 — Conversion-lane authority

*Purpose:* one rule that decides whether a conversion action may start, read
identically by the operation and by every surface that offers it.

*Prerequisites:* M6.0.

*Establishes:* a `ConversionLane` input and a discriminated availability result
carrying **a reason and a message**, on the shape
[ADR 0041](0041-viewer-selection-availability.md) proved; the handler guard
defined as a *projection* of it rather than as a second expression; a rendered
twin for a dispatched `convert`, as `retrying` already is for a dispatched retry;
and the removal of the unconditional `busyRef` assignment that can lower a claim
a handler raised.

*Acceptance:* the conversion-lane availability divergence (G1-G4) is closed in
both directions — no surface offers a conversion action the operation would
refuse, and no surface withholds one the operation would accept. A refused
conversion action states one reason, once, in one accessible occurrence.
`canRetry` has exactly one definition and the `Retry` control reads it.
Everything backend-free stays available while the lane says no.

*Non-goals:* no new setting, no new command, no queue-model change, no viewer
change. This slice makes an existing set of controls truthful.

*Downstream:* M6.4, and every slice that adds a control.

### M6.2 — `msconvert` capability and evidence

*Purpose:* measure the exact installed build doing the things M6 wants to offer,
and record admission or refusal per candidate.

*Prerequisites:* M6.0.

*Establishes:* an evidence document on the shape M5.4 set — a live candidate
inventory with exact installed signatures, a final classification with one state
per candidate, a candidate-standard matrix with every intersection filled, and one
declared route outcome. Candidates are the settings M6 might admit: mzXML output;
`peakPicking` with its algorithm selector and MS-level argument; MS-level
selection; and compression on and off.

**What `msconvert` does to an existing output is deliberately not a candidate
here.** It was one in an earlier draft, gating CNV-D4. It cannot: ADR 0009 sends
the provider only into private staging and refuses before launch where the final
target exists, so the provider never meets that file and the answer could not
authorize a destructive product decision. It stays an unobserved provider fact,
recorded but **off the critical path**, and no slice waits on it.

**Its sibling is not still open, and the route corrects itself here.** Whether
`msconvert` writes anything besides its output **was measured on 2026-08-07** and
again for the multi-output case on 2026-08-10, on the installed build: a default
mzML conversion of a Thermo RAW acquisition and of an mzML acquisition each
produced exactly one file with no sidecar, index, log or scratch entry, and a
SCIEX acquisition's backend-named set was measured and modelled. What ADR 0009
leaves open is narrower and lands squarely on M6: **a non-mzML output format has
never been measured for it**. So M6.2 owes the question only for a format it
admits, and only where it admits one — which makes it a consequence of CNV-D1
rather than a standing debt. `## Intentionally pending` still carries the closed
half as open, and M6.0 corrects that bullet where it lives.

*Acceptance:* every candidate reaches a terminal state with a basis. Every
admission names an exact executable identity and a measured observation of the
*output*, not of the exit code. Every refusal is stated with what was measured.
No candidate is admitted on help text. The two pending measurements are performed
or explicitly re-deferred with an owner.

*Non-goals:* implements no setting, changes no argv builder, admits nothing into
the product by itself.

*Downstream:* M6.3, M6.10, and D1 and D2's evidence halves. **Not M6.6, and not
D4's** — the destructive question is answered by MSCanvas's own finalization
boundary, which no provider measurement can settle. **Not D7's** either:
cancellation's evidence half is measured inside M6.8, against a running
conversion, and cannot be taken by a capability slice.

### M6.3 — Typed `ConversionIntent`

*Purpose:* one typed operation-side authority for what a conversion is asked to
do, and a deterministic mapping from it to argv.

*Prerequisites:* M6.2 — an intent may only name a semantic the build was
measured performing.

*Establishes:* a `ConversionIntent` in the domain layer covering output format,
processing intent, **numeric precision** and compression as *product semantics*
— precision belongs here because CNV-D2 establishes that it is a separate and
prior decision from compression, and a decision nothing types is one the
provider's default takes; its deterministic argv
mapping including **filter order**, which is a property of the intent and not of
the order controls happen to sit in; and its capture into `ConversionQueue`'s
bound facts.

*Acceptance:* an intent the evidence does not admit cannot be constructed. Argv
order is deterministic and pinned by test for every admitted combination. The
same intent produces the same argv on repeated planning. No intent is expressible
that would insert a peak-picking filter where the product says no additional
centroiding. **And where a processing intent is admitted at all**, an output
whose own processing record names a different algorithm from the one asked for
fails the integrity contract rather than finalizing — read as a claim compared
against the request, never as proof, with absence recorded as unverified.

*Non-goals:* no UI, no new visible capability, no relaxation of the no-implicit-
centroiding rule.

*Downstream:* M6.4.

### M6.4 — Visible settings, and a truthful plan

*Purpose:* make admitted intents selectable, and make the pre-run summary
describe the plan that will actually be bound.

*Prerequisites:* M6.1 (a control needs one availability rule), M6.3 (a control
projects a typed intent).

*Establishes:* the visible controls for whatever M6.2 admitted; CNV-009's
natural-language summary widened from item count and ordered list to **format
and processing**; and the binding of the chosen intent into the queue at `BEGIN`.

**CNV-009's output-root half is not M6.4's, and cannot be.** In the live flow the
destination is chosen *after* the queue is created — the slot passes through
`awaitingDestination` and `ConversionQueue::new` constructs with
`destination: None` — so at summary time there is no root to name, and
`ConversionQueuePlanDto` carries none. It lands with the destination policy in
**M6.5** and its visible form in **M6.6**. Until then the summary says the
destination is chosen next, which is what the panel says today and is true.

*Acceptance:* every visible setting traces to an evidence row. A setting the
installed build does not support is absent or refused with a reason, never shown
inert. **Of the plan facts that exist before dispatch** — membership, order,
conflict policy and intent — the summary names the ones that will be bound, and
moving a control after `BEGIN` changes nothing about the running queue. A lossy
processing choice is marked lossy where the user chooses it.

*Non-goals:* no destination choice, no destination display, no scope control, no
cancellation change.

*Downstream:* M6.5.

### M6.5 — Destination authority

*Purpose:* a destination *policy* — source sibling, named subfolder, custom
folder — and its deterministic resolution to the object identity, or identities,
the boundary already requires.

*Prerequisites:* M6.4.

*Establishes:* the policy vocabulary; **the resolution cardinality each policy
implies**, and the per-item binding that follows from it; resolution from a
policy to an admitted directory object, keeping the existing reparse-point,
non-directory and remote-volume refusals; **the vendor-dataset-root rule made
real** rather than latent; source/destination aliasing decided by object identity
rather than by the canonical-path prefix test that decides it today;
**CNV-009's output-root half**, inherited from M6.4 because no root exists before
a policy resolves one; and the retry-time revalidation contract stated where a
reader meets the policy.

**One policy, and as many resolved identities as it implies.** The queue holds a
single `Option<AdmittedDestination>` today, and `ConversionQueue::new` requires
only that the list is non-empty, within capacity and free of duplicates — it does
**not** require the items to share a parent, and nothing in the accepted ADRs or
the product documents requires a conversion scope to. So a queue may hold
`C:/run-a/sample1.raw` beside `D:/run-b/sample2.raw`, and a queue-wide
`source sibling` is then **two** destination objects, not one. Binding one
resolved destination to the whole plan would either write the second item beside
the first item's source or refuse a batch that is perfectly valid — and it would
do so to preserve an implementation detail rather than a decided architecture.

```text
DestinationPolicy            one user decision, bound to the plan
  source sibling             source-relative -- resolved and bound PER ITEM
  named subfolder            source-relative -- resolved and bound per item,
                             under the item's SIBLING folder, never inside the
                             acquisition itself
  custom local folder        one chosen folder -- every item may resolve to the
                             SAME admitted DestinationIdentity, and that is the
                             policy working rather than a special case
```

**`named subfolder` resolves under the sibling, not under the acquisition, and
the difference is the whole vendor-dataset-root rule.** For a directory-shaped
acquisition the logical acquisition root *is* the recognised vendor dataset root,
so resolving a subfolder relative to it would land in exactly the place row 2
below fails closed on — and CNV-003 states the same thing as a product
requirement: sibling, subfolder and custom choices *never write inside recognised
vendor dataset roots*. The subfolder is therefore a sibling of the acquisition,
created beside it, and the containment order below is what enforces that rather
than a promise made here.

**This extends two accepted decisions, and says so.** It is not a limit nobody
decided. [ADR 0013](0013-serial-conversion-queue.md) is accepted "into one local
folder", carries a Decision section headed *One destination and one policy for
the whole queue*, and states its retry rule as rerunning "against the same
folder". [ADR 0020](0020-first-visible-shimadzu-lcd-workflow.md) restates it for
the mixed-family queue this decision is widening: "One queue, one destination,
one conflict policy, one serial backend lane."

**So M6.5 is an explicit extension of both**, and this route says which — because
it opens by promising exactly that: where a decision looks new it is either a
product surface over an existing boundary or an explicit extension of one, and it
names which. An earlier draft of this paragraph asserted that no ADR locked the
count and that the widening contradicted nothing. That was false, and it skipped
the extension notice this document's own rules require.

**What the amendment changes is the count, and nothing else.** Everything
ADR 0013 decided *about* a destination is preserved verbatim: admitted under
ADR 0012's rules — local, a real directory, not a link, not UNC, not remote;
retained as an **object** rather than a name, by volume serial and 128-bit file
ID; a platform that will not answer with an identity read as a refusal; and the
admission **held** for the length of the item rather than released the moment it
answers. ADR 0013 already requires that proof "before **every item**, not once
for the queue" — the per-item cadence is its own, and what M6.5 alters is only
that the item may prove a *different* admitted object where the policy resolves
to one.

**Why the amendment is warranted rather than convenient.** ADR 0013 decided one
folder for a queue of Thermo RAW rows under one conflict policy, and its status
line gates every widening separately; the queue has since become family-plural by
its own M3.9 amendment. A source-relative policy is the first thing that makes
the count wrong rather than merely narrow — one folder cannot express
`source sibling` for a queue whose items have different parents, and the choice
is between amending the count and refusing a policy CNV-003 has carried since
before the queue existed.

**The queue-wide name-collision check becomes destination-aware, and M6.5 owes
that too.** `plan_items` refuses a queue whose items fold to one output name, and
its own comment gives the premise: "Two items writing one name into one folder is
not a conflict with something that was already there." The check compares folded
names with no destination in the comparison, which is exactly right while there
is one folder. Under a source-relative policy it is not: `C:/run-a/sample.raw`
and `D:/run-b/sample.raw` both plan `sample.mzML` into **different** destination
objects and do not collide, yet the check as written refuses the queue outright.
So the comparison becomes *(destination identity, folded name)* rather than
folded name alone — the refusal stays exactly as strong where the pair really
does collide, and stops refusing batches that never did. **This is the same
widening as the cardinality change and belongs to the same slice**; CNV-D4 cites
this check when it refuses automatic rename, and that refusal survives unchanged,
because a policy that invents a name is a different thing from two names that
were always distinct.

**M6.5 owes ADR 0013 and ADR 0020 an amendment note when it lands.** M6.0 does
not edit those documents: a route lock records the decision, and the slice that
implements it annotates the ADRs it changed, exactly as M3.9 did to ADR 0013
when the queue became family-plural.

**And what ADR 0013 decided about retry is extended in the same direction, not
relaxed.** "Against the same folder" becomes *against the same object for every
identity the pass will use*: a retry still never re-asks the user, still never
re-resolves the policy into a different destination, and now revalidates each
bound identity rather than the single one.

*Acceptance:* a destination is a folder object, never a path string. **The
policy is a bound plan fact; the identity or identities it resolves to are bound
deterministically to the item or items they apply to**, and every one of them is
revalidated by identity on every later pass. Two runs of the same policy over the
same bound membership resolve to the same identities.

**Three containment questions, and they have three different answers.** They are
separated here because collapsing them into one “the destination contains the
source” rule would refuse the `source sibling` policy this route just locked —
for a file-shaped acquisition the sibling folder *is* the file's parent, so it
contains the source by construction, and that is the policy working rather than a
violation.

**They are ordered, not parallel**, because rows 2 and 3 can match the same
destination and something has to say which wins:

| # | Case | Answer |
| --- | --- | --- |
| 1 | **Object aliasing.** The resolved destination object *is* the source object | **Refused**, on object identity rather than on a path prefix. Like row 2, **currently unexercisable**: every admitted source is a regular file and every destination is a directory object, so the two cannot be the same object today |
| 2 | **Output inside a directory-shaped acquisition.** The destination is the recognised vendor dataset root, or lies under it | **Fails closed**, unchanged and not weakened by anything below it. Also **currently unexercisable**, because no admitted family is directory-shaped — recorded as the reason, rather than as the rule being absent |
| 3 | **Sibling container of the logical acquisition**, reached only where neither 1 nor 2 matched | **Admitted.** This is `source sibling`, and it is one of CNV-003's three policies |

**Row 3 is defined on the logical acquisition, not on the filesystem shape**, and
that is the correction that makes it complete. An earlier draft restricted it to
file-shaped acquisitions, which left a future directory-shaped family with *no
admitted outcome at all*: for `C:/runs/sample.vendor/` the sibling container is
`C:/runs/`, which is not the acquisition object (row 1 declines) and is not
inside it (row 2 declines), and a file-only row 3 would then decline too — a
refusal of the very policy CNV-003 requires.

So the sibling container is whatever contains the **logical acquisition**:

```text
regular file        the file's parent folder
bundle              the container of the logical acquisition -- for a SCIEX
                    bundle the primary's parent, which is where the companion is
                    derived from and therefore where the acquisition lives
directory-shaped    the parent of the acquisition directory, NOT the acquisition
                    directory itself
```

For a bundle the repository's own logical-acquisition authority decides this
rather than an arbitrary member path: the companion is derived from the primary's
whole file name in the primary's own parent, so the bundle has one container and
row 3 names it.

**Order is what keeps row 3 safe once directory-shaped families exist.** Row 3
admits the acquisition's *sibling container*; row 2 refuses anything at or under
a directory-shaped acquisition, and is asked first. So for a directory acquisition
the parent is admitted and the acquisition's interior is refused, which is exactly
CNV-003's requirement. Safety comes from the order and from row 3 naming the
container rather than from any assumption that a parent is never a dataset root —
a rule resting on that assumption would fail silently the moment one was.

**And each row states its own mechanism.** Row 1 is an **object-identity
comparison**, replacing the canonical-path prefix test that stands in for it
today. Row 2 is an **ancestry walk from the destination's admitted object up to
the acquisition root, compared by identity at each step** — not a string prefix,
which is what fails over links, substituted drives and mount points. Row 3 needs
no comparison at all: it is what a resolved policy produced, admitted because the
two rows above it declined. What M6.5 must not do is decide *any* of the three by
asking whether one canonical path happens to begin with another.

*Non-goals:* no conflict UX, no overwrite. It resolves where output goes, not
what happens when something is already there.

*Downstream:* M6.6.

### M6.6 — Destination and conflict UX, including the destructive question

*Purpose:* answer, visibly, what happens when the planned name is taken.

*Prerequisites:* M6.5, and M6.5 alone. The destructive question acts on resolved
destination authority; it does **not** wait on a provider measurement, for the
reason CNV-D4 now records.

*Establishes:* the destination policy's visible form; the terminal disposition of
explicit overwrite — `OVERWRITE_ADMITTED` or `OVERWRITE_REFUSED` — and, **only if
admitted**, a repository-owned destructive-finalization contract plus an
authorization that is explicit, scoped, bound to the plan that carried it, and
**re-asked rather than inherited on retry**.

**The admission gate is the finalization contract, and it is answered before any
UI exists.** An overwrite may be admitted only once M6.6 has established and
tested, on the Rust side: which existing destination object the confirmation
authorizes; how that target is identity-bound; what happens if the target changes
after confirmation; how the already-validated new object replaces the old one;
how a failure avoids losing or corrupting the old target; whether replacement is
atomic to an external observer; the directory, reparse-point, link and alias
cases; retry authorization; multi-output collision and replacement semantics; and
partial destructive failure. **A design that removes the old target first and
then attempts to publish the new one is not acceptable** unless it can prove a
failure cannot lose the prior user file. If that contract cannot be justified,
the answer is `OVERWRITE_REFUSED` and `Fail`/`Skip` stand.

**The provider stays confined to staging under either answer.** The invariant
that the provider never writes directly over a user's existing final output is
not weakened by admitting overwrite; a destructive publication is something
MSCanvas does to its own validated object, not something `msconvert` is pointed
at.

*Acceptance:* a destructive action is never the default and never implicit. A
multi-output collision and a partially existing output set are each answered
explicitly rather than by a rule written for one file. A retry does not inherit a
destructive authorization; it revalidates or refuses. Where overwrite is refused,
the refusal is a recorded decision with its evidence, not an omission.

*Non-goals:* no scope, no cancellation.

*Downstream:* M6.7.

### M6.7 — Convert selected, convert all

*Purpose:* make the scope of a conversion a decision the user takes and can see,
rather than one derived from what happens to be selected.

*Prerequisites:* M6.6 — a scope shows many rows at once, and what each row will
do cannot be shown before the destination policy and conflict vocabulary exist.

*Establishes:* the scope vocabulary — eligible rows, selected rows, the rows a
filter is currently showing, and the ordering each implies — and its binding
into the queue; the treatment of non-convertible rows in a scope; the treatment
of rows added after `BEGIN` (they are not in the plan, and the plan says so); and
capacity surfaced *before* a scope is committed rather than after a failed plan
read.

*Acceptance:* `Convert all` has one stated meaning and it is not "everything in
the workspace" unless that is what it is. Ordering is deterministic and visible
before the action. A scope larger than the capacity is refused with the limit
stated, before the user commits. Membership is bound at `BEGIN` and immune to
later sorting, searching or selection.

*Non-goals:* does not change the capacity. Re-evaluating the bound is M6.8's,
after cancellation is understood.

*Downstream:* M6.8.

### M6.8 — Cancellation, capacity, and truthful progress

*Purpose:* say exactly what a user may stop, prove it against the real backend,
and only then reconsider how large a queue may be.

*Prerequisites:* M6.7.

*Establishes:* the distinction between **stop the whole queue** (exists),
**cancel the current item and continue** (does not exist; admissible only on the
measurement **and** the ownership outcome, and refused under
`OWNERSHIP_UNCONFIRMED`) and **skip a queued item** (does not exist; admissible, and not a
membership change) — with **remove a queued item** refused outright, because it
is a membership change and membership is bound at `BEGIN`; a live measurement of
what an `msconvert` process tree actually is for this build; the terminal
ownership outcome below; and a capacity decision taken *after both*, with a
stated basis.

*The measurement this slice owes.* Windows Job Objects, `TerminateJobObject` and
an emptiness check via `QueryInformationJobObject` are implemented and correct in
shape. What has **not** been measured is that a real `msconvert` run is a *tree*:
`surviving_processes == Some(0)` after termination is satisfied trivially by a
one-process run, and the only multi-process evidence is against a synthetic mock
parent and grandchild — which [ADR 0014](0014-proteowizard-cancellation-evidence.md)
states openly. The peak count is not simply missing, and the precise position
matters: `max_active_processes` **is** read and printed by the M0 spike harness
through `ReportableProcessOutput`, but it appears in **no evidence document**, it
is **absent from `BackendRunFacts`** so no product or diagnostics surface can see
it, and the **cancellation** evidence harness does not report it at all. So M6.8
must publish the peak count and observe it on a real vendor conversion.

**But measurement alone cannot license the claim, and this is the part the route
states as a contract rather than as a task.** The child is spawned *before* it is
assigned to the Job — `spawn()` returns a running process, and
`AssignProcessToJobObject` follows it — and the code names that window
"documented, unavoidable" for what stable `std::process` permits. A descendant
created inside it belongs to no Job, so it is outside `TerminateJobObject` **and
outside the `QueryInformationJobObject` count that reports the job empty**. A
sample that shows a tree and then shows the job empty is therefore consistent
with an escapee having survived: it observes the processes ownership *did*
capture, and says nothing about one it never held. **No number of representative
runs closes a structural hole**, because the hole is in what is being counted.

**M6.8 must therefore close three independent dimensions, and none substitutes
for another:**

1. **Structural ownership** — execution cannot produce an uncaptured descendant
   before ownership exists — **or**, where that cannot be established, a
   fail-closed classification of the path.
2. **A representative measurement** of the exact installed `msconvert` build,
   which is the separate question of what that provider does at run time.
3. **An exhaustive reconciliation** of every production, wire, interface and
   diagnostic claim that represents cancellation *success* or complete
   process-tree disappearance.

**One of two terminal architectural outcomes, and no third:**

```text
OWNERSHIP_STRUCTURALLY_CLOSED   execution cannot produce an uncaptured descendant
                                before ownership exists, so an empty Job is an
                                empty tree. With (2) and (3) also satisfied, an
                                owned-Job-empty stop may settle as a successful
                                Cancelled.
OWNERSHIP_UNCONFIRMED           complete ownership is not established. A launched
                                conversion whose stop rests on that boundary must
                                NOT settle as a successful Cancelled: termination
                                stays unconfirmed, the item settles
                                CancellationFailed, the queue settles StopFailed,
                                and the backend session is quarantined.
```

**An empty Job is not an empty tree while the escape window is open, and that is
the whole finding.** The child is spawned before `AssignProcessToJobObject`; a
descendant created in that interval is outside `TerminateJobObject`, outside the
Job's active-process accounting, and outside the emptiness observation. So
`Some(0)` from the Job does not establish that all conversion-owned backend work
is gone — it establishes it for the processes ownership captured.

**This restores an accepted decision rather than inventing one.**
[ADR 0014](0014-proteowizard-cancellation-evidence.md) already decided it, under
the heading *A confirmed cancellation is the only cancellation*: a run that
cannot establish the tree is gone gets `CancellationFailed`, because "the tree is
gone" and "the tree may still be running" are different facts about the user's
machine, and collapsing the second into the first would let a caller report a
stopped conversion that is still writing. The structural escape is exactly a case
where the tree being gone cannot be established, so ADR 0014's own rule applies
to it. The repository's native boundary requires the same thing in one line:
*cancellation must eventually terminate the complete child process tree.*

**An earlier draft of this route got this wrong, and the correction is recorded
rather than quietly applied.** It said `OWNERSHIP_UNCONFIRMED` withdraws "the
wording, not the state", keeping a successful `Cancelled` for an owned-Job-empty
observation. The argument for it was that the alternative quarantines every stop
and makes `Stop queue` less useful. **That is a consequence, not evidence.**
Product inconvenience does not establish process ownership, and a route that
preserves a success state because withdrawing it is inconvenient is the exact
shape of claim this milestone exists to refuse.

**What follows for the shipped control, stated plainly.** If M6.8 lands on
`OWNERSHIP_UNCONFIRMED`, a stop of a *launched* conversion cannot be reported as
a successful cancellation. That is a real cost, and the route accepts it rather
than describing it away: the honest surfaces are a **refusal or unavailability
before launch** wherever the boundary can decline earlier, and
`CancellationFailed` / `StopFailed` with quarantine for a launched attempt. Which
of those M6.8 offers is M6.8's design; what it may not do is call the result a
successful cancellation.

**`NotStarted` stays distinct, and is unaffected.** Where the request is accepted
before any process was launched there is no escaped process to account for, and
ADR 0014 already separates that case — a refusal has no exit code, no elapsed
time and no job accounting. `Cancelled` remains reachable there under either
outcome.

**A successful cancellation path may never let new backend work start while
MSCanvas cannot establish whether an earlier conversion-owned process survives.**
That is the invariant the three dimensions exist to protect, and quarantine is
how the session already enforces it.

**The route prescribes neither implementation.** Closing the window structurally
is a process-boundary decision, and the process boundary records its own
constraint — stable `std::process` exposes no suspended-create-and-resume or
job-list attribute, with the race carried as a production follow-up — so the cost
is real and M6.8 weighs it. What the route fixes is the *disjunction*: close the
window, or stop claiming a successful cancellation that rests on it.

**Dimension 3 is semantic, not enumerative.** An earlier draft named three sites
and called them the finite list criterion 7 could check against. That was wrong:
the same semantic is propagated across item states, queue counts, cancellation
facts, their mirrored wire fields, diagnostics payload keys, set-stop facts and
the session quarantine reason, so a slice could have reworded three sites, passed
the enumerated check, and left the rest asserting a confirmed process tree. A
hand-maintained list is the wrong instrument for a semantic boundary, because it
is correct only until the next surface is added.

**The contract.** Under `OWNERSHIP_UNCONFIRMED`, **no code-facing name, wire
contract, surface text, diagnostic fact, count description or documentation may
represent a successful cancellation, or assert that the whole process tree was
confirmed gone, on the strength of the owned-Job observation alone.** Under
`OWNERSHIP_STRUCTURALLY_CLOSED` those claims may stand, but only where the
structural guarantee actually makes them true.

**And M6.8 must leave a guard, not a list.** The slice establishes an exhaustive
repository check over that boundary — a focused test, a `check_repo.py`
validator, or a search-backed policy, whichever fits the repository — so that
closure does not depend on anyone having re-counted the sites. The form is
M6.8's; what M6.0 fixes is that a guard exists and is exhaustive over the
semantic rather than over a snapshot.

**An audit baseline, explicitly non-exhaustive and non-authoritative.** These are
representative families found while writing this route, offered so a reader
recognises the shape — **not** a checklist, and satisfying them proves nothing:
item-state descriptions (`ConversionQueueItemStateDto::Cancelled`); queue count
descriptions (`cancelled_count`); cancellation facts and their field *names*
(`tree_termination_confirmed`); the mirrored TypeScript contract
(`treeTerminationConfirmed`); the diagnostics payload key; the multi-output
set-stop facts; and the session quarantine reason. Two senses that are **not**
this claim and must not be swept up with it: "there was no process tree to
terminate" where nothing launched, and teardown's "deeper or wider than teardown
will walk".

**No code changes here** — M6.8 owns whether these are reworded or made true.

**One further code-level fact belongs to the same slice**, and it is the same
shape: an assignment failure degrades to a direct-child kill without being
reclassified as an unconfirmed cancellation — a path where ownership was never
established at all, and which must reach the same disjunction.

*The states that must stay distinct:*

```text
cancellation requested   CancellationToken / stop_requested
stopping                 SlotState::Stopping
owned job terminated     Termination::Cancelled AND final_active_processes == Some(0)
                         -- an observation about the JOB, which equals the tree
                         only under OWNERSHIP_STRUCTURALLY_CLOSED
staging reconciled       staging residue absent, observed rather than assumed
                         -- a staging fact, not a finalization one
terminal cancelled       ItemState::Cancelled -- reachable for a LAUNCHED
                         conversion only under OWNERSHIP_STRUCTURALLY_CLOSED,
                         and always where nothing was launched (NotStarted)
termination unconfirmed  ItemState::CancellationFailed + TerminalReason::StopFailed
                         + session quarantine -- where a launched stop rests on
                         an open ownership window
```

*Progress:* item N of M, per-state counts and the current item's state. No
percentage, no estimate, no fraction of one item. Where finer progress is wanted,
it is admitted only on a measurement showing `msconvert` emits something a caller
can honestly count.

*Acceptance:* every cancellation claim names the observation behind it, **and no
claim reaches further than the scope of what was observed** — an empty Job is an
empty Job, and is an empty *tree* only where ownership is structurally closed.
The slice ends on one of the two terminal outcomes above.

Where it ends on `OWNERSHIP_UNCONFIRMED`: **a stop of a launched conversion does
not settle as a successful `Cancelled`.** It settles `CancellationFailed`, the
queue settles `StopFailed`, the session is quarantined, and **no surface, wire
field, field name, diagnostic key or document represents that result as a
successful cancellation or as a terminated process tree** — proved by the
exhaustive guard above rather than by a reviewer re-counting sites. Where the
boundary can decline earlier, a refusal or unavailability before launch is the
better surface, and offering one is M6.8's design choice.

Where it ends on `OWNERSHIP_STRUCTURALLY_CLOSED`: an owned-Job-empty stop may
settle `Cancelled`, once the measurement and the reconciliation are also
satisfied.

Under **either** outcome, `NotStarted` is unaffected and no new backend work
begins while MSCanvas cannot establish whether an earlier conversion-owned
process survives. Any capacity change states the basis it was decided on, and the
queue stays finitely bounded whatever that basis is.

*Non-goals:* no parallelism, no pause/resume, no persistence.

*Downstream:* M6.9.

### M6.9 — Output completion and adoption

*Purpose:* make what a conversion produced legible, per item and per queue, with
all five judgements visible rather than merely modelled.

*Prerequisites:* M6.8 — a completion summary must be able to say what a cancelled
item is.

*Establishes:* a per-item outcome projection carrying **process, staged output,
finalized output, integrity and adoption** separately — five, with staged output
answerable whether or not anything was published; a completion summary for the
queue; the multi-output partial case stated truthfully at the item; and the
**stable facts M8 will need** — artifact and manifest facts among them, carried
beside the five rather than standing in for one — exposed as reads rather than as
persistence.

*Acceptance:* a reader can distinguish all five, per item, without any of them
being collapsed into success or failure:

```text
process         ran / did not run
staged output   content exists / does not exist / unknown where applicable
final output    published / not published / partially published
integrity       established / not established / inapplicable, as typed
adoption        adopted / not adopted
```

The discriminating case is provable, and it is stated in the terms judgement 2
actually answers: **a failed item that staged something reads differently from a
failed item that staged nothing**, and neither reads as a bare failure. Not
"left residue" — residue is what teardown could not reclaim, and a clean teardown
returns the same answer whether the directory held a half-written output or
nothing at all. Proving this is what obliges M6.9 to take the observation on the
ordinary-failure paths, where it is not taken today. A partially finalized set says how many of what. Artifact and
manifest facts are readable beside the five, and never in place of one. A
completion summary adds up to the queue and contains no fabricated total. Nothing
here persists anything.

*Non-goals:* no run history, no artifact store, no lineage graph, no
cross-session identity. M6 leaves the seam; M8 builds the model.

*Downstream:* M6.11.

### M6.10 — Evidence-gated side routes

*Purpose:* take the conditional branches to a terminal state instead of leaving
them open.

*Prerequisites:* M6.2.

*Establishes:* the terminal disposition of each of the four side routes —
CNV-002 mzXML; vendor-format direct preview; **whether M6 opens any further
vendor family at all**, answered once as a single yes-or-no rather than family by
family, and only then enumerated; and VIEW-007's conditional re-entry.

*Acceptance:* each side route ends in a stated outcome with its evidence:
admitted, refused with evidence, or evidence-blocked with what is missing and who
would supply it.

**Two things are true at once here, and they are easy to run together.** **No
capability on this list is required to be *admitted* for M6 to complete** — M6
finishes on any combination of outcomes, including all four refused. But **every
route in the closed set is required to reach a terminal disposition**, and that
requirement *is* exit criterion 11. Leaving a branch open is not a neutral
outcome; it is the one result this slice exists to prevent, because an
undisposed route is a question the next milestone inherits without knowing it
has.

*Non-goals:* does not open a route the evidence refuses, and does not implement
XIC.

*Downstream:* M6.11.

### M6.11 — Closure

*Purpose:* answer the exit criteria from published evidence and hand M6 to M7.

*Prerequisites:* M6.9, M6.10.

*Establishes:* one closure record on the shape
[ADR 0042](0042-viewer-completion-closure-and-handoff.md) set — every criterion
with a disposition and a citation, every deferral with an owner, and the M7/M8
handoff.

*Acceptance:* documentation only, and the dispositions are not interchangeable.

**Criteria 1-10 and 12 are core product truths and must each be proved `PASS`.**
`deferred-with-owner`, `refused` and `evidence-blocked` are **not** substitutes
for passing one of them. If any core criterion cannot be proved, the closure
record says **`M6 NOT COMPLETE`** and names which — a milestone whose core
criteria may be deferred is a list of intentions, not exit criteria.

**Criterion 11 must also `PASS`**, and it passes when every one of the four
closed conditional routes has reached a permitted terminal disposition. The
*inner* disposition of each capability may be `ADMITTED`,
`REFUSED_WITH_EVIDENCE` or `EVIDENCE_BLOCKED`, and none of them has to be
admitted — but criterion 11 itself is never "refused" or "evidence-blocked". It
is `PASS` once the closed set is completely dispositioned, and not before.

**A non-blocking residual may still be recorded** outside the exit criteria with
its owner, under repository policy. What it may not do is stand in for a core
criterion.

Nothing unimplemented is described as implemented, and nothing delivered is
described as missing. The local gate set passes unchanged.

*Non-goals:* implements nothing, and does not start M7.

## Product decisions this route surfaces rather than guesses

Nine decisions, numbered `CNV-D1` to `CNV-D9` on the pattern
[ADR 0037](0037-viewer-completion-route.md) used for XIC, and anchored to the
`CNV-*` feature identities `FEATURE_CATALOG.md` already carries so a reader
checks one vocabulary rather than two.

Each carries a status:

```text
LOCKED                          decided here, and a later slice implements it
EVIDENCE_REQUIRED               undecidable until a named measurement is taken
PROVISIONAL_PENDING_MEASUREMENT a working answer, revisable by one named measurement
ARCHITECTURE_DECISION_REQUIRED  two accepted documents disagree and a person must choose
REFUSED                         decided against, with the reason
DEFERRED_WITH_OWNER             not M6's, and the owner is named
```

### CNV-D1 — output formats

**Status: mzML `LOCKED`. mzXML `EVIDENCE_REQUIRED`, owner M6.2, terminal in M6.10.**

mzML is the product's format and stays the default. `ConversionOutputFormatDto`
is deliberately a one-member union so that adding a second is a change to a
vocabulary everything reads rather than a new string in an unvalidated field.

mzXML is an **evidence branch with three terminal outcomes** —
`MZXML_ADMITTED`, `MZXML_REFUSED`, `EVIDENCE_BLOCKED` — and **M6 completion does
not depend on which one it reaches.**

What the repository already holds against it, and it is substantial. The M0 spike
measured `msconvert --mzXML` on a synthetic four-spectrum fixture: exit `0`,
well-formed output, every array compressed, and **three of four spectra**. That
was traced to `Serializer_mzXML.cpp`, where a spectrum whose source file differs
from the run default is skipped. A reading of current pwiz sources for this route
found the writer drops spectra in **two** places, both with a bare `continue` and
no warning, no counter and no diagnostic: a Thermo spectrum not from
`controllerType=0 controllerNumber=1`, and a spectrum from a non-default source
file. Chromatogram loss is inherent to the format.

Two things follow, and they are different.

**The architectural consequence is already decided.** Whatever M6.2 measures, an
mzXML admission would require the source/output spectrum-count comparison
CNV-002 states, because a format that can drop spectra at exit `0` is the exact
case the five-judgement lifecycle exists for. `ValidationMode::OutputOnly` cannot
carry that; only a source comparison can.

**The admission is not decided, and must not be assumed either way.** The
measurement above is of pwiz `master` sources and of build `3.0.26204` in CI.
Neither is the installed `3.0.26013`, and **evidence does not transfer between
executables**. M6.2 measures the installed build or M6.10 closes the branch
`EVIDENCE_BLOCKED`.

Also recorded, from the same source reading and awaiting measurement: format
availability is a **build** property (`mz5` and `mzMLb` are conditionally
compiled), and msconvert's own multiple-format-flag check omits two of its
formats — so MSCanvas must emit exactly one format flag from a single typed
enum and must not rely on the provider to reject a contradiction.

### CNV-D2 — processing intent

**Status: "no additional centroiding" `LOCKED`. Everything else
`EVIDENCE_REQUIRED`, owner M6.2. One new rule `LOCKED` below.**

The candidate product semantics are CNV-004 to CNV-007: no additional
centroiding; MS2 centroiding; MS1+MS2 centroiding; All / MS1 / MS2 population;
and compression. **These are scientific intents, not CLI checkboxes**, and the
route says so because the mapping from one to the other is where this can go
quietly wrong.

**Locked without measurement:** MSCanvas inserts no peak-picking filter unless
the user asked for one, and no default, preset or convenience may do so. This is
already true — the **msconvert** argv builder emits no `--filter` at all, and a
unit test pins that no argument contains `peakPicking`. (The only `--filter` this
crate can emit is the msaccess MS-level selector, on a preview path no production
caller issues, and it is not a peak-picking filter.)

**Locked, and new: MSCanvas cannot delegate its fail-closed guarantee to the
provider.** A reading of current pwiz sources for this route found that
`--filter "peakPicking vendor"` is not a request the provider will refuse if it
cannot honour it. Vendor centroiding is selected by a `dynamic_cast` on the
*immediately inner* spectrum list, so any preceding filter defeats it; where the
cast misses, the code falls through to a local-maximum detector; an unrecognized
picker token falls through the same way with no error; and the parameters
`snr`, `peakSpace` and `centroid` are consumed only by the CWT branch and
silently discarded otherwise. A `NoVendorPeakPickingException` exists in the
library and **no msconvert command line can reach it** — there is no
"vendor centroiding or refuse" mode. The result is that a request can be
satisfied by a different algorithm at exit `0` with a clean stderr.

So if M6 admits centroiding at all, it admits it with **three structural
obligations**, and these are locked now because they shape M6.3's types:

1. **The intent is an ordered sequence, never a set.** The provider's filter
   chain is a decorator stack in command-line order, and order changes the
   science. A flags struct or a map would let a display decision alter a
   scientific one.
2. **Parameters are reachable only under the variant that consumes them** — an
   enum with per-variant fields rather than a flat struct of options, so a
   control that provably cannot affect the result is unrepresentable rather than
   merely unused.
3. **The claim is verified from the output, not from the exit code.** The
   produced mzML records which algorithm actually ran, and MSCanvas already has a
   fail-closed mzML scanner that recognises controlled-vocabulary terms by
   accession. An admitted centroiding intent must be checked against what the
   document says was done, and a substitution must refuse rather than adopt.
   **Owner: M6.3**, which types the intent, extends the integrity comparison to
   carry the check, and owns the acceptance that an intent whose output records a
   different algorithm fails the integrity contract rather than finalizing. Read
   with the OpenMS caveat below: a processing record is a claim to check, its
   absence is *unverified* rather than "nothing happened", and neither may be
   read as proof.

**Compression and precision are two settings, not one.** The same source reading
found `--zlib` is lossless and applied last, while numeric precision is a
separate and prior decision — and that msconvert's own defaults keep m/z at 64
bits while writing intensities at 32. MSCanvas's plan is unconditional zlib and
no precision statement at all, so **the precision question is currently answered
by the provider's default rather than by MSCanvas**. Whether that default is what
MSCanvas means to ship is a real question this route surfaces and M6.2 must
measure before M6.4 offers a "compression" control that quietly implies more.

**Nothing above is an admission.** Every fact in this section is read from
provider sources, not measured from the installed build, and this route treats
source reading exactly as it treats help text: it tells M6.2 what to measure and
it admits nothing.

### CNV-D3 — destination semantics

**Status: the safety contract `LOCKED`. The policy vocabulary `LOCKED`. The
vendor-dataset-root rule `LOCKED` and recorded as currently unexercisable.**

CNV-003's three choices — source sibling, named subfolder, custom local folder
— are the vocabulary, and M6.5 resolves each to the thing the boundary already
requires: **an admitted directory object**, not a path string. **The policy is
one decision; how many objects it resolves to is a property of the policy.** A
source-relative choice resolves per item, and a queue may hold items from
different parents because nothing requires it not to; a custom folder may resolve
every item to the same admitted identity. **This amends [ADR 0013](0013-serial-conversion-queue.md)'s *One destination and
one policy for the whole queue* and [ADR 0020](0020-first-visible-shimadzu-lcd-workflow.md)'s
restatement of it for the mixed-family queue** — the count changes and nothing
else does, and M6.5 annotates both when it lands. The policy is bound to the plan, each
resolved identity is bound to the item or items it applies to, and a retry
revalidates each of them rather than re-resolving the policy. The existing
admission stays exactly as it is and is not weakened by adding a policy in front
of it: reparse points, non-directories and remote volumes are refused before any
plan exists; the directory is held open **for the whole of admission**; and its
identity — a volume serial plus a 128-bit file ID read from that handle — is what
is retained for the queue's life and re-proved on every later pass, with a retry
re-admitting and refusing with `queue_destination_changed` unless it reaches the
same object. **The handle itself is not retained**; see the third recorded item
below.

**Writing inside a recognised vendor dataset root fails closed.** The mechanism
partly exists — `ProcessError::OutputDirectoryInsideDirectoryInput` and
`BackendExecutionFailure::OutputInsideSource` — and is unreachable for
conversion today for one honest reason: **no admitted acquisition family is
directory-shaped.** Thermo RAW and Shimadzu LCD are single files; a SCIEX
acquisition is a `.wiff` bound to its `.wiff.scan` sibling. The rule is therefore
locked as a rule and recorded as unexercisable until a directory-shaped family is
admitted — which is a truthful statement, and better than either pretending the
rule is enforced or deleting it because nothing currently trips it.

`FEATURE_CATALOG.md` currently gives a different and now-false reason for the
same unexercisability — "because no vendor acquisition is recognized" — written
before ADR 0010 admitted Thermo RAW and carried unchanged through three vendor
admissions since. **M6.0 corrects that clause**: the conclusion was right and the
reason had gone stale. It corrects one further stale count found beside it — the
same section's "named limits" sentence said *two* named vendor families where
three are admitted and evidenced — and nothing else in that file.

**Source/destination aliasing is an M6.5 obligation, not a current property, and
the difference matters.** The *destination root* is admitted by object identity,
as above. But the check that a destination is not inside its source is a
**canonical-path prefix test** — `canonical_output.starts_with(source_identity.canonical_path())`
in the planner, repeated pre-spawn as `reject_output_inside_source` — and it runs
only where `source_identity.is_directory()`, which no admitted conversion family
is. So today the containment rule is a path-string comparison that never fires,
and the earlier statement that MSCanvas decides aliasing by identity would have
been a claim about a mechanism this boundary does not have.

**M6.5 owes an aliasing decision made on object identity** rather than on a
prefix of a canonicalized string. A prefix test over canonical paths is a
reasonable containment heuristic and it is not an identity comparison; on Windows
the two differ exactly where it matters, over links, substituted drives and
volume mount points, which is why the destination admission already refuses
reparse points rather than reasoning about their targets.

**And it owes the separation that the prefix test conceals.** “Inside the
source” and “beside the source” are different facts, and only the first is a
refusal:

1. **the destination object is the source object** — refused, on an identity
   comparison; currently unexercisable, because a destination is a directory
   object and every admitted source is a regular file;
2. **the destination is a directory-shaped acquisition's root, or lies under it**
   — fails closed, on an ancestry walk compared by identity at each step. This
   is the vendor-dataset-root rule, unweakened, and it is asked *before* the
   next one;
3. **the destination is the sibling container of the logical acquisition**,
   reached only where neither of the above matched — **admitted**, because that
   is what CNV-003's `source sibling` resolves to. Defined on the *logical
   acquisition* rather than on filesystem shape: a regular file's parent, a
   bundle's container, and — when one is admitted — the parent of a
   directory-shaped acquisition rather than its interior.

The last case is why a universal “destination contains the source” refusal
cannot be the rule: it would refuse one of the three policies this decision
locks, for all three admitted families, on the strength of a path relationship
that is a property of the policy rather than a hazard. **The hazard is the
acquisition's shape**, and M6.5 keys on that.

**Three things recorded and not closed**, because M6.5 will touch the code they
live in and a reader should meet them there rather than rediscover them:

- the **staging-ownership marker is forgeable** by anything that can write into
  the destination root. Making it unforgeable is an authenticated-ownership
  decision rather than a conversion-surface one, so it is
  **`DEFERRED_WITH_OWNER`: M8**, alongside the artifact-identity work that would
  give it something to authenticate against;
- **`reclaim_staging_area` is reachable only from tests.** No Tauri command,
  service method or recovery path calls it, so a staging name wedged by a failed
  cleanup has no application-reachable remedy. Offering one is an error-recovery
  surface, so it is **`DEFERRED_WITH_OWNER`: M7**, with the diagnostics and
  recovery work that milestone already owns;
- **the queue's destination hold is dropped between admission and the slot
  transition.** In `run_claimed_conversion` the hold is bound inside a match arm
  and released before `start_running`; on the retry path it is held for the whole
  call. The identity comparison still fails closed either way, which is why this
  is a recorded asymmetry rather than a defect.

One precision about the revalidation above, since M6.5 must not overstate it: the
per-item plan-time and pre-spawn destination checks belong to the **single-output**
lifecycle. A backend-named set never builds a `ConversionPlan` and is routed to
the multi-output path instead, so its destination guarantees come from queue
admission, per-item re-admission and the identity comparison rather than from
those two.

### CNV-D4 — conflict and overwrite

**Status:**

```text
Fail                LOCKED
Skip                LOCKED
Automatic rename    REFUSED, here
Explicit overwrite  ARCHITECTURE_DECISION_REQUIRED, owner M6.6
```

**An explicit overwrite does not have to be admitted for M6 to complete.** M6.6
terminates the question as `OVERWRITE_ADMITTED` or `OVERWRITE_REFUSED`; on a
refusal `Fail`/`Skip` stand and the architectural reason is recorded.

`ConversionConflictPolicyDto` has two members and the type says why: "overwrite
is not one of them. ADR 0009 refuses to replace a file this boundary did not
create, and a policy that could would make the no-clobber guarantee a
preference."

**`FEATURE_CATALOG.md`'s CNV-008 says the opposite** — "Default is fail/skip;
overwrite requires explicit confirmation" — as does `PROJECT_PROPOSAL.md` §7.7,
which lists "fail/skip/automatic rename" plus a confirmed overwrite. This is
not a gap; it is **two accepted documents disagreeing**, and M6.0 records it as
such rather than resolving it by picking the one it prefers. The decision M6.6
must take is explicit: either amend ADR 0009's no-clobber guarantee with a
stated scope, or refuse CNV-008's overwrite half and say so in the catalogue.
This route takes neither, because taking it silently is exactly how a guarantee
becomes a preference.

**And the authority for it is MSCanvas, not the provider — which an earlier draft
of this decision got wrong.** That draft held the question open until someone
measured what `msconvert` does to a file already at its output path. **That
measurement cannot answer it**, because the provider never meets that file.
[ADR 0009](0009-mzml-conversion-execution-boundary.md) is explicit: "The backend
never writes into the destination root"; each run gets a private staging
directory; finalization is a **no-clobber move of the validated output onto its
final name**; and where the final target already exists, `Fail` reports it,
`Skip` reports work that was not needed, and **the backend never runs**.

```text
provider
  -> MSCanvas-created private staging directory
  -> output validation
  -> MSCanvas-owned finalization
  -> user destination
```

So the destructive question belongs to the **Rust finalization and publication
boundary**. It asks how an already-validated object replaces an existing
destination object without a failure losing the old one — a question about
MSCanvas's own rename, not about a process that is pointed somewhere else
entirely.

**The historical measurement is reclassified rather than deleted.** What
`msconvert` does to an existing output remains an unobserved fact about the
provider, still recorded in `## Intentionally pending` and in ADR 0009's open-gate
list. It is **non-authoritative for CNV-D4 and off the critical path**: no M6
slice waits on it, and M6.6 must not treat it as a prerequisite. If some later
question needs it — a mode in which the provider is pointed at a user path, which
this boundary does not have — it can be measured then.

**What M6.6 does need first is the finalization contract**, and the admission
gate for it is in M6.5's downstream slice rather than in a provider run. Its
questions are enumerated in [M6.6](#m66--destination-and-conflict-ux-including-the-destructive-question),
and if they cannot be answered the terminal disposition is `OVERWRITE_REFUSED`.

**Automatic rename is the third policy the proposal names, and it is refused
here** rather than left unstatused, because unlike overwrite it needs no
measurement to decide. A conversion's output name is a **bound plan fact**,
derived from the source before the queue exists and shown to the user before they
commit; a policy that invents a different name at write time would make the name
on screen a guess, and would break the queue-wide name-collision check — which
M6.5 makes destination-aware, and which still refuses two items that would write
one name into one destination object. Refusing a taken name and skipping it are
both answers the user can see coming. Silently writing `run (2).mzML` is not.
If a later milestone wants it, it is a new decision against this reasoning, not
an omission to be filled in.

Whatever is decided about overwrite, the route locks four properties of any
destructive option:

1. **Explicit and never default.** A destructive authorization is an act, not a
   setting that happens to be on.
2. **Scoped and bound.** It authorizes a named set of outputs in one bound plan,
   not a session and not a folder.
3. **Not inherited by retry.** A retry revalidates or refuses. Retry already
   revalidates the destination by object identity; a destructive authorization is
   at least as strong a claim and gets at least the same treatment.
4. **Answered for sets, not only for files.** A multi-output collision and a
   partially existing output set are different questions from "this one name is
   taken", and a rule written for one file cannot answer them. `msconvert` names
   a set's members itself, so for a backend-named set the collision is not even
   knowable before the run.

### CNV-D5 — convert selected, convert all

**Status: `LOCKED`.**

Four sets exist and they are not the same set:

```text
eligible      rows whose family this build has conversion evidence for
selected      rows the user has curated
visible       rows a search or sort is currently showing
all           every row in the workspace
```

**The scope is a query; the queue holds a resolved set.** The two are separate
concepts and the resolution happens exactly once, at `BEGIN`, into the bound
plan. After that, sorting, searching, selecting and adding change what the user
is looking at and change nothing about the queue — which is already true of
membership and is the property M6.7 must not lose while adding a scope control.

The locked semantics:

- **Ordering is the resolved list's order, and it is visible before the action.**
  Today that is the roster's visible order at the moment of dispatch, which is a
  defensible rule and an *unstated* one; M6.7 states it.
- **Rows added after `BEGIN` are not in the plan**, and the plan says so rather
  than the user inferring it from a count.
- **Non-convertible rows are excluded and counted**, as they already are, rather
  than silently dropped — a user who selected twelve rows and got a queue of
  nine is owed the difference.
- **A scope may not exceed the capacity, and the refusal comes before the
  commit**, with the limit stated. Learning the bound from a failed plan read is
  the current behaviour and is not acceptable for a scope control.
- **`Convert all` and `Convert visible` are two names or one is absent.** They
  must never be one control whose meaning depends on whether a filter box happens
  to have text in it. Where only one is offered, its name says which it is.
- **A gesture over a bounded rendering is not yet a scientific operand.** The
  handle list a click dispatches is re-resolved against the authoritative roster
  before it becomes a queue — which the service already does, planning items
  twice and binding the second plan.

### CNV-D6 — queue capacity

**Status: `PROVISIONAL_PENDING_MEASUREMENT`. Bounded-ness is `LOCKED`. M6.7
surfaces the bound; M6.8 re-decides it.**

The current value is `MAX_CONVERSION_QUEUE_ITEMS = 16`, enforced twice and
carried to the interface as `ConversionQueuePlanDto.capacity`, **which no surface
reads today** (G14), so that when M6.7 surfaces it the interface states the limit
Rust enforces rather than one of its own.

**The rationale is a wait-time judgement, not a machine fact, and the code says
so**: "at a realistic minute or three per acquisition, sixteen is something like
half an hour... a judgement about how long a person should be asked to wait and
not a fact about the machine." ADR 0013 gives the same reason.

**It is not a memory limit, and this route does not claim it is.** Nothing in the
repository measures memory, throughput or scaling against the number of queue
items, and the workspace itself holds up to 1,024 rows.

**The stated premise has gone stale.** The doc comment justifies 16 on the queue
having "no cancellation"; a queue-level stop has existed since ADR 0015. That
does not make 16 wrong — a stop the user can press changes how long a wrong
decision costs, which is the variable the number was chosen against — but it
means the number is currently defended by a sentence that is no longer true.

So: **the capacity stays bounded**, whatever value M6 lands on. Re-evaluating it
is **M6.8's, after cancellation is understood**, because how large a queue may
reasonably be is a function of what a user can interrupt. A capacity change with
no stated basis is refused.

**M6.7 and M6.8 do not depend on each other circularly**, and the distinction is
worth stating because it looks as though they might. M6.7 surfaces **the capacity
the queue enforces**, reading `ConversionQueuePlanDto.capacity` — a field that
already crosses the wire and that no surface reads today, which is G14 — before a
scope is committed rather than after a failed plan read. It does not decide the
number, does not encode one, and does not need to know it; a later change by M6.8
flows through the same field without reopening M6.7.

The one-way dependency is about **membership, not size**. Per-item cancel and
queued-item skip are operations on a bound plan's membership, so what membership
means has to be settled before what may be done to it can be. That is M6.7's, and
it is why M6.7 comes first.

### CNV-D7 — cancellation

**Status: the state vocabulary `LOCKED`, and it now includes which states a
launched stop may reach. A successful cancellation of a launched conversion is
`ARCHITECTURE_DECISION_REQUIRED` **and** `EVIDENCE_REQUIRED` — it requires a
closed ownership window *and* a measurement *and* an exhaustive claim
reconciliation, and no one of them settles it — owner M6.8, terminal on
`OWNERSHIP_STRUCTURALLY_CLOSED` or `OWNERSHIP_UNCONFIRMED`. Under
`OWNERSHIP_UNCONFIRMED` that outcome is `REFUSED` by this decision rather than
deferred: the stop settles `CancellationFailed` / `StopFailed` and quarantines.
Per-item cancel `PROVISIONAL_PENDING_MEASUREMENT` **and** conditional on the
ownership outcome, owner M6.8. Queued-item *skip*
`PROVISIONAL_PENDING_MEASUREMENT`, owner M6.8. Queued-item *removal* `REFUSED`,
here.**

**Four different promises, and M6 must not blur them** — least of all the last
two, which read as one request and are not:

```text
Stop queue              exists. Ends the whole queue: the running attempt is asked
                        to end, no later item begins, finished outputs are retained
Cancel current item     does not exist. Would end one attempt and continue the queue
Skip a queued item      does not exist. Would settle one item terminally without
                        running it -- the plan still holds it, and says what
                        became of it, exactly as NotRun already does
Remove a queued item    REFUSED. Would take an item OUT of a bound plan, which is
                        the one thing the bound-plan contract forbids
```

**Removal is refused on the contract, not on a pending measurement.** §1 states
that a plan fact which can change after `BEGIN` is a defect rather than a
feature, and membership is the first fact it freezes. A user who wants a queued
item not to run is asking for an *outcome* for that item, and `skip` gives them
one the plan can still account for: the queue continues to say what it was asked
to do and what happened to each thing it was asked about. Removal deletes the
question along with the answer, and it is also the request most likely to be
asked for, which is why it is refused explicitly here rather than left to be
absorbed later as an obvious convenience.

The corollary for M6.8: `skip` is admissible and needs a truthful terminal state
rather than a new membership operation, and the existing `NotRun` — "no process
was launched and nothing was created" — is very close to the state it needs.

The state vocabulary that must stay distinct, and mostly already is:

```text
cancellation requested    CancellationToken / ConversionSlot::stop_requested
stopping                  SlotState::Stopping -- its own state, because what a
                          reader may do differs from Running
owned job terminated      Termination::Cancelled AND final_active_processes == Some(0)
                          -- an observation about the JOB, which equals the tree
                          only under OWNERSHIP_STRUCTURALLY_CLOSED
staging reconciled        staging residue observed absent, rather than assumed
                          -- a staging fact, not a finalization one
terminal cancelled        ItemState::Cancelled -- for a LAUNCHED conversion only
                          under OWNERSHIP_STRUCTURALLY_CLOSED, and always where
                          nothing was launched
termination unconfirmed   CancellationFailed + StopFailed + quarantine -- where a
                          launched stop rests on an open ownership window
```

**A single `kill()` is not evidence, and neither is what exists today.** The
implementation is stronger than a `kill()`: a Windows Job Object with
`KILL_ON_JOB_CLOSE`, `TerminateJobObject`, and an emptiness check through
`QueryInformationJobObject`. What has **not** been established is that a real
`msconvert` run is a *tree at all*. `surviving_processes == Some(0)` after
termination is satisfied trivially by a one-process run; the peak count
(`max_active_processes`) is measured by the crate and printed by the M0 spike
harness, but recorded in no evidence document, absent from `BackendRunFacts`, and
not reported by the cancellation harness at all; and the only multi-process
evidence in the repository is against a synthetic mock parent and grandchild.

**And the emptiness observation is scoped to the owned Job**, which is the whole
extent of the claim. A process created between `spawn()` and
`AssignProcessToJobObject` is outside that Job -- so it is outside the
termination path *and* outside the observation that reports the tree gone. An
unconfirmed-termination path exists for a Job that will not empty; there is none
for a descendant the Job never contained. [ADR 0014](0014-proteowizard-cancellation-evidence.md) states this
plainly, and this route restates it rather than letting a strong mechanism be
mistaken for a strong measurement.

**M6.8 therefore owes three different kinds of thing, and none substitutes for
another.**

**A measurement**, of the provider: publish the peak process count and observe it
on a real vendor conversion of the installed build.

**An exhaustive reconciliation**, of the claims. Every name, wire field, surface
text, diagnostic key, count description and document whose meaning asserts a
*confirmed process tree* must agree with the outcome below, and a repository
guard must make that exhaustive over the semantic rather than over a list
someone maintained by hand.

**And a structural answer**, about ownership. The child is spawned before it is
assigned to the Job, and an assignment failure degrades to a direct-child kill
without being reclassified as unconfirmed — two paths on which a process can
exist that the Job never held. M6.8 ends on one of exactly two outcomes:
**`OWNERSHIP_STRUCTURALLY_CLOSED`**, where execution cannot produce an
uncaptured descendant before ownership exists and an empty Job is therefore an
empty tree; or **`OWNERSHIP_UNCONFIRMED`**, where the window stays open and **a
stop of a launched conversion does not settle as a successful `Cancelled` at
all** — it settles `CancellationFailed`, the queue settles `StopFailed`, and the
session is quarantined, because [ADR 0014](0014-proteowizard-cancellation-evidence.md)
already decided that a run which cannot establish the tree is gone gets
`CancellationFailed`. `NotStarted` is untouched: nothing launched means no
escaped process to account for. The route prescribes neither implementation — the repository's own
comment records that stable `std::process` exposes no suspended-create-and-resume
or job-list attribute, so structural closure is not free —
but it refuses the third answer in which a measurement is treated as having
closed a structural hole. **A sample cannot observe a process nothing was
counting.**

**`CancellationFailed` keeps quarantining the session**, and that stays. It is
the one state where MSCanvas cannot say whether a converter process of its own
survives, and a session that cannot say so must not start another.

Whether per-item cancel is admitted at all depends on what the above establishes:
a per-item cancel that cannot prove it ended one item's work is worse than no
per-item cancel, because it invites a user to keep a queue running beside a
process nobody can account for.

### CNV-D8 — progress

**Status: `LOCKED`.**

What M6 may show:

```text
item N of M                     current_index and item_count
per-state counts                finalized, skipped, failed, retryable-failed,
                                non-retryable-failed, cancelled, not-run,
                                cancellation-failed
the current item's state        one of the eight ItemState members
```

**No percentage, no fraction of an item, no estimate and no remaining-time.** The
DTO already refuses it — "nothing measures a fraction of one" — and the panel
says the same where a diagnostics export could have invented one. Anything finer
is admitted only on a measurement showing that `msconvert` emits something a
caller can honestly count, and that measurement has not been taken.

**A phase MSCanvas cannot measure is named, not numbered** — and a named phase
may name only a transition **MSCanvas itself performed or observed**: staging
created, process launched, process exited, output inspected, final name taken.
While a conversion process runs there is no honest fraction, and the truthful
thing to show is which of MSCanvas's own steps it is between. Nothing about the
backend's internal progress may be named, because nothing observes it.

**A count is not a claim about validity.** `finalized_count` counts items that
produced an output, and M6.9 owes the reader the difference between that and
"checked".

### CNV-D9 — output publication and adoption

**Status: the five judgements `LOCKED`. The M8 seam `DEFERRED_WITH_OWNER` (M8).**

Five separate judgements, none derivable from another:

```text
1 process outcome      exit status and termination cause, which can disagree
2 staged output        what the staging area held, and what teardown could not
                       reclaim -- answered even where nothing was published
3 finalized output     the handle-bound rename, taken only after validation, and
                       for a set which members took their names
4 integrity            ValidationMode and the IntegrityProperty sets, including
                       what could not apply as against what was not verified
5 adoption             the final name still resolving to the exact finalized
                       object holding the validated length and digest
```

**Artifact facts sit beside these five, not among them.** Byte length, SHA-256,
observed spectrum and chromatogram counts and output-set membership are what M8
will need and what a reader wants to see; they are not a stage the item passed
through, and an earlier draft of this decision listed them where the staged-output
judgement belongs.

Adoption stays **explicit** — a user action, per terminal queue — and stays
partial-tolerant, with duplicates and refusals isolated.

**What M6.9 adds is mostly visibility — with one exception.** Four of the five
are separated in the crate's vocabulary and collapsed only on screen: an item
reads "Converted" whether or not anything was compared, and M6.9 projects them
per item. The exception is **judgement 2**, which is not fully separated in the
vocabulary either — the staged-content observation is taken on stop paths and not
on ordinary failures — so making a failed item's staged content legible is a
model addition rather than a projection.

**And what M6 leaves for M8 is a seam, not a system.** No persistence, no run
history, no artifact store, no lineage graph and no cross-session identity are
built in M6. What M6 must leave *available* is [below](#m8-readiness).

## External reference audit

Eight projects, each consulted to answer **one** MSCanvas question rather than to
be summarised. Every finding below was read in a primary source — project source
code, an official schema, or official documentation — and the citation is the
file it was read in.

**Two rules govern how this section is used.** First, **reading a provider's
source is not measuring the installed build.** Everything found in ProteoWizard's
sources tells M6.2 what to measure and admits nothing; it is treated exactly as
help text is. Second, a lesson is recorded only where it answers a question this
route actually had. Patterns that do not transfer are recorded too, because
knowing which shape *not* to import is the more useful half.

### ProteoWizard — what M6.2 must measure, and why

The most consequential findings, all from pwiz sources:

- **The filter chain is a decorator stack in command-line order.**
  `SpectrumListFactory::wrap` re-assigns `run.spectrumListPtr` per filter, and
  `msconvert` accumulates `--filter` in argv order with no reordering. *Order is
  the science*, so a typed intent must be an **ordered sequence** and the argv
  builder must be the single place ordering is decided.
- **Vendor centroiding can be silently skipped.** It is selected by a
  `dynamic_cast` on the *immediately inner* list, so any preceding filter defeats
  it; on a miss the code falls through to a local-maximum detector. An
  unrecognised picker token falls through identically with no error, and `snr` /
  `peakSpace` / `centroid` are consumed only by the CWT branch and discarded
  otherwise.
- **There is no "vendor centroiding or refuse" command line.** The library has a
  `NoVendorPeakPickingException`, and no `msconvert` invocation can reach it.
  **MSCanvas cannot delegate its fail-closed guarantee to the provider.**
- **The output records which algorithm ran**, and the invocation. The peak picker
  appends a processing method naming the actual path, and `msconvert` stamps the
  rebuilt command line into the document. This is the verification channel M6.2
  and M6.3 need — and MSCanvas already has a fail-closed mzML scanner that reads
  controlled-vocabulary terms by accession.
- **mzXML drops spectra in two places**, each a bare `continue` with no warning
  and no counter: a Thermo spectrum not from `controllerType=0 controllerNumber=1`,
  and a spectrum from a non-default source file. This corroborates and widens the
  M0 measurement.
- **Compression and precision are orthogonal.** `--zlib` is lossless and applied
  last; numeric precision is separate and prior, and `msconvert`'s own defaults
  keep m/z at 64 bits while writing intensities at 32.
- **Format availability is a build property** — `mz5` and `mzMLb` are
  conditionally compiled — and the multiple-format-flag check omits two formats,
  so a contradictory pair is not always rejected.

**Not applicable:** the continue-after-a-failed-filter loop (MSCanvas validates
the whole chain up front and refuses), and the legacy `peakPicking true|false`
grammar (it means "prefer vendor" with a hidden fallback).

### OpenMS and TOPPView — the machine-readable declaration, and its ceiling

- **TOPPView does not call TOPP algorithms in-process** even though it links the
  same library: it spawns the exact executable with `-write_ini` and parses the
  produced description. This is the reference implementation of evidence-gated
  provider capability, by a project that could have taken the shortcut.
- **A declared parameter domain is a syntactic claim, not a behavioural
  guarantee.** `FileConverter` declares 21 input and 16 output formats and states
  in the same declaration that "not all conversion paths work or make sense".
  So even a *machine-readable* capability document is not evidence — which
  generalises MSCanvas's help-text rule rather than softening it.
- **The declared surface is build-conditional** (`WITH_OPENTIMS`,
  `WITH_THERMO_RAW`), so two binaries reporting the same name and version can
  declare different capabilities. **Independent external corroboration that
  capability must key on exact executable identity.**
- **A capability document self-identifies** — no path, no hash, no build flags —
  so the measurement context must be recorded beside it.
- **mzML provenance can be fabricated.** OpenMS writes a placeholder processing
  method when it has none, labelled in-band as a "fictional processing method used
  to fulfil format requirement", and hardcodes `order="0"` on every entry. **The
  presence of a `dataProcessing` entry is not evidence that processing
  occurred**, and a sequence cannot be reconstructed from `order`. This directly
  qualifies the pwiz finding above: M6 may read the processing record as a claim
  to be checked, never as proof, and its absence is *unverified* rather than
  *nothing happened*.
- **Four-state external-process outcome** (`SUCCESS`, `NONZERO_EXIT`, `CRASH`,
  `FAILED_TO_START`) with a Windows crash heuristic — exit codes above
  `0x80000000` are structured exceptions rather than meaningful statuses.
- **Adoption is a separate gated step**: crash, then non-zero exit, then success,
  then *readability of the output* before anything is taken into the workspace.

**Not applicable:** an unknown parameter warning rather than a refusal; range
checks skipped for values left at their default; validation co-located with the
read, so a parameter nothing reads is never validated.

### VS Code — one authority, many readers, and the race it does not solve

- **The command is identity plus handler and carries no availability.**
  Availability lives elsewhere, as a `precondition` expression, and *menu
  visibility* is a third and separate field. MSCanvas needs the same separation
  plus a fourth role VS Code lacks: **a refusal reason.**
- **One authored predicate, mechanically fanned out.** `registerAction2` takes one
  `precondition` and derives the menu's grey-out, the palette's filter and the
  keybinding's condition from it. No renderer re-types the condition. **This is
  the pattern M6.1 copies.**
- **The authority store is synchronous**, and multi-key transitions are made
  **atomic** by a pauseable, merging emitter — so no reader observes a torn state
  where the lane is claimed but the control still says available. M6.1 needs the
  same atomicity for its own transition.
- **THE ANSWER TO THE RACE, and it is a warning.** VS Code makes *no* guarantee,
  and ships the non-guarantee in its own schema: enablement "does not prevent
  executing the command by other means". The execution path performs zero
  precondition evaluation, and the click guard reads a **constructor-time
  snapshot** rather than live authority. VS Code therefore never shows MSCanvas's
  contradiction — it accepts the click and executes into a now-invalid state,
  which for a conversion is worse.
- **Availability is rebuilt wholesale, never patched**, which removes a class of
  drift; and the paint is deliberately debounced ~50 ms with an explicit
  synchronous-flush escape hatch.

**The MSCanvas rule that follows:** debounce the *paint* if it helps, never the
value the operation checks; and re-read the authority at dispatch and **refuse
explicitly**, because a silent no-op is acceptable for a toolbar button and not
for something that claims a backend lane and spawns a process.

### MZmine — the plan snapshot, and the cancellation not to copy

- **The bound-plan precedent, and its placement.** `setupAndRunModule` clones the
  parameter set at **one choke point** every module invocation passes through, so
  no task can forget to. MSCanvas should bind at one choke point for the same
  reason — and every conversion entry path must funnel through it.
- **Scope query and resolved set are different types.** `RawDataFilesSelection`
  holds a selection *kind* plus a memoized evaluated set, resolved once and
  frozen; a resolution performed to *validate* is explicitly discarded so it
  cannot be mistaken for the binding that *authorizes* work. **This is the model
  for CNV-D5.**
- **Provenance is recorded before success is announced**, and is skipped entirely
  where the task was cancelled.
- **Progress is real work-unit accounting**, and MZmine refuses to synthesise a
  percentage for the external `msconvert` phase it cannot measure — reporting the
  phase in the description instead. Same stance as CNV-D8.
- **Its own msconvert integration is the anti-pattern MSCanvas exists to avoid**:
  the exit code is never read; on cancel it calls `destroy()` and leaves a
  half-written mzML on disk; and a later attempt treats *the existence of that
  path* as a usable output.

**Not applicable, and important:** MZmine has **no cancel-requested state** —
`cancel()` writes the terminal `CANCELED` immediately while the worker still
runs — and `isCanceled()` returns true for errors too, fusing "the user withdrew
authority" with "it failed". Both are exactly what CNV-D7 keeps apart.

### QGIS — history, destination and the conflict policy that is not one

- **THE central CNV-D4 finding: QGIS has no framework-level conflict policy.**
  The write path sets create-or-overwrite unconditionally, with no existence
  check and no prompt. The only confirmation is the OS file dialog's, and it is
  suppressible per parameter. Refusal-on-existing exists only ad hoc inside
  individual algorithms and only for some formats. **A guard that lives in a file
  picker is not a policy** — which is the strongest external argument for
  MSCanvas resolving conflict on the typed request, before launch, identically
  for every entry path.
- **The two-phase history write** — insert the intent record *before* launching,
  update the same row with outcome and log on completion — is the single most
  transferable idea here, and it is what leaves evidence when a run never returns.
- **The record omits toolchain identity.** No version, no algorithm version, no
  exit code, no output size or checksum — and QGIS computes exactly that block
  elsewhere and discards it. This is the concrete gap M6.9 should not reproduce.
- **After years, there is still no output-side lineage**: the run record and the
  artifact are permanently disjoint. The cheap move that avoids the trap is to
  record a stable run identity *and* the observed output facts in the same place.
- **The bulk path leaves no record at all** — history was wired into one entry
  point and batch runs bypass it. M6 writes no record, so this is not an M6
  obligation; what it argues for is the *shape* M6.7 already owes, a single
  submit path that focused, selected and all conversions funnel through. When
  **M8** builds a record, it writes it there, and inherits the coverage rather
  than having to establish it.
- **The GDAL provider reports the requested destination back as the produced
  result**, with no existence, size or integrity check — the exact conflation the
  five-judgement lifecycle forbids.
- **Batch is a list of complete independent parameter maps** with a fresh context
  per iteration, and its persisted form carries a **format version** and validates
  every cell on save. Both transfer to M6.7.
- **Cancellation on Windows is absent from the headless path**, and the framework
  rule worth copying is that *a cancelled run is never reported as success even if
  the worker returned normally*.

**Not applicable:** validation that lives in UI/CLI call sites rather than the
execution entry point, and readers that silently substitute a default for an
unparseable value — fail-open in exactly the two places MSCanvas fails closed.

### ParaView — the bounded representation, kept honest

- **Views are sinks.** A view takes input and produces no output that anything
  downstream may consume; display properties transform what is rendered "without
  affecting the raw data itself".
- **THE headline guarantee, and the best single lesson in this audit.** Before any
  screen-space pick, ParaView forcibly re-renders at full resolution, because the
  visible frame may be a reduced one. **A gesture over a bounded rendering is not
  yet a scientific operand.** For M6 that is `Convert selected`, per-item
  cancellation and any overwrite decision: re-resolve the gesture against the
  authoritative set before it authorizes anything.
- **The reduced form is structurally unreturnable** — the "what is rendered"
  accessor returns the full geometry, never the decimated one — and the reduction
  path is unreachable from a non-interactive render. Make the truthful path and
  the reduced path different functions, with the cap absent from the truthful
  one's signature.
- **The export escape hatch is closed**: every screenshot is a full-resolution
  render, so a decimated frame cannot be exported. Anything leaving MSCanvas is
  re-derived from the authoritative result.
- **Where a screen-derived operand is unavoidable, the name says so** —
  "visible cells only" is documented rather than hidden. Hence CNV-D5's rule that
  `Convert all` and `Convert visible` are two names or one is absent.

### Grafana and Superset — the job record, and the ceiling of a cancel claim

Grafana was consulted narrowly and is reported with Superset because its useful
finding is the same one: a display-side transformation must be legible as
display-side.

From Superset, on job/result/cancel/history separation:

- **The record and the result live in different stores**, and the pointer to the
  result is written only after the artifact write is confirmed — a run whose
  output cannot be retrieved is **not** a success even though the engine returned
  rows. That is the fail-closed direction, and it is the shape of "finalized"
  versus "adopted".
- **History outliving its artifact is a first-class typed state**, not an error
  the UI invents. M6.9's seam should let a later reader say "this run completed;
  its output is no longer present, or no longer matches the recorded integrity
  evidence".
- **Record first, then spawn.** The job row is committed before any work is
  dispatched, so a crash leaves an auditable job rather than an invisible orphan.
- **Resubmission is deduplicated on a stable key**, so a double click cannot spawn
  two workers against one destination — which for MSCanvas is worse than a
  duplicate query.
- **The ceiling of a cancel claim.** Superset's `cancel_query` returns true on
  three paths, only one of which touches the engine; one of them means only that
  the intent was written down. Its own comments admit the record can read
  "stopped" while the remote work continues. **MSCanvas is in the stronger
  position** — it spawns the process and holds the handle — and must therefore
  claim exactly what it reaped and nothing more.
- **"The user stopped looking" is not "the work stopped"**, and terminating on
  client disappearance is opt-in per database.
- **The anti-pattern to name.** Superset collapses `TIMED_OUT` into `FAILED`
  because the frontend cannot render the distinction, with the TODO still in the
  code. A screen limitation deciding what the model may record is the precise
  inversion of MSCanvas's invariant, and M6 must never take it.

### napari and Perspective — M7/M8 readiness only

Consulted narrowly, and the useful findings are mostly boundaries:

- **Identity and label are two fields**, and napari needed both — a mutable name
  and an opaque id. An output filename must not double as an artifact identity.
- **Provenance is a separate, typed, frozen object** hanging off the artifact,
  **write-once** — a second attempt to set origin is an error, not a merge — and
  it is stamped at the boundary that *invoked the external reader*, because only
  that code knows the input, the provider and the settings. MSCanvas's conversion
  runner is that boundary.
- **napari's provenance carries no integrity or time facts at all** — a bare path
  string, no hash, no size, no version — and does not survive its own
  serialization. That is the ceiling M6 must exceed, and the concrete failure to
  avoid.
- **Perspective**: the data's shape is frozen at creation and every variation is a
  *view*; a view is immutable with respect to its arguments while live with
  respect to the data; and row identity must be **declared, never inferred**. The
  last is the same shape as "is this output the same artifact as that one", which
  must be answered by a declared rule rather than a filename heuristic.

**Not applicable, and the most seductive wrong lesson in the audit:** napari's
identity is *process-lifetime scoped* and *lazily minted* — allocated only if
someone reads it. Adopting either would satisfy M6's tests and guarantee M8 has
to redesign. M6 mints its conversion identity **before the process starts**, and
gives it a **form M8 could persist unchanged** — opaque, minted eagerly, and
never derived from the output's filename or from the queue that produced it.
**M6 does not persist it**, and does not resolve it across sessions; what
transfers from napari is the shape of the identity, not a store to keep it in.

Also rejected: ambient context-variable provenance stamping, which fails **open**
— anything constructed inside the block inherits the origin whether or not it
came from there.

### Where the audit was blocked

Recorded rather than papered over. GitHub's code-search API required
authentication, so no reference was searched repository-wide; every finding comes
from files fetched by exact path. Perspective's published documentation redirected
cross-host and was substituted with the Rust client's own doc comments. MZmine's
task scheduler is not open source and could not be read, so its scheduling
behaviour is unexamined. Some sources were read at `master`/`develop` rather than
at a pinned release, which is noted because it is exactly the drift this
repository refuses to ignore elsewhere.

## The XIC boundary, and the Post-M6 interlude

M5 ended `XIC_SOURCE_REFUSED` for the measured `msaccess` identity.
**M6 does not re-admit XIC, and does not implement any part of it.**

### The conditional, and what this baseline observed

[ADR 0042](0042-viewer-completion-closure-and-handoff.md) and `ROADMAP.md` assign
VIEW-007's re-entry to M6 with a stated trigger: **a different measured
`msaccess` executable identity.** Where M6 measures one — for a direct-preview
slice, for a widened distribution, or because the installation changed — the
spike's three-part gate runs in full. Where M6 measures none, the item is closed
by that fact and no XIC work is owed — and in criterion 11's vocabulary that
closure is a **refusal carried with evidence**, the evidence being a measured
identity match to the build M5.4 already refused, rather than a fourth kind of
ending.

**At this baseline, no new identity exists.** The installed `msaccess.exe`
hashes to `85681B20…D1F4` — byte-identical to the digest
[the spike](../../spikes/M5_XIC_SOURCE_EVIDENCE.md) recorded, at the same
12,898,816 bytes — and the sibling `msconvert.exe` hashes to `9BB6F5D5…D590BD`,
the digest `EVIDENCED_PROVIDER_BUILDS` already pins.

**That observation closes the condition for M6.0 and for nothing else.** It is a
statement about one moment in one working tree, and the user may install a
different build tomorrow. The trigger stays live for the whole milestone: **the
gate is the condition, not the date**. M6.2 and M6.10 each re-observe the
identity they are actually measuring against, and M6.10 records the disposition
one final time.

It is also worth stating precisely what the digest match does *not* establish.
It says the bytes are the ones M5.4 measured. It does not revive the refusal's
scientific findings as if they were fresh, and it does not make XIC any more
available than M5 left it. The refusal stands on its own measurements.

### The Post-M6 XIC provider and runtime interlude

The preferred route is:

```text
M6 COMPLETE
  -> Post-M6 XIC Provider / Runtime Interlude
  -> M7
```

**The interlude is not an M6 exit criterion**, does not gate M6.11, and is not
scheduled by this ADR. It is recorded so the refusal has a destination rather
than an open end. Provisionally:

```text
PX.0  route lock
PX.1  provider / API audit
PX.2  prototypes
PX.3  evidence matrix
PX.4  provider decision
PX.5  runtime, only if admitted
PX.6  minimal visible XIC, only if admitted
```

with four terminal states for PX.4:

```text
XIC_PROVIDER_ADMITTED
XIC_PROVIDER_REFUSED
EVIDENCE_BLOCKED
ARCHITECTURE_DECISION_REQUIRED
```

The interlude exists because M5.4's refusal was about **one executable's
implementation**, not about the science: an XIC is a legitimate scientific
quantity that this provider could not serve at the precision required. Whether
another provider or a different runtime can is a question worth asking once, in
its own place, rather than repeatedly at the edge of unrelated milestones.

**And a reusable XIC artifact or export stays M9's**, on M8 artifact identity,
exactly as [ADR 0042](0042-viewer-completion-closure-and-handoff.md) routed it.
The interlude could produce a visible trace; it does not produce an artifact
model.

## M7 readiness — the seams M6 freezes

M7 owns the final UI route lock. M6 does **not** design M7's layout, and no
layout below is an M6 acceptance criterion. What M6 owes M7 is *stable things to
read*, so M7 consolidates surfaces rather than re-deriving facts.

The provisional M7 information architecture, carried as a handoff target rather
than a decision:

```text
+-------------------------------------------------------------+
| App bar: context - commands - global task status            |
+---------------+------------------------------+--------------+
| Workspace     | Scientific Canvas            | Inspector    |
| Navigator     |                              |              |
| acquisitions  | chromatogram (XIC only if    | Context      |
|               | the interlude admits one)    |              |
| outputs       | scan table                   | Settings     |
| future runs   | selected spectrum            | Export       |
|               |                              | Evidence     |
+---------------+------------------------------+--------------+
| Activity Drawer: tasks - progress - errors - diagnostics    |
+-------------------------------------------------------------+
```

The seams, each named with the slice that freezes it:

| Seam | What M7 may rely on | Frozen by |
| --- | --- | --- |
| Command availability | One conversion-lane authority with a reason and a message, read identically by the operation and by every surface | M6.1 |
| Conversion operation state | The slot's five states and three terminal reasons, on one sequence key that never rewinds | M6.1 (already true; stated) |
| Bound plan facts | Membership, order, conflict policy, intent, destination policy and installation identity, fixed at `BEGIN` and readable — plus, per pass, any destructive authorization, if CNV-D4 admits one at all | M6.3, M6.4, M6.5, M6.6, M6.7 |
| Destination identity | The bound policy, plus the resolved directory object for each item it applies to — one identity per item under a source-relative policy, possibly one shared identity under a custom folder. Never a path on the wire | M6.5 |
| Conversion intent | A typed value, projected for display, never re-derived from controls | M6.3, M6.4 |
| Per-item outcome | Eight item states plus all five judgements separated per item — process, staged output, finalized output, integrity, adoption — with artifact facts readable beside them | M6.9 |
| Completion summary | Per-state counts that add up to the queue, with no fabricated total | M6.9 |
| Output manifest and integrity | Names, lengths, digests, observed counts, validation mode and the property set — including what could not apply | M6.9 |
| Diagnostics and evidence | The existing redacted export, plus the capability evidence a setting traces to | M6.2, M6.9 |
| Cancel and retry availability | Offered exactly when pressing would do something, with a reason when not — and under `OWNERSHIP_UNCONFIRMED` a stop of a launched conversion is surfaced as unconfirmed-and-quarantined rather than as a success, or declined before launch | M6.1, M6.8 |

M5's interaction principles are inherited unchanged and M6 must not erode them:
availability means activating would do what it says; an unavailable action has
one understandable reason; live regions are mounted before they have anything to
say; keyboard equivalence; the three responsive targets; explicit scroll
ownership.

## M8 readiness

Facts, not a system. **M6 builds no persistence.** No run store, no artifact table, no lineage graph,
no cross-session index, and no schema migration. Creating one would be an M8
decision taken in the wrong milestone.

What M6 must leave **available as reads**, so M8 can build a model without
re-running anything:

| M8 concept | The fact M6 leaves | Where it already is, or which slice adds it |
| --- | --- | --- |
| `SourceIdentity` | The dataset's admitted identity, including companion members for a bundle | exists — `FileIdentity`, `DatasetId`, member digests |
| `ProviderIdentity` | Release, source revision and executable SHA-256, as measured at admission | exists — `InstalledHelpCapabilities`, `InstallationIdentity` |
| `ConversionIntent` | The typed intent that produced the argv, and the argv itself | **M6.3** |
| `OperationRunIdentity` | An identity minted **before the process starts**: opaque, not derived from the output filename or the queue, unique and never reused within the session, and carried on the wire beside the outcome. **Its form is persistable; M6 does not persist it and does not resolve it across sessions** | **M6.9** |
| `DestinationIdentity` | The resolved directory object **for the item that wrote there**, plus the policy that chose it — so an output knows the destination object it actually landed in rather than having it inferred from a queue-shared folder | **M6.5** |
| `StagedOutputEvidence` | What the staging area held, and what teardown could not reclaim — answerable whether or not anything was published, which is what makes a residue-leaving failure legible later | partly exists — `StagedContentObservation` and `StagingResidue` are there and the observation is taken on stop paths only; **M6.9** extends it to ordinary failures and projects it |
| `OutputArtifactManifest` | Per output: name, byte length, SHA-256, observed spectrum and chromatogram counts; for a set, which members landed. **Evidence beside the five judgements, not one of them** | exists per item — **M6.9** makes it a manifest |
| `IntegrityEvidence` | Validation mode plus the property set, keeping *inapplicable* distinct from *unverified* | exists — **M6.9** projects it |
| `AdoptionRelation` | Which output was adopted, and against which identity check | exists — **M6.9** records the relation |
| `Run`, `Artifact`, `Lineage`, `Provenance` | **not built.** M6 supplies the facts these would be assembled from | **M8** |

Four constraints M6 accepts now so M8 is not forced to redesign, each earned from
the reference audit:

1. **Identity is minted before work starts, not on first read**, and is not the
   output's filename.
2. **The facts are produced at the boundary that invoked the provider**, because
   only the conversion runner knows the input, the exact provider identity and
   the settings actually used. A later reader cannot reconstruct them.
3. **Origin facts are write-once.** Once stamped, nothing downstream overwrites
   them.
4. **The identity's form is persistable, and M6 does not persist it.** It is
   opaque, stable for the run it names, and not derived from a filename or from
   the queue — so M8 can store it unchanged. M6 neither writes it to disk nor
   resolves it across sessions, and lineage is an identity-to-identity relation
   rather than a live handle **when M8 builds one**.

And one caveat carried from the audit, because it changes what M6 may *claim*
from a converted file: a `dataProcessing` record inside an mzML document is a
**claim to be checked**, not proof that processing occurred — other writers emit
schema-satisfying placeholders, and processing order is not reliably encoded.
M6 may read those terms as evidence to compare against what it asked for; it may
not treat their presence as truth or their absence as "nothing happened".

## M6 exit criteria

Twelve criteria. Each is phrased as a truth about the product that can be proved
independently, not as "the planned code was written". Each names the slice
expected to own it.

**All twelve must `PASS` for M6 to be complete, and the two kinds of criterion
differ only in what passing means.** Criteria 1-10 and 12 are core product
truths: each is proved directly, and none may be closed as deferred, refused or
evidence-blocked. Criterion 11 is about *conditional routes*, so it passes when
every route in its closed set has reached a terminal disposition — the routes may
individually be admitted, refused with evidence, or evidence-blocked, and none
has to be admitted, but leaving one undispositioned fails the criterion.

**If a core criterion cannot be proved, M6 is not complete.** That is the point
of writing them down; a criterion that may be waived is a preference.

| # | Criterion | Owner |
| --- | --- | --- |
| 1 | **The conversion lane has one availability authority.** Every surface that offers a conversion action and the operation that performs it read the same rule; no surface offers an action the operation would refuse, and none withholds one it would accept. An unavailable action gives one truthful reason, once | **M6.1** |
| 2 | **Every admitted conversion setting is evidence-backed and typed.** Each traces to an exact provider identity, a live measurement of that build, a stated product semantic and a deterministic argv mapping. No setting is visible because a flag exists | **M6.2**, **M6.3**, **M6.4** |
| 3 | **The visible plan is the bound plan.** What the summary states before `BEGIN` is what the queue binds, and moving any control afterwards changes nothing about the running queue — across every fact M6 adds to the plan: intent, destination policy, any destructive authorization, and scope | **M6.3**, **M6.4**, **M6.5**, **M6.6**, **M6.7** |
| 4 | **Destination authority is explicit and safe.** A destination is a resolved directory object with the policy that chose it; source/destination **object aliasing** is refused on identity rather than on a path prefix; writing **inside a directory-shaped acquisition** fails closed; the **sibling container of the logical acquisition is admitted** — a file's parent, a bundle's container, or a directory-shaped acquisition's parent — because that is what `source sibling` resolves to; and a retry revalidates **every identity it will use** by identity rather than by name, never re-resolving the policy into a different destination. **Named exception, carried from CNV-D3:** where no admitted acquisition family is directory-shaped, the aliasing and vendor-dataset-root halves are met by each rule being stated, ordered ahead of the sibling admission, and implemented in a path a directory-shaped source would enter — rather than by an observed refusal, because nothing can currently trip either | **M6.5** |
| 5 | **Selected and all are deterministic and bound.** Each scope has one stated meaning, a visible order, an explicit treatment of ineligible rows and of rows added after `BEGIN`, and a capacity refusal that arrives before the commit | **M6.7** |
| 6 | **Conflict and destructive behaviour are explicit, and destructive publication is MSCanvas's own contract.** The conflict policy is resolved on the typed request before launch and identically for every entry path; explicit overwrite reaches a terminal `OVERWRITE_ADMITTED` or `OVERWRITE_REFUSED`, and is admitted **only** on a tested destructive-finalization contract in which a failure cannot lose the prior user file; any destructive option is explicit, scoped, bound to its plan and not inherited by retry; the provider stays confined to staging under either answer; and where overwrite is refused, the refusal is recorded with its reason | **M6.6** |
| 7 | **Cancellation fails closed, and claims no more than the scope observed.** Three dimensions must agree: a **structural ownership outcome**, a **representative provider measurement**, and an **exhaustive reconciliation** of every claim representing cancellation success or complete process-tree disappearance — proved by a repository guard over that semantic, not by a hand-maintained list. Under `OWNERSHIP_UNCONFIRMED` a stop of a **launched** conversion does not settle as a successful `Cancelled`: it settles `CancellationFailed` / `StopFailed` and quarantines the session, and no surface represents it otherwise. `NotStarted` is unaffected, and no new backend work begins while MSCanvas cannot establish whether an earlier conversion-owned process survives | **M6.8** |
| 8 | **Progress contains no fabricated precision.** Item counts, per-state counts and the current item's state — and any finer signal only on a measurement that it can be counted honestly | **M6.8** |
| 9 | **All five judgements are distinct, and visibly so — process, staged output, finalized output, integrity, adoption.** No surface, wire type or summary reduces an item to succeeded/failed, and a reader can tell "it ran" from "something was staged" from "an output was written" from "it was checked" from "it is in the workspace". Staged output is answerable independently of whether finalization happened — and on the ordinary-failure paths too, where the observation is not taken today — so a failure that **staged something** is distinguishable from one that staged nothing, which residue alone cannot tell apart; artifact and manifest facts sit beside the five and never substitute for one | **M6.9** |
| 10 | **Multi-output completion is truthful.** A backend-named set reports how many of what landed; a partial set is neither a success nor a failure; and a set's collisions and adoption are answered as a set rather than by a one-file rule | **M6.6**, **M6.9** |
| 11 | **Every conditional route has a terminal disposition.** Four routes, and the set is closed: mzXML; vendor-format direct preview; whether M6 opens any further vendor family at all, answered as one decision rather than per family; and VIEW-007's conditional re-entry. Each ends admitted, refused with evidence, or evidence-blocked with what is missing and who would supply it. **Reaching a disposition is required; being admitted is not** — M6 completes on any combination of the three outcomes, and on none of them being admitted | **M6.10** |
| 12 | **M7 and M8 receive stable seams.** The reads listed above exist and are consumed by at least one current surface, so they are proved rather than declared — and no persistence, artifact store or lineage model was built to provide them | **M6.3**, **M6.5**, **M6.9**, **M6.11** |

Three milestone-wide conditions, on the pattern
[ADR 0037](0037-viewer-completion-route.md) used:

- **A** — no unimplemented conversion capability is described as implemented
  anywhere in the repository, and no delivered one is described as missing;
- **B** — every M6 control satisfies the inherited interaction principles at all
  three responsive targets;
- **C** — the local gate set passes unchanged.

**What is explicitly not an exit criterion — as a *delivered capability*:** an
admitted mzXML; an admitted VIEW-007 re-entry; an admitted vendor-format direct
preview; an admitted further vendor family; a visible XIC; a larger queue;
per-item cancellation; a queued-item skip; and any part of M7 or M8. Each is excluded unconditionally. A
measurement that *supports* per-item cancellation, **together with an ownership
outcome that permits it**, lets M6.8 deliver it; neither turns it into a
requirement, because no criterion above names it and a milestone whose completion
turns on how a measurement lands is not a milestone.

**This is a list of capabilities, not of questions.** The **first four** are the
*admitted forms* of criterion 11's four closed side routes — mzXML, VIEW-007's
conditional re-entry, vendor-format direct preview, and whether a further vendor
family opens — and criterion 11 requires each of those **routes** to reach a
terminal disposition before M6 closes. What is excluded is the obligation to
*admit* one; what is required is the obligation to *answer* it.

The **remaining five** are on no route and in no criterion. A **visible XIC** is
listed among them deliberately: it is the Post-M6 interlude's possible
deliverable, not VIEW-007's M6 form — even a re-entry M6 admitted would schedule
a viewer slice rather than produce a trace — so it is neither excluded-as-a-route
nor owed a disposition here. A larger queue, per-item cancellation, a queued-item
skip and any part of M7 or M8 are simply unnamed by every criterion.

## Questions this route cannot answer, and does not pretend to

Recorded so a later slice inherits a question rather than an assumption.

1. **How MSCanvas replaces an existing destination object without a failure
   losing the old one.** This is the real destructive question, it belongs to the
   Rust finalization boundary, and no measurement of the provider can answer it.
   Owner **M6.6**, and CNV-D4 terminates on `OVERWRITE_REFUSED` if it cannot be
   answered. (What `msconvert` does to an existing output remains unobserved and
   is recorded as a non-authoritative provider fact off the critical path — the
   provider never meets that file.)
2. **Whether `msconvert` writes anything besides its output _for a format other
   than mzML_.** The mzML and multi-output cases were measured in M3.0.3 and
   M3.10 and are not open; only a non-mzML format is, which makes this a
   consequence of CNV-D1 rather than a standing debt. Owner **M6.2**, and only
   if a second format is admitted.
3. **Whether a real `msconvert` run is a process tree at all.** The termination
   mechanism is right; the evidence is about one process. Owner **M6.8**.
4. **Whether overwrite is admissible at all**, given ADR 0009's no-clobber
   guarantee and CNV-008's "overwrite requires explicit confirmation". Two
   accepted documents disagree, and a person decides. Owner **M6.6**.
5. **What numeric precision MSCanvas means to ship.** The provider's default is
   currently answering a question MSCanvas has never asked. Owner **M6.2** to
   measure, **M6.3** to type, **M6.4** to show.
6. **What queue capacity should be**, once cancellation is understood. The current
   number is a wait-time judgement whose stated premise has gone stale. Owner
   **M6.8**.
7. **Whether a mzML `dataProcessing` record can be relied on as verification**,
   given that other writers emit placeholders. Owner **M6.2**.

Two further items are **not M6's**, and are recorded here only so they are not
rediscovered as conversion debt: the retention-time viewport rounding, still open
with a placeholder owner and belonging to the chromatogram planner; and the
`projection.rs` rustdoc P3, which cannot be closed because it was never stated.

## Consequences

**M6.1 is next**, and the milestone can begin without reopening the product
model.

The route is finite: twelve slices, twelve exit criteria, nine decisions with a
status each, and every conditional branch ending in a stated disposition rather
than an open one.

It is also smaller than the roadmap implied, and the audit is why. The private
conversion boundary ADRs 0009 to 0027 built is stronger than the four backlog
bullets suggested — object-identity destinations, handle-bound finalization, Job
Object termination, an eight-member item-state vocabulary, evidence bound to an
executable digest — so most of M6 is giving that boundary an honest product
surface rather than building a boundary. The work that is genuinely new is
concentrated in two places: **measuring what the installed `msconvert` actually
does** with the settings this product wants to offer, and **making one rule decide
whether a conversion action may start.**

Three things this ADR deliberately refuses to do. It does not admit a setting on
the strength of a flag or a source reading, however clear the source. It does not
resolve the ADR 0009 / CNV-008 conflict by preferring one document. And it does
not make an **admitted** VIEW-007 re-entry, mzXML, direct preview or further
vendor family a condition of M6 completing — because a milestone whose completion
depends on a measurement going a particular way is not a milestone, it is a hope.

**Answering each of them, however, is required.** Criterion 11 is the one place
those four are obligations, and what it obliges is a terminal disposition rather
than an admission. The distinction is the whole difference between a route that
ends and a route that is left open.
