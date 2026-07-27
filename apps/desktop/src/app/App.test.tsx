import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import type { SelectedSpectrumOutcome } from "../features/mzml-preview/contracts";
import {
  buildPreview,
  buildSpectrum,
  createFakePreviewApi,
  deferred,
  previewError,
  unavailableBackend,
} from "../test/previewFixtures";
import { App } from "./App";

function renderApp(api: PreviewApi): void {
  render(
    <PreviewApiProvider value={api}>
      <App />
    </PreviewApiProvider>,
  );
}

/** Renders, then takes the toolbar's open action, as a user would. */
async function openTheFile(api: PreviewApi): Promise<void> {
  renderApp(api);
  fireEvent.click(await screen.findByRole("button", { name: "Open mzML…" }));
}

function selectRowByIdentifier(identifier: string): void {
  const grid = screen.getByRole("grid", { name: "Spectra" });
  fireEvent.click(within(grid).getByText(identifier));
}

function pressKey(key: string): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

describe("mzML preview workspace", () => {
  it("presents a missing ProteoWizard installation as a state with a corrective action", async () => {
    renderApp(createFakePreviewApi({ availability: unavailableBackend }));

    expect(await screen.findByText("ProteoWizard is not available")).toBeVisible();
    expect(
      screen.getByText("No ProteoWizard installation was found on this machine."),
    ).toBeVisible();
    expect(screen.getByText("Install ProteoWizard, then check again.")).toBeVisible();
    // Opening a file cannot succeed without a backend, so it is not offered.
    expect(screen.getByRole("button", { name: "Open mzML…" })).toBeDisabled();
  });

  it("reports an available backend with the release the backend itself named", async () => {
    renderApp(createFakePreviewApi());

    expect(await screen.findByText(/ProteoWizard is available/)).toHaveTextContent("3.0.25000");
    expect(screen.getByRole("button", { name: "Open mzML…" })).toBeEnabled();
  });

  it("loads metadata, the run summary and the spectrum table from one open action", async () => {
    await openTheFile(createFakePreviewApi());

    expect(await screen.findByRole("heading", { name: "Run" })).toBeVisible();
    expect(screen.getByText(/QC_pool_01\.mzML/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "File description" })).toBeVisible();
    expect(screen.getByText("software: pwiz 3.0.25000")).toBeVisible();

    const grid = screen.getByRole("grid", { name: "Spectra" });
    // The header row counts, so six spectra report seven rows.
    expect(grid).toHaveAttribute("aria-rowcount", "7");
    expect(within(grid).getAllByRole("row")).toHaveLength(7);
    expect(within(grid).getByText("controllerType=0 controllerNumber=1 scan=1")).toBeVisible();
  });

  it("treats a dismissed file picker as no change rather than as a failure", async () => {
    const api = createFakePreviewApi({ file: null });
    await openTheFile(api);

    expect(await screen.findByText("Open an mzML file")).toBeVisible();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(api.openCount()).toBe(0);
  });

  it("offers a retry only for a failure the backend called retryable", async () => {
    const retryable = createFakePreviewApi({
      preview: () => Promise.reject(previewError()),
    });
    await openTheFile(retryable);

    fireEvent.click(await screen.findByRole("button", { name: "Try opening this file again" }));
    // Reading the same file again is idempotent, so the retry repeats it
    // rather than reopening the picker.
    await waitFor(() => {
      expect(retryable.openCount()).toBe(2);
    });

    cleanup();

    // A failed picker is a different step, and must be retried as a picker.
    // Retrying it as "open the last file again" would open a file the user was
    // no longer reaching for.
    let pickerAttempts = 0;
    const pickerFails = createFakePreviewApi({
      file: () => {
        pickerAttempts += 1;
        return Promise.reject(previewError({ kind: "file_picker_failed" }));
      },
    });
    await openTheFile(pickerFails);

    fireEvent.click(await screen.findByRole("button", { name: "Try choosing a file again" }));
    await waitFor(() => {
      expect(pickerAttempts).toBe(2);
    });
    expect(pickerFails.openCount()).toBe(0);

    cleanup();

    await openTheFile(
      createFakePreviewApi({
        preview: () =>
          Promise.reject(previewError({ retryable: false, detail: "malformed_output" })),
      }),
    );

    expect(await screen.findByText("The preview could not be produced.")).toBeVisible();
    expect(screen.getByText("malformed_output")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Try opening this file again" }),
    ).not.toBeInTheDocument();
    // Choosing a different file stays available: it is a new action, not a
    // repeat of one that already failed.
    expect(screen.getByRole("button", { name: "Choose a different file" })).toBeVisible();
  });

  it("loads and draws the spectrum for the row the user selects", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=3");

    expect(await screen.findByRole("img")).toHaveAccessibleName(
      "Spectrum 2, MS2, 12 points. m/z ranges from 300.0000 to 305.5000. The maximum intensity is 507.00. This file does not report whether these are profile samples or centroided peaks.",
    );
    expect(screen.getByText(/Drawn as 12 sticks, one per point\./)).toBeVisible();
    expect(api.requestedSpectra).toEqual([2]);
  });

  it("renders a spectrum with no peaks as a spectrum, not as a missing result", async () => {
    const api = createFakePreviewApi({
      spectrum: (index) =>
        Promise.resolve<SelectedSpectrumOutcome>({
          outcome: "spectrum",
          spectrum: buildSpectrum(index, 0),
        }),
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    expect(await screen.findByText("This spectrum has no peaks")).toBeVisible();
    // No plot, and no base peak invented for a spectrum that has none.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("Base peak")).not.toBeInTheDocument();
    expect(screen.queryByText("m/z range")).not.toBeInTheDocument();
    expect(screen.getByText("Points").nextElementSibling).toHaveTextContent("0");
  });

  it("shows an index the run does not contain as a typed answer, not an error", async () => {
    const api = createFakePreviewApi({
      spectrum: (index) =>
        Promise.resolve<SelectedSpectrumOutcome>({ outcome: "unavailable", requestedIndex: index }),
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=2");

    expect(await screen.findByText("No spectrum at index 1")).toBeVisible();
    expect(screen.getByText(/Nothing went wrong\./)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Try loading this spectrum again" }),
    ).not.toBeInTheDocument();
  });

  it("never lets a late reply for an abandoned row overwrite the current one", async () => {
    const slow = deferred<SelectedSpectrumOutcome>();
    const api = createFakePreviewApi({
      spectrum: (index) =>
        index === 1
          ? slow.promise
          : Promise.resolve<SelectedSpectrumOutcome>({
              outcome: "spectrum",
              spectrum: buildSpectrum(index, 4),
            }),
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=2");
    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=4");
    await screen.findByText(/Spectrum 3, MS2, 4 points\./);

    // The abandoned request answers now. It must be discarded.
    slow.resolve({ outcome: "spectrum", spectrum: buildSpectrum(1, 99) });

    await waitFor(() => {
      expect(screen.getByText(/Spectrum 3, MS2, 4 points\./)).toBeVisible();
    });
    expect(screen.queryByText(/Spectrum 1, MS2, 99 points\./)).not.toBeInTheDocument();
    expect(api.requestedSpectra).toEqual([1, 3]);
  });

  it("does not launch a second process for the row it is already reading", async () => {
    const slow = deferred<SelectedSpectrumOutcome>();
    const api = createFakePreviewApi({ spectrum: () => slow.promise });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=2");
    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=2");
    // Every selection is one backend process, so a double click is one read.
    expect(api.requestedSpectra).toEqual([1]);

    slow.resolve({ outcome: "spectrum", spectrum: buildSpectrum(1, 4) });
    await screen.findByText(/Spectrum 1, MS2, 4 points\./);

    // Once it has finished, the same row can be asked for again.
    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=2");
    expect(api.requestedSpectra).toEqual([1, 1]);
  });

  it("keeps every row selectable after a new file is opened mid-load", async () => {
    const abandoned = deferred<SelectedSpectrumOutcome>();
    let requests = 0;
    const api = createFakePreviewApi({
      spectrum: (index) => {
        requests += 1;
        return requests === 1
          ? abandoned.promise
          : Promise.resolve<SelectedSpectrumOutcome>({
              outcome: "spectrum",
              spectrum: buildSpectrum(index, 4),
            });
      },
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");
    // A new file arrives while row 0 is still being read.
    fireEvent.click(screen.getByRole("button", { name: "Open mzML…" }));
    await screen.findByRole("grid", { name: "Spectra" });

    // The same row index must still be selectable in the new file, without
    // waiting for the abandoned read to settle.
    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");
    await screen.findByText(/Spectrum 0, MS2, 4 points\./);
    expect(api.requestedSpectra).toEqual([0, 0]);

    abandoned.resolve({ outcome: "spectrum", spectrum: buildSpectrum(0, 77) });
    await waitFor(() => {
      expect(screen.queryByText(/77 points/)).not.toBeInTheDocument();
    });
  });

  it("discloses a run summary and spectrum list that disagree about the size", async () => {
    const preview = buildPreview(6);
    await openTheFile(
      createFakePreviewApi({
        preview: {
          ...preview,
          runSummary: { ...preview.runSummary, totalSpectrumCount: 9 },
        },
      }),
    );

    // Two separate reads of one file. MSCanvas shows both rather than picking
    // one and presenting a single acquisition with a single size.
    expect(await screen.findByRole("note")).toHaveTextContent(
      "The run summary reports 9 spectra and the spectrum list contains 6.",
    );
  });

  it("states the true spectrum count and says plainly when rows were truncated", async () => {
    await openTheFile(createFakePreviewApi({ preview: buildPreview(120, true) }));

    const grid = await screen.findByRole("grid", { name: "Spectra" });
    expect(grid).toHaveAttribute("aria-rowcount", "250001");
    expect(screen.getByRole("note")).toHaveTextContent(
      "This run has more spectra than one preview transfers.",
    );
    // Windowed: the DOM holds far fewer rows than the table describes.
    expect(within(grid).getAllByRole("row").length).toBeLessThan(120);
  });

  it("moves the focused row with the keyboard and commits the selection explicitly", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);
    const grid = await screen.findByRole("grid", { name: "Spectra" });

    within(grid).getAllByRole("row")[1]?.focus();
    pressKey("ArrowDown");
    pressKey("ArrowDown");
    // Arrow keys move focus only. Each selection launches one backend process,
    // so nothing has been requested yet.
    expect(api.requestedSpectra).toEqual([]);

    pressKey("Enter");
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([2]);
    });
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")[3]).toHaveAttribute("aria-selected", "true");
    });
    expect(within(grid).getAllByRole("row")[1]).toHaveAttribute("aria-selected", "false");
  });

  it("never presents an unreported unit or representation as if it were measured", async () => {
    await openTheFile(createFakePreviewApi());
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");
    await screen.findByRole("img");

    // Retention time carries no unit, so it says so instead of guessing one.
    expect(screen.getAllByText(/\(unit not reported\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d\.\d+ (min|s|seconds|minutes)/)).not.toBeInTheDocument();
    expect(screen.getByText("Peak representation").nextElementSibling).toHaveTextContent(
      "Not reported",
    );
    expect(screen.getByText("Value units").nextElementSibling).toHaveTextContent("Not reported");
    // The same caveat is stated at the drawing, because a reduced profile
    // spectrum looks exactly like a centroided one.
    expect(
      screen.getByText(/does not report whether these are profile samples or centroided peaks, so read each stick/),
    ).toBeVisible();
    // No chromatogram count is emitted, so none is shown as zero.
    expect(screen.getByText("Chromatograms").nextElementSibling).toHaveTextContent("Not reported");
  });
});
