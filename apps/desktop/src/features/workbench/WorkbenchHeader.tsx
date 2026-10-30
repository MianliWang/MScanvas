import { Button, Icon } from "../../components/ui";
import { SettingsDialog } from "../preferences/SettingsDialog";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";

export type WorkbenchSurface = "workbench" | "conversion" | "project";

const ROSTER_REASON_ID = "header-roster-reason";
const DETAILS_REASON_ID = "header-details-reason";
const SURFACES = ["workbench", "conversion", "project"] as const;

/**
 * The one header row (direction A, 2.1): the brand, three destinations in one
 * tab style, then Acquisitions, Details and Settings…. What the session is
 * doing is the status bar's; nothing here changes width when work starts or
 * stops.
 */
export function WorkbenchHeader({ surface, onNavigate, detailsAvailable, conversionBusy, conversionRetained, projectBusy }: {
  readonly surface: WorkbenchSurface;
  readonly onNavigate: (surface: WorkbenchSurface) => void;
  readonly detailsAvailable: boolean;
  readonly conversionBusy: boolean;
  readonly conversionRetained: boolean;
  /** A project operation is under way; the Project tab carries a dot. */
  readonly projectBusy: boolean;
}) {
  const t = useUiMessages();
  const { panels } = useSessionPreferences();
  /**
   * The one way the header changes surface. Each target changes the surface and
   * lets the panels fold for it; none starts work or resets a selection.
   */
  const go = (target: WorkbenchSurface) => { onNavigate(target); panels.navigate(); };
  const rosterOpen = panels.present.roster;
  const detailsOpen = panels.present.details && detailsAvailable;
  const loading = panels.busy ? t("panelsLoading") : null;
  /**
   * Refused rather than disabled (UI-24): Details is closed by default below
   * 1700 px, so its entry stays a Tab stop in every state and says why it
   * cannot open, in the terms of the surface it is on.
   */
  const detailsReason = loading ?? (detailsAvailable ? null : t(surface === "project" ? "provenanceNothingSelected" : "inspectorUnavailable"));

  return <header className="topbar workbench-header">
    <button type="button" className="workbench-home" aria-label={t("home")} onClick={() => go("workbench")}>
      <span className="workbench-mark" aria-hidden="true"><Icon name="wave" size={20} /></span>
      <strong>MSCanvas</strong>
    </button>
    <nav className="workbench-navigation" aria-label={t("navigation")}>
      {SURFACES.map(target => <button type="button" key={target} data-surface-tab={target}
        aria-current={surface === target ? "page" : undefined} onClick={() => go(target)}>
        {t(target === "workbench" ? "workbench" : target === "conversion" ? "conversionTask" : "projectSurface")}
        {/* In the tab's own padding, out of flow: a dot that comes and goes
            never moves the tabs after it (rendered review, issue 6). */}
        {target === "conversion" && (conversionBusy || conversionRetained)
          ? <span className="work-status-dot" aria-label={t(conversionBusy ? "workActive" : "workRetained")} /> : null}
        {/* Visual only: the status bar says what the project is doing. */}
        {target === "project" && projectBusy
          ? <span className="work-status-dot" aria-hidden="true" data-project-work-dot="" /> : null}
      </button>)}
    </nav>
    <div className="workbench-global-actions">
      {/* At every width: below 1050 px it opens the roster's drawer, and above
          it folds a column the stored layout remembers (Settings resets it). */}
      <Button variant="quiet" size="sm" icon={<Icon name="panelLeft" />} aria-expanded={rosterOpen} aria-controls="workbench-roster"
        refused={panels.busy} reasonId={ROSTER_REASON_ID} title={loading ?? undefined}
        onClick={() => panels.toggle("roster")}>{t("rosterToggle")}</Button>
      {loading === null ? null : <span id={ROSTER_REASON_ID} className="visually-hidden">{loading}</span>}
      <Button variant="quiet" size="sm" icon={<Icon name="panelRight" />} aria-expanded={detailsOpen} aria-controls="workbench-inspector"
        refused={detailsReason !== null} reasonId={DETAILS_REASON_ID} title={detailsReason ?? undefined}
        onClick={() => panels.toggle("details")}>{t("inspectorToggle")}</Button>
      {detailsReason === null ? null : <span id={DETAILS_REASON_ID} className="visually-hidden">{detailsReason}</span>}
      <SettingsDialog />
    </div>
    {/* Mounted from the first render and empty until there is something to
        say: a region that arrives with its text already in it is the one
        mutation screen readers do not announce. */}
    <p aria-live="polite" className="visually-hidden" data-live-region="layout">
      {panels.announcement === null
        ? ""
        : t(panels.announcement === "reset" ? "layoutResetDone"
          : panels.announcement === "uncertain" ? "layoutUncertain" : "layoutUnsaved")}
    </p>
  </header>;
}
