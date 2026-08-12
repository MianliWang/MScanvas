import { describe, expect, it } from "vitest";

import type {
  ConversionCancellation,
  ConversionConflictPolicy,
  ConversionDiagnosticsExport,
  ConversionDiagnosticsState,
  ConversionQueue,
  ConversionQueueItem,
  ConversionQueueItemState,
  ConversionQueueTerminalReason,
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
      readonly status: "stopping";
      readonly operationId: string;
      readonly queue: ConversionQueue;
    }
  | {
      readonly status: "terminal";
      readonly operationId: string;
      readonly reason: ConversionQueueTerminalReason;
      readonly queue: ConversionQueue;
    };

/**
 * What a document may know about diagnostics, restated independently.
 *
 * Four facts and no fifth. A document, a diagnostics excerpt and an exported
 * path are all things Rust holds and this side never receives, so this
 * declaration failing to compile is what would say one had arrived.
 */
type ExpectedConversionDiagnosticsState = {
  readonly eligibleItemCount: number;
  readonly available: boolean;
  readonly exporting: boolean;
  readonly lastExport: ConversionDiagnosticsExport | null;
};

/** What one export wrote: a name, a size, a digest and a count. */
type ExpectedConversionDiagnosticsExport = {
  readonly operationId: string;
  readonly retryRound: number;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly diagnosticItemCount: number;
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
const diagnosticsStateIsExact: Equal<
  ConversionDiagnosticsState,
  ExpectedConversionDiagnosticsState
> = true;
const diagnosticsExportIsExact: Equal<
  ConversionDiagnosticsExport,
  ExpectedConversionDiagnosticsExport
> = true;

// Four members, and every one of them is now a support claim. `shimadzu_lcd`
// was admitted privately before ADR 0020 gave it a picker route; `sciex_wiff`
// was admitted privately before ADR 0027 gave it one. Widening this line is the
// whole decision, so it is made here on purpose rather than absorbed by a
// permissive type. See ADR 0019, ADR 0023 and ADR 0027.
const familyIsExact: Equal<
  DatasetSourceKind,
  "mzml" | "thermo_raw" | "shimadzu_lcd" | "sciex_wiff"
> = true;
const validationIsExact: Equal<ValidationMode, "source_comparison" | "output_only"> = true;
const conflictIsExact: Equal<ConversionConflictPolicy, "fail" | "skip"> = true;
const itemStateIsExact: Equal<
  ConversionQueueItemState,
  | "pending"
  | "running"
  | "finalized"
  | "skipped"
  | "failed"
  | "cancelled"
  | "notRun"
  | "cancellationFailed"
> = true;
const terminalReasonIsExact: Equal<
  ConversionQueueTerminalReason,
  "completed" | "stopped" | "stopFailed"
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
  output: { kind: "knownSingle", fileName: "FT-HCD-MSX.mzML" },
  state: "finalized",
  attempts: 1,
  retryable: false,
  result: { kind: "single", report: FINALIZED_REPORT },
  error: null,
  cancellation: null,
} as const satisfies ConversionQueueItem;

const FAILED_ITEM = {
  datasetHandle: "file-1",
  fileName: "second.raw",
  sourceKind: "thermo_raw",
  output: { kind: "knownSingle", fileName: "second.mzML" },
  state: "failed",
  attempts: 2,
  retryable: true,
  result: null,
  error: {
    kind: "file_unreadable",
    summary: "MSCanvas could not read that file.",
    detail: null,
    retryable: true,
  },
  cancellation: null,
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
  cancelledCount: 0,
  notRunCount: 0,
  cancellationFailedCount: 0,
  adoptableOutputCount: 1,
  error: null,
  installationGeneration: 0,
} as const satisfies ConversionQueue;

/** What a stop establishes, as the M3.4 head reports it. */
const CANCELLATION = {
  processLaunched: true,
  terminationRequested: true,
  treeTerminationConfirmed: true,
  elapsedMilliseconds: 71,
  termination: "cancelled",
  partialOutputObserved: true,
  stagingResidue: null,
} as const satisfies ConversionCancellation;

const CANCELLED_ITEM = {
  datasetHandle: "file-2",
  fileName: "third.raw",
  sourceKind: "thermo_raw",
  output: { kind: "knownSingle", fileName: "third.mzML" },
  state: "cancelled",
  attempts: 1,
  retryable: false,
  result: null,
  error: null,
  cancellation: CANCELLATION,
} as const satisfies ConversionQueueItem;

const NOT_RUN_ITEM = {
  datasetHandle: "file-3",
  fileName: "fourth.raw",
  sourceKind: "thermo_raw",
  output: { kind: "knownSingle", fileName: "fourth.mzML" },
  state: "notRun",
  attempts: 0,
  retryable: false,
  result: null,
  error: null,
  cancellation: null,
} as const satisfies ConversionQueueItem;

const STOPPED_QUEUE = {
  items: [CONVERTED_ITEM, CANCELLED_ITEM, NOT_RUN_ITEM],
  currentIndex: 3,
  itemCount: 3,
  retryRound: 0,
  conflictPolicy: "fail",
  finalizedCount: 1,
  skippedCount: 0,
  failedCount: 0,
  retryableFailedCount: 0,
  nonRetryableFailedCount: 0,
  cancelledCount: 1,
  notRunCount: 1,
  cancellationFailedCount: 0,
  adoptableOutputCount: 1,
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
    expect(diagnosticsStateIsExact).toBe(true);
    expect(diagnosticsExportIsExact).toBe(true);
    expect(familyIsExact).toBe(true);
    expect(validationIsExact).toBe(true);
    expect(conflictIsExact).toBe(true);
    expect(itemStateIsExact).toBe(true);
    expect(terminalReasonIsExact).toBe(true);
  });

  it("round-trips the whole state vocabulary through JSON unchanged", () => {
    // Nothing diagnostic here, which is the ordinary shape: the state is
    // carried on every read rather than only on the reads that have something
    // to report, so a reader never has to tell "absent" from "nothing to say".
    const NO_DIAGNOSTICS = {
      eligibleItemCount: 0,
      available: false,
      exporting: false,
      lastExport: null,
    } as const;
    const updates = [
      {
        sequence: 0,
        state: { status: "idle" },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
      {
        sequence: 1,
        state: { status: "awaitingDestination", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
      {
        sequence: 2,
        state: { status: "running", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
      {
        sequence: 3,
        state: { status: "stopping", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
      {
        sequence: 4,
        state: {
          status: "terminal",
          operationId: "1",
          reason: "stopped",
          queue: STOPPED_QUEUE,
        },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
      {
        sequence: 5,
        state: {
          status: "terminal",
          operationId: "1",
          reason: "stopFailed",
          queue: STOPPED_QUEUE,
        },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: true,
      },
      {
        sequence: 6,
        state: { status: "terminal", operationId: "1", reason: "completed", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
    ] as const satisfies readonly WorkspaceConversionUpdate[];

    expect(JSON.parse(JSON.stringify(updates))).toEqual(updates);
    expect(Object.keys(updates[0])).toEqual([
      "sequence",
      "state",
      "diagnostics",
      "backendQuarantined",
    ]);
    expect(updates.map((update) => update.state.status)).toEqual([
      "idle",
      "awaitingDestination",
      "running",
      "stopping",
      "terminal",
      "terminal",
      "terminal",
    ]);
  });

  it("carries one queue and never a history of them", () => {
    // Every non-idle state names `queue`, singular, and the terminal one is no
    // exception: a finished queue is replaced by the next, not appended to.
    const NO_DIAGNOSTICS = {
      eligibleItemCount: 0,
      available: false,
      exporting: false,
      lastExport: null,
    } as const;
    for (const update of [
      {
        sequence: 1,
        state: { status: "awaitingDestination", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
      {
        sequence: 2,
        state: { status: "running", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
      {
        sequence: 3,
        state: { status: "stopping", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
      },
    ] as const satisfies readonly WorkspaceConversionUpdate[]) {
      expect(Object.keys(update.state).sort()).toEqual(["operationId", "queue", "status"]);
    }
    // The terminal state carries one more member and only that one: why it is
    // over. A stopped queue is terminal in a different way from a completed
    // one, and no count of item states tells them apart.
    expect(
      Object.keys({
        status: "terminal",
        operationId: "1",
        reason: "stopped",
        queue: STOPPED_QUEUE,
      }).sort(),
    ).toEqual(["operationId", "queue", "reason", "status"]);
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
        "adoptableOutputCount",
        "conflictPolicy",
        "currentIndex",
        "error",
        "failedCount",
        "finalizedCount",
        "installationGeneration",
        "itemCount",
        "items",
        "nonRetryableFailedCount",
        "cancelledCount",
        "notRunCount",
        "cancellationFailedCount",
        "retryRound",
        "retryableFailedCount",
        "skippedCount",
      ].sort(),
    );
    expect(Object.keys(CONVERTED_ITEM).sort()).toEqual(
      [
        "attempts",
        "cancellation",
        "datasetHandle",
        "error",
        "fileName",
        "output",
        "result",
        "retryable",
        "sourceKind",
        "state",
      ].sort(),
    );
    // What a stop is allowed to say about an attempt: whether a process ran,
    // whether its tree was confirmed gone, how long the request took, and two
    // shapes. No process identifier, no job handle, no location.
    expect(Object.keys(CANCELLATION).sort()).toEqual(
      [
        "elapsedMilliseconds",
        "partialOutputObserved",
        "processLaunched",
        "stagingResidue",
        "termination",
        "terminationRequested",
        "treeTerminationConfirmed",
      ].sort(),
    );
    // A cancelled item finalized nothing, so it names no output file and
    // carries no report to name one from.
    expect(CANCELLED_ITEM.result).toBeNull();
    // A not-run item launched nothing, so there is nothing for a stop to have
    // established about it.
    expect(NOT_RUN_ITEM.cancellation).toBeNull();
    expect(NOT_RUN_ITEM.attempts).toBe(0);
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
    expect(CONVERTED_ITEM.result.report.stagingResidue).toBeNull();
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
