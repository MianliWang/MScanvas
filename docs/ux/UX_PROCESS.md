# UX process

MSCanvas uses evidence-led product design so maintainers do not need to prescribe visual details in prompts.

## Required workflow for a major user journey

1. **Frame the job** — user, context, desired outcome, frequency, risk and data scale.
2. **Inventory tasks** — classify frequent/rare and low/high-risk actions.
3. **Map the baseline** — document the current tool path, friction and recovery cost.
4. **Perform hierarchical task analysis** — observable steps, decisions, feedback and failure points.
5. **Set interaction budgets** — actions, decisions, context changes and hidden state.
6. **Generate three structural alternatives** — different information architectures, not merely different colors.
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
