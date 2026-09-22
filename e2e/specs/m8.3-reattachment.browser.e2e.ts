/**
 * M8.3 -- a recorded project reference reaching the Workbench, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev server,
 * with only `window.__TAURI_INTERNALS__.invoke` replaced. So this is React,
 * CSS, layout and interaction evidence: which control a reference is offered,
 * where the shell takes the reader, which roster row ends up carrying the
 * keyboard, and what going back to the project surface still says.
 *
 * It is **not** filesystem, content or provider evidence. The project and the
 * add result are a controlled answer table, so "matches the recorded content"
 * is a string this spec chose rather than a digest anything computed, and the
 * admitted row is one the table names. That the real boundary re-establishes
 * content before admitting anything, refuses an in-place edit at the same name
 * and length, keeps a project and a workspace row independent, and converges a
 * duplicate onto one row is proved against real files in
 * `apps/desktop/src-tauri/src/reattachment/tests.rs`.
 *
 * No provider is involved at any point: `inspect_backend` reports no
 * installation, which is part of the claim -- reattaching recorded work has to
 * work on a machine with no converter.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { consoleEntries, installIpcBoundary, ipcCalls, setInvokeResult } from "../support/harness";
import { MZML_ROW, ipcTable } from "../support/fixtures";
import { FAKE_WORKSPACE_CAPACITY } from "../../apps/desktop/src/test/previewFixtures";

let output = "";
const evidence: unknown[] = [];

const INPUT = "11111111-2222-4111-8111-111111111111";
const RUN = "ffffffff-2222-4111-8111-111111111111";
const ARTIFACT = "eeeeeeee-2222-4111-8111-111111111111";

/**
 * A saved project whose one reference has been checked and still matches.
 *
 * It carries a recorded run and the record that run produced, because the
 * other half of this scenario is that reattaching changes none of that.
 */
function checkedProject(workbenchDatasetHandle: string | null) {
  return {
    open: true,
    projectId: "aaaaaaaa-0000-4111-8111-000000000001",
    name: "Plasma batch 7",
    dirty: false,
    published: true,
    inputs: [
      {
        id: INPUT,
        label: MZML_ROW.fileName,
        locatorKind: "insideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 2048 }],
        verification: "matchingRecordedContent",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [RUN],
        workbenchDatasetHandle,
      },
    ],
    artifacts: [
      {
        id: ARTIFACT,
        label: "File facts: 1 reference",
        observedInputCount: 1,
        observedMemberCount: 1,
        producedByRunId: RUN,
        sourceInputIds: [INPUT],
      },
    ],
    runs: [
      {
        id: RUN,
        operation: "captureFileFactsV1",
        outcome: "completed",
        inputIds: [INPUT],
        outputArtifactIds: [ARTIFACT],
        applicationVersion: "0.1.0",
        startedAt: "2026-09-22T10:00:00Z",
        finishedAt: "2026-09-22T10:00:02Z",
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
 * One frame, with the geometry and state that frame is evidence for.
 *
 * The assertions are the ones a screenshot cannot make: that nothing overflows
 * sideways, that no absolute path is on screen, that the page reached for
 * nothing off-origin, and that whatever roster rows exist are within the
 * viewport and meet the compact target minimum.
 */
async function capture(label: string) {
  const measured = await browser.execute(() => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const root = document.querySelector(".workbench-shell");
    if (root === null) throw Error("The shell is not mounted");
    const active = document.activeElement;
    return {
      css: { width: innerWidth, height: innerHeight },
      locale: document.documentElement.lang,
      surface: root.getAttribute("data-surface"),
      // Which reattachment control each reference is offered, by reference.
      addControls: [...document.querySelectorAll("[data-project-add-to-workbench]")].map(
        (node) => ({
          input: node.getAttribute("data-project-add-to-workbench"),
          text: node.textContent,
          name: node.getAttribute("aria-label"),
          unavailable: node.getAttribute("data-project-add-unavailable"),
        }),
      ),
      showControls: [...document.querySelectorAll("[data-project-show-in-workbench]")].map(
        (node) => ({
          input: node.getAttribute("data-project-show-in-workbench"),
          text: node.textContent,
          name: node.getAttribute("aria-label"),
        }),
      ),
      rows: [...document.querySelectorAll("#workbench-roster [data-handle]")].map((node) => ({
        handle: node.getAttribute("data-handle"),
        selected: node.getAttribute("aria-selected"),
        focused: node === active,
        ...rect(node),
      })),
      // What the project surface still says about recorded work.
      runs: [...document.querySelectorAll("[data-project-run]")].map((node) =>
        node.getAttribute("data-outcome"),
      ),
      artifacts: [...document.querySelectorAll("[data-project-artifact]")].map((node) =>
        node.getAttribute("data-project-artifact"),
      ),
      activeElement: active === null ? null : active.getAttribute("data-handle"),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
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
    kind:
      "React/mock-IPC layout and interaction evidence. The project, the add result and the " +
      "roster are a controlled answer table: no filesystem was read, no content was hashed " +
      "and no provider was involved.",
    ...measured,
  });

  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  for (const row of measured.rows) {
    expect(row.x).toBeGreaterThanOrEqual(0);
    expect(row.x + row.width).toBeLessThanOrEqual(measured.css.width + 1);
    expect(row.height).toBeGreaterThanOrEqual(31.5);
  }
  return measured;
}

/** An empty workspace, one checked reference, and the add that would follow. */
async function openProjectSurface() {
  const table: Record<string, unknown> = ipcTable();
  // Empty, so the row that arrives is visibly this operation's.
  table.get_workspace_roster = { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY };
  table.get_project_state = checkedProject(null);
  table.begin_project_job = { operationId: "project-job-1" };
  table.cancel_project_job = { outcome: "cancelled" };
  table.add_project_input_to_workspace = {
    // The project as Rust describes it *after* the admission: it now knows
    // which row this reference is.
    project: checkedProject(MZML_ROW.handle),
    workspace: {
      roster: { datasets: [MZML_ROW], capacity: FAKE_WORKSPACE_CAPACITY },
      outcomes: [{ outcome: "added", dataset: MZML_ROW }],
    },
  };
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
  await browser.$("button=Project").click();
  await browser.$("[data-project-surface]").waitForDisplayed();
}

describe("M8.3 project-to-Workbench reattachment, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_M83_OUTPUT_ROOT"] ?? resolve("test-results/m8.3");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M8.3 browser evidence: ${output}`);
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

  it("takes a checked reference to the Workbench and reveals the row it became", async () => {
    await metrics(1920, 1080);
    await openProjectSurface();

    const before = await capture("m83-01-checked-reference");
    // One reference, offered the action, with nothing to explain away.
    expect(before.surface).toBe("project");
    expect(before.addControls).toHaveLength(1);
    expect(before.addControls[0]?.text).toBe("Add to Workbench");
    expect(before.addControls[0]?.unavailable).toBe(null);
    expect(before.showControls).toEqual([]);
    expect(before.rows).toEqual([]);

    await browser.$(`[data-project-add-to-workbench="${INPUT}"]`).click();
    await browser.$(`#workbench-roster [data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();

    const after = await capture("m83-02-revealed-in-workbench");
    // The shell moved, and the row it moved to is the row that arrived: it is
    // the highlighted one and it carries the keyboard.
    expect(after.surface).toBe("workbench");
    expect(after.rows.map((row) => row.handle)).toEqual([MZML_ROW.handle]);
    expect(after.rows[0]?.selected).toBe("true");
    expect(after.rows[0]?.focused).toBe(true);
    expect(after.activeElement).toBe(MZML_ROW.handle);

    // Nothing was read. Adding a reference makes it something the reader can
    // open; opening it is still a thing they ask for.
    const calls = await ipcCalls();
    expect(calls.some((call) => call.command === "open_mzml_preview")).toBe(false);
    expect(calls.some((call) => call.command === "load_selected_spectrum")).toBe(false);
    // And the request named the reference and the accepted operation, never a
    // path.
    const admission = calls.find((call) => call.command === "add_project_input_to_workspace");
    expect(admission?.args).toEqual({ operationId: "project-job-1", inputId: INPUT });
  });

  it("keeps the project's own record intact, and reuses the row on a second activation", async () => {
    await metrics(1920, 1080);
    await openProjectSurface();
    await browser.$(`[data-project-add-to-workbench="${INPUT}"]`).click();
    await browser.$(`#workbench-roster [data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();

    // Back to the project. The reference is still a reference, the run it was
    // used by is still recorded, and the record that run produced is still
    // there -- a session row is not a provenance edge.
    await browser.$("button=Project").click();
    await browser.$("[data-project-surface]").waitForDisplayed();
    await browser.$(`[data-project-show-in-workbench="${INPUT}"]`).waitForDisplayed();

    const back = await capture("m83-03-back-on-project");
    expect(back.runs).toEqual(["completed"]);
    expect(back.artifacts).toEqual([ARTIFACT]);
    // The reference is now offered the other half of the pair.
    expect(back.addControls).toEqual([]);
    expect(back.showControls[0]?.text).toBe("Show in Workbench");
    expect(back.showControls[0]?.name).toBe(`Show in Workbench: ${MZML_ROW.fileName}`);
    // The visible label is contained in the accessible name, so speaking the
    // control and reading it name the same thing.
    expect(back.showControls[0]?.name).toContain(back.showControls[0]?.text ?? "");

    // The second activation, by keyboard: real focus, a real Enter, which is
    // the activation jsdom cannot synthesize.
    const spent = await ipcCalls();
    await browser.execute((input: string) => {
      document
        .querySelector<HTMLElement>(`[data-project-show-in-workbench="${input}"]`)
        ?.focus();
    }, INPUT);
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute("data-project-show-in-workbench") ?? null,
      ),
    ).toBe(INPUT);
    await browser.keys("Enter");
    await browser.waitUntil(async () =>
      (await browser.$(".workbench-shell").getAttribute("data-surface")) === "workbench",
    );

    const again = await capture("m83-04-shown-again");
    // One row, still one row: the second activation showed what was there
    // rather than adding it again.
    expect(again.rows.map((row) => row.handle)).toEqual([MZML_ROW.handle]);
    expect(again.rows[0]?.focused).toBe(true);
    // And showing a row asked the backend for nothing at all.
    expect(await ipcCalls()).toEqual(spent);
  });
});
