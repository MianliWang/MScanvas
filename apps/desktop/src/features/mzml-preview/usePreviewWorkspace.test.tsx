import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type {
  BackendAvailability,
  FolderIngestionResult,
  Preview,
  SelectedSpectrumOutcome,
  WorkspaceAddResult,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "./contracts";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import type { FolderScan } from "../../test/previewFixtures";
import {
  COMPLETE_SCAN,
  FAKE_WORKSPACE_CAPACITY,
  buildPreview,
  createFakePreviewApi,
  deferred,
  previewError,
  secondFile,
  selectedFile,
  unavailableBackend,
} from "../../test/previewFixtures";

/**
 * A stand-in that models the service's ordering semantics rather than fixed
 * replies.
 *
 * The rule under test is about which of two in-flight replies describes the
 * installation Rust is actually using, so the fake has to have an installation
 * and a generation of its own: a change advances the generation and switches
 * the installation, an inspection reports whichever is current without
 * advancing anything. A fake that returned canned verdicts could not tell a
 * correct ordering from an incorrect one.
 *
 * Every reply is deferred, so a test decides the settle order — which is the
 * whole variable here, and the one thing real timing will not reproduce.
 */
class ServiceModel {
  private generation = 0;
  private chosen = false;
  /**
   * Every request handed out, in the order it was made.
   *
   * `serve` and `deliver` are separate on purpose. In the real application a
   * command runs to completion inside the service's mutex — that is when a
   * change takes effect and when a verdict's generation is read — and only
   * afterwards does the reply travel back through Tauri. Collapsing the two
   * would make the fake agree with whatever order a test chose, and the whole
   * defect being tested lives in the gap between them.
   */
  readonly pending: {
    serve: () => void;
    deliver: () => void;
    reject: (cause: unknown) => void;
  }[] = [];
  inspections = 0;

  private verdict(): BackendAvailability {
    return {
      state: this.state(),
      origin: this.chosen ? "chosen" : "automatic",
      installationGeneration: this.generation,
      release: this.chosen ? "3.0.26013" : "3.0.25000",
      buildDate: "2026-07-01",
      sameInstallation: true,
      failure: null,
    };
  }

  private request(
    underTheGate: () => BackendAvailability | null,
  ): Promise<BackendAvailability | null> {
    const reply = deferred<BackendAvailability | null>();
    let served: { value: BackendAvailability | null } | null = null;
    const serve = () => {
      if (served === null) {
        served = { value: underTheGate() };
      }
    };
    this.pending.push({
      serve,
      deliver: () => {
        serve();
        reply.resolve(served?.value ?? null);
      },
      reject: (cause: unknown) => {
        reply.reject(cause);
      },
    });
    return reply.promise;
  }

  inspectBackend(): Promise<BackendAvailability> {
    this.inspections += 1;
    return this.request(() => this.verdict()) as Promise<BackendAvailability>;
  }

  chooseInstallation(dismissed = false): Promise<BackendAvailability | null> {
    return this.request(() => {
      if (dismissed) {
        return null;
      }
      this.generation += 1;
      this.chosen = true;
      return this.verdict();
    });
  }

  useAutomaticDiscovery(): Promise<BackendAvailability> {
    return this.request(() => {
      this.generation += 1;
      this.chosen = false;
      return this.verdict();
    }) as Promise<BackendAvailability>;
  }

  /// Moves the sequence on without switching what resolves, for the case where
  /// something other than a verdict -- an open -- was the observation that
  /// advanced it.
  advanceTo(generation: number): void {
    this.generation = generation;
  }

  /** What the service would report if asked now, with nothing in flight. */
  currentOrigin(): "automatic" | "chosen" {
    return this.chosen ? "chosen" : "automatic";
  }

  currentGeneration(): number {
    return this.generation;
  }

  /**
   * The installation stops working without MSCanvas changing anything.
   *
   * The generation counts changes MSCanvas made, not events on disk, so an
   * installation that is deleted or moved underneath it yields two different
   * readings of the same generation. That is what makes the equal-generation
   * case observable, and it is a real thing users do.
   */
  private vanished = false;

  installationVanished(): void {
    this.vanished = true;
  }

  private state(): "available" | "unavailable" {
    return this.vanished ? "unavailable" : "available";
  }
}

interface Harness {
  readonly service: ServiceModel;
  readonly api: PreviewApi;
  /** Runs one request inside the service's gate without replying yet. */
  serve(index: number): Promise<void>;
  /** Replies to one request, serving it first if it has not been served. */
  deliver(index: number): Promise<void>;
  rejectAt(index: number, cause: unknown): Promise<void>;
}

function harness(
  options: {
    dismissPicker?: boolean;
    preview?: () => Promise<Preview>;
    /// What the service had advanced the sequence to by the time this open was
    /// served -- which an open that noticed a change itself would have done.
    openGeneration?: number;
    spectrum?: () => Promise<SelectedSpectrumOutcome>;
  } = {},
): Harness {
  const service = new ServiceModel();
  // Only the installation commands are deferred: they are what this file is
  // about. The workspace commands answer at once, and honestly — one row after
  // the picker, none after a clear — so the ordering under test is the
  // installation ordering and not an artefact of a roster that never settles.
  const empty: WorkspaceRoster = { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY };
  const api: PreviewApi = {
    inspectBackend: () => service.inspectBackend(),
    chooseInstallation: () => service.chooseInstallation(options.dismissPicker ?? false),
    useAutomaticDiscovery: () => service.useAutomaticDiscovery(),
    getRoster: () => Promise.resolve(empty),
    chooseFiles: () =>
      Promise.resolve<WorkspaceAddResult | null>({
        roster: { datasets: [selectedFile], capacity: FAKE_WORKSPACE_CAPACITY },
        outcomes: [{ outcome: "added", dataset: selectedFile }],
      }),
    // Stated rather than defaulted, so a test in this file that ever reaches
    // for a folder has to say what it expects rather than silently receiving a
    // dismissed picker. Nothing here does: this file is about the installation
    // ordering, and a folder import touches none of it.
    chooseFolder: () =>
      Promise.reject(new Error("this harness has no folder picker")),
    removeDatasets: (handles) =>
      Promise.resolve<WorkspaceRemoveResult>({
        roster: empty,
        removedHandles: [...handles],
        unknownHandles: [],
      }),
    clearWorkspace: () => Promise.resolve(empty),
    openPreview:
      options.preview ?? (() => Promise.resolve(buildPreview(3, false, options.openGeneration ?? 0))),
    loadSpectrum: () =>
      options.spectrum?.() ??
      Promise.resolve<SelectedSpectrumOutcome>({ outcome: "unavailable", requestedIndex: 0 }),
  };
  return {
    service,
    api,
    serve: async (index) => {
      await act(async () => {
        service.pending[index]?.serve();
        await Promise.resolve();
      });
    },
    deliver: async (index) => {
      await act(async () => {
        service.pending[index]?.deliver();
        await Promise.resolve();
      });
    },
    rejectAt: async (index, cause) => {
      await act(async () => {
        service.pending[index]?.reject(cause);
        await Promise.resolve();
      });
    },
  };
}

function wrapper(api: PreviewApi) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(PreviewApiProvider, { value: api }, children);
  };
}

function resolvedOrigin(backend: ReturnType<typeof usePreviewWorkspace>["backend"]): string {
  return backend.status === "resolved" ? backend.availability.origin : backend.status;
}

function resolvedGeneration(backend: ReturnType<typeof usePreviewWorkspace>["backend"]): number {
  return backend.status === "resolved" ? backend.availability.installationGeneration : -1;
}


describe("backend installation generations", () => {
  it("accepts a newer service generation whose reply a later request superseded", async () => {
    // The defect this replaces. A recovery check begun while the folder dialog
    // is open advances the frontend token, so ordering by token alone throws
    // away the one reply that describes the installation Rust switched to.
    const h = harness();
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0); // the mount check
    expect(resolvedOrigin(result.current.backend)).toBe("automatic");

    act(() => {
      result.current.chooseInstallation();
    }); // request 1, frontend token N
    act(() => {
      result.current.checkBackend();
    }); // request 2, frontend token N+1

    // The check runs and replies first, while the dialog is still open, so it
    // reports the installation that is about to be replaced.
    await h.deliver(2);
    expect(resolvedGeneration(result.current.backend)).toBe(0);
    expect(resolvedOrigin(result.current.backend)).toBe("automatic");

    // Then the change runs and replies. Its frontend token is the older one.
    await h.deliver(1);

    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });
    expect(resolvedGeneration(result.current.backend)).toBe(1);
    // What the banner says is what the service would say if asked again.
    expect(h.service.currentOrigin()).toBe("chosen");
    expect(h.service.currentGeneration()).toBe(1);
    // The readings the replaced installation produced are gone with it.
    expect(result.current.preview.status).toBe("empty");
  });

  it("refuses a reply served before an installation change that has already been applied", async () => {
    const h = harness();
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.checkBackend();
    }); // request 1
    // Served now, so it holds the pre-change generation, but not yet delivered.
    await h.serve(1);

    act(() => {
      result.current.chooseInstallation();
    }); // request 2
    await h.deliver(2);
    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });

    // The older reading arrives last. It describes an installation that has
    // since been replaced, and must not be shown.
    await h.deliver(1);

    expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    expect(resolvedGeneration(result.current.backend)).toBe(1);
  });

  it("drops a superseded reading of the same installation", async () => {
    // Two readings of one installation differ only in age, so the token still
    // decides between them. The generation counts changes MSCanvas made, so a
    // backend that disappears from disk gives two different answers under one
    // generation -- which is what makes the rule observable.
    const h = harness();
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.checkBackend();
    }); // request 1, token N
    await h.serve(1); // still available

    h.service.installationVanished();
    act(() => {
      result.current.checkBackend();
    }); // request 2, token N+1
    await h.deliver(2); // reports unavailable, same generation

    await waitFor(() => {
      expect(result.current.backend.status).toBe("resolved");
    });
    expect(
      result.current.backend.status === "resolved" && result.current.backend.availability.state,
    ).toBe("unavailable");

    // The superseded reading arrives after and must not reinstate itself.
    await h.deliver(1);

    expect(
      result.current.backend.status === "resolved" && result.current.backend.availability.state,
    ).toBe("unavailable");
    expect(resolvedGeneration(result.current.backend)).toBe(0);
  });

  it("does not let a recovery check race an installation change", async () => {
    // A failed open starts a recovery check that is not a user action, so it
    // passes straight through the busy guard. It is the one thing that can
    // race a change, and a change is already producing a fresh verdict.
    const open = deferred<Preview>();
    const h = harness({ preview: () => open.promise });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);
    const inspectionsBefore = h.service.inspections;

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("opening");
    });

    act(() => {
      result.current.chooseInstallation();
    });
    await act(async () => {
      open.reject(previewError({ kind: "backend_failed" }));
      await Promise.resolve();
    });

    // Deferred, not started: no second reading was requested.
    expect(h.service.inspections).toBe(inspectionsBefore);

    await h.deliver(1);
    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });
    // And dropped rather than run, because the change refreshed the banner.
    expect(h.service.inspections).toBe(inspectionsBefore);
  });

  it("runs the deferred recovery check when the picker was dismissed", async () => {
    // A dismissed picker is the one outcome that leaves the banner exactly as
    // stale as the failed open found it, so the check it deferred still has
    // something to learn.
    const open = deferred<Preview>();
    const h = harness({ dismissPicker: true, preview: () => open.promise });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);
    const inspectionsBefore = h.service.inspections;

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("opening");
    });
    act(() => {
      result.current.chooseInstallation();
    });
    await act(async () => {
      open.reject(previewError({ kind: "backend_failed" }));
      await Promise.resolve();
    });
    expect(h.service.inspections).toBe(inspectionsBefore);

    await h.deliver(1); // the picker is dismissed, so nothing changed

    await waitFor(() => {
      expect(h.service.inspections).toBe(inspectionsBefore + 1);
    });
  });
});

describe("discarding what a replaced installation read", () => {
  it("does not let a spectrum recovery race an installation change either", async () => {
    // The recovery a failed spectrum starts is not a user action, so it passes
    // straight through the busy guard exactly as the one after a failed open
    // does -- and clearing that guard early would re-enable Open and the switch
    // actions while a folder picker is still on screen.
    // The selection is started first and fails later, which is the order that
    // is reachable: a row cannot be started once a change is outstanding,
    // because selection is backend work and the busy guard covers it.
    const spectrum = deferred<SelectedSpectrumOutcome>();
    const h = harness({ spectrum: () => spectrum.promise });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("loaded");
    });
    const inspectionsBefore = h.service.inspections;

    act(() => {
      result.current.selectSpectrum(0);
    });
    act(() => {
      result.current.chooseInstallation();
    });
    await act(async () => {
      spectrum.reject(
        previewError({ kind: "installation_changed_since_preview", retryable: false }),
      );
      await Promise.resolve();
    });
    // The recovery discards what the replaced backend read, which is the
    // observable effect to wait on -- it also resets the spectrum, so the
    // failure state it passes through is not where to look.
    await waitFor(() => {
      expect(result.current.preview.status).toBe("empty");
    });

    // Deferred, not started.
    expect(h.service.inspections).toBe(inspectionsBefore);
  });

  it("does not let a successful open's refresh race an installation change", async () => {
    // An open that is the first to see a change refreshes the banner. Started
    // while a picker is still open, that refresh can clear the busy guard from
    // under it -- and a chooser reply arriving afterwards would be refused on
    // token order, leaving Rust on the chosen folder and the banner saying
    // automatic.
    const open = deferred<Preview>();
    const h = harness({ preview: () => open.promise });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);
    const inspectionsBefore = h.service.inspections;

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("opening");
    });
    act(() => {
      result.current.chooseInstallation();
    });

    // The open lands first, carrying a generation nothing has seen yet.
    await act(async () => {
      open.resolve(buildPreview(3, false, 1));
      await Promise.resolve();
    });

    expect(result.current.preview.status).toBe("loaded");
    expect(h.service.inspections).toBe(inspectionsBefore);
  });

  it("drops an open failure that belongs to a replaced backend", async () => {
    // The failure says nothing about the installation now in use, and showing
    // it under the new banner strands the user: a non-retryable failure leaves
    // the loaded layout with no way back to the retained file.
    const open = deferred<Preview>();
    const h = harness({ preview: () => open.promise });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("opening");
    });

    act(() => {
      result.current.chooseInstallation();
    });
    await h.deliver(1);
    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });

    await act(async () => {
      open.reject(previewError({ kind: "backend_failed", retryable: false }));
      await Promise.resolve();
    });

    expect(result.current.preview.status).toBe("empty");
    expect(result.current.activeDataset).not.toBeNull();
  });

  it("discards a landed preview when the installation changes after it", async () => {
    // The in-flight guard must stop protecting a reply the moment it lands.
    // Held a microtask longer -- until a `finally` -- a verdict applied in that
    // gap would skip the discard for a preview already on screen, and nothing
    // would come back to it.
    const h = harness();
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("loaded");
    });

    act(() => {
      result.current.chooseInstallation();
    });
    await h.deliver(1);

    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });
    expect(result.current.preview.status).toBe("empty");
    expect(result.current.activeDataset).not.toBeNull();
  });

  it("does not tear down an open that is still in flight", async () => {
    // The open has already emptied the screen and is about to fill it. A
    // verdict discarding for it would bump the preview token, so the open's own
    // reply would be rejected and the workspace left empty -- for a change that
    // open may itself have been produced under.
    const open = deferred<Preview>();
    const h = harness({ preview: () => open.promise });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("opening");
    });

    act(() => {
      result.current.chooseInstallation();
    });
    await h.deliver(1);
    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });

    // The open was served by the installation now in use, so its reply is
    // current and must survive.
    await act(async () => {
      open.resolve(buildPreview(3, false, 1));
      await Promise.resolve();
    });

    expect(result.current.preview.status).toBe("loaded");
  });

  it("refuses a preview produced by a backend that has since been replaced", async () => {
    // The gate is released before a table of any size is converted and
    // transferred, so a folder switch can complete while an open is still in
    // flight. Showing it anyway would put the replaced backend's rows under the
    // new one's banner.
    const open = deferred<Preview>();
    const h = harness({ preview: () => open.promise });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("opening");
    });

    // The switch completes first and is applied.
    act(() => {
      result.current.chooseInstallation();
    });
    await h.deliver(1);
    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });

    // Now the older open finally arrives, carrying the generation it was read
    // under.
    await act(async () => {
      open.resolve(buildPreview(3, false, 0));
      await Promise.resolve();
    });

    // Ended, not left reading: the switch deliberately does not discard while
    // an open is in flight, so if this open did not end itself the workspace
    // would say "Reading the file…" for the rest of the session.
    expect(result.current.preview.status).toBe("empty");
    expect(result.current.activeDataset).not.toBeNull();
    expect(resolvedGeneration(result.current.backend)).toBe(1);
  });

  it("keeps a preview whose own open advanced the sequence", async () => {
    // An open can be the first thing to see a backend change, in which case the
    // service advances the sequence while producing that very preview. Reading
    // the next verdict's higher number as a later change would throw away the
    // reading that caused it.
    // The mount check sees generation 0; the open is served after the backend
    // changed, so the service advances to 1 while producing this preview.
    const h = harness({ openGeneration: 1 });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("loaded");
    });

    // Noticing the change also refreshes the banner, which still names the
    // installation this open replaced. That refresh reports the generation the
    // open already adopted -- so it is not a change after it, and the reading
    // on screen survives.
    h.service.advanceTo(1);
    await h.deliver(1);

    await waitFor(() => {
      expect(result.current.backend.status).toBe("resolved");
    });
    expect(resolvedGeneration(result.current.backend)).toBe(1);
    expect(result.current.preview.status).toBe("loaded");
  });

  it("discards when an inspection is the reply that first sees the change", async () => {
    // The discard belongs to the generation advancing, not to the change
    // request: if an inspection is served after the change and replies first,
    // it is the reply carrying the news, and the change's own reply is then
    // correctly refused as a superseded reading of the same generation. Hung
    // off the change request alone, nothing would ever discard.
    const h = harness();
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("loaded");
    });

    act(() => {
      result.current.chooseInstallation();
    }); // request 1
    act(() => {
      result.current.checkBackend();
    }); // request 2

    await h.serve(1); // the change runs, but its reply is still travelling
    await h.deliver(2); // the inspection runs after it and replies first

    await waitFor(() => {
      expect(resolvedOrigin(result.current.backend)).toBe("chosen");
    });
    // Everything the replaced installation read is gone, and the retained file
    // is offered back rather than left looking current.
    expect(result.current.preview.status).toBe("empty");
    expect(result.current.spectrum.status).toBe("none");
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.activeDataset?.fileName).toBe(selectedFile.fileName);

    await h.deliver(1); // the change's own reply, superseded, changes nothing
    expect(result.current.preview.status).toBe("empty");
    expect(resolvedGeneration(result.current.backend)).toBe(1);
  });

  it("starts no second read while one is still running, whoever asks", async () => {
    // The disabled action is the visible half of this rule. The other half is
    // here, because a caller that reaches past the button -- Enter arriving
    // between two renders, a dispatch from somewhere else -- must not queue a
    // second process behind the single backend gate either.
    const open = deferred<Preview>();
    let reads = 0;
    const h = harness({
      preview: () => {
        reads += 1;
        return open.promise;
      },
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("opening");
    });
    expect(reads).toBe(1);
    expect(result.current.previewBackendBusy).toBe(true);

    act(() => {
      result.current.activateDataset(selectedFile.handle);
    });

    expect(reads).toBe(1);

    await act(async () => {
      open.resolve(buildPreview(3));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.previewBackendBusy).toBe(false);
    });
  });

  it("keeps the viewer lane busy until every request it started has settled", async () => {
    // Two spectrum reads can be outstanding at once: a newer selection
    // supersedes the older one in Rust but does not cancel it. A flag would let
    // the stale one report the lane idle and re-open activation while a process
    // is still running; a count cannot.
    const replies = [deferred<SelectedSpectrumOutcome>(), deferred<SelectedSpectrumOutcome>()];
    let asked = 0;
    const h = harness({
      spectrum: () => {
        const reply = replies[asked];
        asked += 1;
        return reply?.promise ?? Promise.reject(new Error("one reply per selection"));
      },
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);
    act(() => {
      result.current.addFiles();
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("loaded");
    });

    act(() => {
      result.current.selectSpectrum(0);
    });
    act(() => {
      result.current.selectSpectrum(1);
    });
    expect(asked).toBe(2);
    expect(result.current.previewBackendBusy).toBe(true);

    // The abandoned read answers first. It owns one request and no more.
    await act(async () => {
      replies[0]?.resolve({ outcome: "unavailable", requestedIndex: 0 });
      await Promise.resolve();
    });
    expect(result.current.previewBackendBusy).toBe(true);

    await act(async () => {
      replies[1]?.resolve({ outcome: "unavailable", requestedIndex: 1 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.previewBackendBusy).toBe(false);
    });
  });

  it("reports a failed installation change that a later request superseded", async () => {
    // A change that failed means the installation did not change, so the
    // failure is still the truth about what the user just asked for. Dropping
    // it on token order left the user with no sign that their folder choice
    // had failed at all.
    const h = harness();
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(h.api) });
    await h.deliver(0);

    act(() => {
      result.current.chooseInstallation();
    }); // request 1, token N
    act(() => {
      result.current.checkBackend();
    }); // request 2, token N+1 -- request 1's token is now stale

    await h.rejectAt(1, previewError({ kind: "folder_picker_failed" }));

    await waitFor(() => {
      expect(result.current.backend.status).toBe("failed");
    });
  });
});

describe("starting a folder import", () => {
  /**
   * The hook over a fake whose roster read the test finishes by hand.
   *
   * Driven directly rather than through the rendered button, because a disabled
   * button dispatches nothing: the guard that matters is the one inside the
   * operation, and only a direct call reaches it.
   */
  function folderHarness(roster: () => Promise<WorkspaceRoster>) {
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      roster,
      scannedFolder: { files: [{ file: selectedFile, parents: [] }] },
    });
    return {
      api,
      ...renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) }),
    };
  }

  it("refuses while this window is still reading what the session holds", async () => {
    // Native page-load start already owns reload ordering, and the roster read
    // is a pure, gate-linearized snapshot. The import still waits because this
    // document must adopt one authoritative roster before it can add to it.
    const pending = deferred<WorkspaceRoster>();
    const { api, result } = folderHarness(() => pending.promise);
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("loading");
    });

    act(() => {
      result.current.addFolder();
    });

    expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(0);
    expect(result.current.folderBusy).toBe(false);

    pending.resolve({ datasets: [], capacity: FAKE_WORKSPACE_CAPACITY });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });
    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(1);
    });
  });

  it("holds Clear list until Rust acknowledges the folder reservation", async () => {
    const scan = deferred<FolderIngestionResult | null>();
    let acknowledgeReservation: (() => void) | undefined;
    let clearCalls = 0;
    const base = createFakePreviewApi({ availability: unavailableBackend });
    const api: PreviewApi = {
      ...base,
      chooseFolder: (onReserved?: () => void) => {
        acknowledgeReservation = onReserved;
        return scan.promise;
      },
      clearWorkspace: () => {
        clearCalls += 1;
        return Promise.resolve({ datasets: [], capacity: FAKE_WORKSPACE_CAPACITY });
      },
    };
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });

    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });
    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
      expect(result.current.folderReservationPending).toBe(true);
    });

    let started = true;
    act(() => {
      started = result.current.clearList();
    });
    expect(started).toBe(false);
    expect(clearCalls).toBe(0);

    expect(acknowledgeReservation).toBeTypeOf("function");
    act(() => {
      acknowledgeReservation?.();
    });
    expect(result.current.folderReservationPending).toBe(false);
    act(() => {
      started = result.current.clearList();
    });
    expect(started).toBe(true);
    expect(clearCalls).toBe(1);
    expect(result.current.folderBusy).toBe(true);

    scan.resolve(null);
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
      expect(result.current.folderReservationPending).toBe(false);
    });
  });

  it("holds row removal until Rust acknowledges the folder reservation", async () => {
    const scan = deferred<FolderIngestionResult | null>();
    let acknowledgeReservation: (() => void) | undefined;
    let removeCalls = 0;
    const base = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile],
    });
    const api: PreviewApi = {
      ...base,
      chooseFolder: (onReserved?: () => void) => {
        acknowledgeReservation = onReserved;
        return scan.promise;
      },
      removeDatasets: (handles) => {
        removeCalls += 1;
        return Promise.resolve({
          roster: { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY },
          removedHandles: [...handles],
          unknownHandles: [],
        });
      },
    };
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });

    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });
    act(() => {
      result.current.dispatchRoster({
        type: "rowPressed",
        handle: selectedFile.handle,
        modifiers: { ctrl: false, shift: false },
      });
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
      expect(result.current.folderReservationPending).toBe(true);
    });

    act(() => {
      result.current.removeSelected();
    });
    expect(removeCalls).toBe(0);

    expect(acknowledgeReservation).toBeTypeOf("function");
    act(() => {
      acknowledgeReservation?.();
    });
    expect(result.current.folderReservationPending).toBe(false);
    act(() => {
      result.current.removeSelected();
    });
    expect(removeCalls).toBe(1);
    expect(result.current.folderBusy).toBe(true);

    scan.resolve(null);
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
      expect(result.current.folderReservationPending).toBe(false);
    });
  });

  it("does not let a settled folder command's late acknowledgement release a newer one", async () => {
    const scans = [
      deferred<FolderIngestionResult | null>(),
      deferred<FolderIngestionResult | null>(),
    ];
    const acknowledgements: (() => void)[] = [];
    let invocation = 0;
    let clearCalls = 0;
    const base = createFakePreviewApi({ availability: unavailableBackend });
    const api: PreviewApi = {
      ...base,
      chooseFolder: (onReserved?: () => void) => {
        if (onReserved !== undefined) {
          acknowledgements.push(onReserved);
        }
        const scan = scans[invocation];
        invocation += 1;
        if (scan === undefined) {
          return Promise.reject(new Error("unexpected folder invocation"));
        }
        return scan.promise;
      },
      clearWorkspace: () => {
        clearCalls += 1;
        return Promise.resolve({ datasets: [], capacity: FAKE_WORKSPACE_CAPACITY });
      },
    };
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });

    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });
    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
      expect(result.current.folderReservationPending).toBe(true);
    });
    scans[0]?.resolve(null);
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
      expect(result.current.folderReservationPending).toBe(false);
    });

    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
      expect(result.current.folderReservationPending).toBe(true);
      expect(acknowledgements).toHaveLength(2);
    });

    act(() => {
      acknowledgements[0]?.();
    });
    expect(result.current.folderReservationPending).toBe(true);
    let started = true;
    act(() => {
      started = result.current.clearList();
    });
    expect(started).toBe(false);
    expect(clearCalls).toBe(0);

    act(() => {
      acknowledgements[1]?.();
    });
    expect(result.current.folderReservationPending).toBe(false);
    act(() => {
      started = result.current.clearList();
    });
    expect(started).toBe(true);
    expect(clearCalls).toBe(1);

    scans[1]?.resolve(null);
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
      expect(result.current.folderReservationPending).toBe(false);
    });
  });

  it("releases the reservation barrier when begin fails before acknowledgement", async () => {
    const begin = deferred<FolderIngestionResult | null>();
    const base = createFakePreviewApi({ availability: unavailableBackend });
    const api: PreviewApi = {
      ...base,
      chooseFolder: () => begin.promise,
    };
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });

    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });
    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
      expect(result.current.folderReservationPending).toBe(true);
    });

    begin.reject(previewError({ kind: "preview_worker_unavailable" }));
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
      expect(result.current.folderReservationPending).toBe(false);
      expect(result.current.folderError?.kind).toBe("preview_worker_unavailable");
    });
  });

  it("keeps row removal available while a folder import is unresolved", async () => {
    // A folder import has no cancellation. `Clear list` is the reliable escape;
    // removal still has to manage rows already on screen, even though imported
    // rows can remain if the import committed first. Called directly rather
    // than through the rendered buttons: a disabled button dispatches nothing,
    // and the guards that matter are the ones inside the operations.
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile],
      roster: () =>
        Promise.resolve<WorkspaceRoster>({
          datasets: [selectedFile],
          capacity: FAKE_WORKSPACE_CAPACITY,
        }),
      scannedFolder: () => scan.promise,
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
    });

    // Selecting a row is free while the scan runs, and removing it stays live.
    act(() => {
      result.current.dispatchRoster({
        type: "rowPressed",
        handle: selectedFile.handle,
        modifiers: { ctrl: false, shift: false },
      });
    });
    act(() => {
      result.current.removeSelected();
    });
    await waitFor(() => {
      expect(api.calls().filter((call) => call === "removeDatasets")).toHaveLength(1);
    });

    // Acquiring more still waits, because two batches in flight let an older
    // reply's roster overwrite a newer one's.
    act(() => {
      result.current.addFiles();
    });
    act(() => {
      result.current.addFolder();
    });
    expect(api.calls().filter((call) => call === "chooseFiles")).toHaveLength(0);
    expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(1);
  });

  it.each([
    "mutation failure",
    "folder answer",
    "same turn with folder queued first",
  ] as const)(
    "reconciles the folder import when %s settles first",
    async (firstSettlement) => {
      // A request made after the folder import began must suppress that
      // import's reply immediately: otherwise the reply can install a row while
      // the later action is still pending. A rejected mutation has no roster of
      // its own to replace that suppressed reply, though, and rejection is not
      // proof that Rust was unchanged. The only safe recovery in either reply
      // order is a fresh authoritative read after both operations have settled.
      const scan = deferred<FolderScan | null>();
      const removal = deferred<WorkspaceRemoveResult>();
      const api = createFakePreviewApi({
        initialDatasets: [selectedFile],
        removeDatasets: () => removal.promise,
        scannedFolder: () => scan.promise,
      });
      const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
      await waitFor(() => {
        expect(result.current.rosterLoad.status).toBe("ready");
      });

      act(() => {
        result.current.addFolder();
      });
      await waitFor(() => {
        expect(result.current.folderBusy).toBe(true);
      });

      act(() => {
        result.current.dispatchRoster({
          type: "rowPressed",
          handle: selectedFile.handle,
          modifiers: { ctrl: false, shift: false },
        });
      });
      act(() => {
        result.current.removeSelected();
      });
      await waitFor(() => {
        expect(api.calls().filter((call) => call === "removeDatasets")).toHaveLength(1);
      });

      if (firstSettlement === "mutation failure") {
        removal.reject(previewError({ kind: "preview_worker_unavailable" }));
        await waitFor(() => {
          expect(result.current.workspaceError).not.toBeNull();
        });
        scan.resolve({ files: [{ file: secondFile, parents: [] }] });
      } else if (firstSettlement === "folder answer") {
        scan.resolve({ files: [{ file: secondFile, parents: [] }] });
        await waitFor(() => {
          expect(result.current.folderBusy).toBe(false);
        });
        // The later removal is unresolved, so its intent already makes the
        // folder roster unsafe to expose. In an empty workspace the same bug
        // would also launch an implicit preview for that transient row.
        expect(
          result.current.roster.datasets.map((dataset) => dataset.handle),
        ).not.toContain(secondFile.handle);
        removal.reject(previewError({ kind: "preview_worker_unavailable" }));
      } else {
        // Queue the folder reaction first, then the mutation rejection without
        // yielding. Its folder `then` queues `finally`; the mutation catch sets
        // the debt before that `finally`, while the mutation's own `finally`
        // runs last. Whichever side clears the second busy flag must drain it.
        scan.resolve({ files: [{ file: secondFile, parents: [] }] });
        removal.reject(previewError({ kind: "preview_worker_unavailable" }));
      }

      // The recovery is a read, not a replay of the folder reply. That matters
      // when a transport or task failure happened after Rust changed state.
      await waitFor(() => {
        expect(api.rosterReads()).toBe(2);
        expect(
          result.current.roster.datasets.map((dataset) => dataset.handle),
        ).toContain(secondFile.handle);
      });
      expect(result.current.workspaceError).not.toBeNull();
    },
  );

  it("supersedes an older reconciliation when the next mutation also fails", async () => {
    // The first failure during an import starts a roster read as soon as the
    // import settles. Curating remains available while that read travels. If a
    // second mutation then rejects, its failure may have happened after Rust
    // changed state, so the older read is not enough: a new read must supersede
    // it even though no folder is busy anymore.
    const scan = deferred<FolderScan | null>();
    const firstRemoval = deferred<WorkspaceRemoveResult>();
    const secondRemoval = deferred<WorkspaceRemoveResult>();
    const staleRead = deferred<WorkspaceRoster>();
    const empty: WorkspaceRoster = { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY };
    let rosterRead = 0;
    let removal = 0;
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      roster: () => {
        rosterRead += 1;
        if (rosterRead === 1) {
          return Promise.resolve({
            datasets: [selectedFile],
            capacity: FAKE_WORKSPACE_CAPACITY,
          });
        }
        return rosterRead === 2 ? staleRead.promise : Promise.resolve(empty);
      },
      removeDatasets: () => {
        removal += 1;
        return removal === 1 ? firstRemoval.promise : secondRemoval.promise;
      },
      scannedFolder: () => scan.promise,
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    act(() => {
      result.current.addFolder();
      result.current.dispatchRoster({
        type: "rowPressed",
        handle: selectedFile.handle,
        modifiers: { ctrl: false, shift: false },
      });
    });
    act(() => {
      result.current.removeSelected();
    });
    firstRemoval.reject(previewError({ kind: "preview_worker_unavailable" }));
    await waitFor(() => {
      expect(result.current.workspaceBusy).toBe(false);
    });

    scan.resolve({ files: [{ file: secondFile, parents: [] }] });
    await waitFor(() => {
      expect(api.rosterReads()).toBe(2);
      expect(result.current.rosterLoad.status).toBe("loading");
    });

    // The selected row is still the one the first failed removal left behind,
    // so a second removal can begin while that first reconciliation is pending.
    act(() => {
      result.current.removeSelected();
    });

    // The older read was already in flight when this request began. Let it
    // arrive while the second removal is unresolved: the request-time roster
    // barrier must keep its pre-removal snapshot off the screen.
    await act(async () => {
      staleRead.resolve({
        datasets: [selectedFile, secondFile],
        capacity: FAKE_WORKSPACE_CAPACITY,
      });
      await Promise.resolve();
    });
    expect(
      result.current.roster.datasets.map((dataset) => dataset.handle),
    ).not.toContain(secondFile.handle);

    secondRemoval.reject(previewError({ kind: "preview_worker_unavailable" }));
    await waitFor(() => {
      expect(api.rosterReads()).toBe(3);
      expect(result.current.roster.datasets).toHaveLength(0);
      expect(result.current.rosterLoad.status).toBe("ready");
    });
  });

  it("lets a successful mutation pay an earlier reconciliation debt", async () => {
    // Two workspace mutations are serial, but both can finish while the same
    // folder import is pending. If the first fails and the second succeeds, the
    // second reply is already the authoritative roster: retaining the first
    // failure's debt would read again after the folder settles and could replace
    // that newer answer with an older snapshot.
    const scan = deferred<FolderScan | null>();
    const firstRemoval = deferred<WorkspaceRemoveResult>();
    const secondRemoval = deferred<WorkspaceRemoveResult>();
    let removal = 0;
    const empty: WorkspaceRoster = { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY };
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      removeDatasets: () => {
        removal += 1;
        return removal === 1 ? firstRemoval.promise : secondRemoval.promise;
      },
      scannedFolder: () => scan.promise,
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    act(() => {
      result.current.addFolder();
      result.current.dispatchRoster({
        type: "rowPressed",
        handle: selectedFile.handle,
        modifiers: { ctrl: false, shift: false },
      });
    });
    act(() => {
      result.current.removeSelected();
    });
    firstRemoval.reject(previewError({ kind: "preview_worker_unavailable" }));
    await waitFor(() => {
      expect(result.current.workspaceBusy).toBe(false);
    });

    act(() => {
      result.current.removeSelected();
    });
    scan.resolve({ files: [{ file: secondFile, parents: [] }] });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
    });

    // The second mutation is still pending, so the debt from the first must not
    // launch a roster read that could observe the workspace before this request.
    expect(api.rosterReads()).toBe(1);
    expect(
      result.current.roster.datasets.map((dataset) => dataset.handle),
    ).not.toContain(secondFile.handle);

    secondRemoval.resolve({
      roster: empty,
      removedHandles: [selectedFile.handle],
      unknownHandles: [],
    });
    await waitFor(() => {
      expect(result.current.roster.datasets).toHaveLength(0);
    });
    expect(api.rosterReads()).toBe(1);
    expect(result.current.roster.datasets).toHaveLength(0);
  });

  it("does not reconcile a dead window when its folder import settles", async () => {
    const folder = deferred<FolderIngestionResult | null>();
    const removal = deferred<WorkspaceRemoveResult>();
    const api = createFakePreviewApi({
      initialDatasets: [selectedFile],
      removeDatasets: () => removal.promise,
      folderResult: () => folder.promise,
    });
    const { result, unmount } = renderHook(() => usePreviewWorkspace(), {
      wrapper: wrapper(api),
    });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    act(() => {
      result.current.addFolder();
      result.current.dispatchRoster({
        type: "rowPressed",
        handle: selectedFile.handle,
        modifiers: { ctrl: false, shift: false },
      });
    });
    act(() => {
      result.current.removeSelected();
    });
    removal.reject(previewError({ kind: "preview_worker_unavailable" }));
    await waitFor(() => {
      expect(result.current.workspaceError).not.toBeNull();
    });

    unmount();
    await act(async () => {
      folder.resolve(null);
      // Cross one macrotask so the hook's then/catch/finally chain has fully
      // drained. Counting before `finally` would let a dead-window read escape
      // the oracle merely because its microtask had not run yet.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    // The next mounted webview will read its own roster. This one must not
    // launch another stale reconciliation after it has ceased to exist.
    expect(api.rosterReads()).toBe(1);
  });

  it("refuses to read the list back while an import is unresolved", async () => {
    // The other half of the same rule, and the reason removing and clearing are
    // not simply "everything that is not acquiring". A roster read is pure but
    // would add a loading state and a snapshot whose usefulness depends on
    // whether the scan committed before or after it. Unlike removing or
    // clearing, it adds no useful escape path; the folder result or owed
    // reconciliation already supplies the authoritative answer.
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      scannedFolder: () => scan.promise,
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });
    const readsBefore = api.rosterReads();

    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
    });

    act(() => {
      result.current.reloadRoster();
    });
    expect(api.rosterReads()).toBe(readsBefore);

    scan.resolve({ files: [] });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
    });
    act(() => {
      result.current.reloadRoster();
    });
    await waitFor(() => {
      expect(api.rosterReads()).toBe(readsBefore + 1);
    });
  });

  it("reports whether Clear list acquired the workspace mutation gate", async () => {
    const clearing = deferred<WorkspaceRoster>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile],
      clearWorkspace: () => clearing.promise,
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    let started = false;
    act(() => {
      started = result.current.clearList();
    });
    expect(started).toBe(true);
    expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(1);

    // The unresolved request owns the gate; a second activation started no
    // request and therefore owns no later keyboard restoration either.
    act(() => {
      started = result.current.clearList();
    });
    expect(started).toBe(false);
    expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(1);

    clearing.resolve({ datasets: [], capacity: FAKE_WORKSPACE_CAPACITY });
    await waitFor(() => {
      expect(result.current.workspaceBusy).toBe(false);
      expect(result.current.roster.datasets).toHaveLength(0);
    });
    act(() => {
      started = result.current.clearList();
    });
    expect(started).toBe(false);
    expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(1);
  });

  it("still lets the user empty the list during an unresolved import", async () => {
    const scan = deferred<FolderScan | null>();
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      initialDatasets: [selectedFile],
      roster: () =>
        Promise.resolve<WorkspaceRoster>({
          datasets: [selectedFile],
          capacity: FAKE_WORKSPACE_CAPACITY,
        }),
      scannedFolder: () => scan.promise,
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
    });

    act(() => {
      result.current.clearList();
    });

    // Waited on the list rather than on the call, so this is the reply having
    // been applied rather than the request having been made.
    await waitFor(() => {
      expect(result.current.roster.datasets).toHaveLength(0);
    });
    expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(1);
    // And the import is still out there, holding nothing up.
    expect(result.current.folderBusy).toBe(true);
  });

  it("lets an empty workspace supersede its first unresolved folder import", async () => {
    const stale = deferred<FolderIngestionResult | null>();
    const clearedCapacity = FAKE_WORKSPACE_CAPACITY - 1;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      folderResult: () => stale.promise,
      clearWorkspace: () => Promise.resolve({ datasets: [], capacity: clearedCapacity }),
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(true);
    });

    act(() => {
      result.current.clearList();
    });
    await waitFor(() => {
      expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(1);
      expect(result.current.workspaceNotice?.message).toBe(
        "The workspace is empty. The pending folder import will not add files.",
      );
    });
    expect(result.current.roster.datasets).toHaveLength(0);
    expect(result.current.roster.capacity).toBe(clearedCapacity);
    const clearNotice = result.current.workspaceNotice;

    // Both acquisition paths stay refused until the older request settles.
    act(() => {
      result.current.addFiles();
      result.current.addFolder();
    });
    expect(api.calls().filter((call) => call === "chooseFiles")).toHaveLength(0);
    expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(1);

    // Model a reply that was already on its way back when the clear completed.
    // It is older than the clear even though it carries an added row.
    await act(async () => {
      stale.resolve({
        roster: { datasets: [selectedFile], capacity: FAKE_WORKSPACE_CAPACITY },
        outcomes: [{ outcome: "added", dataset: selectedFile }],
        discovery: COMPLETE_SCAN,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.folderBusy).toBe(false);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.roster.datasets).toHaveLength(0);
    expect(result.current.workspaceNotice).toEqual(clearNotice);
  });

  it.each(["import_superseded", "invalid_folder_import_reservation"] as const)(
    "silently settles %s after empty-workspace Clear list wins",
    async (kind) => {
      const folder = deferred<FolderIngestionResult | null>();
      const clearedCapacity = FAKE_WORKSPACE_CAPACITY - 1;
      const api = createFakePreviewApi({
        availability: unavailableBackend,
        folderResult: () => folder.promise,
        clearWorkspace: () =>
          Promise.resolve({ datasets: [], capacity: clearedCapacity }),
      });
      const { result } = renderHook(() => usePreviewWorkspace(), {
        wrapper: wrapper(api),
      });
      await waitFor(() => {
        expect(result.current.rosterLoad.status).toBe("ready");
      });

      act(() => {
        result.current.addFolder();
      });
      await waitFor(() => {
        expect(result.current.folderBusy).toBe(true);
      });
      act(() => {
        result.current.clearList();
      });
      await waitFor(() => {
        expect(result.current.workspaceNotice?.message).toBe(
          "The workspace is empty. The pending folder import will not add files.",
        );
      });
      const clearNotice = result.current.workspaceNotice;

      folder.reject(previewError({ kind }));
      await waitFor(() => {
        expect(result.current.folderBusy).toBe(false);
      });

      expect(result.current.folderError).toBeNull();
      expect(result.current.roster.datasets).toHaveLength(0);
      expect(result.current.roster.capacity).toBe(clearedCapacity);
      expect(result.current.workspaceNotice).toEqual(clearNotice);
    },
  );

  it("refuses after a read that failed, until a retry has succeeded", async () => {
    // The same answer for the same reason: this window has no authoritative
    // list, and importing into a workspace it could not read is not something
    // to start on a guess.
    let attempts = 0;
    const { api, result } = folderHarness(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("the list could not be read"))
        : Promise.resolve<WorkspaceRoster>({ datasets: [], capacity: FAKE_WORKSPACE_CAPACITY });
    });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("failed");
    });

    act(() => {
      result.current.addFolder();
    });
    expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(0);

    act(() => {
      result.current.reloadRoster();
    });
    await waitFor(() => {
      expect(result.current.rosterLoad.status).toBe("ready");
    });

    act(() => {
      result.current.addFolder();
    });
    await waitFor(() => {
      expect(api.calls().filter((call) => call === "chooseFolder")).toHaveLength(1);
    });
  });
});
