import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

describe("Button", () => {
  it("is a type=button with its variant and size classes", () => {
    const onClick = vi.fn();
    render(<Button variant="primary" size="sm" icon={<Icon name="plus" />} onClick={onClick}>Add files</Button>);
    const button = screen.getByRole("button", { name: "Add files" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ui-button", "ui-button--primary", "ui-button--sm");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("defaults to a secondary md button", () => {
    render(<Button>Open</Button>);
    expect(screen.getByRole("button", { name: "Open" })).toHaveClass("ui-button--secondary", "ui-button--md");
  });

  it("keeps a refused action focusable, swallows its click and points at the reason", () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(<form onSubmit={e => onSubmit(e.nativeEvent)}>
      <p id="why">Open a project first.</p>
      <Button refused reasonId="why" aria-describedby="hint" onClick={onClick}>Save</Button>
      <Button refused reasonId="why" type="submit">Submit</Button>
      <span id="hint">Ctrl+S</span>
    </form>);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    expect(save).toHaveAttribute("aria-describedby", "hint why");
    expect(save).toHaveAccessibleDescription("Ctrl+S Open a project first.");
    save.focus();
    expect(save).toHaveFocus();
    fireEvent.click(save);
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("names the reason only while refused", () => {
    render(<Button reasonId="why">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-describedby");
  });
});

describe("IconButton", () => {
  it("takes its accessible name and tooltip from the label", () => {
    render(<IconButton label="Settings" icon={<Icon name="settings" />} />);
    const button = screen.getByRole("button", { name: "Settings" });
    expect(button).toHaveAttribute("title", "Settings");
    expect(button).toHaveClass("ui-icon-button", "ui-button--quiet");
  });

  it("can be refused like any button", () => {
    const onClick = vi.fn();
    render(<><span id="busy">A conversion is running.</span>
      <IconButton label="Remove" icon={<Icon name="close" />} refused reasonId="busy" title="A conversion is running." onClick={onClick} /></>);
    const button = screen.getByRole("button", { name: "Remove" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "A conversion is running.");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
