import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePreviewApi } from "./api";
import type {
  ConversionConflictPolicy,
  ConversionPlanSummary,
  PreviewError,
  WorkspaceConversionState,
  WorkspaceConversionUpdate,
} from "./contracts";
import { toPreviewError } from "./contracts";

/**
 * How often the slot is re-read while something is under way.
 *
 * There is no push channel here on purpose. A conversion has one slot and two
 * observable transitions, so the interface needs an answer on mount and an
 * answer while something runs — which a read is, and a second Channel, a second
 * reservation protocol and a second document proof are not.
 *
 * Two seconds because the state being polled is coarse: awaiting a folder,
 * running, done. Nothing here reports a fraction, so a faster poll would buy a
 * more precise answer to a question nobody is asking.
 */
const POLL_INTERVAL_MS = 2_000;

/** The plan summary for one row, and how the reading of it went. */
export type ConversionPlanState =
  | { readonly status: "none" }
  | { readonly status: "loading"; readonly handle: string }
  | { readonly status: "loaded"; readonly plan: ConversionPlanSummary }
  | { readonly status: "failed"; readonly handle: string; readonly error: PreviewError };

export interface ConversionOperation {
  /** The authoritative slot, as Rust last reported it. */
  readonly state: WorkspaceConversionState;
  /**
   * Whether a conversion holds the workspace.
   *
   * A terminal report does not: it is a thing to read, not work in flight. This
   * is the frontend's copy of a rule Rust enforces, and it decides which
   * controls are offered rather than which are permitted.
   */
  readonly busy: boolean;
  /** The row a busy slot is working on, so a roster can pin it. */
  readonly busyHandle: string | null;
  readonly plan: ConversionPlanState;
  /** A request that never reached Rust's slot, kept apart from a conversion's own outcome. */
  readonly error: PreviewError | null;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly setConflictPolicy: (policy: ConversionConflictPolicy) => void;
  /** Describes the conversion one row would get, or clears the description. */
  readonly describe: (handle: string | null) => void;
  readonly convert: (handle: string) => void;
  readonly dismissError: () => void;
}

/**
 * The session's one conversion, as this document sees it.
 *
 * Owns its own lane: one monotonic request token per question it asks, a
 * sequence guard so a slower read cannot install an older slot, and a poll that
 * exists only while something is running. It deliberately holds no path, no
 * destination and no reservation — those live in Rust for the whole of an
 * operation, which is what lets a reload recover one it did not start.
 */
export function useConversionOperation(): ConversionOperation {
  const api = usePreviewApi();
  const [state, setState] = useState<WorkspaceConversionState>({ status: "idle" });
  const [plan, setPlan] = useState<ConversionPlanState>({ status: "none" });
  const [error, setError] = useState<PreviewError | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<ConversionConflictPolicy>("fail");
  /**
   * Bumped when an authoritative read failed, to ask again.
   *
   * A counter rather than a timer handle, so the retry is an effect dependency
   * and a document that unmounts mid-wait cancels it with everything else.
   */
  const [readAttempt, setReadAttempt] = useState(0);

  const mounted = useRef(true);
  // The highest sequence this document has installed. Rust advances one per
  // observable transition and never rewinds, so a read that arrives with a
  // lower one is describing a slot that has already moved.
  const installedSequence = useRef(-1);
  const planToken = useRef(0);
  const stateToken = useRef(0);
  // Paired with the state below it, and read by every guard: a click handler
  // that read the rendered value could start a second conversion inside the
  // render that has not committed the first one yet.
  const busyRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyUpdate = useCallback((update: WorkspaceConversionUpdate) => {
    if (!mounted.current || update.sequence <= installedSequence.current) {
      return;
    }
    installedSequence.current = update.sequence;
    busyRef.current =
      update.state.status === "awaitingDestination" || update.state.status === "running";
    setState(update.state);
  }, []);

  const readState = useCallback(() => {
    stateToken.current += 1;
    const token = stateToken.current;
    api
      .getConversionState()
      .then((update) => {
        if (mounted.current && token === stateToken.current) {
          applyUpdate(update);
        }
      })
      .catch(() => {
        // A slot that cannot be read is not a conversion that failed, and
        // inventing a terminal state here would put a result on screen Rust
        // never reported. But there is no other reader to fall back on: polling
        // starts only once this document knows something is running, so a
        // failed first read would leave it idle for ever -- offering actions
        // Rust refuses and hiding a result that already exists. So it asks
        // again.
        if (mounted.current && token === stateToken.current) {
          setReadAttempt((attempt) => attempt + 1);
        }
      });
  }, [api, applyUpdate]);

  // On mount, and again after a read that failed. This is what recovers a
  // conversion the replaced document started: the reply to the command that
  // began it went nowhere, and the slot is where the answer actually lives.
  useEffect(() => {
    if (readAttempt === 0) {
      readState();
      return undefined;
    }
    const timer = setTimeout(readState, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [readAttempt, readState]);

  const busy = state.status === "awaitingDestination" || state.status === "running";

  // While something is under way, and not otherwise. An idle slot changes only
  // when this document changes it, and a terminal report does not change at
  // all — so polling either would be asking a question whose answer is already
  // on screen.
  useEffect(() => {
    if (!busy) {
      return undefined;
    }
    const timer = setInterval(readState, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [busy, readState]);

  const describe = useCallback(
    (handle: string | null) => {
      planToken.current += 1;
      const token = planToken.current;
      if (handle === null) {
        setPlan({ status: "none" });
        return;
      }
      setPlan({ status: "loading", handle });
      api
        .describeConversion(handle)
        .then((summary) => {
          if (mounted.current && token === planToken.current) {
            setPlan({ status: "loaded", plan: summary });
          }
        })
        .catch((cause: unknown) => {
          if (mounted.current && token === planToken.current) {
            setPlan({ status: "failed", handle, error: toPreviewError(cause) });
          }
        });
    },
    [api],
  );

  const convert = useCallback(
    (handle: string) => {
      if (busyRef.current) {
        return;
      }
      // Claimed before the request leaves, so a second activation inside the
      // same commit cannot start a second conversion. Rust refuses one anyway;
      // this is what stops the interface asking.
      busyRef.current = true;
      setError(null);
      api
        .convertDataset(handle, conflictPolicy, () => {
          // The reservation exists and the claim has been dispatched. From here
          // the operation is Rust's, and a read will find it even if this
          // document goes away.
          readState();
        })
        .then((update) => {
          applyUpdate(update);
        })
        .catch((cause: unknown) => {
          if (!mounted.current) {
            return;
          }
          busyRef.current = false;
          setError(toPreviewError(cause));
          // The request failed on the way to the slot, so what the slot holds
          // is still authoritative and this document has to go and look.
          readState();
        });
    },
    [api, applyUpdate, conflictPolicy, readState],
  );

  const busyHandle = useMemo(() => {
    if (state.status === "awaitingDestination" || state.status === "running") {
      return state.dataset.handle;
    }
    return null;
  }, [state]);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  return {
    state,
    busy,
    busyHandle,
    plan,
    error,
    conflictPolicy,
    setConflictPolicy,
    describe,
    convert,
    dismissError,
  };
}
