import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversionSettings } from "./ConversionSettings";
import type { ConversionCatalogRow, ConversionConfiguration } from "./contracts";
import type { ConversionConfigurationView } from "./useConversionConfiguration";
import { admittedIntents, shippedIntent } from "../../test/previewFixtures";

afterEach(cleanup);

const COMPLETE: readonly ConversionCatalogRow[] = admittedIntents.map((intent) => ({
  intent,
  available: true,
  availability: "available",
}));

const id = (
  processing: string,
  population: string,
  precision: string,
  compression: string,
): string => `mzml+${processing}+${population}+${precision}+${compression}`;

const CENTROIDED_64 = id("unscoped_default_centroiding", "all", "mz64_intensity64", "zlib");
const CENTROIDED_32 = id("unscoped_default_centroiding", "all", "mz32_intensity32", "zlib");
const FLAT_32 = id("no_additional_centroiding", "all", "mz32_intensity32", "zlib");

function withoutRunning(...ids: readonly string[]): readonly ConversionCatalogRow[] {
  // The discriminator moves with the boolean; the pair is one decision in Rust.
  return COMPLETE.map((row) => ({
    ...row,
    available: !ids.includes(row.intent.id),
    availability: ids.includes(row.intent.id)
      ? ("unsupported_by_installation" as const)
      : ("available" as const),
  }));
}

function view(
  configuration: ConversionConfiguration | null,
  overrides: Partial<ConversionConfigurationView> = {},
): ConversionConfigurationView {
  const catalog = configuration?.configuration === "ready" ? configuration.catalog : [];
  return {
    configuration,
    catalog,
    shippedIntentId: configuration?.configuration === "ready" ? configuration.shipped : null,
    selectedIntentId: catalog.length === 0 ? null : shippedIntent.id,
    select: vi.fn(),
    reading: false,
    refusal: null,
    retryOffered: false,
    retry: vi.fn(),
    ...overrides,
  };
}

function ready(
  catalog: readonly ConversionCatalogRow[] = COMPLETE,
): ConversionConfiguration & { configuration: "ready" } {
  return { configuration: "ready", catalog, shipped: shippedIntent.id };
}

function panel(): HTMLElement {
  const found = document.querySelector(".conversion-settings");
  if (found === null) {
    throw new Error("the settings surface is not on screen");
  }
  return found as HTMLElement;
}

function groupFor(axis: string): HTMLElement {
  const found = document.querySelector(`[data-axis="${axis}"]`);
  if (found === null) {
    throw new Error(`no control group for ${axis}`);
  }
  return found as HTMLElement;
}

describe("before there is a catalog", () => {
  it("says a read is under way while nothing is held", () => {
    // Holding nothing is an observation about this document, not a judgement
    // about the configuration. It says what it is doing, and decides nothing.
    render(<ConversionSettings configuration={view(null)} onChoose={vi.fn()} refusalNoticeId={null} />);
    expect(panel().dataset.settingsState).toBe("loading");
  });

  it("says the same while Rust says the catalog is unread", () => {
    render(
      <ConversionSettings
        configuration={view({ configuration: "unattempted" })}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />,
    );
    expect(panel().dataset.settingsState).toBe("loading");
  });

  it("says nothing at all when the session is bound to no installation", () => {
    // The panel above already explains that this session has no usable
    // ProteoWizard. A second sentence saying the same thing beside an empty
    // space would be the interface telling a reader twice.
    const { container } = render(
      <ConversionSettings
        configuration={view({ configuration: "unavailableForBinding" })}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("a read that answered unusably", () => {
  const failed: ConversionConfiguration = {
    configuration: "failed",
    error: {
      kind: "capability_evidence_unavailable",
      summary: "The installed ProteoWizard did not describe the commands MSCanvas needs.",
      detail: null,
      retryable: false,
    },
  };

  it("shows what did not work, and a way to ask again", () => {
    // Nothing else will ask: the installation has not changed, so everything
    // keyed on it correctly stays where it is. Without this control a build
    // whose help will not parse would refuse every conversion for the session.
    render(
      <ConversionSettings
        configuration={view(failed, { retryOffered: true })}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />,
    );
    expect(
      screen.getByText("The installed ProteoWizard did not describe the commands MSCanvas needs."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Read the settings again" })).toBeEnabled();
  });

  it("points the control at the failure it is a retry of", () => {
    render(
      <ConversionSettings
        configuration={view(failed, { retryOffered: true })}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />,
    );
    const control = screen.getByRole("button", { name: "Read the settings again" });
    const described = control.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described.split(" ")[0] ?? "")?.textContent).toBe(
      "The installed ProteoWizard did not describe the commands MSCanvas needs.",
    );
  });

  it("disables the control where a read would be refused, and states nothing itself", () => {
    // **The refusing fact has one owner, and it is not this component.** A
    // conversion holding the backend lane refuses this read and a conversion
    // alike; the panel states that fact once and both controls point at it.
    // Minting a second sentence here is what put two elements under one fact's
    // name and left every `aria-describedby` on the surface ambiguous.
    render(
      <ConversionSettings
        configuration={view(failed, { retryOffered: true, refusal: "laneClaimed" })}
        onChoose={vi.fn()}
        refusalNoticeId="conversion-availability-conversion-running"
      />,
    );
    const control = screen.getByRole("button", { name: "Read the settings again" });
    expect(control).toBeDisabled();
    // Named, not restated. Nothing in this subtree carries the id, and nothing
    // in it describes the lane.
    expect(control.getAttribute("aria-describedby")).toBe(
      "conversion-settings-failure conversion-availability-conversion-running",
    );
    expect(
      document.querySelectorAll("#conversion-availability-conversion-running"),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain("while a conversion is running");
  });

  it("offers no control where a read could not improve the answer", () => {
    render(<ConversionSettings
        configuration={view(failed)}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />);
    expect(screen.queryByRole("button", { name: "Read the settings again" })).toBeNull();
  });
});

describe("the four control groups", () => {
  it("edit one dimension each, over one selection", () => {
    render(<ConversionSettings
        configuration={view(ready())}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />);
    for (const axis of ["processing", "population", "precision", "compression"]) {
      const checked = within(groupFor(axis))
        .getAllByRole("radio")
        .filter((radio) => (radio as HTMLInputElement).checked);
      expect(checked).toHaveLength(1);
    }
  });

  it("select the exact combination one edit names", () => {
    const onChoose = vi.fn();
    render(<ConversionSettings
        configuration={view(ready())}
        onChoose={onChoose}
        refusalNoticeId={null}
      />);
    fireEvent.click(within(groupFor("precision")).getByLabelText(/32-bit · intensity 32-bit/));
    expect(onChoose).toHaveBeenCalledWith(FLAT_32);
  });

  it("keep an unqualified value on screen, disabled, with its reason", () => {
    // Removing it would hide the shape of the evidence. That these dimensions
    // do not compose freely is a fact about what has been measured, and a
    // reader choosing conversion settings is entitled to see it.
    render(<ConversionSettings
        configuration={view(ready())}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />);
    const control = within(groupFor("population")).getByLabelText("MS1 spectra only");
    expect(control).toBeDisabled();
    const note = document.getElementById(control.getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toContain("MSCanvas has not qualified that combination");
  });

  it("names the source-evidence refusal for a retained selection, not the installation", () => {
    // A retained centroiding choice on a catalog whose two centroiding rows are
    // withheld for absent source evidence. The banner must not send the reader
    // after a different ProteoWizard build: this one runs the row fine, and what
    // is missing is a measurement no release supplies.
    const withoutSourceEvidence = COMPLETE.map((row) => ({
      ...row,
      available: row.intent.processing !== "unscoped_default_centroiding",
      availability:
        row.intent.processing === "unscoped_default_centroiding"
          ? ("not_evidenced_for_conversion_sources" as const)
          : ("available" as const),
    }));
    render(<ConversionSettings
        configuration={view(ready(withoutSourceEvidence), {
          selectedIntentId: CENTROIDED_64,
        })}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />);
    const note = document.getElementById("conversion-settings-selection-unavailable");
    expect(note?.textContent).toContain("has not measured");
    expect(note?.textContent).not.toContain("ProteoWizard installation");
  });

  it("state the loss centroiding causes without naming an algorithm", () => {
    // M6.10 measured the bare `peakPicking` filter on a lawful vendor
    // acquisition and found this build selecting the vendor picker there, not
    // the local-maximum one this sentence used to name. The loss is supported
    // for every source; the implementation is measured per source family, so
    // the sentence claims the first and not the second.
    render(<ConversionSettings
        configuration={view(ready())}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />);
    const control = within(groupFor("processing")).getByLabelText("Centroid all MS levels");
    const note = document.getElementById(control.getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toContain("Lossy.");
    expect(note?.textContent).toContain("replaces the recorded profile points");
    expect(note?.textContent).not.toContain("local-maximum");
    expect(note?.textContent).not.toContain("vendor");
  });

  it("never call the chooser for a value that cannot be chosen", () => {
    const onChoose = vi.fn();
    render(<ConversionSettings
        configuration={view(ready())}
        onChoose={onChoose}
        refusalNoticeId={null}
      />);
    fireEvent.click(within(groupFor("population")).getByLabelText("MS2 spectra only"));
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("a build that lacks only the peak-picking grammar", () => {
  const catalog = withoutRunning(CENTROIDED_64, CENTROIDED_32);

  function renderCentroided(): void {
    render(
      <ConversionSettings
        configuration={view(ready(catalog), { selectedIntentId: CENTROIDED_64 })}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />,
    );
  }

  it("says the chosen combination cannot run, once", () => {
    renderCentroided();
    expect(
      screen.getAllByText(
        "The conversion settings you chose cannot run with this ProteoWizard installation.",
      ),
    ).toHaveLength(1);
  });

  it("tells no control that a value this build offers is unavailable", () => {
    // The defect this surface exists to close. 64-bit intensity, all spectra
    // and zlib each appear in rows this build runs, so not one of the four
    // groups may report the selected value as unusable -- and the selected
    // control stays enabled, because it is the group's natural focus and the
    // sentence about the combination is said above them.
    renderCentroided();
    for (const axis of ["processing", "population", "precision", "compression"]) {
      const checked = within(groupFor(axis))
        .getAllByRole("radio")
        .find((radio) => (radio as HTMLInputElement).checked);
      expect(checked).toBeEnabled();
      const note = document.getElementById(checked?.getAttribute("aria-describedby") ?? "");
      expect(note?.textContent).not.toContain("Not available");
    }
  });

  it("leaves the one control that is the way out enabled", () => {
    renderCentroided();
    expect(
      within(groupFor("processing")).getByLabelText("No additional centroiding"),
    ).toBeEnabled();
  });

  it("offers no explicit reset while an ordinary control is the way out", () => {
    renderCentroided();
    expect(screen.queryByRole("button", { name: "Use the settings MSCanvas ships" })).toBeNull();
  });
});

describe("a genuine dead end", () => {
  it("offers the shipped combination explicitly, and says why", () => {
    render(
      <ConversionSettings
        configuration={view(
          ready(withoutRunning(CENTROIDED_32, CENTROIDED_64, FLAT_32)),
          { selectedIntentId: CENTROIDED_32 },
        )}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />,
    );
    const control = screen.getByRole("button", { name: "Use the settings MSCanvas ships" });
    expect(control).toBeVisible();
    expect(
      screen.getByText(
        "No single change to one of these settings reaches a combination this build can run.",
      ),
    ).toBeVisible();
  });

  it("selects only the combination Rust names as shipped", () => {
    const onChoose = vi.fn();
    render(
      <ConversionSettings
        configuration={view(
          ready(withoutRunning(CENTROIDED_32, CENTROIDED_64, FLAT_32)),
          { selectedIntentId: CENTROIDED_32 },
        )}
        onChoose={onChoose}
        refusalNoticeId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use the settings MSCanvas ships" }));
    expect(onChoose).toHaveBeenCalledWith(shippedIntent.id);
  });
});

describe("the output format", () => {
  it("is stated rather than offered", () => {
    // A disabled mzXML control would advertise a route this product has
    // measured producing a file that silently drops spectra.
    render(<ConversionSettings
        configuration={view(ready())}
        onChoose={vi.fn()}
        refusalNoticeId={null}
      />);
    expect(screen.getByText("Format")).toBeVisible();
    expect(screen.queryByLabelText(/mzXML/)).toBeNull();
    expect(within(panel()).queryAllByRole("radio", { name: /mzML/ })).toHaveLength(0);
  });
});
