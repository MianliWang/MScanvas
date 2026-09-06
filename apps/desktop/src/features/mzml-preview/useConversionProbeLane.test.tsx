/**
 * The conversion-configuration probe's occupancy of the backend process lane.
 *
 * One fact, held twice — a ref a dispatch reads now and a rendered value a
 * surface projects from — and claimed by request identity rather than by a
 * boolean. What is pinned here is the rule that makes the second half safe: a
 * probe that has lost request authority still settles, and the settlement of
 * work nobody is waiting for must not hand back a lane a newer probe is holding.
 *
 * The occupancy is deliberately *not* an admission rule. It answers "is a probe
 * occupying the lane?" and never "may a probe start?", which is
 * `ConversionConfigurationProbeAdmission`'s question and is tested beside it.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useConversionProbeLane } from "./useConversionProbeLane";

describe("the configuration probe's lane claim", () => {
  it("starts free, in both readings", () => {
    const { result } = renderHook(() => useConversionProbeLane());
    expect(result.current.probing).toBe(false);
    expect(result.current.probingRef.current).toBe(false);
  });

  it("raises the ref in the same statement as the rendered value", () => {
    const { result } = renderHook(() => useConversionProbeLane());
    let seenImmediately = false;
    act(() => {
      result.current.claim();
      // Read before React has committed anything. This is the whole reason the
      // ref exists: a conversion dispatched from a handler in this same commit
      // has to see that the process lane is claimed, and the rendered value is
      // a commit too late to tell it.
      seenImmediately = result.current.probingRef.current;
    });
    expect(seenImmediately).toBe(true);
    expect(result.current.probing).toBe(true);
  });

  it("releases on the settlement of the probe that claimed it", () => {
    const { result } = renderHook(() => useConversionProbeLane());
    let token = 0;
    act(() => {
      token = result.current.claim();
    });
    act(() => {
      result.current.release(token);
    });
    expect(result.current.probing).toBe(false);
    expect(result.current.probingRef.current).toBe(false);
  });

  it("keeps the claim when a probe that lost authority settles late", () => {
    // Probe A is issued, loses request authority to probe B, and only then
    // answers. Its settlement is a statement about work nobody is waiting for
    // and says nothing about the lane -- which B is holding.
    const { result } = renderHook(() => useConversionProbeLane());
    let first = 0;
    let second = 0;
    act(() => {
      first = result.current.claim();
    });
    act(() => {
      second = result.current.claim();
    });
    act(() => {
      result.current.release(first);
    });
    expect(result.current.probing).toBe(true);
    expect(result.current.probingRef.current).toBe(true);

    act(() => {
      result.current.release(second);
    });
    expect(result.current.probing).toBe(false);
    expect(result.current.probingRef.current).toBe(false);
  });

  it("never lowers a free lane, whichever stale token settles", () => {
    // A release after the lane is already free is the same statement as one
    // arriving during somebody else's claim: it is about a probe that has no
    // claim to give back. Nothing is written for it.
    const { result } = renderHook(() => useConversionProbeLane());
    let token = 0;
    act(() => {
      token = result.current.claim();
      result.current.release(token);
    });
    let raised = 0;
    act(() => {
      raised = result.current.claim();
      result.current.release(token);
    });
    expect(result.current.probing).toBe(true);
    act(() => {
      result.current.release(raised);
    });
    expect(result.current.probing).toBe(false);
  });

  it("names every probe distinctly, for the life of the panel", () => {
    // The ordinal is never reset, so a token identifies exactly one probe even
    // after the lane has been free in between -- which is what lets a very late
    // reply be told from the claim standing now rather than merely from the
    // claim before it.
    const { result } = renderHook(() => useConversionProbeLane());
    const issued: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      act(() => {
        const token = result.current.claim();
        issued.push(token);
        result.current.release(token);
      });
    }
    expect(new Set(issued).size).toBe(issued.length);
  });
});
