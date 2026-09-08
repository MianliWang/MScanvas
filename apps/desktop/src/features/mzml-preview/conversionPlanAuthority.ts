/**
 * Which conversion plan this document is asking about, and what it has been
 * told.
 *
 * **The plan answer is Rust's; the outstanding request is this side's.** That
 * split is [ADR 0044] Decision 9's, and it is the one place React legitimately
 * tracks work in flight. What this module must never do is let the *state* of
 * that tracking stand in for currency: whether the answer on screen still
 * describes the question being asked is settled by comparing identities, never
 * by which state the machine happens to be in.
 *
 * Three rules carry the whole design.
 *
 * **A question is every fact that changes what the future queue means.** The
 * ordered rows, the admitted combination, the conflict policy, and the
 * installation the reader is looking at. Change any of them and the answer on
 * screen describes a conversion nobody asked for.
 *
 * **The binding is in the question and the revision is not.** A receipt answers
 * *which installation is this about*; a revision answers *which of two answers
 * is newer*. The same receipt legitimately arrives under a later revision — a
 * preview verdict can move on a build that has not changed — so a question
 * carrying the revision would call its own answer stale for a fact about
 * msaccess's grammar, and re-ask a question whose answer was perfectly good.
 *
 * **An ordinal decides which reply, and only that.** A retry asks the *same*
 * question by design, so identity alone cannot tell a superseded request's late
 * reply from the retry's own. The ordinal rises on every request this panel
 * issues, whatever its identity, and is never reset — counting per question
 * would reintroduce the defect one identity away, because leaving a question
 * and coming back would start its count again at a value a reply already in
 * flight carries.
 *
 * [ADR 0044]: ../../../../../docs/architecture/adr/0044-conversion-configuration-authority.md
 */

import { receiptOf, type RenderedAuthority } from "./backendAuthority";
import type {
  BackendBindingReceipt,
  ConversionConfiguration,
  ConversionConflictPolicy,
  ConversionQueuePlan,
  DestinationPolicy,
  PreviewError,
} from "./contracts";
import { catalogRow } from "./conversionIntentSelection";
import type { ConversionScope } from "./conversionScope";

/**
 * The exact question one plan answers.
 *
 * Held whole, for the life of the plan, because every state below is *about* a
 * question and an answer that could not say which one would be uncheckable.
 */
export interface ConversionPlanIdentity {
  readonly scope: ConversionScope;
  /** In the order they would run, which is the order on screen. */
  readonly handles: readonly string[];
  readonly intentId: string;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly destinationPolicy: DestinationPolicy;
  readonly receipt: BackendBindingReceipt;
}

/**
 * Whether two questions are the same question.
 *
 * Ordered, because a queue's order is what the user is looking at and a
 * re-sorted selection is a different conversion. Total over the identity's
 * members: a comparison that skipped one would let that member change without
 * anything noticing.
 */
export function sameQuestion(
  left: ConversionPlanIdentity,
  right: ConversionPlanIdentity,
): boolean {
  return (
    left.scope === right.scope &&
    left.intentId === right.intentId &&
    left.conflictPolicy === right.conflictPolicy &&
    sameDestination(left.destinationPolicy, right.destinationPolicy) &&
    left.receipt === right.receipt &&
    left.handles.length === right.handles.length &&
    left.handles.every((handle, index) => handle === right.handles[index])
  );
}

export function sameDestination(left: DestinationPolicy, right: DestinationPolicy): boolean {
  return left.kind === right.kind &&
    (left.kind !== "namedSubfolder" ||
      (right.kind === "namedSubfolder" && left.name === right.name));
}

/**
 * Why no plan question can be posed for rows that were asked about.
 *
 * Two, and they are different sentences with different owners. The settings
 * panel above already says which configuration state the session is in and
 * which combination is unrunnable here; what the plan adds is only that it
 * therefore has nothing to describe.
 */
export type ConversionPlanBlock =
  /** No binding, or a binding whose conversion settings are not known. */
  | "settingsUnknown"
  /** The settings are known, and the chosen combination cannot run on them. */
  | "selectionUnavailable";

/**
 * What this document is asking about right now.
 *
 * Derived on every render from facts it does not own, so it is never stale: the
 * question is a projection, and only the *answer* is state.
 */
export type ConversionPlanQuestion =
  /** Nothing is selected to convert. Says nothing about the build. */
  | { readonly kind: "none" }
  | { readonly kind: "blocked"; readonly reason: ConversionPlanBlock }
  | { readonly kind: "ask"; readonly identity: ConversionPlanIdentity };

/**
 * The plan machine's five states.
 *
 * **Only `loading` carries an ordinal**, because matching a reply is the only
 * thing an ordinal is for and an answer has no outstanding request to
 * disambiguate. A field nothing reads is a hazard that then needs a prose rule
 * to defend it.
 *
 * **`ready` and `failed` keep the identity.** The identity is what the answer
 * is *about*, and an answer that cannot be compared with the current question
 * cannot be checked for currency at all — nor re-asked, which is what a retry
 * does.
 *
 * **`none` and `blocked` are kept apart**, because they say different things to
 * a reader: nothing has been selected to convert, against rows are selected and
 * something else is missing. Collapsing them is how a panel comes to explain an
 * empty selection with a sentence about the backend.
 */
export type ConversionPlanState =
  | { readonly status: "none" }
  | { readonly status: "blocked"; readonly reason: ConversionPlanBlock }
  | {
      readonly status: "loading";
      readonly identity: ConversionPlanIdentity;
      readonly ordinal: number;
    }
  | {
      readonly status: "ready";
      readonly identity: ConversionPlanIdentity;
      readonly plan: ConversionQueuePlan;
    }
  | {
      readonly status: "capacityExceeded";
      readonly identity: ConversionPlanIdentity;
      readonly capacity: number;
      readonly requestedCount: number;
    }
  | {
      readonly status: "failed";
      readonly identity: ConversionPlanIdentity;
      readonly error: PreviewError;
    };

/** The facts a plan question is posed from, none of which this module owns. */
export interface ConversionPlanInputs {
  readonly scope: ConversionScope;
  /** The rows a conversion would act on, in the order they would run. */
  readonly handles: readonly string[];
  /** The projection this document is rendering. */
  readonly authority: RenderedAuthority | null;
  /** The Rust-authored configuration for that binding, where one is held. */
  readonly configuration: ConversionConfiguration | null;
  /** The admitted combination the reader has chosen. */
  readonly selectedIntentId: string | null;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly destinationPolicy: DestinationPolicy;
}

/**
 * The question these facts pose, or why they pose none.
 *
 * The admission rule and the question are one function deliberately. A separate
 * predicate answering "may a plan be requested?" would be a second place for
 * the same decision, and the two would come to disagree exactly where it
 * matters — which is how a panel comes to request a plan it has already decided
 * it cannot ask for.
 *
 * Rust refuses all of this again and is the authority; what is here keeps the
 * interface from asking questions it knows the answer to.
 */
export function planQuestion(inputs: ConversionPlanInputs): ConversionPlanQuestion {
  if (inputs.handles.length === 0) {
    return { kind: "none" };
  }
  const receipt = inputs.authority === null ? null : receiptOf(inputs.authority);
  const configuration = inputs.configuration;
  if (
    receipt === null ||
    configuration === null ||
    configuration.configuration !== "ready" ||
    inputs.selectedIntentId === null
  ) {
    return { kind: "blocked", reason: "settingsUnknown" };
  }
  // Looked up in the catalog Rust sent, never decided here. A row this build
  // cannot run is a real row with a real answer, and it is a different sentence
  // from a combination the product never measured — which is why the lookup
  // answers with the row rather than with a boolean.
  const row = catalogRow(configuration.catalog, inputs.selectedIntentId);
  if (row === null || !row.available) {
    return { kind: "blocked", reason: "selectionUnavailable" };
  }
  return {
    kind: "ask",
    identity: {
      scope: inputs.scope,
      handles: inputs.handles,
      intentId: inputs.selectedIntentId,
      conflictPolicy: inputs.conflictPolicy,
      destinationPolicy: inputs.destinationPolicy,
      receipt,
    },
  };
}

/** What the machine should do about the question it is now being asked. */
export type ConversionPlanStep =
  /** Nothing to do: the state already answers, or is already asking, this. */
  | { readonly kind: "hold" }
  /** Move to this state and issue no request. */
  | { readonly kind: "settle"; readonly state: ConversionPlanState }
  /** Move to `loading` and issue a request for this identity at this ordinal. */
  | {
      readonly kind: "issue";
      readonly identity: ConversionPlanIdentity;
      readonly ordinal: number;
    };

/**
 * The transition table, whole.
 *
 * Total over the five states and the three questions, and it is the only thing
 * that decides what the machine does — so "no `loading` without a request
 * actually in flight" is a property of this function rather than a rule every
 * call site has to remember: the one step that produces `loading` is the one
 * step that says to issue.
 */
export function planStep(
  current: ConversionPlanState,
  question: ConversionPlanQuestion,
  nextOrdinal: number,
): ConversionPlanStep {
  if (question.kind === "none") {
    // The selection emptied. Stated separately from `blocked` because
    // `blocked` is a sentence about the backend, and a reader's own
    // deselection is not one.
    return current.status === "none"
      ? { kind: "hold" }
      : { kind: "settle", state: { status: "none" } };
  }
  if (question.kind === "blocked") {
    return current.status === "blocked" && current.reason === question.reason
      ? { kind: "hold" }
      : { kind: "settle", state: { status: "blocked", reason: question.reason } };
  }
  // An answer, or a request, that is already about exactly this question. A
  // `blocked` whose cause has stopped holding does not reach here as a hold:
  // it has no identity to match, so it falls through and a request is issued
  // the moment it becomes eligible.
  if (
    (current.status === "loading" ||
      current.status === "ready" ||
      current.status === "capacityExceeded" ||
      current.status === "failed") &&
    sameQuestion(current.identity, question.identity)
  ) {
    return { kind: "hold" };
  }
  return { kind: "issue", identity: question.identity, ordinal: nextOrdinal };
}

/**
 * Re-asking the same question, because a reader asked for it.
 *
 * A plan can fail for a reason the reader cannot act on — an IPC that did not
 * come back, a read that lost a race — and a machine whose only exit from
 * `failed` were a new question would pin `Convert` as refused for the session
 * over a transient error. An explicit request re-asks the same question at the
 * next ordinal; nothing automatic does, because an automatic retry keyed on the
 * failure would be this document reacting to its own bookkeeping for ever.
 */
export function retryStep(
  current: ConversionPlanState,
  nextOrdinal: number,
): ConversionPlanStep {
  return current.status === "failed"
    ? { kind: "issue", identity: current.identity, ordinal: nextOrdinal }
    : { kind: "hold" };
}

/** What a reply says, once the transport has been unwrapped. */
export type ConversionPlanReply =
  | { readonly kind: "plan"; readonly plan: ConversionQueuePlan }
  | { readonly kind: "capacityExceeded"; readonly capacity: number; readonly requestedCount: number }
  | { readonly kind: "failed"; readonly error: PreviewError };

/**
 * What a request refused for naming a binding Rust has left installs.
 *
 * `failed` rather than `blocked`, and the difference is a spin. The projection
 * that arrives with such a refusal is newer than what is rendered in every case
 * this can actually reach -- the receipt differs, so the publication that minted
 * it came after -- and accepting it changes the question, which is what makes
 * the next request the right one. A state that carried *no* identity would be
 * re-asked the moment that argument failed to hold, by a machine that would then
 * refuse it again, at IPC speed. `failed` carries the identity that was asked,
 * so a question that has not moved holds instead of asking again, and the reader
 * is left with a control that re-asks rather than with a loop.
 *
 * In the ordinary case nothing here is rendered: the accepted projection moves
 * the question, and an answer about a question nobody is asking does not stand
 * for one.
 */
export function bindingReplacedReply(): ConversionPlanReply {
  return {
    kind: "failed",
    error: {
      kind: "conversion_binding_replaced",
      summary:
        "The installed ProteoWizard changed while MSCanvas was working out what this " +
        "conversion would do.",
      detail: null,
      retryable: true,
    },
  };
}

/**
 * Whether this request is the one the machine is waiting on.
 *
 * **Only `loading` is awaiting an answer**, and `ready` and `failed` are named
 * in that rule rather than left to it: both still hold a matchable identity, so
 * a check written over identity alone would match into them. `blocked` has no
 * identity to fail to match, and a rule written only as "any other identity"
 * would leave a plan built under the previous binding installable.
 *
 * **Identity *and* ordinal.** A retry asks the same question by design, so
 * identity alone cannot tell its reply from a superseded request's.
 */
export function awaitsReply(
  current: ConversionPlanState,
  identity: ConversionPlanIdentity,
  ordinal: number,
): boolean {
  return (
    current.status === "loading" &&
    current.ordinal === ordinal &&
    sameQuestion(current.identity, identity)
  );
}

/** The state a reply installs, or `null` where it may not install at all. */
export function installReply(
  current: ConversionPlanState,
  identity: ConversionPlanIdentity,
  ordinal: number,
  reply: ConversionPlanReply,
): ConversionPlanState | null {
  if (!awaitsReply(current, identity, ordinal)) {
    return null;
  }
  if (reply.kind === "capacityExceeded") {
    return reply.requestedCount === identity.handles.length &&
      Number.isSafeInteger(reply.capacity) && reply.capacity > 0 &&
      reply.requestedCount > reply.capacity
      ? { status: "capacityExceeded", identity, capacity: reply.capacity, requestedCount: reply.requestedCount }
      : { status: "failed", identity, error: {
        kind: "conversion_plan_mismatch",
        summary: "The conversion description did not match this request. Describe it again.",
        detail: null, retryable: true,
      } };
  }
  if (reply.kind === "plan" && !sameQuestion(identity, {
    scope: identity.scope,
    handles: reply.plan.items.map((item) => item.datasetHandle),
    intentId: reply.plan.intent.id,
    conflictPolicy: reply.plan.conflictPolicy,
    destinationPolicy: reply.plan.destinationPolicy,
    receipt: reply.plan.receipt,
  })) {
    return {
      status: "failed",
      identity,
      error: {
        kind: "conversion_plan_mismatch",
        summary: "The conversion description did not match this request. Describe it again.",
        detail: null,
        retryable: true,
      },
    };
  }
  return reply.kind === "plan"
    ? { status: "ready", identity, plan: reply.plan }
    : { status: "failed", identity, error: reply.error };
}

/**
 * What the plan contributes to whether a conversion may start.
 *
 * Compared rather than read off the state, which is the whole point: the
 * machine moves in an effect and a render can see an answer whose question has
 * already changed. An answer that has stopped describing the current question
 * may not stand for it, so it reads as being read again — which is true, since
 * the replacement request is issued by the very commit this render produces.
 */
export type ConversionStartPlan =
  | "capacityExceeded"
  /** A plan for exactly the question being asked. */
  | "ready"
  /** A request is in flight, or one is about to replace an answer that is not
   * about this question. The reader can only wait. */
  | "reading"
  /** The request for this question failed. The reader can ask again. */
  | "failed"
  /**
   * No question can be posed, because this binding's settings are not known.
   * The reader waits, or reads them again from the settings above.
   */
  | "settingsUnknown"
  /**
   * No question can be posed, because the chosen combination is one this
   * installation cannot run. The reader changes a setting.
   */
  | "selectionUnavailable"
  /** No rows were asked about. */
  | "absent";

export function startPlan(
  state: ConversionPlanState,
  question: ConversionPlanQuestion,
): ConversionStartPlan {
  switch (question.kind) {
    case "none":
      return "absent";
    case "blocked":
      // The reason travels, because the two are different situations with
      // different things for a reader to do -- one is waiting for an answer
      // that is coming, the other is a setting to change. Collapsing them
      // would put the wrong sentence beside the control in one of the two,
      // which is the shape this whole machine exists to remove.
      return question.reason;
    case "ask":
      if (state.status === "capacityExceeded" && sameQuestion(state.identity, question.identity)) {
        return "capacityExceeded";
      }
      if (state.status === "ready" && sameQuestion(state.identity, question.identity)) {
        return "ready";
      }
      if (state.status === "failed" && sameQuestion(state.identity, question.identity)) {
        return "failed";
      }
      return "reading";
  }
}

/** A plan on screen, and the question a start would act on. */
export interface ConversionCurrentPlan {
  readonly identity: ConversionPlanIdentity;
  readonly plan: ConversionQueuePlan;
}

/**
 * The plan on screen, with its question, or `null` where nothing current is.
 *
 * **The two travel together because they must be one decision.** A surface that
 * rendered the summary from here and reached somewhere else for what to start
 * would be two answers to "which conversion is this", and the whole of this
 * slice is that they cannot be. Holding them in one value is what lets a control
 * start exactly what the summary above it describes without testing anything a
 * second time.
 *
 * The same comparison {@link startPlan} makes, so a control and the sentence
 * beneath it cannot disagree about whether there is one.
 */
export function currentPlan(
  state: ConversionPlanState,
  question: ConversionPlanQuestion,
): ConversionCurrentPlan | null {
  return state.status === "ready" &&
    question.kind === "ask" &&
    sameQuestion(state.identity, question.identity)
    ? { identity: question.identity, plan: state.plan }
    : null;
}
