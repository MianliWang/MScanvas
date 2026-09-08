/**
 * A configuration probe owns the backend process lane, and the panel says so.
 *
 * `useConversionProbeLane.test.tsx` pins the claim's own rules. What is pinned
 * here is that the shipped tree raises that claim at an admitted dispatch,
 * releases it on that exact probe's settlement, and consumes it as a
 * conversion-lane fact — through `usePreviewWorkspace` and the real panel, so a
 * wiring that stopped asking would fail even while the claim itself stayed
 * correct.
 *
 * **The distinction the whole area exists to keep** is asserted directly:
 *
 * ```text
 * ConversionLane.configurationProbing
 *     "is a configuration probe occupying the process lane?"
 *
 * ConversionConfigurationProbeAdmission
 *     "may a new configuration probe acquire that lane?"
 * ```
 *
 * Neither answers for the other. ADR 0044 Decision 10 puts the first in
 * `Convert`'s way (ledger rows 79 and 187: ADR 0043 forbids offering an action
 * the operation will refuse, and Rust's gate does refuse it); Decision 11 keeps
 * the second in Rust's gate and quarantine boundary.
 *
 * Every window below is driven by a controlled promise. A read that resolves in
 * the same microtask is a read nothing can be true *during*.
 */

import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type { ConversionConfigurationSnapshot, SelectedFile } from "./contracts";
import type { ConversionAvailability, ConversionLane } from "./conversionAvailability";
import { conversionAvailability } from "./conversionAvailability";
import { probeAdmission } from "./conversionConfigurationAuthority";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import { App } from "../../app/App";
import type { Deferred, FakePreviewApi, FakePreviewApiOptions } from "../../test/previewFixtures";
import {
  availableBackend,
  completeCatalog,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  firstBindingReceipt,
  planIdentity,
  previewError,
  settledAt,
  shippedIntent,
} from "../../test/previewFixtures";

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const VENDOR = acquisition(1);

const READY: ConversionConfigurationSnapshot = {
  authority: settledAt(1, firstBindingReceipt),
  configuration: {
    configuration: "ready",
    catalog: completeCatalog,
    shipped: shippedIntent.id,
  },
  outcome: { outcome: "answered" },
};

const FAILED: ConversionConfigurationSnapshot = {
  authority: settledAt(1, firstBindingReceipt),
  configuration: {
    configuration: "failed",
    error: previewError({ kind: "backend_help_unreadable" }),
  },
  outcome: { outcome: "answered" },
};

/**
 * A configuration boundary this test answers one read at a time.
 *
 * Every read is recorded and handed its own promise, so a test can hold the
 * lane open, count what was actually launched, and answer reads out of order.
 */
function heldReads(): {
  readonly issued: Deferred<ConversionConfigurationSnapshot>[];
  readonly answer: (index: number, snapshot?: ConversionConfigurationSnapshot) => void;
  readonly conversionConfiguration: () => Promise<ConversionConfigurationSnapshot>;
} {
  const issued: Deferred<ConversionConfigurationSnapshot>[] = [];
  return {
    issued,
    answer: (index, snapshot) => {
      issued[index]!.resolve(snapshot ?? READY);
    },
    conversionConfiguration: () => {
      const next = deferred<ConversionConfigurationSnapshot>();
      issued.push(next);
      return next.promise;
    },
  };
}

function mountHook(api: PreviewApi) {
  return renderHook(() => usePreviewWorkspace(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        WorkspaceDropTransportProvider,
        { value: createFakeWorkspaceDropTransport() },
        createElement(PreviewApiProvider, { value: api }, children),
      ),
  });
}

function mountApp(options: FakePreviewApiOptions = {}): FakePreviewApi {
  const api = createFakePreviewApi({
    initialDatasets: [VENDOR],
    availability: availableBackend,
    ...options,
  });
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  return api;
}

/**
 * The start decision the panel makes, from the lane the hook is holding.
 *
 * The rule the panel calls, over the lane the operation guards with. A test
 * that re-stated the precedence here would be testing its own arithmetic.
 */
function startDecision(lane: ConversionLane): ConversionAvailability {
  return conversionAvailability(lane, { kind: "start", targetCount: 1, plan: "ready" });
}

/** How many configuration reads actually crossed the boundary. */
function probeCount(api: FakePreviewApi): number {
  return api.calls().filter((command) => command === "readConversionConfiguration").length;
}

function heldApi(reads: ReturnType<typeof heldReads>): FakePreviewApi {
  return createFakePreviewApi({
    initialDatasets: [VENDOR],
    availability: availableBackend,
    conversionConfiguration: reads.conversionConfiguration,
  });
}

describe("an automatic read occupies the lane", () => {
  it("claims it the moment the read is admitted, and refuses a conversion for it", async () => {
    const reads = heldReads();
    const workspace = mountHook(heldApi(reads));

    // The first read for the binding, which nothing asked for: the lifecycle
    // reaching `Unattempted` is what initiates it.
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });
    const { lane } = workspace.result.current.conversion;
    expect(lane.configurationProbing).toBe(true);
    // And the refusal is the probe's, not a verdict about the build. "No usable
    // backend" is a sentence a reader would act on by reinstalling something
    // that is perfectly fine; the lane is busy, briefly.
    expect(lane.backendUsable).toBe(true);
    const decision = startDecision(lane);
    expect(decision.status).toBe("unavailable");
    expect(decision.status === "unavailable" && decision.reason).toBe("configuration-probing");
  });

  it("refuses a dispatch that reaches the handler while the probe is outstanding", async () => {
    // **The ref half, and the only assertion that can tell it from the rendered
    // half.** A handler reads the lane from refs, not from the struct a render
    // made -- so a probe occupancy that reached only the rendered lane would
    // grey the control and still let a dispatch through, which is the exact
    // shape M6.1 removed for every other fact here.
    const reads = heldReads();
    const api = heldApi(reads);
    const workspace = mountHook(api);
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });

    act(() => {
      workspace.result.current.conversion.convert(planIdentity([VENDOR.handle]));
    });
    expect(api.beginRequests()).toHaveLength(0);
    expect(workspace.result.current.conversion.lane.laneClaimed).toBe(false);

    // And it goes through the moment the lane is handed back, so what refused
    // it was the probe rather than anything durable.
    await act(async () => {
      reads.answer(0);
      await reads.issued[0]!.promise;
    });
    await waitFor(() => {
      expect(workspace.result.current.conversion.lane.configurationProbing).toBe(false);
    });
    act(() => workspace.result.current.conversionPlan.describe([VENDOR.handle]));
    await waitFor(() => expect(workspace.result.current.conversionPlan.current).not.toBeNull());
    act(() => {
      workspace.result.current.conversion.convert(workspace.result.current.conversionPlan.current!.identity);
    });
    expect(api.beginRequests()).toHaveLength(1);
  });

  it("ranks below the two process owners above it, and above everything that owns none", async () => {
    // Admission consults these same facts in this same order and puts
    // probe-in-flight last, so admission's order stays a subsequence of the
    // lane's -- which is what stops one contended moment being keyed
    // `conversion-running` by the lane and `preview-running` by admission.
    const reads = heldReads();
    const workspace = mountHook(heldApi(reads));
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });
    const { lane } = workspace.result.current.conversion;

    const outranked = startDecision({ ...lane, laneClaimed: true });
    expect(outranked.status === "unavailable" && outranked.reason).toBe("conversion-running");
    const outranking = startDecision({ ...lane, adopting: true });
    expect(outranking.status === "unavailable" && outranking.reason).toBe("configuration-probing");
  });
});

describe("the claim ends with the probe that raised it", () => {
  it("releases on that exact read's settlement and recomputes from what is left", async () => {
    const reads = heldReads();
    const workspace = mountHook(heldApi(reads));
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(true);

    await act(async () => {
      reads.answer(0);
      await reads.issued[0]!.promise;
    });

    await waitFor(() => {
      expect(workspace.result.current.conversion.lane.configurationProbing).toBe(false);
    });
    // Recomputed from the facts that remain rather than from a memory of having
    // been refused.
    expect(startDecision(workspace.result.current.conversion.lane).status).toBe("available");
  });

  it("never has two probes outstanding, so no reply can be about somebody else's claim", async () => {
    // The structural half of the ownership rule. A read already in flight is
    // about to answer the same question, so nothing issues a second -- which is
    // why the token check is defence in depth rather than the only guard, and
    // why an overlap has to be constructed at the claim itself to be seen at
    // all (`useConversionProbeLane.test.tsx`).
    const reads = heldReads();
    const api = heldApi(reads);
    const workspace = mountHook(api);
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });

    // A binding replacement, a re-render, and an explicit retry all arriving
    // while the first read is still outstanding.
    act(() => {
      workspace.result.current.conversionConfiguration.retry();
      workspace.result.current.conversionConfiguration.retry();
    });
    workspace.rerender();
    expect(reads.issued).toHaveLength(1);
    expect(probeCount(api)).toBe(1);
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(true);
  });

  it("issues the next probe for a replaced binding, and holds the lane across the handover", async () => {
    const reads = heldReads();
    const workspace = mountHook(heldApi(reads));
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });

    // The read answers under a binding the session has already moved to, whose
    // catalog is unread -- so a read is owed again for a different binding.
    await act(async () => {
      reads.answer(0, {
        ...READY,
        authority: settledAt(2, firstBindingReceipt + 1),
        configuration: { configuration: "unattempted" },
      });
      await reads.issued[0]!.promise;
    });
    await waitFor(() => {
      expect(reads.issued).toHaveLength(2);
    });
    // The second probe holds the lane, and only its own settlement frees it.
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(true);

    await act(async () => {
      reads.answer(1, { ...READY, authority: settledAt(2, firstBindingReceipt + 1) });
      await reads.issued[1]!.promise;
    });
    await waitFor(() => {
      expect(workspace.result.current.conversion.lane.configurationProbing).toBe(false);
    });
  });

  it("settles cleanly when the document that raised the claim goes away", async () => {
    // The lane outlives the configuration hook, so the release is not
    // conditioned on this document still being mounted: a claim left raised by
    // an unmounting document would refuse every conversion for the rest of the
    // session.
    const reads = heldReads();
    const workspace = mountHook(heldApi(reads));
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });
    workspace.unmount();
    await act(async () => {
      reads.answer(0);
      await reads.issued[0]!.promise;
    });
    expect(reads.issued).toHaveLength(1);
  });
});

describe("an explicit retry occupies the same lane", () => {
  it("raises the one claim the automatic read raises", async () => {
    const reads = heldReads();
    const workspace = mountHook(heldApi(reads));
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });
    await act(async () => {
      reads.answer(0, FAILED);
      await reads.issued[0]!.promise;
    });
    await waitFor(() => {
      expect(workspace.result.current.conversionConfiguration.retryOffered).toBe(true);
    });
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(false);

    act(() => {
      workspace.result.current.conversionConfiguration.retry();
    });
    await waitFor(() => {
      expect(reads.issued).toHaveLength(2);
    });
    // The same fact, from the same lane. There is not an automatic occupancy
    // and a retry occupancy.
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(true);
    const decision = startDecision(workspace.result.current.conversion.lane);
    expect(decision.status === "unavailable" && decision.reason).toBe("configuration-probing");
  });
});

describe("a probe that never launched claims nothing", () => {
  it("leaves the lane free when admission refuses the read", async () => {
    // A transient refusal is not a fake in-flight read. The obligation stays
    // owed and the next occasion asks again; nothing says a read is happening,
    // because none is.
    const reads = heldReads();
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR],
      availability: availableBackend,
      initialBackendQuarantined: true,
      conversionConfiguration: reads.conversionConfiguration,
    });
    const workspace = mountHook(api);
    await waitFor(() => {
      expect(workspace.result.current.conversion.lane.backendQuarantined).toBe(true);
    });
    expect(reads.issued).toHaveLength(0);
    expect(probeCount(api)).toBe(0);
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(false);
    // And the conversion is refused for what is actually true of the session,
    // rather than for a read nobody started.
    const decision = startDecision(workspace.result.current.conversion.lane);
    expect(decision.status === "unavailable" && decision.reason).toBe("backend-quarantined");
  });
});

describe("occupancy is not admission", () => {
  it("refuses a conversion for a probe without becoming the probe's own gate", async () => {
    // Two questions, two owners. The lane fact makes `Convert` unavailable;
    // whether another probe may start is `probeAdmission`'s, over Rust's gate
    // and quarantine boundary, and it does not read the lane's verdict at all.
    const reads = heldReads();
    const workspace = mountHook(heldApi(reads));
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(true);

    const owning = {
      backendQuarantined: false,
      backendChanging: false,
      laneClaimed: false,
      previewReading: false,
    } as const;
    expect(probeAdmission({ ...owning, probeInFlight: true })).toBe("probeInFlight");
    expect(probeAdmission({ ...owning, probeInFlight: false })).toBeNull();
    // `backendUsable` is not among admission's facts at all -- it is a
    // judgement rather than process ownership -- so an unusable build that
    // refuses every conversion still admits a probe.
    expect(startDecision({ ...workspace.result.current.conversion.lane, backendUsable: false }).status).toBe(
      "unavailable",
    );
    expect(probeAdmission({ ...owning, probeInFlight: false })).toBeNull();
  });
});

describe("what the reader sees while the lane is held", () => {
  it("says one thing about the fact and disables the control it refuses", async () => {
    const reads = heldReads();
    mountApp({ conversionConfiguration: reads.conversionConfiguration });
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(reads.issued).toHaveLength(1);
    });

    const sentence = "MSCanvas is reading the conversion options from ProteoWizard.";
    await waitFor(() => {
      expect(
        panel.querySelector("#conversion-availability-configuration-probing")?.textContent,
      ).toBe(sentence);
    });
    // Once in the whole document, and phrased about the fact rather than about
    // converting -- the same element would serve any other action refused by
    // the same probe.
    expect((document.body.textContent ?? "").split(sentence)).toHaveLength(2);
    expect(sentence).not.toContain("Converting");
  });
});
