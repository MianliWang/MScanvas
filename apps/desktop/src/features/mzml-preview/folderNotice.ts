/**
 * What one folder import did, said in bounded, path-free words.
 *
 * Its own module because a folder import has to say something a file batch
 * never does: whether the answer is the whole answer. A scan that stopped at a
 * limit, refused a linked entry or could not read a subtree has described part
 * of a folder, and the one thing it must not do is report that part as the
 * whole — "no mzML files were found" and "nothing was added, and the scan was
 * incomplete" are different claims, and only one of them is ever true.
 *
 * Pure, and it never sees a path: what it is given is filenames, counts and
 * which named limits were reached. The chosen folder's own name is not among
 * them and cannot be reconstructed from them.
 */

import type { FolderIngestionResult, SelectedFile } from "./contracts";
import { MAX_NOTICE_DETAILS, type WorkspaceNotice } from "./rosterSelection";
import type { WorkspaceNoticePart } from "../workbench/workspaceMessages";

/** Use only Rust's bounded collision context, never infer a path. */
function nameOf(dataset: SelectedFile): string {
  return dataset.relativeContext === null ? dataset.fileName : `${dataset.fileName} (${dataset.relativeContext})`;
}

export function describeFolderResult(result: FolderIngestionResult): WorkspaceNotice {
  const { discovery, outcomes } = result;
  const added = outcomes.filter(outcome => outcome.outcome === "added").length;
  const duplicates = outcomes.filter(outcome => outcome.outcome === "duplicate").length;
  const rejected = outcomes.flatMap(outcome => outcome.outcome === "rejected" ? [outcome] : []);
  const full = rejected.filter(outcome => outcome.error.kind === "workspace_full").length;
  const unreadable = rejected.length - full;
  const message: WorkspaceNoticePart[] = [];
  // An incomplete scan cannot claim that the folder contained no mzML files.
  if (added === 0 && !discovery.complete) message.push(["noticeFolderNoneIncomplete"]);
  else if (outcomes.length === 0) message.push(["noticeFolderNoneFound"]);
  else message.push(added === 0 ? ["noticeNoneAdded"] : ["noticeAdded", { count: added }]);
  if (duplicates > 0) message.push(["noticeDuplicates", { count: duplicates }]);
  if (unreadable > 0) message.push(["noticeUnreadable", { count: unreadable }]);
  if (full > 0) message.push(["noticeFull", { count: full }]);
  if (added > 0 && !discovery.complete) message.push(["noticeFolderPartial"]);
  if (discovery.skippedReparseCount > 0) message.push(["noticeFolderLinked", { count: discovery.skippedReparseCount }]);
  if (discovery.inaccessibleEntryCount > 0) message.push(["noticeFolderInaccessible", { count: discovery.inaccessibleEntryCount }]);
  if (discovery.limitsReached.length > 0) message.push({ source: "folder", limits: [...discovery.limitsReached] });
  // Preserve scan outcome order and a bounded prefix of original names/prose.
  const details = outcomes.flatMap<WorkspaceNoticePart>(outcome => outcome.outcome === "duplicate"
    ? [["noticeDuplicate", { name: nameOf(outcome.existing) }]]
    : outcome.outcome === "rejected" ? [["noticeRejected", { name: outcome.candidateName, summary: outcome.error.summary }]] : []);
  return { tone: !discovery.complete || duplicates + rejected.length > 0 ? "warning" : "info", message,
    details: details.slice(0, MAX_NOTICE_DETAILS), more: Math.max(0, details.length - MAX_NOTICE_DETAILS), sequence: 0 };
}
