import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { PreviewApiProvider } from "../mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../mzml-preview/dropTransport";
import type { SelectedSpectrumOutcome } from "../mzml-preview/contracts";
import { availableBackend, unavailableBackend, buildSpectrum, createFakePreviewApi, createFakeWorkspaceDropTransport, deferred, type FakePreviewApi } from "../../test/previewFixtures";
import { createFakePreferencesApi, type FakePreferencesApi } from "../../test/preferenceFixtures";
import { PreferencesApiProvider } from "./preferencesApi";
import { createUiRuntime, UI_RESOURCES, validateBundle, type UiRuntime } from "./i18n";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

/**
 * The real composition over a working preference store.
 *
 * A store is installed rather than left to the context default, because what
 * these tests exercise is the applied path: a session that can save is the one
 * a user has, and the session that cannot is covered explicitly below.
 */
function mount(
  api: FakePreviewApi = createFakePreviewApi({ availability: unavailableBackend }),
  runtime: UiRuntime = createUiRuntime(),
  preferences: FakePreferencesApi = createFakePreferencesApi(),
) {
  return render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreferencesApiProvider value={preferences}>
      <PreviewApiProvider value={api}><App uiRuntime={runtime} /></PreviewApiProvider>
    </PreferencesApiProvider>
  </WorkspaceDropTransportProvider>);
}

function openSettings() {
  const entry = document.querySelector<HTMLButtonElement>("[data-settings-entry]")!;
  // Model the initiating pointer/keyboard focus, not the return being tested.
  entry.focus();
  fireEvent.click(entry);
  return screen.getByRole("dialog");
}

function choose(dialog: HTMLElement, name: string) { fireEvent.click(within(dialog).getByRole("radio", { name })); }
function press(dialog: HTMLElement, name: string) { fireEvent.click(within(dialog).getByRole("button", { name })); }
/**
 * Applies, and waits for the durable commit to be confirmed.
 *
 * Apply publishes before it closes, so the dialog is still modal until the
 * store answers -- and while it is, Radix hides the rest of the application
 * from the accessibility tree. Waiting for the close is waiting for the save,
 * which is exactly the guarantee the button now makes.
 */
async function applyAndClose(dialog: HTMLElement, name: string) {
  press(dialog, name);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}
const density = () => document.querySelector(".dataset-roster-panel")?.getAttribute("data-density");

async function loadedApp(api = createFakePreviewApi({ availability: availableBackend })) {
  mount(api);
  const add = await screen.findByRole("button", { name: "Add files…" });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  const grid = await screen.findByRole("grid", { name: "Scans" });
  fireEvent.click(grid.querySelector('[data-source-index="0"]')!);
  await screen.findByText(/Spectrum 0, MS1, 12 points\./);
  return api;
}

describe("session Settings in the real application composition", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("previews, applies, resets only a draft, cancels and reopens without requesting backend work", async () => {
    const api = createFakePreviewApi({ availability: unavailableBackend });
    mount(api);
    await screen.findByText("No ProteoWizard installation was found");
    await waitFor(() => expect(api.calls()).toContain("readConversionConfiguration"));
    const calls = [...api.calls()];
    expect(document.documentElement.lang).toBe("en");
    expect(density()).toBe("comfortable");
    let dialog = openSettings();
    expect(within(dialog).getByRole("radio", { name: en.english })).toHaveFocus();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    expect(dialog).toHaveAccessibleName(zh.settings);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(density()).toBe("compact");
    // The normal saved state says nothing; only a problem earns a footer note.
    expect(dialog.querySelector("[data-storage-note]")).toBeEmptyDOMElement();
    press(dialog, zh.apply);
    await waitFor(() => expect(screen.getByRole("button", { name: zh.settings })).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('[data-live-region="preferences"]')).toHaveTextContent(zh.applied);

    dialog = openSettings();
    expect(within(dialog).getByRole("radio", { name: zh.compact })).toBeChecked();
    press(dialog, zh.reset);
    expect(document.documentElement.lang).toBe("en");
    expect(density()).toBe("comfortable");
    press(dialog, en.cancel);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(density()).toBe("compact");
    dialog = openSettings();
    press(dialog, zh.reset);
    press(dialog, en.apply);
    expect(document.documentElement.lang).toBe("en");
    expect(density()).toBe("comfortable");
    expect(api.calls()).toEqual(calls);
  });

  it.each(["cancel", "close", "escape"] as const)("discards with %s and retains one modal and the opener", async (action) => {
    mount();
    await screen.findByText("No ProteoWizard installation was found");
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    fireEvent.pointerDown(document.querySelector(".settings-overlay")!);
    expect(screen.getByRole("dialog")).toBe(dialog);
    const backgroundEscape = vi.fn();
    window.addEventListener("keydown", backgroundEscape);
    if (action === "escape") fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    else press(dialog, zh[action]);
    window.removeEventListener("keydown", backgroundEscape);
    expect(backgroundEscape).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("en");
    expect(density()).toBe("comfortable");
    await waitFor(() => expect(screen.getByRole("button", { name: en.settings })).toHaveFocus());
    expect(within(openSettings()).getByRole("radio", { name: en.english })).toBeChecked();
  });

  it("keeps composition Enter and Escape inside the dialog until composition ends", async () => {
    mount();
    await screen.findByText("No ProteoWizard installation was found");
    const dialog = openSettings();
    const field = within(dialog).getByRole("radio", { name: en.english });
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not revive a close return after a newer deliberate destination blurs", async () => {
    mount();
    await screen.findByText("No ProteoWizard installation was found");
    const dialog = openSettings();
    const closed = new Promise<void>((resolve) => dialog.addEventListener("focusScope.autoFocusOnUnmount", () => resolve(), { once: true }));
    press(dialog, en.cancel);
    const later = screen.getByRole("button", { name: "Add files…" });
    later.focus();
    later.blur();
    // Observe Radix's queued close notification, not a sleep or a forced return.
    await act(async () => closed);
    expect(screen.getByRole("button", { name: en.settings })).not.toHaveFocus();
  });

  it("starts a new app session at defaults without writing preference storage", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const first = mount();
    await screen.findByText("No ProteoWizard installation was found");
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    press(dialog, zh.apply);
    first.unmount();
    mount();
    await screen.findByText("No ProteoWizard installation was found");
    expect(document.documentElement.lang).toBe("en");
    expect(density()).toBe("comfortable");
    expect(storage).not.toHaveBeenCalled();
  });

  it("does not let a detached dialog return into a later app session", async () => {
    const first = mount();
    await screen.findByText("No ProteoWizard installation was found");
    const dialog = openSettings();
    const closed = new Promise<void>(resolve => dialog.addEventListener("focusScope.autoFocusOnUnmount", () => resolve(), { once: true }));
    first.unmount();
    mount();
    await act(async () => closed);
    expect(document.querySelector("[data-settings-return-target]")).not.toHaveFocus();
    expect(screen.getByRole("button", { name: en.settings })).not.toHaveFocus();
  });

  it("keeps an initialization resource failure reachable through validated recovery", async () => {
    mount(createFakePreviewApi({ availability: unavailableBackend }), createUiRuntime({ en: {}, "zh-CN": {} }));
    await screen.findByText("No ProteoWizard installation was found");
    const dialog = openSettings();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(en.resourceError);
    expect(within(dialog).getByRole("button", { name: en.apply })).toHaveAttribute("aria-disabled", "true");
    press(dialog, en.recover);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("rejects a missing supported bundle, retains applied preferences and recovers in the applied language", async () => {
    const runtime = createUiRuntime();
    mount(createFakePreviewApi({ availability: unavailableBackend }), runtime);
    await screen.findByText("No ProteoWizard installation was found");
    let dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    await applyAndClose(dialog, zh.apply);
    await act(async () => { runtime.instance.removeResourceBundle("en", "ui"); });
    dialog = openSettings();
    choose(dialog, zh.english);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(density()).toBe("compact");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(zh.resourceError);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("RESOURCE_MISSING");
    expect(within(dialog).getByRole("button", { name: zh.apply })).toHaveAttribute("aria-disabled", "true");
    press(dialog, zh.recover);
    choose(dialog, zh.english);
    press(dialog, en.cancel);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(density()).toBe("compact");
  });

  it.each(["removed", "empty"] as const)("recovers an active %s bundle without a key dump or abandoned preview", async (fault) => {
    const runtime = createUiRuntime();
    const api = createFakePreviewApi({ availability: unavailableBackend });
    mount(api, runtime);
    await screen.findByText("No ProteoWizard installation was found");
    await waitFor(() => expect(api.calls()).toContain("readConversionConfiguration"));
    let dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    await applyAndClose(dialog, zh.apply);
    dialog = openSettings();
    if (fault === "removed") {
      choose(dialog, zh.english);
      choose(dialog, en.comfortable);
    }
    const calls = [...api.calls()];
    await act(async () => {
      if (fault === "removed") runtime.instance.removeResourceBundle("en", "ui");
      else runtime.instance.addResourceBundle("zh-CN", "ui", { settings: "" }, true, true);
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(dialog).toHaveAccessibleName(zh.settings);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(density()).toBe("compact");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(fault === "removed" ? "RESOURCE_MISSING" : "RESOURCE_EMPTY");
    expect(within(dialog).getByRole("button", { name: zh.apply })).toHaveAttribute("aria-disabled", "true");
    press(dialog, zh.recover);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByRole("button", { name: zh.apply })).not.toHaveAttribute("aria-disabled");
    expect(api.calls()).toEqual(calls);
  });

  it("replaces an invalid bundle exactly so recovery does not retain unexpected keys", async () => {
    const runtime = createUiRuntime();
    mount(createFakePreviewApi({ availability: unavailableBackend }), runtime);
    await screen.findByText("No ProteoWizard installation was found");
    const dialog = openSettings();
    await act(async () => { runtime.instance.addResourceBundle("zh-CN", "ui", { unexpected: "Injected unexpected key" }, true, true); });
    choose(dialog, en.simplifiedChinese);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("RESOURCE_KEYS");
    press(dialog, en.recover);
    expect(() => validateBundle("zh-CN", runtime.instance.getResourceBundle("zh-CN", "ui"))).not.toThrow();
    choose(dialog, en.simplifiedChinese);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    press(dialog, zh.apply);
    expect(within(openSettings()).queryByRole("alert")).toBeNull();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("accepts a pending spectrum normally while Settings is open and rejects a late abandoned locale", async () => {
    const result = deferred<SelectedSpectrumOutcome>();
    const runtime = createUiRuntime();
    const api = createFakePreviewApi({ availability: availableBackend, spectrum: () => result.promise });
    mount(api, runtime);
    const add = await screen.findByRole("button", { name: "Add files…" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    const grid = await screen.findByRole("grid", { name: "Scans" });
    fireEvent.click(grid.querySelector('[data-source-index="0"]')!);
    expect(api.requestedSpectra).toEqual([0]);
    const calls = [...api.calls()];
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    await act(async () => result.resolve({ outcome: "spectrum", spectrum: buildSpectrum(0, 12) }));
    expect(document.querySelector('[data-settings-dialog]')).toBe(dialog);
    expect(screen.getByText("质谱 0，MS1，12 个点。")).toBeInTheDocument();
    const spectrum = document.querySelector('.spectrum-panel');
    expect(spectrum).not.toBeNull();
    press(dialog, zh.cancel);
    await act(async () => { await runtime.instance.changeLanguage("zh-CN"); });
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: en.settings })).toBeInTheDocument();
    expect(document.querySelector('.spectrum-panel')).toBe(spectrum);
    expect(api.requestedSpectra).toEqual([0]);
    expect(api.calls()).toEqual(calls);
    expect(api.openCount()).toBe(1);
  });

  it("keeps PNG-only invalidity narrow and exports unchanged canonical dimensions after applying a locale", async () => {
    vi.stubGlobal("URL", class extends URL { static createObjectURL = () => "blob:mock-figure"; static revokeObjectURL = vi.fn(); });
    const api = await loadedApp();
    const spectrum = document.querySelector<HTMLElement>("section.spectrum-panel")!;
    // The settings are the figure dialog's; the plot head repeats them.
    fireEvent.click(within(spectrum).getByRole("button", { name: en.figureExportTitle }));
    const figure = screen.getByRole("dialog");
    fireEvent.change(figure.querySelector<HTMLInputElement>('input[id$="-widthPx"]')!, { target: { value: "00640" } });
    fireEvent.change(figure.querySelector<HTMLInputElement>('input[id$="-heightPx"]')!, { target: { value: "480" } });
    fireEvent.change(figure.querySelector<HTMLInputElement>('input[id$="-pngDpi"]')!, { target: { value: "1e" } });
    fireEvent.click(within(figure).getByRole("radio", { name: en.dark }));
    fireEvent.click(within(figure).getByRole("button", { name: en.figureExportReturn }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    await applyAndClose(dialog, zh.apply);
    // Quick PNG and Copy plot are the ⋯ menu's (direction A), in the new locale.
    fireEvent.keyDown(within(spectrum).getByRole("button", { name: zh.plotMoreExports }), { key: "Enter" });
    const png = await screen.findByRole("menuitem", { name: zh.figureQuickPng });
    expect(png).toHaveAttribute("aria-disabled", "true");
    expect(png).toHaveAccessibleDescription(zh.invalidDpi);
    expect(screen.getByRole("menuitem", { name: zh.viewerCopy })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 CSV…" }));
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(1));
    expect(api.spectrumExportRequests[0]?.settings).toEqual({ widthPx: 640, heightPx: 480, pngDpi: 300, theme: "dark" });
    vi.unstubAllGlobals();
  });
});
