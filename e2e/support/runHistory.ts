/**
 * Conversion run history answers (ADR 0065), for the browser specs and the copy
 * tour. Shapes come from the interface's own types, which a Rust test holds to
 * the wire's spellings.
 */
import type { RunItem, RunListOutcome, RunReadOutcome, RunSummary } from "../../apps/desktop/src/features/run-history/runHistoryApi";

/** 2026-11-06, 09:00 UTC: fixed, so a run's order and a shot do not depend on today. */
const NOON = 1_793_955_600_000;
const HOUR = 3_600_000;

export const run = (id: string, overrides: Partial<RunSummary> = {}): RunSummary => ({
  runId: id,
  state: "completed",
  startedAtMs: NOON,
  endedAtMs: NOON + HOUR,
  interruptedAtMs: null,
  passes: 1,
  settingsRow: "mzml+no_additional_centroiding+all+mz64_intensity32+zlib",
  settingsVerified: true,
  buildRelease: "3.0.25000",
  buildVerified: true,
  failure: null,
  itemCount: 2,
  finalizedCount: 2,
  failedCount: 0,
  itemsOmitted: false,
  ...overrides,
});

export const listed = (runs: readonly RunSummary[], overrides: Partial<Extract<RunListOutcome, { outcome: "listed" }>> = {}): RunListOutcome => ({
  outcome: "listed",
  recording: true,
  problem: null,
  runs,
  unreadable: 0,
  newer: 0,
  ...overrides,
});

export const item = (name: string, overrides: Partial<RunItem["progress"]> = {}, facts: Partial<RunItem> = {}): RunItem => ({
  family: "thermo_raw",
  displayName: name,
  settingsVerified: true,
  buildVerified: true,
  progress: {
    state: "finalized",
    attempts: 1,
    outcome: "finalized",
    failure: null,
    outputs: [{
      fileName: name.replace(/\.raw$/u, ".mzML"),
      state: null,
      byteLength: 52_428_800,
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      checks: { mode: "output_only", fullyVerified: true, verified: ["well_formed", "indexed"], unverified: [], inapplicable: ["source_comparison"], advisory: [] },
    }],
    completeness: null,
    setAdoptable: null,
    ...overrides,
  },
  ...facts,
});

export const found = (summary: RunSummary, items: readonly RunItem[]): RunReadOutcome => ({ outcome: "found", run: summary, items });

/** Ended; both files converted. */
export const ENDED = run("00000000000000000000000000000001");
export const ENDED_ITEMS = [item("QC_pool_01.raw"), item("Plasma_QC_batch_08_replicate_04_long_acquisition.raw")];

/** Ended, one failed on a build with no measured row, and every file labelled. */
export const LABELLED = run("00000000000000000000000000000002", {
  startedAtMs: NOON - 24 * HOUR, endedAtMs: NOON - 23 * HOUR, finalizedCount: 1, failedCount: 1,
  settingsVerified: false, buildVerified: false, buildRelease: "3.0.26204", settingsRow: null, passes: 2,
});
export const LABELLED_ITEMS = [
  item("Blank_01.raw", {}, { settingsVerified: false, buildVerified: false }),
  item("Blank_02.raw", { state: "failed", attempts: 2, outcome: "output_rejected", failure: "picker_scope_record_mismatch", outputs: [] }, { settingsVerified: false, buildVerified: false }),
];

/** A session that ended part way: the running file unknown, the next one never begun. */
export const INTERRUPTED = run("00000000000000000000000000000003", {
  state: "interrupted", startedAtMs: NOON - 48 * HOUR, endedAtMs: null, interruptedAtMs: NOON - 47 * HOUR,
  itemCount: 3, finalizedCount: 1, failedCount: 0,
});
export const INTERRUPTED_ITEMS = [
  item("Run_A.raw"),
  item("Run_B.raw", { state: "interrupted", outcome: null, outputs: [] }),
  item("Run_C.raw", { state: "notRun", attempts: 0, outcome: null, outputs: [] }),
];

/** Stopped by a refusal that ended the queue. */
export const STOPPED = run("00000000000000000000000000000004", {
  state: "stopped", startedAtMs: NOON - 72 * HOUR, endedAtMs: NOON - 71 * HOUR, failure: "queue_destination_changed", itemCount: 1, finalizedCount: 0,
});
export const STOPPED_ITEMS = [item("Stopped_01.raw", { state: "cancelled", outcome: null, outputs: [] })];

/** Still being written, by this instance or another. */
export const RUNNING = run("00000000000000000000000000000005", { state: "running", startedAtMs: NOON + 2 * HOUR, endedAtMs: null, finalizedCount: 0 });

/** Outgrew its bound: a SCIEX queue kept as counts. */
export const OMITTED = run("00000000000000000000000000000006", { itemsOmitted: true, itemCount: 800, finalizedCount: 790, failedCount: 10, startedAtMs: NOON - 96 * HOUR, endedAtMs: NOON - 60 * HOUR });

/** A SCIEX set with its members, its completeness finding and why it was not adoptable. */
export const SET_ITEM = item("Sciex_batch.wiff", {
  state: "failed",
  outcome: "partial_group",
  failure: "multi_output_member_rejected",
  completeness: { kind: "notEstablished", reason: "sample_count_unavailable" },
  setAdoptable: false,
  outputs: [
    { fileName: "Sciex_batch-Sample1.mzML", state: "finalized", byteLength: 1_048_576, sha256: "aa".repeat(32), checks: { mode: "output_only", fullyVerified: false, verified: ["well_formed"], unverified: ["spectrum_count"], inapplicable: [], advisory: ["scan_window_rounded"] } },
    { fileName: "Sciex_batch-Sample2.mzML", state: "rejected", byteLength: null, sha256: null, checks: null },
  ],
}, { family: "sciex_wiff" });

/** The list at its bound. */
export const MANY_RUNS = Array.from({ length: 200 }, (_, index) => run(String(index + 1).padStart(32, "0"), {
  startedAtMs: NOON - index * HOUR, endedAtMs: NOON - index * HOUR + 600_000,
  state: index % 17 === 3 ? "interrupted" : "completed", finalizedCount: index % 5 === 0 ? 1 : 2, failedCount: index % 5 === 0 ? 1 : 0,
}));

/** A run at the queue's full size (ADR 0057). */
export const MANY_ITEMS = Array.from({ length: 1_024 }, (_, index) => item(`Plasma_S${String(index + 1).padStart(4, "0")}.raw`, index % 7 === 3 ? { state: "failed", outcome: "backend_failed", failure: "backend_output_capture_failed", outputs: [] } : {}));

/** The default answers: no run recorded, recording on. */
export const RUN_HISTORY_EMPTY = {
  list_conversion_runs: listed([]),
  read_conversion_run: { outcome: "notFound" },
  clear_conversion_runs: { outcome: "done", keptInProgress: 0 },
  set_conversion_run_history_enabled: { outcome: "done", keptInProgress: 0 },
};
