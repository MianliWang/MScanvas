import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { BackendStatus } from "./BackendStatus";
import type { WorkspaceDropRejectionReason } from "./contracts";
import { conversionJudgedAnyOutput, isConvertibleSourceKind } from "./contracts";
import { ConversionPanel } from "./ConversionPanel";
import { DatasetRoster } from "./DatasetRoster";
import { PreviewSummary } from "./PreviewSummary";
import { SelectedSpectrumPanel } from "./SelectedSpectrumPanel";
import { SpectrumTable } from "./SpectrumTable";
import { formatCount, formatDatasetLabel } from "./format";
import { rosterProjection, type WorkspaceNotice } from "./rosterSelection";
import { describeProjection } from "./rosterView";
import { usePreviewWorkspace } from "./usePreviewWorkspace";

/**
 * What a folder import is doing, said so that it is true throughout.
 *
 * The operation covers a modal dialog and then a filesystem walk, and the
 * interface cannot see the moment between them: a native picker does not report
 * closing, and adding an event protocol to learn it is a task model this
 * milestone deliberately does not build. So the sentence names both phases
 * rather than guessing which one is running, and says the length is unknown
 * rather than inventing a proportion of a tree nothing has counted.
 */
const FOLDER_IMPORT_STATUS =
  "Folder import in progress. MSCanvas is waiting for a folder selection or " +
  "scanning the chosen folder. The duration is not known.";

const DROP_IMPORT_STATUS =
  "Adding dropped items. MSCanvas is inspecting dropped files and folders. " +
  "The duration is not known.";

const DROP_BUSY_STATUS =
  "Another drop is already being processed. Wait for it to finish or clear the workspace.";

/** The session workspace: a curated roster of mzML files, and one open preview. */
export function PreviewWorkspace() {
  const workspace = usePreviewWorkspace();
  const { preview, roster, spectrum, recordMeasurement, completeRenderMeasurements } = workspace;
  const [restoreAddFolderFocusToken, setRestoreAddFolderFocusToken] = useState(0);
  const [restoreAddFilesFocusToken, setRestoreAddFilesFocusToken] = useState(0);

  // Derived once per roster change and handed down, so the rows the list
  // renders are the same list the reducer ranges over rather than a second
  // answer to the same question.
  // The row a queue is converting right now, and every other row it holds.
  const queueHandles = workspace.conversion.busyHandles;
  const converting = useMemo(() => {
    const state = workspace.conversion.state;
    // A stopping queue still has an item under way, and that row is still being
    // read. Dropping the pin here would let a search hide the very acquisition
    // the stop is waiting on.
    if (state.status !== "running" && state.status !== "stopping") {
      return null;
    }
    // The item that says it is running, not an index. The index counts what is
    // done, and during a run the two agree -- but a reader that trusted the
    // index would pin the wrong row the moment they did not.
    return state.queue.items.find((item) => item.state === "running")?.datasetHandle ?? null;
  }, [workspace.conversion.state]);
  const queued = useMemo(
    () => new Set(queueHandles.filter((handle) => handle !== converting)),
    [queueHandles, converting],
  );
  const projection = useMemo(
    () => rosterProjection(roster, converting, queued),
    [roster, converting, queued],
  );

  // A preview response describes the row as it was when the read was produced,
  // but a collision context is a fact about the whole *current* roster: it appears
  // when a same-named row arrives and disappears when that row leaves. Prefer
  // the live active row only when it is still the one this preview belongs to;
  // the response is a defensive fallback when no matching live row is
  // available, rather than the source of display identity.
  const previewFile =
    preview.status === "loaded" &&
    workspace.activeDataset?.handle === preview.preview.file.handle
      ? workspace.activeDataset
      : preview.status === "loaded"
        ? preview.preview.file
        : null;

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
  // an installation request whose own modal dialog is open, a folder import
  // that has not settled, and a workspace change that has not been answered yet
  // -- the last three because two mutations in flight at once let an older
  // reply's roster snapshot overwrite a newer one's, and Rust serialises them
  // anyway, so waiting costs a moment and no more.
  //
  // One expression for both acquisition actions, so they cannot come to mean
  // different things: they are mutually exclusive by construction, and each is
  // refused for exactly the reasons the other is.
  //
  // A conversion is one more reason for all of them. It holds the one backend
  // lane for as long as a process takes and it is reading a row of this very
  // roster, so Rust refuses every mutation while one is under way; these gates
  // are what stop the interface asking.
  const canAcquire =
    !workspace.backendBusy &&
    !workspace.pickerBusy &&
    !workspace.folderBusy &&
    !workspace.dropBusy &&
    !workspace.workspaceBusy &&
    !workspace.conversion.busy;
  // One thing more for the folder action, and only for it. Native page-load
  // start has already superseded work owned by the previous document; the
  // mount-time roster answer is what lets this document begin from a list it
  // has actually adopted. Adding files has no unlocked scan window: it is one
  // gated batch.
  //
  // A failed read is the same answer for the same reason. This window has no
  // authoritative list, and the roster's own retry is the way out.
  const canAddFolder = canAcquire && workspace.rosterLoad.status === "ready";
  // Removing rows and emptying the list are a different concurrency contract
  // from acquiring more, and are deliberately not the same boolean.
  //
  // They wait on an add's picker, because that holds `pickerBusy` across the
  // dialog *and* the registration after it, and a removal answering inside that
  // window carries a roster from before the added rows existed. A folder import
  // adds one much shorter wait: until Rust returns the baseline reservation and
  // the exact claim request is dispatched. After that edge they stay available
  // for the whole native picker and scan. A successful `Clear list` is the
  // reliable final-empty escape, while `Remove selected` still manages rows
  // already on screen. Rust linearises either action against the claim: if the
  // action reaches the gate first the picker never opens; if it follows the
  // claim it supersedes the eventual commit. A late folder reply is never
  // allowed to overwrite the later answer.
  const canMutate =
    !workspace.workspaceBusy &&
    !workspace.pickerBusy &&
    !workspace.folderReservationPending;
  // Emptying the list would revoke the row a conversion is reading. Stopping
  // the queue is the way out of that, and it is the user's to take -- clearing
  // the list is not a way to take it, so Rust refuses it outright.
  const canClear = canMutate && !workspace.conversion.busy;
  // Removing is narrower than clearing, and deliberately not the same boolean.
  // Rust refuses a removal only when the converting row is among the handles,
  // so every other row stays the user's to prune -- which matters most during a
  // conversion, because that is when the list is unusable for longest.
  // An adoption is the one workspace state a terminal queue puts the session in
  // that holds no rows: `queueHandles` is empty, so the check beside this one
  // cannot see it. Rust refuses a removal outright while one runs, and pressing
  // it anyway would move the workspace decision count on the way to that
  // refusal -- superseding the adoption the user is waiting on.
  const canRemove =
    canMutate &&
    !workspace.conversion.adopting &&
    !queueHandles.some((handle) => roster.selected.has(handle));
  // Reading the list back is not an escape route. It is a pure, gate-linearized
  // snapshot, but during a scan it would add a loading state and a projection
  // whose usefulness depends on whether the scan committed before or after it.
  // The folder reply or owed reconciliation already supplies the authoritative
  // way out, so unlike removing and clearing it waits.
  const canReloadRoster = canMutate && !workspace.folderBusy && !workspace.dropBusy;
  // One viewer read at a time. Rust supersedes an older open of one dataset
  // anyway; this is what stops a queue of them forming behind the single
  // backend gate in the first place.
  //
  // A quarantined session refuses every one of these outright: MSCanvas has
  // lost track of a converter process of its own and will not start another
  // until it is restarted. Rust enforces it; this is what stops the interface
  // offering a control that can only answer with a refusal.
  //
  // An adoption is the one thing in `busy` that is not a reason to wait here:
  // it launches no process, holds no backend gate and leaves an open preview
  // exactly as it is, and Rust admits a read throughout. Converting is
  // different, and waits for it below.
  const canPreview =
    backendUsable &&
    !workspace.backendBusy &&
    !workspace.previewBackendBusy &&
    (!workspace.conversion.busy || workspace.conversion.adopting) &&
    !workspace.conversion.backendQuarantined;
  // Converting needs the same backend a preview does, and the same free lane --
  // plus the terminal queue an adoption is reading, which it would replace.
  const canConvert =
    canPreview && !workspace.workspaceBusy && !workspace.conversion.adopting;

  // The row the keyboard is on. Deliberately not `activeDataset`: the preview
  // and the conversion panel may describe different rows, and this slice's whole
  // point is that moving focus to a vendor row does not disturb an mzML preview
  // already on screen.
  const focusedDataset = useMemo(
    () => projection.datasets.find((dataset) => dataset.handle === roster.focused) ?? null,
    [projection, roster.focused],
  );

  // Asked for whenever the focused row changes, and cleared when it is not
  // convertible. The summary is read from Rust rather than composed here so it
  // describes the plan the run is actually fixed with.
  // What a conversion would act on, in the order the user is looking at.
  //
  // The selection when it holds convertible rows, and the focused row
  // otherwise -- so `Convert focused…` stays exactly what it was and a
  // multi-row selection becomes a queue without a second control. The order is
  // the projection's, which is the order on screen after search and sort.
  const selectedConvertible = useMemo(
    () =>
      projection.datasets.filter(
        (dataset) =>
          roster.selected.has(dataset.handle) && isConvertibleSourceKind(dataset.sourceKind),
      ),
    [projection, roster.selected],
  );
  // Stated, never silently dropped: a user who selected ten rows and sees a
  // queue of six is owed the other four.
  const excludedSelectedCount = useMemo(
    () =>
      projection.datasets.filter(
        (dataset) =>
          roster.selected.has(dataset.handle) && !isConvertibleSourceKind(dataset.sourceKind),
      ).length,
    [projection, roster.selected],
  );
  const focusedConvertible =
    focusedDataset !== null && isConvertibleSourceKind(focusedDataset.sourceKind);
  const queueHandlesToConvert = useMemo(
    () =>
      selectedConvertible.length > 0
        ? selectedConvertible.map((dataset) => dataset.handle)
        : focusedConvertible
          ? [focusedDataset.handle]
          : [],
    [selectedConvertible, focusedConvertible, focusedDataset],
  );

  const { describe: describeConversion } = workspace.conversion;
  // The joined key is the dependency; the array itself is the input. A fresh
  // array is built on every render, so depending on it would re-describe the
  // same queue on every keystroke in the search box -- and splitting the key
  // back apart to rebuild the input would turn a handle that ever held the
  // separator into a different queue. A unit separator is the one thing an
  // opaque handle cannot contain.
  const describeKey = queueHandlesToConvert.join("\u001f");
  useEffect(() => {
    describeConversion(queueHandlesToConvert);
    // `queueHandlesToConvert` is deliberately absent: `describeKey` is its
    // content, and the content is what decides whether to ask again.
  }, [describeConversion, describeKey]);

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
        <p className="workspace-drop-hint">
          {workspace.dropSubscriptionStatus === "available"
            ? "Drop mzML files or folders anywhere in this window."
            : workspace.dropSubscriptionStatus === "connecting"
              ? "Connecting Explorer drag-and-drop…"
              : "Explorer drag-and-drop is unavailable. Use the Add actions below."}
        </p>
      </header>

      {workspace.dropPresentation.status === "idle" ? null : (
        <div
          aria-hidden="true"
          className={`workspace-drop-overlay workspace-drop-overlay-${workspace.dropPresentation.status}`}
          data-drop-overlay={workspace.dropPresentation.status}
        >
          <div className="workspace-drop-overlay-card">
            <strong>
              {workspace.dropPresentation.status === "hovering"
                ? `Release to inspect and add ${formatDroppedItemCount(
                    workspace.dropPresentation.itemCount,
                  )}.`
                : "Adding dropped items…"}
            </strong>
            {workspace.dropPresentation.status === "importing" ? (
              <span>
                MSCanvas is inspecting dropped files and folders. The duration is not known.
              </span>
            ) : null}
          </div>
        </div>
      )}

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
              disabled={!canAcquire}
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

        {/* Its own notice, because it is its own outcome. A folder that could
            not be scanned changed nothing about the workspace, so saying "the
            workspace could not be changed" would be describing a mutation that
            never began. The retry is a fresh choice of folder rather than a
            repeat of the same one, which is the whole recovery for a link, a
            network share or a folder that has since gone. */}
        {workspace.folderError === null ? null : (
          <div className="notice notice-danger" role="status">
            <strong>The folder could not be added</strong>
            <span>{workspace.folderError.summary}</span>
            <button
              className="link-button"
              disabled={!canAddFolder}
              onClick={(event) => {
                // This retry is transient: starting it clears the notice and
                // removes the button that owns the keyboard. Hand that ownership
                // to the stable folder action before the request begins, but
                // only when there is keyboard focus to restore.
                if (document.activeElement === event.currentTarget) {
                  setRestoreAddFolderFocusToken((token) => token + 1);
                }
                workspace.addFolder();
              }}
              type="button"
            >
              Choose another folder
            </button>
            <button
              className="link-button"
              onClick={(event) => {
                // Dismissing removes this focused recovery action just as
                // starting the adjacent retry does. Carry its keyboard place
                // to the durable folder action before the notice disappears;
                // an activation that did not own keyboard focus creates no debt.
                if (document.activeElement === event.currentTarget) {
                  setRestoreAddFolderFocusToken((token) => token + 1);
                }
                workspace.dismissFolderError();
              }}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* The visible half, in the shell rather than in the roster, so a
            status that comes and goes never takes height from the list it is
            about. Not a live region of its own: the permanently mounted one
            below is what announces it, and a region that arrives with its text
            is the shape screen readers routinely miss. */}
        {workspace.folderBusy ? (
          <div className="notice notice-neutral">
            <span>Folder import in progress…</span>
          </div>
        ) : null}

        {workspace.dropRejectedToken > 0 ? (
          <div className="notice notice-warning">
            <strong>Drop not accepted</strong>
            <span>{DROP_REJECTION_STATUS[workspace.dropRejectedReason]}</span>
          </div>
        ) : null}

        {workspace.dropSubscriptionError === null ? null : (
          // Connectivity is not a failed import: Rust may still hold a valid
          // roster and the picker actions remain usable. Keep its recovery and
          // wording separate from the error for one accepted Drop below.
          <div className="notice notice-danger">
            <strong>Explorer drag-and-drop is unavailable</strong>
            <span>{workspace.dropSubscriptionError.summary}</span>
            <button
              className="link-button"
              onClick={(event) => {
                // Keyboard activation has click detail zero. A real pointer
                // press focuses the button before click, so activeElement on
                // its own would manufacture a keyboard debt for mouse users.
                if (event.detail === 0 && document.activeElement === event.currentTarget) {
                  setRestoreAddFilesFocusToken((token) => token + 1);
                }
                workspace.retryDropSubscription();
              }}
              type="button"
            >
              Try connecting again
            </button>
          </div>
        )}

        {workspace.dropError === null ? null : (
          // The permanently mounted drop live region below is the one
          // announcement. Giving this visible copy `role=status` would speak
          // the same failure twice.
          <div className="notice notice-danger">
            <strong>The dropped items could not be added</strong>
            <span>{workspace.dropError.summary}</span>
            <button
              className="link-button"
              onClick={(event) => {
                if (event.detail === 0 && document.activeElement === event.currentTarget) {
                  setRestoreAddFilesFocusToken((token) => token + 1);
                }
                workspace.dismissDropError();
              }}
              type="button"
            >
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
            {/* Refused while a mutation or an import is unresolved. Rust returns
                a pure, gate-linearized snapshot; native page-load start owns
                reload ordering. During an import the folder reply or
                reconciliation already supplies the authoritative answer,
                without another loading state whose usefulness depends on
                commit order. */}
            <button
              className="link-button"
              disabled={!canReloadRoster}
              onClick={workspace.reloadRoster}
              type="button"
            >
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
      {/* Each region is named, because there are now five of them and which one
          said a thing is the whole question a test about announcements asks.
          Reaching for "the last polite region" was a positional answer that a
          fifth region silently changed the meaning of. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="viewer">
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
      <p aria-live="polite" className="visually-hidden" data-live-region="search">
        {describeProjection(projection)}
      </p>
      <p aria-live="polite" className="visually-hidden" data-live-region="workspace">
        {workspace.workspaceNotice === null ? "" : announceNotice(workspace.workspaceNotice)}
      </p>
      {/* A folder import is the one workspace action long enough that a user
          can wonder whether anything is happening, and the only one whose end
          they may be waiting for before doing something else.

          One sentence for the whole operation, and deliberately one that is
          true at both ends of it. The flag is set before the native dialog
          opens, because the operation begins there -- but at that moment no
          folder has been chosen, and saying one is being scanned would be false
          for as long as the user spends navigating, and false altogether if
          they cancel. Telling the two phases apart would need the picker to
          report closing, which is an event protocol this milestone does not
          add; saying something true of both needs nothing. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="folder">
        {workspace.folderBusy ? FOLDER_IMPORT_STATUS : ""}
      </p>
      <p aria-live="polite" className="visually-hidden" data-live-region="drop">
        {announceDrop(workspace)}
      </p>
      {/* Named like the four above it and mounted for the life of the
          application for the same reason: what a reader must notice is a change
          inside a region, not a region arriving with its text. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="conversion">
        {announceConversion(workspace)}
      </p>

      <main className="workspace-layout">
        <aside className="workspace-sidebar">
          <DatasetRoster
            canAddFiles={canAcquire}
            canAddFolder={canAddFolder}
            canMutate={canClear}
            canPreview={canPreview}
            canReloadRoster={canReloadRoster}
            dispatch={workspace.dispatchRoster}
            focusAddFilesToken={workspace.focusAddFilesToken}
            dropBusy={workspace.dropBusy}
            folderBusy={workspace.folderBusy}
            load={workspace.rosterLoad}
            onActivate={workspace.activateDataset}
            onAddFiles={workspace.addFiles}
            onAddFolder={workspace.addFolder}
            canRemove={canRemove}
            onClearList={workspace.clearList}
            onReloadRoster={workspace.reloadRoster}
            onRemoveSelected={workspace.removeSelected}
            projection={projection}
            restoreAddFilesFocusToken={restoreAddFilesFocusToken}
            restoreAddFolderFocusToken={restoreAddFolderFocusToken}
            rosterSettlementToken={workspace.rosterSettlementToken}
            state={roster}
          />
          <ConversionPanel
            canConvert={canConvert}
            conversion={workspace.conversion}
            excludedSelectedCount={excludedSelectedCount}
            handles={queueHandlesToConvert}
            scope={selectedConvertible.length > 0 ? "selection" : "focused"}
          />
          {preview.status === "loaded" ? (
            <PreviewSummary
              file={previewFile ?? preview.preview.file}
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
            <SelectedSpectrumPanel
              exportState={workspace.spectrumExport}
              figureSettings={workspace.figureSettings}
              onCopyPlot={workspace.copySpectrumPlot}
              onDismissExport={workspace.dismissSpectrumExport}
              onExport={workspace.exportSpectrum}
              onFigureSetting={workspace.setFigureSetting}
              onFigureTheme={workspace.setFigureTheme}
              onRetry={workspace.retrySpectrum}
              pngDpiProblem={workspace.pngDpiProblem}
              renderSettingsProblem={workspace.renderSettingsProblem}
              state={spectrum}
            />
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
                  <span>
                    Use Add files… in the workspace list to choose one or several, or Add mzML
                    folder… to take every .mzML file under one folder.
                  </span>
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
                        Preview {formatDatasetLabel(workspace.activeDataset)}
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

/**
 * What each refusal says. Exhaustive over the reasons, so one added to the
 * boundary fails compilation here rather than being dropped in silence.
 */
const DROP_REJECTION_STATUS: Readonly<Record<WorkspaceDropRejectionReason, string>> = {
  drop_busy: DROP_BUSY_STATUS,
  conversion_busy:
    "MSCanvas is converting an acquisition, so those files were not added. Try again once the conversion has finished.",
};

/**
 * What a reader is told about the conversion queue.
 *
 * One sentence per state and nothing while idle, so an empty region stays empty
 * rather than announcing that nothing is happening. Nothing here is a
 * percentage: nothing measures one.
 */
function announceConversion(workspace: ReturnType<typeof usePreviewWorkspace>): string {
  const state = workspace.conversion.state;
  if (state.status === "idle") {
    return "";
  }
  const { queue } = state;
  // Said as soon as the retry is dispatched. Rust answers once, when the whole
  // rerun is over, so a region that waited for it would repeat the finished
  // counts back at a screen-reader user who had just pressed Retry, and stay
  // silent for as long as the rerun took.
  if (workspace.conversion.retrying && state.status === "terminal") {
    return `Retrying ${String(queue.retryableFailedCount)} failed.`;
  }
  if (state.status === "awaitingDestination") {
    return "Choose where to save the converted mzML.";
  }
  // Before the running branch, and read from the operation rather than only
  // from the slot, so it is said the moment this document asks rather than on
  // whichever poll first sees Rust agree. One sentence for the whole of that
  // window: a repeated poll produces the same string and is not announced
  // again.
  if (
    state.status === "stopping" ||
    (workspace.conversion.stopping && state.status === "running")
  ) {
    return "Stopping queue. No further items will start.";
  }
  if (state.status === "running") {
    // The item that says it is running, which is the same row the roster pins.
    // Deriving one of them from the position and the other from the state would
    // let the sentence name one acquisition while the list marked another.
    const position = queue.items.findIndex((item) => item.state === "running");
    const current = position === -1 ? undefined : queue.items[position];
    // Named rather than counted alone, so a repeated poll that finds the same
    // item says the same sentence and is not announced twice.
    return current === undefined
      ? `Converting ${String(queue.itemCount)} acquisitions.`
      : `Converting item ${String(position + 1)} of ${String(queue.itemCount)}, ${current.fileName}.`;
  }
  if (state.status === "terminal" && state.reason === "stopFailed") {
    // Not "Queue stopped" either. The one thing this state does not establish
    // is that the queue's converter stopped.
    return `Stop could not be confirmed. MSCanvas could not confirm that the backend process stopped.${
      workspace.conversion.backendQuarantined
        ? " Restart MSCanvas before starting another preview or conversion."
        : ""
    }${queue.error === null ? "" : ` ${queue.error.summary}`}`;
  }
  if (state.status === "terminal" && state.reason === "stopped") {
    // The refusal that ended it, where there was one, said alongside rather
    // than instead of the counts. The visible panel shows both, and a region
    // that dropped one of them would describe a different queue.
    return `Queue stopped. ${String(queue.finalizedCount)} converted, ${String(queue.skippedCount)} skipped, ${String(queue.failedCount)} failed, ${String(queue.cancelledCount)} cancelled, ${String(queue.notRunCount)} not run.${
      queue.error === null ? "" : ` ${queue.error.summary}`
    }`;
  }
  if (queue.error !== null) {
    return queue.error.summary;
  }
  // The same condition the visible panel applies, because it is the same claim.
  // A queue whose items were all skipped judged nothing, and a skipped item's
  // existing file was explicitly not inspected.
  const judged = queue.items.some(conversionJudgedAnyOutput);
  return `${String(queue.finalizedCount)} converted, ${String(queue.skippedCount)} skipped, ${String(queue.failedCount)} failed.${
    judged ? " Output-only validation." : ""
  }`;
}

function announceDrop(workspace: ReturnType<typeof usePreviewWorkspace>): string {
  if (workspace.dropSubscriptionStatus === "unavailable") {
    return `Explorer drag-and-drop is unavailable. ${workspace.dropSubscriptionError?.summary ?? "Use the Add actions below."}`;
  }
  if (workspace.dropSubscriptionStatus === "connecting") {
    return "Connecting Explorer drag-and-drop.";
  }
  if (workspace.dropRejectedToken > 0) {
    return `${DROP_REJECTION_STATUS[workspace.dropRejectedReason]}${
      workspace.dropRejectedToken % 2 === 1 ? "\u00a0" : ""
    }`;
  }
  if (workspace.dropError !== null) {
    return `The dropped items could not be added. ${workspace.dropError.summary}`;
  }
  switch (workspace.dropPresentation.status) {
    case "idle":
      return "";
    case "hovering":
      return `Release to inspect and add ${formatDroppedItemCount(
        workspace.dropPresentation.itemCount,
      )}.`;
    case "importing":
      return DROP_IMPORT_STATUS;
  }
}

function formatDroppedItemCount(itemCount: number): string {
  return `${formatCount(itemCount)} dropped ${itemCount === 1 ? "item" : "items"}`;
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
