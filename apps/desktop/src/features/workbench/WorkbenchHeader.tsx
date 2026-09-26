import { motion, useReducedMotion } from "motion/react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { SettingsDialog } from "../preferences/SettingsDialog";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";
import { prioritizeShellContext, shellContextItems, type ShellContextFacts } from "./shellContext";

export type WorkbenchSurface = "workbench" | "conversion" | "project";
export function WorkbenchHeader({ surface, onNavigate, detailsAvailable, rowCount, busy, retained, projectBusy = false, context = null, dropStatus, backend = null }: {
  readonly surface: WorkbenchSurface; readonly onNavigate: (surface: WorkbenchSurface) => void;
  readonly detailsAvailable: boolean;
  readonly rowCount: number; readonly busy: boolean; readonly retained: boolean; readonly dropStatus: "available" | "connecting" | "unavailable";
  /** Whether the project session is doing something; the words are in the context line. */
  readonly projectBusy?: boolean;
  /** What the context line describes, or `null` for none. */
  readonly context?: ShellContextFacts | null;
  /**
   * The folded backend reading, when there is nothing to act on: whether the
   * banner is showing, and how to show or fold it. `null` while the banner
   * has something to say, which it then always shows.
   */
  readonly backend?: { readonly expanded: boolean; readonly onToggle: () => void } | null;
}) {
  const t = useUiMessages(), reduced = useReducedMotion();
  const { panels } = useSessionPreferences();
  /**
   * The one way the header changes surface. Home, the navigation and every
   * context item go through it, so none of them can come to mean something
   * different from the others: each changes the surface and lets the panels
   * fold for it, and none of them starts work or resets a selection.
   */
  const go = (target: WorkbenchSurface) => { onNavigate(target); panels.navigate(); };
  const contextItems = context === null ? [] : prioritizeShellContext(shellContextItems(context, t), surface);
  const rosterOpen = panels.present.roster;
  const detailsOpen = panels.present.details && detailsAvailable;
  const detailsRefused = panels.busy || !detailsAvailable;
  /**
   * Refused only while the stored record is still being read.
   *
   * `aria-disabled` rather than `disabled`, and the same for the reset with
   * nothing to reset. A `disabled` button leaves the tab order, so its reason
   * -- carried in the tooltip -- can only be read with a pointer: a keyboard
   * user tabs straight past three controls and is told nothing about any of
   * them. Kept focusable, each one announces itself as dimmed and says why,
   * and the handlers below refuse the action rather than the element refusing
   * the focus. The store refuses it a second time, so this is presentation
   * rather than the only guard.
   *
   * Keeping the reset focusable also means a reader who presses it stays on
   * it. The earlier design moved the keyboard to the roster toggle when the
   * reset disabled itself, which a pointer user got too -- their next Space
   * would have toggled a panel they never touched.
   */
  const loading = panels.busy ? t("panelsLoading") : undefined;
  const resettable = panels.requested.roster !== "automatic" || panels.requested.details !== "automatic";
  const unsaved = panels.save.status === "unsaved";
  /**
   * The backend toggle leaves when the banner has something to say again -- a
   * check, a superseded reading, a lane holding it back -- and a reader who was
   * on it would be left on the body. Their place goes to the banner that
   * replaced it. Read in the ref's cleanup, which runs while the node is still
   * in the document: removing a focused node reports no blur to rely on.
   */
  const toggleHeldFocus = useRef(false);
  const backendToggle = useCallback((node: HTMLButtonElement | null) => {
    if (node === null) return;
    return () => { toggleHeldFocus.current = document.activeElement === node; };
  }, []);
  const backendFolding = backend !== null;
  useLayoutEffect(() => {
    if (backendFolding || !toggleHeldFocus.current) return;
    toggleHeldFocus.current = false;
    document.getElementById("backend-status")?.focus({ preventScroll: true });
  }, [backendFolding]);
  return <header className="topbar workbench-header">
    <button type="button" className="workbench-home" aria-label={t("home")} onClick={() => go("workbench")}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M3 22h22M5 20v-5m4 5V9m5 11V3m5 17v-8m4 8v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <strong>MSCanvas</strong>
    </button>
    <nav className="workbench-navigation" aria-label={t("navigation")}>
      {(["workbench", "conversion", "project"] as const).map(target => <button type="button" key={target} aria-current={surface === target ? "page" : undefined} onClick={() => go(target)}>
        {t(target === "workbench" ? "workbench" : target === "conversion" ? "conversionTask" : "projectSurface")}
        {target === "conversion" && (busy || retained) ? <span className="work-status-dot" aria-label={t(busy ? "workActive" : "workRetained")} /> : null}
        {/* Visual only. The sentence that says what the project is doing is in
            the context line below, and a name added here would change the
            navigation button's accessible name while the work runs. A class of
            its own, so nothing that looks for the conversion's badge finds it. */}
        {target === "project" && projectBusy ? <span className="project-work-dot" aria-hidden="true" data-project-work-dot="" /> : null}
        <motion.span className="navigation-underline" aria-hidden="true" animate={{ opacity: surface === target ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.14 }} />
      </button>)}
    </nav>
    <div className="workbench-global-actions">
      {/* Immediate presentation actions, as they were. What M7.5 adds is that
          the arrangement they produce is committed, and that a narrow window
          folding a panel away is not: see `panelPresentation`. */}
      <button type="button" className="secondary-button" aria-expanded={rosterOpen} aria-controls="workbench-roster"
        aria-disabled={panels.busy || undefined} title={loading}
        onClick={() => { if (!panels.busy) panels.toggle("roster"); }}>{t("rosterToggle")}</button>
      {/* Details is closed by default below 1700 px (PM9 L20), so its entry
          has to stay findable: the same control in the same place on every
          surface and in every state, focusable even when there is nothing to
          show, and saying why -- in the terms of the surface it is on --
          rather than leaving the tab order whenever a preview is re-read or
          the surface changes. Refused with `aria-disabled`, as the others. */}
      <button type="button" className="secondary-button" aria-expanded={detailsOpen} aria-controls="workbench-inspector"
        aria-disabled={detailsRefused || undefined}
        title={loading ?? (detailsAvailable ? undefined : t(surface === "project" ? "provenanceNothingSelected" : "inspectorUnavailable"))}
        onClick={() => { if (!detailsRefused) panels.toggle("details"); }}>{t("inspectorToggle")}</button>
      <button type="button" className="secondary-button" data-layout-reset="" aria-disabled={panels.busy || !resettable || undefined}
        title={loading ?? (resettable ? undefined : t("layoutNothingToReset"))}
        onClick={() => { if (!panels.busy && resettable) panels.reset(); }}>{t("layoutReset")}</button>
      <SettingsDialog rowCount={rowCount} />
    </div>
    {/* Mounted from the first render and empty until there is something to
        say. A region that arrives with its text already in it is the one
        mutation screen readers do not announce, which is how the unsaved-layout
        notice came to be visible and silent. */}
    <p aria-live="polite" className="visually-hidden" data-live-region="layout">
      {panels.announcement === null
        ? ""
        : t(panels.announcement === "reset" ? "layoutResetDone"
          : panels.announcement === "uncertain" ? "layoutUncertain" : "layoutUnsaved")}
    </p>
    {/* The arrangement is on screen either way; what this says is that it will
        not survive a restart, and offers the one action that could change that.
        Never an alert: nothing is wrong with the workspace. The announcement is
        the region above, so this element carries no role of its own. */}
    {unsaved ? <p className="workspace-layout-unsaved" data-layout-unsaved="">
      <span>{t(panels.save.problem === "notConfirmed" ? "layoutUncertain" : "layoutUnsaved")}</span>
      {panels.save.retryable ? <button type="button" className="link-button" onClick={panels.retry}>{t("layoutRetry")}</button> : null}
    </p> : null}
    {/* The header's second line: where the reader is, then how files arrive.
        It shares the line the drop hint already had rather than adding a row
        to the shell's grid, and it never wraps into a second one: each item
        gives way by its rank instead (`prioritizeShellContext`). Not a live
        region: each fact here is announced, where it is announced at all, by
        the surface that owns it. */}
    <div className="workbench-context-bar">
      {contextItems.length === 0 ? null : (
        <div className="shell-context" role="group" aria-label={t("shellContextRegion")}>
          {contextItems.map(item => <button type="button" key={item.id} className="shell-context-item"
            data-shell-context={item.id} data-priority={item.priority} title={item.text} onClick={() => go(item.target)}>{item.text}</button>)}
        </div>
      )}
      {/* The backend banner folds away while it has nothing to act on (PM9
          L10); this is where it is read and reopened from. */}
      {backend === null ? null : (
        <button type="button" ref={backendToggle} className="shell-backend-toggle" data-backend-toggle=""
          aria-expanded={backend.expanded} aria-controls="backend-status" onClick={backend.onToggle}>{t("backendReadyShort")}</button>
      )}
      <p className="workspace-drop-hint">{t(dropStatus === "available" ? "shellDropHint" : dropStatus === "connecting" ? "shellDropConnecting" : "shellDropUnavailable")}</p>
    </div>
  </header>;
}
