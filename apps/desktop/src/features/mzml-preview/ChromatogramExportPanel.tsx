import { Icon, IconButton } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";
import type { UiMessage } from "../preferences/i18n";
import type { FigureSettingsValidation } from "./figureSettingsValidation";
/**
 * What the run on screen can be exported as, from the chromatogram's head.
 *
 * Every number these actions send is a *request*: which run, by the opaque
 * token Rust issued with the preview; how much of it, by the scope the figure
 * dialog chose; and which traces are on screen. The science is Rust's retained
 * per-scan facts, and nothing here holds it.
 *
 * Export… opens the figure dialog (range, size, theme, SVG and PNG). PNG and
 * Copy repeat the current settings without it. The ⋯ menu holds the data
 * documents -- which carry both measured columns whatever is on screen -- and
 * the linked chromatogram + spectrum figure, which opens the same dialog.
 */

import type { ChromatogramExportFormat } from "./contracts";
import { formatCount } from "./format";
import { figureRefusal, QuickFigureActions, type PlotMenuItem } from "./QuickFigureActions";
import type {
  ChromatogramExportState,
  LinkedFigureExportState,
  LinkedFigureUnavailable,
  TraceVisibility,
} from "./usePreviewWorkspace";

/** The ⋯ menu's note on what the data documents hold, which CSV and TSV point at. */
const DATA_NOTE_ID = "chromatogram-data-note";

export interface ChromatogramExportToolsProps {
  /** The plot's own menu items (Set range…), above the figure items. */
  readonly leadingItems?: readonly PlotMenuItem[];
  readonly onOpenFigure: () => void;
  /** Opens the linked figure dialog, returning focus to `trigger`. */
  readonly onOpenLinkedFigure: (trigger: HTMLElement | null) => void;
  /**
   * Whether the session's one scientific export lane is occupied.
   *
   * Not this panel's own state. The selected spectrum shares the lane, so its
   * save or copy closes these actions exactly as one of this panel's own would.
   */
  readonly scientificExportBusy: boolean;
  readonly traces: TraceVisibility;
  readonly onExport: (format: ChromatogramExportFormat) => void;
  readonly onCopyPlot: () => void;
  readonly figureSettingsValidation: FigureSettingsValidation;
  /** Why a linked figure cannot be previewed now, or `null` when it can. */
  readonly linkedUnavailable: LinkedFigureUnavailable | null;
}

export function ChromatogramExportTools({ leadingItems, onOpenFigure, onOpenLinkedFigure, scientificExportBusy, traces, onExport, onCopyPlot,
  figureSettingsValidation, linkedUnavailable }: ChromatogramExportToolsProps) {
  const t = useUiMessages();
  // A panel of no series is refused by the contract, so a figure with neither
  // trace visible is not offered. The data exports are untouched.
  const nothingDrawn = !traces.tic && !traces.bpc;
  const reason = figureRefusal(t, scientificExportBusy, figureSettingsValidation, nothingDrawn);
  // Scan and trace choices belong to the viewer; range and size corrections
  // remain available inside the figure dialog.
  const linkedBlocked = linkedUnavailable !== null && (
    linkedUnavailable.code === "noChromatogram" || linkedUnavailable.code === "loading" ||
    linkedUnavailable.code === "noSpectrum" || linkedUnavailable.code === "noTrace"
  );
  return <QuickFigureActions busy={scientificExportBusy}
    figureUnavailable={figureSettingsValidation.render !== null || nothingDrawn}
    pngUnavailable={figureSettingsValidation.dpi !== null} reason={reason} leadingItems={leadingItems}
    onPreview={onOpenFigure} onPng={() => onExport("png")} onCopy={onCopyPlot}
    menuNote={{ id: DATA_NOTE_ID, text: t("viewerExportTraceHelp") }}
    menuItems={[
      ...(["csv", "tsv"] as const).map(format => ({ key: format, label: t("viewerExportFormat", { name: format.toUpperCase() }),
        // Refused while any scientific export runs: Rust holds one lane.
        refused: scientificExportBusy, reason: scientificExportBusy ? t("plotExportBusy") : null, describedBy: DATA_NOTE_ID,
        onSelect: () => { onExport(format); } })),
      { key: "linked", label: t("figurePreviewLinked"), refused: linkedBlocked, opensDialog: true,
        // Said whenever there is a reason; the ones the dialog can repair leave the item open.
        reason: linkedUnavailable === null ? null : describeUnavailable(linkedUnavailable, t), onSelect: onOpenLinkedFigure },
    ]} />;
}

/**
 * What the last chromatogram and linked exports did, over the plot's corner so
 * a result never takes height from the plot. Each result is its own named
 * region, so a reader can tell which export finished.
 */
export function ChromatogramExportStatus({ exportState, linkedExportState, onDismiss, onDismissLinked }: {
  readonly exportState: ChromatogramExportState;
  readonly linkedExportState: LinkedFigureExportState;
  readonly onDismiss: () => void;
  readonly onDismissLinked: () => void;
}) {
  const t = useUiMessages();
  return <div className="plot-status">
    <div aria-label={t("viewerChromatogramExportStatus")} aria-live="polite" className="spectrum-export-status" role="status">
      <ChromatogramExportResult onDismiss={onDismiss} state={exportState} />
    </div>
    <div aria-label={t("viewerLinkedStatus")} aria-live="polite" className="spectrum-export-status linked-figure-status" role="status">
      <LinkedFigureResult onDismiss={onDismissLinked} state={linkedExportState} />
    </div>
  </div>;
}

/** What one finished linked export says about itself. */
export function LinkedFigureResult({ state, onDismiss }: { readonly state: LinkedFigureExportState; readonly onDismiss: () => void }) {
  const t = useUiMessages();
  if (state.status === "idle") return null;
  if (state.status === "running") return <p className="spectrum-export-message">{describeRunning(state.operation, t)}</p>;
  const message = state.status === "cancelled" ? t("viewerExportCancelled") : state.status === "failed" ? ownedErrorMessage(state.error, t) :
    state.status === "copied" ? t("viewerLinkedCopied", { width: String(state.figure.width), height: String(state.figure.height),
      theme: t(state.figure.theme), index: formatCount(state.selectedIndex), count: state.sourceScanCount }) :
    t("viewerLinkedSaved", { name: state.fileName, index: formatCount(state.selectedIndex),
      rt: String(state.selectedRetentionTime), count: state.sourceScanCount });
  return <p className="spectrum-export-message"><ResultText message={message} detail={state.status === "failed" ? ownedErrorDetail(state.error, t) : null} />
    <DismissButton label={t("viewerLinkedDismiss")} onDismiss={onDismiss} />
  </p>;
}

export function ChromatogramExportResult({ state, onDismiss }: { readonly state: ChromatogramExportState; readonly onDismiss: () => void }) {
  const t = useUiMessages();
  if (state.status === "idle") return null;
  if (state.status === "running") return <p className="spectrum-export-message">{describeRunning(state.operation, t)}</p>;
  const message = state.status === "cancelled" ? t("viewerExportCancelled") : state.status === "failed" ? ownedErrorMessage(state.error, t) :
    state.status === "copied" ? t("viewerChromCopied", { width: String(state.figure.width), height: String(state.figure.height),
      theme: t(state.figure.theme), count: state.sourceScanCount }) :
    t("viewerChromSaved", { name: state.fileName, details: state.rowCount === null ?
      t("viewerChromSource", { count: state.sourceScanCount }) : t("viewerChromRows", { count: state.rowCount, total: state.sourceScanCount }) });
  return <p className="spectrum-export-message"><ResultText message={message} detail={state.status === "failed" ? ownedErrorDetail(state.error, t) : null} />
    <DismissButton onDismiss={onDismiss} />
  </p>;
}

/** A result on the plot head's line: cut with an ellipsis, whole on hover, its dismiss never cut. */
function ResultText({ message, detail }: { readonly message: string; readonly detail: string | null }) {
  return <span className="spectrum-export-text" title={detail === null ? message : `${message} ${detail}`}>{message}
    {detail === null ? null : <>{" "}<span className="notice-detail">{detail}</span></>}</span>;
}

/**
 * What a running export is waiting on, in the spectrum's words: a refused
 * action under the plot or in the figure dialog points at this line.
 */
function describeRunning(operation: string, t: UiMessage): string {
  return operation === "copy" ? t("viewerCopying") : t("viewerExportChoose", { name: operation.toUpperCase() });
}

function DismissButton({ onDismiss, label }: { readonly onDismiss: () => void; readonly label?: string }) {
  const t = useUiMessages();
  return <IconButton icon={<Icon name="close" />} label={label ?? t("viewerDismiss")} onClick={onDismiss} size="sm" />;
}

export function describeUnavailable(problem: LinkedFigureUnavailable, t: UiMessage): string {
  if (problem.code === "minimumHeight") return t("linkedHeight", { value: String(problem.minimum) });
  const keys = { noChromatogram: "linkedNoChromatogram", loading: "linkedLoading", noSpectrum: "linkedNoSpectrum",
    noTrace: "linkedNoTrace", outside: "linkedOutside", figureSettings: "linkedSettings" } as const;
  return t(keys[problem.code]);
}
