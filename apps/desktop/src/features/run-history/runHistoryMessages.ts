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
} as const satisfies Record<string, MessageKey>;

/**
 * A problem id as a sentence. One this table does not know is a binding problem
 * of the per-user directory the store shares with the preferences, whose table
 * shows a code it does not know inside an honest wrapper.
 */
export function explainRunHistoryProblem(code: string, t: UiMessage): string {
  return Object.hasOwn(PROBLEM, code) ? t(PROBLEM[code as keyof typeof PROBLEM]) : explainUnavailableProblem(code, t);
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
      return ownedErrorMessage(answer.error, t);
    default:
      return null;
  }
}
