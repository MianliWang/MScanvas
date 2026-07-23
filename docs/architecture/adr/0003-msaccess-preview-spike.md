# ADR 0003 — Spike external ProteoWizard access for initial RAW preview

- Status: Proposed / spike required
- Date: 2026-07-22

## Context

The viewer needs metadata, TIC/BPC and individual spectra without implementing vendor readers or immediately embedding the ProteoWizard C++ API.

## Decision

M0 will evaluate `msaccess` or another documented ProteoWizard command route as the first preview provider. This is not accepted as the permanent architecture until latency, output stability, cancellation and large-file behavior are measured.

## Exit criteria

- metadata, TIC/BPC and one selected spectrum are retrievable from representative data;
- first useful preview latency is acceptable;
- parsing is testable with lawful fixtures;
- repeated scan navigation does not spawn an unusable number of expensive processes;
- failure and cancellation are diagnosable.

If the spike fails, compare temporary open-format indexing or a narrow native reader bridge.
