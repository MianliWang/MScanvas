# Design system foundation

Status: **bootstrap hypothesis**. Tokens and component rules must evolve through prototype testing rather than aesthetic churn.

## Experience qualities

- Evidence-first: scientific plots and status should dominate decoration.
- Calm density: enough information for research work without forcing constant navigation.
- Clear causality: selections and operations visibly explain what changed.
- Recoverable: undo/retry and non-destructive defaults are normal paths.
- Desktop-native familiarity: selection, focus, resizing and shortcuts behave predictably.

## Layout tokens

- Primary reference viewport: 1366×768 at 100% scaling.
- Also validate 1920×1080 and a constrained 960×640 window.
- Resizable panels must define usable minimums and collapse behavior.
- Main evidence area receives remaining space; toolbars must not grow into wrapping ribbons.

## Typography

- Use a local/system UI stack initially; no runtime font CDN.
- Define explicit UI, table, plot label and numeric styles.
- Numbers in dense scientific tables may use tabular figures.
- Units belong in axis labels/column headers, not implicit tooltips only.

## Color roles

Use semantic roles rather than hard-coded feature colors:

- background / elevated surface / border;
- primary and muted text;
- selection/focus;
- queued/running/success/warning/error/cancelled;
- plot context, active trace and comparison traces.

Status must not be encoded by color alone. Plot palettes require contrast and color-deficiency checks.

## Component families

Initial owned components:

- app command bar and view switcher;
- acquisition/artifact row and virtualized data table;
- resizable panel shell;
- contextual inspector sections;
- run summary/job row;
- plot toolbar and persistent inspection readout;
- empty/loading/unsupported/error states;
- semantic setting field and warning summary;
- export dialog/preview.

Radix or selected shadcn source components may support accessible primitives, but MSCanvas does not adopt generic dashboard blocks as its product design.

## Interaction states

Every control defines default, hover, active, focus-visible, selected, disabled, loading and error behavior where relevant. Pointer hover cannot be the only path to required information or action.

## Plot rules

- Profile spectra render as lines; centroid spectra as sticks.
- TIC/BPC/XIC labels and intensity semantics remain explicit.
- Selection persists after click/keyboard navigation; hover is transient.
- App theme and export theme are independent.
- On-screen and exported figures share semantic PlotSpec/FigureSpec, not screenshots as the only implementation.

## Motion

Use motion to maintain spatial continuity, signal state or reveal a panel. Avoid decorative motion over scientific evidence. Respect reduced-motion preferences.
