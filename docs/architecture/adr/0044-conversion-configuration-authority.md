# ADR 0044 — Conversion configuration is a Rust-owned authority, bound to a receipt

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

## The twelve questions, answered

The replacement implementation must not have to invent any of these while
coding.

| Question | Answer |
|---|---|
| Who owns installation truth? | Rust, as a typed authority state — never a bare counter the frontend interprets. |
| Who is obliged to deliver it? | Every operation that can observe **or replace** it, on its answer, whether that answer succeeds or refuses. |
| Who owns conversion-capability/catalog truth? | Rust, as a lifecycle keyed by the installation binding. |
| What identity binds those facts together? | One opaque, session-scoped, path-free `BackendBindingReceipt`. |
| Which of two answers is newer? | `BackendAuthorityRevision`, and nothing else. It orders; it never means. |
| May the conversion configuration read run now? | One `ConversionConfigurationProbeAdmission`, over backend-process ownership facts, decided by Rust's gate **and its quarantine boundary** — for the automatic first read and the explicit retry, not every `--help` a gated operation runs, and not a read for a binding that launches no probe at all. |
| Who owns catalog request lifecycle and retry? | Rust owns the lifecycle state; the frontend initiates a read or a retry and owns neither. |
| What does React retain? | The selected intent id; request-in-flight for rendering; per-obligation bookkeeping (in flight, and whether an occasion has passed since — never a judgement that one is *owed*, which Rust's state makes); the never-reset plan request ordinal; the Rust-authored configuration snapshot it is rendering, catalog included; Rust's plan answer, with its identity's receipt for the life of the plan; the revision and receipt of what it is rendering; and presentation. Nothing else. |
| May the obliged backend check be issued now? | The same predicate the configuration read asks — process ownership, never a verdict about a build. The two differ in what a refusal means, not in what they ask. |
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
  | Settled { binding, previewAvailability }

Binding
  | Installed      { receipt }
  | NoInstallation { receipt }
```

**There is no third member, and an earlier draft of this document had one.** It
added `ObservedButUnsettled` for the case where an operation resolves the installed
build but no preview verdict has settled for it — the state the counter could not
express, approximated today by an inequality between two frontend watermarks. The
approximation is real; the state is not, and the tree is why.

Every observation of a binding comes from a `discover()` the observer is already
holding: `bind_help_of` runs one and takes the identity from it,
`PreviewProvider::availability` runs one and takes the verdict from it, and every
`note_resolved` call site is downstream of one or the other. The verdict is a *pure
function of that same `DiscoveryResult`* — msaccess's stored help probe, parsed for
the required preview operations — so it costs no process, no gate and no second
round trip. An observation that has a binding always has a verdict available to it.

Making them travel together is therefore a matter of returning what is already
computed, and it removes a great deal: a state that could not name a reason, a
backend-check obligation to leave it, a `backendUsable`-false window that suppressed
every conversion action, the spectrum lane and three automatic preview loads, and a
masking defect that window created. **A binding and its verdict arrive together, and
the authority is `Unresolved` until the first one does.**

**A `Partial` discovery is `NoInstallation`.** The union has two members because
the fact it names is binary — *is this session bound to an installation it may launch?*
— and the answer is `AvailabilityState::Available`, which is exactly the condition
`bind_help_of` already *requires* before it will bind anything. A folder holding
msconvert.exe and no msaccess.exe, a mismatched pair, a timed-out probe: each is
`Partial` or `Unavailable`, so each is `NoInstallation`, and the binding needs no third
member for the ways that can happen.

**Every observer mints it the same way, and today two of them do not.**
`bind_help_of` refuses anything but `Available` and then takes the identity, which
is the rule above. `PreviewProvider::availability` takes the identity only when the
narrower preview `usable` also holds — folding the verdict into the identity, with
a comment that is right about preview provenance and wrong as a binding rule. The
consequence is exactly the case Decision 3 exists for: a build that is `Available`
with an msaccess help missing one required preview operation is `Installed(A)` to
the catalog read and `NoInstallation` to the obliged check, so the binding
oscillates between them and revokes the catalog on every cycle — and row 24's
"preview-unusable, conversion `Ready`" session can never be reached at all.

So the replacement takes the identity from the discovery, uniformly, and lets the
verdict travel beside it in `Settled`. That is this decision's whole thesis applied
to the one place the current tree fuses the two, and the fused comment's reasoning
is not lost: an unusable installation is still not one a *preview* could have come
from, which is a statement about the verdict, and the verdict is still carried.

**The binding is not derived from `InstallationIdentity::of` returning `Some`,**
and a draft of this document said it was, wrongly. `ToolIdentity::resolved` needs only a
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

**So `installationGeneration` leaves the wire, and this is stated as an
obligation rather than implied by the presence of a receipt.** It sits on five
contracts in `contracts.ts` today, and `useConversionOperation` reconciles the
queue's copy with each item's report by `Math.max` over the set — a frontend
deciding which of several numbers is the current installation, which is precisely
the defect this decision names. A replacement that adds the receipt and leaves the
counter beside it satisfies every other rule here and keeps the whole family
alive: two identities on one payload, one of them arithmetic. The field is removed
from every contract that carries it, and no comparison of installation identity
survives that is not receipt equality.

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

msconvert's grammar cannot express conversion at all
  -> require_conversion refuses: no outdir, no outfile, no zlib, no format
  -> preview is unaffected
  -> the configuration is Failed (conversion_capability_unavailable)

msconvert can convert, but no admitted row survives require_conversion_intent
  -> preview is unaffected
  -> the configuration is Ready, with a catalog in which every row is
     unavailable

the build is gone between the preview verdict and the catalog read
  -> the read's own discovery is no longer Available, so it establishes
     NoInstallation: the authority is replaced, not the configuration
  -> the old binding's configuration is revoked with the binding
  -> the new binding's configuration is UnavailableForBinding, unprobed
```

A build *replaced* rather than lost is not this case and does not land here: a
read whose discovery finds a different working installation establishes
`Installed(B)`, probes it, and lands on what its own answer supports — `Ready(B)`
or `Failed(B)`, by the one-transaction rule in Decision 5. `UnavailableForBinding`
is for a binding that names no build, and only for that.

**The build-is-gone case is a binding replacement wearing a configuration read's
clothes**, and naming it `Failed` would have been a third way to spend an attempt on
something no probe ever asked — the mistake ledger row 32 already forbids one level
down. `Failed` means a probe ran against a binding and did not answer. A read whose own
discovery refuses never reaches a probe; it reports a different binding.

**The no-row-survives case is representable, and its presentation is fixed rather
than its state.** A build whose baseline grammar is intact but which admits none of the
nine rows is genuinely `Ready`: a catalog was read and every row was judged, and the
judgements are true. What must not follow is nine individual refusals. It is a
settings-level statement — one sentence, exactly Decision 8's shape — and Decision 8's
atomic recovery is not offered, because row 2 already conditions it on the shipped row
being available and here it is not. The reader is told the build cannot run any
configuration MSCanvas offers, once, and no control implies otherwise.

**The cannot-convert-at-all case is `Failed`, not `Ready` with every row
unavailable**, and the
difference is the reader's recovery rather than bookkeeping. `Ready` means a
catalog was read and each row was judged; a build missing `outdir`, `outfile`,
`--zlib` or the format option offers no row at all, and rendering that as nine
individually unavailable rows would blame nine compositions for one missing
option, offer nine dead controls, and put Decision 8's dead-end recovery in front
of a reader for whom no target exists. One sentence and a retry is the truthful
shape. It is also the rule Decision 7 already implies one level down: availability
is a property of a row, and a build that cannot convert has not got as far as
rows.

**The unparseable-help case is the load-bearing one**, and it is reachable because
acceptance and parsing are different steps: discovery stores a bound help probe once the
exit and metadata are acceptable, and only `parse_bound_help` — later, on a stream that
may have been truncated — decides whether a capability grammar can be extracted from it
at all.

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

The rule must hold for every operation that resolves an installation, which is
every operation that takes the backend gate — the configuration read, the BEGIN
preflight, queue execution and drain, retry preparation, the backend check and the
installation change, and the preview and spectrum reads — and anything added later
that joins them. The list is not a scope to be narrowed to the conversion path:
Decision 11's gate membership and this rule's membership are the same set, which
is what lets `Unattempted`'s stimulus below be stated as "every operation that owns
the gate delivers authority when it answers" without qualification. A preview read
that finishes is as much an occasion to issue an owed catalog read as a drain
is.

### The banner is a reader of this authority, not a second one

`BackendStatus` renders `BackendAvailabilityDto` today, which is the same fact this
decision moves — so leaving it on the old feed would open the stale window this
whole decision closes, in the one surface that exists to tell the reader which
build the session is on. A reply that observes a
replacement carries both the new binding and its verdict, and a banner still reading
the old feed would name the build the session has left and call it available, while
`backend-unavailable`'s own message sends the reader to look at it.

**So the banner reads both, and each for what it holds.** `BackendAvailabilityDto`
keeps everything the projection deliberately does not carry — the quarantine sentence,
the discovery failure, the origin of the installation, all of which
`quarantined_availability()` exists to keep truthful — and the banner goes on rendering
it. `BackendAvailabilityDto` **carries the receipt** in place of the
`installationGeneration` Decision 2 removes from it — the same substitution made on
every other contract, and the thing that makes the question below answerable at all.

What the projection adds is one thing: **whether what it is showing is current**,
which is receipt equality against the authority and nothing more.
That covers the whole block and not only the verdict — the release, the build date and
the origin describe a build as much as "available" does, and a banner that marked the
verdict superseded while still naming the left installation would close half the defect.
Between an observation and the reading that describes it, the banner presents the
entire reading as superseded rather than as fact. It does not report the left build as
available, it does not name it as the current one, and it loses none of the reason text
it has today.

**And that state owes its own exit, on the mount-time rule generalised.** A drain or
a refused `BEGIN` observes a new binding without producing a
`BackendAvailabilityDto` for it, so nothing would replace the superseded reading and
it would stand until a reader pressed Recheck by hand. So: **a rendered reading whose
receipt is not the authority's owes a backend check**, which is exactly the
obligation `Unresolved` incurs at mount — same admission, same occasions, same
discharge — asked of one more condition. A session that has never resolved anything
and a session whose banner describes a build it has left are the same problem, and
they get the same answer.

The banner gains no authority of its own by this. It renders what arrives, which is
what it does now — from one more source, for one more question.

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
      | Settled { binding: Binding, previewAvailability }
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
on trust: the authority contributes `Settled` **and** `Installed` **and** the
verdict, a conjunction in which the impossible pairing cannot be reached even if
one were somehow constructed.

**Quarantine must reach `backendUsable` explicitly, because today it reaches it by
a route this decision removes.** There is no quarantine conjunct on the current
tree: `quarantined_availability()` short-circuits the whole availability DTO to
`unavailable`, and `backendUsable` is read off that DTO. Source the verdict from
the authority instead and `backendUsable` stops passing through that DTO, so the
short-circuit stops reaching it — a session quarantined after a good verdict keeps a
`Settled { Installed, usable }` authority that is perfectly true about the build and
says nothing about a converter process MSCanvas has lost track of.

**`quarantined_availability()` itself stays exactly as it is.** It is not the
route being removed; it is a function whose own doc comment explains what it
protects — the banner that keeps naming the installation the session was using,
and the refusal that keeps `inspect_backend` from launching help probes after
MSCanvas has lost a converter process. Nothing here touches it. What changes is
only that `backendUsable` no longer *depends* on it for the quarantine half of its
meaning, and says so itself.

So the projection is stated in full, and quarantine is a conjunct of its own:

```text
backendUsable = not quarantined
                AND authority is Settled
                AND its binding is Installed
                AND its previewAvailability is usable
```

which also puts each fact where it belongs — the verdict stays a statement about a
build, quarantine stays a statement about the session, and neither is expressed by
corrupting the other. `backendUsableRef` gates the automatic preview load as well as the
lane, and this is what keeps both unreachable in a quarantined session. (Forking the
union so the field exists only on the `Installed` arm would make it unrepresentable
outright, and is deliberately not done: it costs the single-shape property ledger row 38
bought, for a value nothing can author but Rust and no reader can reach past the
conjunction.)

**Every response that carries a binding carries its verdict** (Decision 1), so
`backendUsable` has an answer at every moment the authority has a binding, and there
is no window in which the session holds a binding and no judgement about it. That is
what keeps `ConversionLane` answerable without a new word and without a state that
disables the controls a reader would reach for.

**Nothing new is fed into `backendChanging`**, which keeps meaning exactly what it
means today: a check or change is in flight. Three drafts tried to widen it — to
cover a session between verdicts — and it cannot be widened, for a reason worth
recording since the pressure to try it will return. `backendChanging` is
`backendBusy`, one flag, and Decision 11's second admitting fact is worded the same
way; anything fed into it therefore refuses the very operations that would clear it.
The same flag also gates `BackendStatus`'s Choose-installation and Recheck, so a
session held in it loses the two controls a reader would reach for. A state that
disables its own exits is not a state to add, which is the second reason Decision 1
does not add one.

**The authority obliges a backend check in two conditions, and they are one rule.**
`Unresolved` owes one at mount: it is the state with no binding, so the liveness rule
below — written about bindings — does not reach it, and without this it would be the
one state a session could sit in with nothing obliged to move it and no control to
press. And a rendered `BackendAvailabilityDto` whose receipt is not the authority's
owes one too (Decision 4), because a binding observed by a drain or a refused `BEGIN`
produces no reading of its own and the banner would otherwise describe a build the
session has left until someone pressed Recheck. Both are the same obligation, admitted
like any other backend work and owed on the terms below if it cannot be issued.

**They do not share an acquisition with the configuration read, and a draft of this
document said they should.** The argument was row 115's, made for `BEGIN`: one
`DiscoveryResult` carries the verdict *and* msconvert's grammar, so two serial
acquisitions look like waste. It does not transfer. `BEGIN`'s two questions are both
asked inside `begin_conversion_queue`, under one `try_enter_backend`, so sharing costs
nothing and changes no discipline. The check is `inspect_backend` and takes the gate by
**waiting**; the configuration read is a courtesy and must not — Decision 11 and row 55
forbid a probe queueing on the gate — so a shared acquisition would put the courtesy on
the duty's lock, which is the one thing this document has been most careful to prevent.

The cost of not sharing is smaller than it looks. The 15-second `PROBE_TIMEOUT` is a
timeout, not a duration: a healthy `--help` returns in milliseconds, so an ordinary
mount pays two fast discoveries, and only a broken installation pays twice for being
broken — which is a session that has worse problems and is about to be told so.

**They share the admission and differ in what a refusal means.** An earlier draft
said the opposite — "the owing is shared; the admission is not" — and the document's own
definitions do not support it: both ask the same predicate over the same five
process-ownership facts, and neither asks `backendUsable`. What differs is what happens
when the backend is busy. A configuration probe is a courtesy — an `msconvert --help`
behind a discovery that probes both tools, taken with `try_enter_backend`,
**refused** rather than queued, which is why it needs the owed-and-re-issued
machinery at all. The mount-time backend check is `inspect_backend`, which is M6.1's
and takes the gate by **waiting**. The frontend declines to dispatch either while its
projection says the backend is owned — a courtesy in both cases — and where both are
owed at once the check goes first, since whichever starts holds the gate against the
other.

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

An operation can also answer without discovering, and that is not a fourth arm: it
follows the same rule as the three above, by whether what stopped it can stop. A
quarantined session refuses ahead of discovery permanently, so the obligation
discharges and an authority still `Unresolved` afterwards is a true description of a
session that will not get a binding — and the reader is not misled by it, because
quarantine outranks every other reason in the lane's ordering, so what they are told
is quarantine. A request that simply failed before reaching a discovery has stopped
nothing permanently, so its obligation stays owed and is re-issued on the next
occasion; discharging that one would leave a session `Unresolved` for its whole life
with nothing obliged to move it.

**The projection carries the authority state, not a flattened stand-in for it.**
Dropping `previewAvailability` from `Settled` — projecting a bare binding and
leaving the verdict to a second payload — would leave a receipt that stayed equal
while the verdict moved, and nothing but the revision to tell the difference. The
frontend would then have to infer *what the verdict is* from an
ordering token, or join it out of a second payload, which is precisely the
reconstruction Decisions 1, 4b and 13 exist to remove. The union that Rust owns
is the union that crosses.

Production names remain the replacement implementation's; the obligation does
not. The rules the projection must obey:

```text
nothing has been observed yet, or the first operation answered without
discovering at all
  -> authority.state = Unresolved
  -> no receipt is invented

an existing binding A, and a later operation observes nothing new
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

So Rust authors the order, and the frontend applies it in three steps.

**Step one — ordering, by revision only.**

```text
nothing is rendered yet                 -> accept; this is the first publication
incoming.revision <  rendered.revision  -> stale; discard the projection
                                           (the payload has its own rule)
incoming.revision == rendered.revision  -> the same publication already accepted;
                                           the rendered authority stands
incoming.revision >  rendered.revision  -> accept this Rust-authored projection
```

The first line is the bootstrap, and it is not a special case so much as the
absence of one: with nothing rendered there is no revision to be older than, so
the first projection a session receives is accepted and step two runs against an
empty rendered binding — which is how the first binding is installed at all.

**A response carries three things, and each is judged by its own rule.** Two
drafts tried to make one rule cover them, in opposite directions — discard
everything when the projection is stale, or judge every payload by the receipt its
request went out under — and each broke a case the other handled. They are
independent, and this document's own thesis says why: ordering never means, and
identity never orders.

```text
the projection  -> judged by REVISION alone
                   older than what is rendered -> discarded

the payload     -> judged by RECEIPT alone: the binding it describes against
   (a snapshot     the binding now rendered
    or a plan)     a different binding -> discarded
                   the rendered binding -> admitted, whatever the revision did
                   (a snapshot's receipt is read from the response's own
                    projection, which describes the same instant: Rust
                    builds both from one observation, under one hold of
                    the gate, so a catalog probed under A cannot travel
                    under a projection of B. See below: discarding the
                    projection is not throwing it away. A plan's receipt is part of the
                    question, not of the answer: the frontend asks for the
                    plan *under the binding it is rendering*, and Rust
                    echoes that identity back. `conversion_queue_plan` is
                    read-only, takes no gate and runs no discovery, so it
                    has nothing to observe and is asked to observe nothing;
                    it is outside Decision 4's delivery membership
                    and carries no projection to read one from)

                   a response whose projection is Unresolved names no
                   binding, so its payload is NoBinding, and NoBinding
                   installs only where the rendered authority is also
                   Unresolved -- a late mount-time snapshot never lands
                   on top of a Ready(A)

the outcome     -> judged by NEITHER
   (an error,      it answers the request that was made, and is shown to
    a refusal)     whoever made it. A reader's action surfaces its error;
                   an automatic read's refusal is bookkeeping, and moves
                   the obligation rather than the panel
```

The middle line is the one both drafts got wrong, and the case that shows it is
ordinary: a build that previewed badly is repaired in place, so a recheck settles on the
same receipt with a *different* verdict — which advances the revision, by the rule
below, because what is projected changed. A snapshot for B issued a moment earlier is
then stale by revision while describing exactly the binding on screen. Discarding it
leaves a `Ready(B)` binding with no catalog rendered and nothing owed to fetch one.
Judging it by the receipt installs it, correctly, because nothing about B changed.

That last distinction matters as much as the first two. A contention refusal is not
news for a reader who asked for nothing: Decision 5 already says such a refusal spends
no attempt and leaves the read owed, and surfacing it would put an error on screen for
a settings read the reader never requested. It moves the obligation. An explicit
retry's refusal, by contrast, answers a press, and is shown.

**A plan's binding is asked, not observed**, and that is what keeps
`conversion_queue_plan` honest without giving it a discovery it has no business
running. It cannot stamp from ambient authority — row 122 forbids a plan carrying a
receipt nothing observed for it — and it does not need to: the frontend already knows
which binding it is rendering, that receipt is part of the question by Decision 9, and
a reply is installed only where identity and ordinal both still match. A binding that
changed under the request makes the reply's identity stale, which is the same test the
plan machine already applies for every other component of the question.

**Admitted is not installed, for a payload that has an owner.** The receipt test
is necessary and not sufficient: it says a payload belongs to the binding on
screen, which is all a rule about bindings can say. A snapshot has nothing further
to satisfy and is installed. A plan then faces its own owner's test — Decision 9's
identity *and* ordinal — because "belongs to this binding" does not answer "is this
the answer to the question still being asked", and a retry preserves the binding by
design. Row 44 is not weakened by row 94; they test different things, in that
order.

**One response, one instant, and that is Rust's obligation rather than a hope.**
The delivery rule says a response carries "the authority as it stands when the
operation answers", which on its own would let a catalog probed under A ride out
under a projection of B — the payload rule would then admit it as B's. It cannot
happen because the two are built together: a configuration read holds the gate,
discovers, probes and projects from that one observation, and the projection it
returns is the one its own discovery established. The gate is what makes "as it
stands" mean "as this operation found it" rather than "as it happens to be at
serialisation time".

**"Discard the projection" means do not install it as the rendered authority**,
not delete the bytes it arrived in. The distinction matters because Decision 6 puts
the receipt in exactly one place — inside the projection — so a response whose
projection were genuinely thrown away would leave its payload with nothing to be
judged against, and row 94's case unimplementable. A stale projection is not an
authoritative statement about what the session is bound to *now*; it remains a
perfectly reliable statement about which binding *this response's payload*
describes, which is the only thing the payload rule asks it. One object, two
readings, and only the first is refused.

The rebinding read follows from the same line without an exception: a read issued
under A that answers `Ready(B)` alongside a projection of `Installed(B)` carries a
payload whose binding *is* the one now rendered, so it installs — one transaction,
one binding, one snapshot, and no second read owed.

**Otherwise these steps govern the authority projection, and nothing else.** A
response carries an outcome as well, and the outcome is the answer to the request
that asked for it: a configuration read that succeeds on an unchanged binding answers
at an unchanged revision, and discarding it because the authority did not move
would throw away the very snapshot the frontend asked for. The outcome is
installed on its own terms, subject only to the binding-payload rule below — a
payload bound to A is never installed while B is rendered.

**Step two — identity, by receipt only, and only on a projection just accepted**
(the first line above included; an equal revision changes nothing and skips it).

**Step three, and it is not conditional on either of the first two — every
occasion is an occasion to discharge an owed obligation.** This is deliberately outside
the ordering rules, because the case rows 39 and 42 exist for is precisely the one the
ordering rules dismiss: a gate holder finishes, nothing about the binding changed, so
the revision is equal and the receipt is equal and both steps above correctly do nothing
— and that is exactly the moment the owed first configuration read and the obliged
backend check become admissible. So after ordering and identity have had their say, the
frontend asks one more question: is an obligation owed — for the binding now rendered,
or by a session that has not resolved one at all — is nothing in flight for it, and may
it be issued? Invalidation is what steps one and two decide. Issuing is not
invalidation, and a binding that has never been read must not be kept unread by a rule
about a binding that did not change.

**"May it be issued" is one question for both**, over the process-ownership facts
and no verdict — Decision 4 states it, and states why the earlier reading that gave
them two predicates was wrong. What differs between them is what a refusal means,
which step three expresses as the duty-first ordering below rather than as a second
rule. Concretely the predicate is the lane's process-ownership fields plus the
frontend's own probe-in-flight
bookkeeping, which Decision 13 grants it and which has no lane field of its own; a
rule stated only over `ConversionLane` would not have been evaluable.

An in-flight probe is such a thing: it holds the gate, so it defers the check like any
other holder. That is not the collapse row 59 is about, and what it costs is bounded
rather than nothing — a probe is a discovery over both tools, so up to two 15-second
`PROBE_TIMEOUT`s, after which it terminates and its answer is a delivery that re-issues
what it deferred. `inspect_backend` would have queued behind it in any case, since it
takes the gate by waiting. What the two rules must not share is the courtesy's *refusal
semantics*: a probe refuses and stays owed, a check waits and runs.

**"Owns the backend process" is Decision 11's criterion, and it is not "the lane
refuses".** The distinction is the one that decision already draws between facts
that own a process and judgements that do not, and it has to be applied here
explicitly, because the lane's third refusal is `!backendUsable` — which a session
that has resolved nothing holds by definition. Gate the mount-time check on "the lane
is free" and the state that owes it is the fact that refuses it. A verdict about a
build owns no process; it can refuse an action, and it may never refuse the operation
whose job is to produce one.

**Quarantine, at this step, discharges rather than defers — but only what it can
actually stop.** The rule is about an obligation meeting a refusal that cannot
clear, and quarantine refuses *backend process work*: it cannot stop a
configuration read for a `NoInstallation` binding, which launches nothing and is
answered from the binding (Decision 5). That read is therefore never discharged by
quarantine, and a session that is quarantined and then loses its build still issues
it and still renders `UnavailableForBinding`. Discharge follows the same principle
as admission does — what owns a process — rather than applying to every obligation
in sight.

It is one of admission's five facts (row 40) and the lane's first refusal, and
neither rule is weakened by any of this — what changes is what an *obligation* does
when it meets a refusal that cannot clear. An obligation whose fulfilment needs the
backend is discharged the moment the session is quarantined,
whether it had been issued, deferred by contention, or not yet attempted: there is
nothing to wait for, and a session whose stop could not be confirmed will not get
another verdict this run. So a quarantined session makes at most one attempt and
then stops asking, rather than carrying an obligation it can never discharge —
which is what rows 53 and 54 require, and what an earlier draft's "issued once,
answered once" could not deliver for an obligation quarantine arrived *after*.

**And step three is bounded, because an unbounded one spins.** A refused attempt
answers, an answer is a delivery, and a delivery is an occasion — which closes a
loop at IPC speed against a frontend projection that is explicitly allowed to be
stale and permissive. The bound is per obligation, and both halves of that matter:

```text
each owed obligation is issued at most once per occasion, and where both are
owed the check goes first
  -- "occasion", not "delivery": Decision 5 adds a second kind, a lane fact
     going false, and the bound and the ordering govern both alike. A picker
     closing issues the check first, exactly as a drain answering does
  -- not "one obligation per occasion": an occasion finding both owed must
     leave neither stranded. But they cannot go together, because whichever
     starts holds the gate against the other -- so the duty is issued and
     the courtesy is deferred, which is the arrangement that resolves
     itself: the check answers, its answer is a delivery, and the read it
     deferred is issued by it
  -- and the ordering is only about the gate, so it does not reach a read
     that does not want one. A configuration read for a NoInstallation
     binding launches no probe, is answered from the binding, and is
     issued immediately -- deferring it behind a full discovery would
     leave the panel with no configuration state for that whole window,
     which is what rows 82 and 89 forbid

an obligation is not re-issued by its own refused attempt's answer, unless
another occasion has passed since that attempt was issued
  -- an occasion, again, and not a delivery: a picker cancelled while the
     refused probe's reply is still in flight is exactly the case, and it
     produces no delivery at all
  -- the first half is the loop: with nothing else having happened, the answer
     that refused it cannot be the occasion to ask again
  -- the second half is a reply arriving out of order. The gate holder finishes
     and delivers while the refused attempt's own reply is still in flight;
     that delivery sees the attempt in flight and issues nothing, and the
     refusal lands afterwards into a world that has already changed. One bit
     -- has anything been delivered since this attempt went out? -- separates
     the reorder from the spin

it IS re-issued by any other delivery, an obligation's included
  -- the obliged check holds the gate, refuses the read, and then answers;
     that answer is the occasion the read has been waiting for
```

The third line is the flagship case, and an earlier draft of this paragraph
excluded every obligation-produced delivery and starved it.

```text
the accepted projection's receipt differs from the rendered one
  -> configuration and plan for the rendered binding are non-current, immediately
  -> no conversion action stays enabled from them
  -> the new binding owes a configuration read; step three issues it, subject
     to admission and to the duty-first ordering, and step two dispatches
     nothing itself
  -> unless this very response already carries a snapshot for the new binding,
     in which case nothing is owed and nothing is issued
  -> render only the snapshot that carries it

     (the separation matters: step two decides what is *invalid*, and an
      imperative read here would put the courtesy ahead of the duty in the
      very case -- a BEGIN refused mid-drain -- where both obligations arise
      at once. It would not spend the attempt: a probe that cannot start
      spends nothing, by Decision 5 and row 32. The cost is the ordering,
      which is all row 92 needs it to be.
      And the exception is not an optimisation: without it, mount and every
      rebinding read cost two snapshots, and the second would contradict
      rows 20 and 56 by asking again for what the first already answered.
      A configuration read that observes a replacement *is* the read for
      the new binding.)

the accepted projection carries the same receipt
  -> nothing about the installation changed
  -> the configuration is not invalidated, and nothing already answered
     is re-read
  -> its authority state is rendered as it arrived: a new verdict on the
     same receipt is news about the build's preview grammar and about
     nothing else

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
  -> a probe ran, answered, and the build can convert
                                          -> Ready  { binding, catalog }
  -> a probe ran, answered, and require_conversion refuses
                                          -> Failed { binding, error }
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
  -> the new binding lands on what its own answer supports, by the same
     four-way discrimination the Unattempted arm uses:
         a probe answered and B can convert
                                        -> Ready  { B, catalog }
         a probe answered and require_conversion refuses
                                        -> Failed { B, error }
         a probe ran and did not answer -> Failed { B, error }
         B is NoInstallation            -> UnavailableForBinding
  -> Unattempted is never rendered: it was never true of this binding

receipt replaced mid-request
  -> the stale reply cannot become current

probe admission refuses while Unattempted
  -> stay Unattempted; nothing is queued behind the lane
  -> the first read is still owed, and is re-issued on the next occasion
     that finds admission available -- a delivery, or a lane fact going
     false (Decision 4b, step three)

probe admission refuses an explicit retry while Failed
  -> stay Failed; no probe launches
  -> the retry remains available to take again later
```

**`Unattempted` is an obligation, not a resting state.** Refusing the automatic
read must not strand it, so the stimulus is named rather than left to a timer, and
it has two halves because not every deferring fact belongs to an operation that
answers:

```text
any authority delivery
  -- every operation that owns the gate delivers authority when it answers
     (Decision 4), so the operation that was holding the gate is the one
     that releases the read

any transition of a lane fact the obligation was deferred on
  -- which the frontend observes in its own render, needing nothing from Rust
```

The second half is not redundancy. `laneClaimed` is true while the destination
picker is open, which owns no gate at all, and cancelling it clears the fact
without any backend operation running or answering — so a picker cancelled after a
`BEGIN` observed a replacement would strand both the owed check and the owed first
read, on a rule that waits for a delivery nothing is going to produce. A fact going
false is as good an occasion as an answer, and the frontend can see it without
being told.

Between the two, a binding cannot reach a state where its catalog is owed, nothing
is in flight, and nothing will ever ask again.

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
semantics to describe* — a fact about the binding, not a preview verdict.

**And it is answered without a probe, so nothing that guards a backend process
refuses it.** The rule governs a `msconvert --help` probe; a binding that names no
build launches none, and its configuration follows from the binding alone. Two
consequences, and the second is the one an earlier draft missed:

```text
probe admission does not apply    -- there is no probe to admit
the quarantine pre-check does not apply
                                 -- require_usable_backend guards operations
                                    that launch a process; this launches none
```

Without the second, a quarantined session bound to `NoInstallation` could never
render `UnavailableForBinding` at all: the read would be refused ahead of
discovery, its obligation discharged by quarantine's permanent-refusal rule, and
the panel left with no configuration state for an answer that needed no process —
which Decision 13 forbids it to derive from the binding tag. So the replacement's
configuration read answers from the binding before it asks anything about
processes, and only the arms that need a probe consult a gate at all.

**The frontend's side needs the same exemption, or the fix stops at the
boundary.** Quarantine is admission's first fact, so a frontend applying admission
uniformly would never issue the read at all — and Decision 4's permanent-refusal
rule would then discharge the obligation, leaving a quarantined unbound session
with no configuration state exactly as before. It can tell the difference, because
it renders the binding: **when the rendered binding is `NoInstallation`, the
configuration read is issued regardless of admission**, since the answer it will
get is a fact about that binding and no probe is involved.

**`UnavailableForBinding` is not entered because `backendUsable` went false**, and
that rule belongs here rather than to the read above it — splitting the paragraph in an
earlier commit left it attached to whatever sentence preceded it. It is not a place a
build that previews badly ends up: a build may be truthfully unusable for preview while
its conversion configuration is `Ready`, which is Decision 3's whole point. Using the
preview verdict to enter it would rebuild the conflation ledger row 6 exists to remove.

**Invalidation is triggered by the receipt being replaced, not by a preview
verdict settling**, and the difference is a real window rather than a wording
preference. A conversion-bound operation can observe binding B and fail its
capability resolution, so `Settled(B)` arrives with a verdict for B and no
*configuration* for it at all. Keyed on the configuration settling, `Ready(A)` would
stay current for the whole of that interval — the stale-catalog window this ADR exists
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

`NoBinding` is the member the authority makes necessary. `Unresolved` is a state this
session really reaches — every session opens in it, and the panel renders before any
operation has resolved anything — and a snapshot that demanded a binding would have no
representable answer for it, leaving only the two exits ledger rows 24 and 26 forbid:
invent a receipt, or route it to `UnavailableForBinding`, which is a statement about a
binding that does not exist. `NoBinding` says the true thing: nothing is installed *or
not installed* yet, so there is no configuration to describe.

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
centroided do **not** answer alike — and the seventh, which leaves it, is the one
that goes somewhere:

```text
precision -> 32/32       -> row exists (K12), unavailable on this build
precision -> 64/32, 32/64 -> not qualified: no admitted row, on any build
population -> MS1, MS2    -> not qualified: no admitted row, on any build
compression -> off        -> not qualified: no admitted row, on any build
processing -> not centroided -> row exists, available: the way out
```

Only two of the nine admitted rows compose processing with anything, which is why
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

a reply arrives while the state is none, blocked, ready or failed
  -> discarded; nothing is loading, so nothing is awaiting an answer
  -> `failed` is named explicitly because it is the one non-loading state
     that still holds a matchable identity and ordinal, so a rule keyed on
     matching would install into it
  -> stated because `blocked` has no loading identity to fail to match,
     and a rule written only as "any other identity" leaves a plan built
     under the previous binding installable

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

**This is the exact-intent proof, not the pre-picker family courtesy.**
`begin_conversion_queue` also runs a per-family evidence check behind
`try_enter_backend` and skips it under a held lane — deliberately, and it stays.
That check improves *where* a refusal lands and guarantees nothing: the
authoritative per-family gate at execution refuses before anything is staged, so
blocking on it would buy nothing and cost a wait. A courtesy that owns no guarantee
may be skipped. The proof above owns one, and may not.

The reason to keep it skippable is *not* the admittability it was written for — a
queue being admissible while a preview holds the lane. The exact-intent proof takes
that away, deliberately: nothing may reach a picker unproved, and under a held lane
the proof refuses. Preserving the courtesy's skip is about not adding a second
wait behind a refusal that is already coming.

**If the lane cannot answer now, BEGIN refuses — it does not wait, and it is never
skipped.** Deferring this to "the repository's concurrency contract" left the one
question in the table above for an implementer to invent, so it is answered here.

The rule this document uses for its internal obligations — duties wait, courtesies
refuse — does not decide it, because both of those are about work with no reader
waiting on it. A `BEGIN` is a click, and blocking it on the backend gate would hang
that click for the length of a preview scan with nothing on screen to explain why.
(The admittability the paragraph above discusses is not an argument here: this
proof takes it away deliberately, and cannot also be defended by it.)

**Refused twice, by two authorities, for two different reasons.** The frontend
refuses first and names the fact: `ConversionLane` already refuses every conversion
action while `previewReading` or `laneClaimed` holds, so the common cases never
reach Rust and the reader is told which fact it
was. **The proof and the pre-picker courtesy share one gate acquisition.** They are two
questions about one build asked at one moment, and taking the gate twice would run
two full discoveries — up to a minute of probes — for a single `BEGIN`. One
acquisition answers both: the proof, which refuses the request when it fails, and
the family check, which is where a refusal lands better and is skipped when the
acquisition does not succeed. Row 87's acceptance case is about that skip and is
unaffected: what the courtesy loses under a held gate it loses because the proof
refused first, and the reader is told so.

**The proof takes that gate with `try_enter_backend` and refuses if it is held.**
One rule, no cases, and nothing to decide about who the holder is. Two earlier drafts
tried to be cleverer than that and both were wrong on the tree: one claimed
`begin_queue` "already takes the gate by waiting" as a precedent, which it does not — it
calls `try_enter_backend` once, for the pre-picker courtesy, and waits on the
workspace-mutation lock, a different thing entirely. The other had `BEGIN` wait behind a
configuration probe and refuse behind anything else, which needs the gate to name its
holder *and* is a time-of-check race: the probe can release and a drain acquire between
the reading and the blocking, hanging the click behind exactly what the rule forbids.

Refusing on a held gate has none of those problems and loses nothing worth keeping.
The frontend already refuses every conversion action while a lane fact holds, so
the common cases are named to the reader before a request is ever sent. What is
left is the narrow window where that projection was stale, and a probe — where the
refusal is Rust's own, carries Rust's own reason, and is retriable at once, against
a probe that lasts at most two 15-second `PROBE_TIMEOUT`s.

**The probe is deliberately not made a lane fact, and that is a trade rather than
an oversight.** React does hold it (Decision 13) and admission does read it (Decision
11), so Convert *could* be disabled for its duration — and it is not, because the probe
is the one gate holder with nothing to tell a reader. Disabling Convert for up to thirty
seconds under a sentence about a settings read the reader did not ask for buys a refusal
in advance of a refusal, and Decision 12's "shared by nothing" stops being true the
moment a conversion action shares it. The cost is the mirror image: a Convert pressed in
that window renders enabled and is refused by Rust. It is rare, it is immediately
retriable, and it says something true. A refusal a reader can act on beats a click that
hangs for thirty seconds and beats a rule the gate cannot evaluate. What the rule
forbids is proceeding without the proof, and that has not changed. The proof's answer
only arises at all in the narrow window where the frontend's projection was stale, or
where a probe holds the gate — and there the refusal is Rust's own and says what Rust
knows, which is that the backend is busy. It cannot say more: `backend_gate` is a
`Mutex<()>`, no holder is consulted (row 106), and naming a lane fact is the frontend's
job, done before the request was ever sent. What may not happen is the third option:
proceeding without the proof. Execution-time revalidation remains, because the
executable can change again after admission; it is a **second temporal proof**, not a
substitute for the first.

## Decision 11 — one admission rule for the configuration read

**Scope first, because "any `msconvert --help` probe" would be far too wide.**
Discovery runs `msconvert --help` inside every gated operation — a preview read
and the mandatory BEGIN preflight included — and a rule capturing those would
contradict this decision's own admitting list (a preview read would refuse itself)
and Decision 10's "never skippable" preflight. What this rule governs is **the
conversion configuration read: the automatic first read for a binding, and the
explicit settings retry**, which are the two paths PR #95 answered differently.
Every other `--help` invocation belongs to the operation that contains it and
answers to that operation's own rules.

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
the session is backend-quarantined
a backend installation check or change is in progress
a conversion owns the backend lane
a preview run or scan is being read
another configuration probe is already in flight
```

Listed in `ConversionLane`'s own precedence — quarantined, changing, *`laneClaimed`
before `previewReading`*, with probe-in-flight last as row 79 requires. A draft had
the middle two the other way round, which is enough to break row 73 on its own:
`previewReading` is an independent counter and both are routinely true together, so
one moment would have been keyed `conversion-running` by the lane and
`preview-running` by admission. The order is not decorative; it is the whole
mechanism.

`backendUsable` is absent, because it is a judgement and this list is ownership.
That is deliberate and it is *not* a hole in row 73 — see below.

**`laneClaimed` is broader than the gate, and admission takes it whole.** It is
true while a conversion runs, which owns the gate, and also while the destination
picker is open, which owns nothing. Read against Decision 11's criterion the second
case does not belong; read against the field, it comes along. Admission takes the
field — the frontend's projection is a courtesy, and a courtesy is allowed to be
conservative, deferring a probe a moment longer than Rust would. What makes that
safe rather than a stall is row 81: a lane fact going false is an occasion, so the
picker closing issues the deferred read without waiting for anything to answer.

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

**The surviving element carries the fact's sentence, not either action's.** A
notice that two actions point at cannot be phrased about one of them: keyed on
`laneClaimed`, a Convert refusal and a settings-read refusal collapse to one
element, and if that element kept Convert's wording the settings retry would be
described as "converting is unavailable while a conversion is running". So a
shared notice states the fact — *a conversion is running* — and each action's own
control says what it cannot do. Where a fact refuses only one action, the two
readings coincide and nothing changes.

**That is a second text, not a rewrite of the first.** `CONVERSION_MESSAGES` are
action-phrased, and this document forbids the replacement rewriting the lane's
refusal vocabulary — so `ConversionAvailability.message` is untouched and stays
where it belongs, on the control it describes. The fact-phrased sentence is the
panel's, minted by the registry for the notice element the actions point
`aria-describedby` at, and it is new work rather than a relabelling. One fact, one
element, one sentence in it; and each control keeps its own.

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
refuses, in its own fixed order, and that order is the registry's precedence too.
**`ConversionConfigurationProbeAdmission` reports in that same order**, which is
the half an earlier draft left unstated: with two facts holding at once, an
admission free to name either could key a moment differently from the lane and
emit two sentences for one fact.

**The invariant is one element per fact, not one element per panel**, and the
difference matters here because the two authorities read different subsets of the order.
The lane considers `backendUsable`; admission does not, since it is a judgement rather
than an owner. So a session on an unusable build with a drain running keys
`backendUsable` for the conversion and `laneClaimed` for the probe — two elements,
because two genuinely different facts are refusing two genuinely different actions, and
collapsing them would be the lie, not the fix. Each authority reports the first fact it
is entitled to consider, in the one shared order, and where they consider the same fact
they name it identically. That is what row 13 asks for and all it asks for.
`ConversionConfigurationProbeAdmission` maps its refusals onto the same names, which it
can, because Decision 11's admitting subset was drawn from these fields in the first
place. Only a refusal with no lane fact behind it mints a key of its own: a
configuration probe already in flight, **which sorts after every lane field**, so it has
a place in the one order both authorities report in and cannot tie with a lane fact for
the same moment — it is the narrowest refusal there is, shared by nothing, so it yields
to any lane fact that can refuse a probe at all. The three that cannot — `adopting`,
`exportingDiagnostics` and `workspaceSettling`, which Decision 11 excludes because they
own no backend process — never key a probe refusal, so there is no tie for them to lose:
a probe running beside a diagnostics export is refused by neither, and the export's own
refusal of a conversion is keyed on its own. And the action-derived reasons, which name
a target rather than a lane fact. Those last are keyed by action *and* target, and need
no cross-action deduplication because no two actions can be refused by one of them — a
missing target is a fact about the action asking. (The alternative — namespaced
per-child notices — is rejected: it multiplies the same sentence and reintroduces the
"each surface decides again what is wrong" defect ADR 0041 removed.)

## Decision 13 — what React retains

React owns:

```text
the selected admitted intent id
request-in-flight state needed to render an outstanding command
per-obligation bookkeeping: whether a read or check is in flight, and whether
  any *occasion* has passed since it was issued -- a delivery or a lane fact
  going false, since a picker closing is one and produces no delivery --
  never a *judgement* about whether one is owed, which Rust's state makes
the per-panel plan request ordinal, which is never reset
the Rust-authored configuration snapshot it is rendering, catalog included
the Rust-authored plan answer
the authority revision of the projection it is currently rendering
the binding receipt carried by that projection, where one exists
ordinary presentation state
```

React does **not** own reconstructed authorities for installation observation
watermarks, an applied generation, an automatic reconciliation quota, a settled
binding, a catalog-served binding, or catalog-generation ordering.

**"Owed" is read, not derived — and the one case where React has nothing to read
from is not an exception.** A binding whose snapshot React holds says for itself
whether its catalog has been read: `Unattempted` says it has not, `Ready` and
`Failed` say it has. A binding just observed by a drain or a refused `BEGIN` is
different only in that React holds *no snapshot for it at all*, which is not a
judgement about the configuration but an observation about React's own state — it
has nothing for the binding on screen, so it asks. That is the same act as a mount,
one binding later, and it decides nothing Rust has not been asked yet.

**Holding Rust's answers is not owning them.** The configuration snapshot is on
that list because Decisions 4b, 6, 7 and 8 all require React to render it and to
look rows up in it, and a list that omitted it would forbid the thing the rest of
the document assumes. It is retained exactly as the plan answer is: a Rust-authored
value, kept as it arrived, replaced when a newer one arrives, and never recomputed
— React reads the catalog, and does not decide what is in it.

**The obligation bookkeeping is not a reconstructed authority either**, and the
ban above is narrower than it may read. What Decision 13 refuses is React deciding
*what is true* — a watermark it compares, an applied generation, a quota that
rations how often reconciliation is allowed to happen. The obligation state decides
nothing: Rust's `Unattempted` says the catalog is unread, and these bits say only
whether this frontend has a request outstanding for it and whether the world has
moved since. They are facts about the frontend's own in-flight work, which nothing
else can know and nothing else is being asked to.

**Retaining two tokens is not owning an authority**, and Decision 4b needs the
difference stated rather than assumed. React holds the revision and the receipt that
arrived *on the projection it is showing*, each for exactly one purpose: the revision to
discard a reply that is older than what is on screen, the receipt to notice that a newer
reply describes a different installation. It holds a receipt in one further place,
bounded by something other than the render. **A plan identity carries one**, because
Decision 9 makes the binding part of *which question was asked*, and a `loading` or
`failed` state outlives the request that produced it precisely so a retry can ask the
same question again (rows 35, 44, 61). That receipt is a component of a question, not a
claim about the current installation, and the plan is invalidated when the rendered
binding stops matching it — the retain-list's "not past the render" bounds what React
may *believe*, not what a recorded question may contain.

**A request-issued receipt is not among them, and an earlier draft added one here.**
It was needed only by a payload rule Decision 4b has since retracted: under the rule
that stands, a payload is judged by the binding *it* describes against the binding now
rendered, and what the request went out under does not enter into it. Keeping the extra
copy would not merely be spare — it would answer the question differently, discarding
exactly the rebinding read that carries a snapshot for the binding on screen. React does
not order receipts, does not derive meaning from a revision, does not hold either past
the render or the request it belongs to, and does not reconstruct *observed*,
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
| May the conversion configuration read run now? | `ConversionConfigurationProbeAdmission` — the automatic first read and the explicit retry, and no other `--help`; a `NoInstallation` binding's read launches no probe and asks nothing |
| May the obliged backend check be issued now? | The same predicate, over backend-process ownership; the difference is that its refusal waits where the read's refuses |
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

**Nothing resolves at all.** Authority `Unresolved(r0)` → the panel mounts and
renders → no operation has resolved an installation yet → the response to whatever
it asks first projects `Unresolved(r0)` and whatever its domain outcome was →
**no receipt is invented**, and there is no binding to hold a configuration.

It is worth being exact about how this state is reached, because a discovery that
*runs* always answers — `Available`, `Partial` or `Unavailable`, each mapping onto
a binding — so there is no fourth outcome to leave the authority unresolved.
`Unresolved` is the window before the first discovery answers, plus any operation
that answers without having reached one. The first is ordinary and every session
passes through it; the second is a general rule rather than a scenario, and it is
why the arm exists at all.

**The first installed observation.** `Unresolved(r0)` → `Installed A` is observed
→ revision `r1 > r0`, receipt A → configuration `Unattempted(A)`.

**Healthy mount.** `Unresolved` → the owed check runs, settling binding A with its
verdict in one response → configuration `Unattempted(A)` → probe admission permits a
read → `Ready(A, catalog)` → SHIPPED selected → plan for A. Two discoveries, one
waiting on the gate and one refusing rather than waiting, which is what keeps the duty
and the courtesy apart (row 119).

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
     it: an error to show, a refusal to explain
  -> any payload it carries is judged on its own, by receipt: a snapshot or
     plan for A is discarded because A is not what is rendered -- not
     because the projection carrying it was stale
```

The last line is the distinction Decision 4b's three rules turn on. Here the two
tests agree, so it reads as pedantry; the case where they part is a reply that is
stale by revision while its payload describes the binding on screen, and there the
payload installs.

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
plus the findings raised against this document's own drafts (rows 18–122).
This is the handoff: the replacement implementation proves the right-hand column,
and no finding may disappear because the old PR was superseded.

| # | Family | What permitted it | Required invariant | Owner | Replacement acceptance case |
|---|---|---|---|---|---|
| 1 | Admitted graph duplicated or widened | A frontend able to compose axis values | The admitted table is the only compatibility rule | Rust (`ConversionIntent::ADMITTED`) | No TS from which a nine-row graph could be rebuilt; 39 combinations unreachable by any activation sequence |
| 2 | Preserved unsupported selection unrecoverable | One-axis editing plus a preserved choice, with no escape | A genuine dead end offers one explicit atomic recovery, when the shipped row is itself available | Selection module | Dead end with an available shipped row offers it; a reachable one-axis route offers no recovery block; a dead end whose shipped row is unavailable offers nothing |
| 3 | Catalog outlives the backend it described | Catalog lifetime keyed on nothing that expires | A replaced receipt revokes the configuration bound to the old one | Rust configuration lifecycle | A binding observed as `NoInstallation` → the previous configuration is gone, without waiting for a verdict |
| 4 | In-flight obsolete catalog resurrects state | Revoking rendered state without revoking the request | Revocation is one act over state and request | Rust configuration lifecycle | A reply about a superseded binding cannot install |
| 5 | BEGIN observes a changed build, nothing reconciles | An observation made by an operation that then refused | An observation is complete once discovery establishes an installed binding **or** an absence; later capability or domain failure does not erase it | Provider attempt + authority | A refused BEGIN that resolved a new build advances the authority |
| 6 | Catalog read tied to transient checking | `backendUsable` false for the duration of a backend check | A check is activity; a binding is a verdict | Authority state | A recheck settling on the same receipt: no probe, no revocation, plan preserved |
| 7 | Repeated polls, repeated reconciliation | A reply carrying a number treated as a request | An arriving fact is not a request | Authority state | N polls of one observation → at most one backend probe |
| 8 | Catalog failure with no retry owner | Recovery living on a conflation that was removed | A failed read is not a state a binding can clear | Rust lifecycle + explicit retry | Transient failure → recheck does not retry it; explicit retry does |
| 9 | Provider-resolution failure loses the observation | `?` propagating an error past a found identity | Resolution returns the observation either way | `ConversionBackendAttempt` | Resolution failure that established absence advances the authority; one that established nothing does not |
| 10 | Mandatory preflight under an optional courtesy | A gate that may be declined owning a guarantee | Admission proof is never skippable, and a lane that cannot answer refuses rather than blocks the click | Rust BEGIN | Busy lane → BEGIN refuses, naming the lane fact; never a queue without the proof, and never a hung click |
| 11 | Selected-but-unavailable rendered as usable | A state that could hold only one of the two facts | Selected and available are two facts | Selection module | The preserved unrunnable selection reads as unavailable |
| 12 | Row incompatibility asserted per value | A row-level fact rendered against each axis value | Availability is a property of a composition | Selection module | A build lacking only peak-picking makes no false claim about 64/64, all spectra or zlib |
| 13 | Two owners of one availability reason | Each surface minting a global id | One reason, one notice element, deduplicated by the refusing fact rather than by either authority's word for it | Panel notice registry | No duplicate availability id under any refusal shared by two actions, including one fact refusing a conversion and a probe in two vocabularies |
| 14 | Plan `loading` with no request | One member standing for "in flight" and "never asked" | `loading` names an actual request | Plan state machine | No selected intent → blocked, and nothing claims a read |
| 15 | Failed plan described as reloading | A single non-current reason for four situations | A refusal names what the reader can change | Availability rule | A refused plan reads as failed, not as being reread |
| 16 | Backend loss during drain not recorded | The same `?` as #9, in the execution path | Every conversion-bound resolution observes | `ConversionBackendAttempt` | Loss while the picker is open advances the authority |
| 17 | Automatic read ungoverned, explicit retry governed | Two answers to "may the configuration read run now?" | One admission rule for both paths of that read, and for no other `--help` | `ConversionConfigurationProbeAdmission`, decided by Rust's gate and quarantine boundary | Both paths refuse identically under a held lane, and neither mutates the configuration state |
| 18 | A refused operation records a new binding and reports none | Recording an observation without delivering it | Every answer carries the authority projection as it stands — which may be `Unresolved`, and is never a receipt the answer had to invent | `AuthorityObserved<T>` | A `BEGIN` refused on the exact-intent proof, having been the first to resolve B, returns B; an operation that answers without discovering returns `Unresolved` |
| 19 | Old configuration usable after a newer binding arrives | Invalidation waiting for something later than the arrival | A newer projection carrying a differing receipt invalidates on arrival, before any further action | Frontend, ordering then identity | `Ready(A)` and `Plan(A)` are non-current, and no action is enabled from them, before the next interaction is possible |
| 20 | The replacement's configuration read twice, or not at all | Ad-hoc refresh paths beside the lifecycle | Exactly one snapshot per newly observed binding, through the ordinary lifecycle | Rust configuration lifecycle | One `ConversionConfigurationSnapshot(B)` is established; the gap before it is a truthful loading state, never A's catalog and never a silent SHIPPED |
| 21 | A refusal becomes a refresh | Treating any error as installation news | An unchanged receipt is not a reason to re-read | Frontend, ordering then identity | A refusal projecting the current A spends no probe and changes no configuration |
| 22 | A lost build leaves its catalog on screen | Absence not modelled as a binding | `NoInstallation` is a receipt and differs from A | Authority + frontend comparison | An observed `NoInstallation` revokes A on arrival, exactly as a replacement does |
| 23 | React classifies errors to decide whether to reconcile | The observation not travelling with the answer | No error-kind allowlist and no `retryable` heuristic anywhere in React | Frontend contract | Reconciliation is decided by the projection alone — revision, then receipt; nothing inspects what failed |
| 24 | `UnavailableForBinding` entered by guesswork | A state named with no entry or exit | It is entered from a `NoInstallation` binding and from nothing else, and left only when the receipt is replaced | Rust configuration lifecycle | A build that previews badly but converts fine is `Ready`, not `UnavailableForBinding`; a session bound to no installation probes nothing |
| 25 | Two probe-admission rules | An authority for conversion actions reused for process admission | One named `ConversionConfigurationProbeAdmission`, over backend-process ownership facts only, decided by Rust's gate **and its quarantine boundary** | Rust gate + one frontend projection | The automatic first read and the explicit retry are refused identically under each admitting fact, and `backendUsable` is not one of them |
| 26 | `Unresolved` forced to fabricate an identity | A wire contract demanding a receipt every state can supply | The response projects the authority, which may be `Unresolved` and then carries no receipt | `BackendAuthorityProjection` | A first operation that answers without discovering returns `Unresolved` and invents nothing |
| 27 | A delayed reply rolls the authority backwards | Equality asked to do ordering's work | Ordering is `BackendAuthorityRevision` and identity is the receipt; neither answers the other's question | Rust-authored revision | A late projection at a lower revision is discarded whole; the rendered binding survives and no snapshot is read for the stale one |
| 28 | A revision read as meaning | One token carrying an ordering and a semantics | The revision's only frontend meaning is staleness; observed, settled, attempted and ready arrive as typed state | Frontend contract | Nothing in React derives an authority state from a revision comparison |
| 29 | The plan reaches no successful state | A machine with no transition into `ready` | Every state has an entry, and a matching answer reaches `ready { plan }` | Plan state machine | A plan request that answers for its own identity renders the plan; one that fails renders the failure |
| 30 | The route record contradicts itself | An amended ADR left reading as though it were not | ADR 0043 records the M6.4A amendment, links ADR 0044, and keeps its original decisions and date | ADR 0043 metadata | Its status, amendment note and `Related` name ADR 0044, and its chain wording matches ROADMAP |
| 31 | `Unresolved` has no representable snapshot | A snapshot demanding a binding for a state that has none | The snapshot says `NoBinding` where there is no binding | `ConversionConfigurationSnapshot` | A session whose first operation answers without discovering renders no configuration, invents no receipt, and is not called `UnavailableForBinding` |
| 32 | Contention spends the one automatic attempt | "A read that does not answer" catching a read that never ran | `Failed` requires a probe that ran; a probe that could not start leaves `Unattempted` | Rust configuration lifecycle | A configuration read refused by probe admission leaves the state unchanged and the first read still owed |
| 33 | The two operations that replace a binding owe nothing | A delivery rule scoped to conversion-bound work | Every operation that can observe **or replace** authority returns it | Authority delivery | Choosing a different ProteoWizard folder invalidates the previous configuration and plan with nothing else required |
| 34 | A stale reply's payload installed under a newer binding | A payload with no rule of its own | A payload is judged by receipt: it installs when it describes the binding now rendered, and is discarded when it does not | Frontend, ordering then identity | A late snapshot or plan for A cannot be installed while B is rendered |
| 35 | A transient plan failure is permanent | A `failed` state with no exit but a new question | An explicit request may re-ask the same plan question | Plan state machine | A failed plan can be retried without changing handles, intent, policy or binding |
| 36 | A snapshot that contradicts itself | The receipt carried twice with no stated equality | The receipt appears once, in the authority; the configuration describes the binding beside it | `ConversionConfigurationSnapshot` | No snapshot can pair one binding's authority with another's catalog |
| 37 | The first binding is never installed | An ordering rule defined only for a strictly newer revision | Nothing rendered accepts the first projection; an equal revision changes nothing and re-reads nothing | Frontend, ordering then identity | A session's first projection installs its binding, and a repeated projection spends no probe |
| 38 | Receipt comparison silently disabled | Two shapes for the one union Rust owns | `Binding` carries its receipt, in one place, wherever the union appears | Decision 1's union | Every comparison in the replacement reads the receipt from the same field |
| 39 | The first read is owed and never re-issued | An admission refusal with no named stimulus to try again | The read stays owed, and every authority delivery is an occasion to issue it; the retry is offered from `Unattempted` too | Rust configuration lifecycle + panel | A configuration read refused under a held gate is issued when the holder answers, and a reader is never left with a stuck panel and nothing to press |
| 40 | A probe launches in a quarantined session | A membership criterion written as "takes the gate" alone | Admission is what Rust refuses a backend process for: the gate **and** the quarantine boundary | `ConversionConfigurationProbeAdmission` | A quarantined session admits no probe, automatic or explicit, and says so with quarantine's own reason |
| 41 | `Partial` has no representable binding | A union read as installed-or-nothing while discovery has three outcomes | `Installed` is `AvailabilityState::Available` and nothing else; `Partial` is `NoInstallation`, and the tag carries no reason | Decision 1's union | A folder with msconvert and no msaccess binds as `NoInstallation`, probes nothing, and is never worded "ProteoWizard is not installed" |
| 42 | A binding is observed and never settles | An observation that carries a binding and no verdict | A binding and its verdict travel together: every observer holds the `DiscoveryResult` both are computed from | Decision 1 + Decision 4 | No response carries a binding whose `previewAvailability` is missing, so no state exists for a check to have to leave |
| 43 | The two judgements never actually diverge | A split justified by a state the code cannot reach | `Failed` is reached by a capability parse that refuses a probe discovery accepted | Decision 3 | A build whose msconvert help is bound but unparseable is preview-usable with a `Failed` configuration |
| 44 | A superseded plan reply installed by its own retry | A machine keyed on an identity a retry preserves by design | `loading` and `failed` carry an ordinal, and a reply matches identity **and** ordinal | Plan state machine | A retry issued while an earlier request is in flight ignores the earlier reply, and the plan rendered is the one the reader asked for last |
| 45 | A projection nested inside a projection | Two contracts each carrying authority, with no rule for which applies | One response carries one projection; the snapshot's `authority` **is** the observed authority | Decision 4 + Decision 6 | The configuration read's response has exactly one authority field, and no equality rule is needed because there is nothing to disagree with |
| 46 | Repeated absence read as repeated replacement | Receipt stability defined only for a same-installation recheck | An unbound session keeps one `NoInstallation` receipt however many discoveries confirm it | `BackendBindingReceipt` | Two consecutive failed discoveries revoke nothing and re-probe nothing |
| 47 | A binding read as `Installed` on a refused build | The union derived from `InstallationIdentity::of` rather than from availability | `of` yields an identity for `Partial` too; the binding is minted from `Available` | Decision 1's union | A `Partial` build never reaches probe admission, because it never becomes `Installed` |
| 48 | The answer to a request discarded for not moving the authority | An ordering rule worded over the whole response | Ordering governs the projection; the outcome answers the request that asked for it | Frontend, ordering then identity | A successful configuration read on an unchanged binding is installed, not dropped for arriving at an equal revision |
| 49 | An owed obligation issued only when something changed | The deadlock break placed inside the rules its own case dismisses | Discharging an owed obligation is a third, unconditional step after ordering and identity | Frontend reconciliation | The delivery that breaks the deadlock carries an equal revision and an equal receipt, and still issues the read |
| 50 | A session claimed as verdict-bearing about a build it has left | A stale verdict surviving the binding it described | A replaced binding replaces its verdict in the same response | Decision 4 projection | `backendUsable` never reports the previous build's verdict, and no window disables the controls that would replace it |
| 51 | A refused discovery spending a configuration attempt | A read that cannot reach a probe reported as a probe that failed | A read whose own discovery refuses replaces the binding; `Failed` needs a probe that ran | Decision 3 + Rust lifecycle | A build that disappears between the verdict and the read is `NoInstallation` → `UnavailableForBinding`, not `Failed` |
| 52 | The state that owes the check is the fact that refuses it | An authority state raising the flag that gates the check and the recovery controls | Nothing new is fed into `backendChanging`; it keeps meaning a check in flight | Decision 11 + `ConversionLane` projection | Choose-installation and Recheck are live whenever no check is actually running |
| 53 | An obligation re-issued against a refusal that never clears | An obligation discharged only by succeeding | An operation that ran and answered discharges it; so does the session becoming quarantined; one that never reached a discovery follows the permanent-or-transient rule | Authority obligations | A quarantined session makes at most one mount-time attempt and stops |
| 54 | An obligation owed against a refusal that cannot clear | One rule for deferral and permanent refusal | Deferred obligations stay owed; permanently refused ones are discharged | Authority obligations | A quarantined session asks once and stops; a session behind a held gate asks again when it clears |
| 55 | A probe waiting out the conversion it lost a race to | The one gate taken by waiting | The probe takes it with `try_enter_backend` and never queues | `ConversionConfigurationProbeAdmission` | A probe dispatched just before a drain refuses immediately and stays owed, rather than surfacing after the conversion |
| 56 | A fresh catalog discarded, or `Ready` arriving over `Unattempted` | Observation and answer ordered as two events | A read that observes a new available binding answers for it in one transaction | Rust configuration lifecycle | A configuration read that discovers build B returns `Ready(B)`, and `Unattempted(B)` is never rendered |
| 57 | Two notices for one refusing fact | A registry key left to be inferred across two vocabularies | The key is a `ConversionLane` field, and its order is the precedence | Panel notice registry | A conversion holding the gate renders one sentence, whether it refused a conversion, a probe, or both |
| 58 | An unbound session projected preview-usable | A verdict field on a binding that names no build | The verdict is entailed for `NoInstallation`, and `backendUsable` requires `Installed` in the conjunction | Decision 4 projection | No `NoInstallation` authority, settled or not, yields a usable lane |
| 59 | The obliged read governed by a rule it cannot obey | A courtesy's refusal semantics applied to a duty | One admission predicate, two refusal semantics: the probe refuses under `try_enter_backend`, the mount-time check waits under `inspect_backend` | Authority obligations + Decision 11 | Neither is dispatched into a busy lane, and neither is left owed by a refusal the other would have taken |
| 60 | A rebinding read whose probe failed left owing another | One transaction with only a successful arm | The new binding lands on what its own answer supports, `Failed` included | Rust configuration lifecycle | A read that discovers B and fails its probe is `Failed(B)`, and no second automatic probe follows |
| 61 | The ordinal reset by leaving an identity | A counter scoped per question | One per-panel ordinal, never reset | Plan state machine | A reply in flight from before an identity was left and re-entered is discarded, not installed |
| 62 | The most-shared refusal left without a key | A key set listing seven of eight lane fields | `backendUsable` is a key; action-derived reasons key by action and target | Panel notice registry | Convert and the conversion retry, refused as unusable, render one sentence |
| 63 | An obligation re-issued by its own refusal | A stimulus rule with no bound, over a projection allowed to be stale | Each owed obligation issues at most once per occasion, and an attempt's own refusal re-issues it only if another occasion has passed meanwhile — counted as occasions everywhere, including in what React retains | Frontend reconciliation | A refused attempt with nothing else having happened does not immediately produce another; one overtaken by a gate holder's answer, or by a picker closing, does |
| 64 | The stimulus narrower than the facts it must cover | A delivery scope read as the conversion path only | Delivery membership and gate membership are the same set | Decision 4 + Decision 11 | A preview read finishing issues an owed catalog read, exactly as a drain finishing does |
| 65 | A build that cannot convert rendered as nine unavailable rows | `Failed` and `Ready`-with-nothing-available left undecided | A build failing `require_conversion` is `Failed`; availability is a property of rows, and it has not got as far as rows | Decision 3 + Decision 7 | A build missing `outdir`, `outfile`, `--zlib` or the format option renders one sentence and a retry, not nine dead controls |
| 66 | A quarantined session reachable through a remembered verdict | Quarantine reaching `backendUsable` only by corrupting the availability DTO the authority replaces | `backendUsable` names quarantine as its own conjunct, beside the authority's verdict | `ConversionLane` + preview load | A session quarantined after a good verdict starts no conversion and no automatic preview load |
| 67 | A stale payload with no binding to check against | One rule made to cover projection, payload and outcome together | Three things, three rules: revision judges the projection, receipt judges the payload, neither judges the outcome | Frontend, ordering then identity | A snapshot for the rendered binding is installed even when its projection is stale, and its domain outcome still answers the reader |
| 68 | An owed read stranded by an out-of-order reply | A re-issue bound that cannot tell a reorder from a spin | An attempt's own refusal re-issues it when another delivery has been processed since it went out | Frontend reconciliation | A gate holder that answers while a refused probe's reply is still in flight still gets the read issued |
| 69 | The verdict refusing the operation that would produce one | The mount-time check gated on the lane rather than on process ownership | The check asks only whether something owns the backend process; `backendUsable` owns none | Authority obligations + Decision 11 | A session that has resolved nothing issues its check with a free gate, whatever `backendUsable` says |
| 70 | Two snapshots for one rebinding read | An invalidation rule with no exception for a response that already answers | A response carrying a snapshot for the new binding is the read for it | Frontend reconciliation | Mount and every rebinding read cost one snapshot, not two |
| 71 | A shared notice phrased about one of its actions | Deduplication defined without saying whose sentence survives | A shared notice states the fact; each control says what it cannot do | Panel notice registry | A settings retry sharing `laneClaimed` with Convert is never described as converting being unavailable |
| 72 | A reader's error swallowed by an unrelated revision | Staleness applied to the whole response | Staleness reaches the projection alone; the outcome answers the request that made it | Frontend, ordering then identity | A refusal overtaken by a revision bump is still shown to the reader who caused it |
| 73 | Two authorities keying one contended moment differently | An admission with no stated selection order | Probe admission reports in `ConversionLane`'s order, over the ownership facts it is entitled to consider | Decision 11 + panel notice registry | One fact refusing two actions produces one notice; two different facts refusing two actions produce two, and neither is misnamed |
| 74 | A working replacement landed unprobed | "The build changed" collapsed into "the build is gone" | A read that finds a different working installation lands on its own answer; `UnavailableForBinding` is only for a binding naming no build | Decision 3 + Rust lifecycle | Switching between two good installations mid-read yields `Ready(B)`, never `UnavailableForBinding` |
| 75 | A request's payload judged against a receipt React was told not to hold | A retain-list closed before a plan identity's receipt was accounted for | React holds a plan identity's receipt for the life of the plan, and holds no request-issued copy at all | Decision 13 | A payload is judged by the binding it describes against the binding rendered, needing neither the projection that carried it nor what its request went out under |
| 76 | An admission rule capturing the operations it lists as refusing it | A scope written as the tool invocation rather than the read | The rule governs the automatic first configuration read and the explicit retry, and no other `--help` | Decision 11 | A preview read and the BEGIN preflight run their own discovery without consulting probe admission |
| 77 | A rebinding read discarded by the receipt it was issued under | A payload judged by its request rather than by itself | A payload is judged by the binding it describes against the binding now rendered | Frontend, ordering then identity | A read issued under A that answers `Ready(B)` is installed whole |
| 78 | Nine dead controls under a truthful `Ready` | A catalog with no available row left to per-row presentation | A `Ready` catalog with nothing available is one settings-level sentence, and offers no recovery, because the shipped row is unavailable too | Decision 3 + Decision 8 | A build admitting none of the nine rows says so once, and no control implies a way through |
| 79 | The one self-minted key outside the shared order | A precedence covering only the lane's own fields | Probe-in-flight sorts after every lane field that can refuse a probe | Panel notice registry | A probe in flight beside such a fact yields to it; beside a fact that refuses no probe — adoption, diagnostics export, workspace settling — there is no tie to resolve |
| 80 | The binding oscillating between two observers | The preview verdict folded into the identity by one of them | Every observer mints the binding from `AvailabilityState::Available`; the verdict travels beside it | Decision 1 + Decision 3 | An `Available` build whose msaccess lacks a required preview operation is one binding to every observer, and its catalog survives a backend check |
| 81 | An obligation waiting on a delivery nothing will produce | A stimulus that assumed every deferring fact belongs to a gate holder | A lane fact going false is an occasion, observed by the frontend without being told | Frontend reconciliation | A destination picker cancelled after a `BEGIN` observed a replacement issues the owed check, and the read follows on its answer |
| 82 | No configuration state for an answer needing no process | A binding-only answer routed through the guards that protect a process | A read for a binding that names no build answers from the binding before consulting probe admission or the quarantine pre-check | Decision 5 + Decision 11 | A quarantined session bound to no installation still renders `UnavailableForBinding` |
| 83 | A retained question mistaken for a retained belief | A retain-list bounding receipts by the render alone | A plan identity's receipt is a component of a question, bounded by the plan, not by the render | Decision 9 + Decision 13 | A failed plan can be retried for the same question without React holding a third authority |
| 84 | Two obligations issued into each other's gate | "Issues both" read as simultaneously | Where both are owed the duty goes first and the courtesy is deferred onto its answer | Frontend reconciliation | An occasion finding a mount-time check and a read both owed strands neither, and issues one process at a time |
| 85 | An admission rule the frontend cannot evaluate | A rule stated over `ConversionLane` for a fact with no lane field | Admission reads the lane's ownership fields plus the frontend's own probe-in-flight bookkeeping | Decision 4 + Decision 13 | No backend work is issued while a configuration probe is in flight |
| 86 | Work suppressed by a missing verdict, and never re-issued | One-shot guards behind a verdict that arrives later than the binding | A binding never arrives without its verdict, so nothing `backendUsable` gates is suppressed for want of one | Decision 1 + `backendUsable`'s readers | A document opened as a replacement is observed previews on that observation, and a scan clicked then is not silently lost |
| 87 | A courtesy abolished with the duty it was mistaken for | One decision covering the exact-intent proof and the pre-picker family check | The proof owns a guarantee and may not be skipped; the pre-picker courtesy owns none and may | Decision 10 | The pre-picker family check is still skipped under a held lane rather than blocking on it, and no picker opens before the exact intent is proved |
| 88 | One moment keyed two ways by an order written wrong | An admitting list whose middle two facts were transposed | The list is `ConversionLane`'s precedence exactly: `laneClaimed` before `previewReading` | Decision 11 | A conversion running during a preview read is keyed `conversion-running` by both authorities |
| 89 | A quarantined unbound session with no configuration state | The binding-only exemption stated for admission and not for discharge | A `NoInstallation` binding's read is exempt from both: quarantine discharges only obligations that need the backend | Frontend reconciliation + Decision 5 | A session quarantined before it loses its build still renders `UnavailableForBinding` |
| 90 | A preview auto-loaded against a build just judged unusable | A re-issue condition abbreviated to "the authority moved" | `backendUsable` is the whole conjunction, quarantine included, wherever it is consulted | `ConversionLane` projection + preview load | An observation settling on an unusable build, or arriving in a quarantined session, loads nothing |
| 91 | A session stranded `Unresolved` by a transient failure | "Answers without discovering" discharging unconditionally | It follows the permanent-or-transient rule like every other refusal | Authority obligations | An operation whose request failed leaves the mount-time obligation owed; a quarantined one discharges it |
| 92 | The courtesy put ahead of the duty by the invalidation step | Step two dispatching a read imperatively | Step two decides what is invalid; step three issues, under admission and duty-first ordering | Frontend reconciliation | A `BEGIN` refused mid-drain issues the check first and the read on its answer, never a probe into the drain |
| 93 | One fact with two sentences and no rule for which is rendered | A fact-phrased notice required over an action-phrased vocabulary | The notice sentence is the panel's, new; `ConversionAvailability.message` is untouched and stays on its control | Panel notice registry | The lane's vocabulary is not rewritten, and the shared element carries exactly one sentence |
| 94 | A catalog discarded for a revision bump about its own binding | Staleness reaching a payload that describes the rendered binding | Receipt judges the payload; revision judges only the projection | Frontend, ordering then identity | A recheck that advances the revision on the same receipt does not strand `Ready(B)` with no catalog on screen |
| 95 | A verdict owed for a binding that has none to give | A verdict treated as separable from the binding it judges | `NoInstallation` carries no verdict to wait for, and `Installed` never arrives without one | Authority state | Observing that no installation resolves obliges nothing and completes at once |
| 96 | A reading nothing is obliged to replace | A liveness rule written about bindings only | A session that has resolved nothing, and a rendered reading whose receipt is not the authority's, each owe one backend check | Authority obligations | No session sits unresolved, and no banner describes a build the session has left, with nothing owed and no control to press |
| 97 | React holding what Rust already answers | A retain-list that grew a flag per rule rather than per fact | React holds what only it can know — its own in-flight work — and never whether an obligation is *owed*, which Rust's configuration state answers | Decision 13 | No frontend flag duplicates `Unattempted` |
| 98 | An occasion bounded only when it was a delivery | The once-per-occasion bound and duty-first ordering written over deliveries alone | Both govern every occasion, a lane fact going false included | Frontend reconciliation | A picker closing issues the check first, exactly as a drain answering does |
| 99 | Quarantine's own protections read as removed with the route to `backendUsable` | "The short-circuit is gone with it", said of a function rather than of a dependency | `quarantined_availability()` is untouched; only `backendUsable` stops depending on it | Decision 4 | The quarantine banner and the refusal ahead of the gate both survive the authority change |
| 100 | The route's own acceptance criterion asking for the defect | M6.4's per-value framing left unamended beside a row-level boundary | ADR 0043's M6.4 acceptance states availability as a property of an admitted row | ADR 0043 amendment | The criterion the replacement is measured against and the boundary it is built on ask for the same thing |
| 101 | A click hung behind whatever holds the gate | A proof that waits on a lock nothing bounds | The proof takes the gate with `try_enter_backend` and refuses if it is held, with Rust's own reason | Decision 10 | No `BEGIN` blocks; a reader refused during a probe can press again at once |
| 102 | The banner naming a build the session has left | One surface left reading the verdict without the authority beside it | `BackendStatus` reads both: the DTO for the reason, origin and quarantine sentence, the projection for whether the verdict is current | Decision 4 | No window exists in which the banner reports a verdict about the previous build, and none in which it loses the reason text it has today |
| 103 | A plan installed because it belongs to the binding | A receipt test read as sufficient for a payload with an owner | Receipt admits a payload to the binding; the plan machine's identity-and-ordinal test then decides it | Decision 4b + Decision 9 | A superseded plan reply for the current binding is still discarded |
| 104 | A plan installed into a state awaiting nothing | A discard rule written only as "any other identity", over states that have none or that still match | A reply arriving while `none`, `blocked`, `ready` or `failed` is discarded | Plan state machine | A reply outstanding across `loading -> blocked` installs nothing, and neither does one arriving after the same request already failed |
| 105 | A build that cannot convert reported `Ready` by the lifecycle | A discriminator asking only whether a probe answered | A probe that answered and found `require_conversion` refusing is `Failed` | Rust configuration lifecycle | Decision 3's cannot-convert case and the lifecycle that implements it agree |
| 106 | A rule about the gate's holder that Rust cannot evaluate, and could not trust | `backend_gate` as a bare `Mutex<()>` under a rule keyed on who holds it, read before blocking on it | No holder is consulted: the gate is taken or the proof refuses | Decision 10 + Rust gate | The proof needs no tag, and no window exists between reading a holder and waiting on one |
| 107 | A third authority member for a state the tree cannot produce | A union member added for an observation that carries no verdict | The union is `Unresolved` or `Settled`; every observer computes the verdict from the discovery it already holds | Decision 1's union | No `DiscoveryResult` reaches a caller that could not have produced a verdict from it |
| 108 | The wait behind a probe understated by half | "A single `msconvert --help`", where discovery probes both tools | A configuration probe is a discovery over both tools, bounded by two `PROBE_TIMEOUT`s, and is described as such wherever its cost is weighed | Decision 10 + Decision 11 | No argument in this document rests on a probe being half as long as it is |
| 109 | A `NoBinding` payload landing on a rendered binding | A receipt rule with nothing to compare when the projection is `Unresolved` | `NoBinding` installs only where the rendered authority is also `Unresolved` | Frontend, ordering then identity | A late mount-time snapshot never replaces a `Ready(A)` |
| 110 | A banner naming the left build while marking its verdict superseded | Currency applied to the verdict and not to the identity beside it | The projection governs the whole reading: release, build date and origin included | Decision 4 | Between an observation and the render that consumes it, the banner names no build as current, and keeps every reason it has today |
| 111 | The counter kept beside the receipt that replaced it | A boundary that adds an identity without retiring the one it supersedes | `installationGeneration` leaves all five contracts, and no installation comparison survives that is not receipt equality | Decision 1 + wire contracts | No `Math.max` over installation numbers remains anywhere in the frontend |
| 112 | A plan judged by a projection its reply does not carry | A payload rule sourcing the receipt from a projection uniformly | A snapshot's receipt comes from its response's projection; a plan's from its own identity | Decision 4b + Decision 9 | `conversion_queue_plan`, which takes no gate and delivers no authority, still yields a plan that can be judged |
| 113 | A masking window this boundary opens | `!backendUsable` outranking the lane facts, in a state this decision creates | No such state is created: the verdict arrives with the binding, so `backendUsable` is never false for want of one | Decision 1 | No window exists in which a lane fact is the real reason and a verdict is the one reported |
| 114 | React forbidden to hold the answer it must render | An exhaustive retain-list omitting the configuration snapshot | The Rust-authored snapshot and its catalog are retained as the plan answer is: kept as they arrived, never recomputed | Decision 13 | Rendering a catalog and looking a row up in it needs no exception to the retain list |
| 115 | Two discoveries for one `BEGIN` | The proof and the pre-picker courtesy each taking the gate | One acquisition answers both | Decision 10 | A single Convert click costs at most one discovery, not two |
| 116 | The slice planned as a panel-only change | A delivery rule over every gate-taker, recorded only in the panel's decision | ADR 0043's M6.4 scope names the viewer contracts the rule reaches | ADR 0043 amendment | The preview and spectrum responses, `BackendStatus`, and the five contracts losing `installationGeneration` are all inside the slice as planned |
| 117 | A catalog probed under one binding installed under another | A projection defined as "the authority as it stands" with nothing tying it to its payload | Rust builds a response's projection and payload from one observation, under one hold of the gate | Decision 4 + Decision 6 | No snapshot can be admitted as a binding it was not probed against |
| 118 | A banner asked a question it holds nothing to answer | The counter stripped from `BackendAvailabilityDto` with no receipt put in its place | The DTO carries the receipt, and currency is equality against the authority's | Decision 2 + Decision 4 | "Is this reading current?" is answerable from what the banner already holds |
| 119 | A courtesy queued on the duty's lock | A shared acquisition proposed for the mount-time check and the configuration read | They do not share one: the check waits on the gate and the probe may not, so each takes its own | Decision 11 + Decision 10 | No configuration probe ever waits on `enter_backend`, at mount or anywhere |
| 120 | A binding-only read deferred behind a discovery it does not need | Duty-first ordering applied to a read that takes no gate | The ordering is about the gate, so a `NoInstallation` read is issued immediately | Frontend reconciliation | A session bound to no installation renders `UnavailableForBinding` without waiting for a check |
| 121 | A contention refusal shown to a reader who asked for nothing | An outcome rule written as though every request were a press | An outcome is shown to whoever made the request; an automatic read's refusal moves the obligation | Frontend, ordering then identity | A settings read refused by a held gate puts no error on screen; an explicit retry's refusal does |
| 122 | A plan stamped for a binding it was not computed under | A receipt expected from a call that observes nothing | The binding is part of the question the frontend asks, echoed back, never taken from ambient authority | Decision 9 | `conversion_queue_plan` runs no discovery and stamps no receipt of its own; a binding that changed under the request makes the reply stale |

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
