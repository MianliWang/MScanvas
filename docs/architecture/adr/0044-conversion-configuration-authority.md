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
| Who is obliged to deliver it? | Every operation that can observe **or replace** it, on its answer, whether that answer succeeds or refuses. |
| Who owns conversion-capability/catalog truth? | Rust, as a lifecycle keyed by the installation binding. |
| What identity binds those facts together? | One opaque, session-scoped, path-free `BackendBindingReceipt`. |
| Which of two answers is newer? | `BackendAuthorityRevision`, and nothing else. It orders; it never means. |
| May an `msconvert --help` probe launch now? | One `ConversionConfigurationProbeAdmission`, over backend-process ownership facts, decided by Rust's gate **and its quarantine boundary**. |
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

**A `Partial` discovery is `NoInstallation`.** The union has two members because
the fact it names is binary — *is this session bound to an installation it may
launch?* — and the answer is `AvailabilityState::Available`, which is exactly the
condition `bind_help_of` already *requires* before it will bind anything. A folder holding msconvert.exe and no
msaccess.exe, a mismatched pair, a timed-out probe: each is `Partial` or
`Unavailable`, so each is `NoInstallation`, and the binding needs no third member
for the ways that can happen.

**It is not derived from `InstallationIdentity::of` returning `Some`,** and a
draft of this document said it was, wrongly. `ToolIdentity::resolved` needs only a
path, and an evaluated candidate always has one, so `of` yields an identity for a
`Partial` build as readily as for a whole one. That is correct for what an
identity is for — it answers *are these the same files as before*, a content
question — and it is why the binding may not be minted from it. An implementer who
took `of`'s `Some` as the test would bind a `Partial` build as `Installed` and
send a probe at a build the backend has already refused.

The trap that comes with it is a sentence, not a state: `NoInstallation` must
never be rendered as "ProteoWizard is not installed", because a `Partial` build
plainly is. It means *this session is bound to no usable installation*, and the
reason a reader is shown comes from the discovery failure the preview surface
already owns and already words correctly — never from the binding tag, which
carries no reason at all.

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
- **stays equal** through a same-installation recheck, and equally through a
  repeated observation of no installation: the fact it names is the binding, so
  a session that stays unbound keeps one `NoInstallation` receipt however many
  discoveries confirm it, and a `Partial` build becoming a different `Partial`
  build replaces nothing;
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
preview availability      -> both tools resolve to one installation, and
                             msaccess declares every required preview operation
conversion configuration  -> msconvert's ConversionIntent capability grammar
```

Stated precisely, because the looser version — "preview is msaccess, conversion
is msconvert" — is not what the code does. `AvailabilityState::Available`
requires `msconvert.exists && msaccess.exists && same_installation &&
overall_failure.is_none()`, and the provider then narrows it further by asking
*msaccess's* grammar for the required preview operations. So the two judgements
share a discovery, share an installation, share the requirement that both
executables be present, and share the requirement that **both** help probes
succeeded — `overall_failure` carries msconvert's failure too. What they do not
share is **which grammar is interrogated**.

That is a narrower split than it first appears, and the narrowing matters,
because it rules out the example a draft of this document reached for. "Msconvert
help cannot be read" is *not* a preview-usable session: discovery runs `msconvert
--help` itself, and a probe that fails to launch, times out, exits unacceptably or
returns no release metadata lands in `overall_failure`, so the build is not
`Available` and `bind_help_of` refuses before any capability parse. The split is
still real, and these are the states that reach it:

```text
msconvert's help probe was accepted, but its bound capability parse refuses
  -> preview is unaffected: it parses msaccess's grammar, not msconvert's
  -> the configuration is Failed (capability_evidence_unavailable)

msconvert's grammar is intact but admits no row for the chosen intent
  -> preview is unaffected
  -> the configuration is Ready, and the selected row is unavailable

the build changed between the preview verdict and the catalog read
  -> the read's own discovery is no longer Available, so it establishes
     NoInstallation: the authority is replaced, not the configuration
  -> the old binding's configuration is revoked with the binding
  -> the new binding's configuration is UnavailableForBinding, unprobed
```

The third is a binding replacement wearing a configuration read's clothes, and
naming it `Failed` would have been a third way to spend an attempt on something no
probe ever asked — the mistake ledger row 32 already forbids one level down.
`Failed` means a probe ran against a binding and did not answer. A read whose own
discovery refuses never reaches a probe; it reports a different binding.

The first is the load-bearing one, and it is reachable because acceptance and
parsing are different steps: discovery stores a bound help probe once the exit and
metadata are acceptable, and only `parse_bound_help` — later, on a stream that may
have been truncated — decides whether a capability grammar can be extracted from
it at all.

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
what that comment warns against. The preview path learned the lesson and the
conversion path did not inherit it, and three separate findings are that `?` at
work: an identity discovery had already found, discarded because the operation
carrying it failed.

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

the operation answered without discovering at all
  -> nothing is observed; nothing is invented
```

The third arm is not a fourth discovery outcome — there is no such thing, since
`Available`, `Partial` and `Unavailable` map totally onto the two bindings. It is
the case where **no discovery ran**: the operation refused ahead of it, as
`inspect_backend` does in a quarantined session, or the request failed before
reaching one. The authority is then unchanged, which for a session that has never
discovered means `Unresolved` — the state rows 26 and 31 are about, reached
without anyone inventing a receipt to describe it.

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

> **Every operation that can observe or replace installation authority returns
> the authority as it stands when the operation answers — whether its domain
> outcome succeeds or refuses.**

"Conversion-bound" would have been too narrow by exactly the two operations that
*replace* a binding rather than merely notice one: the backend check and the
installation change. Both already answer with a verdict, and both must answer
with the authority that verdict established, or choosing a different ProteoWizard
folder would leave `Ready(A)` and `Plan(A)` on screen with nothing obliged to
correct them — the same stale window, reached through the one path a reader takes
deliberately.

What it returns is a *projection of the authority*, not a receipt, and the
difference matters at exactly one point: `Unresolved` has no binding and
therefore no receipt, and a contract demanding one would force the very first
discovery failure either to invent an observation or to omit a required field.

```text
BackendAuthorityProjection {
    revision: BackendAuthorityRevision
    state:
        Unresolved
      | ObservedButUnsettled { binding: Binding }
      | Settled             { binding: Binding, previewAvailability }
}

AuthorityObserved<T> {
    authority: BackendAuthorityProjection
    outcome: T
}
```

**One response carries one projection.** `ConversionConfigurationSnapshot` is this
shape specialised for the configuration read — its `authority` field *is* the
`AuthorityObserved` authority — and is never additionally wrapped in one. Applying
both uniformly would nest a projection inside a projection with no stated
equality, which is the self-contradicting shape ledger row 36 forbids one level
down.

`Binding` is Decision 1's, unchanged and not restated: `Installed { receipt }` or
`NoInstallation { receipt }`. The receipt lives inside it, in exactly one place,
so there is one shape for the union Rust owns and one place a comparison reads
from.

**A settled `NoInstallation` holds no preview verdict to speak of, and nothing may
read one out of it.** `previewAvailability` is a judgement about a build, so for a
binding that names no build it is entailed rather than judged, and Rust — the only
author of this projection — settles it as unusable. The frontend does not take it
on trust: `backendUsable` is `Settled` **and** `Installed` **and** the verdict, a
conjunction in which the impossible pairing cannot be reached even if one were
somehow constructed. (Forking the union so the field exists only on the `Installed`
arm would make it unrepresentable outright, and is deliberately not done: it costs
the single-shape property ledger row 38 bought, for a value nothing can author but
Rust and no reader can reach past the conjunction.)

**`ObservedButUnsettled` carries no `previewAvailability`, and that is a claim
about the session, not an omission.** An operation that noticed a new binding
without computing a preview verdict leaves the session genuinely between verdicts:
the old one described a different build and may not be reused, and no new one
exists yet. `ConversionLane` is unchanged and still needs a boolean, so one half of the
projection is fixed: **while the authority is `ObservedButUnsettled`,
`backendUsable` is false.** Claiming otherwise would reuse a verdict belonging to a
different build, and refusing as `backend-unavailable` would state a verdict this
session does not hold.

The reason needs deciding with it, and leaving it to the lane's existing ordering
does not work: `unavailableReason` ranks `!backendUsable` *above* `laneClaimed`
and `previewReading`, so a drain or a preview read holding the gate would produce
`backend-unavailable` — the verdict this session does not hold — rather than the
lane fact underneath it. Two drafts of this paragraph got that wrong in opposite
directions, so the choice is stated with its cost rather than asserted.

**Locked choice: while the authority is `ObservedButUnsettled`, the lane is
`backendChanging` as well as not usable.** `backendChanging` ranks above
`!backendUsable`, so it is the one that reaches the reader; it is the only word in
M6.1's shipped vocabulary that describes the session's *binding* rather than
passing a verdict on the build; and its refusal reads as transient and
self-clearing, which is exactly what an unsettled state is.

**Its cost, recorded rather than hidden:** `backendChanging` is documented as "an
installation check or change owns the backend lane", and while the obliged check
is owed but refused, no check owns the lane — something else does. The word
overstates by that much. It is still the least wrong sentence available, and
correcting the vocabulary belongs to the same M6.1 scope already recorded below
for the msaccess/msconvert conflation — not to M6.4.

**And it must not be wired to probe admission, which is the deadlock this choice
would otherwise create.** Today `backendChanging: backendBusy`, one flag, and
Decision 11's first admitting fact is worded the same way. Feed the unsettled
state into both and the state that *owes* the check becomes the fact that
*refuses* it: unsettled sets changing, changing refuses admission, admission
never lets the check run, and rows 39, 42 and 49 deadlock on the one path they
exist to keep open. So the two readers take two facts, and this is the ADR's own
thesis applied to itself:

```text
ConversionLane.backendChanging  -- a check is in flight, OR the authority is
                                   ObservedButUnsettled   (what the reader is told)
admission's "a check is in progress"
                                -- a check is in flight, and nothing else
                                                          (what refuses a probe)
```

One word survives on screen because the reader needs one sentence; underneath it
there are two facts, and the narrower one is the one with authority over a
process.

And the state owes an exit. **Entering `ObservedButUnsettled` obliges exactly one
backend check**, issued in the same commit that installs the authority, and — when
it cannot be — owed on the same terms as the first configuration read: it stays
owed, and every authority delivery is an occasion to issue it.

**The owing is shared; the admission is not.** These two obligations are refused
by different things, and conflating them would put the check under a rule it
cannot obey. A configuration probe is a courtesy — `msconvert --help`, taken with
`try_enter_backend`, refused rather than queued, governed by
`ConversionConfigurationProbeAdmission` (Decision 11). The backend check is
`inspect_backend`, which is M6.1's, takes the gate by *waiting*, and is a duty: it
is the operation that ends the unsettled state, and there is nothing else to end
it with. So the frontend does not dispatch it while its lane projection says
something owns the backend — the same courtesy that keeps every other action from
being offered into a refusal — and Rust's quarantine boundary is the one
definitive refusal it answers to. What the two obligations share is the
owed-and-discharged rule below, not an admission rule.

**An obligation is owed only while the thing refusing it can stop refusing.** This
is the rule for both obligations, and it has to be stated, because the same
admission that defers a probe under a held gate *permanently* refuses one in a
quarantined session — quarantine is set once and never cleared until restart. An
obligation that survived a permanent refusal would be owed for the life of the
session and re-asked at every delivery, forever, and one that a refusal discharged
outright would strand the ordinary case a moment's contention creates. So:

```text
admission defers  (a gate held, a probe in flight)  -> still owed; re-issue later
admission refuses permanently  (quarantine)         -> discharged; there is
                                                       nothing to wait for
the operation ran and answered                      -> discharged
```

A check can also answer without discovering, and that discharges it too: an
authority still `ObservedButUnsettled` afterwards is a true description of a
session that will not get a verdict, not a state to keep retrying into. The reader
is not misled by it: quarantine
outranks every other reason in the lane's ordering, so what they are told is
quarantine, not that a binding is settling. The two obligations are one mechanism asked twice, which is what keeps
the scenarios below — a `BEGIN` refused after observing a replacement, an
installation change that refuses, a replacement noticed mid-drain — from parking
the panel with no verdict and nothing obliged to produce one.

**The projection carries the authority state, not a flattened stand-in for it.**
Collapsing `ObservedButUnsettled` and `Settled` into one member — and dropping
`previewAvailability` with them — would leave a receipt that stayed equal while
the state moved, and nothing but the revision to tell the difference. The
frontend would then have to infer *whether a verdict has settled* from an
ordering token, or join it out of a second payload, which is precisely the
reconstruction Decisions 1, 4b and 13 exist to remove. The union that Rust owns
is the union that crosses.

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
nothing is rendered yet                 -> accept; this is the first publication
incoming.revision <  rendered.revision  -> stale; discard the projection entirely
incoming.revision == rendered.revision  -> the same publication already accepted;
                                           the rendered authority stands
incoming.revision >  rendered.revision  -> accept this Rust-authored projection
```

The first line is the bootstrap, and it is not a special case so much as the
absence of one: with nothing rendered there is no revision to be older than, so
the first projection a session receives is accepted and step two runs against an
empty rendered binding — which is how the first binding is installed at all.

**These two steps govern the authority projection, and nothing else.** A response
carries an outcome as well, and the outcome is the answer to the request that
asked for it: a configuration read that succeeds on an unchanged binding answers
at an unchanged revision, and discarding it because the authority did not move
would throw away the very snapshot the frontend asked for. The outcome is
installed on its own terms, subject only to the binding-payload rule below — a
payload bound to A is never installed while B is rendered.

**Step two — identity, by receipt only, and only on a projection just accepted**
(the first line above included; an equal revision changes nothing and skips it).

**Step three, and it is not conditional on either of the first two — every
delivery is an occasion to discharge an owed obligation.** This is deliberately
outside the ordering rules, because the case rows 39 and 42 exist for is precisely
the one the ordering rules dismiss: a gate holder finishes, nothing about the
binding changed, so the revision is equal and the receipt is equal and both steps
above correctly do nothing — and that is exactly the moment the owed first
configuration read and the obliged backend check become admissible. So after
ordering and identity have had their say, the frontend asks one more question,
unconditionally: is an obligation owed for the binding now rendered, is nothing in
flight for it, and does admission allow it? Invalidation is what steps one and two
decide. Issuing is not invalidation, and a binding that has never been read must
not be kept unread by a rule about binding that did not change.

```text
the accepted projection's receipt differs from the rendered one
  -> configuration and plan for the rendered binding are non-current, immediately
  -> no conversion action stays enabled from them
  -> read the Rust-owned ConversionConfigurationSnapshot for the new binding
  -> render only the snapshot that carries it

the accepted projection carries the same receipt
  -> nothing about the installation changed
  -> the configuration is not invalidated, and nothing already answered
     is re-read
  -> its authority state is rendered as it arrived: a move from
     ObservedButUnsettled to Settled on the same receipt is news about the
     preview verdict and about nothing else

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
  -> a probe ran and answered             -> Ready  { binding, catalog }
  -> a probe ran and did not answer       -> Failed { binding, error }
  -> a probe could not start              -> Unattempted, unchanged

Failed
  -> only an explicit settings retry spends another attempt

Ready / Failed / UnavailableForBinding, same receipt
  -> the state is retained; a recheck alone never causes a second probe

the receipt is replaced by an operation with no catalog to offer
  -> the previous configuration is non-current immediately, whatever it was
  -> the new binding's state is initialized from what it is:
         Installed      -> Unattempted
         NoInstallation -> UnavailableForBinding

the receipt is replaced by the configuration read that then answers for it
  -> the previous configuration is non-current, exactly as above
  -> the new binding lands on what its own answer supports:
         a probe ran and answered       -> Ready  { B, catalog }
         a probe ran and did not answer -> Failed { B, error }
         B is NoInstallation            -> UnavailableForBinding
  -> Unattempted is never rendered: it was never true of this binding

receipt replaced mid-request
  -> the stale reply cannot become current

probe admission refuses while Unattempted
  -> stay Unattempted; nothing is queued behind the lane
  -> the first read is still owed, and is re-issued on the next authority
     delivery that finds admission available

probe admission refuses an explicit retry while Failed
  -> stay Failed; no probe launches
  -> the retry remains available to take again later
```

**`Unattempted` is an obligation, not a resting state.** Refusing the automatic
read must not strand it, and nothing about a held gate is self-clearing from the
frontend's side — so the stimulus is named rather than left to a timer. Every
operation that owns the gate delivers authority when it answers (Decision 4), and
every such delivery is an occasion to ask whether the one first read is still owed
and admission now allows it. The operation that was holding the gate is therefore
the operation that releases the read, and a binding cannot reach a state where its
catalog is owed, nothing is in flight, and nothing will ever ask again.

The explicit retry is the reader's floor under that. It is offered whenever a
binding has no answer and no probe is in flight — from `Failed`, and equally from
an `Unattempted` whose automatic read was refused — because a control that says
"read the settings" is truthful in both, and the alternative is a panel a reader
can see is stuck with nothing to press.

**A read that finds a new build answers for that build, in one step.** A
configuration read performs its own discovery, so it can be the operation that
observes a replacement — and if that replacement is `Available`, the very same
call probes it and returns its catalog. Ordering the two halves as separate events
would mean either discarding a catalog that describes exactly the binding now
current, or letting `Ready` arrive for a binding the lifecycle had just reset to
`Unattempted`. The same holds when the probe against B *fails*: routing that
through `Unattempted(B)` would leave an obligation outstanding for a binding whose
one attempt has just been spent, and a second automatic probe would follow
immediately. Observation and answer are one transaction, and the state that
lands is the one the answer supports.

**Transient process contention is not a failed read.** A configuration attempt is
spent when a probe *ran* and did not answer, never when one could not start: a
conversion holding the backend lane says nothing about what the installed build
offers. Turning contention into `Failed` would spend the binding's one automatic
attempt on a queue, and leave the reader with a retry control as the only way
back from something that was never asked.

Neither arm introduces a second frontend fact. Whether the first read has already
been spent is answered by the Rust-owned configuration state itself —
`Unattempted` says it has not — which is why no `attempted` ref is needed
alongside it.

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
    authority: BackendAuthorityProjection
    configuration:
        NoBinding
      | ForBinding {
            state: UnavailableForBinding
                 | Unattempted
                 | Ready  { catalog: admitted rows, shipped intent identity }
                 | Failed { error }
        }
}
```

**The receipt appears once, in the authority.** `ForBinding` describes the
binding the authority in the same snapshot names, and carries no second copy of
its identity: two copies with no stated equality would make a self-contradictory
snapshot representable — one binding's authority beside another's catalog — and
the frontend, comparing the projection's receipt, would install the wrong one.

`NoBinding` is the member the authority makes necessary. `Unresolved` is a state
this session really reaches — the first discovery that establishes nothing leaves
it there — and a snapshot that demanded a binding would have no representable
answer for it, leaving only the two exits ledger rows 24 and 26 forbid: invent a
receipt, or route it to `UnavailableForBinding`, which is a statement about a
binding that does not exist. `NoBinding` says the true thing: nothing is
installed *or not installed* yet, so there is no configuration to describe.

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
I change this one axis?* — and Decision 7 fixes what those answers are. Worked
against the real `ADMITTED` table, from centroided / all spectra / 64–64 / zlib on
a build lacking only the peak-picking grammar, the six one-axis edits that keep
centroided do **not** answer alike:

```text
precision -> 32/32       -> row exists (K12), unavailable on this build
precision -> 64/32, 32/64 -> not qualified: no admitted row, on any build
population -> MS1, MS2    -> not qualified: no admitted row, on any build
compression -> off        -> not qualified: no admitted row, on any build
processing -> not centroided -> row exists, available: the way out
```

Only two of the eight admitted rows compose processing with anything, which is why
five of those six are statements about the product's evidence rather than about
this installation — and why the reader is not told the same sentence six times.

That is the point, and it is about **blame** rather than selectability. No control
says "64-bit intensity is not offered", because none of them is being asked
whether 64-bit intensity is offered; the unavailability belongs to the
combination, is stated once at settings level, and the axis that can leave it is
the one that shows a way out. Saying instead that "64/64 remains selectable" would
have contradicted Decision 7 outright, since holding 64/64 while centroided stays
selected is a lookup that never comes back available.

A four-times-repeated per-value unsupported message is explicitly rejected.

Graph recovery from PR #95 is preserved unchanged: the choice survives; ordinary
controls are the recovery wherever one one-axis target row is available; only a
genuine one-axis dead end may offer the explicit atomic "use the settings
MSCanvas ships" action; and that action is never a silent fallback.

## Decision 9 — the plan has an explicit state machine

```text
none
blocked
loading { request identity, request }
ready   { plan }
failed  { request identity, request, error }
```

**`request` is a per-panel ordinal, and it is why a retry is safe.** The identity
says *which question*, and a retry asks the same one by design (ledger row 35) — so
identity alone cannot tell a superseded request's late reply from the retry's, and
the machine would install the answer it just decided to discard. The ordinal rises
on every plan request the panel issues, whatever its identity, and a reply is
installed only when identity *and* ordinal both match what is loading.

Counting per *question* rather than per panel would have reintroduced the defect
one identity away: leave an identity with a request in flight, come back to it, and
its count starts again at a value that in-flight reply already carries. One
counter, never reset, is what makes "the next ordinal" mean the same thing in
every transition below. It is the same separation
Decision 4b draws one layer up: identity does not do ordering, and ordering does
not do identity.

Total enough to implement from, including the successful path the first draft
listed no transition into:

```text
no rows requested
  -> none

rows requested, but no plan question can be posed
(no configuration, no usable selected intent)
  -> blocked, never loading

a plan question is posed and its request is issued
  -> loading { that request's identity, the next ordinal }

a reply arrives for the loading identity **and** its ordinal, and it answers
  -> ready { plan }

a reply arrives for the loading identity **and** its ordinal, and it failed
  -> failed { identity, ordinal, error }

a reply arrives for any other identity or any earlier ordinal
  -> discarded; the state does not move

failed, and the reader asks for the same question again
  -> loading { the same identity, the next ordinal }

handles, intent, conflict policy, binding receipt or document authority
change, and a replacement request is issued
  -> loading { the replacement's identity, the next ordinal }

any of those change while no replacement request is yet eligible
  -> blocked

blocked, and the fact that blocked it stops holding
  -> loading { the now-eligible identity, the next ordinal }

a ready or failed answer stops describing the current question
  -> it may not continue to stand for it; the rules above decide what replaces it
```

**`blocked` is not a terminal state either, and its exit is not an identity
change.** A plan is blocked because something it needs is missing — no catalog
yet, a selected row this build cannot run — and the usual way that stops being
true is that the configuration reaches `Ready` on the *same* binding, with every
identity component unchanged. A machine that left `blocked` only on an identity
change would pin the plan for exactly the session that just succeeded in reading
its settings. The cause is re-evaluated whenever a fact it named changes, and a
request is issued the moment one becomes eligible.

**A failed plan has a way out that does not require changing the question.** A
plan can fail for a reason the reader cannot act on — an IPC that did not come
back, a read that lost a race — and a machine whose only exit from `failed` is a
new plan identity would pin `Convert` as refused for the session over a transient
error, while the refusal beside it says the reader can act. That is the same
shape as the catalog's own retry, and it gets the same answer: an explicit
request re-asks the *same* question, and nothing automatic does.

Two further invariants govern the whole table, and each is a finding:

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

**The probe takes the gate with `try_enter_backend`, and never waits on it.**
`enter_backend` blocks, so a probe dispatched a moment before a drain claims the
gate would sit behind the whole conversion and surface minutes later against a
binding that may no longer exist — the unbounded hidden probe this decision exists
to forbid, arriving through the mechanism meant to prevent it. The non-blocking
form is documented for "work that is a courtesy rather than a duty… nothing that
*must* happen may use this", and a single probe attempt is exactly that: the
*catalog* must eventually be read, but no individual attempt must succeed, because
a refused one stays owed and is re-issued on the next delivery. That is what the
obligation machinery above buys — it is what makes refusing safe, and therefore
what makes not waiting possible.

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

The split is structural, not a list to keep in sync: **a fact belongs on the first
side exactly when Rust would itself refuse a backend process for it** — which on
the current tree is two things, not one. The gate is taken by the backend check
and the installation change, by the preview and spectrum reads, by the queue's
drain and by the conversion entry points that resolve a build, and it is not taken
by `adopt_conversion_outputs` or `begin_conversion_diagnostics_export`, which is
why adoption and diagnostics appear on the second side. Quarantine is the other
half: `require_usable_backend` refuses before the gate is ever reached, so a
criterion written as "takes the gate" alone would have dropped the one entry on
the list that no waiting can clear, and admitted a probe in a session that has
lost track of a converter process of its own.

The replacement derives membership from what Rust refuses, not from this
paragraph; what is normative here is that criterion, in both its halves.

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
decisions for every action currently offered and deduplicates **by the refusing
fact, not by the word each authority uses for it.** Child components never mint a
global availability id.

The key matters because two vocabularies now reach this registry: `ConversionLane`
refuses a conversion, `ConversionConfigurationProbeAdmission` refuses a probe, and
they are disjoint word-sets over an overlapping set of facts. A conversion holding
the backend gate is one fact, refusing two actions, and a registry keyed on the
reason word would emit two notices for it — which is the defect ledger row 13
names, reintroduced through the seam this ADR itself opened.

So the key is named, not left to be inferred. **The facts are `ConversionLane`'s
own fields**, which already enumerate every way backend work is refused, and both
authorities map their refusal onto one of them:

```text
backendQuarantined | backendChanging | backendUsable | laneClaimed
| previewReading | adopting | exportingDiagnostics | workspaceSettling
```

All eight, `backendUsable` included — it is shared by every conversion action and
by nothing else, and omitting it would have left the one refusal two actions reach
most often with no key at all.

`ConversionLane` maps by construction — its reason *is* the first field that
refuses, in its own fixed order, and that order is the registry's precedence too,
so one fact refusing two actions cannot render two sentences in a contested
sequence. `ConversionConfigurationProbeAdmission` maps its refusals onto the same
names, which it can, because Decision 11's admitting subset was drawn from these
fields in the first place. Only a refusal with no lane fact behind it mints a key of its own: a
configuration probe already in flight, which no conversion action can share, and
the action-derived reasons, which name a target rather than a lane fact. Those
last are keyed by action *and* target, and need no cross-action deduplication
because no two actions can be refused by one of them — a missing target is a fact
about the action asking. (The alternative — namespaced
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

`ConversionLane` is unchanged, and that is a decision with a residual worth
stating rather than a claim that the split is finished. `backendUsable` is a real
precondition for starting a conversion — no resolved pair, no process to launch —
so it stays the lane's third refusal. What Decision 3 removes is its use as the
authority for the *catalog* and the *plan*: those are keyed on the binding, and a
`Ready` catalog with a truthful plan may be rendered beside a Convert control the
lane refuses.

The residual is the narrow case where those two disagree for a reason the reader
cannot see: both executables resolve to one installation, msconvert's grammar
admits the selected row, and the preview verdict is nonetheless unusable because
*msaccess* lacks a required preview operation. The lane then refuses as
`backend-unavailable` — a sentence about preview, offered as the reason a
conversion cannot run. **This ADR does not fix that, and does not license the
replacement to fix it**: the lane's refusal vocabulary is M6.1's, and rewriting it
is scope M6.4 does not own. It is recorded here so that the next milestone to
open that lane finds the case already diagnosed, and so that no reader mistakes
"unchanged from M6.1" for "already correct".

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
available. *If* the shipped row is itself available, the explicit atomic recovery
is offered; if it is not, nothing is offered, because a control that selects a
row this build cannot run would be an action Rust is certain to refuse. The
availability of the shipped row is a condition on offering the recovery, not a
step that follows from reaching the dead end.

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
  -> the reply's domain outcome is still the answer to the request that made
     it -- an error to show, a refusal to explain -- but any *binding-bound
     payload* it carries is subject to the same rule as the projection: a
     snapshot or plan for A cannot be installed under B
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
plus the findings raised against this document's own drafts (rows 18–62).
This is the handoff: the replacement implementation proves the right-hand column,
and no finding may disappear because the old PR was superseded.

| # | Family | What permitted it | Required invariant | Owner | Replacement acceptance case |
|---|---|---|---|---|---|
| 1 | Admitted graph duplicated or widened | A frontend able to compose axis values | The admitted table is the only compatibility rule | Rust (`ConversionIntent::ADMITTED`) | No TS from which a nine-row graph could be rebuilt; 39 combinations unreachable by any activation sequence |
| 2 | Preserved unsupported selection unrecoverable | One-axis editing plus a preserved choice, with no escape | A genuine dead end offers one explicit atomic recovery, when the shipped row is itself available | Selection module | Dead end with an available shipped row offers it; a reachable one-axis route offers no recovery block; a dead end whose shipped row is unavailable offers nothing |
| 3 | Catalog outlives the backend it described | Catalog lifetime keyed on nothing that expires | A replaced receipt revokes the configuration bound to the old one | Rust configuration lifecycle | A binding observed as `NoInstallation` → the previous configuration is gone, without waiting for a verdict |
| 4 | In-flight obsolete catalog resurrects state | Revoking rendered state without revoking the request | Revocation is one act over state and request | Rust configuration lifecycle | A reply about a superseded binding cannot install |
| 5 | BEGIN observes a changed build, nothing reconciles | An observation made by an operation that then refused | An observation is complete once discovery establishes an installed binding **or** an absence; later capability or domain failure does not erase it | Provider attempt + authority | A refused BEGIN that resolved a new build advances the authority |
| 6 | Catalog read tied to transient checking | `backendUsable` false for the duration of any probe | A check is activity; a binding is a verdict | Authority state | A recheck settling on the same receipt: no probe, no revocation, plan preserved |
| 7 | Repeated polls, repeated reconciliation | A reply carrying a number treated as a request | An arriving fact is not a request | Authority state | N polls of one observation → at most one backend probe |
| 8 | Catalog failure with no retry owner | Recovery living on a conflation that was removed | A failed read is not a state a binding can clear | Rust lifecycle + explicit retry | Transient failure → recheck does not retry it; explicit retry does |
| 9 | Provider-resolution failure loses the observation | `?` propagating an error past a found identity | Resolution returns the observation either way | `ConversionBackendAttempt` | Resolution failure that established absence advances the authority; one that established nothing does not |
| 10 | Mandatory preflight under an optional courtesy | A gate that may be declined owning a guarantee | Admission proof is never skippable | Rust BEGIN | Busy lane → BEGIN waits or refuses; never a queue without the proof |
| 11 | Selected-but-unavailable rendered as usable | A state that could hold only one of the two facts | Selected and available are two facts | Selection module | The preserved unrunnable selection reads as unavailable |
| 12 | Row incompatibility asserted per value | A row-level fact rendered against each axis value | Availability is a property of a composition | Selection module | A build lacking only peak-picking makes no false claim about 64/64, all spectra or zlib |
| 13 | Two owners of one availability reason | Each surface minting a global id | One reason, one notice element, deduplicated by the refusing fact rather than by either authority's word for it | Panel notice registry | No duplicate availability id under any refusal shared by two actions, including one fact refusing a conversion and a probe in two vocabularies |
| 14 | Plan `loading` with no request | One member standing for "in flight" and "never asked" | `loading` names an actual request | Plan state machine | No selected intent → blocked, and nothing claims a read |
| 15 | Failed plan described as reloading | A single non-current reason for four situations | A refusal names what the reader can change | Availability rule | A refused plan reads as failed, not as being reread |
| 16 | Backend loss during drain not recorded | The same `?` as #9, in the execution path | Every conversion-bound resolution observes | `ConversionBackendAttempt` | Loss while the picker is open advances the authority |
| 17 | Automatic read ungoverned, explicit retry governed | Two answers to "may a probe launch now?" | One admission rule for every probe | `ConversionConfigurationProbeAdmission`, decided by Rust's gate | Both paths refuse identically under a held lane, and neither mutates the configuration state |
| 18 | A refused operation records a new binding and reports none | Recording an observation without delivering it | Every answer carries the authority projection as it stands — which may be `Unresolved`, and is never a receipt the answer had to invent | `AuthorityObserved<T>` | A `BEGIN` refused on the exact-intent proof, having been the first to resolve B, returns B; a first discovery that establishes nothing returns `Unresolved` |
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
| 31 | `Unresolved` has no representable snapshot | A snapshot demanding a binding for a state that has none | The snapshot says `NoBinding` where there is no binding | `ConversionConfigurationSnapshot` | A session whose first discovery establishes nothing renders no configuration, invents no receipt, and is not called `UnavailableForBinding` |
| 32 | Contention spends the one automatic attempt | "A read that does not answer" catching a read that never ran | `Failed` requires a probe that ran; a probe that could not start leaves `Unattempted` | Rust configuration lifecycle | A configuration read refused by probe admission leaves the state unchanged and the first read still owed |
| 33 | The two operations that replace a binding owe nothing | A delivery rule scoped to conversion-bound work | Every operation that can observe **or replace** authority returns it | Authority delivery | Choosing a different ProteoWizard folder invalidates the previous configuration and plan with nothing else required |
| 34 | A stale reply's payload installed under a newer binding | Ordering applied to the projection but not to what it carries | A binding-bound payload obeys the same ordering as the projection that carries it | Frontend, ordering then identity | A late snapshot or plan for A cannot be installed while B is rendered |
| 35 | A transient plan failure is permanent | A `failed` state with no exit but a new question | An explicit request may re-ask the same plan question | Plan state machine | A failed plan can be retried without changing handles, intent, policy or binding |
| 36 | A snapshot that contradicts itself | The receipt carried twice with no stated equality | The receipt appears once, in the authority; the configuration describes the binding beside it | `ConversionConfigurationSnapshot` | No snapshot can pair one binding's authority with another's catalog |
| 37 | The first binding is never installed | An ordering rule defined only for a strictly newer revision | Nothing rendered accepts the first projection; an equal revision changes nothing and re-reads nothing | Frontend, ordering then identity | A session's first projection installs its binding, and a repeated projection spends no probe |
| 38 | Receipt comparison silently disabled | Two shapes for the one union Rust owns | `Binding` carries its receipt, in one place, wherever the union appears | Decision 1's union | Every comparison in the replacement reads the receipt from the same field |
| 39 | The first read is owed and never re-issued | An admission refusal with no named stimulus to try again | The read stays owed, and every authority delivery is an occasion to issue it; the retry is offered from `Unattempted` too | Rust configuration lifecycle + panel | A configuration read refused under a held gate is issued when the holder answers, and a reader is never left with a stuck panel and nothing to press |
| 40 | A probe launches in a quarantined session | A membership criterion written as "takes the gate" alone | Admission is what Rust refuses a backend process for: the gate **and** the quarantine boundary | `ConversionConfigurationProbeAdmission` | A quarantined session admits no probe, automatic or explicit, and says so with quarantine's own reason |
| 41 | `Partial` has no representable binding | A union read as installed-or-nothing while discovery has three outcomes | `Installed` is `AvailabilityState::Available` and nothing else; `Partial` is `NoInstallation`, and the tag carries no reason | Decision 1's union | A folder with msconvert and no msaccess binds as `NoInstallation`, probes nothing, and is never worded "ProteoWizard is not installed" |
| 42 | A binding is observed and never settles | An unsettled state with no obligation to produce a verdict | Entering `ObservedButUnsettled` obliges one backend check, owed and re-issued on the same terms as the first configuration read; until it answers the lane is not usable | Authority + `ConversionLane` projection | A replacement observed mid-drain claims no verdict, and its check is issued when the drain answers rather than waiting for a reader |
| 43 | The two judgements never actually diverge | A split justified by a state the code cannot reach | `Failed` is reached by a capability parse that refuses a probe discovery accepted | Decision 3 | A build whose msconvert help is bound but unparseable is preview-usable with a `Failed` configuration |
| 44 | A superseded plan reply installed by its own retry | A machine keyed on an identity a retry preserves by design | `loading` and `failed` carry a per-question ordinal, and a reply matches identity **and** ordinal | Plan state machine | A retry issued while an earlier request is in flight ignores the earlier reply, and the plan rendered is the one the reader asked for last |
| 45 | A projection nested inside a projection | Two contracts each carrying authority, with no rule for which applies | One response carries one projection; the snapshot's `authority` **is** the observed authority | Decision 4 + Decision 6 | The configuration read's response has exactly one authority field, and no equality rule is needed because there is nothing to disagree with |
| 46 | Repeated absence read as repeated replacement | Receipt stability defined only for a same-installation recheck | An unbound session keeps one `NoInstallation` receipt however many discoveries confirm it | `BackendBindingReceipt` | Two consecutive failed discoveries revoke nothing and re-probe nothing |
| 47 | A binding read as `Installed` on a refused build | The union derived from `InstallationIdentity::of` rather than from availability | `of` yields an identity for `Partial` too; the binding is minted from `Available` | Decision 1's union | A `Partial` build never reaches probe admission, because it never becomes `Installed` |
| 48 | The answer to a request discarded for not moving the authority | An ordering rule worded over the whole response | Ordering governs the projection; the outcome answers the request that asked for it | Frontend, ordering then identity | A successful configuration read on an unchanged binding is installed, not dropped for arriving at an equal revision |
| 49 | An owed obligation issued only when something changed | The deadlock break placed inside the rules its own case dismisses | Discharging an owed obligation is a third, unconditional step after ordering and identity | Frontend reconciliation | The delivery that breaks the deadlock carries an equal revision and an equal receipt, and still issues the read |
| 50 | An unsettled session claimed as verdict-bearing | `!backendUsable` outranking every lane fact beneath it | `ObservedButUnsettled` sets `backendChanging` as well, so the reader is told the binding is settling and not that the build is unusable | `ConversionLane` projection | An unsettled authority under a held gate never renders `backend-unavailable` |
| 51 | A refused discovery spending a configuration attempt | A read that cannot reach a probe reported as a probe that failed | A read whose own discovery refuses replaces the binding; `Failed` needs a probe that ran | Decision 3 + Rust lifecycle | A build that disappears between the verdict and the read is `NoInstallation` → `UnavailableForBinding`, not `Failed` |
| 52 | The state that owes the check is the fact that refuses it | One `backendChanging` flag read by both the lane and probe admission | Admission reads only a check actually in flight; the lane's word may also mean an unsettled authority | Decision 11 + `ConversionLane` projection | An `ObservedButUnsettled` session with nothing else holding the gate admits its obliged check |
| 53 | An obliged check re-issued against a refusal that never clears | An obligation discharged only by settling | An answered check discharges it, settled or not | Authority obligations | A quarantined session issues its check once, stays truthfully unsettled, and is told quarantine rather than that a binding is settling |
| 54 | An obligation owed against a refusal that cannot clear | One rule for deferral and permanent refusal | Deferred obligations stay owed; permanently refused ones are discharged | Authority obligations | A quarantined session asks once and stops; a session behind a held gate asks again when it clears |
| 55 | A probe waiting out the conversion it lost a race to | The one gate taken by waiting | The probe takes it with `try_enter_backend` and never queues | `ConversionConfigurationProbeAdmission` | A probe dispatched just before a drain refuses immediately and stays owed, rather than surfacing after the conversion |
| 56 | A fresh catalog discarded, or `Ready` arriving over `Unattempted` | Observation and answer ordered as two events | A read that observes a new available binding answers for it in one transaction | Rust configuration lifecycle | A configuration read that discovers build B returns `Ready(B)`, and `Unattempted(B)` is never rendered |
| 57 | Two notices for one refusing fact | A registry key left to be inferred across two vocabularies | The key is a `ConversionLane` field, and its order is the precedence | Panel notice registry | A conversion holding the gate renders one sentence, whether it refused a conversion, a probe, or both |
| 58 | An unbound session projected preview-usable | A verdict field on a binding that names no build | The verdict is entailed for `NoInstallation`, and `backendUsable` requires `Installed` in the conjunction | Decision 4 projection | No `NoInstallation` authority, settled or not, yields a usable lane |
| 59 | The obliged check governed by a rule it cannot obey | Two obligations given one admission | The owing is shared; the probe is a courtesy under `try_enter_backend`, the check is `inspect_backend`, a duty | Authority obligations + Decision 11 | The check is not dispatched into a busy lane and not refused by probe admission; quarantine is its one definitive refusal |
| 60 | A rebinding read whose probe failed left owing another | One transaction with only a successful arm | The new binding lands on what its own answer supports, `Failed` included | Rust configuration lifecycle | A read that discovers B and fails its probe is `Failed(B)`, and no second automatic probe follows |
| 61 | The ordinal reset by leaving an identity | A counter scoped per question | One per-panel ordinal, never reset | Plan state machine | A reply in flight from before an identity was left and re-entered is discarded, not installed |
| 62 | The most-shared refusal left without a key | A key set listing seven of eight lane fields | `backendUsable` is a key; action-derived reasons key by action and target | Panel notice registry | Convert and both retries refused as unusable render one sentence |

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
