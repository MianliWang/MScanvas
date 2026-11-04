# PM9.7 — integrated journey acceptance, regression, reference-deviation disposition and candidate freeze

PM9 | Acceptance: U1–U10, integrated | Depends on: PM9.1–PM9.6 | Serial, one writer
Status: **PM9.7 COMPLETE — INTEGRATED BROWSER/RENDERED ACCEPTANCE PASS;
CANDIDATE FROZEN** (2026-10-14, §11).

- **Production:** `30b855f23fc8b391e10221954dfa1278a9863db5`
  (`apps/desktop` tree `39d6557887a10b10dc60a9b00901160bf93a9c02`).
- **Measured:** J1–J6 equal the before side on every counted field.
- **Outside the slice:** native rendering at OS scaling, the real engine and
  every provider-positive check stay **PENDING** or
  **BLOCKED_PROVIDER_HOLD**. They belong to the owner's own qualification
  dispatch after PM9 (§9).

## 0. Starting point

- HEAD `ab28f83e94d147511f70d6b2306d784762ea5501` (tree
  `dee854d967b8687c80442126d8425633ea740693`) on
  `feat/pm9-product-convergence`.
  - Clean worktree and index, no stash, no Git operation in progress, one
    worktree.
  - Production code is PM9.6's `6c3508a`. After it, one test file changed
    (`TargetedMs1.test.tsx`), plus documents and the J1–J6 instrument.
- **Since the accepted main `57915de`** (an ancestor):
  - the frontend changed: 67 files under `apps/desktop/src`;
  - the root `package.json` gained one script line (`qa:pm9:manual`);
  - the e2e tests changed under `e2e/`, and `scripts/check_repo.py` one
    docstring (`859eaf0`);
  - no Rust, IPC, DTO, schema, manifest, lock or workflow path changed.
- **Slices.** PM9.1 is complete, its baseline established and not accepted
  ([baseline §17](baseline.md#17-j1j6-measurement-on-d56b17b-pm91-pending-item-4)).
  PM9.2–PM9.6 are complete.
- **Host, at expansion.**
  - Memory: 3.39 GiB free, 89.3% used. That is past the stop line, so nothing
    ran while this was written.
  - Chrome: 154.0.8037.98 active, 155 staged. Browser runs name a
    ChromeDriver 154 with `CHROMEDRIVER_PATH` (baseline §16).
  - **ProteoWizard is installed** under
    `%LOCALAPPDATA%\Apps\ProteoWizard 3.0.26013.47b13cf 64-bit\`. This was
    found by listing files only; nothing was run. Automatic discovery reaches
    it (`common_install_roots` in `crates/proteowizard/src/discovery.rs` lists
    `%LOCALAPPDATA%\Apps`). A native window probes discovery on mount, and the
    e2e build's answer table is empty on a first launch
    (`apps/desktop/src-tauri/src/e2e_boundary.js`). So a native launch here
    would run the installed `msconvert --help`, which the HOLD does not allow.
  - The native e2e binary `target/e2e/release/mscanvas-desktop.exe` is from
    2026-09-17, so it is not a PM9 candidate.

## 1. Goal

Close PM9 on one frozen candidate:

- U1–U10 hold together along the reader's journeys, measured against PM9.1's
  J1–J6 baseline;
- the regression list holds;
- the legacy residue the slices handed on is repaired, retired against a named
  replacement, or recorded with a diagnosis;
- the states the reference comparison never captured are rendered;
- the remaining reference deviations reach the owner for a final
  disposition;
- the candidate's identity is recorded for the qualification after PM9.

PM9.7 adds no capability. A product change here answers only a regression
this slice finds, and it voids every measurement taken before it (§8).

## 2. Read first

- `brief.md`: U1–U10, the regression list, the locked decisions, the
  boundaries and the not-in-PM9 list.
- `baseline.md`:
  - §2, legacy specs;
  - §3 and §3.1, the deviations;
  - §10, the residual owners and decision 1;
  - §11–§16, each slice's hand-off;
  - §17, J1–J6's method and before side.
- `slice-03.md` §5 and §0.5, the legacy classification.
- Optional rows: `slice-04.md` §4 and §10, `slice-05.md` §4, `slice-06.md`
  §4.
- Instrument: `e2e/baseline/`, `e2e/wdio.baseline.conf.ts`.

## 3. Work items (frozen before any run)

| ID | Item | Source | Action | Evidence |
| --- | --- | --- | --- | --- |
| A1 | J1–J6 after side, with J1b, J4b, and J6 at both sizes | brief U1, U10; baseline §17 | Measure on the frozen candidate by §17.1's rules (§5) | M runs; `journeys.json` |
| A2 | The states §3.1 never captured: the application's empty and entry states, and scrolled and focus-driven positions | baseline §10, the "states" row | Render and assert (§6) | PM9.7 spec I1–I3 |
| A3 | Legacy residue (§7) | baseline §10, decision 3; slice-03 §0.5 | Repair, retire against a named replacement, or diagnose | G-L groups |
| A4 | Regression | brief, Regression | The whole browser corpus, full Vitest, static checks and build on the frozen candidate | §8 |
| A5 | Final reference-deviation disposition | baseline §3.1, §10; slice-04 §10; slice-05 §12 | Table with a recommendation per row; the owner decides | §9 |
| A6 | PM9.6 O1 and O3 | slice-06 §4 | Recommend from PM9.6's own evidence (P1, P2, P12 and `ProjectQcSummary.test.tsx`), since the J1–J6 recorder reads no focus; the owner decides. O2 needs no action. O4 stays with the M9.2 wording owner, being unreachable | §9 |
| A7 | Candidate freeze | brief, decision 1 | Record the identity, the checks and the decision sheet | §10 |

Not in this slice:

- **Optional presentation rows** (PM9.4 O1–O8, PM9.5 O1–O4) are carried
  forward unless the owner pulls one in at the freeze. Each would be a
  product change after the measurements.
- **The native, engine and provider qualification** is §9's item 5.

## 4. Acceptance in three layers

- **True.**
  - Every J1–J6 journey reaches its end state on the frozen candidate.
  - Every entry in each journey's preserved set is kept.
  - A navigation-only step sends no work-class command.
  - Each count that differs from the before side is attributed to a named
    slice decision.
  - The empty and entry states each name a next action that is reachable by
    keyboard.
  - In scrolled and focus-driven positions, the focused control is on
    screen, visibly focused, and the document does not overflow.
  - The regression groups pass, or each failure is classified (§7).
- **Exists.**
  - The after-side driver `e2e/baseline/pm9.7-journeys.after.e2e.ts`;
  - the PM9.7 spec `e2e/specs/pm9.7-integrated.browser.e2e.ts`;
  - the repaired legacy specs;
  - this record, baseline §18 and the decision sheet.
- **Wired.** Nothing new is wired: no IPC, DTO, schema or command changes.
  The after side's IPC ledgers are compared with the before side's by
  command.

## 5. J1–J6 after side: method (frozen before any run)

- **Rules.** Baseline §17.1, unchanged, with its amendment. That covers the
  journeys by goal and end state, the path rule, the counting rules and the
  anchors: 1366×768 in English, and J6 also at 960×640, in Chrome headless at
  DPR 1.
- **Recorder.** `e2e/baseline/journeys.ts`, with no edit. If it must change,
  the before side is measured again with it.
- **Candidate and serving.**
  - `prepare-baseline-app.ps1 -Commit <frozen> -Root .tmp/pm97-j16` extracts
    the frozen candidate's frontend, and `wdio.baseline.conf.ts` serves it on
    a fresh port, as for the before side.
  - The script's dependency guard holds: the lockfile, the workspace file and
    `apps/desktop/package.json` are unchanged since `d56b17b`.
  - **Tailwind.** The extraction is git-ignored, and Tailwind's source scan
    honours that. It changes no style: the current build (`6c3508a`'s
    `dist`) generates 36 utilities, and none is used as a class in the
    markup (static check, 2026-10-13).
- **Driver.** `pm9.7-journeys.after.e2e.ts` is derived mechanically from
  the before driver. It differs only where the candidate does:
  - **J2's start control.** `CONVERT` (`e2e/support/conversion.ts`), and
    Rust's queue state answered as started once Convert is pressed, as the
    PM9.4 spec answers it.
  - **J4's Open result.** PM9.5 made a finished run offer its result: the
    report opens on that press (slice-05 R9). That is one step more, on the
    most direct path the candidate offers.

    **Correction, 2026-10-14, after M5 and before M6.** M5 showed this
    premise to be false on the frozen candidate:
    - after Run, the run's result is already the inspected object and its
      report is on screen (`useProject.ts` inspects a result when it arrives);
    - the "open its result" step changed no context, sent no command and
      mounted nothing; Open result only moves the keyboard to the report's
      heading (`TargetedMs1.tsx`).

    So the step is not on the most direct path, which §17.1's path rule
    requires. The driver now ends J4 at Run once the report's rows are
    there, as the before side did. M6 measures J4 again alone. M5's J4 record
    stays as it ran.
- **Fixtures.** The same ones: `fixtures.ts`, `pm9Scenarios.ts`,
  `targeted.ts` and the copied PM9.4 answers, with `readBackSavedPreferences`.
- **Each run records** Chrome's version, the port, the memory reading, the
  candidate and the evidence directory's hash.
- **Reading the comparison.**
  - It is per journey: the counts, the IPC classes and commands, the mounts
    and the preserved set, before against after.
  - A difference is a finding to be explained, not a failure. Its
    explanation names the slice decision that made it.
  - An unexplained increase in steps, confirmations or work-class calls, or
    a lost preserved entry, is a regression, and it goes to §8's repair rule.

## 6. Integrated states (the PM9.7 spec)

`e2e/specs/pm9.7-integrated.browser.e2e.ts`: the real frontend over the
controlled IPC boundary, at 1920×1080, 1366×768 and 960×640 in en and zh-CN.
zh-CN runs with reduced motion, as PM9-G does.

| Case | State | Asserts |
| --- | --- | --- |
| I1 | **Empty and entry.** No acquisitions and no project, on each of the three surfaces | Each surface says what is missing and names a next action that exists in the product. That action is reachable by Tab from the surface's first control. No horizontal or vertical document overflow. No primary action is offered that would be refused. Console clean |
| I2 | **Scrolled.** The viewer after viewing a row and choosing a spectrum, with the evidence column scrolled to its end; the Project with recorded work, scrolled to its history's end | The header and context line stay in place. The last scan row and the last history control lie inside the visible box. No document overflow. The scroll owner is the surface's own region |
| I3 | **Focus-driven.** Walk by Tab from the header into the evidence column, then into the Project's history, at 960×640 | Every focused control lies inside the viewport and inside its scroll owner's visible box, with the visible focus treatment. No control is covered by the header. Focus never lands on `body` |

Frames and geometry go to `test-results/pm9.7/` (git-ignored). The v5.11
reference has no empty, entry or Project state to compare with: its demo is
always populated. These states are therefore disposed of against
DESIGN_SYSTEM's state rules, not against a reference frame (§9).

## 7. Legacy residue (the regression gate)

The classes are those of slice-03 §5. Each case ends in exactly one of:

- **REPAIRED:** the setup is re-derived and the same assertions run;
- **UPDATED:** an assertion now states the current contract, citing the
  decision that replaced the old one;
- **RETIRED:** removed, after its named replacement passes;
- **DIAGNOSED:** left failing, with a stated cause and an owner.

| Spec | Open before PM9.7 | Recorded family | Action |
| --- | --- | --- | --- |
| m7.1 | 3 of 3 | (b) obsolete `[role="option"]` rows | Repair setup |
| m7.2 | 10 of 11 | its own `metrics()` (4); toggle-then-wait (2); undiagnosed | Diagnose `metrics()` first, then repair; re-derive PM9.2's geometry |
| m7.4 | none: the active-Clear pair was already repaired test-only by UI-23 (`4078601`, baseline §12) and passed 16 of 16 in PM9.4's G3 on `7e83ae4` (`test-results/pm9.4/final/G3/`). The hand-off above it predates that | — | Run in G-L1 only |
| m7.5 | 1 of 8 | a wait for `disabled` where the header refuses with `aria-disabled` | Update to "refused but reachable", the contract its native spec asserts |
| m4.1, m4.2 | 17, 15 | (b) at setup | Repair setup |
| m5.3 | 13 | 12 × (b), 1 × (a) | Repair setup |
| m4.3, m4.4, viewer-r1 | 2, 1, 2 | (b) | Repair setup |
| m4.4, viewer-r1 | 1, 1 | (d) driver geometry | Repair if the target can be brought into view first without changing the assertion; otherwise diagnose |
| m5.2, viewer-r1, viewer-r1-scale | 5, 5, 1 | SUPERSEDED | Retire against slice-03 §5's replacements, after they pass in U1 |
| m4.3 | none | slice-03 §5 calls one case SUPERSEDED (copy only), but PM9.3's `266088d` already updated its copy, and it passes (slice-03 §0.5, 21 of 23) | UPDATED by `266088d`; kept, not retired |

The repairs are test-only. They are authored statically, because memory
refused every run at the time, and qualified by their groups in §8.

## 8. Validation groups (frozen before any run)

**Memory gate.**

- **Admission:** at least 8 GiB free and at most 80% used, read once when a
  group starts.
- **Stop line:** below 4 GiB free or at 90% used or more, no further heavy
  command starts inside a group.
- A refused group is recorded with its reading. It is not renamed, not
  waited on and not polled.
- The owner waived the gate only for PM9.6's runs and for J1–J6's before
  side, and neither waiver carries over.

**How groups run.**

- Serially in the foreground, one browser session at a time.
- Each browser group gets its own fresh dev port, from 15300 up.
- Vitest runs bounded, with `--maxWorkers=1 --no-file-parallelism`.
- Every launched process is recorded with its PID, creation time and parent,
  and no process is killed by name or port.

**Amendment, 2026-10-13, at the owner's request, written before any browser
run.** The owner asked for the groups to run in parallel as far as
possible, and chose up to five at once with only the stop line as their
gate. This replaces "serially, one browser session at a time" and the
admission line for the browser groups and B0:

- **M5 still runs alone**, with no other group running, so its counts are
  taken as the before side's were.
- **The others run as parallel shards**, at most five at once. A new shard
  starts only at 4 GiB free or more and below 90% used, read once at its
  start. Below that line no new shard starts; shards already running finish.
  A shard the line refuses is recorded as refused. A later run of it is a
  new group, under a new name.
- **Launches are staggered by 30 seconds**, so each reading includes the
  shards already started.
- **Each shard** gets its own dev server on its own fresh port, its own
  Chrome session and its own output directory.
- **A case that fails in a parallel shard** is run again alone before it is
  diagnosed, to tell contention from a fault. Both outcomes are recorded.

**Second amendment, 2026-10-14, written before the runs it governs.** The
owner then asked for everything left to be done in parallel ("并行把还没做的都做完").
The remaining groups therefore run under the same stop-line-only gate:
- **T2**, the e2e typecheck;
- **V2**, the replacements' Vitest files with a per-test reporter;
- **I1b**, the extended PM9.7 spec;
- **M6**, J4 again, alone;
- **C1**, the light checks.

D2, a development typecheck, had been refused at the standing admission line
(7.28 GiB free, 77% used) just before. It stays refused.

**Freeze and repair rule.**

- The production candidate is frozen before M5 and the G groups. At
  expansion, it is HEAD's production code, `6c3508a`'s.
- A group that finds a product regression stops the run. The repair is a new
  production candidate, and every group already run on the old candidate is
  run again on the new one.
- A test-only repair reruns only its own group.

| Group | Content |
| --- | --- |
| T0 | `pnpm e2e:typecheck`, after the test-only commit |
| S1 | `pnpm typecheck` (also `pnpm lint`) |
| U1 | Full Vitest, bounded. It includes the SUPERSEDED rows' replacements |
| B0 | `pnpm build` |
| M5 | The J1–J6 after side: J1, J1b, J4b, J2, J3, J4, J5, and J6 at two sizes |
| I1 | The PM9.7 spec |
| G-PM9 | PM9.1, PM9.3, PM9.4, PM9.5, PM9.6 |
| G-M | m8.1–m8.5, m9.1, m9.4 |
| G-L1 | m7.1, m7.2, m7.4 (both files), m7.5 |
| G-L2 | m4.1, m4.2, m4.3, m4.4, m5.2, m5.3, m5.7 |
| G-L3 | m6.1, m6.4, m6.6, m6.7, m6.8, m6.9 |
| G-L4 | m7.3, viewer-r1-linked-viewer, viewer-r1-scale |
| C0 | `python scripts/check_repo.py`; `git diff --check`; a scoped comparison against `57915de` (no Rust, IPC, schema, manifest, lock or workflow change). Light, so not gated |

**Not run, by dependency.**

- **Cargo** (fmt, clippy, test). No Rust or manifest has changed since
  `57915de`, so Rust's evidence is the accepted main's. A Cargo rebuild
  belongs to the qualification.
- **Native, Tauri and provider specs**: §9's item 5. Their setup still
  selects the pre-M7.2 roster in places (baseline §2, §18); that repair goes
  with them.

## 9. Owner decisions at the freeze

One page, sent to the owner in Chinese at the freeze. Each item carries a
recommendation:

1. **U4.** Whether it may be accepted with its live-provider check open
   (`BLOCKED_PROVIDER_HOLD`).
2. **Final deviation dispositions:**
   - L7 at 1920×1080 (roster 280 px against 285 px);
   - L11 (outer inset);
   - L21's one-row navigation;
   - PM9.4's one-line settings summary and the three-phase stepper;
   - PM9.5's stepper;
   - the integrated states (§6).
3. **The keyboard model** for opening a record from history: PM9.6's O1,
   keep M8.5's model, and O3, keep the keyboard-only guard. Both
   recommendations rest on PM9.6's evidence. They stay provisional until G-PM9
   and G-M run on the frozen candidate.
4. **ADR 0006's 544 px.** Its breakdown names a sidebar that M7.2's fold
   removed (baseline §11).
5. **The qualification after PM9.** Lifting the ProteoWizard HOLD, or
   providing a provider-free host or guest, and authorizing Cargo, the native
   e2e build and the real engine for:
   - native rendering at 150%;
   - U4's live-provider check;
   - the targeted-MS1 engine path.

   Until then these stay **PENDING** or **BLOCKED_PROVIDER_HOLD**, never
   passed.
6. **The optional rows** (PM9.4 O1–O8, PM9.5 O1–O4): carry them forward, or
   pull any into PM9 at the cost of a new candidate.
7. Any group the memory gate refused.

**The owner's decisions (2026-10-13, "按推荐", on items 1, 2 without the
integrated states, 4, 5 and 6).** Items 3 and the integrated states were
put to the owner as provisional. "As recommended" does not decide them;
they are decided after their runs.

1. **U4** may be accepted with its live-provider check open. That check stays
   `BLOCKED_PROVIDER_HOLD` and belongs to the qualification after PM9.
2. **Deviations, final.**
   - Kept as intentional deviations: L7 at 1920×1080 (280 px against
     285 px), L11 (the 16 px inset), and L21's one-row navigation at 960×640.
   - Not adopted: PM9.4's one-line settings summary with an edit action, its
     three-phase stepper, and PM9.5's stepper.
3. **ADR 0006's 544 px.** A documentation-only revision after PM9 corrects
   the breakdown that names the removed sidebar. Nothing changes in PM9.
4. **The qualification after PM9** is its own dispatch, after PM9 closes.
   The HOLD is not lifted in PM9.7. Until that dispatch, native rendering at
   150%, U4's live-provider check and the targeted-MS1 engine path stay
   `PENDING` or `BLOCKED_PROVIDER_HOLD`.
5. **The optional rows** (PM9.4 O1–O8, PM9.5 O1–O4) are carried forward
   after PM9, not into this candidate.
6. **Memory.** The owner chose neither a waiver nor another admission line,
   so the standing gate of §8 applies.

**The owner's decisions at the freeze (2026-10-14).** These were taken after
the first candidate's runs (§11), on the findings put to the owner.

1. **F15, fixed now.** A focus ring must be DESIGN_SYSTEM's 2 px `#1769d1`
   ring with its offset (UI-46). The viewer's disclosure summaries and the
   scan table's MS-level select drew Chrome's thin ring instead.
2. **F1, fixed now, look and reason both.** With no project open, Save,
   Save As… and Close were refused but looked live and said nothing. Capture
   QC summary looked live when refused too.
3. **O1 and O3, kept.**
   - Opening a record from history leaves the keyboard in history (M8.5's
     model).
   - The evidence reveal waits for the keyboard alone.
4. **The integrated states, accepted.**
   - F6, the zh-CN terms for the roster and for vendor acquisitions, is fixed
     now.
   - F2 (no emphasised next action on the empty Project) and F3 (at
     960×640, the copy does not name the folded Acquisitions) are carried
     forward with the optional rows.

F1, F15 and F6 change production. By §8's freeze rule they make a new
candidate, candidate 2, and every group runs again on it. All three were in
the product before PM9 (`d56b17b`, `57915de`). None is a PM9 regression.

## 10. Evidence boundaries

- **What the browser proves.** It is the real frontend over a controlled IPC
  boundary, so it proves interface and command wiring. The step, decision
  and IPC counts are those of that boundary.
- **What it does not prove.**
  - native dialogs, real files, a provider or engine run;
  - native WebView2 at the host's 150%;
  - a screen reader.
- **The dev server mounts under StrictMode,** so mount-time reads are counted
  twice on both sides alike.

## 11. Record

**2026-10-13, authoring.**

- **Test-only commit `bb5f191`** (production unchanged, `6c3508a`'s):
  - the after-side driver;
  - the PM9.7 spec;
  - the legacy repairs and retirements of §7.

  The repairs were made statically, because memory refused every run. Each
  updated assertion cites the decision that replaced the old one.
- **m7.2's `metrics()` timeouts are a cascade, not a fault of the helper.**
  It timed out only right after a failed test whose failure screenshot went
  through WebDriver, when the next test asked for the same override before
  navigating. Two pieces of evidence:
  - in the PM9.2 acceptance run (`.tmp/pm92-accept/run4/`), every other
    pairing passed;
  - the same pattern appears in 2026-09-14's `browser-32`, and in
    `browser-33`'s controlled rerun.

  The helper now clears the override before setting it, and on a timeout
  reports the page's actual size and ratio. This mechanism is an inference
  until G-L1 runs.
- **m7.4's active-Clear pair** was already closed by UI-23 (§7).
- **m4.3's "says a current range is the whole run until the viewport is
  committed"** was removed in `bb5f191` and restored unchanged after review.
  It passes on the current contract (`266088d`), so it is no SUPERSEDED case.
- **The eleven retirements are provisional.** §7 retires a case only after
  its replacement passes in U1, but they were removed before U1 ran. A
  replacement that fails in U1 puts its retired case back.
- **Coverage the retirements give up.** Retiring viewer-r1's single-scan
  mark case drops a browser-level check that the mark lies inside the
  drawing area, and its axis labels. What remains:
  - the mark's drawn size, in viewer-r1's own "marks each series, told apart
    by more than colour", which stays;
  - its position and axis, at attribute level only, in
    `Chromatogram.test.tsx` "draws the one scan's total ion current as a
    visible mark".

| Group | On | Reading at start | Result |
| --- | --- | --- | --- |
| T0 `pnpm e2e:typecheck` | `9f3d1b9`, clean | 3.99 GiB free, 87.4% used | refused at admission, not started; it stays refused |
| C0 `check_repo` and the scoped comparison | `9f3d1b9`, clean | 3.86 GiB, 87.8% (light, not gated) | passed; no Rust, IPC, schema, manifest, lock or workflow change since `57915de` |
| T0b `pnpm e2e:typecheck`, after the owner's decisions | `c2eec56`, clean | 3.83 GiB, 87.9% | refused at admission, not started; it stays refused |

**2026-10-13 to 2026-10-14, candidate 1: production `6c3508a` (PM9.6's).**

Every gated run went through the scratchpad runner, which recorded its
memory reading, HEAD, port, process tree and leftovers. No run left a
process behind.

- **Browser runs.** Chrome 154.0.8037.98, headless, at DPR 1, with
  ChromeDriver 154.0.8037.93 through `CHROMEDRIVER_PATH`.
- **Shards.** They ran under the owner's stop-line gate (§8's amendments), at
  most five at once, each on its own port (15300–15346 over the whole slice).
- **Evidence** for the gated runs: `.tmp/pm97-runs/<group>/`, git-ignored.
- **The light checks.** C0, C1 and C2 (`check_repo`, `git diff --check` and
  the scoped comparison) are not gated. They ran directly and left no runner
  record, so their results rest on this record.

| Group | On | Reading at start | Result |
| --- | --- | --- | --- |
| T0c `pnpm e2e:typecheck` | `d2539e9` | 10.18 GiB free, 67.9% used | exit 1: two TS2322 errors in `bb5f191`'s m4.1/m4.2 helpers, fixed test-only in `d0a97b2` |
| D1, the same typecheck over that fix (development) | `d2539e9`, dirty | 9.79 GiB, 69.1% | exit 0 |
| T1 e2e typecheck, S1 `pnpm typecheck` | `d0a97b2` | 9.87 / 9.78 GiB | exit 0 |
| U1 full Vitest, bounded | `d0a97b2` | 9.77 GiB, 69.2% | 112 files, 2260 tests passed |
| G-L2a, G-L2b, G-PM9a, G-L3, G-L4, G-PM9b, G-M, G-L1, I1, B0 (parallel) | `2891f90` (docs only after `d0a97b2`) | lowest 6.29 GiB, 80.1% (G-L3) | all exit 0; per spec below |
| M5, J1–J6 after side, alone | extracted `6c3508a` (archive `7239bf7b…604b`) | 10.63 GiB, 66.4% | 9 of 9; `journeys.json` `2e994027…d173` |
| D2 development typecheck | dirty | 7.28 GiB, 77% | refused at the standing admission line; it stays refused |
| I1b extended PM9.7 spec, V2 replacements by title, T2 (parallel) | `0b021af` | lowest 7.00 GiB | 12 of 12; 5 files, 382 tests; exit 0 |
| M6, J4 and J4b again, alone | extracted `6c3508a` | 9.11 GiB, 71.2% | 2 of 2; `journeys.json` `243179c1…f239` |
| C1 `check_repo`, `git diff --check`, scoped comparison | `0b021af` | light | passed; since `57915de`, outside `apps/desktop/src`, the e2e tests and the documents, only the root `package.json`'s `qa:pm9:manual` line and a docstring in `scripts/check_repo.py` (`859eaf0`) changed; no Rust, IPC, DTO, schema, manifest, lock or workflow path changed |

Browser outcomes on candidate 1, every spec passing:

- PM9 specs:
  - PM9.1: 55.
  - PM9.3: 19.
  - PM9.4: 9.
  - PM9.5: 10.
  - PM9.6: 32.
- M8 and M9 specs:
  - m8.1: 8.
  - m8.2: 4.
  - m8.3: 2.
  - m8.4: 2.
  - m8.5: 3.
  - m9.1: 12.
  - m9.4: 5.
- Legacy specs:
  - m4.1: 17, against 17 failing before PM9.7.
  - m4.2: 15, against 15 failing.
  - m4.3: 23, against 2 failing.
  - m4.4: 18, against 2 failing.
  - m5.2: 43, after five retirements.
  - m5.3: 13, against 13 failing.
  - m5.7: 8.
  - m6.1, m6.4, m6.6, m6.7, m6.8 and m6.9: 65.
  - m7.1: 3, against 3 failing.
  - m7.2: 11, against 10 failing.
  - m7.3: 16.
  - m7.4: 16, and its preview observer 7.
  - m7.5: 8, against 1 failing.
  - viewer-r1: 49, after five retirements.
  - viewer-r1-scale: 2, after one retirement.

So every legacy failure §2 and slice-03 §0.5 handed to PM9.7 is either
repaired, updated with a cited decision, or retired. None of the 2026-09-25
campaign's 174 known failures still fails: each now passes or is retired
against a named replacement.

- **m7.2's `metrics()`.** Its 11 cases pass with the clear-then-set helper.
  The cascade diagnosis stands, now in a run.
- **The eleven retirements are final.** V2 shows every named replacement
  passing by title:
  - in `Chromatogram.test.tsx`, `SpectrumViewport.test.tsx`,
    `LinkedViewer.test.tsx`, `App.test.tsx` and `ChromatogramExport.test.tsx`;
  - m7.3's wheel-and-pan case and PM9.3-V7 pass in their browser groups.

  The retired m5.2 drag case's request half is now also named against
  `SpectrumViewport.test.tsx`'s "keeps moving the drawing while a drag
  publishes nothing" and "commits the pan when the press is released,
  keeping the window's width".
- **J1–J6 (M5, with the J4 correction measured in M6).** Every journey equals
  the before side (baseline §17.2) on every counted field:
  - steps, decisions and their options, confirmations, native dialogs;
  - context changes by kind;
  - journey IPC by class, by command and by step;
  - mounts in and out per region, the preserved set, the end state;
  - the 13 mount-time calls (9 read, 4 other) and the console ledger.

  No navigation-only step sends a work-class command, and every preserved
  entry is kept, the committed m/z range and the targeted draft included.
  - **J4's method correction (§5).** M5 measured J4 at 6 steps. Its sixth,
    "open its result", changed nothing: after Run the result is already the
    inspected object and its report on screen. The step is off the most
    direct path, so the driver now ends at Run, and M6 measured J4 at 5, equal
    to the before side.
- **An analysis anomaly, recorded.** U1 is not a declared shard, but it
  overlapped seven of them: G-L2b, G-L2a, G-PM9a, G-L3, G-L4, G-PM9b and G-M.
  The pool held at most four at once, so at most five heavy runs ran
  together: U1 with the first four, from 23:42:20 to 23:42:28.
- **The integrated states (I1, I1b), reviewed against DESIGN_SYSTEM.**
  - **F1, defect, pre-existing.** With no project open, the Project's refused
    Save, Save As… and Close looked live and gave no reason. Capture QC
    summary had the same look when refused.
  - **F2, weakness.** The empty Project emphasises no next action.
  - **F3, weakness.** At 960×640 the empty Workbench's and Conversion's next
    action sits behind the folded Acquisitions, which their copy does not
    name.
  - **F4 and F5.** Evidence gaps, closed test-only by I1b: a frame of every
    eighth stop, each stop's treatment, Conversion's next action reached by
    keyboard, and the roster unfolded by Tab and Enter.
  - **F6, weakness.** zh-CN called the roster 名单 beside 采集列表, and
    vendor acquisitions 供应商格式的采集 beside 厂商采集.
  - **F7–F14, observations, no action:**
    - zh-CN line breaks;
    - the empty roster's Ungrouped row;
    - the full Conversion form when empty;
    - frame artefacts;
    - the scan-table header spacing in English;
    - a history label's baseline offset;
    - relation buttons that read as text.
  - **F15, defect, pre-existing.** I1b's per-stop treatment showed 20 of 150
    stops on Chrome's own `1px auto` ring rather than DESIGN_SYSTEM's 2 px
    `#1769d1`: every viewer disclosure summary and the scan table's MS-level
    select.

**2026-10-14, candidate 2: production `30b855f`.** The owner's decisions (§9)
added three fixes, F1, F6 and F15.

- **One focus ring (F15).** The shared rule covers `select` and `summary` at
  `:where()` specificity, so component rings win. This also restores the
  rows' inset rings. The shared `[tabindex]` arm, there since
  `index.css` was added in `37fc35d`, had always overridden them. The roster help summary draws its ring inset. Roster menu items keep
  theirs. Every control the shared rule covers (buttons, inputs, selects,
  summaries and anything with a `tabindex`) has a 4 px `scroll-margin`, the
  ring's reach.
- **Refused secondaries read as refused (F1).** They fade, except while
  they hold the focus ring.
  - With no project open, Save, Save As… and Close say why: they are
    described by the visible no-project sentence, and their tooltip carries
    the new key `projectNeedsProject`.
  - Other refused actions keep the reason they already gave. Capture QC
    summary, Add to Workbench and Create layer give their own; during an
    operation, the busy line gives it.
  - *Changed by the self-explaining copy pass (2026-10-28; owner direction
    in [AFTER_BETA1_PLAN §2](../../development/AFTER_BETA1_PLAN.md#2-owner-decisions-2026-10-28)).*
    The `projectNeedsProject` tooltip and key are gone: Save, Save As… and
    Close keep only their description by the visible no-project text. Add to
    Workbench keeps a tooltip only for "check it first" and a busy Workbench;
    otherwise the row's own state text is its reason.
- **One zh-CN term each (F6).**

Before commit:

- **An adversarial review** (14 agents over three lenses, each finding
  independently refuted or kept) confirmed two problems, both fixed:
  - the roster help summary's new ring was clipped by its panel;
  - the zh-CN loading announcement disagreed with the visible line.

  It refuted seven others as pre-existing and not worsened. One of them, the
  targeted setup's refused buttons fading their own ring, was fixed anyway
  under F1.
- **The development runs D3 to D5, with the solo probes P1 and P2,** found
  two more things:
  - **A test-timing effect.** Under reduced motion every property
    transitions for 0.01 ms (`app.css`), so a ring read in the Tab's own
    frame is half-way. The spec now waits a frame.
  - **A clipped ring, now the scroll margin's job.** The I3 walk's new
    reach-aware clip check found the spectrum plot's ring cut by the
    evidence column at 960×640. This is pre-existing: the plot is scrolled
    into view without its ring.

| Group | On | Reading at start | Result |
| --- | --- | --- | --- |
| D3a, D3b; D4a–D4d; D5a–D5d (development, dirty tree) | over `0b021af` | lowest 7.10 GiB, 77.6% | D4b failed 5 cases (the two causes above); D5 all green: PM9.7 12, PM9.1 55, viewer-r1 49, PM9.3 19, m7.3 16, PM9.6 32, m7.2 11 |
| P1, P2, scratch probes (`.tmp/pm97-probe/`, not kept), each alone between the D4 and D5 pools | over `0b021af`, dirty | 9.25 GiB, 70.8%; 9.06 GiB, 71.4% | P1 reproduced D4b's `3px solid rgb(255, 255, 255) 0px` only in zh-CN with reduced motion; P2 found the focused button's outline transitions still running in the Tab's frame, and the 2 px `#1769d1` ring 0.8 s later |
| U1-2 full Vitest (parallel) | `a4616de` | 10.81 GiB, 65.9% | 111 of 112 files, 2260 of 2261 tests: M73Viewer's "exports only committed axis ranges while drawing or pending, then the newly confirmed range from retained tokens" timed out at 5175 ms against its 5000 ms limit |
| U1-2r that file, alone | `cfeb758` | 8.18 GiB, 74.2% | 4 of 4; the case in 2057 ms. Contention, not a fault |
| G-PM9b-2 | `a4616de`, dirty (`slice-07.md`) | 10.00 GiB, 68.4% | refused: `slice-07.md` was being edited while the pool ran (the owner's decisions, committed 12 s later as `cfeb758`). It stays refused |
| G-L1-2, G-L2b-2, G-PM9a-2, G-L3-2, G-L4-2, G-L2a-2, G-M-2, I1-2, B0-2, S1-2, T-2 (parallel) | `cfeb758` (docs only after `30b855f`'s tests `e94fb16`) | lowest 5.61 GiB, 82.3% (G-L3-2) | all exit 0, every spec passing, with the same counts as candidate 1; PM9.7 12 of 12 under the strict ring assertions |
| G-PM9b-3, G-PM9b-2's run under a new name | `cfeb758` | 7.91 GiB, 75% | PM9.6 32, PM9.3 19, PM9.4 9, PM9.5 10 |
| M7, J1–J6 after side, alone | extracted `30b855f` (archive `34a89246…bc12`) | 7.47 GiB, 76.4% | 9 of 9; every journey identical to the before side on every counted field; `journeys.json` `3ad72b8a…d5d3` |
| U1-3 full Vitest, alone | `cfeb758` | 7.64 GiB, 75.9% | 112 files, 2261 tests passed (one more than candidate 1: F6's guard) |
| C2 `check_repo`, `git diff --check`, scoped comparison | the record's own tree | light | passed; since `57915de`, outside `apps/desktop/src`, the e2e tests and the documents, only the root `package.json`'s `qa:pm9:manual` line and a docstring in `scripts/check_repo.py` (`859eaf0`) changed; no Rust, IPC, DTO, schema, manifest, lock or workflow path changed |

Deviations from §8, recorded rather than amended after the fact:

- **The stagger.** §8 staggers launches by 30 seconds.
  - Candidate 1's two pools kept to it.
  - Candidate 2's pool (`pool-20261014T004514`) launched 20 s apart.
  - The development pools launched 5 s apart (D3) and 15 s apart (D4, D5).

  No owner decision changed the stagger. Every start reading still met the
  stop line: the lowest was 5.61 GiB free and 82.3% used (G-L3-2).
- **The gate.** Candidate 2's groups, the development runs and the probes all
  started under the stop line alone.
  - For the browser groups, B0, M7 and the groups the second amendment names,
    that is §8's amendments.
  - No written amendment covers U1-3, the full Vitest run, or the
    development runs.
  - Four of these started below the standing 8 GiB admission line, which
    refused D2 at 7.28 GiB: U1-3 (7.64 GiB, 75.9%), D4a (7.10 GiB, 77.6%), D4c
    (7.66 GiB, 75.8%) and D5d (7.40 GiB, 76.6%).
  - Their results stand as recorded.
- **V2 was not rerun on candidate 2.**
  - Its five files are unchanged since `0b021af`, so its Vitest replacements
    pass within U1-3's 2261 tests, which report totals only.
  - The browser replacements, m7.3's wheel-and-pan case and PM9.3-V7, pass by
    title in G-L4-2 and G-PM9b-3.

**What PM9.7 establishes.**

- **U1 and U10.** The integrated journeys keep every context, draft and view
  across navigation, and send no background work. Against PM9.1's baseline
  they cost exactly what they did on `d56b17b`.
  - No step, confirmation, call or mount is added.
  - The presentation changed: the context line in place of the 89 px notice
    band (PM9.2), the evidence-first viewer (PM9.3), the review leading to its
    action (PM9.4, PM9.5), and results beside their evidence (PM9.6).
- **U2–U8.** Each slice's focused acceptance holds on the frozen candidate in
  its own spec and in the legacy specs that cover the same surfaces.
  - **U4's live-provider check** stays `BLOCKED_PROVIDER_HOLD`; the owner
    accepted U4 with it open.
  - **The real engine and real files behind U5–U7** stay `PENDING`.
- **U9.** The surfaces render in both languages at the anchors.
  - Every keyboard stop walked is on screen, uncovered and unclipped with its
    ring, and draws the design system's ring.
  - Native rendering at the host's 150% stays `PENDING`.
- **Regression.** The brief's list holds in every tested scope. Every
  browser spec in the corpus passes on the frozen candidate.
- **Not proved:**
  - native dialogs, real files, a provider or engine run;
  - native WebView2 at 150%;
  - a screen reader.
