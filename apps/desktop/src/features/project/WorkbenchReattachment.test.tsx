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
  readonly onAdmitted?: (result: WorkspaceAddResult | null) => void;
  readonly workspaceBusy?: boolean;
  readonly locale?: "en" | "zh-CN";
  readonly withDetails?: boolean;
}

/** The project surface, with the shell's two collaborators supplied by hand. */
function Harness({
  live = new Set<string>(),
  onShow = () => undefined,
  onAdmitted,
  withDetails = false,
  workspaceBusy = false,
}: HarnessProps) {
  const session = useProject(onAdmitted);
  return (
    <>
      <ProjectPanel
        session={session}
        liveDatasetHandles={live}
        onShowInWorkbench={onShow}
        detailsPresent={withDetails}
        workspaceBusy={workspaceBusy}
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
    const admitted: (WorkspaceAddResult | null)[] = [];
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
      name: `Show in Workbench: ${selectedFile.fileName}`,
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
    const admitted: (WorkspaceAddResult | null)[] = [];
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

  it("waits its turn while another workspace change is out, and says so", async () => {
    // One workspace change at a time, which is the rule every other mutation
    // follows. Without it this path could be issued beside a folder import and
    // supersede the whole scan in Rust, with nothing on screen having said so.
    const api = mount(everyState(), { workspaceBusy: true });
    await screen.findByText(en.projectReferences);

    expect(addControl(MATCHING).getAttribute("aria-disabled")).toBe("true");
    expect(addControl(MATCHING).getAttribute("data-project-add-unavailable")).toBe(
      "projectAddWorkspaceBusy",
    );
    expect(addControl(MATCHING).getAttribute("title")).toBe(en.projectAddWorkspaceBusy);

    await press(addControl(MATCHING));
    expect(api.addProjectInputToWorkspace).not.toHaveBeenCalled();
  });

  it("gives the workspace's own refusal its own sentence", async () => {
    // The refusal comes back through the workspace channel and keeps the
    // workspace's identifier. It reaches this surface because the action
    // enters the workspace's admission path, and a reader told only "that was
    // refused" has nothing to act on -- the true answer is "wait for the
    // conversion".
    const api = mount(everyState());
    api.refuseOnce("addProjectInputToWorkspace", "conversion_busy");
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    await waitFor(() =>
      expect(screen.getAllByText(en.projectRefusedConversionBusy).length).toBeGreaterThan(0),
    );
  });

  it("asks the shell to re-read the roster when the operation fails", async () => {
    // A refusal is not proof that the workspace is unchanged: the project can
    // decline to claim a row the workspace already admitted. The reply that
    // carried the new roster never arrives, so the shell is told to go and ask
    // rather than to leave the page describing a session that has moved on.
    const admitted: (WorkspaceAddResult | null)[] = [];
    const api = mount(everyState(), { onAdmitted: (result) => admitted.push(result) });
    api.refuseOnce("addProjectInputToWorkspace", "staleDocument");
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    await waitFor(() => expect(admitted).toEqual([null]));
    // And the refusal is still reported; reconciling is not swallowing it.
    expect(
      document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem"),
    ).toBe("staleDocument");
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

  it("keeps a reference's own reason rather than replacing it with the busy one", async () => {
    // A busy Workbench is a reason to wait. A reference that is not there is a
    // reason to go and find it, and telling that reader to try again in a
    // moment would be advice that never comes true -- and would contradict the
    // sentence the row itself shows, which this control points at.
    mount(everyState(), { workspaceBusy: true });
    await screen.findByText(en.projectReferences);

    expect(addControl(MISSING).getAttribute("data-project-add-unavailable")).toBe(
      "projectAddMissing",
    );
    expect(addControl(MISSING).getAttribute("title")).toBe(en.projectAddMissing);
    // Only the otherwise-addable reference is the one waiting for the
    // Workbench.
    expect(addControl(MATCHING).getAttribute("data-project-add-unavailable")).toBe(
      "projectAddWorkspaceBusy",
    );
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
    const admitted: (WorkspaceAddResult | null)[] = [];
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
  const getRoster = vi.spyOn(preview, "getRoster");
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
  return { projects, preview, openPreview, getRoster };
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

  it("re-reads the roster when an admission is refused after Rust may have admitted it", async () => {
    // The shell's own half of the recovery. A refusal is not proof that the
    // workspace is unchanged -- the project can decline to claim a row the
    // workspace already admitted -- and the reply that would have carried the
    // new roster never arrives, so the page has to go and ask.
    const { projects, getRoster } = renderShell(
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
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);
    await waitFor(() => expect(getRoster).toHaveBeenCalled());
    const reads = getRoster.mock.calls.length;
    projects.refuseOnce("addProjectInputToWorkspace", "staleDocument");

    await press(addControl(MATCHING));

    await waitFor(() => expect(getRoster.mock.calls.length).toBeGreaterThan(reads));
    // And the refusal still reaches the reader rather than being swallowed by
    // the recovery.
    await waitFor(() =>
      expect(
        document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem"),
      ).toBe("staleDocument"),
    );
  });

  it("opens the group a revealed row is inside rather than landing on nothing", async () => {
    // A collapsed group drops its rows from the projection entirely, so the
    // press the reveal makes is one the reducer cannot act on and the row is
    // not rendered to be focused. The default destination for every new row is
    // a group that can be collapsed, so this is reachable with two presses.
    const { projects } = renderShell(
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
    projects.set(admittedProject());
    await press(addControl(MATCHING));
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        `#workbench-roster [data-handle="${selectedFile.handle}"]`,
      );
      expect(found).toBeTruthy();
      return found!;
    });

    // Collapse the group the row is in, then leave the roster entirely.
    const disclosure = document.querySelector<HTMLElement>(
      "#workbench-roster .group-disclosure",
    );
    expect(disclosure).toBeTruthy();
    await press(disclosure!);
    await waitFor(() =>
      expect(
        document.querySelector(`#workbench-roster [data-handle="${selectedFile.handle}"]`),
      ).toBe(null),
    );
    await press(screen.getByRole("button", { name: en.projectSurface }));

    await press(
      await screen.findByRole("button", {
        name: `Show in Workbench: ${selectedFile.fileName}`,
      }),
    );

    // The group opened, the row is on screen again, and it is the one holding
    // the keyboard -- which is what "show it in the Workbench" has to mean.
    const revealed = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        `#workbench-roster [data-handle="${selectedFile.handle}"]`,
      );
      expect(found).toBeTruthy();
      return found!;
    });
    await waitFor(() => expect(document.activeElement).toBe(revealed));
    expect(revealed).not.toBe(row);
  });

  it("holds the acquisition actions while a reattachment is reading", async () => {
    // The other half of the one-change-at-a-time rule. A reattachment hashes a
    // whole acquisition and then enters the same admission gate every import
    // enters, so an import started during one would be superseded in Rust and
    // discard itself.
    const { projects } = renderShell(
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
    const release = projects.holdOnce("addProjectInputToWorkspace");
    await press(await screen.findByRole("button", { name: en.projectSurface }));
    await screen.findByText(en.projectReferences);

    await press(addControl(MATCHING));

    // While it is out, the Workbench's own acquisition actions wait.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.addFiles }).hasAttribute("disabled"),
      ).toBe(true),
    );
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.addFiles }).hasAttribute("disabled"),
      ).toBe(false),
    );
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
      name: `Show in Workbench: ${selectedFile.fileName}`,
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
