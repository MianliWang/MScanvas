import { useCallback, useLayoutEffect, useRef } from "react";

import { Button, StatusBar } from "../../components/ui";
import type { UiMessage } from "../preferences/i18n";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { ShellContextItem } from "./shellContext";
import type { WorkbenchSurface } from "./WorkbenchHeader";

/** The visible reason refused workspace actions point at (spec 2.3). */
export const STATUS_BUSY_ID = "shell-status-busy";
/** The backend item, which refused reads point at. Always rendered. */
export const STATUS_BACKEND_ID = "shell-status-backend";

export interface StatusBackend {
  /** Green when ready, amber when it needs action, red when unavailable. */
  readonly tone: "ready" | "attention" | "unavailable";
  readonly text: string;
  /** Set only while the banner is quiet and can fold; it then toggles it. */
  readonly toggle: { readonly expanded: boolean; readonly onToggle: () => void } | null;
  /** Shows the banner that has something to say, and puts the keyboard on it. */
  readonly onShow: () => void;
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
 * The 28 px bar along the window's foot: the backend, work under way, why
 * workspace actions wait, the project, then the layout's save state and how
 * files arrive. Built from existing state only; it starts no work.
 */
export function WorkbenchStatusBar({ backend, items, busy, dropStatus, onNavigate, inert = false }: {
  readonly backend: StatusBackend;
  readonly items: readonly ShellContextItem[];
  readonly busy: string | "conversion" | null;
  readonly dropStatus: "available" | "connecting" | "unavailable";
  readonly onNavigate: (surface: WorkbenchSurface) => void;
  /** A drawer is open over the workspace: the bar is behind it. */
  readonly inert?: boolean;
}) {
  const t = useUiMessages();
  const { panels } = useSessionPreferences();
  const go = (target: WorkbenchSurface) => { onNavigate(target); panels.navigate(); };
  const quiet = backend.toggle !== null;
  /**
   * The toggle is a different control from the item that shows a banner with
   * something to say, so it leaves when the banner speaks again, and a reader
   * who was on it continues from the banner rather than from the body. Read in
   * the ref's cleanup, while the node is still in the document.
   */
  const toggleHeldFocus = useRef(false);
  const backendToggle = useCallback((node: HTMLButtonElement | null) => {
    if (node === null) return;
    return () => { toggleHeldFocus.current = document.activeElement === node; };
  }, []);
  useLayoutEffect(() => {
    if (quiet || !toggleHeldFocus.current) return;
    toggleHeldFocus.current = false;
    document.getElementById("backend-status")?.focus({ preventScroll: true });
  }, [quiet]);

  const conversionItem = busy === "conversion" && items.some(item => item.id === "conversionActivity");
  const unsaved = panels.save.status === "unsaved";
  const dropHint = dropStatus === "available" ? t("shellDropHint") : dropStatus === "unavailable" ? t("shellDropUnavailable") : null;

  const dot = <span className="status-dot" data-tone={backend.tone} aria-hidden="true" />;
  const start = <>
    {backend.toggle === null
      ? <Button key="show" variant="quiet" size="sm" id={STATUS_BACKEND_ID} className="status-item" data-backend-item=""
        onClick={backend.onShow}>{dot}{backend.text}</Button>
      : <Button key="toggle" ref={backendToggle} variant="quiet" size="sm" id={STATUS_BACKEND_ID} className="status-item"
        data-backend-item="" data-backend-toggle="" aria-expanded={backend.toggle.expanded} aria-controls="backend-status"
        onClick={backend.toggle.onToggle}>{dot}{backend.text}</Button>}
    {items.map(item => <Button key={item.id} variant="quiet" size="sm" className="status-item"
      id={conversionItem && item.id === "conversionActivity" ? STATUS_BUSY_ID : undefined}
      data-shell-context={item.id} title={item.text} onClick={() => go(item.target)}>
      <span className="status-item-text">{item.text}</span>
      {item.unsaved === true ? <span className="status-tag">{t("statusUnsaved")}</span> : null}
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
    {dropHint === null ? null : <p className="workspace-drop-hint">{dropHint}</p>}
  </>;
  return <div className="workbench-status" inert={inert || undefined}>
    <StatusBar start={start} end={end} />
  </div>;
}
