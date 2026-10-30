/**
 * Keyboard and screen-reader behaviour of everything M7.5 delivers.
 *
 * jsdom lays nothing out, so nothing here measures a pixel: clipping, hit
 * targets, reflow and reduced motion are verified in the browser and native
 * campaigns, and this file says so rather than claiming them. What it does
 * hold is the part that is structure rather than geometry -- label
 * association, accessible names, focus order, keyboard activation, the modal's
 * trap and return, whether a refused control is really refused, and what a
 * live region actually says -- in both bundled locales.
 *
 * Nothing here is an accessibility certification, and an automated check is
 * not one.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { PreviewApiProvider } from "../mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../mzml-preview/dropTransport";
import {
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  unavailableBackend,
} from "../../test/previewFixtures";
import { createFakePreferencesApi, storedRecord, type FakePreferencesApi } from "../../test/preferenceFixtures";
import { PreferencesApiProvider } from "./preferencesApi";
import { UI_RESOURCES } from "./i18n";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

function mount(preferences: FakePreferencesApi = createFakePreferencesApi()) {
  const api = createFakePreviewApi({ availability: unavailableBackend });
  const view = render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreferencesApiProvider value={preferences}>
      <PreviewApiProvider value={api}><App /></PreviewApiProvider>
    </PreferencesApiProvider>
  </WorkspaceDropTransportProvider>);
  return { preferences, api, view };
}

function settingsEntry() {
  return document.querySelector<HTMLButtonElement>("[data-settings-entry]")!;
}

function openSettings() {
  const entry = settingsEntry();
  entry.focus();
  fireEvent.click(entry);
  return screen.getByRole("dialog");
}

const liveRegion = () => document.querySelector('[data-live-region="preferences"]')!;

describe("Settings, by keyboard and by screen reader", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("associates each group with its label, in both locales", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    for (const [locale, bundle] of [["en", en], ["zh-CN", zh]] as const) {
      const dialog = locale === "en" ? openSettings() : screen.getByRole("dialog");
      if (locale === "zh-CN") {
        fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));
      }
      const groups = within(dialog).getAllByRole("radiogroup");
      expect(groups).toHaveLength(2);
      // A group names itself from its own label element, not a placeholder or
      // a title. The choices explain themselves, so nothing describes them.
      expect(groups[0]).toHaveAccessibleName(bundle.language);
      expect(groups[0]).not.toHaveAttribute("aria-describedby");
      expect(groups[1]).toHaveAccessibleName(bundle.density);
      expect(groups[1]).not.toHaveAttribute("aria-describedby");
      // Every option is a segmented-control radio with a real name: a button,
      // so the arrow keys and the single Tab stop are the radiogroup's.
      for (const name of [bundle.english, bundle.simplifiedChinese, bundle.comfortable, bundle.compact]) {
        expect(within(dialog).getByRole("radio", { name })).toBeInstanceOf(HTMLButtonElement);
      }
    }
  });

  it("names the dialog, adds no description, and traps and returns the keyboard", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    expect(dialog).toHaveAccessibleName(en.settings);
    expect(dialog).not.toHaveAttribute("aria-describedby");
    // Opened onto the current value rather than onto the first control, so the
    // keyboard starts where the reader's attention is.
    expect(within(dialog).getByRole("radio", { name: en.english })).toHaveFocus();
    // The rest of the application is out of the accessibility tree while the
    // modal is open, which is what makes it a modal.
    expect(screen.queryByRole("button", { name: en.rosterToggle })).toBeNull();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(settingsEntry()).toHaveFocus());
  });

  it("announces each outcome once, in the applied language", async () => {
    const { preferences } = mount();
    await screen.findByText(en.backendMissing);
    let dialog = openSettings();
    // Nothing is announced by opening: an empty region says nothing.
    expect(liveRegion()).toHaveTextContent("");

    fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));
    // In the language that was just applied, which is the language the reader
    // is now being read.
    await waitFor(() => expect(liveRegion()).toHaveTextContent(zh.applied));
    expect(preferences.stored()?.appearance.locale).toBe("zh-CN");
    fireEvent.click(within(dialog).getByRole("button", { name: zh.close }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("button", { name: zh.reset }));
    // Reset applies the defaults, and English is one of them -- so the
    // announcement is in the language now on screen rather than in the one
    // being replaced.
    await waitFor(() => expect(liveRegion()).toHaveTextContent(en.applied));
  });

  it("keeps every control live while a write is in flight, and one press is one write", async () => {
    const { preferences } = mount(createFakePreferencesApi({ deferred: true }));
    await preferences.release();
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));

    // Nothing native-disabled under the keyboard (B4); the footer says it is saving.
    for (const control of within(dialog).getAllByRole("radio")) {
      expect(control).toBeEnabled();
    }
    expect(dialog.querySelector("[data-storage-note]")).toHaveTextContent(zh.savePending);
    // Choosing the value already chosen asks for nothing.
    fireEvent.click(within(dialog).getByRole("radio", { name: zh.simplifiedChinese }));
    expect(preferences.requests).toHaveLength(1);

    await preferences.release();
    await waitFor(() => expect(dialog.querySelector("[data-storage-note]")).toBeEmptyDOMElement());
  });

  it("gives a storage problem an alert and a storage fact a status", async () => {
    const unusable = mount(createFakePreferencesApi({ unusable: "malformed" }));
    await screen.findByText(en.backendMissing);
    let dialog = openSettings();
    // Needs a decision, so it interrupts.
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent(en.storedUnusableTitle);
    expect(within(alert).getByRole("button", { name: en.storedReplace })).toBeEnabled();
    unusable.view.unmount();

    // Nothing is wrong and nothing needs deciding, so it does not.
    mount(createFakePreferencesApi({ unavailable: "rootUnresolved" }));
    await screen.findByText(en.backendMissing);
    dialog = openSettings();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByText(en.storageUnavailable).closest('[role="status"]')).not.toBeNull();
  });
});

describe("the workspace shell, by keyboard", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("names each panel toggle, says whether its panel is open, and points at it", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    const roster = screen.getByRole("button", { name: en.rosterToggle });
    expect(roster).toHaveAttribute("aria-expanded", "true");
    expect(roster).toHaveAttribute("aria-controls", "workbench-roster");
    expect(document.getElementById("workbench-roster")).not.toBeNull();

    const inspector = screen.getByRole("button", { name: en.inspectorToggle });
    expect(inspector).toHaveAttribute("aria-controls", "workbench-inspector");
    // Never refused (GOALS S3, B4): with nothing loaded the region opens and
    // says so in one line. It stays in the tab order (PM9 L20).
    expect(inspector).not.toHaveAttribute("aria-disabled");
    expect(inspector).not.toBeDisabled();
    inspector.focus();
    expect(inspector).toHaveFocus();
  });

  it("keeps the layout reset reachable by keyboard and announces nothing it has not done", async () => {
    const { preferences } = mount(
      createFakePreferencesApi({ stored: storedRecord({ layout: { roster: "hidden", details: "automatic" } }) }),
    );
    await screen.findByText(en.backendMissing);
    // In Settings, under Layout, since the v5.11 rebuild.
    const dialog = openSettings();
    const reset = within(dialog).getByRole("button", { name: en.layoutReset });
    reset.focus();
    expect(reset).toHaveFocus();
    // Activated by the keyboard, through the same handler a pointer reaches.
    fireEvent.click(reset);
    await waitFor(() => expect(preferences.stored()?.layout.roster).toBe("automatic"));
    // The preference live region belongs to Settings and says nothing about a
    // panel: a region that spoke for two surfaces would read one reader's
    // action to another.
    expect(liveRegion()).toHaveTextContent("");
  });

  it("announces an unsaved layout through a region that was already mounted", async () => {
    const { preferences } = mount(
      createFakePreferencesApi({ failWith: { problem: "notPublished", retryable: true } }),
    );
    await screen.findByText(en.backendMissing);
    // Mounted and empty from the first render. A region inserted together with
    // its text is the one mutation screen readers do not announce, which is how
    // this notice came to be visible and silent.
    const region = document.querySelector('[data-live-region="layout"]')!;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: en.rosterToggle }));
    await waitFor(() => expect(region).toHaveTextContent(en.layoutUnsaved));
    // Still the same node, which is what makes it an announcement.
    expect(document.querySelector('[data-live-region="layout"]')).toBe(region);
    // The visible notice carries no role of its own: two elements announcing
    // one fact would read it twice.
    const notice = screen.getByText(en.layoutUnsaved, { selector: "span" });
    expect(notice.closest('[role="status"]')).toBeNull();
    expect(notice.closest('[role="alert"]')).toBeNull();

    // And the retry is a real control in that notice, reachable by keyboard.
    const visible = notice.closest("[data-layout-unsaved]") as HTMLElement;
    const retry = within(visible).getByRole("button", { name: en.layoutRetry });
    retry.focus();
    expect(retry).toHaveFocus();
    preferences.recover();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText(en.layoutUnsaved)).toBeNull());
  });
});

describe("the backend banner, by screen reader", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("reads the verdict, its reason and its build as one thing", async () => {
    mount();
    const title = await screen.findByText(en.backendMissing);
    const reading = title.closest('[role="status"]');
    expect(reading).not.toBeNull();
    // One region, so a verdict and the sentence explaining it are not two
    // announcements a reader has to join up.
    expect(reading).toHaveTextContent(en.backendMissing);
    expect(reading).toHaveTextContent(en.backendNotFound);
    // The actions are outside it: they are controls, not news.
    expect(within(reading as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("names every recovery action, and keeps them keyboard-reachable in order", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    const actions = [...document.querySelectorAll<HTMLButtonElement>("[data-backend-action]")];
    expect(actions.map(control => control.dataset.backendAction)).toEqual(["recheck", "choose"]);
    for (const control of actions) {
      expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      expect(control).toBeEnabled();
      expect((control.textContent ?? "").trim()).not.toBe("");
    }
    // Focus order is document order, which is the order they are announced in.
    actions[0]?.focus();
    expect(actions[0]).toHaveFocus();
  });

  it("offers the offline help as a disclosure button, closed, with a named region, in the status bar's details", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    fireEvent.click(document.querySelector<HTMLElement>("[data-backend-item]")!);
    const help = await screen.findByRole("button", { name: en.backendHelpTitle });
    expect(help).toHaveAttribute("data-backend-help");
    expect(help).toHaveAttribute("aria-expanded", "false");
    const region = document.getElementById(help.getAttribute("aria-controls")!)!;
    expect(region).not.toBeVisible();
    fireEvent.click(help);
    await waitFor(() => expect(help).toHaveAttribute("aria-expanded", "true"));
    expect(region).toBeVisible();
    expect(region).toHaveTextContent(en.backendHelpProvider);
  });

  it("keeps the long Chinese labels intact, which is what the rendered checks measure", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));
    fireEvent.click(within(dialog).getByRole("button", { name: zh.close }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Every action still has its own name, and no name is empty or elided --
    // jsdom cannot say whether one is clipped, and the browser and native
    // campaigns are where that is looked at.
    const actions = [...document.querySelectorAll<HTMLButtonElement>("[data-backend-action]")];
    const names = actions.map(control => (control.textContent ?? "").trim());
    expect(names).toEqual([zh.backendRecheck, zh.backendChoose]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).not.toContain("…undefined");
  });
});

describe("the inspector panel's own copy", () => {
  it("is localized in both bundles, and keeps the file's own words original", () => {
    // The panel needs a loaded run, which this suite does not have -- the
    // composition tests load one. What is asserted here is the contract the
    // panel renders from: every label is a resource, translated, and the
    // unreported state stays the unreported state rather than becoming a zero.
    for (const key of [
      "summaryRun", "summarySpectra", "summaryChromatograms",
      "summaryRetentionTime", "summaryMsLevels", "summaryNoMsLevels",
      "summaryEmptySection", "detailsChromatogramSource", "detailsSpectrumSource",
      "detailsSourceMetadata",
    ] as const) {
      expect(en[key].trim(), key).not.toBe("");
      expect(zh[key].trim(), key).not.toBe("");
      expect(zh[key], key).not.toBe(en[key]);
    }
    expect(zh.viewerNotReported).not.toBe(en.viewerNotReported);
    expect(zh.viewerNotReported).not.toMatch(/^0$/u);
  });
});

describe("what this file does not prove", () => {
  it("is stated rather than implied", () => {
    // jsdom has no layout engine, so none of the above is evidence about
    // clipping, hit-target size, reflow at a constrained width, reduced motion
    // or Windows focus. Those are the browser and native campaigns', and this
    // assertion exists so that reading this file cannot leave the impression
    // they were covered here.
    expect(typeof window.matchMedia).toBe("function");
    expect(document.body.getBoundingClientRect().width).toBe(0);
  });
});
