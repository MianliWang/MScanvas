# ADR 0044 — Conversion configuration is a Rust-owned authority bound to one installation receipt

Status: accepted
Date: 2026-09-04
Related: [0009](0009-mzml-conversion-execution-boundary.md),
[0011](0011-private-workspace-conversion-path.md),
[0013](0013-serial-conversion-queue.md),
[0041](0041-viewer-selection-availability.md),
[0043](0043-conversion-completion-route.md)

## What this ADR is

M6.4A, an authority-boundary interlude between M6.3 and a replacement M6.4.
[ADR 0043](0043-conversion-completion-route.md) remains the route authority for
M6; what is recorded here is the ownership boundary the conversion configuration
must sit on, decided before any of it is built again.

It exists because M6.4 was attempted once, on
`feat/m6.4-visible-conversion-settings` / PR #95, and stopped four times. Each
round closed the findings it was given and was stopped by something that closing
introduced. That is not four unlucky reviews. It is the signature of a slice in
which **several individually correct authorities are reconstructed against one
another in the frontend**, where every new local repair has to be written by hand
against all the others.

PR #95 is therefore **implementation evidence, not product authority**. Nothing
in it is on `main`. This ADR takes its findings as measurements of a design and
answers the questions those measurements turned out to be about.

No production code changes with this ADR. The boundary is proved by audit and
contract; the replacement implementation proves it by construction.

## The eight questions, answered

The replacement implementation must not have to invent any of these while
coding.

| Question | Answer |
|---|---|
| Who owns installation truth? | Rust, as a typed authority state — never a bare counter the frontend interprets. |
| Who owns conversion-capability/catalog truth? | Rust, as a lifecycle keyed by the installation binding. |
| What identity binds those facts together? | One opaque, session-scoped, path-free `BackendBindingReceipt`. |
| Who owns catalog request lifecycle and retry? | Rust owns the lifecycle state; the frontend initiates a read or a retry and owns neither. |
| What does React retain? | The selected intent id, request-in-flight for rendering, Rust's plan answer, and presentation. Nothing else. |
| At what granularity does availability exist? | The admitted **row** — one composition. There is no per-value availability authority. |
| What makes a pre-run plan current? | Ordered handles, intent id, conflict policy, binding receipt, document epoch — compared against Rust's own answer. |
| What must be established before BEGIN reserves anything? | The current binding has proved the exact selected intent executable. Mandatory, never a courtesy. |

## The failure shape, before the decisions

Sixteen live findings stand on PR #95 — five of them at outdated diff positions,
all read — plus four committed STOP records. Read as
a list they look like sixteen defects in six files. Collapsed by *what made each
one possible*, they are seventeen semantic families and almost all of them are
one of three shapes:

**A fact and the thing that carries it come apart.** A request outlives the state
it produced; an observation is lost because the operation carrying it failed; a
reply is ordered against a number that does not mean what its name says.

**A signal is read from a proxy that resembles it.** `backendUsable` stands in
for "the catalog is invalid"; "a reply carried a higher generation" stands in for
"something was observed"; `appliedGeneration` stands in for "a verdict settled".

**A fact about one thing is asserted about another.** A row-level refusal
rendered per value; one reason owned by two DOM elements; a plan `loading` with
no request behind it.

What every one of them has in common is that the authority which could have
settled the question **exists in Rust and was projected to the frontend as a
number or a boolean**, leaving the frontend to reconstruct the meaning. The
decisions below remove that reconstruction rather than correcting its arithmetic.

## Decision 1 — Rust owns installation truth, as a state and not a counter

`installation_generation: AtomicU64` and `note_resolved` are the current
authority. They are correct in Rust and wrong at the boundary: the frontend
receives the number and rebuilds, by hand, four separate notions of what has
happened to it — what has been *observed*, what has been *automatically
attempted*, what has been *applied*, and what is *settled*. Those four were
introduced one per correction round, each because the previous round's number
could not answer a question the next round asked.

The authority becomes a typed state Rust owns and the frontend renders:

```text
BackendAuthorityState
  | Unresolved
  | ObservedButUnsettled { binding }
  | Settled { binding, previewAvailability }

Binding
  | Installed      { receipt }
  | NoInstallation { receipt }
```

`ObservedButUnsettled` is the member the counter could not express, and every
round needed it: an operation resolved the installed build, so the *binding* is
known, but no preview verdict has settled for it yet. Today that state is
approximated by an inequality between two frontend watermarks.

**`NoInstallation` is a binding, not the absence of one**, and that is what lets
Decision 4's three-way distinction be written at all: *this build*, *no build*,
and *nothing was established* are three different observations, and only the
third leaves the authority alone. It is also what the current design already
does — `note_resolved(None)` advances the counter, because nothing resolving is
a different answer from something resolving — expressed as a member rather than
as a `None` two layers down.

**The frontend may project this state. It may not synthesize it.** A conversion
operation that resolves the installed executable is an observation, and it
belongs in Rust at the moment it happens — not in a callback the frontend
supplies and each call site must remember to invoke.

*Alternative considered and rejected:* keep the counter and give the frontend a
better reconciliation rule. Three rounds did exactly that. The counter cannot
distinguish "seen" from "settled", so every rule written over it needs a second
frontend fact to carry the difference, and that second fact is the defect.

## Decision 2 — one opaque installation binding receipt

Every fact about one installed ProteoWizard carries one Rust-issued receipt:

```text
BackendBindingReceipt
```

Required properties:

- **path-free on the wire** — it is not an installation identity, which is made
  of absolute paths and must not reach the webview;
- **session-scoped** and meaningless to anything that did not receive it;
- **equatable**, and that is the whole of its interface;
- **changes** whenever the authoritative binding is replaced, including when a
  build is replaced by no build and when no build is replaced by one;
- **stays equal** through a same-installation recheck;
- **sufficient** to decide whether a catalog, a plan or a result describes the
  binding this session is on.

An internal monotonic counter may remain the implementation. What must not
happen again is exposing that counter and letting call sites supply its meaning:
a receipt is a typed identity, not a number with arithmetic performed on it by
four different readers.

This closes the family in which a plan stamped from one reading and a catalog
stamped from another are compared for equality, and disagree for reasons neither
side can explain to the user.

## Decision 3 — preview availability and conversion configuration are two judgements

The current design has one global "is the backend usable" fact, and it answers
two different questions:

```text
preview availability      -> msaccess, required preview operations
conversion configuration  -> msconvert, ConversionIntent capability grammar
```

They share an installation. They are not the same judgement, and collapsing them
is what let a *check* invalidate a *catalog*, and what makes "the backend is
usable" an ambiguous sentence in half the findings.

```text
InstallationBinding
  ├── PreviewAvailability
  └── ConversionConfiguration
```

A build may be truthfully usable for preview while its conversion catalog read
has failed, or while the selected intent is unsupported. Neither answers for the
other.

## Decision 4 — the conversion provider returns an observation even when binding fails

This is the root shape behind more findings than any other decision here, and
**the repository already solved it once, for previews**:

```rust
/// One attempt at an operation: which installation ran it, and how it went.
///
/// The two are kept together because they answer different questions and only
/// one of them survives a `?` ... a caller that propagated the error would lose
/// the one fact that says whether the failure even came from the installation
/// it thinks it is using.
pub struct OperationAttempt {
    pub installation: Option<InstallationIdentity>,
    pub outcome: Result<PreviewOutcome, PreviewErrorDto>,
}
```

`PreviewProvider::conversion_backend` returns
`Result<ConversionBackend, PreviewErrorDto>` — a bare `Result`, which is exactly
what that comment warns against. The preview path learned the lesson; the
conversion path did not inherit it, and three separate findings are that `?`
discarding an identity discovery had already found.

So conversion resolution returns the same shape:

```text
ConversionBackendAttempt {
    installationObservation,
    outcome: Result<ConversionBackend, Error>
}
```

with these rules:

```text
discovery found installation I, then msconvert help/capability parsing failed
  -> I was still observed

discovery established that no installation resolves
  -> absence was observed

discovery could not establish either fact
  -> nothing is observed; nothing is invented
```

The service consumes the observation **once**, updates the installation
authority, and only then propagates the operation outcome. No individual call
site may have to remember to record an observation after its own success or
failure branch — which is precisely the discipline that failed at
`conversion_intent_catalog`, at `begin_queue`'s error arm, and at `drain_queue`.

The rule must hold for every conversion-bound resolution: the configuration read,
the BEGIN preflight, queue execution and drain, retry preparation, and anything
added later.

*Alternative considered and rejected:* classify the error. An allowlist of error
kinds, or a `retryable` heuristic, puts a second installation authority on the
caller and silently misses the next error kind. It was proposed twice during
PR #95 and declined both times; recording it here means it does not have to be
declined a third.

## Decision 5 — Rust owns the conversion-configuration lifecycle for a binding

The frontend currently rebuilds this from several refs — which binding was
served, which was automatically attempted, which catalog generation has been
installed, whether a standing catalog describes the current binding. Each was
added to answer a question the previous round's shape could not, and their
disagreement is a family of its own.

Rust holds it, keyed by receipt:

```text
UnavailableForBinding
Unattempted
Ready  { binding, catalog }
Failed { binding, error }
```

`loading` is request activity, not domain state, and is not persisted here.

Lifecycle:

```text
the receipt is replaced    -> the previous configuration state no longer applies
same receipt               -> Ready stays Ready, Failed stays Failed
                              a recheck alone never causes a second probe
Unattempted                -> one read when the lane permits
Failed                     -> only an explicit settings retry spends another attempt
receipt replaced mid-request -> the stale reply cannot become current
```

**Invalidation is triggered by the receipt being replaced, not by a preview
verdict settling**, and the difference is a real window rather than a wording
preference. A conversion-bound operation can observe binding B and fail its
capability resolution, which leaves the authority at `ObservedButUnsettled(B)`
with no preview verdict for B at all. Keyed on settlement, `Ready(A)` would stay
current for the whole of that interval — the stale-catalog window this ADR exists
to close, reopened at the one moment the session already knows better. Keyed on
the receipt, A's configuration stops being an answer the moment B is observed,
and B's is `Unattempted` until something reads it.

The frontend may *initiate* the read and the retry. It must not own whether a
binding has been served, attempted or replaced. After the replacement lands,
nothing equivalent to `servedBinding`, `catalogGeneration` or
`automaticallyAttemptedBinding` should be needed in React.

## Decision 6 — one conversion-settings snapshot crosses the wire

```text
ConversionConfigurationSnapshot {
    binding
    configuration: UnavailableForBinding
                 | Unattempted
                 | Ready  { catalog: admitted rows, shipped intent identity }
                 | Failed { error }
}
```

The catalog lives **inside** `Ready`, exactly as it does in the lifecycle this
projects. Carried as a sibling field it would be representable beside a `Failed`
or `Unattempted` configuration — a payload asserting both that the settings could
not be established and what they are, which is the shape of half the findings
this ADR exists to close.

Path-free; no argv; no installation identity. It answers one question:

> What conversion semantics are known for the installation MSCanvas is currently
> bound to?

The frontend must never have to join a generation from one response with a
catalog from another to manufacture that answer. That join is what made a stale
catalog installable, and what made a plan and a catalog disagree about a number
neither still described.

## Decision 7 — availability belongs to the row, never to the value

M6.3's finding is the load-bearing one here: *individual capability supported* is
not *arbitrary composition supported*. Forty-eight combinations span the axes and
nine are measured.

So M6.4 must not introduce an authority that says, globally, "64-bit intensity is
supported" and infers a product decision from it. Availability is a property of
one admitted row. One-axis editing reads:

```text
current admitted row, replace exactly axis X with value V
  -> no such row            : that combination is not qualified
  -> row exists, unavailable: that combination is unavailable on this installation
  -> row exists, available  : selectable
```

Wording names the **combination**, not the value. This is the direct cause of the
last round's blocking defect: a row-level refusal was rendered against each of
four axis values, so a build that lacks only the peak-picking grammar told the
reader it does not offer 64-bit intensity, all spectra, or zlib — three false
statements beside the very controls the reader must use to recover.

## Decision 8 — a preserved unavailable selection is one row-level statement

When the selected intent survives an installation change into a build that cannot
run it:

```text
the selection stays selected
the selection is unavailable
```

Stated **once**, at settings level, naming the combination:

> The conversion settings you chose cannot run with this ProteoWizard
> installation.

Individual controls keep answering their own narrower question — *what happens if
I change this one axis?* — so 64/64 remains a truthful, selectable value even
while the centroided 64/64 **combination** is unavailable.

A four-times-repeated per-value unsupported message is explicitly rejected.

Graph recovery from PR #95 is preserved unchanged: the choice survives; ordinary
controls are the recovery wherever one one-axis target row is available; only a
genuine one-axis dead end may offer the explicit atomic "use the settings
MSCanvas ships" action; and that action is never a silent fallback.

## Decision 9 — the plan has an explicit state machine

```text
none | blocked | loading { request identity } | ready | failed
```

```text
no rows requested                     -> none
rows requested, no usable intent      -> blocked, never loading
a request is in flight                -> loading, carrying that request's identity
the request failed                    -> failed; never "rereading"
inputs changed, replacement in flight  -> loading for the replacement
old answer no longer current, no replacement -> blocked, not loading
```

`none` and `blocked` are kept apart because they say different things to the
reader: nothing has been selected to convert, against rows are selected and
something else is missing. Collapsing them is how a panel comes to explain an
empty selection with a sentence about the backend.

Two findings are exactly this distinction: a plan pinned at `loading` with no
request ever issued, and a plan Rust *refused* explained to the reader as one
being reread. The Convert refusal must distinguish a failed plan from one being
recomputed, because the reader can act on the first and can only wait for the
second.

Plan identity is ordered handles, intent id, conflict policy, **binding
receipt**, and the document/workspace authority the live design already requires
— compared against Rust's own answer rather than against a second copy of the
question. A plan from binding A cannot start under binding B.

**Ownership splits cleanly here and should be read that way.** The plan *answer*
is Rust's, as it already is. The state machine above is the frontend's model of
its own outstanding request, which is genuinely document-local — it is the one
place React legitimately tracks in-flight work, and Decision 13 keeps it. What
the frontend must not do is infer *currency* from that model: whether the answer
on screen still describes the request is settled by comparing identities, not by
which state the machine happens to be in.

## Decision 10 — exact-intent preflight is mandatory

```text
no ConversionQueue
no destination reservation or picker
no staging
```

may become reachable until the current binding has proved the exact selected
intent executable. A helper documented as *"a courtesy rather than a duty"*
cannot own that proof — it did, and a busy lane skipped the check entirely,
producing a bound queue, an opened picker and a chosen folder before anything
refused.

If the lane cannot answer now, the request waits safely or BEGIN is refused,
according to the repository's concurrency contract. It is never skipped.
Execution-time revalidation remains, because the executable can change again
after admission; it is a **second temporal proof**, not a substitute for the
first.

## Decision 11 — one lane authority for any `msconvert --help` probe

PR #95's last round produced a second-answer shape of its own: the explicit
catalog retry consulted a lane rule and the automatic read did not. One question
—

> may a catalog probe launch now?

— has one answer, whoever asks. Automatic first read and explicit retry may
differ in *initiation*, never in *admission*. If a queue owns the backend, the
request is deferred or truthfully refused; an unbounded hidden probe is never
enqueued behind it.

This is expressed over M6.1's existing lane, not beside it. `ConversionLane` and
its one availability rule remain the authority for what the backend lane is doing;
what this decision adds is that a catalog probe is an *action over that lane*
like any other, and so is admitted by the same facts rather than by a predicate
written for it. Which subset of those facts applies to a probe is part of the
rule and stated once, not decided again per call site.

## Decision 12 — one DOM owner per availability reason

M6.1's invariant is **one reason, one notice element**. The conversion panel now
offers three actions that can share a refusal — Convert, retry the failed
conversion, retry the settings read — and the last round had two components
emitting the same id for one reason, leaving `aria-describedby` ambiguous.

**Locked choice:** one panel-level availability notice registry receives the
decisions for every action currently offered and deduplicates by reason. Child
components never mint a global availability id. (The alternative — namespaced
per-child notices — is rejected: it multiplies the same sentence and reintroduces
the "each surface decides again what is wrong" defect ADR 0041 removed.)

## Decision 13 — what React retains

React owns:

```text
the selected admitted intent id
request-in-flight state needed to render an outstanding command
the Rust-authored plan answer
ordinary presentation state
```

React does **not** own reconstructed authorities for installation observation
watermarks, an applied generation, an automatic reconciliation quota, a settled
binding, a catalog-served binding, or catalog-generation ordering.

**One distinction here is load-bearing, because the replacement will meet it on
its first day.** React *looks combinations up* in the catalog Rust sent; it does
not *decide* compatibility. M6.3's property is exactly that — the admitted table
is the rule, and the selection module composes nothing, enumerates no dimension's
values and holds no second graph. So a one-axis lookup in the delivered catalog
is not a frontend authority and stays where it is; what would be a frontend
authority is any statement about what a build supports that is not read straight
out of a row.

If a proposed implementation needs several of those again, it violates this
interlude and the ADR must be revised first rather than the rule bent.

## The state graph the replacement implements

**Healthy mount.** Settled binding A → configuration `Unattempted(A)` → the lane
permits a read → `Ready(A, catalog)` → SHIPPED selected → plan for A.

**Same-installation `Check again`.** `Ready(A)` → a check is in progress →
configuration for A is preserved → conversion is unavailable *because backend
activity is in progress*, and for no other reason → the verdict settles on A
again → no catalog probe.

**Installation replacement.** A → B observed → the authority's binding changes →
A's configuration and plan cannot remain current → the preview verdict settles on
B → configuration for B is read once → the user's selection is preserved where
the row still exists.

**Catalog transient failure.** Binding A → the read fails → `Failed(A)` → no
automatic retry loop → the reader takes the explicit settings retry → `Ready(A)`.

**Selected row unavailable.** The row exists in B but is unavailable → the
selection is preserved → **one** row-level statement → axis values are not
labelled unsupported → one-axis alternatives remain reachable.

**True dead end.** The selected row is unavailable and no one-axis transition is
available → the shipped row is available → the explicit atomic recovery is
offered.

**BEGIN after an installation change.** A plan under A, current binding B → BEGIN
reserves nothing.

**Backend lost after BEGIN, before execution.** Binding A reserved → the
provider's resolution observes the loss → the authority records it → execution
refuses → the next state read carries the new authority → A's catalog and plan
cannot remain current.

**Plan blocked.** No configuration or no selected intent → no plan request → no
"Reading the conversion plan…".

**Plan failure.** The request actually failed → failed state, with the error and
what the reader can change → never "please wait while this is reread".

## Semantic finding ledger

Every live PR #95 finding and STOP record, collapsed by what made it possible.
This is the handoff: the replacement implementation proves the right-hand column,
and no finding may disappear because the old PR was superseded.

| # | Family | What permitted it | Required invariant | Owner | Replacement acceptance case |
|---|---|---|---|---|---|
| 1 | Admitted graph duplicated or widened | A frontend able to compose axis values | The admitted table is the only compatibility rule | Rust (`ConversionIntent::ADMITTED`) | No TS from which a nine-row graph could be rebuilt; 39 combinations unreachable by any activation sequence |
| 2 | Preserved unsupported selection unrecoverable | One-axis editing plus a preserved choice, with no escape | A genuine dead end offers one explicit atomic recovery | Selection module | Dead end offers the shipped row; a reachable one-axis route offers no recovery block |
| 3 | Catalog outlives the backend it described | Catalog lifetime keyed on nothing that expires | A replaced receipt revokes the configuration bound to the old one | Rust configuration lifecycle | A binding observed as `NoInstallation` → the previous configuration is gone, without waiting for a verdict |
| 4 | In-flight obsolete catalog resurrects state | Revoking rendered state without revoking the request | Revocation is one act over state and request | Rust configuration lifecycle | A reply about a superseded binding cannot install |
| 5 | BEGIN observes a changed build, nothing reconciles | An observation made by an operation that then refused | Resolution is an observation, complete when it succeeds | Provider attempt + authority | A refused BEGIN that resolved a new build advances the authority |
| 6 | Catalog read tied to transient checking | `backendUsable` false for the duration of any probe | A check is activity; a binding is a verdict | Authority state | Same-generation recheck: no probe, no revocation, plan preserved |
| 7 | Repeated polls, repeated reconciliation | A reply carrying a number treated as a request | An arriving fact is not a request | Authority state | N polls of one observation → at most one backend probe |
| 8 | Catalog failure with no retry owner | Recovery living on a conflation that was removed | A failed read is not a state a binding can clear | Rust lifecycle + explicit retry | Transient failure → recheck does not retry it; explicit retry does |
| 9 | Provider-resolution failure loses the observation | `?` propagating an error past a found identity | Resolution returns the observation either way | `ConversionBackendAttempt` | Resolution failure that established absence advances the authority; one that established nothing does not |
| 10 | Mandatory preflight under an optional courtesy | A gate that may be declined owning a guarantee | Admission proof is never skippable | Rust BEGIN | Busy lane → BEGIN waits or refuses; never a queue without the proof |
| 11 | Selected-but-unavailable rendered as usable | A state that could hold only one of the two facts | Selected and available are two facts | Selection module | The preserved unrunnable selection reads as unavailable |
| 12 | Row incompatibility asserted per value | A row-level fact rendered against each axis value | Availability is a property of a composition | Selection module | A build lacking only peak-picking makes no false claim about 64/64, all spectra or zlib |
| 13 | Two owners of one availability reason | Each surface minting a global id | One reason, one notice element | Panel notice registry | No duplicate availability id under any refusal shared by two actions |
| 14 | Plan `loading` with no request | One member standing for "in flight" and "never asked" | `loading` names an actual request | Plan state machine | No selected intent → blocked, and nothing claims a read |
| 15 | Failed plan described as reloading | A single non-current reason for four situations | A refusal names what the reader can change | Availability rule | A refused plan reads as failed, not as being reread |
| 16 | Backend loss during drain not recorded | The same `?` as #9, in the execution path | Every conversion-bound resolution observes | `ConversionBackendAttempt` | Loss while the picker is open advances the authority |
| 17 | Automatic read ungoverned, explicit retry governed | Two answers to "may a probe launch now?" | One admission rule for every probe | Lane authority | Both paths refuse identically under a held lane |

## What this interlude does not do

It implements nothing. No Rust, no TypeScript, no CSS, no tests, no repository
validator, no dependency and no provider evidence changes with it. It takes no
new scientific measurement: the nine admitted rows are M6.2's nine, and M6.3's
type boundary around them is unchanged and unquestioned.

It does not close PR #95 or delete its branch. That branch holds tests, copy and
measured behaviour the replacement should extract, and the replacement M6.4 will
decide the retirement point.

It does not start M6.5. Destination authority remains M6.5's, and the summary
still says the folder is chosen next.
