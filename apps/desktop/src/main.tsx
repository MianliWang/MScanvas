import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import {
  PreferencesApiProvider,
  tauriPreferencesApi,
} from "./features/preferences/preferencesApi";
import { ProjectApiProvider, tauriProjectApi } from "./features/project/projectApi";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("MSCanvas root element was not found.");
}

// The real preference store, installed at the one place the application starts.
// The context default deliberately claims no storage, so this is what makes a
// shipped build remember anything; `scripts/check_repo.py` asserts it is here.
createRoot(root).render(
  <StrictMode>
    <PreferencesApiProvider value={tauriPreferencesApi}>
      {/* The real project store, installed beside the preference store and for
          the same reason: the context default claims no store at all, so this
          is what makes a shipped build able to open and save a project. */}
      <ProjectApiProvider value={tauriProjectApi}>
        <App />
      </ProjectApiProvider>
    </PreferencesApiProvider>
  </StrictMode>,
);
