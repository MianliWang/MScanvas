import { describe, expect, it } from "vitest";

import {
  INITIAL_PANEL_STATE,
  NO_COLLAPSE,
  commits,
  panelReducer,
  presentPanels,
  type PanelState,
  type ViewportFit,
} from "./panelPresentation";

const WIDE: ViewportFit = { constrained: false, roomy: true };
const MEDIUM: ViewportFit = { constrained: false, roomy: false };
const NARROW: ViewportFit = { constrained: true, roomy: false };

function stateOf(roster: PanelState["requested"]["roster"], details: PanelState["requested"]["details"]): PanelState {
  return { requested: { roster, details }, collapse: NO_COLLAPSE };
}

describe("the responsive default", () => {
  it("opens the roster unless the window is too narrow for it", () => {
    expect(presentPanels(INITIAL_PANEL_STATE, WIDE).roster).toBe(true);
    expect(presentPanels(INITIAL_PANEL_STATE, MEDIUM).roster).toBe(true);
    expect(presentPanels(INITIAL_PANEL_STATE, NARROW).roster).toBe(false);
  });

  it("waits for a window with room before offering the inspector", () => {
    expect(presentPanels(INITIAL_PANEL_STATE, WIDE).details).toBe(true);
    expect(presentPanels(INITIAL_PANEL_STATE, MEDIUM).details).toBe(false);
    expect(presentPanels(INITIAL_PANEL_STATE, NARROW).details).toBe(false);
  });
});

describe("an explicit choice", () => {
  it("is honoured against the responsive default in both directions", () => {
    expect(presentPanels(stateOf("hidden", "shown"), WIDE)).toEqual({ roster: false, details: true });
    expect(presentPanels(stateOf("shown", "hidden"), MEDIUM)).toEqual({ roster: true, details: false });
  });

  it("survives a window that became constrained and then widened again", () => {
    const chosen = stateOf("shown", "shown");
    const folded = panelReducer(chosen, { type: "fit", constrained: true });
    expect(presentPanels(folded, NARROW)).toEqual({ roster: false, details: false });
    // The request is what matters: the collapse said nothing about it.
    expect(folded.requested).toEqual(chosen.requested);

    const widened = panelReducer(folded, { type: "fit", constrained: false });
    expect(widened.collapse).toEqual(NO_COLLAPSE);
    expect(presentPanels(widened, WIDE)).toEqual({ roster: true, details: true });
  });

  it("is not changed by navigating in a one-column layout", () => {
    const chosen = stateOf("shown", "shown");
    const navigated = panelReducer(chosen, { type: "navigate", constrained: true });
    expect(navigated.requested).toEqual(chosen.requested);
    expect(presentPanels(navigated, NARROW)).toEqual({ roster: false, details: false });
  });

  it("is not changed by navigating in a roomy layout either", () => {
    const chosen = stateOf("shown", "shown");
    expect(panelReducer(chosen, { type: "navigate", constrained: false })).toBe(chosen);
  });
});

describe("a toggle", () => {
  it("acts on what is on screen rather than on the stored word", () => {
    // Automatic and folded away by a narrow window. Pressing the toggle opens
    // it, which is what the control looks like it does.
    const folded = panelReducer(INITIAL_PANEL_STATE, { type: "fit", constrained: true });
    const opened = panelReducer(folded, { type: "toggle", panel: "roster", fit: NARROW });
    expect(opened.requested.roster).toBe("shown");
    expect(presentPanels(opened, NARROW).roster).toBe(true);
  });

  it("gives the other panel's space up in a one-column layout without re-requesting it", () => {
    const opened = panelReducer(stateOf("hidden", "shown"), {
      type: "toggle",
      panel: "roster",
      fit: NARROW,
    });
    expect(opened.requested.roster).toBe("shown");
    // Suppressed for space, and still *requested*: widening the window brings
    // it back without the user asking again.
    expect(opened.collapse.details).toBe(true);
    expect(opened.requested.details).toBe("shown");
    expect(presentPanels(panelReducer(opened, { type: "fit", constrained: false }), WIDE).details).toBe(true);
  });

  it("leaves the other panel alone when there is room for both", () => {
    const opened = panelReducer(stateOf("hidden", "shown"), { type: "toggle", panel: "roster", fit: WIDE });
    expect(opened.collapse).toEqual(NO_COLLAPSE);
    expect(presentPanels(opened, WIDE)).toEqual({ roster: true, details: true });
  });

  it("closing a panel does not take the other one's space away", () => {
    const closed = panelReducer(stateOf("shown", "shown"), {
      type: "toggle",
      panel: "roster",
      fit: NARROW,
    });
    expect(closed.requested.roster).toBe("hidden");
    // Nothing was opened, so nothing had to give up room. Suppressing the
    // inspector here would hide a panel the user never touched.
    expect(closed.collapse).toEqual(NO_COLLAPSE);
    expect(closed.requested.details).toBe("shown");
    expect(presentPanels(closed, NARROW)).toEqual({ roster: false, details: true });
  });
});

describe("reset", () => {
  it("returns both panels to the responsive default and clears every collapse", () => {
    const messy = panelReducer(stateOf("hidden", "shown"), { type: "fit", constrained: true });
    const reset = panelReducer(messy, { type: "reset" });
    expect(reset).toEqual(INITIAL_PANEL_STATE);
    expect(presentPanels(reset, WIDE)).toEqual({ roster: true, details: true });
    // Reachable from a constrained window too, where it is the way back out of
    // a layout nothing else can recover.
    expect(presentPanels(reset, NARROW)).toEqual({ roster: false, details: false });
  });
});

describe("hydration", () => {
  it("replaces the request and nothing else", () => {
    const folded = panelReducer(INITIAL_PANEL_STATE, { type: "fit", constrained: true });
    const hydrated = panelReducer(folded, { type: "hydrate", layout: { roster: "hidden", details: "shown" } });
    expect(hydrated.requested).toEqual({ roster: "hidden", details: "shown" });
    expect(hydrated.collapse).toEqual(folded.collapse);
  });
});

describe("what is committed", () => {
  it("is exactly the two actions that are a user choice", () => {
    expect(commits({ type: "toggle", panel: "roster", fit: WIDE })).toBe(true);
    expect(commits({ type: "reset" })).toBe(true);
    expect(commits({ type: "fit", constrained: true })).toBe(false);
    expect(commits({ type: "navigate", constrained: true })).toBe(false);
    expect(commits({ type: "hydrate", layout: { roster: "shown", details: "shown" } })).toBe(false);
  });
});
