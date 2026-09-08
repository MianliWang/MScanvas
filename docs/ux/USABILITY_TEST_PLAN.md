# Usability test plan

## M6.7 selected/all verification

The production scope controls and complete review are exercised by
`e2e/specs/m6.7-conversion-scope.browser.e2e.ts`: selected subset with unrelated
rows, mixed eligible/excluded counts, all under search, authoritative capacity
refusal before BEGIN/picker, keyboard scope recovery, deferred-order review
withdrawal and destination/conflict draft preservation. Seven cases pass at
measured inner 1366x768, 1920x1080, 1200x800 and 960x640. The existing M6.6
browser suite separately passes eight cases. Console assertions remain active;
runner-level Tauri browser-mode warnings are not application-console errors.

`e2e/specs/m6.7-conversion-scope.tauri.e2e.ts` uses the unchanged guarded native
picker helpers, installed provider and hash-pinned task-owned Thermo copies.
It requires a strict selected subset and all under active search, compares the
reviewed order with the actual queue, and checks unrelated source/target bytes
and existing Fail/Skip behavior. Its complete second run passed **2/2** in 55.2
seconds under WebView2 152.0.4191.66, with five new mzML outputs. Evidence is in
`D:/tmp/mscanvas-m67-20260908/m67-native-d6vfZe/evidence.json`; binary SHA-256
`bcf0390d90f735680bfd215151e53efc75d3b7846fcddd836902e86c74a96919`.
The initial selected case's picker button timeout remains recorded separately;
the guarded helpers were unchanged on the successful rerun. No browser result
is counted as native evidence. Output validation remains `output_only`, not
full-source fidelity. This paragraph records the preliminary local checkpoint.
The subsequent exact-head run at `fe176c2a524aa9ab7ea1fbfa363bc30fef31ed30`
passed M6.7 **2/2** (34.3 seconds) and the unchanged M6.6 regression **5/5**
(35.2 seconds). Its binary SHA-256 is
`f1b004a9aa005013669b533f4be19214b0aac2b0368a533d4924b70beb2afb24`;
evidence is under `D:/tmp/mscanvas-m67-20260908/m67-native-G39AY3/` and
`m66-native-Hle71a/`. Both isolated full-diff reviewers admitted that head with
zero must-fix findings. Final identity, confirmation review and publication
checks are recorded in [PR #100](https://github.com/MianliWang/MScanvas/pull/100).
See the
[M6.7 record](M6_7_CONVERSION_SCOPE.md) for current disposition and limitations.

## Purpose

Validate task structure before expensive backend integration and establish repeatable regression tasks.

## Representative participants

Prefer a mix of:

- routine MSConvertGUI users;
- MZmine/OpenMS/Skyline users;
- core-facility or batch-processing users;
- one technically capable but less mass-spec-specialized user for terminology/discoverability checks.

Three to five participants are useful for early structural comparisons; findings are directional, not statistical proof.

## Prototype tasks

1. Add three acquisitions and a folder; identify a duplicate.
2. Remove two selected rows without touching source files.
3. Clear the entire idle workspace.
4. Open an acquisition and find a spectrum near a stated RT.
5. Move to the next MS2 scan and identify precursor m/z.
6. Convert only two selected files to compressed mzML without additional centroiding.
7. Recover from one output-permission failure and retry it.
8. Export the current chromatogram and spectrum as a clean light-theme figure.

## Measures

- completion and assistance required;
- task time (used comparatively, not as a universal target);
- wrong clicks, backtracks and mode confusion;
- terms participants hesitate over;
- missed feedback and incorrect assumptions;
- perceived difficulty (single ease question);
- qualitative comments and desired shortcuts.

## Acceptance signals

- Primary actions are found without instruction.
- Users correctly understand that list removal does not delete data.
- Users can explain whether centroiding will occur before conversion.
- Linked selection is understood after one interaction.
- Failure recovery does not require rebuilding the batch.
- Exported figure expectation matches the preview.

## Recording

Store anonymized notes under a non-source-controlled research location unless participants explicitly consent. Commit synthesized findings and design decisions, not raw sensitive recordings.

## M6.6 published verification tasks

**Published by PR #99 at `5b91f6c5ab1c3013eb9556ddf83b76217a56f249`.** These tasks validate the accepted
v5.11 destination/conflict continuation in the current application; they do not
repeat prototype research or count archived QA as current evidence. Record
browser/mock observations separately from real Windows/Tauri filesystem and
provider observations.

| Task | Required observable result |
|---|---|
| Keep defaults, then choose each destination policy | Custom local folder remains default and usable; source sibling and named subfolder are available without changing admitted scientific settings. The summary distinguishes requested policy from admitted destination. |
| Convert sources from different parents, then use one custom destination | Source-relative policies bind each item to its own acquisition container; custom binds a shared directory. Equal names in different destination objects are not an internal collision, but equal folded names in one object are. |
| Enter an invalid/reserved folder name, then a valid long name | Rust's validator refuses the exact invalid name with a corrective message. Text survives refusal; correction requests a fresh description. Long text wraps without hiding controls. |
| Change policy/name/conflict/intent while a description is deferred; activate repeatedly | Old replies do not revive a stale plan. Dispatch uses the current admitted request, and the conversion lane prevents duplicate work or overlap with a backend/probe operation. |
| Cancel the custom picker and return by keyboard | Reservation settles, no conversion or owned-directory residue appears, entered settings remain, and focus returns to a usable conversion control. |
| Exercise destination refusal/replacement and retry | The refusal is actionable; retry revalidates the bound per-item objects without silently choosing a replacement folder or resetting settings. |
| Exercise existing targets, internal claims and backend-named sets | Fail/Skip preserve existing objects; internal claims are a distinct refusal; Skip refuses a partially occupied set. Late set publication failure reports its prefix without complete-set success/adoption or retry. No actionable overwrite control exists. |
| Exercise unavailable, empty, describing, failed and recovered states | One authoritative unavailable notice remains readable; no loading label persists without a request. Keyboard navigation and the existing viewer/export task remain usable under their own authorities. |

Capture and inspect **1366×768, 1920×1080, 960×640 and 1200×800**, including
keyboard order, focus visibility/return, long names, constrained reflow, errors
and cancel/recovery. Record page/app identity, non-blank rendering, console
health and any reference mismatch. Temporary screenshots and traces remain
outside Git.

The native proof uses the installed supported backend and authorized source
fixtures, with disposable task-owned destinations. It exercises the real picker
and verifies actual outputs and cleanup independently of rendered labels.
Browser fixtures are not provider evidence. M6.7 scope and M7 foundation work
are not part of these tasks.

### Local evidence, 2026-09-08

`e2e/specs/m6.6-destination-conflict.tauri.e2e.ts` passed **5/5** in 43.7 seconds
under Windows WebView2 **152.0.4191.66**, using the matching Edge driver. The
external run log is
`D:/tmp/mscanvas-m66-20260908T031943Z/native-run-004.log`; the structured evidence
and eleven screenshots are under the same task directory's
`m66-native-uhSrB8/`, including `evidence.json`.

| Exercised path | Recorded result |
|---|---|
| Custom picker cancellation | Actual Tab/Enter opens the modal, actual Escape closes it, conversion returns to idle, the checked settings and named draft survive, and keyboard focus returns to the primary control. The unused draft directory is absent. |
| Custom folder | One real mzML is finalized in the chosen folder, with bound destination status, an installation receipt and backend exit code 0. |
| Source sibling | Two acquisitions with equal output names in different source parents finalize two outputs into those respective parents. |
| Named subfolder | A path-like name is refused without BEGIN or folder creation; the corrected single name creates two subfolders and finalizes one output in each. |
| Existing target | Fail reports failed and Skip reports skipped; the original target SHA-256 remains unchanged and no new output is claimed. |
| Rendered geometry and console | Evidence records exact inner 1366×768, 1920×1080, 960×640 and 1200×800, destination-group bounds and scroll-ancestor clipping. All five application-console captures are empty. |

The recorded native binary SHA-256 is
`91be26540d049f6fe45fe77b75c2af304f51c6500c946184e01fc5064d46c665`;
the authorized Thermo fixture SHA-256 is
`b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b`.
The suite verifies the fixture and its task-owned source copies keep that hash.
All five new outputs have backend exit code 0, `stagingResidue: null`, and
`validation.mode: output_only` with `fullyVerified: false`. The existing
unverified processing/population facts remain unverified; a successful
destination workflow does not establish vendor-source fidelity.

The separate browser/mock spec passed **8/8** in 17.1 seconds in
`browser-m66-inner-viewport.log`, with E2E typecheck recorded separately in
`browser-m66-inner-typecheck.log`. It measures the browser frame before setting
the window, then asserts exact inner dimensions at all four target sizes.
Eight destination/conflict screenshots under `browser/` have matching PNG pixel
dimensions. The earlier `browser-m66-final-shell.log` is functional/geometry
history, not the source for exact-inner claims. The latest browser log contains
Tauri-service warnings about unsupported browser-mode operations; it is not a
warning-free log. Browser assertions do not replace the provider/filesystem
results above.

This evidence records these local runs only. At that checkpoint, final-candidate
full gates, independent review, exact-head remote checks and protected publication
were separate outstanding steps; PR #99 subsequently completed publication.
Historical prototype QA does not supply those checks. Set/partial-publication and deterministic race obligations
retain their Rust and focused frontend test owners rather than being attributed
to these five native scenarios.
