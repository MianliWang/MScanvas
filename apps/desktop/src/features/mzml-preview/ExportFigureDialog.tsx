import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { Button, Icon, IconButton, SegmentedControl } from "../../components/ui";
import type { FigurePreviewKind, FigurePreviewOutcome, FigurePreviewQuestion, FigurePreviewRequest, FigureTheme, SpectrumRangeAvailability } from "./contracts";
import { dpiProblemId, FigureSettingsFields } from "./FigureSettingsFields";
import { ownedErrorMessage } from "./ownedErrorMessages";
import type { FigureSettingsValidation } from "./figureSettingsValidation";
import type { FigureSettingsDraft, FigureSettingsField } from "./usePreviewWorkspace";

type PreviewState =
  | { readonly status: "none" | "loading" | "failed"; readonly key: string }
  | { readonly status: "answered"; readonly key: string; readonly answer: FigurePreviewOutcome };

export interface ExportFigureDialogProps {
  readonly kind: FigurePreviewKind;
  readonly sourceLabel: string;
  readonly question: FigurePreviewQuestion | null;
  readonly preview: (request: FigurePreviewRequest) => Promise<FigurePreviewOutcome>;
  readonly onExport: (question: FigurePreviewQuestion, format: "svg" | "png") => boolean;
  readonly onCopy: (question: FigurePreviewQuestion) => boolean;
  readonly onClose: () => void;
  readonly returnTo: HTMLElement | null;
  readonly busy: boolean;
  readonly result: ReactNode;
  readonly settings: FigureSettingsDraft;
  readonly validation: FigureSettingsValidation;
  readonly onSetting: (field: FigureSettingsField, value: string) => void;
  readonly onTheme: (theme: FigureTheme) => void;
  readonly scope: "current" | "full";
  readonly onScope: (scope: "current" | "full") => void;
  /** Whether "Current range" can be chosen; a run (chromatogram, linked) always can. */
  readonly rangeAvailability: SpectrumRangeAvailability;
  /** The committed window "Current range" covers; null when none narrower than the source is committed. */
  readonly committedDomain: { readonly low: number; readonly high: number } | null;
  /** The data export of the same source and range (spectrum and chromatogram; never linked). */
  readonly onExportData?: (format: "csv" | "tsv") => void;
  /** Why the lane would refuse this figure now, or `null`: shown beside the actions it refuses. */
  readonly refusal?: string | null;
}

/** One current question; old answers never grant a matching-preview action. */
export function ExportFigureDialog(props: ExportFigureDialogProps) {
  const t = useUiMessages();
  const id = useId();
  const questionKey = JSON.stringify(props.question);
  const source = props.question?.source;
  const sourceKey = source === undefined ? null : source.kind === "linked"
    ? JSON.stringify([source.kind, source.chromatogramToken, source.spectrumToken])
    : JSON.stringify([source.kind, source.token]);
  const [acceptedSource, setAcceptedSource] = useState(sourceKey);
  const sourceChanged = sourceKey !== null && acceptedSource !== null && sourceKey !== acceptedSource;
  const version = useRef({ questionKey, value: 0 });
  if (version.current.questionKey !== questionKey) version.current = { questionKey, value: version.current.value + 1 };
  const key = `${version.current.value}:${questionKey}`;
  const desired = useRef({ key, question: props.question });
  desired.current = { key, question: sourceChanged ? null : props.question };
  const [state, setState] = useState<PreviewState>({ status: "none", key: "" });
  const [refresh, setRefresh] = useState(0);
  const live = useRef(true);
  const processing = useRef(false);
  const sequence = useRef(0);
  const dispatched = useRef(false);
  const content = useRef<HTMLDivElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const renderer = useRef(props.preview);
  renderer.current = props.preview;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (acceptedSource === null && sourceKey !== null) setAcceptedSource(sourceKey); }, [acceptedSource, sourceKey]);
  useEffect(() => { if (!props.busy) dispatched.current = false; }, [props.busy]);
  useEffect(() => {
    if (processing.current) return;
    const drain = async () => {
      processing.current = true;
      try {
        while (live.current) {
          const next = desired.current;
          if (next.question === null) { setState({ status: "none", key: next.key }); break; }
          const requestId = ++sequence.current;
          setState({ status: "loading", key: next.key });
          try {
            const answer = await renderer.current({ ...next.question, requestId });
            if (!live.current) break;
            if (desired.current.key === next.key) {
              setState(answer.requestId === requestId ? { status: "answered", key: next.key, answer } : { status: "failed", key: next.key });
            }
          } catch {
            if (live.current && desired.current.key === next.key) setState({ status: "failed", key: next.key });
          }
          if (desired.current.key === next.key) break;
        }
      } finally { processing.current = false; }
    };
    void drain();
  }, [key, refresh, acceptedSource]);
  const artifact = !sourceChanged && state.status === "answered" && state.key === key && state.answer.status === "rendered" ? state.answer : null;
  const stale = sourceChanged || state.key !== key;
  // The last drawing stays on screen while the next one for the same source is
  // on its way, so a settings change does not collapse the dialog. A failure,
  // a refusal or another source clears it. Export still needs `artifact`.
  const successorPending = !sourceChanged && (state.status === "loading" || (stale && state.status === "answered"));
  const [shown, setShown] = useState<{ readonly url: string; readonly artifact: NonNullable<typeof artifact> } | null>(null);
  useEffect(() => {
    if (artifact === null) { if (!successorPending) setShown(null); return; }
    // Image context is inert: no innerHTML, object/embed, script, or DOM SVG.
    setShown({ url: URL.createObjectURL(new Blob([artifact.svg], { type: "image/svg+xml" })), artifact });
  }, [artifact, successorPending]);
  // Revoked when replaced or unmounted, not when the answer goes stale.
  useEffect(() => () => { if (shown !== null) URL.revokeObjectURL(shown.url); }, [shown]);
  const error = !stale && state.status === "answered" && state.answer.status === "refused" ? state.answer.error : null;
  const status = sourceChanged ? t("figurePreviewSourceChanged") : stale ? t("figurePreviewStale") : state.status === "none" ? t("figurePreviewNone") : state.status === "loading" ? t("figurePreviewLoading") : state.status === "failed" ? t("figurePreviewFailed") : error ? ownedErrorMessage(error, t) : artifact?.empty ? t("figurePreviewEmpty") : t("figurePreviewCurrent");
  // A figure the lane would refuse is refused here, with its reason beside the
  // actions, so a press never reaches a dispatch that starts nothing and
  // leaves the dialog waiting on a lane that never became busy.
  const refusal = props.refusal ?? null;
  const save = (format: "svg" | "png") => {
    if (dispatched.current || props.busy || artifact === null || refusal !== null || props.question === null || (format === "png" && props.validation.dpi !== null)) return;
    dispatched.current = props.onExport(props.question, format);
    if (!dispatched.current) setState({ status: "none", key: "" });
  };
  const prefix = `export-${id}`;
  const ids = { range: `${id}-range`, rangeNote: `${id}-range-note`, data: `${id}-data`, dataNote: `${id}-data-note`, status: `${id}-status`, result: `${id}-result`,
    refusal: `${id}-refusal` };
  // A refused action points at the visible line that says why: the preview
  // status (no current drawing, or one rendering) and, while an export runs,
  // the result line, which then says what that export is waiting on. An
  // up-to-date preview says so only to a screen reader, so it is no reason.
  const busyReason = status === t("figurePreviewCurrent") ? ids.result : `${ids.status} ${ids.result}`;
  const figureReason = props.busy ? busyReason : refusal !== null && artifact !== null ? ids.refusal : ids.status;
  const figureRefused = props.busy || artifact === null || refusal !== null;
  const rangeWindow = props.committedDomain === null ? null : t(props.kind === "spectrum" ? "viewerExportMzWindow" : "viewerExportRtWindow",
    { low: props.committedDomain.low.toFixed(4), high: props.committedDomain.high.toFixed(4) });
  const rangeNote = props.rangeAvailability === "noPeaks" ? t("viewerExportNoPeaks") : props.rangeAvailability === "noViewport" ? t("viewerExportNoViewport") : null;
  const onExportData = props.kind === "linked" ? undefined : props.onExportData;
  return <Dialog.Root open onOpenChange={open => { if (!open) props.onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="settings-overlay" />
      <Dialog.Content className="figure-export-dialog" ref={content} aria-describedby={undefined}
        onOpenAutoFocus={event => { event.preventDefault(); close.current?.focus(); }}
        onCloseAutoFocus={event => {
          event.preventDefault(); const active = document.activeElement;
          if (document.hasFocus() && (active === document.body || active === props.returnTo || (active !== null && content.current?.contains(active))) && props.returnTo?.isConnected && !props.returnTo.closest("[hidden], [inert]")) props.returnTo.focus();
        }} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.stopImmediatePropagation()}>
        <header className="figure-export-head">
          <div className="figure-export-heading"><Dialog.Title>{t("figureExportTitle")}</Dialog.Title>
            <p className="figure-export-source" title={props.sourceLabel}>{props.sourceLabel}</p></div>
          <IconButton ref={close} icon={<Icon name="close" />} label={t("figureExportReturn")} onClick={props.onClose} />
        </header>
        <div className="figure-export-body">
          {/* Never native-disabled: while the source has changed every handler
              below ignores its input, and the status line says why (B4). */}
          <fieldset className="figure-export-options">
            <div className="figure-export-section">
              <span className="figure-export-label" id={ids.range}>{t(props.kind === "spectrum" ? "viewerExportScope" : "viewerExportRunScope")}</span>
              {/* A spectrum with nothing to narrow to has one range: "Current" is
                  refused, the group stays a Tab stop, and the line under it says why. */}
              <SegmentedControl labelledBy={ids.range} className="figure-export-range" value={props.scope} reasonId={ids.rangeNote}
                options={[
                  { value: "current", refused: rangeNote !== null,
                    label: <>{t("viewerExportCurrent")}{rangeWindow === null ? null : <>{" "}<span className="figure-export-window">{rangeWindow}</span></>}</> },
                  { value: "full", label: t(props.kind === "spectrum" ? "viewerExportFull" : "viewerExportFullRun") },
                ]} onChange={scope => { if (!sourceChanged) props.onScope(scope); }} />
              {rangeNote === null ? null : <p className="figure-export-note" id={ids.rangeNote}>{rangeNote}</p>}
            </div>
            <FigureSettingsFields idPrefix={prefix} settings={props.settings} validation={props.validation} onFigureSetting={(field, value) => { if (!sourceChanged) props.onSetting(field, value); }} onFigureTheme={theme => { if (!sourceChanged) props.onTheme(theme); }} />
            {onExportData === undefined ? null : <div className="figure-export-section figure-export-data" role="group" aria-labelledby={ids.data}>
              <span className="figure-export-label" id={ids.data}>{t("viewerData")}</span>
              <div className="figure-export-data-actions">{(["csv", "tsv"] as const).map(format => <Button key={format} size="sm"
                aria-describedby={props.kind === "chromatogram" ? ids.dataNote : undefined}
                refused={props.busy || sourceChanged} reasonId={props.busy ? busyReason : ids.status}
                onClick={() => { if (!props.busy && !sourceChanged) onExportData(format); }}>
                {t("viewerExportFormat", { name: format.toUpperCase() })}</Button>)}</div>
              {/* What a chromatogram data document holds, which the traces on screen do not change. */}
              {props.kind === "chromatogram" ? <p className="figure-export-note" id={ids.dataNote}>{t("viewerExportTraceHelp")}</p> : null}
            </div>}
          </fieldset>
          <div className="figure-preview" aria-busy={state.status === "loading"}>
            {/* The frame keeps its size whatever it holds, and the last drawing
                stays (dimmed) while the next one renders, so nothing moves. */}
            <div className="figure-preview-frame" data-pending={successorPending || undefined}>
              {shown ? <img src={shown.url} alt={t("figurePreviewAlt")} data-spec-id={shown.artifact.specId} width={shown.artifact.width} height={shown.artifact.height} /> : <div className="figure-preview-placeholder" aria-hidden="true" />}
            </div>
            {/* One line of fixed height: up to date is worth saying only to a screen
                reader; any other status is worth seeing, with its recovery beside it. */}
            <div className="figure-preview-status-row">
              <p role="status" className="figure-preview-status" id={ids.status}>{status === t("figurePreviewCurrent") ? <span className="visually-hidden">{status}</span> : status}</p>
              {error || state.status === "failed" || (stale && !successorPending) ? <Button size="sm" refused={props.busy || processing.current} reasonId={figureReason}
                onClick={() => { if (sourceChanged) setAcceptedSource(sourceKey); setRefresh(value => value + 1); }}>{t(sourceChanged ? "figurePreviewUseSource" : "figurePreviewRefresh")}</Button> : null}
            </div>
          </div>
        </div>
        <footer className="figure-export-foot">
          {refusal === null ? null : <p className="figure-export-refusal" id={ids.refusal}>{refusal}</p>}
          <div className="figure-export-result" id={ids.result}>{props.result}</div>
          <div className="figure-export-actions">
            <Button refused={figureRefused} reasonId={figureReason} onClick={() => {
              if (!dispatched.current && !props.busy && artifact !== null && refusal === null && props.question !== null) dispatched.current = props.onCopy(props.question);
            }}>{t("viewerCopy")}</Button>
            {(["svg", "png"] as const).map(format => {
              const dpiRefused = format === "png" && props.validation.dpi !== null;
              return <Button key={format} variant={format === "png" ? "primary" : "secondary"} refused={figureRefused || dpiRefused}
                reasonId={dpiRefused ? `${figureReason} ${dpiProblemId(prefix)}` : figureReason}
                onClick={() => save(format)}>{t("viewerExportFormat", { name: format.toUpperCase() })}</Button>;
            })}
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
