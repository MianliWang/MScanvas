# Post-PM9 native qualification preparation

Date: 2026-10-20.
Status: **TEST MIGRATION PREPARED; EXECUTION NOT ADMITTED; TYPECHECK AND NATIVE QUALIFICATION NOT RUN**.

The owner selected 150% native rendering qualification and repair of the related
Tauri/native selectors after PM9 closed. This record continues that dispatch;
it does not reopen PM9 or qualify an installer, provider or analysis engine.

## Candidate and scope

- Checkout: `feat/pm9-product-convergence`, HEAD
  `959a74fc693a2ed63fe847f50fe63c76d9c2229f` before this preparation.
- Frozen production: `30b855f23fc8b391e10221954dfa1278a9863db5`.
- Frozen PM9.7 tests: `e94fb168482a59cc701bec68af613bd74780a383`.
- `HEAD:apps/desktop` and `30b855f:apps/desktop` both resolve to
  `39d6557887a10b10dc60a9b00901160bf93a9c02` at takeover.
- Initial preparation: the eight test files named in the
  [PM9 handoff](../phases/pm9/baseline.md#18-pm97-the-after-side-the-regression-and-the-frozen-candidate-2026-10-14),
  and this execution record. Review of their shared helper identified three
  directly affected M4.2 consumers, included in the same test-only repair below.
  Production, dependencies, scientific contracts,
  schemas, manifests and the accepted PM9 dispositions stay outside this repair.
- No commit, push, PR or publication is part of this dispatch.

## Static repair batches

| Batch | Owned files | Required repair |
| --- | --- | --- |
| Viewer | `e2e/support/tauriPanel.ts`, `e2e/specs/m4.1-spectrum-export.tauri.e2e.ts`, `e2e/specs/viewer-r1-linked-viewer.tauri.e2e.ts` | Acquisition treegrid rows, roster visibility, single preview activation and explicit export disclosure. |
| Conversion | `e2e/specs/m6.6-destination-conflict.tauri.e2e.ts`, `e2e/specs/m6.7-conversion-scope.tauri.e2e.ts`, `e2e/specs/m6.8-cancellation-controls.tauri.e2e.ts`, `e2e/specs/m6.9-output-completion.tauri.e2e.ts` | Independent checkbox membership, current surface navigation, current start control and refused-action readiness. |
| Settings | `e2e/specs/m7.1-settings.native.e2e.ts` | Current roster, localized controls, figure disclosure, conversion membership/navigation and natural picker-focus recovery. |
| Shared export consumers | `e2e/specs/m4.2-clipboard.tauri.e2e.ts`, `e2e/specs/m4.2-figure-export.tauri.e2e.ts`, `e2e/specs/m4.2-native-save.native.e2e.ts` | Scope spectrum actions/fields away from chromatogram controls; keep chromatogram status and native dialog titles specific to their own operation. |

The former `li.dataset-row` / listbox-option queries have ten stale sites in
these eight files. Acquisition rows now require `[role="row"][data-handle]`
inside the roster treegrid; group headers must not be counted as acquisitions.
A plain mzML row click previews it. Interaction selection and conversion
membership are different states. A reachable refused start control can use
`aria-disabled`, so native enabled state alone is not readiness.

Controlled-IPC Tauri fixtures remain controlled evidence. They may declare a
stored roster preference to make their intended initial layout explicit; this
does not prove the native preference store. Real native scenarios must keep
their real preference path and must not import a browser mock-preference
readback wrapper. Original scientific, output-byte, transport and natural-focus
assertions must retain their meaning through the migration.

The shared figure setter now addresses current stable spectrum field IDs and
refuses a missing field instead of silently querying an empty retired wrapping
label. Its status reader and terminal wait default to the spectrum panel;
chromatogram callers explicitly pass their own panel. Native save helpers use
the production dialog titles for spectrum figures, chromatogram data and
chromatogram figures. These repairs make the original scenarios reachable;
none establishes a successful export or native dialog run.

The shared preview helper has ten direct consumer specs, two in the initial
batch and eight others. Besides the M4.2 consumers above, regression selection
must include `m4.3-chromatogram-export.tauri.e2e.ts`,
`m4.4-linked-figure.tauri.e2e.ts`, `m5.2-spectrum-viewport.tauri.e2e.ts`,
`m5.3-spectrum-range-export.tauri.e2e.ts` and
`m5.7-selection-availability.tauri.e2e.ts`. Viewer-r1 uses the shared preview
opener, while the other consumers use the selected-spectrum setup. These are
static dependency counts, not executed test counts.

The controlled fixture's fixed save response still returns `automatic`.
The repaired setup declares initial `shown` and does not save layout; a future
controlled layout-save scenario needs an appropriate response before its result
can count. Real native preference storage is unaffected by this fixture.

## Execution gates

### Resource admission

At `2026-10-20T20:13:03.4776113Z`, `GlobalMemoryStatusEx` reported
6111059968 available bytes (5.691 GiB rounded), 34008186880 total bytes and
82% memory load. This was one observation, not a live readiness claim.

The standing admission of at least 8 GiB free and at most 80% used was not met.
No typecheck, build, browser or native group started. No waiting or polling for
resources follows a refusal. The PM9 browser parallel/stop-only amendments do
not transfer to this dispatch. See [PM9.7 resource rules](../phases/pm9/slice-07.md#8-validation-groups-frozen-before-any-run).

After the owner's bounded HOLD release below, a fresh admission at
`2026-10-20T20:30:21.9477696Z` (16:30 America/Toronto) reported 4890398720
available bytes (4.555 GiB rounded), 34008186880 total bytes and 85% memory
load. Admission was refused again. This is a new decision-point observation;
the earlier refusal remains recorded. No heavy command started, and no waiting
or memory polling followed. The 4 GiB / 90% stop line is not an alternative to
the 8 GiB / 80% admission line.

### Provider HOLD

At initial preparation the HOLD remained active. The first native document
calls `inspect_backend` on mount, before a spec can seed answers. On this host
automatic discovery can reach the installed ProteoWizard and run its help
probe. Opening a native window was therefore blocked pending either a bounded
HOLD release or a genuinely provider-free host/guest. Changing PATH alone does
not establish the latter. This followed the existing
[owner decision](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze),
not a new permission requirement inferred from a skill.

The repaired M6 conversion scenarios additionally require actual provider reads
and conversions of the existing admitted fixtures. Permission for a help probe
alone would not authorize those scenarios.

**Owner decision, 2026-10-20:** the owner selected the bounded release for this
qualification, allowing automatic discovery/probes and reads/conversions of the
existing admitted fixtures. This resolves the provider-HOLD authorization
blocker for this dispatch. It does not authorize acquiring new vendor samples,
adding providers, packaging a runtime, running the separate targeted-MS1 engine
qualification or publishing anything. Source acquisitions remain read-only;
test outputs must use campaign-owned destinations and retain the existing
conflict protections.

U4's historical PM9 disposition remains unchanged. Its positive provider check
is still unrun; for this dispatch its current status is `PENDING` under resource
admission, rather than blocked by the released HOLD. The bounded release is
authorization, not provider evidence.

### Binary attribution

At takeover the native e2e executable was 16776704 bytes, last modified
`2026-09-17T20:39:59.8912191Z`; the ordinary release executable was 16773632
bytes, last modified `2026-09-18T23:06:37.1986624Z`. Neither is attributed to
PM9. Do not use either as PM9 native evidence.

After execution is admitted, `pnpm e2e:build` must produce a fresh binary with
retained source/test identity, toolchain, build command, bytes and SHA-256.
The `e2e` feature contains controlled-IPC support and synthetic seed data;
its result is not installed-release evidence.

## Ordered validation and acceptance

1. Review the combined test-only diff and preserve the original assertions.
2. Run the light repository/document checks. Record their actual exits.
3. With fresh resource admission, run `pnpm e2e:typecheck` before any build.
4. With provider policy resolved and build execution admitted, build and record
   the new executable identity. Use campaign-owned outputs and preference roots.
5. Run the repaired Tauri specs and affected shared-helper consumers in bounded
   serial groups. The default Tauri glob excludes `.native.e2e.ts`; list native
   specs explicitly and retain exact titles and outcomes.
6. Measure 144 DPI on the actual test window and DPR 1.5. Record CSS viewport,
   physical client/raster dimensions, window/work-area containment, app identity,
   console and assets. CSS zoom or emulated DPR is not OS-scaling evidence.
7. Inspect the integrated PM9 surface/state matrix at the relevant 1920x1080,
   1366x768 and 960x640 CSS anchors in en and zh-CN. Preserve screenshots and
   keyboard paths for empty/loading/error/recovery states, scroll/fold positions,
   refused actions and the 2 px `#1769d1` focus ring including its unclipped reach.
   The existing [PM9.7 integrated browser spec](../../e2e/specs/pm9.7-integrated.browser.e2e.ts)
   is the state reference, not native evidence.
8. A passing historical spec alone does not establish integrated PM9 native
   acceptance. Record any uncovered PM9 states separately, then inspect the
   rendered captures before a native PASS decision.

Only one native window may own the session/clipboard at a time. Record process
PID, creation time and parent; clean up only attributable owned processes.
Preserve failures and admission refusals. Test-only changes rerun their affected
groups; any production defect needs a separate disposition and a new candidate.

## Prepared serial execution matrix (not run)

The following are future execution groups, not continuations or new names for
the recorded admission refusals. Each spec runs in its own application session
and output directory, serially, after resource admission. Every outcome must
name the exact spec and executed titles, including skips and failures.

| Order / family | Command or spec under `e2e/specs/` | Literal source titles |
| --- | --- | ---: |
| NQ-T | `pnpm e2e:typecheck` | Not applicable |
| NQ-B1 | `pnpm build` | Not applicable |
| NQ-B2 | `cargo build --locked --release --features e2e --features tauri/custom-protocol --bin mscanvas-desktop --target-dir target/e2e` | Not applicable |
| NQ-V | `m4.1-spectrum-export.tauri.e2e.ts`; `viewer-r1-linked-viewer.tauri.e2e.ts` | 5 + 8 |
| NQ-E1 | `m4.2-clipboard.tauri.e2e.ts`; `m4.2-figure-export.tauri.e2e.ts`; `m4.3-chromatogram-export.tauri.e2e.ts`; `m4.4-linked-figure.tauri.e2e.ts` | 2 + 7 + 4 + 12 |
| NQ-E2 | `m5.2-spectrum-viewport.tauri.e2e.ts`; `m5.3-spectrum-range-export.tauri.e2e.ts`; `m5.7-selection-availability.tauri.e2e.ts` | 11 + 7 + 4 |
| NQ-C1 | `m6.6-destination-conflict.tauri.e2e.ts` | 5 |
| NQ-C2 | `m6.7-conversion-scope.tauri.e2e.ts` | 2 |
| NQ-C3 | `m6.8-cancellation-controls.tauri.e2e.ts` | 3 |
| NQ-C4 | `m6.9-output-completion.tauri.e2e.ts` | 1 |
| NQ-N1 | `m4.2-native-save.native.e2e.ts` | 5 |
| NQ-N2 | `m7.1-settings.native.e2e.ts` | 3 |
| NQ-I | `pm9.7-integrated.native.e2e.ts`, through its dedicated config below | 18 prepared cases, UNRUN |

The inventory has 15 spec files and 79 literal source `it` titles. This is
not an executed count: environment-conditional suites and clipboard skips must
be resolved from the actual run. The ignored local inventory
`.tmp/post-pm9-takeover-20261020/native-spec-inventory-after-evidence.json` retains all titles,
per-file SHA-256 and environment-variable references; its SHA-256 is
`1691DD3C37724E10F49D342E6210C6175A4A694E467C679594AF8F22F8EEDD67`.
The separate NQ-I spec adds 18 prepared cases; none of these 97 planned cases
has been executed in this qualification.

For a spec entry, invoke only that explicit file, for example:

```powershell
pnpm e2e:tauri --spec ./e2e/specs/m4.1-spectrum-export.tauri.e2e.ts
```

NQ-B1 and NQ-B2 are the two build operations behind `pnpm e2e:build`, separated
so each receives its own admission. A single chained command must not hide the
second heavy start. Hash the new binary after NQ-B2 and retain source tree,
test patch, toolchain and frontend identity with the build log. Do not use
`build_candidate.ps1 -ManifestOnly` to infer this binary's build provenance.

### Launch inputs and isolation

- Create a campaign-owned `preference-root-*` directory through the existing
  `e2e/support/m75PreferenceRoot.ts` contract under `.tmp/m75-evidence`, then
  bind `MSCANVAS_E2E_PREFERENCE_ROOT` before starting the driver. For English
  fixture specs use a fresh profile or an explicit English fixture; use a
  separate root for another appearance/state case. Do not write the operator's
  profile or set unrelated milestone-readiness flags to force isolation.
- Assign fresh distinct `MSCANVAS_TAURI_DRIVER_PORT` and
  `MSCANVAS_TAURI_NATIVE_PORT` per launch; refuse an already listening endpoint
  instead of reusing its driver. Record PID, creation time and parent for every
  owned driver, application and helper. No driver, window or clipboard sharing.
- The M6 suites require `MSCANVAS_THERMO_FIXTURE` and their own
  `MSCANVAS_M66_NATIVE_OUTPUT_ROOT`, `MSCANVAS_M67_NATIVE_OUTPUT_ROOT`,
  `MSCANVAS_M68_NATIVE_OUTPUT_ROOT` or `MSCANVAS_M69_NATIVE_OUTPUT_ROOT`.
  Revalidate the fixture's pinned hash before execution. Their output-root
  guard requires a pre-created directory outside the repository; use a unique
  campaign directory under the operating-system temporary root. Absence of an
  environment variable currently skips a suite and cannot count as a pass.
- NQ-N2 additionally requires the existing admitted mzML through
  `MSCANVAS_M71_MZML`, a pre-created external `MSCANVAS_M71_OUTPUT_ROOT`,
  `MSCANVAS_M71_SOURCE_HEAD` and `MSCANVAS_M71_EXPECTED_DPI=144`. Preserve its
  pinned acquisition hashes. The expected-DPI variable is an assertion, not
  a way to set Windows scaling. Its 144-DPI case covers 1366x768 CSS; it alone
  does not establish the other integrated viewport anchors.
- NQ-N1 uses the native-save spec's own temporary workspace. Retain the actual
  helper result and saved/cancelled outcome, including any dialog-not-found
  failure. Do not substitute the shell-only dialog probe as its acceptance.
  Its prepared retention hook writes complete helper stdout/stderr, parsed
  result, PID/parent, launch/end observations and status under
  `.tmp/native-save-evidence/run-*`. Before the original workspace is removed,
  it copies only the suite's four named output targets and records bytes and
  SHA-256. Those are evidence copies, not substitute save destinations. The
  hook and its error propagation are statically reviewed but unrun.

### Integrated PM9 native coverage still required

NQ-I must cover the PM9.7 integrated state reference through the compiled
WebView2 renderer, recording whether each state uses controlled IPC or real
files. Existing browser/manual evidence cannot fill this row. The state work is:

| State family | Required native observation |
| --- | --- |
| Empty Workbench / empty Project | Orientation, reachable actions and refused Project controls with their reasons; no hidden backend work from navigation |
| Populated viewer | Viewed acquisition identity, linked scan/spectrum, folded roster/Details, full controls and internal scroll recovery |
| Conversion | Configuration/review, running/stop/failure/retry/output presentations; controlled rendering kept separate from real provider outcomes |
| Targeted MS1 task | Draft/review, running/mixed outcomes and runtime unavailable; controlled rendering does not run the engine |
| Stored results / QC | Report ownership, missing/corrupt payload and source/runtime-unavailable recovery without implicit recomputation |
| Keyboard and scrolled positions | Visible whole focused controls and the 2 px `#1769d1` ring including offset/reach, no covering or ancestor clipping |

Record en and zh-CN at the relevant three CSS anchors, actual per-window
144 DPI / DPR 1.5, measured physical client and screenshot dimensions, density,
motion preference, foreground ownership and console/resource health. Inspect
the captures directly.

The dedicated prepared counterpart is now
[`pm9.7-integrated.native.e2e.ts`](../../e2e/specs/pm9.7-integrated.native.e2e.ts)
with [`wdio.pm9-native.conf.ts`](../../e2e/wdio.pm9-native.conf.ts). It defines
18 cases: I1 empty/entry/refused Project actions, I2 scrolled viewer/history,
and I3 viewer/Project Tab walks, each at the three anchors in both locales.
It uses the compiled e2e binary's own controlled table, actual Win32 sizing,
WebDriver PNG capture and real Tab input. No CDP/emulated DPR or replacement
preference invoke wrapper is used. It records comfortable density and the
host's actual reduced-motion preference. Compact density and additional motion
settings are not covered by this prepared matrix.

This driver does not yet cover every state family above: held loading/errors,
running conversion and targeted task outcomes, damaged/stored-result recovery
and expanded figure controls need their own native cases or an explicitly
recorded visual walkthrough. It is preparation for I1-I3, not complete PM9
native acceptance. At a large viewport with no overflow it records scroll zero
instead of fabricating a scroll test.

After admission and an attributed fresh build, invoke it with:

```powershell
pnpm exec wdio run ./e2e/wdio.pm9-native.conf.ts
```

The launcher requires these process-local inputs before starting a driver:

| Input | Meaning |
| --- | --- |
| `MSCANVAS_PM9_NATIVE_DISPATCH_READY=true` | Operator readiness for this admitted run; not a new user approval or an expiry of the existing authorization |
| `MSCANVAS_PM9_NATIVE_DISPATCH_ID` | Unique run ID; an exclusive claim preserves attempts rather than silently reusing a run |
| `MSCANVAS_PM9_NATIVE_SOURCE_HEAD` | Full approved HEAD; frozen production/dependency paths must still match `30b855f` |
| `MSCANVAS_PM9_NATIVE_BINARY_SHA256` | Full digest of the freshly attributed e2e binary |
| `MSCANVAS_E2E_PREFERENCE_ROOT` | Existing campaign-owned root, checked before driver/app creation |
| `MSCANVAS_PM9_NATIVE_OUTPUT_ROOT` | Existing directory under this checkout's `.tmp/pm9-native-evidence` |

The two optional port overrides are the same as the existing native config.
`MSCANVAS_PM9_NATIVE_RUN_ROOT` is set by the launcher. The dedicated config
refuses listening ports, disables session retries and allows the authorized
uncommitted test/docs changes while recording their exact file/patch hashes.
No whole-worktree-clean or extra approval-age requirement is imposed. Evidence
write errors propagate and do not bypass cleanup of the owned driver handle.
Driver and helper times are launch observations; OS process creation times and
final process-tree cleanup still require the external campaign observations.

Prepared file identities, not execution evidence:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `pm9.7-integrated.native.e2e.ts` | 26,734 | `A1D2D2A5FE880E9E8CB25212AA3538764971861323A514A8E5BC7FE330F5E4B8` |
| `wdio.pm9-native.conf.ts` | 11,742 | `44AF6B1113974ED6F94F5CA682B81BE1C294D6769D84E7F92C786AE6B941BC8D` |

## Current result

The eleven test/support files are migrated and statically reviewed. Separate
reviewers checked the viewer/shared-helper consumers, M4.2 exports and M7.1
native focus/localization paths. Static agreement is not runtime evidence.

No fresh test, typecheck, build, native rendering, provider, engine, installer or
release result is claimed here. Production has no working-tree changes.
The owner has authorized the bounded provider operations; resource admission
is the remaining execution blocker. The eleven tracked test/support repairs,
including the native-save retention hook, now hash to patch
`3B50A1CBECEF67DB41C395A38786247DA843C1569CD5278237B210084006845A`.
The initial patch and both admission snapshots are retained as historical
preparation evidence; they are not relabeled as runs of this revision.
The new native counterpart remains untyped and unrun.

The parallel [ADR 0006 correction](../architecture/adr/0006-multi-dataset-workspace-boundary.md#active-dataset)
is prepared and statically reviewed. The [deferred-work ledger](POST_PM9_DEFERRED_WORK.md)
classifies F2/F3 and the optional rows without implementing them. The
[engine preflight](POST_PM9_TARGETED_MS1_ENGINE_PREFLIGHT.md) records static
runtime identity; actual engine qualification remains separate and pending.

Light checks on 2026-10-20:

| Check | Result |
| --- | --- |
| `python scripts/check_repo.py` | Exit 0, `Repository validation passed.` |
| `git diff --check` | Exit 0 |
| Working-tree comparison of production/dependency paths | No changed paths under `apps/desktop` or `crates`; no Cargo/root package/lockfile changes |
| Static comparison of the ten modified specs' literal `it` titles | All 41 titles unchanged; none executed |
| Current tracked test/support repair patch identity | SHA-256 `3B50A1CBECEF67DB41C395A38786247DA843C1569CD5278237B210084006845A` |

The ignored local artifacts `.tmp/post-pm9-takeover-20261020/static-audit-after-evidence.json`
and `test-migration-after-evidence.patch` retain current per-file hashes and the
exact tracked repair patch. Earlier artifacts remain unchanged. The title
comparison is a static aid; it does not establish
assertion equivalence or test success. The working tree intentionally contains
the uncommitted test migration and this record.

## Execution, 2026-10-27/28 (beta-1 candidate)

Run window: 2026-10-27 22:02 to 23:57 America/Toronto
(2026-10-28T02:02Z to 03:57Z).
Status: **PARTIAL. NQ-T, NQ-B1/B2, NQ-V, NQ-E1/E2, NQ-C1..C4 and NQ-N1 PASS
after test-only repairs; NQ-N2 and NQ-I NOT QUALIFIED (host foreground owned
by the operator's active applications).**

This section records an execution of the prepared matrix against a newer
candidate than the one the preparation above names. The preparation record,
its admission refusals and PM9's dispositions are unchanged.

### Candidate, binary and driver

- Checkout `feat/beta1-readiness`, HEAD
  `7cf4c7408dabfe53ccbc7d03c85892a5f01d0e7e` (PR #134), tree
  `766bf9dc088f55d6b01265410514e198e0f176b6`, `HEAD:apps/desktop`
  `83d2e69ecb28d5e605bba178c62790e65d3db4da`. Against PM9's `30b855f`, 31
  files under `apps/desktop` differ (frontend, plus two `windows` crate
  features in `src-tauri/Cargo.toml`) and `.github` differs; `crates`,
  `Cargo.lock`, the root package files and the lockfile do not. This is the
  beta-1 candidate, not PM9's frozen production.
- Ordered step 1: the committed migration reproduces the reviewed preparation
  byte for byte. `git diff --binary 959a74f HEAD` over the eleven repaired
  files hashes to `3b50a1cb...845a`, the patch recorded above. After `23425af`
  only browser specs changed under `e2e/`. Before this run's guard edit the NQ-I
  spec and config still matched the prepared `A1D2D2A5...` and `44AF6B11...`.
- Ordered step 2: `python scripts/check_repo.py` exit 0
  (`Repository validation passed.`), `git diff --check` exit 0, no changed
  production/dependency path.
- Binary, built by NQ-B1 then NQ-B2 with only `e2e/wdio.pm9-native.conf.ts`
  changed in the working tree: `target/e2e/release/mscanvas-desktop.exe`,
  19,571,712 bytes, written 2026-10-28T02:08:45Z, SHA-256
  `e98ae5d2d7e41083919fade8b3ace04cc3f26c0e0d53b4602024fb018eb7f811`.
  Toolchain: cargo 1.97.1 (c980f4866 2026-06-30), rustc 1.97.1 (8bab26f4f
  2026-07-14, x86_64-pc-windows-msvc, LLVM 22.1.6), Node v22.15.1, pnpm 11.15.1.
  Frontend bundle: `index.html` `e89dd250...`, `index-DMxk1d8J.css`
  `59dabbb6...`, `index-gbwyn1IL.js` `fa2bab7b...`. It replaced the unattributed
  2026-09-17 binary (16,776,704 bytes, `f2791ab8...`). It carries the `e2e`
  feature (controlled-IPC support and the synthetic seed) and is not
  installed-release evidence.
- Driver: Microsoft Edge WebDriver 155.0.4283.62
  (aa3a7406ba8c53a83536df539f07124d73c899bd) from
  `https://msedgedriver.microsoft.com/155.0.4283.62/edgedriver_win64.zip`
  (11,715,108 bytes, SHA-256
  `00dd7fbc6fc4bd68e6e86badbe76e6570513414085f476e73d3787ba3410d562`), extracted
  into the new directory `D:\tmp\beta1-native-20261028T015831Z\edgedriver`.
  `msedgedriver.exe`: 23,858,088 bytes, SHA-256
  `01ce0daa683e5ea874e2e2439e4a162db11b0d40228d37cce1efc990294464f6`,
  Authenticode `Valid`, signer `CN=Microsoft Corporation`, issuer
  `Microsoft Windows Code Signing PCA 2024`, thumbprint
  `544CC93B75A99BB07FBC194114BB3D3A3764BA15`. It was first on `PATH` for every
  launch, and every sampled `msedgedriver.exe` ran from that path.
  `tauri-driver.exe` SHA-256 `6e768e8a...9e66`. WebView2 runtime and session
  `browserVersion`: 155.0.4283.62.
- Host: primary display 3840x2160 at 144 DPI (150%). Measured on the actual
  test window by NQ-I attempt a01 (DPI 144, DPR 1.5, 1920x1080 CSS rasterized
  to 2880x1620, equal to the client rectangle) and by the M7.1 identity record
  (DPI 144). The other Tauri specs ran on this host but do not measure DPI.
- Fixtures, unchanged before and after every group that read them: Thermo
  `FT-HCD-MSX.raw` 78,309 bytes `b3d97b38...6dd7b`; the M7.1 mzML
  `D:\tmp\mscanvas-m69-final6\regress\m68\m68-native-kqC3nd\scenario-2\converted-0\FT-HCD-MSX-0.mzML`,
  28,616 bytes, `a1228c10...75ea7`. M7.1's own `native-run-04.launch.json`
  names this path and digest.

### Isolation, ports and process accounting

Each spec ran alone as `pnpm e2e:tauri --spec ./e2e/specs/<file>` (NQ-I:
`pnpm exec wdio run ./e2e/wdio.pm9-native.conf.ts`) through a campaign runner
that read memory, refused a busy port, created a fresh `preference-root-*`
under `.tmp/m75-evidence` through `createOwnedPreferenceRoot`, bound
`MSCANVAS_E2E_PREFERENCE_ROOT` before the driver started, and sampled the
process tree by parent chain and creation time. `MSCANVAS_M75_NATIVE_READY` was
not set. This host's TCP dynamic port range is 1024-15000, so the first 95xx
pairs could collide with other programs' client connections: one launch was
refused before start because an unrelated process held 9520. Later launches
used 15500-15617, outside the dynamic and excluded ranges. Every run's
`tauri-driver -> msedgedriver -> mscanvas-desktop -> msedgewebview2` chain is
recorded with PID, parent and creation time in its `result.json`. One owned
residue was found and stopped after PID and creation-time verification
(NQ-I a03: `conhost.exe` PID 47168, child of the owned `tauri-driver`); its
WebView2 processes exited by themselves during cleanup. Nothing was stopped by
name or port. A first NQ-V invocation failed in argument parsing before any
driver or application started (runner fault, retained as
`NQ-V/tooling-false-start-01`). Evidence lives under
`.tmp/beta1-native/<group>/<label>/` (`command.txt`, `output.log`,
`result.json`, `titles.json`) with the ledger `.tmp/beta1-native/ledger.jsonl`.

### Admission and outcomes

Every heavy group was admitted at >= 8 GiB free and <= 80% used. The lowest
reading during any run was 20.30 GiB free and the highest 68.11% used; the
4 GiB / 90% stop line was never approached.

| Group | Command or specs (literal titles) | Admission, free GiB / used % | Final result | Earlier attempts |
| --- | --- | --- | --- | --- |
| NQ-T | `pnpm e2e:typecheck` | 29.26 / 54.1 | exit 0 | Repeated after each test edit, every one exit 0 |
| NQ-B1 | `pnpm build` | 29.07 / 54.4 | exit 0 | - |
| NQ-B2 | `cargo build --locked --release --features e2e --features tauri/custom-protocol --bin mscanvas-desktop --target-dir target/e2e` | 29.01 / 54.4 | exit 0, 1 min 29 s | - |
| NQ-V | m4.1 (5), viewer-r1 (8) | 29.59 / 53.5 | 13 passed | First 12/13; single case 0/1; rerun1 12/13; rerun2 13/13 |
| NQ-E1 | m4.2-clipboard (2), m4.2-figure-export (7), m4.3 (4), m4.4 (12) | 32.01 / 49.7 | 25 passed, 0 skipped | First: both M4.2 setup hooks failed (no case ran), m4.3 refused on port 9520, m4.4 not started; single 0/1; rerun1 22/25 |
| NQ-E2 | m5.2 (11), m5.3 (7), m5.7 (4) | 32.34 / 49.2 | 22 passed | First 10/22; rerun1 17/22; single m5.3 lane case 0/1 |
| NQ-C1 | m6.6 (5) | 28.99 / 54.5 | 5 passed | First 3/5; each failing case alone 0/1 |
| NQ-C2 | m6.7 (2) | 28.62 / 55.1 | 2 passed | - |
| NQ-C3 | m6.8 (3) | 28.62 / 55.1 | 3 passed | - |
| NQ-C4 | m6.9 (1) | 28.41 / 55.4 | 1 passed | - |
| NQ-N1 | m4.2-native-save (5) | 33.00 / 48.2 | 5 passed | First 0/5 (dialog not found); rerun1 4/5 |
| NQ-N2 | m7.1-settings (3) | 31.79 / 50.1 and 27.93 / 56.1 | **None executed**: before-all refused on foreground, twice | - |
| NQ-I | `pm9.7-integrated.native.e2e.ts` (18) | 27.72 / 56.5; 21.54 / 66.2; 26.74 / 58.0 | **None passed**: a01 ran 1 case (failed, repaired), 17 never started; a02 and a03 refused in before-all on foreground | - |

The admission column is the final attempt's first reading (both or all three
for NQ-N2 and NQ-I). The titles and outcome of every attempt are in the
`titles.json` beside its log. In their final runs 76 of the 79 literal titles of
NQ-V..NQ-N2 executed and passed; NQ-N2's 3 never executed. Nothing was skipped:
the clipboard was usable, so m4.2-clipboard and m4.4's conditional copy case ran,
and the M6 fixture variables were set, so no M6 suite fell back to
`describe.skip`. Four campaign diagnostics under `.tmp/beta1-native/diag/`
(ignored, not repository tests) observed states to classify failures and
assert nothing.

### Executed titles

Final-run outcome of every literal title, generated from the retained
`titles.json` files. A script compared each executed set with the static
inventory (`native-spec-inventory-after-evidence.json`, `1691DD3C...DD67`):
the 14 executed specs ran exactly their inventoried titles, none missing and
none extra. The consolidated record, including NQ-I and every earlier
failure, is `.tmp/beta1-native/title-outcomes.json`, SHA-256
`7d197e663264f8f2759fd4da0aef171a448eabdee1c846f6e376f55cffce1535`.

- `m4.1-spectrum-export.tauri.e2e.ts` (NQ-V, 5/5 passed): launches and renders the workspace over real IPC; carries a real IPC round trip; renders the export controls; reaches the export controls from the keyboard; invokes the export commands through the real transport.
- `viewer-r1-linked-viewer.tauri.e2e.ts` (NQ-V, 8/8 passed): draws the chromatogram from the preview the document was given; shows and hides each trace on the real WebView; crosses the real transport into the production selected-spectrum command; steps scans through the production selection transport; moves the viewport in WebView2 without asking the backend anything; hands a wheel it cannot use back to the WebView; leaves ctrl-modified input to the WebView that ships around it; reads how far the wheel turned, not merely which way.
- `m4.2-clipboard.tauri.e2e.ts` (NQ-E1, 2/2 passed): puts an image of exactly the chosen size on the clipboard; copies the theme the user chose.
- `m4.2-figure-export.tauri.e2e.ts` (NQ-E1, 7/7 passed): renders every figure control and the settings it starts at; carries the chosen settings into the real export command; refuses a figure the settings could not describe, without asking Rust; draws and copies the plot through the production path; refuses a copy of a figure too large to hold as pixels, before allocating any; still exports that figure as a vector, and refuses it as a raster; refuses a resolution no PNG records, and lets every other output through.
- `m4.2-native-save.native.e2e.ts` (NQ-N1, 5/5 passed): writes a PNG of exactly the requested size and resolution; writes an SVG through the same path; writes a chromatogram data file through the same real dialog; treats a dismissed chromatogram dialog as an outcome and writes nothing; treats a dismissed dialog as an outcome and writes nothing.
- `m4.3-chromatogram-export.tauri.e2e.ts` (NQ-E1, 4/4 passed): names the chromatogram Rust retained and comes back with a reservation; carries the visible traces and the figure settings into the real command; refuses a token this session no longer holds; refuses a range the run does not have.
- `m4.4-linked-figure.tauri.e2e.ts` (NQ-E1, 12/12 passed): binds the pair the session holds and opens a real reservation; places the marker at a retention time only Rust has; reports the retained run and the marked scan when a copy can be made; refuses a chromatogram token this session no longer holds; refuses a spectrum token this session no longer holds; refuses a current range the selected scan is outside; accepts a current range that still holds the selected scan; refuses a range the run does not have, rather than clamping it; refuses a figure one pixel short of two panels, and draws one at 260; refuses a figure with no visible trace; takes the one scientific lane the chromatogram was holding; does not wedge the lane when a linked reservation is handed to the wrong save.
- `m5.2-spectrum-viewport.tauri.e2e.ts` (NQ-E2, 11/11 passed): opens at the whole admitted domain and draws what Rust answered; draws real sticks, one node, from the retained source; asks the real boundary once for a committed window, and reads nothing else; asks for nothing while a drag is in flight, and once when it settles; leaves a full-source export carrying no window; is refused rather than clamped, and says so without offering a retry; is refused as stale, and that one is worth trying again; claims no wheel, offers no action, and asks Rust for nothing; keeps the drawing out of the real WebView tab order, and asks for nothing; takes no ctrl-modified wheel or key, and asks Rust for nothing; runs no backend operation for a wheel, a drag or a button.
- `m5.3-spectrum-range-export.tauri.e2e.ts` (NQ-E2, 7/7 passed): carries a full-source request with no window at all; carries the committed window once the current range is chosen; reports the range Rust resolved for a real copy; holds one scientific lane, whichever range is chosen; is refused rather than clamped, in this surface's own m/z words; offers no range chooser, and says so; still accepts a full-source export of the same spectrum.
- `m5.7-selection-availability.tauri.e2e.ts` (NQ-E2, 4/4 passed): says nothing while a scan can be selected, from a region that already exists; explains a closed lane once, and sends nothing from either surface; keeps the run readable while the lane is closed; commits again as soon as the lane clears.
- `m6.6-destination-conflict.tauri.e2e.ts` (NQ-C1, 5/5 passed): preserves editable drafts and keyboard focus after Escape cancels the real custom picker; writes a real validated mzML to the chosen custom folder; binds equal output names to two different source parents; rejects a path-like name without BEGIN or folder creation, then creates valid named subfolders; preserves existing target bytes through real Fail and Skip attempts.
- `m6.7-conversion-scope.tauri.e2e.ts` (NQ-C2, 2/2 passed): converts only the selected eligible subset in reviewed order and preserves unrelated sources/targets; converts every eligible workspace row under search and keeps Fail/Skip target bytes.
- `m6.8-cancellation-controls.tauri.e2e.ts` (NQ-C3, 3/3 passed): ends the file the provider is actually converting, and the queue carries on; settles a waiting item without launching it, and keeps its place in the plan; stops the whole queue while the provider runs, and starts nothing after it.
- `m6.9-output-completion.tauri.e2e.ts` (NQ-C4, 1/1 passed): completes output-only, shows the manifest, and adopts only when asked.
- `m7.1-settings.native.e2e.ts` (NQ-N2, 0/3 executed): applies, cancels, resets and dismisses Settings in the actual app; reads retained lawful mzML and exports a real PNG from the shared numeric fields; naturally returns from the affected real cancelled destination picker.
- `pm9.7-integrated.native.e2e.ts` (NQ-I, 0/18 passed): `PM9.7 native I1 empty
  entry and refused Project actions, <at>`, `PM9.7 native I2 scrolled evidence
  and Project history, <at>` and `PM9.7 native I3 Tab ring reach and ancestor
  clipping, <at>` for `<at>` in en and zh-CN at 1920x1080, 1366x768 and
  960x640. Only `PM9.7 native I1 empty entry and refused Project actions,
  en-1920x1080` executed (a01, failed on the console assertion); the other 17
  never started.

Titles that failed in an earlier attempt, before the repair named in the next
table:

- NQ-V: viewer-r1 "draws the chromatogram from the preview the document was
  given" (hidden point glyph, then the moved source sentence).
- NQ-E1: the `beforeEach` hooks of m4.2-clipboard and m4.2-figure-export, so
  none of their cases ran (`tauriPanel` answer shape); then m4.2-figure-export
  "refuses a copy of a figure too large to hold as pixels, before allocating
  any", "still exports that figure as a vector, and refuses it as a raster"
  and "refuses a resolution no PNG records, and lets every other output
  through" (M7.4 wording).
- NQ-E2: m5.2 "opens at the whole admitted domain and draws what Rust
  answered", "draws real sticks, one node, from the retained source", "asks
  the real boundary once for a committed window, and reads nothing else",
  "asks for nothing while a drag is in flight, and once when it settles",
  "leaves a full-source export carrying no window", "claims no wheel, offers
  no action, and asks Rust for nothing", "keeps the drawing out of the real
  WebView tab order, and asks for nothing", "takes no ctrl-modified wheel or
  key, and asks Rust for nothing" and "runs no backend operation for a wheel,
  a drag or a button" (caption read); in rerun1 "asks for nothing while a drag
  is in flight, and once when it settles" (pan button), "is refused rather
  than clamped, and says so without offering a retry" and "is refused as
  stale, and that one is worth trying again" (whole caption) and "keeps the
  drawing out of the real WebView tab order, and asks for nothing"
  (`tabindex`). m5.3 "reports the range Rust resolved for a real copy"
  (button scope), "is refused rather than clamped, in this surface's own m/z
  words" (wording) and "holds one scientific lane, whichever range is
  chosen" (held save).
- NQ-C1: m6.6 "preserves editable drafts and keyboard focus after Escape
  cancels the real custom picker" (group names) and "writes a real validated
  mzML to the chosen custom folder" (closed disclosure).
- NQ-N1: all five cases (dialog not found); in rerun1 "writes an SVG through
  the same path" (fixed precision).
- NQ-I: a01 "PM9.7 native I1 empty entry and refused Project actions,
  en-1920x1080" (console notice).

### Test-only changes

No production file changed. Every repair keeps the original assertion's
subject. Failures were classified before any repair: the viewer-r1 case, the
first M4.2 figure case, the M5.3 lane case and both M6.6 cases were each re-run
alone once and failed the same way; NQ-N2 and NQ-I were re-run as whole specs.
The other failures were fixed-string or fixed-shape mismatches that the logs,
the saved files or a diagnostic showed directly, and their groups were re-run
after the repair. The unrepaired NQ-N1 run was deliberately not repeated: each
of its cases leaves a modal dialog on the operator's desktop for 90 s.

| File | Why |
| --- | --- |
| `e2e/wdio.pm9-native.conf.ts` | Owner-directed: pins the candidate under test (`7cf4c74`, `apps/desktop` tree `83d2e69e`) instead of `30b855f`/`39d65578`. The guard still refuses a source or binary mismatch. File SHA-256 `df5508ab...a1d2`. |
| `e2e/support/tauriPanel.ts` | `tauriTable()` answered `load_selected_spectrum` with the bare outcome. Since `8590adb` the command answers `{ authority, outcome }`, as `fixtures.ts` already does, so the viewer correctly reported "Spectrum 0 could not be loaded" and every setup waiting for the selected spectrum timed out (diagnostic `m42-select2`: bare fails, wrapped loads). Wrapped once for every caller. |
| `e2e/specs/viewer-r1-linked-viewer.tauri.e2e.ts` | Counts visible point glyphs only (one hidden glyph per trace on purpose since `c12f45d`; PM9.7 retirement, same selector as `Chromatogram.test.tsx`); reads the per-scan source sentence from the caption's "Source and drawing details" disclosure, where it moved. |
| `e2e/specs/m4.2-figure-export.tauri.e2e.ts` | The panel shows M7.4's localized owned-error messages instead of Rust's English text; the assertions name the same 32,000,000-pixel budget and 72-1200 DPI range. |
| `e2e/specs/m5.2-spectrum-viewport.tauri.e2e.ts` | Reads the caption as text (the drawing statement moved into the disclosure) and waits for it to contain "Drawn as"; the in-flight pan uses the middle button (since M7.3 a primary drag proposes a range); the immovable plot carries `tabindex="-1"`, which is never a sequential stop (the browser spec asserts the same attribute for an unnavigable plot), and the case's Tab traversal still checks the order. |
| `e2e/specs/m5.3-spectrum-range-export.tauri.e2e.ts` | `press()` scoped to the spectrum panel (the chromatogram's own "Copy plot" comes first; the copy had gone to `copy_chromatogram_plot`, diagnostic `m53-lane`); M7.4 messages from the `en` bundle; the save half held open with a never-settling answer so the reservation is outstanding when the lane is read (the table answered it at once and released the lane first, deterministically). |
| `e2e/specs/m6.6-destination-conflict.tauri.e2e.ts` | Drafts compared by stable group suffix and value (React `useId` group names changed, values did not); "Bound queue details" opened before reading the queue destination (a closed disclosure since M7.4). |
| `e2e/specs/m4.2-native-save.native.e2e.ts` | Passes the WebDriver application PID to `save-dialog.ps1` (see the NQ-N1 incident below); figure description wording since `c12f45d`; SVG dimensions at the renderer's adaptive fixed precision (`width="900.000"`). |
| `e2e/specs/pm9.7-integrated.native.e2e.ts` | Excludes only Tauri's exact "Couldn't find callback id ... app is reloaded" warning from the console assertion: the harness reloads the cold document while Rust may still answer one of its real requests. The entry stays in the evidence. |

Final test patch: 9 files, 115 insertions, 33 deletions;
`git diff --binary HEAD -- e2e/` SHA-256
`63669676652d17e5299ba2e79e13cb08297614be3d5efbae1ee4bd8b0c66ae2d`. NQ-I a02 and
a03 recorded change patch `3e72ade9...bbe3`. Comment-only edits followed: one in
the NQ-I spec after those attempts, and one in the m5.2 spec after its last
passing run.

### NQ-N1 incident: unattributed dialog lookup

In the first NQ-N1 run the helper was called without `-ApplicationProcessId`,
so it searched UI Automation root children. It found no dialog in any of the five
scenarios (`no top-level window named '...' appeared within 90s`). The helper
itself records that a native common dialog need not be a UIA root child on this
host and provides an exact PID/title/class path, which M7.1 uses. While those
dialogs stood on the operator's active desktop, three were accepted by input
from outside the campaign's process tree (no sampled owned process acted on
them; most likely the operator's keystrokes reached a modal that took the
foreground). They saved, under their default names, into the dialogs'
last-visited folder, which was the campaign's own M6.9 output folder:
`mscanvas-spectrum-0.png` (8,542 bytes, 03:22:19Z), `mscanvas-spectrum-0.svg`
(3,726 bytes, 03:23:00Z) and `mscanvas-chromatogram-full.csv` (984 bytes,
03:25:17Z). They are byte-identical to the later controlled outputs
(`ce595c87...`, `891ee933...`, `1ff55c7e...`). No source or operator file was
touched. In the repaired runs every dialog was found by exact PID/title/class,
named through `WM_SETTEXT` with exact readback and pressed through `BM_CLICK`;
both cancel cases reported "Export cancelled. Nothing was saved." Evidence:
`.tmp/native-save-evidence/run-O8X9b4` (0/5), `run-IbiMwq` (4/5) and
`run-yk2MGL` (5/5).

### U4: live-provider conversions

The four M6 suites drove the real UI, native pickers, Rust queue and the
installed ProteoWizard (outputs name `pwiz` 3.0.26013) on campaign copies of the
admitted Thermo fixture. They wrote only under
`D:\tmp\beta1-native-20261028T015831Z\m66-output` ... `m69-output`. Across all
attempts they produced 32 converted mzML files (the other five `.mzML` names
there are files of 30-137 bytes that the suites planted as existing targets
or unrelated neighbours). Every finalized conversion reported backend exit code
0 and output-only validation (`fullyVerified: false`; verified items include
`source_unchanged`). The two M6.8 conversions stopped on request ended with
`-1073741510` (`0xC000013A`), as a terminated provider should.

- Sizes are 28,597-28,687 bytes and every digest differs, because each output
  records its own source path.
- Line comparison of this run's M6.8 `FT-HCD-MSX-0.mzML` (28,625 bytes) with the
  historical admitted M7.1 mzML (28,616 bytes, `a1228c10...`): 210 lines each.
  They differ only in the `sourceFile` location, the three index offsets that
  path shifts, and `fileChecksum`. The spectrum and chromatogram content is
  identical.
- M6.6 and M6.7 preserved existing target bytes through Fail and Skip. M6.8
  ended the file the provider was converting while the queue continued,
  settled a waiting item without launching it, and stopped the whole queue with
  nothing started afterwards. M6.9 completed output-only, showed the manifest
  and adopted only on request.

This is the first execution of U4's positive provider check, on this host and
candidate. It runs the `e2e`-feature binary, not an installed release, and
output-only validation does not compare converted data with a vendor-source
spectrum model.

### NQ-N2 and NQ-I: what ran and what remains

NQ-N2 was refused in its before-all hook both times, on foreground ownership.
In attempt 1, `focus-window` activated the application (`focused: true`; the
identity record shows the application PID 17104 in the foreground), but by the
next check the operator's VS Code (PID 9760) owned the foreground. In attempt 2
the application never received the foreground (`focused: false`; VS Code still
owned it). No Settings, figure or picker case executed and no M7.1 capture
exists. The spec rightly forbids focus rescue, and
`MSCANVAS_M71_MANUAL_FOREGROUND=1` needs a person.

NQ-I a01 passed its before-all hook: identity, DPI 144, foreground, neither
maximized nor minimized, document focus. Its first frame
(`i1-workbench-en-1920x1080`) met every native measurement: PID and executable,
DPI 144, foreground, frame inside the work area, CSS 1920x1080, DPR 1.5, zoom 1,
visual scale 1, raster 2880x1620 equal to the client, comfortable density, no
overflow, no external resource, no unanswered application command. It then
failed only on the console assertion, one Tauri reload-callback warning (repaired
above). a02 and a03 were refused in before-all because the operator's VS Code
(PID 9760) and Task Manager (PID 11176) owned the foreground. `bail(true)` ended
each attempt; the repaired `sample()` never ran to completion.

Covered natively: one English empty-Workbench frame at 1920x1080 CSS under a
measured 144 DPI. Not covered: the rest of I1-I3, including the 1366x768 and
960x640 anchors, all zh-CN, the refused Project actions, the scrolled
viewer/history, the Tab walks and the 2 px `#1769d1` ring's reach and clipping.
Also not covered: every state family the prepared driver never addressed (held
loading/errors, running conversion and targeted-task outcomes, damaged and
stored-result recovery, expanded figure controls). This run produced no zh-CN
and no focus-ring capture anywhere. PM9 integrated native acceptance remains
open.

Captures inspected directly (150%):

- NQ-I `i1-workbench-en-1920x1080.png`: empty Workbench with the roster shown,
  the "No acquisitions yet" entry and the centred guidance, intact header
  chips, no clipping or overlap. No focus ring: not a keyboard sample.
- M6.6 `1-draft-960x640.png`: Conversion at 960x640 CSS, with a two-row header
  and readable stacked destination and conflict groups inside the scrolled
  panel. The spec measured no horizontal overflow.
- M6.6 `2-custom-finalized.png` and M6.8 `1-item-stop.png` (1366x768): queue
  results, "Bound queue details" open on "Chosen local folder", per-item
  Converted or Cancelled with Open file and Open folder.
- Diagnostic `d2-wrapped.png` (viewer, 1440x900 CSS): chromatogram, selected
  spectrum and export actions. Its red "Explorer drag-and-drop is unavailable"
  notice comes from the shared Tauri fixture answering
  `subscribe_workspace_drop_updates` with `null`; the real-IPC M6 captures show
  the normal drop hint.

All inspected captures are English.

### Product observations

No functional product defect was found. Every failure traced to a stale or
harness-side test, the host, or the operator's activity. Two minor English copy
defects were visible in native evidence; they are reported here, not fixed:

- `apps/desktop/src/features/preferences/locales/en.ts:262`
  (`m74CnvOutputMetrics`, used at `ConversionPanel.tsx:1574`) renders "1 spectra,
  1 chromatograms" with no singular form. Evidence: M6.6 `2-custom-finalized.png`,
  M6.8 `1-item-stop.png`. Present since M7.4 (`e495464`), not specific to beta-1.
- `en.ts:36` (`m74ErrorRasterBudget`, filled at `ownedErrorMessages.ts:138`)
  renders "The image is limited to 32000000 pixels" without digit grouping.
  Evidence: the NQ-E1 `m4.2-figure-export` logs.

### Not run and remaining

- NQ-N2 and NQ-I need an idle interactive desktop on which the launched
  application keeps the foreground for the whole run, or a person for M7.1's
  manual-foreground mode. They were not retried further: more attempts against
  an operator in active use would be polling, not qualification.
- Before that rerun, close or retitle every other window whose title contains
  "MSCanvas", such as a VS Code window titled "MScanvas - Visual Studio Code".
  `focus-window.ps1` matches `*MSCanvas*` case-insensitively against each
  process's main-window title and takes the first match, and `Get-Process` lists
  `Code` before `mscanvas-desktop`. Both M7.1 records show that it chose the
  application this time. `focusApplicationWindow()` (M4.2 copy cases) discards
  the helper's answer, so which window it activated in this run is not recorded.
- No installer, release-binary, new-provider, engine or publication work was
  done. The controlled-IPC layers (NQ-V, NQ-E, NQ-N1's fixtures, NQ-I) are not
  installed-release evidence.
