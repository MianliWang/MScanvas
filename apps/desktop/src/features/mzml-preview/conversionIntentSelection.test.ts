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
  recoveryIntent,
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

  it("offers a way out where a preserved semantic has no reachable neighbour", () => {
    // Two rules that are each right, meeting: a choice survives an installation
    // change, and a control moves one axis. A build that can run only the
    // shipped posture leaves centroiding at 32/32 with every single-axis
    // neighbour refused -- some unqualified, the rest undeclared -- and the
    // shipped posture sitting available and unreachable.
    const chosen = intentFor({
      processing: "unscopedDefaultCentroiding",
      precision: "mz32Intensity32",
    });
    const onlyShipped = intentCatalog({
      unsupported: CATALOG.intents
        .map((option) => option.intent.id)
        .filter((id) => id !== SHIPPED_INTENT.id),
      installationGeneration: 1,
    });
    expect(reselect(onlyShipped, chosen.id)).toBe(chosen.id);
    // Every one-axis neighbour refused, which is what makes this a dead end
    // rather than merely an unrunnable selection -- and it is the same call the
    // fieldsets make, so the affordance and the controls cannot disagree about
    // whether a route exists.
    for (const axis of CONVERSION_AXES) {
      for (const { value, state } of axisChoices(onlyShipped, chosen, axis)) {
        expect(canChoose(state), `${axis} to ${String(value)}`).toBe(false);
      }
    }

    // So the way out is explicit rather than silent: one labelled choice, and
    // only the semantic Rust names as shipped.
    const recovery = recoveryIntent({
      status: "ready",
      catalog: onlyShipped,
      selectedId: chosen.id,
    });
    expect(recovery?.intent.id).toBe(SHIPPED_INTENT.id);

    // Not offered while the selection can run, because there is nothing to
    // recover from -- and never a route to whichever row happens to be
    // available, which would be the silent fallback this design refuses.
    expect(
      recoveryIntent({ status: "ready", catalog: CATALOG, selectedId: chosen.id }),
    ).toBeNull();
    const nothingRuns = intentCatalog({
      unsupported: CATALOG.intents.map((option) => option.intent.id),
    });
    expect(
      recoveryIntent({ status: "ready", catalog: nothingRuns, selectedId: chosen.id }),
    ).toBeNull();
    expect(recoveryIntent({ status: "loading" })).toBeNull();
    expect(recoveryIntent({ status: "noBackend" })).toBeNull();
  });

  it("leaves an unrunnable selection to the controls where one of them can still reach a runnable row", () => {
    // The claim the recovery block makes is that NO single change reaches a
    // runnable combination. An unrunnable selection is not by itself that
    // state, and treating it as one put a false sentence beside a working
    // control.
    //
    // A build declaring only what the shipped intent emits leaves the preserved
    // 64/64 posture unrunnable -- and one precision step from the shipped 64/32,
    // which that build runs.
    const chosen = intentFor({ precision: "mz64Intensity64" });
    const onlyShipped = intentCatalog({
      unsupported: CATALOG.intents
        .map((option) => option.intent.id)
        .filter((id) => id !== SHIPPED_INTENT.id),
    });
    const settings = { status: "ready" as const, catalog: onlyShipped, selectedId: chosen.id };

    expect(catalogRow(onlyShipped, chosen.id)?.availability).toEqual({
      kind: "unsupportedByInstallation",
    });
    // The ordinary route is right there, offered and takeable.
    expect(choiceState(onlyShipped, chosen, "precision", "mz64Intensity32")).toEqual({
      status: "selectable",
      intentId: SHIPPED_INTENT.id,
    });
    // So there is nothing for the dead-end affordance to say.
    expect(recoveryIntent(settings)).toBeNull();
  });

  it("leaves it to the controls even where the ordinary route is the better one", () => {
    // Sharper than the case above, because here the atomic reset would have
    // been actively worse than the route it denied. A build that declares
    // `--filter` but no `peakPicking` grammar cannot centroid, so both
    // centroided rows are unrunnable while every other row is fine.
    //
    // From centroiding at 64/64, dropping the processing axis keeps the 64-bit
    // intensity the user chose. The reset would have moved them to the shipped
    // 32-bit posture instead -- a second axis silently changed, by the one
    // affordance allowed to change more than one.
    const centroided = intentFor({
      processing: "unscopedDefaultCentroiding",
      precision: "mz64Intensity64",
    });
    const noPicker = intentCatalog({
      unsupported: CATALOG.intents
        .map((option) => option.intent.id)
        .filter((id) => id.includes("unscoped_default_centroiding")),
    });
    const settings = {
      status: "ready" as const,
      catalog: noPicker,
      selectedId: centroided.id,
    };

    expect(catalogRow(noPicker, centroided.id)?.availability).toEqual({
      kind: "unsupportedByInstallation",
    });
    expect(choiceState(noPicker, centroided, "processing", "noAdditionalCentroiding")).toEqual({
      status: "selectable",
      intentId: intentFor({ precision: "mz64Intensity64" }).id,
    });
    expect(recoveryIntent(settings)).toBeNull();
  });

  it("has no selected semantic until a catalog says which are selectable", () => {
    expect(selectedIntent({ status: "loading" })).toBeNull();
    expect(selectedIntent({ status: "noBackend" })).toBeNull();
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

describe("a selection this installation cannot run", () => {
  it("is reported as chosen and unavailable rather than as an ordinary selection", () => {
    // C4. `reselect` keeps a preserved semantic on purpose, including into a
    // build that cannot express it -- so "selected" and "available" come apart
    // routinely, and one member for both said only the first. Every axis shows
    // the same selection, so every axis has to say the same thing about it.
    const wide = intentFor({ precision: "mz64Intensity64" });
    const catalog = intentCatalog({ unsupported: [wide.id] });

    for (const axis of CONVERSION_AXES) {
      const value = wide[axis];
      expect(choiceState(catalog, wide, axis, value)).toEqual({
        status: "selectedUnavailable",
        reason: "unsupported-by-installation",
      });
    }
  });

  it("is still an ordinary selection where the build can run it", () => {
    const wide = intentFor({ precision: "mz64Intensity64" });
    const catalog = intentCatalog();
    for (const axis of CONVERSION_AXES) {
      expect(choiceState(catalog, wide, axis, wide[axis])).toEqual({ status: "selected" });
    }
  });

  it("is not a choice anything may take", () => {
    // The recovery predicate counts routes *out*, and a value that cannot run
    // is not one -- so a selection stranded this way must not make itself look
    // like the ordinary way out of itself.
    const wide = intentFor({ precision: "mz64Intensity64" });
    const catalog = intentCatalog({ unsupported: [wide.id] });
    expect(canChoose(choiceState(catalog, wide, "precision", wide.precision))).toBe(false);
  });
});
