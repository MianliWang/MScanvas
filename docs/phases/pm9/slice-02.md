# PM9.2 — shell navigation, Workbench/Project context and action hierarchy

PM9 | Acceptance: U1, U2, U7 (same session), U9, U10 | Depends on: PM9.1 |
Serial, one writer
Status: **PM9.2 PRODUCT CONVERGENCE — FOCUSED RENDERED ACCEPTANCE PASSED EXCEPT ONE OWNER DECISION.** The owner's dispositions in
[baseline §3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25)
were implemented on the reconciled base (`6b31161`), repaired once from the
rendered evidence and accepted in the browser on the final candidate
`0d22fc7843c0ec9583ca44bc4fa91e0a94803eb0` (see "Focused rendered acceptance"
below). Every obligation passes except one criterion of L14–L16: at its narrow
floor the English conversion-scope item reads "For co…", which does not say
what it is. Fixing it changes the English wording that the frozen PM9.1 B2 test
pins, so it waits for the owner. Native rendering at 150 % stays PENDING.

## Goal

The shell makes the current project, the viewed data, the processing scope,
the active operation and the inspected result understandable from any surface,
and makes the existing routes and actions easier to find, without changing
what any of them means scientifically.

## Read first

[brief.md](brief.md), [baseline.md](baseline.md) §1 and §3, the
[M7.2 record](../../ux/M7_2_WORKBENCH_SHELL_ROSTER_ORGANIZATION.md),
[screen model](../../product/SCREEN_MODEL.md), and the entry points in
`features/mzml-preview/PreviewWorkspace.tsx`, `features/workbench/WorkbenchHeader.tsx`,
`features/preferences/SessionPreferencesProvider.tsx` and `features/project/useProject.ts`.

## Facts the draft relies on (static, at `d56b17b`)

- The header had Home, three surfaces and panel actions, with a badge only for
  conversion work; nothing outside the Project surface named the open project,
  the viewed acquisition, the project's operation or the inspected object.
- The shell grid is three rows (header, notices, main). The header already had a
  full-width second line: the drop hint.
- All three surfaces stay mounted and toggle `hidden`, so drafts survive
  navigation; the targeted setup closes when the project is replaced.
- Existing sentences cover the project's work (`busyKey`) and the naming of
  runs and artifacts (`operationKey`, `artifactKey`).
- Tests find the navigation by exact names and by `/^Conversion & results/`, and
  find file names and status sentences by exact text; a shell that repeated
  those strings as separate elements would break them.

## Draft implemented (commits `317481edf9270fac49af07dcc0d2a63866a0a30a` and `9786809fcfe3f6933bf7c1ec8d1f011ae5310970`) and the window's repair (`a0783bb7c64b41cd0c2ab3780573bfb679e3464a`)

- `features/workbench/shellContext.ts` (new): a pure projection from the
  owners' facts to context items. Each item is one sentence and names the
  surface that owns its fact.
- `features/workbench/WorkbenchHeader.tsx`: one `go()` path for Home, navigation
  and every context item (change surface, let panels fold); the context line as
  a labelled group of buttons in the header's second line, beside the drop hint;
  a visual-only Project work dot with its own class.
- `features/mzml-preview/PreviewWorkspace.tsx`: assembles the facts from
  `useProject`, the viewer, `resolveConversionScope` and the conversion lane (a
  requested stop reads as stopping, as the Conversion surface reads it).
- `features/project/ProjectPanel.tsx`: `busyKey` exported, nothing else changed.
- `features/preferences/locales/en.ts`, `zh-CN.ts`, `i18n.ts`: fifteen new
  resources and their parameter types.
- `features/workbench/workbench.css`: the context line's layout, with existing
  tokens; items at the 32 px compact-control minimum, and a focus ring drawn
  inside each item because the line clips its overflow for the ellipsis
  (`9786809`). `contain: inline-size` on `.shell-context` (`a0783bb`, the
  window's repair): the line's unwrapped items no longer widen the shell's
  `auto` column, which made the document 1191 px wide at 960×640 in en
  ([baseline §7.3](baseline.md#73-pm91-browser-spec-and-the-pm92-repair)).

Intended effect: a one-line strip under the navigation, each item taking the
reader to its surface. The 2026-09-25 window rendered it in the browser; the
rendered items read, for example, "Project: Test project", "Viewing:
QC_pool_01.mzML · spectrum 0", "For conversion: Selected rows · 0 eligible",
"In progress: Conversion running" and "Inspecting: Targeted MS1 result". With
long names at narrow widths every item is truncated
([baseline §3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25),
L14–L16).

## Deliberately unchanged, and why

- Roster action hierarchy, surface headings and a primary action per surface
  (the reference's page title and "process selected" button): needed the
  rendered baseline before a change could be justified. After the window the
  owner disposed of them as PM9.2 actions (baseline §3.1, L1 and L9; see
  "Convergence implemented" below).
- Details affordances and one-column folding: unchanged owners and rules.
- Highlights and hidden-selection counts are not repeated in the shell; the
  roster already reports them.
- No counts or progress beyond what the owners state; no ETA.

## Tests (results in [baseline §7](baseline.md#7-validation-window-2026-09-25))

- `features/workbench/shellContext.test.ts`: every item, both languages, empty
  names, user text kept verbatim, conversion statuses, project activity,
  inspected kinds and a gone record, item order.
- `features/workbench/ContextLineShell.test.tsx`: in the real composition, an
  item only changes the surface and sends no project request; the inspected
  object survives a trip to the Workbench; navigation names are unchanged.
- `app/Pm9Baseline.test.tsx` (PM9.1) also asserts the context line in each
  scenario.
- `e2e/specs/pm9.1-baseline.browser.e2e.ts` (PM9.1): the context line in the
  rendered browser layer — routing, what survives navigation, settling and
  replacement, and geometry observations; see
  [baseline §6](baseline.md#6-browser-baseline-spec).

Every one of them passes on `a0783bb`: the three Vitest files and the full
suite (109 files, 2198 tests), and PM9.1's spec, 14 of 14. `pnpm lint`,
`pnpm typecheck`, `pnpm e2e:typecheck`, `pnpm build`, `check_repo` and
`git diff --check` exit 0. Browser functional acceptance passes.

## Risks, as the window found them

- The header's height: it grows by 13 px (75 → 88), not by a whole 32 px item,
  because the context bar takes over the drop hint's line. The M8/M9 specs that
  read header geometry pass. The measured panel floors at 960×640 stay
  unconfirmed, because their owning specs (m7.2, m7.3, viewer-r1) are red for
  the recorded reasons.
- Focus: every context item is a Tab stop with a visible solid outline in every
  rendered frame (baseline §7.4).
- Existing Vitest suites that query exact text or button names pass.
- The legacy m7.2 and m7.5 specs cover this surface and are red for recorded
  reasons ([baseline §2](baseline.md#2-failing-legacy-browser-specs)); their
  outcomes are unchanged by test identity, and their failure text is unchanged
  after number-normalization (baseline §7.5). PM9.2 repairs only
  what its own changes touch.
- Found by the window: a horizontal overflow at 960×640 with long names,
  repaired in `a0783bb` (baseline §7.3).

## The owner's dispositions (baseline §3.1), as frozen

- **L1.** Add a clear surface or task title. Expose a contextual primary action
  only where an existing owned action is genuinely the next step.
- **L9.** Reduce simultaneous roster-toolbar competition: keep high-frequency
  and current actions visible, and move lower-frequency organization controls
  into the existing secondary or menu hierarchy. No capability is removed and
  no authority changes.
- **L10.** Remove the permanent 89 px notice footprint when there is no
  actionable state. Persistent actionable errors and recovery states stay
  visible.
- **L14–L16.** Keep the context-line concept, redesigned as a priority-based
  summary: the active operation or status, whose state word stays readable;
  the viewed or inspected object; the project's identity; the scope only when
  contextually relevant; lower-priority context collapsing into
  Details/context at narrow widths rather than every field becoming an
  ellipsis. No
  further wrapped header row merely to fit all context.
- **L22.** Required content must not become unreachable because of outer
  overflow ownership. Repair it while keeping the intentional local roster,
  table and evidence scroll owners.
- **L20 (intentional).** Details may stay hidden by default at 1366-class
  widths, provided its affordance stays obvious, stable and keyboard reachable.

L13, the English chromatogram toolbar that wraps at 960×640, is PM9.3's, not
this slice's.

## Convergence implemented (2026-09-26, on `c562327`)

Production commit `6b31161be6ff66d31c1a9152b4cf59cefffa1afe` (tree
`8783d517bdfcd723bc21811a8315b48e92e56552`), frontend only:
`features/mzml-preview/BackendStatus.tsx`, `DatasetRoster.tsx`,
`PreviewWorkspace.tsx`; `features/workbench/WorkbenchHeader.tsx`,
`shellContext.ts`, `GroupedRosterList.tsx`, `workbench.css`;
`features/project/project.css`; `features/preferences/locales/en.ts` and
`zh-CN.ts` (one new resource, `backendReadyShort`, and the unsaved-project
wording). No Rust, IPC, schema, persisted state or scientific contract changed;
owners, selection distinctions, provenance and the focus-race repairs are kept.

| Row | Disposition as implemented |
| --- | --- |
| L1 | Each surface's region is named by an `h1` in the navigation's words (Workbench, Conversion & results, Project). One owned action became a primary: reopening a retained preview on the evidence surface. No other surface gained one: with nothing read, nothing retained or no project open, no single next step exists, and New and Open stay equals |
| L9 | Conservative. Every roster action keeps its place, name and meaning; none moved into a menu, because the roster's focus-return contracts and name-based tests depend on the arrangement. The competition is reduced by hierarchy instead: `Preview focused` and `Remove highlighted` are marked contextual and go quiet while refused, the organizing row's buttons are quiet, and the selection count moved onto that row, so two bands above the first row become one. Moving organization controls into a menu stays open for a later decision |
| L10 | With a usable, current reading and nothing to act on (not checking, not superseded, not held back by the conversion lane), the banner folds to a `ProteoWizard ready` toggle in the context bar (`aria-expanded`, `aria-controls="backend-status"`) and the notices track keeps no height. The banner keeps its one live region, visually hidden, so a verdict is still announced. Missing, unsupported, failed, superseded and quarantined states stay on screen with their actions and help, never toast-only. Focus inside the banner keeps it open, and a focused toggle that leaves hands focus to the banner. The startup `checking` state still shows the band; it is transient |
| L14–L16 | `prioritizeShellContext` ranks each item: (1) conversion or project activity, (2) the object of this surface (viewed on Workbench and Conversion, inspected on Project), (3) the project, (4) the scope, (5) the other object. Status never shrinks; the others give way from rank 5 up, each to a small floor that keeps its first letters. The scope leaves the line on the Project surface, where it is not relevant. The unsaved state now precedes the project name, so a long name cannot hide it. Nothing moves into Details: Details holds neither the project identity nor the scope, and (5) lets a fact leave the header only where Details carries it. The bar never wraps: the drop hint ellipsizes first |
| L20 | Details stays closed by default below 1700 px. Its toggle is the same control in the same place on every surface; refused, it uses `aria-disabled` rather than `disabled`, stays in the tab order with its focus ring, dims, and says why in the terms of its surface |
| L22 | The evidence, conversion, project and inspector regions are positioned, so visually hidden and empty live-region text inside them resolves against its own scroll owner rather than the shell, and no longer extends the document. The surfaces are flex columns whose content fills them (`flex: 1 0 auto` instead of `min-height: 100%`). The roster, table and evidence scroll owners are unchanged |

One bounded static review (four lenses: behaviour, CSS layout, tests, scope
and accessibility) found no stop condition. Its in-scope findings were fixed
before commit: the fold could take focus from a reader in the help, and the
toggle could drop focus when it left (both focus-race regressions); the rank
factors shrank every item at once; four tests drove a folded control; one
refused-Details test could not fail; the m7.5 captures judged a folded banner;
m7.5 native opened the help before unfolding it; and three PM9.1 observation
assertions could not fail. A misleading comment was corrected.

### Tests (commit `e533c946c1796e8b47005331b15eef5fae28b852`, tree `d1fad14e8a8bb738b8bf3a3fb08188159dd407c8`)

- `app/Pm92Convergence.test.tsx` (new, in the real composition): the fold and
  its toggle; a banner with something to act on stays, with no toggle; titles
  and region names; no primary action where no owned next step exists; roster
  actions reachable by name; the ranked line and the Project-surface scope; the
  Details entry at a 1366-class window, refused and focusable, then usable.
- `features/workbench/shellContext.test.ts`: ranks, line order, the scope per
  surface; the unsaved wording in both languages.
- `features/preferences/preferenceRepairs.test.tsx`: a quiet verdict does not
  fold the banner under a reader in its help; a focused toggle that leaves
  hands its place to the banner.
- Existing suites follow the fold through `test/backendBanner.ts` and read
  `aria-disabled` on Details. B1–B7 in `app/Pm9Baseline.test.tsx` are
  unchanged and pass. One B1 expectation moved in the browser spec only (next
  item).
- e2e, authored and NOT RUN: `e2e/support/backendBanner.ts` in m5.7, m6.1,
  m6.4 and m7.5; m7.5 captures judge a folded banner by its toggle; m7.2 reads
  `aria-disabled`; the PM9.1 observation block now asserts the status inside
  the line, one row, no outer vertical scroll, no notices band and the toggle,
  and adds a refused-Details keyboard sample at 1366×768. **B1 changed:** it
  now expects no scope item on the Project surface, where it expected one. This
  follows this slice's reading of L14–L16 (4), "the scope only when
  contextually relevant", against "B1–B7 unchanged"; it needs the owner's
  confirmation.

No screenshot or pixel golden is a contract. The new banner-focus tests and the
refused-Details test were each checked to fail with the guarded line removed.

### Checks

Run on the committed content in this dispatch: `pnpm typecheck` (`pnpm lint`
is the same `tsc -b`), `pnpm e2e:typecheck`, the full Vitest suite (110 files,
2212 tests, `--maxWorkers=2`), `pnpm build` (`tsc -b && vite build`; the new
CSS rules survive minification; only the existing chunk-size warning),
`python scripts/check_repo.py` and `git diff --check`: all exit 0. jsdom
applies no CSS, so the layout claims (status inside the line, one row, no
outer scroll, 960×640 reachability) are covered only by the unrun PM9.1
browser spec.

Not run, by the dispatch's bounds: Cargo (no Rust changed); any browser or
native e2e; real-runtime OpenMS; any provider-positive path, which stays
BLOCKED_PROVIDER_HOLD.

### Focused rendered validation set, ready for an owner-opened window

1. `e2e/specs/pm9.1-baseline.browser.e2e.ts`: B1–B7, PM9-G at 1920×1080,
   1366×768 and 960×640 in en and zh-CN with keyboard and reduced-motion
   samples, and the new refused-Details sample.
2. `e2e/specs/m7.2-workbench.browser.e2e.ts` and
   `e2e/specs/m7.5-preferences.browser.e2e.ts`, compared against their
   recorded failures ([baseline §2](baseline.md#2-failing-legacy-browser-specs)).
3. `e2e/specs/m5.7-selection-availability.browser.e2e.ts`,
   `m6.1-conversion-availability.browser.e2e.ts` and
   `m6.4-conversion-settings.browser.e2e.ts`, which now unfold the banner.
4. The M8/M9 browser specs that read header or notice geometry, and
   `e2e/specs/pm9.3-viewer.browser.e2e.ts` as the unchanged-viewer check.
5. Native Windows at the host's 150 % scaling (m7.2 and m7.5 native): PENDING,
   by a route the ProteoWizard HOLD allows; the provider-positive route stays
   BLOCKED_PROVIDER_HOLD.

### Records this supersedes, to amend after acceptance

Not edited before the rendered acceptance; each is superseded by the rows
above once accepted. The acceptance below ends with one owner decision, so
they are still unamended; the amendments are drafted and wait for it:

- [M7.2 record](../../ux/M7_2_WORKBENCH_SHELL_ROSTER_ORGANIZATION.md): Details
  "disabled until a preview is loaded" (L20).
- [M8.0 gap assessment](../../ux/M8_0_V511_GAP_ASSESSMENT.md): the `Details`
  control described as disabled wherever nothing was read (L20).
- [M7.5 record](../../ux/M7_5_PREFERENCES_FIRST_RUN_RECOVERY.md): the offline
  help as a disclosure "in every banner state"; folded, it is one press away
  (L10).
- [ADR 0006](../../architecture/adr/0006-multi-dataset-workspace-boundary.md),
  the 960×640 budget with a persistent backend notice (L10).
- [PRIMARY_WORKFLOWS](../../product/PRIMARY_WORKFLOWS.md) WF-001 step 2: the
  release and build are reported through the folded reading and its toggle
  rather than a standing band (L10).

## Focused rendered acceptance (2026-09-26)

The owner's dispatch "PM9.2 — focused rendered acceptance and closure", on
`feat/pm9-product-convergence` from `28e3f11`. Browser only, one spec at a
time, with the memory gate; no Cargo, Rust, OpenMS, provider or native work.
Records: `.tmp/pm92-accept/run1`–`run4` (each run's `summary.txt`, logs and
`classify.txt`) and `test-results/<spec>/browser-*` (git-ignored); the details
and numbers are in [baseline §9](baseline.md#9-pm92-focused-rendered-acceptance-2026-09-26).

**B1, as the owner clarified it.** The invariant is unchanged: context facts
come from their owners, and a context item navigates without starting work or
changing the processing scope. What is shown is page-sensitive: the scope is
absent on the Project surface and, where it is relevant, reads exactly what
the Conversion surface resolves. Hiding it changes nothing it is made of. B1
now asserts each of these at every route step (`9c8459c`).

**Candidate.** Tested code: `0d22fc7843c0ec9583ca44bc4fa91e0a94803eb0`, tree
`9610fe373dd8dae7a59abd1930d4fd95311450f6`. Its production code is
`6b31161` plus the repair `56d826244e18354d672da974407bfb6337ada5f1` less
the one rule `0d22fc7` withdraws. Test-only commits on the way: `9c8459c`
(B1), `6d4a3a3` and `fc6506c` (rendered order, focus, L1 and L22 frames),
`a2ccfbf` (ellipsis measured on the item's own copy) and `8d3c9d8` (a frame
is read only once the resized layout has settled).

**One repair cycle, used.** Run 1 on `fc6506c` found two defects:
L14–L16's order leaked (a higher rank took a sub-pixel share and drew an
ellipsis, "Inspecting: Targeted MS1 res…" while the project name had 168 px
to give), and L9 still read as one filled button and four equal bordered
ones. `56d8262` repaired both and made the drop hint give way first. Its rerun
showed that one of its rules, the selection count sharing New group's row,
crushed the count into six lines once the Undo link appears (the band grew from
67 to 121 px); `0d22fc7` withdrew that rule to its rendered state before the
repair. Nothing new was designed after the cycle.

**Browser results on `0d22fc7`** (run 4), by stable test identity against the
2026-09-25 campaign on `a0783bb`:

| Spec | Result | Against `a0783bb` |
| --- | --- | --- |
| `pm9.1-baseline` | 22 of 22 | B1–B7 pass; PM9-G four states × three viewports × two languages; eight PM9.2 cases |
| `m7.5-preferences` | 7 of 8 | 1 known failure, same text; "holds the gated startup state" now passes, because Details is refused with `aria-disabled` (L20) |
| `m7.2-workbench` | 1 of 11 | 10 known failures, same text |
| `m5.7-selection-availability` | 7 of 8 | 1 known failure (960×640), same text |
| `m8.1`–`m8.5`, `m9.1`, `m9.4` | all pass | same pass |
| `pm9.3-viewer` | 11 of 11 | same pass |
| `m6.1`, `m6.4` (run 1, `fc6506c`) | 0 of 9, 0 of 24 | known setup failures on the obsolete selector; no later change touches that path |

No new failure in any run; one known failure now passes.

**Final dispositions.**

| Row | Disposition, from the rendered evidence |
| --- | --- |
| L1 | **Pass.** Every surface is titled in the navigation's words, in en and zh-CN. The evidence surface offers no primary action with nothing read and nothing retained, and after an installation change the retained acquisition's reopen is its one filled primary, in both languages |
| L9 | **Pass** on the owner's criterion. The block reads in three tiers: one filled (`Add files…`), three bordered (`Add mzML folder…`, `Preview focused`, `Remove highlighted`), two quiet (`Clear list`, `New group`); the picked-row pair goes quiet while refused. No menu, no capability or meaning changed. The organizing band is one line in zh-CN; in en the count keeps a line of its own (67 px, 75 px before PM9.2), so the implementation record's "two bands become one" holds in zh-CN only |
| L10 | **Pass.** A quiet reading folds to `ProteoWizard ready` and the notices track takes 0 px (89 px before). Missing, unsupported and quarantined readings stay on screen with their actions and help (M7.5). A toggle that leaves while focused hands the keyboard to the banner, rendered; the help is not folded under a reader, in Vitest |
| L14–L16 | **Pass except (e) in en.** The status is never cut; ranks give way strictly in order, lower first, with the drop hint gone before any of them; the scope is absent on Project and elsewhere reads the Conversion surface's own; the line is one row. At the 5.5em floor zh-CN keeps "正在检…" and "待转换…", en keeps "Inspect…", but the English scope keeps "For co…", which does not identify it. **Owner decision:** reword the English value to lead with the word that tells it apart, e.g. "Conversion scope: {{scope}} · {{eligible}} eligible" (a copy change under ADR 0047, which also changes what the frozen B2 and two other PM9.1 checks pin), or accept it as a limit |
| L20 | **Pass.** Closed by default at 1366×768; the same bordered control in the same place on every surface; refused, it stays a Tab stop with a visible ring, says why, and a press does nothing |
| L22 | **Pass.** The document keeps no height or width of its own in any frame (before: 64 to 851 px of vertical overflow). The evidence, Conversion, Project and inspector regions and the roster list each own their overflow. At 960×640 the main region has 524 px on screen (435 before); the spectrum panel 85 px in en and 136 px in zh-CN (25 and 76 before), the L1 title taking 29 px of the 89 the fold returned |

**Known limits.** When the drop hint is squeezed below its ellipsis it shows a
clipped first glyph, and its 16 px gap stays after it reaches 0. Two statuses
at once, an unsaved long-named project at its floor, the rank-2 shrink after
rank 3 is floored, the superseded reading and zh-CN with the Undo link are not
rendered. The give-way order rests on Blink rounding sub-unit shrink shares to
nothing (commented in `workbench.css`). The en count wraps between "0" and
"checked". In the retained state two filled accents are on screen (the reopen
and `Add files…`). The Project surface's refused `Capture file facts` renders
at full accent: `aria-disabled` is not dimmed for `.primary-button`, which PM9.2
did not touch. Clear list's focus and hover, and every zh-CN keyboard walk, are
code-evidenced only. Native Windows at 150 % is PENDING and the
provider-positive route BLOCKED_PROVIDER_HOLD.

## Not in this slice

Rust, IPC, schema, runtime, manifests or locks; a second queue or state
machine; work started by navigation; caches, polling or persisted UI sidecars;
new exporters, XIC, statistics or workflow nodes; removing working behaviour,
confirmations or tests.

## Completion (after a validation window)

The tests above and the affected suites pass on the convergence candidate; the
context line is rendered at three viewports and two languages with keyboard and
reduced-motion samples and compared with the reference's context bar; J1 and J6
show no lost context; the owner's PM9.2 actions in baseline §3.1 (L1, L9, L10,
L14–L16 and L22) are implemented and rendered at the three viewports in both
languages with keyboard and reduced-motion samples; and L20's Details
affordance is confirmed obvious, stable and keyboard reachable. Until then U1,
U2, U7 and U9 stay `IMPLEMENTED_UNVALIDATED` at most.
