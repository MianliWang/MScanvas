import { describe, expect, it } from "vitest";

import type {
  BackendAuthorityProjection,
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
  | "skippedByRequest"
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
    advisory: [],
  },
  backend: { exitCode: 0, elapsedMilliseconds: 568 },
  stagingResidue: null,
  receipt: 1,
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
  stopRequested: false,
  // A run that exited cleanly and published what it staged. The staged
  // judgement is settled by the publication rather than by a listing.
  process: { kind: "settled", termination: "exited", exitCode: 0 },
  staged: { kind: "published" },
  runIdentity: "6f1d3c2b9a480000000000000000002a",
  adoption: { kind: "notRequested" },
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
  stopRequested: false,
  // A refusal this session made before the provider was invoked: no process, no
  // staging area, and no identity for either to belong to.
  process: { kind: "notAttempted" },
  staged: { kind: "notCreated" },
  runIdentity: null,
  adoption: { kind: "nothingToAdopt" },
} as const satisfies ConversionQueueItem;

const QUEUE = {
  items: [CONVERTED_ITEM, FAILED_ITEM],
  currentIndex: 2,
  itemCount: 2,
  retryRound: 1,
  conflictPolicy: "fail",
  destinationPolicy: { kind: "customFolder" },
  destinationStatus: "bound",
  finalizedCount: 1,
  skippedCount: 0,
  failedCount: 1,
  retryableFailedCount: 1,
  nonRetryableFailedCount: 0,
  cancelledCount: 0,
  notRunCount: 0,
  skippedByRequestCount: 0,
  cancellationFailedCount: 0,
  adoptableOutputCount: 1,
  error: null,
  receipt: 1,
} as const satisfies ConversionQueue;

/** What a stop establishes, as the M3.4 head reports it. */
const CANCELLATION = {
  processLaunched: true,
  terminationRequested: true,
  ownedTree: "confirmed_gone",
  elapsedMilliseconds: 71,
  termination: "cancelled",
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
  stopRequested: false,
  // A stop that reached a running attempt. The staging area was read before
  // teardown and held one partly written document — which residue cannot say,
  // because teardown reclaimed it cleanly.
  process: { kind: "settled", termination: "cancelled", exitCode: null },
  staged: {
    kind: "observed",
    phase: "provider_returned",
    entryCount: 1,
    directoryCount: 0,
    nonEmptyFileObserved: true,
    bounded: false,
  },
  runIdentity: "6f1d3c2b9a480000000000000000002b",
  adoption: { kind: "nothingToAdopt" },
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
  stopRequested: false,
  // The queue never began it. Nothing launched and nothing was created, and
  // `notAttempted` is what says so rather than an absent field.
  process: { kind: "notAttempted" },
  staged: { kind: "notCreated" },
  runIdentity: null,
  adoption: { kind: "nothingToAdopt" },
} as const satisfies ConversionQueueItem;

const STOPPED_QUEUE = {
  items: [CONVERTED_ITEM, CANCELLED_ITEM, NOT_RUN_ITEM],
  currentIndex: 3,
  itemCount: 3,
  retryRound: 0,
  conflictPolicy: "fail",
  destinationPolicy: { kind: "customFolder" },
  destinationStatus: "bound",
  finalizedCount: 1,
  skippedCount: 0,
  failedCount: 0,
  retryableFailedCount: 0,
  nonRetryableFailedCount: 0,
  cancelledCount: 1,
  notRunCount: 1,
  skippedByRequestCount: 0,
  cancellationFailedCount: 0,
  adoptableOutputCount: 1,
  error: null,
  receipt: 1,
} as const satisfies ConversionQueue;

/**
 * The authority every answer in this shape carries.
 *
 * One value across the sequence below, because none of these transitions is an
 * installation change: what the poll delivers is what the session is bound to,
 * and it is unchanged for the length of one queue.
 */
const SETTLED = {
  revision: 1,
  state: {
    state: "settled",
    receipt: 1,
    binding: "installed",
    previewAvailability: "usable",
  },
} as const satisfies BackendAuthorityProjection;

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
        authority: SETTLED,
      },
      {
        sequence: 1,
        state: { status: "awaitingDestination", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
        authority: SETTLED,
      },
      {
        sequence: 2,
        state: { status: "running", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
        authority: SETTLED,
      },
      {
        sequence: 3,
        state: { status: "stopping", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
        authority: SETTLED,
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
        authority: SETTLED,
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
        authority: SETTLED,
      },
      {
        sequence: 6,
        state: { status: "terminal", operationId: "1", reason: "completed", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
        authority: SETTLED,
      },
    ] as const satisfies readonly WorkspaceConversionUpdate[];

    expect(JSON.parse(JSON.stringify(updates))).toEqual(updates);
    expect(Object.keys(updates[0])).toEqual([
      "sequence",
      "state",
      "diagnostics",
      "backendQuarantined",
      // Every answer in this shape delivers it, the poll included: while a
      // drain runs this is the session's only voice, and a replacement it
      // observed would otherwise reach nobody until the drain ended.
      "authority",
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
        authority: SETTLED,
      },
      {
        sequence: 2,
        state: { status: "running", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
        authority: SETTLED,
      },
      {
        sequence: 3,
        state: { status: "stopping", operationId: "1", queue: QUEUE },
        diagnostics: NO_DIAGNOSTICS,
        backendQuarantined: false,
        authority: SETTLED,
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

  it("carries semantic destination facts without a path or raw backend stream", () => {
    // The whole key set, so a field added upstream has to be answered for here
    // rather than arriving unnoticed.
    expect(Object.keys(QUEUE).sort()).toEqual(
      [
        "adoptableOutputCount",
        "conflictPolicy",
        "currentIndex",
        "destinationPolicy",
        "destinationStatus",
        "error",
        "failedCount",
        "finalizedCount",
        "receipt",
        "itemCount",
        "items",
        "nonRetryableFailedCount",
        "cancelledCount",
        "notRunCount",
        "skippedByRequestCount",
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
        "stopRequested",
        // The three an attempt establishes about itself and nothing downstream
        // can reconstruct, plus the fifth judgement. On the item rather than on
        // the report, because a cancelled row has no report.
        "process",
        "staged",
        "runIdentity",
        "adoption",
      ].sort(),
    );
    // What a stop is allowed to say about an attempt: whether a process ran,
    // whether its tree was confirmed gone, how long the request took, and two
    // shapes. No process identifier, no job handle, no location.
    expect(Object.keys(CANCELLATION).sort()).toEqual(
      [
        "elapsedMilliseconds",
        "ownedTree",
        "processLaunched",
        "stagingResidue",
        "termination",
        "terminationRequested",
      ].sort(),
    );
    // `partialOutputObserved` left, and its absence is the point. It was a
    // boolean over an optional observation, so it answered `false` both for a
    // staging area read and found empty and for one that could not be read at
    // all. The item's own `staged` is the four-way answer that replaced it, and
    // it is present for every settled row rather than only for a stopped one.
    expect(Object.keys(CANCELLATION)).not.toContain("partialOutputObserved");
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
        "receipt",
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
    for (const forbidden of ["path", "root", "stdout", "stderr"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // `identity` used to be forbidden outright, because the only identities
    // this application had were filesystem ones: a volume serial and a file id,
    // which locate an object as surely as a path does. Those are still absent,
    // and the check that they are is now the specific one rather than the word.
    for (const forbidden of ["fileidentity", "volumeserial", "objectid", "handle:"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
    // The one identity that does cross is the run's, and it is opaque: minted
    // before the converter was invoked, fixed width, hexadecimal, and derived
    // from neither the output's name nor the queue. It resolves to nothing on
    // this machine and nothing in another session.
    const identities = Object.keys(CONVERTED_ITEM).filter((key) =>
      key.toLowerCase().includes("identity"),
    );
    expect(identities).toEqual(["runIdentity"]);
    expect(CONVERTED_ITEM.runIdentity).toMatch(/^[0-9a-f]{32}$/);
    // And an item that never reached the converter has none, which is what
    // keeps a refusal from reading as a run that happened.
    expect(FAILED_ITEM.runIdentity).toBeNull();
    expect(NOT_RUN_ITEM.runIdentity).toBeNull();
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
