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

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import appStyles from "../app/app.css?raw";
import { App } from "../app/App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import {
  availableBackend,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  queueItem,
  queueOf,
  secondFile,
  selectedFile,
  thirdFile,
  unavailableBackend,
} from "./previewFixtures";

const mountedStyles: HTMLStyleElement[] = [];

function mountStyles(css: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  mountedStyles.push(style);
  return style;
}

/**
 * One selector written the same way however the stylesheet lays it out.
 *
 * The CSSOM hands back a grouped selector with the author's own line breaks
 * still in it, so `a, b` and `a,\nb` are different strings for the same rule.
 * Comparing on the normalized form keeps these assertions about which rule
 * exists rather than about where the formatter put a newline.
 */
function normalizeSelector(selector: string): string {
  return selector.replaceAll(/\s*,\s*/g, ", ").trim();
}

function requireStyleRule(style: HTMLStyleElement, selector: string): CSSStyleRule {
  const wanted = normalizeSelector(selector);
  const rule = Array.from(style.sheet?.cssRules ?? []).find(
    (candidate): candidate is CSSStyleRule =>
      "selectorText" in candidate &&
      normalizeSelector((candidate as CSSStyleRule).selectorText) === wanted,
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

  it("gives the Run file identity a readable colour without changing every header note", () => {
    // Same 11px contrast boundary as collision context in the roster: this can
    // be the only text that distinguishes two same-named acquisitions, while
    // other panel notes retain their quieter established hierarchy.
    const app = mountStyles(appStyles);

    expect(
      requireStyleRule(app, ".panel-header p.preview-file-identity").style.getPropertyValue(
        "color",
      ),
    ).toBe("var(--color-text-secondary)");
    expect(requireStyleRule(app, ".panel-header p").style.getPropertyValue("color")).toBe(
      "var(--color-text-tertiary)",
    );
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

  it("keeps the drop overlay out of layout and unable to intercept the pointer", () => {
    const app = mountStyles(appStyles);
    const shell = requireStyleRule(app, ".app-shell").style;
    const overlay = requireStyleRule(app, ".workspace-drop-overlay").style;

    expect(shell.getPropertyValue("position")).toBe("relative");
    expect(shell.getPropertyValue("isolation")).toBe("isolate");
    expect(overlay.getPropertyValue("position")).toBe("absolute");
    expect(overlay.getPropertyValue("inset")).toBe("0px");
    expect(overlay.getPropertyValue("pointer-events")).toBe("none");
    expect(shell.getPropertyValue("grid-template-rows")).toBe(
      "auto auto minmax(0, 1fr)",
    );
  });
});

describe("narrow desktop layout markup", () => {
  it("keeps the conversion panel inside the column rather than beside it", () => {
    const app = mountStyles(appStyles);
    const panel = requireStyleRule(app, ".conversion-panel").style;

    // As tall as its own content and no taller. A share of the column would
    // take height from the list on every window that has the panel and leave an
    // empty box on every window that does not.
    expect(panel.getPropertyValue("flex")).toBe("0 1 auto");
    // Its own overflow, inside `.panel`'s hidden. A long failure sentence or a
    // long output name scrolls here rather than pushing the roster out.
    expect(panel.getPropertyValue("overflow")).toBe("auto");
    expect(panel.getPropertyValue("min-width")).toBe("0px");
    // The header alone, so a squeezed panel still says which panel it is.
    expect(panel.getPropertyValue("min-height")).toBe("54px");

    // The one primary action wraps rather than being clipped at any width.
    expect(requireStyleRule(app, ".conversion-actions").style.getPropertyValue("flex-wrap")).toBe(
      "wrap",
    );
  });

  it("lets a queue of sixteen sit in the column without widening it", () => {
    // The panel is in the narrow column with the roster, and a queue puts two
    // file names on every line of it. Neither name may be what pushes the
    // sidebar -- and the document -- past the window.
    const app = mountStyles(appStyles);

    const list = requireStyleRule(app, ".conversion-queue-list").style;
    expect(list.getPropertyValue("min-width")).toBe("0px");
    // The position is rendered as text, so the list marker would say it twice.
    expect(list.getPropertyValue("list-style")).toBe("none");

    const item = requireStyleRule(app, ".conversion-queue-list > li").style;
    expect(item.getPropertyValue("min-width")).toBe("0px");
    expect(item.getPropertyValue("flex-wrap")).toBe("wrap");

    // Both names shrink on the same terms, so a long acquisition name cannot
    // take the whole line from the name it converts to.
    const names = requireStyleRule(
      app,
      ".conversion-queue-name, .conversion-queue-output",
    ).style;
    expect(names.getPropertyValue("min-width")).toBe("0px");
    expect(names.getPropertyValue("flex")).toBe("1 1 6em");
    expect(names.getPropertyValue("overflow")).toBe("hidden");
    expect(names.getPropertyValue("text-overflow")).toBe("ellipsis");
    expect(names.getPropertyValue("white-space")).toBe("nowrap");

    // The state and a failure sentence take the next line whole and wrap
    // there, rather than being clipped alongside the names. So does everything
    // a backend-named set says about its result, for the same reason: a
    // sentence clipped to a column width is a sentence the user cannot read.
    const status = requireStyleRule(
      app,
      ".conversion-queue-status, .conversion-queue-attempts, .conversion-queue-facts, " +
        ".conversion-queue-reason, .conversion-queue-residue, .conversion-queue-set-result, " +
        ".conversion-queue-set-completeness, .conversion-queue-set-partial",
    ).style;
    expect(status.getPropertyValue("flex")).toBe("1 0 100%");
    expect(status.getPropertyValue("overflow-wrap")).toBe("anywhere");
    // Two digits' worth, so item 10 does not shift the column item 9 set.
    expect(requireStyleRule(app, ".conversion-queue-order").style.getPropertyValue("min-width")).toBe(
      "1.6em",
    );
  });

  it("says an item's state in a colour that can be read, having already said it in words", () => {
    // Colour reinforces `ITEM_STATE_LABEL` and never carries the state alone.
    // Both hues are the tokens the rest of the workspace uses for the same two
    // meanings, so neither introduces a contrast this app has not already
    // accepted.
    const app = mountStyles(appStyles);

    expect(
      requireStyleRule(
        app,
        '.conversion-queue-list > li[data-item-state="failed"] > .conversion-queue-status, .conversion-queue-reason',
      ).style.getPropertyValue("color"),
    ).toBe("var(--color-danger)");
    expect(
      requireStyleRule(
        app,
        '.conversion-queue-list > li[data-item-state="finalized"] > .conversion-queue-status',
      ).style.getPropertyValue("color"),
    ).toBe("var(--color-success)");
    // The running item is the one the user is watching, so it is the one that
    // takes the primary colour and the weight.
    const running = requireStyleRule(
      app,
      '.conversion-queue-list > li[data-item-state="running"] > .conversion-queue-status',
    ).style;
    expect(running.getPropertyValue("color")).toBe("var(--color-text-primary)");
    expect(running.getPropertyValue("font-weight")).toBe("600");
  });

  it("gives the source family a track of its own without taking the name's", () => {
    const app = mountStyles(appStyles);

    // Six tracks: two markers, the name's flexible column, the family, the
    // size, and the notes. The name is the only one that may grow.
    expect(
      requireStyleRule(app, ".dataset-row").style.getPropertyValue("grid-template-columns"),
    ).toBe("12px 12px minmax(72px, 1fr) auto auto minmax(0, auto)");
    const kind = requireStyleRule(app, ".dataset-row-kind").style;
    expect(kind.getPropertyValue("white-space")).toBe("nowrap");
    expect(kind.getPropertyValue("min-width")).toBe("0px");
  });


  it("keeps one set of actions, whatever the width", async () => {
    // A narrow layout that duplicates the actions would pass a screenshot and
    // give a keyboard user two of everything, or a hidden one that still takes
    // a tab stop. There is one of each workspace action and one of each banner
    // action, and the workspace actions live in one place rather than being
    // repeated in a toolbar.
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={createFakePreviewApi()}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );

    expect(await screen.findAllByRole("button", { name: "Add files…" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add mzML folder…" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Preview focused" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove selected" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Choose folder…" })).toHaveLength(1);
  });

  it("states the whole empty-state sentence rather than a shortened one", async () => {
    // #24 reported this text clipped. Nothing may fix that by saying less.
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={createFakePreviewApi()}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );

    expect(
      await screen.findByText(
        "MSCanvas reads local .mzML files from this computer and never writes to them. Nothing is uploaded and nothing leaves this machine.",
      ),
    ).toBeVisible();
  });

  it("keeps the roster tall enough to be a list when the column is stacked", () => {
    // The defect a rendered check found. Stacked at 896x475 CSS pixels the
    // workspace column got a fraction of an already short window, the roster's
    // header and actions used all of it, and the list came out at zero height
    // with four rows in it: rows that exist, are announced, and cannot be
    // reached. The track has a floor and the panel has a minimum.
    //
    // M1.3 raised both by what the search and sort controls cost, and M1.4.1
    // by the third line five actions wrap to at this column's minimum width.
    // The two are pinned together because they are one decision: a track
    // shorter than the panel's own minimum clamps the panel back to a height
    // its chrome does not fit in, which is the original defect by another
    // route. Viewer Closure raised the viewer track from 178px to 354px for
    // the chromatogram the stack now begins with.
    const app = mountStyles(appStyles);

    expect(requireStyleRule(app, ".dataset-roster-panel").style.getPropertyValue("min-height")).toBe(
      "280px",
    );
    expect(
      requireMediaRule(app, "(max-width: 1120px)", ".workspace-layout").style.getPropertyValue(
        "grid-template-rows",
      ),
    ).toBe("minmax(342px, 0.9fr) minmax(354px, 1.6fr)");
    // And what the column cannot fit is clipped here rather than pushing the
    // shell past the viewport.
    expect(requireStyleRule(app, ".workspace-sidebar").style.getPropertyValue("overflow")).toBe(
      "hidden",
    );
  });

  it("keeps the loaded Run identity visible below the roster at the app minimum", () => {
    // The roster's two-row floor consumes the old 280px narrow track by
    // itself. Without a separate Run floor and the matching 8px-gap-plus-52px
    // track budget, the inspector collapses to about one CSS pixel and clips
    // the acquisition identity even though its header still has a layout rect.
    const app = mountStyles(appStyles);

    expect(requireStyleRule(app, ".workspace-sidebar").style.getPropertyValue("gap")).toBe(
      "8px",
    );
    expect(requireStyleRule(app, ".panel-header").style.getPropertyValue("min-height")).toBe(
      "52px",
    );
    expect(
      requireMediaRule(
        app,
        "(max-width: 1120px)",
        ".workspace-sidebar > .inspector-panel",
      ).style.getPropertyValue("min-height"),
    ).toBe("54px");
    expect(
      requireMediaRule(app, "(max-width: 1120px)", ".workspace-layout").style.getPropertyValue(
        "grid-template-rows",
      ),
    ).toBe("minmax(342px, 0.9fr) minmax(354px, 1.6fr)");
    expect(
      requireMediaRule(app, "(max-width: 1120px)", ".viewer-stack").style.getPropertyValue(
        "grid-template-rows",
      ),
    ).toBe("minmax(168px, 0.9fr) minmax(116px, 1.15fr) minmax(54px, 1fr)");
  });

  it("keeps the complete loaded viewer reachable when shell notices shorten the workspace", () => {
    // At 960x640 the persistent backend notice and a folder-import notice take
    // two approximately 31px lines. After the 58px toolbar, only about 520px
    // remains for a workspace whose complete narrow evidence is now 720px
    // tall: 16px padding + 342px sidebar + 8px gap + (168px chromatogram +
    // 8px gap + 116px table + 8px gap + 54px selected-spectrum header). The
    // document intentionally cannot scroll, so the narrow workspace must both
    // reserve the complete viewer stack and own the resulting vertical
    // overflow.
    //
    // The chromatogram's 168px is its 52px header and borders, the 60px its
    // plot floors at, and the caption and viewport actions below it. Squeezing
    // it under that gives an axis whose labels overlap and controls that wrap
    // out of reach -- not a smaller version of the view but a different one --
    // so the overflow is the honest trade at the minimum window.
    const app = mountStyles(appStyles);
    const workspace = requireMediaRule(
      app,
      "(max-width: 1120px)",
      ".workspace-layout",
    ).style;

    expect(workspace.getPropertyValue("grid-template-rows")).toBe(
      "minmax(342px, 0.9fr) minmax(354px, 1.6fr)",
    );
    expect(workspace.getPropertyValue("overflow-y")).toBe("auto");
    expect(
      requireMediaRule(app, "(max-width: 1120px)", ".viewer-stack").style.getPropertyValue(
        "grid-template-rows",
      ),
    ).toBe("minmax(168px, 0.9fr) minmax(116px, 1.15fr) minmax(54px, 1fr)");
    expect(requireStyleRule(app, ".viewer-stack").style.getPropertyValue("gap")).toBe("8px");
  });

  it("lets a row's notes give ground so the file name keeps a column", () => {
    // A grid `auto` track takes its max-content width before a flexible track
    // gets any. With `Replaced` and `Selected — outside search` side by side in
    // an `auto` track, a narrow panel had nothing left for the name and the row
    // showed a size and two labels for a file it would not name.
    const app = mountStyles(appStyles);

    // The name keeps a floor of its own. Lowering the notes track's minimum is
    // not enough: an `auto` track still takes its max-content width before a
    // flexible one gets any, and measured in a rendered window a row carrying
    // both `Could not be read` and `Selected — outside search` left the name
    // exactly 0px wide.
    expect(requireStyleRule(app, ".dataset-row").style.getPropertyValue("grid-template-columns")).toBe(
      "12px 12px minmax(72px, 1fr) auto auto minmax(0, auto)",
    );
    const notes = requireStyleRule(app, ".dataset-row-notes").style;
    expect(notes.getPropertyValue("min-width")).toBe("0px");
    expect(notes.getPropertyValue("overflow")).toBe("hidden");
  });

  it("lets five actions wrap rather than widening the column they sit in", () => {
    // The fifth action is what raised the panel's floor by one wrapped line.
    // What must not happen instead is the row refusing to wrap and pushing the
    // sidebar -- and the document -- wider than the window.
    const app = mountStyles(appStyles);
    const actions = requireStyleRule(app, ".dataset-roster-actions").style;

    expect(actions.getPropertyValue("display")).toBe("flex");
    expect(actions.getPropertyValue("flex-wrap")).toBe("wrap");
  });

  it("lets a row's collision context give ground before the file name does", () => {
    // The name and its context share one grid cell, so the cell needs the same
    // treatment the notes track got: a minimum of zero for the part that may
    // disappear, and a floor for the part that may not. A context long enough
    // to fill the cell would otherwise leave the name at zero, which is issue
    // #24's defect one column over.
    const app = mountStyles(appStyles);
    const label = requireStyleRule(app, ".dataset-row-label").style;
    const name = requireStyleRule(app, ".dataset-row-name").style;
    const context = requireStyleRule(app, ".dataset-row-context").style;

    expect(label.getPropertyValue("display")).toBe("flex");
    expect(label.getPropertyValue("min-width")).toBe("0px");
    // The file a row is about is the last thing on it that may disappear.
    expect(name.getPropertyValue("min-width")).toBe("48px");
    expect(name.getPropertyValue("flex")).toBe("1 1 auto");
    // The context gives ground first, and ellipsizes rather than wrapping: a
    // row is one line tall and Rust already bounds the string.
    expect(context.getPropertyValue("min-width")).toBe("0px");
    expect(context.getPropertyValue("flex")).toBe("0 1 auto");
    expect(context.getPropertyValue("overflow")).toBe("hidden");
    expect(context.getPropertyValue("text-overflow")).toBe("ellipsis");
    expect(context.getPropertyValue("white-space")).toBe("nowrap");
    // And it keeps the row's tracks exactly as they were: the context lives
    // inside the name's cell rather than taking one of its own. The sixth track
    // is the source family, which is a fixed short word beside the size and not
    // something the context may be folded into.
    expect(
      requireStyleRule(app, ".dataset-row").style.getPropertyValue("grid-template-columns"),
    ).toBe("12px 12px minmax(72px, 1fr) auto auto minmax(0, auto)");
  });

  it("gives a row's collision context a colour that can be read", () => {
    // 11px secondary text, for the same reason the search's explanations take
    // it: the tertiary colour is about 3.5:1 on white, which is under AA at
    // this size.
    const app = mountStyles(appStyles);

    expect(requireStyleRule(app, ".dataset-row-context").style.getPropertyValue("color")).toBe(
      "var(--color-text-secondary)",
    );
  });

  it("gives the search's own explanations a colour that can be read", () => {
    // `Selected — outside search` is the only thing on screen that explains a
    // row the query excludes, and the match count is the only thing that says
    // how much of the session is hidden. The tertiary text colour is #7f8a9c on
    // white, about 3.5:1, which is under AA for text this size; the secondary
    // one is #5b677a, about 6.2:1. Quiet is a reason to use the quieter of two
    // readable colours, not a reason to use an unreadable one.
    const app = mountStyles(appStyles);

    expect(requireStyleRule(app, ".dataset-row-kept").style.getPropertyValue("color")).toBe(
      "var(--color-text-secondary)",
    );
    expect(requireStyleRule(app, ".roster-field > label").style.getPropertyValue("color")).toBe(
      "var(--color-text-secondary)",
    );
    // And the match count, which while a query hides rows is the only visible
    // account of how much of the session is out of sight. It owns a selector of
    // its own rather than inheriting the header note's tertiary colour, and
    // that selector has to out-specify `.panel-header p` to mean anything.
    const matches = requireStyleRule(app, ".panel-header p.dataset-roster-matches").style;
    expect(matches.getPropertyValue("color")).toBe("var(--color-text-secondary)");
    expect(requireStyleRule(app, ".panel-header p").style.getPropertyValue("color")).toBe(
      "var(--color-text-tertiary)",
    );
  });

  it("gives the match count its own class only while a query is hiding rows", async () => {
    // The line has two duties. As a header note about how many files a session
    // holds it is quiet chrome, and the roster shows the same count in full
    // underneath; as the account of a search it is the only thing that says so.
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider
          value={createFakePreviewApi({
            initialDatasets: [selectedFile, secondFile, thirdFile],
            availability: unavailableBackend,
          })}
        >
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    const line = () => document.querySelector("#dataset-roster-matches");
    await screen.findByRole("option", { name: /QC_pool_01\.mzML/ });

    expect(line()).not.toHaveClass("dataset-roster-matches");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "QC" },
    });

    expect(line()).toHaveClass("dataset-roster-matches");
    expect(line()).toHaveTextContent("2 matches of 3 files.");
  });

  it("leaves the workspace roster scrolling inside its own panel", async () => {
    // A roster is an unbounded list, so it owns its overflow exactly as the
    // spectrum table does. The document does not: containment here is what
    // stops a thousand rows becoming a taller document than the window.
    const app = mountStyles(appStyles);

    expect(requireStyleRule(app, ".dataset-roster-list").style.getPropertyValue("overflow")).toBe(
      "auto",
    );
    // Two whole rows, which is the promise the panel's floor is the arithmetic
    // for: a list with files in it always looks like a list. Stated on the box
    // that would otherwise be the one to give ground, because it is the only
    // flexible child of the panel and would give all of it.
    expect(requireStyleRule(app, ".dataset-roster-list").style.getPropertyValue("min-height")).toBe(
      "56px",
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

  it("gives the diagnostics offer the same shape the adoption offer has", () => {
    // Two offers about one terminal queue, sitting under one result. One shape
    // reads as a row of choices; two would read as two unrelated features that
    // happen to be adjacent, which at 586 CSS pixels is the difference between
    // a column and a pile.
    const app = mountStyles(appStyles);
    const adoption = requireStyleRule(app, ".conversion-adoption").style;
    const diagnostics = requireStyleRule(app, ".conversion-diagnostics").style;

    for (const property of ["display", "flex-direction", "gap", "padding-top", "border-top"]) {
      expect(diagnostics.getPropertyValue(property)).toBe(adoption.getPropertyValue(property));
    }
    expect(diagnostics.getPropertyValue("display")).toBe("flex");
    expect(diagnostics.getPropertyValue("flex-direction")).toBe("column");
  });

  it("lets a digest break rather than widen the column it sits in", () => {
    // Sixty-four characters with no space in them. Without a break rule this is
    // the widest unbreakable run in the panel, and it would push the sidebar --
    // and the document -- past the window at the narrowest checked size, which
    // is issue #24's defect arriving through a new string.
    const app = mountStyles(appStyles);
    const digest = requireStyleRule(app, ".conversion-diagnostics-digest").style;

    expect(digest.getPropertyValue("overflow-wrap")).toBe("anywhere");
    // Monospaced, so a reader can compare it a group at a time rather than
    // character by character against a proportional font.
    expect(digest.getPropertyValue("font-family")).toBe("var(--font-mono)");
  });
});

/**
 * The queue at the three window sizes this repository checks the workspace at.
 *
 * jsdom lays nothing out, so this is not a rendered check and does not replace
 * one. What the widths pin is that the queue is one piece of markup rather than
 * a wide copy and a narrow copy: at every size there is one list, one control
 * per action, no Cancel, and no percentage. The pixel questions are answered by
 * the CSSOM rules above, and by nothing here.
 */
describe("the conversion queue at each checked window size", () => {
  const VIEWPORTS = [
    { name: "900x700", width: 900, height: 700 },
    { name: "1366x768", width: 1366, height: 768 },
    { name: "1920x1080", width: 1920, height: 1080 },
  ] as const;

  for (const viewport of VIEWPORTS) {
    it(`shows one queue and one way to stop it at ${viewport.name}`, async () => {
      window.innerWidth = viewport.width;
      window.innerHeight = viewport.height;
      window.dispatchEvent(new Event("resize"));

      const items = [
        queueItem("file-1", "run-1.raw", { state: "finalized" }),
        queueItem("file-2", "run-2.raw", { state: "running" }),
        queueItem("file-3", "run-3.raw"),
      ];
      const api = createFakePreviewApi({
        initialDatasets: items.map((item) => ({
          handle: item.datasetHandle,
          fileName: item.fileName,
          byteLength: 78_309,
          sourceKind: "thermo_raw" as const,
          relativeContext: null,
        })),
        availability: availableBackend,
        initialConversion: { status: "running", operationId: "1", queue: queueOf(items) },
      });

      render(
        <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
          <PreviewApiProvider value={api}>
            <App />
          </PreviewApiProvider>
        </WorkspaceDropTransportProvider>,
      );

      await screen.findByText("Converting item 2 of 3…");
      // One list of items, not one per breakpoint.
      const lists = document.querySelectorAll(".conversion-queue-list");
      expect(lists).toHaveLength(1);
      expect(lists[0].querySelectorAll("li")).toHaveLength(3);
      expect(
        Array.from(lists[0].querySelectorAll("li")).map((row) =>
          row.getAttribute("data-item-state"),
        ),
      ).toEqual(["finalized", "running", "pending"]);

      // The action is one, is about the queue, and fits the column at every
      // checked width. Cancel is deliberately not its name: it ends the whole
      // queue and undoes nothing that finished.
      const stop = screen.getByRole("button", { name: "Stop queue" });
      expect(stop).toBeVisible();
      expect(stop).toBeEnabled();
      expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
      const panel = document.querySelector(".conversion-panel");
      expect(panel).not.toBeNull();
      expect(stop.getBoundingClientRect().width).toBeLessThanOrEqual(
        panel?.getBoundingClientRect().width ?? 0,
      );
      // The one thing this workflow must never grow without evidence.
      expect(document.body.textContent).not.toMatch(/\d+\s?%/);
      // And a running queue is not a terminal one, so the diagnostics offer is
      // absent at every width rather than merely disabled at some of them.
      expect(screen.queryByRole("button", { name: "Export failure diagnostics…" })).toBeNull();
      expect(
        screen.getByText(
          "Stops the current conversion and prevents remaining items from starting. Outputs already completed stay in place.",
        ),
      ).toBeVisible();
    });
  }
});
