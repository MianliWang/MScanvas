import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  stoppedAttemptFacts,
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

// The other scope's copy, written out here for the same reason the one above is:
// asserting the rendered sentence against a constant imported from the panel
// would pass whatever the panel happened to say.
const CANCEL_ITEM_EXPLANATION =
  "Files already converted are kept, and the items after it still run. It may finish on its own first, and then it keeps its result. If MSCanvas cannot confirm that its converter ended, the whole queue stops and the session needs a restart.";

// What the same control says once this document has asked. Its own sentence,
// because the unavailable one -- "available while a file is being converted" --
// would be shown exactly while a file is being converted.
const CANCEL_ITEM_IN_FLIGHT_EXPLANATION =
  "This file may still finish on its own, and then it keeps its result. The items after it still run. If MSCanvas cannot confirm that its converter ended, the whole queue stops and the session needs a restart.";

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
          advisory: [],
        },
        backend: { exitCode: 0, elapsedMilliseconds: 568 },
        stagingResidue: null,
        receipt: 1,
      },
    },
  });
}

/** An item a confirmed stop reached while it was running. */
function cancelled(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "cancelled",
    attempts: 1,
    // A launched stop's own attempt facts, so the row's five judgements agree
    // with the cancellation beside them.
    ...stoppedAttemptFacts(),
    cancellation: {
      processLaunched: true,
      terminationRequested: true,
      ownedTree: "confirmed_gone",
      elapsedMilliseconds: 71,
      termination: "cancelled",
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

    // Two scopes, and exactly two. M6.8 admitted ending the one file being
    // converted, on a process boundary that owns the backend tree before it can
    // grow and a measurement of the installed build; the queue-level stop it
    // sits beside is unchanged. Each names its own scope, because two controls
    // both called "Stop" would be the ambiguity this pair exists to avoid.
    const stopScoped = within(panel).getAllByRole("button", { name: /stop/i });
    expect(stopScoped.map((button) => button.textContent)).toEqual([
      "Stop queue",
      "Stop this file",
    ]);
    const cancelItem = within(panel).getByRole("button", { name: "Stop this file" });
    expect(cancelItem).toBeEnabled();
    expect(cancelItem).toHaveAccessibleDescription(
      `Stop this file ends run-2.raw and carries on with the rest of the queue. ${CANCEL_ITEM_EXPLANATION}`,
    );

    // Still no pause and no resume: M6.8 adds neither, and a queue that could
    // be suspended is a different lifecycle from the one this ships.
    expect(within(panel).queryByRole("button", { name: /resume/i })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /pause/i })).toBeNull();
    // And still nothing that would take a row out of the bound plan.
    expect(within(panel).queryByRole("button", { name: /remove/i })).toBeNull();
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

  it("asks once for a skip however many times it is pressed", async () => {
    /*
     * The authoritative state cannot answer whether a skip is already under
     * way: it is what the *reply* will say, and between the press and the reply
     * it still reports the row as pending. Two presses in that window used to
     * both pass, Rust would accept the first and refuse the second, and this
     * document would show an error for a skip that had in fact succeeded.
     *
     * **The two presses share one render pass, and that is the whole test.**
     * Written as consecutive `fireEvent.click` calls it proved nothing: each
     * one flushes React, the button is gone by the second, and the assertion
     * below passed with the single-flight guard removed. Dispatching both
     * inside one `act` is the window a real double-press lands in -- the
     * handler runs twice against a state that has not moved, which is why the
     * guard has to be a ref rather than the rendered decision.
     */
    let settle: (state: WorkspaceConversionState) => void = () => {};
    const held = new Promise<WorkspaceConversionState>((resolve) => {
      settle = resolve;
    });
    const api = apiWith(runningQueue(), { skipItem: () => held });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const skip = await within(panel).findByRole("button", { name: "Skip run-3.raw" });
    act(() => {
      skip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      skip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      skip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // One request, whatever the pressing looked like.
    await waitFor(() => {
      expect(api.itemSkipRequests).toEqual([{ operationId: "1", itemIndex: 2 }]);
    });
    // And the control is withdrawn for the whole of that window rather than
    // staying live at something already happening.
    expect(within(panel).queryByRole("button", { name: "Skip run-3.raw" })).toBeNull();
    // Nothing is reported as having gone wrong, because nothing did. The
    // refusal this used to produce carries that exact sentence.
    expect(panel.textContent ?? "").not.toContain("no longer waiting its turn");

    settle({
      status: "running",
      operationId: "1",
      queue: queueOf([
        converted("file-1", "run-1.raw"),
        queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 }),
        queueItem("file-3", "run-3.raw", { state: "skippedByRequest" }),
      ]),
    });
    await waitFor(() => {
      expect(
        within(panel).getByText("Skipped — you chose not to convert this one"),
      ).toBeVisible();
    });
    expect(api.itemSkipRequests).toEqual([{ operationId: "1", itemIndex: 2 }]);
  });

  it("tells a listener about the two items a user decided, not only the three counts", async () => {
    /*
     * The panel's own summary grew for this: a completed queue can now hold a
     * file the user ended and a row they skipped, and three counts would leave
     * two of three items unaccounted for. The live region is the same claim to
     * a different reader, and a region that named neither would give a listener
     * less than the panel gives a sighted reader.
     */
    const api = apiWith({
      status: "terminal",
      operationId: "1",
      reason: "completed",
      queue: queueOf([
        converted("file-1", "run-1.raw"),
        cancelled("file-2", "run-2.raw"),
        queueItem("file-3", "run-3.raw", { state: "skippedByRequest" }),
      ]),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText("1 converted, 0 skipped, 0 failed, 1 cancelled, 1 skipped by you of 3."),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(liveRegion()).toContain(
        "1 converted, 0 skipped, 0 failed, 1 cancelled, 1 skipped by you.",
      );
    });
  });

  it("does not offer Skip on a row a retry moved back to waiting", async () => {
    /*
     * `begin_retry` moves every retryable failure back to `pending` while its
     * error, its attempt count and its diagnostic ticket stay in place, so
     * during a rerun a `pending` row may be one that ran and failed in the pass
     * before. Rust settles such a row with the result it earned rather than
     * claiming nothing ran -- which is right, and would make pressing `Skip`
     * turn a row labelled "Waiting" into one labelled "Failed" with no mention
     * of a skip. The control is withdrawn instead: it is offered only where it
     * does what its label says.
     */
    const api = apiWith({
      status: "running",
      operationId: "1",
      queue: queueOf([
        queueItem("file-1", "run-1.raw", { state: "running", attempts: 2 }),
        // Both counts, because the rule is `attempts === 0` and a test that
        // used only one of them would pass for `attempts !== 1` -- or, having
        // moved to two, for `attempts !== 2`. One failed pass is also the
        // common case, and it was the one the single-count version dropped.
        queueItem("file-2", "run-2.raw", { state: "pending", attempts: 1 }),
        queueItem("file-4", "run-4.raw", { state: "pending", attempts: 2 }),
        // Never reached in any pass.
        queueItem("file-3", "run-3.raw", { state: "pending" }),
      ]),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Skip run-3.raw" })).toBeEnabled();
    });
    expect(within(panel).queryByRole("button", { name: "Skip run-2.raw" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Skip run-4.raw" })).toBeNull();
    // And the row says why, rather than being a "Waiting" row that silently
    // lacks a control its neighbour has.
    expect(
      within(panel).getAllByText(
        "Rerunning an earlier failure — it keeps that result if it is not run again.",
      ),
    ).toHaveLength(2);
  });

  it("sends one request when this file's stop is activated twice in a tick", async () => {
    /*
     * Two activations before the first reply -- a double click, or Enter held.
     * Both handlers read the same running item from the same ref, so a guard on
     * rendered state cannot separate them. Rust accepts a repeat against the
     * same live attempt idempotently, but the attempt can settle between the
     * two: the second then names an attempt that is over and is refused, and
     * the document shows an error for a file it had in fact stopped.
     */
    let settle: (state: WorkspaceConversionState) => void = () => {};
    const held = new Promise<WorkspaceConversionState>((resolve) => {
      settle = resolve;
    });
    const api = apiWith(runningQueue(), { cancelItem: () => held });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const cancelItem = await within(panel).findByRole("button", {
      name: "Stop this file",
    });
    // Both inside one act, which is what "in a tick" means: React batches the
    // updates and neither handler sees the other's rendered effect. Two
    // separate fireEvents would flush between them and the second would find a
    // disabled control, which is the rendering this asserts is not the guard.
    await act(async () => {
      fireEvent.click(cancelItem);
      fireEvent.click(cancelItem);
    });

    expect(api.itemCancelRequests).toHaveLength(1);
    await waitFor(() => {
      expect(within(panel).getByText("Stopping this file…")).toBeVisible();
    });
    expect(api.itemCancelRequests).toHaveLength(1);

    await act(async () => {
      settle(stoppedQueue());
      await held;
    });
    expect(api.itemCancelRequests).toHaveLength(1);
  });

  it("draws a stop this document did not make, from the queue Rust serialises", async () => {
    /*
     * Stopping one file takes as long as the converter takes, and for a while
     * that request lived only in the React state of the document that pressed
     * the button. A view mounting inside the window -- a reload, or this pane
     * being reached again -- read the item back as plainly `running` and drew
     * "Converting" with the control live, offering to ask for something the
     * authority had already accepted. Rust holds the request; this asserts the
     * interface reads it rather than only remembering it.
     */
    const stopping = queueOf([
      converted("file-1", "run-1.raw"),
      queueItem("file-2", "run-2.raw", {
        state: "running",
        attempts: 1,
        stopRequested: true,
      }),
      queueItem("file-3", "run-3.raw"),
    ]);
    const api = apiWith({ status: "running", operationId: "1", queue: stopping });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const control = await within(panel).findByRole("button", {
      name: "Stopping this file…",
    });
    expect(control).toBeDisabled();
    expect(within(panel).queryByRole("button", { name: "Stop this file" })).toBeNull();
    expect(within(panel).getByText(CANCEL_ITEM_IN_FLIGHT_EXPLANATION)).toBeVisible();
  });

  it("counts what was converted between items, not what is no longer pending", async () => {
    /*
     * The panel published `currentIndex` as a success count. It is how many
     * items are no longer pending, so a first file that failed, was skipped by
     * the conflict policy, was skipped by the user or was cancelled all read as
     * one converted -- announced in the interval after an item settles and
     * before the next one starts, which directory re-admission widens.
     */
    const afterAFailure = queueOf([
      queueItem("file-1", "run-1.raw", {
        state: "failed",
        attempts: 1,
        retryable: true,
        error: previewError(),
      }),
      queueItem("file-2", "run-2.raw"),
    ]);
    const api = apiWith({ status: "running", operationId: "1", queue: afterAFailure });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(
      within(panel).getByText("Converted 0 of 2, starting the next…"),
    ).toBeVisible();
  });

  it("stops saying the control is available once this document has asked", async () => {
    /*
     * Between the press and Rust's reply the panel is still on the running
     * branch, the button reads "Stopping this file…", and the note beside it
     * used to read "Available while a file is being converted, and not once the
     * whole queue is stopping" -- shown exactly while a file was being
     * converted and the queue was not stopping. The in-flight sentence is also
     * silent about the outcome, for the same reason the queue-level one is.
     */
    let settle: (state: WorkspaceConversionState) => void = () => {};
    const held = new Promise<WorkspaceConversionState>((resolve) => {
      settle = resolve;
    });
    const api = apiWith(runningQueue(), { cancelItem: () => held });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const cancelItem = await within(panel).findByRole("button", {
      name: "Stop this file",
    });
    fireEvent.click(cancelItem);

    await waitFor(() => {
      expect(within(panel).getByText("Stopping this file…")).toBeVisible();
    });
    expect(within(panel).getByText(CANCEL_ITEM_IN_FLIGHT_EXPLANATION)).toBeVisible();
    expect(panel.textContent ?? "").not.toContain(
      "Available while a file is being converted",
    );

    settle({
      status: "running",
      operationId: "1",
      queue: queueOf([
        converted("file-1", "run-1.raw"),
        cancelled("file-2", "run-2.raw"),
        queueItem("file-3", "run-3.raw", { state: "running", attempts: 1 }),
      ]),
    });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Stop this file" })).toBeEnabled();
    });
  });

  it("tells a listener the counts and the refusal, not the refusal alone", async () => {
    /*
     * The one state this milestone added always carries both: a session that
     * loses track of a process refuses the rest of the queue, which settles
     * `completed` with rows marked not-run *and* an error. The live region used
     * to return the error summary and stop, so a listener got the refusal and
     * none of the counts while the panel showed both -- and the test that was
     * meant to catch it built its queue with a fixture that hard-coded
     * `error: null`, a state Rust never emits on this path.
     */
    const api = apiWith({
      status: "terminal",
      operationId: "1",
      reason: "completed",
      queue: queueOf(
        [
          converted("file-1", "run-1.raw"),
          queueItem("file-2", "run-2.raw", { state: "failed", attempts: 1 }),
          queueItem("file-3", "run-3.raw", { state: "notRun" }),
        ],
        previewError({
          kind: "backend_quarantined",
          summary:
            "MSCanvas could not confirm that a ProteoWizard process it started has ended.",
          retryable: false,
        }),
      ),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText("1 converted, 0 skipped, 1 failed, 1 not run of 3."),
      ).toBeVisible();
    });
    await waitFor(() => {
      const spoken = liveRegion();
      expect(spoken).toContain("1 converted, 0 skipped, 1 failed, 1 not run.");
      expect(spoken).toContain(
        "MSCanvas could not confirm that a ProteoWizard process it started has ended.",
      );
    });
  });

  it("keeps the skip control on screen while it is unanswered, and says so", async () => {
    /*
     * Two rules this milestone's other controls already follow and this one did
     * not. The button was unmounted the moment the skip was dispatched, which
     * drops focus to the document for a keyboard user; and nothing was
     * announced, because a successful skip leaves the running item where it was
     * and the region's string byte-identical either side of the press.
     */
    let settle: (state: WorkspaceConversionState) => void = () => {};
    const held = new Promise<WorkspaceConversionState>((resolve) => {
      settle = resolve;
    });
    const api = apiWith(runningQueue(), { skipItem: () => held });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const skip = await within(panel).findByRole("button", { name: "Skip run-3.raw" });
    fireEvent.click(skip);

    const skipping = await within(panel).findByRole("button", {
      name: "Skipping run-3.raw…",
    });
    expect(skipping).toBeDisabled();
    await waitFor(() => {
      expect(liveRegion()).toContain("Skipping run-3.raw.");
    });
    expect(liveRegion()).toContain("the queue carries on");

    settle(runningQueue());
  });

  it("speaks the output-only claim for a queue whose stop was not confirmed", async () => {
    /*
     * The panel shows it for every terminal reason. The region showed it for
     * two of the three, and the one it withheld is the state in which what was
     * and was not verified most needs saying.
     */
    const api = apiWith({
      status: "terminal",
      operationId: "1",
      reason: "stopFailed",
      queue: queueOf([
        converted("file-1", "run-1.raw"),
        queueItem("file-2", "run-2.raw", { state: "cancellationFailed", attempts: 1 }),
        queueItem("file-3", "run-3.raw", { state: "notRun" }),
      ]),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText(/Output-only validation\./)).toBeVisible();
    });
    await waitFor(() => {
      expect(liveRegion()).toContain("Output-only validation.");
    });
  });

  it("tells a listener that this file's stop was accepted", async () => {
    /*
     * The queue-level stop has been announced since M3.4. The per-item one had
     * nothing: the state is still `running` with the item still `running`, so
     * the region returned the unchanged "Converting item N of M" and, being
     * unchanged, said nothing at all -- while the panel changed its button and
     * swapped its note, both outside any live region.
     */
    let settle: (state: WorkspaceConversionState) => void = () => {};
    const held = new Promise<WorkspaceConversionState>((resolve) => {
      settle = resolve;
    });
    const api = apiWith(runningQueue(), { cancelItem: () => held });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const cancelItem = await within(panel).findByRole("button", {
      name: "Stop this file",
    });
    fireEvent.click(cancelItem);

    await waitFor(() => {
      expect(liveRegion()).toContain("Stopping run-2.raw.");
    });
    expect(liveRegion()).toContain("may still finish on its own");
    settle(runningQueue());
  });

  it("renders both defensive counts a completed queue could hold", async () => {
    /*
     * **A rendering test for a pairing Rust does not currently produce, and it
     * says so rather than claiming otherwise.** `notRun` in a completed queue
     * is reachable -- the test above exercises the real path, where a session
     * that cannot account for a process refuses the rest of the queue -- but
     * `cancellationFailed` is not: that state has one producer, a stop whose
     * termination could not be confirmed, and the queue is then `stopFailed`.
     * The summary and the live region carry it anyway, for the reason the panel
     * gives: a count neither of them can render is a count they would report
     * nowhere if the pairing ever changed. This pins that they can.
     */
    const api = apiWith({
      status: "terminal",
      operationId: "1",
      reason: "completed",
      queue: queueOf([
        converted("file-1", "run-1.raw"),
        queueItem("file-2", "run-2.raw", { state: "cancellationFailed", attempts: 1 }),
        queueItem("file-3", "run-3.raw", { state: "notRun" }),
      ]),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(
          "1 converted, 0 skipped, 0 failed, 1 not run, 1 stop could not be confirmed of 3.",
        ),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(liveRegion()).toContain(
        "1 converted, 0 skipped, 0 failed, 1 not run, 1 stop could not be confirmed.",
      );
    });
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
      within(panel).getByText(
        "1 converted, 0 skipped, 0 failed, 1 cancelled, 1 not run, 0 skipped by you of 3.",
      ),
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
            ...stoppedAttemptFacts(),
            cancellation: {
              processLaunched: true,
              terminationRequested: true,
              ownedTree: "confirmed_gone",
              elapsedMilliseconds: 64,
              termination: "cancelled",
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
      "MSCanvas could not confirm that a ProteoWizard process it started has ended.",
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
        "Queue stopped. 1 converted, 0 skipped, 0 failed, 1 cancelled, 1 not run, 0 skipped by you.",
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
            ...stoppedAttemptFacts(),
            cancellation: {
              processLaunched: true,
              terminationRequested: true,
              ownedTree: "unconfirmed",
              elapsedMilliseconds: 5_000,
              // The tree is what could not be confirmed. The process's own
              // ending came back settled, which is why the launch answer is
              // `true` rather than unknown.
              termination: "cancelled",
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
      "MSCanvas could not confirm that a ProteoWizard process it started has ended.",
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
