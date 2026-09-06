import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Whether a conversion-configuration probe is occupying the backend process
 * lane.
 *
 * **This is not probe admission, and the distinction is the whole reason the
 * module exists.**
 *
 * ```text
 * ConversionLane.configurationProbing
 *     answers: "is a configuration probe occupying the process lane?"
 *
 * ConversionConfigurationProbeAdmission
 *     answers: "may a new configuration probe acquire that lane?"
 * ```
 *
 * Neither answers for the other. Admission is ADR 0044 Decision 11's rule over
 * Rust's backend gate and its quarantine boundary, and it stays in
 * `conversionConfigurationAuthority.ts`. What is here is an *occupancy*: one
 * `msconvert --help` read has been admitted and has not yet settled, which is
 * backend process work and therefore refuses a conversion for its duration
 * (Decision 10, ledger rows 79 and 187 — ADR 0043 forbids offering an action
 * the operation will refuse, and Rust's gate does refuse it).
 *
 * It says exactly that, and deliberately none of these:
 *
 * ```text
 * the configuration is loading
 * the configuration is unavailable
 * the backend is changing
 * the backend is unusable
 * a configuration probe may or may not start
 * ```
 *
 * The claim is held here rather than inside `useConversionConfiguration`
 * because it is read by two consumers that hook cannot reach: the rendered
 * conversion lane, and the conversion operation's synchronous dispatch guard —
 * which is created *before* the configuration hook, since the configuration
 * hook consumes the lane's own `laneClaimed`. Hoisting the claim is what breaks
 * that circle without either side re-deciding the fact.
 */

/** The occupancy, as its owner and its readers each need it. */
export interface ConversionProbeLane {
  /**
   * Whether a probe owns the lane, as a render sees it.
   *
   * The rendered twin of {@link probingRef}. The two are written together, in
   * one place, so a surface and a dispatch guard cannot come to disagree about
   * one fact — the M6.1 pattern every other lane fact here already follows.
   */
  readonly probing: boolean;
  /**
   * The same fact, as it stands now.
   *
   * A dispatch that read the rendered value would decide from whatever was
   * true when its closure was made. A probe issued from an effect raises the
   * claim before React commits anything, and the very next activation has to
   * see it.
   */
  readonly probingRef: { readonly current: boolean };
  /**
   * Claims the lane for one probe, and names that probe.
   *
   * Synchronous: the claim is raised before the request leaves, not when its
   * promise is created a microtask later and not when an effect observes it.
   * The token returned is the claim's identity, and only its holder may lower
   * it.
   */
  readonly claim: () => number;
  /**
   * Releases the claim, if this probe still holds it.
   *
   * Keyed on the token rather than on a bare boolean, because a probe that has
   * lost request authority still settles: its promise resolves, rejects or is
   * abandoned by an unmounting document, and a `false` written from any of
   * those would clear a claim a *newer* probe is relying on. A stale release
   * is a statement about work nobody is waiting for, and it says nothing about
   * the lane.
   */
  readonly release: (token: number) => void;
}

/**
 * Holds the conversion-configuration probe occupancy for one panel.
 *
 * Owns nothing else. It does not decide whether a probe may run, does not
 * issue one, and does not know what a probe answered — those belong to
 * admission, to `useConversionConfiguration` and to Rust respectively.
 */
export function useConversionProbeLane(): ConversionProbeLane {
  const [probing, setProbing] = useState(false);
  const probingRef = useRef(false);
  /**
   * Which probe holds the claim, or `null` while the lane is free.
   *
   * A monotonic ordinal that is never reset, so a token can name exactly one
   * probe for the life of the panel and a late reply can always be told from
   * the claim standing now.
   */
  const held = useRef<number | null>(null);
  const issued = useRef(0);

  const claim = useCallback(() => {
    issued.current += 1;
    held.current = issued.current;
    // Written together, so the two readings are one fact rather than two that
    // resemble each other.
    probingRef.current = true;
    setProbing(true);
    return issued.current;
  }, []);

  const release = useCallback((token: number) => {
    if (held.current !== token) {
      return;
    }
    held.current = null;
    probingRef.current = false;
    setProbing(false);
  }, []);

  return useMemo(
    () => ({ probing, probingRef, claim, release }),
    [claim, probing, release],
  );
}
