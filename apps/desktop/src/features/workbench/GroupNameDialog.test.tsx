import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { GroupNameDialog } from "./GroupNameDialog";

describe("group name composition ownership", () => {
  it("retains raw draft text through composition Enter/Escape before accepting an explicit save", () => {
    const save = vi.fn(), close = vi.fn();
    render(<SessionPreferencesProvider><GroupNameDialog name="Raw 名称/../QC" rename returnTo={null} onSave={save} onClose={close} /></SessionPreferencesProvider>);
    const input = screen.getByRole("textbox", { name: "Group name" });
    fireEvent.change(input, { target: { value: "原始 label {{name}} / QC" } });
    fireEvent.compositionStart(input);
    // A live composition must be enough even on an Escape event whose own
    // isComposing flag is absent; Radix handles this at document capture.
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(close).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(input).toHaveValue("原始 label {{name}} / QC");
    fireEvent.compositionEnd(input);
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    expect(save).toHaveBeenCalledExactlyOnceWith("原始 label {{name}} / QC");
  });
});
