/**
 * Real-WebView rendered QA: the compiled application, driven through WebDriver.
 *
 * What this layer adds over browser mode is that the thing under test is the
 * shipped composition — the real Rust process, the real IPC plumbing, the real
 * WebView2 renderer — rather than the frontend alone. What it cannot add is
 * authority over a native save dialog: that window belongs to the operating
 * system, not to this document, and no WebDriver session owns it. See
 * `e2e/native/` for that question.
 *
 * The binary it drives is built with `--features e2e`, which is off by default
 * and never enabled for a release. That feature compiles in exactly one thing:
 * an appended initialization script that can answer the application's own
 * commands from a table the page can write. No server, port or remote-control
 * surface is compiled in at any time -- the WebDriver session is external
 * (`tauri-driver` in front of the platform WebDriver), which is why a default
 * build carries nothing at all rather than carrying something switched off.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = "http://127.0.0.1:1420";

/**
 * The dev server this run needs, started here rather than by the service.
 *
 * The service's own `devServer` option applies to browser mode only, and a
 * debug Tauri build loads `devUrl` from `tauri.conf.json` rather than an
 * embedded bundle -- so without this the application launches a real window
 * around the platform's network error page, which is a real launch of nothing
 * worth asserting on.
 */
let devServer: ChildProcess | undefined;

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

/** The debug binary `pnpm e2e:build` produces. */
const APP_BINARY = resolve(HERE, "..", "target", "debug", "mscanvas-desktop.exe");

export const config: WebdriverIO.Config = {
  runner: "local",
  tsConfigPath: resolve(HERE, "tsconfig.json"),

  specs: ["./specs/**/*.tauri.e2e.ts"],
  // One window at a time. The application keeps one session's worth of state in
  // Rust, and two instances would be two sessions competing for it.
  maxInstances: 1,

  capabilities: [
    {
      browserName: "tauri",
      "wdio:tauriServiceOptions": {
        appBinaryPath: APP_BINARY,
        // `tauri-driver` in front of the platform WebDriver: the long-standing
        // Tauri path, and the one that needs nothing compiled into the
        // application. The service's embedded provider would have needed a
        // WebDriver server plugin inside the binary; it never opened its port
        // for this application on this machine, and not needing it at all is
        // the better answer anyway.
        driverProvider: "external",
      },
    },
  ],

  async onPrepare(): Promise<void> {
    if (await reachable(DEV_SERVER_URL)) {
      return;
    }
    devServer = spawn(
      process.execPath,
      ["./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1420"],
      { cwd: resolve(HERE, "..", "apps", "desktop"), stdio: "ignore" },
    );
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (await reachable(DEV_SERVER_URL)) {
        return;
      }
      await new Promise((done) => setTimeout(done, 500));
    }
    throw new Error(`the dev server did not become reachable at ${DEV_SERVER_URL}`);
  },

  onComplete(): void {
    devServer?.kill();
    devServer = undefined;
  },

  services: [
    [
      "@wdio/tauri-service",
      {},
    ],
  ],

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    // A real launch pays for process start, WebView2 initialisation and the
    // application's own first backend look.
    timeout: 180_000,
  },

  logLevel: "warn",
  waitforTimeout: 20_000,
  connectionRetryTimeout: 180_000,
  connectionRetryCount: 3,
};
