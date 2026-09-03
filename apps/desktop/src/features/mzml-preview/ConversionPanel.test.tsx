import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  unavailableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  queueItem,
  queueOf,
  SHIPPED_INTENT,
  selectedFile,
  shimadzuDataset,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { SelectedFile } from "./contracts";

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const first = acquisition(1);
const second = acquisition(2);

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** The roster's own list, so the sort control's options are not mistaken for rows. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("listbox", { name: "Workspace" })).queryAllByRole("option");
}

/** The queue's own result block, as distinct from the plan beneath it. */
function queueResult(): HTMLElement {
  const result = document.querySelector(".conversion-running");
  if (result === null) {
    throw new Error("expected a queue result on screen");
  }
  return result as HTMLElement;
}

function liveRegion(): string {
  return document.querySelector("[data-live-region='conversion']")?.textContent ?? "";
}

/** Names the visible copy of a sentence rather than its polite mirror. */
const VISIBLE = { ignore: "[aria-live], script, style" } as const;

/** Selects every roster row, as a user working through the list would. */
function selectAllRows(): void {
  const list = rows();
  fireEvent.click(list[0]);
  for (const row of list.slice(1)) {
    fireEvent.click(row, { ctrlKey: true });
  }
}

describe("the Shimadzu LabSolutions LCD family in the visible workflow", () => {
  const lcdRow = shimadzuDataset(7);

  it("labels the roster row with the exact family name, accessibly", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [lcdRow],
      availability: availableBackend,
    });
    renderApp(api);
    // The label is part of the accessible row name, not a visual aside: a
    // reader hears which family the row is.
    const row = await screen.findByRole("option", {
      name: /sample-7\.lcd.*Shimadzu LabSolutions LCD/,
    });
    expect(row).toBeVisible();
  });

  it("plans one Shimadzu row with exact-family copy and a family label on the row", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [lcdRow],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /sample-7\.lcd/ });

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(
          /One Shimadzu LabSolutions LCD acquisition will be converted to mzML\./,
        ),
      ).toBeVisible();
    });
    // The plan row itself says the family and the output name.
    expect(within(panel).getByText("sample-7.mzML")).toBeVisible();
    expect(within(panel).getAllByText("Shimadzu LabSolutions LCD").length).toBeGreaterThan(0);

    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));
    await waitFor(() => {
      expect(api.conversionRequests).toEqual([{ handles: ["file-7"], conflictPolicy: "fail", intentId: SHIPPED_INTENT.id }]);
    });
  });

  it("describes a mixed queue by count and by exact per-family counts", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, lcdRow, second],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-2\.raw/ });
    selectAllRows();

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(
          /3 supported vendor acquisitions will be converted to mzML, one after another, in the order below\. 2 Thermo RAW · 1 Shimadzu LabSolutions LCD\./,
        ),
      ).toBeVisible();
    });
    // Each plan row still names its own family, in the visible order.
    const orderedKinds = [...panel.querySelectorAll(".conversion-queue-kind")].map(
      (node) => node.textContent,
    );
    expect(orderedKinds).toEqual(["Thermo RAW", "Shimadzu LabSolutions LCD", "Thermo RAW"]);
    // The excluded rows are the mzML ones, and only those: nothing describes
    // the Shimadzu row as excluded.
    expect(within(panel).queryByText(/not part of this conversion/)).toBeNull();
  });

  it("mounts no Convert panel for an mzML-only workspace, and no family-specific invitation", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    // The panel is not a fixture: with nothing convertible and nothing to
    // report it stays unmounted, and no sentence anywhere invites the user to
    // pick a "Thermo RAW row" -- the empty state, where it does render, is
    // family-neutral.
    expect(screen.queryByRole("region", { name: "Convert" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Thermo RAW row/);
  });

  it("renders a chromatogram-only result as a success with those exact facts", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [lcdRow],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-7", "sample-7.lcd", {
            sourceKind: "shimadzu_lcd",
            output: { kind: "knownSingle", fileName: "sample-7.mzML" },
            state: "finalized",
            attempts: 1,
            result: {
              kind: "single" as const,
              report: {
                datasetHandle: "file-7",
                sourceKind: "shimadzu_lcd",
                outcome: "finalized",
                detailedOutcome: null,
                outputFileName: "sample-7.mzML",
                output: {
                  byteLength: 481_997,
                  sha256: "9CE497643AE025DD1834E8AAFC8F69DFB38D68381C842B4B15E86047968E34CA",
                  spectrumCount: 0,
                  chromatogramCount: 144,
                },
                validation: {
                  mode: "output_only",
                  fullyVerified: false,
                  verified: ["source_unchanged"],
                  unverified: [],
                  inapplicable: ["spectrum_count"],
                },
                backend: { exitCode: 0, elapsedMilliseconds: 592 },
                stagingResidue: null,
                installationGeneration: 0,
              },
            },
          }),
        ]),
      },
    });
    renderApp(api);
    await screen.findByRole("option", { name: /sample-7\.lcd/ });

    // A success, in the queue's own terms, with the exact measured facts --
    // never "empty", "failed" or "no data".
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("1 converted, 0 skipped, 0 failed of 1.")).toBeVisible();
    });
    expect(within(panel).getByText(/0 spectra, 144 chromatograms/)).toBeVisible();
    expect(panel.textContent).not.toMatch(/no data|invalid|empty/i);
  });
});

describe("queueing selected Thermo RAW conversions", () => {
  it("keeps one focused row a queue of one, with the action it always had", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-1\.raw/ });

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(/One Thermo RAW acquisition will be converted/),
      ).toBeVisible();
    });

    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));
    await waitFor(() => {
      expect(api.conversionRequests).toEqual([{ handles: ["file-1"], conflictPolicy: "fail", intentId: SHIPPED_INTENT.id }]);
    });
  });

  it("calls one selected row selected, because that is what it is", async () => {
    // A queue of one built from a selection is not the focused row's
    // conversion, even though it is the same size. Labelling it `Convert
    // focused…` would name a row the action need not be acting on: the user can
    // select one row and focus another.
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-2\.raw/ });

    // Select the second row, which also focuses it; then move focus to the
    // first with the keyboard, which leaves the selection where it was.
    fireEvent.click(rows()[1]);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Workspace" }), { key: "ArrowUp" });

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Convert 1 selected…" })).toBeVisible();
    });
    expect(within(panel).queryByRole("button", { name: "Convert focused…" })).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Convert 1 selected…" }));
    await waitFor(() => {
      expect(api.conversionRequests).toEqual([{ handles: ["file-2"], conflictPolicy: "fail", intentId: SHIPPED_INTENT.id }]);
    });
  });

  it("queues several selected rows and says what it excluded", async () => {
    const api = createFakePreviewApi({
      // An mzML row between two Thermo rows, so exclusion is not merely the
      // last item being dropped.
      initialDatasets: [first, selectedFile, second],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-2\.raw/ });
    selectAllRows();

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(/2 Thermo RAW acquisitions will be converted to mzML/),
      ).toBeVisible();
    });
    // Counted out loud rather than silently dropped.
    expect(
      within(panel).getByText(/1 selected row is already mzML and is not part of this conversion/),
    ).toBeVisible();

    fireEvent.click(within(panel).getByRole("button", { name: "Convert 2 selected…" }));
    await waitFor(() => {
      expect(api.conversionRequests).toEqual([
        { handles: ["file-1", "file-2"], conflictPolicy: "fail", intentId: SHIPPED_INTENT.id },
      ]);
    });
  });

  it("submits the visible order after a sort, not the order rows were added", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-2\.raw/ });

    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-desc" },
    });
    selectAllRows();
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Convert 2 selected…" })).toBeEnabled();
    });

    fireEvent.click(within(panel).getByRole("button", { name: "Convert 2 selected…" }));
    await waitFor(() => {
      expect(api.conversionRequests).toEqual([
        { handles: ["file-2", "file-1"], conflictPolicy: "fail", intentId: SHIPPED_INTENT.id },
      ]);
    });
  });

  it("shows item-count progress while a queue runs, and one way to stop it", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      conversion: (_request, publish) =>
        new Promise(() => {
          publish({
            status: "running",
            operationId: "1",
            queue: {
              ...queueOf([
                queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1 }),
                queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 }),
              ]),
              currentIndex: 1,
            },
          });
        }),
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-2\.raw/ });
    selectAllRows();
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Convert 2 selected…" })).toBeEnabled();
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Convert 2 selected…" }));

    await waitFor(() => {
      expect(within(panel).getByText("Converting item 2 of 2…")).toBeVisible();
    });
    // The action, and the two sentences it is described by. `Cancel` is
    // deliberately not its name: it ends the whole queue and undoes nothing
    // already written.
    const stop = within(panel).getByRole("button", { name: "Stop queue" });
    expect(stop).toBeEnabled();
    expect(
      within(panel).getByText(
        "Stops the current conversion and prevents remaining items from starting. Outputs already completed stay in place.",
      ),
    ).toBeVisible();
    expect(stop).toHaveAccessibleDescription(
      "Stops the current conversion and prevents remaining items from starting. Outputs already completed stay in place.",
    );
    expect(within(panel).queryByRole("button", { name: /cancel/i })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /resume/i })).toBeNull();
    // No fractional progress anywhere: nothing measures one.
    expect(within(panel).queryByRole("progressbar")).toBeNull();
    expect(panel.textContent ?? "").not.toMatch(/\d+\s?%/);
    await waitFor(() => {
      expect(liveRegion()).toContain("Converting item 2 of 2, run-2.raw");
    });
  });

  it("keeps an earlier failure from stopping a later item, and reports both", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
      reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", {
            state: "failed",
            attempts: 1,
            retryable: false,
            result: {
              kind: "single" as const,
              report: {
                datasetHandle: "file-1",
                sourceKind: "thermo_raw",
                outcome: "output_rejected",
                detailedOutcome: "output_contains_no_records",
                outputFileName: null,
                output: null,
                validation: null,
                backend: { exitCode: 0, elapsedMilliseconds: 90 },
                stagingResidue: null,
                installationGeneration: 0,
              },
            },
          }),
          queueItem("file-2", "run-2.raw", { state: "finalized", attempts: 1 }),
        ]),
      },
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("1 converted, 0 skipped, 1 failed of 2.")).toBeVisible();
    });
    // The later item still ran, and is still reported as converted.
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Failed");
    expect(items[1]).toHaveTextContent("Converted");
    expect(
      within(panel).getByText(
        "The converted file did not pass MSCanvas' integrity checks, so it was discarded.",
      ),
    ).toBeVisible();
    // Nothing retryable, so nothing is offered, and the panel says why.
    expect(within(panel).queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(within(panel).getByText(/would not change on another attempt/)).toBeVisible();
  });

  it("offers retry only for failures another attempt could change, and states its scope", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
      reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1 }),
          queueItem("file-2", "run-2.raw", {
            state: "failed",
            attempts: 1,
            retryable: true,
            error: {
              kind: "source_in_use",
              summary: "Another program is using that file, so MSCanvas did not read it.",
              detail: null,
              retryable: true,
            },
          }),
        ]),
      },
      retry: () =>
        Promise.resolve({
          status: "terminal",
      reason: "completed" as const,
          operationId: "1",
          queue: {
            ...queueOf([
              queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1 }),
              queueItem("file-2", "run-2.raw", { state: "finalized", attempts: 2 }),
            ]),
            retryRound: 1,
          },
        }),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    const retry = await within(panel).findByRole("button", { name: "Retry 1 failed" });
    expect(retry).toHaveAccessibleDescription(
      /Reruns only the failures another attempt could change, using the same folder/,
    );

    fireEvent.click(retry);
    await waitFor(() => {
      expect(within(panel).getByText("2 converted, 0 skipped, 0 failed of 2.")).toBeVisible();
    });
    // The successful item was not rerun; the retried one counted its attempt.
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).not.toHaveTextContent("attempt");
    expect(items[1]).toHaveTextContent("attempt 2");
  });

  it("says what each converted file actually is, not only that it converted", async () => {
    // The single-file panel reported size and record counts, and a queue that
    // said only `Converted` would take away the one thing that separates a real
    // conversion from an empty file with the right name.
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
      reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", {
            state: "finalized",
            attempts: 1,
            result: {
              kind: "single" as const,
              report: {
                datasetHandle: "file-1",
                sourceKind: "thermo_raw",
                outcome: "finalized",
                detailedOutcome: null,
                outputFileName: "run-1.mzML",
                output: {
                  byteLength: 28_655,
                  sha256: "6CE2ACE6",
                  spectrumCount: 12,
                  chromatogramCount: 3,
                },
                validation: {
                  mode: "output_only",
                  fullyVerified: false,
                  verified: ["source_unchanged"],
                  unverified: [],
                  inapplicable: [],
                },
                backend: { exitCode: 0, elapsedMilliseconds: 568 },
                // Cleanup failed, and what it left behind is in the folder the
                // user chose, so they are owed the warning.
                stagingResidue: "not_removed",
                installationGeneration: 0,
              },
            },
          }),
        ]),
      },
    });
    renderApp(api);

    await screen.findByRole("region", { name: "Convert" });
    // Scoped to the result: the plan beneath it names the same output, because
    // it is offering to convert the same row again.
    const item = within(queueResult()).getByText("run-1.mzML").closest("li");
    expect(item).not.toBeNull();
    expect(item).toHaveTextContent("12 spectra");
    expect(item).toHaveTextContent("3 chromatograms");
    // 28,655 bytes, as this app renders sizes everywhere else.
    expect(item).toHaveTextContent("28.0 KiB");
    expect(item).toHaveTextContent(
      "MSCanvas could not remove its own temporary folder afterwards.",
    );
    // And a run that produced something did have its output judged.
    expect(within(queueResult()).getByText(/Output-only validation\./, VISIBLE)).toBeVisible();
  });

  it("does not claim output-only validation over files it never inspected", async () => {
    // Every item skipped: the existing files were explicitly not looked at, and
    // nothing was produced to judge. Saying `Output-only validation` here would
    // tell the user their existing files passed a check nobody ran.
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
      reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", {
            state: "skipped",
            attempts: 1,
            result: {
              kind: "single" as const,
              report: {
                datasetHandle: "file-1",
                sourceKind: "thermo_raw",
                outcome: "skipped_existing_destination",
                detailedOutcome: "destination_exists",
                outputFileName: null,
                output: null,
                validation: null,
                backend: null,
                stagingResidue: null,
                installationGeneration: 0,
              },
            },
          }),
          queueItem("file-2", "run-2.raw", { state: "skipped", attempts: 1 }),
        ]),
      },
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(within(panel).getByText(/0 converted, 2 skipped, 0 failed of 2\./)).toBeVisible();
    // Scoped to the result. The plan below it says the same sentence about the
    // conversion the user could start next, which is a different claim and a
    // true one.
    expect(within(queueResult()).queryByText(/Output-only validation\./, VISIBLE)).toBeNull();
    // And the live region is a second path to the same claim, so it answers to
    // the same rule rather than announcing what the screen does not say.
    await waitFor(() => {
      expect(liveRegion()).toContain("0 converted, 2 skipped, 0 failed.");
    });
    expect(liveRegion()).not.toContain("Output-only validation");
  });

  it("stops offering actions for the whole of a retry, not only for its first moment", async () => {
    // A retry is one command that does not answer until the entire serial rerun
    // is over, and unlike starting a queue it has no reservation half to say
    // that something began. Without a busy state the panel would keep showing
    // the old terminal result -- and keep offering Retry, Add and Clear -- for
    // however long the rerun took.
    let releaseRetry: (() => void) | null = null;
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
      reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "failed", attempts: 1, retryable: true }),
        ]),
      },
      retry: () =>
        new Promise((resolve) => {
          releaseRetry = () => {
            resolve({
              status: "terminal",
      reason: "completed" as const,
              operationId: "1",
              queue: queueOf([
                queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 2 }),
              ]),
            });
          };
        }),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(within(panel).getByRole("button", { name: "Retry 1 failed" }));

    // The retry has not answered, and the interface has stopped offering work.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    });
    expect(within(panel).queryByRole("button", { name: "Retry 1 failed" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();
    // Including the row being rerun. Rust would refuse to let it go, so
    // offering the action would only produce an error nobody needed to see.
    fireEvent.click(rows()[0]);
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
    // And a screen reader is told now, rather than at the next poll.
    expect(liveRegion()).toContain("Retrying 1 failed.");

    act(() => {
      releaseRetry?.();
    });

    await waitFor(() => {
      expect(within(panel).getByText(/1 converted, 0 skipped, 0 failed of 1\./)).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
  });

  it("does not offer a retry the backend cannot serve", async () => {
    // A retry is a conversion. With no usable ProteoWizard the primary action
    // is already disabled, and a Retry that stayed live would buy a certain
    // failure and mark the conversion surface busy on the way to it.
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: unavailableBackend,
      initialConversion: {
        status: "terminal",
      reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "failed", attempts: 1, retryable: true }),
        ]),
      },
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Retry 1 failed" })).toBeDisabled();
    });
    // And it still says what it would do, so the reason it is unavailable is
    // the backend rather than the control having quietly changed meaning.
    expect(within(panel).getByRole("button", { name: "Retry 1 failed" })).toHaveAccessibleDescription(
      /Reruns only the failures another attempt could change/,
    );
  });

  it("recovers a queue this document did not start", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "running",
        operationId: "7",
        queue: {
          ...queueOf([
            queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1 }),
            queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 }),
          ]),
          currentIndex: 1,
        },
      },
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText("Converting item 2 of 2…")).toBeVisible();
    });
    // Nothing was restarted to find this out.
    expect(api.conversionRequests).toEqual([]);
  });

  it("refuses every workspace mutation while a queue runs, and keeps reads working", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second, selectedFile],
      availability: availableBackend,
      initialConversion: {
        status: "running",
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "running", attempts: 1 }),
          queueItem("file-2", "run-2.raw"),
        ]),
      },
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-1\.raw/ });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    // Reading the list is not a mutation.
    expect(screen.getByRole("searchbox", { name: "Search files" })).toBeEnabled();
    expect(rows()).toHaveLength(3);

    // Selecting a queued row makes removal unavailable; an unrelated row does not.
    fireEvent.click(rows()[0]);
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
    fireEvent.click(rows()[2]);
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled();
  });

  it("keeps every queue member visible when a search would have hidden it", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second, selectedFile],
      availability: availableBackend,
      initialConversion: {
        status: "running",
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "running", attempts: 1 }),
          queueItem("file-2", "run-2.raw"),
        ]),
      },
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-2\.raw/ });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC_pool" },
    });

    // Different reasons, because the user can do nothing about either.
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /run-1\.raw/ })).toHaveAccessibleName(
        expect.stringContaining("Converting — outside search"),
      );
    });
    expect(screen.getByRole("option", { name: /run-2\.raw/ })).toHaveAccessibleName(
      expect.stringContaining("Queued — outside search"),
    );
  });

  it("says why a queue was refused before any item ran", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      conversion: () =>
        Promise.resolve({
          status: "terminal",
      reason: "completed" as const,
          operationId: "1",
          queue: {
            ...queueOf([queueItem("file-1", "run-1.raw"), queueItem("file-2", "run-2.raw")]),
            error: {
              kind: "destination_is_remote",
              summary: "MSCanvas saves converted files to this computer's own drives.",
              detail: null,
              retryable: true,
            },
          },
        }),
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-2\.raw/ });
    selectAllRows();
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Convert 2 selected…" })).toBeEnabled();
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Convert 2 selected…" }));

    await waitFor(() => {
      expect(
        within(panel).getByText(
          "MSCanvas saves converted files to this computer's own drives.",
          VISIBLE,
        ),
      ).toBeVisible();
    });
    // Every item is still waiting: nothing ran.
    expect(within(panel).getAllByText("Waiting")).toHaveLength(2);
  });

  it("never names a folder, only display names", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first, second],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
      reason: "completed" as const,
        operationId: "1",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "finalized", attempts: 1 }),
          queueItem("file-2", "run-2.raw", { state: "skipped", attempts: 1 }),
        ]),
      },
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(within(panel).getByText(/1 converted, 1 skipped/)).toBeVisible();
    });

    const rendered = panel.textContent ?? "";
    expect(rendered).toContain("run-1.raw");
    expect(rendered).toContain("run-1.mzML");
    // `m/z` is removed first, and only `m/z`. It is a scientific unit this
    // panel names since M6.4 -- the queue says which precision it bound -- and
    // it is the one slash that is not a separator. Every other slash, every
    // backslash and every colon still fails, so a real path could not survive
    // this replacement.
    const withoutUnits = rendered.replaceAll("m/z", "mass-to-charge");
    for (const separator of ["\\", "/"]) {
      expect(withoutUnits).not.toContain(separator);
    }
    // A colon in prose is not a path. What the colon was here to catch is a
    // drive letter, so that is what is asserted -- and with both separators
    // already banned above, a Windows path could not reach this line anyway.
    expect(withoutUnits).not.toMatch(/[A-Za-z]:[\/]/u);
    // A skipped item is never described as validated.
    expect(within(panel).getAllByText(/a file of that name was already there/i).length).toBeGreaterThan(
      0,
    );
  });

  it("offers converted outputs to the workspace rather than adding them", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-1\.raw/ });
    const panel = await screen.findByRole("region", { name: "Convert" });

    fireEvent.click(within(panel).getByRole("button", { name: "Convert focused…" }));
    await waitFor(() => {
      expect(within(panel).getByText("1 converted, 0 skipped, 0 failed of 1.")).toBeVisible();
    });

    // Finishing a conversion adds nothing. The roster is still the one row the
    // user curated, and the output is an offer rather than an arrival.
    expect(rows()).toHaveLength(1);
    expect(
      within(panel).getByText("1 converted mzML output is ready to add to this workspace."),
    ).toBeVisible();
    const adopt = within(panel).getByRole("button", {
      name: "Add converted output to workspace",
    });
    expect(adopt).toBeEnabled();
    expect(adopt).toHaveAccessibleDescription(
      "MSCanvas verifies that each output is still the exact finalized file before adding it. Outputs are not previewed automatically.",
    );
    expect(api.adoptionRequests).toEqual([]);
  });

  it("refuses to preview a vendor row and says what to do instead", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: /run-1\.raw/ });

    const preview = screen.getByRole("button", { name: "Preview focused" });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAccessibleDescription(
      "Convert to mzML before previewing this acquisition.",
    );
    expect(api.openedHandles).toEqual([]);
  });

  it("says why a drop was refused while a queue runs", async () => {
    const transport = createFakeWorkspaceDropTransport();
    const api = createFakePreviewApi({
      initialDatasets: [first],
      availability: availableBackend,
    });
    render(
      <WorkspaceDropTransportProvider value={transport}>
        <PreviewApiProvider value={api}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    await screen.findByRole("option", { name: /run-1\.raw/ });

    await act(async () => {
      transport.emit({ sequence: 1, state: { status: "rejected", reason: "conversion_busy" } });
      await Promise.resolve();
    });

    const spoken = /MSCanvas is converting an acquisition, so those files were not added/;
    expect(screen.getByText(spoken, VISIBLE)).toBeVisible();
  });
});
