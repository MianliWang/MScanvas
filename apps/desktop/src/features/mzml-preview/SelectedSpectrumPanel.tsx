import { memo } from "react";

import type {
  CopiedFigure,
  ExportedFigure,
  ExportedSpectrumRange,
  FigureTheme,
  PreviewError,
  SelectedSpectrum,
  SpectrumExportFormat,
  SpectrumRangeScope,
} from "./contracts";
import { FigureSettingsFields } from "./FigureSettingsFields";
import { formatCount, formatIntensity, formatMz, formatRetentionTime } from "./format";
import { SpectrumViewport } from "./SpectrumViewport";
import type {
  FigureSettingsDraft,
  FigureSettingsField,
  SpectrumExportState,
  SpectrumState,
} from "./usePreviewWorkspace";
import type {
  MzDomain,
  SpectrumViewportEvent,
  SpectrumViewportState,
} from "./viewer/spectrumViewport";

/**
 * The figure formats, then the data formats, in the order they are offered.
 *
 * Grouped rather than listed, because they answer different questions. A figure
 * is a drawing and the settings beside it decide how it looks; CSV and TSV are
 * the measurement itself and nothing about a figure reaches them. A single row
 * of five buttons would suggest the settings applied to all of them.
 */
const FIGURE_FORMATS: readonly {
  readonly format: SpectrumExportFormat;
  readonly label: string;
  /**
   * Whether this output records the physical resolution.
   *
   * Only the raster one does. It decides which button an unusable DPI closes:
   * an SVG has no pixels to give a physical size to, so stopping it over a
   * resolution would be stopping it over a number that could not have reached
   * it.
   */
  readonly recordsDpi: boolean;
}[] = [
  { format: "svg", label: "Export SVG…", recordsDpi: false },
  { format: "png", label: "Export PNG…", recordsDpi: true },
];

const DATA_FORMATS: readonly { readonly format: SpectrumExportFormat; readonly label: string }[] = [
  { format: "csv", label: "Export CSV…" },
  { format: "tsv", label: "Export TSV…" },
];

/** What every identifier in this panel's figure settings is named after. */
const FIGURE_PREFIX = "spectrum";

/**
 * The two scopes, in the order they are offered.
 *
 * The chromatogram's own chooser reads the same way and is the pattern this
 * follows rather than a second one invented beside it. The words differ because
 * the sources do: a chromatogram covers a *run*, a spectrum covers a spectrum.
 */
const RANGE_SCOPES: readonly {
  readonly scope: SpectrumRangeScope;
  readonly label: string;
}[] = [
  { scope: "full", label: "Full spectrum" },
  { scope: "current", label: "Current range" },
];


export interface SelectedSpectrumPanelProps {
  readonly state: SpectrumState;
  readonly onRetry: () => void;
  /**
   * The one m/z viewport authority, for the spectrum this panel is showing.
   *
   * Held by the workspace rather than by this panel, and that is deliberate:
   * ADR 0038's gesture epoch and projection generation are monotonic across the
   * *session*, and a reducer that lived and died with a component would restart
   * them every time a different spectrum was selected -- which is precisely the
   * race those counters exist to remove.
   */
  readonly viewport: SpectrumViewportState;
  readonly dispatchViewport: (event: SpectrumViewportEvent) => SpectrumViewportState;
  readonly readViewport: () => SpectrumViewportState;
  /** The message behind the current projection failure, where there is one. */
  readonly projectionError: PreviewError | null;
  readonly onRetryProjection: () => void;
  readonly exportState: SpectrumExportState;
  /**
   * Whether the session's one scientific export lane is occupied.
   *
   * Not this panel's own state. The chromatogram shares the lane, so its save
   * or copy closes these actions exactly as one of this panel's own would --
   * otherwise a button that is visibly available reaches Rust and comes back
   * refused, which is a failure the interface caused rather than reported.
   *
   * Availability only. What this panel *says* still comes from `exportState`:
   * a running label names the operation this surface started, and a
   * chromatogram's result is never shown here.
   */
  readonly scientificExportBusy: boolean;
  /**
   * How much of this spectrum an export covers.
   *
   * The effective scope, already resolved by the workspace: a spectrum with no
   * admitted viewport is always `full`, so this panel never has to decide what
   * a choice means for a spectrum that cannot honour it.
   */
  readonly rangeScope: SpectrumRangeScope;
  readonly onRangeScope: (scope: SpectrumRangeScope) => void;
  /**
   * Whether this spectrum has an m/z viewport a current range could come from.
   *
   * `false` hides the choice rather than offering an inert one. It is the
   * figure contract's verdict about drawability and never a fact about the
   * source: the full-source exports below are exactly as available as ever.
   */
  readonly rangeAvailable: boolean;
  /**
   * The window a current-range export would cover, as the viewport committed it.
   *
   * `null` means nothing narrower has been committed, so the current range is
   * the whole spectrum. Said in those words rather than filled in with the
   * spectrum's own bounds, which would look like a choice the user had made.
   */
  readonly committedDomain: MzDomain | null;
  readonly onExport: (format: SpectrumExportFormat) => void;
  readonly onCopyPlot: () => void;
  readonly onDismissExport: () => void;
  readonly figureSettings: FigureSettingsDraft;
  readonly renderSettingsProblem: string | null;
  readonly pngDpiProblem: string | null;
  readonly onFigureSetting: (field: FigureSettingsField, value: string) => void;
  readonly onFigureTheme: (theme: FigureTheme) => void;
}

/**
 * The one spectrum the session has selected, and its exports.
 *
 * Memoized because the viewer above it publishes a new interaction state
 * whenever the pointer crosses from one scan to another, which at a full-run
 * zoom is most pointer frames. **The chromatogram's** interaction state still
 * does not reach these props, and that is what the memo is for.
 *
 * What does reach them, since M5.2, is this panel's own m/z viewport -- and a
 * drag over the spectrum plot therefore re-renders this panel per frame. That
 * is the honest trade: the alternative is a reducer living inside the plot,
 * whose gesture epochs and projection generations would restart every time a
 * different spectrum was selected, which ADR 0038 identifies as the race those
 * counters exist to prevent. A frame of the interaction the reader is
 * performing on this panel is a much cheaper thing than a late answer for one
 * spectrum landing under another's axes.
 */
export const SelectedSpectrumPanel = memo(function SelectedSpectrumPanel({
  state,
  onRetry,
  viewport,
  dispatchViewport,
  readViewport,
  projectionError,
  onRetryProjection,
  exportState,
  scientificExportBusy,
  rangeScope,
  onRangeScope,
  rangeAvailable,
  committedDomain,
  onExport,
  onCopyPlot,
  onDismissExport,
  figureSettings,
  renderSettingsProblem,
  pngDpiProblem,
  onFigureSetting,
  onFigureTheme,
}: SelectedSpectrumPanelProps) {
  return (
    <section aria-labelledby="selected-spectrum-heading" className="panel spectrum-panel">
      <header className="panel-header compact">
        <div>
          <h2 id="selected-spectrum-heading">Selected spectrum</h2>
          <p>{describe(state)}</p>
        </div>
        {/*
          Offered only for a spectrum that actually loaded. There is nothing to
          export from a panel that is empty, loading, unavailable or failed, and
          an action that is present and refuses is worse than one that is not
          there. A spectrum with no peaks is loaded and *is* exportable: an
          honest empty figure is a real answer about a sample.
        */}
        {state.status === "loaded" ? (
          <SpectrumExportActions
            committedDomain={committedDomain}
            exportState={exportState}
            figureSettings={figureSettings}
            onCopyPlot={onCopyPlot}
            onDismiss={onDismissExport}
            onExport={onExport}
            onFigureSetting={onFigureSetting}
            onFigureTheme={onFigureTheme}
            onRangeScope={onRangeScope}
            pngDpiProblem={pngDpiProblem}
            rangeAvailable={rangeAvailable}
            rangeScope={rangeScope}
            renderSettingsProblem={renderSettingsProblem}
            scientificExportBusy={scientificExportBusy}
          />
        ) : null}
      </header>
      <div className="spectrum-body">
        {renderBody(state, onRetry, {
          viewport,
          dispatchViewport,
          readViewport,
          projectionError,
          onRetryProjection,
        })}
      </div>
    </section>
  );
})

function SpectrumExportActions({
  exportState,
  scientificExportBusy,
  rangeScope,
  onRangeScope,
  rangeAvailable,
  committedDomain,
  onExport,
  onCopyPlot,
  onDismiss,
  figureSettings,
  renderSettingsProblem,
  pngDpiProblem,
  onFigureSetting,
  onFigureTheme,
}: {
  readonly exportState: SpectrumExportState;
  readonly scientificExportBusy: boolean;
  readonly rangeScope: SpectrumRangeScope;
  readonly onRangeScope: (scope: SpectrumRangeScope) => void;
  readonly rangeAvailable: boolean;
  readonly committedDomain: MzDomain | null;
  readonly onExport: (format: SpectrumExportFormat) => void;
  readonly onCopyPlot: () => void;
  readonly onDismiss: () => void;
  readonly figureSettings: FigureSettingsDraft;
  readonly renderSettingsProblem: string | null;
  readonly pngDpiProblem: string | null;
  readonly onFigureSetting: (field: FigureSettingsField, value: string) => void;
  readonly onFigureTheme: (theme: FigureTheme) => void;
}) {
  // What this surface is doing *to the run it is showing*, which is what its
  // labels are allowed to say. An operation that outlived the preview it was
  // begun on still holds the lane -- so the controls below stay closed -- but
  // it is no longer this run being written, and no label here says it is.
  const running = exportState.status === "running" && exportState.namesVisibleRun;
  // A figure nothing can be drawn from is not offered. The data formats stay
  // live: a width nobody could draw at says nothing about a list of numbers.
  //
  // The lane is asked about first, and it is the *shared* lane rather than this
  // surface's own state. The settings rules below are unchanged and independent
  // of it: an unusable width still closes only the figures, an unusable
  // resolution still closes only the raster, and neither of them has anything
  // to do with the chromatogram's settings.
  const figureBlocked = scientificExportBusy || renderSettingsProblem !== null;
  // And a resolution nothing could record closes the one output that records
  // one. `Export SVG…` and `Copy plot` stay exactly where they were, because
  // neither of them has ever read this number.
  const rasterBlocked = figureBlocked || pngDpiProblem !== null;
  return (
    <div className="spectrum-export">
      {/*
        The range chooser, and it comes first because it is the question the
        five actions below are all answers to. Offered only where this spectrum
        has an admitted m/z viewport: a control with no range to read is not
        shown as an inert one, because a disabled radio a reader cannot explain
        is worse than a section that honestly says the choice is unavailable.

        Deliberately *not* closed while the lane is busy. A scope is a decision
        about the next export rather than a claim on the lane, and closing it
        would leave the reader unable to prepare while a file is being written.
      */}
      <fieldset className="spectrum-export-range">
        <legend>Range</legend>
        {rangeAvailable ? (
          <>
            <div
              aria-labelledby="spectrum-range-label"
              className="spectrum-figure-themes"
              role="radiogroup"
            >
              <span className="visually-hidden" id="spectrum-range-label">
                How much of the spectrum to export
              </span>
              {RANGE_SCOPES.map(({ scope, label }) => (
                <label className="spectrum-figure-theme" key={scope}>
                  <input
                    checked={rangeScope === scope}
                    name="spectrum-range-scope"
                    onChange={() => {
                      onRangeScope(scope);
                    }}
                    type="radio"
                    value={scope}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="chromatogram-export-note">{describeRange(committedDomain)}</p>
          </>
        ) : (
          /*
            A viewport refusal, said as what it is. The three figure formats
            keep whatever availability the figure contract gives them and the
            two data formats are untouched: a spectrum with no drawable domain
            is still valid source data, and its CSV and TSV still write.
          */
          <p className="chromatogram-export-note">
            This spectrum has no m/z viewport, so there is no current range to
            export. Exports cover the full spectrum.
          </p>
        )}
      </fieldset>
      <FigureSettingsFields
        idPrefix={FIGURE_PREFIX}
        onFigureSetting={onFigureSetting}
        onFigureTheme={onFigureTheme}
        pngDpiProblem={pngDpiProblem}
        renderSettingsProblem={renderSettingsProblem}
        settings={figureSettings}
      />
      <fieldset className="spectrum-figure-actions">
        <legend className="visually-hidden">Figure exports</legend>
        <div className="spectrum-export-actions">
          {FIGURE_FORMATS.map(({ format, label, recordsDpi }) => (
            <button
              className="secondary-button"
              // Every figure action while any scientific export is running --
              // this panel's own or the chromatogram's. Rust holds a single
              // lane across both surfaces and refuses a second, so leaving
              // these live would offer an action already known to fail. Then
              // the resolution, for the one output that writes it.
              disabled={recordsDpi ? rasterBlocked : figureBlocked}
              key={format}
              onClick={() => {
                onExport(format);
              }}
              type="button"
            >
              {running && exportState.operation === format
                ? `Exporting ${format.toUpperCase()}…`
                : label}
            </button>
          ))}
          <button
            className="secondary-button"
            // The figure only. A clipboard image carries no physical
            // resolution, so an unusable one leaves this action live.
            disabled={figureBlocked}
            onClick={onCopyPlot}
            type="button"
          >
            {running && exportState.operation === "copy" ? "Copying plot…" : "Copy plot"}
          </button>
        </div>
      </fieldset>
      <fieldset className="spectrum-data-actions">
        <legend>Data</legend>
        <div className="spectrum-export-actions">
          {DATA_FORMATS.map(({ format, label }) => (
            <button
              className="secondary-button"
              // Closed while any scientific export is running, for the same one
              // lane. Not closed by a figure setting, because none of them
              // reaches a data document.
              disabled={scientificExportBusy}
              key={format}
              onClick={() => {
                onExport(format);
              }}
              type="button"
            >
              {running && exportState.operation === format
                ? `Exporting ${format.toUpperCase()}…`
                : label}
            </button>
          ))}
        </div>
      </fieldset>
      {/*
        A live region rather than a dialog. An export finishes while the user is
        looking at the spectrum, and interrupting them to say so would be a
        worse interruption than the file being saved was.
      */}
      <p className="spectrum-export-status" role="status">
        {describeExport(exportState)}
        {/* Both halves. The summary says what happened; the detail is where a
            refusal puts the part the user has to act on -- above all that a
            failed export could not remove the temporary file it left in their
            folder. Rendering only the summary hid the one thing they could do
            about it, which is the regression the conversion notice already
            carries a comment about and the spectrum load state already avoids. */}
        {exportState.status === "failed" && exportState.error.detail !== null ? (
          <span className="notice-detail">{exportState.error.detail}</span>
        ) : null}
      </p>
      {exportState.status === "saved" ||
      exportState.status === "copied" ||
      exportState.status === "cancelled" ||
      exportState.status === "failed" ? (
        <button className="link-button" onClick={onDismiss} type="button">
          Dismiss export message
        </button>
      ) : null}
    </div>
  );
}

/** How a figure's dimensions read in a sentence. */
function describeFigure(figure: ExportedFigure): string {
  const resolution = figure.dpi === null ? "" : ` at ${formatCount(figure.dpi)} DPI`;
  return `${describeSize(figure)}${resolution}, ${figure.theme} theme`;
}

/**
 * The same sentence for a copied figure, which has no resolution to name.
 *
 * Not `describeFigure` with a `null`: the type it takes has no `dpi` field at
 * all, so a confirmation about the clipboard cannot be written to claim one.
 */
function describeCopiedFigure(figure: CopiedFigure): string {
  return `${describeSize(figure)}, ${figure.theme} theme`;
}

function describeSize(figure: { readonly width: number; readonly height: number }): string {
  return `${formatCount(figure.width)} by ${formatCount(figure.height)} pixels`;
}

/**
 * What the range chooser says a current-range export would cover.
 *
 * The exact committed bounds, or the fact that nothing narrower is committed --
 * and in both cases that a gesture still in flight is not what gets exported.
 * A reader mid-drag has to be able to tell what pressing a button now would
 * write, and "the current range" does not answer that.
 */
function describeRange(committedDomain: MzDomain | null): string {
  if (committedDomain === null) {
    return "Current range is the whole spectrum until the viewport is changed.";
  }
  return (
    `Current range is m/z ${formatMz(committedDomain.low)} to ${formatMz(committedDomain.high)}. ` +
    "A zoom or pan in progress is not exported until it settles."
  );
}

/**
 * How a finished export names the range it covered.
 *
 * Every fact here comes from the outcome Rust returned, which describes the
 * range resolved when the export **began**. Nothing is read from live viewport
 * state: by the time this sentence is read the reader may have zoomed
 * somewhere else, and "the current range" would then name a window the file
 * does not hold.
 *
 * A full export keeps its existing concise wording -- one count, no bounds --
 * because it has no window to disambiguate and the sentence it has already
 * says which measurement it wrote.
 */
function describeExportedRange(state: ExportedSpectrumRange): string {
  if (state.rangeScope === "full" || state.rangeLow === null || state.rangeHigh === null) {
    return `${formatCount(state.sourcePointCount)} points`;
  }
  return (
    `${formatCount(state.exportedPointCount)} of ${formatCount(state.sourcePointCount)} points, ` +
    `m/z ${formatMz(state.rangeLow)} to ${formatMz(state.rangeHigh)}`
  );
}

/**
 * What the export status region says.
 *
 * Never a path. A saved export names the file and the range it covered, which
 * is what a reader needs to know which document they are holding -- and, for a
 * range, to know it after the viewport has moved on.
 */
function describeExport(state: SpectrumExportState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "running":
      return state.operation === "copy"
        ? "Drawing the plot for the clipboard."
        : `Choose where to save the ${state.operation.toUpperCase()} file.`;
    case "cancelled":
      return "Export cancelled. Nothing was saved.";
    case "saved":
      return state.figure === null
        ? `Saved ${state.fileName} with ${describeExportedRange(state)}.`
        : `Saved ${state.fileName} with ${describeExportedRange(state)}, ${describeFigure(state.figure)}.`;
    case "copied":
      return `Copied the plot with ${describeExportedRange(state)}, ${describeCopiedFigure(state.figure)}.`;
    case "failed":
      return state.error.summary;
  }
}

function describe(state: SpectrumState): string {
  switch (state.status) {
    case "none":
      return "No spectrum selected";
    case "loading":
      return `Loading spectrum ${formatCount(state.index)}`;
    case "loaded":
      return `Spectrum ${formatCount(state.spectrum.index)}`;
    case "unavailable":
      return `Spectrum ${formatCount(state.requestedIndex)} is not in this run`;
    case "failed":
      return `Spectrum ${formatCount(state.index)} could not be loaded`;
  }
}

/**
 * Everything the viewport surface needs, carried as one value.
 *
 * Grouped rather than passed as five parameters through two functions, so a new
 * one cannot be added to the panel and forgotten on the way down.
 */
interface ViewportBinding {
  readonly viewport: SpectrumViewportState;
  readonly dispatchViewport: (event: SpectrumViewportEvent) => SpectrumViewportState;
  readonly readViewport: () => SpectrumViewportState;
  readonly projectionError: PreviewError | null;
  readonly onRetryProjection: () => void;
}

function renderBody(state: SpectrumState, onRetry: () => void, binding: ViewportBinding) {
  switch (state.status) {
    case "none":
      return (
        <div className="empty-state">
          <strong>Select a spectrum</strong>
          <span>
            Choose a row in the spectra table to load and draw that spectrum. Each selection reads
            the file again; nothing is kept in memory between selections.
          </span>
        </div>
      );

    case "loading":
      return (
        <div className="empty-state">
          <strong>Loading spectrum {formatCount(state.index)}</strong>
          <span>Reading this spectrum from the file through the installed backend.</span>
        </div>
      );

    case "unavailable":
      // The backend answered; it simply has no spectrum at that index. That is
      // an ordinary answer and never presented as a failure.
      return (
        <div className="empty-state">
          <strong>No spectrum at index {formatCount(state.requestedIndex)}</strong>
          <span>
            The backend reported that this run has no spectrum at that index. Nothing went wrong.
          </span>
        </div>
      );

    case "failed":
      return (
        <div className="empty-state">
          <strong>{state.error.summary}</strong>
          {state.error.detail === null ? null : <span>{state.error.detail}</span>}
          {state.error.retryable ? (
            <button className="secondary-button" onClick={onRetry} type="button">
              Try loading this spectrum again
            </button>
          ) : null}
        </div>
      );

    case "loaded":
      return <SpectrumDetail binding={binding} spectrum={state.spectrum} />;
  }
}

function SpectrumDetail({
  spectrum,
  binding,
}: {
  readonly spectrum: SelectedSpectrum;
  readonly binding: ViewportBinding;
}) {
  const empty = spectrum.pointCount === 0;
  const summaryId = "selected-spectrum-summary";

  return (
    <>
      <p className="spectrum-summary" id={summaryId}>
        {buildAccessibleSummary(spectrum, binding.viewport.status === "ready")}
      </p>

      {empty ? (
        <div className="empty-state">
          <strong>This spectrum has no peaks</strong>
          <span>
            The backend returned this spectrum with zero points. Base peak and m/z range are not
            shown because there is no peak to describe.
          </span>
        </div>
      ) : (
        /*
          A spectrum with points always has a plot, and since M5.2 the plot is a
          viewport surface -- which decides for itself whether there is a range
          to navigate. A spectrum with *no* points keeps the empty state above
          rather than gaining three disabled controls beside a sentence that has
          already said there is nothing here: its domain is admitted and zero
          wide, so every control would be inert and every drawing would be
          empty, and saying so twice is not saying it better.
        */
        <SpectrumViewport
          dispatch={binding.dispatchViewport}
          intensity={spectrum.intensity}
          labelledBy={summaryId}
          mz={spectrum.mz}
          onRetryProjection={binding.onRetryProjection}
          projectionError={binding.projectionError}
          readState={binding.readViewport}
          reportedMzHigh={spectrum.mzHigh}
          reportedMzLow={spectrum.mzLow}
          representationKnown={spectrum.representationKnown}
          state={binding.viewport}
        />
      )}

      {spectrum.truncated ? (
        <p className="notice notice-warning" role="note">
          {/*
            What the transfer bound still costs, said differently depending on
            whether this spectrum has a viewport -- because the sentence that was
            true before M5.2 is now false where one exists.

            With a viewport, the drawing is no longer the transferred prefix at
            all: every committed range is drawn from the complete spectrum Rust
            retained, so panning past the end of what was transferred shows the
            source rather than blank space. The bound still applies to the arrays
            this document holds, which is what the exports and the facts below do
            not read.
          */}
          {binding.viewport.status === "ready"
            ? `This spectrum has more points than one transfer carries, so only the first ${formatCount(spectrum.mz.length)} of them reached this window. The drawing is not limited to them: each m/z range is drawn from the complete spectrum MSCanvas retained, and so are the point count, m/z range and base peak below.`
            : `This spectrum has more points than one transfer carries. Only the drawing is limited to the first ${formatCount(spectrum.mz.length)} points; the point count, m/z range and base peak below are the backend's own values for the whole spectrum.`}
        </p>
      ) : null}

      <dl className="metadata-list spectrum-facts">
        <div>
          <dt>Index</dt>
          <dd>{formatCount(spectrum.index)}</dd>
        </div>
        <div>
          <dt>Scan number</dt>
          <dd>{spectrum.scanNumber === null ? "Not reported" : formatCount(spectrum.scanNumber)}</dd>
        </div>
        <div>
          <dt>MS level</dt>
          <dd>MS{spectrum.msLevel}</dd>
        </div>
        <div>
          <dt>Retention time</dt>
          <dd>{formatRetentionTime(spectrum.retentionTime)}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{formatCount(spectrum.pointCount)}</dd>
        </div>
        <div>
          <dt>Total ion current</dt>
          <dd>{formatIntensity(spectrum.totalIonCurrent)}</dd>
        </div>
        {empty ? null : (
          <>
            <div>
              <dt>m/z range</dt>
              <dd>
                {formatMz(spectrum.mzLow)} – {formatMz(spectrum.mzHigh)}
              </dd>
            </div>
            <div>
              <dt>Base peak</dt>
              <dd>
                {formatMz(spectrum.basePeakMz)} at {formatIntensity(spectrum.basePeakIntensity)}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Peak representation</dt>
          {/* Never guessed: the backend emits no profile or centroid marker. */}
          <dd>{spectrum.representationKnown ? "Reported" : "Not reported"}</dd>
        </div>
        <div>
          <dt>Value units</dt>
          <dd>{spectrum.valueUnitsKnown ? "Reported" : "Not reported"}</dd>
        </div>
      </dl>

      {spectrum.identifiers.length === 0 ? null : (
        <div className="inspector-section">
          <h3>Identifiers</h3>
          <ul className="metadata-lines">
            {spectrum.identifiers.map((identifier) => (
              <li key={identifier}>{identifier}</li>
            ))}
          </ul>
        </div>
      )}

      {spectrum.precursors.length === 0 ? null : (
        <div className="inspector-section">
          <h3>Precursors</h3>
          {spectrum.precursorsTruncated ? (
            <p className="notice notice-warning" role="note">
              Showing the first {formatCount(spectrum.precursors.length)} of{" "}
              {formatCount(spectrum.totalPrecursorCount)} precursors.
            </p>
          ) : null}
          <dl className="metadata-list">
            {spectrum.precursors.map((precursor) => (
              <div key={precursor.index}>
                <dt>{formatMz(precursor.mz)}</dt>
                <dd>{formatIntensity(precursor.intensity)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

/**
 * The plot's accessible description.
 *
 * Everything the drawing conveys is stated in words: how many points there
 * are, the m/z range and the most intense peak. Range and peak are omitted
 * when there are no points, because there is nothing to take a range of.
 *
 * The peak comes from the backend's own whole-spectrum value, not from the
 * transferred array. A spectrum above the transfer bound arrives as a prefix,
 * and the tallest point in a prefix is not the tallest point in the spectrum.
 *
 * What the *drawing* covers depends on whether this spectrum has a viewport,
 * and getting that wrong is the M5.2 defect in miniature. Without one the
 * drawing really is the transferred prefix and says so. With one it is a
 * bounded drawing of one m/z range of the complete spectrum Rust retained, and
 * the old sentence -- "the drawing covers the first N of those points" --
 * would be describing a limit that no longer applies to it.
 */
function buildAccessibleSummary(spectrum: SelectedSpectrum, hasViewport: boolean): string {
  const opening = `Spectrum ${formatCount(spectrum.index)}, MS${spectrum.msLevel}, ${formatCount(spectrum.pointCount)} ${spectrum.pointCount === 1 ? "point" : "points"}.`;
  if (spectrum.pointCount === 0) {
    return `${opening} This spectrum contains no peaks, so it has no m/z range and no most intense peak.`;
  }
  const truncation = spectrum.truncated
    ? hasViewport
      ? ` Only the first ${formatCount(spectrum.mz.length)} of those points were transferred to this window, but the drawing is taken from the complete spectrum, one m/z range at a time.`
      : ` The drawing covers the first ${formatCount(spectrum.mz.length)} of those points.`
    : "";
  const representation = spectrum.representationKnown
    ? ""
    : " This file does not report whether these are profile samples or centroided peaks.";
  return `${opening} m/z ranges from ${formatMz(spectrum.mzLow)} to ${formatMz(spectrum.mzHigh)}. The most intense peak reported for this spectrum is ${formatIntensity(spectrum.basePeakIntensity)} at m/z ${formatMz(spectrum.basePeakMz)}.${truncation}${representation}`;
}
