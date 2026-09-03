/**
 * The conversion settings, decided from one catalog.
 *
 * What is settled here is the property M6.4 stands on: **the interface does not
 * hold a compatibility matrix.** Rust sends nine admitted semantics; every
 * question this side asks about which values compose is a lookup in that list,
 * so a combination the measured evidence does not admit is not reachable by any
 * sequence of control activations.
 *
 * The cases are written against a catalog built by the shared fixtures, which
 * mirror `ConversionIntent::ADMITTED`. Where a case names a transition it names
 * it in full -- both endpoints and the axis that moved -- because the defect
 * these tests exist to catch is a transition that quietly moves a second axis.
 */

import { describe, expect, it } from "vitest";

import type { ConversionIntent, ConversionIntentCatalog } from "./contracts";
import type { ConversionAxis, ConversionAxisValues } from "./conversionIntentSelection";
import {
  axisChoices,
  canChoose,
  catalogRow,
  choiceState,
  CONVERSION_AXES,
  reselect,
  selectedIntent,
} from "./conversionIntentSelection";
import { intentCatalog, intentFor, SHIPPED_INTENT } from "../../test/previewFixtures";

const CATALOG = intentCatalog();

/** The intent one identity names, for a case that starts somewhere else. */
function intentById(catalog: ConversionIntentCatalog, id: string): ConversionIntent {
  const row = catalogRow(catalog, id);
  if (row === null) {
    throw new Error(`no admitted intent named ${id}`);
  }
  return row.intent;
}

/** Which value of one axis a state names, or how it was refused. */
function move<A extends ConversionAxis>(
  from: ConversionIntent,
  axis: A,
  value: ConversionAxisValues[A],
  catalog: ConversionIntentCatalog = CATALOG,
): ConversionIntent | { readonly refused: string } {
  const state = choiceState(catalog, from, axis, value);
  if (state.status === "selectable") {
    return intentById(catalog, state.intentId);
  }
  return { refused: state.status === "unavailable" ? state.reason : "selected" };
}

describe("what a conversion settings control may offer", () => {
  it("takes every axis value from the catalog, in the order the evidence lists them", () => {
    // The vocabulary of each dimension is not written on this side either. It
    // is read out of the rows, in first-appearance order, so a value that no
    // admitted row carries could not be offered even as a refused one.
    expect(axisChoices(CATALOG, SHIPPED_INTENT, "processing").map((choice) => choice.value)).toEqual(
      ["noAdditionalCentroiding", "unscopedDefaultCentroiding"],
    );
    expect(axisChoices(CATALOG, SHIPPED_INTENT, "population").map((choice) => choice.value)).toEqual(
      ["all", "ms1Only", "ms2Only"],
    );
    expect(axisChoices(CATALOG, SHIPPED_INTENT, "precision").map((choice) => choice.value)).toEqual([
      "mz64Intensity32",
      "mz64Intensity64",
      "mz32Intensity32",
      "mz32Intensity64",
    ]);
    expect(
      axisChoices(CATALOG, SHIPPED_INTENT, "compression").map((choice) => choice.value),
    ).toEqual(["zlib", "none"]);
    // Format is not among them. One output format is admitted, so there is
    // nothing to choose between and no control to offer.
    expect(CONVERSION_AXES).not.toContain("format");
  });

  it("marks exactly one value of each axis as the selected one", () => {
    for (const axis of CONVERSION_AXES) {
      const selected = axisChoices(CATALOG, SHIPPED_INTENT, axis).filter(
        (choice) => choice.state.status === "selected",
      );
      expect(selected.map((choice) => choice.value)).toEqual([SHIPPED_INTENT[axis]]);
    }
  });

  it("changes one axis and never a second one", () => {
    // The defect this is about: a control that, asked for a value its current
    // combination cannot take, goes looking for some other admitted row
    // containing it. The user asked about compression and their precision
    // changed.
    for (const axis of CONVERSION_AXES) {
      for (const { value, state } of axisChoices(CATALOG, SHIPPED_INTENT, axis)) {
        if (state.status !== "selectable") {
          continue;
        }
        const reached = intentById(CATALOG, state.intentId);
        expect(reached[axis]).toBe(value);
        for (const other of CONVERSION_AXES) {
          if (other === axis) {
            continue;
          }
          expect(reached[other], `${axis} to ${String(value)} moved ${other}`).toBe(
            SHIPPED_INTENT[other],
          );
        }
      }
    }
  });

  it("refuses the incompatible transitions the evidence does not admit", () => {
    // Each of these is one axis away from what the product ships, which is what
    // makes them the transitions a user actually reaches. None was measured,
    // and the answer is a refusal rather than a silent move to a neighbouring
    // row that happens to exist.
    expect(move(SHIPPED_INTENT, "compression", "none")).toEqual({ refused: "not-qualified" });
    expect(move(SHIPPED_INTENT, "population", "ms1Only")).toEqual({ refused: "not-qualified" });
    expect(move(SHIPPED_INTENT, "population", "ms2Only")).toEqual({ refused: "not-qualified" });
    expect(move(SHIPPED_INTENT, "processing", "unscopedDefaultCentroiding")).toEqual({
      refused: "not-qualified",
    });
  });

  it("admits the transitions the evidence does admit, from where they were measured", () => {
    const wide = intentFor({ precision: "mz64Intensity64" });
    expect(move(wide, "compression", "none")).toEqual(
      intentFor({ precision: "mz64Intensity64", compression: "none" }),
    );
    expect(move(wide, "population", "ms1Only")).toEqual(
      intentFor({ precision: "mz64Intensity64", population: "ms1Only" }),
    );
    expect(move(wide, "population", "ms2Only")).toEqual(
      intentFor({ precision: "mz64Intensity64", population: "ms2Only" }),
    );
    expect(move(wide, "processing", "unscopedDefaultCentroiding")).toEqual(
      intentFor({ precision: "mz64Intensity64", processing: "unscopedDefaultCentroiding" }),
    );
    const narrow = intentFor({ precision: "mz32Intensity32" });
    expect(move(narrow, "processing", "unscopedDefaultCentroiding")).toEqual(
      intentFor({ precision: "mz32Intensity32", processing: "unscopedDefaultCentroiding" }),
    );
  });

  it("reaches every admitted semantic through explicit single-axis choices", () => {
    // The graph is not merely small; it is *connected* by the moves a control
    // offers. If it were not, a row would be in the evidence and unreachable on
    // screen -- which is the same as not shipping it, said less honestly.
    const reached = new Set<string>([SHIPPED_INTENT.id]);
    const frontier: ConversionIntent[] = [SHIPPED_INTENT];
    while (frontier.length > 0) {
      const current = frontier.pop();
      if (current === undefined) {
        break;
      }
      for (const axis of CONVERSION_AXES) {
        for (const { state } of axisChoices(CATALOG, current, axis)) {
          if (state.status !== "selectable" || reached.has(state.intentId)) {
            continue;
          }
          reached.add(state.intentId);
          frontier.push(intentById(CATALOG, state.intentId));
        }
      }
    }
    expect([...reached].sort()).toEqual(
      CATALOG.intents.map((option) => option.intent.id).sort(),
    );
  });

  it("tells a combination that was never qualified apart from one this build cannot run", () => {
    // Two refusals, two actions. The first cannot be fixed by installing
    // anything; the second can. Collapsing them into one inert state would tell
    // a user with an old ProteoWizard that their science is unqualified.
    const narrowBuild = intentCatalog({
      unsupported: [intentFor({ precision: "mz64Intensity64" }).id],
    });
    expect(move(SHIPPED_INTENT, "precision", "mz64Intensity64", narrowBuild)).toEqual({
      refused: "unsupported-by-installation",
    });
    expect(move(SHIPPED_INTENT, "compression", "none", narrowBuild)).toEqual({
      refused: "not-qualified",
    });
    // And a refused value is refused to every route: the projection a handler
    // reads and the one a control renders from are the same value.
    for (const { state } of axisChoices(narrowBuild, SHIPPED_INTENT, "precision")) {
      expect(canChoose(state)).toBe(state.status === "selectable");
    }
  });

  it("keeps the chosen semantic across an installation change, unsupported or not", () => {
    // The user asked for a scientific thing. An installation that cannot
    // express it makes the request unavailable; it does not make it a different
    // request, and silently converting under the shipped posture instead would
    // produce a file nobody asked for.
    const chosen = intentFor({ precision: "mz32Intensity64" }).id;
    const afterChange = intentCatalog({ unsupported: [chosen], installationGeneration: 1 });
    expect(reselect(afterChange, chosen)).toBe(chosen);
    expect(catalogRow(afterChange, chosen)?.availability).toEqual({
      kind: "unsupportedByInstallation",
    });
    // Only a selection the new catalog does not hold at all falls back, and it
    // falls back to the semantic Rust names as shipped rather than to whichever
    // row happens to be first.
    expect(reselect(afterChange, "mzml+no_additional_centroiding+all+mz64_intensity32+none")).toBe(
      afterChange.shippedIntentId,
    );
    expect(reselect(afterChange, null)).toBe(afterChange.shippedIntentId);
  });

  it("has no selected semantic until a catalog says which are selectable", () => {
    expect(selectedIntent({ status: "loading" })).toBeNull();
    expect(
      selectedIntent({
        status: "failed",
        error: { kind: "x", summary: "no catalog", detail: null, retryable: false },
      }),
    ).toBeNull();
    expect(
      selectedIntent({ status: "ready", catalog: CATALOG, selectedId: SHIPPED_INTENT.id }),
    ).toEqual(SHIPPED_INTENT);
    // And a selection the catalog does not hold reads as no selection rather
    // than as some other row.
    expect(
      selectedIntent({ status: "ready", catalog: CATALOG, selectedId: "not-a-semantic" }),
    ).toBeNull();
  });
});
