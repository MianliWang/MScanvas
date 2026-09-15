import { describe, expect, it } from "vitest";
import { initialViewerInteractionState, renderedDomain, viewerInteractionReducer, type ViewerEvent } from "./interactionState";
import { initialSpectrumViewportState, mzDomain, projectionWindow, spectrumViewportReducer, type MzDomain, type SpectrumViewportEvent } from "./spectrumViewport";
import type { RetentionTimeDomain } from "./scanModel";
import { validateRangeDraft } from "./rangeDraft";

const rtLoaded = () => viewerInteractionReducer(initialViewerInteractionState, { type: "preview-loaded", fullDomain: { low: 0, high: 100 } });
const mzLoaded = () => spectrumViewportReducer(initialSpectrumViewportState, {
  type: "spectrum-selected", spectrumToken: "retained-source", domain: { state: "admitted", low: 100, high: 500 },
});

describe("range proposal authority", () => {
  it("keeps RT drawing and pending separate from displayed and export ranges, then confirms once", () => {
    const committed = viewerInteractionReducer(rtLoaded(), { type: "viewport-step", domain: { low: 10, high: 90 } });
    const drawing = viewerInteractionReducer(committed, { type: "range-started", domain: { low: 30, high: 60 } });
    const transaction = drawing.rangeSelection!.transaction;
    expect(drawing.rangeSelection?.phase).toBe("drawing");
    expect(drawing.committedDomain).toBe(committed.committedDomain);
    expect(renderedDomain(drawing)).toBe(committed.committedDomain);
    expect(viewerInteractionReducer(drawing, { type: "range-confirmed", proposal: drawing.rangeSelection! })).toBe(drawing);
    const pending = viewerInteractionReducer(drawing, { type: "range-released", transaction });
    expect(pending.rangeSelection?.phase).toBe("pending");
    expect(renderedDomain(pending)).toBe(committed.committedDomain);
    const proposal = pending.rangeSelection!;
    const confirmed = viewerInteractionReducer(pending, { type: "range-confirmed", proposal });
    expect(confirmed.committedDomain).toEqual({ low: 30, high: 60 });
    expect(confirmed.rangeSelection).toBeNull();
    expect(viewerInteractionReducer(confirmed, { type: "range-confirmed", proposal })).toBe(confirmed);
    expect(viewerInteractionReducer(confirmed, { type: "range-released", transaction })).toBe(confirmed);
  });

  it("keeps the m/z projection request at the committed window until successful confirmation", () => {
    const initial = mzLoaded();
    const drawing = spectrumViewportReducer(initial, { type: "range-started", domain: mzDomain(200, 300) });
    if (drawing.status !== "ready") throw new Error("Expected admitted source");
    const pending = spectrumViewportReducer(drawing, { type: "range-released", transaction: drawing.rangeSelection!.transaction });
    if (pending.status !== "ready") throw new Error("Expected pending source");
    expect(projectionWindow(drawing)).toEqual(mzDomain(100, 500));
    expect(projectionWindow(pending)).toEqual(mzDomain(100, 500));
    expect(pending.nextGeneration).toBe(initial.nextGeneration);
    const confirmed = spectrumViewportReducer(pending, { type: "range-confirmed", proposal: pending.rangeSelection! });
    expect(projectionWindow(confirmed)).toEqual(mzDomain(200, 300));
    expect(spectrumViewportReducer(confirmed, { type: "range-confirmed", proposal: pending.rangeSelection! })).toBe(confirmed);
  });

  it.each<ViewerEvent>([
    { type: "selection-committed", index: 7, retentionTime: 50 },
    { type: "preview-loaded", fullDomain: { low: 0, high: 100 } },
    { type: "preview-closed" },
    { type: "viewport-step", domain: { low: 20, high: 80 } },
    { type: "viewport-reset" },
  ])("rejects late RT release and confirmation after $type", event => {
    const selected = viewerInteractionReducer(rtLoaded(), { type: "selection-committed", index: 7, retentionTime: 50 });
    const drawing = viewerInteractionReducer(selected, { type: "range-started", domain: { low: 30, high: 60 } });
    const transaction = drawing.rangeSelection!.transaction;
    const pending = viewerInteractionReducer(drawing, { type: "range-released", transaction });
    const superseded = viewerInteractionReducer(pending, event);
    expect(superseded.rangeSelection).toBeNull();
    expect(viewerInteractionReducer(superseded, { type: "range-released", transaction })).toBe(superseded);
    expect(viewerInteractionReducer(superseded, { type: "range-confirmed", proposal: pending.rangeSelection! })).toBe(superseded);
  });

  it.each<SpectrumViewportEvent>([
    { type: "selection-changed", revision: 1 },
    { type: "spectrum-selected", spectrumToken: "replacement", domain: { state: "admitted", low: 100, high: 500 } },
    { type: "spectrum-cleared" },
    { type: "viewport-step", domain: mzDomain(150, 350) },
    { type: "viewport-reset" },
  ])("rejects late m/z work after $type", event => {
    const drawing = spectrumViewportReducer(mzLoaded(), { type: "range-started", domain: mzDomain(200, 300) });
    if (drawing.status !== "ready") throw new Error("Expected admitted source");
    const transaction = drawing.rangeSelection!.transaction;
    const pending = spectrumViewportReducer(drawing, { type: "range-released", transaction });
    if (pending.status !== "ready") throw new Error("Expected admitted source");
    const superseded = spectrumViewportReducer(pending, event);
    expect(spectrumViewportReducer(superseded, { type: "range-released", transaction })).toBe(superseded);
    expect(spectrumViewportReducer(superseded, { type: "range-confirmed", proposal: pending.rangeSelection! })).toBe(superseded);
  });

  it("matches the complete transaction and exact pending source interval", () => {
    const drawing = viewerInteractionReducer(rtLoaded(), { type: "range-started", domain: { low: 20, high: 60 } });
    const pending = viewerInteractionReducer(drawing, { type: "range-released", transaction: drawing.rangeSelection!.transaction });
    const proposal = pending.rangeSelection!;
    for (const transaction of [
      { ...proposal.transaction, epoch: proposal.transaction.epoch + 1 },
      { ...proposal.transaction, source: "another-source" },
      { ...proposal.transaction, selectionRevision: proposal.transaction.selectionRevision + 1 },
      { ...proposal.transaction, committed: { low: 5, high: 95 } },
    ]) expect(viewerInteractionReducer(pending, { type: "range-confirmed", proposal: { ...proposal, transaction } })).toBe(pending);
    expect(viewerInteractionReducer(pending, { type: "range-confirmed", proposal: { ...proposal, domain: { low: 21, high: 60 } } })).toBe(pending);
  });

  it("abandons drawing but preserves a settled band on focus or layout loss", () => {
    const drawing = viewerInteractionReducer(rtLoaded(), { type: "range-started", domain: { low: 20, high: 60 } });
    expect(viewerInteractionReducer(drawing, { type: "input-abandoned" }).rangeSelection).toBeNull();
    const pending = viewerInteractionReducer(drawing, { type: "range-released", transaction: drawing.rangeSelection!.transaction });
    expect(viewerInteractionReducer(pending, { type: "input-abandoned" })).toBe(pending);
    const cancelled = viewerInteractionReducer(pending, { type: "range-cancelled", transaction: pending.rangeSelection!.transaction });
    expect(cancelled.committedDomain).toBeNull();
    expect(cancelled.rangeSelection).toBeNull();
  });

  it.each([{ low: 1, high: 1 }, { low: 3, high: 2 }, { low: NaN, high: 2 }, { low: 1, high: Infinity }])("refuses invalid RT and m/z proposals %s", domain => {
    const rt = rtLoaded(); const mz = mzLoaded();
    expect(viewerInteractionReducer(rt, { type: "range-started", domain })).toBe(rt);
    expect(spectrumViewportReducer(mz, { type: "range-started", domain: mzDomain(domain.low, domain.high) })).toBe(mz);
  });

  it("has distinct axis types in both directions", () => {
    const rt: RetentionTimeDomain = { low: 1, high: 2 };
    const mz: MzDomain = mzDomain(1, 2);
    // @ts-expect-error Retention time cannot enter the m/z reducer.
    const wrongMz: MzDomain = rt;
    // @ts-expect-error m/z cannot enter the retention-time reducer.
    const wrongRt: RetentionTimeDomain = mz;
    expect([wrongMz, wrongRt]).toHaveLength(2);
  });
});

describe("raw numeric range grammar", () => {
  it("retains blank versus zero and finite decimal/exponent inputs", () => {
    expect(validateRangeDraft("", "10", { low: 0, high: 100 })).toEqual({ valid: false, reason: "rangeBlank" });
    expect(validateRangeDraft("0", "1e1", { low: 0, high: 100 })).toEqual({ valid: true, low: 0, high: 10 });
    expect(validateRangeDraft(".5", "+2.5e1", { low: 0, high: 100 })).toEqual({ valid: true, low: .5, high: 25 });
  });
  it.each(["1,000", "NaN", "Infinity", "0x10", "1e999", "一", "1 0"])("refuses %s without locale reparsing", raw => {
    expect(validateRangeDraft(raw, "100", { low: 0, high: 1000 })).toEqual({ valid: false, reason: "rangeInvalid" });
  });
});
