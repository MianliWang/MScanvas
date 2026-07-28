import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import type { SelectedSpectrumOutcome } from "../features/mzml-preview/contracts";
import {
  availableBackend,
  buildPreview,
  chosenBackend,
  buildSpectrum,
  createFakePreviewApi,
  deferred,
  previewError,
  selectedFile,
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

  it("reports the installation the user chose, never the one it replaced", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: chosenBackend,
    });
    renderApp(api);
    expect(await screen.findByText("ProteoWizard is not available")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));

    expect(await screen.findByText(/ProteoWizard is available/)).toHaveTextContent("3.0.26013");
    expect(screen.getByText(/from the folder you chose/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Open mzML…" })).toBeEnabled();
  });

  it("drops what the previous installation read when the installation changes", async () => {
    // The table's rows are what a later selected spectrum is reconciled
    // against. Keeping them across a change would compare a spectrum read by
    // the new installation with rows read by the old one, and both honest
    // outcomes of that -- a wrong result or an invented conflict -- are worse
    // than asking the user to open the file again.
    const api = createFakePreviewApi({ chosenInstallation: chosenBackend });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });
    const readsBefore = api.openCount();

    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));

    await waitFor(() => {
      expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
    });
    // And nothing was re-read on the user's behalf: changing the installation
    // is not a request to run the new one against the open file.
    expect(api.openCount()).toBe(readsBefore);
  });

  it("offers the retained file back after an installation change", async () => {
    // WF-001: changing the backend must not discard the workspace. The
    // readings do go -- they belong to an installation no longer in use -- but
    // Rust still holds the file, so reopening it must not mean finding it
    // again in the picker.
    const api = createFakePreviewApi({ chosenInstallation: chosenBackend });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });
    const picksBefore = api.requestedSpectra.length;

    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    const reopen = await screen.findByRole("button", { name: /^Reopen / });

    expect(reopen).toHaveTextContent("QC_pool_01.mzML");
    fireEvent.click(reopen);

    // Read again from the handle Rust kept, with no second trip to the picker.
    expect(await screen.findByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(api.requestedSpectra.length).toBe(picksBefore);
  });

  it("starts no second backend request while one is outstanding", async () => {
    // The two installation commands contend for a single lock in Rust, and it
    // does not grant in call order. Letting a second start means acting on a
    // verdict already being replaced, so the actions that would start one are
    // closed for as long as one is running -- the folder picker's own dialog
    // included, which closes well before the probes it triggers finish.
    const recheck = deferred<typeof availableBackend>();
    let first = true;
    const api = createFakePreviewApi({
      availability: () => {
        if (!first) {
          return Promise.resolve(availableBackend);
        }
        first = false;
        return recheck.promise;
      },
    });
    renderApp(api);

    // Nothing to act on and nothing to act with while the first check runs.
    expect(screen.queryByRole("button", { name: "Choose folder…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open mzML…" })).toBeDisabled();

    recheck.resolve(availableBackend);

    const choose = await screen.findByRole("button", { name: "Choose folder…" });
    expect(choose).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("keeps the verdict it had when the folder picker is dismissed", async () => {
    // Dismissing changes nothing, so replacing what is on screen -- with a new
    // verdict or with "checking" -- would say something happened that did not.
    const api = createFakePreviewApi({ chosenInstallation: null });
    renderApp(api);
    expect(await screen.findByText(/ProteoWizard is available/)).toHaveTextContent("3.0.25000");

    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));

    await waitFor(() => {
      expect(screen.getByText(/ProteoWizard is available/)).toHaveTextContent("3.0.25000");
    });
    expect(screen.queryByText(/from the folder you chose/)).toBeNull();
    expect(screen.queryByText(/Checking for an installed/)).toBeNull();
  });

  it("can go back to searching automatically after choosing a folder", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      chosenInstallation: chosenBackend,
    });
    renderApp(api);
    await screen.findByText("ProteoWizard is not available");
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await screen.findByText(/from the folder you chose/);

    fireEvent.click(screen.getByRole("button", { name: "Search automatically" }));

    // Back to what automatic discovery finds, and saying so.
    expect(await screen.findByText("ProteoWizard is not available")).toBeVisible();
    expect(screen.queryByText(/from the folder you chose/)).toBeNull();
  });

  it("offers a way out when the backend call itself fails", async () => {
    // A failed call does not say which installation was in use, so a banner
    // that only offered "check again" could leave a chosen folder in place
    // with no way to stop using it.
    const api = createFakePreviewApi({
      availability: () => Promise.reject(previewError({ kind: "preview_worker_unavailable" })),
    });
    renderApp(api);

    await screen.findByRole("button", { name: "Search automatically" });
    expect(screen.getByRole("button", { name: "Choose folder…" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
  });

  it("notices a backend that has gone away and can be told to look again", async () => {
    let installed = true;
    const api = createFakePreviewApi({
      availability: () =>
        Promise.resolve(installed ? availableBackend : unavailableBackend),
      preview: () => {
        installed = false;
        return Promise.reject(previewError({ kind: "backend_not_found", retryable: false }));
      },
    });
    await openTheFile(api);

    // The failed open re-checks: the banner must not keep insisting the
    // backend is there after it has gone.
    expect(await screen.findByText("ProteoWizard is not available")).toBeVisible();

    // And once it is back, the user can say so without restarting.
    installed = true;
    fireEvent.click(screen.getAllByRole("button", { name: "Check again" })[0] as HTMLElement);
    expect(await screen.findByText(/ProteoWizard is available/)).toBeVisible();
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
    // The scan number has a column of its own: the identifier that carries it
    // is truncated from the right, where the scan number is.
    expect(within(grid).getByRole("columnheader", { name: "Scan" })).toBeVisible();
  });

  it("records both timings only once what they name is in the document", async () => {
    await openTheFile(createFakePreviewApi());
    await screen.findByRole("grid", { name: "Spectra" });

    // Recorded from a layout effect, so both read as measured rather than
    // staying "Not measured yet" as they would if the response handler had
    // been the only thing to run.
    expect(screen.getByText("Open to first preview").nextElementSibling).not.toHaveTextContent(
      "Not measured yet",
    );
    expect(screen.getByText("Row select to rendered").nextElementSibling).toHaveTextContent(
      "Not measured yet",
    );

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");
    await screen.findByRole("img");

    await waitFor(() => {
      expect(screen.getByText("Row select to rendered").nextElementSibling).not.toHaveTextContent(
        "Not measured yet",
      );
    });
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

  it("keeps the open file on screen when the picker itself fails", async () => {
    let pickerAttempts = 0;
    const api = createFakePreviewApi({
      file: () => {
        pickerAttempts += 1;
        return pickerAttempts === 1
          ? Promise.resolve(selectedFile)
          : Promise.reject(previewError({ kind: "file_picker_failed" }));
      },
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    // The user reaches for another file and the dialog will not open.
    fireEvent.click(screen.getByRole("button", { name: "Open mzML…" }));
    expect(await screen.findByText("The file picker could not be opened")).toBeVisible();

    // Failing to choose a new file is no reason to take away the one already
    // open: it is still open in Rust and still on screen.
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Run" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try choosing a file again" }));
    await waitFor(() => {
      expect(pickerAttempts).toBe(3);
    });
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
  });

  it("draws a spectrum that carries negative intensity below the zero line", async () => {
    const api = createFakePreviewApi({
      spectrum: (index) => {
        const spectrum = buildSpectrum(index, 4);
        return Promise.resolve<SelectedSpectrumOutcome>({
          outcome: "spectrum",
          // Baseline subtraction produces negative intensities, and the typed
          // parser accepts them.
          spectrum: { ...spectrum, intensity: [500, -900, 200, -100] },
        });
      },
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");
    await screen.findByRole("img");

    expect(
      screen.getByText(
        /2 of the points carry negative intensity; the lowest in each column is drawn below the zero line\./,
      ),
    ).toBeVisible();
    // All four points are drawn; none is dropped for being below zero.
    expect(screen.getByText(/Drawn as 4 sticks, one per point\./)).toBeVisible();
    // The furthest-from-zero value sets the scale and is labelled.
    expect(screen.getByText("-900.00")).toBeInTheDocument();
    expect(screen.queryByText("no intensity above zero")).not.toBeInTheDocument();
  });

  it("loads and draws the spectrum for the row the user selects", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=3");

    expect(await screen.findByRole("img")).toHaveAccessibleName(
      "Spectrum 2, MS2, 12 points. m/z ranges from 300.0000 to 305.5000. The most intense peak reported for this spectrum is 507.00 at m/z 305.5000. This file does not report whether these are profile samples or centroided peaks.",
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

  it("describes a truncated spectrum by its whole-spectrum peak, not the prefix", async () => {
    const api = createFakePreviewApi({
      spectrum: (index) => {
        const spectrum = buildSpectrum(index, 8);
        return Promise.resolve<SelectedSpectrumOutcome>({
          outcome: "spectrum",
          spectrum: {
            ...spectrum,
            // The whole spectrum is larger than what was transferred, and its
            // tallest peak is not in the transferred prefix.
            pointCount: 900_000,
            truncated: true,
            basePeakMz: 812.5,
            basePeakIntensity: 4_200_000,
          },
        });
      },
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    const plot = await screen.findByRole("img");
    expect(plot).toHaveAccessibleName(/most intense peak reported for this spectrum is 4\.200e\+6/);
    expect(plot).toHaveAccessibleName(/The drawing covers the first 8 of those points\./);
    // The tallest point in the prefix is never presented as the spectrum's.
    expect(plot).not.toHaveAccessibleName(/359\.00/);
    // The notice limits itself to the drawing, so it cannot contradict the
    // whole-spectrum facts stated beside it.
    expect(screen.getByRole("note")).toHaveTextContent(
      "Only the drawing is limited to the first 8 points; the point count, m/z range and base peak below are the backend's own values for the whole spectrum.",
    );
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

    // Retention time carries no unit, so it says so instead of guessing one —
    // in the detail panel and beside the table's own values.
    expect(screen.getAllByText(/\(unit not reported\)/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/retention times have no unit because the file reports none/),
    ).toBeVisible();
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
