import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { ownedErrorDetail } from "./ownedErrorMessages";
import { conversionCountParts, conversionErrorMessage, conversionNoticeMessage } from "./conversionMessages";
import { useEffect, useLayoutEffect, useRef, type ReactElement, type RefObject } from "react";

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
import { OutputOpenActions } from "./OutputOpenActions";
import { StagingRecoveryActions } from "./StagingRecoveryActions";
import { ConversionItemJudgements } from "./ConversionItemJudgements";
import type { ConversionRefusal } from "./conversionNoticeRegistry";
import { conversionNotices, conversionRefusalNoticeId } from "./conversionNoticeRegistry";
import { formatByteLength, formatCount, formatDuration } from "./format";
import type { ConversionConfigurationView } from "./useConversionConfiguration";
import type { ConversionOperation } from "./useConversionOperation";
import type { ConversionPlanView } from "./useConversionPlan";
import type { ConversionScope, ResolvedConversionScope } from "./conversionScope";
const SORT_MESSAGE = { added: "sortAdded", "name-asc": "sortNameAsc", "name-desc": "sortNameDesc", "size-asc": "sortSizeAsc", "size-desc": "sortSizeDesc" } as const;
import type { MessageKey, MessageParameters, UiMessage } from "../preferences/i18n";
type StaticMessageKey = Exclude<MessageKey, keyof MessageParameters>;

/**
 * What each conflict policy means, in the user's terms rather than the
 * boundary's. Exhaustive over the union, so a third policy fails compilation
 * here rather than rendering as a blank radio.
 */
const CONFLICT_POLICY_LABEL: Record<ConversionConflictPolicy, StaticMessageKey> = {
  fail: "m74CnvConflictFail",
  skip: "m74CnvConflictSkip",
};

const CONFLICT_POLICIES: readonly ConversionConflictPolicy[] = ["fail", "skip"];

const DESTINATION_LABEL: Record<DestinationPolicy["kind"], StaticMessageKey> = {
  customFolder: "m74CnvDestCustom",
  sourceSibling: "m74CnvDestSibling",
  namedSubfolder: "m74CnvDestNamed",
};
const DESTINATIONS: readonly DestinationPolicy["kind"][] = [
  "customFolder", "sourceSibling", "namedSubfolder",
];

function describeDestination(policy: DestinationPolicy, t: UiMessage): string {
  switch (policy.kind) {
    case "customFolder": return t("m74CnvDestinationCustomDescription");
    case "sourceSibling": return t("m74CnvDestinationSiblingDescription");
    case "namedSubfolder": return t("m74CnvNamedDestination", { name: policy.name || "—" });
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


/**
 * The plan summary sentence, family-aware.
 *
 * A homogeneous queue names its exact family, because "vendor" is vaguer than
 * what is known. A mixed queue counts first and then itemizes per family, in
 * plan order, so the sentence stays true for whatever combination the closed
 * vocabulary allows -- there is deliberately no generic vendor wording that a
 * new family could hide inside.
 */
function describeQueueFamilies(items: readonly ConversionQueuePlanItem[], t: UiMessage): string {
  const counts = new Map<DatasetSourceKind, number>();
  for (const item of items) {
    counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  }
  const count = items.length;
  const first = items[0];
  if (counts.size === 1 && first !== undefined) {
    const family = SOURCE_KIND_LABEL[first.sourceKind];
    return count === 1
      ? t("m74CnvOneFamily", { family })
      : t("m74CnvManyFamily", { count, family });
  }
  const perFamily = [...counts.entries()]
    .map(([kind, familyCount]) => `${String(familyCount)} ${SOURCE_KIND_LABEL[kind]}`)
    .join(" · ");
  return t("m74CnvMixedFamilies", { count, families: perFamily || "—" });
}

/**
 * What a backend-named set produces, said before it runs.
 *
 * A range and not a number, because the number is not known: the backend reads
 * the acquisition and decides how many documents it writes. The bound is the
 * lifecycle's own, carried on the plan so this states what Rust enforces rather
 * than a constant of its own.
 */
function outputSetSummary(maxMembers: number, t: UiMessage): string {
  return t("m74CnvOutputBound", { count: maxMembers });
}

/**
 * Why no filename is shown for a set.
 *
 * Said rather than left blank. A user who sees a name for every other row and
 * nothing for this one is owed the reason, and the reason is not that MSCanvas
 * does not know yet -- it is that the name is the backend's to choose.
 */


/**
 * What a full set publication establishes, in the only words the evidence
 * supports.
 *
 * Every clause is load-bearing. "Identified by the SCIEX reader" is narrower
 * than "in the acquisition", and the difference is exactly what this milestone
 * did not measure: the audit proves no sample the reader found was lost, not
 * that the reader found them all.
 */


/**
 * What a partially finalized acquisition means for the user.
 *
 * Deliberately not "nothing was converted", which is what a count-of-items
 * reading would produce and which is false: the finalized prefix is real, it is
 * in the folder they chose, and nothing here removes it. What it is not is the
 * acquisition's output set, which is why MSCanvas will not offer it as one.
 */


/** What each staging residue means for the folder the user chose. */


/**
 * What Stop queue does, said before it is pressed.
 *
 * Both halves matter. The first is what the user is asking for; the second is
 * what they are not losing, and without it "stop" reads as "undo" over files
 * that are already written and already theirs.
 */


/**
 * What ending one file does, said before it is pressed.
 *
 * The difference from Stop queue is the whole reason both exist, so it is
 * stated rather than implied: this one is about the acquisition being converted
 * now, and the queue keeps going.
 */


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


/**
 * What is true while *this file's* stop is in flight.
 *
 * The per-item counterpart of `t("m74CnvStopInFlight")`, and silent about
 * which of ending and finishing happens for the same reason: that is decided
 * by what the process boundary observes first.
 *
 * **Not silent about the third outcome.** "The queue keeps going either way"
 * described two of the three. A stop whose process tree cannot be confirmed
 * gone ends the whole queue and quarantines the session, which is the branch a
 * reader most needs said and the only one they cannot undo -- and this sentence
 * is on screen exactly while it is undecided. `t("m74CnvCancelItemExplanation")` says it
 * before the press; dropping it afterwards left the promise standing at the one
 * moment it was in doubt.
 */


/**
 * What is true while a stop is in flight.
 *
 * Deliberately silent about the current item. Whether it is cancelled or
 * finishes on its own is decided by which the process boundary observes first,
 * and a prediction here is a claim the next read could contradict.
 */


/**
 * What adding the outputs does, said before it is pressed.
 *
 * The first half is the promise this workflow is unusual for making: the file
 * that enters the workspace is checked to still be the exact one this queue
 * wrote, not merely a file of that name. The second is what it deliberately
 * does not do -- reading a converted file is a separate thing to ask for, and a
 * workflow that opened one would decide what the user is looking at.
 */


/**
 * What is true while an adoption is in flight.
 *
 * Not called converting: nothing is being converted, and a second word for the
 * same workflow would be the panel describing two things at once. No
 * percentage, because nothing measures a fraction of a file being checked.
 */


/**
 * The one sentence this action must never be offered without.
 *
 * Three claims in order, and the order is the argument. Local, so nobody looks
 * for an upload. Redacted, so the effort is stated. And then the limit — backend
 * text is written by an instrument's software about a real acquisition, and no
 * amount of path removal makes that anonymous. It ends by asking for the one
 * thing that actually protects the user, which is reading the file.
 */


/**
 * What is true while an export is being written.
 *
 * No percentage. The file is bounded at a couple of megabytes and is written in
 * one go, so a fraction would be a number invented to fill a progress bar.
 */


/** Why one output was not added, in the user's terms rather than the boundary's. */
const ADOPTION_REFUSAL_LABEL: Record<string, StaticMessageKey> = {
  output_missing: "m74CnvAdoptMissing",
  output_changed: "m74CnvAdoptChanged",
  output_unreadable: "m74CnvAdoptUnreadable",
  output_not_mzml: "m74CnvAdoptNotMzml",
  workspace_full: "m74CnvAdoptFull",
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
  const t = useUiMessages();
  const { state } = conversion;
  const terminal = state.status === "terminal";
  const convertButton = useRef<HTMLButtonElement | null>(null);
  const restoreAfterPicker = useRef(false);
  const currentReturn = useRef<() => void>(() => {});
  // A later focus destination permanently cancels the return, including one
  // which disappears before the picker settles. Opening Settings is such a
  // destination; a blur into a native window is not.
  useEffect(() => {
    const recordDestination = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== document.body &&
        event.target !== convertButton.current) restoreAfterPicker.current = false;
    };
    document.addEventListener("focusin", recordDestination);
    return () => document.removeEventListener("focusin", recordDestination);
  }, []);

  // Publish the current obligation at commit, before foreground events can
  // consult the previous passive effect's busy/plan facts.
  useLayoutEffect(() => {
    const restore = () => {
      if (conversion.busy || !restoreAfterPicker.current) return;
      if (state.status !== "idle") {
        restoreAfterPicker.current = false;
        return;
      }
      const button = convertButton.current;
      if (plan.startPlan === "reading" || button === null || !button.isConnected ||
        button.disabled || button.closest("[hidden], [inert]") !== null || !document.hasFocus()) return;
      const active = document.activeElement;
      if (active !== null && active !== document.body && active !== button) {
        restoreAfterPicker.current = false;
        return;
      }
      button.focus();
      if (document.activeElement === button) restoreAfterPicker.current = false;
    };
    currentReturn.current = restore;
    restore();
  });
  // A foreground turn belongs to this mounted consumer, not to one render.
  // Later commits update its facts without cancelling its pending frame.
  useLayoutEffect(() => {
    let frame: number | null = null;
    const foreground = () => {
      currentReturn.current();
      if (restoreAfterPicker.current && frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          currentReturn.current();
        });
      }
    };
    window.addEventListener("focus", foreground);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("focus", foreground);
    };
  }, []);

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
          <h2 id="conversion-panel-heading">{t("m74CnvTitle")}</h2>
          <p>{t("m74CnvSourceUnchanged")}</p>
        </div>
      </header>

      {conversion.error === null ? null : (
        <div className="notice notice-danger" role="status">
          {/* Both halves. The summary says what happened; the detail is where a
              refusal puts the part the user has to act on -- above all that a
              failed export left a temporary file in their folder. Rendering
              only the summary hid the one thing they could do about it. */}
          <span>
            {conversionErrorMessage(conversion.error, t)}
            {conversion.error.detail === null ? null : (
              <span className="notice-detail">{ownedErrorDetail(conversion.error, t)}</span>
            )}
          </span>
          <button className="link-button" onClick={conversion.dismissError} type="button">{t("m74CnvDismiss")}</button>
        </div>
      )}

      {conversion.busy || terminal ? (
        <QueueState
          onReviewNewPlan={() => {
            plan.invalidate();
            const panel = convertButton.current?.closest<HTMLElement>(".conversion-plan");
            panel?.focus({ preventScroll: true });
            panel?.scrollIntoView?.({ block: "nearest" });
          }}
          conversion={conversion}
          retryAvailability={retryAvailability}
          retryOffered={retryOffered}
        />
      ) : null}
      <AvailabilityNotice refusals={refusals} />
      <ConversionSettings
        configuration={configuration}
        onChoose={configuration.select}
        refusalNoticeId={settingsRefusalNoticeId}
      />
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
  const t = useUiMessages();
  return (
    <div
      aria-live="polite"
      className="conversion-availability"
      data-live-region="conversion-availability"
    >
      {conversionNotices(refusals).map((notice) => (
        <p className="notice notice-warning" id={notice.id} key={notice.reason}>
          {conversionNoticeMessage(notice.reason, t)}
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
  const t = useUiMessages();
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
          ? t("m74CnvNoCompleteSet")
          : t("m74CnvNothingToAdd")}
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
          ? t("m74CnvAdoptInFlight")
          : adoption === null
            ? ""
            : t("m74CnvAdoptionSummary", { added: String(added.length), duplicates: String(duplicates.length), refused: String(refused.length) })}
      </p>
      {adoption !== null && added.length === 0 && refused.length === 0 ? (
        <p>{t("m74CnvAllAlreadyAdded")}</p>
      ) : adoption !== null ? (
        <>
          {refused.slice(0, 3).map((outcome) => (
            <p
              className="quiet-text"
              key={`${String(outcome.itemIndex)}-${String(outcome.memberIndex)}`}
            >
              {t("m74CnvNotAdded", { name: outcome.outputFileName, reason: t(ADOPTION_REFUSAL_LABEL[outcome.kind === "refused" ? outcome.reason : ""] ?? "m74CnvAdoptUnverified") })}
            </p>
          ))}
          {refused.length > 3 ? (
            <p className="quiet-text">{t("m74CnvMoreRefused", { count: refused.length - 3 })}</p>
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
            ? t("m74CnvAdoptAgain")
            : eligibleOutputCount === 1
              ? t("m74CnvOneReady")
              : t("m74CnvManyReady", { count: eligibleOutputCount })}
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
              ? t("m74CnvAddOne")
              : t("m74CnvAddMany")}
          </button>
        </div>
        <p className="quiet-text" id="conversion-adopt-scope" role="note">
          {t("m74CnvAdoptExplanation")}
        </p>
      </>
      {/* Said whether or not anything was added. A queue that is replaced drops
          the way MSCanvas recognises these files, and nothing about that
          removes them -- so the honest fallback is named rather than left to be
          discovered. */}
      <p className="quiet-text">{t("m74CnvFilesRemain")}</p>
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
  const t = useUiMessages();
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
          ? t("m74CnvDiagnosticsInFlight")
          : diagnosticsExport === null
            ? ""
            : t("m74CnvDiagnosticsSaved", { name: diagnosticsExport.fileName, bytes: String(diagnosticsExport.byteLength), items: diagnosticsExport.diagnosticItemCount === 1 ? t("m74CnvDiagnosticItem") : t("m74CnvDiagnosticItems", { count: diagnosticsExport.diagnosticItemCount }) })}
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
          ? t("m74CnvOneDiagnostic")
          : t("m74CnvManyDiagnostics", { count: diagnosticItemCount })}
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
        >{t("m74CnvDiagnosticsAction")}</button>
      </div>
      <p className="quiet-text" id="conversion-diagnostics-scope" role="note">
        {t("m74CnvDiagnosticsExplanation")}
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
  const t = useUiMessages();
  const current = plan.current;
  const summary = current?.plan ?? null;
  // The rows the control names, which is what the reader selected rather than
  // what MSCanvas has finished describing. The plan is rendered in every state
  // now, so reading this off the summary made the label say "Convert 0
  // selected…" for the whole of the window a plan is being worked out -- a
  // count that was never true of anything.
  const count = resolvedScope.handles.length;
  return (
    <div className="conversion-plan" tabIndex={-1}>
      <fieldset className="conversion-scope" aria-describedby="conversion-scope-summary">
        <legend>{t("m74CnvScope")}</legend>
        <label><input type="radio" name="conversion-scope" value="selected"
          checked={resolvedScope.scope === "selected"} onChange={() => onScopeChange("selected")} />{t("m74CnvSelected")}</label>
        <label><input type="radio" name="conversion-scope" value="all"
          checked={resolvedScope.scope === "all"} onChange={() => onScopeChange("all")} />{t("m74CnvAll")}</label>
      </fieldset>
      <p id="conversion-scope-summary" aria-live="polite">
        {t("m74CnvScopeCounts", { requested: String(resolvedScope.requestedCount), eligible: String(count), excluded: String(resolvedScope.excludedCount) })}
        {resolvedScope.excludedCount > 0 ? t("m74CnvNotConvertible") : ""}.
        {resolvedScope.scope === "all" ? t("m74CnvScopeAllHelp") : t("m74CnvScopeSelectedHelp")}
      </p>
      <p className="quiet-text">{t("m74CnvOrder", { order: t(SORT_MESSAGE[resolvedScope.sort]) })}</p>
      <p className="quiet-text" data-testid="conversion-membership-help">{t("conversionMembershipHelp")}</p>
      {summary === null ? null : <p className="quiet-text" data-testid="conversion-capacity">{t("m74CnvCapacity", { count: summary.capacity })}</p>}
      {plan.capacityRefusal === null ? null : <p className="notice notice-warning" data-testid="conversion-capacity">
        {t("m74CnvCapacityExceeded", { count: plan.capacityRefusal.requestedCount, capacity: plan.capacityRefusal.capacity })}
      </p>}
      {summary === null ? (
        <>
          <PlanPending plan={plan} />
          {count === 0 ? null : <ol aria-label={t("m74CnvRequestedOrder")}>
            {resolvedScope.members.map((row, index) => <li key={row.handle}>
              <span className="conversion-queue-order">{index + 1}</span>
              <span className="conversion-queue-name">{row.fileName}</span>
            </li>)}
          </ol>}
        </>
      ) : (
        <>
          <p id="conversion-plan-summary">
            {describeQueueFamilies(summary.items, t)}
          </p>

          <ol aria-label={t("m74CnvReviewedOrder")} className="conversion-queue-list">
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
                <span className="visually-hidden">{t("m74CnvConvertsTo")}</span>
                {item.output.kind === "knownSingle" ? (
                  <span className="conversion-queue-output" title={item.output.fileName}>
                    {item.output.fileName}
                  </span>
                ) : (
                  <span
                    className="conversion-queue-output conversion-queue-output-set"
                    data-output-topology="backendNamedSet"
                  >
                    {outputSetSummary(item.output.maxMembers, t)}
                    <span className="visually-hidden">. </span>
                    <span className="conversion-queue-output-naming">
                      {t("m74CnvSetNaming")}
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
              <dt>{t("m74CnvOutput")}</dt>
              <dd>{summary.outputFormat}</dd>
            </div>
            <div>
              <dt>{t("m74CnvPeaks")}</dt>
              <dd>{t(CONVERSION_VALUE_LABEL.processing[summary.intent.processing])}</dd>
            </div>
            <div>
              <dt>{t("m74CnvSpectra")}</dt>
              <dd>{t(CONVERSION_VALUE_LABEL.population[summary.intent.population])}</dd>
            </div>
            <div>
              <dt>{t("m74CnvPrecision")}</dt>
              <dd>{t(CONVERSION_VALUE_LABEL.precision[summary.intent.precision])}</dd>
            </div>
            <div>
              <dt>{t("m74CnvCompression")}</dt>
              <dd>{summary.compression}</dd>
            </div>
            <div>
              <dt>{t("m74CnvConflict")}</dt>
              <dd>{t(CONFLICT_POLICY_LABEL[summary.conflictPolicy])}</dd>
            </div>
            <div>
              <dt>{t("m74CnvRequestedDestination")}</dt>
              <dd>{describeDestination(summary.destinationPolicy, t)}</dd>
            </div>
          </dl>

          <p className="quiet-text" id="conversion-validation-disclosure" role="note">
            {t("m74CnvOutputOnly")} {t("m74CnvStopScopes")}
          </p>

          {/* What this combination reduces, and only that. A combination that
              reduces nothing produces no list and therefore no reassuring
              sentence: silence is the honest answer where there is nothing to
              disclose. */}
          {conversionIntentDisclosures(summary.intent, t).map((disclosure) => (
            <p className="quiet-text" key={disclosure} role="note">
              {disclosure}
            </p>
          ))}
        </>
      )}

      <fieldset className="conversion-destination" aria-describedby="conversion-destination-scope">
        <legend>{t("m74CnvSaveFiles")}</legend>
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
            {t(DESTINATION_LABEL[kind])}
          </label>
        ))}
        {conversion.destinationPolicy.kind === "namedSubfolder" ? (
          <div className="conversion-subfolder">
            <label htmlFor="conversion-subfolder-name">{t("m74CnvSubfolderName")}</label>
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
            <p className="quiet-text" id="conversion-subfolder-help">{t("m74CnvSubfolderHelp")}</p>
          </div>
        ) : null}
        <p className="quiet-text" id="conversion-destination-scope">{t("m74CnvDestinationScope")}</p>
      </fieldset>

      <fieldset className="conversion-conflict" aria-describedby="conversion-conflict-scope">
        <legend>{t("m74CnvConflict")}</legend>
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
            {t(CONFLICT_POLICY_LABEL[policy])}
          </label>
        ))}
        <p className="quiet-text" id="conversion-conflict-scope">{t("m74CnvConflictScope")}</p>
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
          {resolvedScope.scope === "selected" ? t("m74CnvConvertSelected", { count }) : t("m74CnvConvertAll", { count })}
        </button>
        {/* An explicit re-ask of the same question, and nothing automatic. A
            plan can fail for a reason the reader cannot act on, and a machine
            whose only exit were a new question would pin `Convert` as refused
            for the session over one lost reply. */}
        {plan.retryOffered ? (
          <button className="link-button" onClick={plan.retry} type="button">{t("m74CnvDescribeAgain")}</button>
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
  const t = useUiMessages();
  return (
    <div className="empty-state" id={PLAN_PENDING_ID}>
      {plan.startPlan === "absent" ? <span>{t("m74CnvNoEligible")}</span>
      : plan.startPlan === "capacityExceeded" ? <span>{t("m74CnvScopeRefused")}</span>
      : plan.startPlan === "failed" && plan.error !== null ? (
        <span>{conversionErrorMessage(plan.error, t)}</span>
      ) : plan.startPlan === "selectionUnavailable" ? (
        <span>{t("m74CnvPlanUnavailable")}</span>
      ) : plan.startPlan === "selectionNotEvidenced" ? (
        <span>{t("m74CnvPlanUnevidenced")}</span>
      ) : plan.startPlan === "settingsUnknown" ? (
        <span>{t("m74CnvPlanUnknown")}</span>
      ) : (
        <span>{t("m74CnvPlanReading")}</span>
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
  onReviewNewPlan,
  conversion,
  retryAvailability,
  retryOffered,
}: {
  readonly onReviewNewPlan: () => void;
  readonly conversion: ConversionOperation;
  /** Whether this queue's failures may be rerun, and what to say when not. */
  readonly retryAvailability: ConversionAvailability;
  /** Whether the rerun control is on screen at all, decided by the panel. */
  readonly retryOffered: boolean;
}): ReactElement | null {
  const t = useUiMessages();
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
        <p>{t("m74CnvStarting")}</p>
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
      <p className="quiet-text" data-testid="conversion-bound-membership">{t("m74CnvBoundMembership")}</p>
      {retrying ? (
        <>
          <p>{t("m74CnvRetrying")}</p>
          {/* True for as long as this branch is on screen, which is until the
              state read dispatched beside the retry reports the rerun running.
              The sentence it replaced said this workflow could not cancel a
              running queue, which stopped being true in this release. */}
          <p className="quiet-text" role="note">{t("m74CnvRetryStopAvailability")}</p>
        </>
      ) : state.status === "awaitingDestination" ? (
        <p>{queue.destinationPolicy.kind === "customFolder"
          ? t("m74CnvChooseDestination")
          : t("m74CnvResolvingDestinations")}</p>
      ) : state.status === "stopping" || (state.status === "running" && conversion.stopping) ? (
        <>
          <p>{t("m74CnvStopping")}</p>
          {/* Deliberately says nothing about how the current item will end.
              Whether it is cancelled or finishes on its own is decided by
              which the process boundary observes first, and predicting it here
              would put a claim on screen that the next read could contradict. */}
          <p className="quiet-text" role="note">
            {t("m74CnvStopInFlight")}
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
                    ? t("m74CnvRunningItem", { position: runningPosition(queue), total: queue.itemCount })
                    : t("m74CnvBetweenItems", { count: queue.finalizedCount, total: queue.itemCount }))}
          </p>
          <div className="conversion-actions">
            <button
              type="button"
              className="secondary-button"
              aria-describedby="conversion-stop-scope"
              disabled={!conversion.canStop}
              onClick={conversion.stop}
            >{t("m74CnvStopQueue")}</button>
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
              {conversion.cancellingItem ? t("m74CnvStoppingFile") : t("m74CnvStopFile")}
            </button>
          </div>
          <p className="quiet-text" id="conversion-stop-scope" role="note">
            {t("m74CnvStopExplanation")}
          </p>
          <p className="quiet-text" id="conversion-cancel-item-scope" role="note">
            {conversion.cancellingItem
              ? t("m74CnvCancelItemInFlight")
              : conversion.cancellableItem === null
                ? t("m74CnvCancelItemUnavailable")
                : `${t("m74CnvCancelNamed", { name: conversion.cancellableItem.fileName })} ${t("m74CnvCancelItemExplanation")}`}
          </p>
        </>
      ) : state.reason === "stopFailed" ? (
        // Deliberately not "Queue stopped". That state means a converter may
        // still be running, and a heading someone skims is exactly where the
        // claim must not be made and then walked back by the warning below it.
        <p>{t("m74CnvStopUnconfirmed")}</p>
      ) : state.reason === "stopped" ? (
        <p>{t("m74CnvStopped")}</p>
      ) : (
        <p>{completedSummary(queue, t)}</p>
      )}

      <details className="conversion-bound-details">
        <summary>{t("m74CnvBoundDetails")}</summary>
        <dl className="metadata-list" aria-label={t("m74CnvQueueDestinationAria")}>
        <div>
          <dt>{t("m74CnvQueueDestination")}</dt>
          <dd>{queue.destinationPolicy.kind === "customFolder" && queue.destinationStatus === "bound"
            ? t("m74CnvChosenLocal")
            : describeDestination(queue.destinationPolicy, t)}</dd>
        </div>
        <div>
          <dt>{t("m74CnvDestinationBinding")}</dt>
          <dd>{queue.destinationStatus === "bound"
            ? t("m74CnvDestinationBound")
            : t("m74CnvDestinationUnbound")}</dd>
        </div>
        <div>
          <dt>{t("m74CnvQueueConflict")}</dt>
          <dd>{t(CONFLICT_POLICY_LABEL[queue.conflictPolicy])}</dd>
        </div>
        </dl>
      </details>

      {state.status === "terminal" && state.reason === "stopFailed" ? (
        <p className="notice notice-danger" role="alert">
          <span aria-hidden="true">⚠ </span>
          {t("m74CnvBackendStopUnconfirmed")}
          {conversion.backendQuarantined
            ? t("m74CnvRestartBackend")
            : ""}
        </p>
      ) : null}

      {queue.error === null ? null : (
        <p className="notice notice-danger" role="status">
          {conversionErrorMessage(queue.error, t)}
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
              <span className="visually-hidden">{t("m74CnvConvertsTo")}</span>
              {item.output.kind === "knownSingle" ? (
                <span className="conversion-queue-output" title={item.output.fileName}>
                  {item.output.fileName}
                </span>
              ) : (
                <span
                  className="conversion-queue-output conversion-queue-output-set"
                  data-output-topology="backendNamedSet"
                >
                  {itemOutputSummary(item, set, t)}
                </span>
              )}
              <span className="visually-hidden">, </span>
              <span className="conversion-queue-status">{itemStateLabel(item, t)}</span>
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
                    ? t("m74CnvSkipping", { name: item.fileName })
                    : t("m74CnvSkip", { name: item.fileName })}
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
                  <span className="conversion-queue-reason">{t("m74CnvRetryKeepsFailure")}</span>
                </>
              ) : null}
              {item.attempts > 1 ? (
                <>
                  <span className="visually-hidden">, </span>
                  <span className="conversion-queue-attempts">
                    {t("m74CnvAttempt", { count: item.attempts })}
                  </span>
                </>
              ) : null}
              {item.state === "failed" ? (
                <>
                  <span className="visually-hidden">, </span>
                  <span className="conversion-queue-reason">{itemFailureSentence(item, t)}</span>
                </>
              ) : null}
              {/* What was actually produced, per item. A queue that said only
                  `Converted` would have taken away the one thing that lets a user
                  tell a real conversion from an empty one. */}
              {single?.output == null ? null : (
                <>
                  <span className="visually-hidden">, </span>
                  <span className="conversion-queue-facts">
                    {t("m74CnvOutputMetrics", { bytes: formatByteLength(single.output.byteLength), spectra: formatCount(single.output.spectrumCount), chromatograms: formatCount(single.output.chromatogramCount) })}
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
                  <span className="conversion-queue-set-result">{setResultSentence(set, t)}</span>
                  {set.completeness.kind === "established" ? (
                    <span className="conversion-queue-set-completeness">
                      {t("m74CnvSampleCompleteness")}
                    </span>
                  ) : null}
                  {set.partial === null ? null : (
                    <span className="conversion-queue-set-partial notice notice-warning" role="note">
                      {t("m74CnvPartialExplanation")}
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
                  <span className="conversion-queue-residue">{t("m74CnvResidue")}</span>
                </>
              )}
              {item.stagingRecovery !== null && (item.stagingRecovery.status !== "cleaned" || (single?.stagingResidue ?? set?.stagingResidue ?? item.cancellation?.stagingResidue) != null) ? (
                <StagingRecoveryActions key={item.stagingRecovery.recoveryId} recovery={item.stagingRecovery} enabled={state.status === "terminal" && !conversion.busy && !conversion.backendQuarantined} reclaim={conversion.reclaimStaging} onReview={onReviewNewPlan} />
              ) : null}
              {item.finalizedOutputs.map(output => <OutputOpenActions key={output.outputId} output={output} />)}
              {/* Where the row's one word stops being the whole answer. The
                  label above is a projection and is lossy on purpose; the five
                  judgements it projects from stay inspectable here rather than
                  being spelled out five times per row on screen.

                  Not offered for a row that has not been attempted: a waiting
                  item has one honest answer to every one of the five, and a
                  disclosure that only ever says "nothing yet" teaches its own
                  uselessness.

                  Attempts, not state. A retry returns every retryable failure
                  to `pending` and *keeps* its report and its attempt facts
                  until that item is actually rerun -- the row says so in its
                  own label -- so hiding on the state alone took the retained
                  judgements away from every later item for as long as an
                  earlier conversion was still running. */}
              {(item.state === "pending" && item.attempts === 0) ||
              item.state === "running" ? null : (
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
              {t("m74CnvOutputOnly")}
            </p>
          ) : null}
          {/* The counts a stopped queue is judged by, said in full and kept
              apart. A cancelled item is not a failure and a not-run item is
              not an attempt, so folding either into `failed` would report work
              the user stopped as work that broke. */}
          {state.reason === "completed" ? null : (
            <>
              <p className="conversion-stopped-summary">{stoppedSummary(queue, t)}</p>
              <p className="quiet-text">{t("m74CnvStoppedFilesRemain")}</p>
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
                  ? t("m74CnvQuarantineRetry")
                  : t("m74CnvNonRetryable")}
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
                {t("m74CnvRetry", { count: queue.retryableFailedCount })}
              </button>
              <span className="visually-hidden" id="conversion-retry-scope">{t("m74CnvRetryScope")}</span>
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
function completedSummary(queue: ConversionQueue, t: UiMessage): string {
  return t("m74CnvQueueCounts", { parts: conversionCountParts(queue, false, t).join(t("m74CnvListSeparator")), total: queue.itemCount });
}

function stoppedSummary(queue: ConversionQueue, t: UiMessage): string {
  return t("m74CnvQueueCounts", { parts: conversionCountParts(queue, true, t).join(t("m74CnvListSeparator")), total: queue.itemCount });
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
function itemStateLabel(item: ConversionQueueItem, t: UiMessage): string {
  if (item.state === "skipped" && item.output.kind === "backendNamedSet") {
    return t("m74CnvSetSkipped");
  }
  return t(ITEM_STATE_LABEL[item.state]);
}

/**
 * What a skipped output set says.
 *
 * Every one of them, not one of them: the multi-output lifecycle steps aside
 * only when it finds a file at every destination name it discovered, so a
 * sentence about "a file of that name" would describe a name this item never
 * had.
 */


/** What each item state says, in words rather than in colour. */
const ITEM_STATE_LABEL: Record<ConversionQueueItem["state"], StaticMessageKey> = {
  cancelled: "m74CnvStateCancelled",
  cancellationFailed: "m74CnvStateUnconfirmed",
  notRun: "m74CnvStateNotRun",
  // Says who decided, because that is the whole of what separates this from the
  // two states beside it. It deliberately does not say "nothing was created":
  // a destination folder the queue prepared is the queue's, and what became of
  // one item does not answer for it.
  skippedByRequest: "m74CnvStateUserSkipped",
  pending: "m74CnvStatePending",
  running: "m74CnvStateRunning",
  finalized: "m74CnvStateFinalized",
  skipped: "m74CnvStateSkipped",
  failed: "m74CnvStateFailed",
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
  t: UiMessage,
): string {
  const maxMembers =
    item.output.kind === "backendNamedSet" ? item.output.maxMembers : 1;
  if (report === null || report.finalizedCount === 0) {
    return outputSetSummary(maxMembers, t);
  }
  return report.finalizedCount === 1
    ? t("m74CnvSingleOutput")
    : t("m74CnvManyOutputs", { count: report.finalizedCount });
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
function setResultSentence(report: ConversionOutputSetReport, t: UiMessage): string {
  if (report.partial !== null) {
    return t("m74CnvPartialCounts", { count: report.partial.finalizedCount, total: report.memberCount, unpublished: String(report.partial.notPublishedCount) });
  }
  if (report.finalizedCount === 0) {
    return t("m74CnvNoFinalizedOutputs");
  }
  return report.finalizedCount === 1
    ? t("m74CnvOneFinalized")
    : t("m74CnvManyFinalized", { count: report.finalizedCount });
}

/** Why one item failed, from whichever half of the boundary refused it. */
function itemFailureSentence(item: ConversionQueueItem, t: UiMessage): string {
  if (item.error !== null) {
    return conversionErrorMessage(item.error, t);
  }
  const set = setReportOf(item);
  if (set !== null) {
    return setFailureSentence(set, t);
  }
  const report = singleReportOf(item);
  if (report === null) {
    return t("m74CnvNoWrittenFile");
  }
  return failureSentence(report, t);
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
const SET_REFUSAL_SENTENCE: Record<string, StaticMessageKey> = {
  // The destination. Actionable, and the two are genuinely different: one name
  // was taken, or some were taken and some were not.
  multi_output_destination_occupied:
    "m74CnvSetOccupied",
  multi_output_mixed_destination_conflict:
    "m74CnvSetMixed",
  multi_output_output_name_claimed_elsewhere:
    "m74CnvSetClaimed",
  multi_output_destination_not_inspectable:
    "m74CnvSetUninspectable",
  multi_output_destination_root_not_opened:
    "m74CnvSetUnopened",

  // The build. Actionable by choosing a different ProteoWizard installation.
  multi_output_provider_build_not_evidenced:
    "m74CnvSetUnevidenced",

  // The acquisition. Actionable by opening it again.
  multi_output_source_not_still_admitted:
    "m74CnvSetSourceChanged",
  multi_output_source_bundle_not_bound:
    "m74CnvSetSourceUnheld",

  // What the reader said about samples. Not actionable in the app, and that is
  // the point: it is what stops the outputs being called this acquisition.
  source_sample_failure_observed:
    "m74CnvSetSampleFailed",
  source_sample_audit_truncated:
    "m74CnvSetAuditTruncated",
  source_sample_output_filtering_requested:
    "m74CnvSetSamplesFiltered",

  // What was produced. Not actionable, and reported rather than smoothed over.
  multi_output_set_not_as_declared:
    "m74CnvSetMismatched",
  multi_output_member_rejected:
    "m74CnvSetMemberRejected",
};

/** What a failed output set says. */
function setFailureSentence(report: ConversionOutputSetReport, t: UiMessage): string {
  // A partial publication is explained in full beside this, and must not be
  // preceded by a sentence saying nothing was written.
  if (report.partial !== null) {
    return t("m74CnvIncompleteSet");
  }
  const detailed = report.detailedOutcome;
  if (detailed !== null) {
    const sentence = SET_REFUSAL_SENTENCE[detailed];
    if (sentence !== undefined) {
      return t(sentence);
    }
  }
  return t("m74CnvNoPublishedSet");
}

/**
 * What a failed conversion says.
 *
 * Grouped by the boundary's own outcome and explained by its detailed one, with
 * a fallback that is honest rather than specific: an identifier this build has
 * no sentence for is still a failure, and inventing prose for it would be
 * inventing a diagnosis.
 */
function failureSentence(report: ConversionReport, t: UiMessage): string {
  // Grouped by `outcome` first, because that is what groups. An integrity
  // rejection's `detailedOutcome` is the specific property that failed --
  // `partial_output`, `missing_output` and the rest -- so matching on it here
  // would leave every one of them falling through to the generic sentence and
  // never say that a file was produced and then discarded.
  if (report.outcome === "output_rejected") {
    return t("m74CnvSingleRejected");
  }
  // The two failures that happen strictly *after* the check returned a valid
  // output. A file was written and judged, and only giving it its final name
  // failed -- so the generic "the conversion did not finish, so no file was
  // written" below is false of both, and contradicts the item's own staged and
  // integrity judgements.
  if (report.outcome === "output_not_finalized") {
    return t("m74CnvFinalizeFailed");
  }
  if (report.outcome === "destination_appeared_during_run") {
    return t("m74CnvAppearedDuringRun");
  }
  switch (report.detailedOutcome) {
    case "destination_exists":
      return t("m74CnvNameOccupied");
    case "source_family_not_evidenced":
      return t("m74CnvSingleUnevidenced");
    default:
      return t("m74CnvNoWrittenFile");
  }
}
