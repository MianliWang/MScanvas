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
  /**
   * The scroll position after a reveal, given a viewport that holds ten rows.
   *
   * jsdom lays nothing out, so the height the component would measure is
   * stubbed. What is under test is arithmetic, not layout: where the component
   * decides to put the scroll for a row it wants seen.
   */
  function scrollAfter(action: (container: HTMLElement) => void, rowCount = 400): number {
    const { container } = renderTable(rowCount);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });
    action(container);
    return viewport.scrollTop;
  }

  it("keeps a row clear of the header it would otherwise arrive under", () => {
    // The header is sticky *inside* this scrolling box, so a row scrolled to
    // exactly its own offset arrives beneath it: focused, announced, and not
    // visible. The reveal stops a header's worth sooner, which is what the
    // opposite edge already did.
    const top = scrollAfter((container) => {
      const first = requireElement(container, '[data-row-position="0"]');
      first.focus();
      // Down past the fold, then back up to the top row.
      fireEvent.keyDown(first, { key: "End" });
      fireEvent.keyDown(document.activeElement ?? first, { key: "Home" });
    });

    expect(top).toBe(0);
  });

  it("stops a row's own header height above it rather than exactly at it", () => {
    // Driven through the external-selection path rather than by walking the
    // keyboard there: it is the same reveal, and three hundred synthetic key
    // presses over a virtualized table are three hundred renders to assert one
    // subtraction.
    const rows = buildRows(400);
    const table = { rows, totalRowCount: 400, truncated: false };
    const { container, rerender } = renderTable(400);
    const viewport = requireElement(container, ".spectrum-table-viewport");
    Object.defineProperty(viewport, "clientHeight", { value: 330, configurable: true });

    // Down the run, so the row that follows is above the fold.
    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={200}
        table={table}
      />,
    );
    expect(viewport.scrollTop).toBe(200 * 30 + 30 - (330 - 30));

    rerender(
      <SpectrumTable
        onRendered={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={100}
        table={table}
      />,
    );

    // Row 100 sits at 3,000; the reveal puts the scroll one row height above
    // it so the sticky header does not cover it.
    expect(viewport.scrollTop).toBe(3_000 - 30);
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

    // Row 5 sits at 150, revealed a header's height above it.
    expect(viewport.scrollTop).toBe(150 - 30);
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
