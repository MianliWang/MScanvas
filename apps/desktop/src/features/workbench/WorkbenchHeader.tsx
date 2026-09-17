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
  // Shown exactly when there is something to reset. An arrangement that is
  // still the responsive default has nothing to return to, and a control that
  // does nothing is a control to explain rather than to offer.
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
          folding a panel away is not: see `panelPresentation`. Disabled only
          while the stored record is still being read, because a toggle before
          then would be a choice made against preferences nobody has seen. */}
      <button type="button" className="secondary-button" aria-expanded={rosterOpen} aria-controls="workbench-roster" disabled={panels.busy} onClick={() => panels.toggle("roster")}>{t("rosterToggle")}</button>
      <button type="button" className="secondary-button" aria-expanded={detailsOpen} aria-controls="workbench-inspector" disabled={panels.busy || !detailsAvailable} title={detailsAvailable ? undefined : t("inspectorUnavailable")} onClick={() => panels.toggle("details")}>{t("inspectorToggle")}</button>
      {resettable ? <button type="button" className="secondary-button" data-layout-reset="" disabled={panels.busy} onClick={panels.reset}>{t("layoutReset")}</button> : null}
      <SettingsDialog rowCount={rowCount} />
    </div>
    {/* The arrangement is on screen either way; what this says is that it will
        not survive a restart, and offers the one action that could change that.
        Never an alert: nothing is wrong with the workspace. */}
    {unsaved ? <p className="workspace-layout-unsaved" role="status" data-layout-unsaved="">
      <span>{t("layoutUnsaved")}</span>
      {panels.save.retryable ? <button type="button" className="link-button" onClick={panels.retry}>{t("layoutRetry")}</button> : null}
    </p> : null}
    <p className="workspace-drop-hint">{t(dropStatus === "available" ? "shellDropHint" : dropStatus === "connecting" ? "shellDropConnecting" : "shellDropUnavailable")}</p>
  </header>;
}
