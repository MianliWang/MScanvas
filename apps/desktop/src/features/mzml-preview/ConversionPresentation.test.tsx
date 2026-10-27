/**
 * The carried-forward PM9.4 presentation options O1-O8 and the conversion half
 * of PM9.7 F3 (`docs/development/POST_PM9_DEFERRED_WORK.md`), each held against
 * its smallest proposed acceptance.
 *
 * Component level only: jsdom renders the whole application against the
 * modelled boundary. Rendered, browser and native acceptance are separate.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import { bindUiMessages, createUiRuntime, UI_RESOURCES } from "../preferences/i18n";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  outputSetReport,
  previewError,
  queueItem,
  queueOf,
  sciexQueueItem,
  setMembers,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type {
  ConversionPlanOutcome,
  ConversionQueueItem,
  SelectedFile,
  StagingReclaimOutcome,
  WorkspaceConversionState,
  WorkspaceOutputAdoptionResult,
} from "./contracts";
import { conversionNoticeMessage } from "./conversionMessages";
import { resolveConversionScope } from "./conversionScope";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

function raw(index: number): SelectedFile {
  return { handle: `file-${String(index)}`, fileName: `run-${String(index)}.raw`, byteLength: 78_309, sourceKind: "thermo_raw", relativeContext: null };
}

function mzml(index: number, fileName = `QC_${String(index)}.mzML`): SelectedFile {
  return { handle: `mzml-${String(index)}`, fileName, byteLength: 1_024, sourceKind: "mzml", relativeContext: null };
}

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversion & results" }));
}

async function panelOf(api: FakePreviewApi): Promise<HTMLElement> {
  renderApp(api);
  return screen.findByRole("region", { name: "Convert" });
}

async function check(name: string): Promise<void> {
  fireEvent.click(within(await screen.findByRole("row", { name: new RegExp(name.replace(".", "\\.")) })).getByRole("checkbox"));
}

/** A finalized single output, with the report a real one carries. */
function converted(handle: string, name: string, mode: "output_only" | "source_comparison" = "output_only"): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "finalized",
    attempts: 1,
    result: {
      kind: "single" as const,
      report: {
        datasetHandle: handle,
        sourceKind: "thermo_raw",
        outcome: "finalized",
        detailedOutcome: null,
        outputFileName: name.replace(/\.raw$/i, ".mzML"),
        output: { byteLength: 28_655, sha256: "6CE2ACE65485488F4A337EE17B71559E737C1944B641F279744932C3C3D8648C", spectrumCount: 1, chromatogramCount: 1 },
        validationMode: mode,
        validation: { mode, fullyVerified: false, verified: ["source_unchanged"], unverified: [], inapplicable: [], advisory: [] },
        backend: { exitCode: 0, elapsedMilliseconds: 568 },
        stagingResidue: null,
        receipt: 1,
      },
    },
  });
}

/** Three items: the first done, the second under way, the third waiting. */
function running(): WorkspaceConversionState {
  return {
    status: "running",
    operationId: "1",
    queue: queueOf([
      converted("file-1", "run-1.raw"),
      queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 }),
      queueItem("file-3", "run-3.raw"),
    ]),
  };
}

function terminal(items: readonly ConversionQueueItem[]): WorkspaceConversionState {
  return { status: "terminal", reason: "completed", operationId: "1", queue: queueOf(items) };
}

function queueResult(): HTMLElement {
  const result = document.querySelector<HTMLElement>(".conversion-running");
  if (result === null) throw new Error("expected a queue result on screen");
  return result;
}

describe("PM9.4 O1: each finalized member named once, beside its own Open actions", () => {
  const names = ["sample-01.mzML", "sample-02.mzML", "sample-03.mzML", "sample-04.mzML"];
  const openable = (count: number) => names.slice(0, count).map((fileName, index) => ({ outputId: `out-${String(index)}`, fileName }));
  // Where a row says a name, apart from the per-item manifest in its folded
  // details, which is a separate inspection surface.
  const said = (row: HTMLElement, name: string) =>
    within(row).getAllByText(name).filter((node) => node.closest(".conversion-item-detail") === null);

  it("names a complete set's members only in their open groups", async () => {
    await panelOf(createFakePreviewApi({
      initialDatasets: [{ handle: "file-9", fileName: "run.wiff", byteLength: 1, sourceKind: "sciex_wiff", relativeContext: null }],
      availability: availableBackend,
      initialConversion: terminal([sciexQueueItem("file-9", "run.wiff", {
        state: "finalized", attempts: 1, finalizedOutputs: openable(4),
        result: { kind: "outputSet", report: outputSetReport("file-9", names) },
      })]),
    }));
    const row = queueResult().querySelector<HTMLElement>("li[data-item-state]")!;
    expect(row.querySelector(".conversion-queue-set-members")).toBeNull();
    for (const name of names) {
      const group = within(row).getByRole("group", { name: `Locate ${name}` });
      // The name sits beside its own two actions, once in the row.
      expect(within(group).getByText(name)).toBeVisible();
      expect(within(group).getByRole("button", { name: "Open file" })).toBeVisible();
      expect(within(group).getByRole("button", { name: "Open folder" })).toBeVisible();
      expect(said(row, name)).toHaveLength(1);
    }
    expect(row).toHaveTextContent("4 mzML outputs finalized.");
  });

  it("keeps a partial set's facts while its finalized prefix is named beside its actions", async () => {
    const partial = outputSetReport("file-9", names, {
      groupOutcome: "partially_finalized",
      finalizedCount: 2,
      validatedNotPublishedCount: 2,
      notPublishedCount: 0,
      members: setMembers(names, ["finalized", "finalized", "validated_not_published", "validated_not_published"]),
      completeness: { kind: "notPosed" },
      partial: { finalizedCount: 2, notPublishedCount: 2, failureKind: "already_exists" },
      completeSetAdoptable: false,
    });
    await panelOf(createFakePreviewApi({
      initialDatasets: [{ handle: "file-9", fileName: "run.wiff", byteLength: 1, sourceKind: "sciex_wiff", relativeContext: null }],
      availability: availableBackend,
      initialConversion: terminal([sciexQueueItem("file-9", "run.wiff", {
        state: "failed", attempts: 1, finalizedOutputs: openable(2),
        result: { kind: "outputSet", report: partial },
      })]),
    }));
    const row = queueResult().querySelector<HTMLElement>("li[data-item-state]")!;
    expect(row.querySelector(".conversion-queue-set-members")).toBeNull();
    expect(within(row).getAllByRole("group", { name: /^Locate / }).map((group) => group.getAttribute("aria-label")))
      .toEqual(["Locate sample-01.mzML", "Locate sample-02.mzML"]);
    expect(said(row, "sample-01.mzML")).toHaveLength(1);
    // The unpublished members stay unnamed, and the partial facts stay whole.
    expect(within(row).queryAllByText("sample-03.mzML").filter((node) => node.closest(".conversion-item-detail") === null)).toEqual([]);
    expect(row).toHaveTextContent("2 of 4 mzML outputs finalized; 2 not published.");
    expect(row.querySelector(".conversion-queue-set-partial")).toHaveAttribute("role", "note");
  });
});

describe("PM9.4 O2: the excluded rows, named", () => {
  it("lists excluded rows beside the scope without changing membership, eligibility or order", () => {
    const datasets = [raw(1), mzml(1), raw(2), mzml(2)];
    const membership = new Set(datasets.map((row) => row.handle));
    const scope = resolveConversionScope("selected", { datasets, conversionMembership: membership, sort: "added" });
    expect(scope.excluded.map((row) => row.handle)).toEqual(["mzml-1", "mzml-2"]);
    expect(scope).toMatchObject({ requestedCount: 4, excludedCount: 2, handles: ["file-1", "file-2"] });
  });

  it("names them in a disclosure with the exact count, and asks no new plan for opening it", async () => {
    const long = `${"Calibration_reference_".repeat(8)}pool.mzML`;
    const api = createFakePreviewApi({ initialDatasets: [raw(1), mzml(1, long)], availability: availableBackend });
    const panel = await panelOf(api);
    await check("run-1.raw");
    await check("Calibration_reference_");
    await waitFor(() => expect(panel.querySelector("#conversion-plan-summary")).not.toBeNull());
    const asked = api.planRequests().length;
    expect(within(panel).getByText(/2 requested · 1 eligible · 1 excluded \(not convertible\)\./)).toBeVisible();
    const summary = within(panel).getByText("Excluded rows (1)");
    // A native disclosure: a Tab stop, closed until asked.
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    // Outside the live scope summary, so a scope change does not read the names out.
    expect(summary.closest("[aria-live]")).toBeNull();
    fireEvent.click(summary);
    expect(within(summary.closest("details")!).getByText(long)).toBeInTheDocument();
    expect(api.planRequests()).toHaveLength(asked);
    expect(api.planRequests().at(-1)?.handles).toEqual(["file-1"]);
    expect(within(screen.getByRole("row", { name: /Calibration_reference_/ })).getByRole("checkbox")).toBeChecked();
  });

  it("names at most twenty and counts the rest", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => mzml(index + 1));
    const panel = await panelOf(createFakePreviewApi({ initialDatasets: rows, availability: availableBackend }));
    fireEvent.click(within(panel).getByRole("radio", { name: "All workspace rows" }));
    const details = within(panel).getByText("Excluded rows (25)").closest("details")!;
    expect(details.querySelectorAll("li")).toHaveLength(20);
    expect(within(details).getByText("5 more not listed here.")).toBeInTheDocument();
  });
});

describe("PM9.4 O3 and PM9.7 F3: one actionable reason per refused state", () => {
  it("composes the no-target route from the toggle's and Add files' own labels in both languages", () => {
    const { instance } = createUiRuntime();
    for (const locale of ["en", "zh-CN"] as const) {
      const t = bindUiMessages(instance.getFixedT(locale, "ui"));
      const said = conversionNoticeMessage("no-convertible-target", t);
      const words = UI_RESOURCES[locale];
      expect(said).toContain(words.rosterToggle);
      expect(said).toContain(words.addFiles);
      expect(said).not.toMatch(/\{\{|\$t\(/u);
      // Nothing about preview, a usable backend or a conversion that is ready.
      expect(said).not.toMatch(/preview|ProteoWizard|ready|预览|就绪/iu);
    }
  });

  it("names the route without unfolding Acquisitions, and stays true folded or open", async () => {
    const api = createFakePreviewApi({ availability: availableBackend });
    renderApp(api);
    const toggle = screen.getByRole("button", { name: en.rosterToggle });
    const before = toggle.getAttribute("aria-expanded");
    const panel = await screen.findByRole("region", { name: "Convert" });
    const convert = within(panel).getByRole("button", { name: "Convert 0 eligible…" });
    const route = conversionNoticeMessage("no-convertible-target", bindUiMessages(createUiRuntime().instance.getFixedT("en", "ui")));
    await waitFor(() => expect(convert).toHaveAccessibleDescription(route));
    // Saying the route moves nothing: the fold is the reader's.
    expect(toggle.getAttribute("aria-expanded")).toBe(before);
    // True folded and open: folded, the list the toggle controls is hidden;
    // open, the named action is in that list under its label.
    const roster = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    for (let press = 0; press < 2; press += 1) {
      // A settings read may briefly outrank it; the route is what remains.
      await waitFor(() => expect(within(panel).getByText(route)).toBeVisible());
      if (toggle.getAttribute("aria-expanded") === "true") {
        expect(within(roster).getAllByRole("button", { name: en.addFiles }).length).toBeGreaterThan(0);
      } else {
        expect(roster).not.toBeVisible();
      }
      fireEvent.click(toggle);
    }
    expect(toggle.getAttribute("aria-expanded")).toBe(before);
    fireEvent.click(convert);
    expect(api.beginRequests()).toEqual([]);
    expect(api.conversionRequests).toEqual([]);
  });

  it("says an over-capacity scope once with Rust's numbers, and a refused press starts nothing", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [raw(1), raw(2)],
      availability: availableBackend,
      conversionPlan: async (request): Promise<ConversionPlanOutcome> => ({ outcome: "capacityExceeded", capacity: 1, requestedCount: request.handles.length }),
    });
    const panel = await panelOf(api);
    await check("run-1.raw");
    await check("run-2.raw");
    const convert = within(panel).getByRole("button", { name: "Convert 2 eligible…" });
    await waitFor(() => expect(convert).toHaveAccessibleDescription(
      "2 eligible acquisitions exceed the queue capacity of 1. Choose fewer eligible rows before converting.",
    ));
    expect(within(panel).queryByText("Conversion cannot start for this scope.")).toBeNull();
    expect(panel.querySelector("#conversion-plan-pending")).toBeNull();
    expect(convert).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(convert);
    expect(api.beginRequests()).toEqual([]);
    expect(api.conversionRequests).toEqual([]);
  });
});

describe("PM9.4 O4: a failed request names its own control", () => {
  it("leads the one banner with the control's name and keeps the typed message and Dismiss", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [raw(1), raw(2), raw(3)],
      availability: availableBackend,
      initialConversion: running(),
      stop: () => Promise.reject(previewError({ kind: "conversion_not_stoppable", summary: "raw" })),
    });
    const panel = await panelOf(api);
    fireEvent.click(await within(panel).findByRole("button", { name: "Stop queue" }));
    const label = await within(panel).findByText("Stop queue:", { selector: "strong" });
    const banner = label.closest<HTMLElement>(".notice")!;
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("Stop queue: There is no conversion of yours to stop.");
    expect(panel.querySelectorAll(".notice-danger[role='status']")).toHaveLength(1);
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    expect(within(panel).queryByText("Stop queue:")).toBeNull();
  });

  it("blames a late rejection on its own request, not on a press made since", async () => {
    const cancel = deferred<WorkspaceConversionState>();
    const skip = deferred<WorkspaceConversionState>();
    const api = createFakePreviewApi({
      initialDatasets: [raw(1), raw(2), raw(3)],
      availability: availableBackend,
      initialConversion: running(),
      cancelItem: () => cancel.promise,
      skipItem: () => skip.promise,
    });
    const panel = await panelOf(api);
    fireEvent.click(await within(panel).findByRole("button", { name: "Stop this file" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Skip run-3.raw" }));
    await act(async () => cancel.reject(previewError({ kind: "conversion_item_not_cancellable", summary: "raw" })));
    expect(await within(panel).findByText("Stop this file:", { selector: "strong" })).toBeVisible();
    expect(within(panel).queryByText("Skip run-3.raw:")).toBeNull();
    await act(async () => skip.reject(previewError({ kind: "conversion_item_not_skippable", summary: "raw" })));
    expect(await within(panel).findByText("Skip run-3.raw:", { selector: "strong" })).toBeVisible();
    expect(within(panel).queryByText("Stop this file:")).toBeNull();
    // No retry control appears for either.
    expect(within(panel).queryByRole("button", { name: /try again|retry/i })).toBeNull();
  });

  it("names a failed single-output Add as its button reads", async () => {
    const panel = await panelOf(createFakePreviewApi({
      initialDatasets: [raw(1)], availability: availableBackend,
      initialConversion: terminal([converted("file-1", "run-1.raw")]),
      adoption: () => Promise.reject(previewError()),
    }));
    fireEvent.click(await within(panel).findByRole("button", { name: en.m74CnvAddOne }));
    expect(await within(panel).findByText(`${en.m74CnvAddOne}:`, { selector: "strong" })).toBeVisible();
  });

  it("separates the name from the message as each language writes it", () => {
    // The space is the English resource's; a full-width colon takes none.
    expect(en.m74CnvRequestFailed).toBe("{{action}}: ");
    expect(zh.m74CnvRequestFailed).toBe("{{action}}：");
  });
});

describe("PM9.4 O5: the ellipsis only where a picker follows", () => {
  it("drops it for destinations that open none, and starts with the same arguments", async () => {
    const api = createFakePreviewApi({ initialDatasets: [raw(1)], availability: availableBackend, conversion: () => new Promise(() => {}) });
    const panel = await panelOf(api);
    await check("run-1.raw");
    expect(await within(panel).findByRole("button", { name: "Convert 1 eligible…" })).toBeVisible();
    fireEvent.click(within(panel).getByRole("radio", { name: "Named subfolder beside each source" }));
    expect(within(panel).getByRole("button", { name: "Convert 1 eligible" })).toBeVisible();
    fireEvent.click(within(panel).getByRole("radio", { name: "All workspace rows" }));
    expect(within(panel).getByRole("button", { name: "Convert all 1 eligible" })).toBeVisible();
    fireEvent.click(within(panel).getByRole("radio", { name: "Beside each source" }));
    const convert = within(panel).getByRole("button", { name: "Convert all 1 eligible" });
    await waitFor(() => expect(convert).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(convert);
    await waitFor(() => expect(api.beginRequests()).toHaveLength(1));
    expect(api.beginRequests()[0]?.destinationPolicy).toEqual({ kind: "sourceSibling" });
  });

  it("is localized as the same template less the ellipsis", () => {
    for (const words of [en, zh]) {
      expect(words.m74CnvConvertSelected).toBe(`${words.m74CnvConvertSelectedDirect}…`);
      expect(words.m74CnvConvertAll).toBe(`${words.m74CnvConvertAllDirect}…`);
    }
  });
});

describe("PM9.4 O6: Stop and Skip explained where they are offered", () => {
  it("leaves them out of a ready review", async () => {
    const panel = await panelOf(createFakePreviewApi({ initialDatasets: [raw(1)], availability: availableBackend }));
    await check("run-1.raw");
    const convert = within(panel).getByRole("button", { name: "Convert 1 eligible…" });
    await waitFor(() => expect(convert).not.toHaveAttribute("aria-disabled"));
    expect(convert).toHaveAccessibleDescription(/One Thermo RAW acquisition will be converted to mzML\. Output-only validation\./);
    expect(panel.textContent).not.toMatch(/Stop queue|Stop this file|Skip settles/);
  });

  it("explains Skip beside the rows that offer it while the queue runs", async () => {
    const panel = await panelOf(createFakePreviewApi({ initialDatasets: [raw(1), raw(2), raw(3)], availability: availableBackend, initialConversion: running() }));
    const skip = await within(panel).findByRole("button", { name: "Skip run-3.raw" });
    expect(skip).toHaveAccessibleDescription(en.m74CnvSkipExplanation);
    expect(within(panel).getByText(en.m74CnvSkipExplanation)).toBeVisible();
    // Stop queue and Stop this file keep their own explanations.
    expect(within(panel).getByRole("button", { name: "Stop queue" })).toHaveAccessibleDescription(en.m74CnvStopExplanation);
  });

  it("says nothing of Skip where no row offers it", async () => {
    const panel = await panelOf(createFakePreviewApi({
      initialDatasets: [raw(1), raw(2)], availability: availableBackend,
      initialConversion: { status: "running", operationId: "1", queue: queueOf([converted("file-1", "run-1.raw"), queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 })]) },
    }));
    await within(panel).findByRole("button", { name: "Stop queue" });
    expect(within(panel).queryByText(en.m74CnvSkipExplanation)).toBeNull();
  });
});

describe("PM9.4 O7: validation extent from the Rust-projected mode", () => {
  it("says output-only for an output-only plan and claims no check for another", async () => {
    const api = createFakePreviewApi({ initialDatasets: [raw(1)], availability: availableBackend });
    const planned = api.describeConversion;
    let mode: "output_only" | "source_comparison" = "output_only";
    const panel = await panelOf({ ...api, describeConversion: async (request) => {
      const answer = await planned(request);
      return answer.outcome === "planned" ? { ...answer, plan: { ...answer.plan, validationMode: mode } } : answer;
    } });
    await check("run-1.raw");
    await waitFor(() => expect(panel.querySelector("#conversion-validation-disclosure")).toHaveTextContent(en.m74CnvOutputOnly));
    mode = "source_comparison";
    fireEvent.click(within(panel).getByRole("radio", { name: "Beside each source" }));
    // The judgement resources for that mode report a finished comparison,
    // which a plan has not run: the review says nothing of it.
    await waitFor(() => {
      expect(panel.querySelector("#conversion-plan-summary")).not.toBeNull();
      expect(panel.querySelector("#conversion-validation-disclosure")).toBeNull();
    });
    const convert = within(panel).getByRole("button", { name: "Convert 1 eligible" });
    for (const id of convert.getAttribute("aria-describedby")!.split(" ")) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    expect(convert).not.toHaveAccessibleDescription(/Output-only/);
    expect(convert).not.toHaveAccessibleDescription(new RegExp(en.cnvIntegritySource));
  });

  it("does not call a source-compared result output-only", async () => {
    const panel = await panelOf(createFakePreviewApi({
      initialDatasets: [raw(1)], availability: availableBackend,
      initialConversion: terminal([converted("file-1", "run-1.raw", "source_comparison")]),
    }));
    await within(panel).findByText(/1 converted, 0 skipped, 0 failed of 1\./);
    expect(within(queueResult()).queryByText(en.m74CnvOutputOnly)).toBeNull();
    expect(document.querySelector("[data-live-region='conversion']")?.textContent ?? "").not.toContain("Output-only validation");
  });
});

describe("PM9.4 O8: a refused finished-queue action points at what holds it", () => {
  const recovering = (): ConversionQueueItem => queueItem("file-2", "run-2.raw", {
    state: "failed", attempts: 1, stagingRecovery: { recoveryId: "staging-2", attempt: 1, status: "recoverable" },
  });

  it("refers staging cleanup to the adoption under way, and the press does nothing", async () => {
    const adoption = deferred<WorkspaceOutputAdoptionResult>();
    const reclaimed: string[] = [];
    const panel = await panelOf(createFakePreviewApi({
      initialDatasets: [raw(1), raw(2)], availability: availableBackend,
      initialConversion: terminal([converted("file-1", "run-1.raw"), recovering()]),
      adoption: () => adoption.promise,
      reclaimConversionStaging: async (id): Promise<StagingReclaimOutcome> => { reclaimed.push(id); return { status: "cleaned" }; },
    }));
    fireEvent.click(await within(panel).findByRole("button", { name: en.m74CnvAddOne }));
    const cleanup = within(panel).getByRole("button", { name: en.stagingRecoveryButton });
    await waitFor(() => expect(cleanup).toHaveAttribute("aria-disabled", "true"));
    expect(cleanup).toHaveAccessibleDescription(en.m74CnvAdoptInFlight);
    fireEvent.click(cleanup);
    expect(reclaimed).toEqual([]);
  });

  it("refers Add and Diagnostics to a cleanup under way", async () => {
    const reclaim = deferred<StagingReclaimOutcome>();
    const failedWithDiagnostics: WorkspaceConversionState = terminal([converted("file-1", "run-1.raw"), recovering()]);
    const api = createFakePreviewApi({
      initialDatasets: [raw(1), raw(2)], availability: availableBackend,
      initialConversion: failedWithDiagnostics,
      reclaimConversionStaging: () => reclaim.promise,
    });
    const panel = await panelOf(api);
    fireEvent.click(await within(panel).findByRole("button", { name: en.stagingRecoveryButton }));
    const add = within(panel).getByRole("button", { name: en.m74CnvAddOne });
    await waitFor(() => expect(add).toHaveAttribute("aria-disabled", "true"));
    expect(add).toHaveAccessibleDescription(`${en.m74CnvAdoptExplanation} ${en.stagingRecoveryWorking}`);
    fireEvent.click(add);
    expect(api.calls()).not.toContain("adoptConversionOutputs");
    // The failed row makes diagnostics available, and the export is refused
    // for the same reason, as a Tab stop rather than a natively disabled one.
    const diagnostics = within(panel).getByRole("button", { name: en.m74CnvDiagnosticsAction });
    expect(diagnostics).toHaveAttribute("aria-disabled", "true");
    expect(diagnostics).not.toBeDisabled();
    expect(diagnostics).toHaveAccessibleDescription(`${en.m74CnvDiagnosticsExplanation} ${en.stagingRecoveryWorking}`);
    fireEvent.click(diagnostics);
    expect(api.diagnosticsExportRequests).toEqual([]);
    await act(async () => reclaim.resolve({ status: "cleaned" }));
    await waitFor(() => expect(add).not.toHaveAttribute("aria-disabled"));
    expect(add).toHaveAccessibleDescription(en.m74CnvAdoptExplanation);
  });

  it("refers staging cleanup to the running queue's status line", async () => {
    const queue = queueOf([
      queueItem("file-1", "run-1.raw", { state: "failed", attempts: 1, stagingRecovery: { recoveryId: "staging-1", attempt: 1, status: "recoverable" } }),
      queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 }),
    ]);
    const panel = await panelOf(createFakePreviewApi({
      initialDatasets: [raw(1), raw(2)], availability: availableBackend,
      initialConversion: { status: "running", operationId: "1", queue },
    }));
    const cleanup = await within(panel).findByRole("button", { name: en.stagingRecoveryButton });
    expect(cleanup).toHaveAttribute("aria-disabled", "true");
    expect(cleanup).toHaveAccessibleDescription("Converting item 2 of 2…");
  });
});
