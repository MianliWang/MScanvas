import { announceConversion } from "./conversionMessages";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { formatWorkspaceNotice } from "../workbench/workspaceMessages";
import type { UiMessage } from "../preferences/i18n";
import { ProjectPanel, busyKey } from "../project/ProjectPanel";
import { ProvenanceDetails } from "../project/ProvenanceDetails";
import { useProject } from "../project/useProject";
import { WorkbenchHeader, type WorkbenchSurface } from "../workbench/WorkbenchHeader";
import { shellContextItems } from "../workbench/shellContext";
import { STATUS_BACKEND_ID, STATUS_BUSY_ID, WorkbenchStatusBar, statusBusyReason, statusItemId, type StatusBackend } from "../workbench/StatusBar";
import { useSessionPreferences, useUiMessages } from "../preferences/SessionPreferencesProvider";
import { Button, EmptyState, Icon, IconButton, Tabs } from "../../components/ui";

import { ActiveClearDialog } from "./ActiveClearDialog";
import type { ActiveClearFocusReturn } from "./activeClearFocusReturn";
import { BackendStatus } from "./BackendStatus";
import { presentBackend } from "./backendPresentation";
import { Chromatogram } from "./Chromatogram";
import { ChromatogramExportResult, ChromatogramExportStatus, ChromatogramExportTools, LinkedFigureResult, describeUnavailable } from "./ChromatogramExportPanel";
import { resolveConversionScope } from "./conversionScope";
import { ConversionPanel } from "./ConversionPanel";
import { DatasetRoster } from "./DatasetRoster";
import { InspectorClose, PreviewMetadata, PreviewSummary } from "./PreviewSummary";
import { SelectedSpectrumPanel, describeSpectrumExport } from "./SelectedSpectrumPanel";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";
import { ExportFigureDialog } from "./ExportFigureDialog";
import { SOURCE_KIND_LABEL, type FigurePreviewKind } from "./contracts";
import { SpectrumTable, scanStepReasonId } from "./SpectrumTable";
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
  const openFigure = (kind: FigurePreviewKind, returnTo: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null) => setFigureDialog({ kind, returnTo });
  const t = useUiMessages();
  const notice = workspace.workspaceNotice === null ? null : formatWorkspaceNotice(workspace.workspaceNotice, t);
  const [surface, setSurface] = useState<WorkbenchSurface>("workbench");
  /** The open file's tab (direction A): kept across files and surfaces, so switching loses nothing. */
  const [viewerView, setViewerView] = useState<"spectra" | "scans" | "metadata">("spectra");
  /** The two side panels, so focus can follow a drawer that opens. */
  const inspectorRef = useRef<HTMLElement | null>(null);
  const rosterRef = useRef<HTMLElement | null>(null);
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
   * The preview on screen, as a QC capture needs it: which row, its opaque
   * run-summary token, and whether its build can be identified. Only a loaded
   * preview counts -- one still opening is not yet a summary anyone has seen.
   */
  const viewedPreview = useMemo(
    () =>
      preview.status === "loaded"
        ? {
            handle: preview.preview.file.handle,
            token: preview.preview.qcSnapshotToken,
            producerIdentified: preview.preview.qcProducerIdentified,
          }
        : null,
    [preview],
  );
  // Details always opens (GOALS S3, B4): with nothing to describe on this
  // surface it says so in one line, so its toggle is never a refusal. It never
  // becomes authority to load anything.
  const detailsOpen = panels.present.details;
  const evidenceRef = useRef<HTMLElement | null>(null);
  const pendingRevealFocus = useRef(false);
  useLayoutEffect(() => {
    if (pendingRevealFocus.current && surface === "workbench" && !rosterOpen && !detailsOpen) {
      pendingRevealFocus.current = false;
      evidenceRef.current?.focus({ preventScroll: true });
    }
  }, [surface, rosterOpen, detailsOpen]);
  /**
   * At 1050 px and below the roster and Details are drawers over the workspace
   * card (spec 3.1). While one is open it is modal: the rest of the card and
   * the status bar are inert under a scrim, the header stays live so its toggle
   * can close it, and the keyboard moves in when it opens. Esc and the scrim
   * fold it for space without touching the stored request, and Esc or its ×
   * gives the keyboard back to the control that opened it (the header toggle
   * when that control is gone).
   */
  const drawer = !constrained ? null : rosterOpen ? "roster" : detailsOpen ? "details" : null;
  const openedDrawer = useRef<typeof drawer>(null);
  const drawerOpener = useRef<HTMLElement | null>(null);
  const drawerReturn = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const was = openedDrawer.current;
    openedDrawer.current = drawer;
    if (drawer === null) {
      // Spent in the commit that lifts `inert`, before which the opener
      // cannot take the focus.
      const target = drawerReturn.current;
      drawerReturn.current = null;
      drawerOpener.current = null;
      if (target !== null && target.isConnected && target.closest("[hidden], [inert]") === null) target.focus({ preventScroll: true });
      return;
    }
    if (drawer === was) return;
    const region = drawer === "roster" ? rosterRef.current : inspectorRef.current;
    drawerOpener.current = document.activeElement instanceof HTMLElement && region?.contains(document.activeElement) !== true
      ? document.activeElement : null;
    if (region !== null && !region.contains(document.activeElement)) region.focus({ preventScroll: true });
  }, [drawer]);
  const closeDrawer = (returnFocus: boolean) => {
    if (drawer === null) return;
    const region = drawer === "roster" ? rosterRef.current : inspectorRef.current;
    const opener = drawerOpener.current;
    drawerReturn.current = !returnFocus ? null
      : opener !== null && opener !== document.body && opener.isConnected && region?.contains(opener) !== true ? opener
      : document.querySelector<HTMLElement>(`.workbench-header [aria-controls="${drawer === "roster" ? "workbench-roster" : "workbench-inspector"}"]`);
    panels.navigate();
  };
  const closeDrawerRef = useRef(closeDrawer);
  closeDrawerRef.current = closeDrawer;
  const closeInspector = useCallback(() => closeDrawerRef.current(true), []);
  const drawerKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Only from inside the drawer's own DOM: a menu or dialog portalled out of
    // it handles its own Esc, and React would bubble that one here too.
    // A drag in the roster owns Esc: it cancels the drag and nothing else.
    // dnd-kit's pointer sensor hears the key at the body, after this handler.
    if (event.key !== "Escape" || drawer === null || event.defaultPrevented || event.nativeEvent.isComposing
      || !event.currentTarget.contains(event.target as Node)
      || event.currentTarget.querySelector('[data-drag-active="true"]') !== null) return;
    event.preventDefault();
    closeDrawer(true);
  };
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
  // Copy that offers dropping files only while dropping files works.
  const dropAvailable = workspace.dropSubscriptionStatus === "available";
  // ProteoWizard is an icon and a short label in the status bar; its details
  // open over the bar from there. Whether they are open is presentation for
  // this session and stored nowhere.
  const [backendOpen, setBackendOpen] = useState(false);
  const closeBackend = useCallback(() => { setBackendOpen(false); }, []);
  const backendView = presentBackend(workspace.backend, workspace.backendReadingStale, t, workspace.conversion.backendQuarantined);

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

  /**
   * What the status bar says about work and the project.
   *
   * Every field is read from the owner that already holds it, so the bar
   * cannot come to disagree with the surface it points at. A stop that was
   * asked for reads as stopping, as the Conversion surface reads it, before the
   * lane itself says so.
   */
  const statusItems = shellContextItems({
    project: project.state.open ? { name: project.state.name, unsaved: project.state.dirty } : null,
    projectActivity: busyKey(project.busy),
    conversionStatus: workspace.conversion.state.status === "running" && workspace.conversion.stopping
      ? "stopping"
      : workspace.conversion.state.status,
  }, t);
  /**
   * Why adding, re-reading or changing the list waits: the visible reason the
   * refused workspace actions point at. `null` exactly when none of them is
   * refused, so no control ever points at a reason that is not there.
   */
  const busyReason = statusBusyReason({
    backendBusy: workspace.backendBusy,
    pickerBusy: workspace.pickerBusy,
    folderBusy: workspace.folderBusy,
    dropBusy: workspace.dropBusy,
    workspaceBusy: workspace.workspaceBusy,
    projectAdmitting: project.busy === "admitting",
    conversionBusy: workspace.conversion.busy,
    rosterLoad: workspace.rosterLoad.status,
  }, t);
  const backendItem: StatusBackend = {
    tone: backendView.status.tone,
    text: backendView.status.label,
    expanded: backendOpen,
    onToggle: () => setBackendOpen((was) => !was),
  };
  /**
   * The visible reason a refused read points at: the backend item when the
   * backend is why, the busy reason when a workspace change is.
   */
  const previewReasonId = !backendUsable || workspace.backendBusy || workspace.conversion.backendQuarantined
    ? STATUS_BACKEND_ID
    : busyReason !== null ? STATUS_BUSY_ID : undefined;
  /**
   * A vendor row the reader picked: it is never previewed, so the evidence
   * says what it is and offers its one route, conversion (spec 3.6).
   */
  const focusedVendor = roster.focused === null || !roster.selected.has(roster.focused)
    ? null
    : roster.datasets.find((row) => row.handle === roster.focused && row.sourceKind !== "mzml") ?? null;
  const evidenceState = preview.status !== "empty" ? preview.status
    // While the list is being read, or could not be, the evidence never sends
    // the reader to a list that has nothing in it yet.
    : roster.datasets.length === 0 ? (workspace.rosterLoad.status === "ready" ? "first-run"
      : workspace.rosterLoad.status === "failed" ? "roster-failed" : "roster-loading")
    : focusedVendor !== null ? "vendor"
    // Only where setting ProteoWizard up is the way forward: a restart is not.
    : backendView.kind === "missing" || backendView.kind === "unsupported" ? "backend"
    : "idle";
  /** Whether the evidence shows a filled primary of its own (vendor, re-read, first run). */
  const evidenceHasPrimary = surface === "workbench" && preview.status === "empty"
    && (evidenceState === "vendor" || (evidenceState === "first-run" && !rosterOpen)
      || (evidenceState === "idle" && workspace.activeDataset !== null));
  /**
   * An evidence action that shows another surface hides the button that was
   * pressed, so the keyboard follows to the surface it asked for rather than
   * being left on the body.
   */
  const pendingSurfaceFocus = useRef<"conversion" | "project" | null>(null);
  useLayoutEffect(() => {
    if (pendingSurfaceFocus.current === null || pendingSurfaceFocus.current !== surface) return;
    pendingSurfaceFocus.current = null;
    document.getElementById(`workbench-${surface}`)?.focus({ preventScroll: true });
  }, [surface]);
  /**
   * The first run's Add buttons leave when the first rows arrive. A reader who
   * was on one continues from the evidence, which now says what to do next,
   * rather than from the body. Read in the ref's cleanup, while the node is
   * still in the document.
   */
  const firstRunHeldFocus = useRef(false);
  const firstRunActions = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return;
    return () => { firstRunHeldFocus.current = node.contains(document.activeElement); };
  }, []);
  useLayoutEffect(() => {
    if (evidenceState === "first-run" || !firstRunHeldFocus.current) return;
    firstRunHeldFocus.current = false;
    if (document.activeElement === null || document.activeElement === document.body) evidenceRef.current?.focus({ preventScroll: true });
  }, [evidenceState]);

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
    <div className="app-shell workbench-shell" data-surface={surface} data-roster-open={rosterOpen} data-details-open={detailsOpen}
      data-drawer={drawer ?? undefined} data-settings-return-target="" tabIndex={-1}>
      <WorkbenchHeader surface={surface} onNavigate={setSurface}
        conversionBusy={workspace.conversion.busy}
        conversionRetained={workspace.conversion.state.status === "terminal"}
        projectBusy={project.busy !== "idle"} />

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
          laneQuarantined={workspace.conversion.backendQuarantined}
          open={backendOpen}
          onClose={closeBackend}
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
            <Button
              variant="secondary"
              size="sm"
              refused={!canAcquire}
              reasonId={STATUS_BUSY_ID}
              onClick={workspace.addFiles}
            >
              {t("retryFiles")}
            </Button>
            <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={workspace.dismissPickerError} />
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
            <Button
              variant="secondary"
              size="sm"
              refused={!canAddFolder}
              reasonId={STATUS_BUSY_ID}
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
            >
              {t("chooseAnotherFolder")}
            </Button>
            <IconButton
              className="notice-dismiss"
              size="sm"
              icon={<Icon name="close" />}
              label={t("dismiss")}
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
            />
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

        {/* Drop connectivity has no banner: the status bar already says file
            drop is unavailable, and carries its reconnect beside it. */}

        {workspace.dropError === null ? null : (
          // The permanently mounted drop live region below is the one
          // announcement. Giving this visible copy `role=status` would speak
          // the same failure twice.
          <div className="notice notice-danger">
            <strong>{t("dropFailed")}</strong>
            <span>{ownedErrorMessage(workspace.dropError, t)}</span>
            <IconButton
              className="notice-dismiss"
              size="sm"
              icon={<Icon name="close" />}
              label={t("dismiss")}
              onClick={(event) => {
                if (event.detail === 0 && document.activeElement === event.currentTarget) {
                  setRestoreAddFilesFocusToken((token) => token + 1);
                }
                workspace.dismissDropError();
              }}
            />
          </div>
        )}

        {workspace.workspaceError === null ? null : (
          <div className="notice notice-danger" role="status">
            <strong>{t("workspaceFailed")}</strong>
            <span>{ownedErrorMessage(workspace.workspaceError, t)}</span>
            <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={workspace.dismissWorkspaceError} />
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
            <IconButton className="notice-dismiss" size="sm" icon={<Icon name="close" />} label={t("dismiss")} onClick={workspace.dismissWorkspaceNotice} />
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
            <Button
              variant="secondary"
              size="sm"
              refused={!canReloadRoster}
              reasonId={STATUS_BUSY_ID}
              onClick={workspace.reloadRoster}
            >
              {t("rosterRetry")}
            </Button>
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
        sourceLabel={figureSourceLabel(figureDialog.kind, previewFile?.fileName ?? (preview.status === "loaded" ? preview.preview.file.fileName : null),
          spectrum.status === "loaded" ? spectrum.spectrum : null, t)}
        question={workspace.figurePreviewQuestion(figureDialog.kind)} preview={workspace.previewFigure} onExport={workspace.exportPreviewedFigure}
        onCopy={workspace.copyPreviewedFigure}
        returnTo={figureDialog.returnTo} onClose={() => setFigureDialog(null)} busy={workspace.scientificExportBusy}
        settings={workspace.figureSettings} validation={workspace.figureSettingsValidation} onSetting={workspace.setFigureSetting} onTheme={workspace.setFigureTheme}
        scope={figureDialog.kind === "spectrum" ? workspace.spectrumRangeScope : workspace.chromatogramRangeScope}
        rangeAvailability={figureDialog.kind === "spectrum" ? workspace.spectrumRangeAvailability : "available"}
        onScope={figureDialog.kind === "spectrum" ? workspace.setSpectrumRangeScope : workspace.setChromatogramRangeScope}
        committedDomain={figureDialog.kind === "spectrum" ? workspace.spectrumCommittedDomain : workspace.chromatogramCommittedDomain}
        onExportData={figureDialog.kind === "spectrum" ? workspace.exportSpectrum : figureDialog.kind === "chromatogram" ? workspace.exportChromatogram : undefined}
        // A linked figure the lane would refuse says why here, beside the
        // actions it refuses, rather than accepting a press that does nothing.
        refusal={figureDialog.kind === "linked" && workspace.linkedFigureUnavailable !== null
          ? describeUnavailable(workspace.linkedFigureUnavailable, t) : null}
        result={figureDialog.kind === "spectrum" ? <><p role="status">{describeSpectrumExport(workspace.spectrumExport, t)}{workspace.spectrumExport.status === "failed" ? <span className="notice-detail">{ownedErrorDetail(workspace.spectrumExport.error, t)}</span> : null}</p>
          {["saved", "copied", "cancelled", "failed"].includes(workspace.spectrumExport.status) ? <IconButton size="sm" icon={<Icon name="close" />} label={t("viewerDismissExport")} onClick={workspace.dismissSpectrumExport} /> : null}</> : figureDialog.kind === "chromatogram" ? <div role="status"><ChromatogramExportResult state={workspace.chromatogramExport} onDismiss={workspace.dismissChromatogramExport} /></div> : <div role="status"><LinkedFigureResult state={workspace.linkedFigureExport} onDismiss={workspace.dismissLinkedFigureExport} /></div>}
      /> : null}
      {/* One workspace card per surface (spec 1.2): the columns share its
          border and are separated by rules, not gaps. */}
      <main className="workspace-layout">
        {/* Over the card while a drawer is open; a click folds the drawer. */}
        {drawer === null ? null : <div className="workspace-scrim" aria-hidden="true" data-drawer-scrim="" onClick={() => closeDrawer(false)} />}
        <aside id="workbench-roster" ref={rosterRef} tabIndex={-1} className="workspace-sidebar" hidden={!rosterOpen}
          onKeyDown={drawer === "roster" ? drawerKeys : undefined}>
          <DatasetRoster
            activeClearFocusReturn={activeClearFocusReturn}
            canAddFiles={canAcquire}
            canAddFolder={canAddFolder}
            canMutate={canClear}
            canPreview={canPreview}
            canReloadRoster={canReloadRoster}
            dispatch={workspace.dispatchRoster}
            focusAddFilesToken={workspace.focusAddFilesToken}
            dropAvailable={dropAvailable}
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
            // The first run's one primary (spec 3.3, 3.6): while the roster is
            // on screen the evidence leaves the Add actions to it.
            addFilesPrimary={surface === "workbench" && evidenceState === "first-run"}
            // One filled primary per screen (B2): while the evidence offers its
            // own, the footer's Convert yields to secondary.
            convertPrimary={!evidenceHasPrimary}
            acquireReason={busyReason}
            onAddFolder={workspace.addFolder}
            // The Workbench's one route to batch conversion. Elsewhere the
            // surface has its own next step, and on Conversion its own Convert.
            onConvertChecked={surface !== "workbench" ? undefined : () => {
              workspace.setConversionScope("selected");
              setSurface("conversion");
              panels.navigate();
            }}
            canRemove={canRemove}
            onClearList={(returnTo) => {
              if (!workspace.conversion.busy) return workspace.clearList();
              // From the list menu the item that was pressed is leaving; the
              // confirmation returns to the menu's trigger instead.
              setActiveClear({ returnTo: returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null) });
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
        {/* Each surface names itself (PM9 L1) in the navigation's own words, so
            the title and the control that leads here cannot disagree; the
            region's accessible name is the title. Kept for that name and hidden
            from view (spec 1.2): the selected tab already says where this is. */}
        <section id="workbench-project" tabIndex={-1} className="workbench-project" hidden={surface !== "project"}
          inert={drawer !== null || undefined} aria-labelledby="surface-title-project">
          <h1 id="surface-title-project" className="surface-title visually-hidden">{t("projectSurface")}</h1>
          <ProjectPanel
            session={project}
            liveDatasetHandles={liveDatasetHandles}
            onShowInWorkbench={revealInWorkbench}
            viewedPreview={viewedPreview}
            workspaceBusy={
              workspace.pickerBusy ||
              workspace.folderBusy ||
              workspace.dropBusy ||
              workspace.workspaceBusy
            }
            detailsPresent={detailsOpen}
            onRevealDetails={() => {
              if (panels.busy) return;
              // In one column the region opens as a drawer over this surface,
              // and the keyboard follows it there (`drawer` above).
              panels.toggle("details");
            }}
          />
        </section>
        <section id="workbench-conversion" tabIndex={-1} className="workbench-conversion" hidden={surface !== "conversion"}
          inert={drawer !== null || undefined} aria-labelledby="surface-title-conversion">
          <h1 id="surface-title-conversion" className="surface-title visually-hidden">{t("conversionTask")}</h1>
          <ConversionPanel
            configuration={workspace.conversionConfiguration}
            conversion={workspace.conversion}
            plan={workspace.conversionPlan}
            resolvedScope={resolvedScope}
            onScopeChange={workspace.setConversionScope}
            onSortChange={(sort) => workspace.dispatchRoster({ type: "sortChanged", sort })}
            buildRelease={backendView.names?.release ?? null}
          />
        </section>
        <section id="workbench-evidence" ref={evidenceRef} tabIndex={-1} className="workbench-evidence" hidden={surface !== "workbench"}
          inert={drawer !== null || undefined} data-evidence={evidenceState} aria-labelledby="surface-title-workbench">
        {preview.status === "loaded" ? (
          // Direction A's file row: the surface's title is the file being
          // read, then its three views as tabs. One view is mounted at a time;
          // what it shows lives in the workspace, so a switch loses nothing.
          <div className="viewer-file">
            <h1 id="surface-title-workbench" className="viewer-file-name" title={formatDatasetLabel(previewFile ?? preview.preview.file)}>
              {formatDatasetLabel(previewFile ?? preview.preview.file)}
            </h1>
            <Tabs className="viewer-tabs" label={t("viewerViews")} value={viewerView} onChange={setViewerView} items={[
              { value: "spectra", label: t("viewerTabSpectra") },
              { value: "scans", label: t("viewerTabScans") },
              { value: "metadata", label: t("viewerTabMetadata") },
            ]}>
              {viewerView === "metadata" ? (
                <PreviewMetadata
                  file={previewFile ?? preview.preview.file}
                  metadata={preview.preview.metadata}
                  runSummary={preview.preview.runSummary}
                  spectrumListTotal={preview.preview.spectrumTable.totalRowCount}
                />
              ) : (
                <div className="viewer-view" data-view={viewerView}>
                  {viewerView === "spectra" ? <Chromatogram
                    dispatch={workspace.dispatchViewerEvent}
                    exportStatus={
                      <ChromatogramExportStatus
                        exportState={workspace.chromatogramExport}
                        linkedExportState={workspace.linkedFigureExport}
                        onDismiss={workspace.dismissChromatogramExport}
                        onDismissLinked={workspace.dismissLinkedFigureExport}
                      />
                    }
                    exportTools={
                      workspace.chromatogramExportToken === null ? undefined : leadingItems => (
                        <ChromatogramExportTools
                          leadingItems={leadingItems}
                          figureSettingsValidation={workspace.figureSettingsValidation}
                          linkedUnavailable={workspace.linkedFigureUnavailable}
                          onCopyPlot={workspace.copyChromatogramPlot}
                          onExport={workspace.exportChromatogram}
                          onOpenFigure={() => openFigure("chromatogram")}
                          onOpenLinkedFigure={trigger => openFigure("linked", trigger)}
                          scientificExportBusy={workspace.scientificExportBusy}
                          traces={workspace.chromatogramTraces}
                        />
                      )
                    }
                    interaction={workspace.viewerInteraction}
                    model={workspace.scanModel}
                    onSelect={workspace.selectSpectrum}
                    onToggleTrace={workspace.toggleChromatogramTrace}
                    readInteraction={workspace.readViewerInteraction}
                    selectionAvailability={workspace.spectrumSelection}
                    traces={workspace.chromatogramTraces}
                  /> : null}
                  {/* The scan list beside the spectrum it selects, or across
                      the evidence above it on the Scans tab. */}
                  <div className="viewer-lower">
                    <SpectrumTable
                      layout={viewerView === "scans" ? "full" : "compact"}
                      view={workspace.scanTableView}
                      onRendered={handleTableRendered}
                      onSelect={workspace.selectSpectrum}
                      selection={workspace.viewerInteraction.selection}
                      selectionAvailability={workspace.spectrumSelection}
                      table={preview.preview.spectrumTable}
                    />
                    <SelectedSpectrumPanel
                      onOpenFigure={() => openFigure("spectrum")}
                      dispatchViewport={workspace.dispatchSpectrumViewportEvent}
                      exportState={workspace.spectrumExport}
                      figureSettingsValidation={workspace.figureSettingsValidation}
                      onCopyPlot={workspace.copySpectrumPlot}
                      onDismissExport={workspace.dismissSpectrumExport}
                      onExport={workspace.exportSpectrum}
                      onRetry={workspace.retrySpectrum}
                      onRetryProjection={workspace.retrySpectrumProjection}
                      projectionError={workspace.spectrumProjectionError}
                      readViewport={workspace.readSpectrumViewport}
                      scientificExportBusy={workspace.scientificExportBusy}
                      state={spectrum}
                      viewport={workspace.spectrumViewport}
                      canSelectNext={workspace.canSelectNextScan}
                      canSelectPrevious={workspace.canSelectPreviousScan}
                      onSelectNext={workspace.selectNextScan}
                      onSelectPrevious={workspace.selectPreviousScan}
                      stepReasonId={scanStepReasonId(workspace.scanTableView, workspace.viewerInteraction.selection?.index ?? null, workspace.spectrumSelection)}
                    />
                  </div>
                </div>
              )}
            </Tabs>
            {/*
              One explanation for both committing surfaces, and one occurrence
              of it in the accessibility tree. Always mounted so that the
              announcement is watched before the text arrives, and empty --
              collapsed by `:empty` -- while a scan can be selected, because a
              working control with a sentence under it is a reason to doubt it.
            */}
            <p
              aria-live="polite"
              className="viewer-selection-notice"
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
          </div>
        ) : (
          <>
            <h1 id="surface-title-workbench" className="surface-title visually-hidden">{t("workbench")}</h1>
            {/* Each state centred in the card (spec 3.6): what is missing, and
                the buttons that fill it. No paragraph explains the interface. */}
            {preview.status === "opening" ? (
              // The final layout's shape while the file is read (S2): the file
              // row, then empty plot frames and table rows where they will be.
              // ponytail: no Cancel; reading has no cancel path in Rust yet, and
              // one needs its own narrow command.
              <div className="viewer-skeleton" aria-busy="true">
                <strong className="viewer-skeleton-name">{workspace.activeDataset === null
                  ? t("readingSelected") : t("readingEvidence", { name: formatDatasetLabel(workspace.activeDataset) })}</strong>
                <div className="viewer-skeleton-plot" aria-hidden="true"><span className="viewer-skeleton-head" /><span className="viewer-skeleton-frame" /></div>
                <div className="viewer-skeleton-lower" aria-hidden="true">
                  <div className="viewer-skeleton-table">{[0, 1, 2, 3, 4, 5].map(row => <span key={row} className="viewer-skeleton-row" />)}</div>
                  <div className="viewer-skeleton-plot"><span className="viewer-skeleton-head" /><span className="viewer-skeleton-frame" /></div>
                </div>
              </div>
            ) : preview.status === "failed" ? (
              <EmptyState
                className="evidence-state"
                message={<>
                  <Icon name="info" size={28} />
                  <strong>{ownedErrorMessage(preview.error, t)}</strong>
                  {ownedErrorDetail(preview.error, t) === null ? null : <span>{ownedErrorDetail(preview.error, t)}</span>}
                </>}
                // Reading is idempotent, so a retry is offered when the backend
                // said the failure was retryable -- and it repeats the step that
                // actually failed.
                action={preview.error.retryable && workspace.activeDataset !== null ? (
                  <Button variant="secondary" refused={!canPreview} reasonId={previewReasonId} onClick={workspace.previewActiveAgain}>
                    {t("retryEvidence")}
                  </Button>
                ) : undefined}
              />
            ) : evidenceState === "first-run" ? (
              <EmptyState
                className="evidence-state"
                // What fills the empty Workbench, in the words of the buttons
                // that do it: here, or the roster's Add buttons beside it.
                message={<><Icon name="file" size={28} /><strong>{t("evidenceFirstRun")}</strong></>}
                action={<div className="evidence-actions" ref={firstRunActions}>
                  {/* The roster's own Add buttons are these same actions; while
                      it is on screen they are not offered twice. */}
                  {rosterOpen ? null : <>
                    <Button variant="primary" refused={!canAcquire} reasonId={STATUS_BUSY_ID} icon={<Icon name="plus" />} onClick={workspace.addFiles}>
                      {t("addFiles")}
                    </Button>
                    <Button refused={!canAddFolder} reasonId={STATUS_BUSY_ID} icon={<Icon name="folder" />} onClick={workspace.addFolder}>
                      {t("addFolder")}
                    </Button>
                  </>}
                  <Button refused={project.busy !== "idle"} reasonId={statusItemId("projectActivity")} onClick={() => {
                    pendingSurfaceFocus.current = "project";
                    setSurface("project");
                    panels.navigate();
                    void project.openProject();
                  }}>
                    {t("projectOpen")}
                  </Button>
                </div>}
              />
            ) : evidenceState === "vendor" && focusedVendor !== null ? (
              <EmptyState
                className="evidence-state"
                message={<>
                  <Icon name="file" size={28} />
                  <strong>{formatDatasetLabel(focusedVendor)}</strong>
                  <span id="preview-needs-conversion-description">{`${SOURCE_KIND_LABEL[focusedVendor.sourceKind]} · ${t("needsConversion")}`}</span>
                </>}
                action={<Button variant="primary" onClick={() => {
                  // Checks this row and keeps every other check, then shows the
                  // checked rows on the Conversion surface. Nothing is read.
                  workspace.dispatchRoster({ type: "membershipChanged", handles: [focusedVendor.handle], checked: true });
                  workspace.setConversionScope("selected");
                  pendingSurfaceFocus.current = "conversion";
                  setSurface("conversion");
                  panels.navigate();
                }}>
                  {t("openInConversion")}
                </Button>}
              />
            ) : evidenceState === "backend" ? (
              <EmptyState
                className="evidence-state"
                // The notice above carries the fix; this only says what waits on it.
                message={<><Icon name="info" size={28} /><strong>{t("previewBackendRequired")}</strong></>}
              />
            ) : evidenceState === "roster-loading" || evidenceState === "roster-failed" ? (
              <EmptyState
                className="evidence-state"
                // The list's own state, never an instruction to choose from a
                // list that holds nothing yet. Said once (S4): while the roster
                // is on screen it says it, with its retry, and this stays quiet.
                message={<><Icon name={evidenceState === "roster-failed" ? "info" : "clock"} size={28} />
                  {rosterOpen ? null : <strong>{t(evidenceState === "roster-failed" ? "rosterFailed" : "rosterLoading")}</strong>}</>}
                action={evidenceState === "roster-failed" && constrained && !rosterOpen ? (
                  <Button icon={<Icon name="panelLeft" />} onClick={() => { if (!panels.busy) panels.toggle("roster"); }}>
                    {t("evidenceShowAcquisitions")}
                  </Button>
                ) : undefined}
              />
            ) : (
              <EmptyState
                className="evidence-state"
                // Rows and none open: the next step is in the list. Where the
                // list is a drawer and folded, the one button here opens it.
                message={<><Icon name="chart" size={28} /><strong>{t("emptyEvidence")}</strong></>}
                action={workspace.activeDataset !== null || (constrained && !rosterOpen) ? <div className="evidence-actions">
                  {/* The one owned next step in this state -- the acquisition
                      that was being read, one click from being read again -- so
                      it is this surface's primary action (PM9 L1). */}
                  {workspace.activeDataset === null ? null : (
                    <Button variant="primary" refused={!canPreview} reasonId={previewReasonId} onClick={workspace.previewActiveAgain}>
                      {t("previewRetained", { name: formatDatasetLabel(workspace.activeDataset) })}
                    </Button>
                  )}
                  {constrained && !rosterOpen ? (
                    <Button icon={<Icon name="panelLeft" />} onClick={() => { if (!panels.busy) panels.toggle("roster"); }}>
                      {t("evidenceShowAcquisitions")}
                    </Button>
                  ) : null}
                </div> : undefined}
              />
            )}
          </>
        )}
        </section>
        {/* Last in the DOM as it is last on screen (roster, main, Details), so
            Tab follows the visual order; the grid area places it. */}
        <aside id="workbench-inspector" ref={inspectorRef} tabIndex={-1} className="workbench-inspector" hidden={!detailsOpen} aria-label={t("inspectorToggle")}
          onKeyDown={drawer === "details" ? drawerKeys : undefined}>
          {/* One region, whichever surface is asking. The Project surface puts
              provenance here rather than adding a navigation target of its own,
              which is where the accepted direction puts contextual metadata. */}
          {surface === "project" ? (
            <ProvenanceDetails
              provenance={project.provenance}
              onSelect={project.inspect}
              liveDatasetHandles={liveDatasetHandles}
              onShowInWorkbench={revealInWorkbench}
              onClose={() => closeDrawer(false)}
            />
          ) : preview.status === "loaded" ? (
            <PreviewSummary
              chromatogramScanCount={workspace.scanModel.status === "ready" ? workspace.scanModel.points.length : null}
              file={previewFile ?? preview.preview.file}
              spectrum={spectrum.status === "loaded" ? spectrum.spectrum : null}
              spectrumViewport={workspace.spectrumViewport}
              onClose={closeInspector}
            />
          ) : (
            // Nothing to describe yet: one line, never a refused toggle (S3).
            <section className="panel inspector-panel" aria-label={t("inspectorToggle")}>
              <InspectorClose onClose={closeInspector} />
              <p className="provenance-empty">{t("inspectorUnavailable")}</p>
            </section>
          )}
        </aside>
      </main>
      <WorkbenchStatusBar backend={backendItem} items={statusItems} busy={busyReason}
        dropStatus={workspace.dropSubscriptionStatus} onNavigate={setSurface} inert={drawer !== null}
        // Connectivity is not a failed import: Rust may still hold a valid
        // roster and the picker actions remain usable, so its recovery stays
        // separate from the error for one accepted Drop.
        dropProblem={workspace.dropSubscriptionError === null ? null : ownedErrorMessage(workspace.dropSubscriptionError, t)}
        onReconnectDrop={(event) => {
          // Keyboard activation has click detail zero. A real pointer press
          // focuses the button before click, so activeElement on its own would
          // manufacture a keyboard debt for mouse users.
          if (event.detail === 0 && document.activeElement === event.currentTarget) {
            setRestoreAddFilesFocusToken((token) => token + 1);
          }
          workspace.retryDropSubscription();
        }} />
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
 * The figure dialog's subtitle, in the viewer's own numbering: the scan number
 * the spectrum head shows, and the index only where the file gives no scan
 * number (direction A 2.5).
 */
function figureSourceLabel(kind: "spectrum" | "chromatogram" | "linked", fileName: string | null,
  spectrum: { readonly index: number; readonly scanNumber: number | null } | null, t: UiMessage): string {
  if (fileName === null) return t("viewerSpectrumNone");
  if (kind === "chromatogram") return t("figureSourceChromatogram", { name: fileName });
  if (spectrum === null) return fileName;
  return spectrum.scanNumber === null
    ? t("figureSourceSpectrumIndex", { index: formatCount(spectrum.index), name: fileName })
    : t("figureSourceSpectrum", { scan: formatCount(spectrum.scanNumber), name: fileName });
}

/**
 * What a reader is told about the conversion queue.
 *
 * One sentence per state and nothing while idle, so an empty region stays empty
 * rather than announcing that nothing is happening. Nothing here is a
 * percentage: nothing measures one.
 */
function announceDrop(workspace: ReturnType<typeof usePreviewWorkspace>, t: UiMessage): string {
  if (workspace.dropSubscriptionStatus === "unavailable") {
    return workspace.dropSubscriptionError === null
      ? t("shellDropUnavailable")
      : t("messageWithDetail", { message: t("dropUnavailable"), detail: ownedErrorMessage(workspace.dropSubscriptionError, t) });
  }
  // Nothing to say until drop is live: a hint about a gesture that cannot work yet is noise.
  if (workspace.dropSubscriptionStatus === "connecting") return "";
  if (workspace.dropRejectedToken > 0) return `${t(workspace.dropRejectedReason === "drop_busy" ? "dropBusy" : "dropConversionBusy")}${workspace.dropRejectedToken % 2 === 1 ? "\u00a0" : ""}`;
  if (workspace.dropError !== null) return t("messageWithDetail", { message: t("dropFailed"), detail: ownedErrorMessage(workspace.dropError, t) });
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
      return t("messageWithDetail", { message: t("rosterFailed"), detail: ownedErrorMessage(rosterLoad.error, t) });
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
      return t("viewerSpectrumAbsent", { index: String(spectrum.requestedIndex) });
    case "failed":
      return t("messageWithDetail", { message: t("viewerSpectrumFailed", { index: String(spectrum.index) }), detail: ownedErrorMessage(spectrum.error, t) });
  }
}
