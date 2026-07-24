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
