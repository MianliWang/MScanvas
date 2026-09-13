# M7.1 — Localized Settings and shared controls

Status: **label-activation repair implemented; renewed native acceptance pending**.
The first QA build passed all four required native pairs below. PR #120 identified
a label-activation regression and stale status prose. The product repair requires
a new QA build and four fresh paired native runs; the retained first-build passes
do not qualify the repaired build. The task PR binds publication and local closeout to the
reviewed head. This QA build is not a public beta. M7.2 is next, not started.
M6 remains complete; the post-M6 XIC interlude remains complete on its
non-admission branch. XIC is not admitted or implemented.

Baseline: `f743f9d9c72e834cc47efb1671ace8ed737842a0` (M7.0 / PR #119).
Route owner: [ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md).
Task branch: `feat/m7.1-localized-settings-shared-controls`.
Local checkpoint and raw evidence: `D:/tmp/mscanvas-m71-20260912`.
The task PR must establish actual merge, natural-main CI and local branch cleanup;
passing local acceptance alone does not establish those publication facts.

## Behavior and ownership

The existing topbar opens one Settings dialog without a dataset or backend.
Opening copies applied locale/density into a draft; one effective projection
previews edits. Apply commits and closes; Cancel, Close and Escape discard.
Reset edits only the draft to `en` / `comfortable`. Backdrop interaction does
not dismiss. One notice explains the session lifetime. A new app session starts
at the defaults; no browser, Rust or configuration persistence is used.

`SessionPreferencesProvider` sits above the existing workspace without a locale
key. It owns only UI preferences. Figure drafts, raw numeric strings, selection,
viewports, operation identity and delivered scientific results keep their existing
owners. Completing a background read while Settings is open remains an ordinary
workspace update; Cancel does not restore a workspace snapshot.

`SettingField` and `ChoiceField` are consumed by both Settings and
`FigureSettingsFields`. The latter remains shared by `SelectedSpectrumPanel`
and `ChromatogramExportPanel`, with stable distinct panel IDs and per-instance
radio names. `RawTextField` preserves the string, node, caret and IME composition;
the existing whole-positive-integer parsing and Rust range/unit validation remain
authoritative. Invalid PNG DPI blocks PNG alone. SVG/copy keep the existing
unused-DPI transport default, without rewriting the editing string.

The roster uses real 44/32px comfortable/compact minimum rows, unchanged 13px
type and wrapped acquisition names. It is not virtualized; its existing DOM
scrolling and activation stay in charge. There is no reordering, extra dataset
read or conversion membership change from preference edits. The new dialog
follows the tracked v5.11 hierarchy and local Segoe/CJK font policy.

## Localization boundary and resource failures

Bundled `en` / `zh-CN` values cover Settings entry/title/description/actions,
density messages, recovery/live feedback, and shared figure labels/help/theme,
accessible names and complete validation messages. Untouched workspace, viewer,
conversion and export-action prose remains English. User data and provider
diagnostics remain original. Root policy permits only declared resource values
to use their locale; identifiers, tests, documentation and machine contracts stay
English. M7.5 owns remaining application coverage and preference storage.

The installed string-key API is explicit: `enableSelector: false`, typed keys
and required interpolation parameters, `strictKeyChecks: true`, namespace `ui`,
synchronous local initialization, no detector/HTTP backend and no fallback
coverage. Validation checks required semantic keys, nonempty messages,
interpolation parity and each locale's plural categories. English one/other and
Chinese other are tested at 0/1/n. A deliberately missing translation is detected
even when an explicit engine fallback could hide it.

Each session/test gets a stable independent i18n instance. `useTranslation`
receives the effective `lng` explicitly; an external late `changeLanguage`
completion cannot revive a cancelled preview. `document.lang` follows the same
projection. Invalid input bundles and initialization faults retain an observable
error beside independently validated baseline resources. Supported-bundle faults
retain applied preferences and expose Restore bundled resources; Apply stays
unavailable until recovery. The provider observes active resource-store changes,
including faults that occur while Settings is already open. Recovery replaces
the namespace exactly and validates read-back before declaring success; it does
not deep-merge unexpected keys into a supposedly repaired bundle.
Unknown figure reasons display their structured code
with a neutral localized message, without matching English error text.

## Approved dependency cohort

| Exact desktop production pin | Actual consumer |
| --- | --- |
| `i18next` `26.4.2` | Local resource initialization, plural/number interpolation and typed messages |
| `react-i18next` `17.0.13` | Stable-instance subscriptions with explicit effective locale |
| `@radix-ui/react-dialog` `1.1.23` | The reachable owned Settings modal, containment and dismissal events |

Registry metadata and original distribution SHA-512 integrity, MIT licenses,
peers and relevant APIs were inspected before installation. The complete lock
delta adds 28 packages and 472 lines, removes no package/line, and retains every
old line in order. Added package declarations are MIT; Node engine declarations
are satisfied by Node 22.15.1, and React/TypeScript peers accept existing React
19.2.8 and TypeScript 7.0.2. `react-remove-scroll-bar` declares MIT but ships no
standalone license file; this fact is retained in the closure record. The three
direct distributions include their license texts. No install/postinstall script
was added or enabled. Development `prepare` declarations are recorded separately.

Intentional exact-pin install and subsequent `pnpm install --frozen-lockfile`
passed under pnpm 11.15.1. No unrelated version, toolchain or lock resolution was
changed. The `expect-webdriverio` 6.0.10 versus `@wdio/globals` ^5.6.5 peer warning
is present in the saved pre-install lock. Vite's frontend bundle emits its
>500 kB advisory; it was not hidden or converted into a build failure.
`dependency-closure-proof.json` and the registry/distribution records hold the
complete graph and compatibility details. This is not binary-distribution QA.

## Focus and issue #112

The new global modal reaches ConversionPanel's delayed picker-return mechanism,
so M7.1 owns the affected investigation. The old return flag did not record a
newer focus destination, could steal focus after that destination blurred, and
cleared before verifying focus landed. The old scope-return test used synthetic
clicks without native pointer focus semantics or a controlled final plan reply.

The repair retains return across absent/disabled controls and pending plans,
permanently yields to newer focus intent, and requires actual document foreground
before restoring. A window-focus event can settle an owned pending return.
Controlled tests cover cancelled picker, empty scope, delayed final plan,
newer destination then blur, Settings containment and foreground absence/return.
Settings itself guards Radix's deferred close return against later focus intent
and native foreground loss. IME Enter/Escape do not trigger dialog actions or
background shortcuts. A surviving enabled opener is the return target; otherwise
the existing app shell is the documented logical fallback.

These tests diagnose the current mechanism, not the exact cause of the historical
CI timeout recorded in #112. The controlled cases are in
[ConversionPanel.test.tsx](../../apps/desktop/src/features/mzml-preview/ConversionPanel.test.tsx)
and [SettingsDialog.test.tsx](../../apps/desktop/src/features/preferences/SettingsDialog.test.tsx).
The four native pairs below supply actual Escape and natural Convert-return
proof. The task PR and issue disposition link these two distinct evidence layers;
no timeout increase, blind retry, skipped assertion or post-picker forced focus
is counted as a fix, and the original intermittent failure is retained.

## Attributable validation and review

### PR #120 label activation follow-up

The shared field's visible caption was a `span`: its accessible name remained
connected through `aria-labelledby`, but clicking Width, Height or PNG DPI no
longer focused the input. A real browser click from the other field reproduced
the regression before repair: `browser-C1qjbi/evidence.json` records
`focused: false`, `labelTag: SPAN`, `labelFor: null` and unchanged raw `00640`.
`resume-20260913T024431Z/label-falsification-browser-01.log` and `.exit.json`
retain the failing assertion and actual exit 1, with its diagnostic screenshot.

`SettingField` now accepts an optional `htmlFor` for a single-input native label.
The two actual figure consumers provide their existing stable field IDs. Group
captions remain spans, and each radio keeps its existing native label. Raw values,
accessible names, help/error links, numeric validation and focus-return ownership
are unchanged. The focused browser spec exercises real label clicks from another
input in both consumers/locales. The native spec adds spectrum-label clicks in
both locales before the existing PNG and natural-return acceptance; its second
figure consumer remains opened only. No retry or timeout was increased.

New-build checks and paired native acceptance are pending. The identities,
browser results and four native runs in the following sections refer only to the
retained first build and its harness; they are not attributed to this repair.

### Retained first-build validation

All evidence paths below are relative to the retained local root
`D:/tmp/mscanvas-m71-20260912`, unless stated otherwise. Original logs, outputs,
launch identities, actual command exits and earlier failures remain available.

| Identity | Measured value |
| --- | --- |
| Product/build source | `0e47a8fb77f09b67266584fc224d6e8cfcdf16f6` |
| Product/build source tree | `a1a90252e32e2ab0ce43b6e3cd4598ac85fbc53e` |
| Native harness source for all four passing pairs | `b4ee24fb46d152c6dd3a09bd670b2fa09864f6fc` |
| Native harness source tree | `7f026c3e088834fa506a01726138eea0da24a79d` |
| QA executable SHA-256 | `e6060223a6efc876f7cfbf8eac3a7c2453c8180b660ac8d7616def853c40b592` |
| `build-inputs-3.json` SHA-256 | `5b83d8a93ec0491df93f7fa2a64f126e7efac130ce0069f38b2344f3d2f6b460` |

The executable is `target/e2e/release/mscanvas-desktop.exe`, built with the existing
QA features by `pnpm e2e:build`. All 154 production inputs matched the build
manifest before each successful pair. Commits through `e4fbab66c16a22726533ad44720dc51374502099`
change native harness or documents after that build, not its production inputs.
The subsequent label repair changes two production files. The first executable was not
rebuilt at the harness SHA. A QA executable is not an installer or release artifact.

| Gate | Result and retained record |
| --- | --- |
| Lint, frontend/e2e typecheck | Exit 0; `static-review-final-2.exit.json` |
| Full frontend suite | 73 files / 1726 tests; `pnpm test --maxWorkers=2`, unchanged timeouts; `frontend-tests-candidate-2.log` and `.exit.json` at product source above |
| Frontend and native QA build | Exit 0; `native-build-3.log`, `.exit.json` and the 154-input build manifest |
| Rust fmt, clippy with all targets/features and warnings denied, workspace tests | All exit 0; `rust-fmt-1-exit.json`, `rust-clippy-1-exit.json`, `rust-tests-1-exit.json`; Rust sources/manifests/toolchain unchanged from baseline |
| Final committed browser run | Three scenario groups pass at product source above; `browser-candidate-2.log`, `.exit.json` and `browser-candidate-2-inputs.json`; output `browser-DLkbRs` |
| Native helper changes | Focused type/parse/C# compile, wrong-owner and invalid-HWND refusal checks; exact records in `resume-20260913T024431Z`; final `native-save-text-checks-02.exit.json` |
| Repository/diff | Exit 0 on the product candidate and affected harness revisions; the task PR must establish final document checks and exact-head CI |

The substantive independent review covered all 47 initial changed paths and
actual consumers, state/focus/locale ownership and dependency closure. Three P2
findings were accepted: an active resource fault could bypass recovery, recovery
could retain unexpected keys, and a supposed DPR-2 footer was actually DPR 1.
Three controlled assertions first failed on the old code; the repaired resource
checks, full 1726-test suite and rendered checks passed. The affected six-path
product delta received GO. Subsequent native corrections received focused
read-only GO, ending at the exact harness source above. `REVIEW.md` retains the
object-bound verdicts; this is not a repeated full-review campaign.

## Rendered browser coverage

The final `browser-DLkbRs` run uses the real React composition with mock IPC.
It covers offline locale/density preview and rollback, raw drafts, keyboard,
provider/numeric errors, loading/empty/unsupported states and both shared figure
consumers. IME composition and resource-bundle fault/recovery coverage belongs to
the controlled integration/resource tests, including `SettingsDialog.test.tsx`;
those cases are not attributed to this browser run.
A controlled same-origin request succeeds before disconnection, fails with CDP
networking offline and succeeds after restoration. Locale changes work during
the measured disconnection. Application console and external-resource records
are empty; preserved browser-service cleanup warnings are separate diagnostics.

| Browser CSS viewport | DPR emulation | Coverage |
| --- | --- | --- |
| 1366 x 768 | 1 | Both locales, row 44 -> 32 -> 44px, raw draft, keyboard/modal return and state cases |
| 1920 x 1080 | 1 | English normal layout |
| 960 x 640 | 1 | Chinese narrow layout |
| 1200 x 800 | 1 | English intermediate layout |
| 1093 x 614 | 1.25 | Approximate 1366 x 768 physical-pixel presentation |
| 1280 x 720 | 1.5 | 1920 x 1080 physical-pixel presentation |
| 480 x 320 | 2 | Single-column dialog, scrolled footer/reduced motion and both shared consumers; actual raster 960 x 640 |

Fourteen shared-consumer records measure actual pointer focus, visible rectangles
and unchanged 13px type. Before/after DPR and screenshot raster dimensions agree.
The reduced-motion dialog has no animation. Browser and CSS zoom remain 100%.
These emulations are not Windows DPI or physical-input-device evidence.

## Actual Windows paired acceptance

The unchanged focused native spec passed once at each required pair, in order.
Each invocation exited 0 with all three scenarios passing. These are four pairs,
not a Cartesian viewport/scale matrix. `resume-20260913T024431Z/NATIVE_PAIRS.md`
and each `native-pair-*.PASS.json` retain primary readback and visual inspection.

| Windows scale / measured DPI | CSS viewport | Physical client / screenshot | DPR | Attempt / output directory |
| --- | --- | --- | --- | --- |
| 100% / 96 | 1920 x 1080 | 1920 x 1080 | 1 | `native-run-08` / `native-kC3YSK` |
| 125% / 120 | 1200 x 800 | 1500 x 1000 | 1.25 | `native-run-09` / `native-kjY2KZ` |
| 200% / 192 | 960 x 640 | 1920 x 1280 | 2 | `native-run-10` / `native-7HZ1Ro` |
| Restored 150% / 144 | 1366 x 768 | 2049 x 1152 | 1.5 | `native-run-11` / `native-orhhUn` |

The user changed scaling and supplied fresh readiness for each case. The final
case measures restoration to the initial 150%. The agent changed no global
display or security setting. Each newly owned app allowed one initial human
foreground opportunity; a 90-second guard required both the actual foreground
PID and `document.hasFocus()`. A human click itself was not measured. Once setup
passed, no manual click or scripted activation rescued a cancellation outcome.

A setup-only Win32 resize sizes the real client, preserving activation/Z order.
For every pair, five native screenshots have matching before/after Win32 and CSS
geometry, DPR, CSS zoom 1 and visual viewport scale 1. The visible window fits the
monitor work area. The 200% layout stacks and scrolls; other existing panels also
scroll. Settings and the targeted acceptance controls are visible, without a
claim that all workspace content is simultaneously on screen. At 125%, wrapped
names give actual 55 -> 47px rows; the other pairs measure 44 -> 32px. Minimum
row tokens are not a claim that every wrapped row has a fixed height.

Each run reads the retained lawful mzML through actual Tauri/provider boundaries,
activates the real roster/scan and preserves the numeric draft through locale and
density changes. It applies/cancels/resets Settings, dismisses with actual Escape,
and verifies natural opener return. One real spectrum PNG is written from the
canonical request `{ widthPx: 640, heightPx: 480, pngDpi: 144, theme: "light" }`.
The second native figure consumer is opened only; its interaction/isolation proof
belongs to the browser/integration layer above.

The owned modern save dialog exposes `FileNameControlHost` / native `Edit` 1001,
with no UIA ValuePattern in these runs. The reviewed helper uses exact PID/HWND,
parent/class/resource/editability checks, bounded Unicode `WM_SETTEXT` and exact
`WM_GETTEXT` readback before the owned Save button. The actual file, not helper
success alone, must satisfy the PNG assertions. The conversion folder picker is
closed with actual Escape; all four return captures measure document focus,
active Convert and foreground ownership without post-cancellation focus rescue.
The unavailable-plan and newer-user-intent cases remain controlled integration
proof, not artificially injected states in the native provider.

Every output PNG is 640 x 480, 12,353 bytes, with pHYs 5669 pixels/m (144 DPI
rounded). All four have SHA-256
`4cf1c300edf3a4361c782261723b416113cb62ebe3641d85ddfb7ed266b670f9`.
Export metadata DPI is independent of Windows window DPI. Every run has three
empty app-console records and an empty mock IPC table. Local `http://ipc.localhost`
traffic is recorded separately; no external resource was observed. Fixture hashes
are unchanged: mzML `a1228c104790670515f948f523dfe43caa7085cedb7d57d19ed07cbca5775ea7`
(28,616 bytes), RAW `b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b`.
No new scientific data was acquired. Each run released its app/drivers and
process-local ports 4490/4491. Driver and WebView2 were both 152.0.4191.66.

| Retained native `evidence.json` | SHA-256 |
| --- | --- |
| `native-kC3YSK/evidence.json` | `e3e673225e73398be5c1cef249faca73607c6f2cffca5f6bf15572db17d1531c` |
| `native-kjY2KZ/evidence.json` | `ea82fc96ad3ac8f13d8a9af1d389abc186d7eb6842e729b464dca87adb974c4e` |
| `native-7HZ1Ro/evidence.json` | `89ca7f4e7e1db8e5f992b2766920321fe940aefc46c29a51436fdc9c7f20e449` |
| `native-orhhUn/evidence.json` | `1bf4eb18f8f05cb2f5d655313c3188c13eebd13555226b8430d5c4967a0a5884` |

For each pair, `01-native-chinese-preview.png`, the actual spectrum PNG and
`05-native-cancelled-picker-natural-return.png` were visually inspected. The
retained screenshot headers carry the physical dimensions in the table; a
viewer may resize their display. No prototype image substitutes for this QA.

## Retained failures and publication boundary

| Earlier attempt | Established limitation and disposition |
| --- | --- |
| First frontend full run | Five stale-contract/settlement assertions and one LinkedViewer 5s timeout; affected assertions repaired, then 1723 tests passed; three resource regressions brought the final suite to 1726. No historical timeout cause is declared environment-only. |
| Earlier browser runs | Unicode `btoa` preload and selector faults repaired; an old footer was DPR 1 despite its label and is limited to CSS reflow. Measured capture, real consumer focus and 8px numeric scroll margin replaced the false scale claim; warnings/failures retained. |
| Original native attempt 1 | Setup `focused: false`; no native scenario passed. Missing post-activation ownership was not invented. |
| `resume-20260912T214819Z/native-run-01` | Local IPC was misclassified as external; provider/Escape observations were partial, not a passing run. Exact-origin classification and negative controls repaired it. |
| `resume-20260913T024431Z/native-run-02` and `03` | CSS/physical-size drift; run03 measured WebDriver changing DOM dimensions while the real client stayed smaller. Exact native client sizing replaced it. No human-resize cause is inferred. |
| Same directory, native-run04 through07 | Owned save dialog/control readiness failures; run06's failed subcondition was not isolated. Run07 established exact filename edit found but ValuePattern unavailable. Bounded text entry with exact readback repaired that observed gap. No PNG or full pair is attributed to these failures. |

The complete pairs all use the same reviewed harness and unchanged product build;
failed partial observations are not assembled into a pass. M6.6-M6.9 native
campaigns were not re-entered. Before M7.1 completion, the task PR must establish
final scoped document review/checks, live protections, required exact-head CI and
resolved threads, protected true merge with two ordered parents and candidate-equal
tree, natural push/main CI and ff-only clean local closeout. The issue #112
disposition links controlled recovery/user-intent and actual natural-return proof.
M7 stays in progress; no public beta was built or released by this slice.
