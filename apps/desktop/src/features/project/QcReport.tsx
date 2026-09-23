/**
 * The QC summary report: what one snapshot recorded, in the Project surface's
 * main region.
 *
 * Evidence first and nothing else. It shows the values a preview's run summary
 * reported -- the spectrum total, the MS-level buckets in the order they were
 * reported, the chromatogram count or that none was reported, and the five
 * retention times with their unit state -- as small tables, because a table
 * keeps a value and its label together and loses nothing to a chart's scale.
 * There is no grade, no threshold and no pass or fail colour: this slice
 * defines none, and a green card would claim one.
 *
 * Values are shown exactly as recorded. Counts are grouped for reading, which
 * changes no digit; retention times are the stored text, because formatting a
 * float again is how a value quietly becomes a different one.
 *
 * Where it came from and which build produced it are the Details region's to
 * say, not repeated here.
 */

import { useEffect, useRef } from "react";

import { formatCount } from "../mzml-preview/format";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { QcRetentionTime, QcSnapshot } from "./projectApi";

export interface QcReportProps {
  /** The artifact's identifier, so the report can tell one from the next. */
  readonly artifactId: string;
  readonly snapshot: QcSnapshot;
  /** The source reference's label, or `null` where it is not resolvable. */
  readonly sourceName: string | null;
  /** When the capture was recorded, already formatted for the reader. */
  readonly recordedWhen: string | null;
}

export function QcReport({ artifactId, snapshot, sourceName, recordedWhen }: QcReportProps) {
  const t = useUiMessages();
  const section = useRef<HTMLElement | null>(null);

  // A report chosen from the history below, or from Details, appears at the top
  // of a surface that may be scrolled well past it. Its heading is brought into
  // view where it is not already, without taking the keyboard from the control
  // that chose it -- and not at all where it is, so a report that arrives
  // beside a visible control does not scroll that control away.
  //
  // Only the project surface's own scroll position moves. `scrollIntoView`
  // scrolls every ancestor that can scroll, and took the whole shell with it,
  // header and all; and its "nearest" alignment, for a report taller than the
  // window, shows the bottom and hides the heading.
  useEffect(() => {
    const element = section.current;
    const container = element?.closest<HTMLElement>(".workbench-project") ?? null;
    if (element === null || container === null) return;
    const top = element.getBoundingClientRect().top;
    const bounds = container.getBoundingClientRect();
    if (top < bounds.top || top > bounds.bottom - 48) {
      container.scrollTop += top - bounds.top;
    }
  }, [artifactId]);

  const retention = snapshot.retentionTime;
  const unit = (value: QcRetentionTime) =>
    value.unit === "notEmitted" ? t("qcReportUnitNotReported") : value.unit;

  return (
    <section
      ref={section}
      className="project-section qc-report"
      aria-labelledby="qc-report-title"
      data-qc-report={artifactId}
    >
      <h3 id="qc-report-title">{t("qcReportTitle")}</h3>
      <p className="qc-report-of" data-qc-report-source="">
        {sourceName === null ? t("provenanceRelatedGone") : sourceName}
        {recordedWhen === null ? null : (
          <span className="qc-report-when"> · {t("qcReportRecorded", { when: recordedWhen })}</span>
        )}
      </p>
      <p className="project-note">{t("qcReportMeaning")}</p>

      <div className="qc-report-tables">
        <table className="qc-report-table" data-qc-totals="">
          <caption>{t("qcReportTotals")}</caption>
          <tbody>
            <tr>
              <th scope="row">{t("qcReportTotalSpectra")}</th>
              <td data-qc-total-spectra="">{formatCount(snapshot.totalSpectrumCount)}</td>
            </tr>
            <tr>
              <th scope="row">{t("qcReportChromatograms")}</th>
              <td data-qc-chromatograms={snapshot.chromatogramCount.kind}>
                {snapshot.chromatogramCount.kind === "reported"
                  ? formatCount(snapshot.chromatogramCount.count)
                  : t("qcReportNotReported")}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="qc-report-table" data-qc-ms-levels="">
          <caption>{t("qcReportMsLevels")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("qcReportMsLevelColumn")}</th>
              <th scope="col">{t("qcReportSpectraColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {/* In the reported order, keyed by position: the order is part of
                what was recorded, and nothing here sorts it. */}
            {snapshot.msLevelCounts.map((bucket, index) => (
              <tr
                key={index}
                data-qc-bucket={bucket.kind === "level" ? `ms${bucket.msLevel}` : "other"}
              >
                <th scope="row">
                  {bucket.kind === "level"
                    ? t("qcReportMsLevel", { level: String(bucket.msLevel) })
                    : t("qcReportOtherLevel")}
                </th>
                <td>{formatCount(bucket.spectrumCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {retention.kind === "notReported" ? (
          <p className="project-note" data-qc-retention="notReported">
            {t("qcReportRetentionNotReported")}
          </p>
        ) : (
          <table className="qc-report-table" data-qc-retention="reported">
            <caption>{t("qcReportRetention")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("qcReportRetentionPosition")}</th>
                <th scope="col">{t("qcReportRetentionValue")}</th>
                <th scope="col">{t("qcReportRetentionUnit")}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["minimum", "qcReportRtMinimum", retention.minimum],
                  ["at25", "qcReportRt25", retention.at25PercentBasePeakIntensity],
                  ["at50", "qcReportRt50", retention.at50PercentBasePeakIntensity],
                  ["at75", "qcReportRt75", retention.at75PercentBasePeakIntensity],
                  ["maximum", "qcReportRtMaximum", retention.maximum],
                ] as const
              ).map(([position, label, value]) => (
                <tr key={position} data-qc-rt={position}>
                  <th scope="row">{t(label)}</th>
                  <td className="qc-report-value">{value.value}</td>
                  <td data-qc-unit={value.unit}>{unit(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
