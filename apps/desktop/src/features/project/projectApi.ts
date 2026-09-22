/**
 * What the webview may ask about the session's project.
 *
 * Every operation addresses records by identifier and nothing else. None takes
 * a path, a file name, a directory or a filesystem capability -- where a
 * project lives and which files it references are decided in Rust, and there is
 * no argument here that could name one. Where a location has to be chosen, the
 * page asks for a native dialog and Rust shows it.
 *
 * A separate boundary from the preview API on purpose. A project references
 * files; the workspace roster *admits* them. Loading a project admits nothing,
 * and keeping the two boundaries apart is what makes that structural rather
 * than a convention someone has to remember.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import { documentAuthorityHeaders } from "../ipc/documentAuthority";

/** Whether a reference travels with the project or points outside it. */
export type LocatorKind = "insideProject" | "outsideProject";

/** What a check established, exactly as Rust reports it. */
export type VerificationId =
  | "notChecked"
  | "matchingRecordedContent"
  | "differentContent"
  | "unavailable";

/** Why a reference could not be established as present and readable. */
export type UnavailableReasonId =
  | "missingAtCheckedLocation"
  | "unreadable"
  | "unsafeReference"
  | "incompleteRequiredMembers"
  | "unstableRead";

export interface ProjectMember {
  readonly role: "primary" | "requiredCompanion";
  readonly name: string;
  readonly recordedByteLength: number;
}

export interface ProjectInput {
  readonly id: string;
  readonly label: string;
  readonly locatorKind: LocatorKind;
  readonly members: readonly ProjectMember[];
  readonly verification: VerificationId;
  readonly unavailableReason: UnavailableReasonId | null;
  readonly relinkProposed: boolean;
  readonly relinkCandidateMatches: boolean;
}

export interface ProjectArtifact {
  readonly id: string;
  readonly label: string;
  readonly observedInputCount: number;
  readonly observedMemberCount: number;
}

export interface ProjectRun {
  readonly id: string;
  readonly operation: string;
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly inputIds: readonly string[];
  readonly outputArtifactIds: readonly string[];
  readonly applicationVersion: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface ProjectState {
  readonly open: boolean;
  readonly name: string;
  readonly dirty: boolean;
  readonly published: boolean;
  readonly inputs: readonly ProjectInput[];
  readonly artifacts: readonly ProjectArtifact[];
  readonly runs: readonly ProjectRun[];
}

/** The state of a session with no project open. */
export const NO_PROJECT: ProjectState = {
  open: false,
  name: "",
  dirty: false,
  published: false,
  inputs: [],
  artifacts: [],
  runs: [],
};

/**
 * One accepted check or capture.
 *
 * The identifier is correlation: it says which operation a later cancel means.
 * It names no path and confers nothing. It exists *before* the operation's work
 * does, which is the point -- a cancel pressed in the instant after the button
 * has something to name even if the run request has not reached Rust yet.
 */
export interface AcceptedOperation {
  readonly operationId: string;
}

/**
 * What a cancel request found. None of these is an error: "nothing to cancel"
 * is an answer.
 */
export type CancelOutcome = "cancelled" | "noActiveOperation" | "stale";

/**
 * Operations that show a dialog answer `null` when the user cancelled.
 *
 * Cancelling is an ordinary outcome and not an error: nothing was chosen, so
 * nothing changed.
 */
export type Chosen = ProjectState | null;

export interface ProjectApi {
  getProjectState(): Promise<ProjectState>;
  createProject(name: string, discardUnsaved: boolean): Promise<ProjectState>;
  closeProject(discardUnsaved: boolean): Promise<ProjectState>;
  openProject(discardUnsaved: boolean): Promise<Chosen>;
  saveProject(): Promise<ProjectState>;
  saveProjectAs(): Promise<Chosen>;
  addProjectInput(): Promise<Chosen>;
  removeProjectInput(inputId: string): Promise<ProjectState>;
  /** Accepts one check or capture and answers the identifier it runs under. */
  beginProjectJob(): Promise<AcceptedOperation>;
  checkProjectLinks(operationId: string): Promise<ProjectState>;
  /** Asks one named operation to stop. Never rejects for a late or idle press. */
  cancelProjectJob(operationId: string): Promise<{ readonly outcome: CancelOutcome }>;
  captureProjectFileFacts(
    operationId: string,
    inputIds: readonly string[],
  ): Promise<ProjectState>;
  proposeProjectRelink(inputId: string): Promise<Chosen>;
  commitProjectRelink(inputId: string): Promise<ProjectState>;
  abandonProjectRelink(): Promise<ProjectState>;
}

export const tauriProjectApi: ProjectApi = {
  getProjectState: () => invoke<ProjectState>("get_project_state", {}, documentAuthorityHeaders()),
  createProject: (name, discardUnsaved) =>
    invoke<ProjectState>("create_project", { name, discardUnsaved }, documentAuthorityHeaders()),
  closeProject: (discardUnsaved) =>
    invoke<ProjectState>("close_project", { discardUnsaved }, documentAuthorityHeaders()),
  openProject: (discardUnsaved) =>
    invoke<Chosen>("open_project", { discardUnsaved }, documentAuthorityHeaders()),
  saveProject: () => invoke<ProjectState>("save_project", {}, documentAuthorityHeaders()),
  saveProjectAs: () => invoke<Chosen>("save_project_as", {}, documentAuthorityHeaders()),
  addProjectInput: () => invoke<Chosen>("add_project_input", {}, documentAuthorityHeaders()),
  removeProjectInput: (inputId) =>
    invoke<ProjectState>("remove_project_input", { inputId }, documentAuthorityHeaders()),
  beginProjectJob: () =>
    invoke<AcceptedOperation>("begin_project_job", {}, documentAuthorityHeaders()),
  checkProjectLinks: (operationId) =>
    invoke<ProjectState>("check_project_links", { operationId }, documentAuthorityHeaders()),
  cancelProjectJob: (operationId) =>
    invoke<{ readonly outcome: CancelOutcome }>(
      "cancel_project_job",
      { operationId },
      documentAuthorityHeaders(),
    ),
  captureProjectFileFacts: (operationId, inputIds) =>
    invoke<ProjectState>(
      "capture_project_file_facts",
      { operationId, inputIds: [...inputIds] },
      documentAuthorityHeaders(),
    ),
  proposeProjectRelink: (inputId) =>
    invoke<Chosen>("propose_project_relink", { inputId }, documentAuthorityHeaders()),
  commitProjectRelink: (inputId) =>
    invoke<ProjectState>("commit_project_relink", { inputId }, documentAuthorityHeaders()),
  abandonProjectRelink: () =>
    invoke<ProjectState>("abandon_project_relink", {}, documentAuthorityHeaders()),
};

/**
 * The default for a render with no provider.
 *
 * It answers honestly rather than pretending: there is no project store here,
 * so there is no project, and every operation says so rather than inventing a
 * result a component could go on to display as real. A project surface with no
 * backend must look empty, not populated.
 */
export const unavailableProjectApi: ProjectApi = {
  getProjectState: () => Promise.resolve(NO_PROJECT),
  createProject: () => Promise.reject(new Error("noProjectStore")),
  closeProject: () => Promise.resolve(NO_PROJECT),
  openProject: () => Promise.reject(new Error("noProjectStore")),
  saveProject: () => Promise.reject(new Error("noProjectStore")),
  saveProjectAs: () => Promise.reject(new Error("noProjectStore")),
  addProjectInput: () => Promise.reject(new Error("noProjectStore")),
  removeProjectInput: () => Promise.reject(new Error("noProjectStore")),
  beginProjectJob: () => Promise.reject(new Error("noProjectStore")),
  checkProjectLinks: () => Promise.reject(new Error("noProjectStore")),
  cancelProjectJob: () => Promise.resolve({ outcome: "noActiveOperation" }),
  captureProjectFileFacts: () => Promise.reject(new Error("noProjectStore")),
  proposeProjectRelink: () => Promise.reject(new Error("noProjectStore")),
  commitProjectRelink: () => Promise.reject(new Error("noProjectStore")),
  abandonProjectRelink: () => Promise.resolve(NO_PROJECT),
};

/**
 * The default is the honest one, not the real one.
 *
 * The application's own entry point installs [`tauriProjectApi`], for the same
 * reason the preference store is installed there: a production bundle that
 * silently stopped reaching the project store would look exactly like one that
 * has no project open.
 */
const ProjectApiContext = createContext<ProjectApi>(unavailableProjectApi);

export const ProjectApiProvider = ProjectApiContext.Provider;

export function useProjectApi(): ProjectApi {
  return useContext(ProjectApiContext);
}
