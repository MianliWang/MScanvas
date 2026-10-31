import { memo } from "react";
import { Button, Icon, IconButton, Toolbar } from "../../components/ui";
import { usePlotRangeEditor } from "./PlotRangeActions";
import { figureRefusal, QuickFigureActions } from "./QuickFigureActions";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";
import type { CopiedFigure, ExportedFigure, ExportedSpectrumRange, PreviewError, SelectedSpectrum,
  SpectrumExportFormat } from "./contracts";
import type { FigureSettingsValidation } from "./figureSettingsValidation";
import { formatCount, REPRESENTATION } from "./format";
import { SpectrumViewport, SpectrumZoomControls } from "./SpectrumViewport";
import type { SpectrumExportState, SpectrumState } from "./usePreviewWorkspace";
import type { SpectrumViewportEvent, SpectrumViewportState } from "./viewer/spectrumViewport";

export interface SelectedSpectrumPanelProps {
  readonly onOpenFigure: () => void;
  readonly state: SpectrumState;
  readonly onRetry: () => void;
  /** Opens the file again, for a spectrum refused because its preview is gone or no longer matches. */
  readonly onReopen?: () => void;
  /** Whether opening the file again can start now, and the visible sentence that says why not. */
  readonly canReopen?: boolean;
  readonly reopenReasonId?: string;
  /**
   * Why a scan cannot be chosen now, said once, in the empty spectrum, in
   * place of the instruction to choose one (S4).
   */
  readonly selectionRefusal?: string | null;
  readonly viewport: SpectrumViewportState;
  readonly dispatchViewport: (event: SpectrumViewportEvent) => SpectrumViewportState;
  readonly readViewport: () => SpectrumViewportState;
  readonly projectionError: PreviewError | null;
  readonly onRetryProjection: () => void;
  readonly exportState: SpectrumExportState;
  readonly scientificExportBusy: boolean;
  readonly onExport: (format: SpectrumExportFormat) => void;
  readonly onCopyPlot: () => void;
  readonly onDismissExport: () => void;
  readonly figureSettingsValidation: FigureSettingsValidation;
  /**
   * Steps to the scan before or after the selected one, in the scan table's
   * order. In the spectrum's head (direction A), beside the scan they change.
   */
  readonly onSelectPrevious?: () => void;
  readonly onSelectNext?: () => void;
  readonly canSelectPrevious?: boolean;
  readonly canSelectNext?: boolean;
  /** The visible sentence that says why a step is refused, while one is. */
  readonly stepReasonId?: string;
}

/** The scan line between the steps. */
const SCAN_ID = "selected-spectrum-scan";

/** Spectrum refusals whose recovery is opening the file again (ADR 0056). */
const REOPEN_KINDS = new Set(["preview_not_open", "spectrum_not_as_recorded", "source_changed_since_preview"]);

/**
 * The selected spectrum (direction A): a head with the title, the scan and its
 * steps, the scan's MS level and size, and one toolbar (m/z range, then the
 * figure); the plot; and over the plot's corner, what the last export did.
 * Range, size and theme are the figure dialog's; the spectrum's facts are in
 * Details.
 */
export const SelectedSpectrumPanel = memo(function SelectedSpectrumPanel(props: SelectedSpectrumPanelProps) {
  const t = useUiMessages();
  const { state, exportState } = props;
  const reason = figureRefusal(t, props.scientificExportBusy, props.figureSettingsValidation);
  const rangeEditor = usePlotRangeEditor();
  const spectrum = state.status === "loaded" ? state.spectrum : null;
  // With no spectrum, the line between the steps ("No spectrum selected") is
  // why neither can move; otherwise the table's own sentence, where it has one.
  const stepReasonId = props.stepReasonId ?? (spectrum === null ? SCAN_ID : undefined);
  return <section aria-labelledby="selected-spectrum-heading" className="plot-box spectrum-panel">
    <div className="plot-head">
      <h2 id="selected-spectrum-heading">{t("viewerSpectrum")}</h2>
      <div className="spectrum-stepper" role="group" aria-label={t("scanNavigation")}>
        <IconButton icon={<Icon name="chevronUp" />} label={t("scanPrevious")} onClick={props.onSelectPrevious}
          refused={props.canSelectPrevious !== true} reasonId={stepReasonId} size="sm" variant="secondary" />
        <span className="spectrum-scan" id={SCAN_ID}>{spectrum === null ? describe(state, t) : spectrum.scanNumber === null
          ? t("viewerSpectrumIndex", { index: formatCount(spectrum.index) }) : `${t("scanColumnScan")} ${formatCount(spectrum.scanNumber)}`}</span>
        <IconButton icon={<Icon name="chevronDown" />} label={t("scanNext")} onClick={props.onSelectNext}
          refused={props.canSelectNext !== true} reasonId={stepReasonId} size="sm" variant="secondary" />
      </div>
      {spectrum === null ? null : <p className="spectrum-head-facts">
        <span>{`MS${spectrum.msLevel}`}</span>
        {/* What the file declares (P5): profile is drawn as a line, the rest as sticks. */}
        <span>{t(spectrum.representation === "notReported" ? "viewerRepresentationNotReported" : REPRESENTATION[spectrum.representation])}</span>
        <span>{t("viewerExportPoints", { count: spectrum.pointCount })}</span>
      </p>}
      {/* The plot's accessible name, in one sentence. */}
      {spectrum === null ? null : <p className="visually-hidden" id="selected-spectrum-summary">{t("viewerSpectrumSummary", {
        index: formatCount(spectrum.index), level: formatCount(spectrum.msLevel), count: spectrum.pointCount })}</p>}
      {/* An export's result, on the head's line beside its tools, never over
          the plot's data. Mounted always, so its status is heard. */}
      <div className="plot-status">
        <div className="plot-status-line">
          <p className="spectrum-export-status" role="status" title={describeSpectrumExport(exportState, t) || undefined}>
            {describeSpectrumExport(exportState, t)}
            {exportState.status === "failed" && exportState.error.detail !== null ?
              <span className="notice-detail">{ownedErrorDetail(exportState.error, t)}</span> : null}
          </p>
          {["saved", "copied", "cancelled", "failed"].includes(exportState.status) ?
            <IconButton icon={<Icon name="close" />} label={t("viewerDismissExport")} onClick={props.onDismissExport} size="sm" /> : null}
        </div>
      </div>
      {spectrum === null ? null : <Toolbar className="plot-tools" label={t("plotSpectrumTools")} roving>
        {spectrum.pointCount === 0 ? null : <>
          <SpectrumZoomControls dispatch={props.dispatchViewport} readState={props.readViewport} state={props.viewport} />
          <span aria-hidden="true" className="plot-tools-divider" />
        </>}
        <QuickFigureActions busy={props.scientificExportBusy} figureUnavailable={props.figureSettingsValidation.render !== null}
          pngUnavailable={props.figureSettingsValidation.dpi !== null} reason={reason}
          leadingItems={spectrum.pointCount === 0 ? [] : [rangeEditor.item]}
          onPreview={props.onOpenFigure} onPng={() => props.onExport("png")} onCopy={props.onCopyPlot}
          menuItems={(["csv", "tsv"] as const).map(format => ({ key: format, label: t("viewerExportFormat", { name: format.toUpperCase() }),
            // Refused while any scientific export runs: Rust holds one lane.
            refused: props.scientificExportBusy, reason: props.scientificExportBusy ? t("plotExportBusy") : null,
            onSelect: () => { props.onExport(format); } }))} />
      </Toolbar>}
    </div>
    {/* An absent spectrum has no body: the head's line already says it is not in this run. */}
    {state.status === "unavailable" ? null : <div className="spectrum-body">{renderBody(state, props.onRetry, props, rangeEditor, t)}</div>}
  </section>;
});

function describeFigure(figure: ExportedFigure | CopiedFigure, t: UiMessage): string {
  return t("viewerFigureSize", { width: formatCount(figure.width), height: formatCount(figure.height), theme: t(figure.theme) }) +
    ("dpi" in figure && figure.dpi !== null ? `, ${formatCount(figure.dpi)} DPI` : "");
}
function describeExportedRange(state: ExportedSpectrumRange, t: UiMessage): string {
  return state.rangeScope === "full" || state.rangeLow === null || state.rangeHigh === null ?
    t("viewerExportPoints", { count: state.sourcePointCount }) :
    t("viewerExportPointRange", { count: state.exportedPointCount, total: state.sourcePointCount,
      low: String(state.rangeLow), high: String(state.rangeHigh) });
}
export function describeSpectrumExport(state: SpectrumExportState, t: UiMessage): string {
  switch (state.status) {
    case "idle": return "";
    case "running": return state.operation === "copy" ? t("viewerCopying") : t("viewerExportChoose", { name: state.operation.toUpperCase() });
    case "cancelled": return t("viewerExportCancelled");
    case "saved": return t("viewerExportSaved", { name: state.fileName, details: describeExportedRange(state, t) +
      (state.figure === null ? "" : `, ${describeFigure(state.figure, t)}`) });
    case "copied": return t("viewerExportCopied", { details: `${describeExportedRange(state, t)}, ${describeFigure(state.figure, t)}` });
    case "failed": return ownedErrorMessage(state.error, t);
  }
}
function describe(state: SpectrumState, t: UiMessage): string {
  switch (state.status) {
    case "none": return t("viewerSpectrumNone");
    case "loading": return t("viewerSpectrumLoading", { index: formatCount(state.index) });
    case "loaded": return t("viewerSpectrumIndex", { index: formatCount(state.spectrum.index) });
    case "unavailable": return t("viewerSpectrumAbsent", { index: formatCount(state.requestedIndex) });
    case "failed": return t("viewerSpectrumFailed", { index: formatCount(state.index) });
  }
}
function renderBody(state: Exclude<SpectrumState, { readonly status: "unavailable" }>, onRetry: () => void, binding: SelectedSpectrumPanelProps,
  rangeEditor: ReturnType<typeof usePlotRangeEditor>, t: UiMessage) {
  switch (state.status) {
    case "none": return <div className="empty-state"><span>{binding.selectionRefusal ?? t("viewerChooseHelp")}</span></div>;
    case "loading": return <div className="empty-state"><strong>{t("viewerSpectrumLoading", { index: formatCount(state.index) })}</strong></div>;
    case "failed": return <div className="empty-state"><strong>{ownedErrorMessage(state.error, t)}</strong>
      {ownedErrorDetail(state.error, t) === null ? null : <span>{ownedErrorDetail(state.error, t)}</span>}
      {state.error.retryable ? <Button onClick={onRetry} size="sm">{t("viewerSpectrumRetry")}</Button>
        : REOPEN_KINDS.has(state.error.kind) && binding.onReopen !== undefined
          ? <Button onClick={binding.onReopen} refused={binding.canReopen === false} reasonId={binding.reopenReasonId} size="sm">
            {t("viewerReopenFile")}</Button> : null}</div>;
    case "loaded": return <SpectrumDetail binding={binding} rangeEditor={rangeEditor} spectrum={state.spectrum} />;
  }
}
function SpectrumDetail({ spectrum, binding, rangeEditor }: { readonly spectrum: SelectedSpectrum; readonly binding: SelectedSpectrumPanelProps;
  readonly rangeEditor: ReturnType<typeof usePlotRangeEditor> }) {
  const t = useUiMessages();
  return <>
    {spectrum.pointCount === 0 ? <div className="empty-state"><strong>{t("viewerSpectrumEmpty")}</strong><span>{t("viewerSpectrumEmptyHelp")}</span></div> :
      <SpectrumViewport dispatch={binding.dispatchViewport} intensity={spectrum.intensity} labelledBy="selected-spectrum-summary" mz={spectrum.mz}
        onRetryProjection={binding.onRetryProjection} projectionError={binding.projectionError} readState={binding.readViewport}
        reportedMzHigh={spectrum.mzHigh} reportedMzLow={spectrum.mzLow}
        rangeEditing={rangeEditor.editing} onRangeEditorClose={rangeEditor.close}
        representation={spectrum.representation} mzUnit={spectrum.mzUnit} intensityUnit={spectrum.intensityUnit}
        state={binding.viewport} />}
    {spectrum.truncated ? <p className="notice notice-warning" role="note">
      {t(binding.viewport.status === "ready" ? "viewerSpectrumPrefixRetained" : "viewerSpectrumPrefix",
        { count: spectrum.mz.length, total: spectrum.pointCount })}
    </p> : null}
  </>;
}
