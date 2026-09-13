import { motion, useReducedMotion } from "motion/react";
import { SettingsDialog } from "../preferences/SettingsDialog";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";

export type WorkbenchSurface = "workbench" | "conversion";
export function WorkbenchHeader({ surface, onNavigate, rosterOpen, onToggleRoster, detailsOpen, onToggleDetails, rowCount, busy, retained, dropStatus }: {
  readonly surface: WorkbenchSurface; readonly onNavigate: (surface: WorkbenchSurface) => void;
  readonly rosterOpen: boolean; readonly onToggleRoster: () => void;
  readonly detailsOpen: boolean; readonly onToggleDetails: () => void;
  readonly rowCount: number; readonly busy: boolean; readonly retained: boolean; readonly dropStatus: "available" | "connecting" | "unavailable";
}) {
  const t = useUiMessages(), reduced = useReducedMotion();
  return <header className="topbar workbench-header">
    <button type="button" className="workbench-home" aria-label={t("home")} onClick={() => onNavigate("workbench")}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M3 22h22M5 20v-5m4 5V9m5 11V3m5 17v-8m4 8v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <strong>MSCanvas</strong>
    </button>
    <nav className="workbench-navigation" aria-label={t("navigation")}>
      {(["workbench", "conversion"] as const).map(target => <button type="button" key={target} aria-current={surface === target ? "page" : undefined} onClick={() => onNavigate(target)}>
        {t(target === "workbench" ? "workbench" : "conversionTask")}
        {target === "conversion" && (busy || retained) ? <span className="work-status-dot" aria-label={t(busy ? "workActive" : "workRetained")} /> : null}
        <motion.span className="navigation-underline" aria-hidden="true" animate={{ opacity: surface === target ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.14 }} />
      </button>)}
    </nav>
    <div className="workbench-global-actions">
      <button type="button" className="secondary-button" aria-expanded={rosterOpen} aria-controls="workbench-roster" onClick={onToggleRoster}>{t("rosterToggle")}</button>
      <button type="button" className="secondary-button" aria-expanded={detailsOpen} aria-controls="workbench-inspector" onClick={onToggleDetails}>{t("inspectorToggle")}</button>
      <SettingsDialog rowCount={rowCount} />
    </div>
    <p className="workspace-drop-hint">{t(dropStatus === "available" ? "shellDropHint" : dropStatus === "connecting" ? "shellDropConnecting" : "shellDropUnavailable")}</p>
  </header>;
}
