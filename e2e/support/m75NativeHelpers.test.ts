/**
 * The two new M7.5 native helpers, tested without the application.
 *
 * One of them makes Windows refuse to replace a preference record, and the
 * campaign's whole write-failure chain rests on that refusal being real: a hold
 * that silently did not hold would turn "the application handled a failed save"
 * into a scenario where nothing failed at all. The other clicks a newly
 * launched window into the foreground, and its value is entirely in what it
 * refuses to click.
 *
 * So both are exercised here first, against real files and real processes,
 * before any desktop time is asked for. What cannot be tested without a build
 * -- that activation only ever targets this run's own binary, and the caption
 * hit test -- is noted where it is checked rather than asserted here.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { PREFERENCE_FILE_NAME, createOwnedPreferenceRoot, preferenceFile, seedStoredBytes } from "./m75PreferenceRoot";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const NATIVE = resolve(HERE, "../native");
const HOLD = join(NATIVE, "m7.5-hold-preferences.ps1");
const ACTIVATE = join(NATIVE, "m7.5-activate-window.ps1");

const EVIDENCE = resolve(REPO, ".tmp/m75-evidence");
const created: string[] = [];
const running: ChildProcess[] = [];

after(async () => {
  for (const child of running) child.kill();
  // A killed process does not release its handles instantly, and a held
  // record cannot be unlinked, so this waits rather than failing the run on
  // its own cleanup.
  for (const path of created) {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        rmSync(path, { recursive: true, force: true });
        break;
      } catch {
        await new Promise(done => setTimeout(done, 100));
      }
    }
  }
});

function owned(label: string): string {
  const root = createOwnedPreferenceRoot(REPO, label);
  created.push(root);
  return root;
}

/** Runs a helper to completion and reports what it said, refusal included. */
function run(script: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      { encoding: "utf8", windowsHide: true, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const RECORD = JSON.stringify({
  schemaVersion: 1,
  appearance: { locale: "en", density: "comfortable" },
  layout: { roster: "automatic", details: "automatic" },
});

test("the hold refuses every target that is not this campaign's own record", () => {
  const root = owned("hold-refusals");
  const journal = join(root, "hold.json");
  const signal = join(root, "release");
  seedStoredBytes(root, RECORD);

  // Outside the ignored evidence area entirely -- which is where the
  // operator's real configuration lives.
  const outside = mkdtempSync(join(REPO, ".tmp", "m75-outside-"));
  created.push(outside);
  seedStoredBytes(outside, RECORD);
  const escaped = run(HOLD, ["-PreferenceRoot", outside, "-Journal", journal, "-ReleaseSignal", signal]);
  assert.notEqual(escaped.code, 0);
  assert.match(escaped.stderr, /escaped this campaign/u);

  // Inside it, but not a root this campaign created. An `mkdtemp` name rather
  // than a fixed one: this test deletes what it makes, and a fixed name inside
  // the retained evidence area is a name something else may already own.
  mkdirSync(EVIDENCE, { recursive: true });
  const foreign = mkdtempSync(join(EVIDENCE, "not-a-preference-root-"));
  created.push(foreign);
  seedStoredBytes(foreign, RECORD);
  const unowned = run(HOLD, ["-PreferenceRoot", foreign, "-Journal", journal, "-ReleaseSignal", signal]);
  assert.notEqual(unowned.code, 0);
  assert.match(unowned.stderr, /Only a root this campaign created/u);

  // A journal or a signal that would be written somewhere else.
  const elsewhere = run(HOLD, ["-PreferenceRoot", root, "-Journal", join(outside, "hold.json"), "-ReleaseSignal", signal]);
  assert.notEqual(elsewhere.code, 0);
  assert.match(elsewhere.stderr, /escaped this campaign/u);

  // And it never creates the record it is asked to hold.
  const emptyRoot = owned("hold-empty");
  const absent = run(HOLD, ["-PreferenceRoot", emptyRoot, "-Journal", join(emptyRoot, "hold.json"), "-ReleaseSignal", join(emptyRoot, "release")]);
  assert.notEqual(absent.code, 0);
  assert.match(absent.stderr, /must already exist/u);
  assert.equal(existsSync(preferenceFile(emptyRoot)), false);
});

test("the hold really stops a replacement, still allows a read, and lets go on the signal", async () => {
  const root = owned("hold-refuses-replacement");
  const journal = join(root, "hold.json");
  const signal = join(root, "release");
  seedStoredBytes(root, RECORD);
  const target = preferenceFile(root);
  const before = digest(readFileSync(target));

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", HOLD,
      "-PreferenceRoot", root, "-Journal", journal, "-ReleaseSignal", signal, "-LifetimeSeconds", "60"],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  running.push(child);
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += String(chunk); });
  const exited = new Promise<number | null>(done => child.once("close", code => done(code)));

  const armed = async () => {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      if (existsSync(journal)) {
        const record = JSON.parse(readFileSync(journal, "utf8")) as { held: boolean };
        if (record.held) return record;
      }
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error(`The preference hold never armed. ${stderr}`);
  };
  const held = (await armed()) as { held: boolean; sha256AtHold: string; sharing: string };
  assert.equal(held.sha256AtHold, before);
  assert.match(held.sharing, /no write or delete sharing/u);

  // A reader still works, because the store's own reader has to.
  assert.equal(readFileSync(target, "utf8"), RECORD);

  // A replacement does not. This prober asks for the same thing the production
  // writer asks for -- put these bytes at that name, replacing what is there --
  // and is refused for the same reason: the name cannot be deleted while a
  // handle without delete sharing is open on it. (The writer reaches it through
  // a handle-bound rename; this reaches it through MoveFileEx. Same kernel
  // rule.)
  const replacement = join(root, ".mscanvas-ui-preferences-selftest.tmp");
  writeFileSync(replacement, "a replacement that must not land");
  assert.throws(() => renameSync(replacement, target), /EBUSY|EPERM|EACCES/u);
  assert.equal(digest(readFileSync(target)), before);

  writeFileSync(signal, "release");
  assert.equal(await exited, 0);
  const released = JSON.parse(readFileSync(journal, "utf8")) as {
    released: boolean; expired: boolean; sha256AtRelease: string;
  };
  assert.equal(released.released, true);
  assert.equal(released.expired, false);
  // The held record survived the refused replacement byte for byte.
  assert.equal(released.sha256AtRelease, before);

  // The positive control: the same replacement succeeds once the hold is gone,
  // so the refusal above was the hold and not a broken prober.
  renameSync(replacement, target);
  assert.equal(readFileSync(target, "utf8"), "a replacement that must not land");
  assert.equal(existsSync(replacement), false);
});

test("the hold expires on its own rather than leaving a record locked", async () => {
  const root = owned("hold-expiry");
  const journal = join(root, "hold.json");
  seedStoredBytes(root, RECORD);
  const result = run(HOLD, [
    "-PreferenceRoot", root, "-Journal", journal,
    "-ReleaseSignal", join(root, "release-that-never-comes"), "-LifetimeSeconds", "5",
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /expired before explicit release/u);
  const record = JSON.parse(readFileSync(journal, "utf8")) as { held: boolean; expired: boolean; released: boolean };
  assert.deepEqual(
    { held: record.held, expired: record.expired, released: record.released },
    { held: true, expired: true, released: true },
  );
  // Released means released: the record is replaceable again, and the only
  // names left in the root are the record and this helper's own journal.
  const replacement = join(root, ".mscanvas-ui-preferences-after-expiry.tmp");
  writeFileSync(replacement, RECORD);
  renameSync(replacement, preferenceFile(root));
  assert.deepEqual(readdirSync(root).sort(), [PREFERENCE_FILE_NAME, "hold.json"].sort());
});

test("activation refuses any process that is not an owned application window", async () => {
  // A process with no window at all: `Get-Process` finds it, and the metrics
  // this helper reads first refuse it. The stronger guard -- that the window's
  // executable is this run's own built binary -- needs a build to exercise and
  // is checked at launch instead.
  const idle = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 30"], {
    windowsHide: true, stdio: "ignore",
  });
  running.push(idle);
  try {
    await new Promise(done => setTimeout(done, 400));
    const windowless = run(ACTIVATE, ["-ApplicationProcessId", String(idle.pid)]);
    assert.notEqual(windowless.code, 0);
    assert.match(windowless.stderr, /has no MSCanvas main window/u);
  } finally {
    idle.kill();
  }

  // And a process id that is not running at all. Matched on the error
  // identifier rather than the sentence: this host's PowerShell writes its own
  // messages in its display language, and the identifier does not change.
  const absent = run(ACTIVATE, ["-ApplicationProcessId", "2147483646"]);
  assert.notEqual(absent.code, 0);
  assert.match(absent.stderr, /NoProcessFoundForGivenId/u);
});
