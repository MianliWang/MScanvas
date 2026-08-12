/**
 * What the user is looking at, derived from what the session holds.
 *
 * A projection and nothing more. Rust's insertion order stays exactly where it
 * is: this module reads `datasets`, never writes it, never reorders it in place
 * and never becomes a second stored roster. Every function here is pure, so
 * searching and sorting cost no command, no process and no trip across the
 * boundary — the whole point of doing it on this side.
 *
 * The one idea that is easy to get wrong: a search must not hide the user's own
 * work. A row they selected, the row whose preview is on screen and a row being
 * read stay visible whether or not they match, and say why they are still there.
 */

import type { SelectedFile } from "./contracts";
import type { RowPresentation } from "./rosterSelection";

/** How the visible roster is ordered. `added` is Rust's order, untouched. */
export type SortMode = "added" | "name-asc" | "name-desc" | "size-asc" | "size-desc";

export const SORT_MODES: readonly SortMode[] = [
  "added",
  "name-asc",
  "name-desc",
  "size-asc",
  "size-desc",
];

/** What each sort mode is called where the user chooses it. */
export const SORT_MODE_LABEL: Record<SortMode, string> = {
  added: "Added order",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  "size-asc": "Size: smallest first",
  "size-desc": "Size: largest first",
};

export function isSortMode(value: string): value is SortMode {
  return (SORT_MODES as readonly string[]).includes(value);
}

/**
 * Why a row the search does not match is on screen anyway.
 *
 * `showing` and `reading` are deliberately not the same as "is the active row".
 * A row keeps that place after a backend change discards what it read, and
 * saying it is being shown when nothing is on screen for it is the exact lie
 * the roster's marker was repaired for. `kept` is that state: still the row an
 * explicit re-read acts on, with nothing to show for it yet.
 */
export type PinReason = "converting" | "queued" | "reading" | "showing" | "selected" | "kept";

/** What each reason says beside the row, in words rather than in colour. */
export const PIN_REASON_LABEL: Record<PinReason, string> = {
  converting: "Converting — outside search",
  queued: "Queued — outside search",
  reading: "Reading — outside search",
  showing: "Showing — outside search",
  selected: "Selected — outside search",
  kept: "Kept for the viewer — outside search",
};

export interface RosterProjectionInput {
  /** Rust's roster, in Rust's order. Read only. */
  readonly datasets: readonly SelectedFile[];
  readonly query: string;
  readonly sort: SortMode;
  readonly selected: ReadonlySet<string>;
  readonly active: string | null;
  readonly rowState: ReadonlyMap<string, RowPresentation>;
  /**
   * The row a conversion is working on, if any.
   *
   * Pinned above every other reason. The row cannot be removed while it is
   * being read, so a search that hid it would hide the one row the user most
   * needs to see -- and the state it is in is the reason they cannot act on it
   * here. The one action they do have is stopping the queue, which is offered
   * where the queue is, not on the row.
   *
   * Conversion is never a search term and never a sort key: this decides
   * whether a row stays visible, not where it sits or whether it matched.
   */
  readonly converting: string | null;
  /**
   * Every other row a live queue holds.
   *
   * Pinned for the same reason the converting one is: the user has committed
   * them to a queue and cannot remove them while it holds them, so a search
   * that hid them would hide rows they cannot act on from here.
   */
  readonly queued: ReadonlySet<string>;
}

export interface RosterProjection {
  /** The rows to render, in the order to render them. */
  readonly datasets: readonly SelectedFile[];
  readonly handles: ReadonlySet<string>;
  /** How many rows the search itself matched. Never counts a pinned row. */
  readonly matchCount: number;
  /** Each pinned row once, with the one true thing to say about it. */
  readonly pinned: ReadonlyMap<string, PinReason>;
  /** Everything the session holds, which is not this projection's to change. */
  readonly total: number;
  /** Whether a query is narrowing anything at all. */
  readonly searching: boolean;
}

/**
 * The form two names are compared in.
 *
 * `NFKC` first, so a name typed in half-width characters finds one stored in
 * full-width; then trimmed, so a stray space either side of a query is not a
 * failed search; then lower-cased. `toLowerCase` rather than the locale-aware
 * form on purpose: the locale one maps Turkish dotted and dotless i differently
 * from every other locale, and which files a search finds must not depend on
 * where the machine thinks it is.
 *
 * The displayed name is never this. It is what Rust said, unchanged.
 */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/**
 * Whether a name is one the query itself finds.
 *
 * An ordinary match, which is the one kind of row that is on screen whatever
 * else is true of it. Asking this is how a caller can tell "a row the user can
 * see" from "a row the projection is keeping for a reason that may end".
 */
export function matchesQuery(fileName: string, query: string): boolean {
  const wanted = normalizeForSearch(query);
  return wanted === "" || normalizeForSearch(fileName).includes(wanted);
}

/**
 * One collator for the life of the module.
 *
 * `numeric` so `sample-2` comes before `sample-10` rather than after it, which
 * is the ordering acquisition names are actually written in. `sensitivity:
 * "base"` so case and accents do not decide the primary order — a roster is not
 * a place where `QC` and `qc` belong at opposite ends. Built on first use
 * because constructing a collator is the expensive part and a session may never
 * sort by name at all.
 */
let nameCollator: Intl.Collator | null = null;

function collator(): Intl.Collator {
  nameCollator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return nameCollator;
}

interface Placed {
  readonly dataset: SelectedFile;
  /** Where Rust holds it. Every comparison falls back to this. */
  readonly index: number;
}

/**
 * The comparison each mode makes, with Rust's order underneath all of them.
 *
 * The fallback is what makes every sort stable and what makes `added` the
 * identity: two names a collator calls equal, and two files of one size, keep
 * the order the session put them in rather than whichever order the engine's
 * sort happened to leave them in.
 */
function compareIn(mode: SortMode): (left: Placed, right: Placed) => number {
  switch (mode) {
    case "added":
      return (left, right) => left.index - right.index;
    case "name-asc":
      return (left, right) =>
        collator().compare(left.dataset.fileName, right.dataset.fileName) ||
        left.index - right.index;
    case "name-desc":
      return (left, right) =>
        collator().compare(right.dataset.fileName, left.dataset.fileName) ||
        left.index - right.index;
    case "size-asc":
      return (left, right) =>
        left.dataset.byteLength - right.dataset.byteLength || left.index - right.index;
    case "size-desc":
      return (left, right) =>
        right.dataset.byteLength - left.dataset.byteLength || left.index - right.index;
  }
}

/**
 * Which of the true things about a pinned row to say.
 *
 * Most specific first. A row can be several of these at once and is listed
 * once, so the order here is the order of what a reader most needs to know:
 * that it is being read, that its preview is the one on screen, that they
 * picked it, and failing all three that the viewer still belongs to it.
 */
function pinReason(
  handle: string,
  input: RosterProjectionInput,
  presentation: RowPresentation,
): PinReason | null {
  // First, because it is the one state the user cannot act on the row out of:
  // it cannot be removed while the conversion is reading it. Stopping the queue
  // is the way out, and it lives beside the queue rather than on the row.
  if (input.converting === handle) {
    return "converting";
  }
  if (input.queued.has(handle)) {
    return "queued";
  }
  if (presentation === "opening") {
    return "reading";
  }
  if (input.active === handle) {
    return presentation === "loaded" ? "showing" : input.selected.has(handle) ? "selected" : "kept";
  }
  return input.selected.has(handle) ? "selected" : null;
}

/**
 * The visible roster, in visible order, with the reason for anything the search
 * did not match.
 *
 * One pass over the datasets, so a filename is normalized once however many
 * questions are asked about it.
 */
export function projectRoster(input: RosterProjectionInput): RosterProjection {
  const query = normalizeForSearch(input.query);
  const searching = query !== "";

  const kept: Placed[] = [];
  const pinned = new Map<string, PinReason>();
  let matchCount = 0;

  input.datasets.forEach((dataset, index) => {
    const matched = !searching || normalizeForSearch(dataset.fileName).includes(query);
    if (matched) {
      matchCount += 1;
      kept.push({ dataset, index });
      return;
    }
    const reason = pinReason(dataset.handle, input, input.rowState.get(dataset.handle) ?? "ready");
    if (reason === null) {
      return;
    }
    // Once, whatever else is also true of it. The count beside the search says
    // how many rows are here for this reason, not how many reasons there are.
    pinned.set(dataset.handle, reason);
    kept.push({ dataset, index });
  });

  // `kept` is this function's own array and `sort` is stable, so the fallback
  // to `index` is belt as well as braces -- but it is what makes `added` mean
  // Rust's order even when the matches arrived out of it.
  kept.sort(compareIn(input.sort));

  const datasets = kept.map((placed) => placed.dataset);
  return {
    datasets,
    handles: new Set(datasets.map((dataset) => dataset.handle)),
    matchCount,
    pinned,
    total: input.datasets.length,
    searching,
  };
}

/**
 * What the search found, said plainly enough to be read aloud.
 *
 * Never claims every visible row is a match: the rows kept for another reason
 * are counted separately and named as such, because a summary that folded them
 * in would be describing a list the user is not looking at.
 */
export function describeProjection(projection: RosterProjection): string {
  const files = projection.total === 1 ? "file" : "files";
  if (!projection.searching) {
    // Not silence. A live region whose text is removed announces nothing --
    // the default `aria-relevant` is `additions text` — so clearing a search
    // would be the one step of a search nobody was told about. Empty only when
    // there is no list to describe, which is when the roster says so itself.
    return projection.total === 0
      ? ""
      : `All ${String(projection.total)} ${files} listed.`;
  }
  const matches = `${String(projection.matchCount)} ${projection.matchCount === 1 ? "match" : "matches"} of ${String(projection.total)} ${files}`;
  if (projection.pinned.size === 0) {
    return `${matches}.`;
  }
  const kept = projection.pinned.size === 1 ? "file" : "files";
  return `${matches}; ${String(projection.pinned.size)} selected or active ${kept} kept visible.`;
}
