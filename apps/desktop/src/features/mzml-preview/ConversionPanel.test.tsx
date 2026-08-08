import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  selectedFile,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { SelectedFile } from "./contracts";

const acquisition: SelectedFile = {
  handle: "file-9",
  fileName: "FT-HCD-MSX.raw",
  byteLength: 78_309,
  sourceKind: "thermo_raw",
  relativeContext: null,
};

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** The roster's own list, so the sort control's options are not mistaken for rows. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("listbox", { name: "Workspace" })).queryAllByRole("option");
}

/** Names the visible copy of a sentence rather than its polite mirror. */
const VISIBLE = { ignore: "[aria-live], script, style" } as const;

function liveRegion(): string {
  return document.querySelector("[data-live-region='conversion']")?.textContent ?? "";
}

describe("converting one focused Thermo RAW acquisition", () => {
  it("says which family every row is, in words rather than in colour", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, acquisition],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });

    expect(rows()[0]).toHaveAccessibleName(expect.stringContaining("mzML"));
    const vendorRow = rows()[1];
    expect(vendorRow).toHaveAccessibleName(expect.stringContaining("Thermo RAW"));
    // The family is part of the row's name rather than a styled marker beside
    // it, so a reader who cannot see the row still learns it.
    expect(within(vendorRow).getByText("Thermo RAW")).toBeVisible();
  });

  it("refuses to preview a vendor row and says what to do instead", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });

    const preview = screen.getByRole("button", { name: "Preview focused" });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAccessibleDescription(
      "Convert to mzML before previewing this acquisition.",
    );
    // And nothing was asked of the backend about it.
    expect(api.openedHandles).toEqual([]);
  });

  it("describes the fixed plan, offers only Fail and Skip, and never offers overwrite", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(within(panel).getByText("Thermo RAW")).toBeVisible();
    expect(within(panel).getByText("mzML")).toBeVisible();
    expect(within(panel).getByText("zlib")).toBeVisible();
    expect(
      within(panel).getByText(/Output-only validation\. This does not compare/),
    ).toBeVisible();

    const policies = within(panel).getAllByRole("radio");
    expect(policies).toHaveLength(2);
    expect(policies[0]).toBeChecked();
    expect(
      within(panel).getByRole("radio", { name: /Stop if a file of that name already exists/ }),
    ).toBeVisible();
    expect(
      within(panel).getByRole("radio", { name: /Skip if a file of that name already exists/ }),
    ).toBeVisible();
    expect(within(panel).queryByText(/overwrite/i)).toBeNull();
  });

  it("converts the focused row, announces it, and reports what was verified", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });
    const panel = await screen.findByRole("region", { name: "Convert" });

    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));

    await waitFor(() => {
      expect(within(panel).getByText(/acquisition\.mzML/)).toBeVisible();
    });
    expect(api.conversionRequests).toEqual([{ handle: "file-9", conflictPolicy: "fail" }]);
    expect(within(panel).getByText("Spectra").nextElementSibling).toHaveTextContent("1");
    // Twice, and correctly: the result says what was verified, and the plan for
    // the next conversion below it says what would be.
    for (const disclosure of within(panel).getAllByText(
      /Output-only validation\. This does not compare/,
    )) {
      expect(disclosure).toBeVisible();
    }
    // The output is not silently adopted into the workspace.
    expect(
      within(panel).getByText(/was not added to the workspace/),
    ).toBeVisible();
    expect(rows()).toHaveLength(1);
    await waitFor(() => {
      expect(liveRegion()).toContain("Converted acquisition.mzML");
    });
  });

  it("says a conversion is running, and says it cannot be cancelled", async () => {
    // Held open rather than settled on a timer: what is under test is the state
    // while a process is running, and a conversion that resolved would let the
    // assertion pass or fail on which turn of the event loop won.
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
      conversion: (request, publish) =>
        new Promise(() => {
          publish({
            status: "running",
            operationId: "1",
            dataset: { ...acquisition, handle: request.handle },
          });
        }),
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });
    const panel = await screen.findByRole("region", { name: "Convert" });

    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));

    await waitFor(() => {
      expect(
        within(panel).getByText(
          "This first conversion workflow cannot cancel a running conversion.",
        ),
      ).toBeVisible();
    });
    expect(within(panel).getByText("Conversion in progress…")).toBeVisible();
    // No cancel, and no fraction of anything.
    expect(within(panel).queryByRole("button", { name: /cancel/i })).toBeNull();
    expect(within(panel).queryByRole("progressbar")).toBeNull();
    expect(panel).toHaveAttribute("aria-busy", "true");
    await waitFor(() => {
      expect(liveRegion()).toContain("This cannot be cancelled.");
    });
  });

  it("recovers a conversion this document did not start", async () => {
    // The slot already holds a finished conversion when the webview mounts,
    // which is what a reload during one looks like from this side.
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
      initialConversion: {
        status: "completed",
        operationId: "7",
        report: {
          datasetHandle: "file-9",
          sourceKind: "thermo_raw",
          outcome: "skipped_existing_destination",
          detailedOutcome: null,
          outputFileName: null,
          output: null,
          validation: null,
          backend: null,
          stagingResidue: null,
          installationGeneration: 0,
        },
      },
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText("A file of that name was already there, and was left untouched."),
      ).toBeVisible();
    });
    // And it does not claim the existing file was inspected.
    expect(within(panel).getByText(/did not inspect it/)).toBeVisible();
    // Nothing was rerun to find this out.
    expect(api.conversionRequests).toEqual([]);
  });

  it("offers the action again once a conversion has finished", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });
    const panel = await screen.findByRole("region", { name: "Convert" });

    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));
    await waitFor(() => {
      expect(within(panel).getByText(/acquisition\.mzML/)).toBeVisible();
    });

    // The report stays, and so does the way to run another. Rust's slot lets a
    // new conversion replace the previous report; a panel that only rendered
    // the report would make the second conversion of a session reachable by
    // reloading the application and no other way.
    const again = within(panel).getByRole("button", { name: "Convert focused…" });
    expect(again).toBeEnabled();
    fireEvent.click(again);
    await waitFor(() => {
      expect(api.conversionRequests).toHaveLength(2);
    });
  });

  it("keeps unrelated rows removable while one row converts", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, acquisition],
      availability: availableBackend,
      conversion: (request, publish) =>
        new Promise(() => {
          publish({
            status: "running",
            operationId: "1",
            dataset: { ...acquisition, handle: request.handle },
          });
        }),
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });
    fireEvent.click(rows()[1]);
    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    });

    // Selecting the converting row makes removal unavailable, because Rust
    // refuses exactly that. Selecting any other row does not.
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
    fireEvent.click(rows()[0]);
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled();
    // Clearing stays unavailable either way: it would revoke the converting row.
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();
  });

  it("says an output was produced and discarded, whatever failed about it", async () => {
    // Rust groups every integrity rejection under `output_rejected` and names
    // the specific property in `detailedOutcome`, so a sentence chosen by the
    // detail alone would never reach any of them.
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
      initialConversion: {
        status: "completed",
        operationId: "3",
        report: {
          datasetHandle: "file-9",
          sourceKind: "thermo_raw",
          outcome: "output_rejected",
          detailedOutcome: "output_declared_counts",
          outputFileName: null,
          output: null,
          validation: null,
          backend: { exitCode: 0, elapsedMilliseconds: 120 },
          stagingResidue: null,
          installationGeneration: 0,
        },
      },
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(
          "The converted file did not pass MSCanvas' integrity checks, so it was discarded.",
        ),
      ).toBeVisible();
    });
  });

  it("keeps an mzML preview on screen when focus moves to a vendor row", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, acquisition],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await screen.findByRole("grid", { name: "Spectra" });

    // Move the keyboard to the vendor row.
    fireEvent.click(rows()[1]);
    await screen.findByRole("region", { name: "Convert" });

    // The viewer still belongs to the mzML row it was opened for.
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(rows()[0]).toHaveAccessibleName(expect.stringContaining("Showing"));
  });

  it("refuses every route into a preview of a vendor row, not just the button", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, acquisition],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });

    // A preview of the mzML row first, so there is something to lose.
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await screen.findByRole("grid", { name: "Spectra" });
    const openedAfterPreview = api.openedHandles.length;

    // Enter on the focused vendor row, and a double-click on it.
    fireEvent.click(rows()[1]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    fireEvent.doubleClick(rows()[1]);

    // Nothing was asked of the backend, and the viewer still belongs to the
    // row it was opened for.
    expect(api.openedHandles).toHaveLength(openedAfterPreview);
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
  });

  it("says why a drop was refused while a conversion runs", async () => {
    const transport = createFakeWorkspaceDropTransport();
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
    });
    render(
      <WorkspaceDropTransportProvider value={transport}>
        <PreviewApiProvider value={api}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });

    await act(async () => {
      transport.emit({ sequence: 1, state: { status: "rejected", reason: "conversion_busy" } });
      await Promise.resolve();
    });

    // Its own sentence, not the one a second drop gets: the two are refused for
    // different lengths of time and the user does something different about
    // each.
    // The visible notice, named apart from its polite mirror: both say it, and
    // that is the established shape here.
    const spoken = /MSCanvas is converting an acquisition, so those files were not added/;
    expect(screen.getByText(spoken, VISIBLE)).toBeVisible();
    expect(document.querySelector("[data-live-region='drop']")?.textContent ?? "").toMatch(spoken);
  });

  it("makes acquiring and curating unavailable while a conversion holds the workspace", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [acquisition],
      availability: availableBackend,
      conversion: (request, publish) =>
        new Promise(() => {
          publish({
            status: "running",
            operationId: "1",
            dataset: { ...acquisition, handle: request.handle },
          });
        }),
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });
    const panel = await screen.findByRole("region", { name: "Convert" });

    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    // Reading the list is not a mutation and stays available.
    expect(screen.getByRole("searchbox", { name: "Search files" })).toBeEnabled();
    expect(rows()).toHaveLength(1);
  });

  it("keeps the converting row visible when a search would have hidden it", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, acquisition],
      availability: availableBackend,
      conversion: (request, publish) =>
        new Promise(() => {
          publish({
            status: "running",
            operationId: "1",
            dataset: { ...acquisition, handle: request.handle },
          });
        }),
    });
    renderApp(api);
    await screen.findByRole("option", { name: /FT-HCD-MSX\.raw/ });
    fireEvent.click(rows()[1]);
    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC_pool" },
    });

    const converting = screen.getByRole("option", { name: /FT-HCD-MSX\.raw/ });
    expect(converting).toBeVisible();
    expect(converting).toHaveAccessibleName(
      expect.stringContaining("Converting — outside search"),
    );
  });
});
