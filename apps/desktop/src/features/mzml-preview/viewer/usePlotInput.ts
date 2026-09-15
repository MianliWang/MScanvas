import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { isViewportKeyboardModifierOwnedByHost, isViewportWheelModifierOwnedByHost } from "./hostInputOwnership";
import type { PlotInputPort, PlotInputSnapshot } from "./plotInputAdapters";
import { sameRange, sameTransaction, usableRange, type RangeSelection, type RangeTransaction } from "./rangeSelection";
import { normalizeWheelDelta } from "./wheelInput";

const SLOP = 4;
const SETTLE_MS = 120;
type Domain = { readonly low: number; readonly high: number };
export interface PlotGeometry { readonly width: number; readonly left: number; readonly drawnWidth: number }

/** Source coordinates stay in the axis reducer; only pointer/capture bookkeeping lives here. */
export function usePlotInput<A extends "rt" | "mz", D extends Domain>({ port, geometry, onInspect, onHover, onLeave, paintFrame }: {
  readonly port: PlotInputPort<A, D>;
  readonly geometry: PlotGeometry;
  readonly onInspect?: (coordinate: number) => void;
  readonly onHover?: (coordinate: number) => void;
  readonly onLeave?: () => void;
  readonly paintFrame?: () => void;
}) {
  const latest = useRef({ port, geometry, onInspect, onHover, onLeave, paintFrame });
  latest.current = { port, geometry, onInspect, onHover, onLeave, paintFrame };
  const plot = useRef<SVGSVGElement | null>(null);
  const detach = useRef<() => void>(() => undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const space = useRef(false);
  type Snapshot = PlotInputSnapshot<A, D>;
  type Press = { pointerId: number; x: number; y: number; box: DOMRect; start: Snapshot; instruction: number;
    mode: "range" | "pan"; moved: boolean; transaction: RangeTransaction<A, D> | null; panEpoch: number | null;
    pending: RangeSelection<A, D> | null; touch: boolean };
  const press = useRef<Press | null>(null);
  const activation = useRef<{ start: Snapshot; pending: RangeSelection<A, D> | null; coordinate: number } | null>(null);
  const blockDouble = useRef(false);

  const usable = useCallback(() => {
    const node = plot.current;
    const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
    return node !== null && node.isConnected && node.closest("[hidden], [inert]") === null &&
      document.visibilityState !== "hidden" && (modal === null || modal.contains(node));
  }, []);
  const cancelTimer = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const abandon = useCallback(() => {
    const active = press.current;
    press.current = null; activation.current = null; space.current = false; cancelTimer();
    latest.current.port.abandon();
    if (active !== null && plot.current?.hasPointerCapture?.(active.pointerId)) plot.current.releasePointerCapture(active.pointerId);
    latest.current.onLeave?.(); latest.current.paintFrame?.();
  }, [cancelTimer]);
  const sameContext = (snapshot: Snapshot, instruction = snapshot.instruction): boolean => {
    const now = latest.current.port.current();
    return now !== null && now.source === snapshot.source && now.revision === snapshot.revision &&
      now.instruction === instruction && sameRange(now.committed, snapshot.committed);
  };
  const sameGeometry = (before: DOMRect): boolean => {
    const now = plot.current?.getBoundingClientRect();
    return now !== undefined && now.width === before.width && now.height === before.height &&
      now.left === before.left && now.top === before.top;
  };
  const fraction = (x: number, box: DOMRect): number => {
    const g = latest.current.geometry;
    return Math.min(1, Math.max(0, ((x - box.left) / box.width * g.width - g.left) / g.drawnWidth));
  };
  const coordinate = (x: number, box: DOMRect, domain: D): number => domain.low + fraction(x, box) * (domain.high - domain.low);
  const paintBand = useCallback(() => {
    const node = plot.current;
    const band = node?.querySelector<SVGRectElement>(".plot-range-band");
    const snapshot = latest.current.port.current();
    if (band === null || band === undefined) return;
    if (snapshot?.range === null || snapshot === null || !usableRange(snapshot.shown)) { band.setAttribute("visibility", "hidden"); return; }
    const { left, drawnWidth } = latest.current.geometry;
    const span = snapshot.shown.high - snapshot.shown.low;
    band.setAttribute("x", String(left + (snapshot.range.domain.low - snapshot.shown.low) / span * drawnWidth));
    band.setAttribute("width", String((snapshot.range.domain.high - snapshot.range.domain.low) / span * drawnWidth));
    band.setAttribute("visibility", "visible");
  }, []);
  useLayoutEffect(paintBand);

  const handlers = useRef<Record<string, EventListener>>({});
  handlers.current = {
    pointerdown: raw => {
      const event = raw as PointerEvent;
      if (!usable() || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (press.current !== null) {
        if (event.pointerType === "touch") {
          const pending = latest.current.port.current()?.range;
          if (pending) latest.current.port.cancel(pending.transaction);
          abandon(); paintBand(); blockDouble.current = true;
        }
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;
      if (event.isPrimary === false) return;
      const box = plot.current!.getBoundingClientRect();
      if (!(box.width > 0) || !(box.height > 0)) return;
      cancelTimer(); latest.current.port.abandon();
      const start = latest.current.port.current();
      if (start === null) return;
      activation.current = null;
      press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, box, start,
        instruction: start.instruction, mode: event.button === 1 || space.current ? "pan" : "range",
        moved: false, transaction: null, panEpoch: null, pending: start.range, touch: event.pointerType === "touch" };
      plot.current!.focus({ preventScroll: true });
      plot.current!.setPointerCapture?.(event.pointerId);
      // Avoid middle-button autoscroll only where a horizontal pan can be productive.
      if (event.button === 1 && !sameRange(start.shown, start.full)) event.preventDefault();
    },
    pointermove: raw => {
      const event = raw as PointerEvent;
      if (!usable()) { abandon(); return; }
      const active = press.current;
      if (active === null) {
        const snapshot = latest.current.port.current(); const box = plot.current!.getBoundingClientRect();
        if (snapshot && box.width > 0) latest.current.onHover?.(coordinate(event.clientX, box, snapshot.shown));
        return;
      }
      if (active.pointerId !== event.pointerId) return;
      const box = plot.current!.getBoundingClientRect();
      if (!sameContext(active.start, active.instruction) || box.width !== active.box.width || box.height !== active.box.height ||
        box.left !== active.box.left || box.top !== active.box.top) { abandon(); return; }
      const dx = event.clientX - active.x; const dy = event.clientY - active.y;
      if (active.touch && Math.abs(dy) >= SLOP && Math.abs(dy) > Math.abs(dx)) { abandon(); paintBand(); blockDouble.current = true; return; }
      if (!active.moved && Math.abs(dx) < SLOP) return;
      active.moved = true; blockDouble.current = true;
      const p = latest.current.port;
      if (active.mode === "pan") {
        const width = box.width * latest.current.geometry.drawnWidth / latest.current.geometry.width;
        if (p.pan(active.start.shown, -dx / width, active.panEpoch)) {
          active.panEpoch = p.current()?.gesture ?? null; active.instruction = p.current()?.instruction ?? active.instruction;
          event.preventDefault(); latest.current.paintFrame?.();
        }
      } else {
        const from = coordinate(active.x, box, active.start.shown); const to = coordinate(event.clientX, box, active.start.shown);
        const domain = p.domain(Math.min(from, to), Math.max(from, to));
        if (active.transaction === null) {
          p.start(domain); active.transaction = p.current()?.range?.transaction ?? null;
          active.instruction = p.current()?.instruction ?? active.instruction;
        } else p.move(active.transaction, domain);
        if (active.transaction !== null) event.preventDefault();
        paintBand();
      }
    },
    pointerup: raw => {
      const event = raw as PointerEvent; const active = press.current;
      if (active === null || active.pointerId !== event.pointerId) return;
      press.current = null;
      if (plot.current?.hasPointerCapture?.(event.pointerId)) plot.current.releasePointerCapture(event.pointerId);
      if (!usable() || !sameGeometry(active.box) || !sameContext(active.start, active.instruction)) {
        activation.current = null; latest.current.port.abandon(); paintBand(); latest.current.paintFrame?.(); return;
      }
      if (active.moved) {
        if (active.transaction !== null) latest.current.port.release(active.transaction);
        if (active.panEpoch !== null) latest.current.port.settle(active.panEpoch);
        activation.current = null; blockDouble.current = true; paintBand(); return;
      }
      if (active.mode === "range" && Math.hypot(event.clientX - active.x, event.clientY - active.y) < SLOP) {
        activation.current = { start: active.start, pending: active.pending,
          coordinate: coordinate(event.clientX, active.box, active.start.shown) };
      }
    },
    click: raw => {
      const event = raw as MouseEvent; const action = activation.current; activation.current = null;
      if (event.detail > 1 || action === null || !usable() || !sameContext(action.start)) return;
      const p = latest.current.port; const current = p.current();
      const pending = action.pending;
      if (pending?.phase === "pending") {
        blockDouble.current = true;
        if (current?.range?.phase !== "pending" || !sameTransaction(pending.transaction, current.range.transaction)) return;
        if (action.coordinate >= pending.domain.low && action.coordinate <= pending.domain.high) p.confirm(pending);
        else { p.cancel(pending.transaction); latest.current.onInspect?.(action.coordinate); }
      } else { blockDouble.current = false; latest.current.onInspect?.(action.coordinate); }
      paintBand();
    },
    dblclick: raw => {
      const event = raw as MouseEvent;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (usable() && !blockDouble.current && latest.current.port.current()?.range === null) latest.current.port.step("reset");
      blockDouble.current = false;
    },
    pointercancel: raw => { if (press.current?.pointerId === (raw as PointerEvent).pointerId) { abandon(); paintBand(); blockDouble.current = true; } },
    lostpointercapture: raw => { if (press.current?.pointerId === (raw as PointerEvent).pointerId) { abandon(); paintBand(); } },
    pointerleave: () => { latest.current.onLeave?.(); },
    blur: () => { abandon(); paintBand(); },
    keyup: raw => { if ((raw as KeyboardEvent).key === " ") space.current = false; },
    keydown: raw => {
      const event = raw as KeyboardEvent;
      if (!usable() || document.activeElement !== plot.current || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        isViewportKeyboardModifierOwnedByHost(event)) return;
      const p = latest.current.port; const snapshot = p.current();
      if (snapshot === null) return;
      if (event.key === "Escape") {
        if (press.current !== null || snapshot.gesture !== null || snapshot.range !== null) {
          if (snapshot.range !== null) p.cancel(snapshot.range.transaction);
          abandon(); paintBand(); event.preventDefault();
        }
        return;
      }
      if (event.key === "Enter") {
        if (!event.repeat && snapshot.range?.phase === "pending") { p.confirm(snapshot.range); paintBand(); event.preventDefault(); }
        return;
      }
      if (event.key === " ") { space.current = true; if (!sameRange(snapshot.shown, snapshot.full)) event.preventDefault(); return; }
      const keys: Partial<Record<string, "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "reset">> = {
        "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", "_": "zoom-out",
        ArrowLeft: "pan-left", ArrowRight: "pan-right", Home: "reset", "0": "reset",
      };
      const action = keys[event.key];
      if (action !== undefined && p.step(action)) { event.preventDefault(); paintBand(); }
    },
    wheel: raw => {
      const event = raw as WheelEvent;
      if (!usable() || event.defaultPrevented || isViewportWheelModifierOwnedByHost(event) || event.altKey || event.metaKey || press.current !== null) return;
      const normalized = normalizeWheelDelta(event); const p = latest.current.port; const snapshot = p.current();
      if (normalized === null || !Number.isFinite(normalized) || snapshot === null) return;
      const box = plot.current!.getBoundingClientRect(); if (!(box.width > 0)) return;
      const changed = event.shiftKey ? p.pan(snapshot.shown, normalized, snapshot.gesture) : p.wheel(event, fraction(event.clientX, box));
      if (!changed) return;
      event.preventDefault(); cancelTimer();
      const epoch = p.current()?.gesture;
      if (epoch !== null && epoch !== undefined) timer.current = setTimeout(() => { timer.current = null; p.settle(epoch); }, SETTLE_MS);
      latest.current.paintFrame?.(); paintBand();
    },
  };

  const attachPlot = useCallback((node: SVGSVGElement | null) => {
    if (plot.current === node) return;
    detach.current(); if (plot.current !== null) abandon(); plot.current = node;
    if (node === null) return;
    const listeners = Object.keys(handlers.current).map(name => {
      const listener: EventListener = event => handlers.current[name]?.(event);
      node.addEventListener(name, listener, { passive: false }); return { name, listener };
    });
    detach.current = () => { for (const { name, listener } of listeners) node.removeEventListener(name, listener); };
  }, [abandon]);
  useEffect(() => {
    const lost = () => { abandon(); paintBand(); };
    const visibility = () => { if (document.visibilityState === "hidden") lost(); };
    window.addEventListener("blur", lost); window.addEventListener("resize", lost);
    document.addEventListener("visibilitychange", visibility);
    return () => { detach.current(); abandon(); window.removeEventListener("blur", lost);
      window.removeEventListener("resize", lost); document.removeEventListener("visibilitychange", visibility); };
  }, [abandon, paintBand]);
  return { attachPlot, paintBand };
}
