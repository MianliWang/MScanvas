/**
 * M8.2 -- provenance in the contextual region, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev server,
 * with only `window.__TAURI_INTERNALS__.invoke` replaced. So this is React,
 * CSS, layout and interaction evidence: what the shell puts where at a given
 * viewport, and what activating a relationship actually does.
 *
 * It is **not** filesystem or provider evidence. The project it inspects is a
 * controlled answer table, so "Changed" is a string this spec chose rather than
 * a digest anything computed, and the relationships are the ones the fixture
 * states. That those relationships are computed correctly from a real document,
 * and that the integrity rules refuse an ambiguous one, is proved against real
 * files in `apps/desktop/src-tauri/src/project/tests.rs`.
 *
 * No provider is involved at any point: `inspect_backend` reports no
 * installation, which is part of the claim -- recorded work over local files
 * has to be inspectable on a machine with no converter.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  consoleEntries,
  installIpcBoundary,
  ipcCalls,
  setInvokeResult,
} from "../support/harness";
import { ipcTable } from "../support/fixtures";

let output = "";
const evidence: unknown[] = [];

const INPUT = "11111111-2222-4111-8111-111111111111";
const CHANGED_INPUT = "11111111-3333-4111-8111-111111111111";
const RUN = "ffffffff-2222-4111-8111-111111111111";
const FAILED_RUN = "ffffffff-3333-4111-8111-111111111111";
const ARTIFACT = "eeeeeeee-2222-4111-8111-111111111111";

/**
 * A saved project with a real closed loop in it.
 *
 * Two references in different current states, a completed run over one of them
 * and the record it produced, plus a failed run that produced nothing -- the
 * shapes a reader actually has to tell apart.
 */
function savedProject() {
  return {
    open: true,
    name: "Plasma batch 7",
    dirty: false,
    published: true,
    inputs: [
      {
        id: INPUT,
        label: "QC_pool_01.mzML",
        locatorKind: "insideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 2048 }],
        verification: "matchingRecordedContent",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [RUN],
      },
      {
        id: CHANGED_INPUT,
        label: "QC_pool_02.mzML",
        locatorKind: "outsideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 4096 }],
        verification: "differentContent",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [RUN, FAILED_RUN],
      },
    ],
    artifacts: [
      {
        id: ARTIFACT,
        label: "File facts: 2 references",
        observedInputCount: 2,
        observedMemberCount: 2,
        kind: "fileFactsV1",
        qcSnapshot: null,
        producedByRunId: RUN,
        sourceInputIds: [INPUT, CHANGED_INPUT],
      },
    ],
    runs: [
      {
        id: RUN,
        operation: "captureFileFactsV1",
        outcome: "completed",
        inputIds: [INPUT, CHANGED_INPUT],
        layerIds: [],
        outputArtifactIds: [ARTIFACT],
        applicationVersion: "0.1.0",
        startedAt: "2026-09-22T10:00:00Z",
        finishedAt: "2026-09-22T10:00:02Z",
      },
      {
        id: FAILED_RUN,
        operation: "captureFileFactsV1",
        outcome: "failed",
        inputIds: [CHANGED_INPUT],
        layerIds: [],
        outputArtifactIds: [],
        applicationVersion: "0.1.0",
        startedAt: "2026-09-22T10:05:00Z",
        finishedAt: "2026-09-22T10:05:01Z",
      },
    ],
    layers: [],
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
 * One frame, with the geometry that frame is evidence for.
 *
 * The assertions are the ones a screenshot cannot make on its own: that the
 * evidence area stays dominant where all three regions fit, that no control
 * leaves the viewport or falls under the compact target minimum, that nothing
 * overflows sideways, that the page reached for nothing off-origin, and that no
 * absolute path is on screen.
 */
async function capture(label: string) {
  const measured = await browser.execute(() => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const root = document.querySelector(".workbench-shell");
    if (root === null) throw Error("The shell is not mounted");
    const visible = (element: Element | null) =>
      element !== null && !(element as HTMLElement).hidden;
    const inspector = document.querySelector("#workbench-inspector");
    const project = document.querySelector("#workbench-project");
    const roster = document.querySelector("#workbench-roster");
    return {
      css: { width: innerWidth, height: innerHeight },
      locale: document.documentElement.lang,
      surface: root.getAttribute("data-surface"),
      regions: {
        roster: visible(roster) ? rect(roster!) : null,
        project: visible(project) ? rect(project!) : null,
        inspector: visible(inspector) ? rect(inspector!) : null,
      },
      describing: document.querySelector("[data-provenance]")?.getAttribute("data-provenance") ?? null,
      provenanceHeading:
        document.querySelector("#workbench-inspector .provenance-name")?.textContent ?? null,
      // Measured only where the region is on screen. A folded region still
      // holds its markup, and a hidden element's box is zero -- which is not
      // evidence about a control's target size, it is evidence that nothing is
      // being shown.
      links: visible(inspector)
        ? [...inspector!.querySelectorAll("[data-provenance-link]")].map((node) => ({
            id: node.getAttribute("data-provenance-link"),
            text: node.textContent,
            name: node.getAttribute("aria-label"),
            ...rect(node),
          }))
        : [],
      currentStates: visible(inspector)
        ? [...inspector!.querySelectorAll("[data-provenance-current]")].map((node) => ({
            state: node.getAttribute("data-provenance-current"),
            text: node.textContent,
          }))
        : [],
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      // Nothing that looks like a Windows path may be on screen, in any state.
      pathsOnScreen: (document.body.innerText.match(/[A-Za-z]:\\[^\s]+/gu) ?? []).length,
      external: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({
    label,
    kind: "React/mock-IPC layout and interaction evidence. The project is a controlled answer table: no filesystem was read and no provider was involved.",
    ...measured,
  });

  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  for (const link of measured.links) {
    expect(link.x).toBeGreaterThanOrEqual(0);
    expect(link.x + link.width).toBeLessThanOrEqual(measured.css.width + 1);
    // The design system's compact control minimum.
    expect(link.height).toBeGreaterThanOrEqual(31.5);
    // No relationship exists only as colour: each control carries its own name.
    expect(link.name ?? "").not.toEqual("");
  }
  return measured;
}

/** The Project surface, from a cold document, with a saved project in it. */
async function openProjectSurface() {
  const table: Record<string, unknown> = ipcTable();
  table.get_project_state = savedProject();
  table.begin_project_job = { operationId: "project-job-1" };
  table.cancel_project_job = { outcome: "cancelled" };
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
  await browser.$("button=Project").click();
  await browser.$("[data-project-surface]").waitForDisplayed();
}

/** The one control that inspects a named reference. */
function inspectInput(label: string) {
  return browser.$(`button[aria-label="Show what ${label} is related to"]`);
}

describe("M8.2 provenance, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_M82_OUTPUT_ROOT"] ?? resolve("test-results/m8.2");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M8.2 browser evidence: ${output}`);
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

  it("puts provenance in the contextual region beside a dominant evidence area", async () => {
    await metrics(1920, 1080);
    await openProjectSurface();
    const empty = await capture("m82-01-nothing-selected");
    // Nothing selected yet, so the region says so rather than guessing.
    expect(empty.describing).toBe(null);

    await inspectInput("QC_pool_01.mzML").click();
    await browser.$('[data-provenance="input"]').waitForDisplayed();

    const measured = await capture("m82-02-input-selected");
    expect(measured.describing).toBe("input");
    expect(measured.provenanceHeading).toBe("QC_pool_01.mzML");
    // Three regions, with the evidence area dominant between them.
    const { roster, project, inspector } = measured.regions;
    expect(roster).not.toBe(null);
    expect(project).not.toBe(null);
    expect(inspector).not.toBe(null);
    expect(project!.width).toBeGreaterThan(roster!.width);
    expect(project!.width).toBeGreaterThan(inspector!.width);
    // And the contextual region is beside it, not over it.
    expect(inspector!.x).toBeGreaterThanOrEqual(project!.x + project!.width - 1);
  });

  it("reaches every recorded relationship from both ends", async () => {
    await metrics(1920, 1080);
    await openProjectSurface();
    await inspectInput("QC_pool_02.mzML").click();
    await browser.$('[data-provenance="input"]').waitForDisplayed();

    // A reference whose bytes changed still names both runs that used it, and
    // the current state is shown apart from that history.
    const asInput = await capture("m82-03-changed-input");
    expect(asInput.currentStates.map((entry) => entry.state)).toEqual(["differentContent"]);
    expect(asInput.links.map((link) => link.id)).toEqual([RUN, FAILED_RUN]);

    const before = await ipcCalls();

    // Reference -> the run that used it.
    await browser.$(`[data-provenance-link="${RUN}"]`).click();
    await browser.$('[data-provenance="run"]').waitForDisplayed();
    const asRun = await capture("m82-04-run");
    // The run names what it used and what it produced, and the current state
    // of each reference travels with it.
    expect(asRun.links.map((link) => link.id)).toEqual([INPUT, CHANGED_INPUT, ARTIFACT]);
    expect(asRun.currentStates.map((entry) => entry.state)).toEqual([
      "matchingRecordedContent",
      "differentContent",
    ]);

    // Run -> the record it produced.
    await browser.$(`[data-provenance-link="${ARTIFACT}"]`).click();
    await browser.$('[data-provenance="artifact"]').waitForDisplayed();
    const asArtifact = await capture("m82-05-artifact");
    expect(asArtifact.links.map((link) => link.id)).toEqual([RUN, INPUT, CHANGED_INPUT]);
    // A record has no file of its own, and says where it lives instead.
    expect(await browser.$("[data-provenance-stored]").isDisplayed()).toBe(true);

    // Record -> back to its producing run, closing the loop -- and this one by
    // keyboard, which is the activation jsdom cannot synthesize. Real focus,
    // real Enter, same outcome as a press.
    await browser.$(`[data-provenance-link="${RUN}"]`).click();
    await browser.$('[data-provenance="run"]').waitForDisplayed();
    await browser.$(`[data-provenance-link="${INPUT}"]`).click();
    await browser.$('[data-provenance="input"]').waitForDisplayed();
    const focused = await browser.$(`[data-provenance-link="${RUN}"]`);
    await focused.click();
    await browser.$('[data-provenance="run"]').waitForDisplayed();
    await browser.$(`[data-provenance-link="${INPUT}"]`).click();
    await browser.$('[data-provenance="input"]').waitForDisplayed();
    await browser.execute(() => {
      document.querySelector<HTMLElement>("#workbench-inspector [data-provenance-link]")?.focus();
    });
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute("data-provenance-link") ?? null,
      ),
    ).toBe(RUN);
    await browser.keys("Enter");
    await browser.$('[data-provenance="run"]').waitForDisplayed();

    // Not one request in the whole traversal: every edge was already on the
    // page, so navigating cannot read a backend, check a file or dispatch a
    // run.
    expect(await ipcCalls()).toEqual(before);
  });

  it("shows a failed run as producing nothing without disturbing what it used", async () => {
    await metrics(1920, 1080);
    await openProjectSurface();
    await inspectInput("QC_pool_02.mzML").click();
    await browser.$(`[data-provenance-link="${FAILED_RUN}"]`).click();
    await browser.$('[data-provenance="run"]').waitForDisplayed();

    const measured = await capture("m82-06-failed-run");
    expect(await browser.$("[data-provenance-no-artifact]").isDisplayed()).toBe(true);
    // It still names the reference it consumed, with that reference's own
    // current state.
    expect(measured.links.map((link) => link.id)).toEqual([CHANGED_INPUT]);
    expect(measured.currentStates.map((entry) => entry.state)).toEqual(["differentContent"]);
  });

  it("keeps provenance reachable through the existing Details control when narrow", async () => {
    // One column. The contextual region folds rather than shrinking, and the
    // way back to it is the control the header already owns.
    await metrics(960, 640);
    await openProjectSurface();
    await inspectInput("QC_pool_01.mzML").click();
    await browser.$("[data-project-inspect-hint]").waitForDisplayed();

    const folded = await capture("m82-07-constrained-folded");
    expect(folded.regions.inspector).toBe(null);
    expect(folded.regions.project).not.toBe(null);

    // The preference store answers a commit with the snapshot it published,
    // and the interface applies *that* rather than what it asked for. The
    // shared table answers every save with the untouched defaults, so without
    // this the toggle would be undone by its own reply.
    await setInvokeResult("save_ui_preferences", {
      outcome: "saved",
      revision: 1,
      preferences: {
        schemaVersion: 1,
        appearance: { locale: "en", density: "comfortable" },
        layout: { roster: "automatic", details: "shown" },
      },
    });
    await browser.$("[data-project-inspect-hint] button").click();
    await browser.$('[data-provenance="input"]').waitForDisplayed();

    const opened = await capture("m82-08-constrained-open");
    // Opened, it takes the one column and the list yields it -- the existing
    // folding, not a new layout and not a modal.
    expect(opened.regions.inspector).not.toBe(null);
    expect(opened.regions.project).toBe(null);
    expect(opened.provenanceHeading).toBe("QC_pool_01.mzML");
  });
});
