/**
 * What the selected project object is, and what it is related to.
 *
 * The contextual metadata region the accepted direction puts beside the
 * evidence area, filled for the Project surface. It renders three kinds of
 * object and the real relationships between them, and every relationship is a
 * control: activating one selects that object and re-reads this same panel.
 *
 * ## Two kinds of fact, kept apart
 *
 * *Recorded* is what a run observed when it ran. *Current* is what a check
 * established about a file a moment ago. They are different questions with
 * different answers, so they are in different sections with different
 * treatments: a reference whose bytes have changed still has the run that used
 * it, and a reference that is gone did not erase what was recorded from it.
 * Nothing here rewrites the first because of the second.
 *
 * An artifact has no current file state at all. `FileFactsV1` is a payload
 * inside the project document and there is no locator that could name a file
 * for it, so this says where it lives rather than leaving a gap a reader would
 * fill in with a guess.
 *
 * ## What activating a relationship does
 *
 * It changes which object is selected. That is the whole of it: no request is
 * sent, no file is read, no run is dispatched and the document is not touched.
 * The data was already here.
 */

import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { recordedAt } from "./ProjectPanel";
import type { ProjectInput, ProjectRun } from "./projectApi";
import type { Provenance, ProjectSelection, Related } from "./lineage";

/** The message key for one reference's current check outcome. */
function currentStateKey(input: ProjectInput) {
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

/** The tone class one reference's current state carries. */
function currentTone(input: ProjectInput): string {
  if (input.verification === "matchingRecordedContent") return "is-matching";
  if (input.verification === "differentContent") return "is-different";
  if (input.verification === "unavailable") return "is-unavailable";
  return "is-unchecked";
}

function outcomeKey(run: ProjectRun) {
  return run.outcome === "completed"
    ? ("projectRunCompleted" as const)
    : run.outcome === "failed"
      ? ("projectRunFailed" as const)
      : ("projectRunCancelled" as const);
}

export interface ProvenanceDetailsProps {
  readonly provenance: Provenance | null;
  readonly onSelect: (selection: ProjectSelection) => void;
}

export function ProvenanceDetails({ provenance, onSelect }: ProvenanceDetailsProps) {
  const t = useUiMessages();
  const locale = document.documentElement.lang || "en";

  if (provenance === null) {
    return (
      <section className="panel provenance" aria-label={t("provenanceRegion")}>
        <p className="provenance-empty">{t("provenanceNothingSelected")}</p>
      </section>
    );
  }

  /**
   * One relationship, as a control.
   *
   * An edge whose record the project no longer has keeps its row and says so.
   * Dropping it would shorten the list into a claim the document does not make.
   */
  function link<T extends { readonly id: string }>(
    related: Related<T>,
    kind: ProjectSelection["kind"],
    label: (record: T) => string,
    accessible: (record: T) => string,
    trailing?: (record: T) => React.ReactNode,
  ) {
    if (related.record === null) {
      return (
        <li key={related.id} className="provenance-link is-gone" data-provenance-gone={related.id}>
          <span>{t("provenanceRelatedGone")}</span>
        </li>
      );
    }
    const record = related.record;
    const name = label(record);
    return (
      <li key={related.id} className="provenance-link">
        <button
          type="button"
          className="link-button"
          aria-label={accessible(record)}
          data-provenance-link={related.id}
          onClick={() => onSelect({ kind, id: related.id })}
        >
          {name}
        </button>
        {trailing?.(record)}
      </li>
    );
  }

  /**
   * A reference's current file state.
   *
   * It appears beside recorded relationships as well as under its own heading,
   * because what a run used and what that file is now are both things a reader
   * needs in one place. So it carries the qualifier with it: a reader who
   * reaches this text without the heading above it -- or without the tone --
   * still hears that it is the *current* state and not what the run recorded.
   */
  function currentState(input: ProjectInput) {
    return (
      <span
        className={`provenance-current ${currentTone(input)}`}
        data-provenance-current={input.verification}
      >
        <span className="visually-hidden">{t("provenanceCurrentFile")}: </span>
        {t(currentStateKey(input))}
      </span>
    );
  }

  // The schema records one operation, and a document naming any other is
  // refused when it is opened -- so there is one name to give, and no branch
  // here for an operation that cannot reach this panel.
  const runName = () => t("projectOperationCapture");
  const inputName = (input: ProjectInput) => input.label;
  const artifactName = () => t("projectArtifactFileFacts");
  // Every capture is called the same thing, so a run and the record it
  // produced are named by when the run ended. Without that, a project with
  // three runs offers three controls with one name between them.
  const runAt = (run: ProjectRun) =>
    t("provenanceInspectRunAt", { when: recordedAt(run.finishedAt, locale) });
  const producedBy = (run: ProjectRun) =>
    t("provenanceInspectArtifactOf", { when: recordedAt(run.finishedAt, locale) });

  return (
    <section className="panel provenance" aria-label={t("provenanceRegion")}>
      {provenance.kind === "gone" ? (
        <>
          <p className="provenance-kind">{t("provenanceSelected")}</p>
          <p className="provenance-empty" data-provenance-selection-gone="">
            {t("provenanceSelectionGone")}
          </p>
        </>
      ) : provenance.kind === "input" ? (
        <div data-provenance="input">
          <p className="provenance-kind">{t("provenanceKindInput")}</p>
          <h3 className="provenance-name">{provenance.input.label}</h3>
          {/* Current, and labelled as current. The section below is history. */}
          <p className="provenance-section-label">{t("provenanceCurrentFile")}</p>
          <p className="provenance-current-row">{currentState(provenance.input)}</p>
          <p className="provenance-section-label">{t("provenanceUsedBy")}</p>
          {provenance.consumedBy.length === 0 ? (
            <p className="provenance-empty">{t("provenanceUsedByNothing")}</p>
          ) : (
            <ul className="provenance-list">
              {provenance.consumedBy.map((related) =>
                link(related, "run", runName, runAt, (run) => (
                  <span className="provenance-outcome">{t(outcomeKey(run))}</span>
                )),
              )}
            </ul>
          )}
        </div>
      ) : provenance.kind === "run" ? (
        <div data-provenance="run">
          <p className="provenance-kind">{t("provenanceKindRun")}</p>
          <h3 className="provenance-name">{t("projectOperationCapture")}</h3>
          <p className="provenance-current-row">
            <span className="provenance-outcome" data-provenance-outcome={provenance.run.outcome}>
              {t(outcomeKey(provenance.run))}
            </span>
          </p>
          <p className="provenance-section-label">{t("provenanceConsumed")}</p>
          <ul className="provenance-list">
            {provenance.inputs.map((related) =>
              link(
                related,
                "input",
                inputName,
                (input) => t("provenanceInspectInput", { name: input.label }),
                (input) => currentState(input),
              ),
            )}
          </ul>
          <p className="provenance-section-label">{t("provenanceProduced")}</p>
          {provenance.produced.length === 0 ? (
            <p className="provenance-empty" data-provenance-no-artifact="">
              {t("projectRunNoArtifact")}
            </p>
          ) : (
            <ul className="provenance-list">
              {provenance.produced.map((related) =>
                link(related, "artifact", artifactName, () => producedBy(provenance.run)),
              )}
            </ul>
          )}
          <p className="provenance-note">
            {t("projectRunVersion", { version: provenance.run.applicationVersion })}
          </p>
        </div>
      ) : (
        <div data-provenance="artifact">
          <p className="provenance-kind">{t("provenanceKindArtifact")}</p>
          <h3 className="provenance-name">{t("projectArtifactFileFacts")}</h3>
          {/* An artifact has no file of its own. Said, rather than left as a
              gap beside the references above, which do have one. */}
          <p className="provenance-current-row">
            <span className="provenance-stored" data-provenance-stored="">
              {t("provenanceArtifactStored")}
            </span>
          </p>
          <p className="provenance-section-label">{t("provenanceProducedBy")}</p>
          {provenance.producedBy === null ? (
            <p className="provenance-empty" data-provenance-no-producer="">
              {t("provenanceNoProducer")}
            </p>
          ) : (
            <ul className="provenance-list">
              {link(provenance.producedBy, "run", runName, runAt)}
            </ul>
          )}
          <p className="provenance-section-label">{t("provenanceSources")}</p>
          {provenance.sources.length === 0 ? (
            <p className="provenance-empty">{t("provenanceNoSources")}</p>
          ) : (
            <ul className="provenance-list">
              {provenance.sources.map((related) =>
                link(
                  related,
                  "input",
                  inputName,
                  (input) => t("provenanceInspectInput", { name: input.label }),
                  (input) => currentState(input),
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
