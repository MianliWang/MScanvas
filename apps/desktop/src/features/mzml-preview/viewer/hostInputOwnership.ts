/**
 * Which modified inputs belong to the host WebView rather than to a plot.
 *
 * The viewers already answer *whether an input is productive* -- a wheel at full
 * range is released, a key that would change nothing is not claimed -- and that
 * question is about this product's own semantics. This module answers a question
 * that comes before it and has a different owner: **whether the input was ever
 * ours to plan at all.**
 *
 * ## Why this supersedes "`ctrlKey` has no meaning"
 *
 * ADR 0033 decided that the chromatogram would assign `ctrlKey` nothing, on the
 * ground that reading it as a trackpad pinch is a guess about hardware. That
 * reasoning is still correct and is not reversed here: nothing below classifies
 * a device.
 *
 * What changed is the evidence about the *host*. WebView2 enables its zoom
 * controls by default -- `IsZoomControlEnabled` -- and names Ctrl+Plus,
 * Ctrl+Minus and Ctrl+mouse wheel as the inputs those controls use. This
 * repository does not disable them: there is no zoom or accelerator setting in
 * `tauri.conf.json` and none applied in Rust. So a Ctrl-modified wheel over a
 * plot is not an ambiguous device signal that a viewer may as well treat as an
 * ordinary wheel. It is an input class the shell around the viewer already
 * reserves, and claiming it takes a capability away from the window.
 *
 * The decision is therefore about **ownership**, not about devices:
 *
 *   MSCanvas does not need to know whether a Ctrl-modified wheel came from a
 *   mouse, from a precision touchpad Chromium represents as Ctrl+wheel, or from
 *   somewhere else. It only needs to know that the modifier marks the event as
 *   the host's.
 *
 * ## Why one module for two axes
 *
 * The retention-time and m/z viewports are deliberately separate authorities:
 * separate reducers, separate state machines, separate domain brands, and
 * nothing here changes that. But *whose input is this* is not a scientific
 * question and has no axis in it. Two copies of the policy would be two places
 * for it to drift, and the drift would be invisible -- the two plots would
 * simply come to disagree about which keystrokes the window still owns.
 *
 * Sharing one predicate does not make the axes one authority, in the same way
 * that sharing `wheelInput.ts` does not: this decides nothing about a range.
 */

/** The modifier fields a wheel event is judged by, and nothing else about it. */
export interface WheelModifiers {
  readonly ctrlKey: boolean;
}

/** The modifier fields a key press is judged by. `shiftKey` is deliberately absent. */
export interface KeyModifiers {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether the host reserves this wheel event, so no viewport may claim it.
 *
 * Ctrl alone. Shift, Alt and Meta modified wheels have no published WebView zoom
 * meaning and no published meaning here, so inventing one for them would be the
 * guess this module exists to avoid -- in the other direction.
 */
export function isViewportWheelModifierOwnedByHost(event: WheelModifiers): boolean {
  return event.ctrlKey;
}

/**
 * Whether the host reserves this key press, so no viewport may claim it.
 *
 * **Shift is not in this list, and that is load-bearing.** On common layouts the
 * `+` a viewer zooms with is produced by holding Shift, so rejecting Shift would
 * take away the ordinary shortcut rather than protect an accelerator. Ctrl,
 * Meta and Alt are the modifiers that turn a character into an application or
 * browser accelerator; Ctrl+Shift+`+` is still released, because Ctrl is there.
 */
export function isViewportKeyboardModifierOwnedByHost(event: KeyModifiers): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}
