import { describe, expect, it } from "vitest";
import { bindUiMessages, createUiRuntime, UI_RESOURCES, validateBundle } from "../preferences/i18n";
import { describeAddResult, describeClear } from "../mzml-preview/rosterSelection";
import { describeFolderResult } from "../mzml-preview/folderNotice";
import { formatWorkspaceNotice } from "./workspaceMessages";
import { selectedFile } from "../../test/previewFixtures";

describe("render-time workbench messages", () => {
  const runtime = createUiRuntime();
  const en = bindUiMessages(runtime.instance.getFixedT("en", "ui"));
  const zh = bindUiMessages(runtime.instance.getFixedT("zh-CN", "ui"));
  it.each([0, 1, 7])("renders drag and operation counts for %i without translating state", count => {
    expect(en("dragPicked", { count })).toBe(`Picked up ${count} acquisition${count === 1 ? "" : "s"}.`);
    expect(zh("dragPicked", { count })).toBe(`已拾起 ${count} 个采集。`);
    const notice = describeClear(count), snapshot = structuredClone(notice);
    expect(formatWorkspaceNotice(notice, en).message).toContain(`Cleared ${count} file${count === 1 ? "" : "s"}`);
    expect(formatWorkspaceNotice(notice, zh).message).toContain(`已从名单清除 ${count} 个文件`);
    expect(notice).toEqual(snapshot);
  });
  it("retains raw labels and provider prose while changing the surrounding language", () => {
    const name = "研究 & {{raw}}.mzML", summary = "Provider 原文 <failure>";
    const notice = describeAddResult({ roster: { datasets: [], capacity: 1024 }, outcomes: [
      { outcome: "duplicate", existing: { ...selectedFile, fileName: name } },
      { outcome: "rejected", candidateName: "未改名.mzML", error: { kind: "test_error", summary, detail: null, retryable: false } },
    ] });
    // An unmapped code: the prose is kept whole either way, labelled as
    // untranslated original where the reader's language is not the one it is
    // written in.
    expect(formatWorkspaceNotice(notice, en).details).toEqual([`${name} is already in the workspace.`, `未改名.mzML: ${summary}`]);
    expect(formatWorkspaceNotice(notice, zh).details).toEqual([`${name} 已在工作区中。`, `未改名.mzML：后端的原始报告（未翻译）：${summary}`]);
  });
  it("reads a refusal this build words in the reader's own language", () => {
    // The reason this detail carries the error rather than its sentence: a
    // code with a resource is rendered from that resource, so the same refusal
    // is English in an English session and Chinese in a Chinese one.
    const notice = describeAddResult({ roster: { datasets: [], capacity: 1024 }, outcomes: [
      { outcome: "rejected", candidateName: "notes.txt", error: { kind: "unsupported_extension", summary: "Only mzML files are supported.", detail: null, retryable: false } },
    ] });
    expect(formatWorkspaceNotice(notice, en).details).toEqual(["notes.txt: MSCanvas opens .mzML files in this version."]);
    expect(formatWorkspaceNotice(notice, zh).details).toEqual(["notes.txt：此版本的 MSCanvas 可打开 .mzML 文件。"]);
  });
  it("keeps incomplete refusal distinct from an empty complete folder in both locales", () => {
    const result = { roster: { datasets: [], capacity: 1024 }, outcomes: [], discovery: { complete: false, skippedReparseCount: 0, inaccessibleEntryCount: 0, limitsReached: ["depth" as const] } };
    const notice = describeFolderResult(result);
    expect(formatWorkspaceNotice(notice, en).message).toContain("scan was incomplete");
    expect(formatWorkspaceNotice(notice, zh).message).toContain("扫描未完成");
    expect(formatWorkspaceNotice(notice, zh).message).not.toContain("未找到 mzML");
  });
  it("rejects invalid drag counts and missing localized organization resources", () => {
    for (const count of [-1, 0.5, NaN, "3"]) expect(() => Reflect.apply(en, null, ["dragCount", { count }])).toThrow("RESOURCE_PARAMETERS");
    const incomplete: Record<string, unknown> = { ...UI_RESOURCES["zh-CN"] };
    delete incomplete.organizationUnsafeUndo;
    expect(() => validateBundle("zh-CN", incomplete)).toThrow("RESOURCE_MISSING: organizationUnsafeUndo");
  });
});
