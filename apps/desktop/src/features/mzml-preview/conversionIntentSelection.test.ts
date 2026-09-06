import { describe, expect, it } from "vitest";

import {
  axisChoices,
  canChoose,
  catalogRow,
  choiceState,
  CONVERSION_AXES,
  recoveryIntent,
  reselect,
  selectionIsUnavailable,
} from "./conversionIntentSelection";
import { admittedIntents, shippedIntent } from "../../test/previewFixtures";
import type { ConversionCatalogRow } from "./contracts";

/**
 * A build that runs every admitted row.
 *
 * The catalog is always all nine, whatever the build declares: "this build
 * cannot" and "the product never measured it" are different sentences, and only
 * a complete table lets a reader be told which one applies.
 */
const COMPLETE: readonly ConversionCatalogRow[] = admittedIntents.map((intent) => ({
  intent,
  available: true,
}));

/** The same nine rows, with the named ones unavailable. */
function withoutRunning(...ids: readonly string[]): readonly ConversionCatalogRow[] {
  return COMPLETE.map((row) => ({ ...row, available: !ids.includes(row.intent.id) }));
}

const id = (
  processing: string,
  population: string,
  precision: string,
  compression: string,
): string => `mzml+${processing}+${population}+${precision}+${compression}`;

const CENTROIDED_64 = id("unscoped_default_centroiding", "all", "mz64_intensity64", "zlib");
const CENTROIDED_32 = id("unscoped_default_centroiding", "all", "mz32_intensity32", "zlib");
const FLAT_64 = id("no_additional_centroiding", "all", "mz64_intensity64", "zlib");
const FLAT_32 = id("no_additional_centroiding", "all", "mz32_intensity32", "zlib");

/**
 * A build declaring everything except the peak-picking grammar.
 *
 * The case the whole surface is shaped around: exactly the two rows that
 * compose processing are unavailable, and every value they use appears in rows
 * that run.
 */
const NO_PEAK_PICKING = withoutRunning(CENTROIDED_64, CENTROIDED_32);

function intentOf(catalog: readonly ConversionCatalogRow[], intentId: string) {
  const row = catalogRow(catalog, intentId);
  if (row === null) {
    throw new Error(`the fixture catalog has no ${intentId}`);
  }
  return row.intent;
}

describe("one axis moves, and only that axis", () => {
  it("selects the exact row the edit names", () => {
    const state = choiceState(
      COMPLETE,
      intentOf(COMPLETE, FLAT_64),
      "precision",
      "mz32_intensity32",
    );
    expect(state).toEqual({ status: "selectable", intentId: FLAT_32 });
  });

  it("refuses a combination the evidence never admitted", () => {
    // MS1 at 32/32 is one of the thirty-nine that were never measured. No
    // build changes that, and the refusal says so rather than blaming the one
    // installed.
    const state = choiceState(COMPLETE, intentOf(COMPLETE, FLAT_32), "population", "ms1_only");
    expect(state).toEqual({ status: "unavailable", reason: "notQualified" });
  });

  it("never reaches for another row that happens to contain the value", () => {
    // MS1 exists in the catalog, at 64/64. Asked from 32/32, the answer is
    // still "not qualified": offering the 64/64 row here would silently change
    // the precision of a reader who asked about the population.
    expect(
      catalogRow(COMPLETE, id("no_additional_centroiding", "ms1_only", "mz64_intensity64", "zlib")),
    ).not.toBeNull();
    expect(choiceState(COMPLETE, intentOf(COMPLETE, FLAT_32), "population", "ms1_only")).toEqual({
      status: "unavailable",
      reason: "notQualified",
    });
  });

  it("names the value the selection already carries as selected", () => {
    expect(choiceState(COMPLETE, intentOf(COMPLETE, FLAT_64), "compression", "zlib")).toEqual({
      status: "selected",
    });
  });
});

describe("a build that lacks only the peak-picking grammar", () => {
  const centroided = intentOf(NO_PEAK_PICKING, CENTROIDED_64);

  it("says so once, about the combination", () => {
    expect(selectionIsUnavailable(NO_PEAK_PICKING, CENTROIDED_64)).toBe(true);
  });

  it("tells no control that a value this build offers is unavailable", () => {
    // The defect this file exists to keep closed. Every value the selection
    // carries appears in a row this build runs, so not one of the four groups
    // may report the selected value as unusable — the sentence belongs to the
    // combination, and it is said once above them.
    for (const axis of CONVERSION_AXES) {
      const selected = axisChoices(NO_PEAK_PICKING, centroided, axis).filter(
        (choice) => choice.state.status === "selected",
      );
      expect(selected).toHaveLength(1);
      expect(selected[0]?.state).toEqual({ status: "selected" });
    }
  });

  it("gives the six one-axis edits that keep centroiding three different answers", () => {
    // Worked against the real admitted table. They do not answer alike, and
    // that is the point: five of them are statements about the product's
    // evidence and one is about this build.
    const answers = new Map<string, unknown>();
    for (const axis of CONVERSION_AXES) {
      for (const choice of axisChoices(NO_PEAK_PICKING, centroided, axis)) {
        if (choice.state.status === "selected") {
          continue;
        }
        answers.set(`${axis}:${String(choice.value)}`, choice.state);
      }
    }
    expect(answers.get("precision:mz32_intensity32")).toEqual({
      status: "unavailable",
      reason: "unavailableHere",
    });
    for (const dead of [
      "precision:mz64_intensity32",
      "precision:mz32_intensity64",
      "population:ms1_only",
      "population:ms2_only",
      "compression:none",
    ]) {
      expect(answers.get(dead)).toEqual({ status: "unavailable", reason: "notQualified" });
    }
    // And the seventh, which leaves centroiding, is the way out.
    expect(answers.get("processing:no_additional_centroiding")).toEqual({
      status: "selectable",
      intentId: FLAT_64,
    });
  });

  it("offers no explicit reset while an ordinary control is the way out", () => {
    // The controls *are* the recovery here, and a labelled reset beside them
    // would claim a dead end that is not one.
    expect(recoveryIntent(NO_PEAK_PICKING, shippedIntent.id, CENTROIDED_64)).toBeNull();
  });
});

describe("a genuine dead end", () => {
  it("offers the shipped combination, explicitly", () => {
    // Every one-axis neighbour of 32/32-centroided is either unqualified or
    // unavailable here, so nothing the controls render can be pressed — and the
    // shipped row sits available and unreachable.
    const catalog = withoutRunning(CENTROIDED_32, CENTROIDED_64, FLAT_32);
    const recovery = recoveryIntent(catalog, shippedIntent.id, CENTROIDED_32);
    expect(recovery?.intent.id).toBe(shippedIntent.id);
    // Which is to say: the ordinary route really is absent.
    const centroided32 = intentOf(catalog, CENTROIDED_32);
    for (const axis of CONVERSION_AXES) {
      expect(axisChoices(catalog, centroided32, axis).some((c) => canChoose(c.state))).toBe(false);
    }
  });

  it("offers nothing when the shipped combination cannot run either", () => {
    // Inventing a route to whichever row happens to be available would be the
    // silent fallback this design refuses.
    const catalog = withoutRunning(CENTROIDED_32, CENTROIDED_64, FLAT_32, shippedIntent.id);
    expect(recoveryIntent(catalog, shippedIntent.id, CENTROIDED_32)).toBeNull();
  });

  it("offers nothing while the selection runs", () => {
    expect(recoveryIntent(COMPLETE, shippedIntent.id, CENTROIDED_64)).toBeNull();
  });
});

describe("a catalog arriving for a new installation", () => {
  it("keeps a choice the new catalog still holds, unavailable or not", () => {
    // The request is a scientific one. Replacing it with the shipped posture
    // would convert something other than what was asked for.
    expect(reselect(NO_PEAK_PICKING, shippedIntent.id, CENTROIDED_64)).toBe(CENTROIDED_64);
  });

  it("falls back to the shipped combination when the catalog has no such row", () => {
    expect(reselect(COMPLETE, shippedIntent.id, "mzml+something+else+entirely+here")).toBe(
      shippedIntent.id,
    );
  });

  it("falls back when nothing was chosen yet", () => {
    expect(reselect(COMPLETE, shippedIntent.id, null)).toBe(shippedIntent.id);
  });
});

describe("the axis vocabularies", () => {
  it("come from the catalog rather than from a list held here", () => {
    // Whatever Rust sends is what a control shows. A list on this side would be
    // a second statement of the evidence, and the two would drift.
    const current = intentOf(COMPLETE, shippedIntent.id);
    expect(axisChoices(COMPLETE, current, "processing").map((c) => c.value)).toEqual([
      "no_additional_centroiding",
      "unscoped_default_centroiding",
    ]);
    expect(axisChoices(COMPLETE, current, "population").map((c) => c.value)).toEqual([
      "all",
      "ms1_only",
      "ms2_only",
    ]);
    expect(axisChoices(COMPLETE, current, "precision").map((c) => c.value)).toEqual([
      "mz64_intensity32",
      "mz64_intensity64",
      "mz32_intensity32",
      "mz32_intensity64",
    ]);
    expect(axisChoices(COMPLETE, current, "compression").map((c) => c.value)).toEqual([
      "zlib",
      "none",
    ]);
  });

  it("shows a value once however many rows carry it", () => {
    const current = intentOf(COMPLETE, shippedIntent.id);
    for (const axis of CONVERSION_AXES) {
      const values = axisChoices(COMPLETE, current, axis).map((c) => c.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("marks exactly one value of each axis as the selected one", () => {
    const current = intentOf(COMPLETE, CENTROIDED_64);
    for (const axis of CONVERSION_AXES) {
      const selected = axisChoices(COMPLETE, current, axis).filter(
        (choice) => choice.state.status === "selected",
      );
      expect(selected).toHaveLength(1);
      expect(selected[0]?.value).toBe(current[axis]);
    }
  });
});

describe("what may be pressed", () => {
  it("is exactly the selectable choices", () => {
    expect(canChoose({ status: "selectable", intentId: FLAT_32 })).toBe(true);
    expect(canChoose({ status: "selected" })).toBe(false);
    expect(canChoose({ status: "unavailable", reason: "notQualified" })).toBe(false);
    expect(canChoose({ status: "unavailable", reason: "unavailableHere" })).toBe(false);
  });
});
