import type { ReactElement } from "react";

import type {
  ConversionConflictPolicy,
  ConversionQueue,
  ConversionQueueItem,
  ConversionReport,
} from "./contracts";
import { formatByteLength, formatCount, formatDuration } from "./format";
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

/**
 * What Stop queue does, said before it is pressed.
 *
 * Both halves matter. The first is what the user is asking for; the second is
 * what they are not losing, and without it "stop" reads as "undo" over files
 * that are already written and already theirs.
 */
const STOP_EXPLANATION =
  "Stops the current conversion and prevents remaining items from starting. Outputs already completed stay in place.";

/**
 * What is true while a stop is in flight.
 *
 * Deliberately silent about the current item. Whether it is cancelled or
 * finishes on its own is decided by which the process boundary observes first,
 * and a prediction here is a claim the next read could contradict.
 */
const STOP_IN_FLIGHT_EXPLANATION =
  "No further items will start. The current conversion may still finish on its own.";

/**
 * What adding the outputs does, said before it is pressed.
 *
 * The first half is the promise this workflow is unusual for making: the file
 * that enters the workspace is checked to still be the exact one this queue
 * wrote, not merely a file of that name. The second is what it deliberately
 * does not do -- reading a converted file is a separate thing to ask for, and a
 * workflow that opened one would decide what the user is looking at.
 */
const ADOPT_EXPLANATION =
  "MSCanvas verifies that each output is still the exact finalized file before adding it. Outputs are not previewed automatically.";

/**
 * What is true while an adoption is in flight.
 *
 * Not called converting: nothing is being converted, and a second word for the
 * same workflow would be the panel describing two things at once. No
 * percentage, because nothing measures a fraction of a file being checked.
 */
const ADOPT_IN_FLIGHT = "Adding converted outputs…";

/** Why one output was not added, in the user's terms rather than the boundary's. */
const ADOPTION_REFUSAL_LABEL: Record<string, string> = {
  output_missing: "no longer in the destination folder",
  output_changed: "changed since it was converted",
  output_unreadable: "could not be read",
  output_not_mzml: "is no longer a readable mzML file",
  workspace_full: "the workspace is full",
};

export interface ConversionPanelProps {
  readonly conversion: ConversionOperation;
  /**
   * Where the rows came from, which is what the action may call them.
   *
   * One selected row is still a selected row: labelling it `Convert focused…`
   * would name a row the action might not be acting on.
   */
  readonly scope: "selection" | "focused";
  /** The rows this panel would queue, in the order they would run. */
  readonly handles: readonly string[];
  /** How many selected rows are not convertible and are therefore excluded. */
  readonly excludedSelectedCount: number;
  /** Whether anything else is already occupying the one backend lane. */
  readonly canConvert: boolean;
}

/**
 * The conversion queue: what it would do, and what it did.
 *
 * Acts on the selection where there is one and on the focused row otherwise, so
 * a multi-row selection becomes a queue without a second control. The scope a
 * selection gives is a set the user curates, so the whole of it — the ordered
 * list, the name each item would write, and the rows excluded for being mzML
 * already — is on screen before the action is pressed, and it is bound at that
 * moment rather than tracked afterwards.
 */
export function ConversionPanel({
  conversion,
  scope,
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

      {conversion.busy || terminal ? (
        <QueueState canConvert={canConvert} conversion={conversion} />
      ) : null}
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
          scope={scope}
        />
      )}
    </section>
  );
}

/**
 * Adding this queue's finalized outputs to the workspace, and what that did.
 *
 * Offered only for a terminal queue that finalized something, and offered
 * whatever else is true of that queue: a stop that kept one output, or a stop
 * that could not be confirmed, both leave real files behind, and adding them
 * launches nothing. Retry and this are mutually exclusive because one of them
 * replaces the results the other is reading.
 */
function AdoptOutputs({
  conversion,
}: {
  readonly conversion: ConversionOperation;
}): ReactElement {
  const { adoption, eligibleOutputCount } = conversion;
  const added = adoption?.outcomes.filter((outcome) => outcome.kind === "added") ?? [];
  const duplicates =
    adoption?.outcomes.filter((outcome) => outcome.kind === "alreadyInWorkspace") ?? [];
  const refused =
    adoption?.outcomes.filter((outcome) => outcome.kind === "refused") ?? [];

  if (eligibleOutputCount === 0) {
    // Nothing finalized, so there is nothing to offer and nothing to explain.
    // The queue's own result already says what happened to each item.
    return (
      <p className="quiet-text">
        Nothing was converted, so there is nothing to add to the workspace.
      </p>
    );
  }

  if (conversion.adopting) {
    return (
      <div className="conversion-adoption">
        <p>{ADOPT_IN_FLIGHT}</p>
      </div>
    );
  }

  if (adoption !== null && added.length === 0 && refused.length === 0) {
    return (
      <div className="conversion-adoption">
        <p>All finalized outputs from this queue are already in the workspace.</p>
      </div>
    );
  }

  return (
    <div className="conversion-adoption">
      {adoption === null ? (
        <>
          <p>
            {eligibleOutputCount === 1
              ? "1 converted mzML output is ready to add to this workspace."
              : `${String(eligibleOutputCount)} converted mzML outputs are ready to add to this workspace.`}
          </p>
          <div className="conversion-actions">
            <button
              type="button"
              className="primary-button"
              aria-describedby="conversion-adopt-scope"
              disabled={!conversion.canAdopt}
              onClick={conversion.adopt}
            >
              {eligibleOutputCount === 1
                ? "Add converted output to workspace"
                : "Add converted outputs to workspace"}
            </button>
          </div>
          <p className="quiet-text" id="conversion-adopt-scope" role="note">
            {ADOPT_EXPLANATION}
          </p>
        </>
      ) : (
        <>
          <p className="conversion-adoption-summary">
            {`${String(added.length)} added, ${String(duplicates.length)} already in the workspace, ${String(refused.length)} not added.`}
          </p>
          {refused.slice(0, 3).map((outcome) => (
            <p className="quiet-text" key={`${String(outcome.itemIndex)}-${outcome.outputFileName}`}>
              {`${outcome.outputFileName} was not added: ${
                ADOPTION_REFUSAL_LABEL[outcome.kind === "refused" ? outcome.reason : ""] ??
                "it could not be verified"
              }.`}
            </p>
          ))}
          {refused.length > 3 ? (
            <p className="quiet-text">
              {`${String(refused.length - 3)} more were not added.`}
            </p>
          ) : null}
        </>
      )}
      {/* Said whether or not anything was added. A queue that is replaced drops
          the way MSCanvas recognises these files, and nothing about that
          removes them -- so the honest fallback is named rather than left to be
          discovered. */}
      <p className="quiet-text">
        Finalized files remain on disk. If this queue is replaced, they can still be added later
        with Add files….
      </p>
    </div>
  );
}

/** What a queue would do, and the one control that starts it. */
function PlanState({
  conversion,
  handles,
  excludedSelectedCount,
  canConvert,
  repeating,
  scope,
}: {
  readonly conversion: ConversionOperation;
  readonly handles: readonly string[];
  readonly excludedSelectedCount: number;
  readonly canConvert: boolean;
  readonly scope: "selection" | "focused";
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
        {OUTPUT_ONLY_DISCLOSURE} They run one at a time, and Stop queue ends the whole queue
        rather than one item.
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
          {scope === "focused" ? "Convert focused…" : `Convert ${String(count)} selected…`}
        </button>
      </div>
    </div>
  );
}

/**
 * A queue under way, or the one that just finished.
 *
 * Item-count progress and nothing else: nothing measures a fraction of a
 * `msconvert` run, so a percentage here would be invented.
 *
 * A running queue can be stopped, and the control that does it is a queue-level
 * one. It really stops the work rather than stopping the watching, which is why
 * the copy beside it says what survives the stop before it is pressed.
 */
function QueueState({
  conversion,
  canConvert,
}: {
  readonly conversion: ConversionOperation;
  /** Whether anything else is already occupying the one backend lane. */
  readonly canConvert: boolean;
}): ReactElement | null {
  const state = conversion.state;
  if (state.status === "idle") {
    return null;
  }
  const { queue } = state;
  // A retry this document dispatched and has not been answered for. The slot
  // still reads `terminal` -- Rust answers once, when the whole rerun is over --
  // so without this the panel would go on showing the old result and go on
  // offering the very control that is already running. Read from the operation
  // rather than derived, so this and the live region cannot disagree.
  const retrying = conversion.retrying && state.status === "terminal";
  return (
    <div className="conversion-running">
      {retrying ? (
        <>
          <p>Retrying the failures…</p>
          {/* True for as long as this branch is on screen, which is until the
              state read dispatched beside the retry reports the rerun running.
              The sentence it replaced said this workflow could not cancel a
              running queue, which stopped being true in this release. */}
          <p className="quiet-text" role="note">
            Stop queue becomes available once the rerun is under way.
          </p>
        </>
      ) : state.status === "awaitingDestination" ? (
        <p>Choose where to save the converted mzML.</p>
      ) : state.status === "stopping" ||
        (state.status === "running" && conversion.stopping) ? (
        <>
          <p>Stopping queue…</p>
          {/* Deliberately says nothing about how the current item will end.
              Whether it is cancelled or finishes on its own is decided by
              which the process boundary observes first, and predicting it here
              would put a claim on screen that the next read could contradict. */}
          <p className="quiet-text" role="note">
            {STOP_IN_FLIGHT_EXPLANATION}
          </p>
        </>
      ) : state.status === "running" ? (
        <>
          <p>
            {`Converting item ${String(runningPosition(queue))} of ${String(queue.itemCount)}…`}
          </p>
          <div className="conversion-actions">
            <button
              type="button"
              className="secondary-button"
              aria-describedby="conversion-stop-scope"
              disabled={!conversion.canStop}
              onClick={conversion.stop}
            >
              Stop queue
            </button>
          </div>
          <p className="quiet-text" id="conversion-stop-scope" role="note">
            {STOP_EXPLANATION}
          </p>
        </>
      ) : state.reason === "stopFailed" ? (
        // Deliberately not "Queue stopped". That state means a converter may
        // still be running, and a heading someone skims is exactly where the
        // claim must not be made and then walked back by the warning below it.
        <p>Stop could not be confirmed</p>
      ) : state.reason === "stopped" ? (
        <p>Queue stopped</p>
      ) : (
        <p>
          {`${String(queue.finalizedCount)} converted, ${String(queue.skippedCount)} skipped, ${String(queue.failedCount)} failed of ${String(queue.itemCount)}.`}
        </p>
      )}

      {state.status === "terminal" && state.reason === "stopFailed" ? (
        <p className="notice notice-danger" role="alert">
          <span aria-hidden="true">⚠ </span>
          MSCanvas could not confirm that the backend process stopped.
          {conversion.backendQuarantined
            ? " Restart MSCanvas before starting another preview or conversion."
            : ""}
        </p>
      ) : null}

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
            {/* What was actually produced, per item. A queue that said only
                `Converted` would have taken away the one thing that lets a user
                tell a real conversion from an empty one. */}
            {item.report?.output == null ? null : (
              <>
                <span className="visually-hidden">, </span>
                <span className="conversion-queue-facts">
                  {`${formatByteLength(item.report.output.byteLength)}, ${formatCount(
                    item.report.output.spectrumCount,
                  )} spectra, ${formatCount(item.report.output.chromatogramCount)} chromatograms`}
                  {item.report.backend === null
                    ? ""
                    : `, ${formatDuration(item.report.backend.elapsedMilliseconds)}`}
                </span>
              </>
            )}
            {/* Cleanup failing is the user's problem, not only MSCanvas', because
                what is left behind is in the folder they chose. Read from both
                places it can be recorded: a cancelled item has no report by
                construction, so a residue it left would otherwise be knowable
                to MSCanvas and invisible to the person whose folder it is in. */}
            {(item.report?.stagingResidue ?? item.cancellation?.stagingResidue) == null ? null : (
              <>
                <span className="visually-hidden">, </span>
                <span className="conversion-queue-residue">{RESIDUE_EXPLANATION}</span>
              </>
            )}
          </li>
        ))}
      </ol>

      {state.status === "terminal" && !retrying ? (
        <>
          {/* Only where something was actually judged. A queue whose items were
              all skipped or all failed validated nothing -- and a skipped item's
              existing file was explicitly not inspected, so claiming
              output-only validation over it would claim a check nobody ran. */}
          {queue.items.some((item) => item.report?.validation != null) ? (
            <p className="quiet-text" role="note">
              {OUTPUT_ONLY_DISCLOSURE}
            </p>
          ) : null}
          {/* The counts a stopped queue is judged by, said in full and kept
              apart. A cancelled item is not a failure and a not-run item is
              not an attempt, so folding either into `failed` would report work
              the user stopped as work that broke. */}
          {state.reason === "completed" ? null : (
            <>
              <p className="conversion-stopped-summary">
                {stoppedSummary(queue)}
              </p>
              <p className="quiet-text">
                Completed outputs remain in the destination folder. Cancelled and not-run items
                were not finalized by this queue.
              </p>
            </>
          )}
          <AdoptOutputs conversion={conversion} />
          {/* A stopped queue is terminal and is not rerun in place. Converting
              those rows again is a new queue, made from the roster, which is
              the ordinary path the selection workflow already offers. */}
          {/* Not while an adoption is under way. A retry replaces the very
              results the adoption is reading, so the two are never both live.
              Removed rather than disabled: an action that is coming back is a
              different thing from one that is refused. */}
          {state.reason !== "completed" || conversion.adopting ? null : queue.retryableFailedCount ===
            0 ? (
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
                // The same gate the primary action answers to. A retry is a
                // conversion, so an unavailable ProteoWizard, a recheck in
                // flight or a preview still holding the lane refuse it for the
                // same reasons -- and offering it anyway would buy a certain
                // error or a long silent wait.
                disabled={!canConvert}
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

/**
 * Which item is running, counting from one.
 *
 * The item that says it is running, not the queue's position. The position
 * counts what is done, and during a run the two agree -- but the live region and
 * the roster both read the state, and a third reader that trusted the position
 * would name a different acquisition than they marked the moment they did not.
 * Falls back to the position, because a queue between items has no running item
 * and still has a number to show.
 */
/**
 * What a stopped queue actually did, counted apart.
 *
 * Every count is named, including the zeroes. A summary that dropped the empty
 * ones would read differently for two queues that ended the same way, and the
 * one number a user most needs to trust here is how many files are in the
 * folder.
 */
function stoppedSummary(queue: ConversionQueue): string {
  const parts = [
    `${String(queue.finalizedCount)} converted`,
    `${String(queue.skippedCount)} skipped`,
    `${String(queue.failedCount)} failed`,
    `${String(queue.cancelledCount)} cancelled`,
    `${String(queue.notRunCount)} not run`,
  ];
  if (queue.cancellationFailedCount > 0) {
    parts.push(`${String(queue.cancellationFailedCount)} stop could not be confirmed`);
  }
  return `${parts.join(", ")} of ${String(queue.itemCount)}.`;
}

function runningPosition(queue: ConversionQueue): number {
  const running = queue.items.findIndex((item) => item.state === "running");
  if (running !== -1) {
    return running + 1;
  }
  // Between items, the next one is the first still pending -- not the count of
  // what is done. A retry reruns failures wherever they sit, so with items 2
  // and 4 failed the count says three and the answer is two.
  const next = queue.items.findIndex((item) => item.state === "pending");
  return next === -1 ? Math.min(queue.currentIndex + 1, queue.itemCount) : next + 1;
}

/** What each item state says, in words rather than in colour. */
const ITEM_STATE_LABEL: Record<ConversionQueueItem["state"], string> = {
  cancelled: "Cancelled",
  cancellationFailed: "Stop could not be confirmed",
  notRun: "Not run",
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
