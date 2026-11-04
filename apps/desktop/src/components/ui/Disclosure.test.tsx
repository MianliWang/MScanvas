import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Disclosure } from "./Disclosure";

describe("Disclosure", () => {
  it("is a quiet sm button that shows and hides the region it controls", () => {
    render(<Disclosure label="Excluded rows (2)" regionProps={{ "data-testid": "excluded" }}>
      <p>a.raw</p>
    </Disclosure>);
    const button = screen.getByRole("button", { name: "Excluded rows (2)" });
    const region = screen.getByTestId("excluded");
    expect(button).toHaveClass("ui-button", "ui-button--quiet", "ui-button--sm");
    expect(button).toHaveAttribute("aria-controls", region.id);
    expect(region.id).not.toBe("");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(region).not.toBeVisible();
    const chevron = () => button.querySelector("path")?.getAttribute("d");
    const closed = chevron();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(region).toBeVisible();
    expect(chevron()).not.toBe(closed);

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(region).not.toBeVisible();
  });

  it("when controlled, reports the change and follows only its open prop", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Disclosure label="Setting up ProteoWizard" variant="secondary" open={false}
      onOpenChange={onOpenChange} data-backend-help="" regionProps={{ id: "backend-help" }}>Steps</Disclosure>);
    const button = screen.getByRole("button", { name: "Setting up ProteoWizard" });
    expect(button).toHaveClass("ui-button--secondary");
    expect(button).toHaveAttribute("data-backend-help");
    expect(button).toHaveAttribute("aria-controls", "backend-help");

    fireEvent.click(button);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(button).toHaveAttribute("aria-expanded", "false");

    rerender(<Disclosure label="Setting up ProteoWizard" variant="secondary" open
      onOpenChange={onOpenChange} data-backend-help="" regionProps={{ id: "backend-help" }}>Steps</Disclosure>);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Steps")).toBeVisible();
  });

  it("does not toggle while refused", () => {
    render(<><span id="busy">Busy</span>
      <Disclosure label="Details" aria-label="Details for a.raw" refused reasonId="busy">Facts</Disclosure></>);
    const button = screen.getByRole("button", { name: "Details for a.raw" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Facts")).not.toBeVisible();
  });
});
