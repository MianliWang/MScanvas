import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./SegmentedControl";

type Precision = "32" | "64";
type Trace = "tic" | "bpc" | "xic";

function Harness({ onChange, disabled }: { onChange?: (value: Trace) => void; disabled?: boolean }) {
  const [value, setValue] = useState<Trace>("bpc");
  return <SegmentedControl label="Trace" value={value} disabled={disabled}
    options={[{ value: "tic", label: "TIC" }, { value: "bpc", label: "BPC" }, { value: "xic", label: "XIC" }]}
    onChange={next => { setValue(next); onChange?.(next); }} />;
}

describe("SegmentedControl", () => {
  it("is a named radiogroup whose checked radio is the one Tab stop", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Trace" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map(radio => radio.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map(radio => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("moves and chooses with the arrow keys, wrapping at the ends", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const bpc = screen.getByRole("radio", { name: "BPC" });
    fireEvent.keyDown(bpc, { key: "ArrowRight" });
    const xic = screen.getByRole("radio", { name: "XIC" });
    expect(xic).toHaveFocus();
    expect(xic).toHaveAttribute("aria-checked", "true");
    expect(xic.tabIndex).toBe(0);
    fireEvent.keyDown(xic, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "TIC" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("radio", { name: "TIC" }), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "XIC" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "XIC" }), { key: "ArrowUp" });
    expect(screen.getByRole("radio", { name: "BPC" })).toHaveFocus();
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(["xic", "tic", "xic", "bpc"]);
  });

  it("chooses on click and ignores a click on the checked option", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "BPC" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "TIC" }));
    expect(onChange).toHaveBeenCalledWith("tic");
  });

  it("can be labelled by visible text and frozen", () => {
    render(<><span id="precision">m/z precision</span>
      <SegmentedControl<Precision> labelledBy="precision" value="64" disabled onChange={() => {}}
        options={[{ value: "32", label: "32-bit" }, { value: "64", label: "64-bit" }]} /></>);
    expect(screen.getByRole("radiogroup", { name: "m/z precision" })).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });
});
