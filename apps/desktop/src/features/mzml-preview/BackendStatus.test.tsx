import { renderWithPreferences as render } from "../../test/renderWithPreferences";
/**
 * Where the keyboard is across the native folder picker.
 *
 * Every banner action is refused, not disabled, for the whole request (UI-24):
 * it stays focused and in the tab order, says why it waits, and a press while
 * it waits sends nothing. These tests drive the real workspace through the same
 * fake `PreviewApi` the rest of the suite uses, so the busy guard and the
 * one-request-at-a-time rule are the real ones rather than a stand-in.
 */

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import type { BackendAvailability } from "./contracts";
import { PreviewWorkspace } from "./PreviewWorkspace";
import {
  chosenFolderWithoutTools,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  previewError,
  unavailableBackend,
} from "../../test/previewFixtures";
import { showBackendBanner } from "../../test/backendBanner";
import { UI_RESOURCES } from "../preferences/i18n";

const en = UI_RESOURCES.en;

function renderWorkspace(api: PreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <PreviewWorkspace />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** Presses a control the way a keyboard user reaches it: focused, then activated. */
function activate(control: HTMLElement): void {
  control.focus();
  expect(control).toHaveFocus();
  fireEvent.click(control);
}

describe("keyboard focus across the native folder picker", () => {
  it("keeps Choose folder… focused and refused, with its reason, until the picker settles", async () => {
    const picker = deferred<BackendAvailability | null>();
    let requests = 0;
    const api = createFakePreviewApi({
      chosenInstallation: () => {
        requests += 1;
        return requests === 1 ? picker.promise : Promise.resolve(null);
      },
    });
    renderWorkspace(api);
    await showBackendBanner();
    const choose = await screen.findByRole("button", { name: en.backendChoose });

    activate(choose);
    // Outstanding: refused, still the reader's place, and saying why.
    await waitFor(() => expect(choose).toHaveAttribute("aria-disabled", "true"));
    expect(choose).toHaveFocus();
    expect(choose).toHaveAccessibleDescription(en.backendCheckingInstallation);
    // A press while it waits asks nothing.
    fireEvent.click(choose);
    expect(requests).toBe(1);

    await act(async () => {
      picker.resolve(null);
      await Promise.resolve();
    });
    await waitFor(() => expect(choose).not.toHaveAttribute("aria-disabled"));
    expect(choose).toHaveFocus();

    // And it works again with no trip back through the tab order.
    fireEvent.click(choose);
    await waitFor(() => expect(requests).toBe(2));
  });

  it("keeps Choose a different folder… focused when the folder chosen is unusable too", async () => {
    let requests = 0;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: () => {
        requests += 1;
        return Promise.resolve(chosenFolderWithoutTools);
      },
    });
    renderWorkspace(api);
    fireEvent.click(await screen.findByRole("button", { name: en.backendChoose }));
    const chooseAnother = await screen.findByRole("button", { name: "Choose a different folder…" });

    activate(chooseAnother);
    await waitFor(() => expect(requests).toBe(2));
    await waitFor(() => expect(chooseAnother).not.toHaveAttribute("aria-disabled"));
    expect(chooseAnother).toHaveFocus();
    expect(screen.getByText(/has neither msconvert.exe nor msaccess.exe/)).toBeVisible();
  });

  it("does not move the keyboard onto the action that took the trigger's place", async () => {
    // Each action is keyed by its semantic identity, so a verdict that offers
    // different actions replaces the node rather than relabelling it: the
    // keyboard is never one Enter away from undoing the choice just made.
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: chosenFolderWithoutTools,
    });
    renderWorkspace(api);
    await screen.findByText("No ProteoWizard installation was found");
    const choose = screen.getByRole("button", { name: en.backendChoose });
    expect(choose.dataset.backendAction).toBe("choose");

    activate(choose);

    await screen.findByRole("button", { name: "Choose a different folder…" });
    expect(choose.isConnected).toBe(false);
    const automatic = screen.getByRole("button", { name: "Search automatically" });
    expect(automatic.dataset.backendAction).toBe("automatic");
    expect(automatic).not.toHaveFocus();
  });

  it("keeps the keyboard on the chooser when the picker itself failed", async () => {
    // The failed banner offers the same ways forward, the pressed one in the
    // same place meaning the same thing, so the reader stays on it.
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: () => Promise.reject(previewError({ kind: "folder_picker_failed" })),
    });
    renderWorkspace(api);
    await screen.findByText("No ProteoWizard installation was found");
    const choose = screen.getByRole("button", { name: en.backendChoose });

    activate(choose);

    expect(await screen.findByText("MSCanvas could not check the backend")).toBeVisible();
    expect(choose.isConnected).toBe(true);
    expect(screen.getByRole("button", { name: en.backendChoose })).toBe(choose);
    await waitFor(() => expect(choose).not.toHaveAttribute("aria-disabled"));
    expect(choose).toHaveFocus();
  });
});
