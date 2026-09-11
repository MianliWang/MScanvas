import type { ReactElement } from "react";

import type {
  ConversionCatalogRow,
  ConversionCompression,
  ConversionIntentDescriptor,
  ConversionNumericPrecision,
  ConversionProcessing,
  ConversionSpectrumPopulation,
} from "./contracts";
import type {
  ConversionAxis,
  ConversionAxisValues,
  ConversionChoiceRefusal,
  ConversionChoiceState,
} from "./conversionIntentSelection";
import {
  axisChoices,
  catalogRow,
  CONVERSION_AXES,
  recoveryIntent,
  selectionRefusal,
} from "./conversionIntentSelection";
import type { ConversionConfigurationView } from "./useConversionConfiguration";

/**
 * What each axis is called where the reader meets it.
 *
 * Scientific names, not the crate's vocabulary and not the provider's. "Peak
 * processing" rather than "filter chain"; "Spectra included" rather than
 * "population", because what the control decides is which spectra come out.
 */
const AXIS_LEGEND: Record<ConversionAxis, string> = {
  processing: "Peak processing",
  population: "Spectra included",
  precision: "Numeric precision",
  compression: "Array compression",
};

const PROCESSING_LABEL: Record<ConversionProcessing, string> = {
  no_additional_centroiding: "No additional centroiding",
  unscoped_default_centroiding: "Centroid all MS levels",
};

const POPULATION_LABEL: Record<ConversionSpectrumPopulation, string> = {
  all: "All spectra",
  ms1_only: "MS1 spectra only",
  ms2_only: "MS2 spectra only",
};

/**
 * Precision named as a pair, because a pair is what is chosen.
 *
 * The two widths are never offered as separate controls. Which pairs exist is a
 * measured fact, and two free controls would be a cross-product this product
 * has no evidence for.
 */
const PRECISION_LABEL: Record<ConversionNumericPrecision, string> = {
  mz64_intensity32: "m/z 64-bit · intensity 32-bit",
  mz64_intensity64: "m/z 64-bit · intensity 64-bit",
  mz32_intensity32: "m/z 32-bit · intensity 32-bit",
  mz32_intensity64: "m/z 32-bit · intensity 64-bit",
};

const COMPRESSION_LABEL: Record<ConversionCompression, string> = {
  zlib: "zlib compressed",
  none: "Uncompressed",
};

/**
 * What each choice does to the data, said where the choice is made.
 *
 * Every sentence that claims a loss is a claim this repository can support, and
 * every sentence that declines to claim one says why. Centroiding is marked
 * lossy at the radio rather than after it is selected; a narrower store is
 * described as rounding rather than as "smaller"; a population filter says that
 * the other spectra are left out rather than implying they are processed
 * differently; and compression is described as a packing decision, because that
 * is what the measurement established when precision is held constant.
 */
const PROCESSING_NOTE: Record<ConversionProcessing, string> = {
  no_additional_centroiding:
    "MSCanvas adds no peak picking. Profile spectra are converted as the instrument recorded them.",
  // The algorithm is deliberately not named. It was, until M6.10 measured the
  // bare `peakPicking` filter on a lawful vendor acquisition and found this
  // build selecting the *vendor* picker there rather than the local-maximum one
  // this sentence used to claim. The loss is what a reader needs and is what
  // the evidence supports for every source; the implementation is not, and a
  // sentence that named it was right about mzML sources and wrong about the
  // three vendor families this product exists to convert.
  unscoped_default_centroiding:
    "Lossy. Peak picking replaces the recorded profile points, and the " +
    "profile cannot be recovered from the converted file. It applies to every MS level and " +
    "cannot be limited to one.",
};

const POPULATION_NOTE: Record<ConversionSpectrumPopulation, string> = {
  all: "Every spectrum in the acquisition is converted.",
  ms1_only: "MS2 and higher spectra are left out of the converted file.",
  ms2_only: "MS1 spectra, and anything above MS2, are left out of the converted file.",
};

const PRECISION_NOTE: Record<ConversionNumericPrecision, string> = {
  mz64_intensity32:
    "The precision MSCanvas converts with today. Intensities are stored at 32-bit, which rounds " +
    "their values.",
  mz64_intensity64: "Both arrays are stored at 64-bit. Nothing is rounded by the stored width.",
  mz32_intensity32:
    "Both arrays are stored at 32-bit, which rounds m/z values and intensity values.",
  mz32_intensity64: "m/z values are stored at 32-bit, which rounds them.",
};

const COMPRESSION_NOTE: Record<ConversionCompression, string> = {
  zlib: "The stored arrays are packed. The numbers written are the same either way.",
  none: "Larger files. The numbers written are the same either way.",
};

/**
 * Why a value cannot be chosen, in terms of what the reader can do about it.
 *
 * Both sentences name the **combination** the choice would produce, never the
 * value. A build that lacks only the peak-picking grammar must not be able to
 * say it does not offer 64-bit intensity: that width appears in rows this build
 * runs perfectly well, and what it cannot run is the row that pairs it with
 * centroiding.
 */
const REFUSAL_NOTE: Record<ConversionChoiceRefusal, string> = {
  notQualified:
    "Not available with the other settings you have chosen: MSCanvas has not qualified that " +
    "combination.",
  unavailableHere:
    "Not available with the other settings you have chosen: the installed ProteoWizard build " +
    "does not offer that combination.",
  notEvidencedForSources:
    "Not available with the other settings you have chosen: MSCanvas has not measured that " +
    "combination on the kinds of acquisition it converts.",
};

/**
 * The one output format, stated rather than offered.
 *
 * mzXML is not a disabled control here. A disabled control advertises a route,
 * and this product has measured that route producing a file that silently drops
 * spectra; whether it ever returns is a later decision with its own evidence.
 */
const FORMAT_NOTE = "mzML is the format MSCanvas has qualified, and the only one it writes.";

/**
 * What the read failure's own sentence is called, so the retry points at it.
 *
 * A domain error about *this* read, owned by the surface that describes it. It
 * is deliberately not in the panel's availability registry: no other action can
 * be refused by it, and a fact nobody shares needs no shared owner.
 */
const SETTINGS_FAILURE_ID = "conversion-settings-failure";
const SELECTION_UNAVAILABLE_ID = "conversion-settings-selection-unavailable";

/**
 * What the settings-level banner says about a retained selection that cannot
 * run, in terms of what the reader can do about it.
 *
 * **Two sentences, because the two refusals have different remedies.** One is
 * about this installation and another ProteoWizard release can change it; the
 * other is about the product's evidence, and no release can — pointing a reader
 * at their installation for that one sends them after a build that would behave
 * exactly the same way.
 *
 * `notQualified` cannot reach here: a selection is a row of the catalog, so
 * there is always a row to be unavailable.
 */
const SELECTION_UNAVAILABLE_NOTE: Record<ConversionChoiceRefusal, string> = {
  notQualified: "MSCanvas has not qualified the conversion settings you chose.",
  unavailableHere:
    "The conversion settings you chose cannot run with this ProteoWizard installation.",
  notEvidencedForSources:
    "MSCanvas has not measured the conversion settings you chose on the kinds of acquisition " +
    "it converts.",
};
const RECOVERY_REASON_ID = "conversion-settings-recovery-reason";

function labelFor<A extends ConversionAxis>(axis: A, value: ConversionAxisValues[A]): string {
  switch (axis) {
    case "processing":
      return PROCESSING_LABEL[value as ConversionProcessing];
    case "population":
      return POPULATION_LABEL[value as ConversionSpectrumPopulation];
    case "precision":
      return PRECISION_LABEL[value as ConversionNumericPrecision];
    case "compression":
      return COMPRESSION_LABEL[value as ConversionCompression];
  }
}

function noteFor<A extends ConversionAxis>(axis: A, value: ConversionAxisValues[A]): string {
  switch (axis) {
    case "processing":
      return PROCESSING_NOTE[value as ConversionProcessing];
    case "population":
      return POPULATION_NOTE[value as ConversionSpectrumPopulation];
    case "precision":
      return PRECISION_NOTE[value as ConversionNumericPrecision];
    case "compression":
      return COMPRESSION_NOTE[value as ConversionCompression];
  }
}

/**
 * The reduced-information disclosures one combination carries, and only those.
 *
 * Assembled from the combination itself rather than written once per summary,
 * so the sentence beside a plan and the sentence beside the control it came
 * from are the same claim. A combination that reduces nothing produces an empty
 * list and therefore no reassuring sentence: silence is the honest answer where
 * there is nothing to disclose.
 */
export function conversionIntentDisclosures(
  intent: ConversionIntentDescriptor,
): readonly string[] {
  const disclosures: string[] = [];
  if (intent.processing === "unscoped_default_centroiding") {
    disclosures.push(PROCESSING_NOTE.unscoped_default_centroiding);
  }
  if (intent.population !== "all") {
    disclosures.push(POPULATION_NOTE[intent.population]);
  }
  if (intent.precision !== "mz64_intensity64") {
    disclosures.push(PRECISION_NOTE[intent.precision]);
  }
  return disclosures;
}

/** The label a plan summary uses for one axis value. */
export const CONVERSION_VALUE_LABEL = {
  processing: PROCESSING_LABEL,
  population: POPULATION_LABEL,
  precision: PRECISION_LABEL,
  compression: COMPRESSION_LABEL,
} as const;

/** What one radio is described by: its disclosure, and any refusal before it. */
function choiceNote<A extends ConversionAxis>(
  axis: A,
  value: ConversionAxisValues[A],
  state: ConversionChoiceState,
): string {
  const disclosure = noteFor(axis, value);
  return state.status === "unavailable"
    ? `${REFUSAL_NOTE[state.reason]} ${disclosure}`
    : disclosure;
}

/**
 * The controls for the next conversion.
 *
 * Four native radio groups over one selection. Each group edits one scientific
 * dimension and nothing else: choosing a value either selects the admitted
 * combination that differs from the current one in exactly that dimension, or
 * is refused with a reason. Nothing here searches for another admitted row that
 * happens to contain the value, which is what would silently change a precision
 * the reader had chosen while they were deciding about compression.
 *
 * Unavailable values stay on screen, disabled, with the reason beside them.
 * Removing them would hide the shape of the evidence: that these dimensions do
 * not compose freely is a fact about what has been measured, and a reader
 * choosing conversion settings is entitled to see it.
 *
 * **The chosen combination being unrunnable is said once, above the groups.**
 * All four show the same selection, so a per-control sentence would say the
 * same thing four times — and three of those would sit beside values this build
 * offers, which is a false statement placed beside a working control.
 */
export function ConversionSettings({
  configuration,
  onChoose,
  refusalNoticeId,
}: {
  readonly configuration: ConversionConfigurationView;
  readonly onChoose: (intentId: string) => void;
  /**
   * The panel notice this read's refusal is explained by, where one is
   * rendered.
   *
   * Handed down rather than minted here. A running conversion refuses this read
   * and a conversion alike, and it is one fact: the panel owns the element that
   * states it, and this control points at that element. A second copy emitted
   * here -- which is what shipped before -- put two nodes under one fact's name
   * and left both `aria-describedby` targets ambiguous.
   */
  readonly refusalNoticeId: string | null;
}): ReactElement | null {
  const held = configuration.configuration;
  if (held === null || held.configuration === "unattempted") {
    // Nothing is claimed either way. `null` is this document holding nothing
    // for the binding on screen and asking; `unattempted` is Rust saying the
    // catalog is unread. Both are "not yet", and both are about to be answered.
    return (
      <div className="conversion-settings" data-settings-state="loading">
        <p className="quiet-text">
          Reading which conversion settings this ProteoWizard offers…
        </p>
        {configuration.retryOffered ? (
          <RetryControl configuration={configuration} refusalNoticeId={refusalNoticeId} />
        ) : null}
      </div>
    );
  }
  if (held.configuration === "unavailableForBinding") {
    // Nothing is said here. The panel already explains that this session has no
    // usable ProteoWizard, and a second sentence saying the same thing beside
    // an empty space would be the panel telling a reader twice.
    return null;
  }
  if (held.configuration === "failed") {
    // **A read that answered unusably is not a build that offers nothing.**
    // Nothing else will ask again: the installation has not changed, so
    // everything keyed on it correctly stays where it is, and a `Check again`
    // that resolves the same build answers a different question truthfully.
    // Without this control a build whose help will not parse would refuse every
    // conversion for the life of the session.
    return (
      <div className="conversion-settings" data-settings-state="failed">
        <p className="quiet-text" id={SETTINGS_FAILURE_ID}>
          {held.error.summary}
        </p>
        <RetryControl
          configuration={configuration}
          describedBy={SETTINGS_FAILURE_ID}
          refusalNoticeId={refusalNoticeId}
        />
      </div>
    );
  }
  const selectedId = configuration.selectedIntentId;
  const selected = selectedId === null ? null : catalogRow(held.catalog, selectedId);
  if (selected === null) {
    // The catalog does not hold the selection. Nothing is manufactured here:
    // the availability rule refuses the conversion and says why.
    return (
      <div className="conversion-settings" data-settings-state="failed">
        <p className="quiet-text">
          MSCanvas could not match the chosen conversion settings to this ProteoWizard build.
        </p>
      </div>
    );
  }
  const refusal = selectionRefusal(held.catalog, selected.intent.id);
  const unavailable = refusal !== null;
  const recovery = recoveryIntent(held.catalog, held.shipped, selected.intent.id);
  return (
    <div className="conversion-settings" data-settings-state="ready">
      {unavailable ? (
        <p className="conversion-settings-unavailable" id={SELECTION_UNAVAILABLE_ID} role="note">
          {SELECTION_UNAVAILABLE_NOTE[refusal]}
        </p>
      ) : null}
      {recovery === null ? null : (
        <div className="conversion-settings-recovery" role="note">
          <p id={RECOVERY_REASON_ID}>
            No single change to one of these settings reaches a combination this build can run.
          </p>
          <button
            aria-describedby={
              unavailable ? `${SELECTION_UNAVAILABLE_ID} ${RECOVERY_REASON_ID}` : RECOVERY_REASON_ID
            }
            className="link-button"
            onClick={() => {
              onChoose(recovery.intent.id);
            }}
            type="button"
          >
            Use the settings MSCanvas ships
          </button>
        </div>
      )}
      <dl className="metadata-list">
        <div>
          <dt>Format</dt>
          <dd>
            mzML
            <span className="conversion-setting-note"> {FORMAT_NOTE}</span>
          </dd>
        </div>
      </dl>
      {CONVERSION_AXES.map((axis) => (
        <AxisFieldset
          axis={axis}
          catalog={held.catalog}
          current={selected.intent}
          key={axis}
          onChoose={onChoose}
        />
      ))}
    </div>
  );
}

/**
 * The control that asks for the settings again.
 *
 * Offered only where there is an answer a read could improve on, and disabled
 * where the same admission the automatic read consults would refuse it. One
 * question, one answer, whoever asks.
 *
 * It renders no sentence of its own for that refusal. Two things describe this
 * button and they belong to different owners: the read's own failure, which is
 * this surface's, and the lane fact refusing it, which the panel states once for
 * every action it refuses. Both are named here; neither is minted here.
 */
function RetryControl({
  configuration,
  describedBy,
  refusalNoticeId,
}: {
  readonly configuration: ConversionConfigurationView;
  readonly describedBy?: string;
  readonly refusalNoticeId: string | null;
}): ReactElement | null {
  if (!configuration.retryOffered) {
    return null;
  }
  const describes = [describedBy, refusalNoticeId]
    .filter((id): id is string => id !== undefined && id !== null)
    .join(" ");
  return (
    <button
      aria-describedby={describes === "" ? undefined : describes}
      className="link-button"
      // The refusal itself, not the notice: a probe refused by another probe
      // renders no sentence anywhere -- this control is withdrawn for a probe's
      // duration rather than disabled -- and reading the id would let a refusal
      // with nothing to say re-enable a control the admission refuses.
      disabled={configuration.refusal !== null}
      onClick={configuration.retry}
      type="button"
    >
      Read the settings again
    </button>
  );
}

function AxisFieldset({
  axis,
  catalog,
  current,
  onChoose,
}: {
  readonly axis: ConversionAxis;
  readonly catalog: readonly ConversionCatalogRow[];
  readonly current: ConversionIntentDescriptor;
  readonly onChoose: (intentId: string) => void;
}): ReactElement {
  const choices = axisChoices(catalog, current, axis);
  return (
    <fieldset className="conversion-setting" data-axis={axis}>
      <legend>{AXIS_LEGEND[axis]}</legend>
      {choices.map(({ value, state }) => {
        const noteId = `conversion-choice-${axis}-${String(value)}`;
        return (
          <div className="conversion-setting-choice" data-choice-state={state.status} key={value}>
            <label>
              <input
                // A value the reader might try to choose and cannot is
                // `disabled`: out of the tab order, out of pointer reach,
                // refused to every route at once. The selected value is never
                // disabled -- whether the combination it belongs to can run is
                // a statement about that combination, said once above these
                // groups, and taking the group's tab stop away for it would
                // move focus somewhere the reader did not put it.
                aria-describedby={noteId}
                checked={state.status === "selected"}
                disabled={state.status === "unavailable"}
                name={`conversion-setting-${axis}`}
                onChange={() => {
                  // The handler refuses anything that is not selectable, so a
                  // synthesised change cannot reach a combination the control
                  // does not offer.
                  if (state.status === "selectable") {
                    onChoose(state.intentId);
                  }
                }}
                type="radio"
                value={value}
              />
              <span>{labelFor(axis, value)}</span>
            </label>
            <p className="conversion-setting-note" id={noteId}>
              {choiceNote(axis, value, state)}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
}
