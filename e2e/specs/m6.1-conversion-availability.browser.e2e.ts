/**
 * M6.1 rendered QA — what the conversion panel says, and keeps doing, when a
 * conversion cannot start.
 *
 * The unit suites pin the rule, its eleven reasons, the dispatch window and the
 * stale-read rewind. What only a browser can answer is whether the explanation
 * is reachable and legible at the windows people use, whether two controls
 * refused by one lane fact really produce one sentence in the shipped document,
 * and — the claim this slice stands on — whether the shipped bundle sends
 * nothing across the boundary when a blocked activation lands on a control by
 * pointer or by keyboard.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * below about what did or did not cross the boundary is a claim about the
 * shipped frontend.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  consoleEntries,
  horizontalOverflow,
  installIpcBoundary,
  ipcCalls,
  setInvokeResult,
} from "../support/harness";
import { ipcTable, VENDOR_ROW } from "../support/fixtures";
import {
  availableBackend,
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
const REGION = '[data-live-region="conversion-availability"]';
const SIDEBAR = ".workspace-sidebar";
const VENDOR = `li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`;
const SEARCH = "#dataset-roster-search";
const SORT = "#dataset-roster-sort";

const BACKEND_REASON =
  "Converting needs ProteoWizard, and this session has no usable backend. " +
  "See the backend status above.";

/** The plan the panel reads for the focused vendor row. */
const PLAN = {
  items: [
    {
      datasetHandle: VENDOR_ROW.handle,
      fileName: VENDOR_ROW.fileName,
      sourceKind: VENDOR_ROW.sourceKind,
      output: { kind: "knownSingle", fileName: "sample-9.mzML" },
    },
  ],
  intent: SHIPPED_INTENT,
  conflictPolicy: "fail",
  validationMode: "output_only",
  capacity: 16,
  installationGeneration: 0,
};

/** A finished queue holding one failure another attempt could change. */
const RETRYABLE_QUEUE = {
  sequence: 1,
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
  diagnostics: { available: false, itemCount: 0, exporting: false, lastExport: null },
  backendQuarantined: false,
};

/**
 * The workspace with a convertible row focused and a finished queue on screen.
 *
 * Both conversion controls at once, which is the state the one-sentence claim
 * is actually about: a start over the roster's selection, and a rerun over the
 * queue that just failed.
 */
async function openTheWorkspace(
  options: { readonly width?: number; readonly height?: number } = {},
): Promise<void> {
  await browser.setWindowSize(options.width ?? 1_366, options.height ?? 768);
  await installIpcBoundary({
    ...ipcTable(),
    describe_workspace_conversion_queue: PLAN,
    get_workspace_conversion_state: RETRYABLE_QUEUE,
  });
  await browser.url("/");
  await browser.$(VENDOR).waitForDisplayed({ timeout: 60_000 });
  await browser.$(VENDOR).click();
  await browser.$(PANEL).waitForDisplayed({ timeout: 60_000 });
  await browser.$(`${PANEL} button.primary-button`).waitForDisplayed({ timeout: 60_000 });
}

/** Every sentence the panel is currently giving as a reason. */
async function reasons(): Promise<string[]> {
  return browser.execute(
    (selector: string) =>
      [...document.querySelectorAll(`${selector} p`)].map((element) => element.textContent ?? ""),
    REGION,
  );
}

/** How many rows the roster is showing, which search narrows and nothing else does. */
async function rowCount(): Promise<number> {
  return browser.execute(() => document.querySelectorAll("li.dataset-row").length);
}

async function describedBy(selector: string): Promise<string | null> {
  return browser.execute(
    (target: string) => document.querySelector(target)?.getAttribute("aria-describedby") ?? null,
    selector,
  );
}

/** Whichever conversion request has been made, by name. */
function conversionStarts(calls: { command: string }[]): number {
  return calls.filter(
    (call) =>
      call.command === "begin_workspace_conversion_queue" ||
      call.command === "retry_workspace_conversion_queue",
  ).length;
}

/**
 * Closes the lane the way a reader can actually close it here.
 *
 * The backend verdict is one mocked object and one visible control, so this
 * drives the real path -- press `Check again`, get a different answer -- rather
 * than reaching past the interface.
 */
async function recheckTheBackend(verdict: unknown): Promise<void> {
  await setInvokeResult("inspect_backend", verdict);
  const buttons = await browser.$$("button.link-button");
  for (const button of buttons) {
    if ((await button.getText()).trim() === "Check again") {
      await button.click();
      return;
    }
  }
  throw new Error("the backend banner offers no Check again");
}

async function blockTheLane(): Promise<void> {
  await recheckTheBackend(unavailableBackend);
  await browser.waitUntil(async () => (await reasons())[0] === BACKEND_REASON, {
    timeout: 30_000,
    timeoutMsg: "the panel never said why converting was unavailable",
  });
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

describe("M6.1 — conversion-lane availability, rendered", () => {
  it("says nothing, and describes nothing, while a conversion can start", async () => {
    await openTheWorkspace();

    // The region exists before it has anything to say, so it is being watched
    // when the text arrives rather than arriving with it.
    expect(await browser.$(REGION).isExisting()).toBe(true);
    expect(await reasons()).toEqual([]);
    expect(await describedBy(`${PANEL} button.primary-button`)).toBe(
      "conversion-plan-summary conversion-validation-disclosure",
    );
    expect(await describedBy(`${PANEL} button.secondary-button`)).toBe("conversion-retry-scope");
  });

  it("explains a closed lane once, and points both controls at that one sentence", async () => {
    await openTheWorkspace();
    await blockTheLane();

    expect(await reasons()).toEqual([BACKEND_REASON]);
    // Once in the document. Not a visible sentence plus a hidden copy, and not
    // one sentence per control -- the two controls share a lane, and a reader
    // meeting the second one is not told the same thing twice.
    const occurrences = await browser.execute(
      (reason: string) => (document.body.textContent ?? "").split(reason).length - 1,
      BACKEND_REASON,
    );
    expect(occurrences).toBe(1);

    // The refusal, and nothing else, because there is nothing else on screen.
    //
    // Since M6.4 a plan is an answer about a conversion semantic, and which
    // semantics exist is an answer about an installed executable — so a session
    // with no usable ProteoWizard has neither, and the panel does not pretend
    // to be reading one. What the control points at is what is actually there.
    expect(await describedBy(`${PANEL} button.primary-button`)).toBe(
      "conversion-availability-backend-unavailable",
    );
    expect(await describedBy(`${PANEL} button.secondary-button`)).toBe(
      "conversion-retry-scope conversion-availability-backend-unavailable",
    );
    // Announced politely, by the element that was already there.
    expect(
      await browser.execute(
        (selector: string) => document.querySelector(selector)?.getAttribute("aria-live") ?? null,
        REGION,
      ),
    ).toBe("polite");
  });

  it("sends nothing across the boundary from either control while blocked", async () => {
    await openTheWorkspace();
    await blockTheLane();
    const before = conversionStarts(await ipcCalls());

    for (const selector of [
      `${PANEL} button.primary-button`,
      `${PANEL} button.secondary-button`,
    ]) {
      const control = await browser.$(selector);
      expect(await control.isEnabled()).toBe(false);
      // The pointer, and then both activations from the keyboard. A disabled
      // control is refused by the platform, and that is the claim: the two are
      // equivalent because neither reaches the operation.
      await control.click({ skipRelease: false }).catch(() => undefined);
      await browser.execute((target: string) => {
        (document.querySelector(target) as HTMLElement | null)?.focus();
      }, selector);
      await browser.keys("Enter");
      await browser.keys(" ");
    }

    expect(conversionStarts(await ipcCalls())).toBe(before);
  });

  it("keeps every backend-free interaction live while blocked", async () => {
    await openTheWorkspace();
    await blockTheLane();

    // A conversion lane that refuses is not a reason to freeze the workspace.
    // None of these asks the backend for anything, and each is governed by its
    // own authority.
    expect(await browser.$(SEARCH).isEnabled()).toBe(true);
    expect(await browser.$(SORT).isEnabled()).toBe(true);
    const before = (await ipcCalls()).length;

    // Typed rather than assigned, so this is the input the application really
    // receives and not a value pushed past its handler.
    await browser.$(SEARCH).click();
    await browser.keys([..."sample-9"]);
    await browser.waitUntil(async () => (await rowCount()) === 1, {
      timeout: 15_000,
      timeoutMsg: "search stopped filtering while the lane was closed",
    });
    await browser.keys(Array.from({ length: "sample-9".length }, () => "Backspace"));
    await browser.waitUntil(async () => (await rowCount()) === 2, {
      timeout: 15_000,
      timeoutMsg: "search never restored the list",
    });

    // And the roster still moves under the keyboard without committing
    // anything.
    await browser.execute((target: string) => {
      (document.querySelector(target) as HTMLElement | null)?.focus();
    }, VENDOR);
    await browser.keys("ArrowUp");
    expect(
      await browser.execute(() => document.activeElement?.getAttribute("data-handle") ?? null),
    ).not.toBe(VENDOR_ROW.handle);
    expect((await ipcCalls()).length).toBe(before);
  });

  it("starts a conversion again as soon as the lane clears", async () => {
    await openTheWorkspace();
    await blockTheLane();
    await recheckTheBackend(availableBackend);
    await browser.waitUntil(async () => (await reasons()).length === 0, {
      timeout: 30_000,
      timeoutMsg: "the panel never stopped saying converting was unavailable",
    });

    expect(await describedBy(`${PANEL} button.primary-button`)).toBe(
      "conversion-plan-summary conversion-validation-disclosure",
    );
    const before = conversionStarts(await ipcCalls());
    await browser.$(`${PANEL} button.primary-button`).click();
    await browser.waitUntil(async () => conversionStarts(await ipcCalls()) > before, {
      timeout: 30_000,
      timeoutMsg: "the panel never started a conversion after the lane cleared",
    });
  });

  it("withdraws every conversion control the moment one is dispatched", async () => {
    // The window the M5 handoff left open. The rendered claim is that the panel
    // stops offering in the same commit as the press, rather than when a slot
    // read gets back -- so no second activation is ever on screen, and the
    // finished queue's own controls go with it rather than standing under a
    // sentence saying something else is starting.
    await openTheWorkspace();
    await setInvokeResult("begin_workspace_conversion_queue", { reservationId: "reservation-1" });
    // A destination command that never answers, which is what an open native
    // folder picker is: the reservation has landed and Rust has no queue to
    // report until the user has chosen. The table can only resolve or reject,
    // so this one command is held at the boundary the table itself installs.
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
    await browser.waitUntil(
      async () => !(await browser.$(`${PANEL} button.primary-button`).isExisting()),
      { timeout: 30_000, timeoutMsg: "the start control stayed on screen after it was pressed" },
    );
    // Read from the block itself, with the panel scrolled to it. `getText`
    // reports what is *visible*, and this panel owns its own overflow -- a
    // sentence below the fold is absent as far as both a reader and the driver
    // are concerned, which is the reason to bring it into view rather than to
    // read around it.
    await browser.execute((selector: string) => {
      const panel = document.querySelector(selector);
      if (panel !== null) {
        panel.scrollTop = 0;
      }
    }, PANEL);
    const started = await browser.$(`${PANEL} .conversion-running`);
    expect(await started.getText()).toContain("Starting the conversion");
    expect(await browser.$(`${PANEL} button.secondary-button`).isExisting()).toBe(false);
    expect(await reasons()).toEqual([]);
  });

  for (const viewport of VIEWPORTS) {
    it(`fits the explanation at ${viewport.name} without hiding a control`, async () => {
      await openTheWorkspace({ width: viewport.width, height: viewport.height });
      const before = await boxOf(SIDEBAR);
      await blockTheLane();

      // The sentence is on screen and inside the column it belongs to.
      const notice = await boxOf(`${REGION} p`);
      expect(notice.height).toBeGreaterThan(0);
      const sidebar = await boxOf(SIDEBAR);
      expect(Math.abs(sidebar.width - before.width)).toBeLessThan(1);
      expect(notice.right).toBeLessThanOrEqual(sidebar.right + 1);

      // Both refused controls are still there, said rather than removed: an
      // action that is refused is a different thing from one that is gone.
      expect(await browser.$(`${PANEL} button.primary-button`).isExisting()).toBe(true);
      expect(await browser.$(`${PANEL} button.secondary-button`).isExisting()).toBe(true);

      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
