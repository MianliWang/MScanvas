import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeResourceOrigins } from "./nativeResourceOrigins";

test("keeps the real Windows IPC transport observable without treating it as a remote resource", () => {
  const ipc = [
    "http://ipc.localhost/inspect_backend",
    "http://ipc.localhost/open_mzml_preview",
    "http://ipc.localhost/choose_workspace_conversion_destination",
  ];
  assert.deepEqual(nativeResourceOrigins([
    "http://tauri.localhost/assets/index.js", ...ipc, "asset://localhost/figure.png",
  ], "http://tauri.localhost"), { localIpcResources: ipc, externalResources: [] });
});

test("still rejects remote resources and every non-matching IPC-like origin", () => {
  const external = [
    "https://example.invalid/locale.json",
    "http://ipc.localhost.example.invalid/inspect_backend",
    "http://ipc.localhost@example.invalid/inspect_backend",
    "http://sub.ipc.localhost/inspect_backend",
    "http://ipc.localhost:1420/inspect_backend",
    "https://ipc.localhost/inspect_backend",
    "http://127.0.0.1:1420/locale.json",
  ];
  assert.deepEqual(nativeResourceOrigins(external, "http://tauri.localhost"), {
    localIpcResources: [], externalResources: external,
  });
});
