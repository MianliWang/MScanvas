/**
 * A batch of independent targeted MS1 analyses (M9.4), as the setup offers it.
 *
 * What is proved here is what the page does: that the acquisitions are the
 * user's explicit choice and are sent in the project's order, that the review
 * shows one shared request and every member's own readiness, that one member
 * not ready holds the whole batch back, that a run is one accepted operation
 * whose one control stops it, and that each member's end is said in its own
 * words and opens its own result -- never several results at once. The fake
 * boundary answers with members this file chose. That a real batch runs one
 * worker at a time, isolates each member and records only members that
 * started is proved in `apps/desktop/src-tauri/src/targeted_ms1/tests/batch.rs`.
 */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  createFakeProjectApi,
  FAKE_ENGINE,
  openProject,
  projectInput,
  projectLayer,
  targetedPlan,
  targetedProject,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import {
  ProjectApiProvider,
  type BatchMemberProgress,
  type BatchResolution,
  type ProjectState,
} from "./projectApi";
import { ProjectPanel } from "./ProjectPanel";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { useProject } from "./useProject";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

const PLAN = targetedPlan();
const INPUTS = [
  projectInput({ verification: "matchingRecordedContent" }),
  projectInput({
    id: "11111111-1111-4111-8111-222222222222",
    label: "second.mzML",
    verification: "matchingRecordedContent",
  }),
  projectInput({
    id: "11111111-1111-4111-8111-333333333333",
    label: "第三 third.mzML",
    verification: "matchingRecordedContent",
  }),
];
const LAYERS = [
  projectLayer(),
  projectLayer({ id: "dddddddd-1111-4111-8111-222222222222", sourceInputId: INPUTS[1].id }),
  projectLayer({ id: "dddddddd-1111-4111-8111-333333333333", sourceInputId: INPUTS[2].id }),
];
const SHAS = [PLAN.planSha256, "D".repeat(64), "E".repeat(64)];
const RUN_A = "ffffffff-7777-4111-8111-111111111111";
const ARTIFACT_A = "eeeeeeee-7777-4111-8111-111111111111";
const RUN_B = "ffffffff-7777-4111-8111-222222222222";

/** A saved project with three layers and nothing run over them. */
function three(): ProjectState {
  return openProject({ published: true, inputs: INPUTS, layers: LAYERS });
}

/** What a review of all three answers, each member as `members` says. */
function reviewOf(
  members: Partial<Record<number, Partial<BatchResolution["members"][number]>>> = {},
): BatchResolution {
  return {
    problems: [],
    common: {
      recipe: PLAN.recipe,
      parameters: PLAN.parameters,
      targetListSha256: PLAN.targetListSha256,
      targets: PLAN.targets,
    },
    members: LAYERS.map((layer, index) => ({
      layerId: layer.id,
      inputId: layer.sourceInputId,
      planSha256: SHAS[index],
      expectedContent: [
        { role: "primary", relativeName: "", byteLength: 1024 + index, sha256: SHAS[index] },
      ],
      refused: null,
      blocked: null,
      ...members[index],
    })),
    engine: FAKE_ENGINE,
  };
}

function member(
  index: number,
  state: BatchMemberProgress["state"],
  extra: Partial<BatchMemberProgress> = {},
): BatchMemberProgress {
  return {
    layerId: LAYERS[index].id,
    planSha256: SHAS[index],
    state,
    runId: null,
    artifactId: null,
    reason: null,
    ...extra,
  };
}

/**
 * The project after a batch whose first member completed and whose second
 * failed because its source changed: the first member's run and result are
 * the ordinary completed-run fixture, and the third member has no run.
 */
function afterBatch(): ProjectState {
  const base = targetedProject();
  const completed = base.runs[0];
  return {
    ...base,
    inputs: INPUTS,
    layers: [
      base.layers[0],
      { ...LAYERS[1], consumedByRunIds: [RUN_B] },
      LAYERS[2],
    ],
    runs: [
      completed,
      {
        ...completed,
        id: RUN_B,
        outcome: "failed",
        layerIds: [LAYERS[1].id],
        outputArtifactIds: [],
        targetedMs1: {
          ...completed.targetedMs1!,
          planSha256: SHAS[1],
          consumedContent: [],
          attempt: null,
          failure: { code: "sourceChanged", stage: "source" },
        },
      },
    ],
  };
}

function Harness() {
  const session = useProject();
  return (
    <>
      <ProjectPanel session={session} detailsPresent />
      <aside id="workbench-inspector">
        <ProvenanceDetails provenance={session.provenance} onSelect={session.inspect} />
      </aside>
    </>
  );
}

function mount(state: ProjectState, locale: "en" | "zh-CN" = "en") {
  const api = createFakeProjectApi(state);
  render(
    <PreferencesApiProvider
      value={createFakePreferencesApi({ stored: storedRecord({ appearance: { locale } }) })}
    >
      <SessionPreferencesProvider>
        <ProjectApiProvider value={api}>
          <Harness />
        </ProjectApiProvider>
      </SessionPreferencesProvider>
    </PreferencesApiProvider>,
  );
  return api;
}

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

async function type(control: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(control, { target: { value } });
  });
}

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  return element;
}

function caused(api: FakeProjectApi) {
  return api.calls.filter((call) => call !== "getProjectState");
}

/**
 * Opens the setup from the first layer, chooses the other two -- the third
 * before the second -- and reviews the typed text.
 */
async function reviewAll(api: FakeProjectApi, label: string = en.projectReferences) {
  await screen.findByText(label);
  await press(query(`[data-project-targeted="${LAYERS[0].id}"]`));
  await press(query(`[data-targeted-member="${LAYERS[2].id}"]`));
  await press(query(`[data-targeted-member="${LAYERS[1].id}"]`));
  await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
  await press(query("[data-targeted-review]"));
  return api;
}

afterEach(() => {
  cleanup();
});

describe("choosing acquisitions", () => {
  it("offers every layer with only the one that opened the setup chosen", async () => {
    mount(three());
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-targeted="${LAYERS[1].id}"]`));
    const boxes = LAYERS.map((layer) =>
      query<HTMLInputElement>(`[data-targeted-member="${layer.id}"]`),
    );
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false]);
    expect(query("[data-targeted-members] legend").textContent).toBe(en.targetedAcquisitions);
    // One chosen acquisition is a single run, as before.
    expect(query("[data-targeted-run]").textContent).toBe(en.targetedRun);
  });

  it("reviews one chosen acquisition as a single plan, whichever it is", async () => {
    const api = mount(three());
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-targeted="${LAYERS[0].id}"]`));
    await press(query(`[data-targeted-member="${LAYERS[0].id}"]`));
    await press(query(`[data-targeted-member="${LAYERS[2].id}"]`));
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    await press(query("[data-targeted-review]"));
    expect(api.resolveTargetedMs1Plan).toHaveBeenCalledWith(
      expect.objectContaining({ layerId: LAYERS[2].id }),
    );
    expect(api.resolveTargetedMs1Batch).not.toHaveBeenCalled();
  });

  it("with none chosen, asks nothing", async () => {
    const api = mount(three());
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-targeted="${LAYERS[0].id}"]`));
    await press(query(`[data-targeted-member="${LAYERS[0].id}"]`));
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    const review = query("[data-targeted-review]");
    expect(review.getAttribute("aria-disabled")).toBe("true");
    await press(review);
    expect(caused(api)).toEqual([]);
  });
});

describe("a batch review", () => {
  it("sends the chosen layers in the project's order with the text typed once, and shows every member", async () => {
    const api = mount(three());
    api.setTargeted({ batchResolution: reviewOf() });
    await reviewAll(api);

    expect(api.resolveTargetedMs1Batch).toHaveBeenCalledWith({
      layerIds: LAYERS.map((layer) => layer.id),
      mzHalfWidthPpm: "5",
      expectedPeakWidthS: "6",
      targets: [
        { label: "Caffeine", formula: "C8H10N4O2", rtS: "120", rtHalfWidthS: "30", neutralMass: null },
      ],
    });
    expect(api.resolveTargetedMs1Plan).not.toHaveBeenCalled();

    // The one request every member shares, once.
    const targets = query(`[data-targeted-batch-targets="${PLAN.targetListSha256}"]`);
    expect(within(targets).getByText("Caffeine")).toBeTruthy();
    // What a batch is and is not, said where it is reviewed.
    expect(query("[data-targeted-batch-independent]").textContent).toBe(
      en.targetedBatchIndependent.replace("{{count}}", "3"),
    );
    // Every member, in order, each ready.
    const rows = within(query("[data-targeted-batch-members]")).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-targeted-batch-plan"))).toEqual(
      LAYERS.map((layer) => layer.id),
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      `1${INPUTS[0].label}${en.targetedBatchReady}`,
      `2${INPUTS[1].label}${en.targetedBatchReady}`,
      `3${INPUTS[2].label}${en.targetedBatchReady}`,
    ]);
    // Each member's own plan is on request, not by default.
    const planDetails = query<HTMLDetailsElement>("[data-targeted-batch-details]");
    expect(planDetails.open).toBe(false);
    expect(planDetails.textContent).toContain(SHAS[1]);

    const run = query("[data-targeted-run]");
    expect(run.textContent).toBe(en.targetedRunBatch.replace("{{count}}", "3"));
    expect(run.getAttribute("aria-disabled")).toBeNull();
  });

  it("holds the whole batch back while any member is not ready, and says why for each", async () => {
    const api = mount(three());
    api.setTargeted({
      batchResolution: reviewOf({
        1: { blocked: "insufficientWorkAreaSpace" },
        2: { planSha256: null, expectedContent: [], refused: "recipeSourceUnsupported" },
      }),
    });
    await reviewAll(api);

    expect(
      query(`[data-targeted-batch-plan="${LAYERS[1].id}"]`).getAttribute("data-ready"),
    ).toBe("insufficientWorkAreaSpace");
    expect(query(`[data-targeted-batch-plan="${LAYERS[1].id}"]`).textContent).toContain(
      en.projectRefusedInsufficientWorkAreaSpace,
    );
    expect(query(`[data-targeted-batch-plan="${LAYERS[2].id}"]`).textContent).toContain(
      en.projectRefusedRecipeSourceUnsupported,
    );
    const run = query("[data-targeted-run]");
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(run.getAttribute("title")).toBe(en.targetedBatchNotReady);
    await press(run);
    expect(api.runTargetedMs1Batch).not.toHaveBeenCalled();
  });

  it("a changed choice makes the batch on screen a batch of something else", async () => {
    const api = mount(three());
    api.setTargeted({ batchResolution: reviewOf() });
    await reviewAll(api);
    await press(query(`[data-targeted-member="${LAYERS[1].id}"]`));
    expect(document.querySelector("[data-targeted-batch-members]")).toBeNull();
    expect(query("[data-targeted-run]").getAttribute("aria-disabled")).toBe("true");
  });

  it("names a refused request in its own words", async () => {
    const api = mount(three());
    api.refuseOnce("resolveTargetedMs1Batch", "batchDuplicateInput");
    await reviewAll(api);
    expect(query('[data-project-problem="batchDuplicateInput"]').textContent).toContain(
      en.projectRefusedBatchDuplicate,
    );
  });
});

describe("a batch run", () => {
  it("runs the reviewed plans as one operation, reports each member, and stops through one control", async () => {
    const api = mount(three());
    api.setTargeted({
      batchResolution: reviewOf(),
      progress: {
        operationId: "project-job-1",
        phase: "runningEngine",
        batch: [
          member(0, "completed", { runId: RUN_A, artifactId: ARTIFACT_A }),
          member(1, "running"),
          member(2, "queued"),
        ],
      },
    });
    await reviewAll(api);

    const release = api.holdOnce("runTargetedMs1Batch");
    await press(query("[data-targeted-run]"));
    expect(caused(api)).toEqual([
      "resolveTargetedMs1Batch",
      "beginProjectJob",
      "runTargetedMs1Batch",
    ]);
    expect(api.runTargetedMs1Batch).toHaveBeenCalledWith("project-job-1", SHAS);

    // Each member's execution state, the running one with its phase.
    await screen.findByText(en.targetedBatchRunningTitle);
    const progress = query('[data-targeted-batch="running"]');
    expect(
      within(progress)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.getAttribute("data-state")),
    ).toEqual(["completed", "running", "queued"]);
    expect(query(`[data-targeted-batch-member="${LAYERS[1].id}"]`).textContent).toContain(
      en.targetedPhaseRunningEngine,
    );
    // The project on screen holds no member's run until the batch ends, so a
    // finished member is not offered yet.
    expect(document.querySelector("[data-targeted-batch-open]")).toBeNull();
    expect(document.querySelector("[data-targeted-batch-run]")).toBeNull();
    expect(query('[data-project-busy="analysing"]').textContent).toContain(
      en.projectBusyBatch.replace("{{position}}", "2").replace("{{total}}", "3"),
    );
    // One operation, one Stop, named the same wherever it is offered.
    expect(query('[data-project-cancel="project-job-1"]').textContent).toBe(en.targetedBatchStop);
    const stop = query("[data-targeted-batch-stop]");
    expect(stop.textContent).toBe(en.targetedBatchStop);
    await press(stop);
    expect(api.cancelled).toEqual(["project-job-1"]);
    expect(stop.textContent).toBe(en.targetedBatchStopping);
    await press(stop);
    expect(api.cancelled).toEqual(["project-job-1"]);

    api.set(afterBatch());
    api.setTargeted({
      batchMembers: [
        member(0, "completed", { runId: RUN_A, artifactId: ARTIFACT_A }),
        member(1, "cancelled", { runId: RUN_B }),
        member(2, "notStarted"),
      ],
    });
    await act(async () => {
      release();
    });

    const ended = query('[data-targeted-batch="ended"]');
    expect(query("[data-targeted-batch-summary]").textContent).toBe(
      [
        en.targetedBatchCountCompleted.replace("{{count}}", "1").replace("{{total}}", "3"),
        en.targetedBatchCountCancelled.replace("{{count}}", "1"),
        en.targetedBatchCountNotRun.replace("{{count}}", "1"),
      ].join(" · "),
    );
    expect(query(`[data-targeted-batch-member="${LAYERS[2].id}"]`).textContent).toContain(
      en.targetedBatchStoppedBefore,
    );
    expect(document.querySelector("[data-targeted-batch-stop]")).toBeNull();
    expect(document.querySelector("[data-live-region='project']")?.textContent).toBe(
      en.targetedBatchEndedAnnouncement.replace(
        "{{summary}}",
        query("[data-targeted-batch-summary]").textContent ?? "",
      ),
    );
    // Nothing is opened on arrival: a batch has no one result.
    expect(document.querySelector("[data-targeted-report]")).toBeNull();

    // A completed member opens its own result, in the existing report.
    await press(within(ended).getByRole("button", { name: `Open the result for ${INPUTS[0].label}` }));
    expect(query(`[data-targeted-report="${ARTIFACT_A}"]`)).toBeTruthy();
  });

  it("does not carry a finished batch's progress into a later single run", async () => {
    const api = mount(three());
    api.setTargeted({
      batchResolution: reviewOf(),
      progress: {
        operationId: "project-job-1",
        phase: "runningEngine",
        batch: [member(0, "running"), member(1, "queued"), member(2, "queued")],
      },
    });
    await reviewAll(api);
    const releaseBatch = api.holdOnce("runTargetedMs1Batch");
    await press(query("[data-targeted-run]"));
    await screen.findByText(en.targetedBatchRunningTitle);
    api.setTargeted({ batchMembers: [member(0, "completed"), member(1, "completed"), member(2, "completed")] });
    await act(async () => {
      releaseBatch();
    });

    // One acquisition chosen again: a single run, whose progress has no batch.
    await press(query(`[data-targeted-member="${LAYERS[1].id}"]`));
    await press(query(`[data-targeted-member="${LAYERS[2].id}"]`));
    await press(query("[data-targeted-review]"));
    // A progress read that has not answered yet: what the busy line says
    // until it does is the session's own state.
    vi.mocked(api.getTargetedMs1Progress).mockImplementation(() => new Promise(() => undefined));
    api.holdOnce("runTargetedMs1");
    await press(query("[data-targeted-run]"));
    expect(query('[data-project-busy="analysing"]').textContent).toContain(en.projectBusyAnalysing);
    expect(query('[data-project-busy="analysing"]').textContent).not.toContain(
      en.projectBusyBatch.split("{{position}}")[0] ?? "",
    );
  });

  it("says each member's end in its own words and never as a finding", async () => {
    const api = mount(three());
    api.setTargeted({
      batchResolution: reviewOf(),
      // Mid-batch: one member completed, one failed, one running.
      progress: {
        operationId: "project-job-1",
        phase: "loadingSource",
        batch: [
          member(0, "completed", { runId: RUN_A, artifactId: ARTIFACT_A }),
          member(1, "failed", { runId: RUN_B }),
          member(2, "running"),
        ],
      },
    });
    await reviewAll(api);
    const release = api.holdOnce("runTargetedMs1Batch");
    await press(query("[data-targeted-run]"));
    await screen.findByText(en.targetedBatchRunningTitle);
    await screen.findByText(en.targetedBatchStateFailed);
    // Neither a finished member's result nor its run is offered while the
    // project on screen holds neither.
    expect(document.querySelector("[data-targeted-batch-open]")).toBeNull();
    expect(document.querySelector("[data-targeted-batch-run]")).toBeNull();

    api.set(afterBatch());
    api.setTargeted({
      batchMembers: [
        member(0, "completed", { runId: RUN_A, artifactId: ARTIFACT_A }),
        member(1, "failed", { runId: RUN_B }),
        member(2, "refused", { reason: "insufficientWorkAreaSpace" }),
      ],
    });
    await act(async () => {
      release();
    });

    await screen.findByText(en.targetedBatchEndedTitle);
    expect(query(`[data-targeted-batch-member="${LAYERS[1].id}"]`).textContent).toContain(
      en.targetedFailureSourceChanged,
    );
    expect(query(`[data-targeted-batch-member="${LAYERS[2].id}"]`).textContent).toContain(
      `${en.targetedBatchStateRefused} — ${en.projectRefusedInsufficientWorkAreaSpace}`,
    );
    expect(query("[data-targeted-batch-summary]").textContent).toBe(
      [
        en.targetedBatchCountCompleted.replace("{{count}}", "1").replace("{{total}}", "3"),
        en.targetedBatchCountFailed.replace("{{count}}", "1"),
        en.targetedBatchCountNotRun.replace("{{count}}", "1"),
      ].join(" · "),
    );
    // Execution states only: no member's target outcomes are on this panel.
    const panel = query('[data-targeted-batch="ended"]');
    expect(panel.textContent).not.toContain(en.targetedOutcomeDetected);
    expect(panel.textContent).not.toContain(en.targetedOutcomeNotDetected);
    expect(panel.textContent).toContain(en.targetedBatchOperationalNote);

    // A failed member shows its own run in Details.
    await press(query(`[data-targeted-batch-run="${RUN_B}"]`));
    expect(query("#workbench-inspector").textContent).toContain(en.targetedFailureSourceChanged);
  });
});

describe("in Simplified Chinese", () => {
  it("reviews and reports a batch in the chosen language", async () => {
    const api = mount(three(), "zh-CN");
    api.setTargeted({ batchResolution: reviewOf() });
    await reviewAll(api, zh.projectReferences);
    expect(query("[data-targeted-members] legend").textContent).toBe(zh.targetedAcquisitions);
    expect(query("[data-targeted-batch-independent]").textContent).toBe(
      zh.targetedBatchIndependent.replace("{{count}}", "3"),
    );
    expect(query("[data-targeted-run]").textContent).toBe(
      zh.targetedRunBatch.replace("{{count}}", "3"),
    );
    api.set(afterBatch());
    api.setTargeted({
      batchMembers: [
        member(0, "completed", { runId: RUN_A, artifactId: ARTIFACT_A }),
        member(1, "failed", { runId: RUN_B }),
        member(2, "notStarted"),
      ],
    });
    await press(query("[data-targeted-run]"));
    await screen.findByText(zh.targetedBatchEndedTitle);
    expect(query(`[data-targeted-batch-member="${LAYERS[2].id}"]`).textContent).toContain(
      zh.targetedBatchStoppedBefore,
    );
  });
});
