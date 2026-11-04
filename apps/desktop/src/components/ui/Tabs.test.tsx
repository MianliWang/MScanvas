import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Tabs } from "./Tabs";

type View = "scans" | "metadata" | "exports";

function Harness() {
  const [view, setView] = useState<View>("scans");
  return <Tabs label="Acquisition" value={view} onChange={setView}
    items={[{ value: "scans", label: "Scans" }, { value: "metadata", label: "Metadata" }, { value: "exports", label: "Exports" }]}>
    <p>{view} content</p>
  </Tabs>;
}

describe("Tabs", () => {
  it("has a named tablist, tabs and a panel labelled by the selected tab", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Acquisition" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map(tab => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole("tabpanel", { name: "Scans" });
    expect(tabs[0]).toHaveAttribute("aria-controls", panel.id);
    expect(tabs[1]).not.toHaveAttribute("aria-controls");
    expect(panel).toHaveTextContent("scans content");
  });

  it("moves and selects with arrows (wrapping), Home and End", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Scans" }), { key: "ArrowRight" });
    const metadata = screen.getByRole("tab", { name: "Metadata" });
    expect(metadata).toHaveFocus();
    expect(metadata).toHaveAttribute("aria-selected", "true");
    expect(metadata.tabIndex).toBe(0);
    expect(screen.getByRole("tabpanel", { name: "Metadata" })).toHaveTextContent("metadata content");

    fireEvent.keyDown(metadata, { key: "End" });
    expect(screen.getByRole("tab", { name: "Exports" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Exports" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Scans" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Scans" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Exports" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Exports" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Scans" })).toHaveFocus();
  });

  it("unmounts the previous panel, even when both tabs render the same component", () => {
    function Counter() {
      const [count, setCount] = useState(0);
      return <button type="button" onClick={() => setCount(count + 1)}>Count {count}</button>;
    }
    function SameType() {
      const [view, setView] = useState<"a" | "b">("a");
      return <Tabs label="Same" value={view} onChange={setView}
        items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}><Counter /></Tabs>;
    }
    render(<SameType />);
    fireEvent.click(screen.getByRole("button", { name: "Count 0" }));
    expect(screen.getByRole("button", { name: "Count 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.getByRole("button", { name: "Count 0" })).toBeInTheDocument();
  });

  it("selects on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Exports" }));
    expect(screen.getByRole("tabpanel", { name: "Exports" })).toHaveTextContent("exports content");
  });
});
