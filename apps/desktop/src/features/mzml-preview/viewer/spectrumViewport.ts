/**
 * The selected spectrum's m/z viewport, and the screen projection it draws.
 *
 * Pure TypeScript: no React, no DOM, no timers, no browser globals. An adapter
 * eventually reports that a gesture settled or that a projection came back, and
 * whether either still means anything is this reducer's decision rather than a
 * race between a callback and a cancellation.
 *
 * ## Why this is not `ViewerInteractionState`
 *
 * That contract owns the linked run: one retention-time domain, one selected
 * scan, one commit revision every linked view consumes. This owns a different
 * axis of a different source, and merging them would make the one thing neither
 * can afford — a range read for the wrong axis — a plain field access away.
 *
 * So they share arithmetic *shape* and no state. `MzDomain` is nominally
 * distinct from `RetentionTimeDomain`: both are closed intervals, and the type
 * system refuses to let one stand in for the other.
 *
 * ## Two authorities, and a spectrum may have neither
 *
 * A spectrum being valid source data does not mean it has a viewport. mzML
 * permits an m/z array the ordered-series contract refuses, and nothing sorts
 * one — so Rust answers **whether** an authoritative domain exists, this side
 * never derives one, and a refusal is a state rather than a missing value.
 *
 * Where a domain exists, the **committed** window is the range authority: the
 * semantic answer to what the reader is looking at, and later the only thing a
 * `Current`-range export may consume. A gesture in flight is a drawing rather
 * than a decision.
 *
 * ## The screen is not the science
 *
 * What a viewport draws is a bounded projection Rust takes from the complete
 * spectrum it retained. It may carry fewer points than the window measured; it
 * carries no point the source did not measure; and **no scientific export is
 * ever taken from it.**
 */

import type { SpectrumProjection, SpectrumViewportDomain } from "../contracts";

/**
 * A closed interval on the m/z axis.
 *
 * Structurally a pair of numbers and nominally its own type. The brand costs
 * nothing at runtime and makes `clampMzDomain(retentionTimeDomain, …)` a
 * compile error, which is the whole reason the two viewports are separate.
 */
export interface MzDomain {
  readonly low: number;
  readonly high: number;
  /** Present only in the type system; no value ever carries it. */
  readonly __axis?: "mz";
}

/** Builds a domain from two numbers, once they are known to be an interval. */
export function mzDomain(low: number, high: number): MzDomain {
  return { low, high };
}

/**
 * How far into the full span a viewport may narrow.
 *
 * The same fraction the retention-time viewport uses, and stated as a fraction
 * of the source rather than as an absolute width for the same reason: an
 * absolute floor would mean different things for a narrow window and a wide
 * one, and the m/z axis reports no unit at all.
 *
 * A spectrum whose points share one m/z — or which has none — has a zero-width
 * domain and therefore no subrange: zoom is inert there rather than ill-defined.
 */
export const MINIMUM_MZ_SPAN_FRACTION = 1 / 10_000;

/** The narrowest window this spectrum may be zoomed to. */
export function minimumMzSpan(full: MzDomain): number {
  const span = full.high - full.low;
  return span > 0 ? span * MINIMUM_MZ_SPAN_FRACTION : 0;
}

/** Whether a window is the whole spectrum. `null` always is. */
export function isFullMzDomain(visible: MzDomain | null, full: MzDomain): boolean {
  return visible === null || (visible.low <= full.low && visible.high >= full.high);
}

/**
 * Brings a window back inside the spectrum, keeping its span where it can.
 *
 * Total: any input, including one that is not a sensible interval, answers with
 * an interval that is finite, forward and inside the source. A viewport is a
 * divisor in every coordinate a renderer computes, so that has to be a property
 * of this function rather than a rule its callers remember.
 *
 * **Inside means inside, to the last bit.** Both ends are held to the source
 * explicitly rather than trusted to arrive there, because `(high - span) + span`
 * is not required to equal `high` in binary floating point — and this window is
 * what a projection request asks Rust for, which refuses a window the source
 * does not have rather than quietly answering with the nearest one that fits.
 * The retention-time viewport learned the same lesson against the same refusal.
 */
export function clampMzDomain(visible: MzDomain, full: MzDomain): MzDomain {
  const fullSpan = full.high - full.low;
  if (!(fullSpan > 0)) {
    return mzDomain(full.low, full.high);
  }
  const smallest = minimumMzSpan(full);
  let span = Math.min(fullSpan, Math.max(smallest, visible.high - visible.low));
  if (!Number.isFinite(span) || span <= 0) {
    span = fullSpan;
  }
  let low = Number.isFinite(visible.low) ? visible.low : full.low;
  const furthest = Math.max(full.low, full.high - span);
  low = Math.min(Math.max(low, full.low), furthest);
  return mzDomain(low, Math.min(full.high, low + span));
}

/** Zooms about a point in the current window, as a fraction of its width. */
export function zoomMzDomain(
  visible: MzDomain,
  full: MzDomain,
  factor: number,
  anchor: number,
): MzDomain {
  const fullSpan = full.high - full.low;
  if (!(fullSpan > 0) || !Number.isFinite(factor) || factor <= 0) {
    return clampMzDomain(visible, full);
  }
  const span = visible.high - visible.low;
  if (!(span > 0)) {
    return clampMzDomain(visible, full);
  }
  const held = visible.low + span * Math.min(1, Math.max(0, anchor));
  const next = Math.min(fullSpan, Math.max(minimumMzSpan(full), span * factor));
  return clampMzDomain(
    mzDomain(held - (held - visible.low) * (next / span), held + (visible.high - held) * (next / span)),
    full,
  );
}

/** Slides the window by a fraction of its own width. */
export function panMzDomain(visible: MzDomain, full: MzDomain, fraction: number): MzDomain {
  const span = visible.high - visible.low;
  const shift = span * fraction;
  return clampMzDomain(mzDomain(visible.low + shift, visible.high + shift), full);
}

/** A gesture in progress: a zoom or a pan that has not settled. */
export interface MzGesture {
  /** What makes a late settle answerable. Monotonic, never reused. */
  readonly epoch: number;
  readonly domain: MzDomain;
}

/**
 * What the screen projection for the committed window is doing.
 *
 * Every state an asynchronous surface owes, and the reason each exists:
 *
 * - `idle` — nothing has been asked for yet. The spectrum has a domain and no
 *   drawing has been requested against it.
 * - `loading` — a request for `window` is outstanding. **The previous drawing
 *   is not current for these axes**, and missing data here is not an empty
 *   spectrum.
 * - `ready` — a drawing that answers the committed window. It may be empty:
 *   a window of a spectrum may truthfully hold no reported point, and nothing
 *   is interpolated to avoid saying so.
 * - `failed` — the request that was current when it failed. The committed
 *   window is kept; the drawing is not.
 */
export type MzProjectionState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly generation: number; readonly window: MzDomain }
  | {
      readonly status: "ready";
      readonly generation: number;
      readonly window: MzDomain;
      readonly projection: SpectrumProjection;
    }
  | {
      readonly status: "failed";
      readonly generation: number;
      readonly window: MzDomain;
      readonly retryable: boolean;
    };

/**
 * The viewport for one selected spectrum, or the fact that it has none.
 *
 * `refused` is not an error state and not an absence: it is Rust's verdict that
 * the scientific contract cannot establish a domain over this spectrum without
 * altering it. The spectrum is still selected and still exportable as data.
 */
export type SpectrumViewportState =
  | { readonly status: "none" }
  | {
      readonly status: "refused";
      readonly spectrumToken: string;
      readonly reason: SpectrumViewportDomain & { readonly state: "refused" };
    }
  | {
      readonly status: "ready";
      /** Which retained spectrum this viewport belongs to. */
      readonly spectrumToken: string;
      readonly full: MzDomain;
      /** The committed window. `null` means the whole spectrum. */
      readonly committed: MzDomain | null;
      readonly gesture: MzGesture | null;
      readonly projection: MzProjectionState;
      readonly nextEpoch: number;
      readonly nextGeneration: number;
    };

export const initialSpectrumViewportState: SpectrumViewportState = { status: "none" };

export type SpectrumViewportEvent =
  /**
   * A spectrum became the selected one, with Rust's verdict about its domain.
   *
   * The token is the identity: a different one is a different spectrum and
   * therefore a different viewport context, and the same one arriving again is
   * a redelivery of what is already current rather than a reason to reset.
   */
  | {
      readonly type: "spectrum-selected";
      readonly spectrumToken: string;
      readonly domain: SpectrumViewportDomain;
    }
  /** No spectrum is selected any more. */
  | { readonly type: "spectrum-cleared" }
  | { readonly type: "gesture-started"; readonly domain: MzDomain }
  | { readonly type: "gesture-moved"; readonly epoch: number; readonly domain: MzDomain }
  | { readonly type: "gesture-settled"; readonly epoch: number }
  | { readonly type: "gesture-cancelled"; readonly epoch: number }
  /** A keyboard step or a button: committed at once, with no gesture. */
  | { readonly type: "viewport-step"; readonly domain: MzDomain }
  | { readonly type: "viewport-reset" }
  /** A projection was requested for the committed window. */
  | { readonly type: "projection-requested" }
  | {
      readonly type: "projection-succeeded";
      readonly generation: number;
      readonly projection: SpectrumProjection;
    }
  | {
      readonly type: "projection-failed";
      readonly generation: number;
      readonly retryable: boolean;
    };

/**
 * The viewport reducer.
 *
 * Total and deterministic: every event produces a state, and an event that no
 * longer applies produces the state it was given, **unchanged by identity** so a
 * caller may compare by reference to decide whether anything happened.
 */
export function spectrumViewportReducer(
  state: SpectrumViewportState,
  event: SpectrumViewportEvent,
): SpectrumViewportState {
  switch (event.type) {
    case "spectrum-selected":
      return selectSpectrum(state, event.spectrumToken, event.domain);

    case "spectrum-cleared":
      return state.status === "none" ? state : initialSpectrumViewportState;

    default:
      break;
  }
  if (state.status !== "ready") {
    // A refused spectrum has no viewport to move and no projection to request.
    // Nothing is synthesised to keep an adapter's events meaningful.
    return state;
  }
  switch (event.type) {
    case "gesture-started":
      return {
        ...state,
        gesture: { epoch: state.nextEpoch, domain: clampMzDomain(event.domain, state.full) },
        nextEpoch: state.nextEpoch + 1,
      };

    case "gesture-moved":
      if (state.gesture === null || state.gesture.epoch !== event.epoch) {
        return state;
      }
      return {
        ...state,
        gesture: { epoch: event.epoch, domain: clampMzDomain(event.domain, state.full) },
      };

    case "gesture-settled": {
      // A settle from an epoch that is no longer active is a no-op *by
      // identity*. Correctness may not rest on a timer being cleared in time.
      if (state.gesture === null || state.gesture.epoch !== event.epoch) {
        return state;
      }
      return commit(state, committedForm(state.gesture.domain, state.full));
    }

    case "gesture-cancelled":
      if (state.gesture === null || state.gesture.epoch !== event.epoch) {
        return state;
      }
      // Abandoned rather than committed: the committed window is untouched.
      return { ...state, gesture: null };

    case "viewport-step":
      // A deliberate instruction supersedes anything in flight, so its pending
      // settle becomes a stale epoch and can no longer overwrite what follows.
      return commit(state, committedForm(event.domain, state.full));

    case "viewport-reset":
      return commit(state, null);

    case "projection-requested":
      return {
        ...state,
        projection: {
          status: "loading",
          generation: state.nextGeneration,
          window: state.committed ?? state.full,
        },
        nextGeneration: state.nextGeneration + 1,
      };

    case "projection-succeeded": {
      const current = currentGeneration(state);
      if (current === null || current !== event.generation) {
        // A stale answer replaces nothing, surfaces nothing and restores
        // nothing -- for a success exactly as for a failure.
        return state;
      }
      return {
        ...state,
        projection: {
          status: "ready",
          generation: event.generation,
          window: state.projection.status === "loading" ? state.projection.window : state.full,
          projection: event.projection,
        },
      };
    }

    case "projection-failed": {
      const current = currentGeneration(state);
      if (current === null || current !== event.generation) {
        return state;
      }
      return {
        ...state,
        projection: {
          status: "failed",
          generation: event.generation,
          window: state.projection.status === "loading" ? state.projection.window : state.full,
          retryable: event.retryable,
        },
      };
    }

    default:
      return state;
  }
}

/**
 * A different spectrum is a different viewport context.
 *
 * The previous spectrum's absolute m/z window is not preserved, not intersected
 * with the new spectrum, and not clamped into it and called continuity. Two
 * spectra do not share one authoritative m/z navigation state merely because
 * they occupy the same panel — and a window kept across a selection would be
 * offered as `Current` for a range the new source may not have.
 *
 * The same token arriving again is a redelivery of what is already current. It
 * resets nothing: a re-render is not a navigation.
 */
function selectSpectrum(
  state: SpectrumViewportState,
  spectrumToken: string,
  domain: SpectrumViewportDomain,
): SpectrumViewportState {
  if (state.status !== "none" && state.spectrumToken === spectrumToken) {
    return state;
  }
  if (domain.state === "refused") {
    return { status: "refused", spectrumToken, reason: domain };
  }
  return {
    status: "ready",
    spectrumToken,
    full: mzDomain(domain.low, domain.high),
    // Its own full domain, which is what reset means for this spectrum.
    committed: null,
    gesture: null,
    projection: { status: "idle" },
    // Both counters start fresh with the spectrum: an outstanding request for
    // the previous one can never match a generation issued for this one, so a
    // late answer about another spectrum cannot become this one's drawing.
    nextEpoch: 1,
    nextGeneration: 1,
  };
}

/** Which projection request, if any, an answer may still be current for. */
function currentGeneration(
  state: SpectrumViewportState & { readonly status: "ready" },
): number | null {
  return state.projection.status === "loading" ? state.projection.generation : null;
}

/**
 * Commits a window, dropping whatever was in flight for the previous one.
 *
 * The projection returns to `idle` rather than keeping the old drawing: it
 * answered a different window, and leaving it in place is how a reader comes to
 * see one range's data beneath another range's axes. An adapter asks for the
 * new one.
 */
function commit(
  state: SpectrumViewportState & { readonly status: "ready" },
  committed: MzDomain | null,
): SpectrumViewportState {
  const unchanged =
    sameDomain(state.committed, committed) &&
    state.gesture === null &&
    state.projection.status !== "loading";
  if (unchanged) {
    return state;
  }
  return { ...state, committed, gesture: null, projection: { status: "idle" } };
}

/** The committed form of a window: clamped, and `null` when it is the source. */
function committedForm(domain: MzDomain, full: MzDomain): MzDomain | null {
  const clamped = clampMzDomain(domain, full);
  return isFullMzDomain(clamped, full) ? null : clamped;
}

/**
 * Whether two windows are the same range, by value.
 *
 * The arithmetic is deterministic, so a clamp landing on the range already
 * shown produces the same numbers in a new object; comparing references would
 * call that a change.
 */
function sameDomain(left: MzDomain | null, right: MzDomain | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.low === right.low && left.high === right.high;
}

/**
 * The window a renderer should draw right now.
 *
 * The gesture when one is in progress, the committed window otherwise, the
 * whole spectrum when neither. Readers ask this rather than choosing between
 * the fields themselves.
 */
export function renderedMzDomain(state: SpectrumViewportState): MzDomain | null {
  if (state.status !== "ready") {
    return null;
  }
  return state.gesture?.domain ?? state.committed ?? state.full;
}

/**
 * The window a projection should be requested for.
 *
 * The **committed** one, never the gesture: a range still being dragged is a
 * drawing rather than a decision, and asking Rust for one per pointer frame
 * would make a screen refresh a stream of requests.
 */
export function projectionWindow(state: SpectrumViewportState): MzDomain | null {
  return state.status === "ready" ? (state.committed ?? state.full) : null;
}

/** The epoch a gesture adapter should tag its events with, if one is active. */
export function activeMzGestureEpoch(state: SpectrumViewportState): number | null {
  return state.status === "ready" ? (state.gesture?.epoch ?? null) : null;
}
