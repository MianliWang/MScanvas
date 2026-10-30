/**
 * The Conversion surface, reached the way a reader reaches it since
 * M7.2.
 *
 * Three things changed under the M6 specs, and none of them is a product
 * defect: roster rows are `div[role=row]` rows, not `li.dataset-row`; a row
 * click views or highlights a row and never makes it a conversion member (the
 * checkbox does); and the Conversion surface is its own destination, mounted
 * but hidden until the header navigates to it. A spec that reached for the old
 * shapes waited sixty seconds on a selector that no longer exists and asserted
 * nothing (PM9 baseline §2).
 *
 * Everything here goes through the reader's controls: the row's own checkbox
 * and the header's own button, found by their visible names.
 */

import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";
import { revealRosterRow } from "./viewer";

/** The surface's own section, which owns its scroll. */
export const CONVERSION_SURFACE = "#workbench-conversion";

/** The next conversion's start control, never the adoption that precedes it. */
export const CONVERT = "button.conversion-start";

/** Under a finished queue, the control that brings the next conversion back. */
export const START_ANOTHER = "button[data-conversion-start-another]";

/**
 * Opens the next conversion under a finished queue, as its reader does: the
 * form, its summary and Convert stay off screen until asked for (rebuild
 * review 6).
 */
export async function startAnother(): Promise<void> {
  const control = browser.$(START_ANOTHER);
  await control.waitForDisplayed({ timeout: 15_000, timeoutMsg: "no Start another conversion under the finished queue" });
  await control.click();
  await browser.$(CONVERT).waitForExist({ timeout: 15_000, timeoutMsg: "Start another conversion brought no Convert back" });
}

/**
 * Makes sure the next conversion is on screen, for the real-app specs that run
 * one queue after another: returns once Convert is there, pressing Start
 * another conversion when a finished queue holds it back. A no-op on an idle
 * slot, and it waits out a queue that is still settling on screen.
 */
export async function openNextConversion(scope = ""): Promise<void> {
  const another = `${scope} ${START_ANOTHER}`.trim();
  const convert = `${scope} ${CONVERT}`.trim();
  await browser.waitUntil(async () => {
    if (await browser.$(convert).isExisting()) return true;
    if (await browser.$(another).isExisting() && !(await isRefused(another))) await browser.$(another).click();
    return false;
  }, { timeout: 60_000, interval: 250, timeoutMsg: "the next conversion never came on screen" });
}

/**
 * Ticks each row's conversion checkbox, leaving a row already ticked as it is.
 *
 * Done before navigating: below 1050 px an open roster hides the Conversion
 * surface, and navigating folds it again.
 */
export async function checkMembers(handles: readonly string[]): Promise<void> {
  for (const handle of handles) {
    await revealRosterRow(handle);
    const box = browser.$(`.grouped-roster [data-handle="${handle}"] input[type="checkbox"]`);
    await box.waitForExist({ timeout: 15_000, timeoutMsg: `no conversion checkbox for ${handle}` });
    if (!(await box.isSelected())) await box.click();
    await browser.waitUntil(async () => box.isSelected(), {
      timeout: 15_000,
      timeoutMsg: `${handle} never became a conversion member`,
    });
  }
}

/** Presses the header's Conversion destination and waits for the surface. */
export async function showConversion(): Promise<void> {
  await browser.execute((labels: readonly string[]) => {
    [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => labels.includes(button.textContent ?? ""))
      ?.click();
  }, [en.conversionTask, zh.conversionTask]);
  await browser.$(CONVERSION_SURFACE).waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: "the Conversion surface never became visible",
  });
}

/** The header, then each member's checkbox, then the surface. */
export async function openConversion(members: readonly string[] = []): Promise<void> {
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 30_000 });
  await checkMembers(members);
  await showConversion();
}

/**
 * Whether a control says it cannot be used, by either mechanism.
 *
 * A refused primary moved from native `disabled` to `aria-disabled` (PM9
 * UI-24, PM9.4 R6), and WebDriver's `isEnabled` reads only the first. Asking
 * for both keeps a wait for "ready" from passing the moment the control
 * appears.
 */
export async function isRefused(selector: string): Promise<boolean> {
  return browser.execute((css: string) => {
    const node = document.querySelector<HTMLButtonElement>(css);
    if (node === null) return true;
    return node.disabled || node.getAttribute("aria-disabled") === "true";
  }, selector);
}

/** Waits until a control may be pressed. */
export async function waitUntilOffered(selector: string, timeout = 30_000): Promise<void> {
  await browser.$(selector).waitForExist({ timeout });
  await browser.waitUntil(async () => !(await isRefused(selector)), {
    timeout,
    timeoutMsg: `${selector} was never offered`,
  });
}
