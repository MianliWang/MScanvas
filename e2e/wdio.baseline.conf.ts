/**
 * The PM9.1 journey baseline (J1–J6): a historical frontend, measured. Test-only.
 *
 * The browser suite's own composition -- Vite, real Chrome, the Tauri backend
 * replaced at the IPC boundary and nothing else -- serving an extracted
 * `apps/desktop` instead of the checkout's. `baseline/prepare-baseline-app.ps1`
 * extracts it and prints the two variables this config needs:
 *
 * - `MSCANVAS_BASELINE_APP_DIR`, the extracted `apps/desktop`;
 * - `MSCANVAS_BASELINE_VITE_CONFIG`, a wrapper over that tree's own Vite config
 *   that gives it a cache of its own, so the checkout's cache is never shared.
 *
 * A server already listening on the port is never reused: it could be the
 * checkout's own frontend. The specs live in `baseline/`, outside `specs/`, so
 * the automated suite's glob never runs them, and nothing but this config
 * names them.
 */

import { relative, resolve } from "node:path";

import { config as browserConfig } from "./wdio.browser.conf";

function requiredPath(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must name the extracted frontend; run baseline/prepare-baseline-app.ps1 first.`);
  }
  return resolve(value);
}

const APP = requiredPath("MSCANVAS_BASELINE_APP_DIR");
const VITE_CONFIG = requiredPath("MSCANVAS_BASELINE_VITE_CONFIG");

const [service] = (browserConfig.services ?? []) as [string, Record<string, unknown>][];
if (service === undefined) {
  throw new Error("The browser config names no service to serve the frontend with.");
}
const [name, options] = service;
const devServer = options["devServer"] as Record<string, unknown>;
const port = new URL(String(browserConfig.baseUrl)).port;

export const config: WebdriverIO.Config = {
  ...browserConfig,
  specs: ["./baseline/**/*.e2e.ts"],
  services: [
    [
      name,
      {
        ...options,
        devServer: {
          ...devServer,
          // The extracted tree's Vite, through its joined node_modules, with
          // the wrapper config named relative to it (no spaces to quote).
          command: `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --config ${relative(APP, VITE_CONFIG).replaceAll("\\", "/")}`,
          cwd: APP,
          reuseExistingServer: false,
        },
      },
    ],
  ],
};
