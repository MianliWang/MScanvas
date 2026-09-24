# M8/M9 source integration — the candidate and how it would be published

Date: 2026-09-24. Branch `feat/m8-m9-source-integration-qualification`, from
the M9 closure head `46ef9cc441b3c014aa4964976db917ecb68008c4`.

This record prepares **one** source-integration candidate for the linear stack
that follows published `main`: a partial M7.6, M8 and M9. It changes no
product code. It does not publish anything: no push, pull request, merge, tag
or release was made under it, and publication needs its own explicit
authorization. When this text is read on `main`, the merge commit that brought
it there — not this text — is the evidence that the stack was published.

Status when written:

- `SOURCE UNPUBLISHED`
- `M8 LOCAL IMPLEMENTATION COMPLETE`
- `M9 LOCAL IMPLEMENTATION COMPLETE`
- `M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE`
- `PROTEOWIZARD HOLD UNCHANGED`
- `ROUTE B NOT AUTHORIZED / NOT EXECUTED`
- `PUBLIC BETA NOT RELEASED; M10 NOT STARTED`

## 1. Identities

| Role | Commit | Tree |
| --- | --- | --- |
| Published base: `main` = `origin/main` (and `git ls-remote origin refs/heads/main`) | `1daf802f06d0149b5de3dbd12e8b01e7e86862ec` | — |
| M9 closure, final tested code | `fa7f213b181e9e5ecb7e164f3b128b2da631c7a9` | `56e85d1bcfe4999eeda53290e81f292e1196eb05` |
| M9 closure head (documentation-only successor of the above) — this branch's start | `46ef9cc441b3c014aa4964976db917ecb68008c4` | `3f40009c72fd8c8d14712db4502f6d41d1b97a33` |
| Integration candidate: the commit that adds this record | see §8 | see §8 |

The candidate cannot name itself. §8 names it, with the gates that ran on it,
in a documentation-only successor that changes this file alone.

## 2. The stack

Derived from Git, not from earlier records: `git rev-list --left-right --count
main...46ef9cc` is `0 107`, `git rev-list --merges main..46ef9cc` is empty, and
the merge base is `main` itself. The stack is strictly linear, 107 commits
ahead and none behind; this record's own commits come on top of it.

| Positions | Range (oldest first) | Commits | Phase |
| ---: | --- | ---: | --- |
| 1–13 | `8b9f3b4` … `fe3d202` | 13 | partial M7.6 (§3) |
| 14 | `aa3fc83` | 1 | M8.0 planning: `docs/ux/M8_0_V511_GAP_ASSESSMENT.md` and the start of `docs/product/M8_1_FIRST_CLOSED_LOOP.md` |
| 15–48 | `153339f` … `97392e9` | 34 | M8.1–M8.5 and the M8 closure |
| 49–63 | `d4165b9` … `1652aff` | 15 | M9.0 route study |
| 64–71 | `a34e2b1` … `96f2d8c` | 8 | M9.1 |
| 72–78 | `a1c56f5` … `d1d9f58` | 7 | M9.2 |
| 79–90 | `9c09395` … `3d6300f` | 12 | M9.3 and M9.3.C1 |
| 91–101 | `6983840` … `13a3560` | 11 | M9.4 |
| 102–107 | `59cbf1c` … `46ef9cc` | 6 | M9 closure |

Phase boundaries were read from each commit's subject and files, not from
branch names. The local branch `feat/m7.6-installer-release-integration` points
at `aa3fc8346baacb7563d5aea87e431da74546596b`, which is M8.0 planning; the last
M7.6 commit is its parent `fe3d202`. Every local task branch head —
`feat/m7.6…` `aa3fc83`, `feat/m8.1…` `f751b9e`, `feat/m8.2…` `399a3ef`,
`feat/m8.3…` `47e20b7`, `feat/m8.4…` `d60d301`, `feat/m8.5…` `3e6b656`,
`feat/m8-closure` `97392e9`, `feat/m9.0…` `1652aff`, `feat/m9.1…` `96f2d8c`,
`feat/m9.2…` `d1d9f58`, `feat/m9.3…` `3d6300f`, `feat/m9.4…` `13a3560`,
`feat/m9-closure` `46ef9cc` — is an ancestor of the candidate and was not
moved. None has an upstream.

## 3. What the partial M7.6 commits publish

`git diff --name-status 1daf802 fe3d202`:

| Status | File |
| --- | --- |
| M | `CHANGELOG.md` |
| M | `THIRD_PARTY_NOTICES.md` |
| M | `apps/desktop/src-tauri/tauri.conf.json` — the `bundle` section only: NSIS target, `Productivity` category, publisher, homepage, copyright, licence file, notices and licence as resources, embedded WebView2 bootstrapper, per-user NSIS in English and Simplified Chinese |
| A | `docs/ux/M7_6_INSTALLER_RELEASE_INTEGRATION.md` |
| A | `scripts/build_candidate.ps1` |
| A | `scripts/generate_notices.py` |
| A | `scripts/inspect_candidate.ps1` |
| A | `scripts/verify_installed_payload.py` |

No application source, no test, no manifest and no lock file. No CI job runs
the bundler: the only desktop-build workflow, `windows-smoke.yml`, is manually
dispatched and passes `--no-bundle`. The Rust job's cargo builds do run
`tauri-build`, which copies `bundle.resources` (the licence and the notices)
into the target directory and embeds `bundle.publisher` and `bundle.copyright`
in the Windows version resource of every binary it builds. On the candidate,
`python -B scripts/generate_notices.py --check` exits 0: the generated notices
still match the dependency graph M8 and M9 left.

**Would integrating these commits make `main` read as release-qualified?**
Before this candidate, in two places:

- `CHANGELOG.md` opened its unreleased section with *MSCanvas is packaged as an
  ordinary Windows installer* and said *The first beta is unsigned*, as though
  a beta existed. The body did say nothing had been installed yet.
- The M7.6 record's status line said *implementation and preparation in
  progress*, which is no longer what happened: the slice stopped and its
  qualification was deferred.

Both are corrected (§4); the CHANGELOG entry's present-tense check of the
packaged build is also scoped to the M7.6 candidate build it ran on.
`THIRD_PARTY_NOTICES.md` also speaks of *what the installer actually carries*
in the present tense; that states the inventory's scope, not a release, and
the file is generated, so it is left as it is. The history is not rewritten:
the thirteen commits stay as they are, and integrating any M8 or M9 commit
publishes them.

## 4. Current-state documents reconciled

Checked against the canonical [M9 closure](../product/M9_CLOSURE.md). Wording
that would expire at the merge — *locally*, *unpublished*, *not yet
published*, *not source-integrated* — was replaced in current-state text by
what stays true (implemented; in no installer or release), and the Git state is
left to this record.

| File | Change |
| --- | --- |
| `README.md` | the status block names M8/M9; a new section, *Beyond the published M7.5 product*, states the projects, the bounded experimental targeted-MS1 recipe and its development-only runtime, the partial M7.6 and the named test debt; the *not implemented* list no longer denies the stored-result exports and says what a project does not restore; *Analysis is deferred* is narrowed; *What is next* no longer names M6; repository status, prerequisites and map updated |
| `CHANGELOG.md` | M8 and M9 entries; the M7.6 entry says an unqualified candidate, not a release, scopes its packaged-build check to the M7.6 candidate build, and says no installer or public beta exists |
| `ROADMAP.md` | M7, M8 and M9 status lines and *After M9* |
| `BOOTSTRAP_STATUS.md` | the current-route paragraph, including the named test debt |
| `PROJECT_PROPOSAL.md` | §18 status sentences for M7.6, M8 and M9 |
| `docs/product/FEATURE_CATALOG.md` | VIEW-008, the *Projects* introduction and ANA-004 |
| `docs/ux/M7_6_INSTALLER_RELEASE_INTEGRATION.md` | the status line only: partial and deferred |
| `docs/product/M9_CLOSURE.md` | *at this closure* and forward pointers to this record in §1, §11 and §14; nothing else |

`docs/product/PRIMARY_WORKFLOWS.md` and `docs/product/SCREEN_MODEL.md` were
checked and needed nothing. Slice records, ADRs and evidence documents are
history and were not changed.

## 5. Dependencies and locks

- `git diff --stat 1daf802 46ef9cc --` every `Cargo.toml`, `Cargo.lock`, every
  `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `rust-toolchain.toml` and `.node-version`: `Cargo.lock` +1 and
  `apps/desktop/src-tauri/Cargo.toml` +5 — M8.1's direct `uuid` edge on the
  desktop crate (`57f4214`), already in the locked graph through
  `mscanvas-core`. No package is added and no version changes.
- `git diff --quiet 97392e9 46ef9cc --` the same files exits 0: **M9 added,
  removed or updated no production dependency.**
- The stack adds `experiments/m9_0/runtime/requirements-cp313-win_amd64.lock.txt`,
  a hash lock that says of itself *Not a production dependency; never installed
  into the application*. It is read only by the M9.0 experiment instructions and
  by `scripts/provision_targeted_ms1_runtime.py`. The Python, pyOpenMS and
  OpenMS runtime is development-only: not a package-manager dependency of the
  application, not bundled, not in any release build, and not qualified for
  redistribution.
- This candidate installs, upgrades or refreshes nothing.

## 6. Test debt that travels with the candidate

Proposed disposition: **publish it as named debt**, not hidden and not called
green. The owner decides at publication.

- **The repository-wide browser suite is red, identically to published
  `main`.** From the M9 closure's test-by-test comparison
  ([evidence §8](../spikes/M9_CLOSURE_EVIDENCE.md#8-the-repository-wide-browser-suite)):
  of the 317 tests in the 21 spec files that published `main` (tree of
  `1daf802`) and the closure code (`59cbf1c`; the m4.1, m4.3 and m4.4 results
  from `d8310ce`, because their WebDriver sessions failed to open in the
  `59cbf1c` run) share, **174 fail on each side and
  0 differ**; the 7 M8/M9 spec files (36 tests) pass. The failing specs are
  legacy M4–M7 and viewer-r1 specs; two families are obsolete selectors
  confirmed statically. The final closure code differs from `59cbf1c` only in
  Rust files, a Rust fixture and four e2e files whose specs were run again on it.
  This candidate changes no code, so the comparison still describes it. The
  whole suite was not run again for this record.
- **One App-level Vitest case can time out under load**:
  `M73Viewer.test.tsx > … exports only committed axis ranges while drawing or
  pending, then the newly confirmed range from retained tokens`, 5,000 ms limit;
  it failed the whole `pnpm test` in two of the M9 closure's four campaigns
  (5,065 and 5,103 ms) and in the M8.5 record (5,023 ms; M8.4 recorded two
  unnamed timeouts in the same file), and passed alone every time it was run
  alone. The frontend source is unchanged since M9.4.
- **The browser harness can fail to open a WebDriver session** for a spec (no
  test result in that run).

## 7. Publication risks to watch

None is changed here; each is for the owner and the publication run.

- **Publishing starts schema 4's compatibility promise.** The project document
  schema is an unpublished development schema whose promise begins only when
  this source line is published
  ([M9 closure §4](../product/M9_CLOSURE.md#4-schema-4--the-canonical-disposition));
  earlier M9 development builds are not compatible with each other. Authorizing
  the merge is also that decision.
- **The Frontend check runs `pnpm test` on `ubuntu-latest`** and is required by
  the `main` ruleset. The timeout in §6 could fail it. A failed required check
  is recorded as it happened; whether to re-run a job is the owner's call, and
  both results are kept.
- **CI will be the first run of M8/M9 code without the development runtime.**
  The Rust check runs `cargo test --locked --workspace --all-targets` on
  `windows-latest`, where `.tmp/m91-runtime/` does not exist. Every test that
  launches the runtime is `#[ignore]`d, and the only runtime-presence probe
  (`targeted_ms1::runtime_present`) is called from a Tauri command, not from a
  test. That is a static reading; no local run hid the runtime.

## 8. Validation

Pending when the candidate was committed; recorded here by a
documentation-only successor.

## 9. Review

Pending; recorded with §8.

## 10. Proposed publication procedure — not authorized, not executed

To be carried out only under a separate, explicit authorization for this exact
candidate:

1. **Rebind live state.** `git ls-remote origin refs/heads/main` still
   `1daf802f06d0149b5de3dbd12e8b01e7e86862ec`; the effective `main` ruleset read
   from the rulesets API ([PUBLISHING.md](PUBLISHING.md)); the repository's
   *automatically delete head branches* setting, which would delete the remote
   branch at merge without step 8's consent; the local branch head equals the
   candidate's documentation successor named in §8, whose diff from the
   candidate is this file alone.
2. **Push the branch as it is**, without force, and open one pull request:
   base `main`, head this branch. Its body names the candidate commit and
   tree, the evidence in §8, the debt in §6 and the risks in §7, and states that
   no release, installer or public beta follows from it.
3. **Let the required checks run on the exact head** and record their results
   as they are.
4. **Merge with a merge commit (a true merge), bound to the reviewed head** —
   for example `gh pr merge <number> --merge --match-head-commit <head sha>`, or
   the merge API's `sha` parameter — so that a head that moved is refused rather
   than merged. No squash, no rebase merge, no cherry-pick, no force push, no
   administrator bypass. Verify afterwards: first
   parent = the `main` it merged into, second parent = the branch head; while
   `main` has not moved since `1daf802`, the merge commit's tree equals the
   branch head's tree.
5. **If `main` has moved before the merge**, the branch is brought up to date by
   a true merge of `main` into it — never a rebase — which makes a new candidate
   identity whose affected gates run again before it is published.
6. **Natural-main CI** on the merge commit, recorded by identity.
7. **Local synchronisation**: `git switch main` then `git pull --ff-only`, and
   check that local `main` equals the merge commit.
8. **Branch deletion only after inclusion is verified**:
   `git merge-base --is-ancestor <branch head> origin/main` for each branch to
   be deleted, remote or local, and only with the owner's consent. Until then
   every task branch stays.

After a successful publication the first status above becomes the Git fact
that the merge records; the other six are unchanged by it.
