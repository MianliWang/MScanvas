/**
 * Opens the ProteoWizard details from the status bar's item.
 *
 * ProteoWizard is an icon and a short label at the window's foot (direction
 * A); its reading, build, every recovery action and the setup help open over
 * the bar from there, in every state. Details already open are left as they
 * are.
 */
export async function showBackendBanner(): Promise<void> {
  const item = browser.$("[data-backend-item]");
  await item.waitForExist();
  if ((await item.getAttribute("aria-expanded")) === "false") {
    await item.click();
    await browser.$('#backend-status[data-backend-mode="popover"]').waitForDisplayed();
  }
}
