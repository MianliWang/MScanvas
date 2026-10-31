# Owner decisions for the v5.11 backend roadmap

Status: **Partly decided: the owner answered the 21 decisions of section 3 on 2026-10-30 (section 1b); the other 32 stay open** ([OWNER_DECISIONS_V511.md](OWNER_DECISIONS_V511.md)). Nothing here authorizes a release, an upload, a dependency change or outbound contact; each keeps its own approval.

Date 2026-10-30. This document consolidates every decision the owner still has
to make before or during the roadmap in `ROADMAP_V511_AND_ANALYSIS.md`. Nothing in it is decided
until the owner answers; each recommendation is the working default until then.
*2026-10-30:* the owner answered all 21 decisions of section 3 as recommended; section 1b gives each answer and what it leaves open. The 32 in sections 4 and 5 stay open.

Re-checked again at about 23:00 UTC. Since 15:45 UTC, #185 opened for
`fix/backend-defects-1030` (ready, nine checks green), #187 for `be/run-history`
(ADR 0065, draft, stacked on `be/integrate`) and #188 for
`docs/runtime-release-adr` (ADR 0066, draft). DEF-1 now covers both of #185's
proposed changes. RUN-1 carries ADR 0065's five questions and moves to section 3.
B-1, B-2 and B-3 carry ADR 0066's nine: B-1 corrects its earlier claim that a
runtime fix needs no app release, and B-2 sets its lean beside ADR 0066 decision 8.

Re-checked against `origin` and the open PRs at about 15:45 UTC. Since the
first version: #181 (`be/viewraw-op`), #182 (`be/reader-meta`), #183
(`be/map2d`, ADR 0068) and #184 (`docs/study-model-adr`, ADR 0067) opened,
`fix/backend-defects-1030` and `docs/m10-route` were pushed, and #164's checks turned green by
recolouring the frozen figure goldens (FE-1). The affected decisions say so.

Revised at about 14:30 UTC, after the owner wrote at 14:09 UTC, about the
frontend options shown so far: "这几个前端选项我都不满意" (none of these frontend
options satisfies me). The frontend questions are rewritten (FE-1 to FE-3), the
questions that belonged to the rejected redesign are withdrawn (section 1a), and
every "after #164" or "direction A" dependency now points at FE-1 or FE-2.

Aligned with `ROADMAP_V511_AND_ANALYSIS.md` after 14:38 UTC, when the two plans were merged.
Item ids are now the roadmap's (see "Item ids" below and section 9). B-11 is
new: it collects the analysis plan's measurement gates. B-1, B-3 and B-9 take in
three analysis-plan questions. G3 keeps EXP-20 out of this roadmap, like both
plans. S-7 moves the reviewed mark to the annotation work. A0062 points at #180,
which opened at 14:38 UTC.

**Inputs read:**

- `v511gap/GAP_TABLE.md`, `v511gap/gap.json` (119 missing rows);
- `analysis-plan/research/SYNTHESIS.md` (section 7, D1–D15), `stats.md`, `openms.md`, `internal.md`;
- `xic/XIC_EVALUATION.md` (sections 9–11, 13);
- `design/v2/HANDOFF.md` (the redesign of direction A, demo A2, whose three themes the owner rejected), `design/GOALS.md`, and the owner's v5.11 demo (`mscanvas_unified_demo_v5_11.html`, its font stacks);
- the owner's message of 2026-10-30, 14:09 UTC, and the maintainer agent's response in the session: the Cobalt and Almanac finish reviews stopped; #164's round 2 limited to functional findings; a Chinese feature brief for new design directions started in Claude Docs ("MSCanvas 功能清单：给新设计方向的输入");
- on `origin/main` (`7ac5a219`): `AGENTS.md`, `PROJECT_PROPOSAL.md`, `docs/development/AFTER_BETA1_PLAN.md`, `docs/product/FEATURE_CATALOG.md`, and ADRs 0046–0060;
- the bodies of open PRs #161, #164, #175, #176, #177, #178, #179, #185, #187 and #188;
- the proposed ADRs on `origin/be/restore-workspace` (0061), `origin/be/copy-diagnostics` (0063), `origin/docs/m10-route` (0064), `origin/be/run-history` (0065) and `origin/docs/runtime-release-adr` (0066);
- the sibling non-runtime plan (`roadmap/non-runtime.md`, revised at 14:23 UTC after the owner's message), which has its own decision ids ND-01 to ND-21 (mapped in section 8);
- the wave-3 lanes, as of about 23:00 UTC (they keep moving):
  - `be/saved-figure`: ADR 0062, draft PR #180;
  - `be/viewraw-op`: ADR 0060 slice 2 and its notes, PR #181 (ready for review, head `5dc7d807`);
  - `docs/m10-route`: pushed at `7f91c05b`, three commits past `ab4ffe63`; ADR 0064 now asks eight questions;
  - `be/reader-meta`: draft PR #182, library only, stacked on #175;
  - `fix/backend-defects-1030`: PR #185, ready, head `efd0294a` (`f127692d`, `5cfd8efb` and one more commit), nine checks green;
  - `be/run-history`: ADR 0065 (Proposed), draft PR #187, Rust side, stacked on `be/integrate`, one failing Rust test;
  - `docs/runtime-release-adr`: ADR 0066 (Proposed), draft PR #188, docs only;
  - `be/map2d`: ADR 0068 (Proposed) and the MS1 map library, draft PR #183, stacked on #175;
  - `docs/study-model-adr`: ADR 0067 (Proposed), draft PR #184 at `8870e36e`.

**How to read it:**

- **Urgency** takes one of three values:
  - **now**: the decision blocks work that is running or can start this week (open PRs, wave-3 lanes, governance, the first Track A and Track B steps);
  - **before-its-slice**: the decision is needed before the named slice starts. Until then the recommendation is the working default;
  - **later**: no slice in the near plan needs it.
- **Kind** takes one of two values:
  - **choice**: the owner picks between real options;
  - **confirm**: the work was built or written as recommended, and a "yes" closes it.
- **Default stands**: a record already sets a default. The owner answers only to change it.
- **Sizes** are counted in slices (AFTER_BETA1_PLAN section 4: one working session, 0.3–1 calendar day). Figures come from the cited source. A figure marked *estimate* is derived here, and its basis is given.
- **Item ids** are those of `ROADMAP_V511_AND_ANALYSIS.md`: N-xx (from the non-runtime plan) and A-xx (from the analysis plan); both plans stay in the planning workspace, and `ROADMAP_V511_AND_ANALYSIS.md` appendix A gives each item's size basis and source. An "-UI" suffix marks a unit's interface item. Step names from the research map to them:
  - SYNTHESIS step B0 = A-02; U1 = A-20 and A-20-UI; U2 = A-21 and A-21-UI; U3 = A-22 and A-22-UI; U4 = A-23; U5 = A-24; U4 and U5 interface = A-23-UI; U6 = A-25 and A-25-UI; B7 = A-30 to A-32;
  - SYNTHESIS step A1 = N-10, N-05 and N-06; A2 = N-11, N-A2 and N-A3; A3 = N-12 and N-A1; A4 = N-A4, then N-A5, N-A7 and N-A8; A5 = N-A9; A6 = N-A10; A7 = N-14, N-X3 and N-X4;
  - XIC X0 = N-13; X1 to X3 = N-X1; X4 and X5 = N-X2;
  - merged ids: the analysis plan's A-01 is N-10, and its A-10 and A-11 are N-F4.

  Section 9 lists, for each decision, the roadmap items it gates.
- **Planning sources.** Some sources stay in the planning workspace and are not in the repository: the gap table (`GAP_TABLE.md`, `gap.json`), the research (`SYNTHESIS.md`, `openms.md`, `others.md`, `stats.md`, `internal.md`), the XIC evaluation (`XIC_EVALUATION.md`), the non-runtime plan (`non-runtime.md`) and the analysis plan (`analysis.md`). `ROADMAP_V511_AND_ANALYSIS.md` appendix B lists every gap row with its function.
- **Sources** cite anchors:
  - `SYN §7 Dn`: SYNTHESIS.md, section 7, decision n;
  - `XIC §11.n`: XIC_EVALUATION.md, section 11, item n;
  - a GAP_TABLE row id;
  - `file:line` on `origin/main`, unless a branch is named;
  - "PR #n body".

---

## 1. Decided already, not asked again

| Item | Decided | Where |
| --- | --- | --- |
| Every backend wave-3 item starts now, including reader metadata, polarity and run summary | 2026-10-30 | Owner direction (task). The reader-metadata lane is now draft PR #182. Its ADR 0056 decision-1 amendment comes back as a proposed record to accept, not as a new question |
| Schema-4 projects are read, and upgraded to schema 5 on the first changed Save | 2026-10-30 | PR #161 body, "Answered by the owner" |
| Thermo vendor centroiding "MS1 and above" and "MS2 and above" are verified rows | 2026-10-30 | PR #161 body; ADR 0059 |
| The reader's two ratified deviations: the `msaccess` operations are kept, and `unit_not_an_accession` is added | 2026-10-30 | PR #175 body, "Owner decisions" |
| Data-document version bumps (spectrum 3/4, chromatogram 2) | 2026-10-30 | PR #175 body |
| Branch protection: `main` requires all nine checks | 2026-10-30 | PR #175 body |
| The 44 Dependabot alerts stay open and are fixed later | 2026-10-30 | Owner (task); `origin/docs/alerts-deferred`. The runtime's Pillow alerts come back only under B-1 and B-3 |
| Numpress spectra keep the viewer's typed refusal | 2026-10-29 | AFTER_BETA1_PLAN section 2, 2026-10-29 item 5 |
| Per-output adoption (ADR 0052) | Accepted 2026-10-28 | `0052-per-output-adoption.md`:3 (adopt-output worktree); PR #179 body. No open question: the rendered check of a large SCIEX set at 960x640 is QA that the owner's own acceptance asked for |
| Preset floats: tolerances are carried as integers or decimal strings, so the `float_roundtrip` dependency is not needed | Resolved by design | ADR 0058:147–151 on `origin/be/integrate`; PR #151 body |
| Secondary explanations removed (RO-26, SET-10, C12) | 2026-10-28 | AFTER_BETA1_PLAN section 2 |
| MSCanvas ships no preset (C41) | 2026-10-29 | ADR 0058 decision 1 |
| Product PRs merge after all checks pass and every thread is resolved | 2026-10-29 | AFTER_BETA1_PLAN:58–62, "Merging" (the record has no "accepted decisions" qualifier; the maintainer agent's memory note has it). M161 asks whether it covers #161. FE-1 asks whether it still covers #164. Both were answered on 2026-10-30 (section 1b) |

### 1a. Withdrawn on 2026-10-30, not asked

The owner rejected the frontend options shown so far (14:09 UTC). These
questions belonged to those options and are not put to the owner:

| Withdrawn | Was | Where it went |
| --- | --- | --- |
| Direction A ("v5.11 refined") as the frontend target | Chosen 2026-10-29 (PR #164 body, first line) | FE-1 (what #164 still merges for) and FE-2 (the new target) |
| The A2 theme pick: Cobalt, Almanac or Console (HANDOFF Q1) | Asked in the earlier version of this document as FE-1 | Gone. The three themes share one composition, so the rejection reaches the composition, not only a palette |
| HANDOFF Q2, the six ADR interpretations (ADR 0060 decisions 1 and 3, open question 8; ADR 0055 decision 3 and the 2026-10-29 label) | FE-1 | Gone. Each ADR's content stands; its placement is set again under FE-2 |
| HANDOFF Q3 (the roster footer at about 73 px), Q5 (16 builder-proposed keys), Q6 (the Console light accent), Q7 (the Cobalt and Almanac finish reviews) | FE-1 | Gone. The maintainer agent stopped the two reviews |
| HANDOFF Q4, bundling the chosen theme's faces | FE-3 | FE-3, rewritten for the new look |
| #164's five layout answers, as owner choices | FE-2 | Folded into FE-1 as interim defaults. Asking the owner to confirm details of a rejected direction would ask the wrong question |
| ADR 0060 open question 8, "Recommended: direction A" | A0060 | A0060 now answers it through FE-1 and FE-2 |

### 1b. Decided on 2026-10-30, as recommended

The owner was shown the list of the 20 decisions that block work now, which is all of section 3 except S-1. The owner replied, verbatim: "全部按推荐，继续" ("all as recommended, continue"). Earlier the same day the owner approved S-1, verbatim: "批准" ("approved"). Each answer is that decision's recommendation in section 3. Section 3 keeps the question, options and sources as the record of what was asked. The records an answer names (ADRs, `AGENTS.md`, `PROJECT_PROPOSAL.md`) take it in their own PRs, not here. The 32 decisions in sections 4 and 5 stay open, and their recommendations stay working defaults.

| Id | Answer | Left open, or work that follows |
| --- | --- | --- |
| FE-1 | (a): #164 merges as the functional base once round 2's findings close and all nine checks pass. Its five layout answers become interim defaults, reversible under FE-2. Each settings level gets one name: "Basic settings" and "Advanced settings" (基本设置 and 高级设置). The export half of `66a6067c` and all of `3a416010` are reverted, and the screen tokens stay | Work: the export revert in #164. A later export palette goes through L-FIG with its own document version |
| FE-2 | (a): the owner's own v5.11 demo is the target for look and layout, ported onto #164's tokens and components. One real screen, the Workbench at 1366x768 in the real app, is shown first. No more theme rounds. The fixed points listed under FE-2 stay | Open: what the owner found wrong (layout and hierarchy, controls, colour or type). N-02 is sized again: 4 slices if only the look changes, 6–8 if the layout goes too. FE-3 stays open (section 4) |
| G1 | (a): `AGENTS.md`, `PROJECT_PROPOSAL.md` and the product records are amended with the exact wording proposed under G1, unedited. The 10-condition promotion gate and the four rules stay. Analysis is milestone M11 and runs in parallel with M10. The three core jobs keep priority | Work: N-10 applies the wording as written, with the other records G1 lists, in its own PR. Neither file changes here |
| G2 | (a), yes to both. Track A ships before the Python runtime. An imported feature table is a project artifact with its own digest, import record and lineage. MZmine-2-style CSV comes first, up to the 64 MiB payload cap in v1 | None |
| G3 | (a): the split under G3. The data-safety refusals and the owner's own removals stay refused: C17, C28, C50, C41, RO-26, SET-10, C12, C19 and EXP-21. The analysis rows reopen, each behind G1's gate. C59 and EXP-20 stay outside this roadmap | Open: the rows decided separately keep their own decisions. These are VW-14 (V-4), VW-33 (V-1), VW-47 (V-5), C15 (HR-1) and VW-02's exports and panel (X-3) |
| G4 | (a): each analysis page enters the navigation when its first working function ships. There are no placeholder pages. FE-2's target leaves room for five page tabs at 960 px | None |
| P175 | (a): #175 keeps exporting a declared profile spectrum as a line, and its webview commit draws the same line on screen | None. N-05 is 4 slices and N-06 is 1 |
| A0060 | Q1: a View button. Q8: slice 3 builds on #164's structure (FE-1 (a)), with decision 1's content, the phases, Cancel and the CNV-D8 progress amendment as written. The pane's place moves with FE-2. ADR 0060's slice-2 notes 2 (#181's two cases) and 3 (the departure from decision 6) are accepted as written. The defaults of Q2–Q5 and Q7 stand | Open: Q6, the hold release, under HR-1 |
| A0061 | ADR 0061's four questions as it recommends. *2026-10-31:* Q1 is one explicit Restore workspace action the user starts, not automatic at start-up; this replaces the earlier "automatic". Restore is on by default. The checked state is restored, and the off switch is in the restore document. The roster stays out of the `.mscanvas` project file for now. *2026-10-31:* Q10, no: `matching` does not mean unchanged content. A restored row is a locator plus an arrangement, put-back admits the bytes there then as Add files does, and the interface says the row is added again, not verified | Open: the roster in the project file comes back with S-6. ADR 0061's questions 5 to 9 stay open |
| A0062 | ADR 0062's seven questions as implemented: (1) a standalone `.msfigure` JSON file; (2) a changed source is refused, with no relink and no redraw; (3) the data digest and (4) the document digest are kept; (5) paths are relative inside the document's folder and absolute outside it; (6) no saved figure in project documents or stored targeted results in this slice; (7) a figure whose source is a cache entry cannot be saved. One change to Q5: the save dialog shows the recorded locator itself and no help sentence | Work: #180 drops Q5's help sentence. Open: the locator that would let a cache-entry figure be saved (Q7) |
| A0063 | ADR 0063's five questions as recommended: (1) only the known root of the ProteoWizard folder is named; (2) the error ring is recorded at `PreviewErrorDto::new`; (3) a `Verified build` line is added after #161; (4) a Settings button, a read-only preview and the text clipboard; (5) workspace contents stay out. *2026-10-31:* (6) the account-name check stays as implemented: only the value shapes that admit a word, matched as a whole word; (7) a failed conversion's outcome (`detailedOutcome`, else `outcome`) joins the recent-errors ring, recorded at the report projection, and decision 2 says the ring also holds conversion outcomes | Work: Q7 is implemented after #161 merges, because the report projection is #161's code. The button comes after #164 |
| A0064 | ADR 0064's eight questions as recommended: (1) route A1 now; (2) MCP runs approved through elicitation, with clients without it refused; (3) the desktop refuses operations that would start ProteoWizard while the CLI holds the run lock; (4) the installer carries `mscanvas.exe` and does not change PATH; (5) the CLI requires roots; (6) `run --reclaim-staging` as written; (7) `CREATE_NO_WINDOW` for every backend process; (8) a fixed cap on the MCP store, with `planStoreFull`. ADR 0058 is amended in the same step, so a method can leave the app as a plan file. *2026-10-31:* Q3 confirmed again with the corrected cost: opening a new preview is refused too while the lock is held, because an open still runs `msaccess`, until the reader's own run summary replaces it (R-1) | Work: the ADR 0058 amendment. Open: question 7's hold-release window, under HR-1 |
| RUN-1 | ADR 0065's five questions as recommended: (1) history is on by default; (2) Off forgets what is stored; (3) 200 runs and 64 MiB in total, 16 MiB per run; (4) the advanced intent is stored; (5) Clear keeps runs in progress. History is app-local and per user, never in the project. EXP-25's JSON is one run's redacted record | None |
| DEF-1 | Both of #185's proposed changes are accepted. Save As, and every new project's first save, reserve the result-store name and leave `<name>.mscanvas.payloads`. Rows a refused queue never reached settle as Not run, and Retry leaves them | Work: squash-merge #185. The rendered retry-queue check belongs to N-01 and N-03 |
| M161 | No: the 2026-10-29 rule covers #161 once its blockers 1–6 close | None |
| U7 | (a): one umbrella decision admits project-owned computations over the reader's decoded arrays, each with its own per-algorithm record. It also amends the retention invariant, so that a bounded, cancellable full pass may run and keep only its result | Work: the umbrella decision is written with N-13 (X0) |
| X-1 | Option 2: the full XIC re-enters through the X0 scope record, with XIC §11 items 1, 6, 7, 11 and 12 as recommended | None. X-3 stays open (section 4) |
| X-2 | All accepted: (1) the four departures from ADR 0046 §1, which are ppm input and the whole-query refusal of mixed polarity, mixed FAIMS CV and mixed representation; (2) polarity rule P1 now, and P2 in a later record; (3) the profile point sum, labelled "sum of profile points, not an area", with the owner as S1's owner in the record; (4) MS1 only; (5) the preview's open refusals in front of the engine, with the narrower domain disclosed | None |
| R-1 | The amendment is accepted: polarity, charge, run-level metadata and the run summary from the table pass. #182's five choices are accepted as it states them. PRJ-006's BPI retention times: (a) now, from `msaccess`; then (c), computed from the declared base-peak values under a short record under U7 and matched to `msaccess` on a fixture first. If they cannot be matched, (a) stays. #154's terms: polarity and charge now | Open: analyzer and filter string, taken only if #154's columns stay in the rebuilt scan table. The recommendation takes no scan event or ion injection time. The recorded `msaccess` pair is HR-1 item 6 |
| S-1 | Approved: `nalgebra =0.35.0` (`default-features = false, features = ["std"]`) and `statrs =0.19.1` (`default-features = false`) as production dependencies of `crates/stats`. Pinned scipy, statsmodels and numpy are used only in a development fixture generator. Its outputs are committed, and nothing from it ships | Open: `kodama`, only if S-2 asks for clustering. Work: the lockfile crate count is derived again with `cargo tree` at admission |
| B-1 | (b), ADR 0066 decision 1: a separate, verified runtime package beside each release, which the user installs. Every fix to a shipped runtime component is an app release. Decision 2 is accepted: the runtime goes per machine under `%ProgramFiles%\MSCanvas Analysis Runtime\<digest>\`, and the work area under `%ProgramData%\MSCanvas\work\<user SID>\`. Question 6: AppContainer confinement is a release blocker only if A-06 shows it can be enforced without administrator rights; otherwise a release ships with the stated limit and the measured mitigations. Question 8: the hash-pinned wheels and the release-workflow change are approved with ADR 0066, effective at the first runtime release (A-05); nothing ships before then. Question 9: a reading on redistributing the MSVC runtime copies is asked for, with B-2's Qt reading if that is still needed | Open: question 3, a user without administrator rights (working default: require elevation). Also open: the question-9 reading itself, which blocks A-05, and B-2 (questions 5 and 7) and B-3 (question 4). ADR 0066 stays Proposed, and B-2 is decided before it is accepted |

---

## 2. Summary

Ordered: work blocked now first, then by the slice each decision gates. Counts: 21 now, 25 before-its-slice, 7 later (53). The 21 now were decided on 2026-10-30, as recommended (section 1b); the other 32 stay open.

| # | Id | Decision | Recommendation | Kind | Urgency |
| --- | --- | --- | --- | --- | --- |
| 1 | FE-1 | Does #164 still merge, for its behaviour only, now that its look is rejected? | Decided 2026-10-30: yes, as the interim base: its five layout answers as interim defaults, one name per settings level, and the export palette of `66a6067c` and the recoloured frozen goldens of `3a416010` reverted | choice | now |
| 2 | FE-2 | What the new look is, and how it is chosen | Decided 2026-10-30: the owner's own v5.11 demo, ported onto #164's tokens and components, one real screen first; no more theme rounds | choice | now |
| 3 | G1 | Record the analysis direction in AGENTS.md, PROPOSAL and the product records | Decided 2026-10-30: amend them. Keep the promotion gate and the four safety rules. Run analysis in parallel with M10 | choice | now |
| 4 | G2 | Two tracks: Track A ships before the Python runtime; an imported feature table is a project artifact | Decided 2026-10-30: yes to both; MZmine-2-style CSV first | choice | now |
| 5 | G3 | Which refused v5.11 rows stay refused | Decided 2026-10-30: keep the data-safety refusals and the owner's own removals. Reopen the analysis rows | choice | now |
| 6 | G4 | When the analysis pages enter the navigation | Decided 2026-10-30: each page appears when its first working function ships. No placeholder pages | choice | now |
| 7 | P175 | Export profile spectra as lines in slice 2, before slice 3 | Decided 2026-10-30: keep it, and draw the line on screen in the same webview commit | choice | now |
| 8 | A0060 | ADR 0060 Q1 (entry point) and Q8 (direction); slice-2 notes | Decided 2026-10-30: a View button; slice 3 builds on #164's structure and moves with FE-2; accept the notes. Q2–Q7 defaults stand | choice | now |
| 9 | A0061 | ADR 0061's four restore questions; the roster in the project file | Decided 2026-10-30: as recommended; the roster stays out of `.mscanvas` for now. 2026-10-31: Q1 is one explicit Restore workspace action, not automatic; Q10, no | confirm | now |
| 10 | A0062 | ADR 0062's seven saved-figure questions | Decided 2026-10-30: as implemented, except that Q5 drops its help sentence | confirm | now |
| 11 | A0063 | ADR 0063's five diagnostics questions | Decided 2026-10-30: as recommended. 2026-10-31: Q6 and Q7 as recommended | confirm | now |
| 12 | A0064 | ADR 0064's eight M10 route questions; ADR 0058's "presets stay in the app" | Decided 2026-10-30: as recommended; amend ADR 0058 so a method can leave the app as a file. 2026-10-31: Q3 confirmed again with the corrected cost | confirm | now |
| 13 | RUN-1 | ADR 0065's five questions on conversion run history (RUN-007; EXP-23, EXP-25) | Decided 2026-10-30: as recommended: on by default, Off forgets, 200 runs and 64 MiB, the advanced intent stored, Clear keeps runs in progress; app-local, never in the project | confirm | now |
| 14 | DEF-1 | #185's two proposed changes: every new project's first save and every Save As to a new name leaves a `.payloads` folder; rows a refused queue never reached settle as Not run, and Retry leaves them | Decided 2026-10-30: accept both | confirm | now |
| 15 | M161 | Does #161 still need the owner's own merge? | Decided 2026-10-30: no. The 2026-10-29 rule covers it once blockers 1–6 close | confirm | now |
| 16 | U7 | One written decision for computation over the reader's decoded arrays | Decided 2026-10-30: yes, one umbrella decision, then a record per algorithm | choice | now |
| 17 | X-1 | XIC re-entry (option 2) and its evidence gates | Decided 2026-10-30: yes, with XIC §11 items 1, 6, 7, 11 and 12 as recommended | choice | now |
| 18 | X-2 | XIC first-scope semantics: four departures, P1 polarity, profile point sum, MS1 only, narrower domain | Decided 2026-10-30: accept all | choice | now |
| 19 | R-1 | The reader-metadata amendment: polarity, charge and run metadata; PRJ-006's BPI times; #154's terms; #182's five choices | Decided 2026-10-30: accept it and #182's five choices; BPI times stay with `msaccess` in #182, then are computed from declared values under a short record, matched to `msaccess` first; analyzer and filter string only with #154's columns | choice | now |
| 20 | S-1 | `nalgebra` and `statrs` as production crates; scipy and statsmodels for fixtures only | Decided 2026-10-30: approve; `kodama` only with clustering | choice | now |
| 21 | B-1 | How the Python analysis runtime is distributed: ADR 0066 questions 1–3, 6, 8 and 9 | Decided 2026-10-30: a separate, verified runtime package (ADR 0066 decision 1), per machine under Program Files; every runtime fix is an app release; confinement a release blocker only if A-06 shows it can be enforced; approve the shipped wheels at the first runtime release | choice | now |
| 22 | R-2 | A chromatogram above 100,000 spectra | Rust sends the chromatogram from its retained rows | choice | before-its-slice |
| 23 | R-3 | Open a new preview during a conversion (ADR 0057 decision 2) | Yes, once the open runs no process | choice | before-its-slice |
| 24 | V-1 | Show a spectrum on open (VW-33) | Select the TIC-apex MS1 scan | choice | before-its-slice |
| 25 | S-6 | Sample metadata fields and schema version | Four fields. Hold schema 5 open until a release ships it, otherwise schema 6 | choice | before-its-slice |
| 26 | S-2 | Statistics definitions | Use the stats lane's table. Missing values in PCA: complete features by default, 1/5-min opt-in. No clustering | choice | before-its-slice |
| 27 | S-3 | Admit normalisation, with "none" as the default | Yes. An absolute overlay is the minimum for VW-48 | choice | before-its-slice |
| 28 | S-5 | What ANA-002 (QC) contains | Track A metrics and class-C filters with a rejected list; blank reference = maximum | choice | before-its-slice |
| 29 | S-7 | Select sorting, filtering, view-scoped export, review marks and notes | Select them | choice | before-its-slice |
| 30 | MAP-1 | The 2D map's forms, and ADR 0068's six questions on the MS1 map | Both forms, each when ready; ADR 0068 as recommended (greatest intensity, log10, vector cells, own worker) | choice | before-its-slice |
| 31 | V-2 | RT filter on the scan list (VW-26) | Link the list to the chromatogram's committed RT range | choice | before-its-slice |
| 32 | V-3 | Relative intensity in percent (VW-22) | A shared FigureSpec option; base = the full spectrum's largest value | choice | before-its-slice |
| 33 | V-4 | View history back and forward (VW-14) | Build it: per plot, 40 deep | choice | before-its-slice |
| 34 | V-5 | Use a plot RT selection as the conversion RT window (VW-47) | Yes, after #161's interface, with a confirmation | choice | before-its-slice |
| 35 | V-7 | Preference-level settings (SET-05, SET-12, VW-04) and the preference schema bump | One bump for every new preference; remembering stays on, with an off switch | choice | before-its-slice |
| 36 | C-1 | gzip output (`-g`) and whether `.mzML.gz` is adoptable | Allow it with the existing `flate2`. Not adoptable in the first slice | choice | before-its-slice |
| 37 | FE-3 | Bundled fonts for the new look | Decide with FE-2. v5.11 uses system faces, so its look bundles nothing; never a CJK face | choice | before-its-slice |
| 38 | DEF-2 | Uninstall and the view cache | Always remove the cache folder; everything else stays opt-in | choice | before-its-slice |
| 39 | HR-1 | ProteoWizard hold releases for the pending measurements | Grant each as a bounded window when its slice is ready | choice | before-its-slice |
| 40 | X-3 | XIC exports and panel | Include exports; give the trace its own panel under the chromatogram | choice | before-its-slice |
| 41 | B-2 | pyOpenMS version (and the Qt6 LGPL question); ADR 0066 questions 5 and 7 | Decide after A-03's probes, before ADR 0066 is accepted: 3.6.0 if the probes pass, which ends the Qt question; otherwise 3.5.0 as ADR 0066 decision 8 recommends, with the Qt reading before release | choice | before-its-slice |
| 42 | B-3 | What the shipped runtime leaves out: HMDB files, matplotlib and Pillow; ADR 0066 question 4 | Strip HMDB (ADR 0066 measured no effect); drop matplotlib and Pillow from the shipped lock if A-03 shows the planned classes run without them | choice | before-its-slice |
| 43 | B-4 | v5.11 fields with no OpenMS equivalent; smoothing; centroided input | Drop the fields with no effect; require centroided input | choice | before-its-slice |
| 44 | B-5 | Negative mode in the first untargeted domain | Positive first; negative as the next slice | choice | before-its-slice |
| 45 | B-6 | The study model for cross-sample work; ADR 0067's ten questions | Study-level runs as ADR 0067 writes them, with pruning; sample metadata on layers, copied into each study revision | choice | before-its-slice |
| 46 | B-11 | Measurement infrastructure for Track B: a non-required runtime workflow and the public datasets | Approve the workflow; public CC0/CC-BY data, already centroided | choice | before-its-slice |
| 47 | S-4 | Drift and batch correction; other imputation | Diagnostics only, then each tier by its own ADR | choice | later |
| 48 | B-7 | Gap filling | FFMI requantification, labelled experimental, with typed cells | choice | later |
| 49 | B-8 | Library similarity metric and library sources | Entropy similarity (`ms_entropy`); user-supplied libraries only | choice | later |
| 50 | B-9 | GNPS/MGF export writer, and sample names in export columns | A project-owned MZmine-2-style CSV and MGF writer; the layer label, never a path | choice | later |
| 51 | B-10 | External engines and outbound messages | Drive only; no message without a per-message go-ahead | choice | later |
| 52 | C-2 | A deeper HDF5 check for mzMLb and mz5 | No new dependency; keep the minimal checks and the label | choice | later |
| 53 | V-6 | Open on example data (SH-16) | Start empty until a small, lawful file is found | choice | later |

---

## 3. Decisions that block work now

*Decided 2026-10-30:* the owner answered all 21 decisions in this section as recommended (section 1b). Each keeps its text below as the record of what was asked.

### FE-1. #164 as the interim base

*Decided 2026-10-30: (a), as recommended (section 1b).*

- **Question.** #164 rebuilds the frontend toward direction A, the owner's
  choice of 2026-10-29. On 2026-10-30 the owner rejected the frontend options
  shown so far. The 2026-10-29 rule lets a product PR merge once every
  required check passes and no thread is open (AFTER_BETA1_PLAN:58–62); the
  owner's authorization, as the maintainer agent holds it, is for accepted
  decisions. The decision behind #164's look is withdrawn, so #164 should not
  merge under that rule without the owner's word. Should #164 still merge,
  for its behaviour only, with the look set later by FE-2?
- **What #164 brings whatever the look:**
  - bordered buttons instead of link-styled actions, and a project-owned primitive set (`components/ui`) with its tokens;
  - refused (not disabled) actions that show their reason;
  - keyboard tab rows and the plot ⋯ menu (VW-16, VW-20);
  - windowed lists at 1,024 items, which #161 needs;
  - live elapsed time (C51) and empty states that name the next step;
  - copy in `en` and `zh-CN`.
- **Three items ride with it:**
  1. **#164's five layout answers** become interim defaults, reversible under FE-2:
     - Acquisitions as an icon-only button at 1051 px and wider;
     - Details open by default at 1280 px and wider;
     - "New project" without an ellipsis;
     - the Raw area column's "(unit not reported)";
     - 24 px Details buttons in the targeted result table.
  2. **One name per settings level.** The conversion settings' "Basic | Advanced" switch and another branch's "Advanced options" disclosure become "Basic settings" and "Advanced settings" (基本设置 and 高级设置).
  3. **The export palette.** Commit `66a6067c` recoloured exported figures in `crates/plot-spec/src/svg.rs` (the measurement trace `#1f4e9c` to `#172337`, the BPC amber to `#4b5b70`) and three plot-golden SVGs. That made #164's Rust check fail on two frozen figure documents (run 41039787422 on `8ef805db`: `the_linked_figure_document_is_unchanged`, `preview/chromatogram.rs`:2193, and `the_stored_target_figure_document_is_unchanged`, `targeted_ms1/tests.rs`:4758). Round 2 then turned the check green the wrong way: `3a416010` ("recolour main's linked and stored-target goldens to the data ink") rewrote `fixtures/plot-golden/linked-full-run.svg` and `targeted-stored-result.svg`, the frozen documents themselves. All nine checks pass on `631a4a6e` (run 41081577399). Revert the export half of `66a6067c` and all of `3a416010`, and keep the screen tokens. A later export palette goes through L-FIG with its own document version.
- **Options:**
  - (a) merge #164 as the functional base once round 2's findings close and all nine checks pass;
  - (b) hold #164 until FE-2 is answered;
  - (c) close #164 and rebuild from FE-2's target.
- **What each costs:**
  - (a): screens built before FE-2 are restyled later. The restyle reaches them through the tokens and `components/ui`, so a relayout is needed only if FE-2 also rejects the layout.
  - (b): the merge chain #164, then #161, then #175 stops. The webview commits of #161, #175, #177, #178 and #179 and ADR 0060 slice 3 either wait or are written against the old frontend and again later.
  - (c): rounds 1 and 2 of behaviour work are redone (*estimate*: M–L).
- **Recommendation: (a)**, with the three items as listed.
  - The maintainer agent has already limited round 2 to functional findings (refusals, keyboard, states, windowing, overflow, contrast, broken layout), which is (a).
  - Publication figures are a core job. Frozen figure documents carry digests, so exported colours should not change for a look the owner has not chosen. Regenerating the frozen documents is not a fix.
- **Blocks:**
  - #164 leaving draft and merging;
  - then the merges of #161 and #175 (in that order) and the webview commits of #177, #178 and #179;
  - ADR 0060 slice 3 (N-R2), the ADR 0062 interface (N-F3) and the XIC interface (N-X2);
  - every viewer item (N-06 and N-V1 to N-V4).

  Size: the export revert is S (*estimate*: one commit; `svg.rs`, its tests and three goldens back to `main`). Round 2's fixes are already running.
- **Urgency:** now. **Kind:** choice.
- **Sources:** the owner's message (2026-10-30, 14:09 UTC); the maintainer agent's round-2 scope note (14:10 UTC); PR #164 body ("Round 2", "Not done", "Copy and naming"); `git show 66a6067c`; `git show 3a416010`; `gh pr checks 164` (Rust fail, run 41039787422 on `8ef805db`; all nine pass, run 41081577399 on `631a4a6e`); AFTER_BETA1_PLAN:58–62 ("Merging") and :153 (section 9 still lists "which demo direction the interface follows"); the maintainer agent's memory note "Merging product PRs is authorized … for accepted decisions"; the non-runtime plan's ND-21 and N-01.

### FE-2. The new look

*Decided 2026-10-30: (a), as recommended (section 1b).*

- **Question.** The owner rejected every option shown:
  - the three demo directions of 2026-10-29 led to direction A;
  - its redesign, A2, offered three themes (Cobalt, Almanac, Console) on one composition, so the rejection reaches the composition, not only a palette.

  What becomes the target, and how is it chosen? Two things to learn from the owner first:
  - what is wrong: the layout and hierarchy, the controls, the colour, the type, or all of them (the owner's earlier four complaints are in HANDOFF section "How each owner complaint was answered");
  - whether the rejection also covers #164's direction-A layout.
- **Options:**
  - (a) the owner's own v5.11 demo as the target for look and layout, ported onto #164's tokens and components. One real screen, the Workbench at 1366x768 in the real app, is shown first, and no further theme rounds are run. `design/GOALS.md`:39 already names v5.11 "the near-term target for layout and controls", with its measured frame (header 56 px, roster 240 px, inspector 245 px, status bar 30 px at 1366 wide);
  - (b) the owner has new directions designed elsewhere from the feature brief now being written, and MSCanvas builds the chosen one on #164's base;
  - (c) another round of in-house directions.
- **Recommendation: (a)**, unless the owner already intends (b); then (b). Not (c): the in-house rounds so far (three directions, then three themes on the chosen one) ended in this rejection.
  - Either way the target keeps what the records and earlier owner choices fix:
    - the 960x640 minimum window, and room for five page tabs at 960 px (G4);
    - bordered buttons, never links; no secondary explanation text (2026-10-28);
    - a refusal stays visible with its reason;
    - `en` and `zh-CN`;
    - exported figures keep their own palette (FE-1, item 3);
    - the scientific rules: no implicit centroiding, backend fallback or output overwrite.
  - Size (the non-runtime plan's N-02): M, 4 slices, if only the look changes; L, 6–8 slices, if the layout goes too. Sized again after the answer.
- **Blocks:** the look slice after #164, FE-3, and ADR 0060 slice 3's final placement. No backend work waits on it.
- **Urgency:** now. The answer shapes the round after #164 and the design brief being written now. **Kind:** choice.
- **Sources:** the owner's message (2026-10-30, 14:09 UTC); `design/v2/HANDOFF.md` ("How each owner complaint was answered", the theme table); `design/GOALS.md`:39; the maintainer agent's feature brief (Claude Docs, 2026-10-30); the non-runtime plan's ND-02 and N-02.

### G1. Record the analysis direction in the governing records

*Decided 2026-10-30: (a), with the wording below unedited, as recommended (section 1b).*

- **Question.** The owner's direction of 2026-10-30 is the decision to un-defer analysis. Should it now be written into the records that agents follow?
- **Records to change:**
  - `AGENTS.md`:19 ("Analysis is deferred but architecturally allowed").
  - `PROJECT_PROPOSAL.md`:
    - :38 (section 1);
    - :144 (section 6, Layer 3, "Deferred until…");
    - section 18, the roadmap at :610, which needs an analysis milestone;
    - section 20, :711–728.
  - `docs/product/PRODUCT_MAP.md`.
  - `ANALYSIS_CAPABILITY_MAP.md`:3 (the status changes; the gate at :24 stays).
  - New FEATURE_CATALOG rows (ANA, the 2D-map VIEW row, the sample-metadata PRJ row).
  - ADR 0047:61, the "Analysis, nodes, code, AI" row.
  - M9_CLOSURE section 12.
  - The design-goals draft D5, "Analysis is out" (`design/GOALS.md`:69, in the design workspace).
  - An analysis track in AFTER_BETA1_PLAN.
- **What stays unchanged:**
  - the 10-condition promotion gate;
  - no generic plugin ABI;
  - "reuse mature backends; no reimplementation without a written decision";
  - "no implicit centroiding, backend fallback or output overwrite";
  - PROPOSAL section 20's exclusion of "disconnected dashboards without artifacts, selection and lineage".
- **Options:**
  - (a) amend as above;
  - (b) amend for Track A only, and Track B later;
  - (c) leave the records as they are.
- **Milestone order.** Call the analysis milestone M11, but run it in parallel with M10 (ADR 0064). The two use disjoint files. The three core jobs (batch conversion, viewing spectra, publication figures) keep priority.
- **The exact wording proposed for (a).** Each change replaces one line or paragraph, or adds one; nothing else in either file changes. Paths are written as code here; the applied text makes them links. The owner accepts or edits this text first; N-10 then applies it as written, with the other records in the list above.
  1. `AGENTS.md`:19, under "Product rules". Now:

     > - The early product is viewer + converter + figure export. Analysis is deferred but architecturally allowed.

     Proposed:

     > - The early product is viewer + converter + figure export, and those three jobs keep priority. Since 2026-10-30 analysis is planned and built (roadmap: `docs/development/ROADMAP_V511_AND_ANALYSIS.md`) on two tracks: Track A needs no Python runtime; Track B (pyOpenMS) reaches users only through a released, verified runtime. Each analysis function still passes the promotion gate in `docs/product/ANALYSIS_CAPABILITY_MAP.md`.

  2. `PROJECT_PROPOSAL.md`:38, section 1. Now:

     > The first product is therefore a **viewer + converter + figure workspace**. Analysis is a deferred capability, not a permanent exclusion.

     Proposed:

     > The first product is therefore a **viewer + converter + figure workspace**. Analysis follows it: on 2026-10-30 the owner directed that it be planned and built (milestone M11, section 18), without displacing the three core jobs.

  3. `PROJECT_PROPOSAL.md`:144, section 6, Layer 3. Now:

     > Deferred until the first workflows are dependable:

     Proposed:

     > Planned and built from 2026-10-30 (M11, section 18); each module still passes the analysis promotion gate and keeps the rules of section 20:

  4. `PROJECT_PROPOSAL.md` section 18, a new entry after "M10 — Automation":

     > ### M11 — Analysis
     >
     > The analysis functions of the v5.11 demo, on two tracks that run beside M10. Track A needs no Python runtime: sample metadata, imported feature tables as project artifacts with their own digest and lineage, project-owned statistics in Rust, the XIC and the 2D map. Track B is pyOpenMS feature detection, alignment, gap filling and annotation, in the supervised worker; it reaches users only through a released, verified runtime. Each function needs its own record, typed recipe, provenance and rendered QA, and passes the promotion gate in `docs/product/ANALYSIS_CAPABILITY_MAP.md`. See the roadmap, `docs/development/ROADMAP_V511_AND_ANALYSIS.md`.

  5. `PROJECT_PROPOSAL.md` section 20, a line added under the list "Not required for the first public product" (the list itself stays as the record of beta 1's scope):

     > *2026-10-30:* the first public product shipped as beta 1. XIC, multi-file overlays, feature detection, alignment, annotation and statistics are now planned under M11. A workflow canvas, a stable CLI/MCP and a persistent run database keep their own records (C59, ADR 0064, RUN-1).

  The list "Excluded by design unless a future decision reverses them" does not change, and neither do AGENTS.md's other rules.
- **Recommendation: (a).** AGENTS.md is what agents follow, and only the owner can approve its text. The gate and the four rules keep the scientific guarantees, so each v5.11 module still has to earn its place.
- **Blocks:**
  - every Track A and Track B slice;
  - G4 and the analysis pages;
  - the schema, statistics and runtime ADRs (SYN §6.1 P1–P7).

  Size: 1 docs slice (*estimate*: one docs PR across about 8 records, SYN §6.1 P0).
- **Urgency:** now. **Kind:** choice.
- **Sources:** SYN §7 D1, §6.1 P0; internal.md §2.1 H1–H10 and §5 items 1–5 and 10.

### G2. Two tracks, and imported feature tables

*Decided 2026-10-30: (a), as recommended (section 1b).*

- **Question.** Two parts:
  - May **Track A** ship in releases before the Python analysis runtime is released? Track A is Rust statistics on feature tables, sample metadata, scan browsing and the 2D map.
  - May a feature table **imported** from elsewhere be a project artifact that the statistics and QC pages run on? It would carry its own digest, an import record and lineage. MZmine-2-style CSV comes first, as the de facto GNPS contract.
- **Options:**
  - (a) yes to both;
  - (b) Track A for scan browsing and the map only, with statistics waiting for MSCanvas's own feature detection;
  - (c) one track, with everything after the runtime release.
- **Recommendation: (a).** Release builds answer `recipeUnavailable` for every pyOpenMS function until the runtime-release ADR lands. Track A gives 统计与质控 real use without the 349 MB runtime. An imported table with a digest and lineage stays within PROPOSAL section 20. The import starts with MZmine-2-style CSV, up to the 64 MiB payload cap in v1, and moves to chunked matrices only on a measured need (the non-runtime draft's ND-07).
- **Blocks:** Track A's analysis items in `ROADMAP_V511_AND_ANALYSIS.md`: N-A1 to N-A14, N-X3 and N-X4.
- **Urgency:** now. **Kind:** choice.
- **Sources:** SYN §7 D2, §0 item 5, §4 item 4, §6.2; stats.md §14 Q6.

### G3. Which refused v5.11 rows stay refused

*Decided 2026-10-30: (a), as recommended (section 1b).*

- **Question.** The direction asks for every v5.11 function. 40 rows are refused or deferred by a record. Which refusals stand?
- **Options:**
  - (a) the split below;
  - (b) reopen every row;
  - (c) reopen only the analysis modules.
- **Recommendation: (a).**
  - **Keep refused.** Each refusal protects data or scientific honesty, or is the owner's own earlier decision:
    - C17, CWT centroiding: M6.2 found 1 of 3 peaks and an unterminated document (ADR 0055 decision 7);
    - C28, custom output extension: a name could disagree with the contents (MSCONVERT_OPTION_INVENTORY.md:72);
    - C50, ETA: fabricated progress or ETA stays refused (AFTER_BETA1_PLAN 7.6). Live elapsed time, C51, is in progress;
    - C41, built-in templates: ADR 0058 decision 1;
    - RO-26, SET-10, C12 and C19, which are explanation text, removed on 2026-10-28;
    - EXP-21, parsing pasted Python or R code. JSON plan import (EXP-19) under ADR 0064 covers the function.
  - **Reopen under the direction**, each behind G1's gate:
    - MOD-01 to MOD-07, MOD-09, MOD-10 and MOD-12;
    - FA-07, FA-09 and XV-01;
    - STAT-01, -02, -04, -05, -07 and -08;
    - EXP-15;
    - RO-17, RO-22 and RO-23 (see S-6);
    - FA-02, FA-03 and EXP-14 (see S-7).
  - **Decided separately:**
    - VW-02 (X-1 to X-3);
    - VW-14 (V-4);
    - VW-33 (V-1);
    - VW-47 (V-5);
    - C15 (HR-1, Thermo first).
  - **Later, outside this roadmap:**
    - C59, the node view. The capability map says "A generic workflow canvas is not the first analysis feature" (ADR 0047:58);
    - EXP-20, a method text in Python or R. It stays refused under ADR 0047:61 until ADR 0064 is accepted and a separate decision allows emitting code; then a read-only text generated from the JSON plan, never run, is the candidate. N-C10's JSON method file covers the function meanwhile.
- **Blocks:** the roadmap's scope and its counts of planned rows.
- **Urgency:** now. **Kind:** choice.
- **Sources:** gap.json "missing" items 28–36, 43, 49, 50, 72, 74–76, 81 and 83–118; GAP rows as named; AFTER_BETA1_PLAN 7.6 (:554–580); ADR 0047:58–61.

### G4. When the analysis pages enter the navigation

*Decided 2026-10-30: (a), as recommended (section 1b).*

- **Question.** v5.11 has five pages (SH-02). MSCanvas follows ADR 0047:61, "Omit future navigation or state honest unavailability". When do 特征与注释, 统计与质控, 导出与记录 and the analysis steps of 处理工作流 appear?
- **Options:**
  - (a) each page appears when its first working function ships:
    - Statistics and QC with Track A's dashboard on an imported table;
    - Features with an imported table or U1;
    - Export and records with the first analysis export;
  - (b) all pages now, each stating that it is unavailable;
  - (c) after Track B.
- **Recommendation: (a).** An empty page needs explanation text, which the owner removed on 2026-10-28, and ADR 0047's rule keeps working. One requirement goes to FE-2's target: the header must have room for five tabs at 960 px.
- **Blocks:** FE-2's header layout, SH-02, and design-goals D5.
- **Urgency:** now. **Kind:** choice.
- **Sources:** GAP SH-02; ADR 0047:61; `design/GOALS.md`:69; AFTER_BETA1_PLAN section 2 (secondary explanations).

### P175. Profile spectra as lines in export, before slice 3

*Decided 2026-10-30: (a), as recommended (section 1b).*

- **Question.** Slice 2 (#175) exports a declared profile spectrum as a joined line in SVG, PNG, Copy plot and the figure preview. ADR 0056 decision 9 gives profile lines to slice 3, so this is a third deviation from the delivery order. Keep it, or hold the line back to slice 3?
- **Options:**
  - (a) keep it, and draw the on-screen line (slice 3's drawing) in #175's webview commit;
  - (b) keep it as export-only, and say on screen that the screen still draws sticks;
  - (c) hold it back to slice 3.
- **Recommendation: (a).** Sticks misstate profile data. The screen and the export then agree, so no sentence is needed to explain a difference. Decision 9 set a delivery order, not a scientific rule.
- **Blocks:**
  - #175's webview commit (N-05), then its merge (order: #164, then #161, then #175; #164 waits on FE-1);
  - ADR 0057 slice 1 (N-B3, C55);
  - XIC X1 (N-X1);
  - scan browsing (N-V3).

  Size: about +1 slice in that commit (*estimate*: the screen half of slice 3 is one renderer path). The roadmap counts it: N-05 is 4 slices and N-06 shrinks to 1.
- **Urgency:** now. **Kind:** choice.
- **Sources:** PR #175 body, "Owner question (open)" and webview checklist; ADR 0056:634 (decision 9).

### A0060. One-click view RAW: what gates slice 3

*Decided 2026-10-30: as recommended (section 1b). FE-1 was answered (a), so the Q8 answer holds. Q6 stays with HR-1.*

- **Question.** ADR 0060 open questions 1 and 8 gate slice 3, the interface (VW-49):
  - **Q1:** a View button, or converting on row activation?
  - **Q8:** the interface direction. The ADR still recommends direction A, which the owner withdrew on 2026-10-30 (section 1a). Decision 1's pane, the narrow-width keyboard path and the progress forms were written for direction A, and the progress forms amend LOCKED CNV-D8 for the view pane.

  Also confirm the slice-2 notes. Slice 2 is now PR #181 (`be/viewraw-op`, ready for review, head `5dc7d807`), which marks two of them "Recommended, pending owner confirmation":
  - **#181 note 1:** an unreadable cache check, or a damaged entry that cannot be removed, ends `failed` with `view_cache_entry_unavailable`, retryable, before anything is converted.
  - **#181 note 2:** an attempt that a sharing refusal keeps after `view_cache_not_stored` stays in `staging` until a later session's sweep.
  - **A departure from decision 6 while the run lasts** (listed in the ADR's slice 2 notes): inside the attempt the output is named after the RAW, until #161 reshapes `ConversionPlan`. Checking output renames it to `entry\view.mzML` through the checked handle, so no published name comes from the user's file.

  #181's merge notes add one fact for the train: it does not compile against #161 as merged (`plan_conversion` takes `&BoundIntent` there), and it conflicts with #175 in seven `preview/service.rs` hunks. Whichever merges second carries the fix and reruns CI.
- **Defaults that stand:**
  - Q2: the 10 GiB cap is a constant;
  - Q3: no view on highlight;
  - Q4: QC capture from a cached view is refused (see also A0062 Q7);
  - Q5: no "Save a copy as mzML";
  - Q7: files over 1.5 GiB go through Convert this file….

  Q6, the hold release, is part of HR-1.
- **Recommendation:**
  - Q1: a View button. A view runs `msconvert` for minutes and holds the single conversion slot (ADR 0057, serial), so activating a row should not start it. This answer does not depend on the look.
  - Q8: build slice 3 on #164's structure (FE-1), with decision 1's content, the phases, Cancel and the CNV-D8 progress amendment as written. The pane's place moves with FE-2. The content does not depend on the direction; only the placement does.
  - Accept notes 2 and 3 as written.
- **Blocks:** VW-49 slice 3 and SET-09. The Q8 answer holds only if FE-1 is answered (a); an FE-1 (b) or (c) reopens it.
- **Urgency:** now. **Kind:** choice.
- **Sources:** ADR 0060 "Open questions for the owner" (:1251 on `origin/main`); "Slice 2 notes (2026-10-30)" on `origin/be/viewraw-op`; PR #181 body ("Recommended, pending owner confirmation", "Merge notes"); GAP VW-49, SET-09.

### A0061. Restore workspace (#177)

*Decided 2026-10-30: as recommended (section 1b). 2026-10-31: Q1 is one explicit Restore workspace action, replacing "automatic", and Q10 is no (section 1b).*

- **Question.** ADR 0061 asks four questions:
  1. put matching rows back automatically, or only through an explicit Restore action;
  2. restore on by default;
  3. restore the checked state;
  4. keep the off switch in the restore document.

  Also: should the `.mscanvas` project file carry the roster too (EXP-22)?
- **Recommendation:**
  - Answer the four questions as the ADR recommends: automatic (replaced on 2026-10-31 by one explicit Restore workspace action the user starts), on, checked state kept, switch in the document.
  - Keep the roster out of the project file for now. The project already carries layers. Revisit with S-6, because sample metadata is keyed by `LayerId`.
  - Why: rows come back as in v5.11 (RO-28), and the start-up re-check marks a changed or missing file without dropping or relinking it. *2026-10-31:* automatic put-back was dropped for its start-up costs: it would hash every RAW, LCD and WIFF whole at every start, hold the mutation gate, lease every file and repeat in a second window.
- **Blocks:** #177's interface slice (RO-28).
- **Urgency:** now. **Kind:** confirm.
- **Sources:** ADR 0061:200–208 (`origin/be/restore-workspace`); PR #177 body; GAP RO-28, EXP-22.

### A0062. Saved figure specification (FIG-007)

*Decided 2026-10-30: as recommended, with Q5's help sentence dropped (section 1b).*

- **Question.** ADR 0062 asks seven questions, and the Rust side implements every recommendation:
  1. a standalone `.msfigure` JSON file;
  2. a changed source is refused, with no relink and no redraw;
  3. keep the data digest;
  4. keep the document digest;
  5. paths are relative inside the document's folder and absolute outside it, "stated in the save dialog's help";
  6. not in project documents or stored targeted results in this slice;
  7. a figure whose source is a cache entry cannot be saved until a locator is decided.
- **Recommendation:** confirm all seven, with one change. Q5's help sentence conflicts with the 2026-10-28 rule, so the dialog shows the recorded locator itself (the relative or absolute path) and no help text. Refusing a changed source keeps the saved figure's claim honest, and the digest is what makes "the same science" checkable.
- **Blocks:** ADR 0062's Rust PR, #180 (`be/saved-figure`, opened 2026-10-30 14:38 UTC, a draft "until the owner accepts ADR 0062"), and its interface after #175 (N-F3).
- **Urgency:** now. **Kind:** confirm.
- **Sources:** ADR 0062 "Open questions" on `origin/be/saved-figure`; PR #180 body.

### A0063. Copy diagnostics (#178)

*Decided 2026-10-30: as recommended (section 1b). 2026-10-31: questions 6 and 7, added to ADR 0063 after A0063, answered as recommended (section 1b).*

- **Question.** ADR 0063 asks five questions:
  1. name only the known root of the ProteoWizard folder;
  2. record the error ring at `PreviewErrorDto::new`;
  3. add a `Verified build` line after #161;
  4. a Settings button, a read-only preview and the text clipboard;
  5. leave workspace contents out.
- **Recommendation:** all five as recommended. They keep ADR 0005's 2026-10-30 path rule, and no user data reaches a support paste.
- **Blocks:** #178 leaving draft; its button after #164 (FE-1).
- **Urgency:** now. **Kind:** confirm.
- **Sources:** ADR 0063:213–226 (`origin/be/copy-diagnostics`); PR #178 body.

### A0064. M10 automation route (#176)

*Decided 2026-10-30: as recommended, with ADR 0058 amended in the same step (section 1b). 2026-10-31: question 3 confirmed again with the corrected cost (section 1b).*

- **Question.** ADR 0064 asks eight questions on `origin/docs/m10-route` (`7f91c05b`). The sixth to eighth, and narrower wording for the second and third, come from the review answers since the PR opened:
  1. route A1, a small CLI package over the desktop library, now; A2 only on a measured need;
  2. MCP runs approved through elicitation. The adapter writes the approval text and no tool call can satisfy it, but it does not prove that a person answered; clients without elicitation are refused. The alternative is an approval record written with `mscanvas approve` in the person's own terminal, which trusts no client;
  3. while the CLI holds the run lock, the desktop refuses operations that would start ProteoWizard and names the holder. Viewing an mzML is not refused once #175's reader is the preview's (wrong: an open still runs `msaccess`, so opening a new preview is refused too; confirmed again with that cost on 2026-10-31);
  4. the installer carries `mscanvas.exe` and does not change PATH (a release change);
  5. roots are required for the CLI;
  6. `run --reclaim-staging` removes a staging directory that a killed run left behind: only for its own plan's items, only while it holds the run lock, only one carrying MSCanvas's marker, and it reports each removal. Without the flag the item refuses (`StagingTargetExists`) and names the folder;
  7. the shared crate's spawn adds `CREATE_NO_WINDOW` for every backend process, the desktop's included, confirmed by CLI slice 4's controlled-child test, with ADR 0014's cancellation evidence taken again under the qualification's hold release (HR-1);
  8. the MCP adapter never deletes its own store; a fixed cap on its files, set in MCP slice 1, makes `plan` refuse beyond it (`planStoreFull`), and the location is documented.

  Also: ADR 0058:61–65 keeps presets "in the app only". EXP-18 and EXP-19 (export and import a method as JSON) need that amended so a method can leave the app as a plan file.
- **Recommendation:** all eight as recommended, and amend ADR 0058 in the same step.
  - A1 reuses `PreviewService`, so no rule is spelled twice.
  - Approval binds a plan's SHA-256, and no dependency is added.
  - Q6 removes only what MSCanvas marked as its own, never a user file.
  - An imported plan is validated by the same constructor as a preset and never runs without review.
- **Blocks:**
  - the M10 slices: 7 slices plus one hold-release window, 1.5–3 weeks (ADR 0064, Estimates). CLI slice 1 does not wait for #161;
  - EXP-18 and EXP-19, the method as JSON;
  - EXP-20 (G3).
- **Urgency:** now. **Kind:** confirm.
- **Sources:** ADR 0064 "Open questions for the owner" (:848 on `origin/docs/m10-route`, `7f91c05b`); PR #176 body; GAP EXP-18, EXP-19.

### RUN-1. Conversion run history (RUN-007 for conversion; ADR 0065)

*Decided 2026-10-30: as recommended (section 1b).*

- **Question.** v5.11 keeps a run history: each run's method version, inputs, steps, results and frozen parameters (EXP-23). It also downloads one run's frozen snapshot as JSON (EXP-25). Conversion runs are session-only on `main`, and RUN-007 covers project operations only (FEATURE_CATALOG.md:436). ADR 0065 (Proposed; draft PR #187, Rust side, stacked on `be/integrate`) writes the history as the first version of this document recommended: app-local and per user, one bounded, versioned JSON document per run, no path in either direction, and failures by stable code only. It asks five questions:
  1. Is history on by default, or off until the user turns it on?
  2. Does Off also forget what is stored, or does it only stop recording?
  3. Are the bounds 200 runs and 64 MiB in total (16 MiB per run), or other numbers?
  4. Is the advanced intent stored, so that a re-run can reproduce it, or only the verified row's id?
  5. Does Clear keep runs in progress, or forget them too?
- **Recommendation:** as ADR 0065 recommends: on by default; Off forgets, as ADR 0061's Off does; 200 runs and 64 MiB; the advanced intent stored; Clear keeps runs in progress.
  - App-local, not in the project: a conversion is not a project operation, and a project file should not grow with every batch.
  - EXP-25's JSON is one run's record, redacted like RUN-009: structured intent, tool build, input identities and outcomes, and no absolute paths.
  - The run log (C53) stays the five judgements plus the redacted diagnostics.
- **Blocks:** #187; N-C9's interface (EXP-23, EXP-25); the Export/records page (N-A14).
- **Urgency:** now, because #187 is open. **Kind:** confirm.
- **Sources:** ADR 0065 on `origin/be/run-history` ("Open questions for the owner"); PR #187 body; GAP EXP-23, EXP-25, C53; FEATURE_CATALOG.md:436 (RUN-007); AFTER_BETA1_PLAN 7.4 and 7.6 ("Owned elsewhere"); the non-runtime draft's ND-17.

### DEF-1. Save As reserves its result-store name; Retry leaves rows that never ran

*Decided 2026-10-30: both accepted, as recommended (section 1b).*

- **Question.** #185 (`fix/backend-defects-1030`) makes two changes that it marks "proposed, for the owner". Accept both?
  1. **The store name is reserved.** Save As, and every new project's first save, claims the result-store name with a no-replace rename before the document is published. Each therefore leaves `<name>.mscanvas.payloads`, empty when there is no result. If the document publish then fails, the empty store stays, and a retry to the same name is refused `destinationStoreExists`.
  2. **Refused queue rows settle as Not run.** After a recoverable queue-level refusal, the rows the run never reached settle as `NotRun`, as after a stop. On `main` they stayed `Pending` ("Waiting"), and Retry converted them. Retry now reruns only the retryable failures, as its label and the panel copy say, so those rows need a new queue.
- **Recommendation:** accept both.
  - An empty folder is cheaper than a race in which another writer takes the store. The leftovers row in M9_CLOSURE is updated with it.
  - Retry then does what its label says. #185 changes no webview file, and nobody has rendered a retry queue that holds Not run rows. That check belongs to the queue interface after #164 (N-01) and #161 (N-03).
- **Blocks:** #185 (ready, head `efd0294a`, nine checks green). Squash-merge it: the message of `f127692d` describes a Retry change that `5cfd8efb` reversed.
- **Urgency:** now. **Kind:** confirm.
- **Sources:** PR #185 body; the AFTER_BETA1_PLAN 7.2 and M9_CLOSURE diffs on `fix/backend-defects-1030` ("proposed, for the owner").

### M161. The merge of #161

*Decided 2026-10-30: no, as recommended (section 1b).*

- **Question.** The #161 body says "Not for merge without the owner". The 2026-10-29 rule lets a product PR merge once every check passes and every thread is resolved. Does #161 still need the owner's own merge once its blockers 1–6 close?
- **Recommendation:** no; the 2026-10-29 rule covers it. ADR 0055, the schema-5 upgrade, the MS1+ and MS2+ rows and `serde` are all accepted, and the PR adds no package or release.
- **Blocks:**
  - the conversion rows C04, C05, C07–C10, C14, C16, C22, C24–C27, C38, C39 and C42;
  - #175 (merge order, after #164 under FE-1);
  - ADR 0060 notes 3 and 5;
  - ADR 0064 CLI slice 2.
- **Urgency:** now. **Kind:** confirm.
- **Sources:** PR #161 body; AFTER_BETA1_PLAN section 2, "Merging".

### U7. One written decision for computation over decoded arrays

*Decided 2026-10-30: (a), as recommended (section 1b).*

- **Question.** ADR 0056 decision 7 says: "Any computation over the decoded arrays is an algorithm, and it needs its own record." The reader keeps offsets, "never arrays" (:394). The XIC and the MS1 map both compute over the arrays of many spectra. Should one written decision:
  - admit project-owned computations over the reader's decoded arrays, each with its own per-algorithm record (XIC per-scan sum; MS1 map binning; later a summed spectrum);
  - and amend the retention invariant, so that a bounded, cancellable full pass may run and keep only its result?
- **Options:**
  - (a) the umbrella decision plus a record per algorithm;
  - (b) only per-algorithm records, so the owner is asked each time;
  - (c) no computation over arrays, so the XIC and the map stay refused.
- **Recommendation: (a).** Both are simple projections of documented values (a sum inside a window, a statistic per bin), not reimplemented mature algorithms. Asking once avoids two parallel amendments of the same invariant, and each record still fixes its own semantics and tests.
  - The first per-algorithm record now exists: ADR 0068 (Proposed, `origin/be/map2d`) is decision 7's record for "the greatest stored intensity per cell of a bounded raster" and allows nothing else. It does not claim the umbrella, so it stands under (a) or (b). It reads each MS1 spectrum through the reader's selected read and keeps one spectrum at a time, so it needs no change to the retention invariant.
- **Blocks:** N-13 (XIC X0), N-14 (accepting ADR 0068) and N-X4 (MAP-1's MS1 map).
- **Urgency:** now. **Kind:** choice.
- **Sources:** ADR 0056:554–570 and :394; XIC §11.1; SYN §5.2 (2D map); internal.md H4.

### X-1. XIC re-entry and its evidence gates

*Decided 2026-10-30: option 2 with those gates, as recommended (section 1b).*

- **Question.** Should the XIC re-enter as the evaluation's option 2? That means a full XIC with stated profile semantics, through a new scope record (X0) for a sibling pass over ADR 0056's reader, with these gates:
  - **§11.6:** the frozen PX.3 comparator, byte-identical, with new hashed runner revisions;
  - **§11.7:** reuse of the PX.3 representative files (CC-BY-SA-4.0, Zenodo 20729183 and 20729093) and resource observations on the R0 CC0 file;
  - **§11.11:** practicality is judged on X2's measured release timings, and no number is set in advance (planning estimate: 5–11 s per window on the 546 MB file);
  - **§11.12:** the per-spectrum native-read lane. The engine starts after #175 merges and is coordinated with #161's `mzml.rs` changes; the interface comes after #164 (FE-1).
- **Options (§9):**
  - 0: do nothing;
  - 1: centroid-only;
  - 2: full XIC (recommended);
  - 3: a precomputed index. It costs 2–3 more slices and a persistence model that ADR 0046 §4 refuses.
- **Recommendation:** option 2 with those gates. The reader removed the reason direction C was refused. No new dependency is needed, and the full 77-row rerun keeps the evidence standard.
- **Blocks:**
  - VW-02, a P1 row;
  - FA-06 and FA-14;
  - the features page's EIC;
  - MOD-03's preview (B-4).

  Size: 9–12 slices (L–XL) (§10, after the critic pass). GAP VW-02's "9-11" is superseded.
- **Urgency:** now, because X0 is a docs slice; X1 starts after #175. **Kind:** choice.
- **Sources:** XIC §9, §10, §11.1, .6, .7, .11, .12; AFTER_BETA1_PLAN 7.5; GAP VW-02.

### X-2. XIC semantics in the first scope

*Decided 2026-10-30: all accepted, as recommended (section 1b).*

- **Question.** Should these XIC semantics be accepted for the first scope?
  - **§11.2, four departures from ADR 0046 §1:**
    - ppm input (also against ADR 0037 XIC-D1's default);
    - whole-query refusal when in-scope scans mix polarity;
    - the same refusal for mixed FAIMS CV;
    - the same refusal for mixed representation.

    Scan windows are disclosed, not given a new state.
  - **§11.3:** polarity rule P1 now (refuse mixed polarity, report it at the top level), and P2 in a later record.
  - **§11.4, XIC-S1:** offer the profile point sum, labelled "sum of profile points, not an area" and comparable only within one window and one acquisition setting. The owner becomes S1's owner in the record.
  - **§11.5:** MS1 only in the first product scope (ADR 0037 XIC-D2).
  - **§11.8:** the preview's open refusals sit in front of the engine, and this narrower domain is disclosed.
- **Recommendation:** accept all of them. None changes a frozen answer (counted). v5.11 offers "target m/z and ppm". P1 uses the reader's polarity from the reader-metadata lane. The disclosures are scientific-honesty statements, which the 2026-10-28 rule keeps. The alternative for ppm is an absolute half-width only (XIC-D1).
- **Blocks:** the text of N-13 (X0) and N-X1's fixtures.
- **Urgency:** now. **Kind:** choice.
- **Sources:** XIC §1 and §11.2–.5 and .8; ADR 0046 §1; ADR 0037 XIC-D1 and XIC-D2.

### R-1. The reader-metadata amendment (ADR 0056 decisions 1 and 3)

*Decided 2026-10-30: as recommended (section 1b).*

- **Question.** The reader-metadata lane is now draft PR #182 (`be/reader-meta`, library only, stacked on #175): nothing calls the new readings yet, and the open still asks `msaccess` for metadata and the run summary. Whether it runs is not in question. What its amendment admits is, in four parts:
  1. **Accept the amendment.** The reader takes polarity (MS:1000130 and MS:1000129), charge (MS:1000041), run-level metadata, and the run summary from the table pass.
  2. **PRJ-006's retention times.** Three of its five retention times sit at cumulative base-peak intensity. ADR 0056 decision 7 keeps them with `msaccess`, because computing them is a computation. The options:
     - (a) keep them from `msaccess` for now;
     - (b) drop them from the snapshot;
     - (c) compute them from the declared base-peak values under a short per-algorithm record (U7).
  3. **#154's scan-context terms.** Which terms does the reader take: analyzer, scan event, filter string, ion injection time?
  4. **#182's five choices** ("For the owner", recorded in a dated ADR 0056 note):
     - decision 1's out-of-scope list (polarity, instrument configurations, the chromatogram count) is widened for the library only;
     - MS-level buckets are reported lowest level first, because `msaccess`'s real column order is not recorded in the repository;
     - polarity is read at spectrum level only, where the mzML 1.1 mapping places it;
     - charge stays off the shared `SpectrumTableRow` until routing, so decision 5's "a native row leaves charge unreported" holds;
     - conflicting or unreadable polarity and charge are not-reported states, never refusals, so no file that opens today is refused.
- **Recommendation:**
  1. Accept the amendment.
  2. (a) now and (c) next. #182 computes no BPI retention time and leaves them with `msaccess`, which is (a). (c) follows as N-B1's last slice: a one-paragraph record under U7 computes the three times from the declared base-peak values the table pass already reads, and a fixture test shows they equal `msaccess`'s before `msaccess` leaves the open. This is what R-3 needs, and it matches the non-runtime plan's ND-10. If the values cannot be matched, (a) stays. #182 itself notes that no mzML with a recorded `msaccess` run summary is in the repository, so that fixture needs one recorded pair (HR-1).
  3. Polarity and charge now. Analyzer and filter string only if #154's columns stay in the rebuilt scan table.
  4. Accept all five as #182 states them. Each keeps every file that opens today opening, and none changes a frozen answer.
- **Blocks:**
  - the metadata tab's polarity line (VW-39);
  - MGF charge (C08);
  - XIC P1 (X-2) and MAP-1's polarity rule;
  - the #154 rework;
  - R-3.

  Size: one records slice plus the reader slice (the non-runtime draft's N-15 and N-B1: S, then M).
- **Urgency:** now. **Kind:** choice.
- **Sources:** SYN §5.2 (scan browsing, "Open"); internal.md §4; ADR 0056:554–570; FEATURE_CATALOG PRJ-006 (:467); PR #182 body ("For the owner", "Comparison with `msaccess`"); the non-runtime plan's ND-10.

### S-1. Statistics crates

*Decided 2026-10-30: (a), approved by the owner: "批准" ("approved") (section 1b).*

- **Question.** Approve two production dependencies of a new pure crate, `crates/stats`?
  - `nalgebra =0.35.0`: Apache-2.0, `default-features = false, features = ["std"]`, MSRV 1.89 (the toolchain is 1.97.1);
  - `statrs =0.19.1`: MIT, `default-features = false`.

  `kodama 0.3.0` (MIT, last released 2023) is needed only if S-2 wants clustering.

  Also: pinned scipy, statsmodels and numpy for a development-only fixture generator. Its outputs are committed as fixtures, and nothing from it ships.
- **Options:**
  - (a) approve both;
  - (b) project-owned t-distribution and eigen code, which reimplements mature numerics and needs a written decision;
  - (c) scipy in the Python runtime: about 118 MB, and it waits for B-1.
- **Recommendation: (a).**
  - The spike matches scipy to about 1e-13 (Welch, BH, PCA).
  - Both licences are permissive, with no new licence class.
  - Rust keeps the matrix out of React.
  - Python would tie the dashboard to the runtime release.

  Re-derive the number of lockfile crates with `cargo tree` at admission. The lane's "about 12" cannot be reproduced.
- **Blocks:** the statistics ADR, which the non-runtime draft writes in phase 0 (N-12); N-A1 (`crates/stats`, phase 1, M, 4 slices); every STAT row; MOD-08's metrics; MOD-10.
- **Urgency:** now. The statistics ADR names the crates, and dependency approval is the long pole. **Kind:** choice.
- **Sources:** SYN §7 D7, §2 C1, §3 item 1, §8; stats.md §5.1, §14 Q1; `rust-toolchain.toml` on `origin/main`.

### B-1. How the Python analysis runtime is distributed

*Decided 2026-10-30: as recommended (section 1b). ADR 0066 question 3 stays open, with its working default.*

- **Question.** The runtime is 4,628 files and 348.7 MB, about 54 times the 6.47 MB installer. The NSIS install is per-user, so a Chinese user name puts it under a non-ASCII path, and a non-ASCII runtime path is a measured failure. How should the runtime reach users? ADR 0066 (Proposed, draft PR #188) now writes the options and asks nine questions. This decision carries its questions 1–3, 6, 8 and 9; B-2 carries 5 and 7, and B-3 carries 4.
- **Options** (ADR 0066, "Distribution"):
  - (a) inside the app installer: 36–55 MB more for every user (ADR 0066's estimate), and elevation;
  - (b) a separate, verified runtime package beside each release, which the user downloads and installs, as with ProteoWizard. MSCanvas checks its manifest digest before first use;
  - (b2) the same package, downloaded by the app;
  - (c) a Python the user installs, rejected because it cannot be pinned.
- **Recommendation: (b),** ADR 0066 decision 1.
  - Users of the MVP (convert, view, figures) keep a 6.5 MB installer.
  - It matches the user-installed, verified ProteoWizard pattern, and the app downloads nothing.
  - The runtime's manifest digest (`RUNTIME_MANIFEST_SHA256`) is compiled into the app. Every fix to a shipped runtime component is therefore an app release with a new runtime package, and old plans answer `PlanNotCurrent` (ADR 0066 decisions 3 and 5). The first version of this document said that a runtime fix needs no app release; that was wrong.
- **Install location** (ADR 0066 questions 2 and 3; the analysis plan's A-02 item 2). ADR 0066 decision 2 puts the runtime per machine under `%ProgramFiles%\MSCanvas Analysis Runtime\<digest>\`, which is ASCII and writable only by administrators, through an elevated runtime installer. The worker's work area goes under `%ProgramData%\MSCanvas\work\<user SID>\`, with a protected DACL and an owner check.
  - Recommended: accept decision 2.
  - Question 3, a user without administrator rights, is the owner's call: offer a user-chosen ASCII folder with a protected DACL, or require elevation. Working default until answered: require elevation, and add the user-folder route when such a user needs it.
- **The confinement bar** (ADR 0066 question 6; A-02 item 7). Is an AppContainer worker (A-06) a release requirement, or may a release ship with the firewall rule and a stated limit if the measurement fails? Recommended: a blocker only if A-06's AppContainer spike shows that it can be enforced without administrator rights; otherwise ship with the stated limit and the measured mitigations listed. ADR 0066 names the ADR 0049 hard link as the known obstacle.
- **Dependencies** (ADR 0066 question 8). Shipping makes the hash-pinned wheels production dependencies, and building the package changes the release workflow. Both need the owner's approval under the dependency policy. Recommended: approve both with ADR 0066, effective at the first runtime release (A-05). Nothing ships before then.
- **MSVC runtime copies** (ADR 0066 question 9). The OpenMS, numpy and pandas builds carry MSVC DLLs. Recommended: ask for a reading on redistributing them, together with B-2's Qt reading if that is still needed. It blocks A-05, not development.
- **Blocks:**
  - A-02 (#188), which is drafted (Track B's gating path);
  - A-05 (install location, dependencies, notices) and A-06 (confinement bar);
  - every pyOpenMS function;
  - ANA-004 (MOD-11) for users.
- **Urgency:** now, because #188 is open. **Kind:** choice.
- **Sources:** ADR 0066 on `origin/docs/runtime-release-adr` (decisions 1–3, 5, 7 and 10; open questions 1–3, 6, 8 and 9); PR #188 body; SYN §7 D3, §0 item 5, §6.1 P5, §1 (runtime size row); internal.md §2.6, §9 item 5.

---

## 4. Decisions needed before their slices

### R-2. A chromatogram above 100,000 spectra

- **Question.** Above `MAX_SPECTRUM_TABLE_ROWS` (100,000), a table opens as a prefix with no chromatogram on screen or in export (ADR 0056:434–438). What should change?
- **Options:**
  - keep today's state;
  - raise the cap, which sends more rows through React;
  - Rust sends the chromatogram from its retained rows, bounded like any list. This amends ADR 0033 and ADR 0034.
- **Recommendation:** Rust sends the chromatogram. Long Orbitrap and DIA runs pass 100,000 spectra (VW-31 shows 120,000), and AGENTS.md keeps large arrays out of React state.
- **Blocks:** TIC and BPC for large runs, VW-31, and scan browsing (ADR 0056 slice 3). In the roadmap it is one slice of N-B2, which already reworks the chromatogram path.
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** ADR 0056:885–890 (open question); GAP VW-31.

### R-3. Open a new preview during a conversion (ADR 0057 decision 2)

- **Question.** On 2026-10-29 the owner decided that "opening a new preview during a conversion stays refused for now, because it would run `msaccess` beside `msconvert`". Once the open starts no process (R-1), should ADR 0057 decision 2 and ADR 0005's one-process wording be amended, so that `open_preview` no longer answers `conversion_busy`?
- **Recommendation:** yes, once the open is process-free. That needs R-1 and its BPI-times record. It finishes C55 for files that were not open when the run started, and the reason for the refusal is gone.
- **Blocks:** C55, the second half. Size: M, 2 slices (the non-runtime draft's N-B4).
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** AFTER_BETA1_PLAN section 2 (2026-10-29, item 3); ADR 0057 decision 2; GAP C55; the non-runtime draft's ND-10.

### V-1. Show a spectrum on open (VW-33)

- **Question.** slice-03.md:166–167 refused a pre-selected scan as "a source read the reader did not ask for". With #175 the read is in-process. What should be selected on open?
- **Options:**
  - (a) nothing, as today;
  - (b) scan 1, as v5.11 does;
  - (c) the MS1 scan at the apex of the declared TIC. The preview already refuses a file that declares no base peak or TIC (XIC §1), so every open file has one.
- **Recommendation: (c).** It costs no process. Scan 1 is often near-empty at the solvent front. Picking the largest declared value is a selection from read values, not a computation (ADR 0056:567–570). The readout names the scan, so no text is needed.
- **Blocks:** VW-33, and in part VW-51. Size: S (*estimate*: one selection after open).
- **Urgency:** before-its-slice: #175's webview commit or slice 3. **Kind:** choice.
- **Sources:** GAP VW-33; slice-03.md:166–167; PR #175 body.

### S-6. Sample metadata and its schema version

- **Question.** Three parts:
  1. **Fields.** Which fields come first: group (Control, Treatment, QC, Blank), sample type, batch, injection order? They would be keyed by `LayerId` (PRJ-005).
  2. **Schema version.** #161's schema 5 is not released yet. It already adds `notVerifiedByMscanvas`, and it reads and upgrades schema 4. Should sample metadata enter schema 5, or wait for schema 6?
  3. **Group moves.** Should moving rows across experiment, type or batch groups ask before changing metadata (RO-17)?
- **Recommendation:**
  1. All four fields (about 45 kB for 300 samples). A sample of an imported table with no layer gets an imported-sample id. A roster row is classified through its layer, so classifying a row without one first puts it in the project.
  2. Hold schema 5 open until a release ships it. Track A's record kinds join schema 5 if they merge before that release: sample metadata, the imported table, statistics results and notes. If a release ships first, they take schema 6, with the same read-and-upgrade rule. Two upgrades in one release cycle would cost users a second one-way step. The cost: schema-5 files that development builds write between #161's merge and the schema-5 records may be refused later. Only test projects are affected.
  3. Yes, confirm on such a move.

  ADR 0067 (B-6) recommends the opposite home for these fields, per study. Answer the two together; B-6 gives the recommended reconciliation (per layer, copied into each study revision).
- **Blocks:**
  - N-A2 and N-A3 (step A2);
  - RO-07, RO-17, RO-22 and RO-23;
  - PCA colouring, injection-order plots and every STAT row;
  - S-7's notes.
- **Urgency:** before-its-slice (N-A2). It must be answered before the next release that would ship schema 5. **Kind:** choice.
- **Sources:** SYN §6.1 P1, §5.2 (sample metadata); internal.md §5 item 7; PR #161 body ("Project schema 5", "Resolved"); GAP RO-07, RO-17, RO-22, RO-23; the non-runtime draft's ND-05 and ND-06.

### S-2. Statistics definitions

- **Question.** These definitions change the numbers, so the statistics ADR must fix them. Accept the stats lane's table?
- **Recommendation:** accept these definitions:
  - **log2FC:** mean(log2 A) − mean(log2 B), as in the demo, named in exports. The alternative is MZmine's log2 of the ratio of means.
  - **What enters the tests:** observed values only.
  - **Group size:** refuse fewer than 2 per group; mark low power below 3.
  - **BH family:** every valid test in the run, after the recorded class-C filters.
  - **Test:** two-sided Welch, with p = 2·sf(|t|).
  - **SD:** n−1.
  - **Non-positive intensities:** treated as missing.
  - **Zero-variance features:** excluded from PCA, and counted.
  - **QC RSD:** on the raw scale.
  - **PCA sign:** fixed.
  - **Missing values in PCA (class E):** complete features only by default; a labelled 1/5-minimum per feature as an opt-in, with a count of the cells it replaced.
  - **Heatmap clustering:** none in v1, because v5.11 has none, so no `kodama`.

  On missing values in PCA, the non-runtime draft (ND-04) recommends complete features only, with no opt-in. This document adds the labelled 1/5-minimum opt-in, because v5.11's PCA offers imputation (STAT-02). That costs a little more in A3. Either answer fits the draft's slices.

  Do not copy the demo's flaws:
  - `statFC:0, statP:1, statQ:1` for untestable features;
  - `se===0?1:…`;
  - removing every feature that is absent from all blanks.
- **Blocks:** the statistics ADR (P2), and STAT-02, -04, -05, -07 and -08. Size: N-12 and N-A1 (SYN §6.2 step A3).
- **Urgency:** before-its-slice (N-12). **Kind:** choice.
- **Sources:** SYN §7 D9 and §1 (demo flaws row); stats.md §4, §10.2, §14 Q2, Q3 and Q5.

### S-3. Admit normalisation, with "none" as the default

- **Question.** Should normalisation be admitted as class D?
  - It is opt-in per run.
  - "none" is the default, recorded as a labelled choice.
  - The originals are kept.
  - The methods are sum/TIC (over the features present in all samples), median, PQN (reference: the median of pooled QCs when there are at least 3, otherwise all non-blank samples) and internal standard.

  Also: should an absolute multi-file overlay under "none" be the minimum for VW-48 and VIEW-008?
- **Recommendation:** yes to both. "Admitted" means recorded, not always applied (C6), and that lifts VIEW-008's gate. A group-mean EIC overlay also needs the XIC (X-1). A TIC/BPC overlay does not.
- **Blocks:** VW-48/EXP-08, MOD-10, and the PCA, volcano and heatmap views.
- **Urgency:** before-its-slice (N-A7 and N-A10). **Kind:** choice.
- **Sources:** SYN §2 C6, §6.2 A6; stats.md §3 (class D) and §9; FEATURE_CATALOG.md:74; GAP VW-48, MOD-10.

### S-5. What ANA-002, the QC recipe, contains

- **Question.** ANA-002's content is undesigned (MOD-08). Should it be defined as follows?
  - **Track A metrics in Rust** over a feature table:
    - QC detection rate, QC RSD, D-ratio, blank ratio and missing fraction;
    - display only: RT drift, mass error and injection-order plots.
  - **Class-C filters** with a rejected list and a reason per feature. They never delete a measured value.
  - **Defaults** from Broadhurst et al. 2018: detection above 70 %, RSD below 30 % (adjustable), D-ratio below 50 %.
  - **Blank reference:** the maximum of the detected blank values, as MZmine does, or the mean, as the demo does.

  FEATURE_CATALOG's ANA-002 wording ("runs in an isolated worker") changes with it.
- **Recommendation:** as listed, with the maximum as the blank reference, which is the conservative choice. Features absent from every blank are kept.
- **Blocks:** MOD-08, STAT-01, the QC CV column of STAT-07, and EXP-13's QC columns.
- **Urgency:** before-its-slice (N-A9). **Kind:** choice.
- **Sources:** SYN §5.2 (Blank/QC), §7 D9 (blank ratio); stats.md §3 (class C) and §8; FEATURE_CATALOG.md:483; GAP MOD-08.

### S-7. Table functions that were "reversible, not selected"

- **Question.** AFTER_BETA1_PLAN 7.6 lists "on-screen result sorting and filtering", "view-scoped export" and "history notes" as reversible, not selected. v5.11's feature table has:
  - search and filter (FA-02);
  - sorting with missing values last (FA-03);
  - export of the filtered rows (EXP-14);
  - a reviewed mark (FA-11);
  - a note per feature (FA-12).

  Select them?
- **Recommendation:**
  - Select sorting, filtering and view-scoped export now, for the targeted table and the future feature table. The exported file names the filter it used.
  - Add notes with the feature table (N-A6), and the reviewed mark ("seen, not identified") with the library candidates it marks (A-26). Both are stored in the project (S-6) and exported with the CSV.
  - None of these changes a measured value.
- **Blocks:** FA-02, FA-03, EXP-14, FA-11, FA-12 and EXP-13.
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** AFTER_BETA1_PLAN 7.6 (:566–567); GAP FA-02, FA-03, EXP-14, FA-11, FA-12.

### MAP-1. The 2D map (二维特征分布)

- **Question.** VW-38 (decorative in v5.11) is in the owner's direction. Since the first version of this document, the MS1 map has its record and library: ADR 0068 (Proposed) in draft PR #183 (`be/map2d`, stacked on #175), with slice 1 (`crates/proteowizard/src/rt_mz_map.rs`) implemented and measured. On the R0 546 MB Orbitrap profile file a full-extent map of 1,024 × 2,048 cells took 3.8–4.8 s and a tenth of each axis 0.3 s, with a peak working set of 36–37 MB. The questions:
  1. **First form.** An MS2 precursor map (RT × precursor m/z from the scan table, UI only, no array computation), the MS1 intensity map, or both.
  2. **ADR 0068's six open questions:**
     - Q1, the cell rule: the greatest intensity per cell, or a sum. A sum depends on the sampling density;
     - Q2, the colour scale: log10 only, or a user-chosen linear scale beside it;
     - Q3, the exported figure: a vector cell grid with merged runs, or an embedded bitmap. A bitmap needs `resvg`'s raster-images feature, a dependency-feature change: `resvg =0.48.1` is built with `text` and `system-fonts` only;
     - Q4, the first m/z range when spectra do not state it: the user enters one, with the reason stated, or an extra pass finds it;
     - Q5, polarity after the reader reports it: one map per polarity, refusing a file where only some MS1 spectra declare one, or admitting undeclared spectra beside one declared polarity;
     - Q6, the map pass and ADR 0057's native-read lane: its own worker, one at a time, beside selected-spectrum reads (this amends ADR 0057), or it takes the lane and selected spectra wait.
- **Recommendation:**
  1. Both. The precursor map needs no record and ships when its plot kind (N-F4) lands. The MS1 map no longer waits for the XIC engine: its pass is its own, so it ships when ADR 0068 is accepted and N-F4's raster kind lands, whichever of the two is ready first.
  2. ADR 0068's recommendations on all six: the greatest intensity; log10 only, with a stated "≤ 0" colour; the vector cell grid (no dependency change); the user enters the m/z range; one map per polarity; its own worker, with the ADR 0057 amendment written in the same step.

  Feature markers come with feature tables (G2 or U1).
- **Blocks:** VW-38 and EXP-10; N-14 (accepting ADR 0068), N-X3, N-X4 and N-F4's raster kind.
  - Precursor map: S–M (GAP VW-38).
  - MS1 map: the library is done; the command, plot kind, export, polarity follow-up and QA remain (N-X4, 4 slices).
- **Urgency:** before-its-slice (N-14, N-X3). **Kind:** choice.
- **Sources:** GAP VW-38; SYN §5.2 (2D feature map), §6.2 A7; ADR 0068 on `origin/be/map2d` (decisions 1–9, Evidence, "Open questions for the owner"); `apps/desktop/src-tauri/Cargo.toml`:45 on `origin/main`.

### V-2. RT filter on the scan list (VW-26)

- **Question.** Should the scan list get the separate from/to RT fields v5.11 has?
- **Options:**
  - (a) separate fields on the list;
  - (b) the list follows the chromatogram's committed RT range, with numeric from/to entered through the existing Set range… dialog (VW-12);
  - (c) nothing.
- **Recommendation: (b).** One RT selection then drives both the plot and the list, and there is no second filter state to keep consistent.
- **Blocks:** VW-26. Size: S–M (*estimate*: UI only).
- **Urgency:** before-its-slice, in viewer polish after #164 (FE-1). **Kind:** choice.
- **Sources:** GAP VW-26, VW-12.

### V-3. Relative intensity in percent (VW-22)

- **Question.** Should intensity be offered as 0–100 %?
- **Options:**
  - (a) no, absolute only;
  - (b) a FigureSpec option with its base set to the largest value of the full spectrum or chromatogram, named in the exported caption;
  - (c) the base set to the visible window's maximum.
- **Recommendation: (b).**
  - The number does not change while zooming.
  - Publication figures often use relative abundance.
  - The screen and the export share the option, as AGENTS.md requires.
  - The data CSV keeps absolute values.
- **Blocks:** VW-22. Size: M (*estimate*: a FigureSpec field, the renderer and a toggle).
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** GAP VW-22; PROJECT_PROPOSAL.md:249.

### V-4. View history (VW-14)

- **Question.** Build back and forward through committed ranges, per plot, 40 deep, with Alt+Left and Alt+Right?
- **Recommendation:** yes. It is UI only and carries no scientific risk. It belongs in the plot's ⋯ menu (VW-16). Alt+Left must not trigger WebView2's own Back.
- **Blocks:** VW-14. Size: S–M (GAP).
- **Urgency:** before-its-slice, in viewer polish. **Kind:** choice.
- **Sources:** GAP VW-14, VW-16; slice-03.md:623 and :791.

### V-5. A plot RT selection as the conversion window (VW-47)

- **Question.** Should a "Use this RT range in conversion…" action, after a confirmation, fill #161's typed ScanTime step for the viewed file?
- **Recommendation:** yes, after #161's interface and the advanced editor (`ui/conversion-advanced`) are mounted.
  - It is a typed handoff of a committed range into a typed step, with no free text.
  - It drops scans, so it shows as a lossy step in the plan summary, and its not-verified label follows ADR 0055.
- **Blocks:** VW-47. Size: S–M (*estimate*).
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** GAP VW-47; slice-03.md:624; `crates/proteowizard/src/chain.rs`:863 on `origin/be/integrate`.

### V-7. Preference-level settings and the preference schema bump

- **Question.** Several v5.11 settings are preferences:
  - SET-05: the wheel habit, draw style (the wheel zooms) or Figma style (the wheel pans, Ctrl+wheel zooms). The rebuild SPEC 3.7 and 11.1 did not adopt it;
  - SET-12: opt-in remembering. M7.5 always remembers;
  - VW-04: touch pan and pinch;
  - SET-01, SET-03, SET-04, SET-06 and SET-07: text size, contrast, motion, crosshair and grid.

  The preference store refuses another schema rather than migrating it, so an earlier build reads a schema-2 record as unsupported (ADR 0060 Q2). Two questions follow:
  - which of these to build;
  - whether to accept that cost once, for all of them.
- **Recommendation:**
  - One schema bump carries every new preference, and the earlier-build cost is accepted once.
  - SET-05: yes, with today's wheel zoom as the default.
  - SET-12: remembering stays on by default, with an off switch.
  - VW-04: only when touch use is reported.
  - The other settings follow their GAP sizes (S to M, UI only).
- **Blocks:** SET-01, SET-03 to SET-07, SET-12 and VW-04.
- **Urgency:** before-its-slice (the settings slice). **Kind:** choice.
- **Sources:** GAP SET-01, SET-03, SET-04, SET-05, SET-06, SET-07, SET-12, VW-04; ADR 0060 Q2; the non-runtime draft's ND-15.

### C-1. gzip output (`-g`)

- **Question.** ADR 0055 held back `-g` "after a dependency decision", because the conversion crate had no gzip reader (:336–339, :513, :581). Since ADR 0056 slice 1, `crates/proteowizard` depends on `flate2 =1.1.10` (`rust_backend`), which includes a gzip decoder, so no package is added. ADR 0055 still reserved the call to the owner.

  Also: a `.mzML.gz` output cannot be opened by the reader, which needs offsets into plain mzML. Should it be adoptable?
- **Recommendation:**
  - Allow `-g` in the advanced set, labelled not verified. Its output checks read through `flate2`'s gzip decoder.
  - In the first slice the outcome is not adoptable, like the two-run formats in #161. Open folder still works.
  - Revisit adoption on a reported need.
- **Blocks:** C23. Size: S–M (*estimate*: a gzip-through read in the output inspector and one typed switch).
- **Urgency:** before-its-slice, with the advanced editor. **Kind:** choice.
- **Sources:** ADR 0055:336–339, :513, :581; `Cargo.toml`:21 and `crates/proteowizard/Cargo.toml`:21 on `origin/main`; GAP C23.

### FE-3. Bundled fonts for the new look

- **Question.** May the app bundle font files as production assets (OFL faces, with their licence texts and a source pin)? The rejected themes would each have bundled 76–112 KiB of Latin faces. Should a CJK face ever ship?
- **Recommendation:**
  - Decide with FE-2's answer, not before. v5.11 sets its type in system faces (Segoe UI and Microsoft YaHei, with Inter only where installed), so under FE-2 (a) nothing is bundled and this question closes.
  - If a design from FE-2 (b) needs a face: Latin OFL faces only, with tabular figures for measured values.
  - Never a CJK face, which would cost megabytes.
  - Exported figures keep their current fonts unless a separate decision changes them.
  - A bundled face is a production asset change under the dependency policy.
- **Blocks:** the look slice after FE-2.
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** `design/v2/HANDOFF.md` ("What the real app would need", fonts); the `--font` stacks in the v5.11 demo; FE-2.

### DEF-2. Uninstall and the view cache

- **Question.** Today only an interactive uninstall with "Delete the application data" checked deletes `%LOCALAPPDATA%\org.mscanvas.desktop`, cache included. `/S`, `/P` and `/UPDATE` never do. ADR 0060's cache holds up to 10 GiB of derived files. Should uninstall always remove the cache folder alone?
- **Options:**
  - (a) as today;
  - (b) always remove the cache folder (except on `/UPDATE`), and keep presets and preferences opt-in;
  - (c) never.
- **Recommendation: (b).** The cache is reproducible and can be gigabytes nobody owns after uninstall. Presets are user-authored, so they stay opt-in. This is a release-path change (an NSIS hook).
- **Blocks:** shipping the view cache (ADR 0060 slice 3).
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** the AFTER_BETA1_PLAN 7.2 diff in #185 (`fix/backend-defects-1030`, "Uninstall paths"); ADR 0060 Q2 (10 GiB).

### HR-1. ProteoWizard hold releases

- **Question.** Should bounded hold releases be granted for these measurements?
  1. ADR 0060 decision 14 native QA: `msconvert` and `msaccess` on two public files and on the largest public Thermo RAW under 1.5 GiB, plus a cancel and a two-process eviction check (Q6).
  2. ADR 0057's throughput measurement for parallel conversion.
  3. Producing a lawful, centroided 1–2 GiB run for U1's measurement gate.
  4. The four native e2e specs #175 edited (`m7.3-viewer`, `m7.4-conversion-figures`, `m4.2-native-save`, `m7.5-preferences`), unless the 2026-10-20 native-qualification release covers them.
  5. Later: vendor centroiding on Shimadzu and SCIEX (C15).
  6. One recorded `msaccess` run summary of a public mzML, kept with the file's digest, so the reader's run summary and BPI retention times can be compared before `msaccess` leaves the open (R-1, N-B1). #182 found no such pair in the repository.

  M10's closure also needs one window (A0064). ADR 0064 question 7 retakes ADR 0014's cancellation evidence in that window.
- **Recommendation:**
  - Grant items 1–3 and 6 as separate bounded windows, each when its slice is ready. Item 6 is one short `msaccess` run.
  - Confirm whether item 4 is covered.
  - Item 5 waits (Thermo first).
- **Blocks:**
  - VW-49 qualification;
  - parallel conversion;
  - A-20's gate (U1);
  - #175's native evidence;
  - the reader taking the run summary (N-B1);
  - C15.
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** ADR 0060 Q6 and decision 14; AFTER_BETA1_PLAN section 2 (2026-10-29 item 3) and section 8; SYN §5.2 (centroiding risks); PR #175 body; PR #182 body ("Comparison with `msaccess`"); GAP C15.

### X-3. XIC exports and panel

- **Question.** Three items:
  - **§11.9, exports.** Include CSV/TSV, SVG, PNG and Copy plot in the first scope? That is an explicit extension of ADR 0046 §5.
  - **§11.10, XIC-D5.** Give the trace its own panel under the chromatogram, sharing the RT axis, with its own value axis, no dual axis and no normalisation, and the height measured on the v5.11 layout?
  - **§11.13, divergences.** The preview and engine divergences are kept, each with its reason. The default stands, and the evaluation calls this item not blocking.
- **Recommendation:** include the exports, because publication figures are a core job and v5.11 offers the SVG. Use the panel as described.
- **Blocks:** N-X2 (X4 and X5: 4–5 of the 9–12 slices).
- **Urgency:** before-its-slice. **Kind:** choice.
- **Sources:** XIC §11.9, .10, .13; ADR 0046 §5; ADR 0037 XIC-D5.

### B-2. pyOpenMS version (with the Qt6 LGPL question)

- **Question (D4 and D6).** Which pyOpenMS ships in the first released runtime?
  - **A: 3.5.0 throughout.** This leaves Qt6 LGPL-3 §4(d)(1) open, because the manifest check refuses a modified DLL. That needs legal review.
  - **B: one bump to 3.6.0.**
    - no Qt;
    - exclude the Thermo `openms_thermo_bridge` folder;
    - port to nanobind;
    - re-qualify ANA-004;
    - check whether libiconv is linked;
    - a new, unpinned `nanobind-backend`;
    - curl, the AWS SDK and OpenSSL are linked in.
  - **C: 3.5.0 until 3.7.0**, which has no release date.
- **Recommendation.** Decide after A-03's 3.6.0 probes and before ADR 0066 is accepted, so that ANA-004 and U1 are qualified once, on the shipped version. U1's development starts on 3.5.0 either way, in the synthesis's order.
  - **If the probes pass** (every planned class runs without the Thermo folder, and libiconv is either not linked or its terms are accepted): **B**, one bump to 3.6.0 before the first release.
    - It ends the Qt question. ADR 0066 measured that the 3.5.0 engine path loads `Qt6Network.dll`, and that removing it breaks the import.
    - U2 needs 3.6.0's KD-linker fix (#10157).
    - U4 needs its ILP error reporting: 3.5.0 can return silently empty results.
  - **If they fail:** **A** for the first release, as ADR 0066 decision 8 recommends. ADR 0066 question 5, a legal reading of the manifest refusal against LGPL-3 §4(d)(1), is then answered before release, and the bump is decided before U2.
  - **ADR 0066 (#188) differs on timing only.** Its decision 8 ships 3.5.0 first, because ANA-004 is qualified on it and U1 needs no 3.6.0 fix, and it decides the bump before alignment. On that route the Qt reading blocks the release. Whichever the owner picks, decision 8 is amended to match before ADR 0066 is accepted.
- **Blocks:** A-02, the qualification of U1 (A-20) and ANA-004, and U2 (A-21).
- **Urgency:** before-its-slice (A-02). **Kind:** choice.
- **Sources:** SYN §7 D4 and D6, §2 C2, §4 item 7, §5.2 (alignment and adduct risks); openms.md §8 Q1, Q2 and Q4; ADR 0066 decision 8, "What the engine path loads" and open questions 5 and 7 (PR #188).

### B-3. What the shipped runtime leaves out: HMDB files, matplotlib and Pillow

- **Question.** Two parts.
  - The runtime ships HMDB mapping files: `HMDBMappingFile.tsv` in 3.5.0, which is already in ANA-004's runtime, and `HMDB2StructMapping.tsv` in 3.6.0. Strip them, or keep them with attribution?
  - pyOpenMS 3.5.0 declares matplotlib in `Requires-Dist`, so the lock keeps Pillow, and the Pillow alerts close only when the lock changes. May the shipped runtime's lock drop matplotlib and Pillow, if A-03 shows every planned class imports and runs without them? The alternative is #168's bump together with a new manifest pin (A-05). Pruning files alone stops Pillow from shipping but does not close the alerts.
- **Recommendation:** strip HMDB, and drop matplotlib and Pillow from the shipped lock if A-03's probe passes.
  - `AccurateMassSearchEngine` runs against a database the user chooses (B-8).
  - The HMDB wording could not be fetched (403), and commercial redistribution needs the authors' permission.
  - #168 does not merge on its own: it changes the lock while `RUNTIME_MANIFEST_SHA256` (`recipe.rs`:35) stays pinned.

  Either change alters `RUNTIME_MANIFEST_SHA256`, which rebinds ANA-004 plans, and needs an import test.
- **Measured since** (ADR 0066, #188, on a verified scratch copy of the pinned 3.5.0 runtime):
  - the engine path never loads matplotlib, Pillow or fontTools;
  - a tier-3 copy (1,793 files, 152,113,369 B) runs `adapter_v1.py` with the same rows, evidence and outcome as the full runtime;
  - removing `HMDBMappingFile.tsv` changes nothing.

  ADR 0066 decision 4 recommends tier 3 without the HMDB file; that is its question 4, which this decision carries. A-03 still runs the planned classes, not only ANA-004's path, before the lock drops matplotlib and Pillow.
- **Blocks:** A-02, A-03, the release of ANA-004 (A-05), and A-25's database choice.
- **Urgency:** before-its-slice (A-02). **Kind:** choice.
- **Sources:** SYN §7 D5, §3 item 5, §4.5, §8 (HMDB row); openms.md §8 Q3; analysis.md section 2 (Pillow) and A-03; ADR 0066 "Measurements", decision 4 and open question 4 (PR #188).

### B-4. v5.11 fields with no OpenMS equivalent

- **Question.** Six parts:
  1. **Smoothing (MOD-03).** (a) a display-only S-G preview on an extracted trace (v5.11: "不改写原始轨迹"), or (b) drop the step and expose `chrom_fwhm`.
  2. The ADAP wavelet parameters (MOD-04).
  3. The Join and RANSAC aligners (MOD-06).
  4. "最小相关性" in ion identity (MOD-12).
  5. **Centroiding for U1.** Require centroided input (Thermo through the verified vendor centroiding), or add `PeakPickerHiRes` now.
  6. **"MS1 noise level".** It maps to `noise_threshold_int` inside trace building. The default of 10 is far too low for Orbitrap data.
- **Recommendation:**
  1. (b) now, and (a) only after the XIC ships, labelled as display.
  2. Drop.
  3. Drop. Pose clustering with KD linking is used instead.
  4. Drop. MZmine-style correlation needs a driven MZmine (B-10).
  5. Require centroided input. `PeakPickerHiRes` comes later as an explicit, recorded step for open profile data. This follows "no implicit centroiding".
  6. Set the default from U1's measurement gate.

  A field that changes nothing misleads the user.
- **Blocks:** A-20's parameters (U1) and the workflow page (MOD-01 to MOD-07, MOD-12).
- **Urgency:** before-its-slice (A-20, U1). **Kind:** choice.
- **Sources:** SYN §7 D10, §5.2 (centroiding, smoothing, feature detection, alignment, adducts); GAP MOD-01 to MOD-07, MOD-12.

### B-5. Negative mode in the first untargeted domain

- **Question.** Today `adapter_v1.py`:303 refuses with `SOURCE_POLARITY_UNSUPPORTED`. Should the first untargeted domain include negative mode?
- **Options:**
  - positive first;
  - both at once.
- **Recommendation:** positive first, with negative as the next slice. Negative mode needs its own adduct set (U4) and the reader's polarity, and including it would double U1's qualification.
- **Blocks:** A-20's scope (U1) and A-23's adduct sets (U4).
- **Urgency:** before-its-slice (A-20, U1). **Kind:** choice.
- **Sources:** SYN §7 D12 and §1 (positive-only row); AFTER_BETA1_PLAN 7.4.

### B-6. The study model for cross-sample work

- **Question.** Alignment, linking, gap filling and statistics are multi-acquisition. Three constraints stand in the way:
  - ADR 0050 decision 1 gives no algorithm more than one acquisition;
  - it caps a batch at 2–16;
  - the project document is append-only, limited to 4 MiB, and holds about two passes of 300 samples.

  The options:
  - (a) study-level runs (one run, N acquisitions), under a new ADR that supersedes ADR 0050 for cross-sample recipes, plus history pruning;
  - (b) pruning only;
  - (c) a larger or sharded document.

  Also: the alignment reference map (the map with the most features, or the pooled QC), and whether to add a LOWESS second stage.
- **Recommendation: (a).**
  - Matrices live in payload files under the matrix-payload record (P4), and superseded runs are pruned.
  - The reference is the pooled QC when S-6 marks one, otherwise the map with the most features.
  - No LOWESS stage until it is measured.
- **The record is now written.** ADR 0067 (Proposed, draft PR #184, `docs/study-model-adr` at `8870e36e`) writes option (a): a study is a project record, a digest-named study revision names its samples once, one run per step, a chunked matrix (`mscanvas.studyMatrix/1`, which is P4's format), six cell states, no overwrite, and a sample-metadata CSV. It takes effect only with G1. Its ten open questions:
  1. study-level runs with a digest-named revision and a payload ledger;
  2. **metadata scope: per study (the ADR's recommendation), or per layer with one design per project;**
  3. the matrix format and bounds: chunks of at most 8 MiB, binary64, 1,000,000 rows, 1,024 columns, 2^27 cells;
  4. six cell states, including `engineDiscarded` and `imported`, and the declared reading of an imported zero;
  5. the metadata CSV refuses unknown columns;
  6. matching per-sample outputs are reused by default, with "run every sample" at review;
  7. whether losing an unpublished run to a crash is acceptable in the first build, or runs publish checkpoints;
  8. where acquisition-scale derived files live, if a later record needs one: the project's payload store, or an MSCanvas-owned cache with a recorded digest;
  9. study records join schema 5 if they merge before a release writes it, otherwise schema 6 (the same rule as S-6);
  10. who sets the parallel worker count once per-recipe measurements exist.
- **One conflict to settle with S-6.** ADR 0067's question 2 recommends metadata per study, carried in each study revision. S-6 and N-A3 put group, type, batch and injection order on the layer, keyed by `LayerId`, as v5.11 classifies roster rows (RO-22, RO-23). Recommended: per layer, as S-6 says, edited where the rows are, and each study revision records a copy of the values it used (ADR 0067 decision 2 already names role, group, batch and injection order per sample). A finished study never changes when a layer is edited, and the roster classifies rows once. A per-study override waits for a stated need. Answer S-6 and this question together.
- **Recommendation on the ten:** as ADR 0067 recommends, except question 2 as above; on question 7, no checkpoints in the first build, with the loss stated; on question 10, a recorded constant per recipe from A-13's and A-14's numbers (A-15).
- **Blocks:** U2 to U5 (A-08, A-21 to A-24); A-09's matrix writer (question 3).
- **Urgency:** before-its-slice (A-08's acceptance, then A-21, U2). **Kind:** choice.
- **Sources:** SYN §7 D13, §6.1 P4 and P7, §5.2 (alignment); internal.md H8 and §9 item 2; ADR 0050 decision 1; ADR 0067 on `origin/docs/study-model-adr` (decisions 1–12, "Open questions for the owner").

### B-11. Measurement infrastructure for Track B

- **Question.** Two parts, from the analysis plan's A-04, A-13 and A-14:
  - May a new GitHub Actions workflow run the analysis runtime? It is `workflow_dispatch` on Windows, provisions the runtime from the hash-locked wheels, checks the manifest digest against the compiled pin, runs the `#[ignore]`d real-engine tests and hosts the measurement harnesses. It is not one of the nine required checks and not the release workflow.
  - Which public data do the two gates use? A-13 needs one Thermo Orbitrap mzML of 1–2 GiB, already centroided; A-14 needs 20–50 real runs from one public study. Each licence is recorded.
- **Options:**
  - workflow: approve, or run the measurements locally under the memory gate;
  - data: public CC0 or CC-BY files that are already centroided, or centroid R0 or PXD066799 with the verified vendor row under a hold release (HR-1 item 3).
- **Recommendation:** approve the workflow, with a runner probe (CPU, RAM, free disk) before any number is trusted. Use public CC0 or CC-BY data that is already centroided, so no msconvert or hold release is needed; the hold-release route is the fallback.
- **Blocks:** A-04, A-13 and A-14, and through them the budgets of U1 (A-15) and U2 (A-21).
- **Urgency:** before-its-slice (A-04). **Kind:** choice.
- **Sources:** analysis.md A-04, A-13, A-14; SYN §5.2, §6.1 P8, §9; openms.md §5; the owner's preference for heavy tests on GitHub Actions.

---

## 5. Later

### S-4. Drift and batch correction (class F); further imputation (class E)

- **Question.** Which correction tiers come, and when? Tier 1 is diagnostics only: injection-order plots, QC RSD before and after, and PCA with the QCs. Tier 2 is batch alignment by the QC median. Tier 3 is QC-RLSC, which refuses fewer than 8 QCs per batch and must name one LOESS. Tier 4 is a spline or SERRF. Separately: kNN, RF or QRILC imputation.
- **Recommendation:**
  - Build tier 1 in Track A; it needs no approval.
  - Tiers 2 and 3 each need an ADR once a user asks.
  - No further imputation before a separate decision.
- **Urgency:** later. **Kind:** choice.
- **Sources:** SYN §7 D9 (drift tier); stats.md §3 (classes E and F), §10, §11, §14 Q4.

### B-7. Gap filling (U3)

- **Question.** Should gap filling use FFMI requantification, labelled experimental?
- **Recommendation:** accept it, labelled experimental, as M9 left that caption. The rules:
  - Cells are typed as measured, re-integrated, engine-imputed, engine-discarded or missing.
  - Engine-imputed cells stay out of the tests, and no cell is ever written as 0.
  - The inverse-RT option is used only after a fixture shows it gives the same requantification.
  - There is no box-integration mode, which would be a project-owned algorithm.
- **Urgency:** later (A-22, U3). **Kind:** choice.
- **Sources:** SYN §7 D11, §2 C6, §4 item 1, §5.2 (gap filling); openms.md §8 Q5.

### B-8. Library similarity and library sources (U6)

- **Question.** Two parts:
  - **D8, the metric.** Approve `ms_entropy 1.5.3` (Apache-2.0, numpy only, cp313 wheel) and use entropy similarity as v5.11's "相似度". The alternatives are a cosine through matchms, which is heavy, or a project-owned cosine under a written decision.
  - **D15, the libraries.** User-supplied MSP and MGF files only, with nothing bundled.
- **Recommendation:** entropy similarity, with the metric named in the UI and in exports, and user-supplied libraries only. Two conditions:
  - the wheel must carry its LICENSE (PyPI has no licence metadata);
  - adding it changes the runtime manifest, which rebinds ANA-004 plans.
- **Blocks:** MOD-09, FA-09, FA-10 and EXP-15.
- **Urgency:** later (A-25, U6). **Kind:** choice.
- **Sources:** SYN §7 D8 and D15, §2 C3, §4 item 6, §5.2 (library annotation).

### B-9. The GNPS/MGF export writer (U5)

- **Question.** Which writer produces the GNPS and MGF export?
  - The pyOpenMS writers. GNPS2's acceptance of `GNPSQuantificationFile` output is unverified, and `GNPSMGFFile.store` reads every mzML at once.
  - A project-owned MZmine-2-style CSV and MGF writer. GNPS2 accepts MZMINE.
- **Recommendation:** the project-owned writer. It is a format writer, not an algorithm, and it removes the uncertainty about the formatter. It needs charge from the reader.
- **Also:** what names the sample columns in exports: the layer label or the file's basename. Recommended: the layer label, which carries no locator (H31); the basename only where no label exists.
- **Blocks:** A-24 and A-23-UI.
- **Urgency:** later (A-24, U5). **Kind:** choice.
- **Sources:** SYN §5.2 (GNPS/MGF export) and §1 (GNPS2 row).

### B-10. External engines and outbound messages

- **Question.** Four parts:
  - a SIRIUS adapter: drive only, user-installed, with its online steps labelled academic-only;
  - MZmine 4 and MS-DIAL as driven cross-checks, each with its own ADR;
  - the avoid list: MassCube, ms2deepscore, patRoon, and the Thermo DLLs in the 3.6.0 wheel;
  - outbound messages: to mzio, about a third-party CLI driver; to the asari authors, about their LICENSE stub; to OpenMS, reporting M9.0's measured defects.
- **Recommendation:**
  - Confirm the avoid list.
  - SIRIUS after U6.
  - Send no message now. Draft each one for the owner when its slice reaches it, and send it only on the owner's go-ahead for that message.
- **Urgency:** later. **Kind:** choice.
- **Sources:** SYN §7 D14, §0 item 4; openms.md §8 Q6 and Q7; others.md §2.1 and §5.

### C-2. A deeper check for mzMLb and mz5

- **Question.** Should a new HDF5 reader dependency be added to check mzMLb and mz5 outputs more deeply?
- **Recommendation:** no new dependency. Keep ADR 0055's minimal checks (exit 0, one file, non-zero length, the HDF5 signature) and the not-verified label until a user reports a bad file.
- **Urgency:** later. **Kind:** choice.
- **Sources:** ADR 0055:389–395 and :581; GAP C09.

### V-6. Open on example data (SH-16)

- **Question.** Should MSCanvas open on example data?
- **Options:**
  - start empty, as today;
  - ship a small, lawful example file;
  - an in-app download, which the no-network posture refuses.
- **Recommendation:** start empty until a public-domain or CC-BY file under about 5 MB is found. Then ship it, with its licence in the notices.
- **Urgency:** later. **Kind:** choice.
- **Sources:** GAP SH-16.

---

## 6. Owner actions that are not decisions

- **EXP-17:** check the spreadsheet CSV in Excel, LibreOffice and WPS before any help or release text claims formula protection (AFTER_BETA1_PLAN section 2, 2026-10-28).
- **Outbound contact:** each message needs the owner's own go-ahead (B-10).
- **Dependency PRs** #136, #165 and #168 stay with the owner under the dependency policy. The alert backlog is already decided (section 1).
- **An idle-desktop window** for the native and Tauri specs that #164 and #175 could not run, because they take the foreground (#164 "Not done"; the non-runtime draft's ND-02).

**A record to fix, no decision needed.** AFTER_BETA1_PLAN 7.6 still lists mzXML output under "Stays refused". ADR 0055 decision 6 (accepted) returns mzXML as a labelled advanced format through the two-run route, so 7.6 needs a dated note.

## 7. Open elsewhere, not part of this roadmap

These are left out on purpose; each is still open in its own record:

- signing for releases after beta 1, and the SignPath application (ADR 0047:558–565; AFTER_BETA1_PLAN section 9);
- dependency batches and the Node 26 patch (AFTER_BETA1_PLAN section 9);
- the formal name review;
- per-artifact release consent.

## 8. Where each source item went (dedupe map)

| Source item | Decision |
| --- | --- |
| SYN §7 D1, §6.1 P0; internal.md §5 items 1–5 and 10, §9 item 8 | G1 |
| SYN §7 D2; stats.md §14 Q6 | G2 |
| SYN §7 D3; internal.md §9 item 5 | B-1 |
| SYN §7 D4, D6; openms.md §8 Q1, Q2, Q4; internal.md §9 item 3 | B-2 |
| SYN §7 D5; openms.md §8 Q3 | B-3 |
| SYN §7 D7; stats.md §14 Q1 | S-1 |
| SYN §7 D8, D15 | B-8 |
| SYN §7 D9: log2FC, PCA missing values, clustering; stats.md §14 Q2, Q3, Q5 | S-2 |
| SYN §7 D9: blank-ratio reference | S-5 |
| SYN §7 D9: drift tier; stats.md §14 Q4 | S-4 |
| SYN §7 D10; SYN §5.2 open items on centroiding and smoothing | B-4 |
| SYN §7 D11; openms.md §8 Q5 | B-7 |
| SYN §7 D12 | B-5 |
| SYN §7 D13; internal.md §9 item 2 | B-6 |
| SYN §7 D14; openms.md §8 Q6, Q7 | B-10 |
| SYN §6.1 P1 | S-6 |
| SYN §6.1 P2 and C6 | S-2, S-3, S-5 |
| SYN §6.1 P3, P4 and P8: plot kinds, the matrix payload format, per-recipe limits | Records written inside their slices, not owner choices. P4 is named in B-6 |
| XIC §11.1 | U7, X-1 |
| XIC §11.2, .3, .4, .5, .8 | X-2 |
| XIC §11.6, .7, .11, .12 | X-1 |
| XIC §11.9, .10, .13 | X-3 |
| GAP VW-02 | X-1, X-2, X-3 |
| GAP VW-14, VW-22, VW-26, VW-33, VW-47 | V-4, V-3, V-2, V-1, V-5 |
| GAP VW-31 | R-2 |
| GAP VW-38 | MAP-1 |
| GAP VW-48, MOD-10 | S-3 |
| GAP VW-49, SET-09 | A0060 |
| GAP SH-02 | G4 |
| GAP SH-16 | V-6 |
| GAP C23 | C-1 |
| GAP C07, C09 (HDF5 check) | C-2 |
| GAP C15 | HR-1 |
| GAP C14 and the other #161 rows | M161 |
| GAP C17, C28, C41, C50, C59, C12, C19, RO-26, SET-10, EXP-20, EXP-21 | G3 |
| GAP RO-07, RO-17, RO-22, RO-23 | S-6 |
| GAP RO-28, EXP-22 | A0061 |
| GAP MOD-08 | S-5 |
| GAP MOD-01 to MOD-07, MOD-12 | B-4 |
| GAP MOD-09, FA-09, FA-10, EXP-15 | B-8 |
| GAP FA-02, FA-03, FA-11, FA-12, EXP-14 | S-7 |
| GAP EXP-18, EXP-19 | A0064 |
| GAP EXP-17 | Section 6 (owner action) |
| PR #175 owner question | P175 |
| PR #176 / ADR 0064 | A0064 |
| PR #177 / ADR 0061 | A0061 |
| PR #178 / ADR 0063 | A0063 |
| PR #164 owner decisions (five layout answers) | FE-1, as interim defaults |
| PR #161 "Not for merge without the owner" | M161 |
| ADR 0062 (local `be/saved-figure`) | A0062 |
| ADR 0060 open questions; slice-2 notes (local `be/viewraw-op`, `20372c12`) | A0060, HR-1 (Q6) |
| ADR 0056 open question: a chromatogram above 100,000 spectra | R-2 |
| ADR 0056 decision 7 | U7 |
| ADR 0055 `-g`; HDF5 | C-1; C-2 |
| `fix/backend-defects-1030` (#185): both "proposed, for the owner" changes; the uninstall paths in 7.2 | DEF-1; DEF-2 |
| PR #181 (ADR 0060 slice 2 and its notes) | A0060 |
| PR #182 ("For the owner") | R-1 |
| ADR 0068 (`be/map2d`) open questions 1–6 | MAP-1; U7 |
| ADR 0067 (`docs/study-model-adr`) open questions 1–10 | B-6; question 2 with S-6 |
| ADR 0064 open questions 7 and 8 | A0064 |
| Commit `3a416010` (#164 recoloured the frozen goldens) | FE-1, item 3 |
| `design/v2/HANDOFF.md` open questions 1–3 and 5–7; question 4 | Withdrawn (section 1a); FE-3 |
| The owner's message, 2026-10-30 14:09 UTC ("这几个前端选项我都不满意") | FE-1, FE-2, section 1a |
| Commit `66a6067c` (#164's export palette; Rust check red) | FE-1, item 3 |
| PR #179 / ADR 0052 | Section 1 (accepted; no open question) |
| ADR 0064 open question 6 (local `docs/m10-route`, `ab4ffe63`) | A0064 |
| `design/GOALS.md` D5 | G1, G4 |
| #182 (`be/reader-meta`); SYN §5.2 scan-browsing "Open"; PRJ-006 BPI times; #154 terms | R-1 |
| ADR 0057 decision 2 (owner 2026-10-29: a new open stays refused during a conversion) | R-3 |
| ADR 0058:61–65, "presets in the app only" | A0064 |
| GAP SET-01, SET-03 to SET-07, SET-12, VW-04; ADR 0060 Q2 (preference schema) | V-7 |
| GAP EXP-23, EXP-25, C53; RUN-007 | RUN-1 |
| #164 "Copy and naming": Basic/Advanced naming | FE-1, item 2 |
| PR #187 / ADR 0065 open questions 1–5 | RUN-1 |
| PR #188 / ADR 0066 open questions 1–3, 6, 8 and 9; 4; 5 and 7 | B-1; B-3; B-2 |

**The non-runtime plan draft's ids** (its `DECISIONS` list), for reconciliation:

| Draft id | This document |
| --- | --- |
| ND-01 | G1, G2, G3 |
| ND-02 | FE-2 (same recommendation) |
| ND-03 | S-1 |
| ND-04 | S-2, S-5, S-4 (the draft has no PCA opt-in; see S-2) |
| ND-05, ND-06 | S-6 |
| ND-07 | G2 |
| ND-08 | MAP-1 (this document puts the MS2 precursor map first) |
| ND-09 | U7, X-1, X-2, X-3 |
| ND-10 | R-1, R-3 (both now compute the BPI times under a short record) |
| ND-11 | A0060 (the draft records Q8 as answered by direction A unless ND-02 reopens the layout; this document routes Q8 through FE-1 and FE-2) |
| ND-12 | A0061 |
| ND-13 | A0062, A0063, A0064 |
| ND-14 | S-3, S-4 |
| ND-15 | V-1, V-2, V-3, V-4, V-5, V-7, S-7 |
| ND-16 | C-1 |
| ND-17 | RUN-1 |
| ND-18 | Section 1: ADR 0052 is already Accepted |
| ND-19 | V-6 |
| ND-20 | M161 (the draft asks for the owner's merge go-ahead; this document asks the owner to confirm that the 2026-10-29 rule covers it) |
| ND-21 | FE-1 (same recommendation, including the export-palette revert) |
| Not in the draft | G4, P175, DEF-1, DEF-2, FE-3, HR-1, R-2, B-1 to B-11, C-2 (Track B items belong to the runtime plan) |
| The draft's note that this document's FE-1 to FE-3 ask for a theme pick | Superseded: FE-1 to FE-3 were rewritten after the owner's message, and agree with ND-02 and ND-21 |

**The analysis plan's own questions** (`analysis.md`), folded in when the plans were merged:

| Analysis-plan question | Decision |
| --- | --- |
| A-02 item 2 and A-05: the ASCII install location | B-1 |
| A-02 item 7 and A-06: the confinement bar | B-1 |
| A-03: whether the shipped lock may drop matplotlib and Pillow | B-3 |
| A-04: the non-required runtime workflow | B-11 |
| A-13 and A-14: the measurement datasets and their licences | B-11 (fallback: HR-1 item 3) |
| A-24: sample names in export columns | B-9 |
| A-16 (b): a `PeakPickerHiRes` recipe | B-4, item 5 |
| A-21: the alignment reference map | B-6 |
| A-09: the matrix payload format | Now ADR 0067 decision 6, `mscanvas.studyMatrix/1` (B-6, its question 3) |
| A-22: the inverse-RT route | A written decision inside A-22's first slice, under B-7 |
| A-11: a vector grid or `resvg`'s raster feature | MAP-1 |

## 9. Roadmap items each decision gates

Generated by the planning workspace's merge script from the same data as `ROADMAP_V511_AND_ANALYSIS.md`. Item ids are the roadmap's; "-UI" marks a unit's interface item.

| Decision | Roadmap items it gates |
| --- | --- |
| FE-1 | N-01, N-04 |
| FE-2 | N-02 |
| G1 | N-10, N-A13 |
| G2 | N-10, N-A4 |
| G3 | N-10, N-A3, N-A5, N-A7, N-A8, N-A11, A-20-UI, A-21-UI, A-25-UI |
| G4 | N-A13, A-27 |
| P175 | N-05, N-06 |
| A0060 | N-R1, N-R2 |
| A0061 | N-S4, N-A14 |
| A0062 | N-F3 |
| A0063 | N-S5 |
| A0064 | N-C10 |
| RUN-1 | N-C9, N-A14 |
| DEF-1 | N-07 |
| M161 | N-03 |
| U7 | N-13, N-14, N-X4 |
| X-1 | N-13, N-X1 |
| X-2 | N-13, N-X1 |
| R-1 | N-15, N-B1, N-B2 |
| S-1 | N-12, N-A1 |
| B-1 | A-02, A-06, A-05 |
| R-2 | N-B2 |
| R-3 | N-B4 |
| V-1 | N-V3 |
| S-6 | N-11, N-A2, N-A3, A-08-KINDS |
| S-2 | N-12, N-A7, N-A8 |
| S-3 | N-12, N-A10, N-A12 |
| S-5 | N-12, N-A9 |
| S-7 | N-A5, N-A6, A-26 |
| MAP-1 | N-14, N-X3, N-X4, N-F4 |
| V-2 | N-V3 |
| V-3 | N-V4 |
| V-4 | N-V1 |
| V-5 | N-C5 |
| V-7 | N-V4, N-S7, N-S2 |
| C-1 | N-C7 |
| FE-3 | N-02 |
| DEF-2 | N-R2 |
| HR-1 | N-05, N-B1, N-R3, A-13 |
| X-3 | N-X2 |
| B-2 | A-03, A-02, A-07, A-20, A-21 |
| B-3 | A-03, A-02, A-25 |
| B-4 | A-20, A-16, A-20-UI, A-21, A-23, A-27 |
| B-5 | A-20, A-23, A-17 |
| B-6 | N-11, A-09, A-08, A-08-KINDS, A-21 |
| B-11 | A-04, A-13, A-14 |
| S-4 | N-12, N-A10 |
| B-7 | A-22, A-22-UI |
| B-8 | A-25, A-25-UI |
| B-9 | A-24, A-23-UI |
| B-10 | A-30, A-31, A-32 |
| C-2 | N-C2 |
| V-6 | N-S6 |
