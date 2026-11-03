import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";

import { Button, Disclosure, EmptyState, Icon, MiddleEllipsis } from "../../components/ui";
import { ITEM_STATE_LABEL, ITEM_STATE_SYMBOL, failureSentence, setFailureSentence } from "../mzml-preview/ConversionPanel";
import { MEMBER_STATE_LABEL, integritySentence } from "../mzml-preview/ConversionItemJudgements";
import { CONVERSION_VALUE_LABEL } from "../mzml-preview/ConversionSettings";
import { NotVerifiedTag } from "../mzml-preview/NotVerifiedTag";
import {
  SOURCE_KIND_LABEL,
  toPreviewError,
  type ConversionCatalogRow,
  type ConversionValidation,
  type PreviewError,
} from "../mzml-preview/contracts";
import { conversionErrorMessage } from "../mzml-preview/conversionMessages";
import { useListWindow } from "../mzml-preview/conversionListWindow";
import { catalogRow } from "../mzml-preview/conversionIntentSelection";
import { formatByteLength, formatCount } from "../mzml-preview/format";
import { joinSentences, type UiMessage } from "../preferences/i18n";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";
import { completenessSentence, explainRunHistoryError, explainRunHistoryProblem, queueEndingSentence, RUN_STATE_LABEL, writeProblem } from "./runHistoryMessages";
import { useRunHistoryApi, type RunItem, type RunItemProgress, type RunListOutcome, type RunReadOutcome, type RunSummary } from "./runHistoryApi";
import { useRunList, useRunWrite } from "./useRunList";

/** Past what a `Date` holds `format` throws, and this runs during render: the raw number instead. */
function formatRunTime(ms: number, locale: string): string {
  return Math.abs(ms) > 8.64e15 ? String(ms) : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(ms);
}

/** A stable code beside its sentence, unless the sentence is the fallback that already names it. */
function StableCode({ code, sentence }: { readonly code: string; readonly sentence: string }): ReactElement | null {
  return sentence.includes(code) ? null : <code className="run-history-code">{code}</code>;
}

/** The same label a queue shows while it runs (ADR 0055), read off the record. */
function runLabel(run: Pick<RunSummary, "settingsVerified" | "buildVerified" | "buildRelease">) {
  return run.settingsVerified && run.buildVerified ? null : {
    unverifiedSettings: !run.settingsVerified,
    unverifiedBuildRelease: run.buildVerified ? null : run.buildRelease,
  };
}

/** A row's own labels by its catalog entry, its identifier where this build has none, or Advanced. */
function settingsText(row: string | null, catalog: readonly ConversionCatalogRow[], t: UiMessage): string {
  if (row === null) return t("cnvAdvanced");
  const intent = catalogRow(catalog, row)?.intent;
  if (intent === undefined) return row;
  return [
    t(CONVERSION_VALUE_LABEL.processing[intent.processing]),
    t(CONVERSION_VALUE_LABEL.population[intent.population]),
    t(CONVERSION_VALUE_LABEL.precision[intent.precision]),
    t(CONVERSION_VALUE_LABEL.compression[intent.compression]),
  ].join(t("m74CnvListSeparator"));
}

function itemStateText({ state, completeness }: RunItemProgress, t: UiMessage): string {
  if (state === "interrupted") return t("runHistoryItemInterrupted");
  if (state === "skipped" && completeness !== null) return t("m74CnvSetSkipped");
  return Object.hasOwn(ITEM_STATE_LABEL, state) ? t(ITEM_STATE_LABEL[state as keyof typeof ITEM_STATE_LABEL]) : state;
}

function itemSymbol(state: string): string {
  if (state === "interrupted") return "!";
  return Object.hasOwn(ITEM_STATE_SYMBOL, state) ? ITEM_STATE_SYMBOL[state as keyof typeof ITEM_STATE_SYMBOL] : "–";
}

/**
 * Why a recorded item failed, from what a record keeps: its stable codes.
 *
 * The same sentences the queue's own row says, reached the same way: a set by
 * its detailed outcome, a single output by its outcome, and a failure before any
 * report by its error code, which a code this build does not know names as is.
 */
function recordedFailure({ state, outcome, failure, outputs, completeness }: RunItemProgress, t: UiMessage): string | null {
  if (state !== "failed") return null;
  if (completeness !== null) {
    const finalized = outputs.filter((output) => output.state === "finalized").length;
    // Every member at its final name and still a failure: ADR 0065 §1's set that
    // could not be adopted whole, which no sentence of a set's refusal describes.
    if (finalized > 0 && finalized === outputs.length) return t("runHistorySetNotAdoptable");
    // Part of a set reached its final names: what the partial report would say.
    return setFailureSentence({ partial: finalized > 0 ? {} : null, detailedOutcome: failure }, t);
  }
  if (outcome !== null) return failureSentence({ outcome, detailedOutcome: failure }, t);
  return failure === null ? t("m74CnvNoWrittenFile") : conversionErrorMessage(codeAsError(failure), t);
}

function codeAsError(code: string): PreviewError {
  return { kind: code, summary: "", detail: null, retryable: false };
}

/** What the record says of one item's outputs. Nothing is opened from here: ADR 0065 §8 is a later slice. */
function ItemDetails({ item }: { readonly item: RunItem }): ReactElement | null {
  const t = useUiMessages();
  const { outputs, completeness, setAdoptable, failure } = item.progress;
  // A single output is recorded only once finalized, so anything else has none.
  if (outputs.length === 0 && completeness === null) return null;
  // The first validated output's, as the queue's own row says it. The record's
  // mode is the same identifier a report carries, and an unknown one is named.
  const firstChecks = (outputs.find((output) => output.checks !== null)?.checks ?? null) as ConversionValidation | null;
  const advisories = [...new Set(outputs.flatMap((output) => output.checks?.advisory ?? []))];
  // A rejected member keeps no checks, and must not read as "nothing was checked".
  const refused = completeness !== null && failure === "multi_output_member_rejected";
  return (
    <Disclosure label={t("cnvDetails")} aria-label={t("cnvDetailsFor", { name: item.displayName })}
      className="conversion-item-toggle" regionProps={{ className: "conversion-item-detail" }}>
      <dl className="metadata-list conversion-item-judgements">
        <div>
          <dt>{t("cnvIntegrityTitle")}</dt>
          <dd>
            {integritySentence(firstChecks, outputs.length > 1, refused, false, null, t)}
            {advisories.length === 0 ? null : (
              <> <span className="conversion-item-advisories">
                {advisories.length === 1
                  ? t("cnvAdvisoryOne", { codes: advisories[0] ?? "" })
                  : t("cnvAdvisoryMany", { n: formatCount(advisories.length), codes: advisories.join(", ") })}
              </span></>
            )}
          </dd>
        </div>
        {completeness === null || completeness.kind === "notPosed" ? null : (
          <div>
            <dt>{t("runHistoryCompleteness")}</dt>
            {completeness.kind === "established" ? <dd>{t("m74CnvSampleCompleteness")}</dd> : (
              <dd>
                {completenessSentence(completeness.reason, t)}{" "}
                <StableCode code={completeness.reason} sentence={completenessSentence(completeness.reason, t)} />
              </dd>
            )}
          </div>
        )}
        {setAdoptable === false ? (
          <div>
            <dt>{t("cnvAdoptionTitle")}</dt>
            <dd>{t("cnvAdoptionSetUnavailable")}</dd>
          </div>
        ) : null}
      </dl>
      {outputs.length === 0 ? null : (
        <div className="conversion-item-manifest-scroll">
          <table className="conversion-item-manifest">
            <caption>{t("cnvManifestTitle", { name: item.displayName })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("cnvFileColumn")}</th>
                <th scope="col">{t("cnvStateColumn")}</th>
                <th scope="col">{t("cnvSizeColumn")}</th>
                <th scope="col">{t("cnvCheckedColumn")}</th>
                <th scope="col">{t("cnvUnverifiedColumn")}</th>
                <th scope="col">{t("cnvInapplicableColumn")}</th>
                <th scope="col">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {outputs.map((output, position) => {
                // A single output is recorded only once it had its final name.
                const state = output.state ?? "finalized";
                return (
                  <tr key={`${String(position)}-${output.fileName}`}>
                    <th scope="row" title={output.fileName}>{output.fileName}</th>
                    <td>{Object.hasOwn(MEMBER_STATE_LABEL, state) ? t(MEMBER_STATE_LABEL[state as keyof typeof MEMBER_STATE_LABEL]) : state}</td>
                    <td>{output.byteLength === null ? "—" : formatByteLength(output.byteLength, t)}</td>
                    <td>{output.checks === null ? "—" : formatCount(output.checks.verified.length)}</td>
                    <td>{output.checks === null ? "—" : formatCount(output.checks.unverified.length)}</td>
                    <td>{output.checks === null ? "—" : formatCount(output.checks.inapplicable.length)}</td>
                    <td>{output.sha256 === null ? "—" : <code className="conversion-item-digest" title={output.sha256}>{output.sha256}</code>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Disclosure>
  );
}

function ItemList({ items, run }: { readonly items: readonly RunItem[]; readonly run: RunSummary }): ReactElement {
  const t = useUiMessages();
  // By length: the same run read again is a new array of the same rows.
  const count = items.length;
  const keys = useMemo(() => Array.from({ length: count }, (_, index) => String(index)), [count]);
  const { listProps, rows, spacer } = useListWindow(keys, 64);
  return (
    <ol className="conversion-queue-list conversion-run-list" aria-label={t("runHistoryItems")} {...listProps}>
      {rows.map(({ key, index, style, ref }) => {
        const item = items[index];
        if (item === undefined) return null;
        const { progress } = item;
        const failure = recordedFailure(progress, t);
        const label = runLabel({ settingsVerified: item.settingsVerified, buildVerified: item.buildVerified, buildRelease: run.buildRelease });
        const family = Object.hasOwn(SOURCE_KIND_LABEL, item.family) ? SOURCE_KIND_LABEL[item.family as keyof typeof SOURCE_KIND_LABEL] : item.family;
        return (
          <li key={key} ref={ref} style={style} data-window-key={key} aria-setsize={items.length} aria-posinset={index + 1}
            data-item-state={progress.state} data-run-item="">
            <span className="conversion-run-symbol" aria-hidden="true">{itemSymbol(progress.state)}</span>
            <span className="conversion-run-title">
              <MiddleEllipsis className="conversion-queue-name" text={item.displayName} />
              <span className="conversion-queue-kind">{family}</span>
            </span>
            <span className="conversion-run-aside">
              <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
              <span className="conversion-queue-status">{itemStateText(progress, t)}</span>
            </span>
            {label === null ? null : <span className="conversion-run-label"><NotVerifiedTag label={label} /></span>}
            <div className="conversion-run-detail">
              {progress.attempts > 1 ? <span className="conversion-queue-attempts">{t("m74CnvAttempt", { count: progress.attempts })}</span> : null}
              {failure === null ? null : <span className="conversion-queue-reason">{failure}</span>}
              {/* Only beside its sentence: a file a retry has not reached still holds its earlier failure, which is not why it waits. */}
              {failure === null || progress.failure === null ? null : <StableCode code={progress.failure} sentence={failure} />}
              <ItemDetails item={item} />
            </div>
          </li>
        );
      })}
      {spacer}
    </ol>
  );
}

type RunRead = RunReadOutcome | { readonly outcome: "reading" } | { readonly outcome: "error"; readonly error: PreviewError };

function RunDetail({ run, read: answer, catalog }: {
  readonly run: RunSummary;
  readonly read: RunRead;
  readonly catalog: readonly ConversionCatalogRow[];
}): ReactElement {
  const t = useUiMessages();
  const { effective: { locale } } = useSessionPreferences();
  // Another run's answer is a read not yet begun, for the frame before it does.
  const read: RunRead = answer.outcome === "found" && answer.run.runId !== run.runId ? { outcome: "reading" } : answer;
  // What the read says wins over the list's copy, which can be a moment older.
  const shown = read.outcome === "found" ? read.run : run;
  const label = runLabel(shown);
  const ended = shown.failure === null ? "" : queueEndingSentence(shown.failure, t) ?? conversionErrorMessage(codeAsError(shown.failure), t);
  return (
    <div className="conversion-running conversion-run-rows" data-run-detail={shown.runId} data-run-state={shown.state}>
      <div className="conversion-column-head">
        <h3>{t("runHistoryRunTitle", { when: formatRunTime(shown.startedAtMs, locale) })}</h3>
        <span className="conversion-queue-status run-history-state">{t(RUN_STATE_LABEL[shown.state])}</span>
      </div>
      <dl className="metadata-list conversion-summary-dl run-history-facts">
        {shown.endedAtMs === null ? null : (
          <div>
            <dt>{t("runHistoryEnded")}</dt>
            <dd>{formatRunTime(shown.endedAtMs, locale)}</dd>
          </div>
        )}
        {shown.interruptedAtMs === null ? null : (
          <div data-run-interrupted-at="">
            <dt>{t("runHistoryInterruptedAt")}</dt>
            <dd>{formatRunTime(shown.interruptedAtMs, locale)}</dd>
          </div>
        )}
        <div>
          <dt>{t("runHistoryFiles")}</dt>
          <dd>{countsText(shown, t)}</dd>
        </div>
        {shown.passes <= 1 ? null : (
          <div>
            <dt>{t("runHistoryPasses")}</dt>
            <dd>{formatCount(shown.passes)}</dd>
          </div>
        )}
        <div>
          <dt>{t("runHistorySettings")}</dt>
          <dd>{settingsText(shown.settingsRow, catalog, t)}</dd>
        </div>
        {shown.buildRelease === null ? null : (
          <div>
            <dt>{t("m74CnvBuild")}</dt>
            <dd>{shown.buildRelease}</dd>
          </div>
        )}
        {label === null ? null : (
          <div>
            <dt>{t("m74CnvVerification")}</dt>
            <dd><NotVerifiedTag label={label} /></dd>
          </div>
        )}
        {shown.failure === null ? null : (
          <div data-run-failure="">
            <dt>{t("runHistoryFailure")}</dt>
            <dd>{ended} <StableCode code={shown.failure} sentence={ended} /></dd>
          </div>
        )}
      </dl>
      {shown.itemsOmitted ? <p className="notice notice-warning" data-run-items-omitted="">{t("runHistoryItemsOmitted")}</p> : null}
      {read.outcome === "reading" ? <p className="conversion-side-note" role="status" data-run-read="reading">{t("runHistoryReadingRun")}</p> : null}
      {read.outcome === "notFound" ? <p className="notice notice-warning" role="alert" data-run-read="notFound">{t("runHistoryNotFound")}</p> : null}
      {read.outcome === "refused" || read.outcome === "unavailable"
        ? <p className="notice notice-warning" role="alert" data-run-read={read.problem}>{explainRunHistoryProblem(read.problem, t)}</p> : null}
      {read.outcome === "error" ? <p className="notice notice-danger" role="alert" data-run-read="error">{explainRunHistoryError(read.error, t)}</p> : null}
      {read.outcome === "found" && read.items.length > 0 ? <ItemList items={read.items} run={read.run} /> : null}
    </div>
  );
}

function countsText(run: Pick<RunSummary, "finalizedCount" | "failedCount" | "itemCount">, t: UiMessage): string {
  return t("m74CnvQueueCounts", {
    parts: [t("m74CnvCountConverted", { count: run.finalizedCount }), t("m74CnvCountFailed", { count: run.failedCount })].join(t("m74CnvListSeparator")),
    total: run.itemCount,
  });
}

function RunRows({ runs, selectedId, onSelect }: {
  readonly runs: readonly RunSummary[];
  readonly selectedId: string | null;
  readonly onSelect: (runId: string) => void;
}): ReactElement {
  const t = useUiMessages();
  const { effective: { locale } } = useSessionPreferences();
  const keys = useMemo(() => runs.map((run) => run.runId), [runs]);
  const { listProps, rows, spacer } = useListWindow(keys, 72);
  return (
    <ol className="run-history-list" aria-label={t("runHistoryRuns")} {...listProps}>
      {rows.map(({ key, index, style, ref }) => {
        const run = runs[index];
        if (run === undefined) return null;
        return (
          <li key={key} ref={ref} style={style} data-window-key={key} aria-setsize={runs.length} aria-posinset={index + 1}>
            <Button className="run-history-row" aria-current={run.runId === selectedId ? "true" : undefined}
              data-run-row={run.runId} data-run-state={run.state} onClick={() => onSelect(run.runId)}>
              <span className="run-history-row-top">
                <span className="run-history-when">{formatRunTime(run.startedAtMs, locale)}</span>
                <span className="conversion-queue-status run-history-state">{t(RUN_STATE_LABEL[run.state])}</span>
              </span>
              <span className="run-history-counts">{countsText(run, t)}</span>
              {runLabel(run) === null ? null : <NotVerifiedTag label={runLabel(run)} />}
            </Button>
          </li>
        );
      })}
      {spacer}
    </ol>
  );
}

function ListNotices({ listed }: { readonly listed: Extract<RunListOutcome, { outcome: "listed" }> }): ReactElement {
  const t = useUiMessages();
  return <>
    {/* With no runs the main column says it. */}
    {listed.recording || listed.runs.length === 0 ? null : <p className="notice notice-warning" data-run-history-note="off">{t("runHistoryRecordingOff")}</p>}
    {listed.problem === null ? null : <p className="notice notice-warning" role="alert" data-run-history-note={listed.problem}>{explainRunHistoryProblem(listed.problem, t)}</p>}
    {listed.unreadable === 0 ? null : <p className="conversion-side-note" data-run-history-note="unreadable">{t("runHistoryUnreadable", { count: listed.unreadable })}</p>}
    {listed.newer === 0 ? null : <p className="conversion-side-note" data-run-history-note="newer">{t("runHistoryNewer", { count: listed.newer })}</p>}
  </>;
}

/**
 * What was converted, as recorded (RUN-007, ADR 0065): every run newest first in
 * the rail, one run's items in the main column, in the conversion surface's own
 * two columns. Reads only: nothing is opened, resumed or run again from here,
 * and no path reaches this document.
 */
export function ConversionHistory({ catalog, queueState, onClose }: {
  readonly catalog: readonly ConversionCatalogRow[];
  /** The queue's state, so a run that started or ended while this is open is read again. */
  readonly queueState: string;
  readonly onClose: () => void;
}): ReactElement {
  const t = useUiMessages();
  const api = useRunHistoryApi();
  const list = useRunList();
  const { reload } = list;
  const clear = useRunWrite("clear");
  const reasonId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [read, setRead] = useState<RunRead>({ outcome: "reading" });

  const listed = list.answer?.outcome === "listed" ? list.answer : null;
  const runs = useMemo(() => listed?.runs ?? [], [listed]);
  // A run that is gone, or none chosen yet, reads as the newest.
  const selected = runs.find((run) => run.runId === chosen) ?? runs[0] ?? null;
  const selectedId = selected?.runId ?? null;

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (confirming) keepButton.current?.focus(); }, [confirming]);
  const firstQueueState = useRef(queueState);
  useEffect(() => {
    if (firstQueueState.current === queueState) return;
    firstQueueState.current = queueState;
    reload();
  }, [queueState, reload]);

  useEffect(() => {
    if (selectedId === null) return;
    let retired = false;
    // The same run read again stays on screen, so nothing the reader is in is
    // taken away by a read they did not ask for: the queue changing state starts one.
    setRead((held) => (held.outcome === "found" && held.run.runId === selectedId ? held : { outcome: "reading" }));
    void api.readRun(selectedId).then(
      (answer) => { if (!retired) setRead(answer); },
      (cause: unknown) => { if (!retired) setRead({ outcome: "error", error: toPreviewError(cause) }); },
    );
    return () => { retired = true; };
  }, [api, selectedId, list.revision]);

  const clearReason = clear.writing ? t("runHistoryClearing")
    : list.reading ? t("runHistoryReading")
      // Runs still on screen from an earlier read are not what the store holds now.
      : listed === null || list.error !== null ? t("runHistoryClearNotRead")
        : runs.length === 0 && listed.unreadable === 0 ? t("runHistoryClearNothing")
          : null;
  const clearProblem = writeProblem(clear.answer, t);
  // Said beside the reason it can now leave, "Nothing to clear" above all.
  const cleared = clear.answer?.outcome !== "done" ? ""
    : clear.answer.keptInProgress === 0 ? t("runHistoryCleared") : t("runHistoryClearedKept", { count: clear.answer.keptInProgress });
  const keep = () => {
    setConfirming(false);
    clearButton.current?.focus();
  };
  const forget = () => {
    keep();
    clear.write(() => api.clearRuns());
  };

  return (
    <section className="conversion-panel run-history" aria-labelledby="run-history-heading" data-phase="history" data-run-history="">
      {/* First in the document though it is drawn on the right (runHistory.css),
          so the keyboard goes from a run to what it recorded. */}
      <div className="conversion-side">
        <h2 id="run-history-heading" ref={heading} tabIndex={-1}>{t("runHistoryTitle")}</h2>
        <div className="conversion-actions run-history-actions">
          <Button size="sm" icon={<Icon name="arrowLeft" />} data-run-history-back="" onClick={onClose}>{t("runHistoryBack")}</Button>
          <Button size="sm" icon={<Icon name="refresh" />} data-run-history-refresh="" refused={list.reading} reasonId={list.reading ? reasonId : undefined}
            onClick={reload}>{t("runHistoryRefresh")}</Button>
        </div>
        {listed === null ? null : <ListNotices listed={listed} />}
        {runs.length === 0 ? null : <RunRows runs={runs} selectedId={selectedId} onSelect={setChosen} />}
        {/* The rail's foot, pinned like Convert's. The attribute keeps its padding. */}
        <div className="conversion-rail-foot" data-start-offered="">
          {confirming ? (
            <div className="run-history-confirm" role="group" aria-labelledby={`${reasonId}-ask`} data-run-history-confirm=""
              onKeyDown={(event) => { if (event.key === "Escape") keep(); }}>
              <p id={`${reasonId}-ask`}>{t("runHistoryClearAsk")}</p>
              <div className="conversion-actions">
                <Button variant="danger" size="sm" data-run-history-forget="" refused={clearReason !== null} reasonId={reasonId} onClick={forget}>{t("runHistoryClearConfirm")}</Button>
                <Button size="sm" ref={keepButton} data-run-history-keep="" onClick={keep}>{t("runHistoryClearKeep")}</Button>
              </div>
            </div>
          ) : null}
          <Button className="conversion-wide-action" ref={clearButton} data-run-history-clear="" aria-expanded={confirming}
            refused={clearReason !== null} reasonId={reasonId} onClick={() => setConfirming((open) => !open)}>{t("runHistoryClear")}</Button>
          <p id={reasonId} className="conversion-side-note" role="status" data-run-history-clear-status="">
            {joinSentences(t, [cleared, clearReason ?? ""])}
          </p>
          {clearProblem === null ? null : <p className="notice notice-danger" role="alert" data-run-history-clear-problem="">{clearProblem}</p>}
        </div>
      </div>
      <div className="conversion-main">
        {list.error !== null ? (
          <div className="notice notice-danger" role="alert" data-run-history-problem="error">
            <span>{explainRunHistoryError(list.error, t)}</span>
          </div>
        ) : null}
        {list.answer?.outcome === "unavailable" ? (
          <div className="notice notice-warning" role="alert" data-run-history-problem={list.answer.problem}>
            <span>{explainRunHistoryProblem(list.answer.problem, t)}</span>
          </div>
        ) : null}
        {selected !== null ? <RunDetail run={selected} read={read} catalog={catalog} /> : null}
        {selected === null && list.answer === null && list.error === null
          ? <p className="conversion-side-note" role="status" data-run-history-loading="">{t("runHistoryReading")}</p> : null}
        {selected === null && listed !== null ? (
          <EmptyState className="run-history-empty" message={t(listed.recording ? "runHistoryEmpty" : "runHistoryRecordingOff")} />
        ) : null}
      </div>
    </section>
  );
}
