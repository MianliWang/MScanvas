/**
 * Where the keyboard is after the native folder picker closes.
 *
 * The banner disables every action for the whole request, the picker's modal
 * lifetime included, and disabling the focused button is what takes the
 * keyboard away from it. These tests drive the real workspace through the same
 * fake `PreviewApi` the rest of the suite uses, so the busy guard and the
 * one-request-at-a-time rule are the real ones rather than a stand-in.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type { BackendAvailability } from "./contracts";
import { PreviewWorkspace } from "./PreviewWorkspace";
import {
  chosenBackend,
  chosenFolderWithoutTools,
  createFakePreviewApi,
  deferred,
  unavailableBackend,
} from "../../test/previewFixtures";

function renderWorkspace(api: PreviewApi): void {
  render(
    <PreviewApiProvider value={api}>
      <PreviewWorkspace />
    </PreviewApiProvider>,
  );
}

/**
 * The blur a browser performs when the focused control becomes disabled.
 *
 * That blur is the whole defect, so a test that did not reproduce it would
 * assert against a focus the real application has already lost. jsdom keeps a
 * disabled control focused and then refuses to blur it -- an unfocusable
 * element cannot be blurred -- so the control is briefly enabled to move the
 * keyboard off it and set back exactly as it was. React owns the attribute from
 * `busy` and is not consulted in between.
 */
function blurAsABrowserWould(control: HTMLElement): void {
  const button = control as HTMLButtonElement;
  const disabled = button.disabled;
  button.disabled = false;
  button.blur();
  button.disabled = disabled;
  expect(document.body).toHaveFocus();
}

/** Presses a control the way a keyboard user reaches it: focused, then activated. */
function activate(control: HTMLElement): void {
  control.focus();
  expect(control).toHaveFocus();
  fireEvent.click(control);
}

/**
 * Something else focusable, outside the banner.
 *
 * Every banner action is disabled while a request runs, so a control the user
 * could move to during one has to be brought in from outside. What it stands
 * for is real enough: focus that went somewhere deliberately must not be taken
 * back.
 */
function focusableElsewhere(): HTMLButtonElement {
  const other = document.createElement("button");
  other.textContent = "somewhere else";
  document.body.append(other);
  return other;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("keyboard focus across the native folder picker", () => {
  it("gives the keyboard back to Choose folder… when the picker is cancelled", async () => {
    const picker = deferred<BackendAvailability | null>();
    let requests = 0;
    const api = createFakePreviewApi({
      chosenInstallation: () => {
        requests += 1;
        return requests === 1 ? picker.promise : Promise.resolve(null);
      },
    });
    renderWorkspace(api);
    const choose = await screen.findByRole("button", { name: "Choose folder…" });

    activate(choose);
    // Watched from here, so the test's own way of reaching the control is not
    // mistaken for the component giving it back.
    const focusing = vi.spyOn(choose, "focus");

    // The request is outstanding: the action is closed and the keyboard has
    // gone with it.
    expect(choose).toBeDisabled();
    blurAsABrowserWould(choose);

    // Nothing is restored while the request is still running. Doing so would
    // put the keyboard on a control that cannot be used and would say the
    // installation work had finished when it had not.
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body).toHaveFocus();

    await act(async () => {
      picker.resolve(null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(choose).toHaveFocus();
    });
    expect(choose).toBeEnabled();
    // Without `preventScroll`, giving the keyboard back could also move the
    // workspace under the user.
    expect(focusing).toHaveBeenCalledWith({ preventScroll: true });
    // Cancelling changed nothing else: the verdict it had is the verdict it has.
    expect(screen.getByText(/ProteoWizard is available/)).toHaveTextContent("3.0.25000");
    expect(screen.queryByText(/from the folder you chose/)).toBeNull();

    // And the restored control works: activating it again opens the picker
    // again, with no trip back through the tab order.
    fireEvent.click(choose);
    await waitFor(() => {
      expect(requests).toBe(2);
    });
  });

  it("gives the keyboard back to Choose a different folder… when the picker is cancelled", async () => {
    const cancelled = deferred<BackendAvailability | null>();
    let requests = 0;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: () => {
        requests += 1;
        if (requests === 1) {
          return Promise.resolve(chosenFolderWithoutTools);
        }
        return requests === 2 ? cancelled.promise : Promise.resolve(null);
      },
    });
    renderWorkspace(api);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));

    // The chosen folder holds no installation, which is the state that offers a
    // different folder rather than a first one.
    const chooseAnother = await screen.findByRole("button", {
      name: "Choose a different folder…",
    });
    activate(chooseAnother);
    expect(chooseAnother).toBeDisabled();
    blurAsABrowserWould(chooseAnother);

    await act(async () => {
      cancelled.resolve(null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(chooseAnother).toHaveFocus();
    });
    // The chosen folder is still the chosen folder, and still unusable for the
    // same stated reason.
    expect(screen.getByText(/holds neither msconvert.exe nor msaccess.exe/)).toBeVisible();

    fireEvent.click(chooseAnother);
    await waitFor(() => {
      expect(requests).toBe(3);
    });
  });

  it("gives the keyboard back when the folder chosen turns out to be unusable too", async () => {
    // Cancelling is not the only outcome that leaves the chooser where it was.
    // A folder that is chosen and holds no installation re-renders this banner
    // in place: same control, same action, same reason to be there -- and the
    // keyboard user who reached it is owed their place back.
    let requests = 0;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: () => {
        requests += 1;
        return Promise.resolve(chosenFolderWithoutTools);
      },
    });
    renderWorkspace(api);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));
    const chooseAnother = await screen.findByRole("button", {
      name: "Choose a different folder…",
    });

    activate(chooseAnother);
    expect(chooseAnother).toBeDisabled();
    blurAsABrowserWould(chooseAnother);

    await waitFor(() => {
      expect(chooseAnother).toHaveFocus();
    });
    expect(requests).toBe(2);
    expect(chooseAnother).toBeEnabled();
    expect(screen.getByText(/holds neither msconvert.exe nor msaccess.exe/)).toBeVisible();
  });

  it("does not move the keyboard onto the action that replaced the trigger", async () => {
    // The banner keeps its shape when an automatic verdict becomes a chosen
    // one, so React keeps the button the picker was opened from and renames it.
    // `Search automatically` is one Enter away from undoing the choice that
    // just landed, and it is not what the user reached for.
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: chosenFolderWithoutTools,
    });
    renderWorkspace(api);
    await screen.findByText("ProteoWizard is not available");
    const choose = screen.getByRole("button", { name: "Choose folder…" });

    activate(choose);
    blurAsABrowserWould(choose);

    await screen.findByRole("button", { name: "Choose a different folder…" });
    expect(choose).toHaveTextContent("Search automatically");
    expect(screen.getByRole("button", { name: "Search automatically" })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("does not take the keyboard after a backend check the picker did not start", async () => {
    const api = createFakePreviewApi();
    renderWorkspace(api);
    await screen.findByText(/ProteoWizard is available/);

    // Checking replaces the banner with the neutral one, so this control leaves
    // the document and the keyboard is on the body with or without a browser's
    // blur-on-disable.
    activate(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
    });
    // A recheck is not a folder choice. Nothing here asked for the keyboard, so
    // nothing here may claim it.
    expect(document.body).toHaveFocus();
  });

  it("does not reach for a trigger the successful choice removed", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: chosenBackend,
    });
    renderWorkspace(api);
    await screen.findByText("ProteoWizard is not available");
    const choose = screen.getByRole("button", { name: "Choose folder…" });

    activate(choose);
    const focusing = vi.spyOn(choose, "focus");
    blurAsABrowserWould(choose);

    // The verdict changed, so the banner did too, and the button that opened
    // the picker is no longer in the document. It is not focused, and it is not
    // even asked: focusing a detached node is not a no-op worth relying on.
    expect(await screen.findByText(/ProteoWizard is available/)).toBeVisible();
    expect(choose.isConnected).toBe(false);
    expect(focusing).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("button", { name: "Search automatically" })).toBeEnabled();
  });

  it("leaves the keyboard where the user moved it during the request", async () => {
    const picker = deferred<BackendAvailability | null>();
    const api = createFakePreviewApi({ chosenInstallation: () => picker.promise });
    renderWorkspace(api);
    const choose = await screen.findByRole("button", { name: "Choose folder…" });

    activate(choose);
    blurAsABrowserWould(choose);

    // The keyboard is somewhere the user put it. Restoring over that would be a
    // move of its own, not a restoration.
    const elsewhere = focusableElsewhere();
    elsewhere.focus();
    expect(elsewhere).toHaveFocus();

    await act(async () => {
      picker.resolve(null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(choose).toBeEnabled();
    });
    expect(elsewhere).toHaveFocus();
    elsewhere.remove();
  });

  it("restores nothing when the control that opened the picker never held the keyboard", async () => {
    const api = createFakePreviewApi({ chosenInstallation: null });
    renderWorkspace(api);
    const choose = await screen.findByRole("button", { name: "Choose folder…" });

    // Activated without ever being focused. There is no place to give back, and
    // taking focus here would be a move of its own.
    fireEvent.click(choose);

    await waitFor(() => {
      expect(choose).toBeEnabled();
    });
    expect(document.body).toHaveFocus();
  });
});
