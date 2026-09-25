/**
 * PM9.1 populated-state scenarios for the real application composition.
 *
 * Synthetic and controlled. Every answer comes from the fakes at the API
 * boundary -- `previewFixtures`, `projectFixtures`, `preferenceFixtures` -- so no
 * file is read, no provider runs and no result is computed. What these are for
 * is rendering the shipped components in the states a reader actually meets: a
 * populated roster, a task under way, a stored result, a result whose payload
 * is missing. A slice exercises and compares its surfaces in them. They are
 * never evidence that a conversion or an analysis works; that evidence is the
 * Rust suite's and, for a provider, a native run's.
 *
 * Built only from existing fixture builders, so a scenario cannot describe a
 * shape the production contracts do not have.
 */

import { render } from "@testing-library/react";

import { App } from "../app/App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import type { SelectedFile, WorkspaceConversionState } from "../features/mzml-preview/contracts";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { PreferencesApiProvider } from "../features/preferences/preferencesApi";
import { NO_PROJECT, ProjectApiProvider, type ProjectState } from "../features/project/projectApi";
import { createFakePreferencesApi, storedRecord } from "./preferenceFixtures";
import {
  availableBackend,
  collidingFile,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  otherCollidingFile,
  queueItem,
  queueOf,
  secondFile,
  selectedFile,
  shimadzuDataset,
  thirdFile,
  unavailableBackend,
  type FakePreviewApiOptions,
  type HeldFile,
} from "./previewFixtures";
import { capturedProject, createFakeProjectApi, targetedProject } from "./projectFixtures";

export type Pm9Scenario =
  | "empty"
  | "populated"
  | "converting"
  | "conversionEnded"
  | "projectWithResult"
  | "resultPayloadMissing"
  | "resultPayloadCorrupt";

/** A vendor row the admitted conversion scope can hold; never read here. */
const VENDOR: SelectedFile = shimadzuDataset(9);

/**
 * A roster a reader works with: several acquisitions, two with one filename
 * found in different folders, and one vendor row.
 */
const POPULATED: readonly HeldFile[] = [
  selectedFile,
  secondFile,
  thirdFile,
  { file: collidingFile, parents: ["batch-1"] },
  { file: otherCollidingFile, parents: ["batch-2"] },
  VENDOR,
];

const RUNNING: WorkspaceConversionState = {
  status: "running",
  operationId: "pm9-running",
  queue: queueOf([
    queueItem(VENDOR.handle, VENDOR.fileName, { sourceKind: VENDOR.sourceKind, state: "running", attempts: 1 }),
  ]),
};

const ENDED: WorkspaceConversionState = {
  status: "terminal",
  reason: "stopped",
  operationId: "pm9-ended",
  queue: queueOf([
    // Stopped before it began: the one item the queue never started.
    queueItem(VENDOR.handle, VENDOR.fileName, { sourceKind: VENDOR.sourceKind, state: "notRun" }),
  ]),
};

export interface Pm9ScenarioDefinition {
  /** What a reader would see, in one sentence; recorded with any evidence. */
  readonly description: string;
  readonly preview: FakePreviewApiOptions;
  readonly project: ProjectState;
}

export const PM9_SCENARIOS: Readonly<Record<Pm9Scenario, () => Pm9ScenarioDefinition>> = {
  empty: () => ({
    description: "No converter installed, no acquisitions and no project: the first-run state.",
    preview: { availability: unavailableBackend },
    project: NO_PROJECT,
  }),
  populated: () => ({
    description: "Six acquisitions, two sharing a filename in different folders, one vendor row; a project with recorded file facts.",
    preview: { availability: availableBackend, initialDatasets: POPULATED },
    project: capturedProject(),
  }),
  converting: () => ({
    description: "The populated roster with a conversion under way on the vendor row.",
    preview: { availability: availableBackend, initialDatasets: POPULATED, initialConversion: RUNNING },
    project: capturedProject(),
  }),
  conversionEnded: () => ({
    description: "The populated roster after a conversion that was stopped before its one item began; its report is retained.",
    preview: { availability: availableBackend, initialDatasets: POPULATED, initialConversion: ENDED },
    project: capturedProject(),
  }),
  projectWithResult: () => ({
    description: "A saved project with one layer, a completed targeted run and its stored result, whole.",
    preview: { availability: unavailableBackend },
    project: targetedProject("available"),
  }),
  resultPayloadMissing: () => ({
    description: "The same project whose stored result payload is missing beside the document.",
    preview: { availability: unavailableBackend },
    project: targetedProject("payloadMissing"),
  }),
  resultPayloadCorrupt: () => ({
    description: "The same project whose stored result payload no longer matches its record.",
    preview: { availability: unavailableBackend },
    project: targetedProject("payloadCorrupt"),
  }),
};

/**
 * Mounts the whole application in one scenario.
 *
 * The viewport is the caller's: a scenario is what the backend answers, not how
 * wide the window is.
 */
export function renderPm9Scenario(name: Pm9Scenario) {
  const definition = PM9_SCENARIOS[name]();
  const preview = createFakePreviewApi(definition.preview);
  const projects = createFakeProjectApi(definition.project);
  const rendered = render(
    <PreferencesApiProvider value={createFakePreferencesApi({ stored: storedRecord() })}>
      <ProjectApiProvider value={projects}>
        <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
          <PreviewApiProvider value={preview}>
            <App />
          </PreviewApiProvider>
        </WorkspaceDropTransportProvider>
      </ProjectApiProvider>
    </PreferencesApiProvider>,
  );
  return { definition, preview, projects, rendered };
}
