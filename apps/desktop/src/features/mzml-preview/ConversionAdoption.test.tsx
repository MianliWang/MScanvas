import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  quarantinedBackend,
  queueItem,
  queueOf,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type {
  ConversionQueueItem,
  SelectedFile,
  WorkspaceConversionState,
  WorkspaceOutputAdoptionResult,
} from "./contracts";

/**
 * Adding a terminal queue's finalized outputs to the workspace, from the
 * interface a user actually has.
 *
 * Everything here renders the whole application against the modelled boundary,
 * so what is asserted is what a document does with the states Rust can produce.
 *
 * The environment is jsdom with CSSOM, which this repository has no browser
 * harness beyond. Nothing here measures a pixel or a paint; what it asserts is
 * production structure, the exact user-visible copy, which controls are offered
 * and disabled, selection and focus, and that no read is launched.
 */

const ADOPT_EXPLANATION =
  "MSCanvas verifies that each output is still the exact finalized file before adding it. Outputs are not previewed automatically.";

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const DATASETS = [acquisition(1), acquisition(2)];

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** An item that finalized an output of its own. */
function converted(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "finalized",
    attempts: 1,
    report: {
      datasetHandle: handle,
      sourceKind: "thermo_raw",
      outcome: "finalized",
      detailedOutcome: null,
      outputFileName: name.replace(/\.raw$/i, ".mzML"),
      output: {
        byteLength: 28_637,
        sha256: "B3D97B38".repeat(8).slice(0, 64),
        spectrumCount: 1,
        chromatogramCount: 1,
      },
      validation: {
        mode: "output_only",
        verified: [],
        unverified: [],
        inapplicable: [],
        fullyVerified: false,
      },
      backend: null,
      stagingResidue: null,
      installationGeneration: 0,
    },
  });
}

/** A terminal queue that finalized `count` of its items. */
function completedQueue(count: number): WorkspaceConversionState {
  const items = [converted("file-1", "run-1.raw"), converted("file-2", "run-2.raw")].slice(
    0,
    count,
  );
  const rest = DATASETS.slice(count).map((dataset) =>
    queueItem(dataset.handle, dataset.fileName, { state: "failed", attempts: 1, retryable: false }),
  );
  return {
    status: "terminal",
    operationId: "1",
    reason: "completed",
    queue: queueOf([...items, ...rest]),
  };
}

function apiWith(
  state: WorkspaceConversionState,
  extra: Parameters<typeof createFakePreviewApi>[0] = {},
): FakePreviewApi {
  return createFakePreviewApi({
    initialDatasets: DATASETS,
    availability: availableBackend,
    initialConversion: state,
    ...extra,
  });
}

/**
 * The workspace rows, scoped to the roster.
 *
 * An unscoped option query also finds the sort control's options, which are not
 * rows and would make every count wrong by a fixed amount that looks plausible.
 */
function rows(): HTMLElement[] {
  const roster = screen.queryByRole("listbox", { name: "Workspace" });
  return roster === null ? [] : within(roster).queryAllByRole("option");
}

describe("adding converted outputs to the workspace", () => {
  it("offers one action for every finalized output, with what it checks", async () => {
    renderApp(apiWith(completedQueue(2)));

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(
      await within(panel).findByText("2 converted mzML outputs are ready to add to this workspace."),
    ).toBeVisible();
    const adopt = within(panel).getByRole("button", {
      name: "Add converted outputs to workspace",
    });
    expect(adopt).toBeEnabled();
    expect(adopt).toHaveAccessibleDescription(ADOPT_EXPLANATION);
    expect(within(panel).getByText(ADOPT_EXPLANATION)).toBeVisible();

    // The honest fallback, said before it is needed rather than after.
    expect(
      within(panel).getByText(
        "Finalized files remain on disk. If this queue is replaced, they can still be added later with Add files….",
      ),
    ).toBeVisible();
  });

  it("says one output in the singular", async () => {
    renderApp(apiWith(completedQueue(1)));

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(
      await within(panel).findByText("1 converted mzML output is ready to add to this workspace."),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    ).toBeVisible();
  });

  it("adds the outputs, selects them, and previews nothing", async () => {
    const api = apiWith(completedQueue(2));
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Add converted outputs to workspace" }),
    );

    await waitFor(() => {
      expect(rows()).toHaveLength(4);
    });
    // Named the queue it is looking at, and asked once.
    expect(api.adoptionRequests).toEqual(["1"]);
    // The adopted rows are ordinary mzML rows.
    expect(screen.getByRole("option", { name: /run-1\.mzML/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /run-2\.mzML/ })).toBeVisible();
    // Nothing was read. Adopting a file is not opening it.
    expect(api.requestedSpectra).toEqual([]);
    expect(api.openedHandles).toEqual([]);

    expect(
      within(panel).getByText("2 added, 0 already in the workspace, 0 not added."),
    ).toBeVisible();
  });

  it("keeps the search query and the sort the user set", async () => {
    const api = apiWith(completedQueue(2));
    renderApp(api);

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    const search = screen.getByRole("searchbox", { name: /search/i });
    fireEvent.change(search, { target: { value: "run" } });
    const sort = screen.getByRole("combobox", { name: /sort/i });
    fireEvent.change(sort, { target: { value: "name-asc" } });

    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Add converted outputs to workspace" }),
    );
    await waitFor(() => {
      expect(within(panel).getByText(/2 added/)).toBeVisible();
    });

    // How the user is looking at the roster is theirs, and adopting rows into
    // it is not a reason to reset either.
    expect(search).toHaveValue("run");
    expect(sort).toHaveValue("name-asc");
  });

  it("reports duplicates without adding anything or moving focus", async () => {
    const already: WorkspaceOutputAdoptionResult = {
      operationId: "1",
      retryRound: 0,
      roster: { datasets: DATASETS, capacity: 1_024 },
      outcomes: [
        {
          kind: "alreadyInWorkspace",
          itemIndex: 0,
          sourceHandle: "file-1",
          outputFileName: "run-1.mzML",
          dataset: DATASETS[0] as SelectedFile,
        },
      ],
    };
    const api = apiWith(completedQueue(1), { adoption: () => Promise.resolve(already) });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Add converted output to workspace" }),
    );

    expect(
      await within(panel).findByText(
        "All finalized outputs from this queue are already in the workspace.",
      ),
    ).toBeVisible();
    expect(rows()).toHaveLength(2);
  });

  it("counts added, duplicate and refused apart, and names the bounded few", async () => {
    const mixed: WorkspaceOutputAdoptionResult = {
      operationId: "1",
      retryRound: 0,
      roster: { datasets: DATASETS, capacity: 1_024 },
      outcomes: [
        {
          kind: "added",
          itemIndex: 0,
          sourceHandle: "file-1",
          outputFileName: "run-1.mzML",
          dataset: {
            handle: "file-9",
            fileName: "run-1.mzML",
            byteLength: 28_637,
            sourceKind: "mzml",
            relativeContext: null,
          },
        },
        {
          kind: "refused",
          itemIndex: 1,
          sourceHandle: "file-2",
          outputFileName: "run-2.mzML",
          reason: "output_changed",
        },
      ],
    };
    const api = apiWith(completedQueue(2), { adoption: () => Promise.resolve(mixed) });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Add converted outputs to workspace" }),
    );

    expect(
      await within(panel).findByText("1 added, 0 already in the workspace, 1 not added."),
    ).toBeVisible();
    expect(
      within(panel).getByText("run-2.mzML was not added: changed since it was converted."),
    ).toBeVisible();
    // No path anywhere in what a refusal says.
    for (const separator of ["\\", "/"]) {
      expect(panel.textContent ?? "").not.toContain(separator);
    }
  });

  it("offers adoption for a stopped queue that finalized something", async () => {
    renderApp(
      apiWith({
        status: "terminal",
        operationId: "1",
        reason: "stopped",
        queue: queueOf([
          converted("file-1", "run-1.raw"),
          queueItem("file-2", "run-2.raw", { state: "cancelled", attempts: 1 }),
        ]),
      }),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    // The one finalized output, and only it. A cancelled item produced nothing.
    expect(
      await within(panel).findByText("1 converted mzML output is ready to add to this workspace."),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    ).toBeEnabled();
  });

  it("offers adoption after an unconfirmed stop, because adding launches nothing", async () => {
    renderApp(
      apiWith(
        {
          status: "terminal",
          operationId: "1",
          reason: "stopFailed",
          queue: queueOf([
            converted("file-1", "run-1.raw"),
            queueItem("file-2", "run-2.raw", { state: "cancellationFailed", attempts: 1 }),
          ]),
        },
        { initialBackendQuarantined: true, availability: quarantinedBackend },
      ),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    const adopt = await within(panel).findByRole("button", {
      name: "Add converted output to workspace",
    });
    // A quarantined session runs no process, and this one does not need to.
    expect(adopt).toBeEnabled();
    // Everything that would launch one is still refused.
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Convert/ })).toBeDisabled();
    });
  });

  it("offers nothing to add when the queue finalized nothing", async () => {
    renderApp(
      apiWith({
        status: "terminal",
        operationId: "1",
        reason: "completed",
        queue: queueOf([
          queueItem("file-1", "run-1.raw", { state: "failed", attempts: 1, retryable: false }),
          queueItem("file-2", "run-2.raw", { state: "skipped", attempts: 1 }),
        ]),
      }),
    );

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(
      await within(panel).findByText(
        "Nothing was converted, so there is nothing to add to the workspace.",
      ),
    ).toBeVisible();
    expect(within(panel).queryByRole("button", { name: /Add converted/ })).toBeNull();
  });

  it("keeps adoption and retry from overlapping", async () => {
    const api = apiWith(
      {
        status: "terminal",
        operationId: "1",
        reason: "completed",
        queue: queueOf([
          converted("file-1", "run-1.raw"),
          queueItem("file-2", "run-2.raw", {
            state: "failed",
            attempts: 1,
            retryable: true,
            error: {
              kind: "file_unreadable",
              summary: "MSCanvas could not read that file.",
              detail: null,
              retryable: true,
            },
          }),
        ]),
      },
      {
        // Never answers, so the in-flight window is the whole of this test.
        adoption: () => new Promise<WorkspaceOutputAdoptionResult>(() => {}),
      },
    );
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    // Both are offered before either runs.
    expect(await within(panel).findByRole("button", { name: "Retry 1 failed" })).toBeEnabled();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    );

    expect(await within(panel).findByText("Adding converted outputs…")).toBeVisible();
    // Not called a conversion, and no fraction invented.
    expect(panel.textContent ?? "").not.toContain("%");
    // And the actions that would fight with it are gone or refused.
    expect(within(panel).queryByRole("button", { name: /^Retry/ })).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();
    // The roster stays readable throughout.
    expect(screen.getByRole("listbox", { name: "Workspace" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: /search/i })).toBeEnabled();
  });

  it("says nothing was added when the workspace moved underneath", async () => {
    const api = apiWith(completedQueue(1), {
      adoption: () =>
        Promise.reject({
          kind: "adoption_superseded",
          summary:
            "The workspace changed while MSCanvas was checking the converted outputs. Nothing was added. Try again.",
          detail: null,
          retryable: true,
        }),
    });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Add converted output to workspace" }),
    );

    expect(
      await within(panel).findByText(
        "The workspace changed while MSCanvas was checking the converted outputs. Nothing was added. Try again.",
      ),
    ).toBeVisible();
    // Nothing arrived, and the action is offered again rather than spent.
    expect(rows()).toHaveLength(2);
    expect(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    ).toBeEnabled();
  });

  it("offers the action again after a partial result", async () => {
    // An output refused because the workspace was full becomes admissible the
    // moment rows are removed, and one the user removes afterwards is
    // admissible again too. The queue still holds what recognises them, so a
    // summary that replaced the action would waste exactly that.
    const partial: WorkspaceOutputAdoptionResult = {
      operationId: "1",
      retryRound: 0,
      roster: { datasets: DATASETS, capacity: 1_024 },
      outcomes: [
        {
          kind: "refused",
          itemIndex: 0,
          sourceHandle: "file-1",
          outputFileName: "run-1.mzML",
          reason: "workspace_full",
        },
      ],
    };
    const api = apiWith(completedQueue(1), { adoption: () => Promise.resolve(partial) });
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Add converted output to workspace" }),
    );

    expect(
      await within(panel).findByText("0 added, 0 already in the workspace, 1 not added."),
    ).toBeVisible();
    expect(
      within(panel).getByText("run-1.mzML was not added: the workspace is full."),
    ).toBeVisible();
    // Reported and still offered, with copy that says what a second press does.
    const again = within(panel).getByRole("button", {
      name: "Add converted output to workspace",
    });
    expect(again).toBeEnabled();
    expect(
      within(panel).getByText(
        "You can add them again. Anything already in the workspace is reported rather than added twice.",
      ),
    ).toBeVisible();
    fireEvent.click(again);
    await waitFor(() => {
      expect(api.adoptionRequests).toEqual(["1", "1"]);
    });
  });

  it("recovers an adoptable terminal queue after a reload", async () => {
    // The replacement document reads the slot on mount and finds the same
    // terminal queue, so the offer is there without anything being re-issued.
    const api = apiWith(completedQueue(2));
    renderApp(api);

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(
      await within(panel).findByRole("button", { name: "Add converted outputs to workspace" }),
    ).toBeEnabled();
    expect(api.adoptionRequests).toEqual([]);
  });
});
