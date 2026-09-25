# M8/M9 source integration — the candidate and how it would be published

Date: 2026-09-24. Branch `feat/m8-m9-source-integration-qualification`, from
the M9 closure head `46ef9cc441b3c014aa4964976db917ecb68008c4`.

This record prepares **one** source-integration candidate for the linear stack
that follows published `main`: a partial M7.6, M8 and M9. The only product
code it changes is two focus-restoration repairs on the Project surface, found
while qualifying it (§11); the only other code is two build-provenance repairs
to the partial M7.6 candidate script, found by the review of the pull request
that publishes it (§12). Publication goes through pull request #127 under the
owner's explicit authorization, and no tag, release, installer or public beta
follows from it. When this text is read on `main`, the merge commit that
brought it there — not this text — is the evidence that the stack was
published.

Status when written:

- `SOURCE INTEGRATION CANDIDATE QUALIFIED LOCALLY` (§8), with the build-provenance repair checked on its own (§12)
- `SOURCE PUSHED — PR #127 OPEN / NOT MERGED`
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
| First candidate: the commit that added this record | `896e0121b0ba533781e5039585cfe30eef5be426` | `2d8f3770ebf9877b09fd50fdbc35d04b471f233c` |
| Second candidate: the review's fixes (§9); superseded | `d8192d5178e81b8cf220578d105393c0f87fb8ea` | `8e738463b770f4429a1e94466d72cdb514ea01ba` |
| Documentation successor of the second (§8, §9) | `a278f5748941e34c7da08d8d341dad99a84e0d53` | `52c93ab562ec6fc53bde4346a0e782a98f30b233` |
| Removal-focus repair (§11); superseded | `7b9400ec178912855ddb381b09aa22bf78cdcc4a` | `531a56c3ee625a23f9deda537e1a1daa47177559` |
| QC-capture focus repair (§11); superseded by a comment | `f393a7bb98c70499e91781cecbbee02efea66757` | `7561307ad27e1d2a83a24480cb92daa02316776d` |
| **Integration candidate**: the same, one comment corrected (§11) | `7cbc7f01f0836eab3d8919825832efb6a3ad6aff` | `5827cb0e210c7844314e967d2c4e26387346d84b` |
| Documentation successor that recorded §8's runs; first head of PR #127, superseded | `8be2cac586acc74e711ef2c27dbb34d20f8488b7` | `76e1c1cd926b4f75f2d345c6a41377c4132641f1` |
| Build-provenance repair (§12), as first written; superseded | `b1e125fc510340e04542b686b3b9b6e618d357b1` | `d47220e8f3177a2637f6dca66fbd2c8e9a92a860` |
| **Build-provenance repair** after its review (§12): the script and its test | `5a2b1887c307493c71d1c9c7a64b6318e63afe6a` | `c15f4b703890e83e1e0eff3d921e8c0121a31568` |

A candidate cannot name itself; documentation-only successors, which change
Markdown alone, record what ran on it. The first two candidates change only
Markdown: `git diff --name-only fa7f213 d8192d5` lists no file that is not
`.md`. The integration candidate adds exactly four frontend files to that:
`git diff --name-only a278f57 7cbc7f0` is `ProjectPanel.tsx`,
`ProjectLayers.test.tsx` and `ProjectQcSummary.test.tsx` under
`apps/desktop/src/features/project/`, and `apps/desktop/src/test/projectFixtures.ts`.
No Rust, runtime, manifest, lock or Rust fixture changes, so every such byte is
still the M9 closure's final tested code. The build-provenance repair then
changes exactly `scripts/build_candidate.ps1` and adds
`scripts/test_build_candidate.py` (`git diff --name-only 8be2cac 5a2b188`);
nothing §8's groups build, test or read changes (§12). The publication head is
a Markdown-only successor of `5a2b188`.

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
history and were not rewritten; the one addition is a marked correction after
the M9.1 evidence's paragraph on earlier runs, pointing to §11.

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
  This candidate's only code change is two focus effects on the Project surface
  and their tests (§11), and no failing legacy spec is a Project-surface test
  (evidence §8), so the comparison still describes the legacy debt. The whole
  suite was not run again for this record.
- **One App-level Vitest case can time out under load**:
  `M73Viewer.test.tsx > … exports only committed axis ranges while drawing or
  pending, then the newly confirmed range from retained tokens`, 5,000 ms limit;
  it failed the whole `pnpm test` in two of the M9 closure's four campaigns
  (5,065 and 5,103 ms) and in the M8.5 record (5,023 ms; M8.4 recorded two
  unnamed timeouts in the same file), and passed alone every time it was run
  alone. Neither that test nor the viewer code it exercises is changed by this
  candidate, and it passed in the whole-suite run that qualified it (§8); it
  stays named because it has failed under load before. It is the only
  intermittent Vitest case this record names: the
  `ProjectLayers.test.tsx` failure seen during this qualification was a
  production focus race, repaired, not debt (§11).
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

**Qualification of the integration candidate is complete: Groups B, C and D
ran on it with every exit 0, and Group A is inherited.** Groups B and C ran on
`4b6cf29` (tree `9a5260a…`), whose only difference from the integration
candidate `7cbc7f0` is two Markdown files (`git diff --name-only 7cbc7f0
4b6cf29`); Group D ran there too. Logs are under
`.tmp/m8-m9-integration-evidence/` (git-ignored); every exit below is the
command's own. The build-provenance repair of §12 changes none of these groups'
inputs, so their results stand for it; none was run again for it, and its own
checks are in §12.

**Memory policy.** Measured from `Win32_OperatingSystem`. A heavy group is
admitted only when free physical memory is at least 8 GiB (8,388,608 KiB) and
use is at most 80%. Once admitted it is not stopped for crossing that line;
before each later command or spec memory is recorded, and the next one is not
started if free memory is below 4 GiB or use is 90% or more. Before each
browser spec the previous spec's WDIO, Vite, ChromeDriver and headless Chrome
must have exited; the runner waits for them and never ends a process. Nothing
on the host was stopped or reconfigured to make room. These are scheduling
thresholds, not product requirements.

| Measured (local time, -04:00) | Free of 31.67 GiB | In use | Gate | Before |
| --- | ---: | ---: | --- | --- |
| 2026-09-24 18:11:26 | 3.50 GiB | 89.0% | deferred | Group A on `896e012` |
| 2026-09-24 18:25:03 | 4.50 GiB | 85.8% | deferred | Group A on `d8192d5` |
| 2026-09-24 18:43:56 | 9.99 GiB | 68.5% | admitted | Group A on `a278f57`; every later command of Groups A and B there read 9.60–9.92 GiB |
| 2026-09-24 18:54:36 | 9.33 GiB | 70.5% | admitted | Group C on `a278f57`, m8.1 |
| 2026-09-24 18:54:53, 18:55:19, 18:58:33 | 7.24, 7.87, 7.27 GiB | 75.2–77.1% | deferred | m8.2 on `a278f57` (then gated per command) |
| 2026-09-24 20:43:57 to 21:57:26 (four readings) | 5.29–6.54 GiB | 79.4–83.3% | deferred | only single-file and serial project-folder tests ran (§11) |
| 2026-09-24 22:13:52, 22:27:53, 23:19:50 | 6.58, 5.78, 6.64 GiB | 79.2%, 81.8%, 79.0% | deferred | Group B on the integration candidate |
| 2026-09-25 02:21:31 | 12.76 GiB | 59.7% | admitted | Group B; later commands read 12.80–12.92 GiB |
| 2026-09-25 02:23:14 | 12.84 GiB | 59.4% | admitted | Group C; later specs read 12.80–12.84 GiB |

**On the integration candidate's code** (`4b6cf29`):

| Group | Command | Exit | Result |
| --- | --- | ---: | --- |
| B | `pnpm lint` | 0 | |
| B | `pnpm typecheck` | 0 | |
| B | `pnpm test` | 0 | 106 files, 2170 of 2170 (the 2168 of the M9 closure and the two window tests of §11), 65.4 s; the M7.3 case of §6 passed in this run |
| B | `pnpm build` | 0 | the chunk-size warning only |
| B | `pnpm e2e:typecheck` | 0 | |
| C | `pnpm exec wdio run ./e2e/wdio.browser.conf.ts --spec ./e2e/specs/m8.1-project-records.browser.e2e.ts` | 0 | 8 passing |
| C | the same, `m8.2-provenance` | 0 | 4 passing |
| C | the same, `m8.3-reattachment` | 0 | 2 passing |
| C | the same, `m8.4-layers` | 0 | 2 passing |
| C | the same, `m8.5-qc-summary` | 0 | 3 passing |
| C | the same, `m9.1-targeted-ms1` | 0 | 12 passing |
| C | the same, `m9.4-targeted-ms1-batch` | 0 | 5 passing |
| D | `git diff --stat 1daf802 7cbc7f0 --` every tracked manifest and lock | 0 | exactly §5's three files |
| D | `git diff --quiet 97392e9 7cbc7f0 --` the production manifests and locks | 0 | no change in M9 or after |
| D | `git diff --quiet a278f57 7cbc7f0 --` every tracked manifest and lock | 0 | the two focus repairs changed none |
| D | `python -B scripts/check_repo.py` | 0 | |

No browser spec lost its WebDriver session, and none waited for a previous
spec's processes. The repository-wide browser suite was not run (§6).

**Group A, inherited from `a278f57`** (tree `52c93ab…`; its code is
`d8192d5`'s, which is `fa7f213`'s). `git diff --name-only a278f57 7cbc7f0`
changes no Rust, runtime, manifest, lock or Rust fixture (§1), so these stand
for the integration candidate:

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test --locked --workspace --all-targets` | 0 | desktop 1233 passed, 47 ignored; plot-spec 135; proteowizard 513 passed, 9 ignored, plus 1 in its second test binary; core 2; examples and tests pass |
| `cargo test --locked -p mscanvas-desktop --lib targeted_ms1` | 0 | 86 passed, 33 ignored |
| `cargo test --locked -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1 --nocapture` | 0 | 33 passed, 102.8 s: the real-runtime suite |
| `cargo check --locked --release --workspace` | 0 | |

The first invocation of Group A ran only its first two commands: the runner fed
its command list on the same standard input the commands inherited, and `cargo
test` consumed the rest. The last three ran in a second invocation with their
own readings; the first two were not run again.

**Superseded runs on `a278f57`**, kept as they happened: Group B there exited
0 for lint, typecheck, build and `e2e:typecheck` and **1** for `pnpm test`
(2167 of 2168; the one failure was the focus race of §11, not the M7.3 case,
which passed); Group C ran m8.1 only (exit 0, 8 passing) before its memory gate
deferred the rest; Group D (exit 0) ran there and again on `f393a7b`.

**Earlier light gates** (before any heavy group):

| Command | On | Exit |
| --- | --- | ---: |
| `python -B scripts/check_repo.py` | `46ef9cc` (baseline) | 0 |
| `python -B scripts/check_repo.py` | the content of `896e012`, before it was committed | 0 |
| `python -B scripts/check_repo.py` | the content of `d8192d5`, before it was committed | 0 |
| `git diff --stat 1daf802 896e012 --` every tracked manifest and lock | `896e012` | 0 — as §5 |
| `git diff --quiet 97392e9 896e012 --` and `git diff --quiet 46ef9cc 896e012 --` the same files | `896e012` | 0, 0 |
| `cargo fmt --all --check` | `896e012` | 0 |
| `python -B scripts/generate_notices.py --check` | `896e012` | 0 |

## 9. Review

One isolated, read-only review of `896e012`, after the light gates and while
no suite ran. It was forbidden to write files, build, test or use the network,
and did none of them. Scope: source-state truthfulness, the partial-M7.6
ancestry, README and current documents, release claims, dependencies,
validation attribution, test-debt wording, the publication procedure and
history preservation; the scientific M9 review was not reopened.

**Verdict: no blocker to source-integration candidacy.** It verified the
stack shape, every range and count in §2, every branch head, the partial-M7.6
file list, the dependency claims, the browser-debt and timeout numbers, the
static runtime reading in §7, the tree-equality claim in §10 and that no
current document materially contradicts the M9 closure. It could not check the
`git ls-remote` reading, having no network.

| Finding | Class | Disposition in `d8192d5` |
| --- | --- | --- |
| Publishing starts schema 4's compatibility promise, and §7 did not say so | should-fix | added to §7 |
| M9 closure §1: *Nothing here is source-integrated…* would read false on `main` | should-fix | *at this closure* and a pointer here |
| README called M7.5 *the newest published slice* | should-fix | *the last slice published before the M8/M9 stack* |
| README's next steps listed source integration, which is false after the merge | should-fix | the list now starts once the stack is integrated |
| README and `BOOTSTRAP_STATUS.md` compared the debt with *published `main`*, which is the stack itself after the merge | should-fix | compared with `1daf802` |
| §3 said the bundle section is never constructed in CI; the Rust job's `tauri-build` copies `bundle.resources` and embeds `publisher` and `copyright` | should-fix | §3 says exactly what CI does; the notices check was run and added |
| The CHANGELOG's QA-string check read as true of the current packaged build | should-fix | scoped to the M7.6 candidate build, and says no later build was packaged |
| §10 did not bind the merge to the reviewed head, and a repository setting could delete the branch at merge | should-fix | step 4 binds the head; step 1 rebinds the setting |
| The timeout was credited to the M8.4 record; only M8.5 names the case | nit | corrected |
| `59cbf1c` stood for the closure side, where m4.1/m4.3/m4.4 came from `d8310ce` | nit | corrected |
| `THIRD_PARTY_NOTICES.md` also speaks of *the installer* in the present tense | nit | acknowledged in §3; the generated file is unchanged |
| README undersold the stored-result exports; omitted `experiments/m9_1/`; *shipped notices* in `ROADMAP.md` and `PROJECT_PROPOSAL.md` | nit | corrected |

The review also noted that `check_repo.py` checks no anchor fragment and does
not read the edited status paragraphs, so a passing run proves little about
them. The reviewer resolved every anchor the first candidate added, and the
two added since (§7, §8) were resolved the same way. No second review ran: every fix
applies a finding's own correction and changes only Markdown. The two code
repairs found later had reviews of their own (§11).

## 10. Publication procedure

Carried out through pull request #127 under the owner's explicit
authorization — first for the head that recorded §8's runs, and then, on a
second authorization, for the build-provenance repair of §12 and its
documentation successor:

1. **Rebind live state.** `git ls-remote origin refs/heads/main` still
   `1daf802f06d0149b5de3dbd12e8b01e7e86862ec`; the effective `main` ruleset read
   from the rulesets API ([PUBLISHING.md](PUBLISHING.md)); the repository's
   *automatically delete head branches* setting, which would delete the remote
   branch at merge without step 8's consent; and the branch head is the
   integration candidate named in §1 or a documentation-only successor of it
   whose diff from it (`git diff --name-only`) is Markdown alone — or, for the
   second authorization, the build-provenance repair of §12 and a Markdown-only
   successor of it. A head with any other change is a new candidate that §8
   does not qualify, and it is not published until its affected groups have
   run.
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

After a successful publication the second status above is superseded by the
Git fact the merge records; the others are unchanged by it.

## 11. Found during qualification: two focus races on the Project surface

**What was seen.** Group B's `pnpm test` on `a278f57` exited 1, 2167 of 2168:
`ProjectLayers.test.tsx > the layer list > removes a layer through its own
control, and names the refusal a reference with one gets`, 4,137 ms,
`AssertionError: expected null to be '11111111-2222-4111-8111-111111111111'`
at the wait for focus to reach the reference's Create layer control after a
removal. The file then passed 23 of 23 three times alone (that case 110, 127
and 112 ms).

**Corrections to what was said about it.** The wait is not about one second:
`apps/desktop/src/test/setup.ts` sets `asyncUtilTimeout` to 4,000 ms (since
`73eec7e`, already on published `main`). So the case spent about 137 ms
reaching the wait at normal speed, and focus then never arrived in 4 s; it was
not slowness. The first qualification report called the wait one second and
the failure load-dependent debt; both were wrong. The M9.1 evidence's earlier
occurrence ([M9.1 evidence](../spikes/M9_1_TARGETED_MS1_VERTICAL_EVIDENCE.md),
the paragraph on earlier runs) says "one-second focus wait" and attributes the
failure to a second Vitest process; the wait was the same 4 s, and the cause is
the one below. That record is left as written, with a pointer here.

**Cause.** A production race, not debt. The Remove control arms focus
restoration in its click handler (`ProjectPanel.tsx`, the `removing` ref), and
a passive effect spent the arm on its first run that saw an idle surface. React
19 runs the passive effects of a commit made outside an event (every answer
that settles an operation, and the first arrival of a project) in a later
Scheduler task. A press that lands before that task arms the ref; React then
flushes the pending effects before rendering the press, so the earlier
commit's run sees its own idle state with the layer still listed, spends the
arm and returns. The answer finds nothing armed and focus stays on the body.
In the test, `ready()` is `findByText`, which returns after a zero-delay timer
that usually, not always, runs after that Scheduler task; `ee229cf` removed an
empty `act` from `ready()` that had ordered the flush first.

**Evidence.** A read-only trace from four independent lenses converged on this
one mechanism, which three adversarial reviewers could not refute; every
alternative was excluded by the code or by the failure's DOM dump. A temporary
diagnostic test, deleted afterwards, then measured it,
recording when the arrival commit's passive effects ran against the press:

| Case | On the old effect | On the repaired effect |
| --- | --- | --- |
| The original path | effects before the press; focus restored | focus restored |
| Press in the MutationObserver delivery of the arrival commit | effects after the press; focus lost to the body | focus restored |
| The original path with the zero-delay timer landing after a millisecond boundary | effects after the press; focus lost to the body | focus restored |
| The same plus one `setImmediate` before the press | effects before the press; focus restored | focus restored |

The dump of the recorded failure holds no `activeElement`, so that this exact
run took this path is inferred; the new test reproduces its assertion exactly.

**Repair 1, `7b9400e`.** The removal effect is a layout effect, so it runs in
the commit it belongs to and no earlier commit can spend a later press's arm.
New test, `ProjectLayers.test.tsx`: *restores focus after a removal pressed the
instant the project arrives*, which presses in the MutationObserver delivery of
the arrival commit (`appears()`, now in `src/test/projectFixtures.ts`). On the
old effect it failed with the recorded assertion (`expected null to be
'11111111-…'`, 4,227 ms); on the new one it passes.

**Repair 2, `f393a7b` (comment corrected in `7cbc7f0`).** The review of repair
1 named the QC-capture focus effect as the same shape. It was established on
its own before it was changed: *takes the keyboard to the report of a capture
pressed the instant its layer appears* (`ProjectQcSummary.test.tsx`) presses
Capture QC in the MutationObserver delivery of the commit that settles Create
layer. On the old effect focus stayed on the Capture QC control for the full
4 s with the report on screen (4,149 ms); on the old effect with one
`setImmediate` before the press it passed, which names the pending passive
flush as the cause; on the layout effect it passes.

**Focused validation, bounded, with host memory below the heavy gate**
(`--no-file-parallelism` wherever more than one file ran):

| Command | On | Exit |
| --- | --- | ---: |
| `ProjectLayers.test.tsx`, verbose | `7b9400e`'s content | 0 (24 of 24) |
| `src/features/project` | `7b9400e`'s content | 0 (9 files, 174) |
| `pnpm typecheck`; `ProjectLayers.test.tsx` twice more | `7b9400e`'s content | 0; 0, 0 |
| `ProjectQcSummary.test.tsx` and `ProjectLayers.test.tsx` | `f393a7b`'s content | 0 (39 of 39) |
| `src/features/project` | `f393a7b`'s content | 0 (9 files, 175) |
| `pnpm typecheck` | `f393a7b`'s content | 0 |
| the two window tests again | `f393a7b`'s content | 0 (2 of 2) |

The whole `pnpm test` then ran as Group B on the integration candidate: 2170
of 2170, both window tests included (§8).

**Reviews.** Each repair had a read-only adversarial review that ran no test.
The first confirmed the QC-capture sibling (four of four skeptics could not
refute it) and raised a coverage note that both skeptics refuted as describing
no reachable defect. The second found no problem; its one observation, that
focus now moves before the report scrolls itself into view, is the comment
`7cbc7f0` corrects. No other focus effect was changed or reviewed here.

## 12. Found at publication: two build-provenance repairs (PR #127)

**What was found.** After the required checks had passed on `8be2cac`, the
repository's automated review left two findings on PR #127, both on
`scripts/build_candidate.ps1`, the partial M7.6 candidate build script, and
both confirmed by reading it:

- A normal build read `apps/desktop/dist` before `pnpm tauri build` ran, but
  that command's `beforeBuildCommand` (`pnpm build`) regenerates the directory,
  so the manifest's `frontendInputs` was empty on a clean checkout and stale
  otherwise — never the frontend the build produced.
- `-ManifestOnly` compared the retained manifest's `head` with HEAD only when a
  retained manifest existed. Without one it wrote a new manifest that
  attributed whatever was in `target/release` to HEAD.

Neither path is reached by CI or by any test of §8; both apply only when an
installer candidate is built.

**Repair.** `b1e125f`, then `5a2b188` after the review below:

- A normal build reads the frontend only after `pnpm tauri build` has
  succeeded, and refuses a missing or empty `apps/desktop/dist` instead of
  recording an empty list. A failed build still publishes nothing. The
  manifest's new `frontendMeasured` field says what the list is: the build's
  output directory hashed after the build, not something extracted from the
  installer.
- `-ManifestOnly` requires a readable retained `candidate-manifest.json`. Its
  `head` and `tree` must be commit identifiers equal to HEAD's; it must record
  a clean working tree; it must record a real build, or a re-derivation this
  script made after checking one; and its installer and executable SHA-256
  values must be present and equal the files on disk. Any other case is refused
  before anything is written, the retained file is left as it is, and
  `-AllowDirtyTree` does not relax it. These checks run right after HEAD is
  read, before any build tool is probed. The existing refusal for a different
  HEAD keeps its wording. A re-derived manifest's `frontendMeasured` says the
  frontend was re-measured and is not established as what the installer
  embeds.

**What it does not claim.** No installer was built, rebuilt, installed or
inspected for this repair, and no earlier M7.6 candidate is re-attributed or
qualified by it. It closes these two paths; it is not a redesign or a
qualification of installer provenance, which stays M7.6 release work.

**Regression.** `scripts/test_build_candidate.py` (stdlib `unittest`; Windows
with PowerShell 7 and git) copies the script under test into a committed
fixture repository and runs it there. The child's PATH holds only stub `pnpm`,
`node`, `cargo` and `rustc`, git and the Windows system directories, and the
harness asserts that no real tool is reachable. The stub `pnpm tauri build`
writes a fixed frontend, executable and installer, fails, or leaves no
frontend. The cases are:

- an old frontend on disk before the build;
- no frontend before the build;
- a failed build, fresh and beside a retained manifest;
- a missing or empty frontend after the build, also beside a retained
  manifest;
- `-ManifestOnly` without a retained manifest: on a clean tree, on a dirty
  tree with `-AllowDirtyTree`, and with no tool on PATH;
- `-ManifestOnly` with a retained manifest that is malformed, names another
  head or tree, lacks a head or has a non-identifier one, records a dirty
  build, is an unchecked re-derivation, lacks a command or either artifact
  digest, or whose installer or executable on disk differs;
- matching provenance, which re-derives, and a checked re-derivation, which can
  itself be re-derived.

Every refusal case asserts its reason, that no manifest was written or
replaced, and that the retained evidence and the artifacts are byte-identical
afterwards. Fixtures and logs are under `.tmp/pr127-provenance-repair/`
(git-ignored).

| Command | Script under test | Exit |
| --- | --- | ---: |
| harness as first written | `8be2cac`'s script, before any repair | 1 — 11 failures, 1 error; the failed-build case and the other-HEAD refusal passed, as the old script already did both |
| harness as first written | `b1e125f`'s script, before and after it was committed | 0, 0 — 7 of 7 |
| PowerShell parser | `5a2b188`'s script | 0 |
| harness from `5a2b188` | `5a2b188`'s script | 0 — 7 of 7, every subcase |
| harness from `5a2b188` | `8be2cac`'s script | 1 — 19 failures, 1 error |
| harness from `5a2b188` | `b1e125f`'s script | 1 — exactly the four subcases the review added: no tool on PATH, a dirty build, an unchecked re-derivation, no command |

`git diff --quiet 7cbc7f0 5a2b188 --` the application, test, e2e, experiment,
workflow, manifest, lock and toolchain paths exits 0, and so does the same over
`scripts/` excluding the two files, so §8's results stand for this head
without being run again. The harness is not wired into CI: it needs Windows,
and changing the workflows was outside this repair.

**Review.** One narrow read-only review of `b1e125f` and its harness found:

| Finding | Class | Disposition |
| --- | --- | --- |
| `-ManifestOnly` did not check the retained `workingTreeClean`, so a `-AllowDirtyTree` build re-derived on a clean tree became a clean-HEAD build | blocker | fixed in `5a2b188`, with a test |
| A manifest the old `-ManifestOnly` synthesized without provenance was accepted as retained provenance | should-fix | fixed in `5a2b188`: only a real build, or a re-derivation that checked one, is accepted |
| Build tools were probed before the provenance check, so a missing manifest could be reported as a missing tool | note | fixed in `5a2b188`: the checks moved ahead of every probe, with a test |
| The `-AllowDirtyTree` case ran on a clean tree; executable, non-identifier head and working-tree cases were missing; the frontend-less case had no retained sentinel | note | added to the harness |
| A re-derivation replaces a post-build frontend list with a re-measured one | note | not changed: re-derivation keeps re-measuring everything, and `frontendMeasured` says so |
| `Remove-Item` of the bundle directory before a build | note | no change: it precedes the build and deletes no evidence |

The review's fixes were checked by the runs above; no second review ran.
