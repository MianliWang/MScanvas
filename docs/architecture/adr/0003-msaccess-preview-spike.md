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

## Partial spike result — 2026-07-24

The first bounded Windows pass found no runnable `msconvert.exe` or `msaccess.exe` on `PATH` or in the reviewed normal installation roots. Windows Installer retains a ProteoWizard version record, but its `ProductState` is `ABSENT`; that residual metadata is not an installed version or a usable backend.

Explicit authorization was later granted to download and install the current official Windows x64 vendor-reader build. The exact official `3.0.26204` / `a09eea9` MSI was downloaded and hashed, with no redirect, but Windows reported Authenticode `NotSigned` and no signer. The mandatory trust gate stopped before execution, installer UI, elevation or installation; no alternate installer or unofficial source was tried. This advertised artifact identity is not an installed or executable-reported version.

The narrower portable continuation then verified the official download page, its `bt83` release record and its own S3 resolver for the matching Windows x86_64 `3.0.26204` / `a09eea9` tarball. The `97,078,806`-byte archive had SHA-256 `A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2`, no redirects, and no unsafe archive path, duplicate normalized path, link or extraction escape. Static inventory found exactly one `msconvert.exe` and one `msaccess.exe`; both were unsigned. No portable binary was executed on the host.

The isolation gate then stopped fail-clean: Windows Sandbox was not enabled and no existing disposable Windows VM was available. Enabling a Windows feature or repurposing the registered non-Windows VMware guests was outside the authorization. The spike therefore could not inspect help, obtain executable-reported release/build data, or measure metadata, TIC/BPC, scan listing, spectrum extraction, conversion, parser stability, locale behavior or real process cancellation. Vendor RAW testing was explicitly excluded. Every runtime capability remains status D (still unverified); the A/B/C decision about `msaccess` remains deferred, and this ADR stays proposed.

The code-contract portion did validate fail-closed canonical-path discovery/planning, matching release/build identity checks, bounded diagnostic capture and Windows Job Object cancellation with a controlled parent/grandchild process tree, including root-exits-first and late-cancellation cases. Non-probe harness operations reject truncated help before requiring exact option/query markers, reject output inside directory-formatted inputs and require a fresh empty output directory. This mock and structural evidence does not substitute for real ProteoWizard measurements.

The detailed evidence and explicit not-run matrix are recorded in the [M0 ProteoWizard spike report](../../spikes/M0_PROTEOWIZARD_SPIKE.md).

## Next evidence gate

Before changing this ADR's status, prepare an explicitly approved disposable Windows environment and re-verify the recorded portable archive hash there. The next pass must capture complete non-truncated help and matching executable-reported identities before reconciling argv, then exercise the pinned lawful mzML fixture for metadata, counts, TIC, BPC capability, scan listing, one spectrum, an unavailable-scan case and mzML/mzXML conversion, with timings, output structure/hashes, parser/locale observations and failure evidence. Real cancellation remains a separate gate requiring a sufficiently long operation. Vendor-format coverage requires a separately authorized acquisition and remains unverified.
