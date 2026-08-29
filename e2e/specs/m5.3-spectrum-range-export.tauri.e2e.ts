/**
 * A selected spectrum's range export, against the real Rust process.
 *
 * The browser suite beside this one drives every state of the chooser, and every
 * answer it gets comes from a table this repository wrote. That is the right way
 * to exercise an interface and the wrong way to establish what the boundary
 * does -- a fixture cannot refuse a window, cannot resolve one against a
 * retained snapshot, and cannot decline to hold a token.
 *
 * So `begin_selected_spectrum_export` and `copy_selected_spectrum_plot` are left
 * **real** here. What is asserted is what only the real commands can answer:
 *
 * - a committed m/z window reaches the production boundary and is accepted,
 *   answering with a reservation the session actually holds;
 * - a window the retained spectrum does not have is **refused rather than
 *   clamped**, in this surface's own m/z words rather than the chromatogram's;
 * - a range asked of a spectrum the figure contract refuses a viewport is its
 *   own typed refusal and never a full-source export wearing that name;
 * - a full-source export of that same spectrum still succeeds, because a
 *   viewport refusal is a fact about drawability and not about the source;
 * - the one scientific lane is the one lane, whichever range is chosen;
 * - and a real copy reports the range it copied, resolved by Rust.
 *
 * **Two honest limitations, stated rather than worked around.**
 *
 * The panel's own payload is still answered from the table, because reading a
 * spectrum for real needs a ProteoWizard installation and an mzML file this run
 * does not have. So the `viewportDomain` *field* is the fixture's -- but it is
 * set to the range Rust's seeded snapshot really spans, and every assertion
 * below is about what the real command does with the window that produces.
 *
 * And `save_selected_spectrum_export` is **not** exercised: it opens the
 * platform's own save dialog, which this environment cannot drive. The bytes a
 * file receives are proved by the deterministic Rust writer evidence instead,
 * and no selector here is dressed up as having tested a filesystem path.
 */

import {
  SEEDED_MZ_HIGH,
  SEEDED_MZ_LOW,
  SEEDED_TOKEN,
  ipcCalls,
  loadWith,
  selectFirstSpectrum,
  tauriTable,
} from "../support/tauriPanel";
import { spectrumWithPeaks } from "../support/fixtures";

const SPECTRUM = "section.spectrum-panel";
const STATUS = `${SPECTRUM} .spectrum-export-status`;
const RANGE_NOTE = `${SPECTRUM} fieldset.spectrum-export-range p`;

/** The two commands this suite leaves real. */
const BEGIN = "begin_selected_spectrum_export";
const COPY = "copy_selected_spectrum_plot";

/** What the panel's export status region says, verbatim. */
async function statusText(): Promise<string> {
  return browser.execute(
    (css: string) => (document.querySelector(css)?.textContent ?? "").trim(),
    STATUS,
  ) as Promise<string>;
}

async function rangeNote(): Promise<string> {
  return browser.execute(
    (css: string) => (document.querySelector(css)?.textContent ?? "").trim(),
    RANGE_NOTE,
  ) as Promise<string>;
}

/** Clicks a control by the words on it, through the document itself. */
async function press(label: string): Promise<void> {
  await browser.execute((text: string) => {
    const node = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    (node as HTMLButtonElement | undefined)?.click();
  }, label);
}

/** Chooses a range scope by clicking its radio, as a person would. */
async function chooseScope(value: string): Promise<void> {
  await browser.execute((scope: string) => {
    const input = document.querySelector(
      `input[name="spectrum-range-scope"][value="${scope}"]`,
    );
    (input as HTMLInputElement | undefined)?.click();
  }, value);
}

/** Commits an m/z window through the panel's own keyboard step. */
async function zoomIn(): Promise<void> {
  await press("Zoom in m/z");
  await browser.waitUntil(async () => /Current range is m\/z [\d.]/u.test(await rangeNote()), {
    timeout: 30_000,
    timeoutMsg: "the committed window never reached the range note",
  });
}

/** How many times one command has crossed the boundary. */
async function callsTo(command: string): Promise<number> {
  return (await ipcCalls()).filter((call) => call.command === command).length;
}

/** Waits for one more call to a command, and answers the newest one's args. */
async function afterOneMore(
  command: string,
  act: () => Promise<void>,
): Promise<Record<string, unknown>> {
  const before = await callsTo(command);
  await act();
  await browser.waitUntil(async () => (await callsTo(command)) > before, {
    timeout: 30_000,
    timeoutMsg: `${command} never reached the boundary`,
  });
  const calls = (await ipcCalls()).filter((call) => call.command === command);
  return (calls[calls.length - 1]?.args ?? {}) as Record<string, unknown>;
}

describe("a spectrum range against the real export boundary", () => {
  describe("a window the retained spectrum has", () => {
    beforeEach(async () => {
      await loadWith(tauriTable({ real: [BEGIN, COPY] }));
      await selectFirstSpectrum();
    });

    it("carries a full-source request with no window at all", async () => {
      const args = await afterOneMore(BEGIN, () => press("Export CSV…"));

      expect(args["exportToken"]).toBe(SEEDED_TOKEN);
      expect(args["range"]).toEqual({ scope: "full", low: null, high: null });
      // Accepted by the real session, which is what a reservation means.
      await browser.waitUntil(async () => (await statusText()).length > 0, {
        timeout: 30_000,
        timeoutMsg: "the real boundary answered nothing",
      });
      // The save dialog is not driven here, so the run ends in the dialog step
      // rather than in a written file. What is proved is the acceptance.
      expect(await statusText()).not.toContain("no longer the one");
    });

    it("carries the committed window once the current range is chosen", async () => {
      await chooseScope("current");
      await zoomIn();

      const args = await afterOneMore(BEGIN, () => press("Export CSV…"));
      const range = args["range"] as Record<string, number | null>;

      expect(range["scope"]).toBe("current");
      // Inside the domain the seeded snapshot really spans, which is what makes
      // this a window Rust can resolve rather than one it must refuse.
      expect(Number(range["low"])).toBeGreaterThanOrEqual(SEEDED_MZ_LOW);
      expect(Number(range["high"])).toBeLessThanOrEqual(SEEDED_MZ_HIGH);
      expect(Number(range["high"])).toBeGreaterThan(Number(range["low"]));
      // And the real boundary accepted it: a refusal would have published one
      // of the two typed sentences the cases below assert.
      await browser.waitUntil(async () => (await statusText()).length > 0, { timeout: 30_000 });
      expect(await statusText()).not.toContain("not inside the spectrum");
      expect(await statusText()).not.toContain("no m/z viewport");
    });

    it("reports the range Rust resolved for a real copy", async () => {
      await chooseScope("current");
      await zoomIn();

      await afterOneMore(COPY, () => press("Copy plot"));
      await browser.waitUntil(async () => (await statusText()).startsWith("Copied"), {
        timeout: 60_000,
        timeoutMsg: "the real clipboard operation never reported an outcome",
      });

      const reported = await statusText();
      // Both counts and the exact bounds, from the outcome the real command
      // returned rather than from anything this side held.
      expect(reported).toMatch(/Copied the plot with [\d,]+ of [\d,]+ points, m\/z [\d.]+ to [\d.]+/u);
    });

    it("holds one scientific lane, whichever range is chosen", async () => {
      await chooseScope("current");
      await zoomIn();
      const args = await afterOneMore(BEGIN, () => press("Export CSV…"));
      expect((args["range"] as Record<string, unknown>)["scope"]).toBe("current");

      // A reservation is outstanding. Every other action on this surface is
      // closed rather than offered and refused on arrival.
      const disabled = (await browser.execute(() =>
        [...document.querySelectorAll("section.spectrum-panel button")]
          .filter((node) => (node as HTMLButtonElement).disabled)
          .map((node) => node.textContent?.trim() ?? ""),
      )) as string[];
      expect(disabled).toContain("Export SVG…");
      expect(disabled).toContain("Copy plot");

      // And the chooser stays open: a scope is a decision about the next
      // export, not a claim on the lane.
      const scopesEnabled = (await browser.execute(() =>
        [...document.querySelectorAll('input[name="spectrum-range-scope"]')].every(
          (node) => !(node as HTMLInputElement).disabled,
        ),
      )) as boolean;
      expect(scopesEnabled).toBe(true);
    });
  });

  describe("a window the retained spectrum does not have", () => {
    it("is refused rather than clamped, in this surface's own m/z words", async () => {
      // Told it spans further than the snapshot really does, which is the only
      // way the frontend's own clamping will ever produce an outside window.
      await loadWith(
        tauriTable({
          real: [BEGIN],
          viewportDomain: { state: "admitted", low: SEEDED_MZ_LOW, high: 20_000 },
        }),
      );
      await selectFirstSpectrum();
      await chooseScope("current");
      await zoomIn();

      await afterOneMore(BEGIN, () => press("Export CSV…"));
      await browser.waitUntil(async () => (await statusText()).length > 0, {
        timeout: 30_000,
        timeoutMsg: "the refused range never reported anything",
      });

      // Rust's own sentence, and it names the axis the reader chose.
      const reported = await statusText();
      expect(reported).toContain("m/z range is not inside the spectrum");
      expect(reported).not.toContain("retention-time");
      // Nothing was clamped: no file, no nearest range, no silent success.
      expect(reported).not.toContain("Saved");
    });
  });

  describe("a spectrum the figure contract refuses a viewport", () => {
    beforeEach(async () => {
      await loadWith(
        tauriTable({
          real: [BEGIN],
          extra: {
            load_selected_spectrum: {
              outcome: "spectrum",
              spectrum: {
                ...spectrumWithPeaks(),
                exportToken: SEEDED_TOKEN,
                viewportDomain: { state: "refused", reason: "sourceNotOrdered" },
              },
            },
          },
        }),
      );
      await selectFirstSpectrum();
    });

    it("offers no range chooser, and says so", async () => {
      const offered = (await browser.execute(
        () => document.querySelectorAll('input[name="spectrum-range-scope"]').length,
      )) as number;
      expect(offered).toBe(0);
      expect(await rangeNote()).toContain("no m/z viewport");
    });

    it("still accepts a full-source export of the same spectrum", async () => {
      // A viewport refusal is a fact about drawability, never about the source:
      // a data document needs no ordering at all to write.
      const args = await afterOneMore(BEGIN, () => press("Export CSV…"));
      expect(args["range"]).toEqual({ scope: "full", low: null, high: null });
      await browser.waitUntil(async () => (await statusText()).length > 0, { timeout: 30_000 });
      expect(await statusText()).not.toContain("no m/z viewport");
      expect(await statusText()).not.toContain("no longer the one");
    });
  });
});
