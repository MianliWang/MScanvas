/** Synthetic controls for QA observation only; no native/product acceptance. */
import { createHash } from "node:crypto";
import { installM74PreviewBlobObserver } from "../support/m74PreviewBlobObserver";
import type { ObservedPreviewBlob } from "../support/m74PreviewBlobObserver";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>';
const SPEC = createHash("sha256").update(SVG).digest("hex");

async function read() {
  return browser.execute(() => (Reflect.get(window, "__m74ReadPreviewBlob") as (selector: string) => Promise<ObservedPreviewBlob | null>)("#preview"));
}
async function makePreview() {
  return browser.execute(async (svg, specId) => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    Reflect.set(window, "testBlob", blob);
    const url = URL.createObjectURL(blob), img = document.createElement("img");
    img.id = "preview"; img.width = 20; img.height = 10; img.dataset.specId = specId; img.src = url;
    document.body.replaceChildren(img); await img.decode(); return url;
  }, SVG, SPEC);
}

describe("M7.4 preview Blob observation controls", () => {
  beforeEach(async () => {
    // A separate inert document, never the application or its production CSP.
    await browser.url("data:text/html," + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; img-src blob:"><title>Synthetic observer control</title>'));
    await browser.execute(() => {
      Reflect.set(window, "__mscanvasIpcCalls__", [{ command: "preview_figure", args: { request: {
        requestId: 1, source: { kind: "spectrum", token: "synthetic", range: { kind: "full" } }, settings: { width: 20, height: 10 },
      } } }]);
      Reflect.set(window, "testUrlDescriptors", [Object.getOwnPropertyDescriptor(URL, "createObjectURL"), Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")]);
    });
    await browser.execute(installM74PreviewBlobObserver);
  });
  afterEach(async () => {
    const restored = await browser.execute(() => {
      const stop = Reflect.get(window, "__m74StopPreviewBlobs") as () => object;
      const result = stop();
      const original = Reflect.get(window, "testUrlDescriptors") as PropertyDescriptor[];
      const same = ["createObjectURL", "revokeObjectURL"].every((key, index) => {
        const actual = Object.getOwnPropertyDescriptor(URL, key)!;
        return ["value", "writable", "enumerable", "configurable", "get", "set"].every(field => Reflect.get(actual, field) === Reflect.get(original[index]!, field));
      });
      return { result, descriptorsRestored: same, removed: !Reflect.has(window, "__m74ReadPreviewBlob") && !Reflect.has(window, "__m74StopPreviewBlobs") };
    });
    expect(restored).toMatchObject({ descriptorsRestored: true, removed: true,
      result: { overflow: false, captureFailed: false, wrappersUnchanged: true, restored: true } });
  });

  it("reads the actual displayed Blob despite blocked connect requests and preserves native URL behavior", async () => {
    const url = await makePreview();
    await browser.$("#preview").waitForDisplayed();
    const observed = await read();
    expect(observed).toMatchObject({ svg: SVG, specId: SPEC, src: url, naturalWidth: 20, naturalHeight: 10,
      request: { callIndex: 0, requestId: 1 } });
    expect(JSON.parse(observed!.request.requestJson)).toMatchObject({ source: { token: "synthetic" }, settings: { width: 20, height: 10 } });
    const behavior = await browser.execute(async currentUrl => {
      let fetchRejected = false, createThrew = false;
      try { await fetch(currentUrl); } catch { fetchRejected = true; }
      try { URL.createObjectURL(null as unknown as Blob); } catch (error) { createThrew = error instanceof TypeError; }
      return { fetchRejected, createThrew, revokeReturnedUndefined: URL.revokeObjectURL(currentUrl) === undefined };
    }, url);
    expect(behavior).toEqual({ fetchRejected: true, createThrew: true, revokeReturnedUndefined: true });
    expect(await read()).toBeNull();
  });

  it("refuses stale request identity, changed settings and an uncaptured URL", async () => {
    await makePreview(); expect(await read()).not.toBeNull();
    await browser.execute(() => {
      const log = Reflect.get(window, "__mscanvasIpcCalls__") as { command: string; args: { request: { requestId: number; settings: { width: number } } } }[];
      log[0]!.args.request.settings.width = 21;
    });
    expect(await read()).toBeNull();
    // Even an identical request object with a reset requestId belongs to a new call.
    await browser.execute(() => {
      const log = Reflect.get(window, "__mscanvasIpcCalls__") as { args: { request: { settings: { width: number } } } }[];
      log[0]!.args.request.settings.width = 20;
      log.push(structuredClone(log[0]));
    });
    expect(await read()).toBeNull();
    await makePreview(); expect((await read())!.request.callIndex).toBe(1);
    await browser.execute(async svg => {
      const original = Reflect.get(window, "testUrlDescriptors") as PropertyDescriptor[];
      const url = Reflect.apply(original[0]!.value, URL, [new Blob([svg], { type: "image/svg+xml" })]) as string;
      const img = document.querySelector<HTMLImageElement>("#preview")!; img.src = url; await img.decode();
    }, SVG);
    expect(await read()).toBeNull();
  });

  for (const change of ["element", "request", "revoke", "read failure"] as const) {
    it(`rejects ${change} during an in-flight read and restores descriptors afterwards`, async () => {
      await makePreview();
      const result = await browser.execute(async mode => {
        const blob = Reflect.get(window, "testBlob") as Blob;
        const nativeText = blob.text.bind(blob);
        let release!: () => void;
        const held = new Promise<void>(done => { release = done; });
        // Controlled synthetic race only. Native observation never patches Blob.text.
        blob.text = async () => { await held; if (mode === "read failure") throw Error("synthetic read failure"); return nativeText(); };
        const pending = (Reflect.get(window, "__m74ReadPreviewBlob") as (selector: string) => Promise<ObservedPreviewBlob | null>)("#preview");
        const img = document.querySelector<HTMLImageElement>("#preview")!;
        if (mode === "element") img.replaceWith(img.cloneNode());
        if (mode === "request") {
          const log = Reflect.get(window, "__mscanvasIpcCalls__") as unknown[];
          log.push(structuredClone(log[0]));
        }
        if (mode === "revoke") URL.revokeObjectURL(img.src);
        release();
        try { return { observed: await pending, error: null }; } catch (error) { return { observed: null, error: String(error) }; }
        finally { delete (blob as Partial<Blob>).text; }
      }, change);
      expect(result.observed).toBeNull();
      expect(result.error).toBe(change === "read failure" ? "Error: synthetic read failure" : null);
    });
  }
});
