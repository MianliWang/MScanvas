# Interaction budgets

Budgets are design hypotheses. Prototype tests may revise them, but regressions require evidence.

| User goal | Physical-action target | Decision target | Context switches | Required feedback |
|---|---:|---:|---:|---|
| Add many RAW files | 1 drop or picker completion | 0 | 0 | Progressive discovery and duplicate summary |
| Add a batch folder | 1 drop/picker completion | 0–1 | 0 | Logical datasets found; unsupported items separated |
| Remove selected rows | selection + 1 action | 0 | 0 | Count removed; source files unchanged |
| Clear idle workspace | 1 action | 0 | 0 | Empty state and optional Undo |
| View TIC for a file | 1 row activation | 0 | 0 | Loading then trace/error |
| View spectrum near an RT | 1 plot activation | 0 | 0 | Persistent marker and linked scan metadata |
| Move to adjacent scan | 1 key/action | 0 | 0 | All linked views update |
| Convert all with defaults | at most 2 explicit actions | 0–1 | 0 | Scope/format/output summary before run |
| Convert selected | selection + 1 primary action | 0–1 | 0 | Selected count and queued states |
| Understand a common failure | 0 navigation steps | 0–1 | 0 | Cause, corrective action and expandable stderr |
| Retry a failed item | 1 action | 0 | 0 | New run state without duplicate workspace row |
| Open output folder | 1 action | 0 | 1 external app | Correct output highlighted when possible |
| Export current plot PNG | at most 2 actions | 0–1 | 0 | Export preview/path confirmation |
| Change the retention-time range | 1 wheel notch, drag, key or button | 0 | 0 | The range on screen, said in numbers, and Reset range live only while zoomed |
| Hide or show a trace | 1 action per trace | 0 | 0 | The trace, and a legend that distinguishes the two without colour |

## Cognitive-cost checklist

For every primary-flow design, document:

- actions and decisions;
- navigation/mode changes;
- state the user must remember;
- terminology required;
- feedback latency and visibility;
- error recovery and undo;
- destructive/scientific risk;
- pointer, keyboard and non-hover alternatives;
- comparison with the current baseline workflow.

Fewer clicks do not automatically win. High-risk operations may intentionally add one clear decision when it materially prevents data loss or hidden scientific changes.
