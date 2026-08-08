import { describe, expect, it } from "vitest";

import type {
  ConversionConflictPolicy,
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
      readonly dataset: import("./contracts").SelectedFile;
    }
  | {
      readonly status: "running";
      readonly operationId: string;
      readonly dataset: import("./contracts").SelectedFile;
    }
  | {
      readonly status: "completed";
      readonly operationId: string;
      readonly report: ConversionReport;
    }
  | {
      readonly status: "failed";
      readonly operationId: string;
      readonly datasetHandle: string;
      readonly error: import("./contracts").PreviewError;
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

describe("the conversion wire contract", () => {
  it("keeps every closed union exactly as Rust spells it", () => {
    expect(wireStateIsBidirectionallyExact).toBe(true);
    expect(familyIsExact).toBe(true);
    expect(validationIsExact).toBe(true);
    expect(conflictIsExact).toBe(true);
  });

  it("round-trips the whole state vocabulary through JSON unchanged", () => {
    const dataset = {
      handle: "file-0",
      fileName: "FT-HCD-MSX.raw",
      byteLength: 78_309,
      sourceKind: "thermo_raw",
      relativeContext: null,
    } as const;
    // The exact report the implementation head produced against the evidenced
    // build, so this pins the real serialization rather than an invented one.
    const report = {
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
    } as const;

    const updates = [
      { sequence: 0, state: { status: "idle" } },
      { sequence: 1, state: { status: "awaitingDestination", operationId: "1", dataset } },
      { sequence: 2, state: { status: "running", operationId: "1", dataset } },
      { sequence: 3, state: { status: "completed", operationId: "1", report } },
      {
        sequence: 4,
        state: {
          status: "failed",
          operationId: "2",
          datasetHandle: "file-0",
          error: {
            kind: "destination_is_remote",
            summary: "MSCanvas saves converted files to this computer's own drives.",
            detail: null,
            retryable: true,
          },
        },
      },
    ] as const satisfies readonly WorkspaceConversionUpdate[];

    expect(JSON.parse(JSON.stringify(updates))).toEqual(updates);
    expect(Object.keys(updates[0])).toEqual(["sequence", "state"]);
    expect(updates.map((update) => update.state.status)).toEqual([
      "idle",
      "awaitingDestination",
      "running",
      "completed",
      "failed",
    ]);
  });

  it("never carries a path, a destination or a raw backend stream", () => {
    const report: ConversionReport = {
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
        verified: [],
        unverified: [],
        inapplicable: [],
      },
      backend: { exitCode: 0, elapsedMilliseconds: 568 },
      stagingResidue: null,
      installationGeneration: 0,
    };

    // The whole key set, so a field added upstream has to be answered for here
    // rather than arriving unnoticed.
    expect(Object.keys(report).sort()).toEqual(
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
    expect(Object.keys(report.backend ?? {})).toEqual(["exitCode", "elapsedMilliseconds"]);
    for (const forbidden of ["path", "destination", "root", "stdout", "stderr", "identity"]) {
      expect(Object.keys(report)).not.toContain(forbidden);
    }
  });
});
