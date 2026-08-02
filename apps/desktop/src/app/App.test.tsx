import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import type {
  FolderIngestionResult,
  SelectedFile,
  SelectedSpectrumOutcome,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "../features/mzml-preview/contracts";
import { blurAsABrowserWould } from "../test/browserFocus";
import type { FolderScan, PickedFile } from "../test/previewFixtures";
import {
  COMPLETE_SCAN,
  availableBackend,
  buildPreview,
  chosenBackend,
  chosenFolderWithoutTools,
  buildSpectrum,
  createFakePreviewApi,
  deferred,
  previewError,
  secondFile,
  selectedFile,
  thirdFile,
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

/**
 * Renders, then adds files through the workspace action, as a user would.
 *
 * Adding into an empty session reads exactly the first row that arrived, which
 * is what preserves the one-picker/one-preview experience the single-file
 * workspace had without launching one process per file.
 */
async function openTheFile(api: PreviewApi): Promise<void> {
  renderApp(api);
  fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));
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
    // Reading a file cannot succeed without a backend, so it is not offered.
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    // Curating the workspace is not backend work, so it stays available: the
    // user can build the list they want and read it once ProteoWizard is there.
    expect(await screen.findByRole("button", { name: "Add files…" })).toBeEnabled();
  });

  it("adds files with no backend installed, and reads none of them", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      pickedFiles: [selectedFile, secondFile],
    });
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /QC_pool_02\.mzML/ })).toBeVisible();
    // Not one read. Nothing about an unusable backend stops the user telling
    // MSCanvas which acquisitions this session is about.
    expect(api.openCount()).toBe(0);
    expect(screen.getByText(/Install ProteoWizard to read a file/)).toBeVisible();
  });

  it("reports an available backend with the release the backend itself named", async () => {
    renderApp(createFakePreviewApi());

    expect(await screen.findByText(/ProteoWizard is available/)).toHaveTextContent("3.0.25000");
    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
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
    const reopen = await screen.findByRole("button", { name: /^Preview QC_pool_01/ });

    expect(reopen).toHaveTextContent("QC_pool_01.mzML");
    fireEvent.click(reopen);

    // Read again from the handle Rust kept, with no second trip to the picker.
    expect(await screen.findByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(api.requestedSpectra.length).toBe(picksBefore);
  });

  it("clears a stale workspace when a spectrum load is what notices the backend changed", async () => {
    // The failure is not retryable, so nothing else would say anything: the
    // table stays on screen looking current and every further row fails the
    // same way until the user happens to press Check again.
    const api = createFakePreviewApi({
      spectrum: () =>
        Promise.reject(
          previewError({ kind: "installation_changed_since_preview", retryable: false }),
        ),
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    // The readings go, and the retained file is offered back rather than left
    // looking like it still describes what is installed.
    expect(await screen.findByRole("button", { name: /^Preview QC_pool_01/ })).toBeVisible();
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
  });

  it("clears a stale workspace when the backend changed between the check and the spawn", async () => {
    // A different route to the same truth: the crate notices the executable
    // changed after its check and before the spawn. It reaches the interface as
    // its own typed kind, and it is just as non-retryable, so it needs the same
    // recovery rather than leaving the workspace looking current.
    const api = createFakePreviewApi({
      spectrum: () =>
        Promise.reject(previewError({ kind: "backend_changed_after_check", retryable: false })),
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    // The readings go, and the retained file is offered back rather than left
    // looking like it still describes what is installed.
    expect(await screen.findByRole("button", { name: /^Preview QC_pool_01/ })).toBeVisible();
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
  });

  it("clears a stale workspace when the backend is gone by the time it is run", async () => {
    // A third route to the same truth: the executable was there when it was
    // checked and gone when it was launched. Just as non-retryable, and just as
    // much a reason not to leave the table looking current.
    const api = createFakePreviewApi({
      spectrum: () =>
        Promise.reject(previewError({ kind: "backend_not_found_at_launch", retryable: false })),
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    expect(await screen.findByRole("button", { name: /^Preview QC_pool_01/ })).toBeVisible();
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
  });

  it("re-checks the backend when a row fails in a way that cannot be retried", async () => {
    // A backend replaced in place can keep its file metadata and still stop
    // answering its help probe. That fails inside the provider's own
    // resolution, so it never reaches the comparison that would name it a
    // change -- and without asking, the table would stay on screen with every
    // row failing the same way.
    let installed = true;
    const api = createFakePreviewApi({
      availability: () => Promise.resolve(installed ? availableBackend : unavailableBackend),
      spectrum: () => {
        installed = false;
        return Promise.reject(
          previewError({ kind: "capability_evidence_unavailable", retryable: false }),
        );
      },
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    // The banner stops claiming a backend that no longer answers.
    expect(await screen.findByText("ProteoWizard is not available")).toBeVisible();
  });

  it("does not start a row read while a backend request is outstanding", async () => {
    // Reading a row is backend work, so the one-at-a-time rule has to cover it.
    // Started while an installation is being probed it either reads the backend
    // being replaced or queues behind the change and then fails on it -- one
    // process launch either way, for a result nobody will see.
    const api = createFakePreviewApi({ chosenInstallation: () => new Promise(() => undefined) });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });
    const readsBefore = api.requestedSpectra.length;

    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    expect(api.requestedSpectra.length).toBe(readsBefore);
  });

  it("closes the reading actions when the backend state is not positively available", async () => {
    // A failed call cannot say whether an installation is present. Gating on
    // "explicitly unavailable" left every reading action live in that state, so
    // the only thing it could lead to was another failure -- including after a
    // folder choice that failed before ever reaching the backend.
    const api = createFakePreviewApi({
      availability: () => Promise.reject(previewError({ kind: "preview_worker_unavailable" })),
    });
    renderApp(api);

    await screen.findByRole("button", { name: "Search automatically" });

    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    // Curating is not reading, so it is not closed by a backend nobody can
    // describe: the user can still build the list this session is about.
    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
    // The recovery actions the banner offers stay live -- they are the way out.
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Choose folder…" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();

    recheck.resolve(availableBackend);

    const choose = await screen.findByRole("button", { name: "Choose folder…" });
    expect(choose).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("says why a chosen folder is unusable, and offers only what it can do", async () => {
    // ENV-002 requires an invalid choice to explain itself. "The configured
    // location is not usable" is a category, not a reason, and the advice that
    // came with it named an exact executable path -- something this
    // application has neither a command nor a picker for.
    const api = createFakePreviewApi({ chosenInstallation: chosenFolderWithoutTools });
    renderApp(api);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));

    expect(await screen.findByText(/holds neither msconvert.exe nor msaccess.exe/)).toBeVisible();
    expect(screen.getByText(/Choose a different folder, or go back to searching/)).toBeVisible();
    // Both ways out, and nothing that asks for an executable path.
    expect(screen.getByRole("button", { name: "Search automatically" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Choose a different folder…" })).toBeEnabled();
    expect(screen.queryByText(/msconvert.exe\/msaccess.exe/)).toBeNull();
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
    // Named in the run summary as well as in the workspace list: the summary
    // says which acquisition these numbers describe, and the list says which
    // rows the session holds.
    const summary = screen.getByRole("region", { name: "Run" });
    expect(within(summary).getByText(/QC_pool_01\.mzML/)).toBeVisible();
    expect(screen.getByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
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
    const api = createFakePreviewApi({ pickedFiles: null });
    await openTheFile(api);

    expect(await screen.findByText("No files in this session yet")).toBeVisible();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(api.openCount()).toBe(0);
  });

  it("offers a retry only for a failure the backend called retryable", async () => {
    const retryable = createFakePreviewApi({
      preview: () => Promise.reject(previewError()),
    });
    await openTheFile(retryable);

    fireEvent.click(await screen.findByRole("button", { name: "Try reading this file again" }));
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
      screen.queryByRole("button", { name: "Try reading this file again" }),
    ).not.toBeInTheDocument();
    // The row is still in the workspace and still removable, and adding more
    // files is still available: neither is a repeat of what just failed.
    expect(screen.getByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
  });

  it("keeps what is on screen when the picker itself fails", async () => {
    let pickerAttempts = 0;
    const api = createFakePreviewApi({
      pickedFiles: () => {
        pickerAttempts += 1;
        return pickerAttempts === 1
          ? Promise.resolve([selectedFile])
          : Promise.reject(previewError({ kind: "file_picker_failed" }));
      },
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    // The user reaches for more files and the dialog will not open.
    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));
    expect(await screen.findByText("The file picker could not be opened")).toBeVisible();

    // Failing to choose new files is no reason to take away what is already
    // there: the row is still in the workspace and its preview is still shown.
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Run" })).toBeVisible();
    expect(screen.getByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try choosing files again" }));
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

  it("keeps every row selectable after another dataset is previewed", async () => {
    // A spectrum abandoned by a new preview must not leave its row index
    // unselectable in the dataset now on screen: the guard that stops one row
    // being read twice is keyed by request, not by index.
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile] });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");
    await screen.findByText(/Spectrum 0, MS2, 12 points\./);

    // The second row is previewed explicitly, which is the only way a second
    // dataset is ever read.
    fireEvent.click(screen.getByRole("option", { name: /QC_pool_02\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await waitFor(() => {
      expect(api.openedHandles).toEqual(["file-0", "file-1"]);
    });
    await screen.findByRole("grid", { name: "Spectra" });

    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");
    await screen.findByText(/Spectrum 0, MS2, 12 points\./);
    expect(api.requestedSpectra).toEqual([0, 0]);
  });

  it("ignores a spectrum reply for a row that has been removed", async () => {
    // Removing the active row clears the screen at once. The read it abandoned
    // is still running -- Rust does not cancel work that has started -- and its
    // reply must not put a spectrum back under a row that is gone.
    const abandoned = deferred<SelectedSpectrumOutcome>();
    const api = createFakePreviewApi({ spectrum: () => abandoned.promise });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });
    selectRowByIdentifier("controllerType=0 controllerNumber=1 scan=1");

    fireEvent.click(screen.getByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    await waitFor(() => {
      expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
    });

    abandoned.resolve({ outcome: "spectrum", spectrum: buildSpectrum(0, 77) });

    await waitFor(() => {
      expect(screen.getByText(/The files on disk were not changed/, VISIBLE)).toBeVisible();
    });
    expect(screen.queryByText(/77 points/)).not.toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
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

/**
 * Names the visible notice rather than the polite region that mirrors it.
 *
 * What a workspace action did is said twice on purpose: once where it can be
 * read, and once in a region that was mounted before it had anything to say,
 * which is the shape a screen reader actually announces.
 */
const VISIBLE = { ignore: "[aria-live], script, style" } as const;

/**
 * Every row of the workspace list.
 *
 * Scoped to that listbox on purpose: the sort control is a native select, and
 * its five options carry the same role. A document-wide query would count them
 * as roster rows.
 */
function rosterRows(): HTMLElement[] {
  const list = screen.queryByRole("listbox", { name: "Workspace" });
  return list === null ? [] : within(list).getAllByRole("option");
}

function rosterRow(name: RegExp): HTMLElement {
  return screen.getByRole("option", { name });
}

describe("the session workspace roster", () => {
  it("shows what Rust already holds when the webview is opened again", async () => {
    // A webview can be reloaded while Rust keeps the workspace. The list on
    // screen has to be the list that exists, not the empty one this window
    // happens to start with -- and reading it must cost nothing.
    const api = createFakePreviewApi({ initialDatasets: [selectedFile, secondFile] });
    renderApp(api);

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    expect(rosterRow(/QC_pool_02\.mzML/)).toBeVisible();
    expect(api.openCount()).toBe(0);
    expect(api.rosterReads()).toBe(1);
    // Listed but not selected and not being read: nothing here is a decision
    // the user has made yet.
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
  });

  it("says the list could not be read, and can be told to read it again", async () => {
    let attempts = 0;
    const api = createFakePreviewApi({
      roster: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(previewError({ kind: "preview_worker_unavailable" }))
          : Promise.resolve({ datasets: [selectedFile], capacity: 1_024 });
      },
    });
    renderApp(api);

    expect(await screen.findByText("The workspace list could not be read")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try reading it again" }));

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
  });

  it("reads exactly one file however many were chosen at once", async () => {
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile, thirdFile] });
    await openTheFile(api);

    expect(await screen.findByRole("grid", { name: "Spectra" })).toBeVisible();
    // One picker operation, three rows, one process. Reading all of them would
    // be three ProteoWizard launches against three large files for two results
    // nobody asked to see.
    expect(api.openedHandles).toEqual(["file-0"]);
    expect(rosterRows()).toHaveLength(3);
    // Everything that arrived is selected, so `Remove selected` acts on the
    // batch the user just added; the first of them is the one being shown.
    expect(
      rosterRows().filter((row) => row.getAttribute("aria-selected") === "true"),
    ).toHaveLength(3);
    expect(rosterRow(/QC_pool_01\.mzML/)).toHaveTextContent("▸");
    expect(rosterRow(/QC_pool_02\.mzML/)).not.toHaveTextContent("▸");
    expect(screen.getByText("Added 3 files.", VISIBLE)).toBeVisible();
  });

  it("leaves the file on screen alone when more files are added beside it", async () => {
    let pickerOperations = 0;
    const api = createFakePreviewApi({
      pickedFiles: () => {
        pickerOperations += 1;
        return Promise.resolve(pickerOperations === 1 ? [selectedFile] : [secondFile]);
      },
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    // A second picker operation, adding to a session that already has a file
    // open. Nothing about that is a request to read something else.
    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));
    expect(await screen.findByRole("option", { name: /QC_pool_02\.mzML/ })).toBeVisible();

    expect(api.openedHandles).toEqual(["file-0"]);
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(rosterRow(/QC_pool_01\.mzML/)).toHaveTextContent("▸");
    // The new row is what is selected, so removing it takes it away again.
    expect(rosterRow(/QC_pool_02\.mzML/)).toHaveAttribute("aria-selected", "true");
    expect(rosterRow(/QC_pool_01\.mzML/)).toHaveAttribute("aria-selected", "false");
  });

  it("reports a file the session already holds rather than listing it twice", async () => {
    const api = createFakePreviewApi({ pickedFiles: [selectedFile] });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));

    expect(await screen.findByText(/1 file already in the workspace/, VISIBLE)).toBeVisible();
    expect(screen.getByText("QC_pool_01.mzML is already in the workspace.")).toBeVisible();
    expect(rosterRows()).toHaveLength(1);
    // Nothing was read for it either: it is a row the user already has.
    expect(api.openCount()).toBe(1);
  });

  it("says what a batch did above the list rather than inside it", async () => {
    // A summary that grows with the batch must not take its height from the
    // list it is describing: at a short window that leaves the rows it just
    // announced with nowhere to be. It sits with the other shell notices, is
    // bounded, and says how many items it did not spell out.
    const api = createFakePreviewApi({
      pickedFiles: [
        selectedFile,
        { rejected: "a.mzXML" },
        { rejected: "b.mzXML" },
        { rejected: "c.mzXML" },
        { rejected: "d.mzXML" },
        { rejected: "e.mzXML" },
      ],
    });
    await openTheFile(api);

    const notice = await screen.findByText(/Added 1 file\./, VISIBLE);
    expect(notice).toBeVisible();
    expect(screen.getByText("2 more not listed here.")).toBeVisible();
    // Above the workspace column, not inside the roster panel.
    expect(notice.closest(".shell-notices")).not.toBeNull();
    expect(notice.closest(".dataset-roster-panel")).toBeNull();
  });

  it("keeps the files it could read and names the ones it could not", async () => {
    const api = createFakePreviewApi({
      pickedFiles: [
        selectedFile,
        { rejected: "acquisition.mzXML" },
        secondFile,
        { rejected: "gone.mzML", error: previewError({ kind: "file_not_resolvable" }) },
      ],
    });
    await openTheFile(api);

    expect(await screen.findByText(/Added 2 files\./, VISIBLE)).toBeVisible();
    expect(screen.getByText(/2 files could not be added/, VISIBLE)).toBeVisible();
    expect(screen.getByText(/acquisition\.mzXML:/)).toBeVisible();
    // A rejected candidate is named by its file name and nothing else: no
    // folder, no path.
    expect(screen.queryByText(/[A-Z]:\\/)).toBeNull();
    expect(rosterRows()).toHaveLength(2);
  });

  it("says plainly when a file did not fit the session", async () => {
    const api = createFakePreviewApi({ capacity: 1, pickedFiles: [selectedFile, secondFile] });
    await openTheFile(api);

    expect(await screen.findByText(/1 file did not fit/, VISIBLE)).toBeVisible();
    expect(rosterRows()).toHaveLength(1);
    // The limit is stated where the count is, rather than left to be inferred
    // from a refusal.
    expect(screen.getByText(/1 of 1 files in this session/)).toBeVisible();
  });

  it("removes the selected rows, keeps the preview whose row survived, and says the files are untouched", async () => {
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile, thirdFile] });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    // The first row is the one being shown; the other two are removed.
    fireEvent.click(rosterRow(/QC_pool_02\.mzML/));
    fireEvent.click(rosterRow(/Blank_03\.mzML/), { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    await waitFor(() => {
      expect(rosterRows()).toHaveLength(1);
    });
    expect(screen.getByText(/Removed 2 files from the list\./, VISIBLE)).toBeVisible();
    expect(screen.getByText(/The files on disk were not changed\./, VISIBLE)).toBeVisible();
    // The preview belonged to a row that survived, so it is still on screen.
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(rosterRow(/QC_pool_01\.mzML/)).toHaveTextContent("▸");
  });

  it("clears the preview when the row it belongs to is removed, and reads nothing else", async () => {
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile] });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });
    const readsBefore = api.openCount();

    fireEvent.click(rosterRow(/QC_pool_01\.mzML/));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    await waitFor(() => {
      expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
    });
    // Nothing takes its place on its own: reading another acquisition is an
    // action the user takes.
    expect(api.openCount()).toBe(readsBefore);
    // And the row that took its position has the tab stop, so the keyboard
    // still has somewhere to be.
    expect(rosterRow(/QC_pool_02\.mzML/)).toHaveAttribute("tabindex", "0");
    expect(rosterRow(/QC_pool_02\.mzML/)).toHaveAttribute("aria-selected", "true");
  });

  it("returns a focused removal action to the survivor beside the gap", async () => {
    const removal = deferred<WorkspaceRemoveResult>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile, thirdFile],
      removeDatasets: () => removal.promise,
    });
    renderApp(api);
    const removed = await screen.findByRole("option", { name: /QC_pool_02\.mzML/ });
    fireEvent.click(removed);
    const survivor = rosterRow(/Blank_03\.mzML/);
    const focusing = vi.spyOn(survivor, "focus");
    const remove = screen.getByRole("button", { name: "Remove selected" });
    remove.focus();
    fireEvent.click(remove);

    await waitFor(() => {
      expect(remove).toBeDisabled();
    });
    // WebView2 blurs the action when the request disables it. jsdom keeps a
    // disabled element focused, so reproduce the production transition.
    blurAsABrowserWould(remove);
    expect(document.body).toHaveFocus();
    removal.resolve({
      roster: { datasets: [selectedFile, thirdFile], capacity: 1_024 },
      removedHandles: [secondFile.handle],
      unknownHandles: [],
    });

    await waitFor(() => {
      expect(survivor).toHaveFocus();
    });
    expect(survivor).toHaveAttribute("tabindex", "0");
    expect(survivor).toHaveAttribute("aria-selected", "true");
    expect(focusing).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("empties the list without a restart and gives the keyboard back to Add files", async () => {
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile] });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));

    expect(await screen.findByText("No files in this session yet")).toBeVisible();
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
    expect(screen.getByText(/Cleared 2 files from the list\./, VISIBLE)).toBeVisible();
    expect(screen.getByText(/The files on disk were not changed\./, VISIBLE)).toBeVisible();
    // Focus lands somewhere it can be used rather than on the body.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add files…" }));
    expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
  });

  it("bounds repeated activation to one read at a time", async () => {
    // Every activation is one process behind one global gate. Without this a
    // user walking the roster with Enter would queue one read per row, and the
    // only one they would ever see is the last.
    const open = deferred<ReturnType<typeof buildPreview>>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile],
      preview: () => open.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));

    fireEvent.click(rosterRow(/QC_pool_02\.mzML/));
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));

    expect(api.openedHandles).toEqual(["file-0"]);

    open.resolve(buildPreview(3));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview focused" })).toBeEnabled();
    });
  });

  it("does not report the backend idle while a removed row's read is still running", async () => {
    // Removing the active row clears the screen at once. The process is still
    // running, and saying otherwise would let a second activation queue behind
    // it -- which is the fan-out the roster makes possible.
    const open = deferred<ReturnType<typeof buildPreview>>();
    const api = createFakePreviewApi({
      pickedFiles: [selectedFile, secondFile],
      preview: () => open.promise,
    });
    await openTheFile(api);
    await screen.findByText("Reading the file…");

    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    await waitFor(() => {
      expect(rosterRows()).toHaveLength(1);
    });

    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();

    open.resolve(buildPreview(3));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview focused" })).toBeEnabled();
    });
    // The reply landed for a row that is gone, so it put nothing back.
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
    expect(api.openedHandles).toEqual(["file-0"]);
  });

  it("keeps the workspace and which row was being read across a backend change", async () => {
    const api = createFakePreviewApi({
      chosenInstallation: chosenBackend,
      pickedFiles: [selectedFile, secondFile],
    });
    await openTheFile(api);
    await screen.findByRole("grid", { name: "Spectra" });
    const readsBefore = api.openCount();

    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));

    await waitFor(() => {
      expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
    });
    // The rows are Rust's paths and the user's choices; no backend decided
    // either, so neither goes.
    expect(rosterRows()).toHaveLength(2);
    // The marker does go, because nothing is on screen for that row any more.
    // Saying "Showing" beside a file whose reading was just discarded is the
    // one thing the hidden half of that affordance must not do.
    expect(rosterRow(/QC_pool_01\.mzML/)).not.toHaveTextContent("▸");
    expect(within(rosterRow(/QC_pool_01\.mzML/)).queryByText("Showing,")).toBeNull();
    // Nothing was re-read on the user's behalf, and reading it again is one
    // action rather than a trip back through the picker.
    expect(api.openCount()).toBe(readsBefore);
    fireEvent.click(screen.getByRole("button", { name: /^Preview QC_pool_01/ }));
    expect(await screen.findByRole("grid", { name: "Spectra" })).toBeVisible();
  });

  it("does not take away a preview that was started while a removal was in flight", async () => {
    // Curating stays live while a removal is unresolved, so the row the viewer
    // belongs to can change between asking and being answered. Deciding from a
    // handle captured beforehand would clear the reading the user has just
    // started and leave its row saying "Reading…" for the rest of the session.
    const removal = deferred<WorkspaceRemoveResult>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile],
      removeDatasets: () => removal.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await screen.findByRole("grid", { name: "Spectra" });

    // The row on screen is removed, and before Rust answers the user reads
    // another one.
    fireEvent.click(rosterRow(/QC_pool_01\.mzML/));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    fireEvent.click(rosterRow(/QC_pool_02\.mzML/));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await waitFor(() => {
      expect(api.openedHandles).toEqual(["file-0", "file-1"]);
    });

    removal.resolve({
      roster: { datasets: [secondFile], capacity: 1_024 },
      removedHandles: [selectedFile.handle],
      unknownHandles: [],
    });

    await waitFor(() => {
      expect(rosterRows()).toHaveLength(1);
    });
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(rosterRow(/QC_pool_02\.mzML/)).toHaveTextContent("▸");
    expect(rosterRow(/QC_pool_02\.mzML/)).not.toHaveTextContent("Reading…");
  });

  it("drops an active preview when a failed mutation reconciles without its row", async () => {
    // A rejected invoke is not proof that Rust left the workspace unchanged: a
    // task or transport can fail after removal took effect. The authoritative
    // read then removes the row, and the viewer must leave with it rather than
    // showing an acquisition the session no longer holds.
    let rosterRead = 0;
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      roster: () => {
        rosterRead += 1;
        return Promise.resolve(
          rosterRead === 1
            ? { datasets: [selectedFile], capacity: 1_024 }
            : { datasets: [], capacity: 1_024 },
        );
      },
      removeDatasets: () =>
        Promise.reject(previewError({ kind: "preview_worker_unavailable" })),
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    expect(await screen.findByRole("grid", { name: "Spectra" })).toBeVisible();

    const remove = screen.getByRole("button", { name: "Remove selected" });
    remove.focus();
    fireEvent.click(remove);
    // WebView2 blurs a button when the request disables it. jsdom keeps a
    // disabled element focused, so model the production focusout explicitly.
    blurAsABrowserWould(remove);
    expect(document.body).toHaveFocus();

    await waitFor(() => {
      expect(api.rosterReads()).toBe(2);
      expect(rosterRows()).toHaveLength(0);
    });
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();
    expect(screen.getByText("No files in this session yet")).toBeVisible();
    expect(api.openCount()).toBe(1);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toHaveFocus();
    });
  });

  it("says no row is being shown when nothing was read", async () => {
    // Adding into an empty session used to mark the first row as the one being
    // shown whether or not a read started. With no usable backend none does,
    // and a row that announces "Showing" beside a file nothing has opened tells
    // a screen-reader user something that is not true.
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      pickedFiles: [selectedFile, secondFile],
    });
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));

    const row = await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });
    expect(api.openCount()).toBe(0);
    expect(row).not.toHaveTextContent("▸");
    expect(within(row).queryByText("Showing,")).toBeNull();
  });

  it("announces what a workspace action did through a region that already existed", async () => {
    // A live region inserted together with its text is the shape screen readers
    // routinely miss, and with a preview loaded the viewer's own sentence does
    // not change when rows are added or removed — so without this the user
    // would hear nothing at all.
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile] });
    renderApp(api);
    const regions = () => [...document.querySelectorAll("[aria-live='polite']")];
    await screen.findByRole("button", { name: "Add files…" });
    // Four, all mounted for the life of the application: what the viewer is
    // doing, what the search found, what the last workspace action did, and
    // whether a folder scan is running.
    expect(regions()).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));

    await waitFor(() => {
      expect(regions().map((region) => region.textContent).join(" ")).toContain(
        "Workspace: Added 2 files.",
      );
    });
    // The same four regions, with new text in one of them.
    expect(regions()).toHaveLength(4);
  });

  it("does not claim the session is empty before its list has been read", async () => {
    const roster = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({ roster: () => roster.promise });
    renderApp(api);

    expect(await screen.findByText("Reading the workspace list…")).toBeVisible();
    expect(screen.queryByText("No files in this session yet")).toBeNull();

    roster.resolve({ datasets: [selectedFile], capacity: 1_024 });

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
  });

  it("lists two names for one acquisition as two lines, and warns about neither", async () => {
    // Rust reports one outcome per file the user chose, and two names for one
    // file produce the same sentence. Keying the list on that sentence gives
    // React two children with one key, which it complains about — and this
    // application's rendered check requires a console with nothing new in it.
    const complaints: unknown[][] = [];
    const reportError = vi.spyOn(console, "error").mockImplementation((...args) => {
      complaints.push(args);
    });
    try {
      const api = createFakePreviewApi({
        initialDatasets: [selectedFile],
        pickedFiles: [selectedFile, selectedFile],
      });
      renderApp(api);
      fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));

      await waitFor(() => {
        expect(
          screen.getAllByText("QC_pool_01.mzML is already in the workspace.", VISIBLE),
        ).toHaveLength(2);
      });
      expect(complaints.map((args) => args.map(String).join(" ")).join(" | ")).not.toContain(
        "same key",
      );
    } finally {
      reportError.mockRestore();
    }
  });

  it("starts no second workspace change while one is unresolved", async () => {
    // Two in flight together let the older reply's roster snapshot overwrite
    // the newer one's: a clear answered after an add would drop a row Rust
    // still holds and take away a preview started for it. Rust serialises the
    // two behind one gate anyway, so waiting costs a moment and no more.
    const clearing = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      clearWorkspace: () => clearing.promise,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();

    clearing.resolve({ datasets: [], capacity: 1_024 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
    });
  });

  it("announces a workspace action that repeats the one before it", async () => {
    // Two removals of one row say the same sentence, and React writes nothing
    // into a region whose string is unchanged — so the second action would be
    // announced nowhere, which is the case that region exists for.
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile, thirdFile],
    });
    renderApp(api);
    // The account's own region, not the viewer's: the viewer's sentence names
    // a count that falls with each removal, so comparing both together would
    // pass whether or not this region changed at all.
    const spoken = () =>
      document.querySelector("[data-live-region='workspace']")?.textContent ?? "";

    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    await waitFor(() => {
      expect(rosterRows()).toHaveLength(2);
    });
    const afterFirst = spoken();
    expect(afterFirst).toContain("Removed 1 file from the list.");

    fireEvent.click(rosterRow(/QC_pool_02\.mzML/));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    await waitFor(() => {
      expect(rosterRows()).toHaveLength(1);
    });

    // The same words, and still a change for a screen reader to notice.
    expect(spoken()).toContain("Removed 1 file from the list.");
    expect(spoken()).not.toBe(afterFirst);

    // How it differs is the whole of the repair. The region must hold one text
    // node whose own string changed: two nodes would leave the sentence node
    // untouched and make the difference an added or removed sibling instead,
    // which is not what the default `aria-relevant` announces in one direction.
    const region = document.querySelector("[data-live-region='workspace']");
    expect(region?.childNodes).toHaveLength(1);
    expect(region?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    // And it must differ by a character CSS keeps. A trailing ordinary space is
    // collapsed out of the rendered text a screen reader is given, so two
    // strings differing only by one would be the same to everyone this region
    // is for. The sentences are otherwise identical, which is the case under
    // test: exactly one of the two carries the non-breaking space.
    const trailing = (said: string) => said.slice(said.replace(/\u00a0+$/u, "").length);
    expect(afterFirst.trimEnd()).toBe(spoken().trimEnd());
    expect([trailing(afterFirst), trailing(spoken())].sort().join("|")).toBe("|\u00a0");
  });

  it("says the unlisted items are unlisted", async () => {
    const api = createFakePreviewApi({
      pickedFiles: [
        selectedFile,
        { rejected: "a.mzXML" },
        { rejected: "b.mzXML" },
        { rejected: "c.mzXML" },
        { rejected: "d.mzXML" },
        { rejected: "e.mzXML" },
      ],
    });
    await openTheFile(api);

    await screen.findByText("2 more not listed here.", VISIBLE);
    const spoken = [...document.querySelectorAll("[aria-live='polite']")]
      .map((region) => region.textContent)
      .join(" ");
    // The count belongs to the visible list, which is the half that stopped
    // short. The spoken half enumerates nothing at all, so it has no cutoff to
    // report and must claim neither that the rest are listed nor that a
    // particular number of them are not.
    expect(spoken).not.toContain("more are not listed");
    expect(spoken).not.toContain("listed on screen");
    // What it does carry is the totals, which is the account that survives
    // without any list beside it.
    expect(spoken).toContain("Added 1 file.");
    expect(spoken).toContain("5 files could not be added.");
  });

  it("refuses a removal and a clear while an add is unresolved", async () => {
    // `addFiles` refuses to start while a mutation is in flight; this is the
    // same gate from the other side. An add holds the picker *and* the
    // registration after it, and a removal answering inside that window carries
    // a roster snapshot taken before the added rows existed -- while `Clear
    // list` would additionally announce a count from before them.
    const picking = deferred<readonly PickedFile[] | null>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      pickedFiles: () => picking.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));

    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();

    picking.resolve(null);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Clear list" })).toBeEnabled();
  });

  it("reads nothing on its own when a slow first read hid a session that was not empty", async () => {
    // Rust keeps the workspace across a reload of this window, and `Add files…`
    // does not wait for the list to arrive. Deciding from what is on screen
    // would call a restored session empty and read a file into it that nobody
    // asked for -- the one automatic read this workspace allows, spent in the
    // one place it is not meant for.
    const reading = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      pickedFiles: [secondFile],
      roster: () => reading.promise,
    });
    renderApp(api);
    // Deliberately not waiting for the roster: this is the window under test.
    fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));

    expect(await screen.findByRole("option", { name: /QC_pool_02\.mzML/ })).toBeVisible();
    // Both rows are there, because Rust answered with everything it holds.
    expect(screen.getByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    expect(api.openCount()).toBe(0);
    expect(screen.queryByRole("grid", { name: "Spectra" })).toBeNull();

    reading.resolve({ datasets: [selectedFile], capacity: 1_024 });
  });

  it("searches and sorts without asking Rust anything at all", async () => {
    // The whole architectural claim of this slice: a projection over what has
    // already crossed the boundary costs no command, no process and no trip.
    const api = createFakePreviewApi({
      pickedFiles: [selectedFile, secondFile, thirdFile],
      availability: unavailableBackend,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));
    await screen.findByRole("option", { name: /Blank_03\.mzML/ });
    const before = api.calls();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-desc" },
    });
    fireEvent.click(rosterRows()[0] as HTMLElement);
    fireEvent.keyDown(rosterRows()[0] as HTMLElement, { key: "a", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(api.calls()).toEqual(before);
    expect(api.openCount()).toBe(0);
    expect(api.rosterReads()).toBe(1);
  });

  it("keeps the preview, the query and the sort while the view changes", async () => {
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile, thirdFile] });
    renderApp(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));
    // The first addition into an empty session reads exactly one file.
    await screen.findByRole("grid", { name: "Spectra" });
    const reads = api.openCount();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "Blank_03" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "size-asc" },
    });

    // Still on screen, still the same reading, and nothing re-read to keep it.
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(api.openCount()).toBe(reads);
    // And the row it belongs to is still on screen, saying why.
    expect(
      screen.getByRole("option", { name: /QC_pool_01\.mzML/ }),
    ).toHaveAccessibleName(/Showing — outside search/);
  });

  it("keeps the query and the sort across adding, and across removing what it matched", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile],
      pickedFiles: [thirdFile],
      availability: unavailableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC_pool_01" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-desc" },
    });
    expect(rosterRows()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));

    // The arrival does not match, and is on screen because it was selected.
    const arrival = await screen.findByRole("option", { name: /Blank_03\.mzML/ });
    expect(arrival).toHaveAccessibleName(/Selected — outside search/);
    expect(screen.getByRole("searchbox", { name: "Search files" })).toHaveValue("QC_pool_01");
    expect(screen.getByRole("combobox", { name: "Sort files" })).toHaveValue("name-desc");

    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    await waitFor(() => {
      expect(screen.queryByRole("option", { name: /Blank_03\.mzML/ })).toBeNull();
    });
    // The hidden row nobody selected is untouched, and the view is unchanged.
    expect(screen.getByRole("searchbox", { name: "Search files" })).toHaveValue("QC_pool_01");
    expect(api.datasets().map((entry) => entry.fileName)).toEqual([
      "QC_pool_01.mzML",
      "QC_pool_02.mzML",
    ]);
  });

  it("clears the whole session rather than the search result, and forgets the view", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile, thirdFile],
      availability: unavailableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC_pool_01" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "size-asc" },
    });
    expect(rosterRows()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));

    // Every file, not the one the search was showing.
    expect(await screen.findByText("No files in this session yet")).toBeVisible();
    expect(api.datasets()).toEqual([]);
    expect(screen.queryByRole("searchbox", { name: "Search files" })).toBeNull();
    expect(screen.getByText(/Cleared 3 files from the list/, VISIBLE)).toBeVisible();
  });

  it("says how many files matched, in a region that was mounted all along", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile, thirdFile],
      availability: unavailableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });
    const regions = () => [...document.querySelectorAll("[aria-live='polite']")];
    expect(regions()).toHaveLength(4);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC" },
    });

    const spoken = regions()
      .map((region) => region.textContent)
      .join(" ");
    expect(spoken).toContain("2 matches of 3 files.");
    // A search that found nothing is not an empty workspace, and the two must
    // not sound alike.
    expect(spoken).not.toContain("The workspace is empty.");
    expect(regions()).toHaveLength(4);
  });

  it("says the search was cleared rather than falling silent", async () => {
    // A live region whose text is removed announces nothing — the default
    // `aria-relevant` is `additions text` — so clearing a search would be the
    // one step of a search nobody was told about.
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile, thirdFile],
      availability: unavailableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });
    const spoken = () =>
      [...document.querySelectorAll("[aria-live='polite']")]
        .map((region) => region.textContent)
        .join(" ");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC" },
    });
    expect(spoken()).toContain("2 matches of 3 files.");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(rosterRows()).toHaveLength(3);
    expect(spoken()).toContain("All 3 files listed.");
    expect(spoken()).not.toContain("2 matches of 3 files.");
  });

  // Given its own allowance rather than the suite's default. The assertion is
  // that a session at Rust's capacity renders, matches and orders correctly --
  // not that it does so within five seconds of a shared, loaded machine. Left
  // on the default this passes or fails by how busy the runner is, which is a
  // flake dressed up as a scale test.
  it("renders a roster at capacity through a search and a sort", { timeout: 60_000 }, async () => {
    // Not timed and not a benchmark: what it holds is that the size Rust
    // actually allows renders, matches and orders without falling over.
    const many = Array.from({ length: 1_024 }, (_, index) => ({
      handle: `file-${String(index)}`,
      fileName: `${index % 2 === 0 ? "QC" : "blank"}_run-${String(index)}.mzML`,
      byteLength: (index % 7) * 1_000,
      relativeContext: null,
    }));
    const api = createFakePreviewApi({
      initialDatasets: many,
      availability: unavailableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_run-0\.mzML/ });
    expect(rosterRows()).toHaveLength(1_024);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "qc_run" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-asc" },
    });

    expect(rosterRows()).toHaveLength(512);
    // Naturally ordered, which is the whole reason for a numeric collator.
    expect(
      rosterRows()
        .slice(0, 3)
        .map((row) => within(row).getByTitle(/\.mzML$/).textContent),
    ).toEqual(["QC_run-0.mzML", "QC_run-2.mzML", "QC_run-4.mzML"]);
    expect(api.openCount()).toBe(0);
  });

  it("stops saying the list could not be read once an action has read it", async () => {
    // A read that fails on mount is otherwise permanent: nothing but the retry
    // ever moves that state, so the workspace goes on reporting that its list
    // is unknown long after adding files has established what it holds.
    let reads = 0;
    const api = createFakePreviewApi({
      pickedFiles: [selectedFile],
      roster: () => {
        reads += 1;
        return reads === 1
          ? Promise.reject(previewError({ kind: "preview_worker_unavailable" }))
          : Promise.resolve({ datasets: [], capacity: 1_024 });
      },
    });
    renderApp(api);
    expect(await screen.findByText("The workspace list could not be read")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    fireEvent.click(screen.getByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    // Back to an empty workspace, which is now something this side knows
    // rather than something it failed to find out.
    expect(await screen.findByText("No files in this session yet")).toBeVisible();
    expect(screen.queryByText("The workspace list could not be read")).toBeNull();
    const spoken = [...document.querySelectorAll("[aria-live='polite']")]
      .map((region) => region.textContent)
      .join(" ");
    expect(spoken).not.toContain("The workspace list could not be read.");
  });

  it("does not say the workspace is empty when its list could not be read", async () => {
    const api = createFakePreviewApi({
      roster: () => Promise.reject(previewError({ kind: "preview_worker_unavailable" })),
    });
    renderApp(api);

    expect(await screen.findByText("The workspace list could not be read")).toBeVisible();
    const spoken = [...document.querySelectorAll("[aria-live='polite']")]
      .map((region) => region.textContent)
      .join(" ");
    expect(spoken).toContain("The workspace list could not be read.");
    expect(spoken).not.toContain("The workspace is empty.");
  });

  it("marks no row as shown while one is only being read", async () => {
    // The bar and the glyph are one statement in two encodings, so neither may
    // appear without the other. A row being read says so in words.
    const open = deferred<ReturnType<typeof buildPreview>>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      preview: () => open.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));

    const row = await screen.findByRole("option", { name: /Reading…/ });
    expect(row.className).not.toContain("is-active");
    expect(row).not.toHaveTextContent("▸");
    expect(within(row).queryByText("Showing,")).toBeNull();

    open.resolve(buildPreview(3));

    await waitFor(() => {
      expect(rosterRow(/QC_pool_01\.mzML/)).toHaveTextContent("▸");
    });
    expect(rosterRow(/QC_pool_01\.mzML/).className).toContain("is-active");
  });

  it("marks a row whose file was replaced, without removing it", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      preview: () =>
        Promise.reject(previewError({ kind: "file_identity_changed", retryable: false })),
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));

    expect(await screen.findByRole("option", { name: /Replaced/ })).toBeVisible();
    // The row stays. What the name now points at is a question for the next
    // read of it, and removing it is the user's decision.
    expect(rosterRows()).toHaveLength(1);
  });
});

/** The row handles the workspace list currently reports as selected. */
function selectedRowNames(): string[] {
  return rosterRows()
    .filter((row) => row.getAttribute("aria-selected") === "true")
    .map((row) => row.textContent ?? "");
}

function folderAction(): HTMLElement {
  return screen.getByRole("button", { name: /Add mzML folder…|Scanning folder…/ });
}

/** Two acquisitions of one name, which is the case relative context exists for. */
const NESTED_ONE: SelectedFile = {
  handle: "folder-0",
  fileName: "sample.mzML",
  byteLength: 4_000_000,
  relativeContext: null,
};

const NESTED_TWO: SelectedFile = {
  handle: "folder-1",
  fileName: "sample.mzML",
  byteLength: 6_000_000,
  relativeContext: null,
};

const NESTED_UNIQUE: SelectedFile = {
  handle: "folder-2",
  fileName: "unique.mzML",
  byteLength: 1_000_000,
  relativeContext: null,
};

describe("adding a folder of mzML files", () => {
  it("adds everything the scan found and reads only the first, into an empty session", async () => {
    // One folder is one picker operation, and a picker operation costs one
    // read. A folder of a thousand files costing a thousand process launches is
    // the fan-out this milestone exists not to become.
    const api = createFakePreviewApi({
      scannedFolder: {
        files: [
          { file: selectedFile, parents: [] },
          { file: secondFile, parents: ["batch-2"] },
        ],
      },
    });
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /QC_pool_02\.mzML/ })).toBeVisible();
    await waitFor(() => {
      expect(api.openCount()).toBe(1);
    });
    expect(api.openedHandles).toEqual([selectedFile.handle]);
    // One command for the whole import: the picker, the walk and the commit are
    // one call, and nothing is asked per file.
    expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(1);
  });

  it("reads nothing into a session that already holds rows", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [thirdFile],
      scannedFolder: { files: [{ file: selectedFile, parents: [] }] },
    });
    renderApp(api);
    await screen.findByRole("option", { name: /Blank_03\.mzML/ });

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    expect(api.openCount()).toBe(0);
  });

  it("reads nothing when the backend cannot read anything", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: { files: [{ file: selectedFile, parents: [] }] },
    });
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    expect(api.openCount()).toBe(0);
  });

  it("keeps the keyboard row and selection the user made while the scan was running", async () => {
    // The whole reason a folder import is not modal. The list stays live for
    // the length of the walk, so the selection the reply meets is one the user
    // may have built while waiting -- and it is theirs.
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile, secondFile],
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));
    // Chosen while the scan is unresolved, which is exactly what a captured
    // selection would throw away.
    const workingRow = rosterRow(/QC_pool_02\.mzML/);
    fireEvent.click(workingRow);
    workingRow.focus();
    expect(workingRow).toHaveFocus();
    expect(selectedRowNames()).toHaveLength(1);

    scan.resolve({ files: [{ file: thirdFile, parents: ["nested"] }] });

    expect(await screen.findByRole("option", { name: /Blank_03\.mzML/ })).toBeVisible();
    await waitFor(() => {
      expect(selectedRowNames()).toHaveLength(2);
    });
    const selected = selectedRowNames().join(" ");
    expect(selected).toContain("QC_pool_02.mzML");
    expect(selected).toContain("Blank_03.mzML");
    expect(selected).not.toContain("QC_pool_01.mzML");
    // Settlement must not make DatasetRoster follow a reducer-created focus
    // move to the imported row while the keyboard is still inside the list.
    expect(workingRow).toHaveFocus();
    expect(workingRow).toHaveAttribute("tabindex", "0");
    expect(rosterRow(/Blank_03\.mzML/)).toHaveAttribute("tabindex", "-1");
  });

  it("leaves the search, the sort and the preview on screen exactly as they were", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile],
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await screen.findByRole("grid", { name: "Spectra" });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-desc" },
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC" },
    });
    const readsBefore = api.openCount();

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));
    scan.resolve({ files: [{ file: thirdFile, parents: [] }] });

    await waitFor(() => {
      expect(screen.getByText(/Added 1 file\./, VISIBLE)).toBeVisible();
    });
    expect(screen.getByRole("searchbox", { name: "Search files" })).toHaveValue("QC");
    expect(screen.getByRole("combobox", { name: "Sort files" })).toHaveValue("name-desc");
    // The preview belongs to the row it was opened for, and a list operation is
    // not a reason to take it away or to read anything else.
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(api.openCount()).toBe(readsBefore);
  });

  it("refuses more acquisitions while a folder is being scanned, and nothing else", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile],
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    // Acquiring more waits: a second batch in flight would answer with a roster
    // from before this one's rows existed.
    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    // Workspace curation does not wait. `Clear list` is the reliable final-empty
    // escape; `Remove selected` remains available to manage rows already shown,
    // though imported rows can remain if the import committed first. Rust
    // linearises either action rather than this side making it impossible.
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clear list" })).toBeEnabled();
    // And none of the ones that cost nothing. Curating what is on screen is
    // this side's own work, and a filesystem walk is no reason to stop it.
    expect(screen.getByRole("searchbox", { name: "Search files" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Sort files" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeEnabled();
    fireEvent.click(rosterRow(/QC_pool_02\.mzML/));
    expect(selectedRowNames().join(" ")).toContain("QC_pool_02.mzML");

    scan.resolve({ files: [] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
  });

  it("removes rows during an unresolved import, and the late reply cannot put them back", async () => {
    // The import-first linearisation, end to end. Rust has already committed the
    // discovered row when removal takes the gate, so removal's authoritative
    // roster keeps that row and removes only the selected handle. The folder
    // reply can still reach this window last, and must not reinstall its copy of
    // the row the user removed.
    const stale = deferred<FolderIngestionResult | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile, secondFile],
      folderResult: () => stale.promise,
      removeDatasets: (handles) =>
        Promise.resolve({
          roster: { datasets: [secondFile, thirdFile], capacity: 1_024 },
          removedHandles: handles.filter((handle) => handle === selectedFile.handle),
          unknownHandles: handles.filter((handle) => handle !== selectedFile.handle),
        }),
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    await waitFor(() => {
      expect(rosterRows()).toHaveLength(2);
    });
    expect(screen.queryByRole("option", { name: /QC_pool_01\.mzML/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Blank_03\.mzML/ })).toBeVisible();
    expect(screen.getByText(/Removed 1 file from the list\./, VISIBLE)).toBeVisible();

    // The import answers afterwards, carrying the roster it saw -- which is the
    // list from before the removal, plus the row it added. A modelled scan
    // cannot produce that, because it snapshots when it resolves; this is the
    // one case the option exists for.
    stale.resolve({
      roster: { datasets: [selectedFile, secondFile, thirdFile], capacity: 1_024 },
      outcomes: [{ outcome: "added", dataset: thirdFile }],
      discovery: COMPLETE_SCAN,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    // The removed row stays removed, while the discovered row already present
    // in removal's authoritative roster stays present.
    expect(screen.queryByRole("option", { name: /QC_pool_01\.mzML/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Blank_03\.mzML/ })).toBeVisible();
    expect(rosterRows()).toHaveLength(2);
    // The account of what the user actually did survives; the late reply does
    // not overwrite it.
    expect(screen.getByText(/Removed 1 file from the list\./, VISIBLE)).toBeVisible();
    // And nothing is invented about the folder. Reaching here with a result at
    // all means Rust committed the import, so claiming it could not be added
    // would be a failure that did not happen.
    expect(screen.queryByText("The folder could not be added")).toBeNull();
    expect(api.openCount()).toBe(0);
  });

  it("catches the keyboard when the escape action goes out from under it", async () => {
    // `Clear list` exists over an empty list only while an import is
    // unresolved, and during a first import from an empty workspace it is the
    // only enabled control in the row -- so it is exactly where a keyboard user
    // lands. Every way the import can settle with nothing added takes it away
    // again. WebView2 moves focus to the body and can first report a
    // `focusout` whose destination is null. Nothing else here would recover it:
    // the row rescue wants a row handle, and no picker restoration exists
    // because the import was not started by a focused press of the roster's own
    // button.
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    // Started with the pointer, so nothing is owed to the folder button.
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    const escape = screen.getByRole("button", { name: "Clear list" });
    expect(escape).toBeEnabled();
    escape.focus();
    expect(escape).toHaveFocus();

    // Unlike jsdom's node removal, WebView2 reports a production-like
    // `focusout` with no destination before the focused control goes. That is
    // disappearance, not a user choosing somewhere else, so it must not erase
    // the record that catches the keyboard.
    blurAsABrowserWould(escape);
    expect(document.body).toHaveFocus();

    // The folder simply held no mzML, so nothing is added and the escape goes.
    scan.resolve({ files: [] });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
      expect(screen.getByRole("button", { name: "Add files…" })).toHaveFocus();
    });
    expect(document.body).not.toHaveFocus();
  });

  it("does not steal focus when the user leaves a disappearing escape action", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    const escape = screen.getByRole("button", { name: "Clear list" });
    const destination = screen.getByRole("button", { name: "Check again" });
    escape.focus();
    destination.focus();
    expect(destination).toHaveFocus();

    scan.resolve({ files: [] });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
    });
    expect(destination).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add files…" })).not.toHaveFocus();
  });

  it("does not revive an old Clear list focus record after a real destination", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    const escape = screen.getByRole("button", { name: "Clear list" });
    const destination = screen.getByRole("button", { name: "Check again" });
    escape.focus();
    destination.focus();
    expect(destination).toHaveFocus();

    // The destination later losing focus is unrelated to `Clear list`. If the
    // real destination above did not clear the old record, settlement would
    // mistake this body focus for an orphaned Clear action and steal it.
    blurAsABrowserWould(destination);
    expect(document.body).toHaveFocus();
    scan.resolve({ files: [] });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
    });
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add files…" })).not.toHaveFocus();
  });

  it("empties the list during an unresolved import, and the late reply cannot refill it", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile, secondFile],
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));

    expect(await screen.findByText("No files in this session yet")).toBeVisible();
    expect(screen.getByText(/Cleared 2 files from the list/, VISIBLE)).toBeVisible();
    // The keyboard is owed to `Add files…`, which is still disabled because the
    // import has not settled. Focusing a disabled control does nothing, so the
    // debt is held rather than paid into nowhere.
    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add files…" })).not.toHaveFocus();

    scan.resolve({ files: [{ file: thirdFile, parents: [] }] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    expect(rosterRows()).toHaveLength(0);
    expect(screen.getByText("No files in this session yet")).toBeVisible();
    expect(api.openCount()).toBe(0);
    // And paid on the commit that makes the control usable, rather than leaving
    // a keyboard user on the body with no way back into the workspace.
    expect(screen.getByRole("button", { name: "Add files…" })).toHaveFocus();
  });

  it("keeps an empty workspace empty when Clear list supersedes its first import", async () => {
    const stale = deferred<FolderIngestionResult | null>();
    const clearing = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      folderResult: () => stale.promise,
      clearWorkspace: () => clearing.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    const clear = screen.getByRole("button", { name: "Clear list" });
    expect(clear).toBeEnabled();
    expect(clear).toHaveAccessibleDescription(
      "Clear list also prevents the pending folder import from adding files.",
    );
    clear.focus();
    fireEvent.click(clear);
    expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(1);

    clearing.resolve({ datasets: [], capacity: 1_024 });
    expect(
      await screen.findByText(
        "The workspace is empty. The pending folder import will not add files.",
        VISIBLE,
      ),
    ).toBeVisible();
    expect(screen.getByText("No files in this session yet")).toBeVisible();
    expect(screen.getByText("Folder import in progress…", VISIBLE)).toBeVisible();

    stale.reject(
      previewError({
        kind: "import_superseded",
        summary:
          "The workspace changed while MSCanvas was scanning that folder, so none of its files were added. Scan the folder again.",
        retryable: true,
      }),
    );
    await waitFor(() => {
      expect(screen.queryByText("Folder import in progress…")).toBeNull();
    });
    expect(rosterRows()).toHaveLength(0);
    expect(screen.getByText("No files in this session yet")).toBeVisible();
    expect(
      screen.getByText(
        "The workspace is empty. The pending folder import will not add files.",
        VISIBLE,
      ),
    ).toBeVisible();
    expect(screen.queryByText("The folder could not be added")).toBeNull();
    expect(screen.queryByText(/workspace changed while MSCanvas was scanning/)).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Add files…" })).toHaveFocus();
  });

  it("keeps a real folder failure visible when Clear list overlaps the scan", async () => {
    const scan = deferred<FolderIngestionResult | null>();
    const clearing = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      folderResult: () => scan.promise,
      clearWorkspace: () => clearing.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
    clearing.resolve({ datasets: [], capacity: 1_024 });
    expect(
      await screen.findByText(
        "The workspace is empty. The pending folder import will not add files.",
        VISIBLE,
      ),
    ).toBeVisible();

    scan.reject(
      previewError({
        kind: "folder_scan_failed",
        summary: "That folder could not be scanned safely.",
        retryable: true,
      }),
    );

    expect(await screen.findByText("The folder could not be added")).toBeVisible();
    expect(screen.getByText("That folder could not be scanned safely.")).toBeVisible();
    expect(rosterRows()).toHaveLength(0);
    expect(screen.queryByText(/workspace changed while MSCanvas was scanning/)).toBeNull();
  });

  it("keeps a committed first import hidden while Clear list is still pending", async () => {
    // Rust may commit the import before Clear reaches its gate while the two
    // replies arrive in the opposite order. The click is already the newer
    // user intent: exposing the folder roster while Clear is unresolved would
    // make a row reappear after the escape, and an empty workspace would also
    // start an implicit preview for a row Clear is about to remove.
    const imported = deferred<FolderIngestionResult | null>();
    const clearing = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      folderResult: () => imported.promise,
      clearWorkspace: () => clearing.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));

    imported.resolve({
      roster: { datasets: [thirdFile], capacity: 1_024 },
      outcomes: [{ outcome: "added", dataset: thirdFile }],
      discovery: COMPLETE_SCAN,
    });
    await waitFor(() => {
      expect(screen.queryByText("Folder import in progress…")).toBeNull();
    });

    // Clear has not answered. The folder result must remain unobservable for
    // that entire window, including at the process boundary.
    expect(rosterRows()).toHaveLength(0);
    expect(screen.queryByRole("option", { name: /Blank_03\.mzML/ })).toBeNull();
    expect(screen.getByText("No files in this session yet")).toBeVisible();
    expect(api.openCount()).toBe(0);

    clearing.resolve({ datasets: [], capacity: 1_024 });
    expect(
      await screen.findByText(
        "The workspace is empty. The pending folder import will not add files.",
        VISIBLE,
      ),
    ).toBeVisible();
    expect(rosterRows()).toHaveLength(0);
    expect(api.openCount()).toBe(0);
  });

  it("waits for this window to know what the session holds before it will import", async () => {
    // A roster read is itself a statement about the workspace in Rust, so an
    // import started before the mount-time read answers would create a race: if
    // the read reaches the gate first it makes that import fail with
    // `import_superseded` while the user changed nothing, while an import that
    // reaches it first changes what the read returns. The operation waits rather
    // than creating either ordering by itself.
    const initial = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      roster: () => initial.promise,
      scannedFolder: { files: [{ file: selectedFile, parents: [] }] },
    });
    renderApp(api);

    const folder = await screen.findByRole("button", { name: "Add mzML folder…" });
    expect(folder).toBeDisabled();
    // Pressed anyway -- a disabled button is a rendering, and the guard that
    // matters is the one inside the operation.
    fireEvent.click(folder);
    expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(0);

    initial.resolve({ datasets: [], capacity: 1_024 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));
    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
  });

  it("stays unavailable after a failed roster read, until the retry succeeds", async () => {
    // A failed read is the same answer as an unfinished one: this window has no
    // authoritative list, and importing into a workspace it could not read is
    // not something to start on a guess. The roster's own retry is the way out.
    let attempts = 0;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      roster: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(previewError({ kind: "preview_worker_unavailable" }))
          : Promise.resolve<WorkspaceRoster>({ datasets: [], capacity: 1_024 });
      },
      scannedFolder: { files: [{ file: selectedFile, parents: [] }] },
    });
    renderApp(api);

    await screen.findByText("The workspace list could not be read");
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Try reading it again" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));
    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
  });


  it("does not let a folder scan take the viewer away", async () => {
    // A scan launches no process, so nothing about it is a reason to disable
    // reading a file that is already in the session.
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));

    expect(await screen.findByRole("grid", { name: "Spectra" })).toBeVisible();
    scan.resolve({ files: [] });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
  });

  it("changes nothing when the folder picker is dismissed", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      scannedFolder: null,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    expect(rosterRows()).toHaveLength(1);
    // A dismissed picker is not a folder that held nothing, and it is not a
    // failure either: nothing was chosen, so there is nothing to report.
    expect(screen.queryByText(/No mzML files were found/)).toBeNull();
    expect(screen.queryByText("The folder could not be added")).toBeNull();
    expect(api.openCount()).toBe(0);
  });

  it("leaves the workspace and the preview alone when the folder could not be scanned", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      scannedFolder: () =>
        Promise.reject(
          previewError({
            kind: "folder_link_unsupported",
            summary:
              "That is a shortcut or link to a folder rather than a folder. MSCanvas does not follow links when scanning, so choose the folder it points at.",
            retryable: false,
          }),
        ),
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await screen.findByRole("grid", { name: "Spectra" });

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    expect(await screen.findByText("The folder could not be added")).toBeVisible();
    expect(screen.getByText(/MSCanvas does not follow links when scanning/)).toBeVisible();
    expect(rosterRows()).toHaveLength(1);
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    // Its own channel: nothing about the workspace was changed, so saying the
    // workspace could not be changed would describe a mutation that never began.
    expect(screen.queryByText("The workspace could not be changed")).toBeNull();
  });

  it("says plainly that a superseded import added nothing", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      scannedFolder: () =>
        Promise.reject(
          previewError({
            kind: "import_superseded",
            summary:
              "The workspace changed while MSCanvas was scanning that folder, so none of its files were added. Scan the folder again.",
            retryable: true,
          }),
        ),
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    expect(await screen.findByText(/none of its files were added/)).toBeVisible();
    expect(rosterRows()).toHaveLength(1);
  });

  it("changes nothing when a reply arrives after the window has gone", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({ scannedFolder: () => scan.promise });
    renderApp(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    cleanup();
    scan.resolve({ files: [{ file: selectedFile, parents: [] }] });
    await scan.promise;

    // Nothing to update and nothing that tried to: no read was started, and no
    // state was written into a component that is no longer mounted.
    expect(api.openCount()).toBe(0);
    expect(document.body).toBeEmptyDOMElement();
  });

  it("asks Rust whether the session was empty, not the list on screen", async () => {
    // A webview can be reloaded while Rust still holds rows, and a read that
    // answered before those rows existed leaves the roster on screen empty
    // while the session is not. Reading a file into a workspace that already
    // had several, with nobody having asked for it, is what the authoritative
    // answer prevents.
    const api = createFakePreviewApi({
      initialDatasets: [thirdFile],
      // Settled, so the import may start -- and empty, so the list on screen
      // disagrees with what Rust holds.
      roster: () => Promise.resolve<WorkspaceRoster>({ datasets: [], capacity: 1_024 }),
      scannedFolder: { files: [{ file: selectedFile, parents: [] }] },
    });
    renderApp(api);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    expect(rosterRows()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    expect(await screen.findByRole("option", { name: /QC_pool_01\.mzML/ })).toBeVisible();
    // Two rows in the reply and one of them added, so the session was not
    // empty -- however empty this window happened to look.
    expect(rosterRows()).toHaveLength(2);
    expect(api.openCount()).toBe(0);
  });

  it("accounts for a folder through the region that already existed", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: {
        files: [
          { file: selectedFile, parents: [] },
          { file: secondFile, parents: ["batch-2"] },
        ],
      },
    });
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    expect(await screen.findByText("Added 2 files.", VISIBLE)).toBeVisible();
    await waitFor(() => {
      expect(document.querySelector("[data-live-region='workspace']")?.textContent).toContain(
        "Workspace: Added 2 files.",
      );
    });
  });

  it("says a scan was incomplete rather than saying the folder was empty", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: {
        files: [],
        discovery: { complete: false, skippedReparseCount: 2, limitsReached: ["depth"] },
      },
    });
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    expect(
      await screen.findByText(/No files were added, and the scan was incomplete\./, VISIBLE),
    ).toBeVisible();
    expect(screen.queryByText(/No mzML files were found/)).toBeNull();
    expect(
      screen.getByText(/skipped 2 linked or special filesystem entries/, VISIBLE),
    ).toBeVisible();
    expect(
      screen.getByText(/nested deeper than MSCanvas walks in one scan/, VISIBLE),
    ).toBeVisible();
  });

  it("says a complete folder held no mzML, and does not call it a failure", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: { files: [] },
    });
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));

    expect(
      await screen.findByText("No mzML files were found in that folder.", VISIBLE),
    ).toBeVisible();
    expect(screen.queryByText("The folder could not be added")).toBeNull();
    expect(screen.queryByText(/scan was incomplete/)).toBeNull();
  });

  it("announces two folders that did the same thing as two events", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: { files: [] },
    });
    renderApp(api);
    const spoken = () =>
      document.querySelector("[data-live-region='workspace']")?.textContent ?? "";

    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));
    await waitFor(() => {
      expect(spoken()).toContain("No mzML files were found in that folder.");
    });
    const afterFirst = spoken();

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    await waitFor(() => {
      expect(spoken()).not.toBe(afterFirst);
    });
    expect(spoken()).toContain("No mzML files were found in that folder.");
  });
});

describe("telling two identically named acquisitions apart", () => {
  // The accessible name is the row's text run together, and the computation
  // trims each node -- so what separates the name from its context is the comma
  // rather than the space beside it.
  const COLLIDING_ONE = /sample\.mzML,\s*batch-1/;
  const COLLIDING_TWO = /sample\.mzML,\s*batch-2/;

  function collidingApi(): ReturnType<typeof createFakePreviewApi> {
    return createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: {
        files: [
          { file: NESTED_UNIQUE, parents: [] },
          // Deliberately in the opposite order to the contexts they produce.
          // With `batch-1` first, a sort that quietly folded the context into
          // its key would produce the order the session already holds, and the
          // test would pass either way.
          { file: NESTED_ONE, parents: ["batch-2"] },
          { file: NESTED_TWO, parents: ["batch-1"] },
        ],
      },
    });
  }

  async function importTheFolder(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: "Add mzML folder…" }));
    await screen.findByRole("option", { name: /unique\.mzML/ });
  }

  it("says where each of two same-named rows came from, and nothing beside a unique name", async () => {
    renderApp(collidingApi());

    await importTheFolder();

    // Visible, in the row, and in the option's accessible name -- a screen
    // reader is told exactly what the screen says. The comma is part of the
    // row's text rather than only a gap in the layout, so the two are not read
    // as one word.
    expect(screen.getByRole("option", { name: COLLIDING_ONE })).toBeVisible();
    expect(screen.getByRole("option", { name: COLLIDING_TWO })).toBeVisible();
    const unique = screen.getByRole("option", { name: /unique\.mzML/ });
    // A unique name needs no help, and a folder fragment beside one would be a
    // location on screen for nothing.
    expect(unique.textContent).not.toContain("Top level");
    // The filename is still the primary label, said once.
    const first = screen.getByRole("option", { name: COLLIDING_ONE });
    expect(within(first).getAllByText("sample.mzML")).toHaveLength(1);
  });

  it("shows nothing path-shaped", async () => {
    renderApp(collidingApi());

    await importTheFolder();

    const list = screen.getByRole("listbox", { name: "Workspace" });
    const rendered = list.textContent ?? "";
    expect(rendered).not.toContain(":\\");
    expect(rendered).not.toContain("..");
    expect(rendered).not.toMatch(/^[A-Z]:/);
  });

  it("does not let the context decide what a search finds", async () => {
    renderApp(collidingApi());
    await importTheFolder();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "batch-1" },
    });

    // A search is over the visible name. Matching a location would make a query
    // find rows whose filename says nothing of the sort, which is a search over
    // a path by another route.
    //
    // Asked of the match count rather than of the rows: an import selects
    // everything it added, and a selected row stays on screen whether or not
    // the query found it -- saying so, which is what makes the distinction
    // visible rather than a trick of the assertion.
    expect(screen.getByText(/0 matches of 3 files/, VISIBLE)).toBeVisible();
    for (const row of rosterRows()) {
      expect(row.textContent).toContain("Selected — outside search");
    }
    // And the filename is still what a query does find.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "sample" },
    });
    expect(screen.getByText(/2 matches of 3 files/, VISIBLE)).toBeVisible();
  });

  it("does not let the context decide the name order", async () => {
    renderApp(collidingApi());
    await importTheFolder();

    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-asc" },
    });

    // `sample.mzML` twice, then `unique.mzML`: the two collide by name and stay
    // in the order the session holds them, because the context is not a key.
    // The session holds `batch-2` first, so a sort that used the context would
    // put `batch-1` above it -- which is the difference this asserts.
    expect(rosterRows().map((row) => row.textContent?.slice(0, 40))).toEqual([
      expect.stringContaining("sample.mzML"),
      expect.stringContaining("sample.mzML"),
      expect.stringContaining("unique.mzML"),
    ]);
    expect(rosterRows()[0]?.textContent).toContain("batch-2");
    expect(rosterRows()[1]?.textContent).toContain("batch-1");
  });

  it("takes the context away when the row that made it necessary goes", async () => {
    renderApp(collidingApi());
    await importTheFolder();
    expect(screen.getByRole("option", { name: COLLIDING_ONE })).toBeVisible();

    fireEvent.click(screen.getByRole("option", { name: COLLIDING_TWO }));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    await waitFor(() => {
      expect(rosterRows()).toHaveLength(2);
    });
    // Rust decides it over the whole live roster every time one is built, so a
    // survivor with a unique name stops saying anything at all.
    expect(screen.queryByText("batch-1")).toBeNull();
    expect(screen.getByRole("option", { name: /sample\.mzML/ })).toBeVisible();
  });
});

describe("giving the keyboard back after an acquisition picker", () => {
  it("returns it to Add mzML folder… once the scan settles", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    const folder = await screen.findByRole("button", { name: "Add mzML folder…" });
    folder.focus();

    fireEvent.click(folder);
    // The name does not move while the operation runs, which is the point of
    // it: this is the same control, found the same way.
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    // Disabling the focused control is what blurs it, and the browser does not
    // put focus back when it is enabled again. jsdom does neither, so the blur
    // is done here rather than assumed -- without it the test would pass with
    // the restoration deleted.
    blurAsABrowserWould(folder);
    expect(document.body).toHaveFocus();
    scan.resolve({ files: [] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toHaveFocus();
    });
  });

  it("returns it to Add mzML folder… when the picker was dismissed", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: null,
    });
    renderApp(api);
    const folder = await screen.findByRole("button", { name: "Add mzML folder…" });
    folder.focus();

    fireEvent.click(folder);
    blurAsABrowserWould(folder);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toHaveFocus();
    });
  });

  it("returns a focused folder retry to the durable folder action after dismissal", async () => {
    const retry = deferred<FolderScan | null>();
    let requests = 0;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => {
        requests += 1;
        return requests === 1
          ? Promise.reject(
              previewError({
                kind: "folder_scan_failed",
                summary: "That folder could not be scanned safely.",
                retryable: true,
              }),
            )
          : retry.promise;
      },
    });
    renderApp(api);
    const durable = await screen.findByRole("button", { name: "Add mzML folder…" });

    // The first attempt creates the transient shell recovery action. It starts
    // with the pointer, so no restoration from the durable action is pending.
    fireEvent.click(durable);
    const retryButton = await screen.findByRole("button", { name: "Choose another folder" });
    retryButton.focus();
    expect(retryButton).toHaveFocus();
    const focusing = vi.spyOn(durable, "focus");

    fireEvent.click(retryButton);
    // Starting the retry clears its error and removes the focused button. A real
    // browser leaves focus on the body; jsdom needs that behaviour reproduced.
    blurAsABrowserWould(retryButton);
    expect(screen.queryByRole("button", { name: "Choose another folder" })).toBeNull();
    expect(durable).toBeDisabled();
    expect(document.body).toHaveFocus();
    expect(focusing).not.toHaveBeenCalled();

    retry.resolve(null);

    await waitFor(() => {
      expect(durable).toHaveFocus();
    });
    expect(durable).toBeEnabled();
    expect(focusing).toHaveBeenCalledWith({ preventScroll: true });
    expect(requests).toBe(2);
  });

  it("returns a focused folder-error dismissal to the durable folder action", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () =>
        Promise.reject(
          previewError({
            kind: "folder_scan_failed",
            summary: "That folder could not be scanned safely.",
            retryable: true,
          }),
        ),
    });
    renderApp(api);
    const durable = await screen.findByRole("button", { name: "Add mzML folder…" });

    fireEvent.click(durable);
    const noticeHeading = await screen.findByText("The folder could not be added");
    const notice = noticeHeading.closest<HTMLElement>('[role="status"]');
    expect(notice).not.toBeNull();
    const dismiss = within(notice as HTMLElement).getByRole("button", { name: "Dismiss" });
    dismiss.focus();
    expect(dismiss).toHaveFocus();
    const focusing = vi.spyOn(durable, "focus");

    fireEvent.click(dismiss);

    await waitFor(() => {
      expect(durable).toHaveFocus();
    });
    expect(focusing).toHaveBeenCalledWith({ preventScroll: true });
    expect(screen.getByRole("button", { name: "Add files…" })).not.toHaveFocus();
    expect(screen.queryByText("The folder could not be added")).toBeNull();
    expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(1);
  });

  it("takes no focus when folder-error Dismiss did not own the keyboard", async () => {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () =>
        Promise.reject(
          previewError({
            kind: "folder_scan_failed",
            summary: "That folder could not be scanned safely.",
            retryable: true,
          }),
        ),
    });
    renderApp(api);
    const durable = await screen.findByRole("button", { name: "Add mzML folder…" });
    fireEvent.click(durable);
    const noticeHeading = await screen.findByText("The folder could not be added");
    const notice = noticeHeading.closest<HTMLElement>('[role="status"]');
    expect(notice).not.toBeNull();
    const dismiss = within(notice as HTMLElement).getByRole("button", { name: "Dismiss" });
    const focusing = vi.spyOn(durable, "focus");

    // `fireEvent.click` without first focusing the target models a press that
    // never owned the keyboard. Dismissing its notice must not invent a debt.
    expect(document.body).toHaveFocus();
    fireEvent.click(dismiss);

    expect(document.body).toHaveFocus();
    expect(focusing).not.toHaveBeenCalled();
    expect(screen.queryByText("The folder could not be added")).toBeNull();
  });

  it("takes no focus when the transient folder retry did not own the keyboard", async () => {
    const retry = deferred<FolderScan | null>();
    let requests = 0;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => {
        requests += 1;
        return requests === 1
          ? Promise.reject(
              previewError({
                kind: "folder_scan_failed",
                summary: "That folder could not be scanned safely.",
                retryable: true,
              }),
            )
          : retry.promise;
      },
    });
    renderApp(api);
    const durable = await screen.findByRole("button", { name: "Add mzML folder…" });
    fireEvent.click(durable);
    const retryButton = await screen.findByRole("button", { name: "Choose another folder" });
    const focusing = vi.spyOn(durable, "focus");

    // `fireEvent.click` does not focus a button first, which models an
    // activation that never owned the keyboard and therefore has no debt.
    expect(document.body).toHaveFocus();
    fireEvent.click(retryButton);
    retry.resolve(null);

    await waitFor(() => {
      expect(durable).toBeEnabled();
    });
    expect(document.body).toHaveFocus();
    expect(focusing).not.toHaveBeenCalled();
    expect(requests).toBe(2);
  });

  it("does not steal a focused folder retry debt from a later destination", async () => {
    const retry = deferred<FolderScan | null>();
    let requests = 0;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile],
      scannedFolder: () => {
        requests += 1;
        return requests === 1
          ? Promise.reject(
              previewError({
                kind: "folder_scan_failed",
                summary: "That folder could not be scanned safely.",
                retryable: true,
              }),
            )
          : retry.promise;
      },
    });
    renderApp(api);
    const durable = await screen.findByRole("button", { name: "Add mzML folder…" });
    fireEvent.click(durable);
    const retryButton = await screen.findByRole("button", { name: "Choose another folder" });
    retryButton.focus();
    const focusing = vi.spyOn(durable, "focus");

    fireEvent.click(retryButton);
    blurAsABrowserWould(retryButton);
    const search = screen.getByRole("searchbox", { name: "Search files" });
    search.focus();
    retry.resolve(null);

    await waitFor(() => {
      expect(durable).toBeEnabled();
    });
    expect(search).toHaveFocus();
    expect(focusing).not.toHaveBeenCalled();

    // Settlement retires the one-shot debt even when it declines to move focus.
    // A later body focus and unrelated render must not revive it.
    search.blur();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-desc" },
    });
    expect(document.body).toHaveFocus();
    expect(focusing).not.toHaveBeenCalled();
    expect(requests).toBe(2);
  });

  it("returns it to Add files… and never to the other acquisition action", async () => {
    // Two actions, two restorations. A single remembered control would give the
    // keyboard back to whichever one the code happened to name.
    const picker = deferred<readonly PickedFile[] | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      pickedFiles: () => picker.promise,
    });
    renderApp(api);
    const add = await screen.findByRole("button", { name: "Add files…" });
    add.focus();

    fireEvent.click(add);
    blurAsABrowserWould(add);
    picker.resolve([selectedFile]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toHaveFocus();
    });
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).not.toHaveFocus();
  });

  it("does not take focus the user moved somewhere else while the scan ran", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile],
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    const folder = await screen.findByRole("button", { name: "Add mzML folder…" });
    folder.focus();
    fireEvent.click(folder);
    blurAsABrowserWould(folder);

    // The user goes to the search box while the walk runs, which the folder
    // action deliberately leaves usable.
    const search = screen.getByRole("searchbox", { name: "Search files" });
    search.focus();
    scan.resolve({ files: [] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    expect(search).toHaveFocus();
  });

  it("takes no keyboard focus when the action was started with a pointer", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    const folder = await screen.findByRole("button", { name: "Add mzML folder…" });

    // Not focused first: a press that did not take the keyboard has no place to
    // return it to, and putting it here would be a move of its own.
    fireEvent.click(folder);
    scan.resolve({ files: [] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    expect(document.body).toHaveFocus();
  });
});

describe("saying what a folder import is doing", () => {
  const STATUS =
    "Folder import in progress. MSCanvas is waiting for a folder selection or " +
    "scanning the chosen folder. The duration is not known.";

  function spoken(): string {
    return document.querySelector("[data-live-region='folder']")?.textContent ?? "";
  }

  it("does not claim a folder is being scanned before one has been chosen", async () => {
    // `folderBusy` is set before the native dialog opens, because that is where
    // the operation begins. At that moment nothing has been selected, so a
    // status naming a chosen folder is false for as long as the user spends
    // navigating -- and false altogether if they cancel.
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    // The picker is open and nothing has been chosen.
    expect(screen.queryByText(/Scanning folder/)).toBeNull();
    expect(document.body.textContent).not.toContain("the chosen folder for");
    // What is said instead is true of both halves of the operation.
    expect(spoken()).toBe(STATUS);
    expect(screen.getByText("Folder import in progress…", VISIBLE)).toBeVisible();
    // And no proportion is invented for a tree nothing has counted.
    expect(spoken()).not.toMatch(/\d+\s*%/);

    // Still true once the walk itself is running, which is why one sentence
    // covers both rather than two sentences guessing which.
    scan.resolve({ files: [{ file: selectedFile, parents: [] }] });
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });
  });

  it("clears the status however the operation ends", async () => {
    for (const ending of ["cancelled", "succeeded", "failed"] as const) {
      const api = createFakePreviewApi({
        availability: unavailableBackend,
        scannedFolder:
          ending === "cancelled"
            ? null
            : ending === "succeeded"
              ? { files: [] }
              : () => Promise.reject(previewError({ kind: "folder_not_readable" })),
      });
      renderApp(api);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
      });

      fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));
      expect(spoken()).toBe(STATUS);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
      });
      expect(spoken()).toBe("");
      expect(screen.queryByText("Folder import in progress…")).toBeNull();
      cleanup();
    }
  });

  it("announces the status through a region that was mounted all along", async () => {
    // A live region inserted together with its text is the shape screen readers
    // routinely miss, so the region exists from the first render and only its
    // text changes.
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    const region = () => document.querySelectorAll("[data-live-region='folder']");
    expect(region()).toHaveLength(1);
    expect(spoken()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    expect(region()).toHaveLength(1);
    expect(spoken()).toBe(STATUS);
    scan.resolve({ files: [] });
    await waitFor(() => {
      expect(spoken()).toBe("");
    });
    expect(region()).toHaveLength(1);
  });

  it("keeps exactly one folder action, named the same throughout", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    renderApp(api);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    expect(screen.getAllByRole("button", { name: "Add mzML folder…" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    scan.resolve({ files: [] });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
    expect(screen.getAllByRole("button", { name: "Add mzML folder…" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("leaves everything the roster read does not gate alone while it is unresolved", async () => {
    // Only the folder action waits on the initial read. Adding files is one
    // gated batch with nothing running unlocked inside it, so it has no window
    // in which an older read could invalidate it -- and taking it away would be
    // a cost with nothing bought.
    const initial = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      roster: () => initial.promise,
    });
    renderApp(api);

    const add = await screen.findByRole("button", { name: "Add files…" });
    expect(add).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    // And the window says it is still reading rather than claiming the session
    // is empty.
    expect(screen.getByText("Reading the workspace list…")).toBeVisible();

    initial.resolve({ datasets: [], capacity: 1_024 });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeEnabled();
    });
  });
});
