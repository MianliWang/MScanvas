/**
 * PM9.1's populated-state baseline in the real composition, with the PM9.2
 * context line on top of it.
 *
 * Synthetic and controlled: each scenario is the fakes' answer table from
 * `test/pm9Scenarios.tsx`. What this establishes, once run, is how the shipped
 * components behave in those states -- what the reader is told, and that moving
 * between surfaces keeps what the owners hold. It establishes nothing about a
 * provider, the analysis runtime or a real file.
 */

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UI_RESOURCES } from "../features/preferences/i18n";
import { renderPm9Scenario } from "../test/pm9Scenarios";

const en = UI_RESOURCES.en;
/** The targeted result every project scenario records (`targetedProject`). */
const RESULT = "eeeeeeee-7777-4111-8111-111111111111";

/** A roomy window: nothing folds for space, so every region keeps its place. */
function installRoomyViewport() {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: !query.includes("max-width: 1050px"),
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

function mount(...args: Parameters<typeof renderPm9Scenario>) {
  restoreViewport = installRoomyViewport();
  return renderPm9Scenario(...args);
}

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

function contextItem(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-shell-context="${id}"]`);
}

function surface(): string | null {
  return document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null;
}

/** Each roster row as the reader's state leaves it: order, highlight, membership. */
function rosterState() {
  return [...document.querySelectorAll<HTMLElement>(".grouped-roster [data-handle]")].map((row) => {
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    return [
      row.getAttribute("data-handle"),
      row.getAttribute("aria-selected"),
      row.classList.contains("is-active"),
      box === null ? null : box.checked,
    ];
  });
}

describe("PM9.1 populated-state baseline (synthetic, controlled)", () => {
  it("renders the first-run state with a status bar that claims nothing", async () => {
    mount("empty");
    await screen.findByRole("button", { name: en.home });
    // No project and no work: no item to show. Working drop needs no
    // permanent hint (W1), so the bar says only what ProteoWizard is.
    expect(document.querySelector("[data-shell-context]")).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-backend-item]")).toHaveTextContent(en.backendStatusMissing));
    expect(document.querySelector(".workspace-drop-hint")).toBeNull();
  });

  it("keeps the roster exactly as it was across a trip to Conversion and back", async () => {
    mount("populated");
    // At least two rows on screen. Not six: the roster windows its rows by
    // measured height, and a test environment without layout measures none.
    await waitFor(() => expect(rosterState().length).toBeGreaterThan(1));
    // All workspace rows holds the vendor row, without checking anything.
    await press(screen.getByRole("button", { name: en.conversionTask }));
    fireEvent.click(await screen.findByRole("radio", { name: en.m74CnvAll }));
    await press(screen.getByRole("button", { name: en.home }));
    const before = rosterState();

    await press(screen.getByRole("button", { name: en.conversionTask }));
    expect(surface()).toBe("conversion");
    await press(screen.getByRole("button", { name: en.home }));
    expect(surface()).toBe("workbench");

    // The same rows, in the same order, with the same highlight and the same
    // conversion membership: navigation changed what is shown, not what is held.
    expect(rosterState()).toEqual(before);
  });

  it("shows a conversion under way in the status bar and the navigation", async () => {
    mount("converting");
    await waitFor(() =>
      expect(contextItem("conversionActivity")?.textContent).toBe("In progress: Conversion running"),
    );
    expect(document.querySelector(".workbench-navigation .work-status-dot")).toBeTruthy();
    // No project work: the project's own dot is absent.
    expect(document.querySelector("[data-project-work-dot]")).toBeNull();

    await press(contextItem("conversionActivity")!);
    expect(surface()).toBe("conversion");
    await waitFor(() => expect(document.querySelector(".conversion-running")).toBeInTheDocument());
  });

  it("says a stopped queue's report is retained, and takes the reader to it", async () => {
    mount("conversionEnded");
    await waitFor(() =>
      expect(contextItem("conversionActivity")?.textContent).toBe("Conversion queue ended: results retained"),
    );
    await press(contextItem("conversionActivity")!);
    expect(surface()).toBe("conversion");
  });

  it.each([
    ["projectWithResult", "available"],
    ["resultPayloadMissing", "payloadMissing"],
    ["resultPayloadCorrupt", "payloadCorrupt"],
  ] as const)(
    "reads the stored result report in the %s scenario with no converter and no source read",
    async (scenario, availability) => {
      mount(scenario);
      await waitFor(() => expect(contextItem("project")?.textContent).toBe("Project: Test project"));
      await press(contextItem("project")!);
      expect(surface()).toBe("project");

      const inspect = await waitFor(() => {
        const button = document.querySelector<HTMLElement>(`[data-project-inspect-artifact="${RESULT}"]`);
        if (button === null) throw new Error("no inspectable result yet");
        return button;
      });
      await press(inspect);

      await waitFor(() =>
        expect(
          document.querySelector(`[data-targeted-report="${RESULT}"]`)?.getAttribute("data-availability"),
        ).toBe(availability),
      );
    },
  );
});
