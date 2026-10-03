/**
 * PM9.1 -- the populated-state browser baseline, with the PM9.2 context-line
 * draft on top of it, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced, exactly as the
 * M8/M9 specs run. So this is React, CSS, layout and interaction evidence about
 * the shell: what the context line says in a populated state, where each item
 * takes the reader, what survives a trip away and back, and what a settled task
 * or a replaced project leaves behind.
 *
 * It is **not** provider, engine, filesystem or persistence evidence. Every
 * answer is a controlled table written here from the repository's own fixture
 * builders: no file is read, no converter or runtime runs and no result is
 * computed. Synthetic states stay synthetic.
 *
 * The states mirror `apps/desktop/src/test/pm9Scenarios.tsx`, which cannot be
 * imported here (it mounts `App` through Testing Library, and the project
 * builders it uses import Vitest). Identifiers, names and labels are copied
 * from those builders. Where this table differs, `docs/phases/pm9/baseline.md`
 * §6 names the difference.
 *
 * Two parts, kept apart:
 * - the functional cases assert behaviour the owners already define;
 * - the observation block records geometry and keyboard samples at the PM9
 *   viewports and languages. It asserts the limits other specs already hold
 *   and, since PM9.2, the convergence limits for L10, L14–L16, L20 and L22,
 *   each named where it is asserted. Beyond those, a rectangle it records is
 *   not a verdict that the layout is acceptable, and no overflow is not
 *   acceptance.
 *
 * Status when written: authored, NOT RUN. Nothing here has compiled, been
 * discovered or passed. The PM9.2 additions are authored and NOT RUN too.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  focusedTreatment,
  heldCallers,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeRejection,
  setInvokeResult,
  type IpcCall,
} from "../support/harness";
import { showBackendBanner } from "../support/backendBanner";
import { cdp, metrics } from "../support/cdp";
import {
  EMPTY_ROSTER,
  NO_PROJECT,
  PLAN_SHA,
  QC_ARTIFACT,
  QC_LAYER,
  RESULT,
  RUNNING,
  SETTLED,
  TARGETED_LAYER,
  TARGETED_RUN,
  capturedProject,
  conversionSlot,
  scenario,
  type Availability,
  type Locale,
  type Scenario,
} from "../support/pm9Scenarios";
import { MZML_ROW, VENDOR_ROW } from "../support/fixtures";
import {
  SPECTRUM_PLOT,
  readBackSavedPreferences,
  revealRosterRow,
  selectTheSpectrum,
  selectedRowPosition,
  spectrumRangeCaption,
} from "../support/viewer";
import {
  availableBackend,
  chosenBackend,
  chosenFolderWithoutTools,
  quarantinedBackend,
  queueItem,
  queueOf,
  secondFile,
  settledAt,
  shippedIntent,
  unavailableBackend,
} from "../../apps/desktop/src/test/previewFixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

/** motion's development-build notice when the page asks for reduced motion. */
const REDUCED_MOTION_NOTICE = "You have Reduced Motion enabled on your device";

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** The words before a resource's first parameter: what every item of that kind starts with. */
function prefix(template: string): string {
  return template.split("{{")[0]!;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (_, key: string) => values[key] ?? "");
}

// ---------------------------------------------------------------- driving

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function open(name: Scenario, locale: Locale = "en") {
  await installIpcBoundary(scenario(name, locale));
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
}

function surface(): Promise<string | null> {
  return browser.execute(
    () => document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null,
  ) as Promise<string | null>;
}

function contextText(id: string): Promise<string | null> {
  return browser.execute(
    (item: string) => document.querySelector(`[data-shell-context="${item}"]`)?.textContent ?? null,
    id,
  ) as Promise<string | null>;
}

async function waitForContext(id: string, expected: (text: string | null) => boolean, what: string) {
  await browser.waitUntil(async () => expected(await contextText(id)), {
    timeout: 15_000,
    timeoutMsg: `context item ${id}: ${what}`,
  });
}

/** Activates one context item with a real pointer click. */
async function activate(id: string) {
  await browser.$(`[data-shell-context="${id}"]`).click();
}

/** A header destination, found by its visible name as M9.1 finds it. */
async function navigate(names: readonly string[]) {
  await browser.execute((labels: readonly string[]) => {
    [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => labels.includes(button.textContent ?? ""))
      ?.click();
  }, names);
}

/** Home, found by its place rather than its label, so it serves either locale. */
async function home() {
  await browser.$(".workbench-home").click();
}

/**
 * The scope as the Conversion surface resolves it, in the context line's words:
 * the checked scope and the eligible count from its own summary. `null` where
 * the surface states no scope.
 */
function ownedScope(): Promise<string | null> {
  return browser.execute(
    (selected: string, all: string, template: string) => {
      const checked = document.querySelector<HTMLInputElement>('input[name="conversion-scope"]:checked');
      const eligible = /(\d+) eligible/u.exec(document.querySelector("#conversion-scope-summary")?.textContent ?? "")?.[1];
      if (checked === null || eligible === undefined) return null;
      return template.replace("{{scope}}", checked.value === "all" ? all : selected).replace("{{eligible}}", eligible);
    },
    en.m74CnvSelected,
    en.m74CnvAll,
    en.shellContextScope,
  ) as Promise<string | null>;
}

/**
 * What the processing scope is made of: each roster row's conversion
 * membership, the chosen scope and the Conversion surface's own counts. Read
 * from every mounted surface, whichever is shown.
 */
function membership(): Promise<unknown> {
  return browser.execute(() => ({
    rows: [...document.querySelectorAll<HTMLInputElement>('.grouped-roster input[type="checkbox"]')].map((box) => [
      box.getAttribute("aria-label"),
      box.checked,
      box.indeterminate,
    ]),
    scope: document.querySelector<HTMLInputElement>('input[name="conversion-scope"]:checked')?.value ?? null,
    counts: document.querySelector("#conversion-scope-summary")?.textContent ?? null,
    selection: document.querySelector(".roster-selection-context")?.textContent ?? null,
  }));
}

/** Which destination the navigation marks as the current page. */
function currentDestination(): Promise<string | null> {
  return browser.execute(
    () => document.querySelector(".workbench-navigation > button[aria-current='page']")?.textContent ?? null,
  ) as Promise<string | null>;
}

/**
 * Reads an owner may make without the reader asking for anything, each stated
 * read-only in its `lib.rs` doc comment: the conversion slot ("launches nothing
 * and changes nothing"), targeted progress and runtime ("read-only"), the queue
 * description ("no gate, no picker, no reservation, no process") and the
 * spectrum's screen projection ("launches no process, re-reads no
 * acquisition"). No owner promises a trip between surfaces issues none of
 * them, so they are recorded rather than failed.
 *
 * Not here, on purpose: `read_conversion_configuration` may run an
 * `msconvert --help` probe; `inspect_backend` checks an installation;
 * `preview_figure` carries no read-only statement; `get_project_state` would
 * replace what the Project surface shows; and a source read
 * (`open_mzml_preview`, `load_selected_spectrum`) or a stored-result read
 * repeated on return is a duplicate, not a projection.
 */
const READ_ONLY = [
  "get_workspace_conversion_state",
  "get_targeted_ms1_progress",
  "get_targeted_ms1_runtime",
  "describe_workspace_conversion_queue",
  "project_selected_spectrum",
] as const;

/**
 * What was asked since `before` that is not one of those reads: a task, a
 * mutation, a source read or a repeated stored-result read. Every command is
 * recorded in the evidence, read-only ones included.
 */
async function unexpectedSince(label: string, before: readonly IpcCall[]): Promise<string[]> {
  const commands = (await ipcCalls()).slice(before.length).map((call) => call.command);
  evidence.push({ label: `${label}-requests`, commands });
  return commands.filter((command) => !(READ_ONLY as readonly string[]).includes(command));
}

/** Views the populated roster's mzML row by the Workbench's own action, as M8.5 does. */
async function viewTheRow() {
  const row = `.grouped-roster [data-handle="${MZML_ROW.handle}"]`;
  if (!(await browser.$(row).isDisplayed())) {
    await browser.$('[aria-controls="workbench-roster"]').click();
  }
  await browser.$(row).click();
  await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
}

/** Each roster row as the reader's state leaves it: order, highlight, viewed, membership. */
function rosterState() {
  return browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".grouped-roster [data-handle]")].map((row) => {
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      return [
        row.getAttribute("data-handle"),
        row.getAttribute("aria-selected"),
        row.classList.contains("is-active"),
        box === null ? null : box.checked,
      ];
    }),
  );
}

/**
 * Puts focus on the header's first control, where a Tab walk starts.
 *
 * Blurring is not enough: Chrome continues a Tab walk from the last node that
 * was clicked, which after a press in the main region is past the header.
 */
async function startAtHome() {
  await browser.execute(() => document.querySelector<HTMLElement>(".workbench-home")?.focus());
}

/**
 * Tabs from Home until a context item has focus.
 *
 * Bounded: an item never reached in `limit` presses is a keyboard-access
 * finding, not something to wait out.
 */
async function tabTo(id: string, limit = 40): Promise<boolean> {
  await startAtHome();
  for (let step = 0; step < limit; step += 1) {
    await browser.keys("Tab");
    const at = await browser.execute(
      () => document.activeElement?.getAttribute("data-shell-context") ?? null,
    );
    if (at === id) return true;
  }
  return false;
}

// ---------------------------------------------------------------- observation

/**
 * Waits until the shell fills the emulated viewport, and records how long.
 *
 * `metrics()` waits on `innerWidth`/`innerHeight`, yet a read taken right after
 * can still see the previous height: baseline §7.4 recorded one such reading at
 * `a0783bb`, and PM9.2's acceptance run another (the main region 964 px tall at
 * a 768 px viewport, while the screenshot taken just after showed the settled
 * layout). The shell is `100vh`, so its height matching the viewport's is the
 * settle. One that never comes is a failure, not something to wait out.
 */
async function settled(label: string) {
  const started = Date.now();
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const shell = document.querySelector(".workbench-shell");
        return shell !== null && Math.abs(shell.getBoundingClientRect().height - innerHeight) <= 1;
      }),
    { timeout: 10_000, interval: 50, timeoutMsg: `${label}: the shell never filled the resized viewport` },
  );
  evidence.push({ label: `${label}-settle`, waitedMs: Date.now() - started });
}

/**
 * What one frame is evidence for. Recorded, and judged here only against the
 * limits other specs already hold and the PM9.2 limits named below.
 */
async function observe(label: string) {
  await settled(label);
  const measured = await browser.execute(() => {
    const rect = (element: Element | null) => {
      if (element === null || (element as HTMLElement).hidden) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const shell = document.querySelector(".workbench-shell");
    const header = document.querySelector(".workbench-header");
    const main = ["#workbench-evidence", "#workbench-conversion", "#workbench-project"]
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find((element) => element !== null && !element.hidden) ?? null;
    const items = [...document.querySelectorAll<HTMLElement>("[data-shell-context]")];
    // Whether an item shows an ellipsis at all. `scrollWidth` is a whole
    // number, and a sub-pixel shrink is still an ellipsis on screen, so the
    // item's text is measured against its content box. Measured on an
    // unconstrained copy beside the item, so the copy has the item's own
    // cascade -- font, language, density -- and nothing is re-derived.
    const shape = (item: HTMLElement) => {
      const style = getComputedStyle(item);
      const content =
        item.getBoundingClientRect().width -
        ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
          .map((key) => parseFloat(style[key as "paddingLeft"]) || 0)
          .reduce((sum, value) => sum + value, 0);
      const copy = item.cloneNode(true) as HTMLElement;
      copy.removeAttribute("data-shell-context");
      copy.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;width:max-content;min-width:0;max-width:none";
      item.after(copy);
      const range = document.createRange();
      range.selectNodeContents(copy);
      const natural = range.getBoundingClientRect().width;
      const ellipsized = natural > content + 0.01;
      // What stays readable in front of the ellipsis: the longest prefix that
      // fits beside one, in the item's own font.
      const full = item.textContent ?? "";
      let visible = full;
      if (ellipsized) {
        copy.textContent = "…";
        range.selectNodeContents(copy);
        const mark = range.getBoundingClientRect().width;
        copy.textContent = full;
        const text = copy.firstChild;
        visible = "";
        for (let end = 1; text !== null && end <= full.length; end += 1) {
          range.setStart(text, 0);
          range.setEnd(text, end);
          if (range.getBoundingClientRect().width + mark > content + 0.01) break;
          visible = full.slice(0, end);
        }
      }
      copy.remove();
      return { natural, content, ellipsized, visible, floor: parseFloat(style.minWidth) || 0 };
    };
    const shapes = items.map(shape);
    // What the header leaves for the work: the band below it, the main region's
    // share of that band, and how much of each evidence panel is on screen
    // without scrolling. The second header line costs height here, most of all
    // at 960x640, so this is recorded beside the header's own size.
    const headerBottom = header === null ? 0 : header.getBoundingClientRect().bottom;
    const mainBox = main === null ? null : main.getBoundingClientRect();
    const onScreen = (box: DOMRect) => {
      const top = Math.max(box.top, mainBox?.top ?? 0, 0);
      const bottom = Math.min(box.bottom, mainBox?.bottom ?? innerHeight, innerHeight);
      return Math.max(0, bottom - top);
    };
    const panels = [
      ".chromatogram-panel",
      ".spectrum-panel",
      ".spectrum-table-panel",
      "[data-targeted-report]",
      "[data-qc-report]",
      ".conversion-running",
    ]
      .map((selector) => ({ selector, element: document.querySelector<HTMLElement>(selector) }))
      .filter(({ element }) => element !== null && main !== null && main.contains(element));
    return {
      css: { width: innerWidth, height: innerHeight },
      workArea: {
        top: headerBottom,
        height: innerHeight - headerBottom,
        notices: rect(document.querySelector(".shell-notices")),
        mainOnScreen: mainBox === null ? 0 : onScreen(mainBox),
      },
      evidencePanels: panels.map(({ selector, element }) => {
        const box = element!.getBoundingClientRect();
        return { selector, top: box.top, height: box.height, onScreen: onScreen(box) };
      }),
      lang: document.documentElement.lang,
      surface: shell?.getAttribute("data-surface") ?? null,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      contextLine: items.length > 0,
      header: rect(header),
      contextBar: rect(document.querySelector(".workbench-context-bar")),
      shellContext: rect(document.querySelector(".shell-context")),
      contextItems: items.map((item, index) => ({
        id: item.getAttribute("data-shell-context"),
        priority: item.getAttribute("data-priority"),
        text: item.textContent,
        truncated: item.scrollWidth > item.clientWidth,
        ...shapes[index]!,
        ...rect(item),
      })),
      contextRows: new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size,
      dropHint: rect(document.querySelector(".workbench-header .workspace-drop-hint")),
      backendToggle: rect(document.querySelector("[data-backend-toggle]")),
      regions: {
        roster: rect(document.querySelector("#workbench-roster")),
        main:
          main === null
            ? null
            : { id: main.id, ...rect(main), clientHeight: main.clientHeight, scrollHeight: main.scrollHeight },
        inspector: rect(document.querySelector("#workbench-inspector")),
      },
      // Who owns the vertical overflow (L22): each scroll region's own
      // overflow and its scroll extent, the roster list included.
      scrollOwners: [
        "#workbench-roster",
        ".dataset-roster-list",
        "#workbench-evidence",
        "#workbench-conversion",
        "#workbench-project",
        "#workbench-inspector",
      ].map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        return element === null || element.hidden || element.getClientRects().length === 0
          ? { selector, shown: false }
          : {
              selector,
              shown: true,
              overflowY: getComputedStyle(element).overflowY,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
            };
      }),
      outerScroll: {
        vertical: document.documentElement.scrollHeight - innerHeight,
        horizontal: document.documentElement.scrollWidth - innerWidth,
      },
      headerControls: [...(header?.querySelectorAll<HTMLElement>("button") ?? [])].map((button) => ({
        name: button.getAttribute("aria-label") ?? (button.textContent ?? "").trim(),
        context: button.getAttribute("data-shell-context"),
        ...rect(button),
      })),
      pathsOnScreen: (document.body.innerText.match(/[A-Za-z]:\\[^\s]+/gu) ?? []).length,
      external: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({
    label,
    kind: "Observation only. React/mock-IPC layout evidence over synthetic answers; not a golden and not an acceptance.",
    candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled",
    ...measured,
  });

  // Limits other specs already hold. No sideways scroll is recorded as a
  // floor, not as acceptance.
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  expect(measured.outerScroll.horizontal).toBeLessThanOrEqual(1);
  for (const control of measured.headerControls) {
    if (control.x === undefined || control.width === undefined) continue;
    expect(control.x).toBeGreaterThanOrEqual(0);
    expect(control.x + control.width).toBeLessThanOrEqual(measured.css.width + 1);
  }
  const line = measured.shellContext;
  for (const item of measured.contextItems) {
    // The design system's compact control minimum, which the draft claims.
    expect(item.height ?? 0).toBeGreaterThanOrEqual(31.5);
    // An operation's status is never cut behind a long name (PM9.2 L14–L16):
    // not ellipsized itself, and not pushed past the line, which clips.
    if (item.priority === "1" && line !== null) {
      expect(item.truncated).toBe(false);
      expect(item.ellipsized).toBe(false);
      expect(item.x ?? 0).toBeGreaterThanOrEqual(line.x - 1);
      expect((item.x ?? 0) + (item.width ?? 0)).toBeLessThanOrEqual(line.x + line.width + 1);
    }
  }
  // Rank decides who gives way first (L14–L16): an item shows an ellipsis
  // only once every lower-ranked item is down to its floor. Reported as the
  // pairs that break it, so a failure names them.
  const outOfOrder = measured.contextItems.flatMap((higher) =>
    higher.priority === "1" || !higher.ellipsized
      ? []
      : measured.contextItems
          .filter((lower) => Number(lower.priority) > Number(higher.priority) && (lower.width ?? 0) > lower.floor + 1)
          .map((lower) => `${label}: ${higher.id} ellipsized while ${lower.id} is ${String(lower.width)} px over a ${String(lower.floor)} px floor`),
  );
  expect(outOfOrder).toEqual([]);
  // The drop hint gives way before the context does (L14–L16): no item shows
  // an ellipsis while the hint still has width to give.
  if (measured.contextItems.some((item) => item.priority !== "1" && item.ellipsized)) {
    expect(measured.dropHint?.width ?? 0).toBeLessThanOrEqual(1);
  }
  // The header's second line stays one row (L14–L16): the context, the folded
  // backend reading and the drop hint all fit the bar's height, so nothing
  // has wrapped below them.
  if (measured.contextBar !== null) {
    const tallest = Math.max(
      ...[measured.dropHint, measured.backendToggle, ...measured.contextItems].map((box) => box?.height ?? 0),
    );
    expect(measured.contextBar.height).toBeLessThanOrEqual(tallest + 1);
  }
  // The document keeps no height of its own that the body cannot scroll: every
  // region owns its content's overflow (L22).
  expect(measured.outerScroll.vertical).toBeLessThanOrEqual(1);
  // Both observed states have a usable installation and nothing else to say,
  // so the notices track reserves no band (L10).
  expect(measured.workArea.notices?.height ?? 0).toBeLessThanOrEqual(1);
  expect(measured.backendToggle).not.toBe(null);
  return measured;
}

/**
 * A frame for a surface-level judgement (L1): its screenshot, the shown
 * surface's title and region name, and the primary actions on screen in it.
 * Recorded; the case decides what it asserts.
 */
async function surfaceFrame(label: string) {
  await settled(label);
  const measured = await browser.execute(() => {
    const main =
      ["#workbench-evidence", "#workbench-conversion", "#workbench-project"]
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find((element) => element !== null && !element.hidden) ?? null;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const title = main?.querySelector("h1.surface-title") ?? null;
    return {
      css: { width: innerWidth, height: innerHeight },
      surface: document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null,
      region: main?.id ?? null,
      regionName:
        main === null ? null : (document.getElementById(main.getAttribute("aria-labelledby") ?? "")?.textContent ?? null),
      title: title === null ? null : { text: title.textContent, ...box(title) },
      primaries: [...(main?.querySelectorAll<HTMLButtonElement>(".primary-button") ?? [])]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => ({ text: button.textContent, disabled: button.disabled, ...box(button) })),
      // The surface owns its own vertical overflow (L22).
      regionScroll:
        main === null
          ? null
          : { overflowY: getComputedStyle(main).overflowY, clientHeight: main.clientHeight, scrollHeight: main.scrollHeight },
      outerScroll: {
        vertical: document.documentElement.scrollHeight - innerHeight,
        horizontal: document.documentElement.scrollWidth - innerWidth,
      },
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({ label, kind: "Observation only.", candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled", ...measured });
  // The document keeps no height or width of its own; what does not fit the
  // surface is reached through the surface's own scroll (L22).
  expect(measured.outerScroll.vertical).toBeLessThanOrEqual(1);
  expect(measured.outerScroll.horizontal).toBeLessThanOrEqual(1);
  if (measured.regionScroll !== null && measured.regionScroll.scrollHeight > measured.regionScroll.clientHeight + 1) {
    expect(["auto", "scroll"]).toContain(measured.regionScroll.overflowY);
  }
  return measured;
}

/**
 * Tabs through the header once, from Home, and records what each stop looked
 * like. Home itself was focused by script, so its treatment is not sampled.
 */
async function keyboardSample(label: string, limit = 40) {
  await startAtHome();
  const stops: unknown[] = [];
  let entered = false;
  for (let step = 0; step < limit; step += 1) {
    await browser.keys("Tab");
    const at = await browser.execute(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active === null || active === document.body) return null;
      const box = active.getBoundingClientRect();
      return {
        inHeader: active.closest(".workbench-header") !== null,
        context: active.getAttribute("data-shell-context"),
        name: active.getAttribute("aria-label") ?? (active.textContent ?? "").trim(),
        refused: active.getAttribute("aria-disabled") === "true",
        inViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      };
    });
    if (at === null) continue;
    if (!at.inHeader) {
      if (entered) break;
      continue;
    }
    entered = true;
    stops.push({ ...at, treatment: await focusedTreatment() });
  }
  evidence.push({ label: `${label}-keyboard`, kind: "Observation only.", stops });
  return stops as { context: string | null; name: string; refused: boolean; treatment: { visible: boolean } }[];
}

// ---------------------------------------------------------------- cases

describe("PM9.1 browser baseline and the PM9.2 context line, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.1");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`PM9.1 browser evidence: ${output}`);
  });

  after(async () => {
    evidence.push({ console: await consoleEntries() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  afterEach(async function () {
    // CDP overrides outlive a test; the next one starts from no emulated media.
    await cdp("Emulation.setEmulatedMedia", { features: [] });
    await cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
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

  describe("functional (mock-backed)", () => {
    it("PM9-B1 names each fact from its owner, and every item only changes the surface", async () => {
      await metrics(1920, 1080);
      await open("populated");
      await viewTheRow();
      await selectTheSpectrum(0);
      await navigate([en.projectSurface]);
      await browser.$(`button[aria-label="${fill(en.provenanceInspectInput, { name: "QC_pool_01.mzML" })}"]`).click();
      await waitForContext("inspecting", (text) => text === fill(en.shellContextInspecting, { name: "QC_pool_01.mzML" }), "names the inspected reference");

      // Each item reads its owner: the project session, the viewer, the scope
      // the Conversion surface resolves, and what Details describes.
      expect(await contextText("project")).toBe(fill(en.shellContextProject, { name: "Test project" }));
      expect(await contextText("viewing")).toMatch(new RegExp(`^${prefix(en.shellContextViewing)}QC_pool_01\\.mzML`, "u"));
      // The scope bears on a conversion being set up, so the Project surface
      // leaves it out (PM9.2 L14–L16); the route below reaches it from the
      // Workbench, where it is shown.
      expect(await contextText("conversionScope")).toBe(null);
      expect(await contextText("conversionActivity")).toBe(null);
      expect(await contextText("projectActivity")).toBe(null);

      const before = await ipcCalls();
      const scopeBefore = await membership();
      const routes = [
        ["viewing", "workbench", en.workbench],
        ["conversionScope", "conversion", en.conversionTask],
        ["project", "project", en.projectSurface],
        ["viewing", "workbench", en.workbench],
        ["inspecting", "project", en.projectSurface],
      ] as const;
      for (const [id, target, destination] of routes) {
        await activate(id);
        expect(await surface()).toBe(target);
        expect(await currentDestination()).toBe(destination);
        // Page-sensitive, not owner-sensitive: where the scope bears on the
        // task, the line states the one the Conversion surface resolves; on
        // the Project surface it is absent. Either way, hiding it changes
        // nothing it is made of.
        if (target === "project") {
          expect(await contextText("conversionScope")).toBe(null);
        } else {
          const owned = await ownedScope();
          expect(owned).not.toBe(null);
          expect(await contextText("conversionScope")).toBe(owned);
        }
        expect(await membership()).toEqual(scopeBefore);
      }
      // Still the same inspected record, where Details describes it.
      expect(await browser.$('#workbench-inspector [data-provenance="input"]').isDisplayed()).toBe(true);

      // Home, then an item by keyboard: real focus, a real Enter.
      await home();
      expect(await surface()).toBe("workbench");
      expect(await tabTo("project")).toBe(true);
      await browser.keys("Enter");
      expect(await surface()).toBe("project");
      const ring = await focusedTreatment();
      evidence.push({ label: "pm9-b1-context-focus", ...ring });
      expect(ring.visible).toBe(true);

      // Nothing was imported, run, captured, saved, exported, retried or
      // cancelled, and no source or stored result was read again. Documented
      // read-only reads are recorded, not failed.
      expect(await unexpectedSince("pm9-b1", before)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B2 keeps the roster, the viewed scan and the committed m/z view across surfaces", async () => {
      await metrics(1920, 1080);
      await open("populated");
      await viewTheRow();
      // A session-only change of the reader's own: one more row for conversion.
      await browser.$(`.grouped-roster [data-handle="${secondFile.handle}"] input[type="checkbox"]`).click();
      await selectTheSpectrum(0);
      await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
      await browser.$(`button=${en.viewerMzZoomIn}`).click();
      await browser.waitUntil(async () => !(await spectrumRangeCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "Zoom in m/z did not commit a narrower view",
      });
      await frames();

      const held = async () => ({
        roster: await rosterState(),
        scan: await selectedRowPosition(),
        view: await spectrumRangeCaption(),
        viewing: await contextText("viewing"),
        scope: await contextText("conversionScope"),
      });
      const before = await held();
      const calls = await ipcCalls();

      await activate("conversionScope");
      expect(await surface()).toBe("conversion");
      await navigate([en.projectSurface]);
      expect(await surface()).toBe("project");
      await activate("viewing");
      expect(await surface()).toBe("workbench");

      // Navigation changed what is shown, not what is held.
      expect(await held()).toEqual(before);
      expect(await unexpectedSince("pm9-b2", calls)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B3 keeps a targeted setup draft through a trip to the Workbench", async () => {
      await metrics(1920, 1080);
      await open("projectWithResult");
      await navigate([en.projectSurface]);
      await browser.execute((layer: string) => {
        document.querySelector<HTMLElement>(`[data-project-targeted="${layer}"]`)?.focus();
      }, TARGETED_LAYER);
      await browser.keys("Enter");
      await browser.$("[data-targeted-text]").waitForDisplayed();
      // Comma-separated, as M9.1 types it: WebDriver sends a tab as the Tab key.
      const typed = "Caffeine, C8H10N4O2, 120, 30";
      await browser.$("[data-targeted-text]").setValue(typed);
      await frames();
      const calls = await ipcCalls();

      await home();
      expect(await surface()).toBe("workbench");
      await activate("project");
      expect(await surface()).toBe("project");

      expect(await browser.$("[data-targeted-text]").getValue()).toBe(typed);
      // A draft is text on the page: no review was asked for and nothing ran.
      expect(await unexpectedSince("pm9-b3", calls)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    /**
     * Each stored-result state and the words the report's state block (M9.1's
     * `[data-targeted-state]`) says for it: the payload, whether the source was
     * found where recorded, and, where the case is about it, whether new runs
     * are possible. Kept apart so a missing source or runtime never reads as a
     * damaged payload, or the other way round.
     */
    const STORED: readonly {
      readonly name: Scenario;
      readonly availability: Availability;
      readonly payload: string;
      readonly sourceMissing: boolean;
      readonly runtime: string | null;
    }[] = [
      { name: "projectWithResult", availability: "available", payload: en.targetedStatePayloadWhole, sourceMissing: false, runtime: en.targetedNewRunsAvailable },
      { name: "resultPayloadMissing", availability: "payloadMissing", payload: en.targetedStatePayloadMissing, sourceMissing: false, runtime: null },
      { name: "resultPayloadCorrupt", availability: "payloadCorrupt", payload: en.targetedStatePayloadCorrupt, sourceMissing: false, runtime: null },
      { name: "resultSourceAndRuntimeUnavailable", availability: "available", payload: en.targetedStatePayloadWhole, sourceMissing: true, runtime: en.targetedNewRunsRuntimeUnavailable },
    ];
    const stateText = () =>
      browser.execute(
        () => (document.querySelector("[data-targeted-state]") as HTMLElement | null)?.innerText ?? "",
      ) as Promise<string>;
    for (const { name, availability, payload, sourceMissing, runtime } of STORED) {
      it(`PM9-B4 reads the stored result in ${name} from its own record, and routes back to it`, async () => {
        await metrics(1920, 1080);
        await open(name);
        await navigate([en.projectSurface]);
        await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
        await browser.$(`[data-targeted-report="${RESULT}"]`).waitForDisplayed();
        expect(await browser.$(`[data-targeted-report="${RESULT}"]`).getAttribute("data-availability")).toBe(availability);
        if (availability === "available") await browser.$("[data-targeted-row]").waitForDisplayed();
        await frames();

        // The report states each fact separately, as the owners hold it.
        await browser.waitUntil(async () => (await stateText()).includes(payload), {
          timeout: 15_000,
          timeoutMsg: `the state block never said "${payload}"`,
        });
        if (runtime !== null) {
          await browser.waitUntil(async () => (await stateText()).includes(runtime), {
            timeout: 15_000,
            timeoutMsg: `the state block never said "${runtime}"`,
          });
        }
        expect((await stateText()).includes(en.projectStateMissing)).toBe(sourceMissing);
        // A payload that is missing or damaged is not read (M9.1).
        if (availability !== "available") {
          expect((await ipcCalls()).some((call) => call.command === "read_targeted_ms1_rows")).toBe(false);
        }

        // The line names the record; how available its payload is stays the
        // report's to say, so the sentence is the same in every state.
        await waitForContext(
          "inspecting",
          (text) => text === fill(en.shellContextInspecting, { name: en.projectArtifactTargetedMs1 }),
          "names the stored result",
        );
        // Lineage stays the record's own: its producing run and its plan.
        expect(await browser.$(`#workbench-inspector [data-provenance-link="${TARGETED_RUN}"]`).isExisting()).toBe(true);
        expect(await browser.$("#workbench-inspector").getText()).toContain(PLAN_SHA);

        const calls = await ipcCalls();
        await home();
        expect(await surface()).toBe("workbench");
        await activate("inspecting");
        expect(await surface()).toBe("project");
        expect(await browser.$(`[data-targeted-report="${RESULT}"]`).getAttribute("data-availability")).toBe(availability);

        // No run, review, check, admission or re-read of the stored rows.
        expect(await unexpectedSince(`pm9-b4-${name}`, calls)).toEqual([]);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("PM9-B5 shows a QC capture while it runs, clears it when it settles, and routes to the report", async () => {
      await metrics(1920, 1080);
      await open("qcCapture");
      await viewTheRow();
      await navigate([en.projectSurface]);
      const control = `[data-project-capture-qc="${QC_LAYER}"]`;
      await browser.$(`${control}:not([aria-disabled])`).waitForDisplayed();

      await holdInvoke("capture_project_qc_summary");
      await browser.execute((selector: string) => {
        document.querySelector<HTMLElement>(selector)?.focus();
      }, control);
      await browser.keys("Enter");
      const recording = fill(en.shellContextActivity, { activity: en.projectBusyRecordingQc });
      await waitForContext("projectActivity", (text) => text === recording, "says the capture is under way");
      expect(await browser.$("[data-project-work-dot]").isExisting()).toBe(true);

      // Away and back while it runs: the same words, and nothing new asked.
      const calls = await ipcCalls();
      await home();
      expect(await contextText("projectActivity")).toBe(recording);
      await activate("projectActivity");
      expect(await surface()).toBe("project");
      expect(await unexpectedSince("pm9-b5-while-held", calls)).toEqual([]);

      await releaseInvokeHold("capture_project_qc_summary");
      await waitForContext("projectActivity", (text) => text === null, "leaves no busy label once settled");
      expect(await browser.$("[data-project-work-dot]").isExisting()).toBe(false);
      // The capture moved what is inspected to the record it made, as
      // `useProject` `captureQc` does when nothing else was chosen meanwhile.
      await waitForContext(
        "inspecting",
        (text) => text === fill(en.shellContextInspecting, { name: en.projectArtifactQcSummary }),
        "names the new QC record",
      );

      await home();
      await activate("inspecting");
      expect(await surface()).toBe("project");
      await browser.$(`[data-qc-report="${QC_ARTIFACT}"]`).waitForDisplayed();
      expect(await browser.$('#workbench-inspector [data-provenance="artifact"]').isDisplayed()).toBe(true);
      // A description, not a verdict (M8.5).
      expect((await browser.$(`[data-qc-report="${QC_ARTIFACT}"]`).getText()).toLowerCase()).not.toMatch(
        /\b(pass|fail|good|poor|grade|score)\b/u,
      );
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B6 follows a running conversion to its end without a stale busy label", async () => {
      await metrics(1920, 1080);
      await open("converting");
      const running = fill(en.shellContextActivity, { activity: en.shellConversionRunning });
      await waitForContext("conversionActivity", (text) => text === running, "says the conversion runs");
      expect(
        await browser.$(".workbench-navigation .work-status-dot").getAttribute("aria-label"),
      ).toBe(en.workActive);

      // Away and back while it runs: the lane keeps polling its slot, and that
      // read is the only request.
      const poll = "get_workspace_conversion_state";
      const calls = await ipcCalls();
      await activate("conversionActivity");
      expect(await surface()).toBe("conversion");
      expect(await browser.$(".conversion-running").isExisting()).toBe(true);
      await navigate([en.projectSurface]);
      await activate("conversionActivity");
      expect(await surface()).toBe("conversion");
      expect(await unexpectedSince("pm9-b6-while-running", calls)).toEqual([]);

      // Rust settles the queue, and the transition is the fixture's to give:
      // the lane's next slot read is parked, the answer changed, then released.
      // The wait is for that read to arrive, not for a length of time.
      await holdInvoke(poll);
      await setInvokeResult(poll, conversionSlot(2, SETTLED));
      await browser.waitUntil(async () => (await heldCallers(poll)) > 0, {
        timeout: 15_000,
        timeoutMsg: "the lane never read its slot again while the queue ran",
      });
      // Nothing has been answered yet, so nothing may have moved.
      expect(await contextText("conversionActivity")).toBe(running);
      await releaseInvokeHold(poll);
      await waitForContext("conversionActivity", (text) => text === en.shellConversionRetained, "reports the settled queue");
      expect(await browser.$(".workbench-navigation .work-status-dot").getAttribute("aria-label")).toBe(en.workRetained);
      expect(
        await browser.execute(
          (busy: string) =>
            [...document.querySelectorAll("[data-shell-context]")].some((item) =>
              (item.textContent ?? "").startsWith(busy),
            ),
          prefix(en.shellContextActivity),
        ),
      ).toBe(false);
      // Recorded: what settling asked for. The lane's own reads may follow.
      await unexpectedSince("pm9-b6-settled", calls);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B7 settles a check without a stale label, and a replaced project leaves nothing inspected", async () => {
      await metrics(1920, 1080);
      await open("populated");
      await viewTheRow();
      const viewing = await contextText("viewing");
      await navigate([en.projectSurface]);
      await browser.$(`button[aria-label="${fill(en.provenanceInspectInput, { name: "QC_pool_01.mzML" })}"]`).click();
      const inspected = fill(en.shellContextInspecting, { name: "QC_pool_01.mzML" });
      await waitForContext("inspecting", (text) => text === inspected, "names the inspected reference");

      // A check, held, so its running state can be looked at from elsewhere.
      await holdInvoke("check_project_links");
      await browser.$("[data-project-check]").click();
      const checking = fill(en.shellContextActivity, { activity: en.projectBusyChecking });
      await waitForContext("projectActivity", (text) => text === checking, "says the check runs");
      expect(await browser.$("[data-project-cancel]").getAttribute("data-project-cancel")).toBe("project-job-1");

      const calls = await ipcCalls();
      await home();
      expect(await contextText("projectActivity")).toBe(checking);
      await activate("projectActivity");
      expect(await surface()).toBe("project");
      // The live operation is the one that was accepted, not a new one.
      expect(await browser.$("[data-project-cancel]").getAttribute("data-project-cancel")).toBe("project-job-1");
      expect(await unexpectedSince("pm9-b7-while-held", calls)).toEqual([]);

      await setInvokeResult(
        "check_project_links",
        capturedProject({
          inputs: [{ ...(capturedProject().inputs[0] as object), verification: "matchingRecordedContent" }],
        }),
      );
      await releaseInvokeHold("check_project_links");
      await waitForContext("projectActivity", (text) => text === null, "leaves no busy label once settled");
      expect(await browser.$("[data-project-work-dot]").isExisting()).toBe(false);
      expect(await contextText("inspecting")).toBe(inspected);

      // Replaced through the real buttons: Close, then Open.
      await setInvokeResult("close_project", NO_PROJECT);
      await setInvokeResult(
        "open_project",
        capturedProject({ projectId: "aaaaaaaa-0000-4111-8111-000000000002", name: "Pooled QC study" }),
      );
      const beforeReplace = await ipcCalls();
      await browser.$(`button=${en.projectClose}`).click();
      await waitForContext("project", (text) => text === en.shellContextProjectNone, "says no project is open");
      expect(await contextText("inspecting")).toBe(null);
      await browser.$(`button=${en.projectOpen}`).click();
      await waitForContext(
        "project",
        (text) => text === fill(en.shellContextProject, { name: "Pooled QC study" }),
        "names the project that replaced it",
      );
      // What was inspected belonged to the project before; the new one starts
      // with nothing inspected, even with the same identifiers inside it.
      expect(await contextText("inspecting")).toBe(null);
      // The viewer is its own owner: a project change leaves the viewed row alone.
      expect(await contextText("viewing")).toBe(viewing);
      // The two explicit replacements, and nothing else that starts or re-reads.
      expect(await unexpectedSince("pm9-b7-replace", beforeReplace)).toEqual(["close_project", "open_project"]);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("observation (geometry recorded; PM9.2 limits asserted, the rest not accepted)", () => {
    const VIEWPORTS = [
      [1920, 1080],
      [1366, 768],
      [960, 640],
    ] as const;
    const STATES = [
      ["idle", "en"],
      ["idle", "zh-CN"],
      ["busyInspected", "en"],
      ["busyInspected", "zh-CN"],
    ] as const;

    for (const [state, locale] of STATES) {
      it(`PM9-G ${state} in ${locale} at 1920x1080, 1366x768 and 960x640`, async () => {
        await metrics(1920, 1080);
        // Reduced motion is sampled in the Chinese runs only; the rest keep the default.
        if (locale === "zh-CN") {
          await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        }
        if (state === "idle") {
          await open("populated", locale);
          await viewTheRow();
          await selectTheSpectrum(0);
        } else {
          await open("busyInspected", locale);
          await navigate([en.projectSurface, zh.projectSurface]);
          await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
          await browser.$("[data-targeted-row]").waitForDisplayed();
        }
        const expectedLang = locale;

        // One setup, then the window narrows: the owners hold their state and
        // the panels fold for space as they would for a reader resizing.
        for (const [width, height] of VIEWPORTS) {
          await metrics(width, height);
          await frames();
          const label = `pm9-g-${state}-${locale}-${String(width)}x${String(height)}`;
          const measured = await observe(label);
          expect(measured.lang).toBe(expectedLang);
          const stops = await keyboardSample(label);
          // Keyboard access where the line exists: every item is a Tab stop
          // and shows where focus is.
          for (const item of measured.contextItems) {
            const stop = stops.find((candidate) => candidate.context === item.id);
            expect(stop).toBeDefined();
            expect(stop?.treatment.visible).toBe(true);
          }
          // The Details entry is a stop, with a visible ring, at every width
          // and whether or not there is anything to show (PM9.2 L20).
          const details = stops.find((candidate) => candidate.name === (locale === "en" ? en : zh).inspectorToggle);
          expect(details).toBeDefined();
          expect(details?.treatment.visible).toBe(true);
        }
        // motion's development build warns once per animation that reduced
        // motion is on. This test turned it on, so that one notice is expected
        // in the zh-CN runs and nothing else is.
        expect(
          (await unexpectedConsole()).filter(
            (entry) => !(locale === "zh-CN" && entry.includes(REDUCED_MOTION_NOTICE)),
          ),
        ).toEqual([]);
      });
    }

    it("PM9.2 L20: the Details entry at 1366x768 while there is nothing to show", async () => {
      // Both G states have something to show. This is the state L20 is about:
      // closed by default at this width, refused, and still a stop that shows
      // where focus is.
      await metrics(1366, 768);
      await open("populated", "en");
      // The usable reading folds the banner; observe() expects it folded.
      await browser.$("[data-backend-toggle]").waitForExist();
      await frames();
      const label = "pm9-2-details-refused-en-1366x768";
      await observe(label);
      const stops = await keyboardSample(label);
      const details = stops.find((candidate) => candidate.name === en.inspectorToggle);
      expect(details).toBeDefined();
      expect(details?.refused).toBe(true);
      expect(details?.treatment.visible).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.2 L14–L16: the Workbench line with long names while a conversion runs, in ${locale}`, async () => {
        // PM9-G's busy state is observed on the Project surface. Here the same
        // long names are on the Workbench, where the inspected result ranks
        // last and gives way first.
        await metrics(1920, 1080);
        await open("busyInspected", locale);
        await navigate([en.projectSurface, zh.projectSurface]);
        await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
        await browser.$("[data-targeted-row]").waitForDisplayed();
        await navigate([en.workbench, zh.workbench]);
        await browser.waitUntil(async () => (await surface()) === "workbench");
        for (const [width, height] of [
          [1920, 1080],
          [1366, 768],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          const measured = await observe(`pm9-2-workbench-long-${locale}-${String(width)}x${String(height)}`);
          expect(measured.surface).toBe("workbench");
          expect(measured.contextItems.map((item) => item.id)).toContain("inspecting");
          // Given way, the scope still says what it is (PM9.2 L14–L16 (e)):
          // its distinctive word leads, so what survives the ellipsis is it.
          const scope = measured.contextItems.find((item) => item.id === "conversionScope");
          expect(scope?.visible.startsWith(locale === "en" ? "Conv" : "待转")).toBe(true);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.2 L1: each surface's title, and a primary action only where one is owned, in ${locale}`, async () => {
        const words = locale === "en" ? en : zh;
        await metrics(1366, 768);
        await open("populated", locale);
        await browser.$("[data-backend-toggle]").waitForExist();
        for (const [target, name] of [
          ["workbench", words.workbench],
          ["conversion", words.conversionTask],
          ["project", words.projectSurface],
        ] as const) {
          await navigate([name]);
          await browser.waitUntil(async () => (await surface()) === target);
          await frames();
          const seen = await surfaceFrame(`pm9-2-l1-${target}-${locale}-1366x768`);
          // The surface says what it is, in the navigation's words, on screen.
          expect(seen.title?.text).toBe(name);
          expect(seen.regionName).toBe(name);
          expect(seen.title?.y ?? -1).toBeGreaterThanOrEqual(0);
          expect((seen.title?.y ?? 0) + (seen.title?.height ?? 0)).toBeLessThanOrEqual(seen.css.height);
          // Nothing read and nothing retained: the evidence surface invents none.
          if (target === "workbench") expect(seen.primaries).toEqual([]);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.2 L1: the retained acquisition's reopen is the evidence surface's one primary action, in ${locale}`, async () => {
        const words = locale === "en" ? en : zh;
        await metrics(1366, 768);
        await open("populated", locale);
        await viewTheRow();
        // A different installation, chosen: its readings replace the old one's,
        // and the acquisition stays one press from being read again (WF-001).
        await setInvokeResult("choose_backend_installation", chosenBackend);
        await showBackendBanner();
        await browser.$('[data-backend-action="choose"]').click();
        const reopen = browser.$("#workbench-evidence .primary-button");
        await reopen.waitForDisplayed({ timeoutMsg: "no reopen action after the installation changed" });
        await frames();
        const seen = await surfaceFrame(`pm9-2-l1-retained-${locale}-1366x768`);
        expect(seen.primaries.map((primary) => primary.text)).toEqual([
          expect.stringMatching(new RegExp(`^${prefix(words.previewRetained)}QC_pool_01\\.mzML`, "u")),
        ]);
        expect(seen.primaries[0]?.disabled).toBe(false);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("PM9.2 L10: the folded reading's toggle hands the keyboard to the banner when it has something to say", async () => {
      await metrics(1366, 768);
      await open("populated", "en");
      // Queried afresh each time: the toggle leaves, and a new one returns.
      const toggle = () => browser.$("[data-backend-toggle]");
      await toggle().waitForExist();
      // Opened by a real press, which leaves the keyboard on the toggle.
      await toggle().click();
      expect(await browser.execute(() => document.activeElement?.hasAttribute("data-backend-toggle") ?? false)).toBe(true);
      // A check the reader did not start from the toggle: pressed by script,
      // so the keyboard stays where it was, and held so the state can be read.
      await holdInvoke("inspect_backend");
      await browser.execute(() => document.querySelector<HTMLButtonElement>('[data-backend-action="recheck"]')?.click());
      await browser.waitUntil(async () => !(await toggle().isExisting()), { timeoutMsg: "the toggle stayed while checking" });
      expect(await browser.execute(() => document.activeElement?.id ?? null)).toBe("backend-status");
      await releaseInvokeHold("inspect_backend");
      await browser.waitUntil(async () => await toggle().isExisting(), { timeoutMsg: "no quiet verdict" });
      // Engaged: the banner stays open under the reader, and so does the keyboard.
      expect(await browser.execute(() => document.activeElement?.id ?? null)).toBe("backend-status");
      expect(await toggle().getAttribute("aria-expanded")).toBe("true");
      expect(await browser.$("#backend-status").getAttribute("data-backend-collapsed")).toBe(null);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  /*
   * The known UI/UX rework (baseline §12, 2026-09-28). Each case names the
   * frozen item it exercises. Written before the rework and run on its
   * starting candidate first, so the before-and-after is the same case.
   */
  describe("PM9 known UI/UX rework (baseline §12)", () => {
    const LONG_FILE = `${"Plasma_QC_batch_08_".repeat(7)}replicate_04.mzML`;
    const LONG_PROJECT = `${"Plasma_QC_batch_08_".repeat(4)}study`;
    const words = (locale: Locale) => (locale === "en" ? en : zh);

    async function openTable(table: Record<string, unknown>, options: { readonly hold?: readonly string[] } = {}) {
      await installIpcBoundary(table, options);
      await browser.url("/");
      await browser.$(".workbench-header").waitForDisplayed();
    }

    /**
     * The banner's sentences that `text` repeats, and "ProteoWizard" when it
     * names the installation the banner already speaks for (UI-09).
     */
    function restatesBanner(text: string) {
      return browser.execute((evidence: string) => {
        const said = [...document.querySelectorAll<HTMLElement>("#backend-status .backend-status-reading > *")]
          .map((node) => (node.textContent ?? "").trim())
          .filter((sentence) => sentence.length > 0 && evidence.includes(sentence));
        return /ProteoWizard/u.test(evidence) ? [...said, "ProteoWizard"] : said;
      }, text);
    }

    /**
     * Real Tab presses from wherever focus is: each stop's name and whether it
     * is visible, on screen and not covered, and the document's own overflow
     * after the walk. With `scope`, the walk ends once focus leaves it.
     */
    async function focusWalk(label: string, limit: number, scope?: string) {
      const stops = [];
      for (let step = 0; step < limit; step += 1) {
        await browser.keys("Tab");
        const at = await browser.execute((region: string | null) => {
          const active = document.activeElement as HTMLElement | null;
          if (active === null || active === document.body) return null;
          if (region !== null && active.closest(region) === null) return "left" as const;
          const box = active.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 8));
          return {
            name: (active.getAttribute("aria-label") ?? active.textContent ?? active.tagName).trim().slice(0, 40),
            onScreen: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
            uncovered: hit === null || active === hit || active.contains(hit) || hit.contains(active),
          };
        }, scope ?? null);
        if (at === "left") break;
        if (at !== null) stops.push({ ...at, treatment: await focusedTreatment() });
      }
      const overflow = await browser.execute(() => ({
        x: document.documentElement.scrollWidth - innerWidth,
        y: document.documentElement.scrollHeight - innerHeight,
      }));
      evidence.push({ label, stops, overflow });
      expect(stops.length).toBeGreaterThan(0);
      expect(stops.filter((stop) => !stop.treatment.visible || !stop.onScreen || !stop.uncovered)).toEqual([]);
      expect(overflow.x).toBeLessThanOrEqual(1);
      expect(overflow.y).toBeLessThanOrEqual(1);
    }

    /** Puts focus on the first focusable control inside `css`. */
    function enter(css: string) {
      return browser.execute((selector: string) => {
        const first = document
          .querySelector(selector)
          ?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, summary, [tabindex]:not([tabindex="-1"])');
        first?.focus();
        return first !== null && first !== undefined;
      }, css);
    }

    /** The drop hint as the line leaves it: shown whole, shown cut, or gone. */
    function dropHintState() {
      return browser.execute(() => {
        const hint = document.querySelector<HTMLElement>(".workbench-header .workspace-drop-hint");
        if (hint === null || hint.getClientRects().length === 0 || hint.getBoundingClientRect().width < 1) return "gone";
        return hint.scrollWidth > hint.clientWidth + 1 ? "cut" : "whole";
      }) as Promise<"gone" | "cut" | "whole">;
    }

    /** Lines a text box takes, and any number-and-word pair split across two. */
    function textShape(css: string) {
      return browser.execute((selector: string) => {
        const node = document.querySelector(selector);
        if (node === null || node.getClientRects().length === 0) return null;
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines = new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
        const split: string[] = [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
          for (const match of (text.textContent ?? "").matchAll(/\d+[\s ]+[^\s ·]+/gu)) {
            const pair = document.createRange();
            pair.setStart(text, match.index ?? 0);
            pair.setEnd(text, (match.index ?? 0) + match[0].length);
            if (new Set([...pair.getClientRects()].map((box) => Math.round(box.top))).size > 1) split.push(match[0]);
          }
        }
        return { text: node.textContent, lines, split, top: node.getBoundingClientRect().top };
      }, css);
    }

    for (const locale of ["en", "zh-CN"] as const) {
      it(`UI-02/03/05/48: the context line gives way in order, with a long viewed file and an unsaved long project, in ${locale}`, async () => {
        const table = scenario("populated", locale);
        const roster = table["get_workspace_roster"] as { datasets: Record<string, unknown>[] };
        table["get_workspace_roster"] = { ...roster, datasets: [{ ...roster.datasets[0], fileName: LONG_FILE }, ...roster.datasets.slice(1)] };
        table["get_project_state"] = capturedProject({ name: LONG_PROJECT, dirty: true });
        await metrics(1920, 1080);
        await openTable(table);
        await viewTheRow();
        await selectTheSpectrum(0);
        const shapes = [];
        for (const [width, height] of [
          [1920, 1080],
          [1366, 768],
          [1280, 720],
          [1152, 720],
          [1051, 768],
          [1050, 768],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          const label = `ui-rework-line-${locale}-${String(width)}x${String(height)}`;
          const measured = await observe(label);
          const hint = await dropHintState();
          shapes.push({ label, hint, items: measured.contextItems.map((item) => ({ id: item.id, ellipsized: item.ellipsized, visible: item.visible })) });
          // UI-02: the hint is whole or gone, never a sliver.
          expect(hint).not.toBe("cut");
          // UI-03: at any width the project item says it is unsaved.
          const project = measured.contextItems.find((item) => item.id === "project");
          expect(project?.visible ?? "").toMatch(locale === "en" ? /unsaved/iu : /未保存/u);
          // UI-05: the viewed file, given way, still says what it is.
          const viewing = measured.contextItems.find((item) => item.id === "viewing");
          expect(viewing?.visible.startsWith(locale === "en" ? "View" : "正在查")).toBe(true);
        }
        evidence.push({ label: `ui-rework-line-${locale}`, shapes });
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`UI-04: two statuses at once, a conversion running and a project check, in ${locale}`, async () => {
        await metrics(1920, 1080);
        await open("busyInspected", locale);
        await navigate([en.projectSurface, zh.projectSurface]);
        await holdInvoke("check_project_links");
        await browser.$("[data-project-check]").click();
        await waitForContext("projectActivity", (text) => text !== null, "shows the check");
        await waitForContext("conversionActivity", (text) => text !== null, "shows the conversion");
        await home();
        for (const [width, height] of [
          [1366, 768],
          [1152, 720],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          const measured = await observe(`ui-rework-two-statuses-${locale}-${String(width)}x${String(height)}`);
          // observe() holds both statuses whole and inside the line; here both are there.
          expect(measured.contextItems.filter((item) => item.priority === "1").map((item) => item.id)).toEqual([
            "conversionActivity",
            "projectActivity",
          ]);
          const stops = await keyboardSample(`ui-rework-two-statuses-${locale}-${String(width)}x${String(height)}`);
          for (const item of measured.contextItems) {
            expect(stops.find((stop) => stop.context === item.id)?.treatment.visible).toBe(true);
          }
        }
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`UI-15/16/17: the organizing row keeps the count whole, with and without Undo, in ${locale}`, async () => {
        await metrics(1366, 768);
        await open("populated", locale);
        await browser.$(".roster-selection-context").waitForDisplayed();
        const shapes: unknown[] = [];
        const record = async (label: string) => {
          await frames();
          const count = await textShape(".roster-selection-context");
          const newGroup = await browser.$(".organization-toolbar button").getLocation("y");
          const band = await browser.$(".organization-toolbar").getSize("height");
          shapes.push({ label, count, newGroupTop: newGroup, band });
          expect(count?.lines).toBe(1);
          expect(count?.split).toEqual([]);
        };
        await record(`ui-rework-organizing-${locale}-1366x768`);
        // UI-16: made narrower than the count, as long counts make it, the
        // count breaks only between its parts, never inside one.
        const narrowCount = (width: string) =>
          browser.execute((value: string) => {
            document.querySelector<HTMLElement>(".roster-selection-context")!.style.maxWidth = value;
          }, width);
        await narrowCount("7em");
        await frames();
        const narrow = await textShape(".roster-selection-context");
        await narrowCount("");
        shapes.push({ label: `ui-rework-organizing-${locale}-forced-narrow`, narrow });
        expect(narrow?.lines).toBeGreaterThan(1);
        expect(narrow?.split).toEqual([]);
        await browser.$(".organization-toolbar button").click();
        await browser.$("#organization-group-name").setValue("QC");
        await browser.$(".group-name-dialog button[type='submit']").click();
        await browser.$(".group-name-dialog").waitForExist({ reverse: true });
        await browser.$(".organization-toolbar .link-button").waitForDisplayed();
        await record(`ui-rework-organizing-undo-${locale}-1366x768`);
        await metrics(960, 640);
        await revealRosterRow(MZML_ROW.handle);
        await record(`ui-rework-organizing-undo-${locale}-960x640`);
        evidence.push({ label: `ui-rework-organizing-${locale}`, shapes });
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`UI-19: the retained state offers one filled primary action, in ${locale}`, async () => {
        await metrics(1366, 768);
        await open("populated", locale);
        await viewTheRow();
        await setInvokeResult("choose_backend_installation", chosenBackend);
        await showBackendBanner();
        await browser.$('[data-backend-action="choose"]').click();
        await browser.$("#workbench-evidence .primary-button").waitForDisplayed();
        await frames();
        const primaries = await browser.execute(() =>
          [...document.querySelectorAll<HTMLElement>(".workbench-shell .primary-button")]
            .filter((button) => button.getClientRects().length > 0)
            .map((button) => (button.textContent ?? "").trim()),
        );
        evidence.push({ label: `ui-rework-retained-${locale}`, primaries });
        expect(primaries).toEqual([expect.stringMatching(new RegExp(`^${prefix(words(locale).previewRetained)}`, "u"))]);
        // Add files stays offered, only quieter.
        expect(await browser.$(".dataset-roster-actions [data-add-files]").isEnabled()).toBe(true);
        // At 960x640 the roster takes the evidence pane's place, the reopen is
        // off screen, and Add files is the one filled action again.
        await metrics(960, 640);
        await revealRosterRow(MZML_ROW.handle);
        const narrow = await browser.execute(() =>
          [...document.querySelectorAll<HTMLElement>(".workbench-shell .primary-button")]
            .filter((button) => button.getClientRects().length > 0)
            .map((button) => (button.hasAttribute("data-add-files") ? "add-files" : (button.textContent ?? "").trim())),
        );
        evidence.push({ label: `ui-rework-retained-${locale}-960x640`, primaries: narrow });
        expect(narrow).toEqual(["add-files"]);
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`UI-24: a refused Capture file facts looks refused and says why, in ${locale}`, async () => {
        await metrics(1366, 768);
        await open("populated", locale);
        await navigate([en.projectSurface, zh.projectSurface]);
        const capture = browser.$("[data-project-capture]");
        await capture.waitForDisplayed();
        expect(await capture.getAttribute("aria-disabled")).toBe("true");
        const seen = await browser.execute(() => {
          const button = document.querySelector<HTMLElement>("[data-project-capture]")!;
          const enabled = document.querySelector<HTMLElement>(".dataset-roster-actions [data-add-files]");
          const reason = (button.getAttribute("aria-describedby") ?? "")
            .split(/\s+/u)
            .map((id) => document.getElementById(id))
            .filter((node): node is HTMLElement => node !== null && node.getClientRects().length > 0)
            .map((node) => node.textContent ?? "")
            .join(" ");
          const style = getComputedStyle(button);
          return {
            opacity: Number(style.opacity),
            background: style.backgroundColor,
            enabledBackground: enabled === null ? null : getComputedStyle(enabled).backgroundColor,
            reason,
          };
        });
        evidence.push({ label: `ui-rework-capture-${locale}`, ...seen });
        expect(seen.opacity < 0.9 || seen.background !== seen.enabledBackground).toBe(true);
        expect(seen.reason).toContain(words(locale).projectCaptureNeedsSelection);
        await browser.execute(() => document.querySelector<HTMLElement>("[data-project-check]")?.focus());
        await browser.keys("Tab");
        expect(await browser.execute(() => document.activeElement?.hasAttribute("data-project-capture") ?? false)).toBe(true);
        expect((await focusedTreatment()).visible).toBe(true);
        await surfaceFrame(`ui-rework-capture-${locale}-1366x768`);
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`UI-09/10: the first run with no installation says the backend once, truthfully, in ${locale}`, async () => {
        const table = scenario("populated", locale);
        table["inspect_backend"] = unavailableBackend;
        table["get_workspace_roster"] = EMPTY_ROSTER;
        table["get_project_state"] = NO_PROJECT;
        await metrics(1920, 1080);
        await openTable(table);
        await browser.$('[data-backend-status="missing"]').waitForExist();
        for (const [width, height] of [
          [1920, 1080],
          [1366, 768],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          const seen = await surfaceFrame(`ui-rework-empty-${locale}-${String(width)}x${String(height)}`);
          const text = await browser.execute(
            () => document.querySelector("#workbench-evidence .workspace-placeholder .empty-state")?.textContent ?? "",
          );
          evidence.push({ label: `ui-rework-empty-copy-${locale}-${String(width)}`, text, primaries: seen.primaries });
          expect(await restatesBanner(text)).toEqual([]);
          expect(seen.primaries).toEqual([]);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });

      for (const [kind, reading] of [
        ["unsupported", chosenFolderWithoutTools],
        ["quarantined", quarantinedBackend],
      ] as const) {
        it(`UI-09: an ${kind} installation is not told to install ProteoWizard, in ${locale}`, async () => {
          const table = scenario("populated", locale);
          table["inspect_backend"] = reading;
          await metrics(1366, 768);
          await openTable(table);
          await browser.$(`[data-backend-status="${kind}"]`).waitForExist();
          await frames();
          await surfaceFrame(`ui-rework-${kind}-${locale}-1366x768`);
          const text = await browser.execute(
            () => document.querySelector("#workbench-evidence .workspace-placeholder .empty-state")?.textContent ?? "",
          );
          expect(await restatesBanner(text)).toEqual([]);
          expect(await unexpectedConsole()).toEqual([]);
        });
      }

      it(`UI-06: a superseded reading stays on screen with its actions, in ${locale}`, async () => {
        await metrics(1366, 768);
        await open("converting", locale);
        await setInvokeResult("inspect_backend", { ...availableBackend, authority: settledAt(2, 2) });
        await setInvokeResult("get_workspace_conversion_state", { ...conversionSlot(1, RUNNING), authority: settledAt(2, 2) });
        await browser.$('[data-backend-reading="superseded"]').waitForExist({ timeout: 30_000 });
        for (const [width, height] of [
          [1366, 768],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          await surfaceFrame(`ui-rework-superseded-${locale}-${String(width)}x${String(height)}`);
          const seen = await browser.execute(() => ({
            collapsed: document.querySelector("#backend-status")?.hasAttribute("data-backend-collapsed") ?? null,
            toggle: document.querySelector("[data-backend-toggle]") !== null,
            actions: [...document.querySelectorAll<HTMLElement>("[data-backend-action]")].filter((a) => a.getClientRects().length > 0).length,
          }));
          expect(seen).toEqual({ collapsed: false, toggle: false, actions: 3 });
        }
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("UI-07: a verdict that arrives while the reader is in the banner's help does not fold it", async () => {
      await metrics(1366, 768);
      await openTable(scenario("populated"), { hold: ["inspect_backend"] });
      await browser.$('[data-backend-status="checking"]').waitForExist();
      await browser.waitUntil(async () => (await heldCallers("inspect_backend")) >= 1);
      // A reader on the keyboard is in a focused window. Earlier cases can leave
      // this headless page without system focus, and then `focus()` moves
      // `activeElement` but fires no focus event -- a state no reader is in.
      await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
      await browser.execute(() => document.querySelector<HTMLElement>("[data-backend-help] summary")?.focus());
      const held = await browser.execute(() => ({
        hasFocus: document.hasFocus(),
        collapsed: document.querySelector("#backend-status")?.hasAttribute("data-backend-collapsed") ?? null,
        focus: document.activeElement?.closest("[data-backend-help]") !== null,
      }));
      expect(held).toEqual({ hasFocus: true, collapsed: false, focus: true });
      await releaseInvokeHold("inspect_backend");
      await browser.$('[data-backend-status="available"]').waitForExist();
      await frames();
      const seen = await browser.execute(() => ({
        collapsed: document.querySelector("#backend-status")?.hasAttribute("data-backend-collapsed") ?? null,
        expanded: document.querySelector("[data-backend-toggle]")?.getAttribute("aria-expanded") ?? null,
        focus: document.activeElement?.closest("[data-backend-help]") !== null,
      }));
      expect(seen).toEqual({ collapsed: false, expanded: "true", focus: true });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("UI-08: every recovery action on an unavailable backend shows an unclipped focus ring", async () => {
      const table = scenario("populated");
      table["inspect_backend"] = unavailableBackend;
      await installIpcBoundary(table);
      for (const [width, height] of [
        [1366, 768],
        [960, 640],
      ] as const) {
        await metrics(width, height);
        await browser.url("/");
        await browser.$(".workbench-header").waitForDisplayed();
        await browser.$('[data-backend-status="missing"]').waitForExist();
        await startAtHome();
        const stops = [];
        for (let step = 0; step < 40; step += 1) {
          await browser.keys("Tab");
          const at = await browser.execute(() => {
            const active = document.activeElement as HTMLElement | null;
            if (active === null || active.closest("#backend-status") === null) return null;
            const style = getComputedStyle(active);
            const reach = (parseFloat(style.outlineOffset) || 0) + (parseFloat(style.outlineWidth) || 0);
            const box = active.getBoundingClientRect();
            const clip = document.querySelector(".shell-notices")!.getBoundingClientRect();
            return {
              name: (active.textContent ?? "").trim(),
              inside: box.left - reach >= clip.left - 0.5 && box.right + reach <= clip.right + 0.5 && box.top - reach >= clip.top - 0.5 && box.bottom + reach <= clip.bottom + 0.5,
            };
          });
          if (at === null) continue;
          stops.push({ ...at, treatment: await focusedTreatment() });
        }
        evidence.push({ label: `ui-rework-banner-focus-${String(width)}x${String(height)}`, stops });
        expect(stops.length).toBeGreaterThan(0);
        expect(stops.filter((stop) => !stop.treatment.visible || !stop.inside)).toEqual([]);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("UI-12: a programmatic scroll never moves the header or Home", async () => {
      await metrics(960, 640);
      await open("populated");
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
      await selectTheSpectrum(0);
      await browser.execute(() => {
        const rows = document.querySelectorAll(".spectrum-table-row[data-source-index]");
        rows[rows.length - 1]?.scrollIntoView({ block: "center" });
      });
      await frames();
      const seen = await browser.execute(() => {
        const home = document.querySelector(".workbench-home")!.getBoundingClientRect();
        return { rootScroll: document.scrollingElement?.scrollTop ?? 0, homeTop: home.top, homeBottom: home.bottom };
      });
      expect(seen.rootScroll).toBe(0);
      expect(seen.homeTop).toBeGreaterThanOrEqual(0);
      expect(seen.homeBottom).toBeLessThanOrEqual(640);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("UI-20: Clear list shows its focus ring unclipped and answers hover", async () => {
      await metrics(1366, 768);
      await open("populated");
      await browser.execute(() => document.querySelector<HTMLElement>(".dataset-roster-actions [data-add-files]")?.focus());
      let found = false;
      for (let step = 0; step < 8 && !found; step += 1) {
        await browser.keys("Tab");
        found = await browser.execute(() => document.activeElement?.hasAttribute("data-list-wide") ?? false);
      }
      expect(found).toBe(true);
      const ring = await browser.execute(() => {
        const active = document.activeElement as HTMLElement;
        const style = getComputedStyle(active);
        const reach = (parseFloat(style.outlineOffset) || 0) + (parseFloat(style.outlineWidth) || 0);
        const box = active.getBoundingClientRect();
        const clip = document.querySelector("#workbench-roster")!.getBoundingClientRect();
        return { inside: box.top - reach >= clip.top - 0.5 && box.left - reach >= clip.left - 0.5, rest: style.backgroundColor };
      });
      expect((await focusedTreatment()).visible).toBe(true);
      expect(ring.inside).toBe(true);
      await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
      const rest = await browser.execute(() => getComputedStyle(document.querySelector("[data-list-wide]")!).backgroundColor);
      await browser.$("[data-list-wide]").moveTo();
      const hover = await browser.execute(() => getComputedStyle(document.querySelector("[data-list-wide]")!).backgroundColor);
      evidence.push({ label: "ui-rework-clear-list", ring, rest, hover });
      expect(hover).not.toBe(rest);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("UI-21: a pointer click on a partly clipped row's checkbox toggles that row and scrolls nothing", async () => {
      const table = scenario("populated");
      table["get_workspace_roster"] = {
        capacity: 1024,
        datasets: Array.from({ length: 30 }, (_, index) => ({ ...MZML_ROW, handle: `r-${String(index)}`, fileName: `Replicate_${String(index)}.mzML` })),
      };
      await metrics(1366, 768);
      await openTable(table);
      await browser.$('.grouped-roster [data-handle="r-0"]').waitForDisplayed();
      const target = await browser.execute(() => {
        const list = document.querySelector<HTMLElement>(".grouped-roster")!;
        const clip = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll<HTMLElement>("[data-handle]")];
        const row = rows.find((candidate) => candidate.getBoundingClientRect().top >= clip.bottom);
        if (row === undefined) return null;
        const checkbox = () => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.getBoundingClientRect();
        // Leave the lower half of the row's checkbox under the list's edge.
        list.scrollTop += checkbox().bottom - clip.bottom - checkbox().height / 2;
        const box = checkbox();
        if (box.bottom <= clip.bottom + 1 || box.top >= clip.bottom - 1) return null;
        return { handle: row.getAttribute("data-handle"), x: Math.round(box.x + box.width / 2), y: Math.round((box.top + clip.bottom) / 2), scrollTop: list.scrollTop, clipped: box.bottom - clip.bottom };
      });
      expect(target).not.toBe(null);
      const before = await browser.execute(() => [...document.querySelectorAll<HTMLInputElement>('.grouped-roster [data-handle] input[type="checkbox"]')].map((box) => box.checked));
      await browser.performActions([
        { type: "pointer", id: "ui21", parameters: { pointerType: "mouse" }, actions: [
          { type: "pointerMove", duration: 0, origin: "viewport", x: target!.x, y: target!.y },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ] },
      ]);
      await browser.releaseActions();
      await frames();
      const after = await browser.execute((handle: string) => ({
        checked: [...document.querySelectorAll<HTMLInputElement>('.grouped-roster [data-handle] input[type="checkbox"]')].map((box) => box.checked),
        target: document.querySelector<HTMLInputElement>(`.grouped-roster [data-handle="${handle}"] input[type="checkbox"]`)?.checked ?? null,
        scrollTop: document.querySelector<HTMLElement>(".grouped-roster")!.scrollTop,
      }), target!.handle ?? "");
      evidence.push({ label: "ui-rework-clipped-checkbox", target, after });
      expect(after.target).toBe(true);
      expect(after.checked.filter((value, index) => value !== before[index]).length).toBe(1);
      expect(after.scrollTop).toBe(target!.scrollTop);
      expect(await unexpectedConsole()).toEqual([]);
    });

    for (const locale of ["en", "zh-CN"] as const) {
      it(`UI-25: Details keeps digests to one line, names bounded and long values full width, in ${locale}`, async () => {
        await metrics(1920, 1080);
        await open("busyInspected", locale);
        await navigate([en.projectSurface, zh.projectSurface]);
        await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
        await browser.$("#workbench-inspector .provenance-digest").waitForDisplayed();
        // The engine's modules, real paths, open so the frame shows them.
        await browser.$("#workbench-inspector .targeted-modules > summary").click();
        await frames();
        const seen = await browser.execute(() => {
          // Lines on screen: a line a clamp hides is laid out below the box.
          const lines = (node: Element) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const bottom = node.getBoundingClientRect().bottom;
            return new Set([...range.getClientRects()].filter((box) => box.top < bottom - 1).map((box) => Math.round(box.top))).size;
          };
          const inspector = document.querySelector<HTMLElement>("#workbench-inspector")!;
          return {
            digests: [...inspector.querySelectorAll<HTMLElement>(".provenance-digest")]
              .filter((node) => node.getClientRects().length > 0)
              .map((node) => ({
                lines: lines(node),
                full: (node.getAttribute("title") ?? node.textContent ?? "").replace(/\s/gu, "").length,
                // Characters on screen: the box's width over one character's.
                shown: Math.floor(node.clientWidth / (node.scrollWidth / Math.max(1, (node.textContent ?? "").trim().length))),
              })),
            facts: [...inspector.querySelectorAll<HTMLElement>(".provenance-facts dd")]
              .filter((node) => node.getClientRects().length > 0)
              .map((node) => ({
                lines: lines(node),
                share: node.getBoundingClientRect().width / node.closest("dl")!.getBoundingClientRect().width,
              })),
            // A list wider than its column is clipped by the panel, where the
            // inspector's own overflow cannot see it.
            lists: [...inspector.querySelectorAll<HTMLElement>(".provenance-facts")]
              .filter((node) => node.getClientRects().length > 0)
              .map((node) => node.scrollWidth - node.clientWidth),
            names: [...inspector.querySelectorAll<HTMLElement>(".provenance-link-name, .provenance-name")]
              .filter((node) => node.getClientRects().length > 0)
              .map((node) => lines(node)),
            overflow: inspector.scrollWidth - inspector.clientWidth,
          };
        });
        evidence.push({ label: `ui-rework-details-${locale}`, ...seen });
        await surfaceFrame(`ui-rework-details-${locale}-1920x1080`);
        expect(seen.digests.length).toBeGreaterThan(0);
        expect(seen.digests.filter((digest) => digest.lines !== 1)).toEqual([]);
        expect(seen.digests.filter((digest) => digest.full < 64)).toEqual([]);
        expect(seen.names.filter((count) => count > 3)).toEqual([]);
        expect(seen.overflow).toBeLessThanOrEqual(1);
        // A value that wraps has its list's whole width, not a column beside the
        // list's longest label.
        const wrapped = seen.facts.filter((fact) => fact.lines > 1);
        expect(wrapped.length).toBeGreaterThan(0);
        expect(wrapped.filter((fact) => fact.share < 0.9)).toEqual([]);
        // A digest shows a prefix long enough to compare by eye.
        expect(seen.digests.filter((digest) => digest.shown < 16)).toEqual([]);
        expect(seen.lists.filter((excess) => excess > 1)).toEqual([]);

        // Where Details takes the surface's place (960x640), label and value
        // stay side by side.
        await metrics(960, 640);
        // The breakpoint's fit lands at the next rendering step; let it commit
        // before the toggle is read.
        await frames();
        await readBackSavedPreferences();
        const details = browser.$('[aria-controls="workbench-inspector"]');
        if ((await details.getAttribute("aria-expanded")) !== "true") await details.click();
        await browser.$("#workbench-inspector [data-targeted-plan-facts]").waitForDisplayed();
        await frames();
        const beside = await browser.execute(() => {
          const list = document.querySelector("#workbench-inspector [data-targeted-plan-facts]")!;
          const label = list.querySelector("dt")!.getBoundingClientRect();
          const value = list.querySelector("dd")!.getBoundingClientRect();
          return {
            sized: label.width > 0 && value.width > 0,
            sameRow: Math.abs(label.top - value.top) < 2,
            valueRight: value.left >= label.right,
          };
        });
        evidence.push({ label: `ui-rework-details-swap-${locale}`, beside });
        await surfaceFrame(`ui-rework-details-swap-${locale}-960x640`);
        expect(beside).toEqual({ sized: true, sameRow: true, valueRight: true });
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`UI-01: the header, notices and content share one left edge, in ${locale}`, async () => {
        await metrics(1920, 1080);
        await open("populated", locale);
        // The folded backend reading, opened from the header, is a notice.
        await browser.$("[data-backend-toggle]").click();
        await browser.$(".shell-notices > .notice").waitForDisplayed();
        for (const [width, height] of [
          [1920, 1080],
          [1366, 768],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          const edges = await browser.execute(() => {
            const layout = document.querySelector<HTMLElement>(".workspace-layout")!;
            const first = [...layout.children].find((child) => (child as HTMLElement).getClientRects().length > 0) as HTMLElement | undefined;
            return {
              header: document.querySelector(".workbench-home")!.getBoundingClientRect().left,
              notice: document.querySelector(".shell-notices > .notice")?.getBoundingClientRect().left ?? null,
              content: first?.getBoundingClientRect().left ?? null,
            };
          });
          evidence.push({ label: `ui-rework-edges-${locale}-${String(width)}`, ...edges });
          expect(edges.notice).not.toBe(null);
          expect(Math.abs((edges.notice ?? 0) - edges.header)).toBeLessThanOrEqual(1);
          expect(Math.abs((edges.content ?? 0) - edges.header)).toBeLessThanOrEqual(1);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    for (const locale of ["en", "zh-CN"] as const) {
      it(`UI-42: the Conversion surface running, settled, stopped before start and in review, in ${locale}`, async () => {
        // Any estimate: the lookahead skips only the stop control's own
        // description, "prevents remaining items from starting".
        const ETA = /\d+\s?%|\bETA\b|[Rr]emaining(?! items)|剩余|预计/u;
        const check = async (label: string) => {
          await frames();
          const seen = await surfaceFrame(label);
          const text = await browser.execute(() => (document.querySelector<HTMLElement>("#workbench-conversion")?.innerText ?? ""));
          expect(seen.title?.text).toBe(words(locale).conversionTask);
          expect(ETA.test(text)).toBe(false);
          // Focus on this surface's own controls: visible, on screen, uncovered.
          expect(await enter("#workbench-conversion")).toBe(true);
          await focusWalk(`${label}-focus`, 30, "#workbench-conversion");
        };
        const sizes = [
          [1920, 1080],
          [1366, 768],
          [960, 640],
        ] as const;
        // Running, then settled by the lane's own next read (PM9-B6's route).
        await metrics(1920, 1080);
        await open("converting", locale);
        await navigate([en.conversionTask, zh.conversionTask]);
        await browser.$('section.conversion-panel[aria-busy="true"]').waitForExist();
        for (const [width, height] of sizes) {
          await metrics(width, height);
          await check(`ui-rework-conversion-running-${locale}-${String(width)}x${String(height)}`);
        }
        const poll = "get_workspace_conversion_state";
        await holdInvoke(poll);
        await setInvokeResult(poll, conversionSlot(2, SETTLED));
        await browser.waitUntil(async () => (await heldCallers(poll)) > 0, { timeout: 15_000 });
        await releaseInvokeHold(poll);
        await browser.$('li[data-item-state="finalized"]').waitForExist();
        for (const [width, height] of sizes) {
          await metrics(width, height);
          await check(`ui-rework-conversion-settled-${locale}-${String(width)}x${String(height)}`);
        }
        // Stopped before its one item began: mounted directly, a queue that ended.
        const ended = scenario("populated", locale);
        ended["get_workspace_conversion_state"] = conversionSlot(1, {
          status: "terminal",
          reason: "stopped",
          operationId: "pm9-ended",
          queue: queueOf([queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, { sourceKind: VENDOR_ROW.sourceKind, state: "notRun" })]),
        });
        ended["describe_workspace_conversion_queue"] = {
          outcome: "planned",
          plan: {
            items: [{ datasetHandle: VENDOR_ROW.handle, fileName: VENDOR_ROW.fileName, sourceKind: VENDOR_ROW.sourceKind, output: { kind: "knownSingle", fileName: "sample-9.mzML" } }],
            outputFormat: "mzML",
            compression: "zlib",
            validationMode: "output_only",
            capacity: 16,
            intent: shippedIntent,
            conflictPolicy: "fail",
            destinationPolicy: { kind: "customFolder" },
            receipt: 1,
          },
        };
        await metrics(1920, 1080);
        await openTable(ended);
        await navigate([en.conversionTask, zh.conversionTask]);
        await browser.$('li[data-item-state="notRun"]').waitForExist();
        for (const [width, height] of sizes) {
          await metrics(width, height);
          await check(`ui-rework-conversion-ended-${locale}-${String(width)}x${String(height)}`);
        }
        // A reviewed plan: every eligible row, answered by the plan's describe.
        await browser.$('input[name="conversion-scope"][value="all"]').click();
        await browser.$("#conversion-plan-summary").waitForExist();
        for (const [width, height] of sizes) {
          await metrics(width, height);
          await check(`ui-rework-conversion-review-${locale}-${String(width)}x${String(height)}`);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("UI-11: keyboard walks through the roster, Conversion, Project, Settings and Details, and the 960x640 swap, stay visible and on screen", async () => {
      await metrics(1366, 768);
      await open("populated");
      await browser.execute(() => document.querySelector<HTMLElement>(".dataset-roster-actions [data-add-files]")?.focus());
      await focusWalk("ui-rework-walk-roster", 20);
      for (const [name, label] of [
        [en.conversionTask, "conversion"],
        [en.projectSurface, "project"],
      ] as const) {
        await navigate([name]);
        expect(await enter(`#workbench-${label}`)).toBe(true);
        await focusWalk(`ui-rework-walk-${label}`, 40, `#workbench-${label}`);
      }
      await browser.$("[data-settings-entry]").click();
      await browser.$("[data-settings-dialog]").waitForDisplayed();
      await focusWalk("ui-rework-walk-settings", 16);
      await browser.keys("Escape");
      await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });

      // Details where it holds controls: a stored result inspected on the
      // Project surface, with its related records as links.
      await open("busyInspected");
      await navigate([en.projectSurface]);
      await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
      // Closed by default below 1700 px; opened the way the store confirms it.
      await readBackSavedPreferences();
      const details = browser.$('[aria-controls="workbench-inspector"]');
      if ((await details.getAttribute("aria-expanded")) !== "true") await details.click();
      await browser.$("#workbench-inspector .provenance-digest").waitForDisplayed();
      expect(await enter("#workbench-inspector")).toBe(true);
      await focusWalk("ui-rework-walk-details-1366x768", 20, "#workbench-inspector");

      // At 960x640 each panel takes the surface's place (the swap), on
      // Conversion and on Project. Details is offered where it has something
      // to show and says why where it has not; either way it is recorded.
      await metrics(960, 640);
      await frames();
      const swaps = [];
      for (const [name, label] of [
        [en.conversionTask, "conversion"],
        [en.projectSurface, "project"],
      ] as const) {
        await navigate([name]);
        for (const panel of ["workbench-roster", "workbench-inspector"] as const) {
          const toggle = browser.$(`[aria-controls="${panel}"]`);
          if ((await toggle.getAttribute("aria-disabled")) === "true") {
            swaps.push({ label, panel, offered: false, reason: await toggle.getAttribute("title") });
            continue;
          }
          await toggle.click();
          await browser.waitUntil(async () => (await toggle.getAttribute("aria-expanded")) === "true");
          const surfaceHidden = await browser.execute((region: string) => {
            const node = document.querySelector<HTMLElement>(`#workbench-${region}`);
            return node === null || node.getClientRects().length === 0;
          }, label);
          swaps.push({ label, panel, offered: true, surfaceHidden });
          expect(surfaceHidden).toBe(true);
          expect(await enter(`#${panel}`)).toBe(true);
          await focusWalk(`ui-rework-walk-${label}-${panel}-960x640`, 20, `#${panel}`);
          await toggle.click();
          await browser.waitUntil(async () => (await toggle.getAttribute("aria-expanded")) === "false");
        }
      }
      evidence.push({ label: "ui-rework-swaps-960x640", swaps });
      expect(swaps.filter((swap) => swap.offered).length).toBeGreaterThanOrEqual(3);
      expect(await unexpectedConsole()).toEqual([]);
    });

    for (const locale of ["en", "zh-CN"] as const) {
      it(`UI-44: a fixed boundary sentence reaches the reader in their language, in ${locale}`, async () => {
        // The boundary's own words for this code: English, whatever the session.
        const boundary = "That selection is larger than MSCanvas reads from one picker, so nothing was added. Choose fewer files at a time.";
        await metrics(1366, 768);
        await open("populated", locale);
        await setInvokeRejection("choose_workspace_files", {
          kind: "file_picker_selection_too_large",
          summary: boundary,
          detail: null,
          retryable: true,
        });
        await browser.$(".dataset-roster-actions [data-add-files]").click();
        const owned = words(locale).errFilePickerSelectionTooLarge;
        await browser.waitUntil(async () => (await browser.execute(() => document.body.innerText)).includes(owned), {
          timeoutMsg: "the owned sentence never showed",
        });
        await surfaceFrame(`ui-rework-boundary-sentence-${locale}-1366x768`);
        const shown = await browser.execute(() => document.body.innerText);
        evidence.push({ label: `ui-rework-boundary-sentence-${locale}`, owned, boundaryShown: shown.includes(boundary) });
        expect(shown).toContain(owned);
        if (locale === "zh-CN") expect(shown).not.toContain(boundary);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("UI-45/46: a computed-style pass, and no stylesheet names an undeclared custom property", async () => {
      await metrics(1366, 768);
      await open("populated");
      await viewTheRow();
      await selectTheSpectrum(0);
      await frames();
      const seen = await browser.execute(() => {
        const root = getComputedStyle(document.documentElement);
        const undeclared = new Set<string>();
        for (const sheet of [...document.styleSheets]) {
          let rules: CSSRuleList;
          try { rules = sheet.cssRules; } catch { continue; }
          const scan = (list: CSSRuleList) => {
            for (const rule of [...list]) {
              if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) scan((rule as CSSGroupingRule).cssRules);
              const text = rule.cssText;
              const declared = new Set([...text.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1]));
              for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*\)/gu)) {
                const name = match[1]!;
                // Radix declares its own on the element it positions, at run time.
                if (name.startsWith("--radix-")) continue;
                if (!declared.has(name) && root.getPropertyValue(name).trim() === "") undeclared.add(name);
              }
            }
          };
          scan(rules);
        }
        const sizes: Record<string, number> = {};
        const small: Record<string, number> = {};
        for (const node of [...document.querySelectorAll<HTMLElement>("body *")]) {
          if (node.closest("svg") !== null || node.getClientRects().length === 0) continue;
          if (![...node.childNodes].some((child) => child.nodeType === 3 && (child.textContent ?? "").trim() !== "")) continue;
          const size = getComputedStyle(node).fontSize;
          sizes[size] = (sizes[size] ?? 0) + 1;
          // Below the reference's 12px caption: which elements, for the record.
          if (parseFloat(size) < 12) {
            const name = `${node.tagName.toLowerCase()}.${[...node.classList].join(".")} ${size}`;
            small[name] = (small[name] ?? 0) + 1;
          }
        }
        // Control minimums, radii and row density, for the record (UI-45):
        // the reference's 32 px compact control, 6/8 px radii, 44/32 px rows.
        const shown = (node: Element) => node.getClientRects().length > 0;
        const name = (node: Element) => `${node.tagName.toLowerCase()}.${[...node.classList].join(".")}`;
        const shortControls: Record<string, number> = {};
        for (const node of [...document.querySelectorAll<HTMLElement>('button, select, summary, input:not([type="checkbox"]):not([type="radio"])')].filter(shown)) {
          const height = Math.round(node.getBoundingClientRect().height);
          if (height < 32) shortControls[`${name(node)} ${String(height)}px`] = (shortControls[`${name(node)} ${String(height)}px`] ?? 0) + 1;
        }
        const radii: Record<string, number> = {};
        for (const node of [...document.querySelectorAll<HTMLElement>(".panel, button, select, input, .notice")].filter(shown)) {
          const radius = getComputedStyle(node).borderTopLeftRadius;
          radii[radius] = (radii[radius] ?? 0) + 1;
        }
        const rows = [...new Set([...document.querySelectorAll<HTMLElement>(".grouped-roster [data-handle]")].filter(shown).map((row) => Math.round(row.getBoundingClientRect().height)))];
        return { undeclared: [...undeclared], fontSizes: sizes, small, shortControls, radii, rosterRowHeights: rows, focus: root.getPropertyValue("--color-focus").trim() };
      });
      evidence.push({ label: "ui-rework-measure", ...seen });
      expect(seen.undeclared).toEqual([]);
      // No visible control below the reference's 32 px compact minimum.
      expect(seen.shortControls).toEqual({});
      expect(seen.focus).toBe("#1769d1");
      // One focus colour: Settings no longer declares its own (UI-46).
      await browser.$(".settings-entry").click();
      await browser.$(".settings-dialog").waitForDisplayed();
      expect(await browser.execute(() => getComputedStyle(document.querySelector(".settings-dialog")!).getPropertyValue("--color-focus").trim())).toBe(seen.focus);
      await browser.keys("Escape");
      await browser.$(".settings-dialog").waitForExist({ reverse: true });
      expect(await unexpectedConsole()).toEqual([]);
    });
  });
});
