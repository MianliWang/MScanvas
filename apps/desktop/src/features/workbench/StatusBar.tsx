import { useLayoutEffect, useRef, type MouseEvent } from "react";

import { Button, Icon, StatusBar, type IconName } from "../../components/ui";
import type { UiMessage } from "../preferences/i18n";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { BackendStatusTone } from "../mzml-preview/backendPresentation";
import type { ShellContextItem } from "./shellContext";
import type { WorkbenchSurface } from "./WorkbenchHeader";

/** The visible reason refused workspace actions point at (spec 2.3). */
export const STATUS_BUSY_ID = "shell-status-busy";
/** The backend item, which refused reads point at. Always rendered. */
export const STATUS_BACKEND_ID = "shell-status-backend";
/** A work or project item's id, for a refusal that it is the reason for. */
export const statusItemId = (id: ShellContextItem["id"]) => `shell-status-${id}`;

const BACKEND_ICON = {
  ready: "checkCircle",
  pending: "clock",
  attention: "alert",
  danger: "alert",
} as const satisfies Record<BackendStatusTone, IconName>;

export interface StatusBackend {
  /** Green only when ready; the label says the state in words too. */
  readonly tone: BackendStatusTone;
  readonly text: string;
  /** Whether the ProteoWizard details (`#backend-status`) are open over the bar. */
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

export interface BusyFlags {
  readonly backendBusy: boolean;
  readonly pickerBusy: boolean;
  readonly folderBusy: boolean;
  readonly dropBusy: boolean;
  readonly workspaceBusy: boolean;
  readonly projectAdmitting: boolean;
  readonly conversionBusy: boolean;
  readonly rosterLoad: "loading" | "ready" | "failed";
}

/**
 * Why adding, re-reading or changing the list waits, or `null` when nothing
 * does. The first true flag wins, in the order the gates check them.
 * `"conversion"` means the conversion's own status item is the reason.
 */
export function statusBusyReason(flags: BusyFlags, t: UiMessage): string | "conversion" | null {
  if (flags.backendBusy) return t("backendCheckingInstallation");
  if (flags.pickerBusy) return t("statusBusyPicker");
  if (flags.folderBusy) return t("folderBusy");
  if (flags.dropBusy) return t("dropAdding");
  if (flags.workspaceBusy) return t("statusBusyWorkspace");
  if (flags.projectAdmitting) return t("statusBusyProject");
  if (flags.conversionBusy) return "conversion";
  if (flags.rosterLoad === "loading") return t("rosterLoading");
  if (flags.rosterLoad === "failed") return t("rosterFailed");
  return null;
}

/**
 * The 28 px bar along the window's foot (direction A): ProteoWizard as an icon
 * and a short label, work under way, why workspace actions wait, the project,
 * then the layout's save state and a file drop that stopped working. Built
 * from existing state only; it starts no work.
 */
export function WorkbenchStatusBar({ backend, items, busy, dropStatus, dropProblem = null, onReconnectDrop, onNavigate, inert = false }: {
  readonly backend: StatusBackend;
  readonly items: readonly ShellContextItem[];
  readonly busy: string | "conversion" | null;
  readonly dropStatus: "available" | "connecting" | "unavailable";
  /** What went wrong connecting file drop, while it is unavailable. */
  readonly dropProblem?: string | null;
  /** Tries to connect file drop again; offered while it is unavailable. */
  readonly onReconnectDrop?: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onNavigate: (surface: WorkbenchSurface) => void;
  /** A drawer is open over the workspace: the bar is behind it. */
  readonly inert?: boolean;
}) {
  const t = useUiMessages();
  const { panels } = useSessionPreferences();
  const go = (target: WorkbenchSurface) => { onNavigate(target); panels.navigate(); };

  const conversionItem = busy === "conversion" && items.some(item => item.id === "conversionActivity");
  const unsaved = panels.save.status === "unsaved";
  const dropLost = dropStatus === "unavailable";

  /**
   * The drop notice is whole or gone, and it goes before anything else in the
   * bar is cut: shrinking alone would leave a sliver. Its Reconnect stays.
   * Measured with the notice shown and settled in the same frame, so nothing
   * flickers; again whenever the bar resizes or what it says changes.
   */
  const barRef = useRef<HTMLDivElement>(null);
  const said = [backend.text, busy, unsaved, panels.save.problem, panels.save.retryable, dropStatus, ...items.map(item => `${item.text}${item.unsaved === true ? "*" : ""}`)].join("|");
  useLayoutEffect(() => {
    const bar = barRef.current;
    const hint = bar?.querySelector<HTMLElement>(".workspace-drop-hint");
    if (bar == null || hint == null) return;
    const fit = () => {
      hint.hidden = false;
      hint.hidden = hint.scrollWidth > hint.clientWidth
        || [...bar.querySelectorAll<HTMLElement>(".status-item-text")].some(text => text.scrollWidth > text.clientWidth);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    return () => { observer.disconnect(); };
  }, [said]);

  const start = <>
    <Button variant="quiet" size="sm" id={STATUS_BACKEND_ID} className="status-item status-backend"
      data-backend-item="" data-backend-toggle="" aria-expanded={backend.expanded} aria-controls="backend-status"
      onClick={backend.onToggle}>
      <span className="status-icon" data-tone={backend.tone} aria-hidden="true"><Icon name={BACKEND_ICON[backend.tone]} size={14} /></span>
      {backend.text}
    </Button>
    {items.map(item => <Button key={item.id} variant="quiet" size="sm" className="status-item"
      id={conversionItem && item.id === "conversionActivity" ? STATUS_BUSY_ID : statusItemId(item.id)}
      data-shell-context={item.id} title={item.text} onClick={() => go(item.target)}>
      <span className="status-item-text">{item.text}</span>
      {item.unsaved === true ? <>{" "}<span className="status-tag">{t("statusUnsaved")}</span></> : null}
    </Button>)}
    {busy === null || conversionItem ? null
      : <span id={STATUS_BUSY_ID} className="status-busy" data-status-busy="">
        {t("statusBusy", { reason: busy === "conversion" ? t("workActive") : busy })}
      </span>}
  </>;
  const end = <>
    {/* The arrangement is on screen either way; this says it will not survive
        a restart, and offers the one action that could change that. The
        header's polite region is what announces it. */}
    {unsaved ? <p className="status-layout" data-layout-unsaved="">
      <span className="status-item-text">{t(panels.save.problem === "notConfirmed" ? "layoutUncertain" : "layoutUnsaved")}</span>
      {panels.save.retryable ? <Button variant="secondary" size="sm" onClick={panels.retry}>{t("layoutRetry")}</Button> : null}
    </p> : null}
    {/* Working drop needs no permanent hint (W1); one that stopped working is
        said here, where Add files is the way round it. */}
    {dropLost ? <p className="workspace-drop-hint" title={dropProblem ?? undefined}>{t("shellDropUnavailable")}</p> : null}
    {dropLost && onReconnectDrop !== undefined
      ? <Button variant="secondary" size="sm" className="drop-reconnect" title={dropProblem ?? undefined} onClick={onReconnectDrop}>{t("dropReconnect")}</Button>
      : null}
  </>;
  return <div ref={barRef} className="workbench-status" inert={inert || undefined}>
    <StatusBar start={start} end={end} />
  </div>;
}
