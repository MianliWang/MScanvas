import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  previewError,
  queueItem,
  queueOf,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type {
  ConversionQueueItem,
  SelectedFile,
  WorkspaceConversionState,
} from "./contracts";

/**
 * Stopping a running queue, from the interface a user actually has.
 *
 * Everything here renders the whole application against the modelled boundary,
 * so what is asserted is what a document does with the states Rust can produce
 * -- not what a component does with props a test invented for it.
 *
 * The environment is jsdom with CSSOM, which this repository has no browser
 * harness beyond. Nothing here measures a pixel or a paint; what it asserts is
 * production structure, the exact user-visible copy, which controls are offered
 * and disabled, what reaches the polite live region, and where focus is.
 */

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const DATASETS = [acquisition(1), acquisition(2), acquisition(3)];

const STOP_EXPLANATION =
  "Stops the current conversion and prevents remaining items from starting. Outputs already completed stay in place.";

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

function liveRegion(): string {
  return document.querySelector("[data-live-region='conversion']")?.textContent ?? "";
}

/** A finalized item, with the report a real one carries. */
function converted(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "finalized",
    attempts: 1,
    result: {
      kind: "single" as const,
      report: {
        datasetHandle: handle,
        sourceKind: "thermo_raw",
        outcome: "finalized",
        detailedOutcome: null,
        outputFileName: name.replace(/\.raw$/i, ".mzML"),
        output: {
          byteLength: 28_655,
          sha256: "6CE2ACE65485488F4A337EE17B71559E737C1944B641F279744932C3C3D8648C",
          spectrumCount: 1,
          chromatogramCount: 1,
        },
        validation: {
          mode: "output_only",
          fullyVerified: false,
          verified: ["source_unchanged"],
          unverified: [],
          inapplicable: ["spectrum_count"],
        },
        backend: { exitCode: 0, elapsedMilliseconds: 568 },
        stagingResidue: null,
        installationGeneration: 0,
      },
    },
  });
}

/** An item a confirmed stop reached while it was running. */
function cancelled(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "cancelled",
    attempts: 1,
    cancellation: {
      processLaunched: true,
      terminationRequested: true,
      treeTerminationConfirmed: true,
      elapsedMilliseconds: 71,
      termination: "cancelled",
      partialOutputObserved: true,
      stagingResidue: null,
    },
  });
}

/** An item a stopped queue never began. */
function notRun(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, { state: "notRun" });
}

/** Three items, with the first done and the second under way. */
function midQueue(): ReturnType<typeof queueOf> {
  return queueOf([
    converted("file-1", "run-1.raw"),
    queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 }),
    queueItem("file-3", "run-3.raw"),
  ]);
}

/** That queue, running. */
function runningQueue(): WorkspaceConversionState {
  return { status: "running", operationId: "1", queue: midQueue() };
}

/** That queue, with a stop accepted and not yet settled. */
function stoppingQueue(operationId = "1"): WorkspaceConversionState {
  return { status: "stopping", operationId, queue: midQueue() };
}

/** The state a confirmed stop of that queue produces. */
function stoppedQueue(): WorkspaceConversionState {
  return {
    status: "terminal",
    operationId: "1",
    reason: "stopped",
    queue: queueOf([
      converted("file-1", "run-1.raw"),
      cancelled("file-2", "run-2.raw"),
      notRun("file-3", "run-3.raw"),
    ]),
  };
}

function apiWith(
  state: WorkspaceConversionState,
  extra: Parameters<typeof createFakePreviewApi>[0] = {},
): FakePreviewApi {
  return createFakePreviewApi({
    initialDatasets: DATASETS,
    availability: availableBackend,
    initialConversion: state,
    ...extra,
  });
}

describe("stopping a running conversion queue", () => {
  it("offers one queue-level Stop and says what it will and will not do", async () => {
    renderApp(apiWith(runningQueue()));

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Converting item 2 of 3…")).toBeVisible();
    });

    const stop = within(panel).getByRole("button", { name: "Stop queue" });
    expect(stop).toBeEnabled();
    // Both halves of the promise, before it is pressed. Without the second, a
    // user reads `stop` as `undo` over a file that is already theirs.
    expect(within(panel).getByText(STOP_EXPLANATION)).toBeVisible();
    expect(stop).toHaveAccessibleDescription(STOP_EXPLANATION);

    // Not a cancel, not a pause, not a resume, and not a per-item control.
    expect(within(panel).queryByRole("button", { name: /^cancel/i })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /resume/i })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /pause/i })).toBeNull();
    expect(within(panel).getAllByRole("button", { name: /stop/i })).toHaveLength(1);
    // And still no fraction of an item.
    expect(within(panel).queryByRole("progressbar")).toBeNull();
    expect(panel.textContent ?? "").not.toMatch(/\d+\s?%/);
  });

  it("names the running queue when it asks Rust to stop, and asks once", async () => {
    // Never settles. What is under test is the request, not what follows it.
    const api = apiWith(runningQueue(), { stop: () => new Promise(() => {}) });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const stop = await within(panel).findByRole("button", { name: "Stop queue" });
    fireEvent.click(stop);

    await waitFor(() => {
      expect(api.stopRequests).toEqual(["1"]);
    });
    // The control is gone for the whole of the window, so a second press
    // cannot reach a request that is already under way.
    await waitFor(() => {
      expect(within(panel).queryByRole("button", { name: "Stop queue" })).toBeNull();
    });
    expect(within(panel).getByText("Stopping queue…")).toBeVisible();
    expect(api.stopRequests).toEqual(["1"]);
  });

  it("says nothing about how the current item will end while it is stopping", async () => {
    renderApp(
      apiWith(stoppingQueue()),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Stopping queue…")).toBeVisible();
    });
    expect(
      within(panel).getByText(
        "No further items will start. The current conversion may still finish on its own.",
      ),
    ).toBeVisible();
    // The queue and every result it already has stay on screen.
    expect(
      panel.querySelectorAll(".conversion-running .conversion-queue-list > li"),
    ).toHaveLength(3);
    expect(within(panel).getByText("Converted")).toBeVisible();
    // Nothing predicts the outcome of the item under way.
    expect(panel.textContent ?? "").not.toContain("Cancelled");
    await waitFor(() => {
      expect(liveRegion()).toContain("Stopping queue. No further items will start.");
    });
  });

  it("keeps the completed output, cancels the running item and runs no other", async () => {
    renderApp(apiWith(stoppedQueue()));

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Queue stopped")).toBeVisible();
    });

    // The queue's own list, not the plan's below it.
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(".conversion-running .conversion-queue-list > li"),
    );
    expect(items.map((item) => item.getAttribute("data-item-state"))).toEqual([
      "finalized",
      "cancelled",
      "notRun",
    ]);
    // Each said in words, and a not-run item is never called a failure.
    expect(within(items[0]).getByText("Converted")).toBeVisible();
    expect(within(items[1]).getByText("Cancelled")).toBeVisible();
    expect(within(items[2]).getByText("Not run")).toBeVisible();
    expect(panel.textContent ?? "").not.toContain("Failed");

    // The finished output is still named; the cancelled one produced nothing
    // and claims nothing.
    expect(items[0].textContent ?? "").toContain("run-1.mzML");
    expect(items[1].textContent ?? "").not.toContain("28,655");

    expect(
      within(panel).getByText("1 converted, 0 skipped, 0 failed, 1 cancelled, 1 not run of 3."),
    ).toBeVisible();
    expect(
      within(panel).getByText(
        "Completed outputs remain in the destination folder. Cancelled and not-run items were not finalized by this queue.",
      ),
    ).toBeVisible();
  });

  it("names a temporary folder a cancelled item left in the user's destination", async () => {
    // A cancelled item carries no report by construction, so the residue it
    // left is recorded only on its cancellation facts. What is left behind is
    // in the folder the user chose, which makes it theirs to know about.
    renderApp(
      apiWith({
        status: "terminal",
        operationId: "1",
        reason: "stopped",
        queue: queueOf([
          converted("file-1", "run-1.raw"),
          queueItem("file-2", "run-2.raw", {
            state: "cancelled",
            attempts: 1,
            cancellation: {
              processLaunched: true,
              terminationRequested: true,
              treeTerminationConfirmed: true,
              elapsedMilliseconds: 64,
              termination: "cancelled",
              partialOutputObserved: true,
              stagingResidue: "directory_remains",
            },
          }),
          notRun("file-3", "run-3.raw"),
        ]),
      }),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    const items = await waitFor(() => {
      const rows = Array.from(
        panel.querySelectorAll<HTMLElement>(".conversion-running .conversion-queue-list > li"),
      );
      expect(rows).toHaveLength(3);
      return rows;
    });
    expect(within(items[1]).getByText("Cancelled")).toBeVisible();
    expect(
      within(items[1]).getByText("MSCanvas could not remove its own temporary folder afterwards."),
    ).toBeVisible();
    // Said about that item and no other.
    expect(items[0].textContent ?? "").not.toContain("temporary folder");
    expect(items[2].textContent ?? "").not.toContain("temporary folder");
    // And no path to the folder it is talking about.
    expect(panel.textContent ?? "").not.toContain("\\");
  });

  it("stops claiming the backend is available the moment a stop is unconfirmed", async () => {
    // Quarantine does not change the installation, so nothing about it advances
    // the installation sequence that normally makes the banner re-read. Without
    // a signal of its own the banner would go on saying ProteoWizard is
    // available while every action that uses one was refused.
    let quarantine: (() => void) | null = null;
    const api = apiWith(runningQueue(), {
      stop: (_operationId, publish) => {
        quarantine?.();
        const settled: WorkspaceConversionState = {
          status: "terminal",
          operationId: "1",
          reason: "stopFailed",
          queue: queueOf([
            converted("file-1", "run-1.raw"),
            queueItem("file-2", "run-2.raw", { state: "cancellationFailed", attempts: 1 }),
            notRun("file-3", "run-3.raw"),
          ]),
        };
        publish(settled);
        return Promise.resolve(settled);
      },
    });
    quarantine = api.quarantineBackend;
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    // It said the backend was fine right up until the stop.
    expect(await screen.findByText(/ProteoWizard is available/)).toBeVisible();
    fireEvent.click(await within(panel).findByRole("button", { name: "Stop queue" }));

    const banner = (await screen.findByText("ProteoWizard is not available"))
      .parentElement as HTMLElement;
    expect(banner.textContent ?? "").toContain(
      "MSCanvas could not confirm that the converter process stopped.",
    );
    expect(banner.textContent ?? "").toContain(
      "Restart MSCanvas before starting another preview or conversion.",
    );
    // And the gates derived from that verdict close with it.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    });
  });

  it("makes a dispatched retry stoppable without waiting for a poll", async () => {
    // Rust moves the slot to running inside the retry command and then does not
    // answer until the whole rerun is over. Without a read of its own, the panel
    // would hold the old terminal state until the next poll -- and a rerun of
    // several acquisitions is exactly the wait a user wants to interrupt at the
    // start of.
    const completed: WorkspaceConversionState = {
      status: "terminal",
      operationId: "1",
      reason: "completed",
      queue: queueOf([
        converted("file-1", "run-1.raw"),
        queueItem("file-2", "run-2.raw", {
          state: "failed",
          attempts: 1,
          retryable: true,
          error: {
            kind: "file_unreadable",
            summary: "MSCanvas could not read that file.",
            detail: null,
            retryable: true,
          },
        }),
        queueItem("file-3", "run-3.raw", { state: "finalized", attempts: 1 }),
      ]),
    };
    const api = createFakePreviewApi({
      initialDatasets: DATASETS,
      availability: availableBackend,
      initialConversion: completed,
      // Modelled as Rust behaves, including the part that makes this hard: the
      // command proves the calling document before it moves the slot, so the
      // read this document issues beside the dispatch lands *first* and is
      // discarded by the sequence guard. Recovering from that is the case under
      // test, so the transition is deliberately deferred rather than immediate.
      // The command itself never answers, because Rust's does not until the
      // whole rerun is over.
      retry: async (publish) => {
        await Promise.resolve();
        await Promise.resolve();
        publish(runningQueue());
        return new Promise<WorkspaceConversionState>(() => {
          // Deliberately never settled.
        });
      },
      // Slower than the transition poll, which is the case that matters: only
      // the newest read may install, so overlapping reads would leave every
      // reply stale on arrival and the panel would sit on "Retrying the
      // failures…" for ever while adding an outstanding read every tick.
      stateReadLatency: () => new Promise((resolve) => setTimeout(resolve, 150)),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Retry 1 failed" }));

    // The window itself never claims the queue cannot be stopped.
    expect(panel.textContent ?? "").not.toContain("cannot cancel");
    // And it resolves into a stoppable queue without a poll interval passing.
    const stop = await within(panel).findByRole("button", { name: "Stop queue" });
    expect(stop).toBeEnabled();
    expect(stop).toHaveAccessibleDescription(STOP_EXPLANATION);
  });

  it("announces both the stop and the refusal that ended the queue", async () => {
    // A queue-level refusal and a stop are not alternatives: the destination
    // can become unwritable in the same moment the user presses Stop. The panel
    // shows both, so a region that announced only one would be describing a
    // different queue to the reader who cannot see it.
    renderApp(
      apiWith({
        status: "terminal",
        operationId: "1",
        reason: "stopped",
        queue: {
          ...queueOf([
            converted("file-1", "run-1.raw"),
            cancelled("file-2", "run-2.raw"),
            notRun("file-3", "run-3.raw"),
          ]),
          error: previewError({
            kind: "destination_unwritable",
            summary: "MSCanvas cannot write to that folder.",
            retryable: false,
          }),
        },
      }),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Queue stopped")).toBeVisible();
    });
    expect(within(panel).getByText("MSCanvas cannot write to that folder.")).toBeVisible();
    await waitFor(() => {
      expect(liveRegion()).toContain(
        "Queue stopped. 1 converted, 0 skipped, 0 failed, 1 cancelled, 1 not run.",
      );
    });
    expect(liveRegion()).toContain("MSCanvas cannot write to that folder.");
  });

  it("offers no retry for a stopped queue, however many failures it holds", async () => {
    renderApp(
      apiWith({
        status: "terminal",
        operationId: "1",
        reason: "stopped",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", {
            state: "failed",
            attempts: 1,
            retryable: true,
            error: {
              kind: "file_unreadable",
              summary: "MSCanvas could not read that file.",
              detail: null,
              retryable: true,
            },
          }),
          cancelled("file-2", "run-2.raw"),
          notRun("file-3", "run-3.raw"),
        ]),
      }),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Queue stopped")).toBeVisible();
    });
    // The failure is retryable in itself, and the queue is still not rerun in
    // place: converting those rows again is a new queue from the roster.
    expect(within(panel).queryByRole("button", { name: /^retry/i })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /resume/i })).toBeNull();
    // The ordinary way to convert again is the one that was always there.
    //
    // Awaited, unlike the two queries above it. Those assert an absence, which
    // is true from the first render; this one asserts a presence that arrives
    // with the plan for the focused row, which is a read. Asserting it
    // synchronously passed whenever that read happened to have resolved and
    // failed under load, which is a flake rather than a claim.
    expect(await within(panel).findByRole("button", { name: /^Convert/ })).toBeVisible();
  });

  it("keeps Retry failed for a queue that ran to its own end", async () => {
    renderApp(
      apiWith({
        status: "terminal",
        operationId: "1",
        reason: "completed",
        queue: queueOf([
          converted("file-1", "run-1.raw"),
          queueItem("file-2", "run-2.raw", {
            state: "failed",
            attempts: 1,
            retryable: true,
            error: {
              kind: "file_unreadable",
              summary: "MSCanvas could not read that file.",
              detail: null,
              retryable: true,
            },
          }),
        ]),
      }),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Retry 1 failed" })).toBeVisible();
    });
    // And a completed queue says nothing about stopping.
    expect(within(panel).queryByText(/Queue stopped/)).toBeNull();
  });

  it("warns that a stop was not confirmed and refuses every backend action", async () => {
    const api = createFakePreviewApi({
      initialDatasets: DATASETS,
      availability: availableBackend,
      initialBackendQuarantined: true,
      initialConversion: {
        status: "terminal",
        operationId: "1",
        reason: "stopFailed",
        queue: queueOf([
          converted("file-1", "run-1.raw"),
          queueItem("file-2", "run-2.raw", {
            state: "cancellationFailed",
            attempts: 1,
            cancellation: {
              processLaunched: true,
              terminationRequested: true,
              treeTerminationConfirmed: false,
              elapsedMilliseconds: 5_000,
              termination: null,
              partialOutputObserved: true,
              stagingResidue: null,
            },
          }),
          notRun("file-3", "run-3.raw"),
        ]),
      },
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    // The heading a user skims must not claim the one thing this state does
    // not establish, and then be walked back by the warning under it.
    // Outside the item list: the same words label the item that could not be
    // confirmed, and it is the queue's own heading being asserted here.
    const headings = await within(panel).findAllByText("Stop could not be confirmed");
    expect(headings.filter((node) => node.closest("li") === null)).toHaveLength(1);
    expect(within(panel).queryByText("Queue stopped")).toBeNull();
    await waitFor(() => {
      expect(liveRegion()).toContain("Stop could not be confirmed.");
    });
    expect(liveRegion()).not.toContain("Queue stopped");

    const warning = await within(panel).findByRole("alert");
    // High priority, and not carried by colour alone.
    expect(warning.textContent ?? "").toContain(
      "MSCanvas could not confirm that the backend process stopped.",
    );
    expect(warning.textContent ?? "").toContain(
      "Restart MSCanvas before starting another preview or conversion.",
    );
    // Never called cancelled, and never called stopped without qualification.
    expect(headings.filter((node) => node.closest("li") !== null)).toHaveLength(1);
    // No raw process detail anywhere.
    for (const forbidden of ["pid", "PID", "handle 0x", "0x"]) {
      expect(panel.textContent ?? "").not.toContain(forbidden);
    }

    // Every backend control is refused while quarantined.
    expect(within(panel).queryByRole("button", { name: /^retry/i })).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Convert/ })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    // And the roster is still readable and searchable.
    expect(screen.getByRole("listbox", { name: "Workspace" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: /search/i })).toBeEnabled();

    // The backend banner says the same thing, because a user who has scrolled
    // past the queue still needs to know why nothing will start. It is never a
    // stale "available" beside a session that refuses every backend action.
    const banner = (await screen.findByText("ProteoWizard is not available"))
      .parentElement as HTMLElement;
    expect(banner.textContent ?? "").toContain(
      "MSCanvas could not confirm that the converter process stopped.",
    );
    expect(banner.textContent ?? "").toContain(
      "Restart MSCanvas before starting another preview or conversion.",
    );
  });

  it("recovers a stopping queue a reload found, without asking Rust to stop again", async () => {
    const api = apiWith(stoppingQueue("7"));
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Stopping queue…")).toBeVisible();
    });
    // A reload recovers the state. It does not re-issue the request, and it
    // does not offer a control for work already being stopped.
    expect(api.stopRequests).toEqual([]);
    expect(within(panel).queryByRole("button", { name: "Stop queue" })).toBeNull();
    // Every row a stopping queue holds is still protected.
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
  });

  it("shows no stale Stop for a queue that is already over", async () => {
    const api = apiWith(stoppedQueue());
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Queue stopped")).toBeVisible();
    });
    expect(within(panel).queryByRole("button", { name: "Stop queue" })).toBeNull();
    expect(api.stopRequests).toEqual([]);
    // A terminal queue holds nothing, so the workspace is the user's again.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Clear list" })).toBeEnabled();
  });

  it("keeps focus where the user left it when a queue settles under them", async () => {
    const api = apiWith(runningQueue(), { stop: () => Promise.resolve(stoppedQueue()) });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const stop = await within(panel).findByRole("button", { name: "Stop queue" });
    stop.focus();
    expect(document.activeElement).toBe(stop);
    fireEvent.click(stop);

    await waitFor(() => {
      expect(within(panel).getByText("Queue stopped")).toBeVisible();
    });
    // The control the user pressed is gone, and nothing stole the keyboard to
    // somewhere unrelated: focus falls back to the document body rather than
    // jumping into the roster or the plan below.
    expect(document.activeElement === document.body || document.activeElement === null).toBe(
      true,
    );
  });

  it("keeps queued and converting rows visible while a stop is in flight", async () => {
    renderApp(
      apiWith(stoppingQueue()),
    );

    await screen.findByRole("listbox", { name: "Workspace" });
    const search = screen.getByRole("searchbox", { name: /search/i });
    fireEvent.change(search, { target: { value: "nothing-matches-this" } });

    // A search that hides the row a stop is waiting on would hide the one thing
    // the user is watching.
    await waitFor(() => {
      expect(screen.getByText("Converting — outside search")).toBeVisible();
    });
    expect(screen.getAllByText("Queued — outside search")).toHaveLength(2);
  });
});
