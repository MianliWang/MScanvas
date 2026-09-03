import type { ReactElement } from "react";

import type {
  ConversionCompression,
  ConversionIntent,
  ConversionNumericPrecision,
  ConversionProcessing,
  ConversionSpectrumPopulation,
} from "./contracts";
import type {
  ConversionAxis,
  ConversionAxisValues,
  ConversionChoiceRefusal,
  ConversionChoiceState,
  ConversionSettings as ConversionSettingsState,
} from "./conversionIntentSelection";
import { axisChoices, CONVERSION_AXES, selectedIntent } from "./conversionIntentSelection";

/**
 * What each axis is called where the user meets it.
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
  noAdditionalCentroiding: "No additional centroiding",
  unscopedDefaultCentroiding: "Centroid all MS levels",
};

const POPULATION_LABEL: Record<ConversionSpectrumPopulation, string> = {
  all: "All spectra",
  ms1Only: "MS1 spectra only",
  ms2Only: "MS2 spectra only",
};

/**
 * Precision named as a pair, because a pair is what is chosen.
 *
 * The two widths are never offered as separate controls. Which pairs exist is a
 * measured fact, and two free controls would be a cross-product this product
 * has no evidence for.
 */
const PRECISION_LABEL: Record<ConversionNumericPrecision, string> = {
  mz64Intensity32: "m/z 64-bit · intensity 32-bit",
  mz64Intensity64: "m/z 64-bit · intensity 64-bit",
  mz32Intensity32: "m/z 32-bit · intensity 32-bit",
  mz32Intensity64: "m/z 32-bit · intensity 64-bit",
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
  noAdditionalCentroiding:
    "MSCanvas adds no peak picking. Profile spectra are converted as the instrument recorded them.",
  unscopedDefaultCentroiding:
    "Lossy. Default local-maximum peak picking replaces the recorded profile points, and the profile cannot be recovered from the converted file. It applies to every MS level and cannot be limited to one.",
};

const POPULATION_NOTE: Record<ConversionSpectrumPopulation, string> = {
  all: "Every spectrum in the acquisition is converted.",
  ms1Only: "MS2 and higher spectra are left out of the converted file.",
  ms2Only: "MS1 spectra, and anything above MS2, are left out of the converted file.",
};

const PRECISION_NOTE: Record<ConversionNumericPrecision, string> = {
  mz64Intensity32:
    "The precision MSCanvas converts with today. Intensities are stored at 32-bit, which rounds their values.",
  mz64Intensity64: "Both arrays are stored at 64-bit. Nothing is rounded by the stored width.",
  mz32Intensity32:
    "Both arrays are stored at 32-bit, which rounds m/z values and intensity values.",
  mz32Intensity64: "m/z values are stored at 32-bit, which rounds them.",
};

const COMPRESSION_NOTE: Record<ConversionCompression, string> = {
  zlib: "The stored arrays are packed. The numbers written are the same either way.",
  none: "Larger files. The numbers written are the same either way.",
};

/** Why a value cannot be chosen, in terms of what the reader can do about it. */
const REFUSAL_NOTE: Record<ConversionChoiceRefusal, string> = {
  "not-qualified":
    "Not available with the other settings you have chosen: MSCanvas has not qualified that combination.",
  "unsupported-by-installation":
    "The installed ProteoWizard build does not offer this option.",
};

/**
 * The one output format, stated rather than offered.
 *
 * mzXML is not a disabled control here. A disabled control advertises a route,
 * and this product has measured that route producing a file that silently drops
 * spectra; whether it ever returns is a later decision with its own evidence.
 */
const FORMAT_NOTE = "mzML is the format MSCanvas has qualified, and the only one it writes.";

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
 * The reduced-information disclosures one semantic carries, and only those.
 *
 * Assembled from the choice itself rather than written once per summary, so the
 * sentence beside a plan and the sentence beside the control it came from are
 * the same claim. A semantic that reduces nothing produces an empty list and
 * therefore no reassuring sentence: silence is the honest answer where there is
 * nothing to disclose.
 */
export function conversionIntentDisclosures(intent: ConversionIntent): readonly string[] {
  const disclosures: string[] = [];
  if (intent.processing === "unscopedDefaultCentroiding") {
    disclosures.push(PROCESSING_NOTE.unscopedDefaultCentroiding);
  }
  if (intent.population !== "all") {
    disclosures.push(POPULATION_NOTE[intent.population]);
  }
  if (intent.precision !== "mz64Intensity64") {
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

/** What one radio is described by: its disclosure, and any refusal. */
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
 * semantic that differs from the current one in exactly that dimension, or is
 * refused with a reason. Nothing here searches for another admitted row that
 * happens to contain the value, which is what would silently change a
 * precision the user had chosen while they were deciding about compression.
 *
 * Unavailable values stay on screen, disabled, with the reason beside them.
 * Removing them would hide the shape of the evidence: that these dimensions do
 * not compose freely is a fact about what has been measured, and a reader
 * choosing conversion settings is entitled to see it.
 */
export function ConversionSettings({
  settings,
  onChoose,
}: {
  readonly settings: ConversionSettingsState;
  readonly onChoose: (intentId: string) => void;
}): ReactElement | null {
  if (settings.status === "loading") {
    return (
      <div className="conversion-settings" data-settings-state="loading">
        <p className="quiet-text">Reading which conversion settings this ProteoWizard offers…</p>
      </div>
    );
  }
  if (settings.status === "failed") {
    return (
      <div className="conversion-settings" data-settings-state="failed">
        <p className="quiet-text">{settings.error.summary}</p>
      </div>
    );
  }
  const current = selectedIntent(settings);
  if (current === null) {
    // The catalog no longer holds the selection. Nothing is manufactured here:
    // the availability rule refuses the conversion and says why.
    return (
      <div className="conversion-settings" data-settings-state="failed">
        <p className="quiet-text">
          MSCanvas could not match the chosen conversion settings to this ProteoWizard build.
        </p>
      </div>
    );
  }

  return (
    <div className="conversion-settings" data-settings-state="ready">
      <dl className="metadata-list">
        <div>
          <dt>Format</dt>
          <dd>
            {current.format}
            <span className="conversion-setting-note"> {FORMAT_NOTE}</span>
          </dd>
        </div>
      </dl>
      {CONVERSION_AXES.map((axis) => (
        <AxisFieldset axis={axis} current={current} key={axis} onChoose={onChoose} settings={settings} />
      ))}
    </div>
  );
}

function AxisFieldset({
  axis,
  current,
  settings,
  onChoose,
}: {
  readonly axis: ConversionAxis;
  readonly current: ConversionIntent;
  readonly settings: Extract<ConversionSettingsState, { status: "ready" }>;
  readonly onChoose: (intentId: string) => void;
}): ReactElement {
  const choices = axisChoices(settings.catalog, current, axis);
  return (
    <fieldset className="conversion-setting" data-axis={axis}>
      <legend>{AXIS_LEGEND[axis]}</legend>
      {choices.map(({ value, state }) => {
        const noteId = `conversion-choice-${axis}-${value}`;
        return (
          <div
            className="conversion-setting-choice"
            data-choice-state={state.status}
            key={value}
          >
            <label>
              <input
                aria-describedby={noteId}
                checked={state.status === "selected"}
                // A refused value is refused to every route at once. The
                // attribute takes it out of the tab order and out of pointer
                // reach; the handler below refuses it again, so a synthesised
                // change cannot select what no control would offer.
                disabled={state.status === "unavailable"}
                name={`conversion-setting-${axis}`}
                onChange={() => {
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
