import { conversionErrorMessage } from "./conversionMessages";
import { useId, useState, type ReactElement } from "react";

import type { ConversionCatalogRow, ConversionIntentDescriptor, ConversionNumericPrecision } from "./contracts";
import { axisChoices, catalogRow, CONVERSION_AXES, recoveryIntent, selectionRefusal,
  type ConversionAxis, type ConversionAxisValues, type ConversionChoiceState } from "./conversionIntentSelection";
import type { ConversionConfigurationView } from "./useConversionConfiguration";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";

const AXIS_LABEL = { processing: "cnvProcessing", population: "cnvPopulation", precision: "cnvPrecision", compression: "cnvCompression" } as const;
export const CONVERSION_VALUE_LABEL = {
  processing: { no_additional_centroiding: "cnvNoCentroiding", unscoped_default_centroiding: "cnvCentroiding" },
  population: { all: "cnvAllSpectra", ms1_only: "cnvMs1Only", ms2_only: "cnvMs2Only" },
  precision: { mz64_intensity32: "cnvMz64I32", mz64_intensity64: "cnvMz64I64", mz32_intensity32: "cnvMz32I32", mz32_intensity64: "cnvMz32I64" },
  compression: { zlib: "cnvZlib", none: "cnvUncompressed" },
} as const;
const NOTE = {
  processing: { no_additional_centroiding: "cnvNoCentroidingNote", unscoped_default_centroiding: "cnvCentroidingNote" },
  population: { all: "cnvAllSpectraNote", ms1_only: "cnvMs1OnlyNote", ms2_only: "cnvMs2OnlyNote" },
  precision: { mz64_intensity32: "cnvMz64I32Note", mz64_intensity64: "cnvMz64I64Note", mz32_intensity32: "cnvMz32I32Note", mz32_intensity64: "cnvMz32I64Note" },
  compression: { zlib: "cnvZlibNote", none: "cnvUncompressedNote" },
} as const;
const REFUSAL = { notQualified: "cnvNotQualified", unavailableHere: "cnvUnavailableHere", notEvidencedForSources: "cnvNotEvidenced" } as const;
const SELECTION_REFUSAL = { notQualified: "cnvSelectionUnqualified", unavailableHere: "cnvSelectionUnavailable", notEvidencedForSources: "cnvSelectionNotEvidenced" } as const;

// This only describes the paired enum. Admission always comes from axisChoices;
// no independently selected widths are combined into an intent or request.
const WIDTHS: Record<ConversionNumericPrecision, readonly [32 | 64, 32 | 64]> = {
  mz64_intensity32: [64, 32], mz64_intensity64: [64, 64], mz32_intensity32: [32, 32], mz32_intensity64: [32, 64],
};

function label<A extends ConversionAxis>(axis: A, value: ConversionAxisValues[A], t: UiMessage): string {
  switch (axis) {
    case "processing": return t(CONVERSION_VALUE_LABEL.processing[value as ConversionAxisValues["processing"]]);
    case "population": return t(CONVERSION_VALUE_LABEL.population[value as ConversionAxisValues["population"]]);
    case "precision": return t(CONVERSION_VALUE_LABEL.precision[value as ConversionAxisValues["precision"]]);
    case "compression": return t(CONVERSION_VALUE_LABEL.compression[value as ConversionAxisValues["compression"]]);
  }
}

function note<A extends ConversionAxis>(axis: A, value: ConversionAxisValues[A], t: UiMessage): string {
  switch (axis) {
    case "processing": return t(NOTE.processing[value as ConversionAxisValues["processing"]]);
    case "population": return t(NOTE.population[value as ConversionAxisValues["population"]]);
    case "precision": return t(NOTE.precision[value as ConversionAxisValues["precision"]]);
    case "compression": return t(NOTE.compression[value as ConversionAxisValues["compression"]]);
  }
}

/** The actual reductions in the reviewed intent, not the next control draft. */
export function conversionIntentDisclosures(intent: ConversionIntentDescriptor, t: UiMessage): readonly string[] {
  const result: string[] = [];
  if (intent.processing === "unscoped_default_centroiding") result.push(note("processing", intent.processing, t));
  if (intent.population !== "all") result.push(note("population", intent.population, t));
  if (intent.precision !== "mz64_intensity64") result.push(note("precision", intent.precision, t));
  return result;
}

export function ConversionSettings({ configuration, onChoose, refusalNoticeId }: {
  readonly configuration: ConversionConfigurationView;
  readonly onChoose: (intentId: string) => void;
  readonly refusalNoticeId: string | null;
}): ReactElement | null {
  const t = useUiMessages();
  const prefix = useId();
  const [advanced, setAdvanced] = useState(false);
  const failureId = `${prefix}-failure`;
  const unavailableId = `${prefix}-unavailable`;
  const recoveryId = `${prefix}-recovery`;
  const held = configuration.configuration;
  const retry = (describedBy?: string) => configuration.retryOffered ? <button
    className="link-button" type="button" disabled={configuration.refusal !== null}
    aria-describedby={[describedBy, refusalNoticeId].filter(Boolean).join(" ") || undefined}
    onClick={() => { if (configuration.refusal === null) configuration.retry(); }}
  >{t("cnvSettingsAgain")}</button> : null;
  if (held === null || held.configuration === "unattempted") return <div className="conversion-settings" data-settings-state="loading">
    <p className="quiet-text">{t("cnvSettingsLoading")}</p>{retry()}
  </div>;
  if (held.configuration === "unavailableForBinding") return null;
  if (held.configuration === "failed") return <div className="conversion-settings" data-settings-state="failed">
    <p className="quiet-text" id={failureId}>{held.error.kind === "capability_evidence_unavailable" ? t("cnvSettingsReadFailed") : conversionErrorMessage(held.error, t)}</p>
    {retry(failureId)}
  </div>;
  const selected = configuration.selectedIntentId === null ? null : catalogRow(held.catalog, configuration.selectedIntentId);
  if (selected === null) return <div className="conversion-settings" data-settings-state="failed"><p>{t("cnvSettingsMismatch")}</p></div>;
  const refusal = selectionRefusal(held.catalog, selected.intent.id);
  const recovery = recoveryIntent(held.catalog, held.shipped, selected.intent.id);
  return <div className="conversion-settings" data-settings-state="ready" data-settings-view={advanced ? "advanced" : "basic"}>
    <div className="conversion-settings-heading">
      <span><strong>{t("cnvFormat")}</strong> mzML</span>
      <div className="compact-choices" role="group" aria-label={t("cnvSettingsView")}>
        <button type="button" aria-pressed={!advanced} onClick={() => setAdvanced(false)}>{t("cnvBasic")}</button>
        <button type="button" aria-pressed={advanced} onClick={() => setAdvanced(true)}>{t("cnvAdvanced")}</button>
      </div>
    </div>
    {refusal === null ? null : <p className="conversion-settings-unavailable" data-selection-refusal={refusal} id={unavailableId} role="note">{t(SELECTION_REFUSAL[refusal])}</p>}
    {recovery === null ? null : <div className="conversion-settings-recovery" role="note">
      <p id={recoveryId}>{t("cnvRecoveryReason")}</p>
      <button type="button" className="link-button" aria-describedby={[refusal === null ? null : unavailableId, recoveryId].filter(Boolean).join(" ")}
        onClick={() => onChoose(recovery.intent.id)}>{t("cnvRecoveryShipped")}</button>
    </div>}
    {advanced ? <p className="quiet-text">{t("cnvFormatNote")}</p> : null}
    <div className="conversion-settings-grid">
      {CONVERSION_AXES.map(axis => axis === "precision" && !advanced
        ? <PrecisionFields key={axis} catalog={held.catalog} current={selected.intent} onChoose={onChoose} />
        : <AxisFieldset key={axis} axis={axis} catalog={held.catalog} current={selected.intent} onChoose={onChoose} advanced={advanced} />)}
    </div>
  </div>;
}

interface AxisProps {
  readonly catalog: readonly ConversionCatalogRow[];
  readonly current: ConversionIntentDescriptor;
  readonly onChoose: (intentId: string) => void;
}

function AxisFieldset({ axis, catalog, current, onChoose, advanced }: AxisProps & { readonly axis: ConversionAxis; readonly advanced: boolean }) {
  const t = useUiMessages();
  const prefix = useId();
  return <fieldset className="conversion-setting" data-axis={axis}>
    <legend>{t(AXIS_LABEL[axis])}</legend>
    {axisChoices(catalog, current, axis).map(({ value, state }) => {
      const noteId = `${prefix}-${value}`;
      // Refusals and possible information loss stay beside the choice in either
      // view. Secondary explanation is disclosed without changing the intent.
      const lossWarning = value === "unscoped_default_centroiding" || (state.status === "selected" && (value === "ms1_only" || value === "ms2_only"));
      const showNote = advanced || state.status === "unavailable" || lossWarning;
      const disclosure = note(axis, value, t);
      return <div className="conversion-setting-choice" data-choice-state={state.status} key={value}>
        <label><input type="radio" name={`${prefix}-${axis}`} value={value} checked={state.status === "selected"}
          disabled={state.status === "unavailable"} aria-describedby={showNote ? noteId : undefined}
          onChange={() => { if (state.status === "selectable") onChoose(state.intentId); }} />{label(axis, value, t)}</label>
        {showNote ? <p className="conversion-setting-note" id={noteId}>
          {state.status === "unavailable" ? t(REFUSAL[state.reason]) : ""}{advanced || lossWarning ? ` ${disclosure}` : ""}
        </p> : null}
      </div>;
    })}
  </fieldset>;
}

function PrecisionFields({ catalog, current, onChoose }: AxisProps) {
  const t = useUiMessages();
  const prefix = useId();
  const choices = axisChoices(catalog, current, "precision");
  const currentWidths = WIDTHS[current.precision];
  return <fieldset className="conversion-setting" data-axis="precision">
    <legend>{t("cnvPrecision")}</legend>
    <div className="conversion-precision-fields">
      {([0, 1] as const).map(index => <fieldset className="compact-choices" key={index}>
        <legend>{t(index === 0 ? "cnvMz" : "cnvIntensity")}</legend>
        {([32, 64] as const).map(width => {
          const target = choices.find(choice => WIDTHS[choice.value][index] === width && WIDTHS[choice.value][1 - index] === currentWidths[1 - index]);
          const state: ConversionChoiceState = target?.state ?? { status: "unavailable", reason: "notQualified" };
          const id = `${prefix}-${index}-${width}`;
          return <div className="conversion-setting-choice" data-choice-state={state.status} key={width}>
            <label><input type="radio" name={`${prefix}-${index}`} checked={state.status === "selected"}
              disabled={state.status === "unavailable"} aria-describedby={state.status === "unavailable" ? id : `${prefix}-selected`}
              onChange={() => { if (state.status === "selectable") onChoose(state.intentId); }} />{t(width === 32 ? "cnv32Bit" : "cnv64Bit")}</label>
            {state.status === "unavailable" ? <p className="conversion-setting-note" id={id}>{t(REFUSAL[state.reason])}</p> : null}
          </div>;
        })}
      </fieldset>)}
    </div>
    <p className="conversion-setting-note" id={`${prefix}-selected`}>{note("precision", current.precision, t)}</p>
    <p className="quiet-text">{t("cnvPrecisionPairsHelp")}</p>
  </fieldset>;
}
