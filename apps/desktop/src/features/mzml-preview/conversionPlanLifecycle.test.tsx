/**
 * The receipt-bound plan, and the two gates before a queue, through the tree
 * that ships.
 *
 * `conversionPlanAuthority.test.ts` pins the rules. What is pinned here is that
 * the shipped wiring asks them: every assertion reaches the machine through
 * `usePreviewWorkspace` and the real panel, so a wiring that stopped comparing
 * would fail even while the comparison itself stayed correct.
 *
 * **Every race below is driven by hand.** A controlled promise the test
 * resolves is the only way to say *this reply arrives after that one* and mean
 * it; a timer would be asserting on the scheduler.
 */

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type {
  ConversionPlanOutcome,
  ConversionPlanRequest,
  DestinationPolicy,
  SelectedFile,
} from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import { App } from "../../app/App";
import { pressConvert } from "../../test/conversionPanelInteractions";
import type { Deferred, FakePreviewApi, FakePreviewApiOptions } from "../../test/previewFixtures";
import {
  availableBackend,
  completeCatalog,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  firstBindingReceipt,
  previewError,
  settledAt,
  shippedIntent,
} from "../../test/previewFixtures";

const OTHER_INTENT = completeCatalog[1]!.intent;

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const FIRST = acquisition(1);
const SECOND = acquisition(2);

function mount(options: FakePreviewApiOptions = {}): FakePreviewApi {
  const api = createFakePreviewApi({
    initialDatasets: [FIRST, SECOND],
    availability: availableBackend,
    ...options,
  });
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  return api;
}

/**
 * The hook, with the rows a screen would have given it.
 *
 * The rows are the screen's -- search, sort and focus resolve them there -- so
 * a hook test is the screen for as long as it runs. Everything else about the
 * question the hook reads from authorities of its own, which is exactly what
 * these tests are about.
 */
async function mountHook(api: PreviewApi, handles: readonly string[] = [FIRST.handle]) {
  const mounted = renderHook(() => usePreviewWorkspace(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        WorkspaceDropTransportProvider,
        { value: createFakeWorkspaceDropTransport() },
        createElement(PreviewApiProvider, { value: api }, children),
      ),
  });
  await waitFor(() => {
    expect(mounted.result.current.conversionConfiguration.configuration).not.toBeNull();
  });
  act(() => {
    mounted.result.current.conversionPlan.describe(handles);
  });
  return mounted;
}

/** A plan for whatever was asked, so an answer is never accidentally stale. */
function planFor(request: ConversionPlanRequest): ConversionPlanOutcome {
  const admitted = completeCatalog.find((row) => row.intent.id === request.intentId)!;
  return {
    outcome: "planned",
    plan: {
      items: request.handles.map((handle) => ({
        datasetHandle: handle,
        fileName: `${handle}.raw`,
        sourceKind: "thermo_raw" as const,
        output: { kind: "knownSingle" as const, fileName: `${handle}.mzML` },
      })),
      outputFormat: "mzML",
      compression: admitted.intent.compression === "zlib" ? "zlib" : "none",
      validationMode: "output_only",
      capacity: 16,
      intent: admitted.intent,
      conflictPolicy: request.conflictPolicy,
      receipt: request.expectedReceipt,
      destinationPolicy: request.destinationPolicy,
    },
  };
}

/**
 * A plan boundary a test drives one reply at a time.
 *
 * Records every question asked and hands back a promise per question, so a test
 * can answer them in whatever order the race it is about produces.
 */
function controlledPlans() {
  const asked: ConversionPlanRequest[] = [];
  const pending: Deferred<ConversionPlanOutcome>[] = [];
  return {
    asked,
    /** Answers the nth question asked, with a plan for the question it was. */
    answer(index: number, outcome?: ConversionPlanOutcome) {
      pending[index]!.resolve(outcome ?? planFor(asked[index]!));
    },
    fail(index: number, error = previewError({ kind: "plan_unreadable" })) {
      pending[index]!.reject(error);
    },
    conversionPlan: (request: ConversionPlanRequest) => {
      asked.push(request);
      const next = deferred<ConversionPlanOutcome>();
      pending.push(next);
      return next.promise;
    },
  };
}

/** The workspace's own view of what the panel would start. */
function planOf(result: { current: ReturnType<typeof usePreviewWorkspace> }) {
  return result.current.conversionPlan;
}

describe("the plan the panel is showing", () => {
  it("asks one question naming every fact that decides what the queue means", async () => {
    const plans = controlledPlans();
    const api = mount({ conversionPlan: plans.conversionPlan });
    await screen.findByRole("region", { name: "Convert" });

    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });
    expect(plans.asked[0]).toEqual({
      handles: [FIRST.handle],
      intentId: shippedIntent.id,
      conflictPolicy: "fail",
      expectedReceipt: firstBindingReceipt,
      destinationPolicy: { kind: "customFolder" },
    });
    // And nothing about the ordering token, which says which answer is newer
    // and never which installation one is about.
    expect(Object.keys(plans.asked[0]!)).not.toContain("revision");
    expect(api.calls()).toBeDefined();
  });

  it("never claims a request is in flight without one", async () => {
    // A session whose settings cannot be read has no plan question to pose, so
    // the panel is blocked rather than loading -- and nothing was asked.
    const plans = controlledPlans();
    mount({
      conversionPlan: plans.conversionPlan,
      conversionConfiguration: {
        authority: settledAt(1, firstBindingReceipt),
        configuration: { configuration: "failed", error: previewError() },
        outcome: { outcome: "answered" },
      },
    });
    const panel = await screen.findByRole("region", { name: "Convert" });

    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: /^Convert/ })).toBeDisabled();
    });
    expect(plans.asked).toHaveLength(0);
    expect(within(panel).queryByText(/Working out what this conversion would do/)).toBeNull();
  });

  it("discards a late answer to a question the reader has moved on from", async () => {
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });

    // The reader chooses another combination, which is another question.
    act(() => {
      result.current.conversionConfiguration.select(OTHER_INTENT.id);
    });
    await waitFor(() => {
      expect(plans.asked).toHaveLength(2);
    });
    expect(plans.asked[1]?.intentId).toBe(OTHER_INTENT.id);

    // The first question's answer arrives last. It is a perfectly good plan --
    // for a combination nobody is asking about any more.
    await act(async () => {
      plans.answer(0);
      await Promise.resolve();
    });
    expect(planOf(result).current).toBeNull();
    expect(planOf(result).startPlan).toBe("reading");

    // And the answer to the question being asked installs.
    await act(async () => {
      plans.answer(1);
      await Promise.resolve();
    });
    expect(planOf(result).current?.plan.intent.id).toBe(OTHER_INTENT.id);
    expect(planOf(result).startPlan).toBe("ready");
  });

  it("discards a late answer about rows the reader has changed", async () => {
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });

    // Both rows, which is a queue of two.
    act(() => {
      result.current.conversionPlan.describe([FIRST.handle, SECOND.handle]);
    });
    await waitFor(() => {
      expect(plans.asked).toHaveLength(2);
    });
    expect(plans.asked[1]?.handles).toEqual([FIRST.handle, SECOND.handle]);

    await act(async () => {
      plans.answer(0);
      await Promise.resolve();
    });
    expect(planOf(result).current).toBeNull();

    await act(async () => {
      plans.answer(1);
      await Promise.resolve();
    });
    expect(planOf(result).current?.plan.items).toHaveLength(2);
  });

  it("discards a late answer under a conflict policy the reader has changed", async () => {
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });

    act(() => {
      result.current.conversion.setConflictPolicy("skip");
    });
    await waitFor(() => {
      expect(plans.asked).toHaveLength(2);
    });
    expect(plans.asked[1]?.conflictPolicy).toBe("skip");

    await act(async () => {
      plans.answer(0);
      await Promise.resolve();
    });
    expect(planOf(result).current).toBeNull();

    await act(async () => {
      plans.answer(1);
      await Promise.resolve();
    });
    expect(planOf(result).current?.plan.conflictPolicy).toBe("skip");
  });

  it("discards a late answer about the installation the session has left", async () => {
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });
    const under = plans.asked[0]!.expectedReceipt;

    // The reader points MSCanvas at another ProteoWizard. The binding is
    // replaced, so everything read from the previous one stops describing this
    // session -- the plan included.
    await act(async () => {
      result.current.chooseInstallation();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(plans.asked.length).toBeGreaterThan(1);
    });
    const now = plans.asked[plans.asked.length - 1]!.expectedReceipt;
    expect(now).not.toBe(under);

    await act(async () => {
      plans.answer(0);
      await Promise.resolve();
    });
    expect(planOf(result).current).toBeNull();
  });

  it("stops standing for a plan the moment the installation under it is replaced", async () => {
    // A plan is answered and on screen; the session then moves to another
    // build, with the rows, the combination and the policy all unchanged.
    // Nothing about what the reader selected has moved -- and the answer
    // describes a conversion on a build this session is no longer on, so it may
    // not go on standing for the one it would now start.
    //
    // Two independent guards produce this, and that is deliberate: the
    // configuration held for the previous binding stops being current, and the
    // plan's own question names the binding it was asked under. The second is
    // what covers a read that observes the replacement and answers for the new
    // binding in one response, where there is no window with no catalog at all;
    // it is proved on its own in `conversionPlanAuthority.test.ts`, because
    // this path reaches the first guard before it.
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });
    await act(async () => {
      plans.answer(0);
      await Promise.resolve();
    });
    expect(planOf(result).startPlan).toBe("ready");
    const under = planOf(result).current?.plan.receipt;

    await act(async () => {
      result.current.chooseInstallation();
      await Promise.resolve();
    });

    // Not stale, not hidden: not current. Convert may not be offered from it,
    // and the summary it would act on is gone.
    await waitFor(() => {
      expect(planOf(result).current).toBeNull();
    });
    expect(planOf(result).startPlan).not.toBe("ready");
    const asked = plans.asked;
    expect(asked[asked.length - 1]?.expectedReceipt).not.toBe(under);
  });

  it("does not re-ask a question because the authority published again", async () => {
    // A verdict moving on a build that has not changed publishes a newer
    // projection at one receipt. It is news about the installation's preview
    // grammar and about nothing this plan describes, so a machine that re-asked
    // for it would spend a request on an answer it already has.
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });
    await act(async () => {
      plans.answer(0);
      await Promise.resolve();
    });
    expect(planOf(result).startPlan).toBe("ready");

    // The same build, judged again and judged unusable for preview: the files
    // have not changed, so the receipt cannot move, and what is projected has,
    // so the revision must. This is the one case that tells an ordering token
    // from an identity, and a question carrying the revision would call its own
    // answer stale for it.
    const rendered = planOf(result).current!.plan.receipt;
    act(() => {
      api.judgeTheBuildUnpreviewable();
    });
    await act(async () => {
      result.current.checkBackend();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.backend.status).toBe("resolved");
    });
    const projected = api.deliveredVerdicts[api.deliveredVerdicts.length - 1]!.authority;
    expect(projected.state.state === "settled" && projected.state.receipt).toBe(rendered);
    expect(projected.revision).toBeGreaterThan(1);

    expect(plans.asked).toHaveLength(1);
    expect(planOf(result).startPlan).toBe("ready");
    expect(planOf(result).current?.plan.receipt).toBe(rendered);
  });

  it("re-asks the same question when the reader asks it again, and ignores the first reply", async () => {
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });
    await act(async () => {
      plans.fail(0);
      await Promise.resolve();
    });
    expect(planOf(result).startPlan).toBe("failed");
    expect(planOf(result).retryOffered).toBe(true);

    act(() => {
      planOf(result).retry();
    });
    await waitFor(() => {
      expect(plans.asked).toHaveLength(2);
    });
    // The same question, which is the point: a retry that changed it would be
    // asking for something else.
    expect(plans.asked[1]).toEqual(plans.asked[0]);

    await act(async () => {
      plans.answer(1);
      await Promise.resolve();
    });
    expect(planOf(result).startPlan).toBe("ready");
  });

  it("does not re-ask a question a refusal did not move", async () => {
    // A plan refused for naming a binding Rust has left normally moves the
    // question: the projection it carries is newer, so accepting it replaces
    // the rendered receipt. This drives the case where that does not hold --
    // a projection older than what is on screen, which is discarded -- because
    // a machine that re-asked here would be woken by its own refusal, and
    // refused again, at IPC speed.
    let asked = 0;
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: () => {
        asked += 1;
        return Promise.resolve({
          outcome: "bindingReplaced" as const,
          authority: settledAt(0, 99),
        });
      },
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(asked).toBe(1);
    });

    // Several commits later, the question is still the one it was and nothing
    // has been asked again.
    for (let round = 0; round < 3; round += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(asked).toBe(1);
    expect(planOf(result).state.status).toBe("failed");
    // And the reader is left with the one control that asks again, rather than
    // with a panel asking for them.
    expect(planOf(result).retryOffered).toBe(true);
  });

  it("withdraws the re-ask when the failure stops being about the question asked", async () => {
    // A control offered beside "Working out what this conversion would do…"
    // would be offering a reader a re-ask of a question they have left --
    // and pressing it would ask for exactly the thing they moved away from.
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });
    await act(async () => {
      plans.fail(0);
      await Promise.resolve();
    });
    expect(planOf(result).retryOffered).toBe(true);
    expect(planOf(result).error).not.toBeNull();

    // The reader chooses another combination. The failure is still held -- it
    // is the answer to a question -- and it is not this one.
    act(() => {
      result.current.conversionConfiguration.select(OTHER_INTENT.id);
    });
    await waitFor(() => {
      expect(plans.asked).toHaveLength(2);
    });
    expect(planOf(result).startPlan).toBe("reading");
    expect(planOf(result).retryOffered).toBe(false);
    expect(planOf(result).error).toBeNull();

    // And pressing it anyway asks nothing, so a stale control that survived a
    // render could not re-ask the question the reader left.
    act(() => {
      planOf(result).retry();
    });
    expect(plans.asked).toHaveLength(2);
  });

  it("refuses Convert differently for a failed plan and one being worked out", async () => {
    const plans = controlledPlans();
    mount({ conversionPlan: plans.conversionPlan });
    const panel = await screen.findByRole("region", { name: "Convert" });

    await waitFor(() => {
      expect(within(panel).getByText(/Working out what this conversion would do/)).toBeVisible();
    });
    expect(within(panel).getByRole("button", { name: /^Convert/ })).toBeDisabled();
    expect(within(panel).queryByRole("button", { name: "Describe again" })).toBeNull();

    await act(async () => {
      plans.fail(0, previewError({ kind: "plan_unreadable", summary: "The plan was not read." }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(within(panel).getByText("The plan was not read.")).toBeVisible();
    });
    // A refused plan reads as failed, not as one being reread -- and it offers
    // the reader the one control that changes it.
    expect(within(panel).queryByText(/Working out what this conversion would do/)).toBeNull();
    expect(within(panel).getByRole("button", { name: "Describe again" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: /^Convert/ })).toHaveAccessibleDescription(
      expect.stringContaining("could not work out what this conversion would do"),
    );
  });

  it("renders the plan's own semantic rather than whatever the controls now say", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
    });
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={api}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(panel.querySelector(".conversion-queue-list")).not.toBeNull();
    });

    // Every axis of the combination the plan was computed under, said before a
    // folder is chosen.
    const summary = within(panel);
    expect(summary.getByText("Peaks").nextElementSibling?.textContent).toContain(
      "No additional centroiding",
    );
    expect(summary.getByText("Spectra")).toBeVisible();
    expect(summary.getByText("Stored precision")).toBeVisible();
    expect(summary.getAllByText("If an output name is taken").length).toBeGreaterThan(0);
    expect(summary.getByText("Requested destination").nextElementSibling?.textContent).toBe(
      "One local folder, chosen after Convert",
    );
  });
});

describe("starting the conversion the plan describes", () => {
  it.each((["ready", "loading"] as const).flatMap((initial) =>
    (["policy", "conflict", "intent", "rows", "name"] as const).map((component) => ({ initial, component })),
  ))("invalidates $initial A through same-batch $component A to B to A before any effect", async ({ initial, component }) => {
    const plans = controlledPlans();
    const api = createFakePreviewApi({ initialDatasets: [FIRST], availability: availableBackend, conversionPlan: plans.conversionPlan });
    const { result } = await mountHook(api);
    await waitFor(() => expect(plans.asked).toHaveLength(1));
    let aIndex = 0;
    if (component === "name") {
      act(() => result.current.conversion.setDestinationPolicy({ kind: "namedSubfolder", name: "A" }));
      await waitFor(() => expect(plans.asked).toHaveLength(2));
      aIndex = 1;
    }
    if (initial === "ready") await act(async () => plans.answer(aIndex));
    const question = planOf(result).question;
    if (question.kind !== "ask") throw new Error("expected a conversion question");
    const oldConvert = result.current.conversion.convert;
    act(() => {
      if (component === "policy") {
        result.current.conversion.setDestinationPolicy({ kind: "sourceSibling" });
        result.current.conversion.setDestinationPolicy({ kind: "customFolder" });
      } else if (component === "conflict") {
        result.current.conversion.setConflictPolicy("skip");
        result.current.conversion.setConflictPolicy("fail");
      } else if (component === "intent") {
        result.current.conversionConfiguration.select(OTHER_INTENT.id);
        result.current.conversionConfiguration.select(shippedIntent.id);
      } else if (component === "rows") {
        result.current.conversionPlan.describe([SECOND.handle]);
        result.current.conversionPlan.describe([FIRST.handle]);
      } else {
        result.current.conversion.setDestinationPolicy({ kind: "namedSubfolder", name: "B" });
        result.current.conversion.setDestinationPolicy({ kind: "namedSubfolder", name: "A" });
      }
      oldConvert(question.identity);
      expect(api.beginRequests()).toHaveLength(0);
    });
    await waitFor(() => expect(plans.asked).toHaveLength(aIndex + 2));
    expect(plans.asked[aIndex]).toEqual(plans.asked[aIndex + 1]);
    await act(async () => plans.answer(aIndex));
    expect(planOf(result).current).toBeNull();
    expect(planOf(result).state.status).toBe("loading");
    await act(async () => plans.answer(aIndex + 1));
    expect(planOf(result).startPlan).toBe("ready");
  });

  it("discards the first A reply after A to B to A issued a new ordinal", async () => {
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST], availability: availableBackend, conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => expect(plans.asked).toHaveLength(1));
    act(() => result.current.conversion.setDestinationPolicy({ kind: "sourceSibling" }));
    await waitFor(() => expect(plans.asked).toHaveLength(2));
    act(() => result.current.conversion.setDestinationPolicy({ kind: "customFolder" }));
    await waitFor(() => expect(plans.asked).toHaveLength(3));
    expect(plans.asked[0]).toEqual(plans.asked[2]);
    await act(async () => {
      plans.fail(0, previewError({ summary: "An obsolete failure." }));
      plans.answer(1);
    });
    expect(planOf(result).state.status).toBe("loading");
    expect(planOf(result).error).toBeNull();
    await act(async () => plans.answer(2));
    expect(planOf(result).startPlan).toBe("ready");
    expect(api.beginRequests()).toHaveLength(0);
  });

  it.each(["policy", "subfolder name", "conflict", "intent", "rows"] as const)(
    "rejects an old Convert handler after a %s setter in the same batch before effects",
    async (change) => {
      const plans = controlledPlans();
      const api = createFakePreviewApi({
        initialDatasets: [FIRST], availability: availableBackend,
        conversionPlan: plans.conversionPlan,
      });
      const { result } = await mountHook(api);
      await waitFor(() => expect(plans.asked).toHaveLength(1));
      await act(async () => plans.answer(0));
      if (change === "subfolder name") {
        act(() => result.current.conversion.setDestinationPolicy({ kind: "namedSubfolder", name: "Before" }));
        await waitFor(() => expect(plans.asked).toHaveLength(2));
        await act(async () => plans.answer(1));
      }
      const oldIdentity = planOf(result).current!.identity;
      const oldConvert = result.current.conversion.convert;
      const nextIndex = plans.asked.length;
      act(() => {
        if (change === "conflict") result.current.conversion.setConflictPolicy("skip");
        else if (change === "intent") result.current.conversionConfiguration.select(OTHER_INTENT.id);
        else if (change === "rows") result.current.conversionPlan.describe([SECOND.handle]);
        else result.current.conversion.setDestinationPolicy(change === "policy"
          ? { kind: "sourceSibling" }
          : { kind: "namedSubfolder", name: "After" });
        // Deliberately inside the same act, before React can render or run the
        // plan effect. An effect-only invalidation lets this old closure start.
        oldConvert(oldIdentity);
        expect(api.beginRequests()).toHaveLength(0);
      });
      expect(planOf(result).current).toBeNull();
      await waitFor(() => expect(plans.asked).toHaveLength(nextIndex + 1));
      await act(async () => plans.answer(nextIndex));
      act(() => oldConvert(oldIdentity));
      expect(api.beginRequests()).toHaveLength(0);
      act(() => result.current.conversion.convert(planOf(result).current!.identity));
      expect(api.beginRequests()).toEqual([plans.asked[nextIndex]]);
    },
  );

  it("keeps an invalid subfolder as a Rust refusal and recovers on a new name", async () => {
    const plans = controlledPlans();
    const api = mount({ conversionPlan: plans.conversionPlan });
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => expect(plans.asked).toHaveLength(1));
    await act(async () => plans.answer(0));
    expect(within(panel).getByRole("radio", { name: "Custom local folder" })).toBeChecked();
    fireEvent.click(within(panel).getByRole("radio", { name: "Named subfolder beside each source" }));
    await waitFor(() => expect(plans.asked).toHaveLength(2));
    fireEvent.change(within(panel).getByLabelText("Subfolder name"), { target: { value: "../taken " } });
    await waitFor(() => expect(plans.asked).toHaveLength(3));
    expect(plans.asked[2]!.destinationPolicy).toEqual({ kind: "namedSubfolder", name: "../taken " });
    await act(async () => {
      plans.fail(2, previewError({ kind: "subfolder_name_unusable", summary: "Use one local subfolder name." }));
      plans.answer(1); // A valid answer for the old name cannot erase the refusal.
    });
    expect(within(panel).getByRole("button", { name: "Convert focused…" })).toBeDisabled();
    expect(within(panel).getByText("Use one local subfolder name.")).toBeVisible();
    expect(within(panel).getByLabelText("Subfolder name")).toHaveAttribute("aria-invalid", "true");
    expect(api.beginRequests()).toHaveLength(0);
    fireEvent.change(within(panel).getByLabelText("Subfolder name"), { target: { value: "Results" } });
    await waitFor(() => expect(plans.asked).toHaveLength(4));
    await act(async () => plans.answer(3));
    expect(within(panel).getByRole("button", { name: "Convert focused…" })).toBeEnabled();
    expect(within(panel).getByText("Requested destination").nextElementSibling?.textContent).toContain("Results");
  });

  it.each<DestinationPolicy>([
    { kind: "customFolder" }, { kind: "sourceSibling" }, { kind: "namedSubfolder", name: "Results" },
  ])("sends the complete current destination $kind to BEGIN", async (destinationPolicy) => {
    const api = createFakePreviewApi({ initialDatasets: [FIRST], availability: availableBackend });
    const { result } = await mountHook(api);
    act(() => result.current.conversion.setDestinationPolicy(destinationPolicy));
    await waitFor(() => expect(planOf(result).current?.identity.destinationPolicy).toEqual(destinationPolicy));
    act(() => result.current.conversion.convert(planOf(result).current!.identity));
    expect(api.beginRequests()[0]).toEqual({
      handles: [FIRST.handle], intentId: shippedIntent.id, conflictPolicy: "fail",
      destinationPolicy, expectedReceipt: firstBindingReceipt,
    });
  });

  it("sends the plan's own question, not a list of rows", async () => {
    const api = mount();
    const panel = await screen.findByRole("region", { name: "Convert" });
    await pressConvert(panel, "Convert focused…");

    await waitFor(() => {
      expect(api.beginRequests()).toHaveLength(1);
    });
    // The same four facts the plan was computed under. A start that carried
    // fewer could be right about the rows and wrong about the build.
    expect(api.beginRequests()[0]).toEqual({
      handles: [FIRST.handle],
      intentId: shippedIntent.id,
      conflictPolicy: "fail",
      expectedReceipt: firstBindingReceipt,
      destinationPolicy: { kind: "customFolder" },
    });
  });

  it("refuses a start under an installation the session has left, and learns of it from the refusal", async () => {
    const api = mount();
    const panel = await screen.findByRole("region", { name: "Convert" });
    const convert = within(panel).getByRole("button", { name: "Convert focused…" });
    await waitFor(() => {
      expect(convert).toBeEnabled();
    });

    // Rust moves on and nothing says so: a refused start creates no queue, so
    // there is no slot to poll and nothing else would arrive to correct this
    // screen. Everything on it still belongs to the build it is showing.
    const checksBefore = api.calls().filter((call) => call === "inspectBackend").length;
    act(() => {
      api.replaceTheBindingSilently();
    });
    expect(convert).toBeEnabled();

    await act(async () => {
      fireEvent.click(convert);
      await Promise.resolve();
    });

    // Refused, and the refusal is where the panel learns of the replacement.
    await waitFor(() => {
      expect(
        within(panel).getByText(/The installed ProteoWizard changed, so this conversion was not started\./),
      ).toBeVisible();
    });
    // Nothing ran.
    expect(api.conversionRequests).toHaveLength(0);

    // **Nothing was asked in order to learn what the refusal already said**,
    // and that is an ordering claim rather than a zero-call one. The projection
    // travels with the answer precisely so that a session does not spend a
    // two-tool discovery on news it has been handed: the replacement is
    // *accepted* first, from the refusal itself, and only then does the banner
    // -- whose own reading was taken under the build the session has left --
    // owe the one check that replaces it.
    //
    // A blanket "no check after a delivery" would forbid that recovery too, and
    // would leave the banner naming a build nothing is bound to for the rest of
    // the session. What must not happen is a check *instead of* acceptance, or
    // a check per delivery.
    const accepted = api.planRequests().findIndex(
      (request) => request.expectedReceipt !== firstBindingReceipt,
    );
    expect(accepted).toBeGreaterThanOrEqual(0);
    await waitFor(() => {
      expect(api.calls().filter((call) => call === "inspectBackend")).toHaveLength(
        checksBefore + 1,
      );
    });
    // One, and it stays one. The refusal is a single delivery, so the
    // obligation it incurred is discharged once and is not re-issued by its own
    // answer.
    expect(api.calls().filter((call) => call === "inspectBackend")).toHaveLength(
      checksBefore + 1,
    );

    // And the plan that authorized nothing is not the plan any more. Asserted
    // through what a *second* press would send rather than through the frame
    // the button spends disabled: the panel re-asks its question under the
    // binding it has just been told about, and that is what makes the old one
    // unstartable rather than merely greyed.
    await waitFor(() => {
      const asked = api.planRequests();
      expect(asked[asked.length - 1]?.expectedReceipt).not.toBe(firstBindingReceipt);
    });
    await pressConvert(panel, "Convert focused…");
    await waitFor(() => {
      expect(api.beginRequests()).toHaveLength(2);
    });
    expect(api.beginRequests()[1]?.expectedReceipt).not.toBe(firstBindingReceipt);
    expect(api.beginRequests()[1]?.expectedReceipt).toBe(
      api.planRequests()[api.planRequests().length - 1]?.expectedReceipt,
    );
  });

  it("re-reads nothing when a start is refused on the installation it is already on", async () => {
    // The mirror case, and it is the one a heuristic gets wrong. A name
    // collision or a busy lane is not news about the installation, so nothing
    // about the session may be re-read for it -- and the plan on screen is
    // exactly as good as it was.
    const api = mount({
      conversionRefusal: () => ({
        outcome: "refused",
        error: previewError({
          kind: "queue_output_name_collision",
          summary: "Two of those rows would write one file.",
          retryable: false,
        }),
      }),
    });
    const panel = await screen.findByRole("region", { name: "Convert" });
    await pressConvert(panel, "Convert focused…");

    await waitFor(() => {
      expect(within(panel).getByText("Two of those rows would write one file.")).toBeVisible();
    });
    const reads = api.calls().filter((call) => call === "readConversionConfiguration").length;
    expect(reads).toBe(1);
    // And the plan is still the plan: a refusal is not a reason to re-describe
    // a conversion nothing has changed about.
    expect(within(panel).getByText(/will be converted to mzML/)).toBeVisible();
    expect(within(panel).getByRole("button", { name: /^Convert/ })).toBeEnabled();
  });

  it("offers a start only where the rendered control and the dispatch guard agree", async () => {
    // The one-availability-authority discipline, over the fact this slice adds.
    // A control that could be pressed while the plan is being worked out would
    // start a conversion nobody had read a description of.
    const plans = controlledPlans();
    const api = createFakePreviewApi({
      initialDatasets: [FIRST, SECOND],
      availability: availableBackend,
      conversionPlan: plans.conversionPlan,
    });
    const { result } = await mountHook(api);
    await waitFor(() => {
      expect(plans.asked).toHaveLength(1);
    });

    // Nothing is described yet. Both halves read that from one value: the
    // control's `disabled` is projected from `startPlan`, and the press has
    // nothing to take a question from, because `current` is where a question
    // comes from and it is the same comparison.
    expect(planOf(result).startPlan).toBe("reading");
    expect(planOf(result).current).toBeNull();
    expect(api.beginRequests()).toHaveLength(0);

    // Answered, and now both halves agree: the control is offered, and what it
    // starts is the question the summary beside it answers.
    await act(async () => {
      plans.answer(0);
      await Promise.resolve();
    });
    expect(planOf(result).startPlan).toBe("ready");
    await act(async () => {
      result.current.conversion.convert(planOf(result).current!.identity);
      await Promise.resolve();
    });
    expect(api.beginRequests()).toHaveLength(1);
    expect(api.beginRequests()[0]?.intentId).toBe(shippedIntent.id);
  });
});
