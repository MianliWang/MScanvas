/**
 * What the two workspace panels are actually showing, from what the user asked
 * for and what the window can currently fit.
 *
 * ## Why this is a projection rather than two booleans
 *
 * A stored preference and a breakpoint are different kinds of fact, and folding
 * them into one piece of state loses the difference in exactly the case that
 * matters. Before M7.5 the narrow-window fold *set* the panel state to closed;
 * with a durable preference that would publish "the user hides the inspector"
 * because the window was briefly narrow, and widening it again would never
 * bring the panel back.
 *
 * So the request is durable and the suppression is not. A collapse is a session
 * fact about space -- it is never committed, and it is cleared when the window
 * stops being constrained or when the user makes a choice of their own. The
 * stored preference is untouched throughout.
 *
 * ## What it never depends on
 *
 * Whether there is anything to show. The details request is the request; the
 * shell decides separately whether the panel has content. A preference that
 * needed a loaded dataset to mean anything would be a preference that could not
 * be recovered from an empty session.
 */

import type { LayoutPreferences, PanelPresentation } from "../preferences/storedPreferences";

/** The two queries the workspace grid is built around. */
export const CONSTRAINED_QUERY = "(max-width: 1050px)";
export const ROOMY_QUERY = "(min-width: 1700px)";

/** What the current window can fit. Measured, never stored. */
export interface ViewportFit {
  /** The layout has one column: two panels beside the main area do not fit. */
  readonly constrained: boolean;
  /** There is room for the inspector beside the main area without crowding. */
  readonly roomy: boolean;
}

/**
 * Which panels a narrow window has folded away for now.
 *
 * Session-only and never persisted. `true` means "suppressed because of space
 * or because the other panel was opened in a one-column layout", which is not
 * a thing the user said.
 */
export interface PanelCollapse {
  readonly roster: boolean;
  readonly details: boolean;
}

export const NO_COLLAPSE: PanelCollapse = { roster: false, details: false };

/** Everything but availability: what is asked for, and what is folded. */
export interface PanelState {
  readonly requested: LayoutPreferences;
  readonly collapse: PanelCollapse;
}

export const INITIAL_PANEL_STATE: PanelState = {
  requested: { roster: "automatic", details: "automatic" },
  collapse: NO_COLLAPSE,
};

/**
 * The responsive default for a panel nobody has chosen for.
 *
 * The roster is open unless the window is too narrow for it; the inspector
 * waits for a window with room to spare. These are the defaults M7.2 shipped,
 * kept as the meaning of `automatic` rather than replaced by one.
 */
function automatic(panel: keyof LayoutPreferences, fit: ViewportFit): boolean {
  return panel === "roster" ? !fit.constrained : fit.roomy;
}

function requestedVisible(
  presentation: PanelPresentation,
  panel: keyof LayoutPreferences,
  fit: ViewportFit,
): boolean {
  return presentation === "automatic" ? automatic(panel, fit) : presentation === "shown";
}

/** Whether each panel is on screen, before availability is considered. */
export function presentPanels(state: PanelState, fit: ViewportFit): PanelCollapse {
  return {
    roster: requestedVisible(state.requested.roster, "roster", fit) && !state.collapse.roster,
    details: requestedVisible(state.requested.details, "details", fit) && !state.collapse.details,
  };
}

export type PanelAction =
  /** A stored record arrived. Replaces the request; clears nothing else. */
  | { readonly type: "hydrate"; readonly layout: LayoutPreferences }
  /** The user pressed a panel toggle. */
  | { readonly type: "toggle"; readonly panel: keyof LayoutPreferences; readonly fit: ViewportFit }
  /** The window crossed the one-column breakpoint, or left it. */
  | { readonly type: "fit"; readonly constrained: boolean }
  /** Navigation to another surface in a one-column layout. */
  | { readonly type: "navigate"; readonly constrained: boolean }
  /** The always-reachable way back to the responsive defaults. */
  | { readonly type: "reset" };

/**
 * The one reducer over panel state.
 *
 * Only `toggle` and `reset` change the durable request, which is why they are
 * the only two actions whose result is committed. `fit` and `navigate` move the
 * session-only collapse and nothing else -- that is the whole point of the
 * split.
 */
export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "hydrate":
      return { ...state, requested: action.layout };
    case "toggle": {
      const other = action.panel === "roster" ? "details" : "roster";
      const present = presentPanels(state, action.fit);
      // From what is on screen rather than from the stored word, so the control
      // does what it looks like it does: a panel a narrow window folded away is
      // opened by the toggle, not closed again.
      const next: PanelPresentation = present[action.panel] ? "hidden" : "shown";
      return {
        requested: { ...state.requested, [action.panel]: next },
        // This panel is no longer suppressed, because the user just spoke about
        // it. In a one-column layout the other one has to give up the space --
        // suppressed, not re-requested, so nothing about the window publishes a
        // choice the user did not make.
        collapse: {
          ...state.collapse,
          [action.panel]: false,
          ...(action.fit.constrained && next === "shown" ? { [other]: true } : {}),
        },
      };
    }
    case "fit":
      // Leaving the constrained layout clears every suppression, so the stored
      // preferences apply again. Entering it suppresses both, and the request
      // is untouched either way.
      return {
        ...state,
        collapse: action.constrained ? { roster: true, details: true } : NO_COLLAPSE,
      };
    case "navigate":
      return action.constrained
        ? { ...state, collapse: { roster: true, details: true } }
        : state;
    case "reset":
      return { requested: { roster: "automatic", details: "automatic" }, collapse: NO_COLLAPSE };
  }
}

/** Whether an action's result is a user choice worth committing to disk. */
export function commits(action: PanelAction): boolean {
  return action.type === "toggle" || action.type === "reset";
}
