import { memo } from "react";

import type { Metadata, RunSummary, SelectedFile } from "./contracts";
import {
  formatByteLength,
  formatCount,
  formatDatasetLabel,
  formatDuration,
  formatMsLevel,
  formatRetentionTime,
} from "./format";
import { latestMeasurement, type PreviewMeasurement } from "./instrumentation";

export interface PreviewSummaryProps {
  readonly file: SelectedFile;
  readonly runSummary: RunSummary;
  readonly metadata: Metadata;
  /** The spectrum list's own total, which is produced by a separate read. */
  readonly spectrumListTotal: number;
  readonly measurements: readonly PreviewMeasurement[];
}

/**
 * What the loaded acquisition is, beside every number read out of it.
 *
 * Memoized because the viewer above it publishes a new interaction state
 * whenever the pointer crosses from one scan to another, which at a full-run
 * zoom is most pointer frames. None of that reaches these props, and this is
 * what makes "does not reach" mean "does not re-render".
 */
export const PreviewSummary = memo(function PreviewSummary({
  file,
  runSummary,
  metadata,
  spectrumListTotal,
  measurements,
}: PreviewSummaryProps) {
  // The run summary and the spectrum list are two separate reads of the same
  // file. When they disagree, showing one number here and a different one over
  // the table would present a single acquisition with two sizes.
  const countsDisagree = runSummary.totalSpectrumCount !== spectrumListTotal;
  const fileLabel = formatDatasetLabel(file);
  return (
    <section aria-labelledby="preview-summary-heading" className="panel inspector-panel">
      <header className="panel-header">
        <div>
          <h2 id="preview-summary-heading">Run</h2>
          {/* The filename plus only the bounded context Rust says the current
              roster needs. No absolute path crosses, and no location is
              reconstructed here. */}
          <p className="preview-file-identity" title={fileLabel}>
            {fileLabel} · {formatByteLength(file.byteLength)}
          </p>
        </div>
      </header>

      <div className="inspector-section">
        <h3>Summary</h3>
        {countsDisagree ? (
          <p className="notice notice-warning" role="note">
            The run summary reports {formatCount(runSummary.totalSpectrumCount)} spectra and the
            spectrum list contains {formatCount(spectrumListTotal)}. They are separate readings of
            the same file and MSCanvas does not decide which is right.
          </p>
        ) : null}
        <dl className="metadata-list">
          <div>
            <dt>Spectra</dt>
            <dd>{formatCount(runSummary.totalSpectrumCount)}</dd>
          </div>
          <div>
            <dt>Chromatograms</dt>
            {/* Absent, not zero: the backend reports no chromatogram count. */}
            <dd>
              {runSummary.chromatogramCount === null
                ? "Not reported"
                : formatCount(runSummary.chromatogramCount)}
            </dd>
          </div>
          <div>
            <dt>Retention time</dt>
            <dd>
              {runSummary.retentionTimeRange === null
                ? "Not reported"
                : `${formatRetentionTime(runSummary.retentionTimeRange.minimum)} – ${runSummary.retentionTimeRange.maximum.value.toFixed(4)}`}
            </dd>
          </div>
        </dl>
      </div>

      <div className="inspector-section">
        <h3>MS levels</h3>
        {runSummary.msLevelsTruncated ? (
          <p className="notice notice-warning" role="note">
            Showing the first {formatCount(runSummary.msLevels.length)} of{" "}
            {formatCount(runSummary.totalMsLevelCount)} MS levels the summary reported.
          </p>
        ) : null}
        {runSummary.msLevels.length === 0 ? (
          <p className="quiet-text">No MS level breakdown was reported.</p>
        ) : (
          <dl className="metadata-list">
            {runSummary.msLevels.map((level) => (
              <div key={level.msLevel ?? "other"}>
                <dt>{formatMsLevel(level.msLevel)}</dt>
                <dd>{formatCount(level.spectrumCount)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {metadata.sections.map((section) => (
        <div className="inspector-section" key={section.id}>
          <h3>{section.title}</h3>
          {section.truncated ? (
            <p className="notice notice-warning" role="note">
              Showing the first {formatCount(section.entries.length)} of{" "}
              {formatCount(section.totalEntryCount)} lines in this section.
            </p>
          ) : null}
          {section.entries.length === 0 ? (
            <p className="quiet-text">This section is empty in the file.</p>
          ) : (
            <ul className="metadata-lines">
              {section.entries.map((entry, entryIndex) => (
                <li key={`${section.id}-${String(entryIndex)}`}>{entry}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div className="inspector-section">
        <h3>Timing</h3>
        <p className="quiet-text">
          Descriptive measurements from this session on this machine. They are not budgets and
          nothing is cached to improve them.
        </p>
        <dl className="metadata-list">
          <MeasurementRow
            label="Open to first preview"
            measurement={latestMeasurement(measurements, "openToFirstPreview")}
          />
          <MeasurementRow
            label="Row select to rendered"
            measurement={latestMeasurement(measurements, "rowSelectToRendered")}
          />
          <MeasurementRow
            label="Spectrum table render"
            measurement={latestMeasurement(measurements, "spectrumTableRender")}
          />
        </dl>
      </div>
    </section>
  );
})

function MeasurementRow({
  label,
  measurement,
}: {
  readonly label: string;
  readonly measurement: PreviewMeasurement | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={measurement?.detail ?? undefined}>
        {measurement === null ? "Not measured yet" : formatDuration(measurement.milliseconds)}
      </dd>
    </div>
  );
}
