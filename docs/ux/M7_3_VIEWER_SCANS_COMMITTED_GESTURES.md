# M7.3 — Viewer, scans and committed gestures

Status: **implemented; local browser checks and static repair review complete;
current-build native acceptance and protected publication pending**.
Baseline: `e0b8fb101c29e78aeb6d99fda4b5ce5d58d6997c` (M7.2 / PR #121).
Baseline tree: `a6b642b5946a5dda981e3e7eada866675a00e1ba`.
Branch: `feat/m7.3-viewer-scans-committed-gestures`.
Route: [ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md).
Retained local evidence: `.tmp/m73-evidence/` (ignored).

## Task and acceptance

Continue the accepted [v5.11 workbench](DESIGN_SYSTEM.md#durable-v511-reference-baseline).
Researchers search and sort already-loaded scans, activate a whole row, inspect
the linked plots, propose a horizontal range and explicitly confirm it before
exporting. Plots and the selected scan remain prominent at entry. The preceding
table has whole-row activation but no view projection; its primary plot drag
pans and settles immediately. The new path has one scan activation, one range
drag and one deliberate confirmation. Escape abandons the proposal; a hidden
selection remains selected and offers filter recovery instead of replacement.

## State and owner decisions

1. A pure memoized `scanTableView` projection owns displayed order and source-index
   lookups for grid focus, reveal and Previous/Next. It never replaces the full
   scientific scan model or persistent selection authority.
2. The existing RT and m/z reducers own distinct drawing and pending states,
   bound to source/context, selection revision, committed domain and monotonic
   transaction identity. Only confirmation changes the committed range.
3. Plot input adapters use the existing reducer/ref plus bounded-publication
   path. Drawing and release issue no projection; successful confirmation may
   owe one retained-source projection. Wheel settles after the existing bounded
   transaction. A later selection invalidates stale same-index revisions.
4. Raw decimal/exponent drafts remain strings until explicit Apply; grouping,
   hexadecimal, nonfinite, reversed and out-of-source bounds are refused. IME,
   Escape and valid locale/density changes preserve their separate ownership.
5. The composition is chromatogram, selected spectrum, then bounded scans.
   Existing export/help/source sections are reachable disclosures. Text remains
   12 CSS pixels without a second scientific transform owner; headers have
   32-pixel targets. Ten visible table rows plus overscan bound the allocation.

Affected paths: `apps/desktop/src/features/mzml-preview/`, existing preferences
locale bundles, shared styles, `e2e/`, affected ADR/product/design/status records.
No dependency, provider, query, raw-reader, scientific algorithm or bound change.
The 100,000-row transfer and 1,800-point projection ceilings remain authoritative.
Exports retain source tokens and consume committed ranges, never table filters
or pending overlays. M7.4–M7.6 and XIC remain outside this slice.

Numeric sorting uses canonical facts; identifier sorting uses deterministic raw
UTF-16 string order. Missing/nonfinite values stay last in either direction;
ties retain source order. Search uses raw identifier/index/reported scan fields.
One displayed projection serves row focus, explicit activation, reveal and
Previous/Next. A hidden selected scan retains its spectrum and refuses stepping
until explicit recovery. The full scientific nearest-scan model stays independent.

Primary drag proposes; release leaves a band; a fresh click, action or Enter
confirms once. Escape cancels; an outside click cancels then inspects once.
Middle drag or Space+primary drag pans. Shift+wheel deliberately changes the
older rule to pan; ordinary wheel zooms. Ctrl/Alt/Meta wheel and modified keys
remain unclaimed. Idle unmodified double activation resets. Vertical touch
abandonment preserves page scroll; a second touch cancels instead of pinching.

[ADR 0032](../architecture/adr/0032-viewer-interaction-and-viewport-state.md)
and [ADR 0039](../architecture/adr/0039-visible-spectrum-viewport-adapter.md)
carry dated current amendments. ADR 0033/0038 cross-reference the changed
presentation/commit contract while retaining their scientific authorities and
historical evidence. Feature, screen, workflow and design records describe this
same consumer path.

## Baseline residuals

The original Frontend run `34844821499` attempt 1 is retained, including the
foreground-return assertion at `ConversionPanel.test.tsx:193`. Attempt 2 success
does not repair it. The delayed-plan case passed in that log. The first changed
ConversionPanel/focus consumer, expected M7.4, owns diagnosis unless this slice
actually touches the mechanism; [issue #122](https://github.com/MianliWang/MScanvas/issues/122)
records that ownership. Historical issue #112 is not rewritten. The downloaded
attempt-1 archive is 18,703 bytes, SHA256
`9b8dfdd7a58969917b7f7085a84a2a1ffc1bcc4459d50d8a228b1b20db855102`.
This slice changes neither ConversionPanel nor its focus-restoration mechanism.
M7.4 owns empty-spectrum export unless its faulty consumer is changed earlier.

The M5.2 Tab refresh first exposed obsolete roster/caption selectors and a
body-origin walk that did not reach the plot. A real Tab walk from the current
export disclosure to the source-details sentinel then reproduced a new product
regression: SVG event listeners made an inert spectrum implicitly focusable.
Explicit `tabIndex=-1` repairs it; the productive positive control and all three
zero-span cases pass (four cases, `m52-tab-repaired-04.log`).

## Local and rendered evidence

| Evidence | Observed result and boundary |
| --- | --- |
| Frontend checks | `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; 81 test files / 1,820 tests in `full-tests-04.log`, unchanged default worker/timeouts |
| Build | `pnpm e2e:build` passes, including `pnpm build`; existing QA features only, no installer/release configuration claim |
| Harness | `pnpm e2e:typecheck` passes, including exact initiating-control focus assertions and a pre-session readiness guard |
| Repository | `python -B scripts/check_repo.py` and full-slice `git diff --check` pass |
| Rust reuse | 83 Rust/build inputs hash-match retained M7.2 evidence; fmt/clippy/test exits 0, 1,556 passed / 23 ignored without double-counting nested tests. Fresh remote Rust CI remains required |
| Browser production composition | 12 cases pass in `browser-07.log`, Chrome 152.0.7977.84, session `5e7490e409ab781d35d12718afa14f39`, artifacts `browser/browser-GV91Zu/` |
| Historical Tab consumer | Four real Tab cases pass, session `ca5673ca6d4f43ffa69fbfd4518c5d6f`; no claim to rerun the whole historical viewer campaign |
| Serial isolated reversions | Pointerup-commits, displayed-index substitution and stale-context acceptance each fail discriminating tests; baseline and each byte-restored copy pass. Writer tree untouched; hashes retained in `falsification-01/evidence.json` |

Browser inputs are deterministic synthetic IPC with WebDriver/CDP dispatch.
The representative matrix is 1920x1080/DPR 1/en/comfortable,
1366x768/1.5/zh-CN/compact, 1200x800/1.25/en/compact and
960x640/2/zh-CN/comfortable. Actual entry screenshots precede scrolling. At
960x640 the selected spectrum begins inside the viewport (top 592.8); the
remaining plot is reachable through outer scrolling. This is not a claim that
the entire viewer fits inside 640 pixels.

The browser cases exercise both locales/densities, full/prefix/empty/refused/
loading/retryable-error states, hidden selection/recovery, real header and
multiple row-cell targets, raw/IME drafts, pending/cancel/confirm, wheel/Shift-
wheel/middle pan, host keys, actual Tab and reduced motion. At 100,000 loaded
rows, 21 rows are mounted; End focuses source 99,999 without a read and Enter
activates it. All nine header/value columns remain aligned under horizontal
scroll. No frame-rate or larger-input claim is made.

Long positive/negative exponent intensity labels stay within the plot; computed
font size is 12 CSS pixels and measured glyph height is 16 pixels in the matrix.
CDP-emulated touch proves horizontal pending selection, second-touch cancel and
vertical `pointercancel` with outer scroll 0 to 119. Physical touch qualification
remains an M7.6 limit. Application console and external resource lists are empty;
existing browser harness service warnings remain in raw logs.

## Findings, repairs and failed attempts

Two isolated read-only reviewers inspected the full slice, then the focused
repairs at implementation commit
`c12f45dbbd5bd38980b74369e8af07bfb8f18851`, tree
`f7d4182efa41fdd93470d3dceae181f144319829`. Their second snapshot manifest is
`cdf022e6f1f2cee509526c10a0759de90c8840cb4be7a461638fe8e436a12d33`;
all 460 entries were unchanged before/after review. They report no remaining
production P1/P2 finding. Their inspection of primary logs is not independent
runtime execution. Final-head binding and native evidence remain pending.

Three reproduced P2 findings were repaired with before-failing/after-passing
regressions: modified double-click reset, unrelated-render loss of the live m/z
transform, and repeated RT geometry work on hover. The repairs respectively
guard modified/default-prevented events, repaint the live frame after rebasing,
and reuse geometry until source/trace/domain changes. Positive controls retain
ordinary reset and domain-changing geometry work. Review also tightened native
readiness and focus evidence, and corrected an Alt/Meta wheel comment.

Final primary image review found native browser text selection of `100.0000`
alongside range drawing. A rendered assertion reproduced it before repair.
`user-select: none` is now scoped to productive plot SVGs (`tabindex=0`), leaving
external numeric/source text copyable. The strengthened range scenario and all
12 browser cases pass in run 07; both the failed run and screenshots are retained.

All failed local attempts remain in `.tmp/m73-evidence/`. Early failures exposed
legacy unlocalized fixtures/selectors, a DOM child replacement error, synthetic
PointerEvent primary flags and a selected-index callback typo; these were
repaired without weakening scientific assertions. Rendered failures reproduced
short-window plot displacement, text scaling, clipped exponent labels and inert
SVG focus. Two later browser failures were harness expectations (no horizontal
overflow at a wide viewport; a deliberately non-retryable malformed response);
the corrected cases use real overflow and an explicitly retryable rejection.

`full-tests-03.log` had two 5,000 ms timeouts while browser and native compilation
ran concurrently. One controlled standalone rerun of the same unmodified command
passes all 1,820 tests (`full-tests-04.log`); concurrency is an observed condition,
not a proven focus root cause. Build 01 succeeded but its after-manifest parser
used the wrong filename; the failed bookkeeping output is retained, corrected
readback matches production inputs, and build 02 has complete before/after
evidence. The existing Vite large-chunk warning remains unmodified.

## Current-build native checkpoint

Fresh user readiness is required before starting the GUI and has not yet been
received. No native M7.3 acceptance is claimed. The owned launcher checks the
recorded reply, exact production/binary hashes, current driver compatibility,
free ports 5494/5495 and absence of another native process before invoking WDIO.
The M7.3 `beforeSession` guard also rejects missing readiness before creating the
application session. It does not replace the operator's actual readiness check.

The current QA binary (build 03) is 16,237,568 bytes, SHA256
`48778e66a3316cfea3b732dc4f83783b6dd583ede5afb40b7401facf68cf6db5`.
Production-input manifest SHA256:
`4db58b79da4941107860701139796ecff7e3c7a56ddb1d1eb9f73c1184c681c2`.
JS `index-D6_o3fg5.js` is 899,048 bytes, SHA256
`9e50a090b5bd0d2707a3f118fbf369c7e4933ff9ded8aa4efa795e189c94165c`;
CSS `index-BN5qMi-u.css` is 55,966 bytes, SHA256
`ecaa40b87d7f4eac0319b3a21bd2c8ce534346a5585c86f9e4cfceb933714c5d`.
Source inputs were unchanged during the build. Subsequent harness/documentation
changes are separately hashed; they are not represented as a rebuilt binary.

The new fixture generator explicitly labels synthetic mzML: 12 scans, 12 known
points per scan. A console-only real ProteoWizard `msaccess` precheck accepted it
and returned all 12 rows; fixture SHA256
`f2b9b64c50db79ba816f7b71daeb03e3c359dd77d32064f33ed70a45bed3de09`.
The current provider emits raw RT values in multiples of 60 and raw identifiers
such as `0.1.8`; the UI still reports unknown units because that table supplies
none. This precheck is not native application acceptance.

The prepared native path uses real admitted reading and retained exports, no IPC
response replacement. It records PID/HWND/current Windows DPI/CSS/raster,
WebDriver input and raw capture/cancel ordering, exact picker-trigger natural
return, source hash and current/pending/full CSV requests/content for both axes.
The injected cancellation event is explicitly untrusted; it is not a physical
device claim. One initial foreground click is permitted; no post-picker focus
rescue may supply a passing observation.

## Evidence and publication

Current-build native acceptance, final reviewed-head binding, protected true
merge, natural-main Frontend/Rust/Repository quality and ff-only local closeout
remain pending. Exact object/run/attempt/checkpoint identities belong to the task
PR and retained local record. Unpublished implementation is not delivery on main.
M7.4 remains NEXT / NOT STARTED. M7 remains IN PROGRESS; no beta, installer, tag or
public release is built by this slice. M6 and the post-M6 XIC interlude remain
complete with the non-admission branch: no XIC provider admitted and no
production XIC implemented.
