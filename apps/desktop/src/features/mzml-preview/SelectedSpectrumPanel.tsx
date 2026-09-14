import { memo } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";
import type { CopiedFigure, ExportedFigure, ExportedSpectrumRange, FigureTheme, PreviewError, SelectedSpectrum,
  SpectrumExportFormat, SpectrumRangeAvailability, SpectrumRangeScope } from "./contracts";
import { FigureSettingsFields } from "./FigureSettingsFields";
import type { FigureSettingsValidation } from "./figureSettingsValidation";
import { formatCount, formatIntensity, formatMz } from "./format";
import { SpectrumViewport } from "./SpectrumViewport";
import type { FigureSettingsDraft, FigureSettingsField, SpectrumExportState, SpectrumState } from "./usePreviewWorkspace";
import type { MzDomain, SpectrumViewportEvent, SpectrumViewportState } from "./viewer/spectrumViewport";

export interface SelectedSpectrumPanelProps {
  readonly state: SpectrumState;
  readonly onRetry: () => void;
  readonly viewport: SpectrumViewportState;
  readonly dispatchViewport: (event: SpectrumViewportEvent) => SpectrumViewportState;
  readonly readViewport: () => SpectrumViewportState;
  readonly projectionError: PreviewError | null;
  readonly onRetryProjection: () => void;
  readonly exportState: SpectrumExportState;
  readonly scientificExportBusy: boolean;
  readonly rangeScope: SpectrumRangeScope;
  readonly onRangeScope: (scope: SpectrumRangeScope) => void;
  readonly rangeAvailability: SpectrumRangeAvailability;
  readonly committedDomain: MzDomain | null;
  readonly onExport: (format: SpectrumExportFormat) => void;
  readonly onCopyPlot: () => void;
  readonly onDismissExport: () => void;
  readonly figureSettings: FigureSettingsDraft;
  readonly figureSettingsValidation: FigureSettingsValidation;
  readonly renderSettingsProblem: string | null;
  readonly pngDpiProblem: string | null;
  readonly onFigureSetting: (field: FigureSettingsField, value: string) => void;
  readonly onFigureTheme: (theme: FigureTheme) => void;
}

/** Disclosures affect presentation only. The workspace retains source, scope and raw export drafts. */
export const SelectedSpectrumPanel = memo(function SelectedSpectrumPanel(props: SelectedSpectrumPanelProps) {
  const t = useUiMessages();
  const { state, exportState } = props;
  return <section aria-labelledby="selected-spectrum-heading" className="panel spectrum-panel">
    <header className="panel-header compact">
      <div><h2 id="selected-spectrum-heading">{t("viewerSpectrum")}</h2>
        {state.status === "loaded" ? <p className="spectrum-summary" id="selected-spectrum-summary">{t("viewerSpectrumSummary", {
          index: formatCount(state.spectrum.index), level: formatCount(state.spectrum.msLevel), count: state.spectrum.pointCount })}</p> :
          <p>{describe(state, t)}</p>}
      </div>
      {state.status === "loaded" ? <details className="spectrum-export-disclosure">
        <summary>{t("viewerSpectrumExport")}</summary><SpectrumExportActions {...props} />
      </details> : null}
    </header>
    <div className="spectrum-body">{renderBody(state, props.onRetry, props, t)}</div>
    <p className="spectrum-export-status" role="status">
      {describeExport(exportState, t)}
      {exportState.status === "failed" && exportState.error.detail !== null ?
        <span className="notice-detail">{exportState.error.detail}</span> : null}
    </p>
    {["saved", "copied", "cancelled", "failed"].includes(exportState.status) ?
      <button className="link-button" onClick={props.onDismissExport} type="button">{t("viewerDismissExport")}</button> : null}
  </section>;
});

function SpectrumExportActions(props: SelectedSpectrumPanelProps) {
  const t = useUiMessages();
  const { exportState, scientificExportBusy, renderSettingsProblem, pngDpiProblem, rangeAvailability,
    rangeScope, committedDomain, onRangeScope, onExport, onCopyPlot, figureSettings,
    figureSettingsValidation, onFigureSetting, onFigureTheme } = props;
  const running = exportState.status === "running" && exportState.namesVisibleRun;
  const figureBlocked = scientificExportBusy || renderSettingsProblem !== null;
  const rasterBlocked = figureBlocked || pngDpiProblem !== null;
  return <div className="spectrum-export">
    <fieldset className="spectrum-export-range"><legend>{t("viewerRange")}</legend>
      {rangeAvailability === "available" ? <>
        <div aria-labelledby="spectrum-range-label" className="spectrum-figure-themes" role="radiogroup">
          <span className="visually-hidden" id="spectrum-range-label">{t("viewerExportScope")}</span>
          {(["full", "current"] as const).map(scope => <label className="spectrum-figure-theme" key={scope}>
            <input checked={rangeScope === scope} name="spectrum-range-scope" onChange={() => onRangeScope(scope)} type="radio" value={scope} />
            <span>{t(scope === "full" ? "viewerExportFull" : "viewerExportCurrent")}</span>
          </label>)}
        </div>
        <p className="chromatogram-export-note">{committedDomain === null ? t("viewerExportFullHelp") :
          t("viewerExportRangeHelp", { low: String(committedDomain.low), high: String(committedDomain.high) })}</p>
      </> : <p className="chromatogram-export-note">{t(rangeAvailability === "noPeaks" ? "viewerExportNoPeaks" : "viewerExportNoViewport")}</p>}
    </fieldset>
    <FigureSettingsFields idPrefix="spectrum" onFigureSetting={onFigureSetting} onFigureTheme={onFigureTheme}
      validation={figureSettingsValidation} settings={figureSettings} />
    <fieldset className="spectrum-figure-actions"><legend className="visually-hidden">{t("viewerFigureExports")}</legend>
      <div className="spectrum-export-actions">
        {(["svg", "png"] as const).map(format => <button className="secondary-button"
          disabled={format === "png" ? rasterBlocked : figureBlocked} key={format} onClick={() => onExport(format)} type="button">
          {t(running && exportState.operation === format ? "viewerExporting" : "viewerExportFormat", { name: format.toUpperCase() })}
        </button>)}
        <button className="secondary-button" disabled={figureBlocked} onClick={onCopyPlot} type="button">
          {t(running && exportState.operation === "copy" ? "viewerCopying" : "viewerCopy")}
        </button>
      </div>
    </fieldset>
    <fieldset className="spectrum-data-actions"><legend>{t("viewerData")}</legend>
      <div className="spectrum-export-actions">
        {(["csv", "tsv"] as const).map(format => <button className="secondary-button" disabled={scientificExportBusy}
          key={format} onClick={() => onExport(format)} type="button">
          {t(running && exportState.operation === format ? "viewerExporting" : "viewerExportFormat", { name: format.toUpperCase() })}
        </button>)}
      </div>
    </fieldset>
  </div>;
}

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
function describeExport(state: SpectrumExportState, t: UiMessage): string {
  switch (state.status) {
    case "idle": return "";
    case "running": return state.operation === "copy" ? t("viewerExportClipboard") : t("viewerExportChoose", { name: state.operation.toUpperCase() });
    case "cancelled": return t("viewerExportCancelled");
    case "saved": return t("viewerExportSaved", { name: state.fileName, details: describeExportedRange(state, t) +
      (state.figure === null ? "" : `, ${describeFigure(state.figure, t)}`) });
    case "copied": return t("viewerExportCopied", { details: `${describeExportedRange(state, t)}, ${describeFigure(state.figure, t)}` });
    case "failed": return state.error.summary;
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
function renderBody(state: SpectrumState, onRetry: () => void, binding: SelectedSpectrumPanelProps, t: UiMessage) {
  switch (state.status) {
    case "none": return <div className="empty-state"><strong>{t("viewerChooseSpectrum")}</strong><span>{t("viewerChooseHelp")}</span></div>;
    case "loading": return <div className="empty-state"><strong>{t("viewerSpectrumLoading", { index: formatCount(state.index) })}</strong>
      <span>{t("viewerSpectrumReading")}</span></div>;
    case "unavailable": return <div className="empty-state"><strong>{t("viewerSpectrumUnavailable", { index: formatCount(state.requestedIndex) })}</strong>
      <span>{t("viewerSpectrumUnavailableHelp")}</span></div>;
    case "failed": return <div className="empty-state"><strong>{state.error.summary}</strong>
      {state.error.detail === null ? null : <span>{state.error.detail}</span>}
      {state.error.retryable ? <button className="secondary-button" onClick={onRetry} type="button">{t("viewerSpectrumRetry")}</button> : null}</div>;
    case "loaded": return <SpectrumDetail binding={binding} spectrum={state.spectrum} />;
  }
}
function SpectrumDetail({ spectrum, binding }: { readonly spectrum: SelectedSpectrum; readonly binding: SelectedSpectrumPanelProps }) {
  const t = useUiMessages();
  const empty = spectrum.pointCount === 0;
  const summaryId = "selected-spectrum-summary";
  return <>
    {empty ? <div className="empty-state"><strong>{t("viewerSpectrumEmpty")}</strong><span>{t("viewerSpectrumEmptyHelp")}</span></div> :
      <SpectrumViewport dispatch={binding.dispatchViewport} intensity={spectrum.intensity} labelledBy={summaryId} mz={spectrum.mz}
        onRetryProjection={binding.onRetryProjection} projectionError={binding.projectionError} readState={binding.readViewport}
        reportedMzHigh={spectrum.mzHigh} reportedMzLow={spectrum.mzLow} representationKnown={spectrum.representationKnown}
        valueUnitsKnown={spectrum.valueUnitsKnown} state={binding.viewport} />}
    {spectrum.truncated ? <p className="notice notice-warning" role="note">
      {t(binding.viewport.status === "ready" ? "viewerSpectrumPrefixRetained" : "viewerSpectrumPrefix", { count: spectrum.mz.length })}
    </p> : null}
    <details className="spectrum-source-details"><summary>{t("viewerDetails")}</summary>
      <dl className="metadata-list spectrum-facts">
        <div><dt>{t("scanIndex")}</dt><dd>{formatCount(spectrum.index)}</dd></div>
        <div><dt>{t("scanNumber")}</dt><dd>{spectrum.scanNumber === null ? t("viewerNotReported") : formatCount(spectrum.scanNumber)}</dd></div>
        <div><dt>{t("scanMsLevel")}</dt><dd>MS{spectrum.msLevel}</dd></div>
        <div><dt>{t("scanRetentionTime")}</dt><dd>{spectrum.retentionTime.unitKnown ? spectrum.retentionTime.value.toFixed(4) :
          t("viewerRetentionValue", { value: spectrum.retentionTime.value.toFixed(4) })}</dd></div>
        <div><dt>{t("viewerPoints")}</dt><dd>{formatCount(spectrum.pointCount)}</dd></div>
        <div><dt>{t("scanTotalIonCurrent")}</dt><dd>{formatIntensity(spectrum.totalIonCurrent)}</dd></div>
        {empty ? null : <>
          <div><dt>{t("rangeMzAxis")}</dt><dd>{formatMz(spectrum.mzLow)} – {formatMz(spectrum.mzHigh)}</dd></div>
          <div><dt>{t("viewerBasePeak")}</dt><dd>{t("viewerBasePeakValue", { mz: formatMz(spectrum.basePeakMz), value: formatIntensity(spectrum.basePeakIntensity) })}</dd></div>
        </>}
        <div><dt>{t("viewerRepresentation")}</dt><dd>{t(spectrum.representationKnown ? "viewerReported" : "viewerNotReported")}</dd></div>
        <div><dt>{t("viewerValueUnits")}</dt><dd>{t(spectrum.valueUnitsKnown ? "viewerReported" : "viewerNotReported")}</dd></div>
      </dl>
      {spectrum.identifiers.length === 0 ? null : <div className="inspector-section"><h3>{t("viewerIdentifiers")}</h3>
        <ul className="metadata-lines">{spectrum.identifiers.map(identifier => <li key={identifier}>{identifier}</li>)}</ul>
      </div>}
      {spectrum.precursors.length === 0 ? null : <div className="inspector-section"><h3>{t("viewerPrecursors")}</h3>
        {spectrum.precursorsTruncated ? <p className="notice notice-warning" role="note">
          {t("viewerPrecursorPrefix", { count: spectrum.precursors.length, total: spectrum.totalPrecursorCount })}</p> : null}
        <dl className="metadata-list">{spectrum.precursors.map(precursor => <div key={precursor.index}>
          <dt>{formatMz(precursor.mz)}</dt><dd>{formatIntensity(precursor.intensity)}</dd></div>)}</dl>
      </div>}
    </details>
  </>;
}
