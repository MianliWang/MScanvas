import { describe, expect, it } from "vitest";

import {
  backendBindingIdentity,
  sameBackendBinding,
  settledBackendBinding,
  UNRESOLVED_BACKEND_BINDING,
} from "./backendBinding";
import type { BackendAvailability } from "./contracts";

/**
 * The one distinction this type exists to make.
 *
 * A binding is what a settled verdict says; it is not what a check is doing.
 * These cases pin the algebra the catalog lane relies on -- and the one that
 * matters most is the equality: a healthy recheck of an unchanged installation
 * produces a verdict that must compare *equal* to the one already held, or the
 * lane spends a help probe proving what is already on screen.
 */

function verdict(overrides: Partial<BackendAvailability> = {}): BackendAvailability {
  return {
    state: "available",
    origin: "automatic",
    installationGeneration: 0,
    release: "3.0.24000",
    buildDate: null,
    sameInstallation: true,
    failure: null,
    ...overrides,
  };
}

describe("the installation a settled verdict binds a session to", () => {
  it("carries the verdict and the generation as one value", () => {
    expect(settledBackendBinding(verdict({ installationGeneration: 4 }))).toEqual({
      status: "available",
      installationGeneration: 4,
    });
    expect(
      settledBackendBinding(verdict({ state: "unavailable", installationGeneration: 4 })),
    ).toEqual({ status: "unavailable", installationGeneration: 4 });
  });

  it("calls two readings of the same installation the same binding", () => {
    // The G1 property. Rechecking a healthy build produces a second verdict
    // object naming the first build, and treating that as news is what revoked
    // a good catalog and paid for a second probe.
    const first = settledBackendBinding(verdict({ release: "3.0.24000" }));
    const again = settledBackendBinding(verdict({ release: "3.0.24000", origin: "chosen" }));
    expect(sameBackendBinding(first, again)).toBe(true);
    expect(backendBindingIdentity(first)).toBe(backendBindingIdentity(again));
  });

  it("separates a different installation, a different verdict, and no verdict at all", () => {
    const availableHere = settledBackendBinding(verdict({ installationGeneration: 1 }));
    const availableThere = settledBackendBinding(verdict({ installationGeneration: 2 }));
    const goneHere = settledBackendBinding(
      verdict({ state: "unavailable", installationGeneration: 1 }),
    );

    // A newer installation is a different binding.
    expect(sameBackendBinding(availableHere, availableThere)).toBe(false);
    // So is the same installation reported gone -- which is the transition that
    // must revoke a catalog, as distinct from a check merely running.
    expect(sameBackendBinding(availableHere, goneHere)).toBe(false);
    // And *no verdict yet* is not a quiet spelling of "unavailable": a session
    // that has not established anything must not revoke, and must not probe.
    expect(sameBackendBinding(UNRESOLVED_BACKEND_BINDING, goneHere)).toBe(false);
    expect(sameBackendBinding(UNRESOLVED_BACKEND_BINDING, UNRESOLVED_BACKEND_BINDING)).toBe(true);
  });

  it("gives each binding one identity a consumer can record", () => {
    expect(backendBindingIdentity(UNRESOLVED_BACKEND_BINDING)).toBe("unresolved");
    expect(backendBindingIdentity(settledBackendBinding(verdict({ installationGeneration: 3 })))).toBe(
      "available:3",
    );
    expect(
      backendBindingIdentity(
        settledBackendBinding(verdict({ state: "unavailable", installationGeneration: 3 })),
      ),
    ).toBe("unavailable:3");
    // The three are distinct as strings, which is what makes recording one of
    // them a sound answer to "have I already acted on this?".
    expect(
      new Set([
        backendBindingIdentity(UNRESOLVED_BACKEND_BINDING),
        backendBindingIdentity(settledBackendBinding(verdict({ installationGeneration: 3 }))),
        backendBindingIdentity(
          settledBackendBinding(verdict({ state: "unavailable", installationGeneration: 3 })),
        ),
      ]).size,
    ).toBe(3);
  });
});
