import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { ownedErrorDetail } from "./ownedErrorMessages";
import { conversionCountParts, conversionErrorMessage, conversionJudgedOutputOnly, conversionNoticeMessage } from "./conversionMessages";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";

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
import { SOURCE_KIND_LABEL } from "./contracts";
import type { ConversionAvailability } from "./conversionAvailability";
import { ConversionSettings, CONVERSION_VALUE_LABEL, precisionNote } from "./ConversionSettings";
import { conversionAvailability, conversionNoticeId } from "./conversionAvailability";
import { OutputOpenActions } from "./OutputOpenActions";
import { STAGING_STATUS_ID, StagingRecoveryActions } from "./StagingRecoveryActions";
import { ADOPTION_REFUSAL_LABEL, ConversionItemJudgements } from "./ConversionItemJudgements";
import type { ConversionRefusal } from "./conversionNoticeRegistry";
import { conversionNotices, conversionRefusalNoticeId } from "./conversionNoticeRegistry";
import { formatByteLength, formatCount, formatDuration } from "./format";
import type { ConversionConfigurationView } from "./useConversionConfiguration";
import type { ConversionOperation, ConversionRequestFailure } from "./useConversionOperation";
import type { ConversionPlanView } from "./useConversionPlan";
import type { ConversionScope, ResolvedConversionScope } from "./conversionScope";
import { SORT_MODES, isSortMode, type SortMode } from "./rosterView";
import { Button, Disclosure, Icon, IconButton } from "../../components/ui";
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

const SCOPES: readonly ConversionScope[] = ["selected", "all"];

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
    case "sourceSibling": return t("m74CnvDestSibling");
    case "namedSubfolder": return t("m74CnvNamedDestination", { name: policy.name || "—" });
  }
}

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
  /** The execution order the queue takes, kept by the roster (`sortChanged`). */
  readonly onSortChange: (sort: SortMode) => void;
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
  onSortChange,
}: ConversionPanelProps): ReactElement | null {
  const t = useUiMessages();
  const { state } = conversion;
  const terminal = state.status === "terminal";
  const convertButton = useRef<HTMLButtonElement | null>(null);
  const restoreAfterPicker = useRef(false);
  // Basic or Advanced, kept here rather than in the settings, which leave the
  // screen while a queue runs (PM9.4 R5).
  const [settingsView, setSettingsView] = useState<"basic" | "advanced">("basic");
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
        button.getAttribute("aria-disabled") === "true" || button.closest("[hidden], [inert]") !== null ||
        !document.hasFocus()) return;
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
  // The settings belong to the next conversion, which is not on screen while a
  // queue runs (PM9.4 R5), and neither is their retry then.
  const settingsRefusal: ConversionRefusal | null =
    !conversion.busy && configuration.retryOffered && configuration.refusal !== null
      ? { source: "probe", refusal: configuration.refusal }
      : null;

  /*
   * What refuses a finished queue's own actions -- Add, Diagnostics and the
   * staging cleanup -- while another of them runs (PM9.4 O8).
   *
   * The running action already says what it is doing on its own status line,
   * so a refused control points there rather than at a second sentence for the
   * same moment, and nothing new is announced. Only a settling file list has
   * no line of its own in this panel; Add's wait for it is said once, with the
   * notices.
   */
  const heldBy = conversion.reclaimingStaging ? STAGING_STATUS_ID
    : conversion.adopting ? ADOPT_STATUS_ID
    : conversion.exportingDiagnostics ? DIAGNOSTICS_STATUS_ID
    : null;
  const adoptOffered = terminal && !conversion.retrying && conversion.eligibleOutputCount > 0;
  const adoptSettling = adoptOffered && !conversion.canAdopt && heldBy === null && conversion.lane.workspaceSettling;
  const refusedBy: QueueRefusals = {
    adopt: conversion.canAdopt ? null : heldBy ?? (adoptSettling ? conversionNoticeId("workspace-settling") : null),
    diagnostics: conversion.canExportDiagnostics ? null : heldBy,
    // The cleanup's own rule: a terminal queue, nothing else in flight, and a
    // session that still trusts the backend. Whatever holds the lane without a
    // line of its own here is the queue, whose status line says what it is.
    cleanup: heldBy ?? (!terminal || conversion.busy ? QUEUE_STATUS_ID
      : conversion.backendQuarantined ? conversionNoticeId("backend-quarantined") : null),
  };
  /** Every action currently on screen, and what refuses it. */
  const refusals: readonly (ConversionRefusal | null)[] = [
    startOffered ? { source: "action", availability: startAvailability } : null,
    retryOffered ? { source: "action", availability: retryAvailability } : null,
    settingsRefusal,
    adoptSettling ? { source: "action", availability: { status: "unavailable", reason: "workspace-settling" } } : null,
  ];
  // The id the settings retry points at, minted once here rather than by the
  // child. Handed down so the control names the element this panel actually
  // rendered.
  const settingsRefusalNoticeId = conversionRefusalNoticeId(settingsRefusal);

  /*
   * Where the keyboard goes when the control it pressed leaves (PM9.4 R11).
   *
   * Convert takes the plan with it, Retry the finished block, Stop queue its
   * own branch, and a settling queue the controls of the one that ran. Each
   * time the document would put focus on the body, which a keyboard user hears
   * as nothing and has to walk back from the top. The queue's status line is
   * what changed, so it takes focus -- never the roster or the plan, which are
   * somewhere else entirely. Only when focus was actually lost: a reader who
   * moved it on keeps it where they put it. And not while the custom-folder
   * picker is still open: its return to Convert is the picker's own.
   */
  const panel = useRef<HTMLElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = panel.current;
    if (node === null) return;
    // Only the controls whose leaving the status line explains: Convert, and
    // the queue's own (Stop, Retry, Skip, Add…). A plan-side link that leaves
    // under a finished queue is not answered by the old queue's status.
    const record = (event: FocusEvent) => {
      const target = event.target;
      lastFocused.current =
        target instanceof HTMLElement && (target === convertButton.current || target.closest(".conversion-running") !== null)
          ? target
          : null;
    };
    node.addEventListener("focusin", record);
    return () => node.removeEventListener("focusin", record);
  }, []);
  useLayoutEffect(() => {
    const left = lastFocused.current;
    if (left === null || left.isConnected) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      lastFocused.current = null;
      return;
    }
    // From the press until the picker answers -- the starting window, the
    // wait for a destination, and a cancel back to idle -- the return to
    // Convert is the picker's own. A press under a finished queue starts in
    // that window with the slot still `terminal`.
    if (restoreAfterPicker.current &&
      (conversion.converting || state.status === "awaitingDestination" || state.status === "idle")) return;
    const status = panel.current?.querySelector<HTMLElement>(`#${QUEUE_STATUS_ID}`) ?? null;
    if (status === null) return;
    lastFocused.current = null;
    status.focus();
  });

  const queueShown = conversion.busy || terminal;
  const planSummary = (
    <PlanSummary
      conversion={conversion}
      configuration={configuration}
      plan={plan}
      resolvedScope={resolvedScope}
      onScopeChange={onScopeChange}
      onSortChange={onSortChange}
      repeating={terminal}
      startAvailability={startAvailability}
      convertButton={convertButton}
      onCustomStart={() => { restoreAfterPicker.current = true; }}
    />
  );
  // Two columns, each its own scroll owner (rebuild spec 5): the form -- or the
  // queue's rows -- on the left, and on the right what that adds up to with the
  // action that starts or settles it. Both are always mounted, so the live
  // availability notice in the second is watched before its text arrives.
  return (
    <section
      ref={panel}
      aria-busy={conversion.busy}
      aria-labelledby="conversion-panel-heading"
      className="conversion-panel"
      data-phase={conversion.busy ? "running" : terminal ? "finished" : "plan"}
    >
      <div className="conversion-main">
        {conversion.failure === null ? null : (
          <div className="notice notice-danger conversion-notice" role="status">
            {/* Both halves. The summary says what happened; the detail is where a
                refusal puts the part the user has to act on -- above all that a
                failed export left a temporary file in their folder. Rendering
                only the summary hid the one thing they could do about it.
                Led by the name of the control whose request failed, because this
                sits above all of them (PM9.4 O4). */}
            <span>
              <strong>{t("m74CnvRequestFailed", { action: requestLabel(conversion.failure, t) })}</strong>
              {conversionErrorMessage(conversion.failure.error, t)}
              {conversion.failure.error.detail === null ? null : (
                <span className="notice-detail">{ownedErrorDetail(conversion.failure.error, t)}</span>
              )}
            </span>
            <IconButton size="sm" icon={<Icon name="close" />} label={t("m74CnvDismiss")} onClick={conversion.dismissError} />
          </div>
        )}

        {queueShown ? (
          <QueueState
            part="rows"
            onReviewNewPlan={() => {
              plan.invalidate();
              const next = panel.current?.querySelector<HTMLElement>(".conversion-plan");
              next?.focus({ preventScroll: true });
              next?.scrollIntoView?.({ block: "nearest" });
            }}
            conversion={conversion}
            retryAvailability={retryAvailability}
            retryOffered={retryOffered}
            refusedBy={refusedBy}
          />
        ) : null}
        {/* Not while a queue is under way. The plan is an ordered list of file to
            output and so is the running queue, and two of them side by side
            -- one live, one hypothetical, and the hypothetical one's button
            refused -- is the panel describing two different things in the same
            shape. A finished queue is different: there the plan is how the user
            converts something else, so it stays, under its own heading, below
            the results; its summary and Convert stay in the summary column,
            directly under the notice that explains them. The settings are the
            next conversion's and go with it (PM9.4 R5). */}
        {conversion.busy ? null : (
          <div className="conversion-plan" tabIndex={-1} role={terminal ? "group" : undefined}
            aria-labelledby={terminal ? "conversion-next-heading" : undefined}>
            {terminal ? <h3 id="conversion-next-heading">{t("m74CnvNextConversion")}</h3> : null}
            <PlanForm
              conversion={conversion}
              configuration={configuration}
              settingsRefusalNoticeId={settingsRefusalNoticeId}
              settingsView={settingsView}
              onSettingsViewChange={setSettingsView}
              plan={plan}
            />
          </div>
        )}
      </div>
      <div className="conversion-side">
        <h2 id="conversion-panel-heading">{t("m74CnvTitle")}</h2>
        {queueShown ? (
          <QueueState
            part="summary"
            conversion={conversion}
            retryAvailability={retryAvailability}
            retryOffered={retryOffered}
            refusedBy={refusedBy}
          />
        ) : null}
        <AvailabilityNotice refusals={refusals} />
        {conversion.busy ? null : terminal ? (
          // The next conversion's half of the summary column, set apart from
          // the finished queue's and named like the settings it describes.
          <div className="conversion-next-summary" role="group" aria-labelledby="conversion-next-summary-label">
            <p className="conversion-field-label" id="conversion-next-summary-label">{t("m74CnvNextConversion")}</p>
            {planSummary}
          </div>
        ) : planSummary}
      </div>
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
function describedBy(base: string, availability: ConversionAvailability): string | undefined {
  const notice = conversionRefusalNoticeId({ source: "action", availability });
  return [base, notice].filter(Boolean).join(" ") || undefined;
}

/** Each request by the name of the control that sends it (PM9.4 O4). */
function requestLabel(failure: ConversionRequestFailure, t: UiMessage): string {
  switch (failure.request) {
    case "convert": return t("m74CnvTitle");
    case "stop": return t("m74CnvStopQueue");
    case "stopFile": return t("m74CnvStopFile");
    case "skip": return t("m74CnvSkip", { name: failure.name });
    case "retry": return t("m74CnvRetry", { count: failure.count });
    case "adopt": return t(failure.count === 1 ? "m74CnvAddOne" : "m74CnvAddMany");
    case "exportDiagnostics": return t("m74CnvDiagnosticsAction");
  }
}

/** The status lines of the adoption and the export, which the actions they refuse point at. */
const ADOPT_STATUS_ID = "conversion-adopt-status";
const DIAGNOSTICS_STATUS_ID = "conversion-diagnostics-status";

/** What each finished-queue action points at while it is refused, or `null` while it is not. */
interface QueueRefusals {
  readonly adopt: string | null;
  readonly diagnostics: string | null;
  readonly cleanup: string | null;
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
function AdoptOutputs({ conversion, refusedBy }: {
  readonly conversion: ConversionOperation;
  /** What says why Add is refused, while it is. */
  readonly refusedBy: string | null;
}): ReactElement | null {
  const t = useUiMessages();
  const { adoption, eligibleOutputCount } = conversion;
  const added = adoption?.outcomes.filter((outcome) => outcome.kind === "added") ?? [];
  const duplicates =
    adoption?.outcomes.filter((outcome) => outcome.kind === "alreadyInWorkspace") ?? [];
  const refused = adoption?.outcomes.filter((outcome) => outcome.kind === "refused") ?? [];

  // Nothing to offer. Each item's row and the queue's counts already say why,
  // including a partial set whose finalized files stay in the folder.
  if (eligibleOutputCount === 0) {
    return null;
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
      <p aria-live="polite" className="conversion-adoption-summary" id={ADOPT_STATUS_ID}>
        {conversion.adopting
          ? t("m74CnvAdoptInFlight")
          : adoption === null
            ? ""
            : t("m74CnvAdoptionSummary", { added: String(added.length), duplicates: String(duplicates.length), refused: String(refused.length) })}
      </p>
      {adoption !== null ? (
        <>
          {refused.slice(0, 3).map((outcome) => (
            <p
              className="quiet-text"
              key={`${String(outcome.itemIndex)}-${String(outcome.memberIndex)}`}
            >
              {t("m74CnvNotAdded", { name: outcome.outputFileName, reason: t((outcome.kind === "refused" ? ADOPTION_REFUSAL_LABEL[outcome.reason as keyof typeof ADOPTION_REFUSAL_LABEL] : undefined) ?? "m74CnvAdoptUnverified") })}
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
        {adoption === null ? (
          <p>
            {eligibleOutputCount === 1
              ? t("m74CnvOneReady")
              : t("m74CnvManyReady", { count: eligibleOutputCount })}
          </p>
        ) : null}
        <div className="conversion-actions">
          {/* Refused rather than `disabled`, for the reason the comment above
              gives: Chromium drops focus from a control that becomes natively
              disabled (PM9.4 R11). The one filled primary of a finished queue. */}
          <Button
            variant="primary"
            className="conversion-wide-action"
            refused={!conversion.canAdopt}
            aria-describedby={refusedBy ?? undefined}
            onClick={() => conversion.adopt()}
          >
            {eligibleOutputCount === 1
              ? t("m74CnvAddOne")
              : t("m74CnvAddMany")}
          </Button>
        </div>
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
  refusedBy,
}: {
  readonly conversion: ConversionOperation;
  /** What says why the export is refused, while it is. */
  readonly refusedBy: string | null;
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
  // it; being unavailable for a moment is what a refused state is for.
  if (!conversion.diagnosticsAvailable && !conversion.exportingDiagnostics) {
    return null;
  }

  return (
    <div className="conversion-diagnostics">
      {/* The one place the result is said, so a screen-reader user hears it
          without moving and a sighted one reads it in the same words. Emptied
          only while there is nothing to say. */}
      <p aria-live="polite" className="conversion-diagnostics-summary" id={DIAGNOSTICS_STATUS_ID}>
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
        {/* `aria-disabled` and the activation guard, never native disabled.
            The native picker's initiator keeps its focus while its export
            runs (native disabled drops it to the document in WebView2), and a
            control another action refuses stays a Tab stop whose reason can be
            reached (PM9.4 O8). */}
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="download" />}
          refused={!conversion.canExportDiagnostics}
          aria-describedby={refusedBy === null ? "conversion-diagnostics-scope" : `conversion-diagnostics-scope ${refusedBy}`}
          onClick={() => conversion.exportDiagnostics()}
        >{t("m74CnvDiagnosticsAction")}</Button>
      </div>
      <p className="quiet-text" id="conversion-diagnostics-scope" role="note">
        {t("m74CnvDiagnosticsExplanation")}
      </p>
    </div>
  );
}

/**
 * The settings a conversion is made with: what is written, where to, and what
 * happens when a name is taken. The form column; its summary and the control
 * that starts it are `PlanSummary`.
 */
function PlanForm({
  conversion,
  configuration,
  settingsRefusalNoticeId,
  settingsView,
  onSettingsViewChange,
  plan,
}: {
  readonly conversion: ConversionOperation;
  readonly configuration: ConversionConfigurationView;
  /** The notice the settings read's retry points at, minted by the panel. */
  readonly settingsRefusalNoticeId: string | null;
  readonly settingsView: "basic" | "advanced";
  readonly onSettingsViewChange: (view: "basic" | "advanced") => void;
  readonly plan: ConversionPlanView;
}): ReactElement {
  const t = useUiMessages();
  return (
    <>
      <ConversionSettings
        configuration={configuration}
        onChoose={configuration.select}
        refusalNoticeId={settingsRefusalNoticeId}
        view={settingsView}
        onViewChange={onSettingsViewChange}
      />

      <fieldset className="conversion-destination">
        <legend>{t("m74CnvSaveFiles")}</legend>
        <div className="conversion-options">
          {DESTINATIONS.map((kind) => (
            <label className="conversion-option" key={kind}>
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
        </div>
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
            <p className="visually-hidden" id="conversion-subfolder-help">{t("m74CnvSubfolderHelp")}</p>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="conversion-conflict" aria-describedby="conversion-conflict-scope">
        <legend>{t("m74CnvConflict")}</legend>
        <div className="conversion-options">
          {CONFLICT_POLICIES.map((policy) => (
            <label className="conversion-option" key={policy}>
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
        </div>
        <p className="visually-hidden" id="conversion-conflict-scope">{t("m74CnvConflictScope")}</p>
      </fieldset>
    </>
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
 *
 * **In the order a reader decides it** (PM9.4 R5): the settings in the form
 * beside this, then which rows and in which order, then what that conversion
 * would do, and directly under it the control that starts it. The summary is
 * the answer to the inputs before it, so nothing it depends on sits between it
 * and the action.
 */
function PlanSummary({
  conversion,
  configuration,
  plan,
  resolvedScope,
  onScopeChange,
  onSortChange,
  startAvailability,
  convertButton,
  onCustomStart,
  repeating,
}: {
  readonly conversion: ConversionOperation;
  readonly configuration: ConversionConfigurationView;
  readonly plan: ConversionPlanView;
  readonly convertButton: RefObject<HTMLButtonElement | null>;
  readonly onCustomStart: () => void;
  /** The rows this panel would queue, for the control that names them. */
  readonly resolvedScope: ResolvedConversionScope;
  readonly onScopeChange: (scope: ConversionScope) => void;
  readonly onSortChange: (sort: SortMode) => void;
  /** Whether a conversion of these rows may start, and what to say when not. */
  readonly startAvailability: ConversionAvailability;
  /** Whether a previous result is on screen above this plan. */
  readonly repeating: boolean;
}): ReactElement {
  const t = useUiMessages();
  const current = plan.current;
  const summary = current?.plan ?? null;
  const rounding = summary === null ? null : precisionNote(summary.intent.precision, t);
  // The rows the control names, which is what the reader selected rather than
  // what MSCanvas has finished describing. The plan is rendered in every state
  // now, so reading this off the summary made the label say "Convert 0
  // selected…" for the whole of the window a plan is being worked out -- a
  // count that was never true of anything.
  const count = resolvedScope.handles.length;
  // Nothing to describe because there is nothing to describe *with*: no
  // installation is bound, or the backend itself refuses. "Not yet known" would
  // tell the reader to wait for an answer that is not coming (PM9.4 R3).
  const noBackend =
    configuration.configuration?.configuration === "unavailableForBinding" ||
    (startAvailability.status === "unavailable" &&
      (startAvailability.reason === "backend-unavailable" || startAvailability.reason === "backend-quarantined"));
  const refused = startAvailability.status !== "available";
  // The pending sentence only where it says something the notices do not
  // (PM9.4 O3). With no rows to convert the notice says why and what to do,
  // and over capacity the counts above say why; repeating either here put one
  // fact into Convert's description twice. A lane refusal that outranks the
  // empty scope leaves this sentence as the only place it is said. The same
  // holds for a plan reason the notice already states; a failed plan keeps its
  // specific error here, beside Describe again.
  const pendingSaid = summary === null && plan.capacityRefusal === null &&
    !(plan.startPlan === "absent" && startAvailability.status === "unavailable" &&
      startAvailability.reason === "no-convertible-target") &&
    !(startAvailability.status === "unavailable" &&
      (startAvailability.reason === "plan-reading" ||
        startAvailability.reason === "plan-selection-unavailable" ||
        startAvailability.reason === "plan-selection-not-evidenced" ||
        (startAvailability.reason === "plan-settings-unknown" && !noBackend)));
  // The ellipsis promises a further step before anything starts, and only the
  // custom folder has one: its picker (PM9.4 O5).
  const picks = conversion.destinationPolicy.kind === "customFolder";
  return (
    <div className="conversion-plan-summary">
      {/* Native radios drawn as a segmented pair, so the group keeps the
          platform's own arrow-key behaviour and form semantics. */}
      <fieldset className="conversion-scope conversion-segments">
        <legend>{t("m74CnvScope")}</legend>
        <div className="conversion-segments-track">
          {SCOPES.map((scope) => (
            <label className="conversion-segment" key={scope}>
              <input className="visually-hidden" type="radio" name="conversion-scope" value={scope}
                checked={resolvedScope.scope === scope} onChange={() => onScopeChange(scope)} />
              {t(scope === "selected" ? "m74CnvSelected" : "m74CnvAll")}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="conversion-scope-counts" id="conversion-scope-summary" aria-live="polite">
        {/* The excluded note joins the counts rather than travelling as a
            parameter of its own: a resource parameter may not be empty, and it
            is empty whenever nothing is excluded. */}
        {t("m74CnvScopeCounts", { requested: String(resolvedScope.requestedCount), eligible: String(count), excluded: String(resolvedScope.excludedCount) }) +
          (resolvedScope.excludedCount > 0 ? t("m74CnvNotConvertible") : "")}
      </p>
      {/* Which rows the count excludes, outside the live summary so a scope
          change does not read them all out (PM9.4 O2). Read only: membership,
          eligibility and order are the roster's and the plan's. */}
      {resolvedScope.excluded.length === 0 ? null : (
        <div className="conversion-excluded-group">
          <Disclosure label={t("m74CnvExcludedNames", { count: resolvedScope.excludedCount })}
            regionProps={{ className: "conversion-excluded" }}>
            <ul>
              {resolvedScope.excluded.slice(0, EXCLUDED_LISTED).map((row) => (
                <li key={row.handle}>{row.fileName}</li>
              ))}
            </ul>
            {resolvedScope.excluded.length > EXCLUDED_LISTED ? (
              <p className="quiet-text">{t("moreNotListed", { count: resolvedScope.excluded.length - EXCLUDED_LISTED })}</p>
            ) : null}
          </Disclosure>
        </div>
      )}
      {/* The order the queue runs in. The roster's arrangement and groups do
          not change it; this does. */}
      <div className="conversion-order">
        <label htmlFor="conversion-order">{t("executionSort")}</label>
        <select id="conversion-order" aria-describedby="conversion-order-help" value={resolvedScope.sort}
          onChange={(event) => {
            const chosen = event.currentTarget.value;
            if (isSortMode(chosen)) onSortChange(chosen);
          }}>
          {SORT_MODES.map((mode) => <option key={mode} value={mode}>{t(SORT_MESSAGE[mode])}</option>)}
        </select>
        <p className="visually-hidden" id="conversion-order-help">{t("executionOrderHelp")}</p>
      </div>
      {plan.capacityRefusal === null ? null : <p className="notice notice-warning" data-testid="conversion-capacity" id={CAPACITY_REFUSAL_ID}>
        {t("m74CnvCapacityExceeded", { count: plan.capacityRefusal.requestedCount, capacity: plan.capacityRefusal.capacity })}
      </p>}

      {summary === null ? (
        <>
          {pendingSaid ? <PlanPending plan={plan} noBackend={noBackend} /> : null}
          {count === 0 ? null : <ol aria-label={t("m74CnvRequestedOrder")} className="conversion-requested-list">
            {resolvedScope.members.map((row, index) => <li key={row.handle}>
              <span className="conversion-queue-order">{index + 1}</span>
              <span className="conversion-queue-name" title={row.fileName}>{row.fileName}</span>
            </li>)}
          </ol>}
        </>
      ) : (
        <>
          <p className="conversion-plan-sentence" id="conversion-plan-summary">
            {describeQueueFamilies(summary.items, t)}
          </p>

          <ol aria-label={t("m74CnvReviewedOrder")} className="conversion-queue-list conversion-plan-list">
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
          <dl className="metadata-list conversion-summary-dl">
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
              {/* In words, from the plan's own combination, like the axes
                  beside it; the backend's token is not the reader's (R4). */}
              <dd>{t(CONVERSION_VALUE_LABEL.compression[summary.intent.compression])}</dd>
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

          {/* Said only when the mode Rust projects for this plan is output-only
              (PM9.4 O7). The judgement resources for other modes report a
              finished check, which a plan has not run. Stop and Skip are
              explained where they are offered, while the queue runs (O6). */}
          {summary.validationMode === "output_only" ? (
            <p className="conversion-side-note" id={VALIDATION_DISCLOSURE_ID} role="note">
              {t("m74CnvOutputOnly")}
            </p>
          ) : null}
          {/* Rounding is said again here because the precision setting is in
              the other column. The other losses are said once, beside their
              selected setting: a summary is only on screen for the current
              selection. */}
          {rounding === null ? null : (
            <p className="conversion-side-note" role="note" data-plan-precision-note="">
              {rounding}
            </p>
          )}
        </>
      )}

      <div className="conversion-actions conversion-start-actions">
        <Button
          ref={convertButton}
          aria-describedby={describedBy(
            summary !== null
              ? summary.validationMode === "output_only" ? `conversion-plan-summary ${VALIDATION_DISCLOSURE_ID}` : "conversion-plan-summary"
              : pendingSaid ? PLAN_PENDING_ID
              : plan.capacityRefusal !== null ? CAPACITY_REFUSAL_ID : "",
            startAvailability,
          )}
          // One filled primary per state (R7): under a finished queue whose
          // outputs are on offer, adding them is the primary and starting the
          // next conversion is not.
          variant={repeating && conversion.eligibleOutputCount > 0 && conversion.canAdopt ? "secondary" : "primary"}
          className="conversion-start conversion-wide-action"
          // The one rule, and the whole of it. The empty-row case and the plan
          // are inside it rather than beside it: a second clause here is
          // exactly how this control came to answer a different question from
          // the operation it starts. Refused rather than disabled so the
          // control stays a Tab stop whose reason can be reached (PM9 UI-24,
          // PM9.4 R6); a refused press does nothing.
          refused={refused}
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
        >
          {resolvedScope.scope === "selected"
            ? t(picks ? "m74CnvConvertSelected" : "m74CnvConvertSelectedDirect", { count })
            : t(picks ? "m74CnvConvertAll" : "m74CnvConvertAllDirect", { count })}
        </Button>
        {/* An explicit re-ask of the same question, and nothing automatic. A
            plan can fail for a reason the reader cannot act on, and a machine
            whose only exit were a new question would pin `Convert` as refused
            for the session over one lost reply. */}
        {plan.retryOffered ? (
          <Button variant="secondary" size="sm" icon={<Icon name="refresh" />} onClick={plan.retry}>{t("m74CnvDescribeAgain")}</Button>
        ) : null}
      </div>
    </div>
  );
}

/** Where the sentence a pending plan puts in place of a summary is named. */
const PLAN_PENDING_ID = "conversion-plan-pending";

/** Where an over-capacity scope's counts are named, for Convert to point at. */
const CAPACITY_REFUSAL_ID = "conversion-capacity-refusal";

/** Where an output-only plan says what its validation does not compare. */
const VALIDATION_DISCLOSURE_ID = "conversion-validation-disclosure";

/**
 * How many excluded rows are named before the rest are only counted. The
 * count beside them stays exact; the roster names every row.
 */
const EXCLUDED_LISTED = 20;

/** The queue's status line, where the keyboard goes when its control leaves (R11). */
const QUEUE_STATUS_ID = "conversion-queue-status";

/**
 * What is on screen where a plan summary is not.
 *
 * One element, three sentences, and the difference between them is what the
 * reader can do: wait, press something, or change a setting above. Collapsing
 * them into "no plan" is the shape ADR 0044 records as a refused plan being
 * explained to a reader as one being reread.
 */
function PlanPending({ plan, noBackend }: { readonly plan: ConversionPlanView; readonly noBackend: boolean }): ReactElement {
  const t = useUiMessages();
  return (
    <div className="conversion-plan-pending" id={PLAN_PENDING_ID}>
      {plan.startPlan === "absent" ? <span>{t("m74CnvNoEligible")}</span>
      : plan.startPlan === "failed" && plan.error !== null ? (
        <span>{conversionErrorMessage(plan.error, t)}</span>
      ) : plan.startPlan === "selectionUnavailable" ? (
        <span>{t("m74CnvNoticePlanSelectionUnavailable")}</span>
      ) : plan.startPlan === "selectionNotEvidenced" ? (
        <span>{t("m74CnvNoticePlanSelectionNotEvidenced")}</span>
      ) : plan.startPlan === "settingsUnknown" ? (
        <span>{noBackend ? t("m74CnvPlanNoBackend") : t("m74CnvNoticePlanSettingsUnknown")}</span>
      ) : (
        <span>{t("m74CnvNoticePlanReading")}</span>
      )}
    </div>
  );
}

/**
 * A queue under way, or the one that just finished, in two parts.
 *
 * `rows` is the list: one row per acquisition, with its state, what it
 * produced and the actions that are about that row alone (Skip, Open, the
 * staging cleanup, its Details). `summary` is what the rows add up to: the
 * status sentence, the queue-level actions (Stop, Add, Diagnostics, Retry) and
 * the facts the queue was bound to. Both read the same state here, so the two
 * columns cannot describe different queues.
 *
 * Item-count progress and nothing else: nothing measures a fraction of a
 * `msconvert` run, so a percentage here would be invented.
 *
 * A running queue can be stopped, and the control that does it is a queue-level
 * one. It really stops the work rather than stopping the watching, which is why
 * the copy beside it says what survives the stop before it is pressed.
 */
function QueueState({
  part,
  onReviewNewPlan,
  conversion,
  retryAvailability,
  retryOffered,
  refusedBy,
}: {
  readonly part: "rows" | "summary";
  readonly onReviewNewPlan?: () => void;
  readonly conversion: ConversionOperation;
  /** Whether this queue's failures may be rerun, and what to say when not. */
  readonly retryAvailability: ConversionAvailability;
  /** Whether the rerun control is on screen at all, decided by the panel. */
  readonly retryOffered: boolean;
  /** What the finished queue's own actions point at while they are refused. */
  readonly refusedBy: QueueRefusals;
}): ReactElement | null {
  const t = useUiMessages();
  const state = conversion.state;
  // A conversion this document dispatched, for a slot that has not been seen to
  // move yet. Rust has no queue to report until it has reserved one, so without
  // this the press goes unacknowledged for a round trip -- and from a finished
  // queue the panel would answer it with the *previous* run's items.
  //
  // It replaces the block rather than sitting beside it, which is exactly what
  // a dispatched retry already does: an ordered list of what just happened,
  // read under a sentence saying something is starting, is the panel
  // describing two queues in one shape.
  if (conversion.converting) {
    return part === "rows" ? null : (
      <div className="conversion-running conversion-run-summary">
        <p className="conversion-run-status" id={QUEUE_STATUS_ID} tabIndex={-1}>{t("m74CnvStarting")}</p>
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
  // Whether each failure says if Retry reruns it (PM9.4 R8): a queue that ran
  // to its own end, in a session that still starts backend work. A stopped
  // queue is not rerun, and a quarantined session reruns nothing; each has
  // its own sentence instead.
  const retryJudged =
    state.status === "terminal" && state.reason === "completed" && !conversion.backendQuarantined &&
    queue.failedCount > 0 && !conversion.busy;
  // Rows a stop or the reader left unconverted: converting them again is a new
  // queue from the checked rows, and the reader is told so (R9).
  // Not while an adoption or an export holds the panel: the next conversion
  // it points to is not on screen then.
  const leftUnconverted =
    state.status === "terminal" &&
    !conversion.backendQuarantined &&
    !conversion.busy &&
    queue.cancelledCount + queue.notRunCount + queue.skippedByRequestCount > 0;
  const stopping = state.status === "stopping" || (state.status === "running" && conversion.stopping);

  if (part === "rows") {
    return (
      <div className="conversion-running conversion-run-rows">
        <h3>{t(state.status === "terminal" ? "m74CnvResultsTitle" : "m74CnvQueueTitle")}</h3>
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

        <ol className="conversion-queue-list conversion-run-list">
          {queue.items.map((item, index) => {
            // Read once per item. Which of the two an item has is the whole of
            // what tells these branches apart, and asking the same question at
            // every use would invite one of them to be answered differently.
            const single = singleReportOf(item);
            const set = setReportOf(item);
            const skipping = conversion.skippingItem(index);
            return (
              <li key={item.datasetHandle} data-item-state={item.state}>
                {/* The state as a glyph as well as a word: the word beside it
                    is what carries it, so colour is never the only channel. */}
                <span className="conversion-run-symbol" aria-hidden="true">{ITEM_STATE_SYMBOL[item.state]}</span>
                <span className="conversion-run-title">
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
                </span>
                <span className="conversion-run-aside">
                  <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
                  <span className="conversion-queue-status">{itemStateLabel(item, t)}</span>
                  {/* Only on a row that is actually waiting. Skipping is about
                      an item that has not started; the file being converted
                      now is ended by Stop this file, which says so. The same
                      authoritative state decides this and the dispatch, so the
                      interface never offers what Rust would refuse.

                      Left mounted and refused while the skip is unanswered, for
                      the reason the queue stop and the adoption are: removing
                      the control a keyboard user just activated drops focus to
                      the document and announces nothing. Its own visible text
                      says why it is refused. */}
                  {conversion.canSkipItem(index) || skipping ? (
                    <Button
                      variant="quiet"
                      size="sm"
                      className="conversion-queue-skip"
                      aria-label={skipping
                        ? t("m74CnvSkipping", { name: item.fileName })
                        : t("m74CnvSkip", { name: item.fileName })}
                      refused={skipping}
                      onClick={() => conversion.skipItem(index)}
                    >
                      {skipping ? t("m74CnvSkippingShort") : t("m74CnvSkipShort")}
                    </Button>
                  ) : null}
                </span>
                <div className="conversion-run-detail">
                  {/* Why there is no Skip here, at the row that does not have
                      one. Two rows both read "Waiting" during a rerun and only
                      one is skippable: the other failed in the earlier pass and
                      keeps that failure, which is a decision a reader cannot
                      make sense of from an absent control. The per-item stop
                      states its own unavailability for the same reason. */}
                  {item.state === "pending" &&
                  item.attempts > 0 &&
                  state.status === "running" &&
                  !conversion.canSkipItem(index) ? (
                    <>
                      <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
                      <span className="conversion-queue-reason">{t("m74CnvRetryKeepsFailure")}</span>
                    </>
                  ) : null}
                  {item.attempts > 1 ? (
                    <>
                      <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
                      <span className="conversion-queue-attempts">
                        {t("m74CnvAttempt", { count: item.attempts })}
                      </span>
                    </>
                  ) : null}
                  {item.state === "failed" ? (
                    <>
                      <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
                      <span className="conversion-queue-reason">{itemFailureSentence(item, t)}</span>
                    </>
                  ) : null}
                  {/* Which failures Retry reruns, said on each one (R8). Rust
                      marks every failure retryable or not, and "Retry 1
                      failed" beside "2 failed" left the reader to guess which. */}
                  {item.state === "failed" && retryJudged ? (
                    <>
                      <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
                      <span className="conversion-queue-retry">
                        {item.retryable ? t("m74CnvWillRetry") : t("m74CnvWillNotRetry")}
                      </span>
                    </>
                  ) : null}
                  {/* What was actually produced, per item. A queue that said
                      only `Converted` would have taken away the one thing that
                      lets a user tell a real conversion from an empty one. */}
                  {single?.output == null ? null : (
                    <>
                      <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
                      <span className="conversion-queue-facts">
                        {t("m74CnvOutputMetrics", { bytes: formatByteLength(single.output.byteLength, t), spectra: formatCount(single.output.spectrumCount), chromatograms: formatCount(single.output.chromatogramCount) })}
                        {single.backend === null
                          ? ""
                          : `, ${formatDuration(single.backend.elapsedMilliseconds)}`}
                      </span>
                    </>
                  )}
                  {/* What a set actually produced, and the exact limits of the
                      claim. Three separate sentences on purpose: the count is a
                      fact, the completeness is narrower than it sounds, and the
                      validation is narrower again. Collapsing them would read
                      as one broad guarantee that none of them makes. */}
                  {set === null ? null : (
                    <>
                      <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
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
                      {/* Which files, not only how many, bounded at twenty-four
                          by the lifecycle that produced them. Named once:
                          beside its own Open actions where Rust paired the
                          members with what they can open, and here only where
                          it could not (PM9.4 O1). The pairing is all or
                          nothing. */}
                      {finalizedMemberNames(set).length === 0 || item.finalizedOutputs.length > 0 ? null : (
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
                  {/* Cleanup failing is the user's problem, not only MSCanvas',
                      because what is left behind is in the folder they chose.
                      Read from both places it can be recorded: a cancelled item
                      has no report by construction, so a residue it left would
                      otherwise be knowable to MSCanvas and invisible to the
                      person whose folder it is in. */}
                  {(single?.stagingResidue ??
                    set?.stagingResidue ??
                    item.cancellation?.stagingResidue) == null ? null : (
                    <>
                      <span className="visually-hidden">{t("m74CnvListSeparator")}</span>
                      <span className="conversion-queue-residue">{t("m74CnvResidue")}</span>
                    </>
                  )}
                  {item.stagingRecovery !== null && (item.stagingRecovery.status !== "cleaned" || (single?.stagingResidue ?? set?.stagingResidue ?? item.cancellation?.stagingResidue) != null) ? (
                    <StagingRecoveryActions key={item.stagingRecovery.recoveryId} recovery={item.stagingRecovery} enabled={state.status === "terminal" && !conversion.busy && !conversion.backendQuarantined} refusedBy={refusedBy.cleanup} reclaim={conversion.reclaimStaging} onReview={onReviewNewPlan ?? (() => {})} />
                  ) : null}
                  {item.finalizedOutputs.map(output => <OutputOpenActions key={output.outputId} output={output} />)}
                  {/* Where the row's one word stops being the whole answer. The
                      label is a projection and is lossy on purpose; the five
                      judgements it projects from stay inspectable here rather
                      than being spelled out five times per row on screen.

                      Not offered for a row that has not been attempted: a
                      waiting item has one honest answer to every one of the
                      five, and a disclosure that only ever says "nothing yet"
                      teaches its own uselessness.

                      Attempts, not state. A retry returns every retryable
                      failure to `pending` and *keeps* its report and its
                      attempt facts until that item is actually rerun, so hiding
                      on the state alone took the retained judgements away from
                      every later item while an earlier one was still running. */}
                  {(item.state === "pending" && item.attempts === 0) ||
                  item.state === "running" ? null : (
                    <ConversionItemJudgements index={index} item={item} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {/* What to do about the rows that did not convert, directly above the
            next conversion it points to. Not a rerun: a stop or a skip was the
            reader's decision, and converting those rows again is a new queue
            from the checked rows (R9). */}
        {leftUnconverted ? (
          <p className="conversion-side-note conversion-convert-again">{t("m74CnvConvertAgain")}</p>
        ) : null}
      </div>
    );
  }

  // Whether Stop this file has a file to describe: one it would end, or one it
  // is ending. Between items there is nothing to say.
  const cancelItemDescribed = conversion.cancellingItem || conversion.cancellableItem !== null;
  const runningItem = queue.items.some((item) => item.state === "running");
  // The queue's one status sentence. Always the block's first element, in
  // every state and in the starting window above, so it is one DOM node from
  // the press that starts a queue to the result: the focus R11 puts on it, and
  // a screen reader's place, survive every transition rather than landing on a
  // node React reuses for something else.
  const status = retrying
    ? t("m74CnvRetrying")
    : state.status === "awaitingDestination"
      ? queue.destinationPolicy.kind === "customFolder"
        ? t("m74CnvChooseDestination")
        : t("m74CnvResolvingDestinations")
      : stopping
        ? t("m74CnvStopping")
        : state.status === "running"
          ? // `finalizedCount`, not `currentIndex`. The second is how many items
            // are no longer pending, which between two items counts every
            // failure, conflict skip, user skip and cancellation as well -- so a
            // queue whose first file failed announced "Converted 1 of 2" while
            // nothing had been converted at all. Directory re-admission widens
            // the window this is read in.
            //
            // A rerun says it is one (R10): the same queue, run again over its
            // earlier failures, is not a first run.
            runningItem
            ? t(queue.retryRound > 0 ? "m74CnvRerunningItem" : "m74CnvRunningItem", { position: runningPosition(queue), total: queue.itemCount })
            : t(queue.retryRound > 0 ? "m74CnvRerunBetweenItems" : "m74CnvBetweenItems", { count: queue.finalizedCount, total: queue.itemCount })
          : state.reason === "stopFailed"
            ? // Deliberately not "Queue stopped". That state means a converter
              // may still be running, and a heading someone skims is exactly
              // where the claim must not be made and then walked back by the
              // warning below it.
              t("m74CnvStateUnconfirmed")
            : state.reason === "stopped"
              ? t("m74CnvStopped")
              : completedSummary(queue, t);
  return (
    <div className="conversion-running conversion-run-summary">
      <p className="conversion-run-status" id={QUEUE_STATUS_ID} tabIndex={-1}>{status}</p>
      {/* The same numbers the sentence above says, large, for a glance. Hidden
          from assistive technology because the sentence already says them. */}
      {state.status === "running" && !stopping ? (
        <p className="conversion-progress-num" aria-hidden="true">
          {`${String(runningItem ? runningPosition(queue) : queue.finalizedCount)} / ${String(queue.itemCount)}`}
        </p>
      ) : null}
      {/* No stop controls until the state read dispatched beside a retry
          reports the rerun running. */}
      {retrying ? null : stopping ? (
        // Deliberately says nothing about how the current item will end.
        // Whether it is cancelled or finishes on its own is decided by which
        // the process boundary observes first, and predicting it here would
        // put a claim on screen that the next read could contradict.
        <p className="conversion-side-note" role="note">
          {t("m74CnvStopInFlight")}
        </p>
      ) : state.status === "running" ? (
        <>
          <div className="conversion-actions">
            {/* Refused and guarded, not `disabled`: a control that becomes
                natively disabled under the keyboard loses its focus in
                Chromium, and these are pressed while work is in flight (R11).
                Side by side because they are the same kind of decision at two
                scales, about the run rather than about one row. */}
            <Button
              variant="secondary"
              size="sm"
              aria-describedby="conversion-stop-scope"
              refused={!conversion.canStop}
              reasonId={QUEUE_STATUS_ID}
              onClick={() => conversion.stop()}
            >{t("m74CnvStopQueue")}</Button>
            <Button
              variant="secondary"
              size="sm"
              aria-describedby={cancelItemDescribed ? "conversion-cancel-item-scope" : undefined}
              refused={conversion.cancellableItem === null}
              // Between items the status sentence ("…starting the next") is
              // why there is no file to stop.
              reasonId={QUEUE_STATUS_ID}
              onClick={() => conversion.cancelCurrentItem()}
            >
              {conversion.cancellingItem ? t("m74CnvStoppingFile") : t("m74CnvStopFile")}
            </Button>
          </div>
          <p className="conversion-side-note" id="conversion-stop-scope" role="note">
            {t("m74CnvStopExplanation")}
          </p>
          {/* Only while there is a file this control would end, or one it is
              ending: the quarantine branch is the part a reader cannot undo. */}
          {cancelItemDescribed ? (
            <p className="conversion-side-note" id="conversion-cancel-item-scope" role="note">
              {conversion.cancellingItem || conversion.cancellableItem === null
                ? t("m74CnvCancelItemExplanation")
                : t("m74CnvCancelNamed", { name: conversion.cancellableItem.fileName })}
            </p>
          ) : null}
        </>
      ) : null}

      {state.status === "terminal" && !retrying ? (
        <>
          {/* The counts a stopped queue is judged by, said in full and kept
              apart. A cancelled item is not a failure and a not-run item is
              not an attempt, so folding either into `failed` would report work
              the user stopped as work that broke. */}
          {state.reason === "completed" ? null : (
            <>
              <p className="conversion-stopped-summary">{stoppedSummary(queue, t)}</p>
              <p className="conversion-side-note">{t("m74CnvStoppedFilesRemain")}</p>
            </>
          )}
          <AdoptOutputs conversion={conversion} refusedBy={refusedBy.adopt} />
          <ExportDiagnostics conversion={conversion} refusedBy={refusedBy.diagnostics} />
          {/* A stopped queue is terminal and is not rerun in place. Converting
              those rows again is a new queue, made from the roster, which is
              the ordinary path the selection workflow already offers.

              Not while an adoption is under way. A retry replaces the very
              results the adoption is reading, so the two are never both live.
              Removed rather than refused: an action that is coming back is a
              different thing from one that is refused. */}
          {!retryOffered ? (
            state.reason === "completed" &&
            queue.retryableFailedCount === 0 &&
            queue.nonRetryableFailedCount !== 0 &&
            !conversion.adopting &&
            !conversion.exportingDiagnostics &&
            conversion.backendQuarantined ? (
              // Only for a quarantined session, where the rows' own retry
              // marks are withheld. Otherwise each failed row already says it
              // is not rerun.
              <p className="conversion-side-note" role="note">{t("m74CnvQuarantineRetry")}</p>
            ) : null
          ) : (
            <>
              <div className="conversion-actions">
                {/* Retry availability, and deliberately not the start
                    control's. A retry is a conversion, so an unavailable
                    ProteoWizard, a recheck in flight or a preview still holding
                    the lane refuse it for the same reasons -- but what it would
                    act on is this queue's failures rather than the roster's
                    selection. Refused rather than disabled, so its reason in
                    the availability notice can be reached. */}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="refresh" />}
                  aria-describedby={describedBy("conversion-retry-scope", retryAvailability)}
                  refused={retryAvailability.status !== "available"}
                  onClick={conversion.retry}
                >
                  {t("m74CnvRetry", { count: queue.retryableFailedCount })}
                </Button>
              </div>
              {/* What Retry reruns and keeps, said where it is pressed and to
                  every reader, as the stop and adoption controls say theirs
                  (R8). */}
              <p className="conversion-side-note" id="conversion-retry-scope" role="note">{t("m74CnvRetryScope")}</p>
            </>
          )}
          {/* Only where something was actually judged, and judged output-only
              by its own report's mode (PM9.4 O7). A queue whose items were all
              skipped or all failed validated nothing -- and a skipped item's
              existing file was explicitly not inspected, so claiming
              output-only validation over it would claim a check nobody ran. */}
          {queue.items.some(conversionJudgedOutputOnly) ? (
            <p className="conversion-side-note" role="note">
              {t("m74CnvOutputOnly")}
            </p>
          ) : null}
        </>
      ) : null}

      {/* What the queue was bound to when it started, always on screen: three
          facts, read off the queue rather than off the form for the next one. */}
      <dl className="metadata-list conversion-summary-dl conversion-bound-details" aria-label={t("m74CnvQueueDestination")}>
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
    </div>
  );
}

/** What each item state shows in its circle (rebuild spec 5.2). */
const ITEM_STATE_SYMBOL: Record<ConversionQueueItem["state"], string> = {
  finalized: "✓",
  running: "●",
  pending: "○",
  failed: "✕",
  cancellationFailed: "!",
  skipped: "–",
  skippedByRequest: "–",
  cancelled: "–",
  notRun: "–",
};

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
      return t("m74CnvSetUnevidenced");
    default:
      return t("m74CnvNoWrittenFile");
  }
}
