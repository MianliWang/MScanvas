/**
 * Rendered QA for the one-to-many output topology.
 *
 * **What this is and is not.** jsdom lays nothing out, so nothing here measures
 * a pixel and none of it replaces a look at the real window — the narrow-layout
 * suite beside it says the same thing for the same reason. What it does hold is
 * the two halves a rendered check rests on: every state this milestone adds is
 * actually reachable and actually says what it should, and the stylesheet rules
 * that keep those states from clipping or overflowing exist and apply to the
 * elements that were added.
 *
 * Eight states, one per required scenario: a SCIEX-only plan, a mixed plan, a
 * running item, a ten-output success, a partial finalization, a stop, a
 * stop-failed queue, and a ten-member adoption with mixed outcomes.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import appStyles from "../app/app.css?raw";
import { App } from "../app/App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  outputSetReport,
  queueItem,
  queueOf,
  sciexQueueItem,
} from "./previewFixtures";
import type { FakePreviewApi } from "./previewFixtures";
import type { SelectedFile, WorkspaceConversionState } from "../features/mzml-preview/contracts";

const mountedStyles: HTMLStyleElement[] = [];

function mountStyles(css: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  mountedStyles.push(style);
  return style;
}

afterEach(() => {
  for (const style of mountedStyles.splice(0)) {
    style.remove();
  }
});

/** One rule of the mounted stylesheet, by its exact selector. */
function ruleFor(style: HTMLStyleElement, selector: string): CSSStyleRule {
  const normalize = (text: string) =>
    text
      .split(",")
      .map((part) => part.trim())
      .join(", ");
  const rule = [...(style.sheet?.cssRules ?? [])].find(
    (candidate): candidate is CSSStyleRule =>
      candidate instanceof CSSStyleRule &&
      normalize(candidate.selectorText) === normalize(selector),
  );
  if (rule === undefined) {
    throw new Error(`no rule for ${selector}`);
  }
  return rule;
}

/** An acquisition name long enough that an unbounded cell would run away. */
const LONG_NAME = `${"Enolase_repeats_AQv1.4.2_".repeat(6)}acquisition.wiff`;

const bundle: SelectedFile = {
  handle: "file-9",
  fileName: LONG_NAME,
  byteLength: 3_944_804,
  sourceKind: "sciex_wiff",
  relativeContext: null,
};

const thermo: SelectedFile = {
  handle: "file-1",
  fileName: "run-1.raw",
  byteLength: 78_309,
  sourceKind: "thermo_raw",
  relativeContext: null,
};

const TEN_MEMBERS = Array.from(
  { length: 10 },
  (_, index) => `acquisition-20070918_en_${String(index + 1).padStart(2, "0")}.mzML`,
);

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

async function renderState(
  state: WorkspaceConversionState,
  datasets: readonly SelectedFile[] = [bundle],
): Promise<HTMLElement> {
  const api = createFakePreviewApi({
    initialDatasets: [...datasets],
    availability: availableBackend,
    initialConversion: state,
  });
  renderApp(api);
  return await waitFor(() => {
    const node = document.querySelector(".conversion-running");
    if (node === null) {
      throw new Error("expected a queue on screen");
    }
    return node as HTMLElement;
  });
}

/** Every visible text node of a subtree, with the polite mirrors dropped. */
function visibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const aside of clone.querySelectorAll("[aria-live], script, style")) {
    aside.remove();
  }
  return clone.textContent ?? "";
}

const fullSet = outputSetReport("file-9", TEN_MEMBERS);

const partialSet = outputSetReport("file-9", TEN_MEMBERS.slice(0, 4), {
  groupOutcome: "partially_finalized",
  finalizedCount: 2,
  notPublishedCount: 2,
  memberStates: ["finalized", "finalized", "validated", "validated"],
  completeness: { kind: "notPosed" },
  partial: { finalizedCount: 2, notPublishedCount: 2, failureKind: "already_exists" },
  completeSetAdoptable: false,
});

describe("rendered QA for the one-to-many output topology", () => {
  it("bounds a long acquisition name and its set output with real stylesheet rules", () => {
    const style = mountStyles(appStyles);

    // The acquisition's own name is bounded exactly as it always was.
    const names = ruleFor(style, ".conversion-queue-name, .conversion-queue-output");
    expect(names.style.getPropertyValue("overflow")).toBe("hidden");
    expect(names.style.getPropertyValue("text-overflow")).toBe("ellipsis");
    expect(names.style.getPropertyValue("min-width")).toBe("0px");

    // The set output deliberately does *not* ellipsize, because the sentence
    // that explains the missing filename is the part that would be clipped --
    // so it wraps instead, and its own `min-width: 0` keeps it from forcing the
    // row wider than the panel.
    // The member list wraps rather than ellipsizing: a truncated filename is
    // not one anybody can find in a folder.
    const memberList = ruleFor(style, ".conversion-queue-set-members");
    expect(memberList.style.getPropertyValue("overflow-wrap")).toBe("anywhere");
    expect(memberList.style.getPropertyValue("min-width")).toBe("0px");
    expect(memberList.style.getPropertyValue("flex")).toContain("100%");

    const set = ruleFor(style, ".conversion-queue-output-set");
    expect(set.style.getPropertyValue("white-space")).toBe("normal");
    expect(set.style.getPropertyValue("overflow-wrap")).toBe("anywhere");
    expect(set.style.getPropertyValue("min-width")).toBe("0px");
    expect(set.style.getPropertyValue("flex-wrap")).toBe("wrap");

    // And every new status line takes a row of its own and wraps, rather than
    // competing with the two names for the first line.
    const status = ruleFor(
      style,
      ".conversion-queue-status, .conversion-queue-attempts, .conversion-queue-facts, .conversion-queue-reason, .conversion-queue-residue, .conversion-queue-set-result, .conversion-queue-set-completeness, .conversion-queue-set-partial",
    );
    expect(status.style.getPropertyValue("flex")).toContain("100%");
    expect(status.style.getPropertyValue("overflow-wrap")).toBe("anywhere");
    expect(status.style.getPropertyValue("min-width")).toBe("0px");
  });

  it("distinguishes a one-to-many row from a one-to-one row without colour", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [thermo, bundle],
      availability: availableBackend,
    });
    renderApp(api);
    await screen.findByRole("option", { name: new RegExp(LONG_NAME.slice(0, 20)) });
    const rows = within(screen.getByRole("listbox", { name: "Workspace" })).getAllByRole("option");
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1], { ctrlKey: true });

    const panel = await screen.findByRole("region", { name: "Convert" });
    // Waited for rather than read once. The panel is on screen before the plan
    // is: since M6.4 a plan is an answer about a chosen semantic, so the block
    // exists -- with its settings and its refused control -- while the read is
    // still in flight.
    const outputs = await waitFor(() => {
      const found = [...panel.querySelectorAll(".conversion-queue-output")];
      expect(found).toHaveLength(2);
      return found;
    });

    // The distinction is structural: a different attribute and different text,
    // neither of which needs a colour to be read.
    expect(outputs[0]?.getAttribute("data-output-topology")).toBeNull();
    expect(outputs[1]?.getAttribute("data-output-topology")).toBe("backendNamedSet");
    expect(outputs[0]?.textContent).toBe("run-1.mzML");
    expect(outputs[1]?.textContent).toContain("1–24 mzML outputs");

    // No cell is blank, which is the defect the wire contract exists to
    // prevent and the one a rendered check would catch first.
    for (const cell of outputs) {
      expect((cell.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("renders a SCIEX-only plan with no blank column and no invented name", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
    });
    renderApp(api);
    const panel = await screen.findByRole("region", { name: "Convert" });
    await waitFor(() => {
      expect(
        within(panel).getByText(/One SCIEX WIFF acquisition will be converted to mzML\./),
      ).toBeVisible();
    });
    const output = panel.querySelector(".conversion-queue-output");
    expect(output?.textContent).toContain("1–24 mzML outputs");
    // The acquisition's own stem must not appear in what it converts *to*.
    expect(output?.textContent).not.toContain("Enolase_repeats");
    expect(output?.textContent).not.toMatch(/\.mzML$/);
  });

  it("renders a running SCIEX item as one acquisition of the queue", async () => {
    const queue = await renderState(
      {
        status: "running",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", LONG_NAME, { state: "running" }),
          queueItem("file-1", "run-1.raw"),
        ]),
      },
      [bundle, thermo],
    );

    expect(visibleText(queue)).toContain("Converting item 1 of 2…");
    // The running item still shows its topology rather than a blank.
    const output = queue.querySelector(".conversion-queue-output-set");
    expect(output?.textContent).toContain("1–24 mzML outputs");
  });

  it("renders a ten-output success with every claim and none of the wider ones", async () => {
    const queue = await renderState({
      status: "terminal",
      reason: "completed",
      operationId: "1",
      queue: queueOf([
        sciexQueueItem("file-9", LONG_NAME, {
          state: "finalized",
          attempts: 1,
          result: { kind: "outputSet", report: fullSet },
        }),
      ]),
    });

    const text = visibleText(queue);
    expect(text).toContain("10 mzML outputs finalized.");
    expect(text).toContain("Every sample identified by the SCIEX reader produced its output.");
    // The output column now counts rather than ranging, because the count is
    // real once the run has finished.
    expect(queue.querySelector(".conversion-queue-output-set")?.textContent).toContain(
      "10 mzML outputs",
    );
    // Every claim this must never make.
    for (const forbidden of [
      /10 of 10 source samples/i,
      /fully verified/i,
      /source fidelity/i,
      /all samples in the acquisition/i,
    ]) {
      expect(document.body.textContent ?? "").not.toMatch(forbidden);
    }
    // The status is in words, not only in colour.
    expect(queue.querySelector(".conversion-queue-status")?.textContent).toBe("Converted");

    // Every finalized member is named, so the count is an answer rather than a
    // number, and the block that holds them is bounded by what produced them.
    const members = [...queue.querySelectorAll(".conversion-queue-set-members > li")].map(
      (node) => node.textContent,
    );
    expect(members).toEqual(TEN_MEMBERS);
    expect(members.length).toBeLessThanOrEqual(fullSet.maxMembers);
  });

  it("renders a partial finalization as a warning rather than an ordinary success", async () => {
    const queue = await renderState({
      status: "terminal",
      reason: "completed",
      operationId: "1",
      queue: queueOf([
        sciexQueueItem("file-9", LONG_NAME, {
          state: "failed",
          attempts: 1,
          retryable: false,
          result: { kind: "outputSet", report: partialSet },
        }),
      ]),
    });

    const text = visibleText(queue);
    expect(text).toContain("2 of 4 mzML outputs finalized; 2 not published.");
    expect(text).toMatch(/complete output set was not produced/i);
    // Carried by a note and by the item's own state attribute, not by colour.
    const partial = queue.querySelector(".conversion-queue-set-partial");
    expect(partial?.getAttribute("role")).toBe("note");

    // The prefix is named and the unpublished members are not: the list is what
    // is in the folder, which is what the copy beside it sends the user to.
    const kept = [...queue.querySelectorAll(".conversion-queue-set-members > li")].map(
      (node) => node.textContent,
    );
    expect(kept).toEqual(TEN_MEMBERS.slice(0, 2));
    expect(queue.querySelector("li")?.getAttribute("data-item-state")).toBe("failed");
    expect(queue.querySelector(".conversion-queue-status")?.textContent).toBe("Failed");
    // Not an ordinary success, and no completeness claim at all.
    expect(text).not.toContain("Converted");
    expect(text).not.toContain("Every sample identified by the SCIEX reader");
    // And the sentence that would be false.
    expect(document.body.textContent ?? "").not.toContain(
      "Nothing was converted, so there is nothing to add",
    );
  });

  it("renders a stop around a set item honestly", async () => {
    const stopped = await renderState(
      {
        status: "terminal",
        reason: "stopped",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", LONG_NAME, {
            state: "cancelled",
            attempts: 1,
            cancellation: {
              processLaunched: true,
              terminationRequested: true,
              treeTerminationConfirmed: true,
              elapsedMilliseconds: 42,
              termination: "terminated",
              partialOutputObserved: true,
              stagingResidue: null,
            },
          }),
          queueItem("file-1", "run-1.raw", { state: "notRun" }),
        ]),
      },
      [bundle, thermo],
    );
    const stoppedText = visibleText(stopped);
    expect(stoppedText).toContain("Queue stopped");
    expect(stoppedText).toContain("Cancelled");
    expect(stoppedText).toContain("Not run");
    // A cancelled set still shows its topology rather than a blank column.
    expect(stopped.querySelector(".conversion-queue-output-set")?.textContent).toContain(
      "1–24 mzML outputs",
    );
    // Nothing claims the stop rolled anything back.
    expect(stoppedText).toMatch(/Completed outputs remain in the destination folder/);
    expect(stoppedText).not.toMatch(/rolled back|undone|reverted/i);
  });

  it("renders a stop-failed queue around a set item honestly", async () => {
    // A stop that could not be confirmed says exactly that, in words.
    const unconfirmed = await renderState({
      status: "terminal",
      reason: "stopFailed",
      operationId: "2",
      queue: queueOf([
        sciexQueueItem("file-9", LONG_NAME, {
          state: "cancellationFailed",
          attempts: 1,
          cancellation: {
            processLaunched: true,
            terminationRequested: true,
            treeTerminationConfirmed: false,
            elapsedMilliseconds: 5_000,
            termination: null,
            partialOutputObserved: false,
            stagingResidue: "staging_not_removed",
          },
        }),
      ]),
    });
    const unconfirmedText = visibleText(unconfirmed);
    expect(unconfirmedText).toContain("Stop could not be confirmed");
    expect(unconfirmedText).toMatch(/could not remove its own temporary folder/);
  });

  it("renders ten adoption outcomes with mixed results, keyed apart", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [bundle],
      availability: availableBackend,
      initialConversion: {
        status: "terminal",
        reason: "completed",
        operationId: "1",
        queue: queueOf([
          sciexQueueItem("file-9", LONG_NAME, {
            state: "finalized",
            attempts: 1,
            result: { kind: "outputSet", report: fullSet },
          }),
        ]),
      },
      adoption: async (operationId, snapshot) =>
        await Promise.resolve({
          operationId,
          retryRound: 0,
          roster: snapshot(),
          // Eight added, one already present, one refused: every arm of the
          // outcome union at once, all of them from one queue item.
          outcomes: TEN_MEMBERS.map((outputFileName, memberIndex) => {
            const shared = {
              itemIndex: 0,
              memberIndex,
              sourceHandle: "file-9",
              outputFileName,
            };
            if (memberIndex === 8) {
              return {
                ...shared,
                kind: "alreadyInWorkspace" as const,
                dataset: {
                  handle: `existing-${String(memberIndex)}`,
                  fileName: outputFileName,
                  byteLength: 1_024,
                  sourceKind: "mzml" as const,
                  relativeContext: null,
                },
              };
            }
            if (memberIndex === 9) {
              return { ...shared, kind: "refused" as const, reason: "output_changed" };
            }
            return {
              ...shared,
              kind: "added" as const,
              dataset: {
                handle: `converted-${String(memberIndex)}`,
                fileName: outputFileName,
                byteLength: 1_024,
                sourceKind: "mzml" as const,
                relativeContext: null,
              },
            };
          }),
        }),
    });
    renderApp(api);

    fireEvent.click(
      await screen.findByRole("button", { name: "Add converted outputs to workspace" }),
    );
    await waitFor(() => {
      expect(screen.getByText("8 added, 1 already in the workspace, 1 not added.")).toBeVisible();
    });
    // The refusal names the member and the reason, in the user's terms.
    expect(
      screen.getByText(`${TEN_MEMBERS[9]} was not added: changed since it was converted.`),
    ).toBeVisible();

    // The action stays mounted and focusable rather than being replaced, so a
    // keyboard user does not lose their place while the adoption runs.
    const again = screen.getByRole("button", { name: "Add converted outputs to workspace" });
    again.focus();
    expect(document.activeElement).toBe(again);
  });
});
