# M7.2 — Workbench shell and roster organization

Status: **implemented; local checks, targeted native acceptance and independent
review complete**. Protected publication identities and main-CI closeout are
recorded in the task PR and retained local closeout, not inferred from this status.
Baseline: `bdc8470e9e00aa21aab61316caff04d0fa6d7817` (M7.1 / PR #120).
Task branch: `feat/m7.2-workbench-shell-roster-organization`.
Route: [ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md).
Local evidence: `.tmp/m72-evidence/` (ignored, retained for closeout).

## User goal and accepted continuation

Researchers organize admitted acquisitions, inspect their real data and prepare
conversion without losing work when changing panels. Continue the tracked
[v5.11 baseline](DESIGN_SYSTEM.md#durable-v511-reference-baseline): a quiet light
shell, one Home action, grouped roster and dominant evidence area. Retained
scientific, conversion, result and export consumers keep their operation owners.

The preceding shell could follow the host dark theme and had a flat roster with
one selection shared by removal and conversion. This slice separates keyboard focus, viewed acquisition,
highlighted interaction selection and curated conversion membership. Grouping
changes ID references and browsing order only. Rust retains dataset authority;
the existing M6.7 resolver receives the complete roster and explicit execution
sort. No provider, queue, persistence or scientific capability is added.

Interaction budget: Home or task navigation takes one activation; view takes one
unmodified row activation; Ctrl/Shift select without reading; organization takes
one drag/drop or a named Move to group action; one Undo reverses an applicable
local transaction. Group creation/rename requires a label and confirmation.
Group dissolution returns members to ungrouped. Remove highlighted uses the
existing non-destructive Rust operation. Invalid or stale drops cancel, preserving
the complete payload; unsafe undo explains refusal. Escape and keyboard paths
remain available, and reduced motion preserves outcomes.

## Implementation plan and intended path closure

1. Add a pure ID-based organization/transaction model and focused tests under
   `apps/desktop/src/features/workbench/`; separate conversion membership in the
   existing roster reducer and migrate its real scope consumers.
2. Add stable shell/navigation, grouped roster consumers, local menus, Motion
   disclosure and pinned dnd-kit integration. Extend existing en/zh-CN resources
   and shared light tokens. Keep mounted authority above presentation hiding.
3. Verify real composition, async state/queue boundaries, variable-height and
   offscreen interactions, keyboard/IME/cancellation, native-drop subscription,
   before/after geometry and motion. Refresh affected Windows paths in one
   announced session at measured current DPI.
4. Run relevant checks, one complete independent read-only review and focused
   repair reviews; publish the actual reviewed head through protected true merge,
   natural main CI and proved-included task-branch cleanup.

Intended existing paths: desktop package manifest and root lockfile; workspace,
roster selection/view and conversion-scope adapters and tests; preferences locale
resources/validators; desktop shared styles; affected browser/native E2E helpers
and specs; this record, design system, primary workflows, screen/feature model,
proposal and roadmap status. New directly related paths will be announced before
editing. Rust authority changes are not currently planned. Historical records
retain dated results; M7.3–M7.6 remain unentered.

## Dependency and input closure

Dependency inspection and frozen installation completed: the five explicitly
authorized direct pins add 27 packages; existing locked package/snapshot entries
remain unchanged. Registry, lock and downloaded SHA-512 values match; all new
packages declare MIT and include license text, with no install lifecycle scripts.
Details: `.tmp/m72-evidence/dependency-closure.json`.

Exact direct pins: `motion` 13.2.0; `@dnd-kit/react`, `@dnd-kit/dom` and
`@dnd-kit/helpers` 0.5.0; `@radix-ui/react-dropdown-menu` 2.1.24. The conditional
menu package has real row/group consumers. React, TypeScript, Vite, Tauri,
M7.1 locale/Dialog and Rust/toolchain manifests remain at their prior pins.
The lockfile adds 415 lines and removes none. Local Node was 22.15.1, within the
declared engine; `.node-version` remains 22.23.1 and pnpm remains 11.15.1.

The new `pnpm e2e:build` completed with byte-identical production inputs before
and after compilation. `build-inputs-before.json` and `build-inputs-after.json`
separate production and harness manifests. Documentation changes do not require
a new executable; any changed production input does.

| Identity | SHA-256 |
|---|---|
| Production input manifest | `4bb9a6b49ad7490047ffa4a78b593a437e59c4c87d288f6f92527ec43231c8b0` |
| New E2E executable, 16,225,280 bytes | `a3d59f59eb259db6e5eca3a87d78163de72c192f08a93520a6553c224114ebdd` |

This is the optimized Tauri E2E binary, not an installer or public release. The
native spec requires an empty mock-answer table and observes real IPC without
changing results. A production-input match binds a later reviewed commit to this
build; the baseline HEAD alone does not describe the uncommitted build inputs.
Build 02 follows diff-check whitespace cleanup in two source files. The JS and
CSS bundle bytes are identical to build 01, so browser/unit evidence remains
attributable; the initial native acceptance uses build 02. Both build manifests/logs
are retained. JS `index-sDn2wpEU.js` has SHA-256
`1ef4e9f9e645d0bdd0a438d171e9ad7a585d65417036e6297d462df35a7d0037`;
CSS `index-BGlbuSQr.css` has SHA-256
`61464f122d149444b54c238a0392007fa61b599f5352df7ca9162e8f6d9a8828`.

## State, organization and unchanged authority

`rosterSelection.ts` holds independent focus, viewed identity, highlights and
conversion membership. File-picker additions preserve the new-batch default;
folder/drop/adoption additions union new membership, and read-back only
reconciles it. Modifier clicks, keyboard movement and organization do not read.
The complete roster plus existing explicit sort remains the sole M6.7 execution
input. Consumer tests retain an unstarted review across group movement,
collapse, search, undo, Home and Settings; membership/scope/execution-sort edits
still invalidate it. Running and retry queues retain bound members/order.

The one-level organization model stores only handles, group IDs, labels and
bounded inverses (20). A captured drag includes hidden/offscreen highlights in
full browsing order. Full-ID target anchors preserve filtered siblings; empty
and collapsed groups append deterministically. Stale membership/revision and
invalid destinations refuse the whole transaction. Safe undo preserves new
imports and refuses missing required IDs; it never restores a roster snapshot.
Group names remain raw labels, including CJK and path-like text.

The pinned sortable consumer disables only `OptimisticSortingPlugin`, whose DOM
reparenting broke React-owned window unmounts during real auto-scroll. It retains
`SortableKeyboardPlugin`, dnd-kit sensors/collision/overlay/auto-scroll and a
target highlight; the local ID transaction commits on drop. No second geometry
engine or active Motion transform is added. Rows above the 80-item threshold
use measured heights and retained focus/source nodes; manual scrolling cancels
pending focus reveal. The Rust capacity stays 1,024, with a 200-row rendered
stress sample and a 1,024-row application contract test, not an arbitrary-scale
claim.

The shell localizes changed labels, menus, errors and announcements through the
existing en/zh-CN bundles. Workspace notices store typed message tokens and raw
facts, never translated domain strings. Provider output and user names remain
verbatim. Untouched scientific/backend and conversion/figure internals retain
their later M7.3/M7.4/M7.5 owners. No scientific rendering or export contract,
provider/queue authority, native-drop admission or acquisition files change.

## Local acceptance and rendered evidence

All paths below are under the ignored, retained `.tmp/m72-evidence/` directory.
The initial full frontend run `full-unit-03` passed **1,758 tests in 77 files**.
The final browser run `browser-16` passed all three scenarios, with 24 captures
and frame/geometry/IPC evidence in `browser-OIcFmW/`. Actual app console entries
were empty in those passing scenarios. Existing picker-return tests are retained.

| Layer | Measured coverage / result |
|---|---|
| Browser composition | Chrome 152.0.7977.84, real React/Vite, controlled IPC answers; 3/3 scenarios pass |
| Wide and constrained geometry | CSS 1920×1080 at DPR 1; 1366×768 at 1.5; 1200×800 at 1.25; 960×640 at 2; measured raster pairs, no horizontal overflow, reachable header controls |
| Interaction | Independent checkbox/highlight/view; Home/navigation; menus; rename focus; IME event boundaries; keyboard pickup/arrow/Enter/NumpadEnter/Escape; pointer multi-drag; empty/collapsed targets; hidden payloads; undo |
| Windowing and cancellation | 200 IDs with fewer than 80 mounted rows; End focus, manual wheel and dnd-owned auto-scroll; full offscreen payload; outside, keyboard, automated pointer cancel, actual tab focus loss and async Rust-answer removal cancellation |
| Localization and states | en/zh-CN, both densities, empty/refused/loading/recovery and retained in-flight read; changed live announcements in Chinese preserve raw provider refusal prose; reduced-motion cancellation remains usable |
| Frontend/Rust gates | Frozen install, lint/typecheck (the repository's TypeScript scripts), 1,758 tests, new frontend/native build, E2E typecheck, repository validation and diff check pass. Fresh local Rust fmt/clippy/workspace tests pass: 1,556 passed, 23 ignored (nested child output not counted twice). Required exact-head remote gates remain pending |

Motion evidence is the actual pointer sequence `03-pointer-pickup.png` →
`04-pointer-target.png` → `05-pointer-drop.png`, plus keyboard frames 07/08 and
windowed auto-scroll frame 09a. These are real interaction captures, not an FPS
measurement. DPR emulation is not a Windows-scale result; automated CDP touch
cancellation is not physical touchscreen testing. Composition-event checks are
not an OS IME certification.

Historical native M7.1 images are before-state illustrations only. Current
browser frames illustrate the new layout with controlled metadata, not new
scientific/provider capability. The first browser scenario inherits a null
`subscribe_workspace_drop_updates` receipt from `e2e/support/fixtures.ts`;
`dropTransport.ts` correctly refuses that missing reservation. Its visible
Explorer-unavailable banner is browser layout evidence with a failed mocked
subscription, not deliberate native-failure coverage or native import proof.
Later browser scenarios supply controlled receipts only for their own layer.
The final native run below establishes the actual subscription and OS import.

Against v5.11, the light shell, single Home action, grouped roster and quiet
evidence hierarchy are retained. The intentional drag disposition is a target
highlight and compact count without a long insertion line. Native frames retain
their actual scroll positions; the scientific/figure consumers remain unchanged
and are not a new full-plot layout or scientific qualification in this slice.

Two serial isolated reversions in `falsification-01/` discriminated the intended
seams. Routing conversion through highlights failed requested-count assertions;
dropping intervening imports from an undo inverse failed the applicable-undo
assertion. Both restored copies passed, and writer/copy hashes matched. Package
entries were read through explicit aliases; no mutable node_modules/build
junction was shared and the writer's source was never mutated.

## Review and retained failures

One isolated read-only full-scope review used `review-01/source` (441 files;
manifest SHA-256 `b94a80890136366cbe19002b290d57dbac4725040e5aa063054a0e738feb4ba0`).
Its four P2 findings were confirmed and repaired: composition Escape handling,
disclosure focus theft, rename return to an unmounted menu item and untranslated
roster live announcements. Rendered checks now exercise all four. The repair
delta in `review-02` (443 files, 21 changed paths) independently confirmed all
four fixes and found no further definite product defect. Its additional P2 was
a native harness assumption: adding B to a nonempty workspace does not
automatically preview B. The harness now explicitly activates B and observes
the real read settle before testing B-to-A navigation overlap. This targeted
harness repair passed isolated `review-03` readback (SHA-256
`ca18f695d3fab8999e37c211867633ad3b8a7ac1bffbc6d26115bd98ba48caeb`).
Native execution then exposed an immutable Tauri `invoke` property, so the
attempted wrapper produced no timing trace despite successful real previews.
The repaired observer uses actual Windows IPC Resource Timing and a surface
MutationObserver; it neither replaces requests nor changes results. `review-04`
confirmed this delta. The final native spec has SHA-256
`79c894b61063a2db6b23afbdba2e5464edf937093518614194974d7457567015`.

`review-05` examined the optional real Explorer input helper. Its two confirmed
findings were fixed before OS use: unsafe release at old coordinates after a
foreground change, and cleanup exceptions skipping recovery/evidence output.
`review-06` confirmed guarded cancellation, movement-free release, refusal with
manual-recovery evidence on foreign foreground, and preserved JSON output.
`review-07` confirmed the runtime-only .NET hashing and UTF-8 output correction.
The final helper SHA-256 is
`9d55edf149df34623381460bafd81914287dcf519015e9474734f6e010f2726e`.
The pre-publication independent review had no remaining finding. Reviews are
static; native results are below. Later PR findings and their affected refresh
are recorded separately at the end of this record.

Retained diagnostic runs are not acceptance gates. Initial consumer migration
failed 117 of 1,749 tests; the later full run had three ambiguous text selectors
before the final passing run. Browser failures separately exposed portal events
activating previews, a clipped count, keyboard-code handling, variable-height
focus reveal and optimistic DOM reparenting. Harness-only failures included an
empty search setter, unbalanced key sources, a virtualized target lookup and
non-cancelable synthetic IME events. The app and harness repairs keep these logs
and images; a later pass does not erase them. `check_repo.py` now skips the
already-ignored `.tmp` directory so downloaded inspection-package README links
are not mistaken for owned project documentation.

## Targeted native acceptance and publication handoff

Fresh desktop availability and continuation were supplied in the execution
conversation. Windows scaling was measured, never changed. Native run 04 passed
all **3/3 scenarios** in 28 seconds (runner 30 seconds), exit 0, with empty mock
answers and console. Evidence: `native-KBLm3r/`; launch/raw log/exit:
`resume-native-20260913T220412812Z/`. Session
`e8dbc34a8d120c5971f55baff2d929b0`; PID 39700; HWND 922914;
WebView2 and EdgeDriver 152.0.4191.66. Build 02 remains attributable to the same
production manifest and executable hash above, not to a later documentation
commit. The preserved source head was
`13745b123c88d8fb93c3dbeb84e47458328d4fc3`; only harness changes followed it.

| Proof | Actual result |
|---|---|
| Native geometry | 144 DPI / 150%; CSS 1366x768; client and PNG 2049x1152; CSS zoom 1; frame inside 3840x2160 monitor / 3840x2088 work area; zero horizontal overflow |
| Real source and pending work | Real admitted A/B/A mzML reads; B explicitly activated and settled. A request interval 9254.4–10424.9 ms includes Conversion navigation at 9266.6 ms. This is one actual overlap, not a provider latency guarantee |
| Mounted state | Real selected spectrum, raw width draft `0640`, active source, Home/navigation and en/zh-CN comfortable/compact Settings survive without new operations |
| Internal organization | Actual WebView2 pointer drag moves A and RAW into Native group; only RAW remains checked. No preview/conversion/ingestion is started by that move; frames 03/04/05 |
| Actual Explorer import | Exact file plus folder selected in Explorer HWND 8586680 / PID 53484, then Windows SendInput drag to measured CSS (148,592) / physical (613,1313). Real native subscription imports file-3/4/5 into Ungrouped; Native group remains 2, total roster 6; no additional preview or subscription |
| Natural cancellation | Owned acquisition picker Escape closes normally; document focus and foreground PID return to the live Add files control without any post-cancel click, focus call or activation; frame 07 |
| Resource boundary | Raw URLs retained; only exact Tauri application and `http://ipc.localhost` origins present; external resources empty |

The Explorer route uses the local
[ShellFolderView selection API](https://learn.microsoft.com/en-us/windows/win32/shell/shellfolderview-selectitem)
and [Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput),
with exact path/hash, HWND/PID, foreground, UIA source and physical target guards.
It never injects paths into DOM or calls ingestion directly. The helper restores
the source Explorer selection/placement and checks the fixture bytes again.
The final run required no reported human mouse action. Automated pointer and OS
input are not physical touchscreen qualification; failure-cleanup branches were
statically reviewed, not exhaustively exercised on the desktop.

All earlier native attempts remain unsuccessful records:

| Run | Evidence / exit | Disposition |
|---|---|---|
| 01 | `native-J4375n`; exit 1 | Real previews succeeded; immutable-invoke timing observer failed. Repaired and reviewed |
| 02 | `native-xQPTjQ`; exit 1 | Real pending-work/state and internal-drag assertions passed; manual Explorer phase timed out. User subsequently confirmed no desktop action was performed; not a product drop failure |
| 03 | `native-SoJnDz`; exit 1 | Helper stopped before selection/window input because the Windows PowerShell child lacked Get-FileHash; original diagnostic encoding retained. Replaced by .NET SHA-256 and UTF-8 output |

Harness checks refreshed: `e2e-typecheck-06/07`, PowerShell parsing/C# compilation,
the exact fixture hash and wrong-process refusal (JSON, exit 1 before window
mutation), diff check, and the focused reviews above. The unchanged 1,758-test
frontend run, three browser scenarios, local Rust gates, dependency closure and
two isolated reversions were reused by input identity, not rerun. No new build
was needed for harness/documentation changes or a repeated physical DPI cycle.

Ordinary publication still requires actual reviewed-head checks and resolved
threads, protected true merge, ordered parent/candidate-tree proof, natural
push/main CI and ff-only local closeout. The PR and ignored local closeout hold
final merge/run identities without a self-referential source commit. M6 and the
post-M6 XIC non-admission interlude remain complete; XIC is not admitted or
implemented. M7.3 remains next and not started. No public beta, installer, tag
or release is produced by this slice.

Live GitHub main was still the expected M7.1 baseline. The active `Protect main`
Ruleset 19660027 requires up-to-date Frontend, Rust and Repository quality checks,
a PR and resolved review threads; the legacy branch-protection endpoint returns
404. This is Ruleset protection, not an absent protection claim. All live merge
inputs must be read again immediately before publication.

## PR 121 corrections and attributable acceptance refresh

PR [#121](https://github.com/MianliWang/MScanvas/pull/121) was created from
`e9b150fb49b2d8d9bf3d7286609b210341118a62`. Frontend, Rust and Repository quality
each passed on attempt 1 for that head. Automated review then raised two P2
findings; both were confirmed and repaired on the same task branch:

- Same-group keyboard movement now announces each changed insertion position
  before commit, using the complete destination order and captured payload.
  Hovering the selected payload reports the existing no-op. Both locales use
  the typed and runtime-checked numeric position contract. Data movement,
  dnd-kit geometry and Rust authority are unchanged.
- Details is disabled until a preview is loaded. Effective Inspector visibility
  is derived from both the requested panel state and preview availability, so
  an already-open Inspector also closes during a new read or a failed read.
  The main evidence states and existing retry remain reachable at constrained
  widths. The previous panel request remains a presentation preference.

Only six production paths changed: PreviewWorkspace, WorkbenchHeader,
GroupedRosterList, the i18n boundary and its en/zh-CN resource values. Build 03
records all 166 production inputs before and after compilation, unchanged
during the build, with production-manifest SHA-256
`c6f4eb24cdfb824e0b3d85e1ba1229c04d74888a0d1ab22a65284015a664de45`.
The optimized E2E executable is 16,225,792 bytes, SHA-256
`1cc2f3580ed574ed417071b1772ee15bc6db63fb612855db67d2cb07940d2e64`.
JS `index-B3wknL44.js` has SHA-256
`addccf2e841e77f5136fd8c5ef8af97a28a435ef78860ac9ff72033b503bd670`;
the CSS bytes remain identical to build 02. Build 02 and its executable,
manifests, logs and acceptance remain retained as earlier evidence.

The affected browser run `browser-19-review-after` passed 2/2, with 18 captures
in `browser-X2yRJx/`, no console entries and zero horizontal overflow. It proves
successive keyboard destinations and committed order in both locales, and
empty, reading, failure, retry, loaded and already-open Inspector transitions
at 960x640/DPR 2 and 1366x768/DPR 1.5. A held malformed preview DTO exercises
the real adapter's retryable protocol failure; this is controlled browser IPC,
not a native provider failure or native DPI result.

Supplemental run `browser-20-wide-inspector` passed the affected Inspector
scenario with 16 captures in `browser-qapTps/`, adding initial 1920x1080/DPR 1
in both locales before the constrained transitions. Console entries and
horizontal overflow remain zero. This is an affected layout extension, not
a repeat of the unchanged browser campaign.

Affected native run `native-2gAVwr/` passed 2/2, exit 0, in 21.7 seconds; launch
and raw log are in `review-native-20260914T003441353Z/`. Session
`4f1099683be54bd338959cbe3fb82962` used WebView2/driver 152.0.4191.66 and the
build-03 executable. Actual Windows DPI remained 144 (150%): CSS 1366x768 maps
to client/raster 2049x1152, and 960x640 to 1440x960. Six captures have zero
horizontal overflow; the mock table, console and external resources are empty.
The run verifies narrow empty/loaded Details, real A/B/A preview reads, retained
source and raw `0640` draft, and en/zh-CN keyboard target feedback followed by
commit and Undo with no additional IPC. The actual read interval
11929.1-13079.8 ms contains the observed navigation. This is one measured
overlap, not a latency guarantee or new scientific-renderer qualification.

The unchanged Explorer import and natural picker-return scenarios were not
repeated: build-02 `native-KBLm3r/` remains their actual native evidence. The
six-path product delta does not change their admission, subscription, input
helper or focus-return mechanism. No physical DPI cycle was requested or run.
Task native processes and ports 4490/4491 were confirmed released after the run.

Independent read-only delta review `review-09` verified all nine snapshot
hashes and found no confirmed actionable issue. It compared destination
positions against the existing reducer and reviewed Inspector state and the
affected harness. It did not replace rendered or native execution.

Failure history is preserved. Browser run 17 failed both regressions on the
original product. Run 18 exposed an omitted numeric runtime parameter and a
test that supplied a rejection envelope to a held resolving call; both were
corrected before run 19 passed. The interim full frontend run 04 passed 1,758
tests but reported three worker-termination timeout diagnostics; it is not
presented as a clean run. After correcting the runtime numeric boundary, final
`full-unit-05` passes **1,759 tests in 77 files**, exit 0, without those timeout
diagnostics. The numeric boundary test separately passes 12/12. Lint/typecheck,
E2E typecheck and build 03 pass. Required checks, individual PR
thread disposition, protected merge and main-CI/local closeout remain publication
gates, recorded against their actual final identities in the PR and local closeout.

### Conversion status belongs to the conversion/results lane

The subsequent automated review of `5e166e282fe1f83dcb0a8ef67873dc29920781c4`
confirmed a third P2: acquisition-only preview, folder and drop activity was
incorrectly included in the Conversion navigation status. A one-line correction
passes only `workspace.conversion.busy`; conversion/results lane activity and
retained results keep their existing status semantics. Independent read-only
`review-11` verified the three changed snapshot files and found no issue.

Browser run 21 failed the new held-preview status assertion before the repair.
Run 22 passed the affected scenario, with nine captures in `browser-KuAB0J/` and
an empty console. The related App consumer tests pass 136/136; the unchanged
full-suite result remains 1,759/77 from run 05. E2E typecheck 10 passes.

Build 04 changes only PreviewWorkspace from build 03. All 166 production inputs
match before and after compilation; manifest SHA-256 is
`144a31487fde6ae76c16cd9597a5ffb90d72c3aff3e71dd784103e3a76556734`.
The 16,225,792-byte optimized E2E executable has SHA-256
`c6aebaaac605b5f9a325eab31871ce9e2a623316790b5ef5f98629098d2fcdb3`.
JS `index-qdm48qKB.js` has SHA-256
`db6f2822660af1e64c01963354c5e6db65ed71f55e18d3b51caf80e1c0a012bd`;
CSS remains unchanged. Prior build 03 and its evidence/executable are retained.

The affected native scenario passes 1/1, exit 0, in 14.9 seconds on build 04;
evidence `native-8v9XlU/`, launch `badge-native-20260914T012102446Z/`, session
`fd29680247fa371829f277f9003aafbe`. Actual DPI remains 144 at the same measured
1366x768 and 960x640 CSS/client/raster pairs. At 11257.1 ms, inside the actual
preview read interval 11245.6-12420.8 ms, navigation changes to Conversion while
`conversionBadge` is false. Real source, raw figure draft and Settings/Home
retention also pass; three captures have zero horizontal overflow, and console,
mock answers and external resources are empty. This refresh does not repeat
the full keyboard, Inspector, Explorer or picker-return acceptance. Task
native processes and ports were measured released afterward.

### Accepted row activation reveals the evidence surface

Review body 5193050529 on the first repair head identified a fourth P2: a row
request could read behind the selected Conversion surface or constrained roster.
The existing activation guards now return whether a read actually started.
Only an accepted request selects Workbench and closes constrained side panels;
focus then moves to the visible evidence region. Rejected, modified-selection
and vendor-row actions do not navigate. Later deliberate navigation remains
authoritative even when the accepted read finishes afterward.

Review thread 4001647805 on `4240285d044dee5873f26e7298a9c11aa0d43cf7`
identified a fifth P2: the initial unknown capacity sentinel was displayed as
real capacity zero. The context paragraph is now omitted until the first
authoritative roster arrives, including after an initial failure. Existing
retry and add-file recovery remain available. No resource or domain contract
changes are needed.

Build 06 records all 166 production inputs unchanged during compilation;
manifest SHA-256 is
`8ba3eb50d1a9f8c2c5cec5f4a596258dab68ee5b9a15829bd4536e4a68fc1a92`.
Only PreviewWorkspace, usePreviewWorkspace and DatasetRoster differ from build
04. The 16,225,792-byte optimized E2E executable has SHA-256
`057fcbbcb11759b383437109428528c15f0c6227bb98799328b6f33a976aaef7`.
JS `index-CvZeeger.js` has SHA-256
`7768f4ac745f1903cccb8c205ba5035bfb25dfbed37c5d045994f228f35558f4`;
CSS remains unchanged. Intermediate build 05 completed and is retained, but
was not exercised natively: the later capacity correction was batched into
build 06 before the affected native run.

Browser run 23 reproduced hidden evidence before the activation repair; run
24 passed afterward. Run 25 reproduced the unknown-capacity defect before its
repair. Final affected run 26 passes 2/2, exit 0, with nine captures in
`browser-eojRSm/`. It covers pointer, Enter and Preview focused activation,
vendor/modified/busy refusal and deliberate later navigation in en/zh-CN at
1366x768 and 960x768, DPR 1.5. It also holds the first roster response through
loading, protocol failure and successful retry in both locales. Console and
external resources are empty, and horizontal overflow is zero. The browser
launcher reported forced cleanup of its own dev server; the test and command
exit are successful, and no task browser watcher was found afterward.

Build-06 native validation passes 2/2, exit 0, in 23.1 seconds; evidence
`native-GCTiCP/`, launch `reveal-native-20260914T022250612Z/`, session
`8b4c9c5c7eba9a7893b3c3d981d58d1d`. It reads the actual Rust roster capacity,
retains real A/B/A work and the raw figure draft across navigation, and reveals
real acquisitions from Conversion with a pointer at 1366x768 and Preview
focused at 960x640. The narrow roster closes and focus reaches visible evidence.
Five captures retain the actual 144 DPI / 150% CSS-to-raster pairs
1366x768/2049x1152 and 960x640/1440x960. Mock answers, console and external
resources are empty; horizontal overflow is zero. Processes and ports
4490/4491 were measured released. No physical DPI change was made.

Related App, hook and roster tests pass 264/264. The first extended hook test
failed because its preview fixture defaulted to receipt 1 while this harness
models receipt 0; making that receipt explicit preserves the actual busy
refusal guard and accepted-request check. The failed record is retained.
Lint/typecheck, E2E typecheck and build 06 pass. Earlier full-suite 1,759/77,
build-03 keyboard/Inspector, build-02 Explorer import and natural picker-return,
and unchanged Rust evidence remain explicitly attributed to those runs.
Independent read-only reviews 12 and 13 verified their immutable snapshots
and found no confirmed actionable issue; final acceptance reconciliation and
publication identities are retained in the PR and local closeout.

### Row-menu focus survives collapsed and windowed destinations

Review comment 4001865161 on `438a0c63177f81c50f8f50c83da2dff05b4d3c01`
confirmed that moving into a collapsed group unmounts the menu trigger before
Radix can return focus. The row now captures the destination disclosure and a
stable toolbar fallback separately. On close, a surviving original trigger
keeps Radix's normal return; otherwise a connected destination disclosure, or
the still-connected toolbar fallback, receives focus. Independent review 14
identified the additional case where a bulk move also unmounts the destination
header. Review 15 covers that correction; organization payloads and data order
are unchanged.

Comment 4001865156 was not reproduced. Both existing locales explicitly describe
the absence of *visible* matching rows and offer expansion of a group. Browser
27 passes that case in both locales before any product correction: the group
still contains one acquisition, and expansion reveals the query match without
changing the query or invoking IPC. Its separate menu-focus regression fails.
The comment receives an individual evidence-backed non-issue disposition.

Browser 28 passes both cases (2/2, three captures). Final supplemental browser
31 passes the windowing boundary (1/1, one capture in `browser-Zg65LX/`): with
230 acquisitions, moving 80 highlighted rows into a collapsed group leaves
scrollTop at 3428, unmounts the previously connected target header, and returns
focus to New group. The 80 hidden highlights and unchanged IPC ledger are
asserted. Browser 29/30 failed setup assumptions: clearing a field through an
empty WebDriver value did not clear the React query, and the key sequence did
not select the intended target. Browser 31 uses the actual Clear search button
and named menu item. These unsuccessful records remain retained.

Build 08 changes only GroupedRosterList from build 06 (intermediate build 07
also remains retained). Its 166 production inputs match before/after; manifest
SHA-256 is
`a690b4768efc7ae72b03c7a8025966c57073bd84953573ce5d17403efd658e5a`.
The 16,225,792-byte E2E executable has SHA-256
`88376f1662c9d82f9a89ff67966047972aaa05f2abef33343063a8f0abc461b5`.
JS `index-C-A614vf.js` has SHA-256
`1ef785d852f46db3786d7d171b06d8e8d99cd079a7bdcde9846b00dc0768cac1`;
CSS remains unchanged. There is no new production dependency or Rust change.

Native build 08 passes 2/2, exit 0, in 22.2 seconds; evidence `native-1l5bkk/`,
launch `menu-final-native-20260914T031302034Z/`, session
`e693a1cdfeab8e15d77fc020d1c49566`. It retains real reads/drafts and verifies
keyboard menu selection into a collapsed group, actual focus on its disclosure,
and Enter expansion without extra IPC or preview reads. Five captures retain
the actual 144 DPI viewport/raster pairs; console, mock answers and external
resources are empty and horizontal overflow is zero. Processes/ports were
measured released afterward. Earlier build-06 activation/capacity, build-03
keyboard/Inspector and build-02 Explorer/picker-return evidence remain
separately attributed and were not repeated as full campaigns.

The preceding build-07 native attempt failed its initial foreground guard
before entering any product case; observed foreground owners were Chrome and
Code, not evidence of a locked desktop. The completed build-08 run records one
initial helper completion at 03:13:08.2760460Z, on PID 48784/HWND 1445176, which
was already the foreground owner. Initial native measurement occurred later
at 03:13:12.1384938Z, before the unchanged guard and any test input. Thus no
helper activation overlapped picker or menu focus restoration in this actual
run. The temporary concurrent launcher had a potential ordering/error-recording
race and is retired with an execution guard; its executed copy and raw logs
remain history. A guard-only replacement is not claimed as another native run.

Frontend CI on head `438a0c63177f81c50f8f50c83da2dff05b4d3c01` failed
attempt 1 of run 34800059108: 1,758 tests passed and the existing ConversionPanel
"restores Convert focus even when the plan is momentarily gone" assertion
received body focus. The current focused file subsequently passes 31/31; full
local run 06 passes 1,759/77 on build-07 source, and the final menu fallback's
related roster/conversion files pass 107/107. The CI failure and root-cause
uncertainty remain recorded; a later pass does not establish a repair of that
historical focus condition. No test was removed, skipped or weakened. Final
candidate CI, protected merge and local closeout are recorded under their actual
identities in the PR and local closeout rather than inferred from these runs.
