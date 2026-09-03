/**
 * M6.4 rendered QA — the visible conversion settings, and the plan they produce.
 *
 * The unit suites pin the graph, the refusals, the plan identity and the
 * binding. What only a browser can answer is whether the four groups are
 * reachable and legible at the windows people use, whether a refused value is
 * refused to a real pointer and a real keyboard in the shipped bundle, whether
 * the disclosures a scientist needs are on screen rather than in a title
 * attribute, and whether pressing Convert sends the semantic the summary above
 * it was describing.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * below about what did or did not cross the boundary is a claim about the
 * shipped frontend.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  consoleEntries,
  heldInvokeCount,
  holdInvoke,
  horizontalOverflow,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeResult,
} from "../support/harness";
import { ipcTable, VENDOR_ROW } from "../support/fixtures";
import {
  availableBackend,
  intentCatalog,
  intentFor,
  queueItem,
  queueOf,
  SHIPPED_INTENT,
  unavailableBackend,
} from "../../apps/desktop/src/test/previewFixtures";

const VIEWPORTS = [
  { name: "1920x1080", width: 1_920, height: 1_080 },
  { name: "1366x768", width: 1_366, height: 768 },
  { name: "960x640", width: 960, height: 640 },
] as const;

const PANEL = "section.conversion-panel";
const SIDEBAR = ".workspace-sidebar";
const VENDOR = `li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`;
const SETTINGS = `${PANEL} .conversion-settings`;
const PLAN_FACTS = `${PANEL} [data-plan-facts="intent"]`;

/** The plan Rust answers with, for one semantic. */
function planFor(intent: unknown) {
  return {
    items: [
      {
        datasetHandle: VENDOR_ROW.handle,
        fileName: VENDOR_ROW.fileName,
        sourceKind: VENDOR_ROW.sourceKind,
        output: { kind: "knownSingle", fileName: "sample-9.mzML" },
      },
    ],
    intent,
    conflictPolicy: "fail",
    validationMode: "output_only",
    capacity: 16,
    installationGeneration: 0,
  };
}

/** A workspace with one convertible row focused and its settings on screen. */
async function openTheSettings(
  options: { readonly width?: number; readonly height?: number } = {},
): Promise<void> {
  await browser.setWindowSize(options.width ?? 1_366, options.height ?? 768);
  await installIpcBoundary({
    ...ipcTable(),
    describe_workspace_conversion_queue: planFor(SHIPPED_INTENT),
  });
  await browser.url("/");
  await browser.$(VENDOR).waitForDisplayed({ timeout: 60_000 });
  await browser.$(VENDOR).click();
  await browser.$(PANEL).waitForDisplayed({ timeout: 60_000 });
  await browser.$(SETTINGS).waitForDisplayed({ timeout: 60_000 });
}

/** One radio, addressed the way the document actually names it. */
function radio(axis: string, value: string): string {
  return `${SETTINGS} fieldset[data-axis="${axis}"] input[value="${value}"]`;
}

/** Whether one radio is checked, read from the live element. */
async function isChecked(selector: string): Promise<boolean> {
  return browser.execute(
    (target: string) => (document.querySelector(target) as HTMLInputElement | null)?.checked ?? false,
    selector,
  );
}

/** The sentence a control points at, resolved the way a screen reader does. */
async function describedText(selector: string): Promise<string> {
  return browser.execute((target: string) => {
    const control = document.querySelector(target);
    const ids = control?.getAttribute("aria-describedby") ?? "";
    return ids
      .split(/\s+/u)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }, selector);
}

/** What the plan states about one named fact. */
async function planFact(term: string): Promise<string> {
  return browser.execute(
    (selector: string, wanted: string) => {
      const list = document.querySelector(selector);
      const found = [...(list?.querySelectorAll("dt") ?? [])].find(
        (each) => each.textContent === wanted,
      );
      return found?.nextElementSibling?.textContent ?? "";
    },
    PLAN_FACTS,
    term,
  );
}

/** The semantic every begin request carried, in order. */
function begunIntents(calls: { command: string; args?: Record<string, unknown> }[]): unknown[] {
  return calls
    .filter((call) => call.command === "begin_workspace_conversion_queue")
    .map((call) => call.args?.["intentId"]);
}

/** The semantic every plan read asked about, in order. */
function describedIntents(calls: { command: string; args?: Record<string, unknown> }[]): unknown[] {
  return calls
    .filter((call) => call.command === "describe_workspace_conversion_queue")
    .map((call) => call.args?.["intentId"]);
}

/** Re-reads the backend the way a reader can: the banner's own control. */
async function recheckTheBackend(): Promise<void> {
  const buttons = await browser.$$("button.link-button");
  for (const button of buttons) {
    if ((await button.getText()).trim() === "Check again") {
      await button.click();
      return;
    }
  }
  throw new Error("the backend banner offers no Check again");
}

/** How many times one command has crossed the boundary. */
async function callsOf(command: string): Promise<number> {
  return (await ipcCalls()).filter((call) => call.command === command).length;
}

/** Every backend process this session has asked Rust to launch. */
async function backendProbes(): Promise<number> {
  return callsOf("inspect_backend");
}

/** Every `msconvert --help` this session has spent on reading the catalog. */
async function catalogProbes(): Promise<number> {
  return callsOf("get_workspace_conversion_intents");
}

/** One conversion slot answer, as Rust serializes it. */
function slot(
  state: unknown,
  options: { readonly sequence: number; readonly installationGeneration: number },
) {
  return {
    sequence: options.sequence,
    state,
    diagnostics: { available: false, eligibleItemCount: 0, exporting: false, lastExport: null },
    backendQuarantined: false,
    installationGeneration: options.installationGeneration,
  };
}

/** The build every case above runs on, offering only what MSCanvas ships. */
function narrowedCatalog(installationGeneration: number) {
  return intentCatalog({
    unsupported: intentCatalog()
      .intents.map((option) => option.intent.id)
      .filter((id) => id !== SHIPPED_INTENT.id),
    installationGeneration,
  });
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

describe("M6.4 — visible conversion settings, rendered", () => {
  it("opens on the shipped semantic, in four native groups over one selection", async () => {
    await openTheSettings();

    // Native grouping, not four styled lists: the caption and the closed set of
    // values are what a fieldset, a legend and a radio group already mean.
    const groups = await browser.execute(
      (selector: string) =>
        [...document.querySelectorAll(`${selector} fieldset`)].map((each) => ({
          axis: each.getAttribute("data-axis"),
          legend: each.querySelector("legend")?.textContent ?? "",
          radios: each.querySelectorAll("input[type='radio']").length,
        })),
      SETTINGS,
    );
    expect(groups.map((group) => group.axis)).toEqual([
      "processing",
      "population",
      "precision",
      "compression",
    ]);
    expect(groups.map((group) => group.legend)).toEqual([
      "Peak processing",
      "Spectra included",
      "Numeric precision",
      "Array compression",
    ]);
    expect(groups.map((group) => group.radios)).toEqual([2, 3, 4, 2]);

    expect(await isChecked(radio("processing", "noAdditionalCentroiding"))).toBe(true);
    expect(await isChecked(radio("population", "all"))).toBe(true);
    expect(await isChecked(radio("precision", "mz64Intensity32"))).toBe(true);
    expect(await isChecked(radio("compression", "zlib"))).toBe(true);

    // The format is stated, never offered. A disabled mzXML control would
    // advertise a route this milestone does not own.
    expect(await browser.$(`${SETTINGS} input[value="mzXML"]`).isExisting()).toBe(false);
    expect(describedIntents(await ipcCalls())).toEqual([SHIPPED_INTENT.id]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("marks the lossy choice lossy, in text, beside the control it describes", async () => {
    await openTheSettings();
    const centroid = radio("processing", "unscopedDefaultCentroiding");
    const said = await describedText(centroid);

    expect(said).toContain("Lossy.");
    expect(said).toContain("cannot be recovered");
    expect(said).toContain("every MS level");
    // None of the claims the evidence does not support.
    expect(said).not.toMatch(/vendor|lossless|high.quality/iu);
    // In the document rather than in a tooltip: hover is not a channel this
    // information may live in.
    expect(
      await browser.execute(
        (target: string) => document.querySelector(target)?.getAttribute("title") ?? null,
        centroid,
      ),
    ).toBeNull();
    const note = await boxOf(
      `${SETTINGS} fieldset[data-axis="processing"] .conversion-setting-choice:last-child p`,
    );
    expect(note.height).toBeGreaterThan(0);
  });

  it("refuses an unqualified value to the pointer and to the keyboard alike", async () => {
    await openTheSettings();
    const uncompressed = radio("compression", "none");
    expect(await browser.$(uncompressed).isEnabled()).toBe(false);
    expect(await describedText(uncompressed)).toContain("has not qualified that combination");
    // The refusal is not carried by colour alone: the state is on the element
    // and the sentence is in the document.
    expect(
      await browser.execute(
        (target: string) =>
          document
            .querySelector(target)
            ?.closest(".conversion-setting-choice")
            ?.getAttribute("data-choice-state") ?? null,
        uncompressed,
      ),
    ).toBe("unavailable");

    const before = describedIntents(await ipcCalls()).length;
    await browser.$(uncompressed).click({ skipRelease: false }).catch(() => undefined);
    await browser.execute((target: string) => {
      (document.querySelector(target) as HTMLElement | null)?.focus();
    }, uncompressed);
    await browser.keys(" ");
    await browser.keys("Enter");

    expect(await isChecked(radio("compression", "zlib"))).toBe(true);
    expect(describedIntents(await ipcCalls()).length).toBe(before);
  });

  it("moves one axis by keyboard, leaves the others, and rereads the plan", async () => {
    await openTheSettings();
    const wide = intentFor({ precision: "mz64Intensity64" });
    await setInvokeResult("describe_workspace_conversion_queue", planFor(wide));

    // The platform's own radio-group behaviour: focus the checked one, arrow to
    // the next. Nothing here synthesises a change event.
    await browser.execute((target: string) => {
      (document.querySelector(target) as HTMLElement | null)?.focus();
    }, radio("precision", "mz64Intensity32"));
    await browser.keys("ArrowDown");

    await browser.waitUntil(async () => isChecked(radio("precision", "mz64Intensity64")), {
      timeout: 30_000,
      timeoutMsg: "the keyboard never moved the precision group",
    });
    // Only that axis moved.
    expect(await isChecked(radio("processing", "noAdditionalCentroiding"))).toBe(true);
    expect(await isChecked(radio("population", "all"))).toBe(true);
    expect(await isChecked(radio("compression", "zlib"))).toBe(true);

    await browser.waitUntil(
      async () => describedIntents(await ipcCalls()).includes(wide.id),
      { timeout: 30_000, timeoutMsg: "the plan was never reread for the chosen semantic" },
    );
    // And from here the combination that was refused a moment ago is offered,
    // which is exactly where the measurement put it.
    await browser.waitUntil(async () => browser.$(radio("compression", "none")).isEnabled(), {
      timeout: 30_000,
      timeoutMsg: "compression off never became available at 64/64",
    });
  });

  it("states the plan from what Rust answered, and says the destination comes next", async () => {
    await openTheSettings();
    const filtered = intentFor({ precision: "mz64Intensity64", population: "ms2Only" });
    await setInvokeResult("describe_workspace_conversion_queue", planFor(filtered));
    await browser.$(radio("precision", "mz64Intensity64")).click();
    await browser.waitUntil(async () => (await planFact("Spectra")) === "MS2 spectra only", {
      timeout: 30_000,
      timeoutMsg: "the plan never described the semantic Rust answered with",
    });

    expect(await planFact("Output")).toBe("mzML");
    expect(await planFact("Peak processing")).toBe("No additional centroiding");
    expect(await planFact("Numeric precision")).toBe("m/z 64-bit · intensity 64-bit");
    expect(await planFact("Array compression")).toBe("zlib compressed");
    expect(await planFact("If an output name is taken")).toBe(
      "Stop if a file of that name already exists",
    );
    expect(await planFact("Destination")).toBe("One folder, chosen next");

    // What this semantic leaves out, said beside the plan.
    //
    // Read as text content rather than through `getText`, which reports only
    // what is *visible*: this panel owns its own overflow, and the claim here
    // is about what the document says rather than about where the viewport
    // happens to be scrolled to. That it is reachable at every width is the
    // responsive case below.
    const textOf = async (selector: string): Promise<string> =>
      browser.execute(
        (target: string) => document.querySelector(target)?.textContent ?? "",
        selector,
      );
    expect(await textOf(`${PANEL} [data-plan-facts="disclosures"]`)).toContain(
      "left out of the converted file",
    );
    // And no path anywhere: the folder does not exist yet.
    const rendered = await textOf(PANEL);
    expect(rendered.replaceAll("m/z", "mass-to-charge")).not.toContain(String.fromCharCode(92));
    expect(rendered).not.toMatch(/[A-Za-z]:[\\/]/u);
  });

  it("binds the semantic on screen, and a queue that has begun ignores the controls", async () => {
    await openTheSettings();
    const wide = intentFor({ precision: "mz64Intensity64" });
    await setInvokeResult("describe_workspace_conversion_queue", planFor(wide));
    await browser.$(radio("precision", "mz64Intensity64")).click();
    await browser.waitUntil(async () => (await planFact("Numeric precision")).includes("64-bit · intensity 64-bit"), {
      timeout: 30_000,
      timeoutMsg: "the plan never showed the chosen precision",
    });

    await setInvokeResult("begin_workspace_conversion_queue", { reservationId: "reservation-1" });
    // A destination command that never answers, which is what an open native
    // folder picker is. The table can only resolve or reject, so this one
    // command is held at the boundary the table itself installs.
    await browser.execute(() => {
      const target = window as unknown as Record<string, Record<string, unknown>>;
      const internals = target["__TAURI_INTERNALS__"] as unknown as {
        invoke: (...args: unknown[]) => Promise<unknown>;
      };
      const answered = internals.invoke.bind(internals);
      internals.invoke = (...args: unknown[]) =>
        args[0] === "choose_workspace_conversion_destination"
          ? new Promise<never>(() => undefined)
          : answered(...args);
    });

    await browser.$(`${PANEL} button.primary-button`).click();
    await browser.waitUntil(async () => begunIntents(await ipcCalls()).length > 0, {
      timeout: 30_000,
      timeoutMsg: "the panel never began a conversion",
    });
    // What was pressed is what was sent.
    expect(begunIntents(await ipcCalls())).toEqual([wide.id]);

    // And the controls are gone with the plan they belonged to, so nothing on
    // screen offers to change a queue that has already bound its semantic.
    await browser.waitUntil(async () => !(await browser.$(SETTINGS).isExisting()), {
      timeout: 30_000,
      timeoutMsg: "the settings stayed on screen after a conversion began",
    });
    expect(begunIntents(await ipcCalls())).toEqual([wide.id]);
  });

  it("offers one labelled way out when an installation change strands the choice", async () => {
    await openTheSettings();
    const narrow = intentFor({ precision: "mz32Intensity32" });
    const centroided = intentFor({
      processing: "unscopedDefaultCentroiding",
      precision: "mz32Intensity32",
    });
    await setInvokeResult("describe_workspace_conversion_queue", planFor(narrow));
    await browser.$(radio("precision", "mz32Intensity32")).click();
    await setInvokeResult("describe_workspace_conversion_queue", planFor(centroided));
    await browser.waitUntil(
      async () => browser.$(radio("processing", "unscopedDefaultCentroiding")).isEnabled(),
      { timeout: 30_000, timeoutMsg: "centroiding never became available at 32/32" },
    );
    await browser.$(radio("processing", "unscopedDefaultCentroiding")).click();
    await browser.waitUntil(
      async () => isChecked(radio("processing", "unscopedDefaultCentroiding")),
      { timeout: 30_000, timeoutMsg: "the centroided semantic was never selected" },
    );

    // The installation is replaced by one that can run only what MSCanvas
    // ships, through the control a reader actually has. Every one-axis move
    // from where they are is now refused.
    const everythingElse = intentCatalog()
      .intents.map((option) => option.intent.id)
      .filter((id) => id !== SHIPPED_INTENT.id);
    await setInvokeResult("get_workspace_conversion_intents", {
      ...intentCatalog({ unsupported: everythingElse, installationGeneration: 1 }),
    });
    await setInvokeResult("inspect_backend", {
      ...availableBackend,
      installationGeneration: 1,
    });
    await recheckTheBackend();

    const recover = `${SETTINGS} .conversion-settings-recovery button`;
    await browser.$(recover).waitForExist({ timeout: 30_000 });
    // The request was preserved rather than silently replaced.
    expect(await isChecked(radio("processing", "unscopedDefaultCentroiding"))).toBe(true);
    for (const [axis, value] of [
      ["processing", "noAdditionalCentroiding"],
      ["population", "ms1Only"],
      ["precision", "mz64Intensity64"],
      ["compression", "none"],
    ] as const) {
      expect(await browser.$(radio(axis, value)).isEnabled()).toBe(false);
    }
    expect(await describedText(recover)).toContain("no single change to one of them reaches");

    await setInvokeResult("describe_workspace_conversion_queue", planFor(SHIPPED_INTENT));
    await browser.$(recover).click();
    await browser.waitUntil(async () => isChecked(radio("processing", "noAdditionalCentroiding")), {
      timeout: 30_000,
      timeoutMsg: "the way out never selected the shipped semantic",
    });
    // And it goes with the need for it.
    expect(await browser.$(recover).isExisting()).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("leaves an unrunnable choice to the controls where one of them still reaches a runnable row", async () => {
    // The recovery block claims that no single change reaches a runnable
    // combination. A preserved 64/64 that a narrower build cannot run is one
    // enabled precision step from the shipped posture, so that claim would be
    // false -- and this is the rendered proof it is not made.
    await openTheSettings();
    const wide = intentFor({ precision: "mz64Intensity64" });
    await setInvokeResult("describe_workspace_conversion_queue", planFor(wide));
    await browser.$(radio("precision", "mz64Intensity64")).click();
    await browser.waitUntil(async () => isChecked(radio("precision", "mz64Intensity64")), {
      timeout: 30_000,
      timeoutMsg: "the wider precision was never selected",
    });

    // The installation is replaced by one that runs only what MSCanvas ships.
    const everythingElse = intentCatalog()
      .intents.map((option) => option.intent.id)
      .filter((id) => id !== SHIPPED_INTENT.id);
    await setInvokeResult("get_workspace_conversion_intents", {
      ...intentCatalog({ unsupported: everythingElse, installationGeneration: 1 }),
    });
    await setInvokeResult("inspect_backend", { ...availableBackend, installationGeneration: 1 });
    await recheckTheBackend();

    // The ordinary route is enabled, so nothing announces a dead end.
    await browser.waitUntil(async () => browser.$(radio("precision", "mz64Intensity32")).isEnabled(), {
      timeout: 30_000,
      timeoutMsg: "the shipped precision never became selectable",
    });
    expect(await browser.$(`${SETTINGS} .conversion-settings-recovery`).isExisting()).toBe(false);
    const rendered = await browser.execute(
      (target: string) => document.querySelector(target)?.textContent ?? "",
      PANEL,
    );
    expect(rendered).not.toContain("no single change to one of them reaches");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps the settings and the plan through a check of the same installation", async () => {
    // A backend check is activity, not a verdict about a build. Held open on
    // purpose, because the whole of this claim lives inside the window in which
    // the check is running -- which the boundary otherwise closes on the
    // microtask after the press.
    await openTheSettings();
    const action = `${PANEL} button.primary-button`;
    await browser.waitUntil(async () => browser.$(action).isEnabled(), {
      timeout: 30_000,
      timeoutMsg: "Convert never became available",
    });
    const catalogsBefore = await catalogProbes();
    const plansBefore = await callsOf("describe_workspace_conversion_queue");
    const planBefore = await planFact("Numeric precision");

    await holdInvoke("inspect_backend");
    await recheckTheBackend();
    await browser.waitUntil(async () => (await heldInvokeCount("inspect_backend")) === 1, {
      timeout: 30_000,
      timeoutMsg: "the recheck never reached the boundary",
    });

    // Convert is refused while the check runs -- and the settings it would run
    // are still on screen, still showing what the reader chose.
    await browser.waitUntil(async () => !(await browser.$(action).isEnabled()), {
      timeout: 30_000,
      timeoutMsg: "Convert stayed available across a backend check",
    });
    expect(await describedText(action)).toContain(
      "unavailable while the installed ProteoWizard backend is being checked",
    );
    expect(await browser.$(SETTINGS).isDisplayed()).toBe(true);
    expect(
      await browser.execute(
        (selector: string) => document.querySelectorAll(`${selector} fieldset`).length,
        SETTINGS,
      ),
    ).toBe(4);
    expect(await isChecked(radio("precision", "mz64Intensity32"))).toBe(true);
    expect(await planFact("Numeric precision")).toBe(planBefore);

    // It answers, naming the installation the session was already bound to.
    await releaseInvokeHold("inspect_backend", availableBackend);
    await browser.waitUntil(async () => browser.$(action).isEnabled(), {
      timeout: 30_000,
      timeoutMsg: "Convert never came back after a healthy recheck",
    });

    // Nothing was re-read. This is the finding: a healthy recheck of an
    // unchanged installation costs one backend verdict and nothing else.
    expect(await catalogProbes()).toBe(catalogsBefore);
    expect(await callsOf("describe_workspace_conversion_queue")).toBe(plansBefore);
    expect(await planFact("Numeric precision")).toBe(planBefore);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("clears the settings when the backend really goes, and a late reply cannot put them back", async () => {
    // The other half of the same rule, and the one a transient check must not
    // be confused with. A *settled* disappearance revokes the catalog and the
    // request that would install one -- so the read still on its way about the
    // build that is gone lands with no authority to resurrect anything.
    await openTheSettings();
    await browser.waitUntil(async () => browser.$(SETTINGS).isDisplayed(), {
      timeout: 30_000,
      timeoutMsg: "the settings never appeared",
    });

    // A different installation arrives, and its catalog read is held open.
    await holdInvoke("get_workspace_conversion_intents");
    await setInvokeResult("inspect_backend", {
      ...availableBackend,
      installationGeneration: 1,
    });
    await recheckTheBackend();
    await browser.waitUntil(
      async () => (await heldInvokeCount("get_workspace_conversion_intents")) === 1,
      { timeout: 30_000, timeoutMsg: "the new installation never provoked a catalog read" },
    );
    const catalogsAfterRead = await catalogProbes();

    // Before it answers, the session loses its ProteoWizard outright.
    await setInvokeResult("inspect_backend", {
      ...unavailableBackend,
      installationGeneration: 2,
    });
    await recheckTheBackend();
    await browser.waitUntil(async () => !(await browser.$(SETTINGS).isExisting()), {
      timeout: 30_000,
      timeoutMsg: "the settings survived a settled backend disappearance",
    });

    // The held read lands. It describes a build this session can no longer
    // launch, and its request no longer has the authority to install it.
    await releaseInvokeHold("get_workspace_conversion_intents", narrowedCatalog(1));
    await browser.pause(500);
    expect(await browser.$(SETTINGS).isExisting()).toBe(false);
    const reason = await browser.execute(
      () =>
        document.querySelector("[data-live-region='conversion-availability']")?.textContent ?? "",
    );
    expect(reason).toContain("no usable backend");
    // And nothing went looking for a catalog there is no backend to read.
    expect(await catalogProbes()).toBe(catalogsAfterRead);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("does not stack backend probes behind a running queue, and reconciles once when it lets go", async () => {
    // The slot is read every two seconds while a queue runs, and every one of
    // those readings carries where the installation sequence stands. A queue
    // that has itself seen a replacement therefore reports a newer generation
    // on every tick -- and each of those used to be a fresh `inspect_backend`,
    // blocking on the very gate the queue holds.
    await browser.setWindowSize(1_366, 768);
    const running = (installationGeneration: number) =>
      slot(
        {
          status: "running",
          operationId: "1",
          queue: queueOf([
            queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, { state: "running", attempts: 1 }),
          ]),
        },
        { sequence: 1, installationGeneration },
      );
    await installIpcBoundary({
      ...ipcTable(),
      describe_workspace_conversion_queue: planFor(SHIPPED_INTENT),
      // The queue is already running when this document loads, on the
      // installation the session is about to settle on. The replacement happens
      // below, under the running queue, so nothing here depends on which of the
      // two mount reads answers first.
      get_workspace_conversion_state: running(0),
    });
    await browser.url("/");
    await browser.$(VENDOR).waitForDisplayed({ timeout: 60_000 });
    await browser.$(VENDOR).click();
    await browser.$(PANEL).waitForDisplayed({ timeout: 60_000 });
    // The verdict has settled and the catalog for it has been read, so what
    // follows is measured against a session that is fully established.
    await browser.waitUntil(async () => (await catalogProbes()) === 1, {
      timeout: 30_000,
      timeoutMsg: "the session never read the catalog of its own installation",
    });
    const probesBefore = await backendProbes();

    // The build is replaced under the running queue. Every poll from here
    // reports it, and the slot sequence never moves.
    await setInvokeResult("get_workspace_conversion_state", running(1));
    const readsBefore = await callsOf("get_workspace_conversion_state");
    await browser.waitUntil(
      async () => (await callsOf("get_workspace_conversion_state")) >= readsBefore + 4,
      { timeout: 30_000, timeoutMsg: "the running queue was never polled" },
    );

    // **Four readings of one observation, and not one backend process.**
    expect(await backendProbes()).toBe(probesBefore);
    expect(await catalogProbes()).toBe(1);

    // The queue finishes and releases the lane, and the replacement build is
    // what a check now finds.
    await setInvokeResult("inspect_backend", {
      ...availableBackend,
      installationGeneration: 1,
    });
    await setInvokeResult("get_workspace_conversion_intents", narrowedCatalog(1));
    await setInvokeResult(
      "get_workspace_conversion_state",
      slot(
        {
          status: "terminal",
          operationId: "1",
          reason: "completed",
          queue: queueOf([
            queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, { state: "finalized", attempts: 1 }),
          ]),
        },
        { sequence: 2, installationGeneration: 1 },
      ),
    );

    // **Exactly one reconciliation, for the one observation.**
    await browser.waitUntil(async () => (await catalogProbes()) === 2, {
      timeout: 30_000,
      timeoutMsg: "the released lane never reconciled the observed installation",
    });
    await browser.pause(2_500);
    expect(await backendProbes()).toBe(probesBefore + 1);
    expect(await catalogProbes()).toBe(2);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("reconciles once when a refused conversion is the first thing to resolve a replacement", async () => {
    // The pre-picker capability gate resolves the installed build before it
    // refuses, so a refusal that creates no queue at all can still be this
    // session's first sight of a replacement. Refusing must not unlearn that --
    // and learning it must cost one check, not one per reading that carries it.
    await openTheSettings();
    const action = `${PANEL} button.primary-button`;
    await browser.waitUntil(async () => browser.$(action).isEnabled(), {
      timeout: 30_000,
      timeoutMsg: "Convert never became available",
    });
    const probesBefore = await backendProbes();
    const catalogsBefore = await catalogProbes();

    // BEGIN resolves the replacement, records it, and then refuses the semantic
    // that build cannot express. The slot read that follows carries the news.
    await setInvokeResult("begin_workspace_conversion_queue", {
      __reject: {
        kind: "conversion_intent_unsupported",
        summary: "The installed ProteoWizard build does not offer that conversion option.",
        detail: null,
        retryable: false,
      },
    });
    await setInvokeResult(
      "get_workspace_conversion_state",
      slot({ status: "idle" }, { sequence: 0, installationGeneration: 1 }),
    );
    await setInvokeResult("inspect_backend", {
      ...availableBackend,
      installationGeneration: 1,
    });
    await setInvokeResult("get_workspace_conversion_intents", narrowedCatalog(1));
    await browser.$(action).click();

    // The catalog now describes the build that is actually installed.
    await browser.waitUntil(async () => (await catalogProbes()) === catalogsBefore + 1, {
      timeout: 30_000,
      timeoutMsg: "the refusal never reconciled the installation it resolved",
    });
    await browser.pause(1_000);
    // Once. Not once per reading of the slot.
    expect(await backendProbes()).toBe(probesBefore + 1);
    expect(await catalogProbes()).toBe(catalogsBefore + 1);
    // Nothing was started, and no destination was ever asked for.
    expect(await callsOf("choose_workspace_conversion_destination")).toBe(0);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("refuses the conversion, with a reason, when the catalog cannot be read", async () => {
    await browser.setWindowSize(1_366, 768);
    // The one read that says which semantics this build offers fails, from the
    // first document this session loads. Settings are not permission to run,
    // and their absence is not a reason to invent one -- so no plan is asked
    // for and no conversion may start.
    //
    // Seeded into the table rather than set afterwards: the boundary is a
    // preload script, so a table written into the current document would be
    // replaced by the navigation below.
    await installIpcBoundary({
      ...ipcTable(),
      describe_workspace_conversion_queue: planFor(SHIPPED_INTENT),
      get_workspace_conversion_intents: {
        __reject: {
          kind: "provider_unavailable",
          summary: "MSCanvas could not read the installed ProteoWizard.",
          detail: null,
          retryable: false,
        },
      },
    });
    await browser.url("/");
    await browser.$(VENDOR).waitForDisplayed({ timeout: 60_000 });
    await browser.$(VENDOR).click();
    await browser.$(PANEL).waitForDisplayed({ timeout: 60_000 });

    await browser.waitUntil(
      async () => !(await browser.$(`${PANEL} button.primary-button`).isEnabled()),
      { timeout: 30_000, timeoutMsg: "Convert stayed available with no settings behind it" },
    );
    const reason = await browser.execute(
      () =>
        document.querySelector("[data-live-region='conversion-availability']")?.textContent ?? "",
    );
    expect(reason).toContain("could not read which conversion settings");
    // Nothing was manufactured from the failed read.
    expect(describedIntents(await ipcCalls())).toEqual([]);
    expect(begunIntents(await ipcCalls())).toEqual([]);
    // And the control is refused rather than removed: an action that cannot be
    // taken still has to say so.
    expect(await browser.$(`${PANEL} button.primary-button`).isExisting()).toBe(true);
  });

  for (const viewport of VIEWPORTS) {
    it(`fits the settings at ${viewport.name} without hiding the action`, async () => {
      await openTheSettings({ width: viewport.width, height: viewport.height });
      const sidebar = await boxOf(SIDEBAR);

      // Every group inside the column it lives in, at every width.
      const groups = await browser.execute(
        (selector: string) =>
          [...document.querySelectorAll(`${selector} fieldset`)].map((each) => {
            const box = each.getBoundingClientRect();
            return { right: box.right, height: box.height };
          }),
        SETTINGS,
      );
      expect(groups).toHaveLength(4);
      for (const group of groups) {
        expect(group.height).toBeGreaterThan(0);
        expect(group.right).toBeLessThanOrEqual(sidebar.right + 1);
      }

      // The action is still reachable: the panel owns its own overflow, and a
      // control below an unscrollable fold is a control that is not there.
      await browser.execute((selector: string) => {
        const panel = document.querySelector(selector);
        if (panel !== null) {
          panel.scrollTop = panel.scrollHeight;
        }
      }, PANEL);
      const action = await boxOf(`${PANEL} button.primary-button`);
      expect(action.height).toBeGreaterThan(0);
      expect(action.right).toBeLessThanOrEqual(sidebar.right + 1);

      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
