import { describe, expect, it } from "vitest";

import { allocateLine, type LineEntry } from "./contextLineLayout";

const GAP = 4;
// A status, the viewed object (2), the project (3), the scope (4) and the hint.
const LINE: LineEntry[] = [
  { natural: 180, floor: 180, rank: 1, gap: GAP },
  { natural: 300, floor: 84, rank: 2, gap: GAP },
  { natural: 260, floor: 84, rank: 3, gap: GAP },
  { natural: 220, floor: 84, rank: 4, gap: GAP },
  { natural: 240, floor: 240, rank: 6, gap: 16, removable: true },
];
const total = (widths: (number | null)[]) => {
  let sum = 0;
  let first = true;
  widths.forEach((width, index) => {
    if (width === null) return;
    sum += width + (first ? 0 : LINE[index]!.gap);
    first = false;
  });
  return sum;
};

describe("allocateLine", () => {
  it("leaves every entry whole when the line has room", () => {
    expect(allocateLine(LINE, 2000)).toEqual([180, 300, 260, 220, 240]);
  });

  it("takes the hint away whole, gap included, before any context item gives way", () => {
    const whole = total([180, 300, 260, 220, 240]);
    expect(allocateLine(LINE, whole)).toEqual([180, 300, 260, 220, 240]);
    const widths = allocateLine(LINE, whole - 10);
    expect(widths).toEqual([180, 300, 260, 220, null]);
    // The 16 px before the hint went with it.
    expect(total(widths)).toBe(whole - 240 - 16);
  });

  it("gives way by rank, each down to its floor before the next moves", () => {
    // Without the hint the line is 960 + 12 = 972; 172 short takes the scope
    // (rank 4) from 220 to 84 (136) and the project (rank 3) 36 more.
    const widths = allocateLine(LINE, 800);
    expect(widths).toEqual([180, 300, 224, 84, null]);
    expect(total(widths)).toBe(800);
  });

  it("reaches the viewed object only once the project and the scope are at their floors", () => {
    const widths = allocateLine(LINE, 500);
    expect(widths.slice(2, 4)).toEqual([84, 84]);
    expect(widths[1]).toBe(500 - 180 - 84 - 84 - 3 * GAP);
    expect(widths[0]).toBe(180);
  });

  it("never shrinks a status, even when nothing else is left to give", () => {
    const widths = allocateLine(LINE, 300);
    expect(widths[0]).toBe(180);
    expect(widths.slice(1, 4)).toEqual([84, 84, 84]);
    expect(widths[4]).toBe(null);
  });

  it("keeps two statuses whole side by side", () => {
    const two: LineEntry[] = [{ natural: 190, floor: 190, rank: 1, gap: GAP }, { natural: 200, floor: 200, rank: 1, gap: GAP }, ...LINE.slice(1)];
    const widths = allocateLine(two, 700);
    expect(widths.slice(0, 2)).toEqual([190, 200]);
  });
});
