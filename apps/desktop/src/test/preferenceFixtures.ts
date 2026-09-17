/**
 * A deterministic preference store for rendered tests.
 *
 * What it is for: driving hydration, ordering, refusal and failure through the
 * real components, on demand, without a WebView. Every answer is a value the
 * production boundary can return, and the shapes are the boundary's own.
 *
 * What it is *not*: evidence about disk. Whether the record is really replaced
 * atomically, whether an unusable file is really left alone and whether a
 * Windows lock really refuses are decided by the filesystem, and they are
 * proved against it in `apps/desktop/src-tauri/src/preferences/tests.rs`. This
 * fake reproduces the boundary's contract so the interface can be tested; it
 * does not stand in for the storage those tests cover.
 */

import {
  LAYOUT_DEFAULTS,
  PREFERENCE_SCHEMA_VERSION,
  type PreferenceReadOutcome,
  type PreferenceSaveOutcome,
  type PreferenceWriteRequest,
  type StoredPreferences,
} from "../features/preferences/storedPreferences";
import { SESSION_DEFAULTS } from "../features/preferences/sessionPreferences";
import type { PreferencesApi } from "../features/preferences/preferencesApi";

export const STORED_DEFAULTS: StoredPreferences = {
  schemaVersion: PREFERENCE_SCHEMA_VERSION,
  appearance: SESSION_DEFAULTS,
  layout: LAYOUT_DEFAULTS,
};

export function storedRecord(overrides: {
  readonly appearance?: Partial<StoredPreferences["appearance"]>;
  readonly layout?: Partial<StoredPreferences["layout"]>;
} = {}): StoredPreferences {
  return {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    appearance: { ...SESSION_DEFAULTS, ...overrides.appearance },
    layout: { ...LAYOUT_DEFAULTS, ...overrides.layout },
  };
}

/** How the fake should answer. Every field is what a real outcome carries. */
export interface FakePreferencesOptions {
  /** What is on disk to begin with. `null` is a first run. */
  readonly stored?: StoredPreferences | null;
  /** A stored record this build refuses, retained until replacement. */
  readonly unusable?: string;
  /** No store at all. */
  readonly unavailable?: string;
  /** Rejects the read outright, as a failed IPC call would. */
  readonly readRejects?: boolean;
  /** Answers every commit with this failure until it is cleared. */
  readonly failWith?: {
    readonly problem: string;
    readonly retryable: boolean;
    readonly temporaryLeftBehind?: boolean;
  };
  /** Holds each answer until the test releases it, for ordering coverage. */
  readonly deferred?: boolean;
}

export interface FakePreferencesApi extends PreferencesApi {
  /** Every commit request in the order it arrived. */
  readonly requests: readonly PreferenceWriteRequest[];
  /** What the fake currently holds, as a stored record or `null`. */
  stored(): StoredPreferences | null;
  /** Stops failing, so a retry can succeed. */
  recover(): void;
  /** Answers the outstanding calls, oldest first unless `order` says otherwise. */
  release(order?: readonly number[]): Promise<void>;
  /** How many answers are waiting. */
  outstanding(): number;
}

export function createFakePreferencesApi(
  options: FakePreferencesOptions = {},
): FakePreferencesApi {
  let stored: StoredPreferences | null = options.stored ?? null;
  let unusable = options.unusable ?? null;
  let failWith = options.failWith ?? null;
  let revision = 0;
  const requests: PreferenceWriteRequest[] = [];
  const waiting: (() => void)[] = [];

  /**
   * Decides the answer now and delivers it when the test says.
   *
   * Eagerly on purpose. Rust serializes every commit, so what a caller can
   * observe out of order is the *delivery* of an answer and never the order the
   * records were written in. A fake that computed the outcome at release time
   * would let a test "prove" an ordering the boundary cannot produce.
   */
  function settle<T>(answer: () => T): Promise<T> {
    const decided = answer();
    if (options.deferred !== true) return Promise.resolve(decided);
    return new Promise<T>(resolve => { waiting.push(() => resolve(decided)); });
  }

  const api: FakePreferencesApi = {
    requests,
    stored: () => stored,
    recover: () => { failWith = null; },
    outstanding: () => waiting.length,
    async release(order) {
      const pending = [...waiting];
      waiting.length = 0;
      for (const index of order ?? pending.map((_, at) => at)) pending[index]?.();
      // One microtask turn per released answer, so a caller can observe each.
      await Promise.resolve();
    },

    loadPreferences: () =>
      options.readRejects === true
        ? Promise.reject(new Error("the preference store could not be reached"))
        : settle<PreferenceReadOutcome>(() => {
            if (options.unavailable !== undefined) {
              return { outcome: "unavailable", problem: options.unavailable, revision };
            }
            if (unusable !== null) return { outcome: "unusable", problem: unusable, revision };
            return stored === null
              ? { outcome: "absent", revision }
              : { outcome: "loaded", preferences: stored, revision };
          }),

    savePreferences: (request) => {
      requests.push(request);
      return settle<PreferenceSaveOutcome>(() => {
        if (options.unavailable !== undefined) {
          return { outcome: "unavailable", problem: options.unavailable, revision };
        }
        if (unusable !== null && request.replaceUnusable !== true) {
          return { outcome: "storedRecordUnusable", problem: unusable, revision };
        }
        if (failWith !== null) {
          return {
            outcome: "failed",
            problem: failWith.problem,
            retryable: failWith.retryable,
            temporaryLeftBehind: failWith.temporaryLeftBehind ?? false,
            revision,
          };
        }
        // The boundary's merge: the group this commit names, over what is
        // stored. Rust does this under the lock that publishes; here it is the
        // same rule, so the interface is tested against the same contract.
        const base = unusable !== null || stored === null ? STORED_DEFAULTS : stored;
        stored = {
          schemaVersion: PREFERENCE_SCHEMA_VERSION,
          appearance: request.appearance ?? base.appearance,
          layout: request.layout ?? base.layout,
        };
        unusable = null;
        revision += 1;
        return { outcome: "saved", preferences: stored, revision };
      });
    },
  };
  return api;
}
