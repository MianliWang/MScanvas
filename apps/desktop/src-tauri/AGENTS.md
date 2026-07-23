# Tauri/native boundary guidance

Read the root guidance and this file before changing Tauri commands, capabilities, filesystem access or process execution.

## Security boundary

- The webview must not receive general shell, process or filesystem permissions.
- Expose narrow typed commands such as inspect inputs, resolve a plan, start an approved job or read a bounded result.
- Never accept a raw command string or arbitrary executable path from the frontend.
- Launch processes directly with argv arrays and an explicit working directory/environment.
- Validate output roots and treat source acquisitions as read-only.
- Cancellation must eventually terminate the complete child process tree.
- Do not add a Tauri plugin without approval, capability review and documentation.

## State ownership

Rust owns backend discovery, process state, run state and filesystem truth. Emit small normalized events to the frontend; do not stream unbounded stderr or scientific arrays through generic events.

## Tests

Keep domain behavior in reusable crates where it can be unit-tested without a WebView. Tauri commands should be thin adapters over application services.
