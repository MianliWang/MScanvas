import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Icon, IconButton } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { MessageKey } from "../preferences/i18n";
import type { ScanSortKey } from "./viewer/scanTableView";
import type { ScanTableView } from "./viewer/useScanTableView";

import type { SpectrumRow, SpectrumTable as SpectrumTableModel } from "./contracts";
import {
  formatCount,
  formatMz,
  formatRetentionTimeValue,
} from "./format";
import type { Selection, SelectionConsumer } from "./viewer/interactionState";
import { consumeSelection, initialSelectionConsumer } from "./viewer/interactionState";
import { revealScrollTop } from "./viewer/renderGeometry";
import type { SpectrumSelectionAvailability } from "./viewer/selectionAvailability";
import { SPECTRUM_SELECTION_NOTICE_ID } from "./viewer/selectionAvailability";

/** Fixed row height keeps the windowing arithmetic exact. Mirrored in CSS. */
const ROW_HEIGHT = 28;
/**
 * The header row's height, which is a row's.
 *
 * It sits inside the scrolling element so that a column label and its values
 * share one horizontal position, and stays put vertically. That costs the top
 * of the scrolling box: everything below has to be placed as though the box
 * began one row lower, or a row scrolled to would arrive behind the header.
 */
const HEADER_HEIGHT = 30;
/** Rows kept rendered outside the viewport so scrolling does not flash gaps. */
const OVERSCAN = 10;
/**
 * Used when the viewport has not been measured yet. jsdom reports a zero
 * client height, so without this a test would observe an empty table.
 */
const FALLBACK_VIEWPORT_HEIGHT = 600;
/** The sentence that says the filters hide the selected scan. */
const HIDDEN_SELECTION_ID = "scan-hidden-selection-reason";

/**
 * The scan list's columns, v5.11's compact four: what tells scans apart at a
 * glance. The index, identifier, base peak and TIC of the selected scan are in
 * Details, and the search still reaches identifiers and indices.
 */
const COLUMNS: readonly { readonly label: MessageKey; readonly sort: ScanSortKey; readonly cell: (row: SpectrumRow) => string }[] = [
  { label: "scanNumber", sort: "scanNumber", cell: row => row.scanNumber === null ? "—" : formatCount(row.scanNumber) },
  { label: "scanRetentionTime", sort: "retentionTime", cell: row => formatRetentionTimeValue(row.retentionTime) },
  { label: "scanMsLevel", sort: "msLevel", cell: row => `MS${row.msLevel}` },
  { label: "scanPrecursorMz", sort: "precursorMz", cell: row => row.precursorMz === null ? "—" : formatMz(row.precursorMz) },
];

export interface SpectrumTableProps {
  readonly table: SpectrumTableModel;
  readonly view: ScanTableView;
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
  view,
  selection,
  onSelect,
  onRendered,
  onSelectPrevious,
  onSelectNext,
  canSelectPrevious,
  canSelectNext,
  selectionAvailability,
}: SpectrumTableProps) {
  const t = useUiMessages();
  const canCommit = selectionAvailability.status === "available";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
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

  const rows = view.projection.rows;
  const rowCount = rows.length;
  const focusRow = (focusIndex === null ? undefined : view.projection.positions.get(focusIndex)) ?? 0;
  const selectedOutside = selectedIndex !== null && !view.projection.positions.has(selectedIndex);
  // Why Previous and Next are refused, where a sentence says it: the selection
  // lock, else a selection the filters hide. At either end of the list the
  // highlighted row says it.
  const stepReasonId = !canCommit ? SPECTRUM_SELECTION_NOTICE_ID : selectedOutside ? HIDDEN_SELECTION_ID : undefined;
  /** What the viewport has left for rows once the header has its row. */
  const rowsHeight = Math.max(ROW_HEIGHT, viewportHeight - HEADER_HEIGHT);
  const visibleCount = Math.ceil(rowsHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const start = Math.max(0, Math.min(Math.max(0, rowCount - 1), Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
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
      setFocusIndex(rows[clamped]?.index ?? null);
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
    [rowCount, rows, viewportHeight],
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
  const previousProjection = useRef(view.projection);
  useEffect(() => {
    const outcome = consumeSelection(consumer.current, selection);
    consumer.current = outcome.consumer;
    const changed = previousProjection.current !== view.projection;
    previousProjection.current = view.projection;
    const position = selection === null ? undefined : view.projection.positions.get(selection.index);
    if (position !== undefined && (outcome.consumed !== null || changed)) revealRow(position);
    else if (changed && rowCount > 0) revealRow(focusRow);
  }, [revealRow, rowCount, focusRow, selection, view.projection]);

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
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        event.nativeEvent.isComposing || event.keyCode === 229 || isEmbeddedAction(event.target, event.currentTarget)) return;
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
          if (canCommit && !event.repeat && rows[position] !== undefined) {
            onSelect(rows[position].index);
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
      <div className="plot-head">
        <h2 id="spectrum-table-heading">{t("scansTitle")}</h2>
        {/* One number while every row is loaded and none is filtered out;
            the three counts, and the loaded-prefix disclosure, only where
            they differ. */}
        <p className="scan-result-count" aria-live="polite">{!table.truncated && view.options.query.trim() === "" &&
          view.options.msLevel === null ? t("scanCountAll", { count: table.totalRowCount }) : t("scanCounts", {
          visible: rowCount, total: table.totalRowCount, count: table.rows.length,
        }) + (table.truncated ? ` · ${t("scanPrefix")}` : "")}</p>
        {/* Beside the heading: these step through this table's order, and
            they stay available for a preview whose chromatogram cannot be
            drawn at all. */}
        <div className="plot-tools" role="group" aria-label={t("scanNavigation")}>
          <IconButton icon={<Icon name="chevronUp" />} label={t("scanPrevious")} onClick={onSelectPrevious} refused={!canSelectPrevious}
            reasonId={stepReasonId} size="sm" />
          <IconButton icon={<Icon name="chevronDown" />} label={t("scanNext")} onClick={onSelectNext} refused={!canSelectNext}
            reasonId={stepReasonId} size="sm" />
        </div>
      </div>

      <div className="scan-view-controls">
        <div className="plot-search">
          <Icon name="search" />
          <label className="visually-hidden" htmlFor="scan-search">{t("scanSearch")}</label>
          <input id="scan-search" type="search" value={view.options.query} placeholder={t("scanSearch")}
            onChange={event => view.setQuery(event.target.value)} aria-describedby="scan-view-help" />
        </div>
        <label className="visually-hidden" htmlFor="scan-ms-level">{t("scanMsLevel")}</label>
        <select id="scan-ms-level" value={view.options.msLevel === null ? "all" : String(view.options.msLevel)}
          onChange={event => view.setMsLevel(event.target.value === "all" ? null : Number(event.target.value))}>
          <option value="all">{t("scanAllLevels")}</option>
          {view.msLevels.map(level => <option key={level} value={level}>MS{level}</option>)}
        </select>
        <p className="visually-hidden" id="scan-view-help">{t("scanHelpText")}</p>
      </div>
      {selectedOutside ? <p className="scan-hidden-selection" aria-live="polite">
        <span id={HIDDEN_SELECTION_ID}>{t("scanSelectedOutside", { name: String(selectedIndex) })}</span>{" "}
        <Button onClick={view.clearFilters} size="sm" variant="quiet">{t("scanReveal")}</Button>
      </p> : null}
      {rowCount === 0 ? <p className="empty-state">{t(table.rows.length === 0 ? "scanEmpty" : "scanNoMatches")}</p> : null}

      <div
        aria-colcount={COLUMNS.length}
        /*
         * The reason, while there is one -- described, never disabled. A
         * disabled grid is a grid that cannot be navigated, and every value in
         * it is still readable and still true.
         */
        aria-describedby={canCommit ? undefined : SPECTRUM_SELECTION_NOTICE_ID}
        aria-labelledby="spectrum-table-heading"
        aria-rowcount={rowCount + 1}
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
                  key={column.label}
                  role="columnheader"
                  aria-sort={view.options.sort?.key === column.sort ? view.options.sort.direction : undefined}
                >
                  <button className="scan-sort-button" type="button" onClick={() => view.sortBy(column.sort)}>
                    {t(column.label)}
                    <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"
                      data-direction={view.options.sort?.key === column.sort ? view.options.sort.direction : "none"}>
                      <path d={view.options.sort?.key !== column.sort ? "M3 4 6 1 9 4 M3 8 6 11 9 8" :
                        view.options.sort.direction === "ascending" ? "M2 8 6 4 10 8" : "M2 4 6 8 10 4"} />
                    </svg>
                  </button>
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
                      setFocusIndex(rows[position]?.index ?? null);
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
  const t = useUiMessages();
  const cells = COLUMNS.map(column => column.cell(row));

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
      data-source-index={row.index}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.detail > 1 ||
          isEmbeddedAction(event.target, event.currentTarget) || window.getSelection()?.type === "Range") return;
        event.currentTarget.focus({ preventScroll: true });
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
          key={COLUMNS[columnIndex]?.label}
          role="gridcell"
          title={String(cell)}
        >
          {columnIndex === 0 ? (
            <>
              {/* A glyph, not only a highlight, so selection survives
                  greyscale, high contrast and colour-blind viewing. */}
              <span aria-hidden="true" className="spectrum-table-marker">
                {isSelected ? "▸" : ""}
              </span>
              {isSelected ? <span className="visually-hidden">{t("scanSelected")}, </span> : null}
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

function isEmbeddedAction(target: EventTarget | null, row: HTMLElement): boolean {
  return target instanceof Element && target !== row &&
    target.closest("button, input, textarea, select, a, [contenteditable], [data-scan-action]") !== null;
}
