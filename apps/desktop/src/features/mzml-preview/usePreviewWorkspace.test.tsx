import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type {
  BackendAvailability,
  Preview,
  SelectedSpectrumOutcome,
  WorkspaceAddResult,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "./contracts";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import {
  FAKE_WORKSPACE_CAPACITY,
  buildPreview,
  deferred,
  previewError,
  selectedFile,
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
