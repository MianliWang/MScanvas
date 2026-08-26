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
 *
 * The linked section at the bottom is a third surface over the same two
 * sources. It exports one figure of two ordered panels -- this chromatogram
 * above, the complete selected spectrum below -- and it lives here rather than
 * beside the spectrum because the range and the traces it needs are the ones
 * chosen here. It offers no data document: a combined table would have to
 * interleave two different measurements or drop the link.
 */

import type {
  ChromatogramExportFormat,
  ChromatogramRangeScope,
  FigureTheme,
  LinkedFigureFormat,
} from "./contracts";
import { FigureSettingsFields } from "./FigureSettingsFields";
import { formatCount } from "./format";
import type {
  ChromatogramExportState,
  FigureSettingsDraft,
  FigureSettingsField,
  LinkedFigureExportState,
  TraceVisibility,
} from "./usePreviewWorkspace";
import type { RetentionTimeDomain } from "./viewer/scanModel";

/** What every identifier in this panel is named after. */
const FIGURE_PREFIX = "chromatogram";

/**
 * How many decimals a retention time is written with.
 *
 * The same four this panel's own range note uses two paragraphs above, and the
 * same four the scan table, the plot readout and the run summary use. A raw
 * number here would print `0.1` where the table beside it prints `0.1000`, and a
 * reader comparing the two has no way to know they are the same scan.
 */
const RETENTION_TIME_DECIMALS = 4;

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

/**
 * The linked figure's two drawn outputs.
 *
 * Drawings only, and the absence is the point rather than an omission: there is
 * no honest combined table of a chromatogram and a spectrum, so the linked
 * surface offers none and the two single-source exports keep theirs.
 */
const LINKED_FIGURE_FORMATS: readonly {
  readonly format: LinkedFigureFormat;
  readonly label: string;
  readonly recordsDpi: boolean;
}[] = [
  { format: "svg", label: "Export linked SVG…", recordsDpi: false },
  { format: "png", label: "Export linked PNG…", recordsDpi: true },
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
  /** What the linked two-panel surface is doing, and what it last did. */
  readonly linkedExportState: LinkedFigureExportState;
  /**
   * Why a linked figure cannot be exported right now, or `null` when it can.
   *
   * Shown rather than only acted on. A closed control that says nothing is a
   * control the reader has to guess about, and every one of these sentences
   * names something they can change.
   */
  readonly linkedUnavailable: string | null;
  readonly onExportLinked: (format: LinkedFigureFormat) => void;
  readonly onCopyLinkedPlot: () => void;
  readonly onDismissLinked: () => void;
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
  linkedExportState,
  linkedUnavailable,
  onExportLinked,
  onCopyLinkedPlot,
  onDismissLinked,
}: ChromatogramExportPanelProps) {
  // What this surface is doing *to the run it is showing*, which is what its
  // labels are allowed to say. An operation that outlived the preview it was
  // begun on still holds the lane -- so the controls below stay closed -- but
  // it is no longer this run being written, and no label here says it is.
  const running = exportState.status === "running" && exportState.namesVisibleRun;
  // The same rule for the linked surface, and it is about the *pair*: selecting
  // another scan is as much a change of what is being exported as opening
  // another run is. The lane stays held either way -- Rust is still writing --
  // so the actions below stay closed while the label stops claiming this pair
  // is the one being written.
  const linkedRunning =
    linkedExportState.status === "running" && linkedExportState.namesVisiblePair;
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

        Named, because the linked section below has one of its own: two status
        regions in one surface that both announce "Saved ..." and neither of
        which says what it is about leave a reader unable to tell which export
        finished.
      */}
      <div
        aria-label="Chromatogram export status"
        aria-live="polite"
        className="spectrum-export-status"
        role="status"
      >
        <ChromatogramExportResult onDismiss={onDismiss} state={exportState} />
      </div>
      <LinkedFigureSection
        linkedRunning={linkedRunning}
        onCopyLinkedPlot={onCopyLinkedPlot}
        onDismissLinked={onDismissLinked}
        onExportLinked={onExportLinked}
        pngDpiProblem={pngDpiProblem}
        scientificExportBusy={scientificExportBusy}
        state={linkedExportState}
        unavailable={linkedUnavailable}
      />
    </div>
  );
}

/** What every identifier in the linked section is named after. */
const LINKED_PREFIX = "chromatogram-linked";

/** Where the linked section says why its actions are closed. */
const LINKED_UNAVAILABLE_ID = `${LINKED_PREFIX}-unavailable`;

/**
 * What the section says about itself when it can be used.
 *
 * A constant rather than markup, because it shares one element with the reason
 * that replaces it -- see the comment where that element is rendered.
 */
const LINKED_DESCRIPTION =
  "Two panels: this chromatogram over the range above, marked at the selected scan, and that " +
  "scan\u2019s complete spectrum below \u2014 always the whole spectrum, whatever the range.";

/**
 * The linked two-panel figure, as one compact section of this surface.
 *
 * Three actions and one sentence about each thing that would refuse them. The
 * section is always rendered while the export surface is open, including when
 * nothing can be exported: a control that disappears when it stops working
 * teaches nobody why, and this one has a reason to give.
 *
 * Availability is asked in the same order the workspace answers it, and one
 * extra rule lives only here -- a resolution no PNG could record closes the
 * raster and nothing else, because an SVG has no pixels to give a physical size
 * to and a clipboard image carries no resolution at all.
 */
function LinkedFigureSection({
  state,
  linkedRunning,
  unavailable,
  scientificExportBusy,
  pngDpiProblem,
  onExportLinked,
  onCopyLinkedPlot,
  onDismissLinked,
}: {
  readonly state: LinkedFigureExportState;
  /** Whether a running linked operation still names the pair on screen. */
  readonly linkedRunning: boolean;
  readonly unavailable: string | null;
  readonly scientificExportBusy: boolean;
  readonly pngDpiProblem: string | null;
  readonly onExportLinked: (format: LinkedFigureFormat) => void;
  readonly onCopyLinkedPlot: () => void;
  readonly onDismissLinked: () => void;
}) {
  // The shared lane first, then this surface's own reasons. Both are asked
  // again in Rust, which is the boundary that decides; this is what keeps an
  // action that is already known to be refused from being offered.
  const blocked = scientificExportBusy || unavailable !== null;
  const rasterBlocked = blocked || pngDpiProblem !== null;
  // Named for a screen reader only where there is something to name, so a
  // usable section does not point at an element that is not there.
  const describedBy = unavailable === null ? undefined : LINKED_UNAVAILABLE_ID;

  return (
    <fieldset className="linked-figure-actions" id={`${LINKED_PREFIX}-section`}>
      <legend>Linked chromatogram + spectrum</legend>
      {/*
        One sentence, in one element that is a live region from the start.

        Which sentence depends on whether the reader can act.

        Measured, in the state where the three actions are live: this section
        costs the open surface 116px at 1366x768 and at 960x640, and 96px at
        1920x1080 where the sentence fits on one line. Two stacked paragraphs
        cost 163px, 163px and 122px for the same states -- and at 1366x768 the
        difference decides whether the plot's top edge is still inside the
        614px viewer column when the surface is open. The three panels' floors
        were measured for M4.3 and the export surface's own scroll owner was
        accepted on that arithmetic, so a third section has to fit inside it
        rather than spend it.

        Which sentence to drop is not a coin toss. A reader who cannot use this
        yet needs to know what to change; a reader who can needs to know what
        they will get. Neither is served by being shown the other's sentence
        underneath their own.
      */}
      {/*
        What is read, and what is announced, are two elements doing two jobs.

        The reason *appears* while the reader is somewhere else -- typing a
        height, choosing a range scope -- and closes three controls as it does.
        A correction nobody is told about has to be hunted for, and a disabled
        control cannot be tabbed to, so its `aria-describedby` is not a way to
        find one either. So it has to be announced.

        Two conditional paragraphs did not announce it, and looked as though
        they did: React reconciles same-typed siblings in one slot, so the node
        was reused and `aria-live` arrived in the very commit that replaced the
        text. Nothing was watching a live region there until the mutation
        itself.

        Making the visible paragraph live instead announced the wrong thing.
        The element also carries the description, so becoming *usable* -- the
        state nobody needs telling about -- read the whole of it aloud. The two
        figure-setting problems on this surface avoid that by holding only the
        problem and emptying it on recovery, and that is what the hidden region
        below does. It costs no layout, so the visible paragraph stays the one
        sentence this section can afford.
      */}
      <p
        className="chromatogram-export-note"
        id={unavailable === null ? undefined : LINKED_UNAVAILABLE_ID}
      >
        {unavailable ?? LINKED_DESCRIPTION}
      </p>
      <p
        aria-live="polite"
        className="visually-hidden"
        data-live-region="linked-figure-availability"
      >
        {unavailable ?? ""}
      </p>
      <div className="spectrum-export-actions">
        {LINKED_FIGURE_FORMATS.map(({ format, label, recordsDpi }) => (
          <button
            aria-describedby={describedBy}
            className="secondary-button"
            disabled={recordsDpi ? rasterBlocked : blocked}
            key={format}
            onClick={() => {
              onExportLinked(format);
            }}
            type="button"
          >
            {linkedRunning && state.status === "running" && state.operation === format
              ? `Exporting linked ${format.toUpperCase()}…`
              : label}
          </button>
        ))}
        <button
          aria-describedby={describedBy}
          className="secondary-button"
          // A clipboard image carries no physical resolution, so an unusable
          // one leaves this action live -- the same rule the chromatogram's own
          // Copy plot follows.
          disabled={blocked}
          onClick={onCopyLinkedPlot}
          type="button"
        >
          {linkedRunning && state.status === "running" && state.operation === "copy"
            ? "Copying linked plot…"
            : "Copy linked plot"}
        </button>
      </div>
      <div
        aria-label="Linked figure export status"
        aria-live="polite"
        className="spectrum-export-status linked-figure-status"
        role="status"
      >
        <LinkedFigureResult onDismiss={onDismissLinked} state={state} />
      </div>
    </fieldset>
  );
}

/** What one finished linked export says about itself. */
function LinkedFigureResult({
  state,
  onDismiss,
}: {
  readonly state: LinkedFigureExportState;
  readonly onDismiss: () => void;
}) {
  if (state.status === "idle" || state.status === "running") {
    return null;
  }
  if (state.status === "cancelled") {
    return (
      <p className="spectrum-export-message">
        Linked export cancelled. Nothing was saved. <DismissButton label="Dismiss linked export message" onDismiss={onDismiss} />
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="spectrum-export-message">
        {state.error.summary}{" "}
        {/* Both halves, exactly as the two single-source surfaces do. The
            detail is where a failure puts the part the user has to act on --
            above all that the export could not remove the temporary file it
            left in their folder. */}
        {state.error.detail === null ? null : (
          <span className="notice-detail">{state.error.detail}</span>
        )}
        <DismissButton label="Dismiss linked export message" onDismiss={onDismiss} />
      </p>
    );
  }
  if (state.status === "copied") {
    return (
      <p className="spectrum-export-message">
        Copied the linked figure at {state.figure.width}×{state.figure.height} in the{" "}
        {state.figure.theme} theme, marking spectrum {formatCount(state.selectedIndex)} in a run of{" "}
        {formatCount(state.sourceScanCount)} scans. <DismissButton label="Dismiss linked export message" onDismiss={onDismiss} />
      </p>
    );
  }
  // The index rather than the retention time, because an index names one scan
  // and a retention time may be shared by several. The time is beside it as the
  // coordinate the marker was drawn at, which is what it is.
  return (
    <p className="spectrum-export-message">
      Saved {state.fileName}, marking spectrum {formatCount(state.selectedIndex)} at retention time{" "}
      {state.selectedRetentionTime.toFixed(RETENTION_TIME_DECIMALS)} in a run of{" "}
      {formatCount(state.sourceScanCount)} scans.{" "}
      <DismissButton label="Dismiss linked export message" onDismiss={onDismiss} />
    </p>
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

function DismissButton({
  onDismiss,
  label,
}: {
  readonly onDismiss: () => void;
  /**
   * What this control is called where more than one of them can be on screen.
   *
   * The word alone is enough beside a single message. It stops being enough in
   * a surface holding two, which is what the linked section makes possible: a
   * reader listing the controls hears "Dismiss" twice and cannot tell which
   * result each one clears.
   */
  readonly label?: string;
}) {
  return (
    <button aria-label={label} className="link-button" onClick={onDismiss} type="button">
      Dismiss
    </button>
  );
}
