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
      [{ type: "selection-committed", index: 7, retentionTime: 50 }],
      loaded(),
    );

    expect(state.selection).toEqual({ index: 7, revision: 1, retentionTime: 50 });
    expect(state.nextSelectionRevision).toBe(2);
    // Every scan is already on screen, so there is nothing to reveal.
    expect(state.committedDomain).toBeNull();
  });

  it("reveals a scan outside the committed viewport, keeping the span", () => {
    const zoomed = committed(loaded(), { low: 10, high: 30 });
    const state = run(
      [{ type: "selection-committed", index: 9, retentionTime: 80 }],
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
      [{ type: "selection-committed", index: 9, retentionTime: 20 }],
      zoomed,
    );

    expect(state.committedDomain).toEqual(zoomed.committedDomain);
  });

  it("treats the same index committed again as a new commit", () => {
    // The defect that survived two repairs in PR #72. Which scan is selected
    // does not change; the fact that the user asked for it again does.
    const first = run(
      [{ type: "selection-committed", index: 4, retentionTime: 50 }],
      loaded(),
    );
    const second = run(
      [{ type: "selection-committed", index: 4, retentionTime: 50 }],
      first,
    );

    expect(second.selection?.index).toBe(4);
    expect(second.selection?.revision).toBe((first.selection?.revision as number) + 1);
    expect(second.selection).not.toBe(first.selection);
  });

  it("assigns every revision itself, and never reuses one", () => {
    // Several producers commit selections. If any of them supplied the number,
    // two could reuse one -- and a consumer holding that bookmark would treat a
    // real, different selection as one it had already acted on, which is the
    // defect this contract exists to make unrepresentable.
    let state = loaded();
    const seen = new Set<number>();
    for (const index of [1, 1, 2, 2, 2, 3]) {
      state = run([{ type: "selection-committed", index, retentionTime: index }], state);
      const revision = state.selection?.revision as number;
      expect(seen.has(revision)).toBe(false);
      seen.add(revision);
    }
    expect(seen.size).toBe(6);
  });

  it("keeps counting across a preview change, so no bookmark can collide", () => {
    // A consumer's bookmark may outlive the preview it was made under. A
    // counter that restarted would let a new commit land on it.
    const before = run(
      [{ type: "selection-committed", index: 1, retentionTime: 10 }],
      loaded(),
    );
    const after = run(
      [
        { type: "preview-loaded", fullDomain: { low: 0, high: 10 } },
        { type: "selection-committed", index: 1, retentionTime: 5 },
      ],
      before,
    );

    expect(after.selection?.revision).toBeGreaterThan(before.selection?.revision as number);
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
      [{ type: "selection-committed", index: 9, retentionTime: 80 }],
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
      [{ type: "selection-committed", index: 3, retentionTime: 10 }],
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
      [{ type: "selection-committed", index: 9, retentionTime: 20 }],
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
      [{ type: "selection-committed", index: 9, retentionTime: 5 }],
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
        { type: "hover-established", spectrumIndex: 3 },
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
        { type: "selection-committed", index: 4, retentionTime: 20 },
        { type: "hover-established", spectrumIndex: 5 },
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
      { type: "hover-established", spectrumIndex: 0 },
    ] satisfies ViewerEvent[]) {
      expect(viewerInteractionReducer(empty, event)).toBe(empty);
    }
  });
});

describe("hover", () => {
  it("is established by a pointer and stores only the scan it resolved to", () => {
    const state = run(
      [{ type: "hover-established", spectrumIndex: 8 }],
      loaded(),
    );

    expect(state.hover).toEqual({ spectrumIndex: 8 });
  });

  it("may be re-established under the new axis after one is invalidated", () => {
    // Invalidation is not a ban. A pointer frame resolving a scan under the new
    // domain establishes a fresh observation immediately, so inspection stays
    // responsive while a gesture is moving.
    const gesturing = run([{ type: "gesture-started", domain: { low: 10, high: 30 } }], loaded());
    const epoch = activeGestureEpoch(gesturing) as number;
    const moved = run(
      [
        { type: "hover-established", spectrumIndex: 8 },
        { type: "gesture-moved", epoch, domain: { low: 60, high: 80 } },
      ],
      gesturing,
    );
    expect(moved.hover).toBeNull();

    expect(run([{ type: "hover-established", spectrumIndex: 21 }], moved).hover).toEqual({
      spectrumIndex: 21,
    });
  });

  it("is the same state when the pointer stays over one scan", () => {
    // A renderer may resolve the nearest scan on every pointer frame. What
    // reaches this contract is a crossing from one scan to another, not a
    // movement -- so a consumer of this state does not re-render at the
    // pointer's sampling rate, and continuous coordinates stay in the renderer
    // where `apps/desktop/AGENTS.md` requires them.
    const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], loaded());

    for (let frame = 0; frame < 10; frame += 1) {
      expect(
        viewerInteractionReducer(hovering, { type: "hover-established", spectrumIndex: 8 }),
      ).toBe(hovering);
    }
    // Crossing into another scan is a change.
    expect(
      viewerInteractionReducer(hovering, { type: "hover-established", spectrumIndex: 9 }),
    ).not.toBe(hovering);
  });

  it("is cleared by a keyboard zoom or step", () => {
    const state = run(
      [
        { type: "hover-established", spectrumIndex: 8 },
        { type: "viewport-step", domain: { low: 30, high: 50 } },
      ],
      loaded(),
    );

    expect(state.hover).toBeNull();
  });

  it("does not survive a gesture that moves the axis under it", () => {
    // The Round-2 finding. A hover names the scan under a fixed pointer, and
    // which scan that is depends entirely on what the axis is showing -- so a
    // move that shifts the axis makes the observation describe the past.
    const gesturing = run(
      [{ type: "gesture-started", domain: { low: 10, high: 30 } }],
      loaded(),
    );
    const epoch = activeGestureEpoch(gesturing) as number;
    const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], gesturing);
    expect(hovering.hover).toEqual({ spectrumIndex: 8 });

    const moved = run(
      [{ type: "gesture-moved", epoch, domain: { low: 60, high: 80 } }],
      hovering,
    );

    expect(renderedDomain(moved)).toEqual({ low: 60, high: 80 });
    expect(moved.hover).toBeNull();
  });

  it("survives a gesture move that resolves to the same axis", () => {
    // The counterexample, and the reason this is an invariant rather than a
    // list of event names. Dragging further left at the left edge clamps to the
    // range already shown: nothing moved, so an observation made a moment ago
    // is still true.
    const gesturing = run([{ type: "gesture-started", domain: { low: 0, high: 20 } }], loaded());
    const epoch = activeGestureEpoch(gesturing) as number;
    const hovering = run([{ type: "hover-established", spectrumIndex: 3 }], gesturing);

    const moved = run(
      [{ type: "gesture-moved", epoch, domain: { low: -5, high: 15 } }],
      hovering,
    );

    expect(renderedDomain(moved)).toEqual({ low: 0, high: 20 });
    expect(moved.hover).toEqual({ spectrumIndex: 3 });
  });

  it("survives a settle, which commits what was already on screen", () => {
    // Settling does not move anything: the gesture's range becomes the
    // committed one. An enumerated rule cleared hover here; the invariant does
    // not, because there is nothing stale about the observation.
    const gesturing = run([{ type: "gesture-started", domain: { low: 30, high: 50 } }], loaded());
    const epoch = activeGestureEpoch(gesturing) as number;
    const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], gesturing);

    const settled = run([{ type: "gesture-settled", epoch }], hovering);

    expect(renderedDomain(settled)).toEqual({ low: 30, high: 50 });
    expect(settled.hover).toEqual({ spectrumIndex: 8 });
  });

  it("is cleared by a reset that actually resets something", () => {
    const zoomed = committed(loaded(), { low: 30, high: 50 });
    const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], zoomed);

    expect(run([{ type: "viewport-reset" }], hovering).hover).toBeNull();
    // And a reset at full range moves nothing, so it takes nothing away.
    const atFull = run([{ type: "hover-established", spectrumIndex: 8 }], loaded());
    expect(run([{ type: "viewport-reset" }], atFull).hover).toEqual({ spectrumIndex: 8 });
  });

  it("is cleared by a selection whose reveal moves the axis, and not otherwise", () => {
    const zoomed = committed(loaded(), { low: 10, high: 30 });
    const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], zoomed);

    // A selection off screen pans to it, so the observation is stale.
    expect(
      run([{ type: "selection-committed", index: 9, retentionTime: 80 }], hovering).hover,
    ).toBeNull();
    // One already on screen moves nothing.
    expect(
      run([{ type: "selection-committed", index: 9, retentionTime: 20 }], hovering).hover,
    ).toEqual({ spectrumIndex: 8 });
  });

  it("is cleared by a new preview even when the axis happens to match", () => {
    // The one clear that is not about the axis. A hover names a scan of the
    // preview that was loaded, and a different run's indices are different
    // scans -- so two previews sharing a retention-time domain must not share
    // an observation.
    const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], loaded());

    const reloaded = run([{ type: "preview-loaded", fullDomain: FULL }], hovering);
    expect(renderedDomain(reloaded)).toEqual(FULL);
    expect(reloaded.hover).toBeNull();
    expect(run([{ type: "preview-closed" }], hovering).hover).toBeNull();
  });

  it("never selects anything", () => {
    const state = run(
      [{ type: "hover-established", spectrumIndex: 8 }],
      loaded(),
    );

    expect(state.selection).toBeNull();
  });
});

describe("the rendered-domain invariant, over every transition", () => {
  /**
   * The table this invariant is stated as, rather than the list of events it
   * used to be.
   *
   * Each row is a transition, the domain before and after, and therefore
   * whether an observation made beforehand can still be true. Two rows exist
   * only to prove the event's name is not the authority: the same event appears
   * with and without a domain change, and hover follows the domain.
   */
  const CASES: readonly {
    readonly what: string;
    readonly from: () => ViewerInteractionState;
    readonly event: ViewerEvent;
    readonly movesTheAxis: boolean;
  }[] = [
    {
      what: "gesture-moved onto a different range",
      from: () => run([{ type: "gesture-started", domain: { low: 10, high: 30 } }], loaded()),
      event: { type: "gesture-moved", epoch: 2, domain: { low: 60, high: 80 } },
      movesTheAxis: true,
    },
    {
      what: "gesture-moved clamped onto the same range",
      from: () => run([{ type: "gesture-started", domain: { low: 0, high: 20 } }], loaded()),
      event: { type: "gesture-moved", epoch: 2, domain: { low: -5, high: 15 } },
      movesTheAxis: false,
    },
    {
      what: "gesture-settled, which commits what is already shown",
      from: () => run([{ type: "gesture-started", domain: { low: 30, high: 50 } }], loaded()),
      event: { type: "gesture-settled", epoch: 2 },
      movesTheAxis: false,
    },
    {
      what: "viewport-step onto a different range",
      from: loaded,
      event: { type: "viewport-step", domain: { low: 30, high: 50 } },
      movesTheAxis: true,
    },
    {
      what: "viewport-step clamped onto the range already shown",
      from: () => committed(loaded(), { low: 0, high: 20 }),
      event: { type: "viewport-step", domain: { low: -10, high: 10 } },
      movesTheAxis: false,
    },
    {
      what: "viewport-reset from a zoom",
      from: () => committed(loaded(), { low: 30, high: 50 }),
      event: { type: "viewport-reset" },
      movesTheAxis: true,
    },
    {
      what: "viewport-reset at full range",
      from: loaded,
      event: { type: "viewport-reset" },
      movesTheAxis: false,
    },
    {
      what: "selection-committed needing a reveal",
      from: () => committed(loaded(), { low: 10, high: 30 }),
      event: { type: "selection-committed", index: 9, retentionTime: 80 },
      movesTheAxis: true,
    },
    {
      what: "selection-committed needing no reveal",
      from: () => committed(loaded(), { low: 10, high: 30 }),
      event: { type: "selection-committed", index: 9, retentionTime: 20 },
      movesTheAxis: false,
    },
  ];

  for (const { what, from, event, movesTheAxis } of CASES) {
    it(`${movesTheAxis ? "invalidates" : "keeps"} a hover across ${what}`, () => {
      const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], from());
      expect(hovering.hover).toEqual({ spectrumIndex: 8 });
      const before = renderedDomain(hovering);

      const after = run([event], hovering);

      expect(sameRange(renderedDomain(after), before)).toBe(!movesTheAxis);
      expect(after.hover).toEqual(movesTheAxis ? null : { spectrumIndex: 8 });
    });
  }

  it("takes a hover away whenever the axis moves, whatever moved it", () => {
    // The invariant as one statement over the whole table: no case exists in
    // which the rendered domain changed and an observation survived.
    for (const { from, event } of CASES) {
      const hovering = run([{ type: "hover-established", spectrumIndex: 8 }], from());
      const after = run([event], hovering);
      if (!sameRange(renderedDomain(after), renderedDomain(hovering))) {
        expect(after.hover).toBeNull();
      }
    }
  });
});

/** Whether two rendered domains are the same range, by value. */
function sameRange(
  left: RetentionTimeDomain | null,
  right: RetentionTimeDomain | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.low === right.low && left.high === right.high;
}

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
