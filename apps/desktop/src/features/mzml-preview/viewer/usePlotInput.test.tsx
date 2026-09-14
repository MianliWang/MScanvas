import { useLayoutEffect } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithPreferences as render } from "../../../test/renderWithPreferences";
import { PlotRangeActions } from "../PlotRangeActions";
import { mzInput, retentionTimeInput, type PlotInputPort, type PlotInputSnapshot } from "./plotInputAdapters";
import { usePlotInput } from "./usePlotInput";
import { useViewerInteraction } from "./useViewerInteraction";
import { useSpectrumViewport } from "./useSpectrumViewport";

type Domain = { readonly low: number; readonly high: number };
type Control = { readonly current: () => PlotInputSnapshot<"rt" | "mz", Domain> | null; readonly replace: () => void };
let control: Control;
let publications = 0;
const inspect = vi.fn();
function Surface<A extends "rt" | "mz", D extends Domain>({ port }: { readonly port: PlotInputPort<A, D> }) {
  publications += 1;
  const { attachPlot } = usePlotInput({ port, geometry: { width: 1000, left: 0, drawnWidth: 1000 }, onInspect: inspect });
  return <div><svg role="img" aria-label="Scientific plot" tabIndex={0} ref={attachPlot}>
    <rect className="plot-range-band" visibility="hidden" /></svg><PlotRangeActions port={port} /></div>;
}
function Harness({ axis }: { readonly axis: "rt" | "mz" }) {
  const rt = useViewerInteraction(); const mz = useSpectrumViewport();
  useLayoutEffect(() => {
    rt.dispatch({ type: "preview-loaded", fullDomain: { low: 0, high: 100 } });
    mz.dispatch({ type: "spectrum-selected", spectrumToken: "original", domain: { state: "admitted", low: 0, high: 100 } });
  }, [rt.dispatch, mz.dispatch]);
  const rp = retentionTimeInput(rt.current, rt.dispatch); const mp = mzInput(mz.current, mz.dispatch);
  control = { current: axis === "rt" ? rp.current : mp.current,
    replace: () => { if (axis === "rt") rt.dispatch({ type: "selection-committed", index: 7, retentionTime: 50 });
      else mz.dispatch({ type: "selection-changed", revision: mz.current().selectionRevision + 1 }); } };
  return <><button type="button">Outside</button>{axis === "rt" ? <Surface port={rp} /> : <Surface port={mp} />}</>;
}
function setup(axis: "rt" | "mz") {
  render(<Harness axis={axis} />);
  const plot = screen.getByRole("img");
  const rect = { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, toJSON: () => ({}) };
  const box = vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(rect);
  const held = new Set<number>();
  Object.assign(plot, {
    setPointerCapture: (id: number) => held.add(id), hasPointerCapture: (id: number) => held.has(id),
    releasePointerCapture: (id: number) => { held.delete(id); fireEvent.lostPointerCapture(plot, { pointerId: id }); },
  });
  return { plot, box, rect };
}
const pointer = (plot: HTMLElement, kind: "pointerDown" | "pointerMove" | "pointerUp", x: number, extra: object = {}) =>
  fireEvent[kind](plot, { button: 0, pointerId: 1, clientX: x, clientY: 50, pointerType: "mouse", isPrimary: true, ...extra });
function draw(plot: HTMLElement, extra: object = {}) {
  pointer(plot, "pointerDown", 200, extra); pointer(plot, "pointerMove", 600, extra); pointer(plot, "pointerUp", 600, extra);
  fireEvent.click(plot, { clientX: 600, clientY: 50, detail: 1 });
}
function click(plot: HTMLElement, x: number, detail = 1) {
  pointer(plot, "pointerDown", x); pointer(plot, "pointerUp", x);
  fireEvent.click(plot, { clientX: x, clientY: 50, detail });
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); inspect.mockClear(); publications = 0; });

describe.each(["rt", "mz"] as const)("%s plot event ordering", axis => {
  it("leaves modified or already-owned double activation to the host, with an ordinary reset as positive control", () => {
    const { plot } = setup(axis); plot.focus();
    fireEvent.keyDown(plot, { key: "+" }); click(plot, 400);
    const committed = control.current()?.committed;
    expect(committed).not.toBeNull();
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      pointer(plot, "pointerDown", 400, modifiers); pointer(plot, "pointerUp", 400, modifiers);
      fireEvent.doubleClick(plot, modifiers);
      expect(control.current()?.committed).toEqual(committed);
    }
    const owned = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    owned.preventDefault(); fireEvent(plot, owned);
    expect(control.current()?.committed).toEqual(committed);
    click(plot, 400); fireEvent.doubleClick(plot);
    expect(control.current()?.committed).toBeNull();
  });

  it("release and compatibility click leave a band; a fresh inside click confirms once without inspection", () => {
    const { plot } = setup(axis);
    draw(plot);
    expect(control.current()?.committed).toBeNull();
    expect(control.current()?.range?.phase).toBe("pending");
    expect(control.current()?.range?.domain).toEqual({ low: 20, high: 60 });
    expect(plot.querySelector(".plot-range-band")).toHaveAttribute("visibility", "visible");
    expect(inspect).not.toHaveBeenCalled();
    click(plot, 400);
    expect(control.current()?.committed).toEqual({ low: 20, high: 60 });
    const instruction = control.current()?.instruction;
    fireEvent.click(plot, { detail: 1 }); fireEvent.keyDown(plot, { key: "Enter" });
    expect(control.current()?.instruction).toBe(instruction);
    expect(inspect).not.toHaveBeenCalled();
    // The second activation and dblclick from this same sequence cannot reset a just-confirmed band.
    click(plot, 400, 2); fireEvent.doubleClick(plot);
    expect(control.current()?.committed).toEqual({ low: 20, high: 60 });
  });

  it("outside click cancels and inspects once; tiny jitter remains an ordinary click", () => {
    const { plot } = setup(axis); draw(plot); click(plot, 800);
    expect(control.current()?.range).toBeNull(); expect(control.current()?.committed).toBeNull();
    expect(inspect).toHaveBeenCalledExactlyOnceWith(80);
    pointer(plot, "pointerDown", 200); pointer(plot, "pointerMove", 202); pointer(plot, "pointerUp", 202);
    fireEvent.click(plot, { detail: 1 });
    expect(inspect).toHaveBeenCalledTimes(2); expect(inspect).toHaveBeenLastCalledWith(20.200000000000003);
  });

  it("a replacement drag replaces pending work without confirming it", () => {
    const { plot } = setup(axis); draw(plot);
    const first = control.current()?.range?.transaction;
    pointer(plot, "pointerDown", 700); pointer(plot, "pointerMove", 900); pointer(plot, "pointerUp", 900);
    fireEvent.click(plot, { detail: 1 });
    expect(control.current()?.range?.domain).toEqual({ low: 70, high: 90 });
    expect(control.current()?.range?.transaction).not.toEqual(first);
    expect(control.current()?.committed).toBeNull(); expect(inspect).not.toHaveBeenCalled();
  });

  it("Enter or the contextual action commits once, with focus retained; Escape cancels", () => {
    const { plot } = setup(axis); draw(plot);
    fireEvent.keyDown(plot, { key: "Enter", repeat: true }); expect(control.current()?.committed).toBeNull();
    fireEvent.keyDown(plot, { key: "Enter" }); expect(control.current()?.committed).toEqual({ low: 20, high: 60 });
    fireEvent.keyDown(plot, { key: "Home" }); draw(plot);
    const confirm = screen.getByRole("button", { name: /Zoom to selection/u }); confirm.focus(); fireEvent.click(confirm);
    expect(control.current()?.committed).toEqual({ low: 20, high: 60 }); expect(document.activeElement).toBe(plot);
    fireEvent.keyDown(plot, { key: "Home" }); draw(plot); fireEvent.keyDown(plot, { key: "Escape" });
    expect(control.current()?.range).toBeNull(); expect(control.current()?.committed).toBeNull();
  });

  it("cancels active input on geometry changes, lost capture, pointercancel, blur and newer selection", () => {
    const { plot, box, rect } = setup(axis);
    for (const interruption of ["geometry", "capture", "cancel", "blur", "selection"]) {
      pointer(plot, "pointerDown", 200); pointer(plot, "pointerMove", 600);
      expect(control.current()?.range?.phase).toBe("drawing");
      if (interruption === "geometry") box.mockReturnValue({ ...rect, left: 5 });
      if (interruption === "capture") fireEvent.lostPointerCapture(plot, { pointerId: 1 });
      if (interruption === "cancel") fireEvent.pointerCancel(plot, { pointerId: 1 });
      if (interruption === "blur") fireEvent.blur(window);
      if (interruption === "selection") act(control.replace);
      pointer(plot, "pointerUp", 600); fireEvent.click(plot, { detail: 1 });
      expect(control.current()?.range ?? null).toBeNull(); expect(control.current()?.committed ?? null).toBeNull();
      box.mockReturnValue(rect);
    }
    expect(inspect).not.toHaveBeenCalled();
  });

  it("preserves a settled band through focus loss but gives no shortcuts to a background or modal-covered plot", () => {
    const { plot } = setup(axis); draw(plot);
    screen.getByRole("button", { name: "Outside" }).focus(); fireEvent.keyDown(plot, { key: "Enter" });
    expect(control.current()?.range?.phase).toBe("pending"); expect(control.current()?.committed).toBeNull();
    plot.focus(); const modal = document.createElement("div"); modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); document.body.append(modal);
    fireEvent.keyDown(plot, { key: "Enter" }); expect(control.current()?.committed).toBeNull(); modal.remove();
    fireEvent.keyDown(plot, { key: "Enter" }); expect(control.current()?.committed).toEqual({ low: 20, high: 60 });
  });

  it("retains native Tab, host modifiers and IME while accepting an owned keyboard range action", () => {
    const { plot } = setup(axis); plot.focus();
    for (const options of [{ key: "Tab" }, { key: "+", ctrlKey: true }, { key: "Home", metaKey: true }, { key: "+", altKey: true }, { key: "+", isComposing: true }]) {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options });
      act(() => { plot.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(false);
      expect(control.current()?.committed).toBeNull();
    }
    fireEvent.keyDown(plot, { key: "+" }); expect(control.current()?.committed).not.toBeNull();
  });

  it("leaves vertical touch and multi-touch to the browser without committing", () => {
    const { plot } = setup(axis);
    pointer(plot, "pointerDown", 200, { pointerType: "touch" });
    pointer(plot, "pointerMove", 202, { pointerType: "touch", clientY: 100 });
    pointer(plot, "pointerUp", 202, { pointerType: "touch", clientY: 100 }); fireEvent.click(plot);
    expect(control.current()?.range).toBeNull(); expect(inspect).not.toHaveBeenCalled();
    pointer(plot, "pointerDown", 200, { pointerType: "touch" }); pointer(plot, "pointerMove", 600, { pointerType: "touch" });
    pointer(plot, "pointerDown", 800, { pointerType: "touch", pointerId: 2, isPrimary: false });
    pointer(plot, "pointerUp", 600, { pointerType: "touch" }); fireEvent.click(plot);
    expect(control.current()?.range).toBeNull(); expect(control.current()?.committed).toBeNull();
    draw(plot, { pointerType: "touch" }); expect(control.current()?.range?.phase).toBe("pending");
  });

  it("keeps pointer frames out of React publication while repainting the source-coordinate band", () => {
    const { plot } = setup(axis);
    pointer(plot, "pointerDown", 200); pointer(plot, "pointerMove", 400);
    const afterStart = publications;
    for (const x of [450, 500, 550, 600]) pointer(plot, "pointerMove", x);
    expect(publications).toBe(afterStart);
    expect(control.current()?.range?.domain.high).toBe(60);
    expect(plot.querySelector(".plot-range-band")).toHaveAttribute("width", "400");
    pointer(plot, "pointerUp", 600); expect(publications).toBeGreaterThan(afterStart);
  });

  it("uses middle and Space-primary pan, plus Shift-wheel pan; unmodified wheel zoom settles once", () => {
    vi.useFakeTimers(); const { plot } = setup(axis); plot.focus(); fireEvent.keyDown(plot, { key: "+" });
    const initial = control.current()!.committed!;
    pointer(plot, "pointerDown", 500, { button: 1 }); pointer(plot, "pointerMove", 600, { button: 1 }); pointer(plot, "pointerUp", 600, { button: 1 });
    const middle = control.current()!.committed!; expect(middle.low).toBeLessThan(initial.low);
    fireEvent.keyDown(plot, { key: " " }); pointer(plot, "pointerDown", 500); pointer(plot, "pointerMove", 400); pointer(plot, "pointerUp", 400); fireEvent.keyUp(plot, { key: " " });
    expect(control.current()!.committed!.low).toBeCloseTo(initial.low);
    const before = control.current()!.committed!;
    fireEvent.wheel(plot, { deltaY: 10, shiftKey: true, clientX: 500 });
    expect(control.current()!.shown.low).toBeGreaterThan(before.low); expect(control.current()!.committed).toEqual(before);
    act(() => vi.advanceTimersByTime(120)); expect(control.current()!.committed!.low).toBeGreaterThan(before.low);
    const panned = control.current()!.committed!;
    const host = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }); act(() => { plot.dispatchEvent(host); });
    expect(host.defaultPrevented).toBe(false); expect(control.current()!.committed).toEqual(panned);
    fireEvent.wheel(plot, { deltaY: -20, clientX: 500 }); expect(control.current()!.committed).toEqual(panned);
    act(() => vi.advanceTimersByTime(120));
    const zoomed = control.current()!.committed!; expect(zoomed.high - zoomed.low).toBeLessThan(panned.high - panned.low);
  });
});
