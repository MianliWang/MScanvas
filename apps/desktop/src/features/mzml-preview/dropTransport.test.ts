import { beforeEach, describe, expect, it, vi } from "vitest";

import source from "./dropTransport.ts?raw";
import type { WorkspaceDropUpdate } from "./contracts";

const core = vi.hoisted(() => ({
  channels: [] as Array<{ onmessage: (update: WorkspaceDropUpdate) => void }>,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> {
    onmessage = (_message: T) => undefined;

    constructor() {
      core.channels.push(
        this as unknown as { onmessage: (update: WorkspaceDropUpdate) => void },
      );
    }
  },
  invoke: core.invoke,
}));

import { tauriWorkspaceDropTransport } from "./dropTransport";

const idle: WorkspaceDropUpdate = { sequence: 1, state: { status: "idle" } };

describe("native workspace-drop transport", () => {
  beforeEach(() => {
    core.channels.length = 0;
    core.invoke.mockReset();
  });

  it("subscribes one Channel through the exact path-free command and stops local delivery", async () => {
    core.invoke
      .mockResolvedValueOnce({ reservationId: "drop-subscription-reservation-1" })
      .mockResolvedValueOnce(null);
    const received: WorkspaceDropUpdate[] = [];

    const stop = await tauriWorkspaceDropTransport.subscribe((update) => {
      received.push(update);
    });

    expect(core.channels).toHaveLength(1);
    expect(core.invoke).toHaveBeenCalledTimes(2);
    expect(core.invoke).toHaveBeenCalledWith("subscribe_workspace_drop_updates", {
      request: { phase: "begin" },
    });
    expect(core.invoke).toHaveBeenCalledWith("subscribe_workspace_drop_updates", {
      request: {
        phase: "claim",
        reservationId: "drop-subscription-reservation-1",
        channel: core.channels[0],
      },
    });
    expect(JSON.stringify(core.invoke.mock.calls)).not.toMatch(
      /path|root|generation|token|identity|position/i,
    );

    core.channels[0]?.onmessage(idle);
    expect(received).toEqual([idle]);
    stop();
    core.channels[0]?.onmessage({ sequence: 2, state: { status: "idle" } });
    expect(received).toEqual([idle]);
  });

  it("silences the Channel when subscriber registration rejects", async () => {
    const failure = new Error("registration failed");
    core.invoke
      .mockResolvedValueOnce({ reservationId: "drop-subscription-reservation-2" })
      .mockRejectedValueOnce(failure);
    const received: WorkspaceDropUpdate[] = [];

    await expect(
      tauriWorkspaceDropTransport.subscribe((update) => {
        received.push(update);
      }),
    ).rejects.toBe(failure);

    core.channels[0]?.onmessage(idle);
    expect(received).toEqual([]);
  });

  it("releases the registration tail when Begin rejects", async () => {
    const failure = new Error("begin failed");
    core.invoke
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ reservationId: "drop-subscription-reservation-after-begin" })
      .mockResolvedValueOnce(null);

    await expect(tauriWorkspaceDropTransport.subscribe(() => undefined)).rejects.toBe(failure);
    const stop = await tauriWorkspaceDropTransport.subscribe(() => undefined);

    expect(core.invoke.mock.calls.map((call) => call[1])).toEqual([
      { request: { phase: "begin" } },
      { request: { phase: "begin" } },
      {
        request: {
          phase: "claim",
          reservationId: "drop-subscription-reservation-after-begin",
          channel: core.channels[0],
        },
      },
    ]);
    stop();
  });

  it("releases the registration tail and silences the failed Channel when Claim rejects", async () => {
    const failure = new Error("claim failed");
    const received: WorkspaceDropUpdate[] = [];
    core.invoke
      .mockResolvedValueOnce({ reservationId: "drop-subscription-reservation-failed-claim" })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ reservationId: "drop-subscription-reservation-after-claim" })
      .mockResolvedValueOnce(null);

    await expect(
      tauriWorkspaceDropTransport.subscribe((update) => received.push(update)),
    ).rejects.toBe(failure);
    const stop = await tauriWorkspaceDropTransport.subscribe((update) => received.push(update));

    core.channels[0]?.onmessage(idle);
    core.channels[1]?.onmessage({ sequence: 2, state: { status: "idle" } });
    expect(received).toEqual([{ sequence: 2, state: { status: "idle" } }]);
    expect(core.invoke).toHaveBeenCalledTimes(4);
    stop();
  });

  it("serializes subscriber replacement so a delayed old registration cannot win", async () => {
    let resolveFirstBegin: (value: { reservationId: string }) => void = () => {
      throw new Error("first begin resolver was not installed");
    };
    let resolveFirstClaim: (value: null) => void = () => {
      throw new Error("first claim resolver was not installed");
    };
    const firstBegin = new Promise<{ reservationId: string }>((resolve) => {
      resolveFirstBegin = resolve;
    });
    const firstClaim = new Promise<null>((resolve) => {
      resolveFirstClaim = resolve;
    });
    core.invoke
      .mockImplementationOnce(() => firstBegin)
      .mockImplementationOnce(() => firstClaim)
      .mockResolvedValueOnce({ reservationId: "drop-subscription-reservation-4" })
      .mockResolvedValueOnce(null);

    const firstReceived: WorkspaceDropUpdate[] = [];
    const secondReceived: WorkspaceDropUpdate[] = [];

    const first = tauriWorkspaceDropTransport.subscribe((update) => firstReceived.push(update));
    const second = tauriWorkspaceDropTransport.subscribe((update) => secondReceived.push(update));
    await Promise.resolve();
    expect(core.invoke).toHaveBeenCalledTimes(1);
    expect(core.channels).toHaveLength(0);

    resolveFirstBegin({ reservationId: "drop-subscription-reservation-3" });
    await Promise.resolve();
    await Promise.resolve();
    expect(core.invoke).toHaveBeenCalledTimes(2);
    expect(core.channels).toHaveLength(1);

    resolveFirstClaim(null);
    const stopFirst = await first;
    const stopSecond = await second;
    expect(core.invoke).toHaveBeenCalledTimes(4);
    expect(core.invoke.mock.calls.map((call) => call[1])).toEqual([
      { request: { phase: "begin" } },
      {
        request: {
          phase: "claim",
          reservationId: "drop-subscription-reservation-3",
          channel: core.channels[0],
        },
      },
      { request: { phase: "begin" } },
      {
        request: {
          phase: "claim",
          reservationId: "drop-subscription-reservation-4",
          channel: core.channels[1],
        },
      },
    ]);
    stopFirst();
    core.channels[0]?.onmessage(idle);
    core.channels[1]?.onmessage({ sequence: 2, state: { status: "idle" } });
    expect(firstReceived).toEqual([]);
    expect(secondReceived).toEqual([{ sequence: 2, state: { status: "idle" } }]);
    stopSecond();
  });

  it("uses core Channel directly and never falls back to the global event API", () => {
    expect(source).toContain('from "@tauri-apps/api/core"');
    expect(source).not.toContain("@tauri-apps/api/event");
    expect(source).not.toContain("tauri://drag");
  });
});
