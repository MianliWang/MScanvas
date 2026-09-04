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

## The eleven questions, answered

The replacement implementation must not have to invent any of these while
coding.

| Question | Answer |
|---|---|
| Who owns installation truth? | Rust, as a typed authority state — never a bare counter the frontend interprets. |
| Who is obliged to deliver it? | Every conversion-bound operation that can observe it, on its answer, whether that answer succeeds or refuses. |
| Who owns conversion-capability/catalog truth? | Rust, as a lifecycle keyed by the installation binding. |
| What identity binds those facts together? | One opaque, session-scoped, path-free `BackendBindingReceipt`. |
| Which of two answers is newer? | `BackendAuthorityRevision`, and nothing else. It orders; it never means. |
| May an `msconvert --help` probe launch now? | One `ConversionConfigurationProbeAdmission`, over backend-process ownership facts, decided by Rust's gate. |
| Who owns catalog request lifecycle and retry? | Rust owns the lifecycle state; the frontend initiates a read or a retry and owns neither. |
| What does React retain? | The selected intent id, request-in-flight for rendering, Rust's plan answer, the revision and receipt of what it is rendering, and presentation. Nothing else. |
| At what granularity does availability exist? | The admitted **row** — one composition. There is no per-value availability authority. |
| What makes a pre-run plan current? | Ordered handles, intent id, conflict policy, binding receipt, document epoch — compared against Rust's own answer. |
| What must be established before BEGIN reserves anything? | The current binding has proved the exact selected intent executable. Mandatory, never a courtesy. |

## The failure shape, before the decisions

Sixteen live findings stand on PR #95 — five of them at outdated diff positions,
all read — plus four committed STOP records. Read as
a list they look like sixteen defects in six files. Collapsed by *what made each
one possible*, they are seventeen semantic families and almost all of them are
one of four shapes:

**A fact and the thing that carries it come apart.** A request outlives the state
it produced; an observation is lost because the operation carrying it failed; a
reply is ordered against a number that does not mean what its name says.

**A signal is read from a proxy that resembles it.** `backendUsable` stands in
for "the catalog is invalid"; "a reply carried a higher generation" stands in for
"something was observed"; `appliedGeneration` stands in for "a verdict settled".

**A fact about one thing is asserted about another.** A row-level refusal
rendered per value; one reason owned by two DOM elements; a plan `loading` with
no request behind it.

**A fact is established and never delivered.** An operation resolves the
installed build, records what it found, and then answers with only its refusal —
so the session is correct in Rust and stale on screen. This one was found in the
first draft of *this* document rather than in PR #95, which is the point: it is
the same shape one layer out, and a boundary that only says who *owns* a fact has
not yet said who is obliged to *carry* it.

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
third leaves the authority alone.

The current implementation already treats absence as an answer rather than as a
gap, though its mechanics are narrower than that: after a prior observation,
changing from an installed identity to `None` is a different resolution and
advances the counter; the *first* observation records that a look happened
without necessarily incrementing anything. That is evidence about what exists
today — it is **not** the normative semantics of `BackendAuthorityRevision`
below, which advances whenever the projected state changes, including from
`Unresolved`. The replacement does not inherit today's first-observation quirk;
it inherits the idea that absence is something one can observe.

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

## Decision 4 — a conversion operation observes, records and *reports* its binding

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

### Recording it is only half. The response must carry it.

Updating the authority and then returning a bare refusal leaves the session
**correct in Rust and stale on screen**, which is the same defect one layer out:

```text
frontend shows Ready(A) and Plan(A)
BEGIN(A)
  -> Rust resolves B, records B, refuses on the exact-intent proof
  -> no reservation, no queue, no picker
  -> the frontend receives only an error
  -> Ready(A) and Plan(A) stay on screen
  -> the reader may press an action Rust is now certain to refuse, for ever
```

A refused `BEGIN` creates no queue, so there is no slot to poll and nothing else
arrives to correct it. That is the same structural hole the queue-level
generation could not cover during M6.4's first attempt, reproduced at the
contract level: the number existed and the refusal path did not carry it.

So the rule is stated in full:

> **Every conversion-bound operation that can observe installation authority
> returns the authority as it stands when the operation answers — whether its
> domain outcome succeeds or refuses.**

What it returns is a *projection of the authority*, not a receipt, and the
difference matters at exactly one point: `Unresolved` has no binding and
therefore no receipt, and a contract demanding one would force the very first
discovery failure either to invent an observation or to omit a required field.

```text
BackendAuthorityProjection {
    revision: BackendAuthorityRevision
    state:
        Unresolved
      | Binding {
            binding: Installed | NoInstallation
            receipt: BackendBindingReceipt
        }
}

AuthorityObserved<T> {
    authority: BackendAuthorityProjection
    outcome: T
}
```

Production names remain the replacement implementation's; the obligation does
not. The rules the projection must obey:

```text
initial discovery establishes nothing
  -> authority.state = Unresolved
  -> no receipt is invented

an existing binding A, and a later operation establishes nothing new
  -> the authority is still A
  -> the response projects the current A

an operation observes B
  -> Rust records B first
  -> the response projects the current B
```

**A domain failure never forces an observation into existence, and never erases
one.** Those are the two halves of the same rule, and each was a finding: the
second on PR #95's `?` discarding an identity discovery had already found, the
first on this document's own first draft demanding a receipt where the model
says there is none.

This is not `BEGIN`-specific. It applies to every conversion-bound operation that
may observe a replacement or a loss — the configuration read, the preflight,
queue execution and drain, retry preparation, and whatever is added next. The
caller never needs an error-kind allowlist or a `retryable` heuristic to decide
whether to go and look, because **the observation travels with the answer**.

*Alternative considered and rejected:* classify the error. An allowlist of error
kinds, or a `retryable` heuristic, puts a second installation authority on the
caller and silently misses the next error kind. It was proposed twice during
PR #95 and declined both times; recording it here means it does not have to be
declined a third.

## Decision 4b — order the projection first, then compare the receipt

**Two questions, and one field cannot answer both.** *Is this answer newer than
what I am showing?* is ordering. *Does this catalog belong to the installation I
am bound to?* is identity. A receipt is opaque and equality is its whole
interface, so a receipt can answer the second and never the first: replies cross
the boundary out of order, and

```text
rendered   = B
late reply = A
A != B
```

proves a mismatch, not that A supersedes B. Invalidating on inequality alone
would let a delayed answer about the build the session has already left revoke
the build it is on, and send it to read a snapshot for a binding that is gone.

So Rust authors the order, and the frontend applies it in two steps.

**Step one — ordering, by revision only.**

```text
incoming.revision <  rendered.revision  -> stale; discard the projection entirely
incoming.revision == rendered.revision  -> the same authoritative publication
incoming.revision >  rendered.revision  -> accept this Rust-authored projection
```

**Step two — identity, by receipt only, and only on a projection just accepted.**

```text
the accepted projection's receipt differs from the rendered one
  -> configuration and plan for the rendered binding are non-current, immediately
  -> no conversion action stays enabled from them
  -> read the Rust-owned ConversionConfigurationSnapshot for the new binding
  -> render only the snapshot that carries it

the accepted projection carries the same receipt
  -> nothing about the installation changed
  -> the configuration is not invalidated, and no probe is spent

the accepted projection is Unresolved
  -> there is no receipt to compare; there is no binding to hold a
     configuration, so no configuration is current
```

Both halves of step two are load-bearing. The first closes the stale-on-screen
window above. The second is what keeps a refusal from becoming a refresh: an
ordinary refusal on an unchanged binding — two rows that would write one name, a
queue over capacity — must not spend a help probe, which is the error-triggered
reread loop PR #95 declined twice. A projection whose *presentation* changed
while its binding did not is accepted by step one and changes nothing in step
two.

### `BackendAuthorityRevision`, and why it is not the model that was rejected

The revision is a typed monotonic token with **exactly one** meaning to the
frontend:

> a projection with a lower revision is stale and cannot replace one with a
> higher revision.

Rust owns it. It advances when the projected authority state actually changes —
`Unresolved` becoming `Installed` or `NoInstallation`, one binding replaced by
another, or an authority-state transition that changes what is projected even
where the receipt stays equal. A same-installation recheck that produces the same
authoritative state does not advance it.

It is emphatically **not** the design this ADR exists to remove. That one exposed
a bare counter and let React derive *observed*, *attempted*, *applied* and
*settled* from arithmetic over it — four meanings the number never carried, each
added because the previous round's reading could not answer the next round's
question. This token carries one meaning, it is the only one React may take from
it, and React may not infer any of those four from it: whether something was
observed, whether a verdict settled, whether a configuration was attempted and
whether one is ready all remain Rust-authored typed state, delivered as such.
Comparing two revisions to discard a late reply is not reconstructing meaning; it
is doing what a sequence number is for.

**A must not survive while B is being established.** The gap between invalidating
A and receiving B's snapshot is a truthful `loading` or `blocked` state, never the
previous build's catalog left on screen and never a silent fall back to the
shipped posture. The user's chosen intent identity is preserved across the gap and
restored into B's catalog wherever B still holds that row — including where B
holds it as unavailable, which is Decision 8's rule and not a new one.

An observed `NoInstallation` receipt is a receipt like any other: it differs from
A, so it invalidates A on arrival, and the snapshot it establishes is the one that
says this session has no usable build.

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

Every entry and exit is written out, because a state named without them is a
state an implementer has to guess at — and the natural guess here is the one that
reintroduces `backendUsable` as the thing that drives a catalog:

```text
BackendAuthorityState = Unresolved
  -> no binding exists, so there is no configuration lifecycle entry at all
     (not UnavailableForBinding: that is a statement about a binding)

Binding = NoInstallation { receipt }
  -> UnavailableForBinding { binding }
  -> no msconvert help probe is attempted; there is nothing to probe

Binding = Installed { receipt }
  -> the lifecycle begins at Unattempted { binding }

Unattempted, Installed
  -> a configuration read that answers    -> Ready  { binding, catalog }
  -> a configuration read that does not   -> Failed { binding, error }

Failed
  -> only an explicit settings retry spends another attempt

Ready / Failed / UnavailableForBinding, same receipt
  -> the state is retained; a recheck alone never causes a second probe

the receipt is replaced
  -> the previous configuration is non-current immediately, whatever it was
  -> the new binding's state is initialized from what it is:
         Installed      -> Unattempted
         NoInstallation -> UnavailableForBinding

receipt replaced mid-request
  -> the stale reply cannot become current
```

**`UnavailableForBinding` is entered from the binding and from nothing else.** It
says *this session is bound to no installation, so there are no conversion
semantics to describe* — a fact about the binding, not a preview verdict. It is
not entered because `backendUsable` went false, and it is not a place a build
that previews badly ends up: a build may be truthfully unusable for preview while
its conversion configuration is `Ready`, which is Decision 3's whole point. Using
the preview verdict to enter it would rebuild the conflation ledger row 6 exists
to remove.

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
none
blocked
loading { request identity }
ready   { plan }
failed  { request identity, error }
```

Total enough to implement from, including the successful path the first draft
listed no transition into:

```text
no rows requested
  -> none

rows requested, but no plan question can be posed
(no configuration, no usable selected intent)
  -> blocked, never loading

a plan question is posed and its request is issued
  -> loading { that request's identity }

the in-flight request answers, and the answer is for that identity
  -> ready { plan }

the in-flight request fails, for that identity
  -> failed { identity, error }

handles, intent, conflict policy, binding receipt or document authority
change, and a replacement request is issued
  -> loading { the replacement's identity }

any of those change while no replacement request is yet eligible
  -> blocked

a ready or failed answer stops describing the current question
  -> it may not continue to stand for it; the rules above decide what replaces it
```

Two invariants govern the whole table, and each is a finding:

```text
no loading without a request actually in flight
no failed described as "rereading" unless a replacement request exists
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

## Decision 11 — one admission rule for any `msconvert --help` probe

PR #95's last round produced a second-answer shape of its own: the explicit
catalog retry consulted a lane rule and the automatic read did not. One question
—

> may a catalog probe launch now?

— has one answer, whoever asks. Automatic first read and explicit retry may
differ in *initiation*, never in *admission*. If a queue owns the backend, the
request is deferred or truthfully refused; an unbounded hidden probe is never
enqueued behind it.

### It is not `ConversionLane`, and that was the error in the first draft

`ConversionLane` answers *may a conversion action start?* — a question that
begins with `backendUsable`, a preview verdict. A configuration probe asks
something else: *may another backend process begin right now?* Making the lane
the probe authority puts a preview verdict in the permission path for an
`msconvert` probe, which contradicts Decision 3, and puts a frontend struct in
the authority position, which contradicts Decisions 5 and 13.

```text
conversion action availability   is not   configuration-probe admission

both consume shared backend-process ownership facts
neither is authority for the other
```

So the probe gets its own named rule:

```text
ConversionConfigurationProbeAdmission
```

**The definitive authority is Rust's backend process gate and its quarantine
boundary.** A configuration probe is backend process work, and Rust refuses it if
the frontend's projection is wrong or stale — the projection is a courtesy that
keeps the interface from offering an action that is known to be refused, never a
permission.

### The exact subset, stated once

The projection consults only facts that name an operation genuinely owning a
backend process, and thus genuinely conflicting with launching another:

```text
a backend installation check or change is in progress
the session is backend-quarantined
a preview run or scan is being read
a conversion owns the backend lane
another configuration probe is already in flight
```

and deliberately not:

```text
the preview "usable" verdict            -- a judgement, not process ownership
adoption                                 -- owns no backend process
diagnostics export                       -- owns no backend process
other workspace settling                 -- owns no backend process
```

That split is drawn from what actually takes the one gate on the current tree:
`inspect_backend`, `use_installation`, `open_preview`, `interpret_spectrum` and
`drain_queue` do; `adopt_conversion_outputs` and
`begin_conversion_diagnostics_export` do not. If the replacement finds that
ownership has moved, it records the ownership it measures rather than preserving
this list — the rule is *facts that own a backend process*, and the list is that
rule applied to today's code.

**Automatic and explicit consume the same rule.** The first configuration read
for a binding and an explicit settings retry differ in what *initiates* them —
one is the lifecycle reaching `Unattempted`, the other is a reader pressing a
control — and in nothing else. There is not an automatic probe rule and a retry
probe rule; there is one, and both ask it. That asymmetry is ledger row 17, and
stating the subset once is what closes it.

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
the authority revision of the projection it is currently rendering
the binding receipt carried by that projection, where one exists
ordinary presentation state
```

React does **not** own reconstructed authorities for installation observation
watermarks, an applied generation, an automatic reconciliation quota, a settled
binding, a catalog-served binding, or catalog-generation ordering.

**Retaining two tokens is not owning an authority**, and Decision 4b needs the
difference stated rather than assumed. React holds the revision and the receipt
that arrived *on the projection it is showing*, each for exactly one purpose: the
revision to discard a reply that is older than what is on screen, the receipt to
notice that a newer reply describes a different installation. It does not order
receipts, does not derive meaning from a revision, does not hold either for
anything it is not currently rendering, and does not reconstruct *observed*,
*settled*, *attempted* or *ready* from them — all four remain Rust-authored typed
state that arrives as such.

Two rendered facts travelling with the thing they describe is the opposite of the
watermark set this decision removes: those were four independent numbers the
frontend maintained *about* an authority it could not see, and their disagreement
was the defect.

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

## One answer per question, and one question per field

The defect this ADR exists to remove is a question with two answers. So the
vocabulary is small enough to check exhaustively, and the check is written down
rather than left to a reader:

| Question | The one thing that answers it |
|---|---|
| What is the current installation authority? | `BackendAuthorityProjection`, Rust-authored |
| Is this response older than what is rendered? | `BackendAuthorityRevision`, compared, nothing else |
| Does this catalog or plan belong to the installation I am bound to? | `BackendBindingReceipt` equality, nothing else |
| Is conversion configuration unavailable, unattempted, ready or failed? | The Rust configuration lifecycle, delivered as typed state |
| May an `msconvert --help` probe launch now? | `ConversionConfigurationProbeAdmission` |
| Is there a real plan request, answer or failure? | The plan state machine |
| May a conversion action start? | `ConversionLane`, unchanged from M6.1 |

Read the other way, no field appears twice. The receipt does identity and never
ordering; the revision does ordering and never meaning; the lifecycle says what
the configuration *is* and never whether a probe may run; the probe rule says
whether a process may start and never whether a conversion may; `ConversionLane`
keeps the question it has always had. Where two of these consume the same
underlying fact — a conversion owning the backend gate is both a reason no probe
may launch and a reason no conversion may start — they consume it, and neither
becomes the other's authority.

## The state graph the replacement implements

**Nothing resolves at all.** Authority `Unresolved(r0)` → a configuration request
attempts discovery → discovery establishes neither an installed build nor an
absence → the authority is still `Unresolved(r0)` → the response projects
`Unresolved(r0)` and whatever its domain outcome was → **no receipt is invented**,
and there is no binding to hold a configuration.

**The first installed observation.** `Unresolved(r0)` → `Installed A` is observed
→ revision `r1 > r0`, receipt A → configuration `Unattempted(A)`.

**Healthy mount.** Settled binding A → configuration `Unattempted(A)` → probe
admission permits a read → `Ready(A, catalog)` → SHIPPED selected → plan for A.

**The build goes away.** Binding A → `NoInstallation B` is observed → new receipt
B on a newer revision → A's configuration and plan are non-current immediately →
configuration for B is `UnavailableForBinding`, and nothing is probed, because
there is nothing to probe.

**A configuration retry.** `Installed A`, configuration `Failed(A)` → the reader
takes the explicit settings retry → the binding is unchanged, so no authority
change is required or expected → the configuration lifecycle alone decides
`Ready(A)` or `Failed(A)` again.

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

**BEGIN is the first thing to see the replacement, and refuses.** This is the
case the authority-delivery rule exists for, and it is written out in full
because every part of it is an obligation:

```text
Ready(A) + Plan(A)

BEGIN
  -> the provider resolves B
  -> the Rust installation authority records B
  -> the exact-intent preflight refuses
  -> no queue
  -> no reservation
  -> no picker
  -> no staging
  -> no conversion process
  -> the response still projects the current authority: B, at a newer revision

frontend
  -> the revision is newer, so the projection is accepted
  -> its receipt differs from A
  -> Ready(A) is invalidated
  -> Plan(A) is invalidated
  -> ConversionConfigurationSnapshot(B) is read, once, through the ordinary
     lifecycle
  -> the selected admitted intent identity is preserved wherever B's catalog
     still holds that row
  -> B's own row availability is what is rendered
```

Nothing here is reachable through an error-kind allowlist, and nothing here needs
one: the receipt arrives on the refusal, and its difference from A is the whole
of the signal. The same transition holds when what B names is `NoInstallation` —
the receipt still differs, A is still invalidated on arrival, and the snapshot
that follows is the one saying this session has no usable build.

**A refusal that changes nothing changes nothing.** The mirror case belongs
beside it: `BEGIN` refused on unchanged binding A — a name collision, a queue over
capacity — projects the current A at its current revision, so the configuration
and the plan stay exactly as they are and no probe is spent. A refusal is not a
reason to re-read the installation; a newer projection carrying a *different
receipt* is.

**A delayed reply about the build the session has left.** The frontend already
renders B at revision `rB`; a slow reply arrives projecting A at `rA < rB`.

```text
rA < rB
  -> the projection is discarded as stale, entirely
  -> B is NOT invalidated
  -> no snapshot is read for A
  -> the reply's domain outcome is still the answer to the request that made it
```

Receipt inequality alone would have done the opposite here — revoked the build
the session is on and gone to read a snapshot for one it has left. Ordering
first, identity second, is what makes the two questions separable.

**Backend lost after BEGIN, before execution.** Binding A reserved → the
provider's resolution observes the loss → the authority records it → execution
refuses → **that refusal carries the new receipt**, and the next state read
carries it too → A's catalog and plan cannot remain current. The delivery rule is
not `BEGIN`-specific, and this is the path that shows why: the queue exists here,
so a poll would eventually carry the news, but the operation that *found* it
answers first and is not permitted to answer silently.

**Plan blocked.** No configuration or no selected intent → no plan request → no
"Reading the conversion plan…".

**Plan failure.** The request actually failed → failed state, with the error and
what the reader can change → never "please wait while this is reread".

## Semantic finding ledger

Every live PR #95 finding and STOP record, collapsed by what made it possible,
plus the findings raised against this document's own drafts (rows 18–30).
This is the handoff: the replacement implementation proves the right-hand column,
and no finding may disappear because the old PR was superseded.

| # | Family | What permitted it | Required invariant | Owner | Replacement acceptance case |
|---|---|---|---|---|---|
| 1 | Admitted graph duplicated or widened | A frontend able to compose axis values | The admitted table is the only compatibility rule | Rust (`ConversionIntent::ADMITTED`) | No TS from which a nine-row graph could be rebuilt; 39 combinations unreachable by any activation sequence |
| 2 | Preserved unsupported selection unrecoverable | One-axis editing plus a preserved choice, with no escape | A genuine dead end offers one explicit atomic recovery | Selection module | Dead end offers the shipped row; a reachable one-axis route offers no recovery block |
| 3 | Catalog outlives the backend it described | Catalog lifetime keyed on nothing that expires | A replaced receipt revokes the configuration bound to the old one | Rust configuration lifecycle | A binding observed as `NoInstallation` → the previous configuration is gone, without waiting for a verdict |
| 4 | In-flight obsolete catalog resurrects state | Revoking rendered state without revoking the request | Revocation is one act over state and request | Rust configuration lifecycle | A reply about a superseded binding cannot install |
| 5 | BEGIN observes a changed build, nothing reconciles | An observation made by an operation that then refused | An observation is complete once discovery establishes an installed binding **or** an absence; later capability or domain failure does not erase it | Provider attempt + authority | A refused BEGIN that resolved a new build advances the authority |
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
| 18 | A refused operation records a new binding and reports none | Recording an observation without delivering it | Every conversion-bound answer carries the receipt it observed or left current | `AuthorityObserved<T>` | A `BEGIN` refused on the exact-intent proof, having been the first to resolve B, returns B |
| 19 | Old configuration usable after a newer binding arrives | Invalidation waiting for something later than the arrival | A newer projection carrying a differing receipt invalidates on arrival, before any further action | Frontend, ordering then identity | `Ready(A)` and `Plan(A)` are non-current, and no action is enabled from them, before the next interaction is possible |
| 20 | The replacement's configuration read twice, or not at all | Ad-hoc refresh paths beside the lifecycle | Exactly one snapshot per newly observed binding, through the ordinary lifecycle | Rust configuration lifecycle | One `ConversionConfigurationSnapshot(B)` is established; the gap before it is a truthful loading state, never A's catalog and never a silent SHIPPED |
| 21 | A refusal becomes a refresh | Treating any error as installation news | An unchanged receipt is not a reason to re-read | Frontend, ordering then identity | A refusal projecting the current A spends no probe and changes no configuration |
| 22 | A lost build leaves its catalog on screen | Absence not modelled as a binding | `NoInstallation` is a receipt and differs from A | Authority + frontend comparison | An observed `NoInstallation` revokes A on arrival, exactly as a replacement does |
| 23 | React classifies errors to decide whether to reconcile | The observation not travelling with the answer | No error-kind allowlist and no `retryable` heuristic anywhere in React | Frontend contract | Reconciliation is decided by the projection alone — revision, then receipt; nothing inspects what failed |
| 24 | `UnavailableForBinding` entered by guesswork | A state named with no entry or exit | It is entered from a `NoInstallation` binding and from nothing else, and left only when the receipt is replaced | Rust configuration lifecycle | A build that previews badly but converts fine is `Ready`, not `UnavailableForBinding`; a session bound to no installation probes nothing |
| 25 | Two probe-admission rules | An authority for conversion actions reused for process admission | One named `ConversionConfigurationProbeAdmission`, over backend-process ownership facts only, with Rust's gate as the decider | Rust gate + one frontend projection | The automatic first read and the explicit retry are refused identically under each admitting fact, and `backendUsable` is not one of them |
| 26 | `Unresolved` forced to fabricate an identity | A wire contract demanding a receipt every state can supply | The response projects the authority, which may be `Unresolved` and then carries no receipt | `BackendAuthorityProjection` | A first discovery that establishes nothing answers with `Unresolved` and invents nothing |
| 27 | A delayed reply rolls the authority backwards | Equality asked to do ordering's work | Ordering is `BackendAuthorityRevision` and identity is the receipt; neither answers the other's question | Rust-authored revision | A late projection at a lower revision is discarded whole; the rendered binding survives and no snapshot is read for the stale one |
| 28 | A revision read as meaning | One token carrying an ordering and a semantics | The revision's only frontend meaning is staleness; observed, settled, attempted and ready arrive as typed state | Frontend contract | Nothing in React derives an authority state from a revision comparison |
| 29 | The plan reaches no successful state | A machine with no transition into `ready` | Every state has an entry, and a matching answer reaches `ready { plan }` | Plan state machine | A plan request that answers for its own identity renders the plan; one that fails renders the failure |
| 30 | The route record contradicts itself | An amended ADR left reading as though it were not | ADR 0043 records the M6.4A amendment, links ADR 0044, and keeps its original decisions and date | ADR 0043 metadata | Its status, amendment note and `Related` name ADR 0044, and its chain wording matches ROADMAP |

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
