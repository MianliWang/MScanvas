/**
 * Which conversion semantic is selected, and what each control may offer.
 *
 * **This module holds no compatibility matrix, and that is its whole design.**
 * The nine combinations MSCanvas has measured live in one Rust table and reach
 * this side as a catalog; everything here is a *lookup* in that catalog.
 * Nothing below enumerates a combination, composes one out of separately valid
 * values, or decides that two settings go together. Ask whether a combination
 * exists and the answer comes from the list Rust sent; ask what an axis may
 * offer and the values come from the same list.
 *
 * The consequence is the property M6.3 established and M6.4 has to preserve: a
 * user cannot assemble one of the thirty-nine combinations the evidence does
 * not admit, because there is no code path here that assembles one at all. A
 * choice is either a row of the catalog or it is refused with a reason.
 *
 * Two refusals, and they are not the same thing:
 *
 * - **not qualified** — no row of the catalog names this combination. MSCanvas
 *   has never measured it, and no ProteoWizard build changes that.
 * - **unsupported by this installation** — the row exists, and the executable
 *   installed right now does not declare an option or a filter grammar it
 *   emits. A different build would offer it.
 *
 * A reader can act on the second and cannot act on the first, so they are
 * carried separately all the way to the sentence beside the control.
 */

import type {
  ConversionCompression,
  ConversionIntent,
  ConversionIntentCatalog,
  ConversionIntentOption,
  ConversionNumericPrecision,
  ConversionProcessing,
  ConversionSpectrumPopulation,
  PreviewError,
} from "./contracts";

/**
 * The dimensions a control may edit, and the type each carries.
 *
 * Format is deliberately absent. One output format is admitted, so there is
 * nothing to choose between; it is stated by the plan rather than offered as a
 * control, and a disabled second format would advertise a route this milestone
 * does not own.
 */
export interface ConversionAxisValues {
  readonly processing: ConversionProcessing;
  readonly population: ConversionSpectrumPopulation;
  readonly precision: ConversionNumericPrecision;
  readonly compression: ConversionCompression;
}

/** Which dimension a control edits. */
export type ConversionAxis = keyof ConversionAxisValues;

/**
 * The order the axes are presented in.
 *
 * A reading order rather than an authority: what a scientist decides first is
 * what happens to the peaks, then which spectra survive, then how the numbers
 * are stored, then how they are packed. It says nothing about which
 * combinations exist.
 */
export const CONVERSION_AXES: readonly ConversionAxis[] = [
  "processing",
  "population",
  "precision",
  "compression",
];

/** Why one value cannot be chosen right now. */
export type ConversionChoiceRefusal =
  /** No row of the catalog names the combination this choice would produce. */
  | "not-qualified"
  /** The row exists; the installed ProteoWizard does not declare what it emits. */
  | "unsupported-by-installation";

/** What one value of one axis can currently do. */
export type ConversionChoiceState =
  | { readonly status: "selected" }
  /** Choosing it selects exactly this admitted semantic. */
  | { readonly status: "selectable"; readonly intentId: string }
  | { readonly status: "unavailable"; readonly reason: ConversionChoiceRefusal };

/** One value of one axis, and what it can do. */
export interface ConversionChoice<A extends ConversionAxis> {
  readonly value: ConversionAxisValues[A];
  readonly state: ConversionChoiceState;
}

/**
 * Whether the selected semantic is settled, and what to say when it is not.
 *
 * Separate from the catalog's own load state because a catalog can arrive and
 * still leave the chosen semantic unrunnable — after an installation change,
 * for instance, where the user's choice is preserved and the new build cannot
 * express it. Settings existing is not permission to convert.
 */
export type ConversionSettings =
  | { readonly status: "loading" }
  /**
   * This session has no usable ProteoWizard, so there is nothing to ask.
   *
   * Distinct from `loading`, which says a read is under way, and from `failed`,
   * which says one was attempted and did not answer. **The last catalog is not
   * kept here**: a catalog is an answer about one executable, and offering its
   * availability marks beside a banner saying no backend is installed would
   * describe a build that is not there.
   */
  | { readonly status: "noBackend" }
  /** The catalog could not be established. No semantic is manufactured. */
  | { readonly status: "failed"; readonly error: PreviewError }
  | {
      readonly status: "ready";
      readonly catalog: ConversionIntentCatalog;
      /** The identity of the selected row, which is always a row of `catalog`. */
      readonly selectedId: string;
    };

/**
 * The semantic to offer as a way out, or `null` where the controls are already
 * the way out.
 *
 * **A dead end is reachable, and it is the cost of two rules that are each
 * right.** A choice survives an installation change, because it is a scientific
 * request rather than a property of a catalog; and a control moves one axis,
 * because a control that moved two would change something the user did not ask
 * about. Put together, a preserved semantic whose every one-axis neighbour is
 * unqualified or undeclared leaves every control refused, with the shipped
 * posture sitting available and unreachable.
 *
 * **But only then.** An unrunnable selection is not by itself a dead end, and
 * this used to treat it as one: a preserved 64/64 that a narrower build cannot
 * run still has the shipped 64/32 one precision step away, offered and enabled.
 * Claiming otherwise put a false sentence beside a working control, on the
 * surface this milestone added to stop the interface saying false things. So
 * the ordinary route is looked for first, and it is looked for **through the
 * very choices the controls render** — `axisChoices` over `CONVERSION_AXES`,
 * the same call each fieldset makes — rather than through a second scan of the
 * catalog. A separate predicate answering "is any neighbour reachable?" would be
 * a second compatibility calculation, which is the one thing this module exists
 * not to have.
 *
 * Where it really is a dead end the way out is explicit, labelled and atomic
 * rather than a silent rewrite, and it selects only the semantic Rust names as
 * shipped. Where even that cannot run, nothing is offered: inventing a route to
 * whichever row happens to be available would be the silent fallback this
 * design refuses.
 *
 * "Shipped differs from the current selection" is not tested separately because
 * it follows. The two conditions below require the current row to be unrunnable
 * and the shipped row to be runnable, and one row cannot be both.
 */
export function recoveryIntent(settings: ConversionSettings): ConversionIntentOption | null {
  if (settings.status !== "ready") {
    return null;
  }
  const chosen = catalogRow(settings.catalog, settings.selectedId);
  // No current semantic at all. `reselect` makes this unreachable — a selection
  // the catalog does not hold falls back when that catalog installs — and the
  // settings surface has its own sentence for it, so a labelled reset offered
  // underneath that sentence would be a second answer to one question.
  if (chosen === null) {
    return null;
  }
  if (chosen.availability.kind === "available") {
    return null;
  }
  // An ordinary control can already reach a runnable combination, so the
  // controls *are* the recovery and there is nothing here to say.
  const ordinaryRouteExists = CONVERSION_AXES.some((axis) =>
    axisChoices(settings.catalog, chosen.intent, axis).some((choice) => canChoose(choice.state)),
  );
  if (ordinaryRouteExists) {
    return null;
  }
  const shipped = catalogRow(settings.catalog, settings.catalog.shippedIntentId);
  return shipped !== null && shipped.availability.kind === "available" ? shipped : null;
}

/**
 * The catalog row an identity names.
 *
 * `null` where the catalog does not hold it, which after an evidence change is
 * a real possibility and never a state to paper over.
 */
export function catalogRow(
  catalog: ConversionIntentCatalog,
  intentId: string,
): ConversionIntentOption | null {
  return catalog.intents.find((option) => option.intent.id === intentId) ?? null;
}

/** The selected row, or `null` while there is not one. */
export function selectedOption(settings: ConversionSettings): ConversionIntentOption | null {
  return settings.status === "ready" ? catalogRow(settings.catalog, settings.selectedId) : null;
}

/** The selected semantic, or `null` while there is not one. */
export function selectedIntent(settings: ConversionSettings): ConversionIntent | null {
  return selectedOption(settings)?.intent ?? null;
}

/**
 * Which identity a new catalog should be selected on.
 *
 * **The user's semantic survives an installation change wherever it can.** A
 * choice that is still a row of the new catalog is kept, *including* when that
 * row is now unsupported: the request is a scientific one, and quietly
 * replacing it with the shipped posture would convert something other than
 * what was asked for. Only a choice the new catalog does not hold at all falls
 * back, and it falls back to the semantic Rust names as shipped rather than to
 * whichever row happens to be first.
 */
export function reselect(
  catalog: ConversionIntentCatalog,
  previousId: string | null,
): string {
  if (previousId !== null && catalogRow(catalog, previousId) !== null) {
    return previousId;
  }
  return catalog.shippedIntentId;
}

/**
 * The catalog row for one exact combination of the five dimensions.
 *
 * The one place a combination is looked up, and it matches on every dimension
 * rather than on a subset: a row agreeing on four axes is a different semantic,
 * not a near miss.
 */
function rowForCombination(
  catalog: ConversionIntentCatalog,
  wanted: Omit<ConversionIntent, "id">,
): ConversionIntentOption | null {
  return (
    catalog.intents.find(
      (option) =>
        option.intent.format === wanted.format &&
        option.intent.processing === wanted.processing &&
        option.intent.population === wanted.population &&
        option.intent.precision === wanted.precision &&
        option.intent.compression === wanted.compression,
    ) ?? null
  );
}

/**
 * What choosing one value of one axis would do, with every other axis held.
 *
 * **One axis moves, and only that axis.** The candidate is the current
 * semantic with exactly one dimension replaced; if the catalog holds it the
 * choice selects it, and if it does not the choice is refused. There is
 * deliberately no search for some other admitted row that happens to contain
 * the requested value — that search is what would silently change the user's
 * precision when they asked about compression, and it would make the evidence
 * graph invisible in the interaction.
 */
export function choiceState<A extends ConversionAxis>(
  catalog: ConversionIntentCatalog,
  current: ConversionIntent,
  axis: A,
  value: ConversionAxisValues[A],
): ConversionChoiceState {
  if (current[axis] === value) {
    return { status: "selected" };
  }
  const row = rowForCombination(catalog, {
    format: current.format,
    processing: current.processing,
    population: current.population,
    precision: current.precision,
    compression: current.compression,
    [axis]: value,
  });
  if (row === null) {
    return { status: "unavailable", reason: "not-qualified" };
  }
  if (row.availability.kind !== "available") {
    return { status: "unavailable", reason: "unsupported-by-installation" };
  }
  return { status: "selectable", intentId: row.intent.id };
}

/**
 * Every value one axis may show, and what each can do.
 *
 * The vocabulary comes from the catalog, in first-appearance order, so this
 * side does not list the members of a dimension any more than it lists the
 * combinations of them. Rust sends the admitted rows in evidence order — the
 * shipped posture first, then each dimension varied from a fixed baseline — so
 * first appearance is also the order a reader meets them in the record.
 */
export function axisChoices<A extends ConversionAxis>(
  catalog: ConversionIntentCatalog,
  current: ConversionIntent,
  axis: A,
): readonly ConversionChoice<A>[] {
  const seen: ConversionAxisValues[A][] = [];
  for (const option of catalog.intents) {
    const value = option.intent[axis] as ConversionAxisValues[A];
    if (!seen.includes(value)) {
      seen.push(value);
    }
  }
  return seen.map((value) => ({ value, state: choiceState(catalog, current, axis, value) }));
}

/**
 * Whether a choice may be taken at all.
 *
 * The projection every handler and every `disabled` is written from, so a
 * control that looks activatable and a handler that accepts the activation are
 * the same decision rather than two expressions that resemble each other.
 */
export function canChoose(state: ConversionChoiceState): boolean {
  return state.status === "selectable";
}
