/**
 * What one wheel event is asking for.
 *
 * A `WheelEvent` carries two numbers, and until now this viewer read one bit of
 * them: the sign of `deltaY`. Every non-zero event applied the same fixed 0.85
 * step, so the zoom rate was governed by **how many event objects the device
 * chose to emit** rather than by how far the user actually scrolled. A mouse
 * that reports one detent as a single large delta and a precision touchpad that
 * reports the same physical travel as a stream of small ones were asking for the
 * same thing and getting answers that differed by orders of magnitude: from the
 * whole run to the narrowest viewport took 57 events, whatever those events said.
 *
 * The rule this module owns:
 *
 *   **the zoom magnitude is a continuous function of the normalized wheel
 *   delta, not of the number of `WheelEvent` objects it arrived in.**
 *
 * Two decisions make that true.
 *
 * **The delta is normalized before it is used.** `deltaY` is not a length until
 * `deltaMode` says what its unit is, so both are read and neither is assumed.
 * The coefficients below are this product's, stated once here rather than
 * discovered at a call site.
 *
 * **The mapping is exponential.** A zoom is a multiplication of the visible
 * span, so the exponent has to be what accumulates:
 *
 *   factor(a + b) = factor(a) · factor(b)
 *
 * which is exactly the property that makes chunking irrelevant. One event of
 * -100 pixels and a hundred events of -1 pixel arrive at the same span, because
 * 2^-0.2 and (2^-0.002)^100 are the same number. A linear `1 + k·delta` has no
 * such property: partitioning the same travel into more events would change
 * where it lands, which is the defect written a second way.
 *
 * Nothing here is a viewport authority. It answers "by what factor", and
 * `zoomDomain` — with its own clamping, its minimum span and its anchor — decides
 * what that means for a range. Nothing here is stored, either: a normalized
 * delta is a property of one event, not of the interaction.
 */

/** `WheelEvent.deltaMode`, as the DOM defines it. */
export const DOM_DELTA_PIXEL = 0;
export const DOM_DELTA_LINE = 1;
export const DOM_DELTA_PAGE = 2;

/**
 * How much of the exponent one unit of each mode is worth.
 *
 * A product decision rather than a physical measurement, and the three are
 * defined to agree with each other: 25 pixels is one line, and 500 pixels is
 * twenty lines is one page. What that buys is that a device reporting the same
 * gesture in a different unit asks for the same zoom.
 *
 * The absolute scale is what one full page of scroll does: an exponent of 1, so
 * a factor of 2 — one page of wheel halves or doubles the visible span. Every
 * other magnitude follows from that continuously, with no step and no floor.
 */
export const PIXEL_COEFFICIENT = 0.002;
export const LINE_COEFFICIENT = 0.05;
export const PAGE_COEFFICIENT = 1;

/** The two fields of a wheel event this viewer reads, and nothing else. */
export interface WheelDelta {
  readonly deltaY: number;
  readonly deltaMode: number;
}

/**
 * What one unit of this mode is worth, or `null` for a mode we do not know.
 *
 * An unknown `deltaMode` fails open: the wheel is not claimed and the page keeps
 * it. Guessing a unit would be worse than declining — a mode this code has never
 * heard of could mean anything, and treating it as pixels would make some future
 * device's ordinary scroll into a wild zoom.
 */
function modeCoefficient(deltaMode: number): number | null {
  switch (deltaMode) {
    case DOM_DELTA_PIXEL:
      return PIXEL_COEFFICIENT;
    case DOM_DELTA_LINE:
      return LINE_COEFFICIENT;
    case DOM_DELTA_PAGE:
      return PAGE_COEFFICIENT;
    default:
      return null;
  }
}

/**
 * One wheel event as an exponent, in units where a page is 1.
 *
 * `null` when the event asks for nothing (`deltaY` of zero) or asks in terms
 * this viewer cannot read (a non-finite delta, an unknown mode). Both are the
 * same answer to the adapter: not ours.
 */
export function normalizeWheelDelta(wheel: WheelDelta): number | null {
  if (!Number.isFinite(wheel.deltaY) || wheel.deltaY === 0) {
    return null;
  }
  const coefficient = modeCoefficient(wheel.deltaMode);
  if (coefficient === null) {
    return null;
  }
  return wheel.deltaY * coefficient;
}

/**
 * The factor one wheel event asks the visible span to be multiplied by.
 *
 * Oriented the way the DOM is: a negative `deltaY` — the wheel pushed away, the
 * fingers moving up — is a factor below 1, which narrows the span. Scrolling the
 * other way widens it, and the two are reciprocal, so the same travel back and
 * forth returns to where it started.
 *
 * `null` where the exponent is unreadable, and also where it is so extreme that
 * the factor is no longer a finite positive number. Nothing a device emits gets
 * anywhere near that; a factor that has overflowed is not a request this viewer
 * can honour, so it declines rather than passing a zero or an infinity into the
 * viewport arithmetic.
 */
export function wheelZoomFactor(wheel: WheelDelta): number | null {
  const exponent = normalizeWheelDelta(wheel);
  if (exponent === null) {
    return null;
  }
  const factor = 2 ** exponent;
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}
