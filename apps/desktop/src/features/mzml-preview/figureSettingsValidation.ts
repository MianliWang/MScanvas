import { en } from "../preferences/locales/en";

export type NumericFigureField = "widthPx" | "heightPx" | "pngDpi";
export interface FigureSettingProblem {
  readonly code: string;
  readonly fields: readonly NumericFigureField[];
}
export interface FigureSettingsValidation {
  readonly render: FigureSettingProblem | null;
  readonly dpi: FigureSettingProblem | null;
}

/** Same positive-integer editing grammar as the existing figure boundary. */
export function wholeCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Structured presentation reasons, without duplicating Rust's range validator. */
export function validateFigureDraft(draft: Readonly<Record<NumericFigureField, string>>): FigureSettingsValidation {
  const fields = (["widthPx", "heightPx"] as const).filter((field) => wholeCount(draft[field]) === null);
  return {
    render: fields.length === 0 ? null : { code: "FIGURE_WHOLE_COUNT", fields },
    dpi: wholeCount(draft.pngDpi) === null ? { code: "FIGURE_WHOLE_COUNT", fields: ["pngDpi"] } : null,
  };
}

export function figureProblemMessageKey(problem: FigureSettingProblem): "invalidWidth" | "invalidHeight" | "invalidDimensions" | "invalidDpi" | "unknownFigureProblem" {
  if (problem.code !== "FIGURE_WHOLE_COUNT") return "unknownFigureProblem";
  if (problem.fields.length === 2 && problem.fields.includes("widthPx") && problem.fields.includes("heightPx")) return "invalidDimensions";
  if (problem.fields.length !== 1) return "unknownFigureProblem";
  switch (problem.fields[0]) {
    case "widthPx": return "invalidWidth";
    case "heightPx": return "invalidHeight";
    case "pngDpi": return "invalidDpi";
    default: return "unknownFigureProblem";
  }
}

/** Existing unlocalized gate summaries keep their English contract. */
export function describeFigureProblem(problem: FigureSettingProblem | null): string | null {
  if (problem === null) return null;
  const key = figureProblemMessageKey(problem);
  return key === "unknownFigureProblem" ? `Figure settings unavailable (${problem.code}).` : en[key];
}
