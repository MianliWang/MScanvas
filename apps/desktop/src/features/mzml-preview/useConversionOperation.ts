import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePreviewApi } from "./api";
import type {
  ConversionConflictPolicy,
  ConversionDiagnosticsExport,
  ConversionDiagnosticsState,
  ConversionQueuePlan,
  PreviewError,
  WorkspaceConversionState,
  WorkspaceConversionUpdate,
  WorkspaceOutputAdoptionResult,
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

/**
 * How often the slot is re-read while a dispatched retry has not been seen to
 * move it.
 *
 * Much shorter than the ordinary interval, and deliberately only for that one
 * window. The retry command proves the calling document before it moves the
 * slot, so a read issued beside it can land first and be discarded — and until
 * a running queue is visible there is nothing for the user to stop. This is a
 * slot read, which launches nothing, and it stops the moment the transition is
 * seen.
 */
const RETRY_TRANSITION_POLL_MS = 100;

/**
 * Whether an adoption result still describes the queue an update reports.
 *
 * A result is about one settling of one queue, so it survives only while that
 * queue is still terminal, still the same operation, and still on the same
 * retry round. The round is what separates a queue that has not changed from
 * one a retry has settled again, which the status alone cannot: a retry that
 * finishes between two polls moves the queue from terminal to terminal.
 */
function describes(
  adoption: WorkspaceOutputAdoptionResult,
  update: WorkspaceConversionUpdate,
): boolean {
  return (
    update.state.status === "terminal" &&
    update.state.operationId === adoption.operationId &&
    update.state.queue.retryRound === adoption.retryRound
  );
}

/** The plan summary for one row, and how the reading of it went. */
export type ConversionPlanState =
  | { readonly status: "none" }
  | { readonly status: "loading"; readonly handles: readonly string[] }
  | { readonly status: "loaded"; readonly plan: ConversionQueuePlan }
  | { readonly status: "failed"; readonly handles: readonly string[]; readonly error: PreviewError };

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

  /**
   * Whether the queue slot owns the one backend lane, readable from a handler.
   *
   * **Narrower than `busy`, deliberately.** `busy` is this panel's notion of
   * having work in flight and includes a dispatched retry, an adoption and a
   * diagnostics export -- none of which launches a backend process or touches
   * the preview. What this reports is the slot alone, which is what actually
   * owns the lane, and it is what every gate that means *the backend is
   * occupied* has to read. Its rendered twin is {@link backendLaneBusy}.
   *
   * A click handler that read a rendered value could start work inside a render
   * that has not committed the transition yet, which is why this is a ref.
   */
  readonly busyRef: { readonly current: boolean };

  /**
   * The same answer as `busyRef`, for the interface.
   *
   * One predicate with two readers, so a control cannot come to disagree with
   * the operation it advertises. Used by the selection lane, whose whole
   * contract is that what a surface says and what the operation does are the
   * same rule.
   */
  readonly backendLaneBusy: boolean;
  readonly plan: ConversionPlanState;
  /** A request that never reached Rust's slot, kept apart from a conversion's own outcome. */
  readonly error: PreviewError | null;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly setConflictPolicy: (policy: ConversionConflictPolicy) => void;
  /** Describes the queue these rows would get, or clears the description. */
  readonly describe: (handles: readonly string[]) => void;
  readonly convert: (handles: readonly string[]) => void;
  /** Reruns every retryable failure of the terminal queue. */
  readonly retry: () => void;
  /** Whether the terminal queue has anything worth retrying. */
  readonly canRetry: boolean;
  /**
   * Whether this document has dispatched a retry and has not been answered.
   *
   * Rust still reads `terminal` throughout -- it answers once, when the whole
   * serial rerun is over -- so every reader that has to know a rerun is under
   * way reads this rather than deriving it, and they cannot come to disagree.
   */
  readonly retrying: boolean;
  /** Every row a live queue holds, so a roster can pin them. */
  readonly busyHandles: readonly string[];
  readonly dismissError: () => void;
  /** Asks Rust to stop the running queue. */
  readonly stop: () => void;
  /** Whether there is a running queue of this document's to stop. */
  readonly canStop: boolean;
  /**
   * Whether a stop has been asked for and the queue has not settled.
   *
   * True from the moment this document dispatches the request, not only once
   * Rust answers: the request is one command that may take as long as a
   * process takes to end, and leaving Stop queue live throughout would let a
   * user press it repeatedly at something already happening.
   */
  readonly stopping: boolean;
  /**
   * Whether this session has stopped trusting the backend.
   *
   * Read from the authoritative slot rather than derived from the terminal
   * reason, so a reload recovers it with everything else.
   */
  readonly backendQuarantined: boolean;
  /** Adds this terminal queue's finalized outputs to the workspace. */
  readonly adopt: () => void;
  /** Whether there are finalized outputs of this terminal queue to add. */
  readonly canAdopt: boolean;
  /** Whether an adoption this document asked for has not been answered. */
  readonly adopting: boolean;
  /** How many of this queue's items finalized an output. */
  readonly eligibleOutputCount: number;
  /**
   * Whether any acquisition finalized part of an output set without completing
   * it. Read by the one sentence that must not say "nothing was converted".
   */
  readonly hasIncompleteOutputSet: boolean;
  /**
   * What the last adoption of this queue did, until the queue is replaced.
   *
   * Kept so the panel can report counts beside the result it belongs to. It is
   * not the roster -- that is the workspace's, and was adopted whole when this
   * arrived.
   */
  readonly adoption: WorkspaceOutputAdoptionResult | null;
  /** Saves one local, redacted JSON diagnostics file for this terminal queue. */
  readonly exportDiagnostics: () => void;
  /**
   * Whether this terminal queue has anything worth diagnosing at all.
   *
   * Separate from `canExportDiagnostics`, which also answers "and right now".
   * The interface needs both: one decides whether the offer exists, the other
   * whether it can be taken. Collapsing them would make a control vanish while
   * an adoption ran and reappear afterwards, which reads as flicker and takes
   * the focus of whoever was standing on it.
   */
  readonly diagnosticsAvailable: boolean;
  /** Whether it can be exported right now. */
  readonly canExportDiagnostics: boolean;
  /**
   * Whether an export is between being asked for and being finished.
   *
   * True from the moment this document dispatches, and again for as long as
   * Rust reports one under way -- which is what lets a reloaded document see
   * that an export it did not start is still writing.
   */
  readonly exportingDiagnostics: boolean;
  /** How many of this queue's items an export would describe. */
  readonly diagnosticItemCount: number;
  /**
   * What the last diagnostics export of this queue wrote, until the queue is
   * replaced.
   *
   * Read from the authoritative slot rather than from the reply, so a document
   * that reloaded while one was writing still learns it happened.
   */
  readonly diagnosticsExport: ConversionDiagnosticsExport | null;
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
/**
 * How an adopted roster reaches the workspace.
 *
 * Two calls rather than one, because ordering a roster against the workspace's
 * other decisions is a question about when the request *started*, not about
 * when its reply arrived. `begin` is asked at dispatch and answers with where
 * the workspace's decisions stood; `apply` is given that back and decides
 * whether this answer is still the newest.
 */
export interface AdoptedOutputsSink {
  begin: () => number;
  apply: (result: WorkspaceOutputAdoptionResult, startedAt: number) => void;
}

/**
 * Whether a queue slot in this state owns the one backend lane.
 *
 * One predicate, read from an arriving update by the ref and from rendered state
 * by the interface. Written once because the two answers being the same is the
 * property that matters: a control that refuses where the operation accepts
 * takes away work the user could have done, and the reverse offers work that
 * will not happen.
 */
function ownsTheBackendLane(status: WorkspaceConversionState["status"]): boolean {
  return status === "awaitingDestination" || status === "running" || status === "stopping";
}

export function useConversionOperation(
  onInstallationGeneration: (generation: number) => void,
  onOutputsAdopted: AdoptedOutputsSink,
  /** Whether a workspace mutation of the user's has been asked for and not settled. */
  workspaceSettling: boolean,
): ConversionOperation {
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
  // Whether a slot read is outstanding. Paired with the token above rather than
  // replacing it: the token decides which reply may install, and this decides
  // that there is only ever one to choose between.
  const stateReadInFlight = useRef(false);
  // Paired with the state below it, and read by every guard: a click handler
  // that read the rendered value could start a second conversion inside the
  // render that has not committed the first one yet.
  const busyRef = useRef(false);
  // Whether this document is inside a retry it dispatched and has not been
  // answered for. Rendered, unlike `busyRef`, because the interface has to stop
  // offering actions for the whole of that window.
  const [retrying, setRetrying] = useState(false);
  // Whether this document has dispatched a stop and has not seen the queue
  // settle. Rendered, because Stop queue has to stop being offered for the
  // whole of that window rather than only once Rust answers.
  const [stopRequested, setStopRequested] = useState(false);
  // The session's own verdict on the backend, which outlives any one queue.
  const [backendQuarantined, setBackendQuarantined] = useState(false);
  // Whether this document is inside an adoption it dispatched. Rendered,
  // because every workspace action has to stop being offered for the whole of
  // that window rather than only once Rust answers.
  const [adopting, setAdopting] = useState(false);
  // Paired with the state above and read by the handler, like every other gate
  // here: a click handler that read the rendered value could start a second
  // adoption inside the render that has not committed the first one yet.
  const adoptingRef = useRef(false);
  const [adoption, setAdoption] = useState<WorkspaceOutputAdoptionResult | null>(null);
  // What Rust says about diagnostics for the queue it is reporting. Held whole
  // rather than spread across three pieces of state, because the three arrive
  // together and disagreeing about them is the only way they can be wrong.
  const [diagnostics, setDiagnostics] = useState<ConversionDiagnosticsState>({
    eligibleItemCount: 0,
    available: false,
    exporting: false,
    lastExport: null,
  });
  // Whether this document is inside an export it dispatched. Rendered as well
  // as Rust's own flag, because the actions this closes have to close on the
  // press rather than on the first poll that sees it.
  const [exportRequested, setExportRequested] = useState(false);
  // Paired with the state above and read by the handler, like every other gate
  // here: two activations inside one render both see the rendered value false.
  const exportRequestedRef = useRef(false);

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
    // A result belongs to one settling of one queue. Anything that produces a
    // different one takes it with it: a queue that is no longer terminal, a
    // different operation, or the same operation settled again by a retry --
    // which can finish fast enough that no running state is ever polled, so
    // "not terminal any more" is not a test that catches it.
    setAdoption((previous) => (previous === null || describes(previous, update) ? previous : null));
    installedSequence.current = update.sequence;
    busyRef.current = ownsTheBackendLane(update.state.status);
    setState(update.state);
    setDiagnostics(update.diagnostics);
    // Cleared from the authoritative state rather than from the reply, because
    // a reload has no reply to read. Rust is the one that knows an export has
    // finished, whichever document asked for it.
    if (!update.diagnostics.exporting) {
      exportRequestedRef.current = false;
      setExportRequested(false);
    }
    // Never cleared here. Rust sets it once and cannot unset it, so a document
    // that lowered it on a later read would be claiming something the session
    // does not know.
    if (update.backendQuarantined) {
      setBackendQuarantined(true);
    }
    // The queue is over, so this document is no longer inside a stop it asked
    // for. Cleared from the authoritative state rather than from the reply to
    // the stop command, because a reload has no reply to read.
    if (update.state.status === "terminal" || update.state.status === "idle") {
      setStopRequested(false);
    }
    // A conversion is a backend operation like any other, and it can be the
    // first to notice that the installed ProteoWizard changed. Without this the
    // banner and a preview read from the replaced installation would stay on
    // screen beside a conversion done by its successor, until some later
    // backend operation happened to reconcile them.
    if (update.state.status === "terminal") {
      // Once for the queue, not once per item. Every item of one queue ran on
      // one installation, so their generations agree -- and reporting each of
      // them separately would start a backend probe per item before any of them
      // had answered, which for a full queue is sixteen serial help probes with
      // preview and conversion disabled throughout.
      const generations = [
        // The queue's own reading first. A pass refused for running on a
        // different installation produced no item, so the reports alone would
        // leave the banner naming the installation the earlier results came
        // from until the user rechecked by hand.
        update.state.queue.installationGeneration,
        // Whichever cardinality the item's latest attempt had. Both reports
        // carry the sequence they ran under, and an item is never described by
        // both at once.
        ...update.state.queue.items
          .map((item) => item.result?.report.installationGeneration)
          .filter((generation): generation is number => generation !== undefined),
      ];
      onInstallationGeneration(Math.max(...generations));
    }
  }, [onInstallationGeneration]);

  const readState = useCallback(() => {
    // One at a time. The token below lets only the newest read install, so two
    // reads overlapping would leave the older one stale on arrival -- and a
    // poll faster than the round trip would then install nothing at all,
    // sitting for ever on a state Rust has already moved past while adding an
    // outstanding read every tick. A read already in flight is about to answer
    // this same question, so there is nothing for a second one to learn.
    if (stateReadInFlight.current) {
      return;
    }
    stateReadInFlight.current = true;
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
      })
      .finally(() => {
        stateReadInFlight.current = false;
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

  // The authoritative slot, plus the window this document is knowingly inside.
  //
  // A retry is one command that does not answer until the whole serial rerun is
  // over, and unlike starting a queue it has no reservation half to tell the
  // interface that something began. Without this the panel would show the old
  // terminal result -- and offer Retry, Clear, Add and Preview as usable -- for
  // as long as the rerun took, with every one of them then silently ignored by
  // the local guard or refused by Rust.
  //
  // Not an invented conversion state: what it reports is that this document has
  // asked and is waiting, which is the same thing `pickerBusy` and `folderBusy`
  // report elsewhere. The authoritative queue arrives on the first poll and
  // takes over from there.
  // What the slot is doing, and nothing else. The lane, for every gate that
  // means "the backend is occupied".
  const backendLaneBusy = ownsTheBackendLane(state.status);
  // And this panel's own notion of having work in flight, which is wider on
  // purpose: a retry, an adoption and a diagnostics export are all things this
  // surface must not offer twice, and none of them owns the backend.
  const busy = retrying || adopting || exportRequested || diagnostics.exporting || backendLaneBusy;

  // A retry this document dispatched, for a slot that has not been seen to move
  // yet. It is the one window in this workflow where the authoritative state is
  // known to be about to change and the interface has nothing to offer until it
  // does.
  const awaitingRetryTransition = retrying && state.status === "terminal";

  // While something is under way, and not otherwise. An idle slot changes only
  // when this document changes it, and a terminal report does not change at
  // all — so polling either would be asking a question whose answer is already
  // on screen.
  useEffect(() => {
    if (!busy) {
      return undefined;
    }
    // Leading, not only on the interval. A retry moves the slot to running
    // inside a command that does not answer until the whole rerun is over, so
    // the first thing this document can learn about that queue is a read of its
    // own.
    readState();
    // And quickly until it arrives. The retry command proves the calling
    // document before it moves the slot, so the read issued beside it can and
    // often does land first -- and one that lands first is discarded by the
    // sequence guard, leaving a rerun of several acquisitions with no Stop for
    // the ordinary interval. Asking again in a fraction of that costs one slot
    // read, which launches nothing, and only for as long as the transition
    // takes: the moment the running queue is visible this reverts to the
    // interval the rest of the workflow uses.
    const interval = awaitingRetryTransition ? RETRY_TRANSITION_POLL_MS : POLL_INTERVAL_MS;
    const timer = setInterval(readState, interval);
    return () => {
      clearInterval(timer);
    };
  }, [awaitingRetryTransition, busy, readState]);

  const describe = useCallback(
    (handles: readonly string[]) => {
      planToken.current += 1;
      const token = planToken.current;
      if (handles.length === 0) {
        setPlan({ status: "none" });
        return;
      }
      setPlan({ status: "loading", handles });
      api
        .describeConversion(handles)
        .then((summary) => {
          if (mounted.current && token === planToken.current) {
            setPlan({ status: "loaded", plan: summary });
          }
        })
        .catch((cause: unknown) => {
          if (mounted.current && token === planToken.current) {
            setPlan({ status: "failed", handles, error: toPreviewError(cause) });
          }
        });
    },
    [api],
  );

  const convert = useCallback(
    (handles: readonly string[]) => {
      // The adoption and export claims as well. A new queue replaces the
      // terminal one both of them are reading, so all three are exclusive for
      // the same reason a retry and an adoption are.
      if (busyRef.current || adoptingRef.current || exportRequestedRef.current) {
        return;
      }
      // Claimed before the request leaves, so a second activation inside the
      // same commit cannot start a second conversion. Rust refuses one anyway;
      // this is what stops the interface asking.
      busyRef.current = true;
      setError(null);
      api
        .convertDatasets(handles, conflictPolicy, () => {
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

  // Every row a live queue holds, not only the one running: a queued row
  // cannot be removed and cannot be searched away either, because the user has
  // already committed it to a queue that is holding it. Stopping that queue is
  // how they get it back, and it is offered beside the queue.
  const busyHandles = useMemo(() => {
    if (
      state.status === "awaitingDestination" ||
      state.status === "running" ||
      state.status === "stopping"
    ) {
      return state.queue.items.map((item) => item.datasetHandle);
    }
    // A dispatched retry holds the same rows, and Rust will refuse to let them
    // go. Without this the window between the click and the first poll would
    // offer `Remove selected` over the very failures being rerun, and the only
    // outcome would be a workspace error nobody needed to see.
    if (retrying && state.status === "terminal") {
      return state.queue.items.map((item) => item.datasetHandle);
    }
    return [];
  }, [state, retrying]);

  // This document's own claim and Rust's answer, together. They cover
  // different windows: the claim covers the press until the first read that
  // sees it, and Rust's flag covers the rest — including for a document that
  // reloaded into an export it never started.
  const exportingDiagnostics = exportRequested || diagnostics.exporting;

  // Only a terminal queue with something to describe. Deliberately not gated on
  // the backend being usable: an export launches no process, and a session that
  // has stopped trusting the backend is exactly the one that needs this.
  //
  // Availability is Rust's answer rather than a count compared here. A
  // stop-failed queue is exportable for what the queue itself records even
  // where no item carries a diagnostic of its own, and a second rule on this
  // side could only come to disagree with the one that decides.
  const canExportDiagnostics =
    state.status === "terminal" &&
    diagnostics.available &&
    !exportingDiagnostics &&
    !adopting &&
    !retrying;

  // Only a queue that ran to its own end. A stopped queue is a decision the
  // user made about the whole batch, and a queue whose stop could not be
  // confirmed must launch nothing at all -- Rust refuses both, and this is what
  // stops the interface offering them.
  // Not while an adoption is under way. A retry replaces the very results an
  // adoption is reading, so the two are offered apart even though both act on
  // the same terminal queue.
  const canRetry =
    state.status === "terminal" &&
    state.reason === "completed" &&
    state.queue.retryableFailedCount > 0 &&
    !adopting &&
    !exportingDiagnostics &&
    !backendQuarantined;

  // A running queue, and one this document has not already asked to stop.
  // stopping covers both the window before Rust answers and the state Rust
  // reports afterwards, so the action does not flicker back on between them.
  const stopping = stopRequested || state.status === "stopping";
  const canStop = state.status === "running" && !stopping;

  const stop = useCallback(() => {
    if (state.status !== "running") {
      return;
    }
    // Marked before the request leaves. Rust is idempotent about a repeated
    // stop, but a button that stayed live until the reply came back would
    // invite a user to press it at something already under way.
    setStopRequested(true);
    setError(null);
    const { operationId } = state;
    api
      .stopConversion(operationId)
      .then((update) => {
        applyUpdate(update);
      })
      .catch((cause: unknown) => {
        if (!mounted.current) {
          return;
        }
        // The request never reached the slot, so nothing was stopped and this
        // document must not go on saying it was. What the slot holds is still
        // authoritative, so it asks.
        setStopRequested(false);
        setError(toPreviewError(cause));
        readState();
      });
  }, [api, applyUpdate, readState, state]);

  const retry = useCallback(() => {
    // The adoption and export flags as well as its own. All three act on one
    // terminal queue, and each has to see the others' claims or two dispatch
    // against it.
    if (busyRef.current || adoptingRef.current || exportRequestedRef.current) {
      return;
    }
    busyRef.current = true;
    setRetrying(true);
    setError(null);
    api
      .retryConversions()
      .then((update) => {
        if (mounted.current) {
          setRetrying(false);
        }
        applyUpdate(update);
      })
      .catch((cause: unknown) => {
        if (!mounted.current) {
          return;
        }
        busyRef.current = false;
        setRetrying(false);
        setError(toPreviewError(cause));
        readState();
      });
  }, [api, applyUpdate, readState]);

  // How many output *files* this terminal queue would offer to add.
  //
  // Read from Rust rather than counted here, and that is the decision: one
  // finalized item is not one output. A ten-member SCIEX acquisition offers
  // ten, and an interface counting finalized items would offer to add ten files
  // while calling them one -- then receive ten outcomes it had not planned to
  // render. Rust derives it from the very authorities the adoption expands, so
  // the number shown and the outcomes returned cannot disagree.
  const eligibleOutputCount =
    state.status === "terminal" ? state.queue.adoptableOutputCount : 0;

  // Whether some acquisition converted files this queue will not offer as a
  // complete set.
  //
  // The one case where "nothing was converted" would be false while the offer
  // is still absent: a partially finalized publication leaves real files in the
  // user's folder, and the panel owes them a different sentence.
  const hasIncompleteOutputSet =
    state.status === "terminal" &&
    state.queue.items.some(
      (item) =>
        item.result?.kind === "outputSet" && item.result.report.partial !== null,
    );

  // Only a terminal queue, and only one that finalized something. A running or
  // stopping queue's outputs are not all in yet, and a retry replaces the very
  // results an adoption would be reading. Deliberately not gated on the backend
  // being usable: adoption launches nothing.
  const canAdopt =
    state.status === "terminal" &&
    eligibleOutputCount > 0 &&
    !adopting &&
    !retrying &&
    // An export is reading the same terminal queue. Neither changes it, but
    // Rust refuses to run them together -- an adoption commits under the
    // workspace gate and an export can be sitting in a modal dialog -- so the
    // interface stops offering rather than offering something that is refused.
    !exportingDiagnostics &&
    // And not while a workspace mutation of the user's is still settling. One
    // that committed in Rust can still have a reply in flight, and an adoption
    // installing its roster first would leave that reply installing a list the
    // adopted rows are missing from.
    !workspaceSettling;

  const adopt = useCallback(() => {
    // The ref, not the rendered flag. Two activations inside one render both
    // see `adopting` false, and the second would advance the workspace decision
    // count for a request Rust is about to refuse -- which would then make the
    // first one's reply look superseded and install nothing, losing rows that
    // were actually committed.
    // `busyRef` as well as this operation's own flag. A retry activated in the
    // same render has already claimed that one, and dispatching both against a
    // single terminal queue means one is refused -- with the losing adoption
    // having already moved the workspace decision count.
    if (
      state.status !== "terminal" ||
      adoptingRef.current ||
      busyRef.current ||
      exportRequestedRef.current
    ) {
      return;
    }
    // Its own flag, and deliberately not `busyRef`. Setting that one would make
    // every read wait -- a spectrum selection, the preview action -- and an
    // adoption launches nothing and touches no preview. Reading it is what
    // gives the mutual exclusion with a retry; writing it would take something
    // else away.
    adoptingRef.current = true;
    // Marked before the request leaves, like every other gate here: the actions
    // this closes must close on the press rather than on the reply.
    setAdopting(true);
    setError(null);
    const { operationId } = state;
    // Taken at dispatch. A drop or an import accepted after Rust commits this
    // and before the reply is applied would otherwise install its newer roster
    // first and have this one installed over it.
    const startedAt = onOutputsAdopted.begin();
    api
      .adoptConversionOutputs(operationId)
      .then((result) => {
        adoptingRef.current = false;
        if (mounted.current) {
          setAdopting(false);
          setAdoption(result);
        }
        // Handed on even when this document is gone. The rows were committed by
        // Rust either way, and the replacement reads the roster on mount.
        onOutputsAdopted.apply(result, startedAt);
      })
      .catch((cause: unknown) => {
        adoptingRef.current = false;
        if (!mounted.current) {
          return;
        }
        setAdopting(false);
        setError(toPreviewError(cause));
      });
  }, [api, onOutputsAdopted, state]);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  const exportDiagnostics = useCallback(() => {
    // The ref rather than the rendered flag, and every other claim on the
    // terminal queue beside it. Two activations inside one render both see
    // `exportingDiagnostics` false, and the second would open a save dialog for
    // an export Rust is about to refuse.
    if (
      state.status !== "terminal" ||
      exportRequestedRef.current ||
      adoptingRef.current ||
      busyRef.current
    ) {
      return;
    }
    // Its own flag, and deliberately not `busyRef`. Setting that one would make
    // a preview read and a spectrum selection wait, and an export launches
    // nothing and touches neither. Reading it is what gives the mutual
    // exclusion; writing it would take something else away.
    exportRequestedRef.current = true;
    setExportRequested(true);
    setError(null);
    const { operationId } = state;
    api
      .exportConversionDiagnostics(operationId, () => {
        // The reservation exists and the claim has been dispatched. From here
        // the export is Rust's, and a read will find it even if this document
        // goes away.
        readState();
      })
      .then((update) => {
        applyUpdate(update);
      })
      .catch((cause: unknown) => {
        exportRequestedRef.current = false;
        if (!mounted.current) {
          return;
        }
        setExportRequested(false);
        setError(toPreviewError(cause));
        // The request failed somewhere on the way, so what the slot holds is
        // still authoritative and this document has to go and look.
        readState();
      });
  }, [api, applyUpdate, readState, state]);

  return {
    state,
    busy,
    backendLaneBusy,
    busyHandles,
    busyRef,
    canRetry,
    retry,
    retrying,
    plan,
    error,
    conflictPolicy,
    setConflictPolicy,
    describe,
    convert,
    dismissError,
    stop,
    canStop,
    stopping,
    backendQuarantined,
    adopt,
    canAdopt,
    adopting,
    eligibleOutputCount,
    hasIncompleteOutputSet,
    adoption,
    exportDiagnostics,
    diagnosticsAvailable: state.status === "terminal" && diagnostics.available,
    canExportDiagnostics,
    exportingDiagnostics,
    diagnosticItemCount: diagnostics.eligibleItemCount,
    diagnosticsExport: diagnostics.lastExport,
  };
}
