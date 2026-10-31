/**
 * Every conversion list stays usable at the queue's full size (ADR 0057: up to
 * 1,024 items). Past the window threshold a list mounts only the rows near its
 * viewport, keeps its full length for assistive technology, and is its own
 * scroll box; a short list renders whole and is not.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  completeCatalog,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  finalizedAttemptFacts,
  queueItem,
  queueOf,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { ConversionPlanOutcome, SelectedFile, WorkspaceConversionState } from "./contracts";
import { LIST_WINDOW_THRESHOLD } from "./conversionListWindow";

const FULL = 1_024;

function acquisition(index: number): SelectedFile {
  return { handle: `file-${String(index)}`, fileName: `run-${String(index)}.raw`, byteLength: 78_309, sourceKind: "thermo_raw", relativeContext: null };
}

const ROWS = Array.from({ length: FULL }, (_, index) => acquisition(index + 1));

function renderApp(api: FakePreviewApi) {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversion" }));
}

/** A plan for every requested row, as Rust's describe would answer it at full size. */
function planEvery(request: Parameters<NonNullable<Parameters<typeof createFakePreviewApi>[0]>["conversionPlan"] & object>[0]): Promise<ConversionPlanOutcome> {
  const admitted = completeCatalog.find((row) => row.intent.id === request.intentId)!;
  return Promise.resolve({
    outcome: "planned",
    plan: {
      items: request.handles.map((handle) => {
        const row = ROWS.find((each) => each.handle === handle)!;
        return { datasetHandle: handle, fileName: row.fileName, sourceKind: row.sourceKind, output: { kind: "knownSingle", fileName: row.fileName.replace(/\.raw$/u, ".mzML") } };
      }),
      outputFormat: "mzML",
      compression: admitted.intent.compression === "zlib" ? "zlib" : "none",
      validationMode: "output_only",
      capacity: FULL,
      intent: admitted.intent,
      conflictPolicy: request.conflictPolicy,
      receipt: request.expectedReceipt,
      destinationPolicy: request.destinationPolicy,
    },
  } as ConversionPlanOutcome);
}

/** That a list is windowed: some rows mounted, far fewer than it holds, and its length still said. */
function expectWindowed(list: Element | null) {
  expect(list).not.toBeNull();
  const items = list!.querySelectorAll(":scope > li");
  expect(items.length).toBeGreaterThan(0);
  expect(items.length).toBeLessThan(100);
  expect(list).toHaveAttribute("data-windowed", "true");
  expect(items[0]).toHaveAttribute("aria-setsize", String(FULL));
  expect(items[0]).toHaveAttribute("aria-posinset", "1");
  // The unmounted rest is one hidden spacer row, never the list's own bottom
  // padding: padding taller than the list's cap is the box's height, and the
  // list stopped being a scroll box (rendered QA: 31,843 px under 548 px).
  expect((list as HTMLElement).style.paddingBottom).toBe("");
  expect(list!.querySelector(":scope > li.list-window-spacer:last-child")).toHaveAttribute("aria-hidden", "true");
}

describe("conversion lists at the queue's full size", () => {
  it("windows the requested order while the plan for 1,024 rows is worked out, and the reviewed plan once it arrives", async () => {
    const answer = deferred<ConversionPlanOutcome>();
    let first = true;
    const api = createFakePreviewApi({
      initialDatasets: ROWS,
      availability: availableBackend,
      conversionPlan: (request) => {
        if (first) { first = false; return answer.promise; }
        return planEvery(request);
      },
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(within(panel).getByRole("radio", { name: "All workspace rows" }));

    await waitFor(() => { expectWindowed(panel.querySelector(".conversion-requested-list")); }, { timeout: 15_000 });
    answer.resolve(await planEvery(api.planRequests().at(-1)!));
    await waitFor(() => { expectWindowed(panel.querySelector(".conversion-plan-list")); }, { timeout: 15_000 });
    // Counts are formatted as every count is (1,024).
    expect(within(panel).getByRole("button", { name: `Convert all ${FULL.toLocaleString("en-US")} eligible…` })).not.toHaveAttribute("aria-disabled");
  }, 60_000);

  it("windows a running queue of 1,024 items", async () => {
    const running: WorkspaceConversionState = {
      status: "running",
      operationId: "1",
      queue: queueOf(ROWS.map((row, index) => queueItem(row.handle, row.fileName, index === 0 ? { state: "running", attempts: 1 } : {}))),
    };
    renderApp(createFakePreviewApi({ initialDatasets: ROWS, availability: availableBackend, initialConversion: running }));
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => { expectWindowed(panel.querySelector(".conversion-run-list")); }, { timeout: 15_000 });
    expect(panel.querySelector('.conversion-run-list > li[data-item-state="running"]')).not.toBeNull();
  }, 60_000);

  it("windows the results of a finished queue of 1,024 items", async () => {
    const finished: WorkspaceConversionState = {
      status: "terminal",
      reason: "completed",
      operationId: "1",
      queue: queueOf(ROWS.map((row, index) => queueItem(row.handle, row.fileName, index % 2 === 0
        ? { state: "finalized", attempts: 1, finalizedOutputs: [{ outputId: `out-${String(index)}`, fileName: row.fileName.replace(/\.raw$/u, ".mzML") }], ...finalizedAttemptFacts() }
        : { state: "failed", attempts: 1 }))),
    };
    renderApp(createFakePreviewApi({ initialDatasets: ROWS, availability: availableBackend, initialConversion: finished }));
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => { expectWindowed(panel.querySelector(".conversion-run-list")); }, { timeout: 15_000 });
  }, 60_000);

  it("renders a short list whole, without a scroll box of its own", async () => {
    const rows = ROWS.slice(0, LIST_WINDOW_THRESHOLD);
    const running: WorkspaceConversionState = {
      status: "running",
      operationId: "1",
      queue: queueOf(rows.map((row, index) => queueItem(row.handle, row.fileName, index === 0 ? { state: "running", attempts: 1 } : {}))),
    };
    renderApp(createFakePreviewApi({ initialDatasets: rows, availability: availableBackend, initialConversion: running }));
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => { expect(panel.querySelectorAll(".conversion-run-list > li")).toHaveLength(LIST_WINDOW_THRESHOLD); });
    expect(panel.querySelector(".conversion-run-list")).toHaveAttribute("data-windowed", "false");
  });
});
