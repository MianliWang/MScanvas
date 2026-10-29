import { memo } from "react";
import { Button, Icon, IconButton, Toolbar } from "../../components/ui";
import { figureRefusal, QuickFigureActions } from "./QuickFigureActions";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";
import type { CopiedFigure, ExportedFigure, ExportedSpectrumRange, PreviewError, SelectedSpectrum,
  SpectrumExportFormat } from "./contracts";
import type { FigureSettingsValidation } from "./figureSettingsValidation";
import { formatCount } from "./format";
import { SpectrumViewport, SpectrumZoomControls } from "./SpectrumViewport";
import type { SpectrumExportState, SpectrumState } from "./usePreviewWorkspace";
import type { SpectrumViewportEvent, SpectrumViewportState } from "./viewer/spectrumViewport";

export interface SelectedSpectrumPanelProps {
  readonly onOpenFigure: () => void;
  readonly state: SpectrumState;
  readonly onRetry: () => void;
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
}

/** Where the spectrum says why PNG or Copy is refused. */
const REASON_ID = "spectrum-figure-reason";

/**
 * The selected spectrum as a v5.11 plot box: a head with the title, the
 * spectrum's summary and one toolbar (m/z range, then the figure), the plot,
 * and a foot that says what the last export did. Range, size and theme are the
 * figure dialog's; the spectrum's facts are in Details.
 */
export const SelectedSpectrumPanel = memo(function SelectedSpectrumPanel(props: SelectedSpectrumPanelProps) {
  const t = useUiMessages();
  const { state, exportState } = props;
  const reason = figureRefusal(t, props.scientificExportBusy, props.figureSettingsValidation);
  return <section aria-labelledby="selected-spectrum-heading" className="panel plot-box spectrum-panel">
    <div className="plot-head">
      <h2 id="selected-spectrum-heading">{t("viewerSpectrum")}</h2>
      {state.status === "loaded" ? <p className="spectrum-summary" id="selected-spectrum-summary">{t("viewerSpectrumSummary", {
        index: formatCount(state.spectrum.index), level: formatCount(state.spectrum.msLevel), count: state.spectrum.pointCount })}</p> :
        <p className="spectrum-summary">{describe(state, t)}</p>}
      {state.status === "loaded" ? <Toolbar className="plot-tools" label={t("plotSpectrumTools")} roving>
        {state.spectrum.pointCount === 0 ? null : <>
          <SpectrumZoomControls dispatch={props.dispatchViewport} readState={props.readViewport} state={props.viewport} />
          <span aria-hidden="true" className="plot-tools-divider" />
        </>}
        <QuickFigureActions busy={props.scientificExportBusy} figureUnavailable={props.figureSettingsValidation.render !== null}
          pngUnavailable={props.figureSettingsValidation.dpi !== null} reasonId={REASON_ID}
          onPreview={props.onOpenFigure} onPng={() => props.onExport("png")} onCopy={props.onCopyPlot}
          menuItems={(["csv", "tsv"] as const).map(format => ({ key: format, label: t("viewerExportFormat", { name: format.toUpperCase() }),
            // Refused while any scientific export runs: Rust holds one lane.
            refused: props.scientificExportBusy, reason: props.scientificExportBusy ? t("plotExportBusy") : null,
            onSelect: () => { props.onExport(format); } }))} />
      </Toolbar> : null}
    </div>
    {/* An absent spectrum has no body: the head's line already says it is not in this run. */}
    {state.status === "unavailable" ? null : <div className="spectrum-body">{renderBody(state, props.onRetry, props, t)}</div>}
    <div className="plot-status">
      {state.status === "loaded" && reason !== null ? <p className="plot-reason" id={REASON_ID}>{reason}</p> : null}
      <div className="plot-status-line">
        <p className="spectrum-export-status" role="status">
          {describeSpectrumExport(exportState, t)}
          {exportState.status === "failed" && exportState.error.detail !== null ?
            <span className="notice-detail">{ownedErrorDetail(exportState.error, t)}</span> : null}
        </p>
        {["saved", "copied", "cancelled", "failed"].includes(exportState.status) ?
          <IconButton icon={<Icon name="close" />} label={t("viewerDismissExport")} onClick={props.onDismissExport} size="sm" /> : null}
      </div>
    </div>
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
function renderBody(state: Exclude<SpectrumState, { readonly status: "unavailable" }>, onRetry: () => void, binding: SelectedSpectrumPanelProps, t: UiMessage) {
  switch (state.status) {
    case "none": return <div className="empty-state"><span>{t("viewerChooseHelp")}</span></div>;
    case "loading": return <div className="empty-state"><strong>{t("viewerSpectrumLoading", { index: formatCount(state.index) })}</strong></div>;
    case "failed": return <div className="empty-state"><strong>{ownedErrorMessage(state.error, t)}</strong>
      {ownedErrorDetail(state.error, t) === null ? null : <span>{ownedErrorDetail(state.error, t)}</span>}
      {state.error.retryable ? <Button onClick={onRetry} size="sm">{t("viewerSpectrumRetry")}</Button> : null}</div>;
    case "loaded": return <SpectrumDetail binding={binding} spectrum={state.spectrum} />;
  }
}
function SpectrumDetail({ spectrum, binding }: { readonly spectrum: SelectedSpectrum; readonly binding: SelectedSpectrumPanelProps }) {
  const t = useUiMessages();
  return <>
    {spectrum.pointCount === 0 ? <div className="empty-state"><strong>{t("viewerSpectrumEmpty")}</strong><span>{t("viewerSpectrumEmptyHelp")}</span></div> :
      <SpectrumViewport dispatch={binding.dispatchViewport} intensity={spectrum.intensity} labelledBy="selected-spectrum-summary" mz={spectrum.mz}
        onRetryProjection={binding.onRetryProjection} projectionError={binding.projectionError} readState={binding.readViewport}
        reportedMzHigh={spectrum.mzHigh} reportedMzLow={spectrum.mzLow}
        valueUnitsKnown={spectrum.valueUnitsKnown} state={binding.viewport} />}
    {spectrum.truncated ? <p className="notice notice-warning" role="note">
      {t(binding.viewport.status === "ready" ? "viewerSpectrumPrefixRetained" : "viewerSpectrumPrefix", { count: spectrum.mz.length })}
    </p> : null}
  </>;
}
