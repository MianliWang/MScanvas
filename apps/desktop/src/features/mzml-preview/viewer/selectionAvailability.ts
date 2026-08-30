/**
 * Whether a scan may be committed right now, and what to say when it may not.
 *
 * One rule, read by the operation and by every surface that offers to commit a
 * scan. It lives here rather than in the workspace hook because a memoized
 * plot and a virtualized table both have to ask it, and neither of them should
 * have to import a hook to do so.
 */

/**
 * What a selection needs before it can look at a target at all.
 *
 * The four facts `selectSpectrum` reads before it has considered *which* row
 * was asked for. They are about the lane rather than about the row: a run to
 * select from, a backend worth launching, and neither of the two things that
 * own the one backend lane already doing so.
 */
export interface SpectrumSelectionLane {
  /** Whether a run's spectrum table is loaded to select a row of. */
  readonly hasLoadedPreview: boolean;
  /** Whether this session's own verdict says the backend can be launched. */
  readonly backendUsable: boolean;
  /** Whether an installation check or change owns the backend lane. */
  readonly backendBusy: boolean;
  /** Whether a conversion owns it. */
  readonly conversionBusy: boolean;
}

/**
 * Whether a selection could reach its target-specific checks right now.
 *
 * One rule with two readers, and that is the whole reason it is a function.
 * The operation asks it from refs, inside a handler that may be several
 * commits older than the truth; the interface asks it from rendered state, to
 * decide whether a control may advertise itself as available. Two handwritten
 * expressions that merely looked alike is how a button came to say a scan step
 * was available for the length of a conversion queue and do nothing when it
 * was pressed.
 *
 * Deliberately **not** in it:
 *
 * - whether an adjacent row exists, or the requested row is in the table, or
 *   that exact row is already being read. Those are questions about a target,
 *   and a control that had to predict them would be predicting a different
 *   thing for every target;
 * - whether another selected-spectrum read is unresolved. A newer selection of
 *   a *different* scan is allowed to supersede an older one -- that is the
 *   contract `spectrumToken` exists for, and disabling a scan step for it
 *   would take away a step the operation would have accepted. It is why this
 *   is not `canPreview`, which includes exactly that and several policies
 *   belonging to other actions.
 */
export function canStartSpectrumSelection(lane: SpectrumSelectionLane): boolean {
  return spectrumSelectionAvailability(lane).status === "available";
}

/** Why a scan cannot be committed right now, named for what the reader can do. */
export type SpectrumSelectionUnavailableReason =
  | "no-loaded-run"
  | "backend-unavailable"
  | "backend-changing"
  | "conversion-running";

/**
 * Whether a selection may start, and what to say when it may not.
 *
 * The same rule `canStartSpectrumSelection` is, carrying its reason. A boolean
 * could gate a handler but could not tell a reader anything, so every surface
 * that wanted to explain itself had to decide again what was wrong -- which is
 * a second authority however carefully it is written. This is the one answer,
 * and the boolean is a projection of it.
 */
export type SpectrumSelectionAvailability =
  | { readonly status: "available" }
  | {
      readonly status: "unavailable";
      readonly reason: SpectrumSelectionUnavailableReason;
      /** What the reader is told. Never implementation vocabulary. */
      readonly message: string;
    };

/**
 * What each refusal says.
 *
 * Named after something on screen or something the reader can change. A lane,
 * a ref, a token or a mutex is true and useless: it describes the machinery
 * that refused rather than the situation the reader is in.
 */
const SPECTRUM_SELECTION_MESSAGES: Record<SpectrumSelectionUnavailableReason, string> = {
  "no-loaded-run": "Load a run to select a scan from.",
  "backend-unavailable":
    "Selecting a scan needs ProteoWizard, and this session has no usable backend. " +
    "See the backend status above.",
  "backend-changing":
    "Selecting a scan is unavailable while the installed ProteoWizard backend is being checked.",
  "conversion-running": "Selecting a scan is unavailable while a conversion is running.",
};

/**
 * The one selection-start answer, with its reason.
 *
 * **Precedence names the fact that decides, not the one that is longest-lived.**
 * Several hold at once -- a conversion during an installation check against a
 * backend this session had already stopped trusting -- and the order is:
 *
 * 1. nothing to select from at all;
 * 2. a check owns the backend lane. It ranks *above* usability rather than
 *    below it: a check reports the backend as not usable for as long as it
 *    runs, and reading that as a verdict tells the reader their installation
 *    is broken every time it is looked at;
 * 3. a settled verdict this session will not launch against, which needs the
 *    reader to change something;
 * 4. a conversion, which ends by itself. Last, because naming it while one of
 *    the two above also holds would promise that waiting is enough.
 *
 * There is no message for `available`, because a control that can be used has
 * nothing to explain and an explanation shown beside a working control is a
 * reason to doubt it.
 */
export function spectrumSelectionAvailability(
  lane: SpectrumSelectionLane,
): SpectrumSelectionAvailability {
  const reason = unavailableReason(lane);
  return reason === null
    ? { status: "available" }
    : { status: "unavailable", reason, message: SPECTRUM_SELECTION_MESSAGES[reason] };
}

function unavailableReason(lane: SpectrumSelectionLane): SpectrumSelectionUnavailableReason | null {
  if (!lane.hasLoadedPreview) {
    return "no-loaded-run";
  }
  if (lane.backendBusy) {
    return "backend-changing";
  }
  if (!lane.backendUsable) {
    return "backend-unavailable";
  }
  if (lane.conversionBusy) {
    return "conversion-running";
  }
  return null;
}

/**
 * Where the viewer says why selection is unavailable.
 *
 * One id, because there is one explanation. Both committing surfaces point at
 * it rather than repeating the sentence, so a reader who meets the second one
 * is not told the same thing twice by a screen reader that has no way to know
 * it is the same thing.
 */
export const SPECTRUM_SELECTION_NOTICE_ID = "viewer-selection-availability";
