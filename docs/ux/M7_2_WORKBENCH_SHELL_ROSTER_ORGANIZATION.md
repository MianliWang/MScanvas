# M7.2 — Workbench shell and roster organization

Status: **implemented; local checks and independent review complete;
native acceptance and publication pending**.
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
attributable; native acceptance uses only build 02. Both build manifests/logs
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
The final full frontend run `full-unit-03` passed **1,758 tests in 77 files**.
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
scientific/provider capability. Native current-build proof is still pending.

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
No review finding remains open. Native execution is still a separate obligation.

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

## Native and publication checkpoint

Pending: one announced native session at the user's measured current scaling,
using the new attributable binary and retained fixture hashes; real mzML and
Settings/Home ownership, internal multi-drag, actual Explorer file/folder drop,
navigation during real work and the affected picker cancellation's natural
focus return. One initial click is permitted; no post-cancel rescue is allowed.
No repeat physical DPI cycle is required without a concrete unresolved mechanism.

After native acceptance and repair-delta review: ordinary task commit/push/PR,
required exact-head checks and thread resolution, protected true merge, ordered
parent/candidate-tree proof, natural push/main CI and ff-only local closeout.
The PR and ignored local closeout will hold final merge/run identities without a
self-referential source commit. Until then this record does not claim M7.2
publication. M6 and the post-M6 XIC non-admission interlude remain complete;
XIC is not admitted or implemented. M7.3 is next and not started. No public beta,
installer, tag or release is produced by this slice.

Current host checkpoint: readiness was requested for one approximately five-minute
session and has not yet been supplied. Read-only preflight measured matching
WebView2/EdgeDriver 152.0.4191.66, no existing task-native processes or listeners
on 4490/4491, and no exclusion covering those ports. No GUI has been launched and
no physical scale has been assumed or changed. A local checkpoint commit may
preserve this reviewed candidate while native acceptance remains pending.

Live GitHub main was still the expected M7.1 baseline. The active `Protect main`
Ruleset 19660027 requires up-to-date Frontend, Rust and Repository quality checks,
a PR and resolved review threads; the legacy branch-protection endpoint returns
404. This is Ruleset protection, not an absent protection claim. All live merge
inputs must be read again immediately before publication.
