import { useEffect, useId, useRef, useState } from "react";
import { Button, Icon } from "../../components/ui";
import { joinSentences } from "../preferences/i18n";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { usePreviewApi } from "./api";
import { conversionErrorMessage } from "./conversionMessages";
import { ownedErrorDetail } from "./ownedErrorMessages";
import type { FinalizedOutput, NotVerifiedByMscanvas, OutputOpenAction, OutputOpenOutcome, OutputOpenRefusal } from "./contracts";
import { notAddedSentence } from "./ConversionItemJudgements";
import { NotVerifiedTag } from "./NotVerifiedTag";
import type { OutputAdoptionAnswer } from "./useConversionOperation";

const REFUSAL = {
  unknownOutput: "outputOpenStale", staleDocument: "outputOpenStale",
  outputMissing: "outputOpenMissing", outputChanged: "outputOpenChanged", outputUnreadable: "outputOpenUnreadable",
  folderUnavailable: "outputFolderUnavailable", noAssociation: "outputNoAssociation", accessDenied: "outputAccessDenied",
  platformUnavailable: "outputPlatformUnavailable", platformFailure: "outputPlatformFailure", inFlight: "outputOpenBusy",
} as const satisfies Record<OutputOpenRefusal, string>;

/** An Add for this output, where Rust says it is adoptable (ADR 0052). */
export interface OutputAddOffer {
  readonly onAdd: () => void;
  readonly refused: boolean;
  /** What says why Add is refused, while it is. */
  readonly refusedBy: string | null;
  /** Whether the adoption under way is this output's. */
  readonly adding: boolean;
  /** What the latest Add of this output did; none once the row it names has left. */
  readonly answer: OutputAdoptionAnswer | null;
  readonly notVerified: NotVerifiedByMscanvas | null;
  /** Takes the reader to the row the answer names. */
  readonly onShow: ((handle: string) => void) | null;
}

/** Names a retained finalized object; a basename never becomes a path request. */
export function OutputOpenActions({ output, add = null }: { readonly output: FinalizedOutput; readonly add?: OutputAddOffer | null }) {
  const api = usePreviewApi(); const t = useUiMessages();
  const [working, setWorking] = useState<OutputOpenAction | null>(null);
  const [answer, setAnswer] = useState<OutputOpenOutcome | "failed" | null>(null);
  // The one status line says the action pressed last.
  const [openedLast, setOpenedLast] = useState(false);
  const claimed = useRef(false); const live = useRef(true); const statusId = useId(); const labelId = useId();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const open = (action: OutputOpenAction) => {
    if (claimed.current) return;
    claimed.current = true; setWorking(action); setAnswer(null); setOpenedLast(true);
    void api.openFinalizedOutput(output.outputId, action)
      .then(value => { if (live.current) setAnswer(value); })
      .catch(() => { if (live.current) setAnswer("failed"); })
      .finally(() => { claimed.current = false; if (live.current) setWorking(null); });
  };
  const opened = working !== null ? t("outputOpening") : answer === "failed" ? t("outputPlatformFailure") : answer?.status === "accepted" ? t("outputOpenAccepted") : answer?.status === "refused" ? t(REFUSAL[answer.reason]) : "";
  const last = add?.answer ?? null;
  const added = last === null ? ""
    : last.kind === "refused" ? notAddedSentence(output.fileName, last.reason, t)
    : last.kind === "failed" ? joinSentences(t, [conversionErrorMessage(last.error, t), ownedErrorDetail(last.error, t) ?? ""])
    : t(last.kind === "added" ? "outputAdded" : "outputAlreadyInWorkspace");
  const show = add?.onShow ?? null;
  const shown = last !== null && "handle" in last && show !== null ? { handle: last.handle, show } : null;
  const adding = add?.adding === true;
  // Both stay Tab stops while one request is out; the status line below says
  // why they are refused ("Opening…").
  return <div className="output-open-actions" role="group" aria-label={t("outputOpenGroup", { name: output.fileName })}>
    <span className="output-open-name" title={output.fileName}>{output.fileName}</span>
    {(["file", "folder"] as const).map(action => <Button variant="secondary" size="sm" key={action}
      icon={<Icon name={action} />} refused={working !== null} reasonId={statusId}
      onClick={() => open(action)}>{t(action === "file" ? "outputOpenFile" : "outputOpenFolder")}</Button>)}
    {add === null ? null : <>
      <Button variant="secondary" size="sm" icon={<Icon name="plus" />} refused={add.refused} reasonId={adding ? statusId : add.refusedBy ?? undefined}
        aria-label={t("outputAddNamed", { name: output.fileName })}
        aria-describedby={add.notVerified === null ? undefined : labelId}
        onClick={() => { setOpenedLast(false); add.onAdd(); }}>{t("outputAdd")}</Button>
      <NotVerifiedTag label={add.notVerified} id={labelId} />
    </>}
    {shown === null ? null : <Button variant="secondary" size="sm" aria-label={t("projectShowInWorkbenchNamed", { name: output.fileName })}
      onClick={() => shown.show(shown.handle)}>{t("projectShowInWorkbench")}</Button>}
    <p role="status" id={statusId}>{adding ? t("outputAdding") : openedLast ? opened || added : added || opened}</p>
  </div>;
}
