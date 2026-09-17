import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { MessageKey } from "../preferences/i18n";
import { usePreviewApi } from "./api";
import { claimActiveClearFocusReturn, type ActiveClearFocusReturn } from "./activeClearFocusReturn";
import type { WorkspaceClearAction, WorkspaceClearOutcome, WorkspaceClearPlan, WorkspaceClearRefusal } from "./contracts";

const REFUSALS = {
  stalePlan: "clearStale", staleDocument: "clearStale", ownershipChanged: "clearStale",
  nothingRemovable: "clearNothing", actionInFlight: "clearActionBusy", stopUnconfirmed: "clearStopUnconfirmed", quarantined: "clearQuarantined",
} as const satisfies Record<WorkspaceClearRefusal, MessageKey>;

export function ActiveClearDialog({ returnTo, onClose, onEmptyRosterClosed, onExecute }: {
  readonly returnTo: HTMLElement | null;
  readonly onClose: () => void;
  readonly onEmptyRosterClosed: (claim: ActiveClearFocusReturn) => void;
  readonly onExecute: (planId: string, action: WorkspaceClearAction) => Promise<WorkspaceClearOutcome>;
}) {
  const api = usePreviewApi();
  const t = useUiMessages();
  const [plan, setPlan] = useState<WorkspaceClearPlan | null>(null);
  const [problem, setProblem] = useState<(typeof REFUSALS)[WorkspaceClearRefusal] | "clearReadFailed" | null>(null);
  const [reading, setReading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [executingAction, setExecutingAction] = useState<WorkspaceClearAction | null>(null);
  const executing = executingAction !== null;
  const inFlight = useRef(false);
  const content = useRef<HTMLDivElement | null>(null);
  const returnButton = useRef<HTMLButtonElement | null>(null);
  const reevaluateButton = useRef<HTMLButtonElement | null>(null);
  const recoverFrom = useRef<HTMLElement | null>(null);
  const emptyFocusReturn = useRef<ActiveClearFocusReturn | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let retired = false;
    setReading(true); setPlan(null); setProblem(null);
    void api.planWorkspaceClear().then(answer => {
      if (retired) return;
      if ("Ok" in answer) setPlan(answer.Ok); else setProblem(REFUSALS[answer.Err]);
    }).catch(() => { if (!retired) setProblem("clearReadFailed"); }).finally(() => { if (!retired) setReading(false); });
    return () => { retired = true; };
  }, [api, revision]);
  useLayoutEffect(() => {
    if (executing || problem === null) return;
    const owner = recoverFrom.current;
    recoverFrom.current = null;
    if (owner !== null && document.hasFocus() && (document.activeElement === owner || document.activeElement === document.body)) reevaluateButton.current?.focus();
  }, [executing, problem]);
  const execute = (action: WorkspaceClearAction, initiator: HTMLButtonElement) => {
    if (inFlight.current || plan === null || (action === "removeNonRunning" && plan.removableCount === 0)) return;
    inFlight.current = true; setExecutingAction(action); setProblem(null);
    const refuse = (message: NonNullable<typeof problem>) => {
      recoverFrom.current = document.hasFocus() && document.activeElement === initiator ? initiator : null;
      setPlan(null); setProblem(message);
    };
    void onExecute(plan.planId, action).then(result => {
      if (!live.current) return;
      if (result.status === "removed") {
        if (result.result.roster.datasets.length === 0) emptyFocusReturn.current = claimActiveClearFocusReturn(content.current);
        onClose();
      } else refuse(REFUSALS[result.reason]);
    }).catch(() => { if (live.current) refuse("clearReadFailed"); }).finally(() => {
      inFlight.current = false;
      if (live.current) setExecutingAction(null);
    });
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !inFlight.current) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="settings-overlay" /><Dialog.Content className="group-name-dialog" ref={node => { if (node !== null) content.current = node; }}
      onOpenAutoFocus={event => { event.preventDefault(); returnButton.current?.focus(); }}
      onCloseAutoFocus={event => {
        event.preventDefault(); const active = document.activeElement;
        const claim = emptyFocusReturn.current;
        emptyFocusReturn.current = null;
        if (claim !== null) { onEmptyRosterClosed(claim); return; }
        if (!document.hasFocus() || !(active === document.body || active === returnTo || (active !== null && content.current?.contains(active)))) return;
        if (returnTo?.isConnected && !returnTo.closest("[hidden], [inert]")) returnTo.focus();
      }} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { event.stopImmediatePropagation(); if (inFlight.current) event.preventDefault(); }}>
      <Dialog.Title>{t("clearActiveTitle")}</Dialog.Title>
      <Dialog.Description>{t("clearActiveHelp")}</Dialog.Description>
      <div aria-live="polite" role="status">
        {reading ? t("clearReading") : executing ? t("clearStopping") : problem ? t(problem) : plan ? t("clearCounts", { count: plan.removableCount, total: plan.totalCount, protected: String(plan.protectedCount) }) : ""}
      </div>
      {plan?.removableCount === 0 ? <p>{t("clearNothing")}</p> : null}
      <div className="group-dialog-actions">
        <button ref={returnButton} className="secondary-button" type="button" disabled={executing} onClick={onClose}>{t("clearReturn")}</button>
        {plan === null && !reading ? <button ref={reevaluateButton} className="secondary-button" type="button" disabled={executing} onClick={() => setRevision(value => value + 1)}>{t("clearReevaluate")}</button> : null}
        <button className="secondary-button" type="button" disabled={executingAction !== "removeNonRunning" && (reading || executing || !plan?.removableCount)} aria-disabled={executingAction === "removeNonRunning"} onClick={event => execute("removeNonRunning", event.currentTarget)}>{t("clearRemoveNonRunning")}</button>
        <button className="primary-button" type="button" disabled={executingAction !== "cancelAndClear" && (reading || executing || plan === null)} aria-disabled={executingAction === "cancelAndClear"} onClick={event => execute("cancelAndClear", event.currentTarget)}>{t("clearCancelAll")}</button>
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
