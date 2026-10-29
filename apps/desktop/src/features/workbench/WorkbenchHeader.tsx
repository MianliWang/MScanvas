import * as Menu from "@radix-ui/react-dropdown-menu";

import { Button, Icon } from "../../components/ui";
import { SettingsDialog } from "../preferences/SettingsDialog";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";
import { busyKey } from "../project/ProjectPanel";
import type { ProjectSession } from "../project/useProject";

export type WorkbenchSurface = "workbench" | "conversion" | "project";

const ROSTER_REASON_ID = "header-roster-reason";
const DETAILS_REASON_ID = "header-details-reason";
const PROJECT_MENU_STATUS_ID = "project-menu-status";

/**
 * The one header row: the brand, the two task tabs, the Project menu, the two
 * panel toggles and Settings (rebuild spec 1.1, 2.2). What the session is
 * doing is the status bar's; nothing here changes height.
 */
export function WorkbenchHeader({ surface, onNavigate, detailsAvailable, conversionBusy, conversionRetained, project }: {
  readonly surface: WorkbenchSurface;
  readonly onNavigate: (surface: WorkbenchSurface) => void;
  readonly detailsAvailable: boolean;
  readonly conversionBusy: boolean;
  readonly conversionRetained: boolean;
  /** The project session the Project menu acts on. */
  readonly project: ProjectSession;
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

  const { state, busy } = project;
  const working = busy !== "idle";
  const busyText = busyKey(busy);
  /**
   * The menu's actions are the Project surface's own, refused for the same
   * reasons. Each also shows that surface, because an unsaved-changes question,
   * a refusal or the opened project appears only there.
   */
  const actions = [
    { id: "new", label: t("projectNew"), refused: working, run: () => project.createProject(t("projectDefaultName")) },
    { id: "open", label: t("projectOpen"), refused: working, run: project.openProject },
    { id: "save", label: t("projectSave"), refused: working || !state.open || !state.published, run: project.saveProject },
    { id: "saveAs", label: t("projectSaveAs"), refused: working || !state.open, run: project.saveProjectAs },
    { id: "close", label: t("projectClose"), refused: working || !state.open, run: project.closeProject },
  ] as const;

  return <header className="topbar workbench-header">
    <button type="button" className="workbench-home" aria-label={t("home")} onClick={() => go("workbench")}>
      <span className="workbench-mark" aria-hidden="true"><Icon name="wave" size={20} /></span>
      <strong>MSCanvas</strong>
    </button>
    <nav className="workbench-navigation" aria-label={t("navigation")}>
      {(["workbench", "conversion"] as const).map(target => <button type="button" key={target}
        aria-current={surface === target ? "page" : undefined} onClick={() => go(target)}>
        {t(target === "workbench" ? "workbench" : "conversionTask")}
        {target === "conversion" && (conversionBusy || conversionRetained)
          ? <span className="work-status-dot" aria-label={t(conversionBusy ? "workActive" : "workRetained")} /> : null}
      </button>)}
    </nav>
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="quiet" size="sm" className="workbench-project-trigger" data-project-menu=""
          aria-current={surface === "project" ? "page" : undefined} icon={<Icon name="layers" />}>
          {t("projectSurface")}
          {/* Visual only: the status bar says what the project is doing, and a
              name added here would change the trigger's accessible name. */}
          {working ? <span className="project-work-dot" aria-hidden="true" data-project-work-dot="" /> : null}
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="roster-menu project-menu" align="start" sideOffset={4}>
          {/* What the project is, and so why an action below is refused. */}
          <p id={PROJECT_MENU_STATUS_ID} className="project-menu-status">
            {busyText !== null ? t(busyText as "projectBusySaving")
              : !state.open ? t("projectNone")
              : <>
                <strong>{state.name}</strong>
                {state.dirty ? <span className="status-tag">{t("statusUnsaved")}</span> : null}
                {state.published ? null : <span>{t("projectSaveNeedsLocation")}</span>}
              </>}
          </p>
          <Menu.Item data-project-menu-item="surface" onSelect={() => go("project")}>{t("projectMenuShow")}</Menu.Item>
          <Menu.Separator />
          {actions.map(action => <Menu.Item key={action.id} data-project-menu-item={action.id}
            aria-disabled={action.refused || undefined}
            aria-describedby={action.refused ? PROJECT_MENU_STATUS_ID : undefined}
            onSelect={event => {
              // Refused, not disabled: it stays reachable with its reason, and
              // the menu stays open on it.
              if (action.refused) { event.preventDefault(); return; }
              go("project");
              void action.run();
            }}>{action.label}</Menu.Item>)}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
    <div className="workbench-global-actions">
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
