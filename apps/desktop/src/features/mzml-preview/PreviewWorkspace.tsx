import { useCallback, useLayoutEffect } from "react";

import { BackendStatus } from "./BackendStatus";
import { PreviewSummary } from "./PreviewSummary";
import { SelectedSpectrumPanel } from "./SelectedSpectrumPanel";
import { SpectrumTable } from "./SpectrumTable";
import { formatCount } from "./format";
import { usePreviewWorkspace } from "./usePreviewWorkspace";

/** The first user-visible slice: open one mzML file and look inside it. */
export function PreviewWorkspace() {
  const workspace = usePreviewWorkspace();
  const { preview, spectrum, recordMeasurement, completeRenderMeasurements } = workspace;

  // Runs after the panels below have been committed, so each measurement
  // covers the work its name describes rather than stopping when the reply
  // arrived. Child layout effects run before this one, so the summary, the
  // first table window and the plot are all in the document by now.
  useLayoutEffect(() => {
    completeRenderMeasurements();
  }, [completeRenderMeasurements, preview, spectrum]);

  const backendUnavailable =
    workspace.backend.status === "resolved" &&
    workspace.backend.availability.state === "unavailable";

  const handleTableRendered = useCallback(
    (renderedRowCount: number, milliseconds: number) => {
      recordMeasurement(
        "spectrumTableRender",
        milliseconds,
        `Rendering ${formatCount(renderedRowCount)} windowed rows.`,
      );
    },
    [recordMeasurement],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span aria-hidden="true" className="brand-mark">
            MS
          </span>
          <div>
            <strong>MSCanvas</strong>
            <span>Local mzML preview</span>
          </div>
        </div>

        <div className="toolbar-actions">
          <button
            className="primary-button"
            disabled={backendUnavailable || preview.status === "opening" || workspace.backendBusy}
            onClick={workspace.openFile}
            type="button"
          >
            {preview.status === "opening" ? "Opening…" : "Open mzML…"}
          </button>
        </div>
      </header>

      {/* One grid track, however many notices are showing. The shell's rows
          are fixed, so a conditional notice must not become a row of its own. */}
      <div className="shell-notices">
        <BackendStatus
          busy={workspace.backendBusy}
          onChooseInstallation={workspace.chooseInstallation}
          onRecheck={workspace.checkBackend}
          onUseAutomaticDiscovery={workspace.useAutomaticDiscovery}
          state={workspace.backend}
        />

        {/* A picker that would not open is its own problem. It never replaces
            the file already on screen, which is still open and still usable. */}
        {workspace.pickerError === null ? null : (
          <div className="notice notice-danger" role="status">
            <strong>The file picker could not be opened</strong>
            <span>{workspace.pickerError.summary}</span>
            <button className="link-button" onClick={workspace.openFile} type="button">
              Try choosing a file again
            </button>
            <button className="link-button" onClick={workspace.dismissPickerError} type="button">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* One polite region so a screen reader hears state changes that happen
          away from the keyboard focus. */}
      <p aria-live="polite" className="visually-hidden">
        {announce(workspace)}
      </p>

      <main className="workspace-layout">
        {preview.status === "loaded" ? (
          <>
            <PreviewSummary
              file={preview.preview.file}
              measurements={workspace.measurements}
              metadata={preview.preview.metadata}
              runSummary={preview.preview.runSummary}
              spectrumListTotal={preview.preview.spectrumTable.totalRowCount}
            />
            <div className="viewer-stack">
              <SpectrumTable
                onRendered={handleTableRendered}
                onSelect={workspace.selectSpectrum}
                selectedIndex={workspace.selectedIndex}
                table={preview.preview.spectrumTable}
              />
              <SelectedSpectrumPanel onRetry={workspace.retrySpectrum} state={spectrum} />
            </div>
          </>
        ) : (
          <section className="panel workspace-placeholder">
            {preview.status === "opening" ? (
              <div className="empty-state">
                <strong>Reading the file…</strong>
                <span>
                  Loading metadata, the run summary and the spectrum list through the installed
                  backend.
                </span>
              </div>
            ) : preview.status === "failed" ? (
              <div className="empty-state">
                <strong>{preview.error.summary}</strong>
                {preview.error.detail === null ? null : <span>{preview.error.detail}</span>}
                <div className="empty-state-actions">
                  {/* Both steps are idempotent reads, so a retry is offered
                      when the backend said the failure was retryable — and it
                      repeats the step that actually failed. */}
                  {preview.error.retryable ? (
                    <button
                      className="secondary-button"
                      onClick={workspace.retryOpen}
                      type="button"
                    >
                      Try opening this file again
                    </button>
                  ) : null}
                  <button className="secondary-button" onClick={workspace.openFile} type="button">
                    Choose a different file
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <strong>Open an mzML file</strong>
                <span>
                  MSCanvas reads one local .mzML file at a time and never writes to it. Nothing is
                  uploaded and nothing leaves this machine.
                </span>
                {backendUnavailable ? (
                  <span>Install ProteoWizard first, then check again above.</span>
                ) : (
                  <>
                    {/* Rust is still holding the file, so reopening it is one
                        click and not a trip back through the picker. This is
                        what changing the installation costs: the readings go,
                        the selection does not. */}
                    {workspace.selectedFileName === null ? null : (
                      <button
                        className="primary-button"
                        disabled={workspace.backendBusy}
                        onClick={workspace.reopenSelectedFile}
                        type="button"
                      >
                        Reopen {workspace.selectedFileName}
                      </button>
                    )}
                    <button
                      className={
                        workspace.selectedFileName === null ? "primary-button" : "secondary-button"
                      }
                      disabled={workspace.backendBusy}
                      onClick={workspace.openFile}
                      type="button"
                    >
                      Choose an mzML file
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function announce(workspace: ReturnType<typeof usePreviewWorkspace>): string {
  const { preview, spectrum } = workspace;
  if (preview.status === "opening") {
    return "Opening the selected file.";
  }
  if (preview.status === "failed") {
    return `The file could not be opened. ${preview.error.summary}`;
  }
  if (preview.status === "empty") {
    return "No file is open.";
  }
  switch (spectrum.status) {
    case "none":
      return `${formatCount(preview.preview.spectrumTable.totalRowCount)} spectra loaded. No spectrum selected.`;
    case "loading":
      return `Loading spectrum ${formatCount(spectrum.index)}.`;
    case "loaded":
      return `Spectrum ${formatCount(spectrum.spectrum.index)} rendered with ${formatCount(spectrum.spectrum.pointCount)} points.`;
    case "unavailable":
      return `This run has no spectrum at index ${formatCount(spectrum.requestedIndex)}.`;
    case "failed":
      return `Spectrum ${formatCount(spectrum.index)} could not be loaded. ${spectrum.error.summary}`;
  }
}
