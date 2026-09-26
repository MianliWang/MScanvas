# PM9.2 — shell navigation, Workbench/Project context and action hierarchy

PM9 | Acceptance: U1, U2, U7 (same session), U9, U10 | Depends on: PM9.1 |
Serial, one writer
Status: **LOCAL IMPLEMENTATION DRAFT — NOT BUILT / NOT RENDERED / NOT TESTED.**
Depends provisionally on PM9.1's static facts only; its rendered baseline is
pending.

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

## Draft implemented (commits `317481edf9270fac49af07dcc0d2a63866a0a30a` and `9786809fcfe3f6933bf7c1ec8d1f011ae5310970`)

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
  (`9786809`).

Intended effect, **not rendered or verified**: a one-line strip under the
navigation reading, for example, "Project: Pooled QC study · unsaved changes",
"Viewing: QC_pool_01.mzML · spectrum 3", "For conversion: Selected rows · 2
eligible", "In progress: Conversion running", "Inspecting: Targeted MS1
result", each taking the reader to its surface.

## Deliberately unchanged, and why

- Roster action hierarchy, surface headings and a primary action per surface
  (the reference's page title and "process selected" button): need the rendered
  baseline and J1–J6 measurements before a change can be justified.
- Details affordances and one-column folding: unchanged owners and rules.
- Highlights and hidden-selection counts are not repeated in the shell; the
  roster already reports them.
- No counts or progress beyond what the owners state; no ETA.

## Tests (written, **not run**)

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
  replacement, and geometry observations — **authored, NOT RUN**; see
  [baseline §6](baseline.md#6-browser-baseline-spec-authored-not-run).

## Risks to check when validation opens

- The header's height grows by the context line (32 px items where the drop hint
  was one 12 px line); the measured panel floors at 960×640 and the M8/M9 specs
  that read header geometry must be rechecked.
- Focus: the ring is drawn inside each item; its visibility against the item's
  background is unverified until rendered (the gap assessment's A4 area).
- Existing Vitest suites that query exact text or button names: the draft keeps
  every context sentence distinct from them, but only a run confirms it.
- The legacy m7.2 and m7.5 specs cover this surface and are red for recorded
  reasons ([baseline §2](baseline.md#2-failing-legacy-browser-specs)); PM9.2
  repairs only what its own changes touch.

## Not in this slice

Rust, IPC, schema, runtime, manifests or locks; a second queue or state
machine; work started by navigation; caches, polling or persisted UI sidecars;
new exporters, XIC, statistics or workflow nodes; removing working behaviour,
confirmations or tests.

## Completion (after a validation window)

The tests above and the affected suites pass on the reconciled candidate; the
context line is rendered at three viewports and two languages with keyboard and
reduced-motion samples and compared with the reference's context bar; J1 and J6
show no lost context; the remaining PM9.2 items (roster action hierarchy,
surface headings) are either implemented on that evidence or recorded as not
needed. Until then U1, U2, U7 and U9 stay `IMPLEMENTED_UNVALIDATED` at most.
