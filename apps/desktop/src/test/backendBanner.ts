import { fireEvent, waitFor } from "@testing-library/react";

/**
 * Opens the ProteoWizard details from the status bar's item.
 *
 * ProteoWizard is an icon and a short label at the window's foot (direction
 * A); its reading, build, every recovery action and the setup help open over
 * the bar from there, in every state. Waits for the item, and leaves details
 * already open as they are.
 */
export async function showBackendBanner(): Promise<void> {
  const item = await waitFor(() => {
    const found = document.querySelector<HTMLButtonElement>("[data-backend-item]");
    if (found === null) {
      throw new Error("The status bar has no ProteoWizard item.");
    }
    return found;
  });
  if (item.getAttribute("aria-expanded") === "false") {
    fireEvent.click(item);
  }
}
