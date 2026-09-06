/**
 * Pressing `Convert` the way a reader can press it.
 *
 * A start is offered only once MSCanvas has a plan for exactly the question on
 * screen — which means the conversion settings for the bound installation have
 * been read, the chosen row is one that installation runs, and Rust has
 * answered the plan for those rows under it. That is three answers, and a test
 * that clicked the moment the panel appeared would be clicking a control the
 * reader would find disabled.
 *
 * So the wait is not a workaround: it is the contract. Waiting for the control
 * to be *enabled* rather than for some intermediate sentence also keeps these
 * tests out of the business of knowing which answer arrives last.
 */

import { expect } from "vitest";

import { fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Waits for the panel to be describing a conversion.
 *
 * The same three answers `pressConvert` waits on, for the tests that read the
 * plan's own rendering rather than pressing anything. A test that reached for
 * the list the moment the panel appeared would be reading it before Rust had
 * said what the conversion would do.
 */
export async function awaitPlan(panel: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(panel.querySelector(".conversion-queue-list")).not.toBeNull();
  });
}

/** Presses one of the panel's start controls, once it may be pressed. */
export async function pressConvert(panel: HTMLElement, name: string): Promise<void> {
  const convert = within(panel).getByRole("button", { name });
  await waitFor(() => {
    expect(convert).toBeEnabled();
  });
  fireEvent.click(convert);
}
