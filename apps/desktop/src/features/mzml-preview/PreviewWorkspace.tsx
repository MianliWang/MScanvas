import { announceConversion } from "./conversionMessages";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatWorkspaceNotice } from "../workbench/workspaceMessages";
import type { UiMessage } from "../preferences/i18n";
import { ProjectPanel } from "../project/ProjectPanel";
import { ProvenanceDetails } from "../project/ProvenanceDetails";
import { useProject } from "../project/useProject";
import { WorkbenchHeader, type WorkbenchSurface } from "../workbench/WorkbenchHeader";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";

import { ActiveClearDialog } from "./ActiveClearDialog";
import type { ActiveClearFocusReturn } from "./activeClearFocusReturn";
import { BackendStatus } from "./BackendStatus";
import { Chromatogram } from "./Chromatogram";
import { ChromatogramExportPanel, ChromatogramExportResult, LinkedFigureResult } from "./ChromatogramExportPanel";
import { resolveConversionScope } from "./conversionScope";
import { ConversionPanel } from "./ConversionPanel";
import { DatasetRoster } from "./DatasetRoster";
import { PreviewSummary } from "./PreviewSummary";
import { SelectedSpectrumPanel, describeSpectrumExport } from "./SelectedSpectrumPanel";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";
import { ExportFigureDialog } from "./ExportFigureDialog";
import { QuickFigureActions } from "./QuickFigureActions";
import type { FigurePreviewKind } from "./contracts";
import { SpectrumTable } from "./SpectrumTable";
import { SPECTRUM_SELECTION_NOTICE_ID } from "./viewer/selectionAvailability";
import { spectrumSelectionMessage } from "./viewer/selectionMessages";
import { formatCount, formatDatasetLabel } from "./format";
import { rosterProjection, type WorkspaceNotice } from "./rosterSelection";
import { reconcileOrganization } from "../workbench/organization";
import type { WorkspaceAddResult } from "./contracts";
import { usePreviewWorkspace } from "./usePreviewWorkspace";

/** The session workspace: a curated roster of mzML files, and one open preview. */
export function PreviewWorkspace() {
  const workspace = usePreviewWorkspace();
  const [activeClear, setActiveClear] = useState<{ returnTo: HTMLElement | null } | null>(null);
  const [figureDialog, setFigureDialog] = useState<{ kind: FigurePreviewKind; returnTo: HTMLElement | null } | null>(null);
  const openFigure = (kind: FigurePreviewKind) => setFigureDialog({ kind, returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  const t = useUiMessages();
  const notice = workspace.workspaceNotice === null ? null : formatWorkspaceNotice(workspace.workspaceNotice, t);
  const [surface, setSurface] = useState<WorkbenchSurface>("workbench");
  /** The contextual region, so focus can follow a request to reveal it. */
  const inspectorRef = useRef<HTMLElement | null>(null);
  const pendingInspectorFocus = useRef(false);
  // The panels are owned by the preference provider, which is the one place
  // that knows both what the user asked for and what the window can fit. What
  // is left here is the session fact the provider has no business knowing:
  // whether the inspector currently has anything to inspect.
  const { panels } = useSessionPreferences();
  const constrained = panels.fit.constrained;
  const rosterOpen = panels.present.roster;
  /**
   * The roster row a reveal is waiting to put the keyboard on.
   *
   * A token rather than a boolean, because revealing the same row twice is
   * two reveals: a reader who pressed `Show in Workbench`, wandered off and
   * pressed it again asked for the same thing a second time.
   */
  const [revealRow, setRevealRow] = useState<{ handle: string; token: number } | null>(null);
  const revealToken = useRef(0);
  /**
   * Takes the reader to one roster row.
   *
   * Navigation and nothing else. No request is sent, no file is read and no
   * backend is touched -- everything this needs is already on the page, which
   * is what keeps showing a row usable on a machine with no converter.
   *
   * The roster is opened where it is not on screen, through the same control
   * the header owns rather than a layout of this function's own. `navigate`
   * would be the wrong verb here: it folds the side panels away to give a
   * surface the column, and the row *is* the destination.
   */
  const revealInWorkbench = useCallback(
    (handle: string) => {
      setSurface("workbench");
      // A row the list is not showing cannot be revealed, and a reveal that
      // reveals nothing is worse than no reveal. There are two reasons a row
      // is not on screen and the reducer treats neither as a press it can
      // act on, so both are cleared before the row is pressed.
      //
      // The search first. Deliberate, and only where it is needed: a row the
      // query already shows keeps the reader's query exactly as they left it.
      // A row that has just arrived is never in the projection this render
      // was drawn from, so an add with a query set always clears it -- which
      // is the right answer, because the row is the thing they asked to see.
      if (!rosterProjection(workspace.roster).handles.has(handle)) {
        workspace.dispatchRoster({ type: "searchCleared" });
      }
      // Then the group. A collapsed group drops its rows from the projection
      // entirely, and the default destination for every new row is a group
      // that can be collapsed -- so without this, revealing into one is a
      // navigation that lands on nothing. The handle is named to the
      // reconciliation as well, because a row that has just arrived is not in
      // the organization this render was drawn from and belongs to the
      // ungrouped group until it is.
      const holding = reconcileOrganization(workspace.roster.organization, [
        ...workspace.roster.datasets.map((dataset) => dataset.handle),
        handle,
      ]).groups.find((group) => group.handles.includes(handle));
      if (holding?.collapsed === true) {
        // `disclose` toggles, so this is asked only of a group that is closed.
        workspace.dispatchRoster({
          type: "organization",
          action: { type: "disclose", groupId: holding.id },
        });
      }
      // The same thing pressing the row does: it becomes the focused row and
      // the highlighted one. It starts no read -- that is the component's
      // separate response to a press, not the reducer's.
      workspace.dispatchRoster({
        type: "rowPressed",
        handle,
        modifiers: { ctrl: false, shift: false },
      });
      revealToken.current += 1;
      setRevealRow({ handle, token: revealToken.current });
      if (!rosterOpen && !panels.busy) panels.toggle("roster");
    },
    [panels, rosterOpen, workspace],
  );
  // Held at the shell so the project outlives navigating away from its surface.
  // Rust is authoritative either way; this only keeps the page from re-reading
  // the whole project every time the user looks at something else.
  const project = useProject(
    useCallback(
      (result: WorkspaceAddResult | null) => {
        // `null` is an operation that failed *after* Rust may have admitted
        // the row: the project can decline to claim a row the workspace
        // legitimately added, and the answer carrying that roster never
        // arrives. Rust is authoritative about what the session holds, so the
        // roster is re-read rather than left describing a workspace that has
        // moved on without this page.
        if (result === null) {
          workspace.reconcileAfterFailedWorkspaceMutation();
          return;
        }
        const landed = workspace.admitProjectInput(result);
        // Nothing was admitted -- an unsupported file, a full workspace. The
        // notice above the surfaces says which, where the reader already is,
        // and sending them to a list with nothing new in it would be the
        // wrong answer to a refusal.
        if (landed !== null) revealInWorkbench(landed);
      },
      [revealInWorkbench, workspace],
    ),
  );
  /** Every row the workspace currently holds, for the Project surface. */
  const liveDatasetHandles = useMemo(
    () => new Set(workspace.roster.datasets.map((dataset) => dataset.handle)),
    [workspace.roster.datasets],
  );
  const { preview, roster, spectrum, recordMeasurement, completeRenderMeasurements } = workspace;
  /**
   * Whether the contextual region has anything to describe *on this surface*.
   *
   * It was a loaded acquisition and nothing else, which left the Details
   * control disabled on the Project surface -- where the region is exactly
   * where provenance belongs. Availability is a property of the surface the
   * user is on, so each surface answers for itself. Deliberately not a
   * registry: there are two surfaces with contextual detail and this is what
   * they are.
   */
  const detailsAvailable =
    surface === "project" ? project.inspecting !== null : preview.status === "loaded";
  // The request is the preference; availability is not. A details panel asked
  // for while nothing is loaded stays asked for, and appears the moment a run
  // does -- it never becomes authority to load one.
  const detailsOpen = panels.present.details && detailsAvailable;
  const evidenceRef = useRef<HTMLElement | null>(null);
  const pendingRevealFocus = useRef(false);
  useLayoutEffect(() => {
    if (pendingRevealFocus.current && surface === "workbench" && !rosterOpen && !detailsOpen) {
      pendingRevealFocus.current = false;
      evidenceRef.current?.focus({ preventScroll: true });
    }
  }, [surface, rosterOpen, detailsOpen]);
  /**
   * Whether the chromatogram's export surface is open.
   *
   * Closed to begin with, and the control that opens it sits in the panel's
   * existing header row: the three-panel column's floors are measured, and a
   * disclosure that added a row to the body would push a control out of a panel
   * that clips. Local to this component -- it is a preference about what is on
   * screen, not a fact about the run.
   */
  const [chromatogramExportOpen, setChromatogramExportOpen] = useState(false);
  const [restoreAddFolderFocusToken, setRestoreAddFolderFocusToken] = useState(0);
  const [restoreAddFilesFocusToken, setRestoreAddFilesFocusToken] = useState(0);
  const [activeClearFocusReturn, setActiveClearFocusReturn] = useState<ActiveClearFocusReturn | null>(null);
  const focusReturnOwnerLive = useRef(true);
  useEffect(() => { focusReturnOwnerLive.current = true; return () => { focusReturnOwnerLive.current = false; }; }, []);
  useEffect(() => () => activeClearFocusReturn?.release(), [activeClearFocusReturn]);

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
    // The other half of the rule the Project surface follows. A reattachment
    // in flight is a workspace change like any other -- it hashes a whole
    // acquisition and then enters the same admission gate -- and Rust
    // supersedes whatever reached that gate later. Without this the wait is
    // one-directional: the project action waits for an import, and an import
    // started during a project action discards itself.
    project.busy !== "admitting" &&
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
  // Active Clear opens an authoritative confirmation. Rust protects the whole
  // bound queue and only releases captured rows after the selected operation.
  const canClear = canMutate && !workspace.conversion.adopting;
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
  // There is deliberately no `canConvert` here any more. Converting had an
  // expression of its own on this line, strictly wider than the guard the
  // operation applied, and the panel's `Retry` answered to it as well -- three
  // readings of one question. The conversion lane now carries every fact that
  // decides it, and each control projects its own decision from that lane; see
  // `conversionAvailability.ts`.

  const resolvedScope = useMemo(
    () => resolveConversionScope(workspace.conversionScope, roster),
    [workspace.conversionScope, roster.datasets, roster.conversionMembership, roster.sort],
  );

  const { describe: describeConversion } = workspace.conversionPlan;
  // Only resolved question content triggers a description. The layout effect
  // installs it before paint; roster/scope setters already withdraw an old
  // executable review synchronously, before this render can happen.
  const describeKey = JSON.stringify([resolvedScope.scope, resolvedScope.handles]);
  useLayoutEffect(() => {
    describeConversion(resolvedScope.handles, resolvedScope.scope);
  }, [describeConversion, describeKey]);

  const handleTableRendered = useCallback(
    (renderedRowCount: number, milliseconds: number) => {
      recordMeasurement(
        "spectrumTableRender",
        milliseconds,
        // Which sentence and its parameter, not the sentence: the inspector
        // that renders this tooltip is the surface with a locale.
        { key: "measureTableDetail", rows: formatCount(renderedRowCount) },
      );
    },
    [recordMeasurement],
  );

  return (
    <div className="app-shell workbench-shell" data-surface={surface} data-roster-open={rosterOpen} data-details-open={detailsOpen} data-settings-return-target="" tabIndex={-1}>
      <WorkbenchHeader surface={surface} onNavigate={setSurface}
        detailsAvailable={detailsAvailable} rowCount={roster.datasets.length}
        busy={workspace.conversion.busy}
        retained={workspace.conversion.state.status === "terminal"} dropStatus={workspace.dropSubscriptionStatus} />

      {workspace.dropPresentation.status === "idle" ? null : (
        <div
          aria-hidden="true"
          className={`workspace-drop-overlay workspace-drop-overlay-${workspace.dropPresentation.status}`}
          data-drop-overlay={workspace.dropPresentation.status}
        >
          <div className="workspace-drop-overlay-card">
            <strong>
              {workspace.dropPresentation.status === "hovering"
                ? t("dropRelease", { count: workspace.dropPresentation.itemCount })
                : t("dropAdding")}
            </strong>
            {workspace.dropPresentation.status === "importing" ? (
              <span>
                {t("dropInspecting")}
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
          readingSuperseded={workspace.backendReadingStale}
          state={workspace.backend}
        />

        {/* A picker that would not open is its own problem. It never replaces
            what is already on screen, which is still open and still usable. */}
        {workspace.pickerError === null ? null : (
          <div className="notice notice-danger" role="status">
            <strong>{t("pickerFailed")}</strong>
            <span>{ownedErrorMessage(workspace.pickerError, t)}</span>
            {/* The same action as `Add files…`, so it is refused in the same
                states. An enabled control that returns at a guard tells the
                user their retry failed again. */}
            <button
              className="link-button"
              disabled={!canAcquire}
              onClick={workspace.addFiles}
              type="button"
            >
              {t("retryFiles")}
            </button>
            <button className="link-button" onClick={workspace.dismissPickerError} type="button">
              {t("dismiss")}
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
            <strong>{t("folderFailed")}</strong>
            <span>{ownedErrorMessage(workspace.folderError, t)}</span>
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
              {t("chooseAnotherFolder")}
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
              {t("dismiss")}
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
            <span>{t("folderBusy")}</span>
          </div>
        ) : null}

        {workspace.dropRejectedToken > 0 ? (
          <div className="notice notice-warning">
            <strong>{t("dropRejected")}</strong>
            <span>{t(workspace.dropRejectedReason === "drop_busy" ? "dropBusy" : "dropConversionBusy")}</span>
          </div>
        ) : null}

        {workspace.dropSubscriptionError === null ? null : (
          // Connectivity is not a failed import: Rust may still hold a valid
          // roster and the picker actions remain usable. Keep its recovery and
          // wording separate from the error for one accepted Drop below.
          <div className="notice notice-danger">
            <strong>{t("dropUnavailable")}</strong>
            <span>{ownedErrorMessage(workspace.dropSubscriptionError, t)}</span>
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
              {t("dropReconnect")}
            </button>
          </div>
        )}

        {workspace.dropError === null ? null : (
          // The permanently mounted drop live region below is the one
          // announcement. Giving this visible copy `role=status` would speak
          // the same failure twice.
          <div className="notice notice-danger">
            <strong>{t("dropFailed")}</strong>
            <span>{ownedErrorMessage(workspace.dropError, t)}</span>
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
              {t("dismiss")}
            </button>
          </div>
        )}

        {workspace.workspaceError === null ? null : (
          <div className="notice notice-danger" role="status">
            <strong>{t("workspaceFailed")}</strong>
            <span>{ownedErrorMessage(workspace.workspaceError, t)}</span>
            <button className="link-button" onClick={workspace.dismissWorkspaceError} type="button">
              {t("dismiss")}
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
        {notice === null ? null : (
          <div
            className={
              notice.tone === "warning"
                ? "notice notice-warning"
                : "notice notice-neutral"
            }
          >
            <span>{notice.message}</span>
            {notice.details.length === 0 ? null : (
              <ul className="workspace-notice-details">
                {/* Keyed by position as well as by text: two names for one
                    acquisition produce the same sentence, and Rust reports one
                    outcome per file the user chose rather than one per row. */}
                {notice.details.map((detail, index) => (
                  <li key={`${String(index)}-${detail}`}>{detail}</li>
                ))}
                {notice.more === 0 ? null : (
                  <li key="more">
                    {t("moreNotListed", { count: notice.more })}
                  </li>
                )}
              </ul>
            )}
            <button className="link-button" onClick={workspace.dismissWorkspaceNotice} type="button">
              {t("dismiss")}
            </button>
          </div>
        )}

        {workspace.rosterLoad.status === "failed" && roster.datasets.length > 0 ? (
          <div className="notice notice-danger" role="status">
            <strong>{t("rosterFailed")}</strong>
            <span>{ownedErrorMessage(workspace.rosterLoad.error, t)}</span>
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
              {t("rosterRetry")}
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
        {announce(workspace, t)}
      </p>
      {/* One expression, so the region holds one text node whose string
          changes. Two children would leave the sentence node untouched when
          the sentence repeats, and React would add or remove the second node
          instead -- a change this region's default `aria-relevant` does not
          announce in one direction and CSS collapses away in the other. */}
      {/* What the search found, which is otherwise announced nowhere: the list
          simply becomes shorter, and neither of the other two regions says a
          word about it. Report visible/total context only after authoritative
          capacity arrives; the initial unknown sentinel is not a real limit.

          No alternating character here, unlike the account below. Two searches
          that happen to find the same number of files are not two events worth
          repeating — and the sort has no sentence at all, because a native
          select announces its own value and a second voice saying the same
          thing is noise rather than access. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="search">
        {roster.capacity === 0 ? "" : t("rosterContext", { visible: projection.datasets.length, total: roster.datasets.length, capacity: roster.capacity })}
      </p>
      <p aria-live="polite" className="visually-hidden" data-live-region="workspace">
        {workspace.workspaceNotice === null ? "" : announceNotice(workspace.workspaceNotice, t)}
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
        {workspace.folderBusy ? t("folderImportStatus") : ""}
      </p>
      <p aria-live="polite" className="visually-hidden" data-live-region="drop">
        {announceDrop(workspace, t)}
      </p>
      {/* Named like the four above it and mounted for the life of the
          application for the same reason: what a reader must notice is a change
          inside a region, not a region arriving with its text. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="conversion">
        {announceConversion(workspace.conversion, t)}
      </p>

      {activeClear !== null ? <ActiveClearDialog returnTo={activeClear.returnTo} onClose={() => setActiveClear(null)} onEmptyRosterClosed={claim => {
        if (focusReturnOwnerLive.current) setActiveClearFocusReturn(claim); else claim.release();
      }} onExecute={workspace.executeActiveClear} /> : null}
      {figureDialog !== null ? <ExportFigureDialog
        kind={figureDialog.kind}
        sourceLabel={`${previewFile?.fileName ?? (preview.status === "loaded" ? preview.preview.file.fileName : t("viewerSpectrumNone"))} · ${figureDialog.kind === "chromatogram" ? t("viewerChromatogram") : spectrum.status === "loaded" ? t("viewerSpectrumIndex", { index: String(spectrum.spectrum.index) }) : t("viewerSpectrumNone")}`}
        question={workspace.figurePreviewQuestion(figureDialog.kind)} preview={workspace.previewFigure} onExport={workspace.exportPreviewedFigure}
        onCopy={workspace.copyPreviewedFigure}
        returnTo={figureDialog.returnTo} onClose={() => setFigureDialog(null)} busy={workspace.scientificExportBusy}
        settings={workspace.figureSettings} validation={workspace.figureSettingsValidation} onSetting={workspace.setFigureSetting} onTheme={workspace.setFigureTheme}
        scope={figureDialog.kind === "spectrum" ? workspace.spectrumRangeScope : workspace.chromatogramRangeScope}
        currentAvailable={figureDialog.kind !== "spectrum" || workspace.spectrumRangeAvailability === "available"}
        onScope={figureDialog.kind === "spectrum" ? workspace.setSpectrumRangeScope : workspace.setChromatogramRangeScope}
        scopeHelp={figureDialog.kind === "spectrum" ? workspace.spectrumCommittedDomain === null ? t("viewerExportFullHelp") : t("viewerExportRangeHelp", { low: String(workspace.spectrumCommittedDomain.low), high: String(workspace.spectrumCommittedDomain.high) }) : workspace.chromatogramCommittedDomain === null ? t("viewerExportFullRunHelp") : t("viewerExportRtHelp", { low: String(workspace.chromatogramCommittedDomain.low), high: String(workspace.chromatogramCommittedDomain.high) })}
        result={figureDialog.kind === "spectrum" ? <p role="status">{describeSpectrumExport(workspace.spectrumExport, t)}{workspace.spectrumExport.status === "failed" ? <span className="notice-detail">{ownedErrorDetail(workspace.spectrumExport.error, t)}</span> : null}</p> : figureDialog.kind === "chromatogram" ? <div role="status"><ChromatogramExportResult state={workspace.chromatogramExport} onDismiss={workspace.dismissChromatogramExport} /></div> : <div role="status"><LinkedFigureResult state={workspace.linkedFigureExport} onDismiss={workspace.dismissLinkedFigureExport} /></div>}
      /> : null}
      <main className="workspace-layout">
        <aside id="workbench-roster" className="workspace-sidebar" hidden={!rosterOpen}>
          <DatasetRoster
            activeClearFocusReturn={activeClearFocusReturn}
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
            onActivate={handle => {
              if (!workspace.activateDataset(handle)) return;
              pendingRevealFocus.current = constrained && rosterOpen;
              setSurface("workbench");
              // Folded for space, not chosen: the stored request is untouched,
              // so widening the window brings the roster back.
              panels.navigate();
            }}
            onAddFiles={workspace.addFiles}
            onAddFolder={workspace.addFolder}
            canRemove={canRemove}
            onClearList={() => {
              if (!workspace.conversion.busy) return workspace.clearList();
              setActiveClear({ returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null });
              return true;
            }}
            onReloadRoster={workspace.reloadRoster}
            onRemoveSelected={workspace.removeSelected}
            projection={projection}
            revealRow={revealRow}
            restoreAddFilesFocusToken={restoreAddFilesFocusToken}
            restoreAddFolderFocusToken={restoreAddFolderFocusToken}
            rosterSettlementToken={workspace.rosterSettlementToken}
            state={roster}
          />

        </aside>

        {/* The project surface. Deliberately its own region rather than a
            corner of the workbench: a project references files, the roster
            admits them, and the two collections are not the same list. It needs
            no provider, so it is reachable on a machine with no converter
            installed. */}
        <section id="workbench-project" className="workbench-project" hidden={surface !== "project" || (constrained && (rosterOpen || detailsOpen))} aria-label={t("projectSurface")}>
          <ProjectPanel
            session={project}
            liveDatasetHandles={liveDatasetHandles}
            onShowInWorkbench={revealInWorkbench}
            workspaceBusy={
              workspace.pickerBusy ||
              workspace.folderBusy ||
              workspace.dropBusy ||
              workspace.workspaceBusy
            }
            detailsPresent={detailsOpen}
            onRevealDetails={() => {
              if (panels.busy) return;
              // The control that reveals the region is inside the project
              // surface, and in one column that surface is hidden the moment
              // the region appears -- so the button that was just pressed
              // unmounts and the keyboard would be left on the body. Focus
              // follows to the region it asked for.
              pendingInspectorFocus.current = true;
              panels.toggle("details");
            }}
          />
        </section>
        <section id="workbench-conversion" className="workbench-conversion" hidden={surface !== "conversion" || (constrained && (rosterOpen || detailsOpen))} aria-label={t("conversionTask")}>
          <ConversionPanel
            configuration={workspace.conversionConfiguration}
            conversion={workspace.conversion}
            plan={workspace.conversionPlan}
            resolvedScope={resolvedScope}
            onScopeChange={workspace.setConversionScope}
          />
        </section>
        <aside id="workbench-inspector" ref={inspectorRef} tabIndex={-1} className="workbench-inspector" hidden={!detailsOpen} aria-label={t("inspectorToggle")}>
          {/* One region, whichever surface is asking. The Project surface puts
              provenance here rather than adding a navigation target of its own,
              which is where the accepted direction puts contextual metadata. */}
          {surface === "project" ? (
            <ProvenanceDetails
              provenance={project.provenance}
              onSelect={project.inspect}
              liveDatasetHandles={liveDatasetHandles}
              onShowInWorkbench={revealInWorkbench}
            />
          ) : preview.status === "loaded" ? (
            <PreviewSummary
              file={previewFile ?? preview.preview.file}
              measurements={workspace.measurements}
              metadata={preview.preview.metadata}
              runSummary={preview.preview.runSummary}
              spectrumListTotal={preview.preview.spectrumTable.totalRowCount}
            />
          ) : null}        </aside>
        <section id="workbench-evidence" ref={evidenceRef} tabIndex={-1} className="workbench-evidence" hidden={surface !== "workbench" || (constrained && (rosterOpen || detailsOpen))} aria-label={t("workbench")}>

        {preview.status === "loaded" ? (
          <div className="viewer-column">
            {/*
              One explanation for both committing surfaces, and one occurrence
              of it in the accessibility tree. Always mounted so that the
              announcement is watched before the text arrives, and empty --
              collapsed by `:empty` -- while a scan can be selected, because a
              working control with a sentence under it is a reason to doubt it.
            */}
            <p
              aria-live="polite"
              className="notice notice-warning viewer-selection-notice"
              data-live-region="spectrum-selection-availability"
              /*
               * The id only while there is something to point at. The element
               * is permanent so that it is watched before the text arrives; a
               * described-by target with no text is a promise of an
               * explanation that is not there.
               */
              id={
                workspace.spectrumSelection.status === "unavailable"
                  ? SPECTRUM_SELECTION_NOTICE_ID
                  : undefined
              }
            >
              {workspace.spectrumSelection.status === "unavailable"
                ? spectrumSelectionMessage(workspace.spectrumSelection.reason, t)
                : ""}
            </p>
            <div className="viewer-stack">
              <Chromatogram
                dispatch={workspace.dispatchViewerEvent}
                exportPanel={
                  chromatogramExportOpen && workspace.chromatogramExportToken !== null ? (
                    <ChromatogramExportPanel
                      onOpenLinkedFigure={() => openFigure("linked")}
                      committedDomain={workspace.chromatogramCommittedDomain}
                      exportState={workspace.chromatogramExport}
                      figureSettings={workspace.figureSettings}
                      figureSettingsValidation={workspace.figureSettingsValidation}
                      linkedExportState={workspace.linkedFigureExport}
                      linkedUnavailable={workspace.linkedFigureUnavailable}
                      onCopyLinkedPlot={workspace.copyLinkedPlot}
                      onCopyPlot={workspace.copyChromatogramPlot}
                      onDismiss={workspace.dismissChromatogramExport}
                      onDismissLinked={workspace.dismissLinkedFigureExport}
                      onExport={workspace.exportChromatogram}
                      onExportLinked={workspace.exportLinkedFigure}
                      onFigureSetting={workspace.setFigureSetting}
                      onFigureTheme={workspace.setFigureTheme}
                      onRangeScope={workspace.setChromatogramRangeScope}
                      pngDpiProblem={workspace.pngDpiProblem}
                      rangeScope={workspace.chromatogramRangeScope}
                      renderSettingsProblem={workspace.renderSettingsProblem}
                      scientificExportBusy={workspace.scientificExportBusy}
                      traces={workspace.chromatogramTraces}
                    />
                  ) : null
                }
                exportToggle={
                  workspace.chromatogramExportToken === null ? null : (
                    <div className="figure-quick-actions"><QuickFigureActions busy={workspace.scientificExportBusy} quickVisible={!chromatogramExportOpen}
                      context={`${t("viewerChromatogram")} · ${t(workspace.chromatogramRangeScope === "current" ? "viewerExportCurrent" : "viewerExportFullRun")} · ${workspace.figureSettings.widthPx || "—"} × ${workspace.figureSettings.heightPx || "—"} px`}
                      figureUnavailable={workspace.renderSettingsProblem !== null || (!workspace.chromatogramTraces.tic && !workspace.chromatogramTraces.bpc)}
                      pngUnavailable={workspace.pngDpiProblem !== null} onPreview={() => openFigure("chromatogram")}
                      onPng={() => workspace.exportChromatogram("png")} onCopy={workspace.copyChromatogramPlot} />
                    <button
                      aria-controls="chromatogram-export-panel"
                      aria-expanded={chromatogramExportOpen}
                      className="secondary-button"
                      id="chromatogram-export-toggle"
                      onClick={() => {
                        setChromatogramExportOpen((open) => !open);
                      }}
                      type="button"
                    >
                      {t("viewerExport")}
                    </button></div>
                  )
                }
                interaction={workspace.viewerInteraction}
                model={workspace.scanModel}
                onSelect={workspace.selectSpectrum}
                onToggleTrace={workspace.toggleChromatogramTrace}
                readInteraction={workspace.readViewerInteraction}
                selectionAvailability={workspace.spectrumSelection}
                traces={workspace.chromatogramTraces}
              />
              <SelectedSpectrumPanel
                onOpenFigure={() => openFigure("spectrum")}
                committedDomain={workspace.spectrumCommittedDomain}
                dispatchViewport={workspace.dispatchSpectrumViewportEvent}
                exportState={workspace.spectrumExport}
                figureSettings={workspace.figureSettings}
                figureSettingsValidation={workspace.figureSettingsValidation}
                onCopyPlot={workspace.copySpectrumPlot}
                onDismissExport={workspace.dismissSpectrumExport}
                onExport={workspace.exportSpectrum}
                onFigureSetting={workspace.setFigureSetting}
                onFigureTheme={workspace.setFigureTheme}
                onRangeScope={workspace.setSpectrumRangeScope}
                onRetry={workspace.retrySpectrum}
                onRetryProjection={workspace.retrySpectrumProjection}
                pngDpiProblem={workspace.pngDpiProblem}
                rangeAvailability={workspace.spectrumRangeAvailability}
                rangeScope={workspace.spectrumRangeScope}
                projectionError={workspace.spectrumProjectionError}
                readViewport={workspace.readSpectrumViewport}
                renderSettingsProblem={workspace.renderSettingsProblem}
                scientificExportBusy={workspace.scientificExportBusy}
                state={spectrum}
                viewport={workspace.spectrumViewport}
              />
              <SpectrumTable
                view={workspace.scanTableView}
                canSelectNext={workspace.canSelectNextScan}
                canSelectPrevious={workspace.canSelectPreviousScan}
                onRendered={handleTableRendered}
                onSelect={workspace.selectSpectrum}
                onSelectNext={workspace.selectNextScan}
                onSelectPrevious={workspace.selectPreviousScan}
                selection={workspace.viewerInteraction.selection}
                selectionAvailability={workspace.spectrumSelection}
                table={preview.preview.spectrumTable}
              />
            </div>
          </div>
        ) : (
          <section className="panel workspace-placeholder">
            {preview.status === "opening" ? (
              <div className="empty-state">
                <strong>{t("readingEvidence")}</strong>
                <span>
                  {t("readingEvidenceHelp")}
                </span>
              </div>
            ) : preview.status === "failed" ? (
              <div className="empty-state">
                <strong>{ownedErrorMessage(preview.error, t)}</strong>
                {ownedErrorDetail(preview.error, t) === null ? null : <span>{ownedErrorDetail(preview.error, t)}</span>}
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
                      {t("retryEvidence")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <strong>{t("emptyEvidence")}</strong>
                <span>{backendUnavailable ? t("previewBackendRequired") : t("emptyEvidenceHelp")}</span>
                {workspace.activeDataset !== null ? <button type="button" className="secondary-button" disabled={!canPreview} onClick={workspace.previewActiveAgain}>
                  {t("previewRetained", { name: formatDatasetLabel(workspace.activeDataset) })}
                </button> : null}
              </div>
            )}
          </section>
        )}
        </section>
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
function announceNotice(notice: WorkspaceNotice, t: UiMessage): string {
  return `${t("workspaceAnnouncement", { message: formatWorkspaceNotice(notice, t).message })}${notice.sequence % 2 === 1 ? "\u00a0" : ""}`;
}

/**
 * What each refusal says. Exhaustive over the reasons, so one added to the
 * boundary fails compilation here rather than being dropped in silence.
 */
/**
 * What a reader is told about the conversion queue.
 *
 * One sentence per state and nothing while idle, so an empty region stays empty
 * rather than announcing that nothing is happening. Nothing here is a
 * percentage: nothing measures one.
 */
function announceDrop(workspace: ReturnType<typeof usePreviewWorkspace>, t: UiMessage): string {
  if (workspace.dropSubscriptionStatus === "unavailable") return `${t("dropUnavailable")}. ${workspace.dropSubscriptionError === null ? t("addFiles") : ownedErrorMessage(workspace.dropSubscriptionError, t)}`;
  if (workspace.dropSubscriptionStatus === "connecting") return t("shellDropConnecting");
  if (workspace.dropRejectedToken > 0) return `${t(workspace.dropRejectedReason === "drop_busy" ? "dropBusy" : "dropConversionBusy")}${workspace.dropRejectedToken % 2 === 1 ? "\u00a0" : ""}`;
  if (workspace.dropError !== null) return `${t("dropFailed")}. ${ownedErrorMessage(workspace.dropError, t)}`;
  switch (workspace.dropPresentation.status) {
    case "idle": return "";
    case "hovering": return t("dropRelease", { count: workspace.dropPresentation.itemCount });
    case "importing": return t("dropImportStatus");
  }
}

function announce(workspace: ReturnType<typeof usePreviewWorkspace>, t: UiMessage): string {
  const { preview, roster, rosterLoad, spectrum } = workspace;
  if (preview.status === "opening") {
    return t("readingSelected");
  }
  if (preview.status === "failed") {
    return `${t("readFailed")} ${ownedErrorMessage(preview.error, t)}`;
  }
  if (preview.status === "empty") {
    if (rosterLoad.status === "loading") {
      // Not "the workspace is empty". Rust keeps the workspace across a reload
      // of this window, so until the list has been read that is a claim this
      // side cannot make.
      return t("rosterReadingAnnouncement");
    }
    if (rosterLoad.status === "failed" && roster.datasets.length === 0) {
      // Nor after the read failed, which is the same ignorance by another
      // route -- and the failure itself is worth hearing.
      return `${t("rosterFailed")}. ${ownedErrorMessage(rosterLoad.error, t)}`;
    }
    return roster.datasets.length === 0
      ? t("rosterEmptyAnnouncement")
      : t("rosterRetainedAnnouncement", { count: roster.datasets.length });
  }
  switch (spectrum.status) {
    case "none":
      return t("viewerLoadedNone", { count: preview.preview.spectrumTable.rows.length });
    case "loading":
      return t("viewerSpectrumLoading", { index: String(spectrum.index) });
    case "loaded":
      // "Loaded", not "rendered". Since M5.2 an admitted spectrum draws nothing
      // until Rust answers a projection for its range, so at the moment this
      // fires there is no drawing -- and a beat later the panel's own region
      // says so. Two live regions in one window contradicting each other about
      // the same spectrum is worse than either of them saying less.
      return t("viewerSpectrumLoaded", { index: String(spectrum.spectrum.index), count: spectrum.spectrum.pointCount });
    case "unavailable":
      return t("viewerSpectrumUnavailable", { index: String(spectrum.requestedIndex) });
    case "failed":
      return `${t("viewerSpectrumFailed", { index: String(spectrum.index) })}. ${ownedErrorMessage(spectrum.error, t)}`;
  }
}
