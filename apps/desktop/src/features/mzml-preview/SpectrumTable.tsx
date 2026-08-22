import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SpectrumRow, SpectrumTable as SpectrumTableModel } from "./contracts";
import {
  formatCount,
  formatIntensity,
  formatMz,
  formatRetentionTimeValue,
} from "./format";

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
  readonly selectedIndex: number | null;
  /**
   * How many persistent selection commits have happened.
   *
   * The reveal watches this as well as the row, because the two answer
   * different questions. "Which row is selected" does not change when the same
   * scan is selected again -- and by then the user may have scrolled it out of
   * view, which is exactly when it has to come back.
   */
  readonly selectionRevision?: number;
  readonly onSelect: (index: number) => void;
  readonly onRendered: (renderedRowCount: number, milliseconds: number) => void;
}

export function SpectrumTable({
  table,
  selectedIndex,
  selectionRevision = 0,
  onSelect,
  onRendered,
}: SpectrumTableProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const [focusRow, setFocusRow] = useState(0);
  const pendingFocus = useRef(false);

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

  const rowCount = table.rows.length;
  /** What the viewport has left for rows once the header has its row. */
  const rowsHeight = Math.max(ROW_HEIGHT, viewportHeight - HEADER_HEIGHT);
  const visibleCount = Math.ceil(rowsHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rowCount, start + visibleCount);
  const rendered = table.rows.slice(start, end);
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
   * Split from {@link moveFocus} because who asked matters. A selection made in
   * the chromatogram, or with Previous/Next, has to reveal its row -- a marker
   * pointing at a scan the table is not showing is a link the user cannot
   * follow. But taking DOM focus out of the control they are operating would
   * mean the next arrow key went somewhere they did not expect, and a button
   * they were about to press again would no longer be under the keyboard.
   *
   * The roving tab stop still moves, so tabbing into the table afterwards lands
   * on the selected row rather than back at the top.
   */
  const revealRow = useCallback(
    (position: number) => {
      const clamped = Math.min(rowCount - 1, Math.max(0, position));
      setFocusRow(clamped);
      const viewport = viewportRef.current;
      if (viewport === null) {
        return;
      }
      const top = clamped * ROW_HEIGHT;
      // What the rows have, not what the viewport has: the header covers the
      // first row's worth of it wherever the scroll happens to be, so a row
      // brought to the bottom edge has to stop that much sooner.
      const height = Math.max(
        ROW_HEIGHT,
        (viewport.clientHeight || viewportHeight) - HEADER_HEIGHT,
      );
      // The sticky header sits inside this scrolling box, so a row brought to
      // exactly `scrollTop` arrives underneath it: present, focused, and not
      // visible. Stopping a header's worth sooner is what the lower branch
      // already does for the bottom edge.
      if (top - HEADER_HEIGHT < viewport.scrollTop) {
        const next = Math.max(0, top - HEADER_HEIGHT);
        viewport.scrollTop = next;
        setScrollTop(next);
      } else if (top + ROW_HEIGHT > viewport.scrollTop + height) {
        const next = top + ROW_HEIGHT - height;
        viewport.scrollTop = next;
        setScrollTop(next);
      }
    },
    [rowCount, viewportHeight],
  );

  /** The same reveal, plus the focus that only a keyboard move inside the table earns. */
  const moveFocus = useCallback(
    (position: number) => {
      pendingFocus.current = true;
      revealRow(position);
    },
    [revealRow],
  );

  // A selection that did not come from this table -- the chromatogram, or
  // Previous/Next -- still has to be visible here.
  //
  // Keyed to selection *commits*, not only to the selected value. Four facts
  // about a row are distinct, and this effect has been wrong about two of them
  // in turn: which row is selected, which row is the tab stop, whether the row
  // is visible, and whether it has DOM focus.
  //
  // An earlier version skipped the reveal when the selected row was already the
  // tab stop -- but `focusRow` is where the keyboard would land, not what is on
  // screen. Revealing on every position change fixed that and left a second
  // gap: selecting the scan that is already selected does not move the
  // position, so a user who selects a scan, scrolls its row away and clicks the
  // same scan again was asking for it back and getting nothing. The revision
  // makes that commit visible here.
  //
  // Revealing on every commit is safe because `revealRow` is already the right
  // shape: it scrolls only when the row is outside the viewport, and it never
  // takes DOM focus. A commit from a visible focused row still moves nothing.
  const selectedPosition =
    selectedIndex === null ? -1 : table.rows.findIndex((row) => row.index === selectedIndex);
  const reveal = useRef(revealRow);
  reveal.current = revealRow;
  useEffect(() => {
    if (selectedPosition >= 0) {
      // Through a ref, so this runs when the *selection* moves and not when the
      // callback's identity changes: depending on `revealRow` would scroll back
      // to the selected row on every resize, undoing wherever the user had
      // scrolled to.
      reveal.current(selectedPosition);
    }
  }, [selectedPosition, selectionRevision]);

  /**
   * Arrow keys move focus without selecting. Selection is committed with Enter
   * or Space because each selection launches one backend process, and
   * selection-following-focus would launch one per key press.
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
          onSelect(table.rows[position]?.index ?? 0);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [moveFocus, onSelect, rowCount, rowsHeight, table.rows],
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
            {" · Enter or Space opens the focused row"}
            {/* Stated where the values are, not only in the detail panel. A
                bare number invites being read as minutes. */}
            {" · retention times have no unit because the file reports none"}
          </p>
        </div>
      </header>

      {table.truncated ? (
        <p className="notice notice-warning" role="note">
          This run has more spectra than one preview transfers. The rows below are the first{" "}
          {formatCount(rowCount)} and are not the whole table.
        </p>
      ) : null}

      <div
        aria-colcount={COLUMNS.length}
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
                    isFocusStop={start + offset === focusStop}
                    isSelected={selectedIndex === row.index}
                    key={row.index}
                    onActivate={(position) => {
                      // Activating a row also makes it the tab stop, so keyboard
                      // navigation resumes from what the user just chose.
                      setFocusRow(position);
                      onSelect(row.index);
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
}

interface SpectrumTableRowProps {
  readonly row: SpectrumRow;
  readonly position: number;
  readonly isSelected: boolean;
  readonly isFocusStop: boolean;
  readonly onActivate: (position: number) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, position: number) => void;
}

function SpectrumTableRow({
  row,
  position,
  isSelected,
  isFocusStop,
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
