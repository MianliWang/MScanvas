/**
 * The targeted MS1 recipe, as the interface offers and shows it.
 *
 * What is proved here is what the *page* does: that the setup sends the typed
 * text and nothing it decided itself, shows every problem where it was typed,
 * runs only a reviewed plan and names that run for Cancel; and that a stored
 * result is read through bounded reads, drawn from the evidence it holds, and
 * said to be missing or corrupt rather than shown. The fake project boundary
 * answers with rows and evidence this file chose. That a real run pins and
 * links its source, supervises the worker, fails closed and stores a
 * validated result beside the project is proved against the pinned runtime in
 * `apps/desktop/src-tauri/src/targeted_ms1/tests.rs`.
 */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  absentRow,
  createFakeProjectApi,
  detectedRow,
  FAKE_ENGINE,
  openProject,
  projectInput,
  projectLayer,
  targetedPlan,
  targetedProject,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import { ProjectApiProvider, type ProjectState } from "./projectApi";
import { ProjectPanel } from "./ProjectPanel";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { parseTargets } from "./TargetedMs1";
import { useProject } from "./useProject";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

const LAYER = projectLayer().id;
const PLAN = targetedPlan();
const RUN = "ffffffff-7777-4111-8111-111111111111";
const ARTIFACT = "eeeeeeee-7777-4111-8111-111111111111";
const DETECTED = PLAN.targets[0].targetId;
const ABSENT = PLAN.targets[1].targetId;

/** A saved project with one layer and nothing run over it yet. */
function layered(overrides: Partial<ProjectState> = {}): ProjectState {
  return openProject({
    published: true,
    inputs: [projectInput({ verification: "matchingRecordedContent" })],
    layers: [projectLayer()],
    ...overrides,
  });
}

/** The completed project, with its one targeted run rewritten. */
function withRun(
  run: Partial<ProjectState["runs"][number]>,
  execution: Partial<NonNullable<ProjectState["runs"][number]["targetedMs1"]>>,
): ProjectState {
  const base = targetedProject();
  const recorded = base.runs[0];
  return {
    ...base,
    artifacts: [],
    runs: [
      {
        ...recorded,
        outputArtifactIds: [],
        ...run,
        targetedMs1: { ...recorded.targetedMs1!, ...execution },
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

const details = () => query("#workbench-inspector");
const liveRegion = () =>
  document.querySelector("[data-live-region='project']")?.textContent ?? "";

/** Opens the setup from the layer row. */
async function openSetup(label: string = en.projectReferences) {
  await screen.findByText(label);
  await press(query(`[data-project-targeted="${LAYER}"]`));
  return query(`[data-targeted-setup="${LAYER}"]`);
}

/** The user's actions caused these calls, in order. Reads on mount are not theirs. */
function caused(api: FakeProjectApi) {
  return api.calls.filter((call) => call !== "getProjectState");
}

afterEach(() => {
  cleanup();
});

describe("the typed target text", () => {
  it("splits on tabs where a line has them and on commas otherwise, skipping blanks and comments", () => {
    const parsed = parseTargets(
      [
        "# label, formula, rt, half-width",
        "Caffeine, C8H10N4O2, 120, 30",
        "",
        "Adenine\tC5H5N5\t300\t20\t135.0545",
        "Tab, with, comma\tC6H6\t10\t5",
      ].join("\r\n"),
    );
    expect(parsed.overfull).toBeNull();
    expect(parsed.lines).toEqual([2, 4, 5]);
    expect(parsed.targets).toEqual([
      { label: "Caffeine", formula: "C8H10N4O2", rtS: "120", rtHalfWidthS: "30", neutralMass: null },
      { label: "Adenine", formula: "C5H5N5", rtS: "300", rtHalfWidthS: "20", neutralMass: "135.0545" },
      // A label may hold a comma where the line is tab-separated.
      { label: "Tab, with, comma", formula: "C6H6", rtS: "10", rtHalfWidthS: "5", neutralMass: null },
    ]);
  });

  it("names the first line with more cells than there are columns rather than dropping any", () => {
    const parsed = parseTargets("A, C6H6, 10, 5\nB, C6H6, 10, 5, 78, extra");
    expect(parsed.overfull).toBe(2);
  });

  it("leaves every value as typed, missing cells as empty text for Rust to refuse", () => {
    const parsed = parseTargets("Only a label");
    expect(parsed.targets).toEqual([
      { label: "Only a label", formula: "", rtS: "", rtHalfWidthS: "", neutralMass: null },
    ]);
  });
});

describe("the setup", () => {
  it("opens from the layer row, takes the keyboard, and sends nothing until asked", async () => {
    const api = mount(layered());
    const setup = await openSetup();

    const control = query(`[data-project-targeted="${LAYER}"]`);
    expect(control.getAttribute("aria-label")).toBe(`Targeted MS1 for ${projectInput().label}`);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe(en.targetedSetupTitle);
    expect(within(setup).getByText(en.targetedExperimental)).toBeTruthy();
    expect(within(setup).getByText(en.targetedDomain)).toBeTruthy();
    // Run is reachable but inert, and says why.
    const run = query("[data-targeted-run]");
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(run.getAttribute("title")).toBe(en.targetedRunNeedsReview);
    await press(run);
    expect(caused(api)).toEqual([]);

    await press(query("[data-targeted-close]"));
    expect(document.querySelector("[data-targeted-setup]")).toBeNull();
    expect(document.activeElement).toBe(control);
  });

  it("sends the layer and the typed text exactly, and shows the plan Rust answered", async () => {
    const api = mount(layered());
    await openSetup();
    await type(query("[data-targeted-ppm]"), " 5 ");
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30\nAbsent\tC9H9NO4\t300\t30");
    await press(query("[data-targeted-review]"));

    expect(api.resolveTargetedMs1Plan).toHaveBeenCalledWith({
      layerId: LAYER,
      mzHalfWidthPpm: " 5 ",
      expectedPeakWidthS: "6",
      targets: [
        { label: "Caffeine", formula: "C8H10N4O2", rtS: "120", rtHalfWidthS: "30", neutralMass: null },
        { label: "Absent", formula: "C9H9NO4", rtS: "300", rtHalfWidthS: "30", neutralMass: null },
      ],
    });
    expect(caused(api)).toEqual(["resolveTargetedMs1Plan"]);

    const plan = query(`[data-targeted-plan="${PLAN.planSha256}"]`);
    expect(within(plan).getByText("Caffeine")).toBeTruthy();
    expect(within(plan).getAllByText(en.targetedMassFromFormula)).toHaveLength(2);
    expect(query("[data-targeted-engine]").textContent).toContain(
      `${FAKE_ENGINE.package} ${FAKE_ENGINE.version}`,
    );
    expect(query("[data-targeted-run]").getAttribute("aria-disabled")).toBeNull();
    // The whole fixed profile the engine runs with, as the build answered it.
    expect(query("[data-targeted-profile] pre").textContent).toBe(FAKE_ENGINE.fixedProfile);

    // An edit makes the plan on screen a plan for other text.
    await type(query("[data-targeted-width]"), "8");
    expect(document.querySelector("[data-targeted-plan]")).toBeNull();
    expect(query("[data-targeted-run]").getAttribute("aria-disabled")).toBe("true");
  });

  it("shows each problem at the line it was typed on, and cannot run", async () => {
    const api = mount(layered());
    api.setTargeted({
      resolution: {
        plan: null,
        problems: [
          { row: 2, field: "formula", problem: "invalid" },
          { row: null, field: "mzHalfWidthPpm", problem: "outOfRange" },
        ],
        blocked: null,
        engine: FAKE_ENGINE,
      },
    });
    await openSetup();
    await type(query("[data-targeted-text]"), "# comment\nA, C6H6, 10, 5\n\nB, Xx9, 10, 5");
    await press(query("[data-targeted-review]"));

    const problems = query("[data-targeted-problems]");
    const rows = within(problems).getAllByRole("row").slice(1);
    // Rust's second row is the fourth line typed.
    expect(rows[0].textContent).toBe(
      `${en.targetedWhereLine.replace("{{line}}", "4")}${en.targetedFieldFormula}${en.targetedProblemInvalid}`,
    );
    expect(rows[1].textContent).toBe(
      `${en.targetedWhereParameters}${en.targetedFieldMzHalfWidth}${en.targetedProblemOutOfRange}`,
    );
    expect(query("[data-targeted-run]").getAttribute("aria-disabled")).toBe("true");
  });

  it("says why a reviewed plan cannot run here, in the refusal's own words", async () => {
    const api = mount(layered({ published: false }));
    api.setTargeted({
      resolution: { plan: PLAN, problems: [], blocked: "notYetPublished", engine: FAKE_ENGINE },
    });
    await openSetup();
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    await press(query("[data-targeted-review]"));

    expect(query('[data-targeted-blocked="notYetPublished"]').textContent).toBe(
      en.projectRefusedNotYetPublished,
    );
    const run = query("[data-targeted-run]");
    expect(run.getAttribute("aria-disabled")).toBe("true");
    await press(run);
    expect(api.runTargetedMs1).not.toHaveBeenCalled();
  });

  it("refuses a line with too many values before anything is sent", async () => {
    const api = mount(layered());
    await openSetup();
    await type(query("[data-targeted-text]"), "A, C6H6, 10, 5, 78, 9");
    await press(query("[data-targeted-review]"));
    expect(query('[data-targeted-overfull="1"]').textContent).toBe(
      en.targetedLineOverfull.replace("{{line}}", "1"),
    );
    expect(caused(api)).toEqual([]);
  });
});

/** Reviews the default plan in an open setup. */
async function reviewed(api: FakeProjectApi) {
  await openSetup();
  await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
  await press(query("[data-targeted-review]"));
  return api;
}

describe("a run", () => {
  it("runs the reviewed plan as an accepted operation, reports its phase, and can be cancelled", async () => {
    const api = mount(layered());
    api.setTargeted({ progress: { operationId: "project-job-1", phase: "runningEngine" } });
    await reviewed(api);

    const release = api.holdOnce("runTargetedMs1");
    await press(query("[data-targeted-run]"));
    expect(caused(api)).toEqual(["resolveTargetedMs1Plan", "beginProjectJob", "runTargetedMs1"]);
    expect(api.runTargetedMs1).toHaveBeenCalledWith("project-job-1", PLAN.planSha256);

    // The phase Rust reports, read without replacing the project.
    await screen.findAllByText(en.targetedPhaseRunningEngine);
    expect(query('[data-project-busy="analysing"]').textContent).toContain(en.projectBusyAnalysing);
    // Every other control waits; the setup cannot be closed from under the run.
    expect(query("[data-targeted-close]").getAttribute("aria-disabled")).toBe("true");
    expect(query(`[data-project-targeted="${LAYER}"]`).getAttribute("aria-disabled")).toBe("true");

    await press(query('[data-project-cancel="project-job-1"]'));
    expect(api.cancelled).toEqual(["project-job-1"]);

    api.set(withRun({ outcome: "cancelled" }, {
      attempt: null,
      consumedContent: [],
      stop: { reason: "cancelRequested", workerTerminated: true, exitObserved: true },
    }));
    await act(async () => release());

    // Recorded, and said to be the user's own decision rather than a refusal.
    expect(query("[data-project-cancelled]").textContent).toBe(en.projectCancelledRunRecorded);
    expect(document.body.textContent).not.toContain(en.projectCancelled);
    expect(document.querySelector("[data-project-problem]")).toBeNull();
    expect(query('[data-targeted-last="cancelled"]').textContent).toBe(en.targetedLastCancelled);
    // The run is what the press produced, so Details shows it, with its stop.
    expect(query(`[data-project-inspect-run="${RUN}"]`).getAttribute("aria-current")).toBe("true");
    const region = within(details());
    expect(region.getByText(en.projectOperationTargetedMs1)).toBeTruthy();
    expect(query('[data-targeted-stop="cancelRequested"]').textContent).toContain(
      en.targetedStopCancel,
    );
    expect(query("[data-targeted-not-read]").textContent).toBe(en.targetedSourceNotRead);
  });

  it("opens the stored result it produced", async () => {
    const api = mount(layered());
    await reviewed(api);
    api.set(targetedProject());
    await press(query("[data-targeted-run]"));

    // The report title is also the record's name in the history and Details.
    await screen.findByText(en.targetedRowsCaption);
    expect(query('[data-targeted-last="completed"]').textContent).toBe(en.targetedLastCompleted);
    expect(liveRegion()).toBe(en.targetedLastCompleted);
    expect(query(`[data-targeted-report="${ARTIFACT}"]`)).toBeTruthy();
    expect(api.readTargetedMs1Rows).toHaveBeenCalledWith(ARTIFACT, 0);

    // Announced once: a later Save does not say it again, while the setup's
    // own paragraph still does.
    await press(screen.getByRole("button", { name: en.projectSave }));
    expect(api.saveProject).toHaveBeenCalledTimes(1);
    expect(liveRegion()).not.toContain(en.targetedLastCompleted);
    expect(query('[data-targeted-last="completed"]')).toBeTruthy();
  });

  it("records a failure in its own words and never as an absence", async () => {
    const api = mount(layered());
    await reviewed(api);
    api.set(
      withRun(
        { outcome: "failed" },
        { failure: { code: "sourceRtNotStrictlyIncreasing", stage: "source" } },
      ),
    );
    await press(query("[data-targeted-run]"));

    expect(query('[data-targeted-last="failed"]').textContent).toBe(
      `${en.targetedLastFailed} ${en.targetedFailureSourceRtRepeated}`,
    );
    expect(query('[data-targeted-failure="sourceRtNotStrictlyIncreasing"]').textContent).toBe(
      en.targetedFailureSourceRtRepeated,
    );
    expect(details().textContent).toContain(
      en.targetedFailureStage.replace("{{stage}}", en.targetedStageSource),
    );
    expect(document.body.textContent).not.toContain(en.targetedOutcomeNotDetected);
    expect(document.querySelector("[data-targeted-report]")).toBeNull();
    // Said to a reader who cannot see the paragraph, too.
    expect(liveRegion()).toBe(`${en.targetedLastFailed} ${en.targetedFailureSourceRtRepeated}`);
  });

  it("reports a refusal before a run existed as a refusal, with nothing recorded", async () => {
    const api = mount(layered());
    await reviewed(api);
    api.refuseOnce("runTargetedMs1", "sourceOnAnotherVolume");
    await press(query("[data-targeted-run]"));

    expect(query('[data-project-problem="sourceOnAnotherVolume"]').textContent).toContain(
      en.projectRefusedSourceOnAnotherVolume,
    );
    expect(document.querySelector("[data-targeted-last]")).toBeNull();
  });
});

describe("a stored result", () => {
  async function inspectResult(state: ProjectState = targetedProject(), locale: "en" | "zh-CN" = "en") {
    const api = mount(state, locale);
    await screen.findByText(locale === "en" ? en.projectReferences : zh.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    return api;
  }

  it("reads one bounded page of rows and says each outcome in words", async () => {
    const api = await inspectResult();
    const report = query(`[data-targeted-report="${ARTIFACT}"]`);
    expect(report.getAttribute("data-availability")).toBe("available");
    await within(report).findByText(en.targetedRowsCaption);

    expect(api.readTargetedMs1Rows).toHaveBeenCalledTimes(1);
    expect(api.readTargetedMs1Rows).toHaveBeenCalledWith(ARTIFACT, 0);
    expect(api.readTargetedMs1Evidence).not.toHaveBeenCalled();
    expect(query('[data-targeted-count="detected"]').textContent).toBe(
      `${en.targetedOutcomeDetected}1`,
    );
    const detected = query(`[data-targeted-row="${DETECTED}"]`);
    expect(detected.textContent).toContain(en.targetedOutcomeDetected);
    const absent = query(`[data-targeted-row="${ABSENT}"]`);
    expect(absent.textContent).toContain(en.targetedOutcomeNotDetected);
    expect(absent.getAttribute("data-outcome")).toBe("NOT_DETECTED");
    expect(within(report).getByText(en.targetedMeaning)).toBeTruthy();
    expect(query("[data-targeted-no-selection]").textContent).toBe(en.targetedChooseRow);
    // The history names the result by its outcome counts, in the report's own
    // words, not by the stored label.
    expect(query(`[data-project-artifact="${ARTIFACT}"]`).textContent).toContain(
      `1 ${en.targetedOutcomeDetected} · 1 ${en.targetedOutcomeNotDetected}`,
    );
  });

  it("draws the chosen target's extracted points and reported bounds, with every value in a table", async () => {
    const api = await inspectResult();
    await screen.findByText(en.targetedRowsCaption);
    const choose = query(`[data-targeted-choose="${DETECTED}"]`);
    expect(choose.getAttribute("aria-label")).toBe("Show the evidence for Caffeine");
    await press(choose);
    expect(choose.getAttribute("aria-pressed")).toBe("true");
    expect(api.readTargetedMs1Evidence).toHaveBeenCalledWith(ARTIFACT, DETECTED);

    const plot = await screen.findByRole("img");
    expect(plot.closest("[data-targeted-plot]")).toBeTruthy();
    expect(document.querySelectorAll("[data-targeted-trace]")).toHaveLength(2);
    expect(document.querySelectorAll('[data-targeted-trace="0"] circle')).toHaveLength(3);
    expect(document.querySelector("[data-targeted-feature]")).toBeTruthy();
    expect(document.querySelector("[data-targeted-window]")).toBeTruthy();
    // The one candidate is the feature, so nothing else is outlined.
    expect(document.querySelectorAll("[data-targeted-candidate]")).toHaveLength(0);
    expect(document.querySelector("figcaption")?.textContent).toContain("M 195.0877, M+1 196.0911");
    expect(document.querySelectorAll(".targeted-points tbody tr")).toHaveLength(6);

    const facts = query("[data-targeted-facts]");
    expect(facts.textContent).toContain("[M+H]+");
    expect(facts.textContent).toContain(en.targetedIntensityFromModel);
    expect(facts.textContent).toContain("0 (converged)");
    expect(within(query("[data-targeted-selected]")).getByText(en.targetedIntensityNote)).toBeTruthy();
  });

  it("says an absent target's extraction was empty rather than drawing a feature", async () => {
    const api = await inspectResult();
    api.setTargeted({
      evidence: {
        [ABSENT]: {
          targetId: ABSENT,
          traces: [{ targetId: ABSENT, trace: 0, mzTheoretical: 196.0604, points: [[1, 280, 0], [2, 300, 0]] }],
        },
      },
    });
    await screen.findByText(en.targetedRowsCaption);
    await press(query(`[data-targeted-choose="${ABSENT}"]`));
    await screen.findByRole("img");
    expect(document.querySelector("[data-targeted-feature]")).toBeNull();
    expect(query("[data-targeted-facts]").textContent).toContain(
      en.targetedSignalNone.replace("{{count}}", "3"),
    );
  });

  it("reads nothing where the stored rows are missing, and says how to recover", async () => {
    const api = await inspectResult(targetedProject("payloadMissing"));
    expect(query('[data-targeted-unavailable="payloadMissing"]').textContent).toBe(
      en.targetedPayloadMissing,
    );
    expect(api.readTargetedMs1Rows).not.toHaveBeenCalled();
    // The record and its counts stay: the document still holds them.
    expect(query('[data-targeted-count="targets"]').textContent).toContain("2");
    expect(query('[data-provenance-availability="payloadMissing"]').textContent).toBe(
      en.targetedPayloadMissing,
    );
  });

  it("shows a read that found the rows corrupt as corrupt, not as an empty result", async () => {
    const state = targetedProject();
    const api = mount(state);
    api.refuseOnce("readTargetedMs1Rows", "payloadCorrupt");
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    const refused = await screen.findByText(en.targetedPayloadCorrupt);
    expect(refused.getAttribute("data-targeted-rows-refused")).toBe("payloadCorrupt");
    expect(document.querySelector("[data-targeted-row]")).toBeNull();
  });

  it("walks from the result to its run, plan and attempt in Details without sending anything", async () => {
    const api = await inspectResult();
    const before = caused(api).length;
    const region = details();
    expect(region.textContent).toContain(en.provenanceTargetedStored);
    expect(query("[data-targeted-plan-facts]").textContent).toContain(PLAN.planSha256);
    expect(query("[data-targeted-attempt]").textContent).toContain("pyOpenMS 3.5.0");
    expect(query("[data-targeted-consumed]").textContent).toContain("1,024");
    expect(caused(api).length).toBe(before);
  });

  it("renders the setup, the report and Details with no English prose left over", async () => {
    await inspectResult(targetedProject(), "zh-CN");
    await screen.findByText(zh.targetedRowsCaption);
    await press(query(`[data-targeted-choose="${DETECTED}"]`));
    await screen.findByRole("img");
    await press(query(`[data-project-targeted="${LAYER}"]`));

    for (const key of [
      "targetedSetupTitle",
      "targetedExperimental",
      "targetedDomain",
      "targetedReportTitle",
      "targetedMeaning",
      "targetedIntensityNote",
      "targetedOutcomeDetected",
      "targetedOutcomeNotDetected",
      "provenanceTargetedStored",
      "targetedAttemptNote",
    ] as const) {
      expect(document.body.textContent, key).toContain(zh[key]);
      expect(document.body.textContent, key).not.toContain(en[key]);
    }
    const control = query(`[data-project-targeted="${LAYER}"]`);
    expect(control.getAttribute("aria-label")).toBe(`对 ${projectInput().label} 做靶向 MS1`);
  });
});

describe("the recovery note", () => {
  function recovered(notDetected: number, failed: number): ProjectState {
    const state = targetedProject();
    const artifact = state.artifacts[0];
    const result = artifact.targetedMs1!.result;
    return {
      ...state,
      artifacts: [
        {
          ...artifact,
          targetedMs1: {
            ...artifact.targetedMs1!,
            result: {
              ...result,
              noCandidateRecovery: true,
              summary: { ...result.summary, detected: 0, notDetected, failed, targets: 2 },
            },
          },
        },
      ],
    };
  }

  it("speaks of the absences the recovery recorded", async () => {
    mount(recovered(2, 0));
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    expect(query("[data-targeted-recovery]").textContent).toBe(en.targetedRecoveryNote);
  });

  it("is absent where the recovery recorded none", async () => {
    mount(recovered(0, 2));
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    expect(document.querySelector("[data-targeted-recovery]")).toBeNull();
  });
});

describe("while something is out", () => {
  it("holds the typed text during a review, so a late answer cannot name other text", async () => {
    const api = mount(layered());
    await openSetup();
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    const release = api.holdOnce("resolveTargetedMs1Plan");
    await press(query("[data-targeted-review]"));
    for (const selector of ["[data-targeted-ppm]", "[data-targeted-width]", "[data-targeted-text]"]) {
      expect(query<HTMLInputElement>(selector).disabled, selector).toBe(true);
    }
    await act(async () => release());
    expect(query<HTMLInputElement>("[data-targeted-ppm]").disabled).toBe(false);
  });

  it("leaves the unsaved-changes question unanswerable until a run ends", async () => {
    const api = mount(layered({ dirty: true }));
    await openSetup();
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    await press(query("[data-targeted-review]"));
    // Asked after the review, so the question is still standing at Run.
    api.refuseOnce("openProject", "unsavedChanges");
    await press(screen.getByRole("button", { name: en.projectOpen }));
    await screen.findByText(en.projectUnsavedSaveFirst);

    const release = api.holdOnce("runTargetedMs1");
    await press(query("[data-targeted-run]"));
    const saveFirst = screen.getByRole("button", { name: en.projectUnsavedSaveFirst });
    const discard = query("[data-project-discard]");
    expect(saveFirst.getAttribute("aria-disabled")).toBe("true");
    expect(discard.getAttribute("aria-disabled")).toBe("true");
    await press(saveFirst);
    await press(discard);
    expect(api.saveProject).not.toHaveBeenCalled();
    expect(api.openProject).toHaveBeenCalledTimes(1);
    // The run is still the thing on screen, with its Cancel.
    expect(query('[data-project-cancel="project-job-1"]')).toBeTruthy();
    api.set(targetedProject());
    await act(async () => release());
    // A finished operation retires the question, as every other one does: the
    // Open it was about is asked again, not answered on the run's behalf.
    expect(document.querySelector("[data-project-pending]")).toBeNull();
    expect(api.openProject).toHaveBeenCalledTimes(1);
  });
});

describe("rows the fixtures do not cover by default", () => {
  it("reads no evidence for a row that never reached extraction, and says it has no points", async () => {
    const api = mount(targetedProject());
    api.setTargeted({
      rows: [
        detectedRow(),
        absentRow({
          outcome: "FAILED",
          failureReason: "TARGET_ABSENT_FROM_ENGINE_LIBRARY",
          ion: null,
          windows: null,
          signal: null,
        }),
      ],
    });
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    await screen.findByText(en.targetedRowsCaption);
    await press(query(`[data-targeted-choose="${ABSENT}"]`));
    expect(api.readTargetedMs1Evidence).not.toHaveBeenCalled();
    expect(query("[data-targeted-selected] [data-targeted-no-points]").textContent).toBe(
      en.targetedNoPoints,
    );
    expect(document.querySelector("[data-targeted-evidence-refused]")).toBeNull();
  });

  it("names a window no spectrum fell into as a failure, and counts it as one", async () => {
    const state = targetedProject();
    const artifact = state.artifacts[0];
    const summary = { ...artifact.targetedMs1!.result.summary, notDetected: 0, failed: 1 };
    const api = mount({
      ...state,
      artifacts: [
        {
          ...artifact,
          targetedMs1: {
            ...artifact.targetedMs1!,
            result: { ...artifact.targetedMs1!.result, summary },
          },
        },
      ],
    });
    api.setTargeted({
      rows: [
        detectedRow(),
        absentRow({
          outcome: "FAILED",
          failureReason: "WINDOW_WITHOUT_MS1_PEAKS",
          signal: { points: 0, sum: [0, 0], max: [0, 0], anyNonzeroPoint: false },
        }),
      ],
    });
    await screen.findByText(en.projectReferences);
    expect(query(`[data-project-artifact="${ARTIFACT}"]`).textContent).toContain(
      `1 ${en.targetedOutcomeDetected} · 1 ${en.targetedOutcomeFailed}`,
    );
    expect(query(`[data-project-artifact="${ARTIFACT}"]`).textContent).not.toContain(
      en.targetedOutcomeNotDetected,
    );
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    await screen.findByText(en.targetedRowsCaption);
    const row = query(`[data-targeted-row="${ABSENT}"]`);
    expect(row.textContent).toContain(en.targetedRowFailureWindowWithoutMs1);
    expect(row.textContent).not.toContain(en.targetedOutcomeNotDetected);
  });

  it("gives a failed row its reason and never the absence's word", async () => {
    const api = mount(targetedProject());
    api.setTargeted({
      rows: [
        detectedRow(),
        absentRow({
          outcome: "FAILED",
          failureReason: "ENGINE_DISCARDED_NO_VALID_FIT",
          candidates: [{ apexRtS: 300, leftS: 296, rightS: 304, rawArea: 10 }],
        }),
      ],
    });
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    await screen.findByText(en.targetedRowsCaption);
    const row = query(`[data-targeted-row="${ABSENT}"]`);
    expect(row.textContent).toContain(en.targetedOutcomeFailed);
    expect(row.textContent).toContain(en.targetedRowFailureNoValidFit);
    expect(row.textContent).not.toContain(en.targetedOutcomeNotDetected);
  });
});
