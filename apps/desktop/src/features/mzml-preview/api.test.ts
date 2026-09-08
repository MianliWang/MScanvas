import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deferred, settledAt, shippedIntent } from "../../test/previewFixtures";
import type { AuthorityObserved, ConversionBeginOutcome, DestinationPolicy, FolderIngestionResult, WorkspaceConversionUpdate } from "./contracts";
import { tauriPreviewApi } from "./api";

interface FolderImportReservation {
  readonly reservationId: string;
}

function exactClaim(payload: unknown, reservationId: string): void {
  expect(payload).toEqual({ reservationId });
  const rendered = JSON.stringify(payload);
  for (const privateName of ["path", "root", "generation", "token"]) {
    expect(rendered).not.toContain(privateName);
  }
}

async function flushPromiseTurns(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
}

describe("Tauri folder-import reservation boundary", () => {
  afterEach(() => {
    clearMocks();
  });

  it("waits for the reservation response before claiming it and releasing mutations", async () => {
    const reservation = deferred<FolderImportReservation>();
    const terminal = deferred<FolderIngestionResult | null>();
    const calls: { readonly command: string; readonly payload: unknown }[] = [];
    const onReserved = vi.fn();

    mockIPC((command, payload) => {
      calls.push({ command, payload });
      if (command === "begin_mzml_folder_import") {
        return reservation.promise;
      }
      if (command === "choose_mzml_folder") {
        return terminal.promise;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const result = tauriPreviewApi.chooseFolder(onReserved);
    expect(calls).toEqual([{ command: "begin_mzml_folder_import", payload: {} }]);
    expect(onReserved).not.toHaveBeenCalled();

    let terminalSettled = false;
    void result.then(() => {
      terminalSettled = true;
    });
    reservation.resolve({ reservationId: "folder-import-reservation-17" });
    await flushPromiseTurns();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.command).toBe("choose_mzml_folder");
    exactClaim(calls[1]?.payload, "folder-import-reservation-17");
    expect(onReserved).toHaveBeenCalledTimes(1);
    expect(terminalSettled).toBe(false);

    terminal.resolve(null);
    await expect(result).resolves.toBeNull();
    expect(onReserved).toHaveBeenCalledTimes(1);
  });

  it("does not claim or acknowledge a reservation whose begin request failed", async () => {
    const commands: string[] = [];
    const onReserved = vi.fn();
    const failure = { kind: "preview_worker_unavailable", summary: "failed", retryable: true };
    mockIPC((command) => {
      commands.push(command);
      if (command === "begin_mzml_folder_import") {
        return Promise.reject(failure);
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(tauriPreviewApi.chooseFolder(onReserved)).rejects.toEqual(failure);
    expect(commands).toEqual(["begin_mzml_folder_import"]);
    expect(onReserved).not.toHaveBeenCalled();
  });

  it("keeps out-of-order callers on the one single-use live reservation", async () => {
    const begins = [
      deferred<FolderImportReservation>(),
      deferred<FolderImportReservation>(),
    ];
    const terminal = deferred<FolderIngestionResult | null>();
    const replayFailure = {
      kind: "invalid_folder_import_reservation",
      summary: "That folder import is no longer available. Start it again.",
      retryable: true,
    };
    const claims: unknown[] = [];
    let beginIndex = 0;

    mockIPC((command, payload) => {
      if (command === "begin_mzml_folder_import") {
        const begin = begins[beginIndex];
        beginIndex += 1;
        return begin?.promise;
      }
      if (command === "choose_mzml_folder") {
        claims.push(payload);
        return claims.length === 1 ? terminal.promise : Promise.reject(replayFailure);
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const firstReserved = vi.fn();
    const secondReserved = vi.fn();
    const first = tauriPreviewApi.chooseFolder(firstReserved);
    const second = tauriPreviewApi.chooseFolder(secondReserved);

    // Rust makes begin idempotent at one workspace generation, so two callers
    // whose replies cross still receive the same bounded reservation. The
    // first exact claim consumes it; the replay is refused.
    begins[1]?.resolve({ reservationId: "folder-import-reservation-20" });
    await flushPromiseTurns();
    expect(secondReserved).toHaveBeenCalledTimes(1);
    expect(firstReserved).not.toHaveBeenCalled();
    exactClaim(claims[0], "folder-import-reservation-20");

    begins[0]?.resolve({ reservationId: "folder-import-reservation-20" });
    await flushPromiseTurns();
    expect(firstReserved).toHaveBeenCalledTimes(1);
    exactClaim(claims[1], "folder-import-reservation-20");

    terminal.resolve(null);
    await expect(second).resolves.toBeNull();
    await expect(first).rejects.toEqual(replayFailure);
  });
});

describe("the semantic conversion destination boundary", () => {
  beforeEach(() => vi.stubGlobal("__MSCANVAS_DOCUMENT_AUTHORITY__", "0123456789abcdef0123456789abcdef"));
  afterEach(() => { clearMocks(); vi.unstubAllGlobals(); });

  it.each<DestinationPolicy>([
    { kind: "customFolder" }, { kind: "sourceSibling" }, { kind: "namedSubfolder", name: "Results" },
  ])("passes $kind as a complete question and claims only Rust's reservation", async (destinationPolicy) => {
    const request = {
      handles: ["source-1"], intentId: shippedIntent.id, conflictPolicy: "skip" as const,
      destinationPolicy, expectedReceipt: 1,
    };
    const begun = deferred<AuthorityObserved<ConversionBeginOutcome>>();
    const converted = deferred<WorkspaceConversionUpdate>();
    const calls: { command: string; payload: unknown }[] = [];
    const onReserved = vi.fn();
    const planned = {
      outcome: "planned", plan: {
        items: [{ datasetHandle: "source-1", fileName: "source.raw", sourceKind: "thermo_raw",
          output: { kind: "knownSingle", fileName: "source.mzML" } }],
        outputFormat: "mzML", compression: "zlib", validationMode: "output_only", capacity: 16,
        intent: shippedIntent, conflictPolicy: "skip", destinationPolicy, receipt: 1,
      },
    };
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      if (command === "describe_workspace_conversion_queue") return planned;
      if (command === "begin_workspace_conversion_queue") return begun.promise;
      if (command === "choose_workspace_conversion_destination") return converted.promise;
      throw new Error(`unexpected command: ${command}`);
    });
    await expect(tauriPreviewApi.describeConversion(request)).resolves.toEqual(planned);
    expect(calls).toEqual([{ command: "describe_workspace_conversion_queue", payload: { request } }]);
    const start = tauriPreviewApi.convertDatasets(request, onReserved);
    expect(calls[1]).toEqual({ command: "begin_workspace_conversion_queue", payload: { request } });
    expect(calls).toHaveLength(2);
    expect(onReserved).not.toHaveBeenCalled();
    const beginAuthority = settledAt(1, 1);
    begun.resolve({ authority: beginAuthority, outcome: {
      outcome: "reserved", reservation: { reservationId: "conversion-17" },
    } });
    await flushPromiseTurns();
    expect(calls[2]?.command).toBe("choose_workspace_conversion_destination");
    exactClaim(calls[2]?.payload, "conversion-17");
    expect(onReserved).toHaveBeenCalledTimes(1);
    const update: WorkspaceConversionUpdate = {
      sequence: 2, state: { status: "idle" }, backendQuarantined: false,
      authority: settledAt(2, 2),
      diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    };
    converted.resolve(update);
    await expect(start).resolves.toEqual({
      authority: beginAuthority, outcome: { outcome: "converted", update },
    });
    expect(calls).toHaveLength(3);
  });

  it("does not resolve a destination after a refused BEGIN", async () => {
    const calls: string[] = [];
    const onReserved = vi.fn();
    const refused = { authority: settledAt(2, 2), outcome: {
      outcome: "refused", error: { kind: "conversion_binding_replaced", summary: "Describe again.", detail: null, retryable: true },
    } };
    mockIPC((command) => { calls.push(command); return refused; });
    await expect(tauriPreviewApi.convertDatasets({
      handles: ["source-1"], intentId: shippedIntent.id, conflictPolicy: "fail",
      destinationPolicy: { kind: "sourceSibling" }, expectedReceipt: 1,
    }, onReserved)).resolves.toEqual(refused);
    expect(calls).toEqual(["begin_workspace_conversion_queue"]);
    expect(onReserved).not.toHaveBeenCalled();
  });
});

describe("the linked figure boundary", () => {
  afterEach(() => {
    clearMocks();
  });

  /*
   * What actually crosses `invoke`, which no test above this line was watching.
   *
   * Found by the M4.4 mutation set: adding two array fields to the linked
   * export's payload passed the whole unit suite, because every other test
   * substitutes the `PreviewApi` and therefore records what the *hook* sent
   * rather than what the adapter did. The rendered suite caught it, which is
   * slow and far from the change.
   *
   * So the payload is pinned here, exactly. A linked figure is the one surface
   * that could plausibly grow an argument -- it is about two sources, and the
   * arrays of one of them are sitting right there in the document -- and the
   * whole posture of this boundary is that they never travel.
   */
  const RANGE = { scope: "current", low: 0.25, high: 0.75 } as const;
  const TRACES = { tic: true, bpc: false } as const;
  const SETTINGS = { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "light" } as const;

  it("sends two tokens, a range, the traces and the settings, and nothing else", async () => {
    const calls: { readonly command: string; readonly payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      if (command === "begin_linked_figure_export") {
        return "linked-reservation-1";
      }
      if (command === "save_linked_figure_export") {
        return { status: "cancelled" };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await tauriPreviewApi.exportLinkedFigure("2", "1", "svg", RANGE, TRACES, SETTINGS);

    expect(calls).toEqual([
      {
        command: "begin_linked_figure_export",
        payload: {
          chromatogramToken: "2",
          spectrumToken: "1",
          format: "svg",
          range: RANGE,
          traces: TRACES,
          settings: SETTINGS,
        },
      },
      { command: "save_linked_figure_export", payload: { reservationId: "linked-reservation-1" } },
    ]);
    // No measurement, and no retention time either: where the marked scan sits
    // is the retained row's fact and travels the other way.
    const rendered = JSON.stringify(calls);
    for (const forbidden of ["mz", "intensity", "retentionTime", "path", "handle"]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it("copies with the same pair, and claims no destination", async () => {
    const calls: { readonly command: string; readonly payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      if (command === "copy_linked_plot") {
        return { status: "copied" };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await tauriPreviewApi.copyLinkedPlot("2", "1", RANGE, TRACES, SETTINGS);

    expect(calls).toEqual([
      {
        command: "copy_linked_plot",
        payload: {
          chromatogramToken: "2",
          spectrumToken: "1",
          range: RANGE,
          traces: TRACES,
          settings: SETTINGS,
        },
      },
    ]);
    // One command rather than two: a copy chooses no destination, so there is
    // no dialog to gate and nothing to come back from.
    expect(calls.map((call) => call.command)).not.toContain("save_linked_figure_export");
  });
});
