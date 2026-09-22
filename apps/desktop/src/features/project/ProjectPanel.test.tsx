/**
 * The project surface, driven through its boundary.
 *
 * What these establish is what the interface does: which outcomes a reader can
 * tell apart, that relinking costs a deliberate second press, that a refusal
 * says which refusal it was and leaves the project on screen, and that the
 * surface works with no converter anywhere in the composition. The store is a
 * fake and is labelled one in `projectFixtures`; the filesystem claims are
 * proved in Rust.
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

/** What the one live region currently says. */
function announced(): string {
  return document.querySelector("[data-live-region='project']")?.textContent ?? "";
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

  it("falls back to unreadable when an unavailable reference names no reason", async () => {
    // A shape the wire type permits. It must render a sentence rather than
    // nothing, and must not throw.
    const input = projectInput({ verification: "unavailable", unavailableReason: null });
    mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());
    expect(within(row(input.id)).getByText(en.projectStateUnreadable)).toBeTruthy();
  });

  it("names every per-row control for the reference it acts on", async () => {
    const first = projectInput({ id: "aaaaaaaa-7777-4111-8111-111111111111", label: "one.mzML" });
    const second = projectInput({ id: "bbbbbbbb-7777-4111-8111-111111111111", label: "two.mzML" });
    mount(openProject({ inputs: [first, second] }));
    await waitFor(() => expect(screen.getByText("one.mzML")).toBeTruthy());

    // A button list that read "Locate, Remove, Locate, Remove" is one a reader
    // can act on wrongly. Each control says which file it is for.
    for (const input of [first, second]) {
      expect(screen.getByRole("button", { name: `Locate ${input.label}` })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: `Remove ${input.label} from this project` }),
      ).toBeTruthy();
      expect(
        screen.getByRole("checkbox", { name: `Include ${input.label} in the next capture` }),
      ).toBeTruthy();
    }
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
    await press(screen.getByRole("button", { name: `Locate ${input.label}` }));

    await waitFor(() =>
      expect(within(row(input.id)).getByText(en.projectRelinkMatches)).toBeTruthy(),
    );
    expect(api.calls).toContain("proposeProjectRelink");
    expect(api.calls).not.toContain("commitProjectRelink");
    // Still unavailable: the record has not moved.
    expect(row(input.id).dataset.verification).toBe("unavailable");
    // What the proposal found is announced, not only drawn, and the keyboard
    // follows to the control the flow just created.
    expect(announced()).toBe(en.projectRelinkMatches);
    expect(document.activeElement).toBe(
      within(row(input.id)).getByRole("button", { name: en.projectRelinkConfirm }),
    );

    api.set(
      openProject({
        inputs: [projectInput({ ...input, verification: "matchingRecordedContent" })],
      }),
    );
    await press(within(row(input.id)).getByRole("button", { name: en.projectRelinkConfirm }));

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
    await press(screen.getByRole("button", { name: `Locate ${input.label}` }));

    // Two independent facts, and the surface reports the second rather than
    // presenting the move as though it had restored the file.
    await waitFor(() =>
      expect(within(row(input.id)).getByText(en.projectRelinkDiffers)).toBeTruthy(),
    );
  });

  it("changes nothing when a relink dialog is cancelled", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    api.cancelOnce("proposeProjectRelink");
    api.set(openProject({ inputs: [projectInput({ ...input, relinkProposed: true })] }));
    await press(screen.getByRole("button", { name: `Locate ${input.label}` }));

    await waitFor(() => expect(api.calls).toContain("proposeProjectRelink"));
    expect(document.querySelector("[data-project-proposal]")).toBeNull();
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
            producedByRunId: "ffffffff-1111-4111-8111-111111111111",
            sourceInputIds: [input.id],
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
    // The instant is formatted for a reader, and the machine-readable form is
    // kept where a machine can still find it.
    const when = run?.querySelector("time");
    expect(when?.getAttribute("datetime")).toBe("2026-09-19T10:00:01Z");
    expect(when?.textContent).not.toBe("2026-09-19T10:00:01Z");
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

  it("says which refusal it was, and keeps the project on screen", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input], published: true }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    api.refuseOnce("saveProject", "staleDocument");
    await press(screen.getByRole("button", { name: en.projectSave }));

    // The specific sentence, not "that was refused". A stale document, a file
    // this project references and a disk that would not take the write need
    // different things from the reader.
    await waitFor(() =>
      expect(screen.getAllByText(en.projectRefusedStaleDocument).length).toBeGreaterThan(0),
    );
    expect(en.projectRefusedStaleDocument).not.toEqual(en.projectRefusedDestinationAliasesInput);
    // Announced once. The sentence appears twice -- once visibly, once in the
    // hidden region -- but the visible notice carries no role of its own, so
    // there is one live region and one voice.
    expect(announced()).toBe(en.projectRefusedStaleDocument);
    const banner = document.querySelector("[data-project-problem]");
    expect(banner?.getAttribute("role")).toBeNull();
    expect(banner?.getAttribute("aria-live")).toBeNull();
    // The project is still there. A refusal changed nothing, including what the
    // reader is looking at.
    expect(screen.getByText(input.label)).toBeTruthy();
    expect(
      document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem"),
    ).toBe("staleDocument");
  });

  it("treats a cancellation as a decision rather than a refusal", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    api.refuseOnce("captureProjectFileFacts", "cancelled");
    // The cancelled run the backend records either way.
    api.set(
      openProject({
        inputs: [input],
        dirty: true,
        runs: [
          {
            id: "ffffffff-3333-4111-8111-111111111111",
            operation: "captureFileFactsV1",
            outcome: "cancelled",
            inputIds: [input.id],
            outputArtifactIds: [],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-19T10:00:00Z",
            finishedAt: "2026-09-19T10:00:01Z",
          },
        ],
      }),
    );
    await press(
      screen.getByRole("checkbox", { name: `Include ${input.label} in the next capture` }),
    );
    await press(screen.getByRole("button", { name: en.projectCapture }));

    await waitFor(() => expect(screen.getByText(en.projectRunCancelled)).toBeTruthy());
    // Not an error banner. Telling someone their own cancellation was "refused
    // and nothing was changed" would also contradict the cancelled run that
    // appears directly below it.
    expect(document.querySelector("[data-project-problem]")).toBeNull();
    expect(document.querySelector("[data-project-cancelled]")).toBeTruthy();
    expect(announced()).toBe(en.projectCancelled);
  });

  it("asks about unsaved changes instead of refusing in a loop", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input], dirty: true }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());
    expect(document.querySelector("[data-project-unsaved]")).toBeTruthy();

    api.refuseOnce("closeProject", "unsavedChanges");
    await press(screen.getByRole("button", { name: en.projectClose }));

    // A question with an answer, not an error the user cannot get past.
    await waitFor(() =>
      expect(screen.getAllByText(en.projectUnsavedQuestion).length).toBeGreaterThan(0),
    );
    expect(document.querySelector("[data-project-problem]")).toBeNull();
    expect(
      document.querySelector("[data-project-pending]")?.getAttribute("data-project-pending"),
    ).toBe("close");

    api.set({
      open: false,
      name: "",
      dirty: false,
      published: false,
      inputs: [],
      artifacts: [],
      runs: [],
    });
    await press(screen.getByRole("button", { name: en.projectUnsavedDiscard }));

    // Discarding actually gets through, which is the thing that was impossible
    // while the page decided `discardUnsaved` for the user.
    await waitFor(() => expect(screen.getByText(en.projectNone)).toBeTruthy());
    expect(api.closeProject).toHaveBeenLastCalledWith(true);
  });

  it("keeps the project when the unsaved question is answered by keeping it", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input], dirty: true }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    api.refuseOnce("closeProject", "unsavedChanges");
    await press(screen.getByRole("button", { name: en.projectClose }));
    await waitFor(() =>
      expect(screen.getAllByText(en.projectUnsavedQuestion).length).toBeGreaterThan(0),
    );

    await press(screen.getByRole("button", { name: en.projectUnsavedKeepEditing }));

    expect(screen.queryAllByText(en.projectUnsavedQuestion)).toHaveLength(0);
    expect(screen.getByText(input.label)).toBeTruthy();
    // Exactly one close attempt: abandoning the question does not retry it.
    expect(api.closeProject).toHaveBeenCalledTimes(1);
  });

  it("says what it is doing while a check runs, and offers to stop it", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    const release = api.holdOnce("checkProjectLinks");
    await press(screen.getByRole("button", { name: en.projectCheckLinks }));

    // A check reads every referenced file whole. Silence and dim buttons are
    // not a state; this says which operation is running and announces it.
    await waitFor(() =>
      expect(screen.getAllByText(en.projectBusyChecking).length).toBeGreaterThan(0),
    );
    expect(announced()).toBe(en.projectBusyChecking);
    expect(document.querySelector("[data-project-surface]")?.getAttribute("aria-busy")).toBe(
      "true",
    );

    // The accept came first and minted the identifier; the run carried it;
    // the cancel names exactly that one.
    expect(api.calls.indexOf("beginProjectJob")).toBeLessThan(
      api.calls.indexOf("checkProjectLinks"),
    );
    expect(api.checkProjectLinks).toHaveBeenCalledWith("project-job-1");
    await press(screen.getByRole("button", { name: en.projectCancel }));
    expect(api.cancelled).toEqual(["project-job-1"]);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryAllByText(en.projectBusyChecking)).toHaveLength(0));
    // Once the answer is in, there is nothing to cancel and no control that
    // would try.
    expect(screen.queryByRole("button", { name: en.projectCancel })).toBeNull();
  });

  it("offers no Cancel while nothing is running", async () => {
    const api = mount(openProject({ inputs: [projectInput()] }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    // Idle. A cancel now would name nothing, so there is nothing to press.
    expect(screen.queryByRole("button", { name: en.projectCancel })).toBeNull();
    expect(api.cancelProjectJob).not.toHaveBeenCalled();
  });

  it("does not offer Cancel for a save, which is not an operation a cancel can name", async () => {
    const api = mount(openProject({ inputs: [projectInput()], published: true }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    const release = api.holdOnce("saveProject");
    await press(screen.getByRole("button", { name: en.projectSave }));
    await waitFor(() =>
      expect(screen.getAllByText(en.projectBusySaving).length).toBeGreaterThan(0),
    );
    // Busy, and deliberately without a Cancel: a save has no accepted
    // operation behind it, so a press could only have landed on something
    // else.
    expect(screen.queryByRole("button", { name: en.projectCancel })).toBeNull();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryAllByText(en.projectBusySaving)).toHaveLength(0));
  });

  it("does not report a late or stale cancel as a refusal", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    // The boundary answers that the named operation is not the one running.
    // That is the boundary saying it did nothing, and it is not an error.
    api.setCancelOutcome("stale");
    const release = api.holdOnce("checkProjectLinks");
    await press(screen.getByRole("button", { name: en.projectCheckLinks }));
    await waitFor(() => expect(screen.getByRole("button", { name: en.projectCancel })).toBeTruthy());
    await press(screen.getByRole("button", { name: en.projectCancel }));
    await act(async () => {
      release();
    });

    await waitFor(() => expect(screen.queryAllByText(en.projectBusyChecking)).toHaveLength(0));
    expect(document.querySelector("[data-project-problem]")).toBeNull();
    expect(document.querySelector("[data-project-cancelled]")).toBeNull();
    expect(screen.getByText(input.label)).toBeTruthy();
  });

  it("offers Save only once the project has somewhere to go", async () => {
    mount(openProject({ published: false }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    // `aria-disabled` rather than `disabled`, so the sentence explaining it is
    // reachable from the keyboard rather than only from a pointer.
    const save = screen.getByRole("button", { name: en.projectSave });
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.getAttribute("title")).toBe(en.projectSaveNeedsLocation);
    expect(
      screen.getByRole("button", { name: en.projectSaveAs }).getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("captures only the references that were selected, and says why it cannot", async () => {
    const first = projectInput({ id: "aaaaaaaa-3333-4111-8111-111111111111", label: "one.mzML" });
    const second = projectInput({ id: "bbbbbbbb-3333-4111-8111-111111111111", label: "two.mzML" });
    const api = mount(openProject({ inputs: [first, second] }));
    await waitFor(() => expect(screen.getByText("one.mzML")).toBeTruthy());

    // Nothing selected is nothing to capture -- and the reason is on the
    // control rather than left for the reader to guess.
    const capture = screen.getByRole("button", { name: en.projectCapture });
    expect(capture.getAttribute("aria-disabled")).toBe("true");
    expect(capture.getAttribute("title")).toBe(en.projectCaptureNeedsSelection);
    await press(capture);
    expect(api.captureProjectFileFacts).not.toHaveBeenCalled();

    await press(screen.getByRole("checkbox", { name: "Include one.mzML in the next capture" }));
    await press(screen.getByRole("button", { name: en.projectCapture }));

    await waitFor(() => expect(api.captureProjectFileFacts).toHaveBeenCalled());
    expect(api.captureProjectFileFacts).toHaveBeenCalledWith("project-job-1", [first.id]);
  });

  it("drops a selection whose reference the project no longer has", async () => {
    const first = projectInput({ id: "aaaaaaaa-4444-4111-8111-111111111111", label: "one.mzML" });
    const second = projectInput({ id: "bbbbbbbb-4444-4111-8111-111111111111", label: "two.mzML" });
    const api = mount(openProject({ inputs: [first, second] }));
    await waitFor(() => expect(screen.getByText("one.mzML")).toBeTruthy());

    await press(screen.getByRole("checkbox", { name: "Include one.mzML in the next capture" }));
    await press(screen.getByRole("checkbox", { name: "Include two.mzML in the next capture" }));

    api.set(openProject({ inputs: [second] }));
    await press(screen.getByRole("button", { name: "Remove one.mzML from this project" }));
    await waitFor(() => expect(screen.queryByText("one.mzML")).toBeNull());

    await press(screen.getByRole("button", { name: en.projectCapture }));
    // A capture must not send an identifier the project no longer has: Rust
    // refuses it, and the whole capture would be lost to a stale tick.
    await waitFor(() => expect(api.captureProjectFileFacts).toHaveBeenCalled());
    expect(api.captureProjectFileFacts).toHaveBeenCalledWith("project-job-1", [second.id]);
  });

  it("does not let a slow first read undo what the user did meanwhile", async () => {
    const api = createFakeProjectApi({
      open: false,
      name: "",
      dirty: false,
      published: false,
      inputs: [],
      artifacts: [],
      runs: [],
    });
    const releaseInitial = api.holdOnce("getProjectState");
    const preferences = createFakePreferencesApi({ stored: storedRecord() });
    render(
      <PreferencesApiProvider value={preferences}>
        <SessionPreferencesProvider>
          <ProjectApiProvider value={api}>
            <Harness />
          </ProjectApiProvider>
        </SessionPreferencesProvider>
      </PreferencesApiProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: en.projectNew })).toBeTruthy());
    api.set(openProject({ inputs: [projectInput()] }));
    await press(screen.getByRole("button", { name: en.projectNew }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    // The initial read finally answers, with what was true before the project
    // existed. Applying it would put the interface back to "no project open"
    // while Rust holds one.
    await act(async () => {
      releaseInitial();
    });
    expect(screen.getByText(en.projectReferences)).toBeTruthy();
    expect(screen.queryByText(en.projectNoneHint)).toBeNull();
  });

  it("renders the whole surface in Simplified Chinese", async () => {
    const input = projectInput({
      verification: "unavailable",
      unavailableReason: "incompleteRequiredMembers",
    });
    const api = mount(
      openProject({
        inputs: [input],
        dirty: true,
        artifacts: [
          {
            id: "eeeeeeee-5555-4111-8111-111111111111",
            // The backend writes this label in English. It must not reach the
            // screen.
            label: "File facts: sample.mzML",
            observedInputCount: 1,
            observedMemberCount: 1,
            producedByRunId: "ffffffff-5555-4111-8111-111111111111",
            sourceInputIds: [input.id],
          },
        ],
        runs: [
          {
            id: "ffffffff-5555-4111-8111-111111111111",
            operation: "captureFileFactsV1",
            outcome: "completed",
            inputIds: [input.id],
            outputArtifactIds: ["eeeeeeee-5555-4111-8111-111111111111"],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-19T10:00:00Z",
            finishedAt: "2026-09-19T10:00:01Z",
          },
        ],
      }),
      "zh-CN",
    );

    await waitFor(() => expect(screen.getByText(zh.projectReferences)).toBeTruthy());
    expect(screen.getByRole("button", { name: zh.projectCheckLinks })).toBeTruthy();
    expect(screen.getByText(zh.projectStateIncomplete)).toBeTruthy();
    expect(screen.getByText(zh.projectPrivacy)).toBeTruthy();
    // The history section too, which is where English was leaking in.
    expect(screen.getByText(zh.projectRunCompleted)).toBeTruthy();
    expect(screen.getByText(zh.projectCaptureMeaning)).toBeTruthy();
    expect(screen.getByText(zh.projectUnsaved)).toBeTruthy();
    expect(document.body.textContent).not.toContain("File facts: sample.mzML");
    // And a refusal reads in Chinese as well.
    api.refuseOnce("checkProjectLinks", "unstableRead");
    await press(screen.getByRole("button", { name: zh.projectCheckLinks }));
    await waitFor(() =>
      expect(screen.getAllByText(zh.projectRefusedUnstable).length).toBeGreaterThan(0),
    );

    // Translated, not copied.
    expect(zh.projectPrivacy).not.toEqual(en.projectPrivacy);
    expect(zh.projectStateIncomplete).not.toEqual(en.projectStateIncomplete);
    expect(zh.projectRefusedUnstable).not.toEqual(en.projectRefusedUnstable);
    expect(zh.projectCaptureMeaning).not.toEqual(en.projectCaptureMeaning);
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
