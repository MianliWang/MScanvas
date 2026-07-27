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
  readonly checkBackend: () => void;
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

  const backendToken = useRef(0);
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

  const checkBackend = useCallback(() => {
    backendToken.current += 1;
    const token = backendToken.current;
    setBackend({ status: "checking" });
    void api
      .inspectBackend()
      .then((availability) => {
        if (mounted.current && token === backendToken.current) {
          setBackend({ status: "resolved", availability });
        }
      })
      .catch((cause: unknown) => {
        if (mounted.current && token === backendToken.current) {
          setBackend({ status: "failed", error: toPreviewError(cause) });
        }
      });
  }, [api]);

  useEffect(checkBackend, [checkBackend]);

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
   * Applies a verdict that comes back from changing which installation is used.
   *
   * The token is taken before the request, so a check that was already in
   * flight cannot land afterwards and reinstate the reading it produced for the
   * installation that was in use before. That is the one way the banner could
   * assert a stale verdict, and it is not visible from the response handler
   * alone: both replies are well-formed, and only their order says which one
   * describes what the user is now using.
   */
  const applyInstallationChange = useCallback(
    (request: () => Promise<BackendAvailability | null>, announceChecking: boolean) => {
      backendToken.current += 1;
      const token = backendToken.current;
      if (announceChecking) {
        setBackend({ status: "checking" });
      }
      void request()
        .then((availability) => {
          if (!mounted.current || token !== backendToken.current) {
            return;
          }
          // `null` is a dismissed picker. Nothing changed, so the verdict
          // already on screen still describes what is in use, and replacing it
          // with anything -- including "checking" -- would say otherwise.
          if (availability !== null) {
            discardBackendDerivedState();
            setBackend({ status: "resolved", availability });
          }
        })
        .catch((cause: unknown) => {
          if (mounted.current && token === backendToken.current) {
            setBackend({ status: "failed", error: toPreviewError(cause) });
          }
        });
    },
    [discardBackendDerivedState],
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
          setPreview({ status: "loaded", preview: loaded });
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
            checkBackend();
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
            setSpectrum({ status: "failed", index, error: toPreviewError(cause) });
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
    checkBackend,
    chooseInstallation,
    useAutomaticDiscovery,
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
