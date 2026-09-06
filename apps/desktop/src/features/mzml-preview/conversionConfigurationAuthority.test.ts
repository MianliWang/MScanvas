import { describe, expect, it } from "vitest";

import {
  admissionStoppedRefusing,
  probeAdmission,
  readBypassesAdmission,
  readIsOwed,
  retryIsOffered,
  type ConfigurationHolding,
  type ProbeAdmissionFacts,
} from "./conversionConfigurationAuthority";
import type { RenderedAuthority } from "./backendAuthority";
import type { BackendAuthorityProjection, ConversionConfiguration } from "./contracts";

const FREE: ProbeAdmissionFacts = {
  backendQuarantined: false,
  backendChanging: false,
  laneClaimed: false,
  previewReading: false,
  probeInFlight: false,
};

function bound(
  receipt: number,
  binding: "installed" | "noInstallation" = "installed",
): RenderedAuthority {
  return {
    revision: receipt,
    state: { state: "settled", receipt, binding, previewAvailability: "usable" },
  };
}

const UNRESOLVED: BackendAuthorityProjection = { revision: 0, state: { state: "unresolved" } };

function holding(
  receipt: number | null,
  configuration: ConversionConfiguration | null,
  lastAttemptRefused = false,
): ConfigurationHolding {
  return { receipt, configuration, lastAttemptRefused };
}

const UNATTEMPTED: ConversionConfiguration = { configuration: "unattempted" };
const UNAVAILABLE: ConversionConfiguration = { configuration: "unavailableForBinding" };
const READY: ConversionConfiguration = { configuration: "ready", catalog: [], shipped: "shipped" };
const FAILED: ConversionConfiguration = {
  configuration: "failed",
  error: {
    kind: "conversion_capability_unavailable",
    summary: "no",
    detail: null,
    retryable: false,
  },
};

describe("probe admission", () => {
  it("admits a probe when nothing owns a backend process", () => {
    expect(probeAdmission(FREE)).toBeNull();
  });

  it("consults the facts in one order, so one moment has one reason", () => {
    // `laneClaimed` before `previewReading` in particular: they are independent
    // and routinely true together, so the other order would key one moment as
    // "preview running" while the lane called the same moment "conversion
    // running". Probe-in-flight is last because it is the narrowest fact here.
    const all: ProbeAdmissionFacts = {
      backendQuarantined: true,
      backendChanging: true,
      laneClaimed: true,
      previewReading: true,
      probeInFlight: true,
    };
    expect(probeAdmission(all)).toBe("backendQuarantined");
    expect(probeAdmission({ ...all, backendQuarantined: false })).toBe("backendChanging");
    expect(probeAdmission({ ...all, backendQuarantined: false, backendChanging: false })).toBe(
      "laneClaimed",
    );
    expect(probeAdmission({ ...FREE, previewReading: true, probeInFlight: true })).toBe(
      "previewReading",
    );
    expect(probeAdmission({ ...FREE, probeInFlight: true })).toBe("probeInFlight");
  });

  it("takes the lane whole, picker included", () => {
    // Broader than the gate -- the destination picker owns no backend process
    // at all -- and taken anyway. A courtesy may be conservative, and what
    // keeps that from being a stall is that the picker closing is itself an
    // occasion.
    expect(probeAdmission({ ...FREE, laneClaimed: true })).toBe("laneClaimed");
  });
});

describe("what admission deliberately does not consult", () => {
  it("has no member for the preview verdict", () => {
    // A judgement, not process ownership. Reading it here would put preview
    // usability in the permission path for an msconvert probe, which is the
    // conflation the two-judgement split exists to remove -- and it is why this
    // is not `ConversionLane`, whose own first question is that verdict.
    expect(Object.keys(FREE)).toEqual([
      "backendQuarantined",
      "backendChanging",
      "laneClaimed",
      "previewReading",
      "probeInFlight",
    ]);
  });
});

describe("the read a binding owes", () => {
  it("is owed while nothing is held for the binding on screen", () => {
    // Not a judgement about the configuration: an observation about this
    // frontend's own state. It holds nothing for this binding, so it asks --
    // the same act as a mount, one binding later.
    expect(readIsOwed(bound(2), holding(null, null))).toBe(true);
  });

  it("is owed while the held snapshot describes another binding", () => {
    expect(readIsOwed(bound(2), holding(1, READY))).toBe(true);
  });

  it("is read from the snapshot rather than derived", () => {
    expect(readIsOwed(bound(2), holding(2, UNATTEMPTED))).toBe(true);
    expect(readIsOwed(bound(2), holding(2, READY))).toBe(false);
    expect(readIsOwed(bound(2), holding(2, FAILED))).toBe(false);
    expect(readIsOwed(bound(2), holding(2, UNAVAILABLE))).toBe(false);
  });

  it("is not owed by a session that has resolved nothing", () => {
    // A read is issued only for a rendered binding. What an unresolved session
    // owes is a backend check, and asking for settings would be asking about an
    // installation that has not been established.
    expect(readIsOwed(null, holding(null, null))).toBe(false);
    expect(readIsOwed(UNRESOLVED, holding(null, null))).toBe(false);
  });
});

describe("the binding that names no installation", () => {
  it("is read without consulting admission", () => {
    // There is no probe to admit. Deferring it behind somebody else's
    // conversion would leave the panel with no configuration state for the
    // length of that drain -- and this side may not fill that in from the
    // binding tag itself.
    expect(readBypassesAdmission(bound(2, "noInstallation"))).toBe(true);
  });

  it("is the only binding that does", () => {
    expect(readBypassesAdmission(bound(2))).toBe(false);
    expect(readBypassesAdmission(UNRESOLVED)).toBe(false);
    expect(readBypassesAdmission(null)).toBe(false);
  });
});

describe("the explicit retry", () => {
  it("is offered where there is an answer a read could improve on", () => {
    expect(retryIsOffered(holding(2, FAILED), false)).toBe(true);
    expect(retryIsOffered(holding(2, UNATTEMPTED, true), false)).toBe(true);
  });

  it("is not offered from a state a read cannot improve", () => {
    // `unavailableForBinding` follows from the binding, and only a different
    // binding changes it. A control saying "read the settings" would be a
    // button that cannot do anything.
    expect(retryIsOffered(holding(2, UNAVAILABLE), false)).toBe(false);
    expect(retryIsOffered(holding(2, READY), false)).toBe(false);
  });

  it("is not offered before the automatic read has been tried", () => {
    // The automatic read is the thing about to happen, and a control here would
    // ask for it twice.
    expect(retryIsOffered(holding(2, UNATTEMPTED, false), false)).toBe(false);
  });

  it("is not offered while a probe is in flight", () => {
    expect(retryIsOffered(holding(2, FAILED), true)).toBe(false);
    expect(retryIsOffered(holding(2, UNATTEMPTED, true), true)).toBe(false);
  });

  it("is not offered while nothing is held at all", () => {
    expect(retryIsOffered(holding(null, null), false)).toBe(false);
  });
});

describe("an occasion", () => {
  it("is a fact that was refusing ceasing to refuse", () => {
    expect(admissionStoppedRefusing({ ...FREE, laneClaimed: true }, FREE)).toBe(true);
  });

  it("is any such fact, not only the one a read was deferred on", () => {
    expect(admissionStoppedRefusing({ ...FREE, previewReading: true }, FREE)).toBe(true);
  });

  it("is never a fact becoming true", () => {
    // "Stops refusing" rather than "goes false": a build becoming usable is an
    // occasion, and a build becoming unusable is not.
    expect(admissionStoppedRefusing(FREE, { ...FREE, laneClaimed: true })).toBe(false);
  });

  it("is not an unchanged world", () => {
    // The poll ticks through a whole drain without anything moving, and the
    // answer to the last attempt arrives without anything moving either. A
    // read deferred by that drain must not be re-issued on either.
    expect(admissionStoppedRefusing(FREE, FREE)).toBe(false);
    const busy = { ...FREE, laneClaimed: true };
    expect(admissionStoppedRefusing(busy, busy)).toBe(false);
  });
});
