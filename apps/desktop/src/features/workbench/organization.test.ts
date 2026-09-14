import { describe, expect, it } from "vitest";
import { arrangedHandles, captureOrganizationPayload, initialOrganization, organize, reconcileOrganization, UNGROUPED, UNDO_LIMIT, type OrganizationState } from "./organization";

const seed = () => organize(reconcileOrganization(initialOrganization, ["a", "b", "c", "d"]), { type: "create", name: "Research 样本" });
const move = (state: OrganizationState, source: string, selected: string[], groupId = "group-1", anchor: string | null = null) => {
  const payload = captureOrganizationPayload(state, source, new Set(selected));
  if (payload === null) throw Error("Missing test source");
  return organize(state, { type: "move", payload, target: { groupId, anchor, edge: "before" } });
};

describe("session organization transactions", () => {
  it("moves the complete highlighted payload in data order, independent of mounted or visible nodes", () => {
    const start = seed();
    const payload = captureOrganizationPayload(start, "c", new Set(["c", "a"]));
    expect(payload?.handles).toEqual(["a", "c"]);
    const next = move(start, "c", ["c", "a"]);
    expect(next.groups[0]?.handles).toEqual(["b", "d"]);
    expect(next.groups[1]?.handles).toEqual(["a", "c"]);
    expect(arrangedHandles(next)).toHaveLength(4);
    expect(start.groups[0]?.handles).toEqual(["a", "b", "c", "d"]);
  });
  it("a non-highlighted source moves itself and never an unrelated selection", () => {
    expect(move(seed(), "b", ["a", "c"]).groups[1]?.handles).toEqual(["b"]);
  });
  it("inserts at a full-order anchor while retaining hidden siblings", () => {
    const next = move(seed(), "d", ["d"], UNGROUPED, "b");
    expect(next.groups[0]?.handles).toEqual(["a", "d", "b", "c"]);
    expect(organize(next, { type: "undo" }).groups[0]?.handles).toEqual(["a", "b", "c", "d"]);
  });
  it("appends deterministically to empty and collapsed groups", () => {
    const collapsed = organize(seed(), { type: "disclose", groupId: "group-1" });
    const next = move(collapsed, "d", ["b", "d"]);
    expect(next.groups[1]).toMatchObject({ collapsed: true, handles: ["b", "d"] });
  });
  it.each(["add", "remove", "rename", "collapse"] as const)("refuses a captured drag after %s without shrinking its payload", change => {
    const start = seed(), payload = captureOrganizationPayload(start, "a", new Set(["a", "b"]))!;
    const next = change === "add" ? reconcileOrganization(start, ["a", "b", "c", "d", "new"]) :
      change === "remove" ? reconcileOrganization(start, ["b", "c", "d"]) :
      change === "rename" ? organize(start, { type: "rename", groupId: "group-1", name: "Renamed" }) :
      organize(start, { type: "disclose", groupId: "group-1" });
    const result = organize(next, { type: "move", payload, target: { groupId: "group-1", anchor: null, edge: "after" } });
    expect(result.notice).toBe("stale");
    expect(result.groups).toBe(next.groups);
    expect(payload.handles).toEqual(["a", "b"]);
  });
  it("refuses missing destination and anchor IDs", () => {
    const start = seed(), payload = captureOrganizationPayload(start, "a", new Set(["a"]))!;
    for (const target of [{ groupId: "missing", anchor: null }, { groupId: "group-1", anchor: "c" }]) {
      const next = organize(start, { type: "move", payload, target: { ...target, edge: "after" } });
      expect(next.notice).toBe("targetMissing");
      expect(next.groups).toBe(start.groups);
    }
  });
  it("cancels without a transaction or roster change", () => {
    const start = seed(), next = organize(start, { type: "cancel" });
    expect(next.groups).toBe(start.groups);
    expect(next.history).toBe(start.history);
  });
  it("undoes a local move while preserving intervening authoritative imports", () => {
    const moved = move(seed(), "a", ["a", "c"]);
    const imported = reconcileOrganization(moved, ["a", "b", "c", "d", "new"]);
    const undone = organize(imported, { type: "undo" });
    expect(undone.notice).toBe("undone");
    expect(undone.groups[0]?.handles).toEqual(["a", "b", "c", "d", "new"]);
    expect(undone.groups[1]?.handles).toEqual([]);
  });
  it("refuses unsafe undo after a required handle is removed and never resurrects it", () => {
    const moved = move(seed(), "a", ["a", "c"]);
    const removed = reconcileOrganization(moved, ["b", "c", "d"]);
    const undone = organize(removed, { type: "undo" });
    expect(undone.notice).toBe("unsafeUndo");
    expect(undone.groups).toBe(removed.groups);
    expect(arrangedHandles(undone)).not.toContain("a");
  });
  it("dissolves a group into ungrouped without removing acquisitions, and can undo", () => {
    const moved = move(seed(), "a", ["a", "c"]);
    const dissolved = organize(moved, { type: "dissolve", groupId: "group-1" });
    expect(dissolved.groups).toHaveLength(1);
    expect(dissolved.groups[0]?.handles).toEqual(["b", "d", "a", "c"]);
    expect(organize(dissolved, { type: "undo" }).groups).toEqual(moved.groups);
  });
  it("uses group IDs despite duplicate, renamed and path-like labels", () => {
    let start = organize(seed(), { type: "create", name: "Research 样本" });
    start = organize(start, { type: "rename", groupId: "group-1", name: "QC/../user label" });
    const next = move(start, "b", ["b"], "group-2");
    expect(next.groups[1]?.handles).toEqual([]);
    expect(next.groups[2]?.handles).toEqual(["b"]);
  });
  it("reorders group IDs with the consumed helper and safely reverses that order", () => {
    const start = organize(seed(), { type: "create", name: "Second" });
    const reordered = organize(start, { type: "reorderGroup", groupId: "group-2", targetId: "group-1" });
    expect(reordered.groups.map(group => group.id)).toEqual([UNGROUPED, "group-2", "group-1"]);
    expect(organize(reordered, { type: "undo" }).groups).toEqual(start.groups);
  });
  it("keeps bounded history and never reuses a group identity after undo", () => {
    let state = seed();
    for (let index = 0; index < UNDO_LIMIT + 8; index++) state = organize(state, { type: "rename", groupId: "group-1", name: String(index) });
    expect(state.history).toHaveLength(UNDO_LIMIT);
    const created = organize(state, { type: "create", name: "temporary" });
    const next = organize(organize(created, { type: "undo" }), { type: "create", name: "replacement" });
    expect(next.groups.at(-1)?.id).toBe("group-3");
  });
  it("reconciliation prunes duplicates, places only new authoritative IDs in ungrouped, and is stable", () => {
    const state = move(seed(), "b", ["b"]);
    expect(reconcileOrganization(state, ["a", "b", "c", "d"])).toBe(state);
    const next = reconcileOrganization(state, ["b", "d", "new"]);
    expect(next.groups.map(group => group.handles)).toEqual([["d", "new"], ["b"]]);
  });
});
