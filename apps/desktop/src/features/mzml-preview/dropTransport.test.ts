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
    core.invoke.mockResolvedValue(undefined);
    const received: WorkspaceDropUpdate[] = [];

    const stop = await tauriWorkspaceDropTransport.subscribe((update) => {
      received.push(update);
    });

    expect(core.channels).toHaveLength(1);
    expect(core.invoke).toHaveBeenCalledTimes(1);
    expect(core.invoke).toHaveBeenCalledWith("subscribe_workspace_drop_updates", {
      channel: core.channels[0],
    });
    expect(JSON.stringify(core.invoke.mock.calls[0])).not.toMatch(
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
    core.invoke.mockRejectedValue(failure);
    const received: WorkspaceDropUpdate[] = [];

    await expect(
      tauriWorkspaceDropTransport.subscribe((update) => {
        received.push(update);
      }),
    ).rejects.toBe(failure);

    core.channels[0]?.onmessage(idle);
    expect(received).toEqual([]);
  });

  it("serializes subscriber replacement so a delayed old registration cannot win", async () => {
    let resolveFirst: () => void = () => {
      throw new Error("first registration resolver was not installed");
    };
    const firstRegistration = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    core.invoke.mockImplementationOnce(() => firstRegistration).mockResolvedValueOnce(undefined);

    const first = tauriWorkspaceDropTransport.subscribe(() => undefined);
    const second = tauriWorkspaceDropTransport.subscribe(() => undefined);
    await Promise.resolve();
    expect(core.invoke).toHaveBeenCalledTimes(1);

    resolveFirst();
    const stopFirst = await first;
    const stopSecond = await second;
    expect(core.invoke).toHaveBeenCalledTimes(2);
    expect(core.invoke.mock.calls.map((call) => call[1])).toEqual([
      { channel: core.channels[0] },
      { channel: core.channels[1] },
    ]);
    stopFirst();
    stopSecond();
  });

  it("uses core Channel directly and never falls back to the global event API", () => {
    expect(source).toContain('from "@tauri-apps/api/core"');
    expect(source).not.toContain("@tauri-apps/api/event");
    expect(source).not.toContain("tauri://drag");
  });
});
