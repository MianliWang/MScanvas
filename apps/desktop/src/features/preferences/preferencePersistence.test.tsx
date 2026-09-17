/**
 * Durable UI preferences in the real application composition.
 *
 * Every case here drives the shipped components through the preference
 * boundary: hydration, the apply lifecycle, the panel commits, and each
 * recovery state. The store is a deterministic seam, so what is proved is what
 * the interface does with each answer -- whether the bytes on disk really
 * survive a refused write is proved against the filesystem in
 * `apps/desktop/src-tauri/src/preferences/tests.rs`, and against a real profile
 * in the native campaign.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { PreviewApiProvider } from "../mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../mzml-preview/dropTransport";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  unavailableBackend,
  type FakePreviewApi,
} from "../../test/previewFixtures";
import {
  createFakePreferencesApi,
  storedRecord,
  type FakePreferencesApi,
  type FakePreferencesOptions,
} from "../../test/preferenceFixtures";
import { PreferencesApiProvider } from "./preferencesApi";
import { UI_RESOURCES } from "./i18n";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

/** A controllable viewport, so a breakpoint is an event rather than a guess. */
function installViewport(initial: { constrained: boolean; roomy: boolean }) {
  const listeners = new Map<string, Set<() => void>>();
  let current = initial;
  const original = window.matchMedia;
  window.matchMedia = (query: string) => ({
    media: query,
    get matches() {
      return query.includes("max-width: 1050px") ? current.constrained : current.roomy;
    },
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener(_type: string, listener: () => void) {
      const set = listeners.get(query) ?? new Set();
      set.add(listener);
      listeners.set(query, set);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.get(query)?.delete(listener);
    },
    dispatchEvent() { return true; },
  }) as unknown as MediaQueryList;
  return {
    async resize(next: { constrained: boolean; roomy: boolean }) {
      current = next;
      await act(async () => {
        for (const set of listeners.values()) for (const listener of set) listener();
      });
    },
    restore() { window.matchMedia = original; },
  };
}

function mount(options: {
  readonly preferences?: FakePreferencesOptions;
  readonly api?: FakePreviewApi;
} = {}) {
  const preferences = createFakePreferencesApi(options.preferences);
  const api = options.api ?? createFakePreviewApi({ availability: unavailableBackend });
  const view = render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreferencesApiProvider value={preferences}>
      <PreviewApiProvider value={api}><App /></PreviewApiProvider>
    </PreferencesApiProvider>
  </WorkspaceDropTransportProvider>);
  return { preferences, api, view };
}

/** A second session over a store that already holds the first one's record. */
function remount(preferences: FakePreferencesApi, api: FakePreviewApi) {
  return render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreferencesApiProvider value={preferences}>
      <PreviewApiProvider value={api}><App /></PreviewApiProvider>
    </PreferencesApiProvider>
  </WorkspaceDropTransportProvider>);
}

function openSettings() {
  const entry = document.querySelector<HTMLButtonElement>("[data-settings-entry]")!;
  entry.focus();
  fireEvent.click(entry);
  return screen.getByRole("dialog");
}

function choose(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("radio", { name }));
}
function press(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("button", { name }));
}
async function applyAndClose(dialog: HTMLElement, name: string) {
  press(dialog, name);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

const density = () => document.querySelector(".dataset-roster-panel")?.getAttribute("data-density");
const shell = () => document.querySelector(".workbench-shell")!;
const rosterToggle = () => screen.getByRole("button", { name: en.rosterToggle });

describe("durable UI preferences", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("starts a first run on the defaults without writing anything", async () => {
    const browserStorage = vi.spyOn(Storage.prototype, "setItem");
    const { preferences } = mount();
    await screen.findByText("ProteoWizard is not available");
    expect(document.documentElement.lang).toBe("en");
    expect(density()).toBe("comfortable");
    // Absent is an ordinary state. Nothing is stored and nothing is written to
    // make it stored -- a first run does not get a file it never asked for.
    expect(preferences.stored()).toBeNull();
    expect(preferences.requests).toEqual([]);
    expect(browserStorage).not.toHaveBeenCalled();
  });

  it("restores the saved appearance and layout in a fresh session, and no scientific session", async () => {
    const api = createFakePreviewApi({ availability: availableBackend });
    const { preferences, view } = mount({
      api,
      // The roster stays reachable so this case can load something; the
      // inspector carries the layout evidence, because the responsive default
      // at this viewport would have opened it.
      preferences: { stored: storedRecord({ appearance: { locale: "zh-CN", density: "compact" }, layout: { roster: "shown", details: "hidden" } }) },
    });
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    expect(density()).toBe("compact");
    expect(shell()).toHaveAttribute("data-details-open", "false");

    // Something is loaded in this session, and then the session ends.
    const add = await screen.findByRole("button", { name: zh.addFiles });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await screen.findByRole("grid", { name: zh.scansTitle });
    view.unmount();

    // A second session over the same store: the same preferences, and a fresh
    // scientific session. The roster is the workspace's, not the record's.
    const second = createFakePreviewApi({ availability: availableBackend });
    remount(preferences, second);
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    expect(density()).toBe("compact");
    expect(shell()).toHaveAttribute("data-details-open", "false");
    expect(screen.queryByRole("grid", { name: zh.scansTitle })).toBeNull();
  });

  it("commits only the appearance group, with no path, roster or scientific field in the payload", async () => {
    const { preferences } = mount();
    await screen.findByText("ProteoWizard is not available");
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    await applyAndClose(dialog, zh.apply);

    expect(preferences.requests).toEqual([
      { appearance: { locale: "zh-CN", density: "compact" } },
    ]);
    // The whole stored document, named exactly. Anything else that ever reaches
    // the store fails here rather than in a user's profile.
    expect(preferences.stored()).toEqual({
      schemaVersion: 1,
      appearance: { locale: "zh-CN", density: "compact" },
      layout: { roster: "automatic", details: "automatic" },
    });
  });

  it("does not persist a cancelled preview, or a reset that was then cancelled", async () => {
    const { preferences } = mount();
    await screen.findByText("ProteoWizard is not available");
    let dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    press(dialog, zh.cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(preferences.requests).toEqual([]);
    expect(preferences.stored()).toBeNull();

    // A record on disk, then Reset followed by Cancel: the draft went to the
    // defaults and the file did not.
    dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    await applyAndClose(dialog, zh.apply);
    const afterApply = preferences.stored();
    dialog = openSettings();
    press(dialog, zh.reset);
    expect(document.documentElement.lang).toBe("en");
    press(dialog, en.cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(preferences.stored()).toEqual(afterApply);
    expect(preferences.requests).toHaveLength(1);
  });

  it("persists a reset that was applied", async () => {
    const { preferences } = mount({
      preferences: { stored: storedRecord({ appearance: { locale: "zh-CN", density: "compact" } }) },
    });
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    const dialog = openSettings();
    press(dialog, zh.reset);
    await applyAndClose(dialog, en.apply);
    expect(preferences.stored()?.appearance).toEqual({ locale: "en", density: "comfortable" });
  });

  it("freezes the dialog while a publish is in flight and dispatches exactly one write", async () => {
    const { preferences } = mount({ preferences: { deferred: true } });
    await preferences.release();
    await screen.findByText("ProteoWizard is not available");
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);

    const apply = within(dialog).getByRole("button", { name: zh.apply });
    fireEvent.click(apply);
    // Named as busy, inert, and every action that would change what is being
    // published is frozen. Cancel too: the bytes are already on their way.
    const pending = within(dialog).getByRole("button", { name: zh.savePending });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: zh.cancel })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: zh.reset })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: zh.english })).toBeDisabled();

    // A second activation of the same press, and an Escape, while it is in
    // flight. Neither may dispatch a second write or imply the first is undone.
    fireEvent.click(pending);
    fireEvent.keyDown(pending, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(preferences.requests).toHaveLength(1);

    await preferences.release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(preferences.requests).toHaveLength(1);
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("keeps the draft, offers retry, and succeeds on the retry after a write failure", async () => {
    const { preferences } = mount({
      preferences: { failWith: { problem: "notPublished", retryable: true } },
    });
    await screen.findByText("ProteoWizard is not available");
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    press(dialog, zh.apply);

    const failure = await within(dialog).findByRole("alert");
    expect(failure).toHaveTextContent(zh.saveFailedTitle);
    expect(failure).toHaveTextContent(zh.writeNotPublished);
    expect(failure).toHaveTextContent(zh.saveFailedKeeps);
    // The dialog stayed open, the draft is intact and the preview still holds.
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(density()).toBe("compact");
    expect(preferences.stored()).toBeNull();

    preferences.recover();
    press(dialog, zh.saveRetry);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The retry published the snapshot the failed apply captured.
    expect(preferences.stored()?.appearance).toEqual({ locale: "zh-CN", density: "compact" });
  });

  it("reports a residue left by a failed write, and offers no retry for a refusal that cannot succeed", async () => {
    const withResidue = mount({
      preferences: { failWith: { problem: "notWritten", retryable: true, temporaryLeftBehind: true } },
    });
    await screen.findByText("ProteoWizard is not available");
    let dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(zh.saveTemporaryLeftBehind);
    withResidue.view.unmount();

    mount({ preferences: { failWith: { problem: "unsafeTarget", retryable: false } } });
    await screen.findByText("ProteoWizard is not available");
    dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    const refusal = await within(dialog).findByRole("alert");
    expect(refusal).toHaveTextContent(zh.writeUnsafeTarget);
    expect(within(dialog).queryByRole("button", { name: zh.saveRetry })).toBeNull();
    // The named session-only action is always there; it is not a retry.
    expect(within(dialog).getByRole("button", { name: zh.saveSessionOnly })).toBeEnabled();
  });

  it("applies for this session only, claiming no write and saying what a restart uses", async () => {
    const { preferences } = mount({
      preferences: { failWith: { problem: "notWritten", retryable: true } },
    });
    await screen.findByText("ProteoWizard is not available");
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    choose(dialog, zh.compact);
    press(dialog, zh.apply);
    await within(dialog).findByRole("alert");
    press(dialog, zh.saveSessionOnly);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(density()).toBe("compact");
    expect(document.querySelector('[data-live-region="preferences"]')).toHaveTextContent(zh.sessionOnlyApplied);
    // Nothing was stored, and the dialog says exactly that when reopened.
    expect(preferences.stored()).toBeNull();
    expect(within(openSettings()).getByText(zh.sessionOnlyNote)).toBeVisible();
  });

  it("keeps an unusable stored record until its replacement is confirmed", async () => {
    const { preferences } = mount({ preferences: { unusable: "unsupportedVersion" } });
    await screen.findByText("ProteoWizard is not available");
    // Recoverable defaults, an accurate explanation, and no spinner.
    expect(document.documentElement.lang).toBe("en");
    expect(density()).toBe("comfortable");
    const dialog = openSettings();
    const problem = within(dialog).getByRole("alert");
    expect(problem).toHaveTextContent(en.storedUnusableTitle);
    expect(problem).toHaveTextContent(en.storedUnsupportedVersion);

    // An ordinary apply does not overwrite it.
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    await waitFor(() => expect(preferences.requests).toHaveLength(1));
    expect(preferences.requests[0]).toEqual({ appearance: { locale: "zh-CN", density: "comfortable" } });
    expect(preferences.stored()).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(zh.storedUnusableTitle);

    // The confirmed replacement is the only thing that does.
    press(dialog, zh.storedReplace);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(preferences.requests[1]).toEqual({
      appearance: { locale: "zh-CN", density: "comfortable" },
      layout: { roster: "automatic", details: "automatic" },
      replaceUnusable: true,
    });
    expect(preferences.stored()?.appearance.locale).toBe("zh-CN");
    expect(document.querySelector('[data-live-region="preferences"]')).toHaveTextContent(zh.storedReplaced);
  });

  it("names an unknown stored problem instead of guessing at it", async () => {
    mount({ preferences: { unusable: "somethingThisBuildHasNeverHeardOf" } });
    await screen.findByText("ProteoWizard is not available");
    const problem = within(openSettings()).getByRole("alert");
    expect(problem).toHaveTextContent(en.storageUnknownProblem.replace("{{code}}", "somethingThisBuildHasNeverHeardOf"));
  });

  it("stays usable with nowhere to store preferences, and never claims a write", async () => {
    const { preferences } = mount({ preferences: { unavailable: "rootUnresolved" } });
    await screen.findByText("ProteoWizard is not available");
    let dialog = openSettings();
    expect(within(dialog).getByText(en.storageUnavailable)).toBeVisible();
    expect(within(dialog).getByText(en.storageRootUnresolved)).toBeVisible();
    expect(within(dialog).getByText(en.storageSessionOnly)).toBeVisible();

    choose(dialog, en.simplifiedChinese);
    await applyAndClose(dialog, zh.apply);
    // Applied for the session, nothing dispatched, nothing claimed.
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(preferences.requests).toEqual([]);
    expect(document.querySelector('[data-live-region="preferences"]')).toHaveTextContent(zh.sessionOnlyApplied);

    // And a panel toggle stays a presentation action rather than a failure.
    fireEvent.click(screen.getByRole("button", { name: zh.rosterToggle }));
    expect(shell()).toHaveAttribute("data-roster-open", "false");
    expect(preferences.requests).toEqual([]);
    expect(document.querySelector("[data-layout-unsaved]")).toBeNull();
    dialog = openSettings();
    // Named as a session-only application, which is what it was: the store was
    // never asked, so there is nothing to report as failed.
    expect(within(dialog).getByText(zh.sessionOnlyNote)).toBeVisible();
    expect(within(dialog).getByText(zh.storageUnavailable)).toBeVisible();
  });

  it("settles a failed read into recoverable defaults rather than an indefinite wait", async () => {
    const { preferences } = mount({ preferences: { readRejects: true } });
    await screen.findByText("ProteoWizard is not available");
    await waitFor(() => expect(rosterToggle()).toBeEnabled());
    const dialog = openSettings();
    expect(within(dialog).getByText(en.storageReadFailed)).toBeVisible();
    expect(within(dialog).queryByText(en.storageLoading)).toBeNull();
    // No automatic retry loop: one read, and the way out is the user's.
    expect(preferences.requests).toEqual([]);
  });

  it("does not let a late hydration answer overwrite an edit or a commit", async () => {
    const { preferences } = mount({
      preferences: { stored: storedRecord({ appearance: { locale: "zh-CN", density: "compact" } }), deferred: true },
    });
    await screen.findByText("ProteoWizard is not available");
    // The read is still outstanding, so the panels are not yet acting on
    // preferences nobody has seen. Checked before the modal opens, because a
    // modal hides the rest of the application from the accessibility tree.
    expect(rosterToggle()).toBeDisabled();
    const loading = openSettings();
    expect(within(loading).getByText(en.storageLoading)).toBeVisible();
    expect(within(loading).getByRole("radio", { name: en.english })).toBeDisabled();
    expect(within(loading).getByRole("button", { name: en.apply })).toBeDisabled();

    await preferences.release();
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    expect(density()).toBe("compact");
    press(loading, zh.cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: zh.rosterToggle })).toBeEnabled());
  });

  it("ignores an older commit answer delivered after a newer one", async () => {
    const { preferences } = mount({
      preferences: { deferred: true, failWith: { problem: "notPublished", retryable: true } },
    });
    await preferences.release();
    await screen.findByText("ProteoWizard is not available");

    // Two layout commits. The first is refused; the second succeeds. Rust
    // decides both in the order they were made -- what a document can see out
    // of order is the delivery.
    fireEvent.click(rosterToggle());
    await waitFor(() => expect(preferences.outstanding()).toBe(1));
    preferences.recover();
    fireEvent.click(rosterToggle());
    await waitFor(() => expect(preferences.outstanding()).toBe(2));

    // Newest first, then the stale refusal.
    await preferences.release([1, 0]);
    await waitFor(() => expect(preferences.stored()?.layout.roster).toBe("shown"));
    // The late refusal described a commit this session has moved past, so it
    // does not get to report the newer arrangement as unsaved.
    expect(screen.queryByText(en.layoutUnsaved)).toBeNull();
  });

  it("drops every answer to a document that is gone", async () => {
    const { preferences, view } = mount({ preferences: { deferred: true } });
    await screen.findByText("ProteoWizard is not available");
    expect(preferences.outstanding()).toBe(1);
    view.unmount();
    // The read answers into a document that no longer exists. Nothing renders
    // and nothing throws; there is no state left for it to reach.
    await preferences.release();
    expect(document.querySelector(".workbench-shell")).toBeNull();
  });

  it("commits a panel toggle as its own group and leaves the Settings draft alone", async () => {
    const { preferences } = mount();
    await screen.findByText("ProteoWizard is not available");
    // An unapplied Settings draft, open at the same time.
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(rosterToggle());
    await waitFor(() => expect(preferences.requests).toHaveLength(1));
    expect(preferences.requests[0]).toEqual({ layout: { roster: "hidden", details: "automatic" } });
    expect(preferences.stored()).toEqual({
      schemaVersion: 1,
      // The cancelled draft is nowhere in it.
      appearance: { locale: "en", density: "comfortable" },
      layout: { roster: "hidden", details: "automatic" },
    });
    expect(shell()).toHaveAttribute("data-roster-open", "false");
  });

  it("keeps a layout commit and an appearance commit from overwriting each other", async () => {
    const { preferences } = mount();
    await screen.findByText("ProteoWizard is not available");
    fireEvent.click(rosterToggle());
    await waitFor(() => expect(preferences.stored()?.layout.roster).toBe("hidden"));

    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    await applyAndClose(dialog, zh.apply);
    // Both groups, each from the surface that owns it.
    expect(preferences.stored()).toEqual({
      schemaVersion: 1,
      appearance: { locale: "zh-CN", density: "comfortable" },
      layout: { roster: "hidden", details: "automatic" },
    });

    fireEvent.click(screen.getByRole("button", { name: zh.rosterToggle }));
    await waitFor(() => expect(preferences.stored()?.layout.roster).toBe("shown"));
    expect(preferences.stored()?.appearance.locale).toBe("zh-CN");
  });

  it("reports an unsaved layout without disturbing the workspace, and retries it", async () => {
    const { preferences } = mount({
      preferences: { failWith: { problem: "notPublished", retryable: true } },
    });
    await screen.findByText("ProteoWizard is not available");
    fireEvent.click(rosterToggle());
    const notice = await screen.findByText(en.layoutUnsaved);
    // The arrangement the user asked for is on screen; what is reported is
    // that it will not survive a restart.
    expect(shell()).toHaveAttribute("data-roster-open", "false");
    expect(notice.closest("[data-layout-unsaved]")).not.toBeNull();
    expect(notice.closest("[role=alert]")).toBeNull();

    preferences.recover();
    fireEvent.click(screen.getByRole("button", { name: en.layoutRetry }));
    await waitFor(() => expect(screen.queryByText(en.layoutUnsaved)).toBeNull());
    expect(preferences.stored()?.layout.roster).toBe("hidden");
  });

  it("restores a saved panel request through a viewport that could not fit it", async () => {
    const viewport = installViewport({ constrained: false, roomy: true });
    try {
      const { preferences } = mount({
        preferences: { stored: storedRecord({ layout: { roster: "shown", details: "shown" } }) },
      });
      await screen.findByText("ProteoWizard is not available");
      await waitFor(() => expect(shell()).toHaveAttribute("data-roster-open", "true"));

      // A window that cannot fit them folds both away, and stores nothing.
      await viewport.resize({ constrained: true, roomy: false });
      expect(shell()).toHaveAttribute("data-roster-open", "false");
      expect(preferences.requests).toEqual([]);
      expect(preferences.stored()?.layout).toEqual({ roster: "shown", details: "shown" });

      // Widening it again brings the saved request back, unasked.
      await viewport.resize({ constrained: false, roomy: true });
      expect(shell()).toHaveAttribute("data-roster-open", "true");
      expect(preferences.requests).toEqual([]);
    } finally {
      viewport.restore();
    }
  });

  it("keeps a details request as intent while nothing is loaded, and reaches a reset either way", async () => {
    const { preferences } = mount({
      preferences: { stored: storedRecord({ layout: { roster: "hidden", details: "shown" } }) },
    });
    await screen.findByText("ProteoWizard is not available");
    await waitFor(() => expect(shell()).toHaveAttribute("data-roster-open", "false"));
    // Asked for, nothing to show, and nothing loaded to make it showable.
    expect(shell()).toHaveAttribute("data-details-open", "false");
    expect(screen.getByRole("button", { name: en.inspectorToggle })).toBeDisabled();
    expect(preferences.stored()?.layout.details).toBe("shown");

    // The reset is reachable from here, with no dataset and no backend.
    const reset = screen.getByRole("button", { name: en.layoutReset });
    fireEvent.click(reset);
    await waitFor(() => expect(preferences.stored()?.layout).toEqual({ roster: "automatic", details: "automatic" }));
    expect(shell()).toHaveAttribute("data-roster-open", "true");
    // Nothing left to reset, so the control stands down.
    await waitFor(() => expect(screen.queryByRole("button", { name: en.layoutReset })).toBeNull());
  });

  it("applies a preference change without asking the backend anything", async () => {
    const api = createFakePreviewApi({ availability: unavailableBackend });
    const { preferences } = mount({ api });
    await screen.findByText("ProteoWizard is not available");
    await waitFor(() => expect(api.calls()).toContain("readConversionConfiguration"));
    const calls = [...api.calls()];

    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    await applyAndClose(dialog, zh.apply);
    fireEvent.click(screen.getByRole("button", { name: zh.rosterToggle }));
    await waitFor(() => expect(preferences.requests).toHaveLength(2));
    expect(api.calls()).toEqual(calls);
  });
});
