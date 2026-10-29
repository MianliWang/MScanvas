/**
 * PM9.7 -- the states the v5.11 comparison never captured (baseline.md §3.1,
 * §10), rendered on the integrated product: the application's empty and entry
 * states (I1), scrolled positions (I2) and focus-driven positions (I3)
 * (`docs/phases/pm9/slice-07.md` §6).
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced. Every answer
 * is a controlled fixture from `e2e/support/pm9Scenarios.ts`: no file was
 * read, no dialog opened, no provider or engine ran. Layout, focus and
 * keyboard evidence at DPR 1, not native scaling.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cdp, metrics } from "../support/cdp";
import { MZML_ROW } from "../support/fixtures";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, installIpcBoundary } from "../support/harness";
import { EMPTY_ROSTER, NO_PROJECT, scenario } from "../support/pm9Scenarios";
import { type Locale } from "../support/targeted";
import { readBackSavedPreferences, revealRosterRow, selectTheSpectrum } from "../support/viewer";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

const BUNDLES = { en, "zh-CN": zhCN } as const;
const LOCALES: readonly Locale[] = ["en", "zh-CN"];
const ANCHORS = [
  [1920, 1080],
  [1366, 768],
  [960, 640],
] as const;

/** motion's development-build notice when the page asks for reduced motion. */
const REDUCED_MOTION_NOTICE = "You have Reduced Motion enabled on your device";
const CONVERT = "button.conversion-start";
const ROSTER_TOGGLE = '[aria-controls="workbench-roster"]';
/** DESIGN_SYSTEM's focus ring: 2 px, solid, the one focus colour `#1769d1` (UI-46). */
const RING = "2px solid rgb(23, 105, 209)";

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function navigate(name: string) {
  const found = await browser.execute((label: string) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => (button.textContent ?? "").trim() === label);
    target?.click();
    return target !== undefined;
  }, name);
  // Project is the header menu's first item, not a tab (rebuild spec 1.1).
  if (!found) {
    await browser.$("[data-project-menu]").click();
    await browser.$('[data-project-menu-item="surface"]').waitForDisplayed();
    await browser.$('[data-project-menu-item="surface"]').click();
  }
  await frames();
}

/** Opens the page on `table`; zh-CN samples reduced motion, as PM9-G does. */
async function open(table: Record<string, unknown>, locale: Locale, width: number, height: number) {
  await metrics(width, height);
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: locale === "zh-CN" ? "reduce" : "no-preference" }],
  });
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 30_000 });
  await browser.waitUntil(() => browser.execute((lang: string) => document.documentElement.lang === lang, locale));
  await readBackSavedPreferences();
}

async function unexpectedConsole(locale: Locale): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .filter((entry) => !(locale === "zh-CN" && entry.text.includes(REDUCED_MOTION_NOTICE)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** The shell with nothing in it: no acquisition and no project. */
function emptyTable(locale: Locale): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.get_workspace_roster = EMPTY_ROSTER;
  table.get_project_state = NO_PROJECT;
  return table;
}

/** A frame and what it shows: viewport, panels, document overflow, the surface's scroll and focus. */
async function sample(label: string) {
  await frames();
  const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof shot.data === "string") writeFileSync(join(output, `${label}.png`), Buffer.from(shot.data, "base64"));
  const measured = await browser.execute(() => {
    const shell = document.querySelector<HTMLElement>(".workbench-shell");
    const surface = shell?.getAttribute("data-surface") ?? null;
    const owner = document.querySelector<HTMLElement>(
      surface === "conversion" ? "#workbench-conversion" : surface === "project" ? "#workbench-project" : "#workbench-evidence",
    );
    const header = document.querySelector(".workbench-header")?.getBoundingClientRect() ?? null;
    const active = document.activeElement;
    const focus = active === null || active === document.body ? null : active.getBoundingClientRect();
    return {
      css: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      userAgent: navigator.userAgent,
      lang: document.documentElement.lang,
      surface,
      panels: { roster: shell?.getAttribute("data-roster-open") ?? null, details: shell?.getAttribute("data-details-open") ?? null },
      overflow: {
        x: document.documentElement.scrollWidth - innerWidth,
        y: document.documentElement.scrollHeight - innerHeight,
      },
      header: header === null ? null : { top: header.top, bottom: header.bottom },
      owner:
        owner === null
          ? null
          : {
              top: owner.getBoundingClientRect().top,
              bottom: owner.getBoundingClientRect().bottom,
              scrollTop: owner.scrollTop,
              clientHeight: owner.clientHeight,
              scrollHeight: owner.scrollHeight,
            },
      focus: focus === null ? null : { tag: active!.tagName, text: (active!.textContent ?? "").trim().slice(0, 60), top: focus.top, bottom: focus.bottom },
      text: (owner?.innerText ?? "").slice(0, 4_000),
    };
  });
  evidence.push({ label, candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled", ...measured });
  return measured;
}

/** A frame only, for the moments a keyboard stop is what the frame is for. */
async function shot(label: string) {
  await frames();
  const capture = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof capture.data === "string") writeFileSync(join(output, `${label}.png`), Buffer.from(capture.data, "base64"));
}

/** The button inside `scope` whose trimmed text is `name`, marked so WebDriver can address it. */
async function mark(scope: string, name: string, tag: string): Promise<string | null> {
  return browser.execute(
    (css: string, label: string, attribute: string) => {
      document.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute));
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)].find(
        (candidate) => (candidate.textContent ?? "").trim() === label && candidate.getClientRects().length > 0,
      );
      if (button === undefined) return null;
      button.setAttribute(attribute, "");
      return `[${attribute}]`;
    },
    scope,
    name,
    tag,
  );
}

/** Whether a control is offered: on screen in layout terms, not disabled, not refused. */
function offered(selector: string): Promise<boolean> {
  return browser.execute((css: string) => {
    const node = document.querySelector<HTMLButtonElement>(css);
    return node !== null && node.getClientRects().length > 0 && !node.disabled && node.getAttribute("aria-disabled") !== "true";
  }, selector);
}

/** Tabs from the brand until `selector` has focus; the number of presses, or null if never. */
async function tabsTo(selector: string, limit = 60): Promise<number | null> {
  await browser.execute(() => document.querySelector<HTMLElement>(".workbench-home")?.focus());
  for (let presses = 0; presses <= limit; presses += 1) {
    if (await browser.execute((css: string) => document.activeElement === document.querySelector(css), selector)) return presses;
    await browser.keys(["Tab"]);
  }
  return null;
}

/** `tabsTo`, with the number of presses kept in the evidence. */
async function reach(selector: string, label: string): Promise<number | null> {
  const presses = await tabsTo(selector);
  evidence.push({ reach: label, selector, presses });
  // A frame for the ring to settle: under reduced motion every property
  // transitions for 0.01 ms (app.css), so a reading taken in the same frame
  // as the Tab sees the ring half-way there.
  await frames();
  return presses;
}

/** Unfolds a folded roster the way a keyboard user does: Tab to Acquisitions, then Enter. */
async function unfoldRoster(label: string) {
  expect(await reach(ROSTER_TOGGLE, `${label} acquisitions`)).not.toBeNull();
  await browser.keys(["Enter"]);
  await browser.waitUntil(
    () => browser.execute(() => document.querySelector(".workbench-shell")?.getAttribute("data-roster-open") === "true"),
    { timeoutMsg: `${label}: Enter on Acquisitions did not unfold the roster` },
  );
  await frames();
}

/**
 * Where the focused control is: inside the viewport and inside every
 * scrolling ancestor's visible box, not covered (the point at its centre hits
 * it), and drawn with a focus treatment.
 */
function focusFacts() {
  return browser.execute(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active === null || active === document.body) return { onBody: true } as const;
    const rect = active.getBoundingClientRect();
    const tolerance = 1;
    const inside = (box: DOMRect, outer: DOMRect) =>
      box.top >= outer.top - tolerance &&
      box.bottom <= outer.bottom + tolerance &&
      box.left >= outer.left - tolerance &&
      box.right <= outer.right + tolerance;
    // The ring as drawn, not only the control: its offset plus its width, the
    // reach PM9.1's UI-08 and UI-20 measure. An inset ring reaches no further.
    const own = getComputedStyle(active);
    const reach = Math.max(0, (Number.parseFloat(own.outlineOffset) || 0) + (Number.parseFloat(own.outlineWidth) || 0));
    const ringBox = new DOMRect(rect.left - reach, rect.top - reach, rect.width + 2 * reach, rect.height + 2 * reach);
    const clippers: string[] = [];
    for (let node = active.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const scrolls = /(auto|scroll|hidden)/u.test(`${style.overflowX} ${style.overflowY}`);
      if (scrolls && !inside(ringBox, node.getBoundingClientRect())) clippers.push(`${node.tagName}.${String(node.className).split(" ")[0] ?? ""}#${node.id}`);
    }
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    const label = active.closest("label");
    const covered = hit === null || !(hit === active || active.contains(hit) || hit.contains(active) || (label !== null && label.contains(hit)));
    const style = getComputedStyle(active);
    const ring =
      (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 1) || (style.boxShadow !== "none" && style.boxShadow !== "");
    // The accessible name as a reader hears it, a field's label included.
    const labelledBy = (active.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const fieldLabel = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement ? (active.labels?.[0]?.textContent ?? "") : "";
    const name = active.getAttribute("aria-label") ?? (labelledBy || fieldLabel || (active.textContent ?? ""));
    return {
      onBody: false,
      name: `${active.tagName} ${name.trim().slice(0, 50)}`,
      // What the treatment is, beside whether there is one: DESIGN_SYSTEM's
      // 2 px outline with an offset, in the focus colour.
      treatment: { outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`, offset: style.outlineOffset, shadow: style.boxShadow },
      zeroSize: rect.width === 0 || rect.height === 0,
      inViewport: inside(rect, new DOMRect(0, 0, innerWidth, innerHeight)),
      clippedBy: clippers,
      covered,
      ring,
    } as const;
  });
}

describe("PM9.7 integrated states, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.7");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`PM9.7 browser evidence: ${output}`);
  });

  afterEach(async function () {
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state });
    if (this.currentTest?.state === "failed") await browser.saveScreenshot(join(output, `failure-${String(evidence.length)}.png`));
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  for (const locale of LOCALES) {
    const words = BUNDLES[locale];
    for (const [width, height] of ANCHORS) {
      const at = `${locale}-${String(width)}x${String(height)}`;

      it(`PM9.7-I1 the empty and entry states name a reachable next action, ${at}`, async () => {
        await open(emptyTable(locale), locale, width, height);

        // Workbench: the evidence column invites data, and the roster's Add files… is that action.
        await browser.$(".roster-empty").waitForExist({ timeout: 30_000 });
        const workbench = await sample(`i1-workbench-${at}`);
        expect(workbench.surface).toBe("workbench");
        expect(workbench.text).toContain(words.emptyEvidence);
        let add = await mark(".workbench-shell", words.addFiles, "data-pm97-add");
        if (add === null) {
          // Folded below 1050 px: the header's Acquisitions action unfolds it.
          await unfoldRoster(`i1-workbench-${at}`);
          add = await mark(".workbench-shell", words.addFiles, "data-pm97-add");
        }
        expect(add).not.toBeNull();
        expect(await offered(add!)).toBe(true);
        expect(await reach(add!, `i1-workbench-${at} add files`)).not.toBeNull();
        expect(await focusFacts()).toMatchObject({ onBody: false, inViewport: true, covered: false, ring: true, treatment: { outline: RING } });
        await shot(`i1-workbench-${at}-add-focused`);
        expect(workbench.overflow.x).toBeLessThanOrEqual(0);
        expect(workbench.overflow.y).toBeLessThanOrEqual(0);

        // Conversion: nothing to convert, and Convert is not offered as if it could start.
        await navigate(words.conversionTask);
        await browser.$("#workbench-conversion").waitForDisplayed({ timeout: 30_000 });
        const conversion = await sample(`i1-conversion-${at}`);
        expect(conversion.surface).toBe("conversion");
        if (await browser.$(CONVERT).isExisting()) expect(await offered(CONVERT)).toBe(false);
        expect(conversion.overflow.x).toBeLessThanOrEqual(0);
        expect(conversion.overflow.y).toBeLessThanOrEqual(0);
        // Its next action is to add acquisitions: the same Add files…, reached by
        // keyboard from this surface, through Acquisitions where it is folded.
        let more = await mark(".workbench-shell", words.addFiles, "data-pm97-add");
        if (more === null) {
          await unfoldRoster(`i1-conversion-${at}`);
          more = await mark(".workbench-shell", words.addFiles, "data-pm97-add");
        }
        expect(more).not.toBeNull();
        expect(await reach(more!, `i1-conversion-${at} add files`)).not.toBeNull();
        expect(await focusFacts()).toMatchObject({ onBody: false, inViewport: true, covered: false, ring: true, treatment: { outline: RING } });
        await shot(`i1-conversion-${at}-add-focused`);

        // Project: no project, and New project / Open project… are the next actions.
        await navigate(words.projectSurface);
        await browser.$("[data-project-surface]").waitForDisplayed({ timeout: 30_000 });
        const project = await sample(`i1-project-${at}`);
        expect(project.text).toContain(words.projectNoneHint);
        const create = await mark(".project-header", words.projectNew, "data-pm97-new");
        const reopen = await mark(".project-header", words.projectOpen, "data-pm97-open");
        expect([create, reopen].every((selector) => selector !== null)).toBe(true);
        expect([await offered(create!), await offered(reopen!)]).toEqual([true, true]);
        // Save, Save As… and Close are refused with nothing open: they read as
        // refused, point at the no-project heading and say why (PM9.7 F1).
        const refused = await browser.execute(
          (labels: string[]) =>
            labels.map((label) => {
              const button = [...document.querySelectorAll<HTMLButtonElement>(".project-header button")].find(
                (candidate) => (candidate.textContent ?? "").trim() === label,
              );
              return button === undefined
                ? { label, found: false }
                : {
                    label,
                    found: true,
                    refused: button.getAttribute("aria-disabled"),
                    disabled: button.disabled,
                    opacity: getComputedStyle(button).opacity,
                    title: button.title,
                    describedBy: document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent?.trim() ?? null,
                  };
            }),
          [words.projectSave, words.projectSaveAs, words.projectClose],
        );
        evidence.push({ refusedActions: `i1-project-${at}`, refused });
        for (const fact of refused) {
          expect(fact).toMatchObject({
            found: true,
            refused: "true",
            disabled: false,
            opacity: "0.48",
            // The visible no-project heading is the reason; no tooltip repeats it.
            title: "",
            describedBy: words.projectNone,
          });
        }
        // Focused, a refused action keeps its full ring rather than fading with it.
        const save = await mark(".project-header", words.projectSave, "data-pm97-save");
        expect(await reach(save!, `i1-project-${at} save (refused)`)).not.toBeNull();
        expect(await browser.execute(() => getComputedStyle(document.activeElement!).opacity)).toBe("1");
        expect(await focusFacts()).toMatchObject({ onBody: false, inViewport: true, covered: false, ring: true, treatment: { outline: RING } });
        await shot(`i1-project-${at}-save-refused-focused`);

        expect(await reach(create!, `i1-project-${at} new project`)).not.toBeNull();
        expect(await focusFacts()).toMatchObject({ onBody: false, inViewport: true, covered: false, ring: true, treatment: { outline: RING } });
        await shot(`i1-project-${at}-new-focused`);
        expect(project.overflow.x).toBeLessThanOrEqual(0);
        expect(project.overflow.y).toBeLessThanOrEqual(0);
        expect(await unexpectedConsole(locale)).toEqual([]);
      });
    }

    for (const [width, height] of [
      [1366, 768],
      [960, 640],
    ] as const) {
      const at = `${locale}-${String(width)}x${String(height)}`;

      it(`PM9.7-I2 scrolled to the end, the header stays and the last content is reachable, ${at}`, async () => {
        // The viewer, its evidence column scrolled to the end.
        await open(scenario("populated", locale), locale, width, height);
        await revealRosterRow(MZML_ROW.handle);
        await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
        await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
        await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForExist({ timeout: 60_000 });
        await selectTheSpectrum(0);
        await browser.execute(() => {
          const column = document.querySelector<HTMLElement>("#workbench-evidence");
          if (column !== null) column.scrollTop = column.scrollHeight;
        });
        const viewer = await sample(`i2-viewer-end-${at}`);
        const scans = await browser.execute(() => {
          const column = document.querySelector("#workbench-evidence")!.getBoundingClientRect();
          const panel = document.querySelector(".spectrum-table-panel")?.getBoundingClientRect() ?? null;
          return { columnBottom: column.bottom, panelBottom: panel?.bottom ?? null };
        });
        expect(viewer.owner).not.toBeNull();
        expect(viewer.owner!.scrollTop + viewer.owner!.clientHeight).toBeGreaterThanOrEqual(viewer.owner!.scrollHeight - 1);
        expect(scans.panelBottom).not.toBeNull();
        expect(scans.panelBottom!).toBeLessThanOrEqual(scans.columnBottom + 1);
        expect(viewer.header!.top).toBeGreaterThanOrEqual(0);
        expect(viewer.header!.bottom).toBeLessThanOrEqual(viewer.owner!.top + 1);
        expect(viewer.overflow).toEqual({ x: 0, y: 0 });

        // The Project with recorded work, scrolled to its history's end.
        await open(scenario("projectWithResult", locale), locale, width, height);
        await navigate(BUNDLES[locale].projectSurface);
        await browser.$("[data-project-run]").waitForExist({ timeout: 30_000 });
        await browser.execute(() => {
          const surface = document.querySelector<HTMLElement>("#workbench-project");
          if (surface !== null) surface.scrollTop = surface.scrollHeight;
        });
        const project = await sample(`i2-project-end-${at}`);
        const lastRun = await browser.execute(() => {
          const runs = [...document.querySelectorAll("[data-project-run]")];
          return runs.length === 0 ? null : runs[runs.length - 1]!.getBoundingClientRect().bottom;
        });
        expect(project.owner).not.toBeNull();
        expect(lastRun).not.toBeNull();
        expect(lastRun!).toBeLessThanOrEqual(project.owner!.bottom + 1);
        expect(project.header!.top).toBeGreaterThanOrEqual(0);
        expect(project.header!.bottom).toBeLessThanOrEqual(project.owner!.top + 1);
        expect(project.overflow).toEqual({ x: 0, y: 0 });
        expect(await unexpectedConsole(locale)).toEqual([]);
      });
    }

    it(`PM9.7-I3 a keyboard walk keeps every focused control on screen and visibly focused, ${locale}-960x640 and 1366x768`, async () => {
      // Forward from the brand to the document's last stop. Focus reaching
      // `body` there is the walk leaving the page, not a stop.
      const walk = async (label: string, atLeast: number, limit = 80) => {
        await browser.execute(() => document.querySelector<HTMLElement>(".workbench-home")?.focus());
        const stops: unknown[] = [];
        for (let press = 0; press < limit; press += 1) {
          await browser.keys(["Tab"]);
          await frames();
          const facts = await focusFacts();
          if (facts.onBody) break;
          stops.push(facts);
          // A frame of every eighth stop, so the treatment is seen, not only computed.
          if (stops.length % 8 === 1) await shot(`i3-${label}-${locale}-stop-${String(stops.length).padStart(2, "0")}`);
          // Every stop is a real, visible place: not hidden by a scroll owner
          // or the header, and drawn as focused.
          expect({ label, press, facts }).toMatchObject({
            label,
            press,
            facts: { zeroSize: false, inViewport: true, clippedBy: [], covered: false, ring: true, treatment: { outline: RING } },
          });
        }
        evidence.push({ walk: label, stops });
        await sample(`i3-${label}-${locale}`);
        expect(stops.length).toBeGreaterThanOrEqual(atLeast);
      };

      await open(scenario("populated", locale), locale, 960, 640);
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
      await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForExist({ timeout: 60_000 });
      await selectTheSpectrum(0);
      await walk("viewer-960x640", 13);

      await open(scenario("projectWithResult", locale), locale, 960, 640);
      await navigate(BUNDLES[locale].projectSurface);
      await browser.$("[data-project-run]").waitForExist({ timeout: 30_000 });
      await walk("project-960x640", 8);

      // At 1366x768 the roster stays open beside the evidence, so the walk
      // crosses its search, sort, help, actions and rows too.
      await open(scenario("populated", locale), locale, 1366, 768);
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
      await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForExist({ timeout: 60_000 });
      await selectTheSpectrum(0);
      await walk("workbench-1366x768", 20, 120);
      expect(await unexpectedConsole(locale)).toEqual([]);
    });
  }
});
