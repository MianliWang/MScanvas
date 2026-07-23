# Screen and workspace model

## Workbench shell

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
- analysis result selected → lineage and module parameters.

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
