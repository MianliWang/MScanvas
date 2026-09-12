import { describe, expect, it } from "vitest";
import { effectivePreferences, INITIAL_PREFERENCES, preferenceReducer as reduce } from "./sessionPreferences";

describe("session preference drafts", () => {
  it("previews, discards and reopens from applied values", () => {
    const opened = reduce(INITIAL_PREFERENCES, { type: "open" });
    const preview = reduce(opened, { type: "preview", preferences: { locale: "zh-CN", density: "compact" } });
    expect(effectivePreferences(preview)).toEqual({ locale: "zh-CN", density: "compact" });
    expect(preview.applied).toEqual({ locale: "en", density: "comfortable" });
    const closed = reduce(preview, { type: "discard" });
    expect(effectivePreferences(closed)).toEqual(INITIAL_PREFERENCES.applied);
    expect(reduce(closed, { type: "open" }).draft).toEqual(INITIAL_PREFERENCES.applied);
  });

  it("commits only on Apply and lets Reset remain cancellable", () => {
    const changed = reduce(reduce(INITIAL_PREFERENCES, { type: "open" }), {
      type: "preview", preferences: { locale: "zh-CN", density: "compact" },
    });
    const applied = reduce(changed, { type: "apply" });
    const reopened = reduce(applied, { type: "open" });
    expect(reopened.draft).toEqual(applied.applied);
    const reset = reduce(reopened, { type: "reset" });
    expect(effectivePreferences(reset)).toEqual(INITIAL_PREFERENCES.applied);
    expect(reduce(reset, { type: "discard" }).applied).toEqual(applied.applied);
    expect(reduce(reset, { type: "apply" }).applied).toEqual(INITIAL_PREFERENCES.applied);
    expect(INITIAL_PREFERENCES.applied.locale).toBe("en");
  });

  it("rejects a late preview after closing, and opening twice does not reset a draft", () => {
    const closed = reduce(INITIAL_PREFERENCES, { type: "discard" });
    expect(reduce(closed, { type: "preview", preferences: { locale: "zh-CN", density: "compact" } })).toBe(closed);
    const changed = reduce(reduce(closed, { type: "open" }), { type: "preview", preferences: { locale: "zh-CN", density: "compact" } });
    expect(reduce(changed, { type: "open" })).toBe(changed);
  });
});
