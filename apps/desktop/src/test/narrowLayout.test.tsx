/**
 * The narrow-desktop layout contract from issue #24.
 *
 * jsdom lays nothing out, so nothing here measures a pixel and none of it
 * replaces the rendered Windows check. What it does hold is the two things the
 * rendered fix rests on: the rules that let the workspace fit a narrow
 * viewport, and the fact that the narrow layout is the same markup rather than
 * a second copy of the actions.
 *
 * The viewport in the issue is 900x700 of Windows at 150%, which is 586x430 in
 * CSS pixels. Native window pixels and CSS pixels are not the same number and
 * nothing here is written as though they were.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import appStyles from "../app/app.css?raw";
import { App } from "../app/App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { createFakePreviewApi } from "./previewFixtures";

const mountedStyles: HTMLStyleElement[] = [];

function mountStyles(css: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  mountedStyles.push(style);
  return style;
}

function requireStyleRule(style: HTMLStyleElement, selector: string): CSSStyleRule {
  const rule = Array.from(style.sheet?.cssRules ?? []).find(
    (candidate): candidate is CSSStyleRule =>
      "selectorText" in candidate && candidate.selectorText === selector,
  );

  expect(rule, `Expected a CSS rule for ${selector}`).toBeDefined();
  return rule as CSSStyleRule;
}

function requireMediaRule(
  style: HTMLStyleElement,
  condition: string,
  selector: string,
): CSSStyleRule {
  const media = Array.from(style.sheet?.cssRules ?? []).find(
    (candidate): candidate is CSSMediaRule =>
      "media" in candidate && (candidate as CSSMediaRule).conditionText === condition,
  );
  expect(media, `Expected a @media ${condition} block`).toBeDefined();

  const rule = Array.from((media as CSSMediaRule).cssRules).find(
    (candidate): candidate is CSSStyleRule =>
      "selectorText" in candidate && candidate.selectorText === selector,
  );
  expect(rule, `Expected ${selector} inside @media ${condition}`).toBeDefined();
  return rule as CSSStyleRule;
}

afterEach(() => {
  for (const style of mountedStyles.splice(0)) {
    style.remove();
  }
});

describe("narrow desktop layout rules", () => {
  it("lets the panel header's text block give ground", () => {
    // The defect this repairs. As a flex child the block would not shrink below
    // its own content, so the line inside it never reached the width its
    // ellipsis was written for, and the panel cut the sentence mid-word.
    const app = mountStyles(appStyles);

    // Serialized by the CSSOM, which gives the zero a unit.
    expect(requireStyleRule(app, ".panel-header > div").style.getPropertyValue("min-width")).toBe(
      "0px",
    );
  });

  it("keeps the truncation the shrinking header is there to enable", () => {
    // Without these the block would shrink and the line would simply be cut at
    // the new width instead, which is the same defect at a different size.
    const app = mountStyles(appStyles);
    const header = requireStyleRule(app, ".panel-header p").style;

    expect(header.getPropertyValue("white-space")).toBe("nowrap");
    expect(header.getPropertyValue("overflow")).toBe("hidden");
    expect(header.getPropertyValue("text-overflow")).toBe("ellipsis");
  });

  it("lets an empty-state action break a file name it cannot fit", () => {
    // The action that offers the retained file says its name, and a name can
    // arrive with nothing in it a line may break at. Centred in a panel that
    // clips, an action wider than its box loses both ends -- including the part
    // the user is meant to press.
    const app = mountStyles(appStyles);

    expect(
      requireStyleRule(app, ".empty-state button").style.getPropertyValue("overflow-wrap"),
    ).toBe("anywhere");
  });

  it("drops the workspace to one column before the two-column minimums bite", () => {
    // The two-column track minimums add up to more than a narrow viewport has.
    // This is what keeps them from forcing the document wider than the window,
    // and it is the rule the "no horizontal overflow" half of #24 rests on.
    const app = mountStyles(appStyles);
    const wide = requireStyleRule(app, ".workspace-layout").style;
    const narrow = requireMediaRule(app, "(max-width: 1120px)", ".workspace-layout").style;

    expect(wide.getPropertyValue("grid-template-columns")).toContain("minmax(280px,");
    expect(narrow.getPropertyValue("grid-template-columns")).toBe("minmax(0, 1fr)");
  });

  it("leaves the intrinsically wide table scrolling inside its own panel", () => {
    // A spectrum table is intrinsically wide, so it owns its overflow. The
    // document does not: containment here is what stops a wide table becoming
    // a wide document.
    const app = mountStyles(appStyles);

    expect(requireStyleRule(app, ".panel").style.getPropertyValue("overflow")).toBe("hidden");
    expect(
      requireStyleRule(app, ".spectrum-table-viewport").style.getPropertyValue("overflow"),
    ).toBe("auto");
    // Issue #29: the header row sits inside the one scrolling box and resolves
    // its columns against the same track as the rows, so a label and its values
    // hold one horizontal position between them at any scroll offset.
    const head = requireStyleRule(app, ".spectrum-table-head").style;
    expect(head.getPropertyValue("position")).toBe("sticky");
    expect(head.getPropertyValue("top")).toBe("0px");
    expect(requireStyleRule(app, ".spectrum-table-track").style.getPropertyValue("min-width")).toBe(
      "min-content",
    );
    // And the header's row stays reserved, so a row scrolled into view lands
    // below it rather than behind it.
    expect(
      requireStyleRule(app, ".spectrum-table-viewport").style.getPropertyValue(
        "scroll-padding-top",
      ),
    ).toBe("30px");
  });
});

describe("narrow desktop layout markup", () => {
  it("keeps one set of actions, whatever the width", async () => {
    // A narrow layout that duplicates the actions would pass a screenshot and
    // give a keyboard user two of everything, or a hidden one that still takes
    // a tab stop. There is one of each workspace action and one of each banner
    // action, and the workspace actions live in one place rather than being
    // repeated in a toolbar.
    render(
      <PreviewApiProvider value={createFakePreviewApi()}>
        <App />
      </PreviewApiProvider>,
    );

    expect(await screen.findAllByRole("button", { name: "Add files…" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Preview focused" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove selected" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Choose folder…" })).toHaveLength(1);
  });

  it("states the whole empty-state sentence rather than a shortened one", async () => {
    // #24 reported this text clipped. Nothing may fix that by saying less.
    render(
      <PreviewApiProvider value={createFakePreviewApi()}>
        <App />
      </PreviewApiProvider>,
    );

    expect(
      await screen.findByText(
        "MSCanvas reads local .mzML files from this computer and never writes to them. Nothing is uploaded and nothing leaves this machine.",
      ),
    ).toBeVisible();
  });

  it("leaves the workspace roster scrolling inside its own panel", async () => {
    // A roster is an unbounded list, so it owns its overflow exactly as the
    // spectrum table does. The document does not: containment here is what
    // stops a thousand rows becoming a taller document than the window.
    const app = mountStyles(appStyles);

    expect(requireStyleRule(app, ".dataset-roster-list").style.getPropertyValue("overflow")).toBe(
      "auto",
    );
    expect(requireStyleRule(app, ".dataset-roster-list").style.getPropertyValue("min-height")).toBe(
      "0px",
    );
    // And a file name too long for its column is truncated rather than pushing
    // the row -- and the panel, and the document -- wider.
    const name = requireStyleRule(app, ".dataset-row-name").style;
    expect(name.getPropertyValue("white-space")).toBe("nowrap");
    expect(name.getPropertyValue("overflow")).toBe("hidden");
    expect(name.getPropertyValue("text-overflow")).toBe("ellipsis");
    expect(requireStyleRule(app, ".workspace-sidebar").style.getPropertyValue("min-height")).toBe(
      "0px",
    );
  });
});
