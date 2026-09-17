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
  const grid = await screen.findByRole("grid", { name: "Spectra" });
  fireEvent.click(within(grid).getByText("controllerType=0 controllerNumber=1 scan=1"));
  await screen.findByText(/Spectrum 0, MS2, 12 points\./);
  fireEvent.click(document.getElementById("chromatogram-export-toggle")!);
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
    expect(within(dialog).getByText(zh.storageSaved)).toBeVisible();
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
    expect(within(dialog).getByRole("button", { name: en.apply })).toBeDisabled();
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
    expect(within(dialog).getByRole("button", { name: zh.apply })).toBeDisabled();
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
    expect(within(dialog).getByRole("button", { name: zh.apply })).toBeDisabled();
    press(dialog, zh.recover);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByRole("button", { name: zh.apply })).toBeEnabled();
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

  it("keeps both figure instances, raw drafts, caret and error targets across a locale preview", async () => {
    const api = await loadedApp();
    const widths = [...document.querySelectorAll<HTMLInputElement>('input[id$="-widthPx"]')];
    const heights = [...document.querySelectorAll<HTMLInputElement>('input[id$="-heightPx"]')];
    expect(widths).toHaveLength(2);
    const field = widths[0];
    field.focus();
    fireEvent.change(field, { target: { value: "1e" } });
    field.setSelectionRange(1, 1);
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    fireEvent.compositionEnd(field);
    const calls = [...api.calls()];
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    expect([...document.querySelectorAll('input[id$="-widthPx"]')]).toEqual(widths);
    expect(field.selectionStart).toBe(1);
    expect(field.selectionEnd).toBe(1);
    for (const input of widths) {
      expect(input).toHaveValue("1e");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleName(`${zh.width} ${zh.pixels}`);
      const error = document.getElementById(input.getAttribute("aria-describedby")!);
      expect(error).toHaveTextContent(zh.invalidWidth);
      expect(error).toHaveAttribute("data-problem-code", "FIGURE_WHOLE_COUNT");
    }
    for (const input of heights) {
      expect(input).not.toHaveAttribute("aria-invalid");
      expect(input).not.toHaveAttribute("aria-describedby");
    }
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const themes = [...document.querySelectorAll<HTMLInputElement>('.spectrum-figure-settings input[type="radio"]')];
    expect(new Set(themes.map((radio) => radio.name)).size).toBe(2);
    press(dialog, zh.cancel);
    expect(field).toHaveValue("1e");
    expect(field).toHaveAccessibleName(`${en.width} ${en.pixels}`);
    expect(api.calls()).toEqual(calls);
    expect(api.spectrumExportRequests).toHaveLength(0);
  });

  it("accepts a pending spectrum normally while Settings is open and rejects a late abandoned locale", async () => {
    const result = deferred<SelectedSpectrumOutcome>();
    const runtime = createUiRuntime();
    const api = createFakePreviewApi({ availability: availableBackend, spectrum: () => result.promise });
    mount(api, runtime);
    const add = await screen.findByRole("button", { name: "Add files…" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    const grid = await screen.findByRole("grid", { name: "Spectra" });
    fireEvent.click(within(grid).getByText("controllerType=0 controllerNumber=1 scan=1"));
    expect(api.requestedSpectra).toEqual([0]);
    const calls = [...api.calls()];
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    await act(async () => result.resolve({ outcome: "spectrum", spectrum: buildSpectrum(0, 12) }));
    expect(document.querySelector('[data-settings-dialog]')).toBe(dialog);
    expect(screen.getByText("质谱 0，MS2，12 个点。")).toBeInTheDocument();
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
    const api = await loadedApp();
    const width = document.querySelector<HTMLInputElement>('input[id$="-widthPx"]')!;
    const height = document.querySelector<HTMLInputElement>('input[id$="-heightPx"]')!;
    const dpi = document.querySelector<HTMLInputElement>('input[id$="-pngDpi"]')!;
    fireEvent.change(width, { target: { value: "00640" } });
    fireEvent.change(height, { target: { value: "480" } });
    fireEvent.change(dpi, { target: { value: "1e" } });
    const figure = width.closest("fieldset")!;
    fireEvent.click(within(figure).getByRole("radio", { name: en.dark }));
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    await applyAndClose(dialog, zh.apply);
    expect(dpi).toHaveAccessibleDescription(zh.invalidDpi);
    expect(width).not.toHaveAttribute("aria-invalid");
    const spectrum = document.getElementById("spectrum-widthPx")?.closest("section") ?? width.closest("section")!;
    fireEvent.click(within(spectrum).getByText("导出质谱"));
    const svg = within(spectrum).getByRole("button", { name: "导出 SVG…" });
    expect(svg).toBeEnabled();
    expect(within(spectrum).getByRole("button", { name: "导出 PNG…" })).toBeDisabled();
    expect(within(spectrum).getByRole("button", { name: "复制图像" })).toBeEnabled();
    fireEvent.click(svg);
    await waitFor(() => expect(api.spectrumExportRequests.length + api.chromatogramExportRequests.length).toBe(1));
    const request = api.spectrumExportRequests[0] ?? api.chromatogramExportRequests[0];
    expect(request.settings).toEqual({ widthPx: 640, heightPx: 480, pngDpi: 300, theme: "dark" });
    expect(width).toHaveValue("00640");
    expect(dpi).toHaveValue("1e");
  });
});
