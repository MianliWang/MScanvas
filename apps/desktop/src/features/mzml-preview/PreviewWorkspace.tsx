import { useCallback, useLayoutEffect } from "react";

import { BackendStatus } from "./BackendStatus";
import { DatasetRoster } from "./DatasetRoster";
import { PreviewSummary } from "./PreviewSummary";
import { SelectedSpectrumPanel } from "./SelectedSpectrumPanel";
import { SpectrumTable } from "./SpectrumTable";
import { formatCount } from "./format";
import { usePreviewWorkspace } from "./usePreviewWorkspace";

/** The session workspace: a curated roster of mzML files, and one open preview. */
export function PreviewWorkspace() {
  const workspace = usePreviewWorkspace();
  const { preview, roster, spectrum, recordMeasurement, completeRenderMeasurements } = workspace;

  // Runs after the panels below have been committed, so each measurement
  // covers the work its name describes rather than stopping when the reply
  // arrived. Child layout effects run before this one, so the summary, the
  // first table window and the plot are all in the document by now.
  useLayoutEffect(() => {
    completeRenderMeasurements();
  }, [completeRenderMeasurements, preview, spectrum]);

  // Reading a file needs a backend positively known to work. "Checking" and
  // "failed" are not that: a failed check cannot say whether an installation is
  // present, and a folder choice that failed before reaching the backend says
  // nothing about it either. Offering an action whose only outcome is another
  // failure is worse than not offering it.
  const backendUsable =
    workspace.backend.status === "resolved" &&
    workspace.backend.availability.state === "available";
  // Deliberately not the negation of the above. This is the one state that has
  // something specific to tell the user about installing ProteoWizard, and
  // saying it while a check is still running would be a guess.
  const backendUnavailable =
    workspace.backend.status === "resolved" &&
    workspace.backend.availability.state === "unavailable";

  // Curating the workspace is not backend work, so it stays available when no
  // ProteoWizard is installed. What it waits for is a picker already on screen,
  // and an installation request whose own modal dialog is open.
  const canAddFiles = !workspace.backendBusy && !workspace.pickerBusy;
  // One viewer read at a time. Rust supersedes an older open of one dataset
  // anyway; this is what stops a queue of them forming behind the single
  // backend gate in the first place.
  const canPreview = backendUsable && !workspace.backendBusy && !workspace.previewBackendBusy;

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
            <span>Local mzML workspace</span>
          </div>
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
            what is already on screen, which is still open and still usable. */}
        {workspace.pickerError === null ? null : (
          <div className="notice notice-danger" role="status">
            <strong>The file picker could not be opened</strong>
            <span>{workspace.pickerError.summary}</span>
            <button className="link-button" onClick={workspace.addFiles} type="button">
              Try choosing files again
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
        <aside className="workspace-sidebar">
          <DatasetRoster
            canAddFiles={canAddFiles}
            canMutate={!workspace.workspaceBusy}
            canPreview={canPreview}
            dispatch={workspace.dispatchRoster}
            error={workspace.workspaceError}
            focusAddFilesToken={workspace.focusAddFilesToken}
            load={workspace.rosterLoad}
            notice={workspace.workspaceNotice}
            onActivate={workspace.activateDataset}
            onAddFiles={workspace.addFiles}
            onClearList={workspace.clearList}
            onDismissError={workspace.dismissWorkspaceError}
            onDismissNotice={workspace.dismissWorkspaceNotice}
            onReloadRoster={workspace.reloadRoster}
            onRemoveSelected={workspace.removeSelected}
            state={roster}
          />
          {preview.status === "loaded" ? (
            <PreviewSummary
              file={preview.preview.file}
              measurements={workspace.measurements}
              metadata={preview.preview.metadata}
              runSummary={preview.preview.runSummary}
              spectrumListTotal={preview.preview.spectrumTable.totalRowCount}
            />
          ) : null}
        </aside>

        {preview.status === "loaded" ? (
          <div className="viewer-stack">
            <SpectrumTable
              onRendered={handleTableRendered}
              onSelect={workspace.selectSpectrum}
              selectedIndex={workspace.selectedIndex}
              table={preview.preview.spectrumTable}
            />
            <SelectedSpectrumPanel onRetry={workspace.retrySpectrum} state={spectrum} />
          </div>
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
                  {/* Reading is idempotent, so a retry is offered when the
                      backend said the failure was retryable — and it repeats
                      the step that actually failed. */}
                  {preview.error.retryable && workspace.activeDataset !== null ? (
                    <button
                      className="secondary-button"
                      disabled={!canPreview}
                      onClick={workspace.previewActiveAgain}
                      type="button"
                    >
                      Try reading this file again
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <strong>{roster.datasets.length === 0 ? "Add mzML files" : "Preview a file"}</strong>
                <span>
                  MSCanvas reads local .mzML files from this computer and never writes to them.
                  Nothing is uploaded and nothing leaves this machine.
                </span>
                {backendUnavailable ? (
                  <span>
                    Install ProteoWizard to read a file. The workspace list works without it.
                  </span>
                ) : roster.datasets.length === 0 ? (
                  <span>Use Add files… in the workspace list to choose one or several.</span>
                ) : (
                  <>
                    {/* Rust still holds every path, so reading one again is one
                        action and not a trip back through the picker. This is
                        what changing the installation costs: the readings go,
                        the workspace does not. */}
                    {workspace.activeDataset === null ? (
                      <span>
                        Select a file in the workspace list, then choose Preview focused.
                      </span>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={!canPreview}
                        onClick={workspace.previewActiveAgain}
                        type="button"
                      >
                        Preview {workspace.activeDataset.fileName}
                      </button>
                    )}
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
  const { preview, roster, spectrum } = workspace;
  if (preview.status === "opening") {
    return "Reading the selected file.";
  }
  if (preview.status === "failed") {
    return `The file could not be read. ${preview.error.summary}`;
  }
  if (preview.status === "empty") {
    return roster.datasets.length === 0
      ? "The workspace is empty."
      : `${formatCount(roster.datasets.length)} files in the workspace. No preview is open.`;
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
