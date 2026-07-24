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

## Bounded spike result — 2026-07-24

The first bounded Windows pass found no runnable `msconvert.exe` or `msaccess.exe` on `PATH` or in the reviewed normal installation roots. Windows Installer retains a ProteoWizard version record, but its `ProductState` is `ABSENT`; that residual metadata is not an installed version or a usable backend.

Explicit authorization was later granted to download and install the current official Windows x64 vendor-reader build. The exact official `3.0.26204` / `a09eea9` MSI was downloaded and hashed, with no redirect, but Windows reported Authenticode `NotSigned` and no signer. The mandatory trust gate stopped before execution, installer UI, elevation or installation; no alternate installer or unofficial source was tried. This advertised artifact identity is not an installed or executable-reported version.

The narrower portable continuation then verified the official download page, its `bt83` release record and its own S3 resolver for the matching Windows x86_64 `3.0.26204` / `a09eea9` tarball. The `97,078,806`-byte archive had SHA-256 `A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2`, no redirects, and no unsafe archive path, duplicate normalized path, link or extraction escape. Static inventory found exactly one `msconvert.exe` and one `msaccess.exe`; both were unsigned. No portable binary was executed on the host.

The local isolation gate stopped fail-clean without changing Windows features. A later exact-head evidence workflow used an ephemeral GitHub-hosted `windows-2025` VM. The unsigned portable tools ran only as a temporary non-elevated standard user after exact archive/fixture/executable hashes, scoped ACLs/environment, an owned Windows Job and three exact-program outbound blocks were verified. Independent cleanup proved the process tree, firewall rules, user/profile/logon right, runtime root and private state absent. No source checkout was present in the runtime job.

Exact run [`30129182032`](https://github.com/MianliWang/MScanvas/actions/runs/30129182032) at `f0d7957fbbe129263a9a89684b6ce549b1b3a086` passed both jobs and every cleanup/publication gate. Complete help confirmed the typed argv and executable-reported normalized release `3.0.26204`; `msconvert` also emitted revision `a09eea9`, while `msaccess` did not emit a revision. The verified four-spectrum/two-chromatogram synthetic mzML fixture produced parseable metadata, summary, spectrum table, derived TIC, filtered TIC and one selected spectrum. One-shot backend durations were 90–205 ms and do not establish representative latency.

The decision is capability-specific:

- **A:** discovery/build identity for this verified portable pair.
- **B:** metadata; summary/counts; derived TIC and MS-level filtering; scan listing; selected-spectrum extraction; overall conversion and mzML conversion, each with the limitations in the spike report.
- **C:** mzXML conversion for the tested multi-source fixture, because exit 0 serialized only 3 of 4 spectra; it is unsuitable without mandatory integrity validation.
- **D:** BPC, repeated navigation, large arrays, progress, real cancellation, locale stability and vendor-format coverage.

The table formatter abbreviates spectrum IDs while binary output uses raw IDs; the measured `19` and `scan=19` refer to the same index-0/scan-19 spectrum. A durable adapter must canonicalize identity rather than exact-compare formatter strings. The `tic` query sums binary intensities and emits index order, so it must be labeled as a derived/recomputed TIC and normalized for RT display rather than silently treated as a stored TIC chromatogram.

Process exit status is also insufficient as an operation result. `msaccess` returned exit 0/no output for both a deliberately unavailable index and an unsupported text input; only the latter emitted stderr. A typed preview executor must distinguish expected no-result from missing/malformed required output without relying on one locale's error text.

The code-contract portion validated fail-closed canonical-path discovery/planning, matching release/build identity checks, bounded diagnostic capture and Windows Job Object cancellation with a controlled parent/grandchild process tree, including root-exits-first and late-cancellation cases. Non-probe harness operations reject truncated help before requiring exact option/query markers, reject output inside directory-formatted inputs and require a fresh empty output directory. Those controlled cancellation tests do not substitute for a real ProteoWizard cancellation observation.

The detailed evidence and explicit not-run matrix are recorded in the [M0 ProteoWizard spike report](../../spikes/M0_PROTEOWIZARD_SPIKE.md).

## Next evidence gate

This ADR remains proposed because its representative-data, repeated-navigation, large-array and real-cancellation exit criteria are not met. The next slice should implement the typed preview-result and semantic-integrity boundary for the B capabilities, including canonical spectrum identity, RT normalization, derived-TIC labeling and operation-specific output requirements. Keep BPC and mzXML unavailable initially. Then measure repeated navigation and a representative lawful open-format file before exposing the provider as a normal viewer workflow. Real cancellation, a second locale and vendor-format coverage remain separate explicit gates.
