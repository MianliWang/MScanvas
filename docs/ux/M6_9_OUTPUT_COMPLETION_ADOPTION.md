# M6.9 output completion and adoption

Status: implemented and validated.
Baseline: `96351b2adc0f668f12c26a3ca1ee471ca991f284` (published M6.8), tree
`7383517e022de64faf90d05340ac2484f8467852`.

## What this slice makes true

A reader can tell five things apart, per item and per queue, and none of them is
derivable from another:

```text
1 process         did a converter run, and how did it end
2 staged output   what the private working folder held, whether or not
                  anything was published
3 finalized       what obtained a final name, including part of a set
4 integrity       validation mode, the three dispositions, and advisories
5 adoption        what an adoption did with this item's outputs
```

Four of the five were already separated in the crate's vocabulary and collapsed
only on screen. **The exception is judgement 2, and it was a model addition.**
The staged-content observation was taken on the stop paths and on the
multi-output set-stop, and on no other path — so an ordinary failure settled
with no observation at all. A clean teardown reports the same absent residue
whether the working folder held a half-written document or nothing, the
destination says only what was published, and exit status says neither. Those
two failures were one answer everywhere downstream.

They are now two answers, and the difference survives the report, the queue, the
transfer object and the rendered row.

## The four-way staged judgement

"Empty" is not one answer, so the evidence is not a boolean:

| Arm | What it says |
| --- | --- |
| `notCreated` | No working folder was available to observe. The converter was never given anywhere to write — either because the attempt settled before one was made, or because one was made, its own setup failed, and teardown removed what it had built before anything was invoked. |
| `unobserved` | One existed and could not be read **at the stated phase**. Unknown, never empty. |
| `observed` | Read at the stated phase, with a shape: entries, directories, and whether any ordinary file held bytes. |
| `published` | The staged output took its final name. Not an observation, and it says so. |

The phase is part of the answer. An empty snapshot says the folder was empty
*then*; taken after a publication it is consistent with everything having been
moved out and says nothing about what the converter produced. Four phases:

| Phase | When the reading was taken |
| --- | --- |
| `provider_not_invoked` | The attempt settled without the provider being invoked at all. The folder exists and nothing was ever handed it. |
| `backend_settled` | As soon as the backend's own execution settled. The phase at which "did the provider write anything" is answerable. |
| `output_refused` | After the output was judged and refused. Validation reads and removes nothing. |
| `publication_settled` | After publication ran and stopped partway. |

**A phase never asserts an event that did not happen.** An unplannable command
and a stop that arrives between creating the working folder and launching are
both read at `provider_not_invoked`, not at `backend_settled`; a skipped set and
a set refused after discovery published nothing, so neither is read at
`publication_settled`.

**A zero-byte staged file is an entry and is not an output document.** It counts
in `entryCount` and does not earn `nonEmptyFileObserved`, which is the only
content claim a run makes about itself. An entry that is neither a file nor a
directory is counted the same way and is never given a byte length.

**Observation is evidence and only evidence.** It decides nothing removed,
replaces no primary failure, changes no termination judgement and authorises no
cleanup. A failed read produces `unobserved` and changes nothing else about the
attempt. M6.8's final-observation and error-ordering law and M6.6's object-bound
cleanup are untouched — the run still holds its working folder as objects for its
whole life, which is why an enumeration failure inside a run is not something
this suite can force: nothing can take the folder away.

## The process judgement, read from the boundary

`backend` is absent for two entirely different reasons — nothing was launched,
and something was launched that could not be reported on — so the process
judgement is carried rather than read off it:

```text
notAttempted    settled before the provider was invoked at all
indeterminate   invoked, and what became of the process is not established
settled         a process ran; termination and exit code, which can disagree
```

A run whose streams could not be captured reports `indeterminate`. Reading its
absent facts as "no converter ran" is the inference this arm exists to refuse.
`NotStarted` remains a *settled* ending: the runner answered, and its answer is
that no process was created.

## The run identity

`OperationRunIdentity` is minted **immediately before the command reaches the
process boundary**, and nowhere else. Not on first read, not on completion, and
never derived from the output's filename or the queue position — two runs of one
plan into one folder produce one filename and are two runs.

An attempt that settles ahead of the launch has none. That is the whole of what
keeps a refusal, a skip, a not-run row or a stop that beat the process from
reading as a run that happened, and it is enforced by construction: the
constructor is crate-private, so no consumer can stamp one onto an attempt that
never reached a provider.

The form is a fixed-width 32-character lowercase hex value: a per-process nonce
beside a monotonic counter, rendered through a bijection so the low half is not
this session's launch ordinal in plain hexadecimal. **Uniqueness within a session
is by construction** — the counter never repeats and the rendering is
one-to-one. **Across sessions it is an argument rather than a proof**: the nonce
is a 64-bit mix of the wall clock, the process id and the address of a static,
so two sessions colliding is improbable and not impossible. That is the right
strength for a value nothing authorizes anything on.

**M6 keeps no store of one and resolves none across sessions**, and there is
deliberately no parser — a value that cannot be read back cannot be compared
against another session's by accident. It does reach one file: the redacted
diagnostics export the user chooses to save carries it beside every other stable
identifier about an attempt. That is a document the user asked for rather than
session state, and "never written to disk" would be false of it.

No history of retry attempts accumulates: an item carries the latest attempt's
identity, as it carries the latest attempt's result.

`identity` used to be a forbidden word on this wire, because the only identities
this application had were filesystem ones — a volume serial and a file id, which
locate an object as surely as a path. Those are still absent, and the wire test
now checks for them specifically rather than for the word.

## The manifest, beside the five rather than among them

Names, byte lengths, SHA-256 digests and observed spectrum and chromatogram
counts describe *what was produced* rather than how far the lifecycle got. They
are readable per output and never substitute for a judgement.

A backend-named set's manifest replaced two positional arrays — names beside
states — whose pairing nothing enforced and which a reader had to maintain by
index. One entry per discovered member now carries its own name, its own state
and its own measurements, and measurements are present exactly where the member
was validated. Zeroes there would read as a measured empty document.

**Denominators name the population that is known.** A partial set reads *n* of
the members this run actually produced. The lifecycle's maximum output bound is
neither the number expected nor the number produced and is never the second
number in that sentence.

## Integrity, and what it still may not claim

`ValidationMode`, the three `IntegrityProperty` dispositions and the separately
typed advisory observations all cross now; the advisories were modelled in the
crate and projected nowhere. They are a fourth list and not a fourth
disposition: none of them is a check that could have been made and was not, and
folding them into `unverified` would report expected behaviour as an unanswered
question.

**And the list is empty on every conversion this release can run.** An advisory
observation is recorded only by the source comparison, and no family the visible
queue accepts is read under one — `is_convertible` refuses mzML, so every queued
item is judged output-only. Projecting and rendering them is the contract
CNV-D9 states, and it is what keeps the next family that *is* compared from
arriving at a surface that silently drops a quarter of judgement 4. What it is
not is something a user sees today, and no document here says otherwise. The
rendering is pinned against `source_comparison`, which is the mode the crate
pairs advisories with; a fixture pairing them with `output_only` would describe
a wire Rust cannot produce.

An item with more than one output states the **mode** and leaves the counts to
the manifest, which carries each member's own checked, not-established and
not-applicable totals. One member's counts printed as the item's would be a
sample presented as a total.

Output-only stays output-only however many properties passed. `inapplicable`
stays distinct from `unverified`. Nothing on this surface says fully verified,
lossless or vendor-faithful.

**A refused output is not an unchecked one.** A run whose output failed the
contract retains no validation record — the record travels with a finalization,
and there was none — so the naive reading of an absent record is "nothing was
checked", which is exactly false in the one case the check *is* the answer. The
sentence is chosen from the boundary's own failure identifier instead, and says
the output was checked, did not pass, and was discarded rather than published.

## Adoption

The existing explicit terminal-queue action is unchanged: no automatic adoption,
no automatic preview, no background discovery, no per-output policy, no silent
adoption of a partial set. Set eligibility, partial-tolerant refusal, duplicate
handling, duplicate-before-capacity, queue order, stale-operation and
stale-document checks and the workspace mutation gate are the ones M6.6–M6.8
shipped.

What M6.9 adds is that the result is **recorded on the queue it was about**. The
adoption reply is one message; the queue is read again on every poll and every
remount, so a fifth judgement that lived only in the reply would vanish from the
row the moment the document re-read it. Each item now answers:

```text
notRequested     nobody has asked, which is not a refusal
nothingToAdopt   this item produced nothing an adoption could offer
settled          added / already in the workspace / not added, with reasons
```

It is written under the queue **and its settling**, so a retry that lands
between the two halves of an adoption cannot be given the earlier round's
answers — the same pairing the commit itself is already refused by. A new
attempt drops it, because a rerun replaces the very files an earlier adoption
reported on.

**Historical, not current membership.** The sentence says what an adoption did.
Removing a roster row deletes no file and undoes no past process outcome, and
current membership is the roster's answer, read there. No persistent adoption
history is built.

An adoption refusal erases neither the finalization that happened nor what its
integrity check established: the row still reports both.

## The surface

One disclosure per settled row, inside the existing production conversion panel.
The row keeps its compact label, its output name, its measurements and its
recovery actions; the five judgements, the run identity and the manifest are one
activation away. Sixteen items times five always-open sections is a wall nobody
reads, and the row's own word is a projection that stays lossy on purpose.

The disclosure is uncontrolled, so a queue poll, a skip, a stop or an adoption
re-renders the list and leaves an open one open — the rows are keyed by dataset
handle, so the element is the same element rather than a new one. Ids are
derived from the row's position, so no two rows share one. The manifest scrolls
inside its own container; the page never scrolls sideways. Backend-chosen
basenames wrap rather than clip, because a truncated filename is not one anybody
can find in a folder.

A waiting or running row is offered no disclosure: it has one honest answer to
every judgement, and a control that only ever says "nothing yet" teaches its own
uselessness.

## Diagnostics schema

`SCHEMA_VERSION` moves from 2 to 3, and the increment is earned rather than
decorative: `cancellation.partialOutputObserved` **left**. It was a boolean over
an optional observation, so it answered `false` both for a working folder read
and found empty and for one that could not be read at all. What replaced it is
the item's own `stagedOutput`, present for every item rather than only for the
ones a stop reached, beside `process` and `runIdentity`. Redaction is unchanged
and the export still carries no path, no argv, no raw stream and no member
basename.

## Changed-path closure

28 paths at this head: 25 of code and evidence, 3 new files, plus the documents
listed at the end. Re-derived at every head with `git diff --name-only` against
the baseline rather than hand-maintained.

**The attempt's own facts** — `crates/proteowizard/src/attempt.rs` (new): the
identity, the observation phase, the four-way staged evidence and the process
outcome, with the constructors that keep each honest.

**Where they are minted and observed** —
`crates/proteowizard/src/conversion_run.rs`, `conversion_run/output_set.rs`,
`lib.rs`. The observation on every ordinary-failure path of both lifecycles, the
mint immediately before each call on the process boundary, and the typed
evidence replacing the optional observation on the stop paths.

**The crate's own evidence** — `crates/proteowizard/src/conversion_run/tests.rs`,
`crates/proteowizard/examples/conversion_cancellation_evidence.rs`.

**Queue, projection and wire** — `apps/desktop/src-tauri/src/preview/conversion.rs`,
`operation.rs`, `service.rs`, `dto.rs`, `adoption.rs`, `diagnostics.rs`,
`diagnostics/payload.rs`, `tests.rs`. The three attempt facts on the item, the
per-item adoption judgement written back under the queue and its settling, the
set manifest replacing two positional arrays, advisories, and the schema
increment.

**Interface** — `apps/desktop/src/features/mzml-preview/ConversionItemJudgements.tsx`
(new), `ConversionItemJudgements.test.tsx` (new), `ConversionPanel.tsx`,
`contracts.ts`, `apps/desktop/src/app/app.css`, plus the suites that pin the
wire and the existing surfaces: `conversionContract.test.ts`,
`ConversionPanel.test.tsx`, `ConversionOutputSet.test.tsx`,
`ConversionAdoption.test.tsx`, `ConversionDiagnostics.test.tsx`,
`ConversionStop.test.tsx`, `viewerSelectionAuthority.test.tsx`,
`src/test/previewFixtures.ts`, `src/test/outputSetRendering.test.tsx`.

**Documents** — `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `BOOTSTRAP_STATUS.md`,
`docs/product/FEATURE_CATALOG.md`, `docs/product/PRIMARY_WORKFLOWS.md`,
`docs/architecture/adr/0043-conversion-completion-route.md` (M6.9's acceptance
and the M7/M8 seams it freezes), `0016` (the adoption relation this records),
`0017` (the diagnostics schema version) and this record.

## Validation

Local gates at this head: frontend lint, typecheck, 1670 tests across 70 files,
build; `cargo fmt --all --check`; `cargo clippy --locked --workspace
--all-targets --all-features -- -D warnings`; `cargo test --locked --workspace
--all-targets`; `python -B scripts/check_repo.py`; `git diff --check`; E2E
typecheck.

### Mechanism reversions

Four, run serially in place and restored exactly, each failing the test its
decision exists for and each failing by assertion rather than by not compiling:

| Reversion | Test that caught it |
| --- | --- |
| The observation on the non-zero-exit path removed | `two_ordinary_failures_differ_by_what_they_staged` |
| A failed read mapped to `NotCreated` instead of `Unobserved` | `an_unreadable_staging_area_is_unknown_rather_than_empty` |
| A launch failure reported as `NotAttempted` | `a_failed_launch_is_indeterminate_rather_than_no_process` |
| The identity not minted before execution | `each_attempt_that_reaches_the_provider_mints_its_own_identity` |

## Residuals

- **The staged observation cannot be forced to fail inside a real run.** The
  working folder is held open as objects for the run's whole life, so nothing
  can take it away — which is M6.6's guarantee working, not a gap. What is
  proved is the mapping, at the two functions that decide it, which is where a
  conflation would live. Owner: none; this is a consequence of the design.
- **No conversion-boundary failure is retryable**, so a rerun that mints a
  second identity for a *launched* attempt cannot be produced through the queue.
  The queue-level proof runs from a retryable refusal, which mints none and then
  mints one; the launched-attempt case is proved at the conversion boundary.
  Owner: M6.11 to record, if a transient conversion failure is ever measured.
- **Advisory identifiers are shown as their stable identifiers**, not as
  sentences. They are rare, they fail nothing, and inventing five sentences for
  observations nobody has been observed acting on would be copy without a
  reader. Owner: M7, with the rest of the evidence surface.
