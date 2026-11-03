import { useEffect, useId, useRef, useState, type ReactElement } from "react";

import { SettingField } from "../../components/fields/SettingField";
import { Button } from "../../components/ui";
import { ownedErrorMessage } from "../mzml-preview/ownedErrorMessages";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { explainRunHistoryProblem, writeProblem } from "./runHistoryMessages";
import { useRunHistoryApi } from "./runHistoryApi";
import { useRunList, useRunWrite } from "./useRunList";

/**
 * The off switch (ADR 0065 §7), read from the store each time Settings opens.
 *
 * A button rather than the dialog's segmented controls: those choose as the
 * arrow keys pass over them, and Off forgets every stored run, so it asks first.
 */
export function RunHistorySetting(): ReactElement {
  const t = useUiMessages();
  const api = useRunHistoryApi();
  const list = useRunList();
  const { writing, answer, write } = useRunWrite();
  const labelId = useId();
  const [confirming, setConfirming] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) keep.current?.focus(); }, [confirming]);

  const listed = list.answer?.outcome === "listed" ? list.answer : null;
  const refusal = writing ? t("runHistorySaving")
    : list.reading ? t("runHistoryChecking")
      : list.error !== null ? ownedErrorMessage(list.error, t)
        : list.answer?.outcome === "unavailable" ? explainRunHistoryProblem(list.answer.problem, t)
          : null;
  const problem = writeProblem(answer, t);
  const turnOff = () => {
    setConfirming(false);
    toggle.current?.focus();
    write(() => api.setEnabled(false));
  };

  return <>
    <SettingField labelId={labelId} label={t("runHistorySetting")}
      help={refusal ?? (listed === null ? undefined : t(listed.recording ? "runHistoryOn" : "runHistoryOff"))}>
      <Button size="sm" ref={toggle} data-run-history-setting="" data-run-history-toggle={listed === null ? undefined : listed.recording ? "on" : "off"}
        aria-expanded={listed?.recording === true ? confirming : undefined}
        refused={refusal !== null} reasonId={`${labelId}-help`}
        onClick={() => {
          if (listed?.recording === true) setConfirming((open) => !open);
          else write(() => api.setEnabled(true));
        }}>
        {t(listed?.recording === false ? "runHistoryTurnOn" : "runHistoryTurnOff")}
      </Button>
    </SettingField>
    {list.error === null ? null : <div className="settings-storage-actions">
      <Button size="sm" data-run-history-setting-retry="" onClick={list.reload}>{t("runHistoryRefresh")}</Button>
    </div>}
    {confirming ? (
      <div className="settings-storage-problem" role="group" aria-labelledby={`${labelId}-ask`} data-run-history-off-confirm="">
        <p id={`${labelId}-ask`}>{t("runHistoryOffAsk")}</p>
        <div className="settings-storage-actions">
          <Button variant="danger" size="sm" data-run-history-off-forget="" onClick={turnOff}>{t("runHistoryOffConfirm")}</Button>
          <Button size="sm" ref={keep} data-run-history-off-keep="" onClick={() => { setConfirming(false); toggle.current?.focus(); }}>{t("runHistoryOffKeep")}</Button>
        </div>
      </div>
    ) : null}
    {problem === null ? null : <div className="settings-storage-problem" role="alert" data-run-history-setting-problem=""><p>{problem}</p></div>}
  </>;
}
