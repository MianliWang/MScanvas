/**
 * The durable half of the UI preference contract, as this side sees it.
 *
 * One small versioned record with finite domains, mirroring exactly what Rust
 * stores. Nothing here locates a file, names a dataset or carries scientific
 * state, and nothing here is authority: a record read from the store cannot
 * open anything, and a record written to it cannot ask for anything to be
 * opened.
 *
 * The two field groups are separate because they are committed from different
 * places in the interface. Settings commits appearance; the shell's panel
 * toggles commit layout. A commit that carried both would let one surface
 * publish the other's unapplied draft.
 */

import type { UiLocale, RosterDensity, SessionPreferences } from "./sessionPreferences";

/** The schema this build reads and writes. Rust refuses any other. */
export const PREFERENCE_SCHEMA_VERSION = 1;

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

export interface StoredPreferences {
  readonly schemaVersion: number;
  readonly appearance: AppearancePreferences;
  readonly layout: LayoutPreferences;
}

export const LAYOUT_DEFAULTS: LayoutPreferences = { roster: "automatic", details: "automatic" };

/** What one commit names. At least one group, and never a path or a key. */
export interface PreferenceWriteRequest {
  readonly appearance?: AppearancePreferences;
  readonly layout?: LayoutPreferences;
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
  if (typeof appearance !== "object" || appearance === null) return false;
  if (typeof layout !== "object" || layout === null) return false;
  const { locale, density } = appearance as Record<string, unknown>;
  const { roster, details } = layout as Record<string, unknown>;
  return (
    LOCALES.includes(locale as UiLocale) &&
    DENSITIES.includes(density as RosterDensity) &&
    PRESENTATIONS.includes(roster as PanelPresentation) &&
    PRESENTATIONS.includes(details as PanelPresentation)
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
