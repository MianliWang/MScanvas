/**
 * When the banner's reading has stopped describing the session, and when a
 * replacement for it may be asked for.
 *
 * ADR 0044 Decision 4's residual, and Decision 4b's step three. Accepting a
 * delivered projection moves the *authority*; it does not produce a
 * `BackendAvailabilityDto`, because the operation that delivered it produced no
 * reading. So the reading on screen becomes superseded, and something has to
 * replace it — otherwise the banner names a build the session has left until a
 * reader presses `Check again` by hand.
 *
 * **This is not a second reconciliation system.** It launches nothing on
 * acceptance, holds no watermark of its own, and answers no question the
 * authority already answers. It reads two things the frontend is already
 * rendering — the accepted projection, and the reading beside it — and says
 * whether one is owed. Four questions stay apart:
 *
 * ```text
 * which authority publication is newer?   -> BackendAuthorityRevision
 * which binding does this payload name?   -> BackendBindingReceipt
 * is this banner reading current?         -> here
 * does this plan answer its question?     -> the plan's own identity
 * ```
 *
 * Currency is the **revision**, not receipt equality, and that is the case this
 * exists for: a verdict can move while the receipt stands still — a truncated
 * help stream is the one that does it — and the operation that saw it returns a
 * new projection without producing a new reading. Judged by receipt the old
 * banner would stay current, no check would be owed, and it would go on saying
 * `available` after this session had already stopped offering anything.
 */

import type { BackendAuthorityProjection } from "./contracts";
import type { RenderedAuthority } from "./backendAuthority";
import type { ProbeAdmissionFacts } from "./conversionConfigurationAuthority";

/**
 * The facts a remedial check consults before it is dispatched.
 *
 * Decision 4's "*may it be issued*" is nearly one question for the check and
 * the configuration probe, over the same process-ownership projection and no
 * verdict — so this is that projection, minus the one place they part.
 *
 * **Quarantine is deliberately absent.** A quarantined session *answers*
 * `inspect_backend` rather than refusing it — Rust replies from what it already
 * holds and launches nothing — so a check refused for quarantine would be a
 * check refused for the very condition it is able to report. The probe asks it
 * because a quarantined session will not start one.
 *
 * `backendUsable` is absent for the reason it is absent from the probe's list:
 * it is a judgement rather than process ownership. Here it would be worse than
 * redundant — the verdict a stale reading carries is exactly what this check
 * exists to repair, so gating on it would let a wrong verdict prevent its own
 * correction.
 */
export type BackendCheckFacts = Omit<ProbeAdmissionFacts, "backendQuarantined">;

/** Why a remedial check may not be dispatched now, in the shared order. */
export type BackendCheckRefusal =
  | "backendChanging"
  | "laneClaimed"
  | "previewReading"
  | "probeInFlight";

/**
 * The one order these facts are consulted in.
 *
 * `ConversionLane`'s own order, restricted to what this check is entitled to
 * consider — the same restriction and the same order the probe uses, so a
 * moment both defer on is named identically by both.
 */
const CHECK_REFUSAL_ORDER: readonly BackendCheckRefusal[] = [
  "backendChanging",
  "laneClaimed",
  "previewReading",
  "probeInFlight",
];

/**
 * The subset of that order this obligation may be *woken* by.
 *
 * `backendChanging` is missing, and its absence is the loop bound. Every
 * frontend-issued check raises that fact and clears it in a `finally`, so the
 * clearing is a lane fact ceasing to refuse — an occasion by the definition
 * below, produced by the attempt itself. An obligation is never woken by an
 * occasion its own attempt produced, whatever became of that attempt, so a
 * check whose request fails is not re-issued by its own cleanup at IPC speed.
 *
 * Nothing real is lost by the exclusion. Every other path that raises
 * `backendChanging` — the mount check, a reader's `Check again`, choosing an
 * installation — either delivers a reading, which discharges this obligation
 * outright, or fails, which leaves the banner on its last reading with those
 * same controls live. That floor is a control the reader can press, which is
 * what Decision 4 asks for and what an automatic retry would replace with a
 * storm.
 */
const CHECK_OCCASION_FACTS: readonly BackendCheckRefusal[] = [
  "laneClaimed",
  "previewReading",
  "probeInFlight",
];

/**
 * Whether a remedial check may be dispatched now, and why not where it may not.
 *
 * A courtesy over the frontend's own projection, exactly like the probe's:
 * **it is not an atomic acquisition of Rust's gate**, and it does not claim to
 * have removed every race. What it establishes is that no check is knowingly
 * dispatched behind a holder this document has been told about. Rust remains
 * the admission and serialisation authority, and refuses or waits on its own
 * terms in the window this projection is allowed to be stale in.
 */
export function backendCheckAdmission(facts: BackendCheckFacts): BackendCheckRefusal | null {
  return CHECK_REFUSAL_ORDER.find((reason) => facts[reason]) ?? null;
}

/**
 * Whether the world moved in a way that wakes an owed check.
 *
 * "Stops refusing" rather than "goes false", so a fact becoming true is never
 * mistaken for one — and over {@link CHECK_OCCASION_FACTS} rather than the full
 * admission order, so this obligation is never woken by its own attempt.
 */
export function checkOccasionPassed(
  previous: BackendCheckFacts,
  next: BackendCheckFacts,
): boolean {
  return CHECK_OCCASION_FACTS.some((reason) => previous[reason] && !next[reason]);
}

/**
 * The projection a rendered reading was taken at, where a reading is rendered.
 *
 * `null` for every state that is not a reading: a check in flight and a check
 * that failed are both *the absence of a reading*, which is one of the
 * conditions that owes one.
 */
export type RenderedReading = BackendAuthorityProjection | null;

/**
 * Whether the banner owes a reading it does not have.
 *
 * Two conditions, both Decision 4's:
 *
 * ```text
 * no rendered reading at all      -> owed
 * a reading at another revision   -> owed
 * ```
 *
 * Nothing is owed while the session has resolved nothing: a session with no
 * authority yet owes the *mount* check, which is a different obligation with
 * different dispatch exemptions, and answering for it here would issue two.
 *
 * And nothing is owed for the receipt. A payload's binding and a reading's
 * currency are different questions, and a reading may name the right binding
 * while describing a publication the session has moved past.
 */
export function readingCheckIsOwed(
  rendered: RenderedAuthority | null,
  reading: RenderedReading,
): boolean {
  if (rendered === null) {
    return false;
  }
  return reading === null || reading.revision !== rendered.revision;
}

/**
 * Whether the reading on screen has stopped describing the session.
 *
 * The same comparison, asked by the banner rather than by the obligation, so
 * the sentence a reader sees and the work this document owes cannot come apart.
 * A superseded reading is superseded **entire**: the release, the build date
 * and the origin describe a build as much as the verdict does, and marking only
 * the verdict stale would leave the installation the session has left named as
 * the current one (ledger row 110).
 */
export function readingIsStale(
  rendered: RenderedAuthority | null,
  reading: RenderedReading,
): boolean {
  return rendered !== null && reading !== null && reading.revision !== rendered.revision;
}
