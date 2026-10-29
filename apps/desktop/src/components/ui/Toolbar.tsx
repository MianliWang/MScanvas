import { useCallback, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

import { cx, step, type AccessibleName } from "./shared";

const ITEMS = "button, input, select, textarea, [tabindex]";
// A nested composite keeps its own tab stop and its own arrow keys.
const COMPOSITES = "[role=toolbar], [role=radiogroup], [role=tablist]";

function rovingItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEMS)).filter(item =>
    !item.matches(":disabled") && item.closest("[hidden], [inert]") === null &&
    item.parentElement?.closest(COMPOSITES) === root);
}

export type ToolbarProps = AccessibleName & {
  /**
   * With roving focus the group is a `role="toolbar"`: one Tab stop, arrow keys
   * (and Home/End) move between its controls. Without it, a plain
   * `role="group"` (a button group) whose controls are each a Tab stop. Fixed
   * for the component's lifetime.
   */
  readonly roving?: boolean;
  readonly orientation?: "horizontal" | "vertical";
  readonly className?: string;
  readonly children: ReactNode;
};

export function Toolbar({ label, labelledBy, roving = false, orientation = "horizontal", className, children }: ToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  const sync = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = rovingItems(root);
    const active = items.find(item => item === activeRef.current) ?? items[0] ?? null;
    activeRef.current = active;
    for (const item of items) item.tabIndex = item === active ? 0 : -1;
  }, []);

  // Children re-render on their own, so the Tab stop follows the DOM, not this
  // component's renders.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!roving || !root) return;
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "inert"] });
    return () => observer.disconnect();
  }, [roving, sync]);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!roving || !rootRef.current || !rovingItems(rootRef.current).includes(event.target)) return;
    activeRef.current = event.target;
    sync();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const target = event.target as HTMLElement;
    if (!roving || !root || event.defaultPrevented || target.matches("input, select, textarea")) return;
    const items = rovingItems(root);
    const index = items.indexOf(target);
    if (index < 0) return;
    const [back, forward] = orientation === "vertical" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    const to = event.key === back ? step(index, -1, items.length)
      : event.key === forward ? step(index, 1, items.length)
        : event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
            : -1;
    if (to < 0) return;
    event.preventDefault();
    items[to].focus();
  };

  return <div ref={rootRef} role={roving ? "toolbar" : "group"} aria-label={label} aria-labelledby={labelledBy}
    aria-orientation={roving ? orientation : undefined} className={cx("ui-toolbar", className)}
    data-orientation={orientation} onFocus={onFocus} onKeyDown={onKeyDown}>
    {children}
  </div>;
}
