/**
 * What is selected, and what it is related to.
 *
 * Every relationship here is a lookup by identifier over the projection Rust
 * already sent. Nothing is inferred from a label, a position in a list or a
 * timestamp, and nothing is fetched: selecting a related object is a change of
 * local state over data the page already has, which is what makes navigation
 * incapable of reading a backend, re-checking a file or touching the document.
 *
 * The derived edges -- which runs consumed a reference or a layer, which run
 * produced an artifact -- are not computed here. Rust computes them once, in
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
  TargetedMs1Execution,
  TargetedMs1Plan,
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

/**
 * A targeted run's own block and the plan it executed, or `null` for any other
 * run. The plan is looked up by the digest the run names; a valid document
 * always holds it, and one that does not says so with `null` here.
 */
export interface TargetedLineage {
  readonly execution: TargetedMs1Execution;
  readonly plan: TargetedMs1Plan | null;
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
      /** The runs that consumed this layer: its own history. */
      readonly usedBy: readonly Related<ProjectRun>[];
      /**
       * The runs that consumed the source, which are the source's history and
       * not the layer's. Empty where the source is gone.
       */
      readonly consumedBy: readonly Related<ProjectRun>[];
    }
  | {
      readonly kind: "run";
      readonly run: ProjectRun;
      readonly inputs: readonly Related<ProjectInput>[];
      readonly layers: readonly Related<ProjectLayer>[];
      /** Each consumed layer's source, by the layer's position above. */
      readonly layerSources: readonly (ProjectInput | null)[];
      readonly produced: readonly Related<ProjectArtifact>[];
      readonly targeted: TargetedLineage | null;
    }
  | {
      readonly kind: "artifact";
      readonly artifact: ProjectArtifact;
      /** `null` where no run in this project claims it, which is a state. */
      readonly producedBy: Related<ProjectRun> | null;
      readonly sources: readonly Related<ProjectInput>[];
      /**
       * The layers the producing run consumed, and each one's source. This is
       * how a QC snapshot reaches its reference: it observed none itself, so
       * `sources` is empty and this chain is its lineage.
       */
      readonly layers: readonly Related<ProjectLayer>[];
      readonly layerSources: readonly Related<ProjectInput>[];
      /** The producing run's targeted block and plan, for a targeted result. */
      readonly targeted: TargetedLineage | null;
    };

/** The targeted block of one run, with the plan it names. */
export function targetedLineage(state: ProjectState, run: ProjectRun | null): TargetedLineage | null {
  const execution = run?.targetedMs1 ?? null;
  if (execution === null) return null;
  return {
    execution,
    plan: (state.plans ?? []).find((plan) => plan.planSha256 === execution.planSha256) ?? null,
  };
}

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
 * The preview the Workbench is showing, as far as a QC capture is concerned:
 * which row it is of, its opaque run-summary token, and whether the build that
 * produced it can be identified. `null` where no preview is loaded.
 */
export interface ViewedPreview {
  readonly handle: string;
  readonly token: string | null;
  readonly producerIdentified: boolean;
}

/** Why a layer's QC summary cannot be captured right now. */
export type QcUnavailable = "qcNeedsWorkbench" | "qcNeedsPreview" | "qcProducerUnidentified";

/**
 * Why this layer's source cannot have its QC summary captured now, or `null`
 * where it can.
 *
 * One answer, in the order a reader has to act on it: the source must be in
 * the Workbench, the preview on screen must be that row's, and the build that
 * produced it must be identifiable. Pressing capture never starts a preview
 * and never attaches a source; each reason points at the step that does.
 */
export function qcUnavailable(
  source: ProjectInput | undefined,
  liveDatasetHandles: ReadonlySet<string> | undefined,
  viewed: ViewedPreview | null,
): QcUnavailable | null {
  const handle = source === undefined ? null : attachedRow(source, liveDatasetHandles);
  if (handle === null) return "qcNeedsWorkbench";
  if (viewed === null || viewed.handle !== handle || viewed.token === null) {
    return "qcNeedsPreview";
  }
  return viewed.producerIdentified ? null : "qcProducerUnidentified";
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
      usedBy: layer.consumedByRunIds.map((id) => relate(state.runs, id)),
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
      layers: run.layerIds.map((id) => relate(state.layers, id)),
      layerSources: run.layerIds.map((id) => {
        const layer = state.layers.find((candidate) => candidate.id === id);
        return state.inputs.find((input) => input.id === layer?.sourceInputId) ?? null;
      }),
      produced: run.outputArtifactIds.map((id) => relate(state.artifacts, id)),
      targeted: targetedLineage(state, run),
    };
  }

  const artifact = state.artifacts.find((candidate) => candidate.id === selection.id);
  if (artifact === undefined) return { kind: "gone", selected: selection };
  const producedBy =
    artifact.producedByRunId === null ? null : relate(state.runs, artifact.producedByRunId);
  const layers = (producedBy?.record?.layerIds ?? []).map((id) => relate(state.layers, id));
  return {
    kind: "artifact",
    artifact,
    producedBy,
    sources: artifact.sourceInputIds.map((id) => relate(state.inputs, id)),
    layers,
    layerSources: layers.flatMap((layer) =>
      layer.record === null ? [] : [relate(state.inputs, layer.record.sourceInputId)],
    ),
    targeted: targetedLineage(state, producedBy?.record ?? null),
  };
}
