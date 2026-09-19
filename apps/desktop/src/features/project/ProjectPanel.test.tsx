/**
 * The project surface, driven through its boundary.
 *
 * What these establish is what the interface does: which outcomes a reader can
 * tell apart, that relinking costs a deliberate second press, that a refusal
 * leaves the project on screen, and that the surface works with no converter
 * anywhere in the composition. The store is a fake and is labelled one in
 * `projectFixtures`; the filesystem claims are proved in Rust.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  createFakeProjectApi,
  openProject,
  projectInput,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import { ProjectApiProvider, type ProjectState } from "./projectApi";
import { ProjectPanel } from "./ProjectPanel";
import { useProject } from "./useProject";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

/** One press, with the state update it causes flushed before the assertion. */
async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

function Harness() {
  return <ProjectPanel session={useProject()} />;
}

/**
 * Mounts the surface with a deterministic project store and, where a locale is
 * asked for, a stored preference record that selects it -- which is the route
 * the real application takes to a Chinese session.
 */
function mount(initial: ProjectState, locale: "en" | "zh-CN" = "en"): FakeProjectApi {
  const api = createFakeProjectApi(initial);
  const preferences = createFakePreferencesApi({
    stored: storedRecord({ appearance: { locale } }),
  });
  render(
    <PreferencesApiProvider value={preferences}>
      <SessionPreferencesProvider>
        <ProjectApiProvider value={api}>
          <Harness />
        </ProjectApiProvider>
      </SessionPreferencesProvider>
    </PreferencesApiProvider>,
  );
  return api;
}

/** The row for one reference, by the identifier Rust addressed it with. */
function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-project-input="${id}"]`);
  if (element === null) throw new Error(`no row for ${id}`);
  return element;
}

describe("the project surface", () => {
  it("shows matching, changed and unreadable references distinguishably", async () => {
    const inputs = [
      projectInput({
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        label: "matching.mzML",
        verification: "matchingRecordedContent",
      }),
      projectInput({
        id: "bbbbbbbb-1111-4111-8111-111111111111",
        label: "changed.mzML",
        verification: "differentContent",
      }),
      projectInput({
        id: "cccccccc-1111-4111-8111-111111111111",
        label: "gone.mzML",
        verification: "unavailable",
        unavailableReason: "missingAtCheckedLocation",
      }),
      projectInput({
        id: "dddddddd-1111-4111-8111-111111111111",
        label: "busy.mzML",
        verification: "unavailable",
        unavailableReason: "unstableRead",
      }),
    ];
    mount(openProject({ inputs }));

    await waitFor(() => expect(screen.getByText("matching.mzML")).toBeTruthy());

    // Each outcome is a different word, not just a different colour.
    expect(within(row(inputs[0].id)).getByText(en.projectStateMatching)).toBeTruthy();
    expect(within(row(inputs[1].id)).getByText(en.projectStateDifferent)).toBeTruthy();
    expect(within(row(inputs[2].id)).getByText(en.projectStateMissing)).toBeTruthy();
    // Missing and unreadable-because-busy are not the same sentence.
    expect(within(row(inputs[3].id)).getByText(en.projectStateUnstable)).toBeTruthy();
    expect(en.projectStateMissing).not.toEqual(en.projectStateUnstable);

    // And the state is on the element for anything reading rather than looking.
    expect(row(inputs[2].id).dataset.unavailableReason).toBe("missingAtCheckedLocation");
    expect(row(inputs[3].id).dataset.unavailableReason).toBe("unstableRead");
  });

  it("does not relink until the proposal is explicitly confirmed", async () => {
    const input = projectInput({
      verification: "unavailable",
      unavailableReason: "missingAtCheckedLocation",
    });
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    // Examining a candidate is one press, and it commits nothing.
    api.set(
      openProject({
        inputs: [
          projectInput({
            ...input,
            relinkProposed: true,
            relinkCandidateMatches: true,
            verification: "unavailable",
            unavailableReason: "missingAtCheckedLocation",
          }),
        ],
      }),
    );
    await press(within(row(input.id)).getByRole("button", { name: en.projectRelink }));

    await waitFor(() =>
      expect(within(row(input.id)).getByText(en.projectRelinkMatches)).toBeTruthy(),
    );
    expect(api.calls).toContain("proposeProjectRelink");
    expect(api.calls).not.toContain("commitProjectRelink");
    // Still unavailable: the record has not moved.
    expect(row(input.id).dataset.verification).toBe("unavailable");

    api.set(
      openProject({
        inputs: [projectInput({ ...input, verification: "matchingRecordedContent" })],
      }),
    );
    await press(within(row(input.id)).getByRole("button", { name: en.projectRelinkConfirm }),
    );

    await waitFor(() => expect(row(input.id).dataset.verification).toBe("matchingRecordedContent"));
    expect(api.calls).toContain("commitProjectRelink");
  });

  it("says when a proposed candidate is at a new location and also differs", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    api.set(
      openProject({
        inputs: [projectInput({ ...input, relinkProposed: true, relinkCandidateMatches: false })],
      }),
    );
    await press(within(row(input.id)).getByRole("button", { name: en.projectRelink }));

    // Two independent facts, and the surface reports the second rather than
    // presenting the move as though it had restored the file.
    await waitFor(() =>
      expect(within(row(input.id)).getByText(en.projectRelinkDiffers)).toBeTruthy(),
    );
  });

  it("shows a completed capture as a run linked to the artifact it produced", async () => {
    const input = projectInput({ verification: "matchingRecordedContent" });
    mount(
      openProject({
        inputs: [input],
        artifacts: [
          {
            id: "eeeeeeee-1111-4111-8111-111111111111",
            label: "File facts: sample.mzML",
            observedInputCount: 1,
            observedMemberCount: 1,
          },
        ],
        runs: [
          {
            id: "ffffffff-1111-4111-8111-111111111111",
            operation: "captureFileFactsV1",
            outcome: "completed",
            inputIds: [input.id],
            outputArtifactIds: ["eeeeeeee-1111-4111-8111-111111111111"],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-19T10:00:00Z",
            finishedAt: "2026-09-19T10:00:01Z",
          },
        ],
      }),
    );

    await waitFor(() => expect(screen.getByText(en.projectRunCompleted)).toBeTruthy());
    const run = document.querySelector<HTMLElement>("[data-project-run]");
    expect(run?.dataset.outcome).toBe("completed");
    // The run names the artifact, so the relationship is visible rather than
    // implied.
    expect(
      run?.querySelector("[data-project-artifact='eeeeeeee-1111-4111-8111-111111111111']"),
    ).toBeTruthy();
    // And the surface says what a capture is, where it is displayed.
    expect(screen.getByText(en.projectCaptureMeaning)).toBeTruthy();
  });

  it("shows a failed capture with no artifact at all", async () => {
    const input = projectInput();
    mount(
      openProject({
        inputs: [input],
        runs: [
          {
            id: "ffffffff-2222-4111-8111-111111111111",
            operation: "captureFileFactsV1",
            outcome: "failed",
            inputIds: [input.id],
            outputArtifactIds: [],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-19T10:00:00Z",
            finishedAt: "2026-09-19T10:00:01Z",
          },
        ],
      }),
    );

    await waitFor(() => expect(screen.getByText(en.projectRunFailed)).toBeTruthy());
    expect(document.querySelector("[data-project-no-artifact]")).toBeTruthy();
    expect(document.querySelector("[data-project-artifact]")).toBeNull();
  });

  it("keeps the project on screen when an action is refused", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input], published: true }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    api.refuseOnce("saveProject", "staleDocument");
    await press(screen.getByRole("button", { name: en.projectSave }));

    // Twice on purpose, as the header does it: once visibly, and once in the
    // live region so a reader who is not looking at it is told.
    await waitFor(() => expect(screen.getAllByText(en.projectRefused)).toHaveLength(2));
    expect(
      document.querySelector("[data-live-region='project']")?.textContent,
    ).toBe(en.projectRefused);
    // The project is still there. A refusal changed nothing, including what the
    // reader is looking at.
    expect(screen.getByText(input.label)).toBeTruthy();
    expect(document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem"))
      .toBe("staleDocument");
  });

  it("changes nothing when a dialog is cancelled", async () => {
    const api = mount(openProject({ inputs: [] }));
    await waitFor(() => expect(screen.getByText(en.projectNoReferences)).toBeTruthy());

    api.cancelOnce("addProjectInput");
    api.set(openProject({ inputs: [projectInput()] }));
    await press(screen.getByRole("button", { name: en.projectAddReference }));

    // The answer was "cancelled", so the staged state is deliberately not
    // applied: nothing was chosen, so nothing changed.
    await waitFor(() => expect(api.calls).toContain("addProjectInput"));
    expect(screen.getByText(en.projectNoReferences)).toBeTruthy();
  });

  it("offers Save only once the project has somewhere to go", async () => {
    mount(openProject({ published: false }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    const save = screen.getByRole("button", { name: en.projectSave });
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(save.getAttribute("title")).toBe(en.projectSaveNeedsLocation);
    // Save As is the route, and it is available.
    expect(
      screen.getByRole("button", { name: en.projectSaveAs }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("captures only the references that were selected", async () => {
    const first = projectInput({ id: "aaaaaaaa-3333-4111-8111-111111111111", label: "one.mzML" });
    const second = projectInput({ id: "bbbbbbbb-3333-4111-8111-111111111111", label: "two.mzML" });
    const api = mount(openProject({ inputs: [first, second] }));
    await waitFor(() => expect(screen.getByText("one.mzML")).toBeTruthy());

    // Nothing selected is nothing to capture.
    expect(
      screen.getByRole("button", { name: en.projectCapture }).hasAttribute("disabled"),
    ).toBe(true);

    await press(within(row(first.id)).getByRole("checkbox"));
    await press(screen.getByRole("button", { name: en.projectCapture }));

    await waitFor(() => expect(api.captureProjectFileFacts).toHaveBeenCalled());
    expect(api.captureProjectFileFacts).toHaveBeenCalledWith([first.id]);
  });

  it("renders the whole surface in Simplified Chinese", async () => {
    mount(
      openProject({
        inputs: [
          projectInput({
            verification: "unavailable",
            unavailableReason: "incompleteRequiredMembers",
          }),
        ],
      }),
      "zh-CN",
    );

    await waitFor(() => expect(screen.getByText(zh.projectReferences)).toBeTruthy());
    expect(screen.getByRole("button", { name: zh.projectCheckLinks })).toBeTruthy();
    expect(screen.getByText(zh.projectStateIncomplete)).toBeTruthy();
    expect(screen.getByText(zh.projectPrivacy)).toBeTruthy();
    // The privacy disclosure and the outcome vocabulary are actually
    // translated, not copied.
    expect(zh.projectPrivacy).not.toEqual(en.projectPrivacy);
    expect(zh.projectStateIncomplete).not.toEqual(en.projectStateIncomplete);
  });

  it("is usable with nothing open and offers the two ways in", async () => {
    mount({
      open: false,
      name: "",
      dirty: false,
      published: false,
      inputs: [],
      artifacts: [],
      runs: [],
    });

    await waitFor(() => expect(screen.getByText(en.projectNone)).toBeTruthy());
    expect(screen.getByText(en.projectNoneHint)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.projectNew })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.projectOpen })).toBeTruthy();
    // Nothing claims a project that is not there.
    expect(screen.queryByText(en.projectReferences)).toBeNull();
  });
});
