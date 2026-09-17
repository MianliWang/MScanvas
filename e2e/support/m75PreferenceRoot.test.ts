/**
 * The M7.5 native harness's own helpers, tested without the application.
 *
 * These are the mechanisms a campaign's conclusions rest on: whether it really
 * bound a root it owns, whether it can tell a replaced record from an untouched
 * one, and whether it can say that the bytes in a profile carry five values and
 * nothing else. A helper that silently answered "unchanged" would turn a failed
 * publish into a passing scenario, so each one is exercised here first, against
 * a real directory, before any desktop time is asked for.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import {
  PREFERENCE_FILE_NAME,
  PREFERENCE_ROOT_VARIABLE,
  TEMPORARY_PREFIX,
  createOwnedPreferenceRoot,
  preferenceFile,
  readStoredRecord,
  recordViolations,
  replaced,
  requireOwnedPreferenceRoot,
  sameBytes,
  seedStoredBytes,
} from "./m75PreferenceRoot";

const scratch = mkdtempSync(join(tmpdir(), "m75-helper-"));
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** Everything this file creates inside the repository, removed at the end. */
const created: string[] = [];
after(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const path of created) rmSync(path, { recursive: true, force: true });
});

function root(label: string): string {
  const path = join(scratch, label);
  mkdirSync(path, { recursive: true });
  return path;
}

const VALID = JSON.stringify({
  schemaVersion: 1,
  appearance: { locale: "zh-CN", density: "compact" },
  layout: { roster: "hidden", details: "shown" },
});

test("refuses every binding a campaign must not run on", () => {
  for (const value of [undefined, "", "   ", "relative/path", join(scratch, "does-not-exist")]) {
    assert.throws(() => requireOwnedPreferenceRoot(value), /MSCANVAS_E2E_PREFERENCE_ROOT/u, String(value));
  }
  // A file is not a directory, and neither is the real profile.
  const file = join(scratch, "a-file");
  writeFileSync(file, "not a directory");
  assert.throws(() => requireOwnedPreferenceRoot(file), /must name a directory/u);
  assert.equal(PREFERENCE_ROOT_VARIABLE, "MSCANVAS_E2E_PREFERENCE_ROOT");
});

test("accepts only a directory this campaign created, inside its own evidence area", () => {
  // An existing directory is not enough. The application writes into whatever
  // this returns, and `seedStoredBytes` writes fault fixtures there, so a
  // binding that pointed somewhere real would send both somewhere real.
  const elsewhere = root("outside-the-evidence-area");
  assert.throws(() => requireOwnedPreferenceRoot(elsewhere), /inside this campaign's own evidence area/u);

  const owned = createOwnedPreferenceRoot(REPOSITORY, "accepted");
  created.push(owned);
  assert.equal(requireOwnedPreferenceRoot(owned), owned);

  // Inside the evidence area but not one of this campaign's roots.
  const foreign = mkdtempSync(join(REPOSITORY, ".tmp/m75-evidence", "not-a-root-"));
  created.push(foreign);
  assert.throws(() => requireOwnedPreferenceRoot(foreign), /preference-root-\* directory/u);
});

test("creates a root inside the repository's own scratch, and a fresh one each time", () => {
  const repository = join(scratch, "repo");
  mkdirSync(repository, { recursive: true });
  const first = createOwnedPreferenceRoot(repository, "chain-one");
  const second = createOwnedPreferenceRoot(repository, "chain-one");
  created.push(first, second);
  assert.notEqual(first, second);
  for (const made of [first, second]) {
    assert.match(made.replaceAll("\\", "/"), /\/\.tmp\/m75-evidence\/preference-root-chain-one-/u);
    // Empty, which is what a clean isolated profile is.
    assert.deepEqual(readStoredRecord(made).entries, []);
    // Named like one of this campaign's roots, and still refused: the binding
    // is anchored to this repository's own evidence area rather than to
    // whatever directory was passed in, so a root made under some other tree
    // cannot be bound by naming it correctly.
    assert.throws(() => requireOwnedPreferenceRoot(made), /inside this campaign's own evidence area/u);
  }
  assert.throws(() => createOwnedPreferenceRoot("relative", "x"), /absolute/u);
});

test("reads an absent record as absent rather than as empty bytes", () => {
  const facts = readStoredRecord(root("absent"));
  assert.equal(facts.exists, false);
  assert.equal(facts.sha256, null);
  assert.equal(facts.modifiedMs, null);
  assert.equal(facts.text, null);
  assert.equal(facts.json, null);
  assert.equal(facts.byteLength, 0);
});

test("reads a record's bytes, its digest and its parse, and keeps a corrupt one inspectable", () => {
  const owned = root("bytes");
  seedStoredBytes(owned, VALID);
  const valid = readStoredRecord(owned);
  assert.equal(valid.exists, true);
  assert.equal(valid.byteLength, Buffer.byteLength(VALID));
  assert.match(valid.sha256 ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(typeof valid.modifiedMs, "number");
  assert.deepEqual(valid.entries, [PREFERENCE_FILE_NAME]);
  assert.deepEqual((valid.json as { appearance: unknown }).appearance, { locale: "zh-CN", density: "compact" });

  // Not this record, and not lost either: the campaign has to be able to show
  // the operator what was on disk.
  seedStoredBytes(owned, "{ this is not a preference record");
  const corrupt = readStoredRecord(owned);
  assert.equal(corrupt.exists, true);
  assert.equal(corrupt.json, null);
  assert.equal(corrupt.text, "{ this is not a preference record");
  assert.notEqual(corrupt.sha256, valid.sha256);
});

test("names every private sibling the production writer would leave behind", () => {
  const owned = root("residue");
  seedStoredBytes(owned, VALID);
  writeFileSync(join(owned, `${TEMPORARY_PREFIX}1234-0.tmp`), "residue");
  writeFileSync(join(owned, "something-else.txt"), "not ours");
  const facts = readStoredRecord(owned);
  assert.deepEqual(facts.temporaries, [`${TEMPORARY_PREFIX}1234-0.tmp`]);
  // Everything in the directory is still reported, so a foreign name is
  // visible rather than filtered away.
  assert.deepEqual(facts.entries, [
    `${TEMPORARY_PREFIX}1234-0.tmp`,
    PREFERENCE_FILE_NAME,
    "something-else.txt",
  ].sort());
});

test("accepts exactly the allowlisted fields and reports every violation", () => {
  assert.deepEqual(recordViolations(JSON.parse(VALID)), []);

  const extra = recordViolations({
    schemaVersion: 1,
    appearance: { locale: "en", density: "compact", theme: "dark" },
    layout: { roster: "shown", details: "shown" },
    lastFolder: "D:\\data",
  });
  assert.deepEqual(extra, [
    { kind: "unknownKey", at: "root", key: "lastFolder" },
    { kind: "unknownKey", at: "appearance", key: "theme" },
  ]);

  const missing = recordViolations({ schemaVersion: 1, appearance: { locale: "en" }, layout: {} });
  assert.deepEqual(missing, [
    { kind: "missingKey", at: "root", key: "layout" },
    { kind: "missingKey", at: "appearance", key: "density" },
    { kind: "missingKey", at: "layout", key: "roster" },
    { kind: "missingKey", at: "layout", key: "details" },
  ].filter(violation => violation.key !== "layout" || violation.at !== "root"));

  for (const value of [null, 1, "record", [], [JSON.parse(VALID)]]) {
    assert.deepEqual(recordViolations(value), [{ kind: "notAnObject" }], String(value));
  }
});

test("tells an untouched record from a replaced one, by content", () => {
  const owned = root("compare");
  const absent = readStoredRecord(owned);
  seedStoredBytes(owned, VALID);
  const first = readStoredRecord(owned);
  const again = readStoredRecord(owned);

  // Absent equals absent, and reading twice is not a change.
  assert.equal(sameBytes(absent, readStoredRecord(root("compare-empty"))), true);
  assert.equal(sameBytes(first, again), true);
  assert.equal(replaced(first, again), false);

  // Replaced by content, which is what a publish is. A filesystem timestamp
  // has coarse granularity and two publishes inside one tick are
  // indistinguishable by time alone, so the comparison does not rest on it.
  seedStoredBytes(owned, VALID.replace("compact", "comfortable"));
  const second = readStoredRecord(owned);
  assert.equal(sameBytes(first, second), false);
  assert.equal(replaced(first, second), true);
  // And a record that is gone is not a replacement.
  assert.equal(replaced(first, absent), false);
  assert.equal(sameBytes(first, absent), false);
});

test("names the production file and sibling prefix the store actually uses", () => {
  // Pinned here because the campaign reads the file by name. If the store ever
  // publishes under another name, this fails rather than the campaign quietly
  // asserting things about a file nothing writes.
  assert.equal(PREFERENCE_FILE_NAME, "ui-preferences.json");
  assert.equal(TEMPORARY_PREFIX, ".mscanvas-ui-preferences-");
  assert.equal(preferenceFile("C:\\owned").replaceAll("\\", "/"), "C:/owned/ui-preferences.json");
});
