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
/** Rows kept rendered outside the viewport so scrolling does not flash gaps. */
const OVERSCAN = 10;
/**
 * Used when the viewport has not been measured yet. jsdom reports a zero
 * client height, so without this a test would observe an empty table.
 */
const FALLBACK_VIEWPORT_HEIGHT = 600;

const COLUMNS = [
  "Index",
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
  readonly onSelect: (index: number) => void;
  readonly onRendered: (renderedRowCount: number, milliseconds: number) => void;
}

export function SpectrumTable({
  table,
  selectedIndex,
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
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
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

  const moveFocus = useCallback(
    (position: number) => {
      const clamped = Math.min(rowCount - 1, Math.max(0, position));
      setFocusRow(clamped);
      pendingFocus.current = true;
      const viewport = viewportRef.current;
      if (viewport === null) {
        return;
      }
      const top = clamped * ROW_HEIGHT;
      const height = viewport.clientHeight || viewportHeight;
      if (top < viewport.scrollTop) {
        viewport.scrollTop = top;
        setScrollTop(top);
      } else if (top + ROW_HEIGHT > viewport.scrollTop + height) {
        const next = top + ROW_HEIGHT - height;
        viewport.scrollTop = next;
        setScrollTop(next);
      }
    },
    [rowCount, viewportHeight],
  );

  /**
   * Arrow keys move focus without selecting. Selection is committed with Enter
   * or Space because each selection launches one backend process, and
   * selection-following-focus would launch one per key press.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, position: number) => {
      const pageSize = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1);
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
    [moveFocus, onSelect, rowCount, table.rows, viewportHeight],
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
          className="spectrum-table-viewport"
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
          }}
          ref={viewportRef}
          role="presentation"
        >
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
