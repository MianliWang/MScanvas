/**
 * PM9.7 F3, the Workbench half: the empty evidence column names the route to
 * data -- the header's Acquisitions toggle, then the roster's Add files… -- in
 * the words those two controls carry, whether the roster is folded or not.
 *
 * The guidance is copy only. It never unfolds the roster and offers no second
 * Add files…: the fold stays the reader's, and the one action stays where it is.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { UI_RESOURCES } from "../features/preferences/i18n";
import { PreferencesApiProvider } from "../features/preferences/preferencesApi";
import { createFakePreferencesApi, storedRecord } from "../test/preferenceFixtures";
import { availableBackend, createFakePreviewApi, createFakeWorkspaceDropTransport } from "../test/previewFixtures";

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

const VENDOR_NOT_PREVIEWED = { en: "Vendor acquisitions are not previewed", "zh-CN": "厂商采集不提供预览" } as const;

describe.each(["en", "zh-CN"] as const)("the empty Workbench's route to data, %s", (locale) => {
  const words = UI_RESOURCES[locale];

  /** The empty Workbench on a usable backend, the state PM9.7 I1 observed. */
  async function mount(constrained: boolean) {
    restoreViewport = installViewport(constrained);
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreferencesApiProvider value={createFakePreferencesApi({ stored: storedRecord({ appearance: { locale } }) })}>
          <PreviewApiProvider value={createFakePreviewApi({ availability: availableBackend })}>
            <App />
          </PreviewApiProvider>
        </PreferencesApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    await waitFor(() => expect(document.documentElement.lang).toBe(locale));
    const toggle = screen.getByRole("button", { name: words.rosterToggle });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    const guidance = (await screen.findByText(words.emptyEvidence)).nextElementSibling as HTMLElement;
    return { toggle, guidance };
  }

  const addFiles = () => screen.queryAllByRole("button", { name: words.addFiles });

  it("names the header toggle while the roster is folded, and leaves it folded", async () => {
    const { toggle, guidance } = await mount(true);
    const text = guidance.textContent;
    // The nested labels resolved: the toggle's own words, not a resource key.
    expect(text).not.toContain("$t(");
    expect(text).toContain(toggle.textContent);
    expect(text).toContain(words.addFiles);
    // mzML is previewed; a vendor acquisition is not, and is for conversion.
    expect(text).toContain(VENDOR_NOT_PREVIEWED[locale]);
    // Copy, not an action: the roster is still folded and Add files… is not
    // offered anywhere else.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(addFiles()).toHaveLength(0);

    // The route it names is the route that exists.
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(addFiles()).toHaveLength(1);
    expect(text).toContain(addFiles()[0]!.textContent);
    // And unfolding leaves the same sentence standing.
    expect(guidance.textContent).toBe(text);
  });

  it("stays true with the roster already expanded", async () => {
    const { toggle, guidance } = await mount(false);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(addFiles()).toHaveLength(1);
    expect(guidance.textContent).not.toContain("$t(");
    expect(guidance.textContent).toContain(toggle.textContent);
    expect(guidance.textContent).toContain(addFiles()[0]!.textContent);
  });
});
