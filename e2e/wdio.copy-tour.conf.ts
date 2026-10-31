/**
 * The copy tour alone (`pnpm e2e:copy-tour`), in the browser suite's own
 * composition. The browser suite excludes it, because it writes screenshots for
 * a person to read rather than asserting anything about the copy.
 */

import { config as browserConfig } from "./wdio.browser.conf";

export const config: WebdriverIO.Config = {
  ...browserConfig,
  specs: ["./specs/copy-tour.browser.e2e.ts"],
  exclude: [],
};
