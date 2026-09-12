# UX process

MSCanvas uses evidence-led product design so maintainers do not need to prescribe visual details in prompts.

## Required workflow for a major user journey

1. **Frame the job** — user, context, desired outcome, frequency, risk and data scale.
2. **Inventory tasks** — classify frequent/rare and low/high-risk actions.
3. **Map the baseline** — document the current tool path, friction and recovery cost.
4. **Perform hierarchical task analysis** — observable steps, decisions, feedback and failure points.
5. **Set interaction budgets** — actions, decisions, context changes and hidden state.
6. **Generate three structural alternatives** — different information architectures, not merely different colors, unless an accepted-reference continuation is recorded below.
7. **Compare alternatives** — task paths, evidence area, discoverability, small-window behavior and recovery.
8. **Prototype with realistic states/data** — include empty/loading/error and batch scale.
9. **Run a cognitive walkthrough** — goal visibility, control discoverability, mapping and feedback.
10. **Run lightweight usability tasks** — ideally 3–5 representative users before costly implementation.
11. **Implement a vertical slice** — preserve the accepted structure and state model.
12. **Rendered QA and regression tests** — desktop/constrained window, keyboard, console and interaction proof.
13. **Persist the decision** — feature catalog, workflow, design system and ADR where appropriate.

## Four cognitive-walkthrough questions

At every step ask:

1. Will the user form the right goal here?
2. Is the relevant control or evidence discoverable?
3. Can the user connect it to the goal using current terminology?
4. Does the result provide timely, unambiguous feedback and recovery?

## M7 accepted-reference continuation

The owner's M7.0 authorization accepts v5.11 as the reference for the existing
viewer, converter and figure product. [ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md)
owns its bounded production mapping, slice order and release exits. Steps 6–7
do not restart a design competition for that scope. Keep task/baseline analysis,
interaction budgets, recovery, cognitive walkthroughs and implementation QA.
Historical prototype screenshots and simulated data are reference evidence only.

The preflight's localized settings/dialog proof belongs to M7.1, grouped internal
drag versus native OS drop to M7.2, and real viewer/scan/export proof to M7.3.
Each changed consumer supplies focused rendered/native evidence; M7.6 verifies
the installed integrated task. M7.0 runs none of these implementation proofs.
The first consumer changing ConversionPanel/focus restoration must investigate
[issue #112](https://github.com/MianliWang/MScanvas/issues/112) before accepting
that flow; its root cause remains undetermined.

## Visual-pattern policy

No style is banned merely for being fashionable, and none is accepted merely for appearing modern. Glass, bento, hover, dense tables, floating panels and other patterns are evaluated by:

- task fit and information hierarchy;
- legibility/contrast and scientific evidence integrity;
- discoverability and keyboard/touch alternatives;
- constrained-window behavior;
- rendering/performance cost;
- prototype and user-test evidence.

Essential information may appear on hover for speed only when an equivalent visible, focusable or pinnable path exists.

## UX evidence required in a non-trivial PR

- user goal and baseline;
- proposed steps, action/decision counts and context switches;
- loading/empty/error/recovery states;
- risky scientific/destructive operations;
- keyboard path;
- screenshots or rendered evidence;
- interaction exercised;
- known uncertainty and next validation.

## M6.6 destination and conflict continuation

**Published in M6.6, PR #99.** The evidence below records the local validation
stage; final publication is at `5b91f6c5ab1c3013eb9556ddf83b76217a56f249`.
The v5.11 prototype's concise destination/conflict organization is the reference
for this slice. The user authorized continuation in the current production
surface, so steps 6-7 above do not reopen the accepted direction. The prototype
does not authorize its initial selection, simulated capabilities, globals, shell
or accumulated style overrides. M6.6 uses the locked stack and owned components;
the wider design-system and localization work remain M7's.

The user goal is to choose where the existing conversion intent writes, explain
what an occupied name will do, and execute that reviewed request. The baseline
is one custom-folder picker for the queue plus Fail/Skip. The candidate path is:

1. Keep the current custom-folder default or choose source sibling/named
   subfolder. Enter one folder name only for the latter.
2. Read one compact policy/name/conflict summary and the Rust-authored plan.
   Source-relative text is conditional until Rust admits destination objects;
   backend-named output sets do not acquire invented names or a clean-conflict
   claim in the review.
3. Activate conversion once. Only custom folder opens the existing native
   picker; cancellation returns to the settings without conversion.
4. Correct a refused name in place, choose a usable local destination after a
   destination refusal, or retry a retryable result against its stored objects.
   The settings survive refusal and cancellation.

The budget is the existing primary conversion action, plus a policy choice and
name entry only when the user changes destination behavior. Custom folder keeps
its existing picker decision and external context switch; source-relative
policies add no picker. Review remains on the conversion surface. There is no
destructive confirmation step because overwrite is terminally refused.

The walkthrough must distinguish an existing target from two batch items
claiming one destination/name. Fail/Skip cannot resolve the latter. For a
backend-named set, Skip applies only when all names are occupied; partial
occupation refuses the set. A late publication failure can leave a reported
prefix and must not imply complete conversion. Rust validates the subfolder
name; the UI preserves invalid text and gives a corrective message instead of
changing the requested name.

The real Windows/Tauri task passed **5/5** on 2026-09-08: native picker Escape
and keyboard focus/draft recovery, custom-folder conversion, equal names in
different source parents, invalid-name refusal followed by named-subfolder
conversion, and byte preservation under Fail/Skip. Its measured inner viewports
were exactly 1366×768, 1920×1080, 960×640 and 1200×800. The five produced mzML
files retain the existing `output_only` validation claim; this is not source
fidelity evidence. All five captured application-console records were empty.

The browser/mock task has a separate **8/8** pass with exact inner dimensions
asserted at all four viewports. The provenance and remaining limits are in
[USABILITY_TEST_PLAN.md](USABILITY_TEST_PLAN.md). These local runs do not claim
final-head checks, independent review, protected publication or broad regression
completion. Historical prototype QA is not counted as current evidence.

## M6.7 explicit conversion scope

The existing conversion panel retains one settings draft and one review. An
inline native-radio choice selects curated rows or all workspace rows, followed
by one matching Convert action. Counts, ordering and the complete member list
make the decision visible, including under search. Empty and over-capacity
scopes preserve controls and give a route to a usable selection.

The three considered structures, interaction budget, frozen changed-path
closure, keyboard/recovery tasks and evidence are recorded in
[M6_7_CONVERSION_SCOPE.md](M6_7_CONVERSION_SCOPE.md). This is a scope slice over
the published M6.6 surface; M7 layout, libraries and localization remain outside.
