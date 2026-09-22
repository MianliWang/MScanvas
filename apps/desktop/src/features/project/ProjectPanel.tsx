/**
 * The project surface: references, what a check established about them, and
 * the runs and artifacts recorded over them.
 *
 * Usable with no ProteoWizard installation, because nothing here reads an
 * acquisition. It records where files are and what they contain; whether any of
 * them is a supported acquisition is a question the roster answers, separately,
 * when a user asks it to.
 *
 * Three things this surface owes a reader who cannot see it:
 *
 * The outcomes are words. A reference whose bytes match, one whose bytes
 * differ, and one that could not be read are three sentences, not three
 * colours, and the reason for the last is given because "not there" and
 * "another program has it open" need different actions.
 *
 * Every per-row control names its reference. Five references produce five
 * "Locate" buttons, and a button list that reads "Locate, Remove, Locate,
 * Remove" is one a reader can act on wrongly.
 *
 * What is happening is announced. A check reads every referenced file whole, so
 * the controls can be dim for a long time; the live region says which operation
 * is running rather than leaving silence to stand for it.
 */

import { useEffect, useRef } from "react";

import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { ProjectInput } from "./projectApi";
import type { ProjectBusy, ProjectSession } from "./useProject";

/** The message key for one verification outcome. */
function verificationKey(input: ProjectInput) {
  if (input.verification !== "unavailable") {
    return (
      {
        notChecked: "projectStateNotChecked",
        matchingRecordedContent: "projectStateMatching",
        differentContent: "projectStateDifferent",
      } as const
    )[input.verification];
  }
  return (
    {
      missingAtCheckedLocation: "projectStateMissing",
      unreadable: "projectStateUnreadable",
      unsafeReference: "projectStateUnsafe",
      incompleteRequiredMembers: "projectStateIncomplete",
      unstableRead: "projectStateUnstable",
    } as const
  )[input.unavailableReason ?? "unreadable"];
}

/**
 * The sentence for one refusal identifier.
 *
 * Every identifier Rust can send, mapped to what it means for the person
 * reading it. The fallback exists for an identifier a future build adds, and is
 * the only case where the surface says something as vague as "that was
 * refused".
 */
const REFUSALS = {
  unsavedChanges: "projectRefusedUnsavedChanges",
  noOpenProject: "projectRefusedNoOpenProject",
  notYetPublished: "projectRefusedNotYetPublished",
  unknownRecord: "projectRefusedUnknownRecord",
  destinationNotNamed: "projectRefusedDestinationNotNamed",
  destinationNotAProject: "projectRefusedDestinationNotAProject",
  destinationAliasesInput: "projectRefusedDestinationAliasesInput",
  staleDocument: "projectRefusedStaleDocument",
  notPublished: "projectRefusedNotPublished",
  oversized: "projectRefusedOversized",
  notChecked: "projectRefusedNotChecked",
  contentChanged: "projectRefusedContentChanged",
  missingAtCheckedLocation: "projectRefusedMissing",
  unreadable: "projectRefusedUnreadable",
  unsafeReference: "projectRefusedUnsafe",
  incompleteRequiredMembers: "projectRefusedIncomplete",
  unstableRead: "projectRefusedUnstable",
  nothingSelected: "projectRefusedNothingSelected",
  alreadyRunning: "projectRefusedAlreadyRunning",
  malformed: "projectRefusedMalformed",
  unsupportedVersion: "projectRefusedUnsupportedVersion",
  duplicateIdentifier: "projectRefusedDuplicate",
  danglingReference: "projectRefusedDangling",
  invalidLocator: "projectRefusedInvalidLocator",
  inconsistentRecord: "projectRefusedInconsistent",
  ambiguousProducer: "projectRefusedAmbiguousProducer",
  unsafeTarget: "projectRefusedUnsafe",
} as const;

function refusalKey(code: string) {
  return code in REFUSALS
    ? REFUSALS[code as keyof typeof REFUSALS]
    : ("projectRefusedUnknown" as const);
}

const BUSY = {
  opening: "projectBusyOpening",
  saving: "projectBusySaving",
  checking: "projectBusyChecking",
  capturing: "projectBusyCapturing",
  linking: "projectBusyLinking",
  admitting: "projectBusyAdmitting",
} as const;

function busyKey(busy: ProjectBusy) {
  return busy === "idle" ? null : BUSY[busy];
}

/**
 * Why this reference cannot be added to the Workbench, or `null` where it can.
 *
 * Keyed on the same current state the row already displays, because that is
 * what decides it: the Workbench takes the file the project recorded, and
 * "which file is that" is a question only a check answers. Every state gets
 * its own sentence, since "check it first", "it changed" and "it is not there"
 * need three different things from the reader.
 */
function unavailableToAddKey(input: ProjectInput) {
  if (input.verification === "matchingRecordedContent") return null;
  if (input.verification === "notChecked") return "projectAddNeedsCheck" as const;
  if (input.verification === "differentContent") return "projectAddChanged" as const;
  return input.unavailableReason === "missingAtCheckedLocation"
    ? ("projectAddMissing" as const)
    : ("projectAddUnavailable" as const);
}

/**
 * The class that carries the outcome visually.
 *
 * Never the only cue: the label beside it says the same thing in words, and the
 * row carries `data-verification` for anything reading the state rather than
 * looking at it.
 */
function verificationTone(input: ProjectInput): string {
  if (input.verification === "matchingRecordedContent") return "is-matching";
  if (input.verification === "differentContent") return "is-different";
  if (input.verification === "unavailable") return "is-unavailable";
  return "is-unchecked";
}

/**
 * A recorded instant, in the reader's own locale.
 *
 * The document stores RFC 3339 in UTC, which is the right thing to store and
 * the wrong thing to show. An instant this cannot parse is shown as it was
 * stored rather than replaced with a guess.
 */
export function recordedAt(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    parsed,
  );
}

export interface ProjectPanelProps {
  readonly session: ProjectSession;
  /** Whether the contextual Details region is currently on screen. */
  readonly detailsPresent?: boolean;
  /** Asks the shell to show it, through the same control the header uses. */
  readonly onRevealDetails?: () => void;
  /**
   * Every row the workspace currently holds.
   *
   * The roster is the only authority on which rows exist, so a remembered
   * handle is resolved against this rather than trusted. A row the user
   * removed, or a workspace they cleared, therefore turns "show it" back into
   * "add it" with no extra bookkeeping anywhere.
   */
  readonly liveDatasetHandles?: ReadonlySet<string>;
  /**
   * Takes the reader to one row that is already in the Workbench.
   *
   * Navigation and nothing else: no request is sent, no file is read and no
   * backend is touched, which is why it is a shell callback rather than an
   * operation on the session.
   */
  readonly onShowInWorkbench?: (handle: string) => void;
}

export function ProjectPanel({
  session,
  detailsPresent = false,
  onRevealDetails,
  liveDatasetHandles,
  onShowInWorkbench,
}: ProjectPanelProps) {
  const t = useUiMessages();
  const { state, busy, problem, cancelled, pending, selected, inspecting } = session;
  const working = busy !== "idle";
  const locale = document.documentElement.lang || "en";

  /**
   * Keeps the keyboard where the user put it across a relink proposal.
   *
   * Pressing Locate unmounts that button and mounts the confirmation in its
   * place, which drops focus to `<body>` -- so a keyboard user would have to
   * tab in from the top of the page to reach the control the flow just created
   * for them. Focus follows to that control instead.
   */
  const proposed = state.inputs.find((input) => input.relinkProposed)?.id ?? null;
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const lastProposed = useRef<string | null>(null);
  useEffect(() => {
    if (proposed !== null && proposed !== lastProposed.current) {
      confirmRef.current?.focus();
    }
    lastProposed.current = proposed;
  }, [proposed]);

  /**
   * The one live region, carrying whatever the surface most recently has to
   * say: what is running, what a proposal found, or why something was refused.
   *
   * One region and one voice. The visible notices below deliberately carry no
   * role of their own, so nothing is announced twice.
   */
  /**
   * The live workspace row for one reference, or `null`.
   *
   * Remembered in Rust, resolved here. A handle naming no row the roster
   * currently holds means the row has gone, which is the same position as
   * never having admitted one.
   */
  function inWorkbench(input: ProjectInput): string | null {
    const handle = input.workbenchDatasetHandle;
    if (handle === null || liveDatasetHandles === undefined) return null;
    return liveDatasetHandles.has(handle) ? handle : null;
  }

  const proposalInput = state.inputs.find((input) => input.id === proposed);
  const announcement =
    busyKey(busy) !== null
      ? t(busyKey(busy) as "projectBusySaving")
      : pending !== null
        ? t("projectUnsavedQuestion")
        : problem !== null
          ? t(refusalKey(problem))
          : cancelled
            ? t("projectCancelled")
            : proposalInput !== undefined
              ? t(
                  proposalInput.relinkCandidateMatches
                    ? "projectRelinkMatches"
                    : "projectRelinkDiffers",
                )
              : "";

  return (
    <div className="project-surface" data-project-surface="" aria-busy={working || undefined}>
      <header className="project-header">
        <div>
          <h2>{state.open ? state.name : t("projectNone")}</h2>
          {/* The one disclosure this document needs, and it is not hidden in a
              tooltip: a project records file names, locations and content
              digests, so it can reveal what someone was working on. */}
          <p className="project-privacy">{t("projectPrivacy")}</p>
        </div>
        <div className="project-actions">
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || undefined}
            onClick={() => {
              if (!working) void session.createProject(t("projectDefaultName"));
            }}
          >
            {t("projectNew")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || undefined}
            onClick={() => {
              if (!working) void session.openProject();
            }}
          >
            {t("projectOpen")}
          </button>
          {/* `aria-disabled` rather than `disabled`, for the reason the
              workbench header gives: a disabled button leaves the tab order, so
              the sentence explaining why Save is unavailable could only be read
              with a pointer. Never having been saved is a passing refusal --
              Save As fixes it. */}
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || !state.open || !state.published || undefined}
            title={state.open && !state.published ? t("projectSaveNeedsLocation") : undefined}
            onClick={() => {
              if (!working && state.open && state.published) void session.saveProject();
            }}
          >
            {t("projectSave")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || !state.open || undefined}
            onClick={() => {
              if (!working && state.open) void session.saveProjectAs();
            }}
          >
            {t("projectSaveAs")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || !state.open || undefined}
            onClick={() => {
              if (!working && state.open) void session.closeProject();
            }}
          >
            {t("projectClose")}
          </button>
        </div>
      </header>

      {/* Mounted from the first render and empty until there is something to
          say, so what arrives is announced rather than appearing silently. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="project">
        {announcement}
      </p>

      {busyKey(busy) === null ? null : (
        <p className="project-busy" data-project-busy={busy}>
          {t(busyKey(busy) as "projectBusySaving")}
          {/* Offered only for an operation this session accepted and is still
              waiting on. A save or a dialog is busy too, but it is not a thing
              a cancel can name -- and once the answer is in, the control is
              gone rather than left to send a late request. Rust enforces the
              same rule; this is the affordance agreeing with it rather than
              the fix. */}
          {session.activeOperation === null ? null : (
            <button
              type="button"
              className="link-button"
              data-project-cancel={session.activeOperation}
              onClick={() => void session.cancelJob()}
            >
              {t("projectCancel")}
            </button>
          )}
        </p>
      )}

      {/* Unsaved changes are a question, not a failure, and the answer is the
          user's. Without this the refusal is a loop: the action is refused and
          nothing on screen offers a way through it. */}
      {pending === null ? null : (
        <p className="project-unsaved" data-project-pending={pending.kind}>
          <span>{t("projectUnsavedQuestion")}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void (state.published ? session.saveProject() : session.saveProjectAs())
            }
          >
            {t("projectUnsavedSaveFirst")}
          </button>
          <button
            type="button"
            className="secondary-button"
            data-project-discard=""
            onClick={() => void session.discardAndContinue()}
          >
            {t("projectUnsavedDiscard")}
          </button>
          <button type="button" className="link-button" onClick={session.keepEditing}>
            {t("projectUnsavedKeepEditing")}
          </button>
        </p>
      )}

      {state.dirty && pending === null ? (
        <p className="project-unsaved" data-project-unsaved="">
          {t("projectUnsaved")}
        </p>
      ) : null}

      {/* Below 1700px the contextual region is closed unless the user asked
          for it, and a narrow window folds it away entirely. Inspecting an
          object would then appear to do nothing, so this says where the answer
          went and offers the one control that brings it back -- the same
          toggle the header owns, not a second mechanism. */}
      {inspecting !== null && !detailsPresent && onRevealDetails !== undefined ? (
        <p className="project-inspect-hint" data-project-inspect-hint="">
          <span>{t("provenanceInDetails")}</span>
          <button type="button" className="link-button" onClick={onRevealDetails}>
            {t("provenanceShowDetails")}
          </button>
        </p>
      ) : null}

      {problem === null ? null : (
        <p className="project-problem" data-project-problem={problem}>
          <span>{t(refusalKey(problem))}</span>
          <button type="button" className="link-button" onClick={session.dismissProblem}>
            {t("projectDismiss")}
          </button>
        </p>
      )}

      {cancelled ? (
        <p className="project-note" data-project-cancelled="">
          {t("projectCancelled")}
        </p>
      ) : null}

      {state.open ? (
        <>
          <section className="project-section" aria-label={t("projectReferences")}>
            <div className="project-section-head">
              <h3>{t("projectReferences")}</h3>
              <div className="project-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-disabled={working || undefined}
                  onClick={() => {
                    if (!working) void session.addInput();
                  }}
                >
                  {t("projectAddReference")}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-disabled={working || state.inputs.length === 0 || undefined}
                  data-project-check=""
                  onClick={() => {
                    if (!working && state.inputs.length > 0) void session.checkLinks();
                  }}
                >
                  {t("projectCheckLinks")}
                </button>
                {/* The primary action, and the one whose unavailability needed
                    explaining most: without a reason a reader finds it dim and
                    nothing anywhere says a reference has to be ticked. */}
                <button
                  type="button"
                  className="primary-button"
                  aria-disabled={working || selected.length === 0 || undefined}
                  title={selected.length === 0 ? t("projectCaptureNeedsSelection") : undefined}
                  data-project-capture=""
                  onClick={() => {
                    if (!working && selected.length > 0) void session.capture();
                  }}
                >
                  {t("projectCapture")}
                </button>
              </div>
            </div>

            {state.inputs.length === 0 ? (
              <p className="project-empty">{t("projectNoReferences")}</p>
            ) : (
              <ul className="project-list">
                {state.inputs.map((input) => (
                  <li
                    key={input.id}
                    className={`project-row ${verificationTone(input)}`}
                    data-project-input={input.id}
                    data-verification={input.verification}
                    data-unavailable-reason={input.unavailableReason ?? undefined}
                  >
                    <div className="project-row-select">
                      {/* Two independent choices on one row, as the roster
                          already distinguishes them: the box chooses what the
                          next capture covers, the name chooses what Details
                          describes. The box carries its own name, so nothing
                          is lost by no longer wrapping the label in it. */}
                      <input
                        type="checkbox"
                        checked={selected.includes(input.id)}
                        aria-label={t("projectSelectNamed", { name: input.label })}
                        onChange={() => session.toggleSelected(input.id)}
                      />
                      <button
                        type="button"
                        className="project-row-label"
                        aria-current={
                          inspecting?.kind === "input" && inspecting.id === input.id
                            ? "true"
                            : undefined
                        }
                        aria-controls="workbench-inspector"
                        aria-label={t("provenanceInspectInput", { name: input.label })}
                        data-project-inspect={input.id}
                        onClick={() => session.inspect({ kind: "input", id: input.id })}
                      >
                        {input.label}
                      </button>
                    </div>
                    <p className="project-row-facts">
                      <span className="project-verification" id={`project-state-${input.id}`}>
                        {t(verificationKey(input))}
                      </span>
                      <span className="project-locator">
                        {t(
                          input.locatorKind === "insideProject"
                            ? "projectLocatorInside"
                            : "projectLocatorOutside",
                        )}
                      </span>
                      {input.members.length > 1 ? (
                        <span className="project-members">
                          {t("projectMemberCount", { count: input.members.length })}
                        </span>
                      ) : null}
                    </p>
                    <div className="project-row-actions">
                      {/* The bridge to the session workspace, and the only
                          control here that touches it. A reference already
                          represented by a live row offers to show that row
                          instead of offering to add a second one -- and
                          showing it sends nothing at all. */}
                      {inWorkbench(input) !== null ? (
                        <button
                          type="button"
                          className="secondary-button"
                          aria-label={t("projectShowInWorkbenchNamed", { name: input.label })}
                          data-project-show-in-workbench={input.id}
                          onClick={() => {
                            const handle = inWorkbench(input);
                            if (handle !== null) onShowInWorkbench?.(handle);
                          }}
                        >
                          {t("projectShowInWorkbench")}
                        </button>
                      ) : (
                        // `aria-disabled` rather than `disabled`, for the
                        // reason every other inert control on this surface
                        // gives: a disabled button leaves the tab order, and
                        // the sentence saying why would then be readable only
                        // with a pointer. The state that decides it is
                        // already on the row in words, and the control points
                        // at that text rather than restating it silently.
                        <button
                          type="button"
                          className="secondary-button"
                          aria-disabled={working || unavailableToAddKey(input) !== null || undefined}
                          aria-describedby={
                            unavailableToAddKey(input) === null
                              ? undefined
                              : `project-state-${input.id}`
                          }
                          title={
                            unavailableToAddKey(input) === null
                              ? undefined
                              : t(unavailableToAddKey(input) as "projectAddNeedsCheck")
                          }
                          aria-label={t("projectAddToWorkbenchNamed", { name: input.label })}
                          data-project-add-to-workbench={input.id}
                          data-project-add-unavailable={unavailableToAddKey(input) ?? undefined}
                          onClick={() => {
                            if (!working && unavailableToAddKey(input) === null) {
                              void session.addToWorkbench(input.id);
                            }
                          }}
                        >
                          {t("projectAddToWorkbench")}
                        </button>
                      )}
                      {input.relinkProposed ? (
                        <>
                          <span className="project-proposal" data-project-proposal={input.id}>
                            {t(
                              input.relinkCandidateMatches
                                ? "projectRelinkMatches"
                                : "projectRelinkDiffers",
                            )}
                          </span>
                          <button
                            type="button"
                            ref={confirmRef}
                            className="secondary-button"
                            aria-disabled={working || undefined}
                            data-project-relink-commit={input.id}
                            onClick={() => {
                              if (!working) void session.commitRelink(input.id);
                            }}
                          >
                            {t("projectRelinkConfirm")}
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            aria-disabled={working || undefined}
                            onClick={() => {
                              if (!working) void session.abandonRelink();
                            }}
                          >
                            {t("projectRelinkAbandon")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secondary-button"
                          aria-disabled={working || undefined}
                          aria-label={t("projectRelinkNamed", { name: input.label })}
                          data-project-relink={input.id}
                          onClick={() => {
                            if (!working) void session.proposeRelink(input.id);
                          }}
                        >
                          {t("projectRelink")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        aria-disabled={working || undefined}
                        aria-label={t("projectRemoveNamed", { name: input.label })}
                        onClick={() => {
                          if (!working) void session.removeInput(input.id);
                        }}
                      >
                        {t("projectRemoveReference")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="project-section" aria-label={t("projectHistory")}>
            <h3>{t("projectHistory")}</h3>
            {/* What a successful capture is, said where it is displayed rather
                than in a document nobody reading this screen will open. */}
            <p className="project-note">{t("projectCaptureMeaning")}</p>
            {state.runs.length === 0 ? (
              <p className="project-empty">{t("projectNoRuns")}</p>
            ) : (
              <ul className="project-list">
                {state.runs.map((run) => {
                  const artifacts = state.artifacts.filter((artifact) =>
                    run.outputArtifactIds.includes(artifact.id),
                  );
                  return (
                    <li
                      key={run.id}
                      className="project-run"
                      data-project-run={run.id}
                      data-outcome={run.outcome}
                    >
                      <p className="project-run-head">
                        <button
                          type="button"
                          className="project-run-operation"
                          aria-current={
                            inspecting?.kind === "run" && inspecting.id === run.id
                              ? "true"
                              : undefined
                          }
                          aria-controls="workbench-inspector"
                          aria-label={t("provenanceInspectRunAt", {
                            when: recordedAt(run.finishedAt, locale),
                          })}
                          data-project-inspect-run={run.id}
                          onClick={() => session.inspect({ kind: "run", id: run.id })}
                        >
                          {t("projectOperationCapture")}
                        </button>
                        <span className="project-run-outcome">
                          {t(
                            run.outcome === "completed"
                              ? "projectRunCompleted"
                              : run.outcome === "failed"
                                ? "projectRunFailed"
                                : "projectRunCancelled",
                          )}
                        </span>
                        {/* Formatted for the reader. The document stores
                            RFC 3339 in UTC, which is what a record should hold
                            and not what a person should be shown. */}
                        <span className="project-run-when">
                          <time dateTime={run.finishedAt}>{recordedAt(run.finishedAt, locale)}</time>
                        </span>
                      </p>
                      <p className="project-run-relationship">
                        {t("projectRunInputs", { count: run.inputIds.length })}
                        {artifacts.length === 0 ? (
                          <span data-project-no-artifact="">{t("projectRunNoArtifact")}</span>
                        ) : (
                          // Described from the counts rather than from the
                          // label the document stores: that label is written in
                          // English by the backend, and echoing it would put
                          // English into a Chinese session.
                          artifacts.map((artifact) => (
                            <span key={artifact.id} data-project-artifact={artifact.id}>
                              <button
                                type="button"
                                className="link-button"
                                aria-current={
                                  inspecting?.kind === "artifact" && inspecting.id === artifact.id
                                    ? "true"
                                    : undefined
                                }
                                aria-controls="workbench-inspector"
                                aria-label={t("provenanceInspectArtifactOf", {
                                  when: recordedAt(run.finishedAt, locale),
                                })}
                                data-project-inspect-artifact={artifact.id}
                                onClick={() => session.inspect({ kind: "artifact", id: artifact.id })}
                              >
                                {t("projectArtifactFileFacts")}
                              </button>
                              {" — "}
                              {t("projectArtifactMembers", {
                                count: artifact.observedMemberCount,
                              })}
                            </span>
                          ))
                        )}
                      </p>
                      <p className="project-run-version">
                        {t("projectRunVersion", { version: run.applicationVersion })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="project-empty">{t("projectNoneHint")}</p>
      )}
    </div>
  );
}
