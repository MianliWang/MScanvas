/**
 * What the webview may ask about user-saved conversion presets (ADR 0055).
 *
 * Four operations over presets addressed by name. None takes a path, a file
 * name or a document: where presets live is decided in Rust. MSCanvas ships no
 * preset. A preset's intent is opaque here; applying one means handing it to
 * the conversion configuration authority, which decides whether it can run.
 */

import { invoke } from "@tauri-apps/api/core";

import { documentAuthorityHeaders } from "../ipc/documentAuthority";

/** One preset. An unusable one is listed without its intent and cannot be applied. */
export type PresetEntry =
  | { readonly state: "usable"; readonly name: string; readonly intent: unknown }
  | { readonly state: "unusable"; readonly name: string; readonly problem: string };

export type PresetListOutcome =
  | { readonly outcome: "listed"; readonly presets: readonly PresetEntry[] }
  | { readonly outcome: "unusable"; readonly problem: string }
  | { readonly outcome: "unavailable"; readonly problem: string };

export type PresetWriteOutcome =
  | { readonly outcome: "committed"; readonly presets: readonly PresetEntry[] }
  | { readonly outcome: "refused"; readonly problem: string }
  | { readonly outcome: "storedRecordUnusable"; readonly problem: string }
  | { readonly outcome: "unavailable"; readonly problem: string }
  | {
      readonly outcome: "failed";
      readonly problem: string;
      readonly retryable: boolean;
      readonly temporaryLeftBehind: boolean;
    };

export interface PresetSaveRequest {
  readonly name: string;
  readonly intent: unknown;
  /** Replace the preset that already has this name. Without it, `nameTaken`. */
  readonly replaceExisting?: boolean;
  /** Replace an unusable stored document. Without it, `storedRecordUnusable`. */
  readonly replaceUnusable?: boolean;
}

export interface PresetsApi {
  listPresets(): Promise<PresetListOutcome>;
  savePreset(request: PresetSaveRequest): Promise<PresetWriteOutcome>;
  renamePreset(name: string, newName: string): Promise<PresetWriteOutcome>;
  deletePreset(name: string): Promise<PresetWriteOutcome>;
}

export const tauriPresetsApi: PresetsApi = {
  listPresets: () =>
    invoke<PresetListOutcome>("list_conversion_presets", {}, documentAuthorityHeaders()),
  savePreset: (request) =>
    invoke<PresetWriteOutcome>("save_conversion_preset", { request }, documentAuthorityHeaders()),
  renamePreset: (name, newName) =>
    invoke<PresetWriteOutcome>(
      "rename_conversion_preset",
      { request: { name, newName } },
      documentAuthorityHeaders(),
    ),
  deletePreset: (name) =>
    invoke<PresetWriteOutcome>("delete_conversion_preset", { request: { name } }, documentAuthorityHeaders()),
};
