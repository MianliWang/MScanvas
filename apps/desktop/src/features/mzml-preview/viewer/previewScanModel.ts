/**
 * The one adapter from the preview boundary into Layer A.
 *
 * `buildScanModel` decides what a scientific model is and when there is not
 * one. This file decides nothing: it names which field of a transferred row
 * answers which question, and hands the result over. Everything about
 * completeness, unit identity, ordering and refusal stays in `scanModel.ts`,
 * because a second copy of any of it here is a second thing to drift.
 *
 * The one fact this file supplies that the wire does not carry is
 * `tablePosition`: the scan table's order is the order its rows arrived in, and
 * the trace's order is retention time. Keeping both is what makes a tie
 * decidable and what Previous/Next walks.
 */

import type { SpectrumTable } from "../contracts";
import type { ScanModel, ScanSource } from "./scanModel";
import { buildScanModel } from "./scanModel";

/** Reads one loaded preview's spectrum table as the scientific model, or a refusal. */
export function buildPreviewScanModel(table: SpectrumTable): ScanModel {
  const rows: ScanSource[] = table.rows.map((row, tablePosition) => ({
    index: row.index,
    tablePosition,
    scanNumber: row.scanNumber,
    msLevel: row.msLevel,
    retentionTime: row.retentionTime.value,
    // The boolean the wire carries, forwarded rather than interpreted. What it
    // means for a model is `scanModel.ts`'s decision, and this build's answer
    // is to produce none: a unit was reported without saying which.
    retentionTimeUnitKnown: row.retentionTime.unitKnown,
    totalIonCurrent: row.totalIonCurrent,
    basePeakIntensity: row.basePeakIntensity,
  }));
  return buildScanModel({ rows, truncated: table.truncated });
}
