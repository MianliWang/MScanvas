/**
 * One fact, one element, in the document that ships.
 *
 * `conversionNoticeRegistry.test.ts` pins the rule. What is pinned here is the
 * DOM: that the panel renders one node per refusing fact however many controls
 * reach it, that every control points `aria-describedby` at *that* node, and
 * that no id in the conversion surface is minted twice.
 *
 * The sweep is deliberately generic. Asserting that one known id appears once
 * is a statement about the pair that was broken last time; what has to stay true
 * is that no id anywhere in the panel is ambiguous, because the next duplicate
 * will be a different pair.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  BackendAvailability,
  ConversionConfigurationSnapshot,
  SelectedFile,
} from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { PreviewApiProvider } from "./api";
import { App } from "../../app/App";
import type { Deferred, FakePreviewApi, FakePreviewApiOptions } from "../../test/previewFixtures";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  firstBindingReceipt,
  previewError,
  settledAt,
} from "../../test/previewFixtures";

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const VENDOR = acquisition(1);

/** A build whose help would not parse: the state that offers an explicit retry. */
const FAILED_CATALOG: ConversionConfigurationSnapshot = {
  authority: settledAt(1, firstBindingReceipt),
  configuration: {
    configuration: "failed",
    error: previewError({
      kind: "backend_help_unreadable",
      summary: "The installed ProteoWizard did not describe the commands MSCanvas needs.",
    }),
  },
  outcome: { outcome: "answered" },
};

function mount(options: FakePreviewApiOptions = {}): FakePreviewApi {
  const api = createFakePreviewApi({
    initialDatasets: [VENDOR],
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
 * Every id used more than once anywhere in the rendered document.
 *
 * The whole document rather than the panel alone: an id is global, and a second
 * owner outside the panel is exactly as ambiguous for a screen reader as one
 * inside it.
 */
function duplicateIds(): string[] {
  const seen = new Map<string, number>();
  for (const element of document.querySelectorAll("[id]")) {
    const id = element.id;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
}

/** Every id one control names, in order. */
function describedBy(control: Element): string[] {
  return (control.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id !== "");
}

/** How many elements in the document carry this id. */
function owners(id: string): number {
  return document.querySelectorAll(`[id="${id}"]`).length;
}

/**
 * A backend check this test holds open.
 *
 * `backendChanging` is a window, not a state a fixture can be handed: the only
 * honest way to render the panel inside it is to press `Check again` and not
 * answer.
 */
function heldRecheck(): {
  readonly held: Deferred<BackendAvailability>;
  readonly availability: () => Promise<BackendAvailability>;
} {
  const held = deferred<BackendAvailability>();
  let answered = 0;
  return {
    held,
    availability: () => {
      answered += 1;
      return answered === 1 ? Promise.resolve(availableBackend) : held.promise;
    },
  };
}

/** Presses the banner's own recheck, which is not a conversion action. */
async function pressCheckAgain(): Promise<void> {
  const control = await screen.findByRole("button", { name: "Check again" });
  fireEvent.click(control);
}

describe("a failed catalog beside a backend check", () => {
  it("gives both refused controls one element, and names it from both", async () => {
    // The combined state ADR 0044 Decision 12 is about: `Convert` and the
    // settings read are refused by one fact, in two different authorities'
    // vocabularies.
    const recheck = heldRecheck();
    mount({ availability: recheck.availability, conversionConfiguration: FAILED_CATALOG });
    const panel = await screen.findByRole("region", { name: "Convert" });
    const retry = await within(panel).findByRole("button", {
      name: "Read the settings again",
    });
    await pressCheckAgain();

    const convert = within(panel).getByRole("button", { name: /^Convert/ });
    await waitFor(() => {
      expect(convert).toBeDisabled();
    });
    expect(retry).toBeDisabled();

    const id = "conversion-availability-backend-changing";
    // One element in the whole document owns the fact.
    expect(owners(id)).toBe(1);
    // And it says the fact, not what either control cannot do.
    expect(document.getElementById(id)?.textContent).toBe(
      "MSCanvas is checking the installed ProteoWizard.",
    );
    // Both controls name that one element.
    expect(describedBy(convert)).toContain(id);
    expect(describedBy(retry)).toContain(id);
    // The settings retry keeps its own domain error beside the shared fact:
    // one is about this read, the other about the lane, and they have different
    // owners.
    expect(describedBy(retry)).toEqual(["conversion-settings-failure", id]);
    expect(owners("conversion-settings-failure")).toBe(1);
  });

  it("leaves no ambiguous id anywhere in the document", async () => {
    const recheck = heldRecheck();
    mount({ availability: recheck.availability, conversionConfiguration: FAILED_CATALOG });
    await screen.findByRole("region", { name: "Convert" });
    await screen.findByRole("button", { name: "Read the settings again" });
    await pressCheckAgain();
    await waitFor(() => {
      expect(owners("conversion-availability-backend-changing")).toBe(1);
    });

    expect(duplicateIds()).toEqual([]);
  });

  it("keeps every described-by target real, and every target populated", async () => {
    // A described-by pointing at nothing is a promise of an explanation that is
    // not there; one pointing at an empty node is the same promise, kept badly.
    const recheck = heldRecheck();
    mount({ availability: recheck.availability, conversionConfiguration: FAILED_CATALOG });
    await screen.findByRole("region", { name: "Convert" });
    await screen.findByRole("button", { name: "Read the settings again" });
    await pressCheckAgain();
    await waitFor(() => {
      expect(owners("conversion-availability-backend-changing")).toBe(1);
    });

    for (const control of document.querySelectorAll("[aria-describedby]")) {
      for (const id of describedBy(control)) {
        const target = document.getElementById(id);
        expect(target, `${control.textContent ?? ""} names ${id}`).not.toBeNull();
        expect((target?.textContent ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the settings retry reachable from the keyboard once the check answers", async () => {
    const recheck = heldRecheck();
    mount({ availability: recheck.availability, conversionConfiguration: FAILED_CATALOG });
    await screen.findByRole("region", { name: "Convert" });
    const retry = await screen.findByRole("button", { name: "Read the settings again" });
    await pressCheckAgain();
    await waitFor(() => {
      expect(retry).toBeDisabled();
    });

    recheck.held.resolve(availableBackend);
    await waitFor(() => {
      expect(retry).toBeEnabled();
    });
    // The control is a real button, so the platform's own activation reaches it
    // and nothing here has taken it out of the tab order while it was refused.
    retry.focus();
    expect(document.activeElement).toBe(retry);
    expect(retry.tagName).toBe("BUTTON");
    // And the shared sentence went with the fact that made it.
    expect(owners("conversion-availability-backend-changing")).toBe(0);
  });
});

describe("a configuration probe beside a conversion control", () => {
  it("renders one probe notice, whichever action reaches it", async () => {
    const held = deferred<ConversionConfigurationSnapshot>();
    mount({ conversionConfiguration: () => held.promise });
    const panel = await screen.findByRole("region", { name: "Convert" });

    const id = "conversion-availability-configuration-probing";
    await waitFor(() => {
      expect(owners(id)).toBe(1);
    });
    const convert = within(panel).getByRole("button", { name: /^Convert/ });
    expect(convert).toBeDisabled();
    expect(describedBy(convert)).toContain(id);
    expect(duplicateIds()).toEqual([]);

    held.resolve({
      authority: settledAt(1, firstBindingReceipt),
      configuration: { configuration: "unattempted" },
      outcome: { outcome: "refused", reason: "backendBusy" },
    });
    await waitFor(() => {
      expect(owners(id)).toBe(0);
    });
  });
});
