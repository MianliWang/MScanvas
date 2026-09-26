/**
 * The projection behind the provenance panel.
 *
 * Pure: it takes the state Rust sent and a selection, and answers what is
 * related to what. These cases are about the shapes -- a resolved edge, an edge
 * whose record is gone, a selection whose object is gone, an artifact no run
 * claims -- because each of those renders differently and each is a thing the
 * document can genuinely contain.
 */

import { describe, expect, it } from "vitest";

import {
  capturedProject,
  openProject,
  projectArtifact,
  projectInput,
  projectLayer,
  projectRun,
} from "../../test/projectFixtures";
import { attachedRow, provenanceOf } from "./lineage";
import { NO_PROJECT } from "./projectApi";

const INPUT = "11111111-2222-4111-8111-111111111111";
const RUN = "ffffffff-2222-4111-8111-111111111111";
const ARTIFACT = "eeeeeeee-2222-4111-8111-111111111111";
const LAYER = "dddddddd-2222-4111-8111-111111111111";

describe("the lineage projection", () => {
  it("answers nothing when nothing is selected", () => {
    expect(provenanceOf(capturedProject(), null)).toBeNull();
  });

  it("answers nothing when no project is open", () => {
    // A selection cannot outlive the project it named. There is no object to
    // describe, and describing one would be describing a project that is not
    // on screen.
    expect(provenanceOf(NO_PROJECT, { kind: "input", id: INPUT })).toBeNull();
  });

  it("reaches the run that consumed an input", () => {
    const provenance = provenanceOf(capturedProject(), { kind: "input", id: INPUT });
    expect(provenance?.kind).toBe("input");
    if (provenance?.kind !== "input") throw new Error("wrong kind");
    expect(provenance.input.id).toBe(INPUT);
    expect(provenance.consumedBy.map((related) => related.id)).toEqual([RUN]);
    expect(provenance.consumedBy[0]?.record?.id).toBe(RUN);
  });

  it("reaches both directions from a run", () => {
    const provenance = provenanceOf(capturedProject(), { kind: "run", id: RUN });
    if (provenance?.kind !== "run") throw new Error("wrong kind");
    expect(provenance.inputs.map((related) => related.record?.id)).toEqual([INPUT]);
    expect(provenance.produced.map((related) => related.record?.id)).toEqual([ARTIFACT]);
  });

  it("reaches the producing run and the source inputs from an artifact", () => {
    const provenance = provenanceOf(capturedProject(), { kind: "artifact", id: ARTIFACT });
    if (provenance?.kind !== "artifact") throw new Error("wrong kind");
    expect(provenance.producedBy?.record?.id).toBe(RUN);
    expect(provenance.sources.map((related) => related.record?.id)).toEqual([INPUT]);
  });

  it("says an artifact no run claims has no producer rather than naming one", () => {
    const state = openProject({
      inputs: [projectInput({ id: INPUT })],
      runs: [],
      artifacts: [
        projectArtifact({ id: ARTIFACT, producedByRunId: null, sourceInputIds: [INPUT] }),
      ],
    });
    const provenance = provenanceOf(state, { kind: "artifact", id: ARTIFACT });
    if (provenance?.kind !== "artifact") throw new Error("wrong kind");
    expect(provenance.producedBy).toBeNull();
    // It still knows what it observed.
    expect(provenance.sources.map((related) => related.record?.id)).toEqual([INPUT]);
  });

  it("keeps an edge whose record is gone rather than shortening the list", () => {
    // A run naming two inputs where the project holds one. Dropping the row
    // would render "this run used one file" from a document that says two.
    const present = projectInput({ id: INPUT });
    const state = openProject({
      inputs: [present],
      runs: [projectRun({ id: RUN, inputIds: [INPUT, "99999999-2222-4111-8111-111111111111"] })],
      artifacts: [],
    });
    const provenance = provenanceOf(state, { kind: "run", id: RUN });
    if (provenance?.kind !== "run") throw new Error("wrong kind");
    expect(provenance.inputs).toHaveLength(2);
    expect(provenance.inputs[0]?.record?.id).toBe(INPUT);
    expect(provenance.inputs[1]?.record).toBeNull();
    expect(provenance.inputs[1]?.id).toBe("99999999-2222-4111-8111-111111111111");
  });

  it("says a selected object that is gone is gone, and selects nothing else", () => {
    for (const kind of ["input", "run", "artifact", "layer"] as const) {
      const provenance = provenanceOf(capturedProject(), {
        kind,
        id: "99999999-9999-4111-8111-999999999999",
      });
      expect(provenance?.kind).toBe("gone");
    }
  });
});

describe("the layer projection", () => {
  /** The captured lineage, with one layer sourced from its reference. */
  function layered() {
    return { ...capturedProject(), layers: [projectLayer({ id: LAYER, sourceInputId: INPUT })] };
  }

  it("reaches a layer's source and, through it, the runs that consumed the source", () => {
    const provenance = provenanceOf(layered(), { kind: "layer", id: LAYER });
    if (provenance?.kind !== "layer") throw new Error("wrong kind");
    expect(provenance.layer.id).toBe(LAYER);
    expect(provenance.source.record?.id).toBe(INPUT);
    // A layer has no runs of its own. What it is related to is what its
    // source is related to, and that is the source's list, not a second one.
    expect(provenance.consumedBy.map((related) => related.record?.id)).toEqual([RUN]);
  });

  it("names the layer sourced from a reference, and none where none was created", () => {
    const withLayer = provenanceOf(layered(), { kind: "input", id: INPUT });
    if (withLayer?.kind !== "input") throw new Error("wrong kind");
    expect(withLayer.layer?.id).toBe(LAYER);

    const without = provenanceOf(capturedProject(), { kind: "input", id: INPUT });
    if (without?.kind !== "input") throw new Error("wrong kind");
    expect(without.layer).toBeNull();
  });

  it("keeps a layer whose source is gone, with the edge unresolved and nothing consumed", () => {
    // Not a state a valid document can be in, but the projection has to
    // answer for it rather than throw: the layer is still selected.
    const state = openProject({
      inputs: [],
      layers: [projectLayer({ id: LAYER, sourceInputId: INPUT })],
    });
    const provenance = provenanceOf(state, { kind: "layer", id: LAYER });
    if (provenance?.kind !== "layer") throw new Error("wrong kind");
    expect(provenance.source.id).toBe(INPUT);
    expect(provenance.source.record).toBeNull();
    expect(provenance.consumedBy).toEqual([]);
  });

  it("resolves a remembered row only against the roster", () => {
    const input = projectInput({ workbenchDatasetHandle: "row-1" });
    expect(attachedRow(input, new Set(["row-1"]))).toBe("row-1");
    // A handle the roster no longer holds is a row that has gone, which is
    // the same position as never having admitted one.
    expect(attachedRow(input, new Set(["row-2"]))).toBeNull();
    expect(attachedRow(input, new Set())).toBeNull();
    expect(attachedRow(input, undefined)).toBeNull();
    expect(attachedRow(projectInput({ workbenchDatasetHandle: null }), new Set(["row-1"]))).toBeNull();
  });
});
