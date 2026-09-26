/**
 * Manual visual review of the PM9 controlled scenarios. TEST-ONLY.
 *
 * Opens one of PM9's controlled states in a visible Chrome window and leaves
 * it there for a person to inspect, until they end it. What they see is the
 * real production frontend, served by Vite, with the Tauri backend replaced at
 * the IPC boundary by the same answer tables the PM9.1 spec asserts
 * (`support/pm9Scenarios.ts`). Nothing here is reachable from the application:
 * no route, query flag or menu. The file sits outside the automated glob
 * (`specs/**\/*.browser.e2e.ts`) and runs only through `pnpm qa:pm9:manual`
 * (`wdio.manual.conf.ts`). How to run it, and how to compare it with the v5.11
 * reference, is in `e2e/README.md`.
 *
 * Evidence boundary: the production frontend over a controlled IPC fixture. It
 * is not Rust execution, not native WebView2 or its DPI, not ProteoWizard and
 * not a scientific validation. A command the scenario's table does not answer
 * is refused at the boundary, as in the automated suite.
 *
 * Keys, pressed in the page with Alt+Shift:
 *   Right / Left   next / previous viewport in the sweep
 *   Down / Up      next / previous scenario
 *   L              the other language (en / zh-CN)
 *   Q              end the session; closing the window, or Ctrl+C in the
 *                  terminal, ends it too
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cdp, metrics } from "../support/cdp";
import { installIpcBoundary } from "../support/harness";
import { SCENARIOS, scenario, type Locale } from "../support/pm9Scenarios";

/**
 * Logical viewports to sweep. 960x640, 1366x768 and 1920x1080 are the
 * automated contract's anchors; the rest are review points only, and become a
 * regression case only when a real defect is found at one.
 */
const VIEWPORTS = [
  "960x640",
  "1024x768",
  "1152x720",
  "1280x720",
  "1280x800",
  "1366x768",
  "1440x900",
  "1536x864",
  "1680x1050",
  "1920x1080",
  "2560x1440",
] as const;
const ANCHORS: readonly string[] = ["960x640", "1366x768", "1920x1080"];
const LOCALES = ["en", "zh-CN"] as const satisfies readonly Locale[];

/** One of `options`, from the environment, or `fallback` when it is unset. */
function chosen<T extends string>(name: string, options: readonly T[], fallback: T): T {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!(options as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of: ${options.join(", ")}.`);
  }
  return value as T;
}

const state = {
  scenario: SCENARIOS.indexOf(chosen("MSCANVAS_PM9_MANUAL_SCENARIO", SCENARIOS, "populated")),
  locale: chosen("MSCANVAS_PM9_MANUAL_LOCALE", LOCALES, "en") as Locale,
  viewport: VIEWPORTS.indexOf(chosen("MSCANVAS_PM9_MANUAL_VIEWPORT", VIEWPORTS, "1366x768")),
};

/**
 * `MSCANVAS_PM9_MANUAL_SMOKE=true` checks the harness itself and exits: it
 * opens the scenario, walks the whole sweep, and presses one review key. Not
 * an acceptance of anything the pages show.
 */
const SMOKE = process.env["MSCANVAS_PM9_MANUAL_SMOKE"] === "true";

const OUTPUT = resolve(process.env["MSCANVAS_PM9_MANUAL_OUTPUT"] ?? "test-results/pm9-manual");

/** The page's key queue: filled by the listener below, drained by the loop. */
const KEYS = "__mscanvasManualReviewKeys__";

/** Installs the review keys for every document the session loads. */
async function listenForKeys() {
  await browser.addInitScript((key: string) => {
    const queue: string[] = [];
    (window as unknown as Record<string, unknown>)[key] = queue;
    const commands: Record<string, string> = {
      ArrowRight: "nextViewport",
      ArrowLeft: "previousViewport",
      ArrowDown: "nextScenario",
      ArrowUp: "previousScenario",
      KeyL: "language",
      KeyQ: "end",
    };
    window.addEventListener(
      "keydown",
      (event) => {
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        const command = commands[event.code];
        if (command === undefined) return;
        // Taken before the application sees it, so a review key never also
        // acts on the page under review.
        event.preventDefault();
        event.stopImmediatePropagation();
        queue.push(command);
      },
      true,
    );
  }, KEYS);
}

function describeState(): string {
  const size = VIEWPORTS[state.viewport]!;
  return `${SCENARIOS[state.scenario]!} · ${state.locale} · ${size}${ANCHORS.includes(size) ? " (automated anchor)" : ""}`;
}

/** Sizes the page, waits for the layout to follow, and keeps a screenshot. */
async function sizeAndCapture() {
  const [width, height] = VIEWPORTS[state.viewport]!.split("x").map(Number) as [number, number];
  await metrics(width, height);
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const shell = document.querySelector(".workbench-shell");
        return shell !== null && Math.abs(shell.getBoundingClientRect().height - innerHeight) <= 1;
      }),
    { timeout: 10_000, interval: 50, timeoutMsg: "the shell never filled the resized viewport" },
  );
  const label = `${SCENARIOS[state.scenario]!}-${state.locale}-${VIEWPORTS[state.viewport]!}`;
  const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof shot.data === "string") writeFileSync(join(OUTPUT, `${label}.png`), Buffer.from(shot.data, "base64"));
  console.log(`PM9 manual review: ${describeState()} -- ${join(OUTPUT, `${label}.png`)}`);
}

/** Opens the current scenario in the current language, as PM9.1's `open()` does. */
async function show() {
  await installIpcBoundary(scenario(SCENARIOS[state.scenario]!, state.locale));
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
  await sizeAndCapture();
}

/**
 * Whether the review window's browser is still there, asked of its own
 * DevTools endpoint. Once the window is closed that endpoint is gone at once,
 * while a WebDriver command to it waits minutes for the driver to give up.
 */
async function windowOpen(): Promise<boolean> {
  const address = browser.capabilities["goog:chromeOptions"]?.debuggerAddress;
  if (typeof address !== "string") return true;
  try {
    return (await fetch(`http://${address}/json/version`, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}

/** The page's pending review keys; `null` once the window or session is gone. */
async function pendingKeys(): Promise<string[] | null> {
  if (!(await windowOpen())) return null;
  try {
    return await browser.execute(
      (key: string) => ((window as unknown as Record<string, string[] | undefined>)[key] ?? []).splice(0),
      KEYS,
    );
  } catch {
    return null;
  }
}

function step(index: number, by: number, length: number): number {
  return (index + by + length) % length;
}

describe("PM9 manual visual review (test-only)", () => {
  it("opens a controlled PM9 scenario and stays until the reviewer ends it", async () => {
    mkdirSync(OUTPUT, { recursive: true });
    await listenForKeys();
    await show();

    if (SMOKE) {
      // The harness, not the pages: the production surface is up in the
      // chosen language, every sweep size is applied, and a review key is
      // received without reaching the application.
      expect(await browser.execute(() => document.documentElement.lang)).toBe(state.locale);
      expect(await browser.$(".workbench-shell").isDisplayed()).toBe(true);
      for (let index = 0; index < VIEWPORTS.length; index += 1) {
        state.viewport = index;
        await sizeAndCapture();
        const [width, height] = VIEWPORTS[index]!.split("x").map(Number);
        expect(await browser.execute(() => [innerWidth, innerHeight])).toEqual([width, height]);
      }
      // One chord: every key goes down, then every key comes up.
      await browser.keys(["Alt", "Shift", "ArrowRight"]);
      expect(await pendingKeys()).toEqual(["nextViewport"]);
      return;
    }

    console.log(
      [
        "PM9 manual review is open. In the page, with Alt+Shift:",
        "  Right / Left  next / previous viewport    Down / Up  next / previous scenario",
        "  L             the other language           Q          end the session",
        "Closing the window or Ctrl+C here also ends it. Screenshots: " + OUTPUT,
      ].join("\n"),
    );
    for (;;) {
      const keys = await pendingKeys();
      if (keys === null) return;
      for (const key of keys) {
        if (key === "end") return;
        if (key === "nextViewport" || key === "previousViewport") {
          state.viewport = step(state.viewport, key === "nextViewport" ? 1 : -1, VIEWPORTS.length);
          await sizeAndCapture();
        } else if (key === "nextScenario" || key === "previousScenario") {
          state.scenario = step(state.scenario, key === "nextScenario" ? 1 : -1, SCENARIOS.length);
          await show();
        } else if (key === "language") {
          state.locale = state.locale === "en" ? "zh-CN" : "en";
          await show();
        }
      }
      await browser.pause(250);
    }
  });
});
