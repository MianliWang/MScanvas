/** Bounded, path-free presentation data for one native Explorer drop. */
import type { DropIngestionResult } from "./contracts";
import { MAX_NOTICE_DETAILS, type WorkspaceNotice } from "./rosterSelection";
import type { WorkspaceNoticePart } from "../workbench/workspaceMessages";

export function describeDropResult(result: DropIngestionResult): WorkspaceNotice {
  const { outcomes, summary } = result;
  const added = outcomes.filter(outcome => outcome.outcome === "added").length;
  const duplicates = outcomes.filter(outcome => outcome.outcome === "duplicate").length;
  const rejected = outcomes.flatMap(outcome => outcome.outcome === "rejected" ? [outcome] : []);
  const full = rejected.filter(outcome => outcome.error.kind === "workspace_full").length;
  const unreadable = rejected.length - full;
  const noSupportedCandidates = summary.complete && outcomes.every(outcome => outcome.outcome === "rejected" && outcome.error.kind === "unsupported_extension");
  const message: WorkspaceNoticePart[] = [];
  if (added === 0 && !summary.complete) message.push(["noticeDropNoneIncomplete"]);
  else if (noSupportedCandidates) message.push(["noticeDropNoneFound"]);
  else message.push(added === 0 ? ["noticeNoneAdded"] : ["noticeAdded", { count: added }]);
  if (!noSupportedCandidates && duplicates > 0) message.push(["noticeDuplicates", { count: duplicates }]);
  if (!noSupportedCandidates && unreadable > 0) message.push(["noticeUnreadable", { count: unreadable }]);
  if (!noSupportedCandidates && full > 0) message.push(["noticeFull", { count: full }]);
  if (added > 0 && !summary.complete) message.push(["noticeDropPartial"]);
  if (summary.skippedReparseRootCount > 0) message.push(["noticeDropLinkedRoot", { count: summary.skippedReparseRootCount }]);
  if (summary.inaccessibleRootCount > 0) message.push(["noticeDropInaccessibleRoot", { count: summary.inaccessibleRootCount }]);
  if (summary.remoteRootCount > 0) message.push(["noticeDropRemoteRoot", { count: summary.remoteRootCount }]);
  if (summary.unsupportedRootCount > 0) message.push(["noticeDropUnsupportedRoot", { count: summary.unsupportedRootCount }]);
  if (summary.skippedReparseEntryCount > 0) message.push(["noticeDropLinkedEntry", { count: summary.skippedReparseEntryCount }]);
  if (summary.inaccessibleEntryCount > 0) message.push(["noticeDropInaccessibleEntry", { count: summary.inaccessibleEntryCount }]);
  if (summary.limitsReached.length > 0) message.push({ source: "drop", limits: [...summary.limitsReached] });
  const details = outcomes.flatMap<WorkspaceNoticePart>(outcome => outcome.outcome === "duplicate"
    ? [["noticeDuplicate", { name: outcome.existing.fileName }]]
    : outcome.outcome === "rejected" ? [{ rejected: { name: outcome.candidateName, error: outcome.error } }] : []);
  const warnings = summary.skippedReparseRootCount + summary.inaccessibleRootCount + summary.remoteRootCount + summary.unsupportedRootCount + summary.skippedReparseEntryCount + summary.inaccessibleEntryCount;
  return { tone: !summary.complete || duplicates + rejected.length + warnings > 0 ? "warning" : "info", message,
    details: details.slice(0, MAX_NOTICE_DETAILS), more: Math.max(0, details.length - MAX_NOTICE_DETAILS), sequence: 0 };
}
