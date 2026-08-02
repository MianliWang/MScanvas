# Third-party notices

This repository does not currently redistribute ProteoWizard, vendor readers, OpenMS, pyOpenMS, matchms or proprietary instrument SDKs.

Runtime and development dependencies retain their upstream licenses. Before distributing binaries, maintainers must generate and review a complete dependency license inventory and document any user-installed backend requirements.

## Reviewed direct dependencies

| Crate | Version | License | Where it is used | Approved scope |
| --- | --- | --- | --- | --- |
| `quick-xml` | `=0.41.0` (exact) | MIT | `mscanvas-proteowizard` | Bounded streaming mzML structural scanning inside the ProteoWizard conversion-integrity boundary only. `default-features = false`; serialization, Serde, encoding and async/Tokio features stay disabled. |
| `windows` | `=0.61.3` (exact, Windows target only) | MIT OR Apache-2.0 | `mscanvas-desktop` | Typed Win32 COM bindings for the Rust-owned `IFileDialog` folder picker only. Win32 API feature groups are limited to Foundation, COM and Shell; the webview receives no new capability or path. |

`quick-xml` and its only required transitive dependency `memchr` (MIT OR Unlicense)
were already present in `Cargo.lock` through `tauri` → `plist`. Declaring `quick-xml`
directly adds no crate to the dependency graph and introduces no duplicate version.

`windows` `0.61.3` and its support crates were already present in `Cargo.lock`
through the Windows Tauri stack. The direct target-specific declaration adds no
crate version to the dependency graph; it exposes only the typed APIs needed to
replace the legacy folder dialog without widening Tauri capabilities.

## External backends

- ProteoWizard / `msconvert` / `msaccess`: installed and licensed separately by the user.
- Vendor RAW readers: availability and redistribution rights vary by vendor, platform and installation.
- Future Python/OpenMS workers: distribution model pending explicit license and size review.
