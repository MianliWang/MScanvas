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
 * Three refusals, and they are not the same thing:
 *
 * - **not qualified** — no row of the catalog names this combination. MSCanvas
 *   has never measured it, and no ProteoWizard build changes that.
 * - **unavailable on this installation** — the row exists, and the executable
 *   installed right now does not declare an option or a filter grammar it
 *   emits. A different build would offer it.
 * - **not evidenced for the sources this workflow converts** — the row exists
 *   and MSCanvas measured it, on a kind of acquisition this workflow does not
 *   convert. Peak picking is chosen by the reader, so that measurement is not
 *   evidence here, and no ProteoWizard build supplies the missing one.
 *
 * A reader can act on the second by changing installation and cannot act on the
 * first or the third that way, so all three are carried separately to the
 * sentence beside the control.
 *
 * **And every one of those sentences is about a *combination*, never about a
 * value.** A build lacking only the peak-picking grammar must not be able to
 * tell a reader that it does not offer 64-bit intensity, all spectra, or zlib:
 * each of those appears in a row this build runs perfectly well. What it cannot
 * run is the row that pairs them with centroiding, and that is what is said.
 */

import type {
  ConversionCatalogRow,
  ConversionCompression,
  ConversionIntentDescriptor,
  ConversionNumericPrecision,
  ConversionProcessing,
  ConversionSpectrumPopulation,
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
  | "notQualified"
  /** The row exists; the installed ProteoWizard does not declare what it emits. */
  | "unavailableHere"
  /**
   * The row exists, and MSCanvas has not measured it on the kinds of
   * acquisition this workflow converts.
   *
   * Rust decides this before it consults the installed grammar, so it is not a
   * claim that the build could otherwise run the row — it is a claim that no
   * measurement covers the sources in hand, which no release changes.
   *
   * A third refusal because it is a third fact. The first two are about the
   * product's vocabulary and about this installation; this one is about which
   * sources the measurement behind a row was taken on. Peak picking is the axis
   * it reaches, because the picker is chosen by the reader rather than by the
   * writer — so a measurement on one kind of source is not evidence about
   * another, and offering the row anyway would be offering an outcome nobody
   * has observed.
   */
  | "notEvidencedForSources";

/**
 * What one value of one axis can currently do.
 *
 * **There is deliberately no member for "selected, and unrunnable".** A choice
 * survives an installation change into a build that cannot run it, so that
 * state is real — but it is a fact about the *selected combination*, and all
 * four groups show the same selection. A per-value member put the same sentence
 * beside four controls, three of which named values the build offers, which is
 * the shape this surface exists to stop. It is said once, at settings level, by
 * {@link selectionIsUnavailable}, and the controls go on answering only their
 * own narrower question.
 */
export type ConversionChoiceState =
  /** The value the current selection carries on this axis. */
  | { readonly status: "selected" }
  /** Choosing it selects exactly this admitted semantic. */
  | { readonly status: "selectable"; readonly intentId: string }
  | { readonly status: "unavailable"; readonly reason: ConversionChoiceRefusal };

/** One value of one axis, and what it can do. */
export interface ConversionChoice<A extends ConversionAxis> {
  readonly value: ConversionAxisValues[A];
  readonly state: ConversionChoiceState;
}

/** The catalog row an identity names, or `null` where the catalog has none. */
export function catalogRow(
  catalog: readonly ConversionCatalogRow[],
  intentId: string,
): ConversionCatalogRow | null {
  return catalog.find((row) => row.intent.id === intentId) ?? null;
}

/**
 * Whether the chosen combination cannot run on the installation now bound.
 *
 * One statement, at settings level, naming the combination. `false` where the
 * catalog does not hold the selection at all: that is a different sentence
 * about a different problem, and {@link reselect} makes it unreachable anyway.
 */
export function selectionIsUnavailable(
  catalog: readonly ConversionCatalogRow[],
  selectedId: string,
): boolean {
  return selectionRefusal(catalog, selectedId) !== null;
}

/**
 * Why the current selection cannot run, or `null` where it can.
 *
 * **The reason, not a boolean, because the two refusals send a reader to
 * different places.** A selection survives an installation change, so a retained
 * combination that is now unavailable is a state this surface has to explain —
 * and explaining "the installed ProteoWizard cannot run this" about a row the
 * installation runs perfectly well would send them after a build that behaves
 * identically. What is missing there is a measurement, and no release supplies
 * one.
 *
 * `notQualified` is impossible here and is not returned: a selection is looked
 * up by identity, so a combination the catalog does not hold has no row to be
 * unavailable.
 */
export function selectionRefusal(
  catalog: readonly ConversionCatalogRow[],
  selectedId: string,
): ConversionChoiceRefusal | null {
  const selected = catalogRow(catalog, selectedId);
  if (selected === null || selected.available) {
    return null;
  }
  return selected.availability === "not_evidenced_for_conversion_sources"
    ? "notEvidencedForSources"
    : "unavailableHere";
}

/**
 * Which identity a newly arrived catalog should be selected on.
 *
 * **The reader's semantic survives an installation change wherever it can.** A
 * choice that is still a row of the new catalog is kept, *including* when that
 * row is now unavailable: the request is a scientific one, and quietly
 * replacing it with the shipped posture would convert something other than what
 * was asked for. Only a choice the new catalog does not hold at all falls back,
 * and it falls back to the combination Rust names as shipped rather than to
 * whichever row happens to be first.
 */
export function reselect(
  catalog: readonly ConversionCatalogRow[],
  shippedId: string,
  previousId: string | null,
): string {
  return previousId !== null && catalogRow(catalog, previousId) !== null ? previousId : shippedId;
}

/**
 * The combination to offer as an explicit way out, or `null` where the ordinary
 * controls already are one.
 *
 * **A dead end is reachable, and it is the cost of two rules that are each
 * right.** A choice survives an installation change, because it is a scientific
 * request rather than a property of a catalog; and a control moves one axis,
 * because a control that moved two would change something the reader did not
 * ask about. Put together, a preserved combination whose every one-axis
 * neighbour is unqualified or undeclared leaves every control refused, with the
 * shipped posture sitting available and unreachable.
 *
 * **But only then.** An unrunnable selection is not by itself a dead end. A
 * preserved 64/64 that a narrower build cannot run still has the shipped 64/32
 * one precision step away, offered and enabled — and claiming otherwise would
 * put a false sentence beside a working control. So the ordinary route is
 * looked for first, and it is looked for **through the very choices the
 * controls render**, rather than through a second scan of the catalog. A
 * separate predicate answering "is any neighbour reachable?" would be a second
 * compatibility calculation, which is the one thing this module exists not to
 * have.
 *
 * Where it really is a dead end, the way out is explicit, labelled and atomic
 * rather than a silent rewrite, and it selects only the combination Rust names
 * as shipped. Where even that cannot run, nothing is offered: inventing a route
 * to whichever row happens to be available would be the silent fallback this
 * design refuses.
 */
export function recoveryIntent(
  catalog: readonly ConversionCatalogRow[],
  shippedId: string,
  selectedId: string,
): ConversionCatalogRow | null {
  const chosen = catalogRow(catalog, selectedId);
  if (chosen === null || chosen.available) {
    return null;
  }
  const ordinaryRouteExists = CONVERSION_AXES.some((axis) =>
    axisChoices(catalog, chosen.intent, axis).some((choice) => canChoose(choice.state)),
  );
  if (ordinaryRouteExists) {
    return null;
  }
  const shipped = catalogRow(catalog, shippedId);
  return shipped !== null && shipped.available ? shipped : null;
}

/**
 * The catalog row for one exact combination of the five dimensions.
 *
 * The one place a combination is looked up, and it matches on every dimension
 * rather than on a subset: a row agreeing on four axes is a different semantic,
 * not a near miss.
 */
function rowForCombination(
  catalog: readonly ConversionCatalogRow[],
  wanted: Omit<ConversionIntentDescriptor, "id">,
): ConversionCatalogRow | null {
  return (
    catalog.find(
      (row) =>
        row.intent.format === wanted.format &&
        row.intent.processing === wanted.processing &&
        row.intent.population === wanted.population &&
        row.intent.precision === wanted.precision &&
        row.intent.compression === wanted.compression,
    ) ?? null
  );
}

/**
 * What choosing one value of one axis would do, with every other axis held.
 *
 * **One axis moves, and only that axis.** The candidate is the current
 * combination with exactly one dimension replaced; if the catalog holds it the
 * choice selects it, and if it does not the choice is refused. There is
 * deliberately no search for some other admitted row that happens to contain
 * the requested value — that search is what would silently change the reader's
 * precision when they asked about compression, and it would make the evidence
 * graph invisible in the interaction.
 */
export function choiceState<A extends ConversionAxis>(
  catalog: readonly ConversionCatalogRow[],
  current: ConversionIntentDescriptor,
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
    return { status: "unavailable", reason: "notQualified" };
  }
  // Read from the row's own answer rather than from the boolean beside it, so
  // the two refusals a *row* can carry stay two sentences -- the third, for a
  // combination no row holds, is answered above. A reader told "this
  // installation does not offer it" about a row their installation offers
  // perfectly well would go looking for a different ProteoWizard release, and
  // find nothing.
  if (row.availability === "not_evidenced_for_conversion_sources") {
    return { status: "unavailable", reason: "notEvidencedForSources" };
  }
  if (!row.available) {
    return { status: "unavailable", reason: "unavailableHere" };
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
  catalog: readonly ConversionCatalogRow[],
  current: ConversionIntentDescriptor,
  axis: A,
): readonly ConversionChoice<A>[] {
  const seen: ConversionAxisValues[A][] = [];
  for (const row of catalog) {
    const value = row.intent[axis] as ConversionAxisValues[A];
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
