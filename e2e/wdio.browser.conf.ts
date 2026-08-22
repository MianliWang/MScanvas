/**
 * Browser-mode rendered QA: the real frontend, in real Chrome, over real Vite.
 *
 * The Tauri backend is replaced at the `invoke` boundary and nothing else is.
 * That is the whole point of this layer — it can say what the interface looks
 * like and how it behaves at a given viewport, which jsdom cannot, without
 * needing a compiled Tauri binary or a platform WebDriver.
 *
 * It deliberately cannot say anything about a native save dialog. That is the
 * operating system's window, not this document's, and no browser driver has
 * authority over it. See `e2e/native/` for that question.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Not Tauri's conventional 1420. Windows reserves dynamic TCP ranges for
// Hyper-V, and on a machine where one of them covers 1420 a dev server cannot
// bind it at all -- the failure is `EACCES` before anything under test has run.
// This suite needs *a* port rather than that one, so it names one outside every
// reserved range and leaves the application's own configuration alone.
const DEV_SERVER_URL = "http://127.0.0.1:5273";

export const config: WebdriverIO.Config = {
  runner: "local",
  // Absolute. The runner exports its TypeScript loader through `NODE_OPTIONS`,
  // which the dev-server child inherits -- and a relative path resolved against
  // that child's own working directory names a file that is not there.
  tsConfigPath: resolve(HERE, "tsconfig.json"),

  // So a spec can navigate with `browser.url("/")` and say nothing about where
  // the server is.
  baseUrl: DEV_SERVER_URL,

  specs: ["./specs/**/*.browser.e2e.ts"],
  maxInstances: 1,

  capabilities: [
    {
      browserName: "tauri",
      "wdio:tauriServiceOptions": {
        mode: "browser",
        devServerUrl: DEV_SERVER_URL,
      },
      // Headless by default so the suite runs the same way on a workstation and
      // on a machine with no display. `--window-size` fixes the *outer* window;
      // every viewport assertion sets the inner size explicitly before reading a
      // box, so nothing here decides what those tests measure.
      "goog:chromeOptions": {
        args: [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--window-size=1920,1080",
          "--force-device-scale-factor=1",
          "--hide-scrollbars",
        ],
      },
    },
  ],

  services: [
    [
      "@wdio/tauri-service",
      {
        mode: "browser",
        devServerUrl: DEV_SERVER_URL,
        // Started and stopped by the service, so one command runs the suite.
        // Reused when a dev server is already up, which is what makes local
        // iteration bearable.
        // Vite's own binary, not `pnpm dev`. Going through the package manager
        // put a second tool between this suite and the server it needs, and
        // that tool failed in the spawned environment for reasons that have
        // nothing to do with the application under test. One process, one
        // dependency, one failure mode.
        devServer: {
          command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5273",
          cwd: resolve(HERE, "..", "apps", "desktop"),
          timeoutMs: 120_000,
          reuseExistingServer: true,
        },
      },
    ],
  ],

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    // A rendered assertion waits for a dev server, a bundle and a mount. The
    // budget is per test rather than per suite, and is generous because a slow
    // first compile is not a failure.
    timeout: 120_000,
  },

  logLevel: "warn",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
};
