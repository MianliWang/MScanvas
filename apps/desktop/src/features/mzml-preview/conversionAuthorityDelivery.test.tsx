/**
 * A conversion-bound answer that carries authority is *accepted*, never
 * re-observed.
 *
 * ADR 0044 Decision 4's delivery half, closed on the last path that still went
 * the other way. A queue-state poll carries the `BackendAuthorityProjection` as
 * Rust authored it; before this the frontend answered a newer one by launching
 * `inspect_backend`, which spends a two-tool discovery rediscovering news it was
 * handed and holds `backendBusy` — refusing every conversion — for its length.
 * There is one acceptance path now, and no second reconciliation system beside
 * the projection.
 *
 * **Two orderings, independently.** A queue update answers two questions that
 * are not the same question:
 *
 * ```text
 * sequence                    is this a newer queue/slot state?
 * BackendAuthorityRevision    is this a newer backend-authority publication?
 * ```
 *
 * One may be stale while the other is news, so the acceptance sits above the
 * slot guard and the slot guard stays where it is. Both directions are pinned
 * below, because getting either wrong is silent: a discarded projection leaves
 * the panel describing a build the session has left, and an installed stale slot
 * takes a running queue off screen.
 *
 * Fake timers throughout, and no `waitFor`: every poll below is a poll this test
 * asked for, so "nothing was launched" is a claim about the code rather than
 * about how fast the machine is.
 */

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type {
  BackendAuthorityProjection,
  SelectedFile,
  WorkspaceConversionState,
  WorkspaceConversionUpdate,
} from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { useConversionOperation } from "./useConversionOperation";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import type { FakePreviewApi } from "../../test/previewFixtures";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
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

/** A queue that owns the backend lane, so this document keeps polling it. */
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

function update(
  sequence: number,
  authority: BackendAuthorityProjection,
  state: WorkspaceConversionState = RUNNING,
): WorkspaceConversionUpdate {
  return {
    sequence,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority,
  };
}

/** The binding the session starts on, and the one that replaces it. */
const A = settledAt(5, firstBindingReceipt);
const B = settledAt(6, firstBindingReceipt + 1);

/**
 * The publications a run delivered, in order, with repeats collapsed.
 *
 * A poll that finds nothing changed still hands its projection over -- the
 * operation is not the judge -- so counting deliveries would be counting polls.
 * What every claim below is about is which publications arrived, and in what
 * order.
 */
function publications(accepted: readonly BackendAuthorityProjection[]): number[] {
  return accepted
    .map((projection) => projection.revision)
    .filter((revision, index, all) => index === 0 || all[index - 1] !== revision);
}

/** Lets every outstanding promise and every due timer settle. */
async function settle(times = 4): Promise<void> {
  for (let round = 0; round < times; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

/** Asks for exactly this many more polls of the conversion slot. */
async function poll(times = 1): Promise<void> {
  for (let round = 0; round < times; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    await settle(2);
  }
}

/**
 * The operation, over a slot this test answers by hand.
 *
 * Driven at the operation rather than through the workspace wherever the claim
 * is about ordering: a crafted `sequence`/revision pair is the only way to state
 * "stale slot, fresh authority" and mean it, and no user path produces one.
 */
function mountOperation(answers: readonly WorkspaceConversionUpdate[]) {
  const accepted: BackendAuthorityProjection[] = [];
  let asked = 0;
  const api = {
    getConversionState: () => {
      const answer = answers[Math.min(asked, answers.length - 1)]!;
      asked += 1;
      return Promise.resolve(answer);
    },
  } as unknown as PreviewApi;
  const environment = {
    backendUsable: true,
    backendChanging: false,
    previewReading: false,
    configurationProbing: false,
    workspaceSettling: false,
  } as const;
  const mounted = renderHook(
    () =>
      useConversionOperation(
        (authority: BackendAuthorityProjection) => {
          accepted.push(authority);
        },
        () => undefined,
        { begin: () => 1, apply: () => undefined },
        environment,
        () => environment,
      ),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(PreviewApiProvider, { value: api }, children),
    },
  );
  return { accepted, mounted };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("every update delivers its authority, and the slot guard does not gate it", () => {
  it("hands the projection over on the very first read", async () => {
    const { accepted, mounted } = mountOperation([update(1, A)]);
    await settle();
    expect(publications(accepted)).toEqual([A.revision]);
    expect(mounted.result.current.state.status).toBe("running");
  });

  it("accepts a newer publication carried by a slot state it discards as duplicate", async () => {
    // The case the whole ordering separation exists for. Rust republishes the
    // authority whenever what it projects changes, which is not tied to the slot
    // moving -- so a poll that repeats sequence 1 can still be the only carrier
    // of binding B. Accepting below the guard would throw B away and leave the
    // panel describing a build the session has left.
    const { accepted, mounted } = mountOperation([update(1, A), update(1, B)]);
    await settle();
    await poll();

    expect(publications(accepted)).toEqual([A.revision, B.revision]);
    // And the duplicate slot state installed nothing: the sequence guard still
    // decides what the queue is.
    expect(mounted.result.current.state.status).toBe("running");
  });

  it("accepts a newer publication carried by an older slot state", async () => {
    const { accepted } = mountOperation([update(4, A), update(2, B)]);
    await settle();
    await poll();
    expect(publications(accepted)).toEqual([A.revision, B.revision]);
  });

  it("installs a newer slot state and still delivers its older authority for judging", async () => {
    // The converse. The queue moved and the projection beside it is older, so
    // the slot installs -- and the projection is handed on rather than dropped
    // here, because deciding staleness in the operation would be a second
    // authority. `acceptProjection` refuses it by revision.
    const { accepted, mounted } = mountOperation([update(1, B, RUNNING), update(2, A, TERMINAL)]);
    await settle();
    await poll();

    expect(mounted.result.current.state.status).toBe("terminal");
    expect(publications(accepted)).toEqual([B.revision, A.revision]);
    expect(A.revision).toBeLessThan(B.revision);
  });

  it("does not wait for a queue to settle before believing a projection", async () => {
    // The behaviour this replaces reported the authority only on `terminal`, so
    // a panel rendered a replaced build for the length of a drain.
    const { accepted } = mountOperation([update(1, A, RUNNING), update(2, B, RUNNING)]);
    await settle();
    await poll();
    expect(publications(accepted)).toEqual([A.revision, B.revision]);
  });
});

/**
 * The same rules, through the tree that ships.
 *
 * The operation delivers; `acceptDeliveredAuthority` decides. What is pinned
 * here is that deciding launches nothing.
 */
function mountWorkspace(api: PreviewApi) {
  return renderHook(() => usePreviewWorkspace(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        WorkspaceDropTransportProvider,
        { value: createFakeWorkspaceDropTransport() },
        createElement(PreviewApiProvider, { value: api }, children),
      ),
  });
}

function inspections(api: FakePreviewApi): number {
  return api.calls().filter((command) => command === "inspectBackend").length;
}

function configurationReads(api: FakePreviewApi): number {
  return api.calls().filter((command) => command === "readConversionConfiguration").length;
}

/**
 * A conversion that starts and does not finish, so its slot is polled.
 *
 * The queue is published `running` before the command answers -- which is what
 * Rust does, and what makes the poll the session's only voice for the length of
 * the drain. The command's own promise is never settled here: a queue that
 * answered would end the polling this test is about.
 */
function holdOneConversion(): {
  readonly conversion: (
    request: unknown,
    publish: (state: WorkspaceConversionState) => void,
  ) => Promise<WorkspaceConversionState>;
} {
  return {
    conversion: (_request, publish) => {
      publish(RUNNING);
      return new Promise<WorkspaceConversionState>(() => undefined);
    },
  };
}

/**
 * Asks for the plan the panel would ask for.
 *
 * The rows are the screen's -- search, sort and focus resolve them there -- so
 * a hook test is the screen for as long as it runs.
 */
async function describeTheConversion(workspace: {
  result: { current: ReturnType<typeof usePreviewWorkspace> };
}): Promise<void> {
  act(() => {
    workspace.result.current.conversionPlan.describe([VENDOR.handle]);
  });
  await settle(4);
}

/** Presses the panel's start, once the plan the panel would start exists. */
async function startTheConversion(workspace: {
  result: { current: ReturnType<typeof usePreviewWorkspace> };
}): Promise<void> {
  act(() => {
    workspace.result.current.conversion.convert(planIdentity([VENDOR.handle]));
  });
  await settle(4);
}

describe("what a delivered projection costs", () => {
  it("asks nothing at all when a poll repeats the publication already on screen", async () => {
    // N polls of one observation, and an arriving fact is not a request.
    const drain = holdOneConversion();
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR],
      availability: availableBackend,
      conversion: drain.conversion,
    });
    const workspace = mountWorkspace(api);
    await settle(8);
    await describeTheConversion(workspace);
    await startTheConversion(workspace);
    await settle(4);
    expect(workspace.result.current.conversion.lane.laneClaimed).toBe(true);

    const inspectionsBefore = inspections(api);
    const readsBefore = configurationReads(api);
    const usableBefore = workspace.result.current.conversion.lane.backendUsable;
    const catalogBefore = workspace.result.current.conversionConfiguration.configuration;

    await poll(4);

    expect(inspections(api)).toBe(inspectionsBefore);
    expect(configurationReads(api)).toBe(readsBefore);
    expect(workspace.result.current.conversion.lane.backendUsable).toBe(usableBefore);
    expect(workspace.result.current.conversionConfiguration.configuration).toBe(catalogBefore);
  });

  it("accepts a binding a poll delivers without going to look for it", async () => {
    const drain = holdOneConversion();
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR],
      availability: availableBackend,
      conversion: drain.conversion,
    });
    const workspace = mountWorkspace(api);
    await settle(8);
    await describeTheConversion(workspace);
    // A catalog and a plan, both read under the binding the session is on.
    expect(workspace.result.current.conversionConfiguration.configuration).not.toBeNull();
    expect(workspace.result.current.conversionPlan.startPlan).toBe("ready");

    await startTheConversion(workspace);
    await settle(4);
    const inspectionsBefore = inspections(api);
    const readsBefore = configurationReads(api);

    // Rust moves to a different installation and says so on the next poll,
    // which is the session's only voice while a drain runs.
    act(() => {
      api.replaceTheBindingSilently();
    });
    await poll(2);

    // What the previous binding described has stopped being current, which is
    // what accepting the replacement means.
    expect(workspace.result.current.conversionConfiguration.configuration).toBeNull();
    expect(workspace.result.current.conversionPlan.startPlan).not.toBe("ready");
    // And no second observation of any kind. The projection was the answer.
    expect(inspections(api)).toBe(inspectionsBefore);
    // No catalog probe either: a conversion owns the lane, so the read this
    // replacement owes stays owed rather than queueing behind the drain.
    expect(configurationReads(api)).toBe(readsBefore);
  });

  it("accepts a verdict that moved on the build the session is already on", async () => {
    // Identity and ordering ask different fields. A verdict can move while the
    // receipt stands still, and that is news about a build rather than a
    // different build -- so it is accepted, and it invalidates nothing that was
    // read from that build.
    const drain = holdOneConversion();
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR],
      availability: availableBackend,
      conversion: drain.conversion,
    });
    const workspace = mountWorkspace(api);
    await settle(8);
    await describeTheConversion(workspace);
    await startTheConversion(workspace);
    await settle(4);
    expect(workspace.result.current.conversion.lane.backendUsable).toBe(true);
    const inspectionsBefore = inspections(api);
    const catalogBefore = workspace.result.current.conversionConfiguration.configuration;
    expect(catalogBefore).not.toBeNull();

    act(() => {
      api.judgeTheBuildUnpreviewable();
    });
    await poll(2);

    expect(workspace.result.current.conversion.lane.backendUsable).toBe(false);
    expect(inspections(api)).toBe(inspectionsBefore);
    // The catalog was read for this receipt and the receipt has not moved, so
    // nothing about it is stale and none of it is thrown away.
    expect(workspace.result.current.conversionConfiguration.configuration).toBe(catalogBefore);
  });
});
