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
import type { Selection } from "./viewer/interactionState";

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

/** One selection commit, as the interaction reducer would have produced it. */
function commit(index: number, revision: number): Selection {
  return { index, revision, retentionTime: index * 0.0125 };
}

interface TableOptions {
  readonly rowCount?: number;
  readonly selection?: Selection | null;
  readonly truncated?: boolean;
  readonly canSelectPrevious?: boolean;
  readonly canSelectNext?: boolean;
}

function renderTable(options: TableOptions = {}) {
  const rowCount = options.rowCount ?? 40;
  const onSelect = vi.fn();
  const onRendered = vi.fn();
  const onSelectPrevious = vi.fn();
  const onSelectNext = vi.fn();
  const props = (selection: Selection | null) => ({
    canSelectNext: options.canSelectNext ?? false,
    canSelectPrevious: options.canSelectPrevious ?? false,
    onRendered,
    onSelect,
    onSelectNext,
    onSelectPrevious,
    selection,
    table: {
      rows: buildRows(rowCount),
      totalRowCount: options.truncated === true ? rowCount * 10 : rowCount,
      truncated: options.truncated ?? false,
    },
  });
  const result = render(<SpectrumTable {...props(options.selection ?? null)} />);
  return {
    ...result,
    onSelect,
    onRendered,
    onSelectPrevious,
    onSelectNext,
    /** Publishes another selection commit, as the workspace would. */
    commitSelection: (selection: Selection | null) => {
      result.rerender(<SpectrumTable {...props(selection)} />);
    },
  };
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
    const { container } = renderTable({ rowCount: 400 });

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
    renderTable({ rowCount: 400 });
    const grid = screen.getByRole("grid", { name: "Spectra" });
    within(grid).getAllByRole("row")[1]?.focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "PageDown" });

    expect(document.activeElement).toHaveAttribute("aria-rowindex", "20");
  });

  it("carries exactly one tab stop among the rendered rows", () => {
    const { container } = renderTable({ rowCount: 400 });

    expect(container.querySelectorAll('[role="row"][tabindex="0"]')).toHaveLength(1);
  });

  it("marks the selected row for a reader as well as for the eye", () => {
    renderTable({ rowCount: 40, selection: commit(3, 1) });

    const grid = screen.getByRole("grid", { name: "Spectra" });
    const selected = within(grid)
      .getAllByRole("row")
      .filter((row) => row.getAttribute("aria-selected") === "true");

    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("aria-rowindex", "5");
    expect(within(selected[0] as HTMLElement).getByText("Selected,")).toBeInTheDocument();
  });
});

/*
 * The reveal, measured in scroll positions.
 *
 * jsdom lays nothing out, so the numbers below come from the component's own
 * arithmetic rather than from a rendered box -- but that arithmetic is
 * `revealScrollTop`'s, and these are the two cases the wrong version of it got
 * wrong. The viewport reports no height here, so the table falls back to its
 * 600px default: the header takes a row, leaving 570px for rows of 30px each.
 */
describe("bringing a row into view", () => {
  function viewportOf(container: HTMLElement): HTMLElement {
    const viewport = container.querySelector<HTMLElement>(".spectrum-table-viewport");
    expect(viewport).not.toBeNull();
    return viewport as HTMLElement;
  }

  it("scrolls down the least that shows a row below the fold", () => {
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const viewport = viewportOf(container);

    // Row 30 sits at canvas offset 900 and the rows have 570px, so the least
    // scroll that shows all of it is 900 + 30 - 570.
    commitSelection(commit(30, 1));

    expect(viewport.scrollTop).toBe(360);
  });

  it("puts a row above the fold exactly at the top of the canvas, header included once", () => {
    // The discriminating case. The header is `position: sticky`, so the canvas
    // already begins after it and `scrollTop = rowTop` places the row
    // immediately below it. Subtracting the header again would land on 570 and
    // scroll a row that was about to be perfectly placed one row too far.
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const viewport = viewportOf(container);
    fireEvent.scroll(viewport, { target: { scrollTop: 900 } });

    commitSelection(commit(20, 1));

    expect(viewport.scrollTop).toBe(600);
  });

  it("leaves a row that is already in view exactly where it is", () => {
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const viewport = viewportOf(container);
    fireEvent.scroll(viewport, { target: { scrollTop: 300 } });

    commitSelection(commit(12, 1));

    expect(viewport.scrollTop).toBe(300);
  });

  it("reveals again when the same scan is committed a second time", () => {
    // A selection is an event. The user who selected a scan, scrolled its row
    // away and asked for that scan again was asking to be shown it -- and a
    // surface watching the index alone cannot tell that happened.
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const viewport = viewportOf(container);
    commitSelection(commit(30, 1));
    expect(viewport.scrollTop).toBe(360);

    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    commitSelection(commit(30, 2));

    expect(viewport.scrollTop).toBe(360);
  });

  it("does not undo a scroll the user made while the same commit stands", () => {
    // The other half of the same rule. Once a revision has been consumed, a
    // re-render -- a resize, a sibling's state, anything -- must not pull the
    // viewport back.
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const viewport = viewportOf(container);
    commitSelection(commit(30, 1));

    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    commitSelection(commit(30, 1));

    expect(viewport.scrollTop).toBe(0);
  });

  it("moves the tab stop to the revealed row without taking focus from elsewhere", () => {
    // The control that committed the selection keeps the keyboard. Tabbing in
    // afterwards still lands on the selected row rather than back at the top.
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    commitSelection(commit(30, 1));

    expect(document.activeElement).toBe(outside);
    expect(container.querySelector('[role="row"][tabindex="0"]')).toHaveAttribute(
      "aria-rowindex",
      "32",
    );
    outside.remove();
  });

  it("forgets its bookmark when nothing is selected", () => {
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const viewport = viewportOf(container);
    commitSelection(commit(30, 1));
    commitSelection(null);

    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    commitSelection(commit(30, 1));

    expect(viewport.scrollTop).toBe(360);
  });
});

describe("stepping through scans from the table", () => {
  it("offers Previous and Next, and disables them where the table ends", () => {
    const { onSelectPrevious, onSelectNext } = renderTable({ canSelectNext: true });

    const previous = screen.getByRole("button", { name: "Previous scan" });
    const next = screen.getByRole("button", { name: "Next scan" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);

    expect(onSelectNext).toHaveBeenCalledTimes(1);
    expect(onSelectPrevious).not.toHaveBeenCalled();
  });

  it("does not present the end of a truncated prefix as the end of the run", () => {
    renderTable({ rowCount: 40, truncated: true });

    expect(
      screen.getByText(/step through these rows and stop at the end of them, which is not the end of the run/),
    ).toBeVisible();
  });
});
