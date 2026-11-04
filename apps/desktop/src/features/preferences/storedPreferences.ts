/**
 * The durable half of the UI preference contract, as this side sees it.
 *
 * One small versioned record with finite domains, mirroring exactly what Rust
 * stores. Nothing here locates a file, names a dataset or carries scientific
 * state, and nothing here is authority: a record read from the store cannot
 * open anything, and a record written to it cannot ask for anything to be
 * opened.
 *
 * The field groups are separate because they are committed from different
 * places in the interface. Settings commits appearance; the shell's panel
 * toggles commit layout. A commit that carried both would let one surface
 * publish the other's unapplied draft.
 */

import type { UiLocale, RosterDensity, SessionPreferences } from "./sessionPreferences";

/**
 * The schema this side consumes. Rust also reads schema 1 from disk, and answers
 * it as this one, so an older record never reaches here in its old shape.
 */
export const PREFERENCE_SCHEMA_VERSION = 2;

/**
 * What the user asked of one workspace panel.
 *
 * `automatic` is the absence of a choice, so the responsive default decides.
 * `shown` and `hidden` are choices, and a breakpoint that collapses a panel for
 * space does not get to replace them.
 */
export type PanelPresentation = "automatic" | "shown" | "hidden";

export type AppearancePreferences = SessionPreferences;

export interface LayoutPreferences {
  readonly roster: PanelPresentation;
  readonly details: PanelPresentation;
}

export type TextSize = "standard" | "large";
export type TextContrast = "normal" | "high";
export type MotionPreference = "system" | "reduce";
export type WheelHabit = "draw" | "figma";

/** The settings of one schema bump, in one group. Nothing reads them yet. */
export interface DisplayPreferences {
  readonly textSize: TextSize;
  readonly contrast: TextContrast;
  readonly motion: MotionPreference;
  readonly wheelHabit: WheelHabit;
  readonly crosshair: boolean;
  readonly grid: boolean;
  /** Off, a commit that does not turn it back on is not written. */
  readonly remember: boolean;
}

export interface StoredPreferences {
  readonly schemaVersion: number;
  readonly appearance: AppearancePreferences;
  readonly layout: LayoutPreferences;
  readonly display: DisplayPreferences;
}

export const LAYOUT_DEFAULTS: LayoutPreferences = { roster: "automatic", details: "automatic" };

/** Every default keeps what a build without these fields does. */
export const DISPLAY_DEFAULTS: DisplayPreferences = {
  textSize: "standard",
  contrast: "normal",
  motion: "system",
  wheelHabit: "draw",
  crosshair: false,
  grid: true,
  remember: true,
};

/** What one commit names. At least one group, and never a path or a key. */
export interface PreferenceWriteRequest {
  readonly appearance?: AppearancePreferences;
  readonly layout?: LayoutPreferences;
  readonly display?: DisplayPreferences;
  /**
   * The explicit reset-and-replace confirmation.
   *
   * Absent from every ordinary commit, so nothing routine -- a startup read, a
   * Cancel, a media-query event, an automatic layout adjustment -- can
   * overwrite a stored record this build refused to read.
   */
  readonly replaceUnusable?: boolean;
}

/** Why a stored record could not be used. Owned codes, never messages. */
export type StoredRecordProblem =
  | "malformed"
  | "unsupportedVersion"
  | "oversized"
  | "unreadable"
  | "unsafeTarget";

/** What a startup read found. */
export type PreferenceReadOutcome =
  | { readonly outcome: "absent"; readonly revision: number }
  | { readonly outcome: "loaded"; readonly preferences: StoredPreferences; readonly revision: number }
  | { readonly outcome: "unusable"; readonly problem: string; readonly revision: number }
  | { readonly outcome: "unavailable"; readonly problem: string; readonly revision: number };

/** What one commit did. `saved` carries the snapshot a restart will find. */
export type PreferenceSaveOutcome =
  | { readonly outcome: "saved"; readonly preferences: StoredPreferences; readonly revision: number }
  | { readonly outcome: "storedRecordUnusable"; readonly problem: string; readonly revision: number }
  | { readonly outcome: "unavailable"; readonly problem: string; readonly revision: number }
  /** Remembering is off, so nothing was written. Not a fault. */
  | { readonly outcome: "notRemembered"; readonly revision: number }
  | {
      readonly outcome: "failed";
      readonly problem: string;
      readonly retryable: boolean;
      readonly temporaryLeftBehind: boolean;
      readonly revision: number;
    };

const LOCALES: readonly UiLocale[] = ["en", "zh-CN"];
const DENSITIES: readonly RosterDensity[] = ["comfortable", "compact"];
const PRESENTATIONS: readonly PanelPresentation[] = ["automatic", "shown", "hidden"];
const TEXT_SIZES: readonly TextSize[] = ["standard", "large"];
const CONTRASTS: readonly TextContrast[] = ["normal", "high"];
const MOTIONS: readonly MotionPreference[] = ["system", "reduce"];
const WHEEL_HABITS: readonly WheelHabit[] = ["draw", "figma"];

/**
 * Whether a record from the store is one this build can consume.
 *
 * Rust validates on every read and every write and is the authority; this is
 * the boundary's own check, because a value that reached React unvalidated
 * would be one React then renders. It admits nothing outside the enumerated
 * domains and no unexpected shape, and it deliberately does not repair: a
 * record that is not usable is reported, not patched.
 */
export function isStoredPreferences(value: unknown): value is StoredPreferences {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== PREFERENCE_SCHEMA_VERSION) return false;
  const appearance = record.appearance;
  const layout = record.layout;
  const display = record.display;
  if (typeof appearance !== "object" || appearance === null) return false;
  if (typeof layout !== "object" || layout === null) return false;
  if (typeof display !== "object" || display === null) return false;
  const { locale, density } = appearance as Record<string, unknown>;
  const { roster, details } = layout as Record<string, unknown>;
  const { textSize, contrast, motion, wheelHabit, crosshair, grid, remember } = display as Record<string, unknown>;
  return (
    LOCALES.includes(locale as UiLocale) &&
    DENSITIES.includes(density as RosterDensity) &&
    PRESENTATIONS.includes(roster as PanelPresentation) &&
    PRESENTATIONS.includes(details as PanelPresentation) &&
    TEXT_SIZES.includes(textSize as TextSize) &&
    CONTRASTS.includes(contrast as TextContrast) &&
    MOTIONS.includes(motion as MotionPreference) &&
    WHEEL_HABITS.includes(wheelHabit as WheelHabit) &&
    typeof crosshair === "boolean" &&
    typeof grid === "boolean" &&
    typeof remember === "boolean"
  );
}

/**
 * Whether a stored-record problem code is one this build has copy for.
 *
 * An unknown code stays inspectable rather than being dropped or guessed at:
 * the caller shows the honest localized wrapper around whatever came back.
 */
export function isStoredRecordProblem(code: string): code is StoredRecordProblem {
  return (["malformed", "unsupportedVersion", "oversized", "unreadable", "unsafeTarget"] as const)
    .some(known => known === code);
}
