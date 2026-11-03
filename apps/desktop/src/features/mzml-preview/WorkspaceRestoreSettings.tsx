import { Fragment, useCallback, useId, useLayoutEffect, useRef } from "react";

import { SettingField } from "../../components/fields/SettingField";
import { Button, SegmentedControl } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { explainUnavailableProblem } from "../preferences/storageMessages";
import { ownedErrorMessage } from "./ownedErrorMessages";
import type { RestoreProblem, WorkspaceRestoreSession } from "./useWorkspaceRestore";
import { documentIsKept, explainRefusedDocument, explainRestoreProblem, place, problemIsRetryable } from "./WorkspaceRestoreNotice";

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
  const { reading, work, slowWork, problem, stopped, failed } = session;
  const read = reading.status === "ready" ? reading.read : null;

  const switchRef = useRef<HTMLDivElement | null>(null);
  const answersRef = useRef<HTMLDivElement | null>(null);
  const unavailableRef = useRef<HTMLDivElement | null>(null);

  /** What this section says, in view in a short window, without moving the keyboard. */
  const reveal = useCallback(() => {
    if (!answersRef.current?.hasChildNodes()) return;
    answersRef.current.scrollIntoView?.({ block: "nearest" });
    document.activeElement?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const answers = failed.length;
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current) reveal();
    opened.current = true;
  }, [answers, problem, reveal, slowWork, stopped, work]);

  /** A Try again about to leave: the keyboard goes to this section, not back to the dialog's top. */
  const owed = useRef(false);
  const owePlace = (event: { readonly currentTarget: HTMLElement }) => {
    if (document.activeElement === event.currentTarget) owed.current = true;
  };
  useLayoutEffect(() => {
    if (!owed.current || work !== null) return;
    owed.current = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !active.matches("[data-settings-dialog]")) return;
    place(switchRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? unavailableRef.current);
  });

  if (read?.outcome === "unavailable") {
    return <>
      <h3 className="settings-section-title">{t("restoreSection")}</h3>
      <div className="settings-storage-note" role="status" data-restore-settings="unavailable" tabIndex={-1} ref={unavailableRef}>
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
    // Heard from the page's restore region (`announceRestore`), which no modal hides.
    return <div className="settings-storage-problem" data-restore-settings={kind}>
      <p><strong>{title}</strong></p>
      <p>{detail}</p>
      {problemIsRetryable(shown) ? <div className="settings-storage-actions">
        <Button size="sm" refused={work !== null} reasonId={workId} onClick={(event) => { owePlace(event); retry(); }}>{t("restoreTryAgain")}</Button>
      </div> : null}
    </div>;
  };

  return <>
    <h3 className="settings-section-title">{t("restoreSection")}</h3>
    <SettingField labelId={switchId} label={t("restoreSwitch")}>
      <div ref={switchRef} onFocus={reveal}>
        <SegmentedControl labelledBy={switchId} value={state} reasonId={reasonId}
          options={[{ value: "on", refused, label: <span data-setting-value="restore-on">{t("restoreSwitchOn")}</span> },
            { value: "off", refused, label: <span data-setting-value="restore-off">{t("restoreSwitchOff")}</span> }]}
          onChange={(next) => session.setEnabled(next === "on")} />
      </div>
    </SettingField>
    <SettingField labelId={freshId} label={t("restoreRemembered")} help={freshHelp}>
      <Button size="sm" data-restore-settings-clear="" refused={refused || freshHelp !== undefined} reasonId={reasonId ?? `${freshId}-help`}
        onFocus={reveal} onClick={session.startFresh}>{t("restoreStartFresh")}</Button>
    </SettingField>
    <div className="settings-restore-answers" ref={answersRef}>
      {work === null ? null : <div id={workId} className={slowWork ? "settings-storage-note" : "visually-hidden"} data-restore-settings="working">
        <p>{t("restoreBusy")}</p>
      </div>}
      {reading.status === "loading" || reading.status === "idle" ? <div className="settings-storage-note" role="status" id={noteId} data-restore-settings="loading">
        <p>{t(reading.status === "idle" ? "restoreWaitingForList" : "restoreLoading")}</p>
      </div> : null}
      {reading.status === "failed" ? <div className="settings-storage-problem" role="alert" id={noteId} data-restore-settings="read-failed">
        <p><strong>{t("restoreReadFailed")}</strong></p>
        <p>{ownedErrorMessage(reading.error, t)}</p>
        <div className="settings-storage-actions"><Button size="sm" refused={work !== null} reasonId={workId} onClick={(event) => { owePlace(event); session.retryRead(); }}>{t("restoreTryAgain")}</Button></div>
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
    </div>
  </>;
}
