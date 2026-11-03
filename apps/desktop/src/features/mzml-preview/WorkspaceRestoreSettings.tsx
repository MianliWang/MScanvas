import { useId } from "react";

import { SettingField } from "../../components/fields/SettingField";
import { Button, SegmentedControl } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { explainUnavailableProblem } from "../preferences/storageMessages";
import type { WorkspaceRestoreSession } from "./useWorkspaceRestore";
import { documentIsKept, explainRefusedDocument, explainRestoreProblem, problemIsRetryable } from "./WorkspaceRestoreNotice";

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
  const { reading, work, problem } = session;
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
  const on = read?.outcome === "restored";
  const kept = read?.outcome === "refused" && documentIsKept(read.problem);
  const refused = read === null || work !== null || kept;
  // Every write is refused while a document that may only be unreadable for now
  // is kept, so the choices say why instead of accepting a press (decision 6).
  const reasonId = read === null ? noteId : kept ? noteId : undefined;
  const leftovers = read === null ? 0 : read.leftoverCopies;

  return <>
    <h3 className="settings-section-title">{t("restoreSection")}</h3>
    <SettingField labelId={switchId} label={t("restoreSwitch")}>
      <SegmentedControl labelledBy={switchId} value={on ? "on" : "off"} reasonId={reasonId}
        options={[{ value: "on", refused, label: <span data-setting-value="restore-on">{t("restoreSwitchOn")}</span> },
          { value: "off", refused, label: <span data-setting-value="restore-off">{t("restoreSwitchOff")}</span> }]}
        onChange={(next) => session.setEnabled(next === "on")} />
    </SettingField>
    <SettingField labelId={freshId} label={t("restoreRemembered")} help={read?.outcome === "off" ? t("restoreRememberedOff") : undefined}>
      <Button size="sm" data-restore-settings-clear="" refused={refused || read?.outcome === "off"} reasonId={reasonId ?? `${freshId}-help`}
        onClick={session.startFresh}>{t("restoreStartFresh")}</Button>
    </SettingField>
    {reading.status === "loading" || reading.status === "idle" ? <div className="settings-storage-note" role="status" id={noteId} data-restore-settings="loading">
      <p>{t("restoreLoading")}</p>
    </div> : null}
    {reading.status === "failed" ? <div className="settings-storage-problem" role="alert" id={noteId} data-restore-settings="read-failed">
      <p><strong>{t("restoreReadFailed")}</strong></p>
      <div className="settings-storage-actions"><Button size="sm" refused={work !== null} onClick={session.retryRead}>{t("restoreTryAgain")}</Button></div>
    </div> : null}
    {read?.outcome === "refused" ? <div className="settings-storage-problem" role="alert" id={noteId} data-restore-settings="refused">
      <p><strong>{t("restoreRefusedTitle")}</strong></p>
      <p>{explainRefusedDocument(read.problem, t)}</p>
      {kept ? null : <p>{t("restoreRefusedKeepsAside")}</p>}
    </div> : null}
    {leftovers === 0 ? null : <div className="settings-storage-note" role="status" data-restore-settings="leftovers">
      <p>{t("restoreLeftovers", { count: leftovers })}</p>
    </div>}
    {problem === null ? null : <div className="settings-storage-problem" role="alert" data-restore-settings="problem">
      <p><strong>{explainRestoreProblem(problem, t).title}</strong></p>
      <p>{explainRestoreProblem(problem, t).detail}</p>
      {problemIsRetryable(problem) ? <div className="settings-storage-actions">
        <Button size="sm" refused={work !== null} onClick={session.retry}>{t("restoreTryAgain")}</Button>
      </div> : null}
    </div>}
  </>;
}
