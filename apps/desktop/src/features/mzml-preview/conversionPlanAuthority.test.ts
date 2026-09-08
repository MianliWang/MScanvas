/**
 * The plan machine, over the question it is asked.
 *
 * Every case here is a *race* stated as a table: two questions, two replies,
 * and which of them may reach the screen. They are unit tests because the rules
 * are decidable without React — what the wiring adds is when the questions
 * change, and that is pinned beside the production tree in
 * `conversionPlanLifecycle.test.tsx`.
 */

import { describe, expect, it } from "vitest";

import type { BackendAuthorityProjection, ConversionConfiguration } from "./contracts";
import {
  awaitsReply,
  currentPlan,
  installReply,
  planQuestion,
  planStep,
  retryStep,
  sameQuestion,
  startPlan,
  type ConversionPlanIdentity,
  type ConversionPlanState,
} from "./conversionPlanAuthority";
import { completeCatalog, previewError, settledAt, shippedIntent } from "../../test/previewFixtures";

const OTHER_INTENT = completeCatalog[1]!.intent;

function identity(overrides: Partial<ConversionPlanIdentity> = {}): ConversionPlanIdentity {
  return {
    handles: ["one"],
    intentId: shippedIntent.id,
    conflictPolicy: "fail",
    receipt: 1,
    destinationPolicy: { kind: "customFolder" },
    ...overrides,
  };
}

const READY_CONFIGURATION: ConversionConfiguration = {
  configuration: "ready",
  catalog: completeCatalog,
  shipped: shippedIntent.id,
};

function inputs(overrides: Partial<Parameters<typeof planQuestion>[0]> = {}) {
  return {
    handles: ["one"] as readonly string[],
    authority: settledAt(1, 1) as BackendAuthorityProjection | null,
    configuration: READY_CONFIGURATION as ConversionConfiguration | null,
    selectedIntentId: shippedIntent.id as string | null,
    conflictPolicy: "fail" as const,
    destinationPolicy: { kind: "customFolder" as const },
    ...overrides,
  };
}

/** The state a question in flight leaves behind, for the reply tables below. */
function loading(id: ConversionPlanIdentity, ordinal: number): ConversionPlanState {
  return { status: "loading", identity: id, ordinal };
}

const PLAN = {
  items: [{
    datasetHandle: "one", fileName: "one.raw", sourceKind: "thermo_raw",
    output: { kind: "knownSingle", fileName: "one.mzML" },
  }],
  outputFormat: "mzML",
  compression: "zlib",
  validationMode: "output_only",
  capacity: 16,
  intent: shippedIntent,
  conflictPolicy: "fail",
  receipt: 1,
  destinationPolicy: { kind: "customFolder" },
} as const;

describe("the plan question", () => {
  it("is none when nothing is selected, and says nothing about the build", () => {
    // A reader's own deselection explained with a sentence about ProteoWizard
    // is the conflation this state exists to keep apart.
    expect(planQuestion(inputs({ handles: [] }))).toEqual({ kind: "none" });
    expect(planQuestion(inputs({ handles: [], authority: null }))).toEqual({ kind: "none" });
  });

  it("is blocked, never loading, while the settings are not known", () => {
    for (const missing of [
      { authority: null },
      { configuration: null },
      { configuration: { configuration: "unattempted" } as ConversionConfiguration },
      { configuration: { configuration: "unavailableForBinding" } as ConversionConfiguration },
      {
        configuration: {
          configuration: "failed",
          error: previewError(),
        } as ConversionConfiguration,
      },
      { selectedIntentId: null },
    ]) {
      expect(planQuestion(inputs(missing))).toEqual({
        kind: "blocked",
        reason: "settingsUnknown",
      });
    }
  });

  it("is blocked when the chosen combination is one this build cannot run", () => {
    const narrow = completeCatalog.map((row) =>
      row.intent.id === OTHER_INTENT.id ? { ...row, available: false } : row,
    );
    expect(
      planQuestion(
        inputs({
          configuration: { ...READY_CONFIGURATION, catalog: narrow },
          selectedIntentId: OTHER_INTENT.id,
        }),
      ),
    ).toEqual({ kind: "blocked", reason: "selectionUnavailable" });
  });

  it("carries every fact that changes what the future queue means", () => {
    expect(planQuestion(inputs())).toEqual({
      kind: "ask",
      identity: {
        handles: ["one"],
        intentId: shippedIntent.id,
        conflictPolicy: "fail",
        receipt: 1,
        destinationPolicy: { kind: "customFolder" },
      },
    });
  });

  it("is a different question when any one of those facts moves", () => {
    const base = identity();
    expect(sameQuestion(base, identity())).toBe(true);
    for (const moved of [
      identity({ handles: ["two"] }),
      identity({ handles: ["one", "two"] }),
      // Order, because the order is what the reader is looking at.
      identity({ handles: ["two", "one"] }),
      identity({ intentId: OTHER_INTENT.id }),
      identity({ conflictPolicy: "skip" }),
      identity({ destinationPolicy: { kind: "sourceSibling" } }),
      identity({ destinationPolicy: { kind: "namedSubfolder", name: "Converted" } }),
      identity({ receipt: 2 }),
    ]) {
      expect(sameQuestion(base, moved)).toBe(false);
    }
  });

  it("is the same question at a newer authority revision on one receipt", () => {
    // The identity/ordering split, at the boundary that would give it away. A
    // preview verdict moving on a build that has not changed publishes a newer
    // projection at the same receipt, and it says nothing about the conversion
    // this plan describes -- so nothing here may treat it as a new question.
    const before = planQuestion(inputs({ authority: settledAt(4, 7) }));
    const after = planQuestion(inputs({ authority: settledAt(9, 7) }));
    expect(before.kind).toBe("ask");
    expect(after).toEqual(before);
  });
});

describe("destination and reply identity", () => {
  it("compares a subfolder name exactly, without trimming or case folding", () => {
    const named = identity({ destinationPolicy: { kind: "namedSubfolder", name: "Results" } });
    expect(sameQuestion(named, identity({ destinationPolicy: { kind: "namedSubfolder", name: "Results" } }))).toBe(true);
    for (const name of ["results", "Results ", "Other"]) {
      expect(sameQuestion(named, identity({ destinationPolicy: { kind: "namedSubfolder", name } }))).toBe(false);
    }
  });

  it("rejects a successful response whose own question differs from the request", () => {
    for (const changed of [
      { ...PLAN, receipt: 2 },
      { ...PLAN, intent: OTHER_INTENT },
      { ...PLAN, conflictPolicy: "skip" as const },
      { ...PLAN, destinationPolicy: { kind: "sourceSibling" as const } },
      { ...PLAN, items: [] },
    ]) {
      expect(installReply(loading(identity(), 3), identity(), 3, { kind: "plan", plan: changed }))
        .toMatchObject({ status: "failed", error: { kind: "conversion_plan_mismatch" } });
    }
  });
});

describe("the plan machine", () => {
  it("issues exactly where it moves to loading, and nowhere else", () => {
    // "No loading without a request in flight" as a property of the table
    // rather than a rule every call site remembers: the one step that produces
    // `loading` is the one step that says to issue.
    const steps = [
      planStep({ status: "none" }, planQuestion(inputs()), 1),
      planStep({ status: "none" }, planQuestion(inputs({ handles: [] })), 1),
      planStep({ status: "none" }, planQuestion(inputs({ authority: null })), 1),
      planStep(loading(identity(), 1), planQuestion(inputs()), 2),
      planStep({ status: "ready", identity: identity(), plan: PLAN }, planQuestion(inputs()), 2),
    ];
    expect(steps.map((step) => step.kind)).toEqual([
      "issue",
      "hold",
      "settle",
      "hold",
      "hold",
    ]);
  });

  it("leaves blocked the moment its cause stops holding, without the question changing", () => {
    // A machine that left `blocked` only on an identity change would pin the
    // plan for exactly the session that has just succeeded in reading its
    // settings.
    const blocked = planStep({ status: "none" }, planQuestion(inputs({ configuration: null })), 1);
    expect(blocked).toEqual({ kind: "settle", state: { status: "blocked", reason: "settingsUnknown" } });
    const released = planStep(
      { status: "blocked", reason: "settingsUnknown" },
      planQuestion(inputs()),
      1,
    );
    expect(released).toEqual({ kind: "issue", identity: identity(), ordinal: 1 });
  });

  it("returns to none rather than to blocked when the selection empties", () => {
    expect(
      planStep({ status: "ready", identity: identity(), plan: PLAN }, { kind: "none" }, 9),
    ).toEqual({ kind: "settle", state: { status: "none" } });
  });

  it("re-asks the same question on an explicit retry, at the next ordinal", () => {
    const failed: ConversionPlanState = {
      status: "failed",
      identity: identity(),
      error: previewError(),
    };
    expect(retryStep(failed, 5)).toEqual({ kind: "issue", identity: identity(), ordinal: 5 });
    // And nothing else re-asks: a machine whose failure re-issued itself would
    // be this document reacting to its own bookkeeping, for ever.
    expect(planStep(failed, planQuestion(inputs()), 5)).toEqual({ kind: "hold" });
    expect(retryStep({ status: "none" }, 5)).toEqual({ kind: "hold" });
    expect(retryStep(loading(identity(), 4), 5)).toEqual({ kind: "hold" });
  });
});

describe("which reply may install", () => {
  it("installs the answer to the request that is outstanding", () => {
    const current = loading(identity(), 3);
    expect(awaitsReply(current, identity(), 3)).toBe(true);
    expect(installReply(current, identity(), 3, { kind: "plan", plan: PLAN })).toEqual({
      status: "ready",
      identity: identity(),
      plan: PLAN,
    });
  });

  it("discards a late reply about a question the reader has moved on from", () => {
    // Each of these is one component of the question moving while a request is
    // in flight: the intent, the rows, the policy, and the installation.
    const inFlight = loading(identity({ intentId: OTHER_INTENT.id, handles: ["two"] }), 4);
    for (const late of [
      identity(),
      identity({ intentId: OTHER_INTENT.id }),
      identity({ handles: ["two"] }),
      identity({ handles: ["two"], intentId: OTHER_INTENT.id, conflictPolicy: "skip" }),
      identity({ handles: ["two"], intentId: OTHER_INTENT.id, receipt: 2 }),
    ]) {
      expect(installReply(inFlight, late, 4, { kind: "plan", plan: PLAN })).toBeNull();
    }
    // And the one that is about the question in flight installs.
    expect(
      installReply(inFlight, identity({ intentId: OTHER_INTENT.id, handles: ["two"] }), 4, {
        kind: "plan",
        plan: {
          ...PLAN,
          intent: OTHER_INTENT,
          items: PLAN.items.map((item) => ({ ...item, datasetHandle: "two" })),
        },
      }),
    ).toMatchObject({ status: "ready" });
  });

  it("discards a superseded request's reply even where a retry re-asked its question", () => {
    // The case identity alone cannot decide, and the reason an ordinal exists.
    // A retry asks the *same* question by design, so the earlier request's
    // reply matches it perfectly.
    const retrying = loading(identity(), 8);
    expect(installReply(retrying, identity(), 7, { kind: "plan", plan: PLAN })).toBeNull();
    expect(installReply(retrying, identity(), 8, { kind: "plan", plan: PLAN })).not.toBeNull();
  });

  it("discards a reply arriving into a state that is awaiting none", () => {
    // `ready` and `failed` are named rather than left to a rule about
    // identities: both still hold a matchable one, so a check written over
    // identity alone would install into them. `blocked` holds none at all,
    // which is where a plan built under the previous binding would land.
    const settled: ConversionPlanState[] = [
      { status: "none" },
      { status: "blocked", reason: "settingsUnknown" },
      { status: "ready", identity: identity(), plan: PLAN },
      { status: "failed", identity: identity(), error: previewError() },
    ];
    for (const state of settled) {
      expect(awaitsReply(state, identity(), 1)).toBe(false);
      expect(installReply(state, identity(), 1, { kind: "plan", plan: PLAN })).toBeNull();
      expect(installReply(state, identity(), 1, { kind: "failed", error: previewError() })).toBeNull();
    }
  });
});

describe("what the plan contributes to a start", () => {
  it("is ready only for an answer to the question being asked", () => {
    const question = planQuestion(inputs());
    expect(startPlan({ status: "ready", identity: identity(), plan: PLAN }, question)).toBe("ready");
    // The plan and the question it answers, in one value, so a control cannot
    // start something other than what the summary beside it describes.
    expect(currentPlan({ status: "ready", identity: identity(), plan: PLAN }, question)).toEqual({
      identity: identity(),
      plan: PLAN,
    });
  });

  it("reads a stale answer as one being worked out, never as the current plan", () => {
    // The state says `ready`; the question has moved. The answer may not stand
    // for a question it does not describe, and the replacement request is
    // issued by the very commit this render produces -- so what a reader is
    // told is that MSCanvas is working it out.
    const stale: ConversionPlanState = {
      status: "ready",
      identity: identity({ intentId: OTHER_INTENT.id }),
      plan: PLAN,
    };
    const question = planQuestion(inputs());
    expect(startPlan(stale, question)).toBe("reading");
    expect(currentPlan(stale, question)).toBeNull();
  });

  it("tells a failed plan from one being worked out, and both from a blocked one", () => {
    const question = planQuestion(inputs());
    expect(
      startPlan({ status: "failed", identity: identity(), error: previewError() }, question),
    ).toBe("failed");
    expect(startPlan(loading(identity(), 1), question)).toBe("reading");
    expect(startPlan({ status: "none" }, { kind: "none" })).toBe("absent");
    // And the two blocked reasons stay apart all the way to the control. One
    // is a wait for an answer that is coming; the other is a setting to change,
    // and a reader told the wrong one of those is told to do the wrong thing.
    expect(
      startPlan({ status: "none" }, { kind: "blocked", reason: "selectionUnavailable" }),
    ).toBe("selectionUnavailable");
    expect(startPlan({ status: "none" }, { kind: "blocked", reason: "settingsUnknown" })).toBe(
      "settingsUnknown",
    );
    // A failure about a question nobody is asking any more is not a failure to
    // put on screen.
    expect(
      startPlan(
        { status: "failed", identity: identity({ receipt: 2 }), error: previewError() },
        question,
      ),
    ).toBe("reading");
  });
});
