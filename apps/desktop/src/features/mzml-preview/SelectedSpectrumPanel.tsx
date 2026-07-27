import type { SelectedSpectrum } from "./contracts";
import { formatCount, formatIntensity, formatMz, formatRetentionTime } from "./format";
import { StickSpectrum } from "./StickSpectrum";
import type { SpectrumState } from "./usePreviewWorkspace";

export interface SelectedSpectrumPanelProps {
  readonly state: SpectrumState;
  readonly onRetry: () => void;
}

export function SelectedSpectrumPanel({ state, onRetry }: SelectedSpectrumPanelProps) {
  return (
    <section aria-labelledby="selected-spectrum-heading" className="panel spectrum-panel">
      <header className="panel-header compact">
        <div>
          <h2 id="selected-spectrum-heading">Selected spectrum</h2>
          <p>{describe(state)}</p>
        </div>
      </header>
      <div className="spectrum-body">{renderBody(state, onRetry)}</div>
    </section>
  );
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
          reportedMzHigh={spectrum.mzHigh}
          reportedMzLow={spectrum.mzLow}
        />
      )}

      {spectrum.truncated ? (
        <p className="notice notice-warning" role="note">
          This spectrum has more points than one transfer carries. The drawing and the values above
          cover the first {formatCount(spectrum.mz.length)} points only.
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
 * are, the m/z range and the largest intensity. Range and maximum are omitted
 * when there are no points, because there is nothing to take a range of.
 */
function buildAccessibleSummary(spectrum: SelectedSpectrum): string {
  const opening = `Spectrum ${formatCount(spectrum.index)}, MS${spectrum.msLevel}, ${formatCount(spectrum.pointCount)} ${spectrum.pointCount === 1 ? "point" : "points"}.`;
  if (spectrum.pointCount === 0) {
    return `${opening} This spectrum contains no peaks, so it has no m/z range and no maximum intensity.`;
  }
  const maximumIntensity = spectrum.intensity.reduce(
    (highest, value) => (value > highest ? value : highest),
    0,
  );
  return `${opening} m/z ranges from ${formatMz(spectrum.mzLow)} to ${formatMz(spectrum.mzHigh)}. The maximum intensity is ${formatIntensity(maximumIntensity)}.`;
}
