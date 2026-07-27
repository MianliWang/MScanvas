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
  const { preview, spectrum, recordMeasurement, completeSpectrumRender } = workspace;

  // Runs after the spectrum panel and its plot have been committed, so the
  // row-select measurement covers the point reduction and the DOM work rather
  // than stopping when the reply arrived.
  useLayoutEffect(() => {
    if (spectrum.status === "loaded") {
      completeSpectrumRender();
    }
  }, [completeSpectrumRender, spectrum]);

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
            disabled={backendUnavailable || preview.status === "opening"}
            onClick={workspace.openFile}
            type="button"
          >
            {preview.status === "opening" ? "Opening…" : "Open mzML…"}
          </button>
        </div>
      </header>

      <BackendStatus onRecheck={workspace.checkBackend} state={workspace.backend} />

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
                      onClick={workspace.retryFailedStep}
                      type="button"
                    >
                      {preview.stage === "choosing"
                        ? "Try choosing a file again"
                        : "Try opening this file again"}
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
                  <button className="primary-button" onClick={workspace.openFile} type="button">
                    Choose an mzML file
                  </button>
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
