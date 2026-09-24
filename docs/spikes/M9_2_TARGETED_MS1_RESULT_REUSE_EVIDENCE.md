# M9.2 — targeted MS1 result reuse evidence

Status: **M9.2 LOCAL RESULT REUSE COMPLETE — DURABLE TARGETED-MS1 EVIDENCE AND
SCIENTIFIC EXPORT.** Date: 2026-09-23. What was built, its rules and its limits
are in the [M9.2 record](../product/M9_2_TARGETED_MS1_RESULT_REUSE.md) and
[ADR 0048](../architecture/adr/0048-stored-targeted-result-reuse-and-export.md);
this document holds what was measured and how.

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.3
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT
RELEASED; M10 NOT STARTED

## Identity

| Binding | Value |
| --- | --- |
| Start (exact M9.1 endpoint) | `96f2d8caa66e8228aa7a899de5634b8f9a4ec7d5`, tree `cd2a745e…`; the M9.1 branch still points there |
| Branch | `feat/m9.2-targeted-ms1-result-reuse-export`, local only |
| `main` / `origin/main` | `1daf802f…`, untouched |
| No-re-execution proof, before any export change | `a1c56f5` |
| plot-spec schema 3 | `d8bb6f4` |
| Output layer, commands and report | `a3a6b12` |
| Copy removed; demotion; digests in Details; tamper test | `e96b695` (the isolated review's input) |
| Review repairs (**tested code**) | `4e4e00ca22526a42a9b070226b126f990aae404b`, tree `a9cceec7…` |
| Record and evidence | the docs-only commit after it |

## Inspection is not re-execution

Proved before the export path was touched (`a1c56f5`), then extended:

- `a_saved_result_reopens_and_reads_with_neither_the_runtime_nor_the_source`
  (always run): a result is saved, its source mzML is moved aside by an owned,
  reversible fixture, and a fresh store opens the document. Verification reads
  `notChecked`, then a check reports `unavailable` /
  `missingAtCheckedLocation`, while availability stays `available` and the rows
  and evidence read back identical. Plan resolution and a run with the
  `Unavailable` executor are refused `recipeUnavailable`; runs and artifacts
  stay 1 and 1, the document is not dirty and the recorded execution is
  unchanged.
- `a_real_result_is_read_after_reopen_and_save_as_with_neither_the_runtime_nor_the_source`
  (real runtime, ignored by default): caffeine and adenine run through the
  pinned pyOpenMS 3.5.0 worker; the source is moved aside; the reopened project
  is checked, then saved as a copy. From the copy, with nothing asking for the
  runtime, each extracted target is drawn twice (identical SVG), rasterized to a
  PNG through the export facade, and the whole result is tabulated as CSV and
  TSV twice (identical). No output contains the work area, the source path,
  `.tmp` or `m91-`. Runs and artifacts stay 1 and 1, the execution record is
  unchanged, the document is not dirty and the rows and evidence read back
  identical. The outputs were written to `test-results/m92-real/` and
  inspected: the caffeine figure shows the M and M+1 samples, the feature band
  and the apex; the adenine figure (`NOT_DETECTED`, every value zero) is drawn
  on a single-valued intensity axis; the CSV carries the preamble and two rows
  with the engine's `0 (valid)` model status kept as reported.
- `a_stored_result_changed_on_disk_after_reopen_is_neither_drawn_nor_tabulated`:
  one digit of `rows.jsonl` changed at the same length refuses both the table
  and the figure as corrupt; one digit of `evidence.jsonl` refuses the figure
  and leaves the table, which is the rows alone; the result moved away is
  missing, not corrupt, and is not regenerated. Nothing is recorded.
- `rows_that_no_longer_fit_their_plan_are_not_its_result`: the plan-match rule
  refuses a reordered, missing, extra and inconsistent row directly, below the
  digest check.
- Code path: no M9.2 command takes an executor, a job, a source handle or a
  path; `get_targeted_ms1_runtime` reads the pinned manifest and interpreter's
  presence in a development build and is `runtimeUnavailable` in a release
  build, where `Supervisor::development()` is `None`.

**Runtime unavailable** was exercised through the existing development
mechanism, the `Unavailable` executor, and by the release build's own answer;
the real runtime under `.tmp/m91-runtime/` was neither deleted nor altered.
**Source unavailable** was exercised with an owned fixture moved aside and put
back (`Aside`); no user source was touched.

## Canonical plot integration

- plot-spec schema 3 (`d8bb6f4`): `IntervalSpec` and sample marks, with tests
  for refusal outside the full domain, sample marks on a discrete series, each
  role's drawing, the description, clipping, zero-width intervals, precision
  of close ends, a JSON round trip, and a figure that uses neither drawing
  exactly what it did. The three golden SVGs are byte-identical; the linked
  figure pins that it uses no schema-3 addition.
- The figure builder (`targeted_output::evidence_figure`) is tested for drawing
  exactly the stored points, window, feature and candidates; each outcome's
  title and caption; refusing a target with nothing extracted or with evidence
  that disagrees with its row; a window with no spectrum drawn empty and said
  to be; user text bounded and XML-safe; and determinism.
- The page shows Rust's SVG as an inert image; unit and browser tests assert no
  SVG markup is placed in the page.

## Table contract

Tested in Rust: the column contract and preamble order, plan order, the
payload's own outcome and failure words, empty cells for every value a result
does not have (a target never extracted, a failed target's feature, and — after
the review — a window with no spectrum), measured versus imputed intensity,
plan decimals verbatim, CSV quoting of commas, quotation marks and line breaks,
TSV refusal of a tab or a line break, Unicode labels, a label starting with
`#`, and — through the record count — that no record line starts with `#`.

## Outputs

| Output | Evidence |
| --- | --- |
| SVG | Rust: rendered twice identically from a stored result; written through `write_named` (named as its format, refused over an existing file, refused under a wrong extension). Browser: the export request and its reported file name (mocked dialog) |
| PNG | Rust: rasterized through `FigureOutput::png` with the raster budget from a real stored result; PNG signature checked; image inspected |
| CSV / TSV | Rust: built from a real stored result, deterministic, written through `write_named`; browser: keyboard path and reported row count (mocked dialog) |
| Copy | **Not offered.** Removed in `e96b695`: no native harness could exercise the clipboard write for a stored result |

The native save dialog was not exercised for these commands.

Where each output carries provenance:

| Output | Provenance it carries |
| --- | --- |
| CSV / TSV | the `#` preamble: recipe and version, result and run identifiers, plan, target-list, source, adapter, engine-profile, runtime-manifest and payload-manifest digests, the engine's reported versions, parameters, units and row order |
| SVG | the title (`<label> — <Outcome>`) and the description, which names the result identifier and the plan SHA-256 (checked in the real-runtime output) |
| PNG | the drawn title only. The existing PNG path writes no text chunks, so a PNG carries no identifier or digest |

## Rendered interface

Unit (Vitest, jsdom): `apps/desktop/src/features/project/TargetedMs1.test.tsx`
— the figure request and inert image, the three-fact state line with the
runtime unavailable, quarantined and unanswered, the source gone, missing and
damaged results offering nothing, a later refusal demoting the report with an
alert and focus on the heading, table and figure exports with their saved,
cancelled and refused sentences, the held output with the pressed control kept
focusable, a size being typed across targets, per-target figure outcomes, this
surface's own DPI and preview-size sentences, the outcome-specific text
alternative, the target-list and manifest digests in Details, and Simplified
Chinese.

Browser (real Chrome, real Vite, mocked IPC), appended to
`e2e/specs/m9.1-targeted-ms1.browser.e2e.ts`. Replacing the plot forced two
changes to its M9.1 scenarios: the plot is found as `img` rather than `svg`,
and the count of drawn traces became a check that the image decoded at its
answered width. Its answer table gained the M9.2 commands and its frame
measurement the state line and output statuses; its five M9.1 scenarios are
otherwise as they were. The M9.2 scenarios: a result reopened with its source gone and no runtime at 1366×768,
exported to CSV by keyboard and to SVG; a damaged result at 1366×768; a refused
figure and a refused TSV at 1920×1080; and 960×640 in Simplified Chinese with
both disclosures open and a PNG export. Each frame asserts no horizontal
overflow, no absolute path or layer identifier on screen, no off-origin
request and a clean console. The figure shown is a labelled stand-in SVG from
the answer table, not the renderer's output.

The frames were inspected. Two rendered findings were fixed before the review:
the reuse sentence was shown for a damaged result, and the export notes used a
larger type than the report's other notes.

## Isolated review

One read-only review workflow over `96f2d8c..e96b695`: four dimensions
(scientific fidelity; the no-re-execution invariant, authority and security;
frontend state, accessibility and localization; export I/O and test adequacy),
each followed by an adversarial verifier. 15 findings, deduplicated to 12;
10 confirmed or plausible and repaired in `4e4e00c`, one refused, one narrowed
to a documented limit.

| Finding | Verdict | Disposition |
| --- | --- | --- |
| Sums and maxima written `0` for a window that held no spectrum (two reviewers) | Confirmed, medium | Fixed: empty cells; `extracted_points` stays `0`; test |
| Image text alternative claims a feature and candidates for every outcome (two reviewers) | Confirmed, medium | Fixed: names the outcome and only what is drawn; tests |
| An SVG over the screen bound reported as not drawable while its export works | Confirmed, medium | Fixed: `figure_preview_too_large` with this surface's sentence; test |
| Endless "Drawing…" after a target switch while the size is not a size | Confirmed, medium | Fixed: drawn at the last valid settings; disclosure state kept; test |
| Pressed export control disabled across the native dialog, losing focus | Confirmed, medium | Fixed: `aria-disabled` initiator, others disabled; test |
| A demotion removes the pressed control and its status unannounced | Confirmed, medium | Fixed: alert and focus to the heading; tests |
| Plan-match check never reached by its test | Confirmed, low | Fixed: `rows_fit_plan`, tested directly |
| DPI refusal names `Copy plot`, which this surface does not offer | Confirmed, low | Fixed: own sentence; test |
| A figure export's outcome shown under another target | Confirmed, low | Fixed: said under its own target; test |
| "New runs" never re-asked (two reviewers) | Plausible / confirmed, low | Fixed: re-asked when a run is recorded. **No test** |
| Window end hidden under the axis; interval roles not labelled in the image | Plausible, low (narrowed) | Caption now says an end at the edge lies on the axis; labels recorded as a limit |
| Screen-equals-export test does not pass through the commands | Refuted | Both commands build and render through the same helper and renderer |

One fix was found while testing the repairs: evidence with no trace made the
caption's message parameters empty and the render throw; the caption is now
omitted for it (Rust refuses to draw such evidence and that refusal is shown).

## Browser suite

The whole browser suite was **not** re-run for M9.2. Its last full result,
recorded by M9.1, is exit 1: 27 spec files, **7 passed, 20 failed** (every
Project-surface spec M8.1–M8.5, M9.1 and `m7.4-preview-observer` passed; the
M4, M5, M6, M7.1–M7.5 and viewer-r1 specs failed). That result is not
rewritten here and is not called green.

The specs M9.2 affects are M8.1–M8.5 and the M9.1 spec with the M9.2
scenarios. They were run on working trees, not on a commit: once before the
review (6 of 6 spec files, 28 tests, on the tree committed as `e96b695`), and
once after the repairs on the tree then committed unchanged as `4e4e00c`. In
that second run M8.2–M8.5 and M9.1/M9.2 passed (20 tests); M8.1's worker could
not create a WebDriver session (`Failed to fetch [POST]
http://localhost:6667/session`) and ran no test, so M8.1 was run once more,
alone, and passed (8 tests). Only the M9.1/M9.2 spec was run again on the
committed code, in the validation record below. Logs: `test-results/m9.2/logs/`. M4.2 figure settings and
M7.1 settings, which render the shared settings component M9.2 reuses without
changing it, were in the failing baseline and were not re-run.

## Validation record

Run one command at a time, in this order, on the tested code commit
`4e4e00ca22526a42a9b070226b126f990aae404b` (tree `a9cceec7…`), logs in
`test-results/m9.2/final/` (not committed). `check_repo` was run after this
record was written, on the docs-only commit's tree.

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all --check` | 0 | |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 0 | |
| `cargo test --workspace` | 0 | 1,844 passed, 0 failed, 41 ignored (the real-runtime tests among them) |
| `cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1` | 0 | 18 passed: every real-runtime case, M9.2's reopen-and-export case among them |
| `cargo check -p mscanvas-desktop --release` | 0 | The release branch, whose runtime read answers `runtimeUnavailable`, compiles |
| `pnpm lint` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | 105 files, 2,154 tests |
| `pnpm build` | 0 | The existing chunk-size warning only |
| `pnpm e2e:typecheck` | 0 | |
| The M9.1 browser spec with the M9.2 scenarios, alone | 0 | 9 passing (M9.1 5, M9.2 4); frames in `test-results/m9.2/browser-hDPrUp/` |
| `git diff --exit-code 96f2d8c -- Cargo.lock pnpm-lock.yaml` | 0 | No dependency changed |
| `python scripts/check_repo.py` | 0 | |

`pnpm e2e:browser` (the whole suite) was not run: see "Browser suite" above.

## Custody

After the validation record, one headless test browser was found still
running: `chrome.exe` PID 48172 with seven children, profile directory
`wdio-chrome-0-8-1789837682482` under the user's temporary folder, started
2026-09-23 14:15:48 local time — before any M9.2 browser run, and with no
ChromeDriver or runner alive. Its WebdriverIO profile and worker number match
an earlier full browser-suite run, so it was a leftover test browser, not one
M9.2 started. It was stopped; the user's own Chrome profile was not touched.
No runner, driver, dev server or test browser remained afterwards.
