/**
 * Whose input an event is, before either viewer asks what it would do.
 *
 * The defect this closes was not arithmetic. Both plots claimed inputs the
 * window around them already owns: a Ctrl+wheel over a plot zoomed the axis and
 * cancelled the event, and Ctrl+0 with a plot focused reset a scientific range
 * and swallowed the accelerator. Neither viewer was wrong about *what the
 * gesture would do*; both were wrong about *whether it was theirs*.
 *
 * So what is pinned here is a policy, and the two halves of it that are easy to
 * get wrong in opposite directions: Ctrl, Meta and Alt mark an accelerator that
 * is not a plot's, and **Shift does not**, because `+` is usually produced with
 * it. A predicate that rejected Shift would take away the ordinary zoom
 * shortcut while protecting nothing.
 */

import { describe, expect, it } from "vitest";

import {
  isViewportKeyboardModifierOwnedByHost,
  isViewportWheelModifierOwnedByHost,
} from "./hostInputOwnership";

/** The four modifier fields, all clear, to be overridden one at a time. */
const NONE = { ctrlKey: false, metaKey: false, altKey: false } as const;

describe("a wheel event's owner", () => {
  it("leaves an unmodified wheel to the viewer that received it", () => {
    expect(isViewportWheelModifierOwnedByHost({ ctrlKey: false })).toBe(false);
  });

  it("gives a Ctrl-modified wheel to the host", () => {
    // WebView2 drives its own zoom with Ctrl+wheel and this application does not
    // disable that, so the modifier is not ambiguous: it names an owner.
    expect(isViewportWheelModifierOwnedByHost({ ctrlKey: true })).toBe(true);
  });
});

describe("a key press's owner", () => {
  it("leaves an unmodified key to the viewer that received it", () => {
    expect(isViewportKeyboardModifierOwnedByHost(NONE)).toBe(false);
  });

  it("gives Ctrl, Meta and Alt modified keys to the host, one modifier at a time", () => {
    // One at a time, so that a predicate which happened to require *all three*
    // would fail here rather than pass on a combination no keyboard sends.
    expect(isViewportKeyboardModifierOwnedByHost({ ...NONE, ctrlKey: true })).toBe(true);
    expect(isViewportKeyboardModifierOwnedByHost({ ...NONE, metaKey: true })).toBe(true);
    expect(isViewportKeyboardModifierOwnedByHost({ ...NONE, altKey: true })).toBe(true);
  });

  it("does not take a key away because Shift is held", () => {
    /*
     * The load-bearing exception. `+` is `Shift`+`=` on common layouts, so a
     * Shift-modified key press is how the ordinary zoom shortcut arrives -- and
     * a predicate that read `shiftKey` would disable it while protecting no
     * accelerator at all. The extra field is passed deliberately: the predicate
     * must ignore it rather than merely not be given it.
     */
    expect(
      isViewportKeyboardModifierOwnedByHost({ ...NONE, shiftKey: true } as never),
    ).toBe(false);
  });

  it("still gives a key away when Ctrl is held with Shift", () => {
    // Shift is not a licence. Ctrl+Shift+`+` is the host's because Ctrl is there.
    expect(
      isViewportKeyboardModifierOwnedByHost({ ...NONE, ctrlKey: true, shiftKey: true } as never),
    ).toBe(true);
  });
});
