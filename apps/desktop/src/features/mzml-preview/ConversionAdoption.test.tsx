import { UI_RESOURCES } from "../preferences/i18n";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  finalizedAttemptFacts,
  outputSetReport,
  previewError,
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
import { rosterActionRefused } from "../../test/rosterActions";

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
  fireEvent.click(screen.getByRole("button", { name: "Conversion" }));
}

/** An item that finalized an output of its own. */
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
        outputFileName: name.replace(/\.raw$/i, ".mzML"),
        output: {
          byteLength: 28_637,
          sha256: "B3D97B38".repeat(8).slice(0, 64),
          spectrumCount: 1,
          chromatogramCount: 1,
        },
        validationMode: "output_only",
        validation: {
          mode: "output_only",
          verified: [],
          unverified: [],
          inapplicable: [],
          advisory: [],
          fullyVerified: false,
        },
        backend: null,
        stagingResidue: null,
        receipt: 1,
      },
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
  const roster = screen.queryByRole("treegrid", { name: "Acquisitions" });
  return roster === null ? [] : Array.from(roster.querySelectorAll<HTMLElement>("[data-handle]"));
}

describe("adding converted outputs to the workspace", () => {
  it("offers one action for every finalized output, with what it checks", async () => {
    renderApp(apiWith(completedQueue(2)));

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(
      await within(panel).findByText("2 mzML outputs ready to add."),
    ).toBeVisible();
    const adopt = within(panel).getByRole("button", {
      name: "Add converted outputs to workspace",
    });
    expect(adopt).not.toHaveAttribute("aria-disabled");
    // The action names itself; nothing describes it until it is refused.
    expect(adopt).not.toHaveAttribute("aria-describedby");
  });

  it("says one output in the singular", async () => {
    renderApp(apiWith(completedQueue(1)));

    const panel = await screen.findByRole("region", { name: "Convert" });
    expect(
      await within(panel).findByText("1 mzML output ready to add."),
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
    const roster = within(screen.getByRole("treegrid", { name: "Acquisitions" }));
    expect(roster.getByRole("row", { name: /run-1\.mzML/ })).toBeVisible();
    expect(roster.getByRole("row", { name: /run-2\.mzML/ })).toBeVisible();
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
    const panel = await screen.findByRole("region", { name: "Convert" });
    // The order is the next conversion's, opened under the finished queue.
    fireEvent.click(within(panel).getByRole("button", { name: "Start another conversion" }));
    const sort = within(panel).getByRole("combobox", { name: "Execution order" });
    fireEvent.change(sort, { target: { value: "name-asc" } });

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
          memberIndex: 0,
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
      await within(panel).findByText("0 added, 1 already in the workspace, 0 not added."),
    ).toBeVisible();
    expect(rows()).toHaveLength(2);
    // Still offered. A duplicate today can be a row the user removes tomorrow,
    // and the queue still holds what recognises the file.
    expect(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    ).not.toHaveAttribute("aria-disabled");
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
          memberIndex: 0,
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
          memberIndex: 0,
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
      within(panel).getByText("run-2.mzML was not added: it changed since it was converted."),
    ).toBeVisible();
    // No path anywhere. A bare "/" is no longer the test: `m/z` is scientific
    // notation and appears in the settings labels, so what must be absent is a
    // path *shape* -- a backslash, a drive letter, or a token that begins at a
    // separator. Each of those is what an absolute path would look like here,
    // and none of them is something a display name or a unit can produce.
    const noPaths = (text: string): void => {
      expect(text).not.toMatch(/\\/);
      expect(text).not.toMatch(/(?:^|\s)\//);
      expect(text).not.toMatch(/\b[A-Za-z]:[\\\/]/);
    };
    noPaths(panel.textContent ?? "");
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
      await within(panel).findByText("1 mzML output ready to add."),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    ).not.toHaveAttribute("aria-disabled");
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
    expect(adopt).not.toHaveAttribute("aria-disabled");
    // Everything that would launch one is still refused.
    fireEvent.click(within(panel).getByRole("button", { name: "Start another conversion" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Convert/ })).toHaveAttribute("aria-disabled", "true");
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
    // Nothing to add, so nothing is offered: each row and the queue's counts
    // already say why.
    await waitFor(() => expect(panel.querySelector('[data-item-state="failed"]')).not.toBeNull());
    expect(panel.querySelector(".conversion-adoption")).toBeNull();
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
    expect(await within(panel).findByRole("button", { name: "Retry 1 failed" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    );

    expect(await within(panel).findByText("Adding converted outputs…")).toBeVisible();
    // Not called a conversion, and no fraction invented.
    expect(panel.textContent ?? "").not.toContain("%");
    // The control the user activated is still there and still focused, said
    // beside it rather than in place of it.
    const adopting = within(panel).getByRole("button", {
      name: "Add converted output to workspace",
    });
    expect(adopting).toHaveAttribute("aria-disabled", "true");
    expect(adopting).toBeVisible();
    // And the actions that would fight with it are gone or refused.
    expect(within(panel).queryByRole("button", { name: /^Retry/ })).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add files…" })).toHaveAttribute("aria-disabled", "true");
    });
    expect(await rosterActionRefused("clearList")).toBe(true);
    // The roster stays readable throughout.
    expect(screen.getByRole("treegrid", { name: "Acquisitions" })).toBeVisible();
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
        UI_RESOURCES.en.m74ErrorAdoptionChanged,
      ),
    ).toBeVisible();
    // Nothing arrived, and the action is offered again rather than spent.
    expect(rows()).toHaveLength(2);
    expect(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    ).not.toHaveAttribute("aria-disabled");
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
          memberIndex: 0,
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
    // Reported and still offered.
    const again = within(panel).getByRole("button", {
      name: "Add converted output to workspace",
    });
    expect(again).not.toHaveAttribute("aria-disabled");
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
    ).not.toHaveAttribute("aria-disabled");
    expect(api.adoptionRequests).toEqual([]);
  });
});

/** ADR 0052: one Add per output, offered only where Rust says it is adoptable. */
describe("adding one converted output", () => {
  const LABEL = { unverifiedSettings: true, unverifiedBuildRelease: null };

  /** A finalized item whose one output carries the id Rust would mint. */
  function offered(handle: string, name: string): ConversionQueueItem {
    return {
      ...converted(handle, name),
      ...finalizedAttemptFacts(),
      finalizedOutputs: [{ outputId: `out-${handle}`, fileName: name.replace(/\.raw$/i, ".mzML") }],
    };
  }

  function terminalOf(items: readonly ConversionQueueItem[]): WorkspaceConversionState {
    return { status: "terminal", operationId: "1", reason: "completed", queue: queueOf([...items]) };
  }

  const group = (panel: HTMLElement, name: string): HTMLElement =>
    within(panel).getByRole("group", { name: `Locate ${name}` });
  const addIn = (panel: HTMLElement, name: string): HTMLElement =>
    within(group(panel, name)).getByRole("button", { name: `Add ${name} to workspace` });

  it("adds exactly that output, says so on its own line and takes back the queue's summary", async () => {
    const api = apiWith(terminalOf([offered("file-1", "run-1.raw"), offered("file-2", "run-2.raw")]));
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => { expect(rows()).toHaveLength(2); });

    // The queue-wide action first, so there is a summary to take back.
    fireEvent.click(within(panel).getByRole("button", { name: "Add converted outputs to workspace" }));
    await within(panel).findByText("2 added, 0 already in the workspace, 0 not added.");
    await waitFor(() => { expect(rows()).toHaveLength(4); });

    fireEvent.click(addIn(panel, "run-1.mzML"));
    await waitFor(() => { expect(api.outputAdoptionRequests).toEqual([{ operationId: "1", outputId: "out-file-1" }]); });
    await within(group(panel, "run-1.mzML")).findByText(UI_RESOURCES.en.outputAlreadyInWorkspace);
    expect(within(group(panel, "run-2.mzML")).queryByText(UI_RESOURCES.en.outputAlreadyInWorkspace)).toBeNull();
    expect(panel.querySelector(".conversion-adoption-summary")?.textContent).toBe("");
    expect(api.adoptionRequests).toEqual(["1"]);

    // Still offered: a row the reader removes tomorrow can be added again.
    expect(addIn(panel, "run-1.mzML")).not.toHaveAttribute("aria-disabled");

    // And the queue-wide answer takes the per-output one back.
    fireEvent.click(within(panel).getByRole("button", { name: "Add converted outputs to workspace" }));
    await within(panel).findByText("0 added, 2 already in the workspace, 0 not added.");
    expect(within(group(panel, "run-1.mzML")).queryByText(UI_RESOURCES.en.outputAlreadyInWorkspace)).toBeNull();
  });

  it("offers the added row in the Workbench, by name, only while it is live", async () => {
    const api = apiWith(terminalOf([offered("file-1", "run-1.raw")]));
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => { expect(rows()).toHaveLength(2); });
    const showName = "Show in Workbench: run-1.mzML";
    expect(within(panel).queryByRole("button", { name: showName })).toBeNull();

    fireEvent.click(addIn(panel, "run-1.mzML"));
    await within(group(panel, "run-1.mzML")).findByText(UI_RESOURCES.en.outputAdded);
    await waitFor(() => { expect(rows()).toHaveLength(3); });

    fireEvent.click(await within(group(panel, "run-1.mzML")).findByRole("button", { name: showName }));
    await waitFor(() => { expect(document.getElementById("workbench-evidence")).not.toHaveAttribute("hidden"); });
  });

  it("shows the label beside Add for a labelled output, and none otherwise", async () => {
    const api = apiWith(terminalOf([{ ...offered("file-1", "run-1.raw"), notVerifiedByMscanvas: LABEL }, offered("file-2", "run-2.raw")]));
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await within(panel).findByRole("group", { name: "Locate run-1.mzML" });
    expect(group(panel, "run-1.mzML").querySelector("[data-not-verified]")?.textContent).toBe(UI_RESOURCES.en.m74CnvNotVerified);
    expect(group(panel, "run-2.mzML").querySelector("[data-not-verified]")).toBeNull();
    // Not a Tab stop of its own, so the action it is about describes it.
    expect(addIn(panel, "run-1.mzML")).toHaveAccessibleDescription(UI_RESOURCES.en.m74CnvNotVerified);
    expect(addIn(panel, "run-2.mzML")).not.toHaveAccessibleDescription();
  });

  it("stops saying an output is ready to add once one has its own answer", async () => {
    const api = apiWith(terminalOf([offered("file-1", "run-1.raw")]));
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await within(panel).findByText(UI_RESOURCES.en.m74CnvOneReady);
    fireEvent.click(addIn(panel, "run-1.mzML"));
    await within(group(panel, "run-1.mzML")).findByText(UI_RESOURCES.en.outputAdded);
    expect(within(panel).queryByText(UI_RESOURCES.en.m74CnvOneReady)).toBeNull();
  });

  it("keeps the opening actions but offers no Add where Rust offers none", async () => {
    const cases: readonly [string, WorkspaceConversionState][] = [
      // A finalized item already reads `notRequested` while its queue runs;
      // only the queue's count tells a settled queue from one under way.
      ["a queue still running", { status: "running", operationId: "1", queue: queueOf([offered("file-1", "run-1.raw"), queueItem("file-2", "run-2.raw", { state: "running", attempts: 1 })]) }],
      // The finalized prefix of a partial set is listed for opening and is
      // never adopted one by one (ADR 0027).
      ["a partial set's prefix", terminalOf([queueItem("file-1", "run-1.wiff", {
        state: "finalized",
        attempts: 1,
        ...finalizedAttemptFacts(),
        adoption: { kind: "nothingToAdopt" },
        finalizedOutputs: [{ outputId: "out-prefix", fileName: "run-1.mzML" }],
        result: { kind: "outputSet", report: outputSetReport("file-1", ["run-1.mzML"], { completeSetAdoptable: false }) },
      })])],
      ["an item that did not finalize", terminalOf([{ ...offered("file-1", "run-1.raw"), state: "failed", adoption: { kind: "nothingToAdopt" } }])],
    ];
    for (const [name, state] of cases) {
      const view = render(
        <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
          <PreviewApiProvider value={createFakePreviewApi({ initialDatasets: DATASETS, availability: availableBackend, initialConversion: state })}>
            <App />
          </PreviewApiProvider>
        </WorkspaceDropTransportProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Conversion" }));
      const panel = await screen.findByRole("region", { name: "Convert" });
      await waitFor(() => { expect(panel.querySelector(".conversion-run-list"), name).not.toBeNull(); });
      expect(within(panel).queryByRole("button", { name: /^Add run-/u }), name).toBeNull();
      if (name === "a partial set's prefix") {
        const locate = await within(panel).findByRole("group", { name: "Locate run-1.mzML" });
        expect(within(locate).getByRole("button", { name: UI_RESOURCES.en.outputOpenFile })).toBeVisible();
      }
      view.unmount();
    }
  });

  it("says a refused output on its own line, not in the queue's words", async () => {
    const api = apiWith(terminalOf([offered("file-1", "run-1.raw")]), {
      outputAdoption: () => Promise.reject(previewError({ kind: "outputs_not_adoptable", summary: "whole queue words", retryable: false })),
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(await waitFor(() => addIn(panel, "run-1.mzML")));

    await within(group(panel, "run-1.mzML")).findByText("run-1.mzML was not added: this queue no longer offers it.");
    expect(within(panel).queryByText(/whole queue words/u)).toBeNull();
    expect(within(panel).queryByText(UI_RESOURCES.en.m74ErrorNotAdoptable)).toBeNull();
  });

  it("says every refusal on that output's line, because the queue's notice can be out of sight", async () => {
    const full: WorkspaceOutputAdoptionResult = {
      operationId: "1", retryRound: 0, roster: { datasets: DATASETS, capacity: 2 },
      outcomes: [{ kind: "refused", itemIndex: 0, memberIndex: 0, sourceHandle: "file-1", outputFileName: "run-1.mzML", reason: "workspace_full" }],
    };
    let answer: () => Promise<WorkspaceOutputAdoptionResult> = () => Promise.resolve(full);
    const api = apiWith(terminalOf([offered("file-1", "run-1.raw")]), { outputAdoption: () => answer() });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    fireEvent.click(await waitFor(() => addIn(panel, "run-1.mzML")));
    await within(group(panel, "run-1.mzML")).findByText(/^run-1\.mzML was not added: /u);

    answer = () => Promise.reject(previewError({ kind: "adoption_superseded", summary: "moved", retryable: true }));
    fireEvent.click(addIn(panel, "run-1.mzML"));
    await within(group(panel, "run-1.mzML")).findByText(UI_RESOURCES.en.m74ErrorAdoptionChanged);
    expect(panel.querySelector(".conversion-notice")).toBeNull();
    // And it can be pressed again, which is the whole of the recovery.
    expect(addIn(panel, "run-1.mzML")).not.toHaveAttribute("aria-disabled");
  });

  it("refuses every Add while one is out, keeps it a Tab stop and points at the visible reason", async () => {
    const pending = deferred<WorkspaceOutputAdoptionResult>();
    const api = apiWith(terminalOf([offered("file-1", "run-1.raw"), offered("file-2", "run-2.raw")]), { outputAdoption: () => pending.promise });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    const first = await waitFor(() => addIn(panel, "run-1.mzML"));
    first.focus();
    fireEvent.click(first);
    fireEvent.click(first);
    expect(first).toHaveFocus();
    await waitFor(() => { expect(first).toHaveAttribute("aria-disabled", "true"); });
    // Its own line says it, and the others point at the status bar, which is on
    // screen however far down the list they are.
    expect(within(group(panel, "run-1.mzML")).getByRole("status")).toHaveTextContent(UI_RESOURCES.en.outputAdding);
    expect(first).toHaveAccessibleDescription(UI_RESOURCES.en.outputAdding);
    const second = addIn(panel, "run-2.mzML");
    expect(second).toHaveAttribute("aria-disabled", "true");
    expect(second).toHaveAccessibleDescription(`In progress: ${UI_RESOURCES.en.m74CnvAdoptOneInFlight}`);
    expect(within(group(panel, "run-2.mzML")).getByRole("status")).toBeEmptyDOMElement();
    expect(panel.querySelector(".conversion-adoption-summary")).toHaveTextContent(UI_RESOURCES.en.m74CnvAdoptOneInFlight);
    fireEvent.click(second);
    expect(api.outputAdoptionRequests).toHaveLength(1);

    pending.resolve({ operationId: "1", retryRound: 0, roster: { datasets: DATASETS, capacity: 1_024 },
      outcomes: [{ kind: "alreadyInWorkspace", itemIndex: 0, memberIndex: 0, sourceHandle: "file-1", outputFileName: "run-1.mzML", dataset: DATASETS[0] as SelectedFile }] });
    await within(group(panel, "run-1.mzML")).findByText(UI_RESOURCES.en.outputAlreadyInWorkspace);
    await waitFor(() => { expect(first).not.toHaveAttribute("aria-disabled"); });
  });
});
