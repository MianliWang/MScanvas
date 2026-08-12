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

import type { FolderIngestionResult, FolderScanLimit, SelectedFile } from "./contracts";
import { MAX_NOTICE_DETAILS, plural, type WorkspaceNotice } from "./rosterSelection";

/**
 * What each named traversal limit means to a reader.
 *
 * Deliberately about the folder rather than about the counter. How many entries
 * MSCanvas inspected and how many directories it entered describe the shape of
 * the user's tree, and pointing at a folder is not permission to report that;
 * what a reader needs is whether choosing a narrower folder would help.
 */
const LIMIT_REACHED: Record<FolderScanLimit, string> = {
  depth: "it is nested deeper than MSCanvas walks in one scan",
  entries: "it holds more entries than MSCanvas inspects in one scan",
  directories: "it holds more subfolders than MSCanvas enters in one scan",
  candidates: "it holds more .mzML files than MSCanvas takes from one scan",
};

/**
 * A limit this version does not recognise still says something.
 *
 * The contract's union is closed, so this is unreachable from a matching Rust
 * build — and that is exactly why it is here rather than a filter. A value that
 * fell through would make an incomplete scan look like one that stopped for no
 * reason, which is the one thing this module exists to prevent.
 */
function describeLimit(limit: string): string {
  return (
    LIMIT_REACHED[limit as FolderScanLimit] ?? "it reached a scan limit this version cannot name"
  );
}

/** `a`, `a and b`, `a, b and c`. */
function listOf(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  const last = values[values.length - 1] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * How a row is named in a detail line.
 *
 * The filename, and the bounded collision context beside it when Rust decided
 * one was needed. Nothing is derived here: the context is used exactly as it
 * arrived, because deciding what to say about a location is Rust's job and this
 * side has no location to decide it from.
 */
function nameOf(dataset: SelectedFile): string {
  return dataset.relativeContext === null
    ? dataset.fileName
    : `${dataset.fileName} (${dataset.relativeContext})`;
}

export function describeFolderResult(result: FolderIngestionResult): WorkspaceNotice {
  const { discovery, outcomes } = result;
  const added = outcomes.filter((outcome) => outcome.outcome === "added").length;
  const duplicates = outcomes.filter((outcome) => outcome.outcome === "duplicate").length;
  const rejected = outcomes.flatMap((outcome) => (outcome.outcome === "rejected" ? [outcome] : []));
  const full = rejected.filter((outcome) => outcome.error.kind === "workspace_full").length;
  const unreadable = rejected.length - full;

  const parts: string[] = [];
  if (added === 0 && !discovery.complete) {
    // The two claims a partial scan must never be allowed to merge. Nothing
    // arrived, and the scan cannot speak for what is in the folder, so it says
    // both and neither on its own.
    parts.push("No files were added, and the scan was incomplete.");
  } else if (outcomes.length === 0) {
    // A complete scan that proposed nothing. This is the one case where the
    // folder's contents can be reported, and it is not a failure: a folder of
    // other people's data is allowed to hold no mzML.
    parts.push("No mzML files were found in that folder.");
  } else {
    parts.push(added === 0 ? "No files were added." : `Added ${plural(added, "file")}.`);
  }
  if (duplicates > 0) {
    parts.push(`${plural(duplicates, "file")} already in the workspace.`);
  }
  if (unreadable > 0) {
    parts.push(`${plural(unreadable, "file")} could not be added.`);
  }
  if (full > 0) {
    parts.push(
      `${plural(full, "file")} did not fit: the workspace already holds as many as MSCanvas keeps.`,
    );
  }
  if (added > 0 && !discovery.complete) {
    parts.push("MSCanvas added what it found, but the scan did not describe the whole folder.");
  }
  if (discovery.skippedReparseCount > 0) {
    // "linked or special", not "links". A reparse tag is what these entries
    // have in common; junctions, symbolic links, mount points and cloud
    // placeholders are only some of what carries one, and MSCanvas refuses all
    // of them without asking which it was looking at.
    const count = discovery.skippedReparseCount;
    parts.push(
      `MSCanvas skipped ${String(count)} linked or special filesystem ${
        count === 1 ? "entry" : "entries"
      } and did not follow ${count === 1 ? "it" : "them"}.`,
    );
  }
  if (discovery.inaccessibleEntryCount > 0) {
    const count = discovery.inaccessibleEntryCount;
    parts.push(
      `${String(count)} ${count === 1 ? "entry" : "entries"} could not be read, so ${
        count === 1 ? "it was" : "they were"
      } left out.`,
    );
  }
  if (discovery.limitsReached.length > 0) {
    parts.push(
      `The scan stopped short of the whole folder because ${listOf(
        discovery.limitsReached.map(describeLimit),
      )}.`,
    );
  }

  // In the order the scan produced them, which is the order the roster is in.
  // Grouping by kind would put a rejected file before a duplicate that was
  // found first, and there is nothing to gain from an order that disagrees with
  // the list the user is looking at.
  const details = outcomes.flatMap((outcome) => {
    if (outcome.outcome === "duplicate") {
      return [`${nameOf(outcome.existing)} is already in the workspace.`];
    }
    if (outcome.outcome === "rejected") {
      return [`${outcome.candidateName}: ${outcome.error.summary}`];
    }
    return [];
  });

  return {
    // An incomplete scan is a warning even when everything it found arrived:
    // what the user asked for was a folder, and they were given part of one.
    tone: !discovery.complete || duplicates + rejected.length > 0 ? "warning" : "info",
    message: parts.join(" "),
    details: details.slice(0, MAX_NOTICE_DETAILS),
    more: Math.max(0, details.length - MAX_NOTICE_DETAILS),
    sequence: 0,
  };
}
