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
import { describe, expect, it, type Mock } from "vitest";

import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  capturedProject,
  createFakeProjectApi,
  openProject,
  projectInput,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import { NO_PROJECT, ProjectApiProvider, type ProjectState } from "./projectApi";
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

  it("shows names and record titles as text, with one Details control per row", async () => {
    const api = mount(capturedProject());
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());

    // A name is something to read, not a second way to press the row.
    const name = screen.getByText("QC_pool_01.mzML");
    expect(name.closest("button")).toBeNull();
    const rows = [...document.querySelectorAll<HTMLElement>("[data-project-input], [data-project-run]")];
    expect(rows.length).toBeGreaterThan(1);
    for (const each of rows) {
      const details = within(each).getAllByRole("button", { name: /^Details for / });
      expect(details).toHaveLength(1);
      expect(details[0].textContent).toBe(en.projectDetails);
      expect(details[0].getAttribute("aria-controls")).toBe("workbench-inspector");
    }
    expect(screen.getByRole("button", { name: "Details for QC_pool_01.mzML" })).toBeTruthy();

    // The record is named by what it is, never by the action that makes one:
    // "Capture file facts" is the section's button and nothing else.
    const run = document.querySelector<HTMLElement>("[data-project-run]")!;
    expect(within(run).getByText(en.projectArtifactFileFacts).closest("button")).toBeNull();
    expect(screen.getAllByText(en.projectCapture)).toHaveLength(1);
    expect(screen.getByText(en.projectCapture).closest("[data-project-capture]")).toBeTruthy();

    // Its Details opens the record the run left, and says so on the control.
    const details = within(run).getByRole("button", { name: /^Details for / });
    await press(details);
    expect(details.getAttribute("aria-current")).toBe("true");
    expect(details.hasAttribute("data-project-inspect-artifact")).toBe(true);
    expect(api.calls.filter((call) => call !== "getProjectState")).toEqual([]);
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

  it("windows a long reference list, its rest one hidden spacer row", async () => {
    const inputs = Array.from({ length: 120 }, (_, index) =>
      projectInput({ id: `11111111-2222-4111-8111-${String(index).padStart(12, "0")}`, label: `run-${String(index)}.mzML` }));
    mount(openProject({ inputs }));
    await waitFor(() => expect(document.querySelector('.project-list[data-windowed="true"]')).not.toBeNull());
    const list = document.querySelector<HTMLElement>('.project-list[data-windowed="true"]')!;
    expect(list.querySelectorAll("[data-project-input]").length).toBeLessThan(inputs.length);
    expect(list.style.paddingBottom).toBe("");
    expect(list.querySelector(":scope > li.list-window-spacer:last-child")).toHaveAttribute("aria-hidden", "true");
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
            kind: "fileFactsV1",
            observedInputCount: 1,
            observedMemberCount: 1,
            qcSnapshot: null,
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
            layerIds: [],
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
            layerIds: [],
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

  it("keeps a reference recorded work used, and says why in its own words", async () => {
    const api = mount(capturedProject());
    await waitFor(() => expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy());

    api.refuseOnce("removeProjectInput", "inputUsedByRun");
    await press(screen.getByRole("button", { name: "Remove QC_pool_01.mzML from this project" }));

    await waitFor(() =>
      expect(
        document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem"),
      ).toBe("inputUsedByRun"),
    );
    expect(announced()).toBe(en.projectRefusedInputUsedByRun);
    // Nothing was cascaded: the reference, its run and its record all stay.
    expect(screen.getByText("QC_pool_01.mzML")).toBeTruthy();
    expect(document.querySelector("[data-project-run]")).toBeTruthy();
    expect(document.querySelector("[data-project-artifact]")).toBeTruthy();
    expect(zh.projectRefusedInputUsedByRun).not.toEqual(en.projectRefusedInputUsedByRun);
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

  it("names an exhausted revision in its own words rather than as an unknown refusal", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input], published: true }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    api.refuseOnce("saveProject", "revisionExhausted");
    await press(screen.getByRole("button", { name: en.projectSave }));

    await waitFor(() => expect(announced()).toBe(en.projectRefusedRevisionExhausted));
    expect(en.projectRefusedRevisionExhausted).not.toEqual(en.projectRefusedUnknown);
    expect(zh.projectRefusedRevisionExhausted).not.toEqual(en.projectRefusedRevisionExhausted);
    expect(screen.getByText(input.label)).toBeTruthy();
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
            layerIds: [],
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
      projectId: null,
      name: "",
      dirty: false,
      published: false,
      inputs: [],
      artifacts: [],
      runs: [],
      layers: [],
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

  it("keeps a cancelled check requested until its own answer, and not past it (PM9.5 O4)", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    const release = api.holdOnce("checkProjectLinks");
    await press(screen.getByRole("button", { name: en.projectCheckLinks }));
    const cancel = await screen.findByRole("button", { name: en.projectCancel });
    await press(cancel);

    // A request about the accepted operation, not an outcome: the check is
    // still running, and nothing says it was cancelled.
    expect(api.cancelled).toEqual(["project-job-1"]);
    expect(cancel.getAttribute("data-project-cancel")).toBe("project-job-1");
    expect(cancel.textContent).toBe(en.projectCancelRequested);
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    expect(announced()).toBe(en.projectCancelRequested);
    expect(document.querySelector("[data-project-busy='checking']")).toBeTruthy();
    expect(document.querySelector("[data-project-cancelled]")).toBeNull();
    // Inert while requested: a second press sends nothing.
    await press(cancel);
    expect(api.cancelled).toEqual(["project-job-1"]);

    // The check's own answer ends the request. It completed after all, so it
    // is not said to have been cancelled.
    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.querySelector("[data-project-busy]")).toBeNull());
    expect(document.querySelector("[data-project-cancel]")).toBeNull();
    expect(document.querySelector("[data-project-cancelled]")).toBeNull();
    expect(announced()).not.toBe(en.projectCancelRequested);

    // The next operation is its own: unrequested, under its own identifier,
    // and its Cancel sends one request for it.
    const releaseNext = api.holdOnce("checkProjectLinks");
    await press(screen.getByRole("button", { name: en.projectCheckLinks }));
    const next = await screen.findByRole("button", { name: en.projectCancel });
    expect(next.getAttribute("data-project-cancel")).toBe("project-job-2");
    expect(next.getAttribute("aria-disabled")).toBeNull();
    await press(next);
    expect(api.cancelled).toEqual(["project-job-1", "project-job-2"]);
    expect(next.textContent).toBe(en.projectCancelRequested);
    await act(async () => {
      releaseNext();
    });
    await waitFor(() => expect(document.querySelector("[data-project-cancel]")).toBeNull());
  });

  it("keeps a cancelled capture requested until its own answer, in Simplified Chinese (PM9.5 O4)", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }), "zh-CN");
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    await press(document.querySelector<HTMLElement>(`[data-project-input="${input.id}"] input[type="checkbox"]`)!);
    const release = api.holdOnce("captureProjectFileFacts");
    await press(screen.getByRole("button", { name: zh.projectCapture }));
    const cancel = await screen.findByRole("button", { name: zh.projectCancel });
    await press(cancel);
    await press(cancel);

    expect(api.cancelled).toEqual(["project-job-1"]);
    expect(cancel.textContent).toBe(zh.projectCancelRequested);
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    expect(announced()).toBe(zh.projectCancelRequested);
    expect(document.querySelector("[data-project-busy='capturing']")).toBeTruthy();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.querySelector("[data-project-cancel]")).toBeNull());
    expect(zh.projectCancelRequested).not.toEqual(en.projectCancelRequested);
  });

  it("stays requested through the re-read after a cancelled capture answers (PM9.5 O4)", async () => {
    const input = projectInput();
    const api = mount(openProject({ inputs: [input] }));
    await waitFor(() => expect(screen.getByText(input.label)).toBeTruthy());

    await press(row(input.id).querySelector<HTMLElement>("input[type='checkbox']")!);
    let refuse: (refusal: unknown) => void = () => undefined;
    (api.captureProjectFileFacts as Mock).mockImplementationOnce(
      () => new Promise((_, reject) => (refuse = reject)),
    );
    await press(screen.getByRole("button", { name: en.projectCapture }));
    await press(await screen.findByRole("button", { name: en.projectCancel }));

    // The capture answers as cancelled, and the surface re-reads the project
    // to show the run Rust recorded. Until that re-read is in, the surface is
    // still the capture's, and still says only that a cancel was requested --
    // never the busy text again, as if the work had resumed.
    const releaseReread = api.holdOnce("getProjectState");
    await act(async () => {
      refuse({ kind: "cancelled", summary: "cancelled", detail: null, retryable: false });
    });
    await waitFor(() => expect(document.querySelector("[data-project-cancel]")).toBeNull());
    expect(document.querySelector("[data-project-busy='capturing']")).toBeTruthy();
    expect(announced()).toBe(en.projectCancelRequested);
    expect(api.cancelled).toEqual(["project-job-1"]);

    await act(async () => {
      releaseReread();
    });
    await waitFor(() => expect(document.querySelector("[data-project-busy]")).toBeNull());
    expect(announced()).toBe(en.projectCancelled);
  });

  it("offers Save only once the project has somewhere to go", async () => {
    mount(openProject({ published: false }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    // `aria-disabled` rather than `disabled`, so the sentence explaining it is
    // reachable from the keyboard rather than only from a pointer -- and that
    // sentence is on screen beside the name, not a tooltip (PM9.7 F1).
    const save = screen.getByRole("button", { name: en.projectSave });
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.getAttribute("title")).toBeNull();
    const reason = document.getElementById(save.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(en.projectSaveNeedsLocation);
    expect(reason?.closest(".project-header")).toBeTruthy();
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
      projectId: null,
      name: "",
      dirty: false,
      published: false,
      inputs: [],
      artifacts: [],
      runs: [],
      layers: [],
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
            kind: "fileFactsV1",
            observedInputCount: 1,
            observedMemberCount: 1,
            qcSnapshot: null,
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
            layerIds: [],
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
    // The history section too, which is where English was leaking in.
    expect(screen.getByText(zh.projectRunCompleted)).toBeTruthy();
    expect(screen.getByText(zh.projectUnsaved)).toBeTruthy();
    expect(document.body.textContent).not.toContain("File facts: sample.mzML");
    // And a refusal reads in Chinese as well.
    api.refuseOnce("checkProjectLinks", "unstableRead");
    await press(screen.getByRole("button", { name: zh.projectCheckLinks }));
    await waitFor(() =>
      expect(screen.getAllByText(zh.projectRefusedUnstable).length).toBeGreaterThan(0),
    );

    // Translated, not copied.
    expect(zh.projectNoneHint).not.toEqual(en.projectNoneHint);
    expect(zh.projectStateIncomplete).not.toEqual(en.projectStateIncomplete);
    expect(zh.projectRefusedUnstable).not.toEqual(en.projectRefusedUnstable);
  });

  it("is usable with nothing open and offers the two ways in", async () => {
    const api = mount(NO_PROJECT);

    await waitFor(() => expect(screen.getByText(en.projectNone)).toBeTruthy());
    expect(screen.getByText(en.projectNoneHint)).toBeTruthy();
    // New project is the one emphasised next action; Open project… stays
    // offered beside it, live and reachable (PM9.7 F2).
    const create = screen.getByRole("button", { name: en.projectNew });
    const reopen = screen.getByRole("button", { name: en.projectOpen });
    expect(create.classList.contains("ui-button--primary")).toBe(true);
    expect(reopen.classList.contains("ui-button--secondary")).toBe(true);
    expect(document.querySelectorAll("[data-project-surface] .ui-button--primary")).toHaveLength(1);
    for (const offered of [create, reopen]) {
      expect(offered.getAttribute("aria-disabled")).toBeNull();
      expect((offered as HTMLButtonElement).disabled).toBe(false);
      offered.focus();
      expect(document.activeElement).toBe(offered);
    }
    // Emphasis only: showing the empty surface creates nothing, opens no
    // picker and starts no work.
    expect(api.calls).toEqual(["getProjectState"]);
    // Save, Save As and Close act on an open project, so with none they are
    // not offered at all: the head holds exactly the two ways in.
    for (const name of [en.projectSave, en.projectSaveAs, en.projectClose]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(
      [...document.querySelectorAll(".project-header button")].map((button) => button.textContent),
    ).toEqual([en.projectNew, en.projectOpen]);
    // Nothing claims a project that is not there.
    expect(screen.queryByText(en.projectReferences)).toBeNull();
  });

  it("emphasises New project with nothing open in Simplified Chinese too (PM9.7 F2)", async () => {
    const api = mount(NO_PROJECT, "zh-CN");

    await waitFor(() => expect(screen.getByText(zh.projectNone)).toBeTruthy());
    expect(screen.getByText(zh.projectNoneHint)).toBeTruthy();
    expect(screen.getByRole("button", { name: zh.projectNew }).classList.contains("ui-button--primary")).toBe(true);
    expect(screen.getByRole("button", { name: zh.projectOpen }).classList.contains("ui-button--secondary")).toBe(true);
    expect(document.querySelectorAll("[data-project-surface] .ui-button--primary")).toHaveLength(1);
    expect(api.calls).toEqual(["getProjectState"]);
  });

  it("keeps New project emphasised but refused while the surface is busy, and sends nothing", async () => {
    const api = mount(NO_PROJECT);
    await waitFor(() => expect(screen.getByText(en.projectNone)).toBeTruthy());

    const release = api.holdOnce("openProject");
    await press(screen.getByRole("button", { name: en.projectOpen }));
    await waitFor(() => expect(document.querySelector("[data-project-busy='opening']")).toBeTruthy());

    // A refused primary keeps its place and its Tab stop; the busy line is
    // its reason, and a press sends nothing.
    const create = screen.getByRole("button", { name: en.projectNew });
    expect(create.classList.contains("ui-button--primary")).toBe(true);
    expect(create.getAttribute("aria-disabled")).toBe("true");
    expect(create.getAttribute("aria-describedby")).toBe("project-busy-line");
    expect(document.getElementById("project-busy-line")?.textContent).toBe(en.projectBusyOpening);
    await press(create);
    expect(api.createProject).not.toHaveBeenCalled();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.querySelector("[data-project-busy]")).toBeNull());
  });

  it("makes Save As… the one filled primary while the project was never saved", async () => {
    mount(openProject({ inputs: [projectInput()], dirty: true }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    // New project gives up its emphasis once a project is open, and is a
    // bordered button like the rest of the head.
    expect(screen.getByRole("button", { name: en.projectNew }).classList.contains("ui-button--secondary")).toBe(true);
    expect(screen.getByRole("button", { name: en.projectOpen }).classList.contains("ui-button--secondary")).toBe(true);
    expect(screen.getByRole("button", { name: en.projectClose }).classList.contains("ui-button--secondary")).toBe(true);
    // Never saved: Save waits and says why in words beside the name; Save
    // As… is the way through, so it is the one filled primary on the surface.
    const save = screen.getByRole("button", { name: en.projectSave });
    expect(save.classList.contains("ui-button--primary")).toBe(false);
    expect(document.getElementById(save.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      en.projectSaveNeedsLocation,
    );
    const saveAs = screen.getByRole("button", { name: en.projectSaveAs });
    const primaries = document.querySelectorAll("[data-project-surface] .ui-button--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toBe(saveAs);
    expect(document.querySelector("[data-project-capture]")?.classList.contains("ui-button--primary")).toBe(false);
  });

  it("leaves the head without a primary once a saved project has nothing to save", async () => {
    mount(openProject({ inputs: [projectInput()], dirty: false, published: true }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    expect(document.querySelector(".project-header .ui-button--primary")).toBeNull();
    expect(screen.queryByText(en.projectSaveNeedsLocation)).toBeNull();
    // The surface's one primary is then the panel's own job.
    expect(document.querySelectorAll("[data-project-surface] .ui-button--primary")).toHaveLength(1);
    expect(document.querySelector("[data-project-capture]")?.classList.contains("ui-button--primary")).toBe(true);
  });

  it("keeps the keyboard on the head when Close takes Save, Save As… and Close away", async () => {
    const api = mount(openProject({ inputs: [projectInput()], published: true }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    api.set(NO_PROJECT);
    const close = screen.getByRole("button", { name: en.projectClose });
    close.focus();
    await press(close);
    await waitFor(() => expect(screen.getByText(en.projectNone)).toBeTruthy());

    expect(screen.queryByRole("button", { name: en.projectClose })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: en.projectNew }));
  });

  it("makes Save the one filled primary while a saved project has changes", async () => {
    mount(openProject({ inputs: [projectInput()], dirty: true, published: true }));
    await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

    const save = screen.getByRole("button", { name: en.projectSave });
    expect(save.classList.contains("ui-button--primary")).toBe(true);
    expect(save.getAttribute("aria-disabled")).toBeNull();
    expect(document.querySelectorAll("[data-project-surface] .ui-button--primary")).toHaveLength(1);
    expect(screen.getByText(en.projectUnsaved).hasAttribute("data-project-unsaved")).toBe(true);
  });

  it("labels a reference recorded from a conversion MSCanvas did not verify", async () => {
    const labelled = projectInput({ id: "labelled", label: "converted.mzML", notVerifiedByMscanvas: { unverifiedSettings: true, unverifiedBuildRelease: null } });
    const plain = projectInput({ id: "plain", label: "plain.mzML", notVerifiedByMscanvas: null });
    mount(openProject({ inputs: [labelled, plain] }));
    await waitFor(() => expect(screen.getByText("converted.mzML")).toBeTruthy());
    expect(row("labelled").querySelector("[data-not-verified]")?.textContent).toBe(en.m74CnvNotVerified);
    expect(row("plain").querySelector("[data-not-verified]")).toBeNull();
  });

  describe("before the Save that upgrades a beta-1 project", () => {
    const beta1 = (dirty: boolean) =>
      openProject({ inputs: [projectInput()], dirty, published: true, savingUpgradesSchema: true });

    it("asks first, and writes once only when the keyboard confirms", async () => {
      const api = mount(beta1(true));
      await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

      await press(screen.getByRole("button", { name: en.projectSave }));
      expect(api.saveProject).not.toHaveBeenCalled();
      expect(document.querySelector("[data-project-upgrade]")?.textContent).toContain(en.projectUpgradeWarning);
      // The question has the keyboard, so the next key press is the answer.
      const confirm = screen.getByRole("button", { name: en.projectUpgradeSave });
      expect(document.activeElement).toBe(confirm);
      await press(confirm);
      expect(api.saveProject).toHaveBeenCalledTimes(1);
      // Still one filled primary: the question adds none.
      expect(document.querySelectorAll("[data-project-surface] .ui-button--primary")).toHaveLength(1);
    });

    it("writes nothing on Cancel and hands the keyboard back to Save", async () => {
      const api = mount(beta1(true));
      await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());

      const save = screen.getByRole("button", { name: en.projectSave });
      await press(save);
      await press(screen.getByRole("button", { name: en.projectUpgradeCancel }));
      expect(api.saveProject).not.toHaveBeenCalled();
      expect(document.querySelector("[data-project-upgrade]")).toBeNull();
      expect(document.activeElement).toBe(save);
    });

    it("asks before the unsaved question's Save first as well", async () => {
      const api = mount(beta1(true));
      await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());
      api.refuseOnce("closeProject", "unsavedChanges");
      await press(screen.getByRole("button", { name: en.projectClose }));
      await press(await screen.findByRole("button", { name: en.projectUnsavedSaveFirst }));
      expect(api.saveProject).not.toHaveBeenCalled();
      expect(document.querySelector("[data-project-upgrade]")).toBeTruthy();
    });

    it("does not ask for a Save that writes nothing", async () => {
      const api = mount(beta1(false));
      await waitFor(() => expect(screen.getByText(en.projectReferences)).toBeTruthy());
      await press(screen.getByRole("button", { name: en.projectSave }));
      expect(document.querySelector("[data-project-upgrade]")).toBeNull();
      expect(api.saveProject).toHaveBeenCalledTimes(1);
    });

    it("says it in Simplified Chinese", async () => {
      mount(beta1(true), "zh-CN");
      const save = await screen.findByRole("button", { name: zh.projectSave });
      await press(save);
      expect(document.querySelector("[data-project-upgrade]")?.textContent).toContain(zh.projectUpgradeWarning);
      expect(zh.projectUpgradeWarning).not.toEqual(en.projectUpgradeWarning);
    });
  });
});
