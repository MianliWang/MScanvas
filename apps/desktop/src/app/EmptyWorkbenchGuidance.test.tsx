/**
 * The empty Workbench's states (rebuild spec 3.6): what is missing, and the
 * buttons that fill it, in place of a paragraph that names other controls.
 *
 * The first run offers the acquisition actions in the evidence only while the
 * roster's own copies are off screen, so there is never a second Add files…
 * beside the first. A picked vendor row says what it is and offers its one
 * route, conversion.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { UI_RESOURCES } from "../features/preferences/i18n";
import { PreferencesApiProvider } from "../features/preferences/preferencesApi";
import { createFakePreferencesApi, storedRecord } from "../test/preferenceFixtures";
import type { SelectedFile } from "../features/mzml-preview/contracts";
import { availableBackend, createFakePreviewApi, createFakeWorkspaceDropTransport, selectedFile } from "../test/previewFixtures";

/** A fixed window: constrained below 1050 px, where the roster starts folded. */
function installViewport(constrained: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes("max-width: 1050px") ? constrained : false,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

let restoreViewport: (() => void) | null = null;

afterEach(() => {
  restoreViewport?.();
  restoreViewport = null;
});

const VENDOR_ROW: SelectedFile = { handle: "file-9", fileName: "run-9.raw", byteLength: 78_309, sourceKind: "thermo_raw", relativeContext: null };

function evidence(): HTMLElement {
  return document.getElementById("workbench-evidence")!;
}

describe.each(["en", "zh-CN"] as const)("the empty Workbench's states, %s", (locale) => {
  const words = UI_RESOURCES[locale];

  /** The empty Workbench on a usable backend. */
  async function mount(constrained: boolean, initialDatasets: readonly SelectedFile[] = []) {
    restoreViewport = installViewport(constrained);
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreferencesApiProvider value={createFakePreferencesApi({ stored: storedRecord({ appearance: { locale } }) })}>
          <PreviewApiProvider value={createFakePreviewApi({ availability: availableBackend, initialDatasets })}>
            <App />
          </PreviewApiProvider>
        </PreferencesApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    await waitFor(() => expect(document.documentElement.lang).toBe(locale));
    const toggle = screen.getByRole("button", { name: words.rosterToggle });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    await within(evidence()).findByText(words.emptyEvidence);
    return { toggle };
  }

  const addFiles = () => screen.queryAllByRole("button", { name: words.addFiles });

  it("offers the first run's actions in the evidence while the roster is folded", async () => {
    const { toggle } = await mount(true);
    await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "first-run"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // One Add files…, the filled one, and the folder and project routes beside it.
    expect(addFiles()).toHaveLength(1);
    expect(addFiles()[0]).toHaveClass("ui-button--primary");
    expect(within(evidence()).getByRole("button", { name: words.addFolder })).toBeVisible();
    expect(within(evidence()).getByRole("button", { name: words.projectOpen })).toBeVisible();
    // No paragraph explains the interface.
    expect(evidence().querySelector(".ui-empty-state__message span")).toBeNull();

    // Unfolded, the roster's own Add files… is the one on offer.
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(addFiles()).toHaveLength(1);
    expect(evidence().contains(addFiles()[0]!)).toBe(false);
  });

  it("leaves the acquisition actions to the roster while it is on screen", async () => {
    const { toggle } = await mount(false);
    await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "first-run"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(addFiles()).toHaveLength(1);
    expect(evidence().contains(addFiles()[0]!)).toBe(false);
    expect(within(evidence()).getByRole("button", { name: words.projectOpen })).toBeVisible();
  });

  it("states only the heading once rows are listed and none is picked", async () => {
    await mount(false, [selectedFile, VENDOR_ROW]);
    await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "idle"));
    expect(within(evidence()).queryAllByRole("button")).toHaveLength(0);
  });

  it("says what a picked vendor row is, and opens it in Conversion", async () => {
    await mount(false, [selectedFile, VENDOR_ROW]);
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`.grouped-roster [data-handle="${VENDOR_ROW.handle}"]`);
      if (found === null) throw new Error("no row yet");
      return found;
    });
    await act(async () => {
      fireEvent.click(row);
    });
    await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "vendor"));
    expect(within(evidence()).getByText(VENDOR_ROW.fileName)).toBeVisible();
    expect(within(evidence()).getByText(`Thermo RAW · ${words.needsConversion}`)).toBeVisible();

    await act(async () => {
      fireEvent.click(within(evidence()).getByRole("button", { name: words.openInConversion }));
    });
    expect(document.querySelector(".workbench-shell")).toHaveAttribute("data-surface", "conversion");
    // The pressed button left with the evidence; the keyboard followed.
    expect(document.getElementById("workbench-conversion")).toHaveFocus();
    // The row is checked for conversion; nothing was read.
    expect(within(row).getByRole("checkbox")).toBeChecked();
  });
});
