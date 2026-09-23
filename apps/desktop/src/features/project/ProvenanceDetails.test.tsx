/**
 * The provenance consumer, driven the way the shell wires it.
 *
 * The harness is the shell's own composition in miniature: one `useProject`
 * session feeding both the project list and the contextual region, which is
 * exactly how `PreviewWorkspace` connects them. So selecting in one and reading
 * the other is the real path, not a arrangement built for the test.
 *
 * What these establish: that each kind of object describes itself correctly,
 * that every recorded relationship is reachable from both ends, that current
 * file state is shown apart from recorded history, that a removed object is
 * reported rather than quietly replaced, and that navigating sends nothing.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { describe, expect, it } from "vitest";

import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  capturedProject,
  createFakeProjectApi,
  openProject,
  projectArtifact,
  projectInput,
  projectRun,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import { ProjectApiProvider, type ProjectState } from "./projectApi";
import { ProjectPanel } from "./ProjectPanel";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { useProject } from "./useProject";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

const INPUT = "11111111-2222-4111-8111-111111111111";
const RUN = "ffffffff-2222-4111-8111-111111111111";
const ARTIFACT = "eeeeeeee-2222-4111-8111-111111111111";

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

/**
 * Waits for a control to exist, then presses it.
 *
 * The project list renders from an answer that arrives asynchronously, so a
 * query issued in the same tick as the mount can reach for a row that is not
 * there yet. Waiting is the difference between a test that describes the
 * interface and one that describes this machine's timing.
 */
async function pressWhenReady(selector: string) {
  await waitFor(() => expect(document.querySelector(selector)).toBeTruthy());
  await press(document.querySelector<HTMLElement>(selector)!);
}

/** The current-state element in the contextual region, once it is there. */
async function currentStateElement(): Promise<Element> {
  await waitFor(() => expect(details().querySelector("[data-provenance-current]")).toBeTruthy());
  return details().querySelector("[data-provenance-current]")!;
}

/** The shell's wiring: one session, the list and the contextual region. */
function Harness({ detailsPresent = true }: { readonly detailsPresent?: boolean }) {
  const session = useProject();
  return (
    <>
      <ProjectPanel session={session} detailsPresent={detailsPresent} onRevealDetails={() => {}} />
      <aside id="workbench-inspector">
        <ProvenanceDetails provenance={session.provenance} onSelect={session.inspect} />
      </aside>
    </>
  );
}

function mount(
  initial: ProjectState,
  options: { readonly locale?: "en" | "zh-CN"; readonly detailsPresent?: boolean } = {},
): FakeProjectApi {
  const api = createFakeProjectApi(initial);
  const preferences = createFakePreferencesApi({
    stored: storedRecord({ appearance: { locale: options.locale ?? "en" } }),
  });
  render(
    <PreferencesApiProvider value={preferences}>
      <SessionPreferencesProvider>
        <ProjectApiProvider value={api}>
          <Harness detailsPresent={options.detailsPresent} />
        </ProjectApiProvider>
      </SessionPreferencesProvider>
    </PreferencesApiProvider>,
  );
  return api;
}

/** The contextual region, so an assertion cannot match the list instead. */
function details(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#workbench-inspector");
  if (element === null) throw new Error("no details region");
  return element;
}

/** What kind of object the region is currently describing. */
function describing(): string | null {
  return document.querySelector("[data-provenance]")?.getAttribute("data-provenance") ?? null;
}

describe("the provenance consumer", () => {
  it("says nothing is selected until something is", async () => {
    mount(capturedProject());
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());
    expect(within(details()).getByText(en.provenanceNothingSelected)).toBeTruthy();
    expect(describing()).toBeNull();
  });

  it("describes a selected reference and the run that used it", async () => {
    mount(capturedProject({ input: { verification: "differentContent" } }));
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());

    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));

    expect(describing()).toBe("input");
    const region = within(details());
    expect(region.getByText(en.provenanceKindInput)).toBeTruthy();
    expect(region.getByRole("heading", { name: "QC_pool_01.mzML" })).toBeTruthy();
    // Current file state, under its own heading.
    expect(region.getByText(en.provenanceCurrentFile)).toBeTruthy();
    expect(region.getByText(en.projectStateDifferent)).toBeTruthy();
    // Recorded history, under its own, and the run is a control.
    expect(region.getByText(en.provenanceUsedBy)).toBeTruthy();
    expect(region.getByRole("button", { name: /is related to/ })).toBeTruthy();
    expect(region.getByText(en.projectRunCompleted)).toBeTruthy();
  });

  it("keeps current file state and recorded history in separate sections", async () => {
    mount(capturedProject({ input: { verification: "differentContent" } }));
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));

    // "Changed" is a fact about the file now; it carries its own element and
    // its own tone, and it does not appear inside the history list.
    const current = details().querySelector("[data-provenance-current]");
    expect(current?.getAttribute("data-provenance-current")).toBe("differentContent");
    expect(current?.className).toContain("is-different");
    const usedBy = details().querySelector(".provenance-list");
    expect(usedBy?.querySelector("[data-provenance-current]")).toBeNull();
    // And the run it was used by is still Completed: a changed file did not
    // invalidate the run that used it.
    expect(within(details()).getByText(en.projectRunCompleted)).toBeTruthy();
  });

  it("shows each current state as its own sentence", async () => {
    for (const [verification, reason, expected] of [
      ["notChecked", null, en.projectStateNotChecked],
      ["matchingRecordedContent", null, en.projectStateMatching],
      ["differentContent", null, en.projectStateDifferent],
      ["unavailable", "missingAtCheckedLocation", en.projectStateMissing],
      ["unavailable", "unreadable", en.projectStateUnreadable],
      ["unavailable", "unstableRead", en.projectStateUnstable],
    ] as const) {
      // Six mounts in one case, each unmounted for real. Clearing the body
      // instead would leave six live React roots behind, and which one a query
      // reached would depend on what else the suite had run.
      cleanup();
      mount(capturedProject({ input: { verification, unavailableReason: reason } }));
      await pressWhenReady(`[data-project-inspect="${INPUT}"]`);
      // Read off the element rather than by text, because the state carries a
      // visually-hidden "Current file:" qualifier with it and a text query
      // would be matching the two together.
      const state = await currentStateElement();
      expect(state.textContent).toContain(expected);
      expect(state.textContent).toContain(en.provenanceCurrentFile);
    }
  });

  it("navigates input to run to artifact and back again", async () => {
    const api = mount(capturedProject());
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());
    const before = [...api.calls];

    // Reference -> the run that used it.
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));
    expect(describing()).toBe("input");
    await press(details().querySelector<HTMLElement>(`[data-provenance-link="${RUN}"]`)!);
    expect(describing()).toBe("run");

    // Run -> what it produced.
    const region = within(details());
    expect(region.getByText(en.provenanceConsumed)).toBeTruthy();
    expect(region.getByText(en.provenanceProduced)).toBeTruthy();
    await press(details().querySelector<HTMLElement>(`[data-provenance-link="${ARTIFACT}"]`)!);
    expect(describing()).toBe("artifact");

    // Artifact -> its producing run, and on to its source reference.
    expect(within(details()).getByText(en.provenanceProducedBy)).toBeTruthy();
    expect(within(details()).getByText(en.provenanceSources)).toBeTruthy();
    await press(details().querySelector<HTMLElement>(`[data-provenance-link="${INPUT}"]`)!);
    expect(describing()).toBe("input");

    // Every one of those was local. Nothing was asked of the boundary.
    expect(api.calls).toEqual(before);
    expect(api.checkProjectLinks).not.toHaveBeenCalled();
    expect(api.captureProjectFileFacts).not.toHaveBeenCalled();
    expect(api.getProjectState).toHaveBeenCalledTimes(1);
  });

  it("says an artifact is stored in the project rather than showing a file state", async () => {
    mount(capturedProject());
    await pressWhenReady(`[data-project-inspect-artifact="${ARTIFACT}"]`);

    await waitFor(() => expect(describing()).toBe("artifact"));
    // An artifact has no backing file, so it says where it lives rather than
    // leaving a gap a reader fills in beside the references that do have one.
    const own = details().querySelector(".provenance-current-row");
    expect(own?.querySelector("[data-provenance-stored]")).toBeTruthy();
    expect(within(details()).getByText(en.provenanceArtifactStored)).toBeTruthy();
    // The artifact's own row carries no file state. Its *sources* do, because
    // those are references and a reference does have a file.
    expect(own?.querySelector("[data-provenance-current]")).toBeNull();
    expect(
      details().querySelector(`[data-provenance-link="${INPUT}"]`),
      "the source reference is still reachable",
    ).toBeTruthy();
  });

  it("says an artifact no run claims has no producer", async () => {
    mount(
      openProject({
        inputs: [projectInput({ id: INPUT, label: "orphan.mzML" })],
        runs: [],
        artifacts: [
          projectArtifact({ id: ARTIFACT, producedByRunId: null, sourceInputIds: [INPUT] }),
        ],
      }),
    );
    await waitFor(() => expect(screen.getByText("orphan.mzML")).toBeTruthy());
    // Reached from the reference it observed, since no run lists it.
    await press(screen.getByRole("button", { name: "Show what orphan.mzML is related to" }));
    expect(within(details()).getByText(en.provenanceUsedByNothing)).toBeTruthy();
  });

  it("reports a selected object the project no longer has", async () => {
    const api = mount(capturedProject());
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());
    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));
    expect(describing()).toBe("input");

    // The reference is removed while it is the one being inspected.
    api.set(openProject({ inputs: [], runs: [], artifacts: [] }));
    await press(screen.getByRole("button", { name: "Remove QC_pool_01.mzML from this project" }));

    await waitFor(() =>
      expect(details().querySelector("[data-provenance-selection-gone]")).toBeTruthy(),
    );
    // It says so rather than moving the user to some other object.
    expect(within(details()).getByText(en.provenanceSelectionGone)).toBeTruthy();
    expect(describing()).toBeNull();
  });

  it("keeps an unresolvable relationship visible rather than shortening the list", async () => {
    mount(
      openProject({
        inputs: [projectInput({ id: INPUT, label: "present.mzML" })],
        runs: [
          projectRun({
            id: RUN,
            inputIds: [INPUT, "99999999-2222-4111-8111-111111111111"],
            outputArtifactIds: [],
            outcome: "failed",
          }),
        ],
        artifacts: [],
      }),
    );
    await pressWhenReady(`[data-project-inspect-run="${RUN}"]`);

    await waitFor(() => expect(describing()).toBe("run"));
    const rows = details().querySelectorAll(".provenance-list li");
    expect(rows).toHaveLength(2);
    expect(details().querySelector("[data-provenance-gone]")).toBeTruthy();
    expect(within(details()).getByText(en.provenanceRelatedGone)).toBeTruthy();
    // A failed run produced nothing, and says so.
    expect(details().querySelector("[data-provenance-no-artifact]")).toBeTruthy();
  });

  it("names every lineage control and reaches it from the keyboard", async () => {
    mount(capturedProject());
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());

    // The name says which object, so a button list is not four identical rows.
    const inspect = screen.getByRole("button", {
      name: "Show what QC_pool_01.mzML is related to",
    });
    expect(inspect.getAttribute("aria-controls")).toBe("workbench-inspector");

    // Keyboard equivalence rests on these being native buttons in the tab
    // order, which the platform activates with Enter and Space. jsdom does not
    // synthesize activation from a key event, so this asserts the properties
    // that make it true and the browser spec presses the key for real.
    expect(inspect.tagName).toBe("BUTTON");
    expect(inspect.getAttribute("type")).toBe("button");
    expect(inspect.hasAttribute("disabled")).toBe(false);
    expect(inspect.getAttribute("tabindex")).toBeNull();
    inspect.focus();
    expect(document.activeElement).toBe(inspect);

    await press(inspect);
    expect(describing()).toBe("input");
    // And the row says it is the one being described.
    expect(inspect.getAttribute("aria-current")).toBe("true");

    const link = details().querySelector<HTMLElement>(`[data-provenance-link="${RUN}"]`)!;
    expect(link.tagName).toBe("BUTTON");
    expect(link.getAttribute("type")).toBe("button");
    expect(link.getAttribute("tabindex")).toBeNull();
    expect(link.getAttribute("aria-label")).toContain("is related to");
  });

  it("gives every run control a name that says which run", async () => {
    // Every capture is called the same thing, so naming the controls after the
    // operation would give a reader one name for every run in the project.
    const first = projectRun({
      id: RUN,
      inputIds: [INPUT],
      outputArtifactIds: [],
      outcome: "failed",
      finishedAt: "2026-09-22T10:00:01Z",
    });
    const second = projectRun({
      id: "ffffffff-9999-4111-8111-111111111111",
      inputIds: [INPUT],
      outputArtifactIds: [],
      outcome: "failed",
      finishedAt: "2026-09-22T14:30:01Z",
    });
    mount(
      openProject({
        inputs: [projectInput({ id: INPUT, label: "shared.mzML", consumedByRunIds: [first.id, second.id] })],
        runs: [first, second],
        artifacts: [],
      }),
    );
    await pressWhenReady(`[data-project-inspect="${INPUT}"]`);
    await waitFor(() => expect(describing()).toBe("input"));

    const names = [...details().querySelectorAll("[data-provenance-link]")].map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("says a current file state is current, even inside a recorded list", async () => {
    mount(capturedProject({ input: { verification: "differentContent" } }));
    await pressWhenReady(`[data-project-inspect-run="${RUN}"]`);

    // Under "Used", beside what the run consumed. The tone and the section
    // heading carry it visually; the text carries it for a reader who has
    // neither.
    await waitFor(() => expect(describing()).toBe("run"));
    const state = await currentStateElement();
    expect(state.textContent).toContain(en.provenanceCurrentFile);
    expect(state.textContent).toContain(en.projectStateDifferent);
  });

  it("points at Details when the region is not on screen", async () => {
    mount(capturedProject(), { detailsPresent: false });
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());
    expect(document.querySelector("[data-project-inspect-hint]")).toBeNull();

    await press(screen.getByRole("button", { name: "Show what QC_pool_01.mzML is related to" }));

    // Below the roomy breakpoint the region is closed unless asked for, so
    // inspecting would otherwise appear to do nothing.
    await waitFor(() =>
      expect(document.querySelector("[data-project-inspect-hint]")).toBeTruthy(),
    );
    expect(screen.getByText(en.provenanceInDetails)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.provenanceShowDetails })).toBeTruthy();
  });

  it("renders the provenance region in Simplified Chinese", async () => {
    mount(capturedProject({ input: { verification: "matchingRecordedContent" } }), {
      locale: "zh-CN",
    });
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());
    await press(screen.getByRole("button", { name: `查看 QC_pool_01.mzML 的关联` }));

    const region = within(details());
    expect(region.getByText(zh.provenanceKindInput)).toBeTruthy();
    expect(region.getByText(zh.provenanceCurrentFile)).toBeTruthy();
    expect(region.getByText(zh.provenanceUsedBy)).toBeTruthy();
    expect(region.getByText(zh.projectStateMatching)).toBeTruthy();

    // Translated, not copied.
    expect(zh.provenanceKindInput).not.toEqual(en.provenanceKindInput);
    expect(zh.provenanceUsedBy).not.toEqual(en.provenanceUsedBy);
    expect(zh.provenanceArtifactStored).not.toEqual(en.provenanceArtifactStored);
    expect(zh.provenanceSelectionGone).not.toEqual(en.provenanceSelectionGone);
  });
});

describe("the project's first arrival", () => {
  /**
   * Inspects a reference in the first commit that shows the project.
   *
   * A layout effect runs once the rows are in the document and before any
   * passive effect of the same commit, which is the window a reader's press
   * lands in when it follows the first paint closely. Pressing from here puts
   * the press in that window every time, rather than when this machine is slow.
   */
  function InspectOnArrival() {
    const session = useProject();
    const pressed = useRef(false);
    useLayoutEffect(() => {
      if (session.state.open && !pressed.current) {
        pressed.current = true;
        session.inspect({ kind: "input", id: INPUT });
      }
    });
    return (
      <aside id="workbench-inspector">
        <ProvenanceDetails provenance={session.provenance} onSelect={session.inspect} />
      </aside>
    );
  }

  it("keeps a press made in the first frame that shows the project", async () => {
    const api = createFakeProjectApi(capturedProject());
    const release = api.holdOnce("getProjectState");
    render(
      <PreferencesApiProvider value={createFakePreferencesApi({ stored: storedRecord() })}>
        <SessionPreferencesProvider>
          <ProjectApiProvider value={api}>
            <InspectOnArrival />
          </ProjectApiProvider>
        </SessionPreferencesProvider>
      </PreferencesApiProvider>,
    );

    await act(async () => {
      release();
    });

    // The arrival of the first project is not the replacement of an earlier
    // one, so nothing the reader chose in its first frame is forgotten.
    expect(describing()).toBe("input");
  });
});
