import type { SelectedSpectrum, SpectrumExportFormat } from "./contracts";
import { formatCount, formatIntensity, formatMz, formatRetentionTime } from "./format";
import { StickSpectrum } from "./StickSpectrum";
import type { SpectrumExportState, SpectrumState } from "./usePreviewWorkspace";

/**
 * The three documents this panel can export, in the order they are offered.
 *
 * The figure first, because it is the one a reader looks at; the two data
 * formats after it, because they are the same measurement in two spellings.
 */
const EXPORT_FORMATS: readonly { readonly format: SpectrumExportFormat; readonly label: string }[] =
  [
    { format: "svg", label: "Export SVG…" },
    { format: "csv", label: "Export CSV…" },
    { format: "tsv", label: "Export TSV…" },
  ];

export interface SelectedSpectrumPanelProps {
  readonly state: SpectrumState;
  readonly onRetry: () => void;
  readonly exportState: SpectrumExportState;
  readonly onExport: (format: SpectrumExportFormat) => void;
  readonly onDismissExport: () => void;
}

export function SelectedSpectrumPanel({
  state,
  onRetry,
  exportState,
  onExport,
  onDismissExport,
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
            exportState={exportState}
            onDismiss={onDismissExport}
            onExport={onExport}
          />
        ) : null}
      </header>
      <div className="spectrum-body">{renderBody(state, onRetry)}</div>
    </section>
  );
}

function SpectrumExportActions({
  exportState,
  onExport,
  onDismiss,
}: {
  readonly exportState: SpectrumExportState;
  readonly onExport: (format: SpectrumExportFormat) => void;
  readonly onDismiss: () => void;
}) {
  const exporting = exportState.status === "exporting";
  return (
    <div className="spectrum-export">
      <div className="spectrum-export-actions">
        {EXPORT_FORMATS.map(({ format, label }) => (
          <button
            className="secondary-button"
            // All three while one is running. Rust holds a single export slot
            // and refuses a second, so leaving the others live would offer an
            // action already known to fail.
            disabled={exporting}
            key={format}
            onClick={() => {
              onExport(format);
            }}
            type="button"
          >
            {exporting && exportState.format === format ? `Exporting ${format.toUpperCase()}…` : label}
          </button>
        ))}
      </div>
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
      exportState.status === "cancelled" ||
      exportState.status === "failed" ? (
        <button className="link-button" onClick={onDismiss} type="button">
          Dismiss export message
        </button>
      ) : null}
    </div>
  );
}

/**
 * What the export status region says.
 *
 * Never a path. A saved export names the file and how many points went into it,
 * which is what a reader needs to know the document is the whole spectrum and
 * not the drawing beside it.
 */
function describeExport(state: SpectrumExportState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "exporting":
      return `Choose where to save the ${state.format.toUpperCase()} file.`;
    case "cancelled":
      return "Export cancelled. Nothing was saved.";
    case "saved":
      return `Saved ${state.fileName} with ${formatCount(state.pointCount)} points.`;
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

function renderBody(state: SpectrumState, onRetry: () => void) {
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
      return <SpectrumDetail spectrum={state.spectrum} />;
  }
}

function SpectrumDetail({ spectrum }: { readonly spectrum: SelectedSpectrum }) {
  const empty = spectrum.pointCount === 0;
  const summaryId = "selected-spectrum-summary";

  return (
    <>
      <p className="spectrum-summary" id={summaryId}>
        {buildAccessibleSummary(spectrum)}
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
        <StickSpectrum
          intensity={spectrum.intensity}
          labelledBy={summaryId}
          mz={spectrum.mz}
          representationKnown={spectrum.representationKnown}
          reportedMzHigh={spectrum.mzHigh}
          reportedMzLow={spectrum.mzLow}
        />
      )}

      {spectrum.truncated ? (
        <p className="notice notice-warning" role="note">
          This spectrum has more points than one transfer carries. Only the drawing is limited to
          the first {formatCount(spectrum.mz.length)} points; the point count, m/z range and base
          peak below are the backend's own values for the whole spectrum.
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
 */
function buildAccessibleSummary(spectrum: SelectedSpectrum): string {
  const opening = `Spectrum ${formatCount(spectrum.index)}, MS${spectrum.msLevel}, ${formatCount(spectrum.pointCount)} ${spectrum.pointCount === 1 ? "point" : "points"}.`;
  if (spectrum.pointCount === 0) {
    return `${opening} This spectrum contains no peaks, so it has no m/z range and no most intense peak.`;
  }
  const truncation = spectrum.truncated
    ? ` The drawing covers the first ${formatCount(spectrum.mz.length)} of those points.`
    : "";
  const representation = spectrum.representationKnown
    ? ""
    : " This file does not report whether these are profile samples or centroided peaks.";
  return `${opening} m/z ranges from ${formatMz(spectrum.mzLow)} to ${formatMz(spectrum.mzHigh)}. The most intense peak reported for this spectrum is ${formatIntensity(spectrum.basePeakIntensity)} at m/z ${formatMz(spectrum.basePeakMz)}.${truncation}${representation}`;
}
