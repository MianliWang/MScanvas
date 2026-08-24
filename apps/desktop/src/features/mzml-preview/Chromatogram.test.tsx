/**
 * The visible viewer, against the contract it is an adapter over.
 *
 * Almost nothing here is a claim about arithmetic: the clipping, the extent,
 * the reduction, the nearest-scan resolution and every interaction transition
 * are settled in `viewer/`. What these tests establish is that this component
 * asks those questions rather than answering them again -- which is exactly
 * where PR #72 went wrong, one seam at a time.
 *
 * So the cases are chosen to fail if a value is taken from the wrong field, an
 * extent from the wrong geometry, a scan from the drawing, a range from a field
 * the component picked itself, or an epoch from anywhere but the reducer.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appStyles from "../../app/app.css?raw";
import { Chromatogram } from "./Chromatogram";
import type { SpectrumRow } from "./contracts";
import type { TraceVisibility } from "./usePreviewWorkspace";
import type { ViewerInteractionState } from "./viewer/interactionState";
import { renderedDomain } from "./viewer/interactionState";
import { buildPreviewScanModel } from "./viewer/previewScanModel";
import type { RetentionTimeDomain, ScanModel } from "./viewer/scanModel";
import type { ViewerInteractionController } from "./viewer/useViewerInteraction";
import { useViewerInteraction } from "./viewer/useViewerInteraction";
import { buildRows } from "../../test/previewFixtures";

const TIC_ONLY: TraceVisibility = { tic: true, bpc: false };
const BPC_ONLY: TraceVisibility = { tic: false, bpc: true };
const BOTH: TraceVisibility = { tic: true, bpc: true };
const NEITHER: TraceVisibility = { tic: false, bpc: false };

/** The plot's own width, in client pixels, so viewBox units are 1:1 with them. */
const PLOT_PIXELS = 1_000;
const PADDING_LEFT = 64;
const DRAWN_WIDTH = PLOT_PIXELS - PADDING_LEFT - 12;

interface Scan {
  readonly rt: number;
  readonly tic: number;
  readonly bpc: number;
}

/** A run with exactly the per-scan values a case needs. */
function runOf(scans: readonly Scan[], truncated = false): ScanModel {
  const rows: SpectrumRow[] = scans.map((scan, index) => ({
    index,
    identifier: `controllerType=0 controllerNumber=1 scan=${String(index + 1)}`,
    scanNumber: index + 1,
    msLevel: 1,
    retentionTime: { value: scan.rt, unitKnown: false },
    basePeakMz: 400,
    basePeakIntensity: scan.bpc,
    totalIonCurrent: scan.tic,
    precursorMz: null,
  }));
  return buildPreviewScanModel({
    rows,
    totalRowCount: truncated ? rows.length * 10 : rows.length,
    truncated,
  });
}

function runOfRows(rowCount: number, truncated = false): ScanModel {
  const rows = buildRows(rowCount);
  return buildPreviewScanModel({
    rows,
    totalRowCount: truncated ? rowCount * 10 : rowCount,
    truncated,
  });
}

let controller: ViewerInteractionController | null = null;

function Harness({
  model,
  initialTraces,
  onSelect,
  onToggleTrace,
}: {
  readonly model: ScanModel;
  readonly initialTraces: TraceVisibility;
  readonly onSelect: (index: number) => void;
  readonly onToggleTrace: (trace: keyof TraceVisibility) => void;
}) {
  const viewer = useViewerInteraction();
  controller = viewer;
  const [traces, setTraces] = useState(initialTraces);
  const { dispatch } = viewer;
  // The same announcement the workspace makes, in the same phase, so the first
  // painted frame already has an axis.
  useLayoutEffect(() => {
    if (model.status === "ready") {
      dispatch({ type: "preview-loaded", fullDomain: model.fullDomain });
    }
  }, [dispatch, model]);
  return (
    <Chromatogram
      dispatch={viewer.dispatch}
      interaction={viewer.state}
      model={model}
      onSelect={onSelect}
      onToggleTrace={(trace) => {
        onToggleTrace(trace);
        setTraces((current) => ({ ...current, [trace]: !current[trace] }));
      }}
      readInteraction={viewer.current}
      traces={traces}
    />
  );
}

function renderChromatogram(
  options: { readonly model?: ScanModel; readonly traces?: TraceVisibility } = {},
) {
  const onSelect = vi.fn();
  const onToggleTrace = vi.fn();
  const model = options.model ?? runOfRows(50);
  render(
    <Harness
      initialTraces={options.traces ?? TIC_ONLY}
      model={model}
      onSelect={onSelect}
      onToggleTrace={onToggleTrace}
    />,
  );
  if (model.status === "ready") {
    givePlotABox();
  }
  return { onSelect, onToggleTrace, model };
}

/**
 * A plot element with a real box, because jsdom gives every element a zero one.
 *
 * Every pointer interaction converts a client x into a retention time through
 * this rectangle, so without it the whole interaction surface would resolve to
 * one coordinate and every test would pass for the wrong reason.
 */
function givePlotABox(): void {
  vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: PLOT_PIXELS,
    bottom: 210,
    width: PLOT_PIXELS,
    height: 210,
    toJSON: () => ({}),
  } as DOMRect);
}

function plot(): HTMLElement {
  return screen.getByRole("img", { name: "Chromatogram" });
}

const mountedStyles: HTMLStyleElement[] = [];

/** The application's own stylesheet, for a rule a coordinate cannot express. */
function mountAppStyles(): void {
  const style = document.createElement("style");
  style.textContent = appStyles;
  document.head.append(style);
  mountedStyles.push(style);
}

/** What the mounted stylesheet declares for one selector. */
function styleOf(selector: string): CSSStyleDeclaration {
  const rule = mountedStyles
    .flatMap((style) => [...(style.sheet?.cssRules ?? [])])
    .find(
      (candidate): candidate is CSSStyleRule =>
        "selectorText" in candidate && (candidate as CSSStyleRule).selectorText === selector,
    );
  expect(rule, `Expected a CSS rule for ${selector}`).toBeDefined();
  return (rule as CSSStyleRule).style;
}

function state(): ViewerInteractionState {
  if (controller === null) {
    throw new Error("no controller");
  }
  return controller.state;
}

function send(event: Parameters<ViewerInteractionController["dispatch"]>[0]): void {
  act(() => {
    controller?.dispatch(event);
  });
}

function tracePaths(): NodeListOf<Element> {
  return document.querySelectorAll("path.chromatogram-trace");
}

/** The top value label, which is what the axis claims the tallest thing is. */
function axisHigh(): string {
  return document.querySelectorAll("text.chromatogram-value-label")[0]?.textContent ?? "";
}

function axisLow(): string {
  return document.querySelectorAll("text.chromatogram-value-label")[1]?.textContent ?? "";
}

/** Where a retention time falls, in client pixels, under the range on screen. */
function clientXFor(retentionTime: number, domain: RetentionTimeDomain): number {
  const fraction = (retentionTime - domain.low) / (domain.high - domain.low);
  return PADDING_LEFT + fraction * DRAWN_WIDTH;
}

function shown(): RetentionTimeDomain {
  const domain = renderedDomain(state());
  if (domain === null) {
    throw new Error("nothing is on screen");
  }
  return domain;
}

/**
 * Sends one real cancelable wheel event to the production listener.
 *
 * Returned rather than swallowed, because `defaultPrevented` is half of what
 * every wheel case has to say: whether the viewport moved is the product's
 * behaviour, and whether the event was claimed is who the input belonged to.
 *
 * `deltaMode` defaults to pixels, which is what nearly every device sends.
 */
function wheel(options: {
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly clientX?: number;
  readonly ctrlKey?: boolean;
}): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX ?? 500,
    ctrlKey: options.ctrlKey ?? false,
    deltaMode: options.deltaMode ?? 0,
    deltaY: options.deltaY,
  });
  act(() => {
    plot().dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  // Not `shouldAdvanceTime`. The wheel's settle is scheduled 120ms out, and a
  // clock that advances with real time could fire it between two lines of a
  // test -- which would make "the gesture has not settled yet" a statement
  // about how fast this machine is.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
  for (const style of mountedStyles.splice(0)) {
    style.remove();
  }
  controller = null;
});

describe("what the traces are made of", () => {
  it("draws TIC from the total ion current", () => {
    renderChromatogram({ model: runOf([{ rt: 0, tic: 500, bpc: 90 }, { rt: 1, tic: 400, bpc: 80 }]) });

    // Discriminating: derived from the base peak instead, the axis would say 90.
    expect(axisHigh()).toBe("500.00");
  });

  it("draws BPC from the base peak intensity", () => {
    renderChromatogram({
      model: runOf([{ rt: 0, tic: 500, bpc: 90 }, { rt: 1, tic: 400, bpc: 80 }]),
      traces: BPC_ONLY,
    });

    expect(axisHigh()).toBe("90.00");
  });

  it("scales both traces together when both are drawn", () => {
    renderChromatogram({
      model: runOf([{ rt: 0, tic: 500, bpc: 90 }, { rt: 1, tic: 400, bpc: 80 }]),
      traces: BOTH,
    });

    expect(tracePaths()).toHaveLength(2);
    expect(axisHigh()).toBe("500.00");
    // Zero is always in it, so a flat trace high above the axis is not drawn as
    // structure.
    expect(axisLow()).toBe("0");
  });

  it("says the values come from the loaded table and are not a stored record", () => {
    renderChromatogram();

    expect(screen.getByText(/Per-scan values from the loaded spectrum table/u)).toBeVisible();
    expect(screen.getByText(/Not a stored chromatogram record\./u)).toBeVisible();
  });

  it("says neither axis carries a unit", () => {
    renderChromatogram();

    expect(
      screen.getByText(/Retention time — unit not reported · Intensity — unit not reported/u),
    ).toBeVisible();
  });
});

describe("what is drawn, and what the axis says about it", () => {
  it("never lets a scan outside the viewport set the value axis", () => {
    /*
     * The failure that re-scoped this milestone, reproduced against the visible
     * component. A tall peak at RT 9 and an ordinary stretch at RT 10-13:
     * zooming into the stretch is the most ordinary thing anyone does with a
     * chromatogram, and PR #72 answered it by flattening every visible feature
     * and labelling the axis 9,000,000.
     */
    renderChromatogram({
      model: runOf([
        { rt: 9, tic: 9_000_000, bpc: 9_000_000 },
        { rt: 10, tic: 90, bpc: 90 },
        { rt: 11, tic: 100, bpc: 100 },
        { rt: 12, tic: 110, bpc: 110 },
        { rt: 13, tic: 120, bpc: 120 },
      ]),
    });

    send({ type: "viewport-step", domain: { low: 10, high: 13 } });

    expect(axisHigh()).not.toBe("9.000e+6");
    expect(axisHigh()).toBe("120.00");
  });

  it("does let the height where the line crosses the edge set it", () => {
    // The other half, and the reason the rule is "the clipped polyline" rather
    // than "only real scans inside": the line really does reach that height on
    // screen, halfway between 9,000,000 and 90.
    renderChromatogram({
      model: runOf([
        { rt: 9, tic: 9_000_000, bpc: 9_000_000 },
        { rt: 10, tic: 90, bpc: 90 },
        { rt: 11, tic: 100, bpc: 100 },
        { rt: 12, tic: 110, bpc: 110 },
        { rt: 13, tic: 120, bpc: 120 },
      ]),
    });

    send({ type: "viewport-step", domain: { low: 9.5, high: 13 } });

    expect(axisHigh()).toBe("4.500e+6");
  });

  it("keeps the visible extremes through the screen reduction", () => {
    const scans: Scan[] = [];
    for (let index = 0; index < 8_000; index += 1) {
      scans.push({ rt: index, tic: 100 + (index % 50), bpc: 10 });
    }
    scans[4_321] = { rt: 4_321, tic: 5_000_000, bpc: 10 };
    renderChromatogram({ model: runOf(scans) });

    // One spike in a column crowded with lower neighbours, and it is still what
    // the axis is scaled to.
    expect(axisHigh()).toBe("5.000e+6");
  });

  it("draws one path per trace rather than one node per scan", () => {
    renderChromatogram({ model: runOfRows(20_000), traces: BOTH });

    expect(tracePaths()).toHaveLength(2);
    expect(document.querySelectorAll("svg.chromatogram-svg circle")).toHaveLength(0);
    for (const path of tracePaths()) {
      // A screen budget rather than the run's size: at most four vertices per
      // column, over 900 columns.
      const vertices = (path.getAttribute("d") ?? "").split(/[ML]/u).length - 1;
      expect(vertices).toBeLessThanOrEqual(3_600);
    }
  });

  it("draws a run of negative values below zero rather than clipping them", () => {
    renderChromatogram({
      model: runOf([
        { rt: 0, tic: -40, bpc: -40 },
        { rt: 1, tic: 60, bpc: 60 },
      ]),
    });

    expect(axisLow()).toBe("-40.00");
    expect(axisHigh()).toBe("60.00");
  });
});

describe("trace visibility", () => {
  it("starts on TIC alone and hands a toggle back rather than deciding it", () => {
    const { onToggleTrace } = renderChromatogram();

    expect(screen.getByRole("checkbox", { name: /TIC/u })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /BPC/u })).not.toBeChecked();
    expect(tracePaths()).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox", { name: /BPC/u }));

    expect(onToggleTrace.mock.calls).toEqual([["bpc"]]);
    expect(tracePaths()).toHaveLength(2);
  });

  it("tells the two traces apart by more than colour", () => {
    renderChromatogram({ traces: BOTH });

    expect(tracePaths()[0]).not.toHaveAttribute("stroke-dasharray");
    expect(tracePaths()[1]).toHaveAttribute("stroke-dasharray", "7 4");
  });

  it("says so on purpose when both traces are hidden", () => {
    renderChromatogram({ traces: NEITHER });

    expect(tracePaths()).toHaveLength(0);
    expect(screen.getByText("Both traces are hidden.")).toBeInTheDocument();
    // The plot stays: the axis is still the run's, and this is still where a
    // scan is chosen.
    expect(plot()).toBeVisible();
  });
});

describe("coordinate inspection", () => {
  it("reports the nearest scan from the full model without selecting it", () => {
    const { onSelect } = renderChromatogram();

    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * 0.0125, shown()) });

    expect(screen.getByText(/Hovering index 10, scan 11, MS2/u)).toBeVisible();
    expect(state().hover?.spectrumIndex).toBe(10);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports both per-scan values whichever trace is drawn", () => {
    renderChromatogram();

    fireEvent.pointerMove(plot(), { clientX: 500 });

    // The fixture's two series are far apart on purpose -- TIC in the ten
    // thousands, BPC in the thousands -- so a readout that confused them could
    // not match.
    expect(screen.getByText(/TIC 100\d\d, BPC 10\d\d\./u)).toBeVisible();
  });

  it("is a no-op by identity while the pointer stays over one scan", () => {
    // A renderer may resolve the nearest scan on every pointer frame. What
    // reaches the contract is the pointer crossing into another scan, and this
    // is what keeps a linked view from re-rendering at the cursor's frequency.
    renderChromatogram();
    const at = clientXFor(10 * 0.0125, shown());
    fireEvent.pointerMove(plot(), { clientX: at });
    const established = state();

    fireEvent.pointerMove(plot(), { clientX: at + 1 });
    fireEvent.pointerMove(plot(), { clientX: at - 1 });

    expect(state()).toBe(established);
  });

  it("does not survive a viewport change under it", () => {
    renderChromatogram();
    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * 0.0125, shown()) });
    expect(state().hover).not.toBeNull();

    send({ type: "viewport-step", domain: { low: 0.1, high: 0.3 } });

    expect(state().hover).toBeNull();
    expect(document.querySelector("g.chromatogram-hover")).toBeNull();
    expect(screen.queryByText(/^Hovering/u)).toBeNull();
  });

  it("survives a gesture that resolves to the range already shown", () => {
    // Not an enumeration of events: a drag further left at the left edge clamps
    // to what is already drawn, nothing moves on screen, and an observation
    // made a moment earlier is still accurate.
    renderChromatogram();
    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * 0.0125, shown()) });

    send({ type: "gesture-started", domain: { low: -100, high: 1_000 } });

    expect(state().hover?.spectrumIndex).toBe(10);
    expect(document.querySelector("g.chromatogram-hover")).not.toBeNull();
  });

  it("lets the next pointer frame establish a fresh observation", () => {
    renderChromatogram();
    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * 0.0125, shown()) });
    send({ type: "viewport-step", domain: { low: 0.1, high: 0.3 } });
    expect(state().hover).toBeNull();

    fireEvent.pointerMove(plot(), { clientX: clientXFor(0.2, shown()) });

    expect(state().hover).not.toBeNull();
    expect(screen.getByText(/^Hovering index 16,/u)).toBeVisible();
  });

  it("draws the guide from the scan's place under the range on screen now", () => {
    // Never from a coordinate scaled when the observation was made: a zoom
    // would leave the rule standing somewhere the scan no longer is.
    renderChromatogram();
    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * 0.0125, shown()) });
    const before = document.querySelector("g.chromatogram-hover line")?.getAttribute("x1");

    // Re-establish under a narrower range: the same scan, a different place.
    send({ type: "viewport-step", domain: { low: 0.1, high: 0.2 } });
    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * 0.0125, shown()) });

    expect(state().hover?.spectrumIndex).toBe(10);
    expect(document.querySelector("g.chromatogram-hover line")?.getAttribute("x1")).not.toBe(
      before,
    );
  });

  it("stops reporting a scan once the pointer leaves", () => {
    renderChromatogram();
    fireEvent.pointerMove(plot(), { clientX: 500 });
    expect(screen.getByText(/^Hovering/u)).toBeVisible();

    fireEvent.pointerLeave(plot());

    expect(state().hover).toBeNull();
    expect(screen.queryByText(/^Hovering/u)).toBeNull();
  });
});

describe("choosing a scan", () => {
  it("commits the nearest scan exactly once", () => {
    const { onSelect } = renderChromatogram();
    const at = clientXFor(30 * 0.0125, shown());

    fireEvent.pointerDown(plot(), { button: 0, clientX: at, pointerId: 1 });
    fireEvent.pointerUp(plot(), { button: 0, clientX: at, pointerId: 1 });

    expect(onSelect.mock.calls).toEqual([[30]]);
  });

  it("resolves the click against every scan rather than the drawn vertices", () => {
    // The drawing has far fewer vertices than the run has scans, and its edges
    // carry interpolated points that are not scans at all. Resolving there
    // would silently select a neighbour, and more often the larger the run.
    const { onSelect } = renderChromatogram({ model: runOfRows(20_000) });
    const target = 12_345;
    const at = clientXFor(target * 0.0125, shown());

    fireEvent.pointerDown(plot(), { button: 0, clientX: at, pointerId: 1 });
    fireEvent.pointerUp(plot(), { button: 0, clientX: at, pointerId: 1 });

    expect(onSelect.mock.calls).toEqual([[target]]);
  });

  it("still selects when the pointer only trembled", () => {
    const { onSelect } = renderChromatogram();

    fireEvent.pointerDown(plot(), { button: 0, clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 502, clientY: 101, pointerId: 1 });
    fireEvent.pointerUp(plot(), { button: 0, clientX: 502, clientY: 101, pointerId: 1 });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("does not select when the press was dragged away, even straight down", () => {
    /*
     * Only sideways travel can pan this plot, so a vertical drag starts no
     * gesture -- but it is still a drag. Releasing it must not commit a
     * selection, because every selection is one ProteoWizard process and the
     * user who dragged the pointer away was not asking for one.
     */
    const { onSelect } = renderChromatogram();
    const before = state();

    fireEvent.pointerDown(plot(), { button: 0, clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 501, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(plot(), { button: 0, clientX: 501, clientY: 160, pointerId: 1 });

    expect(onSelect).not.toHaveBeenCalled();
    // And no gesture was invented for a direction this plot does not pan in.
    expect(state()).toBe(before);
  });

  it("draws the selected scan as a rule and a glyph, not a colour", () => {
    renderChromatogram();
    send({ type: "selection-committed", index: 20, retentionTime: 20 * 0.0125 });

    const marker = document.querySelector("g.chromatogram-selected");
    expect(marker?.querySelector("line")).not.toBeNull();
    expect(marker?.querySelector("rect")).not.toBeNull();
    expect(screen.getByText(/Selected index 20, scan 21, MS1/u)).toBeVisible();
  });

  it("keeps the marker where the scan is under the range on screen now", () => {
    /*
     * The selected scan is persistent and, unlike a hover, is *not* invalidated
     * by the axis moving -- correctly, because the user still selected it. So a
     * coordinate scaled when the selection was made and kept would leave the
     * rule standing where the scan no longer is, and nothing would clear it.
     * The marker is therefore derived from the scan's own retention time at
     * draw time, every time.
     */
    renderChromatogram();
    send({ type: "selection-committed", index: 20, retentionTime: 20 * 0.0125 });
    const before = document.querySelector("g.chromatogram-selected line")?.getAttribute("x1");

    send({ type: "viewport-step", domain: { low: 0.2, high: 0.3 } });

    const after = document.querySelector("g.chromatogram-selected line")?.getAttribute("x1");
    expect(after).not.toBe(before);
    // 0.25 falls at the middle of a 0.2-0.3 range, which is the middle of the
    // drawing area: 64 + 924 / 2.
    expect(Number(after)).toBeCloseTo(526, 0);
    expect(document.querySelector("g.chromatogram-selected rect")?.getAttribute("x")).toBe(
      String(Number(after) - 4.5),
    );
  });

  it("draws no marker while nothing is selected", () => {
    renderChromatogram();

    expect(document.querySelector("g.chromatogram-selected")).toBeNull();
    expect(screen.getByText(/^No scan selected\./u)).toBeVisible();
  });
});

describe("moving the viewport", () => {
  it("shows a wheel gesture before it is committed, and commits it when it settles", () => {
    renderChromatogram();
    const full = shown();

    fireEvent.wheel(plot(), { clientX: 500, deltaY: -240 });

    // The transient range is what is drawn; the committed one is still the
    // whole run, which is what a current-range export would later read.
    expect(state().gesture).not.toBeNull();
    expect(state().committedDomain).toBeNull();
    expect(renderedDomain(state())?.high).toBeLessThan(full.high);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(state().gesture).toBeNull();
    expect(state().committedDomain).not.toBeNull();
    expect(state().committedDomain?.high).toBeLessThan(full.high);
  });

  it("lets a selection made mid-wheel win over the settle that arrives later", () => {
    /*
     * PR #72 finding 8, at the visible adapter. The debounce is an adapter: it
     * eventually emits a settle for the epoch it was scheduled under, and by
     * then a selection has dropped that gesture. The late settle addresses an
     * epoch that no longer exists.
     *
     * Deliberately not tested by cancelling the timer: correctness may not rest
     * on `clearTimeout` winning a race.
     */
    renderChromatogram();
    fireEvent.wheel(plot(), { clientX: 500, deltaY: -240 });
    expect(state().gesture).not.toBeNull();

    // A scan at the far end of the run, outside the transient range.
    send({ type: "selection-committed", index: 49, retentionTime: 49 * 0.0125 });
    const afterSelection = state();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(state()).toBe(afterSelection);
  });

  it("pans on a drag without changing the span, and does not select", () => {
    const { onSelect } = renderChromatogram();
    send({ type: "viewport-step", domain: { low: 0.1, high: 0.3 } });
    const before = shown();

    fireEvent.pointerDown(plot(), { button: 0, clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(plot(), { button: 0, clientX: 500, pointerId: 1 });

    const after = state().committedDomain;
    expect(after).not.toBeNull();
    expect(after?.low).toBeGreaterThan(before.low);
    expect((after?.high ?? 0) - (after?.low ?? 0)).toBeCloseTo(before.high - before.low, 9);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("computes each drag frame from where the press began, not from the last one", () => {
    // Two routes to the same displacement land on the same range, so a long
    // drag accumulates no drift.
    renderChromatogram();
    send({ type: "viewport-step", domain: { low: 0.1, high: 0.3 } });

    fireEvent.pointerDown(plot(), { button: 0, clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(plot(), { button: 0, clientX: 500, pointerId: 1 });
    const direct = state().committedDomain;

    send({ type: "viewport-reset" });
    send({ type: "viewport-step", domain: { low: 0.1, high: 0.3 } });
    fireEvent.pointerDown(plot(), { button: 0, clientX: 700, pointerId: 2 });
    fireEvent.pointerMove(plot(), { clientX: 640, pointerId: 2 });
    fireEvent.pointerMove(plot(), { clientX: 580, pointerId: 2 });
    fireEvent.pointerMove(plot(), { clientX: 500, pointerId: 2 });
    fireEvent.pointerUp(plot(), { button: 0, clientX: 500, pointerId: 2 });

    expect(state().committedDomain?.low).toBeCloseTo(direct?.low ?? 0, 12);
    expect(state().committedDomain?.high).toBeCloseTo(direct?.high ?? 0, 12);
  });

  it("abandons a cancelled drag rather than committing it", () => {
    renderChromatogram();
    send({ type: "viewport-step", domain: { low: 0.1, high: 0.3 } });
    const committed = state().committedDomain;

    fireEvent.pointerDown(plot(), { button: 0, clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 500, pointerId: 1 });
    fireEvent.pointerCancel(plot(), { clientX: 500, pointerId: 1 });

    expect(state().gesture).toBeNull();
    expect(state().committedDomain).toEqual(committed);
  });

  it("zooms, pans and resets from the keyboard", () => {
    renderChromatogram();
    const full = shown();
    plot().focus();

    fireEvent.keyDown(plot(), { key: "+" });
    expect(state().committedDomain).not.toBeNull();
    const zoomed = state().committedDomain;
    const span = (zoomed?.high ?? 0) - (zoomed?.low ?? 0);
    expect(span).toBeLessThan(full.high - full.low);

    fireEvent.keyDown(plot(), { key: "ArrowRight" });
    const panned = state().committedDomain;
    expect(panned?.low).toBeGreaterThan(zoomed?.low ?? 0);
    expect((panned?.high ?? 0) - (panned?.low ?? 0)).toBeCloseTo(span, 9);

    fireEvent.keyDown(plot(), { key: "Home" });
    expect(state().committedDomain).toBeNull();
  });

  it("says which stretch of the run is on screen", () => {
    renderChromatogram();
    expect(screen.getByText(/\(full range\)/u)).toBeVisible();

    send({ type: "viewport-step", domain: { low: 0.1, high: 0.2 } });

    expect(screen.getByText(/Showing 0\.1000 to 0\.2000/u)).toBeVisible();
    expect(screen.queryByText(/\(full range\)/u)).toBeNull();
  });
});

describe("when there is no chromatogram", () => {
  it("refuses a table the preview did not load whole, and says why", () => {
    renderChromatogram({ model: runOfRows(20, true) });

    expect(screen.getByText("TIC and BPC are unavailable for this preview.")).toBeVisible();
    expect(screen.getByText(/did not load the complete table/u)).toBeVisible();
    expect(screen.queryByRole("img", { name: "Chromatogram" })).toBeNull();
    expect(tracePaths()).toHaveLength(0);
    // And no controls for a range that does not exist.
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
  });

  it("refuses a retention-time unit it cannot name, without blaming the file", () => {
    const rows = buildRows(20).map((row, index) =>
      index === 7
        ? { ...row, retentionTime: { value: row.retentionTime.value, unitKnown: true } }
        : row,
    );
    renderChromatogram({
      model: buildPreviewScanModel({ rows, totalRowCount: rows.length, truncated: false }),
    });

    expect(screen.getByText("TIC and BPC are unavailable for this preview.")).toBeVisible();
    expect(screen.getByText(/cannot identify\s+precisely/u)).toBeVisible();
    expect(screen.queryByText(/malformed|corrupt|invalid file/iu)).toBeNull();
  });

  it("says a run with no spectra has nothing to draw", () => {
    renderChromatogram({ model: runOf([]) });

    expect(screen.getByText("This run has no spectra.")).toBeVisible();
  });
});

describe("reaching the plot without a pointer", () => {
  it("is focusable and describes the selected scan where a reader will find it", () => {
    renderChromatogram();
    send({ type: "selection-committed", index: 20, retentionTime: 20 * 0.0125 });

    plot().focus();

    expect(document.activeElement).toBe(plot());
    expect(plot()).toHaveAttribute("aria-describedby", "chromatogram-readout");
    expect(document.querySelector("#chromatogram-readout")?.textContent).toMatch(
      /^Selected index 20,/u,
    );
  });

  it("keeps the readout out of every live region", () => {
    // Which scan the pointer is over changes on most pointer frames at a
    // full-run zoom. A region that announced each of them would be noise.
    renderChromatogram();
    fireEvent.pointerMove(plot(), { clientX: 500 });

    const readout = document.querySelector("#chromatogram-readout");
    expect(readout).not.toBeNull();
    expect(readout?.closest("[aria-live]")).toBeNull();
  });
});

describe("a run of a single scan", () => {
  /*
   * A complete acquisition of exactly one spectrum has a correct value and a
   * correct axis, and for a while it drew neither. `clipTrace` answers with one
   * real source vertex -- which is right -- and the renderer serialized it as
   * `M x y`, a path whose only command is a moveto and which strokes nothing.
   * So the panel showed a labelled axis over an empty plot for a run that had a
   * measurement.
   *
   * The vertex is where the scan is, at the value it carries. The point is
   * painted there and nowhere else: nothing invents a second x to give a line
   * command a length, because a horizontal segment across the plot would be a
   * retention-time extent this run does not have.
   */

  /** Where a single scan lands: the domain has no width, so it is centred. */
  const ONLY_X = 526;
  /** The top of the drawing area, which is where the extent's maximum sits. */
  const TOP_Y = 12;
  /** The bottom of it, which is where zero sits when zero is all there is. */
  const BASELINE_Y = 180;

  function glyphs(): { r: string; cx: string; cy: string; className: string }[] {
    return [...document.querySelectorAll("circle.chromatogram-point")].map((node) => ({
      r: node.getAttribute("r") ?? "",
      cx: node.getAttribute("cx") ?? "",
      cy: node.getAttribute("cy") ?? "",
      className: node.getAttribute("class") ?? "",
    }));
  }

  it("draws the one scan's total ion current as a visible mark", () => {
    renderChromatogram({ model: runOf([{ rt: 4, tic: 9_000, bpc: 700 }]) });

    // The science is unchanged: a ready model, and an axis that reaches the
    // value the scan carries.
    expect(axisHigh()).toBe("9000");
    expect(axisLow()).toBe("0");

    // One mark, for the one active trace, at the vertex's own coordinate.
    const drawn = glyphs();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.className).toContain("chromatogram-point-tic");
    expect(Number(drawn[0]?.cx)).toBeCloseTo(ONLY_X, 6);
    expect(Number(drawn[0]?.cy)).toBeCloseTo(TOP_Y, 6);
    expect(Number.isFinite(Number(drawn[0]?.cx))).toBe(true);
    expect(Number.isFinite(Number(drawn[0]?.cy))).toBe(true);
    // Paint geometry, not a degenerate one: a mark with no radius is a mark
    // nobody can see.
    expect(Number(drawn[0]?.r)).toBeGreaterThan(0);

    // And it is the *trace* that is visible. A strokeless `M x y` path is not a
    // representation of the measurement, and neither is a marker for something
    // else: nothing is selected and nothing is hovered here.
    expect(tracePaths()).toHaveLength(0);
    expect(document.querySelector("g.chromatogram-selected")).toBeNull();
    expect(document.querySelector("g.chromatogram-hover")).toBeNull();
  });

  it("draws the base peak the same way when that is the active trace", () => {
    renderChromatogram({
      model: runOf([{ rt: 4, tic: 9_000, bpc: 700 }]),
      traces: BPC_ONLY,
    });

    expect(axisHigh()).toBe("700.00");
    const drawn = glyphs();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.className).toContain("chromatogram-point-bpc");
    expect(Number(drawn[0]?.cy)).toBeCloseTo(TOP_Y, 6);
    expect(Number(drawn[0]?.r)).toBeGreaterThan(0);
  });

  it("draws both series at their own values when both are active", () => {
    renderChromatogram({
      model: runOf([{ rt: 4, tic: 9_000, bpc: 3_000 }]),
      traces: BOTH,
    });

    const drawn = glyphs();
    expect(drawn).toHaveLength(2);
    // Scaled together, as they are when they are lines: the axis is the run's,
    // and each mark is at its own series' value.
    expect(Number(drawn[0]?.cy)).toBeCloseTo(TOP_Y, 6);
    expect(Number(drawn[1]?.cy)).toBeCloseTo(TOP_Y + (6_000 / 9_000) * 168, 6);
    expect(Number(drawn[0]?.cx)).toBeCloseTo(ONLY_X, 6);
    expect(Number(drawn[1]?.cx)).toBeCloseTo(ONLY_X, 6);
  });

  it("keeps the two series apart without colour when they share a coordinate", () => {
    // A scan whose total ion current *is* its base peak. Both marks land on one
    // point, and reducing that to a single indistinguishable dot would lose one
    // of the two things the reader asked to see.
    mountAppStyles();
    renderChromatogram({
      model: runOf([{ rt: 4, tic: 5_000, bpc: 5_000 }]),
      traces: BOTH,
    });

    const drawn = glyphs();
    expect(drawn).toHaveLength(2);
    expect(Number(drawn[0]?.cx)).toBeCloseTo(Number(drawn[1]?.cx), 6);
    expect(Number(drawn[0]?.cy)).toBeCloseTo(Number(drawn[1]?.cy), 6);
    // Two non-colour distinctions, and the second is what stops a larger ring
    // simply covering the disc inside it.
    expect(Number(drawn[0]?.r)).not.toBeCloseTo(Number(drawn[1]?.r), 6);
    expect(styleOf(".chromatogram-point").fill).not.toBe("none");
    expect(styleOf(".chromatogram-point-bpc").fill).toBe("none");
  });

  it("draws a measured zero on the baseline rather than drawing nothing", () => {
    // Zero is a measurement. A run whose only scan reported no signal has to
    // look different from a run this build refused to draw.
    renderChromatogram({ model: runOf([{ rt: 4, tic: 0, bpc: 0 }]) });

    const drawn = glyphs();
    expect(drawn).toHaveLength(1);
    expect(Number(drawn[0]?.cy)).toBeCloseTo(BASELINE_Y, 6);
    expect(Number(drawn[0]?.r)).toBeGreaterThan(0);
    expect(axisHigh()).toBe("0");
  });

  it("draws no mark for a trace that is not active", () => {
    renderChromatogram({ model: runOf([{ rt: 4, tic: 9_000, bpc: 700 }]), traces: NEITHER });

    expect(glyphs()).toHaveLength(0);
    expect(screen.getByText("Both traces are hidden.")).toBeInTheDocument();
  });

  it("goes back to one path per trace as soon as there is a line to draw", () => {
    // The point is for the case that has no line, and for nothing else. Two
    // scans are a line, and a run of many is still one node.
    renderChromatogram({ model: runOf([{ rt: 4, tic: 9_000, bpc: 700 }, { rt: 5, tic: 8_000, bpc: 600 }]) });

    expect(glyphs()).toHaveLength(0);
    expect(tracePaths()).toHaveLength(1);
    expect(tracePaths()[0]?.getAttribute("d")).toContain("L");
  });
});

/*
 * What the viewport controls claim, and whether pressing them does it.
 *
 * The rule is one sentence -- a visible viewport action is available exactly
 * when applying it would change the range on screen -- and the cases below are
 * the states a user actually reaches, not an enumeration of boundaries the
 * component was told to look for.
 */
describe("the viewport control group", () => {
  const CONTROLS = ["Zoom in", "Zoom out", "Reset range"] as const;

  function control(label: (typeof CONTROLS)[number]): HTMLButtonElement {
    return screen.getByRole("button", { name: label }) as HTMLButtonElement;
  }

  function enabledControls(): string[] {
    return CONTROLS.filter((label) => !control(label).disabled);
  }

  /** Presses a control without going through the roles that would refuse. */
  function press(label: (typeof CONTROLS)[number]): void {
    fireEvent.click(control(label));
  }

  it("offers only the one action that can do anything when the whole run is shown", () => {
    // The state the viewer opens in, and the one most users see first.
    renderChromatogram();

    expect(enabledControls()).toEqual(["Zoom in"]);
    expect(screen.getByText(/\(full range\)/u)).toBeVisible();
  });

  it("offers the other two as soon as there is something to go back to", () => {
    renderChromatogram();
    const full = shown();

    press("Zoom in");

    const narrowed = shown();
    expect(narrowed.high - narrowed.low).toBeLessThan(full.high - full.low);
    expect(enabledControls()).toEqual(["Zoom in", "Zoom out", "Reset range"]);
  });

  it("stops offering to zoom in at the narrowest viewport the run allows", () => {
    // Driven there by pressing the button, not by naming a range.
    renderChromatogram();
    for (let step = 0; step < 200 && !control("Zoom in").disabled; step += 1) {
      press("Zoom in");
    }

    expect(control("Zoom in")).toBeDisabled();
    // And the way back is still open.
    expect(control("Zoom out")).toBeEnabled();
    expect(control("Reset range")).toBeEnabled();
  });

  it("offers nothing for a run whose scans all share one retention time", () => {
    // The single-scan run: a real acquisition, with a value and a visible mark,
    // and no width to zoom into or out of.
    renderChromatogram({ model: runOf([{ rt: 4, tic: 9_000, bpc: 700 }]) });

    expect(enabledControls()).toEqual([]);
    // The measurement is still on screen. There is nothing to zoom, which is
    // not the same as nothing to see.
    expect(document.querySelectorAll("circle.chromatogram-point")).toHaveLength(1);
  });

  it("makes every control it offers do something, and every one it refuses do nothing", () => {
    /*
     * The user-facing property, asserted over the whole group in several
     * states: an enabled control changes the range on screen, and a disabled one
     * changes no state at all.
     */
    renderChromatogram();
    const states = [
      () => undefined,
      () => {
        press("Zoom in");
      },
      () => {
        for (let step = 0; step < 200 && !control("Zoom in").disabled; step += 1) {
          press("Zoom in");
        }
      },
    ];

    for (const reach of states) {
      reach();
      for (const label of CONTROLS) {
        const before = state();
        const shownBefore = shown();
        if (control(label).disabled) {
          // A disabled button is refused by the DOM, and the operation refuses
          // it too -- so neither the range nor the state moves.
          act(() => {
            control(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
          expect(state(), `${label} while disabled`).toBe(before);
          continue;
        }
        press(label);
        const shownAfter = shown();
        expect(
          shownAfter.low !== shownBefore.low || shownAfter.high !== shownBefore.high,
          `${label} while enabled`,
        ).toBe(true);
      }
    }
  });

  it("plans again when it is pressed, rather than trusting the render that drew it", () => {
    /*
     * The interval between the render that computed `disabled` and the press
     * that arrives: a settling gesture, a selection's reveal, a preview
     * replaced. Here the state is moved inside the same batch as the click, so
     * the button is still rendered enabled while the live state says its action
     * would do nothing.
     *
     * A handler that dispatched what its render had decided would produce a new
     * state object for a transition nobody would see.
     */
    renderChromatogram();
    press("Zoom in");
    expect(control("Reset range")).toBeEnabled();

    let afterReset: ViewerInteractionState | null = null;
    act(() => {
      afterReset = controller?.dispatch({ type: "viewport-reset" }) ?? null;
      control("Reset range").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(afterReset).not.toBeNull();
    expect(state()).toBe(afterReset);
    expect(control("Reset range")).toBeDisabled();
  });

  it("takes the same rule from the keyboard, without inventing a transition", () => {
    // The keys stay the keys. What they must not do is move the viewport where
    // a press of the same action would have been refused.
    renderChromatogram();
    const before = state();

    fireEvent.keyDown(plot(), { key: "-" });
    expect(state()).toBe(before);
    fireEvent.keyDown(plot(), { key: "Home" });
    expect(state()).toBe(before);

    fireEvent.keyDown(plot(), { key: "+" });
    expect(state()).not.toBe(before);
    expect(control("Zoom out")).toBeEnabled();

    fireEvent.keyDown(plot(), { key: "Home" });
    expect(shown()).toEqual(renderedDomain(state()));
    expect(control("Reset range")).toBeDisabled();
  });

  it("says nothing about the range when there is no chromatogram to have one", () => {
    renderChromatogram({ model: runOfRows(20, true) });

    for (const label of CONTROLS) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });
});

/*
 * Who owns a wheel event.
 *
 * Cancelling one is a claim on it, and this panel sits at the top of a column
 * that scrolls. A wheel cancelled and then not used is a wheel that neither
 * zoomed nor scrolled -- so the rule is the same one the buttons follow, asked
 * of a gesture instead of a press: the viewer owns a wheel exactly when putting
 * it through the contract would change the range on screen.
 *
 * Every case asserts both halves, because they are different failures. Whether
 * the viewport moved is the product's behaviour; whether the event was cancelled
 * is who the input belonged to.
 */
describe("who owns a wheel", () => {
  const IN = -240;
  const OUT = 240;

  it("claims a wheel that narrows the run, and moves the axis with it", () => {
    renderChromatogram();
    const before = shown();

    const event = wheel({ deltaY: IN });

    expect(event.defaultPrevented).toBe(true);
    expect(state().gesture).not.toBeNull();
    expect(shown().high - shown().low).toBeLessThan(before.high - before.low);
  });

  it("leaves a wheel that cannot widen the run to the browser", () => {
    // The state the viewer opens in, and the one a reader is in when they want
    // to look at the panels below.
    renderChromatogram();
    const before = state();

    const event = wheel({ deltaY: OUT });

    expect(event.defaultPrevented).toBe(false);
    // And nothing was left behind: no gesture, no epoch, no settle.
    expect(state()).toBe(before);
    expect(state().gesture).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(state()).toBe(before);
  });

  it("leaves it to the browser for a run whose low edge cannot be recovered exactly", () => {
    /*
     * The case that decides how the question is asked, and the reason the plan
     * is projected through the gesture's *settle*.
     *
     * A gesture's rendered domain is the clamped range it holds, and canonical
     * clamping recovers a low edge as `full.high - span`, which rounds: for a
     * run of 0.0125 to 453.9875 the zoom-out candidate comes back as
     * 0.012499999999988631. Compared as a transient that is a change -- of one
     * part in a hundred million million -- and the wheel would be claimed for
     * it, which is this whole defect wearing its repair's clothes. Settled, the
     * run comes back exactly, and the honest answer is that nothing moved.
     */
    renderChromatogram({
      model: runOf([
        { rt: 0.0125, tic: 10, bpc: 5 },
        { rt: 453.9875, tic: 20, bpc: 6 },
      ]),
    });
    const before = state();
    expect(shown()).toEqual({ low: 0.0125, high: 453.9875 });

    const event = wheel({ deltaY: OUT });

    expect(event.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
  });

  it("claims both directions once there is a subrange to move within", () => {
    renderChromatogram();
    wheel({ deltaY: IN });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const subrange = shown();
    expect(subrange.high - subrange.low).toBeLessThan(50 * 0.0125);

    const outward = wheel({ deltaY: OUT });
    expect(outward.defaultPrevented).toBe(true);
    expect(shown().high - shown().low).toBeGreaterThan(subrange.high - subrange.low);

    const inward = wheel({ deltaY: IN });
    expect(inward.defaultPrevented).toBe(true);
  });

  it("stops claiming inward wheels at the narrowest viewport, and still claims outward ones", () => {
    renderChromatogram();
    for (let step = 0; step < 200; step += 1) {
      const event = wheel({ deltaY: IN });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      if (!event.defaultPrevented) {
        break;
      }
    }
    const atFloor = state();

    const inward = wheel({ deltaY: IN });
    expect(inward.defaultPrevented).toBe(false);
    expect(state()).toBe(atFloor);

    const outward = wheel({ deltaY: OUT });
    expect(outward.defaultPrevented).toBe(true);
  });

  it("leaves both directions to the browser for a run with no width to zoom", () => {
    // The single-scan run: a real acquisition with a value and a visible mark,
    // and nothing to zoom into or out of in either direction.
    renderChromatogram({ model: runOf([{ rt: 4, tic: 9_000, bpc: 700 }]) });
    const before = state();

    const inward = wheel({ deltaY: IN });
    const outward = wheel({ deltaY: OUT });

    expect(inward.defaultPrevented).toBe(false);
    expect(outward.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
    expect(state().gesture).toBeNull();
    // And the measurement is still on screen.
    expect(document.querySelectorAll("circle.chromatogram-point")).toHaveLength(1);
  });

  it("ignores a wheel with no vertical delta at all", () => {
    renderChromatogram();
    const before = state();

    const event = wheel({ deltaY: 0 });

    expect(event.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
  });

  it("holds the retention time under the pointer, wherever the pointer is", () => {
    // Pointer-anchored zoom, unchanged. The button planner's centre anchor is a
    // different gesture and must not be substituted for this one.
    for (const [name, fraction] of [
      ["left", 0],
      ["centre", 0.5],
      ["right", 1],
    ] as const) {
      cleanup();
      renderChromatogram();
      const before = shown();
      const held = before.low + (before.high - before.low) * fraction;

      const event = wheel({ deltaY: IN, clientX: clientXFor(held, before) });

      expect(event.defaultPrevented, name).toBe(true);
      const after = shown();
      expect(after.high - after.low, name).toBeLessThan(before.high - before.low);
      // The retention time the pointer was over is still where the pointer is.
      const heldFraction = (held - after.low) / (after.high - after.low);
      expect(heldFraction, name).toBeCloseTo(fraction, 6);
    }
  });

  it("does not touch a gesture already in flight when the next notch is inert", () => {
    /*
     * A physical wheel keeps turning after the run has run out. The gesture the
     * productive notches started stays exactly as the reducer left it, the
     * settle they scheduled stays authoritative, and the inert notches leave
     * nothing behind -- no epoch, no move, and no claim on the event.
     */
    renderChromatogram();
    let productive = 0;
    for (let step = 0; step < 200; step += 1) {
      const event = wheel({ deltaY: IN });
      if (!event.defaultPrevented) {
        break;
      }
      productive += 1;
    }
    expect(productive).toBeGreaterThan(0);
    const mid = state();
    expect(mid.gesture).not.toBeNull();
    const epoch = mid.gesture?.epoch;

    const inert = wheel({ deltaY: IN });

    expect(inert.defaultPrevented).toBe(false);
    expect(state()).toBe(mid);
    expect(state().gesture?.epoch).toBe(epoch);

    // The settle the productive notches scheduled still commits their range.
    const transient = shown();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(state().gesture).toBeNull();
    expect(renderedDomain(state())).toEqual(transient);
  });

  it("still commits a claimed wheel when it settles", () => {
    renderChromatogram();
    const full = shown();

    wheel({ deltaY: IN });

    expect(state().gesture).not.toBeNull();
    expect(state().committedDomain).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(state().gesture).toBeNull();
    expect(state().committedDomain).not.toBeNull();
    expect(state().committedDomain?.high).toBeLessThan(full.high);
  });

  it("still loses to a selection committed before its settle", () => {
    // PR #72 finding 8, unchanged: the planner decides only whether this wheel
    // would move the axis. Precedence is still the reducer's.
    renderChromatogram();
    const claimed = wheel({ deltaY: IN });
    expect(claimed.defaultPrevented).toBe(true);
    expect(state().gesture).not.toBeNull();

    send({ type: "selection-committed", index: 49, retentionTime: 49 * 0.0125 });
    const afterSelection = state();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(state()).toBe(afterSelection);
  });
});

/*
 * How far the wheel zooms, at the adapter that reads the event.
 *
 * The planner's own tests pin the arithmetic. What only the component can say is
 * that the two numbers a `WheelEvent` actually carries reach it -- that the
 * production listener passes `deltaY` and `deltaMode` through rather than
 * reducing them to a direction on the way, which is exactly what it used to do.
 *
 * Every case still asserts both halves. Whether the viewport moved is the
 * product's behaviour; whether the event was cancelled is who the input belonged
 * to, and R1.3 must not have quietly bought one with the other.
 */
describe("how far the wheel zooms", () => {
  const LINE_MODE = 1;

  /** The whole run, which every span below is measured against. */
  function fullSpan(): number {
    return 49 * 0.0125;
  }

  function span(): number {
    const domain = shown();
    return domain.high - domain.low;
  }

  /** Sends a stream of identical events, the way one gesture arrives. */
  function stream(count: number, deltaY: number): void {
    for (let step = 0; step < count; step += 1) {
      wheel({ deltaY });
    }
  }

  /** Lets the wheel's settle commit whatever the stream asked for. */
  function letItSettle(): void {
    act(() => {
      vi.advanceTimersByTime(500);
    });
  }

  it("zooms further for a larger delta than for a smaller one", () => {
    // The defect in one line: under the old rule these two were the same
    // request, because only the sign of the delta ever reached the viewport.
    renderChromatogram();
    const gentle = wheel({ deltaY: -1 });
    const gentleSpan = span();

    cleanup();
    renderChromatogram();
    const firm = wheel({ deltaY: -100 });
    const firmSpan = span();

    expect(gentle.defaultPrevented).toBe(true);
    expect(firm.defaultPrevented).toBe(true);
    expect(gentleSpan).toBeLessThan(fullSpan());
    expect(firmSpan).toBeLessThan(gentleSpan);
  });

  it("lands in the same place whether one gesture arrives as one event or a hundred", () => {
    /*
     * The invariant that removes event count as a variable, through the real
     * listener: same pointer position, same total travel, two packetings.
     *
     * The tolerance is ordinary double-precision drift over a hundred
     * multiplications and nothing else -- these are the same number computed two
     * ways, not two numbers close enough for a user.
     */
    renderChromatogram();
    wheel({ deltaY: -100 });
    letItSettle();
    const once = shown();

    cleanup();
    renderChromatogram();
    stream(100, -1);
    letItSettle();
    const many = shown();

    const width = once.high - once.low;
    expect(Math.abs(many.low - once.low) / width).toBeLessThan(1e-9);
    expect(Math.abs(many.high - once.high) / width).toBeLessThan(1e-9);
  });

  it("does not slam a touchpad-shaped stream into the narrowest viewport", () => {
    /*
     * The reported defect, reproduced from outside. Eighty small events used to
     * compound as 0.85^80 -- about two millionths of the run, far past the
     * 1/10,000 floor -- so one flick of a precision touchpad arrived at maximum
     * zoom. Their normalized total is now -80 x 0.002 = -0.16.
     */
    renderChromatogram();

    stream(80, -1);
    letItSettle();

    expect(span() / fullSpan()).toBeCloseTo(2 ** -0.16, 6);
    expect(span()).toBeGreaterThan(fullSpan() * 0.5);
    expect(span()).toBeGreaterThan((fullSpan() / 10_000) * 1_000);
  });

  it("reads a line-mode event as the pixels this product says it is worth", () => {
    // A device that reports in lines is not asking for a different zoom, and a
    // viewer that ignored `deltaMode` would treat one line as one pixel.
    renderChromatogram();
    const inLines = wheel({ deltaY: -1, deltaMode: LINE_MODE });
    const fromLines = shown();

    cleanup();
    renderChromatogram();
    wheel({ deltaY: -25 });
    const fromPixels = shown();

    expect(inLines.defaultPrevented).toBe(true);
    expect(fromLines).toEqual(fromPixels);
  });

  it("leaves a unit it cannot read to the browser", () => {
    // Fails open. A mode this code has never heard of could mean anything, and
    // reading it as pixels would turn an ordinary scroll into a wild zoom.
    renderChromatogram();
    const before = state();

    const event = wheel({ deltaY: -100, deltaMode: 3 });

    expect(event.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
    expect(state().gesture).toBeNull();
  });

  it("leaves a delta that is not a number to the browser", () => {
    /*
     * No browser sends this -- `deltaY` is a restricted double, so it cannot
     * even be constructed with one -- and the guard exists because an adapter
     * that turns an event into viewport arithmetic has to be total. Defined onto
     * the event rather than constructed, for that reason.
     */
    renderChromatogram();
    const before = state();
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    Object.defineProperty(event, "deltaY", { value: Number.NaN });

    act(() => {
      plot().dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
  });

  it("reads the same request whether or not ctrl is held", () => {
    /*
     * Some web zoom libraries accelerate wheel input under ctrl, on the theory
     * that it means a trackpad pinch. This viewer assigns the modifier no
     * meaning: that inference is a guess about hardware, and pinch semantics
     * need their own evidence and their own product decision.
     */
    renderChromatogram();
    const plain = wheel({ deltaY: -100 });
    const withoutCtrl = shown();

    cleanup();
    renderChromatogram();
    const held = wheel({ deltaY: -100, ctrlKey: true });
    const withCtrl = shown();

    expect(plain.defaultPrevented).toBe(true);
    expect(held.defaultPrevented).toBe(true);
    expect(withCtrl).toEqual(withoutCtrl);
  });

  it("still refuses an outward delta of any size at full range", () => {
    // Magnitude decides how much is asked for; it never decides whether the
    // viewer owns the event. R1.2's rule, unchanged, at four sizes.
    renderChromatogram();
    const before = state();

    for (const deltaY of [1, 100, 240, 4_000]) {
      const event = wheel({ deltaY });

      expect(event.defaultPrevented, String(deltaY)).toBe(false);
      expect(state(), String(deltaY)).toBe(before);
    }
    expect(state().gesture).toBeNull();
  });

  it("still claims a delta far too small to be a notch, because it moves the axis", () => {
    renderChromatogram();

    const event = wheel({ deltaY: -1 });

    expect(event.defaultPrevented).toBe(true);
    expect(span()).toBeLessThan(fullSpan());
    expect(span()).toBeGreaterThan(fullSpan() * 0.99);
  });
});
