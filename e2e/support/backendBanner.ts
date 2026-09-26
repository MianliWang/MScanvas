/**
 * Opens the backend banner where a usable installation folded it.
 *
 * With nothing to act on, the banner folds to a phrase in the header (PM9.2
 * L10), and its actions and help are reached through that phrase. A banner
 * that is already showing -- every state with something to act on -- has no
 * such phrase and is left as it is.
 */
export async function showBackendBanner(): Promise<void> {
  const toggle = browser.$("[data-backend-toggle]");
  if ((await toggle.isExisting()) && (await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}
