import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

afterEach(cleanup);

describe("MSCanvas application shell", () => {
  it("clears the logical workspace without implying source-file deletion", () => {
    render(<App />);

    expect(
      screen.getByRole("checkbox", { name: "Select QC_pool_01.raw" }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));

    expect(screen.getByText("No data in this workspace")).toBeInTheDocument();
    expect(screen.getByText(/Drop RAW, mzML or mzXML files here/i)).toBeInTheDocument();
  });

  it("queues only selected acquisitions", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Convert selected" }));

    expect(screen.getByText("1 queued · 1 completed · 0 failed")).toBeInTheDocument();
  });
});
