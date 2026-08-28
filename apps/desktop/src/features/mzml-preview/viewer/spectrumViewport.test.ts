import { describe, expect, it } from "vitest";

import type { SpectrumProjection, SpectrumViewportDomain } from "../contracts";
import type { SpectrumViewportEvent, SpectrumViewportState } from "./spectrumViewport";
import {
  activeMzGestureEpoch,
  clampMzDomain,
  initialSpectrumViewportState,
  isFullMzDomain,
  minimumMzSpan,
  mzDomain,
  panMzDomain,
  projectionWindow,
  renderedMzDomain,
  spectrumViewportReducer,
  zoomMzDomain,
} from "./spectrumViewport";

const admitted = (low: number, high: number): SpectrumViewportDomain => ({
  state: "admitted",
  low,
  high,
});

const refused: SpectrumViewportDomain = { state: "refused", reason: "sourceNotOrdered" };

function drawing(low: number, high: number): SpectrumProjection {
  return { low, high, mz: [low, high], intensity: [1, 2], sourcePoints: 2, reduced: false };
}

/** Applies events in order, so a test reads as the sequence it is about. */
function run(
  state: SpectrumViewportState,
  ...events: SpectrumViewportEvent[]
): SpectrumViewportState {
  return events.reduce(spectrumViewportReducer, state);
}

const selectA = (domain = admitted(100, 500)): SpectrumViewportState =>
  run(initialSpectrumViewportState, {
    type: "spectrum-selected",
    spectrumToken: "a",
    domain,
  });

/** Narrows to a committed window and answers the projection it asks for. */
function committedAt(
  state: SpectrumViewportState,
  low: number,
  high: number,
): SpectrumViewportState {
  return run(state, { type: "viewport-step", domain: mzDomain(low, high) });
}

function ready(state: SpectrumViewportState): SpectrumViewportState & { status: "ready" } {
  if (state.status !== "ready") {
    throw new Error(`expected a ready viewport, got ${state.status}`);
  }
  return state;
}

describe("selecting a spectrum", () => {
  it("starts at the spectrum's own full admitted domain", () => {
    const state = ready(selectA());

    expect(state.spectrumToken).toBe("a");
    expect(state.full).toEqual({ low: 100, high: 500 });
    expect(state.committed).toBeNull();
    expect(renderedMzDomain(state)).toEqual({ low: 100, high: 500 });
    expect(state.projection).toEqual({ status: "idle" });
  });

  it("enters an explicit refusal rather than inventing a domain", () => {
    const state = selectA(refused);

    expect(state.status).toBe("refused");
    expect(renderedMzDomain(state)).toBeNull();
    expect(projectionWindow(state)).toBeNull();
  });

  it("does not reset when the same spectrum is delivered again", () => {
    // A re-render is not a navigation. The committed window survives.
    const narrowed = committedAt(selectA(), 200, 300);

    const again = spectrumViewportReducer(narrowed, {
      type: "spectrum-selected",
      spectrumToken: "a",
      domain: admitted(100, 500),
    });

    expect(again).toBe(narrowed);
  });

  it("clears to nothing when no spectrum is selected", () => {
    const state = run(selectA(), { type: "spectrum-cleared" });

    expect(state).toEqual({ status: "none" });
    expect(spectrumViewportReducer(state, { type: "spectrum-cleared" })).toBe(state);
  });
});

describe("a different spectrum is a different viewport context", () => {
  it("resets to the new spectrum's own domain when the two overlap", () => {
    const narrowed = committedAt(selectA(), 200, 300);

    const state = ready(
      run(narrowed, {
        type: "spectrum-selected",
        spectrumToken: "b",
        domain: admitted(150, 600),
      }),
    );

    expect(state.full).toEqual({ low: 150, high: 600 });
    expect(state.committed).toBeNull();
    expect(renderedMzDomain(state)).toEqual({ low: 150, high: 600 });
  });

  it("never carries a window into a spectrum that does not have it", () => {
    // The defect this rule exists for: 400..500 is a real window of A and no
    // part of B, so keeping it would offer a range B cannot answer.
    const narrowed = committedAt(selectA(), 400, 500);

    const state = ready(
      run(narrowed, {
        type: "spectrum-selected",
        spectrumToken: "b",
        domain: admitted(10, 20),
      }),
    );

    expect(state.committed).toBeNull();
    expect(renderedMzDomain(state)).toEqual({ low: 10, high: 20 });
  });

  it("clears the viewport when the next spectrum is refused", () => {
    const narrowed = committedAt(selectA(), 200, 300);

    const state = run(narrowed, {
      type: "spectrum-selected",
      spectrumToken: "b",
      domain: refused,
    });

    expect(state.status).toBe("refused");
    expect(projectionWindow(state)).toBeNull();
  });

  it("gives a viewport back when a refused spectrum is followed by an admitted one", () => {
    const state = ready(
      run(selectA(refused), {
        type: "spectrum-selected",
        spectrumToken: "b",
        domain: admitted(50, 80),
      }),
    );

    expect(state.full).toEqual({ low: 50, high: 80 });
    expect(state.committed).toBeNull();
  });

  it("supersedes a gesture that was active on the previous spectrum", () => {
    const dragging = run(selectA(), { type: "gesture-started", domain: mzDomain(200, 300) });
    const epoch = activeMzGestureEpoch(dragging);
    expect(epoch).not.toBeNull();

    const next = run(dragging, {
      type: "spectrum-selected",
      spectrumToken: "b",
      domain: admitted(100, 500),
    });

    expect(ready(next).gesture).toBeNull();
    // And the old gesture's settle can never commit into the new spectrum.
    expect(run(next, { type: "gesture-settled", epoch: epoch ?? 0 })).toBe(next);
  });

  it("supersedes a projection that was outstanding for the previous spectrum", () => {
    const loading = run(selectA(), { type: "projection-requested" });
    const generation = ready(loading).projection.status === "loading" ? 1 : 0;

    const next = run(loading, {
      type: "spectrum-selected",
      spectrumToken: "b",
      domain: admitted(100, 500),
    });

    expect(ready(next).projection).toEqual({ status: "idle" });
    // The old answer arrives and changes nothing about the new spectrum.
    const late = run(next, {
      type: "projection-succeeded",
      generation,
      projection: drawing(100, 500),
    });
    expect(late).toBe(next);
  });
});

describe("gestures", () => {
  it("holds a transient window without committing it", () => {
    const state = ready(
      run(selectA(), { type: "gesture-started", domain: mzDomain(200, 300) }),
    );

    expect(state.committed).toBeNull();
    expect(renderedMzDomain(state)).toEqual({ low: 200, high: 300 });
    // The projection is asked for the committed window, never the gesture.
    expect(projectionWindow(state)).toEqual({ low: 100, high: 500 });
  });

  it("commits what a settle reached", () => {
    const dragging = run(selectA(), { type: "gesture-started", domain: mzDomain(200, 300) });
    const epoch = activeMzGestureEpoch(dragging) ?? 0;

    const state = ready(run(dragging, { type: "gesture-settled", epoch }));

    expect(state.committed).toEqual({ low: 200, high: 300 });
    expect(state.gesture).toBeNull();
    expect(projectionWindow(state)).toEqual({ low: 200, high: 300 });
  });

  it("moves only the gesture it was tagged for", () => {
    const dragging = run(selectA(), { type: "gesture-started", domain: mzDomain(200, 300) });
    const epoch = activeMzGestureEpoch(dragging) ?? 0;

    expect(
      run(dragging, { type: "gesture-moved", epoch: epoch + 1, domain: mzDomain(0, 1000) }),
    ).toBe(dragging);
  });

  it("treats a settle for a superseded epoch as a no-op by identity", () => {
    const dragging = run(selectA(), { type: "gesture-started", domain: mzDomain(200, 300) });
    const stale = activeMzGestureEpoch(dragging) ?? 0;
    const stepped = run(dragging, { type: "viewport-step", domain: mzDomain(150, 450) });

    // Correctness does not rest on the timer having been cleared in time.
    expect(run(stepped, { type: "gesture-settled", epoch: stale })).toBe(stepped);
    expect(ready(stepped).committed).toEqual({ low: 150, high: 450 });
  });

  it("abandons a cancelled gesture without touching the committed window", () => {
    const narrowed = committedAt(selectA(), 200, 300);
    const dragging = run(narrowed, { type: "gesture-started", domain: mzDomain(100, 500) });
    const epoch = activeMzGestureEpoch(dragging) ?? 0;

    const state = ready(run(dragging, { type: "gesture-cancelled", epoch }));

    expect(state.gesture).toBeNull();
    expect(state.committed).toEqual({ low: 200, high: 300 });
  });
});

describe("committing and resetting", () => {
  it("treats a step covering the whole spectrum as the whole spectrum", () => {
    const state = ready(committedAt(selectA(), 50, 900));

    expect(state.committed).toBeNull();
    expect(isFullMzDomain(state.committed, state.full)).toBe(true);
  });

  it("returns to the whole spectrum on reset", () => {
    const narrowed = committedAt(selectA(), 200, 300);

    const state = ready(run(narrowed, { type: "viewport-reset" }));

    expect(state.committed).toBeNull();
    expect(projectionWindow(state)).toEqual({ low: 100, high: 500 });
  });

  it("is a no-op by identity when nothing would move", () => {
    const full = selectA();

    expect(run(full, { type: "viewport-reset" })).toBe(full);
  });
});

describe("the projection lifecycle", () => {
  it("enters loading for the committed window", () => {
    const state = ready(run(committedAt(selectA(), 200, 300), { type: "projection-requested" }));

    expect(state.projection).toEqual({
      status: "loading",
      generation: 1,
      window: { low: 200, high: 300 },
    });
  });

  it("shows a drawing that answers the current request", () => {
    const loading = run(selectA(), { type: "projection-requested" });

    const state = ready(
      run(loading, {
        type: "projection-succeeded",
        generation: 1,
        projection: drawing(100, 500),
      }),
    );

    expect(state.projection.status).toBe("ready");
    expect(state.projection.status === "ready" && state.projection.projection.mz).toEqual([
      100, 500,
    ]);
  });

  it("treats an empty drawing as a success rather than a failure", () => {
    // A window of a spectrum may truthfully hold no reported point.
    const loading = run(committedAt(selectA(), 200, 300), { type: "projection-requested" });
    const empty: SpectrumProjection = {
      low: 200,
      high: 300,
      mz: [],
      intensity: [],
      sourcePoints: 0,
      reduced: false,
    };

    const state = ready(
      run(loading, { type: "projection-succeeded", generation: 1, projection: empty }),
    );

    expect(state.projection.status).toBe("ready");
    expect(state.projection.status === "ready" && state.projection.projection.mz).toEqual([]);
  });

  it("keeps the committed window when a current request fails", () => {
    const loading = run(committedAt(selectA(), 200, 300), { type: "projection-requested" });

    const state = ready(
      run(loading, { type: "projection-failed", generation: 1, retryable: true }),
    );

    expect(state.projection).toEqual({
      status: "failed",
      generation: 1,
      window: { low: 200, high: 300 },
      retryable: true,
    });
    // The failure is about the drawing. The range authority is untouched.
    expect(state.committed).toEqual({ low: 200, high: 300 });
    expect(projectionWindow(state)).toEqual({ low: 200, high: 300 });
  });

  it("carries retryability rather than assuming it", () => {
    const loading = run(selectA(), { type: "projection-requested" });

    const state = ready(
      run(loading, { type: "projection-failed", generation: 1, retryable: false }),
    );

    expect(state.projection.status === "failed" && state.projection.retryable).toBe(false);
  });

  it("retries as a new generation that the old answer cannot satisfy", () => {
    const failed = run(
      run(selectA(), { type: "projection-requested" }),
      { type: "projection-failed", generation: 1, retryable: true },
    );

    const retried = run(failed, { type: "projection-requested" });
    expect(ready(retried).projection).toEqual({
      status: "loading",
      generation: 2,
      window: { low: 100, high: 500 },
    });
    // The first request's answer is no longer anybody's.
    expect(
      run(retried, {
        type: "projection-succeeded",
        generation: 1,
        projection: drawing(100, 500),
      }),
    ).toBe(retried);
  });

  it("discards a stale success", () => {
    const first = run(selectA(), { type: "projection-requested" });
    const second = run(committedAt(first, 200, 300), { type: "projection-requested" });

    const late = run(second, {
      type: "projection-succeeded",
      generation: 1,
      projection: drawing(100, 500),
    });

    expect(late).toBe(second);
  });

  it("discards a stale failure without surfacing it", () => {
    const first = run(selectA(), { type: "projection-requested" });
    const second = run(committedAt(first, 200, 300), { type: "projection-requested" });

    const late = run(second, { type: "projection-failed", generation: 1, retryable: true });

    expect(late).toBe(second);
    expect(ready(second).projection.status).toBe("loading");
  });

  it("drops the previous drawing when the window moves", () => {
    // The regression this prevents: one range's data drawn beneath another
    // range's axes.
    const shown = run(
      run(selectA(), { type: "projection-requested" }),
      { type: "projection-succeeded", generation: 1, projection: drawing(100, 500) },
    );

    const moved = ready(committedAt(shown, 200, 300));

    expect(moved.projection).toEqual({ status: "idle" });
  });

  it("survives two commits before the first answer returns", () => {
    const first = run(committedAt(selectA(), 200, 300), { type: "projection-requested" });
    const second = run(committedAt(first, 250, 280), { type: "projection-requested" });

    expect(ready(second).projection).toEqual({
      status: "loading",
      generation: 2,
      window: { low: 250, high: 280 },
    });
    // Both earlier answers are stale, whichever order they arrive in.
    const late = run(
      second,
      { type: "projection-succeeded", generation: 1, projection: drawing(200, 300) },
      { type: "projection-failed", generation: 1, retryable: true },
    );
    expect(late).toBe(second);
  });

  it("ignores every viewport event while a spectrum is refused", () => {
    const state = selectA(refused);

    for (const event of [
      { type: "gesture-started", domain: mzDomain(1, 2) },
      { type: "viewport-step", domain: mzDomain(1, 2) },
      { type: "viewport-reset" },
      { type: "projection-requested" },
    ] satisfies SpectrumViewportEvent[]) {
      expect(spectrumViewportReducer(state, event)).toBe(state);
    }
  });
});

describe("the m/z arithmetic", () => {
  const full = mzDomain(100, 500);

  it("keeps every window inside the spectrum", () => {
    expect(clampMzDomain(mzDomain(0, 1000), full)).toEqual({ low: 100, high: 500 });
    expect(clampMzDomain(mzDomain(50, 200), full)).toEqual({ low: 100, high: 250 });
    expect(clampMzDomain(mzDomain(400, 900), full)).toEqual({ low: 100, high: 500 });
  });

  it("answers with an interval for input that is not one", () => {
    for (const input of [
      mzDomain(Number.NaN, 200),
      mzDomain(200, 100),
      mzDomain(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    ]) {
      const clamped = clampMzDomain(input, full);
      expect(Number.isFinite(clamped.low)).toBe(true);
      expect(Number.isFinite(clamped.high)).toBe(true);
      expect(clamped.high).toBeGreaterThanOrEqual(clamped.low);
      expect(clamped.low).toBeGreaterThanOrEqual(full.low);
      expect(clamped.high).toBeLessThanOrEqual(full.high);
    }
  });

  it("holds both ends to the spectrum rather than trusting the arithmetic", () => {
    // The window a projection asks Rust for is refused if it reaches outside
    // the source, so a flush-right clamp may not round past the end.
    const source = mzDomain(0.0125, 453.9875);
    for (const width of [1, 7, 99.9, 453.975]) {
      const clamped = clampMzDomain(mzDomain(1e6, 1e6 + width), source);
      expect(clamped.high).toBeLessThanOrEqual(source.high);
      expect(clamped.low).toBeGreaterThanOrEqual(source.low);
    }
  });

  it("has no subrange for a spectrum whose points share one m/z", () => {
    const flat = mzDomain(342.5, 342.5);

    expect(minimumMzSpan(flat)).toBe(0);
    expect(clampMzDomain(mzDomain(0, 1000), flat)).toEqual({ low: 342.5, high: 342.5 });
    expect(zoomMzDomain(flat, flat, 0.5, 0.5)).toEqual({ low: 342.5, high: 342.5 });
  });

  it("keeps the anchored m/z under the anchor when zooming", () => {
    const zoomed = zoomMzDomain(full, full, 0.5, 0.5);

    expect(zoomed.high - zoomed.low).toBeCloseTo(200, 9);
    expect((zoomed.low + zoomed.high) / 2).toBeCloseTo(300, 9);
  });

  it("never narrows below the minimum span", () => {
    let window = full;
    for (let step = 0; step < 200; step += 1) {
      window = zoomMzDomain(window, full, 0.5, 0.5);
    }

    expect(window.high - window.low).toBeGreaterThanOrEqual(minimumMzSpan(full));
  });

  it("stops a pan at the edge rather than shortening it", () => {
    const window = mzDomain(400, 480);

    const panned = panMzDomain(window, full, 1);

    expect(panned.high - panned.low).toBeCloseTo(80, 9);
    expect(panned.high).toBeLessThanOrEqual(full.high);
  });
});
