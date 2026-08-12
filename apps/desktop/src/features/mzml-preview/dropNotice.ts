/** A bounded, path-free account of one native Explorer drop. */

import type { DropIngestionResult, DropScanLimit } from "./contracts";
import { MAX_NOTICE_DETAILS, plural, type WorkspaceNotice } from "./rosterSelection";

const LIMIT_REACHED: Record<DropScanLimit, string> = {
  roots: "more top-level items were dropped than MSCanvas accepts at once",
  depth: "a dropped folder was nested deeper than MSCanvas walks in one scan",
  entries: "this drop reached the shared entry-inspection limit",
  directories: "this drop reached the shared directory-entry limit",
  candidates: "the drop produced more candidate files than MSCanvas accepts in one scan",
};

function describeLimit(limit: DropScanLimit): string {
  return LIMIT_REACHED[limit];
}

function listOf(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  const last = values[values.length - 1] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${last}`;
}

export function describeDropResult(result: DropIngestionResult): WorkspaceNotice {
  const { outcomes, summary } = result;
  const added = outcomes.filter((outcome) => outcome.outcome === "added").length;
  const duplicates = outcomes.filter((outcome) => outcome.outcome === "duplicate").length;
  const rejected = outcomes.flatMap((outcome) =>
    outcome.outcome === "rejected" ? [outcome] : [],
  );
  const full = rejected.filter((outcome) => outcome.error.kind === "workspace_full").length;
  const unreadable = rejected.length - full;
  const supportedCandidates = outcomes.filter(
    (outcome) =>
      outcome.outcome !== "rejected" || outcome.error.kind !== "unsupported_extension",
  ).length;
  const noSupportedCandidates = summary.complete && supportedCandidates === 0;
  const parts: string[] = [];

  if (added === 0 && !summary.complete) {
    parts.push("No files were added, and the dropped items were not fully inspected.");
  } else if (noSupportedCandidates) {
    parts.push("No supported mzML files were found in the dropped items.");
  } else {
    parts.push(added === 0 ? "No files were added." : `Added ${plural(added, "file")}.`);
  }
  if (!noSupportedCandidates && duplicates > 0) {
    parts.push(`${plural(duplicates, "file")} already in the workspace.`);
  }
  if (!noSupportedCandidates && unreadable > 0) {
    parts.push(`${plural(unreadable, "file")} could not be added.`);
  }
  if (!noSupportedCandidates && full > 0) {
    parts.push(
      `${plural(full, "file")} did not fit: the workspace already holds as many as MSCanvas keeps.`,
    );
  }
  if (added > 0 && !summary.complete) {
    parts.push("MSCanvas added what it found, but the complete drop could not be inspected.");
  }

  if (summary.skippedReparseRootCount > 0) {
    const count = summary.skippedReparseRootCount;
    parts.push(
      `MSCanvas skipped ${String(count)} linked or special top-level ${
        count === 1 ? "item" : "items"
      } and did not follow ${count === 1 ? "it" : "them"}.`,
    );
  }
  if (summary.inaccessibleRootCount > 0) {
    const count = summary.inaccessibleRootCount;
    parts.push(
      `${plural(count, "top-level item")} could not be read and ${
        count === 1 ? "was" : "were"
      } left out.`,
    );
  }
  if (summary.remoteRootCount > 0) {
    const count = summary.remoteRootCount;
    parts.push(
      `${plural(count, "remote top-level item")} ${
        count === 1 ? "was" : "were"
      } left out because MSCanvas does not inspect remote drops.`,
    );
  }
  if (summary.unsupportedRootCount > 0) {
    const count = summary.unsupportedRootCount;
    parts.push(
      `${plural(count, "top-level item")} ${count === 1 ? "was" : "were"} not supported.`,
    );
  }
  if (summary.skippedReparseEntryCount > 0) {
    const count = summary.skippedReparseEntryCount;
    parts.push(
      `MSCanvas skipped ${String(count)} linked or special filesystem ${
        count === 1 ? "entry" : "entries"
      } inside dropped folders and did not follow ${count === 1 ? "it" : "them"}.`,
    );
  }
  if (summary.inaccessibleEntryCount > 0) {
    const count = summary.inaccessibleEntryCount;
    parts.push(
      `${plural(count, "entry")} inside dropped folders could not be read and ${
        count === 1 ? "was" : "were"
      } left out.`,
    );
  }
  if (summary.limitsReached.length > 0) {
    parts.push(
      `The drop stopped short because ${listOf(summary.limitsReached.map(describeLimit))}.`,
    );
  }

  const details = outcomes.flatMap((outcome) => {
    if (outcome.outcome === "duplicate") {
      return [`${outcome.existing.fileName} is already in the workspace.`];
    }
    if (outcome.outcome === "rejected") {
      return [`${outcome.candidateName}: ${outcome.error.summary}`];
    }
    return [];
  });
  const aggregateWarnings =
    summary.skippedReparseRootCount +
    summary.inaccessibleRootCount +
    summary.remoteRootCount +
    summary.unsupportedRootCount +
    summary.skippedReparseEntryCount +
    summary.inaccessibleEntryCount;

  return {
    tone:
      !summary.complete || duplicates + rejected.length + aggregateWarnings > 0
        ? "warning"
        : "info",
    message: parts.join(" "),
    details: details.slice(0, MAX_NOTICE_DETAILS),
    more: Math.max(0, details.length - MAX_NOTICE_DETAILS),
    sequence: 0,
  };
}
