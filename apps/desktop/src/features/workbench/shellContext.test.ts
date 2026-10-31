/**
 * The status bar's work and project items, as a projection of facts other
 * owners hold.
 *
 * Pure: every case renders through the shipped bundles. Nothing here is a
 * backend answer.
 */

import { describe, expect, it } from "vitest";

import { bindUiMessages, createUiRuntime } from "../preferences/i18n";
import { openProject } from "../../test/projectFixtures";
import { shellContextItems, type ShellContextFacts } from "./shellContext";

const runtime = createUiRuntime();
const en = bindUiMessages(runtime.instance.getFixedT("en", "ui"));
const zh = bindUiMessages(runtime.instance.getFixedT("zh-CN", "ui"));

const NOTHING: ShellContextFacts = {
  project: null,
  projectActivity: null,
  conversionStatus: "idle",
};

function texts(facts: ShellContextFacts, t = en) {
  return shellContextItems(facts, t).map((item) => [item.id, item.target, item.text]);
}

describe("the status bar's context items", () => {
  it("says nothing when there is nothing to say, not even that no project is open", () => {
    expect(texts(NOTHING)).toEqual([]);
    expect(texts(NOTHING, zh)).toEqual([]);
  });

  it("names the open project, and flags unsaved changes apart from the name", () => {
    const state = openProject({ name: "Pooled QC study", dirty: true });
    const [item] = shellContextItems({ ...NOTHING, project: { name: state.name, unsaved: state.dirty } }, en);
    expect(item).toEqual({ id: "project", target: "project", text: "Project: Pooled QC study", unsaved: true });
    expect(texts({ ...NOTHING, project: { name: state.name, unsaved: false } }, zh)).toEqual([
      ["project", "project", "项目：Pooled QC study"],
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

  it.each([
    ["awaitingDestination", "In progress: Conversion preparing output locations"],
    ["running", "In progress: Conversion running"],
    ["stopping", "In progress: Conversion stopping"],
    ["terminal", "Conversion queue ended: results retained"],
  ] as const)("reports the conversion lane's %s status in its own words", (status, text) => {
    expect(texts({ ...NOTHING, conversionStatus: status })).toEqual([["conversionActivity", "conversion", text]]);
  });

  it("uses the Project surface's own sentence for what the project is doing", () => {
    expect(texts({ ...NOTHING, projectActivity: "projectBusyAnalysing" })).toEqual([
      ["projectActivity", "project", `In progress: ${en("projectBusyAnalysing")}`],
    ]);
  });

  it("puts work before the project, so a long name never hides it", () => {
    expect(
      texts({
        project: { name: "Study", unsaved: false },
        projectActivity: "projectBusySaving",
        conversionStatus: "running",
      }).map(([id]) => id),
    ).toEqual(["conversionActivity", "projectActivity", "project"]);
  });
});
