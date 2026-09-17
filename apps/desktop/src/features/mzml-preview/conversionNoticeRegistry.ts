/**
 * One DOM owner per availability fact, for the whole conversion panel.
 *
 * ADR 0044 Decision 12, made concrete. The panel offers several actions that
 * can be refused by one underlying fact -- `Convert`, the rerun of a failed
 * queue, and the settings read's own retry -- and before this each surface
 * minted its own global id for its own refusal. Two elements carrying one
 * fact's id left `aria-describedby` ambiguous and read the same situation to a
 * screen reader twice, in two different sentences, neither of which knew the
 * other existed.
 *
 * So the refusals arrive here, from every action currently on screen, and this
 * module deduplicates them **by the refusing fact rather than by the word each
 * authority used for it**. Two vocabularies reach it: `ConversionLane` refuses
 * a conversion and `ConversionConfigurationProbeAdmission` refuses a probe, and
 * they are disjoint word-sets over an overlapping set of facts. A conversion
 * holding the backend gate is one fact refusing two actions, and a registry
 * keyed on the reason word would emit two notices for it.
 *
 * **The surviving element carries the fact's sentence, not either action's.**
 * A notice two actions point at cannot be phrased about one of them: keyed on
 * `laneClaimed`, a `Convert` refusal and a settings-read refusal collapse to
 * one element, and if that element kept the conversion's wording the settings
 * retry would be described as "converting is unavailable while a conversion is
 * running". A notice element is fact-phrased whether one action points at it or
 * three, because a sentence that changed when a second action appeared would be
 * exactly the wobble this removes.
 *
 * Since M7.1 that distinction lives in the resource bundle: one key per
 * reason, worded for the fact where the fact is shared and for the action where
 * it is not. This module decides *which* reason survives; the words are looked
 * up where the notice is rendered, which is the only place with a locale.
 */

import type {
  ConversionAvailability,
  ConversionUnavailableReason,
} from "./conversionAvailability";
import { conversionNoticeId } from "./conversionAvailability";
import type { ProbeRefusal } from "./conversionConfigurationAuthority";

/**
 * The facts more than one action can be refused by.
 *
 * `ConversionLane`'s own nine fields, in the lane's own order, which is also
 * the order `ConversionConfigurationProbeAdmission` reports its refusals in.
 * They are named with the lane's reason words rather than its field names so
 * that one fact keeps one id across this whole surface -- the ids predate this
 * registry and the elements they name are the same elements.
 *
 * `backendUsable` is here too. It is shared by every conversion action and by
 * nothing else, and omitting it would have left the refusal two actions reach
 * most often with no key at all.
 */
export const CONVERSION_LANE_FACTS = [
  "backend-quarantined",
  "backend-changing",
  "backend-unavailable",
  "conversion-running",
  "preview-running",
  "configuration-probing",
  "adoption-running",
  "diagnostics-exporting",
  "workspace-settling",
  "staging-reclaiming",
] as const;

export type ConversionAvailabilityFact = (typeof CONVERSION_LANE_FACTS)[number];

/**
 * The order notices are rendered in.
 *
 * The shared facts first, in the lane's own precedence, then the reasons that
 * belong to one action. Stated rather than left to the order the panel happens
 * to collect its decisions in, so the same combination of refusals always
 * produces the same document.
 */
const NOTICE_ORDER: Readonly<Record<ConversionUnavailableReason, number>> = {
  "backend-quarantined": 0,
  "backend-changing": 1,
  "backend-unavailable": 2,
  "conversion-running": 3,
  "preview-running": 4,
  "configuration-probing": 5,
  "adoption-running": 6,
  "diagnostics-exporting": 7,
  "workspace-settling": 8,
  "staging-reclaiming": 7.5,
  "no-convertible-target": 9,
  "plan-reading": 10,
  "plan-failed": 11,
  "plan-capacity-exceeded": 12,
  "plan-settings-unknown": 13,
  "plan-selection-unavailable": 14,
  "plan-selection-not-evidenced": 15,
  "queue-not-retryable": 16,
  "nothing-to-retry": 17,
};

/**
 * Which lane fact a probe refusal is about, or `null` where nothing renders it.
 *
 * The mapping is Decision 11's admitting subset read back onto the fields it
 * was drawn from, which is why it exists at all: admission and the lane are two
 * vocabularies over one set of facts, and a moment both refuse must be named
 * once.
 *
 * `probeInFlight` maps to nothing, and that is not an omission. It can refuse a
 * *probe*, but nothing it refuses is ever on screen: the settings retry is
 * withdrawn for the duration of a probe rather than disabled, and an automatic
 * read's refusal is bookkeeping rather than an error. A conversion refused
 * while a probe runs is a different action refused by the same fact, and it is
 * keyed through the lane's own `configurationProbing`.
 */
export function probeRefusalFact(refusal: ProbeRefusal): ConversionAvailabilityFact | null {
  switch (refusal) {
    case "backendQuarantined":
      return "backend-quarantined";
    case "backendChanging":
      return "backend-changing";
    case "laneClaimed":
      return "conversion-running";
    case "previewReading":
      return "preview-running";
    case "reclaimingStaging":
      return "staging-reclaiming";
    case "probeInFlight":
      return null;
  }
}

/**
 * One action's refusal, in whichever vocabulary its authority speaks.
 *
 * `null` for an action that is not on screen. Passing the absent case through
 * rather than filtering at the call site is deliberate: which controls exist is
 * the panel's decision, made once beside the controls rather than again here.
 */
export type ConversionRefusal =
  | { readonly source: "action"; readonly availability: ConversionAvailability }
  | { readonly source: "probe"; readonly refusal: ProbeRefusal };

/**
 * One notice, and the id the controls it explains point at.
 *
 * The reason, not the sentence. `conversionNoticeMessage` turns it into words
 * where the notice is rendered, which is the only place that has a locale --
 * and a sentence held here would be English in a Chinese session.
 */
export interface ConversionNotice {
  readonly id: string;
  readonly reason: ConversionUnavailableReason;
}

/**
 * What one refusal contributes, or `null` where it contributes nothing.
 *
 * The reason is the whole contribution, and every reason has a resource, so
 * there is no shape in which a notice exists with no text to put in it -- a
 * described-by target with no words is a promise of an explanation that is not
 * there.
 *
 * Which sentence a reason gets is the resource bundle's answer, and it keeps
 * the distinction this module exists for: a shared fact is worded in terms of
 * the fact, and a reason only one action can reach -- a `plan-failed`, a
 * `nothing-to-retry` -- is worded for that action, because re-phrasing it away
 * from the action would lose what the reader can do about it.
 */
function noticeOf(refusal: ConversionRefusal): ConversionUnavailableReason | null {
  if (refusal.source === "probe") {
    // Every reason a probe contributes is a lane fact, by the mapping above.
    return probeRefusalFact(refusal.refusal);
  }
  return refusal.availability.status === "unavailable" ? refusal.availability.reason : null;
}

/**
 * The id one action's control points `aria-describedby` at.
 *
 * `null` where this refusal renders no sentence -- an available action, or a
 * probe refused by another probe. A described-by target with no text is a
 * promise of an explanation that is not there.
 *
 * Minted from the same reason the registry keys on, so a control and the
 * element it names cannot come apart. **Child components never mint one of
 * these themselves**; they are handed the id the panel already put in the
 * document.
 */
export function conversionRefusalNoticeId(refusal: ConversionRefusal | null): string | null {
  const reason = refusal === null ? null : noticeOf(refusal);
  return reason === null ? null : conversionNoticeId(reason);
}

/**
 * Every reason the panel is currently giving, once each.
 *
 * Deduplicated by fact and ordered by the registry's own precedence. Two
 * refusals that key on one fact collapse to one notice, which is the whole
 * point: one element, one id, one sentence.
 */
export function conversionNotices(
  refusals: readonly (ConversionRefusal | null)[],
): readonly ConversionNotice[] {
  const said = new Set<ConversionUnavailableReason>();
  for (const refusal of refusals) {
    const reason = refusal === null ? null : noticeOf(refusal);
    if (reason !== null) {
      said.add(reason);
    }
  }
  // Order the actual observations. A presentation order must never filter a
  // refusal out of the UI; the total rank map also requires every typed reason.
  return [...said]
    .sort((left, right) => NOTICE_ORDER[left] - NOTICE_ORDER[right])
    .map(reason => ({ id: conversionNoticeId(reason), reason }));
}
