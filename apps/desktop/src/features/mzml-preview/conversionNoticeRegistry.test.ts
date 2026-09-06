/**
 * One DOM owner per availability fact — the rule, before any surface uses it.
 *
 * `ConversionPanel.test.tsx` and the browser suite prove the shipped document
 * has one element per fact. What is proved here is the decision underneath:
 * that two authorities speaking two vocabularies about one fact collapse to one
 * notice, that the surviving sentence is the fact's rather than either action's,
 * and that a reason belonging to a single action keeps its own words.
 */

import { describe, expect, it } from "vitest";

import type { ConversionAvailability, ConversionLane } from "./conversionAvailability";
import { conversionAvailability, conversionNoticeId } from "./conversionAvailability";
import type { ProbeRefusal } from "./conversionConfigurationAuthority";
import type { ConversionRefusal } from "./conversionNoticeRegistry";
import {
  CONVERSION_LANE_FACTS,
  conversionNotices,
  conversionRefusalNoticeId,
  isConversionLaneFact,
  probeRefusalFact,
} from "./conversionNoticeRegistry";

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

function startOn(overrides: Partial<ConversionLane>): ConversionAvailability {
  return conversionAvailability(
    { ...CLEAR, ...overrides },
    { kind: "start", targetCount: 1, plan: "ready" },
  );
}

function retryOn(overrides: Partial<ConversionLane>): ConversionAvailability {
  return conversionAvailability(
    { ...CLEAR, ...overrides },
    { kind: "retry", retryableFailureCount: 1, queueCompleted: true },
  );
}

function action(availability: ConversionAvailability): ConversionRefusal {
  return { source: "action", availability };
}

function probe(refusal: ProbeRefusal): ConversionRefusal {
  return { source: "probe", refusal };
}

describe("the facts a notice can be keyed on", () => {
  it("is exactly the lane's own fields", () => {
    // Nine, `backendUsable` included -- it is shared by every conversion action
    // and by nothing else, and omitting it would leave the refusal two actions
    // reach most often with no key at all.
    expect([...CONVERSION_LANE_FACTS]).toEqual([
      "backend-quarantined",
      "backend-changing",
      "backend-unavailable",
      "conversion-running",
      "preview-running",
      "configuration-probing",
      "adoption-running",
      "diagnostics-exporting",
      "workspace-settling",
    ]);
    expect(CONVERSION_LANE_FACTS).toHaveLength(Object.keys(CLEAR).length);
  });

  it("excludes every reason that belongs to one action", () => {
    // A missing target, a queue with nothing worth rerunning, and every plan
    // state are facts about the action asking. No two actions can be refused by
    // one of them, so none of them needs cross-action deduplication.
    for (const reason of [
      "no-convertible-target",
      "queue-not-retryable",
      "nothing-to-retry",
      "plan-reading",
      "plan-failed",
      "plan-settings-unknown",
      "plan-selection-unavailable",
    ] as const) {
      expect(isConversionLaneFact(reason)).toBe(false);
    }
  });
});

describe("the two vocabularies over one set of facts", () => {
  it("maps every probe refusal a reader can meet onto a lane fact", () => {
    expect(probeRefusalFact("backendQuarantined")).toBe("backend-quarantined");
    expect(probeRefusalFact("backendChanging")).toBe("backend-changing");
    expect(probeRefusalFact("laneClaimed")).toBe("conversion-running");
    expect(probeRefusalFact("previewReading")).toBe("preview-running");
  });

  it("gives a probe refused by another probe no key at all", () => {
    // It can refuse a probe, and nothing it refuses is ever rendered: the
    // settings retry is withdrawn for a probe's duration rather than disabled,
    // and an automatic read's refusal is bookkeeping. A key with no notice
    // behind it is dead specification carrying a test obligation.
    expect(probeRefusalFact("probeInFlight")).toBeNull();
    expect(conversionRefusalNoticeId(probe("probeInFlight"))).toBeNull();
    expect(conversionNotices([probe("probeInFlight")])).toEqual([]);
  });

  it("names one contended moment identically from either authority", () => {
    // A conversion holding the backend gate is one fact refusing two actions.
    // Keyed on the reason *word* the lane and the admission would emit two
    // notices for it, which is the defect this registry removes.
    const notices = conversionNotices([action(startOn({ laneClaimed: true })), probe("laneClaimed")]);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.id).toBe(conversionNoticeId("conversion-running"));
  });

  it("keeps two genuinely different facts apart", () => {
    // The lane considers `backendUsable`; admission does not, because a verdict
    // is not an owner. So an unusable build with a drain running refuses the
    // conversion for one fact and the probe for another, and collapsing them
    // would be the lie rather than the fix.
    const notices = conversionNotices([
      action(startOn({ backendUsable: false, laneClaimed: true })),
      probe("laneClaimed"),
    ]);
    expect(notices.map((notice) => notice.reason)).toEqual([
      "backend-unavailable",
      "conversion-running",
    ]);
  });
});

describe("what the surviving element says", () => {
  it("phrases a shared fact about the fact, not about either action", () => {
    const [notice] = conversionNotices([action(startOn({ laneClaimed: true }))]);
    expect(notice?.message).toBe("A conversion currently owns the ProteoWizard lane.");
    // The action-phrased sentence is untouched and stays on the control's own
    // decision, which is where it belongs.
    const decision = startOn({ laneClaimed: true });
    expect(decision.status === "unavailable" && decision.message).toBe(
      "Converting is unavailable while a conversion is running.",
    );
  });

  it("says the same thing whether one action points at it or three", () => {
    // A sentence that changed when a second action appeared would be exactly
    // the wobble the registry removes.
    const alone = conversionNotices([action(startOn({ backendChanging: true }))]);
    const crowded = conversionNotices([
      action(startOn({ backendChanging: true })),
      action(retryOn({ backendChanging: true })),
      probe("backendChanging"),
    ]);
    expect(crowded).toHaveLength(1);
    expect(crowded[0]?.message).toBe(alone[0]?.message);
  });

  it("names no action and no consequence in any shared sentence", () => {
    // Every fact sentence has to stay true whichever action is pointing at it.
    // "Converting is unavailable" beside a settings retry is a true sentence
    // about the wrong control.
    for (const fact of CONVERSION_LANE_FACTS) {
      const lane: Partial<ConversionLane> =
        fact === "backend-unavailable"
          ? { backendUsable: false }
          : ({
              "backend-quarantined": { backendQuarantined: true },
              "backend-changing": { backendChanging: true },
              "conversion-running": { laneClaimed: true },
              "preview-running": { previewReading: true },
              "configuration-probing": { configurationProbing: true },
              "adoption-running": { adopting: true },
              "diagnostics-exporting": { exportingDiagnostics: true },
              "workspace-settling": { workspaceSettling: true },
            }[fact] as Partial<ConversionLane>);
      const [notice] = conversionNotices([action(startOn(lane))]);
      expect(notice?.reason).toBe(fact);
      for (const forbidden of ["Converting is", "Try again", "cannot start", "You cannot"]) {
        expect(notice?.message).not.toContain(forbidden);
      }
    }
  });

  it("leaves an action's own reason in that action's words", () => {
    // A refused plan and an empty rerun belong to the one action asking, so
    // re-phrasing them away from it would lose what the reader can do.
    const [failed] = conversionNotices([
      action(conversionAvailability(CLEAR, { kind: "start", targetCount: 1, plan: "failed" })),
    ]);
    expect(failed?.message).toContain("Try describing it again.");
    const [empty] = conversionNotices([
      action(conversionAvailability(CLEAR, {
        kind: "retry",
        retryableFailureCount: 0,
        queueCompleted: true,
      })),
    ]);
    expect(empty?.message).toBe("Nothing in this queue would change on another attempt.");
  });
});

describe("what the registry emits", () => {
  it("says nothing for an action that is available, and nothing for one absent", () => {
    expect(conversionNotices([action(startOn({})), null])).toEqual([]);
    expect(conversionRefusalNoticeId(action(startOn({})))).toBeNull();
    expect(conversionRefusalNoticeId(null)).toBeNull();
  });

  it("orders by the lane's own precedence rather than by who asked first", () => {
    // The same set of refusals always produces the same document, whichever
    // order the panel happened to collect its decisions in.
    const forwards = conversionNotices([
      action(retryOn({ adopting: true })),
      action(startOn({ backendChanging: true })),
    ]);
    const backwards = conversionNotices([
      action(startOn({ backendChanging: true })),
      action(retryOn({ adopting: true })),
    ]);
    expect(forwards.map((notice) => notice.reason)).toEqual([
      "backend-changing",
      "adoption-running",
    ]);
    expect(backwards).toEqual(forwards);
  });

  it("mints one id per fact, and the control names that id", () => {
    // A probe holding the gate refuses `Convert` -- ADR 0043 forbids offering
    // an action the operation will refuse -- so the probe is a lane fact with a
    // rendered key of its own, and the control points at it.
    const refusal = action(startOn({ configurationProbing: true }));
    const notices = conversionNotices([refusal]);
    expect(notices.map((notice) => notice.id)).toEqual([
      "conversion-availability-configuration-probing",
    ]);
    expect(notices[0]?.message).toBe(
      "MSCanvas is reading the conversion options from ProteoWizard.",
    );
    expect(conversionRefusalNoticeId(refusal)).toBe(notices[0]?.id);
  });

  it("emits each id at most once, however many actions reach it", () => {
    const notices = conversionNotices([
      action(startOn({ backendQuarantined: true })),
      action(retryOn({ backendQuarantined: true })),
      probe("backendQuarantined"),
      action(startOn({ backendQuarantined: true })),
    ]);
    expect(notices).toHaveLength(1);
    expect(new Set(notices.map((notice) => notice.id)).size).toBe(notices.length);
  });
});
