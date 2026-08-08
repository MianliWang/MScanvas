import type { ReactElement } from "react";

import type {
  ConversionConflictPolicy,
  ConversionQueueItem,
  ConversionReport,
} from "./contracts";
import type { ConversionOperation } from "./useConversionOperation";

/**
 * What each conflict policy means, in the user's terms rather than the
 * boundary's. Exhaustive over the union, so a third policy fails compilation
 * here rather than rendering as a blank radio.
 */
const CONFLICT_POLICY_LABEL: Record<ConversionConflictPolicy, string> = {
  fail: "Stop if a file of that name already exists",
  skip: "Skip if a file of that name already exists",
};

const CONFLICT_POLICIES: readonly ConversionConflictPolicy[] = ["fail", "skip"];

/**
 * The one sentence this workflow must always say about what it verified.
 *
 * A vendor acquisition has no mzML reading, so nothing about the output can be
 * compared to a source model. Saying so before the conversion and again after
 * it is the difference between a checked file and a file that merely converted
 * without erroring.
 */
const OUTPUT_ONLY_DISCLOSURE =
  "Output-only validation. This does not compare the converted data with a readable vendor-source spectrum model.";

/** What each staging residue means for the folder the user chose. */
const RESIDUE_EXPLANATION = "MSCanvas could not remove its own temporary folder afterwards.";

export interface ConversionPanelProps {
  readonly conversion: ConversionOperation;
  /** The rows this panel would queue, in the order they would run. */
  readonly handles: readonly string[];
  /** How many selected rows are not convertible and are therefore excluded. */
  readonly excludedSelectedCount: number;
  /** Whether anything else is already occupying the one backend lane. */
  readonly canConvert: boolean;
}

/**
 * The focused row's conversion: what it would do, and what it did.
 *
 * Acts on exactly one row — the focused one — and never on the selection. A
 * selection is a set the user built for removing rows; converting is one
 * acquisition at a time, and an action that read the selection would be an
 * action whose scope changed as they curated the list.
 */
export function ConversionPanel({
  conversion,
  handles,
  excludedSelectedCount,
  canConvert,
}: ConversionPanelProps): ReactElement | null {
  const { state, plan } = conversion;
  const terminal = state.status === "terminal";

  // Nothing to say. The panel is not a permanent fixture: with no convertible
  // row focused and no operation to report, it would be a heading over an empty
  // space in the one column the roster is trying to use.
  if (!conversion.busy && !terminal && plan.status === "none") {
    return null;
  }

  return (
    <section
      aria-busy={conversion.busy}
      aria-labelledby="conversion-panel-heading"
      className="panel conversion-panel"
    >
      <header className="panel-header compact">
        <div>
          <h2 id="conversion-panel-heading">Convert</h2>
          <p>One acquisition at a time. The original file is never changed.</p>
        </div>
      </header>

      {conversion.error === null ? null : (
        <div className="notice notice-danger" role="status">
          <span>{conversion.error.summary}</span>
          <button className="link-button" onClick={conversion.dismissError} type="button">
            Dismiss
          </button>
        </div>
      )}

      {conversion.busy || terminal ? <QueueState conversion={conversion} /> : null}
      {/* Not while a queue is under way. The plan is an ordered list of file to
          output and so is the running queue, and two of them one above the other
          — one live, one hypothetical, and the hypothetical one's button
          disabled — is the panel describing two different things in the same
          shape. A finished queue is different: there the plan is how the user
          converts something else, so it stays. */}
      {conversion.busy || plan.status === "none" ? null : (
        <PlanState
          canConvert={canConvert}
          conversion={conversion}
          excludedSelectedCount={excludedSelectedCount}
          handles={handles}
          repeating={terminal}
        />
      )}
    </section>
  );
}

/** What a queue would do, and the one control that starts it. */
function PlanState({
  conversion,
  handles,
  excludedSelectedCount,
  canConvert,
  repeating,
}: {
  readonly conversion: ConversionOperation;
  readonly handles: readonly string[];
  readonly excludedSelectedCount: number;
  readonly canConvert: boolean;
  /** Whether a previous result is on screen above this plan. */
  readonly repeating: boolean;
}): ReactElement | null {
  const { plan } = conversion;
  // With a result above it, silence is better than a second empty state.
  if (repeating && plan.status !== "loaded") {
    return null;
  }
  if (plan.status === "loading") {
    return <div className="empty-state">Reading the conversion plan…</div>;
  }
  if (plan.status === "failed") {
    return (
      <div className="empty-state">
        <span>{plan.error.summary}</span>
      </div>
    );
  }
  if (plan.status === "none") {
    return <div className="empty-state">Select or focus a Thermo RAW row to convert it.</div>;
  }

  const summary = plan.plan;
  const count = summary.items.length;
  return (
    <div className="conversion-plan">
      <p id="conversion-plan-summary">
        {count === 1
          ? "One Thermo RAW acquisition will be converted to mzML."
          : `${String(count)} Thermo RAW acquisitions will be converted to mzML, one after another, in the order below.`}
        {excludedSelectedCount === 0
          ? ""
          : ` ${String(excludedSelectedCount)} selected ${
              excludedSelectedCount === 1 ? "row is" : "rows are"
            } already mzML and ${excludedSelectedCount === 1 ? "is" : "are"} not part of this conversion.`}
      </p>

      <ol className="conversion-queue-list">
        {summary.items.map((item, index) => (
          <li key={item.datasetHandle}>
            <span className="conversion-queue-order">{index + 1}</span>
            <span className="conversion-queue-name" title={item.fileName}>
              {item.fileName}
            </span>
            <span aria-hidden="true">→</span>
            <span className="visually-hidden">converts to </span>
            <span className="conversion-queue-output" title={item.outputFileName}>
              {item.outputFileName}
            </span>
          </li>
        ))}
      </ol>

      <dl className="metadata-list">
        <div>
          <dt>Output</dt>
          <dd>{summary.outputFormat}</dd>
        </div>
        <div>
          <dt>Compression</dt>
          <dd>{summary.compression}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>One folder, chosen next</dd>
        </div>
      </dl>

      <p className="quiet-text" id="conversion-validation-disclosure" role="note">
        {OUTPUT_ONLY_DISCLOSURE} They run one at a time and cannot be cancelled.
      </p>

      <fieldset className="conversion-conflict">
        <legend>If an output name is taken</legend>
        {CONFLICT_POLICIES.map((policy) => (
          <label key={policy}>
            <input
              checked={conversion.conflictPolicy === policy}
              name="conversion-conflict-policy"
              onChange={() => {
                conversion.setConflictPolicy(policy);
              }}
              type="radio"
              value={policy}
            />
            {CONFLICT_POLICY_LABEL[policy]}
          </label>
        ))}
      </fieldset>

      <div className="conversion-actions">
        <button
          aria-describedby="conversion-plan-summary conversion-validation-disclosure"
          className="primary-button"
          disabled={!canConvert || handles.length === 0}
          onClick={() => {
            conversion.convert(handles);
          }}
          type="button"
        >
          {count === 1 ? "Convert focused…" : `Convert ${String(count)} selected…`}
        </button>
      </div>
    </div>
  );
}

/**
 * A queue under way, or the one that just finished.
 *
 * Item-count progress and nothing else. Nothing measures a fraction of a
 * `msconvert` run, and this workflow genuinely cannot stop one — so it says so
 * instead of offering a control that would only stop watching.
 */
function QueueState({
  conversion,
}: {
  readonly conversion: ConversionOperation;
}): ReactElement | null {
  const state = conversion.state;
  if (state.status === "idle") {
    return null;
  }
  const { queue } = state;
  const done = queue.finalizedCount + queue.skippedCount + queue.failedCount;
  return (
    <div className="conversion-running">
      {state.status === "awaitingDestination" ? (
        <p>Choose where to save the converted mzML.</p>
      ) : state.status === "running" ? (
        <>
          <p>
            {`Converting item ${String(Math.min(queue.currentIndex + 1, queue.itemCount))} of ${String(queue.itemCount)}…`}
          </p>
          <p className="quiet-text" role="note">
            This conversion workflow cannot cancel a running queue.
          </p>
        </>
      ) : (
        <p>
          {`${String(queue.finalizedCount)} converted, ${String(queue.skippedCount)} skipped, ${String(queue.failedCount)} failed of ${String(queue.itemCount)}.`}
        </p>
      )}

      {queue.error === null ? null : (
        <p className="notice notice-danger" role="status">
          {queue.error.summary}
        </p>
      )}

      <ol className="conversion-queue-list">
        {queue.items.map((item, index) => (
          <li key={item.datasetHandle} data-item-state={item.state}>
            <span className="conversion-queue-order">{index + 1}</span>
            <span className="conversion-queue-name" title={item.fileName}>
              {item.fileName}
            </span>
            <span aria-hidden="true">→</span>
            <span className="visually-hidden">converts to </span>
            <span className="conversion-queue-output" title={item.outputFileName}>
              {item.outputFileName}
            </span>
            <span className="visually-hidden">, </span>
            <span className="conversion-queue-status">{ITEM_STATE_LABEL[item.state]}</span>
            {item.attempts > 1 ? (
              <>
                <span className="visually-hidden">, </span>
                <span className="conversion-queue-attempts">
                  {`attempt ${String(item.attempts)}`}
                </span>
              </>
            ) : null}
            {item.state === "failed" ? (
              <>
                <span className="visually-hidden">, </span>
                <span className="conversion-queue-reason">{itemFailureSentence(item)}</span>
              </>
            ) : null}
          </li>
        ))}
      </ol>

      {state.status === "terminal" ? (
        <>
          {done > 0 ? (
            <p className="quiet-text" role="note">
              {OUTPUT_ONLY_DISCLOSURE}
            </p>
          ) : null}
          <p className="quiet-text">
            Converted files were not added to the workspace. Add them with Add files… when you
            want to look at them.
          </p>
          {queue.retryableFailedCount === 0 ? (
            queue.nonRetryableFailedCount === 0 ? null : (
              <p className="quiet-text" role="note">
                Those failures would not change on another attempt with the same acquisitions,
                folder and settings.
              </p>
            )
          ) : (
            <div className="conversion-actions">
              <button
                aria-describedby="conversion-retry-scope"
                className="secondary-button"
                onClick={conversion.retry}
                type="button"
              >
                {`Retry ${String(queue.retryableFailedCount)} failed`}
              </button>
              <span className="visually-hidden" id="conversion-retry-scope">
                Reruns only the failures another attempt could change, using the same folder, the
                same conflict setting and the same order. Converted and skipped files are left as
                they are.
              </span>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/** What each item state says, in words rather than in colour. */
const ITEM_STATE_LABEL: Record<ConversionQueueItem["state"], string> = {
  pending: "Waiting",
  running: "Converting",
  finalized: "Converted",
  skipped: "Skipped — a file of that name was already there",
  failed: "Failed",
};

/** Why one item failed, from whichever half of the boundary refused it. */
function itemFailureSentence(item: ConversionQueueItem): string {
  if (item.error !== null) {
    return item.error.summary;
  }
  if (item.report === null) {
    return "The conversion did not finish, so no file was written.";
  }
  return failureSentence(item.report);
}

/**
 * What a failed conversion says.
 *
 * Grouped by the boundary's own outcome and explained by its detailed one, with
 * a fallback that is honest rather than specific: an identifier this build has
 * no sentence for is still a failure, and inventing prose for it would be
 * inventing a diagnosis.
 */
function failureSentence(report: ConversionReport): string {
  // Grouped by `outcome` first, because that is what groups. An integrity
  // rejection's `detailedOutcome` is the specific property that failed --
  // `partial_output`, `missing_output` and the rest -- so matching on it here
  // would leave every one of them falling through to the generic sentence and
  // never say that a file was produced and then discarded.
  if (report.outcome === "output_rejected") {
    return "The converted file did not pass MSCanvas' integrity checks, so it was discarded.";
  }
  switch (report.detailedOutcome) {
    case "destination_exists":
      return "A file of that name is already in that folder, so nothing was converted.";
    case "source_family_not_evidenced":
      return "MSCanvas has no conversion evidence for this acquisition format on the installed ProteoWizard build.";
    default:
      return "The conversion did not finish, so no file was written.";
  }
}
