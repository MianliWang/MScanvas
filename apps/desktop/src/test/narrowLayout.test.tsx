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
  });
});

describe("narrow desktop layout markup", () => {
  it("keeps one set of actions, whatever the width", async () => {
    // A narrow layout that duplicates the actions would pass a screenshot and
    // give a keyboard user two of everything, or a hidden one that still takes
    // a tab stop. There is one Open action and one of each banner action.
    render(
      <PreviewApiProvider value={createFakePreviewApi()}>
        <App />
      </PreviewApiProvider>,
    );

    expect(await screen.findAllByRole("button", { name: "Open mzML…" })).toHaveLength(1);
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
        "MSCanvas reads one local .mzML file at a time and never writes to it. Nothing is uploaded and nothing leaves this machine.",
      ),
    ).toBeVisible();
  });
});
