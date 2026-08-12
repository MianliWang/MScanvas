import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { App } from "../../app/App";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  quarantinedBackend,
  queueItem,
  queueOf,
} from "../../test/previewFixtures";
import type { FakePreviewApi } from "../../test/previewFixtures";
import type { ConversionQueueItem, SelectedFile, WorkspaceConversionState } from "./contracts";

/**
 * Saving one local, redacted diagnostics file, from the interface a user
 * actually has.
 *
 * Everything here renders the whole application against the modelled boundary,
 * so what is asserted is what a document does with the states Rust can produce.
 *
 * The environment is jsdom with CSSOM, which this repository has no browser
 * harness beyond. Nothing here measures a pixel or a paint; what it asserts is
 * production structure, the exact user-visible copy, which controls are offered
 * and disabled, focus, and — most of all for this feature — that no part of a
 * diagnostics document ever reaches React.
 */

const DIAGNOSTICS_EXPLANATION =
  "Saves a local redacted JSON file. Known filesystem paths and internal identifiers are removed, but backend text may still contain acquisition metadata. Review the file before sharing.";

const EXPORT_LABEL = "Export failure diagnostics…";

function acquisition(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: `run-${String(index)}.raw`,
    byteLength: 78_309,
    sourceKind: "thermo_raw",
    relativeContext: null,
  };
}

const DATASETS = [acquisition(1), acquisition(2)];

function renderApp(api: FakePreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

/** An item whose conversion failed for a reason the boundary named. */
function failed(handle: string, name: string, retryable = false): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "failed",
    attempts: 1,
    retryable,
    result: {
      kind: "single" as const,
      report: {
        datasetHandle: handle,
        sourceKind: "thermo_raw",
        outcome: "failed",
        detailedOutcome: "destination_exists",
        outputFileName: null,
        output: null,
        validation: null,
        backend: { exitCode: 1, elapsedMilliseconds: 812 },
        stagingResidue: null,
        installationGeneration: 0,
      },
    },
  });
}

/** An item that finalized an output and left nothing behind. */
function converted(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "finalized",
    attempts: 1,
    result: {
      kind: "single" as const,
      report: {
        datasetHandle: handle,
        sourceKind: "thermo_raw",
        outcome: "finalized",
        detailedOutcome: null,
        outputFileName: name.replace(/\.raw$/i, ".mzML"),
        output: {
          byteLength: 28_637,
          sha256: "B3D97B38".repeat(8).slice(0, 64),
          spectrumCount: 1,
          chromatogramCount: 1,
        },
        validation: {
          mode: "output_only",
          verified: [],
          unverified: [],
          inapplicable: [],
          fullyVerified: false,
        },
        backend: null,
        stagingResidue: null,
        installationGeneration: 0,
      },
    },
  });
}

/**
 * An item that converted and could not clean up after itself.
 *
 * The one shape where an otherwise successful item is worth describing:
 * something MSCanvas created is still on the user's disk.
 */
function residual(handle: string, name: string): ConversionQueueItem {
  const item = converted(handle, name);
  const result = item.result;
  if (result?.kind !== "single") {
    throw new Error("a residual fixture is built from a single-output item");
  }
  return {
    ...item,
    result: {
      kind: "single",
      report: { ...result.report, stagingResidue: "staging_not_removed" },
    },
  };
}

/** An item whose stop could not be confirmed. */
function unconfirmed(handle: string, name: string): ConversionQueueItem {
  return queueItem(handle, name, {
    state: "cancellationFailed",
    attempts: 1,
    retryable: false,
    cancellation: {
      processLaunched: true,
      terminationRequested: true,
      treeTerminationConfirmed: false,
      elapsedMilliseconds: 5_200,
      termination: null,
      partialOutputObserved: true,
      stagingResidue: null,
    },
  });
}

function terminal(
  items: readonly ConversionQueueItem[],
  reason: "completed" | "stopped" | "stopFailed" = "completed",
): WorkspaceConversionState {
  return { status: "terminal", operationId: "1", reason, queue: queueOf([...items]) };
}

function apiWith(
  state: WorkspaceConversionState,
  extra: Parameters<typeof createFakePreviewApi>[0] = {},
): FakePreviewApi {
  return createFakePreviewApi({
    initialDatasets: DATASETS,
    availability: availableBackend,
    initialConversion: state,
    ...extra,
  });
}

async function panelOf(api: FakePreviewApi): Promise<HTMLElement> {
  renderApp(api);
  return await screen.findByRole("region", { name: "Convert" });
}

describe("saving conversion diagnostics", () => {
  it("offers one action for a queue with something to diagnose, and says what it does", async () => {
    const panel = await panelOf(apiWith(terminal([failed("file-1", "run-1.raw")])));

    expect(
      await within(panel).findByText("1 item of this queue has diagnostics worth saving."),
    ).toBeVisible();
    const action = within(panel).getByRole("button", { name: EXPORT_LABEL });
    expect(action).toBeEnabled();
    // The warning is reachable from the control itself rather than only nearby,
    // so a screen-reader user hears it before they press.
    expect(action).toHaveAccessibleDescription(DIAGNOSTICS_EXPLANATION);
    expect(within(panel).getByText(DIAGNOSTICS_EXPLANATION)).toBeVisible();
  });

  it("counts several diagnostic items in the plural and excludes the ones that worked", async () => {
    const panel = await panelOf(
      apiWith(
        terminal([
          converted("file-1", "run-1.raw"),
          failed("file-2", "run-2.raw"),
          unconfirmed("file-3", "run-3.raw"),
        ]),
      ),
    );

    expect(
      await within(panel).findByText("2 items of this queue have diagnostics worth saving."),
    ).toBeVisible();
  });

  it("offers nothing for a queue that simply worked", async () => {
    const panel = await panelOf(
      apiWith(terminal([converted("file-1", "run-1.raw"), converted("file-2", "run-2.raw")])),
    );

    // Not a disabled control and not an empty state. An action that can never
    // be used here is one that only teaches its own absence, and the queue's
    // own result already says what happened to each item.
    await within(panel).findByText(/converted mzML output/);
    expect(within(panel).queryByRole("button", { name: EXPORT_LABEL })).toBeNull();
    expect(within(panel).queryByText(DIAGNOSTICS_EXPLANATION)).toBeNull();
  });

  it("offers an export for an item that converted and left staging behind", async () => {
    const panel = await panelOf(apiWith(terminal([residual("file-1", "run-1.raw")])));

    expect(
      await within(panel).findByText("1 item of this queue has diagnostics worth saving."),
    ).toBeVisible();
    expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
  });

  it("offers an export for a stopped queue that kept an earlier failure", async () => {
    const panel = await panelOf(
      apiWith(
        terminal(
          [
            failed("file-1", "run-1.raw"),
            queueItem("file-2", "run-2.raw", { state: "notRun", attempts: 0 }),
          ],
          "stopped",
        ),
      ),
    );

    expect(
      await within(panel).findByText("1 item of this queue has diagnostics worth saving."),
    ).toBeVisible();
  });

  it("offers an export for a stop-failed queue while the backend is quarantined", async () => {
    const api = apiWith(terminal([unconfirmed("file-1", "run-1.raw")], "stopFailed"), {
      availability: quarantinedBackend,
      initialBackendQuarantined: true,
    });
    const panel = await panelOf(api);

    // The session that has stopped trusting the backend is the one that most
    // needs this, and an export launches no process.
    expect(await within(panel).findByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
  });

  it("reports only a name, a size, a digest and a count, and never a location", async () => {
    const api = apiWith(terminal([failed("file-1", "run-1.raw")]));
    const panel = await panelOf(api);

    fireEvent.click(await within(panel).findByRole("button", { name: EXPORT_LABEL }));

    await waitFor(() => {
      expect(
        within(panel).getByText(
          "Saved mscanvas-conversion-diagnostics.json, 4096 bytes, describing 1 item.",
        ),
      ).toBeVisible();
    });
    expect(api.diagnosticsExportRequests).toEqual(["1"]);
    expect(
      within(panel).getByText(
        "SHA-256 2C26B46B68FFC68FF99B453C1D30413413422D706483BFA0F98A5E886266E7AE",
      ),
    ).toBeVisible();
    // Nothing about where it went, and no part of what is in it.
    const rendered = panel.textContent ?? "";
    expect(rendered).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(rendered).not.toContain("\\\\");
    expect(rendered).not.toContain("stdout");
    expect(rendered).not.toContain("stderr");
    // And no read was launched by any of it.
    expect(api.openedHandles).toEqual([]);
    expect(api.requestedSpectra).toEqual([]);
  });

  it("says an export is under way without inventing a percentage, and keeps focus", async () => {
    let release: (() => void) | null = null;
    const api = apiWith(terminal([failed("file-1", "run-1.raw")]), {
      diagnosticsExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({
              operationId: "1",
              retryRound: 0,
              fileName: "diagnostics.json",
              byteLength: 2_048,
              sha256: "A".repeat(64),
              diagnosticItemCount: 1,
            });
          };
        }),
    });
    const panel = await panelOf(api);

    const action = await within(panel).findByRole("button", { name: EXPORT_LABEL });
    action.focus();
    fireEvent.click(action);

    await waitFor(() => {
      expect(within(panel).getByText("Saving diagnostics…")).toBeVisible();
    });
    // Left mounted and disabled rather than replaced. Removing the control a
    // keyboard user just activated would drop focus to the document.
    expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeDisabled();
    expect(document.activeElement).toBe(action);
    // No fraction of anything: the file is written in one go.
    expect(panel.textContent ?? "").not.toMatch(/\d+\s*%/);

    release!();
    await waitFor(() => {
      expect(
        within(panel).getByText("Saved diagnostics.json, 2048 bytes, describing 1 item."),
      ).toBeVisible();
    });
    expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
    expect(document.activeElement).toBe(action);
  });

  it("closes the retry while an export is under way and offers it again afterwards", async () => {
    let release: (() => void) | null = null;
    const api = apiWith(terminal([failed("file-1", "run-1.raw", true)]), {
      diagnosticsExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve(null);
          };
        }),
    });
    const panel = await panelOf(api);

    expect(await within(panel).findByRole("button", { name: "Retry 1 failed" })).toBeEnabled();
    fireEvent.click(within(panel).getByRole("button", { name: EXPORT_LABEL }));

    await waitFor(() => {
      expect(within(panel).getByText("Saving diagnostics…")).toBeVisible();
    });
    // Removed rather than disabled: an action that is coming back is a
    // different thing from one that is refused.
    expect(within(panel).queryByRole("button", { name: "Retry 1 failed" })).toBeNull();

    release!();
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "Retry 1 failed" })).toBeEnabled();
    });
  });

  it("closes adding converted outputs while an export is under way", async () => {
    let release: (() => void) | null = null;
    const api = apiWith(
      terminal([converted("file-1", "run-1.raw"), failed("file-2", "run-2.raw")]),
      {
        diagnosticsExport: () =>
          new Promise((resolve) => {
            release = () => {
              resolve(null);
            };
          }),
      },
    );
    const panel = await panelOf(api);

    const adopt = await within(panel).findByRole("button", {
      name: "Add converted output to workspace",
    });
    expect(adopt).toBeEnabled();
    fireEvent.click(within(panel).getByRole("button", { name: EXPORT_LABEL }));

    await waitFor(() => {
      expect(
        within(panel).getByRole("button", { name: "Add converted output to workspace" }),
      ).toBeDisabled();
    });
    expect(api.calls()).not.toContain("adoptConversionOutputs");

    release!();
    await waitFor(() => {
      expect(
        within(panel).getByRole("button", { name: "Add converted output to workspace" }),
      ).toBeEnabled();
    });
  });

  it("closes the export while an adoption is under way", async () => {
    // The other direction of the same rule. Both read one terminal queue and
    // Rust runs one at a time, so whichever is pressed first closes the other.
    let release: (() => void) | null = null;
    const api = apiWith(
      terminal([converted("file-1", "run-1.raw"), failed("file-2", "run-2.raw")]),
      {
        adoption: () =>
          new Promise((resolve) => {
            release = () => {
              resolve({
                operationId: "1",
                retryRound: 0,
                roster: { datasets: [...api.datasets()], capacity: 1_024 },
                outcomes: [],
              });
            };
          }),
      },
    );
    const panel = await panelOf(api);

    expect(await within(panel).findByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Add converted output to workspace" }),
    );

    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeDisabled();
    });
    expect(api.diagnosticsExportRequests).toEqual([]);

    release!();
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
    });
  });

  it("treats a dismissed save dialog as an ordinary outcome", async () => {
    const api = apiWith(terminal([failed("file-1", "run-1.raw")]), {
      diagnosticsExport: () => Promise.resolve(null),
    });
    const panel = await panelOf(api);

    fireEvent.click(await within(panel).findByRole("button", { name: EXPORT_LABEL }));

    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
    });
    // Nothing was saved, so nothing is reported as saved, and nothing is an
    // error either: the user closed a window.
    expect(within(panel).queryByText(/^Saved /)).toBeNull();
    expect(within(panel).queryByText(/could not/i)).toBeNull();
    expect(api.diagnosticsExportRequests).toEqual(["1"]);
  });

  it("reports a refusal in words and never a path", async () => {
    for (const failure of [
      {
        kind: "diagnostics_destination_exists",
        summary:
          "A file of that name is already in that folder. MSCanvas did not replace it. Save the diagnostics under another name.",
      },
      {
        kind: "diagnostics_export_superseded",
        summary:
          "The conversion queue changed while MSCanvas was saving diagnostics. Nothing was written. Try again.",
      },
      {
        kind: "diagnostics_too_large",
        summary:
          "These diagnostics are larger than one MSCanvas file may be, so nothing was saved.",
      },
    ]) {
      const api = apiWith(terminal([failed("file-1", "run-1.raw")]), {
        diagnosticsExport: () => Promise.reject({ ...failure, detail: null, retryable: false }),
      });
      const { unmount } = render(
        <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
          <PreviewApiProvider value={api}>
            <App />
          </PreviewApiProvider>
        </WorkspaceDropTransportProvider>,
      );
      const panel = await screen.findByRole("region", { name: "Convert" });

      fireEvent.click(await within(panel).findByRole("button", { name: EXPORT_LABEL }));

      await waitFor(() => {
        expect(within(panel).getByText(failure.summary)).toBeVisible();
      });
      expect(panel.textContent ?? "").not.toMatch(/[A-Za-z]:[\\/]/);
      // The offer stands: every one of these is something the user can answer.
      expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
      unmount();
    }
  });

  it("says what a failed export left behind, not only that it failed", async () => {
    // The detail is where a refusal puts the part the user has to act on. A
    // surface that rendered only the summary would tell them the save failed
    // and not that there is now a file in their folder MSCanvas cannot remove.
    const leftBehind =
      'MSCanvas also left a temporary file whose name begins with ".mscanvas-export-" in that folder and could not remove it.';
    const api = apiWith(terminal([failed("file-1", "run-1.raw")]), {
      diagnosticsExport: () =>
        Promise.reject({
          kind: "diagnostics_not_finalized",
          summary:
            "MSCanvas wrote the diagnostics and could not give the file the name you chose, so nothing was saved under it.",
          detail: leftBehind,
          retryable: true,
        }),
    });
    const panel = await panelOf(api);

    fireEvent.click(await within(panel).findByRole("button", { name: EXPORT_LABEL }));

    await waitFor(() => {
      expect(within(panel).getByText(/could not give the file the name you chose/)).toBeVisible();
    });
    expect(within(panel).getByText(leftBehind)).toBeVisible();
    // Still no path, even in the part that names a file.
    expect(panel.textContent ?? "").not.toMatch(/[A-Za-z]:[\/]/);
  });

  it("keeps the action after a successful export so another copy can be saved", async () => {
    const api = apiWith(terminal([failed("file-1", "run-1.raw")]));
    const panel = await panelOf(api);

    fireEvent.click(await within(panel).findByRole("button", { name: EXPORT_LABEL }));
    await waitFor(() => {
      expect(within(panel).getByText(/^Saved /)).toBeVisible();
    });

    const again = within(panel).getByRole("button", { name: EXPORT_LABEL });
    expect(again).toBeEnabled();
    fireEvent.click(again);
    await waitFor(() => {
      expect(api.diagnosticsExportRequests).toEqual(["1", "1"]);
    });
  });

  it("says the result once, in one live region", async () => {
    const api = apiWith(terminal([failed("file-1", "run-1.raw")]));
    const panel = await panelOf(api);

    fireEvent.click(await within(panel).findByRole("button", { name: EXPORT_LABEL }));
    await waitFor(() => {
      expect(within(panel).getByText(/^Saved /)).toBeVisible();
    });

    // One announcement, not one per region that happened to be polite.
    const spoken = within(panel)
      .getAllByText(/^Saved mscanvas-conversion-diagnostics\.json/)
      .filter((node) => node.getAttribute("aria-live") === "polite");
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toHaveAttribute("aria-live", "polite");
  });

  it("recovers an export another document started", async () => {
    // A document asks for an export and is then replaced. Rust goes on writing,
    // and what the replacement reads on mount is a slot that says so.
    const api = apiWith(terminal([failed("file-1", "run-1.raw")]), {
      diagnosticsExport: () => new Promise(() => {}),
    });
    void api.exportConversionDiagnostics("1", () => {});
    expect(api.diagnosticsExportRequests).toEqual(["1"]);

    const panel = await panelOf(api);

    await waitFor(() => {
      expect(within(panel).getByText("Saving diagnostics…")).toBeVisible();
    });
    expect(within(panel).getByRole("button", { name: EXPORT_LABEL })).toBeDisabled();
    // Recovered by reading, not by dispatching. This document asked for
    // nothing and must not retry an export it did not start.
    expect(api.diagnosticsExportRequests).toEqual(["1"]);
  });
});
