/** Separate Tauri's exact Windows IPC origin from off-origin HTTP resources. */
export function nativeResourceOrigins(resourceUrls: string[], applicationOrigin: string) {
  const localIpcResources: string[] = [];
  const externalResources: string[] = [];
  for (const value of resourceUrls) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.origin === applicationOrigin) continue;
    // Matches the production connect-src contract in tauri.conf.json. Do not
    // exempt arbitrary localhost ports, subdomains or similarly named hosts.
    if (url.origin === "http://ipc.localhost") localIpcResources.push(value);
    else externalResources.push(value);
  }
  return { localIpcResources, externalResources };
}
