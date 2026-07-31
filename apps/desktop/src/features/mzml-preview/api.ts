import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import type {
  BackendAvailability,
  FolderIngestionResult,
  Preview,
  SelectedSpectrumOutcome,
  WorkspaceAddResult,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "./contracts";

/**
 * What the webview may ask the desktop backend.
 *
 * Three kinds of question and nothing else: which ProteoWizard is in use, what
 * the session's workspace holds and how it changes, and what one dataset in it
 * contains. Deliberately not counted here — a number in a comment is a second
 * thing to keep true, and this list is the authority on its own length.
 *
 * It cannot supply a command, an executable path, a file path or an argument
 * list, and it never receives raw ProteoWizard output: choosing files or a
 * folder is a request to show a picker, not a path this side names. Naming the
 * boundary as an interface also lets tests drive the workspace deterministically
 * without a WebView.
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
  /**
   * Everything the session holds, in the order Rust holds it. Reads stored
   * facts: no file is revalidated and no backend work is started.
   */
  getRoster(): Promise<WorkspaceRoster>;
  /**
   * Shows the native picker and adds every chosen file. Resolves to `null` when
   * the user dismissed the picker, which is not the same as a batch that added
   * nothing. Launches no preview.
   */
  chooseFiles(): Promise<WorkspaceAddResult | null>;
  /**
   * Shows the native folder picker and adds every mzML file found beneath the
   * chosen folder. Resolves to `null` when the user dismissed the picker, which
   * is not the same as a folder that held no mzML files.
   *
   * Launches no preview and no backend work at all: a folder of a thousand
   * files costs a thousand filesystem inspections and no processes.
   */
  chooseFolder(): Promise<FolderIngestionResult | null>;
  /** Removes the rows these handles name. Source files are never touched. */
  removeDatasets(handles: readonly string[]): Promise<WorkspaceRemoveResult>;
  /** Empties the workspace. Source files are never touched. */
  clearWorkspace(): Promise<WorkspaceRoster>;
  openPreview(handle: string): Promise<Preview>;
  loadSpectrum(handle: string, index: number): Promise<SelectedSpectrumOutcome>;
}

export const tauriPreviewApi: PreviewApi = {
  inspectBackend: () => invoke<BackendAvailability>("inspect_backend"),
  chooseInstallation: () => invoke<BackendAvailability | null>("choose_backend_installation"),
  useAutomaticDiscovery: () => invoke<BackendAvailability>("use_automatic_backend_discovery"),
  getRoster: () => invoke<WorkspaceRoster>("get_workspace_roster"),
  chooseFiles: () => invoke<WorkspaceAddResult | null>("choose_mzml_files"),
  chooseFolder: () => invoke<FolderIngestionResult | null>("choose_mzml_folder"),
  removeDatasets: (handles) =>
    invoke<WorkspaceRemoveResult>("remove_workspace_datasets", { handles }),
  clearWorkspace: () => invoke<WorkspaceRoster>("clear_workspace"),
  openPreview: (handle) => invoke<Preview>("open_mzml_preview", { handle }),
  loadSpectrum: (handle, index) =>
    invoke<SelectedSpectrumOutcome>("load_selected_spectrum", { handle, index }),
};

const PreviewApiContext = createContext<PreviewApi>(tauriPreviewApi);

export const PreviewApiProvider = PreviewApiContext.Provider;

export function usePreviewApi(): PreviewApi {
  return useContext(PreviewApiContext);
}
