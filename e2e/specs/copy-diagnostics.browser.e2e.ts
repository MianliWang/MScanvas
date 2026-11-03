/**
 * Copy diagnostics (ADR 0063, decision 10), rendered: the keyboard path, the
 * read in flight, a failed read and a refused clipboard.
 *
 * Production React in real Chrome; only the IPC boundary is mocked, so the text
 * is a fixture and not what Rust collects. `writeText` is a stand-in too: Chrome
 * here would write the machine's real clipboard, which is not this suite's to
 * overwrite. Whether WebView2 grants the write is a native question.
 */
import { metrics } from "../support/cdp";
import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  consoleEntries,
  contains,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeRejection,
  setInvokeResult,
} from "../support/harness";
import { scenario } from "../support/pm9Scenarios";
import { readBackSavedPreferences } from "../support/viewer";
import { ENVIRONMENT_DIAGNOSTICS as TEXT } from "../../apps/desktop/src/test/previewFixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

const COMMAND = "read_environment_diagnostics";
const DIALOG = "[data-settings-dialog]";
const READ = "[data-diagnostics-read]";
const PREVIEW = "[data-diagnostics-preview]";
const COPY = "[data-diagnostics-copy]";
const COPIED = "[data-diagnostics-copied]";
const COPY_FAILED = "[data-diagnostics-copy-failed]";

async function open(locale: "en" | "zh-CN", width: number, height: number) {
  await metrics(width, height);
  await installIpcBoundary({ ...scenario("populated", locale), [COMMAND]: TEXT });
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
  await browser.waitUntil(() => browser.execute((lang: string) => document.documentElement.lang === lang, locale));
  await readBackSavedPreferences();
  await browser.$("[data-settings-entry]").click();
  await browser.$(DIALOG).waitForDisplayed();
}

const activeMatches = (css: string) => browser.execute((selector: string) => document.activeElement?.matches(selector) === true, css);
const value = () => browser.execute((css: string) => document.querySelector<HTMLTextAreaElement>(css)?.value ?? null, PREVIEW);
const reads = async () => (await ipcCalls()).filter((call) => call.command === COMMAND);
/** The stand-in clipboard: it records what it is given, or refuses. */
async function standInClipboard(refuse = false) {
  await browser.execute((refused: boolean) => {
    const written: string[] = [];
    Reflect.set(window, "__mscanvasCopied", written);
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: (text: string) => {
        if (refused) return Promise.reject(new DOMException("denied", "NotAllowedError"));
        written.push(text);
        return Promise.resolve();
      },
    });
  }, refuse);
}
const written = () => browser.execute(() => Reflect.get(window, "__mscanvasCopied") as string[]);

describe("Copy diagnostics, rendered", () => {
  afterEach(async () => {
    const entries = await consoleEntries();
    const problems = entries.filter((entry) => entry.level === "error" && !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)));
    expect(problems).toEqual([]);
  });

  for (const [width, height] of [[1366, 768], [960, 640]] as const) {
    const viewport = { left: 0, top: 0, right: width, bottom: height, width, height };
    for (const [locale, words] of [["en", en], ["zh-CN", zh]] as const) {
      it(`goes from the button to the clipboard by keyboard, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await standInClipboard();
        // Opening Settings asks Rust for nothing.
        expect(await reads()).toEqual([]);

        await holdInvoke(COMMAND);
        await browser.$(READ).scrollIntoView({ block: "nearest" });
        await browser.execute((css: string) => document.querySelector<HTMLElement>(css)!.focus(), READ);
        await browser.keys("Enter");

        // In flight: refused, focusable, and the reason in sight.
        await browser.$(`${READ}[aria-disabled="true"]`).waitForExist();
        expect(await activeMatches(READ)).toBe(true);
        expect(await browser.$(DIALOG).getText()).toContain(words.diagnosticsReading);
        await browser.keys("Enter");
        await releaseInvokeHold(COMMAND);

        // Read: the text itself, with the keyboard in it, and all of it in the window.
        await browser.$(PREVIEW).waitForExist();
        await browser.waitUntil(() => activeMatches(PREVIEW));
        expect(await value()).toBe(TEXT);
        expect(await reads()).toEqual([{ command: COMMAND, args: {} }]);
        expect(await browser.$(READ).getText()).toBe(words.diagnosticsReadAgain);
        expect(contains(viewport, await boxOf(PREVIEW))).toBe(true);
        expect(contains(viewport, await boxOf(COPY))).toBe(true);
        expect(await browser.execute(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await written()).toEqual([]);

        // Copy is the next stop, and Enter hands over exactly the box's text.
        await browser.keys("Tab");
        expect(await activeMatches(COPY)).toBe(true);
        await browser.keys("Enter");
        await browser.waitUntil(async () => (await browser.$(COPIED).getText()) === words.diagnosticsCopied);
        expect(await written()).toEqual([TEXT]);
        expect(await activeMatches(COPY)).toBe(true);
        expect(await browser.$(COPIED).getAttribute("role")).toBe("status");
        expect(contains(viewport, await boxOf(COPIED))).toBe(true);

        // Escape closes Settings, focus goes home, and the text is gone.
        await browser.keys("Escape");
        await browser.$(DIALOG).waitForExist({ reverse: true });
        await browser.waitUntil(() => activeMatches("[data-settings-entry]"));
        await browser.$("[data-settings-entry]").click();
        await browser.$(DIALOG).waitForDisplayed();
        expect(await browser.$(PREVIEW).isExisting()).toBe(false);
        expect(await browser.$(READ).getText()).toBe(words.diagnosticsShow);
      });
    }
  }

  for (const [locale, words] of [["en", en], ["zh-CN", zh]] as const) {
    it(`a failed read says so in its own words and reads again, ${locale}`, async () => {
      await open(locale, 960, 640);
      await setInvokeRejection(COMMAND, { kind: "preview_worker_unavailable", summary: "the boundary's own words", detail: null, retryable: true });
      await browser.$(READ).click();
      const failed = browser.$("[data-diagnostics-failed]");
      await failed.waitForDisplayed();
      expect(await failed.getAttribute("role")).toBe("alert");
      expect(await failed.getText()).toBe(words.errPreviewWorkerUnavailable);
      expect(contains(await boxOf(".settings-dialog-body"), await boxOf("[data-diagnostics-failed]"))).toBe(true);
      expect(await browser.$(PREVIEW).isExisting()).toBe(false);
      expect(await browser.$(COPY).isExisting()).toBe(false);

      await setInvokeResult(COMMAND, TEXT);
      expect(await browser.$(READ).getText()).toBe(words.diagnosticsReadAgain);
      await browser.$(READ).click();
      await browser.$(PREVIEW).waitForExist();
      expect(await value()).toBe(TEXT);
      expect(await failed.isExisting()).toBe(false);
    });

    it(`a refused clipboard claims no copy, stays in sight and keeps the text to select, ${locale}`, async () => {
      await open(locale, 960, 640);
      await standInClipboard(true);
      await browser.$(READ).click();
      await browser.$(PREVIEW).waitForExist();
      await browser.$(COPY).click();
      const refused = browser.$(COPY_FAILED);
      await refused.waitForDisplayed();
      expect(await refused.getAttribute("role")).toBe("alert");
      expect(await refused.getText()).toBe(words.diagnosticsCopyFailed);
      expect(contains(await boxOf(".settings-dialog-body"), await boxOf(COPY_FAILED))).toBe(true);
      expect(await browser.$(COPIED).getText()).toBe("");
      expect(await value()).toBe(TEXT);
      // A person can still select all of it and take it themselves.
      await browser.$(PREVIEW).click();
      await browser.keys(["Control", "a"]);
      expect(await browser.execute((css: string) => {
        const box = document.querySelector<HTMLTextAreaElement>(css)!;
        return box.value.slice(box.selectionStart, box.selectionEnd);
      }, PREVIEW)).toBe(TEXT);
    });
  }
});
