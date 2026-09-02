/**
 * One conversion rule, decided in one place.
 *
 * Before this slice the question "may this conversion action execute now?" had
 * four answers: an ad-hoc boolean in the workspace, a strictly narrower guard
 * in the operation, a ref raised at dispatch that no render could see, and a
 * `canRetry` that was computed and read by nothing while the `Retry` control
 * answered to the start control's boolean instead.
 *
 * So what these tests are about is the decision rather than the transport.
 * Which surfaces ask it and what the operation does with the answer are pinned
 * beside the production wiring in `conversionLaneAuthority.test.tsx`; what is
 * settled here is that the decision itself is total, ordered, and different for
 * the two actions in exactly the places the domain says it is.
 */

import { describe, expect, it } from "vitest";

import type { ConversionLane, ConversionUnavailableReason } from "./conversionAvailability";
import {
  canRetryConversion,
  canStartConversion,
  conversionAvailability,
  conversionNoticeId,
} from "./conversionAvailability";

/** A lane with nothing wrong with it. Each case names only what it changes. */
const CLEAR: ConversionLane = {
  backendUsable: true,
  backendChanging: false,
  backendQuarantined: false,
  previewReading: false,
  laneClaimed: false,
  adopting: false,
  exportingDiagnostics: false,
  workspaceSettling: false,
};

function lane(overrides: Partial<ConversionLane> = {}): ConversionLane {
  return { ...CLEAR, ...overrides };
}

/** The reason a start is refused for, or `null` where it is not refused. */
function startReason(overrides: Partial<ConversionLane>, targetCount = 1) {
  const decision = conversionAvailability(lane(overrides), { kind: "start", targetCount });
  return decision.status === "available" ? null : decision.reason;
}

/** The reason a rerun is refused for, over a queue with one retryable failure. */
function retryReason(
  overrides: Partial<ConversionLane>,
  retryableFailureCount = 1,
  queueCompleted = true,
) {
  const decision = conversionAvailability(lane(overrides), {
    kind: "retry",
    retryableFailureCount,
    queueCompleted,
  });
  return decision.status === "available" ? null : decision.reason;
}

describe("the conversion lane's availability decision", () => {
  it("starts an ordinary conversion on a clear lane", () => {
    expect(conversionAvailability(CLEAR, { kind: "start", targetCount: 1 })).toEqual({
      status: "available",
    });
    // No message on the way through. A control that can be used has nothing to
    // explain, and an explanation shown beside a working control is a reason to
    // doubt it.
    expect(Object.keys(conversionAvailability(CLEAR, { kind: "start", targetCount: 3 }))).toEqual([
      "status",
    ]);
  });

  it("refuses a start for each lane fact, one reason each", () => {
    // The whole closed set of lane facts, each alone. A fact that stopped
    // deciding anything would show up here as a null.
    expect(startReason({ backendQuarantined: true })).toBe("backend-quarantined");
    expect(startReason({ backendChanging: true })).toBe("backend-changing");
    expect(startReason({ backendUsable: false })).toBe("backend-unavailable");
    expect(startReason({ laneClaimed: true })).toBe("conversion-running");
    expect(startReason({ previewReading: true })).toBe("preview-running");
    expect(startReason({ adopting: true })).toBe("adoption-running");
    expect(startReason({ exportingDiagnostics: true })).toBe("diagnostics-exporting");
    expect(startReason({ workspaceSettling: true })).toBe("workspace-settling");
  });

  it("refuses a start with nothing to convert, and only once the lane is clear", () => {
    expect(startReason({}, 0)).toBe("no-convertible-target");
    // The target is last on purpose. "Select something to convert", said while a
    // conversion is running, is a true sentence about the wrong problem -- and
    // it is the sentence the reader would act on.
    expect(startReason({ laneClaimed: true }, 0)).toBe("conversion-running");
  });

  it("names the fact that decides when several hold at once", () => {
    // A conversion running during an installation check against a backend this
    // session had already stopped trusting. Waiting clears two of those three,
    // and naming either of them would tell the reader to wait for something
    // that is never going to arrive.
    expect(
      startReason({ backendQuarantined: true, backendChanging: true, laneClaimed: true }),
    ).toBe("backend-quarantined");
    // A check reports the backend as not usable for as long as it runs, so
    // reading that as a verdict tells the reader their installation is broken
    // every time it is looked at.
    expect(startReason({ backendChanging: true, backendUsable: false })).toBe("backend-changing");
    // And the things that end by themselves rank under the things that do not.
    expect(startReason({ backendUsable: false, laneClaimed: true })).toBe("backend-unavailable");
    expect(startReason({ laneClaimed: true, previewReading: true, adopting: true })).toBe(
      "conversion-running",
    );
    expect(startReason({ adopting: true, exportingDiagnostics: true })).toBe("adoption-running");
    expect(startReason({ exportingDiagnostics: true, workspaceSettling: true })).toBe(
      "diagnostics-exporting",
    );
  });

  it("gives a rerun the same lane and a different target", () => {
    // Every lane fact refuses a rerun for the same reason it refuses a start.
    // The lane is one lane; a second set of reasons for the second control is
    // exactly the drift this authority exists to prevent.
    for (const overrides of [
      { backendQuarantined: true },
      { backendChanging: true },
      { backendUsable: false },
      { laneClaimed: true },
      { previewReading: true },
      { adopting: true },
      { exportingDiagnostics: true },
      { workspaceSettling: true },
    ] as const) {
      expect(retryReason(overrides)).toBe(startReason(overrides));
    }
  });

  it("refuses a rerun of a queue that was stopped rather than finished", () => {
    // A stopped queue is a decision the user made about the whole batch, and one
    // whose stop could not be confirmed must launch nothing at all.
    expect(retryReason({}, 1, false)).toBe("queue-not-retryable");
    expect(retryReason({}, 0, true)).toBe("nothing-to-retry");
  });

  it("lets the two actions disagree, in both directions, on one lane", () => {
    // This is the property `canRetry` had and no control read. A rerun and a
    // start are different operations over the same backend, and a repository
    // where they agree everywhere is one where the second rule went missing.
    const clear = lane();

    // Nothing selected to convert; a finished queue with a failure worth
    // rerunning. The start is refused and the rerun is not.
    expect(canStartConversion(clear, 0)).toBe(false);
    expect(canRetryConversion(clear, 1, true)).toBe(true);

    // And the reverse: rows to convert, beside a queue that has nothing left
    // another attempt could change.
    expect(canStartConversion(clear, 2)).toBe(true);
    expect(canRetryConversion(clear, 0, true)).toBe(false);
  });

  it("says something a reader can act on for every refusal", () => {
    const reasons: readonly ConversionUnavailableReason[] = [
      "backend-quarantined",
      "backend-changing",
      "backend-unavailable",
      "conversion-running",
      "preview-running",
      "adoption-running",
      "diagnostics-exporting",
      "workspace-settling",
      "no-convertible-target",
      "queue-not-retryable",
      "nothing-to-retry",
    ];
    const said = new Set<string>();
    for (const reason of reasons) {
      const decision = conversionAvailability(
        lane(laneFor(reason)),
        reason === "queue-not-retryable" || reason === "nothing-to-retry"
          ? {
              kind: "retry",
              retryableFailureCount: reason === "nothing-to-retry" ? 0 : 1,
              queueCompleted: reason === "nothing-to-retry",
            }
          : { kind: "start", targetCount: reason === "no-convertible-target" ? 0 : 1 },
      );
      expect(decision.status).toBe("unavailable");
      if (decision.status === "unavailable") {
        expect(decision.reason).toBe(reason);
        // A sentence, not a code. Nothing here may name a lane, a ref, a claim
        // or a slot: that describes the machinery that refused rather than the
        // situation the reader is in.
        expect(decision.message).toMatch(/^[A-Z].*\.$/su);
        expect(decision.message).not.toMatch(/\b(ref|slot|lane|claim|boolean|flag)\b/iu);
        // And each says its own thing, so two controls refused for two facts
        // cannot read as one explanation repeated.
        expect(said.has(decision.message)).toBe(false);
        said.add(decision.message);
      }
    }
    expect(said.size).toBe(reasons.length);
  });

  it("gives each reason one place on screen to be said", () => {
    expect(conversionNoticeId("backend-unavailable")).toBe(
      "conversion-availability-backend-unavailable",
    );
    // Keyed by reason rather than by control, which is what lets two controls
    // refused by the same lane fact point at one sentence instead of two.
    expect(conversionNoticeId("conversion-running")).toBe(
      conversionNoticeId("conversion-running"),
    );
    expect(conversionNoticeId("conversion-running")).not.toBe(
      conversionNoticeId("preview-running"),
    );
  });
});

/** The one lane fact that produces each reason, for the message sweep above. */
function laneFor(reason: ConversionUnavailableReason): Partial<ConversionLane> {
  switch (reason) {
    case "backend-quarantined":
      return { backendQuarantined: true };
    case "backend-changing":
      return { backendChanging: true };
    case "backend-unavailable":
      return { backendUsable: false };
    case "conversion-running":
      return { laneClaimed: true };
    case "preview-running":
      return { previewReading: true };
    case "adoption-running":
      return { adopting: true };
    case "diagnostics-exporting":
      return { exportingDiagnostics: true };
    case "workspace-settling":
      return { workspaceSettling: true };
    // The three target reasons are reached on a clear lane, by the action.
    case "no-convertible-target":
    case "queue-not-retryable":
    case "nothing-to-retry":
      return {};
  }
}
