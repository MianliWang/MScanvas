# PM9.2 — shell navigation, Workbench/Project context and action hierarchy

PM9 | Acceptance: U1, U2, U7 (same session), U9, U10 | Depends on: PM9.1 |
Serial, one writer
Status: **BROWSER FUNCTIONAL ACCEPTANCE PASSED — VISUAL AND PRODUCT ACCEPTANCE
PENDING.** Browser functional acceptance ran and passed in the 2026-09-25
window on the production-code candidate `a0783bb`, which carries one repair
of a regression the window found
([baseline §7](baseline.md#7-validation-window-2026-09-25)). The remaining work
is the owner's dispositions in
[baseline §3.1](baseline.md#31-rendered-comparison-and-dispositions-2026-09-25).

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
  "Remaining PM9.2 work" below).
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

## Remaining PM9.2 work (the owner's dispositions, baseline §3.1)

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

## Not in this slice

Rust, IPC, schema, runtime, manifests or locks; a second queue or state
machine; work started by navigation; caches, polling or persisted UI sidecars;
new exporters, XIC, statistics or workflow nodes; removing working behaviour,
confirmations or tests.

## Completion (after a validation window)

The tests above and the affected suites pass on the reconciled candidate; the
context line is rendered at three viewports and two languages with keyboard and
reduced-motion samples and compared with the reference's context bar; J1 and J6
show no lost context; the owner's PM9.2 actions in baseline §3.1 (L1, L9, L10,
L14–L16 and L22) are implemented and rendered at the three viewports in both
languages with keyboard and reduced-motion samples; and L20's Details
affordance is confirmed obvious, stable and keyboard reachable. Until then U1,
U2, U7 and U9 stay `IMPLEMENTED_UNVALIDATED` at most.
