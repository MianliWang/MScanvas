import { motion, useReducedMotion } from "motion/react";
import { SettingsDialog } from "../preferences/SettingsDialog";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";

export type WorkbenchSurface = "workbench" | "conversion" | "project";
export function WorkbenchHeader({ surface, onNavigate, detailsAvailable, rowCount, busy, retained, dropStatus }: {
  readonly surface: WorkbenchSurface; readonly onNavigate: (surface: WorkbenchSurface) => void;
  readonly detailsAvailable: boolean;
  readonly rowCount: number; readonly busy: boolean; readonly retained: boolean; readonly dropStatus: "available" | "connecting" | "unavailable";
}) {
  const t = useUiMessages(), reduced = useReducedMotion();
  const { panels } = useSessionPreferences();
  const rosterOpen = panels.present.roster;
  const detailsOpen = panels.present.details && detailsAvailable;
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
  return <header className="topbar workbench-header">
    <button type="button" className="workbench-home" aria-label={t("home")} onClick={() => { onNavigate("workbench"); panels.navigate(); }}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M3 22h22M5 20v-5m4 5V9m5 11V3m5 17v-8m4 8v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <strong>MSCanvas</strong>
    </button>
    <nav className="workbench-navigation" aria-label={t("navigation")}>
      {(["workbench", "conversion", "project"] as const).map(target => <button type="button" key={target} aria-current={surface === target ? "page" : undefined} onClick={() => { onNavigate(target); panels.navigate(); }}>
        {t(target === "workbench" ? "workbench" : target === "conversion" ? "conversionTask" : "projectSurface")}
        {target === "conversion" && (busy || retained) ? <span className="work-status-dot" aria-label={t(busy ? "workActive" : "workRetained")} /> : null}
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
      {/* `detailsAvailable` is a property of the workspace rather than a
          passing refusal: with no preview read there is no panel to show, so
          that one stays `disabled`. */}
      <button type="button" className="secondary-button" aria-expanded={detailsOpen} aria-controls="workbench-inspector"
        disabled={!detailsAvailable} aria-disabled={panels.busy || undefined}
        title={loading ?? (detailsAvailable ? undefined : t("inspectorUnavailable"))}
        onClick={() => { if (!panels.busy) panels.toggle("details"); }}>{t("inspectorToggle")}</button>
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
    <p className="workspace-drop-hint">{t(dropStatus === "available" ? "shellDropHint" : dropStatus === "connecting" ? "shellDropConnecting" : "shellDropUnavailable")}</p>
  </header>;
}
