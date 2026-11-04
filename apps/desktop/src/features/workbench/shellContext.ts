/**
 * What the status bar says about work and the open project, on every surface.
 *
 * A projection and nothing else. Every fact below is read from the owner that
 * already holds it -- the project session and the conversion lane -- and
 * nothing is inferred, counted afresh or remembered here. An item takes the
 * reader to the surface that owns the fact; it starts no work, sends no
 * request and changes no selection.
 *
 * What is viewed is the Workbench's identity row, and what is inspected is
 * Details: neither is repeated here.
 */

import type { MessageKey, UiMessage } from "../preferences/i18n";
import type { WorkspaceConversionState } from "../mzml-preview/contracts";
import type { WorkbenchSurface } from "./WorkbenchHeader";

export interface ShellContextFacts {
  /** The open project, or `null` when none is. */
  readonly project: { readonly name: string; readonly unsaved: boolean } | null;
  /** The sentence the Project surface uses for what it is doing, or `null`. */
  readonly projectActivity: MessageKey | null;
  /** The conversion lane's own status, as Rust last reported it. */
  readonly conversionStatus: WorkspaceConversionState["status"];
}

export type ShellContextItemId = "conversionActivity" | "projectActivity" | "project";

export interface ShellContextItem {
  readonly id: ShellContextItemId;
  /** The surface that owns the fact; activating the item goes there. */
  readonly target: WorkbenchSurface;
  readonly text: string;
  /** The project has changes not yet saved; shown as a tag beside the text. */
  readonly unsaved?: boolean;
}

const CONVERSION_ACTIVITY = {
  awaitingDestination: "shellConversionAwaiting",
  running: "shellConversionRunning",
  stopping: "shellConversionStopping",
} as const;

/** The items in screen order: work first, then the project. */
export function shellContextItems(facts: ShellContextFacts, t: UiMessage): readonly ShellContextItem[] {
  const items: ShellContextItem[] = [];

  const status = facts.conversionStatus;
  if (status === "terminal") {
    items.push({ id: "conversionActivity", target: "conversion", text: t("shellConversionRetained") });
  } else if (status !== "idle") {
    items.push({
      id: "conversionActivity",
      target: "conversion",
      text: t("shellContextActivity", { activity: t(CONVERSION_ACTIVITY[status]) }),
    });
  }

  if (facts.projectActivity !== null) {
    items.push({
      id: "projectActivity",
      target: "project",
      text: t("shellContextActivity", { activity: t(facts.projectActivity as "projectBusySaving") }),
    });
  }

  // No project is no fact: the header's Project menu already offers one.
  const project = facts.project;
  if (project !== null) {
    items.push({
      id: "project",
      target: "project",
      // Never an empty interpolation, which the bundle refuses.
      text: t("shellContextProject", { name: project.name.trim() === "" ? t("projectDefaultName") : project.name }),
      unsaved: project.unsaved,
    });
  }

  return items;
}
