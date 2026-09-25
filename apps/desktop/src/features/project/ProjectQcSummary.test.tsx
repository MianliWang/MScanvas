/**
 * The QC summary snapshot, as the interface offers and shows it.
 *
 * What is proved here is what the *page* does: when a layer offers to capture
 * its source's QC summary and, when it cannot, which one reason it gives; that
 * a press sends the layer and the viewed preview's token and nothing else;
 * that the new report opens in the main region with its values exactly as
 * recorded -- `Other` kept as a bucket, an unreported chromatogram count and
 * unreported units said to be unreported -- and that Details walks from the
 * report to its run, layer and reference without sending anything. The fake
 * project boundary answers with a table this file chose. That a capture copies
 * the retained summary, attributes it to the build that produced the preview,
 * refuses a stale or foreign preview, reads no file and survives a reopen is
 * proved against the real stores in `apps/desktop/src-tauri/src/qc_snapshot/`
 * and `apps/desktop/src-tauri/src/project/tests.rs`.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import projectStyles from "./project.css?raw";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  appears,
  createFakeProjectApi,
  openProject,
  projectArtifact,
  projectInput,
  projectLayer,
  projectRun,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import type { ViewedPreview } from "./lineage";
import { ProjectApiProvider, type ProjectState, type QcSnapshot } from "./projectApi";
import { ProjectPanel } from "./ProjectPanel";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { useProject } from "./useProject";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

const INPUT = "11111111-5555-4111-8111-111111111111";
const LAYER = "dddddddd-5555-4111-8111-111111111111";
const QC_RUN = "ffffffff-5555-4111-8111-555555555555";
const QC_ARTIFACT = "eeeeeeee-5555-4111-8111-555555555555";
const HANDLE = "dataset-7";
const TOKEN = "run-summary-token-7";
const LABEL = "QC_pool_07.mzML";

/** What the preview on screen is, when it is this layer's source. */
const VIEWING: ViewedPreview = { handle: HANDLE, token: TOKEN, producerIdentified: true };

/** One snapshot, with every state a report has to say out loud. */
function snapshot(overrides: Partial<QcSnapshot> = {}): QcSnapshot {
  const at = (value: string) => ({ value, unit: "notEmitted" as const });
  return {
    totalSpectrumCount: 12_345,
    msLevelCounts: [
      { kind: "level", msLevel: 2, spectrumCount: 4_000 },
      { kind: "other", spectrumCount: 345 },
      { kind: "level", msLevel: 1, spectrumCount: 8_000 },
    ],
    chromatogramCount: { kind: "notReported" },
    retentionTime: {
      kind: "reported",
      minimum: at("0.1"),
      at25PercentBasePeakIntensity: at("12.345678901234567"),
      at50PercentBasePeakIntensity: at("0.30000000000000004"),
      at75PercentBasePeakIntensity: at("7.7"),
      maximum: at("123.456"),
    },
    producer: {
      tool: "msaccess",
      executableSha256: "A1".repeat(32),
      release: "3.0.26204",
      buildDate: null,
      sourceRevision: "a09eea9",
    },
    ...overrides,
  };
}

/** A project whose one reference is in the Workbench and has a layer. */
function layered(input: Partial<ProjectState["inputs"][number]> = {}): ProjectState {
  return openProject({
    inputs: [
      projectInput({
        id: INPUT,
        label: LABEL,
        verification: "matchingRecordedContent",
        workbenchDatasetHandle: HANDLE,
        ...input,
      }),
    ],
    layers: [projectLayer({ id: LAYER, sourceInputId: INPUT })],
  });
}

/** The same project once one QC capture has been recorded, wired as Rust wires it. */
function captured(
  report: Partial<QcSnapshot> = {},
  input: Partial<ProjectState["inputs"][number]> = {},
): ProjectState {
  const base = layered(input);
  return {
    ...base,
    dirty: true,
    layers: [projectLayer({ id: LAYER, sourceInputId: INPUT, consumedByRunIds: [QC_RUN] })],
    runs: [
      projectRun({
        id: QC_RUN,
        operation: "captureAcquisitionQcSnapshotV1",
        inputIds: [],
        layerIds: [LAYER],
        outputArtifactIds: [QC_ARTIFACT],
        startedAt: "2026-09-22T11:00:00Z",
        finishedAt: "2026-09-22T11:00:00Z",
      }),
    ],
    artifacts: [
      projectArtifact({
        id: QC_ARTIFACT,
        label: `QC summary: ${LABEL}`,
        kind: "acquisitionQcSnapshotV1",
        observedInputCount: 0,
        observedMemberCount: 0,
        producedByRunId: QC_RUN,
        sourceInputIds: [],
        qcSnapshot: snapshot(report),
      }),
    ],
  };
}

interface HarnessProps {
  readonly live?: ReadonlySet<string>;
  readonly viewed?: ViewedPreview | null;
  readonly locale?: "en" | "zh-CN";
}

/** The shell's wiring: one session feeding the list and the contextual region. */
function Harness({ live = new Set([HANDLE]), viewed = VIEWING }: HarnessProps) {
  const session = useProject();
  return (
    <>
      <ProjectPanel
        session={session}
        liveDatasetHandles={live}
        viewedPreview={viewed}
        detailsPresent
      />
      <aside id="workbench-inspector">
        <ProvenanceDetails
          provenance={session.provenance}
          onSelect={session.inspect}
          liveDatasetHandles={live}
        />
      </aside>
    </>
  );
}

function tree(api: FakeProjectApi, props: HarnessProps) {
  return (
    <PreferencesApiProvider
      value={createFakePreferencesApi({
        stored: storedRecord({ appearance: { locale: props.locale ?? "en" } }),
      })}
    >
      <SessionPreferencesProvider>
        <ProjectApiProvider value={api}>
          <Harness {...props} />
        </ProjectApiProvider>
      </SessionPreferencesProvider>
    </PreferencesApiProvider>
  );
}

function mount(state: ProjectState, props: HarnessProps = {}) {
  const api = createFakeProjectApi(state);
  const { rerender } = render(tree(api, props));
  return { api, rerender: (next: HarnessProps) => rerender(tree(api, { ...props, ...next })) };
}

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

/** The project on screen (see ProjectLayers.test). */
async function ready(label: string = en.projectReferences) {
  await screen.findByText(label);
}

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  return element;
}

function captureControl(): HTMLButtonElement {
  return query(`[data-project-capture-qc="${LAYER}"]`);
}

function report(): HTMLElement {
  return query("[data-qc-report]");
}

function details(): HTMLElement {
  return query("#workbench-inspector");
}

afterEach(() => {
  cleanup();
});

describe("when a layer may capture its QC summary", () => {
  it("is offered for the layer whose source is the preview on screen, named by that source", async () => {
    const { api } = mount(layered());
    await ready();

    const control = captureControl();
    expect(control.textContent).toBe(en.projectCaptureQc);
    expect(control.getAttribute("aria-label")).toBe(`Capture QC summary: ${LABEL}`);
    expect(control.getAttribute("aria-label")).toContain(control.textContent ?? "");
    expect(control.getAttribute("aria-disabled")).toBeNull();
    expect(control.getAttribute("data-project-qc-unavailable")).toBeNull();
    expect(document.querySelector("[data-project-qc-reason]")).toBeNull();
    // A native button in the tab order: Enter and Space activate it and the
    // shared focus rule outlines it. The browser scenario presses the key.
    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("type")).toBe("button");
    expect(control.tabIndex).toBe(0);
    control.focus();
    expect(document.activeElement).toBe(control);

    api.set(captured());
    await press(control);

    // The layer and the preview's token. No value, no path, no handle.
    expect(api.captureProjectQcSummary).toHaveBeenCalledTimes(1);
    expect(api.captureProjectQcSummary).toHaveBeenCalledWith(LAYER, TOKEN);
    expect(api.calls.filter((call) => call !== "getProjectState")).toEqual([
      "captureProjectQcSummary",
    ]);
    // The keyboard goes to what the press made: the report arrives above the
    // lists and would push the pressed control out of view.
    const heading = query("#qc-report-title");
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    expect(heading.textContent).toBe(en.qcReportTitle);
  });

  it("gives one reason, in its own words, for each way it cannot run -- and sends nothing", async () => {
    const cases: readonly [string, HarnessProps, string, boolean][] = [
      // Not in the Workbench: the row already says so, so the reason is read
      // out with the control and not repeated on screen.
      ["qcNeedsWorkbench", { live: new Set() }, en.projectQcNeedsWorkbench, false],
      ["qcNeedsPreview", { viewed: null }, en.projectQcNeedsPreview, true],
      [
        "qcNeedsPreview",
        { viewed: { handle: "dataset-other", token: "other-token", producerIdentified: true } },
        en.projectQcNeedsPreview,
        true,
      ],
      [
        "qcProducerUnidentified",
        { viewed: { ...VIEWING, producerIdentified: false } },
        en.projectQcProducerUnidentified,
        true,
      ],
    ];
    for (const [reason, props, sentence, visible] of cases) {
      const { api } = mount(layered(), props);
      await ready();

      const control = captureControl();
      expect(control.getAttribute("aria-disabled"), reason).toBe("true");
      expect(control.getAttribute("data-project-qc-unavailable"), reason).toBe(reason);
      const described = document.getElementById(control.getAttribute("aria-describedby") ?? "");
      expect(described?.textContent, reason).toBe(sentence);
      expect(described?.className === "visually-hidden", reason).toBe(!visible);
      // Still reachable, so the reason can be found without a pointer.
      expect(control.hasAttribute("disabled")).toBe(false);

      await press(control);
      expect(api.captureProjectQcSummary, reason).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

describe("the recorded report", () => {
  it("opens the new report in the main region with every value exactly as recorded", async () => {
    const { api } = mount(layered());
    await ready();
    api.set(captured());

    await press(captureControl());

    // The new run and its record are in the history, named for what they are.
    const run = query(`[data-project-run="${QC_RUN}"]`);
    expect(within(run).getByText(en.projectOperationCaptureQc)).toBeTruthy();
    expect(within(run).getByText(`Layer ${LABEL}`)).toBeTruthy();
    expect(
      query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`).textContent,
    ).toBe(en.projectArtifactQcSummary);
    // Each history control's name contains what it shows.
    const runControl = query(`[data-project-inspect-run="${QC_RUN}"]`);
    expect(runControl.getAttribute("aria-label")).toContain(runControl.textContent ?? "-");
    const recordControl = query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`);
    expect(recordControl.getAttribute("aria-label")).toContain(recordControl.textContent ?? "-");

    const surface = report();
    expect(surface.getAttribute("data-qc-report")).toBe(QC_ARTIFACT);
    expect(within(surface).getByRole("heading", { name: en.qcReportTitle })).toBeTruthy();
    expect(query("[data-qc-report-source]").textContent).toContain(LABEL);
    expect(within(surface).getByText(en.qcReportMeaning)).toBeTruthy();
    expect(query("[data-qc-total-spectra]").textContent).toBe("12,345");
    // Not reported is not zero.
    const chromatograms = query("[data-qc-chromatograms]");
    expect(chromatograms.getAttribute("data-qc-chromatograms")).toBe("notReported");
    expect(chromatograms.textContent).toBe(en.qcReportNotReported);
    // The buckets in the order reported, `Other` where it was.
    const buckets = Array.from(surface.querySelectorAll("[data-qc-bucket]"));
    expect(buckets.map((row) => row.getAttribute("data-qc-bucket"))).toEqual([
      "ms2",
      "other",
      "ms1",
    ]);
    expect(buckets.map((row) => row.textContent)).toEqual([
      "MS24,000",
      `${en.qcReportOtherLevel}345`,
      "MS18,000",
    ]);
    // Retention times as the stored text, each with its unit said to be
    // unreported rather than guessed.
    const positions = Array.from(surface.querySelectorAll("[data-qc-rt]"));
    expect(positions.map((row) => row.querySelector(".qc-report-value")?.textContent)).toEqual([
      "0.1",
      "12.345678901234567",
      "0.30000000000000004",
      "7.7",
      "123.456",
    ]);
    for (const row of positions) {
      expect(row.querySelector("[data-qc-unit]")?.textContent).toBe(en.qcReportUnitNotReported);
    }
    // No grade and no verdict anywhere in the report.
    expect(surface.textContent?.toLowerCase()).not.toMatch(/pass|fail|good|poor|grade/);
  });

  it("says a reported count and absent retention times in their own words", async () => {
    mount(
      captured({
        chromatogramCount: { kind: "reported", count: 0 },
        retentionTime: { kind: "notReported" },
      }),
    );
    await ready();
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));

    // A reported zero is a count, shown as one.
    expect(query("[data-qc-chromatograms]").textContent).toBe("0");
    expect(query("[data-qc-retention]").getAttribute("data-qc-retention")).toBe("notReported");
    expect(query("[data-qc-retention]").textContent).toBe(en.qcReportRetentionNotReported);
    expect(document.querySelector("[data-qc-rt]")).toBeNull();
  });

  it("does not take the selection from a reader who moved on while the capture was out", async () => {
    const { api } = mount(layered());
    await ready();
    api.set(captured());
    const release = api.holdOnce("captureProjectQcSummary");

    captureControl().focus();
    await press(captureControl());
    // The reader moves on -- the keyboard and the selection both -- before the
    // answer arrives.
    const reference = screen.getByRole("button", { name: `Show what ${LABEL} is related to` });
    reference.focus();
    await press(reference);
    await act(async () => {
      release();
    });

    expect(details().querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe(
      "input",
    );
    expect(document.querySelector("[data-qc-report]")).toBeNull();
    expect(document.activeElement).toBe(reference);
    // The report was recorded all the same, and is one press away.
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));
    expect(report()).toBeTruthy();
  });

  it("opens the report but leaves the keyboard where a reader moved it while the capture was out", async () => {
    const { api } = mount(layered());
    await ready();
    api.set(captured());
    const release = api.holdOnce("captureProjectQcSummary");

    captureControl().focus();
    await press(captureControl());
    // Only the keyboard moves; nothing else is selected.
    const elsewhere = screen.getByRole("button", { name: `Remove layer: ${LABEL}` });
    elsewhere.focus();
    await act(async () => {
      release();
    });

    expect(report().getAttribute("data-qc-report")).toBe(QC_ARTIFACT);
    expect(document.activeElement).toBe(elsewhere);
  });

  it("does not give the keyboard to a report the reader opened while the capture was out", async () => {
    // An earlier report exists. The reader presses capture, then opens that
    // earlier report while the answer is out, with the keyboard still on the
    // pressed control. The answer arrives: the selection moved, so the new
    // report does not open -- and the one on screen is the reader's, not the
    // capture's, so it does not take the keyboard either.
    const { api } = mount(captured());
    await ready();
    const release = api.holdOnce("captureProjectQcSummary");

    captureControl().focus();
    await press(captureControl());
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));
    expect(document.activeElement).toBe(captureControl());
    await act(async () => {
      release();
    });

    expect(report().getAttribute("data-qc-report")).toBe(QC_ARTIFACT);
    expect(document.activeElement).toBe(captureControl());
  });

  it("leaves the keyboard on the control when a capture is refused beside an open report", async () => {
    const { api } = mount(captured());
    await ready();
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));
    expect(report()).toBeTruthy();
    api.refuseOnce("captureProjectQcSummary", "previewNotCurrent");

    captureControl().focus();
    await press(captureControl());

    // The report on screen was there before the press; nothing was made.
    expect(query("[data-project-problem]").textContent).toContain(
      en.projectRefusedPreviewNotCurrent,
    );
    expect(report().getAttribute("data-qc-report")).toBe(QC_ARTIFACT);
    expect(document.activeElement).toBe(captureControl());
  });

  it("takes the keyboard to the report of a capture pressed the instant its layer appears", async () => {
    // Create layer settles, and the reader presses the new row's Capture QC
    // before React has run the effects of the commit that showed it, as a
    // click can in the application. Work the surface finished before the press
    // must not spend what the press asked for.
    const { api } = mount(openProject({ inputs: layered().inputs }));
    await ready();
    const release = api.holdOnce("createProjectLayer");
    await press(query(`[data-project-create-layer="${INPUT}"]`));
    api.set(layered());
    const arrived = appears(`[data-project-layer="${LAYER}"]`);
    // Outside act, so the answer commits as the application's would.
    release();
    await arrived;

    api.set(captured());
    captureControl().focus();
    await press(captureControl());
    await waitFor(() => expect(document.activeElement).toBe(query("#qc-report-title")));
  });

  it("walks from the report to its run, its layer and its reference without sending anything", async () => {
    const { api } = mount(captured());
    await ready();
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));
    const sent = api.calls.length;

    const region = within(details());
    expect(region.getByText(en.projectArtifactQcSummary)).toBeTruthy();
    expect(region.getByText(en.provenanceArtifactStored)).toBeTruthy();
    // Where it came from, and which build produced it -- and not the values,
    // which are the report's.
    expect(region.getByText(en.provenanceSourceLayer)).toBeTruthy();
    const producer = query("[data-provenance-producer]");
    expect(within(producer).getByText("3.0.26204")).toBeTruthy();
    expect(within(producer).getByText("a09eea9")).toBeTruthy();
    expect(within(producer).getByText(en.provenanceProducerNotReported)).toBeTruthy();
    expect(query("[data-producer-digest]").textContent).toBe("A1".repeat(32));
    expect(details().textContent).not.toContain("12,345");
    expect(details().textContent).not.toMatch(/[A-Za-z]:\\|\/Users\/|msaccess\.exe/);

    // Report -> run.
    await press(region.getByRole("button", { name: /Show what the Capture QC summary run of/ }));
    expect(details().querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe(
      "run",
    );
    expect(within(details()).getByRole("heading", { name: en.projectOperationCaptureQc })).toBeTruthy();
    // Run -> layer.
    await press(
      within(details()).getByRole("button", { name: `Show what the layer of ${LABEL} is related to` }),
    );
    expect(details().querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe(
      "layer",
    );
    // The layer's own history names this run; its source's is separate.
    expect(within(details()).getByText(en.provenanceLayerUsedBy)).toBeTruthy();
    expect(within(details()).getByText(en.provenanceLayerSourceUsedByNothing)).toBeTruthy();
    // Layer -> reference.
    await press(within(details()).getByRole("button", { name: `Show what ${LABEL} is related to` }));
    expect(details().querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe(
      "input",
    );

    expect(api.calls.length).toBe(sent);
  });

  it("stays whole when the source leaves the Workbench, and after a reopen that restored no row", async () => {
    const { api, rerender } = mount(captured());
    await ready();
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));
    const values = report().textContent;

    // The row is removed: the layer is detached, the report is history.
    rerender({ live: new Set(), viewed: null });
    expect(query(`[data-project-layer="${LAYER}"]`).getAttribute("data-layer-availability")).toBe(
      "detached",
    );
    expect(report().textContent).toBe(values);
    expect(captureControl().getAttribute("data-project-qc-unavailable")).toBe("qcNeedsWorkbench");

    // Saved, closed and opened again: the same identifiers, every reference
    // unchecked, no row remembered, no preview.
    const reopened: ProjectState = {
      ...captured({}, { verification: "notChecked", workbenchDatasetHandle: null }),
      dirty: false,
      published: true,
    };
    api.set(reopened);
    await press(screen.getByRole("button", { name: en.projectOpen }));
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));

    expect(report().textContent).toBe(values);
    expect(within(details()).getByText("3.0.26204")).toBeTruthy();
    expect(captureControl().getAttribute("data-project-qc-unavailable")).toBe("qcNeedsWorkbench");
  });

  it("wraps rather than widening the surface for a long source name", async () => {
    const long = `${"Plasma_QC_pool_batch_".repeat(10)}run_07.mzML`;
    mount(captured({}, { label: long }));
    await ready();
    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));
    expect(query("[data-qc-report-source]").textContent).toContain(long);

    // jsdom lays nothing out, so the stylesheet is held to its word here and
    // the browser scenario measures the surface's scroll width at 1366x768
    // and 960x640.
    const style = document.createElement("style");
    style.textContent = projectStyles;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSStyleRule => "selectorText" in rule,
      );
      const rule = (selector: string) => rules.find((each) => each.selectorText === selector);
      expect(rule(".qc-report")?.style.getPropertyValue("overflow-wrap")).toBe("anywhere");
      expect(rule(".qc-report-tables")?.style.getPropertyValue("flex-wrap")).toBe("wrap");
      expect(rule(".qc-report-table")?.style.getPropertyValue("max-width")).toBe("100%");
      expect(rule(".provenance-facts dd")?.style.getPropertyValue("overflow-wrap")).toBe(
        "anywhere",
      );
    } finally {
      style.remove();
    }
  });
});

describe("what a refused capture or removal says", () => {
  it("names each refusal in its own words and records nothing", async () => {
    const cases: readonly [string, string][] = [
      ["previewNotCurrent", en.projectRefusedPreviewNotCurrent],
      ["producerUnidentified", en.projectRefusedProducerUnidentified],
      ["summaryTooLarge", en.projectRefusedSummaryTooLarge],
      // The shared identifiers, said as a capture means them.
      ["staleDocument", en.projectRefusedQcProjectChanged],
      ["notInWorkbench", en.projectRefusedQcNotInWorkbench],
    ];
    for (const [code, sentence] of cases) {
      const { api } = mount(layered());
      await ready();
      api.refuseOnce("captureProjectQcSummary", code);

      captureControl().focus();
      await press(captureControl());

      expect(query("[data-project-problem]").textContent, code).toContain(sentence);
      expect(document.querySelector("[data-qc-report]"), code).toBeNull();
      expect(document.querySelector("[data-project-run]"), code).toBeNull();
      // Nothing was made, so the keyboard stays where it was.
      expect(document.activeElement, code).toBe(captureControl());
      cleanup();
    }
  });

  it("refuses to remove a layer a recorded run used, and says why", async () => {
    const { api } = mount(captured());
    await ready();
    api.refuseOnce("removeProjectLayer", "layerUsedByRun");

    await press(screen.getByRole("button", { name: `Remove layer: ${LABEL}` }));

    expect(query("[data-project-problem]").textContent).toContain(
      en.projectRefusedLayerUsedByRun,
    );
    expect(query(`[data-project-layer="${LAYER}"]`)).toBeTruthy();
  });
});

describe("in Simplified Chinese", () => {
  it("renders the control, the report and Details with no English left over", async () => {
    mount(captured(), { locale: "zh-CN" });
    await ready(zh.projectReferences);

    const control = captureControl();
    expect(control.textContent).toBe(zh.projectCaptureQc);
    expect(control.getAttribute("aria-label")).toBe(`记录 QC 摘要：${LABEL}`);
    expect(control.getAttribute("aria-label")).toContain(zh.projectCaptureQc);
    // The history controls' names contain what they show in this locale too.
    const runControl = query(`[data-project-inspect-run="${QC_RUN}"]`);
    expect(runControl.textContent).toBe(zh.projectOperationCaptureQc);
    expect(runControl.getAttribute("aria-label")).toContain(zh.projectOperationCaptureQc);
    const recordControl = query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`);
    expect(recordControl.getAttribute("aria-label")).toContain(zh.projectArtifactQcSummary);

    await press(query(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`));
    const surface = within(report());
    for (const key of [
      "qcReportTitle",
      "qcReportMeaning",
      "qcReportTotals",
      "qcReportTotalSpectra",
      "qcReportChromatograms",
      "qcReportNotReported",
      "qcReportMsLevels",
      "qcReportOtherLevel",
      "qcReportRetention",
      "qcReportRtMinimum",
      "qcReportRt25",
      "qcReportRt50",
      "qcReportRt75",
      "qcReportRtMaximum",
    ] as const) {
      expect(surface.getAllByText(zh[key]).length, key).toBeGreaterThan(0);
      expect(zh[key], key).not.toEqual(en[key]);
    }
    expect(surface.getAllByText(zh.qcReportUnitNotReported)).toHaveLength(5);
    const region = within(details());
    expect(region.getByText(zh.projectArtifactQcSummary)).toBeTruthy();
    expect(region.getByText(zh.provenanceProducer)).toBeTruthy();
    expect(region.getByText(zh.provenanceProducerNotReported)).toBeTruthy();

    for (const key of [
      "qcReportTitle",
      "qcReportMeaning",
      "qcReportUnitNotReported",
      "projectCaptureQc",
      "provenanceProducer",
      "provenanceSourceLayer",
    ] as const) {
      expect(document.body.textContent, key).not.toContain(en[key]);
    }
    for (const key of [
      "projectQcNeedsWorkbench",
      "projectQcNeedsPreview",
      "projectQcProducerUnidentified",
      "projectRefusedPreviewNotCurrent",
      "projectRefusedProducerUnidentified",
      "projectRefusedQcProjectChanged",
      "projectRefusedQcNotInWorkbench",
      "projectRefusedLayerUsedByRun",
      "projectBusyRecordingQc",
    ] as const) {
      expect(zh[key], key).not.toEqual(en[key]);
    }
  });
});
