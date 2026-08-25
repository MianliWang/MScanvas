/**
 * The settings every figure output is drawn with, as one set of controls.
 *
 * Two surfaces export figures now -- the selected spectrum and the
 * chromatogram -- and they are drawn by the same Rust renderer at the same size
 * in the same theme. One component rather than two, because a second copy of
 * these fields would be a second place for the validation, the wording and the
 * `aria` wiring to drift, and a reader who learned one panel would have to
 * learn the other.
 *
 * It decides nothing. The draft, the two problem sentences and both callbacks
 * belong to the workspace; this file lays them out and says which field each
 * correction belongs to.
 *
 * **Every identifier is prefixed**, because both panels can be on screen at
 * once. Two elements sharing an `id`, or two radio groups sharing a `name`,
 * would leave a label pointing at the wrong control and one theme choice
 * silently changing the other -- and neither is visible to a reader who is not
 * looking for it.
 */

import type { FigureTheme } from "./contracts";
import type { FigureSettingsDraft, FigureSettingsField } from "./usePreviewWorkspace";

const FIGURE_THEMES: readonly { readonly theme: FigureTheme; readonly label: string }[] = [
  { theme: "light", label: "Light" },
  { theme: "dark", label: "Dark" },
];

const SETTING_FIELDS: readonly {
  readonly field: FigureSettingsField;
  readonly label: string;
  readonly hint: string;
  /** Which of the two problem messages describes this field. */
  readonly problem: "render" | "dpi";
}[] = [
  { field: "widthPx", label: "Width", hint: "px", problem: "render" },
  { field: "heightPx", label: "Height", hint: "px", problem: "render" },
  { field: "pngDpi", label: "PNG DPI", hint: "PNG metadata only", problem: "dpi" },
];

/** Where this panel's settings problems are announced. */
export function renderProblemId(prefix: string): string {
  return `${prefix}-figure-problem`;
}

export function dpiProblemId(prefix: string): string {
  return `${prefix}-figure-dpi-problem`;
}

export interface FigureSettingsFieldsProps {
  /** What every identifier in this group is named after. */
  readonly idPrefix: string;
  readonly settings: FigureSettingsDraft;
  readonly renderSettingsProblem: string | null;
  readonly pngDpiProblem: string | null;
  readonly onFigureSetting: (field: FigureSettingsField, value: string) => void;
  readonly onFigureTheme: (theme: FigureTheme) => void;
}

export function FigureSettingsFields({
  idPrefix,
  settings,
  renderSettingsProblem,
  pngDpiProblem,
  onFigureSetting,
  onFigureTheme,
}: FigureSettingsFieldsProps) {
  const problems = { render: renderSettingsProblem, dpi: pngDpiProblem };
  const problemIds = { render: renderProblemId(idPrefix), dpi: dpiProblemId(idPrefix) };
  const themeLabelId = `${idPrefix}-figure-theme-label`;

  return (
    <fieldset className="spectrum-figure-settings">
      <legend>Figure</legend>
      {SETTING_FIELDS.map(({ field, label, hint, problem }) => (
        <label className="spectrum-figure-field" key={field}>
          <span>
            {label} <span className="spectrum-figure-hint">{hint}</span>
          </span>
          <input
            // Its own problem, not whichever one exists. A width that is
            // perfectly fine must not be marked invalid because a resolution
            // beside it is not, and a reader who lands on it must not be read a
            // correction that belongs to another field.
            aria-describedby={problems[problem] === null ? undefined : problemIds[problem]}
            aria-invalid={problems[problem] === null ? undefined : true}
            className="spectrum-figure-input"
            inputMode="numeric"
            // Text rather than `number`, so what the field holds is what the
            // user typed. A number input silently discards what it cannot
            // parse, which would leave the panel unable to say why an action is
            // unavailable.
            onChange={(event) => {
              onFigureSetting(field, event.target.value);
            }}
            type="text"
            value={settings[field]}
          />
        </label>
      ))}
      <div className="spectrum-figure-field">
        <span id={themeLabelId}>Theme</span>
        {/*
          Two radios rather than a swatch. Which theme is selected has to be
          readable without seeing colour, and the words are the same ones the
          exported file records.
        */}
        <div aria-labelledby={themeLabelId} className="spectrum-figure-themes" role="radiogroup">
          {FIGURE_THEMES.map(({ theme, label }) => (
            <label className="spectrum-figure-theme" key={theme}>
              <input
                checked={settings.theme === theme}
                name={`${idPrefix}-figure-theme`}
                onChange={() => {
                  onFigureTheme(theme);
                }}
                type="radio"
                value={theme}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      {/*
        A live region, but not a second `status` landmark: the export result is
        the panel's status, and two of them would leave a reader -- and a
        test -- asking which one "the status" is. The fields point at this with
        `aria-describedby`, so it is read when focus reaches them, and
        `aria-live` is what makes a correction announced as it happens.
      */}
      <p aria-live="polite" className="spectrum-figure-problem" id={problemIds.render}>
        {renderSettingsProblem ?? ""}
      </p>
      {/*
        The resolution's own region, for the same reason its field points at a
        separate one: it closes only `Export PNG…`, and a single sentence naming
        every unusable field would be read out beside an SVG button that nothing
        is stopping.
      */}
      <p aria-live="polite" className="spectrum-figure-problem" id={problemIds.dpi}>
        {pngDpiProblem ?? ""}
      </p>
    </fieldset>
  );
}
