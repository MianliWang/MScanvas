/** Read-only correlation of real preview Blobs; serialized into the QA document. */
export interface ObservedPreviewBlob {
  svg: string;
  specId: string;
  width: number;
  height: number;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  request: { callIndex: number; requestId: number; requestJson: string };
}

export function installM74PreviewBlobObserver(): void {
  if (Reflect.has(window, "__m74ReadPreviewBlob") || Reflect.has(window, "__m74StopPreviewBlobs")) throw Error("Preview observer already installed.");
  const create = Object.getOwnPropertyDescriptor(URL, "createObjectURL")!, revoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")!;
  if (typeof create?.value !== "function" || typeof revoke?.value !== "function" || !create.configurable || !revoke.configurable) throw Error("Native URL methods cannot be observed and restored exactly.");
  const callLog: unknown = Reflect.get(window, "__mscanvasIpcCalls__");
  if (!Array.isArray(callLog)) throw Error("The existing QA request log is unavailable.");
  type RequestIdentity = ObservedPreviewBlob["request"];
  const latestRequest = (): RequestIdentity | null => {
    if (Reflect.get(window, "__mscanvasIpcCalls__") !== callLog) return null;
    for (let callIndex = callLog.length - 1; callIndex >= 0; callIndex--) {
      const call = callLog[callIndex] as { command?: string; args?: { request?: { requestId?: number; source?: unknown; settings?: unknown } } };
      if (call.command !== "preview_figure") continue;
      const request = call.args?.request;
      if (!request || !Number.isSafeInteger(request.requestId) || !request.source || !request.settings) return null;
      return { callIndex, requestId: request.requestId!, requestJson: JSON.stringify(request) };
    }
    return null;
  };
  const sameRequest = (a: RequestIdentity, b: RequestIdentity | null) => b !== null &&
    a.callIndex === b.callIndex && a.requestId === b.requestId && a.requestJson === b.requestJson;
  const blobs = new Map<string, { blob: Blob; request: RequestIdentity }>();
  let created = 0, revoked = 0, overflow = false, captureFailed = false;
  const wrappedCreate = function (this: typeof URL, ...args: Parameters<typeof URL.createObjectURL>): string {
    const url = Reflect.apply(create.value, this, args) as string;
    // Observation failures must not change the product's return/throw behavior.
    try {
      if (args[0] instanceof Blob && args[0].type === "image/svg+xml") {
        created++;
        const request = latestRequest();
        if (blobs.size >= 64 || args[0].size > 8 * 1024 * 1024) overflow = true;
        else if (request) blobs.set(url, { blob: args[0], request });
      }
    } catch { captureFailed = true; }
    return url;
  };
  const wrappedRevoke = function (this: typeof URL, ...args: Parameters<typeof URL.revokeObjectURL>): void {
    const result = Reflect.apply(revoke.value, this, args) as void;
    if (blobs.delete(args[0])) revoked++;
    return result;
  };
  try {
    Object.defineProperty(URL, "createObjectURL", { ...create, value: wrappedCreate });
    Object.defineProperty(URL, "revokeObjectURL", { ...revoke, value: wrappedRevoke });
  } catch (error) {
    Object.defineProperty(URL, "createObjectURL", create); Object.defineProperty(URL, "revokeObjectURL", revoke); throw error;
  }
  Reflect.set(window, "__m74ReadPreviewBlob", async (selector: string): Promise<ObservedPreviewBlob | null> => {
    if (overflow || captureFailed) throw Error("Preview observer capture failed or exceeded its bounded inventory.");
    const img = document.querySelector<HTMLImageElement>(selector);
    if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0 || img.currentSrc !== img.src) return null;
    const { src, currentSrc, width, height, naturalWidth, naturalHeight } = img, specId = img.dataset.specId;
    const captured = blobs.get(src);
    if (!captured || !specId || !sameRequest(captured.request, latestRequest())) return null;
    const svg = await captured.blob.text();
    if (document.querySelector(selector) !== img || !img.isConnected || !img.complete || img.src !== src || img.currentSrc !== currentSrc ||
        img.dataset.specId !== specId || img.width !== width || img.height !== height || img.naturalWidth !== naturalWidth ||
        img.naturalHeight !== naturalHeight || blobs.get(src) !== captured || !sameRequest(captured.request, latestRequest())) return null;
    return { svg, specId, width, height, src, naturalWidth, naturalHeight, request: captured.request };
  });
  Reflect.set(window, "__m74StopPreviewBlobs", () => {
    const wrappersUnchanged = URL.createObjectURL === wrappedCreate && URL.revokeObjectURL === wrappedRevoke;
    Object.defineProperty(URL, "createObjectURL", create); Object.defineProperty(URL, "revokeObjectURL", revoke);
    blobs.clear(); Reflect.deleteProperty(window, "__m74ReadPreviewBlob"); Reflect.deleteProperty(window, "__m74StopPreviewBlobs");
    return { created, revoked, overflow, captureFailed, wrappersUnchanged, restored: URL.createObjectURL === create.value && URL.revokeObjectURL === revoke.value };
  });
}
