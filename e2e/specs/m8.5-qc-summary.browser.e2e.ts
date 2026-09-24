/**
 * M8.5 -- a QC summary snapshot captured from the preview on screen, read as a
 * report, and kept across a reopen, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced. So this is
 * React, CSS, layout and interaction evidence: when a layer offers to capture
 * its source's QC summary and why it will not, what a keyboard press sends,
 * where the report appears and what it says, how Details walks from the report
 * to its run, layer and reference, what a save, a close and a reopen leave on
 * screen, and whether a long source name pushes anything sideways.
 *
 * It is **not** filesystem, persistence or provider evidence. The preview and
 * its run summary are a controlled fixture answer; the build that "produced"
 * it -- its release, revision and executable digest -- is controlled fixture
 * provenance, not a ProteoWizard this machine ran; and the recorded snapshot,
 * the saved project and the reopened project are what the answer table says
 * they are. That a capture copies the summary Rust retained, attributes it to
 * the build that produced the preview rather than the one configured later,
 * refuses a stale or foreign preview, reads no file, starts no process and
 * survives a real save and reopen is proved against the real stores in
 * `apps/desktop/src-tauri/src/qc_snapshot/tests.rs` and
 * `apps/desktop/src-tauri/src/project/tests.rs`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  focusedTreatment,
  installIpcBoundary,
  ipcCalls,
  setInvokeResult,
  revealInDetails,
} from "../support/harness";
import { MZML_ROW, ipcTable } from "../support/fixtures";
import { FAKE_WORKSPACE_CAPACITY } from "../../apps/desktop/src/test/previewFixtures";

let output = "";
const evidence: unknown[] = [];

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

const INPUT = "11111111-8585-4111-8111-111111111111";
const LAYER = "dddddddd-8585-4111-8111-111111111111";
const QC_RUN = "ffffffff-8585-4111-8111-111111111111";
const QC_ARTIFACT = "eeeeeeee-8585-4111-8111-111111111111";
/** The token the fixture preview is answered with. Opaque, and never shown. */
const TOKEN = "run-summary-token";

/** Controlled fixture provenance: no real build is named by any of this. */
const DIGEST = "A1".repeat(32);

/** The snapshot the answer table says the capture recorded. */
const SNAPSHOT = {
  totalSpectrumCount: 12_345,
  msLevelCounts: [
    { kind: "level", msLevel: 2, spectrumCount: 4_000 },
    { kind: "other", spectrumCount: 345 },
    { kind: "level", msLevel: 1, spectrumCount: 8_000 },
  ],
  chromatogramCount: { kind: "notReported" },
  retentionTime: {
    kind: "reported",
    minimum: { value: "0.1", unit: "notEmitted" },
    at25PercentBasePeakIntensity: { value: "12.345678901234567", unit: "notEmitted" },
    at50PercentBasePeakIntensity: { value: "0.30000000000000004", unit: "notEmitted" },
    at75PercentBasePeakIntensity: { value: "7.7", unit: "notEmitted" },
    maximum: { value: "123.456", unit: "notEmitted" },
  },
  producer: {
    tool: "msaccess",
    executableSha256: DIGEST,
    release: "3.0.26204",
    buildDate: null,
    sourceRevision: "a09eea9",
  },
};

const NO_PROJECT = {
  open: false,
  projectId: null,
  name: "",
  dirty: false,
  published: false,
  inputs: [],
  artifacts: [],
  runs: [],
  layers: [],
};

/**
 * A saved project whose one reference has a layer, before and after one QC
 * capture, exactly as the projection carries it.
 */
function project(options: {
  readonly handle: string | null;
  readonly captured: boolean;
  readonly dirty?: boolean;
  readonly verification?: "matchingRecordedContent" | "notChecked";
  readonly label?: string;
}) {
  const label = options.label ?? MZML_ROW.fileName;
  return {
    open: true,
    projectId: "aaaaaaaa-8585-4111-8111-000000000001",
    name: "Plasma batch 8",
    dirty: options.dirty ?? false,
    published: true,
    inputs: [
      {
        id: INPUT,
        label,
        locatorKind: "insideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 2048 }],
        verification: options.verification ?? "matchingRecordedContent",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [],
        workbenchDatasetHandle: options.handle,
      },
    ],
    artifacts: options.captured
      ? [
          {
            id: QC_ARTIFACT,
            label: `QC summary: ${label}`,
            kind: "acquisitionQcSnapshotV1",
            observedInputCount: 0,
            observedMemberCount: 0,
            qcSnapshot: SNAPSHOT,
            producedByRunId: QC_RUN,
            sourceInputIds: [],
          },
        ]
      : [],
    runs: options.captured
      ? [
          {
            id: QC_RUN,
            operation: "captureAcquisitionQcSnapshotV1",
            outcome: "completed",
            inputIds: [],
            layerIds: [LAYER],
            outputArtifactIds: [QC_ARTIFACT],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-22T11:00:00Z",
            finishedAt: "2026-09-22T11:00:00Z",
          },
        ]
      : [],
    layers: [
      {
        id: LAYER,
        sourceInputId: INPUT,
        consumedByRunIds: options.captured ? [QC_RUN] : [],
      },
    ],
  };
}

async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw Error("Owned ChromeDriver port missing");
  const root = `${protocol}://${hostname}:${port}${path.endsWith("/") ? path : path + "/"}`;
  const response = await fetch(new URL(`session/${browser.sessionId}/goog/cdp/execute`, root), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, params }),
  });
  const data = (await response.json()) as { value?: Record<string, unknown> };
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data));
  return data.value ?? {};
}

async function metrics(width: number, height: number) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.waitUntil(() =>
    browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
  );
}

/**
 * One frame, with the geometry and state that frame is evidence for.
 *
 * The assertions are the ones a screenshot cannot make: nothing scrolls
 * sideways -- not the page, not the project surface, not Details -- no absolute
 * path, no layer identifier and no preview token is on screen, the page
 * reached for nothing off-origin, and the capture control is inside the
 * viewport at the compact minimum wherever the project surface is shown.
 */
async function capture(label: string) {
  const measured = await browser.execute(
    (layerId: string, token: string) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const attribute = (node: Element | null, name: string) => node?.getAttribute(name) ?? null;
      const root = document.querySelector(".workbench-shell");
      if (root === null) throw Error("The shell is not mounted");
      const project = document.querySelector<HTMLElement>("#workbench-project");
      const inspector = document.querySelector<HTMLElement>("#workbench-inspector");
      const control = document.querySelector(`[data-project-capture-qc="${layerId}"]`);
      const describedBy = attribute(control, "aria-describedby");
      const reason = describedBy === null ? null : document.getElementById(describedBy);
      const report = document.querySelector("[data-qc-report]");
      const active = document.activeElement;
      return {
        css: { width: innerWidth, height: innerHeight },
        surface: root.getAttribute("data-surface"),
        projectShown: project !== null && !project.hidden,
        projectOverflow:
          project === null || project.hidden ? 0 : project.scrollWidth - project.clientWidth,
        control:
          control === null
            ? null
            : {
                text: control.textContent,
                name: attribute(control, "aria-label"),
                disabled: attribute(control, "aria-disabled"),
                hardDisabled: control.hasAttribute("disabled"),
                unavailable: attribute(control, "data-project-qc-unavailable"),
                reason: reason?.textContent ?? null,
                reasonVisible: reason !== null && reason.className !== "visually-hidden",
                ...rect(control),
              },
        layerAvailability: attribute(
          document.querySelector(`[data-project-layer="${layerId}"]`),
          "data-layer-availability",
        ),
        referenceOffers: document.querySelector("[data-project-add-to-workbench]")
          ? "add"
          : document.querySelector("[data-project-show-in-workbench]")
            ? "show"
            : null,
        report:
          report === null
            ? null
            : {
                artifact: report.getAttribute("data-qc-report"),
                heading: report.querySelector("h3")?.textContent ?? null,
                source: report.querySelector("[data-qc-report-source]")?.textContent ?? null,
                total: report.querySelector("[data-qc-total-spectra]")?.textContent ?? null,
                chromatograms: report.querySelector("[data-qc-chromatograms]")?.textContent ?? null,
                buckets: [...report.querySelectorAll("[data-qc-bucket]")].map((row) => [
                  row.getAttribute("data-qc-bucket"),
                  row.querySelector("th")?.textContent ?? null,
                  row.querySelector("td")?.textContent ?? null,
                ]),
                retention: [...report.querySelectorAll("[data-qc-rt]")].map((row) => [
                  row.getAttribute("data-qc-rt"),
                  row.querySelector(".qc-report-value")?.textContent ?? null,
                  row.querySelector("[data-qc-unit]")?.textContent ?? null,
                ]),
                text: (report as HTMLElement).innerText,
                // Whether the heading is inside the part of the surface that is
                // on screen: a report scrolled so that its values show and its
                // name does not is a report read without knowing what it is.
                headingVisible: (() => {
                  const heading = report.querySelector("h3");
                  if (heading === null || project === null) return false;
                  const top = heading.getBoundingClientRect().top;
                  const bounds = project.getBoundingClientRect();
                  return top >= bounds.top - 1 && top < Math.min(bounds.bottom, innerHeight);
                })(),
                ...rect(report),
              },
        details:
          inspector === null || inspector.hidden
            ? null
            : {
                describing: attribute(
                  inspector.querySelector("[data-provenance]"),
                  "data-provenance",
                ),
                name: inspector.querySelector(".provenance-name")?.textContent ?? null,
                links: [...inspector.querySelectorAll("[data-provenance-link]")].map((node) => ({
                  id: node.getAttribute("data-provenance-link"),
                  text: node.textContent,
                  name: node.getAttribute("aria-label"),
                })),
                producer:
                  inspector.querySelector("[data-provenance-producer]")?.textContent ?? null,
                digest:
                  inspector.querySelector("[data-producer-digest]")?.textContent ?? null,
                region: {
                  ...rect(inspector),
                  overflow: inspector.scrollWidth - inspector.clientWidth,
                },
              },
        runs: [...document.querySelectorAll("[data-project-run]")].map((node) =>
          node.querySelector("[data-project-inspect-run]")?.textContent ?? null,
        ),
        activeElement:
          active === null ? null : attribute(active, "data-project-capture-qc"),
        // Where the keyboard is, and whether that element is inside the part of
        // the window a reader can see.
        focus:
          active === null || active === document.body
            ? null
            : {
                id: active.id === "" ? null : active.id,
                visible: (() => {
                  const box = active.getBoundingClientRect();
                  const bounds =
                    project !== null && !project.hidden && project.contains(active)
                      ? project.getBoundingClientRect()
                      : { top: 0, bottom: innerHeight };
                  return (
                    box.top >= bounds.top - 1 &&
                    box.bottom <= Math.min(bounds.bottom, innerHeight) + 1
                  );
                })(),
              },
        layerIdOnScreen: document.body.innerText.includes(layerId),
        tokenOnScreen: document.body.innerText.includes(token),
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        // The shell does not scroll as a whole: its header stays at the top
        // whatever a surface inside it does.
        headerTop: document.querySelector(".workbench-header")?.getBoundingClientRect().top ?? null,
        pageScroll: {
          x: scrollX,
          y: scrollY,
          shell: root.scrollTop,
          layout: document.querySelector(".workspace-layout")?.scrollTop ?? 0,
        },
        pathsOnScreen: (document.body.innerText.match(/[A-Za-z]:\\[^\s]+/gu) ?? []).length,
        external: performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
      };
    },
    LAYER,
    TOKEN,
  );
  const screenshot = await cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({
    label,
    kind:
      "React/mock-IPC layout and interaction evidence. The preview and its run summary are a " +
      "controlled fixture answer; the producing build (release, revision, executable digest) " +
      "is controlled fixture provenance; the recorded snapshot, the saved project and the " +
      "reopened project are a controlled answer table. No filesystem was read, no document " +
      "was written and no provider was involved.",
    ...measured,
  });

  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.headerTop).toBe(0);
  expect(measured.pageScroll).toEqual({ x: 0, y: 0, shell: 0, layout: 0 });
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  expect(measured.layerIdOnScreen).toBe(false);
  expect(measured.tokenOnScreen).toBe(false);
  if (measured.projectShown) {
    expect(measured.projectOverflow).toBeLessThanOrEqual(1);
    if (measured.control !== null) {
      expect(measured.control.x).toBeGreaterThanOrEqual(0);
      expect(measured.control.x + measured.control.width).toBeLessThanOrEqual(
        measured.css.width + 1,
      );
      expect(measured.control.height).toBeGreaterThanOrEqual(31.5);
    }
  }
  if (measured.details !== null) {
    expect(measured.details.region.overflow).toBeLessThanOrEqual(1);
  }
  return measured;
}

/** The report's values, as the fixture recorded them. */
function expectTheRecordedValues(report: Awaited<ReturnType<typeof capture>>["report"]) {
  expect(report).not.toBeNull();
  expect(report?.artifact).toBe(QC_ARTIFACT);
  expect(report?.heading).toBe("QC summary snapshot");
  expect(report?.total).toBe("12,345");
  expect(report?.chromatograms).toBe("Not reported");
  expect(report?.buckets).toEqual([
    ["ms2", "MS2", "4,000"],
    ["other", "Other (not attributed to a level)", "345"],
    ["ms1", "MS1", "8,000"],
  ]);
  expect(report?.retention).toEqual([
    ["minimum", "0.1", "Unit not reported"],
    ["at25", "12.345678901234567", "Unit not reported"],
    ["at50", "0.30000000000000004", "Unit not reported"],
    ["at75", "7.7", "Unit not reported"],
    ["maximum", "123.456", "Unit not reported"],
  ]);
  // A description, not a verdict.
  expect(report?.text.toLowerCase()).not.toMatch(/\b(pass|fail|good|poor|grade)\b/u);
}

describe("M8.5 QC summary snapshot and report, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_M85_OUTPUT_ROOT"] ?? resolve("test-results/m8.5");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M8.5 browser evidence: ${output}`);
  });

  after(async () => {
    evidence.push({ console: await consoleEntries() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  afterEach(async function () {
    evidence.push({
      test: this.currentTest?.title,
      state: this.currentTest?.state,
      console: await consoleEntries(),
    });
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(join(output, `failure-${evidence.length}.png`));
      evidence.push({
        failedDocument: await browser.execute(() => document.body.innerText.slice(0, 8000)),
      });
    }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  it("captures the summary of the preview on screen, reads it as a report, and keeps it across a reopen", async () => {
    await metrics(1920, 1080);
    const table: Record<string, unknown> = ipcTable();
    table.get_workspace_roster = { datasets: [MZML_ROW], capacity: FAKE_WORKSPACE_CAPACITY };
    table.get_project_state = project({ handle: MZML_ROW.handle, captured: false });
    table.capture_project_qc_summary = {
      project: project({ handle: MZML_ROW.handle, captured: true, dirty: true }),
      artifactId: QC_ARTIFACT,
    };
    await installIpcBoundary(table);
    await browser.url("/");
    await browser.$(".workbench-header").waitForDisplayed();
    await browser.$("button=Project").click();
    await browser.$(`[data-project-capture-qc="${LAYER}"]`).waitForDisplayed();

    // 1. The source is in the Workbench and nothing has been viewed. The
    // control is reachable, says why it does nothing, and does nothing: it
    // never starts a preview itself.
    const unviewed = await capture("m85-01-needs-preview");
    expect(unviewed.layerAvailability).toBe("attached");
    expect(unviewed.control).toMatchObject({
      text: "Capture QC summary",
      name: `Capture QC summary: ${MZML_ROW.fileName}`,
      disabled: "true",
      hardDisabled: false,
      unavailable: "qcNeedsPreview",
      reason:
        "View this layer's source in the Workbench first. The QC summary is copied from the preview on screen.",
      reasonVisible: true,
    });
    const idle = await ipcCalls();
    await browser.$(`[data-project-capture-qc="${LAYER}"]`).click();
    expect(await ipcCalls()).toEqual(idle);
    expect(await browser.$("[data-qc-report]").isExisting()).toBe(false);

    // 2. The reader views the source, by the Workbench's own action.
    const row = `.grouped-roster [data-handle="${MZML_ROW.handle}"]`;
    if (!(await browser.$(row).isDisplayed())) {
      await browser.$('[aria-controls="workbench-roster"]').click();
    }
    await browser.$(row).click();
    await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
    await browser.$("button=Project").click();
    await browser.$(`[data-project-capture-qc="${LAYER}"]:not([aria-disabled])`).waitForDisplayed();
    const offered = await capture("m85-02-offered");
    expect(offered.control).toMatchObject({ disabled: null, unavailable: null, reason: null });

    // 3. Capture by keyboard: real focus, a real Enter.
    const beforeCapture = await ipcCalls();
    await browser.execute((layer: string) => {
      document.querySelector<HTMLElement>(`[data-project-capture-qc="${layer}"]`)?.focus();
    }, LAYER);
    await browser.keys("Enter");
    await browser.$("[data-qc-report]").waitForDisplayed();
    await browser.$("[data-project-busy]").waitForExist({ reverse: true });
    const ring = await focusedTreatment();
    evidence.push({ label: "m85-03-focus-treatment", ...ring });
    expect(ring.visible).toBe(true);
    // The layer and the preview's token, and that is the only request: no
    // value, no path, no handle, no preview read, no file check.
    expect((await ipcCalls()).slice(beforeCapture.length)).toEqual([
      { command: "capture_project_qc_summary", args: { layerId: LAYER, previewToken: TOKEN } },
    ]);

    const recorded = await capture("m85-03-report");
    // The keyboard went to what the press made, and it is on screen.
    expect(recorded.focus).toEqual({ id: "qc-report-title", visible: true });
    expect(recorded.report?.headingVisible).toBe(true);
    expect(recorded.runs).toEqual(["Capture QC summary"]);
    expectTheRecordedValues(recorded.report);
    expect(recorded.report?.source).toContain(MZML_ROW.fileName);
    // Details answers for the report: its lineage and its build, not its
    // values.
    expect(recorded.details).toMatchObject({
      describing: "artifact",
      name: "QC summary snapshot",
      digest: DIGEST,
    });
    expect(recorded.details?.producer).toContain("3.0.26204");
    expect(recorded.details?.producer).toContain("a09eea9");
    expect(recorded.details?.producer).toContain("Not reported");
    expect(recorded.details?.links.map((link) => link.id)).toEqual([QC_RUN, LAYER, INPUT]);

    // 4. Report -> run -> layer -> reference. Every edge was already on the
    // page, so not one request.
    const beforeNavigation = await ipcCalls();
    await browser.$(`#workbench-inspector [data-provenance-link="${QC_RUN}"]`).click();
    await browser.$('[data-provenance="run"]').waitForDisplayed();
    const asRun = await capture("m85-04-run");
    expect(asRun.details?.name).toBe("Capture QC summary");
    expect(asRun.details?.links.map((link) => link.id)).toEqual([LAYER, QC_ARTIFACT]);
    await browser.$(`#workbench-inspector [data-provenance-link="${LAYER}"]`).click();
    await browser.$('[data-provenance="layer"]').waitForDisplayed();
    const asLayer = await capture("m85-05-layer");
    expect(asLayer.details?.links.map((link) => link.id)).toEqual([INPUT, QC_RUN]);
    await browser.$(`#workbench-inspector [data-provenance-link="${INPUT}"]`).click();
    await browser.$('[data-provenance="input"]').waitForDisplayed();
    expect(await ipcCalls()).toEqual(beforeNavigation);

    // 5. Save, close, reopen through the real buttons. The report comes back
    // with every value; the Workbench association does not come back with
    // it, and nothing is re-read.
    await setInvokeResult("save_project", project({ handle: MZML_ROW.handle, captured: true }));
    await setInvokeResult("close_project", NO_PROJECT);
    await setInvokeResult(
      "open_project",
      project({ handle: null, captured: true, verification: "notChecked" }),
    );
    const beforeReopen = await ipcCalls();
    await browser.$("button=Save").click();
    await browser.$("[data-project-unsaved]").waitForExist({ reverse: true });
    await browser.$("button=Close").click();
    await browser.$("[data-project-input]").waitForExist({ reverse: true });
    await browser.$("button=Open project…").click();
    await browser.$(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`).waitForDisplayed();
    await browser.$(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`).click();
    await browser.$("[data-qc-report]").waitForDisplayed();

    const reopened = await capture("m85-06-reopened");
    expectTheRecordedValues(reopened.report);
    expect(reopened.details?.digest).toBe(DIGEST);
    // The reopened project remembers no row: the layer is detached, the
    // reference offers to add rather than to show, and capture says why.
    expect(reopened.layerAvailability).toBe("detached");
    expect(reopened.referenceOffers).toBe("add");
    expect(reopened.control).toMatchObject({
      disabled: "true",
      unavailable: "qcNeedsWorkbench",
      reasonVisible: false,
    });
    // Three requests and only those: no preview read, no admission, no check.
    expect((await ipcCalls()).slice(beforeReopen.length).map((call) => call.command)).toEqual([
      "save_project",
      "close_project",
      "open_project",
    ]);

    expect(await unexpectedConsole()).toEqual([]);
  });

  it("captures at 1366x768 with the new report and the keyboard both in view", async () => {
    // The window the design has to work at. The report arrives above the
    // lists and pushes the pressed control down by its whole height, so the
    // question is where the keyboard ends up and whether a reader can see it.
    await metrics(1366, 768);
    const table: Record<string, unknown> = ipcTable();
    table.get_workspace_roster = { datasets: [MZML_ROW], capacity: FAKE_WORKSPACE_CAPACITY };
    table.get_project_state = project({ handle: MZML_ROW.handle, captured: false });
    table.capture_project_qc_summary = {
      project: project({ handle: MZML_ROW.handle, captured: true, dirty: true }),
      artifactId: QC_ARTIFACT,
    };
    await installIpcBoundary(table);
    await browser.url("/");
    await browser.$(".workbench-header").waitForDisplayed();
    const row = `.grouped-roster [data-handle="${MZML_ROW.handle}"]`;
    if (!(await browser.$(row).isDisplayed())) {
      await browser.$('[aria-controls="workbench-roster"]').click();
    }
    await browser.$(row).click();
    await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
    await browser.$("button=Project").click();
    await browser.$(`[data-project-capture-qc="${LAYER}"]:not([aria-disabled])`).waitForExist();

    await browser.execute((layer: string) => {
      document.querySelector<HTMLElement>(`[data-project-capture-qc="${layer}"]`)?.focus();
    }, LAYER);
    const before = await capture("m85-07-capture-offered-1366");
    expect(before.focus?.visible).toBe(true);
    await browser.keys("Enter");
    await browser.$("[data-qc-report]").waitForDisplayed();
    await browser.$("[data-project-busy]").waitForExist({ reverse: true });
    const ring = await focusedTreatment();
    evidence.push({ label: "m85-08-focus-treatment-1366", ...ring });
    expect(ring.visible).toBe(true);

    const after = await capture("m85-08-captured-1366");
    expect(after.focus).toEqual({ id: "qc-report-title", visible: true });
    expect(after.report?.headingVisible).toBe(true);
    expectTheRecordedValues(after.report);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps a long source name inside the report, the surface and Details when constrained", async () => {
    const long = `${"Plasma_QC_batch_08_".repeat(7)}replicate_04.mzML`;
    const table: Record<string, unknown> = ipcTable();
    table.get_workspace_roster = { datasets: [MZML_ROW], capacity: FAKE_WORKSPACE_CAPACITY };
    table.get_project_state = project({ handle: MZML_ROW.handle, captured: true, label: long });
    // The store answers a layout commit with the snapshot it published; without
    // it the Details reveal below would be undone by its own reply.
    table.save_ui_preferences = {
      outcome: "saved",
      revision: 1,
      preferences: {
        schemaVersion: 1,
        appearance: { locale: "en", density: "comfortable" },
        layout: { roster: "automatic", details: "shown" },
      },
    };
    await installIpcBoundary(table);

    for (const [width, height, label] of [
      [1366, 768, "m85-09-long-name-1366"],
      [960, 640, "m85-10-long-name-960"],
    ] as const) {
      await metrics(width, height);
      await browser.url("/");
      await browser.$(".workbench-header").waitForDisplayed();
      await browser.$("button=Project").click();
      await browser.$(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`).waitForDisplayed();
      await browser.$(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`).click();
      await browser.$("[data-qc-report]").waitForDisplayed();

      const shown = await capture(`${label}-report`);
      expect(shown.projectShown).toBe(true);
      expect(shown.report?.headingVisible).toBe(true);
      expect(shown.report?.source).toContain(long);
      expectTheRecordedValues(shown.report);
      // The report sits inside the surface: its own box never reaches past the
      // viewport, and the surface does not scroll sideways (the frame asserts).
      expect(shown.report?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((shown.report?.x ?? 0) + (shown.report?.width ?? Infinity)).toBeLessThanOrEqual(
        width + 1,
      );

      // Below the roomy breakpoint the region waits to be asked for, and the
      // surface says where the answer went.
      await revealInDetails('[data-provenance="artifact"]');
      const inspected = await capture(`${label}-details`);
      expect(inspected.details?.describing).toBe("artifact");
      expect(inspected.details?.digest).toBe(DIGEST);
      const region = inspected.details?.region;
      expect(region?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((region?.x ?? 0) + (region?.width ?? Infinity)).toBeLessThanOrEqual(width + 1);
      evidence.push({ viewport: label, console: await consoleEntries() });
      expect(await unexpectedConsole()).toEqual([]);
    }
  });
});
