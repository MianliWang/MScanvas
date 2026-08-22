/**
 * Layers B and C — what a retention-time viewport is, and what may be done to
 * one.
 *
 * Pure arithmetic over closed intervals. Nothing here knows whether a viewport
 * is committed or in the middle of a gesture; that distinction belongs to
 * `interactionState.ts`, and keeping it out of here is what lets both use the
 * same clamping rules without either being able to skip them.
 *
 * Every function is total: given any input, including one that is not a
 * sensible interval, it answers with an interval that is finite, forward and
 * inside the run. A viewport is a divisor in every coordinate the renderer
 * computes, so "cannot be nonsense" has to be a property of the type's
 * constructors rather than a rule callers remember.
 */

import type { RetentionTimeDomain } from "./scanModel";

/**
 * How far into the full span a viewport may narrow.
 *
 * One ten-thousandth of the full retention-time span. Stated as a fraction of
 * the data rather than as an absolute time, because the unit is not reported
 * and an absolute floor would mean different things for a run of seconds and a
 * run of hours.
 *
 * A run whose scans all share one retention time has a zero-width full span and
 * therefore no subrange at all: zoom is inert there rather than ill-defined.
 */
export const MINIMUM_SPAN_FRACTION = 1 / 10_000;

/** The narrowest viewport this run may be zoomed to. */
export function minimumSpan(full: RetentionTimeDomain): number {
  const span = full.high - full.low;
  return span > 0 ? span * MINIMUM_SPAN_FRACTION : 0;
}

/** Whether a viewport is the whole run. `null` always is. */
export function isFullDomain(
  visible: RetentionTimeDomain | null,
  full: RetentionTimeDomain,
): boolean {
  return visible === null || (visible.low <= full.low && visible.high >= full.high);
}

/**
 * Brings a viewport back inside the run, keeping its span where it can.
 *
 * A pan that would leave the run stops at the edge rather than shortening, so
 * panning to the end and back does not slowly narrow the viewport.
 */
export function clampDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
): RetentionTimeDomain {
  const fullSpan = full.high - full.low;
  if (!(fullSpan > 0)) {
    return { low: full.low, high: full.high };
  }
  const smallest = minimumSpan(full);
  let span = Math.min(fullSpan, Math.max(smallest, visible.high - visible.low));
  if (!Number.isFinite(span) || span <= 0) {
    span = fullSpan;
  }
  let low = Number.isFinite(visible.low) ? visible.low : full.low;
  low = Math.min(Math.max(low, full.low), full.high - span);
  return { low, high: low + span };
}

/**
 * Zooms about a point in the current viewport.
 *
 * `anchor` is where the pointer is, as a fraction of the visible width, so the
 * retention time under the cursor stays under it. A keyboard zoom passes 0.5.
 */
export function zoomDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
  factor: number,
  anchor: number,
): RetentionTimeDomain {
  const fullSpan = full.high - full.low;
  if (!(fullSpan > 0) || !Number.isFinite(factor) || factor <= 0) {
    return clampDomain(visible, full);
  }
  const span = visible.high - visible.low;
  if (!(span > 0)) {
    return clampDomain(visible, full);
  }
  const held = visible.low + span * Math.min(1, Math.max(0, anchor));
  const next = Math.min(fullSpan, Math.max(minimumSpan(full), span * factor));
  return clampDomain(
    {
      low: held - (held - visible.low) * (next / span),
      high: held + (visible.high - held) * (next / span),
    },
    full,
  );
}

/** Slides the viewport by a fraction of its own width. */
export function panDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
  fraction: number,
): RetentionTimeDomain {
  const span = visible.high - visible.low;
  const shift = span * fraction;
  return clampDomain({ low: visible.low + shift, high: visible.high + shift }, full);
}

/**
 * Moves a viewport the least it can to put a retention time inside it.
 *
 * Used when a selection arrives from another surface and lands outside what the
 * plot is showing. Resetting the zoom would be the easy answer and the wrong
 * one: the user chose that span, and selecting a scan is not a request to stop
 * looking at it.
 *
 * Returns the same object when nothing needs to move, so a caller can compare
 * by identity to decide whether to publish anything.
 */
export function revealDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
  retentionTime: number,
): RetentionTimeDomain {
  if (!Number.isFinite(retentionTime)) {
    return visible;
  }
  if (retentionTime >= visible.low && retentionTime <= visible.high) {
    return visible;
  }
  const span = visible.high - visible.low;
  // A margin, so the marker arrives inside the plot rather than exactly on the
  // edge where the rule and the axis line coincide.
  const margin = span * 0.1;
  const low =
    retentionTime < visible.low
      ? retentionTime - margin
      : visible.low + (retentionTime - visible.high) + margin;
  return clampDomain({ low, high: low + span }, full);
}

/** Whether a retention time falls inside a viewport, edges included. */
export function contains(domain: RetentionTimeDomain, retentionTime: number): boolean {
  return retentionTime >= domain.low && retentionTime <= domain.high;
}
