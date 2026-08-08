import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import type {
  BackendAvailability,
  ConversionConflictPolicy,
  ConversionPlanSummary,
  FolderIngestionResult,
  Preview,
  SelectedSpectrumOutcome,
  WorkspaceAddResult,
  WorkspaceConversionUpdate,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "./contracts";

interface FolderImportReservation {
  readonly reservationId: string;
}

interface ConversionReservation {
  readonly reservationId: string;
}

const DOCUMENT_AUTHORITY_HEADER = "mscanvas-document-authority";
const DOCUMENT_AUTHORITY_PROPERTY = "__MSCANVAS_DOCUMENT_AUTHORITY__";

/**
 * The per-document secret Rust installs before any script runs.
 *
 * A conversion reservation is authority over a native picker and over a file
 * this application creates, so it is bound to a document exactly as tightly as
 * the drop subscription is. Read from this JavaScript realm before any queued
 * work, so a delayed call from a replaced document keeps its old header and
 * fails Rust's current-document proof.
 */
function currentDocumentAuthority(): string {
  const authority = Reflect.get(globalThis, DOCUMENT_AUTHORITY_PROPERTY);
  if (typeof authority !== "string" || !/^[0-9a-f]{32}$/.test(authority)) {
    throw new Error("The current page does not have conversion authority.");
  }
  return authority;
}

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
   *
   * Admits mzML and the one evidenced Thermo RAW family. The picker's extension
   * filter is candidate filtering only: what each file is admitted as is decided
   * by opening and inspecting it in Rust.
   */
  chooseFiles(): Promise<WorkspaceAddResult | null>;
  /**
   * Shows the native folder picker and adds every mzML file found beneath the
   * chosen folder. Resolves to `null` when the user dismissed the picker, which
   * is not the same as a folder that held no mzML files.
   *
   * `onReserved` is called only after Rust has returned the reservation and
   * the exact claim request has been dispatched. Clear and Remove must wait for
   * that boundary, but not for the native picker or scan to finish. If one of
   * them reaches Rust before the claim, the claim is refused before the picker;
   * if it follows the claim, it supersedes the eventual commit.
   *
   * Launches no preview and no backend work at all: a folder of a thousand
   * files costs a thousand filesystem inspections and no processes.
   */
  chooseFolder(onReserved: () => void): Promise<FolderIngestionResult | null>;
  /** Removes the rows these handles name. Source files are never touched. */
  removeDatasets(handles: readonly string[]): Promise<WorkspaceRemoveResult>;
  /** Empties the workspace. Source files are never touched. */
  clearWorkspace(): Promise<WorkspaceRoster>;
  openPreview(handle: string): Promise<Preview>;
  loadSpectrum(handle: string, index: number): Promise<SelectedSpectrumOutcome>;
  /**
   * Describes the conversion one row would get. Starts nothing: no picker, no
   * reservation, no process.
   */
  describeConversion(handle: string): Promise<ConversionPlanSummary>;
  /**
   * Reads the session's one conversion slot.
   *
   * The authoritative answer, and the only one that survives a reload. There is
   * no push channel here on purpose: a conversion has one slot and two
   * observable transitions, so a read on mount plus a read while something runs
   * is the whole of what a document needs.
   */
  getConversionState(): Promise<WorkspaceConversionUpdate>;
  /**
   * Binds one conversion, shows the native destination picker and runs it.
   *
   * `onReserved` is called only after Rust has returned the reservation and the
   * exact claim request has been dispatched, which is the boundary a caller
   * must wait for before it can treat the operation as owned.
   *
   * Resolves to the conversion state, which is the same value `getConversionState`
   * returns — so a reply lost with a replaced document costs the replacement one
   * read and nothing else. A dismissed picker resolves to the idle state, which
   * is an ordinary outcome: nothing was created and nothing ran.
   */
  convertDataset(
    handle: string,
    conflictPolicy: ConversionConflictPolicy,
    onReserved: () => void,
  ): Promise<WorkspaceConversionUpdate>;
}

export const tauriPreviewApi: PreviewApi = {
  inspectBackend: () => invoke<BackendAvailability>("inspect_backend"),
  chooseInstallation: () => invoke<BackendAvailability | null>("choose_backend_installation"),
  useAutomaticDiscovery: () => invoke<BackendAvailability>("use_automatic_backend_discovery"),
  getRoster: () => invoke<WorkspaceRoster>("get_workspace_roster"),
  chooseFiles: () => invoke<WorkspaceAddResult | null>("choose_workspace_files"),
  chooseFolder: (onReserved) =>
    invoke<FolderImportReservation>("begin_mzml_folder_import").then((reservation) => {
      const chosen = invoke<FolderIngestionResult | null>("choose_mzml_folder", {
        reservationId: reservation.reservationId,
      });
      onReserved();
      return chosen;
    }),
  removeDatasets: (handles) =>
    invoke<WorkspaceRemoveResult>("remove_workspace_datasets", { handles }),
  clearWorkspace: () => invoke<WorkspaceRoster>("clear_workspace"),
  openPreview: (handle) => invoke<Preview>("open_mzml_preview", { handle }),
  loadSpectrum: (handle, index) =>
    invoke<SelectedSpectrumOutcome>("load_selected_spectrum", { handle, index }),
  describeConversion: (handle) =>
    invoke<ConversionPlanSummary>("describe_workspace_conversion", { handle }),
  getConversionState: () =>
    invoke<WorkspaceConversionUpdate>("get_workspace_conversion_state"),
  convertDataset: (handle, conflictPolicy, onReserved) => {
    const invokeOptions = {
      headers: { [DOCUMENT_AUTHORITY_HEADER]: currentDocumentAuthority() },
    };
    return invoke<ConversionReservation>(
      "begin_workspace_conversion",
      { handle, conflictPolicy },
      invokeOptions,
    ).then((reservation) => {
      const converted = invoke<WorkspaceConversionUpdate>(
        "choose_workspace_conversion_destination",
        { reservationId: reservation.reservationId },
        invokeOptions,
      );
      onReserved();
      return converted;
    });
  },
};

const PreviewApiContext = createContext<PreviewApi>(tauriPreviewApi);

export const PreviewApiProvider = PreviewApiContext.Provider;

export function usePreviewApi(): PreviewApi {
  return useContext(PreviewApiContext);
}
