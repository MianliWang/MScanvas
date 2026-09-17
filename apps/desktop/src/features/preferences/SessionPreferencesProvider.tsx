import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import {
  CONSTRAINED_QUERY,
  INITIAL_PANEL_STATE,
  NO_COLLAPSE,
  ROOMY_QUERY,
  commits,
  panelReducer,
  presentPanels,
  type PanelAction,
  type PanelCollapse,
  type PanelState,
  type ViewportFit,
} from "../workbench/panelPresentation";

import { bindUiMessages, createUiRuntime, ResourceProblem, restoreLocalBundle, validateBundle, type UiMessage, type UiRuntime } from "./i18n";
import { usePreferencesApi } from "./preferencesApi";
import { effectivePreferences, INITIAL_PREFERENCES, preferenceReducer, SESSION_DEFAULTS, type PreferenceState, type SessionPreferences, type UiLocale } from "./sessionPreferences";
import {
  LAYOUT_DEFAULTS,
  isStoredPreferences,
  type LayoutPreferences,
  type PreferenceSaveOutcome,
  type PreferenceWriteRequest,
} from "./storedPreferences";

/**
 * What this session knows about the stored record.
 *
 * `loading` is a distinct bounded state rather than an assumed default: writing
 * defaults before the read resolves would publish settings nobody chose, and
 * enabling the editors would let an edit be overwritten by an answer already in
 * flight. `unusable` keeps the stored bytes and offers an explicit replacement;
 * `unavailable` means there is nowhere to store anything, which changes nothing
 * about being able to use the application.
 */
export interface PreferenceStorageState {
  readonly status: "loading" | "ready" | "unusable" | "unavailable";
  /** An owned code for `unusable` and `unavailable`, and nothing else. */
  readonly problem: string | null;
  /**
   * The highest committed revision this document has adopted.
   *
   * Rust advances it once per accepted publish, so a late answer carrying a
   * lower one describes a snapshot this session has already moved past.
   */
  readonly revision: number;
}

/** Where a Settings apply has got to. */
export interface AppearanceSaveState {
  readonly status: "idle" | "saving" | "failed" | "storedRecordUnusable" | "unavailable";
  readonly problem: string | null;
  readonly retryable: boolean;
  readonly temporaryLeftBehind: boolean;
  /**
   * Whether the user chose to use unsaved preferences for this session.
   *
   * A deliberate, named decision rather than a silent fallback, and never a
   * claim that anything was written: what it says is that a restart still uses
   * the last saved record.
   */
  readonly sessionOnly: boolean;
}

const IDLE_APPEARANCE: AppearanceSaveState = {
  status: "idle",
  problem: null,
  retryable: false,
  temporaryLeftBehind: false,
  sessionOnly: false,
};

/** Where a panel toggle's commit has got to. */
export interface LayoutSaveState {
  readonly status: "idle" | "saving" | "unsaved";
  readonly problem: string | null;
  readonly retryable: boolean;
}

const IDLE_LAYOUT: LayoutSaveState = { status: "idle", problem: null, retryable: false };

/** The workspace panels, and the actions that move them. */
export interface PanelsValue {
  readonly requested: LayoutPreferences;
  readonly present: PanelCollapse;
  readonly fit: ViewportFit;
  /** Whether a toggle would be acting before the stored record is known. */
  readonly busy: boolean;
  readonly save: LayoutSaveState;
  readonly toggle: (panel: keyof LayoutPreferences) => void;
  readonly navigate: () => void;
  readonly reset: () => void;
  readonly retry: () => void;
}

interface SessionContextValue {
  readonly runtime: UiRuntime;
  readonly state: PreferenceState;
  readonly effective: SessionPreferences;
  readonly problem: ResourceProblem | null;
  readonly announcement:
    | "applied"
    | "cancelled"
    | "resetPreview"
    | "recovered"
    | "storedReplaced"
    | "sessionOnlyApplied"
    | null;
  readonly storage: PreferenceStorageState;
  readonly save: AppearanceSaveState;
  readonly panels: PanelsValue;
  readonly open: () => void;
  readonly preview: (preferences: SessionPreferences) => void;
  readonly apply: () => void;
  readonly discard: () => void;
  readonly reset: () => void;
  readonly recover: () => void;
  /** Retries the exact draft the failed apply captured. */
  readonly retrySave: () => void;
  /** Applies the captured draft to this session only, claiming no write. */
  readonly useForThisSession: () => void;
  /** The confirmed reset-and-replace of a stored record this build refused. */
  readonly replaceStoredRecord: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** The media queries, read defensively: a test environment may have neither. */
function measureFit(): ViewportFit {
  if (typeof window.matchMedia !== "function") {
    return { constrained: false, roomy: false };
  }
  return {
    constrained: window.matchMedia(CONSTRAINED_QUERY).matches,
    roomy: window.matchMedia(ROOMY_QUERY).matches,
  };
}

export function SessionPreferencesProvider({ children, runtime: suppliedRuntime }: {
  readonly children: ReactNode;
  readonly runtime?: UiRuntime;
}) {
  const api = usePreferencesApi();
  const [runtime] = useState(() => suppliedRuntime ?? createUiRuntime());
  const [state, dispatch] = useReducer(preferenceReducer, INITIAL_PREFERENCES);
  const [problem, setProblem] = useState<ResourceProblem | null>(runtime.initialProblem);
  const [announcement, setAnnouncement] = useState<SessionContextValue["announcement"]>(null);
  const [storage, setStorage] = useState<PreferenceStorageState>({
    status: "loading",
    problem: null,
    revision: 0,
  });
  const [save, setSave] = useState<AppearanceSaveState>(IDLE_APPEARANCE);
  const [panelState, setPanelState] = useState<PanelState>(INITIAL_PANEL_STATE);
  const [layoutSave, setLayoutSave] = useState<LayoutSaveState>(IDLE_LAYOUT);
  const [fit, setFit] = useState<ViewportFit>(measureFit);
  const restoring = useRef(false);
  const effective = effectivePreferences(state);

  /** This document's lifetime. A reply to a document that is gone is dropped. */
  const mounted = useRef(true);
  /**
   * Whether anything has been committed or edited since the mount.
   *
   * A late hydration response must not overwrite a user's own work, and the
   * disabled editors are not on their own a guarantee: React does not promise
   * that a response cannot arrive between the render that enabled a control and
   * the effect that would have blocked it.
   */
  const userOwnsTheRecord = useRef(false);
  /** The newest outstanding request in each lane. Older replies are ignored. */
  const appearanceTicket = useRef(0);
  const layoutTicket = useRef(0);
  /** The exact draft an apply captured, so Retry retries that and not a newer one. */
  const captured = useRef<SessionPreferences | null>(null);
  /**
   * The storage status as a ref, for the callbacks that must read it without
   * being rebuilt when it changes.
   *
   * `commitLayout` is a dependency of the panel actions, and rebuilding those
   * on every storage transition would churn the workspace's props for a fact
   * none of them render.
   */
  const storageStatus = useRef(storage.status);
  storageStatus.current = storage.status;

  useLayoutEffect(() => { document.documentElement.lang = effective.locale; }, [effective.locale]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ---------------------------------------------------------------- resources

  function restore(locales: readonly UiLocale[]): void {
    restoring.current = true;
    try {
      for (const locale of locales) restoreLocalBundle(runtime.instance, locale);
    } finally {
      restoring.current = false;
    }
  }

  function usable(locale: UiLocale): boolean {
    try {
      if (!runtime.instance.isInitialized) throw new ResourceProblem("RESOURCE_INIT");
      validateBundle(locale, runtime.instance.getResourceBundle(locale, "ui"));
      return true;
    } catch (error) {
      setProblem(error instanceof ResourceProblem ? error : new ResourceProblem("RESOURCE_INIT"));
      setAnnouncement(null);
      // Recovery copy is explicit and the failure stays visible. This never
      // changes applied preferences or any workspace-owned state.
      restore([state.applied.locale]);
      dispatch({ type: "preview", preferences: state.applied });
      return false;
    }
  }

  useLayoutEffect(() => {
    // Resource-store faults can arrive without a Settings button action. Catch
    // the effective bundle before paint; own replacement events are not faults.
    const checkEffectiveBundle = () => {
      if (!restoring.current) usable(effective.locale);
    };
    const store = runtime.instance.store;
    store.on("added", checkEffectiveBundle);
    store.on("removed", checkEffectiveBundle);
    checkEffectiveBundle();
    return () => {
      store.off("added", checkEffectiveBundle);
      store.off("removed", checkEffectiveBundle);
    };
  }, [runtime, effective.locale, state.applied]);

  // ------------------------------------------------------------- the viewport

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const constrained = window.matchMedia(CONSTRAINED_QUERY);
    const roomy = window.matchMedia(ROOMY_QUERY);
    const remeasure = () => {
      const next = { constrained: constrained.matches, roomy: roomy.matches };
      setFit(next);
      // A breakpoint moves the session-only collapse and never the stored
      // request, so a window that got narrow cannot publish a preference.
      setPanelState(current => panelReducer(current, { type: "fit", constrained: next.constrained }));
    };
    constrained.addEventListener("change", remeasure);
    roomy.addEventListener("change", remeasure);
    return () => {
      constrained.removeEventListener("change", remeasure);
      roomy.removeEventListener("change", remeasure);
    };
  }, []);

  // ------------------------------------------------------------- the store

  useEffect(() => {
    let superseded = false;
    api.loadPreferences().then(
      outcome => {
        if (superseded || !mounted.current) return;
        if (outcome.outcome === "loaded" && isStoredPreferences(outcome.preferences)) {
          // Only if nothing of the user's would be overwritten. A read that
          // lost its race is still news about the store, and not about what
          // the user has since chosen.
          if (!userOwnsTheRecord.current) {
            dispatch({ type: "hydrate", preferences: outcome.preferences.appearance });
            setPanelState(current =>
              panelReducer(current, { type: "hydrate", layout: outcome.preferences.layout }));
          }
          setStorage({ status: "ready", problem: null, revision: outcome.revision });
          return;
        }
        if (outcome.outcome === "absent") {
          setStorage({ status: "ready", problem: null, revision: outcome.revision });
          return;
        }
        // Unusable, unavailable, or a `loaded` record this side will not
        // consume. Every one of them settles on the defaults already applied,
        // with an accurate recovery state -- never an indefinite spinner and
        // never an automatic retry loop.
        setStorage({
          status: outcome.outcome === "unavailable" ? "unavailable" : "unusable",
          problem: outcome.outcome === "loaded" ? "malformed" : outcome.problem,
          revision: outcome.revision,
        });
      },
      () => {
        if (superseded || !mounted.current) return;
        // The read itself failed. Recoverable defaults, and an honest state.
        setStorage({ status: "unavailable", problem: "readFailed", revision: 0 });
      },
    );
    return () => { superseded = true; };
  }, [api]);

  /** Adopts a committed revision, never regressing to an older one. */
  const adopt = useCallback((revision: number) => {
    setStorage(current =>
      revision > current.revision
        ? { status: "ready", problem: null, revision }
        : { ...current, status: current.status === "loading" ? "ready" : current.status });
  }, []);

  // ------------------------------------------------------------ appearance

  const commitAppearance = useCallback((snapshot: SessionPreferences, replaceUnusable: boolean) => {
    userOwnsTheRecord.current = true;
    captured.current = snapshot;
    const ticket = appearanceTicket.current + 1;
    appearanceTicket.current = ticket;
    setSave({ ...IDLE_APPEARANCE, status: "saving" });
    const request: PreferenceWriteRequest = replaceUnusable
      ? { appearance: snapshot, layout: panelState.requested, replaceUnusable: true }
      : { appearance: snapshot };
    api.savePreferences(request).then(
      (outcome: PreferenceSaveOutcome) => {
        // A reply from an older press says nothing about the newest choice.
        if (!mounted.current || ticket !== appearanceTicket.current) return;
        if (outcome.outcome === "saved") {
          adopt(outcome.revision);
          captured.current = null;
          setSave(IDLE_APPEARANCE);
          dispatch({ type: "apply" });
          setAnnouncement(replaceUnusable ? "storedReplaced" : "applied");
          return;
        }
        if (outcome.outcome === "storedRecordUnusable") {
          setStorage(current => ({ ...current, status: "unusable", problem: outcome.problem }));
          setSave({
            ...IDLE_APPEARANCE,
            status: "storedRecordUnusable",
            problem: outcome.problem,
          });
          return;
        }
        if (outcome.outcome === "unavailable") {
          setStorage(current => ({ ...current, status: "unavailable", problem: outcome.problem }));
          setSave({ ...IDLE_APPEARANCE, status: "unavailable", problem: outcome.problem });
          return;
        }
        setSave({
          ...IDLE_APPEARANCE,
          status: "failed",
          problem: outcome.problem,
          retryable: outcome.retryable,
          temporaryLeftBehind: outcome.temporaryLeftBehind,
        });
      },
      () => {
        if (!mounted.current || ticket !== appearanceTicket.current) return;
        setSave({ ...IDLE_APPEARANCE, status: "failed", problem: "requestFailed", retryable: true });
      },
    );
  }, [adopt, api, panelState.requested]);

  // ---------------------------------------------------------------- layout

  const commitLayout = useCallback((layout: LayoutPreferences) => {
    userOwnsTheRecord.current = true;
    if (storageStatus.current === "unavailable") {
      // Nowhere to write, and Settings has already said so for the whole
      // session. A banner on every toggle would repeat that in the one place
      // it cannot be acted on; this notice is for a save that should have
      // worked and did not.
      setLayoutSave(IDLE_LAYOUT);
      return;
    }
    const ticket = layoutTicket.current + 1;
    layoutTicket.current = ticket;
    setLayoutSave({ status: "saving", problem: null, retryable: false });
    // Only this group. The Settings dialog's unapplied draft is not this
    // surface's to publish, and Rust merges onto what is actually stored.
    api.savePreferences({ layout }).then(
      outcome => {
        if (!mounted.current || ticket !== layoutTicket.current) return;
        if (outcome.outcome === "saved") {
          adopt(outcome.revision);
          setLayoutSave(IDLE_LAYOUT);
          return;
        }
        if (outcome.outcome === "unavailable" || outcome.outcome === "storedRecordUnusable") {
          setStorage(current => ({
            ...current,
            status: outcome.outcome === "unavailable" ? "unavailable" : "unusable",
            problem: outcome.problem,
          }));
        }
        // The panels keep the arrangement the user asked for; what is reported
        // is that it will not survive a restart, with a way to try again.
        setLayoutSave({
          status: "unsaved",
          problem: outcome.problem,
          retryable: outcome.outcome === "failed" ? outcome.retryable : false,
        });
      },
      () => {
        if (!mounted.current || ticket !== layoutTicket.current) return;
        setLayoutSave({ status: "unsaved", problem: "requestFailed", retryable: true });
      },
    );
  }, [adopt, api]);

  const movePanels = useCallback((action: PanelAction) => {
    setPanelState(current => {
      const next = panelReducer(current, action);
      if (commits(action)) commitLayout(next.requested);
      return next;
    });
  }, [commitLayout]);

  const present = useMemo(() => presentPanels(panelState, fit), [panelState, fit]);

  const panels: PanelsValue = useMemo(() => ({
    requested: panelState.requested,
    present,
    fit,
    busy: storage.status === "loading",
    save: layoutSave,
    toggle: panel => movePanels({ type: "toggle", panel, fit }),
    navigate: () => movePanels({ type: "navigate", constrained: fit.constrained }),
    reset: () => movePanels({ type: "reset" }),
    retry: () => commitLayout(panelState.requested),
  }), [commitLayout, fit, layoutSave, movePanels, panelState, present, storage.status]);

  // ----------------------------------------------------------------- actions

  const value: SessionContextValue = {
    runtime, state, effective, problem, announcement, storage, save, panels,
    open: () => {
      usable(state.applied.locale);
      dispatch({ type: "open" });
      setAnnouncement(null);
      // A previous failure's actions are cleared, because they belong to a
      // press that is over. `sessionOnly` is not: it is a fact about this
      // session, and the footer keeps saying what a restart will use.
      setSave(current => ({ ...IDLE_APPEARANCE, sessionOnly: current.sessionOnly }));
    },
    preview: (preferences) => {
      // Editing is a claim on the record: a hydration answer still in flight
      // must not replace what is being edited.
      userOwnsTheRecord.current = true;
      if (usable(preferences.locale)) dispatch({ type: "preview", preferences });
      setAnnouncement(null);
    },
    apply: () => {
      if (problem !== null || save.status === "saving" || !usable(effective.locale)) return;
      if (storage.status === "unavailable") {
        // There is nowhere to write and the dialog has said so since it opened.
        // Applying is the session change the user asked for; dispatching a
        // write that is already known to be impossible would only produce a
        // failure to dismiss, and pretending it might work would be worse.
        dispatch({ type: "apply" });
        setSave({ ...IDLE_APPEARANCE, sessionOnly: true });
        setAnnouncement("sessionOnlyApplied");
        return;
      }
      // The draft as it stands, captured once. What is validated, published and
      // reported is this snapshot and not whatever the dialog shows later.
      commitAppearance(effective, false);
    },
    discard: () => { setSave(IDLE_APPEARANCE); captured.current = null; dispatch({ type: "discard" }); setAnnouncement("cancelled"); },
    reset: () => {
      if (save.status === "saving") return;
      if (usable(SESSION_DEFAULTS.locale)) { dispatch({ type: "reset" }); setAnnouncement("resetPreview"); }
    },
    recover: () => {
      restore(["en", "zh-CN"]);
      validateBundle("en", runtime.instance.getResourceBundle("en", "ui"));
      validateBundle("zh-CN", runtime.instance.getResourceBundle("zh-CN", "ui"));
      setProblem(null); setAnnouncement("recovered");
    },
    retrySave: () => {
      const snapshot = captured.current;
      if (snapshot === null || save.status === "saving") return;
      commitAppearance(snapshot, false);
    },
    useForThisSession: () => {
      const snapshot = captured.current;
      if (snapshot === null || save.status === "saving") return;
      // Applied to the session, and nothing is claimed about disk. The draft
      // becomes the applied preferences; the last saved record is what a
      // restart still finds.
      dispatch({ type: "preview", preferences: snapshot });
      dispatch({ type: "apply" });
      setSave({ ...IDLE_APPEARANCE, sessionOnly: true });
      captured.current = null;
      setAnnouncement("sessionOnlyApplied");
    },
    replaceStoredRecord: () => {
      if (save.status === "saving") return;
      // The confirmed replacement: the draft if Settings is open, otherwise the
      // applied preferences, together with the panel arrangement on screen.
      commitAppearance(effective, true);
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

/** Re-exported so consumers need one import for the panel vocabulary. */
export { LAYOUT_DEFAULTS, NO_COLLAPSE };
