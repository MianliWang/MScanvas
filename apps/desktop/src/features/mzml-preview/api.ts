import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import type {
  BackendAvailability,
  Preview,
  SelectedFile,
  SelectedSpectrumOutcome,
} from "./contracts";

/**
 * The six things the webview may ask the desktop backend.
 *
 * It cannot supply a command, an executable path or an argument list, and it
 * never receives raw ProteoWizard output. Naming the boundary as an interface
 * also lets tests drive the workspace deterministically without a WebView.
 */
export interface PreviewApi {
  inspectBackend(): Promise<BackendAvailability>;
  /**
   * Shows the native folder picker, uses the chosen ProteoWizard for this
   * session, and reports what that installation can do. Resolves to `null` when
   * the user dismissed the picker, which means nothing changed.
   *
   * Choosing and probing are one call so no caller can render a verdict from
   * before the change.
   */
  chooseInstallation(): Promise<BackendAvailability | null>;
  /** Goes back to searching automatically, and reports what that finds. */
  useAutomaticDiscovery(): Promise<BackendAvailability>;
  /** Resolves to `null` when the user dismissed the picker. */
  chooseFile(): Promise<SelectedFile | null>;
  openPreview(handle: string): Promise<Preview>;
  loadSpectrum(handle: string, index: number): Promise<SelectedSpectrumOutcome>;
}

export const tauriPreviewApi: PreviewApi = {
  inspectBackend: () => invoke<BackendAvailability>("inspect_backend"),
  chooseInstallation: () => invoke<BackendAvailability | null>("choose_backend_installation"),
  useAutomaticDiscovery: () => invoke<BackendAvailability>("use_automatic_backend_discovery"),
  chooseFile: () => invoke<SelectedFile | null>("choose_mzml_file"),
  openPreview: (handle) => invoke<Preview>("open_mzml_preview", { handle }),
  loadSpectrum: (handle, index) =>
    invoke<SelectedSpectrumOutcome>("load_selected_spectrum", { handle, index }),
};

const PreviewApiContext = createContext<PreviewApi>(tauriPreviewApi);

export const PreviewApiProvider = PreviewApiContext.Provider;

export function usePreviewApi(): PreviewApi {
  return useContext(PreviewApiContext);
}
