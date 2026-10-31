/**
 * The header's Project tab (direction A): the third destination, pressed like
 * Workbench and Conversion.
 */
export async function showProjectSurface(): Promise<void> {
  await browser.$('.workbench-navigation [data-surface-tab="project"]').click();
  await browser.$("#workbench-project").waitForDisplayed();
}
