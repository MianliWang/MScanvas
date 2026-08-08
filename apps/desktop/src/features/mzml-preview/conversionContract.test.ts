import { describe, expect, it } from "vitest";

import type {
  ConversionConflictPolicy,
  ConversionQueue,
  ConversionQueueItem,
  ConversionQueueItemState,
  ConversionReport,
  DatasetSourceKind,
  ValidationMode,
  WorkspaceConversionState,
  WorkspaceConversionUpdate,
} from "./contracts";

/**
 * The wire shapes this side expects, written out independently of the types it
 * is checking.
 *
 * Restating them is the point: a declaration that imported the type it verifies
 * would agree with itself whatever Rust did.
 */
type ExpectedWorkspaceConversionState =
  | { readonly status: "idle" }
  | {
      readonly status: "awaitingDestination";
      readonly operationId: string;
      readonly queue: ConversionQueue;
    }
  | {
      readonly status: "running";
      readonly operationId: string;
      readonly queue: ConversionQueue;
    }
  | {
      readonly status: "terminal";
      readonly operationId: string;
      readonly queue: ConversionQueue;
    };

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

// Compilation fails if either side gains, loses or makes optional a wire field.
const wireStateIsBidirectionallyExact: Equal<
  WorkspaceConversionState,
  ExpectedWorkspaceConversionState
> = true;

const familyIsExact: Equal<DatasetSourceKind, "mzml" | "thermo_raw"> = true;
const validationIsExact: Equal<ValidationMode, "source_comparison" | "output_only"> = true;
const conflictIsExact: Equal<ConversionConflictPolicy, "fail" | "skip"> = true;
const itemStateIsExact: Equal<
  ConversionQueueItemState,
  "pending" | "running" | "finalized" | "skipped" | "failed"
> = true;

/** The report the M3.1 implementation head produced against the evidenced build. */
const FINALIZED_REPORT = {
  datasetHandle: "file-0",
  sourceKind: "thermo_raw",
  outcome: "finalized",
  detailedOutcome: null,
  outputFileName: "FT-HCD-MSX.mzML",
  output: {
    byteLength: 28_655,
    sha256: "6CE2ACE65485488F4A337EE17B71559E737C1944B641F279744932C3C3D8648C",
    spectrumCount: 1,
    chromatogramCount: 1,
  },
  validation: {
    mode: "output_only",
    fullyVerified: false,
    verified: ["source_unchanged"],
    unverified: [],
    inapplicable: ["spectrum_count"],
  },
  backend: { exitCode: 0, elapsedMilliseconds: 568 },
  stagingResidue: null,
  installationGeneration: 0,
} as const satisfies ConversionReport;

const CONVERTED_ITEM = {
  datasetHandle: "file-0",
  fileName: "FT-HCD-MSX.raw",
  sourceKind: "thermo_raw",
  outputFileName: "FT-HCD-MSX.mzML",
  state: "finalized",
  attempts: 1,
  retryable: false,
  report: FINALIZED_REPORT,
  error: null,
} as const satisfies ConversionQueueItem;

const FAILED_ITEM = {
  datasetHandle: "file-1",
  fileName: "second.raw",
  sourceKind: "thermo_raw",
  outputFileName: "second.mzML",
  state: "failed",
  attempts: 2,
  retryable: true,
  report: null,
  error: {
    kind: "file_unreadable",
    summary: "MSCanvas could not read that file.",
    detail: null,
    retryable: true,
  },
} as const satisfies ConversionQueueItem;

const QUEUE = {
  items: [CONVERTED_ITEM, FAILED_ITEM],
  currentIndex: 2,
  itemCount: 2,
  retryRound: 1,
  conflictPolicy: "fail",
  finalizedCount: 1,
  skippedCount: 0,
  failedCount: 1,
  retryableFailedCount: 1,
  nonRetryableFailedCount: 0,
  error: null,
  installationGeneration: 0,
} as const satisfies ConversionQueue;

/** Every string the value carries, at any depth, keys included. */
function stringsWithin(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsWithin);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, member]) => [key, ...stringsWithin(member)]);
  }
  return [];
}

describe("the conversion wire contract", () => {
  it("keeps every closed union exactly as Rust spells it", () => {
    expect(wireStateIsBidirectionallyExact).toBe(true);
    expect(familyIsExact).toBe(true);
    expect(validationIsExact).toBe(true);
    expect(conflictIsExact).toBe(true);
    expect(itemStateIsExact).toBe(true);
  });

  it("round-trips the whole state vocabulary through JSON unchanged", () => {
    const updates = [
      { sequence: 0, state: { status: "idle" } },
      { sequence: 1, state: { status: "awaitingDestination", operationId: "1", queue: QUEUE } },
      { sequence: 2, state: { status: "running", operationId: "1", queue: QUEUE } },
      { sequence: 3, state: { status: "terminal", operationId: "1", queue: QUEUE } },
    ] as const satisfies readonly WorkspaceConversionUpdate[];

    expect(JSON.parse(JSON.stringify(updates))).toEqual(updates);
    expect(Object.keys(updates[0])).toEqual(["sequence", "state"]);
    expect(updates.map((update) => update.state.status)).toEqual([
      "idle",
      "awaitingDestination",
      "running",
      "terminal",
    ]);
  });

  it("carries one queue and never a history of them", () => {
    // Every non-idle state names `queue`, singular, and the terminal one is no
    // exception: a finished queue is replaced by the next, not appended to.
    for (const update of [
      { sequence: 1, state: { status: "awaitingDestination", operationId: "1", queue: QUEUE } },
      { sequence: 2, state: { status: "running", operationId: "1", queue: QUEUE } },
      { sequence: 3, state: { status: "terminal", operationId: "1", queue: QUEUE } },
    ] as const satisfies readonly WorkspaceConversionUpdate[]) {
      expect(Object.keys(update.state).sort()).toEqual(["operationId", "queue", "status"]);
    }
    // And an item holds its latest attempt, not every attempt it has had.
    expect(FAILED_ITEM.attempts).toBe(2);
    expect(Object.keys(FAILED_ITEM)).not.toContain("reports");
    expect(Object.keys(FAILED_ITEM)).not.toContain("history");
  });

  it("never carries a path, a destination or a raw backend stream", () => {
    // The whole key set, so a field added upstream has to be answered for here
    // rather than arriving unnoticed.
    expect(Object.keys(QUEUE).sort()).toEqual(
      [
        "conflictPolicy",
        "currentIndex",
        "error",
        "failedCount",
        "finalizedCount",
        "installationGeneration",
        "itemCount",
        "items",
        "nonRetryableFailedCount",
        "retryRound",
        "retryableFailedCount",
        "skippedCount",
      ].sort(),
    );
    expect(Object.keys(CONVERTED_ITEM).sort()).toEqual(
      [
        "attempts",
        "datasetHandle",
        "error",
        "fileName",
        "outputFileName",
        "report",
        "retryable",
        "sourceKind",
        "state",
      ].sort(),
    );
    expect(Object.keys(FINALIZED_REPORT).sort()).toEqual(
      [
        "backend",
        "datasetHandle",
        "detailedOutcome",
        "installationGeneration",
        "outcome",
        "output",
        "outputFileName",
        "sourceKind",
        "stagingResidue",
        "validation",
      ].sort(),
    );
    expect(Object.keys(FINALIZED_REPORT.backend)).toEqual(["exitCode", "elapsedMilliseconds"]);

    // Nowhere in the whole serialized queue, at any depth.
    const serialized = JSON.stringify({ sequence: 3, state: { status: "terminal", queue: QUEUE } });
    for (const forbidden of ["path", "destination", "root", "stdout", "stderr", "identity"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // `stagingResidue` is the one member whose name says "staging", and it says
    // only whether MSCanvas failed to remove its own temporary folder. It is a
    // stable identifier or null, never the folder.
    expect(CONVERTED_ITEM.report.stagingResidue).toBeNull();
    // A file name is not a path, and the distinction is the whole point: the
    // display name is here, and nothing that could locate it is. Checked over
    // the string values rather than the serialization, whose own punctuation
    // would answer for itself.
    expect(serialized).toContain("FT-HCD-MSX.raw");
    for (const value of stringsWithin({ sequence: 3, state: { status: "terminal", queue: QUEUE } })) {
      expect(value).not.toMatch(/[\\/]/);
      expect(value).not.toMatch(/^[A-Za-z]:/);
    }
  });
});
