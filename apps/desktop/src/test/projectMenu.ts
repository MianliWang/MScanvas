import { act, fireEvent, screen } from "@testing-library/react";

import { UI_RESOURCES } from "../features/preferences/i18n";

/**
 * Shows the Project surface the way a reader does: Project is the header's
 * third tab (direction A), pressed like the other two. Its New, Open, Save,
 * Save As and Close are on the surface itself.
 */
export async function openProjectSurface(words: (typeof UI_RESOURCES)["en"] | (typeof UI_RESOURCES)["zh-CN"] = UI_RESOURCES.en): Promise<void> {
  const tab = await screen.findByRole("button", { name: words.projectSurface });
  await act(async () => {
    fireEvent.click(tab);
  });
}
