import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface RosterWindowItem { readonly key: string; readonly estimate: number }
/** Height-aware windowing of presentation IDs. The focused/drag source stays mounted; payloads need no nodes. */
export function useRosterWindow<T extends RosterWindowItem>(items: readonly T[], retained: ReadonlySet<string>, dragging: boolean, focusedHandle: string | null) {
  const root = useRef<HTMLDivElement | null>(null);
  const sizes = useRef(new Map<string, number>());
  const nodes = useRef(new Map<Element, string>());
  const observer = useRef<ResizeObserver | null>(null);
  const frame = useRef<number | null>(null);
  const [version, setVersion] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const revealFocus = useRef<string | null>(null);
  useLayoutEffect(() => { revealFocus.current = focusedHandle; }, [focusedHandle]);
  const refresh = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setVersion(value => value + 1);
      const element = root.current;
      if (element !== null) setViewport({ top: element.scrollTop, height: element.clientHeight || 600 });
    });
  }, []);
  const measure = useCallback((element: HTMLElement | null, key: string) => {
    for (const [node, id] of nodes.current) if (id === key && node !== element) {
      observer.current?.unobserve(node); nodes.current.delete(node);
    }
    if (element !== null) {
      nodes.current.set(element, key);
      observer.current?.observe(element);
      const height = element.getBoundingClientRect().height;
      if (height > 0 && sizes.current.get(key) !== height) { sizes.current.set(key, height); refresh(); }
    }
  }, [refresh]);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const instance = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const key = nodes.current.get(entry.target);
        if (key !== undefined) {
          const height = entry.target.getBoundingClientRect().height;
          if (height > 0 && sizes.current.get(key) !== height) { sizes.current.set(key, height); changed = true; }
        } else changed = true;
      }
      if (changed) refresh();
    });
    observer.current = instance;
    for (const node of nodes.current.keys()) instance.observe(node);
    if (root.current !== null) instance.observe(root.current);
    const element = root.current;
    // Deliberate pointer/wheel scrolling supersedes a pending keyboard reveal.
    const userScroll = () => { revealFocus.current = null; };
    element?.addEventListener("wheel", userScroll, { passive: true });
    element?.addEventListener("pointerdown", userScroll, { passive: true });
    element?.addEventListener("touchstart", userScroll, { passive: true });
    refresh();
    return () => {
      element?.removeEventListener("wheel", userScroll); element?.removeEventListener("pointerdown", userScroll); element?.removeEventListener("touchstart", userScroll);
      instance.disconnect(); observer.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    };
  }, [refresh]);
  const layout = useMemo(() => {
    let top = 0;
    return items.map(item => { const height = sizes.current.get(item.key) ?? item.estimate; const placed = { item, top, height }; top += height; return placed; });
  }, [items, version]);
  const total = layout.length ? layout.at(-1)!.top + layout.at(-1)!.height : 0;
  const windowed = items.length > 80;
  const rendered = layout.filter(({ item, top, height }) => !windowed || retained.has(item.key) || (top + height >= viewport.top - 320 && top <= viewport.top + viewport.height + 320));
  useLayoutEffect(() => {
    // A newly mounted focused row can grow beyond its estimated height. Reveal
    // that existing focus after measurement, without requesting focus or
    // competing with dnd-kit's active auto-scroll owner.
    const element = root.current;
    const focused = document.activeElement?.closest<HTMLElement>("[data-handle]");
    if (dragging || element === null || focused === undefined || focused === null || revealFocus.current !== focused.dataset.handle || !element.contains(focused)) return;
    const bounds = element.getBoundingClientRect(), row = focused.getBoundingClientRect();
    const delta = row.bottom > bounds.bottom ? row.bottom - bounds.bottom : row.top < bounds.top ? row.top - bounds.top : 0;
    if (Math.abs(delta) > 1) { element.scrollTop += delta; refresh(); }
  }, [version, items, dragging, refresh]);
  const liveKeys = useRef<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    const keys = new Set(items.map(item => item.key));
    for (const key of liveKeys.current) if (!keys.has(key)) sizes.current.delete(key);
    liveKeys.current = keys;
  }, [items]);
  return { root, measure, onScroll: refresh, rendered, total, windowed };
}
