import { describe, expect, it } from "vitest";
import { initialRosterState, rosterProjection, rosterReducer, type RosterState } from "../mzml-preview/rosterSelection";
import { resolveConversionScope } from "../mzml-preview/conversionScope";
import type { SelectedFile, WorkspaceRoster } from "../mzml-preview/contracts";
import { captureOrganizationPayload } from "./organization";

const rows: SelectedFile[] = ["z", "a", "b", "open"].map((id, index) => ({ handle: id, fileName: `${id}.${id === "open" ? "mzML" : "raw"}`, sourceKind: id === "open" ? "mzml" : "thermo_raw", byteLength: 100 + index, relativeContext: null }));
const roster: WorkspaceRoster = { datasets: rows, capacity: 1024 };
const loaded = () => rosterReducer(initialRosterState, { type: "rosterLoaded", roster });
const check = (state: RosterState, handles: string[], checked = true) => rosterReducer(state, { type: "membershipChanged", handles, checked });

describe("independent roster purposes and execution order", () => {
  it("changes focus, highlighted rows, viewed acquisition and conversion membership independently", () => {
    let state = check(loaded(), ["z", "open"]);
    const scope = resolveConversionScope("selected", state);
    state = rosterReducer(state, { type: "rowPressed", handle: "a", modifiers: { ctrl: true, shift: false } });
    state = rosterReducer(state, { type: "activated", handle: "open" });
    expect([...state.selected]).toEqual(["a"]);
    expect(state.focused).toBe("open");
    expect(state.active).toBe("open");
    expect(resolveConversionScope("selected", state)).toEqual(scope);
    const checked = check(state, ["a"]);
    expect(checked.active).toBe("open");
    expect(checked.selected).toBe(state.selected);
    expect(resolveConversionScope("selected", checked)).toMatchObject({ handles: ["z", "a"], requestedCount: 3, excludedCount: 1 });
  });
  it("does not reset membership on authoritative reads, focus, search, or explicit activation", () => {
    let state = check(loaded(), ["a"]);
    state = rosterReducer(state, { type: "rosterLoaded", roster: { ...roster, datasets: [...rows] } });
    state = rosterReducer(state, { type: "focusStepped", delta: 1, extend: false });
    state = rosterReducer(state, { type: "searchChanged", query: "open" });
    expect([...state.conversionMembership]).toEqual(["a"]);
  });
  it("retains hidden highlighted handles and uses flattened group order for Shift ranges", () => {
    let state = loaded();
    state = rosterReducer(state, { type: "rowPressed", handle: "z", modifiers: { ctrl: true, shift: false } });
    state = rosterReducer(state, { type: "organization", action: { type: "create", name: "first" } });
    const payload = captureOrganizationPayload(state.organization, "a", new Set(["a"]))!;
    state = rosterReducer(state, { type: "organization", action: { type: "move", payload, target: { groupId: "group-1", anchor: null, edge: "after" } } });
    expect(rosterProjection(state).datasets.map(row => row.handle)).toEqual(["z", "b", "open", "a"]);
    state = rosterReducer(state, { type: "searchChanged", query: ".raw" });
    state = rosterReducer(state, { type: "rowPressed", handle: "b", modifiers: { ctrl: false, shift: false } });
    state = rosterReducer(state, { type: "rowPressed", handle: "a", modifiers: { ctrl: false, shift: true } });
    expect([...state.selected]).toEqual(["b", "a"]);
    state = rosterReducer(state, { type: "organization", action: { type: "disclose", groupId: "group-1" } });
    expect(state.selected.has("a")).toBe(true);
    expect(rosterProjection(state).handles.has("a")).toBe(false);
  });
  it("retains a live range anchor across a view with no visible rows", () => {
    let state = loaded();
    state = rosterReducer(state, { type: "rowPressed", handle: "b", modifiers: { ctrl: true, shift: false } });
    state = rosterReducer(state, { type: "searchChanged", query: "no matching acquisition" });
    expect(state.focused).toBeNull(); expect(state.anchor).toBe("b");
    state = rosterReducer(state, { type: "searchCleared" });
    expect(state.focused).toBe("z"); expect(state.anchor).toBe("b");
    state = rosterReducer(state, { type: "rowPressed", handle: "open", modifiers: { ctrl: false, shift: true } });
    expect([...state.selected]).toEqual(["b", "open"]);
  });
  it("preserves resolved queue membership/order through organization and undo; sort remains explicit", () => {
    let state = check(loaded(), ["z", "a", "b"]);
    const initial = resolveConversionScope("selected", state);
    state = rosterReducer(state, { type: "organization", action: { type: "create", name: "group" } });
    const payload = captureOrganizationPayload(state.organization, "z", new Set(["z", "b"]))!;
    state = rosterReducer(state, { type: "organization", action: { type: "move", payload, target: { groupId: "group-1", anchor: null, edge: "after" } } });
    state = rosterReducer(state, { type: "searchChanged", query: "open" });
    state = rosterReducer(state, { type: "organization", action: { type: "disclose", groupId: "group-1" } });
    expect(resolveConversionScope("selected", state)).toEqual(initial);
    state = rosterReducer(state, { type: "organization", action: { type: "undo" } });
    expect(resolveConversionScope("selected", state)).toEqual(initial);
    state = rosterReducer(state, { type: "sortChanged", sort: "name-asc" });
    expect(resolveConversionScope("selected", state).handles).toEqual(["a", "b", "z"]);
  });
  it("keeps the file-picker replacement default and asynchronous import union explicit", () => {
    const start = check(loaded(), ["a"]);
    const extra: SelectedFile = { ...rows[0]!, handle: "new", fileName: "new.raw" };
    const result = { roster: { ...roster, datasets: [...rows, extra] }, outcomes: [{ outcome: "added" as const, dataset: extra }] };
    const added = rosterReducer(start, { type: "filesAdded", result });
    expect([...added.conversionMembership]).toEqual(["new"]);
    const reread = rosterReducer(start, { type: "rosterLoaded", roster: result.roster });
    expect([...reread.conversionMembership]).toEqual(["a"]);
    expect(reread.organization.groups[0]?.handles).toContain("new");
  });
  it("removal prunes membership without adopting the removal-focus fallback as a conversion operand", () => {
    const start = check(loaded(), ["z"]);
    const next = rosterReducer(start, { type: "datasetsRemoved", result: { removedHandles: ["z"], unknownHandles: [], roster: { ...roster, datasets: rows.slice(1) } } });
    expect(next.selected.size).toBe(1);
    expect(next.conversionMembership.size).toBe(0);
    expect(resolveConversionScope("selected", next).handles).toEqual([]);
  });
});
