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

import type { ConversionStartPlan } from "./conversionPlanAuthority";

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
  /**
   * Whether a conversion-configuration read owns the lane.
   *
   * One `msconvert --help` read of this build's option grammar has been
   * admitted and has not yet settled. It is backend process work like any
   * other, so Rust's gate refuses a conversion while it runs and this is what
   * stops the interface offering one first (ADR 0044 Decision 10).
   *
   * It says that and nothing more. Whether the configuration is loading,
   * unavailable, or may be read at all are three other questions with three
   * other owners -- and *may a probe start* is
   * `ConversionConfigurationProbeAdmission`'s, never this field's.
   */
  readonly configurationProbing: boolean;
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
       * What the plan contributes.
       *
       * A start is an action on a *described* conversion: the reader presses
       * `Convert` beside a summary, and what runs must be what that summary
       * described. So the plan is part of the target rather than a second
       * condition beside this rule -- a control that consulted the lane here
       * and the plan somewhere else is exactly how the button and the sentence
       * beneath it come to answer different questions.
       */
      readonly plan: ConversionStartPlan;
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

/** Why a conversion action cannot start, named for what the reader can do. */
export type ConversionUnavailableReason =
  | "backend-quarantined"
  | "backend-changing"
  | "backend-unavailable"
  | "conversion-running"
  | "preview-running"
  | "configuration-probing"
  | "adoption-running"
  | "diagnostics-exporting"
  | "workspace-settling"
  | "no-convertible-target"
  | "plan-reading"
  | "plan-failed"
  | "plan-capacity-exceeded"
  | "plan-settings-unknown"
  | "plan-selection-unavailable"
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
  // Neither "a converter" nor "stopped". This state is reached from a preview,
  // a spectrum read and a discovery help probe as well as from a conversion,
  // and by a root that could neither be started nor reclaimed with nothing in
  // flight -- so naming a stop names an action the user may never have taken.
  "backend-quarantined":
    "MSCanvas could not confirm that a ProteoWizard process it started has ended. " +
    "Restart MSCanvas before starting another conversion.",
  "backend-changing":
    "Converting is unavailable while the installed ProteoWizard backend is being checked.",
  "backend-unavailable":
    "Converting needs ProteoWizard, and this session has no usable backend. " +
    "See the backend status above.",
  "conversion-running": "Converting is unavailable while a conversion is running.",
  "preview-running": "Converting is unavailable while a run is being read.",
  "configuration-probing":
    "Converting is unavailable while MSCanvas is reading the conversion options from ProteoWizard.",
  "adoption-running":
    "Converting is unavailable while converted outputs are being added to the workspace.",
  "diagnostics-exporting":
    "Converting is unavailable while failure diagnostics are being saved.",
  "workspace-settling": "Converting is unavailable while the file list is being changed.",
  "no-convertible-target": "Choose a scope containing supported vendor acquisitions to convert.",
  "plan-capacity-exceeded": "Choose fewer eligible rows before converting.",
  // Three sentences for three situations a single "no plan" could not tell
  // apart, and the difference is what the reader can do. One is a wait, one is
  // a control to press, and one is a change to make above.
  "plan-reading": "MSCanvas is working out what this conversion would do.",
  "plan-failed":
    "MSCanvas could not work out what this conversion would do. " +
    "Try describing it again.",
  "plan-settings-unknown":
    "MSCanvas does not yet know what this ProteoWizard installation can convert, " +
    "so it cannot describe this conversion. See the conversion settings above.",
  "plan-selection-unavailable":
    "The installed ProteoWizard does not offer the conversion settings you chose, " +
    "so there is nothing to convert with. Choose settings it offers above.",
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
 * 4. the things that end by themselves. The three that own a backend process
 *    first, longest-lived first -- a conversion, a run being read, a
 *    configuration probe -- and then the three that own none: an adoption, a
 *    diagnostics export, a change to the file list. The probe sits below the
 *    other two process owners rather than above them because
 *    `ConversionConfigurationProbeAdmission` consults these same facts in this
 *    same order and puts probe-in-flight last (ADR 0044 Decision 11), and
 *    Decision 12 requires the two authorities to name a contended moment
 *    identically: admission's order must stay a subsequence of this one, or a
 *    moment keyed `conversion-running` by the lane could be keyed
 *    `preview-running` by admission and emit two notices for one fact;
 * 5. the target. Last, because "select something to convert" said while a
 *    conversion is running is a true sentence about the wrong problem.
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
  if (lane.laneClaimed) {
    return "conversion-running";
  }
  if (lane.previewReading) {
    return "preview-running";
  }
  if (lane.configurationProbing) {
    return "configuration-probing";
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
      // The rows first: "MSCanvas is working out what this conversion would
      // do" said over an empty selection is a true sentence about the wrong
      // problem, and the plan is `absent` for exactly that case anyway.
      if (action.targetCount === 0) {
        return "no-convertible-target";
      }
      return planReason(action.plan);
    case "retry":
      if (!action.queueCompleted) {
        return "queue-not-retryable";
      }
      return action.retryableFailureCount === 0 ? "nothing-to-retry" : null;
  }
}

/**
 * Why the plan refuses a start, or `null` where it does not.
 *
 * Exhaustive over the plan's own vocabulary rather than over booleans, so a
 * state added to the machine cannot reach the end of this function without a
 * sentence of its own.
 */
function planReason(plan: ConversionStartPlan): ConversionUnavailableReason | null {
  switch (plan) {
    case "capacityExceeded":
      return "plan-capacity-exceeded";
    case "ready":
      return null;
    case "reading":
      return "plan-reading";
    case "failed":
      return "plan-failed";
    case "settingsUnknown":
      return "plan-settings-unknown";
    case "selectionUnavailable":
      return "plan-selection-unavailable";
    case "absent":
      // Rows were asked about and the plan says none were. Unreachable past
      // the count above, and answered here rather than left to fall through:
      // a target reason is what an action with nothing to act on is short of.
      return "no-convertible-target";
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
  targetCount: number,
  plan: ConversionStartPlan,
): boolean {
  return conversionAvailability(lane, { kind: "start", targetCount, plan }).status === "available";
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
