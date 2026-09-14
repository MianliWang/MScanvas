import type { RetentionTimeDomain } from "./scanModel";
import { activeGestureEpoch, renderedDomain, type ViewerEvent, type ViewerInteractionState } from "./interactionState";
import { activeMzGestureEpoch, mzDomain, renderedMzDomain, type MzDomain, type SpectrumViewportEvent, type SpectrumViewportState } from "./spectrumViewport";
import { planViewportAction, planRenderedDomainTransition, planWheelGesture } from "./viewportAction";
import { applySpectrumViewportAction, pannedTo, planMzWheelGesture, planRenderedMzTransition } from "./spectrumViewportAction";
import { panDomain } from "./viewport";
import type { RangeSelection, RangeTransaction } from "./rangeSelection";
import type { WheelDelta } from "./wheelInput";

export interface PlotInputSnapshot<A extends "rt" | "mz", D> {
  readonly source: number | string;
  readonly revision: number;
  readonly instruction: number;
  readonly full: D;
  readonly shown: D;
  readonly committed: D | null;
  readonly gesture: number | null;
  readonly range: RangeSelection<A, D> | null;
}
/** Two concrete axis ports for one DOM input mapping; neither owns viewport state. */
export interface PlotInputPort<A extends "rt" | "mz", D extends { readonly low: number; readonly high: number }> {
  readonly axis: A;
  readonly current: () => PlotInputSnapshot<A, D> | null;
  readonly domain: (low: number, high: number) => D;
  readonly start: (domain: D) => void;
  readonly move: (transaction: RangeTransaction<A, D>, domain: D) => void;
  readonly release: (transaction: RangeTransaction<A, D>) => void;
  readonly confirm: (proposal: RangeSelection<A, D>) => void;
  readonly cancel: (transaction: RangeTransaction<A, D>) => void;
  readonly abandon: () => void;
  readonly pan: (start: D, fraction: number, epoch: number | null) => boolean;
  readonly wheel: (wheel: WheelDelta, anchor: number) => boolean;
  readonly settle: (epoch: number) => void;
  readonly step: (action: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "reset") => boolean;
  readonly apply: (domain: D) => void;
}

export function retentionTimeInput(read: () => ViewerInteractionState, dispatch: (event: ViewerEvent) => ViewerInteractionState): PlotInputPort<"rt", RetentionTimeDomain> {
  const pan = (start: RetentionTimeDomain, fraction: number, epoch: number | null): boolean => {
    const state = read();
    if (state.fullDomain === null) return false;
    const domain = panDomain(start, state.fullDomain, fraction);
    const event: ViewerEvent = epoch === null ? { type: "gesture-started", domain } : { type: "gesture-moved", epoch, domain };
    if (!planRenderedDomainTransition(state, event).changed) return false;
    dispatch(event); return true;
  };
  return {
    axis: "rt", domain: (low, high) => ({ low, high }),
    current: () => { const state = read(); const shown = renderedDomain(state);
      return state.fullDomain === null || shown === null ? null : { source: state.sourceRevision,
        revision: state.selection?.revision ?? 0, instruction: state.nextGestureEpoch,
        full: state.fullDomain, shown, committed: state.committedDomain, gesture: activeGestureEpoch(state), range: state.rangeSelection }; },
    start: domain => { dispatch({ type: "range-started", domain }); },
    move: (transaction, domain) => { dispatch({ type: "range-moved", transaction, domain }); },
    release: transaction => { dispatch({ type: "range-released", transaction }); },
    confirm: proposal => { dispatch({ type: "range-confirmed", proposal }); },
    cancel: transaction => { dispatch({ type: "range-cancelled", transaction }); },
    abandon: () => { dispatch({ type: "input-abandoned" }); }, pan,
    wheel: (wheel, anchor) => { const plan = planWheelGesture(read(), wheel, anchor);
      if (plan.event === null) return false; dispatch(plan.event); return true; },
    settle: epoch => { dispatch({ type: "gesture-settled", epoch }); },
    step: action => {
      const state = read();
      if (action !== "pan-left" && action !== "pan-right") {
        const plan = planViewportAction(state, action); if (plan.event === null) return false;
        dispatch(plan.event); return true;
      }
      const shown = renderedDomain(state);
      if (shown === null || state.fullDomain === null) return false;
      const event: ViewerEvent = { type: "viewport-step", domain: panDomain(shown, state.fullDomain, action === "pan-left" ? -.25 : .25) };
      if (!planRenderedDomainTransition(state, event).changed) return false;
      dispatch(event); return true;
    },
    apply: domain => { dispatch({ type: "viewport-step", domain }); },
  };
}

export function mzInput(read: () => SpectrumViewportState, dispatch: (event: SpectrumViewportEvent) => SpectrumViewportState): PlotInputPort<"mz", MzDomain> {
  return {
    axis: "mz", domain: mzDomain,
    current: () => { const state = read(); const shown = renderedMzDomain(state);
      return state.status !== "ready" || shown === null ? null : { source: state.spectrumToken,
        revision: state.selectionRevision, instruction: state.nextEpoch, full: state.full, shown,
        committed: state.committed, gesture: activeMzGestureEpoch(state), range: state.rangeSelection }; },
    start: domain => { dispatch({ type: "range-started", domain }); },
    move: (transaction, domain) => { dispatch({ type: "range-moved", transaction, domain }); },
    release: transaction => { dispatch({ type: "range-released", transaction }); },
    confirm: proposal => { dispatch({ type: "range-confirmed", proposal }); },
    cancel: transaction => { dispatch({ type: "range-cancelled", transaction }); },
    abandon: () => { dispatch({ type: "input-abandoned" }); },
    pan: (start, fraction, epoch) => { const state = read(); if (state.status !== "ready") return false;
      const domain = pannedTo(start, state.full, fraction);
      const event: SpectrumViewportEvent = epoch === null ? { type: "gesture-started", domain } : { type: "gesture-moved", epoch, domain };
      if (!planRenderedMzTransition(state, event).changed) return false;
      dispatch(event); return true; },
    wheel: (wheel, anchor) => { const plan = planMzWheelGesture(read(), wheel, anchor);
      if (plan.event === null) return false; dispatch(plan.event); return true; },
    settle: epoch => { dispatch({ type: "gesture-settled", epoch }); },
    step: action => applySpectrumViewportAction(read(), dispatch, action),
    apply: domain => { dispatch({ type: "viewport-step", domain }); },
  };
}
