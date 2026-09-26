# Screen and workspace model

## Current M7.2 workbench shell

The single logo/name Home action opens the workbench without resetting it.
Workbench and Conversion & results retain one set of workspace, provider, queue,
viewer and export owners while presentation surfaces hide or fold. The header
keeps active work discoverable. Acquisitions and Details can fold independently;
constrained windows show one auxiliary panel or the evidence region at a time.
The roster scrolls locally and evidence receives the remaining space.

The acquisition treegrid distinguishes keyboard focus, viewed source,
highlighted interaction selection and checkbox conversion membership. One level
of session groups references Rust dataset handles. Highlighted rows may remain
hidden by search/collapse; selection context reports that count. Menus, local
undo and pointer/keyboard drag change presentation references, never the roster
or execution order. New acquisitions enter Ungrouped; dissolving a group does
not remove any acquisition. See the
[implementation record](../ux/M7_2_WORKBENCH_SHELL_ROSTER_ORGANIZATION.md).

## M7.3 viewer continuation

The evidence stack presents the chromatogram, current spectrum, then loaded
scans. Small tables use their content height; large tables cap their scrolling
region at ten rows plus a sticky header. Table values and header buttons share
one horizontal track. Whole-row activation names a source index; roving focus
and persistent selection remain separate. Search/filter/sort affect loaded rows
only and expose hidden-selection recovery without replacing the plotted scan.

Plot text remains 12 CSS px as the available width changes. Existing scientific
export controls and detailed source explanations use reachable disclosures;
their state and source authority remain above the presentation. Constrained
windows retain natural outer evidence scrolling, including the rest of the
selected-spectrum plot below the initial short viewport.

Pending horizontal bands have visible boundaries, canonical accessible context
and a short confirm/cancel action. Numeric entry and compact gesture help remain
reachable. The existing Settings dialog localizes these controls and preserves
valid source-domain proposals and raw input drafts without remounting owners.
See [M7.3 acceptance and limitations](../ux/M7_3_VIEWER_SCANS_COMMITTED_GESTURES.md).

## M8.5 Project report surface

On the Project surface the main region is the evidence area. When a QC summary
snapshot is the inspected object it shows that snapshot as a compact report
above the lists -- exact values in small tables, no grade and no status colour
-- and the contextual Details region keeps what is not the report's: its run,
layer, source reference and the build that produced the preview. No global
route is added. See the
[M8 record](M8_1_FIRST_CLOSED_LOOP.md#what-m85-added-on-top-of-this).

## Historical M0 structural candidate

The first structural prototype uses a resizable workbench:

```text
Top command bar
├─ primary view switch
├─ add/remove/clear actions
└─ contextual primary action

Left context pane     Main workspace                Right inspector
Data/artifact list    linked plots/table/results    metadata/settings/selection

Bottom runs panel / compact run summary
```

This is a candidate, not a visual mandate. M0 must compare workspace-first, viewer-first and mode-based structures using the primary workflows.

## Surface responsibilities

### Data pane

- projects, acquisitions and derived artifacts;
- familiar multi-selection and batch status;
- search/filter/grouping as scale demands;
- never conflates workspace removal with disk deletion.

### Main workspace

- maximizes the evidence for the active task;
- Explore initially hosts chromatogram, spectrum and scan table;
- later tabs/views can host QC, feature tables or figure composition;
- no empty future mode is exposed merely because architecture permits it.

### Inspector

Contextual rather than permanently dense:

- acquisition selected → metadata and compatible actions;
- scan selected → scan/precursor metadata;
- plot layer selected → layer/style/source;
- conversion scope selected → semantic settings and output summary;
- analysis result selected → lineage and module parameters. Implemented for the
  targeted MS1 result (M9.1–M9.4): the report opens in the Project surface's
  main region and says whether its stored payload is whole, the source's
  last-checked state and whether new runs are available; Details shows the
  plan, the source as read and how it was given to the engine, and the attempt
  facts. A batch shows each member's execution state in its setup and opens
  one member's result at a time, never two together. See the
  [M9 closure](M9_CLOSURE.md).

### Runs panel

- compact summary while idle;
- expands for active/failed jobs;
- remains available without stealing the main workspace by default.

## Shared selection model

A selection is a domain state, not a chart-local accident. Initial fields include:

- active artifact;
- selected workspace artifact set;
- active scan/native ID;
- active RT and optional RT range;
- active m/z and optional m/z range;
- active plot layer;
- active run/result.

Updates declare source and intent to avoid feedback loops between views.

## Required states

Every primary surface designs and tests:

- initial/empty;
- loading/progress;
- partial/progressive data;
- ready;
- unsupported;
- recoverable failure;
- terminal failure;
- stale/missing source;
- keyboard focus and selected states;
- constrained-window behavior.
