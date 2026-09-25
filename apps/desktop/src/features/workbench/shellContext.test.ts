/**
 * The shell's context line, as a projection of facts other owners hold.
 *
 * Pure: every case builds the facts from the same fixtures the Project and
 * Workbench tests use, resolves provenance with the real `provenanceOf`, and
 * renders through the shipped bundles. Nothing here is a backend answer.
 */

import { describe, expect, it } from "vitest";

import { bindUiMessages, createUiRuntime } from "../preferences/i18n";
import { provenanceOf } from "../project/lineage";
import {
  capturedProject,
  openProject,
  projectInput,
  projectLayer,
  targetedProject,
} from "../../test/projectFixtures";
import { shellContextItems, type ShellContextFacts } from "./shellContext";

const runtime = createUiRuntime();
const en = bindUiMessages(runtime.instance.getFixedT("en", "ui"));
const zh = bindUiMessages(runtime.instance.getFixedT("zh-CN", "ui"));

const NOTHING: ShellContextFacts = {
  project: null,
  projectActivity: null,
  viewing: null,
  conversionScope: null,
  conversionStatus: "idle",
  inspecting: null,
};

function texts(facts: ShellContextFacts, t = en) {
  return shellContextItems(facts, t).map((item) => [item.id, item.target, item.text]);
}

describe("the shell's context line", () => {
  it("says that no project is open, and nothing else, when there is nothing to say", () => {
    expect(texts(NOTHING)).toEqual([["project", "project", "Project: none open"]]);
    expect(texts(NOTHING, zh)).toEqual([["project", "project", "项目：未打开"]]);
  });

  it("names the open project, and says so when it has unsaved changes", () => {
    const state = openProject({ name: "Pooled QC study", dirty: true });
    expect(texts({ ...NOTHING, project: { name: state.name, unsaved: state.dirty } })).toEqual([
      ["project", "project", "Project: Pooled QC study · unsaved changes"],
    ]);
    expect(texts({ ...NOTHING, project: { name: state.name, unsaved: false } })).toEqual([
      ["project", "project", "Project: Pooled QC study"],
    ]);
  });

  it("never passes an empty name to the bundle, which would refuse it", () => {
    expect(texts({ ...NOTHING, project: { name: "  ", unsaved: false } })).toEqual([
      ["project", "project", `Project: ${en("projectDefaultName")}`],
    ]);
  });

  it("keeps user text as it was written, in either language", () => {
    const name = "研究 & {{raw}}";
    expect(texts({ ...NOTHING, project: { name, unsaved: false } }, zh)).toEqual([
      ["project", "project", `项目：${name}`],
    ]);
  });

  it("names the viewed acquisition as the roster does, with the selected spectrum", () => {
    const viewing = { name: "sample.mzML", context: "batch-1", spectrumIndex: 3 };
    expect(texts({ ...NOTHING, viewing })).toContainEqual([
      "viewing",
      "workbench",
      "Viewing: sample.mzML (batch-1) · spectrum 3",
    ]);
    expect(texts({ ...NOTHING, viewing: { ...viewing, context: null, spectrumIndex: null } })).toContainEqual([
      "viewing",
      "workbench",
      "Viewing: sample.mzML",
    ]);
  });

  it("describes the conversion scope the Conversion surface resolves, not a count of its own", () => {
    expect(texts({ ...NOTHING, conversionScope: { scope: "selected", eligible: 0 } })).toContainEqual([
      "conversionScope",
      "conversion",
      `For conversion: ${en("m74CnvSelected")} · 0 eligible`,
    ]);
    expect(texts({ ...NOTHING, conversionScope: { scope: "all", eligible: 12 } }, zh)).toContainEqual([
      "conversionScope",
      "conversion",
      `待转换：${zh("m74CnvAll")} · 可转换 12 项`,
    ]);
  });

  it.each([
    ["awaitingDestination", "In progress: Conversion preparing output locations"],
    ["running", "In progress: Conversion running"],
    ["stopping", "In progress: Conversion stopping"],
    ["terminal", "Conversion queue ended: results retained"],
  ] as const)("reports the conversion lane's %s status in its own words", (status, text) => {
    expect(texts({ ...NOTHING, conversionStatus: status })).toContainEqual([
      "conversionActivity",
      "conversion",
      text,
    ]);
  });

  it("says nothing about an idle conversion lane", () => {
    expect(shellContextItems(NOTHING, en).some((item) => item.id === "conversionActivity")).toBe(false);
  });

  it("uses the Project surface's own sentence for what the project is doing", () => {
    expect(texts({ ...NOTHING, projectActivity: "projectBusyAnalysing" })).toContainEqual([
      "projectActivity",
      "project",
      `In progress: ${en("projectBusyAnalysing")}`,
    ]);
  });

  it("names an inspected result the way Details names it", () => {
    const state = targetedProject();
    const artifact = state.artifacts[0]!;
    expect(
      texts({ ...NOTHING, inspecting: provenanceOf(state, { kind: "artifact", id: artifact.id }) }),
    ).toContainEqual(["inspecting", "project", `Inspecting: ${en("projectArtifactTargetedMs1")}`]);
    const run = state.runs[0]!;
    expect(
      texts({ ...NOTHING, inspecting: provenanceOf(state, { kind: "run", id: run.id }) }),
    ).toContainEqual(["inspecting", "project", `Inspecting: ${en("projectOperationTargetedMs1")}`]);
  });

  it("names an inspected reference by its label and a layer by its source's", () => {
    const state = capturedProject();
    const input = state.inputs[0]!;
    expect(
      texts({ ...NOTHING, inspecting: provenanceOf(state, { kind: "input", id: input.id }) }),
    ).toContainEqual(["inspecting", "project", "Inspecting: QC_pool_01.mzML"]);

    const layered = openProject({ inputs: [projectInput({ label: "Blank_02.mzML" })], layers: [projectLayer()] });
    expect(
      texts({ ...NOTHING, inspecting: provenanceOf(layered, { kind: "layer", id: projectLayer().id }) }),
    ).toContainEqual(["inspecting", "project", "Inspecting: Blank_02.mzML"]);
  });

  it("says a record is gone rather than naming something that is not there", () => {
    const state = capturedProject();
    expect(
      texts({ ...NOTHING, inspecting: provenanceOf(state, { kind: "artifact", id: "not-in-this-project" }) }),
    ).toContainEqual(["inspecting", "project", en("shellContextInspectingGone")]);
  });

  it("orders the line from where the reader is to what they inspect", () => {
    const state = targetedProject();
    const ids = shellContextItems(
      {
        project: { name: state.name, unsaved: false },
        projectActivity: "projectBusyChecking",
        viewing: { name: "sample.mzML", context: null, spectrumIndex: 0 },
        conversionScope: { scope: "selected", eligible: 2 },
        conversionStatus: "running",
        inspecting: provenanceOf(state, { kind: "artifact", id: state.artifacts[0]!.id }),
      },
      en,
    ).map((item) => item.id);
    expect(ids).toEqual([
      "project",
      "viewing",
      "conversionScope",
      "conversionActivity",
      "projectActivity",
      "inspecting",
    ]);
  });
});
