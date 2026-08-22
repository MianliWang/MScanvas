import { describe, expect, it } from "vitest";

import type { RetentionTimeDomain } from "./scanModel";
import {
  activeGestureEpoch,
  consumeSelection,
  initialSelectionConsumer,
  initialViewerInteractionState,
  renderedDomain,
  viewerInteractionReducer,
} from "./interactionState";
import type { SelectionConsumer, ViewerEvent, ViewerInteractionState } from "./interactionState";

const FULL: RetentionTimeDomain = { low: 0, high: 100 };

/** Applies a sequence, which is how every case here is written. */
function run(events: readonly ViewerEvent[], from = initialViewerInteractionState) {
  return events.reduce(viewerInteractionReducer, from);
}

/** A loaded preview, which almost every case starts from. */
function loaded(): ViewerInteractionState {
  return run([{ type: "preview-loaded", fullDomain: FULL }]);
}

function committed(state: ViewerInteractionState, domain: RetentionTimeDomain) {
  return run([{ type: "viewport-step", domain }], state);
}

describe("selection", () => {
  it("commits while idle, leaving a full-range viewport alone", () => {
    const state = run(
      [{ type: "selection-committed", index: 7, revision: 1, retentionTime: 50 }],
      loaded(),
    );

    expect(state.selection).toEqual({ index: 7, revision: 1, retentionTime: 50 });
    // Every scan is already on screen, so there is nothing to reveal.
    expect(state.committedDomain).toBeNull();
  });

  it("reveals a scan outside the committed viewport, keeping the span", () => {
    const zoomed = committed(loaded(), { low: 10, high: 30 });
    const state = run(
      [{ type: "selection-committed", index: 9, revision: 1, retentionTime: 80 }],
      zoomed,
    );

    const domain = state.committedDomain as RetentionTimeDomain;
    expect(domain.high - domain.low).toBeCloseTo(20, 10);
    expect(domain.low).toBeLessThanOrEqual(80);
    expect(domain.high).toBeGreaterThanOrEqual(80);
  });

  it("leaves the viewport alone for a scan already inside it", () => {
    const zoomed = committed(loaded(), { low: 10, high: 30 });
    const state = run(
      [{ type: "selection-committed", index: 9, revision: 1, retentionTime: 20 }],
      zoomed,
    );

    expect(state.committedDomain).toEqual(zoomed.committedDomain);
  });

  it("treats the same index with a newer revision as a new commit", () => {
    // The defect that survived two repairs in PR #72. Which scan is selected
    // does not change; the fact that the user asked for it again does.
    const first = run(
      [{ type: "selection-committed", index: 4, revision: 10, retentionTime: 50 }],
      loaded(),
    );
    const second = run(
      [{ type: "selection-committed", index: 4, revision: 11, retentionTime: 50 }],
      first,
    );

    expect(second.selection?.index).toBe(4);
    expect(second.selection?.revision).toBe(11);
    expect(second.selection).not.toBe(first.selection);
  });
});

describe("selection against a gesture in flight", () => {
  it("cancels a pending wheel gesture and reveals against the committed range", () => {
    // A wheel is a stream with no end signal: its settle is scheduled and has
    // not arrived. A selection landing in that window must not be overwritten
    // by it.
    const zoomed = committed(loaded(), { low: 10, high: 30 });
    const wheeling = run(
      [{ type: "gesture-started", domain: { low: 12, high: 26 } }],
      zoomed,
    );
    const epoch = activeGestureEpoch(wheeling) as number;

    const selected = run(
      [{ type: "selection-committed", index: 9, revision: 1, retentionTime: 80 }],
      wheeling,
    );

    // The gesture is gone, and the reveal was computed from the committed
    // range rather than from the half-finished one.
    expect(selected.gesture).toBeNull();
    const domain = selected.committedDomain as RetentionTimeDomain;
    expect(domain.high - domain.low).toBeCloseTo(20, 10);
    expect(domain.low).toBeLessThanOrEqual(80);

    // And the settle that was already scheduled arrives late and does nothing
    // at all -- asserted by identity, because "does nothing" has to mean the
    // caller receives the state it passed in.
    const afterStaleSettle = viewerInteractionReducer(selected, {
      type: "gesture-settled",
      epoch,
    });
    expect(afterStaleSettle).toBe(selected);
  });

  it("cancels a drag the same way", () => {
    const zoomed = committed(loaded(), { low: 40, high: 60 });
    const dragging = run(
      [
        { type: "gesture-started", domain: { low: 41, high: 61 } },
        { type: "gesture-moved", epoch: 2, domain: { low: 45, high: 65 } },
      ],
      zoomed,
    );
    expect(dragging.gesture).not.toBeNull();

    const selected = run(
      [{ type: "selection-committed", index: 3, revision: 1, retentionTime: 10 }],
      dragging,
    );

    expect(selected.gesture).toBeNull();
    // Revealed from the committed range, not from where the drag had reached.
    const domain = selected.committedDomain as RetentionTimeDomain;
    expect(domain.high - domain.low).toBeCloseTo(20, 10);
    expect(domain.low).toBeLessThanOrEqual(10);
  });

  it("does not let a keyboard step be overwritten by a pending gesture either", () => {
    const wheeling = run(
      [
        { type: "viewport-step", domain: { low: 10, high: 30 } },
        { type: "gesture-started", domain: { low: 12, high: 26 } },
      ],
      loaded(),
    );
    const epoch = activeGestureEpoch(wheeling) as number;

    const stepped = run([{ type: "viewport-step", domain: { low: 50, high: 70 } }], wheeling);
    expect(stepped.gesture).toBeNull();
    expect(viewerInteractionReducer(stepped, { type: "gesture-settled", epoch })).toBe(stepped);
  });
});

describe("a gesture after a selection", () => {
  it("is authoritative, and the consumed revision does not pull the viewport back", () => {
    const zoomed = committed(loaded(), { low: 10, high: 30 });
    const selected = run(
      [{ type: "selection-committed", index: 9, revision: 1, retentionTime: 20 }],
      zoomed,
    );

    // The user pans well away from the selected scan and lets go.
    const panned = run(
      [
        { type: "gesture-started", domain: { low: 70, high: 90 } },
        { type: "gesture-settled", epoch: activeGestureEpoch(
            run([{ type: "gesture-started", domain: { low: 70, high: 90 } }], selected),
          ) as number },
      ],
      selected,
    );

    expect(panned.committedDomain).toEqual({ low: 70, high: 90 });
    // Nothing about the still-current selection moves it back.
    expect(
      run([{ type: "hover-cleared" }], panned).committedDomain,
    ).toEqual({ low: 70, high: 90 });
  });

  it("is superseded by the next revision, which may reveal again", () => {
    const zoomed = committed(loaded(), { low: 70, high: 90 });
    const state = run(
      [{ type: "selection-committed", index: 9, revision: 2, retentionTime: 5 }],
      zoomed,
    );

    const domain = state.committedDomain as RetentionTimeDomain;
    expect(domain.low).toBeLessThanOrEqual(5);
    expect(domain.high - domain.low).toBeCloseTo(20, 10);
  });
});

describe("stale gesture work", () => {
  it("ignores a settle whose epoch was cancelled", () => {
    const started = run([{ type: "gesture-started", domain: { low: 10, high: 30 } }], loaded());
    const epoch = activeGestureEpoch(started) as number;
    const cancelled = run([{ type: "gesture-cancelled", epoch }], started);

    expect(viewerInteractionReducer(cancelled, { type: "gesture-settled", epoch })).toBe(cancelled);
    expect(cancelled.committedDomain).toBeNull();
  });

  it("ignores a settle whose epoch was superseded by another gesture", () => {
    const first = run([{ type: "gesture-started", domain: { low: 10, high: 30 } }], loaded());
    const stale = activeGestureEpoch(first) as number;
    const second = run([{ type: "gesture-started", domain: { low: 50, high: 70 } }], first);
    const live = activeGestureEpoch(second) as number;

    expect(live).not.toBe(stale);
    expect(viewerInteractionReducer(second, { type: "gesture-settled", epoch: stale })).toBe(second);
    // The live one still settles.
    expect(
      viewerInteractionReducer(second, { type: "gesture-settled", epoch: live }).committedDomain,
    ).toEqual({ low: 50, high: 70 });
  });

  it("ignores a settle from a preview that has been replaced", () => {
    const started = run([{ type: "gesture-started", domain: { low: 10, high: 30 } }], loaded());
    const epoch = activeGestureEpoch(started) as number;
    const reloaded = run([{ type: "preview-loaded", fullDomain: { low: 0, high: 200 } }], started);

    expect(viewerInteractionReducer(reloaded, { type: "gesture-settled", epoch })).toBe(reloaded);
    expect(reloaded.committedDomain).toBeNull();
  });

  it("never reuses an epoch", () => {
    let state = loaded();
    const seen = new Set<number>();
    for (let step = 0; step < 5; step += 1) {
      state = run([{ type: "gesture-started", domain: { low: step, high: step + 10 } }], state);
      const epoch = activeGestureEpoch(state) as number;
      expect(seen.has(epoch)).toBe(false);
      seen.add(epoch);
    }
  });

  it("ignores a move addressed to an epoch that is not current", () => {
    const started = run([{ type: "gesture-started", domain: { low: 10, high: 30 } }], loaded());

    expect(
      viewerInteractionReducer(started, {
        type: "gesture-moved",
        epoch: 999,
        domain: { low: 0, high: 100 },
      }),
    ).toBe(started);
  });
});

describe("reset and preview lifetime", () => {
  it("resets to the whole run and drops anything in flight", () => {
    const state = run(
      [
        { type: "viewport-step", domain: { low: 10, high: 30 } },
        { type: "gesture-started", domain: { low: 12, high: 26 } },
        { type: "hover-established", retentionTime: 20, spectrumIndex: 3 },
        { type: "viewport-reset" },
      ],
      loaded(),
    );

    expect(state.committedDomain).toBeNull();
    expect(state.gesture).toBeNull();
    expect(state.hover).toBeNull();
  });

  it("clears viewport, selection and hover when a preview is replaced", () => {
    const busy = run(
      [
        { type: "viewport-step", domain: { low: 10, high: 30 } },
        { type: "selection-committed", index: 4, revision: 1, retentionTime: 20 },
        { type: "hover-established", retentionTime: 22, spectrumIndex: 5 },
      ],
      loaded(),
    );

    const next = run([{ type: "preview-loaded", fullDomain: { low: 0, high: 50 } }], busy);
    expect(next.fullDomain).toEqual({ low: 0, high: 50 });
    expect(next.committedDomain).toBeNull();
    expect(next.selection).toBeNull();
    expect(next.hover).toBeNull();
    expect(next.gesture).toBeNull();
  });

  it("clears everything when the preview closes", () => {
    const closed = run([{ type: "preview-closed" }], loaded());

    expect(closed.fullDomain).toBeNull();
    expect(closed.committedDomain).toBeNull();
    expect(closed.selection).toBeNull();
    expect(closed.hover).toBeNull();
  });

  it("ignores viewport and gesture events while nothing is loaded", () => {
    const empty = initialViewerInteractionState;

    for (const event of [
      { type: "gesture-started", domain: { low: 0, high: 1 } },
      { type: "viewport-step", domain: { low: 0, high: 1 } },
      { type: "viewport-reset" },
      { type: "hover-established", retentionTime: 1, spectrumIndex: 0 },
    ] satisfies ViewerEvent[]) {
      expect(viewerInteractionReducer(empty, event)).toBe(empty);
    }
  });
});

describe("hover", () => {
  it("is established by a pointer and stores no screen coordinate", () => {
    const state = run(
      [{ type: "hover-established", retentionTime: 42, spectrumIndex: 8 }],
      loaded(),
    );

    expect(state.hover).toEqual({ retentionTime: 42, spectrumIndex: 8 });
  });

  it("is cleared by a keyboard zoom or step", () => {
    const state = run(
      [
        { type: "hover-established", retentionTime: 42, spectrumIndex: 8 },
        { type: "viewport-step", domain: { low: 30, high: 50 } },
      ],
      loaded(),
    );

    expect(state.hover).toBeNull();
  });

  it("is cleared by a gesture beginning and by its settle", () => {
    const started = run(
      [
        { type: "hover-established", retentionTime: 42, spectrumIndex: 8 },
        { type: "gesture-started", domain: { low: 30, high: 50 } },
      ],
      loaded(),
    );
    expect(started.hover).toBeNull();

    const settled = run(
      [
        { type: "hover-established", retentionTime: 42, spectrumIndex: 8 },
        { type: "gesture-settled", epoch: activeGestureEpoch(started) as number },
      ],
      started,
    );
    expect(settled.hover).toBeNull();
  });

  it("is cleared by a reset and by a selection", () => {
    const afterReset = run(
      [
        { type: "hover-established", retentionTime: 42, spectrumIndex: 8 },
        { type: "viewport-reset" },
      ],
      loaded(),
    );
    expect(afterReset.hover).toBeNull();

    const afterSelection = run(
      [
        { type: "hover-established", retentionTime: 42, spectrumIndex: 8 },
        { type: "selection-committed", index: 8, revision: 1, retentionTime: 42 },
      ],
      loaded(),
    );
    expect(afterSelection.hover).toBeNull();
  });

  it("never selects anything", () => {
    const state = run(
      [{ type: "hover-established", retentionTime: 42, spectrumIndex: 8 }],
      loaded(),
    );

    expect(state.selection).toBeNull();
  });
});

describe("the rendered viewport", () => {
  it("is the gesture while one is in progress, and the commit otherwise", () => {
    const committedState = committed(loaded(), { low: 10, high: 30 });
    expect(renderedDomain(committedState)).toEqual({ low: 10, high: 30 });

    const gesturing = run(
      [{ type: "gesture-started", domain: { low: 12, high: 26 } }],
      committedState,
    );
    expect(renderedDomain(gesturing)).toEqual({ low: 12, high: 26 });

    const settled = run(
      [{ type: "gesture-settled", epoch: activeGestureEpoch(gesturing) as number }],
      gesturing,
    );
    expect(renderedDomain(settled)).toEqual({ low: 12, high: 26 });
  });

  it("is the whole run when nothing is committed", () => {
    expect(renderedDomain(loaded())).toEqual(FULL);
    expect(renderedDomain(initialViewerInteractionState)).toBeNull();
  });
});

describe("consuming a selection", () => {
  const at = (revision: number) => ({ index: 4, revision, retentionTime: 20 });

  it("acts on a new revision and then not again", () => {
    let consumer: SelectionConsumer = initialSelectionConsumer;

    const first = consumeSelection(consumer, at(1));
    expect(first.consumed).not.toBeNull();
    consumer = first.consumer;

    // The same revision, however many renders, viewport changes or gesture
    // domains arrive in between.
    for (let render = 0; render < 4; render += 1) {
      const again = consumeSelection(consumer, at(1));
      expect(again.consumed).toBeNull();
      consumer = again.consumer;
    }
  });

  it("acts again on the same index with a newer revision", () => {
    const first = consumeSelection(initialSelectionConsumer, at(1));
    const second = consumeSelection(first.consumer, at(2));

    expect(second.consumed).toEqual(at(2));
  });

  it("keeps one bookmark per consumer over one shared revision", () => {
    // Two linked views, one selection. PR #72 gave the revision to one of them
    // and not the other; each having its own bookmark is what lets both act
    // without either owning the selection.
    const table = consumeSelection(initialSelectionConsumer, at(1));
    const plot = consumeSelection(initialSelectionConsumer, at(1));

    expect(table.consumed).not.toBeNull();
    expect(plot.consumed).not.toBeNull();
    expect(consumeSelection(table.consumer, at(1)).consumed).toBeNull();
    expect(consumeSelection(plot.consumer, at(1)).consumed).toBeNull();
  });

  it("forgets its bookmark when there is no selection", () => {
    const consumed = consumeSelection(initialSelectionConsumer, at(1));
    const cleared = consumeSelection(consumed.consumer, null);

    expect(cleared.consumer).toEqual(initialSelectionConsumer);
    expect(consumeSelection(cleared.consumer, at(1)).consumed).toEqual(at(1));
  });
});

describe("every committed viewport", () => {
  it("is finite, forward and inside the run", () => {
    for (const domain of [
      { low: -50, high: -10 },
      { low: 200, high: 260 },
      { low: 60, high: 20 },
      { low: NaN, high: 10 },
      { low: 5, high: 5 },
    ]) {
      const state = run([{ type: "viewport-step", domain }], loaded());
      const committedDomain = state.committedDomain;
      if (committedDomain === null) {
        continue;
      }
      expect(Number.isFinite(committedDomain.low)).toBe(true);
      expect(Number.isFinite(committedDomain.high)).toBe(true);
      expect(committedDomain.high).toBeGreaterThan(committedDomain.low);
      expect(committedDomain.low).toBeGreaterThanOrEqual(FULL.low);
      expect(committedDomain.high).toBeLessThanOrEqual(FULL.high);
    }
  });

  it("reports the whole run as no viewport at all", () => {
    const state = run([{ type: "viewport-step", domain: FULL }], loaded());

    expect(state.committedDomain).toBeNull();
  });
});
