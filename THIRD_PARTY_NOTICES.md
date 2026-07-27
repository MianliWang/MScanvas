# Third-party notices

This repository does not currently redistribute ProteoWizard, vendor readers, OpenMS, pyOpenMS, matchms or proprietary instrument SDKs.

Runtime and development dependencies retain their upstream licenses. Before distributing binaries, maintainers must generate and review a complete dependency license inventory and document any user-installed backend requirements.

## Reviewed direct dependencies

| Crate | Version | License | Where it is used | Approved scope |
| --- | --- | --- | --- | --- |
| `quick-xml` | `=0.41.0` (exact) | MIT | `mscanvas-proteowizard` | Bounded streaming mzML structural scanning inside the ProteoWizard conversion-integrity boundary only. `default-features = false`; serialization, Serde, encoding and async/Tokio features stay disabled. |

`quick-xml` and its only required transitive dependency `memchr` (MIT OR Unlicense)
were already present in `Cargo.lock` through `tauri` → `plist`. Declaring `quick-xml`
directly adds no crate to the dependency graph and introduces no duplicate version.

## External backends

- ProteoWizard / `msconvert` / `msaccess`: installed and licensed separately by the user.
- Vendor RAW readers: availability and redistribution rights vary by vendor, platform and installation.
- Future Python/OpenMS workers: distribution model pending explicit license and size review.
