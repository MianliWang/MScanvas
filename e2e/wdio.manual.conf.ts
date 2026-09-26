/**
 * The manual PM9 review harness: `pnpm qa:pm9:manual`. Test-only.
 *
 * The browser suite's own composition -- Vite, real Chrome, the Tauri backend
 * replaced at the IPC boundary and nothing else -- headed, pointed at the one
 * manual review spec, with no per-test timeout, so the window stays open until
 * a person ends it. The automated suite's config and glob are untouched: that
 * spec lives outside `specs/`, and nothing but this config names it.
 */

import { chromeArgs, config as browserConfig } from "./wdio.browser.conf";

const [automated] = browserConfig.capabilities as WebdriverIO.Capabilities[];
if (automated === undefined) {
  throw new Error("The browser config names no capability to review with.");
}

export const config: WebdriverIO.Config = {
  ...browserConfig,
  specs: ["./manual/pm9-scenario.manual.ts"],
  capabilities: [
    {
      ...automated,
      "goog:chromeOptions": { ...automated["goog:chromeOptions"], args: chromeArgs(true) },
    },
  ],
  // A review lasts as long as the person doing it. Neither 0 nor Mocha's
  // maximum: Mocha stores both as 0 ("disabled"), and WebdriverIO, which
  // wraps each test in its own timer from that stored value, then times out
  // at once. About 23 days, just under the maximum, stands in for "none".
  mochaOpts: { ...browserConfig.mochaOpts, timeout: 2_000_000_000 },
  // The review polls the page for its keys; the Tauri service's per-command
  // browser-mode warning would otherwise fill the terminal the instructions
  // are printed in.
  logLevel: "error",
};
