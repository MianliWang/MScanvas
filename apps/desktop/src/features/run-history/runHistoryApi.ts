/**
 * What the webview may ask about conversion run history (RUN-007, ADR 0065).
 *
 * Four operations, and none of them takes or returns a path: a run is addressed
 * by the opaque identifier a list gave, and what comes back is names, states,
 * counts, times, checks and stable codes. The shapes mirror
 * `src-tauri/src/run_history.rs`, and a Rust test holds this file to its wire
 * spellings.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import { documentAuthorityHeaders } from "../ipc/documentAuthority";

export type RunState = "running" | "completed" | "stopped" | "stopFailed" | "interrupted";

/** One run as a list shows it: no path and no item. */
export interface RunSummary {
  readonly runId: string;
  readonly state: RunState;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  /** When a later read found it cut short. Not an end time. */
  readonly interruptedAtMs: number | null;
  readonly passes: number;
  /** The verified row's identifier, or `null` for advanced settings. */
  readonly settingsRow: string | null;
  readonly settingsVerified: boolean;
  readonly buildRelease: string | null;
  readonly buildVerified: boolean;
  /** What ended the whole queue, by its stable code. */
  readonly failure: string | null;
  readonly itemCount: number;
  readonly finalizedCount: number;
  readonly failedCount: number;
  /** The run outgrew its bound: its counts are kept and its items are not. */
  readonly itemsOmitted: boolean;
}

export interface RunOutputChecks {
  readonly mode: string;
  readonly fullyVerified: boolean;
  readonly verified: readonly string[];
  readonly unverified: readonly string[];
  readonly inapplicable: readonly string[];
  readonly advisory: readonly string[];
}

export interface RunOutput {
  readonly fileName: string;
  /** A set member's own state; `null` for a single output. */
  readonly state: string | null;
  readonly byteLength: number | null;
  readonly sha256: string | null;
  readonly checks: RunOutputChecks | null;
}

export type RunSetCompleteness =
  | { readonly kind: "notPosed" }
  | { readonly kind: "notEstablished"; readonly reason: string }
  | { readonly kind: "established"; readonly method: string; readonly sampleCount: number };

export interface RunItemProgress {
  /** The queue's own item state identifier, or `interrupted`. */
  readonly state: string;
  readonly attempts: number;
  readonly outcome: string | null;
  readonly failure: string | null;
  readonly outputs: readonly RunOutput[];
  readonly completeness: RunSetCompleteness | null;
  readonly setAdoptable: boolean | null;
}

/** One item as a run's detail shows it: its name, never its location. */
export interface RunItem {
  readonly family: string;
  readonly displayName: string;
  readonly settingsVerified: boolean;
  readonly buildVerified: boolean;
  readonly progress: RunItemProgress;
}

export type RunListOutcome =
  | {
      readonly outcome: "listed";
      /** Whether new runs are being recorded. Off is shared by every instance. */
      readonly recording: boolean;
      readonly problem: string | null;
      readonly runs: readonly RunSummary[];
      readonly unreadable: number;
      readonly newer: number;
    }
  | { readonly outcome: "unavailable"; readonly problem: string };

export type RunReadOutcome =
  | { readonly outcome: "found"; readonly run: RunSummary; readonly items: readonly RunItem[] }
  | { readonly outcome: "notFound" }
  | { readonly outcome: "refused"; readonly problem: string }
  | { readonly outcome: "unavailable"; readonly problem: string };

export type RunWriteOutcome =
  | { readonly outcome: "done"; readonly keptInProgress: number }
  | { readonly outcome: "failed"; readonly problem: string; readonly notRemoved: number }
  | { readonly outcome: "unavailable"; readonly problem: string };

export interface RunHistoryApi {
  listRuns(): Promise<RunListOutcome>;
  readRun(runId: string): Promise<RunReadOutcome>;
  /** Forgets ended runs and keeps runs in progress. */
  clearRuns(): Promise<RunWriteOutcome>;
  /** Off also forgets every stored run, every instance's runs in progress included. */
  setEnabled(enabled: boolean): Promise<RunWriteOutcome>;
}

// `async`, so a document with no authority is a refusal a caller can show rather
// than a throw out of its effect.
export const tauriRunHistoryApi: RunHistoryApi = {
  listRuns: async () => invoke<RunListOutcome>("list_conversion_runs", {}, documentAuthorityHeaders()),
  readRun: async (runId) => invoke<RunReadOutcome>("read_conversion_run", { runId }, documentAuthorityHeaders()),
  clearRuns: async () => invoke<RunWriteOutcome>("clear_conversion_runs", {}, documentAuthorityHeaders()),
  setEnabled: async (enabled) =>
    invoke<RunWriteOutcome>("set_conversion_run_history_enabled", { enabled }, documentAuthorityHeaders()),
};

const RunHistoryApiContext = createContext<RunHistoryApi>(tauriRunHistoryApi);

/** So a test can drive a read, its failure and its order without a WebView. */
export const RunHistoryApiProvider = RunHistoryApiContext.Provider;

export function useRunHistoryApi(): RunHistoryApi {
  return useContext(RunHistoryApiContext);
}
