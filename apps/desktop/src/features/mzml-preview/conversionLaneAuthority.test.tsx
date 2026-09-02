/**
 * One conversion lane, asked by the operation and by every control that offers
 * one.
 *
 * `conversionAvailability.test.ts` pins the decision. What is pinned here is
 * that the shipped surfaces and the shipped operation both consume it, over the
 * real hook and the real panel rather than over a rule re-stated for the test:
 * every assertion below reaches the authority through `App` or through
 * `usePreviewWorkspace`, so a wiring that stopped asking would fail even while
 * the decision itself stayed correct.
 *
 * Four defects are pinned by name, because each of them shipped:
 *
 * - the start control and the operation guard were two expressions, and the
 *   guard was strictly narrower -- so a quarantined backend, a check in flight
 *   and an unsettled workspace mutation each greyed the button while the
 *   operation would have accepted a dispatch that reached it another way;
 * - the lane was claimed synchronously at dispatch and every rendered value
 *   followed a later slot read, so the interface offered a second conversion
 *   for the whole of that window;
 * - an arriving read assigned the claim unconditionally, so a reply describing
 *   a slot that had not seen the dispatch cleared a claim just raised;
 * - `canRetry` was computed and read by nothing, and `Retry` answered to the
 *   start control's boolean instead.
 */

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type { SelectedFile, WorkspaceConversionState } from "./contracts";
import type { WorkspaceDropTransport } from "./dropTransport";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import { App } from "../../app/App";
import type { FakePreviewApi, FakePreviewApiOptions } from "../../test/previewFixtures";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  queueItem,
  queueOf,
  selectedFile,
  unavailableBackend,
} from "../../test/previewFixtures";

/** A vendor acquisition, which is a row this workflow can convert. */
function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const vendorRow = acquisition(1);

/** A finished queue holding one failure another attempt could change. */
function retryableQueue(failures: number): WorkspaceConversionState {
  return {
    status: "terminal",
    operationId: "1",
    reason: "completed",
    queue: queueOf(
      Array.from({ length: failures }, (_unused, index) =>
        queueItem(`file-${String(index + 1)}`, `run-${String(index + 1)}.raw`, {
          state: "failed",
          attempts: 1,
          retryable: true,
        }),
      ),
    ),
  };
}

/** A finished queue whose failures another attempt would not change. */
const NOTHING_TO_RETRY: WorkspaceConversionState = {
  status: "terminal",
  operationId: "1",
  reason: "completed",
  queue: queueOf([
    queueItem(vendorRow.handle, vendorRow.fileName, {
      state: "failed",
      attempts: 1,
      retryable: false,
    }),
  ]),
};

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** The hook itself, for the half of an equivalence claim a disabled control cannot make. */
function mountHook(api: PreviewApi, dropTransport: WorkspaceDropTransport) {
  return renderHook(() => usePreviewWorkspace(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        WorkspaceDropTransportProvider,
        { value: dropTransport },
        createElement(PreviewApiProvider, { value: api }, children),
      ),
  });
}

async function conversionPanel(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Convert" });
}

async function convertControl(): Promise<HTMLElement> {
  const panel = await conversionPanel();
  return within(panel).findByRole("button", { name: /^Convert/u });
}

/** Every sentence the panel is currently giving as a reason. */
function reasonsOnScreen(): string[] {
  return [...document.querySelectorAll("[data-live-region='conversion-availability'] p")].map(
    (element) => element.textContent ?? "",
  );
}

const BACKEND_REASON =
  "Converting needs ProteoWizard, and this session has no usable backend. " +
  "See the backend status above.";

describe("the conversion lane's one authority, as it ships", () => {
  it("refuses a second activation inside the commit that dispatched the first", async () => {
    /*
     * The window the M5 handoff left open, and the one a rendered `disabled`
     * cannot close on its own. Both activations land before React commits
     * anything, so the second one sees exactly the render the first was
     * pressed in -- which is why the claim has to be raised where a handler can
     * read it and not only where a renderer can.
     */
    const running = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: availableBackend,
      conversion: () => running.promise,
    });
    renderApp(api);

    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeEnabled();
    });

    // Two native activations inside one batch. Nothing commits between them.
    await act(async () => {
      convert.click();
      convert.click();
      await Promise.resolve();
    });

    expect(api.conversionRequests).toHaveLength(1);

    // And from the next commit the surface has stopped offering one, rather
    // than waiting for a slot read to tell it. The plan is withdrawn while a
    // queue is under way -- two ordered lists of file to output, one live and
    // one hypothetical, is the panel describing two things in one shape -- so
    // "not offered" here is an absent control rather than a greyed one.
    const panel = await conversionPanel();
    await waitFor(() => {
      expect(within(panel).getByText("Starting the conversion…")).toBeVisible();
    });
    expect(within(panel).queryByRole("button", { name: /^Convert/u })).toBeNull();

    running.resolve({
      status: "terminal",
      operationId: "9",
      reason: "completed",
      queue: queueOf([
        queueItem(vendorRow.handle, vendorRow.fileName, { state: "finalized", attempts: 1 }),
      ]),
    });
    await waitFor(() => {
      expect(screen.getByText(/1 converted, 0 skipped, 0 failed of 1\./u)).toBeVisible();
    });
  });

  it("says a conversion is starting before the slot can report one", async () => {
    // The rendered twin of the claim, which is the whole reason the interface
    // stops offering in the same commit. Without it the panel showed the plan
    // and its enabled button for the length of the reservation.
    const running = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: availableBackend,
      conversion: () => running.promise,
    });
    renderApp(api);

    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeEnabled();
    });
    fireEvent.click(convert);

    const panel = await conversionPanel();
    await waitFor(() => {
      expect(within(panel).getByText("Starting the conversion…")).toBeVisible();
    });
    // And the region that was already being watched says it too.
    expect(document.querySelector("[data-live-region='conversion']")?.textContent).toBe(
      "Starting the conversion.",
    );
    running.resolve({ status: "idle" });
  });

  it("does not let a newer, non-owning read lower a claim the handler raised", async () => {
    /*
     * The exact rewind. The sequence guard orders reads against each other and
     * cannot order a read against a dispatch, because a dispatch moves no
     * sequence -- only Rust does, and only once it has seen the request. So a
     * slot that advanced for some other reason answers *newer* than everything
     * installed while still describing a queue that has not heard of this
     * conversion, and assigning the claim from that status is what reopened the
     * control for the one window in which pressing it starts a second one.
     *
     * Asked of the operation rather than of a control, because what the read
     * used to do was lower the claim the guard reads. The rendered half of the
     * same window is the case below.
     */
    const running = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: availableBackend,
      initialConversion: retryableQueue(1),
      conversion: () => running.promise,
    });
    const workspace = mountHook(api, createFakeWorkspaceDropTransport());
    await waitFor(() => {
      expect(workspace.result.current.conversion.retryAvailability.status).toBe("available");
    });

    // The slot advances past what this document holds, still terminal and still
    // without a queue of this dispatch's.
    act(() => {
      api.publishConversion(retryableQueue(2));
    });
    act(() => {
      workspace.result.current.conversion.convert([vendorRow.handle]);
    });
    expect(api.conversionRequests).toHaveLength(1);

    // The non-owning read arrives and installs -- the count proves it did, so
    // this is a test about what the read did to the claim rather than about
    // whether one happened.
    await waitFor(() => {
      const { state } = workspace.result.current.conversion;
      expect(state.status === "terminal" && state.queue.retryableFailedCount).toBe(2);
    });

    // And the claim stands through it, so the operation still refuses.
    expect(workspace.result.current.conversion.lane.laneClaimed).toBe(true);
    await act(async () => {
      workspace.result.current.conversion.convert([vendorRow.handle]);
      await Promise.resolve();
    });
    expect(api.conversionRequests).toHaveLength(1);

    // The dispatch's own reply settles it, which is the one observation
    // entitled to.
    await act(async () => {
      running.resolve({
        status: "terminal",
        operationId: "9",
        reason: "completed",
        queue: queueOf([
          queueItem(vendorRow.handle, vendorRow.fileName, { state: "finalized", attempts: 1 }),
        ]),
      });
      await running.promise;
    });
    await waitFor(() => {
      expect(workspace.result.current.conversion.lane.laneClaimed).toBe(false);
    });
    workspace.unmount();
  });

  it("answers a dispatched conversion with itself, not with the run before it", async () => {
    // The rendered half of the same window, from a finished queue. Every control
    // over that queue goes with it: none of them would be accepted, and a
    // sentence explaining a control that is not on screen explains nothing. What
    // is left is an acknowledgement of the press, which is what was missing.
    const running = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: availableBackend,
      initialConversion: retryableQueue(1),
      conversion: () => running.promise,
    });
    renderApp(api);

    const panel = await conversionPanel();
    await within(panel).findByRole("button", { name: "Retry 1 failed" });
    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeEnabled();
    });

    fireEvent.click(convert);
    await waitFor(() => {
      expect(within(panel).getByText("Starting the conversion…")).toBeVisible();
    });
    expect(within(panel).queryByRole("button", { name: /^Retry/u })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /^Convert/u })).toBeNull();
    // And no sentence about a control nobody can see.
    expect(reasonsOnScreen()).toEqual([]);
    running.resolve({ status: "idle" });
  });

  it("offers a rerun where a start is refused, and pins that they are different rules", async () => {
    /*
     * `Retry` answered to the start control's boolean for as long as it
     * existed, while the rule written for it was read by nothing. Here the
     * session holds no convertible row at all: a start has nothing to act on
     * and a rerun has a finished queue full of failures, so a control wired
     * back to the start decision would be disabled on this screen.
     */
    const rerun = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      availability: availableBackend,
      initialConversion: retryableQueue(1),
      retry: () => rerun.promise,
    });
    renderApp(api);

    const panel = await conversionPanel();
    const retry = await within(panel).findByRole("button", { name: "Retry 1 failed" });
    await waitFor(() => {
      expect(retry).toBeEnabled();
    });
    // There is no start control to compare against, because there is nothing to
    // start on -- which is exactly the state the two rules disagree in.
    expect(within(panel).queryByRole("button", { name: /^Convert/u })).toBeNull();

    fireEvent.click(retry);
    await waitFor(() => {
      expect(within(panel).getByText("Retrying the failures…")).toBeVisible();
    });
    rerun.resolve({ status: "idle" });
  });

  it("refuses a rerun where a start is offered", async () => {
    // The other direction, so accidental equivalence cannot return from either
    // side. A finished queue whose failures another attempt would not change
    // offers no rerun, while a convertible row is there to start on.
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: availableBackend,
      initialConversion: NOTHING_TO_RETRY,
    });
    renderApp(api);

    const panel = await conversionPanel();
    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeEnabled();
    });
    expect(within(panel).queryByRole("button", { name: /^Retry/u })).toBeNull();
    expect(
      within(panel).getByText(/would not change on another attempt/u),
    ).toBeVisible();
  });

  it("stops calling a settled queue one that is starting", async () => {
    /*
     * The window "before the slot can report one" ends when the slot reports
     * that queue, and not when it stops owning the lane. A conversion command
     * answers once, when the whole queue is over, so a queue stopped from the
     * running state leaves the claim held over a terminal slot -- and a window
     * defined by the status alone reopens there and describes the stopped
     * result as a conversion that is starting.
     */
    const finished = deferred<WorkspaceConversionState>();
    const running: WorkspaceConversionState = {
      status: "running",
      operationId: "7",
      queue: queueOf([
        queueItem(vendorRow.handle, vendorRow.fileName, { state: "running", attempts: 1 }),
      ]),
    };
    const stopped: WorkspaceConversionState = {
      status: "terminal",
      operationId: "7",
      reason: "stopped",
      queue: queueOf([
        queueItem(vendorRow.handle, vendorRow.fileName, { state: "cancelled", attempts: 1 }),
      ]),
    };
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: availableBackend,
      // Reports the queue, then waits: Rust answers the conversion once, when
      // the whole queue is over.
      conversion: (_request, publish) => {
        publish(running);
        return finished.promise;
      },
      stop: async () => stopped,
    });
    renderApp(api);

    const panel = await conversionPanel();
    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeEnabled();
    });
    fireEvent.click(convert);

    // The slot reports the queue, so the window is over even though the command
    // has not answered.
    const stop = await within(panel).findByRole("button", { name: "Stop queue" });
    expect(within(panel).queryByText("Starting the conversion…")).toBeNull();

    fireEvent.click(stop);
    await waitFor(() => {
      expect(within(panel).getByText("Queue stopped")).toBeVisible();
    });
    // And it stays stopped. The claim is still held -- the conversion command
    // has still not answered -- and that is no longer a reason to say anything
    // about starting.
    expect(within(panel).queryByText("Starting the conversion…")).toBeNull();
    expect(document.querySelector("[data-live-region='conversion']")?.textContent).toContain(
      "Queue stopped",
    );
    finished.resolve(stopped);
  });

  it("makes the operation refuse everything the control refuses", async () => {
    /*
     * The direction the audit found and the older record did not: the guard was
     * *narrower* than the rendered expression, so three lane facts greyed the
     * button while the operation itself would have accepted a dispatch. A
     * disabled control cannot be clicked, so this half is asserted against the
     * operation directly -- which is the only way to show the two now refuse
     * together rather than merely looking alike.
     */
    const cases: readonly {
      readonly name: string;
      readonly options: FakePreviewApiOptions;
      readonly settle?: (workspace: ReturnType<typeof mountHook>) => Promise<void>;
    }[] = [
      {
        name: "no usable backend",
        options: { initialDatasets: [vendorRow], availability: unavailableBackend },
      },
      {
        name: "a quarantined session",
        options: {
          initialDatasets: [vendorRow],
          availability: availableBackend,
          initialBackendQuarantined: true,
        },
      },
      {
        name: "an unsettled workspace mutation",
        options: {
          initialDatasets: [vendorRow],
          availability: availableBackend,
          pickedFiles: () => deferred<null>().promise,
        },
        settle: async (workspace) => {
          act(() => {
            workspace.result.current.addFiles();
          });
          await waitFor(() => {
            expect(workspace.result.current.pickerBusy).toBe(true);
          });
        },
      },
    ];

    for (const scenario of cases) {
      const api = createFakePreviewApi(scenario.options);
      const workspace = mountHook(api, createFakeWorkspaceDropTransport());
      await waitFor(() => {
        expect(workspace.result.current.rosterLoad.status).toBe("ready");
      });
      await scenario.settle?.(workspace);

      // The operation refuses, from the facts as they stand rather than from
      // the render the closure was made in.
      await act(async () => {
        workspace.result.current.conversion.convert([vendorRow.handle]);
        await Promise.resolve();
      });
      expect(api.conversionRequests, scenario.name).toEqual([]);
      // And it refuses a rerun for the same fact, which is what makes the lane
      // one lane rather than two that resemble each other.
      expect(
        workspace.result.current.conversion.retryAvailability.status,
        scenario.name,
      ).toBe("unavailable");
      workspace.unmount();
    }
  });

  it("explains a refused conversion once, and points the control at that sentence", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: unavailableBackend,
    });
    renderApp(api);

    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeDisabled();
    });
    expect(reasonsOnScreen()).toEqual([BACKEND_REASON]);
    // Once in the document. Not a visible sentence plus a hidden copy, and not
    // one sentence per control.
    expect((document.body.textContent ?? "").split(BACKEND_REASON)).toHaveLength(2);
    expect(convert).toHaveAccessibleDescription(new RegExp(BACKEND_REASON, "u"));
  });

  it("gives two refused controls one sentence when one fact refuses both", async () => {
    // Both controls are on screen -- a finished queue with a failure worth
    // rerunning, beside a plan for the row that produced it -- and one lane
    // fact refuses each. A reader meeting the second control is not told the
    // same thing twice by a screen reader that has no way to know it is the
    // same thing.
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow],
      availability: unavailableBackend,
      initialConversion: retryableQueue(1),
    });
    renderApp(api);

    const panel = await conversionPanel();
    const retry = await within(panel).findByRole("button", { name: "Retry 1 failed" });
    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeDisabled();
    });
    expect(retry).toBeDisabled();
    expect(reasonsOnScreen()).toEqual([BACKEND_REASON]);
    expect(convert).toHaveAccessibleDescription(new RegExp(BACKEND_REASON, "u"));
    expect(retry).toHaveAccessibleDescription(new RegExp(BACKEND_REASON, "u"));
  });

  it("leaves everything backend-free alone while the lane says no", async () => {
    // A conversion lane that refuses is not a reason to freeze the workspace.
    // Searching, sorting and reading the list ask the backend for nothing, and
    // each is governed by its own authority.
    const api = createFakePreviewApi({
      initialDatasets: [vendorRow, acquisition(2)],
      availability: unavailableBackend,
    });
    renderApp(api);

    const convert = await convertControl();
    await waitFor(() => {
      expect(convert).toBeDisabled();
    });

    const search = screen.getByRole("searchbox", { name: "Search files" });
    expect(search).toBeEnabled();
    fireEvent.change(search, { target: { value: "run-2" } });
    await waitFor(() => {
      expect(
        within(screen.getByRole("listbox", { name: "Workspace" })).queryAllByRole("option"),
      ).toHaveLength(1);
    });
    expect(screen.getByRole("combobox", { name: "Sort files" })).toBeEnabled();
  });
});
