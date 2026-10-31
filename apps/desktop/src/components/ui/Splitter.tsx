import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { cx } from "./shared";

export interface SplitterProps {
  /** The separator's accessible name, e.g. "Resize roster". */
  readonly label: string;
  /** `horizontal`: panes side by side (a vertical bar). `vertical`: panes stacked. */
  readonly orientation?: "horizontal" | "vertical";
  /** The pane whose size (px) the splitter holds; the other takes the rest. */
  readonly sizedPane?: "first" | "second";
  /** Initial size of the sized pane, px. Later changes are ignored: the size is this component's state. */
  readonly defaultSize: number;
  readonly minFirst?: number;
  readonly minSecond?: number;
  /** Arrow-key step, px. */
  readonly step?: number;
  /** Called with the sized pane's new size after a pointer or keyboard resize. */
  readonly onChange?: (size: number) => void;
  readonly first: ReactNode;
  readonly second: ReactNode;
  readonly className?: string;
}

/**
 * Two panes and a focusable `role="separator"` between them. Drag it, or use
 * the arrow keys along its axis and Home/End for the limits. `aria-valuenow`
 * is the sized pane's size in px; it never leaves `aria-valuemin`..`aria-valuemax`.
 */
export function Splitter({
  label, orientation = "horizontal", sizedPane = "first", defaultSize, minFirst = 0, minSecond = 0,
  step = 16, onChange, first, second, className,
}: SplitterProps) {
  const horizontal = orientation === "horizontal";
  const sizedFirst = sizedPane === "first";
  const rootRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ readonly origin: number; readonly size: number } | null>(null);
  const [size, setSize] = useState(defaultSize);
  const [available, setAvailable] = useState(0);
  const [dragging, setDragging] = useState(false);
  const paneIds = [useId(), useId()];

  useLayoutEffect(() => {
    const root = rootRef.current;
    const separator = separatorRef.current;
    if (!root || !separator) return;
    const measure = () => setAvailable(horizontal
      ? root.clientWidth - separator.offsetWidth
      : root.clientHeight - separator.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [horizontal]);

  const minSize = sizedFirst ? minFirst : minSecond;
  // Unmeasured (no layout yet): no upper bound to hold the size to.
  const maxSize = available > 0 ? Math.max(minSize, available - (sizedFirst ? minSecond : minFirst)) : Infinity;
  const clamp = (value: number) => Math.round(Math.min(maxSize, Math.max(minSize, value)));
  const current = clamp(size);

  const resize = (value: number) => {
    const next = clamp(value);
    if (next === current) return;
    setSize(next);
    onChange?.(next);
  };
  // A move of the bar towards the end edge grows the first pane and shrinks the second.
  const moveBy = (delta: number) => resize(current + (sizedFirst ? delta : -delta));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const [back, forward] = horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (event.key === back) moveBy(-step);
    else if (event.key === forward) moveBy(step);
    else if (event.key === "Home") resize(minSize);
    else if (event.key === "End" && Number.isFinite(maxSize)) resize(maxSize);
    else return;
    event.preventDefault();
  };

  const coordinate = (event: PointerEvent) => horizontal ? event.clientX : event.clientY;
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { origin: coordinate(event), size: current };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const delta = coordinate(event) - drag.current.origin;
    resize(drag.current.size + (sizedFirst ? delta : -delta));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const paneStyle = (sized: boolean, min: number) => ({
    flex: sized ? `0 0 ${current}px` : "1 1 0",
    ...(horizontal ? { minWidth: min } : { minHeight: min }),
  });

  return <div ref={rootRef} className={cx("ui-splitter", className)} data-orientation={orientation}
    data-dragging={dragging || undefined}>
    <div id={paneIds[0]} className="ui-splitter__pane" style={paneStyle(sizedFirst, minFirst)}>{first}</div>
    <div ref={separatorRef} role="separator" tabIndex={0} aria-label={label}
      aria-orientation={horizontal ? "vertical" : "horizontal"} aria-controls={paneIds[sizedFirst ? 0 : 1]}
      aria-valuemin={minSize} aria-valuemax={Number.isFinite(maxSize) ? maxSize : current} aria-valuenow={current}
      className="ui-splitter__separator" onKeyDown={onKeyDown} onPointerDown={onPointerDown}
      onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
    <div id={paneIds[1]} className="ui-splitter__pane" style={paneStyle(!sizedFirst, minSecond)}>{second}</div>
  </div>;
}
