import { useLayoutEffect, useRef, useState } from "react";

import { Button, Icon, IconButton } from "../../components/ui";
import type { MessageKey, UiMessage } from "../preferences/i18n";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { STATUS_BUSY_ID } from "../workbench/StatusBar";
import type { RestoredRowState } from "./contracts";
import { ownedErrorMessage } from "./ownedErrorMessages";
import { markedRows, offeredRows, type RestoreProblem, type WorkspaceRestoreSession } from "./useWorkspaceRestore";

const ROW_REASON = {
  changed: "restoreStateChanged",
  missing: "restoreStateMissing",
  unreachable: "restoreStateUnreachable",
  unreadable: "restoreStateUnreadable",
  unsafe: "restoreStateUnsafe",
} as const satisfies Record<Exclude<RestoredRowState, "matching">, MessageKey>;

const WRITE_PROBLEM = {
  changedElsewhere: "restoreProblemChangedElsewhere",
  identityUnknown: "restoreProblemIdentityUnknown",
  tooManyRows: "restoreProblemTooManyRows",
  staleArrangement: "restoreProblemStaleArrangement",
  invalidArrangement: "restoreProblemInvalidArrangement",
  notStorable: "restoreProblemNotStorable",
  storedDocumentKept: "restoreProblemStoredDocumentKept",
  directoryUnusable: "restoreProblemDirectoryUnusable",
  notWritten: "restoreProblemNotWritten",
  notPublished: "restoreProblemNotPublished",
  oversized: "restoreProblemOversized",
  unsafeTarget: "restoreProblemUnsafeTarget",
} as const satisfies Record<string, MessageKey>;

const REFUSED_DOCUMENT = {
  malformed: "restoreRefusedMalformed",
  newerVersion: "restoreRefusedNewerVersion",
  unsupportedVersion: "restoreRefusedUnsupportedVersion",
  oversized: "restoreRefusedOversized",
  unreadable: "restoreRefusedUnreadable",
  unsafeTarget: "restoreRefusedUnsafeTarget",
} as const satisfies Record<string, MessageKey>;

/** A code this build does not know is shown, not swallowed. */
function lookUp(table: Readonly<Record<string, MessageKey>>, code: string, t: UiMessage): string {
  const key = Object.hasOwn(table, code) ? table[code] : undefined;
  return key === undefined ? t("restoreProblemUnknown", { code }) : t(key);
}

/** Why a stored record was not used. */
export const explainRefusedDocument = (code: string, t: UiMessage) => lookUp(REFUSED_DOCUMENT, code, t);

/** The two document problems nothing may replace this session (ADR 0061, decision 6). */
export const documentIsKept = (code: string) => code === "unreadable" || code === "unsafeTarget";

/** The heading and the sentences of one problem, for the notice and for Settings alike. */
export function explainRestoreProblem(problem: RestoreProblem, t: UiMessage): { readonly title: string; readonly detail: string } {
  if (problem.kind === "error") return { title: t("restoreNotRecorded"), detail: ownedErrorMessage(problem.error, t) };
  if (problem.kind === "turnedOff") return { title: t("restoreTurnedOff"), detail: lookUp(WRITE_PROBLEM, problem.problem, t) };
  const detail = lookUp(WRITE_PROBLEM, problem.problem, t);
  return { title: t("restoreNotRecorded"), detail: problem.temporaryLeftBehind ? `${detail} ${t("restoreProblemTemporaryLeft")}` : detail };
}

/** Whether Try again can do anything about this problem. */
export function problemIsRetryable(problem: RestoreProblem): boolean {
  return problem.kind === "error" ? problem.error.retryable : problem.kind === "write" && problem.retryable;
}

/** The one sentence the restore live region says, mounted for the life of the page. */
export function announceRestore(session: WorkspaceRestoreSession, t: UiMessage): string {
  if (session.problem !== null) return explainRestoreProblem(session.problem, t).detail;
  if (session.reading.status !== "ready" || session.reading.read.outcome !== "restored") return "";
  const offered = offeredRows(session.reading.read.groups).length;
  const marked = markedRows(session.reading.read.groups).length;
  return offered > 0 ? t("restoreOffer", { count: offered }) : marked > 0 ? t("restoreAttention", { count: marked }) : "";
}

/**
 * What the start-up read found, above every surface (ADR 0061): how many rows
 * can come back, the marked rows with their reasons, and why this session is
 * not being recorded. Above the surfaces because the roster is a closed drawer
 * in a narrow window. Rows change nothing until Restore workspace is pressed.
 */
export function WorkspaceRestoreNotice({ session, canRestore, reason }: {
  readonly session: WorkspaceRestoreSession;
  /** The same answer `Add files…` gets: put-back admits like it. */
  readonly canRestore: boolean;
  /** Why it waits, said beside it while it is refused, as the roster says it for Add files. */
  readonly reason: string | null;
}) {
  const t = useUiMessages();
  const { reading, work, problem } = session;
  const restored = reading.status === "ready" && reading.read.outcome === "restored" ? reading.read : null;
  const offered = restored === null ? [] : offeredRows(restored.groups);
  const marked = restored === null ? [] : markedRows(restored.groups);
  const expired = restored === null || session.expiredDismissed ? 0 : restored.expired;

  /** A press whose button is about to leave: where the keyboard goes when it does. */
  const owed = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);
  const owePlace = (event: { readonly currentTarget: HTMLElement }) => {
    if (document.activeElement === event.currentTarget) owed.current = true;
  };
  useLayoutEffect(() => {
    if (!owed.current || work !== null) return;
    owed.current = false;
    if (document.activeElement !== document.body && document.activeElement !== null) return;
    const next = root.current?.querySelector<HTMLElement>("[data-restore-dismiss]") ?? root.current?.querySelector<HTMLElement>("button") ?? document.querySelector<HTMLElement>("[data-settings-return-target]");
    next?.focus({ preventScroll: true });
  });

  // The read is usually done before anything could be painted. A drive that
  // does not answer can hold it for an OS timeout, and then it is worth a line.
  const [slow, setSlow] = useState(false);
  const loading = reading.status === "loading";
  useLayoutEffect(() => {
    if (!loading) { setSlow(false); return; }
    const timer = window.setTimeout(() => setSlow(true), 400);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const [refusedDismissed, setRefusedDismissed] = useState(false);
  const refusedProblem = reading.status === "ready" && reading.read.outcome === "refused" && !refusedDismissed ? reading.read.problem : null;
  const restoreRefused = !canRestore || work !== null;
  const restoreReasonShown = !canRestore && reason !== null;
  const startFreshRefused = work !== null;
  const offerShown = offered.length > 0 || marked.length > 0;
  const tooMany = problem?.kind === "write" && problem.problem === "tooManyRows";

  return <>
    {slow ? <div className="notice notice-neutral" data-restore="loading"><span>{t("restoreLoading")}</span></div> : null}

    {reading.status === "failed" ? <div className="notice notice-danger" role="status" data-restore="read-failed">
      <strong>{t("restoreReadFailed")}</strong>
      <span>{ownedErrorMessage(reading.error, t)}</span>
      <Button variant="secondary" size="sm" refused={work !== null} reasonId={STATUS_BUSY_ID} onClick={session.retryRead}>{t("restoreTryAgain")}</Button>
    </div> : null}

    {refusedProblem === null ? null : <div className="notice notice-warning" data-restore="refused">
      <strong>{t("restoreRefusedTitle")}</strong>
      <span>{explainRefusedDocument(refusedProblem, t)}</span>
      <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={() => setRefusedDismissed(true)} />
    </div>}

    {problem === null ? null : <div className="notice notice-warning" data-restore="problem">
      <strong>{explainRestoreProblem(problem, t).title}</strong>
      <span>{explainRestoreProblem(problem, t).detail}</span>
      {problemIsRetryable(problem) ? <Button variant="secondary" size="sm" refused={work !== null} reasonId={STATUS_BUSY_ID} onClick={session.retry} data-restore-retry="">{t("restoreTryAgain")}</Button> : null}
      {/* Fail closed (question 9): the way out is the user's, and it is here. */}
      {tooMany && !offerShown ? <Button variant="secondary" size="sm" refused={startFreshRefused} reasonId={STATUS_BUSY_ID} onClick={session.startFresh} data-restore-start-fresh="">{t("restoreStartFresh")}</Button> : null}
    </div>}

    {!offerShown && expired === 0 ? null : <div className="notice notice-neutral restore-notice" data-restore="offer" ref={root}>
      {offered.length > 0 ? <span>{work === "restoring" ? t("restoreWorking", { count: offered.length }) : t("restoreOffer", { count: offered.length })}</span>
        : marked.length > 0 ? <span>{t("restoreAttention", { count: marked.length })}</span> : null}
      {expired > 0 ? <span data-restore-expired="">{t("restoreExpired", { count: expired })}</span> : null}
      {offered.length > 0 ? <Button variant="secondary" size="sm" data-restore-action="" refused={restoreRefused} reasonId={restoreReasonShown ? "restore-reason" : STATUS_BUSY_ID}
        aria-busy={work === "restoring"} onClick={(event) => { owePlace(event); session.restore(); }}>{t("restoreAction")}</Button> : null}
      {offerShown ? <Button variant="secondary" size="sm" data-restore-start-fresh="" refused={startFreshRefused} reasonId={STATUS_BUSY_ID}
        onClick={(event) => { owePlace(event); session.startFresh(); }}>{t("restoreStartFresh")}</Button> : null}
      {offered.length > 0 && restoreReasonShown ? <span id="restore-reason" className="restore-reason">{reason}</span> : null}
      {!offerShown ? <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={(event) => { owePlace(event); session.dismissExpired(); }} /> : null}
      {marked.length === 0 ? null : <ul className="restore-marked">
        {marked.map(row => {
          const name = row.context === null ? row.displayName : `${row.displayName}, ${row.context}`;
          return <li key={row.handle} data-restored-row={row.handle} data-state={row.state}>
            <IconButton size="sm" icon={<Icon name="close" size={13} />} label={t("restoreDismissNamed", { name })} refused={work !== null} reasonId={STATUS_BUSY_ID}
              onClick={(event) => { owePlace(event); session.dismissRow(row.handle); }} data-restore-dismiss="" />
            <span className="restore-marked-name">{name}</span>
            {row.group === null ? null : <span className="restore-marked-group">{row.group}</span>}
            <span className="restore-marked-reason">{t(ROW_REASON[row.state])}</span>
          </li>;
        })}
      </ul>}
    </div>}
  </>;
}
