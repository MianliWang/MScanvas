/**
 * When the banner's reading has stopped describing the session, and when a
 * replacement for it may be asked for — the rules, before any hook uses them.
 *
 * `useBackendReadingObligation.test.tsx` pins the bounded issuance and
 * `backendReadingRecovery.test.tsx` pins the shipped wiring. What is pinned here
 * is the decision underneath: that currency is the revision and never the
 * receipt, that the check's admission is the probe's minus exactly one fact,
 * and that the fact this obligation raises for itself is not one it can be woken
 * by.
 */

import { describe, expect, it } from "vitest";

import type { BackendCheckFacts } from "./backendReadingObligation";
import {
  backendCheckAdmission,
  checkOccasionPassed,
  readingCheckIsOwed,
  readingIsStale,
} from "./backendReadingObligation";
import { firstBindingReceipt, settledAt } from "../../test/previewFixtures";

const FREE: BackendCheckFacts = {
  backendChanging: false,
  laneClaimed: false,
  previewReading: false,
  probeInFlight: false,
};

function facts(overrides: Partial<BackendCheckFacts> = {}): BackendCheckFacts {
  return { ...FREE, ...overrides };
}

/** One binding, three publications about it, and one about another build. */
const A = settledAt(5, firstBindingReceipt);
const A_LATER = settledAt(6, firstBindingReceipt);
const B = settledAt(7, firstBindingReceipt + 1);

describe("whether a reading still describes the session", () => {
  it("is decided by the revision, not by the receipt", () => {
    // The case this obligation exists for. A verdict can move while the receipt
    // stands still -- a truncated help stream is the one that does it -- and the
    // operation that saw it returns a new projection without producing a new
    // reading. Judged by receipt the old banner stays "current" and goes on
    // saying `available` after the session has stopped offering anything.
    expect(readingCheckIsOwed(A_LATER, A)).toBe(true);
    expect(readingIsStale(A_LATER, A)).toBe(true);
    // Same publication: nothing is owed and nothing is stale.
    expect(readingCheckIsOwed(A, A)).toBe(false);
    expect(readingIsStale(A, A)).toBe(false);
  });

  it("owes a check where no reading is rendered at all", () => {
    // A check in flight and a check that failed are both the absence of a
    // reading, which is one of Decision 4's two conditions.
    expect(readingCheckIsOwed(A, null)).toBe(true);
    // But nothing is *stale*, because there is nothing on screen to mislabel.
    expect(readingIsStale(A, null)).toBe(false);
  });

  it("owes nothing while the session has resolved nothing", () => {
    // That session owes the mount check, which is a different obligation with
    // different dispatch exemptions. Answering for it here would issue two.
    expect(readingCheckIsOwed(null, null)).toBe(false);
    expect(readingCheckIsOwed(null, A)).toBe(false);
    expect(readingIsStale(null, A)).toBe(false);
  });

  it("owes a check for a replacement, like any other newer publication", () => {
    expect(readingCheckIsOwed(B, A)).toBe(true);
    expect(readingIsStale(B, A)).toBe(true);
  });
});

describe("whether a remedial check may be dispatched", () => {
  it("refuses behind each process owner, in the shared order", () => {
    expect(backendCheckAdmission(FREE)).toBeNull();
    expect(backendCheckAdmission(facts({ backendChanging: true }))).toBe("backendChanging");
    expect(backendCheckAdmission(facts({ laneClaimed: true }))).toBe("laneClaimed");
    expect(backendCheckAdmission(facts({ previewReading: true }))).toBe("previewReading");
    expect(backendCheckAdmission(facts({ probeInFlight: true }))).toBe("probeInFlight");
    // The lane's own order, so a moment two authorities both defer on is named
    // identically by both.
    expect(backendCheckAdmission(facts({ laneClaimed: true, previewReading: true }))).toBe(
      "laneClaimed",
    );
  });

  it("consults no verdict, so a wrong one cannot prevent its own correction", () => {
    // `backendUsable` is not a member of these facts at all. The verdict a
    // stale reading carries is exactly what this check exists to repair.
    expect(Object.keys(FREE)).not.toContain("backendUsable");
    expect(Object.keys(FREE)).toHaveLength(4);
  });

  it("consults no quarantine, because a quarantined session answers it", () => {
    // Rust replies to `inspect_backend` from what it already holds and launches
    // nothing, so a check refused for quarantine would be refused for the very
    // condition it is able to report. The probe asks it; this does not.
    expect(Object.keys(FREE)).not.toContain("backendQuarantined");
  });
});

describe("what wakes an owed check", () => {
  it("counts a fact that was refusing ceasing to refuse", () => {
    expect(checkOccasionPassed(facts({ laneClaimed: true }), FREE)).toBe(true);
    expect(checkOccasionPassed(facts({ previewReading: true }), FREE)).toBe(true);
    expect(checkOccasionPassed(facts({ probeInFlight: true }), FREE)).toBe(true);
  });

  it("does not count a fact becoming true", () => {
    // "Stops refusing", never "changes". A drain starting is not an occasion to
    // ask the backend anything.
    expect(checkOccasionPassed(FREE, facts({ laneClaimed: true }))).toBe(false);
    expect(checkOccasionPassed(FREE, FREE)).toBe(false);
  });

  it("never counts the fact this obligation raises for itself", () => {
    // **The loop bound.** Every frontend-issued check raises `backendChanging`
    // and clears it in a `finally`, so the clearing is a fact ceasing to refuse
    // -- produced by the attempt itself. Counting it would re-issue a check
    // whose request failed, for ever, at IPC speed.
    expect(checkOccasionPassed(facts({ backendChanging: true }), FREE)).toBe(false);
    // And it is only that fact: a drain ending during the same window still
    // wakes it.
    expect(
      checkOccasionPassed(facts({ backendChanging: true, laneClaimed: true }), FREE),
    ).toBe(true);
  });
});
