/**
 * The task-owned preference root a native M7.5 campaign binds, and what it can
 * be asked about.
 *
 * ## Why this exists
 *
 * The faults M7.5 has to prove are faults of a file in the operator's own
 * profile: a record this build cannot read, one from another schema, one the
 * filesystem refuses to replace. Proving them there would mean corrupting,
 * locking or deleting the operator's actual configuration, which is not
 * something a test gets to do.
 *
 * So the campaign owns a directory instead and binds it through
 * `MSCANVAS_E2E_PREFERENCE_ROOT`, which only the non-default `e2e` build reads.
 * Everything below that binding is the production implementation: the same
 * record type, the same validation, the same bounded temporary, the same
 * handle-bound replace, the same read-back. This is a different *root*, not a
 * different *store*.
 *
 * ## Why the binding is checked here as well
 *
 * Rust refuses outright when the variable is missing, relative or not an
 * existing directory, and answers `unavailable` for the whole session rather
 * than falling back to the real profile. That refusal is the safety net. This
 * module is the near side of the same rule: it will not hand a campaign a root
 * it has not created, and `requireOwnedPreferenceRoot` refuses before a process
 * is launched rather than after.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The variable the `e2e` build reads, and nothing else does. */
export const PREFERENCE_ROOT_VARIABLE = "MSCANVAS_E2E_PREFERENCE_ROOT";

/** The one file name the production store publishes under. */
export const PREFERENCE_FILE_NAME = "ui-preferences.json";

/** The prefix the production writer gives its private sibling. */
export const TEMPORARY_PREFIX = ".mscanvas-ui-preferences-";

/**
 * Every key the stored record may carry, at every level.
 *
 * The campaign reads the actual bytes and compares against this, so a field
 * that reached a profile without a decision is a failed assertion rather than
 * something a reader has to notice.
 */
export const ALLOWED_KEYS = {
  root: ["schemaVersion", "appearance", "layout"],
  appearance: ["locale", "density"],
  layout: ["roster", "details"],
} as const;

/**
 * Every value each allowlisted field may hold.
 *
 * Checked as well as the key names, because a key that is allowed to exist is
 * not the same as a key that is allowed to hold anything: a path smuggled in as
 * `layout.roster` would satisfy a name-only check.
 */
const ALLOWED_VALUES = {
  schemaVersion: [1],
  locale: ["en", "zh-CN"],
  density: ["comfortable", "compact"],
  roster: ["automatic", "shown", "hidden"],
  details: ["automatic", "shown", "hidden"],
} as const;

/** Where a campaign's own roots live: the repository's ignored evidence area. */
const EVIDENCE = resolve(dirname(fileURLToPath(import.meta.url)), "../..", ".tmp/m75-evidence");
const ROOT_PREFIX = "preference-root-";

/** Creates a directory this campaign owns, under the repository's own scratch. */
export function createOwnedPreferenceRoot(repository: string, label: string): string {
  if (!isAbsolute(repository)) throw new Error("The repository root must be absolute.");
  const parent = resolve(repository, ".tmp/m75-evidence");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, `${ROOT_PREFIX}${label}-`));
}

/**
 * The root a campaign may bind, or a refusal.
 *
 * Refuses before anything is launched. A campaign that cannot isolate itself
 * must not start: an isolation that silently stopped isolating would be worse
 * than none, because the run would still report success.
 *
 * "A directory this campaign created" is enforced rather than trusted -- it has
 * to be one of the `preference-root-*` directories under the repository's
 * ignored evidence area. Accepting any existing directory would let a mistaken
 * binding send the application's writes, and this module's own byte seeding,
 * somewhere real; the PowerShell side enforces the same containment, and these
 * two are the only things standing between a fault fixture and a profile.
 */
export function requireOwnedPreferenceRoot(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${PREFERENCE_ROOT_VARIABLE} is required; this campaign must not touch the real profile.`);
  }
  if (!isAbsolute(value)) {
    throw new Error(`${PREFERENCE_ROOT_VARIABLE} must be an absolute path.`);
  }
  const full = resolve(value);
  if (!full.startsWith(EVIDENCE + "\\") && !full.startsWith(EVIDENCE + "/")) {
    throw new Error(`${PREFERENCE_ROOT_VARIABLE} must name a directory inside this campaign's own evidence area.`);
  }
  if (!basename(full).startsWith(ROOT_PREFIX)) {
    throw new Error(`${PREFERENCE_ROOT_VARIABLE} must name a ${ROOT_PREFIX}* directory this campaign created.`);
  }
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw new Error(`${PREFERENCE_ROOT_VARIABLE} must name a directory this campaign already created.`);
  }
  return value;
}

export function preferenceFile(root: string): string {
  return join(root, PREFERENCE_FILE_NAME);
}

/** What the stored record is, byte for byte, without interpreting it. */
export interface StoredRecordFacts {
  readonly exists: boolean;
  readonly byteLength: number;
  readonly sha256: string | null;
  /** The published file's modification time in milliseconds, or `null`. */
  readonly modifiedMs: number | null;
  /** The raw bytes as UTF-8, so a corrupt record is still inspectable. */
  readonly text: string | null;
  /** Parsed only where it parses; `null` says the bytes are not this record. */
  readonly json: unknown;
  /** Every name in the directory, sorted: a residue is a name here. */
  readonly entries: readonly string[];
  /** The private siblings the production writer would have created. */
  readonly temporaries: readonly string[];
}

export function readStoredRecord(root: string): StoredRecordFacts {
  const entries = existsSync(root) ? readdirSync(root).sort() : [];
  const temporaries = entries.filter(name => name.startsWith(TEMPORARY_PREFIX));
  const file = preferenceFile(root);
  if (!existsSync(file)) {
    return { exists: false, byteLength: 0, sha256: null, modifiedMs: null, text: null, json: null, entries, temporaries };
  }
  const bytes = readFileSync(file);
  const stats = statSync(file);
  let json: unknown = null;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    json = null;
  }
  return {
    exists: true,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    modifiedMs: stats.mtimeMs,
    text: bytes.toString("utf8"),
    json,
    entries,
    temporaries,
  };
}

/**
 * Puts arbitrary bytes at the published name, as something other than MSCanvas
 * would.
 *
 * For the corrupt, future-schema and oversized cases. Deliberately a byte
 * writer rather than a record builder: a fault fixture that went through this
 * build's own serializer could only produce records this build accepts.
 */
export function seedStoredBytes(root: string, bytes: Buffer | string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(preferenceFile(root), bytes);
}

/** Why a stored record is not one this build may have written. */
export type RecordViolation =
  | { readonly kind: "notAnObject" }
  | { readonly kind: "unknownKey"; readonly at: string; readonly key: string }
  | { readonly kind: "missingKey"; readonly at: string; readonly key: string }
  | { readonly kind: "badValue"; readonly at: string; readonly key: string; readonly value: unknown };

/**
 * Whether the stored record carries only the allowlisted fields, holding only
 * the values those fields may hold.
 *
 * Both halves matter. Checking names alone would accept
 * `layout: { roster: { mode: "shown", lastFolder: "D:\\data" } }` -- every name
 * allowlisted, a path stored anyway -- so every leaf is checked against its own
 * finite domain, and a leaf that is not one of those values is a violation
 * whatever its shape.
 *
 * Every violation is reported rather than the first, so a campaign's evidence
 * names each one. An empty list is the assertion the milestone rests on: the
 * bytes in the operator's profile hold five values, from five fixed sets, and
 * nothing else.
 */
export function recordViolations(json: unknown): readonly RecordViolation[] {
  const found: RecordViolation[] = [];
  const leaf = (at: string, key: keyof typeof ALLOWED_VALUES, value: unknown) => {
    if (!(ALLOWED_VALUES[key] as readonly unknown[]).includes(value)) {
      found.push({ kind: "badValue", at, key, value });
    }
  };
  const object = (value: unknown, at: string, allowed: readonly string[]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      found.push({ kind: "notAnObject" });
      return null;
    }
    const keys = Object.keys(value as Record<string, unknown>);
    for (const key of keys) {
      if (!allowed.includes(key)) found.push({ kind: "unknownKey", at, key });
    }
    for (const key of allowed) {
      if (!keys.includes(key)) found.push({ kind: "missingKey", at, key });
    }
    return value as Record<string, unknown>;
  };
  const root = object(json, "root", ALLOWED_KEYS.root);
  if (root === null) return found;
  if (Object.hasOwn(root, "schemaVersion")) leaf("root", "schemaVersion", root.schemaVersion);
  const appearance = object(root.appearance, "appearance", ALLOWED_KEYS.appearance);
  if (appearance !== null) {
    if (Object.hasOwn(appearance, "locale")) leaf("appearance", "locale", appearance.locale);
    if (Object.hasOwn(appearance, "density")) leaf("appearance", "density", appearance.density);
  }
  const layout = object(root.layout, "layout", ALLOWED_KEYS.layout);
  if (layout !== null) {
    if (Object.hasOwn(layout, "roster")) leaf("layout", "roster", layout.roster);
    if (Object.hasOwn(layout, "details")) leaf("layout", "details", layout.details);
  }
  return found;
}

/** Whether two readings are the same bytes. Absent equals absent. */
export function sameBytes(before: StoredRecordFacts, after: StoredRecordFacts): boolean {
  return before.exists === after.exists && before.sha256 === after.sha256 && before.byteLength === after.byteLength;
}

/**
 * Whether the record *and the directory around it* are as they were found.
 *
 * `sameBytes` answers about the published file alone, and that is not the whole
 * of "left exactly as it was found": a publish that was refused after creating
 * its private sibling leaves the record byte-identical and the profile dirty.
 * A scenario that claims both should assert both, which is what this is for --
 * the residue is returned rather than reduced to a boolean so a failure names
 * the file that was left behind.
 */
export function untouched(before: StoredRecordFacts, after: StoredRecordFacts): {
  readonly bytes: boolean;
  readonly entries: boolean;
  readonly temporaries: readonly string[];
} {
  return {
    bytes: sameBytes(before, after),
    entries: before.entries.length === after.entries.length
      && before.entries.every((name, index) => name === after.entries[index]),
    temporaries: after.temporaries,
  };
}

/**
 * Whether a reading is strictly newer than another.
 *
 * By content first, because a filesystem timestamp has coarse granularity and
 * two publishes inside one tick are indistinguishable by time alone. The
 * timestamp is reported beside it rather than relied on.
 */
export function replaced(before: StoredRecordFacts, after: StoredRecordFacts): boolean {
  return after.exists && before.sha256 !== after.sha256;
}
