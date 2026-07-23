import { fireEvent, render, screen } from "@testing-library/react";

import { App } from "./App";

describe("MSCanvas application shell", () => {
  it("clears the logical workspace without implying source-file deletion", () => {
    render(<App />);

    expect(screen.getByText("QC_pool_01.raw")).toBeInTheDocument();
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
