# Third-party notices

This repository does not currently redistribute ProteoWizard, vendor readers, OpenMS, pyOpenMS, matchms or proprietary instrument SDKs.

Runtime and development dependencies retain their upstream licenses. Before distributing binaries, maintainers must generate and review a complete dependency license inventory and document any user-installed backend requirements.

## Reviewed direct dependencies

| Crate | Version | License | Where it is used | Approved scope |
| --- | --- | --- | --- | --- |
| `quick-xml` | `=0.41.0` (exact) | MIT | `mscanvas-proteowizard` | Bounded streaming mzML structural scanning inside the ProteoWizard conversion-integrity boundary only. `default-features = false`; serialization, Serde, encoding and async/Tokio features stay disabled. |
| `windows` | `=0.61.3` (exact, Windows target only) | MIT OR Apache-2.0 | `mscanvas-desktop` | Typed Win32 COM bindings for the Rust-owned `IFileDialog` folder picker only. Win32 API feature groups are limited to Foundation, COM and Shell; the webview receives no new capability or path. |
| `resvg` | `=0.48.1` (exact) | Apache-2.0 OR MIT | `mscanvas-desktop` | Rasterizes the SVG this application already produces, for PNG export and `Copy plot`. Not a second scientific renderer: the same `FigureSpec`, through the same deterministic SVG, put on a pixel grid. `default-features = false`; only `text` and `system-fonts` are enabled, because the figure embeds no bitmap, is never gzipped and is parsed from memory. `usvg` and `tiny-skia` are used through `resvg`'s own re-exports rather than declared directly. MSRV 1.85.0. |
| `png` | `=0.18.1` (exact) | MIT OR Apache-2.0 | `mscanvas-desktop` | Encodes the rasterized figure and records the requested physical resolution in the `pHYs` chunk, which the rasterizer's own PNG writer cannot do. Adds no crate version: `image`, via `arboard`, via the clipboard plugin, already resolves to the same 0.18.1. MSRV 1.73. |
| `tauri-plugin-clipboard-manager` | `=2.3.2` (exact) | Apache-2.0 OR MIT | `mscanvas-desktop` | Writes one image to the system clipboard for `Copy plot`, through its **Rust** API only. The plugin's own commands are granted to nobody: `capabilities/default.json` lists no permission, and Tauri denies every plugin command a capability does not list. No clipboard **read** capability exists, and the JavaScript guest plugin is not a dependency. MSRV 1.77.2. |

`quick-xml` and its only required transitive dependency `memchr` (MIT OR Unlicense)
were already present in `Cargo.lock` through `tauri` → `plist`. Declaring `quick-xml`
directly adds no crate to the dependency graph and introduces no duplicate version.

`windows` `0.61.3` and its support crates were already present in `Cargo.lock`
through the Windows Tauri stack. The direct target-specific declaration adds no
crate version to the dependency graph; it exposes only the typed APIs needed to
replace the legacy folder dialog without widening Tauri capabilities.

`resvg` `0.48.1` brings `usvg`, `tiny-skia` and a font stack (`fontdb`,
`rustybuzz`, `ttf-parser`) that were not previously in the graph. Its default
features are disabled: `raster-images` (which would pull `gif`, `image-webp` and
`zune-jpeg`), `svgz` and `memmap-fonts` are all off, because a figure this
application produces embeds no bitmap, is never gzipped and is parsed from a
string in memory. No font file is vendored and none is fetched at runtime --
typography comes from the machine's own font database, and a machine that cannot
resolve one refuses the raster formats rather than drawing a figure with its
words missing.

A second `png` at `0.17.16` is in the graph and was before this change: it
reaches only `ico` → `tauri-codegen` → `tauri-macros`, which is a proc-macro and
runs at build time rather than shipping.

## External backends

- ProteoWizard / `msconvert` / `msaccess`: installed and licensed separately by the user.
- Vendor RAW readers: availability and redistribution rights vary by vendor, platform and installation.
- Future Python/OpenMS workers: distribution model pending explicit license and size review.
