/**
 * The header's Project menu (rebuild spec 1.1): Project is no longer a tab,
 * and its surface is the menu's first item.
 */
export async function showProjectSurface(): Promise<void> {
  await browser.$("[data-project-menu]").click();
  await browser.$('[data-project-menu-item="surface"]').waitForDisplayed();
  await browser.$('[data-project-menu-item="surface"]').click();
  await browser.$('[data-project-menu-item="surface"]').waitForExist({ reverse: true });
}
