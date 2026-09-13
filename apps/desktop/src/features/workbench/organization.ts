import { arrayMove } from "@dnd-kit/helpers";

export const UNGROUPED = "ungrouped";
export const UNDO_LIMIT = 20;
export interface AcquisitionGroup {
  readonly id: string;
  readonly name: string;
  readonly collapsed: boolean;
  readonly handles: readonly string[];
}
interface GroupPatch {
  readonly id: string;
  readonly before: AcquisitionGroup | null;
  readonly after: AcquisitionGroup | null;
}
interface OrganizationInverse {
  readonly patches: readonly GroupPatch[];
  readonly knownHandles: readonly string[];
  readonly order: { readonly before: readonly string[]; readonly after: readonly string[] } | null;
}
export type OrganizationNotice = "changed" | "undone" | "cancelled" | "stale" | "targetMissing" | "unsafeUndo" | "invalidName";
export interface OrganizationState {
  readonly groups: readonly AcquisitionGroup[];
  readonly nextId: number;
  readonly revision: number;
  readonly history: readonly OrganizationInverse[];
  readonly notice: OrganizationNotice | null;
}
export const initialOrganization: OrganizationState = {
  groups: [{ id: UNGROUPED, name: "", collapsed: false, handles: [] }],
  nextId: 1, revision: 0, history: [], notice: null,
};
export interface OrganizationPayload {
  readonly handles: readonly string[];
  readonly sourceHandle: string;
  readonly membership: readonly string[];
  readonly revision: number;
}
export interface OrganizationTarget {
  readonly groupId: string;
  /** A surviving handle in the complete group, never a rendered row index. */
  readonly anchor: string | null;
  readonly edge: "before" | "after";
}
export type OrganizationAction =
  | { readonly type: "create"; readonly name: string }
  | { readonly type: "rename"; readonly groupId: string; readonly name: string }
  | { readonly type: "disclose"; readonly groupId: string }
  | { readonly type: "dissolve"; readonly groupId: string }
  | { readonly type: "reorderGroup"; readonly groupId: string; readonly targetId: string }
  | { readonly type: "move"; readonly payload: OrganizationPayload; readonly target: OrganizationTarget }
  | { readonly type: "cancel"; readonly reason?: "cancelled" | "stale" }
  | { readonly type: "undo" };

const equal = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
export const arrangedHandles = (state: OrganizationState): readonly string[] => state.groups.flatMap(group => group.handles);
export function groupFor(state: OrganizationState, handle: string): AcquisitionGroup | undefined {
  return state.groups.find(group => group.handles.includes(handle));
}

/** Reconcile references against Rust once in the roster transition, without facts or arrays of science. */
export function reconcileOrganization(state: OrganizationState, authoritative: readonly string[]): OrganizationState {
  const live = new Set(authoritative), held = new Set<string>();
  let changed = false;
  const groups = state.groups.map(group => {
    const handles = group.handles.filter(handle => {
      if (!live.has(handle) || held.has(handle)) return false;
      held.add(handle);
      return true;
    });
    if (equal(handles, group.handles)) return group;
    changed = true;
    return { ...group, handles };
  });
  const added = authoritative.filter(handle => !held.has(handle));
  if (added.length) {
    const index = groups.findIndex(group => group.id === UNGROUPED);
    const group = groups[index];
    if (group === undefined) throw new Error("ORGANIZATION_UNGROUPED_MISSING");
    groups[index] = { ...group, handles: [...group.handles, ...added] };
    changed = true;
  }
  return changed ? { ...state, groups, revision: state.revision + 1 } : state;
}

/** Captured in data order, including selected rows hidden by search, collapse or windowing. */
export function captureOrganizationPayload(state: OrganizationState, source: string, highlighted: ReadonlySet<string>): OrganizationPayload | null {
  const membership = arrangedHandles(state);
  if (!membership.includes(source)) return null;
  return {
    sourceHandle: source,
    handles: highlighted.has(source) ? membership.filter(handle => highlighted.has(handle)) : [source],
    membership, revision: state.revision,
  };
}

function recorded(state: OrganizationState, groups: readonly AcquisitionGroup[], nextId = state.nextId): OrganizationState {
  const before = new Map(state.groups.map(group => [group.id, group]));
  const after = new Map(groups.map(group => [group.id, group]));
  const patches: GroupPatch[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id) ?? null, b = after.get(id) ?? null;
    if (a === b || (a !== null && b !== null && a.name === b.name && equal(a.handles, b.handles))) continue;
    patches.push({ id, before: a, after: b });
  }
  const orderBefore = [...before.keys()], orderAfter = [...after.keys()];
  const order = equal(orderBefore, orderAfter) ? null : { before: orderBefore, after: orderAfter };
  if (!patches.length && order === null) return state;
  const inverse: OrganizationInverse = { patches, order, knownHandles: arrangedHandles(state) };
  return { ...state, groups, nextId, revision: state.revision + 1, notice: "changed", history: [...state.history.slice(-(UNDO_LIMIT - 1)), inverse] };
}

function move(state: OrganizationState, payload: OrganizationPayload, target: OrganizationTarget): OrganizationState {
  const membership = arrangedHandles(state);
  const held = new Set(membership), moving = new Set(payload.handles);
  if (payload.revision !== state.revision || !equal(payload.membership, membership) || !moving.size ||
      moving.size !== payload.handles.length || !moving.has(payload.sourceHandle) || payload.handles.some(id => !held.has(id))) {
    return { ...state, notice: "stale" };
  }
  const destination = state.groups.find(group => group.id === target.groupId);
  if (destination === undefined || (target.anchor !== null && !destination.handles.includes(target.anchor))) {
    return { ...state, notice: "targetMissing" };
  }
  // Dropping on the payload itself has no unambiguous new anchor and is a no-op.
  if (target.anchor !== null && moving.has(target.anchor)) return state;
  const groups = state.groups.map(group => {
    const handles = group.handles.filter(handle => !moving.has(handle));
    if (group.id === target.groupId) {
      const at = target.anchor === null ? handles.length : handles.indexOf(target.anchor) + (target.edge === "after" ? 1 : 0);
      handles.splice(at, 0, ...payload.handles);
    }
    return equal(handles, group.handles) ? group : { ...group, handles };
  });
  return recorded(state, groups);
}

function undo(state: OrganizationState): OrganizationState {
  const inverse = state.history.at(-1);
  if (inverse === undefined) return state;
  const known = new Set(inverse.knownHandles), live = new Set(arrangedHandles(state));
  const current = new Map(state.groups.map(group => [group.id, group]));
  const refuse = () => ({ ...state, notice: "unsafeUndo" as const });
  if (inverse.order !== null && !equal([...current.keys()], inverse.order.after)) return refuse();
  for (const patch of inverse.patches) {
    const actual = current.get(patch.id) ?? null;
    if ((actual === null) !== (patch.after === null)) return refuse();
    if (patch.before?.handles.some(handle => !live.has(handle))) return refuse();
    if (actual !== null && patch.after !== null &&
        (actual.name !== patch.after.name || !equal(actual.handles.filter(id => known.has(id)), patch.after.handles))) return refuse();
    // A created group with later new members cannot be removed by undo.
    if (patch.before === null && actual?.handles.some(id => !known.has(id))) return refuse();
  }
  for (const patch of inverse.patches) {
    const actual = current.get(patch.id);
    if (patch.before === null) current.delete(patch.id);
    else current.set(patch.id, {
      ...patch.before,
      collapsed: actual?.collapsed ?? patch.before.collapsed,
      // Imports since this transaction remain in their admitted ungrouped destination.
      handles: [...patch.before.handles, ...(actual?.handles.filter(id => !known.has(id)) ?? [])],
    });
  }
  const order = inverse.order?.before ?? state.groups.map(group => group.id);
  const groups = order.map(id => current.get(id)).filter((group): group is AcquisitionGroup => group !== undefined);
  const result = groups.flatMap(group => group.handles);
  if (result.length !== live.size || new Set(result).size !== live.size || result.some(id => !live.has(id))) return refuse();
  return { ...state, groups, revision: state.revision + 1, history: state.history.slice(0, -1), notice: "undone" };
}

export function organize(state: OrganizationState, action: OrganizationAction): OrganizationState {
  switch (action.type) {
    case "cancel": return { ...state, notice: action.reason ?? "cancelled" };
    case "move": return move(state, action.payload, action.target);
    case "undo": return undo(state);
    case "create": {
      if (!action.name.trim() || action.name.length > 120) return { ...state, notice: "invalidName" };
      return recorded(state, [...state.groups, { id: `group-${state.nextId}`, name: action.name, collapsed: false, handles: [] }], state.nextId + 1);
    }
    case "rename": {
      if (!action.name.trim() || action.name.length > 120) return { ...state, notice: "invalidName" };
      if (action.groupId === UNGROUPED) return state;
      if (!state.groups.some(group => group.id === action.groupId)) return { ...state, notice: "targetMissing" };
      return recorded(state, state.groups.map(group => group.id === action.groupId ? { ...group, name: action.name } : group));
    }
    case "disclose": {
      if (!state.groups.some(group => group.id === action.groupId)) return state;
      return { ...state, revision: state.revision + 1, groups: state.groups.map(group => group.id === action.groupId ? { ...group, collapsed: !group.collapsed } : group) };
    }
    case "dissolve": {
      const target = state.groups.find(group => group.id === action.groupId);
      if (target === undefined || target.id === UNGROUPED) return state;
      return recorded(state, state.groups.filter(group => group.id !== target.id).map(group => group.id === UNGROUPED ? { ...group, handles: [...group.handles, ...target.handles] } : group));
    }
    case "reorderGroup": {
      const from = state.groups.findIndex(group => group.id === action.groupId);
      const to = state.groups.findIndex(group => group.id === action.targetId);
      if (from < 1 || to < 1) return state;
      // The helper receives indices looked up in the complete ID order, not DOM indices.
      return recorded(state, arrayMove([...state.groups], from, to));
    }
  }
}
