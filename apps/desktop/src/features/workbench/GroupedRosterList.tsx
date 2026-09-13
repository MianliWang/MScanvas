import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEventHandler, type KeyboardEventHandler, type MouseEvent, type ReactNode, type RefObject } from "react";
import { DragDropProvider, DragOverlay, useDroppable, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import { Accessibility, defaultPreset, DragDropManager, KeyboardSensor, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { motion, useReducedMotion } from "motion/react";
import type { SelectedFile } from "../mzml-preview/contracts";
import { SOURCE_KIND_LABEL } from "../mzml-preview/contracts";
import { formatByteLength } from "../mzml-preview/format";
import { rowPresentation, type RosterAction, type RosterState } from "../mzml-preview/rosterSelection";
import type { RosterProjection } from "../mzml-preview/rosterView";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { MessageKey } from "../preferences/i18n";
import { captureOrganizationPayload, UNGROUPED, type AcquisitionGroup, type OrganizationPayload, type OrganizationTarget, type OrganizationNotice } from "./organization";
import { GroupNameDialog } from "./GroupNameDialog";
import { useRosterWindow } from "./useRosterWindow";

interface Props {
  readonly state: RosterState; readonly projection: RosterProjection;
  readonly dispatch: (action: RosterAction) => void;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly onBlur: FocusEventHandler<HTMLDivElement>;
  readonly onFocus: FocusEventHandler<HTMLDivElement>;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly onRowPress: (event: MouseEvent<HTMLElement>, handle: string) => void;
  readonly empty: ReactNode;
}
const noticeKeys = {
  changed: "organizationChanged", undone: "organizationUndone", cancelled: "organizationCancelled",
  stale: "organizationStale", targetMissing: "organizationTargetMissing", unsafeUndo: "organizationUnsafeUndo", invalidName: "organizationInvalidName",
} as const satisfies Record<OrganizationNotice, MessageKey>;
const sensors = [
  PointerSensor.configure({
    activatorElements: source => [source.element],
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 6 })],
    preventActivation: event => {
      const control = event.target instanceof Element ? event.target.closest("button,input,select,textarea,a,[contenteditable=true]") : null;
      return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || (control !== null && !control.hasAttribute("data-drag-handle"));
    },
  }),
  KeyboardSensor.configure({
    keyboardCodes: { start: ["Space"], end: ["Space", "Enter", "NumpadEnter"], cancel: ["Escape"], up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] },
    preventActivation: (event, source) => event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.target !== source.handle,
  }),
];
// Data order commits once on drop. The optimistic plugin physically reparents
// nodes, which conflicts with a React-owned window when rows unmount on scroll.
// Keep dnd-kit's keyboard geometry, collision, feedback and auto-scroll owners;
// the target highlight communicates the destination without speculative reparenting.
const sortablePlugins = [SortableKeyboardPlugin];
type WindowItem = { readonly key: string; readonly estimate: number; readonly group: AcquisitionGroup; readonly row: SelectedFile | null };
type Announcement = { readonly kind: "pickup"; readonly count: number } | { readonly kind: "target"; readonly count: number; readonly groupId: string } | null;

export function GroupedRosterList(props: Props) {
  const { state, projection, dispatch } = props;
  const preferences = useSessionPreferences(), t = useUiMessages(), reduced = useReducedMotion();
  const [manager] = useState(() => new DragDropManager({ sensors, plugins: defaultPreset.plugins.filter(plugin => plugin !== Accessibility) }));
  const latest = useRef(props), payload = useRef<OrganizationPayload | null>(null);
  const target = useRef<OrganizationTarget | null>(null), suppressedClick = useRef(false);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; returnTo: HTMLElement | null } | null>(null);
  const geometryKey = `${preferences.effective.locale}:${preferences.effective.density}`;
  const previousGeometry = useRef(geometryKey);
  useLayoutEffect(() => {
    latest.current = props;
    if (payload.current !== null && (payload.current.revision !== state.organization.revision || previousGeometry.current !== geometryKey)) {
      manager.actions.stop({ canceled: true });
      dispatch({ type: "organization", action: { type: "cancel", reason: "stale" } });
    }
    previousGeometry.current = geometryKey;
  }, [props, state.organization.revision, geometryKey, manager, dispatch]);
  useEffect(() => {
    const cancel = () => { if (payload.current !== null) manager.actions.stop({ canceled: true }); };
    const visibility = () => { if (document.visibilityState === "hidden") cancel(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel); document.removeEventListener("visibilitychange", visibility); manager.actions.stop({ canceled: true }); };
  }, [manager]);
  const onDragStart = useCallback((event: DragStartEvent) => {
    const source = event.operation.source?.data.handle;
    if (typeof source !== "string") { manager.actions.stop({ canceled: true }); return; }
    const state = latest.current.state;
    payload.current = captureOrganizationPayload(state.organization, source, state.selected);
    if (payload.current === null) { manager.actions.stop({ canceled: true }); return; }
    target.current = null; suppressedClick.current = true;
    setDragSource(source); setAnnouncement({ kind: "pickup", count: payload.current.handles.length });
  }, [manager]);
  const onDragOver = useCallback((event: DragOverEvent) => {
    const destination = event.operation.target;
    if (destination === null || payload.current === null) { target.current = null; return; }
    const { groupId, handle } = destination.data;
    if (typeof groupId !== "string") { target.current = null; return; }
    let next: OrganizationTarget = { groupId, anchor: typeof handle === "string" ? handle : null, edge: "before" };
    // In-group moves past a later anchor land after it. Only complete data order is compared.
    const state = latest.current.state;
    const group = state.organization.groups.find(group => group.id === groupId);
    if (next.anchor !== null && group !== undefined && group.handles.indexOf(payload.current.sourceHandle) >= 0 &&
        group.handles.indexOf(payload.current.sourceHandle) < group.handles.indexOf(next.anchor)) next = { ...next, edge: "after" };
    const previous = target.current;
    target.current = next;
    if (previous?.groupId !== groupId) setAnnouncement({ kind: "target", count: payload.current.handles.length, groupId });
  }, []);
  const onDragEnd = useCallback((event: DragEndEvent) => {
    const captured = payload.current, destination = target.current;
    payload.current = null; target.current = null; setDragSource(null); setAnnouncement(null);
    if (captured === null) return;
    const hit = event.operation.target?.data;
    const bounds = latest.current.listRef.current?.getBoundingClientRect();
    const point = event.operation.position.current;
    const pointerInside = !(event.operation.activatorEvent instanceof PointerEvent) || (bounds !== undefined &&
      point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom);
    const valid = !event.canceled && pointerInside && destination !== null && hit?.groupId === destination.groupId &&
      (typeof hit?.handle === "string" ? hit.handle : null) === destination.anchor;
    latest.current.dispatch({ type: "organization", action: valid ? { type: "move", payload: captured, target: destination } : { type: "cancel" } });
  }, []);
  const moveTo = useCallback((source: string, groupId: string) => {
    const current = latest.current.state;
    const captured = captureOrganizationPayload(current.organization, source, current.selected);
    if (captured !== null) latest.current.dispatch({ type: "organization", action: { type: "move", payload: captured, target: { groupId, anchor: null, edge: "after" } } });
  }, []);
  const onPress = useCallback((event: MouseEvent<HTMLElement>, handle: string) => {
    // React portals bubble through the logical row, although their menu items
    // are not descendants of the row element. They never activate its preview.
    if (suppressedClick.current || event.defaultPrevented || !(event.target instanceof Node) || !event.currentTarget.contains(event.target) ||
        (event.target instanceof Element && event.target.closest("button,input,select,a,[contenteditable=true],[role=menuitem]"))) return;
    latest.current.onRowPress(event, handle);
  }, []);
  const items = useMemo<WindowItem[]>(() => {
    const visible = new Map(projection.datasets.map(row => [row.handle, row]));
    return state.organization.groups.flatMap(group => [
      { key: `group:${group.id}`, group, row: null, estimate: 40 },
      ...group.handles.flatMap(handle => { const row = visible.get(handle); return row === undefined ? [] : [{ key: handle, group, row, estimate: preferences.effective.density === "compact" ? 32 : 44 }]; }),
    ]);
  }, [state.organization.groups, projection.datasets, preferences.effective.density]);
  const retained = useMemo(() => new Set([state.focused, dragSource].filter((id): id is string => id !== null)), [state.focused, dragSource]);
  const windowing = useRosterWindow(items, retained, dragSource !== null, state.focused);
  const rootRef = useCallback((node: HTMLDivElement | null) => { props.listRef.current = node; windowing.root.current = node; }, [props.listRef, windowing.root]);
  let bottom = 0;
  const rendered = windowing.rendered.map(({ item, top, height }) => {
    const gap = top - bottom; bottom = top + height;
    return <div key={item.key} role="presentation">
      {gap > 0 ? <div aria-hidden="true" style={{ height: gap }} /> : null}
      {item.row === null ? <GroupHeader group={item.group} state={state} dispatch={dispatch} onRename={setEditing} measure={windowing.measure} reduced={!!reduced} /> :
        <AcquisitionRow row={item.row} group={item.group} state={state} projection={projection} dispatch={dispatch} onPress={onPress} moveTo={moveTo} measure={windowing.measure} reduced={!!reduced} />}
    </div>;
  });
  const selectedHidden = [...state.selected].filter(handle => !projection.handles.has(handle)).length;
  const notice = state.organization.notice;
  const groupName = (id: string) => id === UNGROUPED ? t("ungrouped") : state.organization.groups.find(group => group.id === id)?.name ?? t("ungrouped");
  return <DragDropProvider manager={manager} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
    <div className="organization-toolbar">
      <button type="button" className="secondary-button" onClick={event => setEditing({ id: null, name: "", returnTo: event.currentTarget })}>{t("newGroup")}</button>
      {state.organization.history.length ? <button type="button" className="link-button" onClick={() => dispatch({ type: "organization", action: { type: "undo" } })}>{t("undoOrganization")}</button> : null}
    </div>
    <p className="roster-selection-context" aria-live="polite">{t("selectionContext", { total: state.selected.size, hidden: selectedHidden, checked: state.conversionMembership.size })}</p>
    <p id="roster-drag-instructions" className="visually-hidden">{t("dragInstructions")}</p>
    <div aria-labelledby="dataset-roster-heading" aria-multiselectable="true" aria-describedby="roster-keyboard-help" role="treegrid" className="dataset-roster-list grouped-roster" ref={rootRef}
      data-windowed={windowing.windowed} data-drag-active={dragSource !== null}
      onScroll={windowing.onScroll} onFocus={props.onFocus} onBlur={props.onBlur}
      onPointerDownCapture={() => { if (payload.current === null) suppressedClick.current = false; }}
      onKeyDownCapture={event => { if (payload.current !== null && event.code === "Tab") manager.actions.stop({ canceled: true }); }}
      onKeyDown={event => {
        if (payload.current !== null || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
        if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") { event.preventDefault(); dispatch({ type: "organization", action: { type: "undo" } }); return; }
        if (event.target instanceof Element && event.target.closest("button")) return;
        props.onKeyDown(event);
      }}>
      {props.empty}
      {rendered}
      {windowing.total > bottom ? <div aria-hidden="true" style={{ height: windowing.total - bottom }} /> : null}
    </div>
    <p id="roster-keyboard-help" className="visually-hidden">{t("rosterKeyboardHelp")}</p>
    <p className="organization-notice" aria-live="polite" data-organization-notice={notice ?? ""}>
      {announcement?.kind === "pickup" ? t("dragPicked", { count: announcement.count }) : announcement?.kind === "target" ? t("dragTarget", { count: announcement.count, name: groupName(announcement.groupId) }) : notice === null ? "" : t(noticeKeys[notice])}
    </p>
    <DragOverlay dropAnimation={null} style={{ pointerEvents: "none", display: "flex", justifyContent: "flex-end", alignItems: "center" }}><span className="roster-drag-overlay" aria-hidden="true">{t("dragCount", { count: payload.current?.handles.length ?? 0 })}</span></DragOverlay>
    {editing !== null ? <GroupNameDialog name={editing.name} rename={editing.id !== null} returnTo={editing.returnTo} onClose={() => setEditing(null)} onSave={name => {
      dispatch({ type: "organization", action: editing.id === null ? { type: "create", name } : { type: "rename", groupId: editing.id, name } }); setEditing(null);
    }} /> : null}
  </DragDropProvider>;
}

function MembershipCheckbox({ label, checked, mixed = false, tabIndex, onChange }: { readonly label: string; readonly checked: boolean; readonly mixed?: boolean; readonly tabIndex?: number; readonly onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => { if (ref.current !== null) ref.current.indeterminate = mixed; }, [mixed]);
  return <input type="checkbox" ref={ref} tabIndex={tabIndex} aria-label={label} checked={checked} onChange={event => onChange(event.target.checked)} onClick={event => event.stopPropagation()} />;
}
const GroupHeader = memo(function GroupHeader({ group, state, dispatch, onRename, measure, reduced }: {
  readonly group: AcquisitionGroup; readonly state: RosterState; readonly dispatch: Props["dispatch"];
  readonly onRename: (input: { id: string; name: string; returnTo: HTMLElement | null }) => void; readonly measure: (node: HTMLElement | null, key: string) => void; readonly reduced: boolean;
}) {
  const t = useUiMessages();
  const menuTrigger = useRef<HTMLButtonElement | null>(null), openingDialog = useRef(false);
  const { ref, isDropTarget } = useDroppable({ id: `group:${group.id}`, data: { groupId: group.id }, type: "group", accept: "acquisition" });
  const setRef = useCallback((node: HTMLDivElement | null) => { ref(node); measure(node, `group:${group.id}`); }, [ref, measure, group.id]);
  const name = group.id === UNGROUPED ? t("ungrouped") : group.name;
  const checked = group.handles.filter(handle => state.conversionMembership.has(handle)).length;
  const index = state.organization.groups.findIndex(item => item.id === group.id);
  return <div role="row" aria-level={1} aria-expanded={!group.collapsed} className={`roster-group-header${isDropTarget ? " is-drop-target" : ""}`} data-group-id={group.id} ref={setRef}>
    <div role="gridcell"><MembershipCheckbox label={t("checkGroup", { name, count: group.handles.length })} checked={group.handles.length > 0 && checked === group.handles.length} mixed={checked > 0 && checked < group.handles.length}
      onChange={checked => dispatch({ type: "membershipChanged", handles: group.handles, checked })} /></div>
    <div role="gridcell" className="group-disclosure-cell"><button type="button" className="group-disclosure" aria-expanded={!group.collapsed} aria-label={t("groupDisclosure", { name, count: group.handles.length })} onClick={() => dispatch({ type: "organization", action: { type: "disclose", groupId: group.id } })}>
      <motion.span aria-hidden="true" animate={{ rotate: group.collapsed ? -90 : 0 }} transition={{ duration: reduced ? 0 : 0.14 }}>⌄</motion.span><span>{name}</span><span className="group-count">{group.handles.length}</span></button></div>
    {group.id !== UNGROUPED ? <div role="gridcell"><Menu.Root><Menu.Trigger asChild><button ref={menuTrigger} type="button" className="row-menu-trigger" aria-label={t("groupActions", { name })}>⋯</button></Menu.Trigger>
      <Menu.Portal><Menu.Content className="roster-menu" sideOffset={4} onCloseAutoFocus={event => { if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; } }}>
        <Menu.Item onSelect={() => { openingDialog.current = true; onRename({ id: group.id, name: group.name, returnTo: menuTrigger.current }); }}>{t("renameGroup")}</Menu.Item>
        <Menu.Item disabled={index <= 1} onSelect={() => { const targetId = state.organization.groups[index - 1]?.id; if (targetId) dispatch({ type: "organization", action: { type: "reorderGroup", groupId: group.id, targetId } }); }}>{t("moveGroupUp")}</Menu.Item>
        <Menu.Item disabled={index === state.organization.groups.length - 1} onSelect={() => { const targetId = state.organization.groups[index + 1]?.id; if (targetId) dispatch({ type: "organization", action: { type: "reorderGroup", groupId: group.id, targetId } }); }}>{t("moveGroupDown")}</Menu.Item>
        <Menu.Separator /><Menu.Item onSelect={() => dispatch({ type: "organization", action: { type: "dissolve", groupId: group.id } })}>{t("dissolveGroup")}</Menu.Item>
      </Menu.Content></Menu.Portal></Menu.Root></div> : null}
  </div>;
});

const AcquisitionRow = memo(function AcquisitionRow({ row, group, state, projection, dispatch, onPress, moveTo, measure, reduced }: {
  readonly row: SelectedFile; readonly group: AcquisitionGroup; readonly state: RosterState; readonly projection: RosterProjection; readonly dispatch: Props["dispatch"];
  readonly onPress: Props["onRowPress"]; readonly moveTo: (source: string, group: string) => void; readonly measure: (node: HTMLElement | null, key: string) => void; readonly reduced: boolean;
}) {
  const t = useUiMessages(), highlighted = state.selected.has(row.handle);
  const { ref, handleRef, isDropTarget, isDragSource } = useSortable({ id: row.handle, group: group.id, index: group.handles.indexOf(row.handle), data: { handle: row.handle, groupId: group.id }, type: "acquisition", accept: "acquisition", plugins: sortablePlugins, transition: reduced ? null : { duration: 140 } });
  const setRef = useCallback((node: HTMLDivElement | null) => { ref(node); measure(node, row.handle); }, [ref, measure, row.handle]);
  const presentation = rowPresentation(state, row.handle), pin = projection.pinned.get(row.handle);
  const viewed = state.active === row.handle && presentation === "loaded";
  const status = presentation === "opening" ? t("rowReading") : presentation === "replaced" ? t("rowReplaced") : presentation === "missing" ? t("rowMissing") : presentation === "failed" ? t("rowFailed") : pin === "converting" ? t("rowConverting") : pin === "queued" ? t("rowQueued") : pin === "kept" ? t("rowKept") : "";
  const tabIndex = state.focused === row.handle ? 0 : -1;
  const label = [row.fileName, row.relativeContext, SOURCE_KIND_LABEL[row.sourceKind], formatByteLength(row.byteLength), viewed ? t("showingRow") : null, status, pin ? t("outsideSearch") : null].filter(Boolean).join(", ");
  return <div role="row" aria-level={2} aria-selected={highlighted} aria-label={label} tabIndex={tabIndex} data-handle={row.handle} data-group={group.id} data-drag-source={isDragSource}
    className={`dataset-row${highlighted ? " is-selected" : ""}${viewed ? " is-active" : ""}${isDropTarget ? " is-drop-target" : ""}`} ref={setRef} onClick={event => onPress(event, row.handle)}>
    <div role="gridcell"><MembershipCheckbox tabIndex={tabIndex} label={t("checkAcquisition", { name: row.fileName })} checked={state.conversionMembership.has(row.handle)} onChange={checked => dispatch({ type: "membershipChanged", handles: [row.handle], checked })} /></div>
    <div role="gridcell" className="dataset-row-label"><span className="dataset-row-name" title={row.fileName}>{row.fileName}</span>
      {row.relativeContext !== null ? <span className="dataset-row-context" title={row.relativeContext}>{row.relativeContext}</span> : null}
      <span className="dataset-row-facts"><span>{SOURCE_KIND_LABEL[row.sourceKind]}</span><span>{formatByteLength(row.byteLength)}</span>{viewed ? <span>{t("showingRow")}</span> : null}{status ? <span>{status}</span> : null}{pin ? <span>{t("outsideSearch")}</span> : null}</span></div>
    <div role="gridcell" className="roster-row-controls"><button ref={handleRef} tabIndex={tabIndex} type="button" data-drag-handle aria-describedby="roster-drag-instructions" aria-label={t("moveHandle", { name: row.fileName })} className="row-drag-handle">⠿</button>
      <Menu.Root><Menu.Trigger asChild><button tabIndex={tabIndex} type="button" className="row-menu-trigger" aria-label={t("rowActions", { name: row.fileName })}>⋯</button></Menu.Trigger><Menu.Portal><Menu.Content className="roster-menu" sideOffset={4}>
        <Menu.Label>{t("moveToGroup")} · {t("dragCount", { count: highlighted ? state.selected.size : 1 })}</Menu.Label>
        {state.organization.groups.map(destination => <Menu.Item key={destination.id} onSelect={() => moveTo(row.handle, destination.id)}>{destination.id === UNGROUPED ? t("ungrouped") : destination.name}</Menu.Item>)}
      </Menu.Content></Menu.Portal></Menu.Root></div>
  </div>;
});
