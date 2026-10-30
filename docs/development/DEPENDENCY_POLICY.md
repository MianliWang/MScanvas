# Dependency update policy

MSCanvas keeps automated version updates useful without treating every new major
release as a routine maintenance change.

## Routine version updates

Dependabot checks npm, Cargo and GitHub Actions monthly. Automated version-update
pull requests are limited to SemVer minor and patch releases and are grouped by
ecosystem. npm runtime and development dependencies remain separate groups so a
frontend tool update does not silently change the shipped application dependency
set.

## Major versions

Major upgrades require a deliberately opened compatibility pull request. Its scope
must name the affected runtime or milestone, document breaking changes and run the
relevant locked install, lint, typecheck, test, build and platform checks. Unrelated
major upgrades are not combined merely to reduce pull-request count.

## Security updates

The `allow.update-types` limits in `.github/dependabot.yml` apply to version updates,
not Dependabot security updates. Security updates remain visible and are intentionally
not grouped by this file. Dependabot alerts and security updates must remain enabled in
the repository settings.

MSCanvas does not enable dependency auto-merge. Every update is reviewed against the
supported Node and Rust toolchains, the committed lockfiles and the product's
Windows-first runtime contract.

## Security fixes

A security fix takes the smallest change that clears an alert: a lockfile refresh
inside the ranges the parents already declare, otherwise a pnpm `overrides` entry in
`pnpm-workspace.yaml` scoped to the vulnerable major. An override within the parent's
major takes a range; one that crosses a major names the exact release that was verified
and is moved by hand. An override is removed once its parent declares a fixed range. An alert with no fix inside the current toolchain is
recorded here with its evidence and proposed dismissal reason; only the owner
dismisses alerts.

### 2026-10-30: open alerts on main 047eadc

Owner-approved. None of these packages is in the production npm graph
(`pnpm why -r --prod` is empty) or in the Windows build of the Rust binary.

| Change | Alerts | Rationale |
|---|---|---|
| undici 7.29.0 -> 7.30.1 (lockfile only) | 11 | `cheerio` and `jsdom` already declare ranges that admit 7.30.1. Test tooling. |
| undici 6.28.0 -> 6.29.1, override `"undici@6": ">=6.29.1 <7"` | 5 | `webdriver@9` declares `^6.27.0`, but `pnpm update` keeps 6.28.0. E2e tooling. |
| serialize-javascript 6.0.2 -> 7.1.3, override `"serialize-javascript@6": "7.1.3"` | 3 | `mocha@10` declares `^6.0.2` and no 6.x is fixed. 7.0.0 only raised the Node floor to 20; mocha loads it only in parallel mode, which no suite uses. 7.1.3 is the oldest release with every fix. Drops `randombytes`. |
| source-map-js 1.2.1 -> 1.2.2 (lockfile only) | 1 | `@tailwindcss/node` and `css-tree` already declare `^1.2.1`. Build and test tooling. |

Left open for the owner:

- **extract-zip 2.0.1** (2 alerts, no patched version). Reached through
  `@wdio/utils@9.32.0` -> `@puppeteer/browsers@2.13.2`, both the last of their majors.
  `@puppeteer/browsers` 3.x drops it, but only `@wdio/utils` 10 declares 3.x, so the
  fix is the WebdriverIO 10 migration. Unlike serialize-javascript, 3.x is not
  overridden: it is a new API (ESM-only, Node >= 22.12) that `@wdio/utils` 9 calls into
  directly and that no suite here has run against. It unpacks the Chrome for Testing archive
  WebdriverIO downloads over HTTPS during e2e setup and never reaches the installer.
  Proposed dismissal: `tolerable_risk`.
- **glib 0.18.5** (1 alert). Only in Tauri's Linux GTK backend:
  `cargo tree -i glib --target x86_64-pc-windows-msvc` prints nothing, and MSCanvas
  builds and ships for Windows only. A fix needs Tauri's gtk-rs stack to reach 0.20.
  Proposed dismissal: `not_used`.
- **Pillow 12.3.0** (41 alerts). It is in the targeted-MS1 runtime lock
  (`experiments/m9_0/runtime/requirements-cp313-win_amd64.lock.txt`) through
  matplotlib, which pyopenms requires. It is declared but not imported, and a release
  build has no runtime. The lock is not bumped here because
  `scripts/provision_targeted_ms1_runtime.py` refuses any wheel set that differs from
  it, and the provisioned manifest's SHA-256 is pinned in the application
  (`recipe::RUNTIME_MANIFEST_SHA256`). Bumping it means re-provisioning the runtime
  and pinning a new digest, which makes stored plans `PlanNotCurrent`. The fixed wheel
  is `pillow-13.0.0-cp313-cp313-win_amd64.whl`, SHA-256
  `9dda0788a9932776a75d8bcc020076edc308ce2508b51f6739a45e3158b3fc42` (PyPI),
  uploaded 2026-10-16. Proposed dismissal until that re-provisioning:
  `not_used`.
