import type { PreviewError } from "../mzml-preview/contracts";
import { ownedErrorMessage } from "../mzml-preview/ownedErrorMessages";
import type { MessageKey, UiMessage } from "../preferences/i18n";
import { explainUnavailableProblem } from "../preferences/storageMessages";
import type { RunState } from "./runHistoryApi";
import type { RunWriteAnswer } from "./useRunList";

/** The store's own problem ids, in the user's terms. */
const PROBLEM = {
  notWritten: "runHistoryProblemNotWritten",
  ownerUnavailable: "runHistoryProblemOwner",
  directoryUnusable: "runHistoryProblemDirectory",
  unsafeDirectory: "runHistoryProblemUnsafe",
  newerVersion: "runHistoryProblemNewer",
  unreadable: "runHistoryProblemUnreadable",
  notTurnedOn: "runHistoryProblemNotOn",
  notTurnedOff: "runHistoryProblemNotOff",
  notListed: "runHistoryProblemNotListed",
  notSwept: "runHistoryProblemNotSwept",
} as const satisfies Record<string, MessageKey>;

/**
 * A problem id as a sentence. One this table does not know is a binding problem
 * of the per-user directory the store shares with the preferences, whose table
 * shows a code it does not know inside an honest wrapper.
 */
export function explainRunHistoryProblem(code: string, t: UiMessage): string {
  return Object.hasOwn(PROBLEM, code) ? t(PROBLEM[code as keyof typeof PROBLEM]) : explainUnavailableProblem(code, t);
}

/**
 * A refused request as a sentence. The one refusal every history command shares
 * is the document check's, whose own sentence is about a conversion request and
 * would send the reader off to convert again.
 */
export function explainRunHistoryError(error: PreviewError, t: UiMessage): string {
  return error.kind === "invalid_conversion_reservation" ? t("runHistoryRequestRefused") : ownedErrorMessage(error, t);
}

/** `SampleCompletenessRefusal::stable_id`'s identifiers, in the user's terms. */
const COMPLETENESS_REASON = {
  source_sample_failure_observed: "runHistoryCompletenessFailureObserved",
  source_sample_audit_truncated: "runHistoryCompletenessAuditTruncated",
  source_sample_audit_unrecognized: "runHistoryCompletenessAuditUnrecognized",
  source_sample_output_filtering_requested: "runHistoryCompletenessFiltered",
  source_sample_backend_incomplete: "runHistoryCompletenessBackendIncomplete",
  source_sample_no_published_members: "runHistoryCompletenessNoMembers",
  source_sample_set_not_fully_published: "runHistoryCompletenessNotWhole",
} as const satisfies Record<string, MessageKey>;

/** Why completeness was not established. One this table does not know is named as itself. */
export function completenessSentence(reason: string, t: UiMessage): string {
  return t("runHistoryCompletenessNotEstablished", {
    reason: Object.hasOwn(COMPLETENESS_REASON, reason) ? t(COMPLETENESS_REASON[reason as keyof typeof COMPLETENESS_REASON]) : reason,
  });
}

export const RUN_STATE_LABEL = {
  running: "runHistoryStateRunning",
  completed: "runHistoryStateCompleted",
  stopped: "runHistoryStateStopped",
  stopFailed: "runHistoryStateStopFailed",
  interrupted: "runHistoryStateInterrupted",
} as const satisfies Record<RunState, MessageKey>;

/** What a Clear or an Off that did not plainly succeed says; `null` when it did. */
export function writeProblem(answer: RunWriteAnswer | null, t: UiMessage): string | null {
  switch (answer?.outcome) {
    case "failed":
      return answer.problem === "notRemoved"
        ? t("runHistoryNotRemoved", { count: answer.notRemoved })
        : explainRunHistoryProblem(answer.problem, t);
    case "unavailable":
      return explainRunHistoryProblem(answer.problem, t);
    case "error":
      return explainRunHistoryError(answer.error, t);
    default:
      return null;
  }
}
