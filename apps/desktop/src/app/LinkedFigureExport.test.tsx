/**
 * The linked chromatogram + spectrum surface, through the shipped composition.
 *
 * Mounted as the document rather than as a harness, for the reason the
 * chromatogram's own export tests give: the questions worth asking are about
 * what the workspace hands this section -- which pair, which range, which
 * traces, and whether the one scientific export lane is respected -- and a
 * harness that supplied those itself would be testing the fixture.
 *
 * Two things this file is careful about throughout.
 *
 * **A closed control is asserted by pressing it.** `disabled` is an affordance;
 * what matters is that nothing crossed the boundary, so every unavailable case
 * clicks anyway and then proves the recorder is empty.
 *
 * **Nothing here is the science.** The marker's position, the pair's identity
 * and the range that was drawn are Rust's answers; this side sends two opaque
 * tokens and displays what comes back.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import appStyles from "./app.css?raw";
import tokenStyles from "../design-system/tokens.css?raw";
import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import type { SelectedSpectrumOutcome } from "../features/mzml-preview/contracts";
import {
  FAKE_COMPLETE_SCAN_COUNT,
  buildPreview,
  buildSpectrum,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  selectedFile,
  shimadzuDataset,
} from "../test/previewFixtures";
import { App } from "./App";

/** Enough scans that a range can hold some of them and not others. */
const SCAN_COUNT = 200;
const PLOT_PIXELS = 1_000;
const SETTLING = { timeout: 15_000 } as const;

const VENDOR_ROW = shimadzuDataset(1);

/** Every action the linked section offers. */
const LINKED_ACTIONS = [
  "Export linked SVG…",
  "Export linked PNG…",
  "Copy linked plot",
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function api(
  options: Parameters<typeof createFakePreviewApi>[0] = {},
): ReturnType<typeof createFakePreviewApi> {
  return createFakePreviewApi({
    initialDatasets: [selectedFile, VENDOR_ROW],
    preview: buildPreview(SCAN_COUNT),
    ...options,
  });
}

async function openTheViewer(preview: PreviewApi): Promise<void> {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={preview}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Preview focused" }, SETTLING));
  await screen.findByRole("grid", { name: "Spectra" }, SETTLING);
  await screen.findByRole("img", { name: "Chromatogram" }, SETTLING);
  vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: PLOT_PIXELS,
    bottom: 210,
    width: PLOT_PIXELS,
    height: 210,
    toJSON: () => ({}),
  } as DOMRect);
}

function plot(): HTMLElement {
  return screen.getByRole("img", { name: "Chromatogram" });
}

/** Opens the export surface, which is closed when the viewer opens. */
function openExport(): void {
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
}

/** The chromatogram's export surface, which the linked section lives inside. */
function panel(): HTMLElement {
  const found = document.querySelector("#chromatogram-export-panel");
  if (found === null) {
    throw new Error("the export surface is not open");
  }
  return found as HTMLElement;
}

/** The linked section of it. */
function linkedSection(): HTMLElement {
  const found = document.querySelector("#chromatogram-linked-section");
  if (found === null) {
    throw new Error("the linked section is not on screen");
  }
  return found as HTMLElement;
}

/**
 * One of the linked section's controls.
 *
 * Scoped for the reason the chromatogram's own helper is: this surface offers
 * `Copy plot` twice over, and a query that could reach either would pass for
 * the wrong reason on the day the two disagree.
 */
function linkedButton(name: string): HTMLButtonElement {
  return within(linkedSection()).getByRole("button", { name }) as HTMLButtonElement;
}

/** The chromatogram's own controls, scoped away from the linked ones. */
function button(name: string): HTMLButtonElement {
  return within(panel()).getByRole("button", { name }) as HTMLButtonElement;
}

function radio(name: string): HTMLInputElement {
  return within(panel()).getByRole("radio", { name }) as HTMLInputElement;
}

/** What the linked section's live region currently says. */
function linkedStatus(): string {
  return (
    within(panel()).getByRole("status", { name: "Linked figure export status" }).textContent ?? ""
  );
}

/** Why the linked actions are closed, as the surface says it. */
function linkedReason(): string | null {
  return document.querySelector("#chromatogram-linked-unavailable")?.textContent ?? null;
}

/**
 * What the linked section would announce right now.
 *
 * Its own element, mounted from the first paint and empty while nothing is
 * wrong. Read separately from the visible sentence because the two say
 * different things: the visible one always says something, and this one speaks
 * only when there is a correction to make.
 */
function linkedAnnouncement(): HTMLElement {
  const found = document.querySelector('[data-live-region="linked-figure-availability"]');
  if (found === null) {
    throw new Error("the linked section has no live region");
  }
  return found as HTMLElement;
}

/** The selected spectrum's own panel, which shares the one export lane. */
function spectrumPanel(): HTMLElement {
  const found = document.querySelector("section.spectrum-panel");
  if (found === null) {
    throw new Error("the selected spectrum panel is not on screen");
  }
  return found as HTMLElement;
}

function spectrumButton(name: string): HTMLButtonElement {
  return within(spectrumPanel()).getByRole("button", { name }) as HTMLButtonElement;
}

/** Reads one spectrum, so there is a pair to link. */
async function selectAScan(): Promise<void> {
  const grid = screen.getByRole("grid", { name: "Spectra" });
  const rows = within(grid).getAllByRole("row");
  fireEvent.click(rows[1] as HTMLElement);
  await waitFor(() => {
    expect(within(spectrumPanel()).queryByRole("button", { name: "Copy plot" })).not.toBeNull();
  }, SETTLING);
}

/** Presses every linked action, for the cases where none of them may fire. */
function pressEveryLinkedAction(): void {
  for (const name of LINKED_ACTIONS) {
    fireEvent.click(linkedButton(name));
  }
}

/** A committed viewport, from a wheel that settles. */
async function commitAZoom(): Promise<void> {
  act(() => {
    plot().dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 500, deltaY: -500 }),
    );
  });
  await waitFor(() => {
    expect(document.querySelector(".chromatogram-range")?.textContent ?? "").not.toContain(
      "full range",
    );
  });
}

describe("the linked chromatogram and spectrum section", () => {
  it("is part of the export surface, and says what it draws", async () => {
    const preview = api();
    await openTheViewer(preview);
    openExport();

    // Present before a scan is selected, rather than appearing once it is: a
    // control that arrives with its explanation teaches nobody why it was not
    // there a moment ago.
    expect(within(panel()).getByText("Linked chromatogram + spectrum")).toBeVisible();
    for (const name of LINKED_ACTIONS) {
      expect(linkedButton(name)).toBeVisible();
    }
    // And no data document, because there is no honest combined table.
    expect(within(linkedSection()).queryByRole("button", { name: /CSV/u })).toBeNull();
    expect(within(linkedSection()).queryByRole("button", { name: /TSV/u })).toBeNull();

    // One sentence at a time, and which one depends on whether the reader can
    // act: the reason while the section is closed, what it draws once it opens.
    expect(linkedReason()).toBe("Select a scan and wait for its spectrum to load.");
    expect(
      within(linkedSection()).queryByText(/Two panels: this chromatogram over the range above/u),
    ).toBeNull();

    await selectAScan();
    expect(linkedReason()).toBeNull();
    expect(
      within(linkedSection()).getByText(
        /Two panels: this chromatogram over the range above, marked at the selected scan/u,
      ),
    ).toBeVisible();
  });

  it("closes the actions and says to select a scan when none is loaded", async () => {
    const preview = api();
    await openTheViewer(preview);
    openExport();

    expect(linkedReason()).toBe("Select a scan and wait for its spectrum to load.");
    for (const name of LINKED_ACTIONS) {
      expect(linkedButton(name).disabled).toBe(true);
    }
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toEqual([]);
    expect(preview.linkedFigureCopyRequests).toEqual([]);
    // And nothing was read to find that out.
    expect(preview.requestedSpectra).toEqual([]);
  });

  it("says to wait while the selected spectrum is still loading", async () => {
    const slow = deferred<SelectedSpectrumOutcome>();
    const preview = api({ spectrum: () => slow.promise });
    await openTheViewer(preview);
    openExport();

    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(within(grid).getAllByRole("row")[1] as HTMLElement);
    await waitFor(() => {
      expect(linkedReason()).toBe("Wait for the selected spectrum to load.");
    });
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toEqual([]);

    act(() => {
      slow.resolve({ outcome: "spectrum", spectrum: buildSpectrum(0, 4) });
    });
    await waitFor(() => {
      expect(linkedReason()).toBeNull();
    });
    for (const name of LINKED_ACTIONS) {
      expect(linkedButton(name).disabled).toBe(false);
    }
  });

  it("sends the pair, the range and the visible traces once a scan is ready", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));

    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });
    expect(preview.linkedFigureRequests[0]).toEqual({
      chromatogramToken: "chromatogram-token",
      spectrumToken: "token-0",
      format: "svg",
      range: { scope: "full", low: null, high: null },
      // The viewer opens with TIC alone.
      traces: { tic: true, bpc: false },
      settings: { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "light" },
    });
    // The linked surface is its own action: neither single-source export ran.
    expect(preview.chromatogramExportRequests).toEqual([]);
    expect(preview.spectrumExportRequests).toEqual([]);
  });

  it("draws whichever traces are on screen, and refuses when neither is", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    // Both.
    fireEvent.click(screen.getByRole("checkbox", { name: "BPC" }));
    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });
    expect(preview.linkedFigureRequests[0]?.traces).toEqual({ tic: true, bpc: true });

    // BPC alone.
    fireEvent.click(screen.getByRole("checkbox", { name: "TIC" }));
    fireEvent.click(linkedButton("Export linked PNG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(2);
    });
    expect(preview.linkedFigureRequests[1]?.traces).toEqual({ tic: false, bpc: true });

    // Neither. A panel of no series is refused by the contract, so it is not
    // offered -- and the sentence names the thing the reader can change.
    fireEvent.click(screen.getByRole("checkbox", { name: "BPC" }));
    await waitFor(() => {
      expect(linkedReason()).toBe("Show at least one chromatogram trace to create a linked figure.");
    });
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toHaveLength(2);
    expect(preview.linkedFigureCopyRequests).toEqual([]);
  });

  it("carries the committed range when the selected scan is inside it", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();
    fireEvent.click(radio("Current range"));

    // Nothing has been committed, so the current range is the whole run and the
    // selected scan is trivially inside it.
    expect(linkedReason()).toBeNull();
    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });
    expect(preview.linkedFigureRequests[0]?.range).toEqual({
      scope: "current",
      low: null,
      high: null,
    });
  });

  it("says the selected scan is outside the current range, and how to fix it", async () => {
    /*
     * Reachable in the ordinary way: select a scan, then pan or zoom away from
     * it. The reveal a selection performs is what puts it on screen; nothing
     * puts it back afterwards, and nothing here tries to -- widening the range
     * would export something other than what was asked for, and moving the
     * viewer would move what the user is reading.
     */
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    await commitAZoom();
    openExport();
    fireEvent.click(radio("Current range"));
    await waitFor(() => {
      expect(within(panel()).getByText(/^Current range is [\d.]/u)).toBeDefined();
    });

    expect(linkedReason()).toBe(
      "The selected scan is outside the current chromatogram range. Choose Full run or move " +
        "the current range to include the selected scan.",
    );
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toEqual([]);
    expect(preview.linkedFigureCopyRequests).toEqual([]);

    // The chromatogram's own exports are untouched: the range holds scans, just
    // not the selected one, and that is a chromatogram nobody objected to.
    expect(button("Export CSV…").disabled).toBe(false);
    fireEvent.click(button("Export CSV…"));
    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });

    // Full run is one of the two things the sentence offers, and it works
    // without moving the viewer.
    const before = document.querySelector(".chromatogram-range")?.textContent ?? "";
    fireEvent.click(radio("Full run"));
    expect(linkedReason()).toBeNull();
    expect(document.querySelector(".chromatogram-range")?.textContent ?? "").toBe(before);
  });

  it("closes at a height of 259 and opens at 260", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();
    const height = within(panel()).getByRole("textbox", { name: /^Height/u });

    fireEvent.change(height, { target: { value: "259" } });
    expect(linkedReason()).toBe("A two-panel linked figure needs a height of at least 260.");
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toEqual([]);
    // One panel still fits, so the chromatogram's own figures stay available.
    expect(button("Export SVG…").disabled).toBe(false);
    expect(spectrumButton("Export SVG…").disabled).toBe(false);

    fireEvent.change(height, { target: { value: "260" } });
    expect(linkedReason()).toBeNull();
    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });
    expect(preview.linkedFigureRequests[0]?.settings.heightPx).toBe(260);
  });

  it("announces a reason as it appears, and says nothing while nothing is wrong", async () => {
    /*
     * Three states, because two of them were wrong in turn.
     *
     * A plain paragraph announced nothing: the reason *appears* while the
     * reader is somewhere else -- typing a height, choosing a range scope --
     * and closes three controls as it does, and a disabled control cannot be
     * tabbed to, so its `aria-describedby` is not a way to find the sentence.
     *
     * Making the visible paragraph live announced the wrong thing, twice over:
     * React reuses the node across the two branches, so `aria-live` arrived
     * with the text and nothing had been watching; and because that element
     * also carries the description, becoming *usable* -- the state nobody needs
     * telling about -- read the whole of it aloud.
     *
     * So the announcement is its own element, mounted from the first paint and
     * empty unless there is a correction to make.
     */
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    // AVAILABLE: the description is visible, and nothing is announced.
    expect(linkedReason()).toBeNull();
    expect(
      within(linkedSection()).getByText(/^Two panels: this chromatogram/u),
    ).toBeVisible();
    const announcement = linkedAnnouncement();
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.textContent).toBe("");
    // The visible sentence is not the announcement, so it cannot read itself out.
    expect(within(linkedSection()).getByText(/^Two panels: this chromatogram/u)).not.toBe(
      announcement,
    );

    // BECOMES UNAVAILABLE: the actionable reason is both shown and announced.
    fireEvent.change(within(panel()).getByRole("textbox", { name: /^Height/u }), {
      target: { value: "259" },
    });
    const reason = "A two-panel linked figure needs a height of at least 260.";
    expect(linkedReason()).toBe(reason);
    // The same element as before, so it was live when its text changed.
    expect(linkedAnnouncement()).toBe(announcement);
    expect(announcement.textContent).toBe(reason);
    expect(linkedButton("Export linked SVG…").disabled).toBe(true);
    // And a height the figure settings themselves accept, so this is the linked
    // rule speaking rather than the shared one.
    expect(within(panel()).queryByText(/Height must be a whole number/u)).toBeNull();

    // BECOMES AVAILABLE AGAIN: the region empties rather than reading out the
    // description, which is the state nobody needs telling about.
    fireEvent.change(within(panel()).getByRole("textbox", { name: /^Height/u }), {
      target: { value: "260" },
    });
    expect(linkedReason()).toBeNull();
    expect(linkedAnnouncement()).toBe(announcement);
    expect(announcement.textContent).toBe("");
    expect(
      within(linkedSection()).getByText(/^Two panels: this chromatogram/u),
    ).toBeVisible();
    expect(linkedButton("Export linked SVG…").disabled).toBe(false);
  });

  it("says one sentence at a time, and says the refusal exactly once", async () => {
    /*
     * The section is measured to the pixel and shows one sentence in either
     * state, which is what a second paragraph would have spent.
     *
     * It used to buy the announcement with a visually-hidden copy of the
     * refusal beside the visible one. That announced correctly and put the same
     * sentence in the accessibility tree twice, so a reader traversing the
     * section met it, moved on, and met it again -- M4.4 P3-3. The live region
     * is now the visible sentence, empty and collapsed while there is nothing
     * wrong, and the description is a separate element rendered only when there
     * is no refusal to displace.
     */
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    const sentences = () =>
      Array.from(linkedSection().querySelectorAll("p")).filter(
        (node) => (node.textContent ?? "").trim().length > 0,
      );

    // AVAILABLE: one sentence, and it is the description rather than a refusal.
    expect(sentences()).toHaveLength(1);
    expect(sentences()[0]?.textContent).toMatch(/^Two panels: this chromatogram/u);
    // The live region is there, empty, and carries no layout while it is.
    expect(linkedAnnouncement().textContent).toBe("");
    expect(sentences()).not.toContain(linkedAnnouncement());

    fireEvent.change(within(panel()).getByRole("textbox", { name: /^Height/u }), {
      target: { value: "259" },
    });

    // UNAVAILABLE: still one sentence, and now it is the refusal -- carried by
    // the same element that announced it, so it is in the tree once.
    const reason = "A two-panel linked figure needs a height of at least 260.";
    expect(sentences()).toHaveLength(1);
    expect(sentences()[0]).toBe(linkedAnnouncement());
    expect(sentences()[0]?.textContent).toBe(reason);
    // Once, counted over everything the section says.
    const occurrences = (linkedSection().textContent ?? "").split(reason).length - 1;
    expect(occurrences).toBe(1);
    // And the description is not underneath it.
    expect(
      within(linkedSection()).queryByText(/^Two panels: this chromatogram/u),
    ).toBeNull();
  });

  it("closes every linked action when the width is not a size at all", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.change(within(panel()).getByRole("textbox", { name: /^Width/u }), {
      target: { value: "" },
    });

    expect(linkedReason()).toBe("Width must be a whole number of at least 1.");
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toEqual([]);
    expect(preview.linkedFigureCopyRequests).toEqual([]);
  });

  it("closes only the linked PNG when the resolution is the unusable field", async () => {
    // The rule the two single-source surfaces already follow, asked of a third:
    // an SVG has no pixels to give a physical size to, and a clipboard image
    // carries no resolution at all, so neither is closed over this number.
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.change(within(panel()).getByRole("textbox", { name: /^PNG DPI/u }), {
      target: { value: "" },
    });

    expect(linkedButton("Export linked PNG…").disabled).toBe(true);
    expect(linkedButton("Export linked SVG…").disabled).toBe(false);
    expect(linkedButton("Copy linked plot").disabled).toBe(false);
    // And nothing is said, because nothing about the *linked* figure is wrong.
    expect(linkedReason()).toBeNull();

    fireEvent.click(linkedButton("Export linked PNG…"));
    expect(preview.linkedFigureRequests).toEqual([]);
    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });
  });
});

describe("the one scientific export lane, across three surfaces", () => {
  /** One export of `command` that hangs until the returned callback is called. */
  function held(): { readonly release: () => void; readonly hold: () => Promise<never> } {
    let release: (() => void) | null = null;
    return {
      release: () => {
        release?.();
      },
      hold: () =>
        new Promise((resolve) => {
          release = () => {
            (resolve as (value: unknown) => void)({ status: "cancelled" });
          };
        }),
    };
  }

  it("closes the linked actions while the selected spectrum owns the lane", async () => {
    const gate = held();
    const preview = api({ spectrumExport: gate.hold });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(spectrumButton("Export SVG…"));
    await waitFor(() => {
      expect(preview.spectrumExportRequests).toHaveLength(1);
    });

    for (const name of LINKED_ACTIONS) {
      expect(linkedButton(name).disabled).toBe(true);
    }
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toEqual([]);
    // Availability is shared; words are not. This section says nothing about an
    // export it never started.
    expect(linkedStatus()).toBe("");

    act(() => {
      gate.release();
    });
    await waitFor(() => {
      expect(linkedButton("Export linked SVG…").disabled).toBe(false);
    });
  });

  it("closes the linked actions while the chromatogram owns the lane", async () => {
    const gate = held();
    const preview = api({ chromatogramExport: gate.hold });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(button("Export CSV…"));
    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });

    for (const name of LINKED_ACTIONS) {
      expect(linkedButton(name).disabled).toBe(true);
    }
    pressEveryLinkedAction();
    expect(preview.linkedFigureRequests).toEqual([]);
    expect(linkedStatus()).toBe("");

    act(() => {
      gate.release();
    });
    await waitFor(() => {
      expect(linkedButton("Export linked SVG…").disabled).toBe(false);
    });
  });

  it("closes both single-source surfaces while a linked figure is being written", async () => {
    const gate = held();
    const preview = api({ linkedFigureExport: gate.hold });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });

    // The label names the operation this surface started.
    expect(linkedButton("Exporting linked SVG…")).toBeVisible();
    for (const name of ["Export SVG…", "Export PNG…", "Export CSV…", "Copy plot"]) {
      expect(button(name).disabled).toBe(true);
      expect(spectrumButton(name).disabled).toBe(true);
    }
    fireEvent.click(button("Export CSV…"));
    fireEvent.click(spectrumButton("Export CSV…"));
    expect(preview.chromatogramExportRequests).toEqual([]);
    expect(preview.spectrumExportRequests).toEqual([]);

    act(() => {
      gate.release();
    });
    await waitFor(() => {
      expect(button("Export CSV…").disabled).toBe(false);
    });
  });
});

describe("what a finished linked export says", () => {
  it("names the file, the scan it marked and the run it came from", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));

    await waitFor(() => {
      expect(linkedStatus()).toContain("mscanvas-linked-spectrum-0-full.svg");
    });
    const said = linkedStatus();
    expect(said).toContain("marking spectrum 0");
    expect(said).toContain("at retention time 0.0125");
    expect(said).toContain(`in a run of ${FAKE_COMPLETE_SCAN_COUNT.toLocaleString("en-US")} scans`);
    // The chromatogram's own live region is untouched: one lane, two results.
    expect(
      within(panel()).getByRole("status", { name: "Chromatogram export status" }).textContent ?? "",
    ).toBe("");

    fireEvent.click(
      within(linkedSection()).getByRole("button", { name: "Dismiss linked export message" }),
    );
    expect(linkedStatus()).toBe("");
  });

  it("says a cancelled linked export saved nothing", async () => {
    const preview = api({ linkedFigureExport: async () => ({ status: "cancelled" }) });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked PNG…"));

    await waitFor(() => {
      expect(linkedStatus()).toContain("Linked export cancelled. Nothing was saved.");
    });
  });

  it("reads out a typed refusal in the words Rust chose", async () => {
    const preview = api({
      linkedFigureExport: () =>
        Promise.reject({
          kind: "linked_selection_outside_range",
          summary:
            "The selected scan is outside the current chromatogram range. Choose Full run, or " +
            "move the current range to include the selected scan.",
          detail: null,
          retryable: true,
        }),
    });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));

    await waitFor(() => {
      expect(linkedStatus()).toContain("The selected scan is outside the current chromatogram");
    });
    // A refusal is not a state the surface stays stuck in.
    expect(linkedButton("Export linked SVG…").disabled).toBe(false);
  });

  it("reads out the part of a failure the user has to act on", async () => {
    /*
     * The M4.3.2 rule, asked of the third surface. The summary says what
     * happened; the detail is where a failure puts the thing only the user can
     * fix -- above all that the export could not remove the temporary file it
     * left in their folder. A panel that rendered only the summary would leave
     * a `.mscanvas-export-*` file in a folder having told nobody.
     */
    const residue = "A temporary file .mscanvas-export-7 was left in the folder.";
    const preview = api({
      linkedFigureExport: () =>
        Promise.reject({
          kind: "spectrum_not_written",
          summary: "The linked figure could not be written.",
          detail: residue,
          retryable: true,
        }),
    });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));

    await waitFor(() => {
      expect(linkedStatus()).toContain("The linked figure could not be written.");
    });
    expect(linkedStatus()).toContain(residue);
    expect(within(linkedSection()).getByText(residue)).toHaveClass("notice-detail");
  });

  it("names the figure it put on the clipboard", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Copy linked plot"));

    await waitFor(() => {
      expect(linkedStatus()).toContain("Copied the linked figure at 1200×640 in the light theme");
    });
    expect(linkedStatus()).toContain("marking spectrum 0");
    expect(preview.linkedFigureCopyRequests).toHaveLength(1);
    // A copy chooses no destination, so no save was begun for it.
    expect(preview.linkedFigureRequests).toEqual([]);
  });
});

describe("a linked operation that outlives the pair on screen", () => {
  it("stops claiming the visible pair when another scan is selected", async () => {
    let release: (() => void) | null = null;
    const preview = api({
      linkedFigureExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });
    expect(linkedButton("Exporting linked SVG…")).toBeVisible();

    // The user moves on while the write is still running.
    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(within(grid).getAllByRole("row")[3] as HTMLElement);
    await waitFor(() => {
      expect(preview.requestedSpectra).toHaveLength(2);
    });

    // The label stops claiming this pair is being written, and the actions stay
    // closed, because Rust is still writing.
    await waitFor(() => {
      expect(within(linkedSection()).queryByRole("button", { name: "Exporting linked SVG…" })).toBeNull();
    });
    expect(linkedButton("Export linked SVG…").disabled).toBe(true);
    expect(linkedStatus()).toBe("");

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(linkedButton("Export linked SVG…").disabled).toBe(false);
    });
    // The operation ended, and its answer was about a pair the user moved past,
    // so it is not published beside the one on screen now.
    expect(linkedStatus()).toBe("");
  });

  it("stops claiming the visible pair when the preview is replaced", async () => {
    let release: (() => void) | null = null;
    let opens = 0;
    const preview = api({
      preview: () => {
        opens += 1;
        return Promise.resolve({
          ...buildPreview(SCAN_COUNT),
          chromatogramExportToken: `chromatogram-token-${opens}`,
        });
      },
      linkedFigureExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(preview.linkedFigureRequests).toHaveLength(1);
    });
    expect(preview.linkedFigureRequests[0]?.chromatogramToken).toBe("chromatogram-token-1");

    // Another run is opened over it while the write is still running.
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));
    await waitFor(() => {
      expect(preview.openedHandles).toHaveLength(2);
    });

    await waitFor(() => {
      expect(within(linkedSection()).queryByRole("button", { name: "Exporting linked SVG…" })).toBeNull();
    });
    expect(linkedStatus()).toBe("");

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(linkedButton("Export linked SVG…").disabled).toBe(true);
    });
    // The new run has no scan selected yet, so the section says so rather than
    // showing an outcome belonging to the run that was replaced.
    expect(linkedReason()).toBe("Select a scan and wait for its spectrum to load.");
    expect(linkedStatus()).toBe("");
  });
});

describe("two results in one surface", () => {
  /*
   * Found in review, and by four readers independently: the accessible name
   * added for the linked section's dismiss control reached the chromatogram's
   * four result branches as well, so this surface's own dismiss announced itself
   * as the linked figure's -- inverting the disambiguation it was added to
   * provide. Nothing asserted it, because no test had ever put both results on
   * screen at once.
   */
  it("gives each dismiss control its own name, and clears only its own message", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(button("Export CSV…"));
    await waitFor(() => {
      expect(
        within(panel()).getByRole("status", { name: "Chromatogram export status" }).textContent ??
          "",
      ).toContain("Saved");
    });
    fireEvent.click(linkedButton("Export linked SVG…"));
    await waitFor(() => {
      expect(linkedStatus()).toContain("Saved");
    });

    // Both messages are on screen, and a reader listing the controls can tell
    // the two apart.
    const chromatogramDismiss = within(panel()).getByRole("button", { name: "Dismiss" });
    const linkedDismiss = within(linkedSection()).getByRole("button", {
      name: "Dismiss linked export message",
    });
    expect(chromatogramDismiss).not.toBe(linkedDismiss);
    // The visible word is the same for both; only the name a screen reader
    // hears distinguishes them, which is the whole point.
    expect(chromatogramDismiss.textContent).toBe("Dismiss");
    expect(linkedDismiss.textContent).toBe("Dismiss");

    fireEvent.click(linkedDismiss);
    expect(linkedStatus()).toBe("");
    expect(
      within(panel()).getByRole("status", { name: "Chromatogram export status" }).textContent ?? "",
    ).toContain("Saved");

    fireEvent.click(chromatogramDismiss);
    expect(
      within(panel()).getByRole("status", { name: "Chromatogram export status" }).textContent ?? "",
    ).toBe("");
  });

  it("writes the marked scan's retention time the way every other one is written", async () => {
    /*
     * Also found in review. The number comes back from Rust as an `f64` and was
     * rendered raw, so a run whose scan sits at 0.1 printed `0.1` here while the
     * range note two paragraphs above, the scan table and the plot readout all
     * print `0.1000`. A reader comparing the two has no way to know they are the
     * same scan.
     */
    const preview = api({
      linkedFigureExport: async (_chromatogram, _spectrum, format, range, traces, settings) => ({
        status: "saved",
        format,
        fileName: `mscanvas-linked-spectrum-0-${range.scope}.${format}`,
        figure: { width: settings.widthPx, height: settings.heightPx, dpi: null, theme: settings.theme },
        traces,
        rangeScope: range.scope,
        rangeLow: 0,
        rangeHigh: 2.5,
        sourceScanCount: 24,
        selectedIndex: 0,
        selectedRetentionTime: 0.1,
      }),
    });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.click(linkedButton("Export linked SVG…"));

    await waitFor(() => {
      expect(linkedStatus()).toContain("Saved");
    });
    expect(linkedStatus()).toContain("at retention time 0.1000");
    expect(linkedStatus()).not.toContain("at retention time 0.1 ");
  });

  it("draws its separator with a colour the design system actually defines", async () => {
    /*
     * Also found in review. The rule was copied from the export surface's own
     * separator, which names a token that is defined nowhere -- so both fell back
     * to a hard-coded light grey and painted a bright line across the dark
     * theme's surface. Asserted on the stylesheet rather than on a rendered
     * colour, because what went wrong is the name rather than the paint.
     */
    const defined = new Set(
      [...(tokenStyles + appStyles).matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1]),
    );
    for (const rule of [".chromatogram-export-panel", ".linked-figure-actions"]) {
      const body = appStyles.split(`${rule} {`)[1]?.split("}")[0] ?? "";
      const border = /border-top:[^;]*var\(\s*(--[\w-]+)/u.exec(body)?.[1];
      expect(border, `${rule} declares a border-top colour`).toBeDefined();
      expect(defined.has(border ?? ""), `${rule} names ${border ?? "nothing"}`).toBe(true);
    }
  });
});
