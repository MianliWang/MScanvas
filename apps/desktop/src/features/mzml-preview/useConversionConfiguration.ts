import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PreviewApi } from "./api";
import { receiptOf, type RenderedAuthority } from "./backendAuthority";
import type {
  BackendAuthorityProjection,
  ConversionCatalogRow,
  ConversionConfiguration,
} from "./contracts";
import {
  admissionStoppedRefusing,
  probeAdmission,
  readBypassesAdmission,
  readIsOwed,
  retryIsOffered,
  type ConfigurationHolding,
  type ProbeAdmissionFacts,
  type ProbeRefusal,
} from "./conversionConfigurationAuthority";
import { catalogRow, reselect } from "./conversionIntentSelection";
import type { ConversionProbeLane } from "./useConversionProbeLane";

/** The facts this hook does not own, as a render sees them. */
export type ConversionConfigurationEnvironment = Omit<ProbeAdmissionFacts, "probeInFlight">;

/** What conversion settings this document may render, and what it may press. */
export interface ConversionConfigurationView {
  /**
   * The Rust-authored configuration for the binding on screen, kept as it
   * arrived and never recomputed.
   *
   * `null` where this document holds nothing for that binding — which is an
   * observation about itself rather than a judgement about the configuration.
   * It asks; it does not decide.
   */
  readonly configuration: ConversionConfiguration | null;
  /** The rows of a ready catalog, or none while there is no catalog. */
  readonly catalog: readonly ConversionCatalogRow[];
  /** The combination MSCanvas ships, as the catalog names it. */
  readonly shippedIntentId: string | null;
  /** Which combination is selected, or `null` while there is no catalog. */
  readonly selectedIntentId: string | null;
  /** Selects one admitted combination. Refused where the catalog has no such row. */
  readonly select: (intentId: string) => void;
  /** Whether a settings read is in flight. */
  readonly reading: boolean;
  /** Why an attempt would be refused right now, or `null` where it would not. */
  readonly refusal: ProbeRefusal | null;
  /** Whether the reader is offered a control that reads the settings again. */
  readonly retryOffered: boolean;
  /** Reads the settings again. Consults the same admission the automatic read does. */
  readonly retry: () => void;
}

/**
 * Holds the conversion configuration for the binding this document is
 * rendering, and asks Rust for it when one is owed.
 *
 * **This hook decides nothing about the configuration.** Rust owns the
 * lifecycle; what is here is a snapshot kept as it arrived, bookkeeping about
 * this document's own in-flight work, and the reader's selected combination.
 * The four refs a previous round rebuilt this from — which binding was served,
 * which had been automatically attempted, which catalog generation was
 * installed, whether a standing catalog still described the current binding —
 * are gone, and their disagreement with them.
 */
export function useConversionConfiguration(
  api: PreviewApi,
  /** The projection this document is rendering. */
  authority: RenderedAuthority | null,
  environment: ConversionConfigurationEnvironment,
  /**
   * The process-lane occupancy this document's probes claim, and claim it in.
   *
   * Owned above this hook rather than inside it, because a running probe is
   * backend process work and refuses a conversion for its duration -- so the
   * conversion lane and the conversion operation's dispatch guard both read it,
   * and both are built before this hook is. What this hook does with it is
   * raise the claim at an admitted dispatch and release its own claim when that
   * exact probe settles; it never reads the claim to decide whether a probe may
   * *start*, which is `probeAdmission`'s question and nothing else's.
   */
  probeLane: ConversionProbeLane,
  /** Where the projection this read observes is delivered. */
  onAuthority: (authority: BackendAuthorityProjection) => void,
): ConversionConfigurationView {
  const [held, setHeld] = useState<ConfigurationHolding>({
    receipt: null,
    configuration: null,
    lastAttemptRefused: false,
  });
  // The probe occupancy, rendered and as it stands now. Both halves come from
  // the lane above: this hook holds no second copy of a fact two other
  // authorities read, and the ref is what stops a second read being issued from
  // the same render pass that started the first -- the effect below runs after
  // a commit, so the rendered half is a commit too late for that.
  const reading = probeLane.probing;
  const readingRef = probeLane.probingRef;
  // Destructured because they are stable for the life of the panel while the
  // lane object is not: it carries the rendered fact, so it is a new value on
  // every claim and release. Depending on the whole of it would re-create the
  // issuing callback -- and re-run the effect that reads it -- twice per probe,
  // for no change in what either does.
  const { claim: claimProbeLane, release: releaseProbeLane } = probeLane;
  /**
   * The binding this document last attempted a read for, and the facts it
   * attempted under.
   *
   * Bookkeeping about its own work, and the thing that makes refusing safe. An
   * attempt that is refused -- by this side's own admission, by Rust's, or by a
   * request that could not be made at all -- leaves the read owed, and what
   * re-issues it is an *occasion*: a lane fact that was refusing ceasing to
   * refuse, or the binding itself changing. Without this, the answer to the
   * last attempt would itself re-trigger the next one, and a session whose
   * settings cannot be read would ask for ever.
   */
  const lastAttempt = useRef<{
    receipt: number | null;
    facts: ProbeAdmissionFacts;
  } | null>(null);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const facts = useMemo<ProbeAdmissionFacts>(
    () => ({ ...environment, probeInFlight: reading }),
    [environment, reading],
  );
  const refusal = probeAdmission(facts);

  const issue = useCallback(() => {
    // Raised synchronously, before the request leaves. A guard that waited for
    // an effect or for a promise callback would leave a window in which the
    // process lane is claimed and nothing on this side knows it.
    const claim = claimProbeLane();
    void api
      .readConversionConfiguration()
      .then((snapshot) => {
        if (!mounted.current) {
          return;
        }
        // The projection first, because it may be the news: a settings read
        // performs its own discovery and can be the operation that observes a
        // replacement.
        onAuthority(snapshot.authority);
        // And the payload by its own rule. A snapshot's receipt is read from
        // the projection that arrived with it, which describes the same
        // instant -- Rust builds both from one reading of the authority, so a
        // catalog probed under A cannot travel under a projection of B.
        setHeld({
          receipt: receiptOf(snapshot.authority),
          configuration: snapshot.configuration,
          lastAttemptRefused: snapshot.outcome.outcome === "refused",
        });
      })
      .catch(() => {
        // A read that could not be made says nothing about the binding, so
        // nothing is written for it. It stays owed, and the next occasion
        // asks again.
        if (mounted.current) {
          setHeld((previous) => ({ ...previous, lastAttemptRefused: true }));
        }
      })
      .finally(() => {
        // Released by token, so this settlement lowers only its own claim. A
        // probe that has lost request authority still settles, and a bare
        // boolean lowered here would hand the lane back while a newer probe
        // was still holding it. Not conditioned on `mounted` either: the lane
        // outlives this hook, and a claim left standing by an unmounting
        // document would refuse every conversion for the rest of the session.
        releaseProbeLane(claim);
      });
  }, [api, claimProbeLane, onAuthority, releaseProbeLane]);

  // Step three: issue what is owed, into a lane this document's projection says
  // is free.
  //
  // The occasions are the dependencies. A gate-taker's answer moves the
  // authority or what is held; a lane fact ceasing to refuse moves the
  // environment. A conversion-state poll that finds nothing changed moves
  // neither, which is exactly why a read deferred by a running drain is not
  // re-issued on every tick of that drain's own polling.
  useEffect(() => {
    if (readingRef.current || !readIsOwed(authority, held)) {
      return;
    }
    const receipt = authority === null ? null : receiptOf(authority);
    const previous = lastAttempt.current;
    const firstForThisBinding = previous === null || previous.receipt !== receipt;
    if (!firstForThisBinding && !admissionStoppedRefusing(previous.facts, facts)) {
      return;
    }
    // Recorded whether or not it runs. A refusal is an attempt for this
    // purpose: what it establishes is that asking again now would be refused
    // again, and the next occasion is what changes that.
    lastAttempt.current = { receipt, facts };
    if (!readBypassesAdmission(authority) && probeAdmission(facts) !== null) {
      return;
    }
    issue();
  }, [authority, facts, held, issue]);

  // What is held describes the binding it was read for. Where the session has
  // moved on, this document holds nothing for the binding on screen -- which is
  // the state that owes a read, and is never papered over with the previous
  // binding's answer.
  const configuration =
    authority !== null && held.receipt !== null && held.receipt === receiptOf(authority)
      ? held.configuration
      : null;
  const ready = configuration?.configuration === "ready" ? configuration : null;
  const catalog = ready?.catalog ?? [];
  const shippedIntentId = ready?.shipped ?? null;

  // The reader's combination survives a catalog arriving for another
  // installation wherever the new catalog still holds it, and falls back only
  // where it does not. Derived rather than stored so a catalog and a selection
  // cannot come apart: there is no moment where one has been installed and the
  // other has not.
  const selected =
    shippedIntentId === null ? null : reselect(catalog, shippedIntentId, selectedIntentId);

  const select = useCallback(
    (intentId: string) => {
      // Refused where the catalog has no such row. A selection this side
      // invented would be a combination Rust never admitted, and the whole
      // point of choosing by identity is that the identity came from Rust.
      if (catalogRow(catalog, intentId) !== null) {
        setSelectedIntentId(intentId);
      }
    },
    [catalog],
  );

  const retryOffered = retryIsOffered(held, reading);
  const retry = useCallback(() => {
    if (!retryOffered || probeAdmission(facts) !== null) {
      return;
    }
    issue();
  }, [facts, issue, retryOffered]);

  return {
    configuration,
    catalog,
    shippedIntentId,
    selectedIntentId: selected,
    select,
    reading,
    refusal,
    retryOffered,
    retry,
  };
}
