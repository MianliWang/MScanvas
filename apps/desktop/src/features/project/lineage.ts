/**
 * What is selected, and what it is related to.
 *
 * Every relationship here is a lookup by identifier over the projection Rust
 * already sent. Nothing is inferred from a label, a position in a list or a
 * timestamp, and nothing is fetched: selecting a related object is a change of
 * local state over data the page already has, which is what makes navigation
 * incapable of reading a backend, re-checking a file or touching the document.
 *
 * The two derived edges -- which runs consumed a reference, which run produced
 * an artifact -- are not computed here. Rust computes them once, in
 * `project/lineage.rs`, and sends them as `consumedByRunIds` and
 * `producedByRunId`. A second implementation here would be a second answer that
 * could disagree with the first.
 */

import type {
  ProjectArtifact,
  ProjectInput,
  ProjectLayer,
  ProjectRun,
  ProjectState,
} from "./projectApi";

/** The four kinds of project object a user can inspect. */
export type ProjectObjectKind = "input" | "run" | "artifact" | "layer";

/** One selected project object, addressed the way Rust addresses it. */
export interface ProjectSelection {
  readonly kind: ProjectObjectKind;
  readonly id: string;
}

/**
 * One related object, and whether the current project still has it.
 *
 * The identifier is kept even when the record is gone, because an edge that
 * cannot be resolved is a fact worth showing rather than a row to drop. A
 * silently shortened list would read as "this run used one file" when the
 * document says it used two.
 */
export interface Related<T> {
  readonly id: string;
  readonly record: T | null;
}

export type Provenance =
  /** The selected object is not in the project any more. */
  | { readonly kind: "gone"; readonly selected: ProjectSelection }
  | {
      readonly kind: "input";
      readonly input: ProjectInput;
      readonly consumedBy: readonly Related<ProjectRun>[];
      /** The layer sourced from this reference, or `null` where none is. */
      readonly layer: ProjectLayer | null;
    }
  | {
      readonly kind: "layer";
      readonly layer: ProjectLayer;
      readonly source: Related<ProjectInput>;
      /**
       * The runs that consumed the source. A layer has no runs of its own --
       * it is identity, not work -- so what it is related to is what its
       * source is related to. Empty where the source is gone.
       */
      readonly consumedBy: readonly Related<ProjectRun>[];
    }
  | {
      readonly kind: "run";
      readonly run: ProjectRun;
      readonly inputs: readonly Related<ProjectInput>[];
      readonly produced: readonly Related<ProjectArtifact>[];
    }
  | {
      readonly kind: "artifact";
      readonly artifact: ProjectArtifact;
      /** `null` where no run in this project claims it, which is a state. */
      readonly producedBy: Related<ProjectRun> | null;
      readonly sources: readonly Related<ProjectInput>[];
    };

function relate<T extends { readonly id: string }>(
  records: readonly T[],
  id: string,
): Related<T> {
  return { id, record: records.find((record) => record.id === id) ?? null };
}

/**
 * The live workspace row for one reference, or `null`.
 *
 * Remembered in Rust, resolved here. A handle naming no row the roster
 * currently holds means the row has gone, which is the same position as never
 * having admitted one. The one resolution for every surface that asks -- the
 * reference row, the layer row and the Details region -- so they cannot
 * disagree about whether a row is there.
 */
export function attachedRow(
  input: ProjectInput,
  liveDatasetHandles: ReadonlySet<string> | undefined,
): string | null {
  const handle = input.workbenchDatasetHandle;
  if (handle === null || liveDatasetHandles === undefined) return null;
  return liveDatasetHandles.has(handle) ? handle : null;
}

/**
 * What the Details region shows for the current selection.
 *
 * `null` when nothing is selected. A selection naming an object the project no
 * longer has answers `gone` rather than quietly selecting something else --
 * which is the one behaviour that would make the panel lie about what the user
 * is looking at.
 */
export function provenanceOf(
  state: ProjectState,
  selection: ProjectSelection | null,
): Provenance | null {
  if (selection === null || !state.open) return null;

  if (selection.kind === "input") {
    const input = state.inputs.find((candidate) => candidate.id === selection.id);
    if (input === undefined) return { kind: "gone", selected: selection };
    return {
      kind: "input",
      input,
      consumedBy: input.consumedByRunIds.map((id) => relate(state.runs, id)),
      layer: state.layers.find((layer) => layer.sourceInputId === input.id) ?? null,
    };
  }

  if (selection.kind === "layer") {
    const layer = state.layers.find((candidate) => candidate.id === selection.id);
    if (layer === undefined) return { kind: "gone", selected: selection };
    const source = relate(state.inputs, layer.sourceInputId);
    return {
      kind: "layer",
      layer,
      source,
      consumedBy: (source.record?.consumedByRunIds ?? []).map((id) => relate(state.runs, id)),
    };
  }

  if (selection.kind === "run") {
    const run = state.runs.find((candidate) => candidate.id === selection.id);
    if (run === undefined) return { kind: "gone", selected: selection };
    return {
      kind: "run",
      run,
      inputs: run.inputIds.map((id) => relate(state.inputs, id)),
      produced: run.outputArtifactIds.map((id) => relate(state.artifacts, id)),
    };
  }

  const artifact = state.artifacts.find((candidate) => candidate.id === selection.id);
  if (artifact === undefined) return { kind: "gone", selected: selection };
  return {
    kind: "artifact",
    artifact,
    producedBy:
      artifact.producedByRunId === null ? null : relate(state.runs, artifact.producedByRunId),
    sources: artifact.sourceInputIds.map((id) => relate(state.inputs, id)),
  };
}
