/**
 * Scale behaviour of the two components that meet real acquisition sizes.
 *
 * The representative acquisition measured in M0C has 36,319 spectra, so that
 * is the row count used here rather than a round number. These tests assert
 * that cost stays bounded and that nothing is silently dropped. They assert no
 * duration: a wall-clock threshold would need repeated measurement on a
 * recorded hardware baseline, which this slice does not claim to have.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildRows } from "../../test/previewFixtures";
import { SpectrumTable } from "./SpectrumTable";
import { StickSpectrum } from "./StickSpectrum";

/** The measured representative acquisition. */
const REPRESENTATIVE_ROW_COUNT = 36_319;

function renderTable(rowCount: number) {
  const rows = buildRows(rowCount);
  const onSelect = vi.fn();
  const onRendered = vi.fn();
  const result = render(
    <SpectrumTable
      onRendered={onRendered}
      onSelect={onSelect}
      selectedIndex={null}
      table={{ rows, totalRowCount: rowCount, truncated: false }}
    />,
  );
  return { ...result, onSelect, onRendered };
}

function viewportOf(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector<HTMLElement>(".spectrum-table-viewport");
  expect(viewport).not.toBeNull();
  return viewport as HTMLElement;
}

describe("spectrum table at acquisition scale", () => {
  it("keeps the mounted row count bounded while reporting the real total", () => {
    const { onRendered } = renderTable(REPRESENTATIVE_ROW_COUNT);

    const grid = screen.getByRole("grid", { name: "Spectra" });
    expect(grid).toHaveAttribute("aria-rowcount", String(REPRESENTATIVE_ROW_COUNT + 1));
    // Header plus one window. The bound is what matters, not the exact number.
    expect(within(grid).getAllByRole("row").length).toBeLessThan(100);
    expect(screen.getByText(/36,319 spectra/)).toBeVisible();
    expect(screen.getByText(/all rows loaded/)).toBeVisible();

    const [renderedRowCount] = onRendered.mock.calls.at(-1) ?? [];
    expect(renderedRowCount).toBeLessThan(100);
  });

  it("reaches the last row by scrolling without mounting the rows in between", () => {
    const { container } = renderTable(REPRESENTATIVE_ROW_COUNT);
    const viewport = viewportOf(container);

    fireEvent.scroll(viewport, { target: { scrollTop: REPRESENTATIVE_ROW_COUNT * 30 } });

    const grid = screen.getByRole("grid", { name: "Spectra" });
    const rows = within(grid).getAllByRole("row");
    expect(rows.length).toBeLessThan(100);
    // The final spectrum is reachable and is the one the file actually ends on.
    expect(rows.at(-1)).toHaveAttribute("aria-rowindex", String(REPRESENTATIVE_ROW_COUNT + 1));
    expect(
      within(grid).getByText(`controllerType=0 controllerNumber=1 scan=${REPRESENTATIVE_ROW_COUNT}`),
    ).toBeVisible();
    // Nothing from the top of the run is still mounted.
    expect(
      within(grid).queryByText("controllerType=0 controllerNumber=1 scan=1"),
    ).not.toBeInTheDocument();
  });

  it("jumps to the end with the keyboard and keeps exactly one tab stop", () => {
    const { container, onSelect } = renderTable(REPRESENTATIVE_ROW_COUNT);
    const grid = screen.getByRole("grid", { name: "Spectra" });

    within(grid).getAllByRole("row")[1]?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "End" });

    const rows = within(screen.getByRole("grid", { name: "Spectra" })).getAllByRole("row");
    expect(rows.length).toBeLessThan(100);
    const tabStops = container.querySelectorAll('[role="row"][tabindex="0"]');
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]).toHaveAttribute("aria-rowindex", String(REPRESENTATIVE_ROW_COUNT + 1));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(REPRESENTATIVE_ROW_COUNT - 1);
  });
});

describe("stick spectrum at profile-scale point counts", () => {
  it("bounds the drawn sticks and never loses the most intense point", () => {
    const pointCount = 200_000;
    const mz = new Array<number>(pointCount);
    const intensity = new Array<number>(pointCount);
    for (let point = 0; point < pointCount; point += 1) {
      mz[point] = 200 + point * 0.01;
      intensity[point] = point % 1_000;
    }
    // One deliberate spike, in a column crowded with lower neighbours.
    const spikeIndex = 123_456;
    intensity[spikeIndex] = 5_000_000;

    const { container } = render(
      <StickSpectrum
        intensity={intensity}
        labelledBy="scale-summary"
        mz={mz}
        reportedMzHigh={mz[pointCount - 1] ?? 0}
        reportedMzLow={mz[0] ?? 0}
      />,
    );

    // One path node regardless of point count.
    const paths = container.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    const commands = (paths[0]?.getAttribute("d") ?? "").split("M").length - 1;
    expect(commands).toBeLessThanOrEqual(900);

    expect(screen.getByText(/Drawn as \d+ columns from 200000 points/)).toBeVisible();
    // The spike survives the reduction: it is the axis maximum.
    expect(screen.getByText("5.000e+6")).toBeInTheDocument();
  });
});
