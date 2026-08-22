/**
 * Real-WebView rendered QA: the compiled application, driven through WebDriver.
 *
 * What this layer adds over browser mode is that the thing under test is the
 * shipped composition — the real Rust process, the real IPC plumbing, the real
 * WebView2 renderer — rather than the frontend alone. What it still cannot add
 * is authority over a native save dialog: that window belongs to the operating
 * system, not to this document, and no WebDriver session owns it. `e2e/native/`
 * drives that one with UI Automation instead.
 *
 * ## The binary
 *
 * Built with `--features e2e,custom-protocol`, optimised, into its own target
 * directory.
 *
 * `custom-protocol` is what a release build has: `tauri::is_dev()` is
 * `!cfg!(feature = "custom-protocol")`, so with it on the application loads the
 * frontend it was built with instead of pointing a window at a development
 * server that has to exist first. That removes a moving part from every run --
 * and on a machine where Windows has reserved the port a dev server would want,
 * it removes the reason these tests could not run at all.
 *
 * `e2e` is off by default and never enabled for a release. It compiles in two
 * things: an appended initialization script that can answer the application's
 * own commands from a table the page can write, and one synthetic spectrum
 * installed into the ordinary export slot at startup. Neither is a command, so
 * no build registers anything extra.
 *
 * ## Why `tauri-driver` directly
 *
 * `@wdio/tauri-service` is deliberately not used here. Its `beforeCommand` hook
 * probes the application for a WDIO guest plugin before *every* WebDriver
 * command, and this application does not carry one -- the probe retries a
 * hundred times at fifty milliseconds before giving up, so every click and every
 * poll cost five seconds. A single selection took two minutes.
 *
 * Nothing in these specs uses the service's API: they drive the interface with
 * ordinary WebDriver calls and reach the IPC boundary with `browser.execute`. So
 * the session is the long-standing Tauri one -- `tauri-driver` in front of the
 * platform WebDriver -- started here and stopped here.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The binary `pnpm e2e:build` produces.
 *
 * Optimised, and in its own target directory. Optimised because this suite
 * rasterizes real figures through `resvg`. Its own directory because the feature
 * set differs from the one `pnpm tauri build` produces, and sharing `target/`
 * would make the two rebuild each other every time.
 */
const APP_BINARY = resolve(HERE, "..", "target", "e2e", "release", "mscanvas-desktop.exe");

/** Where `tauri-driver` listens, and where it expects the platform driver. */
const DRIVER_PORT = 4444;
const NATIVE_DRIVER_PORT = 4445;

let driver: ChildProcess | undefined;

async function reachable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const config: WebdriverIO.Config = {
  runner: "local",
  // Absolute. The runner exports its TypeScript loader through `NODE_OPTIONS`,
  // which a spawned child inherits -- and a relative path resolved against that
  // child's own working directory names a file that is not there.
  tsConfigPath: resolve(HERE, "tsconfig.json"),

  specs: ["./specs/**/*.tauri.e2e.ts"],
  // One window at a time. The application keeps one session's worth of state in
  // Rust, and two instances would be two sessions competing for it -- including
  // for one system clipboard.
  maxInstances: 1,

  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  path: "/",

  capabilities: [
    {
      // What `tauri-driver` reads to know which application to launch. There is
      // no `browserName`: the session is the application's own WebView, and
      // naming a browser here would ask the driver for one it cannot provide.
      "tauri:options": { application: APP_BINARY },
    } as WebdriverIO.Capabilities,
  ],

  async onPrepare(): Promise<void> {
    if (await reachable(DRIVER_PORT)) {
      return;
    }
    driver = spawn(
      "tauri-driver",
      ["--port", String(DRIVER_PORT), "--native-port", String(NATIVE_DRIVER_PORT)],
      { stdio: "ignore" },
    );
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await reachable(DRIVER_PORT)) {
        return;
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(
      `tauri-driver did not become reachable on ${DRIVER_PORT}. It is installed with ` +
        "`cargo install tauri-driver --locked` and has to be on PATH.",
    );
  },

  onComplete(): void {
    driver?.kill();
    driver = undefined;
  },

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    // A real launch pays for process start and WebView2 initialisation; a figure
    // export pays for a rasterization and, in `e2e/native/`, for a modal dialog
    // that has to be found by another process.
    timeout: 180_000,
  },

  logLevel: "warn",
  waitforTimeout: 20_000,
  connectionRetryTimeout: 180_000,
  connectionRetryCount: 3,
};
