/**
 * What the selected project object is, and what it is related to.
 *
 * The contextual metadata region the accepted direction puts beside the
 * evidence area, filled for the Project surface. It renders four kinds of
 * object and the real relationships between them, and every relationship is a
 * control: activating one selects that object and re-reads this same panel.
 *
 * A layer is identity, not a file: its name is its source's label and its
 * current availability is whether that source's Workbench row is live. Its own
 * history is the QC captures that consumed it; its source's history is listed
 * separately, under the source's name.
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
 * An artifact has no current file state at all. File facts and a QC snapshot
 * are payloads inside the project document and there is no locator that could
 * name a file for either, so this says where it lives rather than leaving a gap
 * a reader would fill in with a guess. A QC snapshot's values are the report's
 * to show, in the main region; this says where it came from and which build
 * produced it.
 *
 * ## What activating a relationship does
 *
 * It changes which object is selected. That is the whole of it: no request is
 * sent, no file is read, no run is dispatched and the document is not touched.
 * The data was already here.
 */

import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { operationKey, recordedAt } from "./ProjectPanel";
import type { ProjectArtifact, ProjectInput, ProjectRun, QcSnapshot } from "./projectApi";
import { attachedRow, type Provenance, type ProjectSelection, type Related } from "./lineage";

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
  /**
   * Every row the workspace currently holds, so a layer's availability is
   * resolved against the roster rather than trusted from a remembered handle.
   */
  readonly liveDatasetHandles?: ReadonlySet<string>;
  /** Takes the reader to one row that is in the Workbench. Navigation only. */
  readonly onShowInWorkbench?: (handle: string) => void;
}

export function ProvenanceDetails({
  provenance,
  onSelect,
  liveDatasetHandles,
  onShowInWorkbench,
}: ProvenanceDetailsProps) {
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

  // The schema records two operations, and a document naming any other is
  // refused when it is opened -- so each run and each record is named by the
  // one kind it can be.
  const runName = (run: ProjectRun) => t(operationKey(run));
  const inputName = (input: ProjectInput) => input.label;
  const artifactName = (artifact: ProjectArtifact) =>
    t(
      artifact.kind === "acquisitionQcSnapshotV1"
        ? "projectArtifactQcSummary"
        : "projectArtifactFileFacts",
    );
  // Every capture of one kind is called the same thing, so a run and the record
  // it produced are named by when the run ended. Without that, a project with
  // three runs offers three controls with one name between them.
  const runAt = (run: ProjectRun) =>
    t("provenanceInspectRunAt", { when: recordedAt(run.finishedAt, locale) });
  const producedBy = (run: ProjectRun) =>
    t("provenanceInspectArtifactOf", { when: recordedAt(run.finishedAt, locale) });
  const inspectInput = (input: ProjectInput) =>
    t("provenanceInspectInput", { name: input.label });

  // A layer's row in the Workbench, resolved once, against the roster. Its
  // source may be gone, in which case there is no row to resolve.
  const layerSource = provenance.kind === "layer" ? provenance.source.record : null;
  const layerHandle = layerSource === null ? null : attachedRow(layerSource, liveDatasetHandles);
  const layerName = layerSource?.label ?? t("provenanceRelatedGone");

  /**
   * The runs that consumed one reference, or the sentence for none.
   *
   * The sentence is the caller's, because whose history this is differs: a
   * reference's own, or -- under a layer -- its source's.
   */
  function usedBy(
    consumedBy: readonly Related<ProjectRun>[],
    nothing:
      | "provenanceUsedByNothing"
      | "provenanceLayerSourceUsedByNothing"
      | "provenanceLayerUsedByNothing",
  ) {
    return consumedBy.length === 0 ? (
      <p className="provenance-empty">{t(nothing)}</p>
    ) : (
      <ul className="provenance-list">
        {consumedBy.map((related) =>
          link(related, "run", runName, runAt, (run) => (
            <span className="provenance-outcome">{t(outcomeKey(run))}</span>
          )),
        )}
      </ul>
    );
  }

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
          {usedBy(provenance.consumedBy, "provenanceUsedByNothing")}
          <p className="provenance-section-label">{t("provenanceLayer")}</p>
          {provenance.layer === null ? (
            <p className="provenance-empty" data-provenance-no-layer="">
              {t("provenanceNoLayer")}
            </p>
          ) : (
            <ul className="provenance-list">
              {link(
                { id: provenance.layer.id, record: provenance.layer },
                "layer",
                () => provenance.input.label,
                () => t("provenanceInspectLayer", { name: provenance.input.label }),
              )}
            </ul>
          )}
        </div>
      ) : provenance.kind === "layer" ? (
        <div data-provenance="layer">
          <p className="provenance-kind">{t("provenanceKindLayer")}</p>
          <h3 className="provenance-name">{layerName}</h3>
          {/* Current, and resolved against the roster: a remembered row that
              is no longer there is a layer that is not in the Workbench. */}
          <p className="provenance-section-label">{t("provenanceLayerAvailability")}</p>
          <p className="provenance-current-row">
            <span
              className={`provenance-current ${layerHandle === null ? "is-detached" : "is-attached"}`}
              data-provenance-availability={layerHandle === null ? "detached" : "attached"}
            >
              {t(layerHandle === null ? "projectLayerDetached" : "projectLayerAttached")}
            </span>
            {layerHandle === null ? null : (
              <button
                type="button"
                className="link-button"
                aria-label={t("projectShowInWorkbenchNamed", { name: layerName })}
                data-provenance-layer-show-in-workbench=""
                onClick={() => onShowInWorkbench?.(layerHandle)}
              >
                {t("projectShowInWorkbench")}
              </button>
            )}
          </p>
          <p className="provenance-section-label">{t("provenanceLayerSource")}</p>
          <ul className="provenance-list">
            {link(provenance.source, "input", inputName, inspectInput, (input) =>
              currentState(input),
            )}
          </ul>
          {/* The layer's own history: the QC captures that consumed it. */}
          <p className="provenance-section-label">{t("provenanceLayerUsedBy")}</p>
          {usedBy(provenance.usedBy, "provenanceLayerUsedByNothing")}
          {/* The source's history, named as the source's: the layer did not
              exist when those runs ran, and a heading that read as its own
              would say it had been used. */}
          <p className="provenance-section-label">{t("provenanceLayerSourceUsedBy")}</p>
          {usedBy(provenance.consumedBy, "provenanceLayerSourceUsedByNothing")}
        </div>
      ) : provenance.kind === "run" ? (
        <div data-provenance="run">
          <p className="provenance-kind">{t("provenanceKindRun")}</p>
          <h3 className="provenance-name">{runName(provenance.run)}</h3>
          <p className="provenance-current-row">
            <span className="provenance-outcome" data-provenance-outcome={provenance.run.outcome}>
              {t(outcomeKey(provenance.run))}
            </span>
          </p>
          <p className="provenance-section-label">{t("provenanceConsumed")}</p>
          <ul className="provenance-list">
            {provenance.inputs.map((related) =>
              link(related, "input", inputName, inspectInput, (input) => currentState(input)),
            )}
            {provenance.layers.map((related, index) => {
              const name = provenance.layerSources[index]?.label ?? t("provenanceRelatedGone");
              return link(
                related,
                "layer",
                () => name,
                () => t("provenanceInspectLayer", { name }),
              );
            })}
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
        <div data-provenance="artifact" data-artifact-kind={provenance.artifact.kind}>
          <p className="provenance-kind">{t("provenanceKindArtifact")}</p>
          <h3 className="provenance-name">{artifactName(provenance.artifact)}</h3>
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
          {provenance.artifact.qcSnapshot === null ? (
            <>
              <p className="provenance-section-label">{t("provenanceSources")}</p>
              {provenance.sources.length === 0 ? (
                <p className="provenance-empty">{t("provenanceNoSources")}</p>
              ) : (
                <ul className="provenance-list">
                  {provenance.sources.map((related) =>
                    link(related, "input", inputName, inspectInput, (input) =>
                      currentState(input),
                    ),
                  )}
                </ul>
              )}
            </>
          ) : (
            <>
              {/* A snapshot observed no reference itself. Its lineage is the
                  layer its run consumed, and that layer's source. */}
              <p className="provenance-section-label">{t("provenanceSourceLayer")}</p>
              <ul className="provenance-list">
                {provenance.layers.map((related, index) => {
                  const name =
                    provenance.layerSources[index]?.record?.label ?? t("provenanceRelatedGone");
                  return link(
                    related,
                    "layer",
                    () => name,
                    () => t("provenanceInspectLayer", { name }),
                  );
                })}
              </ul>
              <p className="provenance-section-label">{t("provenanceLayerSource")}</p>
              <ul className="provenance-list">
                {provenance.layerSources.map((related) =>
                  link(related, "input", inputName, inspectInput, (input) => currentState(input)),
                )}
              </ul>
              <ProducerFacts snapshot={provenance.artifact.qcSnapshot} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Which build produced the preview a snapshot copied, as MSCanvas identified
 * it at the time.
 *
 * Software facts, never a location: the executable's digest and the build's
 * reported release, date and revision. One that the build did not report is
 * said to be unreported rather than left blank. A later installation changes
 * none of it.
 */
function ProducerFacts({ snapshot }: { readonly snapshot: QcSnapshot }) {
  const t = useUiMessages();
  const producer = snapshot.producer;
  const reported = (value: string | null) =>
    value === null ? (
      <span className="provenance-empty">{t("provenanceProducerNotReported")}</span>
    ) : (
      value
    );
  return (
    <>
      <p className="provenance-section-label">{t("provenanceProducer")}</p>
      <dl className="provenance-facts" data-provenance-producer="">
        <dt>{t("provenanceProducerTool")}</dt>
        <dd data-producer-tool={producer.tool}>{t("provenanceProducerMsaccess")}</dd>
        <dt>{t("provenanceProducerRelease")}</dt>
        <dd>{reported(producer.release)}</dd>
        <dt>{t("provenanceProducerBuildDate")}</dt>
        <dd>{reported(producer.buildDate)}</dd>
        <dt>{t("provenanceProducerRevision")}</dt>
        <dd>{reported(producer.sourceRevision)}</dd>
        <dt>{t("provenanceProducerDigest")}</dt>
        <dd className="provenance-digest" data-producer-digest="">
          {producer.executableSha256}
        </dd>
      </dl>
      <p className="provenance-note">{t("provenanceProducerNote")}</p>
    </>
  );
}
