import { fireEvent, waitFor } from "@testing-library/react";

/**
 * Opens the backend banner where it is folded.
 *
 * With a usable installation and nothing to act on, the banner folds to a
 * phrase in the header (PM9 L10), and its actions and help are reached through
 * that phrase. Waits for the fold, so a check that has not answered yet cannot
 * be mistaken for a banner that needs no opening; a banner already open is left
 * as it is.
 */
export async function showBackendBanner(): Promise<void> {
  const toggle = await waitFor(() => {
    const found = document.querySelector<HTMLButtonElement>("[data-backend-toggle]");
    if (found === null) {
      throw new Error("The backend banner is not folded.");
    }
    return found;
  });
  if (toggle.getAttribute("aria-expanded") === "false") {
    fireEvent.click(toggle);
  }
}
