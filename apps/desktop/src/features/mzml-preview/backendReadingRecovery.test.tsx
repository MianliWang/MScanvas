/**
 * Accepting a delivered projection, and recovering the reading it left behind —
 * two operations, through the tree that ships.
 *
 * ADR 0044 Decision 4 puts them apart on purpose. A projection arrives from an
 * operation that produced no `BackendAvailabilityDto` — a refused `BEGIN`, a
 * queue poll, a settings read — so the authority moves at once and the banner's
 * reading does not. Acceptance is immediate and launches nothing; the reading is
 * a second, *gated* obligation, and conflating them gives either a banner naming
 * a build the session has left, or a backend probe per delivery.
 *
 * Every window below is driven by a controlled promise or a hand-driven poll,
 * and every claim about what crossed the boundary is an exact count from the
 * fake's own ledger. Nothing here sleeps.
 */

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type {
  ConversionConfigurationSnapshot,
  SelectedFile,
  WorkspaceConversionState,
} from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import type { Deferred, FakePreviewApi, FakePreviewApiOptions } from "../../test/previewFixtures";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  firstBindingReceipt,
  planIdentity,
  queueItem,
  queueOf,
  settledAt,
} from "../../test/previewFixtures";

const POLL_MS = 2_000;

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

const RUNNING: WorkspaceConversionState = {
  status: "running",
  operationId: "1",
  queue: queueOf([queueItem(VENDOR.handle, VENDOR.fileName, { state: "running", attempts: 1 })]),
};

const TERMINAL: WorkspaceConversionState = {
  status: "terminal",
  operationId: "1",
  reason: "completed",
  queue: queueOf([queueItem(VENDOR.handle, VENDOR.fileName, { state: "finalized", attempts: 1 })]),
};

async function settle(times = 6): Promise<void> {
  for (let round = 0; round < times; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

async function poll(times = 1): Promise<void> {
  for (let round = 0; round < times; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    await settle(3);
  }
}

function mount(api: PreviewApi) {
  return renderHook(() => usePreviewWorkspace(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        WorkspaceDropTransportProvider,
        { value: createFakeWorkspaceDropTransport() },
        createElement(PreviewApiProvider, { value: api }, children),
      ),
  });
}

type Workspace = { result: { current: ReturnType<typeof usePreviewWorkspace> } };

function checks(api: FakePreviewApi): number {
  return api.calls().filter((command) => command === "inspectBackend").length;
}

function probes(api: FakePreviewApi): number {
  return api.calls().filter((command) => command === "readConversionConfiguration").length;
}

/**
 * A conversion that starts and does not finish until this test says so.
 *
 * The queue is published `running` before the command answers -- which is what
 * Rust does, and what makes the poll the session's only voice for the length of
 * the drain.
 */
function heldDrain(): {
  readonly finish: () => void;
  readonly conversion: (
    request: unknown,
    publish: (state: WorkspaceConversionState) => void,
  ) => Promise<WorkspaceConversionState>;
} {
  const settled = deferred<WorkspaceConversionState>();
  return {
    finish: () => {
      settled.resolve(TERMINAL);
    },
    conversion: (_request, publish) => {
      publish(RUNNING);
      return settled.promise;
    },
  };
}

function workspaceApi(options: FakePreviewApiOptions = {}): FakePreviewApi {
  return createFakePreviewApi({
    initialDatasets: [VENDOR],
    availability: availableBackend,
    ...options,
  });
}

async function describeAndStart(workspace: Workspace): Promise<void> {
  act(() => {
    workspace.result.current.conversionPlan.describe([VENDOR.handle]);
  });
  await settle(4);
  act(() => {
    workspace.result.current.conversion.convert(planIdentity([VENDOR.handle]));
  });
  await settle(4);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("a projection delivered while a drain owns the lane", () => {
  it("is accepted at once, supersedes the reading, and queues no check behind the drain", async () => {
    const drain = heldDrain();
    const api = workspaceApi({ conversion: drain.conversion });
    const workspace = mount(api);
    await settle(8);
    await describeAndStart(workspace);
    expect(workspace.result.current.conversion.lane.laneClaimed).toBe(true);
    const checksBefore = checks(api);
    const probesBefore = probes(api);

    act(() => {
      api.replaceTheBindingSilently();
    });
    await poll(2);

    // Accepted immediately: what the previous binding described is no longer
    // current, and that happened without asking the backend anything.
    expect(workspace.result.current.conversionConfiguration.configuration).toBeNull();
    expect(workspace.result.current.backendReadingStale).toBe(true);
    // Nothing was launched. The check is owed and deferred behind a holder this
    // document has been told about; the probe is deferred behind the same one.
    expect(checks(api)).toBe(checksBefore);
    expect(probes(api)).toBe(probesBefore);
  });

  it("asks nothing more however many polls repeat that same publication", async () => {
    const drain = heldDrain();
    const api = workspaceApi({ conversion: drain.conversion });
    const workspace = mount(api);
    await settle(8);
    await describeAndStart(workspace);
    act(() => {
      api.replaceTheBindingSilently();
    });
    await poll(2);
    const checksBefore = checks(api);
    const probesBefore = probes(api);
    const staleBefore = workspace.result.current.backendReadingStale;

    await poll(5);

    expect(checks(api)).toBe(checksBefore);
    expect(probes(api)).toBe(probesBefore);
    expect(workspace.result.current.backendReadingStale).toBe(staleBefore);
  });

  it("releases the owed check when the drain ends, though nothing about the authority moved", async () => {
    // **Revision equality must not suppress recovery.** The queue's terminal
    // update carries the publication already on screen, so ordering and
    // identity both correctly do nothing -- and that is exactly the moment the
    // obliged check becomes admissible.
    const drain = heldDrain();
    const api = workspaceApi({ conversion: drain.conversion });
    const workspace = mount(api);
    await settle(8);
    await describeAndStart(workspace);
    act(() => {
      api.replaceTheBindingSilently();
    });
    await poll(2);
    const checksBefore = checks(api);
    expect(workspace.result.current.backendReadingStale).toBe(true);

    act(() => {
      drain.finish();
    });
    await settle(8);

    expect(checks(api)).toBe(checksBefore + 1);
    // And the reading it produced is current, so the banner stops disclaiming.
    expect(workspace.result.current.backendReadingStale).toBe(false);
  });

  it("puts the check first and lets the configuration probe follow its answer", async () => {
    // **Duty first, and the proof has to be that the read waits.** A `BEGIN`
    // that resolves a replacement, or a drain that ends after one, leaves a
    // check and a read owed in the same commit -- and whichever starts holds
    // the gate against the other. So the check is issued and the read is
    // deferred, which resolves itself: the check answers, its answer is an
    // occasion, and the read it deferred is issued by it.
    //
    // Asserting only that one call precedes the other would prove nothing, since
    // two dispatches in one commit are ordered by hook order anyway. The check
    // is held, so "the read waited" is a claim about a window rather than about
    // a sequence.
    const held = deferred<typeof availableBackend>();
    let answered = 0;
    const drain = heldDrain();
    const api = workspaceApi({
      conversion: drain.conversion,
      availability: () => {
        answered += 1;
        return answered === 1 ? Promise.resolve(availableBackend) : held.promise;
      },
    });
    const workspace = mount(api);
    await settle(8);
    await describeAndStart(workspace);
    act(() => {
      api.replaceTheBindingSilently();
    });
    await poll(2);
    const checksBefore = checks(api);
    const probesBefore = probes(api);

    act(() => {
      drain.finish();
    });
    await settle(10);

    // The duty went out, and it is still out.
    expect(checks(api)).toBe(checksBefore + 1);
    // The courtesy did not. It is owed for the replaced binding, and it is
    // waiting for the gate the check is holding.
    expect(probes(api)).toBe(probesBefore);
    expect(workspace.result.current.conversionConfiguration.configuration).toBeNull();

    // The check answers, and its answer is the occasion the read was waiting for.
    act(() => {
      held.resolve(availableBackend);
    });
    await settle(12);

    expect(probes(api)).toBe(probesBefore + 1);
    expect(checks(api)).toBe(checksBefore + 1);
  });
});

describe("a refused BEGIN that observed a replacement", () => {
  it("accepts the projection before any recovery, and establishes a reading after", async () => {
    const api = workspaceApi();
    const workspace = mount(api);
    await settle(8);
    act(() => {
      workspace.result.current.conversionPlan.describe([VENDOR.handle]);
    });
    await settle(4);
    const checksBefore = checks(api);

    // Rust moves on, and nothing says so until the start is refused.
    act(() => {
      api.replaceTheBindingSilently();
    });
    act(() => {
      workspace.result.current.conversion.convert(planIdentity([VENDOR.handle]));
    });
    await settle(4);

    // Nothing was created.
    expect(api.conversionRequests).toHaveLength(0);
    expect(workspace.result.current.conversion.state.status).toBe("idle");
    // The projection was accepted from the refusal itself -- the plan's next
    // question already names the new binding.
    await settle(6);
    const asked = api.planRequests();
    expect(asked[asked.length - 1]?.expectedReceipt).not.toBe(firstBindingReceipt);
    // And then, exactly once, the reading that refusal left superseded.
    expect(checks(api)).toBe(checksBefore + 1);
    expect(workspace.result.current.backendReadingStale).toBe(false);
  });
});

describe("a verdict that moved on the build the session is already on", () => {
  it("recovers the banner without invalidating the plan's question", async () => {
    // Same receipt, newer revision. The reading is stale because currency is
    // the revision; the plan is untouched because identity is the receipt.
    const drain = heldDrain();
    const api = workspaceApi({ conversion: drain.conversion });
    const workspace = mount(api);
    await settle(8);
    act(() => {
      workspace.result.current.conversionPlan.describe([VENDOR.handle]);
    });
    await settle(6);
    const planQuestionsBefore = api.planRequests().length;
    const catalogBefore = workspace.result.current.conversionConfiguration.configuration;
    expect(catalogBefore).not.toBeNull();
    expect(workspace.result.current.conversionPlan.startPlan).toBe("ready");
    const checksBefore = checks(api);
    const probesBefore = probes(api);

    await describeAndStart(workspace);
    act(() => {
      api.judgeTheBuildUnpreviewable();
    });
    await poll(2);

    expect(workspace.result.current.backendReadingStale).toBe(true);
    // The plan's question named a receipt, and the receipt did not move.
    expect(api.planRequests()).toHaveLength(planQuestionsBefore);
    // Neither did the catalog: it was read for this receipt and still describes it.
    expect(workspace.result.current.conversionConfiguration.configuration).toBe(catalogBefore);
    expect(probes(api)).toBe(probesBefore);

    act(() => {
      drain.finish();
    });
    await settle(8);

    expect(checks(api)).toBe(checksBefore + 1);
    expect(workspace.result.current.backendReadingStale).toBe(false);
    // Still no re-read: the receipt never moved, so nothing about the catalog
    // stopped describing the binding.
    expect(probes(api)).toBe(probesBefore);
  });
});

describe("a healthy explicit recheck on the same binding", () => {
  it("reads no settings again", async () => {
    const api = workspaceApi();
    const workspace = mount(api);
    await settle(8);
    const probesBefore = probes(api);
    expect(probesBefore).toBe(1);

    act(() => {
      workspace.result.current.checkBackend();
    });
    await settle(8);

    expect(probes(api)).toBe(probesBefore);
    expect(workspace.result.current.backendReadingStale).toBe(false);
  });
});

describe("a remedial check whose request fails", () => {
  it("does not wake itself, and leaves the reader a control", async () => {
    // The loop the exclusion exists for: the attempt raises `backendChanging`
    // and clears it in a `finally`, and if that clearing counted the check
    // would re-issue itself at IPC speed for the rest of the session.
    let answered = 0;
    const failing = () => {
      answered += 1;
      return answered === 1
        ? Promise.resolve(availableBackend)
        : Promise.reject(new Error("the backend could not be inspected"));
    };
    const drain = heldDrain();
    const api = workspaceApi({ availability: failing, conversion: drain.conversion });
    const workspace = mount(api);
    await settle(8);
    await describeAndStart(workspace);
    act(() => {
      api.replaceTheBindingSilently();
    });
    await poll(2);
    const checksBefore = checks(api);

    act(() => {
      drain.finish();
    });
    await settle(10);

    // It was attempted, and it failed.
    const attempted = checks(api);
    expect(attempted).toBeGreaterThan(checksBefore);
    expect(workspace.result.current.backend.status).toBe("failed");

    // **And then it stops.** Each attempt raises `backendChanging` and clears
    // it in a `finally`; if that clearing counted as an occasion the check would
    // re-issue itself for the rest of the session, at IPC speed. What is left
    // once the occasions this obligation's own attempts produced are the only
    // thing still happening is nothing at all.
    //
    // Bounded rather than exactly one: an independent occasion may legitimately
    // wake an owed check, and the configuration read the same replacement owes
    // takes the gate and answers in this window. That is a second occasion, not
    // a loop, and the count settling is what tells them apart.
    await poll(5);
    await settle(12);
    expect(checks(api)).toBe(attempted);
    // The floor is a control the reader can press, and it is live.
    expect(workspace.result.current.backendBusy).toBe(false);
    act(() => {
      workspace.result.current.checkBackend();
    });
    await settle(6);
    expect(checks(api)).toBe(attempted + 1);
  });
});

describe("an old reading arriving after a newer binding is accepted", () => {
  it("cannot become the current banner", async () => {
    // The reading is judged by the ordering rule like any other projection: a
    // check begun before the replacement answers about the build the session
    // has left, and it may not install.
    const held = deferred<typeof availableBackend>();
    let answered = 0;
    const api = workspaceApi({
      availability: () => {
        answered += 1;
        return answered === 1 ? Promise.resolve(availableBackend) : held.promise;
      },
    });
    const workspace = mount(api);
    await settle(8);
    const current = workspace.result.current.backend;
    expect(current.status).toBe("resolved");

    // A check goes out, and the binding is replaced while it is in flight.
    act(() => {
      workspace.result.current.checkBackend();
    });
    await settle(2);
    act(() => {
      api.replaceTheBindingSilently();
    });
    act(() => {
      workspace.result.current.conversionPlan.describe([VENDOR.handle]);
    });
    await settle(4);

    // The old reading lands, describing a publication older than what is now
    // rendered.
    act(() => {
      held.resolve(availableBackend);
    });
    await settle(8);

    // Whatever the banner shows, it is not that reading presented as current.
    const after = workspace.result.current.backend;
    if (after.status === "resolved") {
      expect(workspace.result.current.backendReadingStale).toBe(false);
    }
  });
});

describe("a configuration probe in flight", () => {
  it("defers the remedial check in this document rather than queueing behind it", async () => {
    // The frontend's occupancy projection is a courtesy rather than an atomic
    // acquisition of Rust's gate. What is proved is the narrower thing: no
    // check is knowingly dispatched behind a holder this document has been told
    // about.
    const reads: Deferred<ConversionConfigurationSnapshot>[] = [];
    const api = workspaceApi({
      conversionConfiguration: () => {
        const next = deferred<ConversionConfigurationSnapshot>();
        reads.push(next);
        return next.promise;
      },
    });
    const workspace = mount(api);
    await settle(8);
    expect(reads).toHaveLength(1);
    expect(workspace.result.current.conversion.lane.configurationProbing).toBe(true);
    const checksBefore = checks(api);

    // A replacement arrives, delivered by the probe's own answer, so the read
    // for the new binding is owed too -- and the reading is superseded.
    act(() => {
      reads[0]!.resolve({
        authority: settledAt(9, firstBindingReceipt + 4),
        configuration: { configuration: "unattempted" },
        outcome: { outcome: "answered" },
      });
    });
    await settle(2);

    // The check is issued into the free lane, and the next probe waits for it.
    await settle(8);
    const order = api.calls().slice(checksBefore);
    expect(checks(api)).toBeGreaterThan(checksBefore);
    expect(order.indexOf("inspectBackend")).toBeLessThan(
      order.lastIndexOf("readConversionConfiguration"),
    );
  });
});

describe("a quarantined session", () => {
  it("keeps its once-latched, process-free check and its reading", async () => {
    // Quarantine advances no revision, so it supersedes no reading and this
    // obligation owes nothing for it. Its own check is a separate one, exempt
    // from the projection and latched so it is attempted exactly once.
    const api = workspaceApi({ initialBackendQuarantined: true });
    const workspace = mount(api);
    await settle(10);

    expect(workspace.result.current.conversion.lane.backendQuarantined).toBe(true);
    expect(workspace.result.current.backendReadingStale).toBe(false);
    const checksAfterLatch = checks(api);
    await settle(10);
    expect(checks(api)).toBe(checksAfterLatch);
    // And a quarantined session started no probe, because that is the one place
    // the two admissions part.
    expect(probes(api)).toBe(0);
  });
});
