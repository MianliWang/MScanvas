import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Splitter } from "./Splitter";

// jsdom has no layout, so the container's size is unmeasured and only the
// lower bound applies; pointer dragging and the measured upper bound are
// verified in rendered QA.
describe("Splitter", () => {
  it("is a focusable, named separator controlling the sized pane", () => {
    render(<Splitter label="Resize roster" defaultSize={280} minFirst={200} first={<p>Roster</p>} second={<p>Evidence</p>} />);
    const separator = screen.getByRole("separator", { name: "Resize roster" });
    expect(separator.tabIndex).toBe(0);
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "280");
    expect(separator).toHaveAttribute("aria-valuemin", "200");
    expect(separator).toHaveAttribute("aria-valuemax", "280");
    const pane = document.getElementById(separator.getAttribute("aria-controls") ?? "");
    expect(pane).toHaveTextContent("Roster");
    expect(pane).toHaveStyle({ flex: "0 0 280px", minWidth: "200px" });
  });

  it("resizes with the arrow keys along its axis, down to the minimum", () => {
    const onChange = vi.fn();
    render(<Splitter label="Resize roster" defaultSize={232} minFirst={200} onChange={onChange}
      first={<p>Roster</p>} second={<p>Evidence</p>} />);
    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "248");
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(separator).toHaveAttribute("aria-valuenow", "248");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([248, 232, 216, 200]);
  });

  it("follows a primary-button pointer drag until release", () => {
    const onChange = vi.fn();
    render(<Splitter label="Resize roster" defaultSize={280} minFirst={200} onChange={onChange}
      first={<p>Roster</p>} second={<p>Evidence</p>} />);
    const separator = screen.getByRole("separator");
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 340 });
    expect(separator).toHaveAttribute("aria-valuenow", "320");
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 100 });
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 400 });
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([320, 200]);
  });

  it("sizes the second pane: moving the bar towards the end shrinks it", () => {
    render(<Splitter label="Resize details" orientation="vertical" sizedPane="second" defaultSize={245} minSecond={180} step={10}
      first={<p>Plots</p>} second={<p>Details</p>} />);
    const separator = screen.getByRole("separator", { name: "Resize details" });
    expect(separator).toHaveAttribute("aria-orientation", "horizontal");
    expect(document.getElementById(separator.getAttribute("aria-controls") ?? "")).toHaveTextContent("Details");
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(separator).toHaveAttribute("aria-valuenow", "235");
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(separator).toHaveAttribute("aria-valuenow", "255");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "180");
  });
});
