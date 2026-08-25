/**
 * What the run on screen can be exported as, and over how much of itself.
 *
 * A sibling of the chromatogram rather than a second view of it. Every number
 * this panel sends is a *request*: which run, by the opaque token Rust issued
 * with the preview; how much of it, by a scope and the viewport the viewer has
 * committed to; and which traces are on screen. The science is Rust's retained
 * per-scan facts, and nothing here holds it, reads it or could substitute for
 * it.
 *
 * Two things this surface has to say out loud, because a reader would otherwise
 * have to guess and would guess wrong in both directions:
 *
 * - a **figure** draws the traces that are visible, so hiding one changes the
 *   picture;
 * - a **data** export carries both measured columns whatever is on screen,
 *   because hiding a trace is a choice about a plot rather than a decision to
 *   leave measured science out of a file.
 */

import type { ChromatogramExportFormat, ChromatogramRangeScope, FigureTheme } from "./contracts";
import { FigureSettingsFields } from "./FigureSettingsFields";
import { formatCount } from "./format";
import type {
  ChromatogramExportState,
  FigureSettingsDraft,
  FigureSettingsField,
  TraceVisibility,
} from "./usePreviewWorkspace";
import type { RetentionTimeDomain } from "./viewer/scanModel";

/** What every identifier in this panel is named after. */
const FIGURE_PREFIX = "chromatogram";

const RANGE_SCOPES: readonly {
  readonly scope: ChromatogramRangeScope;
  readonly label: string;
}[] = [
  { scope: "full", label: "Full run" },
  { scope: "current", label: "Current range" },
];

const FIGURE_FORMATS: readonly {
  readonly format: ChromatogramExportFormat;
  readonly label: string;
  readonly recordsDpi: boolean;
}[] = [
  { format: "svg", label: "Export SVG…", recordsDpi: false },
  { format: "png", label: "Export PNG…", recordsDpi: true },
];

const DATA_FORMATS: readonly {
  readonly format: ChromatogramExportFormat;
  readonly label: string;
}[] = [
  { format: "csv", label: "Export CSV…" },
  { format: "tsv", label: "Export TSV…" },
];

export interface ChromatogramExportPanelProps {
  readonly exportState: ChromatogramExportState;
  /**
   * Whether the session's one scientific export lane is occupied.
   *
   * Not this panel's own state. The selected spectrum shares the lane, so its
   * save or copy closes these actions exactly as one of this panel's own would
   * -- otherwise a button that is visibly available reaches Rust and comes back
   * refused, which is a failure the interface caused rather than reported.
   *
   * Availability only. What this panel *says* still comes from `exportState`:
   * a running label names the operation this surface started, and a spectrum's
   * result is never shown here.
   */
  readonly scientificExportBusy: boolean;
  readonly rangeScope: ChromatogramRangeScope;
  readonly onRangeScope: (scope: ChromatogramRangeScope) => void;
  /**
   * The range a current-range export would cover, as the viewer committed it.
   *
   * `null` means nothing narrower has been committed, so the current range is
   * the whole run. Said in those words rather than filled in with the run's own
   * bounds, which would look like a choice the user had made.
   */
  readonly committedDomain: RetentionTimeDomain | null;
  readonly traces: TraceVisibility;
  readonly onExport: (format: ChromatogramExportFormat) => void;
  readonly onCopyPlot: () => void;
  readonly onDismiss: () => void;
  readonly figureSettings: FigureSettingsDraft;
  readonly renderSettingsProblem: string | null;
  readonly pngDpiProblem: string | null;
  readonly onFigureSetting: (field: FigureSettingsField, value: string) => void;
  readonly onFigureTheme: (theme: FigureTheme) => void;
}

export function ChromatogramExportPanel({
  exportState,
  scientificExportBusy,
  rangeScope,
  onRangeScope,
  committedDomain,
  traces,
  onExport,
  onCopyPlot,
  onDismiss,
  figureSettings,
  renderSettingsProblem,
  pngDpiProblem,
  onFigureSetting,
  onFigureTheme,
}: ChromatogramExportPanelProps) {
  // What this surface is doing *to the run it is showing*, which is what its
  // labels are allowed to say. An operation that outlived the preview it was
  // begun on still holds the lane -- so the controls below stay closed -- but
  // it is no longer this run being written, and no label here says it is.
  const running = exportState.status === "running" && exportState.namesVisibleRun;
  // A figure nothing can be drawn from is not offered. The data formats stay
  // live: a width nobody could draw at says nothing about a list of numbers.
  //
  // The lane is asked about first, and it is the *shared* lane rather than this
  // surface's own state. The settings rules below are unchanged and independent
  // of it: an unusable width still closes only the figures, an unusable
  // resolution still closes only the raster, and neither of them has anything
  // to do with the selected spectrum's settings.
  const figureBlocked = scientificExportBusy || renderSettingsProblem !== null;
  const rasterBlocked = figureBlocked || pngDpiProblem !== null;
  // A panel of no series is refused by the contract, so a figure with neither
  // trace visible is not offered either. The data exports are untouched.
  const nothingDrawn = !traces.tic && !traces.bpc;

  return (
    <div className="chromatogram-export-panel spectrum-export" id="chromatogram-export-panel">
      <fieldset className="chromatogram-export-range">
        <legend>Range</legend>
        <div
          aria-labelledby="chromatogram-range-label"
          className="spectrum-figure-themes"
          role="radiogroup"
        >
          <span className="visually-hidden" id="chromatogram-range-label">
            How much of the run to export
          </span>
          {RANGE_SCOPES.map(({ scope, label }) => (
            <label className="spectrum-figure-theme" key={scope}>
              <input
                checked={rangeScope === scope}
                name="chromatogram-range-scope"
                onChange={() => {
                  onRangeScope(scope);
                }}
                type="radio"
                value={scope}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="chromatogram-export-note">
          {committedDomain === null
            ? "Current range is the whole run until the viewport is changed."
            : `Current range is ${committedDomain.low.toFixed(4)} to ${committedDomain.high.toFixed(
                4,
              )}. A zoom or pan in progress is not exported until it settles.`}
        </p>
      </fieldset>
      <FigureSettingsFields
        idPrefix={FIGURE_PREFIX}
        onFigureSetting={onFigureSetting}
        onFigureTheme={onFigureTheme}
        pngDpiProblem={pngDpiProblem}
        renderSettingsProblem={renderSettingsProblem}
        settings={figureSettings}
      />
      <fieldset className="spectrum-figure-actions">
        <legend className="visually-hidden">Figure exports</legend>
        <p className="chromatogram-export-note">
          Figure outputs use the TIC/BPC traces currently visible on screen.
        </p>
        <div className="spectrum-export-actions">
          {FIGURE_FORMATS.map(({ format, label, recordsDpi }) => (
            <button
              className="secondary-button"
              // Every figure action while any scientific export is running --
              // this panel's own or the selected spectrum's. Rust holds a
              // single lane across both surfaces and refuses a second, so
              // leaving these live would offer an action already known to fail.
              disabled={(recordsDpi ? rasterBlocked : figureBlocked) || nothingDrawn}
              key={format}
              onClick={() => {
                onExport(format);
              }}
              type="button"
            >
              {running && exportState.operation === format
                ? `Exporting ${format.toUpperCase()}…`
                : label}
            </button>
          ))}
          <button
            className="secondary-button"
            // The figure only. A clipboard image carries no physical
            // resolution, so an unusable one leaves this action live.
            disabled={figureBlocked || nothingDrawn}
            onClick={onCopyPlot}
            type="button"
          >
            {running && exportState.operation === "copy" ? "Copying plot…" : "Copy plot"}
          </button>
        </div>
      </fieldset>
      <fieldset className="spectrum-data-actions">
        <legend>Data</legend>
        <p className="chromatogram-export-note">
          Data exports always include both TIC and BPC source columns.
        </p>
        <div className="spectrum-export-actions">
          {DATA_FORMATS.map(({ format, label }) => (
            <button
              className="secondary-button"
              // Closed while any scientific export is running, for the same one
              // lane. Not closed by a figure setting, because none of them
              // reaches a data document, and not by a hidden trace either.
              disabled={scientificExportBusy}
              key={format}
              onClick={() => {
                onExport(format);
              }}
              type="button"
            >
              {running && exportState.operation === format
                ? `Exporting ${format.toUpperCase()}…`
                : label}
            </button>
          ))}
        </div>
      </fieldset>
      {/*
        A live region rather than a dialog. An export finishes while the user is
        looking at the run, and interrupting them to say so would be a worse
        interruption than the file being saved was.
      */}
      <div aria-live="polite" className="spectrum-export-status" role="status">
        <ChromatogramExportResult onDismiss={onDismiss} state={exportState} />
      </div>
    </div>
  );
}

/** What one finished export says about itself. */
function ChromatogramExportResult({
  state,
  onDismiss,
}: {
  readonly state: ChromatogramExportState;
  readonly onDismiss: () => void;
}) {
  if (state.status === "idle" || state.status === "running") {
    return null;
  }
  if (state.status === "cancelled") {
    return (
      <p className="spectrum-export-message">
        Export cancelled. Nothing was saved.{" "}
        <DismissButton onDismiss={onDismiss} />
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="spectrum-export-message">
        {state.error.summary}{" "}
        {/* Both halves, exactly as the selected spectrum's own failure does.
            The summary says what happened; the detail is where a failure puts
            the part the user has to act on -- above all that the export could
            not remove the temporary file it left in their folder. The two
            surfaces share `spectrum_write_failure`, so they receive the same
            `detail`, and a panel that rendered only the summary would leave a
            `.mscanvas-export-*` file in a folder having told nobody. */}
        {state.error.detail === null ? null : (
          <span className="notice-detail">{state.error.detail}</span>
        )}
        <DismissButton onDismiss={onDismiss} />
      </p>
    );
  }
  if (state.status === "copied") {
    return (
      <p className="spectrum-export-message">
        Copied the chromatogram at {state.figure.width}×{state.figure.height} in the{" "}
        {state.figure.theme} theme, from a run of {formatCount(state.sourceScanCount)} scans.{" "}
        <DismissButton onDismiss={onDismiss} />
      </p>
    );
  }
  // A data document says how many source scans it holds; a figure says what it
  // was drawn as. Zero scans in a range is a successful export and is reported
  // as one -- the figure for that range may still draw the segment crossing it.
  const scans =
    state.rowCount === null
      ? `from a run of ${formatCount(state.sourceScanCount)} scans`
      : `with ${formatCount(state.rowCount)} source scans from a run of ${formatCount(
          state.sourceScanCount,
        )} scans`;
  return (
    <p className="spectrum-export-message">
      Saved {state.fileName} {scans}. <DismissButton onDismiss={onDismiss} />
    </p>
  );
}

function DismissButton({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <button className="link-button" onClick={onDismiss} type="button">
      Dismiss
    </button>
  );
}
