import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Chromatogram } from "./Chromatogram";
import type { TraceVisibility } from "./Chromatogram";
import { buildChromatogramModel } from "./chromatogramModel";
import type { ChromatogramModel, RetentionTimeDomain } from "./chromatogramModel";
import type { SpectrumRow } from "./contracts";
import { buildRows } from "../../test/previewFixtures";

const BOTH: TraceVisibility = { tic: true, bpc: true };
const TIC_ONLY: TraceVisibility = { tic: true, bpc: false };

/**
 * A plot element with a real box, because jsdom gives every element a zero one.
 *
 * Every pointer interaction here converts a client x into a retention time
 * through the element's rectangle, so without this the whole interaction
 * surface would resolve to the same coordinate and every test would pass for
 * the wrong reason.
 */
function givePlotABox(width = 1_000): void {
  const plot = screen.getByRole("img", { name: "Chromatogram" });
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 200,
    width,
    height: 200,
    toJSON: () => ({}),
  } as DOMRect);
}

/** Where a retention time falls, in client pixels, for a 1000px-wide plot. */
function clientXFor(retentionTime: number, domain: RetentionTimeDomain): number {
  const fraction = (retentionTime - domain.low) / (domain.high - domain.low);
  // The plot's own padding, in viewBox units, which are 1:1 with pixels here.
  return 64 + fraction * (1_000 - 64 - 12);
}

interface Harness {
  readonly onSelect: ReturnType<typeof vi.fn>;
  readonly onToggleTrace: ReturnType<typeof vi.fn>;
  readonly onVisibleDomainChange: ReturnType<typeof vi.fn>;
  readonly onSelectPrevious: ReturnType<typeof vi.fn>;
  readonly onSelectNext: ReturnType<typeof vi.fn>;
  readonly rerender: (overrides?: Partial<Parameters<typeof Chromatogram>[0]>) => void;
}

function renderChromatogram(
  overrides: Partial<Parameters<typeof Chromatogram>[0]> = {},
): Harness {
  const onSelect = vi.fn();
  const onToggleTrace = vi.fn();
  const onVisibleDomainChange = vi.fn();
  const onSelectPrevious = vi.fn();
  const onSelectNext = vi.fn();
  const base = {
    model: modelOf(buildRows(50)),
    traces: TIC_ONLY,
    onToggleTrace,
    visibleDomain: null,
    onVisibleDomainChange,
    selectedIndex: null,
    onSelect,
    onSelectPrevious,
    onSelectNext,
    canSelectPrevious: false,
    canSelectNext: true,
  } satisfies Parameters<typeof Chromatogram>[0];
  const view = render(<Chromatogram {...base} {...overrides} />);
  return {
    onSelect,
    onToggleTrace,
    onVisibleDomainChange,
    onSelectPrevious,
    onSelectNext,
    rerender: (next = {}) => {
      view.rerender(<Chromatogram {...base} {...overrides} {...next} />);
    },
  };
}

function modelOf(rows: readonly SpectrumRow[], truncated = false): ChromatogramModel {
  return buildChromatogramModel({
    rows,
    totalRowCount: truncated ? rows.length * 10 : rows.length,
    truncated,
  });
}

function plot(): HTMLElement {
  return screen.getByRole("img", { name: "Chromatogram" });
}

function tracePaths(): NodeListOf<Element> {
  return document.querySelectorAll("path.chromatogram-trace");
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe("what the chromatogram draws", () => {
  it("draws TIC alone to begin with", () => {
    renderChromatogram();

    expect(screen.getByRole("checkbox", { name: /TIC/u })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /BPC/u })).not.toBeChecked();
    expect(tracePaths()).toHaveLength(1);
    expect(tracePaths()[0]).toHaveClass("chromatogram-trace-tic");
  });

  it("draws both traces when both are asked for", () => {
    renderChromatogram({ traces: BOTH });

    expect(tracePaths()).toHaveLength(2);
    // Told apart by more than colour: one is solid and the other is dashed.
    expect(tracePaths()[0]).not.toHaveAttribute("stroke-dasharray");
    expect(tracePaths()[1]).toHaveAttribute("stroke-dasharray", "7 4");
  });

  it("draws nothing but keeps the plot when both traces are hidden", () => {
    // An intentional empty state rather than a broken blank plot: the axes and
    // every control stay, so turning one back on is one click away.
    renderChromatogram({ traces: { tic: false, bpc: false } });

    expect(tracePaths()).toHaveLength(0);
    expect(plot()).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /TIC/u })).not.toBeChecked();
  });

  it("hands a trace toggle back to the caller rather than deciding itself", () => {
    const { onToggleTrace } = renderChromatogram();

    fireEvent.click(screen.getByRole("checkbox", { name: /BPC/u }));

    expect(onToggleTrace.mock.calls).toEqual([["bpc"]]);
  });

  it("draws one path per trace rather than one node per scan", () => {
    // The representative acquisition has 36,319 scans. A node each would be a
    // document the browser cannot lay out.
    renderChromatogram({ model: modelOf(buildRows(20_000)), traces: BOTH });

    expect(tracePaths()).toHaveLength(2);
    expect(document.querySelectorAll("svg.chromatogram-svg circle")).toHaveLength(0);
    // Bounded whatever the run's size: the vertices are a screen budget.
    for (const path of tracePaths()) {
      const commands = (path.getAttribute("d") ?? "").split(/[ML]/u).length;
      expect(commands).toBeLessThan(4_000);
    }
  });

  it("says what the traces are made of, and what they are not", () => {
    renderChromatogram();

    expect(screen.getByText(/Per-scan values from the loaded spectrum table/u)).toBeVisible();
    expect(screen.getByText(/Not a stored chromatogram record\./u)).toBeVisible();
  });

  it("says the retention time and intensity units are not reported", () => {
    renderChromatogram();

    expect(
      screen.getByText(/Retention time — unit not reported · Intensity — unit not reported/u),
    ).toBeVisible();
  });

  it("refuses to draw a truncated table, and says why", () => {
    renderChromatogram({ model: modelOf(buildRows(20), true) });

    expect(screen.getByText("TIC and BPC are unavailable for this preview.")).toBeVisible();
    expect(screen.getByText(/did not load the complete table/u)).toBeVisible();
    expect(screen.queryByRole("img", { name: "Chromatogram" })).toBeNull();
    expect(tracePaths()).toHaveLength(0);
  });

  it("refuses a retention-time unit it cannot name, and says why without blaming the file", () => {
    const claimsAUnit = buildRows(20).map((row, index) =>
      index === 7 ? { ...row, retentionTime: { value: row.retentionTime.value, unitKnown: true } } : row,
    );
    renderChromatogram({ model: modelOf(claimsAUnit) });

    expect(screen.getByText("TIC and BPC are unavailable for this preview.")).toBeVisible();
    expect(screen.getByText(/cannot identify\s+precisely/u)).toBeVisible();
    // Not the file's fault, and not a claim that the unit is unknown when the
    // wire says one was reported.
    expect(screen.queryByText(/malformed|corrupt|invalid file/iu)).toBeNull();
    expect(tracePaths()).toHaveLength(0);
    expect(screen.queryByRole("img", { name: "Chromatogram" })).toBeNull();
  });

  it("says a run with no spectra has nothing to draw", () => {
    renderChromatogram({ model: modelOf([]) });

    expect(screen.getByText("This run has no spectra.")).toBeVisible();
  });
});

describe("hovering", () => {
  it("shows the scan under the pointer without selecting it", () => {
    // Hover is transient. It must not commit a selection, because a selection
    // is one ProteoWizard process, and a pointer crossing the plot would be
    // hundreds of them.
    const { onSelect } = renderChromatogram();
    givePlotABox();
    const domain = { low: 0, high: 49 * 0.0125 };

    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * 0.0125, domain) });
    act(() => {
      vi.advanceTimersByTime(32);
    });

    expect(screen.getByText(/Hovering index 10, scan 11, MS2/u)).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports both per-scan values whichever trace is drawn", () => {
    // The values belong to the scan rather than to the trace, and a reader
    // comparing them should not have to toggle a trace to see one.
    renderChromatogram();
    givePlotABox();

    fireEvent.pointerMove(plot(), { clientX: 500 });
    act(() => {
      vi.advanceTimersByTime(32);
    });

    // The fixture's two series are far apart on purpose -- TIC in the ten
    // thousands, BPC in the thousands -- so a readout that confused them could
    // not match.
    expect(screen.getByText(/TIC 100\d\d, BPC 10\d\d\./u)).toBeVisible();
  });

  it("stops reporting a scan once the pointer leaves", () => {
    renderChromatogram();
    givePlotABox();

    fireEvent.pointerMove(plot(), { clientX: 500 });
    act(() => {
      vi.advanceTimersByTime(32);
    });
    expect(screen.getByText(/^Hovering/u)).toBeVisible();

    fireEvent.pointerLeave(plot());

    expect(screen.queryByText(/^Hovering/u)).toBeNull();
  });
});

describe("selecting a scan", () => {
  it("commits the exact nearest scan, once", () => {
    const { onSelect } = renderChromatogram();
    givePlotABox();
    const domain = { low: 0, high: 49 * 0.0125 };

    const at = clientXFor(30 * 0.0125, domain);
    fireEvent.pointerDown(plot(), { clientX: at, button: 0, pointerId: 1 });
    fireEvent.pointerUp(plot(), { clientX: at, button: 0, pointerId: 1 });

    expect(onSelect.mock.calls).toEqual([[30]]);
  });

  it("resolves a click against every scan rather than the drawn vertices", () => {
    // The drawing has far fewer vertices than the run has scans. Resolving a
    // click there would silently select a neighbour, and more often the larger
    // the run.
    const rows = buildRows(20_000);
    const { onSelect } = renderChromatogram({ model: modelOf(rows) });
    givePlotABox();
    const domain = { low: 0, high: 19_999 * 0.0125 };

    const target = 12_345;
    const at = clientXFor(target * 0.0125, domain);
    fireEvent.pointerDown(plot(), { clientX: at, button: 0, pointerId: 1 });
    fireEvent.pointerUp(plot(), { clientX: at, button: 0, pointerId: 1 });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBe(target);
  });

  it("does not select when the pointer travelled, because that was a pan", () => {
    const { onSelect, onVisibleDomainChange } = renderChromatogram();
    givePlotABox();

    fireEvent.pointerDown(plot(), { clientX: 500, button: 0, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(plot(), { clientX: 400, button: 0, pointerId: 1 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onVisibleDomainChange).toHaveBeenCalled();
  });

  it("still selects when the pointer only trembled", () => {
    // A press that has not travelled is a click. Without a threshold a
    // one-pixel tremor between press and release would pan instead.
    const { onSelect } = renderChromatogram();
    givePlotABox();

    fireEvent.pointerDown(plot(), { clientX: 500, button: 0, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 502, pointerId: 1 });
    fireEvent.pointerUp(plot(), { clientX: 502, button: 0, pointerId: 1 });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("the selected marker", () => {
  it("draws a rule and a glyph for the selected scan", () => {
    renderChromatogram({ selectedIndex: 20 });

    const marker = document.querySelector("g.chromatogram-selected");
    expect(marker).not.toBeNull();
    // Not colour alone: a rule the width of the plot and a glyph on it.
    expect(marker?.querySelector("line")).not.toBeNull();
    expect(marker?.querySelector("rect")).not.toBeNull();
  });

  it("names the selected scan in words as well", () => {
    renderChromatogram({ selectedIndex: 20 });

    expect(screen.getByText(/Selected index 20, scan 21, MS1/u)).toBeVisible();
  });

  it("draws no marker while nothing is selected", () => {
    renderChromatogram();

    expect(document.querySelector("g.chromatogram-selected")).toBeNull();
    expect(screen.getByText(/No scan selected/u)).toBeVisible();
  });
});

describe("zoom, pan and reset", () => {
  const full = { low: 0, high: 49 * 0.0125 };

  it("zooms in on a wheel notch and publishes the range it reached", async () => {
    const { onVisibleDomainChange } = renderChromatogram();
    givePlotABox();

    fireEvent.wheel(plot(), { deltaY: -100, clientX: 500 });
    vi.advanceTimersByTime(200);

    await waitFor(() => {
      expect(onVisibleDomainChange).toHaveBeenCalled();
    });
    const domain = onVisibleDomainChange.mock.calls.at(-1)?.[0] as RetentionTimeDomain;
    expect(domain.high - domain.low).toBeLessThan(full.high - full.low);
  });

  it("publishes one semantic range for a whole gesture rather than one per event", async () => {
    // Pointer coordinates never reach the workspace. What it learns is where
    // the gesture arrived, so a pan does not re-render the scan table once a
    // frame.
    const { onVisibleDomainChange } = renderChromatogram();
    givePlotABox();

    for (let notch = 0; notch < 6; notch += 1) {
      fireEvent.wheel(plot(), { deltaY: -100, clientX: 500 });
    }
    expect(onVisibleDomainChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    await waitFor(() => {
      expect(onVisibleDomainChange).toHaveBeenCalledTimes(1);
    });
  });

  it("pans without changing the span it was given", () => {
    const visible = { low: 0.1, high: 0.2 };
    const { onVisibleDomainChange } = renderChromatogram({ visibleDomain: visible });
    givePlotABox();

    fireEvent.pointerDown(plot(), { clientX: 600, button: 0, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(plot(), { clientX: 500, button: 0, pointerId: 1 });

    const domain = onVisibleDomainChange.mock.calls.at(-1)?.[0] as RetentionTimeDomain;
    expect(domain.high - domain.low).toBeCloseTo(0.1, 6);
    expect(domain.low).toBeGreaterThan(visible.low);
  });

  it("resets to the full run, which it reports as no viewport at all", () => {
    const { onVisibleDomainChange } = renderChromatogram({ visibleDomain: { low: 0.1, high: 0.2 } });

    fireEvent.click(screen.getByRole("button", { name: "Reset range" }));

    // `null` rather than the full domain spelled out: "the whole run" is a
    // state, and a range that happens to equal it is the same state.
    expect(onVisibleDomainChange.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("offers no reset while the whole run is already shown", () => {
    renderChromatogram();

    expect(screen.getByRole("button", { name: "Reset range" })).toBeDisabled();
    expect(screen.getByText(/\(full range\)/u)).toBeVisible();
  });

  it("clamps a zoom out at the whole run", () => {
    // Driven the way the workspace drives it: the plot is told what range to
    // show, so each step has to be fed back before the next one.
    const { onVisibleDomainChange, rerender } = renderChromatogram({
      visibleDomain: { low: 0.1, high: 0.2 },
    });

    for (let step = 0; step < 6; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
      rerender({ visibleDomain: onVisibleDomainChange.mock.calls.at(-1)?.[0] as RetentionTimeDomain | null });
    }

    expect(onVisibleDomainChange.mock.calls.at(-1)?.[0]).toBeNull();
    expect(screen.getByRole("button", { name: "Reset range" })).toBeDisabled();
  });

  it("zooms, pans and resets from the keyboard", () => {
    const { onVisibleDomainChange } = renderChromatogram();
    plot().focus();

    fireEvent.keyDown(plot(), { key: "+" });
    const zoomed = onVisibleDomainChange.mock.calls.at(-1)?.[0] as RetentionTimeDomain;
    expect(zoomed.high - zoomed.low).toBeLessThan(full.high - full.low);

    onVisibleDomainChange.mockClear();
    fireEvent.keyDown(plot(), { key: "Home" });
    expect(onVisibleDomainChange.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("pans left and right from the keyboard, keeping the span", () => {
    const { onVisibleDomainChange } = renderChromatogram({
      visibleDomain: { low: 0.2, high: 0.3 },
    });

    fireEvent.keyDown(plot(), { key: "ArrowRight" });
    const right = onVisibleDomainChange.mock.calls.at(-1)?.[0] as RetentionTimeDomain;
    expect(right.low).toBeGreaterThan(0.2);
    expect(right.high - right.low).toBeCloseTo(0.1, 6);

    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    const left = onVisibleDomainChange.mock.calls.at(-1)?.[0] as RetentionTimeDomain;
    expect(left.low).toBeLessThan(0.2);
  });

  it("is reachable by keyboard for every action a pointer can do", () => {
    renderChromatogram();

    expect(plot()).toHaveAttribute("tabindex", "0");
    for (const name of ["Zoom in", "Zoom out", "Reset range"]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
  });
});

describe("revealing a selection that is off screen", () => {
  it("pans the least it can and keeps the span the user chose", async () => {
    const visible = { low: 0, high: 0.05 };
    const { onVisibleDomainChange, rerender } = renderChromatogram({ visibleDomain: visible });
    onVisibleDomainChange.mockClear();

    // A selection from somewhere else: the table, or Previous/Next.
    rerender({ selectedIndex: 45 });

    await waitFor(() => {
      expect(onVisibleDomainChange).toHaveBeenCalled();
    });
    const domain = onVisibleDomainChange.mock.calls.at(-1)?.[0] as RetentionTimeDomain;
    expect(domain).not.toBeNull();
    expect(domain.high - domain.low).toBeCloseTo(0.05, 6);
    expect(45 * 0.0125).toBeGreaterThanOrEqual(domain.low);
    expect(45 * 0.0125).toBeLessThanOrEqual(domain.high);
  });

  it("leaves the viewport alone when the selection is already inside it", () => {
    const { onVisibleDomainChange, rerender } = renderChromatogram({
      visibleDomain: { low: 0, high: 0.2 },
    });
    onVisibleDomainChange.mockClear();

    rerender({ selectedIndex: 4 });

    expect(onVisibleDomainChange).not.toHaveBeenCalled();
  });

  it("does nothing at full range, where every scan is already shown", () => {
    const { onVisibleDomainChange, rerender } = renderChromatogram({ visibleDomain: null });
    onVisibleDomainChange.mockClear();

    rerender({ selectedIndex: 45 });

    expect(onVisibleDomainChange).not.toHaveBeenCalled();
  });
});

describe("previous and next scan", () => {
  it("hands each step back to the caller", () => {
    const { onSelectPrevious, onSelectNext } = renderChromatogram({
      canSelectPrevious: true,
      canSelectNext: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Next scan" }));

    expect(onSelectPrevious).toHaveBeenCalledOnce();
    expect(onSelectNext).toHaveBeenCalledOnce();
  });

  it("closes each step honestly at the end of the table", () => {
    renderChromatogram({ canSelectPrevious: false, canSelectNext: true });

    expect(screen.getByRole("button", { name: "Previous scan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next scan" })).toBeEnabled();
  });
});
