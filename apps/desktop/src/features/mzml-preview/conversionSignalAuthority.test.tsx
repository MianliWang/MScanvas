/**
 * What invalidates a conversion catalog, and what is worth a backend
 * reconciliation.
 *
 * Two questions, one signal model, and both of them had been answered by
 * proxies that looked right:
 *
 * - *what makes a catalog stop being an answer?* was answered with
 *   `backendUsable`, which is false for the duration of **any** probe. So an
 *   ordinary `Check again` on a healthy, unchanged installation revoked the
 *   catalog as `noBackend`, wiped a loaded plan back to loading, cancelled a
 *   good read still in flight, and then spent a second `msconvert --help`
 *   probe putting back exactly what had been on screen.
 * - *what is worth going and looking at the backend?* was answered with "a
 *   reply arrived carrying a higher generation". The conversion slot is polled
 *   every two seconds while a queue runs and every one of those replies carries
 *   the counter, so a queue that had itself observed a replacement fired one
 *   `inspect_backend` per tick -- each blocking on the backend gate
 *   `drain_queue` holds for the whole run.
 *
 * The two answers this file pins are:
 *
 * ```text
 * backend check in progress    is not  settled backend unavailable
 * a reply carries generation G is not  a new observation of generation G
 * ```
 *
 * Everything below counts. A regression here is not a wrong sentence on screen
 * -- it is a process launched, or a probe not saved -- so every case states a
 * number of `inspect_backend` calls or of catalog reads, and none of them is
 * satisfied by an assertion about what is rendered.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewApiProvider } from "./api";
import type { BackendAvailability, WorkspaceConversionState } from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import type { FakePreviewApi, FakePreviewApiOptions } from "../../test/previewFixtures";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  intentCatalog,
  queueItem,
  queueOf,
  shimadzuDataset,
} from "../../test/previewFixtures";

const VENDOR_ROW = shimadzuDataset(9);

/**
 * The slot poll's own interval, restated so a case can drive it.
 *
 * A copy rather than an import, deliberately: what is under test is a *count*
 * of backend processes, and driving a clock is only how the readings are
 * produced. No assertion here is about when anything happened.
 */
const POLL_INTERVAL_MS = 2_000;

function renderWorkspace(api: FakePreviewApi) {
  return renderHook(() => usePreviewWorkspace(), {
    wrapper: ({ children }: { readonly children?: ReactNode }) =>
      createElement(
        WorkspaceDropTransportProvider,
        { value: createFakeWorkspaceDropTransport() },
        createElement(PreviewApiProvider, { value: api }, children),
      ),
  });
}

/** How many backend processes this session has asked Rust to launch. */
function probes(api: FakePreviewApi): number {
  return api.calls().filter((command) => command === "inspectBackend").length;
}

/**
 * Lets every settled promise reach React, without advancing anything.
 *
 * Used where the claim is that *nothing further happens*: a negative about
 * automatic work needs the work to have had every chance to start.
 */
async function flush(rounds = 12): Promise<void> {
  await act(async () => {
    for (let round = 0; round < rounds; round += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Lets React commit, and lets a reply that takes a real turn of the loop land.
 *
 * An IPC call is never answered in the microtask that made it, and a fake that
 * settles synchronously hides everything that depends on the *rendered* busy
 * flag: the commit that raises it and the commit that lowers it collapse into
 * one, and an effect keyed on it never runs twice. So a case about what happens
 * when a check comes back has to let a turn of the event loop pass.
 */
async function turns(count = 8): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/** A reply that takes a turn of the loop, as every real one does. */
function afterATurn<T>(settle: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(settle());
      } catch (cause) {
        reject(cause);
      }
    }, 0);
  });
}

/** A queue holding the one backend lane. */
const RUNNING: WorkspaceConversionState = {
  status: "running",
  operationId: "1",
  queue: queueOf([
    queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, { state: "running", attempts: 1 }),
  ]),
};

/** The same queue, finished, which owns nothing. */
const FINISHED: WorkspaceConversionState = {
  status: "terminal",
  operationId: "1",
  reason: "completed",
  queue: queueOf([
    queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, { state: "finalized", attempts: 1 }),
  ]),
};

/** A refusal the pre-picker gate produces, which creates no queue at all. */
const UNSUPPORTED = {
  kind: "conversion_intent_unsupported",
  summary: "The installed ProteoWizard build does not offer that conversion option.",
  detail: null,
  retryable: false,
};

/** A check that did not come back, which establishes nothing. */
const CHECK_FAILED = {
  kind: "provider_unavailable",
  summary: "The backend check could not be completed.",
  detail: null,
  retryable: true,
};

/** A session with a catalog, a plan and a settled backend verdict. */
async function openWorkspace(options: Partial<FakePreviewApiOptions> = {}) {
  const api = createFakePreviewApi({
    initialDatasets: [VENDOR_ROW],
    availability: availableBackend,
    ...options,
  });
  const rendered = renderWorkspace(api);
  act(() => {
    rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
  });
  await waitFor(() => {
    expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
  });
  return { api, rendered };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a settled backend binding, and what a check is not", () => {
  it("keeps the catalog, its plan and its request across a check that resolves to the same installation", async () => {
    // G1. A catalog belongs to the installation a verdict settled on, and a
    // check that resolves to the same installation settles on the same one --
    // so nothing about it is news and nothing is re-read.
    let catalogs = 0;
    let checks = 0;
    const recheck = deferred<BackendAvailability>();
    const { api, rendered } = await openWorkspace({
      availability: () => {
        checks += 1;
        // The first verdict is the mount's. The second is the user's, and it is
        // held open by hand so the *checking* window can be inspected rather
        // than raced.
        return checks === 1 ? Promise.resolve(availableBackend) : recheck.promise;
      },
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog());
      },
    });
    expect(catalogs).toBe(1);
    expect(probes(api)).toBe(1);
    const catalogOnScreen = rendered.result.current.conversion.settings;
    const planOnScreen = rendered.result.current.conversion.plan;
    expect(catalogOnScreen.status).toBe("ready");

    // The user presses Check again.
    act(() => {
      rendered.result.current.checkBackend();
    });
    await flush();

    // Activity says a check is running, and the conversion is refused for that
    // reason -- which is a sentence about a check rather than about a build.
    expect(rendered.result.current.backend.status).toBe("checking");
    expect(rendered.result.current.conversion.lane.backendChanging).toBe(true);
    // And nothing bound to the installation moved. Compared by identity rather
    // than by shape: a catalog rebuilt from an identical read would satisfy a
    // value comparison and would still have cost the probe this exists to save.
    expect(rendered.result.current.conversion.settings).toBe(catalogOnScreen);
    expect(rendered.result.current.conversion.plan).toBe(planOnScreen);
    expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    expect(rendered.result.current.conversion.settingsReadiness).toBe("ready");
    expect(catalogs).toBe(1);

    // The check resolves, naming the installation that was already bound.
    await act(async () => {
      recheck.resolve(availableBackend);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(rendered.result.current.backend.status).toBe("resolved");
    });
    await flush();

    // **No second help probe, and no second plan read.** This is the whole
    // finding: a healthy recheck of an unchanged installation costs one backend
    // verdict and nothing else.
    expect(catalogs).toBe(1);
    expect(probes(api)).toBe(2);
    expect(rendered.result.current.conversion.settings).toBe(catalogOnScreen);
    expect(rendered.result.current.conversion.plan).toBe(planOnScreen);
    expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    // And the lane is answerable again, for the same reason it was not before:
    // the check that owned it has ended.
    expect(rendered.result.current.conversion.lane.backendChanging).toBe(false);
    expect(rendered.result.current.conversion.lane.backendUsable).toBe(true);
  });

  it("does not claim a different installation was observed when a check fails to answer", async () => {
    // A command that did not come back established nothing. It is not evidence
    // that an installation disappeared, it is not an observation of a new one,
    // and it must not start a catalog probe loop of its own.
    let catalogs = 0;
    let checks = 0;
    const { api, rendered } = await openWorkspace({
      availability: () => {
        checks += 1;
        return checks === 1 ? Promise.resolve(availableBackend) : Promise.reject(CHECK_FAILED);
      },
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog());
      },
    });
    expect(catalogs).toBe(1);
    const catalogOnScreen = rendered.result.current.conversion.settings;

    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      expect(rendered.result.current.backend.status).toBe("failed");
    });
    await flush();

    // The binding is where it was, so the catalog is where it was. Nothing here
    // invents a scientific fallback, and nothing pretends the build is gone.
    expect(rendered.result.current.conversion.settings).toBe(catalogOnScreen);
    expect(catalogs).toBe(1);
    // And the failure did not become a reason to go and ask again.
    expect(probes(api)).toBe(2);
    // The conversion is still refused, by the settled-verdict rule -- which is
    // the fact that is actually true about this session.
    expect(rendered.result.current.conversion.lane.backendUsable).toBe(false);
  });

  it("holds the catalog through a check and replaces it only once a different installation settles", async () => {
    // The transition that *is* news, watched across the whole of the window in
    // which the previous shape threw the catalog away early.
    let catalogs = 0;
    let checks = 0;
    const recheck = deferred<BackendAvailability>();
    const { api, rendered } = await openWorkspace({
      availability: () => {
        checks += 1;
        return checks === 1 ? Promise.resolve(availableBackend) : recheck.promise;
      },
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog({ installationGeneration: catalogs === 1 ? 0 : 1 }));
      },
    });
    const catalogOnScreen = rendered.result.current.conversion.settings;

    // The build is replaced on disk, and the user goes and looks.
    api.noteInstallationObserved();
    act(() => {
      rendered.result.current.checkBackend();
    });
    await flush();
    // Still the old catalog: no verdict has settled, so nothing is yet known to
    // have changed.
    expect(rendered.result.current.conversion.settings).toBe(catalogOnScreen);
    expect(catalogs).toBe(1);

    // Now it settles, on a different installation.
    await act(async () => {
      recheck.resolve(availableBackend);
      await Promise.resolve();
    });
    await waitFor(() => {
      const { settings } = rendered.result.current.conversion;
      expect(settings.status === "ready" && settings.catalog.installationGeneration).toBe(1);
    });
    expect(catalogs).toBe(2);
    expect(probes(api)).toBe(2);
  });
});

describe("one reconciliation per newly observed installation", () => {
  it("does not launch a backend probe per poll of a queue that observed a replacement", async () => {
    // G2. The queue holds the one backend lane for its whole run, so an
    // `inspect_backend` issued now would not be a reconciliation -- it would be
    // a process waiting to launch when the queue let go, with the next poll
    // issuing another behind it. The observation is coalesced instead.
    vi.useFakeTimers();
    const finished = deferred<WorkspaceConversionState>();
    let catalogs = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog({ installationGeneration: catalogs === 1 ? 0 : 1 }));
      },
      // Reports the queue and then waits, exactly as Rust answers a conversion
      // once, when the whole queue is over. A held promise rather than a sleep:
      // the run ends when this case says it does.
      conversion: (_request, publish) => {
        publish(RUNNING);
        return finished.promise;
      },
    });
    const rendered = renderWorkspace(api);
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    const settledProbes = probes(api);
    expect(settledProbes).toBe(1);

    act(() => {
      rendered.result.current.conversion.convert([VENDOR_ROW.handle]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rendered.result.current.conversion.lane.laneClaimed).toBe(true);
    const readsBeforePolling = api.conversionStateReads();

    // The installation is replaced under the running queue. Every poll from
    // here reports the new generation, and the slot sequence never moves --
    // which is exactly why the report sits above the sequence guard, and
    // exactly why it must not be a request.
    api.noteInstallationObserved();

    const POLLS = 10;
    for (let poll = 0; poll < POLLS; poll += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
    }
    // The polls really happened, so the negative below is about deduplication
    // rather than about readings that never occurred.
    expect(api.conversionStateReads() - readsBeforePolling).toBeGreaterThanOrEqual(POLLS);
    expect(rendered.result.current.conversion.state.status).toBe("running");

    // **Ten readings of one observation, and not one backend process.**
    expect(probes(api)).toBe(settledProbes);
    expect(catalogs).toBe(1);

    // The queue finishes and releases the lane.
    await act(async () => {
      finished.resolve(FINISHED);
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();

    // **Exactly one reconciliation, for the one observation.**
    expect(probes(api)).toBe(settledProbes + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });
    await flush();
    expect(probes(api)).toBe(settledProbes + 1);
    // And it did what a reconciliation is for: the catalog now describes the
    // installation that is actually there.
    expect(catalogs).toBe(2);
    const { settings } = rendered.result.current.conversion;
    expect(settings.status === "ready" && settings.catalog.installationGeneration).toBe(1);
  });

  it("folds every installation seen while the lane is busy into the one reconciliation that follows", async () => {
    // A higher generation arriving while an observation is outstanding is not
    // lost, and it does not become a second obligation. The observation is a
    // high-water mark, so what the one deferred reconciliation reconciles to is
    // the newest thing this session has seen -- not the first, and not each of
    // them in turn.
    vi.useFakeTimers();
    const finished = deferred<WorkspaceConversionState>();
    let catalogs = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(
          intentCatalog({ installationGeneration: api.installationGeneration() }),
        );
      },
      conversion: (_request, publish) => {
        publish(RUNNING);
        return finished.promise;
      },
    });
    const rendered = renderWorkspace(api);
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    const settledProbes = probes(api);
    act(() => {
      rendered.result.current.conversion.convert([VENDOR_ROW.handle]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rendered.result.current.conversion.lane.laneClaimed).toBe(true);

    // Two installations, both seen by polls of the running queue.
    api.noteInstallationObserved();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    api.noteInstallationObserved();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(probes(api)).toBe(settledProbes);

    await act(async () => {
      finished.resolve(FINISHED);
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    await flush();

    // One check, and it reconciled to the newer of the two.
    expect(probes(api)).toBe(settledProbes + 1);
    expect(catalogs).toBe(2);
    const { settings } = rendered.result.current.conversion;
    expect(settings.status === "ready" && settings.catalog.installationGeneration).toBe(2);
  });

  it("reconciles nothing while this session has no settled verdict at all", async () => {
    // Before a first verdict there is nothing to reconcile *to*. The slot read
    // this document makes on mount reports where the sequence stands, and the
    // check that will establish the first verdict has already been made -- so
    // treating that reading as an unreconciled observation would buy a second
    // backend process on the mount of every session whose slot answered first,
    // which, a slot read being memory and a probe being a process, is nearly
    // all of them.
    let catalogs = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: () => Promise.reject(CHECK_FAILED),
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog());
      },
    });
    const rendered = renderWorkspace(api);
    await waitFor(() => {
      expect(rendered.result.current.backend.status).toBe("failed");
    });
    await flush(40);

    // The slot was read, so the observation really was raised.
    expect(api.conversionStateReads()).toBeGreaterThan(0);
    // And it bought nothing: one check, the mount's, and no catalog at all --
    // there is no binding to read one for.
    expect(probes(api)).toBe(1);
    expect(catalogs).toBe(0);
    expect(rendered.result.current.conversion.settings.status).toBe("loading");
  });

  it("spends one automatic reconciliation on an observation, and one more only on a newer one", async () => {
    // The refusal route, which is where an observation is made by an operation
    // that produced nothing else. Four dispatches: one that sees a replacement,
    // two that see the same build again, and one that sees a second
    // replacement.
    let catalogs = 0;
    let observeOnRefusal = false;
    let api!: FakePreviewApi;
    api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => {
        catalogs += 1;
        // The catalog is stamped with the installation the session is actually
        // on, which is where the fake keeps it.
        return Promise.resolve(
          intentCatalog({ installationGeneration: api.installationGeneration() }),
        );
      },
      conversion: () => {
        // BEGIN resolves the installed build before it refuses, and on the
        // dispatches that model a replacement that resolution is this session's
        // first sight of a new one.
        if (observeOnRefusal) {
          api.noteInstallationObserved();
        }
        return Promise.reject(UNSUPPORTED);
      },
    });
    const rendered = renderWorkspace(api);
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });
    expect(probes(api)).toBe(1);
    expect(catalogs).toBe(1);

    const refuseAConversion = async (): Promise<void> => {
      act(() => {
        rendered.result.current.conversion.convert([VENDOR_ROW.handle]);
      });
      await waitFor(() => {
        expect(rendered.result.current.conversion.error?.kind).toBe(
          "conversion_intent_unsupported",
        );
      });
      await flush();
      act(() => {
        rendered.result.current.conversion.dismissError();
      });
      await waitFor(() => {
        expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
      });
    };

    // One replacement, observed once and reconciled once.
    observeOnRefusal = true;
    await refuseAConversion();
    await waitFor(() => {
      expect(catalogs).toBe(2);
    });
    expect(probes(api)).toBe(2);

    // The same build, seen twice more. An observation already reconciled is not
    // an observation, however many readings carry it.
    observeOnRefusal = false;
    await refuseAConversion();
    await refuseAConversion();
    await flush();
    expect(probes(api)).toBe(2);
    expect(catalogs).toBe(2);

    // A second, genuinely newer installation gets its own one attempt.
    observeOnRefusal = true;
    await refuseAConversion();
    await waitFor(() => {
      expect(catalogs).toBe(3);
    });
    expect(probes(api)).toBe(3);
  });

  it("does not retry an automatic reconciliation that failed", async () => {
    // A failed reconciliation has already told this session what it can about
    // that observation. Asking again the moment the failure lands would be the
    // same unbounded stream of processes from the other direction -- and it
    // would never stop, because the failure re-runs the very effect that
    // started it.
    let checks = 0;
    let catalogs = 0;
    let api!: FakePreviewApi;
    api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: () => {
        checks += 1;
        // Answered a turn later, like every reply that crosses IPC. That is
        // what makes the busy flag rise and fall in two commits -- and the
        // second of those is the one that re-runs the obligation this case is
        // about.
        return checks === 1
          ? Promise.resolve(availableBackend)
          : afterATurn(() => {
              throw CHECK_FAILED;
            });
      },
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog());
      },
      conversion: () => {
        api.noteInstallationObserved();
        return Promise.reject(UNSUPPORTED);
      },
    });
    const rendered = renderWorkspace(api);
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });
    expect(probes(api)).toBe(1);

    act(() => {
      rendered.result.current.conversion.convert([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.backend.status).toBe("failed");
    });

    // The one attempt happened. Nothing follows it: the effect that fired it
    // runs again the moment the failure clears the busy flag, and it has to
    // find this observation already spent. Without that, each failure would
    // start the next check -- a loop with nothing to end it.
    await turns(8);
    expect(probes(api)).toBe(2);
    // And a failure invalidated no binding, so the catalog was not touched.
    expect(catalogs).toBe(1);
    expect(rendered.result.current.conversion.settings.status).toBe("ready");
  });
});
