import { Fragment, useId } from "react";

import { SettingField } from "../../components/fields/SettingField";
import { Button, SegmentedControl } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { explainUnavailableProblem } from "../preferences/storageMessages";
import { ownedErrorMessage } from "./ownedErrorMessages";
import type { RestoreProblem, WorkspaceRestoreSession } from "./useWorkspaceRestore";
import { documentIsKept, explainRefusedDocument, explainRestoreProblem, problemIsRetryable, useSlowly } from "./WorkspaceRestoreNotice";

/**
 * The restore switch and Start fresh (ADR 0061, decision 8). Each applies at
 * once, like every other setting. Where restore can be turned off, the copies
 * neither action removes are said to remain (question 5).
 */
export function WorkspaceRestoreSettings({ session }: { readonly session: WorkspaceRestoreSession }) {
  const t = useUiMessages();
  const switchId = useId();
  const freshId = useId();
  const noteId = useId();
  const workId = useId();
  const { reading, work, problem, stopped, failed } = session;
  const slowWork = useSlowly(work !== null);
  const read = reading.status === "ready" ? reading.read : null;
  if (read?.outcome === "unavailable") {
    return <>
      <h3 className="settings-section-title">{t("restoreSection")}</h3>
      <div className="settings-storage-note" role="status" data-restore-settings="unavailable">
        <p>{t("restoreUnavailable")}</p>
        <p>{explainUnavailableProblem(read.problem, t)}</p>
      </div>
    </>;
  }
  // Before an answer the switch's state is not known, so neither choice is shown as made.
  const state = read === null ? "unknown" : read.outcome === "restored" ? "on" : "off";
  const kept = read?.outcome === "refused" && documentIsKept(read.problem);
  const refused = read === null || work !== null || kept;
  // Every write is refused while a document that may only be unreadable for now
  // is kept, so the choices say why instead of accepting a press (decision 6).
  const reasonId = work !== null ? workId : read === null || kept ? noteId : undefined;
  const leftovers = read === null ? 0 : read.leftoverCopies;
  // A clear of what is live now would be written again at once.
  const nothingWaiting = read?.outcome === "restored" && read.expired === 0 && read.groups.every(group => group.rows.length === 0);
  const freshHelp = read?.outcome === "off" ? t("restoreRememberedOff") : nothingWaiting ? t("restoreNothingWaiting") : undefined;

  const problemNote = (shown: RestoreProblem | null, kind: "stopped" | "problem" | "action", retry: () => void) => {
    if (shown === null) return null;
    const { title, detail } = explainRestoreProblem(shown, t);
    return <div className="settings-storage-problem" role="alert" data-restore-settings={kind}>
      <p><strong>{title}</strong></p>
      <p>{detail}</p>
      {problemIsRetryable(shown) ? <div className="settings-storage-actions">
        <Button size="sm" refused={work !== null} reasonId={workId} onClick={retry}>{t("restoreTryAgain")}</Button>
      </div> : null}
    </div>;
  };

  return <>
    <h3 className="settings-section-title">{t("restoreSection")}</h3>
    <SettingField labelId={switchId} label={t("restoreSwitch")}>
      <SegmentedControl labelledBy={switchId} value={state} reasonId={reasonId}
        options={[{ value: "on", refused, label: <span data-setting-value="restore-on">{t("restoreSwitchOn")}</span> },
          { value: "off", refused, label: <span data-setting-value="restore-off">{t("restoreSwitchOff")}</span> }]}
        onChange={(next) => session.setEnabled(next === "on")} />
    </SettingField>
    <SettingField labelId={freshId} label={t("restoreRemembered")} help={freshHelp}>
      <Button size="sm" data-restore-settings-clear="" refused={refused || freshHelp !== undefined} reasonId={reasonId ?? `${freshId}-help`}
        onClick={session.startFresh}>{t("restoreStartFresh")}</Button>
    </SettingField>
    {/* The notice behind this modal is aria-hidden, so the dialog says it here.
        Mounted empty, so a press that empties the list is heard. */}
    <p aria-live="polite" className="visually-hidden" data-live-region="settings-restore">{nothingWaiting ? t("restoreNothingWaiting") : ""}</p>
    {work === null ? null : <div id={workId} className={slowWork ? "settings-storage-note" : "visually-hidden"} data-restore-settings="working">
      <p>{t("restoreBusy")}</p>
    </div>}
    {reading.status === "loading" || reading.status === "idle" ? <div className="settings-storage-note" role="status" id={noteId} data-restore-settings="loading">
      <p>{t(reading.status === "idle" ? "restoreWaitingForList" : "restoreLoading")}</p>
    </div> : null}
    {reading.status === "failed" ? <div className="settings-storage-problem" role="alert" id={noteId} data-restore-settings="read-failed">
      <p><strong>{t("restoreReadFailed")}</strong></p>
      <p>{ownedErrorMessage(reading.error, t)}</p>
      <div className="settings-storage-actions"><Button size="sm" refused={work !== null} reasonId={workId} onClick={session.retryRead}>{t("restoreTryAgain")}</Button></div>
    </div> : null}
    {read?.outcome === "refused" ? <div className="settings-storage-problem" role="alert" id={noteId} data-restore-settings="refused">
      <p><strong>{t("restoreRefusedTitle")}</strong></p>
      <p>{explainRefusedDocument(read.problem, t)}</p>
      {kept ? null : <p>{t("restoreRefusedKeepsAside")} {t("restoreRefusedStartFreshReplaces")}</p>}
    </div> : null}
    {leftovers === 0 ? null : <div className="settings-storage-note" role="status" data-restore-settings="leftovers">
      <p>{t("restoreLeftovers", { count: leftovers })}</p>
    </div>}
    {problemNote(stopped, "stopped", session.retry)}
    {failed.map((failure, at) => <Fragment key={at}>{problemNote(failure.problem, "action", failure.again)}</Fragment>)}
    {problemNote(problem, "problem", session.retry)}
  </>;
}
