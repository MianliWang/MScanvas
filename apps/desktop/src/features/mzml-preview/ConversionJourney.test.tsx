/**
 * PM9.4's conversion journey at component level: the findings of
 * `docs/phases/pm9/slice-04.md` §3 that a jsdom render can hold. Focus here is
 * jsdom's, which keeps focus on a natively disabled control; the Chromium
 * behaviour R11 is about is held by the browser spec
 * (`e2e/specs/pm9.4-conversion.browser.e2e.ts`).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import { showBackendBanner } from "../../test/backendBanner";
import {
  availableBackend,
  createFakePreviewApi,
  deferred,
  createFakeWorkspaceDropTransport,
  finalizedAttemptFacts,
  queueItem,
  queueOf,
  selectedFile,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { BackendAvailability, SelectedFile, WorkspaceConversionState } from "./contracts";

function acquisition(index: number): SelectedFile {
  return { handle: `file-${String(index)}`, fileName: `run-${String(index)}.raw`, byteLength: 78_309, sourceKind: "thermo_raw", relativeContext: null };
}

const first = acquisition(1);
const second = acquisition(2);
const third = acquisition(3);

function renderApp(api: FakePreviewApi) {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversion & results" }));
}

async function check(name: RegExp) {
  fireEvent.click(within(await screen.findByRole("row", { name })).getByRole("checkbox"));
}

/** Whether `later` follows `earlier` in the document. */
function follows(earlier: Element, later: Element): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("PM9.4: what will be converted, and the action that converts it", () => {
  it("names the checked rows, counts what it would convert, and refuses Convert as a Tab stop that sends nothing (R1, R6)", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile, first], availability: availableBackend });
    renderApp(api);
    // One checked mzML row: a member, and nothing it could convert.
    await check(new RegExp(selectedFile.fileName.replace(".", "\\.")));
    const panel = await screen.findByRole("region", { name: "Convert" });

    expect(within(panel).getByRole("radio", { name: "Checked rows" })).toBeChecked();
    const convert = await within(panel).findByRole("button", { name: "Convert 0 eligible…" });
    expect(convert).toHaveAttribute("aria-disabled", "true");
    expect(convert).not.toBeDisabled();
    expect(convert).toHaveAccessibleDescription(/No supported vendor acquisitions in this scope/);
    // A refused press reaches nothing.
    convert.focus();
    expect(document.activeElement).toBe(convert);
    fireEvent.click(convert);
    expect(api.conversionRequests).toEqual([]);
    expect(api.beginRequests()).toEqual([]);
  });

  it("sends nothing when a reviewed Convert is refused by the lane (R6, review F5)", async () => {
    // A plan on screen, then a backend check that holds the lane. The press
    // meets the panel's own refusal; the operation's lane guard behind it is
    // the second line, not the one under test.
    const held = deferred<BackendAvailability>();
    let answered = 0;
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: () => (answered++ === 0 ? Promise.resolve(availableBackend) : held.promise),
    });
    renderApp(api);
    await check(/run-1\.raw/);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(panel.querySelector("#conversion-plan-summary")).not.toBeNull();
    });
    await showBackendBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    const convert = within(panel).getByRole("button", { name: "Convert 1 eligible…" });
    await waitFor(() => {
      expect(convert).toHaveAttribute("aria-disabled", "true");
    });
    expect(panel.querySelector("#conversion-plan-summary")).not.toBeNull();
    fireEvent.click(convert);
    expect(api.beginRequests()).toEqual([]);
    held.resolve(availableBackend);
  });

  it("puts the settings, destination, conflict and scope before the review, and the review directly above Convert (R4, R5)", async () => {
    const api = createFakePreviewApi({ initialDatasets: [first], availability: availableBackend });
    renderApp(api);
    await check(/run-1\.raw/);
    const panel = await screen.findByRole("region", { name: "Convert" });
    const summary = await waitFor(() => {
      const node = panel.querySelector("#conversion-plan-summary");
      expect(node).not.toBeNull();
      return node!;
    });
    // The form column, then the summary column: settings, destination and
    // conflict, then which rows, then the review and Convert.
    const plan = panel;
    const parts = [".conversion-settings", ".conversion-destination", ".conversion-conflict", ".conversion-scope"].map((css) => plan.querySelector(css));
    const convert = within(panel).getByRole("button", { name: "Convert 1 eligible…" });
    for (const [index, node] of parts.entries()) {
      expect(node, `part ${String(index)}`).not.toBeNull();
      if (index > 0) expect(follows(parts[index - 1]!, node!)).toBe(true);
    }
    expect(follows(parts[3]!, summary)).toBe(true);
    expect(follows(summary, convert)).toBe(true);
    // Nothing the summary depends on sits between it and the action.
    expect([...plan.querySelectorAll("fieldset")].filter((fieldset) => follows(summary, fieldset))).toEqual([]);
    // Compression in words, like the other axes.
    const term = [...plan.querySelectorAll(".metadata-list dt")].find((node) => node.textContent === "Compression");
    expect(term?.nextElementSibling?.textContent).toBe("zlib compressed");
  });
});

describe("PM9.4: a queue on screen, and the conversion after it", () => {
  it("withdraws the next conversion's settings while a queue runs (R5)", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "running",
        operationId: "1",
        queue: queueOf([queueItem("file-1", "run-1.raw", { state: "running", attempts: 1 }), queueItem("file-2", "run-2.raw")]),
      },
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await within(panel).findByText("Converting item 1 of 2…");
    // The bar counts what has settled, not the item still running (review 13).
    expect(panel.querySelector<HTMLElement>(".conversion-progress-bar > span")?.style.width).toBe("0%");
    expect(panel.querySelector(".conversion-progress-bar")).toHaveAttribute("aria-hidden", "true");
    expect(panel.querySelector(".conversion-settings")).toBeNull();
    expect(panel.querySelector(".conversion-plan")).toBeNull();
  });

  it("names a rerun of the earlier failures while it runs (R10)", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "running",
        operationId: "1",
        queue: {
          ...queueOf([
            queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1, ...finalizedAttemptFacts() }),
            queueItem("file-2", "run-2.raw", { state: "running", attempts: 2 }),
          ]),
          retryRound: 1,
        },
      },
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(await within(panel).findByText("Rerunning earlier failures: converting item 2 of 2…")).toHaveAttribute("id", "conversion-queue-status");
    expect(panel.querySelector<HTMLElement>(".conversion-progress-bar > span")?.style.width).toBe("50%");
  });

  it("opens the next conversion under a finished queue on request, says which failures Retry reruns, and keeps one filled primary (R5, R7, R8)", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second, third],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1, ...finalizedAttemptFacts() }),
          queueItem("file-2", "run-2.raw", { state: "failed", attempts: 1, retryable: true }),
          queueItem("file-3", "run-3.raw", { state: "failed", attempts: 1, retryable: false }),
        ]),
      },
    });
    renderApp(api);
    await check(/run-3\.raw/);
    const panel = await screen.findByRole("region", { name: "Convert" });
    const primaries = () => panel.querySelectorAll(".ui-button--primary");

    // The results first: the next conversion's form, its scope warning and
    // its Convert stay away until the reader asks for them (review 6).
    const another = await within(panel).findByRole("button", { name: "Start another conversion" });
    expect(within(panel).queryByRole("heading", { name: "Next conversion" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /^Convert/ })).toBeNull();
    expect(panel.querySelector(".conversion-settings")).toBeNull();
    expect(another).toHaveClass("ui-button--secondary");
    expect(within(panel).getByRole("button", { name: "Add converted output to workspace" })).toHaveClass("ui-button--primary");
    expect(primaries()).toHaveLength(1);
    const failed = [...panel.querySelectorAll('li[data-item-state="failed"]')];
    expect(failed.map((row) => row.querySelector(".conversion-queue-retry")?.textContent)).toEqual([
      "Retryable",
      "Not retryable: the same settings would fail again.",
    ]);
    const scope = panel.querySelector("#conversion-retry-scope");
    expect(scope).not.toBeNull();
    expect(scope!.closest(".visually-hidden")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Retry 1 failed" })).toHaveAccessibleDescription(/original folder, conflict setting and order/);

    // Asked for, the next conversion takes the keyboard and the one primary;
    // adding the outputs stays offered beside it, as a secondary.
    another.focus();
    fireEvent.click(another);
    expect(await within(panel).findByRole("heading", { name: "Next conversion" })).toBeVisible();
    expect(document.activeElement).toBe(panel.querySelector(".conversion-plan"));
    expect(within(panel).queryByRole("button", { name: "Start another conversion" })).toBeNull();
    const convert = await within(panel).findByRole("button", { name: "Convert 1 eligible…" });
    expect(convert).toHaveClass("ui-button--primary");
    expect(within(panel).getByRole("button", { name: "Add converted output to workspace" })).toHaveClass("ui-button--secondary");
    expect(primaries()).toHaveLength(1);
  });

  it("makes Start another conversion the one primary when there is nothing to add (review 6)", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([queueItem("file-1", "run-1.raw", { state: "failed", attempts: 1, retryable: false })]),
      },
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(await within(panel).findByRole("button", { name: "Start another conversion" })).toHaveClass("ui-button--primary");
    expect(panel.querySelectorAll(".ui-button--primary")).toHaveLength(1);
    // No warning about an empty scope after a queue: nothing on screen starts one.
    expect(panel.querySelector(".conversion-availability")?.textContent).toBe("");
  });

  it("tells a stopped queue's reader how to convert what did not finish (R9)", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "stopped",
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1, ...finalizedAttemptFacts() }),
          queueItem("file-2", "run-2.raw", { state: "notRun" }),
        ]),
      },
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await within(panel).findByText("Queue stopped");
    expect(panel.querySelector(".conversion-convert-again")?.textContent).toBe(
      "To convert rows that were cancelled, not run or skipped by you, check only those rows and start another conversion.",
    );
    expect(within(panel).queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("returns focus to Convert when a picker opened under a finished queue is cancelled (R11, review F2)", async () => {
    // jsdom has no foreground window; this models the one a cancelled picker
    // returns to, as ConversionPanel.test's picker cases do.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const picker = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([queueItem("file-1", "run-1.raw", { state: "failed", attempts: 1, retryable: false })]),
      },
      conversion: () => picker.promise,
    });
    renderApp(api);
    await check(/run-2\.raw/);
    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Start another conversion" }));
    const convert = await within(panel).findByRole("button", { name: "Convert 1 eligible…" });
    await waitFor(() => {
      expect(convert).not.toHaveAttribute("aria-disabled");
    });
    convert.focus();
    fireEvent.click(convert);
    // While the picker is open the starting status does not take the focus.
    expect(document.activeElement?.id).not.toBe("conversion-queue-status");
    await act(async () => picker.resolve({ status: "idle" }));
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Convert 1 eligible…" })).toHaveFocus();
    });
    vi.restoreAllMocks();
  });

  it("moves focus to the queue's status line when Convert leaves with the plan (R11)", async () => {
    const api = createFakePreviewApi({ initialDatasets: [first], availability: availableBackend });
    renderApp(api);
    await check(/run-1\.raw/);
    const panel = await screen.findByRole("region", { name: "Convert" });
    const convert = within(panel).getByRole("button", { name: "Convert 1 eligible…" });
    await waitFor(() => {
      expect(convert).not.toHaveAttribute("aria-disabled");
    });
    convert.focus();
    fireEvent.click(convert);
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("conversion-queue-status");
    });
    expect(convert.isConnected).toBe(false);
  });
});
