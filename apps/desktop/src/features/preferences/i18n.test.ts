import { describe, expect, it, vi } from "vitest";
import * as i18next from "i18next";
import type { TFunction } from "i18next";
import { bindUiMessages, createUiRuntime, ResourceProblem, UI_RESOURCES, validateBundle, type UiMessage } from "./i18n";

vi.mock("i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("i18next")>();
  return { ...actual, createInstance: vi.fn(actual.createInstance) };
});

// Compilation must reject invalid keys and missing/wrong interpolation values.
function messageTypeContract(message: UiMessage, t: TFunction<"ui">): void {
  message("settings");
  message("rosterRows", { count: 3 });
  // @ts-expect-error Invalid semantic message key.
  message("notAResource");
  // @ts-expect-error The count parameter is required.
  message("rosterRows");
  // @ts-expect-error A count is numeric, independently of its display locale.
  message("rosterRows", { count: "3" });
  // @ts-expect-error The unknown structured reason remains inspectable by code.
  message("unknownFigureProblem", {});
  // @ts-expect-error The installed string-key API also rejects unknown keys.
  t("notAResource");
}
void messageTypeContract;

describe("bundled UI resources", () => {
  it("initializes synchronously, without a detector, remote backend, selector default or fallback", () => {
    const { instance, initialProblem } = createUiRuntime();
    expect(initialProblem).toBeNull();
    expect(instance.isInitialized).toBe(true);
    expect(instance.options.enableSelector).toBe(false);
    expect(instance.options.fallbackLng).toBe(false);
    expect(instance.modules.backend).toBeUndefined();
    expect(instance.modules.languageDetector).toBeUndefined();
    expect(() => validateBundle("en", instance.getResourceBundle("en", "ui"))).not.toThrow();
    expect(() => validateBundle("zh-CN", instance.getResourceBundle("zh-CN", "ui"))).not.toThrow();
  });

  it.each([0, 1, 5])("renders locale-specific plurals for %i real rows", (count) => {
    const { instance } = createUiRuntime();
    const english = bindUiMessages(instance.getFixedT("en", "ui"));
    const chinese = bindUiMessages(instance.getFixedT("zh-CN", "ui"));
    const expectedEnglish = count === 1 ? UI_RESOURCES.en.rosterRows_one : UI_RESOURCES.en.rosterRows_other;
    expect(english("rosterRows", { count })).toBe(expectedEnglish.replace("{{count, number}}", String(count)));
    expect(chinese("rosterRows", { count })).toBe(UI_RESOURCES["zh-CN"].rosterRows_other.replace("{{count, number}}", String(count)));
    expect(Object.keys(UI_RESOURCES["zh-CN"])).not.toContain("rosterRows_one");
  });

  it("formats display counts with an explicit locale and retains the numeric input", () => {
    const { instance } = createUiRuntime();
    const count = 1234;
    const message = bindUiMessages(instance.getFixedT("zh-CN", "ui"));
    expect(message("rosterRows", { count })).toContain(new Intl.NumberFormat("zh-CN").format(count));
    expect(count).toBe(1234);
  });

  it("renders numeric drag destinations through both runtime resource boundaries", () => {
    const { instance } = createUiRuntime();
    const parameters = { name: "QC 研究", count: 2, position: 3, total: 5 };
    expect(bindUiMessages(instance.getFixedT("en", "ui"))("dragTarget", parameters)).toBe("Move to QC 研究, position 3 of 5 (2 selected).");
    expect(bindUiMessages(instance.getFixedT("zh-CN", "ui"))("dragTarget", parameters)).toBe("移至QC 研究，第 3 位，共 5 个采集（已选 2 个）。");
  });

  it("detects missing resources even when an engine fallback would hide the gap", () => {
    const { instance } = createUiRuntime();
    const incomplete: Record<string, unknown> = { ...UI_RESOURCES["zh-CN"] };
    delete incomplete.settings;
    instance.removeResourceBundle("zh-CN", "ui");
    instance.addResourceBundle("zh-CN", "ui", incomplete);
    expect(instance.t("settings", { lng: "zh-CN", fallbackLng: "en" })).toBe(UI_RESOURCES.en.settings);
    expect(() => validateBundle("zh-CN", incomplete)).toThrow("RESOURCE_MISSING: settings");
    expect(() => validateBundle("zh-CN", undefined)).toThrow("RESOURCE_MISSING");
  });

  it("rejects empty values, unexpected keys, missing plural forms and parameter drift", () => {
    expect(() => validateBundle("zh-CN", { ...UI_RESOURCES["zh-CN"], settings: "  " })).toThrow("RESOURCE_EMPTY");
    expect(() => validateBundle("zh-CN", { ...UI_RESOURCES["zh-CN"], unexpected: "Extra" })).toThrow("RESOURCE_KEYS");
    const incomplete: Record<string, unknown> = { ...UI_RESOURCES.en };
    delete incomplete.rosterRows_one;
    expect(() => validateBundle("en", incomplete)).toThrow("RESOURCE_MISSING: rosterRows_one");
    expect(() => validateBundle("zh-CN", { ...UI_RESOURCES["zh-CN"], resourceCode: "{{different}}" })).toThrow("RESOURCE_PARAMETERS");
    expect(() => validateBundle("en", { ...UI_RESOURCES.en, resourceCode: "" })).toThrow("RESOURCE_EMPTY");
  });

  it("keeps invalid initialization observable beside validated local baseline messages", () => {
    const runtime = createUiRuntime({ en: {}, "zh-CN": {} });
    expect(runtime.initialProblem).toBeInstanceOf(ResourceProblem);
    expect(runtime.instance.t("resourceError")).toBe(UI_RESOURCES.en.resourceError);
    expect(runtime.instance.isInitialized).toBe(true);
  });

  it("detects untyped invalid keys and parameters instead of rendering a key or blank value", () => {
    const message = bindUiMessages(createUiRuntime().instance.getFixedT("en", "ui"));
    expect(() => Reflect.apply(message, null, ["notAResource"])).toThrow("RESOURCE_KEYS");
    expect(() => Reflect.apply(message, null, ["rosterRows"])).toThrow("RESOURCE_PARAMETERS");
    expect(() => Reflect.apply(message, null, ["rosterRows", { count: "1" }])).toThrow("RESOURCE_PARAMETERS");
    expect(() => Reflect.apply(message, null, ["resourceCode", { code: "" }])).toThrow("RESOURCE_PARAMETERS");
  });

  it("retains an initialization failure while a separate validated baseline remains usable", () => {
    const failed = i18next.createInstance();
    vi.spyOn(failed, "init").mockImplementationOnce(() => { throw new Error("Injected initialization fault"); });
    vi.mocked(i18next.createInstance).mockReturnValueOnce(failed);
      const runtime = createUiRuntime();
      expect(runtime.initialProblem?.code).toBe("RESOURCE_INIT");
      expect(runtime.instance).not.toBe(failed);
      expect(runtime.instance.isInitialized).toBe(true);
      expect(runtime.instance.t("resourceError")).toBe(UI_RESOURCES.en.resourceError);
  });

  it("isolates resource stores and engine language between sessions", async () => {
    const first = createUiRuntime();
    const second = createUiRuntime();
    await first.instance.changeLanguage("zh-CN");
    first.instance.removeResourceBundle("en", "ui");
    expect(second.instance.language).toBe("en");
    expect(second.instance.t("settings")).toBe(UI_RESOURCES.en.settings);
    expect(UI_RESOURCES.en.settings).not.toBe("");
  });
});
