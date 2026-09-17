import { memo } from "react";

import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { Metadata, RunSummary, SelectedFile } from "./contracts";
import {
  formatByteLength,
  formatCount,
  formatDatasetLabel,
  formatDuration,
  formatMsLevel,
  formatRetentionTime,
  formatRetentionTimeValue,
} from "./format";
import {
  latestMeasurement,
  type PreviewMeasurement,
  type PreviewMeasurementDetail,
} from "./instrumentation";
import type { MessageKey, UiMessage } from "../preferences/i18n";

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
 *
 * ## What is translated here and what is not
 *
 * The labels, the headings and the two truncation sentences are this
 * application's own copy and are resources. Everything they sit beside is not:
 * a section title and its lines come from the file, an MS level and a retention
 * time are measurements, and `Not reported` stays the *unreported state* rather
 * than becoming a zero in either language. A metadata section read out of an
 * acquisition is shown as the file spells it, in any locale.
 */
export const PreviewSummary = memo(function PreviewSummary({
  file,
  runSummary,
  metadata,
  spectrumListTotal,
  measurements,
}: PreviewSummaryProps) {
  const t = useUiMessages();
  // The run summary and the spectrum list are two separate reads of the same
  // file. When they disagree, showing one number here and a different one over
  // the table would present a single acquisition with two sizes.
  const countsDisagree = runSummary.totalSpectrumCount !== spectrumListTotal;
  const fileLabel = formatDatasetLabel(file);
  return (
    <section aria-labelledby="preview-summary-heading" className="panel inspector-panel">
      <header className="panel-header">
        <div>
          <h2 id="preview-summary-heading">{t("summaryRun")}</h2>
          {/* The filename plus only the bounded context Rust says the current
              roster needs. No absolute path crosses, and no location is
              reconstructed here. */}
          <p className="preview-file-identity" title={fileLabel}>
            {t("summaryIdentity", { name: fileLabel, size: formatByteLength(file.byteLength, t) })}
          </p>
        </div>
      </header>

      <div className="inspector-section">
        <h3>{t("summarySummary")}</h3>
        {countsDisagree ? (
          <p className="notice notice-warning" role="note">
            {t("summaryCountsDisagree", {
              summary: formatCount(runSummary.totalSpectrumCount),
              list: formatCount(spectrumListTotal),
            })}
          </p>
        ) : null}
        <dl className="metadata-list">
          <div>
            <dt>{t("summarySpectra")}</dt>
            <dd>{formatCount(runSummary.totalSpectrumCount)}</dd>
          </div>
          <div>
            <dt>{t("summaryChromatograms")}</dt>
            {/* Absent, not zero: the backend reports no chromatogram count. */}
            <dd>
              {runSummary.chromatogramCount === null
                ? t("viewerNotReported")
                : formatCount(runSummary.chromatogramCount)}
            </dd>
          </div>
          <div>
            <dt>{t("summaryRetentionTime")}</dt>
            <dd>
              {runSummary.retentionTimeRange === null
                ? t("viewerNotReported")
                : `${formatRetentionTimeValue(runSummary.retentionTimeRange.minimum)} – ${formatRetentionTime(runSummary.retentionTimeRange.maximum, t)}`}
            </dd>
          </div>
        </dl>
      </div>

      <div className="inspector-section">
        <h3>{t("summaryMsLevels")}</h3>
        {runSummary.msLevelsTruncated ? (
          <p className="notice notice-warning" role="note">
            {t("summaryMsLevelsTruncated", {
              shown: formatCount(runSummary.msLevels.length),
              total: formatCount(runSummary.totalMsLevelCount),
            })}
          </p>
        ) : null}
        {runSummary.msLevels.length === 0 ? (
          <p className="quiet-text">{t("summaryNoMsLevels")}</p>
        ) : (
          <dl className="metadata-list">
            {runSummary.msLevels.map((level) => (
              <div key={level.msLevel ?? "other"}>
                <dt>{formatMsLevel(level.msLevel, t)}</dt>
                <dd>{formatCount(level.spectrumCount)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {metadata.sections.map((section) => (
        <div className="inspector-section" key={section.id}>
          {/* The file's own heading, in the file's own words. */}
          <h3>{section.title}</h3>
          {section.truncated ? (
            <p className="notice notice-warning" role="note">
              {t("summarySectionTruncated", {
                shown: formatCount(section.entries.length),
                total: formatCount(section.totalEntryCount),
              })}
            </p>
          ) : null}
          {section.entries.length === 0 ? (
            <p className="quiet-text">{t("summaryEmptySection")}</p>
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
        <h3>{t("summaryTiming")}</h3>
        <p className="quiet-text">{t("summaryTimingHelp")}</p>
        <dl className="metadata-list">
          <MeasurementRow
            label="summaryOpenToPreview"
            measurement={latestMeasurement(measurements, "openToFirstPreview")}
            t={t}
          />
          <MeasurementRow
            label="summaryRowToRendered"
            measurement={latestMeasurement(measurements, "rowSelectToRendered")}
            t={t}
          />
          <MeasurementRow
            label="summaryTableRender"
            measurement={latestMeasurement(measurements, "spectrumTableRender")}
            t={t}
          />
        </dl>
      </div>
    </section>
  );
})

/** The tooltip for one measurement, worded here because here has a locale. */
function detailText(detail: PreviewMeasurementDetail, t: UiMessage): string {
  return detail.key === "measureRowDetail"
    ? t("measureRowDetail", { index: detail.index })
    : t(detail.key, { rows: detail.rows });
}

function MeasurementRow({
  label,
  measurement,
  t,
}: {
  readonly label: MessageKey;
  readonly measurement: PreviewMeasurement | null;
  readonly t: UiMessage;
}) {
  return (
    <div>
      <dt>{t(label)}</dt>
      <dd title={measurement === null ? undefined : detailText(measurement.detail, t)}>
        {measurement === null ? t("summaryNotMeasured") : formatDuration(measurement.milliseconds)}
      </dd>
    </div>
  );
}
