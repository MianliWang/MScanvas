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
