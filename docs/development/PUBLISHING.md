# Repository and publishing workflow

The canonical repository is the private GitHub repository
[`MianliWang/MScanvas`](https://github.com/MianliWang/MScanvas). Its default branch is
`main`.

## Clone the repository

```powershell
git clone https://github.com/MianliWang/MScanvas.git
cd MScanvas
```

An authenticated GitHub account with repository access is required while the
repository remains private.

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

## First verified bootstrap

On a Windows development machine with Node, pnpm and Rust available:

```powershell
./scripts/bootstrap.ps1
```

Review and commit the generated `pnpm-lock.yaml` and `Cargo.lock`, then update
`BOOTSTRAP_STATUS.md` with the checks and desktop/backend spikes that were actually
verified.

## Repository protection

After the first fully green CI run:

- require pull requests for `main`;
- require the Frontend, Rust and Repository quality checks;
- require branches to be up to date before merge;
- disallow force pushes and branch deletion;
- retain administrator bypass only for emergency recovery.

## Release publishing

There is no supported binary release yet. Do not publish npm packages, Cargo crates or
GitHub Releases from the bootstrap skeleton. A release workflow must first define:

- versioning and changelog policy;
- Windows signing and artifact provenance;
- third-party and vendor-license review;
- reproducible build inputs;
- release smoke tests and rollback procedures.
