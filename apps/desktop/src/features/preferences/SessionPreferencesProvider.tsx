import { createContext, useContext, useLayoutEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import { bindUiMessages, createUiRuntime, ResourceProblem, restoreLocalBundle, validateBundle, type UiMessage, type UiRuntime } from "./i18n";
import { effectivePreferences, INITIAL_PREFERENCES, preferenceReducer, SESSION_DEFAULTS, type PreferenceState, type SessionPreferences, type UiLocale } from "./sessionPreferences";

interface SessionContextValue {
  readonly runtime: UiRuntime;
  readonly state: PreferenceState;
  readonly effective: SessionPreferences;
  readonly problem: ResourceProblem | null;
  readonly announcement: "applied" | "cancelled" | "resetPreview" | "recovered" | null;
  readonly open: () => void;
  readonly preview: (preferences: SessionPreferences) => void;
  readonly apply: () => void;
  readonly discard: () => void;
  readonly reset: () => void;
  readonly recover: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionPreferencesProvider({ children, runtime: suppliedRuntime }: {
  readonly children: ReactNode;
  readonly runtime?: UiRuntime;
}) {
  const [runtime] = useState(() => suppliedRuntime ?? createUiRuntime());
  const [state, dispatch] = useReducer(preferenceReducer, INITIAL_PREFERENCES);
  const [problem, setProblem] = useState<ResourceProblem | null>(runtime.initialProblem);
  const [announcement, setAnnouncement] = useState<SessionContextValue["announcement"]>(null);
  const effective = effectivePreferences(state);

  useLayoutEffect(() => { document.documentElement.lang = effective.locale; }, [effective.locale]);

  function usable(locale: UiLocale): boolean {
    try {
      if (!runtime.instance.isInitialized) throw new ResourceProblem("RESOURCE_INIT");
      validateBundle(locale, runtime.instance.getResourceBundle(locale, "ui"));
      return true;
    } catch (error) {
      setProblem(error instanceof ResourceProblem ? error : new ResourceProblem("RESOURCE_INIT"));
      // Recovery copy is explicit and the failure stays visible. This never
      // changes applied preferences or any workspace-owned state.
      restoreLocalBundle(runtime.instance, state.applied.locale);
      dispatch({ type: "preview", preferences: state.applied });
      return false;
    }
  }

  const value: SessionContextValue = {
    runtime, state, effective, problem, announcement,
    open: () => { usable(state.applied.locale); dispatch({ type: "open" }); setAnnouncement(null); },
    preview: (preferences) => {
      if (usable(preferences.locale)) dispatch({ type: "preview", preferences });
      setAnnouncement(null);
    },
    apply: () => {
      if (problem === null && usable(effective.locale)) {
        dispatch({ type: "apply" }); setAnnouncement("applied");
      }
    },
    discard: () => { dispatch({ type: "discard" }); setAnnouncement("cancelled"); },
    reset: () => {
      if (usable(SESSION_DEFAULTS.locale)) { dispatch({ type: "reset" }); setAnnouncement("resetPreview"); }
    },
    recover: () => {
      restoreLocalBundle(runtime.instance, "en");
      restoreLocalBundle(runtime.instance, "zh-CN");
      setProblem(null); setAnnouncement("recovered");
    },
  };

  return <SessionContext.Provider value={value}>
    <I18nextProvider i18n={runtime.instance} defaultNS="ui">{children}</I18nextProvider>
  </SessionContext.Provider>;
}

export function useSessionPreferences(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("SessionPreferencesProvider is required.");
  return value;
}

export function useUiMessages(): UiMessage {
  const { effective, runtime } = useSessionPreferences();
  // Explicit lng is the synchronous preference projection. A late external
  // changeLanguage completion cannot revive a discarded preview. The installed
  // react-i18next pin subscribes to the same stable instance with this lng.
  const { t } = useTranslation("ui", { i18n: runtime.instance, lng: effective.locale, useSuspense: false });
  return useMemo(() => bindUiMessages(t), [t]);
}
