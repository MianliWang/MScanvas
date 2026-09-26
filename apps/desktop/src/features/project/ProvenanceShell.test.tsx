/**
 * The provenance consumer in the real application composition.
 *
 * `ProvenanceDetails.test.tsx` drives the panel; this drives the shell around
 * it -- the Details control, which region the panel lands in, and what the
 * responsive rules do with it. Both matter, and the second is where the
 * contextual region was previously unreachable from the Project surface: its
 * availability was a loaded acquisition and nothing else, so the control stayed
 * disabled exactly where provenance belongs.
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
import { capturedProject, createFakeProjectApi } from "../../test/projectFixtures";
import { ProjectApiProvider } from "./projectApi";

const en = UI_RESOURCES.en;
const RUN = "ffffffff-2222-4111-8111-111111111111";

/** A controllable viewport, so a breakpoint is a fact rather than a guess. */
function installViewport(initial: { constrained: boolean; roomy: boolean }) {
  const original = window.matchMedia;
  let current = initial;
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return query.includes("max-width: 1050px") ? current.constrained : current.roomy;
    },
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  })) as unknown as typeof window.matchMedia;
  return {
    restore() {
      window.matchMedia = original;
    },
    set(next: { constrained: boolean; roomy: boolean }) {
      current = next;
    },
  };
}

let viewport: ReturnType<typeof installViewport> | null = null;

afterEach(() => {
  viewport?.restore();
  viewport = null;
});

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

/**
 * The whole application, with a saved project and no provider at all.
 *
 * The provider is deliberately unavailable: provenance is recorded work over
 * local files, and it has to be reachable on a machine with no converter.
 */
function renderShell(fit: { constrained: boolean; roomy: boolean }) {
  viewport = installViewport(fit);
  const projects = createFakeProjectApi(capturedProject());
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

/** The contextual region the shell owns. */
function inspector(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#workbench-inspector");
  if (element === null) throw new Error("no inspector region");
  return element;
}

describe("provenance in the application shell", () => {
  it("enables Details on the Project surface once an object is inspected", async () => {
    renderShell({ constrained: false, roomy: true });
    await screen.findByRole("button", { name: en.projectSurface });

    // On the Workbench with no acquisition read there is nothing contextual to
    // show, and the control says so.
    const toggle = screen.getByRole("button", { name: en.inspectorToggle });
    expect(toggle.hasAttribute("disabled")).toBe(true);

    await press(screen.getByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    // Still nothing selected, so still nothing to describe.
    expect(screen.getByRole("button", { name: en.inspectorToggle }).hasAttribute("disabled")).toBe(
      true,
    );

    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));

    // Now there is, and the region is reachable.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.inspectorToggle }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("shows provenance in the contextual region at a roomy viewport", async () => {
    renderShell({ constrained: false, roomy: true });
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));

    // Roomy means the inspector is present without being asked for, so the
    // provenance is simply there.
    await waitFor(() => expect(inspector().hidden).toBe(false));
    expect(within(inspector()).getByText(en.provenanceKindInput)).toBeTruthy();
    expect(within(inspector()).getByRole("heading", { name: "QC_pool_01.mzML" })).toBeTruthy();
    // The evidence area stays the dominant region: provenance did not take it.
    expect(document.querySelector("#workbench-project")?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps provenance reachable through the existing Details control when it is not open", async () => {
    // Between the one-column breakpoint and the roomy one -- the reference
    // 1366x768 case -- the inspector waits to be asked for.
    renderShell({ constrained: false, roomy: false });
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));

    expect(inspector().hidden).toBe(true);
    // So the surface says where the answer went, and offers the shell's own
    // control rather than a second mechanism of its own.
    const hint = document.querySelector<HTMLElement>("[data-project-inspect-hint]");
    expect(hint).toBeTruthy();
    await press(within(hint!).getByRole("button", { name: en.provenanceShowDetails }));

    await waitFor(() => expect(inspector().hidden).toBe(false));
    expect(within(inspector()).getByText(en.provenanceKindInput)).toBeTruthy();
  });

  it("folds the contextual region away in one column rather than shrinking it", async () => {
    renderShell({ constrained: true, roomy: false });
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));

    // One column: the project list has it, and the inspector is folded.
    expect(inspector().hidden).toBe(true);
    await press(screen.getByRole("button", { name: en.inspectorToggle }));

    // Opened, the region takes the column and the project list yields it --
    // the existing one-column folding, not a new layout.
    await waitFor(() => expect(inspector().hidden).toBe(false));
    expect(within(inspector()).getByText(en.provenanceKindInput)).toBeTruthy();
    expect(document.querySelector("#workbench-project")?.hasAttribute("hidden")).toBe(true);
  });

  it("navigates between related objects without asking the backend for anything", async () => {
    const projects = renderShell({ constrained: false, roomy: true });
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));
    await waitFor(() => expect(inspector().hidden).toBe(false));

    const before = [...projects.calls];
    await press(inspector().querySelector<HTMLElement>(`[data-provenance-link="${RUN}"]`)!);

    expect(
      document.querySelector("[data-provenance]")?.getAttribute("data-provenance"),
    ).toBe("run");
    // The whole navigation was local state over data already on the page.
    expect(projects.calls).toEqual(before);
    expect(projects.checkProjectLinks).not.toHaveBeenCalled();
    expect(projects.beginProjectJob).not.toHaveBeenCalled();
  });
});
