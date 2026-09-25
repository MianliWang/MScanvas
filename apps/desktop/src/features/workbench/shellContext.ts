/**
 * What the shell says about where the reader is, across every surface.
 *
 * A projection and nothing else. Every fact below is read from the owner that
 * already holds it -- the project session, the viewer, the roster's resolved
 * conversion scope and the conversion lane -- and nothing is inferred, counted
 * afresh or remembered here. An item takes the reader to the surface that owns
 * the fact; it starts no work, sends no request and changes no selection.
 *
 * Each item is one sentence. A label and a value in separate elements would make
 * the shell repeat a file name, a project name or a status word as text of its
 * own, and every query that finds those words on a surface would find the shell
 * as well.
 */

import type { MessageKey, UiMessage } from "../preferences/i18n";
import type { WorkspaceConversionState } from "../mzml-preview/contracts";
import { artifactKey, operationKey } from "../project/ProjectPanel";
import type { Provenance } from "../project/lineage";
import type { WorkbenchSurface } from "./WorkbenchHeader";

export interface ShellContextFacts {
  /** The open project, or `null` when none is. */
  readonly project: { readonly name: string; readonly unsaved: boolean } | null;
  /** The sentence the Project surface uses for what it is doing, or `null`. */
  readonly projectActivity: MessageKey | null;
  /** The acquisition the viewer shows, and the spectrum selected in it. */
  readonly viewing: {
    readonly name: string;
    /** Where two rows share a filename, the context the roster shows for it. */
    readonly context: string | null;
    readonly spectrumIndex: number | null;
  } | null;
  /** The conversion scope as the Conversion surface resolves it, or `null`. */
  readonly conversionScope: { readonly scope: "selected" | "all"; readonly eligible: number } | null;
  /** The conversion lane's own status, as Rust last reported it. */
  readonly conversionStatus: WorkspaceConversionState["status"];
  /** What the Project surface is inspecting, resolved against the project. */
  readonly inspecting: Provenance | null;
}

export type ShellContextItemId =
  | "project"
  | "viewing"
  | "conversionScope"
  | "conversionActivity"
  | "projectActivity"
  | "inspecting";

export interface ShellContextItem {
  readonly id: ShellContextItemId;
  /** The surface that owns the fact; activating the item goes there. */
  readonly target: WorkbenchSurface;
  readonly text: string;
}

const CONVERSION_ACTIVITY = {
  awaitingDestination: "shellConversionAwaiting",
  running: "shellConversionRunning",
  stopping: "shellConversionStopping",
} as const;

/** The name the Project surface gives what it is inspecting. */
function inspectedName(provenance: Provenance, t: UiMessage): string | null {
  switch (provenance.kind) {
    case "gone":
      return null;
    case "input":
      return provenance.input.label;
    case "layer":
      // A layer has no name of its own; its visible name is its source's.
      return provenance.source.record?.label ?? t("provenanceRelatedGone");
    case "run":
      return t(operationKey(provenance.run));
    case "artifact":
      return t(artifactKey(provenance.artifact));
  }
}

/** A value an interpolation may carry: never empty, which the bundle refuses. */
function named(value: string, fallback: string): string {
  return value.trim() === "" ? fallback : value;
}

export function shellContextItems(facts: ShellContextFacts, t: UiMessage): readonly ShellContextItem[] {
  const items: ShellContextItem[] = [];

  const project = facts.project;
  items.push({
    id: "project",
    target: "project",
    text:
      project === null
        ? t("shellContextProjectNone")
        : t(project.unsaved ? "shellContextProjectUnsaved" : "shellContextProject", {
            name: named(project.name, t("projectDefaultName")),
          }),
  });

  const viewing = facts.viewing;
  if (viewing !== null) {
    const name = named(
      viewing.context === null ? viewing.name : `${viewing.name} (${viewing.context})`,
      t("shellContextUnnamed"),
    );
    items.push({
      id: "viewing",
      target: "workbench",
      text:
        viewing.spectrumIndex === null
          ? t("shellContextViewing", { name })
          : t("shellContextViewingSpectrum", { name, index: String(viewing.spectrumIndex) }),
    });
  }

  const scope = facts.conversionScope;
  if (scope !== null) {
    items.push({
      id: "conversionScope",
      target: "conversion",
      text: t("shellContextScope", {
        scope: t(scope.scope === "all" ? "m74CnvAll" : "m74CnvSelected"),
        eligible: String(scope.eligible),
      }),
    });
  }

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

  const inspecting = facts.inspecting;
  if (inspecting !== null) {
    const name = inspectedName(inspecting, t);
    items.push({
      id: "inspecting",
      target: "project",
      text: name === null ? t("shellContextInspectingGone") : t("shellContextInspecting", { name: named(name, t("provenanceRelatedGone")) }),
    });
  }

  return items;
}
