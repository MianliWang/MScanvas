import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { MessageKey } from "../preferences/i18n";
import { usePreviewApi } from "./api";
import type { WorkspaceClearAction, WorkspaceClearOutcome, WorkspaceClearPlan, WorkspaceClearRefusal } from "./contracts";

const REFUSALS = {
  stalePlan: "clearStale", staleDocument: "clearStale", ownershipChanged: "clearStale",
  nothingRemovable: "clearNothing", actionInFlight: "clearActionBusy", stopUnconfirmed: "clearStopUnconfirmed", quarantined: "clearQuarantined",
} as const satisfies Record<WorkspaceClearRefusal, MessageKey>;

export function ActiveClearDialog({ returnTo, onClose, onExecute }: {
  readonly returnTo: HTMLElement | null;
  readonly onClose: () => void;
  readonly onExecute: (planId: string, action: WorkspaceClearAction) => Promise<WorkspaceClearOutcome>;
}) {
  const api = usePreviewApi();
  const t = useUiMessages();
  const [plan, setPlan] = useState<WorkspaceClearPlan | null>(null);
  const [problem, setProblem] = useState<(typeof REFUSALS)[WorkspaceClearRefusal] | "clearReadFailed" | null>(null);
  const [reading, setReading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [executing, setExecuting] = useState(false);
  const inFlight = useRef(false);
  const content = useRef<HTMLDivElement | null>(null);
  const returnButton = useRef<HTMLButtonElement | null>(null);
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
  const execute = (action: WorkspaceClearAction) => {
    if (inFlight.current || plan === null || (action === "removeNonRunning" && plan.removableCount === 0)) return;
    inFlight.current = true; setExecuting(true); setProblem(null);
    void onExecute(plan.planId, action).then(result => {
      if (!live.current) return;
      if (result.status === "removed") onClose();
      else { setPlan(null); setProblem(REFUSALS[result.reason]); }
    }).catch(() => { if (live.current) { setPlan(null); setProblem("clearReadFailed"); } }).finally(() => {
      inFlight.current = false;
      if (live.current) setExecuting(false);
    });
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !inFlight.current) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="settings-overlay" /><Dialog.Content className="group-name-dialog" ref={node => { if (node !== null) content.current = node; }}
      onOpenAutoFocus={event => { event.preventDefault(); returnButton.current?.focus(); }}
      onCloseAutoFocus={event => {
        event.preventDefault(); const active = document.activeElement;
        if (document.hasFocus() && (active === document.body || active === returnTo || (active !== null && content.current?.contains(active))) && returnTo?.isConnected && !returnTo.closest("[hidden], [inert]")) returnTo.focus();
      }} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { event.stopImmediatePropagation(); if (inFlight.current) event.preventDefault(); }}>
      <Dialog.Title>{t("clearActiveTitle")}</Dialog.Title>
      <Dialog.Description>{t("clearActiveHelp")}</Dialog.Description>
      <div aria-live="polite" role="status">
        {reading ? t("clearReading") : executing ? t("clearStopping") : problem ? t(problem) : plan ? t("clearCounts", { count: plan.removableCount, total: plan.totalCount, protected: String(plan.protectedCount) }) : ""}
      </div>
      {plan?.removableCount === 0 ? <p>{t("clearNothing")}</p> : null}
      <div className="group-dialog-actions">
        <button ref={returnButton} className="secondary-button" type="button" disabled={executing} onClick={onClose}>{t("clearReturn")}</button>
        {plan === null && !reading ? <button className="secondary-button" type="button" disabled={executing} onClick={() => setRevision(value => value + 1)}>{t("clearReevaluate")}</button> : null}
        <button className="secondary-button" type="button" disabled={reading || executing || !plan?.removableCount} onClick={() => execute("removeNonRunning")}>{t("clearRemoveNonRunning")}</button>
        <button className="primary-button" type="button" disabled={reading || executing || plan === null} onClick={() => execute("cancelAndClear")}>{t("clearCancelAll")}</button>
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
