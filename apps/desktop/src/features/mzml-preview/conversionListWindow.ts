import { createElement, useCallback, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from "react";

import { useRosterWindow } from "../workbench/useRosterWindow";

/**
 * Past this many rows a conversion list renders a window of them. The queue
 * holds up to 1,024 items (ADR 0057), and every list of them -- the plan, the
 * requested order, the running queue and its results -- has to stay usable
 * at that size.
 */
export const LIST_WINDOW_THRESHOLD = 50;

/** One mounted row of a windowed list: spread its `ref`, `style` and key onto the row. */
export interface ListWindowRow {
  readonly key: string;
  readonly index: number;
  readonly style: CSSProperties | undefined;
  readonly ref: (node: HTMLElement | null) => void;
}

/**
 * The roster's height-aware window over one conversion list, keyed by row.
 *
 * Short lists render whole, with no scroll box of their own; a windowed list
 * is its own scroll box (`data-windowed`), because the window is measured
 * against its root's scroll. The row that holds the keyboard stays mounted,
 * so a wheel scroll never takes focus out from under a Skip or an Open.
 *
 * Rows are placed by a top margin over any gap, and `spacer` -- one hidden
 * `li`, rendered after the rows -- holds the rest. Not the list's bottom
 * padding: in a border-box scroll box, padding taller than `max-height` is the
 * box's height, so the list grew to tens of thousands of pixels, stopped being
 * a scroll box and mounted every row (rendered QA: 31,843 px under a 548 px cap).
 */
export function useListWindow(keys: readonly string[], estimate: number) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const items = useMemo(() => keys.map((key) => ({ key, estimate })), [keys, estimate]);
  const retained = useMemo(() => new Set(focusedKey === null ? [] : [focusedKey]), [focusedKey]);
  const windowing = useRosterWindow(items, retained, false, null, LIST_WINDOW_THRESHOLD);
  const refs = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const rowRef = useCallback((key: string) => {
    let ref = refs.current.get(key);
    if (ref === undefined) {
      ref = (node: HTMLElement | null) => { windowing.measure(node, key); };
      refs.current.set(key, ref);
    }
    return ref;
  }, [windowing.measure]);
  const index = useMemo(() => new Map(keys.map((key, position) => [key, position])), [keys]);
  let bottom = 0;
  const rows = windowing.rendered.map(({ item, top, height }): ListWindowRow => {
    const gap = top - bottom;
    bottom = top + height;
    const style: CSSProperties | undefined = gap > 0 ? { marginTop: gap } : undefined;
    return { key: item.key, index: index.get(item.key) ?? 0, style, ref: rowRef(item.key) };
  });
  const rest = windowing.total - bottom;
  const { root } = windowing;
  const rootRef = useCallback((node: HTMLElement | null) => { root.current = node; }, [root]);
  const listProps = {
    ref: rootRef,
    onScroll: windowing.onScroll,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-window-key]") : null;
      if (row !== null) setFocusedKey(row.dataset.windowKey ?? null);
    },
    "data-windowed": windowing.windowed,
  };
  /** Render after the rows, inside the list. */
  const spacer = rest > 0
    ? createElement("li", { "aria-hidden": true, className: "list-window-spacer", style: { height: rest } })
    : null;
  return { listProps, rows, spacer, windowed: windowing.windowed, root, offsetOf: windowing.offsetOf };
}
