import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import type {
  SelectedSpectrumOutcome,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "../features/mzml-preview/contracts";
import {
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
    expect(screen.getAllByRole("option")).toHaveLength(3);
    // Everything that arrived is selected, so `Remove selected` acts on the
    // batch the user just added; the first of them is the one being shown.
    expect(
      screen.getAllByRole("option").filter((row) => row.getAttribute("aria-selected") === "true"),
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
    expect(screen.getAllByRole("option")).toHaveLength(1);
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
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("says plainly when a file did not fit the session", async () => {
    const api = createFakePreviewApi({ capacity: 1, pickedFiles: [selectedFile, secondFile] });
    await openTheFile(api);

    expect(await screen.findByText(/1 file did not fit/, VISIBLE)).toBeVisible();
    expect(screen.getAllByRole("option")).toHaveLength(1);
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
      expect(screen.getAllByRole("option")).toHaveLength(1);
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
      expect(screen.getAllByRole("option")).toHaveLength(1);
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
    expect(screen.getAllByRole("option")).toHaveLength(2);
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
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(rosterRow(/QC_pool_02\.mzML/)).toHaveTextContent("▸");
    expect(rosterRow(/QC_pool_02\.mzML/)).not.toHaveTextContent("Reading…");
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
    expect(regions()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));

    await waitFor(() => {
      expect(regions().map((region) => region.textContent).join(" ")).toContain(
        "Workspace: Added 2 files.",
      );
    });
    // The same two regions, with new text in one of them.
    expect(regions()).toHaveLength(2);
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

  it("lists two names for one acquisition as two lines rather than one", async () => {
    // Rust reports one outcome per file the user chose, and two names for one
    // file produce the same sentence. Keying the list on that sentence made two
    // reports one row.
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
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
