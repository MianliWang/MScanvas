/**
 * What the banner says between an observation and the reading that describes it.
 *
 * ADR 0044 Decision 4, ledger row 110. An operation that produced no
 * `BackendAvailabilityDto` can still move the authority — a refused `BEGIN`, a
 * queue poll, a settings read — so the projection advances and the reading does
 * not. A banner that went on presenting that reading as fact would name a build
 * the session has left, at the one surface whose whole job is to say which build
 * the session is on.
 *
 * **Entire, not just the verdict.** The release, the build date and the origin
 * describe a build as much as "available" does, so the half-fix — marking the
 * verdict stale beside the old installation's name — is the defect row 110 is
 * about rather than the repair.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PreviewApi } from "./api";
import { PreviewApiProvider } from "./api";
import type { BackendAvailability, SelectedFile, WorkspaceConversionState } from "./contracts";
import { BackendStatus } from "./BackendStatus";
import { WorkspaceDropTransportProvider } from "./dropTransport";
import { PreviewWorkspace } from "./PreviewWorkspace";
import type { FakePreviewApi } from "../../test/previewFixtures";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  planIdentity,
  queueItem,
  queueOf,
  unavailableBackend,
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

/** The reading the fake hands back, with everything a banner would name. */
const NAMED_BUILD = {
  ...availableBackend,
  release: "3.0.25000",
  buildDate: "2026-05-04",
};

function renderWorkspace(api: PreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <PreviewWorkspace />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

const RUNNING: WorkspaceConversionState = {
  status: "running",
  operationId: "1",
  queue: queueOf([queueItem(VENDOR.handle, VENDOR.fileName, { state: "running", attempts: 1 })]),
};

/**
 * A conversion that starts and never finishes, so the lane stays held.
 *
 * The lane is what defers the remedial check, which is what makes the
 * superseded window observable at all: with a free lane the check is issued at
 * once and the banner is only ever briefly disclaiming.
 */
function heldDrain(
  _request: unknown,
  publish: (state: WorkspaceConversionState) => void,
): Promise<WorkspaceConversionState> {
  publish(RUNNING);
  return new Promise<WorkspaceConversionState>(() => undefined);
}

const SUPERSEDED = '[data-backend-reading="superseded"]';

/** Drives a session into the window where a reading has stopped describing it. */
async function supersedeTheReading(
  options: { readonly reading?: BackendAvailability } = {},
): Promise<{ readonly api: FakePreviewApi }> {
  const api = createFakePreviewApi({
    initialDatasets: [VENDOR],
    availability: options.reading ?? NAMED_BUILD,
    conversion: heldDrain,
  });
  renderWorkspace(api);
  const panel = await screen.findByRole("region", { name: "Convert" });
  // A conversion takes the lane, so the check the replacement will owe is
  // deferred and the superseded window is one this test can look at.
  const convert = within(panel).getByRole("button", { name: /^Convert/ });
  await waitFor(() => {
    expect(convert).toBeEnabled();
  });
  fireEvent.click(convert);
  await waitFor(() => {
    expect(panel.querySelector(".conversion-running")).not.toBeNull();
  });
  // Rust moves to a different installation, and the poll is the session's only
  // voice while a drain runs.
  act(() => {
    api.replaceTheBindingSilently();
  });
  await waitFor(
    () => {
      expect(document.querySelector(SUPERSEDED)).not.toBeNull();
    },
    { timeout: 20_000 },
  );
  return { api };
}

describe("a reading that has stopped describing the session", () => {
  it("names no build as current", async () => {
    await supersedeTheReading();
    const banner = document.querySelector(SUPERSEDED);
    const said = banner?.textContent ?? "";

    // Not the verdict, not the release, not the build date, not the origin.
    expect(said).not.toContain("ProteoWizard is available");
    expect(said).not.toContain("3.0.25000");
    expect(said).not.toContain("built 2026-05-04");
    expect(said).not.toContain("from the folder you chose");
    // And the whole document, not merely this element: a second copy elsewhere
    // would be the same claim in another place.
    const page = document.body.textContent ?? "";
    expect(page).not.toContain("ProteoWizard is available");
    expect(page).not.toContain("3.0.25000");
  });

  it("says what happened, rather than going quiet", async () => {
    await supersedeTheReading();
    expect(document.querySelector(SUPERSEDED)?.textContent).toContain(
      "The installed ProteoWizard changed",
    );
  });

  it("keeps every way out live", async () => {
    // This state is a wait for a read MSCanvas already owes. Where that read is
    // deferred behind a conversion, the reader is still entitled to ask for one
    // themselves -- which is the floor Decision 4 requires.
    await supersedeTheReading();
    const banner = document.querySelector(SUPERSEDED) as HTMLElement;
    const recheck = [...banner.querySelectorAll("button")].find(
      (control) => control.textContent?.trim() === "Check again",
    );
    expect(recheck).toBeDefined();
    expect(recheck).toBeEnabled();
    expect(
      [...banner.querySelectorAll("button")].some((control) =>
        (control.textContent ?? "").includes("folder"),
      ),
    ).toBe(true);
  });

  it("loses none of the reason the previous reading carried", () => {
    // A reader who was told why the previous backend was unusable does not stop
    // being owed that sentence because a newer publication arrived.
    //
    // Rendered at the component rather than driven through a drain, because the
    // route above needs a conversion to hold the lane and an unusable backend
    // refuses one. This is the same element the integration tests reach, given
    // the one reading they cannot produce.
    render(
      <BackendStatus
        busy={false}
        onChooseInstallation={() => undefined}
        onRecheck={() => undefined}
        onUseAutomaticDiscovery={() => undefined}
        readingSuperseded
        state={{ status: "resolved", availability: unavailableBackend }}
      />,
    );
    const said = document.querySelector(SUPERSEDED)?.textContent ?? "";
    expect(said).toContain(unavailableBackend.failure?.summary ?? "");
    // Said as history rather than as the current state of the session.
    expect(said).toContain("That earlier reading said");
    expect(said).not.toContain("ProteoWizard is not available");
  });
});

describe("a reading that still describes the session", () => {
  it("is presented as fact, with everything it names", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR],
      availability: NAMED_BUILD,
    });
    renderWorkspace(api);
    await screen.findByText(/ProteoWizard is available/);
    expect(document.querySelector(SUPERSEDED)).toBeNull();
    expect(document.body.textContent).toContain("3.0.25000");
  });

  it("comes back as fact once the recovery check answers", async () => {
    const { api } = await supersedeTheReading();
    // The reader presses the control the superseded state left them.
    const banner = document.querySelector(SUPERSEDED) as HTMLElement;
    const recheck = [...banner.querySelectorAll("button")].find(
      (control) => control.textContent?.trim() === "Check again",
    ) as HTMLButtonElement;
    fireEvent.click(recheck);

    await waitFor(() => {
      expect(document.querySelector(SUPERSEDED)).toBeNull();
    });
    await screen.findByText(/ProteoWizard is available/);
    expect(api.calls().filter((call) => call === "inspectBackend").length).toBeGreaterThan(1);
  });
});

describe("a reading that is merely absent", () => {
  it("is not disclaimed as superseded", async () => {
    // A check in flight is the absence of a reading, not a reading that has
    // stopped being true. The banner says it is checking, and says nothing
    // about a build having changed.
    const held = deferred<typeof availableBackend>();
    const api = createFakePreviewApi({
      initialDatasets: [VENDOR],
      availability: () => held.promise,
    });
    renderWorkspace(api);
    await screen.findByText(/Checking for an installed ProteoWizard backend/);
    expect(document.querySelector(SUPERSEDED)).toBeNull();
    act(() => {
      held.resolve(NAMED_BUILD);
    });
    await screen.findByText(/ProteoWizard is available/);
    expect(planIdentity([VENDOR.handle]).receipt).toBeGreaterThan(0);
  });
});
