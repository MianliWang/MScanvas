/**
 * PM9.2's product convergence in the real composition: the surface titles and
 * primary actions (L1), the roster's action hierarchy (L9), the folded backend
 * banner (L10), the ranked context line (L14–L16) and the Details entry at a
 * 1366-class window (L20).
 *
 * Synthetic and controlled, like `Pm9Baseline.test.tsx`: each scenario is an
 * answer table from `test/pm9Scenarios.tsx`. jsdom has no layout, so nothing
 * here measures anything; widths, overflow and what stays on screen are the
 * rendered checks' (the PM9.1 browser spec's observation block).
 */

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UI_RESOURCES } from "../features/preferences/i18n";
import { renderPm9Scenario } from "../test/pm9Scenarios";

const en = UI_RESOURCES.en;

/**
 * A window of a given class, as `panelPresentation` measures it: roomy from
 * 1700px, constrained up to 1050px, and a 1366-class window in between, where
 * Details is closed by default.
 */
function installViewport(kind: "roomy" | "medium") {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: kind === "roomy" ? !query.includes("max-width: 1050px") : false,
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

function mount(name: Parameters<typeof renderPm9Scenario>[0], viewport: "roomy" | "medium" = "roomy") {
  restoreViewport = installViewport(viewport);
  return renderPm9Scenario(name);
}

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

function shell(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".workbench-shell");
  if (found === null) throw new Error("no shell");
  return found;
}

function backendToggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("[data-backend-toggle]");
}

/** The notices track's visible banners; a folded reading is not one. */
function shownNotices(): Element[] {
  return [...document.querySelectorAll(".shell-notices > .notice")];
}

/** Reads the first acquisition, as a reader would: focus its row, then Preview focused. */
async function readTheFirstAcquisition() {
  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.grouped-roster [data-handle="file-0"]');
    if (found === null) throw new Error("no row yet");
    return found;
  });
  await press(row);
  await press(screen.getByRole("button", { name: en.previewFocused }));
  await screen.findByRole("grid", { name: "Spectra" });
}

describe("PM9.2: the backend banner folds when there is nothing to act on (L10)", () => {
  it("keeps a usable installation's reading as a phrase in the header, and no band", async () => {
    mount("populated");
    await waitFor(() => expect(backendToggle()).not.toBeNull());
    const toggle = backendToggle()!;
    expect(toggle).toHaveAccessibleName(en.backendReadyShort);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "backend-status");
    // No banner takes a row, and its actions are out of the way...
    expect(shownNotices()).toEqual([]);
    expect(screen.queryByRole("button", { name: en.backendRecheck })).toBeNull();
    // ...while the reading is still the one live region, so a verdict is heard.
    const reading = document.querySelector('#backend-status [role="status"]');
    expect(reading).toHaveTextContent(en.backendAvailable);

    await press(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(shownNotices()).toHaveLength(1);
    expect(screen.getByRole("button", { name: en.backendRecheck })).toBeVisible();

    await press(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(shownNotices()).toEqual([]);
  });

  it("keeps a banner that has something to act on on screen, with no way to fold it", async () => {
    mount("empty");
    await screen.findByText("No ProteoWizard installation was found");
    expect(backendToggle()).toBeNull();
    expect(shownNotices()).toHaveLength(1);
    expect(screen.getByRole("button", { name: en.backendChoose })).toBeVisible();
  });
});

describe("PM9.2: each surface says what it is, and offers only its own next step (L1)", () => {
  it("titles every surface in the navigation's words, and keeps each region's name", async () => {
    mount("populated");
    const surfaces = [
      ["workbench", en.workbench],
      ["conversion", en.conversionTask],
      ["project", en.projectSurface],
    ] as const;
    for (const [target, name] of surfaces) {
      if (target !== "workbench") {
        await press(screen.getByRole("button", { name: target === "project" ? en.projectSurface : /^Conversion & results/ }));
      }
      await waitFor(() => expect(shell()).toHaveAttribute("data-surface", target));
      const titles = screen.getAllByRole("heading", { level: 1 });
      expect(titles.map((title) => title.textContent)).toEqual([name]);
      expect(screen.getByRole("region", { name })).toContainElement(titles[0]!);
    }
    // The titles are headings, not buttons: the navigation is still found once.
    expect(screen.getAllByRole("button", { name: en.workbench })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: en.projectSurface })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Conversion & results/ })).toHaveLength(1);
  });

  it("invents no primary action on a surface that has no owned next step", async () => {
    mount("empty");
    await screen.findByText("No ProteoWizard installation was found");
    // Nothing read and nothing retained: the evidence surface offers nothing.
    expect(document.querySelectorAll("#workbench-evidence .primary-button")).toHaveLength(0);
    await press(screen.getByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectNone);
    // With no project open, New project is the one owned next step (PM9.7 F2,
    // which replaced L1's New/Open equality); Open project stays beside it.
    const primary = document.querySelectorAll("#workbench-project .primary-button");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent(en.projectNew);
  });
});

describe("PM9.2: the roster's actions, quieter but all there (L9)", () => {
  it("keeps every action reachable by name, and marks the picked-row actions", async () => {
    mount("populated");
    for (const name of [en.addFiles, en.addFolder, en.previewFocused, en.removeHighlighted, en.clearList, en.newGroup]) {
      expect(await screen.findAllByRole("button", { name })).toHaveLength(1);
    }
    expect(screen.getByRole("button", { name: en.previewFocused })).toHaveAttribute("data-contextual");
    expect(screen.getByRole("button", { name: en.removeHighlighted })).toHaveAttribute("data-contextual");
    expect(screen.getByRole("button", { name: en.addFiles })).not.toHaveAttribute("data-contextual");
  });

  it("puts the selection count on the organizing row, after New group", async () => {
    mount("populated");
    await screen.findByRole("button", { name: en.newGroup });
    const toolbar = document.querySelector<HTMLElement>(".organization-toolbar")!;
    expect(toolbar.querySelector("button")).toHaveTextContent(en.newGroup);
    expect(within(toolbar).getByText(/highlighted/)).toHaveClass("roster-selection-context");
  });
});

describe("PM9.2: the context line by rank (L14–L16)", () => {
  it("ranks every item, and leaves the conversion scope out on the Project surface", async () => {
    mount("converting");
    await waitFor(() => expect(document.querySelector('[data-shell-context="conversionActivity"]')).not.toBeNull());
    const ranked = () =>
      [...document.querySelectorAll<HTMLElement>("[data-shell-context]")].map((item) => [
        item.getAttribute("data-shell-context"),
        item.getAttribute("data-priority"),
      ]);
    // The status comes first, and never gives way.
    expect(ranked()[0]).toEqual(["conversionActivity", "1"]);
    expect(ranked().some(([id]) => id === "conversionScope")).toBe(true);

    await press(screen.getByRole("button", { name: en.projectSurface }));
    await waitFor(() => expect(shell()).toHaveAttribute("data-surface", "project"));
    expect(ranked()[0]).toEqual(["conversionActivity", "1"]);
    expect(ranked().some(([id]) => id === "conversionScope")).toBe(false);
  });
});

describe("PM9.2: the Details entry at a 1366-class window (L20)", () => {
  it("stays in the tab order, says why while there is nothing to show, and opens once there is", async () => {
    mount("populated", "medium");
    const details = await screen.findByRole("button", { name: en.inspectorToggle });
    // Closed by default here, as recorded; the entry is what has to be findable.
    expect(shell()).toHaveAttribute("data-details-open", "false");
    expect(details).toHaveAttribute("aria-disabled", "true");
    expect(details).not.toBeDisabled();
    expect(details).toHaveAttribute("title", en.inspectorUnavailable);
    details.focus();
    expect(details).toHaveFocus();
    await press(details);
    expect(shell()).toHaveAttribute("data-details-open", "false");

    await readTheFirstAcquisition();
    // The same control, now usable, still closed until asked for.
    expect(screen.getByRole("button", { name: en.inspectorToggle })).toBe(details);
    expect(details).not.toHaveAttribute("aria-disabled");
    expect(shell()).toHaveAttribute("data-details-open", "false");
    await press(details);
    expect(shell()).toHaveAttribute("data-details-open", "true");
    expect(details).toHaveAttribute("aria-expanded", "true");
  });
});
