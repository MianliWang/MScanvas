# M7.1 — Localized Settings and shared controls

Status: **implementation candidate; required native validation pending**.
This is not M7.1 completion or a published public beta. M7.2 is next, not started.
M6 remains complete; the post-M6 XIC interlude remains complete on its
non-admission branch. XIC is not admitted or implemented.

Baseline: `f743f9d9c72e834cc47efb1671ace8ed737842a0` (M7.0 / PR #119).
Route owner: [ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md).
Task branch: `feat/m7.1-localized-settings-shared-controls`.
Local checkpoint and raw evidence: `D:/tmp/mscanvas-m71-20260912`.
No M7.1 PR, merge, natural-main CI or branch cleanup has been claimed.

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
unavailable until recovery. Unknown figure reasons display their structured code
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
is present in the saved pre-install lock. Vite's current 518.38 kB JS bundle emits
its >500 kB advisory; it was not hidden or converted into a build failure.
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
CI timeout recorded in #112. Its closure remains pending the affected actual
native-picker proof. No timeout increase, blind retry, skipped assertion or
post-picker forced focus is accepted as that proof.

## Validation and remaining proof

Raw logs retain actual exits and all earlier failures. Frontend full-suite attempt
1 had five stale-contract/settlement assertions and one LinkedViewer 5s timeout.
The affected 56-test run passed after updating real consumer assertions. The
complete suite then passed with two workers: 73 files / 1723 tests, unchanged
scope, assertions and timeouts. The timeout's precise historical cause is not
declared environment-only. Focused resource, draft, IME, async-work, no-extra-read,
numeric/canonical and uniqueness tests use real resources and isolated runtimes.

Lint, typecheck, frontend build, e2e typecheck and Rust fmt/clippy/tests have
passed during implementation; final candidate attribution and repository/diff
checks remain to be recorded. Rust behavior was not changed by this UI slice.

Browser attempt 1 exposed the pinned WDIO `btoa` preload's Unicode limitation.
The existing harness now JSON-escapes UTF-16 code units for transport and parses
the original values. Attempt 2 exposed two new-test selectors that did not match
the production `aria-labelledby` grid or nested WDIO query syntax. Attempt 3
passed all three scenario groups with zero application console entries and no
external resource entries; driver-side tauri-service browser-window and cleanup
warnings remain in the raw log. Attempt 4 (`browser-1eGHYY`) passed all three
groups after the final field-border/focus styling correction. Its controlled
same-origin network probe reached the server before disconnection, failed while
CDP networking was offline, and reached it after restoration. Both locales and
preference changes worked during that actual disconnection, with no external
resource entries or application console errors. The earlier `navigator.onLine`
preload is not counted as disconnected networking. Final screenshots were
inspected, including the shared numeric error, CJK layout and the scrolled 200%
emulation footer with reachable actions; the recorded reduced-motion dialog has
no animation. Browser-service warnings remain distinct from application errors.

| Browser CSS viewport | DPR emulation | Coverage |
| --- | --- | --- |
| 1366 x 768 | 1 | Both locales, real row 44 -> 32 -> 44px, raw figure draft, keyboard/modal return, state cases |
| 1920 x 1080 | 1 | English normal layout |
| 960 x 640 | 1 | Chinese narrow layout |
| 1200 x 800 | 1 | English intermediate layout |
| 1093 x 614 | 1.25 | Approximate 1366 x 768 physical-pixel presentation |
| 1280 x 720 | 1.5 | 1920 x 1080 physical-pixel presentation |
| 480 x 320 | 2 | 960 x 640 presentation, single-column dialog, scrollable footer/reduced motion |

Browser zoom and CSS zoom remain 100%; these DPR cases are **not Windows scaling
or physical-device evidence**. Actual Windows input desktop was readable as
`Default`, with a 144-DPI foreground window before testing. That host observation
does not prove the app's scaled interactions.

Native attempt 1 launched the attributable QA-enabled WebView2 app but stopped
in setup: `focus-window` returned `focused: false`. No Settings interaction,
provider read, PNG output or native picker return passed in that attempt. The
helper return was retained in the failed assertion; post-activation HWND ownership
was not captured before that stop. The harness now also preserves before-all
failure evidence. Manual initial foreground is an explicit host prerequisite when
automatic activation is refused; it retains the real foreground/document checks
and never forces focus after a picker. A host-action request is pending.

The prepared focused native suite uses a retained 28,616-byte mzML
SHA-256 `a1228c104790670515f948f523dfe43caa7085cedb7d57d19ed07cbca5775ea7`
and the existing lawful Thermo fixture SHA-256
`b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b`.
It reads through actual Tauri/provider boundaries, verifies one 640 x 480 / 144 DPI
PNG and canonical argv-independent numeric settings, then cancels the real
conversion folder picker and checks natural return. Sources and new outputs are
retained. No scientific data acquisition or mock provider success is substituted.

Required closeout still includes attributable native success, one isolated
read-only full-diff review and dispositions, final gates, protected reviewed-head
true merge, ordered-parent/tree proof, natural main push CI and ff-only local
cleanup. Until those complete, **M7.1 is not complete**.
