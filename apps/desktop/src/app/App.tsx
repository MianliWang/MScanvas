import { PreviewWorkspace } from "../features/mzml-preview/PreviewWorkspace";
import { SessionPreferencesProvider } from "../features/preferences/SessionPreferencesProvider";
import type { UiRuntime } from "../features/preferences/i18n";

export function App({ uiRuntime }: { readonly uiRuntime?: UiRuntime } = {}) {
  return <SessionPreferencesProvider runtime={uiRuntime}><PreviewWorkspace /></SessionPreferencesProvider>;
}
