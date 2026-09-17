import type { MessageArguments, MessageKey, UiMessage } from "../preferences/i18n";
import type { PreviewError } from "../mzml-preview/contracts";
import { ownedErrorMessage } from "../mzml-preview/ownedErrorMessages";
import type { WorkspaceNotice } from "../mzml-preview/rosterSelection";

type NoticeKey = Extract<MessageKey, `notice${string}`>;
type MessagePart = { [K in NoticeKey]: readonly [key: K, ...args: MessageArguments<K>] }[NoticeKey];
/** Bounded presentation data, translated only when rendered. Provider prose stays original. */
export type WorkspaceNoticePart = MessagePart | {
  readonly source: "folder" | "drop";
  readonly limits: readonly string[];
} | {
  /**
   * A candidate the workspace refused, carried as the error rather than as its
   * sentence.
   *
   * Interpolating `error.summary` straight into the detail line put the
   * boundary's English into a Chinese session for every refusal this build has
   * a sentence for -- an unsupported extension, a full workspace, a file that
   * is not a regular file. Keeping the error here defers the choice to the
   * moment there is a `t` to make it with.
   */
  readonly rejected: { readonly name: string; readonly error: PreviewError };
};
const folderLimits = { depth: "noticeFolderDepth", entries: "noticeFolderEntries", directories: "noticeFolderDirectories", candidates: "noticeFolderCandidates" } as const;
const dropLimits = { roots: "noticeDropRoots", depth: "noticeDropDepth", entries: "noticeDropEntries", directories: "noticeDropDirectories", candidates: "noticeDropCandidates" } as const;

function renderPart(part: WorkspaceNoticePart, t: UiMessage): string {
  if ("rejected" in part) {
    return t("noticeRejected", { name: part.rejected.name, summary: ownedErrorMessage(part.rejected.error, t) });
  }
  if ("source" in part) {
    const mapping = part.source === "folder" ? folderLimits : dropLimits;
    const reasons = part.limits.map(limit => t(mapping[limit as keyof typeof mapping] ?? "noticeLimitUnknown"));
    const last = reasons.pop();
    if (last === undefined) return "";
    const prefix = reasons.reduce((left, right) => left === "" ? right : t("noticeListComma", { left, right }), "");
    return t(part.source === "folder" ? "noticeFolderLimit" : "noticeDropLimit", { reasons: prefix === "" ? last : t("noticeListPair", { left: prefix, right: last }) });
  }
  // The tuple union enforces each key's parameters at construction. The shared
  // binder also validates the dynamic call before invoking the existing engine.
  return (t as (key: NoticeKey, parameters?: object) => string)(part[0], part[1]);
}

export function formatWorkspaceNotice(notice: WorkspaceNotice, t: UiMessage) {
  return { ...notice, message: notice.message.map(part => renderPart(part, t)).join(" "), details: notice.details.map(part => renderPart(part, t)) };
}
