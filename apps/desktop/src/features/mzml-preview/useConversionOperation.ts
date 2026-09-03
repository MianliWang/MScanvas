import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePreviewApi } from "./api";
import type {
  ConversionAvailability,
  ConversionLane,
  ConversionSettingsReadiness,
} from "./conversionAvailability";
import {
  canRetryConversion,
  canStartConversion,
  conversionAvailability,
} from "./conversionAvailability";
import type { ConversionSettings } from "./conversionIntentSelection";
import { catalogRow, reselect } from "./conversionIntentSelection";
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

/**
 * What a plan would have to be an answer to, to be startable now.
 *
 * Every mutable fact that changes what a queue would mean. A plan is not a
 * cache of a summary; it is one exact answer from Rust, and asking a
 * different question makes the previous answer a description of something the
 * user is no longer looking at.
 */
export interface ConversionPlanRequest {
  readonly handles: readonly string[];
  /** The selected semantic, or `null` while there is not one. */
  readonly intentId: string | null;
  readonly conflictPolicy: ConversionConflictPolicy;
  /** The installation the catalog was evaluated against, or `null` while unknown. */
  readonly installationGeneration: number | null;
}

/**
 * Whether a loaded plan is an answer to exactly this request.
 *
 * **Read off the plan itself, never off a memo of what was asked.** Rust puts
 * the ordered membership, the intent, the policy and the installation on the
 * plan, so this compares the answer with the question rather than comparing two
 * copies of the question. A slow reply for one semantic landing after the user
 * has moved to another fails here even if a request token somehow admitted it.
 */
export function planAnswers(
  plan: ConversionPlanState,
  request: ConversionPlanRequest,
): boolean {
  if (plan.status !== "loaded") {
    return false;
  }
  const answered = plan.plan;
  return (
    answered.intent.id === request.intentId &&
    answered.conflictPolicy === request.conflictPolicy &&
    answered.installationGeneration === request.installationGeneration &&
    answered.items.length === request.handles.length &&
    answered.items.every((item, index) => item.datasetHandle === request.handles[index])
  );
}

/**
 * What a start of the current request still needs from the settings.
 *
 * One projection of the settings state, read by the rendered decision and by
 * the dispatch guard, so a control that offers a conversion and a handler that
 * accepts one cannot come to disagree about whether a semantic is runnable.
 */
export function settingsReadinessOf(settings: ConversionSettings): ConversionSettingsReadiness {
  switch (settings.status) {
    case "loading":
      return "loading";
    case "noBackend":
    case "failed":
      return "unavailable";
    case "ready": {
      const chosen = catalogRow(settings.catalog, settings.selectedId);
      if (chosen === null) {
        // The catalog no longer holds the selection. Nothing manufactures one:
        // an unreadable selection is unavailable, not silently the shipped
        // posture.
        return "unavailable";
      }
      return chosen.availability.kind === "available" ? "ready" : "unsupported";
    }
  }
}

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
   * Whether a conversion owns the one backend lane, readable from a handler.
   *
   * **Narrower than `busy`, deliberately.** `busy` additionally covers an
   * adoption and a diagnostics export, and neither launches a backend process
   * or touches the preview -- each sets its own flag rather than this one, and
   * says so where it does. What this reports is what actually owns the lane:
   * the queue slot, and a dispatch this document has made and not been answered
   * on. Every gate that means *the backend is occupied* has to read it, and its
   * rendered twin is `lane.laneClaimed`.
   *
   * A click handler that read a rendered value could start work inside a render
   * that has not committed the transition yet, which is why this is a ref.
   */
  readonly laneClaimedRef: { readonly current: boolean };

  /**
   * Every lane fact, as a render can see them.
   *
   * The rendered half of what the two guards below read from refs, and the
   * whole of what a surface needs to decide whether to offer a conversion
   * action. Surfaces project a decision from this with
   * {@link conversionAvailability}; they do not assemble one of their own.
   */
  readonly lane: ConversionLane;
  readonly plan: ConversionPlanState;
  /**
   * Which conversion semantics may be chosen, and which one is.
   *
   * One selection, not five independent settings. The controls are editors of
   * it, and every edit goes through {@link chooseIntent} with an identity the
   * backend catalog issued.
   */
  readonly settings: ConversionSettings;
  /**
   * Selects one admitted semantic by the identity the catalog gave it.
   *
   * Refuses anything the catalog does not hold and anything the installed
   * build cannot express, so a hand-made call cannot select what a control
   * would not offer.
   */
  readonly chooseIntent: (intentId: string) => void;
  /** What a start still needs from the settings, as the guard reads it. */
  readonly settingsReadiness: ConversionSettingsReadiness;
  /** Whether the loaded plan answers the request as it now stands. */
  readonly planIsCurrent: boolean;
  /** A request that never reached Rust's slot, kept apart from a conversion's own outcome. */
  readonly error: PreviewError | null;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly setConflictPolicy: (policy: ConversionConflictPolicy) => void;
  /** Describes the queue these rows would get, or clears the description. */
  readonly describe: (handles: readonly string[]) => void;
  readonly convert: (handles: readonly string[]) => void;
  /** Reruns every retryable failure of the terminal queue. */
  readonly retry: () => void;
  /**
   * Whether this queue's failures may be rerun, and what to say when not.
   *
   * The retry control's own decision, evaluated from the same lane a start is
   * and from this queue's own retryable count. It is a different question from
   * whether a *new* conversion may start -- a finished queue with nothing
   * retryable in it refuses a rerun and accepts a start -- and it exists here,
   * beside the operation, because the operation asks the same question at
   * dispatch.
   */
  readonly retryAvailability: ConversionAvailability;
  /**
   * Whether this document has dispatched a retry and has not been answered.
   *
   * Rust still reads `terminal` throughout -- it answers once, when the whole
   * serial rerun is over -- so every reader that has to know a rerun is under
   * way reads this rather than deriving it, and they cannot come to disagree.
   */
  readonly retrying: boolean;
  /**
   * Whether this document has dispatched a conversion the slot has not shown yet.
   *
   * The rendered twin of the claim `convert` raises, and it exists for exactly
   * the reason {@link retrying} does: the slot cannot report a queue Rust has
   * not reserved, so between the click and the first read that sees it, this is
   * the only thing that knows. Without it the panel went on offering the
   * control that had already been pressed.
   *
   * Reported with the slot check already applied -- true only while the claim
   * is held *and* the slot has not moved -- so the panel and the live region
   * describe the same window rather than each deciding where it ends.
   */
  readonly converting: boolean;
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

/**
 * The lane facts this operation does not own.
 *
 * Everything in {@link ConversionLane} that belongs to the backend banner, the
 * viewer or the workspace. They arrive as one struct rather than as four
 * arguments so that the rendered half and the handler half are visibly the same
 * shape, and so that adding a lane fact is one change here rather than one per
 * caller.
 */
/**
 * What a rerun of this slot would act on, whichever half is asking.
 *
 * A free function over the state rather than a value derived in the hook,
 * because the rendered decision and the dispatch guard read two different
 * copies of that state -- the render's, and the ref's -- and deriving the
 * target twice is how the two would come to describe different queues.
 */
function retryTargetOf(state: WorkspaceConversionState): {
  readonly retryableFailureCount: number;
  readonly queueCompleted: boolean;
} {
  return state.status === "terminal" && state.reason === "completed"
    ? { retryableFailureCount: state.queue.retryableFailedCount, queueCompleted: true }
    : { retryableFailureCount: 0, queueCompleted: false };
}

export type ConversionEnvironment = Pick<
  ConversionLane,
  "backendUsable" | "backendChanging" | "previewReading" | "workspaceSettling"
>;

/**
 * A conversion this document has dispatched and has not been answered on.
 *
 * One claim rather than a flag per action: what matters to every reader is that
 * the lane is taken, and what matters to the roster is which rows went with it.
 * Raised synchronously at the click, lowered only by the dispatch's own
 * outcome -- never by an arriving read, which is how a reply describing a slot
 * that had not yet seen the dispatch used to clear it.
 */
type ConversionDispatch =
  | {
      readonly kind: "convert";
      readonly handles: readonly string[];
      /**
       * The queue the slot held when this was dispatched, or `null` for an idle
       * slot.
       *
       * How an arriving read is told apart from the one this dispatch replaces.
       * Rust names every queue, and a new queue is a new name, so a state
       * carrying a different one is this dispatch's own.
       */
      readonly replacing: string | null;
      /**
       * Whether the slot has since reported the queue this dispatch made.
       *
       * The window "before the slot can report one" ends here, and not when the
       * slot stops owning the lane. Those are different moments: a queue that is
       * stopped, or that finishes before its own command answers, leaves the
       * slot terminal while this claim is still held, and a window defined by
       * the status alone would reopen and describe a settled queue as one that
       * is starting.
       */
      readonly reported: boolean;
    }
  | { readonly kind: "retry" };

/** Whether an arriving state describes a queue that is not the one named. */
function reportsAQueueOtherThan(
  state: WorkspaceConversionState,
  replacing: string | null,
): boolean {
  return state.status !== "idle" && state.operationId !== replacing;
}

export function useConversionOperation(
  onInstallationGeneration: (generation: number) => void,
  onOutputsAdopted: AdoptedOutputsSink,
  /** The lane facts this operation does not own, as a render sees them. */
  environment: ConversionEnvironment,
  /**
   * The same facts, as they stand now.
   *
   * A dispatch guard that read the rendered struct would decide from whatever
   * was true when the closure was made, which for a click arriving during an
   * installation change is exactly the wrong answer. The caller reads its own
   * refs here; this operation reads its own.
   */
  readEnvironment: () => ConversionEnvironment,
  /**
   * Which installation the session has applied a verdict for.
   *
   * The signal to read the catalog again, and the only honest one: which
   * semantics are offered is an answer about one executable, so the question is
   * re-asked exactly when the executable is known to have changed. A recheck
   * that resolves to the same installation does not advance it and costs no
   * further probe.
   */
  installationGeneration: number,
): ConversionOperation {
  const api = usePreviewApi();
  const [state, setState] = useState<WorkspaceConversionState>({ status: "idle" });
  const [plan, setPlan] = useState<ConversionPlanState>({ status: "none" });
  const [error, setError] = useState<PreviewError | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<ConversionConflictPolicy>("fail");
  /**
   * Which semantics may be chosen, and which one is.
   *
   * Starts as loading rather than as the shipped posture. What MSCanvas ships
   * is the backend's to name, and a local default here would be a second statement of
   * it -- one that would go on being shown after a catalog said this build
   * cannot run it.
   */
  const [settings, setSettings] = useState<ConversionSettings>({ status: "loading" });
  /** The rows the workspace has asked for a plan of. */
  const [requestedHandles, setRequestedHandles] = useState<readonly string[]>([]);
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
  const catalogToken = useRef(0);
  const stateToken = useRef(0);
  /**
   * The highest installation generation a catalog reply has installed.
   *
   * A catalog is an answer about one executable, and the two commands that can
   * change one do not answer in call order -- so a slower reply describing a
   * build that has since been replaced is discarded here rather than allowed to
   * overwrite its successor. The same precedence the workspace applies to a
   * backend verdict, applied to the one other reading bound to an installation.
   */
  const catalogGeneration = useRef(-1);
  /**
   * The semantic the user last chose, across catalogs.
   *
   * Held apart from the settings state because the state stops being `ready`
   * while a new installation is being read, and the *choice* has to outlive
   * that: it is a scientific request, not a property of one catalog. What it
   * does not do is survive into a catalog that no longer holds it -- `reselect`
   * decides that, and falls back only to the semantic Rust names as shipped.
   */
  const chosenIntentId = useRef<string | null>(null);
  // Whether a slot read is outstanding. Paired with the token above rather than
  // replacing it: the token decides which reply may install, and this decides
  // that there is only ever one to choose between.
  const stateReadInFlight = useRef(false);
  // Paired with the state below it, and read by every guard: a click handler
  // that read the rendered value could start a second conversion inside the
  // render that has not committed the first one yet.
  const laneClaimedRef = useRef(false);
  // The authoritative slot where a handler can read it. `setState` renders;
  // this decides. Written beside it rather than derived in an effect, which
  // would leave a dispatch guard one commit behind the queue it is asking
  // about.
  const stateRef = useRef<WorkspaceConversionState>({ status: "idle" });
  /**
   * Whether this document has installed an authoritative slot reading at all.
   *
   * The rendered half of `installedSequence`, which is the synchronous one.
   * Both say the same thing -- a read has committed -- and both exist because a
   * dispatch guard runs before any commit while a control is drawn from one.
   *
   * It closes the M6.1 residual: a conversion dispatched before the first read
   * lands is dispatched against a slot this document has never seen, and the
   * local `idle` it starts from is an initial value rather than a fact.
   */
  const [slotObserved, setSlotObserved] = useState(false);
  /** The selected semantic, the plan, and the policy, where a guard reads them. */
  const settingsRef = useRef<ConversionSettings>({ status: "loading" });
  const planRef = useRef<ConversionPlanState>({ status: "none" });
  const conflictPolicyRef = useRef<ConversionConflictPolicy>("fail");
  /**
   * What this document has dispatched onto the lane and not been answered on.
   *
   * Rendered as well as held in a ref, and both halves are load-bearing. The
   * ref is what a second activation inside the same commit reads; the state is
   * what stops the interface offering that activation at all from the next
   * commit onwards. `retrying` and `converting` are projections of it, so a
   * reader cannot come to disagree with the guard.
   */
  const [dispatch, setDispatch] = useState<ConversionDispatch | null>(null);
  const dispatchRef = useRef<ConversionDispatch | null>(null);
  /**
   * Raises or lowers the claim, in both halves at once.
   *
   * The ref first and always, because the guard that reads it runs before any
   * commit. Every write to the claim goes through here: a second way to set one
   * half is how the two come apart.
   *
   * Releasing it hands the lane back to the authoritative slot rather than to
   * `false`. A claim released while the queue it started is still running would
   * otherwise report a free lane -- and a release whose reply the sequence
   * guard discarded, which happens whenever a poll installed the same
   * transition first, would leave the claim raised for the life of the session.
   */
  const claimLane = useCallback((claim: ConversionDispatch | null) => {
    dispatchRef.current = claim;
    laneClaimedRef.current = claim !== null || ownsTheBackendLane(stateRef.current.status);
    setDispatch(claim);
  }, []);
  // The two windows the rest of this file names, each one projection of the
  // single claim above rather than a flag of its own.
  const retrying = dispatch?.kind === "retry";
  // Whether this document has dispatched a stop and has not seen the queue
  // settle. Rendered, because Stop queue has to stop being offered for the
  // whole of that window rather than only once Rust answers.
  const [stopRequested, setStopRequested] = useState(false);
  // The session's own verdict on the backend, which outlives any one queue.
  const [backendQuarantined, setBackendQuarantined] = useState(false);
  // The same verdict where a dispatch guard can read it. A quarantined session
  // refuses every conversion outright, so the guard has to see it in the same
  // commit the read that set it arrives in.
  const backendQuarantinedRef = useRef(false);
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
  // Rust's own half of the same fact, for a guard. An export another document
  // started is one this one must refuse a conversion against, and the rendered
  // `diagnostics.exporting` cannot be read from a handler that predates it.
  const backendExportingRef = useRef(false);

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
    // A reading has committed, so "not observed" stops being true. Written
    // beside the sequence rather than derived from the status, because every
    // status -- including idle -- is an observation once it has arrived.
    setSlotObserved(true);
    // **Raises the claim, and never lowers one this document is holding.**
    //
    // The sequence guard above orders reads against each other; it cannot order
    // a read against a dispatch, because a dispatch moves no sequence -- only
    // Rust does, and only once it has seen the request. So a read issued before
    // the click and answered after it is *newer* than everything installed and
    // still describes a slot that has not heard of the conversion. Assigning
    // this from the arriving status alone is what let that reply clear a claim
    // the handler had raised a moment earlier, reopening a control for the one
    // window in which pressing it would start a second conversion.
    //
    // The claim is settled by the dispatch's own outcome instead: its reply,
    // or its failure. An observation may confirm the lane is taken; only the
    // operation that took it may say it is free.
    laneClaimedRef.current =
      ownsTheBackendLane(update.state.status) || dispatchRef.current !== null;
    stateRef.current = update.state;
    setState(update.state);
    // The first sight of the queue a dispatched conversion made. Recorded on the
    // claim rather than derived from the status, because the status returns to
    // a non-owning value the moment that queue settles and the claim outlives
    // it -- the conversion command answers once, when the whole queue is over.
    const claimed = dispatchRef.current;
    if (
      claimed?.kind === "convert" &&
      !claimed.reported &&
      reportsAQueueOtherThan(update.state, claimed.replacing)
    ) {
      claimLane({ ...claimed, reported: true });
    }
    backendExportingRef.current = update.diagnostics.exporting;
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
      backendQuarantinedRef.current = true;
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
  }, [claimLane, onInstallationGeneration]);

  /**
   * Reads which semantics this installation offers, and installs the answer if
   * it is not about a build that has already been replaced.
   *
   * The user's selection survives the read wherever the new catalog still holds
   * it, including where it holds it as unsupported: what they asked for is a
   * scientific request, and replacing it with the shipped posture because an
   * installation changed would convert something else without saying so.
   */
  const readCatalog = useCallback(() => {
    catalogToken.current += 1;
    const token = catalogToken.current;
    // The catalog on screen described the installation that has just been
    // replaced, so it stops being an answer the moment this read begins.
    //
    // **Keeping it would leave a plan startable against a build that is gone.**
    // The plan carries the installation it was read at and is checked against
    // the catalog's, so an old catalog beside a new installation makes the two
    // agree about a number neither still describes. Going back to `loading`
    // refuses the conversion for the true reason -- MSCanvas is reading what
    // this ProteoWizard offers -- for exactly as long as that is true.
    setSettings({ status: "loading" });
    api
      .conversionIntents()
      .then((catalog) => {
        if (!mounted.current || token !== catalogToken.current) {
          return;
        }
        // A reply about an installation already superseded describes a build
        // that is gone. Discarded rather than rendered beside its successor.
        if (catalog.installationGeneration < catalogGeneration.current) {
          return;
        }
        catalogGeneration.current = catalog.installationGeneration;
        const selectedId = reselect(catalog, chosenIntentId.current);
        chosenIntentId.current = selectedId;
        setSettings({ status: "ready", catalog, selectedId });
        // Reading the catalog resolves the installed backend, so it can be the
        // first thing to notice the installation changed -- exactly as a
        // conversion report can. Without this the banner and everything read
        // from the replaced installation would stay on screen beside settings
        // that describe its successor. Reported through the one reconciler that
        // knows how to discard them, which re-reads only when this is actually
        // newer and therefore cannot loop.
        onInstallationGeneration(catalog.installationGeneration);
      })
      .catch((cause: unknown) => {
        if (!mounted.current || token !== catalogToken.current) {
          return;
        }
        // Fail closed. Nothing manufactures the shipped posture from a failed
        // read, and nothing keeps an older catalog: a settings surface that
        // could not be established is a conversion that cannot start.
        setSettings({ status: "failed", error: toPreviewError(cause) });
      });
  }, [api, onInstallationGeneration]);

  // Once per installation, and once more when this session first has a usable
  // one.
  //
  // Not once per plan: reading it probes the installed msconvert help, which is
  // a process on the one backend lane, and a probe behind every change of focus
  // would make choosing a row expensive. Keyed on the applied generation rather
  // than on a check having run, because a recheck that resolves to the same
  // installation has learned nothing about what it offers -- and a flag that
  // rose and fell inside one commit would not be a signal at all.
  //
  // Not asked while this session has no usable backend: the lane refuses a
  // conversion for that first, and asking would add a refusal nobody needed.
  useEffect(() => {
    if (!environment.backendUsable) {
      // And the catalog goes with the backend. It described an executable this
      // session can no longer launch -- after a folder change that resolved to
      // nothing, or discovery losing what it had found -- so keeping it would
      // leave the controls offering availability marks for a build that is not
      // installed, beside a banner saying none is. Nothing is probed to
      // establish that; there is nothing to probe.
      setSettings({ status: "noBackend" });
      return;
    }
    readCatalog();
  }, [environment.backendUsable, installationGeneration, readCatalog]);

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
  // What owns the one backend lane: the slot, and a dispatch this document has
  // made and not been answered on.
  //
  // The dispatch belongs here and the other two do not, and the difference is
  // written into this file. `convert` and `retry` claim the lane -- the claim
  // `canStartSpectrumSelection` is guarded with -- while `adopt` and
  // `exportDiagnostics` each say "its own flag, and deliberately not the lane".
  // The claim is what makes this the rendered twin of `laneClaimedRef`: both
  // read the same two facts, so the surface and the operation cannot come to
  // disagree in the window between a click and the read that reflects it.
  //
  // Leaving it out would put the mismatch in the direction that hurts: a surface
  // advertising a conversion the operation then silently drops.
  const laneClaimed = ownsTheBackendLane(state.status) || dispatch !== null;
  // A dispatched conversion the slot has not reported yet. Carried to its
  // readers with the check already applied, because the panel and the live
  // region both need exactly this window and each deriving it would be two
  // answers to one question again.
  const converting = dispatch?.kind === "convert" && !dispatch.reported;
  // And this panel's own notion of having work in flight, wider on purpose: an
  // adoption and a diagnostics export are things this surface must not offer
  // twice, and neither owns the backend.
  const busy = adopting || exportRequested || diagnostics.exporting || laneClaimed;

  /**
   * The lane a render sees.
   *
   * Half the caller's facts, half this operation's own, and no third source.
   * Memoized because two surfaces project decisions from it and a new object
   * every render would defeat both of them.
   */
  const lane = useMemo<ConversionLane>(
    () => ({
      ...environment,
      backendQuarantined,
      slotUnread: !slotObserved,
      laneClaimed,
      adopting,
      exportingDiagnostics: exportRequested || diagnostics.exporting,
    }),
    [
      adopting,
      backendQuarantined,
      diagnostics.exporting,
      environment,
      exportRequested,
      laneClaimed,
      slotObserved,
    ],
  );

  /**
   * The same lane, as it stands now.
   *
   * Every fact from the ref written beside the state it renders, so a guard
   * running before a commit reads the truth rather than the last render's copy
   * of it. This is the half that closes the dispatch window: the claim raised
   * one line into `convert` is visible to the very next activation, whether or
   * not React has committed anything.
   */
  const readLane = useCallback(
    (): ConversionLane => ({
      ...readEnvironment(),
      backendQuarantined: backendQuarantinedRef.current,
      // The synchronous half of `slotObserved`. A dispatch arriving in the same
      // commit as the first slot read must see that the read has landed, and a
      // dispatch arriving before it must see that it has not.
      slotUnread: installedSequence.current < 0,
      laneClaimed: laneClaimedRef.current,
      adopting: adoptingRef.current,
      exportingDiagnostics: exportRequestedRef.current || backendExportingRef.current,
    }),
    [readEnvironment],
  );

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

  /**
   * Says which rows a plan is wanted for.
   *
   * It records the request rather than performing it, because the rows are only
   * one of four things a plan answers. The read below is issued for the rows,
   * the selected semantic, the conflict policy and the installation together --
   * so a settings change re-asks exactly as a selection change does, instead of
   * leaving a summary on screen that describes the previous question.
   */
  const describe = useCallback((handles: readonly string[]) => {
    setRequestedHandles((previous) =>
      previous.length === handles.length && previous.every((handle, index) => handle === handles[index])
        ? previous
        : handles,
    );
  }, []);

  /** The selected semantic, or `null` while there is not one. */
  const selectedIntentId = settings.status === "ready" ? settings.selectedId : null;
  /** The installation the catalog describes, or `null` while there is not one. */
  const catalogInstallation =
    settings.status === "ready" ? settings.catalog.installationGeneration : null;
  const requestKey = requestedHandles.join("\u001f");

  // One read per distinct question. The dependency list *is* the plan
  // identity: change the rows, the semantic, the policy or the installation and
  // this asks again, which is the same set of facts `planAnswers` checks the
  // reply against.
  useEffect(() => {
    planToken.current += 1;
    const token = planToken.current;
    const handles = requestedHandles;
    if (handles.length === 0) {
      setPlan({ status: "none" });
      return;
    }
    // No semantic, no plan. A plan read without one would have to invent an
    // intent to ask for, and inventing one here is exactly what this slice
    // removes.
    if (selectedIntentId === null) {
      setPlan({ status: "loading", handles });
      return;
    }
    setPlan({ status: "loading", handles });
    api
      .describeConversion(handles, selectedIntentId, conflictPolicy)
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
    // `requestedHandles` is deliberately absent: `requestKey` is its content,
    // and the content is what decides whether to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, requestKey, selectedIntentId, conflictPolicy, catalogInstallation]);

  /*
   * The three facts a dispatch guard reads, kept level with what is rendered.
   *
   * After the commit rather than during the render, and the difference from
   * `laneClaimedRef` is the point. That one is raised inside `convert` itself,
   * because a *second activation in the same commit* must see the first one --
   * a window that exists only because one handler can raise it and another can
   * read it before React has committed anything. These three are moved by
   * `setState` from an event or a reply, so the earliest a handler can read
   * them is the next discrete event, and React has flushed this effect by then.
   * Writing them during the render would be the anti-pattern that buys nothing:
   * a render React discards would leave a guard reading a state that never
   * committed.
   */
  useEffect(() => {
    settingsRef.current = settings;
    planRef.current = plan;
    conflictPolicyRef.current = conflictPolicy;
  }, [settings, plan, conflictPolicy]);

  /** What a start still needs from the settings, as a render sees it. */
  const settingsReadiness = settingsReadinessOf(settings);
  /** Whether the plan on screen answers the request as it now stands. */
  const planIsCurrent = planAnswers(plan, {
    handles: requestedHandles,
    intentId: selectedIntentId,
    conflictPolicy,
    installationGeneration: catalogInstallation,
  });

  /**
   * Selects one admitted semantic.
   *
   * Guarded against the catalog rather than trusted. A control offers only what
   * the catalog admits and this build declares, and this refuses anything else
   * -- so an activation reaching it by another route cannot select what no
   * control would have offered.
   */
  const chooseIntent = useCallback((intentId: string) => {
    setSettings((previous) => {
      if (previous.status !== "ready") {
        return previous;
      }
      const chosen = catalogRow(previous.catalog, intentId);
      if (chosen === null || chosen.availability.kind !== "available") {
        return previous;
      }
      chosenIntentId.current = intentId;
      return { ...previous, selectedId: intentId };
    });
  }, []);

  const convert = useCallback(
    (handles: readonly string[]) => {
      // The one rule, re-read at dispatch from the facts as they stand.
      //
      // Not a second expression that resembles the control's: the same function
      // the control projects its `disabled` from, over the same struct. What
      // differs is only where the facts come from -- refs here, because this
      // handler may be several commits older than the truth, and for a click
      // that arrives during an installation change that is exactly the wrong
      // answer. VS Code ships the opposite choice and says so in its own schema;
      // for something that claims a backend lane and spawns a process, an
      // explicit refusal is the only safe end of that window.
      // Read from the refs, including the settings and the plan: a click that
      // arrives during a settings change or between two plan reads must be
      // decided by what is true now, not by what the closure was made with.
      const currentSettings = settingsRef.current;
      const intentId = currentSettings.status === "ready" ? currentSettings.selectedId : null;
      const request = {
        targetCount: handles.length,
        settings: settingsReadinessOf(currentSettings),
        planIsCurrent: planAnswers(planRef.current, {
          handles,
          intentId,
          conflictPolicy: conflictPolicyRef.current,
          installationGeneration:
            currentSettings.status === "ready"
              ? currentSettings.catalog.installationGeneration
              : null,
        }),
      };
      if (!canStartConversion(readLane(), request)) {
        return;
      }
      // Unreachable while the rule above holds -- a settings state with no
      // selection is never `ready` -- and refused rather than asserted, because
      // the alternative to a refusal here would be dispatching a conversion
      // with no semantic at all.
      if (intentId === null) {
        return;
      }
      // Claimed before the request leaves, so a second activation inside the
      // same commit cannot start a second conversion. Rust refuses one anyway;
      // this is what stops the interface asking. The rows go with it: the
      // roster must not offer to remove a row this queue is already holding.
      claimLane({
        kind: "convert",
        handles,
        replacing: stateRef.current.status === "idle" ? null : stateRef.current.operationId,
        reported: false,
      });
      setError(null);
      api
        .convertDatasets(handles, conflictPolicyRef.current, intentId, () => {
          // The reservation exists and the claim has been dispatched. From here
          // the operation is Rust's, and a read will find it even if this
          // document goes away.
          readState();
        })
        .then((update) => {
          // The state first, the claim second. This is the reply to the very
          // dispatch that raised the claim, so it is the one observation
          // entitled to lower it -- and lowering it only once the slot it
          // describes is installed is what stops the release reading a lane
          // from before its own queue existed. Both commit together.
          applyUpdate(update);
          if (mounted.current) {
            claimLane(null);
          }
        })
        .catch((cause: unknown) => {
          if (!mounted.current) {
            return;
          }
          claimLane(null);
          setError(toPreviewError(cause));
          // The request failed on the way to the slot, so what the slot holds
          // is still authoritative and this document has to go and look.
          readState();
        });
    },
    [api, applyUpdate, claimLane, readLane, readState],
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
    if (dispatch?.kind === "retry" && state.status === "terminal") {
      return state.queue.items.map((item) => item.datasetHandle);
    }
    // And a dispatched conversion holds the rows it was dispatched with, for
    // the same window and the same reason. The slot cannot name them yet --
    // Rust has not reserved the queue -- so the claim carries them. Only until
    // it has: once the queue is reported the slot is the better answer, and a
    // queue that has since settled holds no rows at all.
    if (dispatch?.kind === "convert" && !dispatch.reported) {
      return dispatch.handles;
    }
    return [];
  }, [state, dispatch]);

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
    // The whole lane claim, which is what the guard below reads. A dispatched
    // conversion holds it before any read reports one, and offering an export
    // in that window could only end in a refusal.
    !laneClaimed;

  /**
   * What a rerun of this slot would act on.
   *
   * Only a queue that ran to its own end. A stopped queue is a decision the
   * user made about the whole batch, and a queue whose stop could not be
   * confirmed must launch nothing at all -- Rust refuses both, and this is what
   * stops the interface offering them.
   *
   * Written once and read by both halves: the decision below, and the guard in
   * `retry`, which reads the same shape out of `stateRef` instead.
   */
  const retryTarget = retryTargetOf(state);

  /**
   * Whether a rerun may start, and what to say when it may not.
   *
   * The same lane a start is judged against, and this queue's own target. It
   * replaces a `canRetry` boolean that was computed here, consumed by nothing,
   * and answered on screen by the start control's rule instead -- two rules for
   * one question, and the one that shipped was the wrong one. A second boolean
   * beside this decision would be the same shape again with nothing to read it,
   * so there is not one: `Retry` reads this, and the guard in `retry` reads
   * `canRetryConversion` over the same evaluator.
   */
  const retryAvailability = conversionAvailability(lane, {
    kind: "retry",
    ...retryTarget,
  });

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
    // Retry availability, not the start control's. The lane is the same and the
    // target is not: this asks the one authority about a rerun of the slot as
    // it stands, from the same refs `convert` reads and from the same slot the
    // rendered decision was made against.
    const target = retryTargetOf(stateRef.current);
    if (!canRetryConversion(readLane(), target.retryableFailureCount, target.queueCompleted)) {
      return;
    }
    claimLane({ kind: "retry" });
    setError(null);
    api
      .retryConversions()
      .then((update) => {
        applyUpdate(update);
        if (mounted.current) {
          claimLane(null);
        }
      })
      .catch((cause: unknown) => {
        if (!mounted.current) {
          return;
        }
        claimLane(null);
        setError(toPreviewError(cause));
        readState();
      });
  }, [api, applyUpdate, claimLane, readLane, readState]);

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
    // The whole lane claim rather than a dispatched retry alone: `adopt` guards
    // itself with the claim, and a surface narrower than its own guard offers
    // work that will not happen.
    !laneClaimed &&
    // An export is reading the same terminal queue. Neither changes it, but
    // Rust refuses to run them together -- an adoption commits under the
    // workspace gate and an export can be sitting in a modal dialog -- so the
    // interface stops offering rather than offering something that is refused.
    !exportingDiagnostics &&
    // And not while a workspace mutation of the user's is still settling. One
    // that committed in Rust can still have a reply in flight, and an adoption
    // installing its roster first would leave that reply installing a list the
    // adopted rows are missing from.
    !environment.workspaceSettling;

  const adopt = useCallback(() => {
    // The ref, not the rendered flag. Two activations inside one render both
    // see `adopting` false, and the second would advance the workspace decision
    // count for a request Rust is about to refuse -- which would then make the
    // first one's reply look superseded and install nothing, losing rows that
    // were actually committed.
    // The lane claim as well as this operation's own flag. A conversion or a
    // retry activated in the
    // same render has already claimed that one, and dispatching both against a
    // single terminal queue means one is refused -- with the losing adoption
    // having already moved the workspace decision count.
    if (
      state.status !== "terminal" ||
      adoptingRef.current ||
      laneClaimedRef.current ||
      exportRequestedRef.current
    ) {
      return;
    }
    // Its own flag, and deliberately not the lane claim. Claiming that would make
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
      laneClaimedRef.current
    ) {
      return;
    }
    // Its own flag, and deliberately not the lane claim. Claiming that would make
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
    lane,
    busyHandles,
    laneClaimedRef,
    retryAvailability,
    retry,
    retrying,
    converting,
    plan,
    settings,
    chooseIntent,
    settingsReadiness,
    planIsCurrent,
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
