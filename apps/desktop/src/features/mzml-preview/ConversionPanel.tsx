import { useEffect, useRef, type ReactElement, type RefObject } from "react";

import type {
  ConversionConflictPolicy,
  ConversionOutputSetReport,
  ConversionQueue,
  ConversionQueueItem,
  ConversionQueuePlanItem,
  ConversionReport,
  DatasetSourceKind,
  DestinationPolicy,
} from "./contracts";
import { conversionJudgedAnyOutput, SOURCE_KIND_LABEL } from "./contracts";
import type { ConversionAvailability } from "./conversionAvailability";
import { ConversionSettings, conversionIntentDisclosures, CONVERSION_VALUE_LABEL } from "./ConversionSettings";
import { conversionAvailability } from "./conversionAvailability";
import { ConversionItemJudgements } from "./ConversionItemJudgements";
import type { ConversionRefusal } from "./conversionNoticeRegistry";
import { conversionNotices, conversionRefusalNoticeId } from "./conversionNoticeRegistry";
import { formatByteLength, formatCount, formatDuration } from "./format";
import type { ConversionConfigurationView } from "./useConversionConfiguration";
import type { ConversionOperation } from "./useConversionOperation";
import type { ConversionPlanView } from "./useConversionPlan";
import type { ConversionScope, ResolvedConversionScope } from "./conversionScope";
import { SORT_MODE_LABEL } from "./rosterView";

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

const DESTINATION_LABEL: Record<DestinationPolicy["kind"], string> = {
  customFolder: "Custom local folder",
  sourceSibling: "Beside each source",
  namedSubfolder: "Named subfolder beside each source",
};
const DESTINATIONS: readonly DestinationPolicy["kind"][] = [
  "customFolder", "sourceSibling", "namedSubfolder",
];

function describeDestination(policy: DestinationPolicy): string {
  switch (policy.kind) {
    case "customFolder": return "One local folder, chosen after Convert";
    case "sourceSibling": return "Beside each source, in its containing folder";
    case "namedSubfolder": return `Subfolder “${policy.name}” in each source's containing folder`;
  }
}

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
 */
function describeQueueFamilies(items: readonly ConversionQueuePlanItem[]): string {
  const counts = new Map<DatasetSourceKind, number>();
  for (const item of items) {
    counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  }
  const count = items.length;
  const first = items[0];
  if (counts.size === 1 && first !== undefined) {
    const family = SOURCE_KIND_LABEL[first.sourceKind];
    return count === 1
      ? `One ${family} acquisition will be converted to mzML.`
      : `${String(count)} ${family} acquisitions will be converted to mzML, one after another, in the order below.`;
  }
  const perFamily = [...counts.entries()]
    .map(([kind, familyCount]) => `${String(familyCount)} ${SOURCE_KIND_LABEL[kind]}`)
    .join(" · ");
  return `${String(count)} supported vendor acquisitions will be converted to mzML, one after another, in the order below. ${perFamily}.`;
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
 * What ending one file does, said before it is pressed.
 *
 * The difference from Stop queue is the whole reason both exist, so it is
 * stated rather than implied: this one is about the acquisition being converted
 * now, and the queue keeps going.
 */
const CANCEL_ITEM_EXPLANATION =
  "Files already converted are kept, and the items after it still run. It may finish on its own first, and then it keeps its result. If MSCanvas cannot confirm that its converter ended, the whole queue stops and the session needs a restart.";

/**
 * Why the control is unavailable, at the control.
 *
 * One sentence for the two ways there is nothing to end -- between items, or
 * the whole queue ending -- because a reader does not need the session's
 * internal state to know that pressing would do nothing.
 *
 * **Not for the third way**, which is this document having already asked. That
 * one is a different fact and gets its own sentence below: a note saying the
 * control is "available while a file is being converted" would appear exactly
 * while a file is being converted, which is when a reader is least able to
 * believe it.
 */
const CANCEL_ITEM_UNAVAILABLE =
  "Available while a file is being converted, and not once the whole queue is stopping.";

/**
 * What is true while *this file's* stop is in flight.
 *
 * The per-item counterpart of `STOP_IN_FLIGHT_EXPLANATION`, and silent about
 * which of ending and finishing happens for the same reason: that is decided
 * by what the process boundary observes first.
 *
 * **Not silent about the third outcome.** "The queue keeps going either way"
 * described two of the three. A stop whose process tree cannot be confirmed
 * gone ends the whole queue and quarantines the session, which is the branch a
 * reader most needs said and the only one they cannot undo -- and this sentence
 * is on screen exactly while it is undecided. `CANCEL_ITEM_EXPLANATION` says it
 * before the press; dropping it afterwards left the promise standing at the one
 * moment it was in doubt.
 */
const CANCEL_ITEM_IN_FLIGHT_EXPLANATION =
  "This file may still finish on its own, and then it keeps its result. The items after it still run. If MSCanvas cannot confirm that its converter ended, the whole queue stops and the session needs a restart.";

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
   * What conversion semantics are known for the bound installation.
   *
   * Rendered inside this panel because it is what the next conversion will do,
   * and a reader deciding whether to press `Convert` is entitled to see it
   * before they do rather than after.
   */
  readonly configuration: ConversionConfigurationView;
  /**
   * The plan this panel would start, and what it has been told about it.
   *
   * Beside the configuration rather than inside it: the settings describe a
   * build, the plan describes one conversion under them, and each is
   * answerable while the other is not.
   */
  readonly plan: ConversionPlanView;
  /**
   * Where the rows came from, which is what the action may call them.
   *
   * One selected row is still a selected row: labelling it `Convert focused…`
   * would name a row the action might not be acting on.
   */
  readonly resolvedScope: ResolvedConversionScope;
  readonly onScopeChange: (scope: ConversionScope) => void;
}

/**
 * The conversion queue: what it would do, and what it did.
 *
 * The explicitly chosen scope is described before commitment. The queue then
 * owns its resolved membership and order, including on retry.
 */
export function ConversionPanel({
  conversion,
  configuration,
  plan,
  resolvedScope,
  onScopeChange,
}: ConversionPanelProps): ReactElement | null {
  const { state } = conversion;
  const terminal = state.status === "terminal";
  const convertButton = useRef<HTMLButtonElement | null>(null);
  const restoreAfterPicker = useRef(false);
  // Runs after every commit, and is a two-comparison no-op unless a picker was
  // cancelled. That is deliberate: the control this restores to is not on
  // screen in every commit, and the commit where it returns is not always one
  // of the three values a dependency list could name.
  useEffect(() => {
    if (conversion.busy || !restoreAfterPicker.current) return;
    // The picker produced a queue rather than a cancellation. There is nothing
    // to restore to, and the running queue owns the focus from here.
    if (state.status !== "idle") {
      restoreAfterPicker.current = false;
      return;
    }
    // The plan has not answered yet. The button may be on screen and disabled,
    // and focusing it here would land on a control that cannot be pressed.
    if (plan.startPlan === "reading") return;
    const button = convertButton.current;
    // **Not focusable yet, so this is not the commit to give up in.** The
    // control is present but *disabled* whenever the plan has no question to
    // answer -- a scope still settling as the picker closes reads "Convert 0
    // selected…" -- and `focus()` on a disabled button does nothing at all.
    // Clearing the flag against that left the focus on the document body for
    // the rest of the session, because the commit where the button becomes
    // pressable is not one any dependency list here could name. The flag now
    // survives until the focus actually lands.
    if (button === null || button.disabled) return;
    restoreAfterPicker.current = false;
    button.focus();
  });

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
    targetCount: resolvedScope.handles.length,
    // The plan is a fact the one rule consults, not a second gate beside it.
    // What a reader presses `Convert` for is the conversion the summary above
    // describes, so a control that could be pressed while that summary is
    // absent, stale or refused would start something nobody read.
    plan: plan.startPlan,
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
  // Whether the start control is on screen at all -- which is a question about
  // the *block* it lives in, not a second answer to whether it may be used.
  // With rows to convert it is always offered and `startAvailability` says
  // whether it may be pressed and why not, which is what lets a failed plan and
  // one being read refuse it differently.
  const startOffered = !conversion.busy;
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

  /*
   * What the settings read is refused by, where its control is on screen.
   *
   * The same withdrawal rule the control itself uses: a retry is *offered* only
   * where there is an answer a read could improve on, so a refusal reported
   * while no control exists would put a sentence in the document explaining
   * something nobody can see. `ConversionConfigurationProbeAdmission` speaks
   * its own vocabulary and the registry maps it onto the lane's facts, which is
   * how one contended moment produces one sentence rather than two.
   */
  const settingsRefusal: ConversionRefusal | null =
    configuration.retryOffered && configuration.refusal !== null
      ? { source: "probe", refusal: configuration.refusal }
      : null;
  /** Every action currently on screen, and what refuses it. */
  const refusals: readonly (ConversionRefusal | null)[] = [
    startOffered ? { source: "action", availability: startAvailability } : null,
    retryOffered ? { source: "action", availability: retryAvailability } : null,
    settingsRefusal,
  ];
  // The id the settings retry points at, minted once here rather than by the
  // child. Handed down so the control names the element this panel actually
  // rendered.
  const settingsRefusalNoticeId = conversionRefusalNoticeId(settingsRefusal);

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

      <AvailabilityNotice refusals={refusals} />

      <ConversionSettings
        configuration={configuration}
        onChoose={configuration.select}
        refusalNoticeId={settingsRefusalNoticeId}
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
      {conversion.busy ? null : (
        <PlanState
          conversion={conversion}
          resolvedScope={resolvedScope}
          onScopeChange={onScopeChange}
          plan={plan}
          repeating={terminal}
          startAvailability={startAvailability}
          convertButton={convertButton}
          onCustomStart={() => { restoreAfterPicker.current = true; }}
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
 * **This is the panel's only owner of a shared availability id.** Every action
 * on this surface reports its refusal here -- `Convert`, the rerun of a failed
 * queue, and the settings read's own retry, which speaks a different
 * authority's vocabulary about the same facts -- and the registry collapses
 * them by the refusing fact. Where two actions are refused by one fact they
 * point at one element carrying that fact's sentence; where the reasons
 * genuinely differ each names its own. A child that minted an id of its own
 * would put a second element under one fact's name and leave every
 * `aria-describedby` pointing at it ambiguous.
 */
function AvailabilityNotice({
  refusals,
}: {
  /** One entry per action, `null` for each action not on screen. */
  readonly refusals: readonly (ConversionRefusal | null)[];
}): ReactElement {
  return (
    <div
      aria-live="polite"
      className="conversion-availability"
      data-live-region="conversion-availability"
    >
      {conversionNotices(refusals).map((notice) => (
        <p className="notice notice-warning" id={notice.id} key={notice.reason}>
          {notice.message}
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
 * else. The id comes from the registry rather than from a second minting here,
 * so a control and the element it names cannot come apart.
 */
function describedBy(base: string, availability: ConversionAvailability): string {
  const notice = conversionRefusalNoticeId({ source: "action", availability });
  return notice === null ? base : `${base} ${notice}`;
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

/**
 * What a queue would do, and the one control that starts it.
 *
 * **Every state of the plan is rendered, and the control is rendered in all of
 * them.** A plan being worked out, a plan that failed and a plan the settings
 * make impossible are three different situations with three different things
 * for a reader to do, and a control that vanished for two of them would leave
 * the third looking like the only one there is. The button says what it cannot
 * do through the one availability rule; nothing here decides again.
 */
function PlanState({
  conversion,
  plan,
  resolvedScope,
  onScopeChange,
  startAvailability,
  convertButton,
  onCustomStart,
}: {
  readonly conversion: ConversionOperation;
  readonly plan: ConversionPlanView;
  readonly convertButton: RefObject<HTMLButtonElement | null>;
  readonly onCustomStart: () => void;
  /** The rows this panel would queue, for the control that names them. */
  readonly resolvedScope: ResolvedConversionScope;
  readonly onScopeChange: (scope: ConversionScope) => void;
  /** Whether a conversion of these rows may start, and what to say when not. */
  readonly startAvailability: ConversionAvailability;
  /** Whether a previous result is on screen above this plan. */
  readonly repeating: boolean;
}): ReactElement | null {
  const current = plan.current;
  const summary = current?.plan ?? null;
  // The rows the control names, which is what the reader selected rather than
  // what MSCanvas has finished describing. The plan is rendered in every state
  // now, so reading this off the summary made the label say "Convert 0
  // selected…" for the whole of the window a plan is being worked out -- a
  // count that was never true of anything.
  const count = resolvedScope.handles.length;
  return (
    <div className="conversion-plan">
      <fieldset className="conversion-scope" aria-describedby="conversion-scope-summary">
        <legend>Conversion scope</legend>
        <label><input type="radio" name="conversion-scope" value="selected"
          checked={resolvedScope.scope === "selected"} onChange={() => onScopeChange("selected")} />Selected rows</label>
        <label><input type="radio" name="conversion-scope" value="all"
          checked={resolvedScope.scope === "all"} onChange={() => onScopeChange("all")} />All workspace rows</label>
      </fieldset>
      <p id="conversion-scope-summary" aria-live="polite">
        {resolvedScope.requestedCount} requested · {count} eligible · {resolvedScope.excludedCount} excluded
        {resolvedScope.excludedCount > 0 ? " (not convertible)" : ""}.
        {resolvedScope.scope === "all" ? " All workspace rows, including those outside search." : " All selected rows, including those outside search."}
      </p>
      <p className="quiet-text">Order: {SORT_MODE_LABEL[resolvedScope.sort]}. Equal keys keep added order.</p>
      {summary === null ? null : <p className="quiet-text" data-testid="conversion-capacity">Queue capacity: {summary.capacity} eligible acquisitions.</p>}
      {plan.capacityRefusal === null ? null : <p className="notice notice-warning" data-testid="conversion-capacity">
        {plan.capacityRefusal.requestedCount} eligible acquisitions exceed the queue capacity of {plan.capacityRefusal.capacity}.
      </p>}
      {summary === null ? (
        <>
          <PlanPending plan={plan} />
          {count === 0 ? null : <ol aria-label="Requested conversion order">
            {resolvedScope.members.map((row, index) => <li key={row.handle}>
              <span className="conversion-queue-order">{index + 1}</span>
              <span className="conversion-queue-name">{row.fileName}</span>
            </li>)}
          </ol>}
        </>
      ) : (
        <>
          <p id="conversion-plan-summary">
            {describeQueueFamilies(summary.items)}
          </p>

          <ol aria-label="Reviewed conversion order" className="conversion-queue-list">
            {summary.items.map((item, index) => (
              <li key={item.datasetHandle}>
                <span className="conversion-queue-order">{index + 1}</span>
                <span className="conversion-queue-name" title={item.fileName}>
                  {item.fileName}
                </span>
                {/* Which family this row is, said on the row. In a mixed queue
                    the summary's counts cannot say which item is which, and
                    colour is not a channel this information may live in. */}
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

          {/* Every one of these is read off the plan, never off the controls
              beside it. The plan is the answer to a question that named a
              combination and a policy; the controls are what the reader might
              be moving to *next*, and a summary that read from them would
              describe a conversion this one is not. */}
          <dl className="metadata-list">
            <div>
              <dt>Output</dt>
              <dd>{summary.outputFormat}</dd>
            </div>
            <div>
              <dt>Peaks</dt>
              <dd>{CONVERSION_VALUE_LABEL.processing[summary.intent.processing]}</dd>
            </div>
            <div>
              <dt>Spectra</dt>
              <dd>{CONVERSION_VALUE_LABEL.population[summary.intent.population]}</dd>
            </div>
            <div>
              <dt>Stored precision</dt>
              <dd>{CONVERSION_VALUE_LABEL.precision[summary.intent.precision]}</dd>
            </div>
            <div>
              <dt>Compression</dt>
              <dd>{summary.compression}</dd>
            </div>
            <div>
              <dt>If an output name is taken</dt>
              <dd>{CONFLICT_POLICY_LABEL[summary.conflictPolicy]}</dd>
            </div>
            <div>
              <dt>Requested destination</dt>
              <dd>{describeDestination(summary.destinationPolicy)}</dd>
            </div>
          </dl>

          <p className="quiet-text" id="conversion-validation-disclosure" role="note">
            {OUTPUT_ONLY_DISCLOSURE} Acquisitions convert one at a time. Stop queue ends
            the whole queue; Stop this file ends only the one being converted, and Skip
            settles a row that has not started.
          </p>

          {/* What this combination reduces, and only that. A combination that
              reduces nothing produces no list and therefore no reassuring
              sentence: silence is the honest answer where there is nothing to
              disclose. */}
          {conversionIntentDisclosures(summary.intent).map((disclosure) => (
            <p className="quiet-text" key={disclosure} role="note">
              {disclosure}
            </p>
          ))}
        </>
      )}

      <fieldset className="conversion-destination" aria-describedby="conversion-destination-scope">
        <legend>Save converted files</legend>
        {DESTINATIONS.map((kind) => (
          <label key={kind}>
            <input
              checked={conversion.destinationPolicy.kind === kind}
              name="conversion-destination-policy"
              onChange={() => conversion.setDestinationPolicy(
                kind === "namedSubfolder" ? { kind, name: conversion.subfolderName } : { kind },
              )}
              type="radio"
              value={kind}
            />
            {DESTINATION_LABEL[kind]}
          </label>
        ))}
        {conversion.destinationPolicy.kind === "namedSubfolder" ? (
          <div className="conversion-subfolder">
            <label htmlFor="conversion-subfolder-name">Subfolder name</label>
            <input
              id="conversion-subfolder-name"
              aria-describedby={plan.error?.kind === "subfolder_name_unusable"
                ? `conversion-subfolder-help ${PLAN_PENDING_ID}` : "conversion-subfolder-help"}
              aria-invalid={plan.error?.kind === "subfolder_name_unusable" || undefined}
              autoComplete="off"
              type="text"
              value={conversion.destinationPolicy.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                conversion.setDestinationPolicy({ kind: "namedSubfolder", name });
              }}
            />
            <p className="quiet-text" id="conversion-subfolder-help">
              Use one folder name, without a path. MSCanvas checks the name before Convert is available.
            </p>
          </div>
        ) : null}
        <p className="quiet-text" id="conversion-destination-scope">
          Destinations are resolved after Convert. Output names are checked as each item runs;
          a queue can use different source folders.
        </p>
      </fieldset>

      <fieldset className="conversion-conflict" aria-describedby="conversion-conflict-scope">
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
        <p className="quiet-text" id="conversion-conflict-scope">
          Existing files are never overwritten or automatically renamed. For a multi-file output,
          Skip applies only when all output names already exist; a partial collision fails that item.
          Two queued outputs claiming the same destination name are refused.
        </p>
      </fieldset>

      <div className="conversion-actions">
        <button
          ref={convertButton}
          aria-describedby={describedBy(
            summary === null
              ? PLAN_PENDING_ID
              : "conversion-plan-summary conversion-validation-disclosure",
            startAvailability,
          )}
          className="primary-button"
          // The one rule, and the whole of it. The empty-row case and the plan
          // are inside it rather than beside it: a second clause here is
          // exactly how this control came to answer a different question from
          // the operation it starts.
          disabled={startAvailability.status !== "available"}
          onClick={() => {
            // The question the summary above answered, whole, and taken from
            // the very value that summary was rendered from. Passing the rows
            // alone would let a start mean something the reader never read;
            // reaching for the question separately would be a second answer to
            // which conversion this is.
            if (current !== null) {
              if (current.identity.destinationPolicy.kind === "customFolder") onCustomStart();
              conversion.convert(current.identity);
            }
          }}
          type="button"
        >
          {resolvedScope.scope === "selected" ? `Convert ${String(count)} selected…` : `Convert all ${String(count)} eligible…`}
        </button>
        {/* An explicit re-ask of the same question, and nothing automatic. A
            plan can fail for a reason the reader cannot act on, and a machine
            whose only exit were a new question would pin `Convert` as refused
            for the session over one lost reply. */}
        {plan.retryOffered ? (
          <button className="link-button" onClick={plan.retry} type="button">
            Describe again
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Where the sentence a pending plan puts in place of a summary is named. */
const PLAN_PENDING_ID = "conversion-plan-pending";

/**
 * What is on screen where a plan summary is not.
 *
 * One element, three sentences, and the difference between them is what the
 * reader can do: wait, press something, or change a setting above. Collapsing
 * them into "no plan" is the shape ADR 0044 records as a refused plan being
 * explained to a reader as one being reread.
 */
function PlanPending({ plan }: { readonly plan: ConversionPlanView }): ReactElement {
  return (
    <div className="empty-state" id={PLAN_PENDING_ID}>
      {plan.startPlan === "absent" ? <span>No eligible acquisitions in this scope.</span>
      : plan.startPlan === "capacityExceeded" ? <span>Conversion cannot start for this scope.</span>
      : plan.startPlan === "failed" && plan.error !== null ? (
        <span>{plan.error.summary}</span>
      ) : plan.startPlan === "selectionUnavailable" ? (
        <span>
          The installed ProteoWizard does not offer the conversion settings you chose, so there is
          nothing to describe. Choose settings it offers above.
        </span>
      ) : plan.startPlan === "settingsUnknown" ? (
        <span>
          MSCanvas does not yet know what this ProteoWizard installation can convert, so there is
          nothing to describe yet.
        </span>
      ) : (
        <span>Working out what this conversion would do…</span>
      )}
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
      <p className="quiet-text" data-testid="conversion-bound-membership">
        Membership and order were fixed when this queue started. Later workspace rows are outside this queue and its retry.
      </p>
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
        <p>{queue.destinationPolicy.kind === "customFolder"
          ? "Choose where to save the converted mzML."
          : "Resolving destinations beside the sources…"}</p>
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
            {/* `finalizedCount`, not `currentIndex`. The second is how many
                items are no longer pending, which between two items counts
                every failure, conflict skip, user skip and cancellation as
                well -- so a queue whose first file failed announced
                "Converted 1 of 2" while nothing had been converted at all.
                Directory re-admission widens the window this is read in. */}
            {(queue.items.some((item) => item.state === "running")
                    ? `Converting item ${String(runningPosition(queue))} of ${String(queue.itemCount)}…`
                    : `Converted ${String(queue.finalizedCount)} of ${String(queue.itemCount)}, starting the next…`)}
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
            {/* Beside Stop queue rather than in the row it is about. The two
                are the same kind of decision at two scales, and a control that
                ended one acquisition from inside the list would read as an
                attribute of that row instead of an action on the run. */}
            <button
              type="button"
              className="secondary-button"
              aria-describedby="conversion-cancel-item-scope"
              disabled={conversion.cancellableItem === null}
              onClick={conversion.cancelCurrentItem}
            >
              {conversion.cancellingItem ? "Stopping this file…" : "Stop this file"}
            </button>
          </div>
          <p className="quiet-text" id="conversion-stop-scope" role="note">
            {STOP_EXPLANATION}
          </p>
          <p className="quiet-text" id="conversion-cancel-item-scope" role="note">
            {conversion.cancellingItem
              ? CANCEL_ITEM_IN_FLIGHT_EXPLANATION
              : conversion.cancellableItem === null
                ? CANCEL_ITEM_UNAVAILABLE
                : `Stop this file ends ${conversion.cancellableItem.fileName} and carries on with the rest of the queue. ${CANCEL_ITEM_EXPLANATION}`}
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
        <p>{completedSummary(queue)}</p>
      )}

      <dl className="metadata-list" aria-label="Queue destination">
        <div>
          <dt>Queue destination</dt>
          <dd>{queue.destinationPolicy.kind === "customFolder" && queue.destinationStatus === "bound"
            ? "Chosen local folder"
            : describeDestination(queue.destinationPolicy)}</dd>
        </div>
        <div>
          <dt>Destination binding</dt>
          <dd>{queue.destinationStatus === "bound"
            ? "Bound when this queue started; revalidated before each attempt"
            : "No destination bound"}</dd>
        </div>
        <div>
          <dt>Queue conflict policy</dt>
          <dd>{CONFLICT_POLICY_LABEL[queue.conflictPolicy]}</dd>
        </div>
      </dl>

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
              {/* Only on a row that is actually waiting. Skipping is about an
                  item that has not started; the file being converted now is
                  ended by Stop this file, which says so. The same authoritative
                  state decides this and the dispatch, so the interface never
                  offers what Rust would refuse. */}
              {/* Left mounted and disabled while the skip is unanswered, for
                  the reason the queue stop and the adoption are: removing the
                  control a keyboard user just activated drops focus to the
                  document and announces nothing. */}
              {conversion.canSkipItem(index) || conversion.skippingItem(index) ? (
                <button
                  type="button"
                  className="link-button conversion-queue-skip"
                  disabled={conversion.skippingItem(index)}
                  onClick={() => {
                    conversion.skipItem(index);
                  }}
                >
                  {conversion.skippingItem(index)
                    ? `Skipping ${item.fileName}…`
                    : `Skip ${item.fileName}`}
                </button>
              ) : null}
              {/* Why there is no Skip here, at the row that does not have one.
                  Two rows both read "Waiting" during a rerun and only one is
                  skippable: the other failed in the earlier pass and keeps that
                  failure, which is a decision a reader cannot make sense of
                  from an absent control. The per-item stop states its own
                  unavailability for the same reason. */}
              {item.state === "pending" &&
              item.attempts > 0 &&
              state.status === "running" &&
              !conversion.canSkipItem(index) ? (
                <>
                  <span className="visually-hidden">, </span>
                  <span className="conversion-queue-reason">
                    Rerunning an earlier failure — it keeps that result if it is not run
                    again.
                  </span>
                </>
              ) : null}
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
              {/* Where the row's one word stops being the whole answer. The
                  label above is a projection and is lossy on purpose; the five
                  judgements it projects from stay inspectable here rather than
                  being spelled out five times per row on screen.

                  Not offered for a row that has not been attempted: a waiting
                  item has one honest answer to every one of the five, and a
                  disclosure that only ever says "nothing yet" teaches its own
                  uselessness. */}
              {item.state === "pending" || item.state === "running" ? null : (
                <ConversionItemJudgements index={index} item={item} />
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
                {/* Two different reasons there is no retry, and the sentence
                    names the one that applies. The refusal this milestone adds
                    always lands here -- a process nothing can account for is a
                    non-retryable failure -- and saying the acquisitions, folder
                    and settings would not change anything is true of them and
                    beside the point: what forbids another attempt is that the
                    session has stopped starting backend work at all. */}
                {conversion.backendQuarantined
                  ? "MSCanvas is not starting any more backend work this session, so there is nothing to retry until you restart it."
                  : "Those failures would not change on another attempt with the same acquisitions, folder and settings."}
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
/**
 * What a queue that ran to its own end did.
 *
 * Three counts used to be the whole vocabulary here, because a completed queue
 * could only reach three states: a cancelled item arrived only through a queue
 * stop, and a stopped queue is a different summary. M6.8 admitted ending the
 * file being converted and settling a waiting item, so a queue that completed
 * can now hold either -- and a three-count sentence would report two of three
 * items as unaccounted for.
 *
 * **And `notRun`, which only a stopped queue was assumed to hold.** A session
 * that loses track of a process it started refuses the rest of the queue
 * without the user having pressed anything, so the terminal reason is
 * `completed` and every row it never began is `notRun`. Naming only the first
 * five would have reported those rows nowhere -- the same defect this function
 * was widened to fix, reached by the path this milestone added.
 *
 * `cancellationFailed` is named beside it defensively rather than because this
 * path produces one: an item reaches that state only through a stop whose
 * termination could not be confirmed, and the queue is then `stopFailed`. A
 * count this summary cannot render is a count it would report nowhere if the
 * pairing ever changed.
 *
 * All four are named only when they happened. Unlike the stopped summary, where
 * every count is named including the zeroes because the reader is auditing what
 * a stop left behind, an ordinary completion has no such question to answer and
 * a row of zeroes for actions nobody took would be noise.
 */
function completedSummary(queue: ConversionQueue): string {
  const parts = [
    `${String(queue.finalizedCount)} converted`,
    `${String(queue.skippedCount)} skipped`,
    `${String(queue.failedCount)} failed`,
  ];
  if (queue.cancelledCount > 0) {
    parts.push(`${String(queue.cancelledCount)} cancelled`);
  }
  if (queue.skippedByRequestCount > 0) {
    parts.push(`${String(queue.skippedByRequestCount)} skipped by you`);
  }
  if (queue.notRunCount > 0) {
    parts.push(`${String(queue.notRunCount)} not run`);
  }
  if (queue.cancellationFailedCount > 0) {
    parts.push(`${String(queue.cancellationFailedCount)} stop could not be confirmed`);
  }
  return `${parts.join(", ")} of ${String(queue.itemCount)}.`;
}

function stoppedSummary(queue: ConversionQueue): string {
  const parts = [
    `${String(queue.finalizedCount)} converted`,
    `${String(queue.skippedCount)} skipped`,
    `${String(queue.failedCount)} failed`,
    `${String(queue.cancelledCount)} cancelled`,
    `${String(queue.notRunCount)} not run`,
    `${String(queue.skippedByRequestCount)} skipped by you`,
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
  // Says who decided, because that is the whole of what separates this from the
  // two states beside it. It deliberately does not say "nothing was created":
  // a destination folder the queue prepared is the queue's, and what became of
  // one item does not answer for it.
  skippedByRequest: "Skipped — you chose not to convert this one",
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
  return report.members
    .filter((member) => member.state === "finalized")
    .map((member) => member.fileName);
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
