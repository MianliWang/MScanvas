/**
 * One selected scan, decided in one place.
 *
 * Before this slice the workspace held a `selectedIndex` of its own beside
 * nothing, which was harmless because nothing else answered the question. The
 * linked viewer gives three surfaces that can ask for a scan and two that have
 * to react to one, and ADR 0032 answers it once: the reducer holds the
 * selection, allocates the revision that tells two commits apart, and is the
 * only thing that does.
 *
 * So what these tests are about is ownership rather than transport. Which
 * requests reach the backend is settled elsewhere; what is settled here is that
 * every accepted request commits exactly one revision, that a refused one
 * commits none, and that a preview's own lifecycle owns the interaction while a
 * workspace row's focus does not.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type { BackendAvailability, Preview, SelectedSpectrumOutcome } from "./contracts";
import type { WorkspaceDropTransport } from "./dropTransport";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { canStartSpectrumSelection, usePreviewWorkspace } from "./usePreviewWorkspace";
import { activeGestureEpoch, renderedDomain } from "./viewer/interactionState";
import type { Deferred, FakePreviewApiOptions } from "../../test/previewFixtures";
import {
  availableBackend,
  buildPreview,
  buildRows,
  buildSpectrum,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  previewError,
  queueItem,
  queueOf,
  secondFile,
  selectedFile,
  shimadzuDataset,
  unavailableBackend,
} from "../../test/previewFixtures";

const VENDOR_ROW = shimadzuDataset(9);

function wrapper(
  api: PreviewApi,
  dropTransport: WorkspaceDropTransport = createFakeWorkspaceDropTransport(),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      WorkspaceDropTransportProvider,
      { value: dropTransport },
      createElement(PreviewApiProvider, { value: api }, children),
    );
  };
}

type Workspace = ReturnType<typeof usePreviewWorkspace>;

/** Mounts the hook with a session that already holds one mzML row and one vendor row. */
function mount(
  options: {
    readonly preview?: Preview | (() => Promise<Preview>);
    readonly spectrum?: (index: number) => Promise<SelectedSpectrumOutcome>;
    readonly availability?: () => Promise<BackendAvailability>;
    readonly conversion?: FakePreviewApiOptions["conversion"];
  } = {},
) {
  const api = createFakePreviewApi({
    initialDatasets: [selectedFile, VENDOR_ROW],
    preview: options.preview ?? buildPreview(6),
    ...(options.spectrum === undefined ? {} : { spectrum: options.spectrum }),
    ...(options.availability === undefined ? {} : { availability: options.availability }),
    ...(options.conversion === undefined ? {} : { conversion: options.conversion }),
  });
  const rendered = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
  return { api, ...rendered };
}

/**
 * A session whose backend verdict this test decides, one check at a time.
 *
 * The mount check answers at once so a preview can be opened; every later check
 * is handed back for the test to settle, which is what holds the backend lane
 * busy for as long as an assertion needs.
 */
function decidedBackend(later: readonly BackendAvailability[]) {
  const pending: Deferred<BackendAvailability>[] = [];
  let checks = 0;
  return {
    pending,
    availability: () => {
      checks += 1;
      if (checks === 1) {
        return Promise.resolve(availableBackend);
      }
      const answer = later[checks - 2];
      if (answer !== undefined) {
        return Promise.resolve(answer);
      }
      const held = deferred<BackendAvailability>();
      pending.push(held);
      return held.promise;
    },
  };
}

/** A conversion that reaches the running slot and stays there. */
const RUNNING_QUEUE: FakePreviewApiOptions["conversion"] = (_request, publish) =>
  new Promise(() => {
    publish({
      status: "running",
      operationId: "1",
      queue: {
        ...queueOf([queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, {
          state: "running",
          attempts: 1,
        })]),
        currentIndex: 0,
      },
    });
  });

async function openThePreview(
  result: { current: Workspace },
  handle: string = selectedFile.handle,
): Promise<void> {
  await waitFor(() => {
    expect(result.current.rosterLoad.status).toBe("ready");
  });
  await act(async () => {
    result.current.activateDataset(handle);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(result.current.preview.status).toBe("loaded");
  });
}

async function select(result: { current: Workspace }, index: number): Promise<void> {
  await act(async () => {
    result.current.selectSpectrum(index);
    await Promise.resolve();
  });
}

describe("one selection authority", () => {
  it("reads the selected scan out of the interaction state and nowhere else", async () => {
    const { result } = mount();
    await openThePreview(result);
    expect(result.current.selectedIndex).toBeNull();

    await select(result, 2);

    expect(result.current.viewerInteraction.selection?.index).toBe(2);
    expect(result.current.selectedIndex).toBe(2);
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
  });

  it("lets the reducer allocate the revision, once per accepted commit", async () => {
    const { result, api } = mount();
    await openThePreview(result);

    await select(result, 1);
    const first = result.current.viewerInteraction.selection?.revision ?? 0;
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    // The same scan again, after the previous read settled. A new commit: the
    // user asked for that scan again, and a linked view may have been scrolled
    // or panned away from it since.
    await select(result, 1);

    const second = result.current.viewerInteraction.selection?.revision ?? 0;
    expect(second).toBeGreaterThan(first);
    expect(result.current.viewerInteraction.selection?.index).toBe(1);
    expect(api.requestedSpectra).toEqual([1, 1]);
  });

  it("allocates no revision and starts no second process for a repeat still in flight", async () => {
    // One double click must not be two ProteoWizard processes -- and must not
    // be two commits either, or a linked view would reveal twice for one
    // request.
    const reply = deferred<SelectedSpectrumOutcome>();
    const { result, api } = mount({ spectrum: () => reply.promise });
    await openThePreview(result);

    await select(result, 3);
    const revision = result.current.viewerInteraction.selection?.revision ?? 0;

    await select(result, 3);

    expect(result.current.viewerInteraction.selection?.revision).toBe(revision);
    expect(api.requestedSpectra).toEqual([3]);

    await act(async () => {
      reply.resolve({ outcome: "unavailable", requestedIndex: 3 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("unavailable");
    });
  });

  it("refuses an index the loaded table does not contain rather than guessing one", async () => {
    // A commit carries the retention time its linked plot reveals it at, and
    // there is nowhere honest to get one from for a row this preview has not
    // got. Refusing leaves the selection exactly as it was and launches
    // nothing.
    const { result, api } = mount();
    await openThePreview(result);
    await select(result, 2);
    const revision = result.current.viewerInteraction.selection?.revision ?? 0;

    await select(result, 4_242);

    expect(result.current.viewerInteraction.selection?.index).toBe(2);
    expect(result.current.viewerInteraction.selection?.revision).toBe(revision);
    expect(api.requestedSpectra).toEqual([2]);
  });

  it("commits the retention time the loaded table reports for that row", async () => {
    const { result } = mount();
    await openThePreview(result);

    await select(result, 3);

    expect(result.current.viewerInteraction.selection?.retentionTime).toBe(
      buildRows(6)[3]?.retentionTime.value,
    );
  });

  it("does not let a superseded read overwrite the selection that replaced it", async () => {
    /*
     * The two race mechanisms answer different questions and both have to hold.
     * The interaction revision decides whether a linked view has acted on a
     * commit; the request token decides which backend reply may be shown. Select
     * A, then B before A settles: B is the selection, and neither A's success
     * nor A's failure may move it.
     */
    const replies = [
      deferred<SelectedSpectrumOutcome>(),
      deferred<SelectedSpectrumOutcome>(),
    ];
    let asked = 0;
    const { result, api } = mount({
      spectrum: () => {
        const reply = replies[asked];
        asked += 1;
        return reply?.promise ?? Promise.reject(new Error("one reply per selection"));
      },
    });
    await openThePreview(result);

    await select(result, 1);
    await select(result, 4);
    expect(result.current.selectedIndex).toBe(4);
    expect(api.requestedSpectra).toEqual([1, 4]);
    const committed = result.current.viewerInteraction.selection;

    // B lands first and is shown.
    await act(async () => {
      replies[1]?.resolve({ outcome: "spectrum", spectrum: buildSpectrum(4, 6) });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    // A lands afterwards, and then fails on a retry of the same stale token.
    await act(async () => {
      replies[0]?.resolve({ outcome: "spectrum", spectrum: buildSpectrum(1, 6) });
      await Promise.resolve();
    });

    expect(result.current.selectedIndex).toBe(4);
    expect(result.current.viewerInteraction.selection).toBe(committed);
    expect(
      result.current.spectrum.status === "loaded"
        ? result.current.spectrum.spectrum.index
        : null,
    ).toBe(4);
  });

  it("keeps the selected scan when its read fails", async () => {
    // A failure is a fact about the read, not about what the user chose. The
    // panel shows its typed outcome and the selection stays where they put it.
    const { result } = mount({
      spectrum: () => Promise.reject(previewError({ retryable: true })),
    });
    await openThePreview(result);

    await select(result, 2);

    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("failed");
    });
    expect(result.current.selectedIndex).toBe(2);
    expect(result.current.viewerInteraction.selection?.index).toBe(2);
  });
});

describe("the viewer's own lifecycle", () => {
  it("adopts the loaded run's full retention-time domain", async () => {
    const { result } = mount();
    await openThePreview(result);

    expect(result.current.scanModel.status).toBe("ready");
    expect(result.current.viewerInteraction.fullDomain).toEqual({
      low: 0,
      high: 5 * 0.0125,
    });
    // The whole run, as a state rather than as a range that happens to equal
    // one.
    expect(result.current.viewerInteraction.committedDomain).toBeNull();
  });

  it("leaves the viewport closed when the model refuses, and still selects", async () => {
    // A truncated preview has no chromatogram. The scan table beside it is
    // still a usable list of rows, and selecting one still commits here.
    const { result, api } = mount({ preview: buildPreview(4, true) });
    await openThePreview(result);

    expect(result.current.scanModel).toEqual({ status: "unavailable", reason: "truncated" });
    expect(result.current.viewerInteraction.fullDomain).toBeNull();

    await select(result, 1);

    expect(result.current.selectedIndex).toBe(1);
    expect(api.requestedSpectra).toEqual([1]);
    // Nothing to reveal into, and nothing pretending there is.
    expect(renderedDomain(result.current.viewerInteraction)).toBeNull();
  });

  it("replaces the whole interaction when a different preview is opened", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile],
      preview: buildPreview(6),
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await openThePreview(result);
    await select(result, 2);
    act(() => {
      result.current.dispatchViewerEvent({
        type: "viewport-step",
        domain: { low: 0.01, high: 0.03 },
      });
      result.current.dispatchViewerEvent({ type: "hover-established", spectrumIndex: 2 });
    });
    expect(result.current.viewerInteraction.committedDomain).not.toBeNull();

    await openThePreview(result, secondFile.handle);

    expect(result.current.viewerInteraction.selection).toBeNull();
    expect(result.current.viewerInteraction.committedDomain).toBeNull();
    expect(result.current.viewerInteraction.hover).toBeNull();
    expect(result.current.viewerInteraction.gesture).toBeNull();
  });

  it("does not let a settle from the previous preview reach the next one", async () => {
    // The whole reason a gesture carries an epoch. A debounce scheduled under
    // one run cannot be relied on to have been cleared before another loads.
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile, secondFile],
      preview: buildPreview(6),
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await openThePreview(result);

    let stale: number | null = null;
    act(() => {
      stale = activeGestureEpoch(
        result.current.dispatchViewerEvent({
          type: "gesture-started",
          domain: { low: 0.01, high: 0.02 },
        }),
      );
    });
    expect(stale).not.toBeNull();

    await openThePreview(result, secondFile.handle);
    const loaded = result.current.viewerInteraction;

    act(() => {
      result.current.dispatchViewerEvent({ type: "gesture-settled", epoch: stale ?? -1 });
    });

    expect(result.current.viewerInteraction).toBe(loaded);
    expect(result.current.viewerInteraction.committedDomain).toBeNull();
  });

  it("closes the interaction when the workspace is cleared", async () => {
    const { result } = mount();
    await openThePreview(result);
    await select(result, 2);
    act(() => {
      result.current.dispatchViewerEvent({
        type: "viewport-step",
        domain: { low: 0.01, high: 0.03 },
      });
    });
    expect(result.current.viewerInteraction.selection).not.toBeNull();

    await act(async () => {
      result.current.clearList();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("empty");
    });

    expect(result.current.viewerInteraction.fullDomain).toBeNull();
    expect(result.current.viewerInteraction.committedDomain).toBeNull();
    expect(result.current.viewerInteraction.selection).toBeNull();
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.scanModel.status).toBe("unavailable");
  });

  it("leaves the loaded viewer alone when a vendor row takes focus", async () => {
    // The established distinction: the focused workspace row is not the loaded
    // preview's authority.
    const { result, api } = mount();
    await openThePreview(result);
    await select(result, 2);
    act(() => {
      result.current.dispatchViewerEvent({
        type: "viewport-step",
        domain: { low: 0.01, high: 0.03 },
      });
    });
    const before = result.current.viewerInteraction;
    const model = result.current.scanModel;
    const reads = api.calls().length;

    act(() => {
      result.current.dispatchRoster({
        type: "rowPressed",
        handle: VENDOR_ROW.handle,
        modifiers: { ctrl: false, shift: false },
      });
    });

    expect(result.current.viewerInteraction).toBe(before);
    expect(result.current.scanModel).toBe(model);
    expect(result.current.selectedIndex).toBe(2);
    expect(result.current.chromatogramTraces).toEqual({ tic: true, bpc: false });
    expect(api.calls()).toHaveLength(reads);
  });
});

describe("stepping through scans", () => {
  it("walks the order the table shows and commits through the same operation", async () => {
    const { result, api } = mount();
    await openThePreview(result);
    await select(result, 2);
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    await act(async () => {
      result.current.selectNextScan();
      await Promise.resolve();
    });
    expect(result.current.selectedIndex).toBe(3);
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    await act(async () => {
      result.current.selectPreviousScan();
      await Promise.resolve();
    });
    expect(result.current.selectedIndex).toBe(2);
    expect(api.requestedSpectra).toEqual([2, 3, 2]);
  });

  it("offers no neighbour at either end of the loaded table", async () => {
    const { result } = mount();
    await openThePreview(result);

    await select(result, 0);
    expect(result.current.canSelectPreviousScan).toBe(false);
    expect(result.current.canSelectNextScan).toBe(true);

    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    await select(result, 5);
    expect(result.current.canSelectPreviousScan).toBe(true);
    expect(result.current.canSelectNextScan).toBe(false);
  });

  it("guesses no neighbour while nothing is selected", async () => {
    const { result, api } = mount();
    await openThePreview(result);

    expect(result.current.canSelectPreviousScan).toBe(false);
    expect(result.current.canSelectNextScan).toBe(false);
    await act(async () => {
      result.current.selectNextScan();
      await Promise.resolve();
    });

    expect(result.current.selectedIndex).toBeNull();
    expect(api.requestedSpectra).toEqual([]);
  });
});

describe("trace visibility", () => {
  it("starts on the total ion current and toggles each trace on its own", async () => {
    const { result } = mount();
    await openThePreview(result);

    expect(result.current.chromatogramTraces).toEqual({ tic: true, bpc: false });

    act(() => {
      result.current.toggleChromatogramTrace("bpc");
    });
    expect(result.current.chromatogramTraces).toEqual({ tic: true, bpc: true });

    act(() => {
      result.current.toggleChromatogramTrace("tic");
    });
    expect(result.current.chromatogramTraces).toEqual({ tic: false, bpc: true });
  });
});

/*
 * A control that advertises availability has to tell the truth.
 *
 * `Previous scan` and `Next scan` were the first viewer controls to compute a
 * `disabled` state, and they computed it from adjacency alone -- so while a
 * conversion queue owned the backend lane they stayed enabled and did nothing,
 * for as long as the queue ran. What they were missing is the same rule
 * `selectSpectrum` guards itself with, and the repair is that both now read it
 * from one place.
 *
 * The matrix below pins both directions. Under-gating is the finding; the case
 * that pins over-gating is the one at the end, and it is load-bearing.
 */
describe("the global spectrum-selection lane", () => {
  const FREE = {
    hasLoadedPreview: true,
    backendUsable: true,
    backendBusy: false,
    conversionBusy: false,
  } as const;

  it("is available with a loaded run, a usable backend and both lanes free", () => {
    expect(canStartSpectrumSelection(FREE)).toBe(true);
  });

  it("is unavailable for each thing that stops a selection reaching its target", () => {
    const blockers = [
      { name: "no loaded run", lane: { ...FREE, hasLoadedPreview: false } },
      { name: "backend not usable", lane: { ...FREE, backendUsable: false } },
      { name: "backend lane busy", lane: { ...FREE, backendBusy: true } },
      { name: "conversion lane busy", lane: { ...FREE, conversionBusy: true } },
    ];

    for (const blocker of blockers) {
      expect(canStartSpectrumSelection(blocker.lane), blocker.name).toBe(false);
    }
  });
});

describe("what a scan step says it can do", () => {
  it("offers both steps, and takes them, while the lane is free", async () => {
    const { result, api } = mount();
    await openThePreview(result);
    await select(result, 2);
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    expect(result.current.spectrumSelectionAvailable).toBe(true);
    expect(result.current.canSelectPreviousScan).toBe(true);
    expect(result.current.canSelectNextScan).toBe(true);

    await act(async () => {
      result.current.selectNextScan();
      await Promise.resolve();
    });

    expect(result.current.selectedIndex).toBe(3);
    expect(api.requestedSpectra).toEqual([2, 3]);
  });

  it("takes both steps back off while an installation check owns the backend lane", async () => {
    const backend = decidedBackend([]);
    const { result, api } = mount({ availability: backend.availability });
    await openThePreview(result);
    await select(result, 2);
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    const revision = result.current.viewerInteraction.selection?.revision ?? 0;

    act(() => {
      result.current.checkBackend();
    });
    await waitFor(() => {
      expect(result.current.backendBusy).toBe(true);
    });

    expect(result.current.spectrumSelectionAvailable).toBe(false);
    expect(result.current.canSelectPreviousScan).toBe(false);
    expect(result.current.canSelectNextScan).toBe(false);
    // And the operation refuses too, so the disabled state is a report of the
    // guard rather than the safety boundary itself.
    await act(async () => {
      result.current.selectNextScan();
      result.current.selectSpectrum(3);
      await Promise.resolve();
    });
    expect(result.current.viewerInteraction.selection?.revision).toBe(revision);
    expect(api.requestedSpectra).toEqual([2]);

    await act(async () => {
      backend.pending[0]?.resolve(availableBackend);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.canSelectNextScan).toBe(true);
    });
  });

  it("takes both steps back off for as long as a conversion queue runs", async () => {
    // The state the finding was about. A queue is not a momentary race: it owns
    // the one backend lane for as long as it takes to convert an acquisition,
    // and a button that stayed enabled through that did nothing every time it
    // was pressed.
    const { result, api } = mount({ conversion: RUNNING_QUEUE });
    await openThePreview(result);
    await select(result, 2);
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    const revision = result.current.viewerInteraction.selection?.revision ?? 0;

    act(() => {
      result.current.conversion.convert([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(result.current.conversion.busy).toBe(true);
    });

    expect(result.current.spectrumSelectionAvailable).toBe(false);
    expect(result.current.canSelectPreviousScan).toBe(false);
    expect(result.current.canSelectNextScan).toBe(false);
    await act(async () => {
      result.current.selectNextScan();
      result.current.selectSpectrum(3);
      await Promise.resolve();
    });
    expect(result.current.viewerInteraction.selection?.revision).toBe(revision);
    expect(api.requestedSpectra).toEqual([2]);
    // The run it is a viewer of is untouched: the queue took the lane, not the
    // preview.
    expect(result.current.preview.status).toBe("loaded");
    expect(result.current.selectedIndex).toBe(2);
  });

  it("takes both steps back off once the backend is resolved unavailable", async () => {
    const backend = decidedBackend([unavailableBackend]);
    const { result, api } = mount({ availability: backend.availability });
    await openThePreview(result);
    await select(result, 2);
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    const revision = result.current.viewerInteraction.selection?.revision ?? 0;

    act(() => {
      result.current.checkBackend();
    });
    await waitFor(() => {
      expect(result.current.backendBusy).toBe(false);
    });

    // The table stays on screen -- nothing about the reading became untrue --
    // so there is still something to step through, and the steps still have to
    // say they cannot.
    expect(result.current.preview.status).toBe("loaded");
    expect(result.current.spectrumSelectionAvailable).toBe(false);
    expect(result.current.canSelectPreviousScan).toBe(false);
    expect(result.current.canSelectNextScan).toBe(false);
    await act(async () => {
      result.current.selectNextScan();
      result.current.selectSpectrum(3);
      await Promise.resolve();
    });
    expect(result.current.viewerInteraction.selection?.revision).toBe(revision);
    expect(api.requestedSpectra).toEqual([2]);
  });

  it("still refuses a step the table has no row for, with the lane free", async () => {
    const { result } = mount();
    await openThePreview(result);

    await select(result, 0);
    expect(result.current.spectrumSelectionAvailable).toBe(true);
    expect(result.current.canSelectPreviousScan).toBe(false);
    expect(result.current.canSelectNextScan).toBe(true);

    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    await select(result, 5);
    expect(result.current.canSelectPreviousScan).toBe(true);
    expect(result.current.canSelectNextScan).toBe(false);
  });

  it("keeps stepping to a different scan while an earlier read is unresolved", async () => {
    /*
     * Load-bearing, and the reason this is not `canPreview`.
     *
     * `canPreview` includes `previewBackendBusy`, which is true from the moment
     * a selected-spectrum read starts until it settles. But a selection of a
     * *different* scan is allowed to supersede an unresolved one -- that is what
     * `spectrumToken` is for, and the A -> B contract this milestone tests
     * elsewhere. Gating a scan step on it would take away a step the operation
     * would have accepted, and would do it during the very window in which a
     * user who picked the wrong scan is most likely to reach for it.
     */
    const replies = [
      deferred<SelectedSpectrumOutcome>(),
      deferred<SelectedSpectrumOutcome>(),
    ];
    let asked = 0;
    const { result, api } = mount({
      spectrum: () => {
        const reply = replies[asked];
        asked += 1;
        return reply?.promise ?? Promise.reject(new Error("one reply per selection"));
      },
    });
    await openThePreview(result);
    await select(result, 2);

    // A is out there and unresolved, so the broad preview lane reports busy.
    expect(result.current.previewBackendBusy).toBe(true);
    expect(result.current.spectrum.status).toBe("loading");
    // The scan lane does not, because a different scan may still supersede it.
    expect(result.current.spectrumSelectionAvailable).toBe(true);
    expect(result.current.canSelectNextScan).toBe(true);
    const first = result.current.viewerInteraction.selection?.revision ?? 0;

    await act(async () => {
      result.current.selectNextScan();
      await Promise.resolve();
    });

    expect(result.current.selectedIndex).toBe(3);
    expect(result.current.viewerInteraction.selection?.revision).toBeGreaterThan(first);
    expect(api.requestedSpectra).toEqual([2, 3]);

    // B settles and is shown; A settles afterwards and cannot take it back.
    await act(async () => {
      replies[1]?.resolve({ outcome: "spectrum", spectrum: buildSpectrum(3, 6) });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    await act(async () => {
      replies[0]?.resolve({ outcome: "spectrum", spectrum: buildSpectrum(2, 6) });
      await Promise.resolve();
    });

    expect(result.current.selectedIndex).toBe(3);
    expect(
      result.current.spectrum.status === "loaded"
        ? result.current.spectrum.spectrum.index
        : null,
    ).toBe(3);
  });
});
