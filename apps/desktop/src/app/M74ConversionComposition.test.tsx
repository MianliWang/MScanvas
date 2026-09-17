import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import type { WorkspaceClearOutcome, WorkspaceConversionState } from "../features/mzml-preview/contracts";
import { UI_RESOURCES } from "../features/preferences/i18n";
import {
  availableBackend, createFakePreviewApi, createFakeWorkspaceDropTransport,
  deferred, queueItem, queueOf, type FakePreviewApi,
} from "../test/previewFixtures";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];
const source = { handle: "source-m74", fileName: "长名称 acquisition 空格.raw", sourceKind: "thermo_raw" as const, byteLength: 12_345, relativeContext: null };

function mount(api: FakePreviewApi) {
  render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreviewApiProvider value={api}><App /></PreviewApiProvider>
  </WorkspaceDropTransportProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Conversion & results" }));
}

async function chinese() {
  fireEvent.click(screen.getByRole("button", { name: en.settings }));
  const settings = screen.getByRole("dialog", { name: en.settings });
  fireEvent.click(within(settings).getByRole("radio", { name: en.simplifiedChinese }));
  fireEvent.click(within(settings).getByRole("button", { name: zh.apply }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.documentElement.lang).toBe("zh-CN");
}

describe("M7.4 bilingual conversion composition", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(["before", "after"])("returns empty active Clear to Add files when conversion unlocks %s modal close", async timing => {
    // Drive the registered state poll explicitly; no timeout or production
    // polling interval changes, and no direct mutation of React state.
    const timers = vi.spyOn(globalThis, "setInterval");
    const result = deferred<WorkspaceClearOutcome>();
    const execute = vi.fn(() => result.promise);
    const queue = queueOf([queueItem(source.handle, source.fileName, { state: "running", attempts: 1 })]);
    const api = createFakePreviewApi({ availability: availableBackend, initialDatasets: [source],
      initialConversion: { status: "running", operationId: "active-clear", queue },
      planWorkspaceClear: async () => ({ Ok: { planId: "clear-final", totalCount: 1, protectedCount: 1, removableCount: 0, active: true } }),
      executeWorkspaceClear: execute,
    });
    mount(api);
    await waitFor(() => expect(document.querySelector(".conversion-running")).toBeInTheDocument());
    const clear = await screen.findByRole("button", { name: en.clearList });
    await waitFor(() => expect(clear).toBeEnabled());
    clear.focus(); fireEvent.click(clear);
    const cancel = await screen.findByRole("button", { name: en.clearCancelAll });
    await waitFor(() => expect(cancel).toBeEnabled());
    cancel.focus(); fireEvent.click(cancel);
    const add = screen.getByRole("button", { name: en.addFiles, hidden: true });
    const unlock = () => {
      api.publishConversion({ status: "terminal", reason: "stopped", operationId: "active-clear", queue });
      const poll = timers.mock.calls.find(([, delay]) => delay === 2_000)?.[0];
      if (typeof poll !== "function") throw Error("Conversion poll was not registered");
      poll();
    };
    if (timing === "before") await act(async () => unlock());
    await act(async () => result.resolve({ status: "removed", result: { roster: { capacity: 1024, datasets: [] }, removedHandles: [source.handle], unknownHandles: [] } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(clear).not.toBeInTheDocument();
    if (timing === "after") {
      expect(add).toBeDisabled();
      await act(async () => unlock());
    }
    await waitFor(() => expect(add).toBeEnabled());
    expect(add).toHaveFocus();
    expect(execute).toHaveBeenCalledExactlyOnceWith("clear-final", "cancelAndClear");
    expect(api.beginRequests()).toEqual([]);
  });

  it("returns a nonempty active Clear to its original Clear control", async () => {
    const outsider = { ...source, handle: "non-running" };
    const execute = vi.fn(async (): Promise<WorkspaceClearOutcome> => ({ status: "removed", result: {
      roster: { capacity: 1024, datasets: [source] }, removedHandles: [outsider.handle], unknownHandles: [],
    } }));
    const api = createFakePreviewApi({ availability: availableBackend, initialDatasets: [source, outsider],
      initialConversion: { status: "running", operationId: "active-clear", queue: queueOf([queueItem(source.handle, source.fileName, { state: "running", attempts: 1 })]) },
      planWorkspaceClear: async () => ({ Ok: { planId: "clear-outsider", totalCount: 2, protectedCount: 1, removableCount: 1, active: true } }),
      executeWorkspaceClear: execute,
    });
    mount(api);
    await waitFor(() => expect(document.querySelector(".conversion-running")).toBeInTheDocument());
    const clear = screen.getByRole("button", { name: en.clearList });
    clear.focus(); fireEvent.click(clear);
    const remove = await screen.findByRole("button", { name: en.clearRemoveNonRunning });
    await waitFor(() => expect(remove).toBeEnabled());
    remove.focus(); fireEvent.click(remove);
    await waitFor(() => expect(clear).toHaveFocus());
    expect(screen.getByRole("button", { name: en.addFiles })).toBeDisabled();
    expect(execute).toHaveBeenCalledExactlyOnceWith("clear-outsider", "removeNonRunning");
  });

  it.each(["retained", "removed", "blurred", "returned"])("cancels a delayed active Clear focus return after the %s destination change", async destination => {
    const timers = vi.spyOn(globalThis, "setInterval");
    const result = deferred<WorkspaceClearOutcome>();
    const queue = queueOf([queueItem(source.handle, source.fileName, { state: "running", attempts: 1 })]);
    const api = createFakePreviewApi({ availability: availableBackend, initialDatasets: [source],
      initialConversion: { status: "running", operationId: "active-clear", queue },
      planWorkspaceClear: async () => ({ Ok: { planId: "clear-final", totalCount: 1, protectedCount: 1, removableCount: 0, active: true } }),
      executeWorkspaceClear: () => result.promise,
    });
    mount(api);
    await waitFor(() => expect(document.querySelector(".conversion-running")).toBeInTheDocument());
    const clear = screen.getByRole("button", { name: en.clearList });
    clear.focus(); fireEvent.click(clear);
    const cancel = await screen.findByRole("button", { name: en.clearCancelAll });
    await waitFor(() => expect(cancel).toBeEnabled());
    cancel.focus(); fireEvent.click(cancel);
    await act(async () => result.resolve({ status: "removed", result: { roster: { capacity: 1024, datasets: [] }, removedHandles: [source.handle], unknownHandles: [] } }));
    // Radix schedules its close autofocus in the next task after unmount.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const chosen = document.createElement("button");
    chosen.textContent = "Newer keyboard destination";
    if (destination === "retained" || destination === "removed") {
      document.body.append(chosen); chosen.focus();
      if (destination === "removed") chosen.remove();
    } else {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      fireEvent(window, new Event("blur"));
      if (destination === "returned") {
        vi.mocked(document.hasFocus).mockReturnValue(true);
        fireEvent(window, new Event("focus"));
      }
    }
    await act(async () => {
      api.publishConversion({ status: "terminal", reason: "stopped", operationId: "active-clear", queue });
      const poll = timers.mock.calls.find(([, delay]) => delay === 2_000)?.[0];
      if (typeof poll !== "function") throw Error("Conversion poll was not registered");
      poll();
    });
    const add = screen.getByRole("button", { name: en.addFiles });
    expect(add).toBeEnabled(); expect(add).not.toHaveFocus();
    expect(document.activeElement).toBe(destination === "retained" ? chosen : document.body);
    chosen.remove();
  });

  it("localizes a claimed output name while preserving the earlier acquisition name", async () => {
    const ownerName = "Earlier acquisition 原始名称.wiff";
    const terminal: WorkspaceConversionState = { status: "terminal", reason: "completed", operationId: "claimed-name", queue: queueOf([queueItem(source.handle, source.fileName, {
      state: "failed", attempts: 1, error: { kind: "queue_output_name_claimed", summary: "Owned original English summary", detail: ownerName, retryable: false },
    })]) };
    const api = createFakePreviewApi({ availability: availableBackend, initialDatasets: [source], initialConversion: terminal });
    mount(api); await screen.findByText(en.m74ErrorNameClaimed); await chinese();
    expect(screen.getByText(zh.m74ErrorNameClaimed)).toBeVisible();
    fireEvent.click(document.querySelector(".conversion-item-detail summary")!);
    expect(screen.getByText(ownerName)).toBeVisible();
    expect(screen.queryByText("Owned original English summary")).toBeNull(); expect(api.beginRequests()).toEqual([]);
  });

  it("retains the exact plan and raw destination draft through basic, advanced and locale changes", async () => {
    const api = createFakePreviewApi({ availability: availableBackend, initialDatasets: [source] });
    mount(api);
    const row = await screen.findByRole("row", { name: /长名称 acquisition 空格/ });
    fireEvent.click(within(row).getByRole("checkbox"));
    const panel = screen.getByRole("region", { name: en.m74CnvTitle });
    const start = within(panel).getByRole("button", { name: "Convert 1 selected…" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(within(panel).getByRole("radio", { name: en.m74CnvDestNamed }));
    const raw = "  原始 name / draft  ";
    fireEvent.change(within(panel).getByRole("textbox", { name: en.m74CnvSubfolderName }), { target: { value: raw } });
    await waitFor(() => expect(api.planRequests().at(-1)?.destinationPolicy).toEqual({ kind: "namedSubfolder", name: raw }));
    const reviewed = structuredClone(api.planRequests().at(-1));
    const planCount = api.planRequests().length;
    fireEvent.click(within(panel).getByRole("button", { name: en.cnvAdvanced }));
    fireEvent.click(within(panel).getByRole("button", { name: en.cnvBasic }));
    await chinese();
    expect(panel).toHaveAccessibleName(zh.m74CnvTitle);
    expect(within(panel).getByRole("textbox", { name: zh.m74CnvSubfolderName })).toHaveValue(raw);
    expect(within(panel).getByRole("radio", { name: zh.m74CnvDestNamed })).toBeChecked();
    expect(api.planRequests().at(-1)).toEqual(reviewed);
    expect(api.planRequests()).toHaveLength(planCount);
    expect(api.beginRequests()).toEqual([]);
    expect(api.openedHandles).toEqual([]);
  });

  it("localizes terminal facts and retry while preserving the bound queue and provider evidence", async () => {
    const raw = "PROVIDER_EVIDENCE α <unchanged>";
    const terminal: WorkspaceConversionState = {
      status: "terminal", reason: "completed", operationId: "bound-queue-m74",
      queue: { ...queueOf([queueItem(source.handle, source.fileName, {
        state: "failed", attempts: 1, retryable: true,
        error: { kind: "provider-specific-evidence", summary: raw, detail: null, retryable: true },
      })]), conflictPolicy: "skip", destinationPolicy: { kind: "namedSubfolder", name: "original-output" } },
    };
    const retry = vi.fn(async () => terminal);
    const api = createFakePreviewApi({ availability: availableBackend, initialDatasets: [source], initialConversion: terminal, retry });
    mount(api);
    const button = await screen.findByRole("button", { name: "Retry 1 failed" });
    await waitFor(() => expect(button).toBeEnabled());
    const snapshot = structuredClone(terminal);
    await chinese();
    const panel = screen.getByRole("region", { name: zh.m74CnvTitle });
    expect(panel).toHaveTextContent("共 1 项：已转换 0 项、重名跳过 0 项、失败 1 项。");
    expect(panel).toHaveTextContent(raw);
    expect(document.querySelector('[data-live-region="conversion"]')).toHaveTextContent("失败 1 项");
    const bound = panel.querySelector(".conversion-bound-details")!;
    fireEvent.click(within(bound as HTMLElement).getByText(zh.m74CnvBoundDetails));
    expect(bound).toHaveTextContent("original-output");
    expect(bound).toHaveTextContent(zh.m74CnvConflictSkip);
    expect(terminal).toEqual(snapshot);
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "重试 1 个失败项" }));
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(api.beginRequests()).toEqual([]);
    expect(terminal).toEqual(snapshot);
  });
});
