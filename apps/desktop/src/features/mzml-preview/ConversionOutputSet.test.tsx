import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  outputSetReport,
  queueItem,
  queueOf,
  sciexQueueItem,
  selectedFile,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { SelectedFile } from "./contracts";

/** One SCIEX bundle row, as the roster holds it: the whole acquisition. */
const bundle: SelectedFile = {
  handle: "file-9",
  // The acquisition is named by its primary; the companion is never a row.
  fileName: "Enolase_repeats.wiff",
  // Primary plus companion, because a row that reported only its `.wiff` would
  // understate the acquisition by the part that carries the spectra.
  byteLength: 3_944_804,
  sourceKind: "sciex_wiff",
  relativeContext: null,
};

const thermo: SelectedFile = {
  handle: "file-1",
  fileName: "run-1.raw",
  byteLength: 78_309,
  sourceKind: "thermo_raw",
  relativeContext: null,
};

/** The ten documents the measured acquisition produces. */
const TEN_MEMBERS = Array.from(
  { length: 10 },
  (_, index) => `Enolase_repeats-20070918_en_${String(index + 1).padStart(2, "0")}.mzML`,
);

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** Names the visible copy of a sentence rather than its polite mirror. */
const VISIBLE = { ignore: "[aria-live], script, style" } as const;

describe("the SCIEX WIFF family in the visible workflow", () => {
  it("labels the roster row with the exact family name, accessibly", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
    });
    renderApp(api);

    // The label is part of the accessible row name rather than a visual aside,
    // and it is the exact one: not "SCIEX", not "vendor RAW".
    const row = await screen.findByRole("option", {
      name: /Enolase_repeats\.wiff.*SCIEX WIFF/,
    });
    expect(row).toBeVisible();
    // The companion is not a row of its own, anywhere.
    expect(document.body.textContent).not.toContain(".wiff.scan");
  });

  it("offers conversion for a SCIEX row and plans it as a range, never a filename", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /Enolase_repeats\.wiff/ });

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(/One SCIEX WIFF acquisition will be converted to mzML\./),
      ).toBeVisible();
    });

    // The output column says what will be produced and why it cannot say more.
    // The blank cell this replaces is the defect the whole wire contract exists
    // to make unrepresentable.
    const output = panel.querySelector(".conversion-queue-output");
    expect(output).not.toBeNull();
    expect(output?.textContent ?? "").toContain("1–24 mzML outputs");
    expect(output?.textContent ?? "").toContain("Filenames determined during conversion");
    expect((output?.textContent ?? "").trim()).not.toBe("");

    // And the action takes the row.
    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));
    await waitFor(() => {
      expect(api.conversionRequests).toEqual([{ handles: ["file-9"], conflictPolicy: "fail" }]);
    });
  });

  it("keeps a mixed queue intelligible, in the user's own order", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [thermo, bundle],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /Enolase_repeats\.wiff/ });
    const rows = within(screen.getByRole("listbox", { name: "Workspace" })).getAllByRole("option");
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1], { ctrlKey: true });

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(
          /2 supported vendor acquisitions will be converted to mzML, one after another, in the order below\. 1 Thermo RAW · 1 SCIEX WIFF\./,
        ),
      ).toBeVisible();
    });

    // Each row keeps its own family and its own cardinality, in plan order. A
    // one-to-many row is visually distinct from a one-to-one one because it
    // carries a different element, not because it is coloured differently.
    const kinds = [...panel.querySelectorAll(".conversion-queue-kind")].map(
      (node) => node.textContent,
    );
    expect(kinds).toEqual(["Thermo RAW", "SCIEX WIFF"]);
    const outputs = [...panel.querySelectorAll(".conversion-queue-output")];
    expect(outputs[0]?.textContent).toBe("run-1.mzML");
    expect(outputs[0]?.getAttribute("data-output-topology")).toBeNull();
    expect(outputs[1]?.getAttribute("data-output-topology")).toBe("backendNamedSet");
  });

  it("counts acquisitions while a queue runs, never output members", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [bundle, thermo],
      availability: availableBackend,
      initialConversion: {
        status: "running",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", { state: "running" }),
          queueItem("file-1", "run-1.raw"),
        ]),
      },
    });
    renderApp(api);

    // Two items, not eleven. The set is the first item's *result*, and a
    // progress reading that counted members would tell the user their queue had
    // grown while it ran.
    await waitFor(() => {
      expect(screen.getByText("Converting item 1 of 2…", VISIBLE)).toBeVisible();
    });
  });

  it("renders a ten-output success with a count and the narrow completeness claim", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", {
            state: "finalized",
            attempts: 1,
            result: {
              kind: "outputSet",
              report: outputSetReport("file-9", TEN_MEMBERS),
            },
          }),
        ]),
      },
    });
    renderApp(api);

    const result = await waitFor(() => {
      const node = document.querySelector(".conversion-running");
      if (node === null) {
        throw new Error("expected a queue result on screen");
      }
      return node as HTMLElement;
    });

    // What was produced, counted.
    expect(within(result).getByText("10 mzML outputs finalized.")).toBeVisible();
    // The claim, in the only words the audit supports.
    expect(
      within(result).getByText("Every sample identified by the SCIEX reader produced its output."),
    ).toBeVisible();
    // And the limits, still stated.
    expect(
      screen.getAllByText(
        /Output-only validation\. This does not compare the converted data/,
        VISIBLE,
      ).length,
    ).toBeGreaterThan(0);

    // The two claims this must never make.
    expect(document.body.textContent).not.toMatch(/source samples converted/i);
    expect(document.body.textContent).not.toMatch(/fully verified/i);

    // Which ten, not only how many. A count alone leaves the user unable to
    // tell one of these files from another in the folder they chose.
    for (const member of TEN_MEMBERS) {
      expect(within(result).getByText(member)).toBeVisible();
    }

    // The offer is a count of files, not of items.
    expect(
      screen.getByText("10 converted mzML outputs are ready to add to this workspace.", VISIBLE),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add converted outputs to workspace" }),
    ).toBeEnabled();
  });

  it("adopts ten outputs as ten outcomes of one queue item, and repeats honestly", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", {
            state: "finalized",
            attempts: 1,
            result: {
              kind: "outputSet",
              report: outputSetReport("file-9", TEN_MEMBERS),
            },
          }),
        ]),
      },
    });
    renderApp(api);

    const adopt = await screen.findByRole("button", {
      name: "Add converted outputs to workspace",
    });
    fireEvent.click(adopt);

    await waitFor(() => {
      expect(screen.getByText("10 added, 0 already in the workspace, 0 not added.")).toBeVisible();
    });
    // Ten ordinary mzML rows beside the acquisition, which is still one row.
    await waitFor(() => {
      const rows = within(screen.getByRole("listbox", { name: "Workspace" })).getAllByRole(
        "option",
      );
      expect(rows).toHaveLength(11);
    });
    expect(screen.getAllByRole("option", { name: /SCIEX WIFF/ })).toHaveLength(1);

    // Repeating it reports every member rather than adding one twice.
    fireEvent.click(
      await screen.findByRole("button", { name: "Add converted outputs to workspace" }),
    );
    await waitFor(() => {
      expect(screen.getByText("0 added, 10 already in the workspace, 0 not added.")).toBeVisible();
    });
    await waitFor(() => {
      const rows = within(screen.getByRole("listbox", { name: "Workspace" })).getAllByRole(
        "option",
      );
      expect(rows).toHaveLength(11);
    });

    // Nothing was previewed by any of it.
    expect(screen.queryByRole("region", { name: /Preview/ })).toBeNull();
  });

  it("explains a partial finalization without saying nothing was converted", async () => {
    const partial = outputSetReport("file-9", TEN_MEMBERS.slice(0, 3), {
      groupOutcome: "partially_finalized",
      finalizedCount: 1,
      notPublishedCount: 2,
      memberStates: ["finalized", "validated", "validated"],
      completeness: { kind: "notPosed" },
      partial: { finalizedCount: 1, notPublishedCount: 2, failureKind: "already_exists" },
      completeSetAdoptable: false,
    });
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", {
            state: "failed",
            attempts: 1,
            retryable: false,
            result: { kind: "outputSet", report: partial },
          }),
        ]),
      },
    });
    renderApp(api);

    const result = await waitFor(() => {
      const node = document.querySelector(".conversion-running");
      if (node === null) {
        throw new Error("expected a queue result on screen");
      }
      return node as HTMLElement;
    });

    // The counts, said plainly.
    expect(
      within(result).getByText("1 of 3 mzML outputs finalized; 2 not published."),
    ).toBeVisible();
    // The policy, in the user's terms, and not presented as an ordinary success.
    expect(
      within(result).getAllByText(/the complete output set was not produced/i).length,
    ).toBeGreaterThan(0);
    expect(within(result).getAllByText(/remain in the destination folder/i).length).toBeGreaterThan(
      0,
    );
    expect(
      within(result).getAllByText(/added individually later with Add files/i).length,
    ).toBeGreaterThan(0);
    // Not labelled Converted, and not offered a retry.
    expect(within(result).queryByText("Converted")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();

    // The sentence this must never produce, and the one it must.
    expect(document.body.textContent).not.toContain(
      "Nothing was converted, so there is nothing to add to the workspace.",
    );
    expect(
      screen.getByText("No complete output set is available to add to this workspace.", VISIBLE),
    ).toBeVisible();
    // The warning is carried by a note, not by colour alone.
    expect(result.querySelector(".conversion-queue-set-partial")?.getAttribute("role")).toBe(
      "note",
    );

    // The finalized prefix is named. The copy above tells the user to add these
    // files individually, which is not something anyone can act on without
    // their names -- and the members that were *not* published must not be
    // listed, because they are not in the folder.
    expect(within(result).getByText(TEN_MEMBERS[0])).toBeVisible();
    expect(within(result).queryByText(TEN_MEMBERS[1])).toBeNull();
    expect(within(result).queryByText(TEN_MEMBERS[2])).toBeNull();
  });

  it("keeps other complete items in the same queue adoptable", async () => {
    const partial = outputSetReport("file-9", TEN_MEMBERS.slice(0, 3), {
      groupOutcome: "partially_finalized",
      finalizedCount: 1,
      notPublishedCount: 2,
      memberStates: ["finalized", "validated", "validated"],
      completeness: { kind: "notPosed" },
      partial: { finalizedCount: 1, notPublishedCount: 2, failureKind: "already_exists" },
      completeSetAdoptable: false,
    });
    const api = createFakePreviewApi({
      initialDatasets: [bundle, thermo],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", {
            state: "failed",
            attempts: 1,
            retryable: false,
            result: { kind: "outputSet", report: partial },
          }),
          queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1 }),
        ]),
      },
    });
    renderApp(api);

    // One complete item, one incomplete acquisition: the offer is for the one
    // that is complete, and it is exactly one file.
    await waitFor(() => {
      expect(
        screen.getByText("1 converted mzML output is ready to add to this workspace.", VISIBLE),
      ).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "Add converted output to workspace" })).toBeEnabled();
    // And the partial acquisition is still explained beside it.
    expect(screen.getAllByText(/the complete output set was not produced/i).length).toBeGreaterThan(
      0,
    );
  });

  it("claims no validation for a set that never judged an output", async () => {
    // Refused before its outputs were discovered: a report exists, and nothing
    // in it was ever validated. "Produced a report" is not the same question as
    // "judged an output", and only the second licenses the disclosure.
    const refused = outputSetReport("file-9", [], {
      groupOutcome: "refused_before_publication",
      detailedOutcome: "multi_output_backend_failed",
      memberCount: 0,
      finalizedCount: 0,
      validatedNotPublishedCount: 0,
      notPublishedCount: 0,
      memberStates: [],
      completeness: { kind: "notPosed" },
      completeSetAdoptable: false,
    });
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", {
            state: "failed",
            attempts: 1,
            result: { kind: "outputSet", report: refused },
          }),
        ]),
      },
    });
    renderApp(api);
    const result = await waitFor(() => {
      const node = document.querySelector(".conversion-running");
      if (node === null) {
        throw new Error("expected a queue result on screen");
      }
      return node as HTMLElement;
    });

    // Scoped to the result. The *plan* below still states the disclosure, and
    // should: a user deciding whether to convert is entitled to know what will
    // be checked before they choose a folder. What must not happen is a
    // finished queue claiming a check nobody ran.
    expect(result.textContent ?? "").not.toContain("Output-only validation.");
  });

  it("says a skipped output set stepped aside from all its names, not one", async () => {
    // The multi-output lifecycle reaches this state only when every discovered
    // destination name is occupied, and the item has no singular name for the
    // shared sentence to be about.
    const skipped = outputSetReport("file-9", [], {
      groupOutcome: "skipped_existing_destinations",
      memberCount: 0,
      finalizedCount: 0,
      validatedNotPublishedCount: 0,
      notPublishedCount: 0,
      memberStates: [],
      completeness: { kind: "notPosed" },
      completeSetAdoptable: false,
    });
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", {
            state: "skipped",
            attempts: 1,
            result: { kind: "outputSet", report: skipped },
          }),
        ]),
      },
    });
    renderApp(api);
    const result = await waitFor(() => {
      const node = document.querySelector(".conversion-running");
      if (node === null) {
        throw new Error("expected a queue result on screen");
      }
      return node as HTMLElement;
    });

    expect(result.querySelector(".conversion-queue-status")?.textContent).toBe(
      "Skipped — files of all its output names were already there",
    );
    expect(document.body.textContent ?? "").not.toContain(
      "Skipped — a file of that name was already there",
    );
  });

  it("tells apart the set refusals that need different things from the user", async () => {
    // Three refusals with three different recoveries. One sentence for all of
    // them would tell the user to do nothing in particular.
    const cases = [
      {
        detail: "multi_output_destination_occupied",
        says: /already in that folder/i,
      },
      {
        detail: "multi_output_provider_build_not_evidenced",
        says: /no conversion evidence for this acquisition format/i,
      },
      {
        detail: "source_sample_failure_observed",
        says: /reported a problem with at least one sample/i,
      },
    ];

    for (const { detail, says } of cases) {
      const report = outputSetReport("file-9", [], {
        groupOutcome: "refused_before_publication",
        detailedOutcome: detail,
        memberCount: 0,
        finalizedCount: 0,
        validatedNotPublishedCount: 0,
        notPublishedCount: 0,
        memberStates: [],
        completeness: { kind: "notPosed" },
        completeSetAdoptable: false,
      });
      const api = createFakePreviewApi({
        initialDatasets: [bundle],
        availability: availableBackend,
        initialConversion: {
          status: "terminal",
          reason: "completed",
          operationId: "1",
          queue: queueOf([
            sciexQueueItem("file-9", "Enolase_repeats.wiff", {
              state: "failed",
              attempts: 1,
              result: { kind: "outputSet", report },
            }),
          ]),
        },
      });
      const view = render(
        <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
          <PreviewApiProvider value={api}>
            <App />
          </PreviewApiProvider>
        </WorkspaceDropTransportProvider>,
      );
      const reason = await waitFor(() => {
        const node = document.querySelector(".conversion-queue-reason");
        if (node === null) {
          throw new Error("expected a failure sentence on screen");
        }
        return node as HTMLElement;
      });
      expect(reason.textContent ?? "").toMatch(says);
      // And never the sentence that says only that something went wrong.
      expect(reason.textContent ?? "").not.toContain(
        "The conversion did not finish, so no output set was published.",
      );
      view.unmount();
    }
  });

  it("falls back honestly for a set refusal this build has no sentence for", async () => {
    const report = outputSetReport("file-9", [], {
      groupOutcome: "refused_before_publication",
      // A real identifier, deliberately one with no distinct recovery.
      detailedOutcome: "multi_output_staging_not_created",
      memberCount: 0,
      finalizedCount: 0,
      validatedNotPublishedCount: 0,
      notPublishedCount: 0,
      memberStates: [],
      completeness: { kind: "notPosed" },
      completeSetAdoptable: false,
    });
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", "Enolase_repeats.wiff", {
            state: "failed",
            attempts: 1,
            result: { kind: "outputSet", report },
          }),
        ]),
      },
    });
    renderApp(api);
    const reason = await waitFor(() => {
      const node = document.querySelector(".conversion-queue-reason");
      if (node === null) {
        throw new Error("expected a failure sentence on screen");
      }
      return node as HTMLElement;
    });

    // Honest rather than specific. Inventing prose for an identifier this build
    // has no sentence for would be inventing a diagnosis.
    expect(reason.textContent).toBe(
      "The conversion did not finish, so no output set was published.",
    );
  });

  it("says nothing about SCIEX in the folder or drop copy", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    // The walking surfaces are mzML-only and their copy must not imply
    // otherwise -- for this family or for any other.
    const folder = screen.getByRole("button", { name: "Add mzML folder…" });
    expect(folder.textContent ?? "").not.toMatch(/wiff|sciex/i);
    // The folder action still names exactly one format, and the drop copy
    // beside it still names exactly one format.
    expect(folder.textContent).toContain("mzML");
    const shell = document.body.textContent ?? "";
    expect(shell).not.toMatch(/wiff/i);
    expect(shell).not.toMatch(/sciex/i);
  });
});
