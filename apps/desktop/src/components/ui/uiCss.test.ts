import { describe, expect, it } from "vitest";

import tokenStyles from "../../design-system/tokens.css?raw";
import indexStyles from "../../index.css?raw";
import uiStyles from "./ui.css?raw";

const declared = (css: string) => new Set(Array.from(css.matchAll(/(--[\w-]+)\s*:/g), match => match[1]));

describe("ui.css", () => {
  it("names only custom properties that it or tokens.css declares (DESIGN_SYSTEM UI-45)", () => {
    const known = new Set([...declared(tokenStyles), ...declared(uiStyles)]);
    const used = Array.from(uiStyles.matchAll(/var\((--[\w-]+)/g), match => match[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter(name => !known.has(name))).toEqual([]);
  });

  it("redeclares no token tokens.css already owns", () => {
    const owned = declared(tokenStyles);
    expect([...declared(uiStyles)].filter(name => owned.has(name))).toEqual([]);
  });

  it("is imported once by the global stylesheet, after the tokens", () => {
    const imports = Array.from(indexStyles.matchAll(/@import "([^"]+)"/g), match => match[1]);
    expect(imports.filter(path => path === "./components/ui/ui.css")).toHaveLength(1);
    expect(imports.indexOf("./components/ui/ui.css")).toBeGreaterThan(imports.indexOf("./design-system/tokens.css"));
  });
});
