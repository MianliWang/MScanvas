/**
 * What the transport adds, and what it must never add.
 *
 * The reducer's own behaviour is settled in `interactionState.test.ts`. What is
 * left is the property the adapters depend on and that React's `useReducer`
 * cannot provide: a dispatch that answers with the state it produced, so a
 * wheel listener can tag its debounced settle with the epoch the reducer just
 * assigned instead of mirroring a counter of its own.
 *
 * And the property that makes one authority one authority: the state a render
 * reads and the state a handler between renders reads are the same object.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { activeGestureEpoch, renderedDomain } from "./interactionState";
import { useViewerInteraction } from "./useViewerInteraction";

const FULL = { low: 0, high: 100 };

describe("the viewer interaction controller", () => {
  it("answers a dispatch with the state the reducer produced", () => {
    const { result } = renderHook(() => useViewerInteraction());

    let started: number | null = null;
    act(() => {
      result.current.dispatch({ type: "preview-loaded", fullDomain: FULL });
      started = activeGestureEpoch(
        result.current.dispatch({ type: "gesture-started", domain: { low: 10, high: 20 } }),
      );
    });

    // Read out of the reply rather than out of a later render, which is the
    // whole reason this hook exists.
    expect(started).not.toBeNull();
    expect(activeGestureEpoch(result.current.state)).toBe(started);
  });

  it("never lets the rendered state and the imperative state disagree", () => {
    const { result } = renderHook(() => useViewerInteraction());

    act(() => {
      result.current.dispatch({ type: "preview-loaded", fullDomain: FULL });
    });
    expect(result.current.current()).toBe(result.current.state);

    act(() => {
      result.current.dispatch({ type: "gesture-started", domain: { low: 10, high: 20 } });
      result.current.dispatch({ type: "selection-committed", index: 4, retentionTime: 50 });
      result.current.dispatch({ type: "hover-established", spectrumIndex: 4 });
    });
    expect(result.current.current()).toBe(result.current.state);
    expect(result.current.state.selection?.index).toBe(4);
    // A selection supersedes a gesture, which is the reducer's rule and not
    // this hook's: what matters here is that both readers say so.
    expect(result.current.current().gesture).toBeNull();
  });

  it("publishes nothing when the reducer refuses an event", () => {
    // A repeated hover over the same scan is the case a renderer produces on
    // every pointer frame. The reducer answers by identity, and this must not
    // turn that into a render.
    const { result } = renderHook(() => useViewerInteraction());

    act(() => {
      result.current.dispatch({ type: "preview-loaded", fullDomain: FULL });
      result.current.dispatch({ type: "hover-established", spectrumIndex: 7 });
    });
    const settled = result.current.state;

    let repeated: unknown = null;
    act(() => {
      repeated = result.current.dispatch({ type: "hover-established", spectrumIndex: 7 });
    });

    expect(repeated).toBe(settled);
    expect(result.current.state).toBe(settled);
  });

  it("keeps a stale settle harmless without depending on a cleared timer", () => {
    const { result } = renderHook(() => useViewerInteraction());

    let epoch: number | null = null;
    act(() => {
      result.current.dispatch({ type: "preview-loaded", fullDomain: FULL });
      epoch = activeGestureEpoch(
        result.current.dispatch({ type: "gesture-started", domain: { low: 10, high: 20 } }),
      );
      // A selection arrives before the debounce fires, exactly as a linked
      // surface can produce one.
      result.current.dispatch({ type: "selection-committed", index: 9, retentionTime: 90 });
    });
    const afterSelection = result.current.state;

    let late: unknown = null;
    act(() => {
      late = result.current.dispatch({ type: "gesture-settled", epoch: epoch ?? -1 });
    });

    expect(late).toBe(afterSelection);
    expect(renderedDomain(result.current.state)).toBe(
      renderedDomain(afterSelection),
    );
  });

  it("hands out a fresh epoch for every gesture, so the last one cannot be addressed", () => {
    const { result } = renderHook(() => useViewerInteraction());

    const epochs: (number | null)[] = [];
    act(() => {
      result.current.dispatch({ type: "preview-loaded", fullDomain: FULL });
      epochs.push(
        activeGestureEpoch(
          result.current.dispatch({ type: "gesture-started", domain: { low: 10, high: 20 } }),
        ),
      );
      result.current.dispatch({ type: "gesture-cancelled", epoch: epochs[0] ?? -1 });
      epochs.push(
        activeGestureEpoch(
          result.current.dispatch({ type: "gesture-started", domain: { low: 30, high: 40 } }),
        ),
      );
    });

    expect(epochs[0]).not.toBe(epochs[1]);
  });
});
