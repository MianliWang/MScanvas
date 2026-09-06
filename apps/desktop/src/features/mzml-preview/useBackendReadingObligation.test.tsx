/**
 * Bounded issuance: the two ways a step-three obligation goes wrong.
 *
 * An unbounded one spins — the attempt clears its own busy flag, the clearing is
 * a fact ceasing to refuse, and the obligation wakes itself at IPC speed. A
 * naively bounded one strands — a gate holder finishes while a failing request
 * is still in the air, and the answer lands into a world that has already moved
 * without anything left to notice it.
 *
 * Both are pinned here, over the real hook, with the facts driven by hand.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BackendCheckFacts } from "./backendReadingObligation";
import { useBackendReadingObligation } from "./useBackendReadingObligation";

const FREE: BackendCheckFacts = {
  backendChanging: false,
  laneClaimed: false,
  previewReading: false,
  probeInFlight: false,
};

function facts(overrides: Partial<BackendCheckFacts> = {}): BackendCheckFacts {
  return { ...FREE, ...overrides };
}

/**
 * The hook, over a world this test moves one step at a time.
 *
 * The facts are a prop rather than a source of their own, so every transition
 * below is one this test asked for -- which is what makes "nothing else woke
 * it" a claim about the code.
 */
function mount(owed: boolean, initial: BackendCheckFacts = FREE) {
  const check = vi.fn();
  const rendered = renderHook(
    ({ owed: isOwed, facts: current }: { owed: boolean; facts: BackendCheckFacts }) => {
      useBackendReadingObligation(isOwed, current, check);
    },
    { initialProps: { owed, facts: initial } },
  );
  return {
    check,
    move: (next: { owed?: boolean; facts?: BackendCheckFacts }, previous = { owed, facts: initial }) => {
      const props = { owed: next.owed ?? previous.owed, facts: next.facts ?? previous.facts };
      act(() => {
        rendered.rerender(props);
      });
      return props;
    },
    rendered,
  };
}

describe("what is issued, and when", () => {
  it("issues nothing while nothing is owed", () => {
    const { check } = mount(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("issues once when a reading is owed into a free lane", () => {
    const { check } = mount(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("issues nothing while a process owns the lane", () => {
    // Deferred, not refused: the obligation stays owed and waits for the fact
    // that refused it to stop refusing.
    for (const held of ["backendChanging", "laneClaimed", "previewReading", "probeInFlight"] as const) {
      const { check } = mount(true, facts({ [held]: true }));
      expect(check, `${held} should defer the check`).not.toHaveBeenCalled();
    }
  });

  it("issues when the holder that deferred it lets go", () => {
    const { check, move } = mount(true, facts({ laneClaimed: true }));
    expect(check).not.toHaveBeenCalled();
    move({ facts: FREE });
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("the loop bound", () => {
  it("is not woken by its own attempt raising and clearing the busy fact", () => {
    // The attempt goes out into a free lane, raises `backendChanging` for its
    // duration, and clears it when it settles. That clearing is a fact ceasing
    // to refuse, and if it counted, a check whose request failed would re-issue
    // itself for ever.
    const { check, move } = mount(true);
    expect(check).toHaveBeenCalledTimes(1);
    let props = move({ facts: facts({ backendChanging: true }) });
    props = move({ facts: FREE }, props);
    expect(check).toHaveBeenCalledTimes(1);
    // And it stays quiet however many renders pass with nothing happening.
    props = move({ facts: FREE }, props);
    move({ facts: FREE }, props);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("leaves the reader's own control as the floor, rather than retrying", () => {
    // A failed attempt leaves the banner on its last reading with `Check again`
    // and `Choose folder…` live. The obligation does not replace that with a
    // storm.
    const { check, move } = mount(true);
    expect(check).toHaveBeenCalledTimes(1);
    let props = move({ facts: facts({ backendChanging: true }) });
    for (let round = 0; round < 5; round += 1) {
      props = move({ facts: FREE }, props);
      props = move({ facts: facts({ backendChanging: true }) }, props);
    }
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("an occasion that passes while an attempt is outstanding", () => {
  it("is not lost when the attempt settles without discharging the obligation", () => {
    // A drain ends while a failing request is still in the air. By the time the
    // failure lands, `laneClaimed` has been false for several renders -- so an
    // obligation that only compared the world at dispatch with the world now
    // would see no transition and strand the work.
    const { check, move } = mount(true);
    expect(check).toHaveBeenCalledTimes(1);
    // The request is in flight.
    let props = move({ facts: facts({ backendChanging: true }) });
    // A drain starts and ends inside that window.
    props = move({ facts: facts({ backendChanging: true, laneClaimed: true }) }, props);
    props = move({ facts: facts({ backendChanging: true }) }, props);
    // The request fails: no reading, still owed, busy cleared.
    move({ facts: FREE }, props);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("is spent once, not remembered for ever", () => {
    const { check, move } = mount(true);
    let props = move({ facts: facts({ backendChanging: true }) });
    props = move({ facts: facts({ backendChanging: true, laneClaimed: true }) }, props);
    props = move({ facts: facts({ backendChanging: true }) }, props);
    props = move({ facts: FREE }, props);
    expect(check).toHaveBeenCalledTimes(2);
    // The second attempt's own cycle wakes nothing.
    props = move({ facts: facts({ backendChanging: true }) }, props);
    move({ facts: FREE }, props);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("discharge", () => {
  it("forgets its bound once the obligation is met", () => {
    // A later supersession is a new obligation and starts from nothing, rather
    // than inheriting a bound recorded for a different one.
    const { check, move } = mount(true);
    expect(check).toHaveBeenCalledTimes(1);
    let props = move({ facts: facts({ backendChanging: true }) });
    props = move({ owed: false, facts: FREE }, props);
    expect(check).toHaveBeenCalledTimes(1);
    move({ owed: true, facts: FREE }, props);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
