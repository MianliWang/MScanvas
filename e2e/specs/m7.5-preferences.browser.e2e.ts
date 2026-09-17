/**
 * M7.5 in production React, in real Chrome, with only the Tauri IPC boundary
 * mocked.
 *
 * What this layer can say: what the preference states look like at a given
 * viewport and device pixel ratio, in either language and either density, with
 * real layout, real fonts, real reflow and a real console. What it cannot say:
 * whether anything reached disk, whether Windows put the keyboard anywhere, or
 * whether a native picker opened. Those are the native campaign's, and nothing
 * here is written as though they were covered.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { consoleEntries, installIpcBoundary, ipcCalls, releaseInvokeHold, setInvokeResult } from "../support/harness";
import { ipcTable } from "../support/fixtures";
import { selectedFile, unavailableBackend, availableBackend, chosenFolderWithoutTools, quarantinedBackend } from "../../apps/desktop/src/test/previewFixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

/**
 * The pinned animation library's own note when reduced motion is set.
 *
 * Third-party text, matched by its opening rather than paraphrased, so a
 * different warning from the same library is still a finding.
 */
const REDUCED_MOTION_ADVISORY = "You have Reduced Motion enabled on your device.";

const DIALOG = "[data-settings-dialog]";
const ROW = '.dataset-roster-list [role="row"][data-handle]';
const evidence: unknown[] = [];
let output = "";

/** A stored record, in the wire shape Rust answers with. */
function record(
  appearance: { locale: "en" | "zh-CN"; density: "comfortable" | "compact" },
  layout: { roster: string; details: string } = { roster: "automatic", details: "automatic" },
) {
  return { schemaVersion: 1, appearance, layout };
}

async function openSettings() {
  await browser.execute(() => document.querySelector("[data-settings-entry]")!.scrollIntoView({ block: "nearest" }));
  await browser.$("[data-settings-entry]").click();
  await browser.$(DIALOG).waitForDisplayed();
}
async function choose(value: string) {
  await browser.$(`${DIALOG} input[value="${value}"]`).click();
}
async function press(name: string) {
  await browser.$(DIALOG).$(`button=${name}`).click();
}
async function returned() {
  await browser.$(DIALOG).waitForExist({ reverse: true });
  await browser.waitUntil(() => browser.execute(() => document.activeElement?.matches("[data-settings-entry]") === true));
}

/** The ChromeDriver session's standard CDP endpoint; no additional package. */
async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw new Error("The owned ChromeDriver port is missing.");
  const root = `${protocol}://${hostname}:${port}${path.endsWith("/") ? path : path + "/"}`;
  const response = await fetch(new URL(`session/${browser.sessionId}/goog/cdp/execute`, root), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, params }),
  });
  const result = await response.json() as { value?: Record<string, unknown> };
  if (!response.ok || result.value?.error) throw new Error(`Chrome command refused: ${JSON.stringify(result)}`);
  return result.value ?? {};
}

async function metrics(width: number, height: number, dpr = 1) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false, screenWidth: Math.round(width * dpr), screenHeight: Math.round(height * dpr) });
  await browser.waitUntil(() => browser.execute((w, h, scale) => innerWidth === w && innerHeight === h && devicePixelRatio === scale, width, height, dpr));
}

async function reducedMotion(reduce: boolean) {
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
  });
  await browser.waitUntil(() => browser.execute(want => matchMedia("(prefers-reduced-motion: reduce)").matches === want, reduce));
}

/**
 * What is on screen, measured rather than asserted from the markup.
 *
 * Every control this milestone adds is reported with its own rectangle, so a
 * clipped label or an action pushed out of the first viewport is a number in
 * the evidence rather than something a reader has to notice in a screenshot.
 */
async function capture(label: string, expectedDpr?: number) {
  const state = await browser.execute(() => {
    const box = (element: Element | null) => {
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height,
        insideViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1,
        clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
        text: (element.textContent ?? "").trim(),
        fontSize: style.fontSize,
        disabled: (element as HTMLButtonElement).disabled ?? null,
        // The refusal that keeps a control reachable. `disabled` would take it
        // out of the tab order and put its reason behind a pointer.
        refused: element.getAttribute("aria-disabled") === "true",
        focusable: (element as HTMLButtonElement).disabled === false,
      };
    };
    const dialog = document.querySelector<HTMLElement>("[data-settings-dialog]");
    const named = (selector: string) => Object.fromEntries(
      [...document.querySelectorAll(selector)].map((element, index) => [
        `${element.getAttribute("data-backend-action") ?? element.getAttribute("data-layout-reset") ?? String(index)}`,
        box(element),
      ]),
    );
    return {
      cssViewport: { width: innerWidth, height: innerHeight }, devicePixelRatio,
      cssZoom: getComputedStyle(document.documentElement).zoom,
      locale: document.documentElement.lang,
      density: document.querySelector("[data-density]")?.getAttribute("data-density") ?? null,
      rosterOpen: document.querySelector(".workbench-shell")?.getAttribute("data-roster-open") ?? null,
      detailsOpen: document.querySelector(".workbench-shell")?.getAttribute("data-details-open") ?? null,
      backendStatus: document.querySelector("[data-backend-status]")?.getAttribute("data-backend-status") ?? null,
      backendReading: box(document.querySelector(".backend-status-reading")),
      backendActions: named("[data-backend-action]"),
      helpOpen: document.querySelector<HTMLDetailsElement>("[data-backend-help]")?.open ?? null,
      help: box(document.querySelector("[data-backend-help]")),
      // The help's scroll owner. The notices area is a bounded scrollport by
      // design, so "the details element is not clipped" says nothing about
      // whether the reader can see what they opened.
      //
      // Two different questions, because they have different answers at
      // different heights. Whether it fits is the one that matters where there
      // is room. Where there is not -- a 640px window cannot show eight
      // paragraphs at once whatever the bound is -- the question is whether
      // scrolling reaches the end of it, which is measured by actually
      // scrolling to the bottom and looking, then putting the scroll back.
      helpScrollport: (() => {
        const help = document.querySelector("[data-backend-help]");
        const port = help?.closest(".shell-notices") ?? null;
        if (help === null || port === null) return null;
        const outer = port.getBoundingClientRect();
        const inner = help.getBoundingClientRect();
        const fits = inner.bottom <= outer.bottom + 1;
        const restore = port.scrollTop;
        port.scrollTop = port.scrollHeight;
        const scrolled = help.getBoundingClientRect(), after = port.getBoundingClientRect();
        port.scrollTop = restore;
        return {
          scrollHeight: port.scrollHeight, clientHeight: port.clientHeight,
          scrollable: port.scrollHeight > port.clientHeight + 1,
          helpFitsWithoutScrolling: fits,
          // The end of what the reader opened, after scrolling as far as the
          // port goes. False is content cut off with no way to reach it.
          endReachable: scrolled.bottom <= after.bottom + 1,
        };
      })(),
      storageNote: box(document.querySelector("[data-storage-note]")),
      storedRecordAlert: box(document.querySelector("[data-stored-record='unusable']")),
      saveFailure: box(document.querySelector("[data-save='failed']")),
      saveRefused: box(document.querySelector("[data-save='refused']")),
      layoutReset: box(document.querySelector("[data-layout-reset]")),
      layoutUnsaved: box(document.querySelector("[data-layout-unsaved]")),
      layoutRegion: (document.querySelector("[data-live-region='layout']")?.textContent ?? "").trim(),
      preferenceRegion: (document.querySelector("[data-live-region='preferences']")?.textContent ?? "").trim(),
      inspector: box(document.querySelector(".inspector-panel")),
      dialog: dialog === null ? null : {
        ...box(dialog),
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
        scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight,
        primary: box(dialog.querySelector(".settings-dialog-actions .primary-button")),
      },
      // Everything on screen, for the one check that is only meaningful over
      // the whole document: whether a Chinese session is reading English.
      bodyText: (document.body.innerText ?? "").replace(/\s+/gu, " "),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      dialogAnimation: dialog === null ? null : getComputedStyle(dialog).animationName,
      externalResources: performance.getEntriesByType("resource").map(entry => entry.name)
        .filter(url => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof shot.data !== "string") throw new Error("Chrome did not return screenshot bytes.");
  const png = Buffer.from(shot.data, "base64");
  const raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  evidence.push({ label, kind: "browser mock IPC; CDP DPR emulation, browser zoom 100%; not Windows scaling and not disk", ...state, raster });
  writeFileSync(join(output, `${label}.png`), png);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  if (expectedDpr !== undefined) expect(state.devicePixelRatio).toBe(expectedDpr);
  expect(Math.abs(raster.width - state.cssViewport.width * state.devicePixelRatio)).toBeLessThanOrEqual(1);
  // Nothing this milestone renders is loaded from anywhere but this origin.
  expect(state.externalResources).toEqual([]);
  // The banner's reading and its actions must be on screen and unclipped
  // wherever the banner is on screen at all.
  if (state.backendReading !== null) {
    // Reported as one object per control, so a failure names which one rather
    // than needing an assertion message the pinned matcher does not take.
    const clipped = Object.entries(state.backendActions)
      .filter(([, action]) => action?.clipped === true || (action?.height ?? 0) < 24)
      .map(([id]) => `${label}:${id}`);
    expect(clipped).toEqual([]);
    expect(state.backendReading.clipped).toBe(false);
  }
  if (state.dialog !== null) {
    expect(state.dialog.left).toBeGreaterThanOrEqual(0);
    expect(state.dialog.top).toBeGreaterThanOrEqual(0);
    expect(state.dialog.right).toBeLessThanOrEqual(state.cssViewport.width + 1);
    expect(state.dialog.bottom).toBeLessThanOrEqual(state.cssViewport.height + 1);
    // The dialog itself scrolls; its footer action must be reachable.
    expect(state.dialog.scrollWidth).toBeLessThanOrEqual(state.dialog.clientWidth + 1);
    expect(state.dialog.primary?.clipped).toBe(false);
  }
  return state;
}

/** A session that has nothing stored, which is what a first run is. */
async function firstRun(table = ipcTable()) {
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$("[data-settings-entry]").waitForDisplayed();
}

describe("M7.5 durable preferences, first-run recovery and bilingual coverage", () => {
  before(() => {
    const root = process.env["MSCANVAS_M75_OUTPUT_ROOT"] ?? resolve("test-results/m7.5");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M7.5 browser evidence: ${output}`);
  });
  afterEach(async () => {
    const entries = await consoleEntries();
    evidence.push({ kind: "console", entries, calls: await ipcCalls() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
    // One third-party advisory is expected and is kept rather than silenced:
    // the pinned animation library logs it whenever `prefers-reduced-motion` is
    // set, which is the setting one of these cases emulates on purpose. Its
    // presence is evidence the emulation reached the library. Everything else
    // is a finding, so the filter names this message exactly.
    const unexpected = entries.filter(entry => !entry.text.startsWith(REDUCED_MOTION_ADVISORY));
    expect(unexpected).toEqual([]);
  });

  it("restores a stored record at each supported viewport, in both densities", async () => {
    const table = ipcTable();
    table.get_workspace_roster = {
      datasets: [
        selectedFile,
        { ...selectedFile, handle: "long-name", fileName: `${en.simplifiedChinese}_long_acquisition_name_preserved_without_ellipsis_or_identity_changes_2026_09_17.mzML` },
      ],
      capacity: 1024,
    };
    table.load_ui_preferences = {
      outcome: "loaded",
      revision: 3,
      preferences: record({ locale: "zh-CN", density: "compact" }, { roster: "shown", details: "hidden" }),
    };
    await installIpcBoundary(table);

    for (const [label, width, height, dpr] of [
      ["1920x1080", 1920, 1080, 1],
      ["1366x768", 1366, 768, 1],
      ["1280x800-dpr-1.5", 1280, 800, 1.5],
      ["960x640", 960, 640, 1],
    ] as const) {
      await metrics(width, height, dpr);
      await browser.url("/");
      await browser.$("[data-settings-entry]").waitForDisplayed();
      // The record is what the session starts on, at every one of these sizes.
      await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "zh-CN"));
      const state = await capture(`01-restored-${label}`, dpr);
      expect(state.locale).toBe("zh-CN");
      expect(state.density).toBe("compact");
      // The saved request, honoured at every one of these sizes. An explicit
      // choice is a choice: a window that gets narrow *while the session is
      // running* folds a panel away for space, and that is a session fact
      // rather than a stored one -- but starting a session at a narrow size on
      // a record that says `shown` shows it, because that is what was asked
      // for and nothing about it is unreachable.
      expect(state.detailsOpen).toBe("false");
      expect(state.rosterOpen).toBe("true");
      await openSettings();
      await capture(`02-restored-settings-${label}`, dpr);
      await press(zh.cancel);
      await returned();
    }
    await metrics(1920, 1080, 1);
  });

  it("applies, persists and reports each save outcome without leaving a contradiction on screen", async () => {
    await metrics(1440, 900, 1);
    await firstRun();
    // A first run starts on the defaults and writes nothing to make them
    // stored.
    let calls = await ipcCalls();
    expect(calls.filter(call => call.command === "save_ui_preferences")).toEqual([]);

    await openSettings();
    await choose("zh-CN");
    await choose("compact");
    await capture("03-settings-preview-zh-compact");
    await setInvokeResult("save_ui_preferences", {
      outcome: "saved",
      revision: 1,
      preferences: record({ locale: "zh-CN", density: "compact" }),
    });
    await press(zh.apply);
    await returned();
    const applied = await capture("04-applied-zh-compact");
    expect(applied.locale).toBe("zh-CN");
    expect(applied.density).toBe("compact");
    expect(applied.preferenceRegion).toBe(zh.applied);
    calls = await ipcCalls();
    const saved = calls.filter(call => call.command === "save_ui_preferences");
    expect(saved).toHaveLength(1);
    // Only the group Settings owns, and nothing that locates or names anything.
    expect(saved[0]?.args).toEqual({ request: { appearance: { locale: "zh-CN", density: "compact" } } });

    // A write that fails keeps the choices on screen and never claims they are
    // saved -- the footer and the alert have to agree.
    await setInvokeResult("save_ui_preferences", {
      outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false, revision: 1,
    });
    await openSettings();
    await choose("en");
    await press(en.apply);
    await browser.$("[data-save='failed']").waitForDisplayed();
    const failed = await capture("05-save-failed-retry-and-session-only");
    expect(failed.saveFailure?.text).toContain(en.writeNotPublished);
    expect(failed.storageNote?.text).toBe(en.storageNotSaving);
    expect(failed.saveFailure?.clipped).toBe(false);
    // The named session-only action, which claims no write.
    await press(en.saveSessionOnly);
    await returned();
    const sessionOnly = await capture("06-session-only-applied");
    expect(sessionOnly.locale).toBe("en");
    expect(sessionOnly.preferenceRegion).toBe(en.sessionOnlyApplied);
    await openSettings();
    expect((await capture("07-session-only-note")).storageNote?.text).toBe(en.sessionOnlyNote);
    await press(en.cancel);
    await returned();
  });

  it("keeps an unusable stored record until its replacement is confirmed", async () => {
    await metrics(1440, 900, 1);
    const table = ipcTable();
    table.load_ui_preferences = { outcome: "unusable", problem: "unsupportedVersion", revision: 0 };
    await firstRun(table);
    // Recoverable defaults, and no spinner.
    expect(await browser.execute(() => document.documentElement.lang)).toBe("en");

    await openSettings();
    const unusable = await capture("08-stored-record-unsupported-version");
    expect(unusable.storedRecordAlert?.text).toContain(en.storedUnsupportedVersion);
    expect(unusable.storedRecordAlert?.clipped).toBe(false);
    expect(unusable.storageNote?.text).toBe(en.storageNotSaving);

    // An ordinary apply is refused and says so about that press.
    await setInvokeResult("save_ui_preferences", {
      outcome: "storedRecordUnusable", problem: "unsupportedVersion", revision: 0,
    });
    await choose("zh-CN");
    await press(zh.apply);
    await browser.$("[data-save='refused']").waitForDisplayed();
    const refused = await capture("09-apply-refused-by-stored-record");
    expect(refused.saveRefused?.text).toContain(zh.saveRefusedTitle);

    // The confirmed replacement is the only thing that overwrites it.
    await setInvokeResult("save_ui_preferences", {
      outcome: "saved", revision: 1, preferences: record({ locale: "zh-CN", density: "comfortable" }),
    });
    await press(zh.storedReplace);
    await returned();
    const replaced = await capture("10-stored-record-replaced");
    expect(replaced.preferenceRegion).toBe(zh.storedReplaced);
    const requests = (await ipcCalls()).filter(call => call.command === "save_ui_preferences");
    expect((requests.at(-1)?.args as { request: { replaceUnusable?: boolean } }).request.replaceUnusable).toBe(true);
  });

  it("holds the gated startup state, and settles when the read answers", async () => {
    await metrics(1440, 900, 1);
    const table = ipcTable();
    table.load_ui_preferences = { outcome: "loaded", revision: 2, preferences: record({ locale: "zh-CN", density: "compact" }) };
    await installIpcBoundary(table, { hold: ["load_ui_preferences"] });
    await browser.url("/");
    await browser.$("[data-settings-entry]").waitForDisplayed();

    // Gated: no default is written and no editor is enabled before the read
    // resolves. Every refused control says why.
    const loading = await capture("11-startup-gated");
    expect(loading.layoutReset?.refused).toBe(true);
    expect(loading.layoutReset?.focusable).toBe(true);
    const toggles = await browser.execute(() => [...document.querySelectorAll(".workbench-global-actions button")]
      .map(control => ({ text: (control.textContent ?? "").trim(), disabled: (control as HTMLButtonElement).disabled,
        refused: control.getAttribute("aria-disabled") === "true", title: control.getAttribute("title") })));
    evidence.push({ kind: "startup gating", toggles });
    // Every refused control says why, and can be reached to be told: a
    // `disabled` button is not in the tab order, so a tooltip on one is a
    // reason only a pointer user can read.
    expect(toggles.filter(control => control.refused).length).toBeGreaterThan(0);
    expect(toggles.filter(control => control.refused).every(control => control.title === en.panelsLoading && !control.disabled)).toBe(true);
    expect((await ipcCalls()).filter(call => call.command === "save_ui_preferences")).toEqual([]);

    await releaseInvokeHold("load_ui_preferences");
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "zh-CN"));
    const settled = await capture("12-startup-settled");
    expect(settled.density).toBe("compact");
    expect(settled.layoutReset?.refused).toBe(true);
  });

  it("commits a panel arrangement, reports one that would not survive, and resets it", async () => {
    await metrics(1440, 900, 1);
    await firstRun();
    await setInvokeResult("save_ui_preferences", {
      outcome: "saved", revision: 1, preferences: record({ locale: "en", density: "comfortable" }, { roster: "hidden", details: "automatic" }),
    });
    await browser.$(`button=${en.rosterToggle}`).click();
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".workbench-shell")?.getAttribute("data-roster-open") === "false"));
    const committed = await capture("13-roster-hidden-committed");
    expect(committed.layoutReset?.refused).toBe(false);
    const layoutCalls = (await ipcCalls()).filter(call => call.command === "save_ui_preferences");
    expect(layoutCalls.at(-1)?.args).toEqual({ request: { layout: { roster: "hidden", details: "automatic" } } });

    // A commit that fails leaves the arrangement on screen and says it will not
    // survive a restart, with a retry.
    await setInvokeResult("save_ui_preferences", {
      outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false, revision: 1,
    });
    await browser.$(`button=${en.rosterToggle}`).click();
    await browser.$("[data-layout-unsaved]").waitForDisplayed();
    const unsaved = await capture("14-layout-unsaved-with-retry");
    expect(unsaved.rosterOpen).toBe("true");
    expect(unsaved.layoutUnsaved?.clipped).toBe(false);
    expect(unsaved.layoutRegion).toBe(en.layoutUnsaved);

    // And the reset is reachable, keeps the keyboard, and announces itself.
    await setInvokeResult("save_ui_preferences", {
      outcome: "saved", revision: 2, preferences: record({ locale: "en", density: "comfortable" }),
    });
    await browser.$("[data-layout-reset]").click();
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLButtonElement>("[data-layout-reset]")?.disabled === true));
    const reset = await capture("15-layout-reset");
    expect(reset.layoutRegion).toBe(en.layoutResetDone);
    expect(reset.layoutReset?.insideViewport).toBe(true);
    // The control stays in the document, and the keyboard goes to the adjacent
    // durable control rather than to the body -- a browser blurs a control it
    // has just disabled, so "still mounted" is not on its own enough.
    expect(await browser.execute(() => (document.activeElement?.textContent ?? "").trim())).toBe(en.rosterToggle);
  });

  it("reads every backend state, and its offline help, in both languages", async () => {
    await metrics(1440, 900, 1);
    for (const [label, availability, expected] of [
      ["missing", unavailableBackend, "missing"],
      ["unsupported", chosenFolderWithoutTools, "unsupported"],
      ["quarantined", quarantinedBackend, "quarantined"],
      ["available", availableBackend, "available"],
    ] as const) {
      const table = ipcTable();
      table.inspect_backend = availability;
      await installIpcBoundary(table);
      await browser.url("/");
      await browser.$("[data-backend-status]").waitForDisplayed();
      await browser.waitUntil(() => browser.execute(want => document.querySelector("[data-backend-status]")?.getAttribute("data-backend-status") === want, expected));
      const state = await capture(`16-backend-${label}-en`);
      expect(state.backendStatus).toBe(expected);
      // Every state offers a way to ask again, and the help is beside it.
      expect(Object.keys(state.backendActions)).toContain("recheck");
      expect(state.help).not.toBeNull();
      expect(state.helpOpen).toBe(false);

      // Opened, read, and unclipped.
      await browser.$("[data-backend-help] summary").click();
      await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLDetailsElement>("[data-backend-help]")?.open === true));
      const opened = await capture(`17-backend-${label}-help-en`);
      expect(opened.help?.clipped).toBe(false);
      // What the reader opened is visible without having to discover that the
      // notices area scrolls.
      expect(opened.helpScrollport?.helpFitsWithoutScrolling).toBe(true);
      expect(opened.helpScrollport?.endReachable).toBe(true);
      expect(opened.help?.text).toContain("Windows 11 25H2 x64");
      expect(opened.help?.text).toContain(en.backendHelpSessionScope);
    }

    // And the same states in Simplified Chinese, with the help translated and
    // the identifiers preserved.
    const table = ipcTable();
    table.inspect_backend = unavailableBackend;
    table.load_ui_preferences = { outcome: "loaded", revision: 1, preferences: record({ locale: "zh-CN", density: "comfortable" }) };
    await installIpcBoundary(table);
    await browser.url("/");
    await browser.$("[data-backend-status]").waitForDisplayed();
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "zh-CN"));
    await browser.$("[data-backend-help] summary").click();
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLDetailsElement>("[data-backend-help]")?.open === true));
    const chinese = await capture("18-backend-missing-help-zh");
    expect(chinese.backendReading?.text).toContain(zh.backendMissing);
    expect(chinese.backendReading?.text).toContain(zh.backendNotFound);
    expect(chinese.help?.text).toContain(zh.backendHelpProvider);
    expect(chinese.help?.text).toContain("msconvert.exe");
    expect(chinese.help?.text).toContain("Windows 11 25H2 x64");
    expect(chinese.help?.text).not.toContain(en.backendHelpProvider);
  });

  it("reads the inspector panel in Simplified Chinese, with the file's own words original", async () => {
    await metrics(1920, 1080, 1);
    const table = ipcTable();
    table.load_ui_preferences = { outcome: "loaded", revision: 1, preferences: record({ locale: "zh-CN", density: "comfortable" }, { roster: "shown", details: "shown" }) };
    await installIpcBoundary(table);
    await browser.url("/");
    await browser.$(ROW).waitForDisplayed();
    await browser.$(ROW).click();
    await browser.$(`button=${zh.previewFocused}`).waitForEnabled();
    await browser.$(`button=${zh.previewFocused}`).click();
    await browser.$(".inspector-panel").waitForDisplayed();
    const state = await capture("19-inspector-zh");
    expect(state.detailsOpen).toBe("true");
    const inspector = state.inspector?.text ?? "";
    expect(inspector).toContain(zh.summaryRun);
    expect(inspector).toContain(zh.summarySpectra);
    expect(inspector).toContain(zh.summaryTiming);
    // The unreported state stays the unreported state.
    expect(inspector).not.toContain("(unit not reported)");
    expect(inspector).not.toContain(en.summaryRetentionTime);
    // Nothing clipped, and the panel owns its own scroll.
    expect(state.inspector?.insideViewport).toBe(true);

    // And nothing anywhere in this session is reading English where a Chinese
    // value exists. Named sentences rather than a heuristic: each is a value
    // this build owns, each has a translation, and each has reached a Chinese
    // session in English at some point in this milestone.
    // Only sentences this session can actually render: naming an error
    // sentence here would assert the absence of something the scenario has no
    // way to produce. The boundary errors are swept in their own case below,
    // where one is on screen.
    const english = [
      en.backendMissing, en.backendNotFound, en.backendHelpProvider,
      en.summaryRun, en.summaryRetentionTime, en.summaryTiming, en.summaryNotMeasured,
      en.rosterToggle, en.layoutReset, en.settings, en.viewerData,
      "(unit not reported)",
    ].filter(sentence => (state.bodyText ?? "").includes(sentence));
    evidence.push({ kind: "english still reachable in a Chinese session", english });
    expect(english).toEqual([]);
  });

  it("holds every state at 960x640 with reduced motion, and reports what it cannot say", async () => {
    await reducedMotion(true);
    await metrics(960, 640, 1);
    const table = ipcTable();
    table.inspect_backend = unavailableBackend;
    table.load_ui_preferences = { outcome: "unusable", problem: "malformed", revision: 0 };
    await installIpcBoundary(table);
    await browser.url("/");
    await browser.$("[data-settings-entry]").waitForDisplayed();
    const narrow = await capture("20-narrow-reduced-motion");
    expect(narrow.reducedMotion).toBe(true);
    // The emulation reached the animation library, which is what its own
    // advisory in the console proves.
    const advisories = (await consoleEntries()).filter(entry => entry.text.startsWith(REDUCED_MOTION_ADVISORY));
    evidence.push({ kind: "reduced motion reached the animation library", count: advisories.length });

    // The help, at the shortest viewport this milestone supports. A 640px
    // window cannot show eight paragraphs at once whatever the bound is, so
    // the requirement here is that the end of what the reader opened can be
    // reached -- not that it all fits.
    await browser.$("[data-backend-help] summary").click();
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLDetailsElement>("[data-backend-help]")?.open === true));
    const narrowHelp = await capture("20b-narrow-help-open");
    expect(narrowHelp.helpOpen).toBe(true);
    expect(narrowHelp.help?.clipped).toBe(false);
    expect(narrowHelp.helpScrollport?.endReachable).toBe(true);
    expect(narrowHelp.help?.text).toContain(en.backendHelpSessionScope);
    await browser.$("[data-backend-help] summary").click();
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLDetailsElement>("[data-backend-help]")?.open === false));
    expect(advisories.length).toBeGreaterThan(0);
    // Nothing animates into place at this setting.
    expect(narrow.rosterOpen).toBe("false");

    await openSettings();
    const dialog = await capture("21-narrow-settings-unusable");
    expect(dialog.reducedMotion).toBe(true);
    expect(dialog.dialogAnimation === null || dialog.dialogAnimation === "none").toBe(true);
    // Both the recovery block and the footer fit, and the Apply action is
    // reachable without a horizontal scroll.
    expect(dialog.storedRecordAlert?.clipped).toBe(false);
    expect(dialog.dialog?.primary?.insideViewport).toBe(true);
    await press(en.cancel);
    await returned();
    await reducedMotion(false);

    evidence.push({
      kind: "limits",
      notProvenHere: [
        "whether any preference reached disk",
        "Windows focus, Windows scaling and any native picker",
        "the QA preference-root isolation, which is a compiled-build mechanism",
      ],
    });
  });
});
