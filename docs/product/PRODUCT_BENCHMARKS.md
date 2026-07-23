# Product design benchmarks

References are pattern studies, not templates. Capture exact versions/screenshots during UX work because products evolve.

| Product family | Borrow | Avoid copying |
|---|---|---|
| TradingView / financial terminals | chart-first evidence, linked cursor, watchlist, saved layouts, indicator/layer panes | trading-specific density, decorative market chrome |
| Power BI | distinct data/report/model mental tasks, inspect underlying data, filters and artifact semantics | report-canvas complexity in the basic viewer |
| Tableau | progressive construction, visible encodings/filters, reconfigurable workspace | exposing every analytic grammar to routine users |
| KNIME | explicit typed steps, inspectable inputs/outputs, node/run states | forcing every user to draw a DAG before common tasks |
| MZmine | mass-spec linked views, raw/feature/library artifact distinction, task overview | deeply nested module menus and modal parameter overload |
| TOPPView/OpenMS | plot layers, input/result comparison, consistent scientific navigation | legacy visual treatment and package-specific terminology in normal mode |
| Wireshark | dense master-detail, table keyboard navigation, structured inspector | maximum-density defaults without progressive disclosure |
| HandBrake / Media Encoder | presets, queue, progress, failure isolation and activity log | source-by-source setup friction and media-specific jargon |
| VS Code | resizable workbench, contextual sidebars/panels, layout persistence, command discoverability | extension/command complexity before product needs it |
| Windows Explorer | familiar file selection, drag/drop, sorting and batch actions | ambiguous Delete semantics for logical workspace rows |

## Benchmark review template

For each studied flow, record:

- user job and representative data scale;
- screenshot/video and product version/date;
- exact behavior worth borrowing;
- cognitive or accessibility risk;
- translation to MSCanvas domain objects;
- prototype hypothesis and success metric;
- result of cognitive walkthrough/usability test.
