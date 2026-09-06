import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PreviewApi } from "./api";
import type { RenderedAuthority } from "./backendAuthority";
import type {
  BackendAuthorityProjection,
  ConversionConflictPolicy,
  PreviewError,
} from "./contracts";
import { toPreviewError } from "./contracts";
import {
  currentPlan,
  planQuestion,
  planStep,
  retryStep,
  startPlan,
  type ConversionCurrentPlan,
  type ConversionPlanIdentity,
  type ConversionPlanQuestion,
  type ConversionPlanState,
  type ConversionStartPlan,
  bindingReplacedReply,
  installReply,
} from "./conversionPlanAuthority";
import type { ConversionConfigurationView } from "./useConversionConfiguration";

/** What the panel may render about the conversion it would start. */
export interface ConversionPlanView {
  /**
   * The rows a conversion would act on, as the surface that owns the selection
   * says they are.
   *
   * Imperative because the rows are the *screen's*, and the screen is where
   * search, sort and focus resolve them. Everything else about the question is
   * read from authorities this hook already holds.
   */
  readonly describe: (handles: readonly string[]) => void;
  /** The machine's state, for the tests and the sentences that need the arm. */
  readonly state: ConversionPlanState;
  /** The question these facts pose right now, derived and never stored. */
  readonly question: ConversionPlanQuestion;
  /**
   * The plan on screen and the question a start would act on, or `null` where
   * nothing current is.
   *
   * Compared rather than read off the state: an answer that has stopped
   * describing the current question may not stand for it, and a render can see
   * one before the effect that replaces it has run. The question travels with
   * it so a control starts exactly what the summary beside it describes.
   */
  readonly current: ConversionCurrentPlan | null;
  /** What the plan contributes to whether a conversion may start. */
  readonly startPlan: ConversionStartPlan;
  /** The error a failed plan is refused with, where the plan is the failure. */
  readonly error: PreviewError | null;
  /** Whether the reader is offered a control that asks the same question again. */
  readonly retryOffered: boolean;
  /** Asks the same question again, at the next ordinal. */
  readonly retry: () => void;
}

/**
 * Holds this document's one outstanding plan request, and Rust's answer to it.
 *
 * **It decides nothing about the plan.** Rust authors the answer; what is here
 * is the question -- derived on every render from authorities this hook does
 * not own -- and the bookkeeping that says which reply is the answer to it.
 *
 * The state machine is `conversionPlanAuthority.ts`, entire. What this adds is
 * the three things a machine cannot be: the ordinal that never resets, the
 * request in flight, and the delivery of an authority a refusal carried.
 */
export function useConversionPlan(
  api: PreviewApi,
  /** The projection this document is rendering. */
  authority: RenderedAuthority | null,
  configuration: ConversionConfigurationView,
  conflictPolicy: ConversionConflictPolicy,
  /** Where the projection a refused plan carried is delivered. */
  onAuthority: (authority: BackendAuthorityProjection) => void,
): ConversionPlanView {
  const [handles, setHandles] = useState<readonly string[]>([]);
  const [state, setState] = useState<ConversionPlanState>({ status: "none" });
  /**
   * The per-panel request ordinal, never reset.
   *
   * A retry asks the same question by design, so identity alone cannot tell a
   * superseded request's late reply from the retry's own. Counting per question
   * would reintroduce that defect one identity away: leave a question with a
   * request in flight, come back to it, and its count starts again at a value
   * that reply already carries.
   */
  const ordinal = useRef(0);
  /**
   * The state, as it stands now.
   *
   * The transition below runs after a commit and the reply handlers run later
   * still, so both need the state as it is rather than as the closure that
   * created them saw it.
   */
  const stateRef = useRef(state);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commit = useCallback((next: ConversionPlanState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const question = useMemo(
    () =>
      planQuestion({
        handles,
        authority,
        configuration: configuration.configuration,
        selectedIntentId: configuration.selectedIntentId,
        conflictPolicy,
      }),
    [authority, configuration.configuration, configuration.selectedIntentId, conflictPolicy, handles],
  );

  const issue = useCallback(
    (identity: ConversionPlanIdentity, issued: number) => {
      commit({ status: "loading", identity, ordinal: issued });
      void api
        .describeConversion({
          handles: identity.handles,
          intentId: identity.intentId,
          conflictPolicy: identity.conflictPolicy,
          expectedReceipt: identity.receipt,
        })
        .then((outcome) => {
          if (!mounted.current) {
            return;
          }
          if (outcome.outcome === "planned") {
            const installed = installReply(stateRef.current, identity, issued, {
              kind: "plan",
              plan: outcome.plan,
            });
            if (installed !== null) {
              commit(installed);
            }
            return;
          }
          // News about the installation rather than a fact about the rows, and
          // the only reason this request could not be answered. The projection
          // goes first because it *is* the news -- accepting it replaces the
          // rendered binding, which changes the question, which is what makes
          // the next request the right one to make.
          onAuthority(outcome.authority);
          const refused = installReply(
            stateRef.current,
            identity,
            issued,
            bindingReplacedReply(),
          );
          if (refused !== null) {
            commit(refused);
          }
        })
        .catch((cause: unknown) => {
          if (!mounted.current) {
            return;
          }
          const installed = installReply(stateRef.current, identity, issued, {
            kind: "failed",
            error: toPreviewError(cause),
          });
          if (installed !== null) {
            commit(installed);
          }
        });
    },
    [api, commit, onAuthority],
  );

  // The one place the machine moves for a question that changed. Everything it
  // does is `planStep`'s decision; nothing here adds a condition of its own.
  useEffect(() => {
    const step = planStep(stateRef.current, question, ordinal.current + 1);
    switch (step.kind) {
      case "hold":
        return;
      case "settle":
        commit(step.state);
        return;
      case "issue":
        ordinal.current = step.ordinal;
        issue(step.identity, step.ordinal);
    }
  }, [commit, issue, question]);

  /**
   * The rows, taken as rows.
   *
   * Wrapped rather than handed out as the setter, because a setter accepts an
   * updater function as well as a value -- and a caller that passed one would
   * be computing the screen's own selection from the plan's copy of it, which
   * is the wrong direction for a fact the screen owns.
   */
  const describe = useCallback((next: readonly string[]) => {
    setHandles(next);
  }, []);

  /**
   * What the plan contributes to a start, computed once.
   *
   * Three surfaces read it -- the availability rule, the sentence in place of a
   * summary, and whether a re-ask is offered -- and a second evaluation is how
   * they would come to disagree about which of them the reader is looking at.
   */
  const start = startPlan(state, question);
  /**
   * Offered only where the failure is about the question being asked.
   *
   * A failure that has stopped describing the current question is already read
   * as one being worked out, and a `Describe again` beside "Working out what
   * this conversion would do…" would offer a reader a control for a question
   * nobody is asking -- pressing it would re-ask the one they have left.
   */
  const retryOffered = start === "failed";
  const retry = useCallback(() => {
    if (!retryOffered) {
      return;
    }
    const step = retryStep(stateRef.current, ordinal.current + 1);
    if (step.kind !== "issue") {
      return;
    }
    ordinal.current = step.ordinal;
    issue(step.identity, step.ordinal);
  }, [issue, retryOffered]);

  return {
    describe,
    state,
    question,
    current: currentPlan(state, question),
    startPlan: start,
    // The error of an answer that still describes the question being asked.
    // A failure about a question nobody is asking any more is not a sentence
    // to put on screen.
    error: state.status === "failed" && start === "failed" ? state.error : null,
    retryOffered,
    retry,
  };
}
