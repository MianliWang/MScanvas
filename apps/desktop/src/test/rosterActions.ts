import { act, fireEvent, screen } from "@testing-library/react";

import { UI_RESOURCES } from "../features/preferences/i18n";

type Words = (typeof UI_RESOURCES)["en"] | (typeof UI_RESOURCES)["zh-CN"];
type Action = "removeHighlighted" | "moveToGroupMenu" | "clearList" | "newGroup";

/** The roster footer's list menu trigger, where its items give the keyboard back. */
export function rosterListMenu(words: Words = UI_RESOURCES.en): HTMLElement {
  return screen.getByRole("button", { name: words.rosterListActions });
}

/**
 * One of the roster footer's list actions, opening the menu as a keyboard user
 * does (a Radix trigger opens on pointerdown or a key, never on a bare click).
 * While the menu is open the rest of the page is hidden from the
 * accessibility tree, so close it with `closeRosterListMenu` before querying it.
 */
export async function rosterAction(action: Action, words: Words = UI_RESOURCES.en): Promise<HTMLElement> {
  if (screen.queryByRole("menu") === null) {
    await act(async () => {
      fireEvent.keyDown(rosterListMenu(words), { key: "Enter" });
    });
  }
  return screen.findByRole("menuitem", { name: words[action] });
}

/** Chooses one of the roster footer's list actions. */
export async function chooseRosterAction(action: Action, words: Words = UI_RESOURCES.en): Promise<void> {
  const item = await rosterAction(action, words);
  await act(async () => {
    fireEvent.click(item);
  });
}

/** Whether a list action is refused, read from its menu item, with the menu closed again. */
export async function rosterActionRefused(action: Action, words: Words = UI_RESOURCES.en): Promise<boolean> {
  const item = await rosterAction(action, words);
  const refused = item.getAttribute("aria-disabled") === "true";
  await closeRosterListMenu();
  return refused;
}

/** Closes the list menu, if it is open, and lets it give the keyboard back. */
export async function closeRosterListMenu(): Promise<void> {
  const menu = screen.queryByRole("menu");
  if (menu === null) return;
  await act(async () => {
    fireEvent.keyDown(menu, { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
