/**
 * Localized explanations for the preference store's owned codes.
 *
 * Every code this build knows gets a sentence that says what happened and what
 * is still true -- above all, whether the last saved record is still what a
 * restart will find. A code it does not know stays inspectable inside an honest
 * localized wrapper rather than being dropped, guessed at or shown raw: the
 * reader is told that MSCanvas does not recognise it, and is shown it.
 *
 * Nothing here interprets an operating-system message or a provider's output.
 * The store never sends one.
 */

import type { MessageKey, UiMessage } from "./i18n";

/** Why a stored record could not be used. */
const READ_PROBLEMS = {
  malformed: "storedMalformed",
  unsupportedVersion: "storedUnsupportedVersion",
  oversized: "storedOversized",
  unreadable: "storedUnreadable",
  unsafeTarget: "storedUnsafeTarget",
} as const satisfies Record<string, MessageKey>;

/** Why a commit did not happen. */
const WRITE_PROBLEMS = {
  directoryUnusable: "writeDirectoryUnusable",
  unsafeTarget: "writeUnsafeTarget",
  notWritten: "writeNotWritten",
  notPublished: "writeNotPublished",
  notConfirmed: "writeNotConfirmed",
  oversized: "writeOversized",
  invalidRecord: "writeInvalidRecord",
  nothingToSave: "writeNothingToSave",
  requestFailed: "writeRequestFailed",
} as const satisfies Record<string, MessageKey>;

/** Why there is nowhere to store preferences at all. */
const UNAVAILABLE_PROBLEMS = {
  rootUnresolved: "storageRootUnresolved",
  readFailed: "storageReadFailed",
  qaRootUnbound: "storageQaRoot",
  qaRootNotAbsolute: "storageQaRoot",
  qaRootNotADirectory: "storageQaRoot",
} as const satisfies Record<string, MessageKey>;

function explain(
  table: Readonly<Record<string, MessageKey>>,
  code: string | null,
  message: UiMessage,
): string {
  if (code === null) return message("storageUnknownProblem", { code: "-" });
  const key = Object.hasOwn(table, code) ? table[code] : undefined;
  // An unknown code is shown, not swallowed. Its meaning is not this build's to
  // invent, and a reader who can quote it can be helped with it.
  return key === undefined ? message("storageUnknownProblem", { code }) : message(key);
}

export function explainStoredProblem(code: string | null, message: UiMessage): string {
  return explain(READ_PROBLEMS, code, message);
}

export function explainWriteProblem(code: string | null, message: UiMessage): string {
  return explain(WRITE_PROBLEMS, code, message);
}

export function explainUnavailableProblem(code: string | null, message: UiMessage): string {
  return explain(UNAVAILABLE_PROBLEMS, code, message);
}
