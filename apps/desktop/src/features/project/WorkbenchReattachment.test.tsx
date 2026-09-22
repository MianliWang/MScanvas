/**
 * The bridge from a recorded reference to a live Workbench row, as the
 * interface offers it.
 *
 * What is proved here is what the *page* does: which control a reference in
 * each current state gets, what activating it sends, where the reader ends up,
 * and what is said when nothing was admitted. The fake project boundary answers
 * with a controlled table, so "the file still matches" is a string this file
 * chose rather than a digest anything computed. That the real boundary
 * re-establishes content before admitting anything, refuses an in-place edit at
 * the same name and length, and converges a duplicate onto one row is proved
 * against real files in `apps/desktop/src-tauri/src/reattachment/tests.rs`.
 *
 * No provider is involved anywhere in this file, which is part of the claim:
 * recorded work over local files has to be reattachable on a machine with no
 * converter installed.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { PreviewApiProvider } from "../mzml-preview/api";
import type { WorkspaceAddResult } from "../mzml-preview/contracts";
import { WorkspaceDropTransportProvider } from "../mzml-preview/dropTransport";
import {
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  selectedFile,
  unavailableBackend,
} from "../../test/previewFixtures";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { UI_RESOURCES } from "../preferences/i18n";
import {
  capturedProject,
  createFakeProjectApi,
  openProject,
  projectInput,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import { ProjectApiProvider, type ProjectState } from "./projectApi";
import { ProjectPanel } from "./ProjectPanel";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { useProject } from "./useProject";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

const MATCHING = "11111111-2222-4111-8111-111111111111";
const UNCHECKED = "11111111-3333-4111-8111-111111111111";
const CHANGED = "11111111-4444-4111-8111-111111111111";
const MISSING = "11111111-5555-4111-8111-111111111111";
const UNREADABLE = "11111111-6666-4111-8111-111111111111";

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

/** One reference in each state a check can leave behind. */
function everyState(): ProjectState {
  return openProject({
    inputs: [
      projectInput({
        id: MATCHING,
        label: "matching.mzML",
        verification: "matchingRecordedContent",
      }),
      projectInput({ id: UNCHECKED, label: "unchecked.mzML", verification: "notChecked" }),
      projectInput({ id: CHANGED, label: "changed.mzML", verification: "differentContent" }),
      projectInput({
        id: MISSING,
        label: "missing.mzML",
        verification: "unavailable",
        unavailableReason: "missingAtCheckedLocation",
      }),
      projectInput({
        id: UNREADABLE,
        label: "unreadable.mzML",
        verification: "unavailable",
        unavailableReason: "unstableRead",
      }),
    ],
  });
}

/** One reference that matches, already admitted as a row this session. */
function admittedProject(handle: string | null = selectedFile.handle): ProjectState {
  return openProject({
    inputs: [
      projectInput({
        id: MATCHING,
        label: selectedFile.fileName,
        verification: "matchingRecordedContent",
        workbenchDatasetHandle: handle,
      }),
    ],
  });
}

/** An add that produced one new row. */
function addedOne(): WorkspaceAddResult {
  return {
    roster: { datasets: [selectedFile], capacity: 24 },
    outcomes: [{ outcome: "added", dataset: selectedFile }],
  };
}

/** An add the Workbench refused, with the refusal it has always given. */
function refusedAsUnsupported(): WorkspaceAddResult {
  return {
    roster: { datasets: [], capacity: 24 },
    outcomes: [
      {
        outcome: "rejected",
        candidateName: "notes.txt",
        error: {
          kind: "unsupported_extension",
          summary: "MSCanvas opens .mzML files in this version.",
          detail: null,
          retryable: false,
        },
      },
    ],
  };
}

interface HarnessProps {
  readonly live?: ReadonlySet<string>;
  readonly onShow?: (handle: string) => void;
  readonly onAdmitted?: (result: WorkspaceAddResult) => void;
  readonly locale?: "en" | "zh-CN";
  readonly withDetails?: boolean;
}

/** The project surface, with the shell's two collaborators supplied by hand. */
function Harness({
  live = new Set<string>(),
  onShow = () => undefined,
  onAdmitted,
  withDetails = false,
}: HarnessProps) {
  const session = useProject(onAdmitted);
  return (
    <>
      <ProjectPanel
        session={session}
        liveDatasetHandles={live}
        onShowInWorkbench={onShow}
        detailsPresent={withDetails}
      />
      {withDetails ? (
        <aside id="workbench-inspector">
          <ProvenanceDetails provenance={session.provenance} onSelect={session.inspect} />
        </aside>
      ) : null}
    </>
  );
}

function mount(state: ProjectState, props: HarnessProps = {}): FakeProjectApi {
  const api = createFakeProjectApi(state);
  render(
    <PreferencesApiProvider
      value={createFakePreferencesApi({
        stored: storedRecord({
          appearance: { locale: props.locale ?? "en", density: "comfortable" },
        }),
      })}
    >
      <SessionPreferencesProvider>
        <ProjectApiProvider value={api}>
          <Harness {...props} />
        </ProjectApiProvider>
      </SessionPreferencesProvider>
    </PreferencesApiProvider>,
  );
  return api;
}

/** The Add control on one reference's row. */
function addControl(inputId: string): HTMLButtonElement {
  const control = document.querySelector<HTMLButtonElement>(
    `[data-project-add-to-workbench="${inputId}"]`,
  );
  if (control === null) throw new Error(`no Add control for ${inputId}`);
  return control;
}

describe("adding a project reference to the Workbench", () => {
  it("offers the action only where a check has established the recorded content", async () => {
    mount(everyState());
    await screen.findByText(en.projectReferences);

    // Matching: offered, with nothing to explain.
    expect(addControl(MATCHING).getAttribute("aria-disabled")).toBe(null);
    expect(addControl(MATCHING).getAttribute("data-project-add-unavailable")).toBe(null);

    // Every other state is inert, and each says a different thing -- because
    // what the reader should do next is different in each.
    const reasons = [UNCHECKED, CHANGED, MISSING, UNREADABLE].map((id) => [
      addControl(id).getAttribute("aria-disabled"),
      addControl(id).getAttribute("data-project-add-unavailable"),
      addControl(id).getAttribute("title"),
    ]);
    expect(reasons).toEqual([
      ["true", "projectAddNeedsCheck", en.projectAddNeedsCheck],
      ["true", "projectAddChanged", en.projectAddChanged],
      ["true", "projectAddMissing", en.projectAddMissing],
      ["true", "projectAddUnavailable", en.projectAddUnavailable],
    ]);
    // The reason is on screen in words as well, and the inert control points
    // at it rather than hiding it in a tooltip.
    expect(addControl(UNCHECKED).getAttribute("aria-describedby")).toBe(
      `project-state-${UNCHECKED}`,
    );
    expect(document.getElementById(`project-state-${UNCHECKED}`)?.textContent).toBe(
      en.projectStateNotChecked,
    );
  });

  it("sends nothing for a reference no check has established", async () => {
    const api = mount(everyState());
    await screen.findByText(en.projectReferences);

    await press(addControl(UNCHECKED));

    // Not refused by Rust and then reported -- not asked at all. Pressing this
    // is not a request to run the check the user did not ask for.
    expect(api.addProjectInputToWorkspace).not.toHaveBeenCalled();
    expect(api.beginProjectJob).not.toHaveBeenCalled();
  });

  it("admits a matching reference under an accepted operation and hands the roster on", async () => {
    const admitted: WorkspaceAddResult[] = [];
    const api = mount(everyState(), { onAdmitted: (result) => admitted.push(result) });
    api.setAdmission(addedOne());
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    await waitFor(() => expect(admitted).toHaveLength(1));
    // Accepted first, then run under the identifier acceptance minted -- the
    // same two steps a check takes, so a cancel has something to name.
    expect(api.beginProjectJob).toHaveBeenCalled();
    expect(api.addProjectInputToWorkspace).toHaveBeenCalledWith("project-job-1", MATCHING);
    expect(admitted[0]?.outcomes[0]?.outcome).toBe("added");
  });

  it("offers to show a reference that is already a live row, and sends nothing to do it", async () => {
    const shown: string[] = [];
    const api = mount(admittedProject(), {
      live: new Set([selectedFile.handle]),
      onShow: (handle) => shown.push(handle),
    });
    await screen.findByText(en.projectReferences);

    const control = screen.getByRole("button", {
      name: `Show ${selectedFile.fileName} in the Workbench`,
    });
    expect(control.textContent).toBe(en.projectShowInWorkbench);
    expect(document.querySelector(`[data-project-add-to-workbench="${MATCHING}"]`)).toBe(null);

    const before = [...api.calls];
    await press(control);

    expect(shown).toEqual([selectedFile.handle]);
    // Showing a row is navigation. It reads no file, admits nothing and asks
    // the boundary for nothing at all.
    expect(api.calls).toEqual(before);
  });

  it("offers to add again once the row the reference named has gone", async () => {
    // The handle is remembered, and the roster no longer holds it -- a row the
    // user removed, or a workspace they cleared. The roster is the authority,
    // so the surface goes back to offering to add.
    mount(admittedProject(), { live: new Set<string>() });
    await screen.findByText(en.projectReferences);

    expect(document.querySelector(`[data-project-show-in-workbench="${MATCHING}"]`)).toBe(null);
    expect(addControl(MATCHING).getAttribute("aria-disabled")).toBe(null);
  });

  it("reports a file the Workbench does not open without claiming a row for it", async () => {
    const admitted: WorkspaceAddResult[] = [];
    const api = mount(
      openProject({
        inputs: [
          projectInput({
            id: MATCHING,
            label: "notes.txt",
            verification: "matchingRecordedContent",
          }),
        ],
      }),
      { onAdmitted: (result) => admitted.push(result) },
    );
    api.setAdmission(refusedAsUnsupported());
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    await waitFor(() => expect(admitted).toHaveLength(1));
    // The existing refusal, unchanged and not softened into something the
    // project surface invented.
    expect(admitted[0]?.outcomes).toEqual(refusedAsUnsupported().outcomes);
    // Nothing was admitted, so the row still offers to add rather than to show.
    expect(addControl(MATCHING)).toBeTruthy();
  });

  it("says why a stale request was refused, in the project's own words", async () => {
    const api = mount(everyState());
    api.refuseOnce("addProjectInputToWorkspace", "staleDocument");
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    await waitFor(() =>
      expect(document.querySelector("[data-project-problem]")).toBeTruthy(),
    );
    expect(
      document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem"),
    ).toBe("staleDocument");
    // Twice: the visible notice, and the live region that announces it.
    expect(screen.getAllByText(en.projectRefusedStaleDocument)).toHaveLength(2);
  });

  it("names its own refusals rather than falling back to the catch-all", async () => {
    // The identifier the boundary actually sends is `kind`. Both new refusals
    // reach their own sentence through it.
    const api = mount(everyState());
    api.refuseOnce("addProjectInputToWorkspace", "contentChanged");
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    await waitFor(() =>
      expect(screen.getAllByText(en.projectRefusedContentChanged).length).toBeGreaterThan(0),
    );
  });

  it("is activated by the keyboard and takes visible focus", async () => {
    mount(everyState());
    await screen.findByText(en.projectReferences);
    const control = addControl(MATCHING);

    // The properties that make keyboard activation true, rather than a
    // synthesized key event jsdom would not turn into a click: a native
    // button, typed, enabled, and in the tab order. The browser scenario
    // presses Enter against a focused control for real.
    expect(control.tagName).toBe("BUTTON");
    expect(control.type).toBe("button");
    expect(control.hasAttribute("disabled")).toBe(false);
    expect(control.tabIndex).toBe(0);
    control.focus();
    expect(document.activeElement).toBe(control);
  });

  it("keeps an inert control reachable so its reason can be read", async () => {
    mount(everyState());
    await screen.findByText(en.projectReferences);
    const control = addControl(CHANGED);

    // `aria-disabled`, never `disabled`: a removed control cannot be tabbed to
    // and its explanation would be readable only with a pointer.
    expect(control.hasAttribute("disabled")).toBe(false);
    expect(control.tabIndex).toBe(0);
  });

  it("names both controls in the declared locales", async () => {
    mount(admittedProject(), { live: new Set([selectedFile.handle]), locale: "zh-CN" });
    await screen.findByText(zh.projectReferences);

    expect(
      screen.getByRole("button", { name: `在工作台中显示 ${selectedFile.fileName}` }).textContent,
    ).toBe(zh.projectShowInWorkbench);
    expect(zh.projectAddToWorkbench).not.toBe(en.projectAddToWorkbench);
    expect(zh.projectAddNeedsCheck).not.toBe(en.projectAddNeedsCheck);
  });

  it("goes on describing provenance the same way once a reference is a row", async () => {
    const admitted: WorkspaceAddResult[] = [];
    const api = mount(capturedProject({ input: { verification: "matchingRecordedContent" } }), {
      withDetails: true,
      onAdmitted: (result) => admitted.push(result),
    });
    api.setAdmission(addedOne());
    await screen.findByText(en.projectReferences);

    const inspector = () => document.querySelector<HTMLElement>("#workbench-inspector")!;
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));
    const relatedBefore = [...inspector().querySelectorAll("[data-provenance-link]")].map((node) =>
      node.getAttribute("data-provenance-link"),
    );
    expect(relatedBefore.length).toBeGreaterThan(0);

    // The session bridge is not a provenance edge. Admitting the file adds a
    // row to another collection and records nothing in the document.
    api.set(capturedProject({ input: { verification: "matchingRecordedContent" } }));
    await press(addControl("11111111-2222-4111-8111-111111111111"));
    await waitFor(() => expect(admitted).toHaveLength(1));

    expect(
      [...inspector().querySelectorAll("[data-provenance-link]")].map((node) =>
        node.getAttribute("data-provenance-link"),
      ),
    ).toEqual(relatedBefore);
    expect(inspector().querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe(
      "input",
    );
  });
});

// ---------------------------------------------------------------------------
// The whole shell: where the reader ends up, and what did not happen on the way
// ---------------------------------------------------------------------------

function installViewport(initial: { constrained: boolean; roomy: boolean }) {
  const original = window.matchMedia;
  const current = initial;
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
  };
}

let viewport: ReturnType<typeof installViewport> | null = null;

afterEach(() => {
  viewport?.restore();
  viewport = null;
});

/** The whole application, with a saved project and no provider at all. */
function renderShell(state: ProjectState) {
  viewport = installViewport({ constrained: false, roomy: true });
  const projects = createFakeProjectApi(state);
  const preview = createFakePreviewApi({ availability: unavailableBackend });
  const openPreview = vi.spyOn(preview, "openPreview");
  render(
    <PreferencesApiProvider value={createFakePreferencesApi({ stored: storedRecord() })}>
      <ProjectApiProvider value={projects}>
        <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
          <PreviewApiProvider value={preview}>
            <App />
          </PreviewApiProvider>
        </WorkspaceDropTransportProvider>
      </ProjectApiProvider>
    </PreferencesApiProvider>,
  );
  return { projects, preview, openPreview };
}

describe("the Workbench reattachment in the application shell", () => {
  it("takes the reader to the revealed row without reading it", async () => {
    const { projects, openPreview } = renderShell(
      openProject({
        inputs: [
          projectInput({
            id: MATCHING,
            label: selectedFile.fileName,
            verification: "matchingRecordedContent",
          }),
        ],
      }),
    );
    projects.setAdmission(addedOne());
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    // The shell moved to the Workbench, and the roster holds the row.
    await waitFor(() =>
      expect(document.querySelector(".workbench-shell")?.getAttribute("data-surface")).toBe(
        "workbench",
      ),
    );
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        `#workbench-roster [data-handle="${selectedFile.handle}"]`,
      );
      expect(found).toBeTruthy();
      return found!;
    });
    // Revealed: the row carries the keyboard and is the highlighted one.
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.getAttribute("aria-selected")).toBe("true");
    // And nothing was read. Adding a reference makes it something the reader
    // can open; opening it is still a thing they ask for.
    expect(openPreview).not.toHaveBeenCalled();
    expect(within(row).queryByText(en.showingRow)).toBe(null);
  });

  it("reveals the row a reference already has without asking for anything", async () => {
    const { projects, openPreview } = renderShell(
      openProject({
        inputs: [
          projectInput({
            id: MATCHING,
            label: selectedFile.fileName,
            verification: "matchingRecordedContent",
          }),
        ],
      }),
    );
    projects.setAdmission(addedOne());
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    // Admit it once, then come back to the project surface.
    projects.set(
      openProject({
        inputs: [
          projectInput({
            id: MATCHING,
            label: selectedFile.fileName,
            verification: "matchingRecordedContent",
            workbenchDatasetHandle: selectedFile.handle,
          }),
        ],
      }),
    );
    await press(addControl(MATCHING));
    await waitFor(() =>
      expect(
        document.querySelector(`#workbench-roster [data-handle="${selectedFile.handle}"]`),
      ).toBeTruthy(),
    );
    await press(screen.getByRole("button", { name: en.projectSurface }));

    const show = await screen.findByRole("button", {
      name: `Show ${selectedFile.fileName} in the Workbench`,
    });
    const before = [...projects.calls];
    await press(show);

    await waitFor(() =>
      expect(document.querySelector(".workbench-shell")?.getAttribute("data-surface")).toBe(
        "workbench",
      ),
    );
    const row = document.querySelector<HTMLElement>(
      `#workbench-roster [data-handle="${selectedFile.handle}"]`,
    );
    expect(row).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(row));
    // A second activation reuses the row it has. Nothing was sent to either
    // boundary, and there is still exactly one row.
    expect(projects.calls).toEqual(before);
    expect(openPreview).not.toHaveBeenCalled();
    expect(
      document.querySelectorAll("#workbench-roster [data-handle]").length,
    ).toBe(1);
  });
});
