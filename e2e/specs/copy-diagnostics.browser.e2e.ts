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
  pressAt,
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
const BODY = ".settings-dialog-body";
const READ = "[data-diagnostics-read]";
const PREVIEW = "[data-diagnostics-preview]";
const COPY = "[data-diagnostics-copy]";
const COPIED = "[data-diagnostics-copied]";
const COPY_FAILED = "[data-diagnostics-copy-failed]";
const FAILED = "[data-diagnostics-failed]";
const FIRST_CHOICE = `${DIALOG} [role="radio"][aria-checked="true"]`;
/** Why the button is refused while a read is out. */
const REASON = ".settings-diagnostics-field .setting-field-help";

const SECOND_READING = `${TEXT}a second reading\n`;
const SAVE_FAILED = { outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false, revision: 1 };

async function open(locale: "en" | "zh-CN", width: number, height: number, table: Record<string, unknown> = {}) {
  await metrics(width, height);
  await installIpcBoundary({ ...scenario("populated", locale), ...table });
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
/** A stand-in whose answer waits for {@link endHeldCopy}. */
async function holdCopies() {
  await browser.execute(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => new Promise<void>((resolve, reject) => { Reflect.set(window, "__mscanvasEndCopy", { resolve, reject }); }),
    });
  });
}
async function endHeldCopy(ending: "resolve" | "reject") {
  await browser.execute((how: "resolve" | "reject") => {
    (Reflect.get(window, "__mscanvasEndCopy") as Record<string, (reason?: unknown) => void>)[how]!(new DOMException("denied", "NotAllowedError"));
    // Past the promise's own reaction, and a frame for anything it rendered.
    return new Promise((done) => { requestAnimationFrame(() => { requestAnimationFrame(done); }); });
  }, ending);
}
/** Inside the part of the dialog that scrolls, so nothing has to be scrolled to find it. */
async function inTheBody(...selectors: readonly string[]) {
  const body = await boxOf(BODY);
  for (const selector of selectors) expect([selector, contains(body, await boxOf(selector))]).toEqual([selector, true]);
}
/** Where the three things a second read must not move are. */
const places = async () => [await boxOf(READ), await boxOf(PREVIEW), await boxOf(COPY)];
const choose = (value: string) => browser.$(`${DIALOG} [role="radio"]:has([data-setting-value="${value}"])`).click();
/** Where a wheel can leave the body: scrolled as far as it goes. */
const toTheEnd = () => browser.execute((css: string) => {
  const body = document.querySelector(css)!;
  body.scrollTop = body.scrollHeight;
}, BODY);
/** Where a wheel can leave the body: this element against its lower edge. */
const toEdge = (selector: string) => browser.execute((css: string) => {
  document.querySelector(css)!.scrollIntoView({ block: "end" });
}, selector);
/** Past what an answer rendered and the effects that follow it. */
const aFrameLater = () => browser.execute(() => new Promise((done) => { requestAnimationFrame(() => { requestAnimationFrame(done); }); }));
/** The box's first line on screen and the rest below the body, so anything that scrolls to it shows. */
const boxHalfBelow = () => browser.execute((body: string, box: string) => {
  const scroller = document.querySelector(body)!;
  scroller.scrollTop += document.querySelector(box)!.getBoundingClientRect().top - scroller.getBoundingClientRect().bottom + 40;
}, BODY, PREVIEW);
const bodyTop = () => browser.execute((css: string) => document.querySelector(css)?.scrollTop ?? null, BODY);
/** A pointer action at a visible point: an element click scrolls it into view first. */
async function pressTheText() {
  const text = await boxOf(PREVIEW);
  await browser.action("pointer").move({ x: Math.round((text.left + text.right) / 2), y: Math.round(text.top + 20) }).down().up().perform();
}
/** Where the box has scrolled to and where its caret is. */
const boxPlace = () => browser.execute((css: string) => {
  const box = document.querySelector<HTMLTextAreaElement>(css)!;
  return { top: box.scrollTop, caret: box.selectionStart };
}, PREVIEW);

describe("Copy diagnostics, rendered", () => {
  afterEach(async () => {
    const entries = await consoleEntries();
    const problems = entries.filter((entry) => entry.level === "error" && !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)));
    expect(problems).toEqual([]);
  });

  for (const [width, height] of [[1366, 768], [960, 640]] as const) {
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
        expect(await browser.$(REASON).getText()).toBe(words.diagnosticsReading);
        await inTheBody(READ, REASON);
        await browser.keys("Enter");
        await releaseInvokeHold(COMMAND);

        // Read: the text itself, with the keyboard in it, and all of it in the body.
        await browser.$(PREVIEW).waitForExist();
        await browser.waitUntil(() => activeMatches(PREVIEW));
        expect(await value()).toBe(TEXT);
        expect(await reads()).toEqual([{ command: COMMAND, args: {} }]);
        expect(await browser.$(READ).getText()).toBe(words.diagnosticsReadAgain);
        await inTheBody(PREVIEW, COPY);
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
        await inTheBody(COPIED);

        // Escape closes Settings, focus goes home, and the text is gone.
        await browser.keys("Escape");
        await browser.$(DIALOG).waitForExist({ reverse: true });
        await browser.waitUntil(() => activeMatches("[data-settings-entry]"));
        await browser.$("[data-settings-entry]").click();
        await browser.$(DIALOG).waitForDisplayed();
        expect(await browser.$(PREVIEW).isExisting()).toBe(false);
        expect(await browser.$(READ).getText()).toBe(words.diagnosticsShow);
      });

      it(`a second read leaves everything in place and Copy waits for it, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await standInClipboard();
        await browser.$(READ).click();
        await browser.$(PREVIEW).waitForExist();
        await browser.$(COPY).click();
        await browser.waitUntil(async () => (await browser.$(COPIED).getText()) === words.diagnosticsCopied);

        await browser.$(READ).scrollIntoView({ block: "nearest" });
        const before = await places();
        await holdInvoke(COMMAND);
        await setInvokeResult(COMMAND, SECOND_READING);
        await browser.$(READ).click();
        await browser.$(`${READ}[aria-disabled="true"]`).waitForExist();

        // Nothing moves, so a second press lands on the same refused button.
        expect(await places()).toEqual(before);
        expect(await browser.$(READ).getText()).toBe(words.diagnosticsReadAgain);
        expect(await browser.$(REASON).getText()).toBe(words.diagnosticsReading);
        expect(await value()).toBe(TEXT);
        expect(await browser.$(COPIED).getText()).toBe(words.diagnosticsCopied);
        await inTheBody(READ, REASON);

        // Copy is refused and says why: that text is about to be replaced.
        expect(await browser.$(COPY).getAttribute("aria-disabled")).toBe("true");
        await browser.$(COPY).click();
        expect(await written()).toEqual([TEXT]);

        await releaseInvokeHold(COMMAND);
        await browser.waitUntil(async () => (await value()) === SECOND_READING);
        expect(await places()).toEqual(before);
        expect(await browser.$(COPIED).getText()).toBe("");
        expect(await browser.$(COPY).getAttribute("aria-disabled")).toBe(null);
        await browser.$(COPY).click();
        await browser.waitUntil(async () => (await browser.$(COPIED).getText()) === words.diagnosticsCopied);
        expect(await written()).toEqual([TEXT, SECOND_READING]);
      });

      // Support is last, so a person who wheels down to it presses with the body at
      // its end, and only the first line of the box would be left showing.
      it(`a read pressed at the end of the body shows all of the box, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await toTheEnd();
        await inTheBody(READ);
        await pressAt(READ);
        await browser.waitUntil(() => activeMatches(PREVIEW));
        await inTheBody(READ, PREVIEW, COPY);
      });

      it(`a read after a failed one shows all of the box, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await setInvokeRejection(COMMAND, { kind: "preview_worker_unavailable", summary: "", detail: null, retryable: true });
        await browser.$(READ).click();
        await browser.$(FAILED).waitForDisplayed();
        await setInvokeResult(COMMAND, TEXT);
        await toTheEnd();
        await pressAt(READ);
        await browser.waitUntil(() => activeMatches(PREVIEW));
        await inTheBody(PREVIEW, COPY);
      });

      it(`a second read with the box half below the body shows all of it, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await browser.$(READ).click();
        await browser.waitUntil(() => activeMatches(PREVIEW));
        // The box's first line is on screen, so the caret alone would not move the body.
        await boxHalfBelow();
        await setInvokeResult(COMMAND, SECOND_READING);
        await pressAt(READ);
        await browser.waitUntil(async () => (await value()) === SECOND_READING);
        await browser.waitUntil(() => activeMatches(PREVIEW));
        await aFrameLater();
        await inTheBody(READ, PREVIEW, COPY);
        // From its first line, as a first read shows it.
        expect((await boxPlace()).top).toBe(0);
      });

      // A slow worker or profile volume leaves time to move. The keyboard and the body
      // stay with the reader, and the new text still starts at its first line.
      for (const holder of [COPY, PREVIEW]) {
        it(`a second read shows its first line to a reader who moved to ${holder}, ${locale} ${String(width)}x${String(height)}`, async () => {
          await open(locale, width, height);
          await browser.$(READ).click();
          await browser.waitUntil(() => activeMatches(PREVIEW));
          await holdInvoke(COMMAND);
          await setInvokeResult(COMMAND, SECOND_READING);
          await pressAt(READ);
          await browser.$(`${READ}[aria-disabled="true"]`).waitForExist();
          await browser.keys("Tab");
          if (holder === COPY) await browser.keys("Tab");
          expect(await activeMatches(holder)).toBe(true);
          await browser.execute((css: string) => { document.querySelector(css)!.scrollTop = 400; }, PREVIEW);
          const before = await bodyTop();

          await releaseInvokeHold(COMMAND);
          await browser.waitUntil(async () => (await value()) === SECOND_READING);
          await aFrameLater();
          expect(await activeMatches(holder)).toBe(true);
          expect(await boxPlace()).toEqual({ top: 0, caret: 0 });
          expect(await bodyTop()).toBe(before);

          // Back into the box from Copy: the caret decides what focus shows.
          if (holder === COPY) await browser.keys(["Shift", "Tab"]);
          await aFrameLater();
          expect(await activeMatches(PREVIEW)).toBe(true);
          expect(await boxPlace()).toEqual({ top: 0, caret: 0 });
        });
      }

      // With the box in view a scroll to it moves nothing. Here it is below the body,
      // so a scroll would take the control that has the keyboard out of sight.
      for (const read of ["first", "second"] as const) {
        it(`a ${read} read leaves the body with a reader who moved away from the box, ${locale} ${String(width)}x${String(height)}`, async () => {
          await open(locale, width, height);
          if (read === "second") {
            await browser.$(READ).click();
            await browser.waitUntil(() => activeMatches(PREVIEW));
            await setInvokeResult(COMMAND, SECOND_READING);
          }
          await holdInvoke(COMMAND);
          await browser.$(READ).click();
          await browser.$(`${READ}[aria-disabled="true"]`).waitForExist();
          await browser.execute((css: string) => { document.querySelector<HTMLElement>(css)!.focus({ preventScroll: true }); }, FIRST_CHOICE);
          await browser.execute((css: string) => { document.querySelector(css)!.scrollTop = 0; }, BODY);

          await releaseInvokeHold(COMMAND);
          await browser.waitUntil(async () => (await value()) === (read === "second" ? SECOND_READING : TEXT));
          await aFrameLater();
          expect(await bodyTop()).toBe(0);
          expect(await activeMatches(FIRST_CHOICE)).toBe(true);
          await inTheBody(FIRST_CHOICE);
          expect(await boxPlace()).toEqual({ top: 0, caret: 0 });
          // What makes this case worth having: the box really is out of the body.
          expect(contains(await boxOf(BODY), await boxOf(PREVIEW))).toBe(false);
        });
      }

      // Copy sits on the body's lower edge after a wheel or a Tab, with its result
      // below it and the refusal pushing it further down.
      it(`a copy pressed on the body's edge shows that it was written, each time, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await standInClipboard();
        await browser.$(READ).click();
        await browser.waitUntil(() => activeMatches(PREVIEW));
        await toEdge(COPY);
        await pressAt(COPY);
        await browser.waitUntil(async () => (await browser.$(COPIED).getText()) === words.diagnosticsCopied);
        await aFrameLater();
        await inTheBody(COPY, COPIED);

        // The same answer again changes nothing on the screen, and it still has to be seen.
        await toEdge(COPY);
        expect(contains(await boxOf(BODY), await boxOf(COPIED))).toBe(false);
        await pressAt(COPY);
        await browser.waitUntil(async () => contains(await boxOf(BODY), await boxOf(COPIED)), { timeout: 3_000 });
        expect(await written()).toEqual([TEXT, TEXT]);
      });

      it(`a copy pressed on the body's edge shows its refusal whole, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await standInClipboard(true);
        await browser.$(READ).click();
        await browser.waitUntil(() => activeMatches(PREVIEW));
        await toEdge(COPY);
        await pressAt(COPY);
        await browser.$(COPY_FAILED).waitForDisplayed();
        await aFrameLater();
        await inTheBody(COPY, COPY_FAILED);
        expect(await activeMatches(COPY)).toBe(true);
        expect(await browser.$(COPY_FAILED).getText()).toBe(words.diagnosticsCopyFailed);
        // Copy's right edge is the column's, in both languages.
        expect((await boxOf(COPY)).right).toBe((await boxOf(COPY_FAILED)).right);
      });

      // A Tab before the press is what could make it scroll, and a drag would lose its start.
      // With a modifier held, Tab moves no focus, so nothing takes it back before the press.
      for (const modifier of [null, "Control", "Alt", "Meta"]) {
        it(`a press in the text after ${modifier === null ? "a Tab" : `${modifier}+Tab`} moves nothing, ${locale} ${String(width)}x${String(height)}`, async () => {
          await open(locale, width, height);
          await standInClipboard(true);
          await browser.$(READ).click();
          await browser.waitUntil(() => activeMatches(PREVIEW));
          await browser.keys("Tab");
          expect(await activeMatches(COPY)).toBe(true);
          await pressAt(COPY);
          await browser.$(COPY_FAILED).waitForDisplayed();
          await aFrameLater();
          if (modifier !== null) {
            await browser.keys([modifier, "Tab"]);
            expect(await activeMatches(COPY)).toBe(true);
          }
          await boxHalfBelow();
          const before = await bodyTop();
          await pressTheText();
          expect(await activeMatches(PREVIEW)).toBe(true);
          await aFrameLater();
          expect(await bodyTop()).toBe(before);
          await inTheBody(COPY_FAILED);
        });
      }

      it(`a refused copy reached backwards by Tab shows the refusal whole, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await standInClipboard(true);
        await browser.$(READ).click();
        await browser.waitUntil(() => activeMatches(PREVIEW));
        await browser.execute(() => document.querySelector<HTMLElement>("[data-settings-close]")?.focus());
        await browser.keys("Tab");
        for (let press = 0; press < 6 && !(await activeMatches(COPY)); press += 1) await browser.keys(["Shift", "Tab"]);
        expect(await activeMatches(COPY)).toBe(true);
        await browser.keys("Enter");
        await browser.$(COPY_FAILED).waitForDisplayed();
        await aFrameLater();
        await inTheBody(COPY, COPY_FAILED);
      });

      // Support is last: reading makes it 200px taller, and a save's explanation
      // and its recovery buttons must not end up below it (ADR 0063, decision 10).
      it(`a failed save and its actions stay in the body, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await setInvokeResult("save_ui_preferences", SAVE_FAILED);
        await choose("compact");
        await browser.$("[data-save='failed']").waitForDisplayed();
        await inTheBody("[data-save='failed']", "[data-save-retry]", "[data-save-session-only]");
        expect(await browser.$("[data-save='failed']").getText()).toContain(words.writeNotPublished);
      });

      it(`a failed save stays in the body with the text already read, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await browser.$(READ).click();
        await browser.$(PREVIEW).waitForExist();
        await setInvokeResult("save_ui_preferences", SAVE_FAILED);
        await choose("compact");
        await browser.$("[data-save='failed']").waitForDisplayed();
        await inTheBody("[data-save='failed']", "[data-save-retry]", "[data-save-session-only]");
      });
    }

    it(`a stored record, a refused save and a failed read each stay in the body, ${String(width)}x${String(height)}`, async () => {
      // An unusable record starts the session in en, and the refused choice is zh-CN.
      await open("en", width, height, { load_ui_preferences: { outcome: "unusable", problem: "unsupportedVersion", revision: 0 } });
      await inTheBody("[data-stored-record='unusable']", "[data-stored-replace]");

      await setInvokeResult("save_ui_preferences", { outcome: "storedRecordUnusable", problem: "unsupportedVersion", revision: 0 });
      await choose("zh-CN");
      await browser.$("[data-save='refused']").waitForDisplayed();
      await inTheBody("[data-save='refused']");

      await setInvokeRejection(COMMAND, { kind: "preview_worker_unavailable", summary: "", detail: null, retryable: true });
      await browser.$(READ).click();
      await browser.$(FAILED).waitForDisplayed();
      await inTheBody(FAILED);
    });

    // Radix wraps Tab with preventScroll, and the text has scrolled the body down.
    for (const locale of ["en", "zh-CN"] as const) {
      it(`Tab past Close brings the first choice back into view, ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(locale, width, height);
        await browser.$(READ).click();
        await browser.$(PREVIEW).waitForExist();
        await browser.execute(() => document.querySelector<HTMLElement>("[data-settings-close]")?.focus());
        await browser.keys("Tab");
        expect(await activeMatches(FIRST_CHOICE)).toBe(true);
        await inTheBody(FIRST_CHOICE);
      });
    }
  }

  for (const [locale, words] of [["en", en], ["zh-CN", zh]] as const) {
    it(`a failed read says so in its own words and reads again, ${locale}`, async () => {
      await open(locale, 960, 640);
      await setInvokeRejection(COMMAND, { kind: "preview_worker_unavailable", summary: "the boundary's own words", detail: null, retryable: true });
      await browser.$(READ).click();
      const failed = browser.$(FAILED);
      await failed.waitForDisplayed();
      expect(await failed.getAttribute("role")).toBe("alert");
      expect(await failed.getText()).toBe(words.errPreviewWorkerUnavailable);
      await inTheBody(FAILED);
      expect(await browser.$(PREVIEW).isExisting()).toBe(false);
      expect(await browser.$(COPY).isExisting()).toBe(false);

      await setInvokeResult(COMMAND, TEXT);
      expect(await browser.$(READ).getText()).toBe(words.diagnosticsReadAgain);
      await browser.$(READ).click();
      await browser.$(PREVIEW).waitForExist();
      expect(await value()).toBe(TEXT);
      expect(await failed.isExisting()).toBe(false);
    });

    // Radix leaves the keyboard on the dialog when what held it goes, and the next
    // Tab from there starts over at the top, with the failure out of sight.
    for (const holder of [COPY, PREVIEW]) {
      it(`a failed read that takes away ${holder} gives the keyboard to the button, ${locale}`, async () => {
        await open(locale, 960, 640);
        await browser.$(READ).click();
        await browser.$(PREVIEW).waitForExist();
        await setInvokeRejection(COMMAND, { kind: "preview_worker_unavailable", summary: "", detail: null, retryable: true });
        // One script, so the keyboard has moved before the refusal's reaction runs.
        await browser.execute((read: string, target: string) => {
          document.querySelector<HTMLElement>(read)!.click();
          document.querySelector<HTMLElement>(target)!.focus();
        }, READ, holder);
        await browser.$(FAILED).waitForDisplayed();
        await browser.waitUntil(() => activeMatches(READ));
        await inTheBody(READ, FAILED);
        await browser.keys("Tab");
        expect(await activeMatches('[role="radio"]')).toBe(false);
        await inTheBody(FAILED);
      });
    }

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
      // A person can still select all of it and take it themselves. The press
      // moves nothing: the reason stays in sight, and a drag would keep its text.
      const before = await bodyTop();
      await pressTheText();
      expect(await activeMatches(PREVIEW)).toBe(true);
      expect(await bodyTop()).toBe(before);
      expect(contains(await boxOf(".settings-dialog-body"), await boxOf(COPY_FAILED))).toBe(true);
      await browser.keys(["Control", "a"]);
      expect(await browser.execute((css: string) => {
        const box = document.querySelector<HTMLTextAreaElement>(css)!;
        return box.value.slice(box.selectionStart, box.selectionEnd);
      }, PREVIEW)).toBe(TEXT);
    });

    for (const ending of ["resolve", "reject"] as const) {
      it(`a copy still out when the text is read again claims nothing (${ending}), ${locale}`, async () => {
        await open(locale, 960, 640);
        await holdCopies();
        await browser.$(READ).click();
        await browser.$(PREVIEW).waitForExist();
        await browser.$(COPY).click();
        await setInvokeResult(COMMAND, SECOND_READING);
        await browser.$(READ).click();
        await browser.waitUntil(async () => (await value()) === SECOND_READING);
        await endHeldCopy(ending);
        expect(await browser.$(COPIED).getText()).toBe("");
        expect(await browser.$(COPY_FAILED).isExisting()).toBe(false);
      });
    }
  }
});
