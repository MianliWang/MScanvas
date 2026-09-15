import { useEffect, useRef, useState } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { StagingRecovery, StagingReclaimOutcome, StagingReclaimRefusal } from "./contracts";

const REFUSAL = {
  unknownRecovery: "stagingRecoveryStale", staleDocument: "stagingRecoveryStale",
  activeWork: "stagingRecoveryBusy", quarantined: "stagingRecoveryUnconfirmed",
  proofUnavailable: "stagingRecoveryUnknown", stillBlocked: "stagingRecoveryBlocked",
} as const satisfies Record<StagingReclaimRefusal, string>;

const STATUS_MESSAGE = { active: "stagingRecoveryActive", cleaned: "stagingRecoveryCleaned", processUnconfirmed: "stagingRecoveryUnconfirmed", proofUnavailable: "stagingRecoveryUnknown" } as const;

export function StagingRecoveryActions({ recovery, enabled, reclaim, onReview }: {
  readonly recovery: StagingRecovery;
  readonly enabled: boolean;
  readonly reclaim: (recoveryId: string) => Promise<StagingReclaimOutcome>;
  readonly onReview: () => void;
}) {
  const t = useUiMessages();
  const [working, setWorking] = useState(false);
  const [answer, setAnswer] = useState<StagingReclaimOutcome | "failed" | null>(null);
  const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const status = answer !== null && answer !== "failed" && answer.status === "cleaned" ? "cleaned" : recovery.status;
  const cleanup = () => {
    if (!enabled || status !== "recoverable" || inFlight.current) return;
    inFlight.current = true; setWorking(true); setAnswer(null);
    void reclaim(recovery.recoveryId).then(result => { if (live.current) setAnswer(result); })
      .catch(() => { if (live.current) setAnswer("failed"); })
      .finally(() => { inFlight.current = false; if (live.current) setWorking(false); });
  };
  return <div className="conversion-recovery" role="group" aria-label={t("stagingRecoveryTitle")}>
    <p>{status === "recoverable" ? t("stagingRecoveryOwned", { count: recovery.attempt }) : status === "cleaned" ? null : t(STATUS_MESSAGE[status])}</p>
    <p role="status">{working ? t("stagingRecoveryWorking") : answer === "failed" ? t("stagingRecoveryFailed") : answer?.status === "refused" ? t(REFUSAL[answer.reason]) : status === "cleaned" ? t("stagingRecoveryCleaned") : ""}</p>
    {status === "recoverable" || status === "cleaned" || status === "proofUnavailable" ? <button className="secondary-button" type="button" aria-disabled={!enabled || working}
      onClick={() => { if (!enabled || working) return; if (status === "recoverable") cleanup(); else onReview(); }}>
      {t(status === "recoverable" ? "stagingRecoveryButton" : "stagingReviewNewPlan")}</button> : null}
  </div>;
}
