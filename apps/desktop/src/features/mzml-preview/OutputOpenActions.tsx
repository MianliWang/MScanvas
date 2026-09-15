import { useEffect, useRef, useState } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { usePreviewApi } from "./api";
import type { FinalizedOutput, OutputOpenAction, OutputOpenOutcome, OutputOpenRefusal } from "./contracts";

const REFUSAL = {
  unknownOutput: "outputOpenStale", staleDocument: "outputOpenStale",
  outputMissing: "outputOpenMissing", outputChanged: "outputOpenChanged", outputUnreadable: "outputOpenUnreadable",
  folderUnavailable: "outputFolderUnavailable", noAssociation: "outputNoAssociation", accessDenied: "outputAccessDenied",
  platformUnavailable: "outputPlatformUnavailable", platformFailure: "outputPlatformFailure", inFlight: "outputOpenBusy",
} as const satisfies Record<OutputOpenRefusal, string>;

/** Names a retained finalized object; a basename never becomes a path request. */
export function OutputOpenActions({ output }: { readonly output: FinalizedOutput }) {
  const api = usePreviewApi(); const t = useUiMessages();
  const [working, setWorking] = useState<OutputOpenAction | null>(null);
  const [answer, setAnswer] = useState<OutputOpenOutcome | "failed" | null>(null);
  const claimed = useRef(false); const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const open = (action: OutputOpenAction) => {
    if (claimed.current) return;
    claimed.current = true; setWorking(action); setAnswer(null);
    void api.openFinalizedOutput(output.outputId, action)
      .then(value => { if (live.current) setAnswer(value); })
      .catch(() => { if (live.current) setAnswer("failed"); })
      .finally(() => { claimed.current = false; if (live.current) setWorking(null); });
  };
  return <div className="output-open-actions" role="group" aria-label={t("outputOpenGroup", { name: output.fileName })}>
    <span title={output.fileName}>{output.fileName}</span>
    {(["file", "folder"] as const).map(action => <button type="button" className="secondary-button" key={action}
      disabled={working !== null && working !== action} aria-disabled={working !== null || undefined}
      onClick={() => open(action)}>{t(action === "file" ? "outputOpenFile" : "outputOpenFolder")}</button>)}
    <p role="status">{working !== null ? t("outputOpening") : answer === "failed" ? t("outputPlatformFailure") : answer?.status === "accepted" ? t("outputOpenAccepted") : answer?.status === "refused" ? t(REFUSAL[answer.reason]) : ""}</p>
  </div>;
}
