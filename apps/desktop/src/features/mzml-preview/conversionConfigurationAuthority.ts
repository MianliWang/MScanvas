/**
 * When a conversion-configuration read may be attempted, and when one is owed.
 *
 * Two rules, kept apart because they answer different questions and a single
 * one answered neither well.
 *
 * **Admission** asks *may another backend process begin right now?* It is not
 * `ConversionLane`, which asks *may a conversion action start?* and begins with
 * a preview verdict — putting that verdict in the permission path for an
 * `msconvert` probe would make preview usability decide whether conversion
 * settings may be read, which is the conflation this whole area exists to
 * remove. Both consume the same shared backend-process ownership facts; neither
 * is authority for the other.
 *
 * **The obligation** asks *does the binding on screen still owe its first
 * read?* — and it is *read*, never derived. The snapshot a binding carries says
 * for itself whether its catalog has been read: `unattempted` says it has not,
 * `ready` and `failed` say it has. The one case with nothing to read from —
 * holding no snapshot for the binding at all — is not a judgement about the
 * configuration but an observation about this frontend's own state: it has
 * nothing for the binding on screen, so it asks.
 *
 * Neither rule is a permission. Rust's backend gate and its quarantine boundary
 * are the authority, and refuse a probe whose projection here was wrong or
 * stale; this is a courtesy that keeps the interface from offering an action
 * that is known to be refused.
 */

import { bindsNoInstallation, receiptOf, type RenderedAuthority } from "./backendAuthority";
import type { ConversionConfiguration } from "./contracts";

/**
 * The facts that name an operation genuinely owning a backend process.
 *
 * A fact belongs here exactly when Rust would itself refuse a backend process
 * for it. Adoption, the diagnostics export and ordinary workspace settling own
 * no backend process and are deliberately absent; so is the preview "usable"
 * verdict, which is a judgement rather than ownership.
 */
export interface ProbeAdmissionFacts {
  /** The session has lost track of a converter. No waiting clears it. */
  readonly backendQuarantined: boolean;
  /** A backend installation check or change is in progress. */
  readonly backendChanging: boolean;
  /**
   * A conversion owns the backend lane.
   *
   * Broader than the gate: it is also true while the destination picker is
   * open, which owns nothing. Taken whole all the same — a courtesy is allowed
   * to be conservative, deferring a probe a moment longer than Rust would, and
   * what makes that safe rather than a stall is that a lane fact ceasing to
   * refuse is itself an occasion, so the picker closing issues the deferred
   * read without waiting for anything to answer.
   */
  readonly laneClaimed: boolean;
  /** A preview run or scan is being read. */
  readonly previewReading: boolean;
  /** Another configuration probe is already in flight. */
  readonly probeInFlight: boolean;
}

/** Why a probe may not begin now, in the order the facts are consulted. */
export type ProbeRefusal =
  "backendQuarantined" | "backendChanging" | "laneClaimed" | "previewReading" | "probeInFlight";

/**
 * The one order these facts are consulted in.
 *
 * `laneClaimed` before `previewReading` deliberately: they are independent and
 * routinely true together, so the other order would key one moment as
 * "preview running" while the lane called it "conversion running". This is not
 * decorative — it is the whole mechanism by which one moment has one reason.
 * Probe-in-flight is last because it is the narrowest fact here.
 */
const REFUSAL_ORDER: readonly ProbeRefusal[] = [
  "backendQuarantined",
  "backendChanging",
  "laneClaimed",
  "previewReading",
  "probeInFlight",
];

/**
 * Whether a configuration probe may begin, and why not where it may not.
 *
 * One question with one answer, whoever asks. The automatic first read for a
 * binding and an explicit settings retry differ in what *initiates* them and in
 * nothing else — there is not an automatic rule and a retry rule.
 */
export function probeAdmission(facts: ProbeAdmissionFacts): ProbeRefusal | null {
  return REFUSAL_ORDER.find((reason) => facts[reason]) ?? null;
}

/** What this frontend holds for a binding, and how it came to hold it. */
export interface ConfigurationHolding {
  /** Which binding the snapshot below describes, where one is held. */
  readonly receipt: number | null;
  readonly configuration: ConversionConfiguration | null;
  /**
   * Whether the last attempt for this binding was refused before it ran.
   *
   * Bookkeeping about this frontend's own work, which nothing else can know:
   * Rust's `unattempted` says the catalog is unread and cannot say whether
   * anybody has tried. It is what separates "the automatic read has not
   * happened yet" from "the automatic read was refused", and only the second
   * offers the reader a control to press.
   */
  readonly lastAttemptRefused: boolean;
}

/**
 * Whether the binding on screen owes a configuration read.
 *
 * Nothing is owed while no binding is rendered: a read is issued only for a
 * binding, and what an unresolved session owes is a backend check instead.
 *
 * Holding a snapshot for a *different* binding is the same as holding none.
 * The previous binding's configuration stopped being an answer the moment the
 * receipt was replaced, and asking again is the same act as a mount, one
 * binding later.
 */
export function readIsOwed(
  rendered: RenderedAuthority | null,
  held: ConfigurationHolding,
): boolean {
  const binding = rendered === null ? null : receiptOf(rendered);
  if (binding === null) {
    return false;
  }
  if (held.receipt !== binding || held.configuration === null) {
    return true;
  }
  return held.configuration.configuration === "unattempted";
}

/**
 * Whether a configuration read may be issued for the binding on screen without
 * consulting admission.
 *
 * A binding that names no installation launches no probe: its configuration
 * follows from the binding alone, and Rust answers it from the authority's own
 * lock. Deferring it behind somebody else's conversion would leave the panel
 * with no configuration state for the length of that drain — a state this side
 * is forbidden to fill in from the binding tag itself.
 */
export function readBypassesAdmission(rendered: RenderedAuthority | null): boolean {
  return bindsNoInstallation(rendered);
}

/**
 * Whether the reader is offered a control that reads the settings again.
 *
 * Offered exactly where the binding has **an answer it could improve on** and
 * no probe is in flight: `failed`, whose answer is that there is none, and an
 * `unattempted` whose automatic read was refused.
 *
 * Never from `unavailableForBinding`, which is not a state a read can improve —
 * it follows from the binding, and only a different binding changes it. And
 * never from an `unattempted` nothing has tried yet, where the automatic read
 * is the thing about to happen and a control would ask for it twice.
 */
export function retryIsOffered(held: ConfigurationHolding, probeInFlight: boolean): boolean {
  if (probeInFlight || held.configuration === null) {
    return false;
  }
  switch (held.configuration.configuration) {
    case "failed":
      return true;
    case "unattempted":
      return held.lastAttemptRefused;
    default:
      return false;
  }
}

/**
 * Whether the world moved in a way that releases a deferred read.
 *
 * A lane fact that *was* refusing ceasing to refuse — "stops refusing" rather
 * than "goes false", so that a fact becoming true is never mistaken for one.
 * Any such fact, not only the one this obligation happened to be deferred on:
 * the frontend observes this in its own render and needs nothing from Rust for
 * it.
 *
 * This is what makes refusing safe. A read that is owed and cannot run now stays
 * owed; nothing re-asks on a timer, and nothing re-asks because the *answer to
 * the last attempt* arrived — which would be this document reacting to its own
 * bookkeeping and asking again immediately, for ever.
 *
 * Deliberately not every change. A conversion-state poll delivers and wakes
 * nothing, so a read deferred by a running drain is not re-issued on every tick
 * of that drain's own polling.
 */
export function admissionStoppedRefusing(
  previous: ProbeAdmissionFacts,
  next: ProbeAdmissionFacts,
): boolean {
  return REFUSAL_ORDER.some((reason) => previous[reason] && !next[reason]);
}
