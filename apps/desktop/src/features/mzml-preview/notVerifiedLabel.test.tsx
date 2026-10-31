/**
 * ADR 0055's one label, "not verified by MSCanvas", wherever an unverified
 * conversion or its output appears: the plan before Run, the queue while it
 * runs, its results, the action that adds its outputs, and the roster row an
 * adopted output becomes. The project row is in `ProjectPanel.test.tsx`.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  completeCatalog,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  finalizedAttemptFacts,
  queueItem,
  queueOf,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { ConversionPlanOutcome, ConversionQueueItem, ConversionReport, SelectedFile, WorkspaceConversionState } from "./contracts";
import { bindUiMessages, createUiRuntime, UI_RESOURCES } from "../preferences/i18n";

const en = UI_RESOURCES.en;
const RELEASE = "3.0.26204";
const BUILD_LABEL = `Not verified by MSCanvas: ProteoWizard ${RELEASE}`;

function acquisition(index: number): SelectedFile {
  return { handle: `file-${String(index)}`, fileName: `run-${String(index)}.raw`, byteLength: 78_309, sourceKind: "thermo_raw", relativeContext: null };
}
const ROWS = [acquisition(1), acquisition(2)];

function renderApp(api: FakePreviewApi) {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversion" }));
}

function report(handle: string, name: string, overrides: Partial<ConversionReport> = {}): ConversionReport {
  return {
    datasetHandle: handle,
    sourceKind: "thermo_raw",
    outcome: "finalized",
    detailedOutcome: null,
    outputFileName: name.replace(/\.raw$/u, ".mzML"),
    output: { byteLength: 28_637, sha256: "B3D97B38".repeat(8), spectrumCount: 1, chromatogramCount: 1 },
    validationMode: "output_only",
    validation: { mode: "output_only", verified: [], unverified: [], inapplicable: [], advisory: [], fullyVerified: false },
    backend: null,
    stagingResidue: null,
    receipt: 1,
    unverifiedSettings: false,
    unverifiedBuildRelease: RELEASE,
    ...overrides,
  };
}

function finalized(row: SelectedFile, extra: Partial<ConversionQueueItem> = {}): ConversionQueueItem {
  return queueItem(row.handle, row.fileName, {
    state: "finalized",
    attempts: 1,
    finalizedOutputs: [{ outputId: `out-${row.handle}`, fileName: row.fileName.replace(/\.raw$/u, ".mzML") }],
    ...finalizedAttemptFacts(),
    result: { kind: "single", report: report(row.handle, row.fileName) },
    ...extra,
  });
}

describe("the not-verified label", () => {
  it("is on every plan row and counted in the summary before Run", async () => {
    const api = createFakePreviewApi({
      initialDatasets: ROWS,
      availability: availableBackend,
      conversionPlan: (request) => {
        const admitted = completeCatalog.find((row) => row.intent.id === request.intentId)!;
        return Promise.resolve({
          outcome: "planned",
          plan: {
            items: request.handles.map((handle) => {
              const row = ROWS.find((each) => each.handle === handle)!;
              return { datasetHandle: handle, fileName: row.fileName, sourceKind: row.sourceKind,
                output: { kind: "knownSingle", fileName: row.fileName.replace(/\.raw$/u, ".mzML") },
                unverifiedBuildRelease: handle === "file-1" ? RELEASE : null, unverifiedSettings: false };
            }),
            outputFormat: "mzML", compression: "zlib", validationMode: "output_only", capacity: 1_024,
            intent: admitted.intent, conflictPolicy: request.conflictPolicy, receipt: request.expectedReceipt,
            destinationPolicy: request.destinationPolicy,
          },
        } as ConversionPlanOutcome);
      },
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(within(panel).getByRole("radio", { name: "All workspace rows" }));
    const plan = await waitFor(() => {
      const list = panel.querySelector(".conversion-plan-list");
      expect(list).not.toBeNull();
      return list!;
    });
    const rows = plan.querySelectorAll(":scope > li");
    expect(rows[0]?.querySelector("[data-not-verified]")?.textContent).toBe(BUILD_LABEL);
    expect(rows[1]?.querySelector("[data-not-verified]")).toBeNull();
    expect(panel.querySelector("[data-plan-not-verified] dd")?.textContent).toBe("1 of 2 not verified by MSCanvas");
  });

  it("is on a waiting row before any report exists, and on its result", async () => {
    const label = { unverifiedSettings: true, unverifiedBuildRelease: null };
    const running: WorkspaceConversionState = {
      status: "running",
      operationId: "1",
      queue: queueOf([
        queueItem("file-1", "run-1.raw", { state: "running", attempts: 1, notVerifiedByMscanvas: label }),
        queueItem("file-2", "run-2.raw", { notVerifiedByMscanvas: label }),
      ]),
    };
    renderApp(createFakePreviewApi({ initialDatasets: ROWS, availability: availableBackend, initialConversion: running }));
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => expect(panel.querySelectorAll(".conversion-run-list [data-not-verified]")).toHaveLength(2));
    expect(panel.querySelector(".conversion-run-list [data-not-verified]")?.textContent).toBe(en.m74CnvNotVerified);
  });

  it("is said beside Add, which it describes, and on the roster row an adopted output becomes", async () => {
    const terminal: WorkspaceConversionState = {
      status: "terminal",
      reason: "completed",
      operationId: "1",
      // The first carries only its report's label, as a result from before
      // the queue item carried one.
      queue: queueOf([finalized(ROWS[0]!), finalized(ROWS[1]!, { result: { kind: "single", report: report("file-2", "run-2.raw", { unverifiedBuildRelease: null }) } })]),
    };
    const adopted: SelectedFile = { handle: "adopted-1", fileName: "earlier.mzML", byteLength: 1, sourceKind: "mzml", relativeContext: null,
      notVerifiedByMscanvas: { unverifiedSettings: false, unverifiedBuildRelease: RELEASE } };
    renderApp(createFakePreviewApi({ initialDatasets: [...ROWS, adopted], availability: availableBackend, initialConversion: terminal }));
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => expect(panel.querySelectorAll(".conversion-run-list [data-not-verified]")).toHaveLength(1));

    const add = within(panel).getByRole("button", { name: "Add converted outputs to workspace" });
    const tag = document.getElementById("conversion-adopt-not-verified");
    expect(tag?.textContent).toBe("1 not verified by MSCanvas");
    expect(add.getAttribute("aria-describedby")?.split(" ")).toContain("conversion-adopt-not-verified");

    const roster = within(screen.getByRole("treegrid", { name: "Acquisitions" }));
    const row = roster.getByRole("row", { name: new RegExp(BUILD_LABEL.replace(/[.]/gu, "\\.")) });
    expect(row.querySelector("[data-not-verified]")?.textContent).toBe(BUILD_LABEL);
  });

  it("has both bundles, and names the build where the build is why", () => {
    const { instance } = createUiRuntime();
    for (const locale of ["en", "zh-CN"] as const) {
      const t = bindUiMessages(instance.getFixedT(locale, "ui"));
      expect(t("m74CnvNotVerifiedBuild", { release: RELEASE })).toContain(RELEASE);
      expect(t("m74CnvNotVerifiedBuild", { release: RELEASE })).toContain(t("m74CnvNotVerified"));
    }
    expect(UI_RESOURCES["zh-CN"].m74CnvNotVerified).not.toBe(en.m74CnvNotVerified);
  });
});

describe("Thermo's picker scope record", () => {
  it("is its own sentence for a rejected output, in both bundles", async () => {
    const failed: WorkspaceConversionState = {
      status: "terminal",
      reason: "completed",
      operationId: "1",
      queue: queueOf([queueItem("file-1", "run-1.raw", {
        state: "failed",
        attempts: 1,
        result: { kind: "single", report: report("file-1", "run-1.raw", { outcome: "output_rejected", detailedOutcome: "picker_scope_record_mismatch", outputFileName: null, output: null, validation: null }) },
      })]),
    };
    renderApp(createFakePreviewApi({ initialDatasets: ROWS, availability: availableBackend, initialConversion: failed }));
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => expect(panel.querySelector(".conversion-queue-reason")?.textContent).toBe(en.m74CnvPickerScopeMismatch));
    for (const locale of ["en", "zh-CN"] as const) {
      expect(UI_RESOURCES[locale].m74CnvPickerScopeMismatch).not.toBe(UI_RESOURCES[locale].m74CnvSingleRejected);
    }
  });
});
