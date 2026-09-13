export type UiLocale = "en" | "zh-CN";
export type RosterDensity = "comfortable" | "compact";

export interface SessionPreferences {
  readonly locale: UiLocale;
  readonly density: RosterDensity;
}

/** Comfortable uses a 44px row minimum; compact uses 32px. Names can wrap. */
export const SESSION_DEFAULTS: SessionPreferences = { locale: "en", density: "comfortable" };

export interface PreferenceState {
  readonly applied: SessionPreferences;
  readonly draft: SessionPreferences | null;
}

export const INITIAL_PREFERENCES: PreferenceState = { applied: SESSION_DEFAULTS, draft: null };

export type PreferenceAction =
  | { readonly type: "open" }
  | { readonly type: "preview"; readonly preferences: SessionPreferences }
  | { readonly type: "apply" }
  | { readonly type: "discard" }
  | { readonly type: "reset" };

/** This reducer owns only two UI preferences, never a workspace snapshot. */
export function preferenceReducer(state: PreferenceState, action: PreferenceAction): PreferenceState {
  switch (action.type) {
    case "open":
      return state.draft === null ? { ...state, draft: { ...state.applied } } : state;
    case "preview":
      return state.draft === null ? state : { ...state, draft: action.preferences };
    case "apply":
      return state.draft === null ? state : { applied: state.draft, draft: null };
    case "discard":
      return { ...state, draft: null };
    case "reset":
      return state.draft === null ? state : { ...state, draft: { ...SESSION_DEFAULTS } };
  }
}

export function effectivePreferences(state: PreferenceState): SessionPreferences {
  return state.draft ?? state.applied;
}
