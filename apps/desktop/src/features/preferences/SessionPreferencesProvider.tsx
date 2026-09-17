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
 * `loading` is a distinct *bounded* state rather than an assumed default:
 * writing defaults before the read resolves would publish settings nobody
 * chose, and enabling the editors would let an edit be overwritten by an answer
 * already in flight. It is bounded because it gates controls -- a profile
 * volume that never answers must not leave Settings and the panel toggles
 * inert for the rest of the session.
 *
 * `unusable` keeps the stored bytes and offers an explicit replacement.
 * `unavailable` means there is nowhere to store anything, which changes nothing
 * about being able to use the application.
 *
 * `readFailed` is deliberately neither of those. A read that never arrived, or
 * a call that failed on the way, says nothing about whether a store exists --
 * so the defaults apply and the reason is reported, but a save is still
 * attempted. Treating a dropped call as "there is nowhere to write" would turn
 * one lost message into a session-long silent loss of the user's choices.
 */
export interface PreferenceStorageState {
  readonly status: "loading" | "ready" | "unusable" | "unavailable" | "readFailed";
  /** An owned code for every status but `loading` and `ready`. */
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

/**
 * What the shell has to say about the panels, once.
 *
 * `null` renders an empty region rather than no region: a live region that
 * arrives with its text already in it is the one mutation screen readers do not
 * announce, so the element is mounted from the first render and only its
 * contents change.
 */
export type LayoutAnnouncement = "reset" | "unsaved" | "uncertain" | null;

/** Where a panel toggle's commit has got to. */
export interface LayoutSaveState {
  readonly status: "idle" | "saving" | "unsaved";
  readonly problem: string | null;
  readonly retryable: boolean;
}

const IDLE_LAYOUT: LayoutSaveState = { status: "idle", problem: null, retryable: false };

/**
 * How long the gated startup state may last.
 *
 * Generous, because the read is one small local file and anything slower than
 * this is a filesystem that is not answering rather than one that is busy. It
 * bounds the *waiting* and not the read: a later answer is still adopted.
 */
const HYDRATION_DEADLINE_MS = 10_000;

/** The workspace panels, and the actions that move them. */
export interface PanelsValue {
  readonly requested: LayoutPreferences;
  readonly present: PanelCollapse;
  readonly fit: ViewportFit;
  /** Whether a toggle would be acting before the stored record is known. */
  readonly busy: boolean;
  readonly save: LayoutSaveState;
  readonly announcement: LayoutAnnouncement;
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
  const [layoutAnnouncement, setLayoutAnnouncement] = useState<LayoutAnnouncement>(null);
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
  /**
   * The exact request an apply captured, so Retry retries that and not a newer
   * one.
   *
   * The replacement confirmation travels with it. A retry that dropped it would
   * be a different request: the record on disk is still the one this build
   * refused, so Rust would refuse the retry too -- and the button would be
   * offering something that provably cannot work.
   */
  const captured = useRef<{
    readonly snapshot: SessionPreferences;
    readonly replaceUnusable: boolean;
  } | null>(null);
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
  /**
   * The panel state, for the one caller that must read it without being a
   * `setState` updater.
   *
   * `movePanels` computes the next arrangement and publishes it, and an updater
   * that published would be impure. Kept in step with every write to the state
   * below.
   */
  const panelStateRef = useRef(panelState);
  panelStateRef.current = panelState;

  /**
   * Moves the panels without publishing anything.
   *
   * For the actions that are not a choice: a breakpoint, and a record arriving
   * from disk. Keeps the ref and the state in step, so the next choice is
   * computed from what is actually on screen.
   */
  const movePanelsQuietly = useCallback((action: PanelAction) => {
    const next = panelReducer(panelStateRef.current, action);
    panelStateRef.current = next;
    setPanelState(next);
  }, []);

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
      movePanelsQuietly({ type: "fit", constrained: next.constrained });
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
    // A bound on the gated state, not on the read. The read is still allowed to
    // answer afterwards -- and it is adopted when it does, because a slow
    // answer is still the truth about the store. What the deadline ends is the
    // *waiting*: Settings and the panel toggles stop being inert, on the
    // defaults, with an accurate reason.
    const deadline = window.setTimeout(() => {
      if (superseded || !mounted.current) return;
      setStorage(current =>
        current.status === "loading"
          ? { status: "readFailed", problem: "readTimedOut", revision: current.revision }
          : current);
    }, HYDRATION_DEADLINE_MS);
    api.loadPreferences().then(
      outcome => {
        if (superseded || !mounted.current) return;
        if (outcome.outcome === "loaded" && isStoredPreferences(outcome.preferences)) {
          // Only if nothing of the user's would be overwritten. A read that
          // lost its race is still news about the store, and not about what
          // the user has since chosen.
          if (!userOwnsTheRecord.current) {
            dispatch({ type: "hydrate", preferences: outcome.preferences.appearance });
            movePanelsQuietly({ type: "hydrate", layout: outcome.preferences.layout });
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
        // The call failed on the way. That is not a store that does not exist:
        // recoverable defaults, an accurate reason, and a save is still
        // attempted rather than suppressed for the session.
        setStorage(current => ({ status: "readFailed", problem: "readFailed", revision: current.revision }));
      },
    );
    return () => {
      superseded = true;
      window.clearTimeout(deadline);
    };
  }, [api]);

  /**
   * Applies a status a reply reports, unless a newer commit has overtaken it.
   *
   * The two lanes are serialized in Rust but delivered independently, so a
   * refusal decided before a commit can arrive after it. Its revision is the
   * store's revision at the moment it was decided, so one lower than the
   * highest adopted describes a store this session has already moved past --
   * and applying it would put the recovery alert back over a record that was
   * just written.
   */
  const regress = useCallback(
    (revision: number, status: PreferenceStorageState["status"], problem: string) => {
      setStorage(current =>
        revision < current.revision ? current : { ...current, status, problem });
    },
    [],
  );

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
    captured.current = { snapshot, replaceUnusable };
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
          if (replaceUnusable) {
            // This request published the layout group too, and it has just been
            // confirmed. Any outstanding layout reply describes a store that no
            // longer exists, and any unsaved claim the shell is showing is
            // about an arrangement that is now on disk.
            layoutTicket.current += 1;
            setLayoutSave(IDLE_LAYOUT);
          }
          // The snapshot that was committed and read back, not the draft that
          // asked for it. They are the same record whenever the store is
          // behaving, and adopting the confirmed one is what makes "this is
          // what a restart will find" a statement about disk rather than about
          // this dialog.
          dispatch(isStoredPreferences(outcome.preferences)
            ? { type: "committed", preferences: outcome.preferences.appearance }
            : { type: "apply" });
          setAnnouncement(replaceUnusable ? "storedReplaced" : "applied");
          return;
        }
        if (outcome.outcome === "storedRecordUnusable") {
          regress(outcome.revision, "unusable", outcome.problem);
          setSave({
            ...IDLE_APPEARANCE,
            status: "storedRecordUnusable",
            problem: outcome.problem,
          });
          return;
        }
        if (outcome.outcome === "unavailable") {
          regress(outcome.revision, "unavailable", outcome.problem);
          // The change the user asked for still happens, and it is named for
          // what it is. Leaving the draft unapplied made the first press a
          // no-op that the footer then reported as a session-only
          // application, and made a second press the one that worked.
          dispatch({ type: "apply" });
          setSave({ ...IDLE_APPEARANCE, sessionOnly: true });
          setAnnouncement("sessionOnlyApplied");
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
  }, [adopt, api, panelState.requested, regress]);

  // ---------------------------------------------------------------- layout

  const commitLayout = useCallback((layout: LayoutPreferences) => {
    userOwnsTheRecord.current = true;
    if (storageStatus.current === "unavailable") {
      // Nowhere to write, and Settings has already said so for the whole
      // session. A notice on every toggle would repeat that in the one place
      // it cannot be acted on -- but a *retry* that lands here must not read
      // as having worked, so the claim stands and only its retry is withdrawn.
      setLayoutSave(current =>
        current.status === "idle"
          ? IDLE_LAYOUT
          : { status: "unsaved", problem: "rootUnresolved", retryable: false });
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
          setLayoutAnnouncement(current => (current === "reset" ? current : null));
          // The committed layout, for the same reason: what is on screen after
          // a save is what the store confirmed, not what this document asked
          // for a moment earlier.
          if (isStoredPreferences(outcome.preferences)) {
            movePanelsQuietly({ type: "hydrate", layout: outcome.preferences.layout });
          }
          return;
        }
        if (outcome.outcome === "unavailable" || outcome.outcome === "storedRecordUnusable") {
          regress(
            outcome.revision,
            outcome.outcome === "unavailable" ? "unavailable" : "unusable",
            outcome.problem,
          );
        }
        // The panels keep the arrangement the user asked for; what is reported
        // is that it will not survive a restart, with a way to try again.
        setLayoutSave({
          status: "unsaved",
          problem: outcome.problem,
          retryable: outcome.outcome === "failed" ? outcome.retryable : false,
        });
        setLayoutAnnouncement(outcome.problem === "notConfirmed" ? "uncertain" : "unsaved");
      },
      () => {
        if (!mounted.current || ticket !== layoutTicket.current) return;
        setLayoutSave({ status: "unsaved", problem: "requestFailed", retryable: true });
        setLayoutAnnouncement("unsaved");
      },
    );
  }, [adopt, api, regress]);

  /**
   * Moves the panels, and publishes the arrangement where the action is a
   * choice.
   *
   * The next state is computed from a ref rather than inside a `setState`
   * updater. An updater that dispatched a disk write would be an impure one,
   * and React is entitled to call it twice -- which `StrictMode` does in
   * development, so every toggle published twice and only the second answer was
   * honoured. One press, one publish, in either mode.
   */
  const movePanels = useCallback((action: PanelAction) => {
    const next = panelReducer(panelStateRef.current, action);
    panelStateRef.current = next;
    setPanelState(next);
    // A reset removes its own control and its own visible effect is a layout
    // returning to the default, so it is the one panel action with nothing left
    // on screen to read. The toggles announce themselves through
    // `aria-expanded`, which is the platform's job rather than a region's.
    setLayoutAnnouncement(action.type === "reset" ? "reset" : null);
    if (commits(action)) commitLayout(next.requested);
  }, [commitLayout]);

  const present = useMemo(() => presentPanels(panelState, fit), [panelState, fit]);

  const panels: PanelsValue = useMemo(() => ({
    requested: panelState.requested,
    present,
    fit,
    busy: storage.status === "loading",
    save: layoutSave,
    announcement: layoutAnnouncement,
    toggle: panel => movePanels({ type: "toggle", panel, fit }),
    navigate: () => movePanels({ type: "navigate", constrained: fit.constrained }),
    reset: () => movePanels({ type: "reset" }),
    retry: () => commitLayout(panelState.requested),
  }), [commitLayout, fit, layoutAnnouncement, layoutSave, movePanels, panelState, present, storage.status]);

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
    discard: () => {
      // A cancelled draft clears the failure and its actions, and keeps
      // `sessionOnly`. That is a fact about this session, not about this press:
      // wiping it left the footer claiming the preferences were saved while the
      // session was running on ones that never reached disk.
      setSave(current => ({ ...IDLE_APPEARANCE, sessionOnly: current.sessionOnly }));
      captured.current = null;
      dispatch({ type: "discard" });
      setAnnouncement("cancelled");
    },
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
      const request = captured.current;
      if (request === null || save.status === "saving") return;
      // The same request, confirmation included. A retry that dropped it would
      // be asking Rust to write over a record it has already refused, so it
      // would be refused too -- a button that cannot work.
      commitAppearance(request.snapshot, request.replaceUnusable);
    },
    useForThisSession: () => {
      const request = captured.current;
      if (request === null || save.status === "saving") return;
      // Applied to the session, and nothing is claimed about disk. The draft
      // becomes the applied preferences; the last saved record is what a
      // restart still finds.
      dispatch({ type: "preview", preferences: request.snapshot });
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
