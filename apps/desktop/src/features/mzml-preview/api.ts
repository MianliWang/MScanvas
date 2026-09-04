import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import type {
  WorkspaceOutputAdoptionResult,
  BackendAvailability,
  ChromatogramCopyOutcome,
  LinkedFigureCopyOutcome,
  LinkedFigureExportOutcome,
  LinkedFigureFormat,
  ChromatogramExportFormat,
  ChromatogramExportOutcome,
  ChromatogramRange,
  ChromatogramTraceSet,
  ConversionConflictPolicy,
  ConversionIntentCatalog,
  ConversionQueuePlan,
  FolderIngestionResult,
  Preview,
  SelectedSpectrumOutcome,
  SpectrumExportFormat,
  FigureSettings,
  SpectrumCopyOutcome,
  SpectrumProjection,
  SpectrumExportOutcome,
  SpectrumRange,
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

interface DiagnosticsReservation {
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
   * Every conversion semantic that may be chosen, and which of them the
   * installed executable can express.
   *
   * A backend read: it probes the installed `msconvert`'s help and takes the
   * one lane, so it is asked once per installation rather than once per plan.
   * The reply is stamped with the installation it describes, which is what lets
   * a slower answer about a replaced build be discarded.
   */
  conversionIntents(): Promise<ConversionIntentCatalog>;
  /**
   * Describes the conversion one row would get, under one exact semantic.
   *
   * Starts nothing: no picker, no reservation, no process. The semantic is
   * named by the identity Rust issued, never by five loose values, so a
   * combination the evidence does not admit cannot be asked for.
   */
  describeConversion(
    handles: readonly string[],
    intentId: string,
    conflictPolicy: ConversionConflictPolicy,
  ): Promise<ConversionQueuePlan>;
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
  convertDatasets(
    handles: readonly string[],
    conflictPolicy: ConversionConflictPolicy,
    intentId: string,
    onReserved: () => void,
  ): Promise<WorkspaceConversionUpdate>;
  /**
   * Runs every retryable failure of the terminal queue again.
   *
   * Takes nothing: the queue already holds its destination, its order and its
   * policy, and asking for any of them again would make a retry a new decision
   * rather than the same one repeated.
   */
  retryConversions(): Promise<WorkspaceConversionUpdate>;
  /**
   * Stops the running conversion queue.
   *
   * Takes the operation identifier the caller is looking at and nothing else.
   * Which queue is the only thing a caller may say; everything about how it
   * ends is Rust's.
   *
   * Resolves to the authoritative state, like every other conversion command,
   * so a reply lost with a replaced document costs the replacement one read.
   * Repeating it for a queue already stopping is not an error.
   */
  stopConversion(operationId: string): Promise<WorkspaceConversionUpdate>;
  /**
   * Adds a terminal queue's finalized mzML outputs to the workspace.
   *
   * Takes the operation identifier the caller is looking at and nothing else.
   * Which outputs, in which order, and whether each may be admitted are all
   * Rust's to decide -- it is the side that made the files and kept hold of
   * them.
   *
   * Resolves to the authoritative roster plus one outcome per finalized output,
   * in queue order. An output that cannot be admitted is an outcome rather than
   * an error, and does not stop the others.
   */
  adoptConversionOutputs(operationId: string): Promise<WorkspaceOutputAdoptionResult>;
  /**
   * Saves one local, redacted JSON diagnostics file for the terminal queue.
   *
   * Takes the operation identifier the caller is looking at and nothing else.
   * Where the file goes is chosen in a Rust-owned native save dialog and never
   * named by this side; what goes into it is decided by Rust, which is the side
   * that knows the paths it has to remove.
   *
   * `onReserved` is called only after Rust has returned the reservation and the
   * exact claim request has been dispatched, which is the boundary a caller must
   * wait for before it can treat the export as owned.
   *
   * Resolves to the conversion state, whose `diagnostics.lastExport` carries the
   * file name, length and digest — so a reply lost with a replaced document
   * costs the replacement one read and nothing else. A dismissed dialog resolves
   * to a state with nothing new on it, which is an ordinary outcome: nothing was
   * created and nothing was written.
   */
  exportConversionDiagnostics(
    operationId: string,
    onReserved: () => void,
  ): Promise<WorkspaceConversionUpdate>;
  /**
   * Exports the loaded selected spectrum as one SVG, CSV or TSV file.
   *
   * Takes the opaque token that spectrum's panel carries, and nothing else.
   * This side supplies no arrays, no path and no dataset handle: which
   * measurement is written was decided when Rust interpreted it, and the arrays
   * this document holds are a bounded transfer that must never become a file.
   *
   * A token from an earlier selection is refused rather than answered with
   * whichever spectrum is loaded now, so an export cannot quietly write a
   * different measurement than the one it was invoked for.
   *
   * Where the file goes is chosen in a Rust-owned native save dialog and is
   * never named by this side. Resolves to `cancelled` when that dialog is
   * dismissed, which is an ordinary outcome and not an error.
   */
  exportSelectedSpectrum(
    exportToken: string,
    format: SpectrumExportFormat,
    range: SpectrumRange,
    settings: FigureSettings,
  ): Promise<SpectrumExportOutcome>;

  /**
   * Puts the selected spectrum's figure on the system clipboard.
   *
   * The same figure a PNG export writes, drawn by the same Rust renderer from
   * the same retained spectrum. No image crosses this boundary in either
   * direction: this side asks for a copy and is told whether one happened.
   *
   * There is no dialog, no file name and no path. A token from an earlier
   * selection is refused rather than answered with whichever spectrum is loaded
   * now.
   */
  copySelectedSpectrumPlot(
    exportToken: string,
    range: SpectrumRange,
    settings: FigureSettings,
  ): Promise<SpectrumCopyOutcome>;

  /**
   * Draws one committed m/z window of the selected spectrum.
   *
   * The viewport's read of the same retained spectrum the export commands name,
   * and the answer to a question this side cannot settle for itself: `mz` and
   * `intensity` in the selected-spectrum payload are bounded for transfer, so a
   * window beyond that prefix has to be drawn from the complete arrays Rust
   * kept. Panning past the end of what was transferred must show the source
   * rather than blank space.
   *
   * What comes back is a **bounded screen projection** -- real measurements,
   * possibly fewer of them than the window holds, never an invented one -- and
   * it is never what a scientific export is taken from.
   *
   * Launches no process and re-reads no acquisition: moving a viewport is not
   * re-acquiring a spectrum. It takes no export lane either, so a reader may
   * pan while a file is being written. A token from an earlier selection is
   * refused rather than answered with whichever spectrum is loaded now, and a
   * window this spectrum does not have is refused rather than clamped.
   */
  projectSelectedSpectrum(
    exportToken: string,
    low: number,
    high: number,
  ): Promise<SpectrumProjection>;

  /**
   * Exports the loaded run's chromatogram as one figure or one data document.
   *
   * Takes the opaque token the preview carried, the range to cover and the
   * traces on screen. This side supplies no arrays, no path, no dataset handle
   * and no screen geometry: what is written comes from the per-scan facts Rust
   * retained when the preview was read, not from the rows or the polyline this
   * document holds.
   *
   * The range is checked against that run rather than trusted, and refused
   * rather than clamped where it does not fit. A token from an earlier preview
   * is refused rather than answered with whichever run is loaded now.
   */
  exportChromatogram(
    exportToken: string,
    format: ChromatogramExportFormat,
    range: ChromatogramRange,
    traces: ChromatogramTraceSet,
    settings: FigureSettings,
  ): Promise<ChromatogramExportOutcome>;

  /**
   * Puts the chromatogram's figure on the system clipboard.
   *
   * The same figure a PNG export writes, drawn by the same Rust renderer from
   * the same retained facts. No image crosses this boundary in either
   * direction.
   */
  copyChromatogramPlot(
    exportToken: string,
    range: ChromatogramRange,
    traces: ChromatogramTraceSet,
    settings: FigureSettings,
  ): Promise<ChromatogramCopyOutcome>;

  /**
   * Exports the chromatogram and the selected spectrum as one linked figure.
   *
   * **Both tokens, together.** The pair is what the figure is about, so Rust
   * binds them in one operation: that each still names what this session holds,
   * that they are one scan of one run, that the scan is inside the range that
   * would be drawn, and that the figure is tall enough for two panels. This side
   * supplies no arrays, no retention time and no geometry -- the marker's
   * position comes from the retained table row, not from anything on screen.
   *
   * There is no linked data export. A combined table would have to interleave
   * two different measurements or drop the link.
   */
  exportLinkedFigure(
    chromatogramToken: string,
    spectrumToken: string,
    format: LinkedFigureFormat,
    range: ChromatogramRange,
    traces: ChromatogramTraceSet,
    settings: FigureSettings,
  ): Promise<LinkedFigureExportOutcome>;

  /**
   * Puts the linked figure on the system clipboard.
   *
   * The same two panels a PNG export writes, drawn by the same Rust renderer
   * from the same retained pair. No image crosses this boundary in either
   * direction.
   */
  copyLinkedPlot(
    chromatogramToken: string,
    spectrumToken: string,
    range: ChromatogramRange,
    traces: ChromatogramTraceSet,
    settings: FigureSettings,
  ): Promise<LinkedFigureCopyOutcome>;
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
  conversionIntents: () =>
    invoke<ConversionIntentCatalog>("get_workspace_conversion_intents"),
  describeConversion: (handles, intentId, conflictPolicy) =>
    invoke<ConversionQueuePlan>("describe_workspace_conversion_queue", {
      handles,
      intentId,
      conflictPolicy,
    }),
  getConversionState: () =>
    invoke<WorkspaceConversionUpdate>("get_workspace_conversion_state"),
  convertDatasets: (handles, conflictPolicy, intentId, onReserved) => {
    const invokeOptions = {
      headers: { [DOCUMENT_AUTHORITY_HEADER]: currentDocumentAuthority() },
    };
    return invoke<ConversionReservation>(
      "begin_workspace_conversion_queue",
      { handles, conflictPolicy, intentId },
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
  retryConversions: () =>
    invoke<WorkspaceConversionUpdate>(
      "retry_workspace_conversion_queue",
      {},
      { headers: { [DOCUMENT_AUTHORITY_HEADER]: currentDocumentAuthority() } },
    ),
  stopConversion: (operationId) =>
    invoke<WorkspaceConversionUpdate>(
      "stop_workspace_conversion_queue",
      { operationId },
      { headers: { [DOCUMENT_AUTHORITY_HEADER]: currentDocumentAuthority() } },
    ),
  adoptConversionOutputs: (operationId) =>
    invoke<WorkspaceOutputAdoptionResult>(
      "adopt_workspace_conversion_outputs",
      { operationId },
      { headers: { [DOCUMENT_AUTHORITY_HEADER]: currentDocumentAuthority() } },
    ),
  exportConversionDiagnostics: (operationId, onReserved) => {
    const invokeOptions = {
      headers: { [DOCUMENT_AUTHORITY_HEADER]: currentDocumentAuthority() },
    };
    return invoke<DiagnosticsReservation>(
      "begin_workspace_conversion_diagnostics_export",
      { operationId },
      invokeOptions,
    ).then((reservation) => {
      const saved = invoke<WorkspaceConversionUpdate>(
        "save_workspace_conversion_diagnostics",
        { reservationId: reservation.reservationId },
        invokeOptions,
      );
      onReserved();
      return saved;
    });
  },
  exportSelectedSpectrum: (exportToken, format, range, settings) =>
    invoke<string>("begin_selected_spectrum_export", {
      exportToken,
      format,
      range,
      settings,
    }).then((reservationId) =>
      invoke<SpectrumExportOutcome>("save_selected_spectrum_export", { reservationId }),
    ),
  copySelectedSpectrumPlot: (exportToken, range, settings) =>
    invoke<SpectrumCopyOutcome>("copy_selected_spectrum_plot", { exportToken, range, settings }),
  projectSelectedSpectrum: (exportToken, low, high) =>
    invoke<SpectrumProjection>("project_selected_spectrum", { exportToken, low, high }),
  exportChromatogram: (exportToken, format, range, traces, settings) =>
    invoke<string>("begin_chromatogram_export", {
      exportToken,
      format,
      range,
      traces,
      settings,
    }).then((reservationId) =>
      invoke<ChromatogramExportOutcome>("save_chromatogram_export", { reservationId }),
    ),
  copyChromatogramPlot: (exportToken, range, traces, settings) =>
    invoke<ChromatogramCopyOutcome>("copy_chromatogram_plot", {
      exportToken,
      range,
      traces,
      settings,
    }),
  exportLinkedFigure: (chromatogramToken, spectrumToken, format, range, traces, settings) =>
    invoke<string>("begin_linked_figure_export", {
      chromatogramToken,
      spectrumToken,
      format,
      range,
      traces,
      settings,
    }).then((reservationId) =>
      invoke<LinkedFigureExportOutcome>("save_linked_figure_export", { reservationId }),
    ),
  copyLinkedPlot: (chromatogramToken, spectrumToken, range, traces, settings) =>
    invoke<LinkedFigureCopyOutcome>("copy_linked_plot", {
      chromatogramToken,
      spectrumToken,
      range,
      traces,
      settings,
    }),
};

const PreviewApiContext = createContext<PreviewApi>(tauriPreviewApi);

export const PreviewApiProvider = PreviewApiContext.Provider;

export function usePreviewApi(): PreviewApi {
  return useContext(PreviewApiContext);
}
