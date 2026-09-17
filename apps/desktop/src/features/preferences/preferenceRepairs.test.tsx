/**
 * The defects the M7.5 source review found, each pinned by the case that found
 * it.
 *
 * Every one was a real wrong outcome traced in the shipped composition rather
 * than a style preference, and every one is a thing that would come back
 * quietly: a sentence that contradicts the block above it, a lane that reports
 * another lane's stale answer, a retry that provably cannot work. So they are
 * here as their own file, named for what went wrong.
 */

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { PreviewApiProvider } from "../mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../mzml-preview/dropTransport";
import {
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  unavailableBackend,
} from "../../test/previewFixtures";
import {
  createFakePreferencesApi,
  storedRecord,
  type FakePreferencesApi,
  type FakePreferencesOptions,
} from "../../test/preferenceFixtures";
import { PreferencesApiProvider } from "./preferencesApi";
import type { PreferenceWriteRequest } from "./storedPreferences";
import { blurAsABrowserWould } from "../../test/browserFocus";
import { UI_RESOURCES } from "./i18n";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

function mount(options: FakePreferencesOptions = {}, strict = false) {
  const preferences = createFakePreferencesApi(options);
  const api = createFakePreviewApi({ availability: unavailableBackend });
  const tree = <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreferencesApiProvider value={preferences}>
      <PreviewApiProvider value={api}><App /></PreviewApiProvider>
    </PreferencesApiProvider>
  </WorkspaceDropTransportProvider>;
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { preferences, api, view };
}

function openSettings() {
  const entry = document.querySelector<HTMLButtonElement>("[data-settings-entry]")!;
  entry.focus();
  fireEvent.click(entry);
  return screen.getByRole("dialog");
}
function press(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("button", { name }));
}
function choose(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("radio", { name }));
}
const footer = () => document.querySelector("[data-storage-note]")!;
const shell = () => document.querySelector(".workbench-shell")!;
const layoutRegion = () => document.querySelector('[data-live-region="layout"]')!;
const preferenceRegion = () => document.querySelector('[data-live-region="preferences"]')!;
const rosterToggle = () => screen.getByRole("button", { name: en.rosterToggle });

describe("a dialog that contradicted itself", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("stops claiming the preferences are saved when the write just failed", async () => {
    mount({ failWith: { problem: "notPublished", retryable: true } });
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    await within(dialog).findByRole("alert");
    // The footer used to read "saved on this computer and restored next time"
    // directly under an alert saying the write had failed.
    expect(footer()).toHaveTextContent(zh.storageNotSaving);
    expect(footer()).not.toHaveTextContent(zh.storageSaved);
  });

  it("stops claiming it when the stored record cannot be read at all", async () => {
    mount({ unusable: "malformed" });
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(en.storedUnusableTitle);
    expect(footer()).toHaveTextContent(en.storageNotSaving);
    expect(footer()).not.toHaveTextContent(en.storageSaved);
  });

  it("does not claim the old record survived a publish it could not read back", async () => {
    mount({ failWith: { problem: "notConfirmed", retryable: true } });
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    const uncertain = await within(dialog).findByRole("alert");
    // The rename succeeded and only the read-back failed, so "restarting uses
    // the last saved preferences" is the one thing MSCanvas cannot say.
    expect(uncertain).toHaveTextContent(zh.saveUncertainTitle);
    expect(uncertain).toHaveTextContent(zh.saveUncertainKeeps);
    expect(uncertain).toHaveTextContent(zh.writeNotConfirmed);
    expect(uncertain).not.toHaveTextContent(zh.saveFailedKeeps);
    // And the retry that would settle it is offered.
    expect(within(uncertain).getByRole("button", { name: zh.saveRetry })).toBeEnabled();
  });

  it("says that this press was refused, not only that the record is unreadable", async () => {
    mount({ unusable: "unsupportedVersion" });
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    await waitFor(() => expect(within(dialog).getAllByRole("alert")).toHaveLength(2));
    const refused = within(dialog).getAllByRole("alert")[1]!;
    expect(refused.dataset.save).toBe("refused");
    expect(refused).toHaveTextContent(zh.saveRefusedTitle);
    expect(refused).toHaveTextContent(zh.storedUnsupportedVersion);
  });

  it("gives the keyboard to the explanation the recovery actions are in", async () => {
    mount({ failWith: { problem: "notWritten", retryable: true } });
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    // Pressing Apply disables it, which is what blurs it. Modelled, because
    // jsdom keeps a disabled control focused.
    const apply = within(dialog).getByRole("button", { name: zh.apply });
    apply.focus();
    fireEvent.click(apply);
    // jsdom keeps a disabled control focused and then refuses to blur it, so
    // the browser's own blur-on-disable is modelled the way the rest of this
    // suite models it.
    blurAsABrowserWould(apply);
    const failure = await within(dialog).findByRole("alert");
    // The alert, rather than one of its buttons: the explanation comes before
    // the decision, and which action to take stays the reader's.
    await waitFor(() => expect(failure).toHaveFocus());
    expect(within(failure).getByRole("button", { name: zh.saveRetry })).toBeEnabled();
  });
});

describe("an apply that had nowhere to write", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("applies on the first press, and says which kind of application it was", async () => {
    // The store is healthy when the dialog opens and answers `unavailable` to
    // the write. The first press used to leave the draft unapplied -- a no-op
    // the footer then reported as a session-only application -- and the second
    // press was the one that worked.
    const sent: PreferenceWriteRequest[] = [];
    const failing: FakePreferencesApi = {
      ...createFakePreferencesApi(),
      requests: sent,
      savePreferences: request => {
        sent.push(request);
        return Promise.resolve({ outcome: "unavailable", problem: "rootUnresolved", revision: 0 });
      },
    };
    const api = createFakePreviewApi({ availability: unavailableBackend });
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreferencesApiProvider value={failing}>
        <PreviewApiProvider value={api}><App /></PreviewApiProvider>
      </PreferencesApiProvider>
    </WorkspaceDropTransportProvider>);
    await screen.findByText(en.backendMissing);

    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(preferenceRegion()).toHaveTextContent(zh.sessionOnlyApplied);
    expect(sent).toHaveLength(1);
    // Reopening shows the applied value, not a draft that was never applied.
    expect(within(openSettings()).getByRole("radio", { name: zh.simplifiedChinese })).toBeChecked();
  });
});

describe("a session fact a Cancel used to erase", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("keeps saying what a restart will use after the dialog is cancelled", async () => {
    mount({ failWith: { problem: "notWritten", retryable: true } });
    await screen.findByText(en.backendMissing);
    let dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    await within(dialog).findByRole("alert");
    press(dialog, zh.saveSessionOnly);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = openSettings();
    expect(footer()).toHaveTextContent(zh.sessionOnlyNote);
    press(dialog, zh.cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The session is still running on preferences that were never written, and
    // the only surface that said so used to be cleared by this Cancel.
    expect(within(openSettings()).getByText(zh.sessionOnlyNote)).toBeVisible();
  });
});

describe("a retry that could not have worked", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("retries the confirmed replacement as a confirmed replacement", async () => {
    const { preferences } = mount({
      unusable: "unsupportedVersion",
      failWith: { problem: "notWritten", retryable: true },
    });
    await screen.findByText(en.backendMissing);
    const dialog = openSettings();
    press(dialog, en.storedReplace);
    const failure = await within(dialog).findByRole("alert", { name: "" }).catch(() => null);
    void failure;
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(1));
    expect(preferences.requests[0]?.replaceUnusable).toBe(true);

    preferences.recover();
    press(dialog, en.saveRetry);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The confirmation travelled with the retry, so the record this build
    // refused was actually replaced. Without it Rust refuses the retry and the
    // button can never work.
    expect(preferences.requests[1]?.replaceUnusable).toBe(true);
    expect(preferences.stored()).not.toBeNull();
    expect(preferenceRegion()).toHaveTextContent(en.storedReplaced);
  });
});

describe("a read that never arrived", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("is not treated as a store that does not exist", async () => {
    const { preferences } = mount({ readRejects: true });
    await screen.findByText(en.backendMissing);
    await waitFor(() => expect(rosterToggle()).toBeEnabled());
    const dialog = openSettings();
    expect(within(dialog).getByText(en.storageReadFailed)).toBeVisible();
    expect(within(dialog).getByText(en.storageReadFailedNote)).toBeVisible();

    // The store may be perfectly healthy: a dropped call is not a missing root,
    // and a save is still attempted rather than suppressed for the session.
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(preferences.requests).toHaveLength(1);
    expect(preferences.stored()?.appearance.locale).toBe("zh-CN");
  });

  it("stops gating the controls once the wait has gone on too long", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { preferences } = mount({ deferred: true });
    await vi.waitFor(() => expect(document.querySelector(".workbench-shell")).not.toBeNull());
    // Gated to begin with, which is the contract: no default is written and no
    // editor acts before the read resolves. The control is refused rather than
    // taken out of the tab order, so the reason is reachable without a pointer.
    expect(rosterToggle()).toHaveAttribute("aria-disabled", "true");
    expect(rosterToggle()).toHaveAttribute("title", en.panelsLoading);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
    // Bounded. Settings and the toggles are usable again, on the defaults, with
    // an accurate reason -- rather than inert for the rest of the session.
    expect(rosterToggle()).toBeEnabled();
    expect(rosterToggle()).not.toHaveAttribute("aria-disabled");
    const dialog = openSettings();
    expect(within(dialog).getByText(en.storageReadTimedOut)).toBeVisible();
    expect(within(dialog).getByRole("radio", { name: en.english })).toBeEnabled();
    press(dialog, en.cancel);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // And the read is still allowed to answer: a slow answer is still the truth
    // about the store.
    await preferences.release();
    await vi.waitFor(() => expect(rosterToggle()).toBeEnabled());
  });
});

describe("one press, one publish", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("publishes a panel toggle once under StrictMode", async () => {
    // The publish used to be issued from inside a `setState` updater, which
    // React is entitled to call twice -- and `main.tsx` wraps the application
    // in `StrictMode`, so every toggle wrote twice in development and only the
    // second answer was honoured.
    const { preferences } = mount({}, true);
    await screen.findByText(en.backendMissing);
    await waitFor(() => expect(rosterToggle()).toBeEnabled());
    fireEvent.click(rosterToggle());
    await waitFor(() => expect(preferences.requests).toHaveLength(1));
    expect(preferences.requests[0]).toEqual({ layout: { roster: "hidden", details: "automatic" } });
    expect(shell()).toHaveAttribute("data-roster-open", "false");
  });
});

describe("a stale answer from the other lane", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("does not put the recovery alert back over a record that was just written", async () => {
    // Both lanes are serialized in Rust and delivered independently, so a
    // refusal decided before a commit can arrive after it. The refusal carries
    // the revision it was decided at, and one lower than the highest adopted
    // describes a store this session has moved past.
    const sent: PreferenceWriteRequest[] = [];
    const answers: ((value: unknown) => void)[] = [];
    const ordered: FakePreferencesApi = {
      ...createFakePreferencesApi(),
      requests: sent,
      savePreferences: request => {
        sent.push(request);
        if (request.layout !== undefined && request.appearance === undefined) {
          // The layout commit, refused at revision 0.
          return new Promise(settle => {
            answers.push(() => settle({
              outcome: "storedRecordUnusable", problem: "malformed", revision: 0,
            }));
          });
        }
        return Promise.resolve({
          outcome: "saved",
          revision: 1,
          preferences: storedRecord({ appearance: { locale: "zh-CN" } }),
        });
      },
    };
    const api = createFakePreviewApi({ availability: unavailableBackend });
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreferencesApiProvider value={ordered}>
        <PreviewApiProvider value={api}><App /></PreviewApiProvider>
      </PreferencesApiProvider>
    </WorkspaceDropTransportProvider>);
    await screen.findByText(en.backendMissing);
    await waitFor(() => expect(rosterToggle()).toBeEnabled());

    fireEvent.click(rosterToggle());
    await waitFor(() => expect(answers).toHaveLength(1));

    const dialog = openSettings();
    choose(dialog, en.simplifiedChinese);
    press(dialog, zh.apply);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.lang).toBe("zh-CN");

    // The stale refusal is delivered last.
    await act(async () => { answers[0]?.(undefined); await Promise.resolve(); });
    // It describes revision 0 and the session has adopted revision 1, so it
    // does not get to report the store as unreadable again.
    expect(within(openSettings()).queryByText(zh.storedUnusableTitle)).toBeNull();
    expect(footer()).toHaveTextContent(zh.storageSaved);
  });
});

describe("the panel reset and its own control", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("keeps the keyboard and announces what it did", async () => {
    mount({ stored: storedRecord({ layout: { roster: "hidden", details: "automatic" } }) });
    await screen.findByText(en.backendMissing);
    const reset = await screen.findByRole("button", { name: en.layoutReset });
    await waitFor(() => expect(reset).toBeEnabled());
    reset.focus();
    fireEvent.click(reset);
    // Refused rather than removed, and refused in a way that keeps the reader
    // where they are: activating it is what makes it redundant, and a browser
    // blurs a control it has just `disabled`, which would leave a keyboard
    // user on the body with their next Tab starting from the top of the page.
    // `aria-disabled` keeps the focus and still announces the state.
    await waitFor(() => expect(reset).toHaveAttribute("aria-disabled", "true"));
    expect(reset.isConnected).toBe(true);
    expect(reset).toHaveFocus();
    // The one panel action with nothing left on screen to read.
    expect(layoutRegion()).toHaveTextContent(en.layoutResetDone);
  });
});

describe("a layout retry with nowhere to write", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("does not report itself as having worked", async () => {
    let answer: "failed" | "unavailable" = "failed";
    const sent: PreferenceWriteRequest[] = [];
    const shifting: FakePreferencesApi = {
      ...createFakePreferencesApi(),
      requests: sent,
      savePreferences: request => {
        sent.push(request);
        return Promise.resolve(answer === "failed"
          ? { outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false, revision: 0 }
          : { outcome: "unavailable", problem: "rootUnresolved", revision: 0 });
      },
    };
    const api = createFakePreviewApi({ availability: unavailableBackend });
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreferencesApiProvider value={shifting}>
        <PreviewApiProvider value={api}><App /></PreviewApiProvider>
      </PreferencesApiProvider>
    </WorkspaceDropTransportProvider>);
    await screen.findByText(en.backendMissing);
    await waitFor(() => expect(rosterToggle()).toBeEnabled());

    fireEvent.click(rosterToggle());
    const retry = await screen.findByRole("button", { name: en.layoutRetry });
    // The store becomes unavailable, which the layout lane answers without a
    // request. It used to clear the claim, so the retry read as having worked.
    answer = "unavailable";
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("button", { name: en.layoutRetry })).toBeNull());
    // The claim stands: nothing was written, and the arrangement still will not
    // survive a restart. Only the retry is withdrawn, because there is now
    // nowhere for it to write.
    expect(screen.getByText(en.layoutUnsaved, { selector: "span" })).toBeVisible();
    expect(layoutRegion()).toHaveTextContent(en.layoutUnsaved);
  });
});

describe("the banner across its own request", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("keeps one live region and one help disclosure through checking", async () => {
    const api = createFakePreviewApi({ availability: unavailableBackend });
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreferencesApiProvider value={createFakePreferencesApi()}>
        <PreviewApiProvider value={api}><App /></PreviewApiProvider>
      </PreferencesApiProvider>
    </WorkspaceDropTransportProvider>);
    await screen.findByText(en.backendMissing);
    const region = document.querySelector(".backend-status-reading")!;
    const help = document.querySelector("[data-backend-help]")!;

    fireEvent.click(document.querySelector('[data-backend-action="recheck"]')!);
    await waitFor(() => expect(screen.getByText(en.backendChecking)).toBeVisible());
    // The same nodes. Two branches returning different element types inserted a
    // new region already containing its text, which is the one mutation screen
    // readers do not announce -- so a recheck and its verdict were both silent,
    // and a reader with focus in the help lost their place.
    expect(document.querySelector(".backend-status-reading")).toBe(region);
    expect(document.querySelector("[data-backend-help]")).toBe(help);
    await waitFor(() => expect(screen.getByText(en.backendMissing)).toBeVisible());
    expect(document.querySelector(".backend-status-reading")).toBe(region);
    expect(document.querySelector("[data-backend-help]")).toBe(help);
  });

  it("offers a way to ask again even while a check is running", async () => {
    // A check that ends without producing a verdict left this banner reading
    // "checking" with no control of any kind and no way to restart it.
    // Held, so the `checking` state can be read rather than raced against a
    // verdict that resolves in the same microtask.
    const check = deferred<typeof unavailableBackend>();
    let first = true;
    const api = createFakePreviewApi({
      availability: () => {
        if (!first) return check.promise;
        first = false;
        return Promise.resolve(unavailableBackend);
      },
    });
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreferencesApiProvider value={createFakePreferencesApi()}>
        <PreviewApiProvider value={api}><App /></PreviewApiProvider>
      </PreferencesApiProvider>
    </WorkspaceDropTransportProvider>);
    await screen.findByText(en.backendMissing);
    fireEvent.click(document.querySelector('[data-backend-action="recheck"]')!);
    await waitFor(() => expect(screen.getByText(en.backendChecking)).toBeVisible());
    // All three ways out are in the document, refused for the length of the
    // request. A check that ends without producing a verdict used to leave this
    // banner reading "checking" with no control of any kind.
    for (const action of ["recheck", "choose", "automatic"]) {
      const control = document.querySelector(`[data-backend-action="${action}"]`);
      expect(control, action).not.toBeNull();
      expect(control, action).toBeDisabled();
    }
    await act(async () => { check.resolve(unavailableBackend); await Promise.resolve(); });
  });
});
