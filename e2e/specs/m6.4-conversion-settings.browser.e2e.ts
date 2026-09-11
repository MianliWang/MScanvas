/**
 * M6.4 rendered QA — the conversion settings, the plan bound to a binding, and
 * what happens when that binding moves under them.
 *
 * The unit suites pin every rule this exercises: the admitted table is a lookup,
 * availability belongs to a row, the plan has a state machine, `BEGIN` proves
 * the receipt, a probe owns the process lane, and one fact owns one notice. What
 * only a browser can answer is whether the whole vertical holds together in the
 * shipped bundle — whether the sentence a reader is given matches the control
 * beside it, whether a replacement really does reach every surface at once, and
 * whether the things this milestone promises *not* to do stay undone when the
 * real components are wired to the real hooks.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * below about what did or did not cross the boundary is a claim about the
 * shipped frontend. No ProteoWizard is needed and none is used: the option
 * grammar this milestone is about arrives as a catalog, which is the whole point
 * of ADR 0044 — Rust owns the measurement and this side owns the lookup.
 *
 * The consolidation is deliberate. This is not a rendered copy of the unit
 * suites; it is the set of claims that are only true of the assembled product.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  consoleEntries,
  holdInvoke,
  horizontalOverflow,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeResult,
} from "../support/harness";
import { ipcTable, VENDOR_ROW } from "../support/fixtures";
import {
  admittedIntents,
  availableBackend,
  completeCatalog,
  firstBindingReceipt,
  queueItem,
  queueOf,
  settledAt,
  shippedIntent,
  vendorWorkflowCatalog,
} from "../../apps/desktop/src/test/previewFixtures";
import type {
  ConversionCatalogRow,
  ConversionIntentDescriptor,
} from "../../apps/desktop/src/features/mzml-preview/contracts";

const PANEL = "section.conversion-panel";
const REGION = '[data-live-region="conversion-availability"]';
const SETTINGS = ".conversion-settings";
const VENDOR = `li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`;
const CONVERT = `${PANEL} button.primary-button`;

/** The binding the session opens on, and the one that replaces it. */
const A = firstBindingReceipt;
const B = firstBindingReceipt + 1;
const AUTHORITY_A = settledAt(1, A);
const AUTHORITY_B = settledAt(2, B);

const intentId = (
  processing: string,
  population: string,
  precision: string,
  compression: string,
): string => `mzml+${processing}+${population}+${precision}+${compression}`;

const FLAT_32 = intentId("no_additional_centroiding", "all", "mz32_intensity32", "zlib");
const CENTROIDED_32 = intentId("unscoped_default_centroiding", "all", "mz32_intensity32", "zlib");
const CENTROIDED_64 = intentId("unscoped_default_centroiding", "all", "mz64_intensity64", "zlib");

function intentOf(id: string): ConversionIntentDescriptor {
  const found = admittedIntents.find((intent) => intent.id === id);
  if (found === undefined) {
    throw new Error(`the admitted table has no ${id}`);
  }
  return found;
}

/**
 * The nine admitted rows, with the named ones unrunnable on this build.
 *
 * The discriminator moves with the boolean, because `available: false` beside
 * `availability: "available"` is a reply Rust cannot produce.
 */
function withoutRunning(...ids: readonly string[]): readonly ConversionCatalogRow[] {
  return completeCatalog.map((row) => ({
    ...row,
    available: !ids.includes(row.intent.id),
    availability: ids.includes(row.intent.id)
      ? ("unsupported_by_installation" as const)
      : ("available" as const),
  }));
}

function configuration(
  authority: typeof AUTHORITY_A,
  catalog: readonly ConversionCatalogRow[] = completeCatalog,
) {
  return {
    authority,
    configuration: { configuration: "ready", catalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
}

/** What Rust would answer a plan question about one combination with. */
function plannedAs(intent: ConversionIntentDescriptor, receipt: number) {
  return {
    outcome: "planned",
    plan: {
      items: [
        {
          datasetHandle: VENDOR_ROW.handle,
          fileName: VENDOR_ROW.fileName,
          sourceKind: VENDOR_ROW.sourceKind,
          output: { kind: "knownSingle", fileName: "sample-9.mzML" },
        },
      ],
      outputFormat: "mzML",
      compression: intent.compression === "zlib" ? "zlib" : "none",
      validationMode: "output_only",
      capacity: 16,
      intent,
      conflictPolicy: "fail",
      receipt,
      destinationPolicy: { kind: "customFolder" },
    },
  };
}

/** A queue that is under way, so the panel keeps polling its slot. */
function runningQueue(sequence: number, authority: typeof AUTHORITY_A) {
  return {
    sequence,
    state: {
      status: "running",
      operationId: "1",
      queue: queueOf([
        queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, { state: "running", attempts: 1 }),
      ]),
    },
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority,
  };
}

/** A finished queue holding one failure another attempt could change. */
function retryableQueue(sequence: number, authority: typeof AUTHORITY_A) {
  return {
    sequence,
    state: {
      status: "terminal",
      operationId: "1",
      reason: "completed",
      queue: queueOf([
        queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, {
          state: "failed",
          attempts: 1,
          retryable: true,
        }),
      ]),
    },
    diagnostics: { eligibleItemCount: 1, available: true, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority,
  };
}

const IDLE_SLOT = {
  sequence: 0,
  state: { status: "idle" },
  diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
  backendQuarantined: false,
  authority: AUTHORITY_A,
};

/** The reading the banner renders, stamped at the authority it was taken at. */
function reading(authority: typeof AUTHORITY_A) {
  return { ...availableBackend, authority };
}

/**
 * Opens the workspace with a convertible row focused.
 *
 * Everything the session asks for on mount is answered from the repository's own
 * fixtures, so a shape this run drives is a shape the unit suite already agrees
 * with.
 */
async function openTheWorkspace(overrides: Record<string, unknown> = {}): Promise<void> {
  await browser.setWindowSize(1_366, 768);
  await installIpcBoundary({
    ...ipcTable(),
    inspect_backend: reading(AUTHORITY_A),
    read_conversion_configuration: configuration(AUTHORITY_A),
    describe_workspace_conversion_queue: plannedAs(shippedIntent, A),
    get_workspace_conversion_state: IDLE_SLOT,
    ...overrides,
  });
  await browser.url("/");
  await browser.$(VENDOR).waitForDisplayed({ timeout: 60_000 });
  await browser.$(VENDOR).click();
  await browser.$(PANEL).waitForDisplayed({ timeout: 60_000 });
}

/** Waits until the settings surface is in one of its named states. */
async function settingsState(): Promise<string | null> {
  return browser.execute(
    (selector: string) =>
      document.querySelector(selector)?.getAttribute("data-settings-state") ?? null,
    SETTINGS,
  );
}

async function awaitSettings(state: string): Promise<void> {
  await browser.waitUntil(async () => (await settingsState()) === state, {
    timeout: 30_000,
    timeoutMsg: `the settings surface never reached ${state}`,
  });
}

/** Waits until the panel is describing a conversion. */
async function awaitPlan(): Promise<void> {
  await browser.$(`${PANEL} .conversion-queue-list`).waitForExist({ timeout: 30_000 });
}

/** Every sentence the panel is currently giving as a reason. */
async function reasons(): Promise<string[]> {
  return browser.execute(
    (selector: string) =>
      [...document.querySelectorAll(`${selector} p`)].map((element) => element.textContent ?? ""),
    REGION,
  );
}

/** How many times one command has crossed the boundary. */
async function callsTo(command: string): Promise<number> {
  return (await ipcCalls()).filter((call) => call.command === command).length;
}

/** Every request one command was given, in order. */
async function requestsTo(command: string): Promise<Record<string, unknown>[]> {
  return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args);
}

/** The state each choice of one axis is in, by value. */
async function axisStates(axis: string): Promise<Record<string, string>> {
  return browser.execute((dimension: string) => {
    const group = document.querySelector(`[data-axis="${dimension}"]`);
    const states: Record<string, string> = {};
    for (const choice of group?.querySelectorAll(".conversion-setting-choice") ?? []) {
      const input = choice.querySelector("input");
      states[input?.getAttribute("value") ?? ""] =
        choice.getAttribute("data-choice-state") ?? "";
    }
    return states;
  }, axis) as Promise<Record<string, string>>;
}

/** Chooses one value of one axis, the way a reader does. */
async function chooseAxisValue(axis: string, value: string): Promise<void> {
  const control = await browser.$(`input[name="conversion-setting-${axis}"][value="${value}"]`);
  await control.waitForEnabled({ timeout: 30_000 });
  await control.click();
}

/** What the plan summary says about one of its named facts. */
async function planFact(term: string): Promise<string | null> {
  return browser.execute((label: string) => {
    const list = document.querySelector(".conversion-plan dl.metadata-list");
    for (const group of list?.querySelectorAll("div") ?? []) {
      if (group.querySelector("dt")?.textContent?.trim() === label) {
        return group.querySelector("dd")?.textContent?.trim() ?? null;
      }
    }
    return null;
  }, term) as Promise<string | null>;
}

/** Every id carried by more than one element anywhere in the document. */
async function duplicateIds(): Promise<string[]> {
  return browser.execute(() => {
    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) {
      seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
    }
    return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  }) as Promise<string[]>;
}

/** How many elements carry one id. */
async function owners(id: string): Promise<number> {
  return browser.execute(
    (target: string) => document.querySelectorAll(`[id="${target}"]`).length,
    id,
  ) as Promise<number>;
}

async function describedBy(selector: string): Promise<string[]> {
  return browser.execute(
    (target: string) =>
      (document.querySelector(target)?.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter((id) => id !== ""),
    selector,
  ) as Promise<string[]>;
}

/** What the backend banner is currently saying. */
async function bannerText(): Promise<string> {
  return browser.execute(
    () => document.querySelector(".shell-notices")?.textContent ?? "",
  ) as Promise<string>;
}

/** The disclaimer a superseded reading shows, or `null` where none is shown. */
async function superseded(): Promise<string | null> {
  return browser.execute(
    () => document.querySelector('[data-backend-reading="superseded"]')?.textContent ?? null,
  ) as Promise<string | null>;
}

/** Whether the superseded banner still offers the reader a check of their own. */
async function supersededRecheckEnabled(): Promise<boolean> {
  return browser.execute(() => {
    const banner = document.querySelector('[data-backend-reading="superseded"]');
    const control = [...(banner?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent?.trim() === "Check again",
    );
    return control !== undefined && !(control as HTMLButtonElement).disabled;
  }) as Promise<boolean>;
}

/** A queue that has run to its own end, so the lane is free again. */
function terminalQueue(sequence: number, authority: typeof AUTHORITY_A) {
  return {
    sequence,
    state: {
      status: "terminal",
      operationId: "1",
      reason: "completed",
      queue: queueOf([
        queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, { state: "finalized", attempts: 1 }),
      ]),
    },
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority,
  };
}

/** Presses the backend banner's own recheck, which is not a conversion action. */
async function pressCheckAgain(): Promise<void> {
  await pressLinkButton("Check again");
}

async function pressLinkButton(label: string): Promise<void> {
  const buttons = await browser.$$("button.link-button");
  for (const button of buttons) {
    if ((await button.getText()).trim() === label) {
      await button.click();
      return;
    }
  }
  throw new Error(`no control labelled ${label}`);
}

/**
 * The label of the rerun control the finished queue offers, or `null`.
 *
 * Read from the document rather than assumed, because the label counts the
 * failures Rust reported and a test that hard-coded it would be asserting about
 * its own fixture twice.
 */
async function rerunControl(): Promise<string | null> {
  return browser.execute(() => {
    const control = [...document.querySelectorAll("section.conversion-panel button")].find(
      (candidate) => (candidate.textContent ?? "").trim().startsWith("Retry "),
    );
    return control === undefined || (control as HTMLButtonElement).disabled
      ? null
      : (control.textContent ?? "").trim();
  }) as Promise<string | null>;
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

describe("M6.4 — E1: a healthy configuration and a plan bound to it", () => {
  it("shows the settings, the summary they produced, and an offered Convert", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();

    // The combination MSCanvas ships is selected, and it is the one the plan
    // describes. The summary is read off Rust's answer rather than off the
    // controls beside it, which is why both can be asserted at once.
    expect(await axisStates("processing")).toMatchObject({
      no_additional_centroiding: "selected",
    });
    expect(await planFact("Peaks")).toBe("No additional centroiding");
    expect(await planFact("Stored precision")).toBe("m/z 64-bit · intensity 32-bit");
    expect(await planFact("Output")).toBe("mzML");

    expect(await browser.$(CONVERT).isEnabled()).toBe(true);
    expect(await reasons()).toEqual([]);
    expect(await unexpectedConsole()).toEqual([]);
  });
});

describe("M6.4 — E2: one axis moves, and only that axis", () => {
  it("selects the exact combination the edit names, and re-describes it", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();

    // The answer for the row this edit names, in place before the edit, so the
    // plan that comes back is a plan for the question actually asked.
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(FLAT_32), A),
    );
    await chooseAxisValue("precision", "mz32_intensity32");

    await browser.waitUntil(
      async () => (await planFact("Stored precision")) === "m/z 32-bit · intensity 32-bit",
      { timeout: 30_000, timeoutMsg: "the plan never described the chosen precision" },
    );
    // Exactly one row is selected, and the axes nobody touched did not move.
    const precision = await axisStates("precision");
    expect(Object.values(precision).filter((state) => state === "selected")).toHaveLength(1);
    expect(precision.mz32_intensity32).toBe("selected");
    expect(await axisStates("processing")).toMatchObject({
      no_additional_centroiding: "selected",
    });
    expect(await planFact("Peaks")).toBe("No additional centroiding");
    expect(await planFact("Spectra")).toBe("All spectra");
  });

  it("refuses an unmeasured combination by naming the combination, not the value", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(FLAT_32), A),
    );
    await chooseAxisValue("precision", "mz32_intensity32");
    await browser.waitUntil(
      async () => (await axisStates("precision")).mz32_intensity32 === "selected",
      { timeout: 30_000, timeoutMsg: "the 32/32 row was never selected" },
    );

    // MS1-only at 32/32 is one of the thirty-nine the evidence never admitted.
    expect(await axisStates("population")).toMatchObject({ ms1_only: "unavailable" });
    const note = await browser.execute(() => {
      const input = document.querySelector(
        'input[name="conversion-setting-population"][value="ms1_only"]',
      );
      const id = input?.getAttribute("aria-describedby") ?? "";
      return document.getElementById(id)?.textContent ?? "";
    });
    // The sentence is about the combination the choice would produce. A refusal
    // that said "MS1 spectra only is not supported" would be false: it appears
    // in rows this build runs perfectly well.
    expect(note).toContain("Not available with the other settings you have chosen");
    expect(note).toContain("has not qualified that combination");
  });
});

describe("M6.4 — E3: the selected row survives a replacement and is told the truth", () => {
  it("keeps the choice, says once that it cannot run, and refuses Convert", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();

    // Walk to the centroided row the reader actually wants.
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(CENTROIDED_64), A),
    );
    await chooseAxisValue("precision", "mz64_intensity64");
    await chooseAxisValue("processing", "unscoped_default_centroiding");
    await browser.waitUntil(
      async () =>
        (await axisStates("processing")).unscoped_default_centroiding === "selected",
      { timeout: 30_000, timeoutMsg: "the centroided row was never selected" },
    );

    // A different installation, declaring everything except the peak-picking
    // grammar. The reader's scientific request is not rewritten for them.
    await setInvokeResult("inspect_backend", reading(AUTHORITY_B));
    await setInvokeResult(
      "read_conversion_configuration",
      configuration(AUTHORITY_B, withoutRunning(CENTROIDED_64, CENTROIDED_32)),
    );
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(CENTROIDED_64), B),
    );
    await pressCheckAgain();

    await browser.waitUntil(
      async () => (await owners("conversion-settings-selection-unavailable")) === 1,
      { timeout: 30_000, timeoutMsg: "the row was never reported as unrunnable" },
    );
    // The choice is still the reader's.
    expect(await axisStates("processing")).toMatchObject({
      unscoped_default_centroiding: "selected",
    });
    // Said once, above the groups, because all four show the same selection.
    const statement = await browser.execute(
      () =>
        (document.body.textContent ?? "").split(
          "The conversion settings you chose cannot run with this ProteoWizard installation.",
        ).length - 1,
    );
    expect(statement).toBe(1);
    // And the values that appear in rows this build runs are not labelled
    // unsupported.
    expect(await axisStates("precision")).toMatchObject({ mz64_intensity64: "selected" });
    expect(await axisStates("compression")).toMatchObject({ zlib: "selected" });
    // A one-axis route out exists here, so no atomic recovery is offered.
    expect(await browser.$(".conversion-settings-recovery").isExisting()).toBe(false);
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);

    // The ordinary route: one axis back to a row this build runs.
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf("mzml+no_additional_centroiding+all+mz64_intensity64+zlib"), B),
    );
    await chooseAxisValue("processing", "no_additional_centroiding");
    await browser.waitUntil(
      async () => (await owners("conversion-settings-selection-unavailable")) === 0,
      { timeout: 30_000, timeoutMsg: "the row-unavailable statement never went away" },
    );
    expect(await unexpectedConsole()).toEqual([]);
  });
});

describe("M6.4 — E4: a genuine dead end offers one explicit way out", () => {
  it("offers the shipped combination, labelled, reachable from the keyboard", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();

    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(FLAT_32), A),
    );
    await chooseAxisValue("precision", "mz32_intensity32");
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(CENTROIDED_32), A),
    );
    await chooseAxisValue("processing", "unscoped_default_centroiding");
    await browser.waitUntil(
      async () =>
        (await axisStates("processing")).unscoped_default_centroiding === "selected" &&
        (await axisStates("precision")).mz32_intensity32 === "selected",
      { timeout: 30_000, timeoutMsg: "the 32/32 centroided row was never selected" },
    );

    // A build on which every one-axis neighbour of that row is refused, and the
    // shipped row sits available and unreachable.
    await setInvokeResult("inspect_backend", reading(AUTHORITY_B));
    await setInvokeResult(
      "read_conversion_configuration",
      configuration(AUTHORITY_B, withoutRunning(CENTROIDED_32, CENTROIDED_64, FLAT_32)),
    );
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(CENTROIDED_32), B),
    );
    await pressCheckAgain();

    await browser.$(".conversion-settings-recovery").waitForExist({ timeout: 30_000 });
    // Explicit and labelled. Nothing silently moved the selection.
    expect(await axisStates("processing")).toMatchObject({
      unscoped_default_centroiding: "selected",
    });
    const reason = await browser.execute(
      () => document.getElementById("conversion-settings-recovery-reason")?.textContent ?? "",
    );
    expect(reason).toBe(
      "No single change to one of these settings reaches a combination this build can run.",
    );

    // Activated from the keyboard, because a recovery only a pointer can reach
    // is not a recovery.
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(shippedIntent, B),
    );
    await browser.execute(() => {
      const control = [...document.querySelectorAll("button.link-button")].find(
        (candidate) => candidate.textContent?.trim() === "Use the settings MSCanvas ships",
      );
      (control as HTMLElement | undefined)?.focus();
    });
    await browser.keys("Enter");

    await browser.waitUntil(
      async () => (await axisStates("processing")).no_additional_centroiding === "selected",
      { timeout: 30_000, timeoutMsg: "the shipped row was never selected" },
    );
    expect(await browser.$(".conversion-settings-recovery").isExisting()).toBe(false);
  });
});

describe("M6.4 — E5: a configuration probe owns the process lane", () => {
  it("shows the read in progress, refuses Convert once, and recovers", async () => {
    await browser.setWindowSize(1_366, 768);
    // Held from the first document script, because this application asks for the
    // settings in a mount effect: a hold installed after navigation races the
    // request it means to catch, and loses whenever the machine is quick.
    await installIpcBoundary(
      {
        ...ipcTable(),
        inspect_backend: reading(AUTHORITY_A),
        read_conversion_configuration: configuration(AUTHORITY_A),
        describe_workspace_conversion_queue: plannedAs(shippedIntent, A),
        get_workspace_conversion_state: IDLE_SLOT,
      },
      { hold: ["read_conversion_configuration"] },
    );
    await browser.url("/");
    await browser.$(VENDOR).waitForDisplayed({ timeout: 60_000 });
    await browser.$(VENDOR).click();
    await browser.$(PANEL).waitForDisplayed({ timeout: 60_000 });

    await awaitSettings("loading");
    const notice = "conversion-availability-configuration-probing";
    await browser.waitUntil(async () => (await owners(notice)) === 1, {
      timeout: 30_000,
      timeoutMsg: "the panel never said a settings read was under way",
    });
    // The fact, not the consequence. The same sentence would serve any other
    // action this probe refuses.
    expect(await reasons()).toEqual([
      "MSCanvas is reading the conversion options from ProteoWizard.",
    ]);
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);
    expect(await describedBy(CONVERT)).toContain(notice);
    expect(await duplicateIds()).toEqual([]);

    await releaseInvokeHold("read_conversion_configuration");
    await awaitSettings("ready");
    await awaitPlan();
    await browser.waitUntil(async () => browser.$(CONVERT).isEnabled(), {
      timeout: 30_000,
      timeoutMsg: "Convert never came back",
    });
    expect(await owners(notice)).toBe(0);
    expect(await unexpectedConsole()).toEqual([]);
  });
});

describe("M6.4 — E6: a failed read is retried by the reader, and by nothing else", () => {
  it("does not loop, is not retried by a recheck, and succeeds when asked", async () => {
    await openTheWorkspace({
      read_conversion_configuration: {
        authority: AUTHORITY_A,
        configuration: {
          configuration: "failed",
          error: {
            kind: "backend_help_unreadable",
            summary: "The installed ProteoWizard did not describe the commands MSCanvas needs.",
            detail: null,
            correctiveAction: null,
            retryable: true,
          },
        },
        outcome: { outcome: "answered" },
      },
    });
    await awaitSettings("failed");

    // One read, and it stays one. The exact count is read from the boundary
    // rather than inferred from what is on screen.
    expect(await callsTo("read_conversion_configuration")).toBe(1);
    await browser.pause(1_000);
    expect(await callsTo("read_conversion_configuration")).toBe(1);

    // A recheck that resolves the same binding answers a different question and
    // does not retry this one.
    await pressCheckAgain();
    await browser.waitUntil(async () => (await callsTo("inspect_backend")) >= 2, {
      timeout: 30_000,
      timeoutMsg: "the recheck never crossed the boundary",
    });
    await browser.pause(500);
    expect(await callsTo("read_conversion_configuration")).toBe(1);

    // The reader's own control, which is the only thing that asks again.
    await setInvokeResult("read_conversion_configuration", configuration(AUTHORITY_A));
    await pressLinkButton("Read the settings again");
    await awaitSettings("ready");
    expect(await callsTo("read_conversion_configuration")).toBe(2);
    expect(await unexpectedConsole()).toEqual([]);
  });
});

describe("M6.4 — E7: a recheck that resolves the same build changes nothing", () => {
  it("keeps the catalog and the plan, and reads no settings again", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();
    const readsBefore = await callsTo("read_conversion_configuration");
    const plansBefore = await callsTo("describe_workspace_conversion_queue");

    await pressCheckAgain();
    await browser.waitUntil(async () => (await callsTo("inspect_backend")) >= 2, {
      timeout: 30_000,
      timeoutMsg: "the recheck never crossed the boundary",
    });
    // A check reports the backend as unusable for as long as it runs, so Convert
    // may flicker; what must not happen is a probe or a re-plan.
    await browser.waitUntil(async () => browser.$(CONVERT).isEnabled(), {
      timeout: 30_000,
      timeoutMsg: "Convert never came back after the recheck",
    });

    expect(await settingsState()).toBe("ready");
    expect(await planFact("Peaks")).toBe("No additional centroiding");
    expect(await callsTo("read_conversion_configuration")).toBe(readsBefore);
    expect(await callsTo("describe_workspace_conversion_queue")).toBe(plansBefore);
  });
});

describe("M6.4 — E8: BEGIN observes a replacement and refuses before anything is created", () => {
  it("accepts the delivered authority and starts no queue, picker or reservation", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();
    const inspectionsBefore = await callsTo("inspect_backend");

    // Rust's discovery is the first thing in the session to see binding B, and
    // the refusal carries it.
    await setInvokeResult("begin_workspace_conversion_queue", {
      authority: AUTHORITY_B,
      outcome: {
        outcome: "refused",
        error: {
          kind: "conversion_binding_replaced",
          summary: "The installed ProteoWizard changed, so this conversion was not started.",
          detail: null,
          correctiveAction: null,
          retryable: false,
        },
      },
    });
    // What the panel will ask for once it knows about B. Held, so the state the
    // refusal produces can be looked at before the next read repaints it.
    await setInvokeResult(
      "read_conversion_configuration",
      configuration(AUTHORITY_B, withoutRunning()),
    );
    await holdInvoke("read_conversion_configuration");
    // And what a check would find, which after a replacement is the build the
    // session is now on. A table that went on answering with A would be
    // modelling a Rust that reports a binding it has already left.
    await setInvokeResult("inspect_backend", reading(AUTHORITY_B));

    await browser.$(CONVERT).click();
    await browser.waitUntil(async () => (await callsTo("begin_workspace_conversion_queue")) === 1, {
      timeout: 30_000,
      timeoutMsg: "the start never crossed the boundary",
    });

    // The old binding's answers are gone the moment the refusal is accepted.
    await browser.waitUntil(async () => (await settingsState()) === "loading", {
      timeout: 30_000,
      timeoutMsg: "the replaced binding's settings stayed on screen",
    });
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);
    // Nothing was created.
    expect(await callsTo("choose_workspace_conversion_destination")).toBe(0);
    // **And nothing went looking for what the refusal already said.** That is
    // an ordering claim rather than a zero-call one: the projection is accepted
    // from the refusal itself -- which is why the settings for the old binding
    // are already gone above -- and only then does the banner, whose reading was
    // taken under the build the session has left, owe the one check that
    // replaces it. A blanket "no check after a delivery" would forbid that
    // recovery and leave the banner naming a build nothing is bound to.
    await browser.waitUntil(
      async () => (await callsTo("inspect_backend")) === inspectionsBefore + 1,
      { timeout: 30_000, timeoutMsg: "the superseded reading was never replaced" },
    );

    await releaseInvokeHold("read_conversion_configuration");
    await awaitSettings("ready");
    // One, and it stays one: a single delivery incurs a single obligation, and
    // the obligation is not re-issued by its own answer.
    expect(await callsTo("inspect_backend")).toBe(inspectionsBefore + 1);
    expect(await unexpectedConsole()).toEqual([]);
  });
});

describe("M6.4 — E9: a queue poll delivers a binding change", () => {
  it("accepts it directly, and asks the backend nothing", async () => {
    await openTheWorkspace({ get_workspace_conversion_state: runningQueue(1, AUTHORITY_A) });
    await browser.$(`${PANEL} .conversion-queue-list`).waitForExist({ timeout: 30_000 });
    const inspectionsBefore = await callsTo("inspect_backend");
    const readsBefore = await callsTo("read_conversion_configuration");
    const pollsBefore = await callsTo("get_workspace_conversion_state");

    // The same slot, a newer publication. The poll is the session's only voice
    // while a drain runs.
    await setInvokeResult("get_workspace_conversion_state", runningQueue(1, AUTHORITY_B));
    await browser.waitUntil(
      async () => (await callsTo("get_workspace_conversion_state")) >= pollsBefore + 2,
      { timeout: 30_000, timeoutMsg: "the slot was never polled again" },
    );

    // Accepted: what the previous binding described is no longer current.
    await browser.waitUntil(async () => (await settingsState()) !== "ready", {
      timeout: 30_000,
      timeoutMsg: "the replaced binding's settings stayed on screen",
    });
    // And nothing was launched to rediscover it. A conversion owns the lane, so
    // the configuration read this replacement owes stays owed.
    expect(await callsTo("inspect_backend")).toBe(inspectionsBefore);
    expect(await callsTo("read_conversion_configuration")).toBe(readsBefore);
    // The queue itself follows its own ordering and is still on screen.
    expect(await browser.$(`${PANEL} .conversion-queue-list`).isExisting()).toBe(true);
    expect(await unexpectedConsole()).toEqual([]);
  });
});

describe("M6.4 — E10: what BEGIN bound is not what the controls show next", () => {
  it("sends the settings on screen at BEGIN, and nothing afterwards changes that queue", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();

    await setInvokeResult("begin_workspace_conversion_queue", {
      authority: AUTHORITY_A,
      outcome: {
        outcome: "reserved",
        reservation: { reservationId: "reservation-1" },
      },
    });
    await setInvokeResult(
      "choose_workspace_conversion_destination",
      retryableQueue(2, AUTHORITY_A),
    );
    await setInvokeResult("get_workspace_conversion_state", retryableQueue(2, AUTHORITY_A));
    await browser.$(CONVERT).click();

    await browser.waitUntil(async () => (await callsTo("begin_workspace_conversion_queue")) === 1, {
      timeout: 30_000,
      timeoutMsg: "the start never crossed the boundary",
    });
    const begun = (await requestsTo("begin_workspace_conversion_queue"))[0];
    // The exact intent the summary described, bound at the press.
    expect(begun).toMatchObject({
      request: { intentId: shippedIntent.id, conflictPolicy: "fail", expectedReceipt: A },
    });

    // Located by what it says rather than by its class: the finished-queue block
    // offers more than one secondary control, and a selector that matched the
    // first would be asserting about whichever one happened to render first.
    await browser.waitUntil(async () => (await rerunControl()) !== null, {
      timeout: 30_000,
      timeoutMsg: "the finished queue never offered a rerun",
    });

    // The reader moves the controls to the *next* conversion's settings.
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(FLAT_32), A),
    );
    await chooseAxisValue("precision", "mz32_intensity32");
    await browser.waitUntil(
      async () => (await axisStates("precision")).mz32_intensity32 === "selected",
      { timeout: 30_000, timeoutMsg: "the next conversion's precision was never chosen" },
    );

    // Nothing was started by that, and the queue on screen is untouched.
    expect(await callsTo("begin_workspace_conversion_queue")).toBe(1);
    // The rerun names nothing at all: what it repeats is the queue's own
    // binding, which is Rust's to remember.
    await setInvokeResult("retry_workspace_conversion_queue", retryableQueue(3, AUTHORITY_A));
    const rerun = await rerunControl();
    expect(rerun).not.toBeNull();
    await browser.execute((label: string) => {
      const control = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      (control as HTMLButtonElement | undefined)?.click();
    }, rerun as string);
    await browser.waitUntil(
      async () => (await callsTo("retry_workspace_conversion_queue")) === 1,
      { timeout: 30_000, timeoutMsg: "the rerun never crossed the boundary" },
    );
    expect((await requestsTo("retry_workspace_conversion_queue"))[0]).toEqual({});
    expect(await callsTo("begin_workspace_conversion_queue")).toBe(1);
  });
});

describe("M6.4 — E11: the banner stops naming a build it has left", () => {
  it("disclaims the reading a refused BEGIN superseded, and recovers it", async () => {
    await openTheWorkspace();
    await awaitSettings("ready");
    await awaitPlan();
    // Everything the banner names, on screen as fact.
    expect(await bannerText()).toContain("ProteoWizard is available");
    expect(await owners("__none__")).toBe(0);
    const inspectionsBefore = await callsTo("inspect_backend");

    // Rust's own discovery is the first thing in the session to see binding B,
    // and the refusal carries it. Nothing else would arrive to correct a screen
    // still showing the build the session has left.
    await setInvokeResult("begin_workspace_conversion_queue", {
      authority: AUTHORITY_B,
      outcome: {
        outcome: "refused",
        error: {
          kind: "conversion_binding_replaced",
          summary: "The installed ProteoWizard changed, so this conversion was not started.",
          detail: null,
          correctiveAction: null,
          retryable: false,
        },
      },
    });
    // Held, so the window between accepting the projection and reading the
    // build it names is one a reader could actually be looking at.
    await holdInvoke("inspect_backend");
    await browser.$(CONVERT).click();

    // The claim is about what a reader can see: from the instant the refusal is
    // accepted, nothing on screen names the build the session has left. The
    // check the reading owes is issued at once into the free lane a refused
    // start leaves, and it is held here so that window is one this test can
    // look at rather than one that has already closed.
    await browser.waitUntil(
      async () => (await callsTo("inspect_backend")) === inspectionsBefore + 1,
      { timeout: 30_000, timeoutMsg: "the superseded reading was never replaced" },
    );
    const page = await browser.execute(() => document.body.textContent ?? "");
    expect(page).not.toContain("ProteoWizard is available");
    expect(page).not.toContain(availableBackend.release ?? "3.0.25000");
    expect(page).not.toContain("built 2026-05-04");
    // And nothing was created by the start that was refused.
    expect(await callsTo("choose_workspace_conversion_destination")).toBe(0);

    await setInvokeResult("inspect_backend", reading(AUTHORITY_B));
    await releaseInvokeHold("inspect_backend");
    await browser.waitUntil(async () => (await superseded()) === null, {
      timeout: 30_000,
      timeoutMsg: "the banner never came back",
    });
    expect(await bannerText()).toContain("ProteoWizard is available");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("waits for a running queue to release the lane, and keeps a way out meanwhile", async () => {
    await openTheWorkspace({ get_workspace_conversion_state: runningQueue(1, AUTHORITY_A) });
    await browser.$(`${PANEL} .conversion-queue-list`).waitForExist({ timeout: 30_000 });
    const inspectionsBefore = await callsTo("inspect_backend");
    const pollsBefore = await callsTo("get_workspace_conversion_state");

    // A newer publication, delivered by the poll while the drain owns the lane.
    await setInvokeResult("get_workspace_conversion_state", runningQueue(1, AUTHORITY_B));
    await setInvokeResult("inspect_backend", reading(AUTHORITY_B));
    await browser.waitUntil(async () => (await superseded()) !== null, {
      timeout: 30_000,
      timeoutMsg: "the banner never disclaimed the reading the poll superseded",
    });

    // Accepted, and nothing launched behind the drain this document has been
    // told about.
    expect(await callsTo("inspect_backend")).toBe(inspectionsBefore);
    await browser.waitUntil(
      async () => (await callsTo("get_workspace_conversion_state")) >= pollsBefore + 3,
      { timeout: 30_000, timeoutMsg: "the slot was never polled again" },
    );
    expect(await callsTo("inspect_backend")).toBe(inspectionsBefore);
    // The reader still has a way out while it waits.
    expect(await supersededRecheckEnabled()).toBe(true);

    // The queue ends. Its completion is the occasion, though the publication it
    // carries is the one already on screen.
    await setInvokeResult("get_workspace_conversion_state", terminalQueue(2, AUTHORITY_B));
    await browser.waitUntil(async () => (await superseded()) === null, {
      timeout: 30_000,
      timeoutMsg: "the owed check never ran once the lane was free",
    });
    expect(await callsTo("inspect_backend")).toBe(inspectionsBefore + 1);
    expect(await bannerText()).toContain("ProteoWizard is available");
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const viewport of [
    { name: "1920x1080", width: 1_920, height: 1_080 },
    { name: "1366x768", width: 1_366, height: 768 },
    { name: "960x640", width: 960, height: 640 },
  ] as const) {
    it(`fits the disclaimer at ${viewport.name} without hiding a way out`, async () => {
      // A new notice variant is rendered UI work, so it is measured where the
      // rest of this shell is: the widest desktop, the reference window, and a
      // narrow one. It is a flex row that wraps, and what must not happen is the
      // page scrolling sideways or a control leaving the column it belongs to.
      await openTheWorkspace({ get_workspace_conversion_state: runningQueue(1, AUTHORITY_A) });
      await browser.setWindowSize(viewport.width, viewport.height);
      await browser.$(`${PANEL} .conversion-queue-list`).waitForExist({ timeout: 30_000 });
      await setInvokeResult("get_workspace_conversion_state", runningQueue(1, AUTHORITY_B));
      await browser.waitUntil(async () => (await superseded()) !== null, {
        timeout: 30_000,
        timeoutMsg: "the banner never disclaimed the reading the poll superseded",
      });

      const notice = await boxOf('[data-backend-reading="superseded"]');
      expect(notice.height).toBeGreaterThan(0);
      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
      // Every control it offers is inside it, and reachable.
      const controls = await browser.execute(() => {
        const banner = document.querySelector('[data-backend-reading="superseded"]');
        const box = banner?.getBoundingClientRect();
        return [...(banner?.querySelectorAll("button") ?? [])].map((control) => {
          const own = control.getBoundingClientRect();
          return {
            label: control.textContent?.trim() ?? "",
            inside:
              box !== undefined &&
              own.right <= box.right + 0.5 &&
              own.bottom <= box.bottom + 0.5,
            enabled: !(control as HTMLButtonElement).disabled,
          };
        });
      });
      expect(controls.length).toBeGreaterThanOrEqual(3);
      // Reported as one object per control, so a failure names which one.
      expect(controls.filter((control) => !control.inside)).toEqual([]);
      expect(controls.filter((control) => !control.enabled)).toEqual([]);
      // And the keyboard reaches the one the reader would press first.
      await browser.execute(() => {
        const banner = document.querySelector('[data-backend-reading="superseded"]');
        const control = [...(banner?.querySelectorAll("button") ?? [])].find(
          (candidate) => candidate.textContent?.trim() === "Check again",
        );
        (control as HTMLElement | undefined)?.focus();
      });
      expect(
        await browser.execute(() => (document.activeElement?.textContent ?? "").trim()),
      ).toBe("Check again");
      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});

describe("M6.4 — one lane fact, many refused actions, one notice", () => {
  it("gives every control refused by one fact the same unambiguous target", async () => {
    await openTheWorkspace({
      read_conversion_configuration: {
        authority: AUTHORITY_A,
        configuration: {
          configuration: "failed",
          error: {
            kind: "backend_help_unreadable",
            summary: "The installed ProteoWizard did not describe the commands MSCanvas needs.",
            detail: null,
            correctiveAction: null,
            retryable: true,
          },
        },
        outcome: { outcome: "answered" },
      },
    });
    await awaitSettings("failed");

    // A backend check in flight refuses `Convert` and the settings read alike,
    // in two authorities' vocabularies about one fact.
    await holdInvoke("inspect_backend");
    await pressCheckAgain();

    const notice = "conversion-availability-backend-changing";
    await browser.waitUntil(async () => (await owners(notice)) === 1, {
      timeout: 30_000,
      timeoutMsg: "the backend-changing fact was never stated",
    });
    expect(await reasons()).toEqual(["MSCanvas is checking the installed ProteoWizard."]);
    expect(await describedBy(CONVERT)).toContain(notice);

    const retryDescribedBy = await browser.execute(() => {
      const control = [...document.querySelectorAll("button.link-button")].find(
        (candidate) => candidate.textContent?.trim() === "Read the settings again",
      );
      return (control?.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id !== "");
    });
    // The shared fact, and the read's own failure, which is not shared.
    expect(retryDescribedBy).toEqual(["conversion-settings-failure", notice]);
    // Generic, because the next duplicate will be a different pair.
    expect(await duplicateIds()).toEqual([]);

    await releaseInvokeHold("inspect_backend");
    await browser.waitUntil(async () => (await owners(notice)) === 0, {
      timeout: 30_000,
      timeoutMsg: "the fact's sentence outlived the fact",
    });
    expect(await unexpectedConsole()).toEqual([]);
  });
});

describe("M6.4 — CNV-D2: a combination this product has no source evidence for", () => {
  /**
   * The catalog the vendor workflow really receives, on a build that can express
   * every row. The two centroiding rows are refused, and refused for the source
   * evidence rather than for the installation.
   *
   * What only a browser can add here is that the sentence, the control and the
   * layout agree in the shipped bundle: the unit suites pin the rule, and they
   * cannot see a disabled control that is still in the tab order, a note that is
   * clipped, or a panel that scrolls sideways to show it.
   */
  const FLAT_64 = intentId("no_additional_centroiding", "all", "mz64_intensity64", "zlib");
  const REFUSED = 'input[name="conversion-setting-processing"][value="unscoped_default_centroiding"]';
  const NOTE_ID = "conversion-choice-processing-unscoped_default_centroiding";

  /** The sentence one refused choice carries, read from the note it names. */
  async function refusalNote(): Promise<string> {
    return browser.execute(
      (id: string) => document.getElementById(id)?.textContent ?? "",
      NOTE_ID,
    ) as Promise<string>;
  }

  it("is not runnable, says why at combination level, and costs no other choice", async () => {
    await openTheWorkspace({
      read_conversion_configuration: configuration(AUTHORITY_A, vendorWorkflowCatalog),
    });
    await awaitSettings("ready");
    await awaitPlan();

    // One axis first, to a row this catalog runs, so there is a deliberate
    // non-default choice for the refusal below to preserve.
    await setInvokeResult(
      "describe_workspace_conversion_queue",
      plannedAs(intentOf(FLAT_64), A),
    );
    await chooseAxisValue("precision", "mz64_intensity64");
    await browser.waitUntil(
      async () => (await axisStates("precision")).mz64_intensity64 === "selected",
      { timeout: 30_000, timeoutMsg: "the 64/64 row was never selected" },
    );

    // Not runnable, and not merely unselected.
    expect(await axisStates("processing")).toMatchObject({
      unscoped_default_centroiding: "unavailable",
    });
    expect(await browser.$(REFUSED).isEnabled()).toBe(false);

    // The sentence is about the combination, and it is not the grammar one. A
    // reader told the installed build does not offer this would go looking for
    // another ProteoWizard release and find one that behaves identically.
    const note = await refusalNote();
    expect(note).toContain("Not available with the other settings you have chosen");
    expect(note).toContain("MSCanvas has not measured that combination");
    expect(note).not.toContain("installed ProteoWizard build");

    // Nothing else moved, and no other axis is blamed for it. 64-bit intensity,
    // all spectra and zlib all appear in rows this catalog runs.
    expect(await axisStates("precision")).toMatchObject({ mz64_intensity64: "selected" });
    expect(await axisStates("population")).toMatchObject({ all: "selected" });
    expect(await axisStates("compression")).toMatchObject({ zlib: "selected" });
    for (const axis of ["population", "precision", "compression"]) {
      const refused = Object.entries(await axisStates(axis)).filter(
        ([, state]) => state === "unavailable",
      );
      expect(refused).toEqual([]);
    }

    // The way out is the ordinary control, so no explicit reset is offered and
    // the conversion the reader can actually run stays offered.
    expect(await browser.$(".conversion-settings-recovery").isExisting()).toBe(false);
    expect(await browser.$(CONVERT).isEnabled()).toBe(true);

    // Keyboard: the refused value is out of the tab order rather than focusable
    // and inert, the way out takes focus, and the sentence is associated with
    // the control it is about rather than only placed near it.
    const keyboard = await browser.execute(() => {
      const group = document.querySelector('[data-axis="processing"]');
      const inputs = [...(group?.querySelectorAll("input") ?? [])] as HTMLInputElement[];
      const refused = inputs.find((input) => input.value === "unscoped_default_centroiding");
      const wayOut = inputs.find((input) => input.value === "no_additional_centroiding");
      wayOut?.focus();
      return {
        refusedDisabled: refused?.disabled ?? null,
        refusedDescribedBy: refused?.getAttribute("aria-describedby") ?? null,
        wayOutDisabled: wayOut?.disabled ?? null,
        wayOutFocused: document.activeElement === wayOut,
      };
    });
    expect(keyboard.refusedDisabled).toBe(true);
    expect(keyboard.wayOutDisabled).toBe(false);
    expect(keyboard.wayOutFocused).toBe(true);
    expect(keyboard.refusedDescribedBy).toBe(NOTE_ID);

    // The new sentence is laid out rather than clipped, and showing it does not
    // make the document scroll sideways at this viewport.
    const noteBox = await boxOf(`#${NOTE_ID}`);
    const panelBox = await boxOf(SETTINGS);
    expect(noteBox.width).toBeGreaterThan(0);
    expect(noteBox.height).toBeGreaterThan(0);
    expect(noteBox.left).toBeGreaterThanOrEqual(panelBox.left - 1);
    expect(noteBox.right).toBeLessThanOrEqual(panelBox.right + 1);
    const fit = await browser.execute(
      (id: string) => {
        const element = document.getElementById(id);
        return element === null
          ? null
          : {
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
      },
      NOTE_ID,
    );
    expect(fit).not.toBeNull();
    expect(fit!.scrollHeight).toBeLessThanOrEqual(fit!.clientHeight + 1);
    expect(fit!.scrollWidth).toBeLessThanOrEqual(fit!.clientWidth + 1);
    const overflow = await horizontalOverflow();
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const viewport of [
    { name: "1920x1080", width: 1_920, height: 1_080 },
    { name: "1366x768", width: 1_366, height: 768 },
    { name: "960x640", width: 960, height: 640 },
  ] as const) {
    it(`fits the source-evidence note at ${viewport.name}`, async () => {
      // Condition A of this milestone is not what this is for. ADR 0043's
      // milestone-wide condition B asks that every M6 control satisfy the
      // inherited interaction principles at all three responsive targets, and
      // this repair adds a notice variant to an M6 control. The behavioural
      // case above is measured once, at the reference window; what is repeated
      // here is only the layout question a narrower or wider column can change.
      await openTheWorkspace({
        read_conversion_configuration: configuration(AUTHORITY_A, vendorWorkflowCatalog),
      });
      await browser.setWindowSize(viewport.width, viewport.height);
      await awaitSettings("ready");
      await setInvokeResult(
        "describe_workspace_conversion_queue",
        plannedAs(intentOf(FLAT_64), A),
      );
      await chooseAxisValue("precision", "mz64_intensity64");
      await browser.waitUntil(
        async () => (await axisStates("precision")).mz64_intensity64 === "selected",
        { timeout: 30_000, timeoutMsg: "the 64/64 row was never selected" },
      );

      // The note is still the source-evidence one, still laid out rather than
      // clipped, still inside the panel, and still not a cause of sideways
      // scrolling.
      expect(await refusalNote()).toContain("MSCanvas has not measured that combination");
      const noteBox = await boxOf(`#${NOTE_ID}`);
      const panelBox = await boxOf(SETTINGS);
      expect(noteBox.height).toBeGreaterThan(0);
      expect(noteBox.left).toBeGreaterThanOrEqual(panelBox.left - 1);
      expect(noteBox.right).toBeLessThanOrEqual(panelBox.right + 1);
      const fit = await browser.execute(
        (id: string) => {
          const element = document.getElementById(id);
          return element === null
            ? null
            : {
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
              };
        },
        NOTE_ID,
      );
      expect(fit).not.toBeNull();
      expect(fit!.scrollHeight).toBeLessThanOrEqual(fit!.clientHeight + 1);
      expect(fit!.scrollWidth).toBeLessThanOrEqual(fit!.clientWidth + 1);
      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);

      // And the way out is still enabled and still takes focus at this width.
      const wayOut = await browser.execute(() => {
        const group = document.querySelector('[data-axis="processing"]');
        const inputs = [...(group?.querySelectorAll("input") ?? [])] as HTMLInputElement[];
        const control = inputs.find((input) => input.value === "no_additional_centroiding");
        control?.focus();
        return {
          disabled: control?.disabled ?? null,
          focused: document.activeElement === control,
        };
      });
      expect(wayOut.disabled).toBe(false);
      expect(wayOut.focused).toBe(true);

      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  /**
   * The other three sentences the repair added, at the three responsive targets.
   *
   * **A state the shipped catalog cannot produce, rendered on purpose.** The
   * banner, the plan area and the explanation of a disabled `Convert` only speak
   * when the *selected* row is withheld, and production withholds only
   * reader-sensitive rows — never the shipped posture, which is writer-side. So
   * this drives a catalog whose shipped row is withheld, which is the one way to
   * put all three on screen.
   *
   * It is defence in depth rather than a journey, and it is measured anyway for
   * two reasons: condition B asks about the controls this milestone ships rather
   * than about the paths a reader can reach today, and a sentence that is in the
   * bundle can be rendered by a later catalog. What it must never say is that
   * the installation cannot run the combination.
   */
  const withheldShipped = vendorWorkflowCatalog.map((row) =>
    row.intent.id === shippedIntent.id
      ? {
          ...row,
          available: false,
          availability: "not_evidenced_for_conversion_sources" as const,
        }
      : row,
  );

  for (const viewport of [
    { name: "1920x1080", width: 1_920, height: 1_080 },
    { name: "1366x768", width: 1_366, height: 768 },
    { name: "960x640", width: 960, height: 640 },
  ] as const) {
    it(`fits the banner, the plan sentence and the refused Convert at ${viewport.name}`, async () => {
      await openTheWorkspace({
        read_conversion_configuration: configuration(AUTHORITY_A, withheldShipped),
      });
      await browser.setWindowSize(viewport.width, viewport.height);
      await awaitSettings("ready");

      const banner = "#conversion-settings-selection-unavailable";
      await browser.$(banner).waitForExist({ timeout: 30_000 });

      // Each of the three says the evidence is missing, and none of them sends
      // the reader after a different ProteoWizard release.
      const sentences = await browser.execute((selector: string) => {
        const text = (node: Element | null) => node?.textContent?.trim() ?? "";
        return {
          banner: text(document.querySelector(selector)),
          plan: text(document.querySelector(".empty-state")),
          body: document.body.textContent ?? "",
        };
      }, banner);
      expect(sentences.banner).toContain("has not measured the conversion settings you chose");
      expect(sentences.banner).not.toContain("ProteoWizard installation");
      expect(sentences.plan).toContain("has not measured the conversion settings you chose");
      expect(sentences.plan).not.toContain("installed ProteoWizard does not offer");
      expect(sentences.body).not.toContain(
        "The installed ProteoWizard does not offer the conversion settings you chose",
      );

      // Convert is refused, and refused for that reason rather than another.
      expect(await browser.$(CONVERT).isEnabled()).toBe(false);

      // Laid out rather than clipped, inside the panel, and not a cause of
      // sideways scrolling at this width.
      const bannerBox = await boxOf(banner);
      const panelBox = await boxOf(SETTINGS);
      expect(bannerBox.height).toBeGreaterThan(0);
      expect(bannerBox.left).toBeGreaterThanOrEqual(panelBox.left - 1);
      expect(bannerBox.right).toBeLessThanOrEqual(panelBox.right + 1);
      const fit = await browser.execute((selector: string) => {
        const element = document.querySelector(selector);
        return element === null
          ? null
          : {
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
      }, banner);
      expect(fit).not.toBeNull();
      expect(fit!.scrollHeight).toBeLessThanOrEqual(fit!.clientHeight + 1);
      expect(fit!.scrollWidth).toBeLessThanOrEqual(fit!.clientWidth + 1);
      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);

      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
