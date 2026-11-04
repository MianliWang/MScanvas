/**
 * Rendered QA of one-click view of a Thermo RAW file (ADR 0060 slice 3), in en
 * and zh-CN, at 1366x768 and 960x640, over the mock boundary: idle, miss, open;
 * idle, hit, open; ready while another row is highlighted; Cancel; a failure and
 * Try again; the queue's refusal; a second View refused; Add files refused while
 * a view runs; and the keyboard alone. The view's answers move between polls.
 *
 * Every control is found by structure, never by its words. No file is read and
 * no provider or engine runs; decision 14's native QA is a later hold release.
 */
import { cdp, metrics } from "../support/cdp";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, holdInvoke, horizontalOverflow, installIpcBoundary, ipcCalls, releaseInvokeHold, setInvokeRejection, setInvokeResult } from "../support/harness";
import { NO_PROJECT, scenario, type Locale } from "../support/pm9Scenarios";
import { readBackSavedPreferences, revealRosterRow, selectTheSpectrum } from "../support/viewer";
import { availableBackend, chosenBackend, completeCatalog, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";

const AUTHORITY = settledAt(1, 1);
const thermo = (index: number): SelectedFile => ({
  handle: `raw-${String(index)}`, fileName: `QC_pool_0${String(index)}.raw`, byteLength: 52_428_800, sourceKind: "thermo_raw", relativeContext: null,
});
const FIRST = thermo(1);
const SECOND = thermo(2);
const OPEN: SelectedFile = { handle: "open", fileName: "reference_run.mzML", byteLength: 4_194_304, sourceKind: "mzml", relativeContext: null };
const ROWS = [FIRST, SECOND, OPEN];
const AVAILABLE = { available: true, unverifiedBuildRelease: null };

const running = (phase: string, extra: Record<string, unknown> = {}) => ({
  state: "running", operation: 1, handle: FIRST.handle, fileName: FIRST.fileName, phase, elapsedMs: 12_000,
  bytesRead: null, bytesTotal: null, intentId: shippedIntent.id, unverifiedBuildRelease: null, cachedCopyDamaged: false, ...extra,
});
const ready = (extra: Record<string, unknown> = {}) => ({
  state: "ready", operation: 1, handle: FIRST.handle, intentId: shippedIntent.id, cacheHit: false, unverifiedBuildRelease: null, openable: true, ...extra,
});

function world(locale: Locale, begun: unknown = running("checkingSource")): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: ROWS, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = {
    authority: AUTHORITY,
    configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
  table.get_workspace_conversion_state = {
    sequence: 0,
    state: { status: "idle" },
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: AUTHORITY,
  };
  table.get_raw_view_state = { state: { state: "idle" }, availability: AVAILABLE };
  table.begin_raw_view = begun;
  table.cancel_raw_view = { state: "cancelled", operation: 1, handle: FIRST.handle, stored: false };
  table.open_raw_view = {
    ...(table.open_mzml_preview as object),
    file: FIRST,
    qcSnapshotToken: null,
    qcProducerIdentified: false,
    viewSource: {
      kind: "viewCache", sourceFileName: FIRST.fileName, sourceKind: "thermo_raw", sourceSha256: "a".repeat(64),
      providerRelease: "3.0.26013", providerSha256: "b".repeat(64), intent: shippedIntent, verified: true, unverifiedBuildRelease: null,
      convertedAt: "2026-11-03T04:12:09Z",
    },
  };
  return table;
}

async function open(locale: Locale, [width, height]: readonly [number, number], table: Record<string, unknown> = world(locale)) {
  await metrics(width, height);
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
}

const step = (state: unknown, availability: unknown = AVAILABLE) => setInvokeResult("get_raw_view_state", { state, availability });

async function highlight(row: SelectedFile) {
  await revealRosterRow(row.handle);
  await browser.$(`.grouped-roster [data-handle="${row.handle}"]`).click();
  await browser.$("[data-raw-view-pane]").waitForExist({ timeout: 30_000 });
}

/** Where the roster is a drawer the evidence is inert under it. */
async function foldNarrowRoster() {
  const toggle = browser.$('[aria-controls="workbench-roster"]');
  if ((await browser.execute(() => innerWidth < 1050)) && (await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
    await browser.waitUntil(async () => (await toggle.getAttribute("aria-expanded")) === "false");
  }
}

async function offered(css: string) {
  await browser.waitUntil(async () => (await browser.$(css).getAttribute("aria-disabled")) === null, { timeoutMsg: `${css} was never offered` });
}

const phase = (name: string) => browser.$(`[data-raw-view-phase="${name}"]`).waitForExist({ timeout: 10_000 });

/** The boundary answers the running view from here on, as Rust does once Begin returns. */
async function pressView(begun: unknown = running("checkingSource")) {
  await offered("[data-raw-view-view]");
  await step(begun);
  await browser.$("[data-raw-view-view]").click();
}

async function calls(command: string): Promise<number> {
  return (await ipcCalls()).filter((call) => call.command === command).length;
}

/** Enter held down as the system repeats it: one press, then repeated keydowns on whatever has the keyboard. */
async function holdEnter(repeats = 12) {
  const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  // Without the text the browser presses no button, and this would pass for the wrong reason.
  const down = { type: "keyDown", ...enter, text: "\r", unmodifiedText: "\r" };
  await cdp("Input.dispatchKeyEvent", down);
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    await browser.pause(35);
    await cdp("Input.dispatchKeyEvent", { ...down, autoRepeat: true });
  }
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...enter });
}

const focusOn = (css: string) => browser.execute((target: string) => document.querySelector<HTMLElement>(target)?.focus(), css);

/** A press of Cancel. Every read from before it to after its answer says what Rust then says, so no poll takes the button first. */
async function cancelBy(table: Record<string, unknown>, press: () => Promise<unknown>) {
  await holdInvoke("get_raw_view_state");
  await step(table["cancel_raw_view"]);
  await press();
  await releaseInvokeHold("get_raw_view_state");
}

/**
 * The keyboard on a region, with its ring on the screen on all four sides. Computed
 * style cannot say so: the Conversion page's ring computed to -2px under columns that
 * painted over it. Read with the region scrolled to its end, where a ring inside its
 * scroll would have left, and without the corners, which the card rounds.
 */
async function ringPainted(region: string) {
  const scrolled = await browser.execute((css: string) => {
    const node = document.querySelector(css)!;
    const top = node.scrollTop;
    node.scrollTop = node.scrollHeight;
    return top;
  }, region);
  await browser.execute(() => new Promise((done) => { requestAnimationFrame(() => { requestAnimationFrame(done); }); }));
  const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const missing = await browser.execute(async (css: string, png: string) => {
    const node = document.querySelector(css)!;
    if (document.activeElement !== node || !node.matches(":focus-visible")) return `no ring on ${css}`;
    const box = node.getBoundingClientRect();
    if (!node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))) return "the ring takes the pointer";
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (byte) => byte.charCodeAt(0))], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
    canvas.drawImage(bitmap, 0, 0);
    const { data } = canvas.getImageData(0, 0, bitmap.width, bitmap.height);
    const color = getComputedStyle(node).outlineColor.match(/\d+/gu)!.map(Number);
    const ring = (x: number, y: number) => color.every((channel, index) => Math.abs(data[(y * bitmap.width + x) * 4 + index]! - channel) <= 16);
    const [left, top, right, bottom] = [box.left, box.top, box.right - 1, box.bottom - 1].map(Math.round) as [number, number, number, number];
    const gaps = (from: number, to: number, drawn: (along: number) => boolean) => {
      let count = 0;
      for (let along = from + 8; along <= to - 8; along += 1) if (!drawn(along)) count += 1;
      return count;
    };
    return {
      top: gaps(left, right, (x) => ring(x, top) || ring(x, top + 1)),
      right: gaps(top, bottom, (y) => ring(right, y) || ring(right - 1, y)),
      bottom: gaps(left, right, (x) => ring(x, bottom) || ring(x, bottom - 1)),
      left: gaps(top, bottom, (y) => ring(left, y) || ring(left + 1, y)),
    };
  }, region, shot.data as string);
  expect(missing).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  await browser.execute((css: string, top: number) => { document.querySelector(css)!.scrollTop = top; }, region, scrolled);
}

async function clean() {
  const unexpected = (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
  expect(unexpected).toEqual([]);
  const page = await horizontalOverflow();
  expect(page.scrollWidth).toBeLessThanOrEqual(page.innerWidth);
}

for (const locale of ["en", "zh-CN"] as const) {
  for (const viewport of [[1366, 768], [960, 640]] as const) {
    describe(`one-click view, ${locale}, ${String(viewport[0])}x${String(viewport[1])}`, () => {
      it("a miss: highlight starts nothing, every phase shows, and the view opens", async () => {
        await open(locale, viewport);
        await highlight(FIRST);
        expect(await calls("begin_raw_view")).toBe(0);
        expect(await browser.$("[data-raw-view-view]").getAttribute("class")).toContain("ui-button--secondary");
        await pressView();
        await phase("checkingSource");
        expect(await browser.$("[data-raw-view-phase='checkingSource'] [data-raw-view-line]").isExisting()).toBe(true);
        await step(running("converting"));
        await phase("converting");
        // The queue's bar: an accent fill and a sweep, never the browser's own, and no fraction.
        const bar = browser.$('[data-raw-view-bar="indeterminate"]');
        await bar.waitForExist({ timeout: 10_000 });
        expect(await bar.getAttribute("aria-valuenow")).toBeNull();
        expect(await browser.execute(() => getComputedStyle(document.querySelector(".raw-view-bar .conversion-progress-current")!, "::after").animationName)).toBe("conversion-progress-sweep");
        expect(await browser.$("[data-raw-view-cancel]").isDisplayed()).toBe(true);
        await step(running("checkingOutput", { bytesRead: 5, bytesTotal: 10 }));
        await phase("checkingOutput");
        await step(running("storing"));
        await phase("storing");
        expect(await browser.$("[data-raw-view-cancel]").isExisting()).toBe(false);
        await step(running("checkingCachedCopy", { bytesRead: 5, bytesTotal: 10 }));
        await phase("checkingCachedCopy");
        expect(await browser.$("[data-status-raw-view]").isDisplayed()).toBe(true);
        await step(ready());
        await browser.$("[data-view-export-withheld]").waitForExist({ timeout: 10_000 });
        expect(await calls("open_raw_view")).toBe(1);
        await clean();
      });

      it("a hit: the checks, then the view, with every export refused beside its reason", async () => {
        await open(locale, viewport);
        await highlight(FIRST);
        await pressView();
        await phase("checkingSource");
        await step(running("checkingCachedCopy", { bytesRead: 5, bytesTotal: 10 }));
        await phase("checkingCachedCopy");
        await step(ready({ cacheHit: true }));
        await browser.$("[data-view-export-withheld]").waitForExist({ timeout: 10_000 });
        await foldNarrowRoster();
        await selectTheSpectrum(0);
        const reason = await browser.$("[data-view-export-withheld]").getAttribute("id");
        const exports = await browser.$$(".figure-quick-actions > .ui-button:not([aria-haspopup])");
        expect(await exports.length).toBe(2);
        for (const button of await exports.getElements()) {
          expect(await button.getAttribute("aria-disabled")).toBe("true");
          expect(await button.getAttribute("aria-describedby")).toContain(reason);
        }
        // Both plots' ⋯: the first item is the plot's own range, and the rest are exports.
        for (const menu of await browser.$$('.figure-quick-actions button[aria-haspopup="menu"]').getElements()) {
          await menu.click();
          await browser.$('[role="menu"]').waitForExist({ timeout: 10_000 });
          const items = await browser.execute(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map(item => item.getAttribute("aria-disabled")));
          expect(items.length).toBeGreaterThan(2);
          expect(items.slice(1).every(refused => refused === "true")).toBe(true);
          await browser.keys("Escape");
          await browser.$('[role="menu"]').waitForExist({ reverse: true, timeout: 10_000 });
        }
        expect(await browser.$("[data-raw-view-convert]").isDisplayed()).toBe(true);
        expect(await calls("begin_chromatogram_export")).toBe(0);
        expect(await calls("begin_selected_spectrum_export")).toBe(0);
        await clean();
      });

      it("a held Enter presses one button: View does not cancel, and Cancel does not view", async () => {
        const table = world(locale, running("converting"));
        await open(locale, viewport, table);
        await highlight(FIRST);
        await offered("[data-raw-view-view]");
        await step(running("converting"));
        await focusOn("[data-raw-view-view]");
        await holdEnter();
        await phase("converting");
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-cancel") === true), { timeout: 10_000, timeoutMsg: "the keyboard did not reach Cancel" });
        expect(await calls("begin_raw_view")).toBe(1);
        expect(await calls("cancel_raw_view")).toBe(0);

        await cancelBy(table, holdEnter);
        await browser.$('[data-raw-view="cancelled"]').waitForExist({ timeout: 10_000 });
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-view") === true), { timeout: 10_000, timeoutMsg: "the keyboard did not reach View" });
        expect(await calls("cancel_raw_view")).toBe(1);
        expect(await calls("begin_raw_view")).toBe(1);
        await clean();
      });

      it("Show by keyboard goes to the row, or where the list stays folded to the evidence, and never the body", async () => {
        const narrow = viewport[0] <= 1050;
        const press = async (show: string) => {
          await browser.$(show).waitForExist({ timeout: 10_000 });
          await focusOn(show);
          await browser.keys("Enter");
          await browser.$("[data-raw-view-pane]").waitForExist({ timeout: 10_000 });
          // Long enough for a row's reveal to have had its turn, and for a read to have answered.
          await browser.pause(500);
          const where = await browser.execute(() => document.activeElement === document.body ? "body" : document.activeElement?.id === "workbench-evidence" ? "evidence" : document.activeElement?.matches("[data-handle]") ? "row" : "pane");
          expect(where).toBe(narrow ? "evidence" : "row");
          if (narrow) await ringPainted("#workbench-evidence");
        };
        const withState = (state: unknown, availability: unknown = AVAILABLE) => {
          const table = world(locale);
          table.get_raw_view_state = { state, availability };
          return table;
        };
        const busy = { available: false, code: "raw_view_busy" };

        await open(locale, viewport, withState(ready()));
        await press("[data-status-raw-view] button");
        await browser.$("[data-raw-view-open]").waitForExist({ timeout: 10_000 });

        await open(locale, viewport, withState({ state: "failed", operation: 1, handle: FIRST.handle, intentId: shippedIntent.id, code: "raw_view_source_changed", message: "Controlled", retryable: true, neededBytes: null, freeBytes: null }));
        await press("[data-status-raw-view] button");
        await browser.$("[data-raw-view-retry]").waitForExist({ timeout: 10_000 });

        await open(locale, viewport, withState(running("converting"), busy));
        await press("[data-status-raw-view] button");
        await phase("converting");

        await open(locale, viewport, withState(running("converting"), busy));
        await browser.$('.workbench-navigation [data-surface-tab="conversion"]').click();
        await press(".raw-view-notice button");
        await phase("converting");

        await open(locale, viewport, withState(running("converting"), busy));
        await revealRosterRow(OPEN.handle);
        await browser.$(`.grouped-roster [data-handle="${OPEN.handle}"]`).click();
        await browser.$("[data-raw-view-held]").waitForExist({ timeout: 10_000 });
        await press(".evidence-state:has([data-raw-view-held]) button");
        await phase("converting");
        await clean();
      });

      it("a re-read of a row no longer highlighted shows its refusal, or runs in the pane", async () => {
        const again = '#workbench-evidence[data-evidence="failed"] .evidence-actions button';
        const failedAndLeft = async () => {
          const table = world(locale);
          table.get_raw_view_state = { state: ready(), availability: AVAILABLE };
          table.open_raw_view = { __reject: { kind: "view_cache_entry_lost", summary: "gone", detail: null, retryable: true } };
          await open(locale, viewport, table);
          await highlight(FIRST);
          await browser.$("[data-raw-view-open]").click();
          await browser.$(again).waitForExist({ timeout: 10_000 });
          await revealRosterRow(FIRST.handle);
          await focusOn(`.grouped-roster [data-handle="${FIRST.handle}"]`);
          await browser.keys(" ");
          await browser.waitUntil(async () => (await browser.$(`.grouped-roster [data-handle="${FIRST.handle}"]`).getAttribute("aria-selected")) !== "true");
          await foldNarrowRoster();
          await browser.$(again).waitForDisplayed({ timeout: 10_000 });
          await focusOn(again);
        };

        await failedAndLeft();
        await setInvokeRejection("begin_raw_view", { kind: "view_cache_unavailable", summary: "gone", detail: null, retryable: false });
        await browser.keys("Enter");
        await browser.$('#workbench-evidence [data-raw-view-refusal="view_cache_unavailable"]').waitForDisplayed({ timeout: 10_000 });
        expect(await browser.execute(() => document.activeElement?.closest("[data-raw-view-pane]") !== null)).toBe(true);

        await failedAndLeft();
        await step(running("checkingSource", { operation: 2 }));
        await setInvokeResult("begin_raw_view", running("checkingSource", { operation: 2 }));
        await browser.keys("Enter");
        await phase("checkingSource");
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-cancel") === true), { timeout: 10_000, timeoutMsg: "the keyboard did not reach Cancel" });

        // A change of installation discards the reading and keeps the row to offer it again.
        const table = world(locale);
        table.get_raw_view_state = { state: ready(), availability: AVAILABLE };
        table.choose_backend_installation = chosenBackend;
        await open(locale, viewport, table);
        await highlight(FIRST);
        await browser.$("[data-raw-view-open]").click();
        await browser.$("[data-view-export-withheld]").waitForExist({ timeout: 10_000 });
        await revealRosterRow(FIRST.handle);
        await focusOn(`.grouped-roster [data-handle="${FIRST.handle}"]`);
        await browser.keys(" ");
        await foldNarrowRoster();
        await browser.$("[data-backend-item]").click();
        await browser.$('[data-backend-action="choose"]').click();
        const offer = '#workbench-evidence[data-evidence="idle"] .evidence-actions .ui-button--primary';
        await browser.$(offer).waitForExist({ timeout: 10_000 });
        await step(running("checkingSource", { operation: 2 }));
        await setInvokeResult("begin_raw_view", running("checkingSource", { operation: 2 }));
        await focusOn(offer);
        await browser.keys("Enter");
        await phase("checkingSource");
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-cancel") === true), { timeout: 10_000, timeoutMsg: "the offer left the keyboard on the body" });
        await clean();
      });

      it("ready while another row is highlighted: held, named in the bar, and opened on Open", async () => {
        await open(locale, viewport);
        await highlight(FIRST);
        await pressView();
        await phase("checkingSource");
        await highlight(SECOND);
        await step(ready());
        // The bar's line stops counting once a poll has read the ready state; a
        // press before that returns to a row that is still running, and opens.
        await browser.waitUntil(async () => !(await browser.$("[data-status-raw-view]").getText()).includes("0:12"), { timeout: 10_000 });
        expect(await calls("open_raw_view")).toBe(0);
        await browser.$("[data-status-raw-view] button").click();
        await browser.$("[data-raw-view-open]").waitForExist({ timeout: 10_000 });
        expect(await calls("open_raw_view")).toBe(0);
        await browser.$("[data-raw-view-open]").click();
        await browser.$("[data-view-export-withheld]").waitForExist({ timeout: 10_000 });
        expect(await calls("open_raw_view")).toBe(1);
        await clean();
      });

      it("Cancel while converting ends it, says what stayed, and View is back", async () => {
        const table = world(locale, running("converting"));
        await open(locale, viewport, table);
        await highlight(FIRST);
        await pressView(running("converting"));
        await phase("converting");
        await cancelBy(table, () => browser.$("[data-raw-view-cancel]").click());
        await browser.$('[data-raw-view="cancelled"]').waitForExist({ timeout: 10_000 });
        await offered("[data-raw-view-view]");
        expect(await calls("cancel_raw_view")).toBe(1);
        expect(await calls("open_raw_view")).toBe(0);
        await clean();
      });

      it("a failure offers Try again, which begins again; a final one does not", async () => {
        const failure = (code: string, retryable: boolean) => ({
          state: "failed", operation: 1, handle: FIRST.handle, intentId: shippedIntent.id, code, message: "Controlled", retryable, neededBytes: null, freeBytes: null,
        });
        await open(locale, viewport);
        await highlight(FIRST);
        await pressView();
        await phase("checkingSource");
        await step(failure("raw_view_source_changed", true));
        await browser.$("[data-raw-view-retry]").waitForExist({ timeout: 10_000 });
        expect(await browser.$('[data-raw-view="failed"]').getAttribute("role")).toBe("alert");
        expect(await browser.$('[data-raw-view="failed"]').getText()).not.toContain("Controlled");
        await step(running("checkingSource"));
        await browser.$("[data-raw-view-retry]").click();
        await browser.waitUntil(async () => (await calls("begin_raw_view")) === 2);
        await phase("checkingSource");
        await step(failure("view_cache_entry_unrecognized", false));
        await browser.$('[data-raw-view-code="view_cache_entry_unrecognized"]').waitForExist({ timeout: 10_000 });
        expect(await browser.$("[data-raw-view-retry]").isExisting()).toBe(false);
        await clean();
      });

      it("a queue refuses View, and Show conversion goes to it", async () => {
        const table = world(locale);
        table.get_raw_view_state = { state: { state: "idle" }, availability: { available: false, code: "conversion_busy" } };
        await open(locale, viewport, table);
        await highlight(FIRST);
        await browser.$('[data-raw-view-refusal="conversion_busy"]').waitForExist({ timeout: 10_000 });
        const view = browser.$("[data-raw-view-view]");
        expect(await view.getAttribute("aria-disabled")).toBe("true");
        expect(await view.getAttribute("aria-describedby")).toContain("raw-view-refusal");
        await view.click();
        expect(await calls("begin_raw_view")).toBe(0);
        const recoveries = await browser.$$(".raw-view-pane .evidence-actions .ui-button").getElements();
        await recoveries[1]!.click();
        await browser.waitUntil(async () => (await browser.$(".workbench-shell").getAttribute("data-surface")) === "conversion");
        await clean();
      });

      it("a second View is refused and shows the row it waits for, and Add files waits too", async () => {
        const table = world(locale);
        table.get_raw_view_state = { state: running("converting"), availability: { available: false, code: "raw_view_busy" } };
        await open(locale, viewport, table);
        await browser.$("[data-status-raw-view]").waitForExist({ timeout: 10_000 });
        await highlight(SECOND);
        await browser.$('[data-raw-view-refusal="raw_view_busy"]').waitForExist({ timeout: 10_000 });
        const named = await browser.$('[data-raw-view-refusal="raw_view_busy"]').getText();
        expect(named).toContain(FIRST.fileName);
        // Add files waits too, pointing at its own visible line, which names the view.
        await revealRosterRow(FIRST.handle);
        const add = browser.$("[data-add-files]");
        expect(await add.getAttribute("aria-disabled")).toBe("true");
        expect(await add.getAttribute("aria-describedby")).toContain("roster-acquire-reason");
        expect(await browser.$("#roster-acquire-reason").getText()).toContain(FIRST.fileName);
        await foldNarrowRoster();
        const recoveries = await browser.$$(".raw-view-pane .evidence-actions .ui-button").getElements();
        await recoveries[1]!.click();
        await phase("converting");
        await clean();
      });

      it("while a view runs the queue's Convert names the view, and Show goes to its Cancel", async () => {
        const table = world(locale);
        table.get_raw_view_state = { state: running("converting"), availability: { available: false, code: "raw_view_busy" } };
        await open(locale, viewport, table);
        await browser.$("[data-status-raw-view]").waitForExist({ timeout: 10_000 });
        await revealRosterRow(FIRST.handle);
        await browser.$(`.grouped-roster [data-handle="${FIRST.handle}"]`).click();
        await browser.$('.workbench-navigation [data-surface-tab="conversion"]').click();
        const notice = browser.$("#conversion-availability-raw-view-running");
        await notice.waitForExist({ timeout: 10_000 });
        expect(await notice.getText()).toContain(FIRST.fileName);
        expect(await browser.$("#conversion-availability-preview-running").isExisting()).toBe(false);
        await browser.$(".raw-view-notice button").click();
        await browser.waitUntil(async () => (await browser.$(".workbench-shell").getAttribute("data-surface")) === "workbench");
        await phase("converting");
        await clean();
      });

      it("the row being prepared cannot be removed, and Clear asks in the view's words", async () => {
        const table = world(locale);
        table.get_raw_view_state = { state: running("converting"), availability: { available: false, code: "raw_view_busy" } };
        table.plan_workspace_clear = { Ok: { planId: "p", totalCount: 3, removableCount: 2, protectedCount: 1, active: true } };
        await open(locale, viewport, table);
        await highlight(FIRST);
        await phase("converting");
        const listAction = async (css: string) => {
          await revealRosterRow(FIRST.handle);
          await browser.$(".roster-foot button[aria-haspopup='menu']").click();
          const item = browser.$(css);
          await item.waitForExist({ timeout: 10_000 });
          return item;
        };
        expect(await (await listAction("[data-roster-remove]")).getAttribute("aria-disabled")).toBe("true");
        await browser.keys("Escape");
        await (await listAction(".roster-menu [data-roster-clear]")).click();
        const dialog = browser.$('[role="dialog"]');
        await dialog.waitForExist({ timeout: 10_000 });
        expect(await calls("plan_workspace_clear")).toBeGreaterThan(0);
        expect(await dialog.$("h2").getText()).toBe(locale === "en" ? "Clear while a view is being prepared" : "准备查看期间清理列表");
        await browser.keys("Escape");
        await clean();
      });

      it("a failed open that is not retryable offers Convert alone, unless its words ask for a read", async () => {
        const failing = '#workbench-evidence[data-evidence="failed"]';
        for (const [kind, reads] of [["spectrum_table_refused", false], ["raw_view_not_ready", true]] as const) {
          const table = world(locale);
          table.get_raw_view_state = { state: ready(), availability: AVAILABLE };
          table.open_raw_view = { __reject: { kind, summary: "Controlled", detail: null, retryable: false } };
          await open(locale, viewport, table);
          await highlight(FIRST);
          await browser.$("[data-raw-view-open]").click();
          await browser.$(`${failing} [data-raw-view-convert]`).waitForExist({ timeout: 10_000 });
          expect(await browser.$$(`${failing} .evidence-actions button`).length).toBe(reads ? 2 : 1);
          await clean();
        }
      });

      it("a view-cache folder moved away: Try again asks, and View is back", async () => {
        const table = world(locale);
        table.get_raw_view_state = { state: { state: "idle" }, availability: { available: false, code: "view_cache_root_unrecognized" } };
        await open(locale, viewport, table);
        await highlight(FIRST);
        await browser.$("[data-raw-view-reask]").waitForExist({ timeout: 10_000 });
        expect(await browser.$("[data-raw-view-view]").getAttribute("aria-disabled")).toBe("true");
        await step({ state: "idle" });
        await browser.$("[data-raw-view-reask]").click();
        await offered("[data-raw-view-view]");
        expect(await browser.$("[data-raw-view-reask]").isExisting()).toBe(false);
        expect(await browser.$("[data-raw-view-refusal]").isExisting()).toBe(false);
        expect(await calls("begin_raw_view")).toBe(0);
        await clean();
      });

      it("a button that leaves with no change of state hands the keyboard on, never to the body", async () => {
        const keyboardOn = (css: string) => browser.waitUntil(
          async () => browser.execute((target: string) => document.activeElement?.matches(target) === true, css),
          { timeout: 10_000, timeoutMsg: `the keyboard never reached ${css}` },
        );
        const withState = (state: unknown, availability: unknown) => {
          const table = world(locale);
          table.get_raw_view_state = { state, availability };
          return table;
        };
        const unrecognized = { available: false, code: "view_cache_root_unrecognized" };
        const busy = { available: false, code: "raw_view_busy" };
        const ended = { state: "cancelled", operation: 1, handle: FIRST.handle, stored: false };
        const sourceChanged = { state: "failed", operation: 1, handle: FIRST.handle, intentId: shippedIntent.id, code: "raw_view_source_changed", message: "Controlled", retryable: true, neededBytes: null, freeBytes: null };

        // A press whose answer changes no state: the pane's first button, refused or not.
        await open(locale, viewport, withState({ state: "idle" }, unrecognized));
        await highlight(FIRST);
        await browser.$("[data-raw-view-reask]").waitForExist({ timeout: 10_000 });
        await focusOn("[data-raw-view-reask]");
        await step({ state: "idle" });
        await browser.keys("Enter");
        await keyboardOn("[data-raw-view-view]");

        await open(locale, viewport, withState(sourceChanged, unrecognized));
        await highlight(FIRST);
        await browser.$("[data-raw-view-reask]").waitForExist({ timeout: 10_000 });
        await focusOn("[data-raw-view-reask]");
        await step(sourceChanged);
        await browser.keys("Enter");
        await keyboardOn("[data-raw-view-retry]");

        // A Show the view's end takes away: the pane's own, then the surface on screen.
        await open(locale, viewport, withState(running("converting"), busy));
        await highlight(SECOND);
        await browser.$("[data-raw-view-view] + button").waitForExist({ timeout: 10_000 });
        await focusOn("[data-raw-view-view] + button");
        await step(ended);
        await keyboardOn("[data-raw-view-view]");

        // A press of a key first: after a pointer's click a script's focus shows no ring.
        await open(locale, viewport, withState(running("converting"), busy));
        await foldNarrowRoster();
        await browser.$("[data-status-raw-view] button").waitForExist({ timeout: 10_000 });
        await browser.keys("Shift");
        await focusOn("[data-status-raw-view] button");
        await step(ended);
        await keyboardOn("#workbench-evidence");
        await ringPainted("#workbench-evidence");

        await open(locale, viewport, withState(running("converting"), busy));
        await revealRosterRow(OPEN.handle);
        await browser.$(`.grouped-roster [data-handle="${OPEN.handle}"]`).click();
        await browser.$("[data-raw-view-held]").waitForExist({ timeout: 10_000 });
        await browser.keys("Shift");
        await focusOn(".evidence-state:has([data-raw-view-held]) button");
        await step(ended);
        await keyboardOn("#workbench-evidence");
        await ringPainted("#workbench-evidence");

        await open(locale, viewport, withState(running("converting"), busy));
        await browser.$('.workbench-navigation [data-surface-tab="conversion"]').click();
        await browser.$(".raw-view-notice button").waitForExist({ timeout: 10_000 });
        await browser.keys("Shift");
        await focusOn(".raw-view-notice button");
        await step(ended);
        await keyboardOn("#workbench-conversion");
        await ringPainted("#workbench-conversion");

        await open(locale, viewport, withState(running("converting"), busy));
        await browser.$('.workbench-navigation [data-surface-tab="project"]').click();
        await browser.$("[data-status-raw-view] button").waitForExist({ timeout: 10_000 });
        await browser.keys("Shift");
        await focusOn("[data-status-raw-view] button");
        await step(ended);
        await keyboardOn("#workbench-project");
        await ringPainted("#workbench-project");
        await clean();
      });

      if (viewport[0] <= 1050) it("a failure under the open list is said outside it, once: the pane keeps it as the list folds", async () => {
        const table = world(locale);
        table.get_raw_view_state = { state: running("converting"), availability: { available: false, code: "raw_view_busy" } };
        await open(locale, viewport, table);
        await foldNarrowRoster();
        await browser.$("[data-status-raw-view] button").click();
        await phase("converting");
        await revealRosterRow(FIRST.handle);
        await browser.waitUntil(async () => browser.execute(() => document.getElementById("workbench-evidence")?.hasAttribute("inert") === true), { timeoutMsg: "the open list left the evidence live" });

        await step({ state: "failed", operation: 1, handle: FIRST.handle, intentId: shippedIntent.id, code: "view_cache_not_stored", message: "Controlled", retryable: true, neededBytes: null, freeBytes: null });
        const said = () => browser.execute(() => {
          const pane = document.querySelector('[role="alert"][data-raw-view="failed"]');
          return { outside: document.querySelector('[data-live-region="raw-view-alert"]')?.textContent ?? "", paneInert: pane?.closest("[inert]") !== null };
        });
        await browser.waitUntil(async () => (await said()).outside !== "", { timeout: 10_000, timeoutMsg: "a failure under the list was said nowhere it can be heard" });
        expect((await said()).paneInert).toBe(true);

        await readBackSavedPreferences();
        await foldNarrowRoster();
        await browser.waitUntil(async () => (await said()).outside === "", { timeout: 10_000, timeoutMsg: "the alert outside the list outlived the pane's own" });
        expect((await said()).paneInert).toBe(false);
        await clean();
      });

      it("a re-read of a failed open runs in the pane, with Cancel, and its failure shows", async () => {
        const table = world(locale);
        table.get_raw_view_state = { state: ready(), availability: AVAILABLE };
        table.open_raw_view = { __reject: { kind: "view_cache_entry_lost", summary: "gone", detail: null, retryable: true } };
        await open(locale, viewport, table);
        await highlight(FIRST);
        await browser.$("[data-raw-view-open]").waitForExist({ timeout: 10_000 });
        await browser.$("[data-raw-view-open]").click();
        const again = '#workbench-evidence[data-evidence="failed"] .evidence-actions button';
        await browser.$(again).waitForExist({ timeout: 10_000 });
        expect(await browser.$("#workbench-evidence [data-raw-view-convert]").isDisplayed()).toBe(true);

        await step(running("checkingSource", { operation: 2 }));
        await setInvokeResult("begin_raw_view", running("checkingSource", { operation: 2 }));
        await focusOn(again);
        await holdEnter();
        await phase("checkingSource");
        // The pressed button left with the failure; the keyboard is on what replaced it,
        // and the held key pressed neither again.
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-cancel") === true), { timeout: 10_000, timeoutMsg: "the keyboard did not reach Cancel" });
        expect(await calls("begin_raw_view")).toBe(1);
        expect(await calls("cancel_raw_view")).toBe(0);

        await step({ state: "failed", operation: 2, handle: FIRST.handle, intentId: shippedIntent.id, code: "view_cache_not_stored", message: "Controlled", retryable: true, neededBytes: null, freeBytes: null });
        await browser.$('[data-raw-view-code="view_cache_not_stored"]').waitForExist({ timeout: 10_000 });
        expect(await browser.$("[data-raw-view-retry]").isExisting()).toBe(true);
        await clean();
      });

      it("the keyboard is never left on the body: Storing with Cancel gone, and Open", async () => {
        await open(locale, viewport);
        await highlight(FIRST);
        await pressView();
        await phase("checkingSource");
        await browser.execute(() => document.querySelector<HTMLElement>("[data-raw-view-cancel]")?.focus());
        await step(running("storing"));
        await phase("storing");
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-pane") === true), { timeout: 10_000, timeoutMsg: "Storing left the keyboard on the body" });

        // A ready view whose row was left, so Open is there to press.
        await highlight(SECOND);
        await step(ready());
        await browser.waitUntil(async () => !(await browser.$("[data-status-raw-view]").getText()).includes("0:12"), { timeout: 10_000 });
        await browser.$("[data-status-raw-view] button").click();
        await browser.$("[data-raw-view-open]").waitForExist({ timeout: 10_000 });
        await browser.execute(() => document.querySelector<HTMLElement>("[data-raw-view-open]")?.focus());
        await browser.keys("Enter");
        await browser.$("[data-view-export-withheld]").waitForExist({ timeout: 10_000 });
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === "workbench-evidence"), { timeout: 10_000, timeoutMsg: "Open left the keyboard on the body" });
        await ringPainted("#workbench-evidence");
        await clean();
      });

      it("the file row keeps its label on one line, and Convert leaves the tabs alone", async () => {
        const name = "20261012_QE_HFX_Plasma_QC_replicate_04_long_acquisition_gradient.raw";
        const release = "3.0.26204";
        const available = { available: true, unverifiedBuildRelease: release };
        const table = world(locale);
        table.get_workspace_roster = { datasets: [{ ...FIRST, fileName: name }, SECOND, OPEN], capacity: 1024 };
        table.get_raw_view_state = { state: ready({ unverifiedBuildRelease: release }), availability: available };
        const answer = table.open_raw_view as { viewSource: object };
        table.open_raw_view = { ...answer, file: { ...FIRST, fileName: name }, viewSource: { ...answer.viewSource, verified: false, unverifiedBuildRelease: release, providerRelease: release } };
        await open(locale, viewport, table);
        await highlight(FIRST);
        await browser.$("[data-raw-view-open]").click();
        await browser.$("[data-view-export-withheld]").waitForExist({ timeout: 10_000 });
        await foldNarrowRoster();
        const judge = async () => {
          const facts = await browser.execute(() => {
            const box = (css: string) => { const found = document.querySelector(css)!.getBoundingClientRect(); return { left: found.left, right: found.right, height: found.height }; };
            const tag = document.querySelector<HTMLElement>(".viewer-file-facts .not-verified-tag")!;
            return { tag: box(".viewer-file-facts .not-verified-tag"), clipped: tag.scrollWidth > tag.clientWidth, convert: box("[data-raw-view-convert]"), tabs: box(".viewer-tabs > .ui-tablist"), row: box(".viewer-file") };
          });
          expect(facts.tag.height).toBeLessThanOrEqual(24);
          expect(facts.clipped).toBe(false);
          expect(facts.tag.right).toBeLessThanOrEqual(facts.row.right);
          expect(facts.convert.left).toBeGreaterThanOrEqual(facts.tabs.right);
          expect(facts.convert.right).toBeLessThanOrEqual(facts.row.right);
        };
        await judge();

        // The tightest the row gets: both side panels beside it.
        if (viewport[0] > 1050) {
          await readBackSavedPreferences();
          await browser.$('[aria-controls="workbench-inspector"]').click();
          await browser.$("#workbench-inspector:not([hidden])").waitForExist({ timeout: 10_000 });
          await judge();
          await metrics(1060, viewport[1]);
          await browser.waitUntil(async () => browser.execute(() => innerWidth === 1060));
          await judge();
        }
        await clean();
      });

      it("the keyboard alone: Enter highlights, Enter views, Tab reaches Cancel, Enter cancels", async () => {
        const table = world(locale, running("converting"));
        await open(locale, viewport, table);
        await revealRosterRow(FIRST.handle);
        await browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.focus(), `.grouped-roster [data-handle="${FIRST.handle}"]`);
        await browser.keys("Enter");
        await browser.$("[data-raw-view-pane]").waitForExist({ timeout: 10_000 });
        expect(await calls("begin_raw_view")).toBe(0);
        await offered("[data-raw-view-view]");
        await step(running("converting"));
        if (viewport[0] > 1050) {
          // Beside the pane: the second Enter on the highlighted row presses View.
          await browser.keys("Enter");
        } else {
          // The drawer folded and the keyboard moved to the pane; Tab reaches View.
          await ringPainted("#workbench-evidence");
          await browser.keys("Tab");
          expect(await browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-view"))).toBe(true);
          await browser.keys("Enter");
        }
        await phase("converting");
        await browser.execute(() => document.querySelector<HTMLElement>("[data-raw-view-cancel]")?.focus());
        await cancelBy(table, () => browser.keys("Enter"));
        await browser.$('[data-raw-view="cancelled"]').waitForExist({ timeout: 10_000 });
        // The button that was pressed left; the keyboard stayed in the pane.
        expect(await browser.execute(() => document.activeElement?.closest("[data-raw-view-pane]") !== null)).toBe(true);
        await clean();
      });
    });
  }
}
