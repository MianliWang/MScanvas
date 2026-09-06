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
 * That is a second text rather than a rewrite of the first.
 * `ConversionAvailability.message` is action-phrased and untouched; it stays
 * where it belongs, on the control it describes.
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
] as const;

export type ConversionAvailabilityFact = (typeof CONVERSION_LANE_FACTS)[number];

/**
 * What each shared fact says, in terms of the fact.
 *
 * Every sentence has to stay true whichever action is pointing at it, so none
 * of them names an action or a consequence. What a reader cannot do about it is
 * the control's business: a disabled `Convert` beside "a conversion currently
 * owns the ProteoWizard lane" needs no second sentence saying that converting
 * is unavailable.
 */
const CONVERSION_FACT_MESSAGES: Record<ConversionAvailabilityFact, string> = {
  "backend-quarantined":
    "MSCanvas could not confirm that a converter process stopped. " +
    "Restart MSCanvas before running anything else on ProteoWizard.",
  "backend-changing": "MSCanvas is checking the installed ProteoWizard.",
  "backend-unavailable":
    "This session has no usable ProteoWizard backend. See the backend status above.",
  "conversion-running": "A conversion currently owns the ProteoWizard lane.",
  "preview-running": "A run is being read over the ProteoWizard lane.",
  "configuration-probing": "MSCanvas is reading the conversion options from ProteoWizard.",
  "adoption-running": "Converted outputs are being added to the workspace.",
  "diagnostics-exporting": "Failure diagnostics are being saved.",
  "workspace-settling": "The file list is being changed.",
};

const LANE_FACTS: ReadonlySet<string> = new Set(CONVERSION_LANE_FACTS);

/** Whether a refusal names a fact more than one action can be refused by. */
export function isConversionLaneFact(
  reason: ConversionUnavailableReason,
): reason is ConversionAvailabilityFact {
  return LANE_FACTS.has(reason);
}

/**
 * The order notices are rendered in.
 *
 * The shared facts first, in the lane's own precedence, then the reasons that
 * belong to one action. Stated rather than left to the order the panel happens
 * to collect its decisions in, so the same combination of refusals always
 * produces the same document.
 */
const NOTICE_ORDER: readonly ConversionUnavailableReason[] = [
  ...CONVERSION_LANE_FACTS,
  "no-convertible-target",
  "plan-reading",
  "plan-failed",
  "plan-settings-unknown",
  "plan-selection-unavailable",
  "queue-not-retryable",
  "nothing-to-retry",
];

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

/** One rendered sentence, and the id the controls it explains point at. */
export interface ConversionNotice {
  readonly id: string;
  readonly reason: ConversionUnavailableReason;
  readonly message: string;
}

/**
 * What one refusal contributes, or `null` where it contributes nothing.
 *
 * The reason and the sentence are decided together, in one pass over the
 * refusal, so there is no shape in which a notice exists with no text to put in
 * it -- a described-by target with no words is a promise of an explanation that
 * is not there, and splitting this into "which reason" and "which message"
 * needed an unreachable branch to answer the second.
 *
 * The fact's sentence wherever the fact is shared, and the action's own where it
 * is not: a `plan-failed` or a `nothing-to-retry` belongs to the one action
 * asking, so re-phrasing it away from that action would lose what the reader can
 * do about it.
 */
function noticeOf(refusal: ConversionRefusal): Omit<ConversionNotice, "id"> | null {
  if (refusal.source === "probe") {
    // Every reason a probe contributes is a lane fact, by the mapping above.
    const fact = probeRefusalFact(refusal.refusal);
    return fact === null ? null : { reason: fact, message: CONVERSION_FACT_MESSAGES[fact] };
  }
  if (refusal.availability.status !== "unavailable") {
    return null;
  }
  const reason = refusal.availability.reason;
  return {
    reason,
    message: isConversionLaneFact(reason)
      ? CONVERSION_FACT_MESSAGES[reason]
      : refusal.availability.message,
  };
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
  const notice = refusal === null ? null : noticeOf(refusal);
  return notice === null ? null : conversionNoticeId(notice.reason);
}

/**
 * Every sentence the panel is currently giving as a reason, said once each.
 *
 * Deduplicated by fact, ordered by the registry's own precedence, and phrased
 * for the fact wherever more than one action could reach it.
 */
export function conversionNotices(
  refusals: readonly (ConversionRefusal | null)[],
): readonly ConversionNotice[] {
  const said = new Map<ConversionUnavailableReason, string>();
  for (const refusal of refusals) {
    const notice = refusal === null ? null : noticeOf(refusal);
    // First writer wins, and nothing turns on which: two refusals that key on
    // one *fact* carry that fact's one sentence, and the reasons that are not
    // facts belong to a single action, so no two refusals can reach one of
    // those with different words.
    if (notice !== null && !said.has(notice.reason)) {
      said.set(notice.reason, notice.message);
    }
  }
  return NOTICE_ORDER.flatMap((reason) => {
    const message = said.get(reason);
    return message === undefined ? [] : [{ id: conversionNoticeId(reason), reason, message }];
  });
}
