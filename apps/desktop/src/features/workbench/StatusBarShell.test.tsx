/**
 * The header's Project menu, the status bar and the narrow-window drawers in
 * the real application composition.
 *
 * `shellContext.test.ts` covers what each status item says. This drives the
 * shell around it: that an item only changes the surface, that the Project
 * menu acts with the Project surface's own actions and refusals, and that a
 * drawer is modal, folds on Esc and gives the keyboard back.
 *
 * Controlled fakes stand in for Rust at the API boundary, as in the other shell
 * tests; nothing here reads a file or runs a provider.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { PreviewApiProvider } from "../mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../mzml-preview/dropTransport";
import {
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  unavailableBackend,
} from "../../test/previewFixtures";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import { bindUiMessages, createUiRuntime, UI_RESOURCES } from "../preferences/i18n";
import { NO_PROJECT, ProjectApiProvider, type ProjectState } from "../project/projectApi";
import { capturedProject, createFakeProjectApi } from "../../test/projectFixtures";
import { openProjectSurface } from "../../test/projectMenu";
import { statusBusyReason, type BusyFlags } from "./StatusBar";

const en = UI_RESOURCES.en;

/** A window of the given kind: roomy keeps every panel a column; constrained makes them drawers. */
function installViewport(kind: "roomy" | "constrained") {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: kind === "constrained" ? query.includes("max-width: 1050px") : !query.includes("max-width: 1050px"),
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

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

function renderShell(project: ProjectState, locale: "en" | "zh-CN" = "en", viewport: "roomy" | "constrained" = "roomy") {
  restoreViewport = installViewport(viewport);
  const projects = createFakeProjectApi(project);
  render(
    <PreferencesApiProvider
      value={createFakePreferencesApi({ stored: storedRecord({ appearance: { locale } }) })}
    >
      <ProjectApiProvider value={projects}>
        <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
          <PreviewApiProvider value={createFakePreviewApi({ availability: unavailableBackend })}>
            <App />
          </PreviewApiProvider>
        </WorkspaceDropTransportProvider>
      </ProjectApiProvider>
    </PreferencesApiProvider>,
  );
  return projects;
}

function statusItem(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-shell-context="${id}"]`);
  if (element === null) throw new Error(`no status item ${id}`);
  return element;
}

function currentSurface(): string | null {
  return document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null;
}

async function openProjectMenu() {
  const trigger = await screen.findByRole("button", { name: en.projectSurface });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  return trigger;
}

describe("the status bar in the application shell", () => {
  it("says nothing about a project while none is open", async () => {
    renderShell(NO_PROJECT);
    await screen.findByRole("button", { name: en.projectSurface });
    expect(document.querySelector('[data-shell-context="project"]')).toBeNull();
  });

  it("names the open project and takes the reader to it without asking anything", async () => {
    const projects = renderShell(capturedProject());
    await waitFor(() => expect(statusItem("project")).toHaveAccessibleName("Project: Test project"));
    expect(currentSurface()).toBe("workbench");

    const before = [...projects.calls];
    await press(statusItem("project"));

    expect(currentSurface()).toBe("project");
    expect(screen.getByRole("button", { name: en.projectSurface })).toHaveAttribute("aria-current", "page");
    // The tabs say nothing is selected while the Project surface shows.
    expect(document.querySelector(".workbench-navigation [aria-current]")).toBeNull();
    // Navigation only: no project operation began, and nothing was re-read.
    expect(projects.calls).toEqual(before);
  });

  it("flags unsaved changes as a tag beside the name", async () => {
    renderShell({ ...capturedProject(), dirty: true });
    await waitFor(() => expect(statusItem("project")).toHaveAccessibleName(`Project: Test project ${en.statusUnsaved}`));
  });

  it("finds every navigation control exactly once by its own name", async () => {
    renderShell(capturedProject());
    await waitFor(() => expect(statusItem("project")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: en.workbench })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: en.projectSurface })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Conversion & results/ })).toHaveLength(1);
  });

  it("states the backend item's colour in words too, and shows the banner from it", async () => {
    renderShell(NO_PROJECT);
    const item = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-backend-item]");
      if (found === null || found.textContent !== en.backendStatusUnavailable) throw new Error("not read yet");
      return found;
    });
    expect(item.querySelector("[data-tone]")).toHaveAttribute("data-tone", "unavailable");
    // Nothing to fold: the banner has something to say, so this shows it.
    expect(item).not.toHaveAttribute("data-backend-toggle");
    await press(item);
    expect(document.querySelector("#backend-status")).toHaveFocus();
  });
});

describe("the Project menu", () => {
  it("shows the Project surface from its first item", async () => {
    const projects = renderShell(capturedProject());
    await openProjectSurface();
    expect(currentSurface()).toBe("project");
    expect(projects.calls).toEqual(["getProjectState"]);
  });

  it("keeps a refused action reachable, says why, and sends nothing", async () => {
    const projects = renderShell(NO_PROJECT);
    await openProjectMenu();
    const save = await screen.findByRole("menuitem", { name: en.projectSave });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAccessibleDescription(en.projectNone);
    await press(save);
    // Still open on the refusal, still on the Workbench, nothing asked of Rust.
    expect(screen.getByRole("menuitem", { name: en.projectSave })).toBeInTheDocument();
    expect(currentSurface()).toBe("workbench");
    expect(projects.calls).toEqual(["getProjectState"]);
  });

  it("acts with the Project surface's own action and shows that surface", async () => {
    const projects = renderShell(NO_PROJECT);
    await openProjectMenu();
    await press(await screen.findByRole("menuitem", { name: en.projectNew }));
    expect(currentSurface()).toBe("project");
    await waitFor(() => expect(projects.calls).toContain("createProject"));
  });
});

describe("drawers in a narrow window", () => {
  it("is modal while open, folds on Esc and gives the keyboard back to its toggle", async () => {
    renderShell(NO_PROJECT, "en", "constrained");
    const toggle = await screen.findByRole("button", { name: en.rosterToggle });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await press(toggle);
    const roster = document.getElementById("workbench-roster")!;
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The keyboard moves in; the evidence and the status bar are behind it.
    expect(roster.contains(document.activeElement)).toBe(true);
    expect(document.getElementById("workbench-evidence")).toHaveAttribute("inert");
    expect(document.querySelector(".workbench-status")).toHaveAttribute("inert");
    expect(document.querySelector("[data-drawer-scrim]")).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(roster, { key: "Escape" });
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(document.getElementById("workbench-evidence")).not.toHaveAttribute("inert");
  });

  it("folds when the scrim is pressed", async () => {
    renderShell(NO_PROJECT, "en", "constrained");
    const toggle = await screen.findByRole("button", { name: en.rosterToggle });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    await press(toggle);
    await press(document.querySelector<HTMLElement>("[data-drawer-scrim]")!);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("why workspace actions wait", () => {
  const t = bindUiMessages(createUiRuntime().instance.getFixedT("en", "ui"));
  const idle: BusyFlags = {
    backendBusy: false, pickerBusy: false, folderBusy: false, dropBusy: false,
    workspaceBusy: false, projectAdmitting: false, conversionBusy: false, rosterLoad: "ready",
  };

  it("says nothing when nothing waits", () => {
    expect(statusBusyReason(idle, t)).toBeNull();
  });

  it("names the first reason in the order the gates check them", () => {
    expect(statusBusyReason({ ...idle, folderBusy: true, workspaceBusy: true }, t)).toBe(en.folderBusy);
    expect(statusBusyReason({ ...idle, pickerBusy: true, folderBusy: true }, t)).toBe(en.statusBusyPicker);
    expect(statusBusyReason({ ...idle, projectAdmitting: true, rosterLoad: "loading" }, t)).toBe(en.statusBusyProject);
    expect(statusBusyReason({ ...idle, conversionBusy: true }, t)).toBe("conversion");
    expect(statusBusyReason({ ...idle, rosterLoad: "failed" }, t)).toBe(en.rosterFailed);
  });
});

/** The filled primaries on screen anywhere in the shell, by their text. */
function shownPrimaries(): (string | null)[] {
  return [...document.querySelectorAll(".workbench-shell .primary-button, .workbench-shell .ui-button--primary")]
    .filter((button) => button.closest("[hidden]") === null)
    .map((button) => button.textContent);
}

describe("the empty Project in the application shell", () => {
  it.each(["en", "zh-CN"] as const)(
    "has New project as the one filled action beside the open roster, in %s (PM9.7 F2)",
    async (locale) => {
      const words = UI_RESOURCES[locale];
      const projects = renderShell(NO_PROJECT, locale);
      const addFiles = await screen.findByRole("button", { name: words.addFiles });
      expect(currentSurface()).toBe("workbench");

      await openProjectSurface(words);
      await screen.findByText(words.projectNone);
      // One filled action across the whole screen, the roster included (UI-19):
      // Add files… gives up the accent, and stays offered.
      expect(shownPrimaries()).toEqual([words.projectNew]);
      expect(addFiles.closest("[hidden]")).toBeNull();
      expect(addFiles.getAttribute("aria-disabled")).toBeNull();
      // Emphasis only: nothing was created, opened or picked.
      expect(projects.calls).toEqual(["getProjectState"]);
    },
  );
});
