import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { Button, Icon, IconButton, Toolbar } from "../../components/ui";
import type { MessageKey, UiMessage } from "../preferences/i18n";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { explainUnavailableProblem } from "../preferences/storageMessages";
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

/**
 * A clear that found the record not as this window left it: it has been emptied
 * and restore is off, the opposite of a save's refusal, which wrote nothing.
 * `changedElsewhere` latches for the session in Rust, so only a restart can turn
 * restore on again; `identityUnknown` latches nothing.
 */
const TURNED_OFF = {
  changedElsewhere: "restoreTurnedOffChangedElsewhere",
  identityUnknown: "restoreTurnedOffIdentityUnknown",
} as const satisfies Record<string, MessageKey>;

const REFUSED_DOCUMENT = {
  malformed: "restoreRefusedMalformed",
  newerVersion: "restoreRefusedNewerVersion",
  unsupportedVersion: "restoreRefusedUnsupportedVersion",
  oversized: "restoreRefusedOversized",
  unreadable: "restoreRefusedUnreadable",
  unsafeTarget: "restoreRefusedUnsafeTarget",
} as const satisfies Record<string, MessageKey>;

/** The visible line the restore actions' refusals point at while one of them runs. */
const WORK_ID = "restore-work";

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
  if (problem.kind === "error") return { title: t(problem.action === true ? "restoreNotChanged" : "restoreNotRecorded"), detail: ownedErrorMessage(problem.error, t) };
  if (problem.kind === "turnedOff") return { title: t("restoreTurnedOff"), detail: lookUp(TURNED_OFF, problem.problem, t) };
  // As an action's answer this is a turn on refused, and the record it finds may
  // be this window's own: a clear can have ended the other window's.
  const detail = problem.action === true && problem.problem === "changedElsewhere" ? t("restoreTurnOnChangedElsewhere") : lookUp(WRITE_PROBLEM, problem.problem, t);
  return { title: t(problem.action === true ? "restoreNotChanged" : "restoreNotRecorded"), detail: problem.temporaryLeftBehind ? `${detail} ${t("restoreProblemTemporaryLeft")}` : detail };
}

/** Whether Try again can do anything about this problem. */
export function problemIsRetryable(problem: RestoreProblem): boolean {
  return problem.kind === "error" ? problem.error.retryable : problem.kind === "write" && problem.retryable;
}

/** The sentences the restore live region says, mounted for the life of the page. */
export function announceRestore(session: WorkspaceRestoreSession, t: UiMessage): string {
  const problem = session.failed.at(-1)?.problem ?? session.problem ?? session.stopped;
  if (problem !== null) {
    const { title, detail } = explainRestoreProblem(problem, t);
    return `${title} ${detail}`;
  }
  const { reading } = session;
  if (reading.status === "failed") return `${t("restoreReadFailed")} ${ownedErrorMessage(reading.error, t)}`;
  if (reading.status !== "ready") return "";
  const { read } = reading;
  if (read.outcome === "refused") return `${t("restoreRefusedTitle")} ${explainRefusedDocument(read.problem, t)}`;
  if (read.outcome === "unavailable") return `${t("restoreUnavailable")} ${explainUnavailableProblem(read.problem, t)}`;
  if (read.outcome !== "restored") return "";
  const offered = offeredRows(read.groups).length;
  if (session.work === "restoring") return t("restoreWorking", { count: offered });
  const marked = markedRows(read.groups).length;
  const expired = session.expiredDismissed ? 0 : read.expired;
  return [offered > 0 ? t("restoreOffer", { count: offered }) : "",
    marked > 0 ? t("restoreAttention", { count: marked }) : "",
    expired > 0 ? t("restoreExpired", { count: expired }) : ""].filter(line => line !== "").join(" ");
}

/**
 * Whether `active` has lasted long enough to be worth a line. The usual answer
 * is back before anything could be painted, and then nothing moves under a key
 * pressed again; a drive that does not answer can hold one for an OS timeout.
 */
export function useSlowly(active: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useLayoutEffect(() => {
    if (!active) { setSlow(false); return; }
    const timer = window.setTimeout(() => setSlow(true), 400);
    return () => window.clearTimeout(timer);
  }, [active]);
  return slow;
}

/** Without the browser's own scroll on focus, which centres what it brings into view. */
function place(element: HTMLElement | null | undefined) {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView?.({ block: "nearest" });
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
  const { reading, work, problem, stopped } = session;
  const read = reading.status === "ready" ? reading.read : null;
  const restored = read?.outcome === "restored" ? read : null;
  const offered = restored === null ? [] : offeredRows(restored.groups);
  const marked = restored === null ? [] : markedRows(restored.groups);
  const expired = restored === null || session.expiredDismissed ? 0 : restored.expired;

  /**
   * A press whose button is about to leave, and the row it was on: where the
   * keyboard goes when it does. The same row, so a list dismissed from its middle
   * does not send the next Enter to a row off screen.
   */
  const owed = useRef<number | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const owePlace = (event: { readonly currentTarget: HTMLElement }, row = 0) => {
    if (document.activeElement === event.currentTarget) owed.current = row;
  };
  useLayoutEffect(() => {
    if (owed.current === null || work !== null) return;
    const row = owed.current;
    owed.current = null;
    if (document.activeElement !== document.body && document.activeElement !== null) return;
    const rows = root.current?.querySelectorAll<HTMLElement>("[data-restore-dismiss]");
    place((rows === undefined ? undefined : rows[Math.min(row, rows.length - 1)]) ?? root.current?.querySelector<HTMLElement>("button") ?? document.querySelector<HTMLElement>("[data-settings-return-target]"));
  });

  const slowRead = useSlowly(reading.status === "loading");
  const slowWork = useSlowly(work !== null);

  /** The refused or unavailable record's line, put away for this session. */
  const [readDismissed, setReadDismissed] = useState(false);
  const putAwayRead = (event: { readonly currentTarget: HTMLElement }) => { owePlace(event); setReadDismissed(true); };
  const restoreRefused = !canRestore || work !== null;
  const restoreReasonShown = work === null && !canRestore && reason !== null;
  const offerShown = offered.length > 0 || marked.length > 0;

  const problemNotice = (shown: RestoreProblem | null, kind: "stopped" | "problem" | "action", retry: () => void, putAway?: () => void) => {
    if (shown === null) return null;
    const { title, detail } = explainRestoreProblem(shown, t);
    const retryable = problemIsRetryable(shown);
    return <div className="notice notice-warning" data-restore={kind}>
      <strong>{title}</strong>
      <span>{detail}</span>
      {retryable ? <Button variant="secondary" size="sm" refused={work !== null} reasonId={WORK_ID} onClick={(event) => { owePlace(event); retry(); }} data-restore-retry="">{t("restoreTryAgain")}</Button> : null}
      {/* Fail closed (question 9): the way out is the user's, and it is here. */}
      {shown.kind === "write" && shown.problem === "tooManyRows" && !offerShown ? <Button variant="secondary" size="sm" refused={work !== null} reasonId={WORK_ID} onClick={(event) => { owePlace(event); session.startFresh(); }} data-restore-start-fresh="">{t("restoreStartFresh")}</Button> : null}
      {!retryable && putAway !== undefined ? <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={(event) => { owePlace(event); putAway(); }} /> : null}
    </div>;
  };

  return <>
    {slowRead ? <div className="notice notice-neutral" data-restore="loading"><span>{t("restoreLoading")}</span></div> : null}

    {/* There from the first moment, so a refusal never points at nothing. During
        a put-back the offer's own line says what is happening. */}
    {work === null || work === "restoring" ? null : <div id={WORK_ID} className={slowWork ? "notice notice-neutral" : "visually-hidden"} data-restore="working"><span>{t("restoreBusy")}</span></div>}

    {reading.status === "failed" ? <div className="notice notice-danger" data-restore="read-failed">
      <strong>{t("restoreReadFailed")}</strong>
      <span>{ownedErrorMessage(reading.error, t)}</span>
      <Button variant="secondary" size="sm" refused={work !== null} reasonId={WORK_ID} onClick={(event) => { owePlace(event); session.retryRead(); }}>{t("restoreTryAgain")}</Button>
    </div> : null}

    {read?.outcome === "refused" && !readDismissed ? <div className="notice notice-warning" data-restore="refused">
      <strong>{t("restoreRefusedTitle")}</strong>
      <span>{explainRefusedDocument(read.problem, t)}</span>
      <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={putAwayRead} />
    </div> : null}

    {read?.outcome === "unavailable" && !readDismissed ? <div className="notice notice-warning" data-restore="unavailable">
      <strong>{t("restoreUnavailable")}</strong>
      <span>{explainUnavailableProblem(read.problem, t)}</span>
      <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={putAwayRead} />
    </div> : null}

    {problemNotice(stopped, "stopped", session.retry)}
    {session.failed.map((failure, at) => <Fragment key={at}>{problemNotice(failure.problem, "action", failure.again, failure.putAway)}</Fragment>)}
    {problemNotice(problem, "problem", session.retry)}

    {!offerShown && expired === 0 ? null : <div className="notice notice-neutral restore-notice" data-restore="offer" ref={root}>
      {offered.length > 0 ? <span id={work === "restoring" ? WORK_ID : undefined}>{work === "restoring" ? t("restoreWorking", { count: offered.length }) : t("restoreOffer", { count: offered.length })}</span> : null}
      {marked.length > 0 ? <span data-restore-attention="">{t("restoreAttention", { count: marked.length })}</span> : null}
      {expired > 0 ? <span data-restore-expired="">{t("restoreExpired", { count: expired })}</span> : null}
      {offered.length > 0 ? <Button variant="secondary" size="sm" data-restore-action="" refused={restoreRefused} reasonId={work !== null ? WORK_ID : "restore-reason"}
        aria-busy={work === "restoring"} onClick={(event) => { owePlace(event); session.restore(); }}>{t("restoreAction")}</Button> : null}
      {offerShown ? <Button variant="secondary" size="sm" data-restore-start-fresh="" refused={work !== null} reasonId={WORK_ID}
        onClick={(event) => { owePlace(event); session.startFresh(); }}>{t("restoreStartFresh")}</Button> : null}
      {offered.length > 0 && restoreReasonShown ? <span id="restore-reason" className="restore-reason">{reason}</span> : null}
      {!offerShown ? <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={(event) => { owePlace(event); session.dismissExpired(); }} /> : null}
      {/* One Tab stop however long the list is: a disconnected drive can mark
          every row, and marked rows never expire (question 8). */}
      {marked.length === 0 ? null : <Toolbar roving orientation="vertical" label={t("restoreMarkedLabel")} className="restore-marked"><ul>
        {marked.map((row, index) => {
          const name = row.context === null ? row.displayName : `${row.displayName}, ${row.context}`;
          return <li key={row.handle} data-restored-row={row.handle} data-state={row.state}>
            <IconButton size="sm" icon={<Icon name="close" size={13} />} label={t("restoreDismissNamed", { name })} refused={work !== null} reasonId={WORK_ID}
              onClick={(event) => { owePlace(event, index); session.dismissRow(row.handle); }} data-restore-dismiss="" />
            <span className="restore-marked-text">
              <span className="restore-marked-name">{name}</span>
              {row.group === null ? null : <span className="restore-marked-group">{row.group}</span>}
              <span className="restore-marked-reason">{t(ROW_REASON[row.state])}</span>
            </span>
          </li>;
        })}
      </ul></Toolbar>}
    </div>}
  </>;
}
