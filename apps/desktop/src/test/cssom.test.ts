import { afterEach, describe, expect, it } from "vitest";

import appStyles from "../app/app.css?raw";
import tokenStyles from "../design-system/tokens.css?raw";

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

afterEach(() => {
  document.body.replaceChildren();
  for (const style of mountedStyles.splice(0)) {
    style.remove();
  }
});

describe("jsdom CSSOM compatibility", () => {
  it("observes the class-driven spectrum-table-row style used by MSCanvas", () => {
    mountStyles(appStyles);
    const row = document.createElement("div");
    row.className = "spectrum-table-row";
    row.textContent = "controllerType=0 controllerNumber=1 scan=1";
    document.body.append(row);

    expect(getComputedStyle(row).display).toBe("grid");
    expect(row).toHaveStyle({ display: "grid" });
    expect(row).toBeVisible();
  });

  it("recomputes class-driven style after a DOM mutation", () => {
    mountStyles(`
      .cssom-probe {
        display: grid;
        color: rgb(23, 32, 51);
      }

      .cssom-probe.is-muted {
        display: none;
        color: rgb(91, 103, 122);
      }
    `);
    const probe = document.createElement("div");
    probe.className = "cssom-probe";
    document.body.append(probe);

    expect(getComputedStyle(probe).display).toBe("grid");
    expect(getComputedStyle(probe).color).toBe("rgb(23, 32, 51)");

    probe.classList.add("is-muted");

    expect(getComputedStyle(probe).display).toBe("none");
    expect(getComputedStyle(probe).color).toBe("rgb(91, 103, 122)");
  });

  it("preserves the design-token declaration and its CSS variable reference", () => {
    const tokens = mountStyles(tokenStyles);
    const app = mountStyles(appStyles);

    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-surface")
        .trim(),
    ).toBe("#ffffff");
    expect(
      requireStyleRule(tokens, ":root").style.getPropertyValue("--color-surface").trim(),
    ).toBe("#ffffff");
    expect(requireStyleRule(app, ".panel").style.getPropertyValue("background")).toBe(
      "var(--color-surface)",
    );
  });
});
