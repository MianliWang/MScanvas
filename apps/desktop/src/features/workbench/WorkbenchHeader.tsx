import { motion, useReducedMotion } from "motion/react";
import { SettingsDialog } from "../preferences/SettingsDialog";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";

export type WorkbenchSurface = "workbench" | "conversion";
export function WorkbenchHeader({ surface, onNavigate, detailsAvailable, rowCount, busy, retained, dropStatus }: {
  readonly surface: WorkbenchSurface; readonly onNavigate: (surface: WorkbenchSurface) => void;
  readonly detailsAvailable: boolean;
  readonly rowCount: number; readonly busy: boolean; readonly retained: boolean; readonly dropStatus: "available" | "connecting" | "unavailable";
}) {
  const t = useUiMessages(), reduced = useReducedMotion();
  const { panels } = useSessionPreferences();
  const rosterOpen = panels.present.roster;
  const detailsOpen = panels.present.details && detailsAvailable;
  // Refused only while the stored record is still being read. Every refused
  // control here says why: a disabled toggle with no reason is a control a
  // reader has to guess about, and the sentence that explains this one lives
  // inside Settings, which they have not opened.
  const loading = panels.busy ? t("panelsLoading") : undefined;
  // Enabled exactly when there is something to reset. Kept mounted either way:
  // activating it is what makes the arrangement default again, so a control
  // that removed itself on activation would take a keyboard user's place in
  // the tab order with it and leave them at the top of the page.
  const resettable = panels.requested.roster !== "automatic" || panels.requested.details !== "automatic";
  const unsaved = panels.save.status === "unsaved";
  return <header className="topbar workbench-header">
    <button type="button" className="workbench-home" aria-label={t("home")} onClick={() => { onNavigate("workbench"); panels.navigate(); }}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M3 22h22M5 20v-5m4 5V9m5 11V3m5 17v-8m4 8v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <strong>MSCanvas</strong>
    </button>
    <nav className="workbench-navigation" aria-label={t("navigation")}>
      {(["workbench", "conversion"] as const).map(target => <button type="button" key={target} aria-current={surface === target ? "page" : undefined} onClick={() => { onNavigate(target); panels.navigate(); }}>
        {t(target === "workbench" ? "workbench" : "conversionTask")}
        {target === "conversion" && (busy || retained) ? <span className="work-status-dot" aria-label={t(busy ? "workActive" : "workRetained")} /> : null}
        <motion.span className="navigation-underline" aria-hidden="true" animate={{ opacity: surface === target ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.14 }} />
      </button>)}
    </nav>
    <div className="workbench-global-actions">
      {/* Immediate presentation actions, as they were. What M7.5 adds is that
          the arrangement they produce is committed, and that a narrow window
          folding a panel away is not: see `panelPresentation`. */}
      <button type="button" className="secondary-button" aria-expanded={rosterOpen} aria-controls="workbench-roster" disabled={panels.busy} title={loading} onClick={() => panels.toggle("roster")}>{t("rosterToggle")}</button>
      <button type="button" className="secondary-button" aria-expanded={detailsOpen} aria-controls="workbench-inspector" disabled={panels.busy || !detailsAvailable}
        title={loading ?? (detailsAvailable ? undefined : t("inspectorUnavailable"))} onClick={() => panels.toggle("details")}>{t("inspectorToggle")}</button>
      <button type="button" className="secondary-button" data-layout-reset="" disabled={panels.busy || !resettable}
        title={loading ?? (resettable ? undefined : t("layoutNothingToReset"))} onClick={panels.reset}>{t("layoutReset")}</button>
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
