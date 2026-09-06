import type { BackendAuthorityProjection, BackendBindingReceipt } from "./contracts";

/**
 * Two questions, and one field cannot answer both.
 *
 * *Is this answer newer than what I am showing?* is ordering, and only the
 * revision answers it. *Does this payload belong to the installation I am bound
 * to?* is identity, and only the receipt answers it. A receipt is opaque, so it
 * can say that two things differ and can never say which of them is newer:
 * replies cross the boundary out of order, and
 *
 * ```text
 * rendered   = B
 * late reply = A
 * A !== B
 * ```
 *
 * proves a mismatch, not that A supersedes B. Invalidating on inequality alone
 * would let a delayed answer about the build the session has already left
 * revoke the build it is on.
 *
 * So Rust authors the order and this module applies it — ordering first, then
 * identity, each by its own field.
 */

/**
 * The projection this document is rendering, whole.
 *
 * Not merely the revision and the receipt it compares with. Three separate
 * rules read the rest of it: whether the backend is usable is a conjunction
 * over the state, the binding *and* the verdict; the configuration read's
 * admission exemption asks whether the rendered binding names no installation;
 * and the reconciliation asks whether the session has resolved anything at all.
 * Keeping only the two tokens would forbid all three.
 */
export type RenderedAuthority = BackendAuthorityProjection;

/** Which binding a projection names, where it names one. */
export function receiptOf(authority: BackendAuthorityProjection): BackendBindingReceipt | null {
  return authority.state.state === "settled" ? authority.state.receipt : null;
}

/**
 * Whether this session may run backend work on the build it is bound to.
 *
 * A conjunction, stated once and read from the authority rather than off a
 * verdict block. Quarantine is a conjunct of its own because it is a statement
 * about the *session* — a session that lost track of a converter keeps a
 * projection that is perfectly true about the build, and says nothing about the
 * process MSCanvas can no longer account for.
 *
 * Reading it off the availability reading instead is how quarantine used to
 * reach this: `quarantined_availability()` short-circuits that whole block to
 * `unavailable`, and everything downstream inherited the answer by accident.
 */
export function backendIsUsable(
  authority: RenderedAuthority | null,
  quarantined: boolean,
): boolean {
  return (
    !quarantined &&
    authority !== null &&
    authority.state.state === "settled" &&
    authority.state.binding === "installed" &&
    authority.state.previewAvailability === "usable"
  );
}

/** Whether the rendered binding names no installation at all. */
export function bindsNoInstallation(authority: RenderedAuthority | null): boolean {
  return (
    authority !== null &&
    authority.state.state === "settled" &&
    authority.state.binding === "noInstallation"
  );
}

/** What an arriving projection is, relative to what is on screen. */
export type ProjectionVerdict =
  /** Older than what is rendered, or the publication already accepted. */
  | { readonly accepted: false }
  /**
   * Rust-authored news. `bindingReplaced` says whether it names a different
   * installation, which is what invalidates everything read from the previous
   * one — not the revision advancing, because a verdict can move at one
   * receipt and that is news about a build rather than a different build.
   */
  | { readonly accepted: true; readonly bindingReplaced: boolean };

/**
 * Step one, and step two's trigger.
 *
 * With nothing rendered there is no revision to be older than, so the first
 * projection a session receives is accepted and compared against an empty
 * binding — which is how the first binding is installed at all.
 */
export function acceptProjection(
  rendered: RenderedAuthority | null,
  incoming: BackendAuthorityProjection,
): ProjectionVerdict {
  if (rendered === null) {
    return { accepted: true, bindingReplaced: false };
  }
  if (incoming.revision <= rendered.revision) {
    return { accepted: false };
  }
  return { accepted: true, bindingReplaced: receiptOf(incoming) !== receiptOf(rendered) };
}

/**
 * Step three: whether a payload describes the binding now rendered.
 *
 * By receipt alone, whatever the revision did. A payload that describes another
 * binding is discarded — and where some surface was waiting for it, that
 * surface is told so rather than left waiting.
 *
 * Not for the payloads that are *historical* facts about work already done: a
 * queue's own receipt and a conversion report's are expected to differ from the
 * binding in use once the installation has changed, and judging them by this
 * would discard the record of what actually ran.
 */
export function describesRenderedBinding(
  rendered: RenderedAuthority | null,
  payload: BackendBindingReceipt | null,
): boolean {
  return rendered !== null && payload !== null && payload === receiptOf(rendered);
}

/**
 * Whether a rendered reading has stopped describing the session.
 *
 * The whole reading, not only its verdict: the release, the build date and the
 * origin describe a build as much as "available" does, and a banner that marked
 * the verdict superseded while still naming the installation the session has
 * left would close half the defect.
 *
 * Currency is the *revision*, not receipt equality. A verdict can move while the
 * receipt stands still — a truncated help stream is the case that does it — and
 * the operation that saw it returns a new projection without producing a new
 * reading. Judged by receipt the old banner would stay current and no check
 * would be owed, so it would go on saying `available` after the session had
 * already stopped offering anything.
 */
export function readingIsSuperseded(
  rendered: RenderedAuthority | null,
  reading: BackendAuthorityProjection,
): boolean {
  return rendered !== null && reading.revision !== rendered.revision;
}
