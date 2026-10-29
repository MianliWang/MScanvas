import { act, fireEvent, screen } from "@testing-library/react";

import { UI_RESOURCES } from "../features/preferences/i18n";

/**
 * Shows the Project surface through the header's Project menu, as a keyboard
 * user does: Enter on the trigger (a Radix trigger opens on pointerdown or a
 * key, never on a bare click), then the menu's first item.
 */
export async function openProjectSurface(words: (typeof UI_RESOURCES)["en"] | (typeof UI_RESOURCES)["zh-CN"] = UI_RESOURCES.en): Promise<void> {
  const trigger = await screen.findByRole("button", { name: words.projectSurface });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  const item = await screen.findByRole("menuitem", { name: words.projectMenuShow });
  await act(async () => {
    fireEvent.click(item);
  });
}
