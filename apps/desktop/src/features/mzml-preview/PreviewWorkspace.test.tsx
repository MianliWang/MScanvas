import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider } from "./api";
import type { FolderIngestionResult } from "./contracts";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { PreviewWorkspace } from "./PreviewWorkspace";
import {
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  unavailableBackend,
} from "../../test/previewFixtures";

describe("folder reservation startup barrier", () => {
  it("disables empty-workspace Clear only until Rust acknowledges its reservation", async () => {
    const scan = deferred<FolderIngestionResult | null>();
    let acknowledgeReservation: (() => void) | undefined;
    const api = createFakePreviewApi({
      availability: unavailableBackend,
      acknowledgeFolderReservation: (acknowledge) => {
        acknowledgeReservation = acknowledge;
      },
      folderResult: () => scan.promise,
    });

    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={api}>
          <PreviewWorkspace />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );

    const addFolder = await screen.findByRole("button", { name: "Add mzML folder…" });
    await waitFor(() => {
      expect(addFolder).toBeEnabled();
    });
    fireEvent.click(addFolder);

    const clear = await screen.findByRole("button", { name: "Clear list" });
    expect(clear).toBeDisabled();
    fireEvent.click(clear);
    expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(0);

    expect(acknowledgeReservation).toBeTypeOf("function");
    act(() => {
      acknowledgeReservation?.();
    });
    await waitFor(() => {
      expect(clear).toBeEnabled();
    });

    fireEvent.click(clear);
    await waitFor(() => {
      expect(api.calls().filter((call) => call === "clearWorkspace")).toHaveLength(1);
      expect(clear).toBeEnabled();
    });
    expect(screen.getByText("Folder import in progress…")).toBeVisible();

    act(() => {
      scan.resolve(null);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/Folder import in progress/)).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
    });
  });
});
