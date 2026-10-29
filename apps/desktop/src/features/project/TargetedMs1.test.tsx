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
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  absentRow,
  appears,
  createFakeProjectApi,
  detectedRow,
  FAKE_ENGINE,
  openProject,
  projectInput,
  projectLayer,
  projectRun,
  targetedPlan,
  targetedProject,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import projectStyles from "./project.css?raw";
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

/** With `reveal`, Details is folded and `reveal` is the header's control that shows it. */
function Harness({ reveal }: { readonly reveal?: () => void }) {
  const session = useProject();
  return (
    <>
      <ProjectPanel session={session} detailsPresent={reveal === undefined} onRevealDetails={reveal} />
      <aside id="workbench-inspector">
        <ProvenanceDetails provenance={session.provenance} onSelect={session.inspect} />
      </aside>
    </>
  );
}

function mount(
  state: ProjectState,
  locale: "en" | "zh-CN" = "en",
  prepare: (api: FakeProjectApi) => void = () => undefined,
  reveal?: () => void,
) {
  const api = createFakeProjectApi(state);
  prepare(api);
  render(
    <PreferencesApiProvider
      value={createFakePreferencesApi({ stored: storedRecord({ appearance: { locale } }) })}
    >
      <SessionPreferencesProvider>
        <ProjectApiProvider value={api}>
          <Harness reveal={reveal} />
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

/** The text a control's description points at, one entry per described element. */
function described(control: Element) {
  return (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

/** Whether `first` comes before `second` in the document. */
function precedes(first: Element, second: Element) {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
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
    expect(described(run)).toEqual([en.targetedRunNeedsReview]);
    await press(run);
    expect(caused(api)).toEqual([]);

    await press(query("[data-targeted-close]"));
    expect(document.querySelector("[data-targeted-setup]")).toBeNull();
    expect(document.activeElement).toBe(control);
  });

  it("keeps the recipe's scope and caveats before Run, with no read-path narration (PM9.5 O1)", async () => {
    mount(layered());
    const setup = await openSetup();
    const run = query("[data-targeted-run]");

    // Experimental, not a validated method, not identification, Not detected
    // not an absence, positive-mode centroided MS1 and [M+H]+: all read before
    // Run, none of it folded away. Which of the two lines carries a caveat is
    // wording; that the pair carries every one of them is the rule.
    for (const text of [en.targetedExperimental, en.targetedDomain]) {
      const shown = within(setup).getByText(text);
      expect(shown.closest("details")).toBeNull();
      expect(precedes(shown, run)).toBe(true);
    }
    const caveats = `${en.targetedExperimental} ${en.targetedDomain}`;
    expect(caveats).toContain("not identification");
    expect(caveats).toMatch(/not a validated quantitative method/i);
    expect(caveats).toContain(`${en.targetedOutcomeNotDetected} is not proof`);
    expect(caveats).toContain("positive-mode, centroided MS1");
    expect(caveats).toContain("[M+H]+");
    // The no-modify promise is said before Run, not only by the run's phases.
    expect(caveats).toContain("The source file is never changed.");
    // The same caveats, in the words zh-CN already uses for them.
    const zhCaveats = `${zh.targetedExperimental} ${zh.targetedDomain}`;
    expect(zhCaveats).toContain("这不是鉴定");
    expect(zhCaveats).toContain(`${zh.targetedOutcomeNotDetected}并不证明`);
    expect(zhCaveats).toContain("正离子模式、已质心化的 MS1");
    expect(zhCaveats).toContain("[M+H]+");
    expect(zhCaveats).toContain("来源文件不会被更改。");

    // How the source is read is not narrated in the setup; the run's Details
    // records the source view it actually used.
    expect(document.querySelector("[data-targeted-read-path]")).toBeNull();
  });

  it("sets the open setup apart from the project's sections at the same heading level (PM9.5 O3)", async () => {
    mount(layered());
    const setup = await openSetup();
    const heading = within(setup).getAllByRole("heading")[0];
    expect(heading.tagName).toBe("H3");
    expect(heading.textContent).toBe(en.targetedSetupTitle);
    expect(heading.parentElement?.className).toBe("project-section-head");
    expect(setup.className).toContain("targeted-setup");

    // jsdom lays nothing out, so the stylesheet is held to its word: the setup
    // carries the accent bar and a heading in primary text above a section's
    // quiet 13px, still below the surface's 16px h2.
    const style = document.createElement("style");
    style.textContent = projectStyles;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSStyleRule => "selectorText" in rule,
      );
      const rule = (selector: string) => rules.find((each) => each.selectorText === selector);
      expect(rule(".targeted-setup")?.style.getPropertyValue("box-shadow")).toContain(
        "var(--color-accent)",
      );
      const setupHeading = rule(".targeted-setup > .project-section-head h3")?.style;
      expect(setupHeading?.getPropertyValue("font-size")).toBe("14px");
      expect(setupHeading?.getPropertyValue("color")).toBe("var(--color-text-primary)");
      expect(rule(".project-section h3")?.style.getPropertyValue("font-size")).toBe("13px");
      expect(rule(".project-header h2")?.style.getPropertyValue("font-size")).toBe("17px");
    } finally {
      style.remove();
    }
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
    // Not detected is on the page only in the setup's standing caveat about
    // what that outcome means (PM9.5 O1), never about this run.
    expect(within(query("[data-targeted-setup]")).getAllByText(en.targetedDomain)).toHaveLength(1);
    expect(document.body.textContent?.replace(en.targetedDomain, "")).not.toContain(
      en.targetedOutcomeNotDetected,
    );
    expect(document.querySelector("[data-targeted-report]")).toBeNull();
    // Said to a reader who cannot see the paragraph, too.
    expect(liveRegion()).toBe(`${en.targetedLastFailed} ${en.targetedFailureSourceRtRepeated}`);
  });

  it("reports a refusal before a run existed as a refusal, with nothing recorded", async () => {
    const api = mount(layered());
    await reviewed(api);
    api.refuseOnce("runTargetedMs1", "insufficientWorkAreaSpace");
    await press(query("[data-targeted-run]"));

    expect(query('[data-project-problem="insufficientWorkAreaSpace"]').textContent).toContain(
      en.projectRefusedInsufficientWorkAreaSpace,
    );
    expect(document.querySelector("[data-targeted-last]")).toBeNull();
  });

  it("says the input is being prepared while a source from another drive is copied", async () => {
    const api = mount(layered());
    api.setTargeted({ progress: { operationId: "project-job-1", phase: "preparingInput" } });
    await reviewed(api);
    const release = api.holdOnce("runTargetedMs1");
    await press(query("[data-targeted-run]"));

    await screen.findAllByText(en.targetedPhasePreparingInput);
    // No work-area path reaches the page.
    expect(document.body.textContent).not.toMatch(/\.tmp|m91-jobs|snapshot\.mzML/i);
    await act(async () => release());
  });

  it("names a work area that ran out of room as the failure, not as a finding", async () => {
    const api = mount(withRun({ outcome: "failed" }, {
      attempt: null,
      consumedContent: [],
      failure: { code: "insufficientWorkAreaSpace", stage: "source" },
    }));
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-run="${RUN}"]`));

    expect(query('[data-targeted-failure="insufficientWorkAreaSpace"]').textContent).toBe(
      en.targetedFailureInsufficientWorkAreaSpace,
    );
    expect(document.body.textContent).not.toContain(en.targetedOutcomeNotDetected);
    expect(caused(api)).not.toContain("readTargetedMs1Rows");
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

  it("draws the chosen target through the shared figure renderer, with every value in a table", async () => {
    const api = await inspectResult();
    await screen.findByText(en.targetedRowsCaption);
    const choose = query(`[data-targeted-choose="${DETECTED}"]`);
    expect(choose.getAttribute("aria-label")).toBe("Show the evidence for Caffeine");
    await press(choose);
    expect(choose.getAttribute("aria-pressed")).toBe("true");
    expect(api.readTargetedMs1Evidence).toHaveBeenCalledWith(ARTIFACT, DETECTED);

    // The figure is Rust's drawing of the stored evidence, asked for by
    // identifier and shown as an inert image: the page draws nothing itself.
    const plot = await screen.findByRole("img");
    expect(plot.closest("[data-targeted-plot]")).toBeTruthy();
    expect(api.previewTargetedMs1Figure).toHaveBeenCalledWith(ARTIFACT, DETECTED, {
      widthPx: 1200,
      heightPx: 640,
      pngDpi: 300,
      theme: "light",
    });
    // The text alternative names the outcome and says what is drawn: this
    // row's one candidate is its feature, so no other candidate is outlined.
    expect(plot.getAttribute("alt")).toBe(
      en.targetedFigureAlt
        .replace("{{name}}", "Caffeine")
        .replace("{{outcome}}", en.targetedOutcomeDetected)
        .replace("{{drawn}}", en.targetedFigureDrawnFeature),
    );
    expect(plot.getAttribute("data-targeted-figure")).toBe(`spec-${DETECTED}-1200x640-light`);
    expect(plot.getAttribute("src")).toMatch(/^blob:/u);
    // The drawing is an image, never DOM SVG; the only inline SVG is the
    // points disclosure's own chevron icon.
    expect(document.querySelector("[data-targeted-plot] svg:not(.ui-icon)")).toBeNull();
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
    expect(api.previewTargetedMs1Figure).toHaveBeenCalledWith(ARTIFACT, ABSENT, expect.anything());
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
    // A read's finding is newer than the project's, so it is what the report says.
    expect(refused.getAttribute("data-targeted-unavailable")).toBe("payloadCorrupt");
    expect(query('[data-targeted-payload="payloadCorrupt"]').textContent).toBe(en.targetedStatePayloadCorrupt);
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
    expect(query("[data-targeted-source-view]").textContent).toBe(en.targetedSourceViewLink);
    expect(caused(api).length).toBe(before);
  });

  it("says a run read a verified copy, and never where the copy was", async () => {
    const base = targetedProject();
    const run = base.runs[0];
    const execution = run.targetedMs1!;
    await inspectResult({
      ...base,
      runs: [
        {
          ...run,
          targetedMs1: {
            ...execution,
            attempt: { ...execution.attempt!, sourceView: "verifiedSnapshotInWorkArea" },
          },
        },
      ],
    });
    const view = query('[data-targeted-source-view="verifiedSnapshotInWorkArea"]');
    expect(view.textContent).toBe(en.targetedSourceViewSnapshot);
    expect(details().textContent).not.toMatch(/\.tmp|m91-jobs|attempts|snapshot\.mzML/);
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
      "targetedStatePayload",
      "targetedStatePayloadWhole",
      "targetedStateSource",
      "targetedStateNewRuns",
      "targetedNewRunsAvailable",
      "targetedReuseNote",
      "targetedTableExports",
      "targetedFigureExports",
    ] as const) {
      expect(document.body.textContent, key).toContain(zh[key]);
      expect(document.body.textContent, key).not.toContain(en[key]);
    }
    const control = query(`[data-project-targeted="${LAYER}"]`);
    expect(control.getAttribute("aria-label")).toBe(`对 ${projectInput().label} 做靶向 MS1`);
    // The zh-CN caveats are read before Run too, not folded away (PM9.5 O1).
    const domain = within(query("[data-targeted-setup]")).getByText(zh.targetedDomain);
    expect(domain.closest("details")).toBeNull();
    expect(precedes(domain, query("[data-targeted-run]"))).toBe(true);
  });
});

describe("a stored result reused (M9.2)", () => {
  async function inspectResult(
    state: ProjectState = targetedProject(),
    prepare: (api: FakeProjectApi) => void = () => undefined,
    locale: "en" | "zh-CN" = "en",
  ) {
    const api = mount(state, locale, prepare);
    await screen.findByText(locale === "en" ? en.projectReferences : zh.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    return api;
  }

  async function chooseDetected(rowsCaption: string = en.targetedRowsCaption) {
    await screen.findByText(rowsCaption);
    await press(query(`[data-targeted-choose="${DETECTED}"]`));
    await screen.findByRole("img");
  }

  const status = (region: "table" | "figure") =>
    query(`[data-targeted-${region}-export] [role="status"]`);
  const button = (operation: string) =>
    query<HTMLButtonElement>(`[data-targeted-export="${operation}"]`);

  /** Nothing a stored result's reading or output may cause. */
  const NEVER = [
    "resolveTargetedMs1Plan",
    "runTargetedMs1",
    "beginProjectJob",
    "checkProjectLinks",
    "captureProjectFileFacts",
    "addProjectInputToWorkspace",
  ];

  /** The source as a check leaves it once the file is gone from where it was. */
  function sourceGone(): ProjectState {
    const base = targetedProject();
    return {
      ...base,
      inputs: [
        { ...base.inputs[0], verification: "unavailable", unavailableReason: "missingAtCheckedLocation" },
      ],
    };
  }

  it("says what the result depends on, each fact in words, beside the rows it reads", async () => {
    const api = await inspectResult();
    const state = query("[data-targeted-state]");
    expect(state.getAttribute("aria-label")).toBe(en.targetedStateLabel);
    expect(query('[data-targeted-payload="available"]').textContent).toBe(en.targetedStatePayloadWhole);
    expect(query('[data-targeted-source="matchingRecordedContent"]').textContent).toBe(
      en.projectStateMatching,
    );
    await screen.findByText(en.targetedNewRunsAvailable);
    expect(query('[data-targeted-runtime="available"]')).toBeTruthy();
    expect(screen.getByText(en.targetedReuseNote)).toBeTruthy();
    expect(api.getTargetedMs1Runtime).toHaveBeenCalledTimes(1);
  });

  it("reads and draws the stored result with the runtime unavailable and the source gone", async () => {
    const api = await inspectResult(sourceGone(), (fake) => fake.setTargeted({ newRuns: "runtimeUnavailable" }));
    await screen.findByText(en.targetedNewRunsRuntimeUnavailable);
    expect(query('[data-targeted-runtime="runtimeUnavailable"]')).toBeTruthy();
    expect(query('[data-targeted-source="unavailable"]').textContent).toBe(en.projectStateMissing);
    expect(query('[data-targeted-payload="available"]').textContent).toBe(en.targetedStatePayloadWhole);
    await chooseDetected();
    expect(api.readTargetedMs1Rows).toHaveBeenCalledTimes(1);
    expect(api.previewTargetedMs1Figure).toHaveBeenCalledTimes(1);
    await press(button("csv"));
    expect(status("table").getAttribute("data-targeted-output")).toBe("savedTable");
    await press(button("svg"));
    expect(status("figure").getAttribute("data-targeted-output")).toBe("savedFigure");
    for (const call of NEVER) expect(caused(api)).not.toContain(call);
  });

  it("tells a restart-needed session from one without a runtime, and an unanswered read from both", async () => {
    await inspectResult(targetedProject(), (fake) => fake.setTargeted({ newRuns: "quarantined" }));
    await screen.findByText(en.targetedNewRunsQuarantined);
    cleanup();
    await inspectResult(targetedProject(), (fake) => {
      vi.mocked(fake.getTargetedMs1Runtime).mockRejectedValueOnce({ kind: "noOpenProject", summary: "", detail: null, retryable: false });
    });
    await screen.findByText(en.targetedNewRunsUnknown);
    expect(query('[data-targeted-runtime="unknown"]')).toBeTruthy();
    // The result is read regardless: nothing about it depends on the answer.
    await screen.findByText(en.targetedRowsCaption);
  });

  it("offers no output for a missing or damaged result, and draws nothing", async () => {
    for (const availability of ["payloadMissing", "payloadCorrupt"] as const) {
      const api = await inspectResult(targetedProject(availability));
      expect(query(`[data-targeted-payload="${availability}"]`).textContent).toBe(
        en[availability === "payloadMissing" ? "targetedStatePayloadMissing" : "targetedStatePayloadCorrupt"],
      );
      expect(query(`[data-targeted-unavailable="${availability}"]`)).toBeTruthy();
      expect(document.querySelector("[data-targeted-table-export]")).toBeNull();
      expect(document.querySelector("[data-targeted-figure-export]")).toBeNull();
      expect(document.querySelector("[data-targeted-row]")).toBeNull();
      expect(api.readTargetedMs1Rows).not.toHaveBeenCalled();
      // Nothing can be shown or exported, so the page does not say it can.
      expect(screen.queryByText(en.targetedReuseNote)).toBeNull();
      expect(api.previewTargetedMs1Figure).not.toHaveBeenCalled();
      expect(api.exportTargetedMs1Table).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("offers no output where the rows read as corrupt after all", async () => {
    await inspectResult(targetedProject(), (fake) => fake.refuseOnce("readTargetedMs1Rows", "payloadCorrupt"));
    await screen.findByText(en.targetedPayloadCorrupt);
    expect(document.querySelector("[data-targeted-table-export]")).toBeNull();
    expect(document.querySelector("[data-targeted-row]")).toBeNull();
  });

  it("takes the rows away when a later drawing or export finds the result damaged or gone", async () => {
    for (const [operation, code] of [
      ["exportTargetedMs1Table", "payloadCorrupt"],
      ["previewTargetedMs1Figure", "payloadMissing"],
      ["readTargetedMs1Evidence", "payloadCorrupt"],
    ] as const) {
      const api = await inspectResult();
      await screen.findByText(en.targetedRowsCaption);
      expect(document.querySelectorAll("[data-targeted-row]")).toHaveLength(2);
      api.refuseOnce(operation, code);
      if (operation === "exportTargetedMs1Table") {
        await press(button("csv"));
      } else {
        await press(query(`[data-targeted-choose="${DETECTED}"]`));
      }
      await screen.findByText(en[code === "payloadCorrupt" ? "targetedPayloadCorrupt" : "targetedPayloadMissing"]);
      expect(query(`[data-targeted-payload="${code}"]`)).toBeTruthy();
      expect(query(`[data-targeted-report="${ARTIFACT}"]`).getAttribute("data-availability")).toBe(code);
      expect(document.querySelector("[data-targeted-row]")).toBeNull();
      expect(document.querySelector("[data-targeted-table-export]")).toBeNull();
      expect(document.querySelector("[data-targeted-plot]")).toBeNull();
      expect(screen.queryByText(en.targetedReuseNote)).toBeNull();
      cleanup();
    }
  });

  it("names the result's target list and stored manifest by digest in Details", async () => {
    const state = targetedProject();
    const manifest = state.artifacts[0].targetedMs1?.result?.payload.manifestSha256 ?? "";
    await inspectResult(state);
    expect(manifest).not.toBe("");
    expect(query("[data-provenance-payload]").textContent).toContain(manifest);
    expect(query("[data-provenance-payload]").textContent).toContain(en.targetedPayloadDigest);
    expect(query("[data-targeted-plan-facts]").textContent).toContain(PLAN.targetListSha256);
    expect(query("[data-targeted-plan-facts]").textContent).toContain(en.targetedTargetListDigest);
  });

  it("says in the image's text what this target's figure holds, and never a feature it has not", async () => {
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
    const image = await screen.findByRole("img");
    const alt = image.getAttribute("alt") ?? "";
    expect(alt).toContain(en.targetedOutcomeNotDetected);
    expect(alt).toContain(en.targetedFigureDrawnPoints);
    expect(alt).not.toContain(en.targetedFigureDrawnFeature);
  });

  it("keeps drawing at the last size while one is typed, across targets, with the settings left open", async () => {
    const api = await inspectResult();
    api.setTargeted({
      evidence: {
        [DETECTED]: { targetId: DETECTED, traces: [{ targetId: DETECTED, trace: 0, mzTheoretical: 195.0877, points: [[1, 120, 5]] }] },
        [ABSENT]: { targetId: ABSENT, traces: [{ targetId: ABSENT, trace: 0, mzTheoretical: 196.0604, points: [[1, 280, 0]] }] },
      },
    });
    await chooseDetected();
    const region = query("[data-targeted-figure-export]");
    const toggle = query(`[aria-controls="${region.id}"]`);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(region.hidden).toBe(true);
    await press(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await type(query(`[data-targeted-figure-export] input[id$="-heightPx"]`), "");
    await press(query(`[data-targeted-choose="${ABSENT}"]`));
    // Drawn at the last size that was one, not left waiting on the text.
    const image = await screen.findByRole("img");
    expect(image.getAttribute("data-targeted-figure")).toBe(`spec-${ABSENT}-1200x640-light`);
    expect(document.querySelector("[data-targeted-figure-loading]")).toBeNull();
    // Open as the user left it, for the next target too.
    expect(query("[data-targeted-figure-export]").hidden).toBe(false);
    // Refused, not disabled: focusable, and its reason is the size problem.
    expect(button("svg").disabled).toBe(false);
    expect(button("svg").getAttribute("aria-disabled")).toBe("true");
    expect(described(button("svg"))).toEqual([en.invalidHeight]);
  });

  it("says a figure output only under the target it was for", async () => {
    const api = await inspectResult();
    api.setTargeted({
      evidence: {
        [DETECTED]: { targetId: DETECTED, traces: [{ targetId: DETECTED, trace: 0, mzTheoretical: 195.0877, points: [[1, 120, 5]] }] },
        [ABSENT]: { targetId: ABSENT, traces: [{ targetId: ABSENT, trace: 0, mzTheoretical: 196.0604, points: [[1, 280, 0]] }] },
      },
    });
    await chooseDetected();
    await press(button("svg"));
    expect(status("figure").getAttribute("data-targeted-output")).toBe("savedFigure");
    await press(query(`[data-targeted-choose="${ABSENT}"]`));
    await screen.findByRole("img");
    expect(status("figure").getAttribute("data-targeted-output")).toBe("idle");
    expect(status("figure").textContent).toBe("");
    await press(query(`[data-targeted-choose="${DETECTED}"]`));
    await screen.findByRole("img");
    expect(status("figure").getAttribute("data-targeted-output")).toBe("savedFigure");
    expect(api.exportTargetedMs1Figure).toHaveBeenCalledTimes(1);
  });

  it("says a refused resolution and an oversized drawing in this surface's own words", async () => {
    const api = await inspectResult();
    await chooseDetected();
    vi.mocked(api.exportTargetedMs1Figure).mockRejectedValueOnce({
      kind: "figure_settings_refused",
      summary: "",
      detail: null,
      retryable: false,
      context: { kind: "pngDpi", min: 72, max: 1200 },
    });
    await type(query(`[data-targeted-figure-export] input[id$="-pngDpi"]`), "5000");
    await press(button("png"));
    expect(status("figure").textContent).toBe("PNG DPI must be 72–1200. SVG remains available.");
    expect(status("figure").textContent).not.toContain("Copy");
    cleanup();

    await inspectResult(targetedProject(), (fake) =>
      fake.refuseOnce("previewTargetedMs1Figure", "figure_preview_too_large"),
    );
    await screen.findByText(en.targetedRowsCaption);
    await press(query(`[data-targeted-choose="${DETECTED}"]`));
    await screen.findByText(en.m92ErrorPreviewSize);
    // Too large to show is not too large to write: the exports stay.
    expect(button("svg").disabled).toBe(false);
  });

  it("moves focus to the report and announces a result an export found gone", async () => {
    const api = await inspectResult();
    await screen.findByText(en.targetedRowsCaption);
    api.refuseOnce("exportTargetedMs1Table", "payloadMissing");
    button("csv").focus();
    await press(button("csv"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(en.targetedPayloadMissing);
    expect(document.activeElement?.tagName).toBe("H3");
    expect(document.activeElement?.textContent).toBe(en.targetedReportTitle);
  });

  it("announces nothing for a result the project already recorded as missing", async () => {
    await inspectResult(targetedProject("payloadMissing"));
    expect(query('[data-targeted-unavailable="payloadMissing"]').getAttribute("role")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("writes the table through Rust as CSV or TSV and says what was saved or why not", async () => {
    const api = await inspectResult();
    await screen.findByText(en.targetedRowsCaption);
    expect(button("csv").textContent).toBe("Export CSV…");

    await press(button("csv"));
    expect(api.exportTargetedMs1Table).toHaveBeenLastCalledWith(ARTIFACT, "csv");
    expect(status("table").textContent).toBe(
      "Saved mscanvas-targeted-ms1-eeeeeeee-results.csv with 2 target rows.",
    );

    api.cancelOnce("exportTargetedMs1Table");
    await press(button("tsv"));
    expect(api.exportTargetedMs1Table).toHaveBeenLastCalledWith(ARTIFACT, "tsv");
    expect(status("table").textContent).toBe(en.viewerExportCancelled);

    api.refuseOnce("exportTargetedMs1Table", "targeted_table_field_not_representable");
    await press(button("tsv"));
    expect(status("table").textContent).toBe(en.m92ErrorTsvField);
    expect(status("table").getAttribute("data-targeted-output")).toBe("failed");

    api.refuseOnce("exportTargetedMs1Table", "exportInProgress");
    await press(button("csv"));
    expect(status("table").textContent).toBe(en.projectRefusedExportInProgress);
    for (const call of NEVER) expect(caused(api)).not.toContain(call);
  });

  it("holds every output while one is out, and says which", async () => {
    const api = await inspectResult();
    await chooseDetected();
    const release = api.holdOnce("exportTargetedMs1Table");
    await press(button("csv"));
    expect(status("table").textContent).toBe("Choose where to save the CSV file.");
    // The pressed control keeps focus across the native picker: marked, not
    // disabled. Every other output is disabled.
    expect(button("csv").disabled).toBe(false);
    for (const operation of ["csv", "tsv", "svg", "png"]) {
      expect(button(operation).getAttribute("aria-disabled"), operation).toBe("true");
    }
    for (const operation of ["tsv", "svg", "png"]) {
      expect(button(operation).disabled, operation).toBe(true);
    }
    await press(button("csv"));
    expect(api.exportTargetedMs1Table).toHaveBeenCalledTimes(1);
    await press(button("svg"));
    expect(api.exportTargetedMs1Figure).not.toHaveBeenCalled();
    await act(async () => {
      release();
    });
    expect(status("table").getAttribute("data-targeted-output")).toBe("savedTable");
    expect(button("svg").disabled).toBe(false);
  });

  it("exports the figure at the size typed, the same drawing the page shows", async () => {
    const api = await inspectResult();
    await chooseDetected();
    await type(query(`[data-targeted-figure-export] input[id$="-widthPx"]`), "800");
    const settings = { widthPx: 800, heightPx: 640, pngDpi: 300, theme: "light" };
    expect(api.previewTargetedMs1Figure).toHaveBeenLastCalledWith(ARTIFACT, DETECTED, settings);

    await press(button("svg"));
    expect(api.exportTargetedMs1Figure).toHaveBeenLastCalledWith(ARTIFACT, DETECTED, "svg", settings);
    expect(status("figure").textContent).toBe(
      "Saved mscanvas-targeted-ms1-eeeeeeee-target-1.svg with 800 by 640 pixels, Light theme.",
    );

    await press(button("png"));
    expect(api.exportTargetedMs1Figure).toHaveBeenLastCalledWith(ARTIFACT, DETECTED, "png", settings);
    expect(status("figure").textContent).toBe(
      "Saved mscanvas-targeted-ms1-eeeeeeee-target-1.png with 800 by 640 pixels, Light theme, 300 DPI.",
    );

    // No clipboard copy is offered for a stored result: M9.2 could not
    // exercise one natively, so the page does not claim one.
    expect(document.querySelector('[data-targeted-export="copy"]')).toBeNull();
    for (const call of NEVER) expect(caused(api)).not.toContain(call);
  });

  it("closes PNG for a resolution that is not one, and every figure output for a size that is not one", async () => {
    const api = await inspectResult();
    await chooseDetected();
    await type(query(`[data-targeted-figure-export] input[id$="-pngDpi"]`), "high");
    // Refused, focusable, each pointing at the problem that closes it.
    expect(button("png").getAttribute("aria-disabled")).toBe("true");
    expect(button("png").disabled).toBe(false);
    expect(described(button("png"))).toEqual([en.invalidDpi]);
    expect(button("svg").getAttribute("aria-disabled")).toBeNull();
    const pngCalls = vi.mocked(api.exportTargetedMs1Figure).mock.calls.length;
    await press(button("png"));
    expect(vi.mocked(api.exportTargetedMs1Figure).mock.calls.length).toBe(pngCalls);

    const drawn = vi.mocked(api.previewTargetedMs1Figure).mock.calls.length;
    await type(query(`[data-targeted-figure-export] input[id$="-heightPx"]`), "");
    for (const operation of ["svg", "png"]) {
      expect(button(operation).getAttribute("aria-disabled"), operation).toBe("true");
      expect(described(button(operation)), operation).toEqual([en.invalidHeight]);
    }
    // The last drawing stays while the size is being typed; nothing new is asked.
    expect(vi.mocked(api.previewTargetedMs1Figure).mock.calls.length).toBe(drawn);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("says a figure Rust refused in the boundary's words, with the points still in the table", async () => {
    await inspectResult(targetedProject(), (fake) =>
      fake.refuseOnce("previewTargetedMs1Figure", "targeted_figure_not_drawable"),
    );
    await screen.findByText(en.targetedRowsCaption);
    await press(query(`[data-targeted-choose="${DETECTED}"]`));
    const refused = await screen.findByText(en.m92ErrorFigureNotDrawable);
    expect(refused.getAttribute("data-targeted-figure-refused")).toBe("targeted_figure_not_drawable");
    expect(document.querySelectorAll(".targeted-points tbody tr")).toHaveLength(6);
  });

  it("says a refused figure export and a missing source in Chinese in a Chinese session", async () => {
    const api = await inspectResult(sourceGone(), undefined, "zh-CN");
    await chooseDetected(zh.targetedRowsCaption);
    api.refuseOnce("exportTargetedMs1Figure", "spectrum_destination_exists");
    await press(button("svg"));
    expect(status("figure").textContent).toBe(zh.m74ErrorExists);
    expect(query('[data-targeted-source="unavailable"]').textContent).toBe(zh.projectStateMissing);
    expect(query("img").getAttribute("alt")).toBe(
      zh.targetedFigureAlt
        .replace("{{name}}", "Caffeine")
        .replace("{{outcome}}", zh.targetedOutcomeDetected)
        .replace("{{drawn}}", zh.targetedFigureDrawnFeature),
    );
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

describe("the task as one path (PM9.5)", () => {
  /** A second acquisition, for a request opened from another row or run as a batch. */
  const otherInput = projectInput({
    id: "11111111-1111-4111-8111-222222222222",
    label: "second.mzML",
    verification: "matchingRecordedContent",
  });
  const other = projectLayer({ id: "dddddddd-1111-4111-8111-222222222222", sourceInputId: otherInput.id });
  const two = {
    inputs: [projectInput({ verification: "matchingRecordedContent" }), otherInput],
    layers: [projectLayer(), other],
  };

  it("names its own choice of acquisitions and the request's limit (R1, R2)", async () => {
    mount(layered());
    const setup = await openSetup();
    expect(query("[data-targeted-members] legend").textContent).toBe(en.targetedAcquisitions);
    expect([en.targetedAcquisitions, zh.targetedAcquisitions]).toEqual(["Acquisitions to analyse", "要分析的采集"]);
    expect(within(setup).getByText(en.targetedAcquisitionsHelp)).toBeTruthy();
    expect(en.targetedAcquisitionsHelp).toContain("separate from the Workbench's highlighted and checked rows");
    expect(within(setup).getByText(en.targetedTargetsFormat)).toBeTruthy();
    expect([en.targetedTargetsFormat, zh.targetedTargetsFormat].map((format) => format.includes("200"))).toEqual([true, true]);
  });

  it("leads the review to Run and says why Review or Run waits, in each state (R3, R4)", async () => {
    const api = mount(layered({ published: false }));
    await openSetup();
    const review = query("[data-targeted-review]");
    const run = query("[data-targeted-run]");
    // Nothing typed: neither can act, each says why, and a press sends nothing.
    expect(review.getAttribute("aria-disabled")).toBe("true");
    expect(described(review)).toEqual([en.targetedReviewNeedsTargets]);
    expect(described(run)).toEqual([en.targetedRunNeedsReview]);
    await press(review);
    expect(caused(api)).toEqual([]);
    await press(query(`[data-targeted-member="${LAYER}"]`));
    expect(described(review)).toEqual([en.targetedReviewNeedsAcquisition]);
    await press(query(`[data-targeted-member="${LAYER}"]`));

    // Problems come first in the review, which sits between Review plan and Run.
    api.setTargeted({
      resolution: {
        plan: null,
        problems: [{ row: 1, field: "formula", problem: "invalid" }],
        blocked: null,
        engine: FAKE_ENGINE,
      },
    });
    await type(query("[data-targeted-text]"), "A, Xx9, 10, 5");
    await press(review);
    const area = query("[data-targeted-review-area]");
    expect(precedes(review, area) && precedes(area, run)).toBe(true);
    expect(precedes(query("[data-targeted-problems]"), query("[data-targeted-engine]"))).toBe(true);
    expect(described(run)).toEqual([en.targetedRunFixProblems]);

    // An edit withdraws the review, and Run says the request changed.
    api.setTargeted({
      resolution: { plan: PLAN, problems: [], blocked: "notYetPublished", engine: FAKE_ENGINE },
    });
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    expect(document.querySelector("[data-targeted-review-area]")).toBeNull();
    expect(described(run)).toEqual([en.targetedRunChanged]);

    // A blocked plan: what would run, then the plan's own refusal, which is Run's reason.
    await press(review);
    expect(query("[data-targeted-plan-for]").textContent).toBe(
      en.targetedPlanFor.replace("{{name}}", projectInput().label),
    );
    expect(query(`[data-targeted-plan="${PLAN.planSha256}"] caption`).textContent).toBe(
      en.targetedPlanCaption
        .replace("{{count}}", String(PLAN.targets.length))
        .replace("{{ppm}}", PLAN.parameters.mzHalfWidthPpm)
        .replace("{{width}}", PLAN.parameters.expectedPeakWidthS),
    );
    expect(described(run)).toEqual([en.projectRefusedNotYetPublished]);
    await press(run);
    expect(api.runTargetedMs1).not.toHaveBeenCalled();
  });

  it("takes the keyboard from Review plan to the review it answered (R3, R9)", async () => {
    mount(layered());
    await openSetup();
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    const review = query("[data-targeted-review]");
    review.focus();
    await press(review);
    expect(document.activeElement).toBe(query("[data-targeted-review-area] h4"));
  });

  it("says a refused review or run beside what was refused, and only its own (R5)", async () => {
    const api = mount(layered());
    await openSetup();
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    api.refuseOnce("resolveTargetedMs1Plan", "recipeSourceUnsupported");
    await press(query("[data-targeted-review]"));
    expect(query('[data-targeted-review-refused="recipeSourceUnsupported"]').textContent).toBe(
      en.projectRefusedRecipeSourceUnsupported,
    );
    expect(query('[data-project-problem="recipeSourceUnsupported"]')).toBeTruthy();
    // A new request withdraws the refusal of the old one, everywhere.
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 121, 30");
    expect(document.querySelector("[data-targeted-review-refused]")).toBeNull();
    expect(document.querySelector("[data-project-problem]")).toBeNull();

    // A run refused before it existed is said beside Run, with no ending; the
    // block the press made goes, and its refusal has the keyboard instead.
    await press(query("[data-targeted-review]"));
    api.refuseOnce("runTargetedMs1", "planNotCurrent");
    const run = query("[data-targeted-run]");
    run.focus();
    await press(run);
    const refused = query('[data-targeted-run-refused="planNotCurrent"]');
    expect(refused.textContent).toBe(en.projectRefusedPlanNotCurrent);
    expect(document.querySelector("[data-targeted-run-block]")).toBeNull();
    expect(document.activeElement).toBe(refused);
    expect(described(run)).toEqual([en.projectRefusedPlanNotCurrent]);

    // Another operation's refusal is not the setup's to say.
    api.refuseOnce("saveProject", "staleDocument");
    await press(screen.getByRole("button", { name: en.projectSave }));
    expect(query('[data-project-problem="staleDocument"]')).toBeTruthy();
    expect(document.querySelector("[data-targeted-review-refused], [data-targeted-run-refused]")).toBeNull();
  });

  it("says what is out beside the controls it holds (R6)", async () => {
    const api = mount(layered());
    await openSetup();
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    const release = api.holdOnce("resolveTargetedMs1Plan");
    await press(query("[data-targeted-review]"));
    expect(query('[data-targeted-status="reviewing"]').textContent).toBe(en.projectBusyReviewingPlan);
    expect(described(query("[data-targeted-review]"))).toEqual([en.projectBusyReviewingPlan]);
    expect(described(query("[data-targeted-run]"))).toEqual([en.projectBusyReviewingPlan]);
    await act(async () => release());
    expect(document.querySelector("[data-targeted-status]")).toBeNull();
  });

  it("follows a run beside its request: its phase, Cancel run, a stop requested and what ended (R6, R7, R9)", async () => {
    const api = mount(layered());
    api.setTargeted({ progress: { operationId: "project-job-1", phase: "runningEngine" } });
    await reviewed(api);
    const release = api.holdOnce("runTargetedMs1");
    const run = query("[data-targeted-run]");
    run.focus();
    await press(run);
    const block = query('[data-targeted-run-block="running"]');
    // The keyboard follows from Run, now inert, to what the press made.
    expect(document.activeElement).toBe(within(block).getByRole("heading"));
    await screen.findAllByText(en.targetedPhaseRunningEngine);
    expect(described(query("[data-targeted-close]"))).toEqual([en.targetedRunInProgressTitle]);
    expect(described(run)).toEqual([en.targetedRunInProgressTitle]);

    const cancel = query("[data-targeted-cancel-run]");
    expect(cancel.textContent).toBe(en.targetedCancelRun);
    cancel.focus();
    await press(cancel);
    await press(cancel);
    expect(api.cancelled).toEqual(["project-job-1"]);
    // Requested, not observed: every stop control says so, and the run is still running.
    expect(cancel.textContent).toBe(en.targetedStopRequested);
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    expect(query("[data-project-cancel]").textContent).toBe(en.targetedStopRequested);
    await press(query("[data-project-cancel]"));
    expect(api.cancelled).toEqual(["project-job-1"]);
    expect(liveRegion()).toBe(en.targetedStopRequested);
    expect(query("[data-targeted-run-block]").getAttribute("data-targeted-run-block")).toBe("running");

    // The stop arrived too late: the run completed after all, and is said to have.
    api.set(targetedProject());
    await act(async () => release());
    expect(query("[data-targeted-run-block]").getAttribute("data-targeted-run-block")).toBe("completed");
    expect(query('[data-targeted-last="completed"]').textContent).toBe(en.targetedLastCompleted);
    // Cancel run left with the run; its heading has the keyboard, not the page.
    expect(document.activeElement).toBe(within(query("[data-targeted-run-block]")).getByRole("heading"));
  });

  it("ends a run with its own entry, and offers the same plan again only as what it is (R8, R9)", async () => {
    const api = mount(layered());
    await reviewed(api);
    api.set(targetedProject());
    await press(query("[data-targeted-run]"));
    const open = query(`[data-targeted-open-result="${ARTIFACT}"]`);
    expect(open.classList.contains("ui-button--primary")).toBe(true);
    const run = query("[data-targeted-run]");
    expect(run.textContent).toBe(en.targetedRunAgain);
    expect(run.classList.contains("ui-button--secondary")).toBe(true);
    expect(described(run)).toEqual([en.targetedRunAgainNote]);

    await press(open);
    expect(document.activeElement).toBe(query(`[data-targeted-report="${ARTIFACT}"] h3`));

    // An edit withdraws the review, never the ending.
    await type(query("[data-targeted-width]"), "7");
    expect(document.querySelector("[data-targeted-review-area]")).toBeNull();
    expect(query('[data-targeted-last="completed"]')).toBeTruthy();
    expect(query("[data-targeted-run]").textContent).toBe(en.targetedRun);
  });

  it("offers a failed run's own run, never a result (R8)", async () => {
    const api = mount(layered());
    await reviewed(api);
    api.set(withRun({ outcome: "failed" }, { failure: { code: "sourceChanged", stage: "source" } }));
    await press(query("[data-targeted-run]"));
    expect(query('[data-targeted-last="failed"]').textContent).toBe(
      `${en.targetedLastFailed} ${en.targetedFailureSourceChanged}`,
    );
    expect(document.querySelector("[data-targeted-open-result]")).toBeNull();
    await press(query(`[data-project-inspect-layer="${LAYER}"]`));
    await press(query(`[data-targeted-show-run="${RUN}"]`));
    expect(query(`[data-project-inspect-run="${RUN}"]`).getAttribute("aria-current")).toBe("true");
    // Details is on screen: nothing beside the press points at it.
    expect(document.querySelector("[data-targeted-details-hint]")).toBeNull();
  });

  it("says beside Show run where the run went while Details is folded, and unfolds nothing itself (PM9.5 O2)", async () => {
    const reveal = vi.fn();
    const api = mount(layered(), "en", () => undefined, reveal);
    await reviewed(api);
    api.set(withRun({ outcome: "failed" }, { failure: { code: "sourceChanged", stage: "source" } }));
    await press(query("[data-targeted-run]"));
    // The ended run is what Details inspects, so the hint already says so.
    expect(query("[data-targeted-run-block] [data-targeted-details-hint]")).toBeTruthy();
    expect(reveal).not.toHaveBeenCalled();
    // Inspecting anything else withdraws it: it names only this run's answer.
    await press(query(`[data-project-inspect-layer="${LAYER}"]`));
    expect(document.querySelector("[data-targeted-details-hint]")).toBeNull();

    const show = query(`[data-targeted-show-run="${RUN}"]`);
    show.focus();
    await press(show);
    const hint = query("[data-targeted-run-block] [data-targeted-details-hint]");
    // The button says where the answer went; no sentence restates it.
    expect(hint.textContent).toBe(en.provenanceShowDetails);
    expect(precedes(show, hint)).toBe(true);
    // The press only inspects: the keyboard stays on it, Details stays folded
    // and the run is the one inspected.
    expect(document.activeElement).toBe(show);
    expect(reveal).not.toHaveBeenCalled();
    expect(query(`[data-project-inspect-run="${RUN}"]`).getAttribute("aria-current")).toBe("true");

    // The hint's control is the header's own toggle, asked once.
    await press(within(hint).getByRole("button", { name: en.provenanceShowDetails }));
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("leads a problem back to the line it was typed on (R10)", async () => {
    const api = mount(layered());
    api.setTargeted({
      resolution: {
        plan: null,
        problems: [{ row: 2, field: "formula", problem: "invalid" }],
        blocked: null,
        engine: FAKE_ENGINE,
      },
    });
    await openSetup();
    await type(query("[data-targeted-text]"), "A, C6H6, 10, 5\n# comment\nB, Xx9, 10, 5");
    await press(query("[data-targeted-review]"));
    const line = query('[data-targeted-problem-line="3"]');
    expect(line.getAttribute("aria-label")).toBe(en.targetedGoToLine.replace("{{line}}", "3"));
    await press(line);
    const area = query<HTMLTextAreaElement>("[data-targeted-text]");
    expect(document.activeElement).toBe(area);
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe("B, Xx9, 10, 5");
  });

  it("keeps the typed request across closing and another row, not into another project (R11)", async () => {
    const api = mount(layered(two));
    await openSetup();
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    await type(query("[data-targeted-width]"), "7");
    await press(query("[data-targeted-review]"));
    await press(query("[data-targeted-close]"));
    await press(query(`[data-project-targeted="${LAYER}"]`));
    expect(query<HTMLTextAreaElement>("[data-targeted-text]").value).toBe("Caffeine, C8H10N4O2, 120, 30");
    expect(query<HTMLInputElement>("[data-targeted-width]").value).toBe("7");
    // No review survives: a reopened setup is reviewed again.
    expect(document.querySelector("[data-targeted-review-area]")).toBeNull();

    // From another row: the same request, for that acquisition.
    await press(query(`[data-project-targeted="${other.id}"]`));
    expect(query(`[data-targeted-setup="${other.id}"]`)).toBeTruthy();
    expect(query<HTMLTextAreaElement>("[data-targeted-text]").value).toBe("Caffeine, C8H10N4O2, 120, 30");
    expect(query<HTMLInputElement>(`[data-targeted-member="${other.id}"]`).checked).toBe(true);
    expect(query<HTMLInputElement>(`[data-targeted-member="${LAYER}"]`).checked).toBe(false);

    // Another project: the setup closes, and the draft goes with its project.
    const copy = layered({ ...two, projectId: "aaaaaaaa-0000-4111-8111-000000000002" });
    api.set(copy);
    await press(screen.getByRole("button", { name: en.projectOpen }));
    expect(document.querySelector("[data-targeted-setup]")).toBeNull();
    await press(query(`[data-project-targeted="${LAYER}"]`));
    expect(query<HTMLTextAreaElement>("[data-targeted-text]").value).toBe("");
    expect(query<HTMLInputElement>("[data-targeted-width]").value).toBe("6");

    // Another copy of the same project, with the same identifiers, replaces it too.
    await type(query("[data-targeted-text]"), "Caffeine, C8H10N4O2, 120, 30");
    await press(query("[data-targeted-review]"));
    await press(screen.getByRole("button", { name: en.projectOpen }));
    expect(document.querySelector("[data-targeted-setup]")).toBeNull();
    await press(query(`[data-project-targeted="${LAYER}"]`));
    expect(query<HTMLTextAreaElement>("[data-targeted-text]").value).toBe("");
    expect(document.querySelector("[data-targeted-review-area]")).toBeNull();
  });

  it("gives a refused run's keyboard to its refusal once the run has settled (R9)", async () => {
    const api = mount(layered());
    await reviewed(api);
    api.refuseOnce("runTargetedMs1", "analysisQuarantined");
    // The refusal arrives before the project is read again; the run is out until then.
    const reread = api.holdOnce("getProjectState");
    const run = query("[data-targeted-run]");
    run.focus();
    await press(run);
    expect(query('[data-targeted-run-block="running"]')).toBeTruthy();
    await act(async () => reread());
    const refused = query('[data-targeted-run-refused="analysisQuarantined"]');
    expect(document.querySelector("[data-targeted-run-block]")).toBeNull();
    expect(document.activeElement).toBe(refused);
  });

  it("keeps one filled primary when a new request is ready beside the last run's result (R8, R12)", async () => {
    const api = mount(layered(two));
    await reviewed(api);
    const base = targetedProject();
    api.set({ ...base, inputs: two.inputs, layers: [base.layers[0], other] });
    await press(query("[data-targeted-run]"));
    expect(query(`[data-targeted-open-result="${ARTIFACT}"]`).classList.contains("ui-button--primary")).toBe(true);

    api.setTargeted({
      batchResolution: {
        problems: [],
        common: {
          recipe: PLAN.recipe,
          parameters: PLAN.parameters,
          targetListSha256: PLAN.targetListSha256,
          targets: PLAN.targets,
        },
        members: [
          { layerId: LAYER, inputId: projectInput().id, planSha256: PLAN.planSha256, expectedContent: PLAN.expectedContent, refused: null, blocked: null },
          { layerId: other.id, inputId: otherInput.id, planSha256: "D".repeat(64), expectedContent: PLAN.expectedContent, refused: null, blocked: null },
        ],
        engine: FAKE_ENGINE,
      },
    });
    await press(query(`[data-targeted-member="${other.id}"]`));
    await press(query("[data-targeted-review]"));
    const run = query("[data-targeted-run]");
    expect(run.textContent).toBe(en.targetedRunBatch.replace("{{count}}", "2"));
    expect(run.classList.contains("ui-button--primary")).toBe(true);
    expect(run.getAttribute("aria-disabled")).toBeNull();
    expect(query(`[data-targeted-open-result="${ARTIFACT}"]`).classList.contains("ui-button--secondary")).toBe(true);
  });
});

describe("a stored result in its report and in the history (PM9.6)", () => {
  async function opened(state: ProjectState = targetedProject()) {
    const api = mount(state);
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    await within(query(`[data-targeted-report="${ARTIFACT}"]`)).findByText(en.targetedRowsCaption);
    return api;
  }

  it("keeps every outcome count on one line, zeros included, in the report's order (R1)", async () => {
    await opened();
    const summary = query("[data-targeted-summary]");
    expect(summary.querySelector("table")).toBeNull();
    expect([...summary.querySelectorAll("[data-targeted-count]")].map((item) => item.getAttribute("data-targeted-count"))).toEqual([
      "targets",
      "detected",
      "detectedAmbiguous",
      "shared",
      "suppressedByOverlap",
      "notDetected",
      "failed",
    ]);
    expect(query('[data-targeted-count="failed"]').textContent).toBe(`${en.targetedOutcomeFailed}0`);
    expect(within(summary).getByText(en.targetedSummary)).toBeTruthy();
  });

  it("says what the outcomes mean and offers the table's output before the rows, and the chosen target after them (R2)", async () => {
    await opened();
    const report = query(`[data-targeted-report="${ARTIFACT}"]`);
    const meaning = within(report).getByText(en.targetedMeaning);
    const output = query("[data-targeted-table-export]");
    const rows = query(".targeted-rows");
    expect(precedes(query("[data-targeted-summary]"), meaning)).toBe(true);
    expect(precedes(meaning, output)).toBe(true);
    expect(precedes(output, rows)).toBe(true);
    expect(precedes(rows, query("[data-targeted-no-selection]"))).toBe(true);
  });

  it("keeps the report, its chosen target and its reads while its own run is inspected, and back (R3)", async () => {
    const api = await opened();
    const report = query(`[data-targeted-report="${ARTIFACT}"]`);
    const drawn = appears("[data-targeted-selected] [data-targeted-plot] img");
    await press(query(`[data-targeted-choose="${DETECTED}"]`));
    await act(async () => {
      await drawn;
    });
    const sent = api.calls.length;

    await press(query(`#workbench-inspector [data-provenance-link="${RUN}"]`));
    expect(details().querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("run");
    expect(query(`[data-targeted-report="${ARTIFACT}"]`)).toBe(report);
    expect(query(`[data-targeted-selected="${DETECTED}"]`)).toBeTruthy();

    await press(query(`#workbench-inspector [data-provenance-link="${ARTIFACT}"]`));
    expect(details().querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("artifact");
    expect(query(`[data-targeted-report="${ARTIFACT}"]`)).toBe(report);
    expect(query(`[data-targeted-selected="${DETECTED}"]`)).toBeTruthy();
    expect(api.calls.length).toBe(sent);
    expect(api.readTargetedMs1Rows).toHaveBeenCalledTimes(1);
  });

  it("takes the report away for any other selection, and opens none from a run (R3)", async () => {
    await opened();
    await press(query(`[data-project-inspect-layer="${LAYER}"]`));
    expect(document.querySelector("[data-targeted-report]")).toBeNull();
    await press(query(`[data-project-inspect-run="${RUN}"]`));
    expect(document.querySelector("[data-targeted-report]")).toBeNull();
  });

  it("says why a targeted run failed, and that no result was stored, in the history and in Details (R4)", async () => {
    mount(
      withRun(
        { outcome: "failed" },
        { attempt: null, consumedContent: [], failure: { code: "sourceChanged", stage: "source" } },
      ),
    );
    await screen.findByText(en.projectReferences);
    const row = query(`[data-project-run="${RUN}"]`);
    expect(query(`[data-project-run="${RUN}"] [data-project-run-failure="sourceChanged"]`).textContent).toBe(
      en.targetedFailureSourceChanged,
    );
    expect(within(row).getByText(en.projectRunNoResult).hasAttribute("data-project-no-artifact")).toBe(true);
    expect(row.textContent).not.toContain(en.projectRunNoArtifact);
    await press(query(`[data-project-inspect-run="${RUN}"]`));
    expect(query("[data-provenance-no-artifact]").textContent).toBe(en.projectRunNoResult);
  });

  it("says a cancelled targeted run stored nothing, without a failure, and keeps file facts' own words (R4)", async () => {
    mount(
      withRun(
        { outcome: "cancelled" },
        { failure: null, stop: { reason: "cancelRequested", workerTerminated: true, exitObserved: true } },
      ),
    );
    await screen.findByText(en.projectReferences);
    expect(document.querySelector(`[data-project-run="${RUN}"] [data-project-run-failure]`)).toBeNull();
    expect(query(`[data-project-run="${RUN}"] [data-project-no-artifact]`).textContent).toBe(en.projectRunNoResult);
    cleanup();

    const facts = projectRun({ outcome: "failed", outputArtifactIds: [] });
    mount(openProject({ runs: [facts] }));
    await screen.findByText(en.projectReferences);
    expect(query(`[data-project-run="${facts.id}"] [data-project-no-artifact]`).textContent).toBe(en.projectRunNoArtifact);
  });

  it("marks a stored result the project found missing or damaged in the history, before it is opened (R5)", async () => {
    for (const availability of ["payloadMissing", "payloadCorrupt"] as const) {
      mount(targetedProject(availability));
      await screen.findByText(en.projectReferences);
      expect(
        query(`[data-project-artifact="${ARTIFACT}"] [data-project-artifact-availability="${availability}"]`).textContent,
      ).toBe(en[availability === "payloadMissing" ? "targetedStatePayloadMissing" : "targetedStatePayloadCorrupt"]);
      cleanup();
    }
    mount(targetedProject());
    await screen.findByText(en.projectReferences);
    expect(document.querySelector("[data-project-artifact-availability]")).toBeNull();
  });

  it("gives a damaged result's next step, as a missing one's (R6)", async () => {
    mount(targetedProject("payloadCorrupt"));
    await screen.findByText(en.projectReferences);
    await press(query(`[data-project-inspect-artifact="${ARTIFACT}"]`));
    expect(query('[data-targeted-unavailable="payloadCorrupt"]').textContent).toBe(en.targetedPayloadCorrupt);
    expect(en.targetedPayloadCorrupt).toContain("open the project again");
    expect(zh.targetedPayloadCorrupt).toContain("重新打开项目");
  });

});
