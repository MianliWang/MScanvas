/**
 * What the m/z viewport is bound to, and what a late answer may never become.
 *
 * The visible adapter is tested next door; this is about the wiring behind it,
 * where the two failures that matter are invisible in a single-spectrum test.
 *
 * The first is **which spectrum a drawing belongs to.** A projection request is
 * one round trip, and a reader who selects another row before it lands has two
 * answers in flight for one panel. If the second could be satisfied by the
 * first's reply, spectrum A's measurements would be drawn under spectrum B's
 * axes -- silently, and more often the slower the machine. ADR 0038 answers that
 * with two counters that are monotonic across the *session*, and the whole point
 * of holding the reducer in the workspace rather than in the panel is that the
 * panel's plot unmounts on every selection while the counters must not restart.
 *
 * The second is **how often Rust is asked at all.** A committed window is one
 * request; a gesture is none; a redelivery of the same spectrum is none. A
 * viewport that asked per frame, or per re-render, would turn scrolling a
 * spectrum into a stream of backend work -- which is the reason `projectionWindow`
 * names the committed window and not the rendered one.
 *
 * Both are asserted through the request ledger the fake keeps, because "this
 * interaction crossed the boundary zero times" cannot be established by looking
 * at what is on screen.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider, type PreviewApi } from "./api";
import type { SelectedSpectrum, SpectrumProjection } from "./contracts";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import { mzDomain, renderedMzDomain } from "./viewer/spectrumViewport";
import {
  buildSpectrum,
  createFakePreviewApi,
  deferred,
  previewError,
  selectedFile,
} from "../../test/previewFixtures";

function wrapper(api: PreviewApi) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <PreviewApiProvider value={api}>{children}</PreviewApiProvider>;
  };
}

/** A drawing of exactly the window it was asked for, with `points` sticks. */
function drawing(low: number, high: number, points: number): SpectrumProjection {
  const mz: number[] = [];
  const intensity: number[] = [];
  for (let index = 0; index < points; index += 1) {
    mz.push(low + ((high - low) * index) / Math.max(1, points - 1));
    intensity.push(100 + index);
  }
  return { low, high, mz, intensity, sourcePoints: points, reduced: false };
}

/**
 * A workspace with one mzML in it, read, and nothing selected yet.
 *
 * The fake's roster starts empty, so the dataset is stated rather than assumed:
 * a suite that opened a preview for a file the roster did not hold would be
 * testing the recovery path by accident.
 */
async function openTheWorkspace(
  options: Parameters<typeof createFakePreviewApi>[0] = {},
): Promise<{
  readonly api: ReturnType<typeof createFakePreviewApi>;
  readonly rendered: ReturnType<typeof renderHook<ReturnType<typeof usePreviewWorkspace>, unknown>>;
}> {
  const api = createFakePreviewApi({
    initialDatasets: [{ file: selectedFile, parents: [] }],
    ...options,
  });
  const rendered = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
  await waitFor(() => {
    expect(rendered.result.current.roster.datasets.length).toBeGreaterThan(0);
  });
  act(() => {
    rendered.result.current.activateDataset(selectedFile.handle);
  });
  await waitFor(() => {
    expect(rendered.result.current.preview.status).toBe("loaded");
  });
  return { api, rendered };
}

async function selectAndSettle(
  rendered: Awaited<ReturnType<typeof openTheWorkspace>>["rendered"],
  index: number,
): Promise<void> {
  act(() => {
    rendered.result.current.selectSpectrum(index);
  });
  await waitFor(() => {
    expect(rendered.result.current.spectrum.status).toBe("loaded");
  });
}

describe("what a spectrum viewport is bound to", () => {
  it("opens at the spectrum's own admitted domain and asks for that window once", async () => {
    const { api, rendered } = await openTheWorkspace();
    await selectAndSettle(rendered, 2);

    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(1);
    });
    // The full domain Rust admitted, sent with the token that names the
    // retained spectrum. Nothing here was derived from the transferred arrays.
    expect(api.spectrumProjectionRequests[0]).toEqual({
      exportToken: "token-2",
      low: 300,
      high: 305.5,
    });
    expect(renderedMzDomain(rendered.result.current.spectrumViewport)).toEqual({
      low: 300,
      high: 305.5,
    });
  });

  it("asks for nothing at all where the domain is refused", async () => {
    const { api, rendered } = await openTheWorkspace({
      spectrum: (index) =>
        Promise.resolve({
          outcome: "spectrum" as const,
          spectrum: {
            ...buildSpectrum(index, 4),
            viewportDomain: { state: "refused", reason: "sourceNotOrdered" },
          } satisfies SelectedSpectrum,
        }),
    });
    await selectAndSettle(rendered, 1);

    expect(rendered.result.current.spectrumViewport.status).toBe("refused");
    // A refusal is a fact about drawability, so there is nothing to draw and
    // nothing to ask for. The spectrum itself is untouched and still loaded.
    expect(api.spectrumProjectionRequests).toEqual([]);
    expect(rendered.result.current.spectrum.status).toBe("loaded");
  });

  it("asks for nothing for a spectrum that reports no points", async () => {
    const { api, rendered } = await openTheWorkspace({
      spectrum: (index) =>
        Promise.resolve({ outcome: "spectrum" as const, spectrum: buildSpectrum(index, 0) }),
    });
    await selectAndSettle(rendered, 1);

    // Its domain is admitted and zero wide. There is no range to navigate and
    // no drawing worth a round trip, and the panel already says it has no peaks.
    expect(api.spectrumProjectionRequests).toEqual([]);
  });

  it("does not ask again when the same spectrum is redelivered", async () => {
    const { api, rendered } = await openTheWorkspace();
    await selectAndSettle(rendered, 2);
    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(1);
    });

    // The same row again. `selectSpectrum` drops a repeat of the row already
    // being read, and even a redelivery of the same token resets nothing -- so
    // neither route produces a second drawing request.
    act(() => {
      rendered.result.current.selectSpectrum(2);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.spectrumProjectionRequests).toHaveLength(1);
  });
});

describe("a drawing that is no longer current", () => {
  it("discards a late answer for the spectrum that has been replaced", async () => {
    const slow = deferred<SpectrumProjection>();
    let call = 0;
    const { api, rendered } = await openTheWorkspace({
      spectrumProjection: (_token, low, high) => {
        call += 1;
        return call === 1 ? slow.promise : Promise.resolve(drawing(low, high, 3));
      },
    });
    await selectAndSettle(rendered, 1);
    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(1);
    });

    // A different spectrum is selected while the first drawing is outstanding.
    // Its own domain is disjoint from the first's only in identity here, which
    // is the point: what tells the two apart is the generation, not the numbers.
    await selectAndSettle(rendered, 4);
    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(2);
    });
    const current = rendered.result.current.spectrumViewport;
    expect(current.status === "ready" ? current.spectrumToken : null).toBe("token-4");

    // The first spectrum's answer arrives now. It replaces nothing: the reducer
    // refuses it by generation, so spectrum 1's measurements never appear under
    // spectrum 4's axes.
    await act(async () => {
      slow.resolve(drawing(300, 302.5, 99));
      await slow.promise;
    });

    const after = rendered.result.current.spectrumViewport;
    const projection = after.status === "ready" ? after.projection : null;
    expect(projection?.status).toBe("ready");
    expect(projection?.status === "ready" ? projection.projection.sourcePoints : null).toBe(3);
  });

  it("discards a late failure for the spectrum that has been replaced", async () => {
    const slow = deferred<SpectrumProjection>();
    let call = 0;
    const { api, rendered } = await openTheWorkspace({
      spectrumProjection: (_token, low, high) => {
        call += 1;
        return call === 1 ? slow.promise : Promise.resolve(drawing(low, high, 3));
      },
    });
    await selectAndSettle(rendered, 1);
    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(1);
    });
    await selectAndSettle(rendered, 4);
    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(2);
    });

    await act(async () => {
      slow.reject(previewError({ kind: "spectrum_projection_stale", retryable: true }));
      await slow.promise.catch(() => undefined);
    });

    // A stale failure surfaces nothing. The current spectrum's drawing stands,
    // and no error is shown beside it.
    const after = rendered.result.current.spectrumViewport;
    expect(after.status === "ready" ? after.projection.status : null).toBe("ready");
    expect(rendered.result.current.spectrumProjectionError).toBeNull();
  });

  it("keeps only the second of two commits made before the first answer", async () => {
    const answers: { resolve: (value: SpectrumProjection) => void }[] = [];
    const { api, rendered } = await openTheWorkspace({
      spectrumProjection: () => {
        const pending = deferred<SpectrumProjection>();
        answers.push(pending);
        return pending.promise;
      },
    });
    await selectAndSettle(rendered, 2);
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });

    // Two committed windows before anything comes back.
    act(() => {
      rendered.result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(301, 304),
      });
    });
    await waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    act(() => {
      rendered.result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(302, 303),
      });
    });
    await waitFor(() => {
      expect(answers).toHaveLength(3);
    });
    expect(api.spectrumProjectionRequests.map((request) => request.low)).toEqual([300, 301, 302]);

    // The first two answer last, and neither is current any more.
    await act(async () => {
      answers[0]?.resolve(drawing(300, 305.5, 11));
      answers[1]?.resolve(drawing(301, 304, 22));
      await Promise.resolve();
    });
    let after = rendered.result.current.spectrumViewport;
    expect(after.status === "ready" ? after.projection.status : null).toBe("loading");

    await act(async () => {
      answers[2]?.resolve(drawing(302, 303, 33));
      await Promise.resolve();
    });
    after = rendered.result.current.spectrumViewport;
    const projection = after.status === "ready" ? after.projection : null;
    expect(projection?.status === "ready" ? projection.projection.sourcePoints : null).toBe(33);
  });
});

describe("recovering from a drawing that failed", () => {
  it("retries the same window under a new generation, and moves nothing", async () => {
    let call = 0;
    const { api, rendered } = await openTheWorkspace({
      spectrumProjection: (_token, low, high) => {
        call += 1;
        return call === 1
          ? Promise.reject(previewError({ kind: "preview_worker_unavailable", retryable: true }))
          : Promise.resolve(drawing(low, high, 5));
      },
    });
    await selectAndSettle(rendered, 2);
    await waitFor(() => {
      const state = rendered.result.current.spectrumViewport;
      expect(state.status === "ready" ? state.projection.status : null).toBe("failed");
    });
    // The committed window is kept, and the message is the one that failure
    // carried rather than a sentence this side invented for it.
    expect(renderedMzDomain(rendered.result.current.spectrumViewport)).toEqual({
      low: 300,
      high: 305.5,
    });
    expect(rendered.result.current.spectrumProjectionError?.retryable).toBe(true);

    act(() => {
      rendered.result.current.retrySpectrumProjection();
    });
    await waitFor(() => {
      const state = rendered.result.current.spectrumViewport;
      expect(state.status === "ready" ? state.projection.status : null).toBe("ready");
    });

    // The same spectrum and the same window, asked again. Nothing about the
    // viewport moved to make the retry possible.
    expect(api.spectrumProjectionRequests).toEqual([
      { exportToken: "token-2", low: 300, high: 305.5 },
      { exportToken: "token-2", low: 300, high: 305.5 },
    ]);
    expect(rendered.result.current.spectrumProjectionError).toBeNull();
  });

  it("does not turn a refused window into a reason to re-probe the backend", async () => {
    const { api, rendered } = await openTheWorkspace({
      spectrumProjection: () =>
        Promise.reject(
          previewError({ kind: "spectrum_projection_window_refused", retryable: false }),
        ),
    });
    const before = api.calls().filter((command) => command === "inspect_backend").length;
    await selectAndSettle(rendered, 2);
    await waitFor(() => {
      const state = rendered.result.current.spectrumViewport;
      expect(state.status === "ready" ? state.projection.status : null).toBe("failed");
    });

    // A window this spectrum does not have says nothing about the installation.
    // The spectrum load's own non-retryable path re-checks the backend; a
    // drawing's must not, or moving a viewport would re-probe ProteoWizard.
    expect(api.calls().filter((command) => command === "inspect_backend")).toHaveLength(before);
    expect(rendered.result.current.spectrumProjectionError?.retryable).toBe(false);
  });
});

describe("what the viewport never touches", () => {
  it("leaves the spectrum's own export untouched by a committed window", async () => {
    const { api, rendered } = await openTheWorkspace();
    await selectAndSettle(rendered, 2);
    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(1);
    });

    act(() => {
      rendered.result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(302, 303),
      });
    });
    await waitFor(() => {
      expect(api.spectrumProjectionRequests).toHaveLength(2);
    });

    act(() => {
      rendered.result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });

    // The export sends a token and a format. There is no range in it, and M5.3
    // is where one would appear -- a committed viewport changed nothing about
    // what a full-source document is taken from.
    expect(api.spectrumExportRequests[0]?.exportToken).toBe("token-2");
    expect(Object.keys(api.spectrumExportRequests[0] ?? {}).sort()).toEqual([
      "exportToken",
      "format",
      "settings",
    ]);
  });

  it("clears the viewport when the preview it belonged to is replaced", async () => {
    const second = { ...selectedFile, handle: "file-2", fileName: "second.mzML" };
    const { api, rendered } = await openTheWorkspace({
      initialDatasets: [
        { file: selectedFile, parents: [] },
        { file: second, parents: [] },
      ],
    });
    await selectAndSettle(rendered, 2);
    await waitFor(() => {
      expect(rendered.result.current.spectrumViewport.status).toBe("ready");
    });
    const requests = api.spectrumProjectionRequests.length;

    // Reading another file replaces the preview, and with it the selection the
    // viewport belonged to.
    act(() => {
      rendered.result.current.activateDataset(second.handle);
    });
    await waitFor(() => {
      expect(rendered.result.current.spectrumViewport.status).toBe("none");
    });

    // Nothing is drawn for a spectrum that is no longer selected, and nothing
    // is asked for on the way out. The counters carried across, which is what
    // makes the previous spectrum's outstanding answer unmatchable here.
    expect(api.spectrumProjectionRequests).toHaveLength(requests);
    expect(renderedMzDomain(rendered.result.current.spectrumViewport)).toBeNull();
    expect(rendered.result.current.spectrumViewport.nextGeneration).toBeGreaterThan(1);
  });
});
