import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { createFakePreviewApi, deferred } from "../../test/previewFixtures";
import { PreviewApiProvider } from "./api";
import type { OutputOpenOutcome } from "./contracts";
import { OutputOpenActions } from "./OutputOpenActions";

const output = { outputId: "finalized-17", fileName: "測定 file.mzML" };
describe("opening retained output identities", () => {
  it("sends only the stable identity and fixed action, preserving the initiator while refusing duplicates", async () => {
    const pending = deferred<OutputOpenOutcome>();
    const open = vi.fn(() => pending.promise);
    const api = createFakePreviewApi({ openFinalizedOutput: open });
    render(<PreviewApiProvider value={api}><OutputOpenActions output={output} /></PreviewApiProvider>);
    const file = screen.getByRole("button", { name: "Open file" });
    file.focus(); fireEvent.click(file); fireEvent.click(file);
    expect(open).toHaveBeenCalledExactlyOnceWith("finalized-17", "file");
    expect(file).toHaveFocus();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeDisabled();
    await act(async () => pending.resolve({ status: "accepted" }));
    expect(screen.getByRole("status")).toHaveTextContent(/does not confirm what an external application displayed/);
    expect(api.conversionRequests).toHaveLength(0);
    expect(api.adoptionRequests).toHaveLength(0);
  });

  it.each(["outputMissing", "noAssociation", "outputChanged"] as const)("keeps bound-folder recovery reachable after %s", async reason => {
    const open = vi.fn().mockResolvedValueOnce({ status: "refused", reason }).mockResolvedValueOnce({ status: "accepted" });
    const api = createFakePreviewApi({ openFinalizedOutput: open });
    render(<PreviewApiProvider value={api}><OutputOpenActions output={output} /></PreviewApiProvider>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open file" })));
    expect(screen.getByRole("status")).toHaveTextContent(/folder/);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open folder" })));
    expect(open.mock.calls).toEqual([["finalized-17", "file"], ["finalized-17", "folder"]]);
    expect(api.calls()).not.toContain("chooseFiles");
  });
});
