/**
 * Layers, as the interface offers them.
 *
 * What is proved here is what the *page* does with a layer: when a reference
 * offers to create one and when it offers to show the one it has, that the row
 * is named by its source and says both whether that source is in the Workbench
 * and what the last check established about it, that Details describes a
 * layer through its source, and that creating, showing, inspecting and removing
 * one sends nothing but the one request each of the first and last make. The
 * fake project boundary answers with a table this file chose; that a layer
 * survives a save and a reopen, that two layers for one reference are refused,
 * and that a reference with a layer is refused rather than cascaded are proved
 * against real files in `apps/desktop/src-tauri/src/project/tests.rs`.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import projectStyles from "./project.css?raw";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { UI_RESOURCES } from "../preferences/i18n";
import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import {
  capturedProject,
  createFakeProjectApi,
  openProject,
  projectInput,
  projectLayer,
  type FakeProjectApi,
} from "../../test/projectFixtures";
import { ProjectApiProvider, type ProjectState } from "./projectApi";
import { ProjectPanel } from "./ProjectPanel";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { useProject } from "./useProject";

const en = UI_RESOURCES.en;
const zh = UI_RESOURCES["zh-CN"];

const INPUT = "11111111-2222-4111-8111-111111111111";
const RUN = "ffffffff-2222-4111-8111-111111111111";
const LAYER = "dddddddd-2222-4111-8111-111111111111";
const HANDLE = "dataset-row-1";
const LABEL = "QC_pool_01.mzML";

async function press(control: HTMLElement) {
  await act(async () => {
    fireEvent.click(control);
  });
}

/** The captured lineage, admitted as a live row this session. */
function attached(input: Partial<ProjectState["inputs"][number]> = {}): ProjectState {
  return capturedProject({
    input: { verification: "matchingRecordedContent", workbenchDatasetHandle: HANDLE, ...input },
  });
}

/** The same, with the one layer its reference can have. */
function layered(input: Partial<ProjectState["inputs"][number]> = {}): ProjectState {
  return { ...attached(input), layers: [projectLayer({ id: LAYER, sourceInputId: INPUT })] };
}

interface HarnessProps {
  readonly live?: ReadonlySet<string>;
  readonly onShow?: (handle: string) => void;
  readonly locale?: "en" | "zh-CN";
}

/** The shell's wiring: one session feeding the list and the contextual region. */
function Harness({ live = new Set([HANDLE]), onShow = () => undefined }: HarnessProps) {
  const session = useProject();
  return (
    <>
      <ProjectPanel
        session={session}
        liveDatasetHandles={live}
        onShowInWorkbench={onShow}
        detailsPresent
      />
      <aside id="workbench-inspector">
        <ProvenanceDetails
          provenance={session.provenance}
          onSelect={session.inspect}
          liveDatasetHandles={live}
          onShowInWorkbench={onShow}
        />
      </aside>
    </>
  );
}

function tree(api: FakeProjectApi, props: HarnessProps) {
  return (
    <PreferencesApiProvider
      value={createFakePreferencesApi({
        stored: storedRecord({ appearance: { locale: props.locale ?? "en" } }),
      })}
    >
      <SessionPreferencesProvider>
        <ProjectApiProvider value={api}>
          <Harness {...props} />
        </ProjectApiProvider>
      </SessionPreferencesProvider>
    </PreferencesApiProvider>
  );
}

function mount(state: ProjectState, props: HarnessProps = {}) {
  const api = createFakeProjectApi(state);
  const { rerender } = render(tree(api, props));
  return { api, rerender: (next: HarnessProps) => rerender(tree(api, { ...props, ...next })) };
}

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  return element;
}

/** The one create-or-show control on a reference's row. */
function layerControl(inputId: string): HTMLButtonElement {
  return query(
    `[data-project-create-layer="${inputId}"], ` +
      `[data-project-input="${inputId}"] [data-project-show-layer]`,
  );
}

function layerRow(id: string): HTMLElement {
  return query(`[data-project-layer="${id}"]`);
}

function details(): HTMLElement {
  return query("#workbench-inspector");
}

/**
 * Waits for the project to be on screen, with its arrival fully settled.
 *
 * The session forgets what is inspected when the open project changes, and
 * the first read is such a change. That is a passive effect, flushed a moment
 * after the rows appear -- so a press landing in between would select and
 * then be forgotten, and the test would describe this machine's timing rather
 * than the interface. The empty act flushes it.
 */
async function ready(label: string = en.projectReferences) {
  await screen.findByText(label);
  await act(async () => {});
}

function describing(): string | null {
  return document.querySelector("[data-provenance]")?.getAttribute("data-provenance") ?? null;
}

/** The properties that make a control a keyboard-activated one with visible focus. */
function expectKeyboardReachable(control: HTMLElement) {
  // A native button in the tab order, which the platform activates with Enter
  // and Space and outlines from the shared focus rule. jsdom synthesizes
  // neither, so this asserts the properties and the browser scenario presses
  // the key for real.
  expect(control.tagName).toBe("BUTTON");
  expect(control.getAttribute("type")).toBe("button");
  expect(control.hasAttribute("disabled")).toBe(false);
  expect(control.tabIndex).toBe(0);
  control.focus();
  expect(document.activeElement).toBe(control);
}

describe("creating a layer from a reference", () => {
  const CHECKED = "11111111-3333-4111-8111-111111111111";
  const UNCHECKED = "11111111-4444-4111-8111-111111111111";

  /** Three references: in the Workbench, checked but not admitted, never checked. */
  function threeReferences(): ProjectState {
    return openProject({
      inputs: [
        projectInput({
          id: INPUT,
          label: LABEL,
          verification: "matchingRecordedContent",
          workbenchDatasetHandle: HANDLE,
        }),
        projectInput({ id: CHECKED, label: "checked.mzML", verification: "matchingRecordedContent" }),
        projectInput({ id: UNCHECKED, label: "unchecked.mzML", verification: "notChecked" }),
      ],
    });
  }

  it("offers it only for a reference whose row is in the Workbench right now", async () => {
    mount(threeReferences());
    await ready();

    const offered = layerControl(INPUT);
    expect(offered.textContent).toBe(en.projectCreateLayer);
    expect(offered.getAttribute("aria-label")).toBe(`Create a layer from ${LABEL}`);
    expect(offered.getAttribute("aria-disabled")).toBeNull();
    expect(offered.getAttribute("data-project-layer-unavailable")).toBeNull();

    // A check alone is not enough, and neither is never having checked: the
    // question is whether a live row exists, and both answer no. The control
    // stays reachable and points at the one reason.
    for (const id of [CHECKED, UNCHECKED]) {
      const control = layerControl(id);
      expect(control.hasAttribute("disabled")).toBe(false);
      expect(control.getAttribute("aria-disabled")).toBe("true");
      expect(control.getAttribute("data-project-layer-unavailable")).toBe("notInWorkbench");
      expect(control.getAttribute("title")).toBe(en.projectLayerNeedsWorkbench);
      const reason = document.getElementById(control.getAttribute("aria-describedby") ?? "");
      expect(reason?.textContent).toBe(en.projectLayerNeedsWorkbench);
    }
  });

  it("sends nothing from an inert control", async () => {
    const { api } = mount(threeReferences());
    await ready();

    await press(layerControl(UNCHECKED));
    await act(async () => {
      fireEvent.keyDown(layerControl(CHECKED), { key: "Enter" });
      fireEvent.keyUp(layerControl(CHECKED), { key: "Enter" });
    });

    expect(api.createProjectLayer).not.toHaveBeenCalled();
    expect(api.beginProjectJob).not.toHaveBeenCalled();
  });

  it("creates the layer, keeps the keyboard on the control and turns it into Show", async () => {
    const { api } = mount(attached());
    await ready();
    api.set(layered());

    const control = layerControl(INPUT);
    control.focus();
    await press(control);

    // One request, naming the reference. Nothing was checked, read or run.
    await waitFor(() => expect(api.createProjectLayer).toHaveBeenCalledWith(INPUT));
    expect(api.beginProjectJob).not.toHaveBeenCalled();
    expect(api.checkProjectLinks).not.toHaveBeenCalled();

    // The same element, now the Show control, still holding the keyboard: the
    // answer changed what the control does, not which element it is.
    await waitFor(() => expect(control.getAttribute("data-project-show-layer")).toBe(LAYER));
    expect(control.textContent).toBe(en.projectShowLayer);
    expect(control.getAttribute("aria-label")).toBe(`Show the layer of ${LABEL}`);
    expect(control.hasAttribute("data-project-create-layer")).toBe(false);
    expect(document.activeElement).toBe(control);
    expect(document.querySelector(`[data-project-create-layer="${INPUT}"]`)).toBeNull();

    // And Details answers at once, without the reader finding the new row.
    expect(describing()).toBe("layer");
    expect(layerRow(LAYER).querySelector("[aria-current='true']")).toBeTruthy();
  });

  it("shows the layer a reference already has rather than creating a second one", async () => {
    const { api } = mount(layered());
    await ready();

    const control = layerControl(INPUT);
    expect(control.textContent).toBe(en.projectShowLayer);
    expect(control.getAttribute("aria-disabled")).toBeNull();
    const before = [...api.calls];

    await press(control);

    // Showing is navigation. Nothing was asked of the boundary.
    expect(api.calls).toEqual(before);
    expect(api.createProjectLayer).not.toHaveBeenCalled();
    expect(describing()).toBe("layer");
    expect(
      within(layerRow(LAYER)).getByRole("button", { name: `Show what the layer of ${LABEL} is related to` })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("names a refused creation in the project's own words", async () => {
    const { api } = mount(attached());
    api.refuseOnce("createProjectLayer", "notInWorkbench");
    await ready();

    await press(layerControl(INPUT));

    await waitFor(() =>
      expect(document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem")).toBe(
        "notInWorkbench",
      ),
    );
    expect(screen.getAllByText(en.projectRefusedNotInWorkbench).length).toBeGreaterThan(0);
    expect(screen.queryByText(en.projectRefusedUnknown)).toBeNull();
  });
});

describe("the layer list", () => {
  it("is empty until a layer exists, and says how one is made", async () => {
    mount(attached());
    await ready();

    const section = screen.getByRole("region", { name: en.projectLayers });
    expect(within(section).getByText(en.projectNoLayers)).toBeTruthy();
    expect(document.querySelector("[data-project-layer]")).toBeNull();
  });

  it("names each layer by its source and says both current facts about it", async () => {
    mount(layered());
    await ready();

    const row = layerRow(LAYER);
    expect(row.getAttribute("data-layer-availability")).toBe("attached");
    expect(row.getAttribute("data-layer-source")).toBe(INPUT);
    // The name is the source's label. The layer's own identifier is on the
    // element for anything reading it, and nowhere a person would read.
    const label = within(row).getByRole("button", {
      name: `Show what the layer of ${LABEL} is related to`,
    });
    expect(label.textContent).toBe(LABEL);
    expect(row.textContent).not.toContain(LAYER);
    // Two facts, two sentences: in the Workbench, and what the check found.
    expect(within(row).getByText(en.projectLayerAttached)).toBeTruthy();
    const state = row.querySelector(".project-verification");
    expect(state?.textContent).toContain(en.provenanceCurrentFile);
    expect(state?.textContent).toContain(en.projectStateMatching);
  });

  it("inspects a layer from its row", async () => {
    const { api } = mount(layered());
    await ready();
    const before = [...api.calls];

    const label = within(layerRow(LAYER)).getByRole("button", {
      name: `Show what the layer of ${LABEL} is related to`,
    });
    expect(label.getAttribute("aria-controls")).toBe("workbench-inspector");
    await press(label);

    expect(label.getAttribute("aria-current")).toBe("true");
    expect(describing()).toBe("layer");
    expect(api.calls).toEqual(before);
  });

  it("offers Show in Workbench only while the source's row is live", async () => {
    const shown: string[] = [];
    const { api } = mount(layered(), { onShow: (handle) => shown.push(handle) });
    await ready();

    const show = within(layerRow(LAYER)).getByRole("button", {
      name: `Show in Workbench: ${LABEL}`,
    });
    expect(show.getAttribute("data-project-layer-show-in-workbench")).toBe(LAYER);
    const before = [...api.calls];
    await press(show);

    expect(shown).toEqual([HANDLE]);
    expect(api.calls).toEqual(before);
  });

  it("is detached, with nothing to show, when the row is not in the roster", async () => {
    mount(layered(), { live: new Set<string>() });
    await ready();

    const row = layerRow(LAYER);
    expect(row.getAttribute("data-layer-availability")).toBe("detached");
    expect(within(row).getByText(en.projectLayerDetached)).toBeTruthy();
    expect(row.querySelector("[data-project-layer-show-in-workbench]")).toBeNull();

    await press(within(row).getByRole("button", { name: `Show what the layer of ${LABEL} is related to` }));
    expect(query("[data-provenance-availability]").getAttribute("data-provenance-availability")).toBe(
      "detached",
    );
    expect(details().querySelector("[data-provenance-layer-show-in-workbench]")).toBeNull();
    expect(within(details()).getByText(en.projectLayerDetached)).toBeTruthy();
  });

  it("becomes detached when its row leaves the roster, and stays a layer", async () => {
    const { rerender } = mount(layered());
    await ready();
    expect(layerRow(LAYER).getAttribute("data-layer-availability")).toBe("attached");
    expect(layerRow(LAYER).querySelector("[data-project-layer-show-in-workbench]")).toBeTruthy();

    // The row was removed, or the workspace cleared. The roster is the only
    // authority on which rows exist, so nothing else has to be told.
    rerender({ live: new Set<string>() });

    expect(layerRow(LAYER).getAttribute("data-layer-availability")).toBe("detached");
    expect(layerRow(LAYER).querySelector("[data-project-layer-show-in-workbench]")).toBeNull();
    expect(within(layerRow(LAYER)).getByText(LABEL)).toBeTruthy();
  });

  it("keeps a layer across a reopen that forgot the row, and offers no second one", async () => {
    const { api } = mount(layered());
    await ready();

    // The document reopened: the layer is in it, and the session handle is
    // not, because a handle is never written to the project file.
    api.set(layered({ workbenchDatasetHandle: null }));
    await press(screen.getByRole("button", { name: en.projectOpen }));

    await waitFor(() => expect(layerRow(LAYER).getAttribute("data-layer-availability")).toBe("detached"));
    expect(layerControl(INPUT).textContent).toBe(en.projectShowLayer);
    expect(layerControl(INPUT).getAttribute("data-project-show-layer")).toBe(LAYER);
    expect(document.querySelector(`[data-project-create-layer="${INPUT}"]`)).toBeNull();
  });

  it("shows the source's current state while the layer's provenance stays as it was", async () => {
    for (const [verification, reason, expected] of [
      ["notChecked", null, en.projectStateNotChecked],
      ["differentContent", null, en.projectStateDifferent],
      ["unavailable", "missingAtCheckedLocation", en.projectStateMissing],
    ] as const) {
      cleanup();
      mount(layered({ verification, unavailableReason: reason }));
      await ready();

      // On the row, as the source's fact and labelled as current.
      const state = layerRow(LAYER).querySelector(".project-verification");
      expect(state?.textContent).toContain(expected);

      // And in Details, with the same source link and the same run: a file
      // that changed or went missing did not change what the layer is.
      await press(
        within(layerRow(LAYER)).getByRole("button", {
          name: `Show what the layer of ${LABEL} is related to`,
        }),
      );
      const current = details().querySelector("[data-provenance-current]");
      expect(current?.textContent).toContain(expected);
      expect(details().querySelector(`[data-provenance-link="${INPUT}"]`)).toBeTruthy();
      expect(details().querySelector(`[data-provenance-link="${RUN}"]`)).toBeTruthy();
    }
  });

  it("removes a layer through its own control, and names the refusal a reference with one gets", async () => {
    const { api } = mount(layered());
    await ready();

    api.set(attached());
    await press(within(layerRow(LAYER)).getByRole("button", { name: `Remove the layer of ${LABEL}` }));
    await waitFor(() => expect(api.removeProjectLayer).toHaveBeenCalledWith(LAYER));
    await waitFor(() => expect(document.querySelector("[data-project-layer]")).toBeNull());

    // A reference with a layer is refused, not cascaded, and the sentence
    // says what to do rather than that something was refused.
    api.set(layered());
    api.refuseOnce("removeProjectInput", "layerDependsOnInput");
    await press(screen.getByRole("button", { name: `Remove ${LABEL} from this project` }));
    await waitFor(() =>
      expect(document.querySelector("[data-project-problem]")?.getAttribute("data-project-problem")).toBe(
        "layerDependsOnInput",
      ),
    );
    expect(screen.getAllByText(en.projectRefusedLayerDependsOnInput).length).toBeGreaterThan(0);
    expect(screen.queryByText(en.projectRefusedUnknown)).toBeNull();
  });

  it("renders a layer whose source is gone rather than failing", async () => {
    // A valid document cannot hold one. Should one arrive, the row says so.
    mount(openProject({ inputs: [], layers: [projectLayer({ id: LAYER, sourceInputId: INPUT })] }));
    await ready();

    const row = layerRow(LAYER);
    expect(row.getAttribute("data-layer-availability")).toBe("detached");
    expect(within(row).getByText(en.provenanceRelatedGone)).toBeTruthy();

    await press(within(row).getByRole("button", { name: /is related to/ }));
    expect(describing()).toBe("layer");
    expect(within(details()).getByRole("heading", { name: en.provenanceRelatedGone })).toBeTruthy();
    expect(details().querySelector(`[data-provenance-gone="${INPUT}"]`)).toBeTruthy();
    expect(within(details()).getByText(en.provenanceUsedByNothing)).toBeTruthy();
  });

  it("reaches every layer control from the keyboard", async () => {
    mount(layered());
    await ready();

    expectKeyboardReachable(layerControl(INPUT));
    const row = layerRow(LAYER);
    expectKeyboardReachable(
      within(row).getByRole("button", { name: `Show what the layer of ${LABEL} is related to` }),
    );
    expectKeyboardReachable(within(row).getByRole("button", { name: `Show in Workbench: ${LABEL}` }));
    expectKeyboardReachable(within(row).getByRole("button", { name: `Remove the layer of ${LABEL}` }));
  });
});

describe("a layer in Details", () => {
  async function inspectLayer() {
    await ready();
    await press(
      within(layerRow(LAYER)).getByRole("button", {
        name: `Show what the layer of ${LABEL} is related to`,
      }),
    );
    await waitFor(() => expect(describing()).toBe("layer"));
  }

  it("describes a layer through its source", async () => {
    const shown: string[] = [];
    const { api } = mount(layered(), { onShow: (handle) => shown.push(handle) });
    await inspectLayer();
    const before = [...api.calls];

    const region = within(details());
    expect(region.getByText(en.provenanceKindLayer)).toBeTruthy();
    expect(region.getByRole("heading", { name: LABEL })).toBeTruthy();
    // Current availability, and the way to the row while there is one.
    expect(region.getByText(en.provenanceLayerAvailability)).toBeTruthy();
    expect(query("[data-provenance-availability]").getAttribute("data-provenance-availability")).toBe(
      "attached",
    );
    await press(query("[data-provenance-layer-show-in-workbench]"));
    expect(shown).toEqual([HANDLE]);
    // The source, as a relationship, with its own current file state beside it.
    expect(region.getByText(en.provenanceLayerSource)).toBeTruthy();
    const source = details().querySelector(`[data-provenance-link="${INPUT}"]`);
    expect(source?.getAttribute("aria-label")).toBe(`Show what ${LABEL} is related to`);
    expect(source?.parentElement?.querySelector("[data-provenance-current]")).toBeTruthy();
    // And the source's runs, as the layer's history: it has none of its own.
    expect(region.getByText(en.provenanceUsedBy)).toBeTruthy();
    expect(details().querySelector(`[data-provenance-link="${RUN}"]`)).toBeTruthy();
    expect(api.calls).toEqual(before);
  });

  it("navigates between a layer and its source in both directions, locally", async () => {
    const { api } = mount(layered());
    await inspectLayer();
    const before = [...api.calls];

    // Layer -> source.
    await press(query(`[data-provenance-link="${INPUT}"]`));
    expect(describing()).toBe("input");
    // Source -> its layer, under a section that names it.
    expect(within(details()).getByText(en.provenanceLayer)).toBeTruthy();
    const back = query(`[data-provenance-link="${LAYER}"]`);
    expect(back.getAttribute("aria-label")).toBe(`Show what the layer of ${LABEL} is related to`);
    await press(back);
    expect(describing()).toBe("layer");

    expect(api.calls).toEqual(before);
    expect(api.getProjectState).toHaveBeenCalledTimes(1);
  });

  it("says a reference has no layer where none was created", async () => {
    mount(attached());
    await ready();
    await press(screen.getByRole("button", { name: `Show what ${LABEL} is related to` }));

    expect(details().querySelector("[data-provenance-no-layer]")).toBeTruthy();
    expect(within(details()).getByText(en.provenanceNoLayer)).toBeTruthy();
    expect(within(details()).getByText(en.provenanceLayer)).toBeTruthy();
  });

  it("asks for a layer among the things that can be selected", () => {
    mount(layered());
    expect(within(details()).getByText(en.provenanceNothingSelected)).toBeTruthy();
    expect(en.provenanceNothingSelected).toContain("layer");
    expect(zh.provenanceNothingSelected).toContain("图层");
  });

  it("wraps a long source name rather than overflowing the region", async () => {
    const long = `${"very_".repeat(30)}long_acquisition_name.mzML`;
    mount(layered({ label: long }));
    await ready();
    await press(within(layerRow(LAYER)).getByRole("button", { name: /is related to/ }));

    // jsdom lays nothing out, so this holds the stylesheet to its word: the
    // heading and the row carry the classes whose rules break anywhere. The
    // browser scenario measures the region for real.
    const heading = within(details()).getByRole("heading", { name: long });
    expect(heading.className).toBe("provenance-name");
    expect(layerRow(LAYER).className).toContain("project-row");
    const style = document.createElement("style");
    style.textContent = projectStyles;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSStyleRule => "selectorText" in rule,
      );
      const heads = rules.find((rule) => rule.selectorText === ".provenance-name");
      const rows = rules.find((rule) => rule.selectorText.split(",").map((s) => s.trim()).includes(".project-row"));
      expect(heads?.style.getPropertyValue("overflow-wrap")).toBe("anywhere");
      expect(rows?.style.getPropertyValue("overflow-wrap")).toBe("anywhere");
    } finally {
      style.remove();
    }
  });

  it("renders the layer row and Details in Simplified Chinese", async () => {
    mount(layered(), { locale: "zh-CN" });
    await ready(zh.projectReferences);

    expect(screen.getByRole("region", { name: zh.projectLayers })).toBeTruthy();
    expect(screen.getByRole("button", { name: `显示 ${LABEL} 的图层` }).textContent).toBe(
      zh.projectShowLayer,
    );
    const row = layerRow(LAYER);
    expect(within(row).getByText(zh.projectLayerAttached)).toBeTruthy();
    expect(within(row).getByText(zh.projectStateMatching)).toBeTruthy();
    expect(within(row).getByRole("button", { name: `移除 ${LABEL} 的图层` })).toBeTruthy();

    await press(within(row).getByRole("button", { name: `查看 ${LABEL} 的图层的关联` }));
    const region = within(details());
    expect(region.getByText(zh.provenanceKindLayer)).toBeTruthy();
    expect(region.getByText(zh.provenanceLayerAvailability)).toBeTruthy();
    expect(region.getByText(zh.provenanceLayerSource)).toBeTruthy();
    expect(region.getByText(zh.projectLayerAttached)).toBeTruthy();

    // Translated, not copied, and no English fell through.
    expect(document.body.textContent).not.toContain(en.projectLayerAttached);
    expect(document.body.textContent).not.toContain(en.projectLayers);
    expect(zh.projectLayerAttached).not.toEqual(en.projectLayerAttached);
    expect(zh.projectNoLayers).not.toEqual(en.projectNoLayers);
    expect(zh.provenanceLayerSource).not.toEqual(en.provenanceLayerSource);
    expect(zh.projectRefusedLayerDependsOnInput).not.toEqual(en.projectRefusedLayerDependsOnInput);
  });
});
