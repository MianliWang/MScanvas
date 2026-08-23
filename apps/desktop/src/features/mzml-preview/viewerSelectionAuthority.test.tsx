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
import type { Preview, SelectedSpectrumOutcome } from "./contracts";
import type { WorkspaceDropTransport } from "./dropTransport";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import { activeGestureEpoch, renderedDomain } from "./viewer/interactionState";
import {
  buildPreview,
  buildRows,
  buildSpectrum,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  previewError,
  secondFile,
  selectedFile,
  shimadzuDataset,
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
  } = {},
) {
  const api = createFakePreviewApi({
    initialDatasets: [selectedFile, VENDOR_ROW],
    preview: options.preview ?? buildPreview(6),
    ...(options.spectrum === undefined ? {} : { spectrum: options.spectrum }),
  });
  const rendered = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
  return { api, ...rendered };
}

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
