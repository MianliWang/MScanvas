import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deferred } from "../../test/previewFixtures";
import type { FolderIngestionResult } from "./contracts";
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
    const begins = [deferred<FolderImportReservation>(), deferred<FolderImportReservation>()];
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
