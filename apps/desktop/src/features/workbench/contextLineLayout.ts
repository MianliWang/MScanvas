/**
 * How the header's second line fits its width (PM9 L14–L16).
 *
 * The line holds an operation's status, the object on screen, the project, the
 * conversion scope and, last, the drop hint. When it is short of room they give
 * way in a fixed order: the hint first and whole, then each context item by
 * rank, lowest first, down to its floor. An operation's status never gives way.
 *
 * This used to be flex-shrink factors 1e8 apart, which worked only because
 * Blink rounds a sub-pixel shrink share to nothing. Here the order is stated
 * and computed, so it holds on any engine and a test can read it.
 */

export interface LineEntry {
  /** The width it takes unconstrained, border box, in CSS px. */
  readonly natural: number;
  /**
   * The narrowest it may become while it stays. An entry that is `removable`
   * leaves the line whole rather than showing less than this; any other entry
   * keeps at least this width.
   */
  readonly floor: number;
  /** 1 never gives way; a higher rank gives way before a lower one. */
  readonly rank: number;
  /** The space before it, counted while it and an entry before it are shown. */
  readonly gap: number;
  /** Whether it may leave the line entirely (the drop hint). */
  readonly removable?: boolean;
}

/**
 * The width each entry gets, in input order; `null` for an entry that leaves
 * the line, which takes its gap with it. `available` is the line's width.
 */
export function allocateLine(entries: readonly LineEntry[], available: number): (number | null)[] {
  const widths: (number | null)[] = entries.map((entry) => entry.natural);
  const used = () => {
    let total = 0;
    let first = true;
    widths.forEach((width, index) => {
      if (width === null) return;
      total += width + (first ? 0 : entries[index]!.gap);
      first = false;
    });
    return total;
  };
  const order = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.rank > 1)
    .sort((left, right) => right.entry.rank - left.entry.rank);
  for (const { entry, index } of order) {
    const excess = used() - available;
    if (excess <= 0) break;
    const room = entry.natural - entry.floor;
    if (entry.removable === true) {
      // Whole, down to its floor, or gone: never a sliver of a first glyph.
      widths[index] = excess <= room ? entry.natural - excess : null;
    } else {
      widths[index] = entry.natural - Math.min(excess, Math.max(0, room));
    }
  }
  return widths;
}

/**
 * Fits the rendered line: every `[data-line-rank]` inside `bar`, in document
 * order. Each is measured at its natural width, then given its allocated width,
 * or `hidden` when it leaves. The floor is the entry's CSS `min-width`; the gap
 * before an entry is its container's `column-gap` -- the group's between two
 * context items, the bar's otherwise.
 */
export function fitContextLine(bar: HTMLElement): void {
  const nodes = [...bar.querySelectorAll<HTMLElement>("[data-line-rank]")];
  for (const node of nodes) {
    node.style.width = "";
    node.hidden = false;
  }
  const entries = nodes.map((node, index): LineEntry => {
    const natural = node.getBoundingClientRect().width;
    const rank = Number(node.dataset["lineRank"]);
    const removable = node.dataset["lineRemovable"] !== undefined;
    const container = index > 0 && nodes[index - 1]!.parentElement === node.parentElement ? node.parentElement! : bar;
    return {
      natural,
      floor: removable || rank === 1 ? natural : Math.min(natural, parseFloat(getComputedStyle(node).minWidth) || 0),
      rank,
      gap: parseFloat(getComputedStyle(container).columnGap) || 0,
      removable,
    };
  });
  allocateLine(entries, bar.getBoundingClientRect().width).forEach((width, index) => {
    const node = nodes[index]!;
    if (width === null) node.hidden = true;
    else if (width < entries[index]!.natural) node.style.width = `${String(width)}px`;
  });
}
