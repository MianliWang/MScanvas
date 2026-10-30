/**
 * What keeps a spectrum value under its own label.
 *
 * jsdom lays nothing out, so nothing here measures a column edge and none of
 * it replaces the rendered check. What it does hold is the arrangement that
 * makes the alignment a fact of the layout rather than of something watching a
 * scroll position: one scrolling element, both grids inside it, one width for
 * both to resolve against, and a header that stays put only vertically.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import appStyles from "../../app/app.css?raw";
import { buildRows } from "../../test/previewFixtures";
import { UI_RESOURCES } from "../preferences/i18n";
import { SelectedSpectrumPanel } from "./SelectedSpectrumPanel";
import { SpectrumTable, scanStepReasonId, type SpectrumTableProps } from "./SpectrumTable";
import { initialSpectrumViewportState } from "./viewer/spectrumViewport";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { useScanTableView } from "./viewer/useScanTableView";
import type { Selection } from "./viewer/interactionState";
import type { SpectrumSelectionAvailability } from "./viewer/selectionAvailability";

/** v5.11's compact scan list; the rest of a scan's facts are in Details. */
const COLUMN_LABELS = [
  "Scan",
  "RT",
  "MS",
  "Prec. m/z",
];
/** What each header is called: its short label first, then its full name where they differ. */
const COLUMN_NAMES = [
  "Scan",
  "RT (Retention time)",
  "MS (MS level)",
  "Prec. m/z (Precursor m/z)",
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
  readonly layout?: "compact" | "full";
  readonly rowCount?: number;
  readonly selection?: Selection | null;
  readonly truncated?: boolean;
  readonly canSelectPrevious?: boolean;
  readonly canSelectNext?: boolean;
  readonly selectionAvailability?: SpectrumSelectionAvailability;
}

function renderTable(options: TableOptions = {}) {
  const rowCount = options.rowCount ?? 40;
  const rows = buildRows(rowCount);
  const onSelect = vi.fn();
  const onRendered = vi.fn();
  const onSelectPrevious = vi.fn();
  const onSelectNext = vi.fn();
  const props = (selection: Selection | null) => ({
    layout: options.layout,
    canSelectNext: options.canSelectNext ?? false,
    canSelectPrevious: options.canSelectPrevious ?? false,
    onRendered,
    onSelect,
    onSelectNext,
    onSelectPrevious,
    selection,
    selectionAvailability:
      options.selectionAvailability ?? ({ status: "available" } as const),
    table: {
      rows,
      totalRowCount: options.truncated === true ? rowCount * 10 : rowCount,
      truncated: options.truncated ?? false,
    },
  });
  const result = render(<TestSpectrumTable {...props(options.selection ?? null)} />);
  return {
    ...result,
    onSelect,
    onRendered,
    onSelectPrevious,
    onSelectNext,
    /** Publishes another selection commit, as the workspace would. */
    commitSelection: (selection: Selection | null) => {
      result.rerender(<TestSpectrumTable {...props(selection)} />);
    },
    /**
     * Publishes a new selection availability, as the workspace would.
     *
     * A re-render rather than a remount, which is the point: a lane clearing
     * does not rebuild the viewer, and a table that only worked again after
     * being rebuilt would have lost the reader's scroll position and tab stop.
     */
    rerenderWithAvailability: (availability: SpectrumSelectionAvailability) => {
      result.rerender(
        <TestSpectrumTable
          {...props(options.selection ?? null)}
          selectionAvailability={availability}
        />,
      );
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
  it("keeps all four labels, in order, once each", () => {
    renderTable();

    const headers = screen.getAllByRole("columnheader");

    // RT carries "(unit not reported)" on a second line (P11).
    expect(headers.map((header) => header.textContent)).toEqual(COLUMN_LABELS.map(label => label === "RT" ? `RT${UI_RESOURCES.en.scanUnitNotReported}` : label));
    // One header set, not a visual copy alongside an announced one.
    expect(headers).toHaveLength(COLUMN_LABELS.length);
    expect(screen.getAllByText("RT")).toHaveLength(1);
    expect(screen.getAllByText("Prec. m/z")).toHaveLength(1);
    // Short enough for the side column, and still spoken in full after the
    // visible label, which is what a speech user says to press it.
    expect(headers.map((header) => within(header).getByRole("button").getAttribute("aria-label") ??
      within(header).getByRole("button").textContent)).toEqual(COLUMN_NAMES);
    expect(within(headers[1]!).getByRole("button")).toHaveAttribute("title", "Retention time");
  });

  it("puts every field the table sorts by under its own header on the Scans tab (P11)", () => {
    const { container } = renderTable({ rowCount: 6, layout: "full" });
    const order = () => [...container.querySelectorAll("[data-source-index]")].map((row) => row.getAttribute("data-source-index"));
    const headers = () => screen.getAllByRole("columnheader");
    expect(headers().map((header) => header.textContent)).toEqual([
      "Index", "Scan", "Identifier", "MS level", `Retention time${UI_RESOURCES.en.scanUnitNotReported}`, "Base peak m/z",
      "Base peak intensity", "Total ion current", "Precursor m/z",
    ]);
    expect(screen.getByRole("grid", { name: "Scans" })).toHaveAttribute("aria-colcount", "9");
    expect(order()).toEqual(["0", "1", "2", "3", "4", "5"]);

    // Total ion current, which has no column beside the spectrum, sorts from
    // its own header, and its header says which way.
    const tic = () => within(headers()[7]!).getByRole("button", { name: "Total ion current" });
    fireEvent.click(tic());
    expect(order()).toEqual(["0", "1", "2", "3", "4", "5"]);
    fireEvent.click(tic());
    expect(order()).toEqual(["5", "4", "3", "2", "1", "0"]);
    expect(headers()[7]).toHaveAttribute("aria-sort", "descending");
    // The index ascending is the file's own order.
    fireEvent.click(within(headers()[0]!).getByRole("button", { name: "Index" }));
    expect(order()).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(headers()[0]).toHaveAttribute("aria-sort", "ascending");
    // The identifier is a cell of its own, as the file spells it.
    expect(within(screen.getAllByRole("row")[1]!).getAllByRole("gridcell")[2]).toHaveTextContent("controllerType=0 controllerNumber=1 scan=1");
  });

  it("still counts every row the run has, not the rendered window", () => {
    const { container } = renderTable({ rowCount: 400 });

    const grid = screen.getByRole("grid", { name: "Scans" });
    expect(grid).toHaveAttribute("aria-rowcount", "401");
    expect(grid).toHaveAttribute("aria-colcount", "4");
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
    const grid = screen.getByRole("grid", { name: "Scans" });
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
    const grid = screen.getByRole("grid", { name: "Scans" });
    within(grid).getAllByRole("row")[1]?.focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "PageDown" });

    expect(document.activeElement).toHaveAttribute("aria-rowindex", "21");
  });

  it("carries exactly one tab stop among the rendered rows", () => {
    const { container } = renderTable({ rowCount: 400 });

    expect(container.querySelectorAll('[role="row"][tabindex="0"]')).toHaveLength(1);
  });

  it("marks the selected row for a reader as well as for the eye", () => {
    renderTable({ rowCount: 40, selection: commit(3, 1) });

    const grid = screen.getByRole("grid", { name: "Scans" });
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
 * 600px default: the 30px header leaves 570px for rows of 28px each.
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

    // Row 30 sits at canvas offset 840 and the rows have 570px, so the least
    // scroll that shows all of it is 840 + 28 - 570.
    commitSelection(commit(30, 1));

    expect(viewport.scrollTop).toBe(298);
  });

  it("puts a row above the fold exactly at the top of the canvas, header included once", () => {
    // The discriminating case. The header is `position: sticky`, so the canvas
    // already begins after it and `scrollTop = rowTop` places the row
    // immediately below it. Subtracting the header again would land on 530 and
    // scroll a row that was about to be perfectly placed one row too far.
    const { container, commitSelection } = renderTable({ rowCount: 400 });
    const viewport = viewportOf(container);
    fireEvent.scroll(viewport, { target: { scrollTop: 900 } });

    commitSelection(commit(20, 1));

    expect(viewport.scrollTop).toBe(560);
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
    expect(viewport.scrollTop).toBe(298);

    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    commitSelection(commit(30, 2));

    expect(viewport.scrollTop).toBe(298);
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

    expect(viewport.scrollTop).toBe(298);
  });
});

describe("stepping through scans from the table", () => {
  it("offers Previous and Next, and refuses them where the table ends", () => {
    const { onSelectPrevious, onSelectNext } = renderTable({ canSelectNext: true });

    const previous = screen.getByRole("button", { name: "Previous scan" });
    const next = screen.getByRole("button", { name: "Next scan" });
    // Refused rather than disabled, so each stays a Tab stop (UI-24).
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toHaveAttribute("aria-disabled");

    fireEvent.click(next);

    expect(onSelectNext).toHaveBeenCalledTimes(1);
    expect(onSelectPrevious).not.toHaveBeenCalled();
  });

  it("says why Previous and Next are refused while the filters hide the selection", () => {
    renderTable({ selection: commit(3, 1) });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search loaded scans" }), { target: { value: "no such scan" } });

    const reason = "Selected scan 3 is hidden by the filters.";
    expect(screen.getByText(reason)).toBeVisible();
    for (const name of ["Previous scan", "Next scan"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(reason);
    }
  });

  it("does not present the end of a truncated prefix as the end of the run", () => {
    renderTable({ rowCount: 40, truncated: true });

    const count = document.querySelector(".scan-result-count");
    expect(count).toHaveTextContent(UI_RESOURCES.en.scanPrefix);
    expect(count).toHaveTextContent("400");
    expect(count).toBeVisible();
  });

  it("gives one number while every row is loaded and none is filtered out", () => {
    renderTable({ rowCount: 40 });
    const count = () => document.querySelector(".scan-result-count")?.textContent ?? "";
    const all = UI_RESOURCES.en.scanCountAll.replace(/\{\{\s*count(?:,\s*number)?\s*\}\}/u, "40");

    expect(count()).toBe(all);

    // Filtering is when matches and loaded rows differ, so both are said.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "scan=1" } });
    expect(count()).not.toBe(all);
    expect(count()).toMatch(/40/u);
  });
});

describe("the spectrum table while selection is unavailable", () => {
  const BLOCKED = {
    status: "unavailable",
    reason: "conversion-running",
    message: "Selecting a scan is unavailable while a conversion is running.",
  } as const;

  function blocked(options: TableOptions = {}) {
    return renderTable({ ...options, selectionAvailability: BLOCKED });
  }

  function grid(): HTMLElement {
    return screen.getByRole("grid", { name: "Scans" });
  }

  it("does not commit a clicked row", () => {
    // A closed control is asserted by pressing it: `aria-disabled` is an
    // affordance, and what matters is that nothing crossed the boundary.
    const { onSelect } = blocked();

    fireEvent.click(within(grid()).getAllByRole("row")[1] as HTMLElement);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not commit on Enter or Space", () => {
    const { onSelect } = blocked();
    const rows = within(grid()).getAllByRole("row");
    rows[1]?.focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: " " });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps Previous and Next unavailable through the same lane rule", () => {
    // Their `canSelect*` inputs are the lane rule and adjacency together, which
    // is the workspace's job; here they are simply closed, and pressing them
    // proves it rather than reading the attribute.
    const { onSelectPrevious, onSelectNext } = blocked({
      canSelectPrevious: false,
      canSelectNext: false,
      selection: commit(3, 1),
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Next scan" }));

    expect(onSelectPrevious).not.toHaveBeenCalled();
    expect(onSelectNext).not.toHaveBeenCalled();
  });

  it("still walks the rows with the arrows, pages, Home and End", () => {
    blocked({ rowCount: 400 });
    within(grid()).getAllByRole("row")[1]?.focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAttribute("aria-rowindex", "3");

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "PageDown" });
    expect(document.activeElement).toHaveAttribute("aria-rowindex", "22");

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Home" });
    expect(document.activeElement).toHaveAttribute("aria-rowindex", "2");
  });

  it("moves the tab stop to a clicked row even though it does not commit it", () => {
    // The click still meant "I am here". Taking the tab stop away as well would
    // be a second surprise on top of the one the reader already has.
    blocked({ rowCount: 40 });
    const rows = within(grid()).getAllByRole("row");

    fireEvent.click(rows[3] as HTMLElement);

    expect(rows[3]).toHaveAttribute("tabindex", "0");
    expect(rows[1]).toHaveAttribute("tabindex", "-1");
  });

  it("still scrolls, and still renders a window rather than the whole run", () => {
    const { container } = blocked({ rowCount: 4_000 });
    const viewport = requireElement(container, ".spectrum-table-viewport");

    expect(container.querySelectorAll('[role="row"]').length).toBeLessThan(100);
    fireEvent.scroll(viewport, { target: { scrollTop: 600 } });
    expect(container.querySelectorAll('[role="row"]').length).toBeLessThan(100);
    // And the window moved with the scroll rather than staying at the top.
    expect(
      container.querySelector('[role="row"]:not(.spectrum-table-head)')?.getAttribute(
        "aria-rowindex",
      ),
    ).not.toBe("2");
  });

  it("keeps the selected row selected and readable", () => {
    const { container } = blocked({ rowCount: 40, selection: commit(3, 1) });
    const selected = requireElement(container, '[role="row"][aria-selected="true"]');

    expect(selected).toHaveAttribute("aria-rowindex", "5");
    expect(within(selected).getByText("Selected,")).toBeInTheDocument();
    // Its values are still readable rather than blanked out or hidden.
    expect(selected.textContent).toMatch(/MS\d/u);
  });

  it("marks the rows rather than the grid, and points at the one explanation", () => {
    const { container } = blocked({ rowCount: 40 });

    // The grid is navigable; it is the rows that cannot be activated.
    expect(grid().getAttribute("aria-disabled")).toBeNull();
    expect(grid().getAttribute("aria-describedby")).toBe("viewer-selection-availability");
    for (const row of container.querySelectorAll('[role="row"]:not(.spectrum-table-head)')) {
      expect(row.getAttribute("aria-disabled")).toBe("true");
    }
    // The sentence itself lives once, in the viewer. Not here.
    expect(screen.queryByText(/conversion is running/u)).toBeNull();
    // Navigation help stays reachable; the row names the one current refusal.
    expect(screen.getByText(/Enter\/Space opens\./u)).toBeInTheDocument();
  });

  it("says nothing about availability, and describes nothing, once selection returns", () => {
    const { container } = renderTable({ rowCount: 40 });

    expect(grid().getAttribute("aria-describedby")).toBeNull();
    for (const row of container.querySelectorAll('[role="row"]:not(.spectrum-table-head)')) {
      expect(row.getAttribute("aria-disabled")).toBeNull();
    }
    expect(screen.getByText(/Enter\/Space opens\./u)).toBeInTheDocument();
  });

  it("commits again as soon as the lane clears, without being remounted", () => {
    const { onSelect, rerenderWithAvailability } = blocked({ rowCount: 40 });
    const rows = () => within(grid()).getAllByRole("row");

    fireEvent.click(rows()[2] as HTMLElement);
    expect(onSelect).not.toHaveBeenCalled();

    rerenderWithAvailability({ status: "available" });

    fireEvent.click(rows()[2] as HTMLElement);
    expect(onSelect.mock.calls).toEqual([[1]]);
    expect(grid().getAttribute("aria-describedby")).toBeNull();
  });
});

interface StepProps {
  readonly canSelectPrevious: boolean;
  readonly canSelectNext: boolean;
  readonly onSelectPrevious: () => void;
  readonly onSelectNext: () => void;
}

/**
 * The table and the spectrum head's scan steps (direction A), wired as the
 * workspace wires them: the steps walk this table's order, and point at the
 * table's sentence when its filters hide the selection.
 */
function TestSpectrumTable({ canSelectPrevious, canSelectNext, onSelectPrevious, onSelectNext, ...props }: Omit<SpectrumTableProps, "view"> & StepProps) {
  const view = useScanTableView(props.table.rows);
  return <>
    <SpectrumTable {...props} view={view} />
    <SelectedSpectrumPanel state={{ status: "none" }} onOpenFigure={() => {}} onRetry={() => {}} viewport={initialSpectrumViewportState}
      dispatchViewport={() => initialSpectrumViewportState} readViewport={() => initialSpectrumViewportState} projectionError={null}
      onRetryProjection={() => {}} exportState={{ status: "idle" }} scientificExportBusy={false} onExport={() => {}} onCopyPlot={() => {}}
      onDismissExport={() => {}} figureSettingsValidation={{ render: null, dpi: null }}
      canSelectPrevious={canSelectPrevious} canSelectNext={canSelectNext} onSelectPrevious={onSelectPrevious} onSelectNext={onSelectNext}
      stepReasonId={scanStepReasonId(view, props.selection?.index ?? null, props.selectionAvailability)} />
  </>;
}
