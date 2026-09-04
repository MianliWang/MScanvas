import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  intentCatalog,
  intentFor,
  queueItem,
  queueOf,
  SHIPPED_INTENT,
  shimadzuDataset,
  unavailableBackend,
} from "../../test/previewFixtures";
import type { FakePreviewApi, FakePreviewApiOptions } from "../../test/previewFixtures";
import type { ConversionQueuePlan, WorkspaceConversionState } from "./contracts";

/**
 * The visible conversion settings, and what pressing Convert then binds.
 *
 * These cases are about the seam M6.4 adds: a user editing four scientific
 * dimensions, a plan that answers each edit, and a queue that keeps whatever it
 * was started with. What they check, in every case, is that the *interface*
 * never becomes a second authority -- it offers what one catalog admits, it
 * shows what one plan answered, and it sends back an identity Rust issued.
 */

const VENDOR_ROW = shimadzuDataset(9);

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** A session with one convertible row, focused, and a plan on screen. */
async function openTheSettings(
  options: Partial<FakePreviewApiOptions> = {},
): Promise<{ readonly api: FakePreviewApi; readonly panel: HTMLElement }> {
  const api = createFakePreviewApi({
    initialDatasets: [VENDOR_ROW],
    availability: availableBackend,
    ...options,
  });
  renderApp(api);
  const row = await screen.findByRole("option", { name: /sample-9\.lcd/u });
  fireEvent.click(row);
  const panel = await screen.findByRole("region", { name: "Convert" });
  return { api, panel };
}

/** One settings radio, by the group it belongs to and its own label. */
function choice(panel: HTMLElement, group: string, label: string | RegExp): HTMLInputElement {
  const fieldset = within(panel).getByRole("group", { name: group });
  return within(fieldset).getByRole("radio", { name: label }) as HTMLInputElement;
}

/** The sentence a control is described by, read the way a screen reader would. */
function describedText(control: HTMLElement): string {
  const id = control.getAttribute("aria-describedby") ?? "";
  return id
    .split(/\s+/u)
    .map((each) => document.getElementById(each)?.textContent ?? "")
    .join(" ");
}

/** What the plan says about one named fact. */
function planFact(panel: HTMLElement, term: string): string {
  const list = panel.querySelector("[data-plan-facts='intent']");
  if (list === null) {
    throw new Error("expected the plan facts on screen");
  }
  const terms = [...list.querySelectorAll("dt")];
  const found = terms.find((each) => each.textContent === term);
  if (found === undefined) {
    throw new Error(`the plan says nothing about ${term}`);
  }
  return found.nextElementSibling?.textContent ?? "";
}

function convertButton(panel: HTMLElement): HTMLElement {
  return within(panel).getByRole("button", { name: /^Convert/u });
}

describe("choosing what a conversion will do", () => {
  it("opens on the semantic the product ships, named by Rust rather than by this side", async () => {
    const { api, panel } = await openTheSettings();
    await waitFor(() => {
      expect(choice(panel, "Peak processing", "No additional centroiding").checked).toBe(true);
    });
    expect(choice(panel, "Spectra included", "All spectra").checked).toBe(true);
    expect(choice(panel, "Numeric precision", /64-bit · intensity 32-bit/u).checked).toBe(true);
    expect(choice(panel, "Array compression", "zlib compressed").checked).toBe(true);

    // And the plan was asked for under that exact identity, which is the one
    // the catalog named as shipped.
    await waitFor(() => {
      expect(api.conversionPlanRequests.at(-1)?.intentId).toBe(SHIPPED_INTENT.id);
    });
    // One output format, stated rather than offered: mzXML is not a control
    // here, disabled or otherwise.
    expect(within(panel).queryByRole("radio", { name: /mzXML/iu })).toBeNull();
  });

  it("marks centroiding lossy where the choice is made, not after it is taken", async () => {
    const { panel } = await openTheSettings();
    const centroid = await waitFor(() =>
      choice(panel, "Peak processing", "Centroid all MS levels"),
    );
    // The disclosure is associated with the control, so it reaches a reader who
    // never sees the paragraph beside it.
    expect(describedText(centroid)).toMatch(/^|\sLossy\./u);
    expect(describedText(centroid)).toContain("cannot be recovered");
    expect(describedText(centroid)).toContain("every MS level");
    // And it is not called any of the things the evidence does not support.
    expect(describedText(centroid)).not.toMatch(/vendor|high.quality|lossless/iu);
  });

  it("says what a population filter leaves out, and what a narrow store rounds", async () => {
    const { panel } = await openTheSettings();
    const ms1 = await waitFor(() => choice(panel, "Spectra included", "MS1 spectra only"));
    expect(describedText(ms1)).toContain("left out of the converted file");
    // A population filter is not a centroiding scope, and nothing here calls it
    // one.
    expect(describedText(ms1)).not.toMatch(/centroid/iu);

    const narrow = choice(panel, "Numeric precision", /32-bit · intensity 32-bit/u);
    expect(describedText(narrow)).toContain("rounds");
    expect(describedText(narrow)).not.toMatch(/lossless/iu);

    // Compression is a representation decision at fixed precision, and is
    // described as one.
    const uncompressed = choice(panel, "Array compression", "Uncompressed");
    expect(describedText(uncompressed)).toContain("numbers written are the same");
  });

  it("refuses an unqualified combination at the control, by pointer and by keyboard", async () => {
    const { api, panel } = await openTheSettings();
    const uncompressed = await waitFor(() => choice(panel, "Array compression", "Uncompressed"));
    // From the shipped posture, compression off was never measured.
    expect(uncompressed).toBeDisabled();
    expect(describedText(uncompressed)).toContain("has not qualified that combination");

    // Neither route takes it: a disabled radio accepts neither a pointer
    // activation nor a keyboard one, and nothing crosses the boundary.
    fireEvent.click(uncompressed);
    fireEvent.keyDown(uncompressed, { key: " " });
    await act(async () => {
      await Promise.resolve();
    });
    expect(choice(panel, "Array compression", "zlib compressed").checked).toBe(true);
    expect(api.conversionPlanRequests.every((each) => each.intentId === SHIPPED_INTENT.id)).toBe(
      true,
    );
  });

  it("refuses an unqualified semantic asked for by a hand-made call", async () => {
    // The control is disabled, so a browser refuses both activations. This is
    // the other half: the operation refuses the identity itself, so a value no
    // control would offer cannot be selected by reaching past the control.
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.settings.status).toBe("ready");
    });

    for (const asked of [
      // Not in the admitted table at all: the shipped posture with compression
      // off, which is one control away from the default and was never measured.
      "mzml+no_additional_centroiding+all+mz64_intensity32+none",
      // Not an identity at all.
      "",
    ]) {
      act(() => {
        rendered.result.current.conversion.chooseIntent(asked);
      });
      const { settings } = rendered.result.current.conversion;
      expect(settings.status === "ready" && settings.selectedId).toBe(SHIPPED_INTENT.id);
    }
    expect(rendered.result.current.conversion.settingsReadiness).toBe("ready");
  });

  it("refuses a qualified semantic this build cannot run, asked for the same way", async () => {
    const wide = intentFor({ precision: "mz64Intensity64" });
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => Promise.resolve(intentCatalog({ unsupported: [wide.id] })),
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.settings.status).toBe("ready");
    });

    act(() => {
      rendered.result.current.conversion.chooseIntent(wide.id);
    });
    const { settings } = rendered.result.current.conversion;
    expect(settings.status === "ready" && settings.selectedId).toBe(SHIPPED_INTENT.id);
  });

  it("distinguishes a build that cannot run a qualified combination", async () => {
    const wide = intentFor({ precision: "mz64Intensity64" });
    const { panel } = await openTheSettings({
      conversionIntents: () => Promise.resolve(intentCatalog({ unsupported: [wide.id] })),
    });
    const wider = await waitFor(() =>
      choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u),
    );
    expect(wider).toBeDisabled();
    // A different sentence, because it calls for a different response: this one
    // a reader can act on.
    expect(describedText(wider)).toContain("installed ProteoWizard build does not offer");
    expect(describedText(wider)).not.toContain("has not qualified");
  });

  it("moves one axis at a time, and reaches a combination two explicit steps away", async () => {
    const { api, panel } = await openTheSettings();
    const wider = await waitFor(() =>
      choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u),
    );
    fireEvent.click(wider);

    await waitFor(() => {
      expect(api.conversionPlanRequests.at(-1)?.intentId).toBe(
        intentFor({ precision: "mz64Intensity64" }).id,
      );
    });
    // Only precision moved.
    expect(choice(panel, "Peak processing", "No additional centroiding").checked).toBe(true);
    expect(choice(panel, "Spectra included", "All spectra").checked).toBe(true);
    expect(choice(panel, "Array compression", "zlib compressed").checked).toBe(true);

    // And from there compression off becomes available, which is exactly where
    // the measurement put it.
    const uncompressed = choice(panel, "Array compression", "Uncompressed");
    await waitFor(() => {
      expect(uncompressed).toBeEnabled();
    });
    fireEvent.click(uncompressed);
    await waitFor(() => {
      expect(api.conversionPlanRequests.at(-1)?.intentId).toBe(
        intentFor({ precision: "mz64Intensity64", compression: "none" }).id,
      );
    });
    // Still one axis at a time: the precision the user chose two steps ago is
    // untouched.
    expect(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u).checked).toBe(true);
  });

  it("states the plan from what Rust answered, for a semantic that is not the shipped one", async () => {
    const { api, panel } = await openTheSettings();
    await waitFor(() => {
      expect(convertButton(panel)).toBeEnabled();
    });
    fireEvent.click(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u));
    await waitFor(() => {
      expect(api.conversionPlanRequests.at(-1)?.intentId).toBe(
        intentFor({ precision: "mz64Intensity64" }).id,
      );
    });
    fireEvent.click(choice(panel, "Spectra included", "MS2 spectra only"));

    await waitFor(() => {
      expect(planFact(panel, "Spectra")).toBe("MS2 spectra only");
    });
    expect(planFact(panel, "Output")).toBe("mzML");
    expect(planFact(panel, "Peak processing")).toBe("No additional centroiding");
    expect(planFact(panel, "Numeric precision")).toBe("m/z 64-bit · intensity 64-bit");
    expect(planFact(panel, "Array compression")).toBe("zlib compressed");
    expect(planFact(panel, "If an output name is taken")).toBe(
      "Stop if a file of that name already exists",
    );
    // The destination is chosen after this summary is read, and the summary
    // says so rather than naming a folder.
    expect(planFact(panel, "Destination")).toBe("One folder, chosen next");
    expect(panel.textContent ?? "").not.toMatch(/[A-Za-z]:[\\/]/u);

    // What this semantic leaves out is said beside the plan, in the same words
    // the control carries.
    const disclosures = panel.querySelector("[data-plan-facts='disclosures']");
    expect(disclosures?.textContent ?? "").toContain("left out of the converted file");
  });

  it("keeps the family sentence true when the plan names a different format", async () => {
    const { panel } = await openTheSettings();
    await waitFor(() => {
      expect(
        within(panel).getByText(
          "One Shimadzu LabSolutions LCD acquisition will be converted to mzML.",
        ),
      ).toBeVisible();
    });
  });

  it("binds the semantic the plan showed, and keeps it when the settings move on", async () => {
    const running = deferred<WorkspaceConversionState>();
    const { api, panel } = await openTheSettings({
      conversion: (_request, publish) => {
        publish({
          status: "running",
          operationId: "1",
          queue: {
            ...queueOf([
              queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, {
                state: "running",
                attempts: 1,
              }),
            ]),
            // The queue holds what it was started with, whatever the settings
            // do afterwards.
            intent: intentFor({ precision: "mz32Intensity32" }),
            currentIndex: 0,
          },
        });
        return running.promise;
      },
    });
    const narrow = await waitFor(() =>
      choice(panel, "Numeric precision", /32-bit · intensity 32-bit/u),
    );
    fireEvent.click(narrow);
    await waitFor(() => {
      expect(planFact(panel, "Numeric precision")).toBe("m/z 32-bit · intensity 32-bit");
    });
    await waitFor(() => {
      expect(convertButton(panel)).toBeEnabled();
    });

    fireEvent.click(convertButton(panel));
    await waitFor(() => {
      expect(api.conversionRequests).toEqual([
        {
          handles: [VENDOR_ROW.handle],
          conflictPolicy: "fail",
          intentId: intentFor({ precision: "mz32Intensity32" }).id,
        },
      ]);
    });

    // The running queue says what it bound, read from the queue rather than
    // from the controls.
    const bound = await waitFor(() => {
      const element = panel.querySelector("[data-queue-intent]");
      if (element === null) {
        throw new Error("expected the queue to state its semantic");
      }
      return element as HTMLElement;
    });
    expect(bound.getAttribute("data-queue-intent")).toBe(
      intentFor({ precision: "mz32Intensity32" }).id,
    );
    expect(bound.textContent ?? "").toContain("m/z 32-bit · intensity 32-bit");
    // Nothing further crossed the boundary, and the queue is unchanged.
    expect(api.conversionRequests).toHaveLength(1);
  });

  it("will not start a plan the settings have moved past", async () => {
    // Deterministic rather than timed: the plan for the first semantic is held
    // open, the settings move, and the held reply lands afterwards.
    const first = deferred<ConversionQueuePlan>();
    const answered: string[] = [];
    const { api, panel } = await openTheSettings({
      conversionPlan: (handles, intentId, conflictPolicy) => {
        answered.push(intentId);
        const plan: ConversionQueuePlan = {
          items: handles.map((handle) => ({
            datasetHandle: handle,
            fileName: VENDOR_ROW.fileName,
            sourceKind: VENDOR_ROW.sourceKind,
            output: { kind: "backendNamedSet", maxMembers: 24 },
          })),
          intent:
            intentId === SHIPPED_INTENT.id
              ? SHIPPED_INTENT
              : intentFor({ precision: "mz64Intensity64" }),
          conflictPolicy,
          validationMode: "output_only",
          capacity: 16,
          installationGeneration: 0,
        };
        return intentId === SHIPPED_INTENT.id ? first.promise : Promise.resolve(plan);
      },
    });

    // The shipped plan is outstanding, so nothing may start yet.
    await waitFor(() => {
      expect(answered).toContain(SHIPPED_INTENT.id);
    });
    expect(convertButton(panel)).toBeDisabled();

    fireEvent.click(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u));
    await waitFor(() => {
      expect(planFact(panel, "Numeric precision")).toBe("m/z 64-bit · intensity 64-bit");
    });

    // The first request answers late. It must not be rendered as the second
    // semantic's plan, and it must not become startable.
    await act(async () => {
      first.resolve({
        items: [
          {
            datasetHandle: VENDOR_ROW.handle,
            fileName: VENDOR_ROW.fileName,
            sourceKind: VENDOR_ROW.sourceKind,
            output: { kind: "backendNamedSet", maxMembers: 24 },
          },
        ],
        intent: SHIPPED_INTENT,
        conflictPolicy: "fail",
        validationMode: "output_only",
        capacity: 16,
        installationGeneration: 0,
      });
      await Promise.resolve();
    });
    expect(planFact(panel, "Numeric precision")).toBe("m/z 64-bit · intensity 64-bit");

    // And a conversion started now binds the semantic on screen.
    await waitFor(() => {
      expect(convertButton(panel)).toBeEnabled();
    });
    fireEvent.click(convertButton(panel));
    await waitFor(() => {
      expect(api.conversionRequests.at(0)?.intentId).toBe(
        intentFor({ precision: "mz64Intensity64" }).id,
      );
    });
  });

  it("will not start a plan read under a different conflict policy", async () => {
    const { api, panel } = await openTheSettings();
    await waitFor(() => {
      expect(convertButton(panel)).toBeEnabled();
    });
    const before = api.conversionPlanRequests.length;

    fireEvent.click(within(panel).getByRole("radio", { name: /^Skip if a file/u }));

    // The policy is part of what the plan answers, so it is asked again, and
    // nothing may start on the plan that answered the old question.
    await waitFor(() => {
      expect(api.conversionPlanRequests.length).toBeGreaterThan(before);
    });
    expect(api.conversionPlanRequests.at(-1)?.conflictPolicy).toBe("skip");
    await waitFor(() => {
      expect(planFact(panel, "If an output name is taken")).toBe(
        "Skip if a file of that name already exists",
      );
    });
    expect(api.conversionRequests).toHaveLength(0);
  });

  it("refuses a conversion until the one conversion slot has actually been read", async () => {
    // The M6.1 residual. `idle` is what this document starts from, not
    // something it has observed -- and a slot it has never read may already
    // hold a queue a replaced document started.
    const slot = deferred<void>();
    const { api, panel } = await openTheSettings({
      stateReadLatency: () => slot.promise,
    });
    await waitFor(() => {
      expect(convertButton(panel)).toBeDisabled();
    });
    expect(
      within(panel).getByText("MSCanvas is checking the current conversion state."),
    ).toBeVisible();
    // And a dispatch that reaches the handler another way is refused too.
    fireEvent.click(convertButton(panel));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.conversionRequests).toHaveLength(0);

    await act(async () => {
      slot.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(convertButton(panel)).toBeEnabled();
    });
  });

  it("keeps a catalog answer about an installation that has already been replaced off screen", async () => {
    // The two commands that resolve an installation do not answer in call
    // order, so a slower catalog read can describe a build that has since been
    // replaced. Rust stamps each answer with the installation it was evaluated
    // against; this is what that stamp is for.
    const wide = intentFor({ precision: "mz64Intensity64" });
    const stale = deferred<ReturnType<typeof intentCatalog>>();
    let reads = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => {
        reads += 1;
        // The first read describes the installation that is about to be
        // replaced, and is held open. The second describes its replacement.
        return reads === 1
          ? stale.promise
          : Promise.resolve(intentCatalog({ installationGeneration: 1 }));
      },
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    await waitFor(() => {
      expect(reads).toBe(1);
    });

    // The installation changes, and the catalog for the new one installs. The
    // change is made where a change is actually made -- the session's one
    // counter, which stamps the verdict and the catalog alike -- rather than
    // by a check merely having run.
    api.noteInstallationObserved();
    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      const { settings } = rendered.result.current.conversion;
      expect(settings.status === "ready" && settings.catalog.installationGeneration).toBe(1);
    });

    // Now the first read answers, describing the replaced build. It must not
    // install: the interface would otherwise refuse a semantic the current
    // installation offers.
    await act(async () => {
      stale.resolve(intentCatalog({ unsupported: [wide.id], installationGeneration: 0 }));
      await Promise.resolve();
    });
    const { settings } = rendered.result.current.conversion;
    expect(settings.status === "ready" && settings.catalog.installationGeneration).toBe(1);
    expect(
      settings.status === "ready" &&
        settings.catalog.intents.find((option) => option.intent.id === wide.id)?.availability,
    ).toEqual({ kind: "available" });
  });

  it("rereads the plan against the installation that replaced the one it answered about", async () => {
    let generation = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      // Stamped by the fake from the session's own counter, exactly as Rust
      // stamps a verdict. `noteInstallationObserved` below is what moves it.
      availability: availableBackend,
      conversionIntents: () =>
        Promise.resolve(intentCatalog({ installationGeneration: generation })),
      // Every plan answers with the installation it was read at, exactly as
      // Rust stamps one.
      conversionPlan: (handles, _intentId, conflictPolicy) =>
        Promise.resolve({
          items: handles.map((handle) => ({
            datasetHandle: handle,
            fileName: VENDOR_ROW.fileName,
            sourceKind: VENDOR_ROW.sourceKind,
            output: { kind: "backendNamedSet" as const, maxMembers: 24 },
          })),
          intent: SHIPPED_INTENT,
          conflictPolicy,
          validationMode: "output_only" as const,
          capacity: 16,
          installationGeneration: generation,
        }),
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });
    const before = api.conversionPlanRequests.length;

    // The installation changes. The plan on screen was an answer about the one
    // that is gone, so it is asked again -- without anybody pressing anything.
    generation = 1;
    api.noteInstallationObserved();
    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      expect(api.conversionPlanRequests.length).toBeGreaterThan(before);
    });
    await waitFor(() => {
      const { conversion } = rendered.result.current;
      expect(
        conversion.plan.status === "loaded" && conversion.plan.plan.installationGeneration,
      ).toBe(1);
    });
    expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
  });

  it("will not start a plan read against an installation that has been replaced", async () => {
    // The window between an installation changing and its catalog arriving. The
    // plan on screen was an answer about a build that is gone, and the catalog
    // it would be checked against described the same one -- so keeping that
    // catalog would let the two agree about a number neither still describes.
    const catalog = deferred<ReturnType<typeof intentCatalog>>();
    let generation = 0;
    let reads = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => {
        reads += 1;
        return reads === 1
          ? Promise.resolve(intentCatalog({ installationGeneration: 0 }))
          : catalog.promise;
      },
      conversionPlan: (handles, _intentId, conflictPolicy) =>
        Promise.resolve({
          items: handles.map((handle) => ({
            datasetHandle: handle,
            fileName: VENDOR_ROW.fileName,
            sourceKind: VENDOR_ROW.sourceKind,
            output: { kind: "backendNamedSet" as const, maxMembers: 24 },
          })),
          intent: SHIPPED_INTENT,
          conflictPolicy,
          validationMode: "output_only" as const,
          capacity: 16,
          installationGeneration: generation,
        }),
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });

    // The installation changes, and its catalog has not answered yet.
    generation = 1;
    api.noteInstallationObserved();
    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    expect(rendered.result.current.conversion.settingsReadiness).toBe("loading");
    expect(rendered.result.current.conversion.planIsCurrent).toBe(false);

    // And when it does, the user's semantic is still the one selected.
    await act(async () => {
      catalog.resolve(intentCatalog({ installationGeneration: 1 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });
    const { settings } = rendered.result.current.conversion;
    expect(settings.status === "ready" && settings.selectedId).toBe(SHIPPED_INTENT.id);
  });

  it("offers one explicit way out when the chosen semantic has no reachable neighbour", async () => {
    // The dead end two right rules produce together. A choice survives an
    // installation change, and a control moves one axis; a preserved semantic
    // whose every one-axis neighbour is unqualified or undeclared therefore
    // leaves every control refused, with the shipped posture available and
    // unreachable.
    const chosen = intentFor({
      processing: "unscopedDefaultCentroiding",
      precision: "mz32Intensity32",
    });
    const everythingElse = intentCatalog()
      .intents.map((option) => option.intent.id)
      .filter((id) => id !== SHIPPED_INTENT.id);
    let generation = 0;
    const { api, panel } = await openTheSettings({
      availability: availableBackend,
      conversionIntents: () =>
        Promise.resolve(
          generation === 0
            ? intentCatalog()
            : intentCatalog({ unsupported: everythingElse, installationGeneration: 1 }),
        ),
    });

    // Chosen on a build that offers it, in two explicit steps.
    await waitFor(() => {
      expect(choice(panel, "Numeric precision", /32-bit · intensity 32-bit/u)).toBeEnabled();
    });
    fireEvent.click(choice(panel, "Numeric precision", /32-bit · intensity 32-bit/u));
    await waitFor(() => {
      expect(choice(panel, "Peak processing", "Centroid all MS levels")).toBeEnabled();
    });
    fireEvent.click(choice(panel, "Peak processing", "Centroid all MS levels"));
    await waitFor(() => {
      expect(choice(panel, "Peak processing", "Centroid all MS levels").checked).toBe(true);
    });
    expect(chosen.id).not.toBe(SHIPPED_INTENT.id);

    // The installation is replaced by one that can run only what MSCanvas
    // ships, through the control a reader actually has. The build changes
    // first; the press is what makes this session find out.
    generation = 1;
    api.noteInstallationObserved();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    const recover = await within(panel).findByRole("button", {
      name: "Use the settings MSCanvas ships",
    });
    // The semantic was preserved rather than silently replaced, and every
    // control is refused.
    expect(choice(panel, "Peak processing", "Centroid all MS levels").checked).toBe(true);
    for (const [group, label] of [
      ["Peak processing", "No additional centroiding"],
      ["Spectra included", "MS1 spectra only"],
      ["Numeric precision", /64-bit · intensity 64-bit/u],
      ["Array compression", "Uncompressed"],
    ] as const) {
      expect(choice(panel, group, label)).toBeDisabled();
    }
    expect(describedText(recover)).toContain("no single change to one of them reaches");

    fireEvent.click(recover);
    await waitFor(() => {
      expect(choice(panel, "Peak processing", "No additional centroiding").checked).toBe(true);
    });
    // And the way out goes with the need for it.
    expect(
      within(panel).queryByRole("button", { name: "Use the settings MSCanvas ships" }),
    ).toBeNull();
  });

  it("keeps the settings and the plan on screen across a check of the same installation", async () => {
    // G1, where a reader meets it. Pressing Check again on a healthy, unchanged
    // installation used to take the four fieldsets and the plan off screen and
    // then buy them back with a second msconvert help probe. Nothing about the
    // installation changed, so nothing about what it offers may move.
    let catalogs = 0;
    let checks = 0;
    const recheck = deferred<typeof availableBackend>();
    const { api, panel } = await openTheSettings({
      availability: () => {
        checks += 1;
        return checks === 1 ? Promise.resolve(availableBackend) : recheck.promise;
      },
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog());
      },
    });
    await waitFor(() => {
      expect(convertButton(panel)).toBeEnabled();
    });
    expect(catalogs).toBe(1);
    const precision = planFact(panel, "Numeric precision");

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    // While the check runs the settings stay, the plan stays, and Convert is
    // refused for the reason that is true.
    await waitFor(() => {
      expect(convertButton(panel)).toBeDisabled();
    });
    expect(choice(panel, "Peak processing", "No additional centroiding").checked).toBe(true);
    expect(within(panel).getByRole("group", { name: "Numeric precision" })).toBeVisible();
    expect(planFact(panel, "Numeric precision")).toBe(precision);
    expect(describedText(convertButton(panel))).toContain(
      "unavailable while the installed ProteoWizard backend is being checked",
    );
    expect(catalogs).toBe(1);

    // It resolves, naming the installation that was already bound.
    await act(async () => {
      recheck.resolve(availableBackend);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(convertButton(panel)).toBeEnabled();
    });
    // Nothing was re-read, and the backend was asked exactly twice: once on
    // mount, once because the user asked.
    expect(catalogs).toBe(1);
    expect(api.calls().filter((command) => command === "inspectBackend")).toHaveLength(2);
    expect(planFact(panel, "Numeric precision")).toBe(precision);
  });

  it("drops the catalog when this session stops having a usable backend", async () => {
    // A catalog is an answer about one executable. When the session has none,
    // keeping the last one would leave the controls offering availability marks
    // for a build that is not installed, beside a banner saying none is.
    let usable = true;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: () => Promise.resolve(usable ? availableBackend : unavailableBackend),
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.settings.status).toBe("ready");
    });

    usable = false;
    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.settings.status).toBe("noBackend");
    });
    expect(rendered.result.current.conversion.settingsReadiness).toBe("unavailable");

    // And it comes back on its own when a usable installation does, without
    // anybody pressing anything.
    usable = true;
    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.settings.status).toBe("ready");
    });
  });

  it("revokes a catalog request when the backend goes, so a late reply cannot resurrect it", async () => {
    // The half the first repair did not cover. Dropping the catalog on screen
    // and revoking the read that produced it are one act; doing only the first
    // leaves an earlier reply authoritative, and it lands afterwards and puts
    // the lost executable's catalog back.
    //
    // Deterministic by construction: the first read is held open and released
    // by hand, after the loss, rather than raced against a timer.
    const held = deferred<ReturnType<typeof intentCatalog>>();
    let reads = 0;
    let usable = true;
    let generation = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: () =>
        Promise.resolve(
          usable
            ? { ...availableBackend, installationGeneration: generation }
            : { ...unavailableBackend, installationGeneration: generation },
        ),
      conversionIntents: () => {
        reads += 1;
        return reads === 1
          ? held.promise
          : Promise.resolve(intentCatalog({ installationGeneration: generation }));
      },
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    await waitFor(() => {
      expect(reads).toBe(1);
    });
    expect(rendered.result.current.conversion.settings.status).toBe("loading");

    // The session loses its ProteoWizard while that read is still outstanding.
    usable = false;
    generation = 1;
    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.settings.status).toBe("noBackend");
    });

    // The held reply lands. It describes a build this session can no longer
    // launch, and its request no longer has the authority to install it.
    await act(async () => {
      held.resolve(intentCatalog({ installationGeneration: 0 }));
      await Promise.resolve();
    });
    expect(rendered.result.current.conversion.settings.status).toBe("noBackend");
    expect(rendered.result.current.conversion.settingsReadiness).toBe("unavailable");
    // And no further read was provoked by it either.
    expect(reads).toBe(1);

    // A usable installation returns, and the catalog comes back on its own.
    usable = true;
    generation = 2;
    act(() => {
      rendered.result.current.checkBackend();
    });
    await waitFor(() => {
      const { settings } = rendered.result.current.conversion;
      expect(settings.status === "ready" && settings.catalog.installationGeneration).toBe(2);
    });
    expect(reads).toBe(2);
  });

  it("reconciles the installation a refused conversion was the first to resolve", async () => {
    // The pre-picker capability gate resolves the installed build and can be
    // the first thing in a session to see it replaced in place. Refusing does
    // not unlearn that: Rust records the identity it resolved, and the ordinary
    // slot read this document already makes after a failed dispatch carries
    // where the sequence now stands.
    //
    // Nothing here inspects what the refusal said. The document reconciles
    // because the number moved, not because an error was classified.
    const wide = intentFor({ precision: "mz64Intensity64" });
    let replaced = false;
    let catalogs = 0;
    let api!: FakePreviewApi;
    api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(
          // Build A runs everything; the build that replaces it runs only what
          // MSCanvas ships.
          replaced
            ? intentCatalog({
                unsupported: intentCatalog()
                  .intents.map((option) => option.intent.id)
                  .filter((id) => id !== SHIPPED_INTENT.id),
                installationGeneration: 1,
              })
            : intentCatalog(),
        );
      },
      conversion: () => {
        // BEGIN resolves the installed build, and what it resolves is a
        // different one. Recording that is what `note_resolved` does, and it
        // happens whether or not the request that provoked it is admitted --
        // which is the whole of this finding. Then the semantic that build
        // cannot express is refused.
        replaced = true;
        api.noteInstallationObserved();
        return Promise.reject({
          kind: "conversion_intent_unsupported",
          summary: "The installed ProteoWizard build does not offer that conversion option.",
          detail: null,
          retryable: false,
        });
      },
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });
    act(() => {
      rendered.result.current.conversion.chooseIntent(wide.id);
    });
    await waitFor(() => {
      const { settings } = rendered.result.current.conversion;
      expect(settings.status === "ready" && settings.selectedId).toBe(wide.id);
    });
    expect(rendered.result.current.conversion.settingsReadiness).toBe("ready");
    // The plan is re-read for the semantic just chosen, and a conversion may
    // only start the plan the user was shown.
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });
    const catalogsBefore = catalogs;
    const probesBefore = api.calls().filter((command) => command === "inspectBackend").length;

    act(() => {
      rendered.result.current.conversion.convert([VENDOR_ROW.handle]);
    });

    // The refusal is shown, and the document goes and looks -- which is what
    // tells it the sequence has moved.
    await waitFor(() => {
      expect(rendered.result.current.conversion.error?.kind).toBe(
        "conversion_intent_unsupported",
      );
    });
    await waitFor(() => {
      expect(catalogs).toBeGreaterThan(catalogsBefore);
    });
    await waitFor(() => {
      const { settings } = rendered.result.current.conversion;
      expect(settings.status === "ready" && settings.catalog.installationGeneration).toBe(1);
    });

    // The chosen semantic survived the change and is now truthfully refused,
    // rather than being silently replaced by the shipped posture.
    const { settings } = rendered.result.current.conversion;
    expect(settings.status === "ready" && settings.selectedId).toBe(wide.id);
    expect(rendered.result.current.conversion.settingsReadiness).toBe("unsupported");
    expect(rendered.result.current.conversion.state.status).toBe("idle");
    // **Once, and once only.** The slot read that carried the news is one of a
    // stream of readings that all carry it, so what makes this a reconciliation
    // rather than a stream of blocked backend processes is that the observation
    // is counted rather than acted on each time it arrives.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.calls().filter((command) => command === "inspectBackend")).toHaveLength(
      probesBefore + 1,
    );
    expect(catalogs).toBe(catalogsBefore + 1);
  });

  it("does not reconcile when a dispatch fails without the installation moving", async () => {
    // The other half of the same rule. A refusal is not evidence that anything
    // about the build changed, and a document that re-read its settings after
    // every failed press would be paying a help probe for a filename clash.
    let catalogs = 0;
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR_ROW],
      availability: availableBackend,
      conversionIntents: () => {
        catalogs += 1;
        return Promise.resolve(intentCatalog());
      },
      conversion: () =>
        Promise.reject({
          kind: "queue_output_name_collision",
          summary: "Two of those acquisitions would write the same file name.",
          detail: null,
          retryable: false,
        }),
    });
    const rendered = renderHook(() => usePreviewWorkspace(), {
      wrapper: ({ children }) =>
        createElement(
          WorkspaceDropTransportProvider,
          { value: createFakeWorkspaceDropTransport() },
          createElement(PreviewApiProvider, { value: api }, children),
        ),
    });
    act(() => {
      rendered.result.current.conversion.describe([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.planIsCurrent).toBe(true);
    });
    const catalogsBefore = catalogs;

    act(() => {
      rendered.result.current.conversion.convert([VENDOR_ROW.handle]);
    });
    await waitFor(() => {
      expect(rendered.result.current.conversion.error?.kind).toBe(
        "queue_output_name_collision",
      );
    });
    // The slot was read, because the slot is authoritative about what happened.
    // The settings were not, because nothing said they had changed.
    await act(async () => {
      await Promise.resolve();
    });
    expect(catalogs).toBe(catalogsBefore);
    expect(rendered.result.current.conversion.settings.status).toBe("ready");
  });

  it("never puts the choices back when the backend went while their read was pending", async () => {
    // The same revocation, watched on screen rather than in the state. A reader
    // who saw the controls vanish must not see them return -- offering
    // availability marks for a build this session has said it cannot launch.
    const held = deferred<ReturnType<typeof intentCatalog>>();
    let usable = true;
    let reads = 0;
    const { panel } = await openTheSettings({
      availability: () => Promise.resolve(usable ? availableBackend : unavailableBackend),
      conversionIntents: () => {
        reads += 1;
        return reads === 1 ? held.promise : Promise.resolve(intentCatalog());
      },
    });
    await waitFor(() => {
      expect(reads).toBe(1);
    });

    usable = false;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(within(panel).queryByRole("group", { name: "Peak processing" })).toBeNull();
    });

    // The held reply lands, describing the build that has gone.
    await act(async () => {
      held.resolve(intentCatalog());
      await Promise.resolve();
    });
    expect(within(panel).queryByRole("group", { name: "Peak processing" })).toBeNull();
    expect(within(panel).queryByRole("radio", { name: /64-bit/u })).toBeNull();
    expect(convertButton(panel)).toBeDisabled();
  });

  it("shows the ordinary control, and no way-out block, where one axis still reaches a runnable row", async () => {
    // The false sentence, on screen. A preserved 64/64 that this build cannot
    // run is one enabled precision step from the shipped posture, so there is
    // no dead end to announce.
    const everythingElse = intentCatalog()
      .intents.map((option) => option.intent.id)
      .filter((id) => id !== SHIPPED_INTENT.id);
    let replaced = false;
    const { api, panel } = await openTheSettings({
      availability: availableBackend,
      conversionIntents: () =>
        Promise.resolve(
          replaced
            ? intentCatalog({ unsupported: everythingElse, installationGeneration: 1 })
            : intentCatalog(),
        ),
    });
    await waitFor(() => {
      expect(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u)).toBeEnabled();
    });
    fireEvent.click(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u));
    await waitFor(() => {
      expect(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u).checked).toBe(true);
    });

    replaced = true;
    api.noteInstallationObserved();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    // The chosen semantic is preserved and now truthfully refused. It stays
    // *checked* rather than disabled -- a radio showing what you chose is not a
    // claim that you may choose it again -- and the refusal is said once, where
    // the action is.
    await waitFor(() => {
      expect(
        within(panel).getByText(
          /installed ProteoWizard build does not offer the conversion settings you chose/u,
        ),
      ).toBeVisible();
    });
    expect(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u).checked).toBe(true);

    // The route out is an ordinary control, offered and takeable.
    const shipped = choice(panel, "Numeric precision", /64-bit · intensity 32-bit/u);
    expect(shipped).toBeEnabled();
    // So nothing claims there is no such route.
    expect(
      within(panel).queryByRole("button", { name: "Use the settings MSCanvas ships" }),
    ).toBeNull();
    expect(panel.textContent ?? "").not.toContain("no single change to one of them reaches");

    fireEvent.click(shipped);
    await waitFor(() => {
      expect(choice(panel, "Numeric precision", /64-bit · intensity 32-bit/u).checked).toBe(true);
    });
  });

  it("takes the way out from the keyboard where there really is no other route", async () => {
    const everythingElse = intentCatalog()
      .intents.map((option) => option.intent.id)
      .filter((id) => id !== SHIPPED_INTENT.id);
    let replaced = false;
    const { api, panel } = await openTheSettings({
      availability: availableBackend,
      conversionIntents: () =>
        Promise.resolve(
          replaced
            ? intentCatalog({ unsupported: everythingElse, installationGeneration: 1 })
            : intentCatalog(),
        ),
    });
    // Centroiding at 32/32, reached in two explicit steps while a build offers
    // it. Every one-axis neighbour of it needs an option the narrow build will
    // not declare.
    await waitFor(() => {
      expect(choice(panel, "Numeric precision", /32-bit · intensity 32-bit/u)).toBeEnabled();
    });
    fireEvent.click(choice(panel, "Numeric precision", /32-bit · intensity 32-bit/u));
    await waitFor(() => {
      expect(choice(panel, "Peak processing", "Centroid all MS levels")).toBeEnabled();
    });
    fireEvent.click(choice(panel, "Peak processing", "Centroid all MS levels"));
    await waitFor(() => {
      expect(choice(panel, "Peak processing", "Centroid all MS levels").checked).toBe(true);
    });

    replaced = true;
    api.noteInstallationObserved();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    const recover = await within(panel).findByRole("button", {
      name: "Use the settings MSCanvas ships",
    });
    // A real button, reachable and activatable without a pointer.
    recover.focus();
    expect(document.activeElement).toBe(recover);
    fireEvent.keyDown(recover, { key: "Enter" });
    fireEvent.click(recover);

    await waitFor(() => {
      expect(choice(panel, "Peak processing", "No additional centroiding").checked).toBe(true);
    });
    expect(choice(panel, "Numeric precision", /64-bit · intensity 32-bit/u).checked).toBe(true);
    expect(
      within(panel).queryByRole("button", { name: "Use the settings MSCanvas ships" }),
    ).toBeNull();
  });

  it("marks a preserved unrunnable selection unavailable where the reader meets it", async () => {
    // C4, on screen. The chosen semantic survives an installation change --
    // that is deliberate, and it is a scientific request rather than a property
    // of one catalog. What must not survive with it is the *appearance* of
    // being runnable: before this, all four groups showed the selection as an
    // ordinary checked, enabled radio carrying only its plain disclosure, and
    // the single sentence saying otherwise sat several elements away beside
    // Convert.
    const everythingElse = intentCatalog()
      .intents.map((option) => option.intent.id)
      .filter((id) => id !== SHIPPED_INTENT.id);
    let replaced = false;
    const { api, panel } = await openTheSettings({
      availability: availableBackend,
      conversionIntents: () =>
        Promise.resolve(
          replaced
            ? intentCatalog({ unsupported: everythingElse, installationGeneration: 1 })
            : intentCatalog(),
        ),
    });
    await waitFor(() => {
      expect(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u)).toBeEnabled();
    });
    fireEvent.click(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u));
    await waitFor(() => {
      expect(choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u).checked).toBe(true);
    });

    replaced = true;
    api.noteInstallationObserved();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    const chosen = () => choice(panel, "Numeric precision", /64-bit · intensity 64-bit/u);
    await waitFor(() => {
      expect(chosen()).toHaveAttribute("aria-disabled", "true");
    });
    // Still checked: it is what the user asked for, and deselecting it would be
    // the silent substitution this design refuses.
    expect(chosen().checked).toBe(true);
    // And the reason is what the control points at, not a sentence elsewhere.
    expect(describedText(chosen())).toContain(
      "The installed ProteoWizard build does not offer this option",
    );
    // Every group says the same thing about the one selection.
    for (const [group, label] of [
      ["Peak processing", "No additional centroiding"],
      ["Spectra included", "All spectra"],
      ["Array compression", "zlib compressed"],
    ] as const) {
      const selected = choice(panel, group, label);
      expect(selected.checked).toBe(true);
      expect(selected).toHaveAttribute("aria-disabled", "true");
      expect(describedText(selected)).toContain("does not offer this option");
    }
    // The lane refuses the conversion from its own authority, as it already did.
    expect(convertButton(panel)).toBeDisabled();
    // And an ordinary route out is still an ordinary enabled control.
    expect(choice(panel, "Numeric precision", /64-bit · intensity 32-bit/u)).toBeEnabled();
  });

  it("offers the catalog its own retry, which a backend recheck is not", async () => {
    // C1, on screen. A read that did not answer is not a build that offers
    // nothing, and nothing else will ask again: the installation has not
    // changed, so every signal keyed on one correctly stays where it is. Two
    // controls, two questions -- and pressing the wrong one must not silently
    // do the other's work.
    let catalogs = 0;
    const { api, panel } = await openTheSettings({
      availability: availableBackend,
      conversionIntents: () => {
        catalogs += 1;
        return catalogs === 1
          ? Promise.reject({
              kind: "provider_unavailable",
              summary: "MSCanvas could not read the installed ProteoWizard.",
              detail: null,
              retryable: true,
            })
          : Promise.resolve(intentCatalog());
      },
    });
    const retry = await within(panel).findByRole("button", { name: "Try again" });
    expect(catalogs).toBe(1);
    expect(describedText(retry)).toContain("could not read the installed ProteoWizard");
    expect(convertButton(panel)).toBeDisabled();

    // The backend banner's own control answers about the backend, and leaves
    // this alone.
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(api.calls().filter((command) => command === "inspectBackend")).toHaveLength(2);
    });
    expect(catalogs).toBe(1);
    expect(within(panel).getByRole("button", { name: "Try again" })).toBeInTheDocument();

    // This one answers about the catalog.
    fireEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(within(panel).getByRole("group", { name: "Numeric precision" })).toBeVisible();
    });
    expect(catalogs).toBe(2);
    expect(api.calls().filter((command) => command === "inspectBackend")).toHaveLength(2);
  });

  it("says why it will not convert when the catalog cannot be established", async () => {
    const { api, panel } = await openTheSettings({
      conversionIntents: () =>
        Promise.reject({
          kind: "provider_unavailable",
          summary: "MSCanvas could not read the installed ProteoWizard.",
          detail: null,
          retryable: false,
        }),
    });
    await waitFor(() => {
      expect(
        within(panel).getByText(/could not read which conversion settings/u),
      ).toBeVisible();
    });
    expect(convertButton(panel)).toBeDisabled();
    // Nothing manufactured a semantic from a failed read: no plan was asked for
    // and no conversion was started.
    expect(api.conversionRequests).toHaveLength(0);
    expect(api.conversionPlanRequests).toHaveLength(0);
  });
});
