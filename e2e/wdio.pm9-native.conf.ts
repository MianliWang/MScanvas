/**
 * PM9 native integrated rendering preparation: UNRUN.
 *
 * Dedicated dispatch, not M7.5 readiness. The launcher must supply a fresh
 * readiness flag/run ID, source identity, approved binary digest,
 * and an existing campaign-owned preference root before any driver starts.
 * The specimen uses the e2e binary's controlled IPC, not a release binary.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as tauriConfig } from "./wdio.tauri.conf";
import { PREFERENCE_ROOT_VARIABLE, requireOwnedPreferenceRoot } from "./support/m75PreferenceRoot";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BINARY = resolve(REPOSITORY, "target/e2e/release/mscanvas-desktop.exe");
const SPEC = resolve(REPOSITORY, "e2e/specs/pm9.7-integrated.native.e2e.ts");
// The candidate under test: beta-1 readiness HEAD 7cf4c74 (PR #134), whose
// apps/desktop differs from PM9's frozen 30b855f (tree 39d65578). The guard
// still refuses any binary/source mismatch against this pinned candidate.
const FROZEN_PRODUCTION = "7cf4c7408dabfe53ccbc7d03c85892a5f01d0e7e";
const FROZEN_DESKTOP_TREE = "83d2e69ecb28d5e605bba178c62790e65d3db4da";
const PRODUCTION_PATHS = ["apps/desktop", "crates", "Cargo.toml", "Cargo.lock", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".github"];
const RUN_ROOT_VARIABLE = "MSCANVAS_PM9_NATIVE_RUN_ROOT";
let driver: ChildProcess | undefined;
let runRoot = "";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required for this native dispatch.`);
  return value;
}

function configuredPort(name: string, fallback: number): number {
  const value = process.env[name] ?? String(fallback);
  const port = /^\d+$/u.test(value) ? Number(value) : 0;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a port from 1 to 65535.`);
  return port;
}

const DRIVER_PORT = configuredPort("MSCANVAS_TAURI_DRIVER_PORT", 4444);
const NATIVE_PORT = configuredPort("MSCANVAS_TAURI_NATIVE_PORT", 4445);

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPOSITORY, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 }).trim();
}

/** Uncommitted test/document bytes are attributable without requiring a commit. */
function sourceChanges() {
  const tracked = git("diff", "--name-only", "HEAD", "-z").split("\0").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  const dirtyProduction = git("diff", "--name-only", "HEAD", "--", ...PRODUCTION_PATHS);
  const untrackedProduction = untracked.filter(path => PRODUCTION_PATHS.some(prefix => path === prefix || path.startsWith(`${prefix}/`)));
  if (dirtyProduction !== "" || untrackedProduction.length > 0) {
    throw new Error("Production/dependency paths differ from HEAD; this rendering dispatch cannot change the frozen product.");
  }
  const patch = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: REPOSITORY, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const files = [...new Set([...tracked, ...untracked])].sort().map(path => {
    const full = resolve(REPOSITORY, path);
    const bytes = existsSync(full) ? readFileSync(full) : null;
    return { path, exists: bytes !== null, bytes: bytes?.length ?? 0, sha256: bytes === null ? null : createHash("sha256").update(bytes).digest("hex") };
  });
  return { committed: files.length === 0, patchSha256: createHash("sha256").update(patch).digest("hex"), files };
}

function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
}

/** Read-only gate, repeated in the worker before application session creation. */
function dispatchIdentity() {
  if (process.platform !== "win32") throw new Error("This dispatch requires the real Windows WebView2 host.");
  if (process.env.MSCANVAS_PM9_NATIVE_DISPATCH_READY !== "true") {
    throw new Error("Fresh PM9 native dispatch readiness is required; no driver or app may start.");
  }
  const dispatchId = required("MSCANVAS_PM9_NATIVE_DISPATCH_ID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u.test(dispatchId)) throw new Error("The PM9 native dispatch ID is invalid.");
  if (DRIVER_PORT === NATIVE_PORT) throw new Error("The driver and native driver ports must differ.");
  const expectedHead = required("MSCANVAS_PM9_NATIVE_SOURCE_HEAD").toLowerCase();
  const expectedBinarySha256 = required("MSCANVAS_PM9_NATIVE_BINARY_SHA256").toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(expectedHead) || !/^[0-9a-f]{64}$/u.test(expectedBinarySha256)) {
    throw new Error("PM9 native source and binary identities must be complete Git/SHA-256 digests.");
  }
  const head = git("rev-parse", "HEAD");
  if (head !== expectedHead || git("rev-parse", "HEAD:apps/desktop") !== FROZEN_DESKTOP_TREE ||
      git("rev-parse", `${FROZEN_PRODUCTION}:apps/desktop`) !== FROZEN_DESKTOP_TREE ||
      git("diff", "--name-only", FROZEN_PRODUCTION, "HEAD", "--", ...PRODUCTION_PATHS) !== "") {
    throw new Error("The source HEAD or frozen production/dependency identity does not match this rendering dispatch.");
  }
  if (!existsSync(BINARY) || !statSync(BINARY).isFile() || digest(BINARY) !== expectedBinarySha256) {
    throw new Error("The existing e2e binary does not match this dispatch's approved SHA-256.");
  }
  const preferenceRoot = requireOwnedPreferenceRoot(process.env[PREFERENCE_ROOT_VARIABLE]);
  const realPreferenceRoot = realpathSync(preferenceRoot);
  if (!within(realpathSync(resolve(REPOSITORY, ".tmp/m75-evidence")), realPreferenceRoot)) {
    throw new Error("The native preference root resolves outside the campaign-owned evidence area.");
  }
  const outputRoot = required("MSCANVAS_PM9_NATIVE_OUTPUT_ROOT");
  if (!isAbsolute(outputRoot) || !existsSync(outputRoot) || !statSync(outputRoot).isDirectory()) {
    throw new Error("The PM9 native evidence root must already exist as an absolute directory.");
  }
  const canonicalOutput = realpathSync(outputRoot);
  if (!within(realpathSync(REPOSITORY), canonicalOutput) ||
      !within(resolve(realpathSync(REPOSITORY), ".tmp/pm9-native-evidence"), canonicalOutput)) {
    throw new Error("PM9 native evidence must resolve under this repository's .tmp/pm9-native-evidence.");
  }
  return {
    dispatchId, head, sourceTree: git("rev-parse", "HEAD^{tree}"),
    frozenProduction: FROZEN_PRODUCTION, frozenDesktopTree: FROZEN_DESKTOP_TREE, changes: sourceChanges(),
    binary: realpathSync(BINARY), binarySha256: expectedBinarySha256,
    preferenceRoot: realPreferenceRoot, outputRoot: canonicalOutput,
  };
}

function listening(port: number): Promise<boolean> {
  return new Promise(resolveListening => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (value: boolean) => { socket.destroy(); resolveListening(value); };
    socket.setTimeout(1_500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function record(label: string, value: unknown): void {
  if (runRoot !== "") writeFileSync(join(runRoot, `${label}.json`), JSON.stringify(value, null, 2));
}

function stopOwnedDriver(): void {
  const owned = driver;
  driver = undefined;
  owned?.kill();
}

export const config: WebdriverIO.Config = {
  ...tauriConfig,
  specs: [SPEC],
  maxInstances: 1,
  port: DRIVER_PORT,
  capabilities: [{ "tauri:options": { application: BINARY } } as WebdriverIO.Capabilities],
  // A failed session is a recorded refusal; it is not silently relaunched.
  connectionRetryCount: 0,
  mochaOpts: { ...tauriConfig.mochaOpts, timeout: 240_000 },

  async onPrepare(): Promise<void> {
    const identity = dispatchIdentity();
    if (await listening(DRIVER_PORT) || await listening(NATIVE_PORT)) {
      throw new Error("A driver port is already occupied. This dispatch refuses driver reuse.");
    }
    // The operator supplies a new run ID for each attempt; no new user approval
    // is implied by that bookkeeping input.
    const claim = join(identity.outputRoot, `dispatch-${identity.dispatchId}.claim.json`);
    writeFileSync(claim, JSON.stringify({ ...identity, claimedUtc: new Date().toISOString() }, null, 2), { flag: "wx" });
    runRoot = mkdtempSync(join(identity.outputRoot, `${identity.dispatchId}-`));
    process.env[RUN_ROOT_VARIABLE] = runRoot;
    record("dispatch", {
      preparationStatus: "UNRUN", evidenceLayer: "native WebView2 with controlled IPC",
      ...identity, runRoot, driverPort: DRIVER_PORT, nativePort: NATIVE_PORT,
      boundary: "Not provider, engine, installed-product or release acceptance. Initial app mount may perform the separately permitted backend discovery probe.",
    });
    driver = spawn("tauri-driver", ["--port", String(DRIVER_PORT), "--native-port", String(NATIVE_PORT)], {
      stdio: "ignore", windowsHide: true, env: process.env,
    });
    try {
      let failed: Error | undefined;
      driver.once("error", error => { failed = error; });
      record("driver-start", { pid: driver.pid ?? null, parentPid: process.pid, launchedUtc: new Date().toISOString() });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (failed !== undefined) throw failed;
        if (driver.exitCode !== null) throw new Error(`The owned tauri-driver exited with ${driver.exitCode}.`);
        if (await listening(DRIVER_PORT)) return;
        await new Promise(done => setTimeout(done, 250));
      }
      throw new Error("The owned PM9 native driver never became reachable.");
    } catch (error) {
      try {
        record("driver-start-refused", { pid: driver.pid ?? null, observedUtc: new Date().toISOString(), error: String(error) });
      } finally {
        stopOwnedDriver();
      }
      throw error;
    }
  },

  beforeSession(_configuration, capabilities, specs): void {
    const identity = dispatchIdentity();
    const application = (capabilities as unknown as { "tauri:options"?: { application?: string } })["tauri:options"]?.application;
    if (application === undefined || realpathSync(application) !== identity.binary ||
        specs.length !== 1 || resolve(specs[0]!) !== SPEC) {
      throw new Error("The PM9 native session must use exactly its approved binary and dedicated spec.");
    }
    const inheritedRoot = required(RUN_ROOT_VARIABLE);
    if (!within(identity.outputRoot, realpathSync(inheritedRoot)) ||
        !existsSync(join(inheritedRoot, "dispatch.json"))) {
      throw new Error("The worker did not inherit its own PM9 native dispatch record.");
    }
    const retained = JSON.parse(readFileSync(join(inheritedRoot, "dispatch.json"), "utf8")) as { dispatchId?: string; head?: string; binarySha256?: string; changes?: unknown };
    if (retained.dispatchId !== identity.dispatchId || retained.head !== identity.head || retained.binarySha256 !== identity.binarySha256 ||
        JSON.stringify(retained.changes) !== JSON.stringify(identity.changes)) {
      throw new Error("The worker's dispatch identity does not match the launcher.");
    }
  },

  onComplete(exitCode): void {
    try {
      record("driver-stop", { pid: driver?.pid ?? null, exitCode, requestedUtc: new Date().toISOString(), alreadyExited: driver?.exitCode ?? null });
    } finally {
      stopOwnedDriver();
    }
  },
};
