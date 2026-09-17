/**
 * What the webview may ask about UI preferences.
 *
 * Two questions: what is stored, and commit this field group. Neither takes a
 * path, a file name, a key, a prefix, an arbitrary document or a filesystem
 * capability, and there is no third operation that does -- where the record
 * lives is decided in Rust and is not expressible here.
 *
 * A separate boundary from the preview API on purpose. Preferences are not
 * scientific state, confer no authority over a backend, a dataset or a
 * conversion, and share no lane with them; naming them as an interface also
 * lets tests drive hydration, ordering and failure deterministically without a
 * WebView.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import { documentAuthorityHeaders } from "../ipc/documentAuthority";
import type {
  PreferenceReadOutcome,
  PreferenceSaveOutcome,
  PreferenceWriteRequest,
} from "./storedPreferences";

export interface PreferencesApi {
  /**
   * Reads the stored record for this document.
   *
   * Reads and never writes: a first run answers `absent` rather than being
   * given a file, and a record this build cannot use answers `unusable` and is
   * left exactly as found.
   */
  loadPreferences(): Promise<PreferenceReadOutcome>;
  /**
   * Commits one field group, merged onto what is actually stored.
   *
   * `saved` carries the snapshot that was published and read back -- what a
   * restart will find -- rather than what was requested. An uncertain outcome
   * is a failure, not a save.
   */
  savePreferences(request: PreferenceWriteRequest): Promise<PreferenceSaveOutcome>;
}

export const tauriPreferencesApi: PreferencesApi = {
  loadPreferences: () =>
    invoke<PreferenceReadOutcome>("load_ui_preferences", {}, documentAuthorityHeaders()),
  savePreferences: (request) =>
    invoke<PreferenceSaveOutcome>("save_ui_preferences", { request }, documentAuthorityHeaders()),
};

/**
 * The store a session with nowhere to write behaves like.
 *
 * The default for a render with no provider -- a standalone component test, or
 * the browser harness before it installs its own. It answers honestly rather
 * than pretending: nothing is stored, nothing can be, and the interface stays
 * completely usable on defaults.
 */
export const unavailablePreferencesApi: PreferencesApi = {
  loadPreferences: () =>
    Promise.resolve({ outcome: "unavailable", problem: "rootUnresolved", revision: 0 }),
  savePreferences: () =>
    Promise.resolve({ outcome: "unavailable", problem: "rootUnresolved", revision: 0 }),
};

/**
 * The default is the honest one, not the real one.
 *
 * A render with no provider -- a standalone component test, a harness that has
 * not installed its own -- must not reach for an IPC boundary that may not be
 * there, and must not quietly behave as though it had a store. So the default
 * claims nothing. The application's own entry point installs
 * [`tauriPreferencesApi`], and `scripts/check_repo.py` asserts that it does,
 * because a production bundle that silently stopped saving preferences would
 * look exactly like one that saves them.
 */
const PreferencesApiContext = createContext<PreferencesApi>(unavailablePreferencesApi);

export const PreferencesApiProvider = PreferencesApiContext.Provider;

export function usePreferencesApi(): PreferencesApi {
  return useContext(PreferencesApiContext);
}
