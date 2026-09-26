# Third-party notices

<!-- generated: scripts/generate_notices.py -->

MSCanvas redistributes no ProteoWizard build, vendor reader, OpenMS,
pyOpenMS, matchms or proprietary instrument SDK. ProteoWizard is installed
by the user and is never bundled.

This file covers what the installer actually carries: the release build of
the desktop binary for `x86_64-pc-windows-msvc` and the production frontend bundle. Build-only
tooling -- the Tauri bundler, NSIS, test frameworks and linters -- is out of
scope, because attribution follows distribution.

Regenerate with `python -B scripts/generate_notices.py`; verify with `--check`.

Shipped Rust packages: **188**. Shipped frontend packages: **66**.

## Obligations this inventory creates

- **Attribution.** The MIT, BSD, Zlib, BSL-1.0 and Apache-2.0 packages below
  require their copyright and permission notices to accompany a binary
  distribution. This file travels with the installer for that purpose.
- **Apache-2.0 NOTICE files.** Where an upstream package ships a `NOTICE`,
  its contents must be reproduced. None of the packages below is modified by
  this project.
- **Unicode-3.0.** The ICU packages carry the Unicode licence and its
  disclaimer, reproduced through their own distributions.
- **MPL-2.0 source availability.** MPL-2.0 section 3.2 requires the source
  of the covered files to be available to recipients of a binary. The exact
  shipped versions are named below, each with a location that serves that
  source: the crates.io page for the version, which offers the published
  `.crate` archive, and the upstream repository the package declares.
  Availability is what discharges the obligation; the fact that this project
  modifies none of these files is additional, not a substitute for it.
  Each arrives transitively through Tauri rather than being chosen here.

  | Crate and shipped version | Source for that version | Upstream repository | Reached through |
  | --- | --- | --- | --- |
  | `option-ext v0.2.0` | <https://crates.io/crates/option-ext/0.2.0> | <https://github.com/soc/option-ext.git> | tauri -> dirs -> dirs-sys |

## Inventory

### Rust packages in the shipped binary

Walked from `mscanvas-desktop` for `x86_64-pc-windows-msvc` over normal dependency edges, so development-only and build-only crates are excluded.

| Licence | Count | Packages |
| --- | ---: | --- |
| `MIT OR Apache-2.0` | 89 | `anyhow v1.0.104`, `arboard v3.6.1`, `arrayvec v0.7.8`, `base64 v0.23.1`, `bitflags v2.13.1`, `cfg-if v1.0.4`, `cookie v0.18.2`, `crc32fast v1.5.1`, `crossbeam-channel v0.5.17`, `crossbeam-utils v0.8.23`, `data-url v0.3.2`, `deranged v0.5.8`, `dirs v6.0.0`, `dirs-sys v0.5.0`, `erased-serde v0.4.10`, `fdeflate v0.3.7`, `flate2 v1.1.10`, `font-types v0.12.4`, `form_urlencoded v1.2.2`, `getrandom v0.3.4`, `getrandom v0.4.3`, `glob v0.3.4`, `hashbrown v0.17.1`, `heck v0.5.0`, `http v1.5.0`, `idna v1.1.0`, `image v0.25.10`, `itoa v1.0.18`, `jsonptr v0.6.3`, `keyboard-types v0.7.0`, `libc v0.2.189`, `lock_api v0.4.14`, `log v0.4.34`, `mime v0.3.17`, `num-conv v0.2.2`, `num-traits v0.2.19`, `once_cell v1.21.4`, `parking_lot v0.12.5`, `parking_lot_core v0.9.12`, `percent-encoding v2.3.2`, `png v0.18.1`, `polycool v0.4.0`, `powerfmt v0.2.0`, `read-fonts v0.41.0`, `regex v1.13.1`, `regex-automata v0.4.18`, `regex-syntax v0.8.11`, `roxmltree v0.21.1`, `scopeguard v1.2.0`, `semver v1.0.28`, `serde v1.0.229`, `serde-untagged v0.1.9`, `serde_core v1.0.229`, `serde_json v1.0.151`, `serde_spanned v1.1.1`, `serde_with v3.23.0`, `serialize-to-javascript v0.1.2`, `skrifa v0.44.0`, `smallvec v1.16.0`, `softbuffer v0.4.8`, `stable_deref_trait v1.2.1`, `thiserror v1.0.69`, `thiserror v2.0.20`, `time v0.3.55`, `time-core v0.1.9`, `toml v1.1.3+spec-1.1.0`, `toml_datetime v1.1.1+spec-1.1.0`, `toml_parser v1.1.3+spec-1.1.0`, `toml_writer v1.1.2+spec-1.1.0`, `typeid v1.0.3`, `unicode-bidi v0.3.18`, `unicode-script v0.5.8`, `unicode-segmentation v1.13.3`, `url v2.5.8`, `windows v0.61.3`, `windows-collections v0.2.0`, `windows-core v0.61.2`, `windows-future v0.2.1`, `windows-link v0.1.3`, `windows-link v0.2.1`, `windows-numerics v0.2.0`, `windows-result v0.3.4`, `windows-strings v0.4.2`, `windows-sys v0.59.0`, `windows-sys v0.61.2`, `windows-targets v0.52.6`, `windows-threading v0.1.0`, `windows-version v0.1.7`, `windows_x86_64_msvc v0.52.6` |
| `MIT` | 25 | `bytes v1.12.1`, `cfb v0.7.3`, `float-cmp v0.9.0`, `fontdb v0.24.0`, `harfrust v0.12.0`, `imagesize v0.15.0`, `infer v0.19.0`, `phf v0.13.1`, `phf_shared v0.13.1`, `pico-args v0.5.0`, `plist v1.10.1`, `quick-xml v0.41.0`, `quick-xml v0.42.0`, `rgb v0.8.53`, `simd-adler32 v0.3.10`, `strict-num v0.1.1`, `tokio v1.53.1`, `tracing v0.1.44`, `tracing-core v0.1.36`, `urlpattern v0.3.0`, `webview2-com v0.38.2`, `webview2-com-sys v0.38.2`, `winnow v1.0.4`, `xmlwriter v0.1.0`, `zmij v1.0.23` |
| `Apache-2.0 OR MIT` | 20 | `ctor v0.8.0`, `equivalent v1.0.2`, `idna_adapter v1.2.2`, `indexmap v2.14.0`, `kurbo v0.13.1`, `muda v0.19.3`, `pin-project-lite v0.2.17`, `resvg v0.48.1`, `simplecss v0.2.2`, `svgtypes v0.16.1`, `tauri v2.11.5`, `tauri-plugin-clipboard-manager v2.3.3`, `tauri-runtime v2.11.3`, `tauri-runtime-wry v2.11.4`, `tauri-utils v2.9.3`, `usvg v0.48.1`, `utf8_iter v1.0.4`, `uuid v1.26.1`, `window-vibrancy v0.6.0`, `wry v0.55.1` |
| `Unicode-3.0` | 15 | `icu_collections v2.3.0`, `icu_locale_core v2.3.0`, `icu_normalizer v2.3.0`, `icu_normalizer_data v2.3.0`, `icu_properties v2.3.0`, `icu_properties_data v2.3.0`, `icu_provider v2.3.1`, `litemap v0.8.3`, `potential_utf v0.1.6`, `tinystr v0.8.4`, `writeable v0.6.4`, `yoke v0.8.3`, `zerofrom v0.1.8`, `zerotrie v0.2.5`, `zerovec v0.11.8` |
| `MIT/Apache-2.0` | 8 | `json-patch v3.0.1`, `siphasher v1.0.3`, `unic-char-property v0.9.0`, `unic-char-range v0.9.0`, `unic-common v0.9.0`, `unic-ucd-ident v0.9.0`, `unic-ucd-version v0.9.0`, `unicode-vo v0.1.0` |
| `Unlicense OR MIT` | 5 | `aho-corasick v1.1.5`, `byteorder v1.5.0`, `byteorder-lite v0.1.0`, `memchr v2.8.3`, `winapi-util v0.1.11` |
| `BSD-3-Clause` | 4 | `alloc-no-stdlib v2.0.4`, `alloc-stdlib v0.2.4`, `tiny-skia v0.12.0`, `tiny-skia-path v0.12.0` |
| `BSD-3-Clause OR Apache-2.0` | 2 | `moxcms v0.8.1`, `pxfm v0.1.30` |
| `BSL-1.0` | 2 | `clipboard-win v5.4.1`, `error-code v3.4.0` |
| `MIT OR Apache-2.0 OR Zlib` | 2 | `raw-window-handle v0.6.2`, `tinyvec_macros v0.1.1` |
| `MIT OR Zlib OR Apache-2.0` | 2 | `miniz_oxide v0.8.9`, `miniz_oxide v0.9.1` |
| `Unlicense/MIT` | 2 | `same-file v1.0.6`, `walkdir v2.5.0` |
| `Zlib OR Apache-2.0 OR MIT` | 2 | `bytemuck v1.25.2`, `tinyvec v1.13.2` |
| `0BSD OR MIT OR Apache-2.0` | 1 | `adler2 v2.0.1` |
| `Apache-2.0` | 1 | `tao v0.35.3` |
| `Apache-2.0 / MIT` | 1 | `fnv v1.0.7` |
| `Apache-2.0 AND MIT` | 1 | `dpi v0.1.2` |
| `BSD-2-Clause` | 1 | `arrayref v0.3.9` |
| `BSD-3-Clause AND MIT` | 1 | `brotli v8.0.4` |
| `BSD-3-Clause/MIT` | 1 | `brotli-decompressor v5.0.3` |
| `CC0-1.0 OR MIT-0 OR Apache-2.0` | 1 | `dunce v1.0.5` |
| `MPL-2.0` | 1 | `option-ext v0.2.0` |
| `Zlib` | 1 | `slotmap v1.1.1` |

### Frontend packages in the shipped bundle

Production dependencies of `@mscanvas/desktop`. Vite bundles what is imported rather than what is declared, so this is the declared set; the generator separately fails if a shipped asset names a package not covered here.

| Licence | Count | Packages |
| --- | ---: | --- |
| `MIT` | 62 | `@babel/runtime v7.29.7`, `@dnd-kit/abstract v0.5.0`, `@dnd-kit/collision v0.5.0`, `@dnd-kit/dom v0.5.0`, `@dnd-kit/geometry v0.5.0`, `@dnd-kit/helpers v0.5.0`, `@dnd-kit/react v0.5.0`, `@dnd-kit/state v0.5.0`, `@floating-ui/core v1.8.0`, `@floating-ui/dom v1.8.0`, `@floating-ui/react-dom v2.1.9`, `@floating-ui/utils v0.2.12`, `@preact/signals-core v1.14.4`, `@radix-ui/primitive v1.1.7`, `@radix-ui/react-arrow v1.1.15`, `@radix-ui/react-collection v1.1.15`, `@radix-ui/react-compose-refs v1.1.5`, `@radix-ui/react-context v1.2.2`, `@radix-ui/react-dialog v1.1.23`, `@radix-ui/react-direction v1.1.4`, `@radix-ui/react-dismissable-layer v1.1.19`, `@radix-ui/react-dropdown-menu v2.1.24`, `@radix-ui/react-focus-guards v1.1.6`, `@radix-ui/react-focus-scope v1.1.16`, `@radix-ui/react-id v1.1.4`, `@radix-ui/react-menu v2.1.24`, `@radix-ui/react-popper v1.3.7`, `@radix-ui/react-portal v1.1.17`, `@radix-ui/react-presence v1.1.10`, `@radix-ui/react-primitive v2.1.10`, `@radix-ui/react-roving-focus v1.1.19`, `@radix-ui/react-slot v1.3.3`, `@radix-ui/react-use-callback-ref v1.1.4`, `@radix-ui/react-use-controllable-state v1.2.6`, `@radix-ui/react-use-effect-event v0.0.5`, `@radix-ui/react-use-is-hydrated v0.1.3`, `@radix-ui/react-use-layout-effect v1.1.4`, `@radix-ui/react-use-rect v1.1.4`, `@radix-ui/react-use-size v1.1.4`, `@radix-ui/rect v1.1.3`, `@types/react v19.2.18`, `@types/react-dom v19.2.7`, `aria-hidden v1.2.6`, `csstype v3.2.3`, `detect-node-es v1.1.0`, `framer-motion v13.2.0`, `get-nonce v1.0.1`, `html-parse-stringify v4.0.1`, `i18next v26.4.2`, `motion v13.2.0`, `motion-dom v13.2.0`, `motion-utils v13.0.0`, `react v19.2.8`, `react-dom v19.2.8`, `react-i18next v17.0.13`, `react-remove-scroll v2.7.2`, `react-remove-scroll-bar v2.3.8`, `react-style-singleton v2.2.3`, `scheduler v0.27.0`, `use-callback-ref v1.3.3`, `use-sidecar v1.1.3`, `use-sync-external-store v1.7.0` |
| `Apache-2.0` | 2 | `@typescript/typescript-win32-x64 v7.0.2`, `typescript v7.0.2` |
| `0BSD` | 1 | `tslib v2.8.1` |
| `Apache-2.0 OR MIT` | 1 | `@tauri-apps/api v2.11.1` |

### Build tools whose output ships

These are not dependencies of the application. They run at build time and are listed because their own text ends up inside a shipped artifact, which is distribution of that text.

| Tool | Version | Licence | What actually ships |
| --- | --- | --- | --- |
| `tailwindcss` | 4.3.3 | `MIT` | the generated stylesheet, including its MIT banner and the verbatim Preflight base styles |

## Reviewed direct dependencies and their approved scope

The narrow scope each directly declared dependency was accepted under is
recorded in `docs/development/DEPENDENCY_POLICY.md` and the ADRs that admitted
them. That review governs what these packages may be used for; this file
records what must accompany their redistribution.

## Limits

Licence identifiers are the ones each package declares in its own metadata.
They were collected on the versions in the committed lockfiles and are
reproducible from them. No licence text is restated here in place of the
upstream package's own; this is an inventory and an obligation record.
