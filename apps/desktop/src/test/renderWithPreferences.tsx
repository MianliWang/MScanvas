import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionPreferencesProvider } from "../features/preferences/SessionPreferencesProvider";

/** Standalone consumer tests get the same session boundary, isolated per mount. */
export function renderWithPreferences(ui: ReactNode) {
  return render(ui, { wrapper: SessionPreferencesProvider });
}
