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
import { metrics } from "../support/cdp";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, horizontalOverflow, installIpcBoundary, ipcCalls, setInvokeResult } from "../support/harness";
import { NO_PROJECT, scenario, type Locale } from "../support/pm9Scenarios";
import { readBackSavedPreferences, revealRosterRow } from "../support/viewer";
import { availableBackend, completeCatalog, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
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
        const reason = await browser.$("[data-view-export-withheld]").getAttribute("id");
        const exports = await browser.$$(".figure-quick-actions > .ui-button:not([aria-haspopup])");
        expect(await exports.length).toBeGreaterThan(0);
        for (const button of await exports.getElements()) {
          expect(await button.getAttribute("aria-disabled")).toBe("true");
          expect(await button.getAttribute("aria-describedby")).toContain(reason);
        }
        expect(await browser.$("[data-raw-view-convert]").isDisplayed()).toBe(true);
        expect(await calls("begin_chromatogram_export")).toBe(0);
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
        await step(table["cancel_raw_view"]);
        await browser.$("[data-raw-view-cancel]").click();
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
        await browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.focus(), again);
        await browser.keys("Enter");
        await phase("checkingSource");
        // The pressed button left with the failure; the keyboard is on what replaced it.
        await browser.waitUntil(async () => browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-cancel") === true), { timeout: 10_000, timeoutMsg: "the keyboard did not reach Cancel" });

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
          await browser.keys("Tab");
          expect(await browser.execute(() => document.activeElement?.hasAttribute("data-raw-view-view"))).toBe(true);
          await browser.keys("Enter");
        }
        await phase("converting");
        await browser.execute(() => document.querySelector<HTMLElement>("[data-raw-view-cancel]")?.focus());
        await step(table["cancel_raw_view"]);
        await browser.keys("Enter");
        await browser.$('[data-raw-view="cancelled"]').waitForExist({ timeout: 10_000 });
        // The button that was pressed left; the keyboard stayed in the pane.
        expect(await browser.execute(() => document.activeElement?.closest("[data-raw-view-pane]") !== null)).toBe(true);
        await clean();
      });
    });
  }
}
