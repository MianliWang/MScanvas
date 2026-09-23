/**
 * M8.4 -- a layer's identity and provenance on the project surface, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev server,
 * with only `window.__TAURI_INTERNALS__.invoke` replaced. So this is React,
 * CSS, layout and interaction evidence: which control a reference is offered
 * and when, where the keyboard is after a press turns "create" into "show",
 * what the Details region says a layer is related to from either end, and
 * what a save, a close and a reopen leave on screen.
 *
 * It is **not** filesystem, persistence or provider evidence. The project, the
 * add result, the layer answer and the roster are a controlled answer table:
 * the layer identifier is one this spec chose, "matches the recorded content"
 * is a string rather than a digest anything computed, and the reopened project
 * is what the table says a reopened project looks like. That a layer is
 * written to and read back from a real document with its identity intact,
 * that creating one reads no file and starts nothing, that a reference with a
 * layer cannot be removed, and that a reopened project remembers no Workbench
 * row, is proved against real files in
 * `apps/desktop/src-tauri/src/project/tests.rs` and
 * `apps/desktop/src-tauri/src/reattachment/tests.rs`.
 *
 * No provider is asked for anything at any point. The call ledger is part of
 * the claim: creating, inspecting, navigating to and removing a layer never
 * sends a request that could open, check, hash or convert a file.
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
} from "../support/harness";
import { MZML_ROW, ipcTable } from "../support/fixtures";
import { FAKE_WORKSPACE_CAPACITY } from "../../apps/desktop/src/test/previewFixtures";

let output = "";
const evidence: unknown[] = [];

/** Every console entry this document produced that the allowlist does not name. */
async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

const INPUT = "11111111-2222-4111-8111-111111111111";
const RUN = "ffffffff-2222-4111-8111-111111111111";
const ARTIFACT = "eeeeeeee-2222-4111-8111-111111111111";
const LAYER = "dddddddd-2222-4111-8111-111111111111";

/** The one layer this scenario creates, exactly as the projection carries it. */
const LAYER_RECORD = { id: LAYER, sourceInputId: INPUT, consumedByRunIds: [] as readonly string[] };

/** What a session with no project open answers. */
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
 * A saved project whose one reference has been checked and still matches.
 *
 * The M8.3 seed, carrying the layers a real projection always carries -- none
 * to begin with. It keeps its recorded run and the record that run produced,
 * because creating, inspecting and removing a layer changes none of that.
 */
function checkedProject(options: {
  readonly workbenchDatasetHandle: string | null;
  readonly layers?: readonly (typeof LAYER_RECORD)[];
  readonly dirty?: boolean;
  readonly label?: string;
}) {
  return {
    open: true,
    projectId: "aaaaaaaa-0000-4111-8111-000000000001",
    name: "Plasma batch 7",
    dirty: options.dirty ?? false,
    published: true,
    inputs: [
      {
        id: INPUT,
        label: options.label ?? MZML_ROW.fileName,
        locatorKind: "insideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 2048 }],
        verification: "matchingRecordedContent",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [RUN],
        workbenchDatasetHandle: options.workbenchDatasetHandle,
      },
    ],
    artifacts: [
      {
        id: ARTIFACT,
        label: "File facts: 1 reference",
        observedInputCount: 1,
        observedMemberCount: 1,
        kind: "fileFactsV1",
        qcSnapshot: null,
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
        layerIds: [],
        outputArtifactIds: [ARTIFACT],
        applicationVersion: "0.1.0",
        startedAt: "2026-09-22T10:00:00Z",
        finishedAt: "2026-09-22T10:00:02Z",
      },
    ],
    layers: options.layers ?? [],
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
 * sideways, that no absolute path and no raw layer identifier is on screen,
 * that the page reached for nothing off-origin, and that every roster row and
 * every layer control on a visible project surface is within the viewport and
 * meets the compact target minimum.
 */
async function capture(label: string) {
  const measured = await browser.execute((layerId: string) => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const root = document.querySelector(".workbench-shell");
    if (root === null) throw Error("The shell is not mounted");
    const attribute = (node: Element | null, name: string) => node?.getAttribute(name) ?? null;
    const active = document.activeElement;
    const project = document.querySelector<HTMLElement>("#workbench-project");
    const roster = document.querySelector<HTMLElement>("#workbench-roster");
    const inspector = document.querySelector<HTMLElement>("#workbench-inspector");
    return {
      css: { width: innerWidth, height: innerHeight },
      locale: document.documentElement.lang,
      surface: root.getAttribute("data-surface"),
      projectShown: project !== null && !project.hidden,
      rosterShown: roster !== null && !roster.hidden,
      // The project surface is its own scroll container, so a list or a row
      // that does not wrap scrolls here and never reaches the document.
      projectOverflow:
        project === null || project.hidden ? 0 : project.scrollWidth - project.clientWidth,
      // The one control each reference carries for its layer, in whichever of
      // its two states it is in.
      layerControls: [...document.querySelectorAll("[data-project-input]")].map((row) => {
        const control = row.querySelector(
          "[data-project-create-layer], [data-project-show-layer]",
        );
        if (control === null) throw Error("A reference row without its layer control");
        const describedBy = attribute(control, "aria-describedby");
        return {
          input: row.getAttribute("data-project-input"),
          text: control.textContent,
          name: attribute(control, "aria-label"),
          creates: attribute(control, "data-project-create-layer"),
          shows: attribute(control, "data-project-show-layer"),
          disabled: attribute(control, "aria-disabled"),
          hardDisabled: control.hasAttribute("disabled"),
          unavailable: attribute(control, "data-project-layer-unavailable"),
          title: attribute(control, "title"),
          describedBy,
          reason:
            describedBy === null ? null : (document.getElementById(describedBy)?.textContent ?? null),
          ...rect(control),
        };
      }),
      layersEmpty:
        document.querySelector('section[aria-label="Layers"] .project-empty')?.textContent ?? null,
      layerRows: [...document.querySelectorAll("[data-project-layer]")].map((row) => {
        const labelControl = row.querySelector("[data-project-inspect-layer]");
        return {
          id: row.getAttribute("data-project-layer"),
          availability: row.getAttribute("data-layer-availability"),
          source: row.getAttribute("data-layer-source"),
          label: labelControl?.textContent ?? null,
          labelName: attribute(labelControl, "aria-label"),
          current: attribute(labelControl, "aria-current"),
          availabilityText: row.querySelector(".project-availability")?.textContent ?? null,
          currentFile: row.querySelector(".project-verification")?.textContent ?? null,
          showInWorkbench: row.querySelector("[data-project-layer-show-in-workbench]") !== null,
          ...rect(row),
        };
      }),
      // What the Details region says, where it is on screen at all.
      details:
        inspector === null || inspector.hidden
          ? null
          : {
              describing: attribute(inspector.querySelector("[data-provenance]"), "data-provenance"),
              kind: inspector.querySelector(".provenance-kind")?.textContent ?? null,
              name: inspector.querySelector(".provenance-name")?.textContent ?? null,
              availability: attribute(
                inspector.querySelector("[data-provenance-availability]"),
                "data-provenance-availability",
              ),
              availabilityText:
                inspector.querySelector("[data-provenance-availability]")?.textContent ?? null,
              showInWorkbench: attribute(
                inspector.querySelector("[data-provenance-layer-show-in-workbench]"),
                "aria-label",
              ),
              links: [...inspector.querySelectorAll("[data-provenance-link]")].map((node) => ({
                id: node.getAttribute("data-provenance-link"),
                text: node.textContent,
                name: node.getAttribute("aria-label"),
              })),
              currentStates: [...inspector.querySelectorAll("[data-provenance-current]")].map(
                (node) => node.getAttribute("data-provenance-current"),
              ),
              noLayer: inspector.querySelector("[data-provenance-no-layer]") !== null,
              selectionGone: inspector.querySelector("[data-provenance-selection-gone]") !== null,
              // The region's own box, and whether anything in it scrolls
              // sideways -- which a long name that did not wrap would do.
              region: {
                ...rect(inspector),
                overflow: inspector.scrollWidth - inspector.clientWidth,
              },
            },
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
      activeElement:
        active === null
          ? null
          : {
              handle: active.getAttribute("data-handle"),
              creates: active.getAttribute("data-project-create-layer"),
              shows: active.getAttribute("data-project-show-layer"),
            },
      // A layer's visible name is its source's label. The identifier is for
      // data attributes and requests, never for a reader.
      layerIdOnScreen: document.body.innerText.includes(layerId),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      pathsOnScreen: (document.body.innerText.match(/[A-Za-z]:\\[^\s]+/gu) ?? []).length,
      external: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  }, LAYER);
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
      "React/mock-IPC layout and interaction evidence. The project, the add result, the layer " +
      "answer and the roster are a controlled answer table: no filesystem was read, no content " +
      "was hashed, no document was written and no provider was involved.",
    ...measured,
  });

  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  expect(measured.layerIdOnScreen).toBe(false);
  // Measured only where each region is on screen: a hidden element's box is
  // zero, which is not evidence about a target's size. One column folds the
  // roster away while the project surface is shown, and the other way round.
  if (measured.rosterShown) {
    for (const row of measured.rows) {
      expect(row.x).toBeGreaterThanOrEqual(0);
      expect(row.x + row.width).toBeLessThanOrEqual(measured.css.width + 1);
      expect(row.height).toBeGreaterThanOrEqual(31.5);
    }
  }
  if (measured.projectShown) {
    expect(measured.projectOverflow).toBeLessThanOrEqual(1);
    for (const control of [...measured.layerControls, ...measured.layerRows]) {
      expect(control.x).toBeGreaterThanOrEqual(0);
      expect(control.x + control.width).toBeLessThanOrEqual(measured.css.width + 1);
      expect(control.height).toBeGreaterThanOrEqual(31.5);
    }
  }
  return measured;
}

/**
 * An empty workspace, one checked reference with no layer, and the answers to
 * the add and the create that follow.
 */
async function openProjectSurface() {
  const table: Record<string, unknown> = ipcTable();
  // Empty, so the row that arrives is visibly this operation's.
  table.get_workspace_roster = { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY };
  table.get_project_state = checkedProject({ workbenchDatasetHandle: null });
  table.begin_project_job = { operationId: "project-job-1" };
  table.cancel_project_job = { outcome: "cancelled" };
  table.add_project_input_to_workspace = {
    // The project as Rust describes it *after* the admission: it now knows
    // which row this reference is.
    project: checkedProject({ workbenchDatasetHandle: MZML_ROW.handle }),
    workspace: {
      roster: { datasets: [MZML_ROW], capacity: FAKE_WORKSPACE_CAPACITY },
      outcomes: [{ outcome: "added", dataset: MZML_ROW }],
    },
  };
  // The same project after the layer is created: one layer, sourced from the
  // reference, and a document that now has something unsaved in it.
  table.create_project_layer = checkedProject({
    workbenchDatasetHandle: MZML_ROW.handle,
    layers: [LAYER_RECORD],
    dirty: true,
  });
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
  await browser.$("button=Project").click();
  await browser.$("[data-project-surface]").waitForDisplayed();
}

describe("M8.4 layer identity and provenance, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_M84_OUTPUT_ROOT"] ?? resolve("test-results/m8.4");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M8.4 browser evidence: ${output}`);
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

  it("creates a layer from a Workbench row, reaches it from both ends, and keeps it across a reopen", async () => {
    await metrics(1920, 1080);
    await openProjectSurface();

    // 1. Not in the Workbench yet. The control is there and reachable, says
    // why it does nothing, and does nothing.
    const start = await capture("m84-01-not-in-workbench");
    expect(start.surface).toBe("project");
    expect(start.layerControls).toHaveLength(1);
    expect(start.layerControls[0]).toMatchObject({
      input: INPUT,
      creates: INPUT,
      shows: null,
      text: "Create layer",
      name: `Create layer: ${MZML_ROW.fileName}`,
      disabled: "true",
      hardDisabled: false,
      unavailable: "notInWorkbench",
      title: "Add this reference to the Workbench before creating its layer.",
      describedBy: `project-layer-reason-${INPUT}`,
      reason: "Add this reference to the Workbench before creating its layer.",
    });
    expect(start.layersEmpty).toBe(
      "No layers yet. Create one from a reference that is in the Workbench.",
    );
    expect(start.layerRows).toEqual([]);
    const idle = await ipcCalls();
    await browser.$(`[data-project-create-layer="${INPUT}"]`).click();
    expect(await ipcCalls()).toEqual(idle);
    expect(await browser.$("[data-project-layer]").isExisting()).toBe(false);

    // 2. Into the Workbench by the existing M8.3 action, and back. The offer
    // is now a real one.
    await browser.$(`[data-project-add-to-workbench="${INPUT}"]`).click();
    await browser.$(`#workbench-roster [data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();
    expect(await browser.$(".workbench-shell").getAttribute("data-surface")).toBe("workbench");
    await browser.$("button=Project").click();
    await browser
      .$(`[data-project-create-layer="${INPUT}"]:not([aria-disabled])`)
      .waitForDisplayed();

    const offered = await capture("m84-02-create-offered");
    expect(offered.surface).toBe("project");
    expect(offered.layerControls[0]).toMatchObject({
      creates: INPUT,
      disabled: null,
      unavailable: null,
      title: null,
      describedBy: null,
    });
    expect(offered.rows.map((row) => row.handle)).toEqual([MZML_ROW.handle]);

    // 3. Create by keyboard: real focus, a real Enter, which is the activation
    // jsdom cannot synthesize.
    const beforeCreate = await ipcCalls();
    await browser.execute((input: string) => {
      document.querySelector<HTMLElement>(`[data-project-create-layer="${input}"]`)?.focus();
    }, INPUT);
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute("data-project-create-layer") ?? null,
      ),
    ).toBe(INPUT);
    await browser.keys("Enter");
    await browser.$(`[data-project-layer="${LAYER}"]`).waitForDisplayed();
    await browser.$("[data-project-busy]").waitForExist({ reverse: true });
    // Focus that a keyboard user can see, read from computed style on the
    // element that has it, not inferred from a rule existing somewhere.
    const ring = await focusedTreatment();
    evidence.push({ label: "m84-03-focus-treatment", ...ring });
    expect(ring.visible).toBe(true);

    const created = await capture("m84-03-layer-created");
    expect(created.layerRows).toHaveLength(1);
    expect(created.layerRows[0]).toMatchObject({
      id: LAYER,
      availability: "attached",
      source: INPUT,
      label: MZML_ROW.fileName,
      labelName: `Show what the layer of ${MZML_ROW.fileName} is related to`,
      current: "true",
      availabilityText: "In the Workbench",
      currentFile: "Current file: Matches the recorded content",
      showInWorkbench: true,
    });
    // The request named the reference and nothing else: no path, no handle --
    // and it was the only request. Nothing opened, checked, hashed or began.
    expect((await ipcCalls()).slice(beforeCreate.length)).toEqual([
      { command: "create_project_layer", args: { inputId: INPUT } },
    ]);
    // The same element, now the other half of the pair, still carrying the
    // keyboard.
    expect(created.layerControls[0]).toMatchObject({
      input: INPUT,
      creates: null,
      shows: LAYER,
      text: "Show layer",
      name: `Show layer: ${MZML_ROW.fileName}`,
      disabled: null,
    });
    expect(created.activeElement).toEqual({ handle: null, creates: null, shows: LAYER });

    // 4. Inspected on arrival: Details answers for the layer at once, with
    // what its source is related to.
    expect(created.details).toMatchObject({
      describing: "layer",
      kind: "Layer",
      name: MZML_ROW.fileName,
      availability: "attached",
      availabilityText: "In the Workbench",
      showInWorkbench: `Show in Workbench: ${MZML_ROW.fileName}`,
      currentStates: ["matchingRecordedContent"],
    });
    expect(created.details?.links.map((link) => link.id)).toEqual([INPUT, RUN]);
    expect(created.details?.links[0]?.name).toBe(
      `Show what ${MZML_ROW.fileName} is related to`,
    );
    expect(created.details?.links[1]?.name).toMatch(/^Show what the run of .+ is related to$/u);

    // 5. Layer -> source -> layer. Every edge was already on the page, so not
    // one request in either direction.
    const beforeNavigation = await ipcCalls();
    await browser.$(`#workbench-inspector [data-provenance-link="${INPUT}"]`).click();
    await browser.$('[data-provenance="input"]').waitForDisplayed();
    const asSource = await capture("m84-04-source-from-layer");
    expect(asSource.details).toMatchObject({
      describing: "input",
      name: MZML_ROW.fileName,
      noLayer: false,
    });
    expect(asSource.details?.links.map((link) => link.id)).toEqual([RUN, LAYER]);
    expect(asSource.details?.links[1]).toEqual({
      id: LAYER,
      text: MZML_ROW.fileName,
      name: `Show what the layer of ${MZML_ROW.fileName} is related to`,
    });
    expect(asSource.layerRows[0]?.current).toBe(null);

    await browser.$(`#workbench-inspector [data-provenance-link="${LAYER}"]`).click();
    await browser.$('[data-provenance="layer"]').waitForDisplayed();
    const backOnLayer = await capture("m84-05-layer-from-source");
    expect(backOnLayer.details?.describing).toBe("layer");
    expect(backOnLayer.layerRows[0]?.current).toBe("true");
    expect(await ipcCalls()).toEqual(beforeNavigation);

    // 6. Show in Workbench from the layer's Details: the row it resolves to
    // is highlighted and carries the keyboard, and nothing was sent.
    await browser.$("#workbench-inspector [data-provenance-layer-show-in-workbench]").click();
    await browser.waitUntil(async () =>
      (await browser.$(".workbench-shell").getAttribute("data-surface")) === "workbench",
    );
    const shown = await capture("m84-06-shown-in-workbench");
    expect(shown.rows.map((row) => row.handle)).toEqual([MZML_ROW.handle]);
    expect(shown.rows[0]?.selected).toBe("true");
    expect(shown.rows[0]?.focused).toBe(true);
    expect(shown.activeElement?.handle).toBe(MZML_ROW.handle);
    expect(await ipcCalls()).toEqual(beforeNavigation);
    await browser.$("button=Project").click();
    await browser.$("[data-project-surface]").waitForDisplayed();

    // 7. Save, close, reopen -- through the real buttons. The layer comes back
    // with the same identity; the Workbench row does not come back with it,
    // and the roster never lost the row.
    await setInvokeResult(
      "save_project",
      checkedProject({ workbenchDatasetHandle: MZML_ROW.handle, layers: [LAYER_RECORD] }),
    );
    await setInvokeResult("close_project", NO_PROJECT);
    await setInvokeResult(
      "open_project",
      checkedProject({ workbenchDatasetHandle: null, layers: [LAYER_RECORD] }),
    );
    const beforeReopen = await ipcCalls();
    await browser.$("button=Save").click();
    await browser.$("[data-project-unsaved]").waitForExist({ reverse: true });
    await browser.$("button=Close").click();
    await browser.$("[data-project-input]").waitForExist({ reverse: true });
    const closed = await capture("m84-07-closed");
    expect(closed.layerRows).toEqual([]);
    expect(closed.rows.map((row) => row.handle)).toEqual([MZML_ROW.handle]);
    await browser.$("button=Open project…").click();
    await browser.$(`[data-project-layer="${LAYER}"]`).waitForDisplayed();

    const reopened = await capture("m84-08-reopened");
    expect(reopened.layerRows).toHaveLength(1);
    expect(reopened.layerRows[0]).toMatchObject({
      id: LAYER,
      availability: "detached",
      source: INPUT,
      label: MZML_ROW.fileName,
      availabilityText: "Not in the Workbench",
      showInWorkbench: false,
    });
    // One layer per reference: the reference offers to show it, not to create
    // a second one.
    expect(reopened.layerControls[0]).toMatchObject({
      input: INPUT,
      creates: null,
      shows: LAYER,
      text: "Show layer",
    });
    expect(reopened.rows.map((row) => row.handle)).toEqual([MZML_ROW.handle]);
    // Three requests, and only those: reopening restored no attachment.
    expect((await ipcCalls()).slice(beforeReopen.length).map((call) => call.command)).toEqual([
      "save_project",
      "close_project",
      "open_project",
    ]);

    // The reference's Show layer control, after the reopen: it inspects the
    // layer and sends nothing, and Details agrees with the row about
    // availability.
    const beforeShow = await ipcCalls();
    await browser.$(`[data-project-input="${INPUT}"] [data-project-show-layer="${LAYER}"]`).click();
    await browser.$('[data-provenance="layer"]').waitForDisplayed();
    const detached = await capture("m84-09-reopened-layer-details");
    expect(detached.details).toMatchObject({
      describing: "layer",
      name: MZML_ROW.fileName,
      availability: "detached",
      availabilityText: "Not in the Workbench",
      showInWorkbench: null,
    });
    expect(detached.details?.links.map((link) => link.id)).toEqual([INPUT, RUN]);
    expect(await ipcCalls()).toEqual(beforeShow);

    // 8. Remove the layer. The reference, the run, the record and the roster
    // row are all still there; only the layer is gone, and the selection says
    // so rather than moving somewhere else.
    await setInvokeResult(
      "remove_project_layer",
      checkedProject({ workbenchDatasetHandle: null, dirty: true }),
    );
    const beforeRemove = await ipcCalls();
    await browser.$(`[data-project-remove-layer="${LAYER}"]`).click();
    await browser.$("[data-project-layer]").waitForExist({ reverse: true });
    await browser.$("[data-project-busy]").waitForExist({ reverse: true });
    const removed = await capture("m84-10-layer-removed");
    expect(removed.layerRows).toEqual([]);
    expect(removed.layersEmpty).toBe(
      "No layers yet. Create one from a reference that is in the Workbench.",
    );
    expect(removed.layerControls.map((control) => control.input)).toEqual([INPUT]);
    // The reopened project remembers no row, so the offer is back with its
    // reason -- even though the roster still holds the row it once became.
    expect(removed.layerControls[0]).toMatchObject({
      creates: INPUT,
      shows: null,
      unavailable: "notInWorkbench",
    });
    expect(removed.runs).toEqual(["completed"]);
    expect(removed.artifacts).toEqual([ARTIFACT]);
    expect(removed.rows.map((row) => row.handle)).toEqual([MZML_ROW.handle]);
    expect(removed.details?.selectionGone).toBe(true);
    // The pressed control went with its row; the keyboard is on the control
    // the removal changed rather than on the body.
    expect(removed.activeElement).toEqual({ handle: null, creates: INPUT, shows: null });
    expect((await ipcCalls()).slice(beforeRemove.length)).toEqual([
      { command: "remove_project_layer", args: { layerId: LAYER } },
    ]);

    // Not one warning, error or unhandled rejection across the whole flow.
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps a long source name inside the surface and the Details region when constrained", async () => {
    // A name as long as an instrument will write, and a layer already made
    // from it. What is measured is what a screenshot cannot say: neither the
    // page, nor the project surface the list scrolls in, nor the Details
    // region scrolls sideways; every layer control is inside the viewport and
    // at the compact minimum; and the Details region does not widen to fit
    // the name.
    const long = `${"Plasma_QC_batch_07_".repeat(7)}replicate_03.mzML`;
    const table: Record<string, unknown> = ipcTable();
    table.get_workspace_roster = { datasets: [MZML_ROW], capacity: FAKE_WORKSPACE_CAPACITY };
    table.get_project_state = checkedProject({
      workbenchDatasetHandle: MZML_ROW.handle,
      layers: [LAYER_RECORD],
      label: long,
    });
    // The store answers a layout commit with the snapshot it published, and
    // the interface applies that; without it the Details reveal below would be
    // undone by its own reply.
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
      [1366, 768, "m84-11-long-name-1366"],
      [960, 640, "m84-12-long-name-960"],
    ] as const) {
      await metrics(width, height);
      await browser.url("/");
      await browser.$(".workbench-header").waitForDisplayed();
      await browser.$("button=Project").click();
      await browser.$(`[data-project-layer="${LAYER}"]`).waitForDisplayed();

      const listed = await capture(`${label}-list`);
      expect(listed.projectShown).toBe(true);
      expect(listed.layerRows[0]?.label).toBe(long);
      // The name wraps inside its row: the surface it would push sideways
      // does not scroll. (A row's own box follows its column whatever it
      // holds, so its width is not evidence of wrapping.)
      expect(listed.projectOverflow).toBeLessThanOrEqual(1);

      await browser.$(`[data-project-inspect-layer="${LAYER}"]`).click();
      // Below the roomy breakpoint the region waits to be asked for, and the
      // surface says where the answer went.
      await browser.$("[data-project-inspect-hint] button").click();
      await browser.$('[data-provenance="layer"]').waitForDisplayed();

      const inspected = await capture(`${label}-details`);
      expect(inspected.details?.describing).toBe("layer");
      expect(inspected.details?.name).toBe(long);
      const region = inspected.details?.region;
      expect(region).toBeDefined();
      expect(region?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((region?.x ?? 0) + (region?.width ?? Infinity)).toBeLessThanOrEqual(width + 1);
      expect(region?.overflow ?? Infinity).toBeLessThanOrEqual(1);
      // Each viewport is its own document, and its console ledger goes with
      // it at the next navigation, so it is read here rather than once after.
      evidence.push({ viewport: label, console: await consoleEntries() });
      expect(await unexpectedConsole()).toEqual([]);
    }
  });
});
