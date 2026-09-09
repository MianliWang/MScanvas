/** M6.9 browser evidence: production React, mocked Tauri boundary only. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, horizontalOverflow, installIpcBoundary, ipcCalls, setInvokeResult } from "../support/harness";
import { ipcTable } from "../support/fixtures";
import { availableBackend, completeCatalog, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
import type { ConversionOutputMember, ConversionQueueItem, SelectedFile, WorkspaceConversionUpdate } from "../../apps/desktop/src/features/mzml-preview/contracts";

const STATE = "get_workspace_conversion_state";
const ADOPT = "adopt_workspace_conversion_outputs";
const PANEL = "section.conversion-panel";
const RUNNING = `${PANEL} .conversion-running`;
const LIST = `${RUNNING} .conversion-queue-list`;
const authority = settledAt(1, 1);

const row = (index: number): SelectedFile => ({ handle: `raw-${index}`, fileName: `sample-${index}.raw`, byteLength: index * 1_000, sourceKind: "thermo_raw", relativeContext: null });

const DIGEST = "6CE2ACE65485488F4A337EE17B71559E737C1944B641F279744932C3C3D8648C";

/** A converted row: one output published, judged output-only. */
function converted(index: number): ConversionQueueItem {
  return {
    datasetHandle: row(index).handle, fileName: row(index).fileName, sourceKind: "thermo_raw",
    output: { kind: "knownSingle", fileName: `sample-${index}.mzML` },
    state: "finalized", attempts: 1, retryable: false, error: null, cancellation: null, stopRequested: false,
    result: {
      kind: "single",
      report: {
        datasetHandle: row(index).handle, sourceKind: "thermo_raw", outcome: "finalized", detailedOutcome: null,
        outputFileName: `sample-${index}.mzML`,
        output: { byteLength: 28_655, sha256: DIGEST, spectrumCount: 12, chromatogramCount: 3 },
        validation: {
          mode: "output_only", fullyVerified: false,
          verified: ["output_is_well_formed_mzml"], unverified: [],
          // Empty, and it has to be: an advisory observation is recorded only
          // by the source comparison, and no family the visible queue accepts
          // is read under one.
          inapplicable: ["source_spectrum_count_preserved"], advisory: [],
        },
        backend: { exitCode: 0, elapsedMilliseconds: 568 }, stagingResidue: null, receipt: 1,
      },
    },
    process: { kind: "settled", termination: "exited", exitCode: 0 },
    staged: { kind: "published" },
    runIdentity: `6f1d3c2b9a48000000000000000000${index}0`.slice(0, 32),
    adoption: { kind: "notRequested" },
  } as ConversionQueueItem;
}

/**
 * The decisive pair: two failures that ended the same way, one having staged
 * something and one not. Everything else about them is identical.
 */
function failed(index: number, stagedSomething: boolean): ConversionQueueItem {
  return {
    datasetHandle: row(index).handle, fileName: row(index).fileName, sourceKind: "thermo_raw",
    output: { kind: "knownSingle", fileName: `sample-${index}.mzML` },
    state: "failed", attempts: 1, retryable: false, error: null, cancellation: null, stopRequested: false,
    result: {
      kind: "single",
      report: {
        datasetHandle: row(index).handle, sourceKind: "thermo_raw", outcome: "backend_rejected",
        detailedOutcome: "backend_rejected", outputFileName: null, output: null, validation: null,
        backend: { exitCode: 3, elapsedMilliseconds: 412 }, stagingResidue: null, receipt: 1,
      },
    },
    process: { kind: "settled", termination: "exited", exitCode: 3 },
    staged: stagedSomething
      ? {
          kind: "observed",
          phase: "provider_returned",
          entryCount: 1,
          directoryCount: 0,
          nonEmptyFileObserved: true,
          bounded: false,
        }
      : {
          kind: "observed",
          phase: "provider_returned",
          entryCount: 0,
          directoryCount: 0,
          nonEmptyFileObserved: false,
          bounded: false,
        },
    runIdentity: `6f1d3c2b9a48000000000000000000${index}1`.slice(0, 32),
    adoption: { kind: "nothingToAdopt" },
  } as ConversionQueueItem;
}

/** A row whose staging area could not be read: unknown, and never empty. */
function unknownStaging(index: number): ConversionQueueItem {
  return { ...failed(index, false), staged: { kind: "unobserved", phase: "provider_returned" } } as ConversionQueueItem;
}

const SET_MEMBERS: readonly string[] = ["Enolase_S1.mzML", "Enolase_S2.mzML", "Enolase_S3.mzML"];

function member(name: string, index: number, finalized: boolean): ConversionOutputMember {
  return {
    fileName: name,
    state: finalized ? "finalized" : "validated_not_published",
    output: { byteLength: 1_048_576 + index, sha256: DIGEST, spectrumCount: 1_200, chromatogramCount: 1 },
    validation: {
      mode: "output_only", fullyVerified: false,
      verified: ["output_is_well_formed_mzml"], unverified: [],
      inapplicable: ["source_spectrum_count_preserved"], advisory: [],
    },
  };
}

/** A backend-named set that published one of the three files it produced. */
function partialSet(): ConversionQueueItem {
  return {
    datasetHandle: "wiff-1", fileName: "Enolase_repeats.wiff", sourceKind: "sciex_wiff",
    output: { kind: "backendNamedSet", maxMembers: 24 },
    state: "failed", attempts: 1, retryable: false, error: null, cancellation: null, stopRequested: false,
    result: {
      kind: "outputSet",
      report: {
        datasetHandle: "wiff-1", sourceKind: "sciex_wiff", groupOutcome: "partially_finalized",
        detailedOutcome: null, maxMembers: 24, memberCount: 3, finalizedCount: 1,
        validatedNotPublishedCount: 2, notPublishedCount: 2, boundSourceObjects: 2,
        members: SET_MEMBERS.map((name, index) => member(name, index, index === 0)),
        backend: { exitCode: 0, elapsedMilliseconds: 4_200 }, stagingResidue: null,
        validationMode: "output_only", completeness: { kind: "notPosed" },
        partial: { finalizedCount: 1, notPublishedCount: 2, failureKind: "already_exists" },
        completeSetAdoptable: false, receipt: 1,
      },
    },
    process: { kind: "settled", termination: "exited", exitCode: 0 },
    staged: {
      kind: "observed",
      phase: "publication_settled",
      entryCount: 2,
      directoryCount: 0,
      nonEmptyFileObserved: true,
      bounded: false,
    },
    runIdentity: "6f1d3c2b9a4800000000000000000c10",
    adoption: { kind: "nothingToAdopt" },
  } as ConversionQueueItem;
}

function queue(items: readonly ConversionQueueItem[], adoptable = 0) {
  const count = (state: ConversionQueueItem["state"]) => items.filter((entry) => entry.state === state).length;
  const failed = count("failed");
  return {
    items, itemCount: items.length, receipt: 1, retryRound: 0,
    currentIndex: items.length,
    conflictPolicy: "fail" as const, destinationPolicy: { kind: "customFolder" as const }, destinationStatus: "bound" as const,
    finalizedCount: count("finalized"), skippedCount: count("skipped"), failedCount: failed,
    retryableFailedCount: 0, nonRetryableFailedCount: failed,
    cancelledCount: count("cancelled"), notRunCount: count("notRun"),
    skippedByRequestCount: count("skippedByRequest"), cancellationFailedCount: count("cancellationFailed"),
    adoptableOutputCount: adoptable, error: null,
  };
}

function terminal(items: readonly ConversionQueueItem[], sequence: number, adoptable = 0): WorkspaceConversionUpdate {
  return {
    sequence,
    state: { status: "terminal", operationId: "1", reason: "completed", queue: queue(items, adoptable) },
    authority, backendQuarantined: false,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
  };
}

const VIEWPORTS: readonly (readonly [number, number])[] = [[1920, 1080], [1366, 768], [1200, 800], [960, 640]];

async function viewport(width: number, height: number) {
  await browser.setWindowSize(width, height);
  const frame = await browser.execute(() => ({ width: outerWidth - innerWidth, height: outerHeight - innerHeight }));
  await browser.setWindowSize(width + frame.width, height + frame.height);
  expect(await browser.execute(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  console.log("M6.9 measured inner viewport", { width, height });
}
async function reveal(selector: string) {
  await browser.execute((target: string) => {
    const x = scrollX, y = scrollY;
    document.querySelector(target)!.scrollIntoView({ block: "center", inline: "nearest" });
    window.scrollTo(x, y);
  }, selector);
}
async function capture(name: string, selector: string) {
  await reveal(selector);
  const directory = process.env.MSCANVAS_QA_ARTIFACTS ?? resolve("test-results", "m6.9-browser");
  await mkdir(directory, { recursive: true });
  await browser.saveScreenshot(resolve(directory, `${name}.png`));
}
async function requests(command: string) { return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args); }

/** The detail text of one row, with its disclosure opened. */
async function details(index: number): Promise<string> {
  const summary = `${LIST} > li:nth-child(${index}) details > summary`;
  await reveal(summary);
  if (!(await browser.$(`${LIST} > li:nth-child(${index}) details`).getAttribute("open"))) {
    await browser.$(summary).click();
  }
  return browser.$(`${LIST} > li:nth-child(${index}) details`).getText();
}

async function start(first: WorkspaceConversionUpdate, datasets: readonly SelectedFile[] = [row(1), row(2), row(3)]) {
  await viewport(1366, 768);
  await installIpcBoundary({ ...ipcTable(), inspect_backend: { ...availableBackend, authority },
    get_workspace_roster: { datasets: [...datasets], capacity: 1024 },
    read_conversion_configuration: { authority, configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id }, outcome: { outcome: "answered" } },
    [STATE]: first,
  });
  await browser.url("/");
  await browser.$(RUNNING).waitForDisplayed({ timeout: 30_000 });
}

describe("M6.9 output completion, the five judgements and adoption", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") await capture(`failure-${this.currentTest.title.slice(0, 25).replace(/[^a-z0-9]/gi, "-")}`, PANEL);
    expect((await consoleEntries()).filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))).toEqual([]);
  });

  it("tells a failure that staged something from one that staged nothing", async () => {
    await start(terminal([failed(1, true), failed(2, false)], 1));

    // Identical on every other judgement a reader can see.
    const states = await browser.execute((list: string) =>
      [...document.querySelectorAll(`${list} > li`)].map((node) => node.getAttribute("data-item-state")), LIST);
    expect(states).toEqual(["failed", "failed"]);

    const before = (await ipcCalls()).length;
    const withContent = await details(1);
    const withoutContent = await details(2);
    // Opening a disclosure asks the boundary for nothing. Everything it shows
    // was already on the wire, so reading it cannot rerun a conversion or
    // re-hash an output.
    expect((await ipcCalls()).length).toBe(before);
    for (const text of [withContent, withoutContent]) {
      expect(text).toContain("The converter ran to its own end, exit code 3.");
      expect(text).toContain("No output obtained a final name.");
      expect(text).toContain("Nothing was checked, because nothing was validated.");
    }
    expect(withContent).toContain(
      "The temporary working folder held 1 entry when the attempt to run a converter returned, at least one of them a file with content.");
    expect(withoutContent).toContain("The temporary working folder was empty when the attempt to run a converter returned.");
    await capture("staged-pair", LIST);
  });

  it("says a staging area was unreadable rather than empty", async () => {
    await start(terminal([unknownStaging(1)], 1));

    const text = await details(1);
    expect(text).toContain(
      "MSCanvas could not read its temporary working folder when the attempt to run a converter returned, so what it held is unknown.");
    expect(text).not.toContain("was empty");
    expect(text).not.toContain("No temporary working folder was created");
    await capture("staging-unknown", LIST);
  });

  it("keeps output-only output-only and shows the manifest", async () => {
    await start(terminal([converted(1)], 1, 1));

    const text = await details(1);
    expect(text).toContain("Output-only. The converted data was not compared against a readable vendor-source model.");
    expect(text).toContain("1 checked, 0 not established, 1 not applicable.");
    // Output-only records no advisory observation, so none is rendered.
    expect(text).not.toContain("advisory observation");
    // And the manifest carries each output's own dispositions, so a set's
    // sentence can name the mode and leave the counts here.
    const headings = await browser.execute((list: string) =>
      [...document.querySelectorAll(`${list} .conversion-item-manifest thead th`)].map(
        (cell) => cell.textContent,
      ), LIST);
    expect(headings).toEqual([
      "File", "State", "Size", "Spectra", "Chromatograms",
      "Checked", "Not established", "Not applicable", "SHA-256",
    ]);
    expect(text).not.toMatch(/fully verified/i);
    expect(text).not.toMatch(/lossless/i);
    // Publication is stated as publication, not as an observation of an empty
    // directory, and the identity names the attempt rather than the file.
    expect(text).toContain("What was written to the temporary working folder took its final name.");
    expect(text).toMatch(/[0-9a-f]{32}/);
    // The manifest carries what sits beside the five.
    expect(text).toContain(DIGEST);
    expect(text).toContain("28.0 KiB");
    await capture("finalized-details", LIST);
  });

  it("counts a partial set against what it produced, never against the bound", async () => {
    await start(terminal([partialSet()], 1), [{ handle: "wiff-1", fileName: "Enolase_repeats.wiff", byteLength: 3_944_804, sourceKind: "sciex_wiff", relativeContext: null }]);

    const text = await details(1);
    expect(text).toContain("1 of 3 discovered output files obtained a final name.");
    expect(text).not.toContain("of 24");
    // What landed and what did not, in one manifest.
    // The state cell is the first `td`; the name is a row header, which is what
    // makes each row announce itself.
    const published = await browser.execute((list: string) =>
      [...document.querySelectorAll(`${list} .conversion-item-manifest tbody tr`)]
        .map((row) => row.querySelector("td")?.textContent ?? ""), LIST);
    expect(published).toEqual(["Finalized", "Not published", "Not published"]);
    const named = await browser.execute((list: string) =>
      [...document.querySelectorAll(`${list} .conversion-item-manifest tbody tr th`)].map((cell) => cell.textContent), LIST);
    expect(named).toEqual(["Enolase_S1.mzML", "Enolase_S2.mzML", "Enolase_S3.mzML"]);
    // The observation was taken after publication, and says so.
    expect(text).toContain("after publication finished");
    // The existing refusal is unchanged.
    expect(await browser.$(PANEL).getText()).toContain("No complete output set is available to add to this workspace.");
    await capture("partial-set-details", LIST);
  });

  it("records what an adoption did on the row it was about, and adds nothing on its own", async () => {
    await start(terminal([converted(1), converted(2)], 1, 2), [row(1), row(2)]);

    // Nothing is adopted because a queue finished.
    expect(await requests(ADOPT)).toEqual([]);
    expect(await details(1)).toContain("Not added yet. Adding outputs to the workspace is something you ask for.");

    const adopted = [
      { ...converted(1), adoption: { kind: "settled", added: 1, alreadyInWorkspace: 0, refused: 0, refusals: [] } } as ConversionQueueItem,
      { ...converted(2), adoption: { kind: "settled", added: 0, alreadyInWorkspace: 0, refused: 1, refusals: ["output_changed"] } } as ConversionQueueItem,
    ];
    await setInvokeResult(ADOPT, {
      operationId: "1", retryRound: 0,
      roster: { datasets: [row(1), row(2)], capacity: 1024 },
      outcomes: [
        { kind: "added", itemIndex: 0, memberIndex: 0, sourceHandle: row(1).handle, outputFileName: "sample-1.mzML", dataset: row(1) },
        { kind: "refused", itemIndex: 1, memberIndex: 0, sourceHandle: row(2).handle, outputFileName: "sample-2.mzML", reason: "output_changed" },
      ],
    });
    await setInvokeResult(STATE, terminal(adopted, 2, 2));
    await reveal(`${PANEL} .conversion-adoption button`);
    await browser.$(`${PANEL} .conversion-adoption button`).click();

    await browser.waitUntil(async () => (await requests(ADOPT)).length === 1);
    await browser.waitUntil(async () => (await details(1)).includes("When outputs were last added"));

    expect(await details(1)).toContain(
      "When outputs were last added: 1 added, 0 already in the workspace, 0 not added.");
    const refusedRow = await details(2);
    expect(refusedRow).toContain(
      "When outputs were last added: 0 added, 0 already in the workspace, 1 not added. Not added because it changed since it was converted.");
    // A refusal erases neither the finalization nor what the check established.
    expect(refusedRow).toContain("One output obtained its final name: sample-2.mzML.");
    expect(refusedRow).toContain("Output-only.");
    await capture("adoption-per-row", LIST);
  });

  it("offers no detail disclosure for a row that has not been attempted", async () => {
    const pending = { ...converted(1), state: "pending", attempts: 0, result: null,
      process: { kind: "notAttempted" }, staged: { kind: "notCreated" }, runIdentity: null,
      adoption: { kind: "nothingToAdopt" } } as ConversionQueueItem;
    await start(terminal([converted(2), pending], 1, 1), [row(1), row(2)]);

    const disclosures = await browser.execute((list: string) =>
      [...document.querySelectorAll(`${list} > li`)].map((node) => node.querySelector("details") !== null), LIST);
    expect(disclosures).toEqual([true, false]);
  });

  it("reaches every judgement by keyboard, announces once, and never scrolls sideways", async () => {
    await start(terminal([failed(1, true), converted(2)], 1, 1), [row(1), row(2)]);

    // Keyboard: the summary is focusable and Enter opens it.
    const summary = `${LIST} > li:nth-child(1) details > summary`;
    await reveal(summary);
    await browser.execute((target: string) => { (document.querySelector(target) as HTMLElement).focus(); }, summary);
    expect(await browser.execute((target: string) => document.activeElement === document.querySelector(target), summary)).toBe(true);
    await browser.keys("Enter");
    expect(await browser.$(`${LIST} > li:nth-child(1) details`).getAttribute("open")).not.toBeNull();

    // The accessible name says which row it is about, so a list of identical
    // "Details" is not a list of unlabelled controls.
    const names = await browser.execute((list: string) =>
      [...document.querySelectorAll(`${list} details > summary`)].map((node) => node.textContent), LIST);
    expect(names.every((name) => (name ?? "").includes("Details for "))).toBe(true);

    // One live region for the adoption result, not two.
    expect(await browser.$$(`${PANEL} [aria-live] .conversion-adoption-summary`).length).toBe(0);
    expect(await browser.$$(`${PANEL} .conversion-adoption-summary[aria-live]`).length).toBe(1);

    // No duplicate ids anywhere on the page.
    const duplicates = await browser.execute(() => {
      const seen = new Map<string, number>();
      for (const node of document.querySelectorAll("[id]")) {
        seen.set(node.id, (seen.get(node.id) ?? 0) + 1);
      }
      return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    });
    expect(duplicates).toEqual([]);

    for (const [width, height] of VIEWPORTS) {
      await viewport(width, height);
      await details(1);
      await details(2);
      // One pixel of tolerance, as every other responsive case here uses: a
      // sub-pixel layout rounds up and is not a sideways-scrolling page.
      expect((await horizontalOverflow()).scrollWidth).toBeLessThanOrEqual(width + 1);
      await capture(`judgements-${width}x${height}`, PANEL);
    }
  });
});
