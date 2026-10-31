import { memo, useMemo } from "react";

import { Disclosure, Icon, IconButton } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";
import type { Metadata, RunSummary, SelectedFile, SelectedSpectrum } from "./contracts";
import {
  formatByteLength,
  formatCount,
  formatDatasetLabel,
  formatIntensity,
  formatMsLevel,
  formatMz,
  formatRetentionTime,
  formatRetentionTimeIn,
  REPRESENTATION,
  unitText,
} from "./format";
import { NotVerifiedTag } from "./NotVerifiedTag";
import { spectrumSourceDetails } from "./SpectrumViewport";
import type { SpectrumViewportState } from "./viewer/spectrumViewport";

export interface PreviewSummaryProps {
  readonly file: SelectedFile;
  /** The selected spectrum, once one has loaded. */
  readonly spectrum: SelectedSpectrum | null;
  /** How many scans the chromatogram is drawn from, while one is drawn. */
  readonly chromatogramScanCount: number | null;
  /** The spectrum's m/z viewport, which decides what its drawing is made of. */
  readonly spectrumViewport: SpectrumViewportState;
  /** Closes the Details drawer; its × shows only while Details is a drawer. */
  readonly onClose?: () => void;
}

/** Details' own ×, shown only while Details is a drawer (workbench.css). */
export function InspectorClose({ onClose }: { readonly onClose: () => void }) {
  const t = useUiMessages();
  return <IconButton size="sm" className="inspector-close" icon={<Icon name="close" />}
    label={t("provenanceCloseDetails")} onClick={onClose} />;
}

/**
 * Details: which acquisition is open, the selected spectrum's own facts, and
 * what each plot is drawn from. The run and the file's metadata are the
 * Metadata tab's ({@link PreviewMetadata}), so no fact is said twice.
 *
 * Memoized because the viewer publishes a new interaction state whenever the
 * pointer crosses from one scan to another. None of that reaches these props,
 * and this is what makes "does not reach" mean "does not re-render".
 *
 * ## What is translated here and what is not
 *
 * The labels, the headings and the truncation sentences are this application's
 * own copy and are resources. Everything they sit beside is not: a section
 * title and its lines come from the file, an MS level and a retention time are
 * measurements, and `Not reported` stays the *unreported state* rather than
 * becoming a zero in either language. A metadata section read out of an
 * acquisition is shown as the file spells it, in any locale.
 */
export const PreviewSummary = memo(function PreviewSummary({
  file,
  spectrum,
  chromatogramScanCount,
  spectrumViewport,
  onClose,
}: PreviewSummaryProps) {
  const t = useUiMessages();
  // A reduction over the drawn points: once per spectrum or committed window,
  // never per pointer frame.
  const spectrumSource = useMemo(
    () => (spectrum === null ? "" : spectrumSourceDetails(spectrum, spectrumViewport, t)),
    [spectrum, spectrumViewport, t],
  );
  const fileLabel = formatDatasetLabel(file);
  return (
    <section aria-labelledby="preview-summary-heading" className="panel inspector-panel">
      {onClose === undefined ? null : <InspectorClose onClose={onClose} />}
      <div className="inspector-section">
        {/* The filename plus only the bounded context Rust says the current
            roster needs. No absolute path crosses, and no location is
            reconstructed here. */}
        <h2 id="preview-summary-heading" className="preview-file-identity" title={fileLabel}>
          {t("summaryIdentity", { name: fileLabel, size: formatByteLength(file.byteLength, t) })}
        </h2>
        {/* An adopted output keeps its label wherever it is read (ADR 0055):
            beside the heading, so the file's name stays the heading's name. */}
        <NotVerifiedTag label={file.notVerifiedByMscanvas} />
      </div>
      <div className="inspector-section">
        <h3>{t("viewerSpectrum")}</h3>
        {spectrum === null ? <p className="quiet-text">{t("viewerSpectrumNone")}</p> : <SpectrumFacts spectrum={spectrum} />}
      </div>

      {chromatogramScanCount === null ? null : (
        <div className="inspector-section">
          <h3>{t("detailsChromatogramSource")}</h3>
          <p className="inspector-text">{t("viewerScanSource", { count: chromatogramScanCount })}</p>
        </div>
      )}

      {spectrumSource === "" ? null : (
        <div className="inspector-section">
          <h3>{t("detailsSpectrumSource")}</h3>
          <p className="inspector-text">{spectrumSource}</p>
        </div>
      )}
    </section>
  );
});

export interface PreviewMetadataProps {
  readonly file: SelectedFile;
  readonly runSummary: RunSummary;
  readonly metadata: Metadata;
  /** The spectrum list's own total, which is produced by a separate read. */
  readonly spectrumListTotal: number;
}

/**
 * The Metadata tab: what the loaded acquisition is, as the run summary reports
 * it, and the file's own metadata sections in the file's own words.
 */
export const PreviewMetadata = memo(function PreviewMetadata({ file, runSummary, metadata, spectrumListTotal }: PreviewMetadataProps) {
  const t = useUiMessages();
  // The run summary and the spectrum list are two separate reads of the same
  // file. When they disagree, showing one number here and a different one over
  // the table would present a single acquisition with two sizes.
  const countsDisagree = runSummary.totalSpectrumCount !== spectrumListTotal;
  return (
    <section aria-labelledby="preview-metadata-heading" className="preview-metadata">
      <div className="inspector-section">
        <h2 id="preview-metadata-heading">{t("summaryRun")}</h2>
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
            <dt>{t("summaryFile")}</dt>
            <dd>{formatDatasetLabel(file)}</dd>
          </div>
          <div>
            <dt>{t("summarySize")}</dt>
            <dd>{formatByteLength(file.byteLength, t)}</dd>
          </div>
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
          {/* A run with no rows has no range to state. */}
          {runSummary.retentionTimeRange.state === "noRows" ? null : <div>
            <dt>{t("summaryRetentionTime")}</dt>
            <dd>
              {runSummary.retentionTimeRange.state === "mixedUnits"
                ? t("summaryRetentionMixed")
                : `${runSummary.retentionTimeRange.minimum.toFixed(4)} – ${formatRetentionTimeIn(
                  runSummary.retentionTimeRange.maximum, runSummary.retentionTimeRange.unit, t)}`}
            </dd>
          </div>}
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

      {metadata.sections.length === 0 ? null : (
        <div className="inspector-section">
          <h3>{t("detailsSourceMetadata")}</h3>
          {metadata.sections.map((section) => (
            // The file's own heading, in the file's own words.
            <Disclosure className="metadata-disclosure" key={section.id} label={section.title}
              regionProps={{ className: "metadata-section" }}>
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
            </Disclosure>
          ))}
        </div>
      )}
    </section>
  );
});

/** The selected spectrum's facts, identifiers and precursors. */
function SpectrumFacts({ spectrum }: { readonly spectrum: SelectedSpectrum }) {
  const t = useUiMessages();
  const empty = spectrum.pointCount === 0;
  return <>
    <dl className="metadata-list spectrum-facts">
      <div><dt>{t("scanIndex")}</dt><dd>{formatCount(spectrum.index)}</dd></div>
      <div><dt>{t("scanNumber")}</dt><dd>{spectrum.scanNumber === null ? t("viewerNotReported") : formatCount(spectrum.scanNumber)}</dd></div>
      <div><dt>{t("scanMsLevel")}</dt><dd>MS{spectrum.msLevel}</dd></div>
      <div><dt>{t("scanRetentionTime")}</dt><dd>{formatRetentionTime(spectrum.retentionTime, t)}</dd></div>
      <div><dt>{t("viewerPoints")}</dt><dd>{formatCount(spectrum.pointCount)}</dd></div>
      <div><dt>{t("scanTotalIonCurrent")}</dt><dd>{formatIntensity(spectrum.totalIonCurrent)}</dd></div>
      {empty ? null : <>
        {/* The pair the spectrum states, each bound "not reported" where it states none -- never 0. */}
        <div><dt>{t("rangeMzAxis")}</dt><dd>{spectrum.mzLow === null && spectrum.mzHigh === null ? t("viewerNotReported")
          : `${reported(spectrum.mzLow, formatMz, t)} – ${reported(spectrum.mzHigh, formatMz, t)}`}</dd></div>
        <div><dt>{t("viewerBasePeak")}</dt><dd>{t("viewerBasePeakValue", { mz: formatMz(spectrum.basePeakMz), value: formatIntensity(spectrum.basePeakIntensity) })}</dd></div>
      </>}
      <div><dt>{t("viewerRepresentation")}</dt><dd>{t(REPRESENTATION[spectrum.representation])}</dd></div>
      <div><dt>{t("viewerMzUnit")}</dt><dd>{unitText(spectrum.mzUnit, t)}</dd></div>
      <div><dt>{t("viewerIntensityUnit")}</dt><dd>{unitText(spectrum.intensityUnit, t)}</dd></div>
    </dl>
    {spectrum.identifiers.length === 0 ? null : <>
      <h4>{t("viewerIdentifiers")}</h4>
      <ul className="metadata-lines">{spectrum.identifiers.map(identifier => <li key={identifier}>{identifier}</li>)}</ul>
    </>}
    {spectrum.precursors.length === 0 ? null : <>
      <h4>{t("viewerPrecursors")}</h4>
      {spectrum.precursorsTruncated ? <p className="notice notice-warning" role="note">
        {t("viewerPrecursorPrefix", { count: spectrum.precursors.length, total: spectrum.totalPrecursorCount })}</p> : null}
      <dl className="metadata-list">{spectrum.precursors.map(precursor => <div key={precursor.index}>
        <dt>{reported(precursor.mz, formatMz, t)}</dt><dd>{reported(precursor.intensity, formatIntensity, t)}</dd></div>)}</dl>
    </>}
  </>;
}

function reported(value: number | null, format: (value: number) => string, t: UiMessage): string {
  return value === null ? t("viewerNotReported") : format(value);
}
