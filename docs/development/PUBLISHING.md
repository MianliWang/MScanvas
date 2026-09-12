# Repository and publishing workflow

The canonical repository is the GitHub repository
[`MianliWang/MScanvas`](https://github.com/MianliWang/MScanvas). Its default branch is
`main`. Live API inspection on 2026-09-12 reports **public** visibility,
superseding the earlier private-repository description. M7.0 changes no visibility.

## Clone the repository

```powershell
git clone https://github.com/MianliWang/MScanvas.git
cd MScanvas
```

Writing requires an authenticated GitHub account with repository access.
Public source visibility does not authorize distributing a beta binary.

## Normal contribution flow

Do not develop directly on `main` once branch protection is enabled.

```powershell
git switch main
git pull --ff-only
git switch -c feature/<short-description>
# make and validate changes
git push -u origin HEAD
```

Open a pull request against `main` and include the checks actually run, UX evidence
for user-facing changes and any remaining unverified assumptions.

## Reproduce the verified bootstrap

On a Windows development machine with Node, pnpm and Rust available:

```powershell
./scripts/bootstrap.ps1
```

The script installs the repository's exact pnpm and Rust toolchain versions, requires
the committed lockfiles, uses frozen/locked dependency resolution and stops on the
first failed native command. It does not regenerate lockfiles during normal setup.
Record newly completed desktop or backend spikes in `BOOTSTRAP_STATUS.md`; do not
infer a runtime result from a successful build.

## Repository protection

On 2026-09-12, effective `main` ruleset **19660027** requires PRs, resolved
review threads and strict up-to-date Frontend/Rust/Repository quality checks,
and prevents deletion/non-fast-forward updates. The classic branch-protection
endpoint returns 404; effective rules must be read from the rulesets API.
Rebind live conditions for each publication. Normal task publication must not
use an administrator bypass.

The original bootstrap protection policy was:

- require pull requests for `main`;
- require the Frontend, Rust and Repository quality checks;
- require branches to be up to date before merge;
- disallow force pushes and branch deletion;
- retain administrator bypass only for emergency recovery.

## Release publishing

There is no supported binary release yet.
[ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md)
is the authoritative first Windows x64 beta route. M7.6 owns an actual installer,
clean standard-user install/launch/uninstall evidence, production configuration,
version/changelog, hashes/source/build-input provenance, notices, lawful samples,
vendor distribution boundary, diagnostics/feedback and rollback evidence. Its
external-decision table names the owner and deadlines for Windows support,
signing or an explicitly approved unsigned posture, host/audience, samples and
actual release consent.

M7.0 is Markdown-only route publication: no build, signing access, tag, upload,
dependency installation or distribution is authorized. M7.1 and later need
their own implementation authority. A beta-release-ready candidate is not a
published beta; actual distribution requires consent for its exact artifacts.
No automatic updater or cloud telemetry is required. Do not publish npm
packages, Cargo crates or a GitHub Release from this planning task.
