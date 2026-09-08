import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { availableBackend, createFakePreviewApi, createFakeWorkspaceDropTransport, deferred, queueItem, queueOf, shippedIntent } from "../../test/previewFixtures";
import { PreviewApiProvider } from "./api";
import type { ConversionPlanOutcome, ConversionPlanRequest, SelectedFile, WorkspaceConversionState } from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { usePreviewWorkspace } from "./usePreviewWorkspace";

const vendor = (n: number): SelectedFile => ({ handle: `raw-${n}`, fileName: `sample-${n}.raw`, sourceKind: "thermo_raw", byteLength: n, relativeContext: null });
const open: SelectedFile = { ...vendor(0), handle: "open", fileName: "open.mzML", sourceKind: "mzml" };

function plan(request: ConversionPlanRequest, capacity = 16): ConversionPlanOutcome {
  if (request.handles.length > capacity) return { outcome: "capacityExceeded", capacity, requestedCount: request.handles.length };
  return { outcome: "planned", plan: {
    items: request.handles.map((handle) => ({ datasetHandle: handle, fileName: `${handle}.raw`, sourceKind: "thermo_raw", output: { kind: "knownSingle", fileName: `${handle}.mzML` } })),
    outputFormat: "mzML", compression: "zlib", validationMode: "output_only", capacity,
    intent: shippedIntent, receipt: request.expectedReceipt, destinationPolicy: request.destinationPolicy, conflictPolicy: request.conflictPolicy,
  } };
}

function wrapper(api: ReturnType<typeof createFakePreviewApi>) {
  return ({ children }: { children: ReactNode }) => createElement(WorkspaceDropTransportProvider,
    { value: createFakeWorkspaceDropTransport() }, createElement(PreviewApiProvider, { value: api }, children));
}
async function mount(count = 3, conversionPlan = async (request: ConversionPlanRequest) => plan(request)) {
  const api = createFakePreviewApi({ initialDatasets: [...Array.from({ length: count }, (_, index) => vendor(index + 1)), open], availability: availableBackend, conversionPlan });
  render(<App />, { wrapper: wrapper(api) });
  await waitFor(() => expect(document.querySelector('[data-handle="open"]')).not.toBeNull());
  return api;
}
function select(handle: string, ctrlKey = false) {
  const row = document.querySelector(`[data-handle="${handle}"]`);
  expect(row).not.toBeNull();
  fireEvent.click(row!, { ctrlKey });
}
function scopeAll() { fireEvent.click(screen.getByRole("radio", { name: "All workspace rows" })); }
function button() { return document.querySelector<HTMLButtonElement>(".conversion-plan .primary-button")!; }
async function ready() { await waitFor(() => expect(button()).toBeEnabled()); }

describe("M6.7 through the production conversion surface", () => {
  it("has no focused fallback, excludes mixed selected rows, and all ignores search", async () => {
    const api = await mount();
    expect(button()).toHaveTextContent("Convert 0 selected");
    expect(button()).toBeDisabled();
    expect(api.planRequests()).toHaveLength(0);
    select("raw-2"); select("open", true);
    await ready();
    expect(screen.getByText(/2 requested · 1 eligible · 1 excluded/)).toBeVisible();
    expect(api.planRequests().at(-1)?.handles).toEqual(["raw-2"]);
    const beforeSearch = api.planRequests().length;
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no matches" } });
    expect(button()).toBeEnabled();
    expect(api.planRequests()).toHaveLength(beforeSearch);
    scopeAll(); await ready();
    expect(screen.getByText(/4 requested · 3 eligible · 1 excluded/)).toBeVisible();
    expect(api.planRequests().at(-1)?.handles).toEqual(["raw-1", "raw-2", "raw-3"]);
    expect(within(screen.getByRole("list", { name: "Reviewed conversion order" })).getAllByRole("listitem")).toHaveLength(3);
    expect(button()).toHaveTextContent("Convert all 3 eligible");
  });

  for (const count of [1, 5, 6]) it(`reads a Rust-authored capacity of 5 for ${count} eligible plus an excluded row`, async () => {
    const api = await mount(count, async (request) => plan(request, 5));
    scopeAll();
    await waitFor(() => expect(screen.getByTestId("conversion-capacity")).toHaveTextContent("5"));
    if (count <= 5) { await ready(); expect(button()).toBeEnabled(); }
    else {
      expect(button()).toBeDisabled();
      expect(screen.getByTestId("conversion-capacity")).toHaveTextContent("6 eligible acquisitions exceed the queue capacity of 5");
      fireEvent.click(button());
      expect(api.beginRequests()).toEqual([]);
      expect(api.conversionRequests).toEqual([]);
      select("raw-1");
      fireEvent.click(screen.getByRole("radio", { name: "Selected rows" }));
      await ready();
      expect(button()).toHaveTextContent("Convert 1 selected");
    }
  });

  it("rejects a late selected reply after all is requested, even when members are equal", async () => {
    const old = deferred<ConversionPlanOutcome>();
    let first: ConversionPlanRequest | null = null;
    const api = await mount(1, async (request) => {
      if (first === null) { first = request; return old.promise; }
      return plan(request);
    });
    select("raw-1");
    await waitFor(() => expect(api.planRequests()).toHaveLength(1));
    scopeAll(); await ready();
    expect(api.planRequests()).toHaveLength(2);
    await act(async () => old.resolve({ outcome: "capacityExceeded", capacity: 0, requestedCount: 999 }));
    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent("Convert all 1 eligible");
  });

  it("withdraws membership/order/scope reviews synchronously while preserving search-only reviews", async () => {
    const api = createFakePreviewApi({ initialDatasets: [vendor(1), vendor(2)], availability: availableBackend });
    const hook = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => expect(hook.result.current.conversionConfiguration.configuration).not.toBeNull());
    act(() => {
      hook.result.current.dispatchRoster({ type: "allSelected" });
      hook.result.current.conversionPlan.describe(["raw-1", "raw-2"]);
    });
    await waitFor(() => expect(hook.result.current.conversionPlan.current).not.toBeNull());
    act(() => {
      hook.result.current.dispatchRoster({ type: "searchChanged", query: "hidden" });
      expect(hook.result.current.conversionPlan.readCurrent()).not.toBeNull();
      hook.result.current.dispatchRoster({ type: "sortChanged", sort: "size-desc" });
      expect(hook.result.current.conversionPlan.readCurrent()).toBeNull();
    });
    act(() => hook.result.current.conversionPlan.describe(["raw-2", "raw-1"]));
    await waitFor(() => expect(hook.result.current.conversionPlan.current).not.toBeNull());
    act(() => {
      const review = hook.result.current.conversionPlan.current!;
      hook.result.current.setConversionScope("all");
      hook.result.current.conversion.convert(review.identity);
    });
    expect(api.beginRequests()).toEqual([]);
  });

  it("starts at most one queue and leaves its membership/order untouched by later presentation", async () => {
    const drain = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({ initialDatasets: [vendor(1), vendor(2), open], availability: availableBackend,
      conversion: () => drain.promise });
    render(<App />, { wrapper: wrapper(api) });
    await waitFor(() => expect(document.querySelector('[data-handle="raw-1"]')).not.toBeNull());
    select("raw-2"); await ready();
    const start = button();
    fireEvent.click(start); fireEvent.click(start);
    await waitFor(() => expect(api.beginRequests()).toHaveLength(1));
    expect(api.beginRequests()[0]?.handles).toEqual(["raw-2"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing" } });
    fireEvent.change(screen.getByRole("combobox", { name: /sort/i }), { target: { value: "size-desc" } });
    const queue = queueOf([queueItem("raw-2", "sample-2.raw")]);
    await act(async () => drain.resolve({ status: "terminal", reason: "completed", operationId: "1", queue }));
    expect(screen.getByTestId("conversion-bound-membership")).toHaveTextContent("Later workspace rows are outside this queue and its retry");
    expect(api.beginRequests()).toHaveLength(1);
    expect(document.querySelectorAll(".conversion-running .conversion-queue-name")).toHaveLength(1);
  });

  it("retries the bound queue while the next all-scope review has different members/order", async () => {
    const bound = queueOf([2, 1].map((n) => queueItem(`raw-${n}`, `sample-${n}.raw`, {
      state: "failed", attempts: 1, retryable: true,
    })));
    const api = createFakePreviewApi({ initialDatasets: [vendor(1), vendor(2), vendor(3), open], availability: availableBackend,
      initialConversion: { status: "terminal", reason: "completed", operationId: "1", queue: bound } });
    const retryCall = vi.spyOn(api, "retryConversions");
    render(<App />, { wrapper: wrapper(api) });
    await waitFor(() => expect(document.querySelector('[data-handle="raw-3"]')).not.toBeNull());
    scopeAll(); await ready();
    expect(api.planRequests().at(-1)?.handles).toEqual(["raw-1", "raw-2", "raw-3"]);
    const names = () => [...document.querySelectorAll(".conversion-running .conversion-queue-name")].map((node) => node.textContent);
    expect(names()).toEqual(["sample-2.raw", "sample-1.raw"]);
    const retry = screen.getByRole("button", { name: "Retry 2 failed" });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    // Retry names the existing Rust slot; it carries no new scope or handles.
    await waitFor(() => expect(retryCall).toHaveBeenCalledExactlyOnceWith());
    await waitFor(() => expect(document.querySelector(".conversion-running")).not.toHaveTextContent("Retrying the failures"));
    expect(names()).toEqual(["sample-2.raw", "sample-1.raw"]);
    expect(api.beginRequests()).toEqual([]);
  });
});
