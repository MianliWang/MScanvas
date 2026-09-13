/** Observe native label activation after a real click on a different field. */
export async function activateFigureFieldByLabel(panel: string, field: "widthPx" | "heightPx" | "pngDpi") {
  const selector = `${panel} input[id$="-${field}"]`;
  const otherSelector = `${panel} input[id$="-${field === "widthPx" ? "heightPx" : "widthPx"}"]`;
  const input = browser.$(selector);
  const inputId = await input.getAttribute("id");
  const valueBefore = await input.getValue();
  const other = browser.$(otherSelector);
  const otherId = await other.getAttribute("id");
  await browser.execute((target) => document.querySelector(target)!.scrollIntoView({ block: "center" }), otherSelector);
  await other.click();
  const activeBefore = await browser.execute(() => document.activeElement?.id);
  if (!inputId || !otherId || inputId === otherId || activeBefore !== otherId) {
    throw new Error("The label activation observation must start on a different input.");
  }
  const labelSelector = `${panel} [id$="-${field}-label"]`;
  await browser.execute((target) => document.querySelector(target)!.scrollIntoView({ block: "center" }), labelSelector);
  await browser.$(labelSelector).click();
  const after = await browser.execute((id) => {
    const input = document.getElementById(id) as HTMLInputElement;
    const label = document.getElementById(`${id}-label`);
    return { focused: document.activeElement === input, activeId: document.activeElement?.id,
      valueAfter: input.value, labelTag: label?.tagName, labelFor: label?.getAttribute("for"),
      locale: document.documentElement.lang, dpr: devicePixelRatio };
  }, inputId);
  return { kind: "figure label activation", panel, field, inputId, activeBefore, valueBefore, ...after };
}
