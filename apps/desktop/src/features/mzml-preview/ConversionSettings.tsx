import { conversionErrorMessage } from "./conversionMessages";
import { useId, useState, type ReactElement, type ReactNode } from "react";

import { Button, Disclosure } from "../../components/ui";

import type { ConversionCatalogRow, ConversionIntentDescriptor, ConversionNumericPrecision } from "./contracts";
import { axisChoices, catalogRow, CONVERSION_AXES, recoveryIntent, selectionRefusal,
  type ConversionAxis, type ConversionAxisValues, type ConversionChoiceState } from "./conversionIntentSelection";
import type { ConversionConfigurationView } from "./useConversionConfiguration";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { MessageKey, MessageParameters, UiMessage } from "../preferences/i18n";

const AXIS_LABEL = { processing: "cnvProcessing", population: "cnvPopulation", precision: "cnvPrecision", compression: "cnvCompression" } as const;
export const CONVERSION_VALUE_LABEL = {
  processing: { no_additional_centroiding: "cnvNoCentroiding", unscoped_default_centroiding: "cnvCentroiding", vendor_centroiding_from_ms1: "cnvVendorCentroiding", vendor_centroiding_from_ms2: "cnvVendorCentroidingMs2" },
  population: { all: "cnvAllSpectra", ms1_only: "cnvMs1Only", ms2_only: "cnvMs2Only" },
  precision: { mz64_intensity32: "cnvMz64I32", mz64_intensity64: "cnvMz64I64", mz32_intensity32: "cnvMz32I32", mz32_intensity64: "cnvMz32I64" },
  compression: { zlib: "cnvZlib", none: "cnvUncompressed" },
} as const;
type StaticMessageKey = Exclude<MessageKey, keyof MessageParameters>;
// Only a value that changes what is written has a note; the others say nothing
// their label does not.
const NOTE: { readonly [A in ConversionAxis]: Partial<Record<ConversionAxisValues[A], StaticMessageKey>> } = {
  processing: { unscoped_default_centroiding: "cnvCentroidingNote", vendor_centroiding_from_ms1: "cnvVendorCentroidingNote", vendor_centroiding_from_ms2: "cnvVendorCentroidingMs2Note" },
  population: { ms1_only: "cnvMs1OnlyNote", ms2_only: "cnvMs2OnlyNote" },
  precision: { mz64_intensity32: "cnvMz64I32Note", mz32_intensity32: "cnvMz32I32Note", mz32_intensity64: "cnvMz32I64Note" },
  compression: {},
};
// Every centroiding replaces profile points. Thermo's two rows keep their
// whole note on screen in either view: it names the one family they accept.
const LOSSY_PROCESSING: ReadonlySet<string> = new Set(["unscoped_default_centroiding", "vendor_centroiding_from_ms1", "vendor_centroiding_from_ms2"]);
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

function note<A extends ConversionAxis>(axis: A, value: ConversionAxisValues[A], t: UiMessage): string | null {
  const key = NOTE[axis][value];
  return key === undefined ? null : t(key);
}

/**
 * The axes on which an intent differs from the settings MSCanvas ships, in
 * axis order; empty when the shipped row is not in the catalog.
 */
export function changedAxes(catalog: readonly ConversionCatalogRow[], shippedId: string, intent: ConversionIntentDescriptor): readonly ConversionAxis[] {
  const shipped = catalogRow(catalog, shippedId)?.intent;
  return shipped === undefined ? [] : CONVERSION_AXES.filter(axis => intent[axis] !== shipped[axis]);
}

function changedFromShipped(catalog: readonly ConversionCatalogRow[], shippedId: string, intent: ConversionIntentDescriptor): number {
  return changedAxes(catalog, shippedId, intent).length;
}

/** A value's label, for a summary that names what changed. */
export function axisValueLabel<A extends ConversionAxis>(axis: A, value: ConversionAxisValues[A], t: UiMessage): string {
  return label(axis, value, t);
}

/** What a stored precision rounds, or `null` when it rounds nothing. */
export function precisionNote(precision: ConversionNumericPrecision, t: UiMessage): string | null {
  return note("precision", precision, t);
}

export function ConversionSettings({ configuration, onChoose, refusalNoticeId, view, onViewChange }: {
  readonly configuration: ConversionConfigurationView;
  readonly onChoose: (intentId: string) => void;
  readonly refusalNoticeId: string | null;
  /**
   * Basic or Advanced, where a parent keeps it. The Conversion panel does, so
   * the reader's choice survives the settings leaving the screen while a queue
   * runs (PM9.4 R5); left out, the view is this component's own.
   */
  readonly view?: "basic" | "advanced";
  readonly onViewChange?: (view: "basic" | "advanced") => void;
}): ReactElement | null {
  const t = useUiMessages();
  const prefix = useId();
  const [ownAdvanced, setOwnAdvanced] = useState(false);
  const advanced = view === undefined ? ownAdvanced : view === "advanced";
  const setAdvanced = (next: boolean) => {
    if (onViewChange === undefined) setOwnAdvanced(next);
    else onViewChange(next ? "advanced" : "basic");
  };
  const failureId = `${prefix}-failure`;
  const unavailableId = `${prefix}-unavailable`;
  const held = configuration.configuration;
  // Refused rather than native-disabled, so the control stays a Tab stop whose
  // reason (the panel's availability notice) can be reached.
  const retry = (describedBy?: string) => configuration.retryOffered ? <Button
    variant="secondary" size="sm" refused={configuration.refusal !== null}
    aria-describedby={[describedBy, refusalNoticeId].filter(Boolean).join(" ") || undefined}
    onClick={() => configuration.retry()}
  >{t("cnvSettingsAgain")}</Button> : null;
  // The section names itself in every state, so the form reads as settings
  // before the catalog has arrived as well as after.
  const head = (controls?: ReactNode) => <div className="conversion-section-head">
    <h3>{t("cnvSettingsTitle")}</h3>{controls}
  </div>;
  if (held === null || held.configuration === "unattempted") return <div className="conversion-settings" data-settings-state="loading">
    {head()}<p className="quiet-text">{t("cnvSettingsLoading")}</p>{retry()}
  </div>;
  if (held.configuration === "unavailableForBinding") return null;
  if (held.configuration === "failed") return <div className="conversion-settings" data-settings-state="failed">
    {head()}
    <p className="quiet-text" id={failureId}>{held.error.kind === "capability_evidence_unavailable" ? t("cnvSettingsReadFailed") : conversionErrorMessage(held.error, t)}</p>
    {retry(failureId)}
  </div>;
  const selected = configuration.selectedIntentId === null ? null : catalogRow(held.catalog, configuration.selectedIntentId);
  if (selected === null) return <div className="conversion-settings" data-settings-state="failed">{head()}<p>{t("cnvSettingsMismatch")}</p></div>;
  const refusal = selectionRefusal(held.catalog, selected.intent.id);
  const recovery = recoveryIntent(held.catalog, held.shipped, selected.intent.id);
  // Why a choice is refused, said once for the whole form however many groups
  // it dims (rebuild review 9). Every refused control points at its sentence.
  const refusalPrefix = `${prefix}-choices`;
  const shownStates = [
    ...CONVERSION_AXES.flatMap(axis => axis === "precision"
      ? precisionGrid(held.catalog, selected.intent).flat().map(cell => cell.state)
      : axisChoices(held.catalog, selected.intent, axis).map(choice => choice.state)),
    ...(advanced ? axisChoices(held.catalog, selected.intent, "precision").map(choice => choice.state) : []),
  ];
  const refusalNotes = refusals(refusalPrefix, shownStates, t);
  const changed = changedFromShipped(held.catalog, held.shipped, selected.intent);
  return <div className="conversion-settings" data-settings-state="ready" data-settings-view={advanced ? "advanced" : "basic"}>
    {head()}
    {refusal === null ? null : <p className="conversion-settings-unavailable" data-selection-refusal={refusal} id={unavailableId} role="note">{t(SELECTION_REFUSAL[refusal])}</p>}
    {recovery === null ? null : <div className="conversion-settings-recovery">
      <Button variant="secondary" size="sm" aria-describedby={refusal === null ? undefined : unavailableId}
        onClick={() => onChoose(recovery.intent.id)}>{t("cnvRecoveryShipped")}</Button>
    </div>}
    {/* Label and control rows (direction A 2.2). Peaks stay tiles, because
        centroiding carries its loss; every other choice is a segmented row. */}
    <div className="conversion-settings-grid conversion-form">
      {/* One format exists, so it is stated rather than offered as a choice. */}
      <div className="conversion-form-row conversion-format">
        <span className="conversion-form-label">{t("cnvFormat")}</span>
        <strong>mzML</strong>
      </div>
      {CONVERSION_AXES.map(axis => axis === "precision"
        ? <PrecisionFields key={axis} catalog={held.catalog} current={selected.intent} onChoose={onChoose} refusalPrefix={refusalPrefix} />
        : <AxisFieldset key={axis} axis={axis} catalog={held.catalog} current={selected.intent} onChoose={onChoose} refusalPrefix={refusalPrefix} advanced={false} />)}
    </div>
    {/* Basic stays on screen; Advanced is one disclosure under it (direction
        A 2.2, C7) whose head counts what differs from the shipped settings.
        It holds the paired precisions, which reach a change of both widths at
        once that no single width step is admitted for. */}
    <div className="conversion-advanced">
      <Disclosure variant="secondary" open={advanced} onOpenChange={setAdvanced}
        label={<>{t("cnvAdvanced")}{changed === 0 ? null : <span className="conversion-advanced-count">{t("cnvChangedCount", { count: changed })}</span>}</>}>
        <AxisFieldset axis="precision" catalog={held.catalog} current={selected.intent} onChoose={onChoose} refusalPrefix={refusalPrefix} advanced />
      </Disclosure>
    </div>
    {/* Labelled, so the one sentence reads as being about the dimmed choices
        rather than as the note of whichever group it happens to sit under. */}
    {refusalNotes.length === 0 ? null : <div className="conversion-settings-refusals">
      <p className="conversion-settings-refusals-label">{t("cnvRefusedChoices")}</p>
      <div>{refusalNotes}</div>
    </div>}
  </div>;
}

interface AxisProps {
  readonly catalog: readonly ConversionCatalogRow[];
  readonly current: ConversionIntentDescriptor;
  readonly onChoose: (intentId: string) => void;
  /** Where the form's one sentence per refusal reason is named. */
  readonly refusalPrefix: string;
}

function AxisFieldset({ axis, catalog, current, onChoose, refusalPrefix, advanced }: AxisProps & { readonly axis: ConversionAxis; readonly advanced: boolean }) {
  const t = useUiMessages();
  const prefix = useId();
  const choices = axisChoices(catalog, current, axis);
  // Tiles where a choice carries its loss on the choice itself (centroiding,
  // and the four paired precisions of the advanced view); a segmented row for
  // the rest (B7), with any loss said under the row.
  const tiles = axis === "processing" || axis === "precision";
  const rows = choices.map(({ value, state }) => {
    const noteId = `${prefix}-${value}`;
    // Possible information loss stays beside the choice in either view.
    // Secondary explanation is disclosed without changing the intent.
    const lossWarning = LOSSY_PROCESSING.has(value) || (state.status === "selected" && (value === "ms1_only" || value === "ms2_only"));
    const disclosure = advanced || lossWarning ? note(axis, value, t) : null;
    const describedBy = [refusalId(refusalPrefix, state), disclosure === null ? undefined : noteId].filter(Boolean).join(" ") || undefined;
    return { value, state, noteId, disclosure, text: label(axis, value, t), input: <ChoiceRadio className={tiles ? undefined : "visually-hidden"} name={`${prefix}-${axis}`} value={value} state={state} describedBy={describedBy} onChoose={onChoose} /> };
  });
  return <fieldset className="conversion-setting conversion-form-row" data-axis={axis}>
    <legend className="conversion-form-label">{t(AXIS_LABEL[axis])}</legend>
    {tiles ? <div className="conversion-tiles">
      {rows.map(({ value, state, noteId, disclosure, text, input }) => {
        // Centroiding says "Lossy" on its tile; the whole sentence is its
        // description, and on screen only in the advanced view.
        const tagged = LOSSY_PROCESSING.has(value);
        return <div className="conversion-setting-choice" data-choice-state={state.status} key={value}>
          {/* The tag sits beside the label, not in it, so the choice keeps its
              name; its description says the loss in full. */}
          <label>{input}{text}</label>
          {tagged ? <span className="conversion-lossy" aria-hidden="true">{t("cnvLossy")}</span> : null}
          {disclosure === null ? null : <p className={value === "unscoped_default_centroiding" && !advanced ? "conversion-setting-note visually-hidden" : "conversion-setting-note"} id={noteId}>{disclosure}</p>}
        </div>;
      })}
    </div> : <>
      <div className="conversion-segments-track">
        {rows.map(({ value, state, text, input }) => <label className="conversion-segment" data-choice-state={state.status} key={value}>{input}{text}</label>)}
      </div>
      {rows.map(({ value, noteId, disclosure }) => disclosure === null ? null : <p className="conversion-setting-note" id={noteId} key={value}>{disclosure}</p>)}
    </>}
  </fieldset>;
}

/**
 * One choice's native radio. A value that cannot be chosen stays on screen
 * and focusable, refused (`aria-disabled`) with its reason, never natively
 * disabled (B4): a press or an arrow key that lands on it changes nothing,
 * because only a selectable value calls the chooser and the checked value is
 * controlled.
 */
function ChoiceRadio({ name, value, state, describedBy, onChoose, className }: {
  readonly name: string; readonly value: string; readonly state: ConversionChoiceState;
  readonly describedBy: string | undefined; readonly onChoose: (intentId: string) => void; readonly className?: string;
}) {
  return <input type="radio" className={className} name={name} value={value} checked={state.status === "selected"}
    aria-disabled={state.status === "unavailable" || undefined} aria-describedby={describedBy}
    onChange={() => { if (state.status === "selectable") onChoose(state.intentId); }} />;
}

/** The group's note a refused value points at, or `undefined` for a value that is not refused. */
function refusalId(prefix: string, state: ConversionChoiceState): string | undefined {
  return state.status === "unavailable" ? `${prefix}-refusal-${state.reason}` : undefined;
}

/** Each refusal said once for the form, however many values it refuses. */
function refusals(prefix: string, states: readonly ConversionChoiceState[], t: UiMessage): ReactElement[] {
  const reasons = [...new Set(states.flatMap(state => state.status === "unavailable" ? [state.reason] : []))];
  return reasons.map(reason => <p className="conversion-setting-note" id={`${prefix}-refusal-${reason}`} key={reason}>{t(REFUSAL[reason])}</p>);
}

/** Per array, each width and what choosing it with the other array's current width would do. */
function precisionGrid(catalog: readonly ConversionCatalogRow[], current: ConversionIntentDescriptor) {
  const choices = axisChoices(catalog, current, "precision");
  const currentWidths = WIDTHS[current.precision];
  return ([0, 1] as const).map(index => ([32, 64] as const).map(width => {
    const target = choices.find(choice => WIDTHS[choice.value][index] === width && WIDTHS[choice.value][1 - index] === currentWidths[1 - index]);
    const state: ConversionChoiceState = target?.state ?? { status: "unavailable", reason: "notQualified" };
    return { width, state };
  }));
}

function PrecisionFields({ catalog, current, onChoose, refusalPrefix }: AxisProps) {
  const t = useUiMessages();
  const prefix = useId();
  const selectedNote = note("precision", current.precision, t);
  const selectedId = selectedNote === null ? undefined : `${prefix}-selected`;
  const grid = precisionGrid(catalog, current);
  return <fieldset className="conversion-setting conversion-form-row" data-axis="precision">
    <legend className="conversion-form-label">{t("cnvPrecision")}</legend>
    <div className="conversion-precision-fields">
      {/* Native radios drawn as a segmented pair: an unavailable width stays on
          screen, refused rather than disabled, and points at the form's
          reason for it. */}
      {grid.map((widths, index) => <fieldset className="conversion-segments" key={index}>
        <legend>{t(index === 0 ? "cnvMz" : "cnvIntensity")}</legend>
        <div className="conversion-segments-track">
          {widths.map(({ width, state }) => <label className="conversion-segment" data-choice-state={state.status} key={width}>
            <ChoiceRadio className="visually-hidden" name={`${prefix}-${index}`} value={String(width)} state={state}
              describedBy={refusalId(refusalPrefix, state) ?? selectedId} onChoose={onChoose} />{t(width === 32 ? "cnv32Bit" : "cnv64Bit")}</label>)}
        </div>
      </fieldset>)}
    </div>
    {selectedNote === null ? null : <p className="conversion-setting-note" id={selectedId}>{selectedNote}</p>}
  </fieldset>;
}
