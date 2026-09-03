import type { ReactElement } from "react";

import type {
  ConversionConflictPolicy,
  ConversionIntent,
  ConversionOutputSetReport,
  ConversionQueue,
  ConversionQueueItem,
  ConversionQueuePlan,
  ConversionQueuePlanItem,
  ConversionReport,
  DatasetSourceKind,
} from "./contracts";
import { conversionJudgedAnyOutput, SOURCE_KIND_LABEL } from "./contracts";
import type {
  ConversionAvailability,
  ConversionUnavailableReason,
} from "./conversionAvailability";
import type { ConversionPlanState } from "./useConversionOperation";
import { conversionAvailability, conversionNoticeId } from "./conversionAvailability";
import {
  CONVERSION_VALUE_LABEL,
  ConversionSettings,
  conversionIntentDisclosures,
} from "./ConversionSettings";
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

/**
 * The plan summary sentence, family-aware.
 *
 * A homogeneous queue names its exact family, because "vendor" is vaguer than
 * what is known. A mixed queue counts first and then itemizes per family, in
 * plan order, so the sentence stays true for whatever combination the closed
 * vocabulary allows -- there is deliberately no generic vendor wording that a
 * new family could hide inside.
 *
 * The format is the plan's, not a word written here. It used to say "mzML"
 * because this file knew that was the answer; since M6.4 the plan carries the
 * intent Rust resolved, and a sentence that stated the format from local
 * knowledge would be a second authority on what the conversion will produce.
 */
function describeQueueFamilies(
  items: readonly ConversionQueuePlanItem[],
  format: ConversionIntent["format"],
): string {
  const counts = new Map<DatasetSourceKind, number>();
  for (const item of items) {
    counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  }
  const count = items.length;
  const first = items[0];
  if (counts.size === 1 && first !== undefined) {
    const family = SOURCE_KIND_LABEL[first.sourceKind];
    return count === 1
      ? `One ${family} acquisition will be converted to ${format}.`
      : `${String(count)} ${family} acquisitions will be converted to ${format}, one after another, in the order below.`;
  }
  const perFamily = [...counts.entries()]
    .map(([kind, familyCount]) => `${String(familyCount)} ${SOURCE_KIND_LABEL[kind]}`)
    .join(" · ");
  return `${String(count)} supported vendor acquisitions will be converted to ${format}, one after another, in the order below. ${perFamily}.`;
}

/**
 * What a backend-named set produces, said before it runs.
 *
 * A range and not a number, because the number is not known: the backend reads
 * the acquisition and decides how many documents it writes. The bound is the
 * lifecycle's own, carried on the plan so this states what Rust enforces rather
 * than a constant of its own.
 */
function outputSetSummary(maxMembers: number): string {
  return `1–${String(maxMembers)} mzML outputs`;
}

/**
 * Why no filename is shown for a set.
 *
 * Said rather than left blank. A user who sees a name for every other row and
 * nothing for this one is owed the reason, and the reason is not that MSCanvas
 * does not know yet -- it is that the name is the backend's to choose.
 */
const OUTPUT_SET_NAMING = "Filenames determined during conversion";

/**
 * What a full set publication establishes, in the only words the evidence
 * supports.
 *
 * Every clause is load-bearing. "Identified by the SCIEX reader" is narrower
 * than "in the acquisition", and the difference is exactly what this milestone
 * did not measure: the audit proves no sample the reader found was lost, not
 * that the reader found them all.
 */
const SAMPLE_COMPLETENESS_CLAIM =
  "Every sample identified by the SCIEX reader produced its output.";

/**
 * What a partially finalized acquisition means for the user.
 *
 * Deliberately not "nothing was converted", which is what a count-of-items
 * reading would produce and which is false: the finalized prefix is real, it is
 * in the folder they chose, and nothing here removes it. What it is not is the
 * acquisition's output set, which is why MSCanvas will not offer it as one.
 */
const PARTIAL_FINALIZATION_EXPLANATION =
  "Some mzML files were finalized, but the complete output set was not produced, so MSCanvas cannot add this acquisition's outputs as a complete set. The finalized files remain in the destination folder and can be added individually later with Add files….";

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

/**
 * The one sentence this action must never be offered without.
 *
 * Three claims in order, and the order is the argument. Local, so nobody looks
 * for an upload. Redacted, so the effort is stated. And then the limit — backend
 * text is written by an instrument's software about a real acquisition, and no
 * amount of path removal makes that anonymous. It ends by asking for the one
 * thing that actually protects the user, which is reading the file.
 */
const DIAGNOSTICS_EXPLANATION =
  "Saves a local redacted JSON file. Known filesystem paths and internal identifiers are removed, but backend text may still contain acquisition metadata. Review the file before sharing.";

/**
 * What is true while an export is being written.
 *
 * No percentage. The file is bounded at a couple of megabytes and is written in
 * one go, so a fraction would be a number invented to fill a progress bar.
 */
const DIAGNOSTICS_IN_FLIGHT = "Saving diagnostics…";

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
}: ConversionPanelProps): ReactElement | null {
  const { state, plan } = conversion;
  const terminal = state.status === "terminal";

  // The two decisions this panel offers, each projected from the one lane the
  // operation is guarded with. Not a boolean handed down from the workspace:
  // that boolean was wider than the guard in one direction and narrower in the
  // other, and `Retry` answered to it as well.
  //
  // The start's target is the panel's to supply, because the rows are. The
  // rerun's target belongs to the slot, so the operation carries that decision
  // whole.
  const startAvailability = conversionAvailability(conversion.lane, {
    kind: "start",
    targetCount: handles.length,
    // Read from the operation rather than re-derived. Whether the chosen
    // semantic is runnable, and whether the plan on screen answers the request
    // as it now stands, are decided once beside the plan that answers them.
    settings: conversion.settingsReadiness,
    planIsCurrent: conversion.planIsCurrent,
  });
  const { retryAvailability } = conversion;

  /*
   * Which of the two controls is on screen at all.
   *
   * Decided once, here, and handed down. `Retry` is *removed* rather than
   * disabled while an adoption or an export is reading the queue it would
   * replace -- an action that is coming back is a different thing from one that
   * is refused -- and the explanation below must not name a control the reader
   * cannot see. Deriving this a second time inside the branch that renders it
   * is how the sentence and the button would come to disagree.
   */
  // Offered whenever there is something to convert, whether or not the plan
  // has arrived. A refused control that explains itself is the M6.1 rule; a
  // control that vanishes while its plan is read is a sentence with nothing
  // beside it.
  const startOffered = !conversion.busy && plan.status !== "none";
  const retryOffered =
    state.status === "terminal" &&
    state.reason === "completed" &&
    state.queue.retryableFailedCount > 0 &&
    !conversion.adopting &&
    !conversion.exportingDiagnostics &&
    // A dispatch of either kind takes the whole finished-queue block with it,
    // so neither the control nor a sentence about it is on screen to explain.
    !conversion.retrying &&
    !conversion.converting;

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
          {/* Both halves. The summary says what happened; the detail is where a
              refusal puts the part the user has to act on -- above all that a
              failed export left a temporary file in their folder. Rendering
              only the summary hid the one thing they could do about it. */}
          <span>
            {conversion.error.summary}
            {conversion.error.detail === null ? null : (
              <span className="notice-detail">{conversion.error.detail}</span>
            )}
          </span>
          <button className="link-button" onClick={conversion.dismissError} type="button">
            Dismiss
          </button>
        </div>
      )}

      <AvailabilityNotice
        retry={retryOffered ? retryAvailability : null}
        start={startOffered ? startAvailability : null}
      />

      {conversion.busy || terminal ? (
        <QueueState
          conversion={conversion}
          retryAvailability={retryAvailability}
          retryOffered={retryOffered}
        />
      ) : null}
      {/* Not while a queue is under way. The plan is an ordered list of file to
          output and so is the running queue, and two of them one above the other
          — one live, one hypothetical, and the hypothetical one's button
          disabled — is the panel describing two different things in the same
          shape. A finished queue is different: there the plan is how the user
          converts something else, so it stays. */}
      {conversion.busy || plan.status === "none" ? null : (
        <PlanState
          conversion={conversion}
          excludedSelectedCount={excludedSelectedCount}
          handles={handles}
          repeating={terminal}
          scope={scope}
          startAvailability={startAvailability}
        />
      )}
    </section>
  );
}

/**
 * Why a conversion control cannot be used, said once each.
 *
 * The region is mounted for the life of the panel and the sentences arrive
 * inside it, so a reader is watching when one appears rather than meeting a
 * region that arrived with its text.
 *
 * One element per *reason*, not per control. The two controls share a lane, so
 * when both are refused by the same fact they are described by one sentence and
 * a screen reader that has no way to know it is the same sentence does not read
 * it twice. Where the reasons genuinely differ -- a clear lane with nothing
 * selected, beside a finished queue with nothing worth rerunning -- each names
 * its own, which is the case that made a single shared notice untruthful.
 */
function AvailabilityNotice({
  start,
  retry,
}: {
  /** The start decision, or `null` where no start control is on screen. */
  readonly start: ConversionAvailability | null;
  /** The rerun decision, or `null` where no rerun control is on screen. */
  readonly retry: ConversionAvailability | null;
}): ReactElement {
  const said = new Map<ConversionUnavailableReason, string>();
  for (const decision of [start, retry]) {
    if (decision !== null && decision.status === "unavailable") {
      said.set(decision.reason, decision.message);
    }
  }
  return (
    <div
      aria-live="polite"
      className="conversion-availability"
      data-live-region="conversion-availability"
    >
      {[...said].map(([reason, message]) => (
        <p className="notice notice-warning" id={conversionNoticeId(reason)} key={reason}>
          {message}
        </p>
      ))}
    </div>
  );
}

/**
 * What a control points at, once the id only exists while there is a sentence.
 *
 * A described-by target with no text is a promise of an explanation that is not
 * there, so an available control describes itself with its own copy and nothing
 * else.
 */
function describedBy(base: string, availability: ConversionAvailability): string {
  const reason = availability.status === "available" ? "" : conversionNoticeId(availability.reason);
  // Joined rather than concatenated, so a control with no description of its own
  // does not point at an empty identifier beside the reason it is refused for.
  return [base, reason].filter((each) => each !== "").join(" ");
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
function AdoptOutputs({ conversion }: { readonly conversion: ConversionOperation }): ReactElement {
  const { adoption, eligibleOutputCount } = conversion;
  const added = adoption?.outcomes.filter((outcome) => outcome.kind === "added") ?? [];
  const duplicates =
    adoption?.outcomes.filter((outcome) => outcome.kind === "alreadyInWorkspace") ?? [];
  const refused = adoption?.outcomes.filter((outcome) => outcome.kind === "refused") ?? [];

  if (eligibleOutputCount === 0) {
    // Nothing to offer -- but "nothing was converted" is only one of the two
    // reasons for that, and the other one is false in exactly the case that
    // needs the truth most. A partially finalized acquisition *did* convert
    // files, they are in the user's folder, and what MSCanvas will not do is
    // present the prefix as the acquisition's complete output set. Each item's
    // own row explains itself; this says why the action is absent.
    return (
      <p className="quiet-text">
        {conversion.hasIncompleteOutputSet
          ? "No complete output set is available to add to this workspace."
          : "Nothing was converted, so there is nothing to add to the workspace."}
      </p>
    );
  }

  return (
    <div className="conversion-adoption">
      {/* Said beside the action rather than instead of it. Replacing the
          control a keyboard user just activated would drop focus to the
          document and announce nothing; leaving it mounted and disabled keeps
          the focus where they put it, and a live region is what tells them the
          work finished. */}
      {/* The one place the result is said, so a screen-reader user hears it
          without moving and a sighted one reads it in the same words. Emptied
          only while there is nothing to say. */}
      <p aria-live="polite" className="conversion-adoption-summary">
        {conversion.adopting
          ? ADOPT_IN_FLIGHT
          : adoption === null
            ? ""
            : `${String(added.length)} added, ${String(duplicates.length)} already in the workspace, ${String(refused.length)} not added.`}
      </p>
      {adoption !== null && added.length === 0 && refused.length === 0 ? (
        <p>All finalized outputs from this queue are already in the workspace.</p>
      ) : adoption !== null ? (
        <>
          {refused.slice(0, 3).map((outcome) => (
            <p
              className="quiet-text"
              key={`${String(outcome.itemIndex)}-${String(outcome.memberIndex)}`}
            >
              {`${outcome.outputFileName} was not added: ${
                ADOPTION_REFUSAL_LABEL[outcome.kind === "refused" ? outcome.reason : ""] ??
                "it could not be verified"
              }.`}
            </p>
          ))}
          {refused.length > 3 ? (
            <p className="quiet-text">{`${String(refused.length - 3)} more were not added.`}</p>
          ) : null}
        </>
      ) : null}
      {/* Offered again after a partial result, not replaced by it. An output
          refused because the workspace was full becomes admissible the moment
          rows are removed, and one the user removes afterwards is admissible
          again too -- the queue still holds what recognises them, so making
          them reachable only through `Add files…` would waste that. */}
      {/* Always, even after a result that added nothing. A duplicate today can
          be a row the user removes tomorrow, and the queue still holds what
          recognises the file -- so the action stays rather than sending them to
          `Add files…` for something MSCanvas can still identify. */}
      <>
        <p>
          {adoption !== null
            ? "You can add them again. Anything already in the workspace is reported rather than added twice."
            : eligibleOutputCount === 1
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

/**
 * Saving one local, redacted diagnostics file for a terminal queue.
 *
 * Offered only where there is something to diagnose, which is Rust's answer and
 * not a count compared here: an ordinary failure, a stop that could not be
 * confirmed, an item that left staging behind, or a queue whose own stop failed.
 * A queue that simply worked exposes nothing, because there is nothing to say.
 *
 * Deliberately available while the backend is quarantined — that session is the
 * one that most needs this, and an export launches no process. Deliberately not
 * available beside an adoption: both read the same terminal queue and Rust runs
 * one at a time.
 *
 * The action stays after a successful export rather than being replaced by its
 * result. Saving a second copy, or saving to somewhere else, is an ordinary
 * thing to want.
 */
function ExportDiagnostics({
  conversion,
}: {
  readonly conversion: ConversionOperation;
}): ReactElement | null {
  const { diagnosticItemCount, diagnosticsExport } = conversion;

  // Nothing to diagnose. No control, no explanation and no empty state: the
  // queue's own result already says what happened to each item, and an action
  // that is never usable is a control that only ever teaches its own absence.
  //
  // Asked of whether the offer exists, not of whether it can be taken right
  // now. A control that vanished while an adoption ran and came back afterwards
  // would read as flicker and would take the focus of whoever was standing on
  // it; being unavailable for a moment is what `disabled` is for.
  if (!conversion.diagnosticsAvailable && !conversion.exportingDiagnostics) {
    return null;
  }

  return (
    <div className="conversion-diagnostics">
      {/* The one place the result is said, so a screen-reader user hears it
          without moving and a sighted one reads it in the same words. Emptied
          only while there is nothing to say. */}
      <p aria-live="polite" className="conversion-diagnostics-summary">
        {conversion.exportingDiagnostics
          ? DIAGNOSTICS_IN_FLIGHT
          : diagnosticsExport === null
            ? ""
            : `Saved ${diagnosticsExport.fileName}, ${String(diagnosticsExport.byteLength)} bytes, describing ${
                diagnosticsExport.diagnosticItemCount === 1
                  ? "1 item"
                  : `${String(diagnosticsExport.diagnosticItemCount)} items`
              }.`}
      </p>
      {diagnosticsExport === null ? null : (
        /* The digest, so somebody about to send this on can confirm the bytes
           they are sending are the bytes MSCanvas measured. Not a location:
           the user chose the folder and this side was never told. */
        <p className="quiet-text conversion-diagnostics-digest">
          {`SHA-256 ${diagnosticsExport.sha256}`}
        </p>
      )}
      <p>
        {diagnosticItemCount === 1
          ? "1 item of this queue has diagnostics worth saving."
          : `${String(diagnosticItemCount)} items of this queue have diagnostics worth saving.`}
      </p>
      <div className="conversion-actions">
        {/* Left mounted and disabled rather than replaced while it runs.
            Removing the control a keyboard user just activated would drop focus
            to the document and announce nothing; the live region above is what
            tells them the work finished. */}
        <button
          aria-describedby="conversion-diagnostics-scope"
          className="secondary-button"
          disabled={!conversion.canExportDiagnostics}
          onClick={conversion.exportDiagnostics}
          type="button"
        >
          Export failure diagnostics…
        </button>
      </div>
      <p className="quiet-text" id="conversion-diagnostics-scope" role="note">
        {DIAGNOSTICS_EXPLANATION}
      </p>
    </div>
  );
}

/** What a queue would do, and the one control that starts it. */
function PlanState({
  conversion,
  handles,
  excludedSelectedCount,
  startAvailability,
  repeating,
  scope,
}: {
  readonly conversion: ConversionOperation;
  readonly handles: readonly string[];
  readonly excludedSelectedCount: number;
  /** Whether a conversion of these rows may start, and what to say when not. */
  readonly startAvailability: ConversionAvailability;
  readonly scope: "selection" | "focused";
  /** Whether a previous result is on screen above this plan. */
  readonly repeating: boolean;
}): ReactElement | null {
  const { plan } = conversion;
  if (plan.status === "none") {
    return (
      <div className="empty-state">
        Select or focus a supported vendor acquisition to convert it.
      </div>
    );
  }
  // Everything from here down is on screen whether or not the plan itself has
  // arrived.
  //
  // It used to return early, so a plan that could not be read took the settings
  // and the `Convert` control with it -- and a refused conversion became a
  // sentence with no control beside it. Since M6.4 a plan can be waiting on the
  // settings that decide what to ask for, which is a state the user is in
  // whenever an installation is being checked, so the block that explains the
  // refusal has to survive it. The availability rule is what disables the
  // control; the absence of a control was never the rule.
  const summary = plan.status === "loaded" ? plan.plan : null;
  const count = summary === null ? handles.length : summary.items.length;
  /*
   * What the action points at, which is whatever is actually on screen.
   *
   * A description that named an element the branch above did not render would
   * be a reference a screen reader resolves to nothing, so this follows the
   * three states rather than assuming the loaded one: the plan and its
   * validation note, the pending sentence alone, or -- under a finished result,
   * where the pending sentence is deliberately silent -- nothing but the
   * refusal the availability rule adds.
   */
  const planDescription =
    summary !== null
      ? "conversion-plan-summary conversion-validation-disclosure"
      : repeating
        ? ""
        : "conversion-plan-summary";
  return (
    <div className="conversion-plan">
      {/* Above the plan, because the plan is their consequence: the summary
          below is Rust's answer to whatever is selected here. */}
      <ConversionSettings onChoose={conversion.chooseIntent} settings={conversion.settings} />
      {/* With a result above it, silence is better than a second empty state --
          but only for the *text*. The settings and the control stay, because a
          conversion that cannot start has to say why wherever it is refused,
          and the earlier form of this rule took the explanation away with the
          plan. */}
      {plan.status === "loaded" ? (
        <PlanDetail excludedSelectedCount={excludedSelectedCount} summary={plan.plan} />
      ) : repeating ? null : (
        <PlanPending plan={plan} />
      )}

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
          aria-describedby={describedBy(planDescription, startAvailability)}
          className="primary-button"
          // The one rule, and the whole of it. The empty-row case is inside it
          // rather than beside it: a second clause here is exactly how this
          // control came to answer a different question from the operation it
          // starts.
          disabled={startAvailability.status !== "available"}
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

/** A plan that is still being read, or one that could not be. */
function PlanPending({
  plan,
}: {
  readonly plan: Extract<ConversionPlanState, { status: "loading" | "failed" }>;
}): ReactElement {
  return (
    <div className="empty-state" id="conversion-plan-summary">
      {plan.status === "loading" ? "Reading the conversion plan…" : plan.error.summary}
    </div>
  );
}

/** The plan itself: what will run, in what order, and under what semantics. */
function PlanDetail({
  summary,
  excludedSelectedCount,
}: {
  readonly summary: ConversionQueuePlan;
  readonly excludedSelectedCount: number;
}): ReactElement {
  return (
    <>
      <p id="conversion-plan-summary">
        {describeQueueFamilies(summary.items, summary.intent.format)}
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
            {/* Which family this row is, said on the row. In a mixed queue the
                summary's counts cannot say which item is which, and colour is
                not a channel this information may live in. */}
            <span className="conversion-queue-kind">{SOURCE_KIND_LABEL[item.sourceKind]}</span>
            <span aria-hidden="true">→</span>
            <span className="visually-hidden">converts to </span>
            {item.output.kind === "knownSingle" ? (
              <span className="conversion-queue-output" title={item.output.fileName}>
                {item.output.fileName}
              </span>
            ) : (
              <span
                className="conversion-queue-output conversion-queue-output-set"
                data-output-topology="backendNamedSet"
              >
                {outputSetSummary(item.output.maxMembers)}
                <span className="visually-hidden">. </span>
                <span className="conversion-queue-output-naming">
                  {OUTPUT_SET_NAMING}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>

      {/* Every fact read off the plan Rust answered with, and none of them
          read off the controls above. The controls are what the user is asking
          for; this is what MSCanvas said it would do, and a summary composed
          from the request could not tell the difference between the two. */}
      <dl className="metadata-list" data-plan-facts="intent">
        <div>
          <dt>Output</dt>
          <dd>{summary.intent.format}</dd>
        </div>
        <div>
          <dt>Peak processing</dt>
          <dd>{CONVERSION_VALUE_LABEL.processing[summary.intent.processing]}</dd>
        </div>
        <div>
          <dt>Spectra</dt>
          <dd>{CONVERSION_VALUE_LABEL.population[summary.intent.population]}</dd>
        </div>
        <div>
          <dt>Numeric precision</dt>
          <dd>{CONVERSION_VALUE_LABEL.precision[summary.intent.precision]}</dd>
        </div>
        <div>
          <dt>Array compression</dt>
          <dd>{CONVERSION_VALUE_LABEL.compression[summary.intent.compression]}</dd>
        </div>
        <div>
          <dt>If an output name is taken</dt>
          <dd>{CONFLICT_POLICY_LABEL[summary.conflictPolicy]}</dd>
        </div>
        {/* No path, and no guess at one. The destination is chosen after this
            summary is read, so naming a folder here -- a sibling, a remembered
            one, a placeholder -- would be a claim about something that does not
            exist yet. */}
        <div>
          <dt>Destination</dt>
          <dd>One folder, chosen next</dd>
        </div>
      </dl>

      <PlanDisclosures intent={summary.intent} />

      <p className="quiet-text" id="conversion-validation-disclosure" role="note">
        {OUTPUT_ONLY_DISCLOSURE} They run one at a time, and Stop queue ends the whole queue rather
        than one item.
      </p>
    </>
  );
}

/**
 * What the chosen semantic costs, listed only where it costs something.
 *
 * Built from the plan's own intent through the same sentences the controls
 * carry, so what a reader is told beside a radio and what they are told beside
 * the plan are one claim rather than two that could drift. A semantic that
 * reduces nothing renders nothing: there is no reassuring sentence, because the
 * absence of a disclosure is the honest form of that answer.
 */
function PlanDisclosures({ intent }: { readonly intent: ConversionIntent }): ReactElement | null {
  const disclosures = conversionIntentDisclosures(intent);
  if (disclosures.length === 0) {
    return null;
  }
  return (
    <ul className="conversion-plan-disclosures" data-plan-facts="disclosures">
      {disclosures.map((disclosure) => (
        <li key={disclosure}>{disclosure}</li>
      ))}
    </ul>
  );
}

/**
 * What the queue on screen converts under.
 *
 * Read from the queue, never from the controls. The queue bound its semantic
 * when it was created and holds it through every retry, so a settings change
 * made while it runs must not change one word of this -- and the only way to
 * guarantee that on screen is to read the bound value rather than the current
 * one.
 */
function QueueIntent({ intent }: { readonly intent: ConversionIntent }): ReactElement {
  return (
    <p className="quiet-text" data-queue-intent={intent.id}>
      Converting to {intent.format} · {CONVERSION_VALUE_LABEL.processing[intent.processing]} ·{" "}
      {CONVERSION_VALUE_LABEL.population[intent.population]} ·{" "}
      {CONVERSION_VALUE_LABEL.precision[intent.precision]} ·{" "}
      {CONVERSION_VALUE_LABEL.compression[intent.compression]}
    </p>
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
  retryAvailability,
  retryOffered,
}: {
  readonly conversion: ConversionOperation;
  /** Whether this queue's failures may be rerun, and what to say when not. */
  readonly retryAvailability: ConversionAvailability;
  /** Whether the rerun control is on screen at all, decided by the panel. */
  readonly retryOffered: boolean;
}): ReactElement | null {
  const state = conversion.state;
  // A conversion this document dispatched, for a slot that has not been seen to
  // move yet. Rust has no queue to report until it has reserved one, so without
  // this the press goes unacknowledged for a round trip -- and from a finished
  // queue the panel would answer it with the *previous* run's items.
  //
  // It replaces the block rather than sitting above it, which is exactly what a
  // dispatched retry already does: an ordered list of what just happened, read
  // under a sentence saying something is starting, is the panel describing two
  // queues in one shape.
  if (conversion.converting) {
    return (
      <div className="conversion-running">
        <p>Starting the conversion…</p>
      </div>
    );
  }
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
      {/* The semantic this queue holds, above whatever it is doing. Read from
          the queue rather than from the settings, which by now may describe the
          next conversion instead of this one. */}
      <QueueIntent intent={queue.intent} />
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
      ) : state.status === "stopping" || (state.status === "running" && conversion.stopping) ? (
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
        {queue.items.map((item, index) => {
          // Read once per item. Which of the two an item has is the whole of
          // what tells these branches apart, and asking the same question at
          // every use would invite one of them to be answered differently.
          const single = singleReportOf(item);
          const set = setReportOf(item);
          return (
            <li key={item.datasetHandle} data-item-state={item.state}>
              <span className="conversion-queue-order">{index + 1}</span>
              <span className="conversion-queue-name" title={item.fileName}>
                {item.fileName}
              </span>
              <span aria-hidden="true">→</span>
              <span className="visually-hidden">converts to </span>
              {item.output.kind === "knownSingle" ? (
                <span className="conversion-queue-output" title={item.output.fileName}>
                  {item.output.fileName}
                </span>
              ) : (
                <span
                  className="conversion-queue-output conversion-queue-output-set"
                  data-output-topology="backendNamedSet"
                >
                  {itemOutputSummary(item, set)}
                </span>
              )}
              <span className="visually-hidden">, </span>
              <span className="conversion-queue-status">{itemStateLabel(item)}</span>
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
              {single?.output == null ? null : (
                <>
                  <span className="visually-hidden">, </span>
                  <span className="conversion-queue-facts">
                    {`${formatByteLength(single.output.byteLength)}, ${formatCount(
                      single.output.spectrumCount,
                    )} spectra, ${formatCount(single.output.chromatogramCount)} chromatograms`}
                    {single.backend === null
                      ? ""
                      : `, ${formatDuration(single.backend.elapsedMilliseconds)}`}
                  </span>
                </>
              )}
              {/* What a set actually produced, and the exact limits of the claim.
                  Three separate sentences on purpose: the count is a fact, the
                  completeness is narrower than it sounds, and the validation is
                  narrower again. Collapsing them would read as one broad
                  guarantee that none of them makes. */}
              {set === null ? null : (
                <>
                  <span className="visually-hidden">, </span>
                  <span className="conversion-queue-set-result">{setResultSentence(set)}</span>
                  {set.completeness.kind === "established" ? (
                    <span className="conversion-queue-set-completeness">
                      {SAMPLE_COMPLETENESS_CLAIM}
                    </span>
                  ) : null}
                  {set.partial === null ? null : (
                    <span className="conversion-queue-set-partial notice notice-warning" role="note">
                      {PARTIAL_FINALIZATION_EXPLANATION}
                    </span>
                  )}
                  {/* Which files, not only how many. A result that says "ten
                      outputs finalized" and cannot say which ten has given the
                      user a number rather than an answer -- and after a partial
                      publication the copy above tells them to add the finalized
                      files individually, which is not something anyone can act
                      on without their names. Bounded at twenty-four by the
                      lifecycle that produced them. */}
                  {finalizedMemberNames(set).length === 0 ? null : (
                    <ul className="conversion-queue-set-members">
                      {finalizedMemberNames(set).map((name) => (
                        <li key={name} title={name}>
                          {name}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {/* Cleanup failing is the user's problem, not only MSCanvas', because
                  what is left behind is in the folder they chose. Read from both
                  places it can be recorded: a cancelled item has no report by
                  construction, so a residue it left would otherwise be knowable
                  to MSCanvas and invisible to the person whose folder it is in. */}
              {(single?.stagingResidue ??
                set?.stagingResidue ??
                item.cancellation?.stagingResidue) == null ? null : (
                <>
                  <span className="visually-hidden">, </span>
                  <span className="conversion-queue-residue">{RESIDUE_EXPLANATION}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>

      {state.status === "terminal" && !retrying ? (
        <>
          {/* Only where something was actually judged. A queue whose items were
              all skipped or all failed validated nothing -- and a skipped item's
              existing file was explicitly not inspected, so claiming
              output-only validation over it would claim a check nobody ran. */}
          {queue.items.some(conversionJudgedAnyOutput) ? (
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
              <p className="conversion-stopped-summary">{stoppedSummary(queue)}</p>
              <p className="quiet-text">
                Completed outputs remain in the destination folder. Cancelled and not-run items were
                not finalized by this queue.
              </p>
            </>
          )}
          <AdoptOutputs conversion={conversion} />
          <ExportDiagnostics conversion={conversion} />
          {/* A stopped queue is terminal and is not rerun in place. Converting
              those rows again is a new queue, made from the roster, which is
              the ordinary path the selection workflow already offers. */}
          {/* Not while an adoption is under way. A retry replaces the very
              results the adoption is reading, so the two are never both live.
              Removed rather than disabled: an action that is coming back is a
              different thing from one that is refused. */}
          {!retryOffered ? (
            state.reason === "completed" &&
            queue.retryableFailedCount === 0 &&
            queue.nonRetryableFailedCount !== 0 &&
            !conversion.adopting &&
            !conversion.exportingDiagnostics ? (
              <p className="quiet-text" role="note">
                Those failures would not change on another attempt with the same acquisitions,
                folder and settings.
              </p>
            ) : null
          ) : (
            <div className="conversion-actions">
              <button
                aria-describedby={describedBy("conversion-retry-scope", retryAvailability)}
                className="secondary-button"
                // Retry availability, and deliberately not the start control's.
                // A retry is a conversion, so an unavailable ProteoWizard, a
                // recheck in flight or a preview still holding the lane refuse
                // it for the same reasons -- but what it would act on is this
                // queue's failures rather than the roster's selection, and this
                // control answered to the other target for as long as it
                // existed.
                disabled={retryAvailability.status !== "available"}
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

/**
 * What one item's state says, in words rather than in colour.
 *
 * A function rather than a bare lookup, because one label is not true of both
 * cardinalities. A skipped item with a known single output was skipped because
 * *its* name was taken; a skipped output set reached that state only when every
 * one of its discovered names was already occupied, and it has no singular name
 * for the shared sentence to be about.
 */
function itemStateLabel(item: ConversionQueueItem): string {
  if (item.state === "skipped" && item.output.kind === "backendNamedSet") {
    return SKIPPED_OUTPUT_SET_LABEL;
  }
  return ITEM_STATE_LABEL[item.state];
}

/**
 * What a skipped output set says.
 *
 * Every one of them, not one of them: the multi-output lifecycle steps aside
 * only when it finds a file at every destination name it discovered, so a
 * sentence about "a file of that name" would describe a name this item never
 * had.
 */
const SKIPPED_OUTPUT_SET_LABEL =
  "Skipped — files of all its output names were already there";

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

/** The single-output report of this item's latest attempt, if it had one. */
function singleReportOf(item: ConversionQueueItem): ConversionReport | null {
  return item.result?.kind === "single" ? item.result.report : null;
}

/** The group report of this item's latest attempt, if it ran a set. */
function setReportOf(item: ConversionQueueItem): ConversionOutputSetReport | null {
  return item.result?.kind === "outputSet" ? item.result.report : null;
}

/**
 * What a set item shows in the output column once it has run.
 *
 * Before it runs, and for every outcome that published nothing, the honest
 * answer is still the range: no filename exists. Once members are finalized the
 * count is real and is worth more than the bound.
 */
function itemOutputSummary(
  item: ConversionQueueItem,
  report: ConversionOutputSetReport | null,
): string {
  const maxMembers =
    item.output.kind === "backendNamedSet" ? item.output.maxMembers : 1;
  if (report === null || report.finalizedCount === 0) {
    return outputSetSummary(maxMembers);
  }
  return report.finalizedCount === 1
    ? "1 mzML output"
    : `${String(report.finalizedCount)} mzML outputs`;
}

/**
 * The members that reached their final names, in publication order.
 *
 * Read from the states rather than from the count, because the two answer
 * different questions for a partial publication: the count says how many were
 * finalized, and this says *which* — which is the prefix that is on disk.
 */
function finalizedMemberNames(report: ConversionOutputSetReport): readonly string[] {
  return report.memberFileNames.filter((_, index) => report.memberStates[index] === "finalized");
}

/** What one settled set produced, counted rather than claimed. */
function setResultSentence(report: ConversionOutputSetReport): string {
  if (report.partial !== null) {
    return `${String(report.partial.finalizedCount)} of ${String(
      report.memberCount,
    )} mzML outputs finalized; ${String(
      report.partial.notPublishedCount,
    )} not published.`;
  }
  if (report.finalizedCount === 0) {
    return "No mzML outputs were finalized.";
  }
  return report.finalizedCount === 1
    ? "1 mzML output finalized."
    : `${String(report.finalizedCount)} mzML outputs finalized.`;
}

/** Why one item failed, from whichever half of the boundary refused it. */
function itemFailureSentence(item: ConversionQueueItem): string {
  if (item.error !== null) {
    return item.error.summary;
  }
  const set = setReportOf(item);
  if (set !== null) {
    return setFailureSentence(set);
  }
  const report = singleReportOf(item);
  if (report === null) {
    return "The conversion did not finish, so no file was written.";
  }
  return failureSentence(report);
}

/**
 * Why one output set failed, in the user's terms rather than the boundary's.
 *
 * The single-output path has explained itself by `detailedOutcome` since ADR
 * 0012, and a set discarding its own would be the worse half of the same
 * screen: a destination conflict, an unevidenced build and a sample the reader
 * lost need three different things from the user, and one sentence for all of
 * them tells them to do nothing in particular.
 *
 * Only identifiers with a *different* recovery get their own sentence. The
 * fallback is honest rather than specific — an identifier this build has no
 * sentence for is still a failure, and inventing prose for one would be
 * inventing a diagnosis.
 */
const SET_REFUSAL_SENTENCE: Record<string, string> = {
  // The destination. Actionable, and the two are genuinely different: one name
  // was taken, or some were taken and some were not.
  multi_output_destination_occupied:
    "Files of these output names are already in that folder, so nothing was converted.",
  multi_output_mixed_destination_conflict:
    "Some of these output names are already taken in that folder and some are not, so nothing was converted.",
  multi_output_output_name_claimed_elsewhere:
    "Another acquisition in this queue produced one of these output names, so nothing was converted.",
  multi_output_destination_not_inspectable:
    "That folder could not be inspected, so nothing was converted.",
  multi_output_destination_root_not_opened:
    "That folder could not be opened, so nothing was converted.",

  // The build. Actionable by choosing a different ProteoWizard installation.
  multi_output_provider_build_not_evidenced:
    "MSCanvas has no conversion evidence for this acquisition format on the installed ProteoWizard build.",

  // The acquisition. Actionable by opening it again.
  multi_output_source_not_still_admitted:
    "The acquisition changed since it was added, so nothing was converted. Add it again to continue.",
  multi_output_source_bundle_not_bound:
    "MSCanvas could not hold every file of this acquisition for the run, so nothing was converted.",

  // What the reader said about samples. Not actionable in the app, and that is
  // the point: it is what stops the outputs being called this acquisition.
  source_sample_failure_observed:
    "The SCIEX reader reported a problem with at least one sample, so no output was published.",
  source_sample_audit_truncated:
    "MSCanvas could not read enough of the converter's output to establish that no sample was lost, so nothing was published.",
  source_sample_output_filtering_requested:
    "The run asked for only some of the acquisition's samples, so its outputs are not this acquisition's complete set.",

  // What was produced. Not actionable, and reported rather than smoothed over.
  multi_output_set_not_as_declared:
    "The converter wrote a different set of files than it declared, so none of them was published.",
  multi_output_member_rejected:
    "At least one converted file did not pass MSCanvas' integrity checks, so none of them was published.",
};

/** What a failed output set says. */
function setFailureSentence(report: ConversionOutputSetReport): string {
  // A partial publication is explained in full beside this, and must not be
  // preceded by a sentence saying nothing was written.
  if (report.partial !== null) {
    return "The complete output set was not produced.";
  }
  const detailed = report.detailedOutcome;
  if (detailed !== null) {
    const sentence = SET_REFUSAL_SENTENCE[detailed];
    if (sentence !== undefined) {
      return sentence;
    }
  }
  return "The conversion did not finish, so no output set was published.";
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
