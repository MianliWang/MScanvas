import { useEffect, useRef } from "react";

import type { BackendCheckFacts } from "./backendReadingObligation";
import { backendCheckAdmission, checkOccasionPassed } from "./backendReadingObligation";

/**
 * Issues the backend check a superseded banner reading owes, once per occasion.
 *
 * ADR 0044 Decision 4b's step three, for the one obligation that had no owner:
 * a projection delivered by an operation that produced no reading leaves the
 * banner describing a publication the session has moved past, and nothing
 * replaced it.
 *
 * **It is not a refresh policy.** It does not run on acceptance, does not run
 * on delivery, and holds no watermark: whether a check is owed is *read* from
 * the accepted authority and the rendered reading on every render, and this
 * hook adds only the three pieces of bookkeeping Decision 13 grants an
 * obligation — the facts its last attempt went out under, whether an occasion
 * has passed since, and (through `backendChanging`) whether one is in flight.
 *
 * The two bounds are the ones an unbounded step three fails on:
 *
 * ```text
 * an obligation is never woken by an occasion its own attempt produced
 *   -- so a check whose request fails is not re-issued by its own cleanup
 *      clearing `backendChanging`, for ever, at IPC speed
 *
 * an independent occasion that passes while an attempt is outstanding is not lost
 *   -- a drain that ends while a failing request is still in the air has moved
 *      the world, and the answer that lands afterwards lands into that world
 * ```
 *
 * The first is the exclusion in `checkOccasionPassed`; the second is the bit
 * below, which is why observing occasions and deciding to issue are two steps
 * here rather than one comparison at dispatch.
 */
export function useBackendReadingObligation(
  /** Whether the banner's reading has stopped describing the session. */
  owed: boolean,
  /**
   * The process-ownership facts, as a render sees them.
   *
   * Rendered rather than read from refs, and that is safe here for a reason
   * worth stating: this obligation is the *first* thing dispatched in a commit
   * where several may be owed, so there is nothing earlier in the same commit
   * whose claim a rendered value could miss. What comes after it -- the
   * configuration probe -- reads synchronously, because by then there is.
   */
  facts: BackendCheckFacts,
  /** Asks Rust for a current reading. Raises `backendChanging` for its duration. */
  check: () => void,
): void {
  /**
   * The facts the last attempt went out under, or `null` while none has.
   *
   * Recorded whether or not the attempt ran. A refusal is an attempt for this
   * purpose: what it establishes is that asking again *now* would be refused
   * again, and what changes that is the fact that refused it ceasing to.
   */
  const lastAttempt = useRef<BackendCheckFacts | null>(null);
  /**
   * Whether an occasion has passed since that attempt went out.
   *
   * One bit, and it is what separates a reorder from a spin. A gate holder that
   * finishes while a failing request is still in flight produces no transition
   * this obligation can see at the moment the failure lands -- by then the fact
   * has been false for several renders -- so the transition is recorded when it
   * happens rather than looked for afterwards.
   */
  const occasionSince = useRef(false);
  /** The previous render's facts, so a transition can be seen at all. */
  const previousFacts = useRef<BackendCheckFacts | null>(null);

  useEffect(() => {
    // Occasions are observed on every render, whatever is owed and whatever is
    // in flight. An obligation that only looked for one at the moment it wanted
    // to issue would miss every occasion that passed while it was waiting.
    const previous = previousFacts.current;
    if (previous !== null && checkOccasionPassed(previous, facts)) {
      occasionSince.current = true;
    }
    previousFacts.current = facts;

    if (!owed) {
      // Discharged. A later supersession is a new obligation and starts from
      // nothing, rather than inheriting a bound recorded for a different one.
      lastAttempt.current = null;
      occasionSince.current = false;
      return;
    }

    // `backendChanging` is in the admission, so a check already in flight --
    // this obligation's, the mount's, a reader's, or an installation change's
    // -- refuses this one. There is no second in-flight flag: one fact, one
    // owner.
    if (backendCheckAdmission(facts) !== null) {
      lastAttempt.current = facts;
      return;
    }

    const attempted = lastAttempt.current;
    if (
      attempted !== null &&
      !occasionSince.current &&
      !checkOccasionPassed(attempted, facts)
    ) {
      // Nothing has happened since the last attempt, so asking again would ask
      // the same question of the same world. The reader's own `Check again` is
      // the floor, and it is live.
      return;
    }

    lastAttempt.current = facts;
    occasionSince.current = false;
    check();
  }, [check, facts, owed]);
}
