/**
 * The viewer's selection-availability posture, through the shipped composition.
 *
 * Two surfaces commit a scan -- the chromatogram and the scan table -- and both
 * of them read one authority. What is worth asserting here rather than in either
 * component's own spec is what only the assembled document can answer: that the
 * explanation exists once, that both surfaces point at the same one, that it is
 * announced from a region that was already there, that no ProteoWizard read is
 * launched by an activation that cannot commit, and that a lane clearing makes
 * selection work again without rebuilding the viewer under the reader.
 *
 * The lane driven here is the installation check, because it is the one a viewer
 * that is already open can enter and leave. The other two are pinned where they
 * are cheapest to pin honestly: the reason and the operation's own refusal in
 * `viewerSelectionAuthority`, and each surface's blocked behaviour in its own
 * spec.
 *
 * Every unavailable case presses the control anyway. `aria-disabled` is an
 * affordance; what matters is that nothing crossed the boundary.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import appStyles from "./app.css?raw";

import type { BackendAvailability } from "../features/mzml-preview/contracts";
import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import {
  availableBackend,
  buildPreview,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  selectedFile,
  shimadzuDataset,
  unavailableBackend,
} from "../test/previewFixtures";
import { App } from "./App";

const SCAN_COUNT = 60;
const PLOT_PIXELS = 1_000;
const SETTLING = { timeout: 15_000 } as const;
const VENDOR_ROW = shimadzuDataset(1);

const CHECKING =
  "Selecting a scan is unavailable while the installed ProteoWizard backend is being checked.";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * A session whose first backend verdict lands and whose next one is held.
 *
 * The viewer opens against an available backend, and the second check is the
 * one the test controls -- which is the sequence a reader actually meets:
 * something is on screen, and then the lane closes under them.
 */
function heldSecondCheck() {
  const held = deferred<BackendAvailability>();
  let checks = 0;
  const preview = createFakePreviewApi({
    initialDatasets: [selectedFile, VENDOR_ROW],
    preview: buildPreview(SCAN_COUNT),
    availability: () => {
      checks += 1;
      return checks === 1 ? Promise.resolve(availableBackend) : held.promise;
    },
  });
  return { preview, held };
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

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Spectra" });
}

/** The one availability explanation, while there is one. */
function notice(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#viewer-selection-availability");
}

/** The region it is carried by, which is there whether or not it says anything. */
function region(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    '[data-live-region="spectrum-selection-availability"]',
  );
  if (found === null) {
    throw new Error("the viewer has no selection-availability region");
  }
  return found;
}

/** Closes the backend lane, by asking for a check that will not answer yet. */
async function startACheck(): Promise<void> {
  fireEvent.click(screen.getAllByRole("button", { name: "Check again" })[0] as HTMLElement);
  await waitFor(() => {
    expect(notice()).not.toBeNull();
  }, SETTLING);
}

/** Presses every activation that would commit a scan, on both surfaces. */
function pressBothSurfaces(): void {
  const rows = within(grid()).getAllByRole("row");
  fireEvent.click(rows[1] as HTMLElement);
  rows[1]?.focus();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
  fireEvent.keyDown(document.activeElement ?? document.body, { key: " " });
  fireEvent.pointerDown(plot(), { button: 0, clientX: 400, pointerId: 1 });
  fireEvent.pointerUp(plot(), { button: 0, clientX: 400, pointerId: 1 });
}

describe("the viewer's selection availability", () => {
  it("says nothing at all while a scan can be selected", async () => {
    const { preview } = heldSecondCheck();
    await openTheViewer(preview);

    // The region is in the document before it has anything to say, so that it
    // is being watched when the text arrives rather than arriving with it.
    expect(region().textContent).toBe("");
    // And it is not a described-by target while it is empty: a promise of an
    // explanation that is not there is worse than none.
    expect(notice()).toBeNull();
    expect(grid().getAttribute("aria-describedby")).toBeNull();
    expect(plot().getAttribute("aria-describedby")).toBe("chromatogram-readout");
  });

  it("explains the closed lane once, and both surfaces point at that one sentence", async () => {
    const { preview } = heldSecondCheck();
    await openTheViewer(preview);
    await startACheck();

    expect(notice()?.textContent).toBe(CHECKING);
    // Once in the accessibility tree. Not a visible sentence plus a hidden copy
    // of it, and not one sentence per surface.
    expect((document.body.textContent ?? "").split(CHECKING).length - 1).toBe(1);
    expect(document.querySelectorAll("#viewer-selection-availability")).toHaveLength(1);

    // Both surfaces, the same id, and the plot keeps its readout as well.
    expect(grid().getAttribute("aria-describedby")).toBe("viewer-selection-availability");
    expect(plot().getAttribute("aria-describedby")).toBe(
      "chromatogram-readout viewer-selection-availability",
    );

    // Announced politely, by the element that was already there.
    expect(notice()).toBe(region());
    expect(region().getAttribute("aria-live")).toBe("polite");
  });

  it("launches no read from either surface while the lane is closed", async () => {
    const { preview } = heldSecondCheck();
    await openTheViewer(preview);
    await startACheck();

    pressBothSurfaces();

    // The boundary, not the affordance: every selection is one ProteoWizard
    // process, and none of these asked for one.
    expect(preview.requestedSpectra).toEqual([]);
    expect(document.querySelector('[role="row"][aria-selected="true"]')).toBeNull();
  });

  it("keeps the table navigable and the plot interactive while blocked", async () => {
    const { preview } = heldSecondCheck();
    await openTheViewer(preview);
    await startACheck();

    // Neither surface is disabled, and neither is made inert.
    expect(grid().getAttribute("aria-disabled")).toBeNull();
    expect(plot().getAttribute("aria-disabled")).toBeNull();

    // The arrows still move the roving tab stop.
    within(grid()).getAllByRole("row")[1]?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAttribute("aria-rowindex", "3");

    // The pointer still reports the scan it is over.
    fireEvent.pointerMove(plot(), { clientX: 500, pointerId: 1 });
    expect(screen.getByText(/^Hovering/u)).toBeVisible();

    // And a trace toggle still answers, because it asks the backend nothing.
    fireEvent.click(screen.getByRole("checkbox", { name: "BPC" }));
    await waitFor(() => {
      expect((screen.getByRole("checkbox", { name: "BPC" }) as HTMLInputElement).checked).toBe(
        true,
      );
    });
  });

  it("says the backend is the problem once the check settles on one", async () => {
    const { preview, held } = heldSecondCheck();
    await openTheViewer(preview);
    await startACheck();

    held.resolve(unavailableBackend);
    await waitFor(() => {
      expect(notice()?.textContent).toContain("no usable backend");
    }, SETTLING);

    // The run stays on screen and stays readable: nothing about the reading
    // became untrue because the backend did.
    pressBothSurfaces();
    expect(preview.requestedSpectra).toEqual([]);
    expect(within(grid()).getAllByRole("row").length).toBeGreaterThan(1);
    expect(plot()).toBeVisible();
  });

  it("commits again when the lane clears, without rebuilding the viewer", async () => {
    const { preview, held } = heldSecondCheck();
    await openTheViewer(preview);
    const gridBefore = grid();
    await startACheck();

    fireEvent.click(within(grid()).getAllByRole("row")[1] as HTMLElement);
    expect(preview.requestedSpectra).toEqual([]);

    held.resolve(availableBackend);
    await waitFor(() => {
      expect(notice()).toBeNull();
    }, SETTLING);

    // The same grid element: a lane clearing does not remount the viewer, so
    // the reader's scroll position and tab stop survive it.
    expect(grid()).toBe(gridBefore);
    expect(grid().getAttribute("aria-describedby")).toBeNull();
    expect(region().textContent).toBe("");

    fireEvent.click(within(grid()).getAllByRole("row")[1] as HTMLElement);
    await waitFor(() => {
      expect(preview.requestedSpectra).toEqual([0]);
    }, SETTLING);
    // Exactly one read, from one click.
    expect(preview.requestedSpectra).toHaveLength(1);
  });
});

/**
 * How an empty live region is collapsed, which is not a detail.
 *
 * `display: none` removes an element from the accessibility tree as well as from
 * the layout, so a region collapsed that way arrives together with its first
 * sentence -- and a region that arrives with its text is not announced. Mounting
 * it early buys nothing at all in that shape.
 *
 * This stylesheet already recorded the lesson once, for
 * `.spectrum-viewport-status:empty`. Nothing was checking it, so it was
 * regressed here in review and is checked now.
 */
describe("how an empty availability region is collapsed", () => {
  /** One rule's declarations, as the stylesheet writes them. */
  function ruleBody(selector: string): string {
    const body = appStyles.split(`${selector} {`)[1]?.split("}")[0];
    expect(body, `Expected a CSS rule for ${selector}`).toBeDefined();
    return body ?? "";
  }

  for (const selector of [".viewer-selection-notice:empty", ".chromatogram-export-note:empty"]) {
    it(`keeps ${selector} in the accessibility tree`, () => {
      const body = ruleBody(selector);

      // Out of the picture.
      expect(body).toContain("position: absolute");
      expect(body).toContain("clip-path: inset(50%)");
      // Still in the tree. Neither of these collapses an element without also
      // taking it out of it.
      expect(body).not.toContain("display: none");
      expect(body).not.toContain("visibility: hidden");
      expect(body).not.toContain("content-visibility: hidden");
    });
  }

  it("declares each of them exactly once", () => {
    // Written twice, a later copy silently decides. Both of these were, once.
    for (const selector of [
      ".viewer-column {",
      ".viewer-selection-notice:empty {",
      ".chromatogram-export-note:empty {",
    ]) {
      expect(appStyles.split(selector).length - 1, selector).toBe(1);
    }
  });
});
