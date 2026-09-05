import { describe, expect, it } from "vitest";

import {
  acceptProjection,
  describesRenderedBinding,
  readingIsSuperseded,
  receiptOf,
  type RenderedAuthority,
} from "./backendAuthority";
import type { BackendAuthorityProjection } from "./contracts";

function settled(
  revision: number,
  receipt: number,
  previewAvailability: "usable" | "unusable" = "usable",
): BackendAuthorityProjection {
  return {
    revision,
    state: { state: "settled", receipt, binding: "installed", previewAvailability },
  };
}

const UNRESOLVED: BackendAuthorityProjection = { revision: 0, state: { state: "unresolved" } };

function rendered(projection: BackendAuthorityProjection): RenderedAuthority {
  return { revision: projection.revision, receipt: receiptOf(projection) };
}

describe("ordering, by revision alone", () => {
  it("accepts the first projection a session receives", () => {
    // Not a special case so much as the absence of one: with nothing rendered
    // there is no revision to be older than.
    expect(acceptProjection(null, UNRESOLVED)).toEqual({
      accepted: true,
      bindingReplaced: false,
    });
  });

  it("discards a projection older than what is rendered", () => {
    // The case a receipt cannot decide. This reply is about a build the session
    // has already left, and installing it would revoke the build it is on.
    expect(acceptProjection(rendered(settled(4, 2)), settled(3, 1))).toEqual({ accepted: false });
  });

  it("leaves the rendered authority standing on an equal revision", () => {
    // The same publication, arriving twice. Nothing about the session changed,
    // so nothing is invalidated — the payload beside it is judged separately.
    expect(acceptProjection(rendered(settled(4, 2)), settled(4, 2))).toEqual({ accepted: false });
  });

  it("accepts a newer projection", () => {
    expect(acceptProjection(rendered(settled(4, 2)), settled(5, 2))).toEqual({
      accepted: true,
      bindingReplaced: false,
    });
  });
});

describe("invalidation, by receipt", () => {
  it("is triggered by the binding being replaced", () => {
    expect(acceptProjection(rendered(settled(4, 2)), settled(5, 3))).toEqual({
      accepted: true,
      bindingReplaced: true,
    });
  });

  it("is not triggered by a verdict moving at one receipt", () => {
    // The truncated-help-stream case: the same installation, `available` on one
    // reading and not on the next. That is news about a build, so the revision
    // advances — but nothing read from that build has stopped describing it,
    // and discarding the table and the spectrum would throw away work the user
    // can still see is theirs.
    expect(acceptProjection(rendered(settled(4, 2)), settled(5, 2, "unusable"))).toEqual({
      accepted: true,
      bindingReplaced: false,
    });
  });

  it("treats becoming unresolved as a replacement", () => {
    // Unreachable in practice — nothing unresolves a settled session — and
    // stated because the alternative is worse: a projection naming no binding
    // beside a catalog that names one.
    expect(acceptProjection(rendered(settled(4, 2)), { ...UNRESOLVED, revision: 5 })).toEqual({
      accepted: true,
      bindingReplaced: true,
    });
  });

  it("counts the first settled binding as an installation, not a replacement", () => {
    // Nothing was rendered, so nothing read from a previous build exists to
    // discard. Reporting a replacement here would clear a session that had
    // never held anything.
    expect(acceptProjection(null, settled(1, 1))).toEqual({
      accepted: true,
      bindingReplaced: false,
    });
  });
});

describe("payloads, by receipt", () => {
  it("admits a payload describing the rendered binding whatever the revision did", () => {
    expect(describesRenderedBinding(rendered(settled(9, 2)), 2)).toBe(true);
  });

  it("discards a payload describing another binding", () => {
    expect(describesRenderedBinding(rendered(settled(9, 3)), 2)).toBe(false);
  });

  it("discards a payload with no binding, and one that arrives before any", () => {
    // Neither can be shown to describe what is rendered, and "cannot be shown
    // to" is the answer: this test is total rather than a guess.
    expect(describesRenderedBinding(rendered(settled(9, 2)), null)).toBe(false);
    expect(describesRenderedBinding(null, 2)).toBe(false);
  });
});

describe("a rendered reading's currency", () => {
  it("stands while its revision is the authority's", () => {
    expect(readingIsSuperseded(rendered(settled(4, 2)), settled(4, 2))).toBe(false);
  });

  it("is superseded by a verdict that moved at one receipt", () => {
    // Receipt equality is too weak here by exactly this case: the build is the
    // same one, and what it can do has changed.
    expect(readingIsSuperseded(rendered(settled(5, 2)), settled(4, 2))).toBe(true);
  });

  it("has nothing to be superseded against before the first answer", () => {
    expect(readingIsSuperseded(null, settled(4, 2))).toBe(false);
  });
});
