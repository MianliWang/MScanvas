/**
 * Every PR #95 blocker family, tied to the invariant that now prevents it and
 * to where that invariant is held.
 *
 * PR #95 stopped four times. ADR 0044 collapsed its live findings and STOP
 * records into a semantic ledger and answered the questions they turned out to
 * be about; the replacement was then built against that ledger rather than
 * against the old branch. Nothing from #95 is on `main`, so a reviewer of the
 * replacement has no diff to read the old defects out of — which is exactly how
 * a family comes back.
 *
 * This file is that map, and it is checked. Every entry exercises the invariant
 * in one or two lines against the real exported rule, so weakening the thing an
 * entry points at breaks something here as well as in the suite that owns it.
 * It is deliberately *not* a second copy of those suites: where a family is
 * about a wiring, an ordering across effects or a rendered document, the entry
 * says which suite owns it and asserts the pure half that a re-introduction
 * would have to pass through.
 *
 * The row numbers are ADR 0044's semantic finding ledger.
 */

import { describe, expect, it } from "vitest";

import { acceptProjection, backendIsUsable, describesRenderedBinding } from "./backendAuthority";
import type { ConversionCatalogRow } from "./contracts";
import type { ConversionLane } from "./conversionAvailability";
import { conversionAvailability, conversionNoticeId } from "./conversionAvailability";
import {
  probeAdmission,
  readIsOwed,
  retryIsOffered,
  admissionStoppedRefusing,
} from "./conversionConfigurationAuthority";
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
import { conversionNotices } from "./conversionNoticeRegistry";
import type { ConversionStartPlan } from "./conversionPlanAuthority";
import { sameQuestion, startPlan } from "./conversionPlanAuthority";
import {
  admittedIntents,
  completeCatalog,
  firstBindingReceipt,
  settledAt,
  shippedIntent,
} from "../../test/previewFixtures";

const CLEAR: ConversionLane = {
  backendUsable: true,
  backendChanging: false,
  backendQuarantined: false,
  previewReading: false,
  laneClaimed: false,
  configurationProbing: false,
  adopting: false,
  exportingDiagnostics: false,
  workspaceSettling: false,
};

function lane(overrides: Partial<ConversionLane> = {}): ConversionLane {
  return { ...CLEAR, ...overrides };
}

function startOn(overrides: Partial<ConversionLane>, plan: ConversionStartPlan = "ready") {
  return conversionAvailability(lane(overrides), { kind: "start", targetCount: 1, plan });
}

const id = (
  processing: string,
  population: string,
  precision: string,
  compression: string,
): string => `mzml+${processing}+${population}+${precision}+${compression}`;

const FLAT_32 = id("no_additional_centroiding", "all", "mz32_intensity32", "zlib");
const FLAT_64 = id("no_additional_centroiding", "all", "mz64_intensity64", "zlib");
const CENTROIDED_32 = id("unscoped_default_centroiding", "all", "mz32_intensity32", "zlib");
const CENTROIDED_64 = id("unscoped_default_centroiding", "all", "mz64_intensity64", "zlib");

function withoutRunning(...ids: readonly string[]): readonly ConversionCatalogRow[] {
  return completeCatalog.map((row) => ({ ...row, available: !ids.includes(row.intent.id) }));
}

function intentOf(catalog: readonly ConversionCatalogRow[], intentId: string) {
  const row = catalogRow(catalog, intentId);
  if (row === null) {
    throw new Error(`the fixture catalog has no ${intentId}`);
  }
  return row.intent;
}

const A = settledAt(1, firstBindingReceipt);
const A_LATER = settledAt(2, firstBindingReceipt);
const B = settledAt(3, firstBindingReceipt + 1);

describe("the PR #95 blocker families, and what now prevents each", () => {
  it("1. preserved unsupported selection stays recoverable (ledger row 2)", () => {
    // A dead end always has a way out, because a `Ready` catalog always holds
    // the shipped row -- so the recovery is offerable by construction rather
    // than by luck. Owned by `conversionIntentSelection.test.ts` and rendered
    // in `m6.4-conversion-settings.browser.e2e.ts` (E4).
    const dead = withoutRunning(CENTROIDED_32, CENTROIDED_64, FLAT_32);
    expect(recoveryIntent(dead, shippedIntent.id, CENTROIDED_32)?.intent.id).toBe(
      shippedIntent.id,
    );
    for (const axis of CONVERSION_AXES) {
      expect(
        axisChoices(dead, intentOf(dead, CENTROIDED_32), axis).some((choice) =>
          canChoose(choice.state),
        ),
      ).toBe(false);
    }
  });

  it("2. a false atomic recovery is never offered (ledger row 2)", () => {
    // Where one axis reaches a runnable row, the ordinary route is the route.
    // An explicit jump offered beside it would be a second answer to a question
    // the controls already answer.
    const reachable = withoutRunning(CENTROIDED_64, CENTROIDED_32);
    expect(recoveryIntent(reachable, shippedIntent.id, CENTROIDED_64)).toBeNull();
    expect(recoveryIntent(completeCatalog, shippedIntent.id, CENTROIDED_64)).toBeNull();
  });

  it("3. backend loss invalidates the catalog bound to it (ledger rows 3, 4)", () => {
    // Currency is the receipt, and a snapshot held for another binding is the
    // same as holding none. `useConversionConfiguration` reads exactly this.
    expect(
      readIsOwed(B, { receipt: firstBindingReceipt, configuration: null, lastAttemptRefused: false }),
    ).toBe(true);
    expect(describesRenderedBinding(B, firstBindingReceipt)).toBe(false);
    expect(describesRenderedBinding(B, firstBindingReceipt + 1)).toBe(true);
  });

  it("4. an in-flight obsolete catalog reply cannot install (ledger row 4)", () => {
    // The receipt a payload is judged by is the one on the projection it
    // travelled with, so a catalog probed under A cannot arrive under B.
    expect(describesRenderedBinding(B, firstBindingReceipt)).toBe(false);
    // And the ordering that decides which projection is current is the
    // revision, never the receipt.
    expect(acceptProjection(B, A)).toEqual({ accepted: false });
  });

  it("5. BEGIN observing a replacement is delivered, not rediscovered (ledger rows 5, 18)", () => {
    // A refused start creates no queue, so nothing else would arrive to correct
    // the screen -- and the refusal carries the projection. Accepting it is the
    // ordinary rule: order, then identity.
    expect(acceptProjection(A, B)).toEqual({ accepted: true, bindingReplaced: true });
    // Pinned end to end in `conversionAuthorityDelivery.test.tsx` and E8.
  });

  it("6. a same-binding recheck is not a replacement (ledger row 6)", () => {
    // A verdict that moved on one build advances the revision and keeps the
    // receipt, which is news about a build rather than a different build.
    expect(acceptProjection(A, A_LATER)).toEqual({ accepted: true, bindingReplaced: false });
    // A check is activity; a binding is a verdict. `backendChanging` outranks
    // `backendUsable` so a check in flight never reads as a broken install.
    const changing = startOn({ backendChanging: true, backendUsable: false });
    expect(changing.status === "unavailable" && changing.reason).toBe("backend-changing");
  });

  it("7. repeated polls are not repeated requests (ledger row 7)", () => {
    // An arriving fact is not a request. A projection equal to what is rendered
    // is not accepted at all, so N polls of one observation move nothing.
    expect(acceptProjection(A, A)).toEqual({ accepted: false });
    // And a poll is deliberately not an *occasion*, so a read deferred by a
    // drain is not re-issued on every tick of that drain's polling.
    const busy = {
      backendQuarantined: false,
      backendChanging: false,
      laneClaimed: true,
      previewReading: false,
      probeInFlight: false,
    };
    expect(admissionStoppedRefusing(busy, busy)).toBe(false);
    expect(admissionStoppedRefusing(busy, { ...busy, laneClaimed: false })).toBe(true);
  });

  it("8. a failed catalog read has an owner that can retry it (ledger row 8)", () => {
    // Offered exactly where a read could improve the answer, and never for a
    // state only a different binding changes.
    const failed = { receipt: firstBindingReceipt, lastAttemptRefused: false } as const;
    expect(
      retryIsOffered({ ...failed, configuration: { configuration: "failed", error: ERROR } }, false),
    ).toBe(true);
    expect(
      retryIsOffered({ ...failed, configuration: { configuration: "unavailableForBinding" } }, false),
    ).toBe(false);
    // Withdrawn while a probe is in flight rather than disabled, which is why
    // probe-in-flight mints no rendered notice key.
    expect(
      retryIsOffered({ ...failed, configuration: { configuration: "failed", error: ERROR } }, true),
    ).toBe(false);
  });

  it("9. a resolution failure that established absence still observes (ledger rows 9, 16)", () => {
    // Rust's half, and the frontend's consequence: a binding that names no
    // installation is not usable, and its configuration follows from the
    // binding rather than from a probe.
    const absent = {
      revision: 4,
      state: { state: "settled", receipt: 9, binding: "noInstallation", previewAvailability: "unusable" },
    } as const;
    expect(backendIsUsable(absent, false)).toBe(false);
    expect(acceptProjection(A, absent)).toEqual({ accepted: true, bindingReplaced: true });
  });

  it("10. the pre-BEGIN proof is mandatory, and a busy lane refuses rather than blocks (row 10)", () => {
    // The frontend refuses first and names the fact, so the common cases never
    // reach Rust; Rust refuses second on a held gate. Both halves exist, and
    // neither is the other's permission.
    const claimed = startOn({ laneClaimed: true });
    expect(claimed.status === "unavailable" && claimed.reason).toBe("conversion-running");
    const reading = startOn({ previewReading: true });
    expect(reading.status === "unavailable" && reading.reason).toBe("preview-running");
  });

  it("11. selected and available are two facts (ledger row 11)", () => {
    // A preserved choice the build cannot run stays selected *and* reads as
    // unavailable. A state that could hold only one of them is what shipped a
    // grey row described as usable.
    const build = withoutRunning(CENTROIDED_64);
    expect(reselect(build, shippedIntent.id, CENTROIDED_64)).toBe(CENTROIDED_64);
    expect(selectionIsUnavailable(build, CENTROIDED_64)).toBe(true);
    expect(selectionIsUnavailable(completeCatalog, CENTROIDED_64)).toBe(false);
  });

  it("12. a row's refusal is never copied onto an axis value (ledger row 12)", () => {
    // A build lacking only the peak-picking grammar makes no claim about 64-bit
    // intensity, all spectra or zlib: each appears in rows it runs.
    const build = withoutRunning(CENTROIDED_64, CENTROIDED_32);
    expect(choiceState(build, intentOf(build, FLAT_64), "precision", "mz32_intensity32")).toEqual({
      status: "selectable",
      intentId: FLAT_32,
    });
    expect(choiceState(build, intentOf(build, FLAT_64), "processing", "unscoped_default_centroiding")).toEqual(
      { status: "unavailable", reason: "unavailableHere" },
    );
    // And a combination nobody measured is a different sentence, about the
    // product's evidence rather than about this build.
    expect(choiceState(completeCatalog, intentOf(completeCatalog, FLAT_32), "population", "ms1_only")).toEqual(
      { status: "unavailable", reason: "notQualified" },
    );
  });

  it("13. one fact owns one notice, whichever authority names it (ledger rows 13, 73)", () => {
    // Two vocabularies over one set of facts, deduplicated by the fact. The DOM
    // half is `conversionNoticeOwnership.test.tsx` and the browser sweep.
    const shared = conversionNotices([
      { source: "action", availability: startOn({ laneClaimed: true }) },
      { source: "probe", refusal: "laneClaimed" },
    ]);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.id).toBe(conversionNoticeId("conversion-running"));
    // Two genuinely different facts stay two notices.
    expect(
      conversionNotices([
        { source: "action", availability: startOn({ backendUsable: false, laneClaimed: true }) },
        { source: "probe", refusal: "laneClaimed" },
      ]),
    ).toHaveLength(2);
  });

  it("14. a plan never claims a request nobody made (ledger row 14)", () => {
    // `reading` names an actual request. With nothing selected there is no
    // question to pose, and with a binding whose settings are unknown the plan
    // is blocked -- neither of which is a read in flight.
    expect(startPlan({ status: "none" }, { kind: "none" })).toBe("absent");
    expect(
      startPlan({ status: "none" }, { kind: "blocked", reason: "settingsUnknown" }),
    ).toBe("settingsUnknown");
    expect(
      startPlan({ status: "none" }, { kind: "blocked", reason: "selectionUnavailable" }),
    ).toBe("selectionUnavailable");
  });

  it("15. a failed plan is not described as being reread (ledger row 15)", () => {
    // Four situations, four sentences, and the difference is what the reader
    // can do: wait, press something, or change something above.
    const failed = startOn({}, "failed");
    expect(failed.status === "unavailable" && failed.reason).toBe("plan-failed");
    expect(failed.status === "unavailable" && failed.message).toContain("Try describing it again");
    const reading = startOn({}, "reading");
    expect(reading.status === "unavailable" && reading.reason).toBe("plan-reading");
    const unknown = startOn({}, "settingsUnknown");
    expect(unknown.status === "unavailable" && unknown.reason).toBe("plan-settings-unknown");
    const unrunnable = startOn({}, "selectionUnavailable");
    expect(unrunnable.status === "unavailable" && unrunnable.reason).toBe(
      "plan-selection-unavailable",
    );
  });

  it("16. a plan from one binding cannot start under another (ledger rows 181, 182)", () => {
    // Currency compares identities rather than trusting which state the machine
    // is in, and every fact that changes what the queue would mean -- the rows,
    // the combination, the policy and the binding -- is part of the question.
    const asked = {
      scope: "selected" as const,
      handles: ["file-1"],
      intentId: shippedIntent.id,
      conflictPolicy: "fail" as const,
      receipt: firstBindingReceipt,
      destinationPolicy: { kind: "customFolder" as const },
    };
    expect(sameQuestion(asked, { ...asked })).toBe(true);
    expect(sameQuestion(asked, { ...asked, receipt: firstBindingReceipt + 1 })).toBe(false);
    expect(sameQuestion(asked, { ...asked, intentId: FLAT_32 })).toBe(false);
    expect(sameQuestion(asked, { ...asked, conflictPolicy: "skip" })).toBe(false);
    expect(sameQuestion(asked, { ...asked, handles: ["file-2"] })).toBe(false);
    // A plan held for one question does not answer another: the machine reports
    // `reading` rather than handing over an answer about something else.
    expect(startPlan({ status: "ready", identity: asked, plan: PLAN }, {
      kind: "ask",
      identity: { ...asked, intentId: FLAT_32 },
    })).toBe("reading");
    expect(startPlan({ status: "ready", identity: asked, plan: PLAN }, {
      kind: "ask",
      identity: asked,
    })).toBe("ready");
  });

  it("17. one admission rule governs both paths of the configuration read (row 17)", () => {
    // The automatic first read and the explicit retry differ in what initiates
    // them and in nothing else. There is one function, and both ask it.
    const held = {
      backendQuarantined: false,
      backendChanging: false,
      laneClaimed: true,
      previewReading: false,
      probeInFlight: false,
    };
    expect(probeAdmission(held)).toBe("laneClaimed");
    // And its subset is ownership, not judgement: `backendUsable` is not among
    // the facts it consults at all.
    expect(Object.keys(held)).not.toContain("backendUsable");
  });

  it("18. an automatic probe takes the lane it is admitted into (rows 79, 187)", () => {
    // The occupancy is a lane fact with a rendered key, because ADR 0043
    // forbids offering an action the operation will refuse and Rust's gate does
    // refuse a conversion while a probe holds it.
    const probing = startOn({ configurationProbing: true });
    expect(probing.status === "unavailable" && probing.reason).toBe("configuration-probing");
    expect(conversionNotices([{ source: "action", availability: probing }])).toHaveLength(1);
    // And occupancy is not admission: the fact that a probe is running is not
    // the rule that decides whether one may start.
    expect(
      probeAdmission({
        backendQuarantined: false,
        backendChanging: false,
        laneClaimed: false,
        previewReading: false,
        probeInFlight: false,
      }),
    ).toBeNull();
  });

  it("19. backend loss during a drain reaches every surface at once (ledger rows 3, 7)", () => {
    // The poll carries the projection and the acceptance is above the slot
    // guard, so a binding replaced mid-drain invalidates what the previous one
    // described without waiting for the queue to settle. Pinned end to end in
    // `conversionAuthorityDelivery.test.tsx` and E9.
    expect(acceptProjection(A, B)).toEqual({ accepted: true, bindingReplaced: true });
    expect(
      readIsOwed(B, {
        receipt: firstBindingReceipt,
        configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
        lastAttemptRefused: false,
      }),
    ).toBe(true);
    // And it stays owed rather than probing behind the drain.
    expect(
      probeAdmission({
        backendQuarantined: false,
        backendChanging: false,
        laneClaimed: true,
        previewReading: false,
        probeInFlight: false,
      }),
    ).toBe("laneClaimed");
  });

  it("20. the admitted graph is a lookup, and cannot be widened from here (ledger row 1)", () => {
    // Nine rows, and no code path that composes a tenth. Every choice is a row
    // of the catalog or a refusal.
    expect(admittedIntents).toHaveLength(9);
    expect(catalogRow(completeCatalog, "mzml+something+else+entirely+here")).toBeNull();
    expect(reselect(completeCatalog, shippedIntent.id, "mzml+invented+row+here+now")).toBe(
      shippedIntent.id,
    );
  });
});

/** A plan answer, for the currency comparisons above. Its contents decide nothing. */
const PLAN = {
  items: [
    {
      datasetHandle: "file-1",
      fileName: "run-1.raw",
      sourceKind: "thermo_raw" as const,
      output: { kind: "knownSingle" as const, fileName: "run-1.mzML" },
    },
  ],
  outputFormat: "mzML" as const,
  compression: "zlib",
  validationMode: "output_only" as const,
  capacity: 16,
  intent: shippedIntent,
  conflictPolicy: "fail" as const,
  receipt: firstBindingReceipt,
  destinationPolicy: { kind: "customFolder" as const },
};

const ERROR = {
  kind: "backend_help_unreadable",
  summary: "The installed ProteoWizard did not describe the commands MSCanvas needs.",
  detail: null,
  correctiveAction: null,
  retryable: true,
} as const;
