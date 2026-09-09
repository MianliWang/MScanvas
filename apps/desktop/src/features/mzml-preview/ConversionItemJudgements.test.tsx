import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  failedAttemptFacts,
  finalizedAttemptFacts,
  outputSetReport,
  queueItem,
  queueOf,
  sciexQueueItem,
  setMembers,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { ConversionQueueItem, ConversionReport, SelectedFile } from "./contracts";

/**
 * The five judgements on screen, per item.
 *
 * What is asserted here is what a reader can actually tell apart. The row's own
 * label is a projection and is lossy on purpose; these tests are about the
 * distinctions underneath it staying inspectable, and about the pairs that used
 * to render identically.
 *
 * The environment is jsdom. Nothing here measures a pixel; what it asserts is
 * the production structure, the exact user-visible copy, which controls are
 * offered, and that opening a disclosure launches nothing.
 */

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

/** One SCIEX bundle row, as the roster holds it: the whole acquisition. */
const bundle: SelectedFile = {
  handle: "file-9",
  fileName: "Enolase_repeats.wiff",
  byteLength: 3_944_804,
  sourceKind: "sciex_wiff",
  relativeContext: null,
};

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** A failed item whose converter exited non-zero, with or without staged bytes. */
function failed(handle: string, name: string, stagedSomething: boolean): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "failed",
    attempts: 1,
    retryable: false,
    result: {
      kind: "single" as const,
      report: {
        datasetHandle: handle,
        sourceKind: "thermo_raw",
        outcome: "backend_rejected",
        detailedOutcome: "backend_rejected",
        outputFileName: null,
        output: null,
        validation: null,
        backend: { exitCode: 3, elapsedMilliseconds: 412 },
        stagingResidue: null,
        receipt: 1,
      },
    },
    ...failedAttemptFacts(stagedSomething, `000000000000000100000000000000${stagedSomething ? "1a" : "1b"}`),
  });
}

/** A finalized item that published one output. */
function converted(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "finalized",
    attempts: 1,
    result: {
      kind: "single" as const,
      report: {
        datasetHandle: handle,
        sourceKind: "thermo_raw",
        outcome: "finalized",
        detailedOutcome: null,
        outputFileName: name.replace(".raw", ".mzML"),
        output: {
          byteLength: 28_655,
          sha256: "6CE2ACE65485488F4A337EE17B71559E737C1944B641F279744932C3C3D8648C",
          spectrumCount: 12,
          chromatogramCount: 3,
        },
        validation: {
          // Output-only, which is what every family the visible queue accepts
          // is judged under, and which records no advisory observations. The
          // advisory rendering is exercised separately, against the mode that
          // does produce them.
          mode: "output_only",
          fullyVerified: false,
          verified: ["output_is_well_formed_mzml"],
          unverified: [],
          inapplicable: ["source_spectrum_count_preserved"],
          advisory: [],
        },
        backend: { exitCode: 0, elapsedMilliseconds: 568 },
        stagingResidue: null,
        receipt: 1,
      },
    },
    ...finalizedAttemptFacts(),
  });
}

function terminalApi(items: readonly ConversionQueueItem[], datasets: readonly SelectedFile[]) {
  return createFakePreviewApi({
    initialDatasets: [...datasets],
    availability: availableBackend,
    initialConversion: {
      status: "terminal",
      reason: "completed",
      operationId: "1",
      queue: queueOf(items),
    },
  });
}

/** The panel's rendered queue block. */
async function queueResult(): Promise<HTMLElement> {
  await screen.findByRole("region", { name: "Convert" });
  // Waited for rather than read once. The panel renders the region before the
  // queue read it dispatched has been answered, so a synchronous query here is
  // a race that only loses under load.
  return waitFor(() => {
    const node = document.querySelector(".conversion-running");
    if (node === null) {
      throw new Error("expected a queue result on screen");
    }
    return node as HTMLElement;
  });
}

/** The `<li>` a named row is rendered as. */
function rowFor(result: HTMLElement, fileName: string): HTMLElement {
  const row = within(result)
    .getByText(fileName, { selector: ".conversion-queue-name" })
    .closest("li");
  if (row === null) {
    throw new Error(`no queue row for ${fileName}`);
  }
  return row;
}

/** Opens the numbered row's disclosure and returns its text. */
async function details(index: number): Promise<string> {
  const result = await queueResult();
  const row = within(result).getAllByRole("listitem")[index - 1];
  if (row === undefined) {
    throw new Error(`no queue row ${String(index)}`);
  }
  return openDetails(row).textContent ?? "";
}

/** Opens a row's detail disclosure the way a user does. */
function openDetails(row: HTMLElement): HTMLElement {
  const summary = within(row).getByText(/^Details for /).closest("summary");
  if (summary === null) {
    throw new Error("the row has no detail disclosure");
  }
  fireEvent.click(summary);
  const details = summary.closest("details");
  if (details === null) {
    throw new Error("the summary has no disclosure");
  }
  return details;
}

describe("the five judgements of one queue item", () => {
  it("tells a failure that staged something from one that staged nothing", async () => {
    const api = terminalApi(
      [failed("file-1", "run-1.raw", true), failed("file-2", "run-2.raw", false)],
      [acquisition(1), acquisition(2)],
    );
    renderApp(api);
    const result = await queueResult();

    // Both rows read the same on every other judgement: the same state label,
    // the same failure sentence, and no residue on either.
    const rows = within(result).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveTextContent("Failed");
      expect(row).not.toHaveTextContent(
        "MSCanvas could not remove its own temporary folder afterwards.",
      );
    }

    const withContent = openDetails(rowFor(result, "run-1.raw"));
    const withoutContent = openDetails(rowFor(result, "run-2.raw"));

    // The process judgement is identical.
    const process = (details: HTMLElement) =>
      within(details).getByText(/^The converter ran to its own end, exit code 3\.$/);
    expect(process(withContent)).toBeVisible();
    expect(process(withoutContent)).toBeVisible();

    // And the staged judgement is not.
    expect(
      within(withContent).getByText(
        "The temporary working folder held 1 entry when the converter finished, at least one of them a file with content.",
      ),
    ).toBeVisible();
    expect(
      within(withoutContent).getByText(
        "The temporary working folder was empty when the converter finished.",
      ),
    ).toBeVisible();

    // Neither claims an output, and neither claims a check.
    for (const details of [withContent, withoutContent]) {
      expect(within(details).getByText("No output obtained a final name.")).toBeVisible();
      expect(
        within(details).getByText("Nothing was checked, because nothing was validated."),
      ).toBeVisible();
    }
  });

  it("names advisory observations apart from the three dispositions", async () => {
    // A source comparison is the only judgement that records an advisory, and
    // no family the visible queue accepts is read under one today — so this
    // pins the rendering against the shape the wire permits and the mode that
    // produces it, rather than against a pairing Rust cannot emit.
    const compared = queueItem("file-1", "run-1.raw", {
      ...converted("file-1", "run-1.raw"),
      result: {
        kind: "single" as const,
        report: {
          ...(converted("file-1", "run-1.raw").result as { kind: "single"; report: ConversionReport })
            .report,
          validation: {
            mode: "source_comparison" as const,
            fullyVerified: false,
            verified: ["output_is_well_formed_mzml"],
            unverified: ["source_spectrum_count_preserved"],
            inapplicable: [],
            advisory: ["byte_length_differs", "root_wrapper_differs"],
          },
        },
      },
    });
    const api = terminalApi([compared], [acquisition(1)]);
    renderApp(api);
    const result = await queueResult();

    const details = openDetails(rowFor(result, "run-1.raw"));
    const integrity = details.querySelector('[data-testid="conversion-item-0-integrity"]');
    expect((integrity as HTMLElement).textContent).toBe(
      "Compared against the source document. 1 checked, 1 not established, 0 not applicable. " +
        "2 kinds of advisory observation, which fail nothing: byte_length_differs, root_wrapper_differs.",
    );
    // Advisories are named apart and are never counted as unestablished.
    expect((integrity as HTMLElement).textContent).not.toContain("2 not established");
  });

  it("says a staging area was unreadable rather than empty", async () => {
    const unknown = queueItem("file-1", "run-1.raw", {
      state: "failed",
      attempts: 1,
      process: { kind: "settled", termination: "exited", exitCode: 3 },
      staged: { kind: "unobserved", phase: "backend_settled" },
      runIdentity: "000000000000000100000000000000ff",
    });
    const api = terminalApi([unknown], [acquisition(1)]);
    renderApp(api);
    const result = await queueResult();

    const details = openDetails(rowFor(result, "run-1.raw"));
    expect(
      within(details).getByText(
        "MSCanvas could not read its temporary working folder when the converter finished, so what it held is unknown.",
      ),
    ).toBeVisible();
    // The two sentences it must not produce.
    expect(details.textContent).not.toContain("was empty");
    expect(details.textContent).not.toContain("No temporary working folder was created");
  });

  it("keeps output-only validation output-only", async () => {
    const api = terminalApi([converted("file-1", "run-1.raw")], [acquisition(1)]);
    renderApp(api);
    const result = await queueResult();

    const details = openDetails(rowFor(result, "run-1.raw"));
    const integrity = details.querySelector('[data-testid="conversion-item-0-integrity"]');
    expect(integrity).not.toBeNull();
    expect((integrity as HTMLElement).textContent).toBe(
      "Output-only. The converted data was not compared against a readable vendor-source model. " +
        "1 checked, 0 not established, 1 not applicable.",
    );
    // No advisory sentence, because an output-only judgement records none.
    expect(details.querySelector(".conversion-item-advisories")).toBeNull();
    // The claim this surface may never make.
    expect(details.textContent).not.toMatch(/fully verified/i);
    expect(details.textContent).not.toMatch(/lossless/i);
    // Publication is stated as publication, not as an observation of an empty
    // directory.
    expect(
      within(details).getByText(
        "What was written to the temporary working folder took its final name.",
      ),
    ).toBeVisible();
    // And the manifest carries the facts that sit beside the five.
    const manifest = details.querySelector(".conversion-item-manifest");
    expect(manifest).not.toBeNull();
    expect(within(manifest as HTMLElement).getByText("run-1.mzML")).toBeVisible();
    expect(
      within(manifest as HTMLElement).getByText(
        "6CE2ACE65485488F4A337EE17B71559E737C1944B641F279744932C3C3D8648C",
      ),
    ).toBeVisible();
  });

  it("counts a partial set against what it produced, never against the bound", async () => {
    const members = ["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"];
    const partial = outputSetReport("file-9", members, {
      groupOutcome: "partially_finalized",
      finalizedCount: 1,
      notPublishedCount: 2,
      members: setMembers(members, [
        "finalized",
        "validated_not_published",
        "validated_not_published",
      ]),
      completeness: { kind: "notPosed" },
      partial: { finalizedCount: 1, notPublishedCount: 2, failureKind: "already_exists" },
      completeSetAdoptable: false,
    });
    const api = terminalApi(
      [
        sciexQueueItem("file-9", "Enolase_repeats.wiff", {
          state: "failed",
          attempts: 1,
          retryable: false,
          result: { kind: "outputSet", report: partial },
          ...failedAttemptFacts(true, "000000000000000100000000000000c1"),
        }),
      ],
      [bundle],
    );
    renderApp(api);
    const result = await queueResult();

    const details = openDetails(rowFor(result, "Enolase_repeats.wiff"));
    // The denominator is the population that was actually produced. The
    // lifecycle's maximum bound is neither the number expected nor the number
    // produced, so it never appears here.
    expect(
      within(details).getByText(/1 of 3 discovered output files obtained a final name\./),
    ).toBeVisible();
    expect(details.textContent).not.toContain("of 24");
    // What landed and what did not, without collapsing either way.
    const manifest = details.querySelector(".conversion-item-manifest");
    expect(manifest).not.toBeNull();
    expect(within(manifest as HTMLElement).getAllByText("Not published")).toHaveLength(2);
    expect(within(manifest as HTMLElement).getAllByText("Finalized")).toHaveLength(1);
    // An incomplete set keeps the existing adoption refusal.
    expect(
      screen.getByText("No complete output set is available to add to this workspace."),
    ).toBeVisible();
  });

  it("names a row that never reached a converter as one, and never as a run", async () => {
    const api = terminalApi(
      [
        queueItem("file-1", "run-1.raw", {
          state: "skippedByRequest",
          attempts: 0,
        }),
      ],
      [acquisition(1)],
    );
    renderApp(api);
    const result = await queueResult();

    const details = openDetails(rowFor(result, "run-1.raw"));
    expect(within(details).getByText("No converter was started for this item.")).toBeVisible();
    expect(
      within(details).getByText(
        "No converter was given a temporary working folder, so nothing could have been written there.",
      ),
    ).toBeVisible();
    expect(
      within(details).getByText("No converter run: none was started for this item."),
    ).toBeVisible();
    expect(
      within(details).getByText("This item produced nothing that could be added to the workspace."),
    ).toBeVisible();
  });

  it("says what an adoption did, and that it is not current membership", async () => {
    const api = terminalApi(
      [
        queueItem("file-1", "run-1.raw", {
          ...converted("file-1", "run-1.raw"),
          adoption: {
            kind: "settled",
            added: 1,
            alreadyInWorkspace: 0,
            refused: 0,
            refusals: [],
          },
        }),
        queueItem("file-2", "run-2.raw", {
          ...converted("file-2", "run-2.raw"),
          adoption: {
            kind: "settled",
            added: 0,
            alreadyInWorkspace: 0,
            refused: 1,
            refusals: ["output_changed"],
          },
        }),
      ],
      [acquisition(1), acquisition(2)],
    );
    renderApp(api);
    const result = await queueResult();

    const added = openDetails(rowFor(result, "run-1.raw"));
    expect(
      within(added).getByText(
        "When outputs were last added: 1 added, 0 already in the workspace, 0 not added.",
      ),
    ).toBeVisible();
    const refused = openDetails(rowFor(result, "run-2.raw"));
    expect(
      within(refused).getByText(
        "When outputs were last added: 0 added, 0 already in the workspace, 1 not added. Not added because it changed since it was converted.",
      ),
    ).toBeVisible();
    // A refusal erases neither the finalization nor what the check established.
    expect(
      within(refused).getByText("One output obtained its final name: run-2.mzML."),
    ).toBeVisible();
    const stillJudged = refused.querySelector('[data-testid="conversion-item-1-integrity"]');
    expect((stillJudged as HTMLElement).textContent).toMatch(/^Output-only\./);
  });

  it("shows what an adoption did without waiting for anything else to happen", async () => {
    // Rust records the fifth judgement on the queue, and the adoption's reply
    // carries the roster rather than the queue. A terminal queue is not polled,
    // so a document that did not re-read it would go on saying nobody had asked
    // for the rest of the session while Rust held the answer. Caught on a real
    // native run before it was pinned here.
    const api = terminalApi([converted("file-1", "run-1.raw")], [acquisition(1)]);
    renderApp(api);
    const result = await queueResult();

    expect(await details(1)).toContain("Not added yet.");
    fireEvent.click(
      screen.getByRole("button", { name: "Add converted output to workspace" }),
    );

    await waitFor(() => {
      expect(rowFor(result, "run-1.raw").textContent).toContain(
        "When outputs were last added: 1 added, 0 already in the workspace, 0 not added.",
      );
    });
  });

  it("keeps an open disclosure open across an adoption, and loses no focus", async () => {
    const api = terminalApi(
      [converted("file-1", "run-1.raw"), converted("file-2", "run-2.raw")],
      [acquisition(1), acquisition(2)],
    );
    renderApp(api);
    const result = await queueResult();

    const row = rowFor(result, "run-1.raw");
    const summary = within(row).getByText(/^Details for run-1\.raw$/).closest("summary");
    expect(summary).not.toBeNull();
    (summary as HTMLElement).focus();
    fireEvent.click(summary as HTMLElement);
    const details = (summary as HTMLElement).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);

    // An adoption, which replaces the queue transfer object and re-renders
    // every row. The rows are keyed by their handles, so the disclosure is the
    // same element rather than a new one — which is what keeps it open.
    const adopt = screen.getByRole("button", {
      name: "Add converted outputs to workspace",
    });
    adopt.focus();
    fireEvent.click(adopt);
    // The panel's own summary, not any row's: every row now carries a sentence
    // containing "added", so a page-wide text query would match several.
    await waitFor(() => {
      expect(
        document.querySelector(".conversion-adoption-summary")?.textContent ?? "",
      ).toContain("added,");
    });

    expect(details.open).toBe(true);
    // The control the user activated is still on screen and still focused: it
    // is disabled while the work is in flight rather than removed, so focus
    // never falls to the document.
    expect(document.activeElement).toBe(adopt);
    expect(document.body.contains(adopt)).toBe(true);
  });

  it("gives every row's disclosure its own identifiers", async () => {
    const api = terminalApi(
      [failed("file-1", "run-1.raw", true), failed("file-2", "run-2.raw", false)],
      [acquisition(1), acquisition(2)],
    );
    renderApp(api);
    await queueResult();

    // Two rows, two disclosures, and no id shared between them. A static id
    // inside a list is a duplicate the moment the list holds two.
    const ids = Array.from(document.querySelectorAll("[data-testid]"))
      .map((node) => node.getAttribute("data-testid") ?? "")
      .filter((id) => id.startsWith("conversion-item-"));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
