import { ChoiceField } from "../../components/fields/ChoiceField";
import { RawTextField } from "../../components/fields/RawTextField";
import { SettingField } from "../../components/fields/SettingField";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { FigureTheme } from "./contracts";
import { figureProblemMessageKey, type FigureSettingProblem, type FigureSettingsValidation } from "./figureSettingsValidation";
import type { FigureSettingsDraft, FigureSettingsField } from "./usePreviewWorkspace";

export function renderProblemId(prefix: string): string { return `${prefix}-figure-problem`; }
export function dpiProblemId(prefix: string): string { return `${prefix}-figure-dpi-problem`; }

export interface FigureSettingsFieldsProps {
  /** Stable, distinct panel identity; never derived from the locale. */
  readonly idPrefix: string;
  readonly settings: FigureSettingsDraft;
  readonly validation: FigureSettingsValidation;
  readonly onFigureSetting: (field: FigureSettingsField, value: string) => void;
  readonly onFigureTheme: (theme: FigureTheme) => void;
}

/** Both panels edit the existing workspace owner through the same callbacks. */
export function FigureSettingsFields({ idPrefix, settings, validation, onFigureSetting, onFigureTheme }: FigureSettingsFieldsProps) {
  const message = useUiMessages();
  const problemIds = { render: renderProblemId(idPrefix), dpi: dpiProblemId(idPrefix) };
  const themeLabelId = `${idPrefix}-figure-theme-label`;
  const fields = [
    { field: "widthPx", label: "width", hint: "pixels", problem: "render" },
    { field: "heightPx", label: "height", hint: "pixels", problem: "render" },
    { field: "pngDpi", label: "pngDpi", hint: "dpiHelp", problem: "dpi" },
  ] as const;

  function describe(problem: FigureSettingProblem | null): string {
    if (problem === null) return "";
    const key = figureProblemMessageKey(problem);
    return key === "unknownFigureProblem" ? message(key, { code: problem.code }) : message(key);
  }

  return <fieldset className="spectrum-figure-settings">
    <legend>{message("figure")}</legend>
    {fields.map(({ field, label, hint, problem }) => {
      const issue = validation[problem];
      const invalid = issue?.fields.includes(field) === true;
      const labelId = `${idPrefix}-${field}-label`;
      return <SettingField key={field} labelId={labelId} htmlFor={`${idPrefix}-${field}`} label={message(label)} help={message(hint)} className="spectrum-figure-field">
        <RawTextField id={`${idPrefix}-${field}`} labelledBy={`${labelId} ${labelId}-help`}
          describedBy={invalid ? problemIds[problem] : undefined}
          invalid={invalid} value={settings[field]} onChange={(value) => onFigureSetting(field, value)} />
      </SettingField>;
    })}
    <SettingField labelId={themeLabelId} label={message("theme")} className="spectrum-figure-field">
      <ChoiceField labelledBy={themeLabelId} value={settings.theme}
        options={[{ value: "light", label: message("light") }, { value: "dark", label: message("dark") }]}
        onChange={onFigureTheme} />
    </SettingField>
    <p aria-live="polite" className="spectrum-figure-problem" id={problemIds.render} data-problem-code={validation.render?.code}>
      {describe(validation.render)}
    </p>
    <p aria-live="polite" className="spectrum-figure-problem" id={problemIds.dpi} data-problem-code={validation.dpi?.code}>
      {describe(validation.dpi)}
    </p>
  </fieldset>;
}
