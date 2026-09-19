/**
 * The project surface: references, what a check established about them, and
 * the runs and artifacts recorded over them.
 *
 * Usable with no ProteoWizard installation, because nothing here reads an
 * acquisition. It records where files are and what they contain; whether any of
 * them is a supported acquisition is a question the roster answers, separately,
 * when a user asks it to.
 *
 * Three states are visually distinct and labelled, because telling them apart
 * is the point of the surface: a reference whose bytes match the record, one
 * whose bytes differ, and one that could not be read at all -- with the reason
 * for the last, since "not there" and "somebody else has it open" are different
 * things to do something about.
 */

import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { ProjectInput } from "./projectApi";
import type { ProjectSession } from "./useProject";

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

export function ProjectPanel({ session }: { readonly session: ProjectSession }) {
  const t = useUiMessages();
  const { state, busy, problem, selected } = session;
  const working = busy !== "idle";

  return (
    <div className="project-surface" data-project-surface="">
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
            disabled={working}
            onClick={() => void session.createProject(t("projectDefaultName"), !state.dirty)}
          >
            {t("projectNew")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={working}
            onClick={() => void session.openProject(!state.dirty)}
          >
            {t("projectOpen")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={working || !state.open || !state.published}
            title={state.open && !state.published ? t("projectSaveNeedsLocation") : undefined}
            onClick={() => void session.saveProject()}
          >
            {t("projectSave")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={working || !state.open}
            onClick={() => void session.saveProjectAs()}
          >
            {t("projectSaveAs")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={working || !state.open}
            onClick={() => void session.closeProject(!state.dirty)}
          >
            {t("projectClose")}
          </button>
        </div>
      </header>

      {state.dirty ? (
        <p className="project-unsaved" data-project-unsaved="">
          {t("projectUnsaved")}
        </p>
      ) : null}

      {/* Mounted from the first render and empty until there is something to
          say, so a refusal that arrives is announced rather than appearing
          silently. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="project">
        {problem === null ? "" : t("projectRefused")}
      </p>

      {problem === null ? null : (
        <p className="project-problem" role="status" data-project-problem={problem}>
          <span>{t("projectRefused")}</span>
          <button type="button" className="link-button" onClick={session.dismissProblem}>
            {t("projectDismiss")}
          </button>
        </p>
      )}

      {state.open ? (
        <>
          <section className="project-section" aria-label={t("projectReferences")}>
            <div className="project-section-head">
              <h3>{t("projectReferences")}</h3>
              <div className="project-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={working}
                  onClick={() => void session.addInput()}
                >
                  {t("projectAddReference")}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={working || state.inputs.length === 0}
                  data-project-check=""
                  onClick={() => void session.checkLinks()}
                >
                  {t("projectCheckLinks")}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={working || selected.length === 0}
                  data-project-capture=""
                  onClick={() => void session.capture()}
                >
                  {t("projectCapture")}
                </button>
                {working ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void session.cancelJob()}
                  >
                    {t("projectCancel")}
                  </button>
                ) : null}
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
                    <label className="project-row-select">
                      <input
                        type="checkbox"
                        checked={selected.includes(input.id)}
                        onChange={() => session.toggleSelected(input.id)}
                      />
                      <span className="project-row-label">{input.label}</span>
                    </label>
                    <p className="project-row-facts">
                      <span className="project-verification">{t(verificationKey(input))}</span>
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
                            className="secondary-button"
                            disabled={working}
                            data-project-relink-commit={input.id}
                            onClick={() => void session.commitRelink(input.id)}
                          >
                            {t("projectRelinkConfirm")}
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            disabled={working}
                            onClick={() => void session.abandonRelink()}
                          >
                            {t("projectRelinkAbandon")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={working}
                          data-project-relink={input.id}
                          onClick={() => void session.proposeRelink(input.id)}
                        >
                          {t("projectRelink")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        disabled={working}
                        onClick={() => void session.removeInput(input.id)}
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
                        <span className="project-run-operation">{t("projectOperationCapture")}</span>
                        <span className="project-run-outcome">
                          {t(
                            run.outcome === "completed"
                              ? "projectRunCompleted"
                              : run.outcome === "failed"
                                ? "projectRunFailed"
                                : "projectRunCancelled",
                          )}
                        </span>
                        <span className="project-run-when">{run.finishedAt}</span>
                      </p>
                      <p className="project-run-relationship">
                        {t("projectRunInputs", { count: run.inputIds.length })}
                        {artifacts.length === 0 ? (
                          <span data-project-no-artifact="">{t("projectRunNoArtifact")}</span>
                        ) : (
                          artifacts.map((artifact) => (
                            <span key={artifact.id} data-project-artifact={artifact.id}>
                              {artifact.label}
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
