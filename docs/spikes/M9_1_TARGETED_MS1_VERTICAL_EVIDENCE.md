# M9.1 — targeted MS1 vertical evidence

Status: **M9.1 LOCAL VERTICAL IMPLEMENTATION COMPLETE — BOUNDED EXPERIMENTAL
TARGETED MS1 RECIPE.** Date: 2026-09-23. What was built, its rules and its
limits are in the [M9.1 record](../product/M9_1_TARGETED_MS1_HANDOFF.md#m91-record);
this document holds what was measured and how.

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.2
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT
RELEASED; M10 NOT STARTED

## Identity

| Binding | Value |
| --- | --- |
| Start (exact M9.0 closure) | `1652affdb3547011dddcd67a06b8b18458597faf`, tree `35f84c40…`; its code candidate `17d6c9495da8dcfa72d3eb6e479b35a9dc5bb350` (tree `3440df96…`) |
| Branch | `feat/m9.1-targeted-ms1-vertical-integration`, local only |
| `main` / `origin/main` at start | `1daf802f…`, untouched |
| Runtime provisioning and entry probes | `a34e2b1` |
| Supervised recipe, schema 4, payload store, commands | `ec7c155` |
| Project-surface consumer | `b1724c4` |

## Entry probes

Run through the provisioned runtime before any product code, by
`experiments/m9_1/probes.py` and `experiments/m9_1/engine_probe.py`; the record
is `.tmp/m91-jobs/probes/probes.json` (SHA-256
`A91546D245081467C5F6149D90723ED9FBFDE1DBEA831B973EDC09C55366ECE4`).

| Question | Measured |
| --- | --- |
| Can a source be held and hashed through the held handle? | Yes: read sharing only, hash through the handle equal to the bytes written |
| Can a same-volume hard link be made while the source is held, and is it the held object? | Yes: `CreateHardLinkW` succeeded; the link's volume serial and file identity equal the held handle's |
| What does the hold refuse? | Opening the source or the link for writing, renaming the source and deleting the source's name are refused (`32`, sharing violation) |
| What does it not refuse? | **Deleting the link's name** succeeded while the source was held. The source's name and bytes were intact afterwards |
| Does the engine read a CJK path directly? | No: pyOpenMS raised `IO error` for the CJK source path. Through the ASCII link the same file completed (`DETECTED` / `NOT_DETECTED` as designed) |
| What does the engine do when no target has a candidate? | Raises `builtins.RuntimeError` with `Empty or uninitalized range object. Did you forget to call updateRanges()?`, identical in two runs; after the raise the library (target names, two transitions each) and one chromatogram per transition are readable, and the candidate file holds zero features |
| Can the no-valid-fit discard be reproduced? | A candidate whose window cuts the peak at 2.0 s or 2.5 s from the apex gave a candidate and no feature and no unassigned entry (`nvf_window_cut_2_0`, `nvf_window_cut_2_5`); tiny, plateau and end-cut peaks gave no candidate at all. With a valid partner in the same batch, the same candidate became a feature with model status `4 (right side out of bounds)` and an imputed intensity |
| What does an edge-flagged related target look like? | Two overlapping features of **different** intensity: the engine removes the loser silently (its overlap annotation is written only for equal intensities), so the row is `CANDIDATES_WITHOUT_FEATURE`. A shared feature with an edge-flagged partner: the narrow partner `RELATED_TARGET_AT_SPECTRUM_EDGE`, the wide one `EXTRACTION_AT_SPECTRUM_EDGE` |

## Runtime provisioning

`scripts/provision_targeted_ms1_runtime.py` copies
`.tmp/m90-evidence/runtime/cpython-3.13.15-embed` (without `__pycache__`) to
`.tmp/m91-runtime/` and verifies every file before writing the manifest:

| Provenance | Files |
| --- | ---: |
| Embeddable zip member, byte-identical | 33 |
| Embeddable zip member, modified (`python313._pth`: CRLF normalized, one `site-packages` line) | 1 |
| Wheel member, digest from the lock | 4,546 |
| Written by pip, verified against `RECORD` | 34 |
| Written by pip, not verifiable from `RECORD` (`RECORD` itself, `INSTALLER`, `REQUESTED` and similar) | 14 |
| **Total** | **4,628 files, 348,698,831 bytes** |

Manifest SHA-256 `6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295`
(`provision-report.json` `6D411CF2…`). A rerun reproduces the same manifest. No
package was downloaded, installed or updated; the runtime is the one M9.0
recorded.

## M9.0 reconciliation

Established from the preserved M9.0 artifacts, without rerunning or rescoring
anything and without changing any M9.0 outcome.

**229 against 130 checks.** Round one was scored at 166 PASS / 63 FAIL (229
checks); its final rerun (`final-r1/runs/checks.json` `2eb6e92e…`) reported 112
PASS / 18 FAIL (130). The case set, the fixtures and the evaluator are the same
in both. The difference is that the final worker's equal-MS1-time guard refuses
four cases with `SOURCE_RT_NOT_STRICTLY_INCREASING` (`main`,
`main_no_candidates`, `truncated_other_batch`, `truncated_solo`); for a refused
case the evaluator returns before its downstream checks
(`experiments/m9_0/protocol.py`, the early return for a run that did not
complete), so 41 + 41 + 17 = 99 checks of the first three were **not
evaluated**. They were not fixed, and the 46 FAILs among them are not PASSes. On
the 130 keys the two rounds share, the first round had 113 PASS / 17 FAIL and
the final 112 PASS / 18 FAIL: the four refusals' `run_status` checks went from
PASS to FAIL, the two `fmt_32_none` chromatogram checks went from FAIL to PASS
(binary64 reads), and `ctl_timeout` went from FAIL to PASS on a host-dependent
timing.
Source files: `runs/checks.json` (SHA-256 `48f47149a5192f0c7a1d108c12a173fd7b3177568a05620e224f306e946c6d5f`)
and `final-r1/runs/checks.json` (SHA-256
`2eb6e92e911a419d48b91a474159ff97a4299318dafb97332f110d1da5a4f25c`).

**The 3.7e-6 figure.** It is the relative difference (absolute 7.75) of
`targets[4].feature.engine_intensity` for `tyr_near3` in `r2_strict`: round two
2075591.625 against the post-review rerun 2075599.375. Those two runs recorded
**different worker digests** (`859611e4…` and `42b5dbd9…`), so the M9.0 record's
"identical input, engine and pre-engine code" is not what the attempts record;
the final round-two rerun (worker `55624cfc…`) reproduced the round-two value,
2075591.625. The values are in each run's `runs/r2_strict/published/result.json`. The figure is not
stored in any M9.0 artifact; it was derived. The first round's controller
identity was never recorded. M9.1 therefore makes **no reproducibility claim**
for engine intensity, as the numeric contract states.

## Measured through the supervisor

Every case below ran the pinned runtime through the Rust supervisor and the
stored payload, not a Python controller. They are the `#[ignore]` tests in
`apps/desktop/src-tauri/src/targeted_ms1/tests.rs`, run with
`cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1`.

| Case | Result |
| --- | --- |
| Supported source through the whole path: plan, run, publish, save, reopen, Save As, original untouched, no residue | Completed; `DETECTED` and `NOT_DETECTED` as designed; available after reopen and in the copy |
| All-absent batch | Completed through the measured recovery; every row `NOT_DETECTED` with `recoveredFromEmptySelection` |
| Namespace-prefixed mzML | Failed `sourceReadIncomplete`; the source is byte-identical afterwards |
| Truncated and non-mzML sources | Failed with source codes; nothing published |
| Shared feature with an edge-flagged partner | Both rows `FAILED`, never `SHARED` |
| No valid fit, alone and with a valid partner | `ENGINE_DISCARDED_NO_VALID_FIT` alone; with the partner, a feature whose intensity says `imputedFromRunRegression` |
| Repeat run of one plan | Categorical fields identical; raw areas and evidence identical; theoretical m/z within 2.9e-16 relative |
| CJK source path | Read through the ASCII link; `DETECTED` |
| CJK project path | Stored, reopened and copied by Save As; available throughout |
| Source on another volume | Refused before a run exists; nothing recorded |
| Source changed since the plan | Failed `sourceChanged`; nothing read or published |
| Cancel during a real run | Worker terminated, exit observed, cancelled run recorded, nothing published |
| Time budget | `workerTimeout` with `timeBudgetExceeded`, never a cancel |
| Missing, malformed or unknown worker output | Failed with result codes; nothing published |
| Second process inside the job | Refused by the job (`refused 1816`); one owned process in total |

A fixture matrix of random centroid noise gave one false `DETECTED` during
development: a single matrix point inside the M+1 window became a one-point
candidate with model status `1 (invalid area)`. The engine's answer was kept;
the fixtures now keep matrix points 20 ppm away from every fixture target. This
is a domain observation about sparse single-point candidates, not a fixed
defect.

## Measured without the runtime

A fake executor drives the store's rules: publication order, save only by Save,
failed and cancelled runs, cancel reaching the commit first, the exclusive-run
guard, refusals that record nothing, plan identity over the whole ordered batch,
per-row request problems, missing and damaged payloads on open, a result under
another record's name, a document moved away from its store, unreferenced
results, Save As copying, carrying forward, corruption, a copy that does not
arrive whole, a document publish that fails after the store, an existing
destination store, schema 3 refused, unknown kinds, codes and fields refused,
plans that no longer match, foreign bindings kept as history, payload row
consistency, runtime files changed, added or missing, the worker vocabulary, and
bounded reads. These are the non-ignored tests in the same file and run with
`cargo test --workspace`.

## Rendered interface

Unit (Vitest, jsdom): `apps/desktop/src/features/project/TargetedMs1.test.tsx`
— the typed-text parser, the setup's review and refusals, a run with its phase
and its cancel, a completed, failed and pre-run-refused run, the report's bounded
reads, evidence, missing and corrupt results, Details, and a Simplified Chinese
render with no English prose left.

Browser (real Chrome, real Vite, mocked IPC):
`e2e/specs/m9.1-targeted-ms1.browser.e2e.ts` — review by keyboard, a held run
with its phase, the result report and plot at 1920×1080, a cancel at 1366×768,
the report and Details at 1366×768 and 960×640 with a long source name, a
missing result, and Simplified Chinese. Each frame asserts no horizontal
overflow of the page, the surface, Details or the row table, no absolute path or
layer identifier on screen, no off-origin request, and a clean console. This is
layout and interaction evidence over a controlled answer table; no worker ran.

Two rendered findings were fixed before the frames above: outcome tables
stretched across the section, and a cancelled targeted run was announced with
the file-facts sentence "Nothing was recorded", although the run is recorded; it
now has its own sentence. One observation is recorded rather than hidden: the
dev server runs under React StrictMode, which mounts the report's effect twice,
so the browser run may read the first row page twice; the unit suite, without
StrictMode, proves one read.

## Validation record

See the commands and exit codes below. Logs are in `test-results/m9.1/` (not
committed).
