/**
 * N-C3 through the delivered application: Convert this file… holds the Conversion
 * page to the one file, from the pane, a viewed file's row, a failed open and a
 * vendor row, in en and zh-CN, at 1366x768 and 960x640. Other checked rows are
 * neither converted nor changed; Checked rows brings them back.
 *
 * Every control is found by structure, never by its words. No file is read and no
 * provider or engine runs.
 */
import { metrics } from "../support/cdp";
import { answerPlans, CONVERT, checkMembers, isRefused, waitUntilOffered } from "../support/conversion";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, horizontalOverflow, installIpcBoundary, ipcCalls, setInvokeResult } from "../support/harness";
import { NO_PROJECT, scenario, type Locale } from "../support/pm9Scenarios";
import { revealRosterRow } from "../support/viewer";
import { availableBackend, completeCatalog, queueItem, queueOf, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";

const AUTHORITY = settledAt(1, 1);
const thermo = (index: number, fileName = `QC_pool_0${String(index)}.raw`): SelectedFile => ({
  handle: `raw-${String(index)}`, fileName, byteLength: 52_428_800, sourceKind: "thermo_raw", relativeContext: null,
});
const FIRST = thermo(1);
const SECOND = thermo(2);
const THIRD = thermo(3);
const LONG = thermo(4, "20261012_QE_HFX_Plasma_QC_batch_08_replicate_04_long_acquisition_gradient_90min_column_C18_250mm_positive_mode.raw");
const LCD: SelectedFile = { handle: "lcd", fileName: "Shimadzu_run_01.lcd", byteLength: 8_388_608, sourceKind: "shimadzu_lcd", relativeContext: null };
/** Short enough for one text node, and with no break in it: it has to wrap. */
const WIDE = thermo(5, "血浆质控批次零八重复零四长时间采集结果.raw");
const ROWS = [FIRST, SECOND, THIRD, LONG, WIDE, LCD];

const DESCRIBE = "describe_workspace_conversion_queue";
const SCOPE = 'input[name="conversion-scope"]';
const FILE_SCOPE = `${SCOPE}[value="file"]`;
const CHECKED_ROWS = `${SCOPE}[value="selected"]`;
const SUMMARY = "#conversion-scope-summary";
const CONVERT_THIS = "[data-raw-view-convert]";
const PANE_CONVERT = "[data-raw-view-pane] .evidence-actions button:last-child";
const SURFACE = '.workbench-shell[data-surface="conversion"]';

const slot = (state: unknown) => ({
  sequence: 1, state, authority: AUTHORITY, backendQuarantined: false,
  diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
});

function world(locale: Locale, state: unknown = { status: "idle" }): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: ROWS, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = {
    authority: AUTHORITY,
    configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
  table.get_workspace_conversion_state = slot(state);
  table.get_raw_view_state = { state: { state: "idle" }, availability: { available: true, unverifiedBuildRelease: null } };
  return table;
}

const READY = { state: "ready", operation: 1, handle: FIRST.handle, intentId: shippedIntent.id, cacheHit: false, unverifiedBuildRelease: null, openable: true };
function viewable(table: Record<string, unknown>): Record<string, unknown> {
  table.get_raw_view_state = { state: READY, availability: { available: true, unverifiedBuildRelease: null } };
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

async function open([width, height]: readonly [number, number], table: Record<string, unknown>) {
  await metrics(width, height);
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
  // The boundary answers each plan question for the rows it names.
  await answerPlans(ROWS);
}

async function pressRow(row: SelectedFile) {
  await revealRosterRow(row.handle);
  await browser.$(`.grouped-roster [data-handle="${row.handle}"]`).click();
}

/** The rows whose conversion checkbox is ticked, wherever the roster is. */
const checks = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>(".grouped-roster [data-handle]")]
  .filter((row) => row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked === true)
  .map((row) => row.dataset["handle"]));

const lastPlanHandles = async () => ((await ipcCalls()).filter((call) => call.command === DESCRIBE).at(-1)?.args as { request?: { handles?: string[] } } | undefined)?.request?.handles;
const queueNames = () => browser.execute(() => [...document.querySelectorAll('.conversion-side .conversion-queue-name')].map((node) => node.getAttribute("title") ?? node.textContent));

const noSideScroll = async () => { const page = await horizontalOverflow(); expect(page.scrollWidth).toBeLessThanOrEqual(page.innerWidth + 1); };

/** Where the roster is a drawer the evidence is inert under it, and only a RAW row's press folds it. */
async function foldNarrowRoster() {
  const toggle = browser.$('[aria-controls="workbench-roster"]');
  if ((await browser.execute(() => innerWidth < 1050)) && (await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
    await browser.waitUntil(async () => (await toggle.getAttribute("aria-expanded")) === "false");
  }
}

/** The third button's name, as drawn: whole in its text, and cut by nothing but its own ellipsis. */
const thirdButton = () => browser.execute((css: string) => {
  const label = document.querySelector(css)!.closest("label")!;
  const name = label.querySelector(".ui-middle-ellipsis")!;
  const track = label.parentElement!;
  return {
    text: name.textContent,
    title: name.getAttribute("title"),
    clipped: label.scrollWidth > label.clientWidth + 1 || track.scrollWidth > track.clientWidth + 1,
    pair: [...track.querySelectorAll("label")].map((node) => Math.round(node.getBoundingClientRect().top)),
  };
}, FILE_SCOPE);

/** What every route must end in: this file alone, checks unchanged, Checked rows brings them back. */
async function expectOneFile(row: SelectedFile) {
  await browser.$(SURFACE).waitForExist({ timeout: 15_000 });
  await waitUntilOffered(CONVERT);
  expect(await browser.$(FILE_SCOPE).isSelected()).toBe(true);
  expect(await thirdButton()).toMatchObject({ text: row.fileName, title: row.fileName, clipped: false });
  expect(await lastPlanHandles()).toEqual([row.handle]);
  expect(await browser.$$(`${SCOPE}`).length).toBe(3);
  expect((await browser.$(SUMMARY).getText()).match(/\d+/gu)).toEqual(["1", "1", "0"]);
  expect(await queueNames()).toEqual([row.fileName]);
  expect(await checks()).toEqual([SECOND.handle, THIRD.handle]);
  expect(await browser.execute(() => document.activeElement?.id)).toBe("workbench-conversion");
  await noSideScroll();

  await browser.$(CHECKED_ROWS).parentElement().click();
  await waitUntilOffered(CONVERT);
  expect(await lastPlanHandles()).toEqual([SECOND.handle, THIRD.handle]);
  expect(await browser.$(FILE_SCOPE).isExisting()).toBe(false);
  expect(await browser.$$(`${SCOPE}`).length).toBe(2);
  expect(await checks()).toEqual([SECOND.handle, THIRD.handle]);
}

describe("Convert this file converts this file", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    for (const viewport of [[1366, 768], [960, 640]] as const) {
      describe(`${locale} ${String(viewport[0])}x${String(viewport[1])}`, () => {
        afterEach(async () => {
          expect((await consoleEntries()).filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))).toEqual([]);
        });

        it("from the pane", async () => {
          await open(viewport, world(locale));
          await checkMembers([SECOND.handle, THIRD.handle]);
          await pressRow(FIRST);
          await browser.$(PANE_CONVERT).waitForExist({ timeout: 30_000 });
          await browser.$(PANE_CONVERT).click();
          await expectOneFile(FIRST);
        });

        it("from a viewed file's row", async () => {
          await open(viewport, viewable(world(locale)));
          await checkMembers([SECOND.handle, THIRD.handle]);
          await pressRow(FIRST);
          await browser.$("[data-raw-view-open]").waitForExist({ timeout: 30_000 });
          await browser.$("[data-raw-view-open]").click();
          await browser.$(CONVERT_THIS).waitForExist({ timeout: 30_000 });
          await browser.$(CONVERT_THIS).click();
          await expectOneFile(FIRST);
        });

        it("from a failed open", async () => {
          const table = viewable(world(locale));
          table.open_raw_view = { __reject: { kind: "spectrum_table_refused", summary: "Controlled", detail: null, retryable: false } };
          await open(viewport, table);
          await checkMembers([SECOND.handle, THIRD.handle]);
          await pressRow(FIRST);
          await browser.$("[data-raw-view-open]").waitForExist({ timeout: 30_000 });
          await browser.$("[data-raw-view-open]").click();
          const convert = `#workbench-evidence[data-evidence="failed"] ${CONVERT_THIS}`;
          await browser.$(convert).waitForExist({ timeout: 30_000 });
          await browser.$(convert).click();
          await expectOneFile(FIRST);
        });

        it("from a vendor row", async () => {
          await open(viewport, world(locale));
          await checkMembers([SECOND.handle, THIRD.handle]);
          await pressRow(LCD);
          await foldNarrowRoster();
          const convert = '#workbench-evidence[data-evidence="vendor"] button';
          await browser.$(convert).waitForExist({ timeout: 30_000 });
          await browser.$(convert).click();
          await expectOneFile(LCD);
        });

        it("by keyboard: the third button is the group's stop, and an arrow leaves it for good", async () => {
          await open(viewport, world(locale));
          await checkMembers([SECOND.handle]);
          await pressRow(FIRST);
          await browser.$(PANE_CONVERT).waitForExist({ timeout: 30_000 });
          await browser.$(PANE_CONVERT).click();
          await browser.$(SURFACE).waitForExist({ timeout: 15_000 });
          await waitUntilOffered(CONVERT);
          // Tab from the surface reaches the group by its checked radio, the third button.
          await browser.waitUntil(async () => {
            await browser.keys("Tab");
            return browser.execute((css: string) => document.activeElement?.matches(css) === true, SCOPE);
          }, { timeout: 15_000, timeoutMsg: "Tab never reached the scope" });
          expect(await browser.execute(() => (document.activeElement as HTMLInputElement).value)).toBe("file");
          // The group wraps: past the last radio is the first, Checked rows.
          await browser.keys("ArrowRight");
          await browser.waitUntil(async () => !(await browser.$(FILE_SCOPE).isExisting()));
          expect(await browser.execute(() => (document.activeElement as HTMLInputElement).value)).toBe("selected");
          await waitUntilOffered(CONVERT);
          expect(await lastPlanHandles()).toEqual([SECOND.handle]);
          expect(await checks()).toEqual([SECOND.handle]);
        });

        for (const [what, row] of [["a long name loses its middle", LONG], ["a wide name with no break wraps", WIDE]] as const) it(`${what}, under the other two, and nothing is cut`, async () => {
          await open(viewport, world(locale));
          await pressRow(row);
          await browser.$(PANE_CONVERT).waitForExist({ timeout: 30_000 });
          await browser.$(PANE_CONVERT).click();
          await browser.$(SURFACE).waitForExist({ timeout: 15_000 });
          await waitUntilOffered(CONVERT);
          const button = await thirdButton();
          expect(button).toMatchObject({ text: row.fileName, title: row.fileName, clipped: false });
          expect(button.pair[0]).toBe(button.pair[1]);
          expect(button.pair[2]).toBeGreaterThan(button.pair[0]!);
          await noSideScroll();
        });

        it("while a queue runs: the queue stays on screen, nothing starts, and no check moves", async () => {
          const queue = queueOf([queueItem(SECOND.handle, SECOND.fileName, { state: "running", attempts: 1 })]);
          await open(viewport, world(locale, { status: "running", operationId: "queue", queue }));
          await checkMembers([THIRD.handle]);
          await pressRow(FIRST);
          await browser.$(PANE_CONVERT).waitForExist({ timeout: 30_000 });
          await browser.$(PANE_CONVERT).click();
          await browser.$(SURFACE).waitForExist({ timeout: 15_000 });
          await browser.$(".conversion-running").waitForDisplayed({ timeout: 15_000 });
          expect((await ipcCalls()).filter((call) => call.command === "begin_workspace_conversion_queue")).toEqual([]);
          expect(await checks()).toEqual([THIRD.handle]);
        });

        it("a removed row leaves an empty scope, refused with its reason, and a later press replaces the file", async () => {
          await open(viewport, world(locale));
          await checkMembers([SECOND.handle]);
          await pressRow(FIRST);
          await browser.$(PANE_CONVERT).waitForExist({ timeout: 30_000 });
          await browser.$(PANE_CONVERT).click();
          await browser.$(SURFACE).waitForExist({ timeout: 15_000 });
          await waitUntilOffered(CONVERT);

          await browser.$(".workbench-navigation > button:nth-child(1)").click();
          await revealRosterRow(SECOND.handle);
          const left = ROWS.filter((row) => row !== FIRST);
          await setInvokeResult("remove_workspace_datasets", { roster: { datasets: left, capacity: 1024 }, removedHandles: [FIRST.handle], unknownHandles: [] });
          await setInvokeResult("get_workspace_roster", { datasets: left, capacity: 1024 });
          await browser.$("[data-roster-list-menu]").click();
          await browser.$("[data-roster-remove]").click();
          await browser.$(`.grouped-roster [data-handle="${FIRST.handle}"]`).waitForExist({ reverse: true, timeout: 15_000 });

          await browser.$(".workbench-navigation > button:nth-child(2)").click();
          await browser.$(SURFACE).waitForExist({ timeout: 15_000 });
          await browser.waitUntil(() => isRefused(CONVERT), { timeoutMsg: "Convert was never refused" });
          await browser.$("#conversion-availability-no-convertible-target").waitForDisplayed({ timeout: 15_000 });
          expect(await browser.$(FILE_SCOPE).isSelected()).toBe(true);
          expect((await browser.$(SUMMARY).getText()).match(/\d+/gu)).toEqual(["0", "0", "0"]);
          await browser.$(CONVERT).click();
          expect((await ipcCalls()).filter((call) => call.command === "begin_workspace_conversion_queue")).toEqual([]);
          expect(await checks()).toEqual([SECOND.handle]);

          await browser.$(".workbench-navigation > button:nth-child(1)").click();
          await pressRow(THIRD);
          await browser.$(PANE_CONVERT).waitForExist({ timeout: 30_000 });
          await browser.$(PANE_CONVERT).click();
          await browser.$(SURFACE).waitForExist({ timeout: 15_000 });
          await waitUntilOffered(CONVERT);
          expect(await lastPlanHandles()).toEqual([THIRD.handle]);
          expect(await thirdButton()).toMatchObject({ title: THIRD.fileName, clipped: false });
        });
      });
    }
  }
});
