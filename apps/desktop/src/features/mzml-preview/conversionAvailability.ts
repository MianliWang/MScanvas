/**
 * Whether a conversion action may start right now, and what to say when it may
 * not.
 *
 * One rule, read by the operation that performs a conversion and by every
 * surface that offers one. It lives here rather than in the operation hook
 * because the panel, the plan and the retry control all have to ask it, and
 * because the operation has to ask it again at dispatch from refs a render
 * cannot supply.
 *
 * The shape is the one [ADR 0041] proved for the viewer's selection lane: one
 * closed input struct, one discriminated result carrying a reason and a
 * message, and the booleans defined as projections of that result rather than
 * as expressions of their own. ADR 0043 records why conversion needed it
 * second and needed it most -- four rules for one question, disagreeing in
 * both directions.
 */

/**
 * The lane facts every conversion action shares.
 *
 * What decides whether *a* conversion may start, before anything about which
 * one. Everything here is a fact the operation would refuse on; nothing here
 * is display state, and nothing here is about a target.
 *
 * Each field is one fact with one owner, and each has a matched pair of
 * readers: a rendered value the interface projects from, and a ref the
 * operation reads at dispatch. They are the same fact, and the whole reason
 * this struct exists is that neither reader gets to re-decide it.
 */
export interface ConversionLane {
  /** Whether this session's own verdict says ProteoWizard can be launched. */
  readonly backendUsable: boolean;
  /** Whether an installation check or change owns the backend lane. */
  readonly backendChanging: boolean;
  /**
   * Whether this session has stopped trusting the backend.
   *
   * Set when a stop could not be confirmed, and never cleared: MSCanvas has
   * lost track of a converter process of its own and will not start another
   * until it is restarted.
   */
  readonly backendQuarantined: boolean;
  /**
   * Whether this document has yet read the session's one conversion slot.
   *
   * **Not yet observed is not idle.** The operation starts from a local `idle`
   * object because it has to start from something, and a conversion dispatched
   * before the first authoritative read lands would be dispatched against a
   * slot this document has never seen -- which may already hold a queue a
   * replaced document started. It is the same rule every other fact here
   * follows: a decision is taken from what is known, and this is the fact that
   * says nothing is known yet. Its synchronous half is the installed sequence,
   * which is negative until a read commits.
   */
  readonly slotUnread: boolean;
  /** Whether a run or a scan is being read over the one backend lane. */
  readonly previewReading: boolean;
  /**
   * Whether a conversion owns the lane.
   *
   * The queue slot **or** a dispatch this document has claimed and not been
   * answered on. The second half is what closes the window between a click and
   * the first slot read that reflects it: the claim is raised synchronously,
   * so the operation and the interface stop offering in the same commit rather
   * than one of them waiting for a read.
   */
  readonly laneClaimed: boolean;
  /** Whether an adoption of a terminal queue's outputs is under way. */
  readonly adopting: boolean;
  /** Whether a diagnostics export is under way, whichever document asked. */
  readonly exportingDiagnostics: boolean;
  /** Whether a workspace mutation of the user's has been asked for and not settled. */
  readonly workspaceSettling: boolean;
}

/**
 * Which conversion action is being asked about, and what it would act on.
 *
 * Starting a queue and rerunning one are different operations over the same
 * lane, and the difference is entirely in the target: a start needs rows to
 * convert, a retry needs a finished queue with failures another attempt could
 * change. Sharing the lane facts is what stops them drifting; keeping the
 * target apart is what stops one of them answering for the other.
 */
export type ConversionAction =
  | {
      readonly kind: "start";
      /** How many convertible rows the queue would hold. */
      readonly targetCount: number;
      /**
       * Whether the chosen conversion semantic is settled and runnable.
       *
       * Settings are not permission to run, and their absence is not a reason
       * to invent one: a catalog that has not arrived, one that failed, and a
       * choice this build cannot express are three different situations and
       * each gets its own sentence.
       */
      readonly settings: ConversionSettingsReadiness;
      /**
       * Whether the loaded plan is a plan for this exact request.
       *
       * A plan answers one question: these rows, this semantic, this policy,
       * this installation. Change any of them and the plan on screen describes
       * something the user is no longer asking for, so it cannot be started --
       * and saying so is better than starting the older one.
       */
      readonly planIsCurrent: boolean;
    }
  | {
      readonly kind: "retry";
      /** How many of the terminal queue's failures another attempt could change. */
      readonly retryableFailureCount: number;
      /**
       * Whether the queue ran to its own end.
       *
       * A stopped queue -- and one whose stop could not be confirmed -- is a
       * decision the user made about the whole batch, and is not rerun in
       * place. Neither is a queue that is not terminal at all.
       */
      readonly queueCompleted: boolean;
    };

/**
 * Whether the chosen conversion semantic can be run.
 *
 * `unsupported` is deliberately apart from `unavailable`: the first says this
 * ProteoWizard cannot express what the user chose, which they can act on by
 * choosing differently; the second says MSCanvas could not establish what is
 * choosable at all.
 */
export type ConversionSettingsReadiness = "ready" | "loading" | "unavailable" | "unsupported";

/** Why a conversion action cannot start, named for what the reader can do. */
export type ConversionUnavailableReason =
  | "backend-quarantined"
  | "backend-changing"
  | "backend-unavailable"
  | "conversion-state-unknown"
  | "conversion-running"
  | "preview-running"
  | "adoption-running"
  | "diagnostics-exporting"
  | "workspace-settling"
  | "no-convertible-target"
  | "settings-loading"
  | "settings-unavailable"
  | "intent-unsupported"
  | "plan-superseded"
  | "queue-not-retryable"
  | "nothing-to-retry";

/**
 * Whether a conversion action may start, and what to say when it may not.
 *
 * A boolean could gate a handler but could not tell a reader anything, so
 * every surface that wanted to explain a disabled `Convert` had to decide
 * again what was wrong -- which is a second authority however carefully it is
 * written. Before this slice no surface even tried: a refused conversion was a
 * grey button and nothing else.
 */
export type ConversionAvailability =
  | { readonly status: "available" }
  | {
      readonly status: "unavailable";
      readonly reason: ConversionUnavailableReason;
      /** What the reader is told. Never implementation vocabulary. */
      readonly message: string;
    };

/**
 * What each refusal says.
 *
 * One map for both actions, deliberately. A retry *is* a conversion -- same
 * backend, same lane, same process -- so a second map keyed by action could
 * only come to describe the same lane two ways. The two entries that are
 * genuinely about a rerun say so, and every other sentence is true of either
 * control.
 *
 * Named after something on screen or something the reader can change. A lane,
 * a ref, a claim or a slot is true and useless: it describes the machinery
 * that refused rather than the situation the reader is in.
 */
const CONVERSION_MESSAGES: Record<ConversionUnavailableReason, string> = {
  "backend-quarantined":
    "MSCanvas could not confirm that a converter process stopped. " +
    "Restart MSCanvas before starting another conversion.",
  "backend-changing":
    "Converting is unavailable while the installed ProteoWizard backend is being checked.",
  "backend-unavailable":
    "Converting needs ProteoWizard, and this session has no usable backend. " +
    "See the backend status above.",
  "conversion-state-unknown": "MSCanvas is checking the current conversion state.",
  "conversion-running": "Converting is unavailable while a conversion is running.",
  "preview-running": "Converting is unavailable while a run is being read.",
  "adoption-running":
    "Converting is unavailable while converted outputs are being added to the workspace.",
  "diagnostics-exporting":
    "Converting is unavailable while failure diagnostics are being saved.",
  "workspace-settling": "Converting is unavailable while the file list is being changed.",
  "no-convertible-target": "Select or focus a supported vendor acquisition to convert.",
  "settings-loading": "MSCanvas is reading which conversion settings this ProteoWizard offers.",
  "settings-unavailable":
    "MSCanvas could not read which conversion settings this ProteoWizard offers, " +
    "so it will not start a conversion.",
  "intent-unsupported":
    "The installed ProteoWizard build does not offer the conversion settings you chose. " +
    "Choose different settings to convert.",
  "plan-superseded": "MSCanvas is rereading the conversion plan for the settings you changed.",
  "queue-not-retryable":
    "A stopped queue is not rerun in place. Convert those acquisitions again from the list.",
  "nothing-to-retry": "Nothing in this queue would change on another attempt.",
};

/**
 * The one conversion-start answer, with its reason.
 *
 * **Precedence names the fact that decides, not the one that is longest-lived.**
 * Several hold at once -- a conversion running during an installation check
 * against a backend this session had already stopped trusting -- and the order
 * is:
 *
 * 1. a session that has lost a converter process. It ranks first because it is
 *    the only one waiting does not clear, and naming anything below it would
 *    tell the reader to wait for something that will never arrive;
 * 2. a check owns the backend lane. Above usability rather than below it: a
 *    check reports the backend as not usable for as long as it runs, and
 *    reading that as a verdict tells the reader their installation is broken
 *    every time it is looked at;
 * 3. a settled verdict this session will not launch against, which needs the
 *    reader to change something;
 * 4. the four things that end by themselves, longest first: a conversion, a
 *    run being read, an adoption, a diagnostics export, a change to the file
 *    list;
 * 5. the target, and then what a start of that target still needs: a settled
 *    semantic, and a plan that answers the request as it now stands. Last,
 *    because "select something to convert" said while a conversion is running
 *    is a true sentence about the wrong problem.
 *
 * The unread slot sits above the four that end by themselves, and says so here
 * rather than being ordered by accident: until the one slot has been read,
 * whether a conversion is running is not known, so naming any of them would be
 * a guess dressed as a reason.
 *
 * There is no message for `available`, because a control that can be used has
 * nothing to explain and an explanation shown beside a working control is a
 * reason to doubt it.
 */
export function conversionAvailability(
  lane: ConversionLane,
  action: ConversionAction,
): ConversionAvailability {
  const reason = unavailableReason(lane, action);
  return reason === null
    ? { status: "available" }
    : { status: "unavailable", reason, message: CONVERSION_MESSAGES[reason] };
}

function unavailableReason(
  lane: ConversionLane,
  action: ConversionAction,
): ConversionUnavailableReason | null {
  if (lane.backendQuarantined) {
    return "backend-quarantined";
  }
  if (lane.backendChanging) {
    return "backend-changing";
  }
  if (!lane.backendUsable) {
    return "backend-unavailable";
  }
  if (lane.slotUnread) {
    return "conversion-state-unknown";
  }
  if (lane.laneClaimed) {
    return "conversion-running";
  }
  if (lane.previewReading) {
    return "preview-running";
  }
  if (lane.adopting) {
    return "adoption-running";
  }
  if (lane.exportingDiagnostics) {
    return "diagnostics-exporting";
  }
  if (lane.workspaceSettling) {
    return "workspace-settling";
  }
  return targetReason(action);
}

/**
 * What the action itself is short of, once the lane is clear.
 *
 * Exhaustive over the action union rather than over booleans, so an action
 * added later cannot reach the end of this function without a target rule of
 * its own.
 */
function targetReason(action: ConversionAction): ConversionUnavailableReason | null {
  switch (action.kind) {
    case "start":
      if (action.targetCount === 0) {
        return "no-convertible-target";
      }
      // The semantic before the plan, because a plan is an answer *about* one:
      // "the plan is being reread" said while the settings themselves could not
      // be established would name the symptom rather than the cause.
      switch (action.settings) {
        case "loading":
          return "settings-loading";
        case "unavailable":
          return "settings-unavailable";
        case "unsupported":
          return "intent-unsupported";
        case "ready":
          break;
      }
      return action.planIsCurrent ? null : "plan-superseded";
    case "retry":
      if (!action.queueCompleted) {
        return "queue-not-retryable";
      }
      return action.retryableFailureCount === 0 ? "nothing-to-retry" : null;
  }
}

/**
 * Whether a conversion of these rows may start.
 *
 * The projection the operation's own guard is, so a handler and the control
 * that offers it evaluate the same code rather than two expressions that
 * merely looked alike.
 */
export function canStartConversion(
  lane: ConversionLane,
  target: Omit<Extract<ConversionAction, { kind: "start" }>, "kind">,
): boolean {
  return conversionAvailability(lane, { kind: "start", ...target }).status === "available";
}

/**
 * Whether this terminal queue's failures may be rerun.
 *
 * Its own decision, and deliberately not `canStartConversion` under another
 * name. The lane facts are shared; the target is not, and a queue with nothing
 * retryable in it is refused where a start of new rows would be accepted.
 */
export function canRetryConversion(
  lane: ConversionLane,
  retryableFailureCount: number,
  queueCompleted: boolean,
): boolean {
  return (
    conversionAvailability(lane, { kind: "retry", retryableFailureCount, queueCompleted })
      .status === "available"
  );
}

/**
 * Where the conversion panel says why an action is unavailable.
 *
 * One id per reason rather than one per control, because the two controls
 * share a lane: where both are refused for the same fact they point at one
 * sentence, and a reader who meets the second control is not told the same
 * thing twice by a screen reader that has no way to know it is the same thing.
 * Where the reasons genuinely differ -- a lane that is clear, a rerun with
 * nothing in it -- each control names its own.
 */
export function conversionNoticeId(reason: ConversionUnavailableReason): string {
  return `conversion-availability-${reason}`;
}
