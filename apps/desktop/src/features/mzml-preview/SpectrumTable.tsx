import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SpectrumRow, SpectrumTable as SpectrumTableModel } from "./contracts";
import {
  formatCount,
  formatIntensity,
  formatMz,
  formatRetentionTimeValue,
} from "./format";
import type { Selection, SelectionConsumer } from "./viewer/interactionState";
import { consumeSelection, initialSelectionConsumer } from "./viewer/interactionState";
import { revealScrollTop } from "./viewer/renderGeometry";
import type { SpectrumSelectionAvailability } from "./viewer/selectionAvailability";
import { SPECTRUM_SELECTION_NOTICE_ID } from "./viewer/selectionAvailability";

/** Fixed row height keeps the windowing arithmetic exact. Mirrored in CSS. */
const ROW_HEIGHT = 30;
/**
 * The header row's height, which is a row's.
 *
 * It sits inside the scrolling element so that a column label and its values
 * share one horizontal position, and stays put vertically. That costs the top
 * of the scrolling box: everything below has to be placed as though the box
 * began one row lower, or a row scrolled to would arrive behind the header.
 */
const HEADER_HEIGHT = ROW_HEIGHT;
/** Rows kept rendered outside the viewport so scrolling does not flash gaps. */
const OVERSCAN = 10;
/**
 * Used when the viewport has not been measured yet. jsdom reports a zero
 * client height, so without this a test would observe an empty table.
 */
const FALLBACK_VIEWPORT_HEIGHT = 600;

const COLUMNS = [
  "Index",
  // Its own column, because the native identifier carries the scan number at
  // the end and a truncated identifier is what every row would look like.
  "Scan",
  "Identifier",
  "MS level",
  "Retention time",
  "Base peak m/z",
  "Base peak intensity",
  "Total ion current",
  "Precursor m/z",
] as const;

export interface SpectrumTableProps {
  readonly table: SpectrumTableModel;
  /**
   * The one persistent selection, as the interaction reducer holds it.
   *
   * The whole commit rather than the index alone, because the two answer
   * different questions. "Which row is selected" does not change when the same
   * scan is selected again -- and by then the user may have scrolled it out of
   * view, which is exactly when it has to come back. The revision is what makes
   * that commit visible here; see {@link consumeSelection}.
   */
  readonly selection: Selection | null;
  readonly onSelect: (index: number) => void;
  readonly onRendered: (renderedRowCount: number, milliseconds: number) => void;
  /**
   * Steps to the scan before or after the selected one, in this table's order.
   *
   * Rendered here rather than beside the plot because the order they walk is
   * this table's, and because a preview whose chromatogram cannot be drawn
   * still has rows to step through.
   */
  readonly onSelectPrevious: () => void;
  readonly onSelectNext: () => void;
  readonly canSelectPrevious: boolean;
  readonly canSelectNext: boolean;
  /**
   * Whether an activation may commit a scan, from the one selection authority.
   *
   * The same value the steps above are derived from, and the same one the plot
   * reads. It governs committing only: a reader waiting for a conversion can
   * still scroll this table, walk it with the arrow keys and read every value
   * in it, because none of that asks the backend for anything.
   */
  readonly selectionAvailability: SpectrumSelectionAvailability;
}

/**
 * The run's scans, windowed.
 *
 * Memoized because the viewer above it publishes a new interaction state
 * whenever the pointer crosses from one scan to another, which at a full-run
 * zoom is most pointer frames. None of that reaches this table's props, and
 * this is what makes "does not reach" mean "does not re-render".
 */
export const SpectrumTable = memo(function SpectrumTable({
  table,
  selection,
  onSelect,
  onRendered,
  onSelectPrevious,
  onSelectNext,
  canSelectPrevious,
  canSelectNext,
  selectionAvailability,
}: SpectrumTableProps) {
  const canCommit = selectionAvailability.status === "available";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const [focusRow, setFocusRow] = useState(0);
  const pendingFocus = useRef(false);
  const selectedIndex = selection?.index ?? null;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const measure = () => {
      setViewportHeight(viewport.clientHeight || FALLBACK_VIEWPORT_HEIGHT);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, []);

  const rows = table.rows;
  const rowCount = rows.length;
  /** What the viewport has left for rows once the header has its row. */
  const rowsHeight = Math.max(ROW_HEIGHT, viewportHeight - HEADER_HEIGHT);
  const visibleCount = Math.ceil(rowsHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rowCount, start + visibleCount);
  const rendered = rows.slice(start, end);
  // Exactly one rendered row carries the tab stop. Extending the window to
  // reach a focused row that has been scrolled far away would mount every row
  // in between, so the stop moves to the nearest rendered row instead.
  const focusStop = Math.min(end - 1, Math.max(start, focusRow));

  const renderStartedAt = useRef(0);
  renderStartedAt.current =
    typeof performance === "undefined" ? 0 : performance.now();
  useEffect(() => {
    // Only the windowed slice bounds change what was actually rendered.
    onRendered(
      rendered.length,
      (typeof performance === "undefined" ? 0 : performance.now()) - renderStartedAt.current,
    );
  }, [start, end, rowCount, onRendered, rendered.length]);

  useLayoutEffect(() => {
    if (!pendingFocus.current) {
      return;
    }
    pendingFocus.current = false;
    const viewport = viewportRef.current;
    viewport?.querySelector<HTMLElement>(`[data-row-position="${focusRow}"]`)?.focus();
  }, [focusRow, start, end]);

  /**
   * Brings a row into view and moves the tab stop to it, without taking focus.
   *
   * Where the scroll goes is `revealScrollTop`'s answer and nothing else's:
   * this table's header is `position: sticky`, so it stays in normal flow and
   * the row canvas already begins after it, and a second copy of that
   * arithmetic here is how the header came to be subtracted twice once before.
   *
   * DOM focus is deliberately not moved. A selection made in the plot, or with
   * Previous/Next, has to reveal its row -- a marker pointing at a scan the
   * table is not showing is a link the user cannot follow -- but taking focus
   * out of the control they are operating would send the next key press
   * somewhere they did not ask for. The roving tab stop still moves, so tabbing
   * in afterwards lands on the selected row.
   */
  const revealRow = useCallback(
    (position: number) => {
      const clamped = Math.min(rowCount - 1, Math.max(0, position));
      setFocusRow(clamped);
      const viewport = viewportRef.current;
      if (viewport === null) {
        return;
      }
      const next = revealScrollTop(
        {
          rowHeight: ROW_HEIGHT,
          headerHeight: HEADER_HEIGHT,
          viewportHeight: viewport.clientHeight || viewportHeight,
        },
        clamped,
        viewport.scrollTop,
      );
      if (next !== viewport.scrollTop) {
        viewport.scrollTop = next;
        setScrollTop(next);
      }
    },
    [rowCount, viewportHeight],
  );

  /** The same reveal, plus the focus only a keyboard move inside the table earns. */
  const moveFocus = useCallback(
    (position: number) => {
      pendingFocus.current = true;
      revealRow(position);
    },
    [revealRow],
  );

  /**
   * This table's bookmark into the one selection revision.
   *
   * Not a second selection: there is one commit count in the interaction state,
   * and `consumeSelection` decides whether this surface has acted on the
   * current one. A new revision is acted on including when it names the scan
   * already selected; the same revision is never acted on twice however many
   * renders, resizes or gesture domains arrive in between, which is what keeps
   * a scroll the user made from being undone.
   */
  const consumer = useRef<SelectionConsumer>(initialSelectionConsumer);
  useEffect(() => {
    const outcome = consumeSelection(consumer.current, selection);
    consumer.current = outcome.consumer;
    if (outcome.consumed === null) {
      return;
    }
    const position = rows.findIndex((row) => row.index === outcome.consumed?.index);
    if (position < 0) {
      return;
    }
    revealRow(position);
  }, [revealRow, rows, selection]);

  /**
   * Arrow keys move focus without selecting. Selection is committed with Enter
   * or Space because each selection launches one backend process, and
   * selection-following-focus would launch one per key press.
   *
   * Which is also why only those two are gated when selection is unavailable.
   * Movement costs nothing and stays; the commit is the part that would have
   * launched a process the operation is going to refuse.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, position: number) => {
      const pageSize = Math.max(1, Math.floor(rowsHeight / ROW_HEIGHT) - 1);
      switch (event.key) {
        case "ArrowDown":
          moveFocus(position + 1);
          break;
        case "ArrowUp":
          moveFocus(position - 1);
          break;
        case "PageDown":
          moveFocus(position + pageSize);
          break;
        case "PageUp":
          moveFocus(position - pageSize);
          break;
        case "Home":
          moveFocus(0);
          break;
        case "End":
          moveFocus(rowCount - 1);
          break;
        case "Enter":
        case " ":
          if (canCommit) {
            onSelect(rows[position]?.index ?? 0);
          }
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [canCommit, moveFocus, onSelect, rowCount, rows, rowsHeight],
  );

  return (
    <section aria-labelledby="spectrum-table-heading" className="panel spectrum-table-panel">
      <header className="panel-header compact">
        <div>
          <h2 id="spectrum-table-heading">Spectra</h2>
          <p>
            {formatCount(table.totalRowCount)}
            {table.totalRowCount === 1 ? " spectrum" : " spectra"}
            {table.truncated
              ? ` · showing the first ${formatCount(rowCount)} rows`
              : " · all rows loaded"}
            {canCommit ? " · Enter or Space opens the focused row" : ""}
            {/* Stated where the values are, not only in the detail panel. A
                bare number invites being read as minutes. */}
            {" · retention times have no unit because the file reports none"}
          </p>
        </div>
        {/* Beside the heading rather than under the plot: these step through
            this table's order, and they stay available for a preview whose
            chromatogram cannot be drawn at all. */}
        <fieldset className="spectrum-scan-steps">
          <legend className="visually-hidden">Scan navigation</legend>
          <button
            className="secondary-button"
            disabled={!canSelectPrevious}
            onClick={onSelectPrevious}
            type="button"
          >
            Previous scan
          </button>
          <button
            className="secondary-button"
            disabled={!canSelectNext}
            onClick={onSelectNext}
            type="button"
          >
            Next scan
          </button>
        </fieldset>
      </header>

      {table.truncated ? (
        <p className="notice notice-warning" role="note">
          This run has more spectra than one preview transfers. The rows below are the first{" "}
          {formatCount(rowCount)} and are not the whole table. Previous scan and Next scan
          step through these rows and stop at the end of them, which is not the end of the
          run.
        </p>
      ) : null}

      <div
        aria-colcount={COLUMNS.length}
        /*
         * The reason, while there is one -- described, never disabled. A
         * disabled grid is a grid that cannot be navigated, and every value in
         * it is still readable and still true.
         */
        aria-describedby={canCommit ? undefined : SPECTRUM_SELECTION_NOTICE_ID}
        aria-labelledby="spectrum-table-heading"
        aria-rowcount={table.totalRowCount + 1}
        className="spectrum-table"
        role="grid"
      >
        {/* The one thing that scrolls. The header is inside it rather than
            above it, so a column label and the values under it hold one
            horizontal position between them -- not two that something has to
            keep in step. */}
        <div
          className="spectrum-table-viewport"
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
          }}
          ref={viewportRef}
          role="presentation"
        >
          {/* Carries the width both grids resolve against, which is what makes
              the label and the value the same column rather than two that
              happen to agree. */}
          <div className="spectrum-table-track" role="presentation">
            <div aria-rowindex={1} className="spectrum-table-row spectrum-table-head" role="row">
              {COLUMNS.map((column, columnIndex) => (
                <span
                  aria-colindex={columnIndex + 1}
                  className="spectrum-table-cell"
                  key={column}
                  role="columnheader"
                >
                  {column}
                </span>
              ))}
            </div>

            <div
              className="spectrum-table-canvas"
              role="presentation"
              style={{ height: `${rowCount * ROW_HEIGHT}px` }}
            >
              <div
                className="spectrum-table-window"
                role="presentation"
                style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
              >
                {rendered.map((row, offset) => (
                  <SpectrumTableRow
                    canCommit={canCommit}
                    isFocusStop={start + offset === focusStop}
                    isSelected={selectedIndex === row.index}
                    key={row.index}
                    onActivate={(position) => {
                      // Activating a row also makes it the tab stop, so keyboard
                      // navigation resumes from what the user just chose. That
                      // part happens either way: where the row cannot be
                      // committed, moving the tab stop is still what the click
                      // meant, and losing it would be a second surprise.
                      setFocusRow(position);
                      if (canCommit) {
                        onSelect(row.index);
                      }
                    }}
                    onKeyDown={handleKeyDown}
                    position={start + offset}
                    row={row}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});

interface SpectrumTableRowProps {
  readonly row: SpectrumRow;
  readonly position: number;
  readonly isSelected: boolean;
  readonly isFocusStop: boolean;
  /** Whether activating this row would commit it. */
  readonly canCommit: boolean;
  readonly onActivate: (position: number) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, position: number) => void;
}

function SpectrumTableRow({
  row,
  position,
  isSelected,
  isFocusStop,
  canCommit,
  onActivate,
  onKeyDown,
}: SpectrumTableRowProps) {
  const cells = [
    formatCount(row.index),
    row.scanNumber === null ? "—" : formatCount(row.scanNumber),
    row.identifier,
    `MS${row.msLevel}`,
    formatRetentionTimeValue(row.retentionTime),
    formatMz(row.basePeakMz),
    formatIntensity(row.basePeakIntensity),
    formatIntensity(row.totalIonCurrent),
    row.precursorMz === null ? "—" : formatMz(row.precursorMz),
  ];

  return (
    <div
      /*
       * On the row rather than on the grid: this row cannot be activated, and
       * the table it is in can still be navigated. The tab stop and the reading
       * are untouched.
       */
      aria-disabled={canCommit ? undefined : true}
      aria-rowindex={position + 2}
      aria-selected={isSelected}
      className={`spectrum-table-row${isSelected ? " is-selected" : ""}`}
      data-row-position={position}
      onClick={() => {
        onActivate(position);
      }}
      onKeyDown={(event) => {
        onKeyDown(event, position);
      }}
      role="row"
      tabIndex={isFocusStop ? 0 : -1}
    >
      {cells.map((cell, columnIndex) => (
        <span
          aria-colindex={columnIndex + 1}
          className="spectrum-table-cell"
          key={COLUMNS[columnIndex]}
          role="gridcell"
        >
          {columnIndex === 0 ? (
            <>
              {/* A glyph, not only a highlight, so selection survives
                  greyscale, high contrast and colour-blind viewing. */}
              <span aria-hidden="true" className="spectrum-table-marker">
                {isSelected ? "▸" : ""}
              </span>
              {isSelected ? <span className="visually-hidden">Selected, </span> : null}
              {cell}
            </>
          ) : (
            cell
          )}
        </span>
      ))}
    </div>
  );
}
