import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  it("without roving is a named group whose buttons keep their own Tab stops", () => {
    render(<Toolbar label="Figure actions"><Button>Export</Button><Button>Copy</Button></Toolbar>);
    expect(screen.getByRole("group", { name: "Figure actions" })).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) expect(button.tabIndex).toBe(0);
  });

  it("with roving is one Tab stop; arrows, Home and End move focus and skip native-disabled", () => {
    render(<Toolbar label="Plot" roving>
      <Button>Zoom</Button>
      <Button disabled>Pan</Button>
      <Button refused>Reset</Button>
      <Button>Export</Button>
    </Toolbar>);
    expect(screen.getByRole("toolbar", { name: "Plot" })).toHaveAttribute("aria-orientation", "horizontal");
    const [zoom, pan, reset, exportButton] = screen.getAllByRole("button");
    expect([zoom, reset, exportButton].map(button => button.tabIndex)).toEqual([0, -1, -1]);

    zoom.focus();
    fireEvent.keyDown(zoom, { key: "ArrowRight" });
    expect(reset).toHaveFocus();
    expect(pan).not.toHaveFocus();
    expect([zoom, reset, exportButton].map(button => button.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(reset, { key: "End" });
    expect(exportButton).toHaveFocus();
    fireEvent.keyDown(exportButton, { key: "ArrowRight" });
    expect(zoom).toHaveFocus();
    fireEvent.keyDown(zoom, { key: "ArrowLeft" });
    expect(exportButton).toHaveFocus();
    fireEvent.keyDown(exportButton, { key: "Home" });
    expect(zoom).toHaveFocus();
  });

  it("uses Up/Down when vertical", () => {
    render(<Toolbar label="Side" roving orientation="vertical"><Button>One</Button><Button>Two</Button></Toolbar>);
    const [one, two] = screen.getAllByRole("button");
    one.focus();
    fireEvent.keyDown(one, { key: "ArrowRight" });
    expect(one).toHaveFocus();
    fireEvent.keyDown(one, { key: "ArrowDown" });
    expect(two).toHaveFocus();
  });

  it("leaves a nested radiogroup its own Tab stop and arrow keys", () => {
    function Nested() {
      const [value, setValue] = useState<"a" | "b">("a");
      return <Toolbar label="Chromatogram" roving>
        <Button>Export</Button>
        <SegmentedControl label="Trace" value={value} onChange={setValue}
          options={[{ value: "a", label: "TIC" }, { value: "b", label: "BPC" }]} />
        <Button>Copy</Button>
      </Toolbar>;
    }
    render(<Nested />);
    const tic = screen.getByRole("radio", { name: "TIC" });
    expect(tic.tabIndex).toBe(0);
    tic.focus();
    fireEvent.keyDown(tic, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "BPC" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "BPC" })).toHaveAttribute("aria-checked", "true");

    const exportButton = screen.getByRole("button", { name: "Export" });
    exportButton.focus();
    fireEvent.keyDown(exportButton, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus();
  });

  it("gives a control added later no Tab stop of its own", async () => {
    function Growing() {
      const [more, setMore] = useState(false);
      return <><button type="button" onClick={() => setMore(true)}>Grow</button>
        <Toolbar label="Growing" roving><Button>First</Button>{more ? <Button>Later</Button> : null}</Toolbar></>;
    }
    render(<Growing />);
    fireEvent.click(screen.getByRole("button", { name: "Grow" }));
    const later = await screen.findByRole("button", { name: "Later" });
    await expect.poll(() => later.tabIndex).toBe(-1);
    expect(screen.getByRole("button", { name: "First" }).tabIndex).toBe(0);
  });
});
