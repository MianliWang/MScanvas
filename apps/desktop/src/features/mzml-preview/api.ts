import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import type {
  BackendAvailability,
  Preview,
  SelectedFile,
  SelectedSpectrumOutcome,
} from "./contracts";

/**
 * The four things the webview may ask the desktop backend.
 *
 * It cannot supply a command, an executable path or an argument list, and it
 * never receives raw ProteoWizard output. Naming the boundary as an interface
 * also lets tests drive the workspace deterministically without a WebView.
 */
export interface PreviewApi {
  inspectBackend(): Promise<BackendAvailability>;
  /** Resolves to `null` when the user dismissed the picker. */
  chooseFile(): Promise<SelectedFile | null>;
  openPreview(handle: string): Promise<Preview>;
  loadSpectrum(handle: string, index: number): Promise<SelectedSpectrumOutcome>;
}

export const tauriPreviewApi: PreviewApi = {
  inspectBackend: () => invoke<BackendAvailability>("inspect_backend"),
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
