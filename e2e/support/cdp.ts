/**
 * Chrome DevTools Protocol access from a browser-mode spec, and the logical
 * viewport helper M8.2/M9.1 introduced: DPR fixed at 1, waiting on the CSS size.
 *
 * Moved here unchanged from `pm9.1-baseline.browser.e2e.ts` so the manual
 * review harness sizes the page the same way the automated contract does.
 */

export async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw Error("Owned ChromeDriver port missing");
  const root = `${protocol}://${hostname}:${port}${path.endsWith("/") ? path : path + "/"}`;
  const response = await fetch(new URL(`session/${browser.sessionId}/goog/cdp/execute`, root), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, params }),
  });
  const data = (await response.json()) as { value?: Record<string, unknown> };
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data));
  return data.value ?? {};
}

/** The M8.2/M9.1 viewport helper: DPR fixed at 1, waiting on the CSS size only. */
export async function metrics(width: number, height: number) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await browser.waitUntil(() =>
    browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
  );
}
