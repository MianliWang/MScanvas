/**
 * M8.1 — the project roundtrip, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced. So what this
 * drives is the shipped frontend, and what it can say is what that frontend
 * looks like and does at a given viewport.
 *
 * What it deliberately cannot say: whether any of it is true of a filesystem.
 * The answers here are a controlled table, so "the content changed" is a string
 * this spec chose, not a digest anything computed. That claim is proved against
 * real files in `apps/desktop/src-tauri/src/project/tests.rs`. Labelled here so
 * a reader of the evidence never mistakes one for the other.
 *
 * No provider is involved at any point, which is itself part of the claim: the
 * project surface is reachable and complete with `inspect_backend` reporting no
 * installation at all.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  consoleEntries,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeRejection,
  setInvokeResult,
} from "../support/harness";
import { ipcTable } from "../support/fixtures";

let output = "";
const evidence: unknown[] = [];

/** One reference, as the project store describes one. */
function reference(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    label: "QC_pool_01.mzML",
    locatorKind: "outsideProject",
    members: [{ role: "primary", name: "", recordedByteLength: 2048 }],
    verification: "notChecked",
    unavailableReason: null,
    relinkProposed: false,
    relinkCandidateMatches: false,
    ...overrides,
  };
}

/** One whole project, as the store describes one. */
function project(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    name: "Plasma batch 7",
    dirty: false,
    published: false,
    inputs: [reference()],
    artifacts: [],
    runs: [],
    ...overrides,
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

async function metrics(width: number, height: number, dpr: number) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile: false,
  });
  await browser.waitUntil(() =>
    browser.execute(
      (w, h, s) => innerWidth === w && innerHeight === h && devicePixelRatio === s,
      width,
      height,
      dpr,
    ),
  );
}

/**
 * One frame, with the geometry that frame is evidence for.
 *
 * The assertions here are the ones a screenshot alone cannot make: that nothing
 * overflows horizontally, that no control leaves the viewport, that every
 * interactive target meets the compact 32px minimum the design system sets, and
 * that the page reached for nothing off-origin.
 */
async function capture(label: string) {
  const measured = await browser.execute(() => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const root = document.querySelector(".workbench-shell");
    if (root === null) throw Error("The shell is not mounted");
    return {
      css: { width: innerWidth, height: innerHeight },
      dpr: devicePixelRatio,
      locale: document.documentElement.lang,
      surface: root.getAttribute("data-surface"),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      controls: [...document.querySelectorAll(".project-surface button")].map((node) => ({
        text: node.textContent,
        disabled: node.hasAttribute("disabled"),
        ...rect(node),
      })),
      references: [...document.querySelectorAll("[data-project-input]")].map((node) => ({
        id: node.getAttribute("data-project-input"),
        verification: node.getAttribute("data-verification"),
        reason: node.getAttribute("data-unavailable-reason"),
        outcomeText: node.querySelector(".project-verification")?.textContent,
        accent: getComputedStyle(node).borderLeftColor,
        ...rect(node),
      })),
      runs: [...document.querySelectorAll("[data-project-run]")].map((node) => ({
        id: node.getAttribute("data-project-run"),
        outcome: node.getAttribute("data-outcome"),
        artifacts: [...node.querySelectorAll("[data-project-artifact]")].map((artifact) =>
          artifact.getAttribute("data-project-artifact"),
        ),
        noArtifact: node.querySelector("[data-project-no-artifact]") !== null,
      })),
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
  const png = Buffer.from(screenshot.data, "base64");
  const raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  writeFileSync(join(output, `${label}.png`), png);
  evidence.push({
    label,
    kind: "browser mock IPC; DPR emulation, not native Windows scale. Verification outcomes are a controlled table, never a computed digest.",
    ...measured,
    raster,
  });

  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  for (const control of measured.controls) {
    expect(control.x).toBeGreaterThanOrEqual(0);
    expect(control.x + control.width).toBeLessThanOrEqual(measured.css.width + 1);
    // The design system's compact control minimum. A project action that
    // reflowed itself below this would be a target a pointer user cannot hit.
    expect(control.height).toBeGreaterThanOrEqual(31.5);
  }
  return measured;
}

/** The project surface, from a cold document. */
async function openSurface(state: Record<string, unknown>) {
  const table: Record<string, unknown> = ipcTable();
  table.get_project_state = state;
  // Every check or capture is accepted first and runs under the identifier
  // the acceptance answered. The store mints them in order; this table mints
  // one.
  table.begin_project_job = { operationId: "project-job-1" };
  table.cancel_project_job = { outcome: "cancelled" };
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
  await browser.$("button=Project").click();
  await browser.$("[data-project-surface]").waitForDisplayed();
}

describe("M8.1 project records, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_M81_OUTPUT_ROOT"] ?? resolve("test-results/m8.1");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M8.1 browser evidence: ${output}`);
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
      calls: await ipcCalls(),
    });
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(join(output, `failure-${evidence.length}.png`));
      evidence.push({
        failedDocument: await browser.execute(() => document.body.innerText.slice(0, 8000)),
      });
    }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  it("reaches the project surface with no provider installed at all", async () => {
    await openSurface({
      open: false,
      name: "",
      dirty: false,
      published: false,
      inputs: [],
      artifacts: [],
      runs: [],
    });
    await metrics(1366, 768, 1);

    // The provider is unavailable for this whole spec. The surface is reachable
    // and complete regardless, which is the claim it has to support.
    const measured = await capture("m81-01-no-project");
    expect(measured.surface).toBe("project");
    expect(await browser.$("button=New project").isDisplayed()).toBe(true);
    expect(await browser.$("button=Open project…").isDisplayed()).toBe(true);
    // Nothing claims a project that is not open.
    expect(await browser.$("[data-project-input]").isExisting()).toBe(false);
  });

  it("shows four check outcomes as four sentences over three category accents", async () => {
    await openSurface(
      project({
        inputs: [
          reference({
            id: "aaaaaaaa-1111-4111-8111-111111111111",
            label: "QC_pool_01.mzML",
            verification: "matchingRecordedContent",
            locatorKind: "insideProject",
          }),
          reference({
            id: "bbbbbbbb-1111-4111-8111-111111111111",
            label: "QC_pool_02.mzML",
            verification: "differentContent",
          }),
          reference({
            id: "cccccccc-1111-4111-8111-111111111111",
            label: "QC_pool_03.mzML",
            verification: "unavailable",
            unavailableReason: "missingAtCheckedLocation",
          }),
          reference({
            id: "dddddddd-1111-4111-8111-111111111111",
            label: "batch_07.wiff",
            verification: "unavailable",
            unavailableReason: "incompleteRequiredMembers",
            members: [
              { role: "primary", name: "", recordedByteLength: 8192 },
              { role: "requiredCompanion", name: "batch_07.wiff.scan", recordedByteLength: 512 },
            ],
          }),
        ],
      }),
    );
    await metrics(1366, 768, 1);

    const measured = await capture("m81-02-outcomes");
    const outcomes = measured.references.map((row) => row.outcomeText);
    // Four rows, four different sentences. A reader who cannot see colour reads
    // exactly what a reader who can does.
    expect(new Set(outcomes).size).toBe(4);
    // Three accents, not four, and deliberately: the accent carries the
    // category, and both unavailable rows are the same category. What separates
    // "not found" from "a companion is missing" is the sentence, which is why
    // the sentence is what must be distinct.
    expect(new Set(measured.references.map((row) => row.accent)).size).toBe(3);
    // Missing and incomplete are not the same thing and do not read alike.
    expect(measured.references[2].reason).toBe("missingAtCheckedLocation");
    expect(measured.references[3].reason).toBe("incompleteRequiredMembers");
  });

  it("captures file facts and shows the run linked to the artifact it produced", async () => {
    const input = reference({ verification: "matchingRecordedContent" });
    await openSurface(project({ inputs: [input] }));
    await metrics(1366, 768, 1);
    await capture("m81-03-before-capture");

    // The answer the capture will return: one artifact, one completed run that
    // names it.
    await setInvokeResult(
      "capture_project_file_facts",
      project({
        dirty: true,
        inputs: [input],
        artifacts: [
          {
            id: "eeeeeeee-1111-4111-8111-111111111111",
            label: "File facts: QC_pool_01.mzML",
            observedInputCount: 1,
            observedMemberCount: 1,
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

    await browser.$(`[data-project-input="${input.id}"] input[type="checkbox"]`).click();
    await browser.$("[data-project-capture]").click();
    await browser.$("[data-project-run]").waitForDisplayed();

    const measured = await capture("m81-04-after-capture");
    expect(measured.runs).toHaveLength(1);
    expect(measured.runs[0].outcome).toBe("completed");
    // The relationship is on screen: this run produced that artifact.
    expect(measured.runs[0].artifacts).toEqual(["eeeeeeee-1111-4111-8111-111111111111"]);
    // And what a capture is is stated where it is displayed, so nobody reads
    // it as analysis.
    expect(
      await browser
        .$(".project-note")
        .getText()
        .then((text) => text.includes("not conversion, analysis or quality control")),
    ).toBe(true);
    // Unsaved, because a capture changed the project and nothing saved it.
    expect(await browser.$("[data-project-unsaved]").isDisplayed()).toBe(true);
  });

  it("records a failed capture with no artifact at all", async () => {
    const input = reference();
    await openSurface(project({ inputs: [input] }));
    await metrics(1366, 768, 1);

    // A refusal, and the project as it stands after it: the run is recorded and
    // the artifact is not.
    await setInvokeRejection("capture_project_file_facts", {
      code: "missingAtCheckedLocation",
      message: "That file could not be read.",
      retryable: true,
    });
    await setInvokeResult(
      "get_project_state",
      project({
        dirty: true,
        inputs: [
          reference({
            verification: "unavailable",
            unavailableReason: "missingAtCheckedLocation",
          }),
        ],
        runs: [
          {
            id: "ffffffff-2222-4111-8111-111111111111",
            operation: "captureFileFactsV1",
            outcome: "failed",
            inputIds: [input.id],
            outputArtifactIds: [],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-19T10:05:00Z",
            finishedAt: "2026-09-19T10:05:01Z",
          },
        ],
      }),
    );

    await browser.$(`[data-project-input="${input.id}"] input[type="checkbox"]`).click();
    await browser.$("[data-project-capture]").click();
    await browser.$("[data-project-run]").waitForDisplayed();

    const measured = await capture("m81-05-failed-capture");
    expect(measured.runs[0].outcome).toBe("failed");
    expect(measured.runs[0].artifacts).toEqual([]);
    expect(measured.runs[0].noArtifact).toBe(true);
    // And the project is still on screen. A refusal changed nothing about what
    // the reader is looking at.
    expect(measured.references).toHaveLength(1);
  });

  it("relinks only on an explicit confirmation", async () => {
    const missing = reference({
      verification: "unavailable",
      unavailableReason: "missingAtCheckedLocation",
    });
    await openSurface(project({ inputs: [missing] }));
    await metrics(1366, 768, 1);
    await capture("m81-06-missing");

    await setInvokeResult(
      "propose_project_relink",
      project({
        inputs: [{ ...missing, relinkProposed: true, relinkCandidateMatches: true }],
      }),
    );
    await browser.$(`[data-project-relink="${missing.id}"]`).click();
    await browser.$(`[data-project-proposal="${missing.id}"]`).waitForDisplayed();

    const proposed = await capture("m81-07-proposal");
    // The keyboard follows to the control the proposal just created, rather
    // than being dropped on `<body>` when the Locate button unmounted.
    expect(
      await browser.execute(
        (id: string) =>
          document.activeElement?.getAttribute("data-project-relink-commit") === id,
        missing.id,
      ),
    ).toBe(true);
    // Proposing commits nothing: the record is still unavailable, and the
    // commit command has not been called.
    expect(proposed.references[0].verification).toBe("unavailable");
    expect((await ipcCalls()).some((call) => call.command === "commit_project_relink")).toBe(false);

    await setInvokeResult(
      "commit_project_relink",
      project({
        dirty: true,
        inputs: [
          reference({ verification: "matchingRecordedContent", locatorKind: "insideProject" }),
        ],
      }),
    );
    await browser.$(`[data-project-relink-commit="${missing.id}"]`).click();
    await browser.$('[data-verification="matchingRecordedContent"]').waitForDisplayed();

    const committed = await capture("m81-08-relinked");
    expect(committed.references[0].verification).toBe("matchingRecordedContent");
    expect((await ipcCalls()).some((call) => call.command === "commit_project_relink")).toBe(true);
  });

  it("offers Cancel only for an operation it accepted, and names it", async () => {
    await openSurface(project({ inputs: [reference()] }));
    await metrics(1366, 768, 1);

    // Idle: a cancel would name nothing, so there is no control to send one.
    expect(await browser.$("[data-project-cancel]").isExisting()).toBe(false);

    await holdInvoke("check_project_links");
    await browser.$("[data-project-check]").click();
    await browser.$("[data-project-cancel]").waitForDisplayed();
    await capture("m81-12-busy-check");
    // The control names the accepted operation, not "whatever is running".
    expect(await browser.$("[data-project-cancel]").getAttribute("data-project-cancel")).toBe(
      "project-job-1",
    );

    await browser.$("[data-project-cancel]").click();
    await browser.waitUntil(async () =>
      (await ipcCalls()).some((call) => call.command === "cancel_project_job"),
    );
    const relevant = (await ipcCalls()).filter((call) =>
      ["begin_project_job", "check_project_links", "cancel_project_job"].includes(call.command),
    );
    // Accepted before run, run under the same identifier, cancel naming it.
    expect(relevant.map((call) => call.command)).toEqual([
      "begin_project_job",
      "check_project_links",
      "cancel_project_job",
    ]);
    expect(relevant[1]?.args).toEqual({ operationId: "project-job-1" });
    expect(relevant[2]?.args).toEqual({ operationId: "project-job-1" });

    await releaseInvokeHold("check_project_links");
    await browser.$("[data-project-cancel]").waitForExist({ reverse: true });
    // A cancel is a decision, not a refusal, and once the answer is in there
    // is no control left to send a late one.
    expect(await browser.$("[data-project-problem]").isExisting()).toBe(false);
  });

  it("keeps the project on screen when a save is refused", async () => {
    await openSurface(project({ published: true, dirty: true }));
    await metrics(1366, 768, 1);

    await setInvokeRejection("save_project", {
      code: "staleDocument",
      message: "That project file has changed since it was opened.",
      retryable: true,
    });
    await browser.$("button=Save").click();
    await browser.$("[data-project-problem]").waitForDisplayed();

    const measured = await capture("m81-09-refused-save");
    const banner = browser.$("[data-project-problem]");
    expect(await banner.getAttribute("data-project-problem")).toBe("staleDocument");
    // The sentence names *this* refusal. "That was refused" would read the same
    // for a stale document, a file this project references and a failed write,
    // and only one of those has an action the reader can take.
    expect(await banner.getText()).toContain("changed since it was opened");
    // Announced, not only drawn -- and announced once, because the visible
    // notice carries no role of its own.
    expect(await browser.$('[data-live-region="project"]').getText()).toContain(
      "changed since it was opened",
    );
    expect(await banner.getAttribute("role")).toBe(null);
    // The project is exactly where it was.
    expect(measured.references).toHaveLength(1);
  });

  it("holds up at the constrained and roomy viewports, and in Simplified Chinese", async () => {
    await openSurface(
      project({
        inputs: [
          reference({ verification: "matchingRecordedContent" }),
          reference({
            id: "bbbbbbbb-9999-4111-8111-111111111111",
            label: "一个名字很长的中文采集文件_批次07.wiff",
            verification: "unavailable",
            unavailableReason: "unstableRead",
          }),
        ],
      }),
    );

    for (const [width, height] of [
      [960, 640],
      [1366, 768],
      [1920, 1080],
    ] as const) {
      await metrics(width, height, 1);
      await capture(`m81-10-viewport-${width}x${height}`);
    }

    // The same surface with a Chinese session, through the real Settings route.
    // The store answers with the snapshot that was published and read back, and
    // the interface applies *that* rather than what it asked for -- so a table
    // that answered with the old locale would correctly revert the switch.
    await metrics(1366, 768, 1);
    await setInvokeResult("save_ui_preferences", {
      outcome: "saved",
      revision: 1,
      preferences: {
        schemaVersion: 1,
        appearance: { locale: "zh-CN", density: "comfortable" },
        layout: { roster: "automatic", details: "automatic" },
      },
    });
    await browser.$("[data-settings-entry]").click();
    await browser.$('[data-settings-dialog] input[value="zh-CN"]').click();
    // The dialog relabels itself as soon as the language is selected, so the
    // control that applies a switch to Chinese is already the Chinese one.
    await browser.$("[data-settings-dialog]").$("button=应用").click();
    await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
    await browser.$("button=项目").click();
    await browser.$("[data-project-surface]").waitForDisplayed();

    const measured = await capture("m81-11-zh-CN");
    expect(measured.locale).toBe("zh-CN");
    // Translated, not copied: the outcome vocabulary is Chinese.
    expect(measured.references.map((row) => row.outcomeText)).toEqual([
      "与记录的内容一致",
      "正被其他程序占用，无法可靠读取",
    ]);
  });
});
