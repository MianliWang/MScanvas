import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { usePreviewApi } from "./api";
import type { ConversionOperation } from "./useConversionOperation";
import { useConversionOperation } from "./useConversionOperation";
import type {
  BackendAvailability,
  ChromatogramExportFormat,
  ChromatogramRange,
  ChromatogramRangeScope,
  ChromatogramTraceSet,
  CopiedFigure,
  ExportedFigure,
  FigureSettings,
  FigureTheme,
  Preview,
  PreviewError,
  SelectedFile,
  SelectedSpectrum,
  SpectrumExportFormat,
  SpectrumRow,
  WorkspaceDropRejectionReason,
  WorkspaceDropUpdate,
  WorkspaceOutputAdoptionResult,
} from "./contracts";
import { toPreviewError } from "./contracts";
import { describeDropResult } from "./dropNotice";
import { useWorkspaceDropTransport } from "./dropTransport";
import { describeFolderResult } from "./folderNotice";
import {
  appendMeasurement,
  now,
  type PreviewMeasurement,
  type PreviewMeasurementName,
} from "./instrumentation";
import {
  describeAddResult,
  describeClear,
  describeRemoveResult,
  initialRosterState,
  rosterReducer,
  rowStateForError,
  type RosterAction,
  type RosterState,
  type WorkspaceNotice,
} from "./rosterSelection";
import type { ViewerEvent, ViewerInteractionState } from "./viewer/interactionState";
import { buildPreviewScanModel } from "./viewer/previewScanModel";
import type { RetentionTimeDomain, ScanModel, TraceKind } from "./viewer/scanModel";
import { adjacentScan } from "./viewer/scanModel";
import { useViewerInteraction } from "./viewer/useViewerInteraction";

/**
 * Every typed failure that means the backend is not the one that read what is
 * on screen.
 *
 * `installation_changed_since_preview` is the service noticing before it
 * launches; `backend_changed_after_check` is the crate noticing between the
 * check and the spawn; `backend_not_found_at_launch` is the executable being
 * gone by the time it was run. Three routes, one meaning to a reader -- what is
 * on screen was read by something that is no longer there -- and all three are
 * non-retryable, so all three get the same recovery.
 */
const BACKEND_CHANGED_KINDS = new Set([
  "installation_changed_since_preview",
  "backend_changed_after_check",
  "backend_not_found_at_launch",
]);

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

/**
 * What the selected spectrum's one export is doing.
 *
 * One at a time, because Rust holds one export slot and a second request while
 * a native save dialog is open is refused there. Keeping the same rule here is
 * what stops the interface offering an action that is already known to fail.
 *
 * `cancelled` is a resting state rather than an error: the dialog was shown and
 * dismissed, nothing was created, and the spectrum on screen is exactly as it
 * was.
 */
/**
 * The figure this application exports when nobody changes anything.
 *
 * The same figure M4.1 shipped, so a user who never opens these controls keeps
 * getting exactly the document they used to. Rust holds the same defaults and
 * is the authority on them; these are what the fields start showing.
 */
export const DEFAULT_FIGURE_WIDTH = 1_200;
export const DEFAULT_FIGURE_HEIGHT = 640;
export const DEFAULT_PNG_DPI = 300;

/**
 * The settings a data export travels with.
 *
 * Nothing reads them: Rust validates and applies figure settings only for the
 * formats that are figures. They exist because the transport is uniform, and
 * this names the value rather than leaving a reader to wonder which figure a
 * CSV was written at.
 */
const DEFAULT_FIGURE_SETTINGS: FigureSettings = {
  widthPx: DEFAULT_FIGURE_WIDTH,
  heightPx: DEFAULT_FIGURE_HEIGHT,
  pngDpi: DEFAULT_PNG_DPI,
  theme: "light",
};

/**
 * The rows the linked views walk while nothing is loaded.
 *
 * A shared frozen array rather than a fresh `[]` each render, so the memoized
 * work downstream of it does not invalidate on every pass.
 */
const EMPTY_ROWS: readonly SpectrumRow[] = Object.freeze([]);

/**
 * The scientific model while no preview is loaded.
 *
 * One shared object, so the lifecycle effect below can compare by identity
 * and a render that changed nothing else announces nothing.
 */
const UNLOADED_SCAN_MODEL: ScanModel = { status: "unavailable", reason: "no-spectra" };

/** Which chromatogram traces are drawn. A viewer preference, never written down. */
export interface TraceVisibility {
  readonly tic: boolean;
  readonly bpc: boolean;
}

/**
 * What the viewer starts showing.
 *
 * TIC alone. Both traces at once is a comparison a reader asks for rather than
 * the first thing they should have to disentangle, and the total ion current is
 * the summary of a scan rather than one feature of it.
 */
const INITIAL_TRACES: TraceVisibility = { tic: true, bpc: false };

/**
 * What a selection needs before it can look at a target at all.
 *
 * The four facts `selectSpectrum` reads before it has considered *which* row
 * was asked for. They are about the lane rather than about the row: a run to
 * select from, a backend worth launching, and neither of the two things that
 * own the one backend lane already doing so.
 */
export interface SpectrumSelectionLane {
  /** Whether a run's spectrum table is loaded to select a row of. */
  readonly hasLoadedPreview: boolean;
  /** Whether this session's own verdict says the backend can be launched. */
  readonly backendUsable: boolean;
  /** Whether an installation check or change owns the backend lane. */
  readonly backendBusy: boolean;
  /** Whether a conversion owns it. */
  readonly conversionBusy: boolean;
}

/**
 * Whether a selection could reach its target-specific checks right now.
 *
 * One rule with two readers, and that is the whole reason it is a function.
 * The operation asks it from refs, inside a handler that may be several
 * commits older than the truth; the interface asks it from rendered state, to
 * decide whether a control may advertise itself as available. Two handwritten
 * expressions that merely looked alike is how a button came to say a scan step
 * was available for the length of a conversion queue and do nothing when it
 * was pressed.
 *
 * Deliberately **not** in it:
 *
 * - whether an adjacent row exists, or the requested row is in the table, or
 *   that exact row is already being read. Those are questions about a target,
 *   and a control that had to predict them would be predicting a different
 *   thing for every target;
 * - whether another selected-spectrum read is unresolved. A newer selection of
 *   a *different* scan is allowed to supersede an older one -- that is the
 *   contract `spectrumToken` exists for, and disabling a scan step for it
 *   would take away a step the operation would have accepted. It is why this
 *   is not `canPreview`, which includes exactly that and several policies
 *   belonging to other actions.
 */
export function canStartSpectrumSelection(lane: SpectrumSelectionLane): boolean {
  return (
    lane.hasLoadedPreview &&
    lane.backendUsable &&
    !lane.backendBusy &&
    !lane.conversionBusy
  );
}

/** Whether this format is drawn rather than written. */
function isFigureFormat(format: SpectrumExportFormat): boolean {
  return format === "svg" || format === "png";
}

/** Whether this chromatogram format is drawn rather than written. */
function isChromatogramFigureFormat(format: ChromatogramExportFormat): boolean {
  return format === "svg" || format === "png";
}

/**
 * What the one figure-operation lane is doing, named the way the panel says it.
 *
 * One label rather than two parallel busy flags, because Rust has one lane: a
 * copy and a save cannot both be running, and a model that could represent them
 * both running would be a model that can disagree with the backend.
 */
export type FigureOperation = SpectrumExportFormat | "copy";

export type SpectrumExportState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly operation: FigureOperation }
  | { readonly status: "cancelled" }
  | {
      readonly status: "saved";
      readonly format: SpectrumExportFormat;
      readonly fileName: string;
      /** What the figure was rendered as. `null` for the data documents. */
      readonly figure: ExportedFigure | null;
      readonly pointCount: number;
    }
  | {
      readonly status: "copied";
      /** A size and a theme. A clipboard image records no resolution. */
      readonly figure: CopiedFigure;
      readonly pointCount: number;
    }
  | {
      readonly status: "failed";
      readonly operation: FigureOperation;
      readonly error: PreviewError;
    };

/**
 * Where one chromatogram export is.
 *
 * The same shape a spectrum export has, plus the two facts that make a
 * chromatogram export what it is: how much of the run it covered, and -- for a
 * data document -- how many source scans that turned out to be.
 */
export type ChromatogramExportState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly operation: FigureOperation }
  | { readonly status: "cancelled" }
  | {
      readonly status: "saved";
      readonly format: ChromatogramExportFormat;
      readonly fileName: string;
      readonly figure: ExportedFigure | null;
      readonly rangeScope: ChromatogramRangeScope;
      readonly rangeLow: number;
      readonly rangeHigh: number;
      readonly sourceScanCount: number;
      /** How many source scans the data document holds. `null` for a figure. */
      readonly rowCount: number | null;
    }
  | {
      readonly status: "copied";
      readonly figure: CopiedFigure;
      readonly rangeScope: ChromatogramRangeScope;
      readonly rangeLow: number;
      readonly rangeHigh: number;
      readonly sourceScanCount: number;
    }
  | {
      readonly status: "failed";
      readonly operation: FigureOperation;
      readonly error: PreviewError;
    };

/**
 * The figure settings as the user is editing them.
 *
 * Text rather than numbers, because a half-typed field is a real state a person
 * passes through and a model that can only hold numbers has to invent one for
 * it -- usually by snapping the value, which moves the cursor and fights the
 * user. What crosses to Rust is the parsed form, and only when there is one.
 */
export interface FigureSettingsDraft {
  readonly widthPx: string;
  readonly heightPx: string;
  readonly pngDpi: string;
  readonly theme: FigureTheme;
}

/** Which field of the figure settings a change is about. */
export type FigureSettingsField = "widthPx" | "heightPx" | "pngDpi";

/**
 * What every figure output is drawn with: a size and a theme.
 *
 * The resolution is deliberately not in here, and the split is the whole point.
 * PNG is the only output that records one -- an SVG has no pixels to give a
 * physical size to, and a clipboard image is RGBA with nowhere for a `pHYs`
 * chunk -- so a resolution nobody could use must close the PNG button and leave
 * `Export SVG…` and `Copy plot` exactly where they were. Rust draws the same
 * line, in the same two types.
 */
export interface FigureRenderSettings {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly theme: FigureTheme;
}

/**
 * Reads one field, accepting only a whole positive count.
 *
 * Shape only. Whether 4 is too small a width and whether 40,000 is too large a
 * one are Rust's questions, and it answers them with a refusal that names the
 * correction -- duplicating those bounds here would be a second copy to drift.
 * What this catches is what the interface can know on its own: blank, not a
 * number, negative, fractional, zero.
 */
function wholeCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The figure these fields describe, if they describe one. */
export function resolveRenderSettings(draft: FigureSettingsDraft): FigureRenderSettings | null {
  const widthPx = wholeCount(draft.widthPx);
  const heightPx = wholeCount(draft.heightPx);
  if (widthPx === null || heightPx === null) {
    return null;
  }
  return { widthPx, heightPx, theme: draft.theme };
}

/** The physical resolution this field describes, if it describes one. */
export function resolvePngDpi(draft: FigureSettingsDraft): number | null {
  return wholeCount(draft.pngDpi);
}

/**
 * The settings one operation travels with.
 *
 * The transport is uniform -- every figure command takes the same object -- so
 * a resolution has to be in it even for the outputs that record none. Rust
 * reads `pngDpi` for the PNG export and for nothing else, which is what makes
 * the stand-in here harmless: an SVG or a copy sent beside an unusable DPI
 * carries the default, and nothing on either side looks at it.
 */
function figureSettingsFor(
  render: FigureRenderSettings,
  pngDpi: number | null,
): FigureSettings {
  return { ...render, pngDpi: pngDpi ?? DEFAULT_PNG_DPI };
}

/** What is wrong with the size and theme, in the words the panel reads out. */
export function describeRenderSettingsProblem(draft: FigureSettingsDraft): string | null {
  const wrong = (
    [
      ["widthPx", "Width"],
      ["heightPx", "Height"],
    ] as const
  )
    .filter(([field]) => wholeCount(draft[field]) === null)
    .map(([, label]) => label);
  if (wrong.length === 0) {
    return null;
  }
  return `${wrong.join(", ")} must be a whole number of at least 1.`;
}

/**
 * What is wrong with the resolution, said separately.
 *
 * Separately because it closes a different set of actions. One sentence naming
 * every unusable field would be read out beside `Export SVG…` while that button
 * is live, which would leave a user looking for the setting stopping an action
 * that nothing is stopping.
 */
export function describePngDpiProblem(draft: FigureSettingsDraft): string | null {
  return resolvePngDpi(draft) === null ? "PNG DPI must be a whole number of at least 1." : null;
}

export type RosterLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "failed"; readonly error: PreviewError };

/** What the native drop overlay has to render, and no filesystem detail. */
export type DropPresentation =
  | { readonly status: "idle" }
  | { readonly status: "hovering"; readonly itemCount: number }
  | { readonly status: "importing"; readonly itemCount: number };

export type DropSubscriptionStatus = "connecting" | "available" | "unavailable";

export interface PreviewWorkspace {
  /**
   * The session's one conversion, as this document sees it.
   *
   * Its own lane, with its own tokens and its own authoritative read. It is
   * composed here rather than inlined so that everything about a conversion --
   * the slot, the poll, the staleness rule -- lives in one module a reader can
   * hold in their head.
   */
  readonly conversion: ConversionOperation;
  readonly backend: BackendState;
  readonly preview: PreviewState;
  readonly spectrum: SpectrumState;
  /**
   * The scientific model of the loaded run, or the reason there is none.
   *
   * Derived from the preview on screen rather than fetched, held as a second
   * copy of the table, or rebuilt by anything a pointer does. Nothing in it is
   * a drawing: see `viewer/scanModel.ts`.
   */
  readonly scanModel: ScanModel;
  /**
   * The one interaction state: committed viewport, transient gesture,
   * persistent selection, selection revision and hover.
   *
   * ADR 0032 owns every rule inside it. What lives here is the single instance
   * of it that the visible viewer reads and dispatches into.
   */
  readonly viewerInteraction: ViewerInteractionState;
  /**
   * Applies one interaction event, and answers with the state it produced.
   *
   * The answer is what a wheel or a drag adapter reads its reducer-assigned
   * epoch out of. No caller allocates an epoch or a selection revision.
   */
  readonly dispatchViewerEvent: (event: ViewerEvent) => ViewerInteractionState;
  /**
   * The interaction state as it stands right now.
   *
   * For a native listener, which runs between renders and would otherwise
   * decide from whatever the state was when its closure was made. It reads the
   * same held value {@link dispatchViewerEvent} writes, so it is a second
   * reader rather than a second authority.
   */
  readonly readViewerInteraction: () => ViewerInteractionState;
  /**
   * The scan the session has selected, projected from the interaction state.
   *
   * Not a second field that something has to keep in step with it: there is one
   * persistent selection, it lives in {@link viewerInteraction}, and this is a
   * read of it.
   */
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
  /**
   * Whether a preview or spectrum request initiated from here is unresolved.
   *
   * Curating the roster stays live throughout — focus, selection, adding,
   * removing and clearing are not backend work — but a second explicit preview
   * activation waits, so rapid activation cannot queue one process per row
   * behind the single backend gate. Rust's per-dataset request epochs are the
   * correctness boundary; this only stops the queue forming.
   */
  readonly previewBackendBusy: boolean;
  /** Whether a picker is on screen, so a second one is not opened over it. */
  readonly pickerBusy: boolean;
  /**
   * Whether a folder import is unresolved, from the picker opening to the reply
   * settling.
   *
   * The whole operation, not the picker half of it: the dialog, the scan, the
   * acceptance of every candidate, the commit, and the answer landing here.
   * Deliberately not part of `canPreview` or `previewBackendBusy` — a scan
   * launches no process, and taking the viewer away for the length of a folder
   * walk would make the one thing the user is looking at hostage to a list
   * operation.
   */
  readonly folderBusy: boolean;
  /**
   * Whether the baseline-reservation request has been dispatched but its reply
   * has not yet let the exact claim request be dispatched.
   *
   * Clear and Remove wait only for this short edge. Once it arrives they are
   * available throughout the native picker and scan.
   */
  readonly folderReservationPending: boolean;
  /** Whether one accepted native Explorer drop is still being inspected. */
  readonly dropBusy: boolean;
  /** The path-free state rendered by the shell overlay. */
  readonly dropPresentation: DropPresentation;
  /**
   * Increments for every rejected second drop so identical guidance is spoken
   * again without replacing the current import state.
   */
  readonly dropRejectedToken: number;
  /** Why the last drop was refused, for the sentence that says so. */
  readonly dropRejectedReason: WorkspaceDropRejectionReason;
  /** Whether this document currently owns the native Explorer-drop Channel. */
  readonly dropSubscriptionStatus: DropSubscriptionStatus;
  /** A Channel registration failure, separate from any accepted Drop failure. */
  readonly dropSubscriptionError: PreviewError | null;
  readonly retryDropSubscription: () => void;
  /** Whether a roster mutation is unresolved. */
  readonly workspaceBusy: boolean;
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

  /** Everything the session holds, and which rows are focused, selected and shown. */
  readonly roster: RosterState;
  readonly rosterLoad: RosterLoadState;
  /**
   * Increments only after an authoritative roster answer has been applied.
   *
   * A rejected mutation may have changed Rust before its reply was lost, so
   * becoming idle is not settlement. Focus recovery uses this edge to wait for
   * the owed reconciliation instead of deciding against a stale roster.
   */
  readonly rosterSettlementToken: number;
  readonly reloadRoster: () => void;
  /** The row whose preview is on screen or was explicitly asked for. */
  readonly activeDataset: SelectedFile | null;
  /** Moves focus and selection without starting any backend work. */
  readonly dispatchRoster: (action: RosterAction) => void;
  /** Shows the native picker and adds every file chosen. */
  readonly addFiles: () => void;
  /**
   * Shows the native folder picker and adds every mzML file found beneath the
   * folder chosen. Starts no backend work for any of them.
   */
  readonly addFolder: () => void;
  readonly removeSelected: () => void;
  /** Clears the roster and reports whether this call acquired the mutation gate. */
  readonly clearList: () => boolean;
  /** Explicitly reads one dataset. The only thing that starts a preview. */
  readonly activateDataset: (handle: string) => void;
  /** Reads the active dataset again, after a failure or a backend change. */
  readonly previewActiveAgain: () => void;
  /** A bounded account of the last workspace action, for display and for a live region. */
  readonly workspaceNotice: WorkspaceNotice | null;
  readonly dismissWorkspaceNotice: () => void;
  /** Increments whenever focus should return to the `Add files…` action. */
  readonly focusAddFilesToken: number;

  /**
   * A picker that failed to open. Kept apart from `preview` because failing to
   * choose new files is no reason to take away what is already on screen.
   */
  readonly pickerError: PreviewError | null;
  readonly dismissPickerError: () => void;
  /**
   * A folder import that failed, at any point from the picker to the commit.
   *
   * Its own channel rather than the workspace one, because the roster was not
   * changed: a folder that could not be scanned, or a scan a later decision
   * superseded, leaves the session exactly as it was. Path-free, like every
   * error that crosses this boundary.
   */
  readonly folderError: PreviewError | null;
  readonly dismissFolderError: () => void;
  /** One accepted native drop failed. */
  readonly dropError: PreviewError | null;
  readonly dismissDropError: () => void;
  /** A workspace mutation that failed. The roster is left as Rust last said. */
  readonly workspaceError: PreviewError | null;
  readonly dismissWorkspaceError: () => void;
  readonly selectSpectrum: (index: number) => void;
  readonly retrySpectrum: () => void;
  /**
   * What the selected spectrum's one export is doing.
   *
   * Reset whenever a different spectrum is loaded, so a result never outlives
   * the measurement it describes.
   */
  readonly spectrumExport: SpectrumExportState;
  /**
   * Whether the session's one scientific export lane is occupied.
   *
   * One answer for both surfaces, because Rust has one lane: while a
   * chromatogram is being saved or copied the selected spectrum's actions are
   * unavailable, and while a spectrum is being saved or copied the
   * chromatogram's are. Derived from the two export states rather than stored
   * beside them, so it cannot drift from either.
   *
   * Availability only. Neither surface shows the other's result or the other's
   * status message: what is shared is the lane, not what happened in it.
   */
  readonly scientificExportBusy: boolean;
  /**
   * The opaque name of the chromatogram this run may be exported as.
   *
   * `null` where Rust issued none, which is exactly where the viewer draws no
   * chromatogram. Nothing on this side decides it.
   */
  readonly chromatogramExportToken: string | null;
  /** How much of the run the next chromatogram export will cover. */
  readonly chromatogramRangeScope: ChromatogramRangeScope;
  readonly setChromatogramRangeScope: (scope: ChromatogramRangeScope) => void;
  /**
   * The committed retention-time range, or `null` where none is committed.
   *
   * The **committed** one, and deliberately not what a wheel or a drag is
   * transiently showing: an export invoked mid-gesture writes the last range
   * the user settled on, and the gesture is neither settled nor cancelled by
   * having been exported over.
   */
  readonly chromatogramCommittedDomain: RetentionTimeDomain | null;
  readonly chromatogramExport: ChromatogramExportState;
  readonly exportChromatogram: (format: ChromatogramExportFormat) => void;
  readonly copyChromatogramPlot: () => void;
  readonly dismissChromatogramExport: () => void;
  /**
   * Exports the loaded selected spectrum as one file.
   *
   * Binds the token the loaded spectrum carries at the moment it is invoked, so
   * what is written is the spectrum the user was looking at. Nothing about the
   * preview changes: exporting a spectrum is not selecting one, and the panel
   * is exactly as it was when the dialog closes however it closes.
   */
  readonly exportSpectrum: (format: SpectrumExportFormat) => void;
  /**
   * Puts the loaded selected spectrum's figure on the system clipboard.
   *
   * The same figure a PNG export writes, and the same binding: what is copied
   * is the spectrum the user was looking at. No file, no dialog, no path.
   */
  readonly copySpectrumPlot: () => void;
  /** Returns the export to rest after a result has been read. */
  readonly dismissSpectrumExport: () => void;
  /** Which chromatogram traces are drawn. Session state, never written down. */
  readonly chromatogramTraces: TraceVisibility;
  readonly toggleChromatogramTrace: (trace: TraceKind) => void;
  /**
   * The scan before or after the selected one, in the order the table shows.
   *
   * Table order rather than arithmetic on the index, and committed through the
   * same `selectSpectrum` operation the table and the plot use -- so there is
   * still one selected scan and one backend read per selection.
   */
  readonly selectPreviousScan: () => void;
  readonly selectNextScan: () => void;
  /**
   * Whether a selection could reach its target-specific checks right now.
   *
   * The rendered reading of the same rule `selectSpectrum` guards itself with.
   * A control that advertises availability has to tell the truth about the
   * lane; what it cannot be asked to predict is a target -- whether a
   * particular row is in the table, or is already being read.
   */
  readonly spectrumSelectionAvailable: boolean;
  /**
   * Whether a scan step can act: the lane, and a row to step to.
   *
   * Both halves. Adjacency alone left the buttons enabled and silently inert
   * for the length of a conversion queue.
   */
  readonly canSelectPreviousScan: boolean;
  readonly canSelectNextScan: boolean;
  /** The figure settings as the user is editing them. */
  readonly figureSettings: FigureSettingsDraft;
  /** The figure they describe, or `null` while they describe none. */
  readonly resolvedRenderSettings: FigureRenderSettings | null;
  /** The resolution they describe, or `null` while they describe none. */
  readonly resolvedPngDpi: number | null;
  /**
   * What is wrong with the size or theme, in words a panel can read out.
   *
   * Two problems rather than one, because they close different actions: this
   * one stops every figure, and the resolution stops only the PNG.
   */
  readonly renderSettingsProblem: string | null;
  /** What is wrong with the resolution, which only the PNG export reads. */
  readonly pngDpiProblem: string | null;
  readonly setFigureSetting: (field: FigureSettingsField, value: string) => void;
  readonly setFigureTheme: (theme: FigureTheme) => void;
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
  const dropTransport = useWorkspaceDropTransport();

  const [backend, setBackend] = useState<BackendState>({ status: "checking" });
  const [preview, setPreview] = useState<PreviewState>({ status: "empty" });
  const [pickerError, setPickerError] = useState<PreviewError | null>(null);
  const [workspaceError, setWorkspaceError] = useState<PreviewError | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumState>({ status: "none" });
  /**
   * The session's one viewer interaction, and the only selection authority.
   *
   * Held here rather than inside a component because the selection is committed
   * from three places -- the plot, the scan table, Previous and Next -- and all
   * three go through `selectSpectrum` below, where the request guards are. A
   * component-level copy of any part of it would be the second authority ADR
   * 0032 exists to make unrepresentable.
   */
  const viewer = useViewerInteraction();
  const { dispatch: dispatchViewerEvent, current: readViewerInteraction } = viewer;
  /**
   * The selected scan, read from the one place it is decided.
   *
   * Projected rather than stored. A second `useState` beside the reducer would
   * be a second writable answer to the same question, and the two would
   * eventually disagree about which scan a linked view is pointing at.
   */
  const selectedIndex = viewer.state.selection?.index ?? null;
  const [chromatogramTraces, setChromatogramTraces] =
    useState<TraceVisibility>(INITIAL_TRACES);
  const [measurements, setMeasurements] = useState<readonly PreviewMeasurement[]>([]);

  const [roster, dispatchRoster] = useReducer(rosterReducer, initialRosterState);
  const [rosterLoad, setRosterLoadState] = useState<RosterLoadState>({ status: "loading" });
  /**
   * Whether this window has an authoritative list, where a start guard can read
   * it.
   *
   * A ref rather than the rendered value, for the same reason every other guard
   * here is one: the decision is made inside a handler that can be several
   * commits older than the truth.
   */
  const rosterReadyRef = useRef(false);
  const showRosterLoad = useCallback((next: RosterLoadState) => {
    rosterReadyRef.current = next.status === "ready";
    setRosterLoadState(next);
  }, []);
  const [workspaceNotice, setWorkspaceNotice] = useState<WorkspaceNotice | null>(null);
  /**
   * How many accounts of a workspace action there have been.
   *
   * Two actions of the same shape say the same sentence, and a live region
   * whose text does not change has nothing to announce. Stamping each account
   * with its place in the sequence is what lets the spoken half differ when the
   * words do not.
   */
  const noticeSequence = useRef(0);
  const showWorkspaceNotice = useCallback((notice: WorkspaceNotice) => {
    noticeSequence.current += 1;
    setWorkspaceNotice({ ...notice, sequence: noticeSequence.current });
  }, []);
  const [focusAddFilesToken, setFocusAddFilesToken] = useState(0);
  /**
   * The roster where a promise handler can read it.
   *
   * A handler closing over the rendered value would see whatever it was when
   * the closure was made, which for a request spanning a modal picker is
   * exactly the wrong answer.
   */
  const rosterRef = useRef(roster);
  // Written during the render whose value it mirrors, not in an effect. An
  // effect would leave it one commit behind, and a picker reply landing in that
  // gap would decide "was the workspace empty" from the workspace before the
  // last change.
  rosterRef.current = roster;

  const [backendBusy, setBackendBusy] = useState(true);
  /**
   * The same flag where a promise handler can read it.
   *
   * `backendBusy` renders; this decides. A callback closing over the state
   * value would see whatever it was when the closure was made, which for a
   * request spanning a modal dialog is exactly the wrong answer.
   */
  const backendBusyRef = useRef(true);
  const markBackendBusy = useCallback((busy: boolean) => {
    backendBusyRef.current = busy;
    setBackendBusy(busy);
  }, []);
  /**
   * Whether the backend is positively known to be usable, where a promise
   * handler can read it.
   *
   * Written with the state rather than after it. Derived in an effect this
   * would be one commit behind, and the reply that decides whether to read the
   * first file of a new session can arrive inside that gap.
   */
  const backendUsableRef = useRef(false);
  const showBackend = useCallback((next: BackendState) => {
    backendUsableRef.current =
      next.status === "resolved" && next.availability.state === "available";
    setBackend(next);
  }, []);

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
  /**
   * The open between its request and its reply, named by token and by row.
   *
   * A boolean could only say that some open was in flight, so a reply for a row
   * the user had left could clear the marker belonging to the one they were
   * waiting for. What a verdict needs to know is whether an open is about to
   * fill the screen — it has already emptied it — and what a removal needs to
   * know is whether the open still belongs to a row that exists.
   */
  const activeOpen = useRef<{ token: number; handle: string } | null>(null);
  /**
   * How many preview or spectrum requests have been started and not settled.
   *
   * A count rather than a flag, so a stale promise settling decrements its own
   * request and never clears the marker a newer one is relying on. Removing the
   * active row clears the screen at once but leaves this alone: the process is
   * still running, and reporting the lane idle would let a second activation
   * queue behind it — which is the fan-out the roster makes possible.
   */
  const viewerRequests = useRef(0);
  const [previewBackendBusy, setPreviewBackendBusy] = useState(false);
  const beginViewerRequest = useCallback(() => {
    viewerRequests.current += 1;
    setPreviewBackendBusy(true);
  }, []);
  const endViewerRequest = useCallback(() => {
    viewerRequests.current = Math.max(0, viewerRequests.current - 1);
    setPreviewBackendBusy(viewerRequests.current > 0);
  }, []);

  const [pickerBusy, setPickerBusy] = useState(false);
  const pickerBusyRef = useRef(false);
  const [folderBusy, setFolderBusy] = useState(false);
  /**
   * The same flag where a promise handler and a start guard can read it.
   *
   * A folder import spans a modal dialog and a filesystem walk, so a callback
   * closing over the rendered value would decide "is one already running" from
   * whatever was true when the closure was made.
   */
  const folderBusyRef = useRef(false);
  const [folderReservationPending, setFolderReservationPending] = useState(false);
  /**
   * The synchronous half of the reservation acknowledgement barrier.
   *
   * A rendered disabled state cannot close the interval between a click and
   * React's next commit. Clear and Remove read this ref inside their own
   * handlers, so neither can cross IPC until the begin reply has dispatched
   * the exact claim.
   */
  const folderReservationPendingRef = useRef(false);
  const [folderError, setFolderError] = useState<PreviewError | null>(null);
  /**
   * Which folder import owns the busy state, the notice and the error.
   *
   * The start guard above already makes two of these non-overlapping, so this
   * is what keeps that true rather than what makes it true: settlement is
   * claimed by the request that started it, so nothing an older request does on
   * its way out can clear a newer one's marker or install its account.
   */
  const folderToken = useRef(0);
  const [dropBusy, setDropBusy] = useState(false);
  const dropBusyRef = useRef(false);
  const [dropPresentation, setDropPresentation] = useState<DropPresentation>({
    status: "idle",
  });
  const [dropRejectedToken, setDropRejectedToken] = useState(0);
  /**
   * Why the last drop was refused.
   *
   * Beside the token rather than folded into it, because the token's job is to
   * re-announce an identical sentence and this decides which sentence it is.
   */
  const [dropRejectedReason, setDropRejectedReason] =
    useState<WorkspaceDropRejectionReason>("drop_busy");
  const [dropError, setDropError] = useState<PreviewError | null>(null);
  const [dropSubscriptionStatus, setDropSubscriptionStatus] =
    useState<DropSubscriptionStatus>("connecting");
  const [dropSubscriptionError, setDropSubscriptionError] = useState<PreviewError | null>(null);
  const [dropSubscriptionAttempt, setDropSubscriptionAttempt] = useState(0);
  const dropSubscriptionPendingRef = useRef(true);
  /**
   * The accepted drop that owns importing state and any terminal adoption.
   * A newer workspace decision changes `workspaceMutations`, so this record's
   * snapshot becomes an immediate late-result barrier.
   */
  const activeDrop = useRef<{
    readonly operationId: string;
    readonly mutationsAtStart: number;
    readonly startedAt: number;
  } | null>(null);
  const dropSubscriptionEpoch = useRef(0);
  const lastDropSequence = useRef(-1);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const workspaceBusyRef = useRef(false);
  const [rosterSettlementToken, setRosterSettlementToken] = useState(0);
  /**
   * How many authoritative workspace-changing decisions have begun.
   *
   * Native drop acceptance, `Remove selected` and `Clear list` all advance the
   * same frontend ordering line. Remove/Clear hide an older folder or drop
   * reply as soon as the request starts; accepting a native drop likewise
   * hides a folder reply that began before it.
   *
   * A rejected mutation has no authoritative roster to replace the hidden
   * folder reply, and rejection does not prove that Rust was unchanged. Such a
   * request records a reconciliation debt instead; after both operations have
   * settled a fresh roster read restores the one state Rust actually holds.
   */
  const workspaceMutations = useRef(0);
  const workspaceReconcileOwed = useRef(false);

  const previewToken = useRef(0);
  const spectrumToken = useRef(0);
  const rosterToken = useRef(0);
  const inFlightSpectrum = useRef<{ index: number; token: number } | null>(null);
  /**
   * The loaded run's rows where a handler can read them.
   *
   * A selection commit has to say which retention time it is at, and the answer
   * comes from the table that is loaded now. A callback closing over the
   * rendered value would answer from the table that was loaded when the closure
   * was made -- which for a click that arrives during a preview change is
   * exactly the wrong table.
   */
  const previewRowsRef = useRef<readonly SpectrumRow[]>(EMPTY_ROWS);
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
   * Takes the current preview off the screen without claiming the backend has
   * finished with it.
   *
   * The tokens move, so nothing still in flight can land; the outstanding count
   * does not, because the process is still running and a second activation
   * queued behind it would be the fan-out this bounds.
   */
  const clearVisiblePreview = useCallback(() => {
    previewToken.current += 1;
    spectrumToken.current += 1;
    pendingSpectrumRender.current = null;
    pendingOpenRender.current = null;
    activeOpen.current = null;
    openHandle.current = null;
    setPreview({ status: "empty" });
    setSpectrum({ status: "none" });
    // Everything the viewer holds belongs to the preview that was on screen: a
    // range chosen in one run, a scan selected in it, an observation of what a
    // pointer was over. The event also advances the gesture epoch, so a settle
    // still in flight can never commit into whatever is loaded next -- which is
    // why this does not depend on a timer having been cleared in time.
    dispatchViewerEvent({ type: "preview-closed" });
  }, [dispatchViewerEvent]);

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
   * The roster itself stays, and so does which row was active -- those are
   * Rust's paths and the user's choice, and no backend decided either. Reading
   * one again is one action, and reads nothing until the user asks. Re-reading
   * here would launch a process per row nobody asked for, against an
   * installation that may have just been reported unusable.
   */
  const discardBackendDerivedState = useCallback(() => {
    const handle = openHandle.current;
    clearVisiblePreview();
    // Kept, unlike everything a backend produced: it is the row an explicit
    // "read this again" acts on.
    openHandle.current = handle;
    dispatchRoster({ type: "previewDiscarded" });
  }, [clearVisiblePreview]);

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
      showBackend({ status: "resolved", availability });
      // Not while an open is in flight. That open has already emptied the
      // screen and is about to fill it, and its reply is judged on its own
      // generation when it lands -- so discarding here would only reject a
      // reading that may well be the one that caused this verdict.
      if (changed && activeOpen.current === null) {
        discardBackendDerivedState();
      }
      return true;
    },
    [discardBackendDerivedState],
  );

  const checkBackend = useCallback(() => {
    backendToken.current += 1;
    const token = backendToken.current;
    markBackendBusy(true);
    showBackend({ status: "checking" });
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
          showBackend({ status: "failed", error: toPreviewError(cause) });
        }
      })
      .finally(() => {
        if (mounted.current && token === backendToken.current) {
          markBackendBusy(false);
        }
      });
  }, [api, applyVerdict, markBackendBusy]);

  useEffect(checkBackend, [checkBackend]);

  /**
   * Reads what the session already holds.
   *
   * Run after the current document's Drop subscription attempt settles,
   * because a webview can be reloaded while Rust keeps the workspace: the
   * roster on screen has to be the roster that exists, not an empty list this
   * window happens to start with. It launches nothing.
   */
  const readAuthoritativeRoster = useCallback(() => {
    rosterToken.current += 1;
    const token = rosterToken.current;
    showRosterLoad({ status: "loading" });
    void api
      .getRoster()
      .then((loaded) => {
        if (mounted.current && token === rosterToken.current) {
          const hadRows = rosterRef.current.datasets.length > 0;
          const showing = openHandle.current;
          if (
            showing !== null &&
            !loaded.datasets.some((dataset) => dataset.handle === showing)
          ) {
            // A failed mutation can still have changed Rust before its reply
            // was lost. If reconciliation says the shown row no longer exists,
            // every reading derived from it has to leave with it.
            clearVisiblePreview();
          }
          dispatchRoster({ type: "rosterLoaded", roster: loaded });
          setRosterSettlementToken((token) => token + 1);
          showRosterLoad({ status: "ready" });
          if (hadRows && loaded.datasets.length === 0) {
            // A reconciliation can establish that a failed removal actually
            // removed the last row. Reuse the same deferred focus recovery as a
            // successful emptying action; it waits for Add files to be enabled
            // and never overrides a destination the user chose meanwhile.
            setFocusAddFilesToken((token) => token + 1);
          }
        }
      })
      .catch((cause: unknown) => {
        if (mounted.current && token === rosterToken.current) {
          showRosterLoad({ status: "failed", error: toPreviewError(cause) });
        }
      });
  }, [api, clearVisiblePreview, showRosterLoad]);

  const reloadRoster = useCallback(() => {
    // Reading the list back is not the final-empty escape `Clear list` is, nor
    // does it manage known rows as `Remove selected` does. A user-requested read
    // waits for an active import; the subscription-settlement read deliberately
    // calls `readAuthoritativeRoster` directly because Rust orders that snapshot
    // after any current Drop and it is the document's startup authority.
    if (folderBusyRef.current || dropBusyRef.current) {
      return;
    }
    readAuthoritativeRoster();
  }, [readAuthoritativeRoster]);

  /** Starts an owed reconciliation only after both competing operations end. */
  const drainWorkspaceReconciliation = useCallback(() => {
    if (
      !mounted.current ||
      !workspaceReconcileOwed.current ||
      folderBusyRef.current ||
      dropBusyRef.current ||
      workspaceBusyRef.current
    ) {
      return;
    }
    workspaceReconcileOwed.current = false;
    reloadRoster();
  }, [reloadRoster]);

  /**
   * Recovers the authoritative list after a workspace mutation rejects.
   *
   * The folder reply remains suppressed: applying it could expose a snapshot
   * from before a mutation that actually reached Rust but whose reply failed.
   * Rejection records a debt; whichever of the folder and mutation settles last
   * drains it, then lets Rust state the answer directly. Doing this for every
   * rejection also supersedes an older reconciliation read that may have
   * observed the workspace before this request reached Rust.
   */
  const reconcileAfterFailedWorkspaceMutation = useCallback(() => {
    workspaceReconcileOwed.current = true;
    drainWorkspaceReconciliation();
  }, [drainWorkspaceReconciliation]);

  /**
   * Records that the workspace list is known again.
   *
   * Every mutation answers with the roster Rust now holds, which is a newer and
   * more authoritative read than anything `reloadRoster` still has in flight —
   * hence the token, which drops those older replies rather than letting one
   * install a list from before the change. Clearing a failed load matters on
   * its own: without it a read that failed on mount is permanent, and the
   * workspace goes on reporting that its list could not be read long after an
   * action has read it.
   */
  const rosterSettled = useCallback(() => {
    rosterToken.current += 1;
    setRosterSettlementToken((token) => token + 1);
    showRosterLoad({ status: "ready" });
  }, [showRosterLoad]);

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
      markBackendBusy(true);
      if (announceChecking) {
        showBackend({ status: "checking" });
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
            showBackend({ status: "failed", error: toPreviewError(cause) });
            refreshed = true;
          }
        })
        .finally(() => {
          installationChanges.current -= 1;
          if (!mounted.current) {
            return;
          }
          if (token === backendToken.current) {
            markBackendBusy(false);
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
    [applyVerdict, checkBackend, markBackendBusy],
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
      // A new read invalidates any spectrum still in flight, including the
      // guard that stops a row being read twice: that guard is keyed by token,
      // so an abandoned read cannot make the same row index unselectable in the
      // dataset now on screen.
      spectrumToken.current += 1;
      pendingSpectrumRender.current = null;
      pendingOpenRender.current = null;
      setPreview({ status: "opening" });
      setSpectrum({ status: "none" });
      // The preview on screen is being replaced, so its interaction stops being
      // authoritative here rather than when the reply lands. A new one is
      // announced by the lifecycle effect below, once there is a model to
      // announce.
      dispatchViewerEvent({ type: "preview-closed" });
      openHandle.current = handle;
      activeOpen.current = { token, handle };
      // Said here, where a read actually begins, rather than by whatever asked
      // for one. A row is the row being read because it is being read.
      dispatchRoster({ type: "activated", handle });
      dispatchRoster({ type: "rowStateChanged", handle, state: "opening" });
      beginViewerRequest();
      // Where the sequence stood when this read began. A failure carries no
      // generation of its own, so this is the only way to tell an answer about
      // the backend in use from an answer about one that has been replaced.
      const generationAtRequest = appliedGeneration.current;
      void api
        .openPreview(handle)
        .then((loaded) => {
          // Landed, so it is no longer a reply to protect. Cleared before any
          // state is set rather than in a `finally`, which runs a microtask
          // later: a verdict applied in that gap would skip the discard for a
          // preview already on screen, and nothing would come back to it.
          if (activeOpen.current?.token === token) {
            activeOpen.current = null;
          }
          if (!mounted.current || token !== previewToken.current) {
            return;
          }
          // An open is a look at the backend too, and it can be the first thing
          // to see a change — in which case the service advances the sequence
          // while producing this very preview. Adopting that number here is
          // what stops the next verdict's higher number reading as a change
          // that happened afterwards and discarding a reading that is current.
          //
          // Produced by a backend that has since been replaced. The gate is
          // released before a table of this size is converted and transferred,
          // so a folder switch can complete while this is still in flight, and
          // showing it would put the old backend's rows under the new one's
          // banner. Discarded rather than merely dropped: returning here left
          // the workspace reading "Reading the file…" with nothing else coming.
          if (loaded.installationGeneration < appliedGeneration.current) {
            discardBackendDerivedState();
            return;
          }
          const noticedAChange = loaded.installationGeneration > appliedGeneration.current;
          if (noticedAChange) {
            appliedGeneration.current = loaded.installationGeneration;
          }
          setPreview({ status: "loaded", preview: loaded });
          dispatchRoster({ type: "rowStateChanged", handle, state: "loaded" });
          if (noticedAChange) {
            // This open was the first thing to see the change, so the banner
            // still names the installation it replaced -- and would go on doing
            // so beside a preview that came from a different one. Reading it
            // again is the only way to say what is on screen, and it cannot
            // take this preview away: the verdict will carry the generation
            // just adopted, which is not a change after it.
            //
            // Behind an outstanding installation change, like every other
            // recovery here. Racing one would clear the busy guard while a
            // picker is still open, and a chooser reply arriving after this
            // check would be refused on token order -- leaving Rust on the
            // chosen folder and the banner saying automatic.
            if (installationChanges.current > 0) {
              deferredRecheck.current = true;
            } else {
              checkBackend();
            }
          }
          // Not finished here: this call only schedules the update, and the
          // summary and the first table window have not been built yet.
          pendingOpenRender.current = {
            rowCount: loaded.spectrumTable.rows.length,
            startedAt,
          };
        })
        .catch((cause: unknown) => {
          if (activeOpen.current?.token === token) {
            activeOpen.current = null;
          }
          if (!mounted.current || token !== previewToken.current) {
            return;
          }
          // A failure from a backend that has since been replaced says
          // nothing about the one in use, and showing it under the new
          // banner strands the user.
          if (appliedGeneration.current > generationAtRequest) {
            discardBackendDerivedState();
            return;
          }
          const failure = toPreviewError(cause);
          setPreview({ status: "failed", error: failure });
          // What the failure says about the row rather than about the read:
          // the name now points at a different acquisition, or at nothing.
          dispatchRoster({
            type: "rowStateChanged",
            handle,
            state: rowStateForError(failure.kind),
          });
          // The installation may be the reason. Re-checking here keeps the
          // banner from insisting a backend is present after it has gone,
          // which would leave the user with no way back except a restart.
          //
          // Except while the user is changing the installation. This check is
          // not a user action and so passes straight through `backendBusy`,
          // which makes it the one thing that can race a change; and a change
          // is already going to produce a fresh verdict, so racing it buys
          // nothing.
          if (installationChanges.current > 0) {
            deferredRecheck.current = true;
          } else {
            checkBackend();
          }
        })
        .finally(() => {
          // Exactly once per request, whatever happened to it, so a stale
          // promise never reports a newer request's lane idle.
          endViewerRequest();
        });
    },
    [
      api,
      beginViewerRequest,
      checkBackend,
      discardBackendDerivedState,
      dispatchViewerEvent,
      endViewerRequest,
    ],
  );

  /** Clears only the UI ownership of a native drop; it never cancels Rust. */
  const settleDropPresentation = useCallback(() => {
    activeDrop.current = null;
    dropBusyRef.current = false;
    setDropBusy(false);
    setDropPresentation({ status: "idle" });
    setDropRejectedToken(0);
  }, []);

  const applyDropUpdate = useCallback(
    (update: WorkspaceDropUpdate, replayedSnapshot = false) => {
      const state = update.state;
      switch (state.status) {
        case "idle":
          // The native snapshot is authoritative about whether an import is
          // still running. This is also how a Remove/Clear-superseded scan can
          // finish without inventing a misleading completed result.
          settleDropPresentation();
          drainWorkspaceReconciliation();
          return;

        case "hovering":
          // A second physical drag cannot replace the accepted operation's
          // presentation. Rust follows it with `drop_busy`; until then the
          // first operation remains the truthful state.
          if (activeDrop.current !== null) {
            return;
          }
          setDropError(null);
          setDropRejectedToken(0);
          setDropPresentation({ status: "hovering", itemCount: state.itemCount });
          return;

        case "importing": {
          const current = activeDrop.current;
          if (current !== null) {
            if (current.operationId === state.operationId) {
              setDropPresentation({ status: "importing", itemCount: state.itemCount });
            }
            return;
          }
          // Acceptance is an authoritative workspace decision. Advancing this
          // line once suppresses any folder reply that began before the drop,
          // while the snapshot stored here lets a later Remove/Clear suppress
          // this operation in turn.
          workspaceMutations.current += 1;
          activeDrop.current = {
            operationId: state.operationId,
            mutationsAtStart: workspaceMutations.current,
            startedAt: now(),
          };
          dropBusyRef.current = true;
          setDropBusy(true);
          setDropError(null);
          setDropRejectedToken(0);
          setDropPresentation({ status: "importing", itemCount: state.itemCount });
          return;
        }

        case "completed": {
          const current = activeDrop.current;
          if (current === null || current.operationId !== state.operationId) {
            // The command's first message is an exact current-state replay. A
            // Drop can finish after page-load start but before this document
            // claims its Channel, so the authoritative roster read issued when
            // registration settles must recover it. Do not invent a completion
            // notice or auto-preview for work this document never observed.
            if (replayedSnapshot) {
              settleDropPresentation();
            }
            return;
          }
          const ownsAdoption = workspaceMutations.current === current.mutationsAtStart;
          settleDropPresentation();
          if (ownsAdoption) {
            const added = state.result.outcomes.flatMap((outcome) =>
              outcome.outcome === "added" ? [outcome.dataset.handle] : [],
            );
            // A successful terminal roster is newer than an owed read and pays
            // any debt left by an earlier failed mutation.
            workspaceReconcileOwed.current = false;
            dispatchRoster({ type: "dropImported", result: state.result });
            rosterSettled();
            showWorkspaceNotice(describeDropResult(state.result));
            const first = added[0];
            if (
              state.result.summary.workspaceWasEmpty &&
              first !== undefined &&
              backendUsableRef.current &&
              !backendBusyRef.current &&
              viewerRequests.current === 0
            ) {
              loadPreview(first, current.startedAt);
            }
          }
          drainWorkspaceReconciliation();
          return;
        }

        case "failed": {
          const current = activeDrop.current;
          if (current === null || current.operationId !== state.operationId) {
            if (replayedSnapshot) {
              settleDropPresentation();
              setDropError(state.error);
            }
            return;
          }
          const superseded = workspaceMutations.current !== current.mutationsAtStart;
          settleDropPresentation();
          if (!superseded) {
            setDropError(state.error);
          }
          drainWorkspaceReconciliation();
          return;
        }

        case "rejected":
          // A refusal is feedback about the attempted operation, not a
          // transition of the one already running. In particular, do not clear
          // its owner or its busy gate.
          //
          // Both reasons are announced. They are refused for different lengths
          // of time and the user does something different about each — another
          // drop finishes on its own, a conversion is work they started — so a
          // reason with no handling would be a drop that vanished in silence.
          setDropRejectedReason(state.reason);
          setDropRejectedToken((token) => token + 1);
          return;
      }
    },
    [
      drainWorkspaceReconciliation,
      loadPreview,
      rosterSettled,
      settleDropPresentation,
      showWorkspaceNotice,
    ],
  );

  useEffect(() => {
    const epoch = dropSubscriptionEpoch.current + 1;
    dropSubscriptionEpoch.current = epoch;
    lastDropSequence.current = -1;
    let alive = true;
    let unsubscribe: (() => void) | null = null;
    let awaitingSnapshot = true;
    const ownsSubscription = () =>
      alive && mounted.current && dropSubscriptionEpoch.current === epoch;

    dropSubscriptionPendingRef.current = true;
    setDropSubscriptionStatus("connecting");
    setDropSubscriptionError(null);

    void dropTransport
      .subscribe((update) => {
        if (!ownsSubscription() || update.sequence <= lastDropSequence.current) {
          return;
        }
        const replayedSnapshot = awaitingSnapshot;
        awaitingSnapshot = false;
        lastDropSequence.current = update.sequence;
        applyDropUpdate(update, replayedSnapshot);
      })
      .then((stop) => {
        if (!ownsSubscription()) {
          stop();
          return;
        }
        unsubscribe = stop;
        dropSubscriptionPendingRef.current = false;
        setDropSubscriptionStatus("available");
        setDropSubscriptionError(null);
        readAuthoritativeRoster();
      })
      .catch((cause: unknown) => {
        if (ownsSubscription()) {
          dropSubscriptionPendingRef.current = false;
          setDropSubscriptionStatus("unavailable");
          setDropSubscriptionError(toPreviewError(cause));
          readAuthoritativeRoster();
        }
      });

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [applyDropUpdate, dropSubscriptionAttempt, dropTransport, readAuthoritativeRoster]);

  const retryDropSubscription = useCallback(() => {
    if (dropSubscriptionPendingRef.current) {
      return;
    }
    dropSubscriptionPendingRef.current = true;
    setDropSubscriptionStatus("connecting");
    setDropSubscriptionError(null);
    setDropSubscriptionAttempt((attempt) => attempt + 1);
  }, []);

  /**
   * Reads one dataset, because the user asked for that dataset.
   *
   * The only thing in this hook that starts a preview. Moving around the roster
   * does not, adding to it does not, and removing from it does not.
   */
  const activateDataset = useCallback(
    (handle: string) => {
      if (backendBusyRef.current || viewerRequests.current > 0) {
        return;
      }
      // Here rather than on the button, because a button is one of three ways
      // in: Enter and a double-click reach this too. Without it, activating a
      // vendor row would clear the mzML preview on screen and replace it with
      // the refusal Rust is about to send -- losing a working view to learn
      // something the row already says.
      if (
        rosterRef.current.datasets.some(
          (dataset) => dataset.handle === handle && dataset.sourceKind !== "mzml",
        )
      ) {
        return;
      }
      if (!backendUsableRef.current) {
        return;
      }
      loadPreview(handle, now());
    },
    [loadPreview],
  );

  const previewActiveAgain = useCallback(() => {
    const handle = rosterRef.current.active;
    if (handle !== null) {
      activateDataset(handle);
    }
  }, [activateDataset]);

  const addFiles = useCallback(() => {
    // One workspace change at a time. Two in flight together let the older
    // reply's roster snapshot overwrite the newer one's, and Rust serialises
    // them behind one gate regardless, so this waits for a moment rather than
    // for anything.
    //
    // A folder import counts, and it is the longest of them. This batch advances
    // Rust's mutation generation: if it reaches the gate before an older scan,
    // that scan is superseded; if the scan committed first, this batch's roster
    // includes its rows. Either way only the later authoritative reply is used.
    if (
      pickerBusyRef.current ||
      folderBusyRef.current ||
      dropBusyRef.current ||
      workspaceBusyRef.current
    ) {
      return;
    }
    const startedAt = now();
    setPickerError(null);
    pickerBusyRef.current = true;
    setPickerBusy(true);
    void api
      .chooseFiles()
      .then((result) => {
        if (!mounted.current) {
          return;
        }
        // A dismissed picker is not a failure and must leave the workspace
        // exactly as the user left it. It is deliberately not an empty batch.
        if (result === null) {
          return;
        }
        const added = result.outcomes.flatMap((outcome) =>
          outcome.outcome === "added" ? [outcome.dataset.handle] : [],
        );
        // Only an mzML row can be read, so only an mzML row is read. A mixed
        // batch into an empty workspace still costs one process, and a batch of
        // vendor acquisitions costs none: reading the first row whatever it was
        // would send a `.raw` to a preview boundary that cannot open one, and
        // open a first-run session with a failure nobody asked for.
        const firstPreviewable = result.outcomes.flatMap((outcome) =>
          outcome.outcome === "added" && outcome.dataset.sourceKind === "mzml"
            ? [outcome.dataset.handle]
            : [],
        )[0];
        // Whether the session was empty is Rust's answer, not this side's
        // projection of it. A webview can reload while Rust still holds rows,
        // and a first read that is slow or failed leaves the roster on screen
        // empty while the session is not -- reading a file into a workspace
        // that already had several, with nobody having asked for it. Every row
        // in the reply being one this batch added is the same question asked of
        // the only list that knows.
        const wasEmpty = result.roster.datasets.length === added.length;
        dispatchRoster({ type: "filesAdded", result });
        rosterSettled();
        showWorkspaceNotice(describeAddResult(result));
        // At most one read, and only into a workspace that had nothing in it.
        // This is what keeps one picker operation costing one process rather
        // than one per file, while a first-run session still ends up looking at
        // something.
        if (
          wasEmpty &&
          firstPreviewable !== undefined &&
          backendUsableRef.current &&
          !backendBusyRef.current &&
          viewerRequests.current === 0
        ) {
          loadPreview(firstPreviewable, startedAt);
        }
      })
      .catch((cause: unknown) => {
        // The workspace is left exactly as it was, and so is the preview: a
        // picker that would not open is its own problem.
        if (mounted.current) {
          setPickerError(toPreviewError(cause));
        }
      })
      .finally(() => {
        pickerBusyRef.current = false;
        if (mounted.current) {
          setPickerBusy(false);
        }
      });
  }, [api, loadPreview, rosterSettled, showWorkspaceNotice]);

  /**
   * Adds every mzML file under a folder the user picks.
   *
   * Longer than every other workspace action and deliberately less exclusive.
   * The list stays live for the whole of it -- searching, sorting, selecting
   * and reading a file already in the session all keep working -- because a
   * scan is filesystem work rather than backend work and there is no honest
   * reason to take the session away for it. What it does hold is the right to
   * change the roster, which is what stops a second mutation answering with a
   * list from before this one.
   */
  const addFolder = useCallback(() => {
    // Read from refs, never from rendered state. This decision is made inside
    // a handler that can be several commits older than the truth.
    if (
      pickerBusyRef.current ||
      folderBusyRef.current ||
      dropBusyRef.current ||
      workspaceBusyRef.current
    ) {
      return;
    }
    // Not until this window knows what the session holds. The native page-load
    // event has already superseded work owned by the previous document, but the
    // roster answer is what lets this document begin from an authoritative
    // list. Waiting costs one round trip that is already in flight and avoids
    // importing into a workspace this window has not adopted.
    //
    // A failed read is the same answer: this window has no authoritative list,
    // and importing into a workspace it could not read is not something to
    // start on a guess. The roster's own retry is the way out.
    if (!rosterReadyRef.current) {
      return;
    }
    const startedAt = now();
    folderToken.current += 1;
    const token = folderToken.current;
    // Where the workspace's own decisions stood when this began. Removing rows
    // and emptying the list stay available throughout, so one of them can be
    // started while this is still out there.
    const mutationsAtStart = workspaceMutations.current;
    setFolderError(null);
    folderBusyRef.current = true;
    folderReservationPendingRef.current = true;
    setFolderBusy(true);
    setFolderReservationPending(true);
    void api
      .chooseFolder(() => {
        // Reservation replies, terminal settlement and a later invocation can
        // overtake one another. Only the request that still owns folder busy
        // may release the current barrier.
        if (
          !mounted.current ||
          token !== folderToken.current ||
          !folderBusyRef.current
        ) {
          return;
        }
        folderReservationPendingRef.current = false;
        setFolderReservationPending(false);
      })
      .then((result) => {
        if (!mounted.current || token !== folderToken.current) {
          return;
        }
        // A dismissed picker is not a failure and is deliberately not a folder
        // that held nothing. Nothing changes and nothing is announced.
        if (result === null) {
          return;
        }
        if (workspaceMutations.current !== mutationsAtStart) {
          // A removal or a clear was started after this import, so this roster
          // is not the newest answer about what the session holds and
          // installing it would put back exactly the rows the user asked to be
          // rid of.
          //
          // Nothing is said, and that is not an omission. A successful mutation
          // supplies the authoritative roster that accounts for the import; a
          // rejected mutation instead causes a fresh roster read after both
          // operations settle. Applying or describing this result while the
          // later request is unresolved would expose a snapshot that may already
          // be obsolete.
          return;
        }
        const added = result.outcomes.flatMap((outcome) =>
          outcome.outcome === "added" ? [outcome.dataset.handle] : [],
        );
        // Whether the session was empty is Rust's answer, not this side's
        // projection of it. A webview can reload while Rust still holds rows,
        // and a first read that is slow or failed leaves the roster on screen
        // empty while the session is not. Every row in the reply being one this
        // import added is the same question asked of the only list that knows,
        // and it is a safe question only because a superseded import never
        // reaches here -- it fails, and fails without adding anything.
        const wasEmpty = result.roster.datasets.length === added.length;
        // Through the reducer, which is where the selection the user built
        // while the scan ran is reconciled with what arrived. Doing it here
        // would mean holding selection rules in two places, and the one that
        // matters -- keep theirs, add ours -- in the place that cannot see the
        // current state.
        dispatchRoster({ type: "folderImported", result });
        // The reply is a newer and more authoritative read than any roster load
        // still in flight, so this drops those older replies rather than
        // letting one install a list from before the import.
        rosterSettled();
        showWorkspaceNotice(describeFolderResult(result));
        // At most one read, and only into a session that had nothing in it.
        // This is what keeps one folder of a thousand files costing one process
        // rather than a thousand, while a first-run session still ends up
        // looking at something.
        const first = added[0];
        if (
          wasEmpty &&
          first !== undefined &&
          backendUsableRef.current &&
          !backendBusyRef.current &&
          viewerRequests.current === 0
        ) {
          loadPreview(first, startedAt);
        }
      })
      .catch((cause: unknown) => {
        const error = toPreviewError(cause);
        // The workspace is left exactly as it was, and so is the preview. A
        // folder that could not be scanned changed nothing and still needs a
        // recovery path. A scan that a later workspace decision superseded is
        // different: that decision is the reason Rust refused the import, and
        // its own reply (or the reconciliation it owes after failure) is the
        // authoritative account. Reporting the older refusal as a folder
        // failure would turn the user's successful escape into an error.
        // A genuine discovery or picker failure can precede Rust's generation
        // check, so overlap alone is not enough to hide it. Only the typed
        // refusals that say the newer decision won are expected settlement. A
        // delayed begin from the previous document can replace this stale
        // claim after Clear or Remove; `invalid_folder_import_reservation` is
        // equally safe to hide in that overlap because claim fails before the
        // picker is dispatched.
        const settledByThisWindow =
          workspaceMutations.current !== mutationsAtStart &&
          (error.kind === "import_superseded" ||
            error.kind === "invalid_folder_import_reservation");
        if (mounted.current && token === folderToken.current && !settledByThisWindow) {
          setFolderError(error);
        }
      })
      .finally(() => {
        // Claimed by the request that started it. An older one settling here
        // must not report a newer one's operation finished.
        if (token !== folderToken.current) {
          return;
        }
        folderBusyRef.current = false;
        folderReservationPendingRef.current = false;
        if (mounted.current) {
          setFolderBusy(false);
          setFolderReservationPending(false);
          // A second workspace mutation can start after the failure that left
          // this debt. Its own answer must settle first; the shared drain waits
          // for both busy flags whichever callback happens to run last.
          drainWorkspaceReconciliation();
        }
      });
  }, [
    api,
    drainWorkspaceReconciliation,
    loadPreview,
    rosterSettled,
    showWorkspaceNotice,
  ]);

  const removeSelected = useCallback(() => {
    const handles = [...rosterRef.current.selected];
    // `pickerBusyRef` as well, and for the same reason `addFiles` reads this
    // one: an add holds it across the picker *and* the registration after it,
    // and a removal answering inside that window carries a roster snapshot
    // taken before the added rows existed.
    //
    // Deliberately **not** `folderBusyRef`. A folder import has no cancellation
    // and can run for as long as the user's filesystem takes. A successful
    // `Clear list` is the reliable final-empty escape; removal stays available
    // to manage the rows already on screen. Rust linearises this action against
    // the import: a removal that reaches the gate first supersedes it, while one that follows
    // the import acts only on these handles and can retain newly imported rows.
    if (
      handles.length === 0 ||
      workspaceBusyRef.current ||
      pickerBusyRef.current ||
      folderReservationPendingRef.current
    ) {
      return;
    }
    workspaceBusyRef.current = true;
    workspaceMutations.current += 1;
    // A roster read already in flight may have been served before this request
    // reached Rust. Suppress that reply immediately; success supplies its own
    // roster, while failure starts a newer authoritative read.
    rosterToken.current += 1;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    void api
      .removeDatasets(handles)
      .then((result) => {
        if (!mounted.current) {
          return;
        }
        // The preview goes only when its own row does. Removing rows around it
        // is not a reason to take away what the user is reading.
        //
        // Read here rather than captured before the request. Curating stays
        // live while a removal is in flight, so the row the viewer belongs to
        // can have changed since: a snapshot taken beforehand would name the
        // row the user has already moved on from, and clearing for it would
        // take away the reading they started instead.
        const showing = openHandle.current;
        if (showing !== null && result.removedHandles.includes(showing)) {
          clearVisiblePreview();
        }
        // This authoritative roster pays any reconciliation debt left by an
        // earlier failed request during the same import.
        workspaceReconcileOwed.current = false;
        // Success proves Rust advanced the workspace generation and the older
        // native drop can no longer commit. Release its UI ownership now; a
        // later terminal replay is ignored because it no longer owns it.
        if (activeDrop.current !== null) {
          settleDropPresentation();
        }
        dispatchRoster({ type: "datasetsRemoved", result });
        rosterSettled();
        showWorkspaceNotice(describeRemoveResult(result));
        if (result.roster.datasets.length === 0) {
          setFocusAddFilesToken((token) => token + 1);
        }
      })
      .catch((cause: unknown) => {
        if (mounted.current) {
          setWorkspaceError(toPreviewError(cause));
          reconcileAfterFailedWorkspaceMutation();
        }
      })
      .finally(() => {
        workspaceBusyRef.current = false;
        if (mounted.current) {
          setWorkspaceBusy(false);
          drainWorkspaceReconciliation();
        }
      });
  }, [
    api,
    clearVisiblePreview,
    drainWorkspaceReconciliation,
    reconcileAfterFailedWorkspaceMutation,
    rosterSettled,
    settleDropPresentation,
    showWorkspaceNotice,
  ]);

  const clearList = useCallback(() => {
    // The count this action announces is read here, so an add still in flight
    // would make it a count of the workspace before the added rows -- on top of
    // being the second mutation in flight that `addFiles` refuses to be.
    //
    // Deliberately not `folderBusyRef`: a successful clear is the reliable way
    // out of a folder chosen by mistake, and a folder import has no cancellation.
    // If clear wins the gate it supersedes the import; if the import committed
    // first, clear removes every row it added. The authoritative reply is empty
    // either way.
    const folderImportPending = folderBusyRef.current;
    const dropImportPending = dropBusyRef.current;
    const rosterHasRows = rosterRef.current.datasets.length > 0;
    if (
      workspaceBusyRef.current ||
      pickerBusyRef.current ||
      folderReservationPendingRef.current ||
      (!rosterHasRows && !folderImportPending && !dropImportPending)
    ) {
      return false;
    }
    // What this window can see, which during a folder import may be fewer rows
    // than Rust holds. The count is an account of the action rather than a
    // claim about the registry, and the roster that comes back is the
    // authoritative answer either way.
    const removed = rosterRef.current.datasets.length;
    workspaceBusyRef.current = true;
    workspaceMutations.current += 1;
    // The same request-time barrier as removal: an older roster read must not
    // become visible while Clear is still waiting for its authoritative reply.
    rosterToken.current += 1;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    void api
      .clearWorkspace()
      .then((loaded) => {
        if (!mounted.current) {
          return;
        }
        clearVisiblePreview();
        // This authoritative roster pays any reconciliation debt left by an
        // earlier failed request during the same import.
        workspaceReconcileOwed.current = false;
        if (activeDrop.current !== null) {
          settleDropPresentation();
        }
        dispatchRoster({ type: "workspaceCleared", roster: loaded });
        rosterSettled();
        showWorkspaceNotice(
          describeClear(removed, folderImportPending, dropImportPending),
        );
        setFocusAddFilesToken((token) => token + 1);
      })
      .catch((cause: unknown) => {
        if (mounted.current) {
          setWorkspaceError(toPreviewError(cause));
          reconcileAfterFailedWorkspaceMutation();
        }
      })
      .finally(() => {
        workspaceBusyRef.current = false;
        if (mounted.current) {
          setWorkspaceBusy(false);
          drainWorkspaceReconciliation();
        }
      });
    return true;
  }, [
    api,
    clearVisiblePreview,
    drainWorkspaceReconciliation,
    reconcileAfterFailedWorkspaceMutation,
    rosterSettled,
    settleDropPresentation,
    showWorkspaceNotice,
  ]);

  const dismissPickerError = useCallback(() => {
    setPickerError(null);
  }, []);

  const dismissFolderError = useCallback(() => {
    setFolderError(null);
  }, []);

  const dismissDropError = useCallback(() => {
    setDropError(null);
  }, []);

  const dismissWorkspaceError = useCallback(() => {
    setWorkspaceError(null);
  }, []);

  const dismissWorkspaceNotice = useCallback(() => {
    setWorkspaceNotice(null);
  }, []);

  const selectSpectrum = useCallback(
    (index: number) => {
      const handle = openHandle.current;
      // The lane, from the refs rather than from the render: this handler can
      // be several commits older than the truth, and for a click that arrives
      // during an installation change that is exactly the wrong answer.
      //
      // Reading a row is backend work, so "one outstanding backend request"
      // has to cover it or it means nothing. Started while an installation is
      // being probed, this either reads the backend being replaced or queues
      // behind the change and then fails on it -- one process launch either
      // way, for a result that was never going to be shown. And a backend this
      // session has stopped trusting is not one to launch a read against: a
      // preview loaded before a stop stays on screen -- nothing about it became
      // untrue -- so its table is still there to click, and every click would
      // replace the spectrum beside it with a refusal the user can do nothing
      // about. The verdict is the one the banner shows, so the row and the
      // banner cannot come to disagree.
      //
      // The null handle is written out as well as passed in, because it is what
      // narrows the handle for the read below.
      if (
        handle === null ||
        !canStartSpectrumSelection({
          hasLoadedPreview: handle !== null,
          backendUsable: backendUsableRef.current,
          backendBusy: backendBusyRef.current,
          conversionBusy: conversionBusyRef.current,
        })
      ) {
        return;
      }
      // A repeat of the row already being read is dropped. Every selection is
      // one backend process, and a double click should not be two of them.
      // Judged against the current token, so a read abandoned by a new preview
      // does not make its row index unselectable in the one now on screen.
      const inFlight = inFlightSpectrum.current;
      if (
        inFlight !== null &&
        inFlight.token === spectrumToken.current &&
        inFlight.index === index
      ) {
        return;
      }
      // Every guard has passed, so this is a commit. What it commits to is a
      // row of the table that is loaded *now*: a selection carries the
      // retention time the linked plot reveals it at, and there is nowhere
      // honest to get one from for an index this preview does not contain. So
      // an index that cannot be reconciled is refused rather than guessed at,
      // which leaves the selection exactly as it was and launches nothing.
      const row = previewRowsRef.current.find((candidate) => candidate.index === index);
      if (row === undefined) {
        return;
      }
      const startedAt = now();
      // The reducer allocates the revision. Several producers reach this one
      // function -- the plot, the table, Previous and Next -- and the number
      // that tells two commits apart is not theirs to invent.
      dispatchViewerEvent({
        type: "selection-committed",
        index,
        retentionTime: row.retentionTime.value,
      });
      spectrumToken.current += 1;
      const token = spectrumToken.current;
      inFlightSpectrum.current = { index, token };
      setSpectrum({ status: "loading", index });
      beginViewerRequest();
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
            // the same way until the user happens to press Check again.
            //
            // Any failure that cannot be retried is a reason to ask whether the
            // backend is still what the banner says. A replacement that keeps a
            // file's metadata but no longer answers its help probe fails inside
            // the provider's own resolution, so it never reaches the comparison
            // that would name it a change.
            const definitelyChanged = BACKEND_CHANGED_KINDS.has(failure.kind);
            if (definitelyChanged || !failure.retryable) {
              if (definitelyChanged) {
                discardBackendDerivedState();
              }
              // Deferred behind an outstanding installation change for the same
              // reason the open recovery is: this check is not a user action,
              // so it passes straight through the busy guard, and clearing that
              // guard early would re-enable the actions while a folder picker is
              // still open.
              if (installationChanges.current > 0) {
                deferredRecheck.current = true;
              } else {
                checkBackend();
              }
            }
          }
        })
        .finally(() => {
          endViewerRequest();
        });
    },
    [
      api,
      beginViewerRequest,
      checkBackend,
      discardBackendDerivedState,
      dispatchViewerEvent,
      endViewerRequest,
    ],
  );

  /**
   * The scientific model of what is on screen.
   *
   * Built once per loaded preview and not again: not for a pointer move, not
   * for a zoom, not for a hover, and not when the selected spectrum finishes
   * loading. `preview` is replaced only when a different reading arrives, so
   * its identity is the identity of the run.
   */
  const scanModel = useMemo(
    () =>
      preview.status === "loaded"
        ? buildPreviewScanModel(preview.preview.spectrumTable)
        : UNLOADED_SCAN_MODEL,
    [preview],
  );

  /**
   * Whether the viewer has a run to draw and has not been told about it yet.
   *
   * The run's domain reaches the interaction in a layout effect, so the commit
   * that first renders a loaded preview draws the plot's placeholder rather
   * than the plot. Nobody sees that -- a layout effect's update is flushed
   * before the browser paints -- but a stopwatch stopped there would time
   * everything except the drawing.
   */
  const viewerAwaitingDomain = scanModel.status === "ready" && viewer.state.fullDomain === null;

  const completeRenderMeasurements = useCallback(() => {
    const openPending = pendingOpenRender.current;
    // The open measurement names the moment the preview is on screen, and the
    // chromatogram is part of what is on screen. Left standing until the plot
    // itself has been committed, because otherwise this would exclude the
    // clipping, the reduction and the path -- and would exclude more of them
    // the larger the run, which is the one size where the number is worth
    // having.
    if (openPending !== null && !viewerAwaitingDomain) {
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
        `Selecting row ${String(spectrumPending.index)} through that spectrum being in the document.`,
      );
    }
  }, [recordMeasurement, viewerAwaitingDomain]);

  const retrySpectrum = useCallback(() => {
    if (selectedIndex !== null) {
      selectSpectrum(selectedIndex);
    }
  }, [selectSpectrum, selectedIndex]);

  /**
   * The rows the linked views navigate, or none while no preview is loaded.
   *
   * Read from the preview rather than copied into state of its own: a second
   * copy of the scan table is a second thing to keep in step with the first.
   */
  const previewRows =
    preview.status === "loaded" ? preview.preview.spectrumTable.rows : EMPTY_ROWS;
  // Written during the render whose value it mirrors, not in an effect, for the
  // same reason every other mirror here is: a commit arriving in the gap would
  // reconcile against the table before the last change.
  previewRowsRef.current = previewRows;

  /**
   * Tells the interaction which run it belongs to, once there is one to name.
   *
   * A layout effect rather than a passive one, so the first painted frame of a
   * new preview already has an axis. Guarded by the model's own identity: a
   * render that changed something else announces nothing, and announcing again
   * would drop a selection the user had just made.
   *
   * A model that refuses leaves the interaction closed. The scan table beside
   * it stays usable, and selecting a row through it still commits here -- there
   * is simply no viewport for a chromatogram nobody can draw.
   */
  const announcedModel = useRef<ScanModel | null>(null);
  useLayoutEffect(() => {
    if (announcedModel.current === scanModel) {
      return;
    }
    announcedModel.current = scanModel;
    if (scanModel.status === "ready") {
      dispatchViewerEvent({ type: "preview-loaded", fullDomain: scanModel.fullDomain });
    }
  }, [dispatchViewerEvent, scanModel]);

  const toggleChromatogramTrace = useCallback((trace: TraceKind) => {
    setChromatogramTraces((current) => ({ ...current, [trace]: !current[trace] }));
  }, []);

  /**
   * The scans either side of the selected one, kept off the cursor's path.
   *
   * `adjacentScan` walks the table to find the selected row, because the table's
   * order is the order Previous and Next mean and nothing promises the indices
   * are a gapless ascending run. That walk is linear, and this hook re-renders
   * whenever the pointer crosses from one scan to another -- which at a full-run
   * zoom over a large acquisition is most pointer frames. Unmemoized, a
   * selection near the end of a 36,319-row table put two whole-table walks into
   * every one of them.
   *
   * Neither input changes on a hover, so the memo answers without walking
   * anything.
   */
  const scanSteps = useMemo(
    () => ({
      previous: adjacentScan(previewRows, selectedIndex, -1),
      next: adjacentScan(previewRows, selectedIndex, 1),
    }),
    [previewRows, selectedIndex],
  );
  const previousScanIndex = scanSteps.previous;
  const nextScanIndex = scanSteps.next;

  const selectPreviousScan = useCallback(() => {
    if (previousScanIndex !== null) {
      selectSpectrum(previousScanIndex);
    }
  }, [previousScanIndex, selectSpectrum]);

  const selectNextScan = useCallback(() => {
    if (nextScanIndex !== null) {
      selectSpectrum(nextScanIndex);
    }
  }, [nextScanIndex, selectSpectrum]);

  // Session state, deliberately not persisted: a figure size is a decision
  // about one export, and a size silently restored from a previous run is a
  // property of a file nobody chose for it.
  const [figureSettings, setFigureSettings] = useState<FigureSettingsDraft>({
    widthPx: String(DEFAULT_FIGURE_WIDTH),
    heightPx: String(DEFAULT_FIGURE_HEIGHT),
    pngDpi: String(DEFAULT_PNG_DPI),
    theme: "light",
  });
  const setFigureSetting = useCallback((field: FigureSettingsField, value: string) => {
    setFigureSettings((current) => ({ ...current, [field]: value }));
  }, []);
  const setFigureTheme = useCallback((theme: FigureTheme) => {
    setFigureSettings((current) => ({ ...current, theme }));
  }, []);
  const resolvedRenderSettings = useMemo(
    () => resolveRenderSettings(figureSettings),
    [figureSettings],
  );
  const resolvedPngDpi = useMemo(() => resolvePngDpi(figureSettings), [figureSettings]);
  const renderSettingsProblem = useMemo(
    () => describeRenderSettingsProblem(figureSettings),
    [figureSettings],
  );
  const pngDpiProblem = useMemo(() => describePngDpiProblem(figureSettings), [figureSettings]);

  // ------------------------------------------------- scientific exports
  //
  // Two states, and they stay two. A selected spectrum and a chromatogram
  // publish different results, bind different tokens and say different things
  // about what was written, so one state standing for both would have to invent
  // a result for whichever surface did not run.
  //
  // They are declared together because there is exactly one lane underneath
  // them, and the projection below has to be able to see both.
  const [spectrumExport, setSpectrumExport] = useState<SpectrumExportState>({ status: "idle" });
  const [chromatogramExport, setChromatogramExport] = useState<ChromatogramExportState>({
    status: "idle",
  });
  /**
   * Whether the session's one scientific export lane is occupied.
   *
   * Derived, and deliberately not stored. Rust holds a single lane across both
   * surfaces -- two native save dialogs for one window is not a state this
   * application can be in -- so "may another scientific export begin now" has
   * one answer, and a third state machine here could only disagree with it.
   *
   * It governs *availability* and nothing else. Each surface keeps its own
   * result, its own status message and its own token binding, because each of
   * those is a fact about that surface rather than about the lane. And Rust
   * remains the safety boundary: this is what makes the interface truthful, not
   * what makes it safe.
   */
  const scientificExportBusy =
    spectrumExport.status === "running" || chromatogramExport.status === "running";
  // A result belongs to the spectrum it describes. Loading another one clears
  // it, so a panel can never show "saved 1,000,000 points" beside a different
  // measurement -- which is the one way this surface could mislead about which
  // spectrum a file holds.
  const exportedSpectrumToken =
    spectrum.status === "loaded" ? spectrum.spectrum.exportToken : null;
  // The same token, readable from a callback that was created before the user
  // moved. Clearing on change only covers a result that has already landed; a
  // save that is still in flight lands afterwards, and without this it would be
  // published against whatever spectrum is on screen by then.
  const boundExportToken = useRef<string | null>(null);
  useEffect(() => {
    boundExportToken.current = exportedSpectrumToken;
    setSpectrumExport({ status: "idle" });
  }, [exportedSpectrumToken]);

  const dismissSpectrumExport = useCallback(() => {
    setSpectrumExport({ status: "idle" });
  }, []);

  const exportSpectrum = useCallback(
    (format: SpectrumExportFormat) => {
      // Read here rather than closed over, so the token is the one on screen at
      // the moment the user acted. A spectrum that has since been replaced is
      // refused by Rust rather than answered with the newer one.
      if (spectrum.status !== "loaded") {
        return;
      }
      // The one scientific lane, whichever surface is holding it. A
      // chromatogram export running is exactly as much a reason not to start
      // this one as a spectrum export running: Rust refuses either way, and
      // offering an action already known to be refused is offering something
      // that cannot work.
      if (scientificExportBusy) {
        return;
      }
      // A figure the settings could not describe is not offered, so reaching
      // here with none means the panel and this disagree; refusing is the
      // honest end rather than sending Rust something to reject.
      //
      // Only for the formats that *are* figures. The panel deliberately leaves
      // the data actions live while a width is unusable -- a size and a theme
      // are not properties of a measurement -- and returning here for them
      // would make an enabled button do nothing at all, which is worse than
      // either offering it or closing it. Rust ignores what a data document has
      // no use for, so what travels with one is immaterial.
      // And only what this format actually consumes. A PNG needs both; an SVG
      // needs the figure and has no pixels to give a physical size to, so a
      // resolution nobody could use must not stop it.
      if (isFigureFormat(format) && resolvedRenderSettings === null) {
        return;
      }
      if (format === "png" && resolvedPngDpi === null) {
        return;
      }
      const settings =
        resolvedRenderSettings === null
          ? DEFAULT_FIGURE_SETTINGS
          : figureSettingsFor(resolvedRenderSettings, resolvedPngDpi);
      const token = spectrum.spectrum.exportToken;
      setSpectrumExport({ status: "running", operation: format });
      void api
        .exportSelectedSpectrum(token, format, settings)
        .then((outcome) => {
          // Dropped rather than shown if the panel has moved on. The file was
          // still written -- Rust decided that, not this -- but "Saved 1,000,000
          // points" beside a spectrum those points did not come from is the one
          // way this surface could mislead about which measurement a file holds,
          // and a confirmation the user has to distrust is worth less than none.
          if (boundExportToken.current !== token) {
            return;
          }
          setSpectrumExport(
            outcome.status === "cancelled"
              ? { status: "cancelled" }
              : {
                  status: "saved",
                  format: outcome.format,
                  fileName: outcome.fileName,
                  figure: outcome.figure,
                  pointCount: outcome.pointCount,
                },
          );
        })
        .catch((cause: unknown) => {
          if (boundExportToken.current !== token) {
            return;
          }
          setSpectrumExport({
            status: "failed",
            operation: format,
            error: toPreviewError(cause),
          });
        });
    },
    [api, resolvedPngDpi, resolvedRenderSettings, scientificExportBusy, spectrum],
  );

  /**
   * Puts the loaded spectrum's figure on the system clipboard.
   *
   * The same lane as an export, because Rust has one: a copy while any
   * scientific save is running is refused there, and offering it here would be
   * offering an action already known to fail.
   */
  const copySpectrumPlot = useCallback(() => {
    if (spectrum.status !== "loaded") {
      return;
    }
    if (scientificExportBusy) {
      return;
    }
    // The figure, and nothing about a resolution. A clipboard image is RGBA
    // and a size; there is no chunk for a physical resolution and nothing that
    // would read one, so an unusable DPI must leave this action alone.
    const render = resolvedRenderSettings;
    if (render === null) {
      return;
    }
    const settings = figureSettingsFor(render, resolvedPngDpi);
    const token = spectrum.spectrum.exportToken;
    setSpectrumExport({ status: "running", operation: "copy" });
    void api
      .copySelectedSpectrumPlot(token, settings)
      .then((outcome) => {
        // The same binding discipline a save has. The clipboard was written --
        // Rust decided that -- but a "copied" message beside a spectrum those
        // pixels did not come from would say the wrong thing about what is on
        // the clipboard.
        if (boundExportToken.current !== token) {
          return;
        }
        setSpectrumExport({
          status: "copied",
          figure: outcome.figure,
          pointCount: outcome.pointCount,
        });
      })
      .catch((cause: unknown) => {
        if (boundExportToken.current !== token) {
          return;
        }
        setSpectrumExport({
          status: "failed",
          operation: "copy",
          error: toPreviewError(cause),
        });
      });
  }, [api, resolvedPngDpi, resolvedRenderSettings, scientificExportBusy, spectrum]);

  // ------------------------------------------------- chromatogram export

  const [chromatogramRangeScope, setChromatogramRangeScope] =
    useState<ChromatogramRangeScope>("full");
  // Rust's answer, forwarded. `null` is a run with no chromatogram -- a table
  // this session could not transfer whole, or one the model refuses -- and it
  // is the same run the viewer draws nothing for.
  const chromatogramExportToken = preview.status === "loaded" ? preview.preview.chromatogramExportToken : null;
  // A result belongs to the run it describes, exactly as a spectrum result
  // belongs to its spectrum.
  const boundChromatogramToken = useRef<string | null>(null);
  useEffect(() => {
    boundChromatogramToken.current = chromatogramExportToken;
    setChromatogramExport({ status: "idle" });
  }, [chromatogramExportToken]);

  const dismissChromatogramExport = useCallback(() => {
    setChromatogramExport({ status: "idle" });
  }, []);

  /**
   * What a current-range export would cover, as the viewer has committed it.
   *
   * Read from the reducer's committed domain and from nothing else. Not the
   * rendered domain, which a gesture in flight owns; not the SVG's viewBox, not
   * an axis end and not a pointer position. A viewer that has committed nothing
   * has no narrower range, and `null` says exactly that rather than a subrange
   * invented to make the option look different.
   */
  const chromatogramCommittedDomain = viewer.state.committedDomain;

  /** The range one export is taken over, read at the moment it is invoked. */
  const chromatogramRange = useCallback(
    (): ChromatogramRange => {
      // Through the controller's own reader rather than a render closure. The
      // committed range can move between the render that drew a button and the
      // press that reaches it -- a settling gesture is exactly that -- and what
      // is exported is what the viewer has committed *now*.
      const committed = viewer.current().committedDomain;
      if (chromatogramRangeScope === "full" || committed === null) {
        return { scope: chromatogramRangeScope, low: null, high: null };
      }
      return { scope: "current", low: committed.low, high: committed.high };
    },
    [chromatogramRangeScope, viewer],
  );

  /** Which traces a figure would draw: the ones on screen, at this moment. */
  const visibleTraces = useCallback(
    (): ChromatogramTraceSet => ({
      tic: chromatogramTraces.tic,
      bpc: chromatogramTraces.bpc,
    }),
    [chromatogramTraces],
  );

  const exportChromatogram = useCallback(
    (format: ChromatogramExportFormat) => {
      const token = chromatogramExportToken;
      if (token === null) {
        return;
      }
      // One scientific lane, and Rust owns it. Offering an action already known
      // to be refused there would be offering something that cannot work.
      if (scientificExportBusy) {
        return;
      }
      const drawing = isChromatogramFigureFormat(format);
      // The same rule the spectrum panel follows: a figure the settings could
      // not describe is not sent, and a data document is untouched by a figure
      // setting it has no use for.
      if (drawing && resolvedRenderSettings === null) {
        return;
      }
      if (format === "png" && resolvedPngDpi === null) {
        return;
      }
      const visible = visibleTraces();
      // A figure of no series is refused by the contract, so it is not offered.
      // The data exports stay available, because hiding a trace is a choice
      // about a plot rather than a decision to leave measured science out.
      if (drawing && !visible.tic && !visible.bpc) {
        return;
      }
      const settings =
        resolvedRenderSettings === null
          ? DEFAULT_FIGURE_SETTINGS
          : figureSettingsFor(resolvedRenderSettings, resolvedPngDpi);
      const range = chromatogramRange();
      setChromatogramExport({ status: "running", operation: format });
      void api
        .exportChromatogram(token, format, range, visible, settings)
        .then((outcome) => {
          if (boundChromatogramToken.current !== token) {
            return;
          }
          setChromatogramExport(
            outcome.status === "cancelled"
              ? { status: "cancelled" }
              : {
                  status: "saved",
                  format: outcome.format,
                  fileName: outcome.fileName,
                  figure: outcome.figure,
                  rangeScope: outcome.rangeScope,
                  rangeLow: outcome.rangeLow,
                  rangeHigh: outcome.rangeHigh,
                  sourceScanCount: outcome.sourceScanCount,
                  rowCount: outcome.rowCount,
                },
          );
        })
        .catch((cause: unknown) => {
          if (boundChromatogramToken.current !== token) {
            return;
          }
          setChromatogramExport({
            status: "failed",
            operation: format,
            error: toPreviewError(cause),
          });
        });
    },
    [
      api,
      chromatogramExportToken,
      chromatogramRange,
      resolvedPngDpi,
      resolvedRenderSettings,
      scientificExportBusy,
      visibleTraces,
    ],
  );

  const copyChromatogramPlot = useCallback(() => {
    const token = chromatogramExportToken;
    if (token === null) {
      return;
    }
    if (scientificExportBusy) {
      return;
    }
    const render = resolvedRenderSettings;
    if (render === null) {
      return;
    }
    const visible = visibleTraces();
    if (!visible.tic && !visible.bpc) {
      return;
    }
    const settings = figureSettingsFor(render, resolvedPngDpi);
    const range = chromatogramRange();
    setChromatogramExport({ status: "running", operation: "copy" });
    void api
      .copyChromatogramPlot(token, range, visible, settings)
      .then((outcome) => {
        if (boundChromatogramToken.current !== token) {
          return;
        }
        setChromatogramExport({
          status: "copied",
          figure: outcome.figure,
          rangeScope: outcome.rangeScope,
          rangeLow: outcome.rangeLow,
          rangeHigh: outcome.rangeHigh,
          sourceScanCount: outcome.sourceScanCount,
        });
      })
      .catch((cause: unknown) => {
        if (boundChromatogramToken.current !== token) {
          return;
        }
        setChromatogramExport({
          status: "failed",
          operation: "copy",
          error: toPreviewError(cause),
        });
      });
  }, [
    api,
    chromatogramExportToken,
    chromatogramRange,
    resolvedPngDpi,
    resolvedRenderSettings,
    scientificExportBusy,
    visibleTraces,
  ]);

  // A conversion's report carries the installation sequence it ran at. If it is
  // newer than what this document has applied, the banner and everything read
  // from the previous installation are stale -- so the backend is re-read
  // through the one path that knows how to discard them.
  const reconcileConversionGeneration = useCallback(
    (generation: number) => {
      if (generation > appliedGeneration.current) {
        checkBackend();
      }
    },
    [checkBackend],
  );
  // Adopted rows are ordinary workspace rows, so the roster answers for them
  // like any other mutation: adopted whole, with the query, the sort and the
  // preview on screen left exactly as the user had them.
  const adoptOutputs = useMemo(
    () => ({
      // Counted as a workspace decision at the moment it is asked for, like a
      // removal or a clear. An import or a drop with a reply already in flight
      // carries a roster from before these rows existed, and this is what makes
      // it recognise itself as superseded.
      begin: () => {
        workspaceMutations.current += 1;
        return workspaceMutations.current;
      },
      apply: (result: WorkspaceOutputAdoptionResult, startedAt: number) => {
        // A decision taken after this one was asked for is the newer answer
        // about what the session holds, and installing this roster over it
        // would put back rows the user has since acted on. Rust committed
        // either way; the next read is what reconciles them.
        if (workspaceMutations.current !== startedAt) {
          return;
        }
        // Settled, like every other authoritative reply. A roster read served
        // before this can still be in flight, and installing its answer
        // afterwards would take the adopted rows back off screen.
        rosterSettled();
        dispatchRoster({ type: "outputsAdopted", result });
      },
    }),
    [rosterSettled],
  );
  // Every workspace mutation the user has asked for and not been answered on.
  // Adoption installs an authoritative roster, so it waits for these rather
  // than racing them -- the same reason acquiring waits for the others.
  const workspaceSettling =
    pickerBusy || workspaceBusy || folderBusy || dropBusy || folderReservationPending;
  const conversion = useConversionOperation(
    reconcileConversionGeneration,
    adoptOutputs,
    workspaceSettling,
  );
  // A stop that could not be confirmed makes this session's backend unusable
  // without changing the installation, so nothing about it advances the
  // installation sequence and the reconciler above would never fire. Left
  // alone, the banner would go on saying ProteoWizard is available while every
  // action that uses one was refused, and the guards derived from that verdict
  // would go on dispatching reads Rust is certain to refuse.
  //
  // Re-read through the ordinary path rather than projected locally: Rust
  // answers a quarantined session without launching anything, and what it
  // returns is the same verdict a reload would recover.
  const projectedQuarantine = useRef(false);
  useEffect(() => {
    if (!conversion.backendQuarantined || projectedQuarantine.current) {
      return;
    }
    // Once. The session never leaves this state, so a second read would ask a
    // question whose answer cannot have changed.
    projectedQuarantine.current = true;
    checkBackend();
  }, [checkBackend, conversion.backendQuarantined]);
  // Read by the spectrum guard below. A conversion owns the one backend lane,
  // and Rust refuses a spectrum while it does; this is what stops the interface
  // asking and leaving a panel loading for the length of a conversion.
  const conversionBusyRef = conversion.busyRef;

  /**
   * The same lane rule, from the facts a render can see.
   *
   * Each fact is the rendered half of the ref the operation reads: `backend`
   * and `backendUsableRef` are written together in `showBackend`, `backendBusy`
   * and `backendBusyRef` in `markBackendBusy`. Two of them are deliberately
   * narrower than their ref, and both narrow the same way -- towards refusing:
   *
   * - a loaded preview rather than a retained handle. A handle outlives the
   *   reading it was made for, so that a backend change can offer "read this
   *   again"; but with no table on screen there is no row to step to, and no
   *   control to advertise;
   * - the interface's own conversion-busy rather than the queue slot's. It
   *   also covers a retry or an adoption this document has dispatched and not
   *   been answered on, which is what every other action here treats as
   *   converting.
   *
   * Narrower is the safe direction: a control may refuse where the operation
   * would have accepted, and the reverse is the defect this rule exists for.
   *
   * One edge is not covered, and is named rather than glossed. `convert` claims
   * the conversion lane in a ref the moment it dispatches, and the rendered
   * busy follows only when the slot is read back -- so between those two there
   * is a window in which the operation refuses and this says available. It is
   * the same window every conversion-gated control in this interface has,
   * `Preview focused` included, and closing it belongs to the conversion lane's
   * own contract rather than to this adapter.
   */
  const spectrumSelectionAvailable = canStartSpectrumSelection({
    hasLoadedPreview: preview.status === "loaded",
    backendUsable:
      backend.status === "resolved" && backend.availability.state === "available",
    backendBusy,
    conversionBusy: conversion.busy,
  });

  const activeDataset = useMemo(
    () => roster.datasets.find((dataset) => dataset.handle === roster.active) ?? null,
    [roster.active, roster.datasets],
  );

  return {
    backend,
    preview,
    spectrum,
    scanModel,
    viewerInteraction: viewer.state,
    chromatogramExportToken,
    chromatogramRangeScope,
    setChromatogramRangeScope,
    chromatogramCommittedDomain,
    chromatogramExport,
    exportChromatogram,
    copyChromatogramPlot,
    dismissChromatogramExport,
    dispatchViewerEvent,
    readViewerInteraction,
    selectedIndex,
    measurements,
    backendBusy,
    previewBackendBusy,
    pickerBusy,
    folderBusy,
    folderReservationPending,
    dropBusy,
    dropPresentation,
    dropRejectedToken,
    dropRejectedReason,
    dropSubscriptionStatus,
    dropSubscriptionError,
    retryDropSubscription,
    workspaceBusy,
    checkBackend,
    chooseInstallation,
    useAutomaticDiscovery,
    roster,
    rosterLoad,
    rosterSettlementToken,
    reloadRoster,
    activeDataset,
    dispatchRoster,
    addFiles,
    addFolder,
    removeSelected,
    clearList,
    activateDataset,
    previewActiveAgain,
    workspaceNotice,
    dismissWorkspaceNotice,
    focusAddFilesToken,
    pickerError,
    dismissPickerError,
    folderError,
    dismissFolderError,
    dropError,
    dismissDropError,
    workspaceError,
    dismissWorkspaceError,
    selectSpectrum,
    retrySpectrum,
    spectrumExport,
    scientificExportBusy,
    exportSpectrum,
    copySpectrumPlot,
    dismissSpectrumExport,
    chromatogramTraces,
    toggleChromatogramTrace,
    selectPreviousScan,
    selectNextScan,
    spectrumSelectionAvailable,
    canSelectPreviousScan: spectrumSelectionAvailable && previousScanIndex !== null,
    canSelectNextScan: spectrumSelectionAvailable && nextScanIndex !== null,
    figureSettings,
    resolvedRenderSettings,
    resolvedPngDpi,
    renderSettingsProblem,
    pngDpiProblem,
    setFigureSetting,
    setFigureTheme,
    completeRenderMeasurements,
    recordMeasurement,
    conversion,
  };
}

function formatRows(count: number): string {
  return count === 1 ? "1 spectrum row" : `${String(count)} spectrum rows`;
}
