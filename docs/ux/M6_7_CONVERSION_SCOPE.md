# M6.7 conversion scope

Status: implemented and validated; release record [PR #100](https://github.com/MianliWang/MScanvas/pull/100).
Baseline: `5b91f6c5ab1c3013eb9556ddf83b76217a56f249` (published M6.6).

## Outcome and interaction

A researcher chooses selected rows or all workspace rows, reviews the eligible
members in their execution order, and starts that exact plan. Search and focus
are presentation, never implicit scope. Unsupported rows are excluded and counted.
The existing Rust capacity is displayed before commitment and is not changed.
Destination policy, Fail/Skip, typed intent, installation receipts, the backend
lane and queue/retry ownership retain their existing authorities.

Baseline: selected convertible rows, otherwise a focused convertible row;
the user cannot explicitly request all and can learn capacity only from failure.
Task: curate if needed -> choose scope -> read counts/order/settings -> Convert
-> custom picker only when requested -> read bound queue and results.
Recovery: edit selection/scope after capacity refusal, correct settings in place,
or re-describe a failed request. No destination or provider work precedes admission.

Three structures considered: an inline scope choice with one matching primary
action; two independent review/start panels; a separate batch-review page.
The inline choice keeps one plan and one settings draft, uses native radio-key
navigation, and preserves the existing evidence area and conversion surface.
The other structures duplicate review state or add navigation without helping
this bounded task. No M7 redesign or production dependency is required.

Budget: existing selected workflow plus an explicit scope choice when changed;
all with defaults takes a scope choice and Convert. Review is inline. Only a
custom destination adds a native context switch. Empty, loading, unavailable,
failed, over-capacity, running and terminal states must remain truthful.

## Frozen changed-path closure (before implementation)

Paths below are relative to the repository. Additions must be recorded with a
direct in-scope reason before editing them.

1. `apps/desktop/src/features/mzml-preview/rosterView.ts`
2. `apps/desktop/src/features/mzml-preview/conversionScope.ts`
3. `apps/desktop/src/features/mzml-preview/conversionScope.test.ts`
4. `apps/desktop/src/features/mzml-preview/conversionScopeInteractions.test.tsx`
5. `apps/desktop/src/features/mzml-preview/contracts.ts`
6. `apps/desktop/src/features/mzml-preview/conversionPlanAuthority.ts`
7. `apps/desktop/src/features/mzml-preview/conversionPlanAuthority.test.ts`
8. `apps/desktop/src/features/mzml-preview/useConversionPlan.ts`
9. `apps/desktop/src/features/mzml-preview/usePreviewWorkspace.ts`
10. `apps/desktop/src/features/mzml-preview/PreviewWorkspace.tsx`
11. `apps/desktop/src/features/mzml-preview/ConversionPanel.tsx`
12. `apps/desktop/src/features/mzml-preview/ConversionPanel.test.tsx`
13. `apps/desktop/src/features/mzml-preview/conversionAvailability.ts`
14. `apps/desktop/src/features/mzml-preview/conversionAvailability.test.ts`
15. `apps/desktop/src/features/mzml-preview/conversionPlanLifecycle.test.tsx`
16. `apps/desktop/src/test/previewFixtures.ts`
17. `apps/desktop/src-tauri/src/preview/dto.rs`
18. `apps/desktop/src-tauri/src/preview/service.rs`
19. `apps/desktop/src-tauri/src/preview/tests.rs`
20. `e2e/specs/m6.7-conversion-scope.browser.e2e.ts`
21. `e2e/specs/m6.7-conversion-scope.tauri.e2e.ts`
22. `ROADMAP.md`
23. `BOOTSTRAP_STATUS.md`
24. `docs/product/FEATURE_CATALOG.md`
25. `docs/product/PRIMARY_WORKFLOWS.md`
26. `docs/ux/UX_PROCESS.md`
27. `docs/ux/USABILITY_TEST_PLAN.md`
28. `docs/architecture/adr/0043-conversion-completion-route.md`
29. `docs/ux/M6_7_CONVERSION_SCOPE.md`

## Evidence plan

Closure addition before editing: `apps/desktop/src/features/mzml-preview/conversionFindingRegressionMap.test.ts`
is a direct typed plan-identity consumer. Its existing fixture must explicitly
name selected scope so its historical mechanism proofs remain meaningful.

The new interaction suite uses `conversionScopeInteractions.test.tsx` to avoid
a same-basename TypeScript/TSX resolution collision with the pure model suite.

Closure additions before editing, identified by the first full frontend run:

- `apps/desktop/src/app/App.test.tsx`: persistent scope/availability live regions.
- `apps/desktop/src/test/outputSetRendering.test.tsx`: explicit selection before SCIEX review.
- `apps/desktop/src/features/mzml-preview/BackendReadingSuperseded.test.tsx`: explicit selection before its backend race.
- `apps/desktop/src/features/mzml-preview/conversionLaneAuthority.test.tsx`: explicit selection before lane races and zero-scope refusal rendering.
- `apps/desktop/src/features/mzml-preview/ConversionOutputSet.test.tsx`: explicit SCIEX selection, preserving topology assertions.

Closure addition before editing: `apps/desktop/src/app/app.css` gives the scope
fieldset its own selector while sharing existing fieldset styling. Reusing the
destination class would misidentify scope as destination in existing QA paths.

Pure tests: selected/all/visible separation, hidden selection, no focused
fallback, every sort and stable ties, mixed/zero counts and capacity boundaries.
Interaction tests: immediate invalidation, unchanged search, reply identity and
ordinal, double activation, settings composition, bound membership and retry.
Rust: authoritative capacity refusal and unchanged BEGIN limits before side
effects. Existing queue/destination tests remain required regression evidence.

Browser: actual controls at measured inner viewports 1366x768, 1920x1080,
1200x800 and 960x640; console, screenshots, keyboard and refusal recovery.
Native: installed provider and approved hash-pinned task copies, strict selected
subset and all under search, exact reviewed/queued order, unrelated bytes and
M6.6 destination/conflict invariants. Mocks never count as native proof.
Then full repository gates, exact-head independent review, protected true merge,
natural push/main CI and ff-only local cleanup. M6.8 is not started.

## Local validation before the first exact-head review

- Frontend: lint, typecheck and build pass; 1649/1649 tests pass in 69 files,
  including the explicit bound-retry scenario.
- Rust: fmt and clippy with all targets/features pass. Workspace tests pass:
  core 2, desktop 880 (14 ignored), plot-spec 125, provider 455 (8 ignored).
  The provider suite also launches its existing one-test subprocess check.
- Repository validator and diff whitespace check pass.
- Browser: M6.7 7/7 and M6.6 regression 8/8. Exact inner sizes 1366x768,
  1920x1080, 1200x800 and 960x640; screenshot inspection includes selected/all,
  capacity refusal and constrained scope. Application-console assertions pass;
  the runner retains its existing browser-mode service warnings.
- Native: M6.7 2/2 on the complete second run, 55.2 seconds, WebView2
  152.0.4191.66 and matching driver. Selected reviews/runs alpha then beta while
  an unrelated RAW, an mzML and a pre-existing target remain unchanged. All
  reviews/runs gamma, beta, alpha under search `alpha`, with one visible row.
  Source sibling and named subfolder produce five new validated mzML files;
  subsequent Fail/Skip preserve all three existing all-scope outputs.
- Native evidence: `D:/tmp/mscanvas-m67-20260908/m67-native-d6vfZe/evidence.json`.
  Binary SHA-256: `bcf0390d90f735680bfd215151e53efc75d3b7846fcddd836902e86c74a96919`.
  Thermo source SHA-256:
  `b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b`.
  All output claims remain `output_only`; this is not full-source fidelity.

The initial native run is retained in `m67-native-cfapeO`: selected stopped at a
native picker button timeout, while all passed. No foreground/dialog guard was
weakened, and the successful run used fresh task copies. Test repairs also made
legacy initial-focus tests select their intended rows explicitly and corrected
the browser modifier key to WebDriver's key code. No product fallback was added.

## Exact-head review and release evidence

The implementation candidate is `fe176c2a524aa9ab7ea1fbfa363bc30fef31ed30`,
tree `665558ebb16ae5fd4db6851152e5440e0275693b`. Both independent reviewers
read the full 36-file diff in separate physical archives without writing or
running tests. Both returned ADMIT with zero must-fix findings. One additionally
checked all 36 new Git blob hashes. The only optional repair was two comments
that still called the expanded plan machine five states; they now say six.

That committed head was rebuilt with `pnpm e2e:build`. Binary SHA-256:
`f1b004a9aa005013669b533f4be19214b0aac2b0368a533d4924b70beb2afb24`.
M6.7 native passed 2/2 (34.3 seconds) and the unchanged M6.6 native regression
passed 5/5 (35.2 seconds), in one sequential 75-second run. The evidence roots
are `D:/tmp/mscanvas-m67-20260908/m67-native-G39AY3/` and
`D:/tmp/mscanvas-m67-20260908/m66-native-Hle71a/`. The seven console records
are empty, the IPC mock tables are empty, and source/target byte checks pass.
Selected and filtered-all review screenshots and constrained terminal results
were inspected. The four measured inner viewports and `output_only` boundary
are unchanged.

The final record commit receives a fresh exact-head confirmation review,
rebuild/native run, required PR CI and repository validation. Unchanged test
inputs permit reuse of the 1649-test frontend, full Rust and browser evidence
above; CI independently repeats the repository's required frontend/Rust gates.
Final reviewed head, binary/evidence identity, individually resolved review
threads, protected true-merge parents/tree and naturally triggered main CI are
recorded in PR #100, since a committed record cannot contain its own commit or
future merge identity. No M6.8 work is included.

The PR's automated reviewer additionally found ambiguous workflow wording:
"no Convert visible action" could be read as hiding the primary button. The
follow-up names the absent `Convert visible` scope explicitly and retains the
selected/all actions. This is a documentation clarification, with no execution
or test-input change; its review thread is replied to and resolved individually.
