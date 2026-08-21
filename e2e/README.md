# Rendered UI QA

Two layers, and the difference between them is what each one is allowed to
claim.

| | `pnpm e2e:browser` | `pnpm e2e:tauri` |
|---|---|---|
| Renderer | real Chrome, headless | real WebView2 |
| Backend | replaced at the IPC boundary | real Rust process |
| Cost | seconds | minutes |
| Answers | what the interface looks like and how it behaves | whether the shipped composition stands up and wires together |

Browser mode is the primary gate, because it is where a claim about layout,
focus treatment, wrapping at a viewport, or an export outcome can be made
cheaply and repeatedly. The Tauri layer is deliberately smaller: it exists to
prove the parts browser mode has to assume.

## Commands

| Command | What it does |
|---|---|
| `pnpm e2e:typecheck` | Types the harness. |
| `pnpm e2e:browser` | The browser-mode suite. Starts and stops its own Vite. |
| `pnpm qa:m4.1` | The gate: typecheck, then browser mode. |
| `pnpm e2e:build` | Builds the frontend and the `--features e2e` binary. |
| `pnpm e2e:tauri` | The real-WebView suite. Needs `e2e:build` and `tauri-driver` first. |
| `pnpm e2e:native-dialog` | The save-dialog selector probe. See `native/README.md`. |

The Tauri layer needs `tauri-driver` on `PATH` (`cargo install tauri-driver`)
and a debug binary built with `--features e2e`.

## The `e2e` Cargo feature

Off by default, and never enabled for a release build. It compiles in exactly
one thing: an initialization script that can answer this application's own
commands from a table the page can write. That is a capability a shipped binary
must not carry — anything running in the document could use it to make the
interface believe whatever it liked.

Nothing else about the binary changes. The WebDriver session itself is external
(`tauri-driver` in front of the platform WebDriver), so no server, port, or
remote-control surface is compiled in at any time.

A default build carries none of the markers:

```
$ cargo build -p mscanvas-desktop --bin mscanvas-desktop
$ strings target/debug/mscanvas-desktop.exe | grep -c __mscanvasIpcTable__
0
```

## What is real in the Tauri layer, and what is not

Real: the process, the WebView, the frontend bundle, the IPC transport, and
every command no test answers — the boundary passes those straight through to
Rust, so `carries a real IPC round trip` is exactly that.

Answered from the table: the commands that would need a ProteoWizard
installation and an mzML file on the running machine, plus the export pair,
whose real implementation opens a modal save dialog no WebDriver session can
dismiss. See `native/README.md` for what that costs and what it leaves open.

## One thing worth knowing before changing the boundary

The host installs `__TAURI_INTERNALS__.invoke` with `Object.defineProperty`,
non-writable and non-configurable, and it does so *after* appended
initialization scripts run. So there is exactly one moment at which the function
can be substituted: the definition itself. An accessor installed beforehand is
replaced without ever being told, and the symptom is not an error — it is a
suite that observes an application making no IPC calls at all.
