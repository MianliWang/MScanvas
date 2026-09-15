import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { deferred } from "../../test/previewFixtures";
import type { FigurePreviewOutcome, FigurePreviewQuestion } from "./contracts";
import { ExportFigureDialog, type ExportFigureDialogProps } from "./ExportFigureDialog";

const question: FigurePreviewQuestion = { source: { kind: "spectrum", token: "spectrum-17", range: { scope: "full", low: null, high: null } }, settings: { widthPx: 1200, heightPx: 640, pngDpi: 300, theme: "light" } };
function rendered(requestId: number, specId = "spec-17"): FigurePreviewOutcome {
  return { status: "rendered", requestId, specId, svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>retained science</text></svg>', empty: false, width: 1200, height: 640 };
}
function props(overrides: Partial<ExportFigureDialogProps> = {}): ExportFigureDialogProps {
  return { kind: "spectrum", sourceLabel: "sample.mzML · Spectrum 17", question, preview: async request => rendered(request.requestId), onExport: vi.fn(() => true), onCopy: vi.fn(() => true), onClose: vi.fn(), returnTo: null, busy: false,
    settings: { widthPx: "1200", heightPx: "640", pngDpi: "300", theme: "light" }, validation: { render: null, dpi: null },
    onSetting: vi.fn(), onTheme: vi.fn(), scope: "full", currentAvailable: true, onScope: vi.fn(), scopeHelp: "Current range is the last committed m/z window.", result: null, ...overrides };
}
const NativeUrl = URL;
const revoke = vi.fn();
const create = vi.fn(() => "blob:figure-preview");
beforeEach(() => {
  create.mockClear(); revoke.mockClear();
  vi.stubGlobal("URL", class extends NativeUrl { static createObjectURL = create; static revokeObjectURL = revoke; });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the export-specific figure preview", () => {
  it.each(["chromatogram", "linked"] as const)("names the %s scope as a run and preserves linked full-spectrum semantics", async kind => {
    const source = kind === "chromatogram"
      ? { kind, token: "chromatogram-1", range: { scope: "full" as const, low: null, high: null }, traces: { tic: true, bpc: false } }
      : { kind, chromatogramToken: "chromatogram-1", spectrumToken: "spectrum-1", range: { scope: "full" as const, low: null, high: null }, traces: { tic: true, bpc: false } };
    render(<ExportFigureDialog {...props({ kind, question: { ...question, source } })} />);
    await screen.findByRole("img");
    expect(screen.getByRole("radio", { name: "Full run" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Full spectrum" })).toBeNull();
    if (kind === "linked") expect(screen.getByText(/lower panel always shows that scan's complete spectrum/)).toBeVisible();
  });
  it("renders only an inert image and binds double activation to the current question", async () => {
    const onExport = vi.fn(() => true);
    const view = render(<ExportFigureDialog {...props({ onExport })} />);
    const image = await screen.findByRole("img", { name: "Scientific figure to export" });
    expect(image).toHaveAttribute("data-spec-id", "spec-17");
    expect(document.querySelector(".figure-preview svg, .figure-preview object, .figure-preview iframe")).toBeNull();
    const save = screen.getByRole("button", { name: "Export SVG…" });
    save.focus(); fireEvent.click(save); fireEvent.click(save);
    expect(onExport).toHaveBeenCalledExactlyOnceWith(question, "svg");
    expect(save).toHaveFocus();
    view.unmount(); expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:figure-preview");
  });

  it("rejects an old answer even when a newer question returns to identical values", async () => {
    const first = deferred<FigurePreviewOutcome>(); const latest = deferred<FigurePreviewOutcome>();
    const preview = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => latest.promise);
    const original = props({ preview });
    const view = render(<ExportFigureDialog {...original} />);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    view.rerender(<ExportFigureDialog {...original} question={{ ...question, settings: { ...question.settings, widthPx: 1800 } }} />);
    view.rerender(<ExportFigureDialog {...original} />);
    await act(async () => first.resolve(rendered(1, "old")));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export SVG…" }));
    expect(original.onExport).not.toHaveBeenCalled();
    await act(async () => latest.resolve(rendered(2, "current")));
    expect(await screen.findByRole("img")).toHaveAttribute("data-spec-id", "current");
  });

  it("does not revive an answer after close and never creates a URL for it", async () => {
    const pending = deferred<FigurePreviewOutcome>();
    const preview = vi.fn(() => pending.promise);
    const view = render(<ExportFigureDialog {...props({ preview })} />);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    view.unmount(); await act(async () => pending.resolve(rendered(1)));
    expect(create).not.toHaveBeenCalled();
  });

  it("requires explicit acceptance of a replacement source and protects its settings", async () => {
    const preview = vi.fn(async request => rendered(request.requestId));
    const original = props({ preview });
    const view = render(<ExportFigureDialog {...original} />);
    await screen.findByRole("img");
    const replacement: FigurePreviewQuestion = { ...question, source: { kind: "spectrum", token: "new-source", range: { scope: "full", low: null, high: null } } };
    view.rerender(<ExportFigureDialog {...original} question={replacement} sourceLabel="replacement.mzML · Spectrum 2" />);
    expect(screen.getByText("replacement.mzML · Spectrum 2")).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("textbox", { name: /Width/ })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Width/ }), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Export SVG…" }));
    expect(original.onSetting).not.toHaveBeenCalled();
    expect(original.onExport).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Preview current source" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(preview.mock.calls[1][0].source).toEqual(replacement.source);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Export SVG…" }));
    expect(original.onExport).toHaveBeenCalledExactlyOnceWith(replacement, "svg");
  });

  it("keeps invalid DPI narrow, retains raw drafts, and reports an empty figure", async () => {
    const onExport = vi.fn(() => true);
    const value = props({ onExport, settings: { widthPx: "1200", heightPx: "640", pngDpi: "1e", theme: "light" },
      validation: { render: null, dpi: { code: "FIGURE_WHOLE_COUNT", fields: ["pngDpi"] } },
      preview: async request => ({ ...rendered(request.requestId), empty: true }) as FigurePreviewOutcome });
    render(<ExportFigureDialog {...value} />);
    await screen.findByRole("img");
    expect(screen.getByText(/empty spectrum figure/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: /^PNG DPI/ })).toHaveValue("1e");
    fireEvent.click(screen.getByRole("button", { name: "Export PNG…" }));
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export SVG…" }));
    expect(onExport).toHaveBeenCalledExactlyOnceWith(question, "svg");
  });

  it("gives a typed refusal a retry and rejects mismatched request identities", async () => {
    const preview = vi.fn().mockResolvedValueOnce({ status: "refused", requestId: 1, error: { kind: "linked_selection_outside_range", summary: "raw owned English", detail: null, retryable: true } }).mockResolvedValueOnce(rendered(99));
    render(<ExportFigureDialog {...props({ preview })} />);
    expect(await screen.findByText("The selected scan is outside the current RT range. Choose Full run or include the scan in the range.")).toBeVisible();
    expect(screen.queryByText("raw owned English")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    expect(await screen.findByText("The preview could not be read. Try the preview again.")).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
