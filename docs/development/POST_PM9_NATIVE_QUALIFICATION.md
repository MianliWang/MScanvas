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
