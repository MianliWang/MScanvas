import { useCallback, useEffect, useRef, useState } from "react";

import { usePreviewApi } from "./api";
import type {
  BackendAvailability,
  Preview,
  PreviewError,
  SelectedSpectrum,
} from "./contracts";
import { toPreviewError } from "./contracts";
import {
  appendMeasurement,
  now,
  type PreviewMeasurement,
  type PreviewMeasurementName,
} from "./instrumentation";

export type BackendState =
  | { readonly status: "checking" }
  | { readonly status: "resolved"; readonly availability: BackendAvailability }
  | { readonly status: "failed"; readonly error: PreviewError };

export type PreviewState =
  | { readonly status: "empty" }
  | { readonly status: "opening" }
  | { readonly status: "loaded"; readonly preview: Preview }
  | { readonly status: "failed"; readonly error: PreviewError };

export type SpectrumState =
  | { readonly status: "none" }
  | { readonly status: "loading"; readonly index: number }
  | { readonly status: "loaded"; readonly spectrum: SelectedSpectrum }
  | { readonly status: "unavailable"; readonly requestedIndex: number }
  | { readonly status: "failed"; readonly index: number; readonly error: PreviewError };

export interface PreviewWorkspace {
  readonly backend: BackendState;
  readonly preview: PreviewState;
  readonly spectrum: SpectrumState;
  readonly selectedIndex: number | null;
  readonly measurements: readonly PreviewMeasurement[];
  /**
   * Whether a backend request is outstanding, including while the folder picker
   * is open.
   *
   * Actions that would start another are disabled while it is set. The two
   * installation commands contend for one lock in Rust, and letting a second
   * start means acting on a verdict that is already being replaced.
   */
  readonly backendBusy: boolean;
  readonly checkBackend: () => void;
  /** The file Rust still holds, whether or not a preview is on screen. */
  readonly selectedFileName: string | null;
  /** Reads the retained selection again, without going back to the picker. */
  readonly reopenSelectedFile: () => void;
  /** Shows the folder picker and uses what is chosen, for this session only. */
  readonly chooseInstallation: () => void;
  /**
   * Returns to automatic discovery. Offered whenever a folder is in use and
   * whenever the backend call itself failed, because a chosen folder that does
   * not work would otherwise be the only place MSCanvas looks for the rest of
   * the session, with nothing able to undo it.
   */
  readonly useAutomaticDiscovery: () => void;
  readonly openFile: () => void;
  /**
   * A picker that failed to open. Kept apart from `preview` because failing to
   * choose a new file is no reason to take away the file already on screen.
   */
  readonly pickerError: PreviewError | null;
  readonly dismissPickerError: () => void;
  /** Re-reads the file already open. Reading again is idempotent. */
  readonly retryOpen: () => void;
  readonly selectSpectrum: (index: number) => void;
  readonly retrySpectrum: () => void;
  /**
   * Completes whichever render measurements are outstanding, once what they
   * measure is actually in the DOM. Called from a layout effect, never from a
   * response handler: a response handler only schedules the update.
   */
  readonly completeRenderMeasurements: () => void;
  readonly recordMeasurement: (
    name: PreviewMeasurementName,
    milliseconds: number,
    detail: string,
  ) => void;
}

/**
 * Owns every asynchronous preview interaction.
 *
 * Each channel carries a monotonic request token. A response is applied only
 * while its token is still the newest one, so a slow reply for a row the user
 * has already navigated away from can never overwrite what they are looking
 * at now. That matters here because a spectrum load is one process launch and
 * launches do not finish in request order.
 */
export function usePreviewWorkspace(): PreviewWorkspace {
  const api = usePreviewApi();

  const [backend, setBackend] = useState<BackendState>({ status: "checking" });
  const [preview, setPreview] = useState<PreviewState>({ status: "empty" });
  const [pickerError, setPickerError] = useState<PreviewError | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumState>({ status: "none" });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [measurements, setMeasurements] = useState<readonly PreviewMeasurement[]>([]);
  /**
   * The name of the file Rust is still holding, kept apart from `preview`.
   *
   * Changing the installation discards everything a backend read, but not the
   * selection: Rust still holds that path and no backend decided it. Without
   * the name there is nothing to offer reopening, and the user would have to
   * find the same acquisition again -- which is exactly the workspace loss
   * WF-001 says changing the backend must not cause.
   */
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const [backendBusy, setBackendBusy] = useState(true);
  const backendToken = useRef(0);
  /**
   * The highest installation generation applied to the banner.
   *
   * Rust decides which verdict is current, because it is where the two commands
   * are actually ordered. This only refuses anything older than what is already
   * shown, which is what stops a recheck begun before a change from describing
   * the installation that change replaced.
   */
  const appliedGeneration = useRef(-1);
  /**
   * How many installation changes are outstanding.
   *
   * A ref rather than state because it is read inside promise handlers, where
   * a state value would be whatever it was when the closure was created —
   * which for a change that spans a modal dialog is exactly the wrong answer.
   */
  const installationChanges = useRef(0);
  /** A recovery check an installation change asked to wait its turn. */
  const deferredRecheck = useRef(false);
  const previewToken = useRef(0);
  const spectrumToken = useRef(0);
  const inFlightSpectrum = useRef<{ index: number; token: number } | null>(null);
  const pendingSpectrumRender = useRef<{ index: number; startedAt: number } | null>(null);
  const pendingOpenRender = useRef<{ rowCount: number; startedAt: number } | null>(null);
  const openHandle = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const recordMeasurement = useCallback(
    (name: PreviewMeasurementName, milliseconds: number, detail: string) => {
      setMeasurements((current) => appendMeasurement(current, { name, milliseconds, detail }));
    },
    [],
  );

  /**
   * Drops everything on screen that a backend produced.
   *
   * Changing the installation makes every one of those readings the work of an
   * installation no longer in use. Leaving them would not merely show something
   * stale: the table's rows are what a later selected spectrum is reconciled
   * against, so a spectrum read by the new installation would be compared with
   * rows read by the old one, and the honest answers to that comparison are a
   * wrong result or an invented conflict.
   *
   * The file itself stays chosen -- it is a path Rust holds, and no backend
   * decided it -- so opening it again is one click and reads nothing until the
   * user asks. Re-reading it here would launch processes nobody asked for, and
   * against an installation that may have just been reported unusable.
   */
  const discardBackendDerivedState = useCallback(() => {
    previewToken.current += 1;
    spectrumToken.current += 1;
    inFlightSpectrum.current = null;
    pendingSpectrumRender.current = null;
    pendingOpenRender.current = null;
    setPreview({ status: "empty" });
    setSpectrum({ status: "none" });
    setSelectedIndex(null);
  }, []);

  /**
   * The one rule for whether a reply may be shown. Every verdict goes through
   * here; no caller compares anything itself.
   *
   * Rust decides which installation is current, because it is where the
   * commands are actually ordered — each verdict is stamped under the same gate
   * that served it. So the generation is compared first and the request token
   * second, and never the other way round:
   *
   * - a **newer** generation is accepted whatever this caller's token says. It
   *   describes an installation Rust has already switched to, and a token is
   *   only a record of what this window asked for first.
   * - an **older** generation is refused. It describes an installation that has
   *   since been replaced.
   * - an **equal** generation means two readings of the same installation, which
   *   differ only in age, so the token decides and the superseded one is
   *   dropped.
   *
   * Getting that precedence backwards is what this replaces: a reply was
   * discarded on token order before its generation was ever looked at, so a
   * recovery check begun mid-dialog could leave the banner reporting the
   * installation the user had just replaced while every later operation used
   * the new one.
   *
   * Discarding what the previous installation read happens here too, keyed on
   * the generation advancing rather than on which call happened to carry the
   * news. Whichever reply first shows a higher generation is the one that has
   * learned the installation changed, and that is a property of the verdict,
   * not of the caller: hanging the discard off the change request alone left
   * the table and the selected spectrum of a replaced installation on screen
   * whenever an inspection observed the change first.
   */
  const applyVerdict = useCallback(
    (availability: BackendAvailability, token: number): boolean => {
      const generation = availability.installationGeneration;
      if (generation < appliedGeneration.current) {
        return false;
      }
      if (generation === appliedGeneration.current && token !== backendToken.current) {
        return false;
      }
      const changed = generation > appliedGeneration.current && appliedGeneration.current >= 0;
      appliedGeneration.current = generation;
      setBackend({ status: "resolved", availability });
      if (changed) {
        discardBackendDerivedState();
      }
      return true;
    },
    [discardBackendDerivedState],
  );

  const checkBackend = useCallback(() => {
    backendToken.current += 1;
    const token = backendToken.current;
    setBackendBusy(true);
    setBackend({ status: "checking" });
    void api
      .inspectBackend()
      .then((availability) => {
        if (mounted.current) {
          // No token check of its own: `applyVerdict` weighs the generation
          // first and only falls back to the token, and a check that returns
          // after an installation change reports the installation Rust served
          // it under, not the one this call was started for.
          applyVerdict(availability, token);
        }
      })
      .catch((cause: unknown) => {
        if (mounted.current && token === backendToken.current) {
          setBackend({ status: "failed", error: toPreviewError(cause) });
        }
      })
      .finally(() => {
        if (mounted.current && token === backendToken.current) {
          setBackendBusy(false);
        }
      });
  }, [api, applyVerdict]);

  useEffect(checkBackend, [checkBackend]);


  /**
   * Applies a verdict that comes back from changing which installation is used.
   *
   * The reply is never dropped on token order alone. A change can span a modal
   * dialog, and anything the application starts meanwhile — a recovery check
   * after a failed open, say — advances the token behind it. Ordering by that
   * would throw away the one reply that describes what Rust is now using, which
   * is why `applyVerdict` weighs the generation first.
   */
  const applyInstallationChange = useCallback(
    (request: () => Promise<BackendAvailability | null>, announceChecking: boolean) => {
      backendToken.current += 1;
      const token = backendToken.current;
      installationChanges.current += 1;
      // What had been applied when this was asked for. A failed change means the
      // installation did not change, so it is still worth reporting -- but only
      // while nothing newer has been shown, which this failure cannot speak for.
      const generationAtRequest = appliedGeneration.current;
      setBackendBusy(true);
      if (announceChecking) {
        setBackend({ status: "checking" });
      }
      // Whether this change left the banner as it found it, which is what
      // decides a deferred recovery check below. A dismissed picker does;
      // so does a failure whose reply arrived too late to be shown.
      let refreshed = false;
      void request()
        .then((availability) => {
          if (!mounted.current) {
            return;
          }
          // `null` is a dismissed picker: nothing changed, so nothing on screen
          // may change either.
          if (availability !== null && applyVerdict(availability, token)) {
            refreshed = true;
          }
        })
        .catch((cause: unknown) => {
          if (mounted.current && appliedGeneration.current <= generationAtRequest) {
            setBackend({ status: "failed", error: toPreviewError(cause) });
            refreshed = true;
          }
        })
        .finally(() => {
          installationChanges.current -= 1;
          if (!mounted.current) {
            return;
          }
          if (token === backendToken.current) {
            setBackendBusy(false);
          }
          // A recovery check that stood aside for this change runs unless the
          // change refreshed the banner itself. Re-checking after it did would
          // launch a process to learn what is already on screen; not checking
          // after it did not would leave the failed open's banner unexamined,
          // which is the whole reason that check exists.
          if (installationChanges.current === 0 && deferredRecheck.current) {
            deferredRecheck.current = false;
            if (!refreshed) {
              checkBackend();
            }
          }
        });
    },
    [applyVerdict, checkBackend],
  );

  /**
   * Points MSCanvas at a folder the user picks, for this session only.
   *
   * Nothing is set to "checking" first: the modal picker is the feedback, and
   * announcing a check before there is anything to check would discard a
   * perfectly good verdict the moment the user opens the dialog -- and leave it
   * discarded if they then cancel.
   */
  const chooseInstallation = useCallback(() => {
    applyInstallationChange(() => api.chooseInstallation(), false);
  }, [api, applyInstallationChange]);

  /** Returns to automatic discovery. Always offered once a folder was chosen. */
  const useAutomaticDiscovery = useCallback(() => {
    applyInstallationChange(() => api.useAutomaticDiscovery(), true);
  }, [api, applyInstallationChange]);

  const loadPreview = useCallback(
    (handle: string, startedAt: number) => {
      previewToken.current += 1;
      const token = previewToken.current;
      // A new file invalidates any spectrum still in flight for the old one,
      // including the guard that stops a row being read twice. Leaving that
      // guard set would make the same row index unselectable in the new file
      // until the abandoned read settled.
      spectrumToken.current += 1;
      inFlightSpectrum.current = null;
      pendingSpectrumRender.current = null;
      pendingOpenRender.current = null;
      setPreview({ status: "opening" });
      setSpectrum({ status: "none" });
      setSelectedIndex(null);
      void api
        .openPreview(handle)
        .then((loaded) => {
          if (!mounted.current || token !== previewToken.current) {
            return;
          }
          // An open is a look at the backend too, and it can be the first thing
          // to see a change — in which case the service advances the sequence
          // while producing this very preview. Adopting that number here is
          // what stops the next verdict's higher number reading as a change
          // that happened afterwards and discarding a reading that is current.
          const noticedAChange = loaded.installationGeneration > appliedGeneration.current;
          if (noticedAChange) {
            appliedGeneration.current = loaded.installationGeneration;
          }
          setPreview({ status: "loaded", preview: loaded });
          if (noticedAChange) {
            // This open was the first thing to see the change, so the banner
            // still names the installation it replaced -- and would go on doing
            // so beside a preview that came from a different one. Reading it
            // again is the only way to say what is on screen, and it cannot
            // take this preview away: the verdict will carry the generation
            // just adopted, which is not a change after it.
            checkBackend();
          }
          // Not finished here: this call only schedules the update, and the
          // summary and the first table window have not been built yet.
          pendingOpenRender.current = {
            rowCount: loaded.spectrumTable.rows.length,
            startedAt,
          };
        })
        .catch((cause: unknown) => {
          if (mounted.current && token === previewToken.current) {
            setPreview({ status: "failed", error: toPreviewError(cause) });
            // The installation may be the reason. Re-checking here keeps the
            // banner from insisting a backend is present after it has gone,
            // which would leave the user with no way back except a restart.
            //
            // Except while the user is changing the installation. This check is
            // not a user action and so passes straight through `backendBusy`,
            // which makes it the one thing that can race a change; and a change
            // is already going to produce a fresh verdict, so racing it buys
            // nothing. It waits, and runs only if the change turns out to leave
            // the banner as stale as it found it.
            if (installationChanges.current > 0) {
              deferredRecheck.current = true;
            } else {
              checkBackend();
            }
          }
        });
    },
    [api, checkBackend],
  );

  const openFile = useCallback(() => {
    const startedAt = now();
    setPickerError(null);
    void api
      .chooseFile()
      .then((file) => {
        if (!mounted.current) {
          return;
        }
        // A dismissed picker is not a failure and must leave the workspace
        // exactly as the user left it.
        if (file === null) {
          return;
        }
        openHandle.current = file.handle;
        setSelectedFileName(file.fileName);
        loadPreview(file.handle, startedAt);
      })
      .catch((cause: unknown) => {
        // The workspace is left exactly as it was. The previously opened file
        // is still open, in Rust and on screen.
        if (mounted.current) {
          setPickerError(toPreviewError(cause));
        }
      });
  }, [api, loadPreview]);

  const dismissPickerError = useCallback(() => {
    setPickerError(null);
  }, []);

  const selectSpectrum = useCallback(
    (index: number) => {
      const handle = openHandle.current;
      if (handle === null) {
        return;
      }
      // A repeat of the row already being read is dropped. Every selection is
      // one backend process, and a double click should not be two of them.
      // This is deduplication only: nothing is queued and nothing is
      // cancelled, both of which are separately gated.
      if (inFlightSpectrum.current?.index === index) {
        return;
      }
      const startedAt = now();
      spectrumToken.current += 1;
      const token = spectrumToken.current;
      inFlightSpectrum.current = { index, token };
      setSelectedIndex(index);
      setSpectrum({ status: "loading", index });
      void api
        .loadSpectrum(handle, index)
        .then((outcome) => {
          // Keyed by token, so a stale reply cannot clear the guard belonging
          // to a newer request for the same index.
          if (inFlightSpectrum.current?.token === token) {
            inFlightSpectrum.current = null;
          }
          if (!mounted.current || token !== spectrumToken.current) {
            return;
          }
          setSpectrum(
            outcome.outcome === "spectrum"
              ? { status: "loaded", spectrum: outcome.spectrum }
              : { status: "unavailable", requestedIndex: outcome.requestedIndex },
          );
          // The measurement is not finished here. Recording it now would time
          // the reply, not the render, and it is the render this metric names.
          pendingSpectrumRender.current =
            outcome.outcome === "spectrum" ? { index, startedAt } : null;
        })
        .catch((cause: unknown) => {
          if (inFlightSpectrum.current?.token === token) {
            inFlightSpectrum.current = null;
          }
          if (mounted.current && token === spectrumToken.current) {
            const failure = toPreviewError(cause);
            setSpectrum({ status: "failed", index, error: failure });
            // The backend turned out to have changed since this file was
            // opened, and a spectrum load is where that was noticed. Nothing
            // else is going to say so: the failure is not retryable, so the
            // table stays on screen looking current and every further row fails
            // the same way until the user happens to press Check again. The
            // readings go, the selection stays, and the banner is refreshed to
            // describe what is installed now.
            if (failure.kind === "installation_changed_since_preview") {
              discardBackendDerivedState();
              checkBackend();
            }
          }
        });
    },
    [api],
  );

  const completeRenderMeasurements = useCallback(() => {
    const openPending = pendingOpenRender.current;
    if (openPending !== null) {
      pendingOpenRender.current = null;
      recordMeasurement(
        "openToFirstPreview",
        now() - openPending.startedAt,
        `Choosing the file through ${formatRows(openPending.rowCount)} being in the document.`,
      );
    }
    const spectrumPending = pendingSpectrumRender.current;
    if (spectrumPending !== null) {
      pendingSpectrumRender.current = null;
      recordMeasurement(
        "rowSelectToRendered",
        now() - spectrumPending.startedAt,
        `Selecting row ${spectrumPending.index} through that spectrum being in the document.`,
      );
    }
  }, [recordMeasurement]);

  const retrySpectrum = useCallback(() => {
    if (selectedIndex !== null) {
      selectSpectrum(selectedIndex);
    }
  }, [selectSpectrum, selectedIndex]);

  /**
   * Reads the retained selection again. Same work as a retry, offered for a
   * different reason: nothing failed, the reading simply belongs to an
   * installation no longer in use.
   */
  const reopenSelectedFile = useCallback(() => {
    const handle = openHandle.current;
    if (handle !== null) {
      loadPreview(handle, now());
    }
  }, [loadPreview]);

  const retryOpen = useCallback(() => {
    const handle = openHandle.current;
    if (handle !== null) {
      loadPreview(handle, now());
    }
  }, [loadPreview]);

  return {
    backend,
    preview,
    spectrum,
    selectedIndex,
    measurements,
    backendBusy,
    checkBackend,
    chooseInstallation,
    useAutomaticDiscovery,
    selectedFileName,
    reopenSelectedFile,
    openFile,
    pickerError,
    dismissPickerError,
    retryOpen,
    selectSpectrum,
    retrySpectrum,
    completeRenderMeasurements,
    recordMeasurement,
  };
}

function formatRows(count: number): string {
  return count === 1 ? "1 spectrum row" : `${count} spectrum rows`;
}
