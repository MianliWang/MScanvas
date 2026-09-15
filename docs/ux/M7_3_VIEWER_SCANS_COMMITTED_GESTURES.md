# M7.3 — Viewer, scans and committed gestures

Status: **implemented; browser checks, static product repair review and 3/3
targeted current-build native scenarios pass**. Protected publication and final
head/check/closeout identities belong to [PR #123](https://github.com/MianliWang/MScanvas/pull/123)
and the retained local closeout; local acceptance alone is not publication.
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

While a CSV/TSV export naming the visible source runs, its initiating button
remains focusable with `aria-disabled` and a busy-handler guard. Other export
actions stay natively disabled. This preserves native dialog return without a
focus-restoration effect or admitting duplicate export. A later deliberate focus
choice is preserved; replacing the visible source removes the exception.

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
| Final label-layer consumer | Existing Chromatogram suite passes 106/106 after the intensity-text paint-order repair (`label-layer-consumer-01.log`) |
| Data-export focus repair | Four discriminating tests fail before repair; 74 affected export/lane tests pass afterward. Four RT/m/z × CSV/TSV browser cases pass in `browser-export-focus-01.log`, session `ecb17d188cad22ff687c7d7089eeee56`; these are separate from the retained 12-case campaign |
| Build | `pnpm e2e:build` passes, including `pnpm build`; existing QA features only, no installer/release configuration claim |
| Harness | `pnpm e2e:typecheck` passes, including exact initiating-control focus assertions and a pre-session readiness guard |
| Repository | `python -B scripts/check_repo.py` and full-slice `git diff --check` pass |
| Rust reuse | 83 Rust/build inputs hash-match retained M7.2 evidence; fmt/clippy/test exits 0, 1,556 passed / 23 ignored without double-counting nested tests. Fresh remote Rust CI remains required |
| Browser production composition | 12 cases pass in `browser-08.log`, Chrome 152.0.7977.84, session `f2e6d953e07b5fbced6d65f55c36eec6`, artifacts `browser/browser-yQ9C0j/` |
| Historical Tab consumer | Four real Tab cases pass, session `ca5673ca6d4f43ffa69fbfd4518c5d6f`; no claim to rerun the whole historical viewer campaign |
| Native runtime | Build 05, real provider with synthetic mzML, 3/3 scenarios; session `a3cbaae0df271ba93d925f1d1c2ab98f`, `native-Wpi2HI/`, direct exit 0 |
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
vertical `pointercancel` with outer scroll 0 to 123 in run 08. Physical touch qualification
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
runtime execution. Subsequent affected-delta reviews bind the product repair to
`6416843888c3c5b847ef48b7922afd8de7adc2e6`, tree
`2230e33b5f4671d9759ab94c620bb189d66b4068`, with no substantive finding.
All 460 source entries and nine supplied evidence entries matched before/after;
source manifest `02f9ffe504764ff743ebca5273ca8fc3b3752884fabe1b2e4ac17c877c309227`.
Final harness/documentation successor dispositions are retained with the PR
head binding. Reviewers inspect primary runtime evidence; they do not execute it.

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

The UI reviewer then observed a trace crossing the lower intensity label's
leading sign/digits in the long-exponent screenshot. The same two text nodes now
paint after trace geometry, with unchanged values/coordinates and their existing
white halo. Primary before/after image inspection confirms the protected glyphs;
the 106 existing consumer tests and all 12 browser cases pass (run 08).

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

## Current-build native acceptance

The user explicitly supplied readiness and renewed it during the concentrated
session. Every invocation retains a launch record, log, direct exit and evidence
directory. The launcher checks actual production/binary hashes, compatible
drivers, free ports 5494/5495 and absence of surviving task processes. No forced
foreground activation or post-picker click/focus rescue supplies acceptance.

The passing invocation is `native-launch-20260915T030154512Z`, evidence
`native-Wpi2HI/`, session `a3cbaae0df271ba93d925f1d1c2ab98f`: **3/3 pass,
exit 0**. PID 25504, HWND 44307282, Windows DPI 144 (150%), CSS client
1366x768 and physical client/raster 2049x1152 were measured. WebView2 and its
driver are 152.0.4191.66. Post-run inventory shows no task application/driver
or listener on either port.

Build 05 follows the genuine data-export focus repair. Its executable is
16,237,568 bytes, SHA256
`c5125b75bfb9200987b4b7b034bacbe40c89b87ea0497e7ad84b70c9487278f1`;
174 production inputs have manifest SHA256
`317bb0f2c29bff6f234f5834d85cff88414365b93bf8418cf06d233cfdae26f8`.
JS `index-fdOAguGE.js` is 899,177 bytes, SHA256
`64effaa231be728e311aa3bfd15ebe536ac656093ae36042b08335709be0cdee`;
CSS `index-Ch0K6k7k.css` is 56,042 bytes, SHA256
`b7e3feab2d8ecbdb6e29e4a13714e1b4cc8a54e8285b162268362c6aa22a8e45`.
The before/after manifests were captured on `eb82d74...` with the three product
file repairs present, then committed unchanged as `6416843888c3c5b847ef48b7922afd8de7adc2e6`.
Later harness/documentation changes do not imply a rebuild. Build 04 and all
failed runs remain archived.

Passing native specification SHA256:
`bde4d014f6bb027c9b9589022778bb2592fcf51e2fbfc24af192b4b230bfed98`;
save helper SHA256:
`4e069714496f3e60b135d606c52b84824d5601795408a475a47ab2c93689889e`.
The native evidence records all four helper hashes. The owned PowerShell 7
launcher SHA256 is
`6595698cd6ce22bf890a95d4491818776cf829fe8cdc06bd77405ae0c6d22b89`.

Synthetic mzML contains 12 scans with 12 known float64 points per scan; unchanged
source SHA256:
`f2b9b64c50db79ba816f7b71daeb03e3c359dd77d32064f33ed70a45bed3de09`.
The real admitted ProteoWizard provider reads it. Its raw table RT values are
multiples of 60 and identifiers include `0.1.8`; missing units stay unreported.
No private acquisition, eight-scan browser illustration or reduced plot serves
as independent expected science.

The passing chain establishes search/sort without spectrum reads, row-body and
keyboard activation of exact source indices, both axes' pending/confirm/Escape
boundary, m/z wheel/middle pan, host-modifier and Tab checks. Every plot input
point passes a DOM hit test. Actual pending and committed screenshots accompany
request/event records. WebDriver pointer input is trusted in the WebView; the
injected cancellation remains explicitly untrusted, with no physical-touch claim.

| Real CSV operation | Canonical range and observed retained output |
| --- | --- |
| m/z current while pending | committed 200–550; eight points from source index 7, including intensity -40 at m/z 200 |
| m/z after explicit confirmation | 287.49809460890674–374.88157973975586; exactly (300, 800) and (350, 336) |
| m/z full | null requested bounds; all 12 original points, independent of pending/current projection |
| RT current while pending | committed 60–600; source indices 1–10 |
| RT after explicit confirmation | 194.9649628774789–329.78519707936044; source indices 4 and 5 |
| RT full | null requested bounds; all 12 original rows, RT `60 * index`, TIC `452 * (index + 1)`, BPC `100 * (index + 1)` |

Each axis keeps one retained export token across current/confirmed/full requests.
All six files retain their full content, byte counts and hashes in native JSON.
Six saves, one save cancellation and the source picker return naturally to the
exact initiating DOM control while the owned application is foreground. Cancel
writes no file; source bytes are unchanged. Console and external-resource lists
are empty at every capture. Raw application URLs use `http://tauri.localhost`;
the separately classified local IPC uses `http://ipc.localhost`, not a broad
localhost exemption.

### Retained native failures and repairs

- Two prelaunch failures exposed PowerShell 5.1 UTF-8 JSON decoding and its
  native-stderr error handling. Explicit UTF-8 and the already-installed
  PowerShell 7 launcher repair were reviewed; no GUI was created by those attempts.
- Sessions `7597ad8431b330fef03456058b581259` and
  `d4bb1a84f67c67eaef38ea6fb654ef63` failed the initial foreground guard.
  The observed foreground was Chrome; the user reported no initial click.
  These failures establish no scenario result or locked-desktop diagnosis.
- Session `180927cedf45c7f86f58aca647e63851` retained search `0.1.8` after
  protocol clearing, so End correctly stayed on its sole result. Actual keyboard
  deletion plus empty-query/12-row/read-settled preconditions repair the harness;
  the underlying reason protocol clearing failed remains undetermined.
- Session `ca8dc43137bb3277c39a9a71b43b6b4c` reproduced product focus loss to the
  Light radio after a successful CSV save. Keeping the guarded active data action
  focusable repairs the consumer; Build 05 and the affected tests/browser cases
  refresh its evidence without changing the shared Conversion focus utility.
- Session `24e276c97319171b38dc262659edfa05` refused a later save-control guard.
  Diagnostic session `28d0ca3d3940fa74ae2ca4c97d61889d` identified the cause:
  UIA AutomationId `1` matched a virtual file-list item, HWND 0, before the real
  owned Save Button. The helper now locates the unique visible native Button by
  resource ID and bridges its HWND, retaining ownership checks and refusal.
- Session `ff614747bf523833eda80428e69cb1e9` passed m/z exports and first RT save,
  then exposed a missing RT pending precondition. Installed WDIO's wheel-at-(0,0)
  scrolling left the RT plot clipped inside the workbench. Element scrolling,
  per-input hit tests and positive pending assertions repair the harness.
  These helper/spec changes preserve production inputs and all original
  scientific/focus assertions and timeouts. Harness typecheck and PowerShell
  parsing pass; the final native run above supplies the affected runtime proof.

## Evidence and publication

Current-build native acceptance is established. At that checkpoint, final
reviewed-head binding and publication remained pending. Protected true merge,
natural-main Frontend/Rust/Repository quality and ff-only local closeout identities
belong to the task PR and retained local record. A merge
request or green candidate check alone does not establish publication.
M7.4 remains NEXT / NOT STARTED. M7 remains IN PROGRESS; no beta, installer, tag or
public release is built by this slice. M6 and the post-M6 XIC interlude remain
complete with the non-admission branch: no XIC provider admitted and no
production XIC implemented.
