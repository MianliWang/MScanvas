/**
 * What keeps a spectrum value under its own label.
 *
 * jsdom lays nothing out, so nothing here measures a column edge and none of
 * it replaces the rendered check. What it does hold is the arrangement that
 * makes the alignment a fact of the layout rather than of something watching a
 * scroll position: one scrolling element, both grids inside it, one width for
 * both to resolve against, and a header that stays put only vertically.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import appStyles from "../../app/app.css?raw";
import { buildRows } from "../../test/previewFixtures";
import { SpectrumTable } from "./SpectrumTable";

const COLUMN_LABELS = [
  "Index",
  "Scan",
  "Identifier",
  "MS level",
  "Retention time",
  "Base peak m/z",
  "Base peak intensity",
  "Total ion current",
  "Precursor m/z",
];

const mountedStyles: HTMLStyleElement[] = [];

function mountAppStyles(): void {
  const style = document.createElement("style");
  style.textContent = appStyles;
  document.head.append(style);
  mountedStyles.push(style);
}

function renderTable(rowCount = 40, selectedIndex: number | null = null) {
  const onSelect = vi.fn();
  const onRendered = vi.fn();
  const result = render(
    <SpectrumTable
      onRendered={onRendered}
      onSelect={onSelect}
      selectedIndex={selectedIndex}
      table={{ rows: buildRows(rowCount), totalRowCount: rowCount, truncated: false }}
    />,
  );
  return { ...result, onSelect, onRendered };
}

function requireElement(container: HTMLElement, selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector);
  expect(found, `Expected ${selector}`).not.toBeNull();
  return found as HTMLElement;
}

afterEach(() => {
  for (const style of mountedStyles.splice(0)) {
    style.remove();
  }
});

describe("spectrum table columns", () => {
  it("keeps all nine labels, in order, once each", () => {
    renderTable();

    const headers = screen.getAllByRole("columnheader");

    expect(headers.map((header) => header.textContent)).toEqual(COLUMN_LABELS);
    // One header set, not a visual copy alongside an announced one.
    expect(headers).toHaveLength(COLUMN_LABELS.length);
    expect(screen.getAllByText("Total ion current")).toHaveLength(1);
    expect(screen.getAllByText("Precursor m/z")).toHaveLength(1);
  });

  it("still counts every row the run has, not the rendered window", () => {
    const { container } = renderTable(400);

    const grid = screen.getByRole("grid", { name: "Spectra" });
    expect(grid).toHaveAttribute("aria-rowcount", "401");
    expect(grid).toHaveAttribute("aria-colcount", "9");
    // Windowed: the header row plus a bounded slice, not 400 rows.
    expect(within(grid).getAllByRole("row").length).toBeLessThan(100);
    expect(requireElement(container, ".spectrum-table-head")).toHaveAttribute("aria-rowindex", "1");
  });
});

describe("spectrum table horizontal position", () => {
  it("puts the header and the rows inside the one element that scrolls", () => {
    // The defect this repairs: the header was a sibling of the scrolling box,
    // so the rows moved sideways and the labels did not.
    const { container } = renderTable();
    const viewport = requireElement(container, ".spectrum-table-viewport");
    const head = requireElement(container, ".spectrum-table-head");
    const row = requireElement(container, ".spectrum-table-window .spectrum-table-row");

    expect(viewport.contains(head)).toBe(true);
    expect(viewport.contains(row)).toBe(true);
  });

  it("declares one width for both grids to resolve their columns against", () => {
    mountAppStyles();
    const { container } = renderTable();
    const track = requireElement(container, ".spectrum-table-track");
    const head = requireElement(container, ".spectrum-table-head");
    const canvas = requireElement(container, ".spectrum-table-canvas");

    expect(track.contains(head)).toBe(true);
    expect(track.contains(canvas)).toBe(true);
    // Wider than the viewport exactly when the columns cannot fit. Without it
    // the sticky header would be the viewport's width while the rows were
    // wider, and the two would resolve different tracks.
    expect(getComputedStyle(track).minWidth).toBe("min-content");
  });

  it("leaves exactly one element scrolling, and it is not the header", () => {
    mountAppStyles();
    const { container } = renderTable();
    const grid = requireElement(container, ".spectrum-table");
    const scrolls = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      // The shorthand and the axes both, because jsdom resolves whichever the
      // rule was written with and leaves the other empty.
      const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
      return overflow.includes("auto") || overflow.includes("scroll");
    };

    const owners = Array.from(grid.querySelectorAll<HTMLElement>("*")).filter(scrolls);

    expect(owners).toHaveLength(1);
    expect(owners[0]).toHaveClass("spectrum-table-viewport");
    expect(scrolls(requireElement(container, ".spectrum-table-head"))).toBe(false);
  });

  it("declares the sticky header that keeps the labels in view down the rows", () => {
    mountAppStyles();
    const { container } = renderTable();
    const head = requireElement(container, ".spectrum-table-head");
    const style = getComputedStyle(head);

    expect(style.position).toBe("sticky");
    expect(style.top).toBe("0px");
    // Rows pass under it, so it cannot be see-through, and it has to win the
    // paint order against the rows it covers.
    expect(style.background).toContain("var(--color-surface-subtle)");
    expect(style.zIndex).toBe("1");
  });

  it("reserves the header's row when the browser brings a row into view", () => {
    // jsdom does not scroll anything into view, so this asserts the rule and
    // not its effect. The effect is the point of it: a row that is already
    // half under the header counts as in view, and Tab would leave the focus
    // ring beneath the labels without this.
    mountAppStyles();
    const { container } = renderTable();
    const viewport = requireElement(container, ".spectrum-table-viewport");

    expect(getComputedStyle(viewport).scrollPaddingTop).toBe("30px");
  });
});

describe("spectrum table rows", () => {
  it("moves focus with the arrows and commits only on Enter", () => {
    // Each selection launches one backend read, so arrowing must not select.
    const { onSelect } = renderTable();
    const grid = screen.getByRole("grid", { name: "Spectra" });
    const rows = within(grid).getAllByRole("row");

    rows[1]?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("pages by what the rows have, not by what the header takes", () => {
    // The header occupies the first row of the scrolling box, so a page is one
    // row shorter than that box. Counting the whole box would page the focus
    // one row further than the user can see.
    renderTable(400);
    const grid = screen.getByRole("grid", { name: "Spectra" });
    within(grid).getAllByRole("row")[1]?.focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "PageDown" });

    expect(document.activeElement).toHaveAttribute("aria-rowindex", "20");
  });

  it("carries exactly one tab stop among the rendered rows", () => {
    const { container } = renderTable(400);

    expect(container.querySelectorAll('[role="row"][tabindex="0"]')).toHaveLength(1);
  });

  it("marks the selected row for a reader as well as for the eye", () => {
    renderTable(40, 3);

    const grid = screen.getByRole("grid", { name: "Spectra" });
    const selected = within(grid)
      .getAllByRole("row")
      .filter((row) => row.getAttribute("aria-selected") === "true");

    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("aria-rowindex", "5");
    expect(within(selected[0] as HTMLElement).getByText("Selected,")).toBeInTheDocument();
  });
});

describe("bringing a row into view", () => {
  /*
   * Where a row actually renders, which is what these cases are derived from
   * rather than from the arithmetic inside `revealRow`.
   *
   * The scrolling box holds a track; the track holds the sticky header and then
   * the canvas. `position: sticky` keeps the header in normal flow, so it has
   * its own ROW_HEIGHT at the top of the track and the canvas begins after it.
   * A row at canvas offset `top` therefore renders at
   *
   *     viewport y = HEADER_HEIGHT + top - scrollTop
   *
   * and is clear of the sticky header exactly when `top >= scrollTop`. Every
   * expectation below is that sentence, not a copy of the implementation.
   */
  const HEADER = 30;
  const ROW = 30;

  /** Where the reveal leaves a row on screen, in viewport pixels. */
  function viewportYOf(position: number, scrollTop: number): number {
    return HEADER + position * ROW - scrollTop;
  }

  it("leaves a row that already begins immediately below the sticky header", () => {
    // CASE A, and the one that distinguishes the defect. Row 10 sits at 300;
    // with the scroll at 300 it renders at y = 30, touching the header's bottom
    // edge and entirely visible. Subtracting the header again would scroll to
    // 270 and move a row nobody needed moved.
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });
    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);

    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={10}
        selectionRevision={1}
        table={{ rows: buildRows(400), totalRowCount: 400, truncated: false }}
      />,
    );

    expect(viewport.scrollTop).toBe(300);
    expect(viewportYOf(10, viewport.scrollTop)).toBe(HEADER);
  });

  it("reveals a row genuinely hidden beneath the sticky header, and no further", () => {
    // CASE B. Row 9 sits at 270; with the scroll at 300 it would render at
    // y = 0, underneath the header. Revealed, it must sit at the header's
    // bottom edge -- not a row above it.
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });
    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);
    expect(viewportYOf(9, 300)).toBe(0);

    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={9}
        selectionRevision={1}
        table={{ rows: buildRows(400), totalRowCount: 400, truncated: false }}
      />,
    );

    expect(viewportYOf(9, viewport.scrollTop)).toBe(HEADER);
    expect(viewport.scrollTop).toBe(270);
  });

  it("reveals a row below the fold with the smallest scroll that shows all of it", () => {
    // CASE C. The rows have `clientHeight - HEADER` to live in, so the last
    // fully visible row ends exactly at the viewport's bottom edge.
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });

    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={20}
        selectionRevision={1}
        table={{ rows: buildRows(400), totalRowCount: 400, truncated: false }}
      />,
    );

    // Its bottom edge lands on the viewport's, and not a pixel past it.
    expect(viewportYOf(20, viewport.scrollTop) + ROW).toBe(330);
    // And the row above it is still whole, so this was the smallest move.
    expect(viewportYOf(19, viewport.scrollTop)).toBeGreaterThanOrEqual(HEADER);
  });

  it("moves nothing for a row already whole in the middle of the viewport", () => {
    // CASE D.
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });
    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);

    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={14}
        selectionRevision={1}
        table={{ rows: buildRows(400), totalRowCount: 400, truncated: false }}
      />,
    );

    expect(viewport.scrollTop).toBe(300);
  });

  it("does not jump an extra row when the keyboard walks up to the header edge", () => {
    // The user-visible shape of the same defect: arrowing upwards past the top
    // of the viewport should bring one row into view at a time, not two.
    const { container } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });
    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);

    // Focus row 10, which is the first row clear of the header at this scroll.
    const row = requireElement(container, '[data-row-position="10"]');
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowUp" });

    // One row of movement, and row 9 now sits exactly at the header's edge.
    expect(viewport.scrollTop).toBe(270);
    expect(viewportYOf(9, viewport.scrollTop)).toBe(HEADER);
  });

  it("reveals the selected row again when the same scan is committed a second time", () => {
    // Selecting the scan that is already selected does not move the selected
    // position, so a reveal that watches only the position cannot see it. The
    // user can: they selected the scan, scrolled its row away, and clicked the
    // same scan again -- which is a request to be shown it, not a no-op.
    const table = { rows: buildRows(400), totalRowCount: 400, truncated: false };
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    // The first commit needs no scroll: row 5 sits at 150 and the rows area
    // covers 0 to 300, so it is already on screen.
    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={5}
        selectionRevision={1}
        table={table}
      />,
    );
    expect(viewport.scrollTop).toBe(0);

    // The user scrolls it far out of view.
    viewport.scrollTop = 6_000;
    fireEvent.scroll(viewport);

    // And commits the very same scan again: the index does not move, the
    // revision does.
    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={5}
        selectionRevision={2}
        table={table}
      />,
    );

    // Back in view, sitting at the sticky header's bottom edge, and the
    // keyboard still on the control the user pressed.
    expect(viewport.scrollTop).toBe(150);
    expect(requireElement(container, '[data-row-position="5"]')).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("reveals a selected row the user has scrolled away from, even at the tab stop", () => {
    // The roving tab stop is where the keyboard would land, not what is on
    // screen. Leave it on a row, scroll that row out of view by hand, then
    // select the same row from the chromatogram: the positions match while the
    // row is nowhere to be seen, which is exactly when the reveal is needed.
    const table = { rows: buildRows(400), totalRowCount: 400, truncated: false };
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });

    // The tab stop walks to row 5, which stays in view.
    const first = requireElement(container, '[data-row-position="0"]');
    first.focus();
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(document.activeElement ?? first, { key: "ArrowDown" });
    }
    expect(requireElement(container, '[data-row-position="5"]')).toHaveAttribute("tabindex", "0");

    // The user scrolls it far out of view, and moves the keyboard elsewhere.
    viewport.scrollTop = 6_000;
    fireEvent.scroll(viewport);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    // And selects that same row from another surface.
    rerender(
      <SpectrumTable onRendered={vi.fn()} onSelect={vi.fn()} selectedIndex={5} table={table} />,
    );

    // Row 5 sits at 150, revealed to the sticky header's bottom edge.
    expect(viewport.scrollTop).toBe(150);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("moves nothing when a visible focused row commits its own selection", () => {
    // The other half: revealing unconditionally must not scroll under a user
    // who pressed Enter on a row they were already looking at, and must not
    // take the keyboard off it.
    const table = { rows: buildRows(400), totalRowCount: 400, truncated: false };
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });

    const first = requireElement(container, '[data-row-position="0"]');
    first.focus();
    for (let step = 0; step < 3; step += 1) {
      fireEvent.keyDown(document.activeElement ?? first, { key: "ArrowDown" });
    }
    const focused = document.activeElement;
    const before = viewport.scrollTop;
    fireEvent.keyDown(document.activeElement ?? first, { key: "Enter" });

    rerender(
      <SpectrumTable onRendered={vi.fn()} onSelect={vi.fn()} selectedIndex={3} table={table} />,
    );

    expect(viewport.scrollTop).toBe(before);
    expect(document.activeElement).toBe(focused);
    expect(requireElement(container, '[data-row-position="3"]')).toHaveAttribute("tabindex", "0");
  });

  it("reveals a selection made elsewhere without taking focus", () => {
    // The linked-viewer rule: a chromatogram click or Previous/Next has to make
    // its row visible, and must not move the keyboard away from the control the
    // user is operating.
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={200}
        table={{ rows: buildRows(400), totalRowCount: 400, truncated: false }}
      />,
    );

    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(document.activeElement).toBe(outside);
    // And the roving tab stop moved, so tabbing in afterwards lands on the
    // selected row rather than back at the top.
    expect(requireElement(container, '[data-row-position="200"]')).toHaveAttribute("tabindex", "0");
    outside.remove();
  });
});
