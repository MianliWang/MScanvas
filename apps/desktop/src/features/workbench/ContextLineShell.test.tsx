/**
 * The context line in the real application composition.
 *
 * `shellContext.test.ts` covers what each item says. This drives the shell
 * around it: that an item only changes the surface, that what the Project
 * surface is inspecting survives a trip to another surface and back, and that
 * the navigation the rest of the suite finds by name is still found by it.
 *
 * Controlled fakes stand in for Rust at the API boundary, as in the other shell
 * tests; nothing here reads a file or runs a provider.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { UI_RESOURCES } from "../preferences/i18n";
import { NO_PROJECT, ProjectApiProvider, type ProjectState } from "../project/projectApi";
import { capturedProject, createFakeProjectApi } from "../../test/projectFixtures";

const en = UI_RESOURCES.en;

/** A roomy window: no panel folds for space, so every surface keeps its region. */
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

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

function renderShell(project: ProjectState) {
  restoreViewport = installRoomyViewport();
  const projects = createFakeProjectApi(project);
  render(
    <PreferencesApiProvider value={createFakePreferencesApi({ stored: storedRecord() })}>
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

function contextItem(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-shell-context="${id}"]`);
  if (element === null) throw new Error(`no context item ${id}`);
  return element;
}

function currentSurface(): string | null {
  return document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null;
}

describe("the context line in the application shell", () => {
  it("says no project is open, and takes the reader to the Project surface without asking anything", async () => {
    const projects = renderShell(NO_PROJECT);
    const group = await screen.findByRole("group", { name: en.shellContextRegion });
    await waitFor(() => expect(within(group).getByText("Project: none open")).toBeTruthy());
    expect(currentSurface()).toBe("workbench");

    const before = [...projects.calls];
    await press(contextItem("project"));

    expect(currentSurface()).toBe("project");
    expect(
      screen.getByRole("button", { name: en.projectSurface }).getAttribute("aria-current"),
    ).toBe("page");
    // Navigation only: no project operation began, and nothing was re-read.
    expect(projects.calls).toEqual(before);
  });

  it("names the open project from the session the Project surface holds", async () => {
    renderShell(capturedProject());
    await waitFor(() => expect(contextItem("project").textContent).toBe("Project: Test project"));
  });

  it("keeps what is inspected across a trip to the Workbench, and goes back to it", async () => {
    const projects = renderShell(capturedProject());
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));
    await waitFor(() =>
      expect(contextItem("inspecting").textContent).toBe("Inspecting: QC_pool_01.mzML"),
    );

    const before = [...projects.calls];
    await press(screen.getByRole("button", { name: en.workbench }));
    expect(currentSurface()).toBe("workbench");
    // Still inspected: another surface is a view, not a reason to forget.
    expect(contextItem("inspecting").textContent).toBe("Inspecting: QC_pool_01.mzML");

    await press(contextItem("inspecting"));
    expect(currentSurface()).toBe("project");
    expect(document.querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("input");
    expect(projects.calls).toEqual(before);
  });

  it("leaves every navigation control's accessible name as it was", async () => {
    renderShell(capturedProject());
    await screen.findByRole("group", { name: en.shellContextRegion });
    // Each still found exactly once by its own name, so the context line did
    // not add a second control that answers to it.
    expect(screen.getAllByRole("button", { name: en.workbench })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: en.projectSurface })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Conversion & results/ })).toHaveLength(1);
  });
});
