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
import { chooseRosterAction } from "../../test/rosterActions";
import { UI_RESOURCES, type UiMessage } from "../preferences/i18n";
import { initialOrganization, organize, placeRestored, UNGROUPED } from "../workbench/organization";
import { PreviewApiProvider } from "./api";
import type { RestoredRow, RestoredRowState, WorkspaceRestorePutBack, WorkspaceRestoreRead, WorkspaceRestoreWrite, WorkspaceRoster } from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { PreviewWorkspace } from "./PreviewWorkspace";
import { describeRestoreResult, initialRosterState, rosterReducer } from "./rosterSelection";
import { buildArrangement, type WorkspaceRestoreSession } from "./useWorkspaceRestore";
import { announceRestore } from "./WorkspaceRestoreNotice";

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
const stoppedNotice = () => document.querySelector<HTMLElement>('[data-restore="stopped"]');
const actionNotice = () => document.querySelector<HTMLElement>('[data-restore="action"]');
const checkbox = () => waitFor(() => {
  const found = document.querySelector<HTMLElement>(`[data-handle="${selectedFile.handle}"] input[type="checkbox"]`);
  expect(found).not.toBeNull();
  return found as HTMLElement;
});
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

  it("keeps no stored group with nothing waiting in it, so a dissolved group does not come back", () => {
    expect(buildArrangement(initialOrganization, new Set(), [
      { name: null, rows: [] },
      { name: "Batch", rows: [] },
    ])).toEqual({ groups: [{ name: null, handles: [] }], checked: [] });
  });

  it("keeps two stored groups of one name apart, with and without such groups here", () => {
    const stored = [
      { name: null, rows: [] },
      { name: "Batch", rows: [row("restored-0", "a.raw")] },
      { name: "Batch", rows: [row("restored-1", "b.raw")] },
    ];
    expect(buildArrangement(initialOrganization, new Set(), stored).groups).toEqual([
      { name: null, handles: [] },
      { name: "Batch", handles: ["restored-0"] },
      { name: "Batch", handles: ["restored-1"] },
    ]);
    const one = organize(initialOrganization, { type: "create", name: "Batch" });
    const two = organize(one, { type: "create", name: "Batch" });
    expect(buildArrangement(two, new Set(), [{ name: "Batch", rows: [] }, { name: "Batch", rows: [row("restored-1", "b.raw")] }]).groups).toEqual([
      { name: null, handles: [] },
      { name: "Batch", handles: [] },
      { name: "Batch", handles: ["restored-1"] },
    ]);
  });

  describe("keeps the stored order of groups through a partial put-back", () => {
    const names = (groups: readonly { readonly name: string | null }[]) => groups.map(group => group.name);
    /** The read after a put-back: a stored group holds a marked row, or nothing more. */
    const stored = (...groups: readonly (readonly [string, boolean])[]) => [
      { name: null, rows: [] },
      ...groups.map(([name, marked], at) => ({ name, rows: marked ? [row(`restored-${String(at)}`, "a.raw", "missing")] : [] })),
    ];

    it("an earlier group holding only a marked row stays before the group put back", () => {
      const here = placeRestored(initialOrganization, [null, "A", "B"], [{ handle: "file-0", group: 2 }]);
      expect(buildArrangement(here, new Set(), stored(["A", true], ["B", false])).groups).toEqual([
        { name: null, handles: [] },
        { name: "A", handles: ["restored-0"] },
        { name: "B", handles: ["file-0"] },
      ]);
    });

    it("a later group holding only a marked row stays after the group put back", () => {
      const here = placeRestored(initialOrganization, [null, "B", "A"], [{ handle: "file-0", group: 1 }]);
      expect(names(buildArrangement(here, new Set(), stored(["B", false], ["A", true])).groups)).toEqual([null, "B", "A"]);
    });

    it("several groups holding only marked rows stay in their places around the one put back", () => {
      const here = placeRestored(initialOrganization, [null, "A", "B", "C", "D"], [{ handle: "file-0", group: 3 }]);
      expect(names(buildArrangement(here, new Set(), stored(["A", true], ["B", true], ["C", false], ["D", true])).groups)).toEqual([null, "A", "B", "C", "D"]);
    });

    it("a group the user made this session stays after the stored ones", () => {
      const put = placeRestored(initialOrganization, [null, "A", "B"], [{ handle: "file-0", group: 2 }]);
      const here = organize(put, { type: "create", name: "Mine" });
      expect(names(buildArrangement(here, new Set(), stored(["A", true], ["B", false])).groups)).toEqual([null, "A", "B", "Mine"]);
    });

    it("a later group of one name goes after the earlier, wherever the user has moved that", () => {
      const here = organize(organize(initialOrganization, { type: "create", name: "Other" }), { type: "create", name: "Batch" });
      const saved = buildArrangement(here, new Set(), stored(["Batch", false], ["Other", false], ["Batch", true]));
      expect(saved.groups).toEqual([
        { name: null, handles: [] },
        { name: "Other", handles: [] },
        { name: "Batch", handles: [] },
        { name: "Batch", handles: ["restored-2"] },
      ]);
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
      { handle: "file-1", group: 1, checked: true, added: true },
      { handle: "file-2", group: 2, checked: false, added: true },
    ];
    const answer = result(placed);
    const after = rosterReducer(before, {
      type: "workspaceRestored",
      groups: ["Empty", "Batch", null],
      result: { ...answer, workspace: { ...answer.workspace, roster: { datasets: [live, ...answer.workspace.roster.datasets], capacity: 1024 } } },
    });
    expect(after.organization.groups.map(group => [group.name, group.handles])).toEqual([
      ["", ["file-0", "file-2"]],
      ["Batch", ["file-1"]],
    ]);
    expect([...after.conversionMembership].sort()).toEqual(["file-0", "file-1"]);
    expect(after.organization.history).toHaveLength(0);
  });

  it("makes no group a row does not land in, so a name with only marked rows stays away", () => {
    expect(placeRestored(initialOrganization, ["Batch"], []).groups.map(group => group.name)).toEqual([""]);
  });

  it("uses a group of that name that is already here", () => {
    const here = organize(initialOrganization, { type: "create", name: "Batch" });
    const state = placeRestored(here, ["Batch"], [{ handle: "file-1", group: 0 }]);
    expect(state.groups.map(group => [group.name, group.handles])).toEqual([["", []], ["Batch", ["file-1"]]]);
  });

  it("keeps two stored groups of one name apart", () => {
    const state = placeRestored(initialOrganization, ["Batch", "Batch"], [{ handle: "file-1", group: 0 }, { handle: "file-2", group: 1 }]);
    expect(state.groups.map(group => [group.name, group.handles])).toEqual([["", []], ["Batch", ["file-1"]], ["Batch", ["file-2"]]]);
  });

  it("makes both groups of one name when a row lands only in the later one", () => {
    const state = placeRestored(initialOrganization, ["Batch", "Batch"], [{ handle: "file-1", group: 1 }]);
    expect(state.groups.map(group => [group.name, group.handles])).toEqual([["", []], ["Batch", []], ["Batch", ["file-1"]]]);
  });

  it("makes a group in its stored place, so a second put-back of the session keeps the stored order", () => {
    const first = placeRestored(initialOrganization, [null, "A", "B"], [{ handle: "file-0", group: 2 }]);
    expect(first.groups.map(group => group.name)).toEqual(["", "B"]);
    const second = placeRestored(first, [null, "A", "B"], [{ handle: "file-1", group: 1 }]);
    expect(second.groups.map(group => [group.name, group.handles])).toEqual([["", []], ["A", ["file-1"]], ["B", ["file-0"]]]);
  });

  it("puts a later group of one name after the earlier, wherever the user has moved that", () => {
    const here = organize(organize(initialOrganization, { type: "create", name: "Other" }), { type: "create", name: "Batch" });
    const state = placeRestored(here, ["Batch", "Other", "Batch"], [{ handle: "file-1", group: 2 }]);
    expect(state.groups.map(group => [group.name, group.handles])).toEqual([["", []], ["Other", []], ["Batch", []], ["Batch", ["file-1"]]]);
  });

  it("leaves a row that was already live as it was: its group and its unchecked box", () => {
    const live = { ...selectedFile, handle: "file-0" };
    const before = rosterReducer(initialRosterState, { type: "rosterLoaded", roster: { datasets: [live], capacity: 1024 } });
    const answer = result([{ handle: "file-0", group: 0, checked: true, added: false }]);
    const after = rosterReducer(before, { type: "workspaceRestored", groups: ["Batch"], result: { ...answer, workspace: { ...answer.workspace, roster: { datasets: [live], capacity: 1024 } } } });
    expect(after.organization.groups.map(group => [group.name, group.handles])).toEqual([["", ["file-0"]]]);
    expect(after.conversionMembership.size).toBe(0);
  });

  it("says a file replaced after the re-check was added, beside the rows that came back", () => {
    const answer = result([{ handle: "file-1", group: 0, checked: false, added: true }]);
    const replaced = { ...selectedFile, handle: "file-2" };
    const notice = describeRestoreResult({ ...answer, workspace: { ...answer.workspace, outcomes: [...answer.workspace.outcomes, { outcome: "added", dataset: replaced }] } });
    expect(notice.message).toEqual([["noticeRestored", { count: 1 }], ["noticeAdded", { count: 1 }]]);
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
          placed: [{ handle: "file-1", group: 0, checked: false, added: true }],
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
    const row1 = await checkbox();
    // Reads then changes: this is the first change after the baseline.
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(row1);
    await waitFor(() => expect(stoppedNotice()).toHaveTextContent(en.restoreProblemChangedElsewhere));
    expect(within(stoppedNotice()!).queryByRole("button", { name: en.restoreTryAgain })).toBeNull();
    fireEvent.click(row1);
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps saying the session is not recorded after a dismiss and a later change", async () => {
    let rows: readonly RestoredRow[] = [row("restored-0", "a.raw", "missing"), row("restored-1", "b.raw", "missing")];
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "refused", problem: "changedElsewhere" }));
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(offered(rows)),
        saveWorkspaceRestore: save,
        dismissRestoredRow: (handle) => { rows = rows.filter(entry => entry.handle !== handle); return Promise.resolve(); },
      },
    });
    mount(api);
    const row1 = await checkbox();
    await waitFor(() => expect(offerNotice()).not.toBeNull());
    fireEvent.click(row1);
    await waitFor(() => expect(stoppedNotice()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss a.raw" }));
    await waitFor(() => expect(document.querySelectorAll("[data-restored-row]")).toHaveLength(1));
    expect(stoppedNotice()).toHaveTextContent(en.restoreProblemChangedElsewhere);
    fireEvent.click(row1);
    await act(async () => { await Promise.resolve(); });
    expect(stoppedNotice()).toHaveTextContent(en.restoreProblemChangedElsewhere);
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-live-region="restore"]')).toHaveTextContent(en.restoreProblemChangedElsewhere);
  });

  it.each<[string, () => HTMLElement | null, WorkspaceRestoreWrite]>([
    ["a later window's", stoppedNotice, { outcome: "refused", problem: "changedElsewhere" }],
    ["a failed save's", problemNotice, { outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false }],
  ])("ends %s refusal when Start fresh turns restore off, since its record is gone", async (_who, notice, answer) => {
    let off = false;
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(off ? { outcome: "off", leftoverCopies: 0 } : offered([row("restored-0", "a.raw", "missing")])),
        saveWorkspaceRestore: () => Promise.resolve(answer),
        clearWorkspaceRestore: () => { off = true; return Promise.resolve({ outcome: "turnedOff", problem: "changedElsewhere" }); },
      },
    });
    mount(api);
    const row1 = await checkbox();
    await waitFor(() => expect(offerNotice()).not.toBeNull());
    fireEvent.click(row1);
    await waitFor(() => expect(notice()).not.toBeNull());
    fireEvent.click(within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh }));
    await waitFor(() => expect(actionNotice()).not.toBeNull());
    expect(notice()).toBeNull();
  });

  it("ends a failed dismiss's refusal when Start fresh empties the record", async () => {
    let cleared = false;
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(cleared ? [] : [row("restored-0", "a.raw", "missing")])),
      dismissRestoredRow: () => Promise.reject(previewError({ kind: "unexpected_error" })),
      clearWorkspaceRestore: () => { cleared = true; return Promise.resolve({ outcome: "saved" }); },
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss a.raw" }));
    await waitFor(() => expect(actionNotice()).not.toBeNull());
    fireEvent.click(within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh }));
    await waitFor(() => expect(offerNotice()).toBeNull());
    expect(actionNotice()).toBeNull();
  });

  it("refuses every other dismiss while one runs, and asks once however quickly it is pressed", async () => {
    const dismissing = deferred<undefined>();
    const dismiss = vi.fn(() => dismissing.promise);
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw", "missing"), row("restored-1", "b.raw", "missing")])),
      dismissRestoredRow: dismiss,
    } });
    mount(api);
    const first = await screen.findByRole("button", { name: "Dismiss a.raw" });
    const second = screen.getByRole("button", { name: "Dismiss b.raw" });
    // Both before React can refuse anything: only the one-action guard stands here.
    act(() => { first.click(); first.click(); });
    expect(dismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(second).toHaveAttribute("aria-disabled", "true"));
    expect(second).toHaveAccessibleDescription(expect.stringContaining(en.restoreBusy));
    fireEvent.click(second);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await act(async () => { dismissing.resolve(undefined); await dismissing.promise; });
    await waitFor(() => expect(second).not.toHaveAttribute("aria-disabled"));
  });

  it.each([
    ["changedElsewhere", en.restoreTurnedOffChangedElsewhere],
    ["identityUnknown", en.restoreTurnedOffIdentityUnknown],
  ])("says a clear that found %s emptied the record and turned restore off, and offers no retry", async (reason, sentence) => {
    let off = false;
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(off ? { outcome: "off", leftoverCopies: 0 } : offered([row("restored-0", "a.raw", "missing")])),
      clearWorkspaceRestore: () => { off = true; return Promise.resolve({ outcome: "turnedOff", problem: reason }); },
    } });
    mount(api);
    await waitFor(() => expect(offerNotice()).not.toBeNull());
    fireEvent.click(within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh }));
    await waitFor(() => expect(actionNotice()).not.toBeNull());
    expect(actionNotice()).toHaveTextContent(`${en.restoreTurnedOff}${sentence}`);
    expect(within(actionNotice()!).queryByRole("button", { name: en.restoreTryAgain })).toBeNull();
    fireEvent.click(within(actionNotice()!).getByRole("button", { name: en.dismiss }));
    expect(actionNotice()).toBeNull();
  });

  it("keeps a failed Off and its Try again through a later save that went through", async () => {
    const answers: WorkspaceRestoreWrite[] = [{ outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false }, { outcome: "saved" }];
    const set = vi.fn((_enabled: boolean) => Promise.resolve(answers.shift() as WorkspaceRestoreWrite));
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "saved" }));
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: { saveWorkspaceRestore: save, setWorkspaceRestoreEnabled: set },
    });
    mount(api);
    const row1 = await checkbox();
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("radio", { name: en.restoreSwitchOff }));
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="action"]')).toHaveTextContent(en.restoreProblemNotPublished));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(row1);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(actionNotice()).toHaveTextContent(en.restoreProblemNotPublished);
    fireEvent.click(within(actionNotice()!).getByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(set).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(actionNotice()).toBeNull());
  });

  it("asks a failed dismiss again, for that row, on Try again", async () => {
    const dismissed: string[] = [];
    const answers = [() => Promise.reject(new Error("no answer")), () => Promise.resolve()];
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "saved" }));
    let rows: readonly RestoredRow[] = [row("restored-0", "a.raw", "missing"), row("restored-1", "b.raw", "missing")];
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(rows)),
      saveWorkspaceRestore: save,
      dismissRestoredRow: (handle) => {
        dismissed.push(handle);
        return (answers.shift() as () => Promise<void>)().then(() => { rows = rows.filter(entry => entry.handle !== handle); });
      },
    } });
    mount(api);
    await waitFor(() => expect(offerNotice()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss b.raw" }));
    await waitFor(() => expect(actionNotice()).toHaveTextContent(en.restoreNotChanged));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(actionNotice()!).getByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(dismissed).toEqual(["restored-1", "restored-1"]));
    await waitFor(() => expect(actionNotice()).toBeNull());
    expect(document.querySelectorAll("[data-restored-row]")).toHaveLength(1);
  });

  it("points a refusal at a line that exists while a dismiss runs", async () => {
    const dismissing = deferred<undefined>();
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw", "missing"), row("restored-1", "b.raw", "missing")])),
      dismissRestoredRow: () => dismissing.promise,
    } });
    mount(api);
    await waitFor(() => expect(offerNotice()).not.toBeNull());
    const fresh = within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss a.raw" }));
    await waitFor(() => expect(fresh).toHaveAttribute("aria-disabled", "true"));
    expect(fresh).toHaveAccessibleDescription(en.restoreBusy);
    await act(async () => { dismissing.resolve(undefined); await dismissing.promise; });
    await waitFor(() => expect(fresh).not.toHaveAttribute("aria-disabled"));
  });

  it("says when there is nowhere to keep a record, above the surfaces and to a screen reader", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve({ outcome: "unavailable", problem: "rootUnresolved" }),
    } });
    mount(api);
    const notice = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-restore="unavailable"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(notice).toHaveTextContent(en.restoreUnavailable);
    expect(document.querySelector('[data-live-region="restore"]')).toHaveTextContent(en.restoreUnavailable);
    fireEvent.click(within(notice).getByRole("button", { name: en.dismiss }));
    expect(document.querySelector('[data-restore="unavailable"]')).toBeNull();
  });

  it("counts the marked rows beside the offered ones, on screen and to a screen reader", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw"), row("restored-1", "b.raw", "missing"), row("restored-2", "c.raw", "changed")])),
    } });
    mount(api);
    await restoreAction();
    expect(offerNotice()).toHaveTextContent("1 file from the last session can be added again.");
    expect(offerNotice()).toHaveTextContent("2 files from the last session need attention.");
    expect(document.querySelector('[data-live-region="restore"]')).toHaveTextContent("1 file from the last session can be added again. 2 files from the last session need attention.");
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
    const row1 = await checkbox();
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
    const row1 = await checkbox();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(row1);
    await waitFor(() => expect(problemNotice()).toHaveTextContent(en.restoreProblemStaleArrangement));
    const before = api.calls().filter(call => call === "getRoster").length;
    fireEvent.click(within(problemNotice()!).getByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(api.calls().filter(call => call === "getRoster").length).toBe(before + 1));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(problemNotice()).toBeNull());
  });

  it("shows a failed Start fresh and a later failed save apart, each with its own Try again", async () => {
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
    await waitFor(() => expect(actionNotice()).toHaveTextContent(en.restoreNotChanged));
    expect(actionNotice()).toHaveTextContent(en.restoreProblemTemporaryLeft);
    const row1 = document.querySelector<HTMLElement>(`[data-handle="${selectedFile.handle}"] input[type="checkbox"]`)!;
    fireEvent.click(row1);
    await waitFor(() => expect(problemNotice()).toHaveTextContent(en.restoreNotRecorded));
    expect(actionNotice()).toHaveTextContent(en.restoreNotChanged);
    fireEvent.click(within(problemNotice()!).getByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(clear).toHaveBeenCalledTimes(1);
    fireEvent.click(within(actionNotice()!).getByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(actionNotice()).toBeNull());
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

  it("gives each dismiss its row's state and reason, for a reader moving by arrow keys", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve({ outcome: "restored", groups: [{ name: "Batch", rows: [row("restored-0", "a.raw", "missing")] }], expired: 0, leftoverCopies: 0 }),
    } });
    mount(api);
    const dismiss = await screen.findByRole("button", { name: "Dismiss a.raw" });
    expect(dismiss).toHaveAccessibleDescription(expect.stringContaining(en.restoreStateMissing));
    expect(dismiss).toHaveAccessibleDescription(expect.stringContaining("Batch"));
  });
});

describe("where the keyboard goes when a restore button leaves", () => {
  const dataset = { ...selectedFile, handle: "file-1" };
  const putBackOne = () => Promise.resolve({ workspace: { roster: { datasets: [dataset], capacity: 1024 }, outcomes: [{ outcome: "added" as const, dataset }] }, placed: [{ handle: "file-1", group: 0, checked: false, added: true }] });

  it("never lands on a dismiss after Restore workspace, so the next Enter forgets nothing", async () => {
    let rows: readonly RestoredRow[] = [row("restored-0", "a.raw"), row("restored-1", "gone.raw", "missing")];
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(rows)),
      restoreWorkspace: () => { rows = rows.slice(1); return putBackOne(); },
    } });
    mount(api);
    const action = await restoreAction();
    action.focus();
    fireEvent.click(action);
    await waitFor(() => expect(screen.queryByRole("button", { name: en.restoreAction })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(offerNotice()));
  });

  it("lands on Restore workspace after a read's Try again, not on the first dismiss", async () => {
    let attempts = 0;
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(previewError({ kind: "unexpected_error" })) : Promise.resolve(offered([row("restored-0", "a.raw"), row("restored-1", "gone.raw", "missing")]));
      },
    } });
    mount(api);
    const again = await screen.findByRole("button", { name: en.restoreTryAgain });
    again.focus();
    fireEvent.click(again);
    const action = await restoreAction();
    await waitFor(() => expect(document.activeElement).toBe(action));
  });

  it("returns to the row a failed dismiss was for when Try again takes it", async () => {
    const answers = [() => Promise.reject(new Error("no answer")), () => Promise.resolve()];
    let rows: readonly RestoredRow[] = ["a", "b", "c", "d"].map((name, index) => row(`restored-${String(index)}`, `${name}.raw`, "missing"));
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(rows)),
      dismissRestoredRow: (handle) => (answers.shift() as () => Promise<void>)().then(() => { rows = rows.filter(entry => entry.handle !== handle); }),
    } });
    mount(api);
    const dismiss = await screen.findByRole("button", { name: "Dismiss c.raw" });
    dismiss.focus();
    fireEvent.click(dismiss);
    await waitFor(() => expect(actionNotice()).not.toBeNull());
    const again = within(actionNotice()!).getByRole("button", { name: en.restoreTryAgain });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(actionNotice()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dismiss d.raw" })));
  });

  it("leaves the keyboard where it moved while a press was held", async () => {
    const dismissing = deferred<undefined>();
    let rows: readonly RestoredRow[] = [row("restored-0", "a.raw", "missing"), row("restored-1", "b.raw", "missing")];
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(rows)),
      dismissRestoredRow: () => dismissing.promise,
    } });
    mount(api);
    const dismiss = await screen.findByRole("button", { name: "Dismiss a.raw" });
    dismiss.focus();
    fireEvent.click(dismiss);
    const fresh = within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh });
    await waitFor(() => expect(fresh).toHaveAttribute("aria-disabled", "true"));
    fresh.focus();
    rows = rows.slice(1);
    await act(async () => { dismissing.resolve(undefined); await dismissing.promise; });
    await waitFor(() => expect(fresh).not.toHaveAttribute("aria-disabled"));
    expect(document.activeElement).toBe(fresh);
  });

  it("moves no focus when the failure arrives, and brings the row back into view", async () => {
    const scrolled = vi.fn();
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    try {
      const api = createFakePreviewApi({ workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw", "missing"), row("restored-1", "b.raw", "missing")])),
        dismissRestoredRow: () => Promise.reject(new Error("no answer")),
      } });
      mount(api);
      const dismiss = await screen.findByRole("button", { name: "Dismiss b.raw" });
      dismiss.focus();
      scrolled.mockClear();
      fireEvent.click(dismiss);
      await waitFor(() => expect(actionNotice()).not.toBeNull());
      await waitFor(() => expect(scrolled).toHaveBeenCalled());
      expect(document.activeElement).toBe(dismiss);
      expect(scrolled.mock.contexts).toContain(dismiss);
    } finally {
      Element.prototype.scrollIntoView = scrollIntoView;
    }
  });

  it("lands on the switch in Settings when a read's Try again leaves", async () => {
    let attempts = 0;
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(previewError({ kind: "unexpected_error" })) : Promise.resolve(offered([]));
      },
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    const failed = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-restore-settings="read-failed"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const again = within(failed).getByRole("button", { name: en.restoreTryAgain });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="read-failed"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("radio", { name: en.restoreSwitchOn })));
  });

  it("leaves the keyboard in Settings where it moved while a read's Try again was held", async () => {
    let attempts = 0;
    const reading = deferred<WorkspaceRestoreRead>();
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(previewError({ kind: "unexpected_error" })) : reading.promise;
      },
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    const again = await within(dialog).findByRole("button", { name: en.restoreTryAgain });
    again.focus();
    fireEvent.click(again);
    const fresh = within(dialog).getByRole("button", { name: en.restoreStartFresh });
    fresh.focus();
    await act(async () => { reading.resolve(offered([])); await reading.promise; });
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="read-failed"]')).toBeNull());
    expect(document.activeElement).toBe(fresh);
  });

  it("lands on the note in Settings when the whole section becomes unavailable", async () => {
    let attempts = 0;
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(previewError({ kind: "unexpected_error" })) : Promise.resolve({ outcome: "unavailable", problem: "rootUnresolved" });
      },
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    const failed = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-restore-settings="read-failed"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const again = within(failed).getByRole("button", { name: en.restoreTryAgain });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(document.activeElement).toBe(dialog.querySelector('[data-restore-settings="unavailable"]')));
  });
});

describe("what the restore live region says", () => {
  const region = () => document.querySelector('[data-live-region="restore"]');

  it("says nothing on a first run, and that nothing is waiting once the user has emptied the list", async () => {
    let rows: readonly RestoredRow[] = [row("restored-0", "a.raw", "missing")];
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(rows)),
      dismissRestoredRow: () => { rows = []; return Promise.resolve(); },
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss a.raw" }));
    await waitFor(() => expect(region()).toHaveTextContent(en.restoreNothingWaiting));
    expect(document.querySelector("[data-restored-row]")).toBeNull();
  });

  it("says nothing about an empty first run", async () => {
    let answered = false;
    const api = createFakePreviewApi({ workspaceRestore: { readWorkspaceRestore: () => { answered = true; return Promise.resolve(offered([])); } } });
    mount(api);
    await waitFor(() => expect(answered).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(region()?.textContent).toBe("");
  });

  it("says Start fresh emptied the list", async () => {
    let cleared = false;
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered(cleared ? [] : [row("restored-0", "a.raw")])),
      clearWorkspaceRestore: () => { cleared = true; return Promise.resolve({ outcome: "saved" }); },
    } });
    mount(api);
    await restoreAction();
    fireEvent.click(within(offerNotice()!).getByRole("button", { name: en.restoreStartFresh }));
    await waitFor(() => expect(region()).toHaveTextContent(en.restoreNothingWaiting));
  });

  it("says a slow first read is being checked", async () => {
    const reading = deferred<WorkspaceRestoreRead>();
    const api = createFakePreviewApi({ workspaceRestore: { readWorkspaceRestore: () => reading.promise } });
    mount(api);
    await waitFor(() => expect(region()).toHaveTextContent(en.restoreLoading), { timeout: 2000 });
    await act(async () => { reading.resolve(offered([])); await reading.promise; });
    await waitFor(() => expect(region()?.textContent).toBe(""));
  });

  it("says a slow dismiss is working, on the same words the line shows", async () => {
    const dismissing = deferred<undefined>();
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw", "missing")])),
      dismissRestoredRow: () => dismissing.promise,
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss a.raw" }));
    await waitFor(() => expect(region()).toHaveTextContent(en.restoreBusy), { timeout: 2000 });
    await act(async () => { dismissing.resolve(undefined); await dismissing.promise; });
  });

  it("says rows are being added, over a refusal that still stands", async () => {
    const restoring = deferred<WorkspaceRestorePutBack>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw")])),
        saveWorkspaceRestore: () => Promise.resolve({ outcome: "refused", problem: "changedElsewhere" }),
        restoreWorkspace: () => restoring.promise,
      },
    });
    mount(api);
    const row1 = await checkbox();
    const action = await restoreAction();
    fireEvent.click(row1);
    await waitFor(() => expect(stoppedNotice()).not.toBeNull());
    fireEvent.click(action);
    await waitFor(() => expect(region()).toHaveTextContent("Adding 1 file again"));
    await act(async () => { restoring.resolve({ workspace: { roster: { datasets: [selectedFile], capacity: 1024 }, outcomes: [] }, placed: [] }); await restoring.promise; });
    await waitFor(() => expect(region()).toHaveTextContent(en.restoreProblemChangedElsewhere));
  });

  it("changes before a read asked again fails the same way, so the failure is heard again", async () => {
    const failure = previewError({ kind: "unexpected_error" });
    const again = deferred<WorkspaceRestoreRead>();
    let attempts = 0;
    const api = createFakePreviewApi({ workspaceRestore: { readWorkspaceRestore: () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(failure) : again.promise;
    } } });
    mount(api);
    await waitFor(() => expect(region()).toHaveTextContent(en.restoreReadFailed));
    const said = region()?.textContent;
    fireEvent.click(await screen.findByRole("button", { name: en.restoreTryAgain }));
    await waitFor(() => expect(region()).toHaveTextContent(en.restoreLoading));
    await act(async () => { again.reject(failure); await again.promise.catch(() => undefined); });
    await waitFor(() => expect(region()?.textContent).toBe(said));
  });

  it("says why the workspace refused a put-back", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.resolve(offered([row("restored-0", "a.raw")])),
      restoreWorkspace: () => Promise.reject(previewError({ kind: "conversion_busy" })),
    } });
    mount(api);
    fireEvent.click(await restoreAction());
    await waitFor(() => expect(region()).toHaveTextContent(en.workspaceFailed));
    expect(offerNotice()).toHaveTextContent(en.restoreAction);
  });

  it("leaves a workspace failure after a finished put-back to the workspace's own notice", async () => {
    let rows: readonly RestoredRow[] = [row("restored-0", "a.raw")];
    const api = createFakePreviewApi({
      clearWorkspace: () => Promise.reject(previewError({ kind: "unexpected_error" })),
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(offered(rows)),
        restoreWorkspace: () => {
          rows = [];
          return Promise.resolve({ workspace: { roster: { datasets: [selectedFile], capacity: 1024 }, outcomes: [{ outcome: "added", dataset: selectedFile }] }, placed: [{ handle: selectedFile.handle, group: 0, checked: false, added: true }] });
        },
      },
    });
    mount(api);
    fireEvent.click(await restoreAction());
    await waitFor(() => expect(screen.queryByRole("button", { name: en.restoreAction })).toBeNull());
    await chooseRosterAction("clearList");
    await waitFor(() => expect(document.querySelector(".shell-notices > .notice-danger")).toHaveTextContent(en.workspaceFailed));
    expect(region()).not.toHaveTextContent(en.workspaceFailed);
  });

  it("leaves a workspace failure a put-back did not cause to the workspace's own notice", () => {
    const t = ((key: string) => key) as unknown as UiMessage;
    const session = { reading: { status: "ready", read: offered([row("restored-0", "a.raw")]) }, work: null, slowRead: false, slowWork: false, acted: false, putBackAsked: false, problem: null, stopped: null, failed: [], expiredDismissed: false } as unknown as WorkspaceRestoreSession;
    const failure = previewError({ kind: "unexpected_error" });
    expect(announceRestore(session, t, failure)).toBe("restoreOffer");
    expect(announceRestore({ ...session, putBackAsked: true }, t, failure)).toContain("workspaceFailed");
  });

  it("says a failure from Settings once, in the page's region, with no alert of its own", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      setWorkspaceRestoreEnabled: () => Promise.resolve({ outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false }),
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    const off = await within(dialog).findByRole("radio", { name: en.restoreSwitchOff });
    await waitFor(() => expect(off).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(off);
    const note = await waitFor(() => {
      const found = dialog.querySelector('[data-restore-settings="action"]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(note).not.toHaveAttribute("role");
    expect(region()).toHaveTextContent(en.restoreProblemNotPublished);
    expect(document.querySelector('[data-live-region="settings-restore"]')).toBeNull();
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

  it("says Start fresh replaces a refused record and keeps no copy", async () => {
    const dialog = await openSettings({ outcome: "refused", problem: "newerVersion", leftoverCopies: 0 });
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="refused"]')).toHaveTextContent(en.restoreRefusedStartFreshReplaces));
  });

  it("shows neither choice as made while the switch is not known, and says why the read failed", async () => {
    const api = createFakePreviewApi({ workspaceRestore: {
      readWorkspaceRestore: () => Promise.reject(previewError({ kind: "unexpected_error" })),
    } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    const failed = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-restore-settings="read-failed"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(failed).toHaveTextContent(en.restoreReadFailed);
    expect(failed.textContent).not.toBe(`${en.restoreReadFailed}${en.restoreTryAgain}`);
    expect(within(dialog).getByRole("radio", { name: en.restoreSwitchOn })).toHaveAttribute("aria-checked", "false");
    expect(within(dialog).getByRole("radio", { name: en.restoreSwitchOff })).toHaveAttribute("aria-checked", "false");
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

  it("records the live rows again after Off and On, because the switch emptied the record", async () => {
    let enabled = true;
    const save = vi.fn<() => Promise<WorkspaceRestoreWrite>>(() => Promise.resolve({ outcome: "saved" }));
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      workspaceRestore: {
        readWorkspaceRestore: () => Promise.resolve(enabled ? offered([]) : { outcome: "off", leftoverCopies: 0 }),
        saveWorkspaceRestore: save,
        setWorkspaceRestoreEnabled: (next) => { enabled = next; return Promise.resolve({ outcome: "saved" }); },
      },
    });
    mount(api);
    await checkbox();
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    const off = await within(dialog).findByRole("radio", { name: en.restoreSwitchOff });
    await waitFor(() => expect(off).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(off);
    await waitFor(() => expect(off).toHaveAttribute("aria-checked", "true"));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(off).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(within(dialog).getByRole("radio", { name: en.restoreSwitchOn }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("says restore is off where Start fresh would be", async () => {
    const dialog = await openSettings({ outcome: "off", leftoverCopies: 0 });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: en.restoreStartFresh })).toHaveAccessibleDescription(en.restoreRememberedOff));
  });

  it("says a turn on refused over another window's write, and how to get past it", async () => {
    const dialog = await openSettings({ outcome: "off", leftoverCopies: 0 }, {
      setWorkspaceRestoreEnabled: () => Promise.resolve({ outcome: "refused", problem: "changedElsewhere" }),
    });
    const on = await within(dialog).findByRole("radio", { name: en.restoreSwitchOn });
    await waitFor(() => expect(on).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(on);
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="action"]')).toHaveTextContent(en.restoreTurnOnChangedElsewhere));
  });

  it("says it waits for the workspace list, and refuses both choices until then", async () => {
    const roster = deferred<WorkspaceRoster>();
    const api = { ...createFakePreviewApi(), getRoster: () => roster.promise };
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: en.settingsEntry }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector('[data-restore-settings="loading"]')).toHaveTextContent(en.restoreWaitingForList));
    expect(within(dialog).getByRole("radio", { name: en.restoreSwitchOff })).toHaveAttribute("aria-disabled", "true");
  });
});
