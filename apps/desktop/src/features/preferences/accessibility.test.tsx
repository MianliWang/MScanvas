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

  it("associates each group with its label and its help, in both locales", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    for (const [locale, bundle] of [["en", en], ["zh-CN", zh]] as const) {
      const dialog = locale === "en" ? openSettings() : screen.getByRole("dialog");
      if (locale === "zh-CN") {
        fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));
      }
      const groups = within(dialog).getAllByRole("radiogroup");
      expect(groups).toHaveLength(2);
      // A group names itself from its own label element, and describes itself
      // from the help beside it. Neither is a placeholder or a title.
      expect(groups[0]).toHaveAccessibleName(bundle.language);
      expect(groups[0]).toHaveAccessibleDescription(bundle.languageHelp);
      expect(groups[1]).toHaveAccessibleName(bundle.density);
      expect(groups[1]?.getAttribute("aria-describedby")).not.toBeNull();
      // Every option is a real radio with a real name, so the arrow keys and
      // the form semantics are the platform's rather than this dialog's.
      for (const name of [bundle.english, bundle.simplifiedChinese, bundle.comfortable, bundle.compact]) {
        expect(within(dialog).getByRole("radio", { name })).toBeInstanceOf(HTMLInputElement);
      }
    }
  });

  it("names the dialog, describes it, and traps and returns the keyboard", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    expect(dialog).toHaveAccessibleName(en.settings);
    expect(dialog).toHaveAccessibleDescription(en.description);
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
    fireEvent.click(within(dialog).getByRole("button", { name: zh.apply }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // In the language that was just applied, which is the language the reader
    // is now being read.
    expect(liveRegion()).toHaveTextContent(zh.applied);
    expect(preferences.stored()?.appearance.locale).toBe("zh-CN");

    dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("button", { name: zh.reset }));
    // Reset previews the defaults, and English is one of them -- so the
    // announcement is in the language now on screen rather than in the one
    // being replaced. Announcing a preview in the old language would describe
    // the preview in words the preview itself has stopped using.
    expect(liveRegion()).toHaveTextContent(en.resetPreview);
    fireEvent.click(within(dialog).getByRole("button", { name: en.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(liveRegion()).toHaveTextContent(zh.cancelled);
  });

  it("really refuses the controls it freezes while a publish is in flight", async () => {
    const { preferences } = mount(createFakePreferencesApi({ deferred: true }));
    await preferences.release();
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));
    fireEvent.click(within(dialog).getByRole("button", { name: zh.apply }));

    // `aria-busy` on the control that is working, and `disabled` on the native
    // elements rather than a style that only looks refused.
    const pending = within(dialog).getByRole("button", { name: zh.savePending });
    expect(pending).toHaveAttribute("aria-busy", "true");
    for (const control of within(dialog).getAllByRole("radio")) {
      expect(control).toBeDisabled();
    }
    // A keyboard activation of a frozen control changes nothing.
    fireEvent.keyDown(pending, { key: "Enter" });
    fireEvent.click(within(dialog).getAllByRole("radio")[0]!);
    expect(preferences.requests).toHaveLength(1);

    await preferences.release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    // Refused because there is nothing loaded to inspect, and it says why
    // rather than only looking grey.
    expect(inspector).toBeDisabled();
    expect(inspector).toHaveAttribute("title", en.inspectorUnavailable);
  });

  it("keeps the layout reset reachable by keyboard and announces nothing it has not done", async () => {
    const { preferences } = mount(
      createFakePreferencesApi({ stored: storedRecord({ layout: { roster: "hidden", details: "automatic" } }) }),
    );
    await screen.findByText(en.backendMissing);
    const reset = await screen.findByRole("button", { name: en.layoutReset });
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

  it("reports an unsaved layout as a status rather than as an alert", async () => {
    const { preferences } = mount(
      createFakePreferencesApi({ failWith: { problem: "notPublished", retryable: true } }),
    );
    await screen.findByText(en.backendMissing);
    fireEvent.click(screen.getByRole("button", { name: en.rosterToggle }));
    const notice = await screen.findByText(en.layoutUnsaved);
    const region = notice.closest('[role="status"]');
    expect(region).not.toBeNull();
    expect(notice.closest('[role="alert"]')).toBeNull();
    // And the retry is a real control in that notice, reachable by keyboard.
    const retry = within(region as HTMLElement).getByRole("button", { name: en.layoutRetry });
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

  it("offers the offline help as a real disclosure, closed, with a named summary", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    const help = document.querySelector<HTMLDetailsElement>("[data-backend-help]")!;
    expect(help.open).toBe(false);
    const summary = within(help).getByText(en.backendHelpTitle);
    expect(summary.tagName).toBe("SUMMARY");
    // A native disclosure, so the keyboard and the screen reader get its state
    // from the platform rather than from an aria attribute this file wrote.
    fireEvent.click(summary);
    await waitFor(() => expect(help.open).toBe(true));
  });

  it("keeps the long Chinese labels intact, which is what the rendered checks measure", async () => {
    mount();
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));
    fireEvent.click(within(dialog).getByRole("button", { name: zh.apply }));
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
      "summaryRun", "summarySummary", "summarySpectra", "summaryChromatograms",
      "summaryRetentionTime", "summaryMsLevels", "summaryNoMsLevels",
      "summaryEmptySection", "summaryTiming", "summaryTimingHelp",
      "summaryOpenToPreview", "summaryRowToRendered", "summaryTableRender",
      "summaryNotMeasured",
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
