/**
 * The offline setup help, in the real workspace.
 *
 * What it has to be is reachable: with no dataset, with no usable backend, and
 * with no network. And what it has to not be is a gate -- a session without
 * ProteoWizard can still build and organise the list it is about.
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { showBackendBanner } from "../../test/backendBanner";
import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { PreviewWorkspace } from "./PreviewWorkspace";
import { UI_RESOURCES } from "../preferences/i18n";
import {
  availableBackend,
  chosenFolderWithoutTools,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  previewError,
  quarantinedBackend,
  unavailableBackend,
} from "../../test/previewFixtures";
import type { BackendAvailability } from "./contracts";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

function renderWorkspace(api: PreviewApi) {
  return render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <PreviewWorkspace />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** The setup help's disclosure button, and the region it shows. */
const help = () => document.querySelector<HTMLButtonElement>("[data-backend-help]");
const helpRegion = () => document.getElementById(help()!.getAttribute("aria-controls")!)!;
const helpOpen = () => help()?.getAttribute("aria-expanded") === "true";

describe("offline setup help", () => {
  it("is reachable in every backend state, with no dataset and no backend", async () => {
    for (const availability of [
      unavailableBackend,
      chosenFolderWithoutTools,
      quarantinedBackend,
      availableBackend,
    ]) {
      const view = renderWorkspace(createFakePreviewApi({ availability }));
      await waitFor(() => expect(help()).not.toBeNull());
      const disclosure = help()!;
      // With nothing to act on the banner is folded, and its help is one
      // press away in the header (PM9 L10); in every other state it shows.
      if (availability === availableBackend) {
        await showBackendBanner();
      }
      // Closed to begin with: it is help, not an interruption.
      expect(helpOpen()).toBe(false);
      expect(helpRegion()).not.toBeVisible();
      expect(disclosure).toHaveAccessibleName(en.backendHelpTitle);
      expect(disclosure).toBeVisible();
      view.unmount();
    }
  });

  it("is reachable while the first check is still running and after it fails", async () => {
    const checking = deferred<BackendAvailability>();
    const first = renderWorkspace(
      createFakePreviewApi({ availability: () => checking.promise }),
    );
    await screen.findByText(en.backendChecking);
    expect(help()).not.toBeNull();
    first.unmount();

    renderWorkspace(
      createFakePreviewApi({
        availability: () => Promise.reject(previewError({ kind: "preview_worker_unavailable" })),
      }),
    );
    await screen.findByText(en.backendRequestFailed);
    expect(help()).not.toBeNull();
  });

  it("explains what is the user's to install, how long a choice lasts, and the support target", async () => {
    renderWorkspace(createFakePreviewApi({ availability: unavailableBackend }));
    const disclosure = await waitFor(() => {
      const node = help();
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.click(disclosure);
    await waitFor(() => expect(helpOpen()).toBe(true));

    const said = helpRegion().textContent ?? "";
    // MSCanvas never downloads, installs or bundles a provider.
    expect(said).toContain(en.backendHelpProvider);
    // Which folder to choose. Since #158 Rust remembers a usable choice across
    // launches, so the help no longer claims a session-only lifetime.
    expect(said).toContain(en.backendHelpSessionScope);
    // The controls name themselves; the help does not restate them.
    expect(helpRegion().querySelector("ul")).toBeNull();
    // The approved support target, stated as a support target.
    expect(said).toContain("Windows 11 25H2 x64");
    // And what needs a backend at all.
    expect(said).toContain(en.backendHelpWithoutBackend);
  });

  it("does not gate the workspace or start any backend work", async () => {
    const api = createFakePreviewApi({ availability: unavailableBackend });
    renderWorkspace(api);
    const add = await screen.findByRole("button", { name: en.addFiles });
    await waitFor(() => expect(api.calls()).toContain("readConversionConfiguration"));
    const calls = [...api.calls()];

    // No dialog, no overlay, nothing modal: the help is a disclosure beside a
    // workspace that is already usable.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(add).not.toHaveAttribute("aria-disabled");

    fireEvent.click(help()!);
    await waitFor(() => expect(helpOpen()).toBe(true));
    expect(add).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("treegrid", { name: en.rosterTitle })).toBeVisible();
    // Reading help is not a request. Nothing was probed and nothing was stored.
    expect(api.calls()).toEqual(calls);
  });

  it("is bundled in Simplified Chinese as well, and keeps the target statement", async () => {
    renderWorkspace(createFakePreviewApi({ availability: unavailableBackend }));
    await waitFor(() => expect(help()).not.toBeNull());
    const settings = document.querySelector<HTMLButtonElement>("[data-settings-entry]")!;
    fireEvent.click(settings);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: en.simplifiedChinese }));
    fireEvent.click(within(dialog).getByRole("button", { name: zh.cancel }));
    // Cancelled, so the applied locale is still English: the preview is what
    // was being checked, and it is not the state this assertion needs.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const reopened = document.querySelector<HTMLButtonElement>("[data-settings-entry]")!;
    fireEvent.click(reopened);
    const again = screen.getByRole("dialog");
    fireEvent.click(within(again).getByRole("radio", { name: en.simplifiedChinese }));
    fireEvent.click(within(again).getByRole("button", { name: zh.apply }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const disclosure = help()!;
    expect(disclosure).toHaveAccessibleName(zh.backendHelpTitle);
    fireEvent.click(disclosure);
    await waitFor(() => expect(helpOpen()).toBe(true));
    const said = helpRegion().textContent ?? "";
    expect(said).toContain(zh.backendHelpProvider);
    expect(said).toContain(zh.backendHelpSessionScope);
    // Product identities and the support target stay original inside the
    // translated sentence.
    expect(said).toContain("Windows 11 25H2 x64");
    expect(said).toContain("ProteoWizard");
    // No English fallback left in a translated surface.
    expect(said).not.toContain(en.backendHelpProvider);
  });
});
