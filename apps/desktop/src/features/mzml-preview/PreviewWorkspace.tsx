import { useCallback, useLayoutEffect, useMemo } from "react";

import { BackendStatus } from "./BackendStatus";
import { DatasetRoster } from "./DatasetRoster";
import { PreviewSummary } from "./PreviewSummary";
import { SelectedSpectrumPanel } from "./SelectedSpectrumPanel";
import { SpectrumTable } from "./SpectrumTable";
import { formatCount } from "./format";
import { rosterProjection, type WorkspaceNotice } from "./rosterSelection";
import { describeProjection } from "./rosterView";
import { usePreviewWorkspace } from "./usePreviewWorkspace";

/** The session workspace: a curated roster of mzML files, and one open preview. */
export function PreviewWorkspace() {
  const workspace = usePreviewWorkspace();
  const { preview, roster, spectrum, recordMeasurement, completeRenderMeasurements } = workspace;

  // Derived once per roster change and handed down, so the rows the list
  // renders are the same list the reducer ranges over rather than a second
  // answer to the same question.
  const projection = useMemo(() => rosterProjection(roster), [roster]);

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
  // an installation request whose own modal dialog is open, and a workspace
  // change that has not been answered yet -- the last because two mutations in
  // flight at once let an older reply's roster snapshot overwrite a newer one's,
  // and Rust serialises them anyway, so waiting costs a moment and no more.
  const canAddFiles =
    !workspace.backendBusy && !workspace.pickerBusy && !workspace.workspaceBusy;
  // The same gate from the other side. An add holds `pickerBusy` for the whole
  // of the picker *and* the registration that follows it, so a removal or a
  // clear started in that window is the second mutation in flight that
  // `canAddFiles` exists to prevent -- and it would answer with a roster
  // snapshot taken before the added rows existed.
  const canMutate = !workspace.workspaceBusy && !workspace.pickerBusy;
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
            {/* The same action as `Add files…`, so it is refused in the same
                states. An enabled control that returns at a guard tells the
                user their retry failed again. */}
            <button
              className="link-button"
              disabled={!canAddFiles}
              onClick={workspace.addFiles}
              type="button"
            >
              Try choosing files again
            </button>
            <button className="link-button" onClick={workspace.dismissPickerError} type="button">
              Dismiss
            </button>
          </div>
        )}

        {workspace.workspaceError === null ? null : (
          <div className="notice notice-danger" role="status">
            <strong>The workspace could not be changed</strong>
            <span>{workspace.workspaceError.summary}</span>
            <button className="link-button" onClick={workspace.dismissWorkspaceError} type="button">
              Dismiss
            </button>
          </div>
        )}

        {/* What the last workspace action did, above the workspace rather than
            inside it. A summary that grows with the batch would otherwise take
            its height from the list it is describing, and at a short window the
            rows it announces would have nowhere left to be. */}
        {/* Deliberately not a live region of its own. A region that appears
            together with its text is the shape screen readers routinely miss,
            so the announcement is made by the always-mounted region below and
            this is the visible half. */}
        {workspace.workspaceNotice === null ? null : (
          <div
            className={
              workspace.workspaceNotice.tone === "warning"
                ? "notice notice-warning"
                : "notice notice-neutral"
            }
          >
            <span>{workspace.workspaceNotice.message}</span>
            {workspace.workspaceNotice.details.length === 0 ? null : (
              <ul className="workspace-notice-details">
                {/* Keyed by position as well as by text: two names for one
                    acquisition produce the same sentence, and Rust reports one
                    outcome per file the user chose rather than one per row. */}
                {workspace.workspaceNotice.details.map((detail, index) => (
                  <li key={`${String(index)}-${detail}`}>{detail}</li>
                ))}
                {workspace.workspaceNotice.more === 0 ? null : (
                  <li key="more">
                    {formatCount(workspace.workspaceNotice.more)} more not listed here.
                  </li>
                )}
              </ul>
            )}
            <button className="link-button" onClick={workspace.dismissWorkspaceNotice} type="button">
              Dismiss
            </button>
          </div>
        )}

        {workspace.rosterLoad.status === "failed" && roster.datasets.length > 0 ? (
          <div className="notice notice-danger" role="status">
            <strong>The workspace list could not be read</strong>
            <span>{workspace.rosterLoad.error.summary}</span>
            <button className="link-button" onClick={workspace.reloadRoster} type="button">
              Try reading it again
            </button>
          </div>
        ) : null}
      </div>

      {/* Two polite regions, both mounted for the life of the application so
          that what they say is a change inside a region rather than a region
          arriving with its text — the shape a screen reader is most likely to
          miss. One carries what the viewer is doing; the other carries what the
          last workspace action did, which is otherwise announced nowhere: with
          a preview loaded the viewer's sentence does not change when rows are
          added or removed. */}
      <p aria-live="polite" className="visually-hidden">
        {announce(workspace)}
      </p>
      {/* One expression, so the region holds one text node whose string
          changes. Two children would leave the sentence node untouched when
          the sentence repeats, and React would add or remove the second node
          instead -- a change this region's default `aria-relevant` does not
          announce in one direction and CSS collapses away in the other. */}
      {/* What the search found, which is otherwise announced nowhere: the list
          simply becomes shorter, and neither of the other two regions says a
          word about it. Empty until a query narrows something, so an ordinary
          session is not given a third thing to say.

          No alternating character here, unlike the account below. Two searches
          that happen to find the same number of files are not two events worth
          repeating — and the sort has no sentence at all, because a native
          select announces its own value and a second voice saying the same
          thing is noise rather than access. */}
      <p aria-live="polite" className="visually-hidden">
        {describeProjection(projection)}
      </p>
      <p aria-live="polite" className="visually-hidden">
        {workspace.workspaceNotice === null ? "" : announceNotice(workspace.workspaceNotice)}
      </p>

      <main className="workspace-layout">
        <aside className="workspace-sidebar">
          <DatasetRoster
            canAddFiles={canAddFiles}
            canMutate={canMutate}
            canPreview={canPreview}
            dispatch={workspace.dispatchRoster}
            focusAddFilesToken={workspace.focusAddFilesToken}
            load={workspace.rosterLoad}
            onActivate={workspace.activateDataset}
            onAddFiles={workspace.addFiles}
            onClearList={workspace.clearList}
            onReloadRoster={workspace.reloadRoster}
            onRemoveSelected={workspace.removeSelected}
            projection={projection}
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

/**
 * What the last workspace action did, and what it did not do.
 *
 * The details are deliberately left out: the visible notice carries them, and a
 * polite region that reads a list of file names aloud after every batch is
 * noise rather than feedback. `more` is left out with them -- it counts what
 * the *visible* list stopped short of, and a channel that enumerated nothing
 * has no cutoff to report. The message itself carries the totals either way.
 *
 * The sentence ends in a non-breaking space on every other account. Two
 * removals of one row produce the same words, and a region whose string does
 * not change is announced nowhere -- which is the case this region exists for.
 * It has to be part of this string rather than a sibling node, and it has to be
 * U+00A0 rather than a plain space, because CSS collapses a trailing ordinary
 * space out of the rendered text a screen reader is given. It is not spoken.
 */
function announceNotice(notice: WorkspaceNotice): string {
  return `Workspace: ${notice.message}${notice.sequence % 2 === 1 ? "\u00a0" : ""}`;
}

function announce(workspace: ReturnType<typeof usePreviewWorkspace>): string {
  const { preview, roster, rosterLoad, spectrum } = workspace;
  if (preview.status === "opening") {
    return "Reading the selected file.";
  }
  if (preview.status === "failed") {
    return `The file could not be read. ${preview.error.summary}`;
  }
  if (preview.status === "empty") {
    if (rosterLoad.status === "loading") {
      // Not "the workspace is empty". Rust keeps the workspace across a reload
      // of this window, so until the list has been read that is a claim this
      // side cannot make.
      return "Reading the workspace list.";
    }
    if (rosterLoad.status === "failed" && roster.datasets.length === 0) {
      // Nor after the read failed, which is the same ignorance by another
      // route -- and the failure itself is worth hearing.
      return `The workspace list could not be read. ${rosterLoad.error.summary}`;
    }
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
