import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import {
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  previewError,
  selectedFile,
  type FakePreviewApi,
} from "../../test/previewFixtures";
import { UI_RESOURCES } from "../preferences/i18n";
import { initialOrganization, organize, placeRestored, UNGROUPED } from "../workbench/organization";
import { PreviewApiProvider } from "./api";
import type { RestoredRow, RestoredRowState, WorkspaceRestorePutBack, WorkspaceRestoreRead, WorkspaceRestoreWrite } from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { PreviewWorkspace } from "./PreviewWorkspace";
import { initialRosterState, rosterReducer } from "./rosterSelection";
import { buildArrangement } from "./useWorkspaceRestore";

const en = UI_RESOURCES.en;

function row(handle: string, displayName: string, state: RestoredRowState = "matching", extra: Partial<RestoredRow> = {}): RestoredRow {
  return { handle, sourceKind: "mzml", displayName, context: null, checked: false, state, ...extra };
}

function offered(rows: readonly RestoredRow[], extra: Partial<Extract<WorkspaceRestoreRead, { outcome: "restored" }>> = {}): WorkspaceRestoreRead {
  return { outcome: "restored", groups: [{ name: null, rows }], expired: 0, leftoverCopies: 0, ...extra };
}

function mount(api: FakePreviewApi) {
  return render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}><PreviewWorkspace /></PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

const offerNotice = () => document.querySelector<HTMLElement>('[data-restore="offer"]');
const problemNotice = () => document.querySelector<HTMLElement>('[data-restore="problem"]');
const restoreAction = async () => screen.findByRole("button", { name: en.restoreAction });

describe("the arrangement Rust is told", () => {
  it("puts the rows still waiting in the group of their stored name and carries their checked state", () => {
    const created = organize(initialOrganization, { type: "create", name: "Batch" });
    const organization = {
      ...created,
      groups: created.groups.map(group => group.id === UNGROUPED ? { ...group, handles: ["file-1", "file-2"] } : group),
    };
    expect(buildArrangement(organization, new Set(["file-2"]), [
      { name: null, rows: [row("restored-0", "a.raw")] },
      { name: "Batch", rows: [row("restored-1", "b.raw", "matching", { checked: true })] },
      { name: "Elsewhere", rows: [row("restored-2", "c.raw", "missing")] },
    ])).toEqual({
      groups: [
        { name: null, handles: ["file-1", "file-2", "restored-0"] },
        { name: "Batch", handles: ["restored-1"] },
        { name: "Elsewhere", handles: ["restored-2"] },
      ],
      checked: ["file-2", "restored-1"],
    });
  });
});

describe("what a put-back does to the arrangement", () => {
  const result = (placed: WorkspaceRestorePutBack["placed"]): WorkspaceRestorePutBack => ({
    placed,
    workspace: {
      roster: { datasets: placed.map(({ handle }) => ({ ...selectedFile, handle })), capacity: 1024 },
      outcomes: placed.map(({ handle }) => ({ outcome: "added", dataset: { ...selectedFile, handle } })),
    },
  });

  it("restores the stored groups and checks only the rows stored checked, beside what is already checked", () => {
    const live = { ...selectedFile, handle: "file-0" };
    const before = rosterReducer(rosterReducer(initialRosterState, { type: "rosterLoaded", roster: { datasets: [live], capacity: 1024 } }),
      { type: "membershipChanged", handles: ["file-0"], checked: true });
    const placed = [
      { handle: "file-1", group: "Batch", checked: true, added: true },
      { handle: "file-2", group: null, checked: false, added: true },
    ];
    const answer = result(placed);
    const after = rosterReducer(before, {
      type: "workspaceRestored",
      groups: ["Empty", "Batch", null],
      result: { ...answer, workspace: { ...answer.workspace, roster: { datasets: [live, ...answer.workspace.roster.datasets], capacity: 1024 } } },
    });
    expect(after.organization.groups.map(group => [group.name, group.handles])).toEqual([
      ["", ["file-0", "file-2"]],
      ["Empty", []],
      ["Batch", ["file-1"]],
    ]);
    expect([...after.conversionMembership].sort()).toEqual(["file-0", "file-1"]);
    expect(after.organization.history).toHaveLength(0);
  });

  it("leaves a row that was already live where it is", () => {
    const state = placeRestored(initialOrganization, ["Batch"], []);
    expect(state.groups.map(group => group.name)).toEqual(["", "Batch"]);
    expect(placeRestored(state, ["Batch"], []).groups.map(group => group.name)).toEqual(["", "Batch"]);
  });
});

describe("the restore notice", () => {
  it("says what can come back, starts nothing by itself and saves nothing before a change", async () => {
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "saved" }));
    const restore = vi.fn(() => Promise.reject(new Error("never asked")));
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw"), row("restored-1", "b.raw")])),
      saveWorkspaceRestore: save,
      restoreWorkspace: restore,
    } });
    mount(api);
    await restoreAction();
    expect(offerNotice()).toHaveTextContent("2 files from the last session can be added again.");
    expect(restore).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(api.calls()).not.toContain("openPreview");
  });

  it("puts rows back on the press, says they were not verified, and records the result after a new read", async () => {
    const saved: unknown[] = [];
    let waiting: WorkspaceRestoreRead = offered([row("restored-0", "a.raw"), row("restored-1", "gone.raw", "missing")]);
    const dataset = { ...selectedFile, handle: "file-1" };
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(waiting),
      saveWorkspaceRestore: (arrangement) => { saved.push(arrangement); return Promise.resolve({ outcome: "saved" }); },
      restoreWorkspace: () => {
        waiting = offered([row("restored-1", "gone.raw", "missing")]);
        return Promise.resolve({
          workspace: { roster: { datasets: [dataset], capacity: 1024 }, outcomes: [{ outcome: "added", dataset }] },
          placed: [{ handle: "file-1", group: null, checked: false, added: true }],
        });
      },
    } });
    mount(api);
    fireEvent.click(await restoreAction());
    await waitFor(() => expect(saved).toEqual([{
      groups: [{ name: null, handles: ["file-1", "restored-1"] }],
      checked: [],
    }]));
    expect(document.querySelector('[data-live-region="workspace"]')).toHaveTextContent("Added 1 file again. It was not verified against the last session.");
    expect(screen.queryByRole("button", { name: en.restoreAction })).not.toBeInTheDocument();
    expect(api.calls()).not.toContain("openPreview");
  });

  it("refuses Restore workspace with the visible reason while the workspace is busy, and asks nothing", async () => {
    const restore = vi.fn(() => Promise.reject(new Error("never asked")));
    const adding = deferred<null>();
    const api = createFakePreviewApi({
      pickedFiles: () => adding.promise,
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw")])),
        restoreWorkspace: restore,
      },
    });
    mount(api);
    const action = await restoreAction();
    fireEvent.click(document.querySelector<HTMLElement>("[data-add-files]")!);
    await waitFor(() => expect(action).toHaveAttribute("aria-disabled", "true"));
    expect(action).toHaveAccessibleDescription(en.statusBusyPicker);
    fireEvent.click(action);
    expect(restore).not.toHaveBeenCalled();
    await act(async () => { adding.resolve(null); await adding.promise; });
    await waitFor(() => expect(action).not.toHaveAttribute("aria-disabled"));
  });

  it("shows each marked row with its reason and folder context, and dismisses one at a time", async () => {
    const dismissed: string[] = [];
    let rows: readonly RestoredRow[] = [
      row("restored-0", "QC.raw", "missing", { context: "batch-1" }),
      row("restored-1", "QC.raw", "changed", { context: "batch-2" }),
      row("restored-2", "c.raw", "unreachable"),
      row("restored-3", "d.raw", "unreadable"),
      row("restored-4", "e.raw", "unsafe"),
    ];
    const saved: unknown[] = [];
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(rows)),
      saveWorkspaceRestore: (arrangement) => { saved.push(arrangement); return Promise.resolve({ outcome: "saved" }); },
      dismissRestoredRow: (handle) => {
        dismissed.push(handle);
        rows = rows.filter(entry => entry.handle !== handle);
        return Promise.resolve();
      },
    } });
    mount(api);
    const listed = await waitFor(() => {
      const entries = document.querySelectorAll<HTMLElement>("[data-restored-row]");
      expect(entries).toHaveLength(5);
      return entries;
    });
    expect(offerNotice()).toHaveTextContent("5 files from the last session need attention.");
    expect(screen.queryByRole("button", { name: en.restoreAction })).not.toBeInTheDocument();
    expect(listed[0]).toHaveTextContent("QC.raw, batch-1");
    expect(listed[0]).toHaveTextContent(en.restoreStateMissing);
    expect(listed[1]).toHaveTextContent(en.restoreStateChanged);
    expect(listed[2]).toHaveTextContent(en.restoreStateUnreachable);
    expect(listed[3]).toHaveTextContent(en.restoreStateUnreadable);
    expect(listed[4]).toHaveTextContent(en.restoreStateUnsafe);

    const dismiss = within(listed[2] as HTMLElement).getByRole("button", { name: "Dismiss c.raw" });
    dismiss.focus();
    fireEvent.click(dismiss);
    await waitFor(() => expect(document.querySelectorAll("[data-restored-row]")).toHaveLength(4));
    expect(dismissed).toEqual(["restored-2"]);
    // The press's button left; the keyboard stays in the list, not on the body.
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-restore-dismiss"));
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it("says how many rows are no longer offered, and that line can be put away", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered([], { expired: 3 })),
    } });
    mount(api);
    const line = await waitFor(() => {
      const found = document.querySelector("[data-restore-expired]");
      expect(found).not.toBeNull();
      return found;
    });
    expect(line).toHaveTextContent("3 files from an earlier session are no longer offered.");
    fireEvent.click(within(offerNotice()!).getByRole("button", { name: en.dismiss }));
    expect(offerNotice()).toBeNull();
  });

  it("keeps a later window's refusal visible and stops recording", async () => {
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "refused", problem: "changedElsewhere" }));
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: { saveWorkspaceRestore: save },
    });
    mount(api);
    const row1 = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-handle="${selectedFile.handle}"] input[type="checkbox"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    // Reads then changes: this is the first change after the baseline.
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(row1);
    await waitFor(() => expect(problemNotice()).toHaveTextContent(en.restoreProblemChangedElsewhere));
    expect(within(problemNotice()!).queryByRole("button", { name: en.restoreTryAgain })).toBeNull();
    fireEvent.click(row1);
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("answers too many rows with Start fresh and records the session after it", async () => {
    let cleared = false;
    const saves: WorkspaceRestoreWrite[] = [{ outcome: "refused", problem: "tooManyRows" }, { outcome: "saved" }];
    const save = vi.fn(() => Promise.resolve(saves.shift() as WorkspaceRestoreWrite));
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(offered(cleared ? [] : [row("restored-0", "a.raw", "missing")])),
        saveWorkspaceRestore: save,
        clearWorkspaceRestore: () => { cleared = true; return Promise.resolve({ outcome: "saved" }); },
      },
    });
    mount(api);
    const row1 = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-handle="${selectedFile.handle}"] input[type="checkbox"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await waitFor(() => expect(offerNotice()).not.toBeNull());
    fireEvent.click(row1);
    await waitFor(() => expect(problemNotice()).toHaveTextContent(en.restoreProblemTooManyRows));
    fireEvent.click(within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(problemNotice()).toBeNull());
    expect(offerNotice()).toBeNull();
  });

  it("records a change made while the first read was still out, rather than taking it for the baseline", async () => {
    const reading = deferred<WorkspaceRestoreRead>();
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "saved" }));
    const api = createFakePreviewApi({
      pickedFiles: [selectedFile],
      workspaceRestore: { readWorkspaceRestore: () => reading.promise, saveWorkspaceRestore: save },
    });
    mount(api);
    const add = document.querySelector<HTMLElement>("[data-add-files]") ?? await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-add-files]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await waitFor(() => expect(add).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(add);
    await waitFor(() => expect(document.querySelector(`[data-handle="${selectedFile.handle}"]`)).not.toBeNull());
    expect(save).not.toHaveBeenCalled();
    await act(async () => { reading.resolve(offered([])); await reading.promise; });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("asks the list again for a stale refusal nothing newer followed, and then saves", async () => {
    const saves: WorkspaceRestoreWrite[] = [{ outcome: "refused", problem: "staleArrangement" }, { outcome: "saved" }];
    const save = vi.fn(() => Promise.resolve(saves.shift() as WorkspaceRestoreWrite));
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], workspaceRestore: { saveWorkspaceRestore: save } });
    mount(api);
    const row1 = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-handle="${selectedFile.handle}"] input[type="checkbox"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(row1);
    await waitFor(() => expect(problemNotice()).toHaveTextContent(en.restoreProblemStaleArrangement));
    const before = api.calls().filter(call => call === "getRoster").length;
    fireEvent.click(within(problemNotice()!).getByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(api.calls().filter(call => call === "getRoster").length).toBe(before + 1));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(problemNotice()).toBeNull());
  });

  it("asks a failed Start fresh again, and never a later failed save's Try again", async () => {
    const clears: WorkspaceRestoreWrite[] = [{ outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: true }, { outcome: "saved" }];
    const clear = vi.fn(() => Promise.resolve(clears.shift() as WorkspaceRestoreWrite));
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "failed", problem: "notWritten", retryable: true, temporaryLeftBehind: false }));
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw", "missing")])),
        clearWorkspaceRestore: clear,
        saveWorkspaceRestore: save,
      },
    });
    mount(api);
    await waitFor(() => expect(offerNotice()).not.toBeNull());
    fireEvent.click(within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh }));
    await waitFor(() => expect(problemNotice()).toHaveTextContent(en.restoreNotChanged));
    expect(problemNotice()).toHaveTextContent(en.restoreProblemTemporaryLeft);
    const row1 = document.querySelector<HTMLElement>(`[data-handle="${selectedFile.handle}"] input[type="checkbox"]`)!;
    fireEvent.click(row1);
    await waitFor(() => expect(problemNotice()).toHaveTextContent(en.restoreNotRecorded));
    fireEvent.click(within(problemNotice()!).getByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("offers Try again for a read that failed, and reads again", async () => {
    let attempts = 0;
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(previewError({ kind: "unexpected_error" })) : Promise.resolve(offered([row("restored-0", "a.raw")]));
      },
    } });
    mount(api);
    const failed = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-restore="read-failed"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(within(failed).getByRole("button", { name: en.restoreTryAgain }));
    await restoreAction();
    expect(document.querySelector('[data-restore="read-failed"]')).toBeNull();
  });

  it("says a refused record was left as found", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve({ outcome: "refused", problem: "newerVersion", leftoverCopies: 0 }),
    } });
    mount(api);
    const notice = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-restore="refused"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(notice).toHaveTextContent(en.restoreRefusedTitle);
    expect(notice).toHaveTextContent(en.restoreRefusedNewerVersion);
  });
});

describe("the restore settings", () => {
  async function openSettings(read: WorkspaceRestoreRead, extra: NonNullable<Parameters<typeof createFakePreviewApi>[0]>["workspaceRestore"] = {}) {
    const api = createFakePreviewApi({ workspaceRestore: { readWorkspaceRestore: () => Promise.resolve(read), ...extra } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    return screen.findByRole("dialog");
  }

  it("says the kept-aside copies remain where it offers turning restore off", async () => {
    const dialog = await openSettings({ outcome: "restored", groups: [{ name: null, rows: [] }], expired: 0, leftoverCopies: 2 });
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="leftovers"]')).toHaveTextContent(
      "2 kept-aside copies remain in the app's data folder. Turning restore off or starting fresh does not remove them.",
    ));
    expect(within(dialog).getByRole("radio", { name: en.restoreSwitchOn })).toHaveAttribute("aria-checked", "true");
  });

  it("turns restore off, and a refused document names its way back", async () => {
    let enabled: boolean | null = null;
    const dialog = await openSettings({ outcome: "refused", problem: "malformed", leftoverCopies: 0 }, {
      setWorkspaceRestoreEnabled: (next) => { enabled = next; return Promise.resolve({ outcome: "saved" }); },
    });
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="refused"]')).toHaveTextContent(en.restoreRefusedKeepsAside));
    fireEvent.click(within(dialog).getByRole("radio", { name: en.restoreSwitchOn }));
    await waitFor(() => expect(enabled).toBe(true));
  });

  it("refuses both choices while a document that may only be unreadable for now is kept", async () => {
    const dialog = await openSettings({ outcome: "refused", problem: "unreadable", leftoverCopies: 0 });
    const on = await within(dialog).findByRole("radio", { name: en.restoreSwitchOn });
    await waitFor(() => expect(on).toHaveAttribute("aria-disabled", "true"));
    expect(dialog.querySelector('[data-restore-settings="refused"]')).toHaveTextContent(en.restoreRefusedUnreadable);
    expect(within(dialog).getByRole("button", { name: en.restoreStartFresh })).toHaveAttribute("aria-disabled", "true");
  });

  it("says when there is nowhere to keep a record", async () => {
    const dialog = await openSettings({ outcome: "unavailable", problem: "rootUnresolved" });
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="unavailable"]')).toHaveTextContent(en.restoreUnavailable));
    expect(within(dialog).queryByRole("radio", { name: en.restoreSwitchOn })).toBeNull();
  });
});
